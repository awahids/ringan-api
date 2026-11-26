// Runs collection scripts (pre-request, post-response, tests, assertions) in a dedicated Worker.
// The server delivers this file with a CSP of connect-src 'none', so scripts have no network access,
// no DOM, and no access to the app's storage or session token.
'use strict';
class AssertionError extends Error { constructor(m) { super(m); this.name = 'AssertionError'; } }

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const show = (v) => {
  if (typeof v === 'string') return JSON.stringify(v.length > 200 ? v.slice(0, 200) + '…' : v);
  try { const s = JSON.stringify(v); return s === undefined ? String(v) : s.length > 200 ? s.slice(0, 200) + '…' : s; } catch { return String(v); }
};
function deepEq(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => deepEq(a[k], b[k]));
}
const isEmpty = (v) => v == null || (typeof v === 'string' || Array.isArray(v) ? v.length === 0 : typeof v === 'object' ? Object.keys(v).length === 0 : false);

// ---- minimal chai-style expect
function Assertion(actual, msg) { this._a = actual; this._neg = false; this._deep = false; this._msg = msg; }
const P = Assertion.prototype;
['to', 'be', 'been', 'is', 'that', 'which', 'and', 'has', 'have', 'with', 'at', 'of', 'same', 'but', 'does', 'still', 'also'].forEach((w) =>
  Object.defineProperty(P, w, { get() { return this; } }));
