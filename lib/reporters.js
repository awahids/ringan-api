'use strict';
// Report writers for the CLI runner: JSON, JUnit XML (for CI), and a standalone HTML page.

const xml = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const html = xml;

/** summary: { collection, env, startedAt, durationMs, results: [{ name, path, method, url, status, timeMs, ok, skipped, error, tests: [] }] } */
function toJson(summary) {
  return JSON.stringify(summary, null, 2);
}

function toJunit(summary) {
  const cases = [];
  let failures = 0;
  let tests = 0;
  for (const r of summary.results) {
    const cls = xml([summary.collection, ...r.path].join('.'));
    const t = (r.timeMs || 0) / 1000;
    if (r.skipped) {
      tests++;
      cases.push(`    <testcase classname="${cls}" name="${xml(r.name)}" time="0"><skipped/></testcase>`);
      continue;
    }
    if (r.error) {
      tests++; failures++;
      cases.push(`    <testcase classname="${cls}" name="${xml(r.name)}" time="${t}"><failure message="${xml(r.error)}">${xml(`${r.method} ${r.url}\n${r.error}`)}</failure></testcase>`);
      continue;
    }
    const list = r.tests.length ? r.tests : [{ name: `${r.method} ${r.status}`, passed: true }];
    for (const tc of list) {
      tests++;
      if (tc.passed) cases.push(`    <testcase classname="${cls}.${xml(r.name)}" name="${xml(tc.name)}" time="${t}"/>`);
      else { failures++; cases.push(`    <testcase classname="${cls}.${xml(r.name)}" name="${xml(tc.name)}" time="${t}"><failure message="${xml(tc.error || 'failed')}">${xml(`${r.method} ${r.url} -> ${r.status}\n${tc.error || ''}`)}</failure></testcase>`); }
    }
    if (r.scriptError) { tests++; failures++; cases.push(`    <testcase classname="${cls}.${xml(r.name)}" name="script" time="0"><failure message="${xml(r.scriptError)}"/></testcase>`); }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="${xml(summary.collection)}" tests="${tests}" failures="${failures}" time="${summary.durationMs / 1000}">
  <testsuite name="${xml(summary.collection)}${summary.env ? ' [' + xml(summary.env) + ']' : ''}" tests="${tests}" failures="${failures}" time="${summary.durationMs / 1000}" timestamp="${xml(summary.startedAt)}">
${cases.join('\n')}
  </testsuite>
</testsuites>
`;
}

function toHtml(summary) {
  const passed = summary.results.filter((r) => r.ok).length;
  const failed = summary.results.filter((r) => !r.ok && !r.skipped).length;
  const tTotal = summary.results.reduce((n, r) => n + r.tests.length, 0);
  const tPass = summary.results.reduce((n, r) => n + r.tests.filter((t) => t.passed).length, 0);
  const rows = summary.results.map((r) => `
    <details class="r ${r.skipped ? 'skip' : r.ok ? 'ok' : 'fail'}"${r.ok ? '' : ' open'}>
      <summary><span class="ic">${r.skipped ? '–' : r.ok ? '✓' : '✗'}</span><span class="m">${html(r.method)}</span><span class="n">${html([...r.path, r.name].join(' / '))}</span><span class="s">${r.status ?? ''}</span><span class="t">${r.timeMs != null ? Math.round(r.timeMs) + ' ms' : ''}</span><span class="c">${r.tests.length ? `${r.tests.filter((t) => t.passed).length}/${r.tests.length}` : ''}</span></summary>
      <div class="d">
        <div class="u">${html(r.method)} ${html(r.url || '')}</div>
        ${r.error ? `<div class="e">${html(r.error)}</div>` : ''}
        ${r.scriptError ? `<div class="e">${html(r.scriptError)}</div>` : ''}
        <ul>${r.tests.map((t) => `<li class="${t.passed ? 'ok' : 'fail'}">${t.passed ? '✓' : '✗'} ${html(t.name)}${t.error ? `<div class="e">${html(t.error)}</div>` : ''}</li>`).join('')}</ul>
      </div>
    </details>`).join('');
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Laporan ${html(summary.collection)}</title>
<style>
:root{--bg:#fff;--fg:#1c2026;--mut:#6b7280;--line:#e5e7eb;--ok:#15803d;--bad:#dc2626;--soft:#f6f7f9}
@media (prefers-color-scheme:dark){:root{--bg:#15171c;--fg:#e5e7eb;--mut:#9aa3b2;--line:#2c313b;--ok:#4ade80;--bad:#f87171;--soft:#1b1e24}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 "Segoe UI",system-ui,sans-serif}
main{max-width:1000px;margin:0 auto;padding:24px 16px}
h1{font-size:20px;margin:0 0 4px}.mut{color:var(--mut)}
.stats{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}.st{border:1px solid var(--line);border-radius:8px;padding:8px 14px;background:var(--soft)}.st b{display:block;font-size:20px}
.ok b,.r.ok .ic{color:var(--ok)}.fail b,.r.fail .ic{color:var(--bad)}
details.r{border-bottom:1px solid var(--line)}summary{display:grid;grid-template-columns:20px 64px 1fr 50px 70px 50px;gap:8px;padding:8px 4px;cursor:pointer;align-items:center}
.m{font-weight:700;font-size:12px}.n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.s,.t,.c{color:var(--mut);text-align:right}
.d{padding:0 8px 12px 32px}.u{font-family:Consolas,monospace;font-size:12px;color:var(--mut);word-break:break-all}.e{color:var(--bad);font-family:Consolas,monospace;font-size:12px;white-space:pre-wrap}
ul{list-style:none;padding:0;margin:8px 0 0}li{padding:3px 0}li.ok{color:var(--ok)}li.fail{color:var(--bad)}
@media (max-width:600px){summary{grid-template-columns:20px 50px 1fr 40px}.t,.c{display:none}}
</style></head><body><main>
<h1>${html(summary.collection)}</h1>
<div class="mut">Environment: ${html(summary.env || '-')} · ${html(new Date(summary.startedAt).toLocaleString())} · durasi ${(summary.durationMs / 1000).toFixed(2)} s</div>
<div class="stats"><div class="st ok"><b>${passed}</b>request lulus</div><div class="st fail"><b>${failed}</b>request gagal</div><div class="st"><b>${tPass}/${tTotal}</b>test lulus</div></div>
${rows}
</main></body></html>
`;
}

module.exports = { toJson, toJunit, toHtml };
