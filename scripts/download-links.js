#!/usr/bin/env node
'use strict';
/*
 * Builds the "Unduh" (download) table for a version. Used by:
 *  - scripts/release.js   -> refreshes the block between the download markers in README.md
 *  - the release workflow -> appended to the GitHub Release notes
 * File names follow "artifactName" in package.json -> build.
 *   node scripts/download-links.js 1.1.0
 */
const pkg = require('../package.json');

const REPO = (pkg.ringan && pkg.ringan.updateRepo) || 'awahids/ringan-api';
const START = '<!-- download:start -->';
const END = '<!-- download:end -->';

function table(version) {
  const v = String(version).replace(/^v/, '');
  const base = `https://github.com/${REPO}/releases/download/v${v}`;
  const rows = [
    ['Windows', 'Installer (disarankan)', `RinganAPI-Setup-${v}.exe`],
    ['Windows', 'Portable, tanpa install', `RinganAPI-Portable-${v}.exe`],
    ['macOS', 'Apple Silicon (M1/M2/M3/M4)', `RinganAPI-${v}-arm64.dmg`],
    ['macOS', 'Intel', `RinganAPI-${v}-x64.dmg`],
  ];
  return [
    `**Versi terbaru: v${v}** · [catatan rilis](https://github.com/${REPO}/releases/tag/v${v}) · [semua versi](https://github.com/${REPO}/releases)`,
    '',
    '| Sistem | Jenis | Unduh |',
    '|---|---|---|',
    ...rows.map(([os, kind, file]) => `| ${os} | ${kind} | [${file}](${base}/${file}) |`),
    '',
    `Arsip .zip untuk macOS juga tersedia di [halaman rilis](https://github.com/${REPO}/releases/tag/v${v}). Installer belum ditandatangani: di Windows pilih *More info → Run anyway* saat SmartScreen muncul; di macOS buka pertama kali lewat klik kanan → *Open*.`,
  ].join('\n');
}

/** Replaces the block between the markers in a markdown text. */
function updateBlock(markdown, version) {
  const block = `${START}\n${table(version)}\n${END}`;
  if (!markdown.includes(START) || !markdown.includes(END)) throw new Error('Penanda download tidak ditemukan di README.md');
  return markdown.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block);
}

module.exports = { table, updateBlock, START, END };

if (require.main === module) {
  const v = process.argv[2] || pkg.version;
  process.stdout.write(table(v) + '\n');
}
