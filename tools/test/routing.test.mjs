// Outcome-led routing: ranks agents per task family and channel by results per item and evaluator score,
// blends thin samples with the roster prior, flags stale no-result agents for om-evolve, and stays
// advisory (no ledger is written). File tests use a temp root, so the repo is never touched.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testEnv } from './_env.mjs';
import { buildRouting, recommend, runRouting, scoreAgent, outcomeValue, familyOfTask, familyOfText, rosterPrior, mergeOutcomes, MIN_ITEMS, safeChannel, validAgent } from '../routing.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-routing-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const NOW = '2026-11-04T12:00:00.000Z';
const daysAgo = (d) => new Date(Date.parse(NOW) - d * 86400000).toISOString();

const roster = [
  { name: 'om-landing-builder', pod: 'conversion', tier: 'core', title: 'Landing page builder', does: 'Builds landing pages.' },
  { name: 'om-cro-analyst', pod: 'conversion', tier: 'core', title: 'CRO analyst', does: 'Finds conversion leaks.' },
  { name: 'om-new-lander', pod: 'conversion', tier: 'core', title: 'Landing specialist', does: 'New agent, no work yet.' },
  { name: 'om-seo-writer', pod: 'seo', tier: 'core', title: 'SEO writer', does: 'Writes search pages.' },
  { name: 'om-micro-headline', pod: 'micro', tier: 'micro', title: 'Landing headline variants', does: 'Writes landing page headlines.' },
  { name: 'om-social-poster', pod: 'social', tier: 'core', title: 'Social poster', does: 'Posts.' },
];
const ex = (agent, channel, d, extra = {}) => ({ id: `A-${agent}-${channel}-${d}`, agent, channel, status: 'executed', executed_at: daysAgo(d), ...extra });

test('families: explicit, by words, by pod, else general', () => {
  const byName = Object.fromEntries(roster.map((a) => [a.name, a]));
  assert.equal(familyOfTask({ family: 'email', title: 'anything' }), 'email');
  assert.equal(familyOfTask({ title: 'Draft landing page copy for signup' }, byName), 'conversion');
  assert.equal(familyOfTask({ title: 'Untitled thing', agent: 'om-seo-writer' }, byName), 'seo');
  assert.equal(familyOfTask({ title: 'Untitled thing', agent: 'om-unknown' }, byName), 'general');
  assert.equal(familyOfText('Live SERP feature check for top 20 queries'), 'seo');
});

test('scoring: results per item and evaluator both count, more results score higher', () => {
  assert.equal(outcomeValue({ items: 0 }), null);
  assert.ok(outcomeValue({ items: 10, leads: 5 }) > outcomeValue({ items: 10, leads: 1 }));
  assert.ok(outcomeValue({ items: 10, leads: 2, won: 1 }) > outcomeValue({ items: 10, leads: 2 }));
  const good = scoreAgent({ prior: 0.5, items: 20, leads: 10, won: 3, revenue: 900, scores: [5, 5, 4] });
  const bad = scoreAgent({ prior: 0.5, items: 20, leads: 0, scores: [2, 2, 2] });
  assert.ok(good.score > bad.score);
  assert.equal(good.evidence.sample, 'enough');
  assert.deepEqual(good.evidence.per_item, { leads: 0.5, won: 0.15, revenue: 45 });
});

test('minimum sample: one lucky item is blended with the prior, a proven agent outranks it', () => {
  const lucky = scoreAgent({ prior: 0.5, items: 1, leads: 1, won: 1, revenue: 500 });
  const proven = scoreAgent({ prior: 0.5, items: 30, leads: 15, won: 6, revenue: 3000 });
  assert.equal(lucky.evidence.sample, 'thin');
  assert.ok(proven.score > lucky.score, `${proven.score} > ${lucky.score}`);
  const none = scoreAgent({ prior: 0.5 });
  assert.equal(none.evidence.sample, 'prior');
  assert.equal(none.score, 0.5);
  assert.ok(MIN_ITEMS >= 3);
});

