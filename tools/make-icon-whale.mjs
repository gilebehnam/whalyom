// Whalyom mark: three thin interlocking circles; the third is the arc of a breaching whale.
// One geometry, many outputs, no dependencies:
//   node tools/make-icon-whale.mjs
//     assets/brand/whalyom-mark.svg       currentColor mark (circles at .55, whale solid)
//     assets/brand/whalyom-mark-mono.svg  one flat colour, for stamps and print
//     assets/brand/whalyom-lockup.svg     mark + W H A L Y O M (mirrored L)
//     assets/brand/favicon.svg            heavier lines on a night tile, readable at 16 px
//     tools/whalyom.ico                   desktop shortcut icon, PNG-in-ICO at 16/32/48/256
//     site/concepts/logo.html             preview sheet (http://localhost:4321/site/concepts/logo.html)
//   node tools/make-icon-whale.mjs --live    also refreshes the masthead mark and favicon in live/index.html
//   node tools/make-icon-whale.mjs --preview <dir>   also writes the PNG sizes to <dir>
// The older tools/make-icon.mjs (pearl medallion) is kept; this script now owns tools/whalyom.ico.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const brand = path.join(root, 'assets', 'brand');
const f2 = (n) => (Math.round(n * 100) / 100).toString();

// ── geometry (64 × 64 viewBox) ───────────────────────────────
export const C1 = { cx: 23.5, cy: 24, r: 14.5 };   // perception
export const C2 = { cx: 40.5, cy: 24, r: 14.5 };   // strategy
export const C3 = { cx: 32, cy: 38.5, r: 14.5 };   // revenue: the whale's leap
const deg = Math.PI / 180;
const onC = (th, rr = C3.r) => [C3.cx + rr * Math.cos(th), C3.cy - rr * Math.sin(th)];
const HEAD = 24 * deg, TAIL = 142 * deg, W = 6.6, WP = 0.8;
// body width along the spine, u = 0 at the nose, 1 at the tail stock
const width = (u) => u < 0.34 ? W * Math.pow(Math.sin(Math.PI / 2 * u / 0.34), 0.38) : WP + (W - WP) * Math.pow((1 - u) / 0.66, 1.5);
const spine = (u) => HEAD + (TAIL - HEAD) * u;
// outline points along the arc: dorsal on the outside of the circle, belly inside
const bodyPts = () => {
  const N = 22, back = [], belly = [];
  for (let i = 0; i <= N; i++) {
    const u = Math.pow(i / N, 1.15), th = spine(u), w = width(u);
    back.push(onC(th, C3.r + 0.36 * w));
    belly.push(onC(th, C3.r - 0.64 * w));
  }
  return { back, belly };
};
// cubic path through points (Catmull-Rom), corners kept sharp
const smooth = (pts, closed) => {
  const n = pts.length, P = (i) => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  const segs = [];
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const k1 = p1[2] ? 0 : 1 / 6, k2 = p2[2] ? 0 : 1 / 6;
    segs.push([p1, [p1[0] + (p2[0] - p0[0]) * k1, p1[1] + (p2[1] - p0[1]) * k1], [p2[0] - (p3[0] - p1[0]) * k2, p2[1] - (p3[1] - p1[1]) * k2], p2]);
  }
  return segs;
};
const quad = (a, c, b, n = 8) => Array.from({ length: n }, (_, i) => { const t = (i + 1) / n, s = 1 - t; return [s * s * a[0] + 2 * s * t * c[0] + t * t * b[0], s * s * a[1] + 2 * s * t * c[1] + t * t * b[1]]; });
export const shapes = () => {
  const { back, belly } = bodyPts();
  // the fluke: two swept lobes at the tail stock, spread across the arc
  const T = onC(TAIL), t = [-Math.sin(TAIL), -Math.cos(TAIL)], nn = [Math.cos(TAIL), -Math.sin(TAIL)];
  const at = (a, b) => [T[0] + t[0] * a + nn[0] * b, T[1] + t[1] * a + nn[1] * b];
  const tipO = [...at(4.4, 7.4), 1], tipI = [...at(4.4, -7.4), 1], notch = [...at(1.7, 0), 1];
  const fluke = [
    at(-0.6, 0.42), ...quad(at(-0.6, 0.42), at(0.6, 4.6), tipO.slice(0, 2), 7).slice(0, -1), tipO,
    ...quad(tipO, at(2.9, 2.6), notch.slice(0, 2), 6).slice(0, -1), notch,
    ...quad(notch, at(2.9, -2.6), tipI.slice(0, 2), 6).slice(0, -1), tipI,
    ...quad(tipI, at(0.6, -4.6), at(-0.6, -0.42), 7),
  ];
  // the pectoral fin, long and swept back like a humpback's
  const fu0 = 0.24, fu1 = 0.36, bw = (u) => C3.r - 0.64 * width(u) + 0.5, b0 = onC(spine(fu0), bw(fu0)), b1 = onC(spine(fu1), bw(fu1)), fr = C3.r - 0.64 * W;
  const ftip = [...onC(spine(0.56), fr - 3.4), 1];
  const fin = [b0, ...quad(b0, onC(spine(0.36), fr - 1.6), ftip.slice(0, 2), 6).slice(0, -1), ftip, ...quad(ftip, onC(spine(0.44), fr - 0.6), b1, 6)];
  const nose = [...onC(HEAD - 0.012, C3.r - 0.1)];
  const body = [nose, ...back, ...belly.slice().reverse()];
  const eye = onC(spine(0.085), C3.r - 0.64 * width(0.085) + 1.15);
  return { body, fluke, fin, eye };
};
const pathD = (pts) => {
  const s = smooth(pts, true);
  return 'M' + f2(s[0][0][0]) + ' ' + f2(s[0][0][1]) + s.map(([, c1, c2, p]) => `C${f2(c1[0])} ${f2(c1[1])} ${f2(c2[0])} ${f2(c2[1])} ${f2(p[0])} ${f2(p[1])}`).join('') + 'Z';
};
export const whaleD = () => { const s = shapes(); return [pathD(s.body), pathD(s.fluke), pathD(s.fin)].join(' '); };
export const eyeAt = () => shapes().eye;

