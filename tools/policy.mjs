// Autonomy policy: decides which pending approvals the system may carry out on its own.
// Reads product.json "autonomy" and turns eligible approvals from "pending" into "auto-approved".
// Usage: node tools/policy.mjs <slug> [--now ISO]
//
// Levels (product.json autonomy.level), per action type:
//   manual     – everything waits for the owner
//   supervised – research and internal drafts only; nothing outbound is automatic
//   autopilot  – owned channels (site, blog, social posts, newsletter to opted-in list) and
//                spend up to autonomy.auto_spend_per_day are automatic; outreach, price changes wait
//   full       – every action type is automatic inside the budget caps
// An approval is only ever automatic when compliance is "pass" and the claim/budget checks hold.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spentThisMonth, checkSpendCaps } from './budget.mjs';
import { acquireLock, productLockFile } from './lib/lock.mjs';
import { earnedTypes, earnedKey } from './lib/earned.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const slug = args[0];
if (!slug) { console.error('Usage: node tools/policy.mjs <slug> [--now ISO]'); process.exit(2); }
const nowIdx = args.indexOf('--now');
const now = nowIdx > -1 ? args[nowIdx + 1] : new Date().toISOString();
const dir = path.join(root, 'products', slug);
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return d; } };

// Same per-product lock as the executor, so policy and execute never write approvals.json at once.
const release = fs.existsSync(dir) ? acquireLock(productLockFile(dir), { waitMs: Number(process.env.OM_EXECUTE_LOCK_WAIT_MS ?? 3000), owner: 'policy' }) : () => {};
if (!release) { console.log(JSON.stringify({ slug, auto_approved: 0, skipped: 'another executor or policy run holds the product lock' })); process.exit(0); }

const product = read('product.json', {});
const approvals = read('approvals.json', []);
const a = product.autonomy ?? { level: 'manual' };
const budget = product.budget ?? {};
const ledgerFile = path.join(dir, 'ledger.jsonl');
// Spend so far: the larger of product.json's figure and the ledger + platform kpis spend rows.
const spentNow = Math.max(Number(budget.spent_this_month ?? 0), spentThisMonth(ledgerFile, now));
const killedCampaigns = read('killswitch.json', []);

const AUTO = {
  manual: [],
  supervised: [],
  autopilot: ['publish', 'post', 'newsletter', 'spend'],
  full: ['publish', 'post', 'newsletter', 'spend', 'send', 'outreach', 'price', 'launch'],
};
const allowed = new Set([...(AUTO[a.level] ?? []), ...(a.always_auto ?? [])].filter((t) => !(a.never_auto ?? []).includes(t)));

// Earned autonomy (opt-in: autonomy.earned = true, or {streak, types}); see tools/lib/earned.mjs.
// Spend still passes every cap check below; never_auto, compliance and the domain rule still win.
const earnedCfg = a.earned === true ? {} : (a.earned && typeof a.earned === 'object' ? a.earned : null);
const earned = earnedCfg ? earnedTypes(approvals, earnedCfg) : new Map();

// Nothing is automatic for a product that is paused or kill-switched, and nothing outward-facing is
// automatic before the product has a live domain to act on (drafts for a site that does not exist yet,
// or a fictional sample, must always wait for the owner).
const OUTWARD = new Set(['publish', 'post', 'newsletter', 'spend', 'send', 'outreach', 'price', 'launch']);
const halted = product.stage === 'paused' || a.kill === true || process.env.OM_KILL === '1';
const noSite = !String(product.domain ?? '').trim();

// Automatic spend is limited per day, not per item: count every spend item the policy decided today
// (this run included, whatever its status now) plus approved spend still waiting for the executor.
const utcDay = (t) => { const d = new Date(t ?? ''); return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10); };
const day = utcDay(now);
const WAITING = new Set(['approved', 'auto-approved']);
const autoSpendToday = (exceptId) => Math.round(100 * approvals.reduce((s, x) => {
  if (x?.type !== 'spend' || x.id === exceptId) return s;
  const byPolicyToday = String(x.decided_by ?? '').startsWith('policy:') && !!day && utcDay(x.decided_at) === day;
  return byPolicyToday || WAITING.has(x.status) ? s + Number(x.amount ?? 0) : s;
}, 0)) / 100;

let changed = 0;
const decisions = [];
for (const ap of approvals) {
  if (ap.status !== 'pending') continue;
  const type = ap.type ?? 'publish';
  const amount = Number(ap.amount ?? 0);
  let why = '';
  if (halted) why = `product is ${product.stage === 'paused' ? 'paused' : 'kill-switched'}: everything waits for the owner`;
  else if (noSite && OUTWARD.has(type)) why = `"${type}" needs the owner until the product has a domain`;
  else if (ap.compliance !== 'pass') why = `compliance is ${ap.compliance ?? 'unchecked'}`;
  else if (!allowed.has(type) && !(earned.has(earnedKey(ap)) && !(a.never_auto ?? []).includes(type))) why = `"${type}" needs the owner at level ${a.level}`;
  else if (type === 'spend') {
    const daily = Number(a.auto_spend_per_day ?? 0);
    const left = Number(budget.monthly_cap ?? 0) - spentNow;
    if (amount <= 0) why = 'spend approval has no amount';
    else if (amount > daily) why = `amount ${amount} is over the automatic limit ${daily}/day`;
    else if (autoSpendToday(ap.id) + amount > daily) why = `automatic spend today ${autoSpendToday(ap.id)} + this ${amount} is over the automatic limit ${daily}/day`;
    else if (amount > left) why = `amount ${amount} is over the ${left} left in the monthly cap`;
    else {
      // The same total-commitment check the executor makes: live campaigns + this one, per day and to month end.
      // Spend approved but not yet executed (this run's decisions included) counts as committed here.
      const asCommitted = approvals.map((x) => (x?.type === 'spend' && WAITING.has(x.status) ? { ...x, status: 'executing' } : x));
      const c = checkSpendCaps({ item: ap, budget, approvals: asCommitted, ledgerFile, now, killed: killedCampaigns });
      if (!c.ok) why = c.why;
    }
  }
  if (why) { decisions.push({ id: ap.id, decision: 'owner', why }); continue; }
  ap.status = 'auto-approved';
  ap.decided_at = now;
  const byTrust = !allowed.has(type);
  ap.decided_by = byTrust ? 'policy:earned' : `policy:${a.level}`;
  changed++;
  decisions.push({ id: ap.id, decision: 'auto', why: byTrust ? `earned: the owner approved the last ${earned.get(earnedKey(ap))} "${earnedKey(ap)}" items unchanged` : `allowed at level ${a.level}` });
}
if (changed) {
  // Re-read and replace only the items this run decided, so a concurrent writer's changes survive.
  const decided = new Map(approvals.filter((x) => x?.id && x.decided_at === now && String(x.decided_by ?? '').startsWith('policy:')).map((x) => [x.id, x]));
  const fresh = read('approvals.json', approvals);
  const merged = Array.isArray(fresh) ? fresh.map((x) => (x && decided.has(x.id) && x.status === 'pending' ? decided.get(x.id) : x)) : approvals;
  fs.writeFileSync(path.join(dir, 'approvals.json'), JSON.stringify(merged, null, 2));
}
release();
console.log(JSON.stringify({ slug, level: a.level, auto_approved: changed, decisions }));
