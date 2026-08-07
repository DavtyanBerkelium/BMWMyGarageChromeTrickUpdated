# Design: Auto-inject + Shadow-DOM panel (Tier-2 #14 + #12)

Date: 2026-06-17
Status: Approved (design); implementation pending

## Summary

Today the "Additional Vehicle Details" panel only appears when the user clicks the
toolbar icon — `execute.js` is injected on click and does the rendering. This change
makes the panel **auto-show** on the dashboard (and re-show when the user switches
vehicles), turns the toolbar click into a **visibility toggle**, and renders the panel
into a **Shadow DOM** so BMW's CSS and the panel's CSS can't interfere with each other
(and so the panel can support light/dark theming).

## Decisions (settled during brainstorming)

- **Interaction model:** auto-show; the toolbar click **toggles** the panel's visibility.
- **Data strategy:** **proactive fetch** — `before.js` does the two-step `core → TRACK`
  fetch itself (using the sniffed bearer token) so the panel reliably appears on the
  dashboard without the user navigating into the track view.
- **Scope:** auto-show applies to **TRACK** (on-order) vehicles only. Owned/`ESA` cars
  have no `prodVehicleDetails`; the controller renders nothing for them (no errors).
- **Architecture:** three focused files (`panel.js` view, `before.js` capture+controller,
  `execute.js` click), not one large file.

## Goals / Non-goals

Goals:
- Panel appears automatically for the selected TRACK vehicle, no click required.
- Toolbar click hides/shows the panel; if nothing is rendered yet, it triggers a render.
- Panel is isolated from BMW's page styles via Shadow DOM, with `prefers-color-scheme`
  light/dark theming.
- No loss of existing behavior or test coverage.

Non-goals (unchanged from today / explicitly out of scope):
- Owned-car support (Tier 3).
- Status-change notifications / persistence (Tier 3).
- Any new permissions — stays `scripting` + the single host permission.
- No writes to BMW, no credentials handling, nothing leaves the browser.

## Architecture

Three content-script units in the page MAIN world, plus the unchanged click injection.

### `panel.js` (new) — the view

- Owns: `BMW_STATUS_NAMES`, `BMW_STATUS_NOTES`, `STATUS_LADDER`, `CHASSIS_BY_AG_CODE`,
  `HTML_ESCAPES`, `escapeHtml`, `stripCodePrefix`, and `renderDetail` — moved verbatim
  out of `execute.js` (behavior-identical output).
- Exposes a single global namespace:
  - `globalThis.__bmwPanel.render(detail, selected)` — (re)render the panel content for
    a given detail + selected-vehicle object.
  - `globalThis.__bmwPanel.toggle()` — flip panel visibility (no-op if not yet rendered).
  - `globalThis.__bmwPanel.isRendered()` — whether a panel host currently exists.
- Mounting: create a host `<div id="bmw-trick-host">` at the existing target
  (`.o-vehicle-details` → `.t-dashboard` → `main`, else `document.body` afterbegin),
  `host.attachShadow({ mode: 'open' })`, and write the panel markup + a `<style>` block
  into the shadow root. Re-rendering replaces the shadow root's content in place; it does
  not re-insert the host unless the host was removed from the DOM.
