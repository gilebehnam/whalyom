// Funnel management and the zero-budget lead engine: leads from the site log and CRM files become one
// row per person, stage updates move them forward only, payments mark them won with verified revenue,
// the report counts every stage and channel, stuck leads raise alerts, and the free plan spends hours
// (never money) and shifts toward channels that sell.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { mergeFunnel, funnelReport, canonicalStage, stripePayments, writeFunnelState } from '../funnel.mjs';
import { freePlan, CHANNELS } from '../free-engine.mjs';
import { roster } from '../roster.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const slug = `zz-funnel-${process.pid}`;
const slug2 = `zz-funnel-${process.pid}-b`;
const P = (f = '') => path.join(root, 'products', slug, f);
const P2 = (f = '') => path.join(root, 'products', slug2, f);
// Reply jobs go to a temp queue: a hub running on this machine polls state/queue and would start a real
// AI run on the test product.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-funnel-'));
const queue = path.join(tmp, 'queue');
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(STRIPE_|OM_AUTO_RESPOND$)/.test(k))), OM_QUEUE_DIR: queue, OM_NO_DOTENV: '1', OM_AI_REPLY: 'all' };
const run = (script, args, extra = {}) => {
  const r = spawnSync(process.execPath, [path.join(root, 'tools', script), ...args], { encoding: 'utf8', env: { ...env, ...extra }, cwd: root });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const last = r.stdout.trim().split(/\r?\n/).at(-1);
  try { return JSON.parse(last); } catch { return last; }
};
const realQueue = path.join(root, 'state', 'queue');
const ledger = (p) => JSON.parse(fs.readFileSync(p('funnel/pipeline.json'), 'utf8'));
after(() => {
  for (const s of [slug, slug2]) { fs.rmSync(path.join(root, 'products', s), { recursive: true, force: true }); for (const x of ['', '.running']) fs.rmSync(path.join(realQueue, `respond-${s}.json${x}`), { force: true }); }
  fs.rmSync(tmp, { recursive: true, force: true });
  // funnel.mjs rebuilt state/funnel.json and state/live-funnel.json with the test products in them, and
  // /om sync uploads those to the Control Room. Rebuild them from the products that remain (the same
  // filter funnel.mjs uses) so no deleted test product stays on the dashboard.
  const stateFiles = ['funnel.json', 'live-funnel.json'].map((f) => path.join(root, 'state', f));
  const ours = new RegExp(`"(${slug}|${slug2})"`);
  const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
  if (stateFiles.some((f) => ours.test(read(f)))) {
    const dir = path.join(root, 'products');
    writeFunnelState(fs.readdirSync(dir).filter((s) => !s.startsWith('_') && /^[a-z0-9-]+$/i.test(s) && fs.existsSync(path.join(dir, s, 'product.json'))));
  }
  for (const f of stateFiles) assert.doesNotMatch(read(f), ours, `${path.basename(f)} still lists a deleted test product`);
});

test('stage words from presets and CRMs map to the canonical stages', () => {
  assert.equal(canonicalStage('add_to_cart'), 'opportunity');
  assert.equal(canonicalStage('Closed Won'), 'won');
  assert.equal(canonicalStage('trial-to-paid'), 'won');
  assert.equal(canonicalStage('unsubscribed'), 'lost');
  assert.equal(canonicalStage('whatever'), null);
});

