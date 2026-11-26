'use strict';
/*
 * Export a Ringan collection to other formats:
 *   - Postman Collection v2.1 (JSON)
 *   - OpenAPI 3.0 (JSON or YAML)
 *   - Bruno JSON (see importers.toBrunoJson)
 * Every exporter returns { doc, warnings } so the UI/CLI can tell the user what could not be mapped.
 */
const crypto = require('crypto');
const yaml = require('./vendor/js-yaml');
const { toBrunoJson } = require('./importers');

const on = (x) => x && x.enabled !== false && x.key;
const kvObj = (list) => Object.fromEntries((list || []).filter(on).map((x) => [x.key, x.value]));

function walk(items, fn, folders = []) {
  for (const it of items || []) {
    if (it.type === 'folder') walk(it.items, fn, [...folders, it]);
    else fn(it, folders);
  }
}
function activeEnv(col) { return (col.environments || []).find((e) => e.id === col.activeEnvId) || null; }

// ================================================================ Postman v2.1
const PM_SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

/** Lets scripts written for Ringan/Bruno (bru.*, res.*, req.*, test, expect) run in Postman. */
const PM_SHIM_POST = [
  '// --- shim Ringan/Bruno -> Postman (dibuat otomatis saat export) ---',
  'const res = (() => { let body; try { body = pm.response.json(); } catch (e) { body = pm.response.text(); } const getHeader = (n) => pm.response.headers.get(n);',
  '  const r = (path) => String(path).split(/[.[\\]]/).filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), body);',
  '  return Object.assign(r, { status: pm.response.code, statusText: pm.response.status, body, responseTime: pm.response.responseTime, headers: pm.response.headers.toObject(),',
  '    getStatus: () => pm.response.code, getBody: () => body, getHeader, getHeaders: () => pm.response.headers.toObject(), getResponseTime: () => pm.response.responseTime }); })();',
].join('\n');
const PM_SHIM_COMMON = [
  'const bru = { getEnvVar: (k) => pm.environment.get(k), setEnvVar: (k, v) => pm.environment.set(k, v), deleteEnvVar: (k) => pm.environment.unset(k),',
  '  getVar: (k) => pm.variables.get(k), setVar: (k, v) => pm.variables.set(k, v), deleteVar: (k) => pm.variables.unset(k),',
  '  getCollectionVar: (k) => pm.collectionVariables.get(k), interpolate: (s) => pm.variables.replaceIn(s), setNextRequest: (n) => postman.setNextRequest(n),',
  '  sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };',
  'const test = pm.test; const expect = pm.expect;',
].join('\n');
const PM_SHIM_PRE = [
  '// --- shim Ringan/Bruno -> Postman (dibuat otomatis saat export) ---',
  'const req = { getUrl: () => pm.request.url.toString(), setUrl: (u) => pm.request.url.update(u), getMethod: () => pm.request.method, setMethod: (m) => { pm.request.method = m; },',
  '  getHeader: (n) => pm.request.headers.get(n), setHeader: (n, v) => pm.request.headers.upsert({ key: n, value: String(v) }), deleteHeader: (n) => pm.request.headers.remove(n),',
  '  getBody: () => { try { return JSON.parse(pm.request.body.raw); } catch (e) { return pm.request.body && pm.request.body.raw; } },',
  '  setBody: (b) => { pm.request.body.update(typeof b === \'string\' ? b : JSON.stringify(b)); } };',
].join('\n');