Object.defineProperty(P, 'not', { get() { this._neg = !this._neg; return this; } });
Object.defineProperty(P, 'deep', { get() { this._deep = true; return this; } });
P._assert = function (cond, pos, neg) {
  const ok = this._neg ? !cond : !!cond;
  if (!ok) throw new AssertionError((this._msg ? this._msg + ': ' : '') + (this._neg ? neg || pos.replace(' to ', ' to not ') : pos));
  return this;
};
P.equal = P.equals = P.eq = function (v) {
  return this._assert(this._deep ? deepEq(this._a, v) : this._a === v, `expected ${show(this._a)} to equal ${show(v)}`, `expected ${show(this._a)} to not equal ${show(v)}`);
};
P.eql = function (v) { return this._assert(deepEq(this._a, v), `expected ${show(this._a)} to deeply equal ${show(v)}`, `expected ${show(this._a)} to not deeply equal ${show(v)}`); };
P.a = P.an = function (type) { return this._assert(typeOf(this._a) === String(type).toLowerCase(), `expected ${show(this._a)} to be a ${type}`, `expected ${show(this._a)} not to be a ${type}`); };
P.include = P.includes = P.contain = P.contains = function (v) {
  const a = this._a;
  let c = false;
  if (typeof a === 'string') c = a.includes(v);
  else if (Array.isArray(a)) c = a.some((x) => deepEq(x, v));
  else if (a && typeof a === 'object' && v && typeof v === 'object') c = Object.keys(v).every((k) => deepEq(a[k], v[k]));
  return this._assert(c, `expected ${show(a)} to include ${show(v)}`, `expected ${show(a)} to not include ${show(v)}`);
};
P.property = function (name, val) {
  const a = this._a;
  const has = a != null && name in Object(a);
  if (arguments.length > 1) return this._assert(has && deepEq(a[name], val), `expected ${show(a)} to have property '${name}' of ${show(val)}`, `expected ${show(a)} to not have property '${name}' of ${show(val)}`);
  this._assert(has, `expected ${show(a)} to have property '${name}'`, `expected ${show(a)} to not have property '${name}'`);
  if (!this._neg) this._a = a[name];
  return this;
};
P.lengthOf = P.length = function (n) {
  const l = this._a == null ? undefined : this._a.length ?? this._a.size;
  return this._assert(l === n, `expected length ${l} to equal ${n}`, `expected length to not equal ${n}`);
};
P.above = P.gt = P.greaterThan = function (n) { return this._assert(this._a > n, `expected ${show(this._a)} to be above ${n}`); };
P.least = P.gte = function (n) { return this._assert(this._a >= n, `expected ${show(this._a)} to be at least ${n}`); };
P.below = P.lt = P.lessThan = function (n) { return this._assert(this._a < n, `expected ${show(this._a)} to be below ${n}`); };
P.most = P.lte = function (n) { return this._assert(this._a <= n, `expected ${show(this._a)} to be at most ${n}`); };
P.within = function (lo, hi) { return this._assert(this._a >= lo && this._a <= hi, `expected ${show(this._a)} to be within ${lo}..${hi}`); };
P.oneOf = function (list) { return this._assert(list.some((x) => deepEq(x, this._a)), `expected ${show(this._a)} to be one of ${show(list)}`); };
P.match = P.matches = function (re) { return this._assert(new RegExp(re).test(String(this._a)), `expected ${show(this._a)} to match ${re}`); };
P.string = function (s) { return this._assert(String(this._a).includes(s), `expected ${show(this._a)} to contain ${show(s)}`); };
P.keys = P.key = function (...ks) {
  ks = ks.flat();
  const a = this._a && typeof this._a === 'object' ? Object.keys(this._a) : [];
  return this._assert(ks.every((k) => a.includes(k)), `expected ${show(this._a)} to have keys ${show(ks)}`);
};
P.instanceOf = P.instanceof = function (C) { return this._assert(this._a instanceof C, `expected ${show(this._a)} to be an instance of ${C && C.name}`); };
P.satisfy = P.satisfies = function (fn) { return this._assert(fn(this._a), `expected ${show(this._a)} to satisfy ${fn}`); };
P.status = function (n) { const s = this._a && this._a.status; return this._assert(s === n, `expected status ${s} to equal ${n}`); };
const getterAssert = (name, fn, pos) => Object.defineProperty(P, name, { get() { return this._assert(fn(this._a), `expected ${show(this._a)} ${pos}`); } });
getterAssert('ok', (a) => !!a, 'to be truthy');
getterAssert('true', (a) => a === true, 'to be true');
getterAssert('false', (a) => a === false, 'to be false');
getterAssert('null', (a) => a === null, 'to be null');
getterAssert('undefined', (a) => a === undefined, 'to be undefined');
getterAssert('exist', (a) => a != null, 'to exist');
getterAssert('empty', isEmpty, 'to be empty');
getterAssert('NaN', (a) => Number.isNaN(a), 'to be NaN');
const expect = (v, msg) => new Assertion(v, msg);
expect.fail = (m) => { throw new AssertionError(m || 'expect.fail()'); };

