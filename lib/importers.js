'use strict';
/*
 * Converters between Ringan's internal model and common collection formats:
 *   - Bruno: folder of .bru files (bruno.json root), Bruno JSON export (import + export)
 *   - Postman Collection v2.0 / v2.1 JSON
 *   - OpenAPI 3.x / Swagger 2.0 (JSON)
 *   - cURL command
 * Plus loading any of these from a link (GitHub repo/folder, Gist, raw URL).
 */
const crypto = require('crypto');
const yaml = require('./vendor/js-yaml');

const uid = () => crypto.randomUUID();
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'connect', 'trace'];

/** Stable hash of a request body, used to know whether you edited a spec-generated example. */
function bodyHash(body) {
  const b = body || { mode: 'none' };
  return crypto.createHash('sha1').update(JSON.stringify([b.mode || 'none', b.content || '', (b.form || []).map((f) => [f.key, f.value, f.type || 'text'])])).digest('hex').slice(0, 16);
}

function kv(key, value, enabled = true, extra) {
  const v = value == null ? '' : typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return Object.assign({ key: key == null ? '' : String(key), value: v, enabled: enabled !== false }, extra || {});
}

function newRequest(p = {}) {
  return {
    id: uid(), type: 'request', name: p.name || 'Untitled', method: String(p.method || 'GET').toUpperCase(), url: p.url || '',
    params: p.params || [], pathParams: p.pathParams || [], headers: p.headers || [],
    body: Object.assign({ mode: 'none', content: '', form: [] }, p.body || {}),
    auth: Object.assign({ type: 'inherit' }, p.auth || {}),
    vars: p.vars || [], preScript: p.preScript || '', postScript: p.postScript || '', tests: p.tests || '',
    asserts: p.asserts || [], docs: p.docs || '',
  };
}

function newFolder(p = {}) {
  return { id: uid(), type: 'folder', name: p.name || 'Folder', items: p.items || [], headers: p.headers || [], auth: Object.assign({ type: 'inherit' }, p.auth || {}) };
}

function newCollection(p = {}) {
  return {
    id: uid(), name: p.name || 'Collection', items: p.items || [], headers: p.headers || [],
    auth: Object.assign({ type: 'none' }, p.auth || {}), vars: p.vars || [],
    preScript: p.preScript || '', postScript: p.postScript || '', tests: p.tests || '', docs: p.docs || '',
    environments: p.environments || [], activeEnvId: p.activeEnvId || null, source: p.source || null,
  };
}

function paramsFromUrl(url) {
  const qi = String(url).indexOf('?');
  if (qi < 0) return [];
  return url.slice(qi + 1).split('#')[0].split('&').filter(Boolean).map((p) => {
    const i = p.indexOf('=');
    return kv(i < 0 ? p : p.slice(0, i), i < 0 ? '' : p.slice(i + 1));
  });
}

function pathParamsFromUrl(url) {
  const base = String(url).split('?')[0];
  return [...base.matchAll(/\/:([A-Za-z_][\w-]*)/g)].map((m) => kv(m[1], ''));
}

function sortTree(node) {
  const items = node.items || [];
  items.sort((a, b) => {
    if ((a.type === 'folder') !== (b.type === 'folder')) return a.type === 'folder' ? -1 : 1;
    return (a.seq || 0) - (b.seq || 0) || String(a.name).localeCompare(String(b.name));
  });
  for (const it of items) {
    if (it.type === 'folder') sortTree(it);
    delete it.seq;
  }
  return node;
}

function postVarsScript(list) {
  return list
    .filter((v) => v.enabled && v.key && v.value)
    .map((v) => `bru.setVar(${JSON.stringify(v.key)}, (() => { try { return ${v.value}; } catch (e) { return undefined; } })());`)
    .join('\n');
}

// ================================================================ Bruno .bru
function parseBlocks(text) {
  const lines = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = {};
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z][\w:.\-]*)\s*(\{|\[)\s*(\}|\])?\s*$/);
    if (!m) continue;
    const name = m[1];
    const close = m[2] === '{' ? '}' : ']';
    if (m[3]) { blocks[name] = []; continue; }
    const body = [];
    i++;
    while (i < lines.length && lines[i].trimEnd() !== close) { body.push(lines[i]); i++; }
    blocks[name] = body;
  }
  return blocks;
}

function bDict(body) {
  const out = [];
  if (!body) return out;
  for (let i = 0; i < body.length; i++) {
    const line = body[i].trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    let key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    let enabled = true;
    if (key.startsWith('~')) { enabled = false; key = key.slice(1); }
    if (key.length > 1 && key[0] === '"' && key.endsWith('"')) key = key.slice(1, -1);
    if (value === "'''") {
      const ml = [];
      i++;
      while (i < body.length && body[i].trim() !== "'''") { ml.push(body[i].replace(/^ {0,4}/, '')); i++; }
      value = ml.join('\n');
    }
    out.push(kv(key, value, enabled));
  }
  return out;
}

const bText = (body) => (body ? body.map((l) => (l.startsWith('  ') ? l.slice(2) : l.replace(/^\s+/, ''))).join('\n').replace(/\n+$/, '') : '');
const bList = (body) => (body || []).map((l) => l.trim().replace(/,$/, '')).filter(Boolean);
const toObj = (list) => Object.fromEntries(list.map((x) => [x.key, x.value]));

function bruAuth(b, mode, dflt) {
  const m = String(mode || dflt).toLowerCase();
  if (m === 'bearer') return { type: 'bearer', token: toObj(bDict(b['auth:bearer'])).token || '' };
  if (m === 'basic') { const o = toObj(bDict(b['auth:basic'])); return { type: 'basic', username: o.username || '', password: o.password || '' }; }
  if (m === 'apikey') { const o = toObj(bDict(b['auth:apikey'])); return { type: 'apikey', key: o.key || '', value: o.value || '', in: /query/i.test(o.placement || '') ? 'query' : 'header' }; }
  if (m === 'inherit') return { type: 'inherit' };
  return { type: 'none' };
}