// ── SVG outputs ──────────────────────────────────────────────
const circleEls = (sw, op, attrs = '') => [C1, C2, C3].map((c, i) => `<circle class="c c${i + 1}" cx="${c.cx}" cy="${c.cy}" r="${c.r}" stroke-width="${sw}"${op < 1 ? ` opacity="${op}"` : ''}${attrs}/>`).join('\n    ');
const water = (sw, op = 1) => `<path class="water" d="M10 38.5 H17.2 M46.8 38.5 H54" stroke-width="${sw}"${op < 1 ? ` opacity="${op}"` : ''}/>`;
const eye = () => { const e = eyeAt(); return `<circle class="eye" cx="${f2(e[0])}" cy="${f2(e[1])}" r=".55" stroke="none" style="fill:var(--eye,#071419)"/>`; };
const markInner = (sw = 1.1, op = 0.55, withEye = true) => `<g class="rings" fill="none" stroke="currentColor">
    ${circleEls(sw, op)}
    ${water(sw, 0.8)}
  </g>
  <g class="whale"><path d="${whaleD()}" fill="currentColor"/>${withEye ? eye() : ''}</g>`;
const markSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Whalyom">
  <title>Whalyom</title>
  <!-- Three interlocking circles: perception, strategy, revenue. The third is the leap of a whale
       breaching through the waterline; its arc closes the circle. Generated by tools/make-icon-whale.mjs -->
  ${markInner()}
