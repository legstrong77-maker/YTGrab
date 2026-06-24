(() => {
  const $ = (s) => document.querySelector(s);
  const socket = io(); // 工具箱專用 socket

  const sourceSel = $("#tbSource");
  let op = "convert";
  const sub = { format: "mp4", quality: "medium", scale: "keep", fit: "blur", dir: "cw", rate: "2", pos: "bottom", color: "white" };
  const ALL_OPS = ["convert", "compress", "gif", "thumb", "normalize", "vertical", "rotate", "speed", "sheet", "split", "merge", "fade", "vocal", "audioclip", "watermark"];

  // ---- 載入下載紀錄當來源 ----
  async function loadSources() {
    try {
      const r = await fetch("/api/downloads", { cache: "no-store" });
      const d = r.ok ? await r.json() : [];
      const vids = d.filter((x) => x.ext && /\.(mp4|mkv|webm|mov|avi|m4v)$/i.test(x.ext));
      if (!vids.length) {
        sourceSel.innerHTML = '<option value="">（尚無可處理的影片，請先到「影片下載」下載）</option>';
        mergeList.innerHTML = '<p class="ts-hint" style="margin:0">尚無可合併的影片。</p>';
      } else {
        sourceSel.innerHTML = vids
          .map((x) => `<option value="${x.id}">${escAttr(x.title || x.filename)}</option>`)
          .join("");
        mergeList.innerHTML = vids
          .map((x) => `<label class="merge-item"><input type="checkbox" value="${x.id}" /><span>${escAttr(x.title || x.filename)}</span></label>`)
          .join("");
      }
    } catch {
      sourceSel.innerHTML = '<option value="">（無法連線下載伺服器）</option>';
    }
  }
  const mergeList = $("#tbMergeList");
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
      ALL_OPS.forEach((o) => $("#tbp-" + o).classList.toggle("hidden", o !== op));
      $("#tbSingleSource").classList.toggle("hidden", op === "merge");
    })
  );

  // ---- 子選項 ----
  segGroup("#tbFmt", "fmt", (v) => (sub.format = v));
  segGroup("#tbQ", "q", (v) => (sub.quality = v));
  segGroup("#tbScale", "scale", (v) => (sub.scale = v));
  segGroup("#tbFit", "fit", (v) => (sub.fit = v));
  segGroup("#tbDir", "dir", (v) => (sub.dir = v));
  segGroup("#tbRate", "rate", (v) => (sub.rate = v));
  segGroup("#tbWmPos", "pos", (v) => (sub.pos = v));
  segGroup("#tbWmColor", "color", (v) => (sub.color = v));
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
  const opLabel = {
    convert: "轉檔", compress: "壓縮", gif: "製作 GIF", thumb: "擷取縮圖",
    normalize: "音量正規化", vertical: "轉直式", rotate: "旋轉", speed: "變速",
    sheet: "產生九宮格", split: "章節切割", merge: "合併影片",
    fade: "淡入淡出", vocal: "去人聲", audioclip: "擷取音訊片段", watermark: "加浮水印",
  };

  // ---- 影片資訊（ffprobe）----
  $("#tbProbe").addEventListener("click", async () => {
    const id = sourceSel.value;
    const info = $("#tbInfo");
    if (!id) return showErr("請先選擇一個來源影片");
    info.classList.remove("hidden");
    info.innerHTML = "讀取中…";
    try {
      const r = await fetch("/api/probe/" + id, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw 0;
      const v = (d.streams || []).find((s) => s.codec_type === "video") || {};
      const a = (d.streams || []).find((s) => s.codec_type === "audio") || {};
      const f = d.format || {};
      const dur = f.duration ? fmtDur(parseFloat(f.duration)) : "?";
      const mb = f.size ? (f.size / 1048576).toFixed(1) + " MB" : "?";
      const br = f.bit_rate ? Math.round(f.bit_rate / 1000) + " kbps" : "?";
      let fps = "?";
      if (v.r_frame_rate) {
        const [n, d] = v.r_frame_rate.split("/").map(Number);
        fps = (d ? n / d : n || 0).toFixed(0);
      }
      info.innerHTML = `
        <div class="tb-info-grid">
          <div><b>解析度</b>${v.width || "?"}×${v.height || "?"}</div>
          <div><b>影像編碼</b>${v.codec_name || "—"}</div>
          <div><b>FPS</b>${fps}</div>
          <div><b>時長</b>${dur}</div>
          <div><b>音訊</b>${a.codec_name || "無"}${a.channels ? " · " + a.channels + "ch" : ""}</div>
          <div><b>總位元率</b>${br}</div>
          <div><b>檔案大小</b>${mb}</div>
        </div>`;
    } catch {
      info.innerHTML = '<span style="color:#ff9bb4">讀取資訊失敗</span>';
    }
  });
  function fmtDur(s) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60);
    return (h ? h + ":" : "") + String(m).padStart(h ? 2 : 1, "0") + ":" + String(x).padStart(2, "0");
  }

  go.addEventListener("click", () => {
    err.classList.add("hidden");

    // 合併：用勾選的多個來源
    if (op === "merge") {
      const ids = [...mergeList.querySelectorAll("input:checked")].map((c) => c.value);
      if (ids.length < 2) return showErr("請至少勾選 2 支影片");
      startProgress(true);
      socket.emit("merge", { sourceIds: ids });
      return;
    }

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
    } else if (op === "vertical") {
      params.fit = sub.fit;
    } else if (op === "rotate") {
      params.dir = sub.dir;
    } else if (op === "speed") {
      params.rate = sub.rate;
    } else if (op === "split") {
      params.segLen = $("#tbSegLen").value;
    } else if (op === "fade") {
      params.dur = $("#tbFadeDur").value;
    } else if (op === "audioclip") {
      params.start = $("#tbAcStart").value;
      params.end = $("#tbAcEnd").value;
    } else if (op === "watermark") {
      const text = $("#tbWmText").value.trim();
      if (!text) return showErr("請先輸入浮水印文字");
      params.text = text;
      params.pos = sub.pos;
      params.color = sub.color;
      params.size = $("#tbWmSize").value;
    }

    startProgress(["compress", "vertical", "rotate", "speed", "fade", "watermark"].includes(op));
    socket.emit("tool", { sourceId, op, params });
  });

  function startProgress(heavy) {
    go.disabled = true;
    result.classList.add("hidden");
    prog.classList.remove("hidden");
    bar.style.width = "5%";
    stage.textContent = (opLabel[op] || "處理") + "中…" + (heavy ? "（重新編碼，可能需要一些時間）" : "");
  }

  socket.on("tool-progress", (d) => {
    bar.style.width = Math.max(5, d.percent || 0) + "%";
  });
  socket.on("tool-done", (d) => {
    go.disabled = false;
    prog.classList.add("hidden");
    $("#tbResultName").textContent = d.filename;
    // 多檔（章節切割）：不給單一下載鍵，導去下載紀錄
    $("#tbDownload").classList.toggle("hidden", !!d.multi);
    if (!d.multi) $("#tbDownload").href = d.downloadUrl;
    result.classList.remove("hidden");
    result.scrollIntoView({ behavior: "smooth", block: "center" });
    window.toast(d.multi ? `已產生 ${d.count} 段` : "處理完成");
    if (window.loadDownloads) window.loadDownloads();
    loadSources();
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
