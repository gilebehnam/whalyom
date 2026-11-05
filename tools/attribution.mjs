// Multi-touch attribution and MMM-lite: which channels and campaigns earn the leads, sales and revenue.
// Two views, both read-only on the ledgers and both deterministic for the same inputs and `now`:
//   1. Touch attribution over the funnel ledger (products/<slug>/funnel/pipeline.json, written only by
//      tools/funnel.mjs). Every lead row carries touches [{at, channel, campaign}] and a stage history;
//      a lead is one "lead" conversion at first_seen and one "sale" per won entry (repeat orders count),
//      the lead's value split over them as revenue. Credit goes to the touches at or before the conversion
//      inside the lookback window (default 90 days) under five models: first_touch, last_touch, linear,
//      position_based (40/20/40) and time_decay (7-day half-life). Suspected bots and leads erased or with
//      consent withdrawn are left out. Times without a zone are read as UTC.
//   2. MMM-lite over products/<slug>/metrics/kpis.json rows {date, channel, campaign?, metric, value}:
//      weekly spend per channel (metric spend|cost|ad_spend|media_spend) against one weekly outcome
//      (revenue, else conversions|sales|leads|signups: the week's all-channel total row when there is
//      one, else the sum of per-channel rows, never both). Each channel's spend
//      goes through geometric adstock and Hill saturation; the adstock decay, half-saturation point and
//      Hill shape are chosen by a small coordinate grid search, the weights by non-negative least
//      squares. It reports contribution, ROI (or cost per outcome) and marginal ROI per channel with an
//      honest R², adjusted R² and a confidence label. Under 12 weeks it returns "not_enough_data" and
//      no numbers. The model is correlational, never causal: it ranks channels, it does not prove lift.
// Writes, per product:
//   products/<slug>/reports/attribution.json   both views (no lead ids, emails or other personal data)
//   products/<slug>/reports/attribution.md     the same for people
//   products/<slug>/runs/<task-id>.json        only with --task: the result file for apply-results.mjs,
//                                               carrying any budget shift as a PENDING approval
//   state/attribution.json                     only with --all: per-product summary for the dashboard
// Nothing outbound: this tool never changes spend. A budget shift is only ever a pending approval entry
// (type "budget_shift"), proposed when the model is not low-confidence, the product is in paid or hybrid
// mode with a monthly cap above 100 (sniper budgets stay on one channel), and the shift keeps total
// monthly spend unchanged and within cap.
// No network access.
// Usage: node tools/attribution.mjs <slug> [--task <task-id>] [--lookback <days>] [--outcome <metric>]
//        node tools/attribution.mjs --all              every product, then state/attribution.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, root as repoRoot } from './lib/env.mjs';

export const MODELS = ['first_touch', 'last_touch', 'linear', 'position_based', 'time_decay'];
export const MIN_WEEKS = 12;
export const HALF_LIFE_DAYS = 7;
export const SPEND_METRICS = ['spend', 'cost', 'ad_spend', 'media_spend'];
export const OUTCOME_METRICS = ['revenue', 'conversions', 'sales', 'leads', 'signups'];
const DAY = 86400000;
// Grid for the MMM search. Half-saturation is a fraction of the channel's largest weekly adstock.
export const GRID = { decay: [0, 0.3, 0.5, 0.7], half_sat: [0.25, 0.5, 1], shape: [1, 2] };

