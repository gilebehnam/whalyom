// Lead scoring: fit from form fields against the ICP plus behaviour from the funnel ledger give a 0-100
// score with reasons and a tier; hot leads raise one alert each that resolves once they are contacted;
// draft-reply tasks are proposed (never sent); calibration waits for 20 outcomes, then compares scores
// with wins and losses. Files go to a temp root, never the repo.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoringConfig, fitScore, behaviourScore, scoreLead, scoreFunnel, hotAlerts, proposals, calibrate, buildProfiles, parseSize, parseCsv, auc, runLeadScore, writeLeadScoreState } from '../lead-score.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-lead-score-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const NOW = '2026-11-04T12:00:00.000Z';
const PRODUCT = {
  name: 'Test', model: 'b2b-saas', market: ['US', 'UK'], stage: 'active',
  lead_scoring: { icp: { company_size: { min: 10, max: 200 }, roles: ['founder', 'head of marketing'], industries: ['saas'] }, rules: [{ field: 'budget', op: 'gte', value: 1000, points: 10, reason: 'Budget 1000+' }] },
};
const lead = (id, extra = {}) => ({ id, lead_id: id, first_seen: '2026-11-04T08:00:00.000Z', stage: 'new', stage_at: '2026-11-04T08:00:00.000Z', consent: 'opted-in', form: 'demo', history: [{ stage: 'new', at: '2026-11-04T08:00:00.000Z', source: 'site' }], touches: [{ at: '2026-11-04T08:00:00.000Z', channel: 'organic', path: '/pricing' }, { at: '2026-11-04T09:00:00.000Z', channel: 'organic', path: '/demo' }, { at: '2026-11-04T10:00:00.000Z', channel: 'organic', path: '/features' }], ...extra });
const goodRow = (id) => ({ lead_id: id, contact: { email: `${id}@acme.io`, company_size: '11-50', role: 'Founder & CEO', country: 'US', industry: 'SaaS', budget: '2000' } });

test('config: defaults, validation, ICP markets fall back to product.market', () => {
  const d = scoringConfig({});
  assert.deepEqual(d.thresholds, { hot: 70, warm: 40 });
  assert.deepEqual(d.weights, { fit: 0.5, behaviour: 0.5 });
  assert.equal(d.icp.markets, undefined);
  const c = scoringConfig({ market: ['US'], lead_scoring: { thresholds: { hot: 30, warm: 50 }, weights: { fit: -1 }, rules: [{ field: 'x', op: 'regex', points: 5 }, { field: 'y', op: 'eq', value: 'a', points: 999 }] } });
  assert.deepEqual(c.thresholds, { hot: 70, warm: 40 });
  assert.deepEqual(c.icp.markets, ['us']);
  assert.equal(c.rules.length, 1);
  assert.equal(c.rules[0].points, 50, 'points clamped');
  assert.ok(c.warnings.length >= 3);
  assert.deepEqual(scoringConfig({ lead_scoring: { weights: { fit: 3, behaviour: 1 } } }).weights, { fit: 0.75, behaviour: 0.25 });
  assert.doesNotThrow(() => scoringConfig({ lead_scoring: 'nonsense' }));
  assert.doesNotThrow(() => scoringConfig(null ?? undefined));
});

test('sizes parse from ranges and words', () => {
  assert.equal(parseSize('11-50'), 30.5);
  assert.equal(parseSize('200+'), 200);
  assert.equal(parseSize('1,000'), 1000);
  assert.equal(parseSize('2k'), 2000);
  assert.equal(parseSize('n/a'), null);
});

test('profiles: joined by id or email hash, personal fields dropped', () => {
  const p = buildProfiles([{ lead_id: 'a', contact: { email: 'Ann@Acme.io', phone: '+1 555', name: 'Ann', role: 'Founder' } }, { contact: { email: 'ann@acme.io', company_size: 20 } }, null, 'junk', {}]);
  const prof = p.get('a');
  assert.equal(prof.role, 'Founder');
  assert.equal(prof.company_size, '20', 'second row by same email fills in');
  assert.equal(prof.email_domain, 'acme.io');
  for (const k of ['email', 'phone', 'name']) assert.equal(prof[k], undefined);
});

