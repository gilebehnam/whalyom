// Creator and influencer management: roster upserts, gated status moves, briefs limited to verified
// claims, contract terms (usage rights, whitelisting, disclosure), deliverables, outreach and payouts as
// pending approvals only, budget caps, per-creator results from funnel codes, and no contact details in
// reports or shared state. Runs in a temp folder; no network.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mergeCreators, creatorsReport, creatorResults, validateContract, fitScore, verifiedClaims,
  canonicalStatus, canonicalPlatform, creatorId, committedPayouts, renderMarkdown, runCreators, writeCreatorsState,
} from '../creators.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-creators-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const now = '2026-11-04T12:00:00.000Z';
const budget = { mode: 'paid', monthly_cap: 1000, daily_cap: 600, spent_this_month: 100, currency: 'USD' };
const claims = new Set(['C1', 'C2']);
const goodContract = {
  fee: 500, currency: 'USD', signed_at: '2026-11-03T10:00:00Z',
  usage_rights: { scope: 'both', duration_days: 90, channels: ['instagram', 'meta-ads'] },
  whitelisting: { allowed: true, duration_days: 30, spend_cap: 300 },
  disclosure: { wording: '#ad Paid partnership with Quoteflow', placement: 'first line' },
};
const jane = { op: 'upsert', creator: { handle: '@JaneDoe', platform: 'IG', name: 'Jane', followers: 12000, fit: { audience_match: 0.9, niche_match: 0.8, engagement_rate: 0.045, brand_safety: 1 }, rate: 400, codes: ['JANE10', 'ig-jane'], contact: { email: 'jane@example.com', phone: '+1 555 0100 222' } } };
const merge = (roster, updates, extra = {}) => mergeCreators(roster, updates, { now, claims, budget, approvals: [], ...extra });

test('names: statuses, platforms and ids normalise', () => {
  assert.equal(canonicalStatus('Reached out'), 'contacted');
  assert.equal(canonicalStatus('posted'), 'content_live');
  assert.equal(canonicalStatus('nope?'), null);
  assert.equal(canonicalPlatform('Twitter'), 'x');
  assert.equal(canonicalPlatform('mastodon'), 'other');
  assert.equal(creatorId('ig', 'https://instagram.com/@JaneDoe/'), 'cr-instagram-janedoe');
  assert.equal(creatorId('', 'jane'), null);
});

test('fit score: given value wins, parts are weighted, nothing known is null', () => {
  assert.equal(fitScore({ audience_fit: 140 }), 100);
  assert.equal(fitScore({ fit: { audience_match: 1, niche_match: 1, engagement_rate: 0.06, brand_safety: 1 } }), 100);
  assert.equal(fitScore({ fit: { audience_match: 0.5 } }), 50);
  assert.equal(fitScore({}), null);
});

test('claims.md: only verified ids count', () => {
  const md = '| id | claim | status | source |\n|---|---|---|---|\n| C1 | a | verified | x |\n| C2 | b | needs-proof | y |\n';
  assert.deepEqual([...verifiedClaims(md)], ['C1']);
});

test('upsert: one row per creator, deterministic, re-upsert merges codes', () => {
  const a = merge({}, [jane, { op: 'upsert', creator: { handle: 'janedoe', platform: 'instagram', codes: ['JANE10', 'extra'] } }]);
  assert.equal(a.roster.creators.length, 1);
  const c = a.roster.creators[0];
  assert.equal(c.id, 'cr-instagram-janedoe');
  assert.equal(c.status, 'prospect');
  assert.deepEqual(c.codes, ['extra', 'ig-jane', 'jane10']);
  assert.equal(c.fit_score, 86); // 36 + 20 + 15 + 15
  assert.equal(a.stats.new_creators, 1);
  const b = merge({}, [jane, { op: 'upsert', creator: { handle: 'janedoe', platform: 'instagram', codes: ['JANE10', 'extra'] } }]);
  assert.deepEqual(b.roster, a.roster, 'same input, same output');
  const bad = merge({}, [{ op: 'upsert', creator: { handle: '' , platform: 'ig' } }, null, { op: 'status', creator: 'nobody@ig', status: 'contacted' }, { op: 'fly' }]);
  assert.equal(bad.stats.rejected, 4);
});

