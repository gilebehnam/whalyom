// Automatic budget reallocation and the budget-update executors: the bandit split stays inside the caps,
// waits for minimum data, moves each campaign at most 20% a day, proposes budget_update approvals only, and
// every platform executor re-checks the live caps before its (mocked) call. No network.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planReallocation, runReallocate, options, campaignStats, probBest, fitToPool } from '../reallocate.mjs';
import { metaBudget, googleBudget, tiktokBudget, linkedinBudget, microsoftBudget, pauseMicrosoft, pickBudget, liveCommittedDaily, checkBudgetUpdateCaps, minorUnits, platformOf } from '../connectors/budgets.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-realloc-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const NOW = '2026-11-04T12:00:00.000Z';

const days = (n) => [...Array(n).keys()].map((i) => new Date(Date.parse(NOW) - (i + 1) * 86400000).toISOString().slice(0, 10));
function kpisFor(channel, campaign, { spendPerDay, leadsTotal = 0, nDays = 7, extra = [] }) {
  const d = days(nDays);
  return [...d.map((date) => ({ date, channel, campaign, metric: 'spend', value: spendPerDay })), { date: d[0], channel, campaign, metric: 'leads', value: leadsTotal }, ...extra];
}
const creator = (id, channel, ref, amount) => ({ id, type: 'spend', channel, amount, committed_daily: amount, status: 'executed', result_ref: ref, executed_at: '2026-10-20T00:00:00Z' });
const product = (budget = {}) => ({ goals: { north_star: 'leads' }, budget: { mode: 'paid', daily_cap: 100, monthly_cap: 3000, currency: 'USD', ...budget } });

test('options clamp exploration to 10-20% and the daily change to 20%', () => {
  assert.equal(options({ budget: { reallocate: { explore: 0.5, max_change: 0.9 } } }).explore, 0.2);
  assert.equal(options({ budget: { reallocate: { explore: 0.01 } } }).explore, 0.1);
  assert.equal(options({ budget: { reallocate: { max_change: 0.9 } } }).max_change, 0.2);
  assert.equal(options({}).explore, 0.15);
  assert.equal(options({ goals: { cpa_max: 30 } }).min_spend, 60);
});

test('the better campaign gains, the worse loses, each at most 20%, total unchanged', () => {
  const kpis = [...kpisFor('meta', '111', { spendPerDay: 10, leadsTotal: 30 }), ...kpisFor('meta', '222', { spendPerDay: 10, leadsTotal: 2 })];
  const approvals = [creator('A1', 'meta', '111/9001', 20), creator('A2', 'meta', '222/9002', 20)];
  const { plan, proposals, experiments } = planReallocation({ product: product(), kpis, approvals, now: NOW, slug: 'x' });
  assert.equal(proposals.length, 2);
  const up = proposals.find((p) => p.campaign === '111/9001'), down = proposals.find((p) => p.campaign === '222/9002');
  assert.ok(up.new_daily > 20 && up.new_daily <= 24, `up ${up.new_daily}`);
  assert.ok(down.new_daily < 20 && down.new_daily >= 16, `down ${down.new_daily}`);
  assert.ok(up.new_daily + down.new_daily <= 40 + 1e-9);
  for (const p of proposals) {
    assert.equal(p.type, 'spend'); assert.equal(p.kind, 'budget_update'); assert.equal(p.old_daily, 20); assert.equal(p.amount, p.new_daily);
    assert.equal(p.file, 'reports/reallocation.json'); assert.ok(p.ref && p.source_approval);
  }
  assert.equal(plan.objective, 'leads');
  assert.equal(experiments.length, 1);
  assert.ok(plan.channels[0].cpl > 0);
});

test('minimum data: a campaign with too little spend keeps its budget', () => {
  const kpis = [...kpisFor('meta', '111', { spendPerDay: 10, leadsTotal: 30 }), ...kpisFor('meta', '222', { spendPerDay: 1, leadsTotal: 0, nDays: 2 })];
  const approvals = [creator('A1', 'meta', '111/1', 20), creator('A2', 'meta', '222/2', 20)];
  const { plan, proposals } = planReallocation({ product: product(), kpis, approvals, now: NOW });
  assert.ok(proposals.every((p) => p.campaign !== '222/2'));
  assert.match(plan.campaigns.find((c) => c.campaign === '222/2').hold, /learning/);
});

