# 🎙️ 逐字稿工具 — 繁體中文影音轉文字

把影片 / 聲音轉成**繁體中文逐字稿**，完全在你電腦本機運算，免費、不上傳雲端。
使用 **MediaTek-Research/Breeze-ASR-25**（Whisper-large-v2 微調，專為台灣中文與中英夾雜優化），
重用你 YTGrab 的 yt-dlp + ffmpeg 引擎。

## ✨ 功能
- **貼網址**：YouTube / Facebook / Instagram 影片 → 自動下載音訊 → 出逐字稿
- **上傳檔案**：本機 mp4 / mp3 / wav / m4a / mov… 直接轉
- **保證繁體中文**：用 OpenCC 後處理（簡→繁台灣化）
- **輸出**：逐字稿純文字（.txt）＋ 字幕檔（.srt）
- 即時進度條、複製按鈕、深色玻璃介面

## 🖥️ 需求
- 本機已偵測到 **NVIDIA RTX 5070 Ti Laptop (12GB)** — 跑這個 2B 模型很順
- Python 3（已安裝 3.13）、yt-dlp（已安裝）、ffmpeg（已安裝）
- **不需要申請任何 API 金鑰** — 模型是下載到本機跑的

## 🚀 安裝（只做一次）
雙擊 **`安裝逐字稿.bat`**，或手動：
```bash
# RTX 50 系列要用 CUDA 12.8 版 PyTorch
pip install torch --index-url https://download.pytorch.org/whl/cu128
pip install -r requirements-transcribe.txt
```
> 第一次啟動會自動下載模型（約 5GB）到 HuggingFace 快取，之後就不用再下載。

## ▶️ 啟動
雙擊 **`啟動逐字稿.bat`**，或：
```bash
python transcribe_server.py
```
等到看到 `逐字稿工具已啟動：http://localhost:8001`，用瀏覽器開該網址即可。
（YTGrab 下載器仍在 `http://localhost:3000`，兩者可同時開。）

## ⚙️ 運作原理
1. **取得音訊**：網址 → yt-dlp 抓最佳音軌；或直接用上傳的檔案
2. **轉檔**：ffmpeg → 16kHz 單聲道 wav
3. **分段轉寫**：每 28 秒一段丟給 Breeze ASR 25，逐段回報進度
4. **繁體化**：OpenCC `s2twp` 確保輸出繁體中文
5. **輸出**：合併成逐字稿，並產生 .txt / .srt

## 🔧 可調參數（transcribe_server.py 開頭）
- `CHUNK_SECONDS = 28`：每段長度
- `PORT = 8001`：服務埠號
- `MODEL_ID`：可換成 `MediaTek-Research/Breeze-ASR-26`（更新版）試試

## ❓ 常見問題
- **跑很慢 / 用到 CPU**：表示沒裝到 CUDA 版 PyTorch。重跑 `安裝逐字稿.bat`。
- **私人影片下載失敗**：可能需要登入 cookies（同 YTGrab 限制）。
- **字幕時間軸較粗（28 秒一塊）**：v1 以「逐字稿文字」為主，字幕為附帶；之後可再做精細斷句。
