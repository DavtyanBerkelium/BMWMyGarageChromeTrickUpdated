# Planned / deferred

Features intentionally not built yet, each with the precondition that gates it.
(Most are blocked because the currently-tracked car is pre-production — status 102 —
so it has no VIN, no production date, and no shipping data to build or verify against.)

## Once a tracked car has a VIN (status ≥ 150)

- **Deep-link buttons to external VIN tools** (Tier-2 #19). Add buttons on the panel
  that open the VIN in free window-sticker / VIN-decoder / ship-tracking web tools,
  shown only once `detail.vin` is a real VIN (not the `"null"` sentinel). Needs a real
  VIN to confirm those tools accept the BMW VIN format and deep-link correctly.

## Needs a live data sample to build correctly

- **Build-week / calendar-week formatting of `prodDate`** (Tier-2 #6). We have not yet
  observed a real `prodDate` — it returns the string `"null"` pre-production. Build and
  verify once a car is at status ≥ 150.
- **BMW notifications timeline** (Tier-2 #9). Surface the `notifications` rel/endpoint
  (recalls, alerts). Its JSON shape is unconfirmed — capture one live response first.

## Bigger / scope-expanding (Tier 3)

- **Owned-car support** (fuel/mileage, warranty, owner's manual) — needs one live
  owned-car (`ESA`/owner) response to lock field names; touches the `before.js` capture
  filter.
- **Status-change notifications** (`chrome.storage` + `chrome.notifications`) — adds
  permissions (would change the current `scripting`-only surface) and persistence.
