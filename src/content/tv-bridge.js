(function () {
  "use strict";

  const LOG = "[TVWL]";

  // Selectors that depend on TradingView's DOM. Centralized so a future TV
  // redesign means editing only this file.
  const SEL = {
    // Native watchlist rows render with these attributes.
    nativeWatchlistRow: 'div[data-symbol-full], [data-name="list-item"][data-symbol-full]',
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
  root.TVWL.bridge = { loadSymbol, readNativeWatchlist, currentChartSymbol };
})();
