// Earned autonomy made visible (stage 5): for every product, each action type and channel the owner has
// decided on, with its current approval streak toward earned autonomy, what is already automatic (by the
// autonomy level, by earned trust) or still manual, and the next milestone ("post|linkedin: 7 of 10").
//   products/<slug>/reports/autonomy.md     the report for the owner
//   products/<slug>/reports/autonomy.json   the same rows; also the baseline the next run compares with
//   products/<slug>/alerts.json             Needs-You-Know info alerts (key autonomy:<type>|<channel>) when a
//                                           channel earns autonomy or loses it after a rejection or edit
//   state/live-autonomy.json                every product, no personal data (dashboard and live page)
// Read only toward approvals: approvals.json is never written. The streak rules come from
// tools/lib/earned.mjs (earnedTypes decides what is earned); the level table mirrors tools/policy.mjs AUTO
// and must be kept in sync with it. This tool never makes anything automatic: tools/policy.mjs does,
// and only when product.json autonomy.earned is on, compliance passes and every cap holds.
// Usage: node tools/autonomy-report.mjs <slug> [--no-alerts] [--now ISO]
//        node tools/autonomy-report.mjs --all [--no-alerts]   every product, then state/live-autonomy.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, root } from './lib/env.mjs';
import { earnedTypes, earnedKey, NEVER_EARNED } from './lib/earned.mjs';

// Same table as tools/policy.mjs: action types that are automatic at each level.
export const LEVEL_AUTO = {
  manual: [],
  supervised: [],
  autopilot: ['publish', 'post', 'newsletter', 'spend'],
  full: ['publish', 'post', 'newsletter', 'spend', 'send', 'outreach', 'price', 'launch'],
};
const OUTWARD = new Set(['publish', 'post', 'newsletter', 'spend', 'send', 'outreach', 'price', 'launch']);
const DECIDED = ['approved', 'executed', 'rejected', 'changes'];

// Channel names come from approvals; keep only a safe label so no address or name reaches state/ or logs.
export const safeLabel = (s) => {
  const v = String(s ?? '').toLowerCase().trim();
  if (!v) return '';
  if (/@|\s|https?:|\d{6,}/.test(v)) return 'other';
  return v.replace(/[^a-z0-9_.:-]/g, '').slice(0, 40) || 'other';
};
const safeKey = (k) => { const [t, c = ''] = String(k).split('|'); return `${safeLabel(t) || 'publish'}|${safeLabel(c)}`; };

// The earned-autonomy settings policy.mjs uses: null when product.json autonomy.earned is off.
export function earnedConfig(autonomy = {}) {
  const e = autonomy?.earned;
  return e === true ? {} : (e && typeof e === 'object' ? e : null);
}
export const streakNeed = (cfg) => Math.max(5, Number(cfg?.streak) || 10);

const clean = (x) => ['approved', 'executed'].includes(x.status) && !x.edited_by_owner && !x.override_review && !x.owner_note_edit;
const breakReason = (x) => (x.status === 'rejected' ? 'rejected' : x.status === 'changes' ? 'changes requested' : x.edited_by_owner || x.owner_note_edit ? 'edited by the owner' : x.override_review ? 'approved over a compliance block' : 'other');

// Current run of owner approvals given unchanged and clean, newest first, per action type and channel
// (the same rows tools/lib/earned.mjs counts). Also the last thing that broke the run.
export function streaks(list) {
  const byKey = {};
  for (const x of list ?? []) {
    if (!x || !/owner/i.test(String(x.decided_by ?? '')) || !x.decided_at) continue;
    if (!DECIDED.includes(x.status)) continue;
    (byKey[earnedKey(x)] ??= []).push(x);
  }
  const out = {};
  for (const [k, xs] of Object.entries(byKey)) {
    xs.sort((p, q) => String(q.decided_at).localeCompare(String(p.decided_at)));
    let n = 0;
    while (n < xs.length && clean(xs[n])) n++;
    const brk = xs[n];
    out[k] = { streak: n, decisions: xs.length, last_decided_at: xs[0].decided_at, last_break: brk ? { at: brk.decided_at, reason: breakReason(brk) } : null };
  }
  return out;
}

