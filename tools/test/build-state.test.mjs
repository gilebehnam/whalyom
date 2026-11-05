// build-state: live monthly spend (not the stale budget.spent_this_month), product currency, and
// kpis rows that say whether they are verified (server-side) or browser-reported.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { testEnv } from './_env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const slug = `zz-build-state-${process.pid}`;
const dir = path.join(root, 'products', slug);
const build = () => {
  const r = spawnSync(process.execPath, [path.join(root, 'tools', 'build-state.mjs')], { encoding: 'utf8', env: testEnv() });
  assert.equal(r.status, 0, r.stderr);
};
const readState = (name) => JSON.parse(fs.readFileSync(path.join(root, 'state', `${name}.json`), 'utf8'));
const today = new Date().toISOString().slice(0, 10);
const lastMonth = (() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })();
const writeKpis = (rows) => fs.writeFileSync(path.join(dir, 'metrics', 'kpis.json'), JSON.stringify(rows));

fs.mkdirSync(path.join(dir, 'metrics'), { recursive: true });
fs.writeFileSync(path.join(dir, 'product.json'), JSON.stringify({ name: 'ZZ build-state', domain: null, stage: 'idea', budget: { monthly_cap: 100, spent_this_month: 95, currency: 'EUR' } }));
fs.writeFileSync(path.join(dir, 'ledger.jsonl'), JSON.stringify({ at: `${lastMonth}T10:00:00Z`, channel: 'google', amount: 95, kind: 'spend' }) + '\n');

after(() => { fs.rmSync(dir, { recursive: true, force: true }); spawnSync(process.execPath, [path.join(root, 'tools', 'build-state.mjs')], { encoding: 'utf8', env: testEnv() }); });

test('spent is computed live for this month, not read from the stale stored field', () => {
  writeKpis([]);
  build();
  const row = readState('products').find((p) => p.product === slug);
  assert.ok(row, 'fixture product listed');
  assert.equal(row.spent, 0, 'last month spend and a stale spent_this_month do not count');
  writeKpis([{ date: today, channel: 'google', metric: 'spend', value: 80, source: 'google-ads-metrics' }]);
  build();
  assert.equal(readState('products').find((p) => p.product === slug).spent, 80, 'platform spend rows this month count');
});

test('products carry currency and kpis rows say whether they are verified', () => {
  writeKpis([
    { date: today, metric: 'revenue', value: 10, source: 'stripe' },
    { date: today, metric: 'client_revenue', value: 12, source: 'satellite' },
    { date: today, metric: 'conversions', value: 1, source: 'edge' },
  ]);
  build();
  assert.equal(readState('products').find((p) => p.product === slug).currency, 'EUR');
  const rows = readState('kpis').filter((k) => k.product === slug);
  const by = (m) => rows.find((k) => k.metric === m);
  assert.equal(by('revenue').verified, true);
  assert.equal(by('client_revenue').verified, false);
  assert.equal(by('conversions').verified, false, 'edge beacon rows are unverified');
  for (const key of ['date', 'channel', 'campaign', 'metric', 'value', 'source', 'verified']) assert.ok(key in by('revenue'), `kpi row has ${key}`);
});

test('the empty kpis placeholder lists channel, campaign, source and verified', () => {
  const src = fs.readFileSync(path.join(root, 'tools', 'build-state.mjs'), 'utf8');
  const cols = src.match(/kpis: \[([^\]]+)\]/)[1];
  for (const key of ['channel', 'campaign', 'source', 'verified']) assert.ok(cols.includes(`'${key}'`), `columns.kpis has ${key}`);
  assert.match(src.match(/products: \[([^\]]+)\]/)[1], /'currency'/);
});
