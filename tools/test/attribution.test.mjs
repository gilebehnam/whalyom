// Multi-touch attribution and MMM-lite: the five touch models split credit as defined, guards keep bad
// rows and bots out, the MMM refuses to answer under 12 weeks, recovers a known synthetic channel mix,
// stays deterministic, and budget changes only ever appear as pending approval proposals.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, modelWeights, attributeTouches, leadTouches, adstock, hill, solve, fitNonNegative, weeklySeries, mmmLite, proposeBudgetShift, buildReport, reportMarkdown, runAttribution, runAll, weekOf } from '../attribution.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-attribution-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const D = (day) => new Date(Date.UTC(2026, 0, 5) + day * 86400000).toISOString();
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const ch = (rep, model, name) => rep.models[model].channels.find((c) => c.channel === name) ?? { leads: 0, sales: 0, revenue: 0 };

// Deterministic pseudo-random numbers (no Math.random in tests).
const lcg = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

// Weekly kpis rows from a known model: revenue = 500 + 4000*hill(adstock(search, .5)) + 1500*hill(adstock(social, 0)).
function synthetic(weeks, { noise = 0.02, extraChannels = [] } = {}) {
  const r = lcg(42);
  const search = Array.from({ length: weeks }, () => 200 + 600 * r());
  const social = Array.from({ length: weeks }, () => 100 + 500 * r());
  const aS = adstock(search, 0.5); const kS = 0.5 * Math.max(...aS);
  const aO = adstock(social, 0); const kO = 0.5 * Math.max(...aO);
  const rows = [];
  for (let t = 0; t < weeks; t++) {
    const date = D(t * 7 + 2).slice(0, 10);
    const y = 500 + 4000 * hill(aS[t], kS, 1) + 1500 * hill(aO[t], kO, 1);
    rows.push({ date, channel: 'search', campaign: 'brand', metric: 'spend', value: round2(search[t]) });
    rows.push({ date, channel: 'social', metric: 'spend', value: round2(social[t]) });
    for (const e of extraChannels) rows.push({ date, channel: e, metric: 'spend', value: round2(50 + 50 * r()) });
    rows.push({ date, channel: 'all', metric: 'revenue', value: round2(y * (1 + noise * (r() - 0.5))) });
  }
  return rows;
}
const round2 = (n) => Math.round(n * 100) / 100;

test('model weights: each sums to one and follows its definition', () => {
  const ages = [21, 14, 7, 0];
  for (const m of MODELS) near(modelWeights(m, ages).reduce((a, b) => a + b, 0), 1);
  assert.deepEqual(modelWeights('first_touch', ages), [1, 0, 0, 0]);
  assert.deepEqual(modelWeights('last_touch', ages), [0, 0, 0, 1]);
  modelWeights('position_based', ages).forEach((w, i) => near(w, [0.4, 0.1, 0.1, 0.4][i]));
  assert.deepEqual(modelWeights('position_based', [3, 0]), [0.5, 0.5]);
  const td = modelWeights('time_decay', [7, 0]);
  near(td[0] * 2, td[1]); // 7-day half-life
  assert.deepEqual(modelWeights('linear', [5]), [1]);
  assert.deepEqual(modelWeights('time_decay', []), []);
  assert.throws(() => modelWeights('u_shape', [1, 2]), /unknown attribution model/);
});