function bruBody(b, mode) {
  const m = String(mode || 'none').toLowerCase().replace(/[-_]/g, '');
  const body = { mode: 'none', content: '', form: [] };
  if (m === 'json') { body.mode = 'json'; body.content = bText(b['body:json']); }
  else if (m === 'text') { body.mode = 'text'; body.content = bText(b['body:text']); }
  else if (m === 'xml') { body.mode = 'xml'; body.content = bText(b['body:xml']); }
  else if (m === 'formurlencoded') { body.mode = 'form'; body.form = bDict(b['body:form-urlencoded']); }
  else if (m === 'multipartform') {
    body.mode = 'multipart';
    body.form = bDict(b['body:multipart-form']).map((f) => {
      const fm = /^@file\((.*)\)$/.exec(f.value);
      return fm ? Object.assign(f, { type: 'file', value: '', fileName: fm[1].split('|')[0].split(/[\\/]/).pop() }) : Object.assign(f, { type: 'text' });
    });
  } else if (m === 'graphql') {
    let variables = {};
    try { variables = JSON.parse(bText(b['body:graphql:vars']) || '{}'); } catch {}
    body.mode = 'json';
    body.content = JSON.stringify({ query: bText(b['body:graphql']), variables }, null, 2);
  }
  return body;
}

function bruToRequest(text, fallbackName) {
  const b = parseBlocks(text);
  const meta = toObj(bDict(b.meta));
  const type = String(meta.type || 'http').toLowerCase();
  if (type !== 'http' && type !== 'graphql') return null;
  const mk = METHODS.find((m) => b[m]);
  if (!mk) return null;
  const mb = toObj(bDict(b[mk]));
  const r = newRequest({ name: meta.name || fallbackName, method: mk, url: mb.url || '' });
  r.seq = Number(meta.seq) || 0;
  r.params = bDict(b['params:query'] || b.query);
  r.pathParams = bDict(b['params:path']);
  if (!r.pathParams.length) r.pathParams = pathParamsFromUrl(r.url);
  r.headers = bDict(b.headers);
  r.body = bruBody(b, mb.body);
  r.auth = bruAuth(b, mb.auth, 'inherit');
  r.vars = bDict(b['vars:pre-request']);
  r.preScript = bText(b['script:pre-request']);
  r.postScript = [postVarsScript(bDict(b['vars:post-response'])), bText(b['script:post-response'])].filter(Boolean).join('\n');
  r.tests = bText(b.tests);
  r.asserts = bDict(b.assert);
  r.docs = bText(b.docs);
  return r;
}

function applyBruFolderMeta(target, b, isCol) {
  const meta = toObj(bDict(b.meta));
  if (meta.name && !isCol) target.name = meta.name;
  if (meta.seq) target.seq = Number(meta.seq) || 0;
  target.headers = bDict(b.headers);
  const am = toObj(bDict(b.auth)).mode;
  if (am) target.auth = bruAuth(b, am, isCol ? 'none' : 'inherit');
  if (isCol && target.auth.type === 'inherit') target.auth = { type: 'none' };
  if (isCol) {
    target.vars = bDict(b['vars:pre-request']);
    target.preScript = bText(b['script:pre-request']);
    target.postScript = [postVarsScript(bDict(b['vars:post-response'])), bText(b['script:post-response'])].filter(Boolean).join('\n');
    target.tests = bText(b.tests);
    target.docs = bText(b.docs);
  }
}

const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);
const inDir = (p, root) => root === '' || p.startsWith(root + '/');

function commonDir(paths) {
  const dirs = paths.map((p) => dirOf(p).split('/').filter(Boolean));
  if (!dirs.length) return '';
  const first = dirs[0];
  let n = first.length;
  for (const d of dirs) { let i = 0; while (i < n && i < d.length && d[i] === first[i]) i++; n = i; }
  return first.slice(0, n).join('/');
}

function buildBruCollection(root, files) {
  let cfg = {};
  const cfgFile = files.find((f) => f.rel === 'bruno.json');
  try { cfg = JSON.parse(cfgFile ? cfgFile.content : '{}'); } catch {}
  const col = newCollection({ name: cfg.name || baseOf(root) || 'Imported' });
  const cb = files.find((f) => f.rel === 'collection.bru');
  if (cb) applyBruFolderMeta(col, parseBlocks(cb.content), true);

  for (const f of files) {
    if (!/^environments\/[^/]+\.bru$/.test(f.rel)) continue;
    const b = parseBlocks(f.content);
    const vars = bDict(b.vars);
    for (const name of bList(b['vars:secret'])) {
      const key = name.replace(/^~/, '');
      if (!vars.some((v) => v.key === key)) vars.push(kv(key, '', !name.startsWith('~'), { secret: true }));
      else vars.find((v) => v.key === key).secret = true;
    }
    col.environments.push({ id: uid(), name: baseOf(f.rel).replace(/\.bru$/, ''), vars });
  }
  if (col.environments.length) col.activeEnvId = col.environments[0].id;

  const folders = new Map([['', col]]);
  const getFolder = (dir) => {
    if (folders.has(dir)) return folders.get(dir);
    const parent = getFolder(dirOf(dir));
    const fo = newFolder({ name: baseOf(dir) });
    fo.fsRel = dir;
    parent.items.push(fo);
    folders.set(dir, fo);
    return fo;
  };
  for (const f of files) {
    if (!f.rel.endsWith('.bru') || f.rel === 'collection.bru' || f.rel.startsWith('environments/')) continue;
    const dir = dirOf(f.rel);
    if (baseOf(f.rel) === 'folder.bru') {
      if (dir) applyBruFolderMeta(getFolder(dir), parseBlocks(f.content), false);
      continue;
    }
    const req = bruToRequest(f.content, baseOf(f.rel).replace(/\.bru$/, ''));
    if (req) { req.fsRel = f.rel; getFolder(dir).items.push(req); }
  }
  return sortTree(col);
}

