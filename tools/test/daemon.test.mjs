// Run: node --test tools/test/daemon.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testEnv } from './_env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const slug = `zz-daemon-${process.pid}`;
const dir = path.join(root, 'products', slug);
// A second active product the cycle must leave alone: OM_DAEMON_ONLY keeps the cycle on the test product,
// so the owner's real active products (and their approved items) are never run by the suite.
const other = `zz-daemon-other-${process.pid}`;
const otherDir = path.join(root, 'products', other);
// The knowledge cycle writes into a temp copy (WHALYOM_KNOWLEDGE, WHALYOM_KNOWLEDGE_SKILLS), never knowledge/ in the repo.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-daemon-'));
const briefing = path.join(root, 'knowledge', 'BRIEFING.md');
const mtime = (f) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : null);
const logFile = path.join(root, 'state', 'daemon-log.jsonl');
// A private lease file, so a hub daemon running on this machine never blocks (or is blocked by) the test.
const leaseFile = path.join(root, 'state', `scheduler-test-${process.pid}.json`);
const connectorEnv = ['OM_KILL', 'META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID', 'META_PAGE_ID', 'RESEND_API_KEY', 'OM_EMAIL_FROM', 'OM_WEBHOOK_DEFAULT', 'OM_WEBHOOK_X', 'OM_WEBHOOK_LINKEDIN', 'OM_WEBHOOK_REDDIT', 'OM_WEBHOOK_GOOGLE_ADS', 'OM_WEBHOOK_SECRET', 'STRIPE_API_KEY', 'OM_SITE_REPO', 'INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_USER_ID', 'FACEBOOK_PAGE_ID', 'FACEBOOK_PAGE_ACCESS_TOKEN'];
const cleanEnv = (extra = {}) => { const e = { ...process.env }; for (const k of connectorEnv) delete e[k]; return testEnv(e, { OM_KNOWLEDGE_OFFLINE: '1', OM_SCHEDULER_FILE: leaseFile, OM_DAEMON_ONLY: slug, WHALYOM_KNOWLEDGE: path.join(tmp, 'knowledge'), WHALYOM_KNOWLEDGE_SKILLS: path.join(tmp, 'skills'), OM_LOG_MAX_BYTES: String(2 ** 40), ...extra }); };
const node = (args, env) => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', env });
const logLines = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter(Boolean) : []);
const lastJson = (out) => JSON.parse(out.trim().split(/\r?\n/).at(-1));

const briefing0 = mtime(briefing);
// The daemon's per-product order: social-inbox runs before funnel; lead-score, inbox, sequences and reallocate
// merge through apply-results before policy and execute; autonomy-report reads policy's decisions; attribution,
// ai-visibility, bandit and competitor-watch run after execute.
const productSteps = ['metrics', 'social-inbox', 'funnel', 'lead-score', 'inbox', 'sequences', 'reallocate', 'apply-results', 'crm', 'creators',
  'free-engine', 'budget', 'killswitch', 'policy', 'autonomy-report', 'execute', 'attribution', 'ai-visibility', 'bandit', 'competitor-watch', 'learn'];

before(() => {
  for (const s of [slug, other]) {
    const r = node(['tools/new-product.mjs', s, '--autonomy', 'autopilot'], cleanEnv());
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const pj = path.join(root, 'products', s, 'product.json');
    const p = JSON.parse(fs.readFileSync(pj, 'utf8'));
    p.stage = 'active';
    fs.writeFileSync(pj, JSON.stringify(p, null, 2));
  }
  fs.cpSync(path.join(root, 'knowledge'), path.join(tmp, 'knowledge'), { recursive: true });
});
after(() => {
  for (const d of [dir, otherDir]) fs.rmSync(d, { recursive: true, force: true });
  fs.rmSync(leaseFile, { force: true }); fs.rmSync(leaseFile + '.lock', { force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('one cycle runs every step for an active product and logs it', () => {
  const n0 = logLines().length;
  const r = node(['tools/daemon.mjs'], cleanEnv());
  assert.equal(r.status, 0, r.stderr);
  const s = lastJson(r.stdout);
  assert.equal(s.killed, false);
  assert.deepEqual(s.products.map((x) => x.slug), [slug], 'OM_DAEMON_ONLY keeps the cycle on the test product');
  assert.equal(fs.existsSync(path.join(otherDir, 'events.jsonl')), false, 'the other active product was run');
  const p = s.products.find((x) => x.slug === slug);
  assert.ok(p, 'product missing from summary');
  assert.deepEqual(p.steps.map((x) => x.step), productSteps, 'per-product steps in the safe order');
  assert.deepEqual(p.steps.filter((x) => !x.ok), [], JSON.stringify(p.steps));
  assert.equal(p.ok, true);
  assert.deepEqual(s.global.map((x) => x.step), ['knowledge', 'integrations', 'outcomes', 'ai-modes', 'routing', 'product-review', 'needs-you-know', 'build-state', 'live-snapshot']);
  assert.equal(s.global[0].step, 'knowledge');
  assert.equal(p.steps.find((x) => x.step === 'competitor-watch').skipped, undefined, 'competitor-watch runs on the first cycle of the day');
  const today = new Date().toISOString().slice(0, 10);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'daemon-stamps.json'), 'utf8')), { 'competitor-watch': today });
  assert.deepEqual(s.global.filter((x) => !x.ok), [], JSON.stringify(s.global));
  const lines = logLines();
  assert.ok(lines.length > n0 || lines.length === 500);
  assert.ok(JSON.parse(lines.at(-1)).products.some((x) => x.slug === slug));
  assert.ok(fs.existsSync(path.join(tmp, 'knowledge', 'BRIEFING.md')), 'knowledge cycle wrote the temp briefing');
  assert.equal(mtime(briefing), briefing0, 'knowledge/BRIEFING.md in the repo was rewritten');
});

test('a second cycle the same day skips competitor-watch but runs every other step', () => {
  const r = node(['tools/daemon.mjs'], cleanEnv());
  assert.equal(r.status, 0, r.stderr);
  const p = lastJson(r.stdout).products.find((x) => x.slug === slug);
  assert.deepEqual(p.steps.map((x) => x.step), productSteps);
  const cw = p.steps.find((x) => x.step === 'competitor-watch');
  assert.equal(cw.ok, true);
  assert.match(cw.skipped ?? '', /^already ran \d{4}-\d{2}-\d{2}$/);
  assert.equal(p.ok, true, JSON.stringify(p.steps));
});

test('OM_KILL=1 does nothing but log', () => {
  const r = node(['tools/daemon.mjs'], cleanEnv({ OM_KILL: '1' }));
  assert.equal(r.status, 0, r.stderr);
  const s = lastJson(r.stdout);
  assert.equal(s.killed, true);
  assert.deepEqual(s.products, []);
  assert.deepEqual(s.global, []);
});