test('status gates: first contact needs approval, inbound or owner; never do_not_contact; forward only', () => {
  let r = merge({}, [jane]).roster;
  let m = merge(r, [{ op: 'status', creator: 'janedoe@instagram', status: 'contacted' }]);
  assert.match(m.rejected[0].reason, /approved outreach/);
  m = merge(r, [{ op: 'status', creator: 'janedoe@instagram', status: 'contacted', approval_id: 'CRO-x' }], { approvals: [{ id: 'CRO-x', status: 'pending' }] });
  assert.equal(m.stats.rejected, 1, 'pending approval is not enough');
  m = merge(r, [{ op: 'status', creator: 'janedoe@instagram', status: 'negotiating', source: 'inbound' }]);
  assert.equal(m.roster.creators[0].status, 'negotiating');
  const back = merge(m.roster, [{ op: 'status', creator: 'cr-instagram-janedoe', status: 'contacted', source: 'owner' }]);
  assert.match(back.rejected[0].reason, /only move forward/);
  const dnc = merge({}, [{ ...jane, creator: { ...jane.creator, do_not_contact: true } }, { op: 'status', creator: 'janedoe@instagram', status: 'contacted', source: 'owner' }]);
  assert.match(dnc.rejected[0].reason, /do_not_contact/);
  const side = merge(m.roster, [{ op: 'status', creator: 'janedoe@instagram', status: 'declined' }, { op: 'status', creator: 'janedoe@instagram', status: 'contracted' }]);
  assert.equal(side.roster.creators[0].status, 'declined');
  assert.match(side.rejected[0].reason, /back to prospect or contacted/);
});

test('contracts: usage rights, whitelisting terms and a clear ad label are required', () => {
  assert.equal(validateContract(goodContract, budget).ok, true);
  assert.match(validateContract({ ...goodContract, disclosure: { wording: '#sp #collab' } }).problems.join(), /not a clear ad label/);
  assert.match(validateContract({ ...goodContract, usage_rights: { scope: 'all' } }).problems.join(), /scope/);
  assert.match(validateContract({ ...goodContract, whitelisting: { allowed: true } }).problems.join(), /duration_days.*spend_cap|spend_cap/);
  assert.match(validateContract({ ...goodContract, usage_rights: { scope: 'paid', duration_days: 'perpetual' } }).warnings.join(), /perpetual/);
  assert.match(validateContract({ ...goodContract, whitelisting: { allowed: true, duration_days: 30, spend_cap: 5000 } }, budget).warnings.join(), /over monthly_cap/);
  assert.equal(validateContract(null).ok, false);

  let r = merge({}, [jane, { op: 'status', creator: 'janedoe@instagram', status: 'negotiating', source: 'inbound' }]).roster;
  let m = merge(r, [{ op: 'status', creator: 'janedoe@instagram', status: 'contracted' }]);
  assert.match(m.rejected[0].reason, /no contract/);
  m = merge(r, [{ op: 'contract', creator: 'janedoe@instagram', contract: { ...goodContract, disclosure: { wording: 'thanks!' } } }]);
  assert.match(m.rejected[0].reason, /contract refused/);
  m = merge(r, [{ op: 'contract', creator: 'janedoe@instagram', contract: { ...goodContract, signed_at: null } }, { op: 'status', creator: 'janedoe@instagram', status: 'contracted' }]);
  assert.match(m.rejected[0].reason, /not signed/);
  m = merge(r, [{ op: 'contract', creator: 'janedoe@instagram', contract: goodContract }, { op: 'status', creator: 'janedoe@instagram', status: 'contracted' }]);
  assert.equal(m.roster.creators[0].status, 'contracted');
  assert.equal(m.roster.creators[0].contract.whitelisting.spend_cap, 300);
});

