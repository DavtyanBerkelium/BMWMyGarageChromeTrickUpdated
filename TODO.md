# Planned / deferred

Features intentionally not built yet, each with the precondition that gates it.
(Most are blocked because the currently-tracked car is pre-production — status 102 —
so it has no VIN, no production date, and no shipping data to build or verify against.)

## Once a tracked car has a VIN (status ≥ 150)

- ~~**Deep-link to a VIN tool**~~ — DONE (2026-08-26): the VIN row links to BMW's own
  official per-VIN brochure (`https://eve.vsr.aws.bmw.cloud/brochure/<VIN>`, public, no
  login), gated on a real VIN. Verified live against the user's car.
- **Ship-tracking link** (deferred sub-item of the above). Hold until the car reaches a
  shipping status (~194/195) — and at that point also diff the TRACK payload for any new
  vessel/port fields, since BMW's feed grows new fields as the order matures.

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
