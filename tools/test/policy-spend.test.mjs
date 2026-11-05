// Automatic spend is limited per day across items and runs, not per item.
// Run: node --test tools/test/policy-spend.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const slug = `zz-policy-spend-${process.pid}`;
const dir = path.join(root, 'products', slug);
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'OM_KILL')), OM_EXECUTE_LOCK_WAIT_MS: '0' };
const run = (args) => {
  const r = spawnSync(process.execPath, [path.join(root, 'tools', 'policy.mjs'), slug, ...args], { encoding: 'utf8', env, cwd: root });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return JSON.parse(r.stdout.trim().split(/\r?\n/).at(-1));
};
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('policy keeps a running daily total of automatic spend, within one run and across runs', () => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'product.json'), JSON.stringify({
    name: 'Policy spend test', domain: 'example.com', stage: 'live',
    autonomy: { level: 'autopilot', auto_spend_per_day: 15 },
    budget: { daily_cap: 100, monthly_cap: 10000 },
  }));
  const item = (id) => ({ id, type: 'spend', status: 'pending', compliance: 'pass', amount: 10, channel: 'meta' });
  fs.writeFileSync(path.join(dir, 'approvals.json'), JSON.stringify([item('S1'), item('S2'), item('S3')]));

  const r = run(['--now', '2026-11-04T09:00:00.000Z']);
  assert.equal(r.auto_approved, 1);
  const owner = r.decisions.filter((d) => d.decision === 'owner');
  assert.equal(owner.length, 2);
  for (const d of owner) assert.match(d.why, /automatic limit 15\/day/);

  // A later run the same day still sees the earlier automatic spend.
  const again = run(['--now', '2026-11-04T18:00:00.000Z']);
  assert.equal(again.auto_approved, 0);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'approvals.json'), 'utf8'));
  assert.equal(saved.filter((x) => x.status === 'auto-approved').length, 1);
});

test('spend approved but not executed yet counts toward daily_cap in the cap check', () => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'product.json'), JSON.stringify({
    name: 'Policy spend test', domain: 'example.com', stage: 'live',
    autonomy: { level: 'autopilot', auto_spend_per_day: 100 },
    budget: { daily_cap: 15, monthly_cap: 10000 },
  }));
  const item = (id) => ({ id, type: 'spend', status: 'pending', compliance: 'pass', amount: 10, channel: 'meta' });
  fs.writeFileSync(path.join(dir, 'approvals.json'), JSON.stringify([item('C1'), item('C2')]));
  const r = run(['--now', '2026-11-04T09:00:00.000Z']);
  assert.equal(r.auto_approved, 1);
  const owner = r.decisions.find((d) => d.decision === 'owner');
  assert.equal(owner.id, 'C2');
  assert.match(owner.why, /over daily_cap 15/);
});
