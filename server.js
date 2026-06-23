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
const FFMPEG = path.join(FFMPEG_DIR, "ffmpeg.exe");
const FFPROBE = path.join(FFMPEG_DIR, "ffprobe.exe");

app.use(express.static(path.join(__dirname, "public")));

// ffprobe 取得影片長度（秒），給進度估算用
function ffprobeDuration(file) {
  return new Promise((resolve) => {
    const pr = spawn(FFPROBE, [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=nw=1:nk=1", file,
    ]);
    let o = "";
    pr.stdout.on("data", (c) => (o += c.toString()));
    pr.on("close", () => {
      const d = parseFloat(o.trim());
      resolve(isFinite(d) ? d : 0);
    });
    pr.on("error", () => resolve(0));
  });
}
function parseFfmpegTime(line) {
  const m = line.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
  if (!m) return null;
  return +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]);
}
function runFfmpeg(args, duration, socket, onDone, fallbackArgs) {
  const proc = spawn(FFMPEG, args);
  proc.stderr.on("data", (c) => {
    const t = parseFfmpegTime(c.toString());
    if (t != null && duration > 0) {
      socket.emit("tool-progress", { percent: Math.min(99, Math.round((t / duration) * 100)) });
    }
  });
  proc.on("close", (code) => {
    if (code === 0) return onDone();
    if (fallbackArgs) return runFfmpeg(fallbackArgs, duration, socket, onDone);
    socket.emit("tool-error", "處理失敗（ffmpeg 退出碼 " + code + "）");
  });
  proc.on("error", (e) => socket.emit("tool-error", "無法啟動 ffmpeg：" + e.message));
}

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

// 展開播放清單 → 回傳裡面每支影片的網址與標題
app.get("/api/playlist", (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "缺少 URL" });
  const args = [
    "-m", "yt_dlp",
    "--flat-playlist",
    "--dump-json",
    "--ffmpeg-location", FFMPEG_DIR,
    url,
  ];
  const proc = spawn("python", args, {
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  let data = "";
  let err = "";
  proc.stdout.on("data", (c) => (data += c.toString("utf-8")));
  proc.stderr.on("data", (c) => (err += c.toString("utf-8")));
  proc.on("close", (code) => {
    if (code !== 0 && !data.trim()) {
      return res.status(500).json({ error: err || "無法解析播放清單" });
    }
    const items = [];
    for (const line of data.split("\n")) {
      const s = line.trim();
      if (!s) continue;
      try {
        const e = JSON.parse(s);
        const vurl =
          e.url && /^https?:/.test(e.url)
            ? e.url
            : e.id
            ? `https://www.youtube.com/watch?v=${e.id}`
            : null;
        if (vurl) items.push({ url: vurl, title: e.title || vurl });
      } catch {}
    }
    if (!items.length) {
      return res.status(400).json({ error: "這個網址不是播放清單，或裡面沒有影片" });
    }
    res.json({ count: items.length, items });
  });
});