test('briefs use only verified claims', () => {
  const r = merge({}, [jane]).roster;
  const bad = merge(r, [{ op: 'brief', creator: 'janedoe@instagram', brief: { title: 'Launch', goal: 'Trials', claims: ['C1', 'C9'] } }]);
  assert.match(bad.rejected[0].reason, /C9/);
  const ok = merge(r, [{ op: 'brief', creator: 'janedoe@instagram', brief: { title: 'Launch', goal: 'Trials', claims: ['c1'], key_messages: ['One link proposals'], due: '2026-11-10' } }]);
  assert.equal(ok.roster.creators[0].briefs[0].claims[0], 'C1');
  assert.match(ok.roster.creators[0].briefs[0].id, /^BR-/);
  assert.match(merge(r, [{ op: 'brief', creator: 'janedoe@instagram', brief: { title: 'x' } }]).rejected[0].reason, /goal/);
});

test('outreach becomes a pending send approval, capped, never for do_not_contact or without a contact', () => {
  const r = merge({}, [jane, { op: 'upsert', creator: { handle: 'nocontact', platform: 'tiktok' } }]).roster;
  const m = merge(r, [
    { op: 'outreach', creator: 'janedoe@instagram', file: 'outbox/creators/jane-1.md' },
    { op: 'outreach', creator: 'janedoe@instagram', file: 'outbox/creators/jane-2.md' },
    { op: 'outreach', creator: 'nocontact@tiktok', file: 'outbox/creators/x.md' },
    { op: 'outreach', creator: 'janedoe@instagram', file: '../../etc/passwd' },
  ]);
  assert.equal(m.approvals.length, 1);
  const a = m.approvals[0];
  assert.equal(a.type, 'send'); assert.equal(a.channel, 'creator-outreach'); assert.match(a.id, /^CRO-/);
  assert.ok(!JSON.stringify(a).includes('jane@example.com'), 'no email in the approval');
  assert.deepEqual(m.rejected.map((x) => x.reason.slice(0, 20)), ['an outreach message ', 'no business contact ', 'outreach needs the d']);
  // Approval decided later: the roster follows it and the creator can then be marked contacted.
  const m2 = merge(m.roster, [{ op: 'status', creator: 'janedoe@instagram', status: 'contacted' }], { approvals: [{ id: a.id, status: 'executed' }] });
  assert.equal(m2.roster.creators.find((c) => c.handle === 'janedoe').status, 'contacted');
  assert.equal(m2.roster.creators.find((c) => c.handle === 'janedoe').outreach[0].status, 'approved');
  // Bulk guard: at most 10 outreach proposals per run.
  const many = Array.from({ length: 12 }, (_, i) => ({ op: 'upsert', creator: { handle: `c${i}`, platform: 'x', contact: { dm: true } } }));
  const bulk = merge({}, [...many, ...many.map((u) => ({ op: 'outreach', creator: `${u.creator.handle}@x`, file: `outbox/creators/${u.creator.handle}.md` }))]);
  assert.equal(bulk.approvals.length, 10);
  assert.equal(bulk.rejected.filter((x) => /bulk/.test(x.reason)).length, 2);
});

const contracted = () => merge({}, [jane, { op: 'status', creator: 'janedoe@instagram', status: 'negotiating', source: 'inbound' }, { op: 'contract', creator: 'janedoe@instagram', contract: goodContract }, { op: 'status', creator: 'janedoe@instagram', status: 'contracted' }]).roster;

