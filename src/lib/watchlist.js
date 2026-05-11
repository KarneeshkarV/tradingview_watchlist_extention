(function () {
  "use strict";

  const STATE_VERSION = 1;

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

  function createState() {
    const firstId = uid();
    return {
      version: STATE_VERSION,
      activeId: firstId,
      lists: [{ id: firstId, name: "Default", symbols: [] }],
    };
  }

  function findList(state, id) {
    return state.lists.find((l) => l.id === id) || null;
  }

  function createList(state, name) {
    const id = uid();
    const list = { id, name: (name || "Untitled").slice(0, 60), symbols: [] };
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
    if (list.symbols.includes(sym)) return false;
    list.symbols.push(sym);
    return true;
  }

  function removeSymbol(state, listId, sym) {
    const list = findList(state, listId);
    if (!list) return false;
    const idx = list.symbols.indexOf(sym);
    if (idx === -1) return false;
    list.symbols.splice(idx, 1);
    return true;
  }

  function serialize(state) {
    return JSON.stringify(
      {
        version: STATE_VERSION,
        exportedAt: new Date().toISOString(),
        lists: state.lists.map((l) => ({ name: l.name, symbols: l.symbols.slice() })),
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
      .map((l) => ({
        id: uid(),
        name: l.name.slice(0, 60) || "Untitled",
        symbols: Array.from(
          new Set(l.symbols.map(normalizeSymbol).filter(Boolean))
        ),
      }));

    if (mode === "replace" || !currentState) {
      const next = {
        version: STATE_VERSION,
        activeId: cleanLists[0] ? cleanLists[0].id : null,
        lists: cleanLists.length ? cleanLists : [],
      };
      if (next.lists.length === 0) {
        const def = { id: uid(), name: "Default", symbols: [] };
        next.lists.push(def);
        next.activeId = def.id;
      }
      return next;
    }

    // merge
    for (const incoming of cleanLists) {
      const existing = currentState.lists.find((l) => l.name === incoming.name);
      if (existing) {
        for (const s of incoming.symbols) {
          if (!existing.symbols.includes(s)) existing.symbols.push(s);
        }
      } else {
        currentState.lists.push(incoming);
      }
    }
    if (!findList(currentState, currentState.activeId) && currentState.lists[0]) {
      currentState.activeId = currentState.lists[0].id;
    }
    return currentState;
  }

  function importSymbols(state, listId, symbols) {
    const list = findList(state, listId);
    if (!list) return 0;
    let added = 0;
    for (const s of symbols) {
      const sym = normalizeSymbol(s);
      if (sym && !list.symbols.includes(sym)) {
        list.symbols.push(sym);
        added++;
      }
    }
    return added;
  }

  const root = (typeof window !== "undefined" ? window : globalThis);
  root.TVWL = root.TVWL || {};
  root.TVWL.model = {
    STATE_VERSION,
    createState,
    findList,
    createList,
    renameList,
    deleteList,
    setActive,
    addSymbol,
    removeSymbol,
    importSymbols,
    serialize,
    deserialize,
    normalizeSymbol,
  };
})();
