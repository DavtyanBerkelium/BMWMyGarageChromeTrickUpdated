'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  flush, makeResponse, makeXHRClass, makeContext, loadScript,
} = require('./harness');

const DETAIL_JSON = JSON.stringify({
  dataContent: {
    prodVehicleDetails: [
      { prodNum: 'P123', vin: 'WBS00000000000001', orderStatusCode: '150' },
    ],
  },
});

function ctxWithFetch(fetchImpl) {
  const ctx = makeContext({ fetch: fetchImpl, XMLHttpRequest: makeXHRClass() });
  return ctx;
}

test('fetch hook indexes prodVehicleDetails by prodNum', async () => {
  const ctx = ctxWithFetch(() => Promise.resolve(makeResponse(DETAIL_JSON)));
  loadScript('before.js', ctx);
  await ctx.window.fetch('/whatever');
  await flush();
  const cap = ctx.__bmwCapture;
  assert.ok(cap.byProdNum.P123, 'P123 should be captured');
  assert.strictEqual(cap.byProdNum.P123.vin, 'WBS00000000000001');
  assert.strictEqual(cap.byProdNum.P123.orderStatusCode, '150');
});

test('fetch hook ignores non-JSON content-type', async () => {
  const ctx = ctxWithFetch(() => Promise.resolve(makeResponse('<html></html>', { contentType: 'text/html' })));
  loadScript('before.js', ctx);
  await ctx.window.fetch('/page');
  await flush();
  assert.deepStrictEqual(Object.keys(ctx.__bmwCapture.byProdNum), []);
});

test('fetch hook ignores non-ok responses', async () => {
  const ctx = ctxWithFetch(() => Promise.resolve(makeResponse(DETAIL_JSON, { ok: false, status: 500 })));
  loadScript('before.js', ctx);
  await ctx.window.fetch('/err');
  await flush();
  assert.deepStrictEqual(Object.keys(ctx.__bmwCapture.byProdNum), []);
});

test('repeated responses for same prodNum merge (Object.assign)', async () => {
  let call = 0;
  const bodies = [
    JSON.stringify({ dataContent: { prodVehicleDetails: [{ prodNum: 'P9', vin: 'V1' }] } }),
    JSON.stringify({ dataContent: { prodVehicleDetails: [{ prodNum: 'P9', prodDate: '2026-01-01' }] } }),
  ];
  const ctx = ctxWithFetch(() => Promise.resolve(makeResponse(bodies[call++])));
  loadScript('before.js', ctx);
  await ctx.window.fetch('/a'); await flush();
  await ctx.window.fetch('/b'); await flush();
  const rec = ctx.__bmwCapture.byProdNum.P9;
  assert.strictEqual(rec.vin, 'V1', 'first response field retained');
  assert.strictEqual(rec.prodDate, '2026-01-01', 'second response field merged in');
});

test('install guard: loading before.js twice does not re-wrap fetch', async () => {
  const ctx = ctxWithFetch(() => Promise.resolve(makeResponse(DETAIL_JSON)));
  loadScript('before.js', ctx);
  const firstWrapped = ctx.window.fetch;
  loadScript('before.js', ctx);
  assert.strictEqual(ctx.window.fetch, firstWrapped, 'fetch should only be wrapped once');
});

test('original fetch result is still returned to the caller (non-destructive)', async () => {
  const original = makeResponse(DETAIL_JSON);
  const ctx = ctxWithFetch(() => Promise.resolve(original));
  loadScript('before.js', ctx);
  const returned = await ctx.window.fetch('/x');
  assert.strictEqual(returned, original, 'caller must receive the untouched original response');
});

test('XHR hook captures Authorization headers and ingests body', async () => {
  const ctx = ctxWithFetch(() => Promise.resolve(makeResponse(DETAIL_JSON)));
  loadScript('before.js', ctx);
  const xhr = new ctx.XMLHttpRequest();
  xhr.open('GET', '/track');
  xhr.setRequestHeader('Authorization', 'Bearer abc123');
  xhr.send();
  xhr.status = 200;
  xhr.responseText = DETAIL_JSON;
  xhr._fire('load');
  await flush();
  assert.ok(ctx.__bmwCapture.headers, 'headers should be captured');
  assert.strictEqual(ctx.__bmwCapture.headers.Authorization, 'Bearer abc123');
  assert.ok(ctx.__bmwCapture.byProdNum.P123, 'XHR body should also be ingested');
});

