// Installable Command Center (PWA): the live page as a phone or desktop app.
//   live/manifest.webmanifest   web app manifest (name, short name, colours, standalone, icons). Built here.
//   live/icon-192.png           app icons, resized from tools/whalyom.png (256 x 256 RGBA) with node
//   live/icon-512.png             built-ins only: PNG decode, premultiplied-alpha resample, PNG encode.
//   live/sw.js                  service worker (hand-written, not generated): caches the page shell so the
//                               app opens offline, never caches /api/* or /stream (live data and decisions
//                               always go to the server), and shows a "decision waiting" notification when
//                               the page posts { type: 'decision-waiting', count } to it.
// Colours come from the page's own CSS tokens: theme_color and background_color are the day --bg on bare
// :root in live/index.html, so the app chrome matches the page. Every output is deterministic: the same
// inputs give byte-identical files (no timestamps, fixed key order, fixed PNG filter choice).
// Nothing here sends, posts or spends anything. Notifications are local to the owner's device and need
// the owner's permission, asked for only from a click (window.whalyomEnableAlerts in the snippet).
// Usage: node tools/pwa.mjs              writes the manifest and both icons into live/
//        node tools/pwa.mjs --check      verifies them (exit 1 on any problem), writes nothing
//        node tools/pwa.mjs --snippet    prints the <head> tags and registration script for live/index.html
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { root } from './lib/env.mjs';

export const ICON_SIZES = [192, 512];
export const SOURCE_ICON = path.join(root, 'tools', 'whalyom.png');
export const LIVE_DIR = path.join(root, 'live');
export const FALLBACK_COLOR = '#141718';
// Paths the service worker must never answer from cache (and never intercept at all).
export const BYPASS_PREFIXES = ['/api', '/stream'];

// Routes the Command Center server (tools/server.mjs) should serve from live/ for the app to install.
export const PWA_ROUTES = {
  '/manifest.webmanifest': { file: 'live/manifest.webmanifest', type: 'application/manifest+json; charset=utf-8', cache: 'no-cache' },
  '/sw.js': { file: 'live/sw.js', type: 'text/javascript; charset=utf-8', cache: 'no-cache' },
  '/icon-192.png': { file: 'live/icon-192.png', type: 'image/png', cache: 'public, max-age=86400' },
  '/icon-512.png': { file: 'live/icon-512.png', type: 'image/png', cache: 'public, max-age=86400' },
};

// ── colours ──────────────────────────────────────────────────────────────────────────────────────────────

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
export const isHexColor = (c) => typeof c === 'string' && HEX.test(c.trim());
const normHex = (c) => {
  const h = c.trim().toLowerCase();
  return h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h;
};

// Pure: reads the tokens of the first bare `:root {` block (the day theme) from the page's HTML.
// Returns { bg, ink, accent } as lower-case #rrggbb; a missing or non-hex token is left out.
export function extractTokens(html) {
  const out = {};
  if (typeof html !== 'string' || !html) return out;
  const m = html.match(/(^|[\s}])\:root\s*\{([^}]*)\}/);
  if (!m) return out;
  for (const [key, name] of [['bg', '--bg'], ['ink', '--ink'], ['accent', '--accent']]) {
    const t = m[2].match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
    if (t && isHexColor(t[1])) out[key] = normHex(t[1]);
  }
  return out;
}

// ── manifest ─────────────────────────────────────────────────────────────────────────────────────────────

// Pure: the web app manifest object. tokens from extractTokens; icon sizes default to ICON_SIZES.
export function buildManifest({ tokens = {}, sizes = ICON_SIZES } = {}) {
  const bg = isHexColor(tokens.bg) ? normHex(tokens.bg) : FALLBACK_COLOR;
  const list = [...new Set((Array.isArray(sizes) ? sizes : []).map(Number).filter((n) => Number.isInteger(n) && n >= 48 && n <= 1024))].sort((a, b) => a - b);
  if (!list.length) throw new Error('buildManifest: no valid icon sizes');
  return {
    id: '/',
    name: 'Whalyom Command Center',
    short_name: 'Whalyom',
    description: 'Your entire marketing department, live: agents, decisions waiting for you, results.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'any',
    theme_color: bg,
    background_color: bg,
    lang: 'en',
    dir: 'ltr',
    categories: ['business', 'productivity'],
    icons: list.map((s) => ({ src: `/icon-${s}.png`, sizes: `${s}x${s}`, type: 'image/png', purpose: 'any' })),
  };
}