// Every action type and channel with its mode: 'level' (automatic at this autonomy level), 'earned'
// (automatic by earned trust), 'eligible' (streak reached but product.json autonomy.earned is off),
// 'manual' (waits for the owner), 'never' (owner keeps it manual: never_auto, or price, which never earns).
// Same membership test policy.mjs makes ((a.never_auto ?? []).includes(t)), so a hand-written string is
// read the way the policy reads it and the report never shows as automatic what the policy keeps manual.
const listHas = (v, t) => (Array.isArray(v) || typeof v === 'string' ? v.includes(t) : false);

export function autonomyRows(product = {}, approvals = [], { env = process.env } = {}) {
  product = product && typeof product === 'object' ? product : {};
  approvals = (Array.isArray(approvals) ? approvals : []).filter((x) => x && typeof x === 'object');
  const a = product.autonomy && typeof product.autonomy === 'object' ? product.autonomy : { level: 'manual' };
  const level = typeof a.level === 'string' ? a.level : 'manual';
  const isNever = (t) => listHas(a.never_auto, t);
  const always = Array.isArray(a.always_auto) || typeof a.always_auto === 'string' ? [...a.always_auto] : [];
  const allowed = new Set([...(LEVEL_AUTO[level] ?? []), ...always].filter((t) => !isNever(t)));
  const cfg = earnedConfig(a);
  const need = streakNeed(cfg);
  // A malformed types list (not an array or string) earns nothing here: never show more than policy grants.
  const rawTypes = cfg?.types;
  const types = rawTypes == null ? null : (Array.isArray(rawTypes) || typeof rawTypes === 'string' ? rawTypes : []);
  // What earnedTypes would grant, with or without the switch on (to show "eligible" when it is off).
  const eligible = earnedTypes(approvals, { ...(cfg ?? {}), types });
  const st = streaks(approvals);
  const keys = new Set(Object.keys(st));
  for (const x of approvals ?? []) if (x && x.status === 'pending') keys.add(earnedKey(x));
  const halted = product.stage === 'paused' || a.kill === true || env?.OM_KILL === '1';
  // policy.mjs never spends automatically above autonomy.auto_spend_per_day (0 or unset: no automatic spend).
  const noAutoSpend = !(Number(a.auto_spend_per_day ?? 0) > 0);
  const noSite = !String(product.domain ?? '').trim();
  const rows = [];
  for (const k of [...keys].sort()) {
    const [type, channel] = k.split('|');
    const s = st[k] ?? { streak: 0, decisions: 0, last_decided_at: null, last_break: null };
    let mode, why;
    if (allowed.has(type)) { mode = 'level'; why = `automatic at level ${level}`; }
    else if (isNever(type)) { mode = 'never'; why = 'never_auto in product.json: always waits for the owner'; }
    else if (type === 'price') { mode = 'never'; why = 'price changes never earn autonomy'; }
    else if (NEVER_EARNED.has(type)) { mode = 'never'; why = `"${type}" never earns autonomy: the owner approves each one`; }
    else if (types && !types.includes(type)) { mode = 'manual'; why = 'not in autonomy.earned.types'; }
    else if (eligible.has(k)) {
      if (cfg) { mode = 'earned'; why = `earned: the owner approved the last ${eligible.get(k)} unchanged`; }
      else { mode = 'eligible'; why = 'streak reached; turn on autonomy.earned in product.json to let it run'; }
    } else { mode = 'manual'; why = `waits for the owner at level ${level}`; }
    const label = safeKey(k);
    const next = mode === 'manual' && !(types && !types.includes(type)) ? `${label}: ${Math.min(s.streak, need)} of ${need}` : null;
    // Paused or kill-switched holds everything (as in policy.mjs); no domain holds only outward actions.
    const auto = ['level', 'earned'].includes(mode);
    const held = !auto ? null
      : halted ? 'product paused or kill-switched'
      : noSite && OUTWARD.has(type) ? 'no domain yet'
      : type === 'spend' && noAutoSpend ? 'no automatic spend: autonomy.auto_spend_per_day is 0 or unset'
      : null;
    rows.push({ key: label, type: label.split('|')[0], channel: label.split('|')[1], mode, why, streak: s.streak, need, decisions: s.decisions, last_decided_at: s.last_decided_at, last_break: s.last_break, next, held });
  }
  return { level, earned_on: !!cfg, need, held: halted ? 'paused' : (noSite ? 'no-domain' : null), rows };
}

