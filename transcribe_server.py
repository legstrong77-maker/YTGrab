# -*- coding: utf-8 -*-
"""
逐字稿小工具 — 本機影音轉繁體中文逐字稿
使用 MediaTek-Research/Breeze-ASR-25 (Whisper-large-v2 微調，台灣中文 / 中英夾雜)
重用你 YTGrab 的 yt-dlp + ffmpeg，支援「貼網址」或「上傳本機檔案」。

啟動：  python transcribe_server.py
然後開：http://localhost:8001
"""

import os
import re
import sys
import json
import time
import uuid
import shutil
import threading
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
import uvicorn
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse, Response
from fastapi.middleware.cors import CORSMiddleware
import io
import zipfile
from transformers import WhisperProcessor, WhisperForConditionalGeneration

# 安靜輸出：避免每段辨識都噴 transformers 警告（也減少在背景視窗卡住寫入的風險）
import warnings
warnings.filterwarnings("ignore")
try:
    from transformers.utils import logging as hf_logging
    hf_logging.set_verbosity_error()
except Exception:
    pass

# ---------------------------------------------------------------------------
# 設定
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
WORK_DIR = BASE_DIR / "transcribe_work"
WORK_DIR.mkdir(exist_ok=True)

# 與 server.js 相同的 ffmpeg 位置；找不到就退回系統 PATH
FFMPEG_DIR = r"C:\Users\User\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1-full_build\bin"
FFMPEG = str(Path(FFMPEG_DIR) / "ffmpeg.exe")
if not Path(FFMPEG).exists():
    FFMPEG = shutil.which("ffmpeg") or "ffmpeg"

MODEL_ID = "MediaTek-Research/Breeze-ASR-25"
SAMPLE_RATE = 16000
CHUNK_SECONDS = 28          # 每段音訊長度（Whisper 上限 30s，留點餘裕）
PORT = 8001

# ---------------------------------------------------------------------------
# 繁體中文轉換（保證輸出繁體）
# ---------------------------------------------------------------------------
try:
    from opencc import OpenCC
    try:
        _cc = OpenCC("s2twp")    # 簡 -> 繁（台灣慣用詞）
    except Exception:
        _cc = OpenCC("s2tw")
    def to_traditional(text: str) -> str:
        try:
            return _cc.convert(text)
        except Exception:
            return text
except Exception:
    print("[警告] 找不到 opencc，輸出可能含簡體字。請 pip install opencc-python-reimplemented")
    def to_traditional(text: str) -> str:
        return text

# ---------------------------------------------------------------------------
# 載入模型（啟動時載入一次，常駐記憶體）
# ---------------------------------------------------------------------------
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
DTYPE = torch.bfloat16 if DEVICE == "cuda" else torch.float32

print(f"[模型] 載入 {MODEL_ID} ... device={DEVICE} dtype={DTYPE}")
if DEVICE == "cpu":
    print("[警告] 偵測不到 CUDA，將用 CPU 跑，速度會很慢。請確認已安裝 CUDA 版 PyTorch。")

_t0 = time.time()
processor = WhisperProcessor.from_pretrained(MODEL_ID)
model = WhisperForConditionalGeneration.from_pretrained(
    MODEL_ID, torch_dtype=DTYPE
).to(DEVICE).eval()
GPU_LOCK = threading.Lock()   # 序列化 GPU 推論
print(f"[模型] 載入完成，耗時 {time.time() - _t0:.1f}s")


def transcribe_chunk(wave: np.ndarray) -> str:
    """轉一段音訊（<=30s）成文字。"""
    inputs = processor(
        wave, sampling_rate=SAMPLE_RATE, return_tensors="pt"
    ).input_features.to(DEVICE, dtype=DTYPE)
    with torch.no_grad(), GPU_LOCK:
        try:
            # 新版 transformers：直接指定語言/任務
            ids = model.generate(
                inputs, language="zh", task="transcribe", max_new_tokens=440
            )
        except TypeError:
            # 舊版退回 forced_decoder_ids
            forced = processor.get_decoder_prompt_ids(language="zh", task="transcribe")
            ids = model.generate(
                inputs, forced_decoder_ids=forced, max_new_tokens=440
            )
    text = processor.batch_decode(ids, skip_special_tokens=True)[0]
    return to_traditional(text.strip())


# ---------------------------------------------------------------------------
# 音訊處理
# ---------------------------------------------------------------------------
def run(cmd: list) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
        env={**os.environ, "PYTHONIOENCODING": "utf-8"},
    )


