// Wiring of the 2026-11-04 modules that ARCHITECTURE_STATE listed as open: the AI creative connector in the
// registry and its publish approval queued through runs/ by the executor; AI calls behind the executor's send
// guard and never earned; budget updates kept as budget updates by apply-results, checked as replacements by
// the executor, budget.mjs and policy.mjs, with their own manual steps; the retail-media readers; the
// daemon's decisions step (agency export, then apply-decisions); live-autonomy in the /om sync list.
// Throwaway product folder products/zz-wiring-*; the creative run mocks fetch with a preload, no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { testEnv } from './_env.mjs';
import { pick, connectors } from '../connectors/index.mjs';
import { metricReaders } from '../connectors/readers.mjs';
import { checkSpendCaps, committedDaily, liveCommittedDaily } from '../budget.mjs';
import { earnedTypes } from '../lib/earned.mjs';
import { writeCreativeFollowup } from '../lib/followups.mjs';
import { decisionSteps } from '../daemon.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const slug = `zz-wiring-${process.pid}`;
const dir = path.join(root, 'products', slug);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-wiring-'));
const NOW = '2026-11-04T14:00:00.000Z';
const P = (f = '') => path.join(dir, f);
const write = (f, v) => { fs.mkdirSync(path.dirname(P(f)), { recursive: true }); fs.writeFileSync(P(f), typeof v === 'string' ? v : JSON.stringify(v, null, 2)); };
const read = (f) => JSON.parse(fs.readFileSync(P(f), 'utf8'));
const byId = () => Object.fromEntries(read('approvals.json').map((a) => [a.id, a]));
// No connector keys reach the spawned tools, except the ones a test adds.
const KEY = /^(META_|RESEND_|OM_WEBHOOK|OM_SITE_REPO|STRIPE_|OM_KILL|OM_SCHEDULER_HOLDER|OPENAI_|STABILITY_|RUNWAYML_|LUMAAI_|TWILIO_|GOOGLE_|TIKTOK_|LINKEDIN_|MICROSOFT_|AMAZON_|WALMART_)/;
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !KEY.test(k)));
const node = (script, args = [], { env = {}, pre = [] } = {}) => {
  const r = spawnSync(process.execPath, [...pre, path.join(root, 'tools', script), ...args], { cwd: root, encoding: 'utf8', env: testEnv(baseEnv, { OM_EXECUTE_LOCK_WAIT_MS: '500', ...env }) });
  assert.equal(r.status, 0, `${script}: ${r.stderr || r.stdout}`);
  return JSON.parse(r.stdout.trim().split(/\r?\n/).at(-1));
};
const resultOf = (out, id) => out.items.find((i) => i.id === id)?.result;

function reset(prod = {}) {
  fs.rmSync(dir, { recursive: true, force: true });
  write('product.json', { name: 'Wiring Test', domain: 'wiring.example', stage: 'active', budget: { mode: 'paid', daily_cap: 30, monthly_cap: 900, currency: 'USD' }, autonomy: { level: 'manual' }, creative: { monthly_cap: 5 }, ...prod });
  for (const f of ['tasks.json', 'approvals.json', 'experiments.json', 'transitions.json']) write(f, []);
  fs.mkdirSync(P('runs/applied'), { recursive: true });
}
before(() => reset());
after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(tmp, { recursive: true, force: true }); });

// ---- 1. AI creative ----
test('registry: creative-gen handles type "creative" before the webhook catch-all', () => {
  const names = connectors.map((c) => c.name);
  assert.ok(names.includes('creative-gen'));
  assert.ok(names.indexOf('creative-gen') < names.indexOf('webhook'), 'creative-gen after webhook');
  const hook = { OM_WEBHOOK_DEFAULT: 'https://hooks.example/x' };
  assert.equal(pick({ type: 'creative', file: 'outbox/briefs/a.json' }, { ...hook, OPENAI_API_KEY: 'sk' })?.name, 'creative-gen');
  assert.equal(pick({ type: 'creative' }, {}), null, 'no provider key: waits for a key, never the webhook by default');
});