test('touch attribution splits leads, sales and revenue per channel and campaign', () => {
  const pipeline = { leads: [
    { id: 'l1', first_seen: D(0), channel: 'seo', touches: [
      { at: D(0), channel: 'seo', campaign: '' }, { at: D(5), channel: 'email', campaign: 'nurture-1' }, { at: D(10), channel: 'Paid Search', campaign: 'brand' },
      { at: D(10), channel: 'Paid Search', campaign: 'brand' }, // duplicate
      { at: D(20), channel: 'social', campaign: '' }, // after the sale: no credit
    ], history: [{ stage: 'new', at: D(0) }, { stage: 'won', at: D(12), value: 300, verified: true }], value: 300 },
    { id: 'l2', first_seen: D(3), channel: 'social', touches: [{ at: D(3), channel: 'social' }], history: [{ stage: 'new', at: D(3) }] },
    { id: 'bot', first_seen: D(1), channel: 'seo', suspected_bot: true, touches: [{ at: D(1), channel: 'seo' }], history: [{ stage: 'won', at: D(2), value: 999 }], value: 999 },
  ] };
  const rep = attributeTouches(pipeline);
  assert.equal(rep.totals.leads, 2);
  assert.equal(rep.totals.sales, 1);
  assert.equal(rep.totals.revenue, 300);
  assert.equal(rep.totals.verified_revenue, 300);
  assert.equal(rep.totals.suspected_bots, 1);
  assert.equal(rep.totals.avg_touches_per_sale, 3);
  assert.equal(ch(rep, 'first_touch', 'seo').revenue, 300);
  assert.equal(ch(rep, 'last_touch', 'paid-search').revenue, 300);
  for (const c of ['seo', 'email', 'paid-search']) assert.equal(ch(rep, 'linear', c).revenue, 100);
  assert.equal(ch(rep, 'position_based', 'seo').revenue, 120);
  assert.equal(ch(rep, 'position_based', 'email').revenue, 60);
  assert.equal(ch(rep, 'position_based', 'paid-search').revenue, 120);
  assert.ok(ch(rep, 'time_decay', 'paid-search').revenue > ch(rep, 'time_decay', 'email').revenue);
  assert.ok(ch(rep, 'time_decay', 'email').revenue > ch(rep, 'time_decay', 'seo').revenue);
  near(['seo', 'email', 'paid-search'].reduce((s, c) => s + ch(rep, 'time_decay', c).revenue, 0), 300, 0.02);
  // Leads are credited at first_seen: seo and social each get one under every model; the post-sale touch never counts.
  for (const m of MODELS) { assert.equal(ch(rep, m, 'seo').leads, 1); assert.equal(ch(rep, m, 'social').leads, 1); assert.equal(ch(rep, m, 'social').revenue, 0); }
  const camp = rep.models.linear.campaigns.find((c) => c.campaign === 'brand');
  assert.equal(camp.channel, 'paid-search');
  assert.equal(camp.revenue, 100);
  const seo = rep.comparison.find((c) => c.channel === 'seo');
  assert.equal(seo.role, 'opener');
  assert.equal(rep.comparison.find((c) => c.channel === 'paid-search').role, 'closer');
  assert.equal(seo.revenue_spread, 300);
});

test('lookback window and missing touches are handled honestly', () => {
  const pipeline = { leads: [
    { first_seen: D(0), touches: [{ at: D(0), channel: 'seo' }, { at: D(200), channel: 'email' }], history: [{ stage: 'won', at: D(205), value: 50 }], value: 50 },
    { first_seen: D(0), channel: 'Referral', campaign: 'partner', history: [{ stage: 'won', at: D(1), value: 20 }] }, // no touches array, value from history
  ] };
  const rep = attributeTouches(pipeline, { lookbackDays: 30 });
  assert.equal(ch(rep, 'first_touch', 'email').revenue, 50); // seo touch is outside the 30-day window
  assert.equal(ch(rep, 'linear', 'referral').revenue, 20);
  assert.equal(rep.totals.leads_without_touches, 1);
  assert.equal(rep.totals.revenue, 70);
  assert.ok(rep.notes.some((n) => /verified/.test(n)));
  // A lead whose only touch is later than the sale still adds up, with a note.
  const odd = attributeTouches({ leads: [{ first_seen: D(5), touches: [{ at: D(5), channel: 'seo' }], history: [{ stage: 'won', at: D(1), value: 10 }], value: 10 }] });
  assert.equal(odd.totals.conversions_without_touch_in_window, 1);
  assert.equal(ch(odd, 'linear', 'seo').revenue, 10);
});

test('guard paths: empty, malformed and hostile pipeline input', () => {
  for (const bad of [null, undefined, {}, { leads: 'x' }, [], { leads: [null, 7, 'a', { touches: [{ at: 'not a date', channel: 'seo' }] }] }]) {
    const rep = attributeTouches(bad);
    assert.equal(rep.totals.sales, 0);
    assert.equal(rep.totals.revenue, 0);
    for (const m of MODELS) assert.ok(Array.isArray(rep.models[m].channels));
  }
  assert.ok(attributeTouches(null).notes[0].includes('No leads'));
  assert.deepEqual(leadTouches({ touches: [{ at: D(1), channel: '<script>' }] })[0].channel, 'script');
  const neg = attributeTouches({ leads: [{ first_seen: D(0), touches: [{ at: D(0), channel: 'seo' }], history: [{ stage: 'won', at: D(1), value: -40 }], value: -40 }] });
  assert.equal(neg.totals.revenue, 0); // negative values never become revenue
  assert.equal(neg.totals.sales, 1);
});

