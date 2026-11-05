// learn.mjs: LEARNINGS.md dedupes on the exact tagged line (a changed verdict is recorded again, a
// campaign id in prose does not block it), and parallel runs do not drop each other's shared
// scoreboard entries.
// Run: node --test tools/test/learn.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLock } from '../lib/lock.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const base = `zz-learn-${process.pid}`;
const slugs = [];
const P = (s, f = '') => path.join(root, 'products', s, f);
const write = (s, f, v) => { fs.mkdirSync(path.dirname(P(s, f)), { recursive: true }); fs.writeFileSync(P(s, f), typeof v === 'string' ? v : JSON.stringify(v, null, 2)); };
const shared = path.join(root, 'playbooks', 'scoreboard.json');
const today = new Date().toISOString().slice(0, 10);
const run = (slug) => {
  const r = spawnSync(process.execPath, [path.join(root, 'tools', 'learn.mjs'), slug], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return JSON.parse(r.stdout.trim().split(/\r?\n/).at(-1));
};
const rows = (channel, campaign, spend, revenue, conversions) => [
  { date: today, channel, campaign, metric: 'spend', value: spend, source: 'import' },
  { date: today, channel, campaign, metric: 'revenue', value: revenue, source: 'import' },
  { date: today, channel, campaign, metric: 'conversions', value: conversions, source: 'import' },
  { date: today, channel, campaign, metric: 'clicks', value: 100, source: 'import' },
];
const product = (n) => { const s = `${base}-${n}`; slugs.push(s); write(s, 'product.json', { name: `Learn ${n}`, goals: {} }); return s; };

after(() => {
  for (const s of slugs) fs.rmSync(P(s), { recursive: true, force: true });
  const release = acquireLock(path.join(root, 'playbooks', '.scoreboard.lock'), { waitMs: 10000, staleMs: 60 * 1000 });
  try {
    const all = JSON.parse(fs.readFileSync(shared, 'utf8'));
    for (const s of slugs) delete all[s];
    fs.writeFileSync(shared, JSON.stringify(all, null, 2));
  } catch { /* no shared file */ } finally { release?.(); }
});

test('an AVOID campaign that now wins gets a WIN line; an id seen only in prose still gets its line', () => {
  const slug = product('a');
  write(slug, 'LEARNINGS.md', `# Learnings\n\nWe talked about c2 in the kickoff notes.\n\n- AVOID (2026-01-01): google c1 — fitness 0.1, 0 conversions on 50.00 spend. Change angle or audience before retrying. (scoreboard)\n`);
  write(slug, 'metrics/kpis.json', [
    ...rows('google', 'c1', 50, 500, 10),
    ...rows('google', 'c3', 50, 100, 2),
    ...rows('google', 'c4', 50, 60, 1),
    ...rows('google', 'c2', 50, 0, 0),
  ]);
  const r = run(slug);
  assert.equal(r.winners, 1); assert.equal(r.losers, 1);
  const learn = fs.readFileSync(P(slug, 'LEARNINGS.md'), 'utf8');
  assert.match(learn, /^- WIN \(\d{4}-\d{2}-\d{2}\): google c1 —/m, 'c1 is promoted to WIN');
  assert.match(learn, /^- AVOID \(\d{4}-\d{2}-\d{2}\): google c2 —/m, 'c2 in prose does not block its line');
  // A second run with the same results adds nothing.
  run(slug);
  assert.equal(fs.readFileSync(P(slug, 'LEARNINGS.md'), 'utf8'), learn);
});

test('a short id inside another campaign id does not block it', () => {
  const slug = product('b');
  write(slug, 'LEARNINGS.md', `# Learnings\n\n- WIN (2026-01-01): meta brand-awareness — fitness 3, ROAS 4.00, 5 conversions on 50.00 spend. Do more like this. (scoreboard)\n`);
  write(slug, 'metrics/kpis.json', [...rows('meta', 'brand', 50, 400, 8), ...rows('meta', 'other', 50, 0, 0)]);
  run(slug);
  assert.match(fs.readFileSync(P(slug, 'LEARNINGS.md'), 'utf8'), /^- WIN \(\d{4}-\d{2}-\d{2}\): meta brand —/m);
});

test('parallel runs keep every product in the shared scoreboard', async () => {
  const many = Array.from({ length: 6 }, (_, i) => product(`p${i}`));
  for (const s of many) write(s, 'metrics/kpis.json', [...rows('reddit', `${s}-win`, 50, 300, 6), ...rows('reddit', `${s}-lose`, 50, 0, 0)]);
  await Promise.all(many.map((s) => new Promise((res, rej) => {
    const c = spawn(process.execPath, [path.join(root, 'tools', 'learn.mjs'), s], { stdio: 'ignore' });
    c.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${s} exited ${code}`))));
  })));
  const all = JSON.parse(fs.readFileSync(shared, 'utf8'));
  for (const s of many) assert.equal(all[s]?.winners?.[0]?.campaign, `${s}-win`, `${s} is in the shared scoreboard`);
  assert.ok(!fs.existsSync(path.join(root, 'playbooks', '.scoreboard.lock')), 'lock released');
});
