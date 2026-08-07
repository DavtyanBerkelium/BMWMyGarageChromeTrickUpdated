# BMW MyGarage Chrome Trick

A Chrome extension that exposes the production status, options list, and other vehicle data that BMW's MyGarage dashboard hides behind its summary view.

## What it shows

When you click the toolbar icon on `mygarage.bmwusa.com`, an "Additional Vehicle Details" panel is rendered under the selected vehicle with:

- **Status Code** (e.g. 102, 150, 155, 196) and the matching status messages (an unrecognized code shows the number alone)
- **Plain-language status note** for the key milestones — e.g. status 112 is flagged as the last chance to change the order, 150 as "spec is now locked"
- **Next milestone** — the next expected production step, inferred from a curated status ladder
- **VIN** (as soon as BMW assigns one — typically at status 150)
- **Production Date** and **Retail Date** — with a short note, while the date is still hidden, explaining that BMW's customer API only publishes it at status 150 (your dealer / the Genius line can quote the scheduled week earlier)
- **Model**, **Exterior**, and **Interior** color
- **Added options** (the package you configured)
- **Option packages** with their contents and, when BMW's feed provides one, the package MSRP on the header (e.g. "Carbon Package (8) — $14,300"); a "&lt;Package&gt; Content" breakdown section in the feed is folded into its parent package
- **Standard Features** (the full ~50-item list)
- A **View 360°** button that loads BMW's turntable renders of your exact build (36 frames, fetched on demand and cached) into a drag-to-rotate viewer
- A **Copy details** button to export the panel as plain text

The data is sourced from BMW's own internal API — the extension passively observes the responses BMW's frontend already fetches.

## Install

1. Download / clone this folder so you have a local copy.
2. Open `chrome://extensions/` in Chrome.
3. Toggle **Developer mode** on (top-right corner).
4. Click **Load unpacked** and select this `mygarage` folder.
5. Pin the extension icon to your toolbar (puzzle-piece menu → pin).

## Use

1. Go to <https://mygarage.bmwusa.com/dashboard.html> and sign in.
2. Click a vehicle in the top thumbnail bar.
3. Click the extension's toolbar icon.

The details panel appears under the vehicle card. Click the icon again to refresh, or click a different vehicle and click the icon again to see that one.

If you click the icon before BMW's frontend has finished loading the data, the extension will fetch it itself using the auth headers it already sniffed.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest. Restricts the extension to `mygarage.bmwusa.com` only. |
| `before.js` | Runs at `document_start` in the page's main world. Hooks `fetch` and `XMLHttpRequest` so any response containing `dataContent.prodVehicleDetails[0]` is indexed by production number. |
| `execute.js` | Runs when the toolbar icon is clicked. Reads the selected vehicle from `sessionStorage`, looks up the captured detail, and injects the panel. |
| `background.js` | Service worker. Listens for the toolbar click and runs `execute.js` in the page's main world. |

## Updating after code changes

Edit a file, then go back to `chrome://extensions/` and click the circular reload arrow on the extension's tile. Reload the BMW tab afterwards so the new `before.js` runs.

## Permissions

- `host_permissions: https://mygarage.bmwusa.com/*` — only this domain. Also grants
  the host access `execute.js` needs when injected on click.
- `scripting` — to inject `execute.js` on click.

No data leaves your browser; the extension only reads what BMW's own page already has.

### Security note

To load extra details on demand, the extension reads the `Authorization` token the
page already sends and replays it — only to the BMW origin, never to any third
party. The captured token is held in page memory (`window.__bmwCapture`) for the
lifetime of the tab. This is the user's own session credential on the user's own
machine; nothing is persisted or transmitted off-origin.

## Compatibility

- Chrome / Edge 111+ (Chromium 111+ for Brave / Opera). The capture script is a
  static content script declared with `"world": "MAIN"`, which Chrome only honors
  from version 111 — on older builds the panel never loads.
- Manifest V3.
