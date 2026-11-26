'use strict';
/*
 * Electron shell for Ringan API (Windows / macOS / Linux).
 * Runs the same local server in-process and shows the UI in a native window.
 * Data lives in the per-user app data folder, e.g.
 *   Windows: %APPDATA%\Ringan API\data\store.json
 *   macOS:   ~/Library/Application Support/Ringan API/data/store.json
 */
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');

app.setName('Ringan API');
if (process.platform === 'win32') app.setAppUserModelId('id.ringan.api');

// The server reads its data folder from the environment when it is first required.
process.env.RINGAN_DATA = process.env.RINGAN_DATA || path.join(app.getPath('userData'), 'data');

const SMOKE = process.env.RINGAN_SMOKE === '1';
let mainWindow = null;
let appUrl = null;

if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(boot).catch((e) => {
    dialog.showErrorBox('Ringan API gagal dijalankan', String((e && e.stack) || e));
    app.quit();
  });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [isMac ? { role: 'close' } : { role: 'quit', label: 'Keluar' }] },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload', label: 'Muat ulang' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [{ label: 'Buka folder data', click: () => shell.openPath(process.env.RINGAN_DATA) }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    title: 'Ringan API',
    show: false,
    autoHideMenuBar: process.platform !== 'darwin',
    backgroundColor: '#15171c',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  const origin = new URL(appUrl).origin;
  // Links that leave the app open in the system browser; the window never navigates away.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !url.startsWith(origin)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  // Only clipboard access is needed by the page; deny camera, location, notifications, etc.
  mainWindow.webContents.session.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'clipboard-sanitized-write' || permission === 'clipboard-read'));

  mainWindow.once('ready-to-show', () => { if (!SMOKE) mainWindow.show(); });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(appUrl);
  return mainWindow;
}

async function boot() {
  const server = require('../server');
  const { url } = await server.start({ port: Number(process.env.PORT) || 4877 });
  appUrl = url;
  buildMenu();
  const win = createWindow();
  if (SMOKE) runSmoke(win);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || SMOKE) app.quit();
});
app.on('activate', () => {
  if (!mainWindow && appUrl) createWindow();
});

// RINGAN_SMOKE=1: load the UI headless, check it rendered, save a screenshot, exit with a status code.
function runSmoke(win) {
  const fs = require('fs');
  const fail = (msg) => { console.error('SMOKE FAIL: ' + msg); app.exit(1); };
  setTimeout(() => fail('timeout'), 30000).unref();
  win.webContents.once('did-fail-load', (e, code, desc) => fail(`load failed ${code} ${desc}`));
  win.webContents.once('did-finish-load', async () => {
    try {
      await new Promise((r) => setTimeout(r, 1500));
      const info = await win.webContents.executeJavaScript(`({
        title: document.title,
        nodes: document.querySelectorAll('#tree .node').length,
        main: document.querySelector('#main').innerText.slice(0, 80),
        worker: typeof Worker
      })`);
      if (process.env.RINGAN_SMOKE_SEND === '1') {
        info.send = await win.webContents.executeJavaScript(`new Promise((resolve) => {
          document.querySelector('.send').click();
          const t0 = Date.now();
          const iv = setInterval(() => {
            const s = document.querySelector('.res-meta .status');
            const p = document.querySelector('.res-meta .pill');
            if (s || Date.now() - t0 > 20000) { clearInterval(iv); resolve({ status: s && s.textContent, tests: p && p.textContent }); }
          }, 200);
        })`);
      }
      if (process.env.RINGAN_SMOKE_AI === '1') {
        info.ai = await win.webContents.executeJavaScript(`(async () => {
          const t = document.querySelector('meta[name="ringan-token"]').content;
          const r = await fetch('/api/ai/config', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Ringan-Token': t }, body: JSON.stringify({ providers: { openai: { key: 'sk-smoke-secret' } } }) });
          const j = await r.json();
          return { encryption: j.encryption, hasKey: j.providers.openai.hasKey, leaked: JSON.stringify(j).includes('sk-smoke-secret') };
        })()`);
        const raw = fs.readFileSync(require('path').join(process.env.RINGAN_DATA, 'ai.json'), 'utf8');
        info.ai.plaintextOnDisk = raw.includes('sk-smoke-secret');
        info.ai.encryptedOnDisk = raw.includes('keyEnc');
        try { require('@anthropic-ai/sdk'); info.ai.sdkBundled = true; } catch { info.ai.sdkBundled = false; }
      }
      const out = process.env.RINGAN_SMOKE_PNG;
      if (out) fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG());
      console.log('SMOKE OK ' + JSON.stringify(info));
      app.exit(info.nodes > 0 ? 0 : 1);
    } catch (e) { fail(e.message); }
  });
}
