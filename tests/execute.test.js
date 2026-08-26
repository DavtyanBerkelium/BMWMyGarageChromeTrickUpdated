'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  makeContext, makeDocument, makeElement, makeStorage, loadScript, flush,
} = require('./harness');

// Build a context where execute.js will find a captured detail and render
// immediately (no network fallback). Returns { ctx, target, alerts }.
function renderWith(detail, { garage = [], selected } = {}) {
  const target = makeElement('o-vehicle-details');
  const alerts = [];
  const sel = selected || { productionNumber: detail.prodNum, vin: detail.vin, gcid: 'g1' };
  const ctx = makeContext({
    alert: (m) => alerts.push(m),
    document: makeDocument({ '.o-vehicle-details': target }),
  });
  ctx.window.sessionStorage = makeStorage({
    'selected-vehicle': JSON.stringify(sel),
    'garage-vehicles': JSON.stringify(garage),
  });
  ctx.__bmwCapture = { byProdNum: { [detail.prodNum]: detail }, headers: null };
  loadScript('execute.js', ctx);
  return { ctx, target, alerts };
}

const BASE_DETAIL = {
  prodNum: 'P100',
  vin: 'WBS11111111111111',
  orderStatusCode: '150',
  overHeadMessage: 'Your BMW is being built',
  prodDate: '2026-02-01',
  retlDate: '2026-03-01',
  exteriorColor: 'Brooklyn Grey',
  interiorColor: 'Black',
  modelYear: '2026',
  naModelCode: '27TQ',
  colorCode: 'P0C36',
  upholsteryCode: 'FLKIA',
  packageDetails: [
    { packageName: 'Added Options', options: ['Heated Steering Wheel'] },
    { packageName: 'Standard Features', options: ['Anti-lock Braking'] },
  ],
};

test('renders panel with status name resolved from code', () => {
  const { target } = renderWith(BASE_DETAIL);
  const html = target.injected[0].html;
  assert.match(html, /Additional Vehicle Details/);
  assert.match(html, /Production Started/, 'status 150 should resolve to "Production Started"');
  assert.match(html, /WBS11111111111111/);
});

test('strips paint prefix (5-char -> 3-char) and upholstery prefix (5-char -> 4-char)', () => {
  const { target } = renderWith(BASE_DETAIL);
  const html = target.injected[0].html;
  assert.match(html, /\(C36\)/, 'P0C36 should display as C36');
  assert.match(html, /\(LKIA\)/, 'FLKIA should display as LKIA');
});

test('HTML-escapes hostile field values (XSS safety)', () => {
  const evil = Object.assign({}, BASE_DETAIL, {
    exteriorColor: '<img src=x onerror=alert(1)>',
    overHeadMessage: '"></section><script>steal()</script>',
  });
  const { target } = renderWith(evil);
  const html = target.injected[0].html;
  assert.ok(!html.includes('<img src=x'), 'raw <img> must not appear');
  assert.ok(!html.includes('<script>steal'), 'raw <script> must not appear');
  assert.match(html, /&lt;img src=x/, 'should be escaped');
});

test('shows VIN placeholder when no VIN assigned', () => {
  const noVin = Object.assign({}, BASE_DETAIL, { vin: 'NA' });
  const { target } = renderWith(noVin);
  assert.match(target.injected[0].html, /No VIN assigned yet/);
});