test('caps win: a daily cap below the live total cuts every campaign to fit', () => {
  const kpis = [...kpisFor('google', '5', { spendPerDay: 10, leadsTotal: 10 }), ...kpisFor('google', '6', { spendPerDay: 10, leadsTotal: 10 })];
  const approvals = [creator('A1', 'google', '5', 50), creator('A2', 'google', '6', 50)];
  const { plan, proposals } = planReallocation({ product: product({ daily_cap: 60 }), kpis, approvals, now: NOW });
  const total = proposals.reduce((a, p) => a + p.new_daily, 0);
  assert.ok(total <= 60 + 1e-9, `total ${total}`);
  assert.ok(plan.notes.some((n) => /caps/.test(n)));
});

test('no proposals in free mode, for a waiting change, or from browser-reported conversions', () => {
  const kpis = [...kpisFor('meta', '111', { spendPerDay: 10, leadsTotal: 30 }), ...kpisFor('meta', '222', { spendPerDay: 10, leadsTotal: 2 })];
  const approvals = [creator('A1', 'meta', '111/1', 20), creator('A2', 'meta', '222/2', 20)];
  assert.equal(planReallocation({ product: product({ mode: 'free' }), kpis, approvals, now: NOW }).proposals.length, 0);
  const waiting = [...approvals, { id: 'B1', type: 'spend', kind: 'budget_update', channel: 'meta', campaign: '111/1', status: 'pending', created_at: '2026-11-03T00:00:00Z' }];
  assert.ok(planReallocation({ product: product(), kpis, approvals: waiting, now: NOW }).proposals.every((p) => p.campaign !== '111/1'));
  const stats = campaignStats([{ date: days(1)[0], channel: 'meta', campaign: 'c', metric: 'client_conversions', value: 99 }, { date: days(1)[0], channel: 'meta', campaign: 'c', metric: 'leads', value: 50, source: 'satellite' }], { now: NOW });
  assert.equal(stats[0].leads, 0);
});

test('bandit helpers: P(best) favours the better arm and water-filling respects bounds', () => {
  const p = probBest([{ spend: 100, leads: 50, sales: 0, revenue: 0 }, { spend: 100, leads: 5, sales: 0, revenue: 0 }], { seed: 7 });
  assert.ok(p[0] > 0.95);
  const f = fitToPool([90, 10], [16, 16], [24, 24], 40, [0.9, 0.1]);
  assert.deepEqual(f.values.map((v) => Math.round(v)), [24, 16]);
});

test('runReallocate writes the plan and a run file with the approvals (temp product folder)', () => {
  const base = path.join(tmp, 'repo'); const dir = path.join(base, 'products', 'demo');
  fs.mkdirSync(path.join(dir, 'metrics'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'product.json'), JSON.stringify(product()));
  fs.writeFileSync(path.join(dir, 'metrics', 'kpis.json'), JSON.stringify([...kpisFor('meta', '111', { spendPerDay: 10, leadsTotal: 30 }), ...kpisFor('meta', '222', { spendPerDay: 10, leadsTotal: 2 })]));
  fs.writeFileSync(path.join(dir, 'approvals.json'), JSON.stringify([creator('A1', 'meta', '111/1', 20), creator('A2', 'meta', '222/2', 20)]));
  const r = runReallocate('demo', { base, now: NOW });
  assert.equal(r.proposals, 2);
  const run = JSON.parse(fs.readFileSync(path.join(base, r.run_file), 'utf8'));
  assert.equal(run.approvals.length, 2);
  assert.ok(fs.existsSync(path.join(dir, 'reports', 'reallocation.json')));
});

