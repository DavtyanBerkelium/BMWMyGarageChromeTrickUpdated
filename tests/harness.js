'use strict';
// Zero-dependency browser-environment fakes + a vm loader so we can run the
// extension's MAIN-world IIFEs (before.js / execute.js) exactly as shipped.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

// Run a flush of pending micro/macro tasks so promise chains inside the
// scripts (e.g. res.clone().text().then(ingest)) settle before we assert.
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Minimal fetch Response double. `body` is the text the script will read.
function makeResponse(body, { ok = true, status = 200, contentType = 'application/json' } = {}) {
  const headers = {
    get(name) {
      return String(name).toLowerCase() === 'content-type' ? contentType : null;
    },
  };
  const res = {
    ok,
    status,
    headers,
    clone() { return makeResponse(body, { ok, status, contentType }); },
    text() { return Promise.resolve(body); },
    json() { return Promise.resolve(JSON.parse(body)); },
  };
  return res;
}

// Minimal XMLHttpRequest double whose prototype before.js will monkey-patch.
function makeXHRClass() {
  class FakeXHR {
    constructor() {
      this._listeners = {};
      this.status = 0;
      this.responseText = '';
    }
    open() {}
    send() {}
    setRequestHeader() {}
    addEventListener(type, cb) {
      (this._listeners[type] || (this._listeners[type] = [])).push(cb);
    }
    // Test helper: simulate the response arriving.
    _fire(type) {
      (this._listeners[type] || []).forEach((cb) => cb.call(this, {}));
    }
  }
  return FakeXHR;
}

// Minimal DOM element that records what HTML gets injected into it.
function makeElement(className) {
  return {
    className: className || '',
    injected: [],
    removed: false,
    insertAdjacentHTML(position, html) {
      this.injected.push({ position, html });
    },
    remove() { this.removed = true; },
  };
}

// Minimal document supporting the selectors execute.js uses. `elements` maps a
// CSS selector string to the element returned by querySelector.
function makeDocument(elements = {}) {
  const removedSets = [];
  const doc = {
    _custom: [],
    body: makeElement('body'),
    querySelector(sel) { return elements[sel] || null; },
    querySelectorAll(sel) {
      // execute.js only querySelectorAll('.c-custom-details') to clear old panels.
      const set = doc._custom.slice();
      removedSets.push(set);
      return {
        forEach(fn) { set.forEach(fn); },
      };
    },
  };
  return doc;
}

function makeStorage(initial = {}) {
  const data = Object.assign({}, initial);
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem(k, v) { data[k] = String(v); },
  };
}

// Build a vm context (sandbox) with `window === globalThis` so scripts that read
// both `window.fetch` and `globalThis.__bmwCapture` see one shared global.
function makeContext(extra = {}) {
  const sandbox = Object.assign({ console, setTimeout, clearTimeout }, extra);
  vm.createContext(sandbox);
  // Alias window/self to the global object, the way browsers do.
  vm.runInContext('this.window = this; this.self = this; this.globalThis = this;', sandbox);
  return sandbox;
}

function loadScript(name, context) {
  const code = fs.readFileSync(path.join(ROOT, name), 'utf8');
  vm.runInContext(code, context, { filename: name });
  return context;
}

module.exports = {
  ROOT, flush, makeResponse, makeXHRClass, makeElement,
  makeDocument, makeStorage, makeContext, loadScript,
};