test('fit: ICP match is high, mismatch low, unknown partial, personal email penalised, rules apply', () => {
  const cfg = scoringConfig(PRODUCT);
  const good = fitScore(buildProfiles([goodRow('g')]).get('g'), cfg);
  assert.equal(good.fit, 100);
  assert.ok(good.reasons.some((r) => r.text === 'Budget 1000+'));
  const bad = fitScore({ company_size: '5000', role: 'student', country: 'BR', industry: 'retail', email_domain: 'gmail.com' }, cfg);
  assert.equal(bad.fit, 0);
  assert.ok(bad.reasons.some((r) => /Personal email/.test(r.text)));
  const unknown = fitScore({}, cfg);
  assert.equal(unknown.fit, 40);
  const none = fitScore({ role: 'x' }, scoringConfig({}));
  assert.equal(none.fit, 50);
});

test('behaviour: pages, touches, recency, stage, replies, intent; stale leads score lower', () => {
  const fresh = behaviourScore(lead('a', { stage: 'engaged', history: [{ stage: 'new', at: '2026-11-04T08:00:00Z' }, { stage: 'engaged', at: '2026-11-04T11:00:00Z' }] }), {}, NOW);
  // 3 pages 12 + 3 touches 10 + recency 25 + engaged 14 + 1 reply 5 + intent 5
  assert.equal(fresh.behaviour, 71);
  const stale = behaviourScore(lead('b', { first_seen: '2026-08-01T00:00:00Z', stage_at: '2026-08-01T00:00:00Z', history: [{ stage: 'new', at: '2026-08-01T00:00:00Z' }], touches: [{ at: '2026-08-01T00:00:00Z', path: '/' }], form: '' }), {}, NOW);
  assert.equal(stale.behaviour, 4);
  assert.doesNotThrow(() => behaviourScore({ id: 'x', touches: 'bad', history: [null] }, {}, NOW));
});

test('score: 0-100 with top 3 reasons; bots score 0; lost leads capped and cold', () => {
  const cfg = scoringConfig(PRODUCT);
  const prof = buildProfiles([goodRow('h')]).get('h');
  const s = scoreLead(lead('h'), prof, cfg, NOW);
  assert.ok(s.score >= 70 && s.score <= 100, String(s.score));
  assert.equal(s.tier, 'hot');
  assert.equal(s.reasons.length, 3);
  assert.ok(s.reasons.every((r) => /^[+-]/.test(r)));
  assert.equal(scoreLead(lead('bot', { suspected_bot: true }), prof, cfg, NOW).score, 0);
  const lost = scoreLead(lead('l', { stage: 'lost' }), prof, cfg, NOW);
  assert.ok(lost.score <= 15); assert.equal(lost.tier, 'cold'); assert.equal(lost.status, 'lost');
});

test('scoreFunnel: deterministic, sorted, no personal data, bad rows ignored', () => {
  const pipeline = { leads: [lead('h'), lead('c', { form: '', touches: [], first_seen: '2026-09-01T00:00:00Z', stage_at: '2026-09-01T00:00:00Z', history: [] }), null, { nope: 1 }, lead('h')] };
  const rows = [goodRow('h'), { lead_id: 'c', contact: { email: 'c@gmail.com', role: 'student' } }];
  const a = scoreFunnel(pipeline, { rows, product: PRODUCT, now: NOW });
  const b = scoreFunnel(structuredClone(pipeline), { rows: structuredClone(rows), product: PRODUCT, now: NOW });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.leads.length, 2);
  assert.deepEqual(a.leads.map((r) => r.lead), ['h', 'c']);
  assert.equal(a.totals.open_hot, 1);
  const text = JSON.stringify(a);
  for (const pii of ['@acme.io', 'gmail.com', 'Founder & CEO']) assert.ok(!text.includes(pii), pii);
  assert.throws(() => scoreFunnel(pipeline, { now: 'yesterday' }));
  assert.equal(scoreFunnel(undefined, { now: NOW }).totals.leads, 0);
});

