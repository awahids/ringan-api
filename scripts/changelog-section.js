#!/usr/bin/env node
'use strict';
// Prints the CHANGELOG.md section of one version (used as GitHub Release notes).
//   node scripts/changelog-section.js 1.1.0
const fs = require('fs');
const path = require('path');
const { parseChangelog } = require('../lib/updates');

const version = String(process.argv[2] || '').replace(/^v/, '');
const entries = parseChangelog(fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8'));
const entry = entries.find((e) => e.version === version);
if (!entry || !entry.body) {
  console.error(`Tidak ada catatan untuk versi ${version} di CHANGELOG.md`);
  process.exit(1);
}
process.stdout.write(entry.body + '\n');
