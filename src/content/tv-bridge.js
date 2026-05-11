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

  const root = (typeof window !== "undefined" ? window : globalThis);
  root.TVWL = root.TVWL || {};
  root.TVWL.bridge = {
    loadSymbol,
    readNativeWatchlist,
    currentChartSymbol,
    findNativeWatchlistHost,
  };
})();