test('hot alerts: one per lead, not reopened, resolved when contacted', () => {
  const rows = [goodRow('h')];
  const s1 = scoreFunnel({ leads: [lead('h')] }, { rows, product: PRODUCT, now: NOW });
  const r1 = hotAlerts([], s1, NOW);
  assert.equal(r1.opened, 1);
  assert.equal(r1.alerts[0].key, 'funnel:hot:h');
  assert.ok(!r1.alerts[0].detail.includes('@'));
  const later = '2026-11-04T13:00:00.000Z';
  const s2 = scoreFunnel({ leads: [lead('h')] }, { rows, product: PRODUCT, previous: s1, now: later });
  assert.equal(s2.leads[0].hot_since, NOW, 'hot_since kept');
  const r2 = hotAlerts(r1.alerts, s2, later);
  assert.equal(r2.opened, 0); assert.equal(r2.alerts.filter((a) => !a.resolved).length, 1);
  // The SDR replied (stage change after it became hot): the alert resolves and stays resolved.
  const contacted = lead('h', { stage: 'contacted', stage_at: '2026-11-04T12:30:00.000Z', history: [...lead('h').history, { stage: 'contacted', at: '2026-11-04T12:30:00.000Z', source: 'om-sdr' }] });
  const s3 = scoreFunnel({ leads: [contacted] }, { rows, product: PRODUCT, previous: s2, now: later });
  const r3 = hotAlerts(r2.alerts, s3, later);
  assert.equal(r3.resolved, 1);
  assert.equal(r3.alerts[0].resolution, 'contacted');
  const r4 = hotAlerts(r3.alerts, scoreFunnel({ leads: [contacted] }, { rows, product: PRODUCT, previous: s3, now: later }), later);
  assert.equal(r4.opened, 0); assert.equal(r4.changed, false);
  // Unrelated alerts are left alone; a lead that vanished resolves its alert.
  const r5 = hotAlerts([{ key: 'funnel:stuck', resolved: false }, { key: 'funnel:hot:gone', resolved: false }], s1, NOW);
  assert.equal(r5.alerts.find((a) => a.key === 'funnel:stuck').resolved, false);
  assert.equal(r5.alerts.find((a) => a.key === 'funnel:hot:gone').resolution, 'lead no longer in the pipeline');
});

test('proposals: draft tasks only, consented leads only, once per hot spell', () => {
  const s = scoreFunnel({ leads: [lead('h'), lead('u', { consent: 'unknown' })] }, { rows: [goodRow('h'), goodRow('u')], product: PRODUCT, now: NOW });
  const p = proposals(s, NOW);
  assert.deepEqual(p.map((x) => x.lead), ['h']);
  assert.equal(p[0].task.agent, 'om-sdr');
  assert.match(p[0].task.brief, /Do not send/);
  s.leads.find((r) => r.lead === 'h').proposed_for = s.leads.find((r) => r.lead === 'h').hot_since;
  assert.equal(proposals(s, NOW).length, 0);
});

