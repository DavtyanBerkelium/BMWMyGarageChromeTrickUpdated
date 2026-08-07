// Runs at document_start in the page's MAIN world.
// Hooks fetch + XHR so any response containing dataContent.prodVehicleDetails
// gets indexed by prodNum for execute.js to render later.
(function () {
  if (globalThis.__bmwCaptureInstalled) return;
  globalThis.__bmwCaptureInstalled = true;

  const cap = globalThis.__bmwCapture = {
    byProdNum: Object.create(null),
    headers: null
  };

  function ingest(text) {
    if (!text || typeof text !== 'string') return;
    // Cheap pre-filter: any body that parses to an object carrying
    // dataContent.prodVehicleDetails necessarily contains this literal substring.
    // Skipping JSON.parse for the (overwhelmingly common) non-matching response
    // avoids parsing every JSON body the SPA fetches.
    if (text.indexOf('prodVehicleDetails') === -1) return;
    if (text[0] !== '{' && text[0] !== '[') return;
    let json;
    try { json = JSON.parse(text); } catch (_) { return; }
    const list = json && json.dataContent && Array.isArray(json.dataContent.prodVehicleDetails)
      ? json.dataContent.prodVehicleDetails
      : null;
    if (!list) return;
    // Index every vehicle in the payload, not just [0] — bulk/garage responses
    // can carry more than one, and byProdNum is keyed per vehicle.
    list.forEach(function (detail) {
      if (!detail || !detail.prodNum) return;
      const existing = cap.byProdNum[detail.prodNum] || {};
      cap.byProdNum[detail.prodNum] = Object.assign(existing, detail);
    });
  }

  // Normalize a Headers | [[k,v]] | {k:v} header source; if it carries an
  // Authorization header, record the whole set for execute.js's fallback fetch.
  function captureAuthHeaders(headerSource) {
    if (!headerSource) return;
    const collected = {};
    let auth = null;
    try {
      if (typeof Headers !== 'undefined' && headerSource instanceof Headers) {
        headerSource.forEach(function (v, k) { collected[k] = v; if (/^authorization$/i.test(k)) auth = v; });
      } else if (Array.isArray(headerSource)) {
        headerSource.forEach(function (pair) {
          if (!pair) return;
          collected[pair[0]] = pair[1];
          if (/^authorization$/i.test(pair[0])) auth = pair[1];
        });
      } else if (typeof headerSource === 'object') {
        Object.keys(headerSource).forEach(function (k) {
          collected[k] = headerSource[k];
          if (/^authorization$/i.test(k)) auth = headerSource[k];
        });
      }
    } catch (_) { return; }
    if (auth != null) cap.headers = collected;
  }

  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      const p = origFetch.apply(this, arguments);
      p.then(function (res) {
        if (!res || !res.ok) return;
        // Sniff auth from the request so the fallback works even when BMW issues
        // its authorized calls via fetch rather than XHR.
        try {
          if (init && init.headers) captureAuthHeaders(init.headers);
          else if (input && typeof input === 'object' && input.headers) captureAuthHeaders(input.headers);
        } catch (_) {}
        // Skip only clearly-non-data bodies; the XHR path has no content-type
        // filter, so keep them symmetric (JSON served as text/plain still ingests).
        const ct = res.headers && res.headers.get && res.headers.get('content-type');
        if (ct && (ct.indexOf('text/html') === 0 || ct.indexOf('image/') === 0)) return;
        try { res.clone().text().then(ingest).catch(function () {}); } catch (_) {}
      }).catch(function () {});
      return p;
    };
  }

  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const origOpen = XHR.prototype.open;
    const origSend = XHR.prototype.send;
    const origSetH = XHR.prototype.setRequestHeader;

    XHR.prototype.open = function (method, url) {
      this.__bmwUrl = url;
      this.__bmwHeaders = {};
      return origOpen.apply(this, arguments);
    };

    XHR.prototype.setRequestHeader = function (k, v) {
      if (this.__bmwHeaders) this.__bmwHeaders[k] = v;
      return origSetH.apply(this, arguments);
    };

    XHR.prototype.send = function () {
      const xhr = this;
      // Bind the load listener once per instance — reused XHRs (polling) would
      // otherwise stack a listener (and re-ingest) on every send().
      if (!xhr.__bmwBound) {
        xhr.__bmwBound = true;
        xhr.addEventListener('load', function () {
          if (xhr.status < 200 || xhr.status >= 300) return;
          if (xhr.__bmwHeaders && (xhr.__bmwHeaders.Authorization || xhr.__bmwHeaders.authorization)) {
            cap.headers = xhr.__bmwHeaders;
          }
          try { ingest(xhr.responseText); } catch (_) {}
        });
      }
      return origSend.apply(this, arguments);
    };
  }
})();