function filesToCollections(files) {
  files = (files || [])
    .map((f) => ({ path: String(f.path || f.name || '').replace(/\\/g, '/').replace(/^\/+/, ''), content: String(f.content ?? '') }))
    .filter((f) => f.path && !/(^|\/)(node_modules|\.git)\//.test(f.path));

  // A single JSON file (Postman/OpenAPI/Bruno export) picked as a "file".
  const bruFiles = files.filter((f) => f.path.endsWith('.bru'));
  if (!bruFiles.length) {
    const out = [];
    for (const f of files.filter((x) => /\.(json|ya?ml)$/i.test(x.path) && !/(^|\/)bruno\.json$/.test(x.path))) out.push(...parseText(f.content));
    if (!out.length) throw new Error('Tidak ditemukan file .bru atau collection JSON.');
    return out;
  }

  const roots = files.filter((f) => /(^|\/)bruno\.json$/.test(f.path)).map((f) => dirOf(f.path));
  if (!roots.length) roots.push(commonDir(bruFiles.map((f) => f.path)));
  const longest = (p) => roots.filter((r) => inDir(p, r)).sort((a, b) => b.length - a.length)[0];
  return roots.map((root) => {
    const own = files
      .filter((f) => inDir(f.path, root) && longest(f.path) === root)
      .map((f) => ({ ...f, rel: root ? f.path.slice(root.length + 1) : f.path }));
    return buildBruCollection(root, own);
  });
}

// ================================================================ Bruno JSON export
const bjKv = (arr) => (arr || []).map((x) => kv(x.name, x.value, x.enabled));

function bjAuth(a, dflt) {
  if (!a || !a.mode) return { type: dflt };
  switch (a.mode) {
    case 'bearer': return { type: 'bearer', token: (a.bearer && a.bearer.token) || '' };
    case 'basic': return { type: 'basic', username: (a.basic && a.basic.username) || '', password: (a.basic && a.basic.password) || '' };
    case 'apikey': return { type: 'apikey', key: (a.apikey && a.apikey.key) || '', value: (a.apikey && a.apikey.value) || '', in: a.apikey && a.apikey.placement === 'queryparams' ? 'query' : 'header' };
    case 'inherit': return { type: dflt === 'none' ? 'none' : 'inherit' };
    default: return { type: 'none' };
  }
}

function bjItem(it) {
  if (it.type === 'folder') {
    const f = newFolder({ name: it.name, items: (it.items || []).map(bjItem).filter(Boolean) });
    f.seq = it.seq || (it.root && it.root.meta && it.root.meta.seq) || 0;
    const fr = it.root && it.root.request;
    if (fr) { f.headers = bjKv(fr.headers); f.auth = bjAuth(fr.auth, 'inherit'); }
    return f;
  }
  if (!/http-request|graphql-request/.test(it.type || '')) return null;
  const q = it.request || {};
  const r = newRequest({ name: it.name, method: q.method, url: q.url });
  r.seq = it.seq || 0;
  r.params = bjKv((q.params || []).filter((p) => p.type !== 'path'));
  r.pathParams = bjKv((q.params || []).filter((p) => p.type === 'path'));
  if (!r.pathParams.length) r.pathParams = pathParamsFromUrl(r.url);
  r.headers = bjKv(q.headers);
  const b = q.body || {};
  switch (b.mode) {
    case 'json': r.body = { mode: 'json', content: b.json || '', form: [] }; break;
    case 'text': r.body = { mode: 'text', content: b.text || '', form: [] }; break;
    case 'xml': r.body = { mode: 'xml', content: b.xml || '', form: [] }; break;
    case 'formUrlEncoded': r.body = { mode: 'form', content: '', form: bjKv(b.formUrlEncoded) }; break;
    case 'multipartForm': r.body = { mode: 'multipart', content: '', form: (b.multipartForm || []).map((x) => x.type === 'file' ? kv(x.name, '', x.enabled, { type: 'file', fileName: [].concat(x.value || [])[0] ? String([].concat(x.value)[0]).split(/[\\/]/).pop() : '' }) : kv(x.name, x.value, x.enabled, { type: 'text' })) }; break;
    case 'graphql': r.body = { mode: 'json', content: JSON.stringify({ query: (b.graphql && b.graphql.query) || '', variables: (() => { try { return JSON.parse((b.graphql && b.graphql.variables) || '{}'); } catch { return {}; } })() }, null, 2), form: [] }; break;
    default: break;
  }
  r.auth = bjAuth(q.auth, 'inherit');
  r.vars = bjKv(q.vars && q.vars.req);
  r.preScript = (q.script && q.script.req) || '';
  r.postScript = [postVarsScript(bjKv(q.vars && q.vars.res)), (q.script && q.script.res) || ''].filter(Boolean).join('\n');
  r.tests = q.tests || '';
  r.asserts = (q.assertions || []).map((a) => kv(a.name, a.value, a.enabled));
  r.docs = q.docs || '';
  return r;
}

function fromBrunoJson(j) {
  const col = newCollection({ name: j.name || 'Bruno Collection' });
  const root = (j.root && j.root.request) || {};
  col.headers = bjKv(root.headers);
  col.auth = bjAuth(root.auth, 'none');
  col.vars = bjKv(root.vars && root.vars.req);
  col.preScript = (root.script && root.script.req) || '';
  col.postScript = (root.script && root.script.res) || '';
  col.tests = root.tests || '';
  col.environments = (j.environments || []).map((e) => ({ id: uid(), name: e.name || 'env', vars: (e.variables || []).map((v) => kv(v.name, v.value, v.enabled, v.secret ? { secret: true } : undefined)) }));
  if (col.environments.length) col.activeEnvId = col.environments[0].id;
  col.items = (j.items || []).map(bjItem).filter(Boolean);
  return sortTree(col);
}

function brunoUid() {
  const a = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from(crypto.randomBytes(21), (b) => a[b % a.length]).join('');
}

function toBrunoJson(col) {
  const kvOut = (list, extra) => (list || []).filter((x) => x.key).map((x) => Object.assign({ uid: brunoUid(), name: x.key, value: x.value, enabled: x.enabled !== false }, extra || {}));
  const authOut = (a) => {
    a = a || { type: 'none' };
    const o = { mode: a.type };
    if (a.type === 'bearer') o.bearer = { token: a.token || '' };
    if (a.type === 'basic') o.basic = { username: a.username || '', password: a.password || '' };
    if (a.type === 'apikey') o.apikey = { key: a.key || '', value: a.value || '', placement: a.in === 'query' ? 'queryparams' : 'header' };
    return o;
  };
  const MODE = { none: 'none', json: 'json', text: 'text', xml: 'xml', form: 'formUrlEncoded', multipart: 'multipartForm' };
  const bodyOut = (b) => ({
    mode: MODE[b.mode] || 'none',
    json: b.mode === 'json' ? b.content : null,
    text: b.mode === 'text' ? b.content : null,
    xml: b.mode === 'xml' ? b.content : null,
    formUrlEncoded: b.mode === 'form' ? kvOut(b.form) : [],
    multipartForm: b.mode === 'multipart' ? (b.form || []).filter((x) => x.key).map((x) => ({ uid: brunoUid(), type: x.type === 'file' ? 'file' : 'text', name: x.key, value: x.type === 'file' ? [] : x.value, enabled: x.enabled !== false })) : [],
  });
  const item = (it, i) => it.type === 'folder'
    ? { uid: brunoUid(), name: it.name, type: 'folder', seq: i + 1, root: { request: { headers: kvOut(it.headers), auth: authOut(it.auth) } }, items: it.items.map(item) }
    : {
      uid: brunoUid(), name: it.name, type: 'http-request', seq: i + 1,
      request: {
        url: it.url, method: it.method,
        headers: kvOut(it.headers),
        params: [...kvOut(it.params, { type: 'query' }), ...kvOut(it.pathParams, { type: 'path' })],
        body: bodyOut(it.body || { mode: 'none' }),
        auth: authOut(it.auth),
        script: { req: it.preScript || '', res: it.postScript || '' },
        vars: { req: kvOut(it.vars), res: [] },
        assertions: kvOut(it.asserts),
        tests: it.tests || '',
        docs: it.docs || '',
      },
    };
  return {
    name: col.name,
    version: '1',
    items: (col.items || []).map(item),
    environments: (col.environments || []).map((e) => ({
      uid: brunoUid(), name: e.name,
      // Secret values are never exported.
      variables: (e.vars || []).filter((v) => v.key).map((v) => ({ uid: brunoUid(), name: v.key, value: v.secret ? '' : v.value, enabled: v.enabled !== false, secret: !!v.secret, type: 'text' })),
    })),
    root: { request: { headers: kvOut(col.headers), auth: authOut(col.auth), vars: { req: kvOut(col.vars) }, script: { req: col.preScript || '', res: col.postScript || '' }, tests: col.tests || '' } },
    brunoConfig: { version: '1', name: col.name, type: 'collection', ignore: ['node_modules', '.git'] },
  };
}

// ================================================================ Postman
function pmGet(list, key) {
  if (Array.isArray(list)) { const f = list.find((x) => x.key === key); return f ? f.value : ''; }
  return list && list[key] != null ? list[key] : '';
}

function pmAuth(a) {
  if (!a || !a.type) return null;
  if (a.type === 'noauth') return { type: 'none' };
  if (a.type === 'bearer') return { type: 'bearer', token: String(pmGet(a.bearer, 'token')) };
  if (a.type === 'basic') return { type: 'basic', username: String(pmGet(a.basic, 'username')), password: String(pmGet(a.basic, 'password')) };
  if (a.type === 'apikey') return { type: 'apikey', key: String(pmGet(a.apikey, 'key')), value: String(pmGet(a.apikey, 'value')), in: pmGet(a.apikey, 'in') === 'query' ? 'query' : 'header' };
  return { type: 'none' };
}

function pmScript(events, listen) {
  return (events || []).filter((e) => e.listen === listen && e.script).map((e) => [].concat(e.script.exec || []).join('\n')).join('\n').trim();
}

function pmUrl(u) {
  if (!u) return '';
  if (typeof u === 'string') return u;
  if (u.raw) return u.raw;
  const host = [].concat(u.host || []).join('.');
  const p = [].concat(u.path || []).join('/');
  const q = (u.query || []).filter((x) => !x.disabled).map((x) => `${x.key}=${x.value ?? ''}`).join('&');
  return `${u.protocol ? u.protocol + '://' : ''}${host}${p ? '/' + p : ''}${q ? '?' + q : ''}`;
}

function pmItem(it) {
  if (Array.isArray(it.item)) {
    const f = newFolder({ name: it.name, items: it.item.map(pmItem) });
    const a = pmAuth(it.auth);
    if (a) f.auth = a;
    return f;
  }
  const rq = typeof it.request === 'string' ? { url: it.request, method: 'GET' } : it.request || {};
  const url = pmUrl(rq.url);
  const r = newRequest({ name: it.name, method: rq.method || 'GET', url });
  r.params = paramsFromUrl(url);
  if (rq.url && Array.isArray(rq.url.query)) for (const q of rq.url.query) if (q.disabled) r.params.push(kv(q.key, q.value, false));
  r.pathParams = rq.url && Array.isArray(rq.url.variable) ? rq.url.variable.map((v) => kv(v.key, v.value)) : pathParamsFromUrl(url);
  r.headers = (rq.header || []).map((x) => kv(x.key, x.value, !x.disabled));
  const b = rq.body;
  if (b && b.mode === 'raw') {
    const lang = (b.options && b.options.raw && b.options.raw.language) || '';
    const raw = b.raw || '';
    const mode = lang === 'json' || (!lang && /^\s*[[{]/.test(raw)) ? 'json' : lang === 'xml' ? 'xml' : 'text';
    r.body = { mode, content: raw, form: [] };
  } else if (b && b.mode === 'urlencoded') {
    r.body = { mode: 'form', content: '', form: (b.urlencoded || []).map((x) => kv(x.key, x.value, !x.disabled)) };
  } else if (b && b.mode === 'formdata') {
    r.body = { mode: 'multipart', content: '', form: (b.formdata || []).map((x) => (x.type === 'file' ? kv(x.key, '', !x.disabled, { type: 'file', fileName: String([].concat(x.src || '')[0] || '').split(/[\\/]/).pop() }) : kv(x.key, x.value, !x.disabled, { type: 'text' }))) };
  } else if (b && b.mode === 'graphql' && b.graphql) {
    let variables = {};
    try { variables = typeof b.graphql.variables === 'string' ? JSON.parse(b.graphql.variables || '{}') : b.graphql.variables || {}; } catch {}
    r.body = { mode: 'json', content: JSON.stringify({ query: b.graphql.query || '', variables }, null, 2), form: [] };
  }
  const a = pmAuth(rq.auth);
  if (a) r.auth = a;
  r.preScript = pmScript(it.event, 'prerequest');
  r.tests = pmScript(it.event, 'test');
  r.docs = typeof rq.description === 'string' ? rq.description : (rq.description && rq.description.content) || '';
  return r;
}

function fromPostman(pc) {
  const col = newCollection({
    name: (pc.info && pc.info.name) || 'Postman Collection',
    vars: (pc.variable || []).map((v) => kv(v.key, v.value, !v.disabled)),
  });
  col.auth = pmAuth(pc.auth) || { type: 'none' };
  if (col.auth.type === 'inherit') col.auth = { type: 'none' };
  col.preScript = pmScript(pc.event, 'prerequest');
  col.tests = pmScript(pc.event, 'test');
  col.items = (pc.item || []).map(pmItem);
  return col;
}

// ================================================================ OpenAPI / Swagger (JSON)
function deref(spec, x, depth = 0) {
  while (x && typeof x === 'object' && typeof x.$ref === 'string' && x.$ref.startsWith('#/') && depth < 30) {
    x = x.$ref.slice(2).split('/').reduce((o, k) => (o ? o[k.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined), spec);
    depth++;
  }
  return x;
}

function sample(spec, schema, depth = 0) {
  schema = deref(spec, schema);
  if (!schema || depth > 6) return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map((s) => sample(spec, s, depth + 1)).filter((v) => v && typeof v === 'object'));
  if (schema.oneOf || schema.anyOf) return sample(spec, (schema.oneOf || schema.anyOf)[0], depth + 1);
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === 'object' || schema.properties) {
    const o = {};
    for (const [k, v] of Object.entries(schema.properties || {})) o[k] = sample(spec, v, depth + 1);
    return o;
  }
  if (type === 'array') return [sample(spec, schema.items, depth + 1)];
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return true;
  if (type === 'string') {
    if (schema.format === 'date-time') return new Date(0).toISOString();
    if (schema.format === 'date') return '2024-01-01';
    if (schema.format === 'email') return 'user@example.com';
    if (schema.format === 'uuid') return '00000000-0000-0000-0000-000000000000';
    return 'string';
  }
  return null;
}

function paramExample(spec, p) {
  const v = p.example ?? (p.schema && deref(spec, p.schema) && (deref(spec, p.schema).example ?? deref(spec, p.schema).default ?? (deref(spec, p.schema).enum || [])[0])) ?? p.default;
  return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/** { "200": schema, "4XX": schema, "default": schema } from an OpenAPI 3 / Swagger 2 operation. */
function responseSchemas(spec, op) {
  const out = {};
  for (const [code, raw] of Object.entries(op.responses || {})) {
    const resp = deref(spec, raw) || {};
    let schema = null;
    if (resp.content) {
      const type = Object.keys(resp.content).find((t) => /json/i.test(t));
      if (type) schema = resp.content[type].schema || null;
      else if (!Object.keys(resp.content).length) schema = null;
    } else if (resp.schema) schema = resp.schema;
    if (schema) out[String(code).toUpperCase()] = schema;
    else if (/^2/.test(code) && !resp.content && !resp.schema) out[String(code)] = { description: 'tanpa body' };
  }
  return out;
}

function fromOpenApi(spec) {
  let base = '';
  if (spec.swagger) base = `${(spec.schemes && spec.schemes[0]) || 'https'}://${spec.host || 'localhost'}${spec.basePath || ''}`;
  else if (spec.servers && spec.servers[0]) {
    const s = spec.servers[0];
    base = String(s.url || '').replace(/\{([^}]+)\}/g, (m, n) => (s.variables && s.variables[n] && s.variables[n].default) || m);
  }
  base = base.replace(/\/$/, '');
  const col = newCollection({ name: (spec.info && spec.info.title) || 'OpenAPI', vars: [kv('baseUrl', base)] });
  // Kept so response schemas with $ref can be resolved when validating responses.
  col.openapi = { components: { schemas: (spec.components && spec.components.schemas) || {} }, definitions: spec.definitions || {} };
  const schemes = (spec.components && spec.components.securitySchemes) || spec.securityDefinitions || {};
  const sch = Object.values(schemes).map((s) => deref(spec, s));
  if (sch.some((s) => s && ((s.type === 'http' && /bearer/i.test(s.scheme || '')) || s.type === 'oauth2' || s.type === 'openIdConnect'))) {
    col.auth = { type: 'bearer', token: '{{token}}' };
    col.vars.push(kv('token', ''));
  } else if (sch.some((s) => s && s.type === 'http' && /basic/i.test(s.scheme || '')) || sch.some((s) => s && s.type === 'basic')) {
    col.auth = { type: 'basic', username: '{{username}}', password: '{{password}}' };
    col.vars.push(kv('username', ''), kv('password', ''));
  } else {
    const ak = sch.find((s) => s && s.type === 'apiKey');
    if (ak) { col.auth = { type: 'apikey', key: ak.name || 'X-API-Key', value: '{{apiKey}}', in: ak.in === 'query' ? 'query' : 'header' }; col.vars.push(kv('apiKey', '')); }
  }
  const folders = new Map();
  const folderFor = (tag) => {
    if (!tag) return col;
    if (!folders.has(tag)) { const f = newFolder({ name: tag }); folders.set(tag, f); col.items.push(f); }
    return folders.get(tag);
  };
  for (const [p, opsRaw] of Object.entries(spec.paths || {})) {
    const ops = deref(spec, opsRaw) || {};
    const common = ops.parameters || [];
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
      const op = ops[method];
      if (!op) continue;
      const params = [...common, ...(op.parameters || [])].map((x) => deref(spec, x)).filter(Boolean);
      const query = params.filter((x) => x.in === 'query');
      const r = newRequest({ name: op.summary || op.operationId || `${method.toUpperCase()} ${p}`, method });
      r.params = query.map((q) => kv(q.name, paramExample(spec, q), !!q.required));
      const enabledQ = r.params.filter((q) => q.enabled).map((q) => `${q.key}=${q.value}`).join('&');
      r.url = '{{baseUrl}}' + p.replace(/\{([^}]+)\}/g, ':$1') + (enabledQ ? '?' + enabledQ : '');
      r.pathParams = params.filter((x) => x.in === 'path').map((x) => kv(x.name, paramExample(spec, x)));
      r.headers = params.filter((x) => x.in === 'header').map((x) => kv(x.name, paramExample(spec, x), !!x.required));
      const rb = deref(spec, op.requestBody);
      if (rb && rb.content) {
        const types = Object.keys(rb.content);
        const pick = types.find((t) => /json/i.test(t)) || types.find((t) => /x-www-form-urlencoded/i.test(t)) || types.find((t) => /multipart/i.test(t)) || types[0];
        const media = rb.content[pick] || {};
        const ex = media.example !== undefined ? media.example : media.examples ? (deref(spec, Object.values(media.examples)[0]) || {}).value : sample(spec, media.schema);
        if (/json/i.test(pick)) r.body = { mode: 'json', content: JSON.stringify(ex ?? {}, null, 2), form: [] };
        else if (/x-www-form-urlencoded/i.test(pick)) r.body = { mode: 'form', content: '', form: Object.entries(ex || {}).map(([k, v]) => kv(k, v)) };
        else if (/multipart/i.test(pick)) {
          const props = (deref(spec, media.schema) || {}).properties || {};
          r.body = { mode: 'multipart', content: '', form: Object.entries(props).map(([k, v]) => (deref(spec, v) || {}).format === 'binary' ? kv(k, '', true, { type: 'file' }) : kv(k, (ex || {})[k], true, { type: 'text' })) };
        } else r.body = { mode: /xml/i.test(pick) ? 'xml' : 'text', content: typeof ex === 'string' ? ex : '', form: [] };
      } else {
        const bp = params.find((x) => x.in === 'body');
        const fd = params.filter((x) => x.in === 'formData');
        if (bp) r.body = { mode: 'json', content: JSON.stringify(sample(spec, bp.schema) ?? {}, null, 2), form: [] };
        else if (fd.length) r.body = { mode: fd.some((x) => x.type === 'file') ? 'multipart' : 'form', content: '', form: fd.map((x) => kv(x.name, paramExample(spec, x), !!x.required, { type: x.type === 'file' ? 'file' : 'text' })) };
      }
      r.docs = [op.description, op.operationId && `operationId: ${op.operationId}`].filter(Boolean).join('\n\n');
      const schemas = responseSchemas(spec, op);
      if (Object.keys(schemas).length) { r.responseSchemas = schemas; r.schemaCheck = true; }
      // Bookkeeping for live sync: what came from the spec, so later spec changes can be merged safely.
      r.specKey = `${method.toUpperCase()} ${p}`;
      r.specName = r.name;
      r.specDocs = r.docs;
      r.specBodyHash = bodyHash(r.body);
      r.specParamKeys = r.params.map((x) => x.key);
      folderFor(op.tags && op.tags[0]).items.push(r);
    }
  }
  return col;
}

