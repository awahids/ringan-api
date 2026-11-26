'use strict';
// HTTP client used by the app server and the CLI runner.
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const zlib = require('zlib');

const VERSION = require('../package.json').version;
const MAX_RESPONSE = 50 * 1024 * 1024; // response from target APIs

const hasHeader = (obj, name) => Object.keys(obj).some((k) => k.toLowerCase() === name);

function buildMultipart(parts) {
  const boundary = '----RinganBoundary' + crypto.randomBytes(12).toString('hex');
  const q = (s) => String(s ?? '').replace(/"/g, '%22').replace(/\r?\n/g, ' ');
  const chunks = [];
  for (const p of parts || []) {
    if (p.file) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${q(p.name)}"; filename="${q(p.fileName || 'file')}"\r\nContent-Type: ${p.contentType || 'application/octet-stream'}\r\n\r\n`));
      chunks.push(Buffer.from(p.base64 || '', 'base64'));
      chunks.push(Buffer.from('\r\n'));
    } else {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${q(p.name)}"\r\n\r\n${p.value ?? ''}\r\n`));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { buf: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

function buildBody(body) {
  if (!body || body.type === 'none') return { buf: null };
  if (body.type === 'text') return { buf: Buffer.from(String(body.text ?? ''), 'utf8') };
  if (body.type === 'base64') return { buf: Buffer.from(String(body.base64 ?? ''), 'base64') };
  if (body.type === 'multipart') return buildMultipart(body.parts);
  return { buf: null };
}

function decompress(buf, enc) {
  enc = String(enc || '').toLowerCase().trim();
  try {
    if (enc === 'gzip' || enc === 'x-gzip') return zlib.gunzipSync(buf);
    if (enc === 'br') return zlib.brotliDecompressSync(buf);
    if (enc === 'deflate') {
      try { return zlib.inflateSync(buf); } catch { return zlib.inflateRawSync(buf); }
    }
  } catch {}
  return buf;
}

function isTextual(ct, buf) {
  if (/json|text|xml|javascript|x-www-form-urlencoded|html|csv|yaml|graphql/i.test(ct)) return true;
  if (/^(image|audio|video|font)\/|octet-stream|pdf|zip|protobuf/i.test(ct)) return false;
  const sample = buf.subarray(0, 2048);
  return !sample.includes(0);
}

function sendOnce(urlStr, method, headers, bodyBuf, opts, holder) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch { return reject(new Error('URL tidak valid: ' + urlStr)); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return reject(new Error('Hanya URL http:// dan https:// yang didukung'));
    const lib = u.protocol === 'https:' ? https : http;
    const hdrs = {};
    for (const [k, v] of headers) {
      if (!k) continue;
      const existing = Object.keys(hdrs).find((x) => x.toLowerCase() === k.toLowerCase());
      if (existing && k.toLowerCase() !== 'cookie') hdrs[existing] = [].concat(hdrs[existing], v);
      else if (existing) hdrs[existing] += '; ' + v;
      else hdrs[k] = v;
    }
    if (!hasHeader(hdrs, 'user-agent')) hdrs['User-Agent'] = `RinganAPI/${VERSION}`;
    if (!hasHeader(hdrs, 'accept')) hdrs['Accept'] = '*/*';
    if (bodyBuf && !hasHeader(hdrs, 'content-length')) hdrs['Content-Length'] = bodyBuf.length;

    const t0 = process.hrtime.bigint();
    const ms = () => Number(process.hrtime.bigint() - t0) / 1e6;
    let ttfb = null;
    const rq = lib.request(u, { method, headers: hdrs, rejectUnauthorized: !opts.insecure, timeout: opts.timeoutMs }, (rs) => {
      ttfb = ms();
      const chunks = [];
      let size = 0;
      rs.on('data', (c) => {
        size += c.length;
        if (size > MAX_RESPONSE) { rq.destroy(new Error('Response terlalu besar (> 50 MB)')); return; }
        chunks.push(c);
      });
      rs.on('end', () => resolve({
        status: rs.statusCode, statusText: rs.statusMessage, headers: rs.headers, rawHeaders: rs.rawHeaders,
        body: Buffer.concat(chunks), timeMs: ms(), ttfbMs: ttfb, sentHeaders: hdrs,
      }));
      rs.on('error', reject);
    });
    holder.req = rq;
    const overall = setTimeout(() => rq.destroy(new Error(`Timeout setelah ${opts.timeoutMs} ms`)), opts.timeoutMs);
    rq.on('close', () => clearTimeout(overall));
    rq.on('timeout', () => rq.destroy(new Error(`Timeout setelah ${opts.timeoutMs} ms`)));
    rq.on('error', (e) => reject(friendlyError(e, u)));
    if (bodyBuf && bodyBuf.length) rq.write(bodyBuf);
    rq.end();
  });
}

function friendlyError(e, u) {
  const map = {
    ECONNREFUSED: `Koneksi ditolak oleh ${u.host}. Server tidak berjalan atau port salah.`,
    ENOTFOUND: `Host ${u.hostname} tidak ditemukan (DNS).`,
    ETIMEDOUT: `Koneksi ke ${u.host} timeout.`,
    ECONNRESET: `Koneksi diputus oleh ${u.host}.`,
    DEPTH_ZERO_SELF_SIGNED_CERT: 'Sertifikat TLS self-signed. Matikan "Verifikasi TLS" di Pengaturan jika ini server lokal/testing.',
    SELF_SIGNED_CERT_IN_CHAIN: 'Sertifikat TLS self-signed di rantai sertifikat. Matikan "Verifikasi TLS" di Pengaturan jika ini server testing.',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'Sertifikat TLS tidak bisa diverifikasi. Matikan "Verifikasi TLS" di Pengaturan jika ini server testing.',
    CERT_HAS_EXPIRED: 'Sertifikat TLS server sudah kedaluwarsa.',
  };
  const err = new Error(map[e.code] || e.message);
  err.code = e.code;
  return err;
}

async function sendHttp(o, holder) {
  let url = String(o.url || '');
  let method = String(o.method || 'GET').toUpperCase();
  let headers = Array.isArray(o.headers) ? o.headers.map(([k, v]) => [String(k), String(v ?? '')]) : [];
  const built = buildBody(o.body);
  let bodyBuf = built.buf;
  if (built.contentType) {
    headers = headers.filter(([k]) => k.toLowerCase() !== 'content-type');
    headers.push(['Content-Type', built.contentType]);
  }
  const opts = {
    timeoutMs: Math.max(1000, Math.min(Number(o.timeoutMs) || 30000, 10 * 60 * 1000)),
    insecure: !!o.insecure,
  };
  const t0 = Date.now();
  const redirects = [];
  for (let i = 0; ; i++) {
    const r = await sendOnce(url, method, headers, bodyBuf, opts, holder);
    const loc = r.headers.location;
    if (o.followRedirects !== false && [301, 302, 303, 307, 308].includes(r.status) && loc && i < 10) {
      redirects.push({ status: r.status, url });
      const next = new URL(loc, url).toString();
      if (r.status === 303 || ((r.status === 301 || r.status === 302) && method !== 'GET' && method !== 'HEAD')) {
        method = 'GET';
        bodyBuf = null;
        headers = headers.filter(([k]) => !/^(content-type|content-length)$/i.test(k));
      }
      if (new URL(next).host !== new URL(url).host) headers = headers.filter(([k]) => !/^(authorization|cookie)$/i.test(k));
      url = next;
      continue;
    }
    const decoded = decompress(r.body, r.headers['content-encoding']);
    const ct = String(r.headers['content-type'] || '');
    const text = isTextual(ct, decoded);
    const headerList = [];
    for (let j = 0; j < r.rawHeaders.length; j += 2) headerList.push([r.rawHeaders[j], r.rawHeaders[j + 1]]);
    return {
      status: r.status,
      statusText: r.statusText || '',
      headers: r.headers,
      headerList,
      contentType: ct,
      bodyText: text ? decoded.toString('utf8') : null,
      bodyBase64: !text && decoded.length <= 15 * 1024 * 1024 ? decoded.toString('base64') : null,
      size: r.body.length,
      timeMs: Math.round((Date.now() - t0) * 10) / 10,
      ttfbMs: Math.round(r.ttfbMs * 10) / 10,
      url,
      redirects,
      sent: { method, url, headers: Object.entries(r.sentHeaders).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)]) },
    };
  }
}

module.exports = { sendHttp };