test('followups: the creative publish draft becomes runs/CREATIVE-<id>.json once', () => {
  const d = path.join(tmp, 'fu');
  const draft = { id: 'CR-hero-1', type: 'publish', title: 'AI image: Hero', file: 'outbox/creative/hero-1/provenance.json', asset: 'outbox/creative/hero-1/image.png', status: 'pending', compliance: 'pending', ai_generated: true, label: 'AI-generated', channel: 'instagram' };
  const f = writeCreativeFollowup({ dir: d, item: { id: 'A9', file: 'outbox/briefs/hero.json' }, creative: { id: 'hero-1', kind: 'image', approval_draft: draft }, now: NOW });
  assert.equal(f.file, 'runs/CREATIVE-hero-1.json');
  const run = JSON.parse(fs.readFileSync(path.join(d, f.file), 'utf8'));
  assert.equal(run.task_id, 'CREATIVE-hero-1');
  assert.equal(run.agent, 'om-genai-image-director');
  assert.deepEqual(run.approvals, [{ id: 'CR-hero-1', type: 'publish', title: 'AI image: Hero', file: draft.file, channel: 'instagram', asset: draft.asset, ai_generated: true, label: 'AI-generated' }]);
  assert.equal(writeCreativeFollowup({ dir: d, item: {}, creative: { id: 'hero-1', approval_draft: draft } }).existed, true);
  assert.equal(writeCreativeFollowup({ dir: d, item: {}, creative: { id: 'x' } }), null);
});

test('executor: an approved creative brief is generated, and its publish approval reaches approvals.json only through apply-results', () => {
  reset({ budget: { mode: 'free' } });
  write('outbox/briefs/hero.json', { id: 'hero', kind: 'image', title: 'Hero image', prompt: 'A clean desk with a laptop, soft light', size: '1024x1024', channel: 'instagram' });
  write('approvals.json', [{ id: 'A9', type: 'creative', title: 'Hero brief', file: 'outbox/briefs/hero.json', status: 'approved', compliance: 'pass', task_id: 'T1' }]);
  const pre = path.join(tmp, 'mock-openai.mjs');
  fs.writeFileSync(pre, `const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
globalThis.fetch = async (url) => {
  if (!String(url).includes('api.openai.com/v1/images/generations')) throw new Error('unexpected url ' + url);
  const body = JSON.stringify({ created: 1730000000, data: [{ b64_json: PNG.toString('base64') }] });
  return { ok: true, status: 200, headers: new Map(), text: async () => body, arrayBuffer: async () => { const b = Buffer.from(body); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } };
};\n`);
  const out = node('execute.mjs', [slug, '--now', NOW], { env: { OPENAI_API_KEY: 'sk-test-secret-123456' }, pre: ['--import', pathToFileURL(pre).href] });
  assert.equal(out.executed, 1, JSON.stringify(out));
  const a9 = byId().A9;
  assert.equal(a9.status, 'executed');
  assert.equal(a9.executed_by, 'creative-gen');
  assert.match(a9.result, /publish approval CR-hero-\S+ queued in runs\/CREATIVE-hero-/);
  assert.equal(Object.keys(byId()).length, 1, 'the executor never adds approvals itself');
  const runFile = fs.readdirSync(P('runs')).find((f) => /^CREATIVE-hero-.+\.json$/.test(f));
  assert.ok(runFile, 'no CREATIVE run file');
  assert.ok(!JSON.stringify(read(`runs/${runFile}`)).includes('sk-test-secret'), 'secret in the run file');
  node('apply-results.mjs', [slug, '--now', NOW]);
  const cr = Object.values(byId()).find((a) => /^CR-hero-/.test(a.id));
  assert.ok(cr, 'publish approval not merged');
  assert.equal(cr.type, 'publish');
  assert.equal(cr.status, 'pending');
  assert.equal(cr.compliance, 'unchecked');
  assert.equal(cr.channel, 'instagram');
  assert.equal(cr.ai_generated, true);
  assert.match(cr.asset, /^outbox\/creative\/hero-.+\/image\.png$/);
  assert.ok(fs.existsSync(P(cr.asset)));
  assert.match(cr.file, /provenance\.json$/);
});

// ---- 2. Voice calls ----
test('executor: calls pass the send guard (suppression, expiry) before any connector', () => {
  reset();
  write('suppression.json', { entries: [{ lead: 'L-1', reason: 'unsubscribe', at: NOW }] });
  write('approvals.json', [
    { id: 'C1', type: 'call', channel: 'voice', lead: 'L-1', title: 'Call L-1', status: 'approved' },
    { id: 'C2', type: 'call', channel: 'voice', to: '+447700900123', title: 'Call by number', status: 'approved', expires_at: '2026-11-01T00:00:00Z' },
    { id: 'C3', type: 'call', channel: 'voice', lead: 'L-2', title: 'Call L-2', status: 'approved' },
  ]);
  const out = node('execute.mjs', [slug, '--now', NOW]);
  assert.equal(resultOf(out, 'C1'), 'skipped (suppressed)');
  assert.equal(resultOf(out, 'C2'), 'skipped (expired)');
  assert.equal(resultOf(out, 'C3'), 'waiting for connector key', 'a clean call still reaches the connector step');
  const ap = byId();
  assert.equal(ap.C1.status, 'skipped-suppressed');
  assert.equal(ap.C2.status, 'expired');
});