test('deliverables: live needs a URL and a signed contract; unconfirmed disclosure raises an alert', () => {
  const pre = merge({}, [jane, { op: 'deliverable', creator: 'janedoe@instagram', deliverable: { type: 'reel', status: 'live', url: 'https://x.test/1' } }]);
  assert.match(pre.rejected[0].reason, /signed contract/);
  const r = contracted();
  assert.match(merge(r, [{ op: 'deliverable', creator: 'janedoe@instagram', deliverable: { type: 'reel', status: 'live' } }]).rejected[0].reason, /URL/);
  assert.match(merge(r, [{ op: 'status', creator: 'janedoe@instagram', status: 'content_live' }]).rejected[0].reason, /no live deliverable/);
  const m = merge(r, [{ op: 'deliverable', creator: 'janedoe@instagram', deliverable: { id: 'D1', type: 'reel', due: '2026-11-08', status: 'live', url: 'https://instagram.com/p/abc' } }, { op: 'status', creator: 'janedoe@instagram', status: 'content_live' }]);
  assert.equal(m.roster.creators[0].status, 'content_live');
  assert.equal(m.alerts.filter((x) => /Disclosure not confirmed/.test(x.title)).length, 1);
  const ok = merge(m.roster, [{ op: 'deliverable', creator: 'janedoe@instagram', deliverable: { id: 'D1', type: 'reel', status: 'live', url: 'https://instagram.com/p/abc', disclosure_confirmed: true } }]);
  assert.equal(ok.alerts.length, 0);
  assert.equal(ok.roster.creators[0].deliverables.length, 1);
});

test('payouts: approvals only, within fee and caps, paid only after approval', () => {
  let r = merge(contracted(), [{ op: 'deliverable', creator: 'janedoe@instagram', deliverable: { id: 'D1', type: 'reel', status: 'live', url: 'https://instagram.com/p/abc', disclosure_confirmed: true } }, { op: 'status', creator: 'janedoe@instagram', status: 'content_live' }]).roster;
  assert.match(merge(r, [{ op: 'payout', creator: 'janedoe@instagram', payout: { amount: 600 } }]).rejected[0].reason, /over the contract fee/);
  assert.match(merge(r, [{ op: 'payout', creator: 'janedoe@instagram', payout: { amount: 100, currency: 'EUR' } }]).rejected[0].reason, /currency/);
  assert.match(merge(r, [{ op: 'payout', creator: 'janedoe@instagram', payout: { amount: 0 } }]).rejected[0].reason, /more than 0/);
  // Monthly cap: 100 spent + 950 > 1000. Fee raised so the cap is what stops it.
  const big = merge(r, [{ op: 'contract', creator: 'janedoe@instagram', contract: { ...goodContract, fee: 2000 } }, { op: 'payout', creator: 'janedoe@instagram', payout: { amount: 950 } }]);
  assert.match(big.rejected[0].reason, /over monthly_cap/);
  assert.equal(big.approvals.length, 0);
  assert.equal(big.alerts.filter((a) => a.level === 'decision').length, 1);
  // Free mode, zero caps: nothing can be proposed.
  const free = mergeCreators(r, [{ op: 'payout', creator: 'janedoe@instagram', payout: { amount: 50 } }], { now, claims, budget: { monthly_cap: 0, daily_cap: 0, currency: 'USD' } });
  assert.match(free.rejected[0].reason, /over budget/);

  const m = merge(r, [{ op: 'payout', creator: 'janedoe@instagram', payout: { id: 'P1', amount: 500, for: ['D1'] } }]);
  assert.equal(m.approvals.length, 1);
  const a = m.approvals[0];
  assert.deepEqual([a.type, a.channel, a.amount, a.currency], ['payout', 'creator-payout', 500, 'USD']);
  assert.equal(m.roster.creators[0].payouts[0].status, 'proposed');
  assert.deepEqual(committedPayouts(m.roster.creators, now), { month: 500, day: 500 });
  r = m.roster;
  assert.match(merge(r, [{ op: 'payout_paid', creator: 'janedoe@instagram', payout_id: 'P1' }]).rejected[0].reason, /not approved/);
  assert.match(merge(r, [{ op: 'status', creator: 'janedoe@instagram', status: 'paid' }]).rejected[0].reason, /no payout recorded as paid/);
  const rej = merge(r, [], { approvals: [{ id: a.id, status: 'rejected' }] });
  assert.equal(rej.roster.creators[0].payouts[0].status, 'rejected');
  const paid = merge(r, [{ op: 'payout_paid', creator: 'janedoe@instagram', payout_id: 'P1', ref: 'manual-001' }, { op: 'status', creator: 'janedoe@instagram', status: 'paid' }], { approvals: [{ id: a.id, status: 'approved-manual' }] });
  assert.equal(paid.roster.creators[0].payouts[0].status, 'paid');
  assert.equal(paid.roster.creators[0].status, 'paid');
});

