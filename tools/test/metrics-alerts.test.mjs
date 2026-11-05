// Audit fixes 11, 12, 13, 16, 20, 24, 25: browser-reported conversions stay apart, edge sites are
// detected, ad readers feed the kill switch, alerts are deduped and resolvable, every approval and
// decision reaches Needs You Know, and the sync cursor neither skips nor double-counts.
// Run: node --test tools/test/metrics-alerts.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pullAdRows, AD_READERS } from '../metrics.mjs';
import { decisionId } from '../needs-you-know.mjs';
import { testEnv } from './_env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const slug = `zz-ma-${process.pid}`;
const edgeSlug = `zz-edge-${process.pid}`;
const P = (s, f = '') => path.join(root, 'products', s, f);
const blank = Object.fromEntries(['META_ACCESS_TOKEN', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ACCESS_TOKEN', 'TIKTOK_ACCESS_TOKEN', 'TIKTOK_ADVERTISER_ID', 'LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_AD_ACCOUNT_ID', 'REDDIT_ADS_ACCESS_TOKEN', 'X_ADS_ACCESS_TOKEN', 'APPLE_ADS_CLIENT_ID', 'STRIPE_API_KEY'].map((k) => [k, '']));
const env = testEnv(process.env, { OM_KILL: '', ...blank });
const run = (script, args = [], extra = {}) => {
  const r = spawnSync(process.execPath, [path.join(root, 'tools', script), ...args], { encoding: 'utf8', env: { ...env, ...extra } });
  assert.equal(r.status, 0, `${script} ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  const last = r.stdout.trim().split(/\r?\n/).at(-1);
  try { return JSON.parse(last); } catch { return last; }
};
const read = (s, f) => JSON.parse(fs.readFileSync(P(s, f), 'utf8'));
const write = (s, f, v) => { fs.mkdirSync(path.dirname(P(s, f)), { recursive: true }); fs.writeFileSync(P(s, f), typeof v === 'string' ? v : JSON.stringify(v, null, 2)); };
const today = new Date().toISOString().slice(0, 10);
const nyk = () => JSON.parse(fs.readFileSync(path.join(root, 'state', 'live-nyk.json'), 'utf8')).items;

write(slug, 'product.json', { name: 'MA test', budget: { currency: 'EUR', variant_kill_spend: 5 }, goals: {} });
after(() => {
  for (const s of [slug, edgeSlug]) fs.rmSync(P(s), { recursive: true, force: true });
  spawnSync(process.execPath, [path.join(root, 'tools', 'needs-you-know.mjs')], { env });
});

test('ad readers: configured ones run with a mocked fetch, a failing one is logged and skipped', async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('tiktok')) return new Response(JSON.stringify({ code: 0, data: { list: [{ dimensions: { campaign_id: 'tt1', stat_time_day: `${today} 00:00:00` }, metrics: { spend: '7.5', clicks: '30', conversion: '0' } }], page_info: { total_page: 1 } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response('{"message":"nope"}', { status: 500, headers: { 'content-type': 'application/json' } });
  };
  const logs = [];
  const ctx = { env: { TIKTOK_ACCESS_TOKEN: 't', TIKTOK_ADVERTISER_ID: '1', LINKEDIN_ACCESS_TOKEN: 'l', LINKEDIN_AD_ACCOUNT_ID: '2' }, fetch, now: new Date().toISOString() };
  const { rows, results } = await pullAdRows(ctx, { log: (m) => logs.push(m) });
  assert.deepEqual(results.map((r) => [r.source, r.ok]), [['tiktok-ads-metrics', true], ['linkedin-ads-metrics', false]], 'google is not configured, so it does not run');
  assert.ok(!calls.some((u) => u.includes('googleads')));
  assert.equal(logs.length, 1);
  const spend = rows.find((r) => r.metric === 'spend');
  assert.deepEqual({ ...spend }, { date: today, channel: 'tiktok', campaign: 'tt1', metric: 'spend', value: 7.5, source: 'tiktok-ads-metrics' });
  assert.equal(AD_READERS.length, 9);
  assert.deepEqual(AD_READERS.slice(7).map((r) => r.name), ["amazon-ads-metrics", "walmart-connect-metrics"]);
  // Nothing configured: no network at all.
  assert.deepEqual((await pullAdRows({ env: {}, fetch: async () => { throw new Error('no network expected'); } })).results, []);
});

test('reader rows in the kill switch shape: alerts are deduped per channel and campaign, and resolvable', () => {
  write(slug, 'metrics/inbox/tiktok-ads-metrics.json', [
    { date: today, channel: 'tiktok', campaign: 'tt1', metric: 'spend', value: 7.5, source: 'tiktok-ads-metrics' },
    { date: today, channel: 'tiktok', campaign: 'tt1', metric: 'conversions', value: 0, source: 'tiktok-ads-metrics' },
  ]);
  const m = run('metrics.mjs', [slug]);
  assert.equal(m.reader_rows, 0, 'no ad keys in the test env, so no reader ran');
  assert.ok(read(slug, 'metrics/kpis.json').some((r) => r.campaign === 'tt1' && r.metric === 'spend'));
  const k1 = run('killswitch.mjs', [slug]);
  assert.equal(k1.triggered, 1); assert.equal(k1.alerted, 1);
  const k2 = run('killswitch.mjs', [slug]);
  assert.equal(k2.triggered, 1); assert.equal(k2.alerted, 0); assert.equal(k2.deduped, 1);
  const open = read(slug, 'alerts.json').filter((a) => !a.resolved);
  assert.equal(open.length, 1, 'one open alert, not one per cycle');
  assert.equal(open[0].key, 'killswitch:tiktok:tt1'); assert.equal(open[0].repeats, 2);
  run('needs-you-know.mjs');
  const item = nyk().find((i) => i.product === slug && i.kind === 'alert');
  assert.equal(item.alert_key, 'killswitch:tiktok:tt1');
  const r = run('needs-you-know.mjs', ['resolve', 'killswitch:tiktok:tt1', '--product', slug]);
  assert.equal(r.resolved, 1);
  assert.ok(read(slug, 'alerts.json').every((a) => a.resolved === true));
  assert.ok(!nyk().some((i) => i.product === slug && i.kind === 'alert'));
  // Resolving by title works too, and a new cycle alerts again once the old one is resolved.
  run('killswitch.mjs', [slug]);
  assert.equal(run('needs-you-know.mjs', ['resolve', 'Pause tiktok tt1 now', '--product', slug]).resolved, 1);
});

test('Needs You Know: every approval survives an alert flood; decisions get stable ids; blocked items can be overridden', () => {
  write(slug, 'alerts.json', Array.from({ length: 120 }, (_, i) => ({ level: 'critical', title: `Flood ${i}`, detail: 'x', agent: 'test', at: new Date().toISOString(), resolved: false })));
  write(slug, 'outbox/boosters/lead.json', { id: 'lead-capture', type: 'lead-capture', needs_owner: ['Add a privacy policy page and its link before turning this on.'] });
  write(slug, 'approvals.json', [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `A${i}`, type: 'publish', title: `Post ${i}`, status: 'pending', compliance: 'pass', agent: 'om-x' })),
    { id: 'B1', type: 'publish', title: 'Risky ad', status: 'pending', compliance: 'block', review_notes: 'claim not in claims.md', agent: 'om-ad-creative' },
    { id: 'C1', type: 'publish', channel: 'onsite-booster', title: 'Switch on lead capture', file: 'outbox/boosters/lead.json', status: 'pending', compliance: 'pass', agent: 'om-site-crawler' },
  ]);
  write(slug, 'reports/owner-decisions.md', '# Owner decisions\n\n| # | Question | Answer |\n|---|---|---|\n| 1 | Pick a price | |\n| 2 | Launch in Germany? | |\n');
  run('needs-you-know.mjs');
  const mine = nyk().filter((i) => i.product === slug);
  for (const id of ['A0', 'A1', 'A2', 'A3', 'A4', 'B1', 'C1']) assert.ok(mine.some((i) => i.id === id && i.level === 'approval'), `approval ${id} is in the feed`);
  const blocked = mine.find((i) => i.id === 'B1');
  assert.equal(blocked.blocked, true); assert.equal(blocked.override, true); assert.match(blocked.detail, /overrides the review/);
  const booster = mine.find((i) => i.id === 'C1');
  assert.deepEqual(booster.needs_owner, ['Add a privacy policy page and its link before turning this on.']);
  assert.match(booster.detail, /privacy policy/);
  const decs = mine.filter((i) => i.kind === 'owner-decision');
  assert.equal(decs.length, 2);
  assert.equal(decs[0].id, decisionId('1', 'Pick a price'));
  run('needs-you-know.mjs');
  assert.equal(nyk().find((i) => i.product === slug && i.number === '1').id, decs[0].id, 'id is stable between rebuilds');
  run('needs-you-know.mjs', ['answer', slug, decs[0].id, 'EUR 29']);
  assert.match(fs.readFileSync(P(slug, 'reports/owner-decisions.md'), 'utf8'), /Pick a price.*answered: EUR 29/);
  assert.ok(!nyk().some((i) => i.product === slug && i.number === '1'), 'answered decision leaves the feed');
  assert.ok(nyk().some((i) => i.product === slug && i.number === '2'));
  write(slug, 'alerts.json', []); write(slug, 'approvals.json', []);
});

test('learner and revenue milestones ignore browser-reported numbers', () => {
  write(slug, 'metrics/kpis.json', [
    { date: today, channel: 'reddit', campaign: 'fake', metric: 'spend', value: 50, source: 'import' },
    { date: today, channel: 'reddit', campaign: 'fake', metric: 'client_revenue', value: 99999, source: 'satellite' },
    { date: today, channel: 'reddit', campaign: 'fake', metric: 'client_conversions', value: 40, source: 'satellite' },
    { date: today, channel: 'reddit', campaign: 'old', metric: 'revenue', value: 5000, source: 'satellite' },
    { date: today, channel: 'reddit', campaign: 'old', metric: 'spend', value: 50, source: 'import' },
    { date: today, channel: 'all', metric: 'client_revenue', value: 777, source: 'satellite' },
  ]);
  const r = run('learn.mjs', [slug]);
  const board = read(slug, 'scoreboard.json');
  for (const s of board.scored) { assert.equal(s.revenue, 0, `${s.campaign} has no server-side revenue`); assert.equal(s.conversions, 0); }
  assert.equal(r.winners + r.losers <= 2, true);
  const learn = fs.existsSync(P(slug, 'LEARNINGS.md')) ? fs.readFileSync(P(slug, 'LEARNINGS.md'), 'utf8') : '';
  assert.doesNotMatch(learn, /WIN .*fake/);
  run('needs-you-know.mjs');
  assert.ok(!nyk().some((i) => i.product === slug && i.kind === 'revenue'), 'no revenue milestone from beacons');
  write(slug, 'metrics/kpis.json', [{ date: today, channel: 'all', metric: 'revenue', value: 120, source: 'stripe' }, { date: today, channel: 'all', metric: 'client_revenue', value: 777, source: 'satellite' }]);
  run('needs-you-know.mjs');
  const rev = nyk().find((i) => i.product === slug && i.kind === 'revenue');
  assert.match(rev.title, /120\.00/); assert.match(rev.detail, /777\.00 \(unverified\)/);
});

test('sync-sites: edge events are found without edge:true, beacons become client_* rows, the cursor keeps same-millisecond events', () => {
  write(edgeSlug, 'connection.json', { domain: 'edge-test.example' });
  const at = '2026-11-04T10:00:00.000Z';
  const ev = (eid, type, extra = {}) => JSON.stringify({ at, eid, type, path: '/', utm: { source: 'reddit' }, ...extra });
  write(edgeSlug, 'edge/events.jsonl', [ev('e0000001', 'pageview'), ev('e0000002', 'conversion', { value: 5e8 }), ev('e0000003', 'checkout', { value: 'NaN' }), ev('e0000004', 'conversion', { value: 19 })].join('\n') + '\n');
  const out = run('sync-sites.mjs', ['--only', edgeSlug]);
  assert.ok(out.sites_status.includes('edge-test.example:connected'));
  const conn = read(edgeSlug, 'connection.json');
  assert.equal(conn.edge, true);
  const store = read(edgeSlug, 'metrics/satellite-totals.json');
  assert.equal(store.cursor.at, at); assert.equal(store.cursor.keys.length, 4);
  const v = (m) => store.rows[`2026-11-04|reddit||${m}`];
  assert.equal(v('sessions'), 1);
  assert.equal(v('client_conversions'), 3);
  assert.equal(v('client_revenue'), 100019, 'value capped at 100000 per event, NaN ignored');
  assert.equal(v('conversions'), undefined); assert.equal(v('revenue'), undefined);
  // A later event stamped in the same millisecond as the cursor is still counted, the old ones are not.
  fs.appendFileSync(P(edgeSlug, 'edge/events.jsonl'), ev('e0000005', 'pageview') + '\n');
  run('sync-sites.mjs', ['--only', edgeSlug]);
  assert.equal(read(edgeSlug, 'metrics/satellite-totals.json').rows['2026-11-04|reddit||sessions'], 2);
  run('sync-sites.mjs', ['--only', edgeSlug]);
  const again = read(edgeSlug, 'metrics/satellite-totals.json');
  assert.equal(again.rows['2026-11-04|reddit||sessions'], 2, 'idempotent');
  assert.equal(again.rows['2026-11-04|reddit||client_conversions'], 3);
});

test('revenue milestone: sales come from payments only, ad platform conversions are shown apart, the window is 7 calendar days', () => {
  const daysAgo = (n) => new Date(Date.now() - n * 86400 * 1000).toISOString().slice(0, 10);
  write(slug, 'metrics/kpis.json', [
    { date: today, channel: 'all', metric: 'revenue', value: 100, source: 'stripe' },
    { date: today, channel: 'all', metric: 'payments', value: 2, source: 'stripe' },
    { date: today, channel: 'google', campaign: 'c1', metric: 'conversions', value: 2, source: 'google-ads-metrics' },
    { date: today, channel: 'organic_search', metric: 'conversions', value: 2, source: 'ga4' },
    { date: daysAgo(7), channel: 'all', metric: 'revenue', value: 1000, source: 'stripe' },
  ]);
  run('needs-you-know.mjs');
  const rev = nyk().find((i) => i.product === slug && i.kind === 'revenue');
  assert.match(rev.detail, /^2 sales\b/, 'one purchase is counted once, from the payment');
  assert.match(rev.detail, /2 conversions reported by ad platforms \(attributed, not verified\)/);
  assert.doesNotMatch(rev.detail, /\b[46] /, 'GA4 key events are not added to sales or platform conversions');
  assert.match(rev.title, /^Revenue: 100\.00 /, 'the row dated 7 days ago is outside the window');
  write(slug, 'metrics/kpis.json', []);
});