def fetch_audio_from_url(url: str, out_base: Path) -> tuple[str, Path]:
    """用 yt-dlp 抓最佳音訊，回傳 (標題, 下載到的檔案路徑)。"""
    # 先取標題
    info = run([sys.executable, "-m", "yt_dlp", "--no-playlist",
                "--ffmpeg-location", FFMPEG_DIR, "--dump-json", url])
    title = "audio"
    if info.returncode == 0:
        try:
            title = json.loads(info.stdout).get("title", "audio")
        except Exception:
            pass
    out_tmpl = str(out_base) + ".%(ext)s"
    dl = run([sys.executable, "-m", "yt_dlp", "--no-playlist",
              "--ffmpeg-location", FFMPEG_DIR,
              "-f", "bestaudio/best", "-o", out_tmpl, url])
    if dl.returncode != 0:
        raise RuntimeError("下載失敗：" + (dl.stderr or "未知錯誤，若為私人內容可能需要 cookies"))
    files = sorted(out_base.parent.glob(out_base.name + ".*"),
                   key=lambda p: p.stat().st_mtime, reverse=True)
    if not files:
        raise RuntimeError("下載完成但找不到音訊檔")
    return title, files[0]


def to_wav16k(src: Path, dst: Path):
    """任意影音 -> 16kHz 單聲道 wav。"""
    r = run([FFMPEG, "-y", "-i", str(src), "-ar", str(SAMPLE_RATE),
             "-ac", "1", "-f", "wav", str(dst)])
    if r.returncode != 0 or not dst.exists():
        raise RuntimeError("音訊轉檔失敗：" + (r.stderr[-500:] if r.stderr else ""))