// ================================================================ cURL
function tokenizeShell(s) {
  if (/\^"/.test(s)) s = s.replace(/\^\r?\n/g, ' ').replace(/\^(.)/g, '$1'); // Windows cmd "Copy as cURL"
  s = s.replace(/\\\r?\n/g, ' ').replace(/`\r?\n/g, ' ');
  const out = [];
  let cur = '';
  let inTok = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '$' && s[i + 1] === "'") {
      inTok = true;
      i += 2;
      while (i < s.length && s[i] !== "'") {
        if (s[i] === '\\' && i + 1 < s.length) {
          const n = s[i + 1];
          cur += ({ n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"' })[n] ?? n;
          i += 2;
        } else cur += s[i++];
      }
      i++;
      continue;
    }
    if (c === "'") { inTok = true; const j = s.indexOf("'", i + 1); cur += s.slice(i + 1, j < 0 ? s.length : j); i = j < 0 ? s.length : j + 1; continue; }
    if (c === '"') {
      inTok = true;
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < s.length && '"\\$`'.includes(s[i + 1])) { cur += s[i + 1]; i += 2; } else cur += s[i++];
      }
      i++;
      continue;
    }
    if (/\s/.test(c)) { if (inTok) { out.push(cur); cur = ''; inTok = false; } i++; continue; }
    if (c === '\\' && i + 1 < s.length) { cur += s[i + 1]; inTok = true; i += 2; continue; }
    cur += c;
    inTok = true;
    i++;
  }
  if (inTok) out.push(cur);
  return out;
}

