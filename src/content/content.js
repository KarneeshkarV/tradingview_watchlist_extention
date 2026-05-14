(function () {
  "use strict";

  const LOG = "[TVWL]";
  const { model } = window.TVWL;
  const { storage } = window.TVWL;
  const { bridge } = window.TVWL;
  const { ui } = window.TVWL;

  let state = null;
  let mounted = null;

  // Bulk paste: split on commas / newlines, keep `###NAME` tokens so they
  // become dividers downstream. TradingView's native export uses this format.
  function parseBulkSymbols(raw) {
    if (typeof raw !== "string") return [];
    return raw
      .split(/[,\n\r]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function nativeHost() {
    if (state && state.popOut) return null;
    return bridge.findNativeWatchlistHost ? bridge.findNativeWatchlistHost() : null;
  }

  function mountPanel() {
    mounted = ui.mount(ctx(), nativeHost());
    paintAllQuotes();
    return mounted;
  }

  function persist() {
    storage.saveState(state);
  }

  function rerender() {
    if (!mounted) return;
    ui.render(ctx(), mounted);
    paintAllQuotes();
  }

  function paintAllQuotes() {
    if (!mounted || !bridge.quoteFeed) return;
    ui.applyQuotes(mounted, null, bridge.quoteFeed);
  }

  function syncSubscriptions() {
    if (!bridge.quoteFeed) return;
    const list = state && state.lists.find((l) => l.id === state.activeId);
    bridge.quoteFeed.setSymbols(list ? model.listSymbols(list) : []);
  }

  function ctx() {
    return {
      state,
      actions: {
        setActive(id) {
          if (model.setActive(state, id)) {
            persist();
            rerender();
            syncSubscriptions();
          }
        },
        createList(name) {
          model.createList(state, name);
          persist();
          rerender();
          syncSubscriptions();
        },
        renameList(id, name) {
          if (model.renameList(state, id, name)) {
            persist();
            rerender();
          }
        },
        deleteList(id) {
          if (model.deleteList(state, id)) {
            persist();
            rerender();
            syncSubscriptions();
          }
        },
        addSymbol(listId, raw) {
          const tokens = parseBulkSymbols(raw);
          if (tokens.length > 1 || (tokens[0] && tokens[0].startsWith("###"))) {
            const added = model.importSymbols(state, listId, tokens);
            if (added > 0) {
              persist();
              rerender();
              syncSubscriptions();
              ui.toast(`Added ${added} item${added === 1 ? "" : "s"}`);
            } else {
              ui.toast("Nothing new to add");
            }
            return;
          }
          const ok = model.addSymbol(state, listId, raw);
          if (ok) {
            persist();
            rerender();
            syncSubscriptions();
          } else {
            ui.toast("Symbol already in list or invalid");
          }
        },
        addDivider(listId, label) {
          const item = model.addDivider(state, listId, label);
          if (item) {
            persist();
            rerender();
          }
        },
        renameDivider(listId, itemId, label) {
          if (model.renameDivider(state, listId, itemId, label)) {
            persist();
            rerender();
          }
        },
        toggleDividerCollapsed(listId, itemId) {
          if (model.toggleDividerCollapsed(state, listId, itemId)) {
            persist();
            rerender();
          }
        },
        removeItem(listId, itemId) {
          if (model.removeItem(state, listId, itemId)) {
            persist();
            rerender();
            syncSubscriptions();
          }
        },
        moveItem(listId, itemId, toIndex) {
          if (model.moveItem(state, listId, itemId, toIndex)) {
            persist();
            rerender();
          }
        },
        removeSymbol(listId, sym) {
          if (model.removeSymbol(state, listId, sym)) {
            persist();
            rerender();
            syncSubscriptions();
          }
        },
        loadSymbol(sym) {
          bridge.loadSymbol(sym).then((ok) => {
            if (!ok) ui.toast("Couldn't switch chart. Try reloading TradingView.");
          });
        },
        addCurrentSymbol() {
          const list = state.lists.find((l) => l.id === state.activeId);
          if (!list) return;
          const sym = bridge.currentChartSymbol();
          if (!sym) {
            ui.toast("Couldn't detect current chart symbol");
            return;
          }
          const ok = model.addSymbol(state, list.id, sym);
          if (ok) {
            persist();
            rerender();
            syncSubscriptions();
            ui.toast(`Added ${sym}`);
          } else {
            ui.toast(`${sym} is already in this list`);
          }
        },
        togglePopOut() {
          state.popOut = !state.popOut;
          persist();
          mounted = mountPanel();
          watchForRemoval();
        },
        async importFromNative() {
          const list = state.lists.find((l) => l.id === state.activeId);
          if (!list) return;
          const syms = bridge.readNativeWatchlist();
          if (syms.length === 0) {
            ui.toast("Open your TradingView watchlist first, then try again.");
            return;
          }
          const added = model.importSymbols(state, list.id, syms);
          persist();
          rerender();
          syncSubscriptions();
          ui.toast(added ? `Imported ${added} item${added === 1 ? "" : "s"}` : "Nothing new");
        },
      },
    };
  }

  function waitForTV(timeoutMs) {
    return new Promise((resolve) => {
      const ready = () =>
        document.querySelector('#header-toolbar-symbol-search, [data-name="legend-source-title"]');
      if (ready()) return resolve(true);
      const start = Date.now();
      const obs = new MutationObserver(() => {
        if (ready()) {
          obs.disconnect();
          resolve(true);
        } else if (Date.now() - start > timeoutMs) {
          obs.disconnect();
          resolve(false);
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  function watchForRemoval() {
    const root = document.getElementById(ui.ROOT_ID);
    if (!root) return;
    const obs = new MutationObserver(() => {
      if (!document.body.contains(root)) {
        obs.disconnect();
        if (root.hasAttribute("data-tvwl-teardown")) return;
        mounted = mountPanel();
        watchForRemoval();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function watchForNativeHost() {
    const obs = new MutationObserver(() => {
      if (state && state.popOut) return;
      const root = document.getElementById(ui.ROOT_ID);
      if (root && root.classList.contains("tvwl-root--overlay") && nativeHost()) {
        mounted = mountPanel();
        watchForRemoval();
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  function hookSpaNavigation() {
    const reMountIfNeeded = () => {
      if (!document.getElementById(ui.ROOT_ID)) {
        mountPanel();
        watchForRemoval();
      }
    };
    window.addEventListener("popstate", reMountIfNeeded);
    const origPush = history.pushState;
    history.pushState = function () {
      const r = origPush.apply(this, arguments);
      setTimeout(reMountIfNeeded, 50);
      return r;
    };
    const origReplace = history.replaceState;
    history.replaceState = function () {
      const r = origReplace.apply(this, arguments);
      setTimeout(reMountIfNeeded, 50);
      return r;
    };
  }

  async function init() {
    try {
      const loaded = await storage.loadState();
      state = loaded && loaded.lists ? model.migrateState(loaded) : model.createState();
    } catch (e) {
      console.warn(LOG, "load failed; using fresh state", e);
      state = model.createState();
    }
    if (typeof state.popOut !== "boolean") state.popOut = false;
    await waitForTV(10000);
    mounted = mountPanel();
    watchForRemoval();
    hookSpaNavigation();
    watchForNativeHost();

    if (bridge.quoteFeed) {
      bridge.quoteFeed.setUpdateListener((changed) => {
        if (!mounted) return;
        ui.applyQuotes(mounted, changed, bridge.quoteFeed);
      });
      bridge.quoteFeed.start();
      syncSubscriptions();
    }

    storage.onStorageChanged((newValue) => {
      if (newValue) {
        const wasPopOut = !!(state && state.popOut);
        state = model.migrateState(newValue);
        if (typeof state.popOut !== "boolean") state.popOut = false;
        if (state.popOut !== wasPopOut) {
          mounted = mountPanel();
          watchForRemoval();
        } else {
          rerender();
        }
        syncSubscriptions();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
