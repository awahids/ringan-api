#!/usr/bin/env node
'use strict';
/*
 * Ringan API CLI runner.
 *
 *   ringan run <source> [options]
 *   ringan list
 *
 * <source> can be:
 *   - a folder with a Bruno collection (.bru files + bruno.json), e.g. a folder saved from the app
 *   - a file: Bruno/Postman/OpenAPI JSON, OpenAPI YAML, or a single .bru request
 *   - a link (GitHub repo/folder, raw JSON/YAML URL) - same as the app's "Import dari link"
 *   - the name of a collection saved in the app
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const importers = require('../lib/importers');
const { sendHttp } = require('../lib/http');
const { NodeSandbox } = require('../lib/node-sandbox');
const reporters = require('../lib/reporters');
const E = require('../public/engine');
const VERSION = require('../package.json').version;

const HELP = `Ringan API CLI ${VERSION}

Pemakaian:
  ringan run <sumber> [opsi]     Jalankan semua request dalam koleksi
  ringan export <sumber> [opsi]  Export koleksi ke Postman / OpenAPI 3 / Bruno JSON / dokumentasi HTML
  ringan list                    Tampilkan koleksi yang tersimpan di aplikasi

<sumber>: folder koleksi Bruno, file JSON/YAML/.bru, link, atau nama koleksi di aplikasi.

Opsi run:
  -e, --env <nama>               Environment yang dipakai
      --env-var <key=value>      Set/override variabel environment (boleh berulang)
  -f, --folder <path>            Hanya jalankan folder tertentu, mis. "Users/Admin"
  -s, --scenario <nama>          Jalankan skenario (alur berurutan) yang dibuat di aplikasi
  -r, --reporter <list>          cli,json,junit,html (default: cli). Boleh dipisah koma
  -o, --output <dir>             Folder laporan (default: ./ringan-reports)
      --bail                     Berhenti di request pertama yang gagal
      --delay <ms>               Jeda antar request
      --timeout <ms>             Timeout per request (default 30000)
      --insecure                 Jangan verifikasi sertifikat TLS
      --no-redirect              Jangan ikuti redirect
      --store <file>             Lokasi store.json aplikasi (default: dicari otomatis)
      --collection <nama>        Pilih koleksi jika sumber berisi lebih dari satu
  -q, --quiet                    Hanya tampilkan ringkasan

Opsi export:
  -t, --format <f>               postman | openapi | openapi-yaml | bruno | html (default: postman)
  -o, --output <file|dir>        File tujuan, atau folder (nama file otomatis). Default: folder saat ini
  -e, --env <nama>               Environment untuk nilai server/contoh (OpenAPI) atau variabel (Postman)

Contoh:
  ringan run ./api-tests -e dev --scenario "Login lalu buat order"
  ringan export ./api-tests -t openapi-yaml -o openapi.yaml
  ringan export "Nama Koleksi" -t postman -o ./exports
  ringan export ./api-tests -t html -o docs.html

Exit code: 0 jika semua lulus, 1 jika ada yang gagal, 2 jika error pemakaian.
`;

function parseArgs(argv) {
  const o = { _: [], envVars: [], reporters: ['cli'] };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let val;
    const m = /^(--[\w-]+)=(.*)$/s.exec(a);
    if (m) { a = m[1]; val = m[2]; }
    const next = () => (val !== undefined ? val : argv[++i]);
    switch (a) {
      case '-e': case '--env': o.env = next(); break;
      case '--env-var': o.envVars.push(next()); break;
      case '-f': case '--folder': o.folder = next(); break;
      case '-s': case '--scenario': o.scenario = next(); break;
      case '-r': case '--reporter': o.reporters = String(next()).split(',').map((s) => s.trim()).filter(Boolean); break;
      case '-o': case '--output': o.output = next(); break;
      case '--bail': o.bail = true; break;
      case '--delay': o.delay = Number(next()) || 0; break;
      case '--timeout': o.timeout = Number(next()) || 30000; break;
      case '--insecure': o.insecure = true; break;
      case '--no-redirect': o.noRedirect = true; break;
      case '--store': o.store = next(); break;
      case '--collection': o.collection = next(); break;
      case '-q': case '--quiet': o.quiet = true; break;
      case '-t': case '--format': o.format = next(); break;
      case '-h': case '--help': o.help = true; break;
      case '-v': case '--version': o.version = true; break;
      default: o._.push(a);
    }
  }
  return o;
}

function storeCandidates(explicit) {
  if (explicit) return [explicit];
  const list = [];
  if (process.env.RINGAN_DATA) list.push(path.join(process.env.RINGAN_DATA, 'store.json'));
  list.push(path.join(__dirname, '..', 'data', 'store.json'));
  const home = os.homedir();
  if (process.platform === 'win32') list.push(path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Ringan API', 'data', 'store.json'));
  else if (process.platform === 'darwin') list.push(path.join(home, 'Library', 'Application Support', 'Ringan API', 'data', 'store.json'));
  else list.push(path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Ringan API', 'data', 'store.json'));
  return list;
}

function loadStores(explicit) {
  const out = [];
  for (const f of storeCandidates(explicit)) {
    try { out.push({ file: f, data: JSON.parse(fs.readFileSync(f, 'utf8')) }); } catch {}
  }
  return out;
}

function readTree(dir) {
  const files = [];
  (function walk(d, rel) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      const p = path.join(d, ent.name);
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(p, r);
      else if (/\.(bru|json|ya?ml)$/i.test(ent.name)) files.push({ path: r, content: fs.readFileSync(p, 'utf8') });
    }
  })(dir, '');
  return files;
}

async function loadCollections(src, opts) {
  if (/^https?:\/\//i.test(src)) return { cols: await importers.fromUrl(src), from: 'link' };
  if (fs.existsSync(src)) {
    const st = fs.statSync(src);
    if (st.isDirectory()) return { cols: importers.filesToCollections(readTree(src)), from: 'folder' };
    const text = fs.readFileSync(src, 'utf8');
    if (src.endsWith('.bru')) return { cols: importers.filesToCollections([{ path: path.basename(src), content: text }]), from: 'file' };
    return { cols: importers.parseText(text), from: 'file' };
  }
  for (const s of loadStores(opts.store)) {
    const c = (s.data.collections || []).find((x) => x.name.toLowerCase() === src.toLowerCase());
    if (c) return { cols: [c], from: `aplikasi (${s.file})` };
  }
  throw new Error(`Sumber "${src}" tidak ditemukan: bukan folder/file/link, dan tidak ada koleksi dengan nama itu di aplikasi. Jalankan "ringan list" untuk melihat koleksi.`);
}

function findFolder(col, folderPath) {
  const parts = folderPath.split('/').map((s) => s.trim()).filter(Boolean);
  let items = col.items;
  let found = null;
  for (const p of parts) {
    found = items.find((x) => x.type === 'folder' && x.name.toLowerCase() === p.toLowerCase());
    if (!found) throw new Error(`Folder "${folderPath}" tidak ditemukan di koleksi "${col.name}"`);
    items = found.items;
  }
  return found;
}

const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m` }
  : { g: (s) => s, r: (s) => s, y: (s) => s, d: (s) => s, b: (s) => s };

async function runCollection(col, opts, sandbox) {
  // Environment selection and overrides.
  col.environments = col.environments || [];
  if (opts.env) {
    const env = col.environments.find((e) => e.name.toLowerCase() === opts.env.toLowerCase());
    if (!env) throw new Error(`Environment "${opts.env}" tidak ada di koleksi "${col.name}". Tersedia: ${col.environments.map((e) => e.name).join(', ') || '(tidak ada)'}`);
    col.activeEnvId = env.id;
  } else if (!opts.envVars.length) {
    col.activeEnvId = null;
  }
  if (opts.envVars.length) {
    let env = E.activeEnv(col);
    if (!env) { env = { id: 'cli-env', name: 'cli', vars: [] }; col.environments.push(env); col.activeEnvId = env.id; }
    for (const pair of opts.envVars) {
      const i = pair.indexOf('=');
      if (i < 1) throw new Error(`--env-var harus berbentuk key=value (dapat: ${pair})`);
      const k = pair.slice(0, i);
      const v = pair.slice(i + 1);
      const row = env.vars.find((x) => x.key === k);
      if (row) { row.value = v; row.enabled = true; } else env.vars.push(E.kv(k, v));
    }
  }
  const env = E.activeEnv(col);
  let scn = null;
  if (opts.scenario) {
    const all = col.scenarios || [];
    scn = all.find((x) => x.name.toLowerCase() === opts.scenario.toLowerCase());
    if (!scn) throw new Error(`Skenario "${opts.scenario}" tidak ada di koleksi "${col.name}". Tersedia: ${all.map((x) => x.name).join(', ') || '(belum ada skenario)'}`);
  }
  const folder = opts.folder && !scn ? findFolder(col, opts.folder) : null;
  const list = scn ? [] : E.runList(col, folder);
  const ctx = {
    send: (payload) => sendHttp(payload, {}).catch((e) => ({ error: e.message })),
    sandbox: (job) => sandbox.run(job),
    settings: { timeoutMs: opts.timeout || 30000, verifyTls: !opts.insecure, followRedirects: !opts.noRedirect },
    runtime: {},
  };
  const summary = { collection: scn ? `${col.name} — ${scn.name}` : col.name, env: env ? env.name : null, startedAt: new Date().toISOString(), durationMs: 0, results: [] };
  const t0 = Date.now();
  const head = scn ? C.d(`  [skenario: ${scn.name}]  ${scn.steps.length} langkah`) : `${folder ? C.d(`  [folder: ${opts.folder}]`) : ''}  ${C.d(`${list.length} request`)}`;
  if (!opts.quiet) console.log(`\n${C.b(col.name)}${env ? C.d(`  [env: ${env.name}]`) : ''}${head}\n`);

  const ancOf = new Map();
  E.eachRequest(col.items || [], (it, anc) => ancOf.set(it.id, anc));
  const onResult = (item, anc, r) => {
      const ok = E.resultOk(r);
      const rec = {
        name: item.name,
        path: anc.map((a) => a.name),
        method: item.method,
        url: r.request ? r.request.url : item.url,
        status: r.response ? r.response.status : null,
        timeMs: r.response ? r.response.timeMs : null,
        ok: !!ok,
        skipped: !!r.skipped,
        error: r.error || null,
        scriptError: r.scriptError || null,
        unresolved: r.unresolved || [],
        tests: (r.tests || []).map((t) => ({ name: t.name, passed: !!t.passed, error: t.error || null, kind: t.kind })),
      };
      summary.results.push(rec);
      if (opts.quiet) return;
      const icon = rec.skipped ? C.d('–') : ok ? C.g('✓') : C.r('✗');
      const st = rec.status == null ? C.r('ERR') : rec.status < 400 ? C.g(String(rec.status)) : C.r(String(rec.status));
      const t = rec.timeMs != null ? C.d(`${Math.round(rec.timeMs)} ms`) : '';
      const tc = rec.tests.length ? C.d(`  ${rec.tests.filter((x) => x.passed).length}/${rec.tests.length} test`) : '';
      console.log(`  ${icon} ${rec.method.padEnd(6)} ${[...rec.path, rec.name].join(' / ')}  ${st}  ${t}${tc}`);
      if (rec.error) console.log(C.r(`      ${rec.error}`));
      if (rec.scriptError) console.log(C.r(`      ${rec.scriptError}`));
      if (rec.unresolved.length) console.log(C.y(`      variabel tidak ditemukan: ${rec.unresolved.join(', ')}`));
      for (const x of rec.tests) if (!x.passed) console.log(C.r(`      ✗ ${x.name}`) + (x.error ? C.d(`\n        ${String(x.error).replace(/\n/g, '\n        ')}`) : ''));
      if (!opts.quiet && r.extracted) for (const x of r.extracted) console.log(x.ok ? C.d(`      → {{${x.var}}} = ${JSON.stringify(x.value).slice(0, 80)}`) : C.r(`      ✗ {{${x.var}}} tidak ditemukan (${x.from} ${x.path || ''})`));
  };
  if (scn) {
    await E.runScenario(scn, col, ctx, {
      onStep: (i, sr) => {
        const item = sr.item || (ancOf.has(sr.step.reqId) ? null : { name: `Langkah ${i + 1} (request tidak ditemukan)`, method: '?', url: '' });
        let real = item;
        if (!real) E.eachRequest(col.items || [], (it) => { if (it.id === sr.step.reqId) real = it; });
        const r = sr.skipped ? { skipped: true, tests: [], logs: [] } : Object.assign(sr.result || {}, { extracted: sr.extracted });
        onResult(real, ancOf.get(sr.step.reqId) || [], r);
      },
    });
  } else {
    await E.runAll(list, col, ctx, { delayMs: opts.delay || 0, bail: !!opts.bail, onResult: (i, entry, r) => onResult(entry.item, entry.anc, r) });
  }
  summary.durationMs = Date.now() - t0;
  return summary;
}

function printSummary(s) {
  const reqOk = s.results.filter((r) => r.ok).length;
  const reqFail = s.results.filter((r) => !r.ok && !r.skipped).length;
  const tTotal = s.results.reduce((n, r) => n + r.tests.length, 0);
  const tPass = s.results.reduce((n, r) => n + r.tests.filter((t) => t.passed).length, 0);
  console.log(`\n  Request: ${C.g(reqOk + ' lulus')}, ${reqFail ? C.r(reqFail + ' gagal') : '0 gagal'}   Test: ${tPass}/${tTotal}   Durasi: ${(s.durationMs / 1000).toFixed(2)} s`);
  return reqFail === 0;
}

function writeReports(summaries, opts) {
  const kinds = opts.reporters.filter((r) => r !== 'cli');
  if (!kinds.length) return;
  const dir = path.resolve(opts.output || 'ringan-reports');
  fs.mkdirSync(dir, { recursive: true });
  for (const s of summaries) {
    const base = s.collection.replace(/[\\/:*?"<>|\s]+/g, '_');
    for (const k of kinds) {
      let file;
      if (k === 'json') { file = path.join(dir, `${base}.json`); fs.writeFileSync(file, reporters.toJson(s)); }
      else if (k === 'junit') { file = path.join(dir, `${base}.junit.xml`); fs.writeFileSync(file, reporters.toJunit(s)); }
      else if (k === 'html') { file = path.join(dir, `${base}.html`); fs.writeFileSync(file, reporters.toHtml(s)); }
      else { console.error(`Reporter tidak dikenal: ${k}`); continue; }
      console.log(C.d(`  Laporan ${k}: ${file}`));
    }
  }
}

async function exportCmd(src, opts) {
  const { exportCollection } = require('../lib/exporters');
  let { cols } = await loadCollections(src, opts);
  if (opts.collection) cols = cols.filter((c) => c.name.toLowerCase() === opts.collection.toLowerCase());
  if (!cols.length) throw new Error('Tidak ada koleksi untuk di-export.');
  const format = opts.format || 'postman';
  for (const col of cols) {
    if (opts.env) {
      const env = (col.environments || []).find((e) => e.name.toLowerCase() === opts.env.toLowerCase());
      if (!env) throw new Error(`Environment "${opts.env}" tidak ada di koleksi "${col.name}".`);
      col.activeEnvId = env.id;
    }
    const out = exportCollection(col, format, { includeEnv: true });
    let file = path.resolve(opts.output || out.filename);
    if ((opts.output && fs.existsSync(file) && fs.statSync(file).isDirectory()) || cols.length > 1) {
      const dir = opts.output ? path.resolve(opts.output) : process.cwd();
      fs.mkdirSync(dir, { recursive: true });
      file = path.join(dir, out.filename);
    }
    fs.writeFileSync(file, out.content);
    console.log(`${C.g('✓')} ${col.name} -> ${file}`);
    for (const w of out.warnings) console.log(C.y(`  • ${w}`));
  }
  return 0;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.version) { console.log(VERSION); return 0; }
  const [cmd, src] = opts._;
  if (opts.help || !cmd) { console.log(HELP); return cmd ? 0 : 2; }
  if (cmd === 'list') {
    const stores = loadStores(opts.store);
    if (!stores.length) { console.log('Tidak ada data aplikasi yang ditemukan.'); return 0; }
    for (const s of stores) {
      console.log(C.d(s.file));
      for (const c of s.data.collections || []) {
        let n = 0;
        E.eachRequest(c.items || [], () => n++);
        console.log(`  ${c.name}  ${C.d(`${n} request · env: ${(c.environments || []).map((e) => e.name).join(', ') || '-'}${c.fsPath ? ' · folder: ' + c.fsPath : ''}`)}`);
      }
    }
    return 0;
  }
  if (cmd === 'export' && src) return exportCmd(src, opts);
  if (cmd !== 'run' || !src) { console.error(HELP); return 2; }

  let { cols } = await loadCollections(src, opts);
  if (opts.collection) cols = cols.filter((c) => c.name.toLowerCase() === opts.collection.toLowerCase());
  if (!cols.length) throw new Error('Tidak ada koleksi untuk dijalankan.');
  const sandbox = new NodeSandbox({ timeoutMs: 10000 });
  const summaries = [];
  let allOk = true;
  try {
    for (const col of cols) {
      const s = await runCollection(col, opts, sandbox);
      summaries.push(s);
      if (!printSummary(s)) allOk = false;
    }
  } finally {
    sandbox.close();
  }
  writeReports(summaries, opts);
  console.log('');
  return allOk ? 0 : 1;
}

main().then((code) => { process.exitCode = code; }, (e) => { console.error(C.r('Error: ' + e.message)); process.exitCode = 2; });
