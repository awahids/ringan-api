'use strict';
/*
 * Keeps a collection in sync with a Bruno-format folder on disk (Git-friendly).
 *   - writeCollectionDir: app -> disk (only files whose content changed are rewritten;
 *     stale .bru files are removed; non-.bru files are never touched)
 *   - readCollectionDir / mergeFromDisk: disk -> app, keeping ids, secret values and
 *     app-only data (response schemas, uploaded multipart files) by matching relative paths.
 */
const fs = require('fs');
const path = require('path');
const { collectionToFiles, SCENARIO_FILE } = require('./bru-writer');
const importers = require('./importers');

const SKIP_DIRS = new Set(['node_modules', '.git']);

function inspectDir(dir) {
  if (!fs.existsSync(dir)) return 'missing';
  if (!fs.statSync(dir).isDirectory()) return 'file';
  if (fs.existsSync(path.join(dir, 'bruno.json'))) return 'bruno';
  return fs.readdirSync(dir).filter((n) => !n.startsWith('.')).length ? 'other' : 'empty';
}

function listFiles(dir, filter) {
  const out = [];
  (function walk(d, rel) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(path.join(d, ent.name), r);
      else if (filter(r)) out.push(r);
    }
  })(dir, '');
  return out;
}

function walkItems(items, fn) {
  for (const it of items || []) { fn(it); if (it.type === 'folder') walkItems(it.items, fn); }
}

function writeCollectionDir(col) {
  const dir = col.fsPath;
  const { files, paths } = collectionToFiles(col);
  fs.mkdirSync(dir, { recursive: true });
  let written = 0;
  const wanted = new Set();
  for (const f of files) {
    wanted.add(f.path);
    const full = path.join(dir, ...f.path.split('/'));
    let current = null;
    try { current = fs.readFileSync(full, 'utf8'); } catch {}
    if (current === f.content) continue;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, f.content);
    written++;
  }
  // Remove .bru files that no longer belong to the collection (renamed/deleted requests).
  let deleted = 0;
  for (const rel of listFiles(dir, (r) => r.endsWith('.bru'))) {
    if (wanted.has(rel)) continue;
    fs.unlinkSync(path.join(dir, ...rel.split('/')));
    deleted++;
  }
  if (!wanted.has(SCENARIO_FILE) && fs.existsSync(path.join(dir, SCENARIO_FILE))) { fs.unlinkSync(path.join(dir, SCENARIO_FILE)); deleted++; }
  // Remove folders left empty by the cleanup (never the collection root).
  (function prune(d) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (!ent.isDirectory() || SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
      const p = path.join(d, ent.name);
      prune(p);
      if (!fs.readdirSync(p).length) fs.rmdirSync(p);
    }
  })(dir);
  walkItems(col.items, (it) => { if (paths.has(it.id)) it.fsRel = paths.get(it.id); });
  return { written, deleted };
}

function readCollectionDir(dir) {
  if (inspectDir(dir) !== 'bruno') throw new Error(`Folder "${dir}" bukan koleksi Bruno (tidak ada bruno.json).`);
  const files = listFiles(dir, (r) => r.endsWith('.bru') || r === 'bruno.json' || r === SCENARIO_FILE).map((r) => ({ path: r, content: fs.readFileSync(path.join(dir, ...r.split('/')), 'utf8') }));
  const [col] = importers.filesToCollections(files.length ? files : [{ path: 'bruno.json', content: '{}' }]);
  return col;
}

/** Replaces the collection's content with what is on disk, preserving ids and app-only data. */
function mergeFromDisk(col, fresh) {
  const old = new Map();
  walkItems(col.items, (it) => { if (it.fsRel) old.set(`${it.type}:${it.fsRel}`, it); });
  walkItems(fresh.items, (it) => {
    const o = old.get(`${it.type}:${it.fsRel}`);
    if (!o) return;
    it.id = o.id;
    if (it.type !== 'request') return;
    for (const k of ['responseSchemas', 'schemaCheck', 'specKey', 'specName', 'specDocs', 'specBodyHash', 'specParamKeys', 'specRemoved']) if (o[k] !== undefined) it[k] = o[k];
    if (it.body.mode === 'multipart') {
      for (const f of it.body.form) {
        if (f.type !== 'file') continue;
        const of = ((o.body && o.body.form) || []).find((x) => x.key === f.key && x.type === 'file');
        if (of) Object.assign(f, { data: of.data, contentType: of.contentType, fileName: of.fileName || f.fileName });
      }
    }
  });
  const activeName = ((col.environments || []).find((e) => e.id === col.activeEnvId) || {}).name;
  for (const fe of fresh.environments) {
    const oe = (col.environments || []).find((e) => e.name === fe.name);
    if (!oe) continue;
    fe.id = oe.id;
    for (const v of fe.vars) {
      if (!v.secret) continue;
      const ov = oe.vars.find((x) => x.key === v.key);
      if (ov) v.value = ov.value;
    }
  }
  for (const k of ['name', 'items', 'headers', 'auth', 'vars', 'preScript', 'postScript', 'tests', 'docs', 'environments']) col[k] = fresh[k];
  if (fresh.scenarios) {
    const byPath = new Map();
    walkItems(col.items, (it) => { if (it.fsRel && it.type === 'request') byPath.set(it.fsRel, it.id); });
    const known = new Map((col.scenarios || []).flatMap((s) => (s.steps || []).map((st) => [st.id, st.reqId])));
    for (const s of fresh.scenarios) for (const st of s.steps) st.reqId = (st.reqPath && byPath.get(st.reqPath)) || known.get(st.id) || null;
    col.scenarios = fresh.scenarios;
  }
  const active = col.environments.find((e) => e.name === activeName);
  col.activeEnvId = active ? active.id : col.activeEnvId && col.environments.some((e) => e.id === col.activeEnvId) ? col.activeEnvId : null;
  return col;
}

module.exports = { inspectDir, writeCollectionDir, readCollectionDir, mergeFromDisk };
