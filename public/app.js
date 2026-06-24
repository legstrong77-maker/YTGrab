// 主題色切換（記住偏好）
(() => {
  const ACCENTS = {
    red: ["#ff0844", "#ff4070", "255,8,68"],
    purple: ["#a855f7", "#c084fc", "168,85,247"],
    blue: ["#3b82f6", "#60a5fa", "59,130,246"],
    green: ["#10b981", "#34d399", "16,185,129"],
    orange: ["#f59e0b", "#fbbf24", "245,158,11"],
  };
  function apply(name) {
    const a = ACCENTS[name] || ACCENTS.red;
    const r = document.documentElement.style;
    r.setProperty("--accent", a[0]);
    r.setProperty("--accent2", a[1]);
    r.setProperty("--accent-rgb", a[2]);
    localStorage.setItem("ytgrab_accent", name);
    document.querySelectorAll("#themeBar .swatch").forEach((s) =>
      s.classList.toggle("active", s.dataset.accent === name)
    );
  }
  const saved = localStorage.getItem("ytgrab_accent") || "red";
  apply(saved);
  document.querySelectorAll("#themeBar .swatch").forEach((s) =>
    s.addEventListener("click", () => apply(s.dataset.accent))
  );
})();

// 全域 Toast 通知（其他腳本可呼叫 window.toast）
window.toast = (msg, type = "ok") => {
  const wrap = document.getElementById("toastWrap");
  if (!wrap) return;
  const t = document.createElement("div");
  t.className = "toast toast-" + type;
  t.textContent = msg;
  wrap.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  }, 2600);
};

