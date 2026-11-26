'use strict';
(() => {
  // ================================================================ basics
  const TOKEN = document.querySelector('meta[name="ringan-token"]').content;
  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  const BODY_MODES = [['none', 'None'], ['json', 'JSON'], ['text', 'Text'], ['xml', 'XML'], ['form', 'Form URL-Encoded'], ['multipart', 'Multipart']];
  const AUTH_TYPES = [['inherit', 'Inherit'], ['none', 'No Auth'], ['bearer', 'Bearer Token'], ['basic', 'Basic Auth'], ['apikey', 'API Key']];
  const AUTH_LABEL = Object.fromEntries(AUTH_TYPES);

  const $ = (s, el = document) => el.querySelector(s);
  const E = window.RinganEngine;
  const { uid, clone, kv, on, kvObj, eachRequest, activeEnv, resolveAuth, mergedHeaders, syncParamsFromUrl, syncUrlFromParams, interpolate, scriptBody, buildWire, resultOk } = E;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    let value;
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'value') value = v;
        else if (k === 'checked') el.checked = !!v;
        else if (k === 'html') el.innerHTML = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    if (value !== undefined) el.value = value;
    return el;
  }

  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  async function api(path, body, method = 'POST', signal) {
    const r = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Ringan-Token': TOKEN },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 403) throw new Error('Sesi tidak valid (server mungkin di-restart). Muat ulang halaman (F5).');
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  function toast(msg, isErr) {
    const t = h('div', { class: 'toast' + (isErr ? ' err' : '') }, msg);
    $('#toasts').append(t);
    setTimeout(() => t.remove(), isErr ? 7000 : 3500);
  }

  const fmtSize = (n) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);
  const fmtMs = (n) => (n == null ? '' : n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`);

  // ================================================================ state
  let store = null;
  const rtVars = {}; // collection id -> runtime vars (memory only, like Bruno)
  const results = {}; // request id -> last result
  const saved = ls.get('ringan.ui') || {};
  const ui = {
    sel: saved.sel || null,
    tabs: Array.isArray(saved.tabs) ? saved.tabs : [],
    side: saved.side === 'history' ? 'history' : 'collections',
    reqTab: saved.reqTab || 'params',
    resTab: saved.resTab || 'body',
    colTab: saved.colTab || 'overview',
    envSel: null,
    expanded: new Set(saved.expanded || []),
    filter: '',
    resMode: 'pretty',
    resFilter: '',
  };
  const cur = { loc: null, loading: false };

  function persistUi() {
    ls.set('ringan.ui', { sel: ui.sel, tabs: ui.tabs, side: ui.side, reqTab: ui.reqTab, resTab: ui.resTab, colTab: ui.colTab, expanded: [...ui.expanded], sbw: ui.sbw });
  }

  let saveTimer = null;
  let saving = false;
  function save() {
    clearTimeout(saveTimer);
    setStatus('Belum tersimpan…');
    saveTimer = setTimeout(doSave, 400);
  }
  async function doSave() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (saving) { saveTimer = setTimeout(doSave, 200); return; }
    saving = true;
    try {
      const r = await api('/api/store', store, 'PUT');
      setStatus('Tersimpan');
      for (const col of store.collections) {
        const err = (r.fsErrors || {})[col.id] || null;
        if (err && err !== col.fsError) toast(`Gagal menulis folder koleksi "${col.name}": ${err}`, true);
        if (col.fsPath) col.fsError = err;
      }
    }
    catch (e) { setStatus('Gagal simpan', true); toast(e.message, true); }
    finally { saving = false; }
  }
  function setStatus(text, err) {
    const el = $('#saveStatus');
    el.textContent = text;
    el.classList.toggle('err', !!err);
  }

  // ================================================================ model helpers
  function normRequest(r) {
    r.id = r.id || uid();
    r.type = 'request';
    r.name = r.name || 'Untitled';
    r.method = String(r.method || 'GET').toUpperCase();
    r.url = r.url || '';
    for (const k of ['params', 'pathParams', 'headers', 'vars', 'asserts']) r[k] = Array.isArray(r[k]) ? r[k] : [];
    r.body = Object.assign({ mode: 'none', content: '', form: [] }, r.body || {});
    r.auth = Object.assign({ type: 'inherit' }, r.auth || {});
    for (const k of ['preScript', 'postScript', 'tests', 'docs']) r[k] = r[k] || '';
    return r;
  }
  function normFolder(f) {
    f.id = f.id || uid();
    f.type = 'folder';
    f.items = (f.items || []).map(normItem);
    f.headers = f.headers || [];
    f.auth = Object.assign({ type: 'inherit' }, f.auth || {});
    return f;
  }
  const normItem = (it) => (it.type === 'folder' ? normFolder(it) : normRequest(it));
  function normCollection(c) {
    c.id = c.id || uid();
    c.name = c.name || 'Collection';
    c.items = (c.items || []).map(normItem);
    c.headers = c.headers || [];
    c.auth = Object.assign({ type: 'none' }, c.auth || {});
    c.vars = c.vars || [];
    for (const k of ['preScript', 'postScript', 'tests', 'docs']) c[k] = c[k] || '';
    c.environments = (c.environments || []).map((e) => ({ id: e.id || uid(), name: e.name || 'env', vars: e.vars || [] }));
    if (c.activeEnvId && !c.environments.some((e) => e.id === c.activeEnvId)) c.activeEnvId = null;
    return c;
  }
  function freshIds(it) {
    it.id = uid();
    if (it.items) it.items.forEach(freshIds);
    return it;
  }

  function locate(id) {
    if (!id) return null;
    for (const col of store.collections) {
      if (col.id === id) return { item: col, col, parent: null, list: store.collections, ancestors: [] };
      const r = (function rec(items, parent, anc) {
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (it.id === id) return { item: it, col, parent, list: items, ancestors: anc };
          if (it.type === 'folder') { const f = rec(it.items, it, [...anc, it]); if (f) return f; }
        }
        return null;
      })(col.items, col, []);
      if (r) return r;
    }
    return null;
  }
  function countReq(items) { let n = 0; eachRequest(items, () => n++); return n; }
  function countFolders(items) { let n = 0; for (const it of items) if (it.type === 'folder') n += 1 + countFolders(it.items); return n; }

  const mergedVars = (col, env, item) => E.mergedVars(col, env, item, rtVars[col.id]);

  // ================================================================ script sandbox
  // Collection scripts run in a dedicated Worker (no DOM, no network: see CSP in server.js).
  const sandbox = { worker: null, seq: 0, pending: new Map() };
  function spawnWorker() {
    const w = new Worker('/sandbox-worker.js');
    w.onmessage = (e) => {
      const d = e.data || {};
      const p = sandbox.pending.get(d.id);
      if (p) { clearTimeout(p.timer); sandbox.pending.delete(d.id); p.resolve(d); }
    };
    w.onerror = (e) => {
      e.preventDefault();
      for (const [id, p] of sandbox.pending) { clearTimeout(p.timer); p.resolve({ id, error: 'Sandbox script error: ' + (e.message || 'gagal dimuat'), logs: [], tests: [] }); }
      sandbox.pending.clear();
    };
    sandbox.worker = w;
  }
  function initSandbox() { spawnWorker(); }
  function runSandbox(job) {
    const id = ++sandbox.seq;
    const ms = store.settings.scriptTimeoutMs || 10000;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        sandbox.pending.delete(id);
        sandbox.worker.terminate();
        spawnWorker();
        resolve({ id, error: `Script dihentikan: melebihi batas waktu ${ms / 1000} detik.`, logs: [], tests: [] });
      }, ms);
      sandbox.pending.set(id, { resolve, timer });
      sandbox.worker.postMessage(JSON.parse(JSON.stringify({ ...job, id })));
    });
  }
  // ================================================================ execute a request
  const engineCtx = (signal) => ({
    send: (payload, sig) => api('/api/send', payload, 'POST', sig),
    sandbox: runSandbox,
    settings: store.settings,
    runtime: rtVars,
    onDirty: save,
    signal,
  });
  const execute = (item, col, ancestors, { signal } = {}) => E.execute(item, col, ancestors, engineCtx(signal));

  async function send() {
    const loc = cur.loc;
    if (!loc || loc.item.type !== 'request') return;
    if (cur.loadingId) { toast('Masih menunggu request lain selesai', true); return; }
    if (!loc.item.url.trim()) { toast('URL masih kosong', true); return; }
    const id = loc.item.id;
    cur.loadingId = id;
    cur.abort = new AbortController();
    renderResPane();
    if (cur.sendBtn) cur.sendBtn.disabled = true;
    let result;
    try {
      result = await execute(loc.item, loc.col, loc.ancestors, { signal: cur.abort.signal });
    } catch (e) {
      result = { at: Date.now(), error: e.name === 'AbortError' ? 'Request dibatalkan.' : e.message, logs: [], tests: [] };
    } finally {
      cur.loadingId = null;
    }
    results[id] = result;
    recordHistory(loc, result);
    if (cur.loc && cur.loc.item.id === id) {
      if (cur.sendBtn) cur.sendBtn.disabled = false;
      renderResPane();
    }
    renderSidebar();
  }

  // ================================================================ generic UI pieces
  function closeMenu() { $('#menuRoot').innerHTML = ''; }
  function menu(e, items) {
    closeMenu();
    const m = h('div', { class: 'menu' }, items.map((it) => (it === '-' ? h('hr') : h('button', { class: it.danger ? 'danger' : '', onclick: () => { closeMenu(); it.onClick(); } }, it.label))));
    $('#menuRoot').append(m);
    const r = (e.currentTarget || e.target).getBoundingClientRect();
    let x = e.type === 'contextmenu' ? e.clientX : r.left;
    let y = e.type === 'contextmenu' ? e.clientY : r.bottom + 2;
    const mr = m.getBoundingClientRect();
    if (x + mr.width > innerWidth - 8) x = innerWidth - mr.width - 8;
    if (y + mr.height > innerHeight - 8) y = Math.max(8, y - mr.height - (e.type === 'contextmenu' ? 0 : r.height + 4));
    m.style.left = x + 'px';
    m.style.top = y + 'px';
  }

  function modal(title, { wide } = {}) {
    const body = h('div', { class: 'mbody' });
    const foot = h('footer');
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
    const box = h('div', { class: 'modal' + (wide ? ' wide' : '') }, h('header', null, title, h('button', { class: 'icon-btn', title: 'Tutup', onclick: () => close() }, '×')), body, foot);
    const ov = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === ov) close(); } }, box);
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    $('#modalRoot').append(ov);
    return { body, foot, close, box };
  }
  function promptDialog(title, value = '', label = 'Nama') {
    return new Promise((resolve) => {
      const m = modal(title);
      const inp = h('input', { class: 'inp', value, onkeydown: (e) => { if (e.key === 'Enter') ok(); } });
      const ok = () => { const v = inp.value.trim(); m.close(); resolve(v || null); };
      m.body.append(h('label', { class: 'blk' }, label), inp);
      m.foot.append(h('button', { class: 'btn', onclick: () => { m.close(); resolve(null); } }, 'Batal'), h('button', { class: 'btn primary', onclick: ok }, 'OK'));
      setTimeout(() => { inp.focus(); inp.select(); }, 0);
    });
  }
  function confirmDialog(title, text, okLabel = 'Hapus') {
    return new Promise((resolve) => {
      const m = modal(title);
      m.body.append(h('p', null, text));
      const done = (v) => { m.close(); resolve(v); };
      m.foot.append(h('button', { class: 'btn', onclick: () => done(false) }, 'Batal'), h('button', { class: 'btn primary', onclick: () => done(true) }, okLabel));
    });
  }

  function kvTable(rows, opts = {}) {
    const tbody = h('tbody');
    const changed = () => { if (opts.onChange) opts.onChange(); save(); };
    const head = h('tr', null,
      h('th', { class: 'c-chk' }), h('th', null, opts.keyLabel || 'Key'), h('th', null, opts.valLabel || 'Value'),
      opts.multipart && h('th', { class: 'c-type' }, 'Tipe'), opts.secret && h('th', { class: 'c-sec' }, 'Secret'), h('th', { class: 'c-del' }));
    function rowEl(r) {
      let row = r;
      const tr = h('tr', { class: r ? (r.enabled === false ? 'off' : '') : 'ghost' });
      const ensure = () => {
        if (!row) {
          row = kv();
          if (opts.multipart) row.type = 'text';
          rows.push(row);
          tr.classList.remove('ghost');
          chk.checked = true;
          chk.disabled = false;
          del.disabled = false;
          tbody.append(rowEl(null));
        }
        return row;
      };
      const chk = h('input', { type: 'checkbox', checked: r ? r.enabled !== false : true, disabled: !r, onchange: (e) => { ensure().enabled = e.target.checked; tr.classList.toggle('off', !e.target.checked); changed(); } });
      const kIn = h('input', { class: 'cell', value: r ? r.key : '', placeholder: opts.keyPh || 'key', readonly: opts.fixedKeys || null, spellcheck: 'false', oninput: (e) => { ensure().key = e.target.value; changed(); } });
      const vIn = h('input', { class: 'cell', type: r && r.secret ? 'password' : 'text', value: r ? r.value : '', placeholder: opts.valPh || 'value', spellcheck: 'false', autocomplete: 'off', oninput: (e) => { ensure().value = e.target.value; changed(); } });
      const del = h('button', { class: 'icon-btn', title: 'Hapus baris', disabled: !r || !!opts.fixedKeys, onclick: () => { const i = rows.indexOf(row); if (i >= 0) rows.splice(i, 1); tr.remove(); changed(); } }, '×');
      let valueCell = vIn;
      let typeCell = null;
      if (opts.multipart) {
        const fileName = h('span', null, (r && r.fileName) || 'belum dipilih');
        const fileInp = h('input', {
          type: 'file', hidden: true,
          onchange: async (e) => {
            const f = e.target.files[0];
            if (!f) return;
            if (f.size > 20 * 1024 * 1024) { toast('File maksimal 20 MB', true); return; }
            const data = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.readAsDataURL(f); });
            Object.assign(ensure(), { fileName: f.name, contentType: f.type || 'application/octet-stream', data });
            fileName.textContent = f.name;
            changed();
          },
        });
        const fileCell = h('div', { class: 'filecell' }, h('button', { class: 'btn sm', onclick: () => fileInp.click() }, 'Pilih file'), fileName, fileInp);
        const isFile = () => (row || {}).type === 'file';
        valueCell = h('div', null, isFile() ? fileCell : vIn);
        typeCell = h('select', {
          onchange: (e) => { ensure().type = e.target.value; valueCell.replaceChildren(e.target.value === 'file' ? fileCell : vIn); changed(); },
        }, h('option', { value: 'text', selected: !isFile() }, 'Text'), h('option', { value: 'file', selected: isFile() }, 'File'));
      }
      const secCell = opts.secret && h('input', { type: 'checkbox', title: 'Sembunyikan nilai', checked: r && r.secret, onchange: (e) => { ensure().secret = e.target.checked; vIn.type = e.target.checked ? 'password' : 'text'; changed(); } });
      tr.append(...[h('td', { class: 'c-chk' }, chk), h('td', null, kIn), h('td', null, valueCell), typeCell && h('td', { class: 'c-type' }, typeCell), secCell && h('td', { class: 'c-sec' }, secCell), h('td', { class: 'c-del' }, del)].filter(Boolean));
      return tr;
    }
    rows.forEach((r) => tbody.append(rowEl(r)));
    if (!opts.fixedKeys) tbody.append(rowEl(null));
    return h('table', { class: 'kv' }, h('thead', null, head), tbody);
  }

  function codeArea(value, onInput, opts = {}) {
    const ta = h('textarea', {
      class: 'code' + (opts.grow ? ' grow' : ''), spellcheck: 'false', placeholder: opts.placeholder || '', wrap: 'off', value: value || '',
      style: opts.minHeight ? { minHeight: opts.minHeight } : null,
      oninput: (e) => onInput(e.target.value),
      onkeydown: (e) => {
        if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey) { e.preventDefault(); document.execCommand('insertText', false, '  '); }
      },
    });
    return ta;
  }
  function field(label, el, hint) { return h('label', { class: 'field' }, h('span', null, label), el, hint && h('small', null, hint)); }
  function textInput(obj, key, ph, type = 'text', after) {
    return h('input', { class: 'inp', type, value: obj[key] ?? '', placeholder: ph || '', spellcheck: 'false', autocomplete: 'off', oninput: (e) => { obj[key] = e.target.value; save(); if (after) after(); } });
  }
  function tabsBar(tabs, active, onPick) {
    return h('div', { class: 'tabs' }, tabs.map(([id, label, badge]) => h('button', { class: 'tab' + (id === active ? ' active' : ''), onclick: () => onPick(id) }, label, badge ? h('sup', null, badge) : null)));
  }

  function authEditor(auth, { allowInherit, inheritedFrom, onChange }) {
    const box = h('div');
    const draw = () => {
      box.replaceChildren();
      const types = AUTH_TYPES.filter(([t]) => allowInherit || t !== 'inherit');
      box.append(field('Tipe', h('select', {
        onchange: (e) => {
          const t = e.target.value;
          for (const k of Object.keys(auth)) delete auth[k];
          auth.type = t;
          if (t === 'apikey') auth.in = 'header';
          save(); draw(); if (onChange) onChange();
        },
      }, types.map(([v, l]) => h('option', { value: v, selected: auth.type === v }, l)))));
      if (auth.type === 'inherit') {
        const inh = inheritedFrom ? inheritedFrom() : null;
        box.append(h('p', { class: 'help' }, inh ? `Mengikuti auth dari ${inh.from}: ${AUTH_LABEL[inh.type] || inh.type}.` : 'Mengikuti auth dari parent.'));
      }
      if (auth.type === 'bearer') box.append(field('Token', textInput(auth, 'token', '{{token}}'), 'Dikirim sebagai header Authorization: Bearer <token>'));
      if (auth.type === 'basic') box.append(field('Username', textInput(auth, 'username', 'username')), field('Password', textInput(auth, 'password', 'password', 'password')));
      if (auth.type === 'apikey') {
        box.append(field('Key', textInput(auth, 'key', 'X-API-Key')), field('Value', textInput(auth, 'value', '{{apiKey}}')),
          field('Dikirim di', h('select', { onchange: (e) => { auth.in = e.target.value; save(); } }, h('option', { value: 'header', selected: auth.in !== 'query' }, 'Header'), h('option', { value: 'query', selected: auth.in === 'query' }, 'Query param'))));
      }
      if (auth.type !== 'none' && auth.type !== 'inherit') box.append(h('p', { class: 'help' }, 'Tip: gunakan variabel seperti ', h('code', null, '{{token}}'), ' supaya nilai rahasia disimpan di environment.'));
    };
    draw();
    return box;
  }

  // ================================================================ sidebar
  const shortMethod = (m) => ({ DELETE: 'DEL', OPTIONS: 'OPT' }[m] || m);
  function renderSidebar() {
    const tree = $('#tree');
    tree.replaceChildren();
    const f = ui.filter.trim().toLowerCase();
    $('#sideTabs').replaceChildren(h('div', { class: 'seg full' },
      [['collections', 'Koleksi'], ['history', `History${historyIndex.length ? ' (' + historyIndex.length + ')' : ''}`]].map(([id, l]) => h('button', {
        class: ui.side === id ? 'on' : '', onclick: () => { ui.side = id; persistUi(); renderSidebar(); },
      }, l))));
    $('#sbFilter').placeholder = ui.side === 'history' ? 'Cari di history…' : 'Cari request…';
    if (ui.side === 'history') { renderHistoryList(tree, f); return; }
    if (!store.collections.length) {
      tree.append(h('div', { class: 'empty-side' }, 'Belum ada koleksi.', h('br'), h('button', { class: 'link', onclick: () => openImport() }, 'Import'), ' atau ', h('button', { class: 'link', onclick: newCollection }, 'buat koleksi baru')));
      return;
    }
    for (const col of store.collections) tree.append(colNode(col, f));
  }
  const matches = (it, f) => !f || (it.type === 'folder' ? it.name.toLowerCase().includes(f) || it.items.some((x) => matches(x, f)) : `${it.name} ${it.url} ${it.method}`.toLowerCase().includes(f));
  function toggle(id, force) {
    const open = force !== undefined ? force : !ui.expanded.has(id);
    open ? ui.expanded.add(id) : ui.expanded.delete(id);
    persistUi();
    renderSidebar();
  }
  function colNode(col, f) {
    const open = ui.expanded.has(col.id) || !!f;
    const caret = h('span', { class: 'caret' + (open ? ' open' : ''), onclick: (e) => { e.stopPropagation(); toggle(col.id); } }, '▶');
    const row = h('div', {
      class: 'node col' + (ui.sel === col.id ? ' active' : ''), title: col.name,
      onclick: () => { ui.expanded.add(col.id); select(col.id); },
      oncontextmenu: (e) => { e.preventDefault(); colMenu(col, e); },
    }, caret, h('span', { class: 'name' }, col.name), col.live ? h('span', { class: 'livedot ' + liveState(col), 'data-col': col.id, title: liveTitle(col) }) : null, h('button', { class: 'more', title: 'Menu', onclick: (e) => { e.stopPropagation(); colMenu(col, e); } }, '⋯'));
    const wrap = h('div', null, row);
    if (open) col.items.filter((it) => matches(it, f)).forEach((it) => wrap.append(itemNode(it, col, 1, f)));
    return wrap;
  }
  function itemNode(it, col, depth, f) {
    const pad = { paddingLeft: 6 + depth * 14 + 'px' };
    if (it.type === 'folder') {
      const open = ui.expanded.has(it.id) || !!f;
      const row = h('div', {
        class: 'node folder' + (ui.sel === it.id ? ' active' : ''), style: pad, title: it.name,
        onclick: () => toggle(it.id), ondblclick: () => select(it.id),
        oncontextmenu: (e) => { e.preventDefault(); folderMenu(it, col, e); },
      }, h('span', { class: 'caret' + (open ? ' open' : '') }, '▶'), h('span', { class: 'name' }, it.name), h('button', { class: 'more', title: 'Menu', onclick: (e) => { e.stopPropagation(); folderMenu(it, col, e); } }, '⋯'));
      const wrap = h('div', null, row);
      if (open) it.items.filter((x) => matches(x, f)).forEach((x) => wrap.append(itemNode(x, col, depth + 1, f)));
      return wrap;
    }
    const r = results[it.id];
    const dot = r && !r.skipped ? h('span', { class: 'dot ' + (resultOk(r) ? 'pass' : 'fail'), title: resultOk(r) ? 'Terakhir: lulus' : 'Terakhir: gagal' }) : null;
    const short = { DELETE: 'DEL', OPTIONS: 'OPT' }[it.method] || it.method;
    return h('div', {
      class: 'node req' + (ui.sel === it.id ? ' active' : ''), style: pad, title: `${it.method} ${it.url}`, 'data-id': it.id,
      onclick: () => select(it.id),
      oncontextmenu: (e) => { e.preventDefault(); reqMenu(it, col, e); },
    }, h('span', { class: 'mbadge m-' + it.method.toLowerCase() }, short), h('span', { class: 'name' }, it.name), dot, h('button', { class: 'more', title: 'Menu', onclick: (e) => { e.stopPropagation(); reqMenu(it, col, e); } }, '⋯'));
  }

  const isNarrow = () => window.matchMedia('(max-width: 820px)').matches;
  const setDrawer = (open) => document.body.classList.toggle('sb-open', !!open);
  function select(id, tab) {
    if (isNarrow()) setDrawer(false);
    ui.sel = id;
    if (id && !ui.tabs.includes(id)) {
      // Open next to the active tab, like a browser.
      const at = ui.tabs.indexOf(cur.loc && cur.loc.item ? cur.loc.item.id : null);
      ui.tabs.splice(at >= 0 ? at + 1 : ui.tabs.length, 0, id);
      if (ui.tabs.length > 30) ui.tabs.splice(ui.tabs.findIndex((t) => t !== id), 1);
    }
    if (tab) ui.colTab = tab;
    persistUi();
    renderSidebar();
    renderMain();
  }
  function closeTab(id) {
    const i = ui.tabs.indexOf(id);
    if (i < 0) return;
    ui.tabs.splice(i, 1);
    if (ui.sel === id) ui.sel = ui.tabs[Math.min(i, ui.tabs.length - 1)] || null;
    persistUi();
    renderSidebar();
    renderMain();
  }
  function tabInfo(id) {
    if (String(id).startsWith('h:')) {
      const e = historyIndex.find((x) => x.id === id.slice(2));
      return e ? { kind: 'history', method: e.method, label: e.name || e.url, title: `History: ${e.method} ${e.url}` } : null;
    }
    const loc = locate(id);
    if (!loc) return null;
    if (loc.item === loc.col) return { kind: 'collection', label: loc.col.name, title: `Koleksi ${loc.col.name}` };
    if (loc.item.type === 'folder') return { kind: 'folder', label: loc.item.name, title: `Folder ${loc.item.name}` };
    return { kind: 'request', method: loc.item.method, label: loc.item.name, title: `${loc.col.name} / ${loc.item.name}` };
  }
  function tabStrip() {
    ui.tabs = ui.tabs.filter((id) => tabInfo(id));
    if (!ui.tabs.length) return null;
    const strip = h('div', { class: 'rtabs', role: 'tablist' }, ui.tabs.map((id) => {
      const t = tabInfo(id);
      const short = { DELETE: 'DEL', OPTIONS: 'OPT' }[t.method] || t.method;
      const running = cur.loadingId === id;
      return h('div', {
        class: 'rtab' + (id === ui.sel ? ' active' : '') + (t.kind === 'history' ? ' hist' : ''), title: t.title, role: 'tab',
        onclick: () => { if (id !== ui.sel) select(id); },
        onauxclick: (e) => { if (e.button === 1) { e.preventDefault(); closeTab(id); } },
        oncontextmenu: (e) => {
          e.preventDefault();
          menu(e, [
            { label: 'Tutup', onClick: () => closeTab(id) },
            { label: 'Tutup tab lain', onClick: () => { ui.tabs = [id]; ui.sel = id; persistUi(); renderMain(); } },
            { label: 'Tutup semua', onClick: () => { ui.tabs = []; ui.sel = null; persistUi(); renderSidebar(); renderMain(); } },
          ]);
        },
      },
      t.method ? h('span', { class: 'mbadge m-' + t.method.toLowerCase() }, short) : h('span', { class: 'tkind' }, t.kind === 'collection' ? 'KOL' : t.kind === 'folder' ? 'DIR' : ''),
      h('span', { class: 'tname' }, t.kind === 'history' ? '⟲ ' + t.label : t.label),
      running ? h('span', { class: 'spinner sm' }) : null,
      h('button', { class: 'tclose', title: 'Tutup (Ctrl+W)', onclick: (e) => { e.stopPropagation(); closeTab(id); } }, '×'));
    }));
    setTimeout(() => { const a = strip.querySelector('.rtab.active'); if (a) a.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, 0);
    return strip;
  }

  // ---- tree actions
  async function newCollection() {
    const name = await promptDialog('Koleksi baru', '', 'Nama koleksi');
    if (!name) return;
    const col = normCollection({ name });
    store.collections.push(col);
    ui.expanded.add(col.id);
    save();
    select(col.id, 'overview');
  }
  function addRequest(parent, col, preset) {
    const r = normRequest(Object.assign({ name: 'Request baru', method: 'GET', url: '' }, preset || {}));
    parent.items.push(r);
    ui.expanded.add(col.id);
    ui.expanded.add(parent.id);
    save();
    ui.reqTab = 'params';
    select(r.id);
    setTimeout(() => { const u = $('input.url'); if (u) u.focus(); }, 0);
  }
  async function addFolder(parent, col) {
    const name = await promptDialog('Folder baru', '', 'Nama folder');
    if (!name) return;
    const f = normFolder({ name });
    parent.items.push(f);
    ui.expanded.add(col.id);
    ui.expanded.add(parent.id);
    ui.expanded.add(f.id);
    save();
    renderSidebar();
  }
  async function renameItem(it) {
    const name = await promptDialog('Ganti nama', it.name);
    if (!name) return;
    it.name = name;
    save();
    renderSidebar();
    renderMain();
  }
  async function deleteItem(it, isCol) {
    const n = isCol || it.type === 'folder' ? countReq(it.items) : 0;
    const what = isCol ? 'koleksi' : it.type === 'folder' ? 'folder' : 'request';
    const ok = await confirmDialog(`Hapus ${what}?`, `"${it.name}"${n ? ` beserta ${n} request di dalamnya` : ''} akan dihapus. Tindakan ini tidak bisa dibatalkan.`);
    if (!ok) return;
    const loc = locate(it.id);
    if (!loc) return;
    loc.list.splice(loc.list.indexOf(it), 1);
    if (ui.sel && !locate(ui.sel)) ui.sel = null;
    save();
    renderSidebar();
    renderMain();
  }
  function moveItem(it, dir) {
    const loc = locate(it.id);
    const i = loc.list.indexOf(it);
    const j = i + dir;
    if (j < 0 || j >= loc.list.length) return;
    [loc.list[i], loc.list[j]] = [loc.list[j], loc.list[i]];
    save();
    renderSidebar();
  }
  function duplicateItem(it) {
    const loc = locate(it.id);
    const copy = freshIds(clone(it));
    copy.name = it.name + ' (copy)';
    (function detach(x) { if (x.type === 'folder') x.items.forEach(detach); else { for (const k of ['specKey', 'specName', 'specDocs', 'specBodyHash', 'specParamKeys', 'specRemoved']) delete x[k]; x.specDetached = true; } })(copy);
    loc.list.splice(loc.list.indexOf(it) + 1, 0, copy);
    save();
    if (copy.type === 'request') select(copy.id); else renderSidebar();
  }

  function colMenu(col, e) {
    menu(e, [
      { label: 'Request baru', onClick: () => addRequest(col, col) },
      { label: 'Buat request dengan AI…', onClick: () => aiNewRequest(col, null) },
      { label: 'Folder baru', onClick: () => addFolder(col, col) },
      '-',
      { label: 'Jalankan semua (Runner)', onClick: () => openRunner(col, null) },
      { label: 'Environment…', onClick: () => select(col.id, 'environments') },
      { label: 'Pengaturan koleksi', onClick: () => select(col.id, 'overview') },
      '-',
      { label: 'Import ke koleksi ini…', onClick: () => openImport(col.id) },
      { label: 'Export…', onClick: () => exportCollection(col) },
      col.source && col.source.url ? { label: 'Perbarui dari link', onClick: () => refreshFromSource(col) } : null,
      '-',
      { label: 'Ganti nama', onClick: () => renameItem(col) },
      { label: 'Naik', onClick: () => moveItem(col, -1) },
      { label: 'Turun', onClick: () => moveItem(col, 1) },
      { label: 'Hapus koleksi', danger: true, onClick: () => deleteItem(col, true) },
    ].filter(Boolean));
  }
  function folderMenu(f, col, e) {
    menu(e, [
      { label: 'Request baru', onClick: () => addRequest(f, col) },
      { label: 'Buat request dengan AI…', onClick: () => aiNewRequest(col, f) },
      { label: 'Folder baru', onClick: () => addFolder(f, col) },
      '-',
      { label: 'Jalankan folder (Runner)', onClick: () => openRunner(col, f) },
      { label: 'Pengaturan folder', onClick: () => select(f.id, 'overview') },
      '-',
      { label: 'Ganti nama', onClick: () => renameItem(f) },
      { label: 'Duplikat', onClick: () => duplicateItem(f) },
      { label: 'Naik', onClick: () => moveItem(f, -1) },
      { label: 'Turun', onClick: () => moveItem(f, 1) },
      { label: 'Hapus folder', danger: true, onClick: () => deleteItem(f) },
    ]);
  }
  function reqMenu(r, col, e) {
    menu(e, [
      { label: 'Buka', onClick: () => select(r.id) },
      { label: 'Duplikat', onClick: () => duplicateItem(r) },
      { label: 'Copy as cURL', onClick: () => copyCurl(r) },
      '-',
      { label: 'Ganti nama', onClick: () => renameItem(r) },
      { label: 'Naik', onClick: () => moveItem(r, -1) },
      { label: 'Turun', onClick: () => moveItem(r, 1) },
      { label: 'Hapus request', danger: true, onClick: () => deleteItem(r) },
    ]);
  }

  function copyCurl(r) {
    const loc = locate(r.id);
    const env = activeEnv(loc.col);
    const headers = {};
    for (const x of mergedHeaders(r, loc.ancestors, loc.col)) headers[x.key] = x.value;
    const w = buildWire(r, loc.col, loc.ancestors, { method: r.method, url: r.url, headers, body: scriptBody(r.body) }, mergedVars(loc.col, env, r));
    const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
    const parts = [`curl -X ${w.method} ${q(w.url)}`];
    for (const [k, v] of w.headers) parts.push(`-H ${q(`${k}: ${v}`)}`);
    if (w.body.type === 'text') parts.push(`--data-raw ${q(w.body.text)}`);
    if (w.body.type === 'multipart') for (const p of w.body.parts) parts.push(`-F ${q(p.file ? `${p.name}=@${p.fileName}` : `${p.name}=${p.value}`)}`);
    navigator.clipboard.writeText(parts.join(' \\\n  ')).then(() => toast('cURL disalin ke clipboard'), () => toast('Gagal menyalin', true));
  }

  // ================================================================ main view
  function renderMain() {
    const main = $('#main');
    main.replaceChildren();
    cur.loc = null;
    cur.sendBtn = null;
    cur.reqPane = null;
    cur.resPane = null;
    if (ui.sel && !ui.tabs.includes(ui.sel)) ui.tabs.push(ui.sel);
    const strip = tabStrip();
    if (strip) main.append(strip);
    if (String(ui.sel).startsWith('h:')) { main.append(historyView(ui.sel.slice(2))); return; }
    const loc = locate(ui.sel);
    if (!loc) { main.append(emptyView()); return; }
    cur.loc = loc;
    if (loc.item === loc.col) main.append(containerView(loc, true));
    else if (loc.item.type === 'folder') main.append(containerView(loc, false));
    else main.append(requestView(loc));
  }

  function emptyView() {
    return h('div', { class: 'empty-main' },
      h('h2', null, 'Ringan API'),
      h('div', null, 'Pilih request di sidebar, atau mulai dari:'),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: () => openImport() }, 'Import collection'),
        h('button', { class: 'btn', onclick: () => openConnectProject() }, 'Hubungkan ke project API'),
        h('button', { class: 'btn', onclick: newCollection }, 'Koleksi baru')),
      h('div', { class: 'help' }, 'Import dari link GitHub (koleksi Bruno), Postman v2.1, OpenAPI JSON, atau perintah cURL.'),
      h('div', { class: 'help' }, h('kbd', null, 'Ctrl'), ' + ', h('kbd', null, 'Enter'), ' kirim request  ·  ', h('kbd', null, 'Ctrl'), ' + ', h('kbd', null, 'S'), ' simpan'));
  }

  function envPicker(col) {
    const sel = h('select', {
      class: 'env-sel',
      onchange: (e) => {
        if (e.target.value === '__cfg') { e.target.value = col.activeEnvId || ''; select(col.id, 'environments'); return; }
        col.activeEnvId = e.target.value || null;
        save();
      },
    }, h('option', { value: '', selected: !col.activeEnvId }, 'Tanpa environment'),
    col.environments.map((env) => h('option', { value: env.id, selected: env.id === col.activeEnvId }, env.name)),
    h('option', { value: '__cfg' }, 'Kelola environment…'));
    return h('div', { class: 'env' }, h('span', { class: 'muted' }, 'Env'), sel);
  }

  function requestView(loc) {
    const { item, col, ancestors } = loc;
    const crumbs = h('span', { class: 'crumbs' }, [col.name, ...ancestors.map((a) => a.name)].join(' / ') + ' /');
    const nameIn = h('input', {
      class: 'req-name', value: item.name, spellcheck: 'false',
      oninput: (e) => {
        item.name = e.target.value;
        save();
        const n = document.querySelector(`.node.req[data-id="${item.id}"] .name`);
        if (n) n.textContent = item.name;
        const t = document.querySelector('.rtab.active .tname');
        if (t) t.textContent = item.name;
      },
    });
    const methodSel = h('select', {
      class: 'method m-' + item.method.toLowerCase(),
      onchange: (e) => { item.method = e.target.value; e.target.className = 'method m-' + item.method.toLowerCase(); save(); renderSidebar(); },
    }, METHODS.map((m) => h('option', { value: m, selected: m === item.method }, m)));
    const urlIn = h('input', {
      class: 'url', value: item.url, spellcheck: 'false', autocomplete: 'off',
      placeholder: 'https://api.example.com/users  atau  {{baseUrl}}/users/:id',
      oninput: (e) => { item.url = e.target.value; syncParamsFromUrl(item); save(); refreshReqPane(true); },
      onkeydown: (e) => { if (e.key === 'Enter') send(); },
      onpaste: (e) => {
        const text = (e.clipboardData || window.clipboardData).getData('text');
        if (/^\s*curl(\.exe)?\s/i.test(text)) { e.preventDefault(); importCurlInto(item, text); }
      },
    });
    cur.urlInput = urlIn;
    cur.sendBtn = h('button', { class: 'btn primary send', disabled: (cur.loadingId === loc.item.id) || null, onclick: send, title: 'Ctrl+Enter' }, 'Send');
    cur.reqPane = h('section', { class: 'pane req-pane' });
    cur.resPane = h('section', { class: 'pane res-pane' });
    const view = h('div', { class: 'cview' },
      h('div', { class: 'topbar' }, h('div', { class: 'title' }, crumbs, nameIn), envPicker(col)),
      h('div', { class: 'urlbar' }, methodSel, urlIn, cur.sendBtn),
      h('div', { class: 'workspace' }, cur.reqPane, cur.resPane));
    renderReqPane();
    renderResPane();
    return view;
  }

  async function importCurlInto(item, text) {
    try {
      const { collections } = await api('/api/parse', { text });
      const r = collections[0].items[0];
      Object.assign(item, { method: r.method, url: r.url, params: r.params, pathParams: r.pathParams, headers: r.headers, body: r.body, auth: r.auth.type === 'inherit' ? item.auth : r.auth });
      if (item.name === 'Request baru' || item.name === 'Untitled') item.name = r.name;
      save();
      renderMain();
      renderSidebar();
      toast('Perintah cURL diubah menjadi request');
    } catch (e) { toast(e.message, true); }
  }

  const reqTabs = (it) => [
    ['params', 'Params', it.params.filter(on).length + it.pathParams.length || ''],
    ['body', 'Body', it.body.mode !== 'none' ? '•' : ''],
    ['headers', 'Headers', it.headers.filter(on).length || ''],
    ['auth', 'Auth', it.auth.type !== 'inherit' ? '•' : ''],
    ['vars', 'Vars', it.vars.filter(on).length || ''],
    ['script', 'Script', it.preScript.trim() || it.postScript.trim() ? '•' : ''],
    ['assert', 'Assert', it.asserts.filter(on).length || ''],
    ['tests', 'Tests', it.tests.trim() ? '•' : ''],
    ['schema', 'Schema', it.responseSchemas && Object.keys(it.responseSchemas).length ? (it.schemaCheck ? '•' : 'off') : ''],
    ['docs', 'Docs', it.docs.trim() ? '•' : ''],
    ['ai', 'AI ✦', (aiThreads[it.id] || []).filter((x) => x.role === 'assistant').length ? (aiControllers[it.id] ? '…' : (aiThreads[it.id] || []).filter((x) => x.role === 'assistant').length) : ''],
  ];
  function renderReqPane() {
    const { item } = cur.loc;
    if (!reqTabs(item).some(([id]) => id === ui.reqTab)) ui.reqTab = 'params';
    const body = h('div', { class: 'tab-body' });
    cur.reqPane.replaceChildren(tabsBar(reqTabs(item), ui.reqTab, (id) => { ui.reqTab = id; persistUi(); renderReqPane(); }), body);
    reqTabBody(body, ui.reqTab, cur.loc);
  }
  function refreshReqPane(fromUrl) {
    if (!cur.reqPane) return;
    if (fromUrl && ui.reqTab !== 'params') {
      const bar = tabsBar(reqTabs(cur.loc.item), ui.reqTab, (id) => { ui.reqTab = id; persistUi(); renderReqPane(); });
      cur.reqPane.firstChild.replaceWith(bar);
      return;
    }
    renderReqPane();
  }
  function updateBadges() {
    if (!cur.reqPane || !cur.loc || cur.loc.item.type !== 'request') return;
    cur.reqPane.firstChild.replaceWith(tabsBar(reqTabs(cur.loc.item), ui.reqTab, (id) => { ui.reqTab = id; persistUi(); renderReqPane(); }));
  }

  const SNIPPETS = {
    tests: [
      ['Status 200', 'test("status 200", () => {\n  expect(res.status).to.equal(200);\n});\n'],
      ['Body JSON', 'test("body adalah JSON object", () => {\n  expect(res.body).to.be.an("object");\n});\n'],
      ['Field ada', 'test("punya field id", () => {\n  expect(res.body).to.have.property("id");\n});\n'],
      ['Waktu < 1 detik', 'test("response < 1000 ms", () => {\n  expect(res.responseTime).to.be.below(1000);\n});\n'],
      ['Header', 'test("content-type JSON", () => {\n  expect(res.getHeader("content-type")).to.include("application/json");\n});\n'],
    ],
    post: [
      ['Simpan token ke env', 'bru.setEnvVar("token", res.body.token);\n'],
      ['Simpan ke runtime var', 'bru.setVar("id", res.body.id);\n'],
      ['Log response', 'console.log(res.status, res.body);\n'],
    ],
    pre: [
      ['Set header', 'req.setHeader("X-Request-Id", crypto.randomUUID());\n'],
      ['Timestamp var', 'bru.setVar("now", new Date().toISOString());\n'],
    ],
  };
  function snippetBar(list, getTa, apply) {
    return h('div', { class: 'snips' }, h('span', { class: 'muted' }, 'Snippet:'), list.map(([label, code]) => h('button', {
      class: 'btn sm', onclick: () => {
        const ta = getTa();
        const v = ta.value;
        ta.value = (v && !v.endsWith('\n') ? v + '\n' : v) + code;
        apply(ta.value);
        ta.focus();
      },
    }, label)));
  }

  function reqTabBody(body, tab, loc) {
    const { item, col, ancestors } = loc;
    if (tab === 'params') {
      body.append(h('div', { class: 'section-title' }, 'Query params'),
        kvTable(item.params, { onChange: () => { syncUrlFromParams(item); cur.urlInput.value = item.url; updateBadges(); } }));
      if (item.pathParams.length) {
        body.append(h('div', { class: 'section-title' }, 'Path params'), kvTable(item.pathParams, { fixedKeys: true, keyLabel: 'Nama', onChange: updateBadges }));
      }
      body.append(h('p', { class: 'help' }, 'Path param ditulis di URL dengan ', h('code', null, '/:nama'), '. Variabel: ', h('code', null, '{{nama}}'), ', dinamis: ', h('code', null, '{{$guid}}'), ' ', h('code', null, '{{$timestamp}}'), ' ', h('code', null, '{{$randomInt}}'), '.'));
    } else if (tab === 'body') {
      body.classList.add('fill');
      const seg = h('div', { class: 'seg' }, BODY_MODES.map(([m, l]) => h('button', { class: item.body.mode === m ? 'on' : '', onclick: () => { item.body.mode = m; if (m === 'multipart') item.body.form.forEach((f) => { f.type = f.type || 'text'; }); save(); renderReqPane(); } }, l)));
      const tools = h('div', { class: 'row', style: { marginBottom: '8px' } }, seg);
      body.append(tools);
      const m = item.body.mode;
      if (m === 'json' || m === 'text' || m === 'xml') {
        const warn = h('div', { class: 'warn-line' });
        const check = () => {
          if (m !== 'json' || !item.body.content.trim()) { warn.textContent = ''; return; }
          try { JSON.parse(item.body.content.replace(/\{\{[^{}]+\}\}/g, '0')); warn.textContent = ''; } catch (e) { warn.textContent = 'JSON tidak valid: ' + e.message; }
        };
        const ta = codeArea(item.body.content, (v) => { item.body.content = v; save(); check(); }, { grow: true, placeholder: m === 'json' ? '{\n  "key": "{{variable}}"\n}' : '' });
        if (m === 'json') {
          tools.append(h('span', { class: 'spacer' }), h('button', {
            class: 'btn sm', onclick: () => {
              try {
                const holders = [];
                const src = item.body.content.replace(/"?\{\{[^{}]+\}\}"?/g, (x) => { holders.push(x); return `"__RINGAN_${holders.length - 1}__"`; });
                item.body.content = JSON.stringify(JSON.parse(src), null, 2).replace(/"__RINGAN_(\d+)__"/g, (_, i) => holders[i]);
                ta.value = item.body.content;
                save(); check();
              } catch (e) { toast('JSON tidak valid: ' + e.message, true); }
            },
          }, 'Rapikan JSON'));
        }
        body.append(ta, warn);
        check();
      } else if (m === 'form') {
        body.append(kvTable(item.body.form, {}));
      } else if (m === 'multipart') {
        body.append(kvTable(item.body.form, { multipart: true }), h('p', { class: 'help' }, 'Content-Type multipart beserta boundary diatur otomatis.'));
      } else {
        body.append(h('p', { class: 'help' }, 'Request ini tidak mengirim body.'));
      }
    } else if (tab === 'headers') {
      body.append(kvTable(item.headers, { keyPh: 'Header', valPh: 'Value', onChange: updateBadges }));
      const inh = mergedHeaders(null, ancestors, col);
      if (inh.length) {
        body.append(h('div', { class: 'inherited' }, h('div', { class: 'section-title' }, 'Diwarisi (bisa ditimpa header di atas)'),
          h('table', null, inh.map((x) => h('tr', null, h('td', null, x.key), h('td', null, x.value), h('td', { class: 'muted' }, x.from))))));
      }
      body.append(h('p', { class: 'help' }, 'Content-Type ditambahkan otomatis sesuai mode body jika belum di-set. Header Authorization dari tab Auth.'));
    } else if (tab === 'auth') {
      body.append(authEditor(item.auth, { allowInherit: true, inheritedFrom: () => resolveAuth({ auth: { type: 'inherit' } }, ancestors, col), onChange: updateBadges }));
    } else if (tab === 'vars') {
      body.append(kvTable(item.vars, { keyPh: 'nama', valPh: 'nilai', onChange: updateBadges }),
        h('p', { class: 'help' }, 'Variabel khusus request ini. Urutan prioritas: runtime (bru.setVar) > request > environment > koleksi.'));
      const rt = rtVars[col.id] || {};
      if (Object.keys(rt).length) {
        body.append(h('div', { class: 'section-title' }, 'Runtime vars koleksi ini', h('button', { class: 'btn sm', onclick: () => { rtVars[col.id] = {}; renderReqPane(); } }, 'Kosongkan')),
          h('table', { class: 'hdr-table' }, Object.entries(rt).map(([k, v]) => h('tr', null, h('td', null, k), h('td', null, typeof v === 'string' ? v : JSON.stringify(v))))));
      }
    } else if (tab === 'script') {
      let preTa, postTa;
      preTa = codeArea(item.preScript, (v) => { item.preScript = v; save(); }, { placeholder: '// dijalankan sebelum request dikirim\n// req.setHeader("X-Time", Date.now());', minHeight: '140px' });
      postTa = codeArea(item.postScript, (v) => { item.postScript = v; save(); }, { placeholder: '// dijalankan setelah response diterima\n// bru.setEnvVar("token", res.body.token);', minHeight: '140px' });
      body.append(h('div', { class: 'section-title' }, 'Pre-request'), snippetBar(SNIPPETS.pre, () => preTa, (v) => { item.preScript = v; save(); }), preTa,
        h('div', { class: 'section-title' }, 'Post-response'), snippetBar(SNIPPETS.post, () => postTa, (v) => { item.postScript = v; save(); }), postTa,
        h('p', { class: 'help' }, 'API tersedia: ', h('code', null, 'req'), ' ', h('code', null, 'res'), ' ', h('code', null, 'bru'), ' ', h('code', null, 'test()'), ' ', h('code', null, 'expect()'), ' ', h('code', null, 'console'), ' dan ', h('code', null, 'pm.*'), ' (kompatibel Postman dasar). Script berjalan terisolasi tanpa akses jaringan.'));
    } else if (tab === 'assert') {
      body.append(kvTable(item.asserts, { keyLabel: 'Ekspresi', valLabel: 'Operator & nilai', keyPh: 'res.status', valPh: 'eq 200', onChange: updateBadges }),
        h('p', { class: 'help' }, 'Contoh: ', h('code', null, 'res.status'), ' → ', h('code', null, 'eq 200'), ';  ', h('code', null, 'res.body.data'), ' → ', h('code', null, 'isArray'), ';  ', h('code', null, 'res.body.items.length'), ' → ', h('code', null, 'gt 0'), ';  ', h('code', null, 'res.headers.content-type'), ' → ', h('code', null, 'contains json'), ';  ', h('code', null, 'res.responseTime'), ' → ', h('code', null, 'lt 1000')),
        h('p', { class: 'help' }, 'Operator: eq, neq, gt, gte, lt, lte, in, notIn, contains, notContains, length, matches, notMatches, startsWith, endsWith, between, isEmpty, isNotEmpty, isNull, isUndefined, isDefined, isTruthy, isFalsy, isJson, isNumber, isString, isBoolean, isArray.'));
    } else if (tab === 'tests') {
      body.classList.add('fill');
      let ta;
      ta = codeArea(item.tests, (v) => { item.tests = v; save(); updateBadges(); }, { grow: true, placeholder: 'test("status 200", () => {\n  expect(res.status).to.equal(200);\n});' });
      body.append(snippetBar(SNIPPETS.tests, () => ta, (v) => { item.tests = v; save(); updateBadges(); }), ta);
    } else if (tab === 'schema') {
      body.classList.add('fill');
      const has = item.responseSchemas && Object.keys(item.responseSchemas).length;
      const warn = h('div', { class: 'warn-line' });
      const chk = h('input', { type: 'checkbox', checked: !!item.schemaCheck, onchange: (e) => { item.schemaCheck = e.target.checked; save(); updateBadges(); } });
      const ta = codeArea(has ? JSON.stringify(item.responseSchemas, null, 2) : '', (v) => {
        if (!v.trim()) { delete item.responseSchemas; warn.textContent = ''; save(); updateBadges(); return; }
        try {
          const parsed = JSON.parse(v);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('harus object { "200": { ...schema } }');
          item.responseSchemas = parsed;
          warn.textContent = '';
          save();
          updateBadges();
        } catch (e) { warn.textContent = 'Belum disimpan, JSON tidak valid: ' + e.message; }
      }, { grow: true, placeholder: '{\n  "200": {\n    "type": "object",\n    "required": ["id", "name"],\n    "properties": {\n      "id": { "type": "integer" },\n      "name": { "type": "string" }\n    }\n  }\n}' });
      const refs = col.openapi && col.openapi.components && Object.keys(col.openapi.components.schemas || {}).length + Object.keys(col.openapi.definitions || {}).length;
      body.append(
        h('label', { class: 'row', style: { marginBottom: '8px' } }, chk, 'Validasi response terhadap schema setiap kali request dikirim'),
        ta, warn,
        h('p', { class: 'help' }, 'Format: kunci = status code (', h('code', null, '200'), ', ', h('code', null, '4XX'), ', ', h('code', null, 'default'), '), nilai = JSON Schema / OpenAPI schema. Diisi otomatis saat import OpenAPI (JSON/YAML). ',
          refs ? `Referensi $ref ke ${refs} schema komponen dari spec ikut dipakai.` : 'Mendukung type, required, properties, items, enum, nullable, oneOf/anyOf/allOf, format, min/max, pattern, additionalProperties.'),
        h('p', { class: 'help' }, 'Hasil validasi muncul di tab Tests pada response, juga di Runner dan CLI.'));
    } else if (tab === 'ai') {
      aiTab(body, loc);
    } else if (tab === 'docs') {
      body.classList.add('fill');
      body.append(codeArea(item.docs, (v) => { item.docs = v; save(); }, { grow: true, placeholder: 'Catatan / dokumentasi request ini' }));
    }
  }

  // ================================================================ response pane
  function renderResPane() {
    const p = cur.resPane;
    if (!p) return;
    p.replaceChildren();
    const r = results[cur.loc.item.id];
    if (cur.loadingId && cur.loadingId === cur.loc.item.id) {
      p.append(h('div', { class: 'res-empty' }, h('div', { class: 'spinner' }), 'Mengirim request…', h('button', { class: 'btn sm', onclick: () => cur.abort && cur.abort.abort() }, 'Batal')));
      return;
    }
    if (!r) {
      p.append(h('div', { class: 'res-empty' }, h('div', { class: 'big' }, '⏎'), h('div', null, 'Tekan ', h('kbd', null, 'Ctrl'), ' + ', h('kbd', null, 'Enter'), ' atau klik Send.')));
      return;
    }
    renderResult(p, r, renderResPane);
  }
  /** Renders a request result (status, body, headers, tests, timeline) into a container. */
  function renderResult(p, r, rerender) {
    p.replaceChildren();
    const resp = r.response;
    const total = (r.tests || []).length;
    const passed = (r.tests || []).filter((t) => t.passed).length;
    const meta = h('div', { class: 'res-meta' });
    if (resp) {
      meta.append(h('span', { class: 'status s' + String(resp.status)[0] }, `${resp.status} ${resp.statusText || ''}`.trim()),
        h('span', { class: 'muted' }, fmtMs(resp.timeMs)), h('span', { class: 'muted' }, fmtSize(resp.size)));
    } else meta.append(h('span', { class: 'status serr' }, r.skipped ? 'Dilewati' : 'Error'));
    if (total) meta.append(h('span', { class: 'pill ' + (passed === total ? 'pass' : 'fail') }, `Tests ${passed}/${total}`));
    meta.append(h('span', { class: 'spacer' }), h('span', { class: 'muted' }, new Date(r.at || Date.now()).toLocaleTimeString()));
    const tabs = [
      ['body', 'Body'],
      ['headers', 'Headers', resp ? resp.headerList.length : ''],
      ['tests', 'Tests', total ? `${passed}/${total}` : ''],
      ['timeline', 'Timeline', (r.logs || []).length || ''],
    ];
    if (!tabs.some(([id]) => id === ui.resTab)) ui.resTab = 'body';
    const body = h('div', { class: 'tab-body' });
    p.append(meta, tabsBar(tabs, ui.resTab, (id) => { ui.resTab = id; persistUi(); rerender(); }), body);

    const errs = [];
    if (r.error) errs.push(h('div', { class: 'errbox' }, (r.phase === 'pre-request' ? 'Gagal di pre-request script:\n' : '') + r.error));
    if (r.scriptError) errs.push(h('div', { class: 'errbox' }, r.scriptError));
    if (r.unresolved && r.unresolved.length) errs.push(h('div', { class: 'warnbox' }, `Variabel tidak ditemukan: ${r.unresolved.map((x) => `{{${x}}}`).join(', ')}. Cek environment yang aktif.`));

    if (ui.resTab === 'body') {
      body.append(...errs);
      if (resp) body.append(responseBody(r, rerender));
    } else if (ui.resTab === 'headers') {
      if (resp) body.append(h('table', { class: 'hdr-table' }, resp.headerList.map(([k, v]) => h('tr', null, h('td', null, k), h('td', null, v)))));
    } else if (ui.resTab === 'tests') {
      body.append(...errs.filter((x) => x.className === 'errbox'));
      body.append(testList(r.tests || []));
      if (!total) body.append(h('p', { class: 'help' }, 'Belum ada assertion atau test. Tambahkan di tab Assert atau Tests pada request.'));
    } else {
      body.append(timeline(r));
    }
  }
  function testList(tests) {
    return h('ul', { class: 'tlist' }, tests.map((t) => h('li', null,
      h('span', { class: 'ic ' + (t.passed ? 'pass' : 'fail') }, t.passed ? '✓' : '✗'),
      h('span', null, t.kind === 'assert' || t.kind === 'schema' ? h('span', { class: 'muted' }, t.kind + '  ') : null, t.name),
      t.error ? h('span', { class: 'err' }, t.error) : null)));
  }
  function highlightJson(text) {
    const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc.replace(/("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, (m, str, colon, bool) => {
      if (str) return colon ? `<span class="j-key">${str}</span>${colon}` : `<span class="j-str">${str}</span>`;
      if (bool) return `<span class="j-bool">${m}</span>`;
      if (m === 'null') return `<span class="j-null">${m}</span>`;
      return `<span class="j-num">${m}</span>`;
    });
  }
  function getPath(obj, path) {
    const parts = [];
    String(path).replace(/^\$\.?/, '').replace(/\[(\d+|"[^"]*"|'[^']*')\]|[^.[\]]+/g, (m, br) => { parts.push(br != null ? (/^\d+$/.test(br) ? Number(br) : br.slice(1, -1)) : m); return m; });
    let c = obj;
    for (const p of parts) { if (c == null) return undefined; c = c[p]; }
    return c;
  }
  function download(name, data, type) {
    const a = h('a', { href: URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type })), download: name });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function responseBody(r, rerender) {
    const resp = r.response;
    const wrap = h('div');
    const ct = resp.contentType || '';
    if (resp.bodyText == null) {
      if (/^image\//.test(ct) && resp.bodyBase64) wrap.append(h('img', { class: 'preview', src: `data:${ct};base64,${resp.bodyBase64}`, alt: 'response image' }));
      else wrap.append(h('p', { class: 'help' }, `Response biner (${ct || 'tanpa content-type'}, ${fmtSize(resp.size)}).`));
      if (resp.bodyBase64) {
        wrap.append(h('button', { class: 'btn sm', onclick: () => { const bin = Uint8Array.from(atob(resp.bodyBase64), (c) => c.charCodeAt(0)); download('response', new Blob([bin], { type: ct })); } }, 'Download'));
      }
      return wrap;
    }
    const isHtml = /html/i.test(ct);
    const modes = r.isJson ? [['pretty', 'Pretty'], ['raw', 'Raw']] : isHtml ? [['raw', 'Raw'], ['preview', 'Preview']] : [['raw', 'Raw']];
    if (!modes.some(([m]) => m === ui.resMode)) ui.resMode = modes[0][0];
    const out = h('div');
    const filter = r.isJson ? h('input', { class: 'inp filter', placeholder: 'Filter, mis. data.items[0].id', value: ui.resFilter, spellcheck: 'false', oninput: (e) => { ui.resFilter = e.target.value; draw(); } }) : null;
    const draw = () => {
      out.replaceChildren();
      if (ui.resMode === 'preview') { out.append(h('iframe', { class: 'preview', sandbox: '', srcdoc: resp.bodyText, title: 'HTML preview' })); return; }
      let text = resp.bodyText;
      if (r.isJson && ui.resMode === 'pretty') {
        let data = JSON.parse(resp.bodyText);
        if (ui.resFilter.trim()) data = getPath(data, ui.resFilter.trim());
        text = data === undefined ? '(tidak ada nilai di path ini)' : JSON.stringify(data, null, 2);
        const pre = h('pre', { class: 'body' });
        if (text.length < 1.5e6) pre.innerHTML = highlightJson(text); else pre.textContent = text;
        out.append(pre);
        return;
      }
      out.append(h('pre', { class: 'body' }, text.length > 5e6 ? text.slice(0, 5e6) + '\n… (dipotong)' : text));
    };
    const segs = h('div', { class: 'seg' }, modes.map(([m, l]) => h('button', { class: ui.resMode === m ? 'on' : '', onclick: () => { ui.resMode = m; rerender(); } }, l)));
    wrap.append(h('div', { class: 'res-tools' }, segs, filter,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn sm', onclick: () => navigator.clipboard.writeText(resp.bodyText).then(() => toast('Body disalin')) }, 'Copy'),
      h('button', { class: 'btn sm', onclick: () => download(r.isJson ? 'response.json' : 'response.txt', resp.bodyText, ct || 'text/plain') }, 'Simpan')), out);
    draw();
    return wrap;
  }
  function timeline(r) {
    const box = h('div');
    const w = r.request;
    const resp = r.response;
    if (w) {
      const sentHeaders = resp && resp.sent ? resp.sent.headers : w.headers;
      box.append(h('div', { class: 'section-title' }, 'Request'),
        h('pre', { class: 'body' }, `${w.method} ${w.url}\n` + sentHeaders.map(([k, v]) => `${k}: ${/^authorization$/i.test(k) ? v.replace(/^(\w+\s+).*/, '$1••••••') : v}`).join('\n')));
      if (w.body.type === 'text') box.append(h('pre', { class: 'body', style: { marginTop: '6px' } }, w.body.text.length > 200000 ? w.body.text.slice(0, 200000) + '\n…' : w.body.text));
      if (w.body.type === 'multipart') box.append(h('pre', { class: 'body', style: { marginTop: '6px' } }, w.body.parts.map((p) => (p.file ? `${p.name} = @${p.fileName}` : `${p.name} = ${p.value}`)).join('\n')));
    }
    if (resp) {
      box.append(h('div', { class: 'section-title' }, 'Response'),
        h('pre', { class: 'body' }, [...(resp.redirects || []).map((x) => `${x.status} → redirect dari ${x.url}`), `${resp.status} ${resp.statusText}  ·  total ${fmtMs(resp.timeMs)}  ·  TTFB ${fmtMs(resp.ttfbMs)}  ·  ${fmtSize(resp.size)}`, `URL akhir: ${resp.url}`].join('\n')));
    }
    if (r.error) box.append(h('div', { class: 'section-title' }, 'Error'), h('div', { class: 'errbox' }, r.error));
    box.append(h('div', { class: 'section-title' }, 'Console script'));
    if ((r.logs || []).length) box.append(h('div', { class: 'logs' }, r.logs.map((l) => h('div', { class: 'log ' + l.level }, l.msg))));
    else box.append(h('p', { class: 'help' }, 'Tidak ada output console.log dari script.'));
    return box;
  }

  // ================================================================ history
  let historyIndex = [];
  const historyFull = new Map();
  async function loadHistory() {
    try { historyIndex = await api('/api/history', undefined, 'GET'); } catch { historyIndex = []; }
  }
  function recordHistory(loc, r) {
    if (!r || r.skipped || (!r.request && !r.error)) return;
    const resp = r.response;
    const entry = {
      at: r.at || Date.now(), reqId: loc.item.id, colId: loc.col.id, colName: loc.col.name, name: loc.item.name,
      method: r.request ? r.request.method : loc.item.method, url: r.request ? r.request.url : loc.item.url,
      status: resp ? resp.status : null, timeMs: resp ? resp.timeMs : null, error: r.error || r.scriptError || null,
      testsPassed: (r.tests || []).filter((t) => t.passed).length, testsTotal: (r.tests || []).length,
      request: r.request || null, response: resp || null, logs: r.logs || [], tests: r.tests || [], isJson: !!r.isJson,
    };
    api('/api/history', entry).then(loadHistory).then(() => renderSidebar()).catch(() => {});
  }
  function renderHistoryList(tree, f) {
    const list = historyIndex.filter((e) => !f || `${e.name} ${e.url} ${e.method} ${e.status} ${e.colName}`.toLowerCase().includes(f));
    if (!list.length) {
      tree.append(h('div', { class: 'empty-side' }, historyIndex.length ? 'Tidak ada yang cocok.' : 'Belum ada history. Setiap request yang Anda kirim akan tercatat di sini (maks. 300 terakhir).'));
      return;
    }
    let lastDay = '';
    const today = new Date().toDateString();
    for (const e of list) {
      const d = new Date(e.at);
      const day = d.toDateString() === today ? 'Hari ini' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      if (day !== lastDay) { tree.append(h('div', { class: 'hday' }, day)); lastDay = day; }
      const sc = e.status == null ? 'serr' : 's' + String(e.status)[0];
      const testsBad = e.testsTotal && e.testsPassed < e.testsTotal;
      tree.append(h('div', {
        class: 'node hist' + (ui.sel === 'h:' + e.id ? ' active' : ''), title: `${e.method} ${e.url}\n${d.toLocaleString()}`,
        onclick: () => select('h:' + e.id),
      },
      h('span', { class: 'mbadge m-' + e.method.toLowerCase() }, shortMethod(e.method)),
      h('span', { class: 'name' }, e.name || e.url, h('small', null, d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' + e.url)),
      testsBad ? h('span', { class: 'dot fail', title: `Tests ${e.testsPassed}/${e.testsTotal}` }) : null,
      h('span', { class: 'hstat status ' + sc }, e.status ?? 'ERR')));
    }
    tree.append(h('div', { class: 'hfoot' }, h('button', { class: 'btn sm ghost danger', onclick: clearHistory }, 'Hapus semua history')));
  }
  async function clearHistory() {
    if (!(await confirmDialog('Hapus semua history?', `${historyIndex.length} entri history akan dihapus permanen.`))) return;
    try {
      await api('/api/history', undefined, 'DELETE');
      historyIndex = [];
      historyFull.clear();
      ui.tabs = ui.tabs.filter((t) => !String(t).startsWith('h:'));
      if (String(ui.sel).startsWith('h:')) ui.sel = ui.tabs[0] || null;
      persistUi();
      renderSidebar();
      renderMain();
    } catch (e) { toast(e.message, true); }
  }
  function requestSummary(w, sent) {
    if (!w) return h('p', { class: 'help' }, 'Request tidak sempat dikirim (gagal di pre-request script).');
    const body = w.body && w.body.type !== 'none'
      ? [h('div', { class: 'section-title' }, 'Body'), h('pre', { class: 'body' }, w.body.type === 'text' ? w.body.text : (w.body.parts || []).map((p) => (p.file ? `${p.name} = @${p.fileName}` : `${p.name} = ${p.value}`)).join('\n'))]
      : null;
    const headers = sent && sent.headers ? sent.headers : w.headers;
    return h('div', null, h('div', { class: 'section-title' }, 'Headers'),
      headers.length ? h('table', { class: 'hdr-table' }, headers.map(([k, v]) => h('tr', null, h('td', null, k), h('td', null, v)))) : h('p', { class: 'help' }, 'Tidak ada header.'), body);
  }
  function historyView(id) {
    const wrap = h('div', { class: 'cview' });
    const draw = (e) => {
      const r = {
        at: e.at, request: e.request, response: e.response, logs: e.logs || [], tests: e.tests || [], isJson: e.isJson,
        error: e.error && !e.response ? e.error : null, scriptError: e.error && e.response ? e.error : null,
      };
      const orig = e.reqId && locate(e.reqId);
      const top = h('div', { class: 'topbar' },
        h('div', { class: 'title' }, h('span', { class: 'crumbs' }, `History${e.colName ? ' · ' + e.colName : ''} /`), h('b', { class: 'hist-title' }, e.name || e.url), h('span', { class: 'muted' }, new Date(e.at).toLocaleString())),
        orig ? h('button', { class: 'btn sm', onclick: () => select(e.reqId) }, 'Buka request asal') : null,
        h('button', { class: 'btn sm', onclick: () => saveHistoryAsRequest(e) }, 'Simpan sebagai request baru'));
      const urlbar = h('div', { class: 'urlbar' }, h('span', { class: 'method-ro m-' + e.method.toLowerCase() }, e.method), h('input', { class: 'url', value: e.url, readonly: true }));
      const reqPane = h('section', { class: 'pane req-pane' }, h('div', { class: 'tabs' }, h('span', { class: 'tab active' }, 'Request yang dikirim')), h('div', { class: 'tab-body' }, requestSummary(e.request, e.response && e.response.sent)));
      const resPane = h('section', { class: 'pane res-pane' });
      const rr = () => renderResult(resPane, r, rr);
      rr();
      wrap.replaceChildren(top, urlbar, h('div', { class: 'workspace' }, reqPane, resPane));
    };
    if (historyFull.has(id)) draw(historyFull.get(id));
    else {
      wrap.append(h('div', { class: 'res-empty' }, h('div', { class: 'spinner' })));
      api('/api/history/' + encodeURIComponent(id), undefined, 'GET').then(
        (e) => { historyFull.set(id, e); draw(e); },
        (err) => wrap.replaceChildren(h('div', { class: 'empty-main' }, err.message)));
    }
    return wrap;
  }
  function saveHistoryAsRequest(e) {
    const col = (e.colId && store.collections.find((c) => c.id === e.colId)) || store.collections[0];
    if (!col) { toast('Buat koleksi dulu untuk menyimpan request', true); return; }
    const w = e.request || { method: e.method, url: e.url, headers: [], body: { type: 'none' } };
    const skip = /^(content-length|user-agent|accept|host)$/i;
    const headers = w.headers.filter(([k]) => !skip.test(k)).map(([k, v]) => kv(k, v));
    const ct = (w.headers.find(([k]) => /^content-type$/i.test(k)) || [])[1] || '';
    let body = { mode: 'none', content: '', form: [] };
    if (w.body && w.body.type === 'text') {
      if (/json/i.test(ct)) { let c = w.body.text; try { c = JSON.stringify(JSON.parse(c), null, 2); } catch {} body = { mode: 'json', content: c, form: [] }; }
      else if (/xml/i.test(ct)) body = { mode: 'xml', content: w.body.text, form: [] };
      else if (/x-www-form-urlencoded/i.test(ct)) {
        const dec = (x) => { try { return decodeURIComponent(x.replace(/\+/g, ' ')); } catch { return x; } };
        body = { mode: 'form', content: '', form: w.body.text.split('&').filter(Boolean).map((p) => { const i = p.indexOf('='); return kv(dec(i < 0 ? p : p.slice(0, i)), dec(i < 0 ? '' : p.slice(i + 1))); }) };
      } else body = { mode: 'text', content: w.body.text, form: [] };
    } else if (w.body && w.body.type === 'multipart') {
      body = { mode: 'multipart', content: '', form: w.body.parts.map((p) => Object.assign(kv(p.name, p.file ? '' : p.value), { type: p.file ? 'file' : 'text', fileName: p.fileName })) };
    }
    const keepCT = body.mode === 'text';
    const filtered = headers.filter((x) => !/^content-type$/i.test(x.key) || keepCT);
    const r = normRequest({ name: (e.name || 'Request') + ' (dari history)', method: w.method, url: w.url, headers: filtered, body, auth: { type: 'none' } });
    syncParamsFromUrl(r);
    col.items.push(r);
    ui.expanded.add(col.id);
    save();
    select(r.id);
    toast(`Disimpan ke koleksi "${col.name}". Nilai variabel sudah terisi (bukan {{variabel}}); auth disalin sebagai header.`);
  }

  // ================================================================ updates & changelog
  let updateInfo = null;
  let appVersion = '';
  let updateCardDismissed = false;
  const platformLabel = (kind) => ({ win: 'Windows', portable: 'Windows Portable', mac: 'macOS', linux: 'Linux' }[kind] || '');
  const fmtDate = (d) => { if (!d) return ''; const t = new Date(d); return isNaN(t) ? d : t.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }); };
  const openExternal = (url) => { if (url) window.open(url, '_blank', 'noopener'); };

  function renderVersionFoot() {
    const b = $('#verBtn');
    if (!b) return;
    b.replaceChildren(`v${appVersion}`, updateInfo && updateInfo.hasUpdate ? h('span', { class: 'upd-dot', title: `Versi ${updateInfo.latest} tersedia` }) : null);
    b.title = updateInfo && updateInfo.hasUpdate ? `Versi ${updateInfo.latest} tersedia — klik untuk melihat perubahan` : 'Riwayat perubahan';
  }

  function downloadButton(info, cls = 'btn sm primary') {
    if (info.download) {
      const mb = info.download.size ? ` (${(info.download.size / 1048576).toFixed(0)} MB)` : '';
      return h('button', { class: cls, onclick: () => { openExternal(info.download.url); toast(`Mengunduh ${info.download.name}. Tutup Ringan API lalu jalankan installer untuk memperbarui; data Anda tetap aman.`); } }, `Unduh untuk ${platformLabel(info.kind)}${mb}`);
    }
    return h('button', { class: cls, onclick: () => openExternal(info.releaseUrl) }, 'Buka halaman rilis');
  }

  function showUpdateCard() {
    const info = updateInfo;
    let card = $('#updateCard');
    if (card) card.remove();
    if (!info || !info.hasUpdate || updateCardDismissed) return;
    const latest = info.newer[0];
    // First bullet points of the notes, as plain text (no headings, no markdown syntax).
    const preview = String(latest.notes || '').split('\n').filter((l) => /^\s*[-*]\s+/.test(l))
      .map((l) => l.replace(/^\s*[-*]\s+/, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`/g, '').trim()).filter(Boolean).slice(0, 3);
    card = h('div', { id: 'updateCard', class: 'update-card', role: 'status' },
      h('div', { class: 'row' }, h('span', { class: 'upd-badge' }, '↑'), h('b', null, `Versi ${latest.version} tersedia`), h('span', { class: 'muted' }, `· Anda memakai v${info.current}`),
        h('span', { class: 'spacer' }), h('button', { class: 'icon-btn', title: 'Tutup', onclick: () => { updateCardDismissed = true; card.remove(); } }, '×')),
      info.newer.length > 1 ? h('div', { class: 'muted' }, `${info.newer.length} versi baru sejak versi Anda.`) : null,
      preview.length ? h('ul', { class: 'upd-preview' }, preview.map((p) => h('li', null, p))) : null,
      info.kind === 'node' ? h('div', { class: 'help' }, 'Versi Node: perbarui dengan git pull lalu npm install, atau unduh installer desktop.') : null,
      h('div', { class: 'row', style: { marginTop: '8px' } },
        downloadButton(info),
        h('button', { class: 'btn sm', onclick: () => openChangelog() }, 'Lihat perubahan'),
        h('button', { class: 'btn sm ghost', onclick: () => { ls.set('ringan.skipVersion', latest.version); updateCardDismissed = true; card.remove(); toast(`Notifikasi untuk v${latest.version} tidak akan muncul lagi. Versi berikutnya tetap diberitahukan.`); } }, 'Lewati versi ini')));
    document.body.append(card);
  }

  async function checkUpdates({ force = false, manual = false } = {}) {
    if (!manual && store && store.settings.checkUpdates === false) return null;
    try { updateInfo = await api('/api/update/check', { force }); } catch (e) { if (manual) toast(e.message, true); return null; }
    renderVersionFoot();
    if (manual) {
      if (updateInfo.error) toast(`Gagal cek update: ${updateInfo.error}`, true);
      else if (!updateInfo.hasUpdate) toast(`Anda sudah memakai versi terbaru (v${updateInfo.current}).`);
      else { updateCardDismissed = false; showUpdateCard(); }
    } else if (updateInfo.hasUpdate && ls.get('ringan.skipVersion') !== updateInfo.latest) showUpdateCard();
    return updateInfo;
  }

  async function openChangelog({ focus } = {}) {
    const m = modal('Riwayat perubahan', { wide: true });
    m.box.classList.add('changelog');
    const status = h('div', { class: 'row cl-status' }, h('span', { class: 'spinner sm' }), 'Memuat…');
    const list = h('div');
    m.body.append(status, list);
    m.foot.append(h('button', {
      class: 'btn', onclick: async (e) => { e.target.disabled = true; await checkUpdates({ force: true, manual: true }); e.target.disabled = false; m.close(); openChangelog(); },
    }, 'Cek update sekarang'), h('button', { class: 'btn primary', onclick: m.close }, 'Tutup'));
    let local;
    try { local = await api('/api/changelog', undefined, 'GET'); } catch (e) { status.replaceChildren(h('div', { class: 'errbox' }, e.message)); return; }
    if (!updateInfo && store.settings.checkUpdates !== false) await checkUpdates();
    const info = updateInfo;
    status.replaceChildren(
      h('span', null, 'Versi terpasang: ', h('b', null, `v${local.current}`)),
      info && info.hasUpdate ? h('span', { class: 'pill fail' }, `Versi ${info.latest} tersedia`) : info && !info.error ? h('span', { class: 'pill pass' }, 'Sudah versi terbaru') : null,
      info && info.error ? h('span', { class: 'muted' }, `Tidak bisa cek update: ${info.error}`) : null,
      store.settings.checkUpdates === false ? h('span', { class: 'muted' }, 'Cek update otomatis dimatikan') : null,
      h('span', { class: 'spacer' }),
      local.repo ? h('button', { class: 'link', onclick: () => openExternal(`https://github.com/${local.repo}/releases`) }, 'Semua rilis di GitHub') : null);

    const section = (title, items) => items.length ? [h('div', { class: 'section-title' }, title), ...items] : [];
    const card = (e, { isNew, isCurrent, unreleased } = {}) => {
      const el = h('details', { class: 'cl-entry' + (isNew ? ' new' : '') + (isCurrent ? ' current' : ''), open: isNew || isCurrent || (focus && e.version === focus) || null, 'data-version': e.version },
        h('summary', null,
          h('b', null, unreleased ? 'Belum dirilis' : `v${e.version}`),
          e.date ? h('span', { class: 'muted' }, fmtDate(e.date)) : null,
          isNew ? h('span', { class: 'pill fail' }, 'baru') : null,
          isCurrent ? h('span', { class: 'pill pass' }, 'terpasang') : null,
          unreleased ? h('span', { class: 'pill' }, 'build pengembangan') : null),
        h('div', { class: 'cl-body' }, e.body ? md(e.body) : h('p', { class: 'muted' }, 'Tidak ada catatan.'),
          isNew && info ? h('div', { class: 'row', style: { marginTop: '8px' } }, downloadButton({ ...info, download: e.version === info.latest ? info.download : null, releaseUrl: e.url })) : null));
      return el;
    };
    const newer = info && info.newer ? info.newer.map((r) => card({ version: r.version, date: r.publishedAt, body: r.notes, url: r.url }, { isNew: true })) : [];
    const entries = local.entries.filter((e) => !(e.unreleased && !e.body));
    const installed = entries.map((e) => card(e, { isCurrent: e.version === local.current, unreleased: e.unreleased }));
    list.replaceChildren(...section('Versi baru yang tersedia', newer), ...section('Riwayat versi', installed));
    if (focus) setTimeout(() => { const el = list.querySelector(`[data-version="${CSS.escape(focus)}"]`); if (el) el.scrollIntoView({ block: 'start' }); }, 0);
  }

  /** After an update, show what changed in the installed version once. */
  function showWhatsNew() {
    const last = ls.get('ringan.lastVersion');
    ls.set('ringan.lastVersion', appVersion);
    if (last && last !== appVersion) {
      toast(`Ringan API diperbarui ke v${appVersion}.`);
      openChangelog({ focus: appVersion });
    }
  }

  // ================================================================ AI assistant (multi-provider)
  let aiCfg = null;
  const aiThreads = {}; // request id -> [{ role, content, view }]
  const AI_SYSTEM = [
    'Kamu adalah asisten testing API di dalam aplikasi Ringan API. Jawab dalam Bahasa Indonesia, ringkas, konkret, dan akurat.',
    'Sintaks Ringan yang harus kamu pakai:',
    '- Assertion deklaratif: {"key": "<ekspresi>", "value": "<operator> <nilai>"}. Ekspresi: res.status, res.body.<path> (mis. res.body.data[0].id, res.body.items.length), res.headers.<nama-header>, res.responseTime.',
    '  Operator: eq, neq, gt, gte, lt, lte, in, notIn, contains, notContains, length, matches, notMatches, startsWith, endsWith, between, isEmpty, isNotEmpty, isNull, isUndefined, isDefined, isTruthy, isFalsy, isJson, isNumber, isString, isBoolean, isArray. Operator is* ditulis tanpa nilai (mis. "isArray").',
    '- Tests JavaScript: test("nama", () => { expect(res.status).to.equal(200); }); gaya Chai: to.equal, to.eql, to.be.a("string"), to.be.an("array"), to.have.property("id"), to.include, to.be.above, to.be.below, to.have.lengthOf, to.be.true.',
    '  Objek tersedia: res.status, res.body, res.getHeader(nama), res.responseTime, req, bru.setVar(k, v), bru.getVar(k), bru.setEnvVar(k, v), bru.getEnvVar(k).',
    '- Variabel ditulis {{nama}}. Path param ditulis /:nama di URL.',
    'Jangan mengarang field yang tidak ada di data. Nilai sensitif sudah disamarkan sebagai *** dan jangan ditebak.',
  ].join('\n');

  async function loadAiConfig(force) {
    if (aiCfg && !force) return aiCfg;
    try { aiCfg = await api('/api/ai/config', undefined, 'GET'); } catch { aiCfg = null; }
    return aiCfg;
  }
  const aiReady = (c) => { const p = c && c.providers[c.active]; return p && (!p.needsKey || p.hasKey) && p.model; };

  const SENSITIVE = /(authorization|cookie|token|secret|passw|api[-_]?key|session|credential|private)/i;
  function maskDeep(v) {
    if (Array.isArray(v)) return v.map(maskDeep);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SENSITIVE.test(k) && x !== null && typeof x !== 'object' ? '***' : maskDeep(x)]));
    return v;
  }
  function maskText(t) {
    try { return JSON.stringify(maskDeep(JSON.parse(t)), null, 2); } catch { return String(t ?? ''); }
  }
  const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + `\n… (dipotong, total ${s.length} karakter)` : s; };

  /** Builds the context sent to the AI; secrets and auth values are masked. */
  function aiContext(loc, result) {
    const { item, col, ancestors } = loc;
    const env = activeEnv(col);
    const secretKeys = new Set((env ? env.vars : []).filter((v) => v.secret).map((v) => v.key));
    const vars = Object.entries(Object.assign({}, kvObj(col.vars), env ? kvObj(env.vars) : {}))
      .map(([k, v]) => `${k}=${SENSITIVE.test(k) || secretKeys.has(k) ? '***' : cut(v, 200)}`);
    const headers = mergedHeaders(item, ancestors, col).map((x) => `${x.key}: ${SENSITIVE.test(x.key) ? '***' : x.value}`);
    const b = item.body;
    const body = b.mode === 'none' ? '(tanpa body)' : b.mode === 'json' ? cut(maskText(b.content), 6000)
      : b.mode === 'form' || b.mode === 'multipart' ? b.form.filter(on).map((f) => `${f.key}=${f.type === 'file' ? '(file)' : SENSITIVE.test(f.key) ? '***' : f.value}`).join('\n') : cut(b.content, 6000);
    const lines = [
      `Koleksi: ${col.name}${env ? ` (environment: ${env.name})` : ''}`,
      `Request: ${item.name}`,
      `${item.method} ${item.url}`,
      `Auth: ${resolveAuth(item, ancestors, col).type}`,
      `Headers:\n${headers.join('\n') || '-'}`,
      `Body (${b.mode}):\n${body}`,
      `Variabel: ${vars.join(', ') || '-'}`,
    ];
    if (item.docs.trim()) lines.push(`Dokumentasi:\n${cut(item.docs, 2000)}`);
    if (item.responseSchemas && Object.keys(item.responseSchemas).length) lines.push(`Schema response (OpenAPI):\n${cut(JSON.stringify(item.responseSchemas), 4000)}`);
    if (item.asserts.filter(on).length) lines.push(`Assertion yang sudah ada:\n${item.asserts.filter(on).map((a) => `${a.key}: ${a.value}`).join('\n')}`);
    if (item.tests.trim()) lines.push(`Tests yang sudah ada:\n${cut(item.tests, 3000)}`);
    if (result && result.response) {
      const r = result.response;
      const hdr = (r.headerList || []).filter(([k]) => /^(content-type|location|www-authenticate|retry-after|x-request-id|allow)$/i.test(k)).map(([k, v]) => `${k}: ${v}`).join('\n');
      lines.push(`Response terakhir: ${r.status} ${r.statusText || ''}, ${Math.round(r.timeMs)} ms, ${r.size} byte${hdr ? `\n${hdr}` : ''}`);
      lines.push(`Body response:\n${r.bodyText == null ? '(biner)' : cut(maskText(r.bodyText), 12000)}`);
    } else if (result && result.error) lines.push(`Request terakhir gagal sebelum ada response: ${result.error}`);
    if (result && (result.tests || []).length) lines.push(`Hasil test terakhir:\n${result.tests.map((t) => `${t.passed ? 'LULUS' : 'GAGAL'} ${t.name}${t.error ? ' — ' + t.error : ''}`).join('\n')}`);
    return lines.join('\n\n');
  }

  function extractJson(text) {
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    const candidates = [fence && fence[1], text, (() => { const a = text.indexOf('{'); const z = text.lastIndexOf('}'); return a >= 0 && z > a ? text.slice(a, z + 1) : null; })()];
    for (const c of candidates) { if (!c) continue; try { return JSON.parse(c.trim()); } catch {} }
    return null;
  }

  /** Minimal, safe markdown: escape first, then code fences, inline code, bold, headings. */
  function md(text) {
    const el = h('div', { class: 'md' });
    const parts = String(text || '').split(/```[\w-]*\n?/);
    parts.forEach((part, i) => {
      if (i % 2 === 1) { el.append(h('pre', { class: 'body' }, part.replace(/\n$/, ''))); return; }
      if (!part.trim()) return;
      const esc = part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/^#{1,4}\s+(.+)$/gm, '<b>$1</b>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)"'<>]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
      // Group "- item" / "* item" lines into real lists (content is already escaped above).
      let html = '';
      let inList = false;
      for (const line of esc.trim().split('\n')) {
        const li = /^\s*[-*]\s+(.*)$/.exec(line);
        if (li) { html += (inList ? '' : '<ul class="md-list">') + `<li>${li[1]}</li>`; inList = true; continue; }
        if (inList) { html += '</ul>'; inList = false; }
        html += line + '\n';
      }
      if (inList) html += '</ul>';
      el.append(h('div', { class: 'md-text', html: html.replace(/\n+$/, '') }));
    });
    return el;
  }

  const aiControllers = {}; // request id -> AbortController of the running stream

  /** Streams an AI answer from /api/ai/stream (NDJSON). onEvent gets delta/notice/status events; resolves with the final metadata. */
  async function aiStream(body, onEvent, signal) {
    const r = await fetch('/api/ai/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ringan-Token': TOKEN }, body: JSON.stringify(body), signal });
    if (r.status === 403) throw new Error('Sesi tidak valid (server mungkin di-restart). Muat ulang halaman (F5).');
    if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let done = null;
    const handle = (line) => {
      if (!line.trim()) return;
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      if (ev.t === 'error') throw new Error(ev.error);
      if (ev.t === 'done') done = ev; else onEvent(ev);
    };
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
    }
    handle(buf + dec.decode());
    if (!done) throw new Error('Koneksi ke AI terputus sebelum jawaban selesai.');
    return done;
  }

  async function aiAsk(loc, userText, { action, label } = {}) {
    const cfg = await loadAiConfig();
    if (!aiReady(cfg)) { openAiSettings(); toast('Atur provider AI dulu (API key & model).', true); return; }
    const id = loc.item.id;
    if (aiControllers[id]) { toast('AI masih menjawab. Tunggu atau klik Stop.', true); return; }
    const thread = (aiThreads[id] = aiThreads[id] || []);
    const context = aiContext(loc, results[id]);
    thread.push({ role: 'user', content: userText, label: label || userText, action });
    const msgs = thread.filter((m) => !m.error && m.content).slice(-12).map((m) => ({ role: m.role, content: m.content }));
    const last = { role: 'assistant', content: '', streaming: true, action, notices: [], status: 'Menghubungi AI…', context };
    thread.push(last);
    const ctrl = new AbortController();
    aiControllers[id] = ctrl;
    renderAiPanel();
    updateBadges();
    let raf = 0;
    const repaint = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paintLiveBubble(id, last); }); };
    try {
      const r = await aiStream({ system: `${AI_SYSTEM}\n\nKonteks request saat ini:\n${context}`, messages: msgs }, (ev) => {
        if (ev.t === 'delta') { last.content += ev.text; last.status = ''; }
        else if (ev.t === 'notice') last.notices.push(ev.text);
        else if (ev.t === 'status') last.status = ev.text;
        repaint();
      }, ctrl.signal);
      last.meta = `${r.providerLabel} · ${r.model} · ${(r.ms / 1000).toFixed(1)} s${r.usage && r.usage.output ? ` · ${r.usage.output} token` : ''}${r.truncated ? ' · terpotong (batas token)' : ''}`;
    } catch (e) {
      if (ctrl.signal.aborted) last.meta = 'Dihentikan oleh Anda';
      else if (last.content) last.meta = `Terputus: ${e.message}`;
      else last.error = e.message;
    } finally {
      cancelAnimationFrame(raf);
      last.streaming = false;
      last.status = '';
      delete aiControllers[id];
      if (cur.loc && cur.loc.item.id === id) { renderAiPanel(); updateBadges(); }
    }
  }
  function aiStop(id) { if (aiControllers[id]) aiControllers[id].abort(); }

  /** Updates only the streaming bubble (cheap), keeping the thread scrolled to the bottom if it was. */
  function paintLiveBubble(id, msg) {
    if (!cur.loc || cur.loc.item.id !== id) return;
    const el = document.getElementById('ai-live-' + id);
    if (!el) { renderAiPanel(); return; }
    const list = el.closest('.ai-thread');
    const atBottom = list && list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    el.replaceChildren(...liveBubbleContent(msg));
    if (list && atBottom) list.scrollTop = list.scrollHeight;
  }
  function liveBubbleContent(msg) {
    const nodes = [];
    for (const n of msg.notices || []) nodes.push(h('div', { class: 'ai-notice' }, n));
    if (msg.content) nodes.push(md(msg.content));
    if (msg.streaming) nodes.push(h('div', { class: 'ai-live-foot' }, h('span', { class: 'spinner sm' }), msg.status || (msg.content ? `menulis… ${msg.content.length} karakter` : 'menunggu…')));
    return nodes;
  }

  const AI_ACTIONS = {
    tests: {
      label: 'Buat test & assertion',
      prompt: 'Buat assertion dan test untuk request ini berdasarkan konteks (response terakhir dan/atau schema). Fokus: status code, struktur dan tipe field penting, nilai yang masuk akal, header content-type, waktu respons. Jangan duplikasi assertion yang sudah ada. Balas HANYA dengan satu blok ```json berisi {"asserts":[{"key":"res.status","value":"eq 200"}],"tests":"<kode JavaScript tests>","catatan":"<penjelasan singkat>"}.',
    },
    explain: {
      label: 'Jelaskan response / error',
      needsResult: true,
      prompt: 'Jelaskan response terakhir request ini: apakah sesuai harapan, arti status/error, kemungkinan penyebab, dan langkah perbaikan yang konkret (di sisi request maupun server). Gunakan poin-poin singkat.',
    },
    data: {
      label: 'Buat data uji',
      prompt: 'Buat 5-8 variasi input untuk menguji endpoint ini: 1-2 valid, sisanya kasus negatif/edge (field wajib hilang, tipe salah, nilai batas, string kosong atau sangat panjang, karakter khusus). Untuk request tanpa body, variasikan query param. Untuk tiap variasi tebak status yang diharapkan. Balas HANYA dengan satu blok ```json berisi {"variants":[{"name":"...","expectStatus":201,"body":{...},"query":{"param":"nilai"}}]} (body dan query opsional).',
    },
    review: {
      label: 'Review keamanan & kualitas',
      prompt: 'Review request dan response ini dari sisi kualitas dan keamanan API: validasi input, kebocoran data sensitif, kode status yang tepat, konsistensi format error, header keamanan, performa. Beri temuan berurutan dari yang paling penting, masing-masing dengan saran perbaikan singkat.',
    },
  };

  function renderAiAction(loc, msg) {
    const { item } = loc;
    const box = h('div');
    const data = extractJson(msg.content || '');
    if (msg.action === 'tests' && data && (Array.isArray(data.asserts) || data.tests)) {
      const asserts = (data.asserts || []).filter((a) => a && a.key);
      if (data.catatan) box.append(md(data.catatan));
      if (asserts.length) box.append(h('div', { class: 'section-title' }, 'Assertion'), h('pre', { class: 'body' }, asserts.map((a) => `${a.key}: ${a.value || ''}`).join('\n')));
      if (data.tests) box.append(h('div', { class: 'section-title' }, 'Tests'), h('pre', { class: 'body' }, data.tests));
      box.append(h('div', { class: 'row', style: { marginTop: '8px' } },
        asserts.length ? h('button', {
          class: 'btn sm primary', onclick: (e) => {
            let n = 0;
            for (const a of asserts) if (!item.asserts.some((x) => x.key === a.key && x.value === (a.value || ''))) { item.asserts.push(kv(a.key, String(a.value || ''))); n++; }
            save(); updateBadges(); e.target.disabled = true; e.target.textContent = `${n} assertion ditambahkan`;
          },
        }, `Tambahkan ${asserts.length} assertion`) : null,
        data.tests ? h('button', {
          class: 'btn sm', onclick: (e) => {
            item.tests = (item.tests.trim() ? item.tests.replace(/\s*$/, '\n\n') : '') + data.tests.trim() + '\n';
            save(); updateBadges(); e.target.disabled = true; e.target.textContent = 'Ditambahkan ke Tests';
          },
        }, 'Tambahkan ke Tests') : null));
      return box;
    }
    if (msg.action === 'data' && data && Array.isArray(data.variants)) {
      const variants = data.variants.filter((v) => v && (v.body !== undefined || v.query));
      const apply = (target, v) => {
        if (v.body !== undefined) { target.body = { ...target.body, mode: 'json', content: typeof v.body === 'string' ? v.body : JSON.stringify(v.body, null, 2) }; }
        if (v.query && typeof v.query === 'object') {
          for (const [k, val] of Object.entries(v.query)) { const p = target.params.find((x) => x.key === k); if (p) { p.value = String(val); p.enabled = true; } else target.params.push(kv(k, String(val))); }
          syncUrlFromParams(target);
        }
      };
      box.append(h('table', { class: 'hdr-table' }, variants.map((v) => h('tr', null,
        h('td', null, h('b', null, v.name || 'variasi'), v.expectStatus ? h('div', { class: 'muted' }, `harapan: ${v.expectStatus}`) : null),
        h('td', null, h('pre', { class: 'body mini' }, v.body !== undefined ? (typeof v.body === 'string' ? v.body : JSON.stringify(v.body, null, 2)) : `query: ${JSON.stringify(v.query)}`)),
        h('td', null, h('button', { class: 'btn sm', onclick: () => { apply(item, v); save(); renderReqPane(); if (cur.urlInput) cur.urlInput.value = item.url; toast(`Body/param diganti: ${v.name}`); } }, 'Pakai'))))));
      box.append(h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', {
        class: 'btn sm primary', onclick: (e) => {
          const folder = normFolder({ name: `Variasi: ${item.name}` });
          for (const v of variants) {
            const r = freshIds(clone(item));
            r.name = v.name || 'variasi';
            apply(r, v);
            if (v.expectStatus) r.asserts = [kv('res.status', `eq ${v.expectStatus}`)];
            r.tests = '';
            for (const k of ['specKey', 'specName', 'specDocs', 'specBodyHash', 'specParamKeys', 'specRemoved']) delete r[k];
            r.specDetached = true; // never matched to the spec by live sync
            folder.items.push(r);
          }
          (loc.parent || loc.col).items.push(folder);
          ui.expanded.add(folder.id);
          save(); renderSidebar();
          e.target.disabled = true; e.target.textContent = `${variants.length} request dibuat di folder "${folder.name}"`;
        },
      }, `Buat ${variants.length} request (dengan assertion status) di folder baru`)));
      return box;
    }
    return md(msg.content);
  }

  function renderAiPanel() {
    const body = cur.reqPane && cur.reqPane.querySelector('.ai-body');
    if (!body || !cur.loc) return;
    const loc = cur.loc;
    const thread = aiThreads[loc.item.id] || [];
    const list = body.querySelector('.ai-thread');
    list.replaceChildren(...thread.map((m) => {
      if (m.role === 'user') return h('div', { class: 'ai-msg user' }, h('div', { class: 'ai-bubble' }, m.label || m.content));
      if (m.streaming) return h('div', { class: 'ai-msg' }, h('div', { class: 'ai-bubble', id: 'ai-live-' + loc.item.id }, ...liveBubbleContent(m)));
      if (m.error) return h('div', { class: 'ai-msg' }, h('div', { class: 'errbox' }, m.error));
      return h('div', { class: 'ai-msg' }, h('div', { class: 'ai-bubble' }, ...(m.notices || []).map((n) => h('div', { class: 'ai-notice' }, n)), m.content ? renderAiAction(loc, m) : h('div', { class: 'muted' }, '(tidak ada jawaban)'),
        h('div', { class: 'ai-meta' }, m.meta || '', m.context ? h('details', null, h('summary', null, 'Data yang dikirim ke AI'), h('pre', { class: 'body mini' }, m.context)) : null)));
    }));
    list.scrollTop = list.scrollHeight;
    const busy = !!aiControllers[loc.item.id];
    const sendBtn = body.querySelector('.ai-send');
    const stopBtn = body.querySelector('.ai-stop');
    if (sendBtn) sendBtn.hidden = busy;
    if (stopBtn) stopBtn.hidden = !busy;
    for (const b of body.querySelectorAll('.ai-action')) b.disabled = busy;
  }

  function aiTab(body, loc) {
    body.classList.add('fill', 'ai-body');
    const cfg = aiCfg;
    const p = cfg && cfg.providers[cfg.active];
    const ready = aiReady(cfg);
    const input = h('textarea', {
      class: 'inp ai-input', rows: 2, placeholder: 'Tanya apa saja tentang request ini… (Enter kirim, Shift+Enter baris baru)',
      onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFree(); } },
    });
    const sendFree = () => { const t = input.value.trim(); if (!t) return; input.value = ''; aiAsk(loc, t); };
    body.append(
      h('div', { class: 'row ai-head' },
        h('span', { class: 'pill' + (ready ? ' pass' : '') }, ready ? `${p.label} · ${p.model}` : 'AI belum diatur'),
        h('span', { class: 'spacer' }),
        aiThreads[loc.item.id] && aiThreads[loc.item.id].length ? h('button', { class: 'btn sm ghost', onclick: () => { delete aiThreads[loc.item.id]; renderReqPane(); } }, 'Bersihkan') : null,
        h('button', { class: 'btn sm', onclick: openAiSettings }, 'Atur AI')),
      h('div', { class: 'snips' }, Object.entries(AI_ACTIONS).map(([id, a]) => h('button', {
        class: 'btn sm ai-action', onclick: () => {
          if (a.needsResult && !results[loc.item.id]) { toast('Kirim request dulu supaya AI bisa melihat response-nya.', true); return; }
          aiAsk(loc, a.prompt, { action: id, label: a.label });
        },
      }, a.label))),
      h('div', { class: 'ai-thread' }, !ready ? h('div', { class: 'help' }, 'Pilih provider AI (Claude, OpenAI, Gemini, Ollama lokal, OpenRouter, Groq, DeepSeek, atau server OpenAI-compatible) lalu isi API key di "Atur AI".') : h('div', { class: 'help' }, 'AI melihat request ini, response terakhir, schema, dan test yang ada. Header Authorization, cookie, token, password, dan variabel secret selalu disamarkan sebelum dikirim.')),
      h('div', { class: 'row ai-compose' }, h('div', { style: { flex: '1' } }, input),
        h('button', { class: 'btn primary ai-send', onclick: sendFree }, 'Kirim'),
        h('button', { class: 'btn danger ai-stop', hidden: true, onclick: () => aiStop(loc.item.id), title: 'Hentikan jawaban' }, 'Stop')));
    renderAiPanel();
    if (!aiCfg) loadAiConfig().then(() => { if (ui.reqTab === 'ai' && cur.reqPane) renderReqPane(); });
  }

  async function aiNewRequest(col, parent) {
    const cfg = await loadAiConfig();
    if (!aiReady(cfg)) { openAiSettings(); toast('Atur provider AI dulu.', true); return; }
    const m = modal('Buat request dengan AI', { wide: true });
    const ta = h('textarea', { class: 'inp', rows: 4, placeholder: 'Contoh: login dengan email dan password lalu simpan token ke environment; atau: ambil daftar order milik user 5 halaman 2' });
    const out = h('div');
    const btn = h('button', { class: 'btn primary' }, 'Buat');
    btn.onclick = async () => {
      const desc = ta.value.trim();
      if (!desc) return;
      btn.disabled = true;
      const status = h('span', null, 'AI sedang menyusun request…');
      const preview = h('pre', { class: 'body mini', hidden: true });
      out.replaceChildren(h('div', { class: 'row muted', style: { marginTop: '8px' } }, h('span', { class: 'spinner sm' }), status), preview);
      const env = activeEnv(col);
      const existing = [];
      eachRequest(col.items, (r) => { if (existing.length < 80) existing.push(`${r.method} ${r.url}  (${r.name})`); });
      const vars = Object.keys(Object.assign({}, kvObj(col.vars), env ? kvObj(env.vars) : {}));
      const system = `${AI_SYSTEM}\n\nKoleksi: ${col.name}\nVariabel tersedia: ${vars.join(', ') || '-'}\nAuth koleksi: ${(col.auth || {}).type}\nRequest yang sudah ada (contoh pola URL):\n${existing.join('\n') || '-'}`;
      const prompt = `Buat satu request API dari deskripsi berikut. Pakai pola URL dan variabel yang sudah ada (mis. {{baseUrl}}). Balas HANYA dengan satu blok \`\`\`json berisi {"name":"...","method":"GET|POST|PUT|PATCH|DELETE","url":"...","headers":[{"key":"...","value":"..."}],"body":{"mode":"none|json|text|form","content":"<untuk json/text, string>","form":[{"key":"...","value":"..."}]},"asserts":[{"key":"res.status","value":"eq 200"}],"tests":"<opsional>","postScript":"<opsional, mis. simpan token>"}.\n\nDeskripsi: ${desc}`;
      try {
        let text = '';
        const meta = await aiStream({ system, messages: [{ role: 'user', content: prompt }] }, (ev) => {
          if (ev.t === 'delta') { text += ev.text; preview.hidden = false; preview.textContent = text; preview.scrollTop = preview.scrollHeight; status.textContent = `AI menulis… ${text.length} karakter`; }
          else if (ev.t === 'status' && ev.text) status.textContent = ev.text;
        });
        const r = { ...meta, text };
        const d = extractJson(r.text);
        if (!d || !d.url) throw new Error('Jawaban AI tidak berisi request yang valid:\n' + r.text.slice(0, 500));
        const body = d.body && d.body.mode && d.body.mode !== 'none'
          ? { mode: ['json', 'text', 'xml', 'form'].includes(d.body.mode) ? d.body.mode : 'json', content: typeof d.body.content === 'string' ? d.body.content : JSON.stringify(d.body.content ?? {}, null, 2), form: (d.body.form || []).map((f) => kv(f.key, String(f.value ?? ''))) }
          : { mode: 'none', content: '', form: [] };
        const req = normRequest({
          name: d.name || 'Request dari AI', method: String(d.method || 'GET').toUpperCase(), url: d.url,
          headers: (d.headers || []).filter((x) => x && x.key).map((x) => kv(x.key, String(x.value ?? ''))),
          body, asserts: (d.asserts || []).filter((x) => x && x.key).map((x) => kv(x.key, String(x.value ?? ''))),
          tests: d.tests || '', postScript: d.postScript || '', docs: `Dibuat oleh AI (${r.providerLabel} · ${r.model}) dari: ${desc}`,
        });
        syncParamsFromUrl(req);
        (parent || col).items.push(req);
        ui.expanded.add(col.id);
        if (parent) ui.expanded.add(parent.id);
        save();
        m.close();
        select(req.id);
        toast('Request dibuat oleh AI. Periksa dulu sebelum dikirim.');
      } catch (e) {
        out.replaceChildren(h('div', { class: 'errbox', style: { marginTop: '8px' } }, e.message));
      } finally { btn.disabled = false; }
    };
    m.body.append(h('label', { class: 'blk' }, 'Jelaskan request yang Anda butuhkan'), ta, out,
      h('p', { class: 'help' }, `Provider: ${cfg.providers[cfg.active].label} · ${cfg.providers[cfg.active].model}. AI hanya menerima nama variabel dan daftar endpoint koleksi ini, bukan nilai rahasia.`));
    m.foot.append(h('button', { class: 'btn', onclick: m.close }, 'Batal'), btn);
    setTimeout(() => ta.focus(), 0);
  }

  async function openAiSettings() {
    const cfg = await loadAiConfig(true);
    if (!cfg) { toast('Gagal memuat pengaturan AI', true); return; }
    const m = modal('Pengaturan AI', { wide: true });
    const edits = {};
    let active = cfg.active;
    const list = h('div');
    const draw = () => {
      list.replaceChildren(...Object.entries(cfg.providers).map(([id, p]) => {
        const e = (edits[id] = edits[id] || {});
        const isActive = id === active;
        const modelIn = h('input', { class: 'inp', value: e.model ?? p.model ?? '', placeholder: id === 'anthropic' ? 'claude-opus-5-5' : 'klik "Ambil daftar model"', list: `models-${id}`, oninput: (ev) => { e.model = ev.target.value; } });
        const dl = h('datalist', { id: `models-${id}` });
        const keyIn = p.needsKey || id === 'custom' ? h('input', { class: 'inp', type: 'password', autocomplete: 'off', placeholder: p.hasKey ? `tersimpan (${p.keySource}); isi untuk mengganti` : 'API key', oninput: (ev) => { e.key = ev.target.value; } }) : null;
        const baseIn = id !== 'anthropic' ? h('input', { class: 'inp', value: e.baseUrl ?? p.baseUrl ?? '', placeholder: p.defaultBaseUrl, oninput: (ev) => { e.baseUrl = ev.target.value; } }) : null;
        const status = h('span', { class: 'muted' });
        const fetchModels = async () => {
          status.textContent = 'mengambil…';
          try {
            const r = await api('/api/ai/models', { provider: id, key: e.key || undefined, baseUrl: e.baseUrl || undefined });
            dl.replaceChildren(...r.models.map((x) => h('option', { value: x })));
            status.textContent = `${r.models.length} model tersedia, ketik atau pilih di kolom Model`;
            if (!modelIn.value && r.models.length) { modelIn.value = r.models[0]; e.model = r.models[0]; }
          } catch (err) { status.textContent = err.message; }
        };
        return h('div', { class: 'fmt ai-prov' + (isActive ? ' on' : '') },
          h('input', { type: 'radio', name: 'aiprov', checked: isActive, onchange: () => { active = id; draw(); } }),
          h('div', null,
            h('div', { class: 'row' }, h('b', null, p.label), p.hasKey || !p.needsKey ? h('span', { class: 'pill pass' }, p.needsKey ? 'key tersimpan' : 'tanpa key') : h('span', { class: 'pill' }, 'belum ada key'),
              p.keyUrl ? h('span', { class: 'muted' }, ' · ', p.keyUrl) : null),
            isActive ? h('div', { class: 'ai-fields' },
              keyIn ? field('API key', keyIn) : null,
              baseIn ? field('Base URL', baseIn) : null,
              field('Model', h('div', null, modelIn, dl)),
              h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: fetchModels }, 'Ambil daftar model'), status)) : null));
      }));
    };
    draw();
    const saveBtn = h('button', { class: 'btn primary' }, 'Simpan');
    const testBtn = h('button', { class: 'btn' }, 'Simpan & tes koneksi');
    const persist = async () => {
      const patch = { active, providers: {} };
      for (const [id, e] of Object.entries(edits)) {
        const p = {};
        if (e.model !== undefined) p.model = e.model;
        if (e.baseUrl !== undefined) p.baseUrl = e.baseUrl;
        if (e.key) p.key = e.key;
        if (Object.keys(p).length) patch.providers[id] = p;
      }
      aiCfg = await api('/api/ai/config', patch, 'PUT');
    };
    saveBtn.onclick = async () => { try { await persist(); m.close(); toast('Pengaturan AI disimpan'); if (cur.loc && ui.reqTab === 'ai') renderReqPane(); } catch (e) { toast(e.message, true); } };
    testBtn.onclick = async () => {
      testBtn.disabled = true;
      try {
        await persist();
        const r = await api('/api/ai/chat', { system: 'Balas singkat.', messages: [{ role: 'user', content: 'Balas hanya dengan kata: OK' }], maxTokens: 64 });
        toast(`Koneksi berhasil: ${r.providerLabel} · ${r.model} menjawab "${r.text.trim().slice(0, 40)}" (${(r.ms / 1000).toFixed(1)} s)`);
        if (cur.loc && ui.reqTab === 'ai') renderReqPane();
      } catch (e) { toast(e.message, true); } finally { testBtn.disabled = false; }
    };
    const clearKey = h('button', {
      class: 'btn ghost danger', onclick: async () => {
        if (!(await confirmDialog('Hapus API key?', `API key ${cfg.providers[active].label} yang tersimpan akan dihapus.`))) return;
        aiCfg = await api('/api/ai/config', { providers: { [active]: { key: '' } } }, 'PUT');
        m.close(); openAiSettings();
      },
    }, 'Hapus key provider ini');
    m.body.append(
      h('p', { class: 'help' }, `Pilih provider yang dipakai. API key disimpan di komputer ini${cfg.encryption === 'os-keychain' ? ', terenkripsi dengan keychain OS' : ' (versi Node: tidak terenkripsi; bisa juga lewat environment variable seperti ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY)'} dan hanya dikirim ke provider tersebut. Ollama dan server lokal tidak butuh key.`),
      list);
    m.foot.append(clearKey, h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: m.close }, 'Batal'), testBtn, saveBtn);
  }

  // ================================================================ live connection to the API project
  const liveBusy = new Set();
  let pendingMainRender = false;
  function safeRenderMain() {
    const a = document.activeElement;
    if (a && a.closest && a.closest('#main') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { pendingMainRender = true; return; }
    renderMain();
  }
  document.addEventListener('focusout', () => {
    if (!pendingMainRender) return;
    setTimeout(() => {
      const a = document.activeElement;
      if (a && a.closest && a.closest('#main') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
      pendingMainRender = false;
      renderMain();
    }, 0);
  });

  /** Applies a server-merged collection while keeping the same JS objects (open tabs/editors stay valid). */
  function reconcileItems(oldItems, newItems) {
    const old = new Map();
    (function idx(items) { for (const it of items) { old.set(it.id, it); if (it.type === 'folder') idx(it.items); } })(oldItems);
    const adopt = (o, n) => { for (const k of Object.keys(o)) if (!(k in n)) delete o[k]; return Object.assign(o, n); };
    const build = (items) => items.map((n) => {
      const o = old.get(n.id);
      if (n.type === 'folder') { const kids = build(n.items || []); return o ? adopt(o, { ...n, items: kids }) : normFolder({ ...n, items: kids }); }
      return o ? adopt(o, n) : normRequest(n);
    });
    return build(newItems);
  }
  function applyLiveCollection(col, fresh) {
    col.items = reconcileItems(col.items, fresh.items || []);
    for (const k of ['openapi', 'auth', 'vars', 'live']) if (fresh[k] !== undefined) col[k] = fresh[k];
  }
  const liveState = (col) => { const L = col.live || {}; return L.lastError ? 'err' : L.paused ? 'off' : L.pending ? 'pend' : 'ok'; };
  const liveTitle = (col) => {
    const L = col.live || {};
    if (L.lastError) return `Live: tidak terhubung (${L.lastError})`;
    if (L.paused) return 'Live: dijeda';
    if (L.pending) return 'Live: ada perubahan di spec, belum diterapkan';
    return `Live: terhubung ke ${L.location}`;
  };
  function updateLiveIndicators(col) {
    for (const d of document.querySelectorAll(`.livedot[data-col="${col.id}"]`)) { d.className = 'livedot ' + liveState(col); d.title = liveTitle(col); }
    const st = document.getElementById('live-status-' + col.id);
    if (st) st.replaceChildren(...liveStatusNodes(col));
  }
  function liveStatusNodes(col) {
    const L = col.live || {};
    const t = (ms) => (ms ? new Date(ms).toLocaleTimeString() : '-');
    const d = L.lastDiff;
    return [
      h('span', { class: 'livedot ' + liveState(col) }),
      h('b', null, L.lastError ? 'Tidak terhubung' : L.paused ? 'Dijeda' : L.pending ? 'Ada perubahan (auto-update mati)' : 'Terhubung'),
      h('span', { class: 'muted' }, ` · dicek ${t(L.lastCheck)}`),
      d ? h('span', { class: 'muted' }, ` · perubahan terakhir ${t(d.at)} (+${d.added} baru, ~${d.changed} berubah, −${d.removed} dihapus)`) : null,
      L.lastError ? h('div', { class: 'warnbox', style: { marginTop: '6px' } }, L.lastError + ' — pastikan project API sedang berjalan / file spec ada. Ringan akan terus mencoba.') : null,
    ].filter(Boolean);
  }
  async function liveSyncNow(col, manual) {
    if (liveBusy.has(col.id)) return;
    liveBusy.add(col.id);
    try {
      const { collection, diff } = await api('/api/live/sync', { collection: col });
      applyLiveCollection(col, collection);
      col.live.pending = false;
      save();
      renderSidebar();
      safeRenderMain();
      const lines = [];
      diff.added.slice(0, 5).forEach((x) => lines.push(`+ ${x}`));
      diff.changed.slice(0, 5).forEach((x) => lines.push(`~ ${x}`));
      diff.removed.slice(0, 5).forEach((x) => lines.push(`− ${x} (dipindah ke folder "Tidak ada lagi di spec")`));
      diff.restored.slice(0, 3).forEach((x) => lines.push(`↺ ${x} (kembali ada di spec)`));
      diff.bodyKept.slice(0, 3).forEach((x) => lines.push(`! ${x}: schema body berubah, body yang Anda edit tidak ditimpa`));
      const total = diff.added.length + diff.changed.length + diff.removed.length + diff.restored.length;
      if (total || diff.bodyKept.length) toast(`API "${col.name}" diperbarui dari project:\n${lines.join('\n')}${total > lines.length ? `\n… dan ${total - lines.length} lainnya` : ''}`);
      else if (manual) toast('Spec berubah, tapi tidak ada perubahan endpoint (mis. hanya deskripsi/versi).');
    } catch (e) {
      col.live.lastError = e.message;
      updateLiveIndicators(col);
      if (manual) toast(e.message, true);
    } finally { liveBusy.delete(col.id); }
  }
  async function liveTick() {
    if (!store) return;
    for (const col of store.collections) {
      const L = col.live;
      if (!L || !L.location || L.paused || liveBusy.has(col.id)) continue;
      if (Date.now() - (L.lastCheck || 0) < (L.intervalSec || 5) * 1000) continue;
      liveBusy.add(col.id);
      let changed = false;
      try {
        const r = await api('/api/live/check', { live: L });
        L.lastCheck = Date.now();
        if (r.error) {
          if (!L.lastError) toast(`Live "${col.name}": ${r.error}`, true);
          L.lastError = r.error;
        } else {
          if (L.lastError) toast(`Live "${col.name}": terhubung kembali`);
          L.lastError = null;
          if (r.hash !== L.lastHash) { changed = true; if (!L.auto) L.pending = true; }
        }
      } catch (e) { L.lastCheck = Date.now(); L.lastError = e.message; }
      finally { liveBusy.delete(col.id); }
      updateLiveIndicators(col);
      if (changed && L.auto) await liveSyncNow(col, false);
    }
  }
  setInterval(() => { liveTick().catch(() => {}); }, 1000);

  function liveSection(col) {
    const L = col.live;
    const box = h('div');
    const interval = h('select', { onchange: (e) => { L.intervalSec = Number(e.target.value); save(); } },
      [[2, '2 detik'], [5, '5 detik'], [10, '10 detik'], [30, '30 detik'], [60, '1 menit']].map(([v, l]) => h('option', { value: v, selected: (L.intervalSec || 5) === v }, l)));
    box.append(
      h('div', { class: 'section-title' }, 'Terhubung ke project API (live)'),
      h('div', { class: 'row' }, h('code', { class: 'mono' }, L.location), L.devUrl ? h('span', { class: 'muted' }, `dev server: ${L.devUrl}`) : null),
      h('div', { class: 'live-status', id: 'live-status-' + col.id }, ...liveStatusNodes(col)),
      h('div', { class: 'row', style: { marginTop: '8px' } },
        h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: L.auto !== false, onchange: (e) => { L.auto = e.target.checked; save(); updateLiveIndicators(col); } }), 'Update otomatis'),
        h('label', { class: 'row' }, 'cek tiap', interval),
        h('button', { class: 'btn sm primary', onclick: () => liveSyncNow(col, true) }, L.pending ? 'Terapkan perubahan' : 'Sinkron sekarang'),
        h('button', { class: 'btn sm', onclick: () => { L.paused = !L.paused; save(); renderMain(); updateLiveIndicators(col); } }, L.paused ? 'Lanjutkan' : 'Jeda'),
        h('button', {
          class: 'btn sm', onclick: async () => {
            if (!(await confirmDialog('Putuskan koneksi live?', 'Koleksi tetap ada, tapi tidak lagi mengikuti perubahan spec project.', 'Putuskan'))) return;
            delete col.live; save(); renderSidebar(); renderMain();
          },
        }, 'Putuskan')),
      h('p', { class: 'help' }, 'Saat spec project berubah, koleksi ikut ter-update: endpoint baru ditambahkan, path/parameter/schema mengikuti spec. Tests, assertion, script, auth, dan body yang sudah Anda edit tetap dipertahankan. Endpoint yang dihapus dari spec dipindah ke folder "Tidak ada lagi di spec" (tidak dihapus).'));
    return box;
  }

  function openConnectProject() {
    const m = modal('Hubungkan ke project API (live)', { wide: true });
    const urlIn = h('input', { class: 'inp', placeholder: 'http://localhost:3000  atau  http://localhost:8000/openapi.json', spellcheck: 'false', onkeydown: (e) => { if (e.key === 'Enter') findUrl(); } });
    const results = h('div');
    const auto = h('input', { type: 'checkbox', checked: true });
    const interval = h('select', { class: 'inp', style: { width: 'auto' } }, [[2, '2 detik'], [5, '5 detik'], [10, '10 detik'], [30, '30 detik']].map(([v, l]) => h('option', { value: v, selected: v === 5 }, l)));
    let chosen = null;
    let devUrl = null;
    const btn = h('button', { class: 'btn primary', disabled: true }, 'Hubungkan');
    const busy = (msg) => results.replaceChildren(h('div', { class: 'row muted', style: { marginTop: '10px' } }, h('span', { class: 'spinner sm' }), msg));
    const showCandidates = (cands, hints, note) => {
      chosen = null;
      btn.disabled = true;
      const list = cands.map((c) => h('label', { class: 'fmt' },
        h('input', {
          type: 'radio', name: 'spec',
          onchange: (e) => { chosen = c; btn.disabled = false; list.forEach((x) => x.classList.toggle('on', x === e.target.closest('.fmt'))); },
        }),
        h('span', null, h('b', null, `${c.title}${c.version ? ' v' + c.version : ''}`), h('small', null, `${c.paths} path · ${c.type === 'file' ? 'file: ' + (c.relative || c.location) : c.location}${c.framework ? ' · ' + c.framework : ''}`))));
      results.replaceChildren(...[
        note ? h('div', { class: cands.length ? 'help' : 'warnbox', style: { marginTop: '10px' } }, note) : null,
        ...list,
        hints && hints.length ? h('div', { class: 'section-title' }, 'Terdeteksi di project') : null,
        ...(hints || []).map((x) => h('div', { class: 'help' }, h('b', null, x.framework + ': '), x.tip)),
      ].filter(Boolean));
      if (cands.length === 1) { list[0].querySelector('input').click(); }
    };
    async function findUrl() {
      const v = urlIn.value.trim();
      if (!v) { urlIn.focus(); return; }
      busy('Mencari spec OpenAPI di ' + v + '…');
      try {
        const r = await api('/api/live/discover', { url: v });
        devUrl = r.origin;
        if (!r.reachable) return showCandidates([], [], `Tidak bisa terhubung ke ${r.origin}. Pastikan project API sedang berjalan (mis. npm run dev / uvicorn / mvn spring-boot:run).`);
        showCandidates(r.candidates, [], r.candidates.length ? 'Pilih spec yang mau diikuti:' : `Server ${r.origin} jalan, tapi tidak ditemukan spec OpenAPI di path umum. Masukkan URL spec langsung (mis. ${r.origin}/openapi.json), atau pilih folder project untuk mencari file spec.`);
      } catch (e) { showCandidates([], [], e.message); }
    }
    async function findDir() {
      const dir = await pickFolder('Pilih folder project API');
      if (!dir) return;
      busy('Memindai ' + dir + '…');
      try {
        const r = await api('/api/live/discover', { dir });
        devUrl = urlIn.value.trim() ? (/^https?:\/\//.test(urlIn.value.trim()) ? new URL(urlIn.value.trim()).origin : 'http://' + urlIn.value.trim()) : null;
        showCandidates(r.candidates, r.hints, r.candidates.length ? 'File spec ditemukan. Ringan akan memantau file ini; setiap kali generator memperbarui file, koleksi ikut ter-update.' : 'Tidak ada file openapi/swagger (.json/.yaml) di folder ini. Lihat saran di bawah, atau hubungkan lewat URL dev server.');
      } catch (e) { showCandidates([], [], e.message); }
    }
    btn.onclick = async () => {
      if (!chosen) return;
      btn.disabled = true;
      btn.textContent = 'Menghubungkan…';
      try {
        const { collection } = await api('/api/live/connect', { type: chosen.type, location: chosen.location, devUrl });
        collection.live.auto = auto.checked;
        collection.live.intervalSec = Number(interval.value);
        const col = normCollection(collection);
        store.collections.push(col);
        ui.expanded.add(col.id);
        save();
        m.close();
        select(col.id, 'overview');
        let n = 0;
        eachRequest(col.items, () => n++);
        toast(`Terhubung ke "${col.name}" (${n} endpoint). Koleksi akan mengikuti perubahan API secara otomatis.`);
      } catch (e) {
        results.prepend(h('div', { class: 'errbox', style: { marginTop: '10px' } }, e.message));
      } finally { btn.disabled = !chosen; btn.textContent = 'Hubungkan'; }
    };
    m.body.append(
      h('p', { class: 'help' }, 'Koleksi dibuat dari spec OpenAPI project Anda dan otomatis ikut berubah saat API diubah (endpoint baru, parameter, schema). Didukung: FastAPI, NestJS, Spring Boot, ASP.NET, Laravel (l5-swagger), Go (swag), Django (drf-spectacular), Express (swagger-jsdoc), Fastify, Quarkus, atau file openapi.yaml/json di repo.'),
      h('label', { class: 'blk' }, 'URL dev server atau URL spec'),
      h('div', { class: 'row' }, h('div', { style: { flex: '1' } }, urlIn), h('button', { class: 'btn', onclick: findUrl }, 'Cari spec')),
      h('div', { class: 'row', style: { marginTop: '8px' } }, h('span', { class: 'muted' }, 'atau'), h('button', { class: 'btn', onclick: findDir }, 'Pilih folder project…')),
      results,
      h('div', { class: 'row', style: { marginTop: '14px' } }, h('label', { class: 'row' }, auto, 'Update otomatis saat API berubah'), h('label', { class: 'row' }, 'cek tiap', interval)));
    m.foot.append(h('button', { class: 'btn', onclick: m.close }, 'Batal'), btn);
    setTimeout(() => urlIn.focus(), 0);
  }

  // ================================================================ folder sync (.bru files, Git-friendly)
  async function pickFolder(title) {
    const r = await api('/api/fs/pick', { title });
    if (!r.unsupported) return r.dir;
    return promptDialog(title, '', 'Path folder (absolut), mis. C:\\projects\\api-tests atau /Users/nama/api-tests');
  }
  async function openCollectionFolder() {
    try {
      const dir = await pickFolder('Buka folder koleksi Bruno');
      if (!dir) return;
      const existing = store.collections.find((c) => c.fsPath && c.fsPath.toLowerCase() === dir.toLowerCase());
      if (existing) { select(existing.id, 'overview'); toast('Folder ini sudah terbuka sebagai koleksi.'); return; }
      const { collection } = await api('/api/fs/open', { dir });
      const col = normCollection(collection);
      store.collections.push(col);
      ui.expanded.add(col.id);
      save();
      select(col.id, 'overview');
      toast(`Koleksi "${col.name}" dibuka dari folder. Perubahan disimpan langsung ke file .bru.`);
    } catch (e) { toast(e.message, true); }
  }
  async function saveCollectionToFolder(col) {
    try {
      const dir = await pickFolder(`Simpan "${col.name}" ke folder`);
      if (!dir) return;
      const r = await api('/api/fs/save-as', { collection: col, dir });
      col.fsPath = r.dir;
      col.fsError = null;
      const rel = new Map();
      eachRequest(r.collection.items, (it) => rel.set(it.id, it.fsRel));
      eachRequest(col.items, (it) => { if (rel.has(it.id)) it.fsRel = rel.get(it.id); });
      save();
      renderMain();
      toast(`Disimpan ke ${r.dir} (${r.written} file). Mulai sekarang setiap perubahan ikut tersimpan ke folder ini.`);
    } catch (e) { toast(e.message, true); }
  }
  async function reloadFromFolder(col) {
    try {
      await doSave();
      const { collection } = await api('/api/fs/reload', { collection: col });
      const fresh = normCollection(collection);
      for (const k of ['name', 'items', 'headers', 'auth', 'vars', 'preScript', 'postScript', 'tests', 'docs', 'environments', 'activeEnvId', 'fsError']) col[k] = fresh[k];
      save();
      renderSidebar();
      renderMain();
      toast(`Dimuat ulang dari folder: ${countReq(col.items)} request.`);
    } catch (e) { toast(e.message, true); }
  }
  function folderSection(col) {
    const box = h('div');
    box.append(h('div', { class: 'section-title' }, 'Folder (Git)'));
    if (col.fsPath) {
      box.append(...[
        h('div', { class: 'row' }, h('code', { class: 'mono' }, col.fsPath),
          h('button', { class: 'btn sm', onclick: () => api('/api/fs/reveal', { dir: col.fsPath }).catch((e) => toast(e.message, true)) }, 'Buka folder'),
          h('button', { class: 'btn sm', onclick: () => reloadFromFolder(col) }, 'Muat ulang dari folder'),
          h('button', {
            class: 'btn sm', onclick: async () => {
              if (!(await confirmDialog('Lepas tautan folder?', 'Koleksi tetap ada di aplikasi, tapi perubahan berikutnya tidak lagi ditulis ke folder. File di folder tidak dihapus.', 'Lepas tautan'))) return;
              col.fsPath = null; col.fsError = null; save(); renderMain();
            },
          }, 'Lepas tautan')),
        col.fsError ? h('div', { class: 'warnbox', style: { marginTop: '8px' } }, col.fsError) : null,
        h('p', { class: 'help' }, 'Setiap perubahan otomatis ditulis sebagai file .bru (format Bruno). Commit folder ini ke Git untuk berbagi dengan tim; perubahan dari Git (git pull) terbaca saat aplikasi dibuka atau lewat "Muat ulang dari folder". Nilai environment yang ditandai secret tidak ditulis ke file.')].filter(Boolean));
    } else {
      box.append(h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => saveCollectionToFolder(col) }, 'Simpan ke folder…'),
        h('span', { class: 'help' }, 'Simpan koleksi sebagai file .bru agar bisa di-commit ke Git, dibuka di Bruno, dan dijalankan dengan CLI.')));
    }
    return box;
  }

  // ================================================================ collection / folder view
  function containerView(loc, isCol) {
    const it = loc.item;
    const col = loc.col;
    const tabs = isCol
      ? [['overview', 'Overview'], ['headers', 'Headers', it.headers.filter(on).length || ''], ['auth', 'Auth', it.auth.type !== 'none' ? '•' : ''], ['vars', 'Variabel', it.vars.filter(on).length || ''], ['environments', 'Environment', it.environments.length || ''], ['scripts', 'Script & Tests', it.preScript.trim() || it.postScript.trim() || it.tests.trim() ? '•' : '']]
      : [['overview', 'Overview'], ['headers', 'Headers', it.headers.filter(on).length || ''], ['auth', 'Auth', it.auth.type !== 'inherit' ? '•' : '']];
    if (!tabs.some(([id]) => id === ui.colTab)) ui.colTab = 'overview';
    const body = h('div', { class: 'tab-body' });
    const nameIn = h('input', { class: 'req-name', value: it.name, spellcheck: 'false', oninput: (e) => { it.name = e.target.value; save(); renderSidebar(); const t = document.querySelector('.rtab.active .tname'); if (t) t.textContent = it.name; } });
    const view = h('div', { class: 'cview' },
      h('div', { class: 'topbar' }, h('div', { class: 'title' }, h('span', { class: 'crumbs' }, isCol ? 'Koleksi /' : [col.name, ...loc.ancestors.map((a) => a.name)].join(' / ') + ' /'), nameIn), envPicker(col)),
      tabsBar(tabs, ui.colTab, (id) => { ui.colTab = id; persistUi(); renderMain(); }),
      body);
    const tab = ui.colTab;
    if (tab === 'overview') {
      body.append(h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', null, countReq(it.items)), h('span', { class: 'muted' }, 'request')),
        h('div', { class: 'stat' }, h('b', null, countFolders(it.items)), h('span', { class: 'muted' }, 'folder')),
        isCol ? h('div', { class: 'stat' }, h('b', null, it.environments.length), h('span', { class: 'muted' }, 'environment')) : null));
      body.append(h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: () => openRunner(col, isCol ? null : it) }, 'Jalankan semua request'),
        h('button', { class: 'btn', onclick: () => addRequest(it, col) }, '+ Request'),
        h('button', { class: 'btn', onclick: () => addFolder(it, col) }, '+ Folder'),
        isCol ? h('button', { class: 'btn', onclick: () => exportCollection(it) }, 'Export…') : null,
        isCol ? h('button', { class: 'btn', onclick: () => openImport(it.id) }, 'Import ke sini') : null));
      if (isCol && it.live) body.append(liveSection(it));
      if (isCol) body.append(folderSection(it));
      if (isCol && it.source && it.source.url) {
        body.append(h('div', { class: 'section-title' }, 'Sumber'), h('div', { class: 'row' },
          h('code', { class: 'mono' }, it.source.url),
          h('button', { class: 'btn sm', onclick: () => refreshFromSource(it) }, 'Perbarui dari link')),
        h('p', { class: 'help' }, `Di-import ${it.source.importedAt ? new Date(it.source.importedAt).toLocaleString() : ''}. "Perbarui" mengganti isi request dengan versi terbaru dari link; nilai environment yang sudah Anda isi dipertahankan.`));
      }
      if (isCol) {
        body.append(h('div', { class: 'section-title' }, 'Catatan'), codeArea(it.docs, (v) => { it.docs = v; save(); }, { placeholder: 'Dokumentasi koleksi (opsional)', minHeight: '120px' }));
      }
    } else if (tab === 'headers') {
      body.append(h('p', { class: 'help' }, `Header ini dikirim oleh semua request di ${isCol ? 'koleksi' : 'folder'} ini (bisa ditimpa per request).`), kvTable(it.headers, { keyPh: 'Header', valPh: 'Value' }));
    } else if (tab === 'auth') {
      body.append(h('p', { class: 'help' }, `Request dengan auth "Inherit" memakai pengaturan ini.`),
        authEditor(it.auth, { allowInherit: !isCol, inheritedFrom: () => resolveAuth({ auth: { type: 'inherit' } }, loc.ancestors, col) }));
    } else if (tab === 'vars') {
      body.append(h('p', { class: 'help' }, 'Variabel koleksi berlaku di semua environment. Nilai environment menimpa variabel koleksi dengan nama sama.'), kvTable(it.vars, { keyPh: 'nama', valPh: 'nilai' }));
    } else if (tab === 'environments') {
      body.append(envEditor(it));
    } else if (tab === 'scripts') {
      body.append(h('div', { class: 'section-title' }, 'Pre-request (sebelum setiap request)'), codeArea(it.preScript, (v) => { it.preScript = v; save(); }, { minHeight: '120px' }),
        h('div', { class: 'section-title' }, 'Post-response (setelah setiap response)'), codeArea(it.postScript, (v) => { it.postScript = v; save(); }, { minHeight: '120px' }),
        h('div', { class: 'section-title' }, 'Tests (untuk setiap request)'), codeArea(it.tests, (v) => { it.tests = v; save(); }, { minHeight: '120px' }));
    }
    return view;
  }

  function envEditor(col) {
    const wrap = h('div', { class: 'env-editor' });
    const draw = () => {
      if (!ui.envSel || !col.environments.some((e) => e.id === ui.envSel)) ui.envSel = (col.environments.find((e) => e.id === col.activeEnvId) || col.environments[0] || {}).id;
      const env = col.environments.find((e) => e.id === ui.envSel);
      const list = h('div', { class: 'env-list' },
        col.environments.map((e) => h('button', { class: 'envi' + (e.id === ui.envSel ? ' on' : ''), onclick: () => { ui.envSel = e.id; draw(); } }, e.name, e.id === col.activeEnvId ? h('span', { class: 'act' }, 'aktif') : null)),
        h('button', {
          class: 'btn sm', style: { marginTop: '8px' }, onclick: async () => {
            const name = await promptDialog('Environment baru', '', 'Nama (mis. local, staging)');
            if (!name) return;
            const e = { id: uid(), name, vars: [kv('baseUrl', '')] };
            col.environments.push(e);
            if (!col.activeEnvId) col.activeEnvId = e.id;
            ui.envSel = e.id;
            save(); renderMain();
          },
        }, '+ Environment'));
      const right = h('div');
      if (env) {
        right.append(h('div', { class: 'row', style: { marginBottom: '10px' } },
          h('input', { class: 'inp', value: env.name, style: { maxWidth: '240px' }, oninput: (e) => { env.name = e.target.value; save(); } }),
          env.id === col.activeEnvId ? h('span', { class: 'pill pass' }, 'Aktif') : h('button', { class: 'btn sm primary', onclick: () => { col.activeEnvId = env.id; save(); renderMain(); } }, 'Aktifkan'),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn sm', onclick: () => { const c = clone(env); c.id = uid(); c.name = env.name + ' (copy)'; col.environments.push(c); ui.envSel = c.id; save(); renderMain(); } }, 'Duplikat'),
          h('button', {
            class: 'btn sm danger', onclick: async () => {
              if (!(await confirmDialog('Hapus environment?', `Environment "${env.name}" akan dihapus.`))) return;
              col.environments = col.environments.filter((e) => e.id !== env.id);
              if (col.activeEnvId === env.id) col.activeEnvId = null;
              save(); renderMain();
            },
          }, 'Hapus')),
        kvTable(env.vars, { secret: true, keyPh: 'nama', valPh: 'nilai' }),
        h('p', { class: 'help' }, 'Pakai di request dengan ', h('code', null, '{{nama}}'), '. Centang "Secret" untuk menyembunyikan nilai di layar; nilai secret tidak ikut di-export. Semua data tetap tersimpan lokal di komputer ini.'));
      } else right.append(h('p', { class: 'help' }, 'Belum ada environment. Buat satu untuk menyimpan baseUrl, token, dll per server (local, staging, production).'));
      wrap.replaceChildren(list, right);
    };
    draw();
    return wrap;
  }

  // ================================================================ runner
  function openRunner(col, folder) {
    const target = folder || col;
    const base = folder ? [...locate(folder.id).ancestors, folder] : [];
    const list = [];
    eachRequest(target.items, (it, anc) => list.push({ item: it, anc: [...base, ...anc] }));
    const m = modal(`Runner — ${target.name}`, { wide: true });
    if (!list.length) { m.body.append(h('p', { class: 'help' }, 'Tidak ada request untuk dijalankan.')); return; }
    const delay = h('input', { class: 'inp', type: 'number', min: '0', value: '0', style: { width: '90px' } });
    const stopOnFail = h('input', { type: 'checkbox' });
    const env = activeEnv(col);
    const ul = h('ul', { class: 'runner-list' });
    const rows = list.map(({ item }) => {
      const icon = h('span', { class: 'muted' }, '○');
      const status = h('span', { class: 'muted' }, '');
      const time = h('span', { class: 'muted' }, '');
      const tests = h('span', { class: 'muted' }, '');
      const detail = h('div', { class: 'rdetail', hidden: true });
      const li = h('li', null, h('div', { class: 'rhead', onclick: () => { detail.hidden = !detail.hidden; } }, icon, h('span', { class: 'mbadge m-' + item.method.toLowerCase() }, item.method), h('span', null, item.name), status, time, tests), detail);
      ul.append(li);
      return { icon, status, time, tests, detail };
    });
    const summary = h('div', { class: 'runner-sum' });
    let running = false;
    let stop = false;
    const startBtn = h('button', { class: 'btn primary' }, 'Mulai');
    const runAll = async () => {
      if (running) { stop = true; return; }
      running = true; stop = false;
      startBtn.textContent = 'Stop';
      rows.forEach((r) => { r.icon.textContent = '○'; r.icon.className = 'muted'; r.status.textContent = ''; r.time.textContent = ''; r.tests.textContent = ''; r.detail.replaceChildren(); });
      summary.replaceChildren(h('span', { class: 'muted' }, 'Berjalan…'));
      const t0 = Date.now();
      let pass = 0, fail = 0, tPass = 0, tTotal = 0, steps = 0;
      let i = 0;
      while (i < list.length && !stop && steps < list.length * 10) {
        steps++;
        const { item, anc } = list[i];
        const row = rows[i];
        row.icon.textContent = '…';
        let r;
        try { r = await execute(item, col, anc); } catch (e) { r = { error: e.message, tests: [], logs: [] }; }
        results[item.id] = r;
        const ok = r.skipped || resultOk(r);
        if (!r.skipped) { if (ok) pass++; else fail++; }
        tTotal += (r.tests || []).length;
        tPass += (r.tests || []).filter((t) => t.passed).length;
        row.icon.textContent = r.skipped ? '–' : ok ? '✓' : '✗';
        row.icon.className = r.skipped ? 'muted' : ok ? 'pill pass' : 'pill fail';
        row.status.textContent = r.response ? r.response.status : r.skipped ? 'dilewati' : 'error';
        row.status.className = r.response ? 'status s' + String(r.response.status)[0] : 'muted';
        row.time.textContent = r.response ? fmtMs(r.response.timeMs) : '';
        if ((r.tests || []).length) row.tests.textContent = `${r.tests.filter((t) => t.passed).length}/${r.tests.length} test`;
        row.detail.replaceChildren(...[
          r.error ? h('div', { class: 'errbox' }, r.error) : null,
          r.scriptError ? h('div', { class: 'errbox' }, r.scriptError) : null,
          r.unresolved && r.unresolved.length ? h('div', { class: 'warnbox' }, 'Variabel tidak ditemukan: ' + r.unresolved.join(', ')) : null,
          r.request ? h('div', { class: 'help mono' }, `${r.request.method} ${r.request.url}`) : null,
          testList(r.tests || [])].filter(Boolean));
        if (!ok) row.detail.hidden = false;
        if (!ok && stopOnFail.checked) break;
        if (r.nextRequest === null) break;
        if (typeof r.nextRequest === 'string') {
          const j = list.findIndex((x) => x.item.name === r.nextRequest);
          if (j >= 0) { i = j; continue; }
        }
        i++;
        const d = Number(delay.value) || 0;
        if (d > 0 && i < list.length) await sleep(d);
      }
      running = false;
      startBtn.textContent = 'Jalankan lagi';
      summary.replaceChildren(...[
        h('span', { class: 'pill pass' }, `${pass} lulus`),
        h('span', { class: 'pill ' + (fail ? 'fail' : '') }, `${fail} gagal`),
        h('span', { class: 'pill' }, `Tests ${tPass}/${tTotal}`),
        h('span', { class: 'muted' }, `Durasi ${fmtMs(Date.now() - t0)}`),
        stop ? h('span', { class: 'muted' }, '(dihentikan)') : null].filter(Boolean));
      renderSidebar();
      if (cur.loc && cur.loc.item.type === 'request') renderResPane();
    };
    startBtn.onclick = runAll;
    m.body.append(
      h('div', { class: 'row' },
        h('span', { class: 'muted' }, `${list.length} request · Env: ${env ? env.name : 'tanpa environment'}`),
        h('span', { class: 'spacer' }),
        h('label', { class: 'row' }, 'Jeda (ms)', delay),
        h('label', { class: 'row' }, stopOnFail, 'Berhenti saat gagal')),
      summary, ul);
    m.foot.append(h('button', { class: 'btn', onclick: () => { stop = true; m.close(); } }, 'Tutup'), startBtn);
  }

  // ================================================================ import / export
  function countScripts(cols) {
    let n = 0;
    const chk = (x) => { if ((x.preScript || '').trim() || (x.postScript || '').trim() || (x.tests || '').trim()) n++; };
    for (const c of cols) { chk(c); eachRequest(c.items, chk); }
    return n;
  }
  function addImported(cols, targetId, sourceUrl) {
    cols = cols.map(normCollection);
    let firstReq = null;
    if (targetId && targetId !== 'new') {
      const t = store.collections.find((c) => c.id === targetId);
      for (const c of cols) {
        if (c.items.length === 1 && c.items[0].type === 'request') t.items.push(c.items[0]);
        else t.items.push(normFolder({ name: c.name, items: c.items, headers: c.headers, auth: c.auth.type === 'none' ? { type: 'inherit' } : c.auth }));
        for (const e of c.environments) if (!t.environments.some((x) => x.name === e.name)) t.environments.push(e);
        for (const v of c.vars) if (!t.vars.some((x) => x.key === v.key)) t.vars.push(v);
        if (c.openapi) {
          t.openapi = t.openapi || { components: { schemas: {} }, definitions: {} };
          Object.assign(t.openapi.components.schemas, (c.openapi.components || {}).schemas || {});
          Object.assign(t.openapi.definitions, c.openapi.definitions || {});
        }
      }
      ui.expanded.add(t.id);
      eachRequest(t.items, (r) => { firstReq = firstReq || r; });
    } else {
      for (const c of cols) {
        if (sourceUrl && !c.source) c.source = { type: 'url', url: sourceUrl, importedAt: new Date().toISOString() };
        store.collections.push(c);
        ui.expanded.add(c.id);
        eachRequest(c.items, (r) => { firstReq = firstReq || r; });
      }
    }
    save();
    if (cols.length === 1 && (!targetId || targetId === 'new')) select(cols[0].id, 'overview');
    else if (firstReq) select(firstReq.id);
    else renderSidebar();
    const nReq = cols.reduce((n, c) => n + countReq(c.items), 0);
    const nScripts = countScripts(cols);
    toast(`Import berhasil: ${cols.length} koleksi, ${nReq} request.` + (nScripts ? `\n${nScripts} bagian berisi script; script dijalankan terisolasi tanpa akses jaringan.` : ''));
  }

  function openImport(targetId) {
    const m = modal('Import collection', { wide: false });
    let tab = 'link';
    const target = h('select', { class: 'inp' }, h('option', { value: 'new' }, 'Koleksi baru'), store.collections.map((c) => h('option', { value: c.id, selected: c.id === targetId }, `Tambahkan ke: ${c.name}`)));
    const content = h('div');
    const err = h('div');
    const btn = h('button', { class: 'btn primary' }, 'Import');
    let pendingFiles = null;
    const linkIn = h('input', { class: 'inp', placeholder: 'https://github.com/owner/repo/tree/main/collections/my-api', spellcheck: 'false', onkeydown: (e) => { if (e.key === 'Enter') run(); } });
    const pasteTa = h('textarea', { class: 'code', style: { minHeight: '200px' }, placeholder: 'Tempel JSON (Postman / Bruno / OpenAPI), isi file .bru, atau perintah cURL…', spellcheck: 'false' });
    const fileLabel = h('div', { class: 'help' }, 'Belum ada file dipilih.');
    const readFiles = async (fileList) => {
      const arr = [...fileList].filter((f) => /\.(bru|json|ya?ml)$/i.test(f.name) && !/(^|\/)(node_modules|\.git)\//.test(f.webkitRelativePath || ''));
      if (!arr.length) { fileLabel.textContent = 'Tidak ada file .bru / .json.'; pendingFiles = null; return; }
      if (arr.some((f) => f.size > 30 * 1024 * 1024)) { fileLabel.textContent = 'Ada file > 30 MB, dilewati.'; }
      pendingFiles = await Promise.all(arr.filter((f) => f.size <= 30 * 1024 * 1024).map(async (f) => ({ path: f.webkitRelativePath || f.name, content: await f.text() })));
      fileLabel.textContent = `${pendingFiles.length} file siap di-import.`;
    };
    const fileInp = h('input', { type: 'file', multiple: true, accept: '.json,.bru,.yaml,.yml', hidden: true, onchange: (e) => readFiles(e.target.files) });
    const dirInp = h('input', { type: 'file', webkitdirectory: true, hidden: true, onchange: (e) => readFiles(e.target.files) });
    const drop = h('div', {
      class: 'drop',
      ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); },
      ondragleave: () => drop.classList.remove('over'),
      ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); readFiles(e.dataTransfer.files); },
    }, 'Tarik file ke sini, atau', h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '10px' } },
      h('button', { class: 'btn', onclick: () => fileInp.click() }, 'Pilih file (.json / .yaml / .bru)'),
      h('button', { class: 'btn', onclick: () => dirInp.click() }, 'Pilih folder koleksi Bruno')), fileInp, dirInp);

    const draw = () => {
      content.replaceChildren();
      err.replaceChildren();
      if (tab === 'link') {
        content.append(h('label', { class: 'blk' }, 'Link collection'), linkIn,
          h('div', { class: 'help' }, 'Didukung:', h('br'),
            '• Repo / folder GitHub berisi koleksi Bruno (.bru) — publik, atau set env ', h('code', null, 'GITHUB_TOKEN'), h('br'),
            '• Link raw JSON: Postman v2.x, Bruno export, OpenAPI/Swagger (mis. ', h('code', null, '/openapi.json'), ')', h('br'),
            '• GitHub Gist, atau link langsung ke file .bru'));
        setTimeout(() => linkIn.focus(), 0);
      } else if (tab === 'file') content.append(drop, fileLabel);
      else content.append(pasteTa);
    };
    const seg = () => h('div', { class: 'seg', style: { marginBottom: '6px' } }, [['link', 'Dari link'], ['file', 'Dari file'], ['paste', 'Tempel teks'], ['project', 'Project API (live)']].map(([id, l]) => h('button', { class: tab === id ? 'on' : '', onclick: () => { if (id === 'project') { m.close(); openConnectProject(); return; } tab = id; segWrap.replaceChildren(seg()); draw(); } }, l)));
    const segWrap = h('div', null, seg());
    async function run() {
      err.replaceChildren();
      btn.disabled = true;
      btn.textContent = 'Mengimport…';
      try {
        let res;
        let src = null;
        if (tab === 'link') {
          src = linkIn.value.trim();
          if (!src) throw new Error('Isi link terlebih dahulu');
          res = await api('/api/import-url', { url: src });
        } else if (tab === 'file') {
          if (!pendingFiles || !pendingFiles.length) throw new Error('Pilih file terlebih dahulu');
          res = await api('/api/parse', { files: pendingFiles });
        } else {
          if (!pasteTa.value.trim()) throw new Error('Tempel teks terlebih dahulu');
          res = await api('/api/parse', { text: pasteTa.value });
        }
        if (!res.collections || !res.collections.length) throw new Error('Tidak ada koleksi ditemukan');
        m.close();
        addImported(res.collections, target.value, src);
      } catch (e) {
        err.replaceChildren(h('div', { class: 'errbox', style: { marginTop: '10px' } }, e.message));
      } finally {
        btn.disabled = false;
        btn.textContent = 'Import';
      }
    }
    btn.onclick = run;
    m.body.append(segWrap, content, h('label', { class: 'blk' }, 'Tujuan'), target, err);
    m.foot.append(h('button', { class: 'btn', onclick: m.close }, 'Batal'), btn);
    draw();
  }

  async function refreshFromSource(col) {
    if (!(await confirmDialog('Perbarui dari link?', `Isi request, folder, header, auth, dan script di "${col.name}" akan diganti dengan versi terbaru dari ${col.source.url}. Perubahan lokal pada request akan hilang; nilai environment dipertahankan.`, 'Perbarui'))) return;
    try {
      const { collections } = await api('/api/import-url', { url: col.source.url });
      const fresh = normCollection(collections.find((c) => c.name === col.name) || collections[0]);
      for (const k of ['items', 'headers', 'auth', 'preScript', 'postScript', 'tests', 'docs', 'openapi']) col[k] = fresh[k];
      for (const v of fresh.vars) if (!col.vars.some((x) => x.key === v.key)) col.vars.push(v);
      for (const fe of fresh.environments) {
        const ex = col.environments.find((e) => e.name === fe.name);
        if (!ex) col.environments.push(fe);
        else for (const v of fe.vars) if (!ex.vars.some((x) => x.key === v.key)) ex.vars.push(v);
      }
      col.source.importedAt = new Date().toISOString();
      if (ui.sel && !locate(ui.sel)) ui.sel = col.id;
      save();
      renderSidebar();
      renderMain();
      toast(`Diperbarui: ${countReq(col.items)} request`);
    } catch (e) { toast(e.message, true); }
  }

  const EXPORT_FORMATS = [
    ['postman', 'Postman Collection v2.1 (JSON)', 'Bisa di-import di Postman, Insomnia, Bruno, dan aplikasi lain. Assertion diubah menjadi pm.test; script bru.* diberi shim agar tetap jalan.'],
    ['openapi', 'OpenAPI 3 (JSON)', 'Spesifikasi API: path, parameter, body, auth, dan schema response. Script/test tidak ikut.'],
    ['openapi-yaml', 'OpenAPI 3 (YAML)', 'Sama dengan OpenAPI 3 JSON, dalam format YAML.'],
    ['bruno', 'Bruno JSON', 'Format lengkap (termasuk script, test, environment). Bisa di-import di Bruno atau Ringan.'],
  ];
  function exportCollection(col) {
    const m = modal(`Export "${col.name}"`);
    let format = ui.exportFormat || 'postman';
    const env = activeEnv(col);
    const includeEnv = h('input', { type: 'checkbox', checked: true });
    const list = h('div');
    const notes = h('div');
    const draw = () => {
      list.replaceChildren(...EXPORT_FORMATS.map(([id, label, desc]) => h('label', { class: 'fmt' + (format === id ? ' on' : '') },
        h('input', { type: 'radio', name: 'fmt', checked: format === id, onchange: () => { format = id; ui.exportFormat = id; draw(); } }),
        h('span', null, h('b', null, label), h('small', null, desc)))));
      notes.replaceChildren(...[
        format === 'postman' && env ? h('label', { class: 'row', style: { marginTop: '10px' } }, includeEnv, `Sertakan environment aktif ("${env.name}") sebagai collection variables`) : null,
        format.startsWith('openapi') ? h('p', { class: 'help' }, `Nilai server dan contoh diambil dari ${env ? `environment aktif ("${env.name}")` : 'variabel koleksi'}. Response diambil dari tab Schema; jika kosong, dari response terakhir yang Anda kirim di sesi ini.`) : null,
      ].filter(Boolean));
    };
    const run = async () => {
      btn.disabled = true;
      try {
        const samples = {};
        eachRequest(col.items, (r) => {
          const res = results[r.id] && results[r.id].response;
          if (res && res.bodyText != null) samples[r.id] = { status: res.status, body: res.bodyText.length > 200000 ? null : res.bodyText };
        });
        const out = await api('/api/export', { collection: col, format, options: { includeEnv: includeEnv.checked, samples } });
        download(out.filename, out.content, out.mime);
        m.close();
        toast(`Export selesai: ${out.filename}` + (out.warnings.length ? '\n\nCatatan:\n• ' + out.warnings.slice(0, 6).join('\n• ') + (out.warnings.length > 6 ? `\n… dan ${out.warnings.length - 6} catatan lain` : '') : ''), false);
      } catch (e) { toast(e.message, true); } finally { btn.disabled = false; }
    };
    const btn = h('button', { class: 'btn primary', onclick: run }, 'Export');
    draw();
    m.body.append(h('div', { class: 'help' }, 'Pilih format:'), list, notes);
    m.foot.append(h('button', { class: 'btn', onclick: m.close }, 'Batal'), btn);
  }

  // ================================================================ settings
  async function openSettings() {
    const s = store.settings;
    const m = modal('Pengaturan');
    let info = {};
    try { info = await api('/api/info', undefined, 'GET'); } catch {}
    const num = (key, min, max) => h('input', { class: 'inp', type: 'number', min, max, value: s[key], onchange: (e) => { s[key] = Math.max(min, Math.min(max, Number(e.target.value) || min)); save(); } });
    const chk = (key) => h('input', { type: 'checkbox', checked: !!s[key], onchange: (e) => { s[key] = e.target.checked; save(); } });
    const theme = h('select', { class: 'inp', onchange: (e) => { s.theme = e.target.value; applyTheme(); save(); } },
      [['system', 'Ikuti sistem'], ['light', 'Terang'], ['dark', 'Gelap']].map(([v, l]) => h('option', { value: v, selected: s.theme === v }, l)));
    m.body.append(
      field('Timeout request (ms)', num('timeoutMs', 1000, 600000)),
      field('Timeout script (ms)', num('scriptTimeoutMs', 500, 120000)),
      field('Verifikasi TLS', chk('verifyTls'), 'Matikan untuk server testing dengan sertifikat self-signed.'),
      field('Ikuti redirect', chk('followRedirects')),
      field('Tema', theme),
      field('Update', h('div', { class: 'row' }, h('label', { class: 'row' }, chk('checkUpdates'), 'Cek versi baru otomatis'),
        h('button', { class: 'btn sm', onclick: () => checkUpdates({ force: true, manual: true }) }, 'Cek sekarang'),
        h('button', { class: 'btn sm', onclick: () => { m.close(); openChangelog(); } }, 'Riwayat perubahan')), `Versi terpasang: v${info.version || appVersion}. Pengecekan hanya membaca daftar rilis publik di GitHub.`),
      field('Asisten AI', h('button', { class: 'btn sm', onclick: () => { m.close(); openAiSettings(); } }, 'Pengaturan AI…'), 'Claude, OpenAI, Gemini, Ollama, OpenRouter, Groq, DeepSeek, atau server OpenAI-compatible.'),
      h('p', { class: 'help' }, `Data tersimpan di: ${info.dataFile || '-'}`),
      h('p', { class: 'help' }, `Ringan API ${info.version || ''} · Node ${info.node || ''}. Tidak ada login, tidak ada sinkronisasi cloud.`));
    m.foot.append(h('button', { class: 'btn primary', onclick: m.close }, 'Selesai'));
  }
  function applyTheme() {
    const t = store.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }

  // ================================================================ boot
  function initResizer() {
    const app = $('#app');
    const rz = $('#resizer');
    if (ui.sbw) app.style.setProperty('--sbw', ui.sbw + 'px');
    rz.addEventListener('mousedown', (e) => {
      e.preventDefault();
      rz.classList.add('drag');
      const move = (ev) => { ui.sbw = Math.max(200, Math.min(560, ev.clientX)); app.style.setProperty('--sbw', ui.sbw + 'px'); };
      const up = () => { rz.classList.remove('drag'); removeEventListener('mousemove', move); removeEventListener('mouseup', up); persistUi(); };
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    });
  }

  async function boot() {
    initSandbox();
    initResizer();
    try {
      store = await api('/api/store', undefined, 'GET');
    } catch (e) {
      $('#main').append(h('div', { class: 'empty-main' }, h('h2', null, 'Tidak bisa memuat data'), e.message));
      return;
    }
    store.settings = Object.assign({ timeoutMs: 30000, verifyTls: true, followRedirects: true, scriptTimeoutMs: 10000, theme: 'system', checkUpdates: true }, store.settings || {});
    store.collections = (store.collections || []).map(normCollection);
    await loadHistory();
    loadAiConfig();
    try { appVersion = (await api('/api/info', undefined, 'GET')).version; } catch {}
    renderVersionFoot();
    $('#verBtn').onclick = () => openChangelog();
    showWhatsNew();
    setTimeout(() => checkUpdates(), 4000);
    setInterval(() => checkUpdates(), 6 * 60 * 60 * 1000);
    if (!store.collections.length) ui.sel = null;
    if (ui.sel && !locate(ui.sel)) ui.sel = null;
    if (!ui.sel && store.collections.length && !saved.sel) {
      const c = store.collections[0];
      ui.expanded.add(c.id);
      ui.sel = c.items[0] ? c.items[0].id : c.id;
    }
    applyTheme();
    renderSidebar();
    renderMain();
    setStatus('Tersimpan');

    $('#btnImport').onclick = () => openImport();
    $('#btnImportM').onclick = () => openImport();
    $('#btnMenu').onclick = () => setDrawer(!document.body.classList.contains('sb-open'));
    $('#sbBackdrop').onclick = () => setDrawer(false);
    window.addEventListener('resize', () => { if (!isNarrow()) setDrawer(false); });
    $('#btnNewCol').onclick = (e) => menu(e, [
      { label: 'Koleksi baru', onClick: newCollection },
      { label: 'Hubungkan ke project API (live)…', onClick: openConnectProject },
      { label: 'Buka folder koleksi (Bruno / Git)…', onClick: openCollectionFolder },
      { label: 'Import…', onClick: () => openImport() },
    ]);
    $('#btnSettings').onclick = openSettings;
    $('#sbFilter').addEventListener('input', (e) => { ui.filter = e.target.value; renderSidebar(); });
    document.addEventListener('mousedown', (e) => { if (!e.target.closest('.menu')) closeMenu(); });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); doSave(); }
      if (e.key === 'Escape') { closeMenu(); setDrawer(false); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'w' || e.key === 'W') && ui.sel) { e.preventDefault(); closeTab(ui.sel); }
      if (e.ctrlKey && e.key === 'Tab' && ui.tabs.length > 1) {
        e.preventDefault();
        const i = ui.tabs.indexOf(ui.sel);
        select(ui.tabs[(i + (e.shiftKey ? -1 : 1) + ui.tabs.length) % ui.tabs.length]);
      }
    });
    window.addEventListener('beforeunload', () => {
      if (saveTimer) {
        try { fetch('/api/store', { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Ringan-Token': TOKEN }, body: JSON.stringify(store) }); } catch {}
      }
    });
    const ping = () => api('/api/ping', {}).catch(() => {});
    ping();
    setInterval(ping, 30000);
  }

  boot();
})();