test('links to BMW\'s per-VIN brochure once a real VIN exists', () => {
  const html = renderWith(BASE_DETAIL).target.injected[0].html; // vin WBS11111111111111
  assert.match(html, /href="https:\/\/eve\.vsr\.aws\.bmw\.cloud\/brochure\/WBS11111111111111"/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"[^>]*>View BMW brochure/);
});

test('no brochure link while the VIN is unassigned (null / NA / short sentinels)', () => {
  for (const vin of ['null', 'NA', 'na', '']) {
    const html = renderWith(Object.assign({}, BASE_DETAIL, { vin })).target.injected[0].html;
    assert.doesNotMatch(html, /brochure/, `vin="${vin}" must not produce a brochure link`);
  }
});

test('treats the literal string "null" (real pre-production API sentinel) as unset', () => {
  // Verified live: a status-102 TRACK car returns vin/prodDate/retlDate as the
  // string "null" (not absent, not "NA"). The length>4 guard must treat these as unset.
  const preProd = Object.assign({}, BASE_DETAIL, {
    vin: 'null', prodDate: 'null', retlDate: 'null',
    orderStatusCode: '102', overHeadMessage: 'Order received',
  });
  const { target } = renderWith(preProd);
  const html = target.injected[0].html;
  assert.match(html, /No VIN assigned yet/);
  assert.match(html, /Special Order \(no Prod Week\)/, 'status 102 name should resolve');
  assert.doesNotMatch(html, /VIN:<\/strong>\s*null/, 'must never render the literal "null" as a VIN');
});

test('production and retail date rows are hidden entirely — even when BMW provides real values', () => {
  const unsetHtml = renderWith(Object.assign({}, BASE_DETAIL, { prodDate: 'null', retlDate: 'null' })).target.injected[0].html;
  assert.doesNotMatch(unsetHtml, /Production Date|Retail Date/, 'no date rows when unset');
  // Suppressed until the real reveal trigger is known — populated dates stay hidden too.
  const withDatesHtml = renderWith(Object.assign({}, BASE_DETAIL, { prodDate: '2026-09-04', retlDate: '2026-10-15' })).target.injected[0].html;
  assert.doesNotMatch(withDatesHtml, /Production Date|Retail Date|2026-09-04|2026-10-15/, 'real dates are not shown while the rows are suppressed');
});

test('resolves chassis from agModelCode via garage-vehicles', () => {
  const garage = [{ productionNumber: 'P100', model: { agModelCode: '33HJ' } }];
  const { target } = renderWith(BASE_DETAIL, { garage });
  assert.match(target.injected[0].html, /G80/, 'agModelCode 33HJ should map to G80 chassis');
  assert.match(target.injected[0].html, /33HJ/);
});

test('surfaces an unmapped agModelCode — shows the raw code and logs a debug hint', () => {
  const debugs = [];
  const target = makeElement('o-vehicle-details');
  const ctx = makeContext({
    alert: () => {},
    document: makeDocument({ '.o-vehicle-details': target }),
    console: Object.assign({}, console, { debug: (m) => debugs.push(String(m)) }),
  });
  ctx.window.sessionStorage = makeStorage({
    'selected-vehicle': JSON.stringify({ productionNumber: 'P777' }),
    'garage-vehicles': JSON.stringify([{ productionNumber: 'P777', model: { agModelCode: 'ZZ99' } }]),
  });
  ctx.__bmwCapture = { byProdNum: { P777: Object.assign({}, BASE_DETAIL, { prodNum: 'P777' }) }, headers: null };
  loadScript('execute.js', ctx);
  const html = target.injected[0].html;
  assert.match(html, /\(ZZ99\)/, 'raw ag code is still shown when the chassis is unmapped');
  assert.ok(debugs.some((d) => /ZZ99/.test(d)), 'logs a hint naming the unmapped code');
});

test('alerts when no vehicle is selected', () => {
  const target = makeElement('o-vehicle-details');
  const alerts = [];
  const ctx = makeContext({ alert: (m) => alerts.push(m), document: makeDocument() });
  ctx.window.sessionStorage = makeStorage({ 'selected-vehicle': 'null' });
  ctx.__bmwCapture = { byProdNum: {}, headers: null };
  loadScript('execute.js', ctx);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /no vehicle selected/i);
});

test('alerts when capture script never loaded', () => {
  const alerts = [];
  const ctx = makeContext({ alert: (m) => alerts.push(m), document: makeDocument() });
  ctx.window.sessionStorage = makeStorage({});
  // No __bmwCapture defined at all.
  loadScript('execute.js', ctx);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /capture script not loaded/i);
});

