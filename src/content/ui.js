(function () {
  "use strict";

  const ROOT_ID = "tvwl-root";

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === "class") node.className = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else if (k.startsWith("on") && typeof attrs[k] === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (attrs[k] != null) {
          node.setAttribute(k, attrs[k]);
        }
      }
    }
    if (children) {
      for (const c of [].concat(children)) {
        if (c == null) continue;
        node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  function toast(message) {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    const existing = root.querySelector(".tvwl-toast");
    if (existing) existing.remove();
    const t = el("div", { class: "tvwl-toast", text: message });
    root.appendChild(t);
    setTimeout(() => t.classList.add("tvwl-toast--show"), 10);
    setTimeout(() => {
      t.classList.remove("tvwl-toast--show");
      setTimeout(() => t.remove(), 250);
    }, 2200);
  }

  function confirm(message) {
    return window.confirm(message);
  }

  function promptText(message, defaultValue) {
    const v = window.prompt(message, defaultValue || "");
    return v == null ? null : v.trim();
  }

  function mount(ctx) {
    teardown();
    const root = el("div", { id: ROOT_ID, class: "tvwl-root" });
    document.body.appendChild(root);
    render(ctx, root);
    return root;
  }

  function teardown() {
    const old = document.getElementById(ROOT_ID);
    if (old) old.remove();
  }

  function render(ctx, root) {
    const collapsed = root.classList.contains("tvwl-collapsed");
    root.innerHTML = "";
    root.appendChild(buildPanel(ctx, collapsed));
  }

  function buildPanel(ctx, collapsed) {
    const { state, actions } = ctx;
    const panel = el("div", { class: "tvwl-panel" + (collapsed ? " tvwl-panel--collapsed" : "") });

    const header = el("div", { class: "tvwl-header" }, [
      el("div", { class: "tvwl-title", text: "Watchlists" }),
      el(
        "div",
        { class: "tvwl-header-actions" },
        [
          el("button", {
            class: "tvwl-icon-btn tvwl-icon-btn--accent",
            title: "Add current chart symbol to this list",
            text: "★",
            onClick: () => actions.addCurrentSymbol(),
          }),
          el("button", {
            class: "tvwl-icon-btn",
            title: "Import from TradingView watchlist",
            text: "⤓",
            onClick: () => actions.importFromNative(),
          }),
          el("button", {
            class: "tvwl-icon-btn",
            title: collapsed ? "Expand" : "Collapse",
            text: collapsed ? "‹" : "›",
            onClick: () => {
              const r = document.getElementById(ROOT_ID);
              r.classList.toggle("tvwl-collapsed");
              render(ctx, r);
            },
          }),
        ]
      ),
    ]);
    panel.appendChild(header);

    if (collapsed) return panel;

    panel.appendChild(buildTabs(ctx));

    const activeList = state.lists.find((l) => l.id === state.activeId);
    if (activeList) {
      panel.appendChild(buildSymbolList(activeList, actions));
      panel.appendChild(buildAddBar(activeList, actions));
    } else {
      panel.appendChild(el("div", { class: "tvwl-empty", text: "No list selected." }));
    }

    return panel;
  }

  function buildTabs(ctx) {
    const { state, actions } = ctx;
    const bar = el("div", { class: "tvwl-tabs" });
    const scroller = el("div", { class: "tvwl-tabs-scroll" });
    state.lists.forEach((list) => {
      const tab = el(
        "div",
        {
          class: "tvwl-tab" + (list.id === state.activeId ? " tvwl-tab--active" : ""),
          title: list.name,
        },
        [
          el("span", {
            class: "tvwl-tab-name",
            text: list.name,
            onClick: () => actions.setActive(list.id),
            onDblclick: () => {
              const n = promptText("Rename list", list.name);
              if (n) actions.renameList(list.id, n);
            },
          }),
          el("button", {
            class: "tvwl-tab-close",
            title: "Delete list",
            text: "×",
            onClick: (e) => {
              e.stopPropagation();
              if (confirm("Delete list \"" + list.name + "\"?")) actions.deleteList(list.id);
            },
          }),
        ]
      );
      scroller.appendChild(tab);
    });
    bar.appendChild(scroller);
    bar.appendChild(
      el("button", {
        class: "tvwl-tab-add",
        title: "New list",
        text: "+",
        onClick: () => {
          const n = promptText("New list name", "New List");
          if (n) actions.createList(n);
        },
      })
    );
    return bar;
  }

  function buildSymbolList(list, actions) {
    const wrap = el("div", { class: "tvwl-list" });
    if (list.symbols.length === 0) {
      wrap.appendChild(
        el("div", {
          class: "tvwl-empty",
          text: "No symbols yet. Add one below, or import from TradingView's native watchlist.",
        })
      );
      return wrap;
    }
    list.symbols.forEach((sym) => {
      const [exch, ticker] = sym.includes(":") ? sym.split(":") : ["", sym];
      const row = el(
        "div",
        { class: "tvwl-row", title: sym, onClick: () => actions.loadSymbol(sym) },
        [
          el(
            "div",
            { class: "tvwl-row-main" },
            [
              el("div", { class: "tvwl-row-ticker", text: ticker }),
              exch ? el("div", { class: "tvwl-row-exch", text: exch }) : null,
            ]
          ),
          el("button", {
            class: "tvwl-row-del",
            title: "Remove",
            text: "×",
            onClick: (e) => {
              e.stopPropagation();
              actions.removeSymbol(list.id, sym);
            },
          }),
        ]
      );
      wrap.appendChild(row);
    });
    return wrap;
  }

  function buildAddBar(list, actions) {
    const input = el("input", {
      class: "tvwl-add-input",
      type: "text",
      placeholder: "e.g. NASDAQ:AAPL  or  AAPL",
      onKeydown: (e) => {
        if (e.key === "Enter") {
          const v = input.value.trim();
          if (v) {
            actions.addSymbol(list.id, v);
            input.value = "";
          }
        }
      },
    });
    const btn = el("button", {
      class: "tvwl-add-btn",
      text: "Add",
      onClick: () => {
        const v = input.value.trim();
        if (v) {
          actions.addSymbol(list.id, v);
          input.value = "";
        }
      },
    });
    return el("div", { class: "tvwl-add" }, [input, btn]);
  }

  const root = (typeof window !== "undefined" ? window : globalThis);
  root.TVWL = root.TVWL || {};
  root.TVWL.ui = { mount, teardown, render, toast, ROOT_ID };
})();