const isAuto = (r) => r && ['earned', 'eligible'].includes(r.mode);

// Info alerts on a change since the last run: a channel that earned trust, or one that lost it.
// The first run (no baseline) only records the baseline, so old trust does not flood the feed.
export function autonomyAlerts(prev, cur) {
  if (!prev || !Array.isArray(prev.rows)) return [];
  const before = new Map(prev.rows.filter((r) => r && typeof r === 'object' && typeof r.key === 'string').map((r) => [r.key, r]));
  const out = [];
  for (const r of cur.rows) {
    const p = before.get(r.key);
    if (isAuto(r) && !isAuto(p)) {
      out.push({ key: `autonomy:${r.key}`, level: 'info', kind: 'earned', title: `${r.key} earned autonomy: ${r.streak} approvals in a row unchanged`, detail: r.mode === 'earned' ? 'New items of this type and channel can now run on their own (compliance, caps and the kill switch still apply). One rejection takes it back.' : 'The streak is reached, but autonomy.earned is off in product.json, so it still waits for you.' });
    } else if (isAuto(p) && !isAuto(r) && r.mode === 'manual') {
      const why = r.last_break?.reason ?? 'a decision';
      out.push({ key: `autonomy:${r.key}`, level: 'info', kind: 'lost', title: `${r.key} is back to manual after ${why === 'rejected' ? 'a rejection' : why}`, detail: `Items of this type and channel wait for you again. Next milestone: ${r.next ?? `0 of ${r.need}`}.` });
    }
  }
  return out;
}

// One open alert per key: a new change replaces the open alert's text.
export function mergeAlerts(list, want, now) {
  let changed = false;
  for (const w of want) {
    const open = list.find((a) => a && typeof a === 'object' && !a.resolved && a.key === w.key);
    if (open) { if (open.title !== w.title) { Object.assign(open, w, { last_seen: now }); changed = true; } continue; }
    list.push({ ...w, agent: 'om-autonomy-report', at: now, resolved: false });
    changed = true;
  }
  return changed;
}

const MODE_LABEL = { level: 'automatic (level)', earned: 'automatic (earned)', eligible: 'earned, switch off', manual: 'manual', never: 'always manual' };
export function autonomyMarkdown(slug, rep, now) {
  const L = [`# Earned autonomy: ${slug}`, '', `Updated ${now}. Level: **${rep.level}**. Earned autonomy: **${rep.earned_on ? 'on' : 'off'}** (streak needed: ${rep.need}).`, ''];
  if (rep.held) L.push(`Note: outward actions are held for now (${rep.held === 'paused' ? 'product paused or kill-switched' : 'no domain yet'}); nothing outward runs on its own.`, '');
  if (!rep.rows.length) { L.push('No owner decisions yet. Every action waits for you.'); return L.join('\n') + '\n'; }
  L.push('| Action and channel | Status | Streak | Next milestone | Last break |', '|---|---|---|---|---|');
  for (const r of rep.rows) L.push(`| ${r.key} | ${MODE_LABEL[r.mode]}${r.held ? `, held: ${r.held}` : ''} | ${r.streak} of ${r.need} | ${r.next ?? '-'} | ${r.last_break ? `${r.last_break.reason} (${String(r.last_break.at).slice(0, 10)})` : '-'} |`);
  const next = rep.rows.filter((r) => r.next).sort((p, q) => q.streak - p.streak).slice(0, 5);
  if (next.length) L.push('', '## Closest to earning autonomy', '', ...next.map((r) => `- ${r.next}`));
  L.push('', 'Only items you approve unchanged count. A rejection, a requested change, an edit or an approval over a compliance block starts the count again. Price changes never earn autonomy. This report changes nothing; tools/policy.mjs decides, inside every cap and compliance check.');
  return L.join('\n') + '\n';
}