test('results: codes join the funnel pipeline (first touch = lead, later = assisted), report fallback, conflicts', () => {
  const r = merge({}, [jane, { op: 'upsert', creator: { handle: 'bob', platform: 'youtube', codes: ['jane10', 'bobyt'] } }]).roster;
  r.creators.find((c) => c.handle === 'janedoe').payouts = [{ id: 'P1', amount: 200, status: 'paid', paid_at: now }];
  const pipeline = { leads: [
    { id: 'L1', campaign: 'JANE10', touches: [{ campaign: 'JANE10' }], history: [{ stage: 'new' }, { stage: 'won' }], value: 300 },
    { id: 'L2', campaign: 'ig-jane', touches: [{ campaign: 'ig-jane' }], history: [{ stage: 'new' }], value: 0 },
    { id: 'L3', campaign: 'seo', touches: [{ campaign: 'seo' }, { campaign: 'bobyt' }], history: [{ stage: 'new' }], value: 0 },
    { id: 'L4', campaign: 'jane10', suspected_bot: true, touches: [], history: [{ stage: 'won' }], value: 999 },
  ] };
  const { results, conflicts } = creatorResults(r.creators, { pipeline });
  assert.deepEqual(conflicts, [{ code: 'jane10', kept: 'cr-instagram-janedoe', also: 'cr-youtube-bob' }]);
  const j = results['cr-instagram-janedoe'];
  assert.deepEqual([j.leads, j.won, j.revenue, j.cost, j.cost_per_lead, j.roas], [2, 1, 300, 200, 100, 1.5]);
  assert.equal(results['cr-youtube-bob'].assisted, 1);
  const fb = creatorResults(r.creators, { report: { campaigns: [{ channel: 'social', campaign: 'BobYT', leads: 4, won: 1, revenue: 50 }] } });
  assert.deepEqual([fb.results['cr-youtube-bob'].leads, fb.results['cr-youtube-bob'].source], [4, 'report']);

  const rep = creatorsReport(r, { now, pipeline });
  assert.equal(rep.creators[0].id, 'cr-instagram-janedoe', 'sorted by revenue');
  assert.equal(rep.totals.revenue, 300);
  assert.equal(rep.code_conflicts.length, 1);
  const text = JSON.stringify(rep) + renderMarkdown(rep, 'Demo');
  assert.ok(!text.includes('jane@example.com') && !text.includes('555 0100'), 'no contact details in the report');
});

test('report: overdue deliverables and live content without a confirmed label', () => {
  const r = merge(contracted(), [
    { op: 'deliverable', creator: 'janedoe@instagram', deliverable: { id: 'D1', type: 'story', due: '2026-11-01', status: 'draft' } },
    { op: 'deliverable', creator: 'janedoe@instagram', deliverable: { id: 'D2', type: 'reel', due: '2026-11-09', status: 'live', url: 'https://x.test/r' } },
  ]).roster;
  const rep = creatorsReport(r, { now });
  assert.deepEqual(rep.overdue.map((d) => [d.deliverable, d.days_late]), [['D1', 3]]);
  assert.deepEqual(rep.undisclosed.map((d) => d.deliverable), ['D2']);
  assert.equal(rep.pipeline.find((p) => p.status === 'contracted').count, 1);
});

