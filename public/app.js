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
  const uploader = $("#uploader span");
  const views = $("#views span");
  const qualitySection = $("#qualitySection");
  const qualityOptions = $("#qualityOptions");
  const downloadBtn = $("#downloadBtn");

  const progressBar = $("#progressBar");
  const progressPercent = $("#progressPercent");
  const progressSize = $("#progressSize");
  const progressSpeed = $("#progressSpeed");
  const progressEta = $("#progressEta");
  const logArea = $("#logArea");

  const doneFilename = $("#doneFilename");
  const doneDownloadLink = $("#doneDownloadLink");
  const newDownloadBtn = $("#newDownloadBtn");

  let currentMode = "video";
  let currentQuality = null;
  let currentUrl = "";
  let videoFormats = [];

  // --- URL Input ---
  urlInput.addEventListener("input", () => {
    clearBtn.classList.toggle("visible", urlInput.value.length > 0);
  });

  clearBtn.addEventListener("click", () => {
    urlInput.value = "";
    clearBtn.classList.remove("visible");
    urlInput.focus();
  });

  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") fetchBtn.click();
  });

  // --- Fetch Info ---
  fetchBtn.addEventListener("click", async () => {
    const url = urlInput.value.trim();
    if (!url) return urlInput.focus();

    currentUrl = url;
    showOnly("loading");
    fetchBtn.disabled = true;

    try {
      const res = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      // Populate
      thumbnail.src = data.thumbnail;
      videoTitle.textContent = data.title;
      duration.textContent = formatDuration(data.duration);
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
  }

  // --- Download ---
  downloadBtn.addEventListener("click", () => {
    showOnly("progress");
    progressBar.style.width = "0%";
    progressPercent.textContent = "0%";
    progressSize.textContent = "--";
    progressSpeed.textContent = "--";
    progressEta.textContent = "--";
    logArea.textContent = "";

    socket.emit("download", {
      url: currentUrl,
      mode: currentMode,
      quality: currentMode === "video" ? currentQuality : null,
      title: videoTitle.textContent || "",
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
  });

  socket.on("error", (msg) => {
    alert("下載失敗：" + msg);
    showOnly("info");
  });

  // --- New Download ---
  newDownloadBtn.addEventListener("click", () => {
    urlInput.value = "";
    clearBtn.classList.remove("visible");
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
})();
