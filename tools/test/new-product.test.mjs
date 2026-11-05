// tools/new-product.mjs: every option is validated before anything touches disk, and a failure leaves no half-made workspace.
// Runs the real script copied into a temp root, so the repo's products/ is never touched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let root;
const run = (...a) => spawnSync(process.execPath, [path.join(root, 'tools', 'new-product.mjs'), ...a], { encoding: 'utf8', cwd: root });
const product = (slug) => JSON.parse(fs.readFileSync(path.join(root, 'products', slug, 'product.json'), 'utf8'));
const leftovers = () => fs.readdirSync(path.join(root, 'products')).filter((s) => s.startsWith('_tmp-'));

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'om-newproduct-'));
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'tools', 'new-product.mjs'), path.join(root, 'tools', 'new-product.mjs'));
  fs.copyFileSync(path.join(REPO, 'tools', 'presets.json'), path.join(root, 'tools', 'presets.json'));
  fs.cpSync(path.join(REPO, 'products', '_template'), path.join(root, 'products', '_template'), { recursive: true });
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('unknown --preset exits 2 without creating the folder, and a retry with a valid preset works', () => {
  const r = run('zz-test-preset', '--preset', 'nope');
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /Unknown preset nope/);
  assert.equal(fs.existsSync(path.join(root, 'products', 'zz-test-preset')), false);
  const ok = run('zz-test-preset', '--preset', 'ecommerce', '--name', 'Retry Shop');
  assert.equal(ok.status, 0, ok.stderr);
  const p = product('zz-test-preset');
  assert.equal(p.slug, 'zz-test-preset');
  assert.equal(p.name, 'Retry Shop');
  assert.equal(p.preset, 'ecommerce');
  assert.ok(fs.existsSync(path.join(root, 'products', 'zz-test-preset', 'brief.md')));
  assert.ok(fs.existsSync(path.join(root, 'products', 'zz-test-preset', 'runs', 'applied')));
  assert.deepEqual(leftovers(), []);
});

test('bad --budget, --autonomy, --currency, --brief-file and unknown flags exit 2 with no directory', () => {
  for (const [slug, extra] of [
    ['zz-bad-budget', ['--budget', 'abc']],
    ['zz-neg-budget', ['--budget', '-5']],
    ['zz-bad-autonomy', ['--autonomy', 'autopliot']],
    ['zz-bad-currency', ['--currency', 'XYZ']],
    ['zz-bad-brief', ['--brief-file', path.join(root, 'no-such-brief.md')]],
    ['zz-bad-flag', ['--budjet', '50']],
    ['zz-no-value', ['--preset']],
  ]) {
    const r = run(slug, ...extra);
    assert.equal(r.status, 2, `${extra.join(' ')}: ${r.stderr}`);
    assert.equal(fs.existsSync(path.join(root, 'products', slug)), false, `${extra.join(' ')} left products/${slug}`);
  }
  assert.match(run('zz-usage').stderr + run('Bad Slug').stderr, /--preset .*--autonomy .*--budget .*--currency/);
  assert.deepEqual(leftovers(), []);
});

test('--budget 0 keeps free mode with both caps 0; a positive budget sets paid caps with daily <= monthly', () => {
  assert.equal(run('zz-zero', '--budget', '0').status, 0);
  const z = product('zz-zero');
  assert.equal(z.budget.mode, 'free');
  assert.equal(z.budget.monthly_cap, 0);
  assert.equal(z.budget.daily_cap, 0);

  assert.equal(run('zz-paid', '--budget', '60', '--currency', 'EUR', '--autonomy', 'autopilot').status, 0);
  const p = product('zz-paid');
  assert.equal(p.budget.mode, 'paid');
  assert.equal(p.budget.monthly_cap, 60);
  assert.equal(p.budget.daily_cap, 2);
  assert.equal(p.budget.currency, 'EUR');
  assert.equal(p.autonomy.level, 'autopilot');

  assert.equal(run('zz-tiny', '--budget', '0.5').status, 0);
  const t = product('zz-tiny');
  assert.ok(t.budget.daily_cap <= t.budget.monthly_cap, 'daily cap never above the monthly cap');
});

