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

function getPlatform(url) {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return {
      key: "invalid",
      label: "無效網址",
      supported: false,
      error: "請貼上完整網址，例如 https://www.instagram.com/reel/...",
    };
  }

  if (host.includes("threads.net")) {
    return {
      key: "threads",
      label: "Threads",
      supported: false,
      error:
        "Threads 目前不穩定，yt-dlp 尚未提供可靠支援。請先使用 YouTube、Facebook Reels 或 Instagram 影片連結。",
    };
  }

  if (host.includes("youtube.com") || host.includes("youtu.be")) {
    return { key: "youtube", label: "YouTube", supported: true };
  }

  if (host.includes("facebook.com") || host.includes("fb.watch")) {
    return { key: "facebook", label: "Facebook", supported: true };
  }

  if (host.includes("instagram.com")) {
    return { key: "instagram", label: "Instagram", supported: true };
  }

  return {
    key: "unknown",
    label: "未支援平台",
    supported: false,
    error:
      "目前支援 YouTube、Facebook Reels、Instagram Reels / 單篇影片。Threads 先列為暫不支援。",
  };
}

function buildBaseArgs() {
  return [
    "-m",
    "yt_dlp",
    "--no-playlist",
    "--ffmpeg-location",
    FFMPEG_DIR,
  ];
}

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

// 下載歷史持久化（重啟後 /api/file 仍可用）
const DL_HISTORY = path.join(DOWNLOAD_DIR, "history.json");
function loadDlHistory() {
  try {
    return JSON.parse(fs.readFileSync(DL_HISTORY, "utf-8"));
  } catch {
    return [];
  }
}
function saveDlHistory(list) {
  try {
    fs.writeFileSync(DL_HISTORY, JSON.stringify(list));
  } catch {}
}
function recordDownload(rec) {
  const list = loadDlHistory().filter((r) => r.id !== rec.id);
  list.unshift(rec);
  saveDlHistory(list.slice(0, 500));
}
// 啟動時把歷史載回 downloadMeta
for (const r of loadDlHistory()) {
  if (r.id && r.filepath && fs.existsSync(r.filepath)) {
    downloadMeta[r.id] = { filepath: r.filepath, title: r.title };
  }
}

// 下載歷史 API
app.get("/api/downloads", (req, res) => {
  const list = loadDlHistory().filter((r) => r.filepath && fs.existsSync(r.filepath));
  res.json(
    list.map((r) => ({
      id: r.id,
      title: r.title,
      filename: r.filename,
      mode: r.mode,
      ext: r.ext,
      size: r.size,
      ts: r.ts,
      downloadUrl: `/api/file/${r.id}`,
    }))
  );
});
app.delete("/api/downloads/:id", (req, res) => {
  const id = req.params.id;
  const list = loadDlHistory();
  const rec = list.find((r) => r.id === id);
  if (rec && rec.filepath) {
    try {
      fs.unlinkSync(rec.filepath);
    } catch {}
  }
  saveDlHistory(list.filter((r) => r.id !== id));
  delete downloadMeta[id];
  res.json({ ok: true });
});
app.delete("/api/downloads", (req, res) => {
  for (const r of loadDlHistory()) {
    if (r.filepath) {
      try {
        fs.unlinkSync(r.filepath);
      } catch {}
    }
    delete downloadMeta[r.id];
  }
  saveDlHistory([]);
  res.json({ ok: true });
});

// Fetch video info
app.get("/api/info", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "缺少 URL" });

  const platform = getPlatform(url);
  if (!platform.supported) {
    return res.status(400).json({ error: platform.error, platform });
  }

  const args = [
    ...buildBaseArgs(),
    "--dump-json",
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
      return res.status(500).json({
        error:
          err ||
          `${platform.label} 影片資訊解析失敗。若是私人內容，可能需要登入 cookies。`,
        platform,
      });
    try {
      const info = JSON.parse(data);
      res.json({
        platform: platform.label,
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
      res.status(500).json({ error: "解析影片資訊失敗", platform });
    }
  });
});

// Socket.io for download with progress
io.on("connection", (socket) => {
  socket.on("download", (opts) => {
    const { url, mode, quality, title } = opts;
    const platform = getPlatform(url);
    if (!platform.supported) {
      socket.emit("error", platform.error);
      return;
    }

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    // Use ID-based filename to avoid encoding issues on Windows
    const outTemplate = path.join(DOWNLOAD_DIR, `${id}.%(ext)s`);

    let args = [
      ...buildBaseArgs(),
      "--newline",
      "--progress",
    ];

    if (mode === "audio") {
      args.push("-x", "--audio-format", "mp3", "--audio-quality", "0");
    } else {
      const fmt = quality
        ? `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]/best`
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
          const ext = path.extname(files[0].name);
          downloadMeta[id] = { filepath, title: title || id };
          let size = 0;
          try {
            size = fs.statSync(filepath).size;
          } catch {}
          recordDownload({
            id,
            title: title || id,
            filename: (title || id) + ext,
            mode: mode || "video",
            ext,
            size,
            ts: Date.now(),
          });
          socket.emit("done", {
            id,
            filename: (title || id) + ext,
            downloadUrl: `/api/file/${id}`,
          });
        } else {
          socket.emit("error", "下載完成但找不到檔案");
        }
      } else {
        socket.emit(
          "error",
          `${platform.label} 下載失敗。若是私人內容或限登入內容，可能需要 cookies。`
        );
      }
    });

    socket.on("disconnect", () => {
      proc.kill();
    });
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`YTGrab 多平台下載器已啟動：http://localhost:${PORT}`);
});