function getPath(obj, path) {
  if (path == null || path === '') return obj;
  const parts = [];
  String(path).replace(/\[(\d+|"[^"]*"|'[^']*')\]|[^.[\]]+/g, (m, br) => { parts.push(br != null ? (/^\d+$/.test(br) ? Number(br) : br.slice(1, -1)) : m); return m; });
  let cur = obj;
  for (const p of parts) { if (cur == null) return undefined; cur = cur[p]; }
  return cur;
}

// ---- Bruno-style declarative assertions: "res.status: eq 200"
const OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'contains', 'notContains', 'length', 'matches', 'notMatches', 'startsWith', 'endsWith', 'between', 'isEmpty', 'isNotEmpty', 'isNull', 'isUndefined', 'isDefined', 'isTruthy', 'isFalsy', 'isJson', 'isNumber', 'isString', 'isBoolean', 'isArray']);
function parseRhs(s) {
  s = String(s ?? '').trim();
  if (s === '') return '';
  if ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'"))) return s.slice(1, -1);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (s === 'undefined') return undefined;
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return Number(s);
  if (/^[[{]/.test(s)) { try { return JSON.parse(s); } catch {} }
  return s;
}
const listRhs = (s) => { const v = parseRhs(s); return Array.isArray(v) ? v : String(s).split(',').map((x) => parseRhs(x)); };
function looseEq(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' || typeof b === 'number') return a !== '' && b !== '' && a !== null && b !== null && Number(a) === Number(b);
  if (a && b && typeof a === 'object' && typeof b === 'object') return deepEq(a, b);
  if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b);
  return a != null && b != null && String(a) === String(b);
}

// ---- response validation against OpenAPI / JSON Schema
function resolveRef(root, s, seen = 0) {
  while (s && typeof s.$ref === 'string' && seen < 30) {
    const ref = s.$ref;
    let target;
    if (ref.startsWith('#/components/schemas/')) target = (root.components && root.components.schemas || {})[decodeURIComponent(ref.slice(21)).replace(/~1/g, '/').replace(/~0/g, '~')];
    else if (ref.startsWith('#/definitions/')) target = (root.definitions || {})[decodeURIComponent(ref.slice(14)).replace(/~1/g, '/').replace(/~0/g, '~')];
    if (!target) throw new Error(`$ref tidak ditemukan: ${ref}`);
    s = target;
    seen++;
  }
  return s;
}
const typeMatches = (t, v) => {
  switch (t) {
    case 'integer': return Number.isInteger(v);
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'string': return typeof v === 'string';
    case 'boolean': return typeof v === 'boolean';
    case 'array': return Array.isArray(v);
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'null': return v === null;
    default: return true;
  }
};
const FORMATS = {
  'date-time': (v) => !Number.isNaN(Date.parse(v)) && /\d{4}-\d{2}-\d{2}T/.test(v),
  date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v),
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  uuid: (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  uri: (v) => /^[a-z][a-z0-9+.-]*:/i.test(v),
};
function validateSchema(root, schema, value, at, errs, depth) {
  if (errs.length >= 25 || depth > 60) return;
  schema = resolveRef(root, schema);
  if (!schema || schema === true || typeof schema !== 'object') return;
  const types = schema.type === undefined ? [] : [].concat(schema.type);
  if (value === null && (schema.nullable || types.includes('null'))) return;
  if (schema.allOf) for (const s of schema.allOf) validateSchema(root, s, value, at, errs, depth + 1);
  const alts = schema.oneOf || schema.anyOf;
  if (alts) {
    const ok = alts.some((s) => { const e = []; validateSchema(root, s, value, at, e, depth + 1); return !e.length; });
    if (!ok) errs.push(`${at}: tidak cocok dengan pilihan ${schema.oneOf ? 'oneOf' : 'anyOf'} mana pun`);
  }
  if (schema.enum && !schema.enum.some((x) => deepEq(x, value))) errs.push(`${at}: harus salah satu dari ${show(schema.enum)}, dapat ${show(value)}`);
  if (schema.const !== undefined && !deepEq(schema.const, value)) errs.push(`${at}: harus ${show(schema.const)}`);
  if (types.length && !types.some((t) => typeMatches(t, value))) {
    errs.push(`${at}: harus bertipe ${types.join('|')}, dapat ${typeOf(value)}${value === null ? '' : ' ' + show(value)}`);
    return;
  }
  const isObj = value !== null && typeof value === 'object' && !Array.isArray(value);
  if (isObj && (schema.properties || schema.required || schema.additionalProperties !== undefined)) {
    for (const k of schema.required || []) if (!(k in value)) errs.push(`${at}: field wajib "${k}" tidak ada`);
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      const p = `${at}.${k}`;
      if (props[k]) validateSchema(root, props[k], v, p, errs, depth + 1);
      else if (schema.additionalProperties === false) errs.push(`${p}: field tidak dikenal (additionalProperties: false)`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') validateSchema(root, schema.additionalProperties, v, p, errs, depth + 1);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errs.push(`${at}: minimal ${schema.minItems} item, dapat ${value.length}`);
    if (schema.maxItems != null && value.length > schema.maxItems) errs.push(`${at}: maksimal ${schema.maxItems} item, dapat ${value.length}`);
    if (schema.items) value.slice(0, 1000).forEach((v, i) => validateSchema(root, schema.items, v, `${at}[${i}]`, errs, depth + 1));
  }
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errs.push(`${at}: panjang minimal ${schema.minLength}`);
    if (schema.maxLength != null && value.length > schema.maxLength) errs.push(`${at}: panjang maksimal ${schema.maxLength}`);
    if (schema.pattern) { try { if (!new RegExp(schema.pattern).test(value)) errs.push(`${at}: tidak cocok dengan pola ${schema.pattern}`); } catch {} }
    if (schema.format && FORMATS[schema.format] && !FORMATS[schema.format](value)) errs.push(`${at}: format ${schema.format} tidak valid (${show(value)})`);
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && (schema.exclusiveMinimum === true ? value <= schema.minimum : value < schema.minimum)) errs.push(`${at}: minimal ${schema.minimum}`);
    if (schema.maximum != null && (schema.exclusiveMaximum === true ? value >= schema.maximum : value > schema.maximum)) errs.push(`${at}: maksimal ${schema.maximum}`);
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) errs.push(`${at}: harus > ${schema.exclusiveMinimum}`);
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) errs.push(`${at}: harus < ${schema.exclusiveMaximum}`);
  }
}
function evalSchema(job, RS) {
  const map = job.schemas || {};
  const code = String(RS.status);
  const key = map[code] ? code : map[code[0] + 'XX'] ? code[0] + 'XX' : map[code[0] + 'xx'] ? code[0] + 'xx' : map.default ? 'default' : null;
  const entry = { name: `Response sesuai schema (status ${code})`, passed: false, kind: 'schema' };
  if (!key) { entry.error = `Status ${code} tidak didefinisikan di spec (tersedia: ${Object.keys(map).join(', ')})`; return entry; }
  entry.name = `Response sesuai schema (${key === code ? code : key + ' untuk ' + code})`;
  try {
    const errs = [];
    validateSchema({ components: job.components || {}, definitions: job.definitions || {} }, map[key], RS.body, '$', errs, 0);
    if (errs.length) entry.error = errs.slice(0, 10).join('\n') + (errs.length > 10 ? `\n… dan ${errs.length - 10} lagi` : '');
    else entry.passed = true;
  } catch (err) { entry.error = (err && err.message) || String(err); }
  return entry;
}