test('status note renders inline on the Status Code line ("Name: Note"), plus the next milestone', () => {
  const { target } = renderWith(BASE_DETAIL); // status 150
  const html = target.injected[0].html;
  assert.match(html, /Production Started: Your spec is now locked in\./, 'note appended to the name on one line');
  assert.doesNotMatch(html, /font-style:italic;">Your spec/, 'no separate italic note paragraph anymore');
  assert.match(html, /<strong>Next:<\/strong>\s*Body Shop Started/, '150 -> next is 151 Body Shop Started');
});

test('status 112 renders the merged last-chance line; next is Production Started', () => {
  const d = Object.assign({}, BASE_DETAIL, { orderStatusCode: '112' });
  const html = renderWith(d).target.injected[0].html;
  assert.match(html, /Order scheduled for Production: Last chance to change your order before the spec locks\./);
  assert.match(html, /<strong>Next:<\/strong>\s*Production Started/);
});

test('omits the Next line for a terminal or off-path status', () => {
  const terminal = renderWith(Object.assign({}, BASE_DETAIL, { orderStatusCode: '196' })).target.injected[0].html;
  assert.doesNotMatch(terminal, /<strong>Next:<\/strong>/, '196 is terminal');
  const offPath = renderWith(Object.assign({}, BASE_DETAIL, { orderStatusCode: '170' })).target.injected[0].html;
  assert.doesNotMatch(offPath, /<strong>Next:<\/strong>/, '170 (workshop) is off the order ladder');
});

test('includes a Copy details button; no footer caveat', () => {
  const html = renderWith(BASE_DETAIL).target.injected[0].html;
  assert.match(html, /class="c-cd-copy"[^>]*>Copy details</);
  assert.doesNotMatch(html, /Unofficial|lag the factory|Shown /, 'footer caveat/timestamp removed');
});

test('offers a View 360 control with a hidden viewer container', () => {
  const html = renderWith(BASE_DETAIL).target.injected[0].html;
  assert.match(html, /class="c-cd-spin"[^>]*>View 360&deg;</, '360 button in the header');
  assert.match(html, /class="c-cd-spin-box" style="display:none/, 'viewer container starts hidden');
});

test('renders package prices only for real packages (live 2026-08 payload shape)', () => {
  // Fixture mirrors the live status-112 feed: named packages carry price > 0,
  // $0 marks a free content breakdown, -1/-2 are pseudo-section sentinels, and
  // one option contains a literal double quote (BMW's own data does).
  const livePkgs = Object.assign({}, BASE_DETAIL, {
    packageDetails: [
      { packageName: 'Carbon Package', price: 14300, doNotExpand: false, options: ['19"/20" M Black Forged Wheels', 'M Alcantara steering wheel'] },
      { packageName: 'Carbon Package Content', price: 0, doNotExpand: false, options: ['Carbon Fiber trim', 'Head-up Display', 'M Driver"s Package'] },
      { packageName: 'Added options', price: -1, doNotExpand: false, options: ['Destination Charge', 'Sepia III Metallic'] },
      { packageName: 'Standard Features', price: -2, doNotExpand: false, options: ['Tire pressure monitor'] },
    ],
  });
  const html = renderWith(livePkgs).target.injected[0].html;
  assert.match(html, /Carbon Package \(5\) <span[^>]*>&mdash; \$14,300<\/span><\/summary>/, 'content folds into the parent: 2 own + 3 content items, parent price kept');
  assert.doesNotMatch(html, /Carbon Package Content/, 'the Content breakdown no longer renders as its own section');
  assert.match(html, /M Alcantara steering wheel<\/li><li[^>]*>Carbon Fiber trim/, 'parent items come first, content items follow');
  assert.match(html, /Added options \(2\)<\/summary>/, '-1 sentinel shows no price');
  assert.match(html, /Standard Features \(1\)<\/summary>/, '-2 sentinel shows no price');
  assert.match(html, /M Driver&quot;s Package/, 'literal double quote in BMW data is escaped, not broken');
  assert.match(html, /<details open[^>]*>\s*<summary[^>]*>Added options/, 'Added options stays open in the multi-package shape');
  // The fold must be a pure transform — the cached detail object stays untouched.
  assert.strictEqual(livePkgs.packageDetails.length, 4, 'original package array not mutated');
  assert.strictEqual(livePkgs.packageDetails[0].options.length, 2, 'parent package options not mutated');
});

test('a "... Content" section with no matching parent still renders standalone', () => {
  const d = Object.assign({}, BASE_DETAIL, {
    packageDetails: [
      { packageName: 'Mystery Package Content', price: 0, options: ['Something'] },
      { packageName: 'Standard Features', price: -2, options: ['Tire pressure monitor'] },
    ],
  });
  const html = renderWith(d).target.injected[0].html;
  assert.match(html, /Mystery Package Content \(1\)<\/summary>/, 'orphan content section is not dropped');
});

test('packages without a price field render exactly as before', () => {
  const html = renderWith(BASE_DETAIL).target.injected[0].html;
  assert.doesNotMatch(html, /&mdash; \$/, 'no price span when the field is absent');
});

test('added-package details default to open, others collapsed', () => {
  const { target } = renderWith(BASE_DETAIL);
  const html = target.injected[0].html;
  // "Added Options" should render <details open>, "Standard Features" without open.
  assert.match(html, /<details open[^>]*>\s*<summary[^>]*>Added Options/);
  assert.match(html, /<details\s+style[^>]*>\s*<summary[^>]*>Standard Features/);
});

test('distinguishes a malformed selection from "no vehicle selected"', () => {
  const alerts = [];
  const ctx = makeContext({ alert: (m) => alerts.push(m), document: makeDocument() });
  ctx.window.sessionStorage = makeStorage({ 'selected-vehicle': JSON.stringify({ vin: 'V', color: 'red' }) });
  ctx.__bmwCapture = { byProdNum: {}, headers: null };
  loadScript('execute.js', ctx);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /unexpected format/i, 'should report a shape problem, not "no vehicle selected"');
  assert.doesNotMatch(alerts[0], /no vehicle selected/i);
});

// --- Network fallback path (capture incomplete -> fetch using sniffed headers) ---

function fallbackContext(responses, { headers = { Authorization: 'Bearer t' } } = {}) {
  const target = makeElement('o-vehicle-details');
  const alerts = [];
  let call = 0;
  const ctx = makeContext({
    alert: (m) => alerts.push(m),
    document: makeDocument({ '.o-vehicle-details': target }),
    fetch: () => Promise.resolve(responses[Math.min(call++, responses.length - 1)]),
  });
  ctx.window.sessionStorage = makeStorage({
    'selected-vehicle': JSON.stringify({ productionNumber: 'P200', vin: 'V', gcid: 'g', relationshipType: 'TRACK' }),
    'garage-vehicles': '[]',
  });
  // Captured record exists but lacks packageDetails -> forces the fetch fallback.
  ctx.__bmwCapture = { byProdNum: { P200: { prodNum: 'P200' } }, headers };
  return { ctx, target, alerts };
}

async function settle() { for (let i = 0; i < 6; i++) await flush(); }

test('fallback fetches via sniffed headers and renders the panel', async () => {
  const detail = Object.assign({}, BASE_DETAIL, { prodNum: 'P200' });
  const { ctx, target, alerts } = fallbackContext([
    { ok: true, json: () => Promise.resolve({ links: [{ rel: 'TRACK', href: 'https://api.bmw/track?x=1' }] }) },
    { ok: true, json: () => Promise.resolve({ dataContent: { prodVehicleDetails: [detail] } }) },
  ]);
  loadScript('execute.js', ctx);
  await settle();
  assert.equal(alerts.length, 0, 'no alert on a successful fallback');
  assert.ok(target.injected.length > 0, 'panel should render from fetched detail');
  assert.match(target.injected[0].html, /Additional Vehicle Details/);
});

test('fallback without sniffed auth headers alerts to load the data', () => {
  const { ctx, alerts } = fallbackContext([], { headers: null });
  loadScript('execute.js', ctx);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /not yet loaded/i);
});

test('fallback reports an API change on a structural failure', async () => {
  const { ctx, alerts } = fallbackContext([
    { ok: true, json: () => Promise.resolve({ noLinksHere: true }) },
  ]);
  loadScript('execute.js', ctx);
  await settle();
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /changed its API/i);
});

test('fallback reports an expired session on HTTP 401', async () => {
  const { ctx, alerts } = fallbackContext([
    { ok: false, status: 401, json: () => Promise.resolve(null) },
  ]);
  loadScript('execute.js', ctx);
  await settle();
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /session looks expired/i);
});