test('merge: one row per person, forward-only stages, payments matched by email', () => {
  const now = '2026-11-04T12:00:00.000Z';
  const leads = [
    { at: '2026-11-01T10:00:00Z', lead_id: 'a1', channel: 'community', consent: true, contact: { email: 'Ann@Example.com' } },
    { at: '2026-11-02T10:00:00Z', lead_id: 'a2', channel: 'organic', consent: true, contact: { email: 'ann@example.com' } },
    { at: '2026-11-03T09:00:00Z', lead_id: 'b1', channel: 'organic', consent: true, contact: { email: 'bob@example.com' } },
    { at: '2026-11-03T09:30:00Z', lead_id: 'bot', channel: 'organic', bot_hint: 'fast' },
  ];
  const updates = [
    { lead: 'a1', stage: 'replied_by_us', at: '2026-11-01T11:00:00Z' },
    { email: 'ann@example.com', stage: 'checkout', at: '2026-11-02T12:00:00Z' },
    { lead: 'a1', stage: 'contacted', at: '2026-11-02T13:00:00Z' },
    { lead: 'nobody', stage: 'won' },
  ];
  const payments = [{ id: 'ch_1', email: 'ANN@example.com', amount: 49, currency: 'usd', at: '2026-11-03T08:00:00Z' }, { id: 'ch_2', email: 'stranger@example.com', amount: 10, currency: 'usd', at: '2026-11-03T08:00:00Z' }];
  const { pipeline, stats, unmatched_payments } = mergeFunnel({ leads: [] }, { leads, updates, payments, now });
  assert.equal(stats.new_leads, 3); assert.equal(stats.merged, 1);
  const ann = pipeline.leads.find((r) => r.lead_id === 'a1');
  assert.equal(ann.channel, 'community', 'first touch kept'); assert.equal(ann.last_channel, 'organic');
  assert.equal(ann.stage, 'won'); assert.equal(ann.value, 49); assert.equal(ann.orders, 1);
  assert.ok(!JSON.stringify(pipeline).includes('ann@example.com'), 'no raw email in the ledger');
  assert.equal(stats.updates_unmatched, 1); assert.equal(unmatched_payments.length, 1);
  // Merging the same payment again changes nothing.
  const again = mergeFunnel(pipeline, { payments, now });
  assert.equal(again.pipeline.leads.find((r) => r.lead_id === 'a1').value, 49);

  const rep = funnelReport(pipeline, { now, unmatchedPayments: unmatched_payments, kpis: [{ date: '2026-11-02', channel: 'organic', metric: 'sessions', value: 100 }] });
  assert.equal(rep.totals.leads, 2); assert.equal(rep.totals.suspected_bots, 1);
  assert.equal(rep.totals.won, 1); assert.equal(rep.totals.revenue_verified, 49); assert.equal(rep.totals.sales_without_tracked_lead, 1);
  assert.equal(rep.funnel.find((f) => f.stage === 'opportunity').reached, 1);
  assert.equal(rep.channels.find((c) => c.channel === 'organic').visits_30d, 100);
  const bob = rep.next_actions.find((a) => a.stage === 'new');
  assert.ok(bob && bob.overdue && bob.agent === 'om-speed-to-lead', 'uncontacted lead past 24 h is overdue');
});

test('funnel.mjs end to end: files in, ledger, report, alerts, state without personal data', () => {
  run('new-product.mjs', [slug, '--name', 'Funnel Demo', '--preset', 'ecommerce']);
  const old = new Date(Date.now() - 3 * 86400000).toISOString();
  fs.writeFileSync(P('leads.jsonl'), [{ at: old, lead_id: 'x1', channel: 'community', consent: true, contact: { email: 'x1@example.com' } }, { at: new Date().toISOString(), lead_id: 'x2', channel: 'short-video', consent: true, contact: { email: 'x2@example.com' } }].map((l) => JSON.stringify(l)).join('\n') + '\n');
  fs.mkdirSync(P('funnel/updates'), { recursive: true });
  fs.writeFileSync(P('funnel/updates/crm.csv'), `lead,stage,at,value,source\nx2,purchase,${new Date().toISOString()},30,owner\n`);
  const r = run('funnel.mjs', [slug, '--no-stripe']);
  assert.equal(r.new_leads, 2); assert.equal(r.updates_applied, 1);
  assert.equal(r.respond_queued, true, 'new leads queue an AI reply run for the hub');
  assert.ok(fs.existsSync(path.join(queue, `respond-${slug}.json`)), 'job written to OM_QUEUE_DIR'); assert.equal(r.totals.won, 1); assert.equal(r.totals.revenue_verified, 30);
  assert.ok(!(fs.existsSync(realQueue) ? fs.readdirSync(realQueue) : []).some((f) => f.startsWith(`respond-${slug}`)), 'nothing in the real hub queue');
  assert.ok(fs.existsSync(P('funnel/FUNNEL.md')));
  assert.equal(fs.readdirSync(P('funnel/updates')).filter((f) => f.endsWith('.csv')).length, 0, 'merged update files move to done/');
  const alerts = JSON.parse(fs.readFileSync(P('alerts.json'), 'utf8'));
  assert.ok(alerts.some((a) => a.key === 'funnel:uncontacted' && !a.resolved));
  // Second run: nothing new, the leads log is not merged twice.
  const r2 = run('funnel.mjs', [slug, '--no-stripe']);
  assert.equal(r2.new_leads, 0); assert.equal(r2.totals.leads, 2);
  // The lead gets a reply: the alert resolves itself.
  fs.writeFileSync(P('funnel/updates/reply.json'), JSON.stringify([{ lead: 'x1', stage: 'contacted', at: new Date().toISOString(), source: 'om-speed-to-lead' }]));
  run('funnel.mjs', [slug, '--no-stripe']);
  assert.ok(JSON.parse(fs.readFileSync(P('alerts.json'), 'utf8')).find((a) => a.key === 'funnel:uncontacted').resolved);
  const live = fs.readFileSync(path.join(root, 'state', 'live-funnel.json'), 'utf8');
  assert.match(live, new RegExp(slug));
  assert.ok(!/example\.com/.test(live), 'live funnel carries no emails');
});

