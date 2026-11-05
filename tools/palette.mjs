// Whalyom agent palette: 380 colors in 20 hue families × 19 tones (10 base + 5 half-step extension
// tones for the wave-2 agents + 4 more for wave 3), chosen in OKLCH so every tone
// has even perceived lightness. Families follow the Command Center's art direction: the warm,
// lived-in hues of "Her" (coral, terracotta, peach, ochre, rose) and the instrument-lab hues of
// "Westworld" (bone, brass, oxblood, sage, slate, ink-blue). Muted chroma keeps it human, not neon.
// Agents get contiguous colors by department, so a department reads as one family on the map.
//   node tools/palette.mjs   → writes config/agent-palette.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FAMILIES = [
  ['coral', 30], ['terracotta', 42], ['persimmon', 52], ['apricot', 65], ['ochre', 82],
  ['brass', 95], ['olive', 112], ['sage', 140], ['moss', 155], ['eucalyptus', 175],
  ['teal', 195], ['harbor', 220], ['slate', 245], ['indigo', 270], ['heather', 295],
  ['plum', 320], ['mauve', 340], ['rose', 8], ['oxblood', 18], ['bone', 70],
];

// OKLCH → sRGB hex (D65), with simple gamut clipping by reducing chroma.
function oklchToHex(L, C, h) {
  for (let c = C; c >= 0; c -= 0.005) {
    const a = c * Math.cos((h * Math.PI) / 180), b = c * Math.sin((h * Math.PI) / 180);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b, m_ = L - 0.1055613458 * a - 0.0638541728 * b, s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
    const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
    if (lin.every((v) => v >= -0.0005 && v <= 1.0005)) {
      return '#' + lin.map((v) => { v = Math.min(1, Math.max(0, v)); const g = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; return Math.round(g * 255).toString(16).padStart(2, '0'); }).join('');
    }
  }
  return '#808080';
}

// One tone on the family's curve. Base tones are t = 0…9; extension tones sit halfway between
// two base tones (t = 0.5, 2.5, 4.5, 6.5, 8.5), so they share the same lightness, chroma and hue
// curve and read as members of the family, never as new hues.
function tone(name, hue, t) {
  const bone = name === 'bone';
  const L = 0.42 + t * 0.045;                              // 0.42 … 0.825
  const C = bone ? 0.02 + t * 0.002 : 0.06 + 0.05 * Math.sin((Math.PI * (t + 1)) / 11); // muted, peaks mid-tone
  const h = hue + (t - 4.5) * 1.2;                          // slight hue drift inside a family
  return oklchToHex(L, C, (h + 360) % 360);
}

export const BASE_SIZE = FAMILIES.length * 10;              // 200: ids 0…199, unchanged since v1
export const EXTENSION_TONES = [0.5, 2.5, 4.5, 6.5, 8.5];  // ids 200…299 (wave 2 agents)
export const EXTENSION_TONES_2 = [1.5, 3.5, 5.5, 7.5];      // ids 300…379 (wave 3 agents)
export const EXTENSION_TONES_3 = [0.25, 2.25, 4.25, 6.25, 8.25]; // ids 380…479 (wave 4: AI Lab)
export const EXTENSION_TONES_4 = [0.75, 2.75, 4.75, 6.75, 8.75]; // ids 480…579 (wave 6: agents Whalyom grows)

export function buildPalette() {
  const colors = [];
  for (const [name, hue] of FAMILIES) {
    for (let t = 0; t < 10; t++) colors.push({ id: colors.length, family: name, tone: t, hex: tone(name, hue, t) });
  }
  // Extension appended after the base so every existing id and hex stays the same.
  for (const [name, hue] of FAMILIES) {
    for (const t of EXTENSION_TONES) colors.push({ id: colors.length, family: name, tone: t, hex: tone(name, hue, t), extension: true });
  }
  // Second extension, appended after the first so ids 0…299 never move.
  for (const [name, hue] of FAMILIES) {
    for (const t of EXTENSION_TONES_2) colors.push({ id: colors.length, family: name, tone: t, hex: tone(name, hue, t), extension: true });
  }
  for (const [name, hue] of FAMILIES) {
    for (const t of EXTENSION_TONES_3) colors.push({ id: colors.length, family: name, tone: t, hex: tone(name, hue, t), extension: true });
  }
  for (const [name, hue] of FAMILIES) {
    for (const t of EXTENSION_TONES_4) colors.push({ id: colors.length, family: name, tone: t, hex: tone(name, hue, t), extension: true });
  }
  return colors;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const colors = buildPalette();
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'agent-palette.json'), JSON.stringify({ about: `${colors.length} agent colors: 20 families x 10 base tones (ids 0-199) plus 5 half-step extension tones (ids 200-299) 4 more (ids 300-379) 5 more (ids 380-479) and 5 more (ids 480-579), OKLCH. Assigned by tools/roster.mjs: original agents in department order on the base tones, wave-2 agents on the first extension tones of their department's family, wave-3 and wave-4 agents on the free tones nearest their department's family, each wave limited to the tones that existed when it arrived.`, families: FAMILIES.map(([n, h]) => ({ name: n, hue: h })), colors }, null, 1));
  console.log(`wrote ${colors.length} colors, ${new Set(colors.map((c) => c.hex)).size} unique`);
}