</svg>
`;
const monoSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Whalyom">
  <title>Whalyom (mono)</title>
  <g fill="none" stroke="#0B1A1F">
    ${circleEls(1.3, 1)}
    ${water(1.3)}
  </g>
  <path d="${whaleD()}" fill="#0B1A1F"/>
  <circle cx="${f2(eyeAt()[0])}" cy="${f2(eyeAt()[1])}" r=".55" fill="#fff"/>
</svg>
`;
const LETTERS = ['W', 'H', 'A', 'L', 'Y', 'O', 'M'];
const lockupSvg = () => {
  const x0 = 96, pitch = 37, base = 43;
  const letters = LETTERS.map((ch, i) => {
    const x = x0 + i * pitch;
    return ch === 'L' ? `<text x="0" y="${base}" transform="translate(${x} 0) scale(-1 1)">L</text>` : `<text x="${x}" y="${base}">${ch}</text>`;
  }).join('\n    ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 64" role="img" aria-label="Whalyom">
  <title>Whalyom</title>
  <style>text{font-family:Jost,Futura,"Century Gothic","Avenir Next","Segoe UI",system-ui,sans-serif;font-weight:200;font-size:30px;text-anchor:middle;fill:currentColor}</style>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
  ${markInner().replace(/\n/g, '\n  ')}
  </g>
  <g>
    ${letters}
  </g>
</svg>
`;
};
const NIGHT = '#071419', INK = '#E8E5DE', CYAN = '#7FE6F2', YELLOW = '#F2C230';
const faviconSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke-linecap="round" stroke-linejoin="round">
  <title>Whalyom</title>
  <rect width="64" height="64" rx="14" fill="${NIGHT}"/>
  <g stroke="${CYAN}" stroke-width="2.6" opacity=".9">
    ${circleEls(2.6, 1)}
  </g>
  <path d="M8 38.5 H17.2 M46.8 38.5 H56" stroke="${YELLOW}" stroke-width="2.6"/>
  <path d="${whaleD()}" fill="${NIGHT}" stroke="${NIGHT}" stroke-width="4"/>
  <path d="${whaleD()}" fill="${INK}" stroke="${INK}" stroke-width=".9"/>
</svg>
`;

// favicon as a compact data URI (the whale path is defined once and used twice)
const faviconUri = () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke-linecap="round"><defs><path id="w" d="${whaleD()}"/></defs><rect width="64" height="64" rx="14" fill="${NIGHT}"/><g stroke="${CYAN}" stroke-width="2.6" opacity=".9">${[C1, C2, C3].map((c) => `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}"/>`).join('')}</g><path d="M8 38.5H17.2M46.8 38.5H56" stroke="${YELLOW}" stroke-width="2.6"/><use href="#w" fill="${NIGHT}" stroke="${NIGHT}" stroke-width="4"/><use href="#w" fill="${INK}" stroke="${INK}" stroke-width=".9"/></svg>`;
  return 'data:image/svg+xml,' + svg.replace(/"/g, "'").replace(/[<>#%]/g, (c) => encodeURIComponent(c));
};
// the mark as it sits in the Command Center masthead: same geometry, split into animatable groups
const liveMark = () => {
  const e = eyeAt();
  return `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke-linecap="round" stroke-linejoin="round"><defs><path id="wmWhale" d="${whaleD()}"/></defs>` +
    `<g class="rings" stroke="currentColor">${[C1, C2, C3].map((c, i) => `<circle class="c c${i + 1}" cx="${c.cx}" cy="${c.cy}" r="${c.r}"/>`).join('')}<path class="water" d="M10 38.5H17.2M46.8 38.5H54"/></g>` +
    `<g class="breach"><g class="whale"><use href="#wmWhale" class="knock"/><use href="#wmWhale" class="body"/><circle class="eye" cx="${f2(e[0])}" cy="${f2(e[1])}" r=".6"/></g></g></svg>`;
};
const patchLive = () => {
  const f = path.join(root, 'live', 'index.html');
  let html = fs.readFileSync(f, 'utf8');
  const icon = `<link rel="icon" type="image/svg+xml" id="favicon" href="${faviconUri()}">`;
  html = /<link rel="icon"[^>]*>/.test(html) ? html.replace(/<link rel="icon"[^>]*>/, () => icon) : html.replace(/(<title>[^<]*<\/title>\n)/, (m) => m + icon + '\n');
  html = html.replace(/<svg class="mark"[\s\S]*?<\/svg>/, () => liveMark());
  fs.writeFileSync(f, html);
};

// ── raster: flatten the same paths, 4× supersampled ─────────
const flatten = (pts) => { const out = []; for (const [p0, c1, c2, p1] of smooth(pts, true)) for (let i = 0; i < 10; i++) { const t = i / 10, s = 1 - t; out.push([s * s * s * p0[0] + 3 * s * s * t * c1[0] + 3 * s * t * t * c2[0] + t * t * t * p1[0], s * s * s * p0[1] + 3 * s * s * t * c1[1] + 3 * s * t * t * c2[1] + t * t * t * p1[1]]); } return out; };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const render = (S) => {
  const SS = 4, N = S * SS, sc = N / 64;
  const cov = () => new Float32Array(S * S);
  const add = (m, x, y) => { m[(y / SS | 0) * S + (x / SS | 0)] += 1 / (SS * SS); };
  // small icons get heavier lines so the mark survives 16 px
  const sw = S <= 16 ? 4.2 : S <= 32 ? 3.2 : S <= 48 ? 2.8 : 2.4, pad = 0;
  const tile = cov(), rings = cov(), wl = cov(), whale = cov();
  const rad = 14 * sc;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const px = (x + 0.5) / sc, py = (y + 0.5) / sc;
    // rounded tile
    const qx = Math.max(Math.abs(x + 0.5 - N / 2) - (N / 2 - rad), 0), qy = Math.max(Math.abs(y + 0.5 - N / 2) - (N / 2 - rad), 0);
    if (Math.hypot(qx, qy) <= rad) add(tile, x, y);
    for (const c of [C1, C2, C3]) if (Math.abs(Math.hypot(px - c.cx, py - c.cy) - c.r) <= sw / 2) { add(rings, x, y); break; }
    if (Math.abs(py - 38.5) <= sw / 2 && ((px >= 8 - pad && px <= 17.2) || (px >= 46.8 && px <= 56))) add(wl, x, y);
  }
  // whale: scanline fill of the union (nonzero) of body, fluke and fin, slightly dilated at small sizes
  const s = shapes(), polys = [s.body, s.fluke, s.fin].map(flatten);
  const M = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) {
    const py = (y + 0.5) / sc, xs = [];
    for (const poly of polys) for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if ((a[1] <= py) !== (b[1] <= py)) xs.push([a[0] + (py - a[1]) / (b[1] - a[1]) * (b[0] - a[0]), a[1] < b[1] ? 1 : -1]);
    }
    xs.sort((p, q) => p[0] - q[0]);
    let wnd = 0;
    for (let k = 0; k < xs.length - 1; k++) {
      wnd += xs[k][1];
      if (wnd === 0) continue;
      const x0 = Math.max(0, Math.ceil(xs[k][0] * sc - 0.5)), x1 = Math.min(N - 1, Math.floor(xs[k + 1][0] * sc - 0.5));
      for (let x = x0; x <= x1; x++) M[y * N + x] = 1;
    }
  }
  // round dilation on the supersampled mask: the whale grows a little at small sizes and gets a
  // night-coloured knockout so it separates from the rings it crosses
  const dilate = (src, r) => {
    if (r < 0.5) return src;
    const out = new Uint8Array(N * N), R = Math.ceil(r), offs = [];
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= r * r) offs.push([dx, dy]);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (src[y * N + x]) for (const [dx, dy] of offs) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < N && Y < N) out[Y * N + X] = 1; }
    return out;
  };
  const grow = (S <= 16 ? 1.0 : S <= 32 ? 0.6 : S <= 48 ? 0.4 : 0.15) * sc, knock = (S <= 32 ? 1.6 : 1.2) * sc;
  const Mw = dilate(M, grow), Mk = dilate(Mw, knock), halo = cov();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { if (Mw[y * N + x]) add(whale, x, y); if (Mk[y * N + x]) add(halo, x, y); }
  const px = Buffer.alloc(S * S * 4), bg = hex(NIGHT), cy = hex(CYAN), yl = hex(YELLOW), ink = hex(INK);
  const ringOp = S <= 16 ? 0.62 : S <= 32 ? 0.7 : 0.85;
  for (let i = 0; i < S * S; i++) {
    const a = Math.min(1, tile[i]);
    let c = bg.slice();
    const over = (col, k) => { k = Math.min(1, k); c = c.map((v, j) => v + (col[j] - v) * k); };
    over(cy, rings[i] * ringOp); over(yl, wl[i]); over(bg, halo[i]); over(ink, whale[i]);
    px[i * 4] = Math.round(c[0]); px[i * 4 + 1] = Math.round(c[1]); px[i * 4 + 2] = Math.round(c[2]); px[i * 4 + 3] = Math.round(a * 255);
  }
  return px;
};
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const png = (S, px) => {
  const raw = Buffer.alloc((S * 4 + 1) * S);
  for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
};
const ico = (pngs) => {
  const head = Buffer.from([0, 0, 1, 0, pngs.length, 0]);
  let off = 6 + 16 * pngs.length;
  const dir = pngs.map(([S, buf]) => { const d = Buffer.alloc(16); d[0] = S >= 256 ? 0 : S; d[1] = S >= 256 ? 0 : S; d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6); d.writeUInt32LE(buf.length, 8); d.writeUInt32LE(off, 12); off += buf.length; return d; });
  return Buffer.concat([head, ...dir, ...pngs.map(([, b]) => b)]);
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  fs.mkdirSync(brand, { recursive: true });
  fs.writeFileSync(path.join(brand, 'whalyom-mark.svg'), markSvg());
  fs.writeFileSync(path.join(brand, 'whalyom-mark-mono.svg'), monoSvg());
  fs.writeFileSync(path.join(brand, 'whalyom-lockup.svg'), lockupSvg());
  fs.writeFileSync(path.join(brand, 'favicon.svg'), faviconSvg());
  // preview sheet, served by the local hub at /site/concepts/logo.html
  const strip = (s) => s.replace(/<title>[^<]*<\/title>\s*/, '').replace(/<!--[\s\S]*?-->\s*/g, '');
  const at = (svg, px) => `<figure><div style="width:${px}px;height:${px}px">${strip(svg)}</div><figcaption>${px}px</figcaption></figure>`;
  fs.writeFileSync(path.join(root, 'site', 'concepts', 'logo.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Whalyom mark</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jost:wght@200;400&display=swap">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(faviconSvg())}">
<!-- generated by tools/make-icon-whale.mjs; edit the script, not this file -->
<style>body{margin:0;padding:48px 24px;background:#071419;color:#E8E5DE;font:400 13px Jost,sans-serif;letter-spacing:.2em;text-transform:uppercase}
section{display:flex;flex-wrap:wrap;gap:40px;align-items:flex-end;justify-content:center;margin:0 auto 56px;max-width:1100px}
h2{font-weight:200;font-size:12px;letter-spacing:.5em;color:#8FA3A8;text-align:center;margin:0 0 24px}
figure{margin:0;display:grid;gap:10px;justify-items:center}figcaption{font-size:10px;color:#8FA3A8}figure div svg{width:100%;height:100%;display:block}
.light{background:#E8E5DE;color:#0B1A1F;padding:32px;border-radius:2px}.y{color:#F2C230}.lock{width:min(680px,100%)}.lock svg{width:100%;height:auto}</style>
<h2>Mark, currentColor</h2><section>${at(markSvg(), 220)}${at(markSvg(), 96)}${at(markSvg(), 48)}${at(markSvg(), 32)}${at(markSvg(), 16)}<div class="y">${at(markSvg(), 96)}</div></section>
<h2>Favicon tile</h2><section>${at(faviconSvg(), 128)}${at(faviconSvg(), 48)}${at(faviconSvg(), 32)}${at(faviconSvg(), 16)}</section>
<h2>Mono</h2><section><div class="light">${at(monoSvg(), 160)}</div><div class="light">${at(monoSvg(), 32)}</div></section>
<h2>Lockup</h2><section><div class="lock">${strip(lockupSvg())}</div></section>
`);
  const sizes = [16, 32, 48, 256].map((S) => [S, png(S, render(S))]);
  fs.writeFileSync(path.join(here, 'whalyom.ico'), ico(sizes));
  const preview = process.argv.includes('--preview') ? process.argv[process.argv.indexOf('--preview') + 1] : null;
  if (preview) for (const [S, b] of sizes) fs.writeFileSync(path.join(preview, `whalyom-${S}.png`), b);
  console.log(`wrote 4 SVGs to assets/brand and tools/whalyom.ico (${sizes.map(([S, b]) => `${S}px ${b.length}b`).join(', ')})`);
  if (process.argv.includes('--path')) console.log(whaleD());
  // --live also refreshes the masthead mark and the favicon inside live/index.html
  if (process.argv.includes('--live')) { patchLive(); console.log('patched live/index.html (masthead mark, favicon)'); }
}
