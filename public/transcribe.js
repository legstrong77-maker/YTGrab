(() => {
  // 逐字稿後端（Python / FastAPI），與下載器分屬不同 port
  const API = "http://localhost:8001";
  const $ = (s) => document.querySelector(s);

  // ---- 工具分頁切換 ----
  const toolTabs = document.querySelectorAll(".tool-tab");
  const views = {
    download: $("#view-download"),
    transcribe: $("#view-transcribe"),
    subtitle: $("#view-subtitle"),
    toolbox: $("#view-toolbox"),
  };
  toolTabs.forEach((t) =>
    t.addEventListener("click", () => {
      toolTabs.forEach((x) => x.classList.toggle("active", x === t));
      const v = t.dataset.view;
      Object.entries(views).forEach(([k, el]) =>
        el.classList.toggle("active", k === v)
      );
      if (v === "transcribe") {
        checkHealth();
        loadHistory();
      } else if (v === "download" && window.loadDownloads) {
        window.loadDownloads();
      } else if (v === "subtitle" && window.loadBurnHistory) {
        window.loadBurnHistory();
      } else if (v === "toolbox" && window.loadToolboxSources) {
        window.loadToolboxSources();
      }
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

  // ---- 檔案拖放（可多選）----
  let files = [];
  const drop = $("#tsDrop");
  const fileInput = $("#tsFile");
  const fileNameEl = $("#tsFileName");
  drop.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => setFiles(fileInput.files));
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
  drop.addEventListener("drop", (ev) => setFiles(ev.dataTransfer.files));
  function setFiles(list) {
    files = Array.from(list || []);
    if (!files.length) {
      fileNameEl.textContent = "";
    } else if (files.length === 1) {
      fileNameEl.textContent = "已選擇：" + files[0].name;
    } else {
      fileNameEl.textContent = `已選擇 ${files.length} 個檔案：` + files.map((f) => f.name).join("、");
    }
  }

  // ---- 批次處理 ----
  const go = $("#tsGo");
  const prog = $("#tsProg");
  const bar = $("#tsBar");
  const stage = $("#tsStage");
  const batchLine = $("#tsBatchLine");
  const err = $("#tsErr");
  const resultCard = $("#tsResultCard");
  const batchList = $("#tsBatchList");
  const dlAllTxt = $("#tsDlAllTxt");
  const dlAllSrt = $("#tsDlAllSrt");

  let doneJobIds = []; // 完成的 job_id，供打包下載

  go.addEventListener("click", async () => {
    hideErr();

    // 1) 收集這批要處理的項目
    let items = [];
    if (src === "url") {
      const lines = $("#tsUrl").value
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!lines.length) return showErr("請先貼上至少一個網址");
      items = lines.map((u) => ({ kind: "url", value: u, label: u }));
    } else {
      if (!files.length) return showErr("請先選擇至少一個檔案");
      items = files.map((f) => ({ kind: "file", value: f, label: f.name }));
    }

    // 2) 準備 UI
    go.disabled = true;
    doneJobIds = [];
    batchList.innerHTML = "";
    resultCard.classList.remove("hidden");
    updateBatchDownloadButtons();
    const rows = items.map((it, i) => makeRow(it, i));

    // 3) 依序處理
    prog.classList.remove("hidden");
    for (let i = 0; i < items.length; i++) {
      batchLine.textContent = `整批進度 ${i + 1} / ${items.length}`;
      bar.style.width = "0%";
      stage.textContent = "送出中…";
      setRowState(rows[i], "running", "處理中…");
      try {
        const jobId = await submitJob(items[i]);
        const res = await pollJob(jobId, rows[i]);
        finishRow(rows[i], jobId, res);
        doneJobIds.push(jobId);
        updateBatchDownloadButtons();
      } catch (e) {
        setRowState(rows[i], "error", connErr(e));
      }
    }

    // 4) 收尾
    prog.classList.add("hidden");
    go.disabled = false;
    batchLine.textContent = "";
    if (!doneJobIds.length) showErr("這批全部失敗了，請檢查網址或伺服器狀態。");
    else window.toast(`完成 ${doneJobIds.length} 份逐字稿`);
    loadHistory();
  });

  function submitJob(item) {
    const fd = new FormData();
    fd.append("mode", item.kind);
    fd.append("prefer_subs", $("#tsPreferSubs").checked ? "1" : "0");
    if (item.kind === "url") fd.append("url", item.value);
    else fd.append("file", item.value);
    return fetch(API + "/api/job", { method: "POST", body: fd }).then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || "送出失敗");
      return j.job_id;
    });
  }

  function pollJob(jobId, row) {
    return new Promise((resolve, reject) => {
      const t = setInterval(async () => {
        try {
          const r = await fetch(API + "/api/status/" + jobId, { cache: "no-store" });
          if (!r.ok) return;
          const j = await r.json();
          const pct = Math.round((j.progress || 0) * 100);
          bar.style.width = pct + "%";
          stage.textContent = j.stage || "";
          setRowStatusText(row, j.stage || "處理中…");
          if (j.state === "done") {
            clearInterval(t);
            resolve(j);
          } else if (j.state === "error") {
            clearInterval(t);
            reject(new Error(j.error || "辨識失敗"));
          }
        } catch (e) {
          clearInterval(t);
          reject(e);
        }
      }, 1500);
    });
  }

  // ---- 批次列表 row ----
  function makeRow(item, idx) {
    const row = document.createElement("div");
    row.className = "ts-item";
    row.innerHTML = `
      <div class="ts-item-head">
        <span class="ts-item-status badge-queued">排隊中</span>
        <span class="ts-item-title"></span>
        <div class="ts-item-actions"></div>
      </div>
      <textarea class="ts-item-text hidden" readonly></textarea>`;
    row.querySelector(".ts-item-title").textContent = `${idx + 1}. ${item.label}`;
    batchList.appendChild(row);
    return row;
  }

  function setRowState(row, state, statusText) {
    const badge = row.querySelector(".ts-item-status");
    badge.className = "ts-item-status";
    if (state === "running") badge.classList.add("badge-running");
    else if (state === "done") badge.classList.add("badge-done");
    else if (state === "error") badge.classList.add("badge-error");
    else badge.classList.add("badge-queued");
    badge.textContent =
      state === "running" ? "處理中" : state === "done" ? "完成" : state === "error" ? "失敗" : "排隊中";
    if (statusText) setRowStatusText(row, statusText, state === "error");
  }

  function setRowStatusText(row, text, isErr) {
    let el = row.querySelector(".ts-item-sub");
    if (!el) {
      el = document.createElement("span");
      el.className = "ts-item-sub";
      row.querySelector(".ts-item-head").appendChild(el);
    }
    el.textContent = text;
    el.classList.toggle("is-err", !!isErr);
  }

  function finishRow(row, jobId, j) {
    setRowState(row, "done");
    const title = j.title ? j.title : "";
    if (title) row.querySelector(".ts-item-title").textContent =
      row.querySelector(".ts-item-title").textContent.replace(/\..*$/, "") + ". " + title;
    // 來源標記：現成字幕 / AI 辨識
    const badge = row.querySelector(".ts-item-status");
    if (j.source === "subs") {
      badge.classList.add("badge-subs");
      badge.textContent = "⚡ 現成字幕";
    } else {
      badge.textContent = "🎙 AI 辨識";
    }
    setRowStatusText(row, "");
    const ta = row.querySelector(".ts-item-text");
    ta.value = j.text || "(沒有辨識到內容)";
    const actions = row.querySelector(".ts-item-actions");
    actions.innerHTML = "";
    const mk = (label, fn) => {
      const b = document.createElement("button");
      b.className = "btn btn-ghost ts-mini";
      b.textContent = label;
      b.addEventListener("click", fn);
      actions.appendChild(b);
      return b;
    };
    const toggle = mk("展開", () => {
      const hidden = ta.classList.toggle("hidden");
      toggle.textContent = hidden ? "展開" : "收合";
    });
    mk("📋", () => {
      navigator.clipboard.writeText(ta.value);
      flash(row);
      window.toast("已複製");
    });
    mk("⬇ .txt", () => downloadOne(jobId, "txt"));
    mk("⬇ .srt", () => downloadOne(jobId, "srt"));
  }

  function flash(row) {
    row.classList.add("ts-flash");
    setTimeout(() => row.classList.remove("ts-flash"), 600);
  }

  // ---- 下載 ----
  function updateBatchDownloadButtons() {
    const has = doneJobIds.length > 0;
    dlAllTxt.disabled = !has;
    dlAllSrt.disabled = !has;
    dlAllTxt.textContent = has ? `⬇ 全部 .txt (ZIP·${doneJobIds.length})` : "⬇ 全部 .txt (ZIP)";
    dlAllSrt.textContent = has ? `⬇ 全部 .srt (ZIP·${doneJobIds.length})` : "⬇ 全部 .srt (ZIP)";
  }

  dlAllTxt.addEventListener("click", () => downloadZip("txt"));
  dlAllSrt.addEventListener("click", () => downloadZip("srt"));

  $("#tsCopyAll").addEventListener("click", () => {
    const parts = [];
    batchList.querySelectorAll(".ts-item").forEach((row) => {
      const ta = row.querySelector(".ts-item-text");
      if (ta && ta.value.trim()) {
        const title = row.querySelector(".ts-item-title").textContent.trim();
        parts.push(`【${title}】\n${ta.value.trim()}`);
      }
    });
    if (!parts.length) return showErr("目前沒有可複製的逐字稿。");
    navigator.clipboard.writeText(parts.join("\n\n──────────\n\n"));
    const b = $("#tsCopyAll");
    const t = b.textContent;
    b.textContent = "✓ 已複製全部";
    setTimeout(() => (b.textContent = t), 1500);
  });

  async function downloadZip(fmt) {
    if (!doneJobIds.length) return;
    const url = `${API}/api/download_zip?ids=${doneJobIds.join(",")}&fmt=${fmt}`;
    try {
      const r = await fetch(url);
      if (!r.ok) throw 0;
      const blob = await r.blob();
      triggerDownload(blob, `逐字稿_${fmt}.zip`);
    } catch {
      showErr("打包下載失敗，請重試。");
    }
  }

  async function downloadOne(jobId, fmt) {
    try {
      const r = await fetch(`${API}/api/download/${jobId}/${fmt}`);
      if (!r.ok) throw 0;
      const blob = await r.blob();
      const cd = r.headers.get("content-disposition") || "";
      const m = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i);
      const name = m ? decodeURIComponent(m[1]) : `transcript.${fmt}`;
      triggerDownload(blob, name);
    } catch {
      showErr("下載失敗，請稍後重試。");
    }
  }

  function triggerDownload(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  // ---- 錯誤 / 工具 ----
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

  // ---- 歷史紀錄 ----
  const histList = $("#tsHistList");
  const histCount = $("#tsHistCount");
  const histEmpty = $("#tsHistEmpty");
  const histSearch = $("#tsHistSearch");
  let histData = [];

  async function loadHistory() {
    try {
      const r = await fetch(API + "/api/history", { cache: "no-store" });
      histData = r.ok ? await r.json() : [];
    } catch {
      histData = [];
    }
    renderHistory();
  }

  function renderHistory() {
    const q = (histSearch.value || "").trim().toLowerCase();
    const items = histData.filter((r) => !q || (r.title || "").toLowerCase().includes(q));
    histCount.textContent = histData.length ? `${histData.length} 筆紀錄` : "尚無紀錄";
    histEmpty.classList.toggle("hidden", histData.length > 0);
    histList.innerHTML = "";
    items.forEach((r) => histList.appendChild(makeHistRow(r)));
  }

  function makeHistRow(r, q) {
    const row = document.createElement("div");
    row.className = "ts-item hist-item";
    const badge =
      r.source === "subs"
        ? '<span class="ts-item-status badge-subs">⚡ 現成字幕</span>'
        : '<span class="ts-item-status badge-done">🎙 AI 辨識</span>';
    row.innerHTML = `
      <div class="ts-item-head">
        ${badge}
        <span class="ts-item-title"></span>
        <span class="hist-meta"></span>
        <div class="ts-item-actions"></div>
      </div>
      <textarea class="ts-item-text hidden" readonly></textarea>`;
    row.querySelector(".ts-item-title").textContent = r.title || r.id;
    row.querySelector(".hist-meta").textContent =
      relTime(r.ts) + " · " + (r.chars || 0) + " 字";
    const ta = row.querySelector(".ts-item-text");
    const actions = row.querySelector(".ts-item-actions");
    const mk = (label, fn) => {
      const b = document.createElement("button");
      b.className = "btn btn-ghost ts-mini";
      b.textContent = label;
      b.addEventListener("click", fn);
      actions.appendChild(b);
      return b;
    };
    async function ensureText() {
      if (ta.value) return true;
      try {
        const res = await fetch(`${API}/api/result/${r.id}`);
        ta.value = (await res.json()).text || "(空)";
        return true;
      } catch {
        window.toast("讀取失敗", "err");
        return false;
      }
    }
    const viewBtn = mk("👁 重看", async () => {
      if (!ta.classList.contains("hidden")) {
        ta.classList.add("hidden");
        viewBtn.textContent = "👁 重看";
        return;
      }
      if (await ensureText()) {
        ta.classList.remove("hidden");
        viewBtn.textContent = "收合";
      }
    });
    mk("📋", async () => {
      if (await ensureText()) {
        navigator.clipboard.writeText(ta.value);
        window.toast("已複製逐字稿");
      }
    });
    mk("⬇ .txt", () => downloadOne(r.id, "txt"));
    mk("⬇ .srt", () => downloadOne(r.id, "srt"));
    mk("🗑", async () => {
      if (!confirm(`確定刪除「${r.title || r.id}」這筆逐字稿？`)) return;
      try {
        await fetch(`${API}/api/result/${r.id}`, { method: "DELETE" });
        histData = histData.filter((x) => x.id !== r.id);
        renderHistory();
        window.toast("已刪除");
      } catch {
        window.toast("刪除失敗", "err");
      }
    });
    if (r.snippet) {
      const sn = document.createElement("div");
      sn.className = "hist-snippet";
      sn.innerHTML = highlight(r.snippet, q);
      row.querySelector(".ts-item-text").before(sn);
    }
    return row;
  }

  function esc(s) {
    return (s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }
  function highlight(text, q) {
    const e = esc(text);
    if (!q) return e;
    const i = e.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return e;
    return e.slice(0, i) + "<mark>" + e.slice(i, i + q.length) + "</mark>" + e.slice(i + q.length);
  }

  function relTime(ts) {
    if (!ts) return "";
    const s = Math.floor(Date.now() / 1000 - ts);
    if (s < 60) return "剛剛";
    if (s < 3600) return Math.floor(s / 60) + " 分鐘前";
    if (s < 86400) return Math.floor(s / 3600) + " 小時前";
    return Math.floor(s / 86400) + " 天前";
  }

  let searchTimer = null;
  histSearch.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(doHistSearch, 280);
  });
  async function doHistSearch() {
    const q = histSearch.value.trim();
    if (!q) {
      renderHistory();
      return;
    }
    let res = [];
    try {
      const r = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      res = r.ok ? await r.json() : [];
    } catch {
      res = [];
    }
    histCount.textContent = `搜尋到 ${res.length} 筆`;
    histEmpty.classList.add("hidden");
    histList.innerHTML = "";
    if (!res.length) {
      histList.innerHTML = '<p class="hist-empty">找不到符合「' + esc(q) + '」的逐字稿。</p>';
      return;
    }
    res.forEach((r) => histList.appendChild(makeHistRow(r, q)));
  }
  $("#tsHistRefresh").addEventListener("click", () => {
    histSearch.value = "";
    loadHistory();
    window.toast("已重新整理");
  });
  $("#tsHistClear").addEventListener("click", async () => {
    if (!histData.length) return;
    if (!confirm("清空所有逐字稿歷史紀錄？（會一併刪除這些檔案，無法復原）")) return;
    try {
      await fetch(`${API}/api/history`, { method: "DELETE" });
      histData = [];
      histSearch.value = "";
      renderHistory();
      window.toast("已清空歷史紀錄");
    } catch {
      window.toast("清空失敗", "err");
    }
  });

  // ---- 貼上剪貼簿 ----
  $("#tsPaste").addEventListener("click", async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t) return;
      const box = $("#tsUrl");
      box.value = box.value && !box.value.endsWith("\n") ? box.value + "\n" + t : box.value + t;
      box.focus();
    } catch {
      showErr("無法讀取剪貼簿，請直接用 Ctrl+V 貼上。");
    }
  });

  // ---- 展開播放清單 ----
  $("#tsExpand").addEventListener("click", () => {
    if (window.expandPlaylist) window.expandPlaylist($("#tsUrl"), $("#tsExpand"));
  });

  // ---- Ctrl/Cmd+Enter 送出 ----
  $("#tsUrl").addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      go.click();
    }
  });

  // ---- 整頁拖曳上傳 → 自動切到逐字稿檔案模式 ----
  // （字幕分頁有自己的拖放區，故該分頁停用整頁攔截；用 timeout 收起遮罩較穩）
  const dropOverlay = $("#dropOverlay");
  let dragTimer = null;
  const hasFiles = (e) =>
    e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
  window.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    if (views.subtitle.classList.contains("active")) return;
    e.preventDefault();
    dropOverlay.classList.add("show");
    clearTimeout(dragTimer);
    dragTimer = setTimeout(() => dropOverlay.classList.remove("show"), 160);
  });
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    dropOverlay.classList.remove("show");
    if (views.subtitle.classList.contains("active")) return;
    e.preventDefault();
    const fl = e.dataTransfer.files;
    if (!fl || !fl.length) return;
    document.querySelector('.tool-tab[data-view="transcribe"]').click();
    document.querySelector('.ts-source .mode-btn[data-src="file"]').click();
    setFiles(fl);
    window.toast(`已加入 ${fl.length} 個檔案，按「開始轉逐字稿」`);
  });

  updateBatchDownloadButtons();
})();