const usesBruApi = (code) => /\b(bru|res|req)\s*[.(]|\btest\s*\(|\bexpect\s*\(/.test(code) && !/^\s*(const|let|var)\s+(res|bru|req)\b/m.test(code);

/** Converts Ringan/Bruno declarative assertions ("res.status: eq 200") into a Postman test script. */
function assertsToPm(asserts) {
  const list = (asserts || []).filter(on);
  if (!list.length) return '';
  const js = (s) => JSON.stringify(String(s));
  const lhs = (k) => {
    const h = /^res\.headers\.(.+)$/.exec(k.trim());
    if (h) return `pm.response.headers.get(${js(h[1])})`;
    if (k.trim() === 'res.status') return 'pm.response.code';
    if (k.trim() === 'res.responseTime') return 'pm.response.responseTime';
    if (/^res\.body/.test(k.trim())) return `__body${k.trim().slice(8)}`;
    return `(${k})`;
  };
  const rhs = (s) => {
    s = String(s || '').trim();
    if (/^-?\d+(\.\d+)?$/.test(s) || /^(true|false|null)$/.test(s)) return s;
    if (/^["'].*["']$/.test(s)) return js(s.slice(1, -1));
    if (/^[[{]/.test(s)) { try { JSON.parse(s); return s; } catch {} }
    return js(s);
  };
  const lines = ['// --- assertion dari Ringan (dibuat otomatis saat export) ---', 'let __body; try { __body = pm.response.json(); } catch (e) { __body = pm.response.text(); }'];
  for (const a of list) {
    const m = /^\s*(\w+)\s*([\s\S]*)$/.exec(a.value || '');
    const op = m ? m[1] : 'eq';
    const arg = m ? m[2] : '';
    const v = lhs(a.key);
    let body;
    switch (op) {
      case 'eq': body = `pm.expect(${v}).to.eql(${rhs(arg)});`; break;
      case 'neq': body = `pm.expect(${v}).to.not.eql(${rhs(arg)});`; break;
      case 'gt': body = `pm.expect(${v}).to.be.above(${Number(arg)});`; break;
      case 'gte': body = `pm.expect(${v}).to.be.at.least(${Number(arg)});`; break;
      case 'lt': body = `pm.expect(${v}).to.be.below(${Number(arg)});`; break;
      case 'lte': body = `pm.expect(${v}).to.be.at.most(${Number(arg)});`; break;
      case 'contains': body = `pm.expect(${v}).to.include(${rhs(arg)});`; break;
      case 'notContains': body = `pm.expect(${v}).to.not.include(${rhs(arg)});`; break;
      case 'length': body = `pm.expect(${v}).to.have.lengthOf(${Number(arg)});`; break;
      case 'matches': body = `pm.expect(String(${v})).to.match(new RegExp(${js(arg.trim())}));`; break;
      case 'notMatches': body = `pm.expect(String(${v})).to.not.match(new RegExp(${js(arg.trim())}));`; break;
      case 'startsWith': body = `pm.expect(String(${v}).startsWith(${rhs(arg)})).to.be.true;`; break;
      case 'endsWith': body = `pm.expect(String(${v}).endsWith(${rhs(arg)})).to.be.true;`; break;
      case 'in': body = `pm.expect([${arg.split(',').map((x) => rhs(x)).join(', ')}]).to.deep.include(${v});`; break;
      case 'notIn': body = `pm.expect([${arg.split(',').map((x) => rhs(x)).join(', ')}]).to.not.deep.include(${v});`; break;
      case 'between': { const [lo, hi] = arg.split(',').map(Number); body = `pm.expect(${v}).to.be.within(${lo}, ${hi});`; break; }
      case 'isEmpty': body = `pm.expect(${v}).to.be.empty;`; break;
      case 'isNotEmpty': body = `pm.expect(${v}).to.not.be.empty;`; break;
      case 'isNull': body = `pm.expect(${v}).to.be.null;`; break;
      case 'isUndefined': body = `pm.expect(${v}).to.be.undefined;`; break;
      case 'isDefined': body = `pm.expect(${v}).to.not.be.undefined;`; break;
      case 'isTruthy': body = `pm.expect(${v}).to.be.ok;`; break;
      case 'isFalsy': body = `pm.expect(${v}).to.not.be.ok;`; break;
      case 'isJson': body = `pm.expect(${v}).to.be.an('object');`; break;
      case 'isNumber': body = `pm.expect(${v}).to.be.a('number');`; break;
      case 'isString': body = `pm.expect(${v}).to.be.a('string');`; break;
      case 'isBoolean': body = `pm.expect(${v}).to.be.a('boolean');`; break;
      case 'isArray': body = `pm.expect(${v}).to.be.an('array');`; break;
      default: body = `pm.expect(${v}).to.eql(${rhs(a.value)});`;
    }
    lines.push(`pm.test(${js(`${a.key}: ${a.value}`)}, () => { ${body} });`);
  }
  return lines.join('\n');
}

function pmAuthOut(a) {
  if (!a) return undefined;
  if (a.type === 'inherit') return undefined;
  if (a.type === 'none') return { type: 'noauth' };
  if (a.type === 'bearer') return { type: 'bearer', bearer: [{ key: 'token', value: a.token || '', type: 'string' }] };
  if (a.type === 'basic') return { type: 'basic', basic: [{ key: 'username', value: a.username || '', type: 'string' }, { key: 'password', value: a.password || '', type: 'string' }] };
  if (a.type === 'apikey') return { type: 'apikey', apikey: [{ key: 'key', value: a.key || '', type: 'string' }, { key: 'value', value: a.value || '', type: 'string' }, { key: 'in', value: a.in === 'query' ? 'query' : 'header', type: 'string' }] };
  return undefined;
}

function pmEvents(pre, post, warnings, where) {
  const ev = [];
  const exec = (code) => code.replace(/\r\n?/g, '\n').split('\n');
  if (pre && pre.trim()) {
    const code = usesBruApi(pre) ? `${PM_SHIM_PRE}\n${PM_SHIM_COMMON}\n// --- script asli ---\n${pre}` : pre;
    ev.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: exec(code) } });
  }
  if (post && post.trim()) {
    const code = usesBruApi(post) ? `${PM_SHIM_POST}\n${PM_SHIM_COMMON}\n// --- script asli ---\n${post}` : post;
    ev.push({ listen: 'test', script: { type: 'text/javascript', exec: exec(code) } });
  }
  if (/require\(|bru\.runner|bru\.getProcessEnv/.test(`${pre}\n${post}`)) warnings.push(`${where}: script memakai API yang tidak ada padanannya di Postman, periksa manual.`);
  return ev.length ? ev : undefined;
}

function pmUrlOut(r) {
  const raw = r.url || '';
  const [base, q] = raw.split('?');
  const u = { raw };
  const m = /^(\{\{[^}]+\}\}|[a-z][a-z0-9+.-]*:\/\/[^/]+)(.*)$/i.exec(base);
  if (m) {
    const proto = /^([a-z][a-z0-9+.-]*):\/\//i.exec(m[1]);
    if (proto) { u.protocol = proto[1]; u.host = m[1].slice(proto[0].length).split('.'); } else u.host = [m[1]];
    u.path = m[2].split('/').filter(Boolean);
  }
  const query = [];
  if (q) for (const p of q.split('&').filter(Boolean)) { const i = p.indexOf('='); query.push({ key: i < 0 ? p : p.slice(0, i), value: i < 0 ? null : p.slice(i + 1) }); }
  for (const p of r.params || []) if (p.enabled === false && p.key) query.push({ key: p.key, value: p.value, disabled: true });
  if (query.length) u.query = query;
  if ((r.pathParams || []).length) u.variable = r.pathParams.filter((p) => p.key).map((p) => ({ key: p.key, value: p.value }));
  return u;
}

function pmBodyOut(b) {
  if (!b || b.mode === 'none') return undefined;
  if (b.mode === 'json') return { mode: 'raw', raw: b.content || '', options: { raw: { language: 'json' } } };
  if (b.mode === 'xml') return { mode: 'raw', raw: b.content || '', options: { raw: { language: 'xml' } } };
  if (b.mode === 'text') return { mode: 'raw', raw: b.content || '', options: { raw: { language: 'text' } } };
  if (b.mode === 'form') return { mode: 'urlencoded', urlencoded: (b.form || []).filter((f) => f.key).map((f) => ({ key: f.key, value: f.value, type: 'text', disabled: f.enabled === false || undefined })) };
  if (b.mode === 'multipart') {
    return { mode: 'formdata', formdata: (b.form || []).filter((f) => f.key).map((f) => (f.type === 'file' ? { key: f.key, type: 'file', src: f.fileName || '', disabled: f.enabled === false || undefined } : { key: f.key, value: f.value, type: 'text', disabled: f.enabled === false || undefined })) };
  }
  return undefined;
}

function toPostman(col, { includeEnv = true } = {}) {
  const warnings = [];
  const vars = (col.vars || []).filter((v) => v.key).map((v) => ({ key: v.key, value: v.value, disabled: v.enabled === false || undefined }));
  const env = activeEnv(col);
  if (includeEnv && env) {
    for (const v of env.vars.filter((x) => x.key)) {
      const value = v.secret ? '' : v.value;
      const ex = vars.find((x) => x.key === v.key);
      if (ex) ex.value = value; else vars.push({ key: v.key, value, disabled: v.enabled === false || undefined });
    }
    if (env.vars.some((v) => v.secret)) warnings.push(`Nilai secret dari environment "${env.name}" dikosongkan.`);
  }
  if ((col.environments || []).length > (includeEnv && env ? 1 : 0)) warnings.push('Postman Collection tidak menyimpan environment; hanya environment aktif yang disertakan sebagai collection variables.');
  const item = (it) => {
    if (it.type === 'folder') {
      const f = { name: it.name, item: (it.items || []).map(item) };
      const a = pmAuthOut(it.auth);
      if (a) f.auth = a;
      if ((it.headers || []).some(on)) warnings.push(`Folder "${it.name}": header tingkat folder tidak didukung Postman, tidak ikut di-export.`);
      return f;
    }
    const headers = (it.headers || []).filter((h) => h.key).map((h) => ({ key: h.key, value: h.value, disabled: h.enabled === false || undefined }));
    if (it.body && it.body.mode === 'json' && !headers.some((h) => /^content-type$/i.test(h.key))) headers.push({ key: 'Content-Type', value: 'application/json' });
    const tests = [it.postScript, assertsToPm(it.asserts), it.tests].filter((s) => s && s.trim()).join('\n\n');
    const out = {
      name: it.name,
      event: pmEvents(it.preScript, tests, warnings, `Request "${it.name}"`),
      request: {
        method: it.method,
        header: headers,
        url: pmUrlOut(it),
        body: pmBodyOut(it.body),
        auth: pmAuthOut(it.auth),
        description: it.docs || undefined,
      },
      response: [],
    };
    if (it.body && it.body.mode === 'multipart' && it.body.form.some((f) => f.type === 'file')) warnings.push(`Request "${it.name}": file multipart tidak ikut, pilih ulang file di Postman.`);
    return out;
  };
  const colHeaders = (col.headers || []).filter(on);
  const preCol = [colHeaders.length ? `// header koleksi dari Ringan\n${colHeaders.map((h) => `pm.request.headers.upsert({ key: ${JSON.stringify(h.key)}, value: pm.variables.replaceIn(${JSON.stringify(h.value)}) });`).join('\n')}` : '', col.preScript].filter(Boolean).join('\n\n');
  const doc = {
    info: { _postman_id: crypto.randomUUID(), name: col.name, description: col.docs || undefined, schema: PM_SCHEMA },
    item: (col.items || []).map(item),
    event: pmEvents(preCol, [col.postScript, col.tests].filter((s) => s && s.trim()).join('\n\n'), warnings, 'Koleksi'),
    variable: vars,
    auth: pmAuthOut(col.auth && col.auth.type !== 'none' ? col.auth : null),
  };
  return { doc: JSON.parse(JSON.stringify(doc)), warnings };
}

// ================================================================ OpenAPI 3
function inferSchema(v, depth = 0) {
  if (depth > 8) return {};
  if (v === null) return { nullable: true };
  if (Array.isArray(v)) return { type: 'array', items: v.length ? inferSchema(v[0], depth + 1) : {} };
  if (typeof v === 'object') {
    const properties = {};
    for (const [k, x] of Object.entries(v)) properties[k] = inferSchema(x, depth + 1);
    return { type: 'object', properties };
  }
  if (typeof v === 'number') return { type: Number.isInteger(v) ? 'integer' : 'number' };
  if (typeof v === 'boolean') return { type: 'boolean' };
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return { type: 'string', format: 'date-time' };
  return { type: 'string' };
}

/** Parses JSON that may contain {{variables}}; returns undefined when it is not JSON. */
function parseLooseJson(text) {
  if (!text || !text.trim()) return undefined;
  try { return JSON.parse(text); } catch {}
  try { return JSON.parse(text.replace(/"\{\{([^{}]+)\}\}"/g, '"{{$1}}"').replace(/(?<!")\{\{([^{}]+)\}\}(?!")/g, '"{{$1}}"')); } catch {}
  return undefined;
}

const exampleKey = (name, taken) => {
  let k = String(name).replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'example';
  for (let i = 2; taken && taken[k]; i++) k = `${k}_${i}`;
  return k;
};

/** OpenAPI allows one operation per path+method: fold another request into it as named examples. */
function mergeOperation(target, op, name) {
  // parameters: union by (in, name)
  for (const prm of op.parameters || []) {
    target.parameters = target.parameters || [];
    if (!target.parameters.some((x) => x.in === prm.in && x.name === prm.name)) target.parameters.push(prm.in === 'path' ? prm : { ...prm, required: false });
  }
  // request body: keep every variant as a named example
  if (op.requestBody) {
    target.requestBody = target.requestBody || { required: false, content: {} };
    for (const [ct, media] of Object.entries(op.requestBody.content)) {
      const t = target.requestBody.content[ct];
      if (!t) { target.requestBody.content[ct] = media.example !== undefined ? { schema: media.schema, examples: { [exampleKey(name)]: { summary: name, value: media.example } } } : media; continue; }
      if (t.example !== undefined) { t.examples = { [exampleKey(target.summary)]: { summary: target.summary, value: t.example } }; delete t.example; }
      if (media.example !== undefined) { t.examples = t.examples || {}; t.examples[exampleKey(name, t.examples)] = { summary: name, value: media.example }; }
    }
  }
  // responses: add status codes not documented yet
  for (const [code, resp] of Object.entries(op.responses || {})) {
    if (!target.responses[code] || (target.responses[code].description === 'OK' && !target.responses[code].content)) target.responses[code] = resp;
  }
  const variants = (target['x-ringan-requests'] = target['x-ringan-requests'] || [target.summary]);
  variants.push(name);
  target.description = [target.description && !target.description.startsWith('Variasi request') ? target.description : null, `Variasi request di koleksi: ${variants.join(', ')}`].filter(Boolean).join('\n\n');
}

const camel = (s) => String(s).normalize('NFKD').replace(/[^\w\s-]/g, ' ').trim().split(/[\s_-]+/).filter(Boolean)
  .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w[0].toLowerCase() + w.slice(1))).join('') || 'operation';

function toOpenApi(col, { samples = {} } = {}) {
  const warnings = [];
  const env = activeEnv(col);
  const vars = Object.assign({}, kvObj(col.vars), env ? kvObj(env.vars) : {});
  const resolve = (s, depth = 0) => String(s || '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, n) => (n in vars && depth < 5 ? resolve(vars[n], depth + 1) : m));

  // Servers: values of {{baseUrl}}-like prefixes, or the origin of absolute URLs.
  const servers = [];
  const addServer = (url, description) => { if (url && !servers.some((s) => s.url === url)) servers.push(description ? { url, description } : { url }); };
  const splitUrl = (raw) => {
    const base = String(raw || '').split('?')[0].split('#')[0];
    const pv = /^\{\{\s*([^{}]+?)\s*\}\}(.*)$/.exec(base);
    if (pv) {
      const value = resolve(`{{${pv[1]}}}`);
      const server = /\{\{/.test(value) ? `{${pv[1]}}` : value.replace(/\/$/, '');
      return { server, serverVar: /\{\{/.test(value) ? pv[1] : null, path: pv[2] || '/' };
    }
    const abs = /^([a-z][a-z0-9+.-]*:\/\/[^/]+)(.*)$/i.exec(base);
    if (abs) return { server: abs[1], path: abs[2] || '/' };
    return { server: null, path: base.startsWith('/') ? base : '/' + base };
  };

  const doc = {
    openapi: '3.0.3',
    info: { title: col.name, version: '1.0.0', description: col.docs || undefined },
    servers: [],
    tags: [],
    paths: {},
    components: { schemas: {}, securitySchemes: {} },
  };
  const theirSchemas = (col.openapi && col.openapi.components && col.openapi.components.schemas) || {};
  Object.assign(doc.components.schemas, theirSchemas);
  for (const [k, v] of Object.entries((col.openapi && col.openapi.definitions) || {})) doc.components.schemas[k] = v;
  const fixRefs = (s) => JSON.parse(JSON.stringify(s).replace(/"#\/definitions\//g, '"#/components/schemas/'));

  const schemeFor = (a) => {
    if (!a || a.type === 'none' || a.type === 'inherit') return null;
    if (a.type === 'bearer') { doc.components.securitySchemes.bearerAuth = { type: 'http', scheme: 'bearer' }; return 'bearerAuth'; }
    if (a.type === 'basic') { doc.components.securitySchemes.basicAuth = { type: 'http', scheme: 'basic' }; return 'basicAuth'; }
    if (a.type === 'apikey') {
      const name = `apiKey_${(a.key || 'key').replace(/[^\w-]/g, '_')}`;
      doc.components.securitySchemes[name] = { type: 'apiKey', in: a.in === 'query' ? 'query' : 'header', name: a.key || 'X-API-Key' };
      return name;
    }
    return null;
  };
  const colScheme = schemeFor(col.auth);
  if (colScheme) doc.security = [{ [colScheme]: [] }];

  const opIds = new Set();
  const tagSet = new Set();
  let merged = 0;
  const mergedInto = new Map();
  walk(col.items, (r, folders) => {
    const { server, serverVar, path: rawPath } = splitUrl(r.url);
    if (server) addServer(server, serverVar ? `isi variabel ${serverVar}` : undefined);
    const pathParams = [];
    let p = rawPath.replace(/\/:([A-Za-z_][\w-]*)/g, (m, n) => { pathParams.push(n); return `/{${n}}`; });
    // Other {{variables}} inside the path become path parameters.
    p = p.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, n) => { pathParams.push(n); return `{${n}}`; });
    p = p.replace(/\/{2,}/g, '/') || '/';
    if (p.length > 1) p = p.replace(/\/$/, '');
    const method = r.method.toLowerCase();
    if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) return;
    doc.paths[p] = doc.paths[p] || {};
    const existing = doc.paths[p][method];
    let opId = camel(r.name);
    if (!existing) {
      for (let i = 2; opIds.has(opId); i++) opId = camel(r.name) + i;
      opIds.add(opId);
    }
    const tag = folders.map((f) => f.name).join(' / ');
    if (tag) tagSet.add(tag);

    const parameters = [];
    for (const n of [...new Set(pathParams)]) {
      const pp = (r.pathParams || []).find((x) => x.key === n);
      const ex = pp ? resolve(pp.value) : vars[n] !== undefined ? resolve(vars[n]) : undefined;
      parameters.push({ name: n, in: 'path', required: true, schema: { type: /^-?\d+$/.test(ex || '') ? 'integer' : 'string' }, ...(ex && !/\{\{/.test(ex) ? { example: /^-?\d+$/.test(ex) ? Number(ex) : ex } : {}) });
    }
    const q = String(r.url || '').split('?')[1];
    const seenQ = new Set();
    const addQ = (key, value, enabled) => {
      if (!key || seenQ.has(key)) return;
      seenQ.add(key);
      const ex = resolve(value);
      parameters.push({ name: key, in: 'query', required: false, schema: { type: /^-?\d+$/.test(ex) ? 'integer' : 'string' }, ...(ex && !/\{\{/.test(ex) ? { example: /^-?\d+$/.test(ex) ? Number(ex) : ex } : {}), ...(enabled ? {} : { description: '(nonaktif di koleksi)' }) });
    };
    if (q) for (const part of q.split('&').filter(Boolean)) { const i = part.indexOf('='); addQ(i < 0 ? part : part.slice(0, i), i < 0 ? '' : part.slice(i + 1), true); }
    for (const x of r.params || []) if (x.enabled === false) addQ(x.key, x.value, false);
    const skipH = /^(content-type|authorization|accept|content-length|user-agent|cookie)$/i;
    for (const hd of [...(col.headers || []), ...folders.flatMap((f) => f.headers || []), ...(r.headers || [])].filter(on)) {
      if (skipH.test(hd.key) || parameters.some((x) => x.in === 'header' && x.name.toLowerCase() === hd.key.toLowerCase())) continue;
      const ex = resolve(hd.value);
      parameters.push({ name: hd.key, in: 'header', required: false, schema: { type: 'string' }, ...(ex && !/\{\{/.test(ex) ? { example: ex } : {}) });
    }

    const op = { tags: tag ? [tag] : undefined, summary: r.name, description: r.docs || undefined, operationId: opId, parameters: parameters.length ? parameters : undefined };
    const b = r.body || { mode: 'none' };
    if (b.mode === 'json') {
      const ex = parseLooseJson(b.content);
      op.requestBody = { required: true, content: { 'application/json': ex !== undefined ? { schema: inferSchema(ex), example: ex } : { schema: { type: 'object' }, example: b.content } } };
    } else if (b.mode === 'form' || b.mode === 'multipart') {
      const ct = b.mode === 'form' ? 'application/x-www-form-urlencoded' : 'multipart/form-data';
      const properties = {};
      const example = {};
      for (const f of (b.form || []).filter((x) => x.key)) {
        properties[f.key] = f.type === 'file' ? { type: 'string', format: 'binary' } : { type: 'string' };
        if (f.type !== 'file') example[f.key] = resolve(f.value);
      }
      op.requestBody = { required: true, content: { [ct]: { schema: { type: 'object', properties }, ...(Object.keys(example).length ? { example } : {}) } } };
    } else if (b.mode === 'text' || b.mode === 'xml') {
      op.requestBody = { required: true, content: { [b.mode === 'xml' ? 'application/xml' : 'text/plain']: { schema: { type: 'string' }, example: b.content || '' } } };
    }

    // Responses: documented schemas first, then the last response seen in the app, else a generic 200.
    const responses = {};
    if (r.responseSchemas && Object.keys(r.responseSchemas).length) {
      for (const [code, schema] of Object.entries(r.responseSchemas)) {
        const isEmpty = schema && schema.description && Object.keys(schema).length === 1;
        responses[code] = isEmpty ? { description: schema.description } : { description: code === 'default' ? 'Respons lain' : `Status ${code}`, content: { 'application/json': { schema: fixRefs(schema) } } };
      }
    }
    const sample = samples[r.id];
    if (sample && sample.status && !responses[String(sample.status)]) {
      const code = String(sample.status);
      let parsed;
      try { parsed = sample.body != null ? JSON.parse(sample.body) : undefined; } catch {}
      responses[code] = parsed !== undefined
        ? { description: `Contoh dari response terakhir (status ${code})`, content: { 'application/json': { schema: inferSchema(parsed), example: parsed } } }
        : { description: `Contoh dari response terakhir (status ${code})` };
    }
    if (!Object.keys(responses).length) responses['200'] = { description: 'OK' };
    op.responses = responses;

    const scheme = r.auth && r.auth.type !== 'inherit' ? schemeFor(r.auth) : undefined;
    if (r.auth && r.auth.type === 'none' && colScheme) op.security = [];
    else if (scheme && scheme !== colScheme) op.security = [{ [scheme]: [] }];
    else if (r.auth && r.auth.type === 'inherit') {
      const fa = [...folders].reverse().find((f) => f.auth && f.auth.type !== 'inherit');
      if (fa) { const fs = schemeFor(fa.auth); if (fa.auth.type === 'none') op.security = []; else if (fs && fs !== colScheme) op.security = [{ [fs]: [] }]; }
    }
    if (existing) { mergeOperation(existing, op, r.name); merged++; mergedInto.set(`${r.method} ${p}`, (mergedInto.get(`${r.method} ${p}`) || 1) + 1); }
    else doc.paths[p][method] = op;
  });

  doc.servers = servers.length ? servers : [{ url: '/' }];
  // Server URLs with {var} need a variables block.
  for (const s of doc.servers) {
    const m = /^\{([^{}]+)\}$/.exec(s.url);
    if (m) { s.variables = { [m[1]]: { default: 'http://localhost' } }; warnings.push(`Variabel "${m[1]}" tidak punya nilai di environment aktif; server diisi placeholder.`); }
  }
  doc.tags = [...tagSet].map((name) => ({ name }));
  if (!doc.tags.length) delete doc.tags;
  if (!Object.keys(doc.components.securitySchemes).length) delete doc.components.securitySchemes;
  if (!Object.keys(doc.components.schemas).length) delete doc.components.schemas;
  if (!Object.keys(doc.components).length) delete doc.components;
  if ((col.environments || []).length > 1) warnings.push(`Nilai server/contoh diambil dari environment aktif${env ? ` ("${env.name}")` : ''}.`);
  if (merged) {
    const top = [...mergedInto.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} (${n} request)`).join(', ');
    warnings.unshift(`${merged} request memakai path+method yang sama dengan request lain; digabung ke satu operasi sebagai contoh (examples) body/response. Terbanyak: ${top}.`);
  }
  const scripts = [];
  walk(col.items, (r) => { if ((r.preScript || '').trim() || (r.postScript || '').trim() || (r.tests || '').trim() || (r.asserts || []).some(on)) scripts.push(r.name); });
  if (scripts.length) warnings.push(`Script, tests, dan assertion (${scripts.length} request) tidak ada padanannya di OpenAPI dan tidak ikut di-export.`);
  return { doc: JSON.parse(JSON.stringify(doc)), warnings };
}

// ================================================================ dispatcher
const FORMATS = {
  bruno: { ext: '.bruno.json', mime: 'application/json', label: 'Bruno JSON' },
  postman: { ext: '.postman_collection.json', mime: 'application/json', label: 'Postman Collection v2.1' },
  openapi: { ext: '.openapi.json', mime: 'application/json', label: 'OpenAPI 3 (JSON)' },
  'openapi-yaml': { ext: '.openapi.yaml', mime: 'application/yaml', label: 'OpenAPI 3 (YAML)' },
  html: { ext: '.docs.html', mime: 'text/html', label: 'Dokumentasi HTML' },
};

function exportCollection(col, format, options = {}) {
  const f = FORMATS[format];
  if (!f) throw new Error(`Format export tidak dikenal: ${format}. Pilihan: ${Object.keys(FORMATS).join(', ')}`);
  let out;
  const base = String(col.name || 'collection').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'collection';
  if (format === 'html') {
    const d = require('./docs-html').toHtmlDocs(col, options);
    return { content: d.html, filename: base + f.ext, mime: f.mime, warnings: d.warnings };
  }
  if (format === 'bruno') {
    out = { doc: toBrunoJson(col), warnings: [] };
    if ((col.environments || []).some((e) => (e.vars || []).some((v) => v.secret))) out.warnings.push('Nilai secret environment dikosongkan.');
  } else if (format === 'postman') out = toPostman(col, options);
  else out = toOpenApi(col, options);
  const content = format === 'openapi-yaml' ? yaml.dump(out.doc, { noRefs: true, lineWidth: 120 }) : JSON.stringify(out.doc, null, 2);
  return { content, filename: base + f.ext, mime: f.mime, warnings: out.warnings };
}

module.exports = { toPostman, toOpenApi, exportCollection, FORMATS, assertsToPm, inferSchema };