test('XHR hook ignores non-2xx responses', async () => {
  const ctx = ctxWithFetch(() => Promise.resolve(makeResponse(DETAIL_JSON)));
  loadScript('before.js', ctx);
  const xhr = new ctx.XMLHttpRequest();
  xhr.open('GET', '/track');
  xhr.setRequestHeader('Authorization', 'Bearer abc123');
  xhr.send();
  xhr.status = 404;
  xhr.responseText = DETAIL_JSON;
  xhr._fire('load');
  await flush();
  assert.deepStrictEqual(Object.keys(ctx.__bmwCapture.byProdNum), [], 'no ingest on 404');
});

test('malformed JSON is swallowed without throwing', async () => {
  const ctx = ctxWithFetch(() => Promise.resolve(makeResponse('{not valid json')));
  loadScript('before.js', ctx);
  await assert.doesNotReject(async () => { await ctx.window.fetch('/bad'); await flush(); });
  assert.deepStrictEqual(Object.keys(ctx.__bmwCapture.byProdNum), []);
});

test('indexes every vehicle in a multi-vehicle payload (not just [0])', async () => {
  const body = JSON.stringify({
    dataContent: { prodVehicleDetails: [
      { prodNum: 'A1', vin: 'V1' },
      { prodNum: 'A2', vin: 'V2' },
    ] },
  });
  const ctx = ctxWithFetch(() => Promise.resolve(makeResponse(body)));
  loadScript('before.js', ctx);
  await ctx.window.fetch('/garage');
  await flush();
  assert.strictEqual(ctx.__bmwCapture.byProdNum.A1.vin, 'V1');
  assert.strictEqual(ctx.__bmwCapture.byProdNum.A2.vin, 'V2');
});

test('fetch hook captures Authorization from init.headers (fetch-transport fallback)', async () => {
  const ctx = ctxWithFetch(() => Promise.resolve(makeResponse(DETAIL_JSON)));
  loadScript('before.js', ctx);
  await ctx.window.fetch('/track', { headers: { Authorization: 'Bearer xyz', Accept: 'application/json' } });
  await flush();
  assert.ok(ctx.__bmwCapture.headers, 'headers should be captured from fetch init');
  assert.strictEqual(ctx.__bmwCapture.headers.Authorization, 'Bearer xyz');
});

test('fetch with no init does not throw and leaves headers null', async () => {
  const ctx = ctxWithFetch(() => Promise.resolve(makeResponse(DETAIL_JSON)));
  loadScript('before.js', ctx);
  await assert.doesNotReject(async () => { await ctx.window.fetch('/x'); await flush(); });
  assert.strictEqual(ctx.__bmwCapture.headers, null, 'no Authorization seen -> headers stays null');
});

test('JSON served with a non-json content-type is still captured (symmetry with XHR)', async () => {
  const ctx = ctxWithFetch(() => Promise.resolve(makeResponse(DETAIL_JSON, { contentType: 'text/plain' })));
  loadScript('before.js', ctx);
  await ctx.window.fetch('/x');
  await flush();
  assert.ok(ctx.__bmwCapture.byProdNum.P123, 'text/plain JSON should still ingest');
});

test('reused XHR instance binds the load listener once, not per send()', () => {
  const ctx = ctxWithFetch(() => Promise.resolve(makeResponse(DETAIL_JSON)));
  loadScript('before.js', ctx);
  const xhr = new ctx.XMLHttpRequest();
  xhr.open('GET', '/track');
  xhr.send();   // binds the load listener
  xhr.send();   // old code would stack a second listener here
  xhr.send();
  assert.strictEqual(xhr._listeners.load.length, 1,
    'exactly one load listener should be bound across repeated send() calls');
});