function fromCurl(text) {
  const t = tokenizeShell(text.trim());
  if (!t.length || !/^curl(\.exe)?$/i.test(t[0])) throw new Error('Bukan perintah cURL');
  let method = null;
  let url = '';
  let user = null;
  let getMode = false;
  const headers = [];
  const data = [];
  const form = [];
  const VALUE_FLAGS = new Set(['-o', '--output', '-m', '--max-time', '--connect-timeout', '-w', '--write-out', '-x', '--proxy', '--retry', '-c', '--cookie-jar', '--cert', '--key', '--cacert', '-E', '--resolve', '--limit-rate']);
  for (let i = 1; i < t.length; i++) {
    let a = t[i];
    let pending;
    const eq = /^(--[\w-]+)=([\s\S]*)$/.exec(a);
    if (eq) { a = eq[1]; pending = eq[2]; }
    const attached = /^(-[XHdbuAeF])([\s\S]+)$/.exec(a);
    if (attached) { a = attached[1]; pending = attached[2]; }
    const next = () => { if (pending !== undefined) { const p = pending; pending = undefined; return p; } return t[++i] ?? ''; };
    switch (a) {
      case '-X': case '--request': method = next().toUpperCase(); break;
      case '-H': case '--header': {
        const hd = next();
        const ix = hd.indexOf(':');
        if (ix > 0) headers.push(kv(hd.slice(0, ix).trim(), hd.slice(ix + 1).trim()));
        break;
      }
      case '-d': case '--data': case '--data-raw': case '--data-binary': case '--data-ascii': data.push(next()); break;
      case '--json': data.push(next()); if (!headers.some((x) => /^content-type$/i.test(x.key))) headers.push(kv('Content-Type', 'application/json')); break;
      case '--data-urlencode': {
        const d = next();
        const ix = d.indexOf('=');
        data.push(ix >= 0 ? d.slice(0, ix + 1) + encodeURIComponent(d.slice(ix + 1)) : encodeURIComponent(d));
        break;
      }
      case '-F': case '--form': case '--form-string': {
        const f = next();
        const ix = f.indexOf('=');
        const k = ix < 0 ? f : f.slice(0, ix);
        const v = ix < 0 ? '' : f.slice(ix + 1);
        if (v.startsWith('@') && a !== '--form-string') form.push(kv(k, '', true, { type: 'file', fileName: v.slice(1).split(';')[0].split(/[\\/]/).pop() }));
        else form.push(kv(k, v, true, { type: 'text' }));
        break;
      }
      case '-u': case '--user': user = next(); break;
      case '-A': case '--user-agent': headers.push(kv('User-Agent', next())); break;
      case '-b': case '--cookie': headers.push(kv('Cookie', next())); break;
      case '-e': case '--referer': headers.push(kv('Referer', next())); break;
      case '-G': case '--get': getMode = true; break;
      case '-I': case '--head': method = 'HEAD'; break;
      case '--url': url = next(); break;
      default:
        if (VALUE_FLAGS.has(a)) next();
        else if (!a.startsWith('-') && !url) url = a;
    }
  }
  if (!url) throw new Error('URL tidak ditemukan di perintah cURL');
  if (getMode && data.length) { url += (url.includes('?') ? '&' : '?') + data.join('&'); data.length = 0; }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !url.startsWith('{{')) url = 'http://' + url;
  const ctRow = headers.find((x) => /^content-type$/i.test(x.key));
  const ct = ctRow ? ctRow.value : '';
  let body = { mode: 'none', content: '', form: [] };
  if (form.length) {
    body = { mode: 'multipart', content: '', form };
    if (ctRow) headers.splice(headers.indexOf(ctRow), 1);
  } else if (data.length) {
    const d = data.join('&');
    if (/json/i.test(ct) || /^\s*[[{]/.test(d)) {
      let pretty = d;
      try { pretty = JSON.stringify(JSON.parse(d), null, 2); } catch {}
      body = { mode: 'json', content: pretty, form: [] };
    } else if (/xml/i.test(ct)) body = { mode: 'xml', content: d, form: [] };
    else if (/x-www-form-urlencoded/i.test(ct) || (!ct && /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(d))) {
      const dec = (s) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };
      body = { mode: 'form', content: '', form: d.split('&').filter(Boolean).map((p) => { const i = p.indexOf('='); return kv(dec(i < 0 ? p : p.slice(0, i)), dec(i < 0 ? '' : p.slice(i + 1))); }) };
      if (ctRow) headers.splice(headers.indexOf(ctRow), 1);
    } else body = { mode: 'text', content: d, form: [] };
  }
  method = method || (data.length || form.length ? 'POST' : 'GET');
  let auth = { type: 'inherit' };
  if (user != null) { const ix = user.indexOf(':'); auth = { type: 'basic', username: ix < 0 ? user : user.slice(0, ix), password: ix < 0 ? '' : user.slice(ix + 1) }; }
  let name = method + ' ' + url;
  try { name = method + ' ' + (new URL(url).pathname || '/'); } catch {}
  const r = newRequest({ name, method, url, headers, body, auth, params: paramsFromUrl(url), pathParams: pathParamsFromUrl(url) });
  return newCollection({ name: 'cURL Import', items: [r] });
}

