# YTGrab — YouTube 影片下載器

一個美觀、快速、本機運行的 YouTube 影片與音訊下載工具。
使用 Node.js, Express, Socket.IO, yt-dlp 和 FFmpeg 打造。

## 🌟 特色功能

- **本機執行**：完全在你的電腦上處理，不經過第三方伺服器，安全私密。
- **支援 4K 畫質**：自動抓取並合併最佳影像與音訊軌。
- **MP3 擷取**：直接將 YouTube 影片轉換為高品質 MP3 音檔。
- **即時進度**：透過 WebSocket 顯示毫秒級的下載進度、速度與預估剩餘時間。
- **現代化 UI**：採用玻璃擬態（Glassmorphism）設計的深色主題，提供極致的操作體驗。

## 🛠️ 安裝需求

在執行此專案之前，請確保您的系統已安裝以下工具：

1. **[Node.js](https://nodejs.org/)** (建議 v16 以上)
2. **[Python 3](https://www.python.org/)** (yt-dlp 需要)
3. **yt-dlp**: YouTube 下載核心引擎
   ```bash
   pip install yt-dlp
   ```
4. **FFmpeg**: 影音合併與轉碼工具。必須安裝並加入系統環境變數 (PATH)，或在 `server.js` 中指定其路徑。

## 🚀 快速開始

1. **複製專案並進入目錄**
2. **安裝依賴套件**
   ```bash
   npm install
   ```
3. **設定 FFmpeg 路徑**
   開啟 `server.js`，找到 `FFMPEG_DIR` 變數，將其修改為您電腦上 FFmpeg `bin` 資料夾的絕對路徑。如果您已經將 FFmpeg 加入了全域環境變數，可以將這個變數設為空字串或調整相關邏輯。
4. **啟動伺服器**
   ```bash
   npm start
   # 或
   node server.js
   ```
5. **開啟瀏覽器**
   前往 `http://localhost:3000` 即可開始下載影片！

## 📁 資料夾結構

- `server.js`: 後端 Express 伺服器與 Socket.IO 邏輯。
- `public/`: 前端靜態檔案 (HTML, CSS, JS)。
- `downloads/`: 下載完成的影片與音檔預設存放位置（會自動建立）。

## 📝 運作原理

1. **解析**：呼叫 `yt-dlp --dump-json` 獲取影片 Metadata 與可用格式。
2. **下載**：使用 `yt-dlp` 下載分離的影像軌與音訊軌。
3. **合併**：呼叫 `FFmpeg` 進行無損合併 (Mux) 產生 MP4，或轉碼為 MP3。
4. **回傳**：透過 Express API 將檔案提供給前端下載。

## 授權條款

MIT License
