// Draws the Whalyom desktop icon (a coral pearl inside an engraved brass ring on warm ink) and
// writes tools/whalyom.ico (PNG-in-ICO, 256 px). No dependencies.  node tools/make-icon.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const S = 256, px = Buffer.alloc(S * S * 4);
const mix = (a, b, t) => a + (b - a) * t;
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const ink = hex('#1d1715'), brass = hex('#b08d57'), coral = hex('#d0644e'), peach = hex('#f0b49a');
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const dx = x - S / 2 + 0.5, dy = y - S / 2 + 0.5, r = Math.hypot(dx, dy), R = S / 2 - 6;
  let c = [0, 0, 0], a = 0;
  if (r < R) {                                         // warm ink medallion with a soft edge
    a = Math.min(1, R - r); c = ink;
    const ring = Math.abs(r - R * 0.78);               // engraved brass ring
    if (ring < 3) c = c.map((v, i) => mix(v, brass[i], 1 - ring / 3));
    if (r < R * 0.46) {                                // the pearl: coral with a peach highlight
      const t = Math.max(0, 1 - Math.hypot(dx + R * 0.14, dy + R * 0.16) / (R * 0.46));
      c = coral.map((v, i) => mix(v, peach[i], t * t));
      c = c.map((v, i) => mix(v, ink[i], Math.max(0, (r - R * 0.44) / (R * 0.02))));
    }
    // hairline maze arcs between pearl and ring
    const ang = Math.atan2(dy, dx);
    if (Math.abs(r - R * 0.62) < 0.8 && Math.sin(ang * 3) > -0.2) c = brass;
  }
  const o = (y * S + x) * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = Math.round(a * 255);
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
const dirEntry = Buffer.alloc(16); dirEntry[0] = 0; dirEntry[1] = 0; dirEntry.writeUInt16LE(1, 4); dirEntry.writeUInt16LE(32, 6); dirEntry.writeUInt32LE(png.length, 8); dirEntry.writeUInt32LE(22, 12);
const header = Buffer.from([0, 0, 1, 0, 1, 0]);
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'whalyom.ico');
fs.writeFileSync(out, Buffer.concat([header, dirEntry, png]));
fs.writeFileSync(out.replace(/\.ico$/, '.png'), png);
console.log(`wrote ${out} (${png.length} bytes)`);
