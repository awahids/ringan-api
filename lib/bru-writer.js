'use strict';
/*
 * Serialises a Ringan collection to a Bruno-compatible folder of .bru files:
 *   bruno.json, collection.bru, environments/<env>.bru, <folder>/folder.bru, <folder>/<request>.bru
 * The output can be opened in Bruno, committed to Git, and read back by Ringan (lib/importers.js).
 */

const METHOD_BLOCK = { GET: 'get', POST: 'post', PUT: 'put', PATCH: 'patch', DELETE: 'delete', OPTIONS: 'options', HEAD: 'head' };
const BODY_MODE = { none: 'none', json: 'json', text: 'text', xml: 'xml', form: 'formUrlEncoded', multipart: 'multipartForm' };

const safeName = (name) => String(name || 'untitled').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/^\.+/, '').replace(/[. ]+$/, '').trim().slice(0, 120) || 'untitled';
const indent = (text, n = 2) => String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => (l ? ' '.repeat(n) + l : '')).join('\n');

function value(v) {
  v = String(v ?? '');
  if (v.includes('\n')) return "'''\n" + indent(v, 4) + "\n  '''";
  return v;
}
function key(k) {
  k = String(k ?? '');
  return /[:\s{}]/.test(k) || k.startsWith('~') ? JSON.stringify(k) : k;
}
function dictBlock(name, rows, { keepEmpty = false } = {}) {
  const list = (rows || []).filter((r) => r && r.key);
  if (!list.length && !keepEmpty) return '';
  return `${name} {\n${list.map((r) => `  ${r.enabled === false ? '~' : ''}${key(r.key)}: ${value(r.value)}`).join('\n')}\n}\n`;
}
function textBlock(name, text) {
  if (!text || !String(text).trim()) return '';
  return `${name} {\n${indent(text)}\n}\n`;
}
function authBlocks(auth) {
  const a = auth || {};
  if (a.type === 'bearer') return dictBlock('auth:bearer', [{ key: 'token', value: a.token || '' }], { keepEmpty: true });
  if (a.type === 'basic') return dictBlock('auth:basic', [{ key: 'username', value: a.username || '' }, { key: 'password', value: a.password || '' }]);
  if (a.type === 'apikey') return dictBlock('auth:apikey', [{ key: 'key', value: a.key || '' }, { key: 'value', value: a.value || '' }, { key: 'placement', value: a.in === 'query' ? 'queryparams' : 'header' }]);
  return '';
}
const join = (parts) => parts.filter(Boolean).join('\n');

function requestToBru(r, seq) {
  const method = METHOD_BLOCK[r.method] || 'get';
  const body = r.body || { mode: 'none' };
  const parts = [
    dictBlock('meta', [{ key: 'name', value: r.name }, { key: 'type', value: 'http' }, { key: 'seq', value: String(seq) }]),
    dictBlock(method, [{ key: 'url', value: r.url || '' }, { key: 'body', value: BODY_MODE[body.mode] || 'none' }, { key: 'auth', value: (r.auth && r.auth.type) || 'inherit' }]),
    dictBlock('params:query', r.params),
    dictBlock('params:path', r.pathParams),
    dictBlock('headers', r.headers),
    authBlocks(r.auth),
  ];
  if (body.mode === 'json') parts.push(textBlock('body:json', body.content));
  if (body.mode === 'text') parts.push(textBlock('body:text', body.content));
  if (body.mode === 'xml') parts.push(textBlock('body:xml', body.content));
  if (body.mode === 'form') parts.push(dictBlock('body:form-urlencoded', body.form));
  if (body.mode === 'multipart') parts.push(dictBlock('body:multipart-form', (body.form || []).map((f) => (f.type === 'file' ? { ...f, value: `@file(${f.fileName || ''})` } : f))));
  parts.push(
    dictBlock('vars:pre-request', r.vars),
    dictBlock('assert', r.asserts),
    textBlock('script:pre-request', r.preScript),
    textBlock('script:post-response', r.postScript),
    textBlock('tests', r.tests),
    textBlock('docs', r.docs),
  );
  return join(parts);
}

function containerToBru(c, { isCol, seq }) {
  const parts = [];
  if (!isCol) parts.push(dictBlock('meta', [{ key: 'name', value: c.name }, { key: 'seq', value: String(seq) }]));
  parts.push(dictBlock('headers', c.headers));
  const mode = (c.auth && c.auth.type) || (isCol ? 'none' : 'inherit');
  parts.push(dictBlock('auth', [{ key: 'mode', value: mode }]), authBlocks(c.auth));
  if (isCol) {
    parts.push(
      dictBlock('vars:pre-request', c.vars),
      textBlock('script:pre-request', c.preScript),
      textBlock('script:post-response', c.postScript),
      textBlock('tests', c.tests),
      textBlock('docs', c.docs),
    );
  }
  return join(parts);
}

