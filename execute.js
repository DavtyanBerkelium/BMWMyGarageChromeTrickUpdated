// Runs in the page's MAIN world when the toolbar button is clicked.
// Reads the data captured by before.js and renders an "Additional Vehicle Details" panel.
(function () {
  // BMW factory status codes (full reference). Used to show the technical name
  // alongside the customer-facing "Status:" message, plus to compute "Next".
  const BMW_STATUS_NAMES = {
    '0':   'Order deleted by BMW',
    '17':  'Order not specified',
    '37':  'Order is at BMW NA',
    '87':  'Production Week Assigned',
    '97':  'Order sent to AG',
    '100': 'Order deleted by AG',
    '101': 'Error in data transmitted',
    '102': 'Special Order (no Prod Week)',
    '105': 'Order out of Prod. Period',
    '111': 'Order Accepted at AG',
    '112': 'Order scheduled for Production',
    '150': 'Production Started',
    '151': 'Body Shop Started',
    '152': 'Paint Shop Started',
    '153': 'Assembly Started',
    '155': 'Production Completed',
    '160': 'Released to Distribution',
    '168': 'AG Stock',
    '170': 'Waiting Workshop',
    '172': 'Planned for Workshop',
    '174': 'Workshop Entry',
    '176': 'Workshop Complete',
    '180': 'Waiting for Export Dispatch',
    '181': 'Waiting for Domestic Dispatch',
    '182': 'Schedule for Carrier',
    '190': 'In transit to port of exit',
    '191': 'Returned to BMW AG',
    '193': 'Arrived at Port of Exit',
    '194': 'Selected for Shipment',
    '195': 'Shipped from Port of Exit',
    '196': 'Shipment Arrival'
  };

  // agModelCode -> chassis generation. Add entries as you encounter them.
  const CHASSIS_BY_AG_CODE = {
    '33HJ': 'G80'  // M3 Competition xDrive Sedan
  };

  // Hoisted so the escape map isn't reallocated on every matched character.
  const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  // Plain-language notes for the milestones owners care about most, rendered
  // appended to the status name ("<Name>: <Note>") — so each note is phrased as
  // a continuation and must not restate the name. The 112->150 transition is
  // the emotional one: 112 is the last chance to change the order, 150 locks
  // the spec.
  const BMW_STATUS_NOTES = {
    '111': 'Awaiting a production slot.',
    '112': 'Last chance to change your order before the spec locks.',
    '150': 'Your spec is now locked in.',
    '155': 'Heading to distribution.',
    '160': 'On its way to a transport hub.',
    '195': 'En route to the US.',
    '196': 'Should reach your dealer soon.'
  };

  // Curated happy-path order for the "Next" milestone. NOT a numeric sort of
  // BMW_STATUS_NAMES: workshop codes (170-176) and branch/error states
  // (0/100/101/105/191) are deliberately off this path.
  const STATUS_LADDER = ['102', '111', '112', '150', '151', '152', '153', '155', '160', '168', '180', '182', '190', '193', '194', '195', '196'];

  // Why the date is missing pre-150: BMW schedules the build week earlier (it's
  // visible in dealer systems from status 112), but the customer-facing API only
  // publishes prodDate once production physically starts at 150, alongside the
  // VIN. Verified live on this feed; corroborated across owner forums.
  const PROD_DATE_NOTE = 'BMW schedules your build week earlier, but its customer API only reveals the date once production physically starts (status 150, when the VIN is also assigned). Until then the scheduled week exists only in BMW’s internal systems — your dealer or the BMW Genius line (1-844-443-6487) can quote it.';

  const cap = globalThis.__bmwCapture;
  if (!cap) {
    alert('BMW MyGarage Trick: capture script not loaded. Make sure you are on https://mygarage.bmwusa.com and reload the page.');
    return;
  }

  let selected = null;
  try { selected = JSON.parse(window.sessionStorage.getItem('selected-vehicle') || 'null'); } catch (_) {}
  if (!selected) {
    alert('BMW MyGarage Trick: no vehicle selected. Click a vehicle in the top bar first.');
    return;
  }
  if (!selected.productionNumber) {
    console.warn('BMW MyGarage Trick: selected-vehicle has an unexpected shape', selected);
    alert('BMW MyGarage Trick: the selected vehicle data is in an unexpected format. BMW may have changed its page — reload and try again.');
    return;
  }

  const prodNum = String(selected.productionNumber);

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return HTML_ESCAPES[c]; });
  }

  // 360° turntable viewer. BMW's features-and-options/images endpoint serves
  // {content:[{angle,url}...]} renders of the user's exact build for any
  // startAngle/stepAngle; 10° steps (36 frames) matches BMW's own frontend.
  function buildSpinViewer(box, frames) {
    box.innerHTML =
      '<img class="c-cd-spin-img" src="' + escapeHtml(frames[0].url) + '" alt="360° view" draggable="false" ' +
        'style="display:block;max-width:100%;height:auto;border-radius:8px;cursor:grab;user-select:none;-webkit-user-drag:none;">' +
      '<p style="margin:4px 0 0 0;font-size:.8rem;color:#777;text-align:center;">Drag to rotate</p>';
    const img = box.querySelector('.c-cd-spin-img');
    frames.forEach(function (f) { const im = new Image(); im.src = f.url; }); // warm the cache
    let dragging = false, startX = 0, startIdx = 0, idx = 0;
    const PX_PER_FRAME = 12;
    img.addEventListener('pointerdown', function (e) {
      dragging = true; startX = e.clientX; startIdx = idx; img.style.cursor = 'grabbing';
      try { img.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    img.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      const delta = Math.round((e.clientX - startX) / PX_PER_FRAME);
      const n = frames.length;
      const next = ((startIdx - delta) % n + n) % n;
      if (next !== idx) { idx = next; img.src = frames[idx].url; }
    });
    ['pointerup', 'pointercancel'].forEach(function (t) {
      img.addEventListener(t, function () { dragging = false; img.style.cursor = 'grab'; });
    });
  }

  function loadSpin(box, cap, selected, prodNum) {
    box.innerHTML = '<p style="margin:8px 0;color:#777;">Loading 360° view…</p>';
    const cached = cap.spinFrames && cap.spinFrames[prodNum];
    if (cached) { buildSpinViewer(box, cached); return; }
    if (!cap.headers || !(cap.headers.Authorization || cap.headers.authorization)) {
      box.innerHTML = '<p style="margin:8px 0;color:#777;">The 360° view needs the page session — reload the page and try again.</p>';
      return;
    }
    const h = {};
    Object.keys(cap.headers).forEach(function (k) { h[k] = cap.headers[k]; });
    if (!h.Accept && !h.accept) h.Accept = 'application/json';
    const vinPart = selected.vin || 'null';
    const url = '/bin/my-garage-services/forward'
      + '?target=' + encodeURIComponent('/<brand-market>/profile/' + prodNum + '-' + vinPart + '/features-and-options/images')
      + '&brand=BMW'
      + '&gcid=' + encodeURIComponent(selected.gcid || '')
      + '&startAngle=0&stepAngle=10&market=US';
    fetch(url, { credentials: 'include', headers: h })
      .then(function (r) { if (!r.ok) throw new Error('HTTP_' + r.status); return r.json(); })
      .then(function (data) {
        const frames = data && Array.isArray(data.content)
          ? data.content.filter(function (f) { return f && f.url; })
          : [];
        if (!frames.length) throw new Error('NO_FRAMES');
        frames.sort(function (a, b) { return (a.angle || 0) - (b.angle || 0); });
        cap.spinFrames = cap.spinFrames || {};
        cap.spinFrames[prodNum] = frames;
        buildSpinViewer(box, frames);
      })
      .catch(function (e) {
        console.error('BMW MyGarage Trick: 360° load failed', e);
        const msg = String((e && e.message) || '');
        box.innerHTML = '<p style="margin:8px 0;color:#777;">Could not load the 360° view'
          + (/^HTTP_4/.test(msg) ? ' — session may have expired; reload the page and try again.' : '.') + '</p>';
      });
  }

  function renderDetail(detail) {
    document.querySelectorAll('.c-custom-details').forEach(function (el) { el.remove(); });

    const status = escapeHtml(detail.orderStatusCode || 'N/A');
    const statusDesc = escapeHtml(detail.overHeadMessage || '');
    const statusDescLong = escapeHtml(detail.overHeadLongMessage || '');
    // Keep raw + escaped versions: escaped feeds the panel, raw feeds the clipboard export.
    const vinRaw = detail.vin && detail.vin !== 'NA' && detail.vin.length > 4
      ? detail.vin : 'No VIN assigned yet (status 150 required)';
    const prodDateUnset = !(detail.prodDate && detail.prodDate.length > 4);
    const prodRaw = prodDateUnset
      ? 'No production date assigned yet (status 150 required)' : detail.prodDate;
    const retlRaw = detail.retlDate && detail.retlDate.length > 4
      ? detail.retlDate : 'Not yet scheduled';
    const vinShown = escapeHtml(vinRaw);
    const prodDate = escapeHtml(prodRaw);
    const retlDate = escapeHtml(retlRaw);
    const exterior = escapeHtml(detail.exteriorColor || '');
    const interior = escapeHtml(detail.interiorColor || '');
    const modelYear = escapeHtml(detail.modelYear || '');
    const naModel = escapeHtml(detail.naModelCode || '');
    // BMW's API prefixes canonical codes; the prefix length differs by field.
    // Paint codes are canonically 3 chars (e.g. "S0N", "C36") with a 2-char prefix -> "P0S0N".
    // Upholstery codes are canonically 4 chars (e.g. "LKIA") with a 1-char prefix -> "FLKIA".
    // Confirmed by cross-referencing dealer Vehicle Inquiry Report.
    function stripCodePrefix(raw, prefixLen) { return raw && raw.length === 5 ? raw.slice(prefixLen) : raw; }
    const colorCodeRaw = stripCodePrefix(detail.colorCode || '', 2);
    const upholsteryCodeRaw = stripCodePrefix(detail.upholsteryCode || '', 1);
    const colorCode = escapeHtml(colorCodeRaw);
    const upholsteryCode = escapeHtml(upholsteryCodeRaw);

    // agModelCode (chassis-family code, e.g. 33HJ) lives in garage-vehicles, not in TRACK.
    let agModelCode = '';
    try {
      const garage = JSON.parse(window.sessionStorage.getItem('garage-vehicles') || '[]');
      const car = garage.find(function (c) { return String(c.productionNumber) === prodNum; });
      if (car && car.model && car.model.agModelCode) agModelCode = car.model.agModelCode;
    } catch (_) {}
    const chassis = CHASSIS_BY_AG_CODE[agModelCode] || '';
    // Surface (quietly) any ag code we don't map yet so the table can grow from real
    // data rather than guesses. The raw code is still shown in the panel either way.
    if (agModelCode && !chassis) {
      try { console.debug('BMW MyGarage Trick: unmapped agModelCode "' + agModelCode + '" — add it to CHASSIS_BY_AG_CODE to show the chassis name.'); } catch (_) {}
    }

    // Build "Model: 2027 27TQ (G80 / 33HJ)" — gracefully fall back if pieces missing.
    const codePieces = [];
    if (chassis) codePieces.push(chassis);
    if (agModelCode) codePieces.push(escapeHtml(agModelCode));
    const modelCodes = codePieces.length ? ' <span style="color:#666;">(' + codePieces.join(' / ') + ')</span>' : '';

    // Factory term, plain-language note, and the next expected milestone.
    const statusCodeStr = String(detail.orderStatusCode || '');
    const currentStatusName = BMW_STATUS_NAMES[statusCodeStr] || '';
    const statusNote = BMW_STATUS_NOTES[statusCodeStr] || '';
    const ladderIdx = STATUS_LADDER.indexOf(statusCodeStr);
    const nextName = ladderIdx !== -1 && ladderIdx < STATUS_LADDER.length - 1
      ? (BMW_STATUS_NAMES[STATUS_LADDER[ladderIdx + 1]] || '') : '';

    const rawPackages = Array.isArray(detail.packageDetails) ? detail.packageDetails : [];
    // Fold "<Name> Content" breakdown sections into their parent package (e.g.
    // "Carbon Package Content" lists inside "Carbon Package"). Pure copy — the
    // cached detail in __bmwCapture must never be mutated. A "... Content"
    // section with no matching parent still renders standalone.
    const pkgNames = new Set(rawPackages.map(function (p) { return String(p.packageName || '').toLowerCase(); }));
    const packages = [];
    rawPackages.forEach(function (pkg) {
      const nm = String(pkg.packageName || '');
      const asContent = /^(.+) Content$/i.exec(nm);
      if (asContent && pkgNames.has(asContent[1].toLowerCase())) return; // folded into its parent
      const content = rawPackages.find(function (c) {
        return String(c.packageName || '').toLowerCase() === (nm + ' content').toLowerCase();
      });
      if (content) {
        packages.push({
          packageName: pkg.packageName,
          price: pkg.price,
          options: (Array.isArray(pkg.options) ? pkg.options : []).concat(Array.isArray(content.options) ? content.options : [])
        });
      } else {
        packages.push(pkg);
      }
    });
    const packagesHtml = packages.map(function (pkg) {
      const opts = Array.isArray(pkg.options) ? pkg.options : [];
      const isAdded = /added/i.test(pkg.packageName || '');
      // BMW's feed carries a per-package MSRP: real packages have price > 0;
      // $0 marks free content breakdowns and -1/-2 the pseudo-sections
      // ("Added options"/"Standard Features"), so those show no price.
      const priceNum = Number(pkg.price);
      const priceHtml = isFinite(priceNum) && priceNum > 0
        ? ' <span style="color:#666;font-weight:400;">&mdash; $' + priceNum.toLocaleString('en-US') + '</span>'
        : '';
      const items = opts.map(function (o) {
        return '<li style="margin:2px 0;">' + escapeHtml(typeof o === 'string' ? o : (o.name || JSON.stringify(o))) + '</li>';
      }).join('');
      return (
        '<details ' + (isAdded ? 'open' : '') + ' style="margin-top:12px;">' +
          '<summary style="cursor:pointer;font-weight:600;font-size:1rem;">' +
            escapeHtml(pkg.packageName || 'Options') + ' (' + opts.length + ')' + priceHtml +
          '</summary>' +
          '<ul style="margin:8px 0 0 0;padding-left:20px;list-style:disc;">' + items + '</ul>' +
        '</details>'
      );
    }).join('');

    // Plain-text version for the "Copy details" button (raw values, never inserted as HTML).
    const copyText = [
      ('BMW ' + (detail.modelYear || '') + ' ' + (detail.naModelCode || '') + (chassis ? ' (' + chassis + (agModelCode ? ' / ' + agModelCode : '') + ')' : '')).replace(/\s+/g, ' ').trim(),
      'Status ' + (detail.orderStatusCode || 'N/A') + (currentStatusName ? ' — ' + currentStatusName : ''),
      nextName ? 'Next: ' + nextName : '',
      'VIN: ' + vinRaw,
      'Production Date: ' + prodRaw,
      'Retail Date: ' + retlRaw,
      detail.exteriorColor ? 'Exterior: ' + detail.exteriorColor + (colorCodeRaw ? ' (' + colorCodeRaw + ')' : '') : '',
      detail.interiorColor ? 'Interior: ' + detail.interiorColor + (upholsteryCodeRaw ? ' (' + upholsteryCodeRaw + ')' : '') : ''
    ].filter(Boolean).join('\n');

    const html =
      '<section class="c-custom-details" style="' +
        'margin:24px auto;max-width:960px;padding:24px 28px;' +
        'background:#f5f5f5;color:#262626;border-radius:8px;' +
        'font-family:inherit;line-height:1.5;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin:0 0 16px 0;">' +
          '<h2 style="margin:0;font-size:1.4rem;letter-spacing:.02em;">Additional Vehicle Details</h2>' +
          '<div style="display:flex;gap:8px;align-items:center;">' +
            '<button type="button" class="c-cd-spin" style="cursor:pointer;font-size:.8rem;padding:5px 12px;border:1px solid #999;border-radius:4px;background:#fff;color:#262626;white-space:nowrap;">View 360&deg;</button>' +
            '<button type="button" class="c-cd-copy" style="cursor:pointer;font-size:.8rem;padding:5px 12px;border:1px solid #999;border-radius:4px;background:#fff;color:#262626;white-space:nowrap;">Copy details</button>' +
          '</div>' +
        '</div>' +
        '<div class="c-cd-spin-box" style="display:none;margin:0 0 16px 0;"></div>' +
        '<p style="margin:6px 0;"><strong>Status Code:</strong> ' + status + (currentStatusName ? ' <span style="color:#444;">&mdash; ' + escapeHtml(currentStatusName) + (statusNote ? ': ' + escapeHtml(statusNote) : '') + '</span>' : '') + '</p>' +
        (nextName ? '<p style="margin:6px 0;"><strong>Next:</strong> ' + escapeHtml(nextName) + '</p>' : '') +
        '<p style="margin:6px 0;"><strong>Status:</strong> ' + statusDesc + (statusDescLong ? '<br><span style="color:#555;">' + statusDescLong + '</span>' : '') + '</p>' +
        '<p style="margin:6px 0;"><strong>VIN:</strong> ' + vinShown + '</p>' +
        '<p style="margin:6px 0;"><strong>Production Date:</strong> ' + prodDate + '</p>' +
        (prodDateUnset ? '<p style="margin:6px 0 6px 0;font-size:.85rem;color:#777;font-style:italic;">' + escapeHtml(PROD_DATE_NOTE) + '</p>' : '') +
        '<p style="margin:6px 0;"><strong>Retail Date:</strong> ' + retlDate + '</p>' +
        (modelYear || naModel ? '<p style="margin:6px 0;"><strong>Model:</strong> ' + modelYear + ' ' + naModel + modelCodes + '</p>' : '') +
        (exterior ? '<p style="margin:6px 0;"><strong>Exterior:</strong> ' + exterior + (colorCode ? ' <span style="color:#666;">(' + colorCode + ')</span>' : '') + '</p>' : '') +
        (interior ? '<p style="margin:6px 0;"><strong>Interior:</strong> ' + interior + (upholsteryCode ? ' <span style="color:#666;">(' + upholsteryCode + ')</span>' : '') + '</p>' : '') +
        (packagesHtml || '') +
      '</section>';

    const target = document.querySelector('.o-vehicle-details') || document.querySelector('.t-dashboard') || document.querySelector('main');
    if (target) target.insertAdjacentHTML('afterend', html);
    else document.body.insertAdjacentHTML('afterbegin', html);

    // Wire the copy + 360° buttons (MAIN world; both ride the click gesture).
    try {
      const root = document.querySelector('.c-custom-details');
      const btn = root && root.querySelector ? root.querySelector('.c-cd-copy') : null;
      if (btn) btn.addEventListener('click', function () {
        try {
          navigator.clipboard.writeText(copyText).then(function () {
            btn.textContent = 'Copied!';
            setTimeout(function () { btn.textContent = 'Copy details'; }, 1500);
          }).catch(function () {});
        } catch (_) {}
      });
      const spinBtn = root && root.querySelector ? root.querySelector('.c-cd-spin') : null;
      const spinBox = root && root.querySelector ? root.querySelector('.c-cd-spin-box') : null;
      if (spinBtn && spinBox) spinBtn.addEventListener('click', function () {
        if (spinBox.style.display !== 'none') {
          spinBox.style.display = 'none';
          spinBtn.innerHTML = 'View 360&deg;';
          return;
        }
        spinBox.style.display = 'block';
        spinBtn.innerHTML = 'Hide 360&deg;';
        if (!spinBox.__loaded) { spinBox.__loaded = true; loadSpin(spinBox, cap, selected, prodNum); }
      });
    } catch (_) {}
  }

  const have = cap.byProdNum[prodNum];
  if (have && have.packageDetails) { renderDetail(have); return; }

  // No capture yet — try fetching directly using the auth headers we sniffed.
  if (!cap.headers || !(cap.headers.Authorization || cap.headers.authorization)) {
    alert('BMW MyGarage Trick: vehicle details not yet loaded. Click the vehicle tab in the top bar (or refresh the page) and try again.');
    return;
  }

  const headers = {};
  Object.keys(cap.headers).forEach(function (k) { headers[k] = cap.headers[k]; });
  if (!headers.Accept && !headers.accept) headers.Accept = 'application/json';

  const vinPart = selected.vin || 'null';
  const rel = selected.relationshipType || 'TRACK';
  const target = '/<brand-market>/profile/' + prodNum + '-' + vinPart + '/core';
  const url = '/bin/my-garage-services/forward'
    + '?target=' + encodeURIComponent(target)
    + '&brand=BMW'
    + '&gcid=' + encodeURIComponent(selected.gcid || '')
    + '&relationships=' + encodeURIComponent(rel)
    + '&market=US';

  fetch(url, { credentials: 'include', headers: headers })
    .then(function (r) { if (!r.ok) throw new Error('HTTP_' + r.status); return r.json(); })
    .then(function (core) {
      if (!core || !Array.isArray(core.links)) throw new Error('NO_LINKS');
      const trackLink = core.links.find(function (l) { return l.rel === rel; })
        || core.links.find(function (l) { return l.rel === 'FEATURES_AND_OPTIONS'; });
      if (!trackLink) throw new Error('NO_REL');
      const path = trackLink.href.replace(/^https?:\/\/[^/]+/, '');
      const sep = path.indexOf('?');
      const proxied = '/bin/my-garage-services/forward'
        + '?target=' + encodeURIComponent(sep === -1 ? path : path.slice(0, sep))
        + (sep === -1 ? '' : '&' + path.slice(sep + 1))
        + '&brand=BMW';
      return fetch(proxied, { credentials: 'include', headers: headers }).then(function (r) { if (!r.ok) throw new Error('HTTP_' + r.status); return r.json(); });
    })
    .then(function (data) {
      const detail = data && data.dataContent && data.dataContent.prodVehicleDetails && data.dataContent.prodVehicleDetails[0];
      if (!detail) throw new Error('NO_DETAIL');
      cap.byProdNum[prodNum] = Object.assign(cap.byProdNum[prodNum] || {}, detail);
      renderDetail(detail);
    })
    .catch(function (e) {
      console.error('BMW MyGarage Trick: fallback fetch failed', e);
      const msg = String((e && e.message) || '');
      if (msg === 'HTTP_401' || msg === 'HTTP_403') {
        alert('BMW MyGarage Trick: your session looks expired. Reload the page and try again.');
      } else if (msg === 'NO_LINKS' || msg === 'NO_REL' || msg === 'NO_DETAIL') {
        alert('BMW MyGarage Trick: could not read the vehicle details — BMW may have changed its API.');
      } else {
        alert('BMW MyGarage Trick: details not loaded yet. Click the vehicle tab in the top bar and try again.');
      }
    });
})();