// ── executors ──
function productDir(name, budget = {}, approvals = []) {
  const dir = path.join(tmp, name); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'product.json'), JSON.stringify(product(budget)));
  fs.writeFileSync(path.join(dir, 'approvals.json'), JSON.stringify(approvals));
  return dir;
}
function mockFetch(responses = []) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); const r = responses[calls.length - 1] ?? { status: 200, body: {} }; return { ok: r.status < 300, status: r.status, text: async () => JSON.stringify(r.body), headers: new Map() }; };
  fn.calls = calls; return fn;
}
const upd = (channel, ref, old_daily, new_daily, extra = {}) => ({ id: `U-${channel}`, type: 'spend', kind: 'budget_update', channel, campaign: ref, ref, old_daily, new_daily, amount: new_daily, source_approval: 'A1', status: 'approved', ...extra });
const META_ENV = { META_ACCESS_TOKEN: 'meta-secret-token-xyz' };

test('Meta: ad set daily_budget in minor units, after the caps check', async () => {
  const dir = productDir('meta-ok', {}, [creator('A1', 'meta', '111/9001', 20)]);
  const f = mockFetch([{ status: 200, body: { success: true } }]);
  const r = await metaBudget.execute(upd('meta', '111/9001', 20, 24), { dir, env: META_ENV, fetch: f, now: NOW });
  assert.equal(r.ok, true, r.detail);
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].url, /graph\.facebook\.com\/v\d+\.\d+\/9001$/);
  assert.equal(new URLSearchParams(f.calls[0].init.body).get('daily_budget'), '2400');
  assert.equal(r.committed_daily, 24);
  assert.equal(minorUnits(500, 'JPY'), 500);
});

test('executors hold without a call: over the daily cap, over 20%, over the approved amount, free mode', async () => {
  const f = mockFetch();
  const dir = productDir('meta-cap', { daily_cap: 30 }, [creator('A1', 'meta', '111/1', 20), creator('A9', 'meta', '999/9', 10)]);
  let r = await metaBudget.execute(upd('meta', '111/1', 20, 24), { dir, env: META_ENV, fetch: f, now: NOW });
  assert.equal(r.ok, false); assert.match(r.detail, /daily_cap/);
  const dir2 = productDir('meta-big', {}, [creator('A1', 'meta', '111/1', 20)]);
  r = await metaBudget.execute(upd('meta', '111/1', 20, 30), { dir: dir2, env: META_ENV, fetch: f, now: NOW });
  assert.equal(r.ok, false); assert.match(r.detail, /20%/);
  r = await metaBudget.execute(upd('meta', '111/1', 20, 22, { amount: 21 }), { dir: dir2, env: META_ENV, fetch: f, now: NOW });
  assert.equal(r.ok, false); assert.match(r.detail, /approved amount/);
  const dir3 = productDir('meta-free', { mode: 'free' }, [creator('A1', 'meta', '111/1', 20)]);
  r = await metaBudget.execute(upd('meta', '111/1', 20, 22), { dir: dir3, env: META_ENV, fetch: f, now: NOW });
  assert.equal(r.ok, false); assert.match(r.detail, /free mode/);
  assert.equal(f.calls.length, 0);
  // A decrease always passes, even when the account is already over the cap.
  r = await metaBudget.execute(upd('meta', '111/1', 20, 16), { dir, env: META_ENV, fetch: mockFetch(), now: NOW });
  assert.equal(r.ok, true, r.detail);
});

test('dry run and missing keys never call the platform', async () => {
  const dir = productDir('meta-dry', {}, [creator('A1', 'meta', '111/1', 20)]);
  const f = mockFetch();
  assert.match((await metaBudget.execute(upd('meta', '111/1', 20, 22), { dir, env: META_ENV, fetch: f, now: NOW, dryRun: true })).detail, /would set meta/);
  const miss = await metaBudget.execute(upd('meta', '111/1', 20, 22), { dir, env: {}, fetch: f, now: NOW });
  assert.equal(miss.ok, false); assert.match(miss.detail, /missing META_ACCESS_TOKEN/);
  assert.equal(f.calls.length, 0);
  assert.equal(pickBudget(upd('meta', '111/1', 20, 22), {}), null, 'no fallback to the campaign-creating connector');
  assert.equal(pickBudget({ type: 'spend', channel: 'meta' }, META_ENV), null);
  assert.equal(pickBudget(upd('meta', '111/1', 20, 22), META_ENV), metaBudget);
});

