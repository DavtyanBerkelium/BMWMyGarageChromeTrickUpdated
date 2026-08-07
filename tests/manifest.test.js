'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

test('manifest is MV3', () => {
  assert.strictEqual(manifest.manifest_version, 3);
});

test('declares a Chrome floor that supports static MAIN-world content scripts', () => {
  // content_scripts[].world: "MAIN" is only honored from Chrome 111.
  assert.strictEqual(manifest.minimum_chrome_version, '111');
});

test('all referenced files exist on disk', () => {
  const refs = [];
  manifest.content_scripts.forEach((cs) => cs.js.forEach((j) => refs.push(j)));
  refs.push(manifest.background.service_worker);
  Object.values(manifest.action.icons).forEach((i) => refs.push(i));
  refs.push(manifest.action.default_icon);
  for (const ref of refs) {
    assert.ok(fs.existsSync(path.join(ROOT, ref)), `referenced file missing: ${ref}`);
  }
});

test('host_permissions and content_script matches stay in sync (single host lock)', () => {
  assert.deepStrictEqual(manifest.host_permissions, ['https://mygarage.bmwusa.com/*']);
  const matches = manifest.content_scripts.flatMap((cs) => cs.matches);
  assert.deepStrictEqual(matches, ['https://mygarage.bmwusa.com/*']);
});

test('content script runs at document_start in MAIN world', () => {
  const cs = manifest.content_scripts[0];
  assert.strictEqual(cs.run_at, 'document_start');
  assert.strictEqual(cs.world, 'MAIN');
});

test('requests no broader permissions than needed', () => {
  // Guard against permission creep. `scripting` is the only API permission needed;
  // host access for executeScript comes from host_permissions, so activeTab is not.
  const allowed = new Set(['scripting']);
  for (const p of manifest.permissions) {
    assert.ok(allowed.has(p), `unexpected permission added: ${p}`);
  }
});