// Socket.io for download with progress
io.on("connection", (socket) => {
  socket.on("download", (opts) => {
    const { url, mode, quality, title, clipStart, clipEnd } = opts;
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

    // 剪裁：只下載指定時間段（a→b）
    const ts = (s) => String(s || "").trim();
    if (ts(clipStart) || ts(clipEnd)) {
      const section = `*${ts(clipStart) || "0:00"}-${ts(clipEnd) || "inf"}`;
      args.push("--download-sections", section, "--force-keyframes-at-cuts");
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
            filepath,
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

  // 影片工具箱：拿下載紀錄裡的影片做後製（轉檔/壓縮/GIF/縮圖）
  socket.on("tool", async (opts) => {
    const { sourceId, op, params } = opts || {};
    const meta = downloadMeta[sourceId];
    if (!meta || !fs.existsSync(meta.filepath)) {
      socket.emit("tool-error", "找不到來源檔，請從下載紀錄重新選擇");
      return;
    }
    const src = meta.filepath;
    const baseTitle = meta.title || sourceId;
    const newId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const p = params || {};
    const clampInt = (v, lo, hi, def) => {
      const n = parseInt(v, 10);
      return isNaN(n) ? def : Math.max(lo, Math.min(hi, n));
    };

    let outExt, args, fallbackArgs = null, label;
    if (op === "convert") {
      const fmt = ["mp4", "mkv", "mp3", "wav"].includes(p.format) ? p.format : "mp4";
      outExt = fmt;
      label = "轉檔 " + fmt.toUpperCase();
      if (fmt === "mp3") args = ["-i", src, "-vn", "-c:a", "libmp3lame", "-q:a", "2"];
      else if (fmt === "wav") args = ["-i", src, "-vn", "-c:a", "pcm_s16le"];
      else args = ["-i", src, "-c", "copy"];
    } else if (op === "compress") {
      outExt = "mp4";
      label = "壓縮";
      const cq = { high: "23", medium: "28", low: "33" }[p.quality] || "28";
      const vf = p.scale && p.scale !== "keep" ? ["-vf", "scale=-2:" + clampInt(p.scale, 144, 2160, 720)] : [];
      args = ["-i", src, "-c:v", "h264_nvenc", "-cq", cq, ...vf, "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"];
      fallbackArgs = ["-y", "-i", src, "-c:v", "libx264", "-crf", cq, ...vf, "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"];
    } else if (op === "gif") {
      outExt = "gif";
      label = "GIF";
      const fps = clampInt(p.fps, 1, 30, 12);
      const w = clampInt(p.width, 64, 1024, 400);
      const ss = String(p.start || "0").trim() || "0";
      const toArg = String(p.end || "").trim() ? ["-to", String(p.end).trim()] : [];
      args = ["-ss", ss, ...toArg, "-i", src, "-vf",
        `fps=${fps},scale=${w}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`];
    } else if (op === "thumb") {
      outExt = "jpg";
      label = "縮圖";
      args = ["-ss", String(p.time || "0").trim() || "0", "-i", src, "-frames:v", "1", "-q:v", "2"];
    } else if (op === "normalize") {
      outExt = "mp4";
      label = "音量正規化";
      args = ["-i", src, "-c:v", "copy", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"];
    } else if (op === "vertical") {
      outExt = "mp4";
      label = "直式短影音";
      const vf = p.fit === "crop"
        ? "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920"
        : "split[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=20[bg];[b]scale=1080:1920:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2";
      args = ["-i", src, "-vf", vf, "-c:a", "copy", "-c:v", "h264_nvenc", "-cq", "25", "-movflags", "+faststart"];
      fallbackArgs = ["-y", "-i", src, "-vf", vf, "-c:a", "copy", "-c:v", "libx264", "-crf", "23", "-movflags", "+faststart"];
    } else if (op === "rotate") {
      outExt = "mp4";
      label = "旋轉";
      const vf = p.dir === "ccw" ? "transpose=2" : p.dir === "180" ? "transpose=1,transpose=1" : "transpose=1";
      args = ["-i", src, "-vf", vf, "-c:a", "copy", "-c:v", "h264_nvenc", "-cq", "23", "-movflags", "+faststart"];
      fallbackArgs = ["-y", "-i", src, "-vf", vf, "-c:a", "copy", "-c:v", "libx264", "-crf", "20", "-movflags", "+faststart"];
    } else if (op === "speed") {
      outExt = "mp4";
      label = "變速";
      const rate = ["0.5", "1.5", "2"].includes(String(p.rate)) ? String(p.rate) : "2";
      args = ["-i", src, "-vf", `setpts=PTS/${rate}`, "-af", `atempo=${rate}`,
        "-c:v", "h264_nvenc", "-cq", "23", "-c:a", "aac", "-movflags", "+faststart"];
      fallbackArgs = ["-y", "-i", src, "-vf", `setpts=PTS/${rate}`, "-af", `atempo=${rate}`,
        "-c:v", "libx264", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart"];
    } else {
      socket.emit("tool-error", "未知操作");
      return;
    }

    const outPath = path.join(DOWNLOAD_DIR, `${newId}.${outExt}`);
    const fullArgs = ["-y", ...args, outPath];
    if (fallbackArgs) fallbackArgs = [...fallbackArgs, outPath];

    const duration = await ffprobeDuration(src);
    runFfmpeg(
      fullArgs,
      duration,
      socket,
      () => {
        if (!fs.existsSync(outPath)) {
          socket.emit("tool-error", "處理完成但找不到輸出檔");
          return;
        }
        const niceName = `${baseTitle} (${label}).${outExt}`;
        downloadMeta[newId] = { filepath: outPath, title: `${baseTitle} (${label})` };
        let size = 0;
        try { size = fs.statSync(outPath).size; } catch {}
        recordDownload({
          id: newId, title: `${baseTitle} (${label})`, filename: niceName,
          mode: outExt === "mp3" || outExt === "wav" ? "audio" : "video",
          ext: "." + outExt, size, ts: Date.now(), filepath: outPath,
        });
        socket.emit("tool-done", { id: newId, filename: niceName, downloadUrl: `/api/file/${newId}` });
      },
      fallbackArgs
    );
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`YTGrab 多平台下載器已啟動：http://localhost:${PORT}`);
});