test('Google: looks up the campaign budget, then campaignBudgets:mutate amountMicros; shared budgets refused', async () => {
  const env = { GOOGLE_ADS_DEVELOPER_TOKEN: 'dev-token-123456', GOOGLE_ADS_CUSTOMER_ID: '123-456-7890', GOOGLE_ACCESS_TOKEN: 'ya29.access-token' };
  const dir = productDir('google', {}, [creator('A1', 'google', '555', 20)]);
  const f = mockFetch([{ status: 200, body: { results: [{ campaign: { campaignBudget: 'customers/1234567890/campaignBudgets/77' }, campaignBudget: { explicitlyShared: false } }] } }, { status: 200, body: { results: [{}] } }]);
  const r = await googleBudget.execute(upd('google', '555', 20, 23.5), { dir, env, fetch: f, now: NOW });
  assert.equal(r.ok, true, r.detail);
  assert.match(f.calls[0].url, /customers\/1234567890\/googleAds:search$/);
  assert.match(f.calls[1].url, /customers\/1234567890\/campaignBudgets:mutate$/);
  const body = JSON.parse(f.calls[1].init.body);
  assert.deepEqual(body.operations[0], { update: { resourceName: 'customers/1234567890/campaignBudgets/77', amountMicros: '23500000' }, updateMask: 'amountMicros' });
  const shared = mockFetch([{ status: 200, body: { results: [{ campaign: { campaignBudget: 'x' }, campaignBudget: { explicitlyShared: true } }] } }]);
  const s = await googleBudget.execute(upd('google', '555', 20, 22), { dir, env, fetch: shared, now: NOW });
  assert.equal(s.ok, false); assert.match(s.detail, /shared budget/); assert.equal(shared.calls.length, 1);
});

test('TikTok, LinkedIn and Microsoft request shapes', async () => {
  const tk = { TIKTOK_ACCESS_TOKEN: 'tiktok-token-abc', TIKTOK_ADVERTISER_ID: '42' };
  let dir = productDir('tiktok', {}, [creator('A1', 'tiktok', '700', 20)]);
  let f = mockFetch([{ status: 200, body: { code: 0, data: {} } }]);
  assert.equal((await tiktokBudget.execute(upd('tiktok', '700', 20, 22), { dir, env: tk, fetch: f, now: NOW })).ok, true);
  assert.match(f.calls[0].url, /open_api\/v1\.3\/campaign\/update\/$/);
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { advertiser_id: '42', campaign_id: '700', budget: 22 });
  f = mockFetch([{ status: 200, body: { code: 40002, message: 'bad budget' } }]);
  assert.equal((await tiktokBudget.execute(upd('tiktok', '700', 20, 22), { dir, env: tk, fetch: f, now: NOW })).ok, false);

  const li = { LINKEDIN_ACCESS_TOKEN: 'linkedin-token-abc', LINKEDIN_AD_ACCOUNT_ID: '5001' };
  dir = productDir('linkedin', {}, [creator('A1', 'linkedin', '9100', 20)]);
  f = mockFetch([{ status: 204, body: '' }]);
  assert.equal((await linkedinBudget.execute(upd('linkedin', 'urn:li:sponsoredCampaign:9100', 20, 22), { dir, env: li, fetch: f, now: NOW })).ok, true);
  assert.match(f.calls[0].url, /rest\/adAccounts\/5001\/adCampaigns\/9100$/);
  assert.equal(f.calls[0].init.headers['x-restli-method'], 'PARTIAL_UPDATE');
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { patch: { $set: { dailyBudget: { amount: '22.00', currencyCode: 'USD' } } } });

  const ms = { MSADS_DEVELOPER_TOKEN: 'dev-tok-123', MSADS_ACCESS_TOKEN: 'ms-access-token', MSADS_CUSTOMER_ID: '11', MSADS_ACCOUNT_ID: '22' };
  dir = productDir('microsoft', {}, [creator('A1', 'microsoft', '333', 20)]);
  f = mockFetch([{ status: 200, body: { PartialErrors: [] } }]);
  assert.equal((await microsoftBudget.execute(upd('microsoft', '333', 20, 22), { dir, env: ms, fetch: f, now: NOW })).ok, true);
  assert.equal(f.calls[0].init.method, 'PUT');
  assert.match(f.calls[0].url, /CampaignManagement\/v13\/Campaigns$/);
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { AccountId: '22', Campaigns: [{ Id: '333', DailyBudget: 22 }] });
  f = mockFetch([{ status: 200, body: {} }]);
  assert.equal((await microsoftBudget.execute(upd('microsoft', '333', 20, 22, { budget_id: '88' }), { dir, env: ms, fetch: f, now: NOW })).ok, true);
  assert.match(f.calls[0].url, /\/Budgets$/);

  f = mockFetch([{ status: 200, body: { PartialErrors: [] } }]);
  const p = await pauseMicrosoft('333', ms, false, { fetch: f });
  assert.equal(p.ok, true);
  assert.deepEqual(JSON.parse(f.calls[0].init.body).Campaigns[0], { Id: '333', Status: 'Paused' });
  assert.equal((await pauseMicrosoft('333', ms, true, { fetch: f })).detail, 'would pause Microsoft Ads campaign 333');
  const bad = await pauseMicrosoft('333', ms, false, { fetch: mockFetch([{ status: 401, body: { error: 'token ms-access-token rejected' } }]) });
  assert.equal(bad.ok, false); assert.ok(!bad.detail.includes('ms-access-token'), 'secret redacted');
});