test('merge: empty id and email cells never become an id, re-reading a CRM file adds no rows', () => {
  const leads = [{ id: '', email: '', name: 'Ann', at: '', source: 'crm.csv' }, { id: '', email: 'b@x.com', at: '', source: 'crm.csv' }];
  let pipeline = { leads: [] };
  for (const now of ['2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z', '2026-11-03T00:00:00.000Z']) pipeline = mergeFunnel(pipeline, { leads, now }).pipeline;
  assert.equal(pipeline.leads.length, 2);
  for (const r of pipeline.leads) { assert.match(r.id, /^L-/); assert.match(String(r.lead_id), /^L-/); }
  // An update with blank id cells finds the lead by email.
  const { stats } = mergeFunnel(pipeline, { updates: [{ lead: '', lead_id: ' ', email: 'b@x.com', stage: 'contacted', at: '2026-11-03T01:00:00Z' }], now: '2026-11-03T02:00:00.000Z' });
  assert.equal(stats.updates_applied, 1);
});

test('merge: dated CRM history applies to a lead first seen undated; undated updates sort last; undated sales count once', () => {
  const T = '2026-11-04T12:00:00.000Z';
  const day = (n) => new Date(Date.parse(T) + n * 86400000).toISOString();
  // (1) A lead from a lead file (no date, so stage_at = run time) takes its older CRM history.
  let p = mergeFunnel({ leads: [] }, { leads: [{ lead_id: 'z' }], now: T }).pipeline;
  const m = mergeFunnel(p, { updates: [{ lead: 'z', stage: 'qualified', at: day(-1) }], now: day(1) });
  const z = m.pipeline.leads.find((r) => r.lead_id === 'z');
  assert.equal(z.stage, 'qualified'); assert.equal(z.max_rank, 3); assert.equal(m.stats.updates_applied, 1);
  assert.equal(z.stage_at, T, 'stage_at only moves forward');
  const rep = funnelReport(m.pipeline, { now: day(1) });
  assert.equal(rep.funnel.find((f) => f.stage === 'qualified').reached, rep.channels[0].qualified);
  // A kept (not applied) update does not count as reached.
  const k = mergeFunnel(m.pipeline, { updates: [{ lead: 'z', stage: 'contacted', at: day(1) }], now: day(1) });
  assert.equal(funnelReport(k.pipeline, { now: day(1) }).funnel.find((f) => f.stage === 'contacted').reached, 1);
  const kz = mergeFunnel({ leads: [] }, { leads: [{ lead_id: 'k', at: day(-3) }], updates: [{ lead: 'k', stage: 'opportunity', at: day(-2) }, { lead: 'k', stage: 'won', at: day(-1) }, { lead: 'k', stage: 'qualified', at: day(0) }], now: day(1) });
  assert.ok(kz.pipeline.leads[0].history.some((h) => h.kept && h.stage === 'qualified'));
  // (2) Undated "contacted" plus a dated "qualified" in one batch ends at qualified.
  p = mergeFunnel({ leads: [] }, { leads: [{ lead_id: 'y', at: day(-5) }], now: T }).pipeline;
  const y = mergeFunnel(p, { updates: [{ lead: 'y', stage: 'contacted' }, { lead: 'y', stage: 'qualified', at: day(-2) }], now: T }).pipeline.leads[0];
  assert.equal(y.stage, 'qualified');
  // (3) The same undated sale re-exported in a later run counts once.
  p = mergeFunnel({ leads: [] }, { leads: [{ lead_id: 'w', at: day(-5) }], now: T }).pipeline;
  const sale = { lead: 'w', stage: 'won', value: 100, source: 'crm' };
  p = mergeFunnel(p, { updates: [sale], now: T }).pipeline;
  p = mergeFunnel(p, { updates: [sale], now: day(1) }).pipeline;
  assert.equal(p.leads[0].value, 100); assert.equal(p.leads[0].orders, 1);
  // A lost lead is not pulled back out by an older CRM row.
  const lost = mergeFunnel({ leads: [] }, { leads: [{ lead_id: 'l', at: day(-5) }], updates: [{ lead: 'l', stage: 'lost', at: day(-1) }, { lead: 'l', stage: 'contacted', at: day(-3) }], now: T });
  assert.equal(lost.pipeline.leads[0].stage, 'lost');
});