test('prior from the roster: fitting new agents start above unrelated ones, unknown is neutral', () => {
  assert.ok(rosterPrior(roster[2], 'conversion') > rosterPrior(roster[3], 'conversion'));
  assert.ok(rosterPrior(roster[4], 'conversion') > rosterPrior(roster[4], 'seo'));
  assert.equal(rosterPrior(undefined, 'seo'), 0.3);
});

test('buildRouting: ranks by family and channel, new agents ranked by prior, stale agents flagged', () => {
  const outcomes = [
    { agent: 'om-landing-builder', items_out: 12, leads: 8, won: 3, revenue: 1200, no_result_items: 0, channels: ['email', 'site'], avg_score: 4.5 },
    { agent: 'om-cro-analyst', items_out: 10, leads: 0, won: 0, revenue: 0, no_result_items: 10, channels: ['site'], avg_score: 2.5 },
    { agent: 'om-seo-writer', items_out: 3, leads: 0, won: 0, revenue: 0, no_result_items: 0, waiting_items: 3, channels: ['organic'], avg_score: null },
  ];
  const tasks = [
    { agent: 'om-landing-builder', title: 'Landing page for pricing', status: 'done', score: 5 },
    { agent: 'om-landing-builder', title: 'Signup form landing', status: 'done', score: 4 },
    { agent: 'om-cro-analyst', title: 'CRO audit of checkout', status: 'done', score: 2 },
  ];
  const approvals = [
    ...Array.from({ length: 8 }, (_, i) => ex('om-landing-builder', 'site', 20 + i)),
    ...Array.from({ length: 4 }, (_, i) => ex('om-landing-builder', 'email', 20 + i)),
    ...Array.from({ length: 10 }, (_, i) => ex('om-cro-analyst', 'site', 30 + i)),
    ex('om-seo-writer', 'organic', 3), ex('om-seo-writer', 'organic', 2), ex('om-seo-writer', 'organic', 1),
    { agent: 'om-social-poster', channel: 'reddit', status: 'pending' },
  ];
  const before = JSON.stringify({ outcomes, tasks, approvals });
  const r = buildRouting({ outcomes, tasks, approvals, roster, now: NOW });
  assert.equal(JSON.stringify({ outcomes, tasks, approvals }), before, 'inputs are not changed');
  assert.equal(r.advisory, true);

  const conv = r.families.conversion.map((x) => x.agent);
  assert.equal(conv[0], 'om-landing-builder');
  assert.ok(conv.indexOf('om-new-lander') < conv.indexOf('om-cro-analyst'), 'a fresh fitting agent outranks a proven non-performer');
  assert.ok(conv.includes('om-micro-headline'), 'micro agent that fits by title is a candidate');
  const nl = r.families.conversion.find((x) => x.agent === 'om-new-lander');
  assert.equal(nl.evidence.sample, 'prior');

  assert.ok(r.channels.conversion.site.length >= 2);
  assert.equal(r.channels.conversion.site[0].agent, 'om-landing-builder');
  assert.equal(r.channels.conversion.email[0].evidence.prorated, true);
  assert.equal(r.channels.social, undefined, 'pending approvals are not items out');

  const flagged = Object.fromEntries(r.improve_or_retire.map((x) => [x.agent, x]));
  assert.ok(flagged['om-cro-analyst']);
  assert.equal(flagged['om-cro-analyst'].suggestion, 'retire');
  assert.equal(flagged['om-cro-analyst'].for, 'om-evolve');
  assert.ok(flagged['om-cro-analyst'].oldest_item_days >= 14);
  assert.equal(flagged['om-seo-writer'], undefined, 'items under 14 days are still waiting, not flagged');
  assert.equal(flagged['om-landing-builder'], undefined);
});

test('improve vs retire: few stale items with a fair score is "improve"', () => {
  const r = buildRouting({
    outcomes: [{ agent: 'om-social-poster', items_out: 2, leads: 0, won: 0, revenue: 0, no_result_items: 2, avg_score: 4 }],
    approvals: [ex('om-social-poster', 'reddit', 20), ex('om-social-poster', 'reddit', 18)],
    roster, now: NOW,
  });
  assert.equal(r.improve_or_retire[0].suggestion, 'improve');
});