const productSlugs = (base) => { const d = path.join(base, 'products'); return fs.existsSync(d) ? fs.readdirSync(d).filter((s) => !s.startsWith('_') && /^[a-z0-9-]+$/i.test(s) && fs.existsSync(path.join(d, s, 'product.json'))) : []; };

export function runAutonomy(slug, { base = root, now = new Date().toISOString(), alerts = true } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(String(slug ?? ''))) throw new Error('bad product slug');
  const dir = path.join(base, 'products', slug);
  if (!fs.existsSync(path.join(dir, 'product.json'))) throw new Error(`no product ${slug}`);
  const product = readJson(path.join(dir, 'product.json'), {}) ?? {};
  const approvals = readJson(path.join(dir, 'approvals.json'), []);
  const rep = autonomyRows(product, Array.isArray(approvals) ? approvals : []);
  const rdir = path.join(dir, 'reports');
  fs.mkdirSync(rdir, { recursive: true });
  const jfile = path.join(rdir, 'autonomy.json');
  const prev = readJson(jfile, null);
  const want = autonomyAlerts(prev, rep);
  let alerted = 0;
  if (alerts && want.length) {
    const afile = path.join(dir, 'alerts.json');
    const list = readJson(afile, []);
    const arr = Array.isArray(list) ? list : [];
    if (mergeAlerts(arr, want, now)) { writeJson(afile, arr); alerted = want.length; }
  }
  const out = { slug, generated_at: now, ...rep };
  writeJson(jfile, out);
  fs.writeFileSync(path.join(rdir, 'autonomy.md'), autonomyMarkdown(slug, rep, now));
  return { ...out, alerts: want.map((w) => ({ key: w.key, kind: w.kind })), alerted };
}

// Dashboard view: counts and keys only (no titles, recipients or texts from approvals).
export function liveAutonomy(results, now) {
  return {
    generated_at: now,
    products: results.map((r) => ({
      slug: r.slug, level: r.level, earned_on: r.earned_on, need: r.need, held: r.held,
      counts: r.rows.reduce((c, x) => ((c[x.mode] = (c[x.mode] ?? 0) + 1), c), {}),
      rows: r.rows.map((x) => ({ key: x.key, mode: x.mode, streak: x.streak, need: x.need, next: x.next, last_break: x.last_break ? { reason: x.last_break.reason, at: x.last_break.at } : null, held: x.held })),
    })),
  };
}

export function runAll({ base = root, now = new Date().toISOString(), alerts = true } = {}) {
  const results = [];
  for (const s of productSlugs(base)) { try { results.push(runAutonomy(s, { base, now, alerts })); } catch { /* unreadable product: skip */ } }
  fs.mkdirSync(path.join(base, 'state'), { recursive: true });
  writeJson(path.join(base, 'state', 'live-autonomy.json'), liveAutonomy(results, now));
  return results;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--now');
  const now = i > -1 ? argv[i + 1] : new Date().toISOString();
  const alerts = !argv.includes('--no-alerts');
  const slug = argv.find((a, j) => !a.startsWith('--') && argv[j - 1] !== '--now');
  if (argv.includes('--all')) {
    const r = runAll({ now, alerts });
    console.log(JSON.stringify({ products: r.length, earned: r.reduce((n, x) => n + x.rows.filter((y) => y.mode === 'earned').length, 0), alerted: r.reduce((n, x) => n + x.alerted, 0) }));
  } else if (slug) {
    const r = runAutonomy(slug, { now, alerts });
    console.log(JSON.stringify({ slug, level: r.level, earned_on: r.earned_on, rows: r.rows.length, alerts: r.alerts }));
  } else { console.error('Usage: node tools/autonomy-report.mjs <slug> | --all [--no-alerts] [--now ISO]'); process.exit(2); }
}