test('runCreators: reads updates, writes roster, report, run file with approvals, moves updates; state has no contacts', () => {
  const slug = 'demo';
  const dir = path.join(tmp, 'products', slug);
  fs.mkdirSync(path.join(dir, 'creators', 'updates'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'product.json'), JSON.stringify({ name: 'Demo', stage: 'active', budget }));
  fs.writeFileSync(path.join(dir, 'claims.md'), '| id | claim | status | source |\n|---|---|---|---|\n| C1 | a | verified | x |\n');
  fs.writeFileSync(path.join(dir, 'approvals.json'), '[]');
  fs.writeFileSync(path.join(dir, 'creators', 'updates', 'a.json'), JSON.stringify([jane, { op: 'outreach', creator: 'janedoe@instagram', file: 'outbox/creators/jane.md' }]));
  fs.writeFileSync(path.join(dir, 'creators', 'updates', 'b.jsonl'), `${JSON.stringify({ op: 'brief', creator: 'janedoe@instagram', brief: { title: 'T', goal: 'G', claims: ['C2'] } })}\nnot json\n`);
  const out = runCreators(slug, { root: tmp, now });
  assert.equal(out.new_creators, 1);
  assert.equal(out.proposals, 1);
  assert.equal(out.rejected, 1);
  assert.equal(out.read_errors.length, 1);
  assert.equal(out.run_file, 'products/demo/runs/CREATORS-2026-11-04.json');
  const run = JSON.parse(fs.readFileSync(path.join(tmp, out.run_file), 'utf8'));
  assert.equal(run.agent, 'om-creator-program-manager');
  assert.equal(run.approvals.length, 1);
  assert.equal(fs.readdirSync(path.join(dir, 'creators', 'updates')).filter((f) => f !== 'done').length, 0);
  assert.equal(fs.readdirSync(path.join(dir, 'creators', 'updates', 'done')).length, 2);
  assert.ok(fs.existsSync(path.join(dir, 'creators', 'CREATORS.md')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'creators', 'rejected.json'), 'utf8')).length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'creators', 'roster.json'), 'utf8')).creators[0].contact.email, 'jane@example.com', 'contacts stay in the product folder');
  // A second run with no updates proposes nothing new and keeps the run file's approvals unique.
  const again = runCreators(slug, { root: tmp, now });
  assert.equal(again.proposals, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, out.run_file), 'utf8')).approvals.length, 1);
  assert.equal(writeCreatorsState([slug, 'missing'], { root: tmp, now }), 1);
  const state = fs.readFileSync(path.join(tmp, 'state', 'creators.json'), 'utf8');
  assert.ok(!state.includes('jane@example.com') && !state.includes('555'));
  assert.equal(JSON.parse(state).products[0].creators[0].handle, 'janedoe');
  assert.throws(() => runCreators('../evil', { root: tmp }), /bad product slug/);
  assert.throws(() => runCreators('nope', { root: tmp }), /no products/);
});

test('opt-out: do_not_contact erases contact details and withdraws waiting outreach with a reject alert', () => {
  const m = merge({}, [jane, { op: 'outreach', creator: 'janedoe@instagram', file: 'outbox/creators/jane-1.md' }]);
  const o = merge(m.roster, [{ op: 'upsert', creator: { handle: 'janedoe', platform: 'ig', do_not_contact: true, contact: { email: 'again@example.com' } } }]);
  const c = o.roster.creators[0];
  assert.deepEqual(c.contact, {});
  assert.ok(c.contact_erased_at);
  assert.equal(c.outreach[0].status, 'withdrawn');
  assert.equal(o.alerts.filter((a) => a.level === 'decision' && /Reject creator outreach/.test(a.title)).length, 1);
  assert.ok(!JSON.stringify(o.roster).includes('example.com'));
  const declined = merge(m.roster, [{ op: 'status', creator: 'janedoe@instagram', status: 'declined' }]);
  assert.equal(declined.roster.creators[0].outreach[0].status, 'withdrawn');
});

