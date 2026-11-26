'use strict';
/*
 * Multi-provider AI chat for Ringan API.
 *   anthropic  - Claude, via the official @anthropic-ai/sdk
 *   openai     - OpenAI Chat Completions
 *   gemini     - Google Gemini (generateContent)
 *   ollama     - local models via Ollama
 *   openrouter / groq / deepseek / custom - any OpenAI-compatible endpoint (LM Studio, vLLM, LiteLLM, ...)
 *
 * API keys are stored in <data>/ai.json. Inside the desktop app they are encrypted with the OS keychain
 * (Electron safeStorage); in the plain Node version they are stored as-is, or taken from environment variables.
 * Keys never leave this process except in requests to the provider you chose.
 */
const fs = require('fs');
const path = require('path');

const PROVIDERS = {
  anthropic: { label: 'Anthropic (Claude)', needsKey: true, env: ['ANTHROPIC_API_KEY'], defaultModel: 'claude-opus-5-5', defaultBaseUrl: '', keyUrl: 'https://console.anthropic.com/settings/keys' },
  openai: { label: 'OpenAI', needsKey: true, env: ['OPENAI_API_KEY'], defaultModel: '', defaultBaseUrl: 'https://api.openai.com/v1', compat: true, keyUrl: 'https://platform.openai.com/api-keys' },
  gemini: { label: 'Google Gemini', needsKey: true, env: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], defaultModel: '', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', keyUrl: 'https://aistudio.google.com/app/apikey' },
  ollama: { label: 'Ollama (lokal, gratis)', needsKey: false, env: [], defaultModel: '', defaultBaseUrl: 'http://localhost:11434', keyUrl: 'https://ollama.com/download' },
  openrouter: { label: 'OpenRouter', needsKey: true, env: ['OPENROUTER_API_KEY'], defaultModel: '', defaultBaseUrl: 'https://openrouter.ai/api/v1', compat: true, keyUrl: 'https://openrouter.ai/keys' },
  groq: { label: 'Groq', needsKey: true, env: ['GROQ_API_KEY'], defaultModel: '', defaultBaseUrl: 'https://api.groq.com/openai/v1', compat: true, keyUrl: 'https://console.groq.com/keys' },
  deepseek: { label: 'DeepSeek', needsKey: true, env: ['DEEPSEEK_API_KEY'], defaultModel: '', defaultBaseUrl: 'https://api.deepseek.com', compat: true, keyUrl: 'https://platform.deepseek.com/api_keys' },
  custom: { label: 'OpenAI-compatible (LM Studio, vLLM, LiteLLM, dll.)', needsKey: false, env: [], defaultModel: '', defaultBaseUrl: 'http://localhost:1234/v1', compat: true },
};

// ---------------------------------------------------------------- config & key storage
let electronSafe = null;
try { if (process.versions.electron) electronSafe = require('electron').safeStorage; } catch {}
const canEncrypt = () => { try { return !!(electronSafe && electronSafe.isEncryptionAvailable()); } catch { return false; } };

function configFile(dataDir) { return path.join(dataDir, 'ai.json'); }

function loadConfig(dataDir) {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(configFile(dataDir), 'utf8')); } catch {}
  c.providers = c.providers || {};
  if (!c.active || !PROVIDERS[c.active]) c.active = 'anthropic';
  return c;
}
function saveConfig(dataDir, c) {
  fs.mkdirSync(dataDir, { recursive: true });
  const tmp = configFile(dataDir) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, configFile(dataDir));
}
function readKey(entry) {
  if (!entry) return '';
  if (entry.keyEnc && canEncrypt()) { try { return electronSafe.decryptString(Buffer.from(entry.keyEnc, 'base64')); } catch { return ''; } }
  return entry.keyPlain || '';
}
function writeKey(entry, key) {
  delete entry.keyEnc;
  delete entry.keyPlain;
  if (!key) return;
  if (canEncrypt()) entry.keyEnc = electronSafe.encryptString(key).toString('base64');
  else entry.keyPlain = key;
}
function envKey(id) {
  for (const k of PROVIDERS[id].env) if (process.env[k]) return process.env[k];
  return '';
}
function resolved(c, id) {
  const p = PROVIDERS[id];
  if (!p) throw new Error(`Provider tidak dikenal: ${id}`);
  const e = c.providers[id] || {};
  return { id, ...p, model: e.model || p.defaultModel, baseUrl: (e.baseUrl || p.defaultBaseUrl || '').replace(/\/+$/, ''), key: readKey(e) || envKey(id) };
}

