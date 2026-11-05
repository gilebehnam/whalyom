// Lists roster skill references that don't match an installed skill.
// Looks in project .claude/skills, ~/.claude/skills and the plugin cache (plugin:skill).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { roster } from './roster.mjs';
import { allPackSkills } from './skill-packs.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = os.homedir();
const known = new Set();

const dirs = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };
const hasSkill = (d) => fs.existsSync(path.join(d, 'SKILL.md'));

for (const base of [path.join(root, '.claude', 'skills'), path.join(home, '.claude', 'skills')]) {
  for (const n of dirs(base)) if (hasSkill(path.join(base, n))) known.add(n);
}

// Plugin cache: <cache>/<marketplace>/<plugin>/<version>/... any folder holding SKILL.md
const cache = path.join(home, '.claude', 'plugins', 'cache');
const walk = (d, plugin, depth) => {
  if (depth > 6) return;
  for (const n of dirs(d)) {
    const p = path.join(d, n);
    if (n === 'node_modules' || n.startsWith('.')) continue;
    if (hasSkill(p)) {
      known.add(`${plugin}:${n}`); known.add(n);
      if (depth === 0) known.add(`${plugin}:${plugin}`); // single-skill plugin: SKILL.md sits in the version folder
    }
    // Plugin commands (commands/<name>.md) are invocable the same way.
    if (n === 'commands') {
      for (const f of fs.readdirSync(p)) if (f.endsWith('.md')) { known.add(`${plugin}:${f.slice(0, -3)}`); known.add(f.slice(0, -3)); }
    }
    walk(p, plugin, depth + 1);
  }
};
for (const mk of dirs(cache)) for (const plugin of dirs(path.join(cache, mk))) walk(path.join(cache, mk, plugin), plugin, 0);

// Skills that come from the claude.ai account (org plugins) rather than local files.
const remoteFile = path.join(root, 'tools', 'remote-skills.txt');
if (fs.existsSync(remoteFile)) {
  for (const line of fs.readFileSync(remoteFile, 'utf8').split(/\r?\n/)) if (line.trim() && !line.startsWith('#')) known.add(line.trim());
}

if (process.argv.includes('--list')) { console.log([...known].sort().join('\n')); process.exit(0); }
const missing = [];
for (const a of roster) for (const s of a.skills) if (!known.has(s)) missing.push(`${a.name} -> ${s}`);
for (const s of allPackSkills()) if (!known.has(s)) missing.push(`skill pack -> ${s}`);
console.log(`${known.size} skills found; ${missing.length} roster reference(s) missing`);
if (missing.length) console.log(missing.join('\n'));
process.exit(missing.length ? 1 : 0);