test('refunds leave revenue and verified revenue; open never goes negative', () => {
  const now = '2026-11-04T12:00:00.000Z';
  const leads = [{ lead_id: 'r1', at: '2026-11-01T00:00:00Z', contact: { email: 'r1@example.com' } }];
  let { pipeline } = mergeFunnel({ leads: [] }, { leads, payments: [{ id: 'ch_r', email: 'r1@example.com', amount: 10, currency: 'usd', at: '2026-11-02T00:00:00Z' }], now });
  pipeline = mergeFunnel(pipeline, { updates: [{ lead: 'r1', stage: 'refunded', at: '2026-11-03T00:00:00Z' }], now }).pipeline;
  // Re-dropping the same refund changes nothing.
  pipeline = mergeFunnel(pipeline, { updates: [{ lead: 'r1', stage: 'refunded', at: '2026-11-03T00:00:00Z' }], now }).pipeline;
  const t = funnelReport(pipeline, { now }).totals;
  assert.equal(t.open, 0); assert.equal(t.revenue, 0); assert.equal(t.revenue_refunded, 10); assert.equal(t.revenue_verified, 0);
  assert.equal(pipeline.leads[0].stage, 'lost');
  // A partial refund leaves the rest.
  let q = mergeFunnel({ leads: [] }, { leads, payments: [{ id: 'ch_p', email: 'r1@example.com', amount: 50, at: '2026-11-02T00:00:00Z' }], now }).pipeline;
  q = mergeFunnel(q, { updates: [{ lead: 'r1', stage: 'chargeback', value: 20, at: '2026-11-03T00:00:00Z' }], now }).pipeline;
  const tq = funnelReport(q, { now }).totals;
  assert.equal(tq.revenue, 30); assert.equal(tq.revenue_verified, 30); assert.equal(tq.revenue_refunded, 20);
});