- Theming (#12): the current inline styles move into the shadow `<style>` as classes,
  with an `@media (prefers-color-scheme: dark)` block (dark background, light text; the
  `#666`/`#444`/`#555` hint colors become a CSS variable with a dark variant).
- Toggle: `host.style.display` is flipped; visibility state is held in memory only.

### `before.js` — capture + auto-show controller

- Keeps the existing fetch/XHR capture hooks and `__bmwCapture` unchanged.
- Adds a controller that owns "when is there something to draw and how do I get it":
  - The two-step `core → TRACK` fallback fetch (moved here from `execute.js`), reused for
    proactive auto-show.
  - A lightweight poll (~1s `setInterval`) that reads `selected-vehicle` from
    sessionStorage and checks for the captured token (`__bmwCapture.headers`). When the
    selected production number changes (or first becomes available with a token), it:
    1. If `relationshipType !== 'TRACK'` → remove the panel host (if any) and stop.
    2. Else if `__bmwCapture.byProdNum[prodNum].packageDetails` exists → render from cache.
    3. Else → proactive `core → TRACK` fetch, store into `__bmwCapture`, then render.
  - Re-mount guard: if the panel host was torn out by SPA navigation but the selection is
    unchanged, re-render.
  - Exposes `globalThis.__bmwTrick.showOrRefresh({ interactive })` and
    `globalThis.__bmwTrick.toggle()` for the click path:
    - `showOrRefresh({ interactive })` runs the cache-or-fetch-then-render flow above.
      On failure: `interactive: true` → one alert (session expired / API changed);
      `interactive: false` → `console` only.
    - The ~1s poll calls `showOrRefresh({ interactive: false })` (silent on failure).
    - `toggle()` = if a panel is rendered, `__bmwPanel.toggle()`; else
      `showOrRefresh({ interactive: true })` (a click is always user-initiated).

### `execute.js` — click handler (shrinks)

- On injection (toolbar click): call `globalThis.__bmwTrick.toggle()` if present, else a
  single fallback alert ("reload the page") — ~3 lines.

### `background.js` / `manifest.json`

- `background.js` unchanged (still injects `execute.js` on click).
- `manifest.json` `content_scripts[0].js` becomes `["panel.js", "before.js"]` (panel first
  so `__bmwPanel` exists before the controller references it), still `document_start`,
  still `world: "MAIN"`, same single host match. No permission changes.

## Data flow

```
page load → before.js hooks installed → page fires authorized XHRs
          → token captured into __bmwCapture.headers
controller poll tick → (token? selected TRACK vehicle?) → yes
          → cache hit ? render : proactive core→TRACK fetch → render
          → __bmwPanel.render(detail, selected) → Shadow DOM panel shown
user switches vehicle → poll sees new prodNum → re-fetch/render
user clicks toolbar → execute.js → __bmwTrick.toggle() → show/hide host
```

## Error handling

- Proactive fetch failures (HTTP 401/403, NO_LINKS, NO_REL, NO_DETAIL) on the auto path
  (`interactive: false`): log to `console`, render nothing, leave any prior panel intact.
  No alert spam on load.
- Click path with no data (`interactive: true`): surface the existing "session expired /
  API changed / try again" messages (one alert), unchanged from today.
- Non-TRACK selected vehicle: controller renders nothing and clears a stale panel.
- All sessionStorage / JSON parsing stays guarded (try/catch), as today.

## Testing

- **Harness:** extend the node:vm fakes with `attachShadow` returning a fake shadow root
  that records its `innerHTML` (so existing rendered-output assertions transfer).
- **panel.js (moved render tests):** status decode + note + Next, prefix strips, XSS
  escaping, `"null"` sentinel, copy button, caveat, unmapped-agModelCode hint — all the
  current `execute.js` render assertions, re-pointed.
- **panel.js (new):** renders into a shadow root (not the light DOM); `toggle()` flips
  visibility; theming `<style>` present.
- **before.js (controller, new):** token-wait then proactive fetch renders; selection
  change re-renders; non-TRACK renders nothing; cache hit skips the fetch; auto-path
  failure renders nothing without throwing.
- **execute.js:** click calls `__bmwTrick.toggle()`.
- All existing capture tests for `before.js` remain.

## Risks & migration

- Largest change so far: 3-file restructure, render + fallback relocate, new polling
  controller, manifest `js` array change. Every existing test gets re-pointed; no coverage
  is dropped.
- New failure surface is the ~1s poll lifecycle (avoid flicker / duplicate renders / leaked
  intervals). Mitigation: the controller tracks the last-rendered prod number and only
  re-renders on an actual change; the host is reused in place.
- Behavior-preserving constraint: `renderDetail`'s output stays byte-identical except for
  being wrapped in the Shadow DOM host and styled via classes instead of inline styles.
```
