(() => {
  // 逐字稿後端（Python / FastAPI），與下載器分屬不同 port
  const API = "http://localhost:8001";
  const $ = (s) => document.querySelector(s);

  // ---- 工具分頁切換 ----
  const toolTabs = document.querySelectorAll(".tool-tab");
  const views = { download: $("#view-download"), transcribe: $("#view-transcribe") };
  toolTabs.forEach((t) =>
    t.addEventListener("click", () => {
      toolTabs.forEach((x) => x.classList.toggle("active", x === t));
      const v = t.dataset.view;
      Object.entries(views).forEach(([k, el]) =>
        el.classList.toggle("active", k === v)
      );
      if (v === "transcribe") checkHealth();
      window.scrollTo({ top: 0, behavior: "smooth" });
    })
  );

  // ---- 伺服器狀態偵測 ----
  const statusCard = $("#tsStatus");
  const statusText = $("#tsStatusText");
  async function checkHealth() {
    statusCard.classList.remove("online", "offline");
    statusText.textContent = "正在連線逐字稿伺服器…";
    try {
      const r = await fetch(API + "/api/health", { cache: "no-store" });
      if (!r.ok) throw 0;
      const j = await r.json();
      statusCard.classList.add("online");
      const dev = j.cuda ? "GPU 加速 (CUDA)" : "CPU 模式（較慢）";
      statusText.innerHTML = `逐字稿伺服器運作中 · <strong>${dev}</strong> · 模型 ${j.model}`;
    } catch {
      statusCard.classList.add("offline");
      statusText.innerHTML =
        '逐字稿伺服器尚未啟動。請先雙擊資料夾中的 <strong>啟動逐字稿.bat</strong>，待出現「已啟動」字樣後再回到本頁。';
    }
  }

  // ---- 來源子分頁（網址 / 檔案）----
  let src = "url";
  document.querySelectorAll(".ts-source .mode-btn").forEach((b) =>
    b.addEventListener("click", () => {
      document
        .querySelectorAll(".ts-source .mode-btn")
        .forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      src = b.dataset.src;
      $("#tsPaneUrl").classList.toggle("hidden", src !== "url");
      $("#tsPaneFile").classList.toggle("hidden", src !== "file");
    })
  );

  // ---- 檔案拖放 ----
  let file = null;
  const drop = $("#tsDrop");
  const fileInput = $("#tsFile");
  const fileNameEl = $("#tsFileName");
  drop.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => setFile(fileInput.files[0]));
  ["dragover", "dragenter"].forEach((e) =>
    drop.addEventListener(e, (ev) => {
      ev.preventDefault();
      drop.classList.add("over");
    })
  );
  ["dragleave", "drop"].forEach((e) =>
    drop.addEventListener(e, (ev) => {
      ev.preventDefault();
      drop.classList.remove("over");
    })
  );
  drop.addEventListener("drop", (ev) => setFile(ev.dataTransfer.files[0]));
  function setFile(f) {
    if (!f) return;
    file = f;
    fileNameEl.textContent = "已選擇：" + f.name;
  }

  // ---- 送出工作 + 輪詢進度 ----
  const go = $("#tsGo");
  const prog = $("#tsProg");
  const bar = $("#tsBar");
  const stage = $("#tsStage");
  const err = $("#tsErr");
  const resultCard = $("#tsResultCard");
  const out = $("#tsOut");
  const resTitle = $("#tsResTitle");
  let jobId = null;
  let poll = null;

  go.addEventListener("click", async () => {
    hideErr();
    const fd = new FormData();
    fd.append("mode", src);
    if (src === "url") {
      const u = $("#tsUrl").value.trim();
      if (!u) return showErr("請先貼上影片網址");
      fd.append("url", u);
    } else {
      if (!file) return showErr("請先選擇檔案");
      fd.append("file", file);
    }

    go.disabled = true;
    resultCard.classList.add("hidden");
    prog.classList.remove("hidden");
    bar.style.width = "0%";
    stage.textContent = "送出中…";

    try {
      const r = await fetch(API + "/api/job", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || "送出失敗");
      jobId = j.job_id;
      poll = setInterval(checkStatus, 1500);
    } catch (e) {
      stopWith(connErr(e));
    }
  });

  async function checkStatus() {
    try {
      const r = await fetch(API + "/api/status/" + jobId, { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      bar.style.width = Math.round((j.progress || 0) * 100) + "%";
      stage.textContent = j.stage || "";
      if (j.state === "done") {
        clearInterval(poll);
        go.disabled = false;
        prog.classList.add("hidden");
        resTitle.textContent = "逐字稿" + (j.title ? " — " + j.title : "");
        out.value = j.text || "(沒有辨識到內容)";
        resultCard.classList.remove("hidden");
        resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (j.state === "error") {
        stopWith("錯誤：" + (j.error || "未知"));
      }
    } catch (e) {
      stopWith(connErr(e));
    }
  }

  function stopWith(msg) {
    if (poll) clearInterval(poll);
    go.disabled = false;
    prog.classList.add("hidden");
    showErr(msg);
  }
  function showErr(m) {
    err.textContent = m;
    err.classList.remove("hidden");
  }
  function hideErr() {
    err.textContent = "";
    err.classList.add("hidden");
  }
  function connErr(e) {
    const msg = (e && e.message) || "";
    if (/fetch|network|failed/i.test(msg))
      return "無法連線逐字稿伺服器，請確認已執行 啟動逐字稿.bat 並等待模型載入完成。";
    return msg || "發生未知錯誤";
  }

  // ---- 複製 / 下載 ----
  $("#tsCopy").addEventListener("click", () => {
    navigator.clipboard.writeText(out.value);
    const b = $("#tsCopy");
    const t = b.textContent;
    b.textContent = "✓ 已複製";
    setTimeout(() => (b.textContent = t), 1400);
  });
  $("#tsDlTxt").addEventListener("click", () => downloadResult("txt"));
  $("#tsDlSrt").addEventListener("click", () => downloadResult("srt"));

  async function downloadResult(fmt) {
    if (!jobId) return;
    try {
      const r = await fetch(`${API}/api/download/${jobId}/${fmt}`);
      if (!r.ok) throw 0;
      const blob = await r.blob();
      const cd = r.headers.get("content-disposition") || "";
      const m = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i);
      const name = m ? decodeURIComponent(m[1]) : `transcript.${fmt}`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    } catch {
      showErr("下載失敗，請稍後重試。");
    }
  }
})();