test('review guards: repeat orders, erased leads, PII in tags, zone-less times, no double-counted outcome', () => {
  // Two orders: each is a sale credited to the touches before it; the lead value is the total.
  const rep = attributeTouches({ leads: [
    { first_seen: D(0), touches: [{ at: D(0), channel: 'seo' }, { at: D(20), channel: 'email', campaign: 'ping +44 20 7946 0958 jo@example.com' }],
      history: [{ stage: 'won', at: D(10), value: 100, verified: true }, { stage: 'won', at: D(30), value: 50 }], value: 150 },
    { first_seen: D(0), consent: 'withdrawn', touches: [{ at: D(0), channel: 'ads' }], history: [{ stage: 'won', at: D(1), value: 999 }], value: 999 },
    { first_seen: D(0), erased: true, touches: [{ at: D(0), channel: 'ads' }] },
  ] });
  assert.equal(rep.totals.sales, 2);
  assert.equal(rep.totals.revenue, 150);
  assert.equal(rep.totals.verified_revenue, 100);
  assert.equal(rep.totals.erased_or_withdrawn, 2);
  assert.equal(ch(rep, 'last_touch', 'seo').revenue, 100);
  assert.equal(ch(rep, 'last_touch', 'email').revenue, 50);
  assert.equal(ch(rep, 'linear', 'ads').leads, 0);
  const txt = JSON.stringify(rep);
  assert.ok(!txt.includes('jo@example.com') && !txt.includes('7946'), 'emails and phones in UTM tags are redacted');
  assert.ok(leadTouches({ touches: [{ at: '2026-01-05 10:00', channel: 'seo', campaign: 'spring-2026-01-05' }] })[0].campaign === 'spring-2026-01-05');
  assert.equal(leadTouches({ touches: [{ at: '2026-01-05 10:00', channel: 'seo' }] })[0].at, Date.UTC(2026, 0, 5, 10));
  assert.equal(leadTouches({ touches: [{ at: '1970-01-01', channel: 'seo' }] }).length, 0);
  // Stripe total plus per-channel revenue in the same week: the total wins, nothing is counted twice.
  const s = weeklySeries([
    { date: '2026-01-05', channel: 'all', metric: 'revenue', value: 100 },
    { date: '2026-01-05', channel: 'google', metric: 'revenue', value: 60 },
    { date: '2026-01-12', channel: 'google', metric: 'revenue', value: 30 },
    { date: '2026-01-12', channel: 'meta', metric: 'revenue', value: 20 },
    { date: '2030-01-01', channel: 'google', metric: 'spend', value: 5 },
  ], { now: '2026-01-20T00:00:00Z' });
  assert.deepEqual(s.outcome, [100, 50]);
  assert.equal(s.skipped, 1); // the row dated years after `now`
  // Sniper budgets never get a shift between channels.
  assert.match(proposeBudgetShift(mmmLite(synthetic(40)), { budget: { mode: 'paid', monthly_cap: 100 } }).reason, /Sniper/);
});

test('MMM building blocks: adstock, hill, solver, non-negative fit, weekly series', () => {
  assert.deepEqual(adstock([10, 0, 0], 0.5), [10, 5, 2.5]);
  near(hill(5, 5, 2), 0.5);
  assert.equal(hill(0, 5, 1), 0);
  assert.equal(hill(3, 0, 1), 0);
  assert.deepEqual(solve([[2, 0], [0, 4]], [2, 8]), [1, 2]);
  assert.equal(solve([[1, 1], [1, 1]], [1, 1]), null);
  const fit = fitNonNegative([[1, 2, 3, 4, 5], [5, 3, 4, 1, 2]], [3, 5, 7, 9, 11]);
  near(fit.intercept, 1, 1e-4); near(fit.betas[0], 2, 1e-4); near(fit.betas[1], 0, 1e-4);
  // A negatively related input is dropped, never given a negative weight.
  const neg = fitNonNegative([[1, 2, 3, 4, 5], [5, 4, 3, 2, 1]], [10, 8, 6, 4, 2]);
  assert.ok(neg.betas.every((b) => b >= 0));
  assert.equal(weekOf('2026-01-07'), '2026-01-05');
  assert.equal(weekOf('nope'), null);
  const s = weeklySeries([
    { date: '2026-01-05', channel: 'search', metric: 'spend', value: 10 },
    { date: '2026-01-07', channel: 'search', metric: 'Spend', value: 5 },
    { date: '2026-01-21', channel: 'all', metric: 'spend', value: 99 }, // no channel: skipped
    { date: '2026-01-21', channel: 'x', metric: 'revenue', value: 30 },
    { date: 'bad', channel: 'x', metric: 'revenue', value: 1 },
    { date: '2026-01-21', channel: 'x', metric: 'revenue', value: -5 },
    { date: '2026-01-21', channel: 'x', metric: 'revenue', value: 'abc' },
  ]);
  assert.deepEqual(s.weeks, ['2026-01-05', '2026-01-12', '2026-01-19']);
  assert.deepEqual(s.spend.search, [15, 0, 0]);
  assert.deepEqual(s.outcome, [0, 0, 30]);
  assert.equal(s.outcome_metric, 'revenue');
  assert.equal(s.skipped, 4);
});

