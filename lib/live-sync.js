'use strict';
/*
 * Live connection between a collection and the API project you are developing.
 *  - discover(): find the OpenAPI spec of a running dev server (common framework paths) or in a project folder
 *  - fetchSpec(): read the spec (URL or file) and hash it so changes are cheap to detect
 *  - mergeSpec(): update the collection from a new version of the spec WITHOUT losing your work:
 *      spec-owned fields (method, path, params, schemas, docs, untouched example bodies) follow the spec;
 *      your tests, assertions, scripts, vars, auth, extra headers and edited bodies are kept;
 *      endpoints removed from the spec are moved to a folder instead of being deleted.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const importers = require('./importers');

const sha1 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');
const bodyHash = importers.bodyHash;

// Where popular frameworks serve their OpenAPI document.
const PROBE_PATHS = [
  ['/openapi.json', 'FastAPI, Express (swagger-jsdoc), Hono, Elysia'],
  ['/v3/api-docs', 'Spring Boot (springdoc)'],
  ['/api-json', 'NestJS (SwaggerModule di /api)'],
  ['/docs-json', 'NestJS (SwaggerModule di /docs)'],
  ['/api/docs-json', 'NestJS (SwaggerModule di /api/docs)'],
  ['/swagger/v1/swagger.json', 'ASP.NET Core (Swashbuckle)'],
  ['/swagger.json', 'umum'],
  ['/api-docs', 'Express (swagger-ui-express), umum'],
  ['/api-docs.json', 'umum'],
  ['/docs/api-docs.json', 'Laravel (l5-swagger)'],
  ['/swagger/doc.json', 'Go (swaggo)'],
  ['/api/openapi.json', 'umum'],
  ['/api/swagger.json', 'umum'],
  ['/api/schema/', 'Django REST (drf-spectacular)'],
  ['/schema/', 'Django REST'],
  ['/q/openapi', 'Quarkus'],
  ['/openapi.yaml', 'umum'],
  ['/openapi', 'umum'],
  ['/v2/api-docs', 'Spring (springfox)'],
  ['/documentation/json', 'Fastify (@fastify/swagger)'],
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', '.venv', 'venv', '__pycache__', '.next', '.nuxt', 'coverage', '.idea', '.vscode', 'target', 'bin', 'obj', '.gradle']);

function looksLikeSpec(text) {
  const t = String(text || '').trim();
  if (t.startsWith('{')) { try { const j = JSON.parse(t); return !!(j.openapi || j.swagger) && j; } catch { return false; } }
  if (/^["']?(openapi|swagger)["']?\s*:/m.test(t)) { try { const j = require('./vendor/js-yaml').load(t); return !!(j && (j.openapi || j.swagger)) && j; } catch { return false; } }
  return false;
}

async function fetchText(url, timeoutMs = 4000) {
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json, application/yaml, application/vnd.oai.openapi, */*', 'User-Agent': 'RinganAPI' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  } catch (e) {
    const code = e.cause && (e.cause.code || e.cause.message);
    const host = new URL(url).host;
    throw new Error(e.name === 'TimeoutError' ? `${host} tidak merespons (timeout)` : code === 'ECONNREFUSED' ? `Tidak bisa terhubung ke ${host} (server tidak berjalan?)` : `Tidak bisa terhubung ke ${host}${code ? ` (${code})` : ''}`);
  }
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.text();
}

const describe = (j, extra) => ({
  title: (j.info && j.info.title) || 'API', version: (j.info && j.info.version) || '',
  paths: Object.keys(j.paths || {}).length, openapi: j.openapi || j.swagger, ...extra,
});

