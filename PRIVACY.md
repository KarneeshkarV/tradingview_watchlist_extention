# Privacy Policy — TradingView Unlimited Watchlists

_Last updated: 2026-05-12_

## Summary

**This extension does not collect, transmit, or share any personal data.**

## What the extension stores

The extension stores the following **locally in your browser only**, using the standard `chrome.storage.local` API:

- The watchlists you create (names and the ticker symbols you add).
- UI state related to those watchlists (e.g. which tab is active).

This data never leaves your device. There is no remote server, no analytics, no telemetry, and no third-party SDK.

## What the extension accesses

- **`storage` permission** — used solely to persist your watchlists locally.
- **`activeTab` permission** — used by the toolbar popup to interact with the current TradingView tab when you click the extension icon.
- **Host access to `https://*.tradingview.com/*`** — required to inject the custom watchlist panel into TradingView's chart page. The extension only reads page content needed to display the panel and identify the current chart symbol; nothing is transmitted off-device.

## Data sharing

None. The extension makes no network requests of its own.

## Data deletion

To delete all stored data, remove the extension from your browser, or use **Export JSON** / clear-list controls inside the extension.

## Contact

Questions or concerns: subs@valura.ai