test('calibration: waits below 20 outcomes, then reports AUC, tiers, bands without stage leakage', () => {
  const cfg = scoringConfig(PRODUCT);
  const closed = (id, won, good) => {
    const at = '2026-11-03T10:00:00.000Z';
    return lead(id, { stage: won ? 'won' : 'lost', won_at: won ? at : undefined, stage_at: at, form: good ? 'demo' : '', touches: good ? lead(id).touches : [{ at: '2026-11-01T08:00:00.000Z', path: '/' }], first_seen: '2026-11-01T08:00:00.000Z', history: [{ stage: 'new', at: '2026-11-01T08:00:00.000Z' }, { stage: won ? 'won' : 'lost', at }] });
  };
  const few = Array.from({ length: 5 }, (_, i) => closed(`w${i}`, true, true));
  assert.equal(calibrate(few, new Map(), cfg).status, 'waiting');
  const leads = []; const rows = [];
  for (let i = 0; i < 12; i++) { leads.push(closed(`w${i}`, true, true)); rows.push(goodRow(`w${i}`)); }
  for (let i = 0; i < 12; i++) { leads.push(closed(`l${i}`, false, false)); rows.push({ lead_id: `l${i}`, contact: { email: `l${i}@gmail.com`, role: 'student', company_size: '2' } }); }
  const c = calibrate(leads, buildProfiles(rows), cfg);
  assert.equal(c.status, 'ready');
  assert.equal(c.outcomes, 24); assert.equal(c.won, 12);
  assert.equal(c.auc, 1);
  assert.ok(c.mean_score_won > c.mean_score_lost);
  assert.equal(c.bands.length, 5);
  assert.ok(c.findings.length >= 1);
  assert.equal(auc([{ score: 1, won: true }]), null);
  assert.equal(auc([{ score: 5, won: true }, { score: 5, won: false }]), 0.5);
});

test('runLeadScore: writes scores, alerts and a proposal run file inside the product; idempotent', () => {
  const slug = 'zz-ls';
  const dir = path.join(tmp, 'products', slug);
  fs.mkdirSync(path.join(dir, 'funnel'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'product.json'), JSON.stringify(PRODUCT));
  fs.writeFileSync(path.join(dir, 'funnel', 'pipeline.json'), JSON.stringify({ leads: [lead('h'), lead('w', { form: '' })] }));
  fs.writeFileSync(path.join(dir, 'leads.jsonl'), `${JSON.stringify(goodRow('h'))}\nnot json\n`);
  fs.mkdirSync(path.join(dir, 'leads'));
  fs.writeFileSync(path.join(dir, 'leads', 'crm.csv'), 'lead_id,role,company_size\nw,intern,3\n');
  const out = runLeadScore(slug, { root: tmp, now: NOW });
  assert.equal(out.open_hot, 1); assert.equal(out.alerts_opened, 1); assert.equal(out.proposed, 1);
  const scores = JSON.parse(fs.readFileSync(path.join(dir, 'funnel', 'scores.json'), 'utf8'));
  assert.equal(scores.leads[0].proposed_for, NOW);
  assert.ok(!JSON.stringify(scores).includes('acme.io'));
  const run = JSON.parse(fs.readFileSync(path.join(dir, 'runs', 'LEADSCORE-2026-11-04.json'), 'utf8'));
  assert.equal(run.new_tasks.length, 1); assert.deepEqual(run.approvals, []);
  const again = runLeadScore(slug, { root: tmp, now: '2026-11-04T12:10:00.000Z' });
  assert.equal(again.alerts_opened, 0); assert.equal(again.proposed, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'alerts.json'), 'utf8')).length, 1);
  assert.equal(writeLeadScoreState([slug, 'missing'], { root: tmp, now: NOW }), 1);
  const st = JSON.parse(fs.readFileSync(path.join(tmp, 'state', 'lead-scores.json'), 'utf8'));
  assert.ok(!JSON.stringify(st).includes('"lead"'));
  // Paused products: scored and alerted, no tasks proposed. Guards: bad slug, missing product.
  fs.writeFileSync(path.join(dir, 'product.json'), JSON.stringify({ ...PRODUCT, stage: 'paused' }));
  fs.rmSync(path.join(dir, 'runs'), { recursive: true });
  fs.rmSync(path.join(dir, 'funnel', 'scores.json'));
  assert.equal(runLeadScore(slug, { root: tmp, now: NOW, alerts: false }).proposed, 0);
  assert.throws(() => runLeadScore('../etc', { root: tmp }), /invalid slug/);
  assert.throws(() => runLeadScore('nope', { root: tmp }), /no product/);
});