/** Public view: never contains keys. */
function publicConfig(dataDir) {
  const c = loadConfig(dataDir);
  const providers = {};
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const e = c.providers[id] || {};
    const saved = !!(e.keyEnc || e.keyPlain);
    providers[id] = {
      label: p.label, needsKey: p.needsKey, keyUrl: p.keyUrl || null,
      model: e.model || p.defaultModel, baseUrl: e.baseUrl || '', defaultBaseUrl: p.defaultBaseUrl,
      hasKey: saved || !!envKey(id), keySource: saved ? 'saved' : envKey(id) ? `env ${p.env.find((k) => process.env[k])}` : null,
    };
  }
  return { active: c.active, providers, encryption: canEncrypt() ? 'os-keychain' : 'plain' };
}

function updateConfig(dataDir, patch) {
  const c = loadConfig(dataDir);
  if (patch.active && PROVIDERS[patch.active]) c.active = patch.active;
  for (const [id, upd] of Object.entries(patch.providers || {})) {
    if (!PROVIDERS[id]) continue;
    const e = (c.providers[id] = c.providers[id] || {});
    if (upd.model !== undefined) e.model = String(upd.model).trim();
    if (upd.baseUrl !== undefined) e.baseUrl = String(upd.baseUrl).trim();
    if (upd.key !== undefined) writeKey(e, String(upd.key).trim());
  }
  saveConfig(dataDir, c);
  return publicConfig(dataDir);
}

