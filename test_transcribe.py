# -*- coding: utf-8 -*-
"""驗證腳本：用 downloads 裡現成的檔案裁一小段，跑完整轉寫流程。"""
import sys, time, subprocess
from pathlib import Path

BASE = Path(__file__).resolve().parent
SRC = BASE / "downloads" / "mp0w9tagm0pu.mp3"   # 任選一個現成檔
CLIP = BASE / "transcribe_work" / "_test_clip.mp3"
CLIP.parent.mkdir(exist_ok=True)

# 1) 裁前 45 秒當測試
import transcribe_server as T   # 這行會載入模型（首次會下載 ~5GB）
print("[測試] 裁切測試片段(前 45 秒)...")
subprocess.run([T.FFMPEG, "-y", "-i", str(SRC), "-t", "45", str(CLIP)],
               capture_output=True)

# 2) 轉 16k wav
wav = CLIP.with_suffix(".16k.wav")
T.to_wav16k(CLIP, wav)

# 3) 讀波形、轉寫
import soundfile as sf, numpy as np
wave, sr = sf.read(str(wav), dtype="float32")
if wave.ndim > 1:
    wave = wave.mean(axis=1)
step = T.CHUNK_SECONDS * sr
print(f"[測試] 音訊長度 {len(wave)/sr:.1f}s，開始轉寫...")
t0 = time.time()
texts = []
for i in range(int(np.ceil(len(wave)/step))):
    piece = wave[i*step:(i+1)*step]
    if len(piece) < sr*0.2:
        continue
    txt = T.transcribe_chunk(piece)
    texts.append(txt)
    print(f"  段{i+1}: {txt}")
elapsed = time.time()-t0
print(f"\n[測試] 完成，耗時 {elapsed:.1f}s，device={T.DEVICE}")
result = "\n".join(texts)
(BASE / "transcribe_work" / "_test_result.txt").write_text(
    f"device={T.DEVICE} elapsed={elapsed:.1f}s\n\n{result}", encoding="utf-8")
print("[測試] 結果已寫入 transcribe_work/_test_result.txt")