test('recommend: channel first, then family, unknown family by words, never assigns', () => {
  const routing = buildRouting({
    outcomes: [{ agent: 'om-landing-builder', items_out: 10, leads: 6, won: 2, revenue: 400, channels: ['site'] }],
    approvals: Array.from({ length: 10 }, (_, i) => ex('om-landing-builder', 'site', i + 1)),
    roster, now: NOW,
  });
  const a = recommend('conversion', 'site', { routing });
  assert.equal(a.advisory, true);
  assert.equal(a.basis, 'channel');
  assert.equal(a.candidates[0].agent, 'om-landing-builder');
  const b = recommend('conversion', 'tiktok', { routing });
  assert.equal(b.basis, 'family');
  assert.equal(b.candidates[0].agent, 'om-landing-builder');
  const c = recommend('write a landing page for the signup', null, { routing });
  assert.equal(c.family, 'conversion');
  const d = recommend('intl', null, { routing: buildRouting({ roster: [{ name: 'om-localizer', pod: 'intl', tier: 'core', title: 'Localizer' }], now: NOW }) });
  assert.equal(d.basis, 'prior');
  assert.equal(recommend('seo', null, { routing: null, dir: path.join(tmp, 'nothing') }).candidates.length, 0);
});

test('mergeOutcomes sums products and keeps no personal data', () => {
  const m = mergeOutcomes([
    { agent: 'om-a', items_out: 2, leads: 1, channels: ['site'], avg_score: 4, email: 'x@y.z' },
    { agent: 'om-a', items_out: 3, leads: 2, channels: ['email'], avg_score: 2 },
  ]);
  assert.equal(m.length, 1);
  assert.equal(m[0].items_out, 5); assert.equal(m[0].leads, 3); assert.equal(m[0].avg_score, 3);
  assert.deepEqual(m[0].channels, ['site', 'email']);
  assert.equal(m[0].email, undefined);
});

test('runRouting and the CLI write state/agent-routing.json only, ledgers untouched', async () => {
  const p = path.join(tmp, 'products', 'demo');
  fs.mkdirSync(path.join(p, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(p, 'product.json'), JSON.stringify({ name: 'Demo' }));
  const tasks = [{ id: 'T1', agent: 'om-landing-builder', title: 'Landing page', status: 'done', score: 4 }];
  const approvals = [ex('om-landing-builder', 'site', 20, { to: 'person@example.com' })];
  fs.writeFileSync(path.join(p, 'tasks.json'), JSON.stringify(tasks));
  fs.writeFileSync(path.join(p, 'approvals.json'), JSON.stringify(approvals));
  fs.writeFileSync(path.join(p, 'reports', 'agent-outcomes.json'), JSON.stringify({ agents: [{ agent: 'om-landing-builder', items_out: 1, leads: 0, won: 0, revenue: 0, no_result_items: 1, channels: ['site'], avg_score: 4 }] }));
  const ledgers = ['tasks.json', 'approvals.json'].map((f) => fs.readFileSync(path.join(p, f), 'utf8'));

  const res = await runRouting({ dir: tmp, now: NOW, roster });
  assert.ok(res.families >= 1);
  assert.equal(res.improve_or_retire, 1);
  const file = fs.readFileSync(path.join(tmp, 'state', 'agent-routing.json'), 'utf8');
  assert.ok(!file.includes('example.com'), 'no personal data in state');
  assert.deepEqual(['tasks.json', 'approvals.json'].map((f) => fs.readFileSync(path.join(p, f), 'utf8')), ledgers);

  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'routing.mjs');
  const run = spawnSync(process.execPath, [cli, '--dir', tmp, 'conversion', 'site'], { encoding: 'utf8', env: testEnv() });
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout);
  assert.equal(out.advisory, true);
  assert.equal(out.candidates[0].agent, 'om-landing-builder');
});