// ---------------------------------------------------------------- HTTP helper for non-Anthropic providers
async function postJson(url, body, headers, timeoutMs = 180000) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new Error(e.name === 'TimeoutError' ? 'Provider AI tidak merespons (timeout).' : `Tidak bisa terhubung ke ${new URL(url).host}: ${e.cause ? e.cause.code || e.cause.message : e.message}`);
  }
  const text = await res.text();
  let j = null;
  try { j = JSON.parse(text); } catch {}
  if (!res.ok) {
    const msg = (j && (j.error && (j.error.message || j.error) || j.message)) || text.slice(0, 300) || `HTTP ${res.status}`;
    const hint = res.status === 401 || res.status === 403 ? ' (cek API key)' : res.status === 404 ? ' (cek nama model / base URL)' : res.status === 429 ? ' (rate limit / kuota habis)' : '';
    throw new Error(`HTTP ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}${hint}`);
  }
  return j;
}
async function getJson(url, headers) {
  let res;
  try { res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) }); } catch (e) { throw new Error(`Tidak bisa terhubung ke ${new URL(url).host}: ${e.cause ? e.cause.code || e.cause.message : e.message}`); }
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(j && j.error && (j.error.message || j.error)) || 'gagal'}${res.status === 401 ? ' (cek API key)' : ''}`);
  return j;
}

// ---------------------------------------------------------------- Anthropic (official SDK)
function anthropicClient(p) {
  let mod;
  try { mod = require('@anthropic-ai/sdk'); } catch { throw new Error('Paket @anthropic-ai/sdk belum terpasang. Jalankan "npm install" di folder ringan-api (start.bat melakukannya otomatis).'); }
  const Anthropic = mod.default || mod;
  // baseURL is always explicit so an ANTHROPIC_BASE_URL environment variable can never redirect the user's key elsewhere.
  return { Anthropic, client: new Anthropic({ apiKey: p.key, baseURL: p.baseUrl || 'https://api.anthropic.com', timeout: 180000, maxRetries: 2 }) };
}
// Models that support the server-side refusal fallback (re-runs a declined request on another model).
const FALLBACK_MODELS = /^claude-(fable-5-[12]|mythos-5-[12]|opus-5|opus-5-5|sonnet-5-5)$/;

function anthropicError(Anthropic, e) {
  if (e instanceof Anthropic.AuthenticationError) return new Error('API key Anthropic tidak valid.');
  if (e instanceof Anthropic.PermissionDeniedError) return new Error('API key tidak punya akses ke model ini.');
  if (e instanceof Anthropic.NotFoundError) return new Error('Model tidak ditemukan. Cek nama model.');
  if (e instanceof Anthropic.RateLimitError) return new Error('Rate limit Anthropic tercapai, coba lagi sebentar lagi.');
  if (e instanceof Anthropic.BadRequestError) return new Error('Permintaan ditolak Anthropic: ' + e.message);
  if (e instanceof Anthropic.APIConnectionError) return new Error('Tidak bisa terhubung ke Anthropic: ' + e.message);
  if (e instanceof Anthropic.APIError) return new Error(`Anthropic error ${e.status || ''}: ${e.message}`);
  return e;
}

async function chatAnthropic(p, { system, messages, maxTokens }) {
  const { Anthropic, client } = anthropicClient(p);
  const params = { model: p.model, max_tokens: maxTokens || 16000, system, messages: messages.map((m) => ({ role: m.role, content: m.content })) };
  try {
    const resp = FALLBACK_MODELS.test(p.model)
      ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : await client.messages.create(params);
    if (resp.stop_reason === 'refusal') {
      const d = resp.stop_details;
      throw new Error('Model menolak permintaan ini' + (d && d.explanation ? `: ${d.explanation}` : '.'));
    }
    const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { text, model: resp.model, truncated: resp.stop_reason === 'max_tokens', usage: resp.usage ? { input: resp.usage.input_tokens, output: resp.usage.output_tokens } : null };
  } catch (e) { throw anthropicError(Anthropic, e); }
}
async function modelsAnthropic(p) {
  const { Anthropic, client } = anthropicClient(p);
  try {
    const ids = [];
    for await (const m of client.models.list()) ids.push(m.id);
    return ids;
  } catch (e) { throw anthropicError(Anthropic, e); }
}

// ---------------------------------------------------------------- OpenAI & compatible
const compatHeaders = (p) => ({ ...(p.key ? { Authorization: `Bearer ${p.key}` } : {}), ...(p.id === 'openrouter' ? { 'X-Title': 'Ringan API' } : {}) });
async function chatCompat(p, { system, messages }) {
  const j = await postJson(`${p.baseUrl}/chat/completions`, { model: p.model, messages: [{ role: 'system', content: system }, ...messages] }, compatHeaders(p));
  const choice = j && j.choices && j.choices[0];
  if (!choice) throw new Error('Respons provider tidak berisi jawaban.');
  return { text: (choice.message && choice.message.content) || '', model: j.model || p.model, truncated: choice.finish_reason === 'length', usage: j.usage ? { input: j.usage.prompt_tokens, output: j.usage.completion_tokens } : null };
}
async function modelsCompat(p) {
  const j = await getJson(`${p.baseUrl}/models`, compatHeaders(p));
  return ((j && j.data) || []).map((m) => m.id).sort();
}

// ---------------------------------------------------------------- Gemini
async function chatGemini(p, { system, messages }) {
  const model = p.model.replace(/^models\//, '');
  const j = await postJson(`${p.baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
  }, { 'x-goog-api-key': p.key });
  if (j.promptFeedback && j.promptFeedback.blockReason) throw new Error(`Gemini memblokir permintaan: ${j.promptFeedback.blockReason}`);
  const cand = j.candidates && j.candidates[0];
  if (!cand) throw new Error('Gemini tidak memberi jawaban.');
  const text = ((cand.content && cand.content.parts) || []).map((x) => x.text || '').join('');
  return { text, model, truncated: cand.finishReason === 'MAX_TOKENS', usage: j.usageMetadata ? { input: j.usageMetadata.promptTokenCount, output: j.usageMetadata.candidatesTokenCount } : null };
}
async function modelsGemini(p) {
  const j = await getJson(`${p.baseUrl}/models?pageSize=200`, { 'x-goog-api-key': p.key });
  return ((j && j.models) || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace(/^models\//, '')).sort();
}

// ---------------------------------------------------------------- Ollama
async function chatOllama(p, { system, messages }) {
  const j = await postJson(`${p.baseUrl}/api/chat`, { model: p.model, stream: false, messages: [{ role: 'system', content: system }, ...messages] }, {}, 600000);
  return { text: (j.message && j.message.content) || '', model: j.model || p.model, truncated: j.done_reason === 'length', usage: j.prompt_eval_count != null ? { input: j.prompt_eval_count, output: j.eval_count } : null };
}
async function modelsOllama(p) {
  const j = await getJson(`${p.baseUrl}/api/tags`, {});
  return ((j && j.models) || []).map((m) => m.name).sort();
}

// ---------------------------------------------------------------- public API
function provider(dataDir, id) {
  const c = loadConfig(dataDir);
  const p = resolved(c, id || c.active);
  return p;
}
function ensureReady(p) {
  if (p.needsKey && !p.key) throw new Error(`API key ${p.label} belum diisi. Buka Pengaturan AI.`);
  if (!p.model) throw new Error(`Model ${p.label} belum dipilih. Buka Pengaturan AI lalu klik "Ambil daftar model".`);
  if (!p.id.startsWith('anthropic') && !p.baseUrl) throw new Error('Base URL belum diisi.');
}

async function chat(dataDir, { provider: id, model, system, messages, maxTokens }) {
  const p = provider(dataDir, id);
  if (model) p.model = model;
  ensureReady(p);
  if (!Array.isArray(messages) || !messages.length) throw new Error('Pesan kosong');
  const args = { system: String(system || ''), messages: messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') })), maxTokens };
  const t0 = Date.now();
  let out;
  if (p.id === 'anthropic') out = await chatAnthropic(p, args);
  else if (p.id === 'gemini') out = await chatGemini(p, args);
  else if (p.id === 'ollama') out = await chatOllama(p, args);
  else out = await chatCompat(p, args);
  return { ...out, provider: p.id, providerLabel: p.label, ms: Date.now() - t0 };
}

async function listModels(dataDir, id, override = {}) {
  const p = provider(dataDir, id);
  if (override.key) p.key = override.key;
  if (override.baseUrl) p.baseUrl = override.baseUrl.replace(/\/+$/, '');
  if (p.needsKey && !p.key) throw new Error('Isi API key dulu untuk mengambil daftar model.');
  if (p.id === 'anthropic') return modelsAnthropic(p);
  if (p.id === 'gemini') return modelsGemini(p);
  if (p.id === 'ollama') return modelsOllama(p);
  return modelsCompat(p);
}

// ---------------------------------------------------------------- streaming
// emit(event): { t: 'delta', text } | { t: 'notice', text } | { t: 'status', text }
async function postStream(url, body, headers, signal) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  } catch (e) {
    if (signal && signal.aborted) throw new Error('Dibatalkan.');
    throw new Error(`Tidak bisa terhubung ke ${new URL(url).host}: ${e.cause ? e.cause.code || e.cause.message : e.message}`);
  }
  if (!res.ok) {
    const text = await res.text();
    let j = null;
    try { j = JSON.parse(text); } catch {}
    const msg = (j && (j.error && (j.error.message || j.error) || j.message)) || text.slice(0, 300) || `HTTP ${res.status}`;
    const hint = res.status === 401 || res.status === 403 ? ' (cek API key)' : res.status === 404 ? ' (cek nama model / base URL)' : res.status === 429 ? ' (rate limit / kuota habis)' : '';
    throw new Error(`HTTP ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}${hint}`);
  }
  return res;
}
async function* lines(res) {
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { yield buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); }
  }
  buf += dec.decode();
  if (buf) yield buf;
}
async function* sseData(res) {
  for await (const line of lines(res)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try { yield JSON.parse(data); } catch {}
  }
}