function envToBru(env) {
  const plain = (env.vars || []).filter((v) => v.key && !v.secret);
  const secret = (env.vars || []).filter((v) => v.key && v.secret);
  const parts = [dictBlock('vars', plain, { keepEmpty: true })];
  // Like Bruno: secret names are listed, their values are never written to disk.
  if (secret.length) parts.push(`vars:secret [\n${secret.map((v) => `  ${v.enabled === false ? '~' : ''}${v.key}`).join(',\n')}\n]\n`);
  return join(parts);
}

/**
 * Returns { files: [{ path, content }], paths: Map(itemId -> relative path) } for a collection.
 * Paths use "/" separators, relative to the collection folder.
 */
function collectionToFiles(col) {
  const files = [];
  const paths = new Map();
  files.push({ path: 'bruno.json', content: JSON.stringify({ version: '1', name: col.name, type: 'collection', ignore: ['node_modules', '.git'] }, null, 2) + '\n' });
  files.push({ path: 'collection.bru', content: containerToBru(col, { isCol: true }) });
  const envNames = new Set();
  for (const env of col.environments || []) {
    let n = safeName(env.name);
    while (envNames.has(n.toLowerCase())) n += '_';
    envNames.add(n.toLowerCase());
    files.push({ path: `environments/${n}.bru`, content: envToBru(env) });
  }
  (function walk(items, dir) {
    const used = new Set(['folder', 'collection', 'environments'].map((x) => x.toLowerCase()));
    const unique = (base) => {
      let n = base;
      let i = 2;
      while (used.has(n.toLowerCase())) n = `${base} (${i++})`;
      used.add(n.toLowerCase());
      return n;
    };
    items.forEach((it, idx) => {
      if (it.type === 'folder') {
        const rel = (dir ? dir + '/' : '') + unique(safeName(it.name));
        paths.set(it.id, rel);
        files.push({ path: `${rel}/folder.bru`, content: containerToBru(it, { isCol: false, seq: idx + 1 }) });
        walk(it.items || [], rel);
      } else {
        const rel = (dir ? dir + '/' : '') + unique(safeName(it.name)) + '.bru';
        paths.set(it.id, rel);
        files.push({ path: rel, content: requestToBru(it, idx + 1) });
      }
    });
  })(col.items || [], '');
  // Scenarios are Ringan-only; they live next to the .bru files and point at requests by path.
  if ((col.scenarios || []).length) {
    const scenarios = col.scenarios.map((s) => ({
      id: s.id,
      name: s.name,
      stopOnFail: s.stopOnFail !== false,
      steps: (s.steps || []).map((st) => {
        const o = { id: st.id, request: paths.get(st.reqId) || st.reqPath || null };
        for (const k of ['expectStatus', 'delayMs', 'enabled']) if (st[k] !== undefined && st[k] !== '') o[k] = st[k];
        if ((st.extract || []).length) o.extract = st.extract.map((x) => ({ from: x.from || 'body', path: x.path || '', var: x.var || '', scope: x.scope || 'runtime' }));
        return o;
      }),
    }));
    files.push({ path: SCENARIO_FILE, content: JSON.stringify({ ringan: 1, scenarios }, null, 2) + '\n' });
  }
  return { files, paths };
}

const SCENARIO_FILE = 'ringan-scenarios.json';

/** Turns the parsed scenarios file into app scenarios; `resolve(path)` maps a request path to its id. */
function scenariosFromFile(text, resolve) {
  let data;
  try { data = JSON.parse(text); } catch { return []; }
  return ((data && data.scenarios) || []).filter((s) => s && typeof s === 'object').map((s, i) => ({
    id: String(s.id || `scn${Date.now().toString(36)}${i}`),
    name: String(s.name || `Skenario ${i + 1}`),
    stopOnFail: s.stopOnFail !== false,
    steps: (s.steps || []).map((st, j) => ({
      id: String(st.id || `st${i}_${j}`),
      reqPath: st.request || null,
      reqId: (st.request && resolve(st.request)) || null,
      expectStatus: st.expectStatus === undefined ? '' : String(st.expectStatus),
      delayMs: Number(st.delayMs) || 0,
      enabled: st.enabled !== false,
      extract: (st.extract || []).map((x) => ({ from: x.from || 'body', path: x.path || '', var: x.var || '', scope: x.scope === 'env' ? 'env' : 'runtime' })),
    })),
  }));
}

module.exports = { collectionToFiles, requestToBru, safeName, scenariosFromFile, SCENARIO_FILE };