test('hostile names: __proto__ / constructor never pollute prototypes or crash', () => {
  const r = buildRouting({
    outcomes: [{ agent: '__proto__', items_out: 5, leads: 1 }, { agent: 'constructor', items_out: 3, channels: ['__proto__'] }],
    tasks: [{ agent: '__proto__', title: 'x', score: 4 }, { agent: 'constructor', family: 'toString', title: 'landing', score: 4 }],
    approvals: [ex('constructor', '__proto__', 20), ex('om-landing-builder', 'constructor', 20), { agent: '__proto__', status: 'executed', channel: 'site' }],
    roster: [...roster, { name: '__proto__', pod: 'seo' }], now: NOW,
  });
  assert.equal(({}).tasks, undefined); assert.equal(({}).items, undefined); assert.equal(({}).items_out, undefined);
  assert.equal(Object.prototype.site, undefined);
  assert.ok(!JSON.stringify(r).includes('__proto__'));
  assert.ok(r.channels.conversion.constructor, 'a channel literally called constructor is an own key');
  assert.equal(familyOfTask({ family: 'toString', title: 'nothing' }), 'general');
  for (const f of ['constructor', 'toString', '__proto__']) {
    const a = recommend(f, 'constructor', { routing: JSON.parse(JSON.stringify(r)) });
    assert.ok(Array.isArray(a.candidates));
  }
  assert.equal(recommend('seo', '__proto__', { routing: { families: { seo: 'oops' }, channels: { seo: 5 } } }).candidates.length, 0);
});

test('privacy: emails and phone numbers never become channel labels or agent names in state', () => {
  assert.equal(safeChannel('person@example.com'), null);
  assert.equal(safeChannel('+1 (555) 123-4567'), null);
  assert.equal(safeChannel('Google Ads'), 'google-ads');
  assert.equal(validAgent('jane@doe.com'), false);
  assert.equal(validAgent('Jane Doe'), false);
  assert.equal(validAgent('om-cro-analyst'), true);
  const r = buildRouting({
    outcomes: [{ agent: 'jane@doe.com', items_out: 3 }, { agent: 'om-seo-writer', items_out: 2, channels: ['bob@x.io', '+44 20 7946 0958', 'organic'] }],
    tasks: [{ agent: 'Jane Doe', title: 'seo', score: 3 }],
    approvals: [ex('om-seo-writer', 'site', 20, { utm_source: 'alice@corp.com' }), ex('om-seo-writer', 'site', 21, { utm_source: '5551234567' })],
    roster, now: NOW,
  });
  const s = JSON.stringify(r);
  for (const bad of ['doe', 'jane', 'bob', 'alice', 'corp', '7946', '5551234567']) assert.ok(!s.toLowerCase().includes(bad), bad);
  assert.ok(r.channels.seo.other, 'unsafe utm_source counts under "other"');
});

test('malformed input: negative counts, out-of-range scores, bad files and junk never break the run', async () => {
  const s = scoreAgent({ prior: NaN, items: -5, leads: -3, scores: [99, -1, 'x', 4], fallbackScore: 42 });
  assert.ok(Number.isFinite(s.score) && s.score >= 0 && s.score <= 1);
  assert.equal(s.evidence.items, 0); assert.equal(s.evidence.avg_score, 4);
  assert.equal(outcomeValue(), null);
  assert.equal(mergeOutcomes([{ agent: 'om-a', items_out: -4, avg_score: 50 }])[0].avg_score, null);
  const r = buildRouting({ outcomes: 'nope', tasks: { a: 1 }, approvals: null, roster: 'x', now: 'not a date' });
  assert.equal(r.advisory, true); assert.ok(!Number.isNaN(Date.parse(r.updated_at)));
  assert.equal(familyOfText('platform information'), null, '"form" inside a word is not a conversion hint');

  const dir = path.join(tmp, 'bad');
  const p = path.join(dir, 'products', 'x');
  fs.mkdirSync(path.join(p, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(p, 'product.json'), '{}');
  fs.writeFileSync(path.join(p, 'tasks.json'), '{"not":"an array"}');
  fs.writeFileSync(path.join(p, 'approvals.json'), 'garbage');
  fs.writeFileSync(path.join(p, 'reports', 'agent-outcomes.json'), '{"agents":{"a":1}}');
  const res = await runRouting({ dir, now: NOW, roster });
  assert.ok(res.families >= 1);

  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'routing.mjs');
  const run = spawnSync(process.execPath, [cli, '--dir'], { encoding: 'utf8', env: testEnv() });
  assert.equal(run.status, 2);
});
