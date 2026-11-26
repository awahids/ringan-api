'use strict';
/*
 * Builds a single, self-contained HTML page documenting a collection:
 * navigation tree, endpoints with params/headers/body/auth, cURL snippet, example
 * responses (from the last responses sent in the app) and scenarios.
 * Secrets are never written out: literal credentials are masked and secret
 * environment variables are listed without their value.
 */

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const on = (x) => x && x.enabled !== false && x.key;
const SENSITIVE = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|apikey|x-auth-token|x-access-token)$/i;
const SECRET_NAME = /(pass(word)?|secret|token|api[-_]?key|private|credential)/i;
const hasVar = (v) => /\{\{[^{}]+\}\}/.test(String(v || ''));
const mask = (v) => (hasVar(v) || !String(v || '') ? String(v || '') : '••••••');

function slug(s, used) {
  let base = String(s || 'item').toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
  let out = base;
  let i = 2;
  while (used.has(out)) out = `${base}-${i++}`;
  used.add(out);
  return out;
}

/** Very small Markdown subset: headings, lists, code fences, inline code, bold, links. Input is escaped first. */
function md(text) {
  const src = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!src) return '';
  const out = [];
  const parts = src.split(/```/);
  parts.forEach((part, i) => {
    if (i % 2) { out.push(`<pre><code>${esc(part.replace(/^\w*\n/, ''))}</code></pre>`); return; }
    let list = null;
    const flush = () => { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } };
    const inline = (s) => esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    for (const line of part.split('\n')) {
      const hm = /^(#{1,4})\s+(.*)$/.exec(line);
      const lm = /^\s*[-*]\s+(.*)$/.exec(line);
      if (hm) { flush(); out.push(`<h${hm[1].length + 2}>${inline(hm[2])}</h${hm[1].length + 2}>`); }
      else if (lm) { (list = list || []).push(`<li>${inline(lm[1])}</li>`); }
      else if (!line.trim()) { flush(); }
      else { flush(); out.push(`<p>${inline(line)}</p>`); }
    }
    flush();
  });
  return out.join('\n');
}

function authText(a) {
  if (!a) return null;
  switch (a.type) {
    case 'bearer': return `Bearer token: <code>${esc(mask(a.token))}</code>`;
    case 'basic': return `Basic auth: user <code>${esc(hasVar(a.username) ? a.username : a.username || '')}</code>, password <code>${esc(mask(a.password))}</code>`;
    case 'apikey': return `API key di ${a.in === 'query' ? 'query' : 'header'} <code>${esc(a.key || '')}</code> = <code>${esc(mask(a.value))}</code>`;
    case 'none': return 'Tanpa auth';
    case 'inherit': return null;
    default: return esc(a.type);
  }
}

function resolveAuth(col, anc, r) {
  let a = r.auth;
  if (a && a.type !== 'inherit') return a;
  for (const f of [...anc].reverse()) if (f.auth && f.auth.type !== 'inherit') return f.auth;
  return col.auth && col.auth.type !== 'inherit' ? col.auth : null;
}

function table(rows, cols) {
  if (!rows.length) return '';
  return `<table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td>${i === 0 ? `<code>${esc(c)}</code>` : esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function prettyBody(text) {
  const t = String(text == null ? '' : text);
  try { return JSON.stringify(JSON.parse(t), null, 2); } catch { return t; }
}

function curlFor(col, anc, r) {
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const qs = (r.params || []).filter(on).map((p) => `${encodeURIComponent(p.key)}=${p.value}`);
  let url = String(r.url || '').split('?')[0];
  for (const p of r.pathParams || []) if (p.key && p.value) url = url.replace(new RegExp(`:${p.key}(?=/|$)`), p.value);
  if (qs.length) url += '?' + qs.join('&');
  const lines = [`curl -X ${r.method} ${q(url)}`];
  const headers = new Map();
  for (const src of [col.headers, ...anc.map((f) => f.headers), r.headers]) for (const h of (src || []).filter(on)) headers.set(h.key.toLowerCase(), [h.key, SENSITIVE.test(h.key) ? mask(h.value) : h.value]);
  const a = resolveAuth(col, anc, r);
  if (a && a.type === 'bearer') headers.set('authorization', ['Authorization', `Bearer ${mask(a.token)}`]);
  if (a && a.type === 'basic') lines.push(`  -u ${q(`${a.username || ''}:${mask(a.password)}`)}`);
  if (a && a.type === 'apikey' && a.in !== 'query' && a.key) headers.set(a.key.toLowerCase(), [a.key, mask(a.value)]);
  const b = r.body || {};
  if (['json', 'text', 'xml'].includes(b.mode) && !headers.has('content-type')) headers.set('content-type', ['Content-Type', b.mode === 'json' ? 'application/json' : b.mode === 'xml' ? 'application/xml' : 'text/plain']);
  for (const [, [k, v]] of headers) lines.push(`  -H ${q(`${k}: ${v}`)}`);
  if (['json', 'text', 'xml'].includes(b.mode) && String(b.content || '').trim()) lines.push(`  --data ${q(b.content)}`);
  else if (b.mode === 'form') for (const f of (b.form || []).filter(on)) lines.push(`  --data-urlencode ${q(`${f.key}=${f.value}`)}`);
  else if (b.mode === 'multipart') for (const f of (b.form || []).filter(on)) lines.push(`  -F ${q(f.type === 'file' ? `${f.key}=@${f.fileName || 'file'}` : `${f.key}=${f.value}`)}`);
  return lines.join(' \\\n');
}

function toHtmlDocs(col, options = {}) {
  const samples = options.samples || {};
  const used = new Set();
  const env = (col.environments || []).find((e) => e.id === col.activeEnvId) || null;
  const nav = [];
  const sections = [];
  const ids = new Map();
  let count = 0;

  (function walk(items, anc, depth) {
    for (const it of items || []) {
      const id = slug([...anc.map((a) => a.name), it.name].join(' '), used);
      ids.set(it.id, id);
      if (it.type === 'folder') {
        nav.push(`<div class="nf" style="--d:${depth}">${esc(it.name)}</div>`);
        sections.push(`<h2 class="folder" id="${id}">${esc([...anc.map((a) => a.name), it.name].join(' / '))}</h2>${it.docs ? `<div class="doc">${md(it.docs)}</div>` : ''}`);
        walk(it.items, [...anc, it], depth + 1);
        continue;
      }
      count++;
      const m = esc(it.method || 'GET');
      nav.push(`<a class="nr" style="--d:${depth}" href="#${id}" data-k="${esc(`${it.method} ${it.name} ${it.url}`.toLowerCase())}"><span class="m m-${m}">${m}</span>${esc(it.name)}</a>`);
      const parts = [];
      const docs = it.docs || it.specDocs;
      if (docs) parts.push(`<div class="doc">${md(docs)}</div>`);
      const a = resolveAuth(col, anc, it);
      const at = a === col.auth ? null : authText(a); // collection-wide auth is shown once at the top
      if (at) parts.push(`<h4>Auth</h4><p>${at}</p>`);
      const pp = (it.pathParams || []).filter((x) => x.key);
      if (pp.length) parts.push(`<h4>Path parameter</h4>${table(pp.map((x) => [x.key, x.value || '', x.description || '']), ['Nama', 'Contoh', 'Keterangan'])}`);
      const qp = (it.params || []).filter(on);
      if (qp.length) parts.push(`<h4>Query parameter</h4>${table(qp.map((x) => [x.key, x.value || '', x.description || '']), ['Nama', 'Contoh', 'Keterangan'])}`);
      const hs = (it.headers || []).filter(on);
      if (hs.length) parts.push(`<h4>Header</h4>${table(hs.map((x) => [x.key, SENSITIVE.test(x.key) ? mask(x.value) : x.value || '']), ['Nama', 'Nilai'])}`);
      const b = it.body || {};
      if (['json', 'text', 'xml'].includes(b.mode) && String(b.content || '').trim()) parts.push(`<h4>Body <small>${esc(b.mode)}</small></h4><pre><code>${esc(prettyBody(b.content))}</code></pre>`);
      else if ((b.mode === 'form' || b.mode === 'multipart') && (b.form || []).some(on)) parts.push(`<h4>Body <small>${b.mode === 'form' ? 'form-urlencoded' : 'multipart'}</small></h4>${table(b.form.filter(on).map((x) => [x.key, x.type === 'file' ? `(file) ${x.fileName || ''}` : SECRET_NAME.test(x.key) ? mask(x.value) : x.value || '']), ['Field', 'Nilai'])}`);
      parts.push(`<h4>Contoh cURL</h4><pre class="curl"><button class="cp" type="button">Salin</button><code>${esc(curlFor(col, anc, it))}</code></pre>`);
      const s = samples[it.id];
      if (s && s.body != null) {
        const okCls = s.status < 400 ? 'ok' : 'bad';
        let body = prettyBody(s.body);
        if (body.length > 20000) body = body.slice(0, 20000) + '\n… (dipotong)';
        parts.push(`<h4>Contoh response <span class="st ${okCls}">${esc(s.status)}</span></h4><pre><code>${esc(body)}</code></pre>`);
      }
      const schemas = it.responseSchemas && typeof it.responseSchemas === 'object' ? Object.entries(it.responseSchemas) : [];
      for (const [code, schema] of schemas.slice(0, 4)) {
        if (!schema) continue;
        parts.push(`<details><summary>Schema response ${esc(code)}</summary><pre><code>${esc(JSON.stringify(schema, null, 2))}</code></pre></details>`);
      }
      sections.push(`<section class="ep" id="${id}" data-k="${esc(`${it.method} ${it.name} ${it.url}`.toLowerCase())}">
<div class="crumb">${esc(anc.map((x) => x.name).join(' / '))}</div>
<h3><span class="m m-${m}">${m}</span> ${esc(it.name)}</h3>
<div class="url"><code>${esc(it.url || '')}</code></div>
${parts.join('\n')}
</section>`);
    }
  })(col.items, [], 0);

  // Scenarios
  const scn = (col.scenarios || []).filter((s) => (s.steps || []).length);
  let scnHtml = '';
  if (scn.length) {
    const names = new Map();
    (function walk(items) { for (const it of items || []) { if (it.type === 'folder') walk(it.items); else names.set(it.id, it); } })(col.items);
    scnHtml = `<h2 id="skenario">Skenario</h2>` + scn.map((s) => `<div class="scn"><h3>${esc(s.name)}</h3><ol>${s.steps.filter((st) => st.enabled !== false).map((st) => {
      const r = names.get(st.reqId);
      const ex = (st.extract || []).filter((x) => x.var).map((x) => `<code>{{${esc(x.var)}}}</code> ← ${esc(x.from || 'body')} <code>${esc(x.path || '')}</code>`).join(', ');
      return `<li>${r ? `<a href="#${ids.get(r.id)}"><span class="m m-${esc(r.method)}">${esc(r.method)}</span> ${esc(r.name)}</a>` : '<i>request tidak ditemukan</i>'}${st.expectStatus ? ` <small>harap status ${esc(st.expectStatus)}</small>` : ''}${ex ? `<div class="ex">Ambil: ${ex}</div>` : ''}</li>`;
    }).join('')}</ol></div>`).join('');
    nav.push(`<a class="nr" href="#skenario" data-k="skenario"><span class="m m-S">SCN</span>Skenario (${scn.length})</a>`);
  }

  // Variables (values of secret vars are never printed)
  const varRows = [];
  for (const v of (col.vars || []).filter(on)) varRows.push([v.key, SECRET_NAME.test(v.key) ? mask(v.value) : v.value || '', 'koleksi']);
  for (const e of col.environments || []) for (const v of (e.vars || []).filter(on)) varRows.push([v.key, v.secret || SECRET_NAME.test(v.key) ? '(rahasia)' : v.value || '', `env: ${e.name}`]);
  const colAuth = authText(col.auth);
  const generated = new Date(options.now || Date.now()).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Ringan API">
<title>${esc(col.name)} — Dokumentasi API</title>
<style>
:root{--bg:#fff;--fg:#1d2330;--mut:#667085;--line:#e4e7ec;--panel:#f7f8fa;--acc:#0e9f6e;--code:#f2f4f7}
@media (prefers-color-scheme:dark){:root{--bg:#14171c;--fg:#e6e8eb;--mut:#98a2b3;--line:#2a2f37;--panel:#1b1f25;--acc:#34d399;--code:#1f242c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{display:grid;grid-template-columns:280px minmax(0,1fr);min-height:100vh}
nav{position:sticky;top:0;height:100vh;overflow:auto;border-right:1px solid var(--line);background:var(--panel);padding:16px 10px}
nav h1{font-size:16px;margin:0 6px 10px}nav input{width:100%;padding:7px 9px;border:1px solid var(--line);border-radius:7px;background:var(--bg);color:var(--fg);margin-bottom:10px}
.nf{padding:6px 6px 2px calc(6px + var(--d,0)*12px);color:var(--mut);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.03em}
.nr{display:flex;gap:8px;align-items:center;padding:4px 6px 4px calc(6px + var(--d,0)*12px);border-radius:6px;color:var(--fg);text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nr:hover{background:var(--code)}
main{padding:28px 36px;max-width:1000px}
.m{display:inline-block;min-width:44px;font:700 11px/1.8 ui-monospace,Consolas,monospace;text-align:center;border-radius:4px;padding:0 4px;color:#fff;background:#667085}
.m-GET{background:#0e9f6e}.m-POST{background:#d97706}.m-PUT{background:#2563eb}.m-PATCH{background:#7c3aed}.m-DELETE{background:#dc2626}.m-S{background:#0891b2}
h2.folder{margin-top:40px;padding-bottom:6px;border-bottom:2px solid var(--line)}
.ep{border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin:18px 0;background:var(--bg)}
.ep h3{margin:2px 0 8px;display:flex;gap:10px;align-items:center}.crumb{color:var(--mut);font-size:12px}
.url code{display:block;padding:8px 10px;background:var(--code);border-radius:6px;word-break:break-all}
h4{margin:16px 0 6px;font-size:13px}h4 small{color:var(--mut);font-weight:400}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top;word-break:break-word}th{background:var(--panel)}
pre{position:relative;background:var(--code);padding:10px 12px;border-radius:7px;overflow:auto;max-height:420px;font:12.5px/1.5 ui-monospace,Consolas,monospace}
code{font-family:ui-monospace,Consolas,monospace}p code,td code,li code{background:var(--code);padding:1px 4px;border-radius:4px}
.cp{position:absolute;top:6px;right:6px;border:1px solid var(--line);background:var(--bg);color:var(--fg);border-radius:5px;font-size:11px;padding:2px 8px;cursor:pointer}
.st{padding:1px 7px;border-radius:9px;font-size:12px}.st.ok{background:#d1fae5;color:#065f46}.st.bad{background:#fee2e2;color:#991b1b}
.meta{color:var(--mut)}.doc{margin:8px 0}.scn{border:1px solid var(--line);border-radius:10px;padding:10px 16px;margin:12px 0}.scn a{color:inherit;text-decoration:none}.ex{color:var(--mut);font-size:12px}
details summary{cursor:pointer;color:var(--mut);margin-top:10px}
.hide{display:none!important}
@media (max-width:820px){.wrap{grid-template-columns:minmax(0,1fr)}nav{position:static;height:auto;max-height:45vh;border-right:0;border-bottom:1px solid var(--line)}main{padding:18px 16px}}
@media print{nav{display:none}.wrap{display:block}.cp{display:none}pre{max-height:none}}
</style>
</head>
<body>
<div class="wrap">
<nav>
<h1>${esc(col.name)}</h1>
<input id="q" type="search" placeholder="Cari endpoint…" aria-label="Cari endpoint">
${nav.join('\n')}
</nav>
<main>
<h1>${esc(col.name)}</h1>
<p class="meta">${count} endpoint${env ? ` · environment: ${esc(env.name)}` : ''} · dibuat ${esc(generated)} dengan Ringan API</p>
${col.docs ? `<div class="doc">${md(col.docs)}</div>` : ''}
${colAuth ? `<h4>Auth koleksi</h4><p>${colAuth}</p>` : ''}
${varRows.length ? `<h4>Variabel</h4>${table(varRows, ['Nama', 'Nilai', 'Sumber'])}` : ''}
${sections.join('\n')}
${scnHtml}
</main>
</div>
<script>
document.getElementById('q').addEventListener('input',function(e){var v=e.target.value.toLowerCase().trim();document.querySelectorAll('[data-k]').forEach(function(el){el.classList.toggle('hide',!!v&&el.getAttribute('data-k').indexOf(v)<0)});});
document.querySelectorAll('.cp').forEach(function(b){b.addEventListener('click',function(){var t=b.parentNode.querySelector('code').textContent;(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){b.textContent='Tersalin';setTimeout(function(){b.textContent='Salin'},1200)},function(){});});});
</script>
</body>
</html>
`;
  const warnings = [];
  if (!Object.keys(samples).length) warnings.push('Belum ada response yang dikirim di sesi ini, jadi contoh response tidak ikut. Jalankan runner dulu agar dokumentasi berisi contoh response.');
  return { html, warnings };
}

module.exports = { toHtmlDocs, md, curlFor };
