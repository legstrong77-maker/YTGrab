(() => {
  const $ = (s) => document.querySelector(s);
  const socket = io(); // 工具箱專用 socket

  const sourceSel = $("#tbSource");
  let op = "convert";
  const sub = { format: "mp4", quality: "medium", scale: "keep" };

  // ---- 載入下載紀錄當來源 ----
  async function loadSources() {
    try {
      const r = await fetch("/api/downloads", { cache: "no-store" });
      const d = r.ok ? await r.json() : [];
      const vids = d.filter((x) => x.ext && /\.(mp4|mkv|webm|mov|avi|m4v)$/i.test(x.ext));
      if (!vids.length) {
        sourceSel.innerHTML = '<option value="">（尚無可處理的影片，請先到「影片下載」下載）</option>';
      } else {
        sourceSel.innerHTML = vids
          .map((x) => `<option value="${x.id}">${escAttr(x.title || x.filename)}</option>`)
          .join("");
      }
    } catch {
      sourceSel.innerHTML = '<option value="">（無法連線下載伺服器）</option>';
    }
  }
  window.loadToolboxSources = loadSources;
  function escAttr(s) {
    return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  $("#tbRefresh").addEventListener("click", () => {
    loadSources();
    window.toast("已重新整理");
  });

  // ---- 操作切換 ----
  document.querySelectorAll("#tbOps .bd-seg").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("#tbOps .bd-seg").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      op = b.dataset.op;
      ["convert", "compress", "gif", "thumb"].forEach((o) =>
        $("#tbp-" + o).classList.toggle("hidden", o !== op)
      );
    })
  );

  // ---- 子選項 ----
  segGroup("#tbFmt", "fmt", (v) => (sub.format = v));
  segGroup("#tbQ", "q", (v) => (sub.quality = v));
  segGroup("#tbScale", "scale", (v) => (sub.scale = v));
  function segGroup(sel, attr, set) {
    document.querySelectorAll(sel + " .bd-seg").forEach((b) =>
      b.addEventListener("click", () => {
        document.querySelectorAll(sel + " .bd-seg").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        set(b.dataset[attr]);
      })
    );
  }

  // ---- 送出 ----
  const go = $("#tbGo");
  const prog = $("#tbProg");
  const bar = $("#tbBar");
  const stage = $("#tbStage");
  const err = $("#tbErr");
  const result = $("#tbResult");
  const opLabel = { convert: "轉檔", compress: "壓縮", gif: "製作 GIF", thumb: "擷取縮圖" };

  go.addEventListener("click", () => {
    err.classList.add("hidden");
    const sourceId = sourceSel.value;
    if (!sourceId) return showErr("請先選擇一個來源影片");

    const params = {};
    if (op === "convert") params.format = sub.format;
    else if (op === "compress") {
      params.quality = sub.quality;
      params.scale = sub.scale;
    } else if (op === "gif") {
      params.start = $("#tbGifStart").value;
      params.end = $("#tbGifEnd").value;
      params.fps = $("#tbGifFps").value;
      params.width = $("#tbGifW").value;
    } else if (op === "thumb") {
      params.time = $("#tbThumbTime").value;
    }

    go.disabled = true;
    result.classList.add("hidden");
    prog.classList.remove("hidden");
    bar.style.width = "5%";
    stage.textContent = opLabel[op] + "中…" + (op === "compress" ? "（重新編碼，可能需要一些時間）" : "");

    socket.emit("tool", { sourceId, op, params });
  });

  socket.on("tool-progress", (d) => {
    bar.style.width = Math.max(5, d.percent || 0) + "%";
  });
  socket.on("tool-done", (d) => {
    go.disabled = false;
    prog.classList.add("hidden");
    $("#tbResultName").textContent = d.filename;
    $("#tbDownload").href = d.downloadUrl;
    result.classList.remove("hidden");
    result.scrollIntoView({ behavior: "smooth", block: "center" });
    window.toast("處理完成");
    if (window.loadDownloads) window.loadDownloads();
  });
  socket.on("tool-error", (msg) => {
    go.disabled = false;
    prog.classList.add("hidden");
    showErr(typeof msg === "string" ? msg : "處理失敗");
  });

  function showErr(m) {
    err.textContent = m;
    err.classList.remove("hidden");
  }

  $("#tbAgain").addEventListener("click", () => {
    result.classList.add("hidden");
    loadSources();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  loadSources();
})();
