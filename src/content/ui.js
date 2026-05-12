(function () {
  "use strict";

  const ROOT_ID = "tvwl-root";
  const HIDDEN_ATTR = "data-tvwl-native-hidden";
  const HOST_MIN_HEIGHT_ATTR = "data-tvwl-host-min-height";
  let nativeObserver = null;
  let themeObserver = null;
  let documentClickHandler = null;

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

  // ── Theme detection ─────────────────────────────────────────────────────
  //
  // TradingView toggles `theme-dark` / `theme-light` on the html element and
  // also exposes `data-theme` on body. We mirror that so the panel stays in
  // sync; if neither is set, we fall back to the system `prefers-color-scheme`
  // via CSS (no JS needed).

  function detectTVTheme() {
    const html = document.documentElement;
    const body = document.body;
    // 1) Class-based: TradingView uses `theme-dark` / `theme-light` somewhere.
    const themed = document.querySelector(".theme-dark, .theme-light");
    if (themed) return themed.classList.contains("theme-dark") ? "dark" : "light";
    if (html?.classList.contains("theme-dark") || body?.classList.contains("theme-dark")) return "dark";
    if (html?.classList.contains("theme-light") || body?.classList.contains("theme-light")) return "light";
    // 2) `data-theme` attribute on html/body.
    const dt = html?.getAttribute("data-theme") || body?.getAttribute("data-theme");
    if (dt === "dark" || dt === "light") return dt;
    // 3) Fall back to luminance of the body / html background.
    return luminanceTheme();
  }

  function luminanceTheme() {
    try {
      const root = document.getElementById(ROOT_ID);
      const probe = root?.parentElement || document.body || document.documentElement;
      // Walk up looking for a non-transparent background.
      let node = probe;
      while (node && node !== document.documentElement) {
        const bg = getComputedStyle(node).backgroundColor;
        const rgb = parseRgb(bg);
        if (rgb && rgb.a > 0.1) {
          const lum = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
          return lum < 128 ? "dark" : "light";
        }
        node = node.parentElement;
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  function parseRgb(s) {
    if (!s || typeof s !== "string") return null;
    const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/);
    if (!m) return null;
    return {
      r: +m[1],
      g: +m[2],
      b: +m[3],
      a: m[4] != null ? +m[4] : 1,
    };
  }

  function applyTheme(root) {
    const theme = detectTVTheme();
    if (theme) root.setAttribute("data-tvwl-theme", theme);
    else root.removeAttribute("data-tvwl-theme");
  }

  function watchTheme(root) {
    if (themeObserver) themeObserver.disconnect();
    themeObserver = new MutationObserver(() => applyTheme(root));
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    if (document.body) {
      themeObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ["class", "data-theme"],
      });
    }
  }

  function mount(ctx, nativeHost) {
    teardown();
    const embedded = !!nativeHost;
    const root = el("div", {
      id: ROOT_ID,
      class: "tvwl-root" + (embedded ? " tvwl-root--embedded" : " tvwl-root--overlay"),
    });
    applyTheme(root);
    if (embedded) {
      preserveHostHeight(nativeHost, root);
      nativeHost.appendChild(root);
      hideNativeChildren(nativeHost, root);
      nativeObserver = new MutationObserver(() => hideNativeChildren(nativeHost, root));
      nativeObserver.observe(nativeHost, { childList: true });
    } else {
      document.body.appendChild(root);
    }
    watchTheme(root);
    render(ctx, root);
    return root;
  }

  function teardown() {
    if (nativeObserver) {
      nativeObserver.disconnect();
      nativeObserver = null;
    }
    if (themeObserver) {
      themeObserver.disconnect();
      themeObserver = null;
    }
    if (documentClickHandler) {
      document.removeEventListener("mousedown", documentClickHandler, true);
      documentClickHandler = null;
    }
    restoreNativeChildren();
    restoreHostHeight();
    const old = document.getElementById(ROOT_ID);
    if (old) {
      old.setAttribute("data-tvwl-teardown", "true");
      old.remove();
    }
  }

  function preserveHostHeight(host, root) {
    if (!host.hasAttribute(HOST_MIN_HEIGHT_ATTR)) {
      host.setAttribute(HOST_MIN_HEIGHT_ATTR, host.style.minHeight || "");
    }
    const height = Math.round(host.getBoundingClientRect().height);
    if (height > 0) {
      const px = Math.max(220, height) + "px";
      host.style.minHeight = px;
      root.style.minHeight = px;
    }
  }

  function restoreHostHeight() {
    document.querySelectorAll("[" + HOST_MIN_HEIGHT_ATTR + "]").forEach((node) => {
      const previous = node.getAttribute(HOST_MIN_HEIGHT_ATTR);
      if (previous) node.style.minHeight = previous;
      else node.style.removeProperty("min-height");
      node.removeAttribute(HOST_MIN_HEIGHT_ATTR);
    });
  }

  function hideNativeChildren(host, root) {
    Array.from(host.children).forEach((child) => {
      if (child === root) return;
      if (!child.hasAttribute(HIDDEN_ATTR)) {
        child.setAttribute(HIDDEN_ATTR, child.style.display || "");
      }
      child.style.display = "none";
    });
  }

  function restoreNativeChildren() {
    document.querySelectorAll("[" + HIDDEN_ATTR + "]").forEach((node) => {
      const previous = node.getAttribute(HIDDEN_ATTR);
      if (previous) node.style.display = previous;
      else node.style.removeProperty("display");
      node.removeAttribute(HIDDEN_ATTR);
    });
  }

  function render(ctx, root) {
    const collapsed = root.classList.contains("tvwl-collapsed");
    root.innerHTML = "";
    applyTheme(root);
    root.appendChild(buildPanel(ctx, collapsed, root));
  }

  function buildPanel(ctx, collapsed, root) {
    const { state, actions } = ctx;
    const embedded = root.classList.contains("tvwl-root--embedded");
    const panel = el("div", { class: "tvwl-panel" + (collapsed ? " tvwl-panel--collapsed" : "") });
    const activeList = state.lists.find((l) => l.id === state.activeId) || state.lists[0] || null;

    panel.appendChild(buildHeader(ctx, activeList, collapsed, embedded, root));

    if (collapsed) return panel;

    if (activeList && activeList.symbols.length > 0) {
      panel.appendChild(buildColumnHeader());
    }

    if (activeList) {
      panel.appendChild(buildSymbolList(activeList, ctx, root));
      panel.appendChild(buildAddBar(activeList, actions));
    } else {
      panel.appendChild(el("div", { class: "tvwl-empty", text: "No list selected." }));
    }

    return panel;
  }

  function buildHeader(ctx, activeList, collapsed, embedded, root) {
    const { state, actions } = ctx;
    const header = el("div", { class: "tvwl-header" });

    const titleBtn = el(
      "button",
      {
        class: "tvwl-title-btn",
        title: activeList ? activeList.name : "Watchlists",
        onClick: (e) => {
          e.stopPropagation();
          toggleListMenu(ctx, header, root);
        },
      },
      [
        el("span", { class: "tvwl-title-name", text: activeList ? activeList.name : "Watchlists" }),
        el("span", { class: "tvwl-title-chev", text: "▼" }),
      ]
    );
    header.appendChild(titleBtn);

    const actionsWrap = el("div", { class: "tvwl-header-actions" });
    actionsWrap.appendChild(
      el("button", {
        class: "tvwl-icon-btn",
        title: "New list",
        text: "+",
        onClick: () => {
          const n = promptText("New list name", "New List");
          if (n) actions.createList(n);
        },
      })
    );
    actionsWrap.appendChild(
      el("button", {
        class: "tvwl-icon-btn tvwl-icon-btn--accent",
        title: "Add current chart symbol to this list",
        text: "★",
        onClick: () => actions.addCurrentSymbol(),
      })
    );
    actionsWrap.appendChild(
      el("button", {
        class: "tvwl-icon-btn",
        title: "Import from TradingView watchlist",
        text: "⤓",
        onClick: () => actions.importFromNative(),
      })
    );
    if (typeof actions.togglePopOut === "function") {
      const popped = !!(state && state.popOut);
      actionsWrap.appendChild(
        el("button", {
          class: "tvwl-icon-btn",
          title: popped ? "Dock into TradingView watchlist" : "Pop out into floating panel",
          text: popped ? "⇲" : "⛶",
          onClick: () => actions.togglePopOut(),
        })
      );
    }
    if (!embedded) {
      actionsWrap.appendChild(
        el("button", {
          class: "tvwl-icon-btn",
          title: collapsed ? "Expand" : "Collapse",
          text: collapsed ? "‹" : "›",
          onClick: () => {
            const r = document.getElementById(ROOT_ID);
            r.classList.toggle("tvwl-collapsed");
            render(ctx, r);
          },
        })
      );
    }
    header.appendChild(actionsWrap);

    return header;
  }

  function toggleListMenu(ctx, header, root) {
    const existing = root.querySelector(".tvwl-listmenu");
    if (existing) {
      existing.remove();
      if (documentClickHandler) {
        document.removeEventListener("mousedown", documentClickHandler, true);
        documentClickHandler = null;
      }
      return;
    }
    const { state, actions } = ctx;
    const menu = el("div", { class: "tvwl-listmenu" });
    state.lists.forEach((list) => {
      const item = el(
        "div",
        {
          class:
            "tvwl-listmenu-item" + (list.id === state.activeId ? " tvwl-listmenu-item--active" : ""),
          onClick: () => {
            actions.setActive(list.id);
          },
          onDblclick: () => {
            const n = promptText("Rename list", list.name);
            if (n) actions.renameList(list.id, n);
          },
        },
        [
          el("span", { class: "tvwl-listmenu-name", text: list.name }),
          el("button", {
            class: "tvwl-listmenu-del",
            title: "Delete list",
            text: "×",
            onClick: (e) => {
              e.stopPropagation();
              if (confirm("Delete list \"" + list.name + "\"?")) actions.deleteList(list.id);
            },
          }),
        ]
      );
      menu.appendChild(item);
    });
    menu.appendChild(el("div", { class: "tvwl-listmenu-sep" }));
    menu.appendChild(
      el("div", {
        class: "tvwl-listmenu-action",
        text: "+ New list",
        onClick: () => {
          const n = promptText("New list name", "New List");
          if (n) actions.createList(n);
        },
      })
    );
    header.appendChild(menu);

    documentClickHandler = (ev) => {
      if (menu.contains(ev.target)) return;
      const titleBtn = header.querySelector(".tvwl-title-btn");
      if (titleBtn && titleBtn.contains(ev.target)) return;
      menu.remove();
      document.removeEventListener("mousedown", documentClickHandler, true);
      documentClickHandler = null;
    };
    document.addEventListener("mousedown", documentClickHandler, true);
  }

  function buildColumnHeader() {
    return el("div", { class: "tvwl-colhead" }, [
      el("div", { class: "tvwl-colhead-spacer" }),
      el("div", { class: "tvwl-colhead-symbol", text: "Symbol" }),
      el("div", { class: "tvwl-colhead-last", text: "Last" }),
      el("div", { class: "tvwl-colhead-chg", text: "Chg" }),
      el("div", { class: "tvwl-colhead-chgp", text: "Chg%" }),
    ]);
  }

  // Deterministic colored avatar based on symbol hash.
  const AVATAR_COLORS = [
    "#2962ff",
    "#7e57c2",
    "#26a69a",
    "#ef5350",
    "#ff9800",
    "#5e35b1",
    "#039be5",
    "#8e24aa",
    "#43a047",
    "#fb8c00",
    "#3949ab",
    "#00897b",
  ];
  function avatarColor(text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) {
      h = (h * 31 + text.charCodeAt(i)) >>> 0;
    }
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }

  function avatarLetters(ticker) {
    if (!ticker) return "?";
    // First two letters of the ticker, like TradingView's badge style.
    return ticker.slice(0, 2).toUpperCase();
  }

  function buildSymbolList(list, ctx, root) {
    const { actions } = ctx;
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

    // Highlight the row matching the current chart symbol.
    let activeSym = null;
    try {
      const bridge = (typeof window !== "undefined" ? window : globalThis).TVWL?.bridge;
      activeSym = bridge?.currentChartSymbol ? bridge.currentChartSymbol() : null;
    } catch (e) {
      activeSym = null;
    }

    list.symbols.forEach((sym) => {
      const [exch, ticker] = sym.includes(":") ? sym.split(":") : ["", sym];
      const isActive = activeSym && (activeSym === sym || activeSym.split(":").pop() === ticker);
      const avatar = el("div", {
        class: "tvwl-row-avatar",
        text: avatarLetters(ticker),
      });
      avatar.style.background = avatarColor(sym);

      const row = el(
        "div",
        {
          class: "tvwl-row" + (isActive ? " tvwl-row--active" : ""),
          title: sym,
          "data-symbol": sym,
          onClick: () => actions.loadSymbol(sym),
        },
        [
          avatar,
          el(
            "div",
            { class: "tvwl-row-symbol" },
            [
              el("span", { class: "tvwl-row-ticker", text: ticker }),
              el("span", { class: "tvwl-row-dot" }),
            ]
          ),
          el("div", { class: "tvwl-row-last", text: "—" }),
          el("div", { class: "tvwl-row-chg", text: "" }),
          el("div", { class: "tvwl-row-chgp", text: "" }),
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

  function formatPrice(lp) {
    if (typeof lp !== "number" || !isFinite(lp)) return "—";
    const abs = Math.abs(lp);
    const dp = abs >= 100 ? 2 : abs >= 1 ? 2 : 4;
    return lp.toLocaleString(undefined, {
      minimumFractionDigits: dp,
      maximumFractionDigits: dp,
    });
  }

  function formatChange(ch) {
    if (typeof ch !== "number" || !isFinite(ch)) return "";
    const sign = ch > 0 ? "+" : ch < 0 ? "−" : "";
    const abs = Math.abs(ch);
    const dp = abs >= 100 ? 2 : abs >= 1 ? 2 : 4;
    return (
      sign +
      abs.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })
    );
  }

  function formatChangePct(chp) {
    if (typeof chp !== "number" || !isFinite(chp)) return "";
    const sign = chp > 0 ? "+" : chp < 0 ? "−" : "";
    return sign + Math.abs(chp).toFixed(2) + "%";
  }

  function paintRow(row, quote) {
    if (!row || !quote) return;
    const lastEl = row.querySelector(".tvwl-row-last");
    const chgEl = row.querySelector(".tvwl-row-chg");
    const chgpEl = row.querySelector(".tvwl-row-chgp");

    if (lastEl) {
      const prev = lastEl.getAttribute("data-last");
      const next = formatPrice(quote.lp);
      lastEl.textContent = next;
      if (prev != null && prev !== next && typeof quote.lp === "number") {
        const prevNum = parseFloat(prev.replace(/[, ]/g, ""));
        const dir = !isFinite(prevNum) || quote.lp > prevNum ? "up" : "down";
        const cls = "tvwl-row-last--flash-" + dir;
        lastEl.classList.add(cls);
        setTimeout(() => lastEl.classList.remove(cls), 350);
      }
      lastEl.setAttribute("data-last", next);
    }

    const dir =
      typeof quote.ch === "number" && quote.ch !== 0 ? (quote.ch > 0 ? "up" : "down") : null;

    if (chgEl) {
      chgEl.textContent = formatChange(quote.ch);
      chgEl.classList.remove("tvwl-row-chg--up", "tvwl-row-chg--down");
      if (dir) chgEl.classList.add("tvwl-row-chg--" + dir);
    }
    if (chgpEl) {
      chgpEl.textContent = formatChangePct(quote.chp);
      chgpEl.classList.remove("tvwl-row-chgp--up", "tvwl-row-chgp--down");
      if (dir) chgpEl.classList.add("tvwl-row-chgp--" + dir);
    }
  }

  function applyQuotes(root, symbols, quoteFeed) {
    if (!root || !quoteFeed) return;
    const iter = symbols && typeof symbols.forEach === "function" ? symbols : null;
    if (iter) {
      iter.forEach((sym) => {
        const row = root.querySelector(
          '.tvwl-row[data-symbol="' + CSS.escape(sym) + '"]'
        );
        const q = quoteFeed.getQuote(sym);
        if (row && q) paintRow(row, q);
      });
      return;
    }
    root.querySelectorAll(".tvwl-row[data-symbol]").forEach((row) => {
      const sym = row.getAttribute("data-symbol");
      const q = quoteFeed.getQuote(sym);
      if (q) paintRow(row, q);
    });
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
  root.TVWL.ui = { mount, teardown, render, toast, applyQuotes, ROOT_ID };
})();
