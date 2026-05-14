(function () {
  "use strict";

  const STATE_VERSION = 2;

  function uid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function normalizeSymbol(raw) {
    if (typeof raw !== "string") return null;
    const s = raw.trim().toUpperCase().replace(/\s+/g, "");
    if (!s) return null;
    return s;
  }

  function makeSymbolItem(sym) {
    return { kind: "symbol", id: uid(), sym };
  }

  function makeDividerItem(label) {
    return {
      kind: "divider",
      id: uid(),
      label: (label || "Section").toString().slice(0, 40),
      collapsed: false,
    };
  }

  // Migrate legacy `symbols: string[]` into `items: Item[]`. Strings starting
  // with "###" become dividers (matching TradingView's native export format).
  function migrateList(list) {
    if (Array.isArray(list.items)) return list;
    const items = [];
    if (Array.isArray(list.symbols)) {
      for (const raw of list.symbols) {
        if (typeof raw !== "string") continue;
        if (raw.startsWith("###")) {
          items.push(makeDividerItem(raw.slice(3).trim()));
        } else {
          const sym = normalizeSymbol(raw);
          if (sym) items.push(makeSymbolItem(sym));
        }
      }
    }
    list.items = items;
    delete list.symbols;
    return list;
  }

  function migrateState(state) {
    if (!state || !Array.isArray(state.lists)) return state;
    state.lists.forEach(migrateList);
    state.version = STATE_VERSION;
    return state;
  }

  function createState() {
    const firstId = uid();
    return {
      version: STATE_VERSION,
      activeId: firstId,
      popOut: false,
      lists: [{ id: firstId, name: "Default", items: [] }],
    };
  }

  function findList(state, id) {
    return state.lists.find((l) => l.id === id) || null;
  }

  function findItem(list, itemId) {
    if (!list) return null;
    return list.items.find((it) => it.id === itemId) || null;
  }

  function listSymbols(list) {
    if (!list || !Array.isArray(list.items)) return [];
    return list.items.filter((it) => it.kind === "symbol").map((it) => it.sym);
  }

  function hasSymbol(list, sym) {
    return list.items.some((it) => it.kind === "symbol" && it.sym === sym);
  }

  function createList(state, name) {
    const id = uid();
    const list = { id, name: (name || "Untitled").slice(0, 60), items: [] };
    state.lists.push(list);
    state.activeId = id;
    return list;
  }

  function renameList(state, id, name) {
    const list = findList(state, id);
    if (!list) return false;
    list.name = (name || "Untitled").slice(0, 60);
    return true;
  }

  function deleteList(state, id) {
    const idx = state.lists.findIndex((l) => l.id === id);
    if (idx === -1) return false;
    state.lists.splice(idx, 1);
    if (state.lists.length === 0) {
      const fresh = createList(state, "Default");
      state.activeId = fresh.id;
    } else if (state.activeId === id) {
      state.activeId = state.lists[Math.max(0, idx - 1)].id;
    }
    return true;
  }

  function setActive(state, id) {
    if (findList(state, id)) {
      state.activeId = id;
      return true;
    }
    return false;
  }

  function addSymbol(state, listId, raw) {
    const list = findList(state, listId);
    if (!list) return false;
    const sym = normalizeSymbol(raw);
    if (!sym) return false;
    if (hasSymbol(list, sym)) return false;
    list.items.push(makeSymbolItem(sym));
    return true;
  }

  function addDivider(state, listId, label) {
    const list = findList(state, listId);
    if (!list) return null;
    const item = makeDividerItem(label);
    list.items.push(item);
    return item;
  }

  function renameDivider(state, listId, itemId, label) {
    const list = findList(state, listId);
    const item = findItem(list, itemId);
    if (!item || item.kind !== "divider") return false;
    item.label = (label || "Section").toString().slice(0, 40);
    return true;
  }

  function toggleDividerCollapsed(state, listId, itemId) {
    const list = findList(state, listId);
    const item = findItem(list, itemId);
    if (!item || item.kind !== "divider") return false;
    item.collapsed = !item.collapsed;
    return true;
  }

  function removeItem(state, listId, itemId) {
    const list = findList(state, listId);
    if (!list) return false;
    const idx = list.items.findIndex((it) => it.id === itemId);
    if (idx === -1) return false;
    list.items.splice(idx, 1);
    return true;
  }

  // Legacy helper: remove by symbol value. Kept so existing callers keep working.
  function removeSymbol(state, listId, sym) {
    const list = findList(state, listId);
    if (!list) return false;
    const idx = list.items.findIndex((it) => it.kind === "symbol" && it.sym === sym);
    if (idx === -1) return false;
    list.items.splice(idx, 1);
    return true;
  }

  // Move item to a new index. `toIndex` is interpreted in the array AFTER the
  // item has been removed — i.e. the caller can compute it from the current
  // rendered list (the index of the row to drop above).
  function moveItem(state, listId, itemId, toIndex) {
    const list = findList(state, listId);
    if (!list) return false;
    const from = list.items.findIndex((it) => it.id === itemId);
    if (from === -1) return false;
    const [item] = list.items.splice(from, 1);
    const dest = Math.max(0, Math.min(list.items.length, toIndex));
    list.items.splice(dest, 0, item);
    return true;
  }

  // Bulk import: accepts a list of raw tokens. `###NAME` tokens become
  // dividers; everything else is treated as a symbol. Duplicate symbols are
  // skipped. Returns the count of items appended.
  function importSymbols(state, listId, tokens) {
    const list = findList(state, listId);
    if (!list) return 0;
    let added = 0;
    for (const raw of tokens) {
      if (typeof raw !== "string") continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("###")) {
        list.items.push(makeDividerItem(trimmed.slice(3).trim()));
        added++;
        continue;
      }
      const sym = normalizeSymbol(trimmed);
      if (sym && !hasSymbol(list, sym)) {
        list.items.push(makeSymbolItem(sym));
        added++;
      }
    }
    return added;
  }

  // Serialize back to the existing `symbols: string[]` shape so the export
  // file stays compatible with TradingView's own format. Dividers are encoded
  // inline as `###NAME` strings.
  function listToSymbolStrings(list) {
    return list.items.map((it) =>
      it.kind === "divider" ? "###" + (it.label || "") : it.sym
    );
  }

  function serialize(state) {
    return JSON.stringify(
      {
        version: STATE_VERSION,
        exportedAt: new Date().toISOString(),
        lists: state.lists.map((l) => ({
          name: l.name,
          symbols: listToSymbolStrings(l),
        })),
      },
      null,
      2
    );
  }

  // mode: "replace" wipes existing lists; "merge" appends imported lists (skipping exact-name+symbol duplicates).
  function deserialize(json, mode, currentState) {
    let parsed;
    try {
      parsed = typeof json === "string" ? JSON.parse(json) : json;
    } catch (e) {
      throw new Error("Invalid JSON");
    }
    if (!parsed || !Array.isArray(parsed.lists)) {
      throw new Error("Missing 'lists' array");
    }
    const cleanLists = parsed.lists
      .filter((l) => l && typeof l.name === "string" && Array.isArray(l.symbols))
      .map((l) => {
        const items = [];
        const seenSyms = new Set();
        for (const raw of l.symbols) {
          if (typeof raw !== "string") continue;
          if (raw.startsWith("###")) {
            items.push(makeDividerItem(raw.slice(3).trim()));
            continue;
          }
          const sym = normalizeSymbol(raw);
          if (sym && !seenSyms.has(sym)) {
            seenSyms.add(sym);
            items.push(makeSymbolItem(sym));
          }
        }
        return {
          id: uid(),
          name: l.name.slice(0, 60) || "Untitled",
          items,
        };
      });

    if (mode === "replace" || !currentState) {
      const next = {
        version: STATE_VERSION,
        activeId: cleanLists[0] ? cleanLists[0].id : null,
        popOut: !!(currentState && currentState.popOut),
        lists: cleanLists.length ? cleanLists : [],
      };
      if (next.lists.length === 0) {
        const def = { id: uid(), name: "Default", items: [] };
        next.lists.push(def);
        next.activeId = def.id;
      }
      return next;
    }

    // merge: for an existing list with the same name, append new items
    // (skip already-present symbols; dividers always append since they're
    // user labels and duplicates are fine).
    let firstNewId = null;
    for (const incoming of cleanLists) {
      const existing = currentState.lists.find((l) => l.name === incoming.name);
      if (existing) {
        migrateList(existing);
        for (const it of incoming.items) {
          if (it.kind === "symbol" && hasSymbol(existing, it.sym)) continue;
          existing.items.push(it);
        }
      } else {
        currentState.lists.push(incoming);
        if (!firstNewId) firstNewId = incoming.id;
      }
    }
    if (firstNewId) {
      currentState.activeId = firstNewId;
    } else if (!findList(currentState, currentState.activeId) && currentState.lists[0]) {
      currentState.activeId = currentState.lists[0].id;
    }
    return currentState;
  }

  const root = (typeof window !== "undefined" ? window : globalThis);
  root.TVWL = root.TVWL || {};
  root.TVWL.model = {
    STATE_VERSION,
    createState,
    migrateState,
    migrateList,
    findList,
    findItem,
    listSymbols,
    createList,
    renameList,
    deleteList,
    setActive,
    addSymbol,
    addDivider,
    renameDivider,
    toggleDividerCollapsed,
    removeItem,
    removeSymbol,
    moveItem,
    importSymbols,
    serialize,
    deserialize,
    normalizeSymbol,
  };
})();
