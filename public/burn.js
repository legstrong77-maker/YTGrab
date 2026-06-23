(() => {
  const API = "http://localhost:8001";
  const $ = (s) => document.querySelector(s);

  let videoFile = null;
  let srtFile = null;
  let subSrc = "history"; // history | file
  let burnMode = "soft"; // soft | hard

  // ---- 影片檔拖放 ----
  setupDrop($("#burnVidDrop"), $("#burnVid"), $("#burnVidName"), (f) => (videoFile = f), "影片");
  // ---- .srt 拖放 ----
  setupDrop($("#burnSrtDrop"), $("#burnSrt"), $("#burnSrtName"), (f) => (srtFile = f), "字幕");

  function setupDrop(drop, input, nameEl, set, label) {
    drop.addEventListener("click", () => input.click());
    input.addEventListener("change", () => pick(input.files[0]));
    ["dragover", "dragenter"].forEach((e) =>
      drop.addEventListener(e, (ev) => { ev.preventDefault(); ev.stopPropagation(); drop.classList.add("over"); })
    );
    ["dragleave", "drop"].forEach((e) =>
      drop.addEventListener(e, (ev) => { ev.preventDefault(); ev.stopPropagation(); drop.classList.remove("over"); })
    );
    drop.addEventListener("drop", (ev) => pick(ev.dataTransfer.files[0]));
    function pick(f) {
      if (!f) return;
      set(f);
      nameEl.textContent = "已選擇：" + f.name;
    }
  }

  // ---- 字幕來源切換 ----
  document.querySelectorAll("#burnSrc .mode-btn").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("#burnSrc .mode-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      subSrc = b.dataset.subsrc;
      $("#burnPaneHist").classList.toggle("hidden", subSrc !== "history");
      $("#burnPaneFile").classList.toggle("hidden", subSrc !== "file");
    })
  );

  // ---- 字幕方式切換 ----
  document.querySelectorAll("#burnMode .mode-btn").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("#burnMode .mode-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      burnMode = b.dataset.burn;
    })
  );

  // ---- 載入歷史逐字稿到下拉 ----
  const histSel = $("#burnHistSel");
  async function loadBurnHistory() {
    try {
      const r = await fetch(API + "/api/history", { cache: "no-store" });
      const h = r.ok ? await r.json() : [];
      if (!h.length) {
        histSel.innerHTML = '<option value="">（尚無歷史逐字稿，請改用「上傳 .srt」）</option>';
      } else {
        histSel.innerHTML = h.map((r) => `<option value="${r.id}">${escAttr(r.title || r.id)}</option>`).join("");
      }
    } catch {
      histSel.innerHTML = '<option value="">（無法連線逐字稿伺服器）</option>';
    }
  }
  window.loadBurnHistory = loadBurnHistory;
  function escAttr(s) {
    return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // ---- 送出 ----
  const go = $("#burnGo");
  const prog = $("#burnProg");
  const bar = $("#burnBar");
  const stage = $("#burnStage");
  const err = $("#burnErr");
  const result = $("#burnResult");
  let poll = null;

  go.addEventListener("click", async () => {
    err.classList.add("hidden");
    if (!videoFile) return showErr("請先選擇影片檔");
    const fd = new FormData();
    fd.append("video", videoFile);
    fd.append("mode", burnMode);
    if (subSrc === "file") {
      if (!srtFile) return showErr("請先選擇 .srt 字幕檔");
      fd.append("srt", srtFile);
    } else {
      const id = histSel.value;
      if (!id) return showErr("請先選擇一個歷史逐字稿，或改用上傳 .srt");
      fd.append("history_id", id);
    }

    go.disabled = true;
    result.classList.add("hidden");
    prog.classList.remove("hidden");
    bar.style.width = "15%";
    stage.textContent = "上傳中…";

    try {
      const r = await fetch(API + "/api/burn", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || "送出失敗");
      poll = setInterval(() => checkStatus(j.job_id), 1500);
    } catch (e) {
      stop(connErr(e));
    }
  });

  async function checkStatus(id) {
    try {
      const r = await fetch(API + "/api/status/" + id, { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      bar.style.width = Math.max(15, Math.round((j.progress || 0) * 100)) + "%";
      stage.textContent = j.stage || "";
      if (j.state === "done") {
        clearInterval(poll);
        go.disabled = false;
        prog.classList.add("hidden");
        $("#burnDownload").href = `${API}/api/burn_download/${id}`;
        result.classList.remove("hidden");
        result.scrollIntoView({ behavior: "smooth", block: "center" });
        window.toast("字幕影片完成");
      } else if (j.state === "error") {
        stop("處理失敗：" + (j.error || "未知"));
      }
    } catch (e) {
      stop(connErr(e));
    }
  }

  function stop(msg) {
    if (poll) clearInterval(poll);
    go.disabled = false;
    prog.classList.add("hidden");
    showErr(msg);
  }
  function showErr(m) {
    err.textContent = m;
    err.classList.remove("hidden");
  }
  function connErr(e) {
    const m = (e && e.message) || "";
    if (/fetch|network|failed/i.test(m)) return "無法連線逐字稿伺服器，請確認已啟動。";
    return m || "發生未知錯誤";
  }

  $("#burnAgain").addEventListener("click", () => {
    result.classList.add("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
})();
