#!/usr/bin/env node
'use strict';
/*
 * Ringan API — local, login-free API client.
 * Zero dependencies: needs only Node.js >= 18.
 *
 *   node server.js            start and open the app window
 *   node server.js --no-open  start without opening a window
 *   node server.js --browser  open in the default browser instead of an app window
 *   node server.js --auto-exit stop the server ~3 minutes after the last window closes
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const importers = require('./lib/importers');
const { sendHttp } = require('./lib/http');
const fsSync = require('./lib/fs-sync');
const liveSync = require('./lib/live-sync');
const ai = require('./lib/ai');
const updates = require('./lib/updates');
const { safeName } = require('./lib/bru-writer');

// Available when the server runs inside the Electron shell (native folder picker, reveal in explorer).
let electron = null;
try { if (process.versions.electron) electron = require('electron'); } catch {}

const VERSION = require('./package.json').version;
const HOST = '127.0.0.1';
const START_PORT = Number(process.env.PORT) || 4877;
const DATA_DIR = process.env.RINGAN_DATA || path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const TOKEN = crypto.randomBytes(24).toString('hex');
const MAX_BODY = 60 * 1024 * 1024; // incoming JSON to this server
const args = new Set(process.argv.slice(2));

let PORT = START_PORT;
let lastPing = Date.now();
let everPinged = false;

// ---------------------------------------------------------------- store
function defaultStore() {
  return {
    version: 1,
    settings: { timeoutMs: 30000, verifyTls: true, followRedirects: true, scriptTimeoutMs: 10000, theme: 'system' },
    collections: [importers.sampleCollection()],
  };
}

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      // Keep the unreadable file instead of silently overwriting it.
      const bak = STORE_FILE + '.broken-' + Date.now();
      try { fs.copyFileSync(STORE_FILE, bak); } catch {}
      console.error(`store.json tidak bisa dibaca (${e.message}). Disalin ke ${bak}`);
    }
    const s = defaultStore();
    writeStore(s);
    return s;
  }
}

function writeStore(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = STORE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, STORE_FILE);
}

// ---------------------------------------------------------------- history
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const HISTORY_MAX = 300;
const HISTORY_BODY_MAX = 512 * 1024;
let historyCache = null;

function readHistory() {
  if (historyCache) return historyCache;
  try { historyCache = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch { historyCache = []; }
  if (!Array.isArray(historyCache)) historyCache = [];
  return historyCache;
}
function writeHistory(list) {
  historyCache = list;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = HISTORY_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list));
  fs.renameSync(tmp, HISTORY_FILE);
}
function trimHistoryEntry(e) {
  const cut = (s) => (typeof s === 'string' && s.length > HISTORY_BODY_MAX ? s.slice(0, HISTORY_BODY_MAX) + '\n… (dipotong untuk history)' : s);
  const out = {
    id: crypto.randomUUID(), at: Number(e.at) || Date.now(),
    reqId: e.reqId || null, colId: e.colId || null, colName: String(e.colName || ''), name: String(e.name || ''),
    method: String(e.method || 'GET'), url: String(e.url || ''), status: e.status ?? null, timeMs: e.timeMs ?? null,
    error: e.error || null, testsPassed: e.testsPassed || 0, testsTotal: e.testsTotal || 0,
    request: e.request || null, logs: (e.logs || []).slice(0, 200), tests: (e.tests || []).slice(0, 500),
    response: e.response || null, isJson: !!e.isJson,
  };
  if (out.request && out.request.body && out.request.body.type === 'text') out.request.body.text = cut(out.request.body.text);
  if (out.request && out.request.body && out.request.body.type === 'multipart') out.request.body.parts = out.request.body.parts.map((p) => (p.file ? { ...p, base64: '' } : p));
  if (out.response) { out.response.bodyText = cut(out.response.bodyText); if (out.response.bodyBase64 && out.response.bodyBase64.length > HISTORY_BODY_MAX) out.response.bodyBase64 = null; }
  return out;
}

// ---------------------------------------------------------------- server plumbing
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Payload terlalu besar'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Object.assign(new Error('JSON tidak valid'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const CSP_APP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self'; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
// Scripts from collections run in this worker: eval allowed, but no network access at all.
const CSP_SANDBOX = "default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'none'";

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const ext = path.extname(file);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    if (pathname === '/index.html') {
      data = Buffer.from(data.toString('utf8').replace('__RINGAN_TOKEN__', TOKEN));
      headers['Content-Security-Policy'] = CSP_APP;
      headers['X-Frame-Options'] = 'DENY';
    } else if (pathname === '/sandbox-worker.js') {
      headers['Content-Security-Policy'] = CSP_SANDBOX;
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

function allowedHost(host) {
  return host === `${HOST}:${PORT}` || host === `localhost:${PORT}`;
}

async function handleApi(req, res, pathname) {
  // Only the app page (which received the per-run token) may call the API.
  // This blocks other websites and DNS-rebinding pages from using this local proxy.
  const origin = req.headers.origin;
  if (req.headers['x-ringan-token'] !== TOKEN || (origin && !allowedHost(origin.replace(/^https?:\/\//, '')))) {
    return sendJson(res, 403, { error: 'Forbidden: sesi tidak valid. Muat ulang halaman.' });
  }
  const m = req.method;
  if (pathname === '/api/ping') { lastPing = Date.now(); everPinged = true; return sendJson(res, 200, { ok: true }); }
  if (pathname === '/api/info' && m === 'GET') return sendJson(res, 200, { version: VERSION, dataFile: STORE_FILE, node: process.version });
  if (pathname === '/api/store' && m === 'GET') {
    const data = readStore();
    // Collections linked to a folder are refreshed from disk (e.g. after git pull).
    for (const col of data.collections || []) {
      if (!col.fsPath) continue;
      try {
        if (fsSync.inspectDir(col.fsPath) === 'bruno') fsSync.mergeFromDisk(col, fsSync.readCollectionDir(col.fsPath));
        col.fsError = fsSync.inspectDir(col.fsPath) === 'bruno' ? null : 'Folder tidak ditemukan atau bukan koleksi Bruno lagi.';
      } catch (e) { col.fsError = e.message; }
    }
    return sendJson(res, 200, data);
  }
  if (pathname === '/api/store' && m === 'PUT') {
    const data = await readJson(req);
    if (!data || !Array.isArray(data.collections)) return sendJson(res, 400, { error: 'Format store tidak valid' });
    const fsErrors = {};
    for (const col of data.collections) {
      if (!col.fsPath) continue;
      try { fsSync.writeCollectionDir(col); col.fsError = null; } catch (e) { col.fsError = e.message; fsErrors[col.id] = e.message; }
    }
    writeStore(data);
    return sendJson(res, 200, { ok: true, fsErrors });
  }
  if (pathname === '/api/fs/pick' && m === 'POST') {
    if (!electron || !electron.dialog) return sendJson(res, 200, { unsupported: true });
    const { title } = await readJson(req);
    const win = electron.BrowserWindow.getFocusedWindow() || electron.BrowserWindow.getAllWindows()[0];
    const r = await electron.dialog.showOpenDialog(win, { title: title || 'Pilih folder', properties: ['openDirectory', 'createDirectory'] });
    return sendJson(res, 200, { dir: r.canceled ? null : r.filePaths[0] });
  }
  if (pathname === '/api/fs/save-as' && m === 'POST') {
    const { collection, dir } = await readJson(req);
    if (!collection || !dir || !path.isAbsolute(dir)) return sendJson(res, 400, { error: 'Path folder harus absolut, mis. C:\projects\api-tests' });
    let target = path.resolve(dir);
    let kind = fsSync.inspectDir(target);
    if (kind === 'bruno') return sendJson(res, 409, { error: 'Folder ini sudah berisi koleksi Bruno. Gunakan "Buka folder koleksi" untuk membukanya.' });
    if (kind === 'file') return sendJson(res, 400, { error: 'Path tersebut adalah file, bukan folder.' });
    if (kind === 'other') {
      target = path.join(target, safeName(collection.name));
      kind = fsSync.inspectDir(target);
      if (kind === 'bruno') return sendJson(res, 409, { error: `Sudah ada koleksi Bruno di ${target}. Gunakan "Buka folder koleksi".` });
      if (kind === 'other' || kind === 'file') return sendJson(res, 409, { error: `Folder ${target} sudah berisi file lain. Pilih folder kosong.` });
    }
    collection.fsPath = target;
    const stat = fsSync.writeCollectionDir(collection);
    return sendJson(res, 200, { dir: target, collection, ...stat });
  }
  if (pathname === '/api/fs/open' && m === 'POST') {
    const { dir } = await readJson(req);
    if (!dir || !path.isAbsolute(dir)) return sendJson(res, 400, { error: 'Path folder harus absolut.' });
    try {
      const col = fsSync.readCollectionDir(path.resolve(dir));
      col.fsPath = path.resolve(dir);
      return sendJson(res, 200, { collection: col });
    } catch (e) { return sendJson(res, 400, { error: e.message }); }
  }
  if (pathname === '/api/fs/reload' && m === 'POST') {
    const { collection } = await readJson(req);
    try {
      fsSync.mergeFromDisk(collection, fsSync.readCollectionDir(collection.fsPath));
      collection.fsError = null;
      return sendJson(res, 200, { collection });
    } catch (e) { return sendJson(res, 400, { error: e.message }); }
  }
  // ---- version, changelog & update check (GitHub Releases)
  if (pathname === '/api/changelog' && m === 'GET') return sendJson(res, 200, { current: updates.CURRENT, repo: updates.REPO, entries: updates.readChangelog() });
  if (pathname === '/api/update/check' && m === 'POST') {
    const { force } = await readJson(req);
    return sendJson(res, 200, await updates.check({ force: !!force }));
  }
  // ---- AI providers (keys stay in this process; the page only sees whether a key exists)
  if (pathname === '/api/ai/config' && m === 'GET') return sendJson(res, 200, ai.publicConfig(DATA_DIR));
  if (pathname === '/api/ai/config' && m === 'PUT') {
    try { return sendJson(res, 200, ai.updateConfig(DATA_DIR, await readJson(req))); } catch (e) { return sendJson(res, 400, { error: e.message }); }
  }
  if (pathname === '/api/ai/models' && m === 'POST') {
    const { provider, key, baseUrl } = await readJson(req);
    try { return sendJson(res, 200, { models: await ai.listModels(DATA_DIR, provider, { key, baseUrl }) }); } catch (e) { return sendJson(res, 400, { error: e.message }); }
  }
  if (pathname === '/api/ai/stream' && m === 'POST') {
    // NDJSON stream: one JSON object per line (delta / notice / status / done / error).
    const body = await readJson(req);
    const ctrl = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no' });
    const emit = (o) => { if (!res.writableEnded) res.write(JSON.stringify(o) + '\n'); };
    try { emit({ t: 'done', ...(await ai.chatStream(DATA_DIR, body, emit, ctrl.signal)) }); } catch (e) { emit({ t: 'error', error: e.message }); }
    return res.end();
  }
  if (pathname === '/api/ai/chat' && m === 'POST') {
    const body = await readJson(req);
    try { return sendJson(res, 200, await ai.chat(DATA_DIR, body)); } catch (e) { return sendJson(res, 400, { error: e.message }); }
  }
  // ---- live connection to the API project under development
  if (pathname === '/api/live/discover' && m === 'POST') {
    const { url, dir } = await readJson(req);
    try {
      if (dir) return sendJson(res, 200, liveSync.discoverDir(path.resolve(dir)));
      return sendJson(res, 200, await liveSync.discoverUrl(String(url || '').trim()));
    } catch (e) { return sendJson(res, 400, { error: e.message }); }
  }
  if (pathname === '/api/live/connect' && m === 'POST') {
    const { type, location, devUrl } = await readJson(req);
    try {
      const live = { type: type === 'file' ? 'file' : 'url', location };
      const { text, hash } = await liveSync.fetchSpec(live);
      const [col] = importers.parseText(text);
      // Point {{baseUrl}} at the running dev server when the spec only has a relative server ("/" or "/api").
      const base = (col.vars || []).find((v) => v.key === 'baseUrl');
      let origin = devUrl ? String(devUrl).replace(/\/+$/, '') : '';
      if (!origin && live.type === 'url') origin = new URL(location).origin;
      if (base && origin && !/^https?:\/\//i.test(base.value)) base.value = origin + (base.value || '').replace(/\/$/, '');
      if (base && origin) {
        const env = { id: require('crypto').randomUUID(), name: 'Local', vars: [{ key: 'baseUrl', value: base.value, enabled: true }] };
        col.environments = [env, ...(col.environments || [])];
        col.activeEnvId = env.id;
      }
      col.live = { ...live, devUrl: origin || null, auto: true, intervalSec: 5, lastHash: hash, lastCheck: Date.now(), lastChange: Date.now(), lastError: null };
      return sendJson(res, 200, { collection: col });
    } catch (e) { return sendJson(res, 400, { error: e.message }); }
  }
  if (pathname === '/api/live/check' && m === 'POST') {
    const { live } = await readJson(req);
    try { const { hash } = await liveSync.fetchSpec(live); return sendJson(res, 200, { hash }); } catch (e) { return sendJson(res, 200, { error: e.message }); }
  }
  if (pathname === '/api/live/sync' && m === 'POST') {
    const { collection } = await readJson(req);
    try {
      const { text, hash } = await liveSync.fetchSpec(collection.live);
      const [fresh] = importers.parseText(text);
      const { col, diff } = liveSync.mergeSpec(collection, fresh);
      col.live = { ...col.live, lastHash: hash, lastCheck: Date.now(), lastChange: Date.now(), lastError: null, lastDiff: { at: Date.now(), added: diff.added.length, changed: diff.changed.length, removed: diff.removed.length, restored: diff.restored.length } };
      return sendJson(res, 200, { collection: col, diff });
    } catch (e) { return sendJson(res, 400, { error: e.message }); }
  }
  if (pathname === '/api/fs/reveal' && m === 'POST') {
    const { dir } = await readJson(req);
    if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return sendJson(res, 400, { error: 'Folder tidak ditemukan' });
    if (electron && electron.shell) { await electron.shell.openPath(dir); return sendJson(res, 200, { ok: true }); }
    const { spawn } = require('child_process');
    const cmd = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    try { spawn(cmd, [dir], { detached: true, stdio: 'ignore' }).unref(); } catch {}
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/history' && m === 'GET') {
    return sendJson(res, 200, readHistory().map(({ request, response, logs, ...summary }) => summary));
  }
  if (pathname.startsWith('/api/history/') && m === 'GET') {
    const e = readHistory().find((x) => x.id === decodeURIComponent(pathname.slice(13)));
    return e ? sendJson(res, 200, e) : sendJson(res, 404, { error: 'Entri history tidak ditemukan' });
  }
  if (pathname === '/api/history' && m === 'POST') {
    const entry = await readJson(req);
    const list = readHistory();
    list.unshift(trimHistoryEntry(entry));
    writeHistory(list.slice(0, HISTORY_MAX));
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/history' && m === 'DELETE') {
    writeHistory([]);
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/send' && m === 'POST') {
    const o = await readJson(req);
    const holder = {};
    res.on('close', () => { if (!res.writableEnded && holder.req) holder.req.destroy(new Error('Dibatalkan')); });
    try {
      return sendJson(res, 200, await sendHttp(o, holder));
    } catch (e) {
      return sendJson(res, 200, { error: e.message, code: e.code || null });
    }
  }
  if (pathname === '/api/import-url' && m === 'POST') {
    const { url } = await readJson(req);
    try {
      const collections = await importers.fromUrl(String(url || '').trim());
      return sendJson(res, 200, { collections });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }
  if (pathname === '/api/parse' && m === 'POST') {
    const body = await readJson(req);
    try {
      const collections = body.files ? importers.filesToCollections(body.files) : importers.parseText(body.text || '');
      return sendJson(res, 200, { collections });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }
  if (pathname === '/api/export' && m === 'POST') {
    const { collection, format = 'bruno', options = {} } = await readJson(req);
    try {
      return sendJson(res, 200, require('./lib/exporters').exportCollection(collection, format, options));
    } catch (e) { return sendJson(res, 400, { error: e.message }); }
  }
  return sendJson(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  try {
    if (!allowedHost(req.headers.host || '')) { res.writeHead(421, { 'Content-Type': 'text/plain' }); return res.end('Host tidak diizinkan'); }
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, pathname);
  } catch (e) {
    if (!res.headersSent) sendJson(res, e.status || 500, { error: e.message });
    else res.end();
  }
});

function openApp(url) {
  if (args.has('--no-open')) return;
  const { spawn } = require('child_process');
  const run = (cmd, a) => { try { spawn(cmd, a, { detached: true, stdio: 'ignore' }).unref(); return true; } catch { return false; } };
  if (process.platform === 'win32') {
    if (!args.has('--browser')) {
      const candidates = [
        path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
        path.join(process.env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe'),
        path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
      ];
      const exe = candidates.find((p) => p && fs.existsSync(p));
      if (exe && run(exe, [`--app=${url}`, '--window-size=1440,900'])) return;
    }
    run('cmd', ['/c', 'start', '', url]);
  } else if (process.platform === 'darwin') {
    run('open', [url]);
  } else {
    run('xdg-open', [url]);
  }
}

/** Starts the local server (also used by the Electron shell). Resolves with { url, port, dataFile }. */
function start({ port = START_PORT } = {}) {
  return new Promise((resolve, reject) => {
    PORT = port;
    const tryListen = () => {
      const onError = (e) => {
        if (e.code === 'EADDRINUSE' && PORT < port + 20) { PORT++; tryListen(); } else reject(e);
      };
      server.once('error', onError);
      server.listen(PORT, HOST, () => {
        server.removeListener('error', onError);
        readStore();
        resolve({ url: `http://${HOST}:${PORT}/`, port: PORT, dataFile: STORE_FILE });
      });
    };
    tryListen();
  });
}

module.exports = { start, VERSION };

if (require.main === module) {
  if (args.has('--auto-exit')) {
    setInterval(() => {
      const idle = Date.now() - lastPing;
      if ((everPinged && idle > 3 * 60 * 1000) || (!everPinged && idle > 5 * 60 * 1000)) process.exit(0);
    }, 30 * 1000).unref();
  }
  start().then(({ url }) => {
    console.log(`\n  Ringan API ${VERSION} berjalan di ${url}`);
    console.log(`  Data: ${STORE_FILE}`);
    console.log('  Tekan Ctrl+C untuk berhenti.\n');
    openApp(url);
  }, (e) => { console.error(e.message); process.exit(1); });
}
