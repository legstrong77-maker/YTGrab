(() => {
  const $ = (s) => document.querySelector(s);
  const socket = io(); // 批次下載專用 socket（與單一下載流程互不干擾）

  const urlsEl = $("#bdUrls");
  const goBtn = $("#bdGo");
  const listEl = $("#bdList");
  let mode = "video";
  let quality = ""; // "" = 最佳
  let busy = false;

  // 格式切換
  document.querySelectorAll("#bdMode .bd-seg").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("#bdMode .bd-seg").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      mode = b.dataset.mode;
      $("#bdQuality").classList.toggle("bd-disabled", mode === "audio");
    })
  );
  // 畫質切換
  document.querySelectorAll("#bdQuality .bd-seg").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("#bdQuality .bd-seg").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      quality = b.dataset.q;
    })
  );

  goBtn.addEventListener("click", async () => {
    if (busy) return;
    const urls = urlsEl.value.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!urls.length) {
      window.toast("請先貼上至少一個網址", "err");
      return;
    }
    busy = true;
    goBtn.disabled = true;
    listEl.innerHTML = "";
    const rows = urls.map((u, i) => makeRow(u, i));
    for (let i = 0; i < urls.length; i++) {
      await downloadOne(urls[i], rows[i]);
    }
    busy = false;
    goBtn.disabled = false;
  });

  function downloadOne(url, row) {
    return new Promise(async (resolve) => {
      setState(row, "running", "解析中…");
      // 1) 取得標題與縮圖
      let title = "";
      try {
        const r = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
        const d = await r.json();
        if (!r.ok) {
          setState(row, "error", d.error || "解析失敗");
          return resolve();
        }
        title = d.title || "";
        if (d.title) row.querySelector(".ts-item-title").textContent =
          row.dataset.idx + ". " + d.title;
        if (d.thumbnail) setThumb(row, d.thumbnail);
      } catch {
        setState(row, "error", "解析失敗（下載伺服器未啟動？）");
        return resolve();
      }

      // 2) 下載（progress/done/error 只綁這一項，完成後解除）
      const onProg = (data) => {
        setBar(row, data.percent);
        setSub(row, `${(data.percent || 0).toFixed(1)}%　${data.speed || ""}　${data.eta ? "ETA " + data.eta : ""}`);
      };
      const onDone = (data) => {
        cleanup();
        setBar(row, 100);
        setState(row, "done");
        addDoneLink(row, data);
        resolve();
      };
      const onErr = (msg) => {
        cleanup();
        setState(row, "error", typeof msg === "string" ? msg : "下載失敗");
        resolve();
      };
      function cleanup() {
        socket.off("progress", onProg);
        socket.off("done", onDone);
        socket.off("error", onErr);
      }
      socket.on("progress", onProg);
      socket.on("done", onDone);
      socket.on("error", onErr);
      setState(row, "running", "下載中…");
      socket.emit("download", {
        url,
        mode,
        quality: mode === "video" ? quality : null,
        title,
      });
    });
  }

  // ---- row helpers ----
  function makeRow(url, idx) {
    const row = document.createElement("div");
    row.className = "ts-item bd-item";
    row.dataset.idx = idx + 1;
    row.innerHTML = `
      <div class="ts-item-head">
        <span class="ts-item-status badge-queued">排隊中</span>
        <img class="bd-thumb hidden" alt="" />
        <span class="ts-item-title"></span>
        <div class="ts-item-actions"></div>
      </div>
      <div class="progress-bar-wrap bd-progwrap"><div class="progress-bar bd-bar"></div></div>`;
    row.querySelector(".ts-item-title").textContent = `${idx + 1}. ${url}`;
    listEl.appendChild(row);
    return row;
  }
  function setThumb(row, src) {
    const img = row.querySelector(".bd-thumb");
    img.src = src;
    img.classList.remove("hidden");
  }
  function setBar(row, pct) {
    row.querySelector(".bd-bar").style.width = (pct || 0) + "%";
  }
  function setState(row, state, sub) {
    const badge = row.querySelector(".ts-item-status");
    badge.className = "ts-item-status";
    badge.classList.add(
      state === "running" ? "badge-running" : state === "done" ? "badge-done" : state === "error" ? "badge-error" : "badge-queued"
    );
    badge.textContent =
      state === "running" ? "處理中" : state === "done" ? "完成" : state === "error" ? "失敗" : "排隊中";
    if (state === "done") row.querySelector(".bd-progwrap").classList.add("hidden");
    if (sub !== undefined) setSub(row, sub, state === "error");
  }
  function setSub(row, text, isErr) {
    let el = row.querySelector(".ts-item-sub");
    if (!el) {
      el = document.createElement("span");
      el.className = "ts-item-sub";
      row.querySelector(".ts-item-head").appendChild(el);
    }
    el.textContent = text;
    el.classList.toggle("is-err", !!isErr);
  }
  // 貼上剪貼簿
  $("#bdPaste").addEventListener("click", async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t) return;
      urlsEl.value = urlsEl.value && !urlsEl.value.endsWith("\n") ? urlsEl.value + "\n" + t : urlsEl.value + t;
      urlsEl.focus();
      window.toast("已貼上");
    } catch {
      window.toast("無法讀取剪貼簿，請用 Ctrl+V", "err");
    }
  });

  function addDoneLink(row, data) {
    const actions = row.querySelector(".ts-item-actions");
    actions.innerHTML = "";
    const a = document.createElement("a");
    a.className = "btn btn-ghost ts-mini";
    a.href = data.downloadUrl;
    a.setAttribute("download", "");
    a.textContent = "⬇ 儲存";
    actions.appendChild(a);
    setSub(row, data.filename || "");
  }
})();
