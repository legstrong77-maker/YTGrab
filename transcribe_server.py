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
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
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
# 工作佇列（單一背景執行緒處理，輪詢取進度）
# ---------------------------------------------------------------------------
JOBS: dict[str, dict] = {}


def process_job(job_id: str):
    job = JOBS[job_id]
    base = WORK_DIR / job_id
    try:
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
                   text=full_text, srt=srt)
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
    file: UploadFile | None = File(None),
):
    job_id = uuid.uuid4().hex[:12]
    job = {"id": job_id, "mode": mode, "url": url, "state": "running",
           "stage": "排隊中…", "progress": 0.0, "title": "",
           "text": "", "srt": "", "error": ""}

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
             "error", "duration")}


@app.get("/api/download/{job_id}/{fmt}")
def download(job_id: str, fmt: str):
    job = JOBS.get(job_id)
    if not job or job.get("state") != "done":
        raise HTTPException(404, "尚未完成或不存在")
    if fmt not in ("txt", "srt"):
        raise HTTPException(400, "格式錯誤")
    path = WORK_DIR / f"{job_id}.{fmt}"
    if not path.exists():
        raise HTTPException(404, "檔案不存在")
    safe = re.sub(r'[\\/:*?"<>|]', "_", job.get("title") or job_id)
    return FileResponse(path, filename=f"{safe}.{fmt}",
                        media_type="text/plain; charset=utf-8")


@app.get("/api/health")
def health():
    return {"device": DEVICE, "model": MODEL_ID,
            "cuda": torch.cuda.is_available()}


if __name__ == "__main__":
    print(f"\n逐字稿工具已啟動：http://localhost:{PORT}\n")
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
