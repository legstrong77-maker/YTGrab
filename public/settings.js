// 設定（存 localStorage，下次自動套用）。其他腳本可讀 window.ytgrabSettings()
(() => {
  const $ = (s) => document.querySelector(s);
  const KEY = "ytgrab_settings";
  const DEFAULTS = { dlMode: "video", dlQuality: "1080", preferSubs: true, showDocs: true };

  function load() {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
    } catch {
      return { ...DEFAULTS };
    }
  }
  function save(s) {
    localStorage.setItem(KEY, JSON.stringify(s));
  }
  let S = load();
  window.ytgrabSettings = () => ({ ...S });

  // ---- 套用到 UI / 全站 ----
  function apply() {
    // 逐字稿預設字幕開關
    const ps = $("#tsPreferSubs");
    if (ps) ps.checked = S.preferSubs;
    // 顯示/隱藏技術說明
    document.body.classList.toggle("hide-docs", !S.showDocs);
    // 下載器預設格式（點對應的模式鈕讓 app.js 同步狀態）
    const modeBtn = document.querySelector(S.dlMode === "audio" ? "#modeAudio" : "#modeVideo");
    if (modeBtn && !modeBtn.classList.contains("active")) modeBtn.click();
    // 同步設定面板控制項
    segActive("#setDlMode", "m", S.dlMode);
    segActive("#setDlQuality", "q", S.dlQuality);
    $("#setPreferSubs").checked = S.preferSubs;
    $("#setShowDocs").checked = S.showDocs;
  }
  function segActive(sel, attr, val) {
    document.querySelectorAll(sel + " .bd-seg").forEach((b) =>
      b.classList.toggle("active", b.dataset[attr] === val)
    );
  }

  // ---- 設定面板互動 ----
  document.querySelectorAll("#setDlMode .bd-seg").forEach((b) =>
    b.addEventListener("click", () => { S.dlMode = b.dataset.m; save(S); apply(); })
  );
  document.querySelectorAll("#setDlQuality .bd-seg").forEach((b) =>
    b.addEventListener("click", () => { S.dlQuality = b.dataset.q; save(S); apply(); })
  );
  $("#setPreferSubs").addEventListener("change", (e) => { S.preferSubs = e.target.checked; save(S); apply(); });
  $("#setShowDocs").addEventListener("change", (e) => { S.showDocs = e.target.checked; save(S); apply(); });

  // ---- 開關面板 ----
  const modal = $("#settingsModal");
  const open = () => modal.classList.add("show");
  const close = () => modal.classList.remove("show");
  $("#settingsBtn").addEventListener("click", open);
  $("#settingsClose").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  apply();
})();
