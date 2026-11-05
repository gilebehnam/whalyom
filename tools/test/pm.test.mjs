// Product management of Whalyom itself: earned autonomy (trust is earned slowly and lost at once, price
// never earns it), outcome credit (agents judged by the leads and sales their work produced), and the
// measured product scorecard and backlog.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { earnedTypes } from '../lib/earned.mjs';
import { creditAgents } from '../outcomes.mjs';
import { gradeProduct } from '../product-review.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const slug = `zz-earned-${process.pid}`;
const P = (f = '') => path.join(root, 'products', slug, f);
after(() => fs.rmSync(P(), { recursive: true, force: true }));

const owned = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ id: `H${i}`, type: 'post', channel: 'linkedin', status: 'executed', decided_by: 'owner (command center)', decided_at: `2026-10-${String(10 + i).padStart(2, '0')}T10:00:00Z`, ...extra }));

test('earned autonomy: a streak of unchanged owner approvals earns a channel; one rejection or an edit resets it; price never earns', () => {
  assert.ok(earnedTypes(owned(10)).has('post|linkedin'));
  assert.ok(!earnedTypes(owned(9)).has('post|linkedin'), 'nine is not enough at the default streak');
  const withNo = owned(10); withNo[0].status = 'rejected';
  assert.ok(!earnedTypes(withNo).has('post|linkedin'), 'the newest decision was a rejection');
  const edited = owned(10); edited[3].edited_by_owner = true;
  assert.ok(!earnedTypes(edited).has('post|linkedin'));
  assert.ok(!earnedTypes(owned(12, { type: 'price' })).size, 'price changes never earn autonomy');
  assert.ok(!earnedTypes(owned(3), { streak: 1 }).size, 'the streak never drops below five');
  assert.ok(!earnedTypes(owned(10, { decided_by: 'policy:autopilot' })).size, 'only owner decisions count');
});

test('earned autonomy: an owner edit request or an approval over a compliance block breaks the streak', () => {
  const xs = owned(10, { channel: 'x', status: 'approved' });
  assert.ok(earnedTypes(xs).has('post|x'));
  const changes = [...xs, { id: 'H10', type: 'post', channel: 'x', status: 'changes', edited_by_owner: true, owner_note: 'shorter', decided_by: 'owner (/om approve)', decided_at: '2026-10-25T10:00:00Z' }];
  assert.equal(earnedTypes(changes).has('post|x'), false, 'a newer changes request resets the streak');
  const bare = [...xs, { id: 'H10', type: 'post', channel: 'x', status: 'changes', decided_by: 'owner (/om approve)', decided_at: '2026-10-25T10:00:00Z' }];
  assert.equal(earnedTypes(bare).has('post|x'), false, 'changes counts as a break even without edited_by_owner');
  const override = owned(10, { channel: 'x', status: 'approved' }); override[9].override_review = true;
  assert.equal(earnedTypes(override).has('post|x'), false, 'an approval over a compliance block is not a clean approval');
});

test('policy.mjs auto-approves an earned channel only with compliance pass, and records why', () => {
  const r = spawnSync(process.execPath, [path.join(root, 'tools', 'new-product.mjs'), slug, '--name', 'Earned Demo'], { encoding: 'utf8', cwd: root });
  assert.equal(r.status, 0, r.stderr);
  const p = JSON.parse(fs.readFileSync(P('product.json'), 'utf8'));
  p.domain = 'earned.example'; p.stage = 'growth'; p.autonomy = { ...p.autonomy, level: 'supervised', earned: true };
  fs.writeFileSync(P('product.json'), JSON.stringify(p));
  fs.writeFileSync(P('approvals.json'), JSON.stringify([
    ...owned(10),
    { id: 'N1', type: 'post', channel: 'linkedin', status: 'pending', compliance: 'pass' },
    { id: 'N2', type: 'post', channel: 'linkedin', status: 'pending', compliance: 'fix' },
    { id: 'N3', type: 'post', channel: 'x', status: 'pending', compliance: 'pass' },
  ]));
  const out = spawnSync(process.execPath, [path.join(root, 'tools', 'policy.mjs'), slug], { encoding: 'utf8', cwd: root });
  assert.equal(out.status, 0, out.stderr);
  const ap = Object.fromEntries(JSON.parse(fs.readFileSync(P('approvals.json'), 'utf8')).map((a) => [a.id, a]));
  assert.equal(ap.N1.status, 'auto-approved'); assert.equal(ap.N1.decided_by, 'policy:earned');
  assert.equal(ap.N2.status, 'pending', 'compliance still has to pass');
  assert.equal(ap.N3.status, 'pending', 'another channel has not earned it');
});

