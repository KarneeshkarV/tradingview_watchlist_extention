# TradingView Unlimited Watchlists

A browser extension that adds an unlimited number of custom watchlists to TradingView's web app, stored locally in your browser.

Works in Chrome, Brave, Firefox 121+, and Zen.

## Features

- **Side panel overlay** on `tradingview.com/chart` that mimics TradingView's dark theme.
- **Multiple named watchlists** with a tab bar — create / rename (double-click tab) / delete / switch freely.
- **Click a symbol** to load it on the active chart — goes straight to the new chart, no search dialog.
- **★ button** in the panel header adds the symbol currently shown on the chart to the active list.
- **Import** symbols from your existing native TradingView watchlist with one click.
- **JSON export / import** (merge or replace) for backup and transfer between browsers.
- **Local storage only** — your lists never leave your browser.

## Install (development / unpacked)

The extension is a plain set of static files. No build step.

### Chrome / Brave

1. Open `chrome://extensions` (or `brave://extensions`).
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Pin the extension to the toolbar if you want quick access to the popup.

### Firefox / Zen

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and pick the `manifest.json` in this folder.
3. Note: temporary add-ons are removed when the browser restarts. For permanent install, sign the extension via [AMO](https://addons.mozilla.org/) or use a Developer Edition / unbranded build with `xpinstall.signatures.required` disabled.

Requires Firefox 121 or newer (Manifest V3).

## Usage

1. Open `https://www.tradingview.com/chart/`.
2. The watchlist panel appears docked on the right.
3. Click **+** in the tab bar to create a new list.
4. Type a ticker (`AAPL` or `NASDAQ:AAPL`) in the bottom input and press Enter to add.
5. Click any symbol row to swap the chart to that symbol (reloads the page on the new chart).
6. Click **★** in the header to add the currently-displayed chart symbol to the active list.
7. Click **⤓** in the header while your native TradingView watchlist is visible to import its symbols into the active custom list.
8. Use the toolbar popup for **Export JSON** and **Import JSON**.

## File layout

```
manifest.json
src/
  content/   - panel UI + TradingView DOM bridge (runs on tradingview.com)
  popup/     - toolbar popup for import/export
  lib/       - shared data model and storage wrappers
icons/       - 16/48/128 PNG icons
```

## Caveats

- Clicking a row navigates via `?symbol=...` which causes TradingView to reload onto the new chart. This is deterministic (no fragile DOM hacks) at the cost of a reload.
- Detecting the "current chart symbol" reads the URL, document title, and chart legend in that order. TradingView's DOM is not a public API, so this is best-effort.
- Lists are stored in `chrome.storage.local` and are not synced across devices. Use **Export JSON** to transfer between browsers.
- Manifest V3 only; older Firefox versions are not supported.

## License

MIT.
