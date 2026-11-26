'use strict';
/*
 * Update check & changelog.
 *  - parseChangelog(): reads the bundled CHANGELOG.md into [{ version, date, body }]
 *  - check(): asks GitHub Releases of the configured repo for newer versions and picks the installer
 *    that matches this OS/arch. Results are cached; nothing is sent except a plain GET to api.github.com.
 * The repo comes from package.json -> "ringan".updateRepo (e.g. "awahids/ringan-api").
 */
const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');

const CURRENT = pkg.version;
const REPO = (pkg.ringan && pkg.ringan.updateRepo) || '';
// For tests: point at a mock server that serves /repos/<repo>/releases
const API_BASE = (process.env.RINGAN_UPDATE_API || 'https://api.github.com').replace(/\/+$/, '');
const CACHE_MS = 30 * 60 * 1000;
let cache = { at: 0, data: null };

function parseSemver(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(v || '').trim());
  return m ? { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || '' } : null;
}
/** > 0 if a is newer than b. A pre-release is older than the same version without one. */
function compareVersions(a, b) {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) return 0;
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] - y[k];
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

function parseChangelog(text) {
  const out = [];
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  let curEntry = null;
  for (const line of lines) {
    const m = /^##\s+\[([^\]]+)\](?:\s*-\s*(.+))?\s*$/.exec(line);
    if (m) {
      curEntry = { version: m[1].trim(), date: (m[2] || '').trim() || null, body: [] };
      out.push(curEntry);
      continue;
    }
    if (/^\[[^\]]+\]:\s*https?:\/\//.test(line)) continue; // link references at the bottom
    if (curEntry) curEntry.body.push(line);
  }
  return out.map((e) => ({ ...e, unreleased: /^unreleased$/i.test(e.version), body: e.body.join('\n').trim() }));
}

function readChangelog() {
  try { return parseChangelog(fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8')); } catch { return []; }
}

function runtimeKind() {
  if (!process.versions.electron) return 'node';
  if (process.env.PORTABLE_EXECUTABLE_DIR) return 'portable';
  return process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux';
}

/** Chooses the download that fits how this copy is running. */
function pickAsset(assets) {
  const kind = runtimeKind();
  const by = (re) => assets.find((a) => re.test(a.name));
  if (kind === 'portable') return by(/portable.*\.exe$/i) || by(/\.exe$/i);
  if (kind === 'win') return by(/setup.*\.exe$/i) || by(/\.exe$/i);
  if (kind === 'mac') {
    const arm = process.arch === 'arm64';
    return by(arm ? /arm64.*\.dmg$/i : /x64.*\.dmg$/i) || by(/\.dmg$/i);
  }
  if (kind === 'linux') return by(/\.AppImage$/i);
  return null; // Node version: point to the release page / git pull
}

async function fetchReleases() {
  if (!REPO) throw new Error('Repo update belum diatur (package.json -> ringan.updateRepo).');
  const res = await fetch(`${API_BASE}/repos/${REPO}/releases?per_page=30`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `RinganAPI/${CURRENT}`, 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(15000),
  }).catch((e) => { throw new Error(`Tidak bisa menghubungi GitHub: ${e.cause ? e.cause.code || e.cause.message : e.message}`); });
  if (res.status === 404) return [];
  if (res.status === 403 || res.status === 429) throw new Error('Batas akses GitHub API tercapai, coba lagi nanti.');
  if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
  const list = await res.json();
  return (Array.isArray(list) ? list : [])
    .filter((r) => !r.draft && !r.prerelease && parseSemver(r.tag_name))
    .map((r) => ({
      version: String(r.tag_name).replace(/^v/, ''),
      name: r.name || r.tag_name,
      notes: r.body || '',
      url: r.html_url,
      publishedAt: r.published_at,
      assets: (r.assets || []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
    }))
    .sort((a, b) => compareVersions(b.version, a.version));
}

async function check({ force } = {}) {
  if (!force && cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  const base = { current: CURRENT, repo: REPO, kind: runtimeKind(), checkedAt: Date.now() };
  try {
    const releases = await fetchReleases();
    const newer = releases.filter((r) => compareVersions(r.version, CURRENT) > 0);
    const latest = releases[0] || null;
    const data = {
      ...base,
      latest: latest ? latest.version : null,
      hasUpdate: newer.length > 0,
      newer: newer.map(({ assets, ...r }) => r),
      download: newer.length ? (pickAsset(newer[0].assets) || null) : null,
      releaseUrl: newer.length ? newer[0].url : latest ? latest.url : (REPO ? `https://github.com/${REPO}/releases` : null),
    };
    cache = { at: Date.now(), data };
    return data;
  } catch (e) {
    return { ...base, error: e.message, hasUpdate: false, newer: [] };
  }
}

module.exports = { CURRENT, REPO, check, readChangelog, parseChangelog, compareVersions, pickAsset };