export const manifestText = (manifest) => `${JSON.stringify(manifest, null, 2)}\n`;

// Pure: lists problems with a manifest object ([] means valid for install).
export function validateManifest(m) {
  const errs = [];
  if (!m || typeof m !== 'object') return ['manifest is not an object'];
  if (m.name !== 'Whalyom Command Center') errs.push('name must be "Whalyom Command Center"');
  if (m.short_name !== 'Whalyom') errs.push('short_name must be "Whalyom"');
  if (m.display !== 'standalone') errs.push('display must be "standalone"');
  if (typeof m.start_url !== 'string' || !m.start_url.startsWith('/')) errs.push('start_url must be a same-origin path');
  for (const k of ['theme_color', 'background_color']) if (!isHexColor(m[k])) errs.push(`${k} must be a hex colour`);
  const icons = Array.isArray(m.icons) ? m.icons : [];
  for (const s of [192, 512]) if (!icons.some((i) => i?.sizes === `${s}x${s}` && i?.type === 'image/png')) errs.push(`icon ${s}x${s} PNG missing`);
  return errs;
}

// ── PNG (decode, resample, encode) with node built-ins only ────────────────────────────────────────────

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

// Pure: PNG bytes -> { width, height, data: Uint8Array RGBA }. Supports 8-bit RGBA, RGB, grey and
// grey+alpha, non-interlaced (what tools/whalyom.png and common exports are). Throws a clear error otherwise.
export function decodePng(buf) {
  if (!Buffer.isBuffer(buf) && !(buf instanceof Uint8Array)) throw new TypeError('decodePng: expected a Buffer');
  buf = Buffer.from(buf);
  if (buf.length < 33 || !buf.subarray(0, 8).equals(SIG)) throw new Error('decodePng: not a PNG file');
  let off = 8, ihdr = null;
  const idat = [];
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (off + 12 + len > buf.length) throw new Error(`decodePng: truncated ${type} chunk`);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (crc32(buf.subarray(off + 4, off + 8 + len)) !== buf.readUInt32BE(off + 8 + len)) throw new Error(`decodePng: bad CRC in ${type}`);
    if (type === 'IHDR') ihdr = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12] };
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr) throw new Error('decodePng: missing IHDR');
  const { width, height, depth, color, interlace } = ihdr;
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[color];
  if (depth !== 8 || !channels) throw new Error(`decodePng: unsupported format (bit depth ${depth}, colour type ${color})`);
  if (interlace) throw new Error('decodePng: interlaced PNG not supported');
  if (!width || !height || width > 8192 || height > 8192) throw new Error('decodePng: unreasonable dimensions');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error('decodePng: image data too short');
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    if (f > 4) throw new Error(`decodePng: bad filter ${f} on row ${y}`);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[dst + x - channels] : 0;
      const b = y ? px[dst - stride + x] : 0;
      const c = y && x >= channels ? px[dst - stride + x - channels] : 0;
      const v = raw[src + x];
      px[dst + x] = (f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 0xff;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    const o = i * 4;
    if (channels === 4) { data[o] = px[j]; data[o + 1] = px[j + 1]; data[o + 2] = px[j + 2]; data[o + 3] = px[j + 3]; }
    else if (channels === 3) { data[o] = px[j]; data[o + 1] = px[j + 1]; data[o + 2] = px[j + 2]; data[o + 3] = 255; }
    else if (channels === 2) { data[o] = data[o + 1] = data[o + 2] = px[j]; data[o + 3] = px[j + 1]; }
    else { data[o] = data[o + 1] = data[o + 2] = px[j]; data[o + 3] = 255; }
  }
  return { width, height, data };
}

