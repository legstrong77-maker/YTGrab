const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const DOWNLOAD_DIR = path.join(__dirname, "downloads");
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

// ffmpeg path - explicit location for yt-dlp
const FFMPEG_DIR = String.raw`C:\Users\User\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1-full_build\bin`;

app.use(express.static(path.join(__dirname, "public")));

// File download API - handles any filename safely
app.get("/api/file/:id", (req, res) => {
  const id = req.params.id;
  const meta = downloadMeta[id];
  if (!meta || !fs.existsSync(meta.filepath)) {
    return res.status(404).send("檔案不存在");
  }
  // Send with original title as download name
  const ext = path.extname(meta.filepath);
  const safeName = (meta.title || id) + ext;
  res.download(meta.filepath, safeName);
});

// Store download metadata: id -> { filepath, title }
const downloadMeta = {};

// Fetch video info
app.get("/api/info", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "缺少 URL" });

  const args = [
    "-m",
    "yt_dlp",
    "--dump-json",
    "--no-playlist",
    "--ffmpeg-location",
    FFMPEG_DIR,
    url,
  ];
  const proc = spawn("python", args, {
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });

  let data = "";
  let err = "";
  proc.stdout.on("data", (chunk) => (data += chunk.toString("utf-8")));
  proc.stderr.on("data", (chunk) => (err += chunk.toString("utf-8")));
  proc.on("close", (code) => {
    if (code !== 0)
      return res.status(500).json({ error: err || "取得影片資訊失敗" });
    try {
      const info = JSON.parse(data);
      res.json({
        title: info.title,
        thumbnail: info.thumbnail,
        duration: info.duration,
        uploader: info.uploader,
        view_count: info.view_count,
        formats: (info.formats || [])
          .filter((f) => f.height && f.vcodec !== "none")
          .map((f) => ({
            format_id: f.format_id,
            ext: f.ext,
            resolution: `${f.width}x${f.height}`,
            height: f.height,
            fps: f.fps,
            filesize: f.filesize || f.filesize_approx,
          }))
          .filter(
            (f, i, arr) => arr.findIndex((x) => x.height === f.height) === i
          )
          .sort((a, b) => b.height - a.height),
      });
    } catch (e) {
      res.status(500).json({ error: "解析影片資訊失敗" });
    }
  });
});

// Socket.io for download with progress
io.on("connection", (socket) => {
  socket.on("download", (opts) => {
    const { url, mode, quality, title } = opts;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    // Use ID-based filename to avoid encoding issues on Windows
    const outTemplate = path.join(DOWNLOAD_DIR, `${id}.%(ext)s`);

    let args = [
      "-m",
      "yt_dlp",
      "--no-playlist",
      "--newline",
      "--progress",
      "--ffmpeg-location",
      FFMPEG_DIR,
    ];

    if (mode === "audio") {
      args.push("-x", "--audio-format", "mp3", "--audio-quality", "0");
    } else {
      const fmt = quality
        ? `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]`
        : "bestvideo+bestaudio/best";
      args.push("-f", fmt, "--merge-output-format", "mp4");
    }

    args.push("-o", outTemplate, url);

    const proc = spawn("python", args, {
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });

    proc.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf-8");
      // parse progress
      const match = text.match(
        /\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+\w+)\s+at\s+([\d.]+\w+\/s|Unknown speed)\s+ETA\s+([\d:]+|Unknown)/
      );
      if (match) {
        socket.emit("progress", {
          percent: parseFloat(match[1]),
          size: match[2],
          speed: match[3],
          eta: match[4],
        });
      }
    });

    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf-8");
      socket.emit("log", text);
    });

    proc.on("close", (code) => {
      if (code === 0) {
        // Find the output file (id.mp4 or id.mp3 etc.)
        const files = fs
          .readdirSync(DOWNLOAD_DIR)
          .filter((f) => f.startsWith(id))
          .map((f) => ({
            name: f,
            time: fs.statSync(path.join(DOWNLOAD_DIR, f)).mtimeMs,
          }))
          .sort((a, b) => b.time - a.time);

        if (files.length > 0) {
          const filepath = path.join(DOWNLOAD_DIR, files[0].name);
          downloadMeta[id] = { filepath, title: title || id };
          socket.emit("done", {
            id,
            filename: (title || id) + path.extname(files[0].name),
            downloadUrl: `/api/file/${id}`,
          });
        } else {
          socket.emit("error", "下載完成但找不到檔案");
        }
      } else {
        socket.emit("error", "下載失敗");
      }
    });

    socket.on("disconnect", () => {
      proc.kill();
    });
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 YouTube 下載器運行中: http://localhost:${PORT}`);
});