const round = (n, d = 2) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
// Channel and campaign names come from UTM tags anyone can type: an email address or a phone number in
// one is replaced, so no personal data reaches the reports or state/. Phones need a leading "+", so
// dates and campaign ids in names are kept.
const PII = /[^\s@|/]+@[^\s@|/]+\.[a-z]{2,}|\+\d[\d\s().-]{6,}\d/gi;
const scrub = (s) => String(s ?? '').replace(PII, 'redacted');
const norm = (s, d = 'direct') => scrub(s).trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || d;
const campaignOf = (s) => scrub(s).trim().slice(0, 80);
// Timestamps without a zone ("2026-01-05 10:00") are read as UTC, so results never depend on the host's
// time zone. Dates before 2000 are treated as malformed.
const ts = (s) => {
  if (s == null || s === '') return null;
  let v = typeof s === 'number' ? s : String(s).trim();
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(v)) v = `${v.replace(' ', 'T')}Z`;
  const t = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(t) && t >= Date.UTC(2000, 0, 1) ? t : null;
};
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
export const weekOf = (iso) => { const t = ts(iso); if (t == null) return null; const d = new Date(t); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

// ---------------------------------------------------------------- touch attribution

// Weights for n ordered touches with their ages in days before the conversion. Always sums to 1.
export function modelWeights(model, ages) {
  const n = ages.length;
  if (!n) return [];
  if (n === 1) return [1];
  switch (model) {
    case 'first_touch': return ages.map((_, i) => (i === 0 ? 1 : 0));
    case 'last_touch': return ages.map((_, i) => (i === n - 1 ? 1 : 0));
    case 'linear': return ages.map(() => 1 / n);
    case 'position_based':
      if (n === 2) return [0.5, 0.5];
      return ages.map((_, i) => (i === 0 || i === n - 1 ? 0.4 : 0.2 / (n - 2)));
    case 'time_decay': {
      const raw = ages.map((a) => 2 ** (-Math.max(0, a) / HALF_LIFE_DAYS));
      const s = raw.reduce((x, y) => x + y, 0);
      return raw.map((w) => w / s);
    }
    default: throw new Error(`unknown attribution model "${model}"`);
  }
}

// Ordered, de-duplicated, valid touches of one lead (falls back to its channel and first_seen).
export function leadTouches(lead) {
  const raw = Array.isArray(lead?.touches) && lead.touches.length ? lead.touches : [{ at: lead?.first_seen, channel: lead?.channel, campaign: lead?.campaign }];
  const seen = new Set();
  const out = [];
  for (const t of raw) {
    const at = ts(t?.at);
    if (at == null) continue;
    const ch = norm(t.channel ?? t.utm?.source);
    const camp = campaignOf(t.campaign ?? t.utm?.campaign);
    const key = `${at}|${ch}|${camp}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ at, channel: ch, campaign: camp });
  }
  return out.sort((a, b) => a.at - b.at || a.channel.localeCompare(b.channel) || a.campaign.localeCompare(b.campaign));
}

// The conversions in one lead row: a lead at first_seen, and a sale (with revenue) at the first won entry.
export function leadConversions(lead) {
  const touches = leadTouches(lead);
  const firstSeen = ts(lead?.first_seen) ?? touches[0]?.at ?? null;
  const conv = [];
  if (firstSeen != null) conv.push({ kind: 'lead', at: firstSeen, revenue: 0 });
  const won = (Array.isArray(lead?.history) ? lead.history : []).filter((h) => h?.stage === 'won' && ts(h.at) != null).sort((a, b) => ts(a.at) - ts(b.at));
  if (won.length) {
    // One sale per won entry, so a repeat order is credited to the touches before that order. The lead's
    // value is the total: any part of it the entries do not carry goes to the first order.
    const vals = won.map((h) => Math.max(0, num(h.value) ?? 0));
    const fromHistory = vals.reduce((a, b) => a + b, 0);
    const value = num(lead.value);
    const total = value != null && value >= 0 ? value : fromHistory;
    let left = total;
    won.forEach((h, i) => {
      const want = i === won.length - 1 ? left : vals[i] + (i === 0 ? Math.max(0, total - fromHistory) : 0);
      const revenue = Math.max(0, Math.min(left, want));
      left -= revenue;
      conv.push({ kind: 'sale', at: ts(h.at), revenue, verified: h.verified ? Math.min(vals[i], revenue) : 0 });
    });
  }
  return { touches, conversions: conv };
}

// Pure. pipeline: {leads: [...]} (funnel/pipeline.json). opts: {lookbackDays = 90}.
// Returns {totals, models: {<model>: {channels, campaigns}}, comparison, notes}.
export function attributeTouches(pipeline, { lookbackDays = 90 } = {}) {
  const look = Math.max(1, Number(lookbackDays) || 90) * DAY;
  const leads = Array.isArray(pipeline?.leads) ? pipeline.leads : Array.isArray(pipeline) ? pipeline : [];
  const valid = leads.filter((r) => r && typeof r === 'object');
  // Leads erased on request (GDPR) or with consent withdrawn are left out of the analysis entirely.
  const isErased = (r) => Boolean(r.erased || r.deleted || r.consent === 'withdrawn');
  const real = valid.filter((r) => !r.suspected_bot && !isErased(r));
  const acc = Object.fromEntries(MODELS.map((m) => [m, { ch: {}, camp: {} }]));
  const totals = { leads_in_ledger: leads.length, suspected_bots: valid.filter((r) => r.suspected_bot && !isErased(r)).length, erased_or_withdrawn: valid.filter(isErased).length, leads: 0, sales: 0, revenue: 0, verified_revenue: 0, touches: 0, leads_without_touches: 0, conversions_without_touch_in_window: 0, avg_touches_per_sale: null };
  let saleTouches = 0;
  const add = (m, t, kind, w, revenue) => {
    const c = (acc[m].ch[t.channel] ??= { channel: t.channel, leads: 0, sales: 0, revenue: 0 });
    const k = `${t.channel}|${t.campaign}`;
    const p = t.campaign ? (acc[m].camp[k] ??= { channel: t.channel, campaign: t.campaign, leads: 0, sales: 0, revenue: 0 }) : null;
    for (const row of p ? [c, p] : [c]) {
      if (kind === 'lead') row.leads += w;
      else { row.sales += w; row.revenue += w * revenue; }
    }
  };
  for (const lead of real) {
    const { touches, conversions } = leadConversions(lead);
    totals.touches += touches.length;
    if (!Array.isArray(lead.touches) || !lead.touches.length) totals.leads_without_touches++;
    for (const cv of conversions) {
      if (cv.kind === 'lead') totals.leads++;
      else { totals.sales++; totals.revenue += cv.revenue; totals.verified_revenue += cv.verified; }
      let path = touches.filter((t) => t.at <= cv.at && cv.at - t.at <= look);
      if (!path.length) {
        // No touch in the window: credit the earliest touch so totals still add up, and say so.
        totals.conversions_without_touch_in_window++;
        path = touches.length ? [touches[0]] : [{ at: cv.at, channel: norm(lead.channel), campaign: campaignOf(lead.campaign) }];
      }
      if (cv.kind === 'sale') saleTouches += path.length;
      const ages = path.map((t) => (cv.at - t.at) / DAY);
      for (const m of MODELS) modelWeights(m, ages).forEach((w, i) => { if (w > 0) add(m, path[i], cv.kind, w, cv.revenue); });
    }
  }
  totals.revenue = round(totals.revenue);
  totals.verified_revenue = round(totals.verified_revenue);
  totals.avg_touches_per_sale = totals.sales ? round(saleTouches / totals.sales, 2) : null;
  const fmt = (r) => ({ ...r, leads: round(r.leads, 3), sales: round(r.sales, 3), revenue: round(r.revenue, 2) });
  const order = (a, b) => b.revenue - a.revenue || b.sales - a.sales || b.leads - a.leads || a.channel.localeCompare(b.channel) || String(a.campaign ?? '').localeCompare(String(b.campaign ?? ''));
  const models = Object.fromEntries(MODELS.map((m) => [m, {
    channels: Object.values(acc[m].ch).map(fmt).sort(order),
    campaigns: Object.values(acc[m].camp).map(fmt).sort(order),
  }]));
  // One row per channel: revenue and sales credited under each model, plus the spread between models.
  const names = [...new Set(MODELS.flatMap((m) => models[m].channels.map((c) => c.channel)))].sort();
  const comparison = names.map((channel) => {
    const row = { channel };
    for (const m of MODELS) { const c = models[m].channels.find((x) => x.channel === channel); row[m] = { leads: c?.leads ?? 0, sales: c?.sales ?? 0, revenue: c?.revenue ?? 0 }; }
    const revs = MODELS.map((m) => row[m].revenue);
    row.revenue_spread = round(Math.max(...revs) - Math.min(...revs));
    row.role = row.first_touch.revenue > row.last_touch.revenue * 1.25 ? 'opener' : row.last_touch.revenue > row.first_touch.revenue * 1.25 ? 'closer' : 'balanced';
    return row;
  }).sort((a, b) => b.linear.revenue - a.linear.revenue || b.linear.leads - a.linear.leads || a.channel.localeCompare(b.channel));
  const notes = [];
  if (!totals.leads) notes.push('No leads in the funnel ledger yet: run node tools/funnel.mjs <slug> first.');
  if (totals.leads && !totals.sales) notes.push('Leads but no won sales yet: lead credit only, sales and revenue credit are empty.');
  if (totals.conversions_without_touch_in_window) notes.push(`${totals.conversions_without_touch_in_window} conversion(s) had no touch inside the ${Math.round(look / DAY)}-day lookback; their earliest touch got the credit.`);
  if (totals.revenue > totals.verified_revenue) notes.push(`Only ${totals.verified_revenue} of ${totals.revenue} revenue is verified by a payment or CRM source.`);
  return { lookback_days: Math.round(look / DAY), totals, models, comparison, notes };
}

// ---------------------------------------------------------------- MMM-lite

export function adstock(xs, decay) {
  const out = new Array(xs.length);
  let carry = 0;
  for (let i = 0; i < xs.length; i++) { carry = xs[i] + decay * carry; out[i] = carry; }
  return out;
}
export const hill = (x, k, s) => (x <= 0 || k <= 0 ? 0 : x ** s / (x ** s + k ** s));

// Solves A x = b (small dense system) by Gaussian elimination with partial pivoting; null if singular.
export function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// Least squares y ~ b0 + sum beta_j X_j with beta_j >= 0 (drops negative weights and refits).
// X: array of columns. Returns {intercept, betas, fitted, sse} or null.
export function fitNonNegative(X, y) {
  const n = y.length;
  let active = X.map((_, j) => j);
  for (let guard = 0; guard <= X.length; guard++) {
    const cols = [new Array(n).fill(1), ...active.map((j) => X[j])];
    const p = cols.length;
    const A = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, k) => cols[i].reduce((s, v, t) => s + v * cols[k][t], 0)));
    // Tiny ridge on the media weights keeps near-collinear channels solvable without moving the fit.
    for (let i = 1; i < p; i++) A[i][i] += 1e-9 * (A[i][i] || 1);
    const b = cols.map((c) => c.reduce((s, v, t) => s + v * y[t], 0));
    const sol = solve(A, b);
    if (!sol) return null;
    const neg = active.filter((_, i) => sol[i + 1] < 0);
    if (neg.length) { active = active.filter((j) => !neg.includes(j)); continue; }
    const betas = X.map(() => 0);
    active.forEach((j, i) => { betas[j] = sol[i + 1]; });
    const fitted = y.map((_, t) => sol[0] + X.reduce((s, col, j) => s + betas[j] * col[t], 0));
    const sse = y.reduce((s, v, t) => s + (v - fitted[t]) ** 2, 0);
    return { intercept: sol[0], betas, fitted, sse };
  }
  return null;
}

// Weekly series from kpis rows. Returns {weeks, spend: {channel: []}, outcome: [], outcome_metric, skipped}.
export function weeklySeries(kpis, { outcome = null, now = null } = {}) {
  // Rows dated more than a week after `now` are typos, not data: they would stretch the series.
  const limit = ts(now) != null ? ts(now) + 7 * DAY : Infinity;
  const rows = Array.isArray(kpis) ? kpis : Array.isArray(kpis?.rows) ? kpis.rows : [];
  let skipped = 0;
  const spend = {};
  const outcomes = {};
  const weeks = new Set();
  for (const r of rows) {
    const metric = String(r?.metric ?? '').trim().toLowerCase();
    const wk = weekOf(r?.date ?? r?.at ?? r?.week);
    const v = num(r?.value);
    if (!wk || v == null || v < 0 || !metric || Date.parse(wk) > limit) { skipped++; continue; }
    if (SPEND_METRICS.includes(metric)) {
      const ch = norm(r.channel, '');
      if (!ch || ch === 'all' || ch === 'total') { skipped++; continue; }
      (spend[ch] ??= {})[wk] = (spend[ch][wk] ?? 0) + v;
      weeks.add(wk);
    } else if (OUTCOME_METRICS.includes(metric)) {
      // A week with an all-channel total row (Stripe revenue, for one) uses the total; per-channel rows
      // are summed only when no total exists, so the same revenue is never counted twice.
      const ch = norm(r.channel, 'all');
      const slot = ((outcomes[metric] ??= {})[wk] ??= { total: null, parts: 0 });
      if (ch === 'all' || ch === 'total') slot.total = (slot.total ?? 0) + v;
      else slot.parts += v;
      weeks.add(wk);
    }
  }
  const val = (slot) => (slot ? slot.total ?? slot.parts : 0);
  const want = outcome ? String(outcome).toLowerCase() : OUTCOME_METRICS.find((m) => Object.values(outcomes[m] ?? {}).some((v) => val(v) > 0)) ?? null;
  const list = [...weeks].sort();
  // Contiguous Monday weeks from first to last, with zeros where nothing was reported.
  const all = [];
  if (list.length) for (let t = Date.parse(list[0]); t <= Date.parse(list.at(-1)); t += 7 * DAY) all.push(new Date(t).toISOString().slice(0, 10));
  const series = Object.fromEntries(Object.keys(spend).sort().map((ch) => [ch, all.map((w) => spend[ch][w] ?? 0)]));
  return { weeks: all, spend: series, outcome: all.map((w) => val(outcomes[want]?.[w])), outcome_metric: want, skipped };
}

const transform = (xs, { decay, k, shape }) => adstock(xs, decay).map((a) => hill(a, k, shape));

// Pure. kpis: metrics/kpis.json rows. opts: {outcome, minWeeks = 12, maxChannels}.
export function mmmLite(kpis, { outcome = null, minWeeks = MIN_WEEKS, maxChannels = null, now = null } = {}) {
  const s = weeklySeries(kpis, { outcome, now });
  const n = s.weeks.length;
  const base = { status: 'ok', weeks: n, min_weeks: minWeeks, outcome_metric: s.outcome_metric, first_week: s.weeks[0] ?? null, last_week: s.weeks.at(-1) ?? null, rows_skipped: s.skipped };
  const totalSpend = Object.values(s.spend).flat().reduce((a, b) => a + b, 0);
  if (n < minWeeks) return { ...base, status: 'not_enough_data', reason: `${n} week(s) of data; MMM-lite needs at least ${minWeeks} weeks of spend and outcome rows.` };
  if (!s.outcome_metric || !s.outcome.some((v) => v > 0)) return { ...base, status: 'not_enough_data', reason: 'No outcome rows (revenue, conversions, sales, leads or signups) with a value above zero.' };
  if (!(totalSpend > 0)) return { ...base, status: 'not_enough_data', reason: 'No spend rows per channel: nothing to model.' };
  // Keep the parameter count honest: at most one channel per 4 weeks; the smallest spenders become "other".
  const cap = Math.max(1, Math.min(maxChannels ?? Infinity, Math.floor(n / 4)));
  let channels = Object.entries(s.spend).filter(([, xs]) => xs.some((v) => v > 0)).sort((a, b) => b[1].reduce((x, y) => x + y, 0) - a[1].reduce((x, y) => x + y, 0) || a[0].localeCompare(b[0]));
  const merged = [];
  if (channels.length > cap) {
    const rest = channels.slice(cap - 1);
    merged.push(...rest.map(([c]) => c));
    channels = [...channels.slice(0, cap - 1), ['other', s.weeks.map((_, t) => rest.reduce((sum, [, xs]) => sum + xs[t], 0))]];
  }
  const names = channels.map(([c]) => c);
  const xs = channels.map(([, v]) => v);
  const maxAd = (x, decay) => Math.max(...adstock(x, decay));
  // Parameters per channel, starting at the middle of the grid, tuned by coordinate descent (3 passes).
  const params = names.map((_, j) => ({ decay: GRID.decay[1], half_sat: GRID.half_sat[1], shape: GRID.shape[0], x: xs[j] }));
  const kOf = (p) => p.half_sat * maxAd(p.x, p.decay);
  const design = (ps) => ps.map((p) => transform(p.x, { decay: p.decay, k: kOf(p), shape: p.shape }));
  let best = fitNonNegative(design(params), s.outcome);
  if (!best) return { ...base, status: 'fit_failed', reason: 'The least-squares system was singular (spend series are constant or identical).' };
  for (let pass = 0; pass < 3; pass++) {
    let improved = false;
    for (let j = 0; j < params.length; j++) {
      for (const decay of GRID.decay) for (const half_sat of GRID.half_sat) for (const shape of GRID.shape) {
        const trial = params.map((p, i) => (i === j ? { ...p, decay, half_sat, shape } : p));
        const f = fitNonNegative(design(trial), s.outcome);
        if (f && f.sse < best.sse - 1e-9 * (1 + best.sse)) { best = f; params[j] = trial[j]; improved = true; }
      }
    }
    if (!improved) break;
  }
  const y = s.outcome;
  const mean = y.reduce((a, b) => a + b, 0) / n;
  const sst = y.reduce((a, v) => a + (v - mean) ** 2, 0);
  const p = best.betas.filter((b) => b > 0).length;
  const r2 = sst > 0 ? 1 - best.sse / sst : null;
  const adj = r2 != null && n - p - 1 > 0 ? 1 - (1 - r2) * (n - 1) / (n - p - 1) : null;
  const nz = y.filter((v) => v > 0);
  const mape = nz.length ? (y.reduce((a, v, t) => a + (v > 0 ? Math.abs(v - best.fitted[t]) / v : 0), 0) / nz.length) * 100 : null;
  const revenue = s.outcome_metric === 'revenue';
  const X = design(params);
  const totalOutcome = y.reduce((a, b) => a + b, 0);
  const rows = names.map((channel, j) => {
    const pr = params[j];
    const k = kOf(pr);
    const spendSum = pr.x.reduce((a, b) => a + b, 0);
    const contribution = best.betas[j] * X[j].reduce((a, b) => a + b, 0);
    // Marginal: 10% more spend every week, same saturation point (k is absolute).
    const more = transform(pr.x.map((v) => v * 1.1), { decay: pr.decay, k, shape: pr.shape });
    const marginal = spendSum > 0 ? (best.betas[j] * more.reduce((a, b) => a + b, 0) - contribution) / (0.1 * spendSum) : null;
    const last4 = pr.x.slice(-4);
    return {
      channel, spend: round(spendSum), contribution: round(contribution), share_of_outcome_pct: totalOutcome > 0 ? round((100 * contribution) / totalOutcome, 1) : null,
      ...(revenue ? { roi: spendSum > 0 ? round(contribution / spendSum, 3) : null, marginal_roi: round(marginal, 3) } : { cost_per_outcome: contribution > 0 ? round(spendSum / contribution, 2) : null, marginal_outcome_per_unit: round(marginal, 4) }),
      monthly_spend_now: round((last4.reduce((a, b) => a + b, 0) / Math.max(1, last4.length)) * 4.345),
      weight: round(best.betas[j], 4), adstock_decay: pr.decay, half_saturation: round(k, 2), hill_shape: pr.shape,
      saturation_now_pct: round(100 * hill(adstock(pr.x, pr.decay).at(-1), k, pr.shape), 1),
      dropped: best.betas[j] === 0,
    };
  }).sort((a, b) => b.contribution - a.contribution || a.channel.localeCompare(b.channel));
  const confidence = r2 == null || r2 < 0.3 || adj == null || adj < 0.2 ? 'low' : n < 26 || adj < 0.5 ? 'medium' : 'high';
  const notes = ['Correlational model over weekly totals: use it to rank channels and design lift tests, not as proof of causation.'];
  if (merged.length) notes.push(`Too few weeks for every channel: ${merged.join(', ')} were merged into "other" (one channel per 4 weeks).`);
  if (rows.some((r) => r.dropped)) notes.push(`No positive link found for ${rows.filter((r) => r.dropped).map((r) => r.channel).join(', ')}: weight set to zero.`);
  if (confidence === 'low') notes.push('Low confidence: the fit explains little of the weekly variation. Do not move budget on this alone.');
  if (!revenue) notes.push(`Outcome is ${s.outcome_metric}, not revenue: read cost per outcome instead of ROI.`);
  return {
    ...base, channels_modelled: names.length, merged_into_other: merged,
    fit: { r2: round(r2, 3), adj_r2: round(adj, 3), mape_pct: round(mape, 1), rmse: round(Math.sqrt(best.sse / n), 2), parameters: 1 + p + 3 * names.length },
    confidence, baseline: { per_week: round(best.intercept), total: round(best.intercept * n), share_of_outcome_pct: totalOutcome > 0 ? round((100 * best.intercept * n) / totalOutcome, 1) : null },
    total_outcome: round(totalOutcome), total_spend: round(totalSpend), channels: rows, notes,
  };
}

// ---------------------------------------------------------------- proposals (never executed)

// Budget shift as a pending approval proposal, or null with the reason. Total monthly spend stays the same.
export function proposeBudgetShift(mmm, product = {}, { slug = '', fraction = 0.1 } = {}) {
  const b = product?.budget ?? {};
  const cap = num(b.monthly_cap) ?? 0;
  const why = (reason) => ({ proposal: null, reason });
  if (mmm?.status !== 'ok') return why('MMM-lite has no result.');
  if (mmm.confidence === 'low') return why('MMM-lite confidence is low.');
  if (!['paid', 'hybrid'].includes(String(b.mode ?? 'free'))) return why('Free mode: no paid budget to shift.');
  if (!(cap > 0)) return why('Monthly cap is 0: nothing to shift.');
  if (cap <= 100) return why('Sniper mode (monthly cap of 100 or less): one channel only, no shift between channels.');
  const key = mmm.outcome_metric === 'revenue' ? 'marginal_roi' : 'marginal_outcome_per_unit';
  const live = mmm.channels.filter((c) => c.channel !== 'other' && c.monthly_spend_now > 0 && Number.isFinite(c[key]));
  if (live.length < 2) return why('Needs two named channels with current spend.');
  const sorted = [...live].sort((a, b) => b[key] - a[key] || a.channel.localeCompare(b.channel));
  const to = sorted[0];
  const from = sorted.at(-1);
  if (!(to[key] > Math.max(0, from[key]) * 1.2)) return why('Marginal returns are too close to justify a shift.');
  const totalNow = mmm.channels.reduce((s, c) => s + (c.monthly_spend_now ?? 0), 0);
  if (totalNow > cap) return why(`Current monthly spend ${round(totalNow)} is above the cap ${cap}: reduce spend first.`);
  const amount = round(Math.min(from.monthly_spend_now * fraction, cap * fraction));
  if (!(amount > 0)) return why('Shift amount rounds to zero.');
  const currency = String(b.currency ?? 'USD').toUpperCase();
  return {
    reason: null,
    proposal: {
      id: `A-MMM-${norm(slug, 'product')}-${mmm.last_week}`,
      type: 'budget_shift',
      title: `Move ${amount} ${currency}/month from ${from.channel} to ${to.channel} (MMM-lite marginal ${key === 'marginal_roi' ? 'ROI' : 'return'} ${from[key]} vs ${to[key]}, ${mmm.confidence} confidence)`,
      file: 'reports/attribution.md',
      channel: to.channel, from_channel: from.channel, amount, currency,
      total_monthly_spend_unchanged: round(totalNow), monthly_cap: cap,
      status: 'pending', requires_approval: true,
    },
  };
}

// ---------------------------------------------------------------- report

export function buildReport({ pipeline, kpis, product = {}, slug = '', now = new Date().toISOString(), lookbackDays = 90, outcome = null } = {}) {
  const touch = attributeTouches(pipeline, { lookbackDays });
  const mmm = mmmLite(kpis, { outcome, now });
  const shift = proposeBudgetShift(mmm, product, { slug });
  const currency = String(product?.budget?.currency ?? (pipeline?.leads ?? []).find((l) => l?.currency)?.currency ?? 'USD').toUpperCase();
  return { product: slug, updated_at: now, currency, attribution: touch, mmm, approvals: shift.proposal ? [shift.proposal] : [], budget_shift_note: shift.reason };
}

export function reportMarkdown(rep) {
  const a = rep.attribution;
  const t = a.totals;
  const L = [`# Attribution and MMM-lite: ${rep.product}`, '', `Updated ${rep.updated_at}. Currency ${rep.currency}. Lookback ${a.lookback_days} days.`, '',
    `Leads ${t.leads} · sales ${t.sales} · revenue ${t.revenue} (verified ${t.verified_revenue}) · touches ${t.touches} · avg touches per sale ${t.avg_touches_per_sale ?? '–'} · bots excluded ${t.suspected_bots}`, '',
    '## Revenue credit per channel and model', '', '| Channel | First | Last | Linear | 40/20/40 | Time decay | Role |', '|---|---|---|---|---|---|---|',
    ...(a.comparison.length ? a.comparison.map((c) => `| ${c.channel} | ${MODELS.map((m) => `${c[m].revenue} (${c[m].sales} sales, ${c[m].leads} leads)`).join(' | ')} | ${c.role} |`) : ['| – | – | – | – | – | – | – |']),
    '', '## Top campaigns (linear)', '', ...(a.models.linear.campaigns.length ? a.models.linear.campaigns.slice(0, 15).map((c) => `- ${c.channel} / ${c.campaign}: ${c.revenue} revenue, ${c.sales} sales, ${c.leads} leads`) : ['- No campaign tags on touches yet.']),
    '', ...a.notes.map((n) => `> ${n}`), '', '## MMM-lite', ''];
  const m = rep.mmm;
  if (m.status !== 'ok') L.push(`**${m.status.replace(/_/g, ' ')}**: ${m.reason}`);
  else {
    L.push(`${m.weeks} weeks (${m.first_week} to ${m.last_week}), outcome **${m.outcome_metric}**. R² ${m.fit.r2}, adjusted R² ${m.fit.adj_r2}, MAPE ${m.fit.mape_pct ?? '–'}%. Confidence **${m.confidence}**. Baseline ${m.baseline.share_of_outcome_pct ?? '–'}% of the outcome.`, '');
    const rev = m.outcome_metric === 'revenue';
    L.push(`| Channel | Spend | Contribution | Share | ${rev ? 'ROI | Marginal ROI' : 'Cost per outcome | Marginal per unit'} | Decay | Saturation now |`, '|---|---|---|---|---|---|---|---|');
    for (const c of m.channels) L.push(`| ${c.channel}${c.dropped ? ' (no link)' : ''} | ${c.spend} | ${c.contribution} | ${c.share_of_outcome_pct ?? '–'}% | ${rev ? `${c.roi ?? '–'} | ${c.marginal_roi ?? '–'}` : `${c.cost_per_outcome ?? '–'} | ${c.marginal_outcome_per_unit ?? '–'}`} | ${c.adstock_decay} | ${c.saturation_now_pct}% |`);
    L.push('', ...m.notes.map((n) => `> ${n}`));
  }
  L.push('', '## Budget proposals (pending approval, nothing changed)', '', ...(rep.approvals.length ? rep.approvals.map((p) => `- ${p.title}`) : [`- None: ${rep.budget_shift_note}`]), '');
  return L.join('\n');
}

const slugsIn = (base) => {
  const dir = path.join(base, 'products');
  return (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((s) => !s.startsWith('_') && fs.existsSync(path.join(dir, s, 'product.json'))).sort();
};

// Reads one product, writes its reports (and the run file with taskId). base: repo root (tests pass a temp dir).
export function runAttribution(slug, { base = repoRoot, now = new Date().toISOString(), taskId = null, lookbackDays = 90, outcome = null } = {}) {
  if (!slug || !/^[a-z0-9][a-z0-9_-]*$/i.test(slug)) throw new Error(`invalid product slug "${slug}"`);
  const dir = path.join(base, 'products', slug);
  if (!fs.existsSync(path.join(dir, 'product.json'))) throw new Error(`no product at products/${slug}`);
  const rep = buildReport({
    pipeline: readJson(path.join(dir, 'funnel', 'pipeline.json'), { leads: [] }),
    kpis: readJson(path.join(dir, 'metrics', 'kpis.json'), []),
    product: readJson(path.join(dir, 'product.json'), {}), slug, now, lookbackDays, outcome,
  });
  fs.mkdirSync(path.join(dir, 'reports'), { recursive: true });
  writeJson(path.join(dir, 'reports', 'attribution.json'), rep);
  fs.writeFileSync(path.join(dir, 'reports', 'attribution.md'), reportMarkdown(rep));
  if (taskId) {
    if (!/^[A-Za-z0-9_.-]+$/.test(taskId)) throw new Error(`invalid task id "${taskId}"`);
    fs.mkdirSync(path.join(dir, 'runs'), { recursive: true });
    const m = rep.mmm;
    writeJson(path.join(dir, 'runs', `${taskId}.json`), {
      task_id: taskId, agent: 'om-mmm-lite', status: 'done', output: ['reports/attribution.json', 'reports/attribution.md'],
      summary: `Attribution over ${rep.attribution.totals.leads} leads and ${rep.attribution.totals.sales} sales; MMM-lite ${m.status === 'ok' ? `R² ${m.fit.r2} (${m.confidence}) over ${m.weeks} weeks` : m.status}.`,
      approvals: rep.approvals.map(({ status, requires_approval, ...a }) => a),
    });
  }
  return rep;
}

export function runAll({ base = repoRoot, now = new Date().toISOString() } = {}) {
  const products = [];
  for (const slug of slugsIn(base)) {
    const r = runAttribution(slug, { base, now });
    products.push({ product: slug, currency: r.currency, totals: r.attribution.totals, top_channels: r.attribution.comparison.slice(0, 8).map((c) => ({ channel: c.channel, role: c.role, linear: c.linear, time_decay: c.time_decay })), mmm: { status: r.mmm.status, weeks: r.mmm.weeks, r2: r.mmm.fit?.r2 ?? null, confidence: r.mmm.confidence ?? null, channels: (r.mmm.channels ?? []).map(({ channel, spend, contribution, roi, cost_per_outcome }) => ({ channel, spend, contribution, roi, cost_per_outcome })) }, pending_proposals: r.approvals.length });
  }
  fs.mkdirSync(path.join(base, 'state'), { recursive: true });
  writeJson(path.join(base, 'state', 'attribution.json'), { updated_at: now, products });
  return { products: products.length, with_sales: products.filter((p) => p.totals.sales > 0).length, mmm_ok: products.filter((p) => p.mmm.status === 'ok').length };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : null; };
  try {
    if (args.includes('--all')) console.log(JSON.stringify(runAll()));
    else {
      const slug = args.find((a, i) => !a.startsWith('--') && !['--task', '--lookback', '--outcome'].includes(args[i - 1]));
      if (!slug) { console.error('Usage: node tools/attribution.mjs <slug> [--task <id>] [--lookback <days>] [--outcome <metric>] | --all'); process.exit(2); }
      const r = runAttribution(slug, { taskId: opt('--task'), lookbackDays: Number(opt('--lookback')) || 90, outcome: opt('--outcome') });
      console.log(JSON.stringify({ product: slug, leads: r.attribution.totals.leads, sales: r.attribution.totals.sales, revenue: r.attribution.totals.revenue, mmm: r.mmm.status, r2: r.mmm.fit?.r2 ?? null, confidence: r.mmm.confidence ?? null, proposals: r.approvals.length }));
    }
  } catch (e) { console.error(e.message); process.exit(1); }
}