test('stripe: zero-decimal currencies keep whole units; payments merge oldest first', async () => {
  const created = Math.floor(Date.now() / 1000);
  const fake = async () => ({ ok: true, json: async () => ({ data: [{ id: 'c', status: 'succeeded', amount: 5000, currency: 'jpy', created }, { id: 'd', status: 'succeeded', amount: 5000, currency: 'usd', created }], has_more: false }) });
  const out = await stripePayments('rk_test', { fetch: fake });
  assert.equal(out.find((x) => x.id === 'c').amount, 5000); assert.equal(out.find((x) => x.id === 'd').amount, 50);
  const { pipeline } = mergeFunnel({ leads: [] }, { leads: [{ lead_id: 's', at: '2026-10-01T00:00:00Z', email: 's@example.com' }], payments: [{ id: 'c2', email: 's@example.com', amount: 5, at: '2026-10-20' }, { id: 'c1', email: 's@example.com', amount: 5, at: '2026-10-05' }], now: '2026-11-04T00:00:00.000Z' });
  const s = pipeline.leads[0];
  assert.ok(s.won_at.startsWith('2026-10-05'), s.won_at); assert.ok(s.stage_at.startsWith('2026-10-20'), s.stage_at);
  assert.equal(s.value, 10); assert.equal(s.orders, 2);
});

test('funnel.mjs: single-object updates, pending retries, quoted CSV, half-written leads.jsonl, OM_AUTO_RESPOND=0', () => {
  run('new-product.mjs', [slug2, '--name', 'Funnel Demo B', '--preset', 'saas']);
  const iso = (h = 0) => new Date(Date.now() + h * 3600000).toISOString();
  const line = (o) => JSON.stringify(o);
  // Leads log with one finished line and one still being written.
  fs.writeFileSync(P2('leads.jsonl'), line({ at: iso(-5), lead_id: 'x1', channel: 'community', consent: true }) + '\n' + '{"at":"2026-');
  fs.mkdirSync(P2('funnel/updates'), { recursive: true });
  // One update object on its own, the documented shape for agents and n8n.
  fs.writeFileSync(P2('funnel/updates/one.json'), JSON.stringify({ lead: 'x1', stage: 'replied', at: iso(-4) }));
  // An update for a lead that arrives with the next sync.
  fs.writeFileSync(P2('funnel/updates/early.json'), JSON.stringify([{ lead: 'later', email: 'later@example.com', stage: 'contacted', at: iso(-3), source: 'om-speed-to-lead' }, { lead: 'later', stage: 'not-a-stage' }]));
  const r1 = run('funnel.mjs', [slug2, '--no-stripe'], { OM_AUTO_RESPOND: '0' });
  assert.equal(r1.new_leads, 1); assert.ok(r1.updates_applied >= 1); assert.equal(r1.updates_pending, 1);
  assert.equal(r1.respond_queued, false); assert.ok(!fs.existsSync(path.join(queue, `respond-${slug2}.json`)));
  const pend = fs.readdirSync(P2('funnel/updates')).filter((f) => /^pending-.*\.jsonl$/.test(f));
  assert.equal(pend.length, 1);
  const pendText = fs.readFileSync(P2(`funnel/updates/${pend[0]}`), 'utf8');
  assert.ok(!pendText.includes('later@example.com') && pendText.includes('email_hash'), 'retry file keeps only a hash of the email');
  // The half-written line is finished, and the lead the update was waiting for arrives.
  fs.writeFileSync(P2('leads.jsonl'), line({ at: iso(-5), lead_id: 'x1', channel: 'community', consent: true }) + '\n' + line({ at: iso(-2), lead_id: 'x3', channel: 'organic' }) + '\n' + line({ at: iso(-2), lead_id: 'later', channel: 'organic', contact: { email: 'later@example.com' } }) + '\n');
  const r2 = run('funnel.mjs', [slug2, '--no-stripe'], { OM_AUTO_RESPOND: '0' });
  assert.equal(r1.new_leads + r2.new_leads, 3);
  assert.equal(ledger(P2).leads.find((r) => r.lead_id === 'later').stage, 'contacted', 'the waiting update applied once the lead synced');
  assert.equal(r2.updates_pending, 0);
  assert.equal(fs.readdirSync(P2('funnel/updates')).filter((f) => f.startsWith('pending-')).length, 0);
  // A quoted CRM export with a BOM, a spaced header and commas inside fields.
  fs.writeFileSync(P2('funnel/updates/crm.csv'), `﻿Lead ID,Stage,At,Value,Note\r\nx3,Closed Won,${iso(-1)},"1,200","paid, thanks"\r\n`);
  run('funnel.mjs', [slug2, '--no-stripe'], { OM_AUTO_RESPOND: '0' });
  const x3 = ledger(P2).leads.find((r) => r.lead_id === 'x3');
  assert.equal(x3.stage, 'won'); assert.equal(x3.value, 1200);
  assert.equal(x3.history.find((h) => h.stage === 'won').note, 'paid, thanks');
  // The log is rewritten shorter than the cursor (DSAR deletion): the new line is still merged.
  fs.writeFileSync(P2('leads.jsonl'), line({ at: iso(0), lead_id: 'x4', channel: 'organic' }) + '\n');
  const r4 = run('funnel.mjs', [slug2, '--no-stripe'], { OM_AUTO_RESPOND: '0' });
  assert.equal(r4.new_leads, 1);
  assert.ok(ledger(P2).leads.some((r) => r.lead_id === 'x4'));
  assert.ok(!(fs.existsSync(realQueue) ? fs.readdirSync(realQueue) : []).some((f) => f.startsWith(`respond-${slug2}`)));
});

