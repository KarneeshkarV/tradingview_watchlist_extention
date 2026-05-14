(function () {
  "use strict";

  const { model, storage } = window.TVWL;
  const $ = (sel) => document.querySelector(sel);

  function setStatus(msg, kind) {
    const el = $("#status");
    el.textContent = msg || "";
    el.className = "popup-status" + (kind ? " " + kind : "");
  }

  async function refreshCounts() {
    const raw = (await storage.loadState()) || model.createState();
    const state = model.migrateState(raw);
    const lists = state.lists || [];
    const symCount = lists.reduce((acc, l) => acc + model.listSymbols(l).length, 0);
    $("#counts").textContent = `${lists.length} list${lists.length === 1 ? "" : "s"} · ${symCount} symbol${symCount === 1 ? "" : "s"}`;
    const toggle = $("#pop-out-toggle");
    if (toggle) toggle.checked = !!state.popOut;
  }

  async function setPopOut(popOut) {
    const current = (await storage.loadState()) || model.createState();
    current.popOut = !!popOut;
    await storage.saveState(current);
  }

  function todayStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  async function doExport() {
    const raw = (await storage.loadState()) || model.createState();
    const state = model.migrateState(raw);
    const json = model.serialize(state);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tradingview-watchlists-${todayStamp()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("Exported.", "ok");
  }

  async function doImport(file) {
    if (!file) return;
    const text = await file.text();
    const mode = document.querySelector('input[name="import-mode"]:checked').value;
    let current = model.migrateState((await storage.loadState()) || model.createState());
    let next;
    try {
      next = model.deserialize(text, mode, current);
    } catch (e) {
      setStatus("Import failed: " + e.message, "err");
      return;
    }
    await storage.saveState(next);
    setStatus(`Imported (${mode}).`, "ok");
    refreshCounts();
  }

  function openTV() {
    if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: "https://www.tradingview.com/chart/" });
    } else {
      window.open("https://www.tradingview.com/chart/", "_blank");
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    refreshCounts();
    $("#open-tv").addEventListener("click", openTV);
    $("#export").addEventListener("click", doExport);
    $("#import-file").addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      doImport(f).finally(() => {
        e.target.value = "";
      });
    });
    $("#pop-out-toggle").addEventListener("change", (e) => {
      setPopOut(e.target.checked);
    });
  });
})();