test('MMM-lite says "not enough data" under 12 weeks and when spend or outcome is missing', () => {
  const short = mmmLite(synthetic(8));
  assert.equal(short.status, 'not_enough_data');
  assert.equal(short.weeks, 8);
  assert.equal(short.fit, undefined);
  assert.equal(short.channels, undefined);
  assert.equal(mmmLite([]).status, 'not_enough_data');
  assert.equal(mmmLite(null).status, 'not_enough_data');
  const noOutcome = mmmLite(synthetic(20).filter((r) => r.metric === 'spend'));
  assert.equal(noOutcome.status, 'not_enough_data');
  assert.match(noOutcome.reason, /outcome/);
  const noSpend = mmmLite(synthetic(20).filter((r) => r.metric !== 'spend'));
  assert.equal(noSpend.status, 'not_enough_data');
  assert.match(noSpend.reason, /spend/);
});

test('MMM-lite recovers a known channel mix with an honest fit, deterministically', () => {
  const rows = synthetic(40);
  const m = mmmLite(rows);
  assert.equal(m.status, 'ok');
  assert.equal(m.weeks, 40);
  assert.equal(m.outcome_metric, 'revenue');
  assert.ok(m.fit.r2 > 0.9, `r2 ${m.fit.r2}`);
  assert.ok(m.fit.adj_r2 <= m.fit.r2);
  assert.equal(m.confidence, 'high');
  const search = m.channels.find((c) => c.channel === 'search');
  const social = m.channels.find((c) => c.channel === 'social');
  assert.ok(search.contribution > social.contribution);
  assert.ok(search.roi > 0 && social.roi > 0);
  assert.ok(search.marginal_roi < search.roi, 'saturation: marginal return below average return');
  // Baseline plus channel contributions reproduce the fitted total.
  const sum = m.baseline.total + m.channels.reduce((s, c) => s + c.contribution, 0);
  near(sum, m.total_outcome, m.total_outcome * 0.01);
  assert.deepEqual(mmmLite(rows), m);
  assert.ok(m.notes[0].includes('Correlational'));
});

test('MMM-lite merges small channels into "other" when weeks are few, and flags weak fits', () => {
  const m = mmmLite(synthetic(12, { extraChannels: ['display', 'native'] }));
  assert.equal(m.status, 'ok');
  assert.equal(m.channels_modelled, 3);
  assert.ok(m.channels.some((c) => c.channel === 'other'));
  assert.deepEqual([...m.merged_into_other].sort(), ['display', 'native']);
  // Pure noise outcome: low confidence, and no budget proposal follows.
  const r = lcg(7);
  const noise = [];
  for (let t = 0; t < 20; t++) { const date = D(t * 7).slice(0, 10); noise.push({ date, channel: 'a', metric: 'spend', value: 100 + 100 * r() }, { date, channel: 'b', metric: 'spend', value: 100 + 100 * r() }, { date, metric: 'conversions', value: Math.round(50 * r()) }); }
  const weak = mmmLite(noise);
  assert.equal(weak.status, 'ok');
  assert.equal(weak.outcome_metric, 'conversions');
  assert.ok('cost_per_outcome' in weak.channels[0]);
  if (weak.confidence === 'low') assert.equal(proposeBudgetShift(weak, { budget: { mode: 'paid', monthly_cap: 5000 } }).proposal, null);
  assert.ok(['low', 'medium'].includes(weak.confidence));
});

