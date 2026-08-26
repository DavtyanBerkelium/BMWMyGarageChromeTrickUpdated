# BMW MyGarage Chrome Trick

**See everything BMW knows about your on-order car — status codes, build data,
and your full option list — right on the MyGarage page.**

If you're waiting on a build, you know the routine: refresh MyGarage, read
"Order received" for the 40th time, then head to the forums to decode what's
*really* happening. Maybe you've even tried the F12 trick from the order-tracking
threads — digging through DevTools for the hidden response with your status code
and options. This extension does all of that for you. One click, right on the
page:

![The Additional Vehicle Details panel for a 2027 M3 order at status 150: decoded status with a plain-language note, the current status message, the next milestone, the VIN with a link to BMW's official brochure, model and color codes with decoded paint/upholstery, and the priced option packages with the Carbon Package contents folded in](docs/panel.png)

*A real example (order at status 150 — production started) — every line is data
BMW's page already downloaded but never shows you.*

## What you'll see

- **The real factory status code** (102, 111, 112, 150 …) with its meaning in
  plain English — including the ones that matter: **112 = your last chance to
  change the order**, **150 = spec locked, production started**.
- **What's next** — the upcoming step in the production chain.
- **VIN** as soon as BMW assigns it (at status 150). Meanwhile your dealer or the
  **BMW Genius line (1-844-443-6487)** can quote your scheduled build week early —
  reliably once you hit status 112.
- **View BMW brochure** — once your VIN exists, a one-click link to BMW's own
  official per-VIN digital brochure: a full spec sheet and image gallery of your
  exact build.
- **Your full build sheet** — every option package with its price and contents,
  the complete standard-features list, and your paint/interior with the short
  factory codes (the ones on the dealer's Vehicle Inquiry Report).
- **A 360° spin of your exact build** — BMW renders your actual configuration
  from every angle; the View 360° button turns that into a drag-to-rotate viewer.
- **Copy details** — one click, then paste your build straight into your order
  thread.

## Install (about 2 minutes, nothing technical)

1. Click the green **Code** button at the top of this page → **Download ZIP**,
   then unzip it somewhere you won't delete. *(If you use git: just clone.)*
2. Type `chrome://extensions` in Chrome's address bar and press Enter.
3. Turn on **Developer mode** (toggle, top-right corner).
4. Click **Load unpacked** and pick the unzipped folder.
5. Pin the icon: puzzle-piece menu (top right of Chrome) → pin.

Works on Chrome, Edge, Brave, and Opera — any version from 2023 or newer.

## Using it

1. Sign in at [mygarage.bmwusa.com](https://mygarage.bmwusa.com/dashboard.html).
2. Click your car in the top thumbnail bar.
3. Click the extension's icon. That's it. Click it again to refresh, or after
   switching cars.

## Common questions

**Is this safe? Where does my data go?**
Nowhere. There's no server, no account, no tracking — the extension only reads
the data BMW's own page already loaded into *your* browser, and the only place
it ever talks to is BMW itself. It can't even see other websites: its access is
locked to `mygarage.bmwusa.com` and nothing else. All the code is right here in
this repo if you want to check.

**Do I give it my BMW password?**
No. You log into MyGarage like you always do. The extension never sees or asks
for credentials.

**Why does it say "No VIN assigned yet"?**
BMW reveals the VIN once your car physically enters production (status 150).
Before that it exists only in dealer systems — ask your dealer or call the Genius
line for your build week.

**My status hasn't moved in weeks — is it broken?**
Probably not: early statuses (102, 111) genuinely sit for weeks, and BMW's
tracker can lag the factory by a day or two. The panel shows exactly what BMW's
system reports, no more and no less.

**Will this break when BMW updates their site?**
It might — it reads BMW's internal data, and BMW can reshape it whenever they
like. If something looks off, check back here for an update.

<details>
<summary><strong>For the technically curious — how it works & tests</strong></summary>

The extension never talks to anything except BMW. A small script watches the API
responses BMW's frontend already fetches and indexes them; clicking the icon
renders what was captured (or re-fetches it with the page's own session token if
BMW hasn't loaded it yet — replayed only to the BMW origin, held only in page
memory, never stored).

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest, locked to `mygarage.bmwusa.com`; permissions: `scripting` only |
| `before.js` | Runs at `document_start` in the page's MAIN world; hooks `fetch`/`XHR` and indexes every `prodVehicleDetails` response by production number |
| `execute.js` | Runs on toolbar click; reads the selected vehicle and renders the panel |
| `background.js` | Service worker; injects `execute.js` on click |

Requires Chromium 111+ (static MAIN-world content scripts). After editing code:
reload the extension on `chrome://extensions/`, then reload the BMW tab.

Zero-dependency test suite (Node 20+): `npm test` — 46 tests covering the
capture hooks, panel rendering (including payload shapes taken from live
captures), and manifest invariants.

</details>

## Credits

This project modernizes the original
[BMW MyGarage Chrome Trick](https://chromewebstore.google.com/detail/bmw-mygarage-chrome-trick/lbhlbodakahplgnfbggcjajoeodfpfon)
Chrome extension by **fdfranklin06** (Chrome Web Store, 2022) — the idea of
surfacing MyGarage's hidden production data is theirs. The bundled MIT license
credits **Lawrence Lagerlof** (2021), whose earlier work the original extension
appears to build on; that notice is preserved unchanged in [LICENSE](LICENSE).

## Disclaimer

Unofficial hobby project — not affiliated with or endorsed by BMW. It reads the
data BMW's own page loads for you; field names and payload shapes can change
whenever BMW updates MyGarage.
