(() => {
  const $ = (s) => document.querySelector(s);
  const listEl = $("#dlHistList");
  const countEl = $("#dlHistCount");
  const emptyEl = $("#dlHistEmpty");
  const searchEl = $("#dlHistSearch");
  let data = [];

  async function load() {
    try {
      const r = await fetch("/api/downloads", { cache: "no-store" });
      data = r.ok ? await r.json() : [];
    } catch {
      data = [];
    }
    render();
  }
  window.loadDownloads = load; // 供其他腳本在下載完成後刷新

  function render() {
    const q = (searchEl.value || "").trim().toLowerCase();
    const items = data.filter((r) => !q || (r.title || r.filename || "").toLowerCase().includes(q));
    countEl.textContent = data.length ? `${data.length} 個檔案` : "尚無紀錄";
    emptyEl.classList.toggle("hidden", data.length > 0);
    listEl.innerHTML = "";
    items.forEach((r) => listEl.appendChild(row(r)));
  }

  function row(r) {
    const el = document.createElement("div");
    el.className = "ts-item hist-item";
    const icon = r.mode === "audio" ? "🎵" : "🎬";
    el.innerHTML = `
      <div class="ts-item-head">
        <span class="ts-item-status badge-done">${icon} ${(r.ext || "").replace(".", "").toUpperCase()}</span>
        <span class="ts-item-title"></span>
        <span class="hist-meta"></span>
        <div class="ts-item-actions"></div>
      </div>`;
    el.querySelector(".ts-item-title").textContent = r.title || r.filename;
    el.querySelector(".hist-meta").textContent = relTime(r.ts) + " · " + fmtSize(r.size);
    const actions = el.querySelector(".ts-item-actions");
    const a = document.createElement("a");
    a.className = "btn btn-ghost ts-mini";
    a.href = r.downloadUrl;
    a.setAttribute("download", "");
    a.textContent = "⬇ 儲存";
    actions.appendChild(a);
    const del = document.createElement("button");
    del.className = "btn btn-ghost ts-mini";
    del.textContent = "🗑";
    del.addEventListener("click", async () => {
      if (!confirm(`刪除「${r.title || r.filename}」？（會一併刪除檔案）`)) return;
      try {
        await fetch(`/api/downloads/${r.id}`, { method: "DELETE" });
        data = data.filter((x) => x.id !== r.id);
        render();
        window.toast("已刪除");
      } catch {
        window.toast("刪除失敗", "err");
      }
    });
    actions.appendChild(del);
    return el;
  }

  function fmtSize(b) {
    if (!b) return "?";
    const u = ["B", "KB", "MB", "GB"];
    let i = 0, n = b;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(n < 10 && i > 0 ? 1 : 0) + " " + u[i];
  }
  function relTime(ts) {
    if (!ts) return "";
    const s = Math.floor(Date.now() / 1000 - ts / 1000); // ts 為毫秒
    if (s < 60) return "剛剛";
    if (s < 3600) return Math.floor(s / 60) + " 分鐘前";
    if (s < 86400) return Math.floor(s / 3600) + " 小時前";
    return Math.floor(s / 86400) + " 天前";
  }

  searchEl.addEventListener("input", render);
  $("#dlHistRefresh").addEventListener("click", () => {
    load();
    window.toast("已重新整理");
  });
  $("#dlOpenFolder").addEventListener("click", async () => {
    try {
      await fetch("/api/open-folder", { method: "POST" });
      window.toast("已開啟下載資料夾");
    } catch {
      window.toast("開啟失敗", "err");
    }
  });
  $("#dlHistClear").addEventListener("click", async () => {
    if (!data.length) return;
    if (!confirm("清空所有下載紀錄？（會一併刪除這些檔案）")) return;
    try {
      await fetch("/api/downloads", { method: "DELETE" });
      data = [];
      render();
      window.toast("已清空下載紀錄");
    } catch {
      window.toast("清空失敗", "err");
    }
  });

  load();
})();
