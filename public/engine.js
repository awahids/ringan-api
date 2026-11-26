/*
 * Ringan API request engine, shared by the app (browser/Electron) and the CLI runner (Node).
 * Pure logic: variables, auth, URL building, and the pre-request -> send -> post-response flow.
 * The transport (`send`) and the script sandbox (`sandbox`) are injected by the caller.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RinganEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const uid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
  const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  const kv = (key = '', value = '', enabled = true) => ({ key, value, enabled });
  const on = (x) => x.enabled !== false && x.key;
  const kvObj = (list) => Object.fromEntries((list || []).filter(on).map((x) => [x.key, x.value]));

  function eachRequest(items, fn, anc = []) {
    for (const it of items) it.type === 'folder' ? eachRequest(it.items, fn, [...anc, it]) : fn(it, anc);
  }
  const activeEnv = (col) => (col.environments || []).find((e) => e.id === col.activeEnvId) || null;

  function mergedVars(col, env, item, runtime) {
    return Object.assign({}, kvObj(col.vars), env ? kvObj(env.vars) : {}, item ? kvObj(item.vars) : {}, runtime || {});
  }
  function varState(col, env, item, runtime) {
    return { env: env ? kvObj(env.vars) : null, envName: env ? env.name : null, collection: kvObj(col.vars), request: kvObj(item.vars), runtime: clone(runtime || {}) };
  }
  function resolveAuth(item, ancestors, col) {
    if (item.auth && item.auth.type !== 'inherit') return item.auth;
    for (const f of [...ancestors].reverse()) if (f.auth && f.auth.type !== 'inherit') return Object.assign({ from: `folder "${f.name}"` }, f.auth);
    return Object.assign({ from: 'collection' }, col.auth || { type: 'none' });
  }
  function mergedHeaders(item, ancestors, col) {
    const out = [];
    const add = (list, from) => (list || []).filter(on).forEach((x) => {
      const i = out.findIndex((y) => y.key.toLowerCase() === x.key.toLowerCase());
      if (i >= 0) out.splice(i, 1);
      out.push({ key: x.key, value: x.value, from });
    });
    add(col.headers, 'collection');
    ancestors.forEach((f) => add(f.headers, `folder "${f.name}"`));
    if (item) add(item.headers, 'request');
    return out;
  }

  // ---- URL <-> params (the URL is the source of truth for enabled query params)
  function splitUrl(url) {
    const i = url.indexOf('?');
    return i < 0 ? [url, null] : [url.slice(0, i), url.slice(i + 1)];
  }
  function syncPathParams(item) {
    const [base] = splitUrl(item.url);
    const names = [...base.matchAll(/\/:([A-Za-z_][\w-]*)/g)].map((m) => m[1]);
    item.pathParams = names.map((n) => item.pathParams.find((p) => p.key === n) || kv(n, ''));
  }
  function syncParamsFromUrl(item) {
    const [, q] = splitUrl(item.url);
    const parsed = q == null ? [] : q.split('#')[0].split('&').filter((s) => s !== '').map((p) => {
      const i = p.indexOf('=');
      return kv(i < 0 ? p : p.slice(0, i), i < 0 ? '' : p.slice(i + 1));
    });
    item.params = [...parsed, ...item.params.filter((p) => p.enabled === false)];
    syncPathParams(item);
  }
  function syncUrlFromParams(item) {
    const [base] = splitUrl(item.url);
    const q = item.params.filter(on).map((p) => `${p.key}=${p.value}`).join('&');
    item.url = q ? `${base}?${q}` : base;
  }

  // ---- interpolation
  function dynVar(name) {
    switch (name) {
      case '$guid': case '$randomUUID': case '$uuid': return uid();
      case '$timestamp': return String(Math.floor(Date.now() / 1000));
      case '$isoTimestamp': return new Date().toISOString();
      case '$randomInt': return String(Math.floor(Math.random() * 1000));
      case '$randomEmail': return `user${Math.floor(Math.random() * 1e6)}@example.com`;
      default: return undefined;
    }
  }
  function interpolate(str, vars, miss, depth = 0) {
    return String(str ?? '').replace(/\{\{\s*([^{}\s][^{}]*?)\s*\}\}/g, (m, name) => {
      if (name[0] === '$') { const d = dynVar(name); if (d !== undefined) return d; }
      if (Object.prototype.hasOwnProperty.call(vars, name)) {
        let v = vars[name];
        v = typeof v === 'string' ? v : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
        return depth < 5 && v.includes('{{') ? interpolate(v, vars, miss, depth + 1) : v;
      }
      if (miss) miss.add(name);
      return m;
    });
  }
  const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
  function finalizeUrl(url, extraQuery) {
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = 'http://' + url;
    let hash = '';
    const hi = url.indexOf('#');
    if (hi >= 0) { hash = url.slice(hi); url = url.slice(0, hi); }
    const [base, q] = splitUrl(url);
    const pairs = q ? q.split('&').filter(Boolean).map((p) => { const i = p.indexOf('='); return i < 0 ? [p, null] : [p.slice(0, i), p.slice(i + 1)]; }) : [];
    for (const e of extraQuery || []) pairs.push(e);
    const enc = (s) => encodeURIComponent(safeDecode(s));
    const qs = pairs.map(([k, v]) => enc(k) + (v === null ? '' : '=' + enc(v))).join('&');
    return base + (qs ? '?' + qs : '') + hash;
  }
  const b64utf8 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

  function scriptBody(b) {
    if (b.mode === 'json') { try { return JSON.parse(b.content); } catch { return b.content; } }
    if (b.mode === 'text' || b.mode === 'xml') return b.content;
    if (b.mode === 'form' || b.mode === 'multipart') return kvObj(b.form.filter((f) => f.type !== 'file'));
    return undefined;
  }

  /** Turns the request model into the exact wire request (after pre-request scripts). */
  function buildWire(item, col, ancestors, req, vars) {
    const miss = new Set();
    const I = (s) => interpolate(s, vars, miss);
    let url = String(req.url || '').replace(/\/:([A-Za-z_][\w-]*)/g, (m, n) => {
      const p = (item.pathParams || []).find((x) => x.key === n && x.enabled !== false);
      return p && p.value !== '' ? '/' + encodeURIComponent(I(p.value)) : m;
    });
    url = I(url).trim();
    const headers = Object.entries(req.headers || {}).map(([k, v]) => [I(k).trim(), I(String(v ?? ''))]).filter(([k]) => k);
    const has = (n) => headers.some(([k]) => k.toLowerCase() === n.toLowerCase());
    const auth = resolveAuth(item, ancestors, col);
    const extraQuery = [];
    if (auth.type === 'bearer' && auth.token && !has('authorization')) headers.push(['Authorization', 'Bearer ' + I(auth.token)]);
    else if (auth.type === 'basic' && !has('authorization')) headers.push(['Authorization', 'Basic ' + b64utf8(I(auth.username || '') + ':' + I(auth.password || ''))]);
    else if (auth.type === 'apikey' && auth.key) {
      if (auth.in === 'query') extraQuery.push([I(auth.key), I(auth.value || '')]);
      else if (!has(I(auth.key))) headers.push([I(auth.key), I(auth.value || '')]);
    }
    url = finalizeUrl(url, extraQuery);
    const mode = item.body.mode;
    let body = { type: 'none' };
    const setCT = (ct) => { if (!has('content-type')) headers.push(['Content-Type', ct]); };
    if (mode === 'json' || mode === 'text' || mode === 'xml' || (mode === 'none' && req.body != null && req.body !== '')) {
      let raw = req.body;
      if (raw != null && typeof raw !== 'string') raw = JSON.stringify(raw, null, 2);
      raw = I(raw ?? '');
      if (raw !== '') {
        body = { type: 'text', text: raw };
        setCT(mode === 'xml' ? 'application/xml' : mode === 'text' ? 'text/plain' : 'application/json');
      }
    } else if (mode === 'form') {
      const enc = encodeURIComponent;
      body = { type: 'text', text: item.body.form.filter(on).map((f) => enc(I(f.key)) + '=' + enc(I(f.value))).join('&') };
      setCT('application/x-www-form-urlencoded');
    } else if (mode === 'multipart') {
      for (let i = headers.length - 1; i >= 0; i--) if (/^content-type$/i.test(headers[i][0])) headers.splice(i, 1);
      body = {
        type: 'multipart',
        parts: item.body.form.filter(on).map((f) => (f.type === 'file'
          ? { name: I(f.key), file: true, fileName: f.fileName || 'file', contentType: f.contentType || 'application/octet-stream', base64: f.data || '' }
          : { name: I(f.key), value: I(f.value) })),
      };
    }
    return { method: String(req.method || 'GET').toUpperCase(), url, headers, body, unresolved: [...miss] };
  }

  /** Applies variable changes returned by a script run. Returns true when stored data changed. */
  function applyVarChanges(col, env, vars, runtimeStore) {
    if (!vars) return false;
    const str = (v) => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v));
    let dirty = false;
    if (env) {
      for (const [k, v] of Object.entries(vars.envSet || {})) {
        const row = env.vars.find((x) => x.key === k);
        if (row) { row.value = str(v); row.enabled = true; } else env.vars.push(kv(k, str(v)));
        dirty = true;
      }
      for (const k of vars.envUnset || []) { env.vars = env.vars.filter((x) => x.key !== k); dirty = true; }
    }
    for (const [k, v] of Object.entries(vars.colSet || {})) {
      const row = col.vars.find((x) => x.key === k);
      if (row) row.value = str(v); else col.vars.push(kv(k, str(v)));
      dirty = true;
    }
    if (vars.runtime && runtimeStore) runtimeStore[col.id] = vars.runtime;
    return dirty;
  }

  function schemaJob(item, col) {
    const map = item.responseSchemas;
    if (!item.schemaCheck || !map || !Object.keys(map).length) return undefined;
    return { schemas: map, components: (col.openapi && col.openapi.components) || {}, definitions: (col.openapi && col.openapi.definitions) || {} };
  }

  /**
   * Runs one request: pre-request scripts -> send -> post-response scripts, tests, assertions, schema.
   * ctx: { send(payload, signal) -> response, sandbox(job) -> result, settings, runtime (map colId -> vars), onDirty(), signal }
   */
  async function execute(item, col, ancestors, ctx) {
    const env = activeEnv(col);
    const runtime = ctx.runtime;
    const result = { at: Date.now(), logs: [], tests: [], unresolved: [] };
    const headersObj = {};
    for (const x of mergedHeaders(item, ancestors, col)) headersObj[x.key] = x.value;
    let req = { method: item.method, url: item.url, headers: headersObj, body: scriptBody(item.body) };
    const apply = (vars) => { if (applyVarChanges(col, env, vars, runtime) && ctx.onDirty) ctx.onDirty(); };

    const pre = [['Collection pre-request', col.preScript], ['Pre-request script', item.preScript]].filter(([, c]) => c && c.trim());
    if (pre.length) {
      const r = await ctx.sandbox({ phase: 'pre', reqName: item.name, scripts: pre.map(([label, code]) => ({ label, code })), req, vars: varState(col, env, item, runtime[col.id]) });
      result.logs.push(...(r.logs || []));
      apply(r.vars);
      if (r.error) { result.error = r.error; result.phase = 'pre-request'; return result; }
      if (r.req) req = r.req;
      if (r.skip) { result.skipped = true; return result; }
      if (r.nextRequest !== undefined) result.nextRequest = r.nextRequest;
    }

    const wire = buildWire(item, col, ancestors, req, mergedVars(col, env, item, runtime[col.id]));
    result.request = wire;
    result.unresolved = wire.unresolved;
    const s = ctx.settings || {};
    const resp = await ctx.send({ method: wire.method, url: wire.url, headers: wire.headers, body: wire.body, timeoutMs: s.timeoutMs, insecure: s.verifyTls === false, followRedirects: s.followRedirects !== false }, ctx.signal);
    if (resp.error) { result.error = resp.error; result.phase = 'request'; return result; }
    result.response = resp;

    let parsed = resp.bodyText;
    if (resp.bodyText != null) { try { parsed = JSON.parse(resp.bodyText); result.isJson = true; } catch {} }

    const post = [['Collection post-response', col.postScript], ['Post-response script', item.postScript]].filter(([, c]) => c && c.trim());
    const tests = [['Collection tests', col.tests], ['Tests', item.tests]].filter(([, c]) => c && c.trim());
    const vars = mergedVars(col, env, item, runtime[col.id]);
    const asserts = (item.asserts || []).filter(on).map((a) => ({ key: a.key, value: interpolate(a.value, vars) }));
    const schema = schemaJob(item, col);
    if (post.length || tests.length || asserts.length || schema) {
      const r = await ctx.sandbox({
        phase: 'post', reqName: item.name,
        scripts: post.map(([label, code]) => ({ label, code })),
        tests: tests.map(([label, code]) => ({ label, code })),
        asserts,
        schema,
        req: { method: wire.method, url: wire.url, headers: Object.fromEntries(wire.headers), body: req.body },
        res: { status: resp.status, statusText: resp.statusText, headers: resp.headers, body: parsed, responseTime: resp.timeMs, size: resp.size, url: resp.url },
        vars: varState(col, env, item, runtime[col.id]),
      });
      result.logs.push(...(r.logs || []));
      result.tests = r.tests || [];
      apply(r.vars);
      if (r.error) result.scriptError = r.error;
      if (r.nextRequest !== undefined) result.nextRequest = r.nextRequest;
    }
    return result;
  }

  const resultOk = (r) => !!(r && !r.error && !r.scriptError && r.response && (r.tests || []).every((t) => t.passed));

  /** Flattens a collection (or a folder inside it) into an ordered run list. */
  function runList(col, folder) {
    const list = [];
    const base = [];
    if (folder) {
      (function find(items, anc) {
        for (const it of items) {
          if (it === folder) { base.push(...anc, it); return true; }
          if (it.type === 'folder' && find(it.items, [...anc, it])) return true;
        }
        return false;
      })(col.items, []);
    }
    eachRequest((folder || col).items, (it, anc) => list.push({ item: it, anc: [...base, ...anc] }));
    return list;
  }

  /** Runs a list sequentially, honouring bru.setNextRequest. onResult(i, entry, result) after each. */
  async function runAll(list, col, ctx, { delayMs = 0, bail = false, onStart, onResult, shouldStop } = {}) {
    let i = 0;
    let steps = 0;
    while (i < list.length && steps < list.length * 10) {
      if (shouldStop && shouldStop()) break;
      steps++;
      const entry = list[i];
      if (onStart) onStart(i, entry);
      let r;
      try { r = await execute(entry.item, col, entry.anc, ctx); } catch (e) { r = { error: e.message, tests: [], logs: [] }; }
      if (onResult) onResult(i, entry, r);
      const ok = r.skipped || resultOk(r);
      if (!ok && bail) break;
      if (r.nextRequest === null) break;
      if (typeof r.nextRequest === 'string') {
        const j = list.findIndex((x) => x.item.name === r.nextRequest);
        if (j >= 0) { i = j; continue; }
      }
      i++;
      if (delayMs > 0 && i < list.length) await new Promise((res) => setTimeout(res, delayMs));
    }
  }

  return {
    uid, clone, kv, on, kvObj, eachRequest, activeEnv, mergedVars, varState, resolveAuth, mergedHeaders,
    splitUrl, syncPathParams, syncParamsFromUrl, syncUrlFromParams, interpolate, finalizeUrl, scriptBody,
    buildWire, applyVarChanges, execute, resultOk, runList, runAll,
  };
});
