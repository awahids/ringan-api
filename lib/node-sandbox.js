'use strict';
/*
 * Script sandbox for the CLI: runs public/sandbox-worker.js (the same code the app uses)
 * inside a vm context on a worker thread. Scripts get no `require`, `process`, `fetch` or file access,
 * and a run that exceeds the timeout is stopped by terminating the thread.
 * Note: a vm context is isolation for convenience, not a hard security boundary.
 * Only run collections you trust.
 */
const path = require('path');
const { Worker } = require('worker_threads');

const THREAD_SRC = `
const { parentPort, workerData } = require('worker_threads');
const vm = require('vm');
const fs = require('fs');
const src = fs.readFileSync(workerData.file, 'utf8');
const self = { postMessage: (m) => parentPort.postMessage(m) };
const ctx = vm.createContext({
  self, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
  crypto: globalThis.crypto, atob, btoa, TextEncoder, TextDecoder, URL, URLSearchParams, structuredClone,
});
vm.runInContext(src, ctx, { filename: 'sandbox-worker.js' });
parentPort.on('message', (job) => ctx.self.onmessage({ data: job }));
`;

class NodeSandbox {
  constructor({ timeoutMs = 10000 } = {}) {
    this.timeoutMs = timeoutMs;
    this.seq = 0;
    this.pending = new Map();
    this.worker = null;
  }

  spawn() {
    const w = new Worker(THREAD_SRC, { eval: true, workerData: { file: path.join(__dirname, '..', 'public', 'sandbox-worker.js') } });
    w.on('message', (d) => {
      const p = this.pending.get(d.id);
      if (p) { clearTimeout(p.timer); this.pending.delete(d.id); p.resolve(d); }
    });
    w.on('error', (e) => {
      for (const [id, p] of this.pending) { clearTimeout(p.timer); p.resolve({ id, error: 'Sandbox error: ' + e.message, logs: [], tests: [] }); }
      this.pending.clear();
      this.worker = null;
    });
    w.unref();
    this.worker = w;
  }

  run(job) {
    if (!this.worker) this.spawn();
    const id = ++this.seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const w = this.worker;
        this.worker = null;
        if (w) w.terminate();
        resolve({ id, error: `Script dihentikan: melebihi batas waktu ${this.timeoutMs / 1000} detik.`, logs: [], tests: [] });
      }, this.timeoutMs);
      this.pending.set(id, { resolve, timer });
      this.worker.postMessage(JSON.parse(JSON.stringify({ ...job, id })));
    });
  }

  close() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
  }
}

module.exports = { NodeSandbox };
