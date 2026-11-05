// Budget ledger and channel allocator.
//   node tools/budget.mjs <slug>                       → spend this month, caps, per-channel results, proposed split
//   node tools/budget.mjs <slug> --record <amount> <channel> [--ref id]   → add actual spend to ledger.jsonl
// ledger.jsonl lines: {at, channel, amount, kind: "spend"|"committed_daily", ref}
// The allocator keeps a share for exploration and gives the rest to channels in proportion to
// conversions per unit spent (a simple Thompson-style score with a +1 prior, so new channels get tried).
// Only server-side conversions are scored (Stripe, platform APIs, owner imports): browser-reported
// 'client_conversions' and rows from the satellite snippet never steer the split.
// Spend this month counts ledger rows and platform 'spend' rows in metrics/kpis.json (no double count).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, root } from './lib/env.mjs';

export function readLedger(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// kpis.json next to a ledger: products/<slug>/metrics/kpis.json.
const kpisFileFor = (ledgerFile) => path.join(path.dirname(ledgerFile), 'metrics', 'kpis.json');
const kpiRows = (file, kpis) => (kpis === false ? [] : Array.isArray(kpis) ? kpis : readJson(kpisFileFor(file), []));

// Platform spend per day from kpis rows {date, channel, campaign?, metric: 'spend', value}. A day can
// carry a total row (channel 'all' or no campaign) and finer rows; the larger of the two counts, never both.
export function kpiSpendByDay(rows, month) {
  const days = {};
  for (const r of rows ?? []) {
    if (r?.metric !== 'spend' || !String(r.date ?? '').startsWith(month)) continue;
    const v = Number(r.value); if (!(v > 0)) continue;
    const d = ((days[r.date] ??= {})[r.channel || 'all'] ??= { whole: 0, parts: 0 });
    if (r.campaign) d.parts += v; else d.whole = Math.max(d.whole, v);
  }
  const out = {};
  for (const [date, chans] of Object.entries(days)) {
    const per = Object.fromEntries(Object.entries(chans).map(([c, x]) => [c, Math.max(x.whole, x.parts)]));
    const all = per.all ?? 0; delete per.all;
    const sum = Object.values(per).reduce((s, v) => s + v, 0);
    out[date] = { total: Math.max(all, sum), channels: per };
  }
  return out;
}

// Spend this month = ledger 'spend' rows (owner --record, MCP budget tool) plus platform spend from
// metrics/kpis.json. Both can describe the same money, so per day the larger of the two counts.
// Pass {kpis: false} for the ledger only, or {kpis: rows} to supply the rows.
export function spentThisMonth(file, nowIso = new Date().toISOString(), { kpis } = {}) {
  const month = nowIso.slice(0, 7);
  const ledgerDay = {};
  for (const e of readLedger(file)) if (e.kind === 'spend' && String(e.at).startsWith(month)) { const d = String(e.at).slice(0, 10); ledgerDay[d] = (ledgerDay[d] ?? 0) + Number(e.amount || 0); }
  const kpiDay = kpiSpendByDay(kpiRows(file, kpis), month);
  let total = 0;
  for (const d of new Set([...Object.keys(ledgerDay), ...Object.keys(kpiDay)])) total += Math.max(ledgerDay[d] ?? 0, kpiDay[d]?.total ?? 0);
  return Math.round(total * 100) / 100;
}

// Per-channel spend this month: ledger vs kpis, the larger per channel and day.
export function spendByChannel(file, nowIso = new Date().toISOString(), { kpis } = {}) {
  const month = nowIso.slice(0, 7);
  const led = {};
  for (const e of readLedger(file)) if (e.kind === 'spend' && String(e.at).startsWith(month)) { const k = `${String(e.at).slice(0, 10)}|${e.channel ?? 'unknown'}`; led[k] = (led[k] ?? 0) + Number(e.amount || 0); }
  const kp = {};
  for (const [date, d] of Object.entries(kpiSpendByDay(kpiRows(file, kpis), month))) for (const [c, v] of Object.entries(d.channels)) kp[`${date}|${c}`] = v;
  const out = {};
  for (const k of new Set([...Object.keys(led), ...Object.keys(kp)])) { const c = k.slice(k.indexOf('|') + 1); out[c] = (out[c] ?? 0) + Math.max(led[k] ?? 0, kp[k] ?? 0); }
  return out;
}

// Days left in the month of nowIso (UTC), today included.
export function daysLeftInMonth(nowIso = new Date().toISOString()) {
  const d = new Date(nowIso);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return last - d.getUTCDate() + 1;
}

// Daily money already committed: spend items that are executed (or 'live') and not paused, ended or
// paused by the kill switch, plus any stuck in 'executing'. The daily amount comes from the item's
// committed_daily, else the ledger 'committed_daily' row for that approval, else the approved amount
// (an item created by hand, 'approved-manual', or marked executed with no daily amount counts in full).
const LIVE = new Set(['executed', 'live', 'executing', 'approved-manual']);
export function committedDaily({ approvals = [], ledger = [], killed = [], excludeId } = {}) {
  const fromLedger = {};
  for (const e of ledger) if (e.kind === 'committed_daily' && e.approval) fromLedger[e.approval] = Number(e.amount || 0);
  const killedRefs = new Set(killed.flatMap((k) => [String(k.campaign ?? ''), `${k.channel}|${k.campaign}`]).filter(Boolean));
  let sum = 0;
  for (const a of approvals) {
    if (a?.type !== 'spend' || !LIVE.has(a.status) || (excludeId && a.id === excludeId)) continue;
    if (a.paused_at || a.ended_at || ['paused', 'ended'].includes(a.campaign_status)) continue;
    const ref = String(a.result_ref ?? '');
    if (ref && (killedRefs.has(ref) || killedRefs.has(ref.split('/')[0]) || killedRefs.has(`${a.channel}|${ref}`))) continue;
    const v = Number(a.committed_daily ?? fromLedger[a.id] ?? (['executing', 'executed', 'approved-manual'].includes(a.status) ? a.amount : 0));
    if (v > 0) sum += v;
  }
  return Math.round(sum * 100) / 100;
}

// The executor's cap check for one spend item: the daily total across every live campaign plus this
// one must fit daily_cap, and spend so far plus that daily total for every day left in the month must
// fit monthly_cap. Returns {ok, why, amount, committed, spent, daysLeft, projected}.
export function checkSpendCaps({ item, budget = {}, approvals = [], ledgerFile, now = new Date().toISOString(), killed = [] }) {
  const amount = Number(item?.amount ?? 0);
  const ledger = ledgerFile ? readLedger(ledgerFile) : [];
  const spent = ledgerFile ? spentThisMonth(ledgerFile, now) : 0;
  const committed = committedDaily({ approvals, ledger, killed, excludeId: item?.id });
  const daysLeft = daysLeftInMonth(now);
  const daily = Number(budget.daily_cap ?? 0), monthly = Number(budget.monthly_cap ?? 0);
  const newDaily = Math.round((committed + amount) * 100) / 100;
  const projected = Math.round((spent + newDaily * daysLeft) * 100) / 100;
  let why = '';
  if (!(amount > 0)) why = 'spend item has no amount';
  else if (newDaily > daily) why = `daily total ${newDaily} (live ${committed} + this ${amount}) is over daily_cap ${daily}`;
  else if (projected > monthly) why = `spent ${spent} + ${newDaily}/day x ${daysLeft} day(s) left = ${projected} is over monthly_cap ${monthly}`;
  return { ok: !why, why, amount, committed, spent, daysLeft, projected };
}

// Rows the allocator may score on: server-side conversions and revenue only. Browser beacons can be
// forged, so 'client_conversions' and anything the satellite snippet reported never steer budget.
export const SCORED_METRICS = new Set(['conversions', 'revenue']);
export const isServerSideRow = (k) => SCORED_METRICS.has(k?.metric) && k?.source !== 'satellite';

export function allocate({ monthlyCap, spentSoFar, channels, results, explore = 0.15, microThreshold = 100 }) {
  const left = Math.max(0, monthlyCap - spentSoFar);
  if (!channels.length || left === 0) return { left, split: {}, mode: 'none' };
  const score = (c) => { const r = results[c] ?? { spend: 0, conversions: 0 }; return (r.conversions + 1) / (r.spend + 10); };
  // Micro-budget sniper rule: a small budget is never spread thin. All of it goes to the single
  // channel with the best score; on a tie, the first channel in the preset's priority order.
  if (monthlyCap <= microThreshold) {
    const best = channels.reduce((b, c) => (score(c) > score(b) ? c : b), channels[0]);
    return { left, split: { [best]: Math.round(left * 100) / 100 }, mode: 'sniper' };
  }
  const total = channels.reduce((s, c) => s + score(c), 0);
  const split = {};
  for (const c of channels) split[c] = Math.round((left * explore / channels.length + left * (1 - explore) * (score(c) / total)) * 100) / 100;
  return { left, split, mode: 'portfolio' };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const slug = args[0];
  if (!slug) { console.error('Usage: node tools/budget.mjs <slug> [--record <amount> <channel> [--ref id]]'); process.exit(2); }
  const dir = path.join(root, 'products', slug);
  const ledgerFile = path.join(dir, 'ledger.jsonl');
  const product = readJson(path.join(dir, 'product.json'), {});
  const now = new Date().toISOString();

  const ri = args.indexOf('--record');
  if (ri > -1) {
    const amount = Number(args[ri + 1]); const channel = args[ri + 2] ?? 'unknown';
    const refIdx = args.indexOf('--ref');
    if (!(amount > 0)) { console.error('amount must be > 0'); process.exit(2); }
    fs.appendFileSync(ledgerFile, JSON.stringify({ at: now, channel, amount, kind: 'spend', ref: refIdx > -1 ? args[refIdx + 1] : '' }) + '\n');
  }

  const b = product.budget ?? {};
  const spent = spentThisMonth(ledgerFile, now);
  // Per-channel results. Spend: ledger and platform kpis 'spend' rows (the larger per day, never both).
  // Conversions: server-side 'conversions' rows only; 'client_conversions' and satellite rows are ignored.
  const results = {};
  for (const [c, v] of Object.entries(spendByChannel(ledgerFile, now))) (results[c] ??= { spend: 0, conversions: 0 }).spend += Math.round(v * 100) / 100;
  for (const k of readJson(path.join(dir, 'metrics', 'kpis.json'), [])) if (k.metric === 'conversions' && isServerSideRow(k) && k.channel) (results[k.channel] ??= { spend: 0, conversions: 0 }).conversions += Number(k.value || 0);
  const channels = product.channels?.paid?.length ? product.channels.paid : (product.channels?.paid_candidates ?? []);
  const plan = allocate({ monthlyCap: Number(b.monthly_cap ?? 0), spentSoFar: spent, channels, results, microThreshold: Number(b.micro_threshold ?? 100) });

  product.budget = { ...b, spent_this_month: Math.round(spent * 100) / 100 };
  writeJson(path.join(dir, 'product.json'), product);
  const report = { slug, currency: b.currency ?? 'USD', monthly_cap: b.monthly_cap ?? 0, daily_cap: b.daily_cap ?? 0, spent_this_month: product.budget.spent_this_month, left: plan.left, allocation_mode: plan.mode, results, proposed_split: plan.split, at: now };
  writeJson(path.join(dir, 'budget-plan.json'), report);
  console.log(JSON.stringify(report));
}