test('earned autonomy: calls never earn it, however long the streak', () => {
  const day = (n) => new Date(Date.UTC(2026, 9, 1 + n)).toISOString();
  const series = (type, channel) => Array.from({ length: 12 }, (_, i) => ({ id: `${type}${i}`, type, channel, status: 'approved', decided_by: 'owner', decided_at: day(i) }));
  const e = earnedTypes([...series('call', 'voice'), ...series('post', 'x'), ...series('price', 'site')]);
  assert.equal(e.has('call|voice'), false);
  assert.equal(e.has('price|site'), false);
  assert.equal(e.get('post|x'), 10);
});

// ---- 3. Budget updates ----
const creator = { id: 'A1', type: 'spend', channel: 'meta', campaign: '111', amount: 20, committed_daily: 20, result_ref: '111/9', status: 'executed', executed_at: '2026-11-01T00:00:00Z' };
const update = (id, from, to, extra = {}) => ({ id, type: 'spend', kind: 'budget_update', channel: 'meta', campaign: '111', ref: '111/9', source_approval: 'A1', old_daily: from, new_daily: to, amount: to, currency: 'USD', file: 'reports/reallocation.json', title: `Change 111 ${from} -> ${to}`, ...extra });

test('budget.mjs: an executed budget update replaces its campaign\'s daily amount in the live total', () => {
  const approvals = [creator, update('U1', 20, 24, { status: 'executed', executed_at: '2026-11-02T00:00:00Z', committed_daily: 24 })];
  assert.equal(committedDaily({ approvals }), 44, 'the old sum counted the campaign twice');
  assert.equal(liveCommittedDaily({ approvals }), 24);
  const c = checkSpendCaps({ item: { id: 'N1', type: 'spend', amount: 10 }, budget: { daily_cap: 40, monthly_cap: 2000 }, approvals, now: NOW });
  assert.equal(c.ok, true, c.why);
  assert.equal(c.committed, 24);
  // An approved update in flight counts at the higher of old and new.
  const inflight = [creator, update('U2', 20, 15, { status: 'executing' })];
  assert.equal(liveCommittedDaily({ approvals: inflight }), 20);
});

test('apply-results keeps kind "budget_update" and its fields on the merged approval', () => {
  reset();
  write('runs/REALLOC-2026-11-04.json', { task_id: 'REALLOC-2026-11-04', agent: 'om-budget-allocator', status: 'done', output: ['reports/reallocation.json'],
    approvals: [{ ...update('U1', 20, 24), level: 'adset', budget_id: 'b-1' }] });
  node('apply-results.mjs', [slug, '--now', NOW]);
  const u = byId().U1;
  assert.equal(u.kind, 'budget_update');
  assert.equal(u.type, 'spend');
  for (const [k, v] of Object.entries({ campaign: '111', ref: '111/9', source_approval: 'A1', old_daily: 20, new_daily: 24, amount: 24, level: 'adset', budget_id: 'b-1' })) assert.equal(u[k], v, k);
  assert.equal(u.status, 'pending');
  assert.equal(u.compliance, 'unchecked');
});

test('executor: budget updates are checked as replacements, held over the cap, and get budget-change manual steps', () => {
  reset();
  write('approvals.json', [creator, update('U1', 20, 24, { status: 'approved', manual: true }), update('U2', 20, 24, { campaign: '111', status: 'approved', id: 'U2' })]);
  // U1: 20 -> 24 fits daily_cap 30 (the creator's 20 is replaced, not added). No META keys: manual (manual: true).
  let out = node('execute.mjs', [slug, '--now', NOW]);
  assert.equal(resultOf(out, 'U1'), 'manual', JSON.stringify(out));
  const md = fs.readFileSync(P('outbox/manual/U1.md'), 'utf8');
  assert.match(md, /daily budget from 20 to 24 USD/);
  assert.match(md, /Do not create a new campaign/);
  assert.doesNotMatch(md, /Create the campaign it describes/);
  assert.equal(byId().U1.status, 'approved-manual');
  // U2 now sees U1 (approved-manual, counted at 24) for the same campaign: still a replacement, waits for a key.
  assert.equal(resultOf(out, 'U2'), 'waiting for connector key');
  // Over the cap: daily_cap 22 holds a raise to 24.
  reset({ budget: { mode: 'paid', daily_cap: 22, monthly_cap: 900, currency: 'USD' } });
  write('approvals.json', [creator, update('U3', 20, 24, { status: 'approved' })]);
  out = node('execute.mjs', [slug, '--now', NOW]);
  assert.equal(resultOf(out, 'U3'), 'held');
  assert.equal(byId().U3.status, 'pending');
  assert.match(byId().U3.review_notes, /budget update 20 -> 24\/day/);
  assert.match(byId().U3.review_notes, /over daily_cap 22/);
});