test('an executed budget_update replaces the campaign daily amount in the live total', () => {
  const approvals = [creator('A1', 'meta', '111/1', 20), creator('A2', 'meta', '222/2', 30), { id: 'U1', type: 'spend', kind: 'budget_update', channel: 'meta', campaign: '111/1', ref: '111/1', source_approval: 'A1', new_daily: 24, status: 'executed', executed_at: '2026-11-01T00:00:00Z' }];
  assert.equal(liveCommittedDaily({ approvals }), 54);
  const c = checkBudgetUpdateCaps({ item: upd('meta', '111/1', 24, 28), budget: product({ daily_cap: 57 }).budget, approvals, now: NOW });
  assert.equal(c.others, 30); assert.equal(c.ok, false);
  assert.equal(platformOf('bing'), 'microsoft');
});

test('stale or unpinned budget updates are held; other ad sets and in-flight updates still count', async () => {
  const f = mockFetch();
  const approvals = [creator('A1', 'meta', '111/1', 20), creator('A2', 'meta', '111/2', 15),
    { id: 'U0', type: 'spend', kind: 'budget_update', channel: 'meta', campaign: '111/1', ref: '111/1', source_approval: 'A1', old_daily: 20, new_daily: 16, status: 'executed', executed_at: '2026-11-03T00:00:00Z' }];
  const dir = productDir('meta-stale', { daily_cap: 40 }, approvals);
  // Approved as 24 -> 22, but the live budget is 16 now: 22 is a 37% increase, not a decrease.
  let r = await metaBudget.execute(upd('meta', '111/1', 24, 22), { dir, env: META_ENV, fetch: f, now: NOW });
  assert.equal(r.ok, false); assert.match(r.detail, /20%/);
  // The approved amount must be on the approval, never taken from the plan file.
  r = await metaBudget.execute(upd('meta', '111/1', 20, 18, { amount: undefined }), { dir, env: META_ENV, fetch: f, now: NOW });
  assert.equal(r.ok, false); assert.match(r.detail, /approved amount/);
  assert.equal(f.calls.length, 0);
  // The other ad set of the same Meta campaign still counts: 16 + 15.
  assert.equal(liveCommittedDaily({ approvals }), 31);
  // An update in flight counts at the higher of old and new.
  assert.equal(liveCommittedDaily({ approvals: [...approvals, { id: 'U9', type: 'spend', kind: 'budget_update', channel: 'meta', campaign: '111/2', ref: '111/2', source_approval: 'A2', old_daily: 15, new_daily: 12, status: 'executing' }] }), 31);
  // Malformed kpis and funnel never poison the stats.
  const st = campaignStats([{ date: days(1)[0], channel: 'meta', campaign: 'c', metric: 'leads', value: 'abc' }, { date: days(1)[0], channel: 'meta', campaign: 'c', metric: 'spend', value: -5 }], { now: NOW, funnel: { campaigns: 'oops' } });
  assert.equal(st[0].leads, 0); assert.equal(st[0].spend, 0);
});