test('budget shifts are pending approval proposals only, inside the caps', () => {
  const m = mmmLite(synthetic(40));
  assert.match(proposeBudgetShift(m, { budget: { mode: 'free', monthly_cap: 0 } }).reason, /Free mode/);
  assert.match(proposeBudgetShift(m, { budget: { mode: 'paid', monthly_cap: 0 } }).reason, /cap is 0/);
  assert.match(proposeBudgetShift(m, { budget: { mode: 'paid', monthly_cap: 500 } }).reason, /above the cap/);
  assert.match(proposeBudgetShift({ status: 'not_enough_data' }, {}).reason, /no result/);
  assert.match(proposeBudgetShift({ ...m, confidence: 'low' }, { budget: { mode: 'paid', monthly_cap: 99999 } }).reason, /low/);
  const { proposal } = proposeBudgetShift(m, { budget: { mode: 'hybrid', monthly_cap: 20000, currency: 'eur' } }, { slug: 'demo' });
  assert.ok(proposal, 'a clear marginal-ROI gap in paid mode yields a proposal');
  assert.equal(proposal.status, 'pending');
  assert.equal(proposal.requires_approval, true);
  assert.equal(proposal.type, 'budget_shift');
  assert.equal(proposal.currency, 'EUR');
  assert.equal(proposal.channel, 'search'); // higher marginal ROI in the synthetic truth
  assert.equal(proposal.from_channel, 'social');
  assert.ok(proposal.amount > 0 && proposal.amount <= 2000);
  assert.ok(proposal.total_monthly_spend_unchanged <= 20000);
  assert.equal(proposal.id, `A-MMM-demo-${m.last_week}`);
  // Recovered adstock: search carries over (0.5), social does not (0).
  assert.equal(m.channels.find((c) => c.channel === 'search').adstock_decay, 0.5);
  assert.equal(m.channels.find((c) => c.channel === 'social').adstock_decay, 0);
});

test('runAttribution writes the reports and a run file without personal data', () => {
  const dir = path.join(tmp, 'products', 'demo');
  fs.mkdirSync(path.join(dir, 'funnel'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'metrics'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'product.json'), JSON.stringify({ name: 'Demo', budget: { mode: 'paid', monthly_cap: 20000, currency: 'USD' } }));
  fs.writeFileSync(path.join(dir, 'funnel', 'pipeline.json'), JSON.stringify({ leads: [
    { id: 'lead-secret-id', email: 'person@example.com', phone: '+15550100', first_seen: D(0), channel: 'search', touches: [{ at: D(0), channel: 'search', campaign: 'brand' }, { at: D(2), channel: 'email' }], history: [{ stage: 'won', at: D(3), value: 120 }], value: 120 },
  ] }));
  fs.writeFileSync(path.join(dir, 'metrics', 'kpis.json'), JSON.stringify(synthetic(30)));
  const now = '2026-11-04T00:00:00.000Z';
  const rep = runAttribution('demo', { base: tmp, now, taskId: 'ATTR-1' });
  const json = fs.readFileSync(path.join(dir, 'reports', 'attribution.json'), 'utf8');
  const md = fs.readFileSync(path.join(dir, 'reports', 'attribution.md'), 'utf8');
  for (const secret of ['person@example.com', '+15550100', 'lead-secret-id']) { assert.ok(!json.includes(secret)); assert.ok(!md.includes(secret)); }
  assert.equal(JSON.parse(json).updated_at, now);
  assert.match(md, /## MMM-lite/);
  assert.match(md, /pending approval, nothing changed/);
  const run = JSON.parse(fs.readFileSync(path.join(dir, 'runs', 'ATTR-1.json'), 'utf8'));
  assert.equal(run.task_id, 'ATTR-1');
  assert.equal(run.agent, 'om-mmm-lite');
  assert.ok(Array.isArray(run.approvals));
  assert.equal(run.approvals.length, rep.approvals.length);
  assert.deepEqual(runAttribution('demo', { base: tmp, now }), rep); // deterministic for the same inputs
  assert.equal(reportMarkdown(rep), md);
  assert.throws(() => runAttribution('../etc', { base: tmp }), /invalid product slug/);
  assert.throws(() => runAttribution('missing', { base: tmp }), /no product/);
  assert.throws(() => runAttribution('demo', { base: tmp, taskId: '../x' }), /invalid task id/);
  const all = runAll({ base: tmp, now });
  assert.equal(all.products, 1);
  assert.equal(all.mmm_ok, 1);
  const state = fs.readFileSync(path.join(tmp, 'state', 'attribution.json'), 'utf8');
  assert.ok(!state.includes('person@example.com'));
});

test('buildReport handles a product with no data at all', () => {
  const rep = buildReport({ pipeline: null, kpis: null, product: null, slug: 'empty', now: '2026-11-04T00:00:00.000Z' });
  assert.equal(rep.mmm.status, 'not_enough_data');
  assert.deepEqual(rep.approvals, []);
  assert.equal(rep.currency, 'USD');
  assert.match(reportMarkdown(rep), /not enough data/);
});

test('CLI without a slug prints usage and exits 2', () => {
  const r = spawnSync(process.execPath, [path.join(root, 'tools', 'attribution.mjs')], { encoding: 'utf8', cwd: tmp });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Usage/);
});