test('guards: protected fields, CSV quotes, malformed files, time zones, alert cap, delta', () => {
  const c = scoringConfig({ lead_scoring: { rules: [{ field: 'Age', op: 'gte', value: 30, points: 10 }, { field: 'gender', op: 'eq', value: 'm', points: 5 }, { field: 'budget', op: 'exists', points: 5 }] } });
  assert.deepEqual(c.rules.map((r) => r.field), ['budget']);
  assert.ok(c.warnings.some((w) => /protected/.test(w)));
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
  // Offsets normalise to UTC; null history entries do not crash.
  const s = scoreFunnel({ leads: [lead('h', { history: [null, 'x', ...lead('h').history] })] }, { rows: [goodRow('h')], product: PRODUCT, now: '2026-11-04T14:00:00+02:00' });
  assert.equal(s.updated_at, NOW);
  assert.equal(s.leads[0].delta, null);
  const s2 = scoreFunnel({ leads: [lead('h')] }, { rows: [goodRow('h')], product: PRODUCT, previous: { leads: [{ lead: 'h', score: 50 }] }, now: NOW });
  assert.equal(s2.leads[0].delta, s2.leads[0].score - 50);
  assert.doesNotThrow(() => calibrate([{ id: 'z', stage: 'won', history: 'bad' }], new Map(), scoringConfig(PRODUCT)));
  // At most 10 new hot alerts per run.
  const many = Array.from({ length: 14 }, (_, i) => `m${i}`);
  const sm = scoreFunnel({ leads: many.map((id) => lead(id)) }, { rows: many.map(goodRow), product: PRODUCT, now: NOW });
  assert.equal(hotAlerts([], sm, NOW).opened, 10);
  // Malformed pipeline.json: throws, writes nothing. Malformed alerts.json: left untouched.
  const slug = 'zz-ls-bad'; const dir = path.join(tmp, 'products', slug);
  fs.mkdirSync(path.join(dir, 'funnel'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'product.json'), JSON.stringify(PRODUCT));
  fs.writeFileSync(path.join(dir, 'funnel', 'pipeline.json'), '{"leads": [');
  fs.writeFileSync(path.join(dir, 'alerts.json'), '[{"key":"funnel:hot:h","resolved":false}');
  assert.throws(() => runLeadScore(slug, { root: tmp, now: NOW }), /not valid/);
  assert.ok(!fs.existsSync(path.join(dir, 'funnel', 'scores.json')));
  fs.writeFileSync(path.join(dir, 'funnel', 'pipeline.json'), JSON.stringify({ leads: [lead('h')] }));
  const out = runLeadScore(slug, { root: tmp, now: NOW, propose: false });
  assert.ok(out.errors.some((e) => /alerts\.json/.test(e)));
  assert.equal(fs.readFileSync(path.join(dir, 'alerts.json'), 'utf8'), '[{"key":"funnel:hot:h","resolved":false}');
});

test('CLI: usage and guard errors exit non-zero without writing', () => {
  const r = spawnSync(process.execPath, [path.join(repo, 'tools', 'lead-score.mjs')], { encoding: 'utf8', cwd: tmp });
  assert.equal(r.status, 2); assert.match(r.stderr, /Usage/);
  const bad = spawnSync(process.execPath, [path.join(repo, 'tools', 'lead-score.mjs'), 'zz-does-not-exist-ls'], { encoding: 'utf8', cwd: tmp });
  assert.equal(bad.status, 1); assert.match(bad.stdout, /no product/);
  const badNow = spawnSync(process.execPath, [path.join(repo, 'tools', 'lead-score.mjs'), 'x', '--now', 'soon'], { encoding: 'utf8', cwd: tmp });
  assert.equal(badNow.status, 2);
});
