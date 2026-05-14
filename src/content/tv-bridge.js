(function () {
  "use strict";

  const LOG = "[TVWL]";

  // Selectors that depend on TradingView's DOM. Centralized so a future TV
  // redesign means editing only this file.
  const SEL = {
    // Native watchlist rows render with these attributes.
    nativeWatchlistRow: 'div[data-symbol-full], [data-name="list-item"][data-symbol-full]',
    nativeWatchlistRoot:
      '[data-name="watchlist"], [data-name="watchlist-widget"], [data-widget-type="watchlist"]',
    legendTitle: '[data-name="legend-source-title"]',
    legendItem: '[data-name="legend-source-item"]',
  };

  function loadSymbol(symbol) {
    if (!symbol || typeof symbol !== "string") return Promise.resolve(false);
    try {
      const url = new URL(location.href);
      // Preserve the current chart path (including saved chart IDs) and just
      // swap the symbol query param. TradingView opens directly on the new
      // chart with no search dialog — at the cost of a page reload.
      url.searchParams.set("symbol", symbol);
      location.assign(url.toString());
      return Promise.resolve(true);
    } catch (e) {
      console.warn(LOG, "loadSymbol failed", e);
      return Promise.resolve(false);
    }
  }

  function readNativeWatchlist() {
    const rows = document.querySelectorAll(SEL.nativeWatchlistRow);
    const out = [];
    const seen = new Set();
    rows.forEach((row) => {
      const sym = row.getAttribute("data-symbol-full");
      if (sym && !seen.has(sym)) {
        seen.add(sym);
        out.push(sym);
      }
    });
    return out;
  }

  function findNativeWatchlistHost() {
    const directRoot = findVisibleNativeRoot();
    if (directRoot) return directRoot;

    const rows = Array.from(document.querySelectorAll(SEL.nativeWatchlistRow));
    if (rows.length === 0) return null;

    const firstRow = rows[0];
    const namedRoot = firstRow.closest(SEL.nativeWatchlistRoot);
    if (isUsableNativeHost(namedRoot, rows)) return namedRoot;

    const candidate = findBestWatchlistAncestor(firstRow, rows);
    return candidate || null;
  }

  function isUsableNativeHost(node, rows) {
    if (!node || node === document.body || node === document.documentElement) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width < 160 || rect.height < 80) return false;
    if (rect.right < window.innerWidth - 700) return false;
    return rows.some((row) => node.contains(row));
  }

  function findBestWatchlistAncestor(row, rows) {
    let best = null;
    let node = row.parentElement;
    const maxHeight = Math.max(260, window.innerHeight * 0.75);

    while (node && node !== document.body && node !== document.documentElement) {
      const rect = node.getBoundingClientRect();
      const rowCount = rows.filter((r) => node.contains(r)).length;
      const rightSidebarLike = rect.right > window.innerWidth - 700 && rect.width >= 160 && rect.width <= 520;
      const hasUsefulHeight = rect.height >= 80 && rect.height <= maxHeight;

      if (rowCount > 0 && rightSidebarLike && hasUsefulHeight) {
        best = node;
      }

      node = node.parentElement;
    }

    return best;
  }

  function findVisibleNativeRoot() {
    const roots = Array.from(document.querySelectorAll(SEL.nativeWatchlistRoot));
    return roots.find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width >= 160 && rect.height >= 80 && rect.right > window.innerWidth - 700;
    }) || null;
  }

  function currentChartSymbol() {
    // Read from what the user actually sees on the page. URL is intentionally
    // ignored — TradingView's SPA leaves `?symbol=` stale when symbols are
    // changed via the header search.

    // 1) Try data attributes on the chart legend's source item — when TV
    //    populates these, they carry the full EXCHANGE:TICKER.
    const itemEls = document.querySelectorAll(SEL.legendItem);
    for (const el of itemEls) {
      const ds = el.getAttribute("data-symbol-full") || el.getAttribute("data-symbol");
      if (ds) return ds.toUpperCase();
    }
    const titleEls = document.querySelectorAll(SEL.legendTitle);
    for (const el of titleEls) {
      const ds = el.getAttribute("data-symbol-full") || el.getAttribute("data-symbol");
      if (ds) return ds.toUpperCase();
    }

    // 2) Construct EXCHANGE:TICKER from the header symbol button (ticker) +
    //    the legend's trailing exchange suffix, which TV renders as
    //    "<description> · <interval> · <EXCHANGE>".
    const ticker = readHeaderTicker();
    const exchange = readLegendExchange();
    if (ticker && exchange) return exchange + ":" + ticker;
    if (ticker) return ticker;

    // 3) Document title fallback ("AAPL Stock Price — NASDAQ:AAPL — TradingView").
    const titleMatch =
      document.title && document.title.match(/[—–-]\s+([A-Z0-9_.]+:[A-Z0-9_.]+)\s+[—–-]/);
    if (titleMatch) return titleMatch[1];

    return null;
  }

  function readHeaderTicker() {
    const btn = document.querySelector(
      '#header-toolbar-symbol-search, button[data-name="symbol-search-button"]'
    );
    if (!btn) return null;
    const text = (btn.textContent || "").trim();
    // Pull the first uppercase ticker-like token (handles surrounding labels/spaces).
    const m = text.match(/[A-Z0-9][A-Z0-9_.]*/);
    return m ? m[0] : null;
  }

  function readLegendExchange() {
    const el = document.querySelector(SEL.legendTitle) || document.querySelector(SEL.legendItem);
    if (!el) return null;
    const text = (el.textContent || "").trim();
    if (!text) return null;
    // TV separates parts with U+00B7 (·) but occasionally U+2022 (•).
    const parts = text.split(/[·•]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    const last = parts[parts.length - 1].toUpperCase();
    return /^[A-Z0-9_.]+$/.test(last) ? last : null;
  }

  // --- Live quotes via TradingView's data WebSocket -----------------------
  //
  // Talks to wss://data.tradingview.com/socket.io/websocket using TV's
  // ~m~<len>~m~<payload> framing. The unauthorized token works for delayed
  // quotes on most exchanges; that matches what the native watchlist shows
  // for non-logged-in users.

  const WS_URL = "wss://data.tradingview.com/socket.io/websocket";
  const AUTH_TOKEN = "unauthorized_user_token";
  const QUOTE_FIELDS = [
    "lp",
    "ch",
    "chp",
    "short_name",
    "description",
    "exchange",
    "currency_code",
  ];

  function makeQuoteFeed() {
    let ws = null;
    let connecting = false;
    let sessionId = null;
    let reconnectAttempts = 0;
    let reconnectTimer = null;
    let visibilityHooked = false;
    let started = false;
    let recvBuffer = "";

    const subscribed = new Set(); // symbols currently on the server
    const desired = new Set(); // symbols we want subscribed
    const cache = new Map(); // symbol -> { lp, ch, chp, ... }
    const pendingChanges = new Set();
    let rafHandle = null;
    let listener = null;

    function frame(payload) {
      // length is JS string length, which matches what TV's reference clients
      // use (their UI sends the same way).
      return "~m~" + payload.length + "~m~" + payload;
    }

    function send(method, params) {
      if (!ws || ws.readyState !== 1) return;
      const payload = JSON.stringify({ m: method, p: params });
      try {
        ws.send(frame(payload));
      } catch (e) {
        console.warn(LOG, "ws send failed", e);
      }
    }

    function newSessionId() {
      const rand = Math.random().toString(16).slice(2, 14).padEnd(12, "0");
      return "qs_" + rand;
    }

    function openSocket() {
      if (ws || connecting) return;
      if (document.visibilityState === "hidden") return;
      connecting = true;
      try {
        ws = new WebSocket(WS_URL);
      } catch (e) {
        console.warn(LOG, "ws open failed", e);
        ws = null;
        connecting = false;
        scheduleReconnect();
        return;
      }
      ws.addEventListener("open", onOpen);
      ws.addEventListener("message", onMessage);
      ws.addEventListener("close", onClose);
      ws.addEventListener("error", onError);
    }

    function closeSocket() {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      subscribed.clear();
      if (!ws) return;
      try {
        ws.close();
      } catch (e) {
        /* noop */
      }
      ws = null;
      connecting = false;
    }

    function scheduleReconnect() {
      if (reconnectTimer) return;
      if (!started) return;
      if (document.visibilityState === "hidden") return;
      const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts));
      reconnectAttempts++;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        openSocket();
      }, delay);
    }

    function onOpen() {
      connecting = false;
      reconnectAttempts = 0;
      sessionId = newSessionId();
      subscribed.clear();
      send("set_auth_token", [AUTH_TOKEN]);
      send("quote_create_session", [sessionId]);
      send("quote_set_fields", [sessionId].concat(QUOTE_FIELDS));
      reconcile();
    }

    function onClose() {
      ws = null;
      connecting = false;
      subscribed.clear();
      scheduleReconnect();
    }

    function onError() {
      // close handler will run next and trigger reconnect.
    }

    function onMessage(ev) {
      recvBuffer += typeof ev.data === "string" ? ev.data : "";
      let payload;
      while ((payload = takeFrame()) !== null) {
        handlePayload(payload);
      }
    }

    function takeFrame() {
      // Frames look like: ~m~<digits>~m~<payload of that many chars>
      if (recvBuffer.length < 4) return null;
      if (!recvBuffer.startsWith("~m~")) {
        // Resync — drop everything up to the next header.
        const i = recvBuffer.indexOf("~m~");
        if (i < 0) {
          recvBuffer = "";
          return null;
        }
        recvBuffer = recvBuffer.slice(i);
        if (recvBuffer.length < 4) return null;
      }
      const second = recvBuffer.indexOf("~m~", 3);
      if (second < 0) return null;
      const len = parseInt(recvBuffer.slice(3, second), 10);
      if (!Number.isFinite(len) || len < 0) {
        recvBuffer = recvBuffer.slice(second + 3);
        return null;
      }
      const start = second + 3;
      if (recvBuffer.length < start + len) return null;
      const payload = recvBuffer.slice(start, start + len);
      recvBuffer = recvBuffer.slice(start + len);
      return payload;
    }

    function handlePayload(payload) {
      if (payload.startsWith("~h~")) {
        // Heartbeat — echo it back verbatim (re-framed).
        if (ws && ws.readyState === 1) {
          try {
            ws.send(frame(payload));
          } catch (e) {
            /* noop */
          }
        }
        return;
      }
      let obj;
      try {
        obj = JSON.parse(payload);
      } catch (e) {
        return;
      }
      if (!obj || typeof obj !== "object") return;
      if (obj.m === "qsd" && Array.isArray(obj.p) && obj.p.length >= 2) {
        const item = obj.p[1];
        if (item && item.n && item.v) {
          const prev = cache.get(item.n) || {};
          cache.set(item.n, Object.assign({}, prev, item.v));
          pendingChanges.add(item.n);
          scheduleFlush();
        }
      }
    }

    function scheduleFlush() {
      if (rafHandle != null) return;
      rafHandle = requestAnimationFrame(() => {
        rafHandle = null;
        if (pendingChanges.size === 0) return;
        const changed = pendingChanges;
        // Hand listener a snapshot, then start a new set so updates during
        // the callback aren't lost.
        // eslint-disable-next-line no-undef
        const cb = listener;
        // Replace the set reference atomically.
        const snapshot = new Set(changed);
        changed.clear();
        if (cb) {
          try {
            cb(snapshot);
          } catch (e) {
            console.warn(LOG, "quote listener threw", e);
          }
        }
      });
    }

    function reconcile() {
      if (!ws || ws.readyState !== 1 || !sessionId) return;
      const toAdd = [];
      const toRemove = [];
      for (const sym of desired) {
        if (!subscribed.has(sym)) toAdd.push(sym);
      }
      for (const sym of subscribed) {
        if (!desired.has(sym)) toRemove.push(sym);
      }
      if (toRemove.length > 0) {
        send("quote_remove_symbols", [sessionId].concat(toRemove));
        for (const s of toRemove) subscribed.delete(s);
      }
      if (toAdd.length > 0) {
        send("quote_add_symbols", [sessionId].concat(toAdd));
        for (const s of toAdd) subscribed.add(s);
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        closeSocket();
      } else if (started) {
        openSocket();
      }
    }

    return {
      start() {
        if (started) {
          openSocket();
          return;
        }
        started = true;
        if (!visibilityHooked) {
          document.addEventListener("visibilitychange", onVisibilityChange);
          visibilityHooked = true;
        }
        openSocket();
      },
      stop() {
        started = false;
        closeSocket();
        if (visibilityHooked) {
          document.removeEventListener("visibilitychange", onVisibilityChange);
          visibilityHooked = false;
        }
      },
      setSymbols(symbols) {
        desired.clear();
        for (const s of symbols || []) {
          if (typeof s === "string" && s.length > 0) desired.add(s);
        }
        reconcile();
      },
      getQuote(symbol) {
        return cache.get(symbol) || null;
      },
      setUpdateListener(cb) {
        listener = typeof cb === "function" ? cb : null;
      },
    };
  }

  const quoteFeed = makeQuoteFeed();

  // --- Symbol logos -------------------------------------------------------
  //
  // TradingView serves logos at https://s3-symbol-logo.tradingview.com/<id>.svg
  // The <id> comes from the `logoid` field on a symbol info record. We resolve
  // it via the scanner endpoint, which returns CORS-friendly JSON. Misses are
  // cached as `null` so we don't refetch on every render.

  const LOGO_IMG_BASE = "https://s3-symbol-logo.tradingview.com/";
  const LOGO_INFO_URL = "https://scanner.tradingview.com/symbol";

  function makeLogoCache() {
    // symbol -> string logoid | null (no logo / failed) | undefined (untried)
    const cache = new Map();
    const pending = new Map(); // symbol -> Promise<string|null>

    function logoUrlFromId(id) {
      if (!id || typeof id !== "string") return null;
      return LOGO_IMG_BASE + encodeURI(id) + ".svg";
    }

    function getCached(symbol) {
      if (!symbol) return undefined;
      return cache.get(symbol);
    }

    function fetchLogoId(symbol) {
      if (!symbol || typeof symbol !== "string") return Promise.resolve(null);
      if (cache.has(symbol)) return Promise.resolve(cache.get(symbol));
      const existing = pending.get(symbol);
      if (existing) return existing;

      const url = LOGO_INFO_URL +
        "?symbol=" + encodeURIComponent(symbol) +
        "&fields=logoid,base-currency-logoid,currency-logoid";
      const promise = fetch(url, { credentials: "omit", cache: "force-cache" })
        .then((r) => (r && r.ok ? r.json() : null))
        .then((data) => {
          let id = null;
          if (data && typeof data === "object") {
            const fields = ["logoid", "base-currency-logoid", "currency-logoid"];
            for (const f of fields) {
              if (typeof data[f] === "string" && data[f].length > 0) {
                id = data[f];
                break;
              }
            }
          }
          cache.set(symbol, id);
          pending.delete(symbol);
          return id;
        })
        .catch(() => {
          cache.set(symbol, null);
          pending.delete(symbol);
          return null;
        });
      pending.set(symbol, promise);
      return promise;
    }

    return {
      getCached,
      fetchLogoId,
      logoUrlFromId,
      logoUrlFor(symbol) {
        return logoUrlFromId(cache.get(symbol));
      },
    };
  }

  const logoCache = makeLogoCache();

  const root = (typeof window !== "undefined" ? window : globalThis);
  root.TVWL = root.TVWL || {};
  root.TVWL.bridge = {
    loadSymbol,
    readNativeWatchlist,
    currentChartSymbol,
    findNativeWatchlistHost,
    quoteFeed,
    logoCache,
  };
})();