async function streamAnthropic(p, { system, messages, maxTokens }, emit, signal) {
  const { Anthropic, client } = anthropicClient(p);
  const params = { model: p.model, max_tokens: maxTokens || 64000, system, messages: messages.map((m) => ({ role: m.role, content: m.content })) };
  const stream = FALLBACK_MODELS.test(p.model)
    ? client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
    : client.messages.stream(params);
  const onAbort = () => stream.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        const b = event.content_block;
        if (b.type === 'thinking') emit({ t: 'status', text: 'AI sedang berpikir…' });
        else if (b.type === 'text') emit({ t: 'status', text: '' });
        else if (b.type === 'fallback') emit({ t: 'notice', text: `${(b.from && b.from.model) || 'Model'} menolak; jawaban dilanjutkan oleh ${(b.to && b.to.model) || 'model cadangan'}.` });
      } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        emit({ t: 'delta', text: event.delta.text });
      }
    }
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') {
      const d = msg.stop_details;
      throw new Error('Model menolak permintaan ini' + (d && d.explanation ? `: ${d.explanation}` : '.'));
    }
    return { model: msg.model, truncated: msg.stop_reason === 'max_tokens', usage: msg.usage ? { input: msg.usage.input_tokens, output: msg.usage.output_tokens } : null };
  } catch (e) {
    if (signal && signal.aborted) throw new Error('Dibatalkan.');
    throw anthropicError(Anthropic, e);
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

async function streamCompat(p, { system, messages }, emit, signal) {
  const res = await postStream(`${p.baseUrl}/chat/completions`, { model: p.model, stream: true, stream_options: p.id === 'openai' ? { include_usage: true } : undefined, messages: [{ role: 'system', content: system }, ...messages] }, compatHeaders(p), signal);
  let model = p.model;
  let truncated = false;
  let usage = null;
  try {
    for await (const j of sseData(res)) {
      if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
      if (j.model) model = j.model;
      if (j.usage) usage = { input: j.usage.prompt_tokens, output: j.usage.completion_tokens };
      const c = j.choices && j.choices[0];
      if (!c) continue;
      const d = c.delta && c.delta.content;
      if (d) emit({ t: 'delta', text: d });
      if (c.finish_reason === 'length') truncated = true;
    }
  } catch (e) { if (signal && signal.aborted) throw new Error('Dibatalkan.'); throw e; }
  return { model, truncated, usage };
}

async function streamGemini(p, { system, messages }, emit, signal) {
  const model = p.model.replace(/^models\//, '');
  const res = await postStream(`${p.baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
  }, { 'x-goog-api-key': p.key }, signal);
  let truncated = false;
  let usage = null;
  try {
    for await (const j of sseData(res)) {
      if (j.promptFeedback && j.promptFeedback.blockReason) throw new Error(`Gemini memblokir permintaan: ${j.promptFeedback.blockReason}`);
      const cand = j.candidates && j.candidates[0];
      if (cand) {
        const text = ((cand.content && cand.content.parts) || []).map((x) => x.text || '').join('');
        if (text) emit({ t: 'delta', text });
        if (cand.finishReason === 'MAX_TOKENS') truncated = true;
      }
      if (j.usageMetadata) usage = { input: j.usageMetadata.promptTokenCount, output: j.usageMetadata.candidatesTokenCount };
    }
  } catch (e) { if (signal && signal.aborted) throw new Error('Dibatalkan.'); throw e; }
  return { model, truncated, usage };
}

async function streamOllama(p, { system, messages }, emit, signal) {
  const res = await postStream(`${p.baseUrl}/api/chat`, { model: p.model, stream: true, messages: [{ role: 'system', content: system }, ...messages] }, {}, signal);
  let out = { model: p.model, truncated: false, usage: null };
  try {
    for await (const line of lines(res)) {
      if (!line.trim()) continue;
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      if (j.error) throw new Error(j.error);
      if (j.message && j.message.content) emit({ t: 'delta', text: j.message.content });
      if (j.done) out = { model: j.model || p.model, truncated: j.done_reason === 'length', usage: j.prompt_eval_count != null ? { input: j.prompt_eval_count, output: j.eval_count } : null };
    }
  } catch (e) { if (signal && signal.aborted) throw new Error('Dibatalkan.'); throw e; }
  return out;
}

/** Streams a chat answer; emit() receives deltas. Resolves with the final metadata. */
async function chatStream(dataDir, { provider: id, model, system, messages, maxTokens }, emit, signal) {
  const p = provider(dataDir, id);
  if (model) p.model = model;
  ensureReady(p);
  if (!Array.isArray(messages) || !messages.length) throw new Error('Pesan kosong');
  const args = { system: String(system || ''), messages: messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') })), maxTokens };
  const t0 = Date.now();
  let out;
  if (p.id === 'anthropic') out = await streamAnthropic(p, args, emit, signal);
  else if (p.id === 'gemini') out = await streamGemini(p, args, emit, signal);
  else if (p.id === 'ollama') out = await streamOllama(p, args, emit, signal);
  else out = await streamCompat(p, args, emit, signal);
  return { ...out, provider: p.id, providerLabel: p.label, ms: Date.now() - t0 };
}

module.exports = { PROVIDERS, publicConfig, updateConfig, chat, chatStream, listModels };
