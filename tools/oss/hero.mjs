// The README hero: an animated SVG of the Command Center's maze (six rings of agents orbiting the whale),
// the wordmark, the promise and the live numbers. SMIL only, so it moves on GitHub without scripts.
//   import { hero } from './hero.mjs'; hero(stats) -> svg string
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HUES = ['#7FE6F2', '#F2C230', '#A78BFA', '#34D399', '#F0826C', '#9FEAF3', '#E8B923', '#C4B5FD', '#5EEAD4', '#FBBF24'];
const fmt = (n) => Number(n).toLocaleString('en-US');

export function hero(s) {
  const W = 1280, H = 640, cx = 930, cy = 300;
  const mark = fs.readFileSync(path.join(root, 'assets', 'brand', 'whalyom-mark.svg'), 'utf8')
    .replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title>[\s\S]*?<\/title>/, '').replace(/<!--[\s\S]*?-->/g, '');
  const rings = [[80, 5], [125, 7], [170, 9], [215, 11], [260, 13], [305, 15]];
  let k = 0;
  const orbit = rings.map(([rx, n], i) => {
    const ry = +(rx * 0.38).toFixed(1); const dur = 30 + i * 10;
    const d = `M${cx - rx},${cy} a${rx},${ry} 0 1,0 ${2 * rx},0 a${rx},${ry} 0 1,0 ${-2 * rx},0`;
    return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#4FAFBC" stroke-width="1" opacity=".45"/>${Array.from({ length: n }, (_, j) => `<circle r="${j % 5 === 0 ? 3.4 : 2.3}" fill="${HUES[(k++) % HUES.length]}"><animateMotion dur="${dur}s" begin="-${((dur / n) * j).toFixed(2)}s" repeatCount="indefinite" path="${d}"/></circle>`).join('')}`;
  }).join('');
  const nums = [[s.agents, 'AI agents'], [s.departments, 'departments'], [s.skills, 'skills'], [s.commands, 'commands'], [s.rules, 'rules'], [s.knowledge_notes, 'verified notes']];
  const strip = nums.map(([v, l], i) => `<g transform="translate(${80 + i * 190},560)"><text font-family="Jost,Segoe UI,Helvetica,Arial,sans-serif" font-size="40" font-weight="300" fill="${i === 0 ? '#F2C230' : '#E8E5DE'}">${fmt(v)}</text><text y="28" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="14" letter-spacing="3" fill="#8FA3A8">${l.toUpperCase()}</text></g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Whalyom: your entire marketing department inside Claude Code">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0B1A1F"/><stop offset="1" stop-color="#050C0F"/></linearGradient>
<radialGradient id="heart"><stop offset="0" stop-color="#9FEAF3" stop-opacity=".45"/><stop offset=".5" stop-color="#7FE6F2" stop-opacity=".12"/><stop offset="1" stop-color="#7FE6F2" stop-opacity="0"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/>
<rect width="${W}" height="${H}" fill="#9FEAF3" opacity="0"><animate attributeName="opacity" values="0;0;.10;0;.05;0;0" keyTimes="0;.86;.87;.88;.895;.91;1" dur="9s" repeatCount="indefinite"/></rect>
<circle cx="${cx}" cy="${cy}" r="150" fill="url(#heart)"><animate attributeName="r" values="140;170;140" dur="4.2s" repeatCount="indefinite"/></circle>
${orbit}
<g transform="translate(${cx - 34},${cy - 34}) scale(1.06)" color="#E8F9FB">${mark}</g>
<g font-family="Jost,Segoe UI,Helvetica,Arial,sans-serif">
<text x="80" y="150" font-size="76" font-weight="300" letter-spacing="22" fill="#E8E5DE">WHALYOM</text>
<line x1="80" y1="190" x2="120" y2="190" stroke="#F2C230" stroke-width="2"/>
<text x="136" y="196" font-size="15" letter-spacing="4" fill="#9FEAF3">OPEN SOURCE · MIT · CLAUDE CODE · CODEX</text>
<text x="80" y="275" font-size="40" font-weight="300" fill="#E8E5DE">Your entire marketing department.</text>
<text x="80" y="327" font-size="40" font-weight="300" fill="#9FEAF3">Inside Claude Code. Free.</text>
<text x="80" y="390" font-size="20" fill="#B9C6C8">It finds your buyers, writes to them and follows every lead to the sale.</text>
<text x="80" y="420" font-size="20" fill="#B9C6C8">Nothing leaves without your yes.</text>
</g>
<line x1="80" y1="510" x2="${W - 80}" y2="510" stroke="#7FE6F2" stroke-opacity=".18"/>
${strip}
</svg>
`;
}