test('outcome credit splits each channel\'s leads and sales across the agents whose items went out there', () => {
  const report = { channels: [{ channel: 'community', leads: 10, won: 2, revenue: 200 }, { channel: 'organic', leads: 0, won: 0, revenue: 0 }] };
  const approvals = [
    { agent: 'om-community-lead-hunter', channel: 'community', status: 'executed', executed_at: '2026-10-01T00:00:00Z' },
    { agent: 'om-community-lead-hunter', channel: 'community', status: 'executed', executed_at: '2026-10-02T00:00:00Z' },
    { agent: 'om-reddit', utm_source: 'community', channel: 'reddit', status: 'executed', executed_at: '2026-10-03T00:00:00Z' },
    { agent: 'om-writer', channel: 'organic', status: 'executed', executed_at: '2026-10-01T00:00:00Z' },
    { agent: 'om-writer', channel: 'organic', status: 'pending' },
  ];
  const rows = Object.fromEntries(creditAgents({ report, approvals, tasks: [{ agent: 'om-writer', status: 'done', score: 4 }], now: '2026-11-04T00:00:00Z' }).map((r) => [r.agent, r]));
  assert.equal(rows['om-community-lead-hunter'].revenue, 133.33);
  assert.equal(rows['om-reddit'].leads, 3.33);
  assert.equal(rows['om-writer'].no_result_items, 1, 'out for 14+ days with no lead');
  assert.equal(rows['om-writer'].avg_score, 4);
});

test('outcome credit counts only leads and sales that came after the agent\'s items went out', () => {
  const now = '2026-11-04T00:00:00Z';
  const executed = '2026-10-15T00:00:00Z'; // 20 days before now
  const report = { channels: [{ channel: 'community', leads: 10, won: 2, revenue: 200 }] };
  const approvals = [{ agent: 'om-x', channel: 'community', status: 'executed', executed_at: executed }];
  const before = Array.from({ length: 10 }, (_, i) => ({ id: `L${i}`, channel: 'community', first_seen: '2026-06-01T00:00:00Z', ...(i < 2 ? { won_at: '2026-10-20T00:00:00Z', value: 100 } : {}) }));
  const one = (pipeline) => creditAgents({ report, approvals, pipeline, now }).find((r) => r.agent === 'om-x');
  const old = one({ leads: before });
  assert.equal(old.leads, 0, 'leads from before the item went out are not credited');
  assert.equal(old.no_result_items, 1, 'all-time leads on the channel do not hide a 14+ day item with no result');
  assert.equal(old.won, 2, 'a sale closed after the item went out is credited by won_at');
  const fresh = one({ leads: [...before, { id: 'L10', channel: 'community', first_seen: '2026-10-20T00:00:00Z' }, { id: 'B', channel: 'community', first_seen: '2026-10-21T00:00:00Z', suspected_bot: true }] });
  assert.equal(fresh.leads, 1);
  assert.equal(fresh.no_result_items, 0);
  // Two agents: a lead is split only across the items already out when it arrived.
  const two = creditAgents({ report, now, approvals: [...approvals, { agent: 'om-y', channel: 'community', status: 'executed', executed_at: '2026-10-25T00:00:00Z' }], pipeline: { leads: [{ channel: 'community', first_seen: '2026-10-20T00:00:00Z' }, { channel: 'community', first_seen: '2026-10-30T00:00:00Z' }] } });
  const by = Object.fromEntries(two.map((r) => [r.agent, r]));
  assert.equal(by['om-x'].leads, 1.5);
  assert.equal(by['om-y'].leads, 0.5);
});

test('the product scorecard is graded from evidence and the backlog ranks the biggest gaps first', () => {
  const base = { products: [], approvals: [], tasks: [], outcomes: [], knowledge: { facts_active: 100, facts_stale: 0, sources_overdue: [], topics_without_facts: [] }, systemAlerts: [], sites: [], keys: [], daemon: { ok: true }, ownerItems: [{ key: 'accounts-and-keys', title: 'Accounts and keys', text: 'ad accounts' }, { key: 'self-serve', title: 'Self-serve sign-up and billing', text: 'not built' }], rosterSize: 100, competitors: null };
  const empty = gradeProduct(base);
  assert.equal(empty.dimensions.find((d) => d.id === 'outcomes').score, 0);
  assert.equal(empty.backlog[0].dimension, 'outcomes', 'no proof of results is the top gap');
  assert.equal(empty.backlog.find((b) => b.id === 'PM-open-accounts-and-keys').owner, 'owner');
  assert.equal(empty.backlog.find((b) => b.id === 'PM-open-self-serve').owner, 'system', 'build work is not pushed onto the owner');
  const live = gradeProduct({ ...base,
    products: [{ slug: 'a', stage: 'growth', domain: 'a.example', autonomy: { earned: true }, funnel: { leads: 40, won: 5, revenue_verified: 500, uncontacted_over_sla: 0 } }],
    approvals: [{ status: 'executed', decided_by: 'policy:earned' }, { status: 'executed', decided_by: 'owner' }],
    competitors: { updated_at: '2026-11-01', features: [{ feature: 'AI SDR', competitors: ['A', 'B'], whalyom: 'yes' }, { feature: 'Native CRM', competitors: ['A'], whalyom: 'no', buyer_impact: 3 }] } });
  assert.equal(live.dimensions.find((d) => d.id === 'outcomes').score, 5);
  assert.equal(live.dimensions.find((d) => d.id === 'autonomy').score, 2.5);
  assert.ok(live.backlog.some((b) => b.id === 'PM-parity-native-crm'));
  assert.ok(live.overall > empty.overall);
});
