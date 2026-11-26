#!/usr/bin/env node
'use strict';
/*
 * Prepares a release:  npm run release -- 1.1.0   (or: patch | minor | major)
 *   1. moves the "## [Unreleased]" section of CHANGELOG.md to "## [<version>] - <today>"
 *   2. sets the version in package.json and package-lock.json
 *   3. commits "Rilis v<version>" and creates tag v<version>
 * Then push with:  git push && git push origin v<version>
 * The "Desktop build" workflow builds the installers for that tag and publishes the GitHub Release,
 * which is what the app's update notification reads.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { compareVersions } = require('../lib/updates');

const root = path.join(__dirname, '..');
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const fail = (msg) => { console.error('Gagal: ' + msg); process.exit(1); };

const pkgFile = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
const arg = process.argv[2];
if (!arg) fail('sebutkan versi, mis. "npm run release -- 1.1.0" atau "npm run release -- minor".');

let next = arg.replace(/^v/, '');
const [ma, mi, pa] = pkg.version.split('.').map((n) => parseInt(n, 10));
if (next === 'patch') next = `${ma}.${mi}.${pa + 1}`;
if (next === 'minor') next = `${ma}.${mi + 1}.0`;
if (next === 'major') next = `${ma + 1}.0.0`;
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(next)) fail(`"${arg}" bukan versi yang valid (contoh: 1.2.0).`);
if (compareVersions(next, pkg.version) <= 0) fail(`versi ${next} harus lebih besar dari versi sekarang (${pkg.version}).`);

if (git('status', '--porcelain')) fail('masih ada perubahan yang belum di-commit. Commit atau stash dulu.');
if (git('tag', '--list', `v${next}`)) fail(`tag v${next} sudah ada.`);

const clFile = path.join(root, 'CHANGELOG.md');
let cl = fs.readFileSync(clFile, 'utf8');
const unrel = /^## \[Unreleased\][^\n]*\n([\s\S]*?)(?=^## \[|^\[[^\]]+\]:|(?![\s\S]))/m.exec(cl);
if (!unrel || !unrel[1].trim()) fail('bagian "## [Unreleased]" di CHANGELOG.md kosong. Tulis dulu apa saja yang berubah.');
const today = new Date().toISOString().slice(0, 10);
cl = cl.replace(/^## \[Unreleased\][^\n]*\n/m, `## [Unreleased]\n\n## [${next}] - ${today}\n`);
// Link references at the bottom.
const repo = (pkg.ringan && pkg.ringan.updateRepo) || '';
if (repo) {
  cl = cl.replace(/^\[Unreleased\]:.*$/m, `[Unreleased]: https://github.com/${repo}/compare/v${next}...HEAD`);
  if (!new RegExp(`^\\[${next.replace(/\./g, '\\.')}\\]:`, 'm').test(cl)) {
    cl = cl.replace(/^(\[Unreleased\]:.*)$/m, `$1\n[${next}]: https://github.com/${repo}/compare/v${pkg.version}...v${next}`);
  }
}
fs.writeFileSync(clFile, cl);

const prev = pkg.version;
pkg.version = next;
fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
const lockFile = path.join(root, 'package-lock.json');
if (fs.existsSync(lockFile)) {
  const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  lock.version = next;
  if (lock.packages && lock.packages['']) lock.packages[''].version = next;
  fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n');
}

git('add', 'CHANGELOG.md', 'package.json', 'package-lock.json');
git('commit', '-m', `Rilis v${next}`);
git('tag', '-a', `v${next}`, '-m', `Ringan API v${next}`);
console.log(`Versi ${prev} -> ${next}. Commit dan tag v${next} dibuat.`);
console.log('Untuk menerbitkan rilis (build installer + GitHub Release otomatis):');
console.log(`  git push && git push origin v${next}`);