def fmt_ts(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds - int(seconds)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


# ---------------------------------------------------------------------------
# YouTube / 平台「現成字幕」快速通道（有字幕就秒出，免下載音訊、免跑 GPU）
# ---------------------------------------------------------------------------
SUB_LANG_PREF = ["zh-hant", "zh-tw", "zh-hk", "zh", "zh-hans", "zh-cn", "en"]


def get_title(url: str) -> str:
    r = run([sys.executable, "-m", "yt_dlp", "--no-playlist",
             "--skip-download", "--print", "%(title)s", url])
    if r.returncode == 0 and r.stdout.strip():
        return r.stdout.strip().splitlines()[0]
    return "video"


def _subs_to_text(raw: str) -> str:
    """把 srt/vtt 內文抽成純逐字稿，並清掉自動字幕常見的滾動重複。"""
    out = []
    for line in raw.splitlines():
        s = line.strip()
        if not s or s.upper().startswith("WEBVTT"):
            continue
        if s.isdigit() or "-->" in s:
            continue
        s = re.sub(r"<[^>]+>", "", s)          # 去掉 <00:00:00.000>、<c> 等標籤
        s = re.sub(r"\{\\[^}]*\}", "", s)       # 去掉樣式標籤
        s = s.strip()
        if not s:
            continue
        # 自動字幕常見：上一行是這一行的前綴（滾動式），保留較長的那行
        if out and (s.startswith(out[-1]) or out[-1].startswith(s)):
            out[-1] = s if len(s) >= len(out[-1]) else out[-1]
            continue
        if out and out[-1] == s:                # 連續完全重複
            continue
        out.append(s)
    return "\n".join(out).strip()


def _find_sub(base: Path):
    cands = list(base.parent.glob(base.name + ".*.srt"))
    if not cands:
        return None

    def score(p):
        low = p.name.lower()
        for i, lang in enumerate(SUB_LANG_PREF):
            if f".{lang}." in low:
                return i
        return 999
    cands.sort(key=score)
    return cands[0]


def fetch_existing_subs(url: str, base: Path):
    """嘗試抓現成字幕：先人工字幕（乾淨），再退回自動字幕。回傳 (text, srt) 或 None。"""
    langs = "zh-Hant,zh-TW,zh-HK,zh,zh-Hans,zh-CN,en.*,en"
    common = [sys.executable, "-m", "yt_dlp", "--no-playlist",
              "--ffmpeg-location", FFMPEG_DIR, "--skip-download",
              "--sub-langs", langs, "--convert-subs", "srt", "-o", str(base)]
    # 第一輪：只抓人工字幕
    run(common + ["--write-subs", url])
    pick = _find_sub(base)
    # 第二輪：沒有人工字幕才抓自動字幕
    if pick is None:
        run(common + ["--write-auto-subs", url])
        pick = _find_sub(base)
    if pick is None:
        return None
    srt_raw = pick.read_text(encoding="utf-8", errors="replace")
    text = to_traditional(_subs_to_text(srt_raw))
    srt = to_traditional(srt_raw)
    if not text.strip():
        return None
    return text, srt


# ---------------------------------------------------------------------------
# 工作佇列（單一背景執行緒處理，輪詢取進度）
# ---------------------------------------------------------------------------
JOBS: dict[str, dict] = {}

# ---------------------------------------------------------------------------
# 歷史紀錄（持久化到 history.json，重開機後仍可瀏覽/下載）
# ---------------------------------------------------------------------------
HISTORY_FILE = WORK_DIR / "history.json"
HISTORY_LOCK = threading.Lock()


def load_history() -> list:
    try:
        return json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def record_history(job_id: str, title: str, source: str, chars: int):
    with HISTORY_LOCK:
        hist = load_history()
        hist = [r for r in hist if r.get("id") != job_id]   # 去重
        hist.insert(0, {"id": job_id, "title": title or job_id,
                        "source": source, "chars": chars, "ts": time.time()})
        hist = hist[:500]                                    # 最多保留 500 筆
        try:
            HISTORY_FILE.write_text(json.dumps(hist, ensure_ascii=False),
                                    encoding="utf-8")
        except Exception:
            pass


def valid_id(job_id: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9]+", job_id or ""))


def title_for(job_id: str) -> str:
    j = JOBS.get(job_id)
    if j and j.get("title"):
        return j["title"]
    for r in load_history():
        if r.get("id") == job_id:
            return r.get("title") or job_id
    return job_id


def process_job(job_id: str):
    job = JOBS[job_id]
    base = WORK_DIR / job_id
    try:
        # 0) 現成字幕快速通道：有字幕就秒出，免下載音訊、免跑模型
        if job["mode"] == "url" and job.get("prefer_subs"):
            job.update(stage="嘗試取得現成字幕…", progress=0.0)
            job["title"] = get_title(job["url"])
            try:
                subs = fetch_existing_subs(job["url"], base)
            except Exception:
                subs = None
            if subs:
                text, srt = subs
                (base.parent / f"{job_id}.txt").write_text(text, encoding="utf-8")
                (base.parent / f"{job_id}.srt").write_text(srt, encoding="utf-8")
                job.update(stage="完成（現成字幕）", progress=1.0, state="done",
                           text=text, srt=srt, source="subs")
                record_history(job_id, job["title"], "subs", len(text))
                return
            job.update(stage="無現成字幕，改用 AI 辨識…", progress=0.0)

        # 1) 取得音訊來源
        if job["mode"] == "url":
            job.update(stage="下載影片音訊中…", progress=0.0)
            title, raw = fetch_audio_from_url(job["url"], base)
            job["title"] = title
        else:
            raw = Path(job["upload_path"])
            job["title"] = job.get("title") or raw.stem

        # 2) 轉 16k 單聲道 wav
        job.update(stage="轉換音訊格式…", progress=0.02)
        wav_path = base.with_suffix(".16k.wav")
        to_wav16k(raw, wav_path)

        # 3) 讀取波形並分段轉寫
        wave, sr = sf.read(str(wav_path), dtype="float32")
        if wave.ndim > 1:
            wave = wave.mean(axis=1)
        duration = len(wave) / sr
        step = CHUNK_SECONDS * sr
        total = max(1, int(np.ceil(len(wave) / step)))
        job["duration"] = duration

        segments = []   # (start, end, text)
        for i in range(total):
            piece = wave[i * step:(i + 1) * step]
            if len(piece) < sr * 0.2:   # 太短跳過
                continue
            text = transcribe_chunk(piece)
            if text:
                start = i * CHUNK_SECONDS
                end = min((i + 1) * CHUNK_SECONDS, duration)
                segments.append((start, end, text))
            job.update(
                stage=f"轉寫中… {i + 1}/{total} 段",
                progress=0.05 + 0.93 * (i + 1) / total,
            )

        # 4) 組合結果
        full_text = "\n".join(s[2] for s in segments).strip()
        srt_lines = []
        for idx, (start, end, text) in enumerate(segments, 1):
            srt_lines.append(f"{idx}\n{fmt_ts(start)} --> {fmt_ts(end)}\n{text}\n")
        srt = "\n".join(srt_lines)

        (base.parent / f"{job_id}.txt").write_text(full_text, encoding="utf-8")
        (base.parent / f"{job_id}.srt").write_text(srt, encoding="utf-8")

        job.update(stage="完成", progress=1.0, state="done",
                   text=full_text, srt=srt, source="asr")
        record_history(job_id, job["title"], "asr", len(full_text))
    except Exception as e:
        job.update(state="error", error=str(e), stage="發生錯誤")


# ---------------------------------------------------------------------------
# FastAPI
# ---------------------------------------------------------------------------
app = FastAPI()

# 允許從 YTGrab 整合頁（http://localhost:3000）跨來源呼叫本服務
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


@app.get("/", response_class=HTMLResponse)
def index():
    return (BASE_DIR / "transcribe.html").read_text(encoding="utf-8")


@app.post("/api/job")
async def create_job(
    mode: str = Form(...),
    url: str = Form(""),
    prefer_subs: str = Form("0"),
    file: UploadFile | None = File(None),
):
    job_id = uuid.uuid4().hex[:12]
    job = {"id": job_id, "mode": mode, "url": url, "state": "running",
           "stage": "排隊中…", "progress": 0.0, "title": "",
           "text": "", "srt": "", "error": "", "source": "",
           "prefer_subs": prefer_subs not in ("0", "", "false", "False")}

    if mode == "file":
        if file is None:
            raise HTTPException(400, "沒有收到檔案")
        suffix = Path(file.filename or "upload").suffix or ".bin"
        upload_path = WORK_DIR / f"{job_id}{suffix}"
        with open(upload_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        job["upload_path"] = str(upload_path)
        job["title"] = Path(file.filename or "upload").stem
    elif mode == "url":
        if not url.strip():
            raise HTTPException(400, "請貼上網址")
    else:
        raise HTTPException(400, "未知模式")

    JOBS[job_id] = job
    threading.Thread(target=process_job, args=(job_id,), daemon=True).start()
    return {"job_id": job_id}


@app.get("/api/status/{job_id}")
def status(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "找不到工作")
    return {k: job.get(k) for k in
            ("id", "state", "stage", "progress", "title", "text", "srt",
             "error", "duration", "source")}


@app.get("/api/download/{job_id}/{fmt}")
def download(job_id: str, fmt: str):
    if fmt not in ("txt", "srt") or not valid_id(job_id):
        raise HTTPException(400, "參數錯誤")
    path = WORK_DIR / f"{job_id}.{fmt}"
    if not path.exists():
        raise HTTPException(404, "檔案不存在")
    safe = re.sub(r'[\\/:*?"<>|]', "_", title_for(job_id))
    return FileResponse(path, filename=f"{safe}.{fmt}",
                        media_type="text/plain; charset=utf-8")


@app.get("/api/download_zip")
def download_zip(ids: str, fmt: str = "txt"):
    """把多個已完成工作的逐字稿打包成一個 zip 下載。
    ids: 逗號分隔的 job_id；fmt: txt / srt / both。"""
    job_ids = [x for x in ids.split(",") if x]
    fmts = ["txt", "srt"] if fmt == "both" else [fmt]
    if any(f not in ("txt", "srt") for f in fmts):
        raise HTTPException(400, "格式錯誤")

    buf = io.BytesIO()
    used = set()
    count = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for jid in job_ids:
            if not valid_id(jid):
                continue
            safe = re.sub(r'[\\/:*?"<>|]', "_", title_for(jid))
            for f in fmts:
                p = WORK_DIR / f"{jid}.{f}"
                if not p.exists():
                    continue
                name = f"{safe}.{f}"
                k = 1
                while name in used:               # 避免同名覆蓋
                    name = f"{safe} ({k}).{f}"
                    k += 1
                used.add(name)
                zf.write(p, name)
                count += 1

    if count == 0:
        raise HTTPException(404, "沒有可下載的已完成逐字稿")
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="transcripts.zip"'},
    )


@app.get("/api/history")
def history():
    """回傳歷史紀錄（最新在前），只列出檔案還在的項目。"""
    out = []
    for r in load_history():
        if valid_id(r.get("id", "")) and (WORK_DIR / f"{r['id']}.txt").exists():
            out.append(r)
    return out


@app.get("/api/result/{job_id}")
def result(job_id: str):
    """從磁碟讀回某次逐字稿的全文與字幕（供歷史重看，重開機後也行）。"""
    if not valid_id(job_id):
        raise HTTPException(400, "參數錯誤")
    txt = WORK_DIR / f"{job_id}.txt"
    srt = WORK_DIR / f"{job_id}.srt"
    if not txt.exists():
        raise HTTPException(404, "找不到逐字稿")
    return {
        "id": job_id,
        "title": title_for(job_id),
        "text": txt.read_text(encoding="utf-8", errors="replace"),
        "srt": srt.read_text(encoding="utf-8", errors="replace") if srt.exists() else "",
    }


@app.delete("/api/result/{job_id}")
def delete_result(job_id: str):
    """從歷史與磁碟刪除某次逐字稿。"""
    if not valid_id(job_id):
        raise HTTPException(400, "參數錯誤")
    for p in WORK_DIR.glob(f"{job_id}.*"):
        try:
            p.unlink()
        except Exception:
            pass
    with HISTORY_LOCK:
        hist = [r for r in load_history() if r.get("id") != job_id]
        try:
            HISTORY_FILE.write_text(json.dumps(hist, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass
    JOBS.pop(job_id, None)
    return {"ok": True}


@app.get("/api/health")
def health():
    return {"device": DEVICE, "model": MODEL_ID,
            "cuda": torch.cuda.is_available()}


if __name__ == "__main__":
    print(f"\n逐字稿工具已啟動：http://localhost:{PORT}\n")
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