/** Probes a dev server (or a direct spec URL) for an OpenAPI document. */
async function discoverUrl(input) {
  let u;
  try { u = new URL(/^https?:\/\//i.test(input) ? input : `http://${input}`); } catch { throw new Error('URL tidak valid'); }
  const origin = u.origin;
  const candidates = [];
  const tried = [];
  // The URL itself may already be the spec.
  if (u.pathname && u.pathname !== '/') {
    try { const t = await fetchText(u.href); const j = looksLikeSpec(t); if (j) candidates.push(describe(j, { type: 'url', location: u.href, framework: 'URL langsung' })); } catch (e) { tried.push(`${u.href}: ${e.message}`); }
  }
  let reachable = false;
  const results = await Promise.all(PROBE_PATHS.map(async ([p, fw]) => {
    try { const t = await fetchText(origin + p, 3000); reachable = true; const j = looksLikeSpec(t); return j ? describe(j, { type: 'url', location: origin + p, framework: fw }) : null; } catch (e) { if (e.status) reachable = true; return null; }
  }));
  for (const r of results) if (r && !candidates.some((c) => c.location === r.location)) candidates.push(r);
  // Same document served at several paths: keep the first of each title+paths.
  const uniq = [];
  for (const c of candidates) if (!uniq.some((x) => x.title === c.title && x.paths === c.paths && x.version === c.version)) uniq.push(c);
  if (!reachable && !uniq.length) {
    try { await fetchText(origin + '/', 3000); reachable = true; } catch (e) { if (e.status) reachable = true; }
  }
  return { origin, reachable, candidates: uniq };
}

function frameworkHints(dir) {
  const hints = [];
  const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
  const pkg = read('package.json');
  if (/@nestjs\/swagger/.test(pkg)) hints.push({ framework: 'NestJS', tip: 'Spec tersedia saat server jalan di /api-json (sesuai path SwaggerModule.setup). Hubungkan lewat URL dev server.' });
  else if (/@nestjs\/core/.test(pkg)) hints.push({ framework: 'NestJS', tip: 'Pasang @nestjs/swagger lalu SwaggerModule.setup("api", app, document); spec tersedia di /api-json.' });
  if (/swagger-jsdoc|swagger-ui-express|express-openapi|@fastify\/swagger|hono-openapi|@hono\/zod-openapi|elysia/.test(pkg)) hints.push({ framework: 'Node.js', tip: 'Proyek memakai generator OpenAPI; hubungkan lewat URL dev server (mis. /api-docs, /openapi.json, /documentation/json).' });
  else if (/"express"/.test(pkg)) hints.push({ framework: 'Express', tip: 'Express belum punya spec. Tambahkan swagger-jsdoc (anotasi JSDoc) atau tulis openapi.yaml di repo, lalu hubungkan.' });
  const py = read('requirements.txt') + read('pyproject.toml') + read('Pipfile');
  if (/fastapi/i.test(py)) hints.push({ framework: 'FastAPI', tip: 'Spec otomatis di /openapi.json saat server jalan (uvicorn). Hubungkan lewat URL dev server.' });
  if (/drf-spectacular/i.test(py)) hints.push({ framework: 'Django REST', tip: 'Spec di /api/schema/ (atau path SpectacularAPIView Anda).' });
  else if (/djangorestframework/i.test(py)) hints.push({ framework: 'Django REST', tip: 'Pasang drf-spectacular untuk menghasilkan spec OpenAPI.' });
  if (/flask/i.test(py) && !/flask-smorest|apispec|flasgger/i.test(py)) hints.push({ framework: 'Flask', tip: 'Pasang flask-smorest atau flasgger untuk spec OpenAPI.' });
  const java = read('pom.xml') + read('build.gradle') + read('build.gradle.kts');
  if (/springdoc/i.test(java)) hints.push({ framework: 'Spring Boot', tip: 'Spec di /v3/api-docs saat aplikasi jalan.' });
  else if (/spring-boot/i.test(java)) hints.push({ framework: 'Spring Boot', tip: 'Tambahkan springdoc-openapi-starter-webmvc-ui; spec tersedia di /v3/api-docs.' });
  const php = read('composer.json');
  if (/l5-swagger/i.test(php)) hints.push({ framework: 'Laravel', tip: 'Jalankan php artisan l5-swagger:generate; spec di storage/api-docs/api-docs.json atau /docs/api-docs.json.' });
  else if (/laravel\/framework/i.test(php)) hints.push({ framework: 'Laravel', tip: 'Pasang darkaonline/l5-swagger atau dedoc/scramble untuk spec OpenAPI.' });
  const gomod = read('go.mod');
  if (/swaggo/i.test(gomod)) hints.push({ framework: 'Go (swag)', tip: 'Jalankan swag init; spec di docs/swagger.json (bisa dihubungkan sebagai file, ikut ter-update setiap swag init).' });
  else if (/gin-gonic|labstack\/echo|gofiber/i.test(gomod)) hints.push({ framework: 'Go', tip: 'Pasang swaggo/swag untuk menghasilkan docs/swagger.json.' });
  if (fs.existsSync(path.join(dir, 'Program.cs')) || /Swashbuckle/i.test(read(fs.readdirSync(dir).find((f) => f.endsWith('.csproj')) || ''))) hints.push({ framework: 'ASP.NET Core', tip: 'Spec di /swagger/v1/swagger.json saat aplikasi jalan.' });
  return hints;
}

/** Scans a project folder for OpenAPI/Swagger files (generated or hand-written). */
function discoverDir(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('Folder tidak ditemukan');
  const found = [];
  let scanned = 0;
  (function walk(d, depth) {
    if (depth > 6 || found.length >= 30 || scanned > 20000) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      scanned++;
      if (ent.isDirectory()) { if (!SKIP_DIRS.has(ent.name) && !ent.name.startsWith('.')) walk(path.join(d, ent.name), depth + 1); continue; }
      if (!/\.(json|ya?ml)$/i.test(ent.name) || !/(openapi|swagger|api-docs|api-spec|oas)/i.test(ent.name)) continue;
      const full = path.join(d, ent.name);
      try {
        if (fs.statSync(full).size > 15 * 1024 * 1024) continue;
        const j = looksLikeSpec(fs.readFileSync(full, 'utf8'));
        if (j) found.push(describe(j, { type: 'file', location: full, relative: path.relative(dir, full) }));
      } catch {}
    }
  })(dir, 0);
  let hints = [];
  try { hints = frameworkHints(dir); } catch {}
  return { candidates: found, hints };
}

async function fetchSpec(live) {
  if (!live || !live.location) throw new Error('Sumber live belum diatur');
  const text = live.type === 'file' ? fs.readFileSync(live.location, 'utf8') : await fetchText(live.location, 10000);
  if (!looksLikeSpec(text)) throw new Error('Isi sumber bukan dokumen OpenAPI/Swagger');
  return { text, hash: sha1(text) };
}

// ---------------------------------------------------------------- merge
const normPath = (p) => String(p || '').split('?')[0].replace(/^\{\{[^}]+\}\}/, '').replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '').replace(/\/:([A-Za-z_][\w-]*)/g, '/{}').replace(/\{[^}]*\}/g, '{}').replace(/\/+$/, '') || '/';
const keyOf = (r) => (r.specKey ? `${r.specKey.split(' ')[0]} ${normPath(r.specKey.slice(r.specKey.indexOf(' ') + 1))}` : `${r.method} ${normPath(r.url)}`);
const REMOVED_FOLDER = 'Tidak ada lagi di spec';