test('policy: a budget update counts only its increase against the automatic limit and is cap-checked as a replacement', () => {
  reset({ autonomy: { level: 'autopilot', auto_spend_per_day: 5 } });
  write('approvals.json', [creator,
    update('U4', 20, 23, { status: 'pending', compliance: 'pass' }),
    update('U5', 20, 28, { status: 'pending', compliance: 'pass', campaign: '222', ref: '222', source_approval: 'A2' }),
    { id: 'S1', type: 'spend', channel: 'meta', amount: 23, status: 'pending', compliance: 'pass', title: 'New campaign' }]);
  const out = node('policy.mjs', [slug, '--now', NOW]);
  const d = Object.fromEntries(out.decisions.map((x) => [x.id, x]));
  assert.equal(d.U4.decision, 'auto', JSON.stringify(d.U4));
  assert.equal(byId().U4.status, 'auto-approved');
  assert.equal(d.U5.decision, 'owner');
  assert.match(d.U5.why, /increase 8 is over the automatic limit 5/);
  assert.equal(d.S1.decision, 'owner', 'a new campaign still counts its full amount');
  assert.match(d.S1.why, /amount 23 is over the automatic limit 5/);
});

// ---- 4. Retail media readers ----
test('readers: the Amazon Ads and Walmart Connect readers are metrics readers', () => {
  const names = metricReaders.map((r) => r.name);
  for (const n of ['amazon-ads-metrics', 'walmart-connect-metrics']) assert.ok(names.includes(n), n);
  assert.equal(new Set(names).size, names.length);
});

// ---- 5. Daemon decisions step ----
test('daemon: agency client decisions are exported before apply-decisions, and nothing runs with nothing queued', () => {
  const base = path.join(tmp, 'daemon-base');
  fs.mkdirSync(path.join(base, 'tools', 'cloud'), { recursive: true });
  fs.writeFileSync(path.join(base, 'tools', 'cloud', 'agency.mjs'), '');
  assert.deepEqual(decisionSteps({ base }), []);
  fs.mkdirSync(path.join(base, 'state'), { recursive: true });
  fs.writeFileSync(path.join(base, 'state', 'inbox-decisions.json'), JSON.stringify({ decisions: [], requests: [] }));
  assert.deepEqual(decisionSteps({ base }), [], 'an empty inbox needs no apply');
  fs.writeFileSync(path.join(base, 'state', 'inbox-decisions.json'), JSON.stringify({ decisions: [{ product: 'p', approval_id: 'A1', decision: 'approve', at: NOW }] }));
  assert.deepEqual(decisionSteps({ base }), [['apply-decisions.mjs', []]]);
  fs.mkdirSync(path.join(base, 'tenants', 't0123456789'), { recursive: true });
  fs.writeFileSync(path.join(base, 'tenants', 't0123456789', 'decisions.json'), JSON.stringify([{ product: 'p', approval_id: 'A2', decision: 'reject', at: NOW, exported_at: NOW }]));
  assert.deepEqual(decisionSteps({ base }), [['apply-decisions.mjs', []]], 'already exported decisions do not trigger an export');
  fs.writeFileSync(path.join(base, 'tenants', 't0123456789', 'decisions.json'), JSON.stringify([{ product: 'p', approval_id: 'A3', decision: 'approve', at: NOW }]));
  fs.rmSync(path.join(base, 'state', 'inbox-decisions.json'));
  assert.deepEqual(decisionSteps({ base }), [['cloud/agency.mjs', ['export-decisions']], ['apply-decisions.mjs', []]]);
  const src = fs.readFileSync(path.join(root, 'tools', 'daemon.mjs'), 'utf8');
  assert.ok(src.indexOf('decisionSteps()') < src.indexOf('for (const slug of activeProducts())'), 'decisions run before the products');
});

// ---- 6. Sync ----
test('/om sync pushes live-autonomy.json', () => {
  const skill = fs.readFileSync(path.join(root, '.claude', 'skills', 'om', 'SKILL.md'), 'utf8');
  const sync = skill.slice(skill.indexOf('### `sync`'), skill.indexOf('### `flow'));
  assert.match(sync, /state\/live-autonomy\.json/);
  assert.match(skill, /`autonomy`: `tools\/autonomy-report\.mjs --all`/);
});