// Pure: { width, height, data RGBA } -> PNG bytes (8-bit RGBA). Per row it picks the filter with the
// smallest sum of absolute values (deterministic), then deflates at level 9.
export function encodePng({ width, height, data }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('encodePng: bad dimensions');
  if (!data || data.length !== width * height * 4) throw new Error('encodePng: data length does not match width x height x 4');
  const stride = width * 4;
  const out = Buffer.alloc((stride + 1) * height);
  const cand = Array.from({ length: 5 }, () => Buffer.alloc(stride));
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      for (let x = 0; x < stride; x++) {
        const v = data[row + x];
        const a = x >= 4 ? data[row + x - 4] : 0, b = y ? data[row - stride + x] : 0, c = y && x >= 4 ? data[row - stride + x - 4] : 0;
        const r = (f === 0 ? v : f === 1 ? v - a : f === 2 ? v - b : f === 3 ? v - ((a + b) >> 1) : v - paeth(a, b, c)) & 0xff;
        cand[f][x] = r;
        sum += r < 128 ? r : 256 - r;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    out[y * (stride + 1)] = best;
    cand[best].copy(out, y * (stride + 1) + 1);
  }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type, 'latin1'), body]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tb));
    return Buffer.concat([len, tb, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(out, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Weights for one axis: triangle filter, widened when shrinking (area-like averaging, no aliasing),
// plain linear interpolation when enlarging. Edges clamp.
function axisWeights(src, dst) {
  const scale = dst / src, support = scale < 1 ? 1 / scale : 1;
  const rows = [];
  for (let i = 0; i < dst; i++) {
    const center = (i + 0.5) / scale - 0.5;
    const lo = Math.floor(center - support), hi = Math.ceil(center + support);
    const taps = [];
    let total = 0;
    for (let x = lo; x <= hi; x++) {
      const w = Math.max(0, 1 - Math.abs(x - center) / support);
      if (w > 0) { taps.push([Math.min(src - 1, Math.max(0, x)), w]); total += w; }
    }
    if (!taps.length) taps.push([Math.min(src - 1, Math.max(0, Math.round(center))), 1]), (total = 1);
    rows.push(taps.map(([x, w]) => [x, w / total]));
  }
  return rows;
}

// Pure: resample an RGBA image to w x h. Works on premultiplied alpha so transparent edges stay clean.
export function resizeRgba(img, w, h = w) {
  const { width, height, data } = img ?? {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || !data || data.length !== width * height * 4) throw new Error('resizeRgba: bad source image');
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 4096 || h > 4096) throw new Error('resizeRgba: bad target size');
  const pre = new Float64Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const a = data[i * 4 + 3] / 255;
    pre[i * 4] = data[i * 4] * a; pre[i * 4 + 1] = data[i * 4 + 1] * a; pre[i * 4 + 2] = data[i * 4 + 2] * a; pre[i * 4 + 3] = data[i * 4 + 3];
  }
  const wx = axisWeights(width, w), wy = axisWeights(height, h);
  const mid = new Float64Array(w * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    for (const [sx, k] of wx[x]) { const s = (y * width + sx) * 4; mid[o] += pre[s] * k; mid[o + 1] += pre[s + 1] * k; mid[o + 2] += pre[s + 2] * k; mid[o + 3] += pre[s + 3] * k; }
  }
  const out = new Uint8Array(w * h * 4);
  const clamp = (v) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (const [sy, k] of wy[y]) { const s = (sy * w + x) * 4; r += mid[s] * k; g += mid[s + 1] * k; b += mid[s + 2] * k; a += mid[s + 3] * k; }
    const o = (y * w + x) * 4, A = clamp(a);
    if (A === 0) continue;
    const f = 255 / a;
    out[o] = clamp(r * f); out[o + 1] = clamp(g * f); out[o + 2] = clamp(b * f); out[o + 3] = A;
  }
  return { width: w, height: h, data: out };
}

// Pure: PNG bytes of the source -> { [size]: PNG bytes } for each requested square size.
export function makeIcons(sourcePng, sizes = ICON_SIZES) {
  const src = decodePng(sourcePng);
  const out = {};
  for (const s of sizes) out[s] = encodePng(src.width === s && src.height === s ? src : resizeRgba(src, s, s));
  return out;
}

// ── page snippet ─────────────────────────────────────────────────────────────────────────────────────────