// ================================================================ detection & links
function parseText(text) {
  const t = String(text || '').replace(/^﻿/, '').trim();
  if (!t) throw new Error('Tidak ada isi untuk di-import');
  if (/^curl(\.exe)?\s/i.test(t)) return [fromCurl(t)];
  if (/^["']?(openapi|swagger)["']?\s*:/m.test(t) && !t.startsWith('{')) {
    let doc;
    try { doc = yaml.load(t); } catch (e) { throw new Error('YAML OpenAPI tidak valid: ' + e.message); }
    return parseJson(doc);
  }
  if (!t.startsWith('{') && !t.startsWith('[') && /^(meta|get|post|put|patch|delete|options|head)\s*\{/m.test(t)) return filesToCollections([{ path: 'request.bru', content: t }]);
  if (t.startsWith('<')) throw new Error('Isinya halaman HTML, bukan collection. Gunakan link "raw" ke file JSON/.bru.');
  let j;
  try { j = JSON.parse(t); } catch { throw new Error('Format tidak dikenali. Didukung: koleksi Bruno (.bru / JSON export), Postman v2.x JSON, OpenAPI/Swagger JSON, perintah cURL.'); }
  return parseJson(j);
}

function parseJson(j) {
  if (j && j.collection && j.collection.info) j = j.collection; // Postman API response
  if (j && j.info && (Array.isArray(j.item) || /postman/i.test(j.info.schema || ''))) return [fromPostman(j)];
  if (j && (j.openapi || j.swagger)) return [fromOpenApi(j)];
  if (j && Array.isArray(j.items) && (j.version || j.brunoConfig || j.environments || j.name)) return [fromBrunoJson(j)];
  if (j && j.requests && j.folders) throw new Error('Postman Collection v1 tidak didukung. Export ulang dari Postman sebagai v2.1.');
  throw new Error('JSON tidak dikenali sebagai collection Bruno, Postman v2.x, atau OpenAPI/Swagger.');
}

async function fetchText(url, accept) {
  const headers = { 'User-Agent': 'RinganAPI', Accept: accept || 'application/json, text/plain, */*' };
  if (process.env.GITHUB_TOKEN && /(^|\.)github(usercontent)?\.com$/.test(new URL(url).hostname)) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    let msg = `Gagal mengambil ${url} (HTTP ${res.status})`;
    if (res.status === 404) msg += '. Pastikan link benar dan repository bersifat publik (atau set env GITHUB_TOKEN).';
    if (res.status === 403 || res.status === 429) msg += '. Kemungkinan rate limit GitHub; coba lagi nanti atau set env GITHUB_TOKEN.';
    throw new Error(msg);
  }
  const len = Number(res.headers.get('content-length') || 0);
  if (len > 30 * 1024 * 1024) throw new Error('File terlalu besar (> 30 MB)');
  return res.text();
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

async function fromGithub(u) {
  const seg = u.pathname.split('/').filter(Boolean);
  if (seg.length < 2) throw new Error('Link GitHub harus berbentuk github.com/<owner>/<repo>[/tree/<branch>/<folder>]');
  const [owner, repoRaw] = seg;
  const repo = repoRaw.replace(/\.git$/, '');
  let branch = null;
  let sub = '';
  if (seg[2] === 'tree' || seg[2] === 'blob') { branch = seg[3]; sub = decodeURIComponent(seg.slice(4).join('/')); }
  if (!branch) branch = JSON.parse(await fetchText(`https://api.github.com/repos/${owner}/${repo}`)).default_branch;
  const raw = (p) => `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${p.split('/').map(encodeURIComponent).join('/')}`;
  if (seg[2] === 'blob') {
    const text = await fetchText(raw(sub));
    return sub.endsWith('.bru') ? filesToCollections([{ path: sub, content: text }]) : parseText(text);
  }
  const tree = JSON.parse(await fetchText(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`));
  const inSub = (p) => !sub || p === sub || p.startsWith(sub + '/');
  const blobs = (tree.tree || []).filter((x) => x.type === 'blob' && inSub(x.path) && !/(^|\/)(node_modules|\.git)\//.test(x.path));
  const bru = blobs.filter((x) => x.path.endsWith('.bru') || /(^|\/)bruno\.json$/.test(x.path));
  if (bru.length) {
    if (bru.length > 2000) throw new Error(`Terlalu banyak file (${bru.length}). Arahkan link ke folder koleksi yang lebih spesifik.`);
    const files = await mapLimit(bru, 8, async (x) => ({ path: x.path, content: await fetchText(raw(x.path)) }));
    return filesToCollections(files);
  }
  const json = blobs.filter((x) => /\.postman_collection\.json$/i.test(x.path) || /(^|\/)(openapi|swagger)\.(json|ya?ml)$/i.test(x.path));
  if (!json.length) throw new Error('Tidak ditemukan koleksi Bruno (.bru), *.postman_collection.json, atau openapi.json/.yaml di link tersebut.');
  const out = [];
  for (const x of json.slice(0, 20)) out.push(...parseText(await fetchText(raw(x.path))));
  return out;
}

async function fromGist(u) {
  const id = u.pathname.split('/').filter(Boolean).pop();
  const gist = JSON.parse(await fetchText(`https://api.github.com/gists/${id}`));
  const files = await Promise.all(Object.values(gist.files || {}).map(async (f) => ({ path: f.filename, content: f.truncated ? await fetchText(f.raw_url) : f.content })));
  return filesToCollections(files);
}

async function fromUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('Link tidak valid'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Link harus http:// atau https://');
  let cols;
  if (u.hostname === 'github.com') cols = await fromGithub(u);
  else if (u.hostname === 'gist.github.com') cols = await fromGist(u);
  else {
    const text = await fetchText(url);
    cols = /\.bru(\?|$)/.test(u.pathname) ? filesToCollections([{ path: u.pathname.split('/').pop(), content: text }]) : parseText(text);
  }
  for (const c of cols) c.source = { type: 'url', url, importedAt: new Date().toISOString() };
  return cols;
}

// ================================================================ sample data
function sampleCollection() {
  const env = { id: uid(), name: 'Public', vars: [kv('baseUrl', 'https://jsonplaceholder.typicode.com')] };
  return newCollection({
    name: 'Contoh: JSONPlaceholder',
    environments: [env],
    activeEnvId: env.id,
    items: [
      newRequest({
        name: 'List posts', method: 'GET', url: '{{baseUrl}}/posts?_limit=5', params: [kv('_limit', '5')],
        asserts: [kv('res.status', 'eq 200'), kv('res.body', 'isArray'), kv('res.body.length', 'eq 5'), kv('res.responseTime', 'lt 5000')],
        docs: 'Contoh assertion tanpa kode di tab Assert.',
      }),
      newRequest({
        name: 'Get post by id', method: 'GET', url: '{{baseUrl}}/posts/:id', pathParams: [kv('id', '1')],
        tests: 'test("status 200", () => {\n  expect(res.status).to.equal(200);\n});\n\ntest("punya field wajib", () => {\n  expect(res.body).to.have.property("id", 1);\n  expect(res.body.title).to.be.a("string");\n});',
      }),
      newRequest({
        name: 'Create post', method: 'POST', url: '{{baseUrl}}/posts',
        body: { mode: 'json', content: '{\n  "title": "Halo",\n  "body": "Dibuat dari Ringan API",\n  "userId": 1\n}', form: [] },
        postScript: '// simpan id untuk request berikutnya\nbru.setVar("newPostId", res.body.id);',
        tests: 'test("created", () => {\n  expect(res.status).to.equal(201);\n  expect(res.body.title).to.equal("Halo");\n});',
      }),
    ],
  });
}

module.exports = { bodyHash, parseText, parseJson, filesToCollections, fromUrl, fromCurl, fromPostman, fromOpenApi, fromBrunoJson, toBrunoJson, bruToRequest, sampleCollection };
