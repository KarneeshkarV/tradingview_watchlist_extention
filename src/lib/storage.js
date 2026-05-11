(function () {
  "use strict";

  const KEY = "tvwl.state.v1";
  const DEBOUNCE_MS = 200;

  function api() {
    // Both Chromium and Firefox MV3 expose chrome.storage; webextension polyfill not required.
    return (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local)
      ? chrome.storage.local
      : null;
  }

  function loadState() {
    return new Promise((resolve) => {
      const s = api();
      if (!s) return resolve(null);
      try {
        const maybe = s.get([KEY], (res) => resolve((res && res[KEY]) || null));
        // Firefox returns a Promise from get()
        if (maybe && typeof maybe.then === "function") {
          maybe.then((res) => resolve((res && res[KEY]) || null)).catch(() => resolve(null));
        }
      } catch (e) {
        console.warn("[TVWL] storage.loadState failed", e);
        resolve(null);
      }
    });
  }

  let pendingTimer = null;
  let pendingState = null;
  let pendingResolvers = [];

  function flush() {
    const s = api();
    const state = pendingState;
    const resolvers = pendingResolvers;
    pendingTimer = null;
    pendingState = null;
    pendingResolvers = [];
    if (!s || !state) {
      resolvers.forEach((r) => r(false));
      return;
    }
    try {
      const maybe = s.set({ [KEY]: state }, () => resolvers.forEach((r) => r(true)));
      if (maybe && typeof maybe.then === "function") {
        maybe.then(() => resolvers.forEach((r) => r(true))).catch(() => resolvers.forEach((r) => r(false)));
      }
    } catch (e) {
      console.warn("[TVWL] storage.saveState failed", e);
      resolvers.forEach((r) => r(false));
    }
  }

  function saveState(state) {
    pendingState = state;
    return new Promise((resolve) => {
      pendingResolvers.push(resolve);
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(flush, DEBOUNCE_MS);
    });
  }

  function onStorageChanged(cb) {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.onChanged) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[KEY]) cb(changes[KEY].newValue || null);
    });
  }

  const root = (typeof window !== "undefined" ? window : globalThis);
  root.TVWL = root.TVWL || {};
  root.TVWL.storage = { loadState, saveState, onStorageChanged, KEY };
})();