// The exact tags the main session adds to live/index.html (inside <head>, and the script before </body>).
// Registration only runs where the Whalyom server serves the page (window.__WHALYOM_LOCAL__ is injected by
// tools/server.mjs) in a secure context (localhost or HTTPS); on claude.ai it does nothing.
export function registrationSnippet({ themeColor = FALLBACK_COLOR } = {}) {
  const c = isHexColor(themeColor) ? normHex(themeColor) : FALLBACK_COLOR;
  return `<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="${c}">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Whalyom">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="apple-touch-icon" href="/icon-192.png">
<script>
(() => {
  if (!('serviceWorker' in navigator) || !window.isSecureContext || !window.__WHALYOM_LOCAL__) return;
  const ready = navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(() => navigator.serviceWorker.ready).catch(() => null);
  const post = (msg) => ready.then((reg) => reg && reg.active && reg.active.postMessage(msg));
  // Call from a click (browsers only ask for notification permission on a user gesture).
  window.whalyomEnableAlerts = () => ('Notification' in window ? Notification.requestPermission() : Promise.resolve('denied'));
  // count = decisions waiting for the owner; 0 clears the notification.
  window.whalyomDecisionWaiting = (count, title) => post({ type: 'decision-waiting', count: Number(count) || 0, title: title ? String(title) : undefined });
  // Zero-wiring fallback: follow the page's own :root.decision-waiting state.
  let last = null;
  const sync = () => { const on = document.documentElement.classList.contains('decision-waiting'); if (on !== last) { last = on; window.whalyomDecisionWaiting(on ? 1 : 0); } };
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  sync();
})();
</script>`;
}

// ── files ────────────────────────────────────────────────────────────────────────────────────────────────

// Builds every generated file in memory: { 'manifest.webmanifest': string, 'icon-192.png': Buffer, ... }.
export function buildPwa({ html, sourcePng, sizes = ICON_SIZES } = {}) {
  const manifest = buildManifest({ tokens: extractTokens(html), sizes });
  const files = { 'manifest.webmanifest': manifestText(manifest) };
  for (const [s, png] of Object.entries(makeIcons(sourcePng, sizes))) files[`icon-${s}.png`] = png;
  return { manifest, files };
}

// Checks what is on disk in liveDir. Returns a list of problems ([] = installable).
export function checkPwa({ liveDir = LIVE_DIR } = {}) {
  const errs = [];
  let m = null;
  try { m = JSON.parse(fs.readFileSync(path.join(liveDir, 'manifest.webmanifest'), 'utf8')); } catch (e) { errs.push(`manifest unreadable: ${e.message}`); }
  if (m) errs.push(...validateManifest(m));
  for (const s of ICON_SIZES) {
    try {
      const img = decodePng(fs.readFileSync(path.join(liveDir, `icon-${s}.png`)));
      if (img.width !== s || img.height !== s) errs.push(`icon-${s}.png is ${img.width}x${img.height}`);
    } catch (e) { errs.push(`icon-${s}.png: ${e.message}`); }
  }
  let sw = '';
  try { sw = fs.readFileSync(path.join(liveDir, 'sw.js'), 'utf8'); } catch { errs.push('sw.js missing'); }
  if (sw) for (const p of BYPASS_PREFIXES) if (!sw.includes(`'${p}'`)) errs.push(`sw.js does not list ${p} as bypassed`);
  return errs;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const html = fs.existsSync(path.join(LIVE_DIR, 'index.html')) ? fs.readFileSync(path.join(LIVE_DIR, 'index.html'), 'utf8') : '';
  if (args.includes('--snippet')) {
    console.log(registrationSnippet({ themeColor: extractTokens(html).bg }));
  } else if (args.includes('--check')) {
    const errs = checkPwa();
    if (errs.length) { for (const e of errs) console.error(`pwa: ${e}`); process.exit(1); }
    console.log('pwa: manifest, icons and service worker look installable');
  } else {
    if (!fs.existsSync(SOURCE_ICON)) { console.error(`pwa: source icon missing: ${SOURCE_ICON}`); process.exit(1); }
    const { files } = buildPwa({ html, sourcePng: fs.readFileSync(SOURCE_ICON) });
    for (const [name, body] of Object.entries(files)) {
      const f = path.join(LIVE_DIR, name);
      const prev = fs.existsSync(f) ? fs.readFileSync(f) : null;
      if (prev && prev.equals(Buffer.from(body))) { console.log(`pwa: ${name} unchanged`); continue; }
      fs.writeFileSync(f, body);
      console.log(`pwa: wrote live/${name}`);
    }
  }
}