test('payout and contract edge guards: daily cap counts paid-today payouts, contract swaps cannot undercut payouts', () => {
  const r = merge(contracted(), [{ op: 'deliverable', creator: 'janedoe@instagram', deliverable: { id: 'D1', type: 'reel', status: 'live', url: 'https://instagram.com/p/abc', disclosure_confirmed: true } }, { op: 'status', creator: 'janedoe@instagram', status: 'content_live' }]).roster;
  const p = merge(r, [{ op: 'payout', creator: 'janedoe@instagram', payout: { id: 'P1', amount: 400 } }]);
  const paid = merge(p.roster, [{ op: 'payout_paid', creator: 'janedoe@instagram', payout_id: 'P1' }], { approvals: [{ id: p.approvals[0].id, status: 'approved' }] });
  assert.equal(committedPayouts(paid.roster.creators, now).day, 400);
  const more = merge(paid.roster, [{ op: 'contract', creator: 'janedoe@instagram', contract: { ...goodContract, fee: 1000 } }, { op: 'payout', creator: 'janedoe@instagram', payout: { amount: 300 } }]);
  assert.match(more.rejected[0].reason, /daily_cap/);
  assert.match(merge(paid.roster, [{ op: 'contract', creator: 'janedoe@instagram', contract: { ...goodContract, fee: 300 } }]).rejected[0].reason, /fee/);
  assert.match(merge(paid.roster, [{ op: 'contract', creator: 'janedoe@instagram', contract: { ...goodContract, currency: 'EUR' } }]).rejected[0].reason, /currency/);
  assert.match(merge(r, [{ op: 'contract', creator: 'janedoe@instagram', contract: { ...goodContract, signed_at: null } }]).rejected[0].reason, /unsigned contract/);
});

test('runCreators: a corrupt roster is never overwritten; unreadable update files go to failed/ with an alert', () => {
  const slug = 'corrupt';
  const dir = path.join(tmp, 'products', slug);
  fs.mkdirSync(path.join(dir, 'creators', 'updates'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'product.json'), JSON.stringify({ name: 'C', budget }));
  fs.writeFileSync(path.join(dir, 'creators', 'roster.json'), '{"creators": [ broken');
  fs.writeFileSync(path.join(dir, 'creators', 'updates', 'a.json'), JSON.stringify(jane));
  assert.throws(() => runCreators(slug, { root: tmp, now }), /does not parse/);
  assert.equal(fs.readFileSync(path.join(dir, 'creators', 'roster.json'), 'utf8'), '{"creators": [ broken');
  assert.ok(fs.existsSync(path.join(dir, 'creators', 'updates', 'a.json')), 'updates stay until the roster is fixed');
  fs.writeFileSync(path.join(dir, 'creators', 'roster.json'), '');
  fs.writeFileSync(path.join(dir, 'creators', 'updates', 'b.json'), '{"op": "upsert", "creator": {"handle": "x", "contact": {"email": "leak@example.com"');
  const out = runCreators(slug, { root: tmp, now });
  assert.equal(out.new_creators, 1);
  assert.equal(fs.readdirSync(path.join(dir, 'creators', 'updates', 'failed')).length, 1);
  const run = fs.readFileSync(path.join(tmp, out.run_file), 'utf8');
  assert.match(run, /could not be read/);
  assert.ok(!run.includes('leak@example.com'), 'parse errors do not copy file content into alerts');
});

test('CLI: usage error without a slug', () => {
  const r = spawnSync(process.execPath, [path.join(repo, 'tools', 'creators.mjs')], { encoding: 'utf8', cwd: repo });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Usage/);
});
