// Stripe revenue in metrics.mjs: net of refunds, disputed charges skipped, one row set per currency,
// stale days cleared, a truncated pull never overwrites older complete days; and server rows (GA4,
// owner imports) sit beside browser-beacon rows instead of being replaced by them.
// Run: node --test tools/test/metrics-stripe.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripeChargeRows, mergeStripeRows, stripeSync, keyOf } from '../metrics.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const slug = `zz-mstripe-${process.pid}`;
const P = (f = '') => path.join(root, 'products', slug, f);
after(() => fs.rmSync(P(), { recursive: true, force: true }));

const DAY = 86400;
const t = Math.floor(Date.parse('2026-11-03T12:00:00Z') / 1000);
const day = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
const find = (rows, metric, date = day(t)) => rows.find((r) => r.metric === metric && r.date === date);

test('stripeChargeRows: net of partial refunds, full refunds skipped, zero-decimal currency kept apart', () => {
  const rows = stripeChargeRows([
    { status: 'succeeded', amount: 10000, amount_refunded: 3000, currency: 'usd', created: t },
    { status: 'succeeded', amount: 500, currency: 'jpy', created: t },
    { status: 'succeeded', amount: 2000, refunded: true, amount_refunded: 2000, currency: 'usd', created: t },
    { status: 'succeeded', amount: 4000, disputed: true, currency: 'usd', created: t },
    { status: 'failed', amount: 9000, currency: 'usd', created: t },
  ]);
  assert.equal(find(rows, 'revenue').value, 70);
  assert.equal(find(rows, 'revenue').currency, 'usd');
  assert.equal(find(rows, 'payments').value, 1);
  assert.equal(find(rows, 'revenue_jpy').value, 500, 'JPY is not divided by 100');
  assert.equal(find(rows, 'revenue_jpy').currency, 'jpy');
  assert.equal(find(rows, 'payments_jpy').value, 1);
  // The product's own currency is the plain metric.
  const eur = stripeChargeRows([{ status: 'succeeded', amount: 1250, currency: 'eur', created: t }], { baseCurrency: 'EUR' });
  assert.equal(find(eur, 'revenue').value, 12.5);
});

test('mergeStripeRows: a day whose charges dropped out of the window loses its old stripe row', () => {
  const D = day(t - 2 * DAY);
  const prior = [
    { date: D, channel: 'all', metric: 'revenue', value: 120, source: 'stripe' },
    { date: D, channel: 'all', metric: 'payments', value: 2, source: 'stripe' },
    { date: D, channel: 'all', metric: 'revenue', value: 5, source: 'import.csv' },
    { date: day(t - 40 * DAY), channel: 'all', metric: 'revenue', value: 33, source: 'stripe' },
  ];
  const { rows } = mergeStripeRows(prior, [{ status: 'succeeded', amount: 1000, currency: 'usd', created: t }], { fromDay: day(t - 30 * DAY) });
  assert.equal(rows.filter((r) => r.date === D && r.source === 'stripe').length, 0);
  assert.equal(find(rows, 'revenue', D).value, 5, 'non-stripe rows are left alone');
  assert.equal(find(rows, 'revenue', day(t - 40 * DAY)).value, 33, 'days outside the window are left alone');
  assert.equal(find(rows, 'revenue').value, 10);
});

test('stripeSync: an 11-page response stops at 10 pages, records the truncation, keeps the oldest day', async () => {
  // One charge per page, one day apart: page i holds day t - i days; page 11 is never fetched.
  let calls = 0;
  const fetch = async (url) => {
    const i = calls++;
    assert.ok(i === 0 || String(url).includes(`starting_after=ch_${i - 1}`));
    return { ok: true, status: 200, json: async () => ({ data: [{ id: `ch_${i}`, status: 'succeeded', amount: 1000, currency: 'usd', created: t - i * DAY }], has_more: true }) };
  };
  const oldest = day(t - 9 * DAY);
  const prior = [{ date: oldest, channel: 'all', metric: 'revenue', value: 777, source: 'stripe' }, { date: day(t - 3 * DAY), channel: 'all', metric: 'revenue', value: 1, source: 'stripe' }];
  const res = await stripeSync(prior, { key: 'rk_test', since: t - 30 * DAY, fetch });
  assert.equal(calls, 10);
  assert.ok(res.errors.some((e) => e.startsWith('stripe: truncated')), res.errors.join('; '));
  assert.equal(find(res.rows, 'revenue', oldest).value, 777, 'the partly fetched oldest day keeps its earlier value');
  assert.equal(find(res.rows, 'revenue', day(t - 3 * DAY)).value, 10, 'fully covered days are rebuilt');
  assert.equal(res.days, 9);
  // A failing pull leaves the rows untouched.
  const bad = await stripeSync(prior, { key: 'rk_test', since: t - 30 * DAY, fetch: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }) }) });
  assert.deepEqual(bad.rows, prior);
  assert.deepEqual(bad.errors, ['stripe: bad key']);
});

test('keyOf: browser-beacon rows never share a key with server rows', () => {
  const D = '2026-11-03';
  assert.notEqual(keyOf({ date: D, channel: 'direct', metric: 'sessions', source: 'ga4.json' }), keyOf({ date: D, channel: 'direct', metric: 'sessions', source: 'satellite' }));
  assert.equal(keyOf({ date: D, metric: 'client_revenue' }), keyOf({ date: D, channel: 'all', metric: 'client_revenue', source: 'edge' }));
});

test('metrics.mjs: a satellite sessions row does not overwrite the GA4 one for the same day and channel', () => {
  const D = '2026-11-03';
  fs.mkdirSync(P('metrics/inbox'), { recursive: true });
  fs.writeFileSync(P('product.json'), JSON.stringify({ name: 'Stripe test', budget: { currency: 'USD' }, goals: {} }));
  fs.writeFileSync(P('metrics/inbox/ga4-2026-11-04.json'), JSON.stringify([{ date: D, channel: 'direct', metric: 'sessions', value: 40 }]));
  fs.writeFileSync(P('metrics/inbox/satellite-1.json'), JSON.stringify([{ date: D, channel: 'direct', metric: 'sessions', value: 900, source: 'satellite' }]));
  const r = spawnSync(process.execPath, [path.join(root, 'tools', 'metrics.mjs'), slug, '--no-readers'], { encoding: 'utf8', env: { ...process.env, STRIPE_API_KEY: '', OM_KILL: '', OM_NO_DOTENV: '1' } });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const kpis = JSON.parse(fs.readFileSync(P('metrics/kpis.json'), 'utf8')).filter((k) => k.date === D && k.metric === 'sessions' && k.channel === 'direct');
  assert.equal(kpis.length, 2);
  assert.equal(kpis.find((k) => k.source === 'ga4-2026-11-04.json').value, 40);
  assert.equal(kpis.find((k) => k.source === 'satellite').value, 900);
});