(() => {
  const $ = (sel) => document.querySelector(sel);
  const socket = io();

  // Elements
  const urlInput = $("#urlInput");
  const clearBtn = $("#clearBtn");
  const fetchBtn = $("#fetchBtn");
  const loadingSection = $("#loadingSection");
  const infoSection = $("#infoSection");
  const progressSection = $("#progressSection");
  const doneSection = $("#doneSection");

  const thumbnail = $("#thumbnail");
  const videoTitle = $("#videoTitle");
  const duration = $("#duration");
  const platformChip = $("#platformChip span");
  const uploader = $("#uploader span");
  const views = $("#views span");
  const qualitySection = $("#qualitySection");
  const qualityOptions = $("#qualityOptions");
  const downloadBtn = $("#downloadBtn");
  const platformStatus = $("#platformStatus");

  const progressBar = $("#progressBar");
  const progressFilename = $("#progressFilename");
  const progressPercent = $("#progressPercent");
  const progressSize = $("#progressSize");
  const progressSpeed = $("#progressSpeed");
  const progressEta = $("#progressEta");
  const logArea = $("#logArea");

  const doneFilename = $("#doneFilename");
  const doneDownloadLink = $("#doneDownloadLink");
  const newDownloadBtn = $("#newDownloadBtn");

  // --- Auth Check ---
  const authOverlay = $("#authOverlay");
  const authInput = $("#authInput");
  const authBtn = $("#authBtn");
  const authError = $("#authError");

  if (localStorage.getItem("ytgrab_auth") === "泥鰍") {
    authOverlay.classList.add("unlocked");
  }

  function checkAuth() {
    if (authInput.value.trim() === "泥鰍") {
      localStorage.setItem("ytgrab_auth", "泥鰍");
      authError.classList.add("hidden");
      authOverlay.classList.add("unlocked");
    } else {
      authError.classList.remove("hidden");
      authInput.value = "";
      authInput.focus();
    }
  }

  authBtn.addEventListener("click", checkAuth);
  authInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") checkAuth();
  });

  let currentMode = "video";
  let currentQuality = null;
  let currentUrl = "";
  let currentPlatform = "";
  let videoFormats = [];

  // --- URL Input ---
  urlInput.addEventListener("input", () => {
    clearBtn.classList.toggle("visible", urlInput.value.length > 0);
    renderPlatformStatus(urlInput.value.trim());
  });

  clearBtn.addEventListener("click", () => {
    urlInput.value = "";
    clearBtn.classList.remove("visible");
    renderPlatformStatus("");
    urlInput.focus();
  });

  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") fetchBtn.click();
  });

  // --- Fetch Info ---
  fetchBtn.addEventListener("click", async () => {
    const url = urlInput.value.trim();
    if (!url) return urlInput.focus();

    const detected = detectPlatform(url);
    if (!detected.supported) {
      renderPlatformStatus(url);
      alert("錯誤：" + detected.message);
      return;
    }

    currentUrl = url;
    showOnly("loading");
    fetchBtn.disabled = true;

    try {
      const res = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      // Populate
      currentPlatform = data.platform || detected.label;
      thumbnail.src = data.thumbnail;
      videoTitle.textContent = data.title;
      duration.textContent = formatDuration(data.duration);
      platformChip.textContent = currentPlatform;
      uploader.textContent = data.uploader || "未知";
      views.textContent = data.view_count
        ? Number(data.view_count).toLocaleString() + " 次觀看"
        : "--";

      // Formats
      videoFormats = data.formats || [];
      renderQuality();

      showOnly("info");
    } catch (err) {
      alert("錯誤：" + (err.message || "無法取得影片資訊"));
      showOnly("input");
    } finally {
      fetchBtn.disabled = false;
    }
  });

  // --- Mode ---
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentMode = btn.dataset.mode;
      qualitySection.classList.toggle("hidden", currentMode === "audio");
    });
  });

  // --- Quality ---
  function renderQuality() {
    qualityOptions.innerHTML = "";
    currentQuality = null;
    const heights = [2160, 1440, 1080, 720, 480, 360];
    const labels = {
      2160: "4K",
      1440: "2K",
      1080: "1080p",
      720: "720p",
      480: "480p",
      360: "360p",
    };

    const available = heights.filter((h) =>
      videoFormats.some((f) => f.height >= h)
    );

    if (available.length === 0) {
      available.push(
        ...new Set(videoFormats.map((f) => f.height).sort((a, b) => b - a))
      );
    }

    if (available.length === 0) {
      const chip = document.createElement("button");
      chip.className = "quality-chip active";
      chip.textContent = "最佳";
      chip.dataset.quality = "";
      currentQuality = null;
      qualityOptions.appendChild(chip);
      return;
    }

    available.forEach((h, i) => {
      const chip = document.createElement("button");
      chip.className = "quality-chip" + (i === 0 ? " active" : "");
      chip.textContent = labels[h] || `${h}p`;
      chip.dataset.quality = h;
      if (i === 0) currentQuality = h;

      chip.addEventListener("click", () => {
        document
          .querySelectorAll(".quality-chip")
          .forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        currentQuality = h;
      });

      qualityOptions.appendChild(chip);
    });

    // 套用設定的預設畫質（若該畫質可選）
    const sv = window.ytgrabSettings ? window.ytgrabSettings() : null;
    if (sv && sv.dlQuality !== undefined) {
      const want = String(sv.dlQuality);
      const chips = [...qualityOptions.querySelectorAll(".quality-chip")];
      const match = chips.find((c) => c.dataset.quality === want);
      if (match) {
        chips.forEach((c) => c.classList.remove("active"));
        match.classList.add("active");
        currentQuality = want === "" ? null : Number(want);
      }
    }
  }

  // --- Download ---
  downloadBtn.addEventListener("click", () => {
    showOnly("progress");
    progressBar.style.width = "0%";
    progressPercent.textContent = "0%";
    progressSize.textContent = "--";
    progressSpeed.textContent = "--";
    progressEta.textContent = "--";
    progressFilename.textContent = `${currentPlatform || "影片"} · ${videoTitle.textContent || "下載中"}`;
    logArea.textContent = "";

    const cs = $("#clipStart");
    const ce = $("#clipEnd");
    socket.emit("download", {
      url: currentUrl,
      mode: currentMode,
      quality: currentMode === "video" ? currentQuality : null,
      title: videoTitle.textContent || "",
      clipStart: cs ? cs.value : "",
      clipEnd: ce ? ce.value : "",
    });
  });

  // --- Socket Events ---
  socket.on("progress", (data) => {
    progressBar.style.width = data.percent + "%";
    progressPercent.textContent = data.percent.toFixed(1) + "%";
    progressSize.textContent = data.size || "--";
    progressSpeed.textContent = data.speed || "--";
    progressEta.textContent = data.eta ? `ETA ${data.eta}` : "--";
  });

  socket.on("log", (text) => {
    logArea.textContent += text;
    logArea.scrollTop = logArea.scrollHeight;
  });

  socket.on("done", (data) => {
    showOnly("done");
    doneFilename.textContent = data.filename;
    doneDownloadLink.href = data.downloadUrl;
    if (window.loadDownloads) window.loadDownloads();
  });

  socket.on("error", (msg) => {
    alert("下載失敗：" + msg);
    showOnly("info");
  });

  socket.on("cancelled", () => {
    showOnly("info");
    if (window.toast) window.toast("已取消下載");
  });

  $("#cancelDownloadBtn").addEventListener("click", () => socket.emit("cancel"));

  // --- New Download ---
  newDownloadBtn.addEventListener("click", () => {
    urlInput.value = "";
    clearBtn.classList.remove("visible");
    const cs = $("#clipStart");
    const ce = $("#clipEnd");
    if (cs) cs.value = "";
    if (ce) ce.value = "";
    renderPlatformStatus("");
    showOnly("input");
    urlInput.focus();
  });

  // --- Helpers ---
  function showOnly(section) {
    const map = {
      input: [true, false, false, false, false],
      loading: [true, true, false, false, false],
      info: [true, false, true, false, false],
      progress: [true, false, false, true, false],
      done: [true, false, false, false, true],
    };
    const sections = [
      $("#inputSection"),
      loadingSection,
      infoSection,
      progressSection,
      doneSection,
    ];
    const vis = map[section];
    sections.forEach((s, i) => s.classList.toggle("hidden", !vis[i]));
  }

  function formatDuration(seconds) {
    if (!seconds) return "--:--";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function detectPlatform(rawUrl) {
    if (!rawUrl) {
      return {
        label: "等待連結",
        supported: true,
        tone: "neutral",
        message: "支援 YouTube、Facebook Reels、Instagram Reels / 單篇影片。Threads 目前暫不支援。",
      };
    }

    let host = "";
    try {
      host = new URL(rawUrl).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return {
        label: "網址格式錯誤",
        supported: false,
        tone: "bad",
        message: "請貼上完整網址，例如 https://www.facebook.com/reel/...",
      };
    }

    if (host.includes("threads.net")) {
      return {
        label: "Threads",
        supported: false,
        tone: "bad",
        message: "Threads 目前不穩定，先列為暫不支援。",
      };
    }

    if (host.includes("youtube.com") || host.includes("youtu.be")) {
      return { label: "YouTube", supported: true, tone: "good", message: "支援 YouTube 影片與 Shorts。" };
    }

    if (host.includes("facebook.com") || host.includes("fb.watch")) {
      return { label: "Facebook", supported: true, tone: "good", message: "支援 Facebook Reels 與公開影片。" };
    }

    if (host.includes("instagram.com")) {
      return { label: "Instagram", supported: true, tone: "good", message: "支援 Instagram Reels 與公開單篇影片。" };
    }

    return {
      label: "未支援平台",
      supported: false,
      tone: "bad",
      message: "目前支援 YouTube、Facebook Reels、Instagram Reels / 單篇影片。",
    };
  }

  function renderPlatformStatus(rawUrl) {
    const detected = detectPlatform(rawUrl);
    platformStatus.classList.remove("status-good", "status-bad", "status-neutral");
    platformStatus.classList.add(`status-${detected.tone}`);
    platformStatus.querySelector("span:last-child").textContent = `${detected.label}：${detected.message}`;
  }

  renderPlatformStatus("");
})();
