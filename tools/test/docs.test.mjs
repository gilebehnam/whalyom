// Docs drift checks: the workforce numbers and the live documents the docs name must match the code.
// Run: node --test tools/test/docs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { roster, pods, DEPARTMENTS } from '../roster.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const DOCS = ['CLAUDE.md', '.claude/skills/om/SKILL.md', 'docs/KNOWLEDGE.md'];

const tiers = {};
for (const a of roster) tiers[a.tier] = (tiers[a.tier] ?? 0) + 1;
const expected = {
  agents: roster.length,
  pods: Object.keys(pods).length,
  departments: Object.keys(DEPARTMENTS).length,
  mega: tiers.mega ?? 0, core: tiers.core ?? 0, micro: tiers.micro ?? 0,
};

test('every "<N> agents|pods|departments|mega|core|micro" phrase matches the live roster', () => {
  const wrong = [];
  for (const f of DOCS) {
    for (const m of read(f).matchAll(/\b(\d[\d,]*) (agents|pods|departments|mega|core|micro)\b/g)) {
      const n = Number(m[1].replace(/,/g, ''));
      if (n !== expected[m[2]]) wrong.push(`${f}: "${m[0]}" (roster has ${expected[m[2]]} ${m[2]})`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('the om skill names the department count the mega sweep runs', () => {
  const src = read('.claude/workflows/om-mega-sweep.js');
  const all = src.match(/const ALL = \[([^\]]*)\]/);
  assert.ok(all, 'ALL list found in om-mega-sweep.js');
  const n = (all[1].match(/['"][^'"]+['"]/g) ?? []).length;
  assert.equal(n, expected.departments, 'mega sweep covers every department');
  const row = read('.claude/skills/om/SKILL.md').match(/the (\d+) department-head mega agents/);
  assert.ok(row, 'mega-sweep row present');
  assert.equal(Number(row[1]), n);
});

test('the om skill Live control room section lists every live document a tool writes', () => {
  const skill = read('.claude/skills/om/SKILL.md');
  const start = skill.indexOf('### Live control room');
  assert.ok(start > -1, 'Live control room section present');
  const end = skill.indexOf('\n### ', start + 5);
  const section = skill.slice(start, end > -1 ? end : undefined);
  const fromSnapshot = [...read('tools/live-snapshot.mjs').matchAll(/\bwrite\('([a-z-]+)'/g)].map((m) => m[1]);
  assert.ok(fromSnapshot.length >= 7, `live-snapshot writes ${fromSnapshot.join(', ')}`);
  // Written by other tools: needs-you-know.mjs, funnel.mjs, sync-sites.mjs.
  const others = { nyk: 'tools/needs-you-know.mjs', funnel: 'tools/funnel.mjs', sites: 'tools/sync-sites.mjs' };
  for (const [name, tool] of Object.entries(others)) assert.match(read(tool), new RegExp(`live-${name}\\.json`), `${tool} writes live-${name}.json`);
  const missing = [...fromSnapshot, ...Object.keys(others)].filter((n) => !new RegExp('`' + n + '`').test(section));
  assert.deepEqual(missing, [], 'documents missing from the om skill Live control room section');
  for (const tool of ['tools/live-snapshot.mjs', ...Object.values(others)]) assert.ok(section.includes(tool), `section names ${tool}`);
});