self.onmessage = async (e) => {
  const job = e.data;
  const out = { id: job.id, logs: [], tests: [], error: null };
  const V = job.vars || { env: null, collection: {}, request: {}, runtime: {} };
  V.runtime = V.runtime || {};
  const envSet = {}, envUnset = [], colSet = {};
  const fmt = (a) => a.map((x) => (typeof x === 'string' ? x : (() => { try { return JSON.stringify(x, null, 2); } catch { return String(x); } })())).join(' ');
  const log = (level) => (...a) => out.logs.push({ level, msg: fmt(a) });
  const con = { log: log('log'), info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') };
  const allVars = () => Object.assign({}, V.collection, V.env || {}, V.request, V.runtime);
  const interp = (s) => String(s ?? '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, n) => { const a = allVars(); return n in a ? (typeof a[n] === 'object' ? JSON.stringify(a[n]) : String(a[n])) : m; });

  const bru = {
    getEnvVar: (k) => (V.env ? V.env[k] : undefined),
    setEnvVar: (k, v) => {
      if (!V.env) { V.runtime[k] = v; con.warn(`bru.setEnvVar("${k}"): tidak ada environment aktif, disimpan sebagai runtime var.`); return; }
      V.env[k] = v; envSet[k] = v;
    },
    deleteEnvVar: (k) => { if (V.env) { delete V.env[k]; envUnset.push(k); } },
    hasEnvVar: (k) => !!V.env && k in V.env,
    getEnvName: () => V.envName || null,
    getVar: (k) => V.runtime[k],
    setVar: (k, v) => { V.runtime[k] = v; },
    deleteVar: (k) => { delete V.runtime[k]; },
    deleteAllVars: () => { for (const k of Object.keys(V.runtime)) delete V.runtime[k]; },
    hasVar: (k) => k in V.runtime,
    getCollectionVar: (k) => V.collection[k],
    getRequestVar: (k) => V.request[k],
    getFolderVar: () => undefined,
    getGlobalEnvVar: (k) => V.runtime[k],
    setGlobalEnvVar: (k, v) => { V.runtime[k] = v; },
    getProcessEnv: () => undefined,
    interpolate: interp,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    setNextRequest: (name) => { out.nextRequest = name; },
    runner: { setNextRequest: (n) => { out.nextRequest = n; }, skipRequest: () => { out.skip = true; }, stopExecution: () => { out.nextRequest = null; } },
  };

  const R = job.req ? JSON.parse(JSON.stringify(job.req)) : null;
  if (R) R.headers = R.headers || {};
  const findH = (obj, n) => Object.keys(obj).find((k) => k.toLowerCase() === String(n).toLowerCase());
  const req = R && {
    get url() { return R.url; }, set url(v) { R.url = v; },
    get method() { return R.method; }, set method(v) { R.method = v; },
    get headers() { return R.headers; },
    get body() { return R.body; }, set body(v) { R.body = v; },
    getUrl: () => R.url, setUrl: (u) => { R.url = String(u); },
    getMethod: () => R.method, setMethod: (m) => { R.method = String(m).toUpperCase(); },
    getHeader: (n) => { const k = findH(R.headers, n); return k ? R.headers[k] : undefined; },
    getHeaders: () => R.headers,
    setHeader: (n, v) => { const k = findH(R.headers, n); if (k) delete R.headers[k]; R.headers[n] = String(v); },
    setHeaders: (o) => { R.headers = Object.assign({}, o); },
    deleteHeader: (n) => { const k = findH(R.headers, n); if (k) delete R.headers[k]; },
    getBody: () => R.body, setBody: (b) => { R.body = b; },
    getName: () => job.reqName, setTimeout: () => {}, setMaxRedirects: () => {},
  };

  let res;
  const RS = job.res;
  if (RS) {
    const getH = (n) => { const k = findH(RS.headers || {}, n); return k ? RS.headers[k] : undefined; };
    res = function (path) { return getPath(RS.body, path); };
    Object.assign(res, {
      status: RS.status, statusText: RS.statusText, headers: RS.headers, body: RS.body, responseTime: RS.responseTime, size: RS.size, url: RS.url,
      getStatus: () => RS.status, getStatusText: () => RS.statusText, getHeader: getH, getHeaders: () => RS.headers,
      getBody: () => RS.body, setBody: (b) => { RS.body = b; res.body = b; },
      getResponseTime: () => RS.responseTime, getSize: () => ({ body: RS.size, header: 0, total: RS.size }), getUrl: () => RS.url,
    });
  }

  const pending = [];
  const test = (name, fn) => {
    const entry = { name: String(name), passed: false, kind: 'test' };
    out.tests.push(entry);
    const p = (async () => {
      try { await fn(); entry.passed = true; } catch (err) { entry.error = (err && err.message) || String(err); }
    })();
    pending.push(p);
    return p;
  };

  const pmResponse = RS && {
    code: RS.status, status: RS.statusText, responseTime: RS.responseTime,
    headers: { get: (n) => res.getHeader(n), has: (n) => res.getHeader(n) !== undefined },
    json: () => (typeof RS.body === 'string' ? JSON.parse(RS.body) : RS.body),
    text: () => (typeof RS.body === 'string' ? RS.body : JSON.stringify(RS.body)),
    to: {
      have: {
        status: (n) => expect(RS.status, 'status').to.equal(n),
        header: (n) => expect(res.getHeader(n) !== undefined, `header "${n}" ada`).to.be.true,
      },
      be: {
        get ok() { expect(RS.status >= 200 && RS.status < 300, `status ${RS.status} adalah 2xx`).to.be.true; return true; },
        get success() { expect(RS.status >= 200 && RS.status < 300, `status ${RS.status} adalah 2xx`).to.be.true; return true; },
      },
    },
  };
  const pm = {
    test, expect,
    environment: { get: bru.getEnvVar, set: bru.setEnvVar, unset: bru.deleteEnvVar, has: bru.hasEnvVar, replaceIn: interp },
    variables: { get: (k) => allVars()[k], set: bru.setVar, unset: bru.deleteVar, has: (k) => k in allVars(), replaceIn: interp },
    collectionVariables: { get: (k) => V.collection[k], set: (k, v) => { V.collection[k] = v; colSet[k] = v; }, unset: (k) => { delete V.collection[k]; }, has: (k) => k in V.collection },
    globals: { get: bru.getVar, set: bru.setVar, unset: bru.deleteVar, has: bru.hasVar },
    request: req && {
      get url() { return R.url; }, get method() { return R.method; }, get body() { return R.body; },
      headers: { add: (h) => req.setHeader(h.key, h.value), upsert: (h) => req.setHeader(h.key, h.value), remove: (k) => req.deleteHeader(k), get: (k) => req.getHeader(k) },
    },
    response: pmResponse,
    info: { requestName: job.reqName },
    setNextRequest: bru.setNextRequest,
    sendRequest: () => { throw new Error('pm.sendRequest tidak didukung (script berjalan tanpa akses jaringan).'); },
  };
  const requireStub = (m) => { throw new Error(`require("${m}") tidak didukung di Ringan API.`); };

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = async (code, label) => {
    if (!code || !String(code).trim()) return;
    try {
      await new AsyncFunction('bru', 'req', 'res', 'test', 'expect', 'pm', 'console', 'require', code)(bru, req, res, test, expect, pm, con, requireStub);
    } catch (err) {
      throw new Error(`${label}: ${(err && err.message) || err}`);
    }
  };

  const lhs = (key) => {
    key = String(key).trim();
    const h = /^res\.headers\.(.+)$/.exec(key);
    if (h && RS) return res.getHeader(h[1].replace(/^\[["']|["']\]$/g, ''));
    if (/^res(\.|\[|$)/.test(key) && /^[\w$.[\]"' -]+$/.test(key)) {
      return getPath({ status: RS.status, statusText: RS.statusText, headers: RS.headers, body: RS.body, responseTime: RS.responseTime, size: RS.size, url: RS.url }, key.replace(/^res\.?/, ''));
    }
    return new Function('res', 'bru', 'req', `return (${key});`)(res, bru, req);
  };
  const evalAssert = (a) => {
    const entry = { name: `${a.key}: ${a.value}`, passed: false, kind: 'assert' };
    try {
      const actual = lhs(a.key);
      const m = /^\s*(\w+)\s*([\s\S]*)$/.exec(a.value || '');
      let op = m ? m[1] : 'eq';
      let raw = m ? m[2] : '';
      if (!OPS.has(op)) { op = 'eq'; raw = a.value; }
      const rhs = parseRhs(raw);
      const e = expect(actual, a.key);
      const s = actual == null ? '' : String(actual);
      switch (op) {
        case 'eq': e._assert(looseEq(actual, rhs), `expected ${show(actual)} to equal ${show(rhs)}`); break;
        case 'neq': e._assert(!looseEq(actual, rhs), `expected ${show(actual)} to not equal ${show(rhs)}`); break;
        case 'gt': e._assert(Number(actual) > Number(rhs), `expected ${show(actual)} > ${show(rhs)}`); break;
        case 'gte': e._assert(Number(actual) >= Number(rhs), `expected ${show(actual)} >= ${show(rhs)}`); break;
        case 'lt': e._assert(Number(actual) < Number(rhs), `expected ${show(actual)} < ${show(rhs)}`); break;
        case 'lte': e._assert(Number(actual) <= Number(rhs), `expected ${show(actual)} <= ${show(rhs)}`); break;
        case 'in': e._assert(listRhs(raw).some((x) => looseEq(actual, x)), `expected ${show(actual)} to be in ${raw}`); break;
        case 'notIn': e._assert(!listRhs(raw).some((x) => looseEq(actual, x)), `expected ${show(actual)} to not be in ${raw}`); break;
        case 'contains': e._assert(Array.isArray(actual) ? actual.some((x) => looseEq(x, rhs)) : s.includes(String(rhs)), `expected ${show(actual)} to contain ${show(rhs)}`); break;
        case 'notContains': e._assert(!(Array.isArray(actual) ? actual.some((x) => looseEq(x, rhs)) : s.includes(String(rhs))), `expected ${show(actual)} to not contain ${show(rhs)}`); break;
        case 'length': e._assert(actual != null && actual.length === Number(rhs), `expected length ${actual == null ? actual : actual.length} to equal ${rhs}`); break;
        case 'matches': e._assert(new RegExp(raw.trim()).test(s), `expected ${show(actual)} to match ${raw}`); break;
        case 'notMatches': e._assert(!new RegExp(raw.trim()).test(s), `expected ${show(actual)} to not match ${raw}`); break;
        case 'startsWith': e._assert(s.startsWith(String(rhs)), `expected ${show(actual)} to start with ${show(rhs)}`); break;
        case 'endsWith': e._assert(s.endsWith(String(rhs)), `expected ${show(actual)} to end with ${show(rhs)}`); break;
        case 'between': { const [lo, hi] = listRhs(raw).map(Number); e._assert(Number(actual) >= lo && Number(actual) <= hi, `expected ${show(actual)} to be between ${lo} and ${hi}`); break; }
        case 'isEmpty': e._assert(isEmpty(actual), `expected ${show(actual)} to be empty`); break;
        case 'isNotEmpty': e._assert(!isEmpty(actual), `expected ${show(actual)} to not be empty`); break;
        case 'isNull': e._assert(actual === null, `expected ${show(actual)} to be null`); break;
        case 'isUndefined': e._assert(actual === undefined, `expected ${show(actual)} to be undefined`); break;
        case 'isDefined': e._assert(actual !== undefined, `expected value to be defined`); break;
        case 'isTruthy': e._assert(!!actual, `expected ${show(actual)} to be truthy`); break;
        case 'isFalsy': e._assert(!actual, `expected ${show(actual)} to be falsy`); break;
        case 'isJson': e._assert(actual !== null && typeof actual === 'object', `expected ${show(actual)} to be JSON object/array`); break;
        case 'isNumber': e._assert(typeof actual === 'number', `expected ${show(actual)} to be a number`); break;
        case 'isString': e._assert(typeof actual === 'string', `expected ${show(actual)} to be a string`); break;
        case 'isBoolean': e._assert(typeof actual === 'boolean', `expected ${show(actual)} to be a boolean`); break;
        case 'isArray': e._assert(Array.isArray(actual), `expected ${show(actual)} to be an array`); break;
      }
      entry.passed = true;
    } catch (err) {
      entry.error = (err && err.message) || String(err);
    }
    return entry;
  };

  try {
    for (const s of job.scripts || []) await run(s.code, s.label);
    for (const a of job.asserts || []) out.tests.push(evalAssert(a));
    if (job.schema && RS) out.tests.push(evalSchema(job.schema, RS));
    for (const s of job.tests || []) await run(s.code, s.label);
    await Promise.all(pending);
  } catch (err) {
    out.error = err.message;
    await Promise.allSettled(pending);
  }
  out.req = R;
  out.vars = { envSet, envUnset, colSet, runtime: V.runtime };
  let payload;
  try { payload = JSON.parse(JSON.stringify(out)); } catch (err) {
    payload = { id: job.id, logs: out.logs, tests: out.tests, error: 'Hasil script tidak bisa diserialisasi: ' + err.message };
  }
  self.postMessage(payload);
};