test('free plan: hours not money, fit by preset, tracked links, shifts toward channels that sell', () => {
  const store = { name: 'Shop', domain: 'shop.example', preset: 'ecommerce', market: ['US'], budget: { mode: 'free' }, free: { hours_per_week: 8 } };
  const p = freePlan(store, null, { now: '2026-11-04T00:00:00Z' });
  assert.ok(p.hours_planned <= 8);
  assert.ok(p.channels.length >= 3);
  assert.ok(p.channels.some((c) => c.slot === 'explore'), 'one exploration slot');
  assert.ok(!p.channels.some((c) => c.id === 'local-profile'), 'a non-local store skips the local profile');
  for (const c of p.channels) assert.match(c.link, /utm_source=.+&utm_medium=.+&utm_campaign=free-2026-11-02/);
  // A channel that produced sales moves up.
  const pick = 'partner-swaps';
  const before = p.channels.findIndex((c) => c.id === pick);
  const report = { channels: [{ channel: 'partner', leads: 30, leads_30d: 30, won: 6 }] };
  const q = freePlan(store, report, { now: '2026-11-04T00:00:00Z' });
  const afterIdx = q.channels.findIndex((c) => c.id === pick);
  assert.ok(afterIdx > -1 && (before === -1 || afterIdx <= before), 'partner swaps climb after producing sales');
  assert.equal(q.channels.find((c) => c.id === pick).slot, 'proven');
  // No domain: site channels are deprioritised, not dropped silently.
  const noSite = freePlan({ ...store, domain: '' }, null);
  assert.ok(noSite.skipped.some((s) => s.why.some((w) => /domain/.test(w))));
  // Every agent the plan names exists in the roster.
  const names = new Set(roster.map((a) => a.name));
  for (const c of CHANNELS) for (const a of c.agents) assert.ok(names.has(a), `${c.id}: unknown agent ${a}`);
});

test('wave 8: zero-budget agents, their pack, skills and colors', async () => {
  const { wave8, groups } = await import('../roster-wave8.mjs');
  const w8 = roster.filter((a) => a.wave === 8);
  assert.equal(w8.length, wave8.length);
  assert.ok(groups.every((g) => g.gap.length > 40));
  const head = roster.find((a) => a.name === 'om-mega-growth-free');
  assert.equal(head.tier, 'mega'); assert.equal(head.model, 'opus');
  for (const a of w8) {
    assert.ok(a.colorId < 580, `${a.name} color ${a.colorId}`);
    if (a.tier !== 'micro') assert.ok(a.packs.includes('zero'), `${a.name} masters the zero pack`);
  }
  assert.equal(new Set(roster.map((a) => a.colorId)).size, roster.length, 'every agent keeps its own color');
  for (const s of ['om-zero-budget-growth', 'om-funnel-management']) assert.ok(fs.existsSync(path.join(root, '.claude', 'skills', s, 'SKILL.md')), s);
  assert.ok(fs.readFileSync(path.join(root, '.claude', 'workflows', 'om-mega-sweep.js'), 'utf8').includes("'growth-free'"));
});