test('a readable --brief-file is copied, and an existing slug still exits 1', () => {
  const brief = path.join(root, 'brief-in.md');
  fs.writeFileSync(brief, '# Brief: Mugs\n\nHand-made mugs.\n');
  assert.equal(run('zz-brief', '--brief-file', brief).status, 0);
  assert.equal(fs.readFileSync(path.join(root, 'products', 'zz-brief', 'brief.md'), 'utf8'), '# Brief: Mugs\n\nHand-made mugs.\n');
  const again = run('zz-brief');
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already exists/);
});

test('stage 5 defaults: earned autonomy on (streak 10), price and call never automatic, creative cap 0, voice off', () => {
  assert.equal(run('zz-defaults').status, 0);
  const p = product('zz-defaults');
  assert.deepEqual(p.autonomy.earned, { streak: 10 });
  assert.ok(p.autonomy.never_auto.includes('price'), 'price never earns autonomy');
  assert.ok(p.autonomy.never_auto.includes('call'), 'calls are never automatic');
  assert.equal(p.autonomy.auto_spend_per_day, 0, 'earned autonomy does not open automatic spend');
  assert.equal(p.budget.monthly_cap, 0);
  assert.equal(p.creative.monthly_cap, 0, 'no paid creative generation until the owner sets a cap');
  assert.equal(p.voice.enabled, false);
  assert.equal(p.voice.record, false);
  assert.equal(p.social_inbox.max_age_days, 7);
  assert.equal(p.social_inbox.max_drafts, 25);
  assert.equal(p.owner_approval.spend, true);
});

test('--no-earned turns earned autonomy off and can sit anywhere among the flags', () => {
  const a = run('zz-noearn-a', '--no-earned', '--name', 'A');
  assert.equal(a.status, 0, a.stderr);
  assert.equal(product('zz-noearn-a').autonomy.earned, false);
  assert.equal(product('zz-noearn-a').name, 'A');
  const b = run('zz-noearn-b', '--budget', '30', '--no-earned');
  assert.equal(b.status, 0, b.stderr);
  assert.equal(product('zz-noearn-b').autonomy.earned, false);
  assert.equal(product('zz-noearn-b').budget.monthly_cap, 30);
  const bad = run('zz-noearn-c', '--name', '--no-earned');
  assert.equal(bad.status, 2, 'a flag value cannot be a switch');
  assert.equal(fs.existsSync(path.join(root, 'products', 'zz-noearn-c')), false);
  assert.match(run('zz-usage2', '--bogus').stderr, /--no-earned/);
  assert.deepEqual(leftovers(), []);
});

test('the earned default only lifts the level gate: price never earns, and call is held by never_auto', async () => {
  const { earnedTypes } = await import('../lib/earned.mjs');
  const p = product('zz-defaults');
  const owned = (type, channel, i) => ({ id: `${type}-${i}`, type, channel, status: 'approved', decided_by: 'owner', decided_at: `2026-10-${String(10 + i).padStart(2, '0')}T00:00:00Z` });
  const list = [];
  for (let i = 0; i < 10; i++) list.push(owned('post', 'linkedin', i), owned('price', 'site', i), owned('call', 'voice', i));
  const earned = earnedTypes(list, p.autonomy.earned);
  assert.ok(earned.has('post|linkedin'));
  assert.equal(earned.has('price|site'), false, 'price never earns');
  // policy.mjs ignores an earned key whose type is in never_auto; call is there by default.
  const effective = [...earned.keys()].filter((k) => !p.autonomy.never_auto.includes(k.split('|')[0]));
  assert.deepEqual(effective, ['post|linkedin']);
});