function walkReqs(items, fn, parent) {
  for (const it of items || []) { if (it.type === 'folder') walkReqs(it.items, fn, it); else fn(it, parent); }
}

function specSnapshot(r) {
  return JSON.stringify([r.method, r.url, (r.pathParams || []).map((p) => p.key), r.responseSchemas || null, r.specName, r.specDocs, r.specBodyHash]);
}

/** Merges a freshly imported collection (from the new spec) into an existing collection. Returns { col, diff }. */
function mergeSpec(col, fresh) {
  const diff = { added: [], changed: [], removed: [], restored: [], bodyKept: [], unchanged: 0 };
  // Requests that came from the spec are matched first; a request without spec bookkeeping (e.g. imported
  // before live sync existed) is used only if no spec-owned request has the same method + path.
  const existing = new Map();
  walkReqs(col.items, (r, parent) => { if (r.specKey && !existing.has(keyOf(r))) existing.set(keyOf(r), { r, parent: parent || col }); });
  walkReqs(col.items, (r, parent) => { if (!r.specKey && !r.specDetached && !existing.has(keyOf(r))) existing.set(keyOf(r), { r, parent: parent || col }); });
  const seen = new Set();
  const folderByName = (name) => {
    let f = col.items.find((x) => x.type === 'folder' && x.name === name);
    if (!f) { f = { id: crypto.randomUUID(), type: 'folder', name, items: [], headers: [], auth: { type: 'inherit' } }; col.items.push(f); }
    return f;
  };
  const detach = (r, parent) => { const i = parent.items.indexOf(r); if (i >= 0) parent.items.splice(i, 1); };

  walkReqs(fresh.items, (f, fParent) => {
    const k = keyOf(f);
    seen.add(k);
    const hit = existing.get(k);
    const tag = fParent && fParent !== fresh ? fParent.name : null;
    if (!hit) {
      (tag ? folderByName(tag) : col).items.push(f);
      diff.added.push(`${f.method} ${f.specKey ? f.specKey.split(' ')[1] : f.url}`);
      return;
    }
    const r = hit.r;
    const before = specSnapshot(r);
    // Spec-owned fields.
    r.method = f.method;
    if (!r.specName || r.name === r.specName) r.name = f.name;
    r.specName = f.name;
    if (!r.specDocs || r.docs === r.specDocs || !r.docs) r.docs = f.docs;
    r.specDocs = f.docs;
    r.pathParams = (f.pathParams || []).map((p) => (r.pathParams || []).find((x) => x.key === p.key) || p);
    // Query params: keep your values, add new ones, drop ones the spec no longer has.
    const freshKeys = new Set((f.params || []).map((p) => p.key));
    const specOwned = new Set(r.specParamKeys || []);
    const params = (r.params || []).filter((p) => freshKeys.has(p.key) || !specOwned.has(p.key));
    for (const p of f.params || []) if (!params.some((x) => x.key === p.key)) params.push(p);
    r.params = params;
    r.specParamKeys = [...freshKeys];
    const base = f.url.split('?')[0];
    const q = params.filter((p) => p.enabled !== false && p.key).map((p) => `${p.key}=${p.value}`).join('&');
    r.url = q ? `${base}?${q}` : base;
    // Headers: only add what the spec newly requires.
    for (const h of f.headers || []) if (h.enabled && !(r.headers || []).some((x) => x.key.toLowerCase() === h.key.toLowerCase())) (r.headers = r.headers || []).push(h);
    // Body: replace only if you never edited the generated example.
    const untouched = r.specBodyHash && bodyHash(r.body) === r.specBodyHash;
    if (untouched || !r.body || r.body.mode === 'none') {
      if (bodyHash(r.body) !== bodyHash(f.body)) { r.body = f.body; }
      r.specBodyHash = f.specBodyHash;
    } else if (f.specBodyHash !== r.specBodyHash) {
      diff.bodyKept.push(`${r.method} ${r.name}`);
      r.specBodyHash = r.specBodyHash || f.specBodyHash;
    }
    r.responseSchemas = f.responseSchemas;
    if (r.schemaCheck === undefined) r.schemaCheck = f.schemaCheck;
    r.specKey = f.specKey;
    if (r.specRemoved) {
      delete r.specRemoved;
      detach(r, hit.parent);
      (tag ? folderByName(tag) : col).items.push(r);
      diff.restored.push(`${r.method} ${r.name}`);
    } else if (specSnapshot(r) !== before) diff.changed.push(`${r.method} ${r.name}`);
    else diff.unchanged++;
  });

  // Endpoints gone from the spec: move (never delete) your requests.
  for (const [k, { r, parent }] of existing) {
    if (seen.has(k) || !r.specKey || r.specRemoved) continue;
    r.specRemoved = true;
    detach(r, parent);
    folderByName(REMOVED_FOLDER).items.push(r);
    diff.removed.push(`${r.method} ${r.name}`);
  }
  // The "removed" folder disappears once it is empty again; your own folders are never touched.
  col.items = col.items.filter((x) => !(x.type === 'folder' && x.name === REMOVED_FOLDER && !x.items.length));
  col.openapi = fresh.openapi || col.openapi;
  if ((!col.auth || col.auth.type === 'none') && fresh.auth && fresh.auth.type !== 'none') {
    col.auth = fresh.auth;
    for (const v of fresh.vars || []) if (v.key !== 'baseUrl' && !(col.vars || []).some((x) => x.key === v.key)) (col.vars = col.vars || []).push(v);
  }
  return { col, diff };
}

module.exports = { discoverUrl, discoverDir, fetchSpec, mergeSpec, looksLikeSpec, sha1, REMOVED_FOLDER, PROBE_PATHS };
