// "Needs You Know": everything the business owner should see, ranked, in one feed.
// Sources: owner decisions in reports/owner-decisions.md, pending approvals, blocked tasks,
// budget use, alerts raised by agents (runs results "alerts" → alerts.json), stale runs.
// Writes state/live-nyk.json (→ db live/nyk) and products/<slug>/needs-you-know.md.
// Every approval and decision is always in the feed (the 80-item cap only trims notes and alerts), and
// repeated alerts with the same key or title are folded into one item.
// Usage:
//   node tools/needs-you-know.mjs                                   rebuild the feed
//   node tools/needs-you-know.mjs resolve <alert-key-or-title> [--product <slug> | --system]
//        marks matching unresolved alerts resolved:true (products/*/alerts.json and state/system-alerts.json)
//   node tools/needs-you-know.mjs answer <slug> <decision-id> <answer>
//        records the owner's answer on the matching row of reports/owner-decisions.md
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const productsDir = path.join(root, 'products');
const now = new Date();
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));
const RANK = { critical: 0, decision: 1, approval: 2, warning: 3, info: 4 };
const CAP = 80;
const slugs = () => (fs.existsSync(productsDir) ? fs.readdirSync(productsDir).filter((s) => !s.startsWith('_') && /^[a-z0-9-]+$/i.test(s)) : []);
// Browser-reported rows (site tracker beacons) are unverified and never count as revenue.
const clientSide = (k) => String(k.metric ?? '').startsWith('client_') || ['satellite', 'edge'].includes(k.source);

// Owner decision rows: `| 1 | question | ... |`. The id is a hash of number + question, so it stays the
// same between rebuilds and the Command Center can answer it.
const DECISION_ROW = /^\|\s*\**(\d+[a-z]?)\**\s*\|\s*([^|]+?)\s*\|/;
export const decisionId = (num, question) => `dec-${crypto.createHash('sha1').update(`${num}|${String(question).trim()}`).digest('hex').slice(0, 10)}`;
const isOpenDecision = (line, m) => m && !/answer|^-+$|#/i.test(m[2]) && !/\|\s*(yes|no|done|answered)\b/i.test(line);

const norm = (s) => String(s ?? '').trim().toLowerCase();
const alertMatches = (a, q) => !a.resolved && [a.key, a.id, a.title].some((v) => v != null && norm(v) === norm(q));

function resolveAlerts(query, { product = null, system = false } = {}) {
  const files = [];
  if (!product) files.push({ file: path.join(root, 'state', 'system-alerts.json'), product: null });
  if (!system) for (const s of product ? [product] : slugs()) files.push({ file: path.join(productsDir, s, 'alerts.json'), product: s });
  const out = [];
  for (const { file, product: p } of files) {
    const list = readJson(file, null);
    if (!Array.isArray(list)) continue;
    let n = 0;
    for (const a of list) if (alertMatches(a, query)) { a.resolved = true; a.resolved_at = now.toISOString(); a.resolved_by = 'owner'; n++; }
    if (n) { writeJson(file, list); out.push({ product: p, resolved: n }); }
  }
  return out;
}

function answerDecision(slug, id, answer) {
  if (!/^[a-z0-9-]+$/i.test(slug ?? '')) throw new Error('bad product slug');
  const file = path.join(productsDir, slug, 'reports', 'owner-decisions.md');
  if (!fs.existsSync(file)) throw new Error(`no reports/owner-decisions.md in ${slug}`);
  const clean = String(answer ?? '').replace(/[|\r\n]+/g, ' ').trim().slice(0, 200) || 'done';
  const raw = fs.readFileSync(file, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  let hit = false;
  const lines = raw.split(/\r?\n/).map((line) => {
    const m = line.match(DECISION_ROW);
    if (hit || !isOpenDecision(line, m) || decisionId(m[1], m[2].replace(/\*/g, '')) !== id) return line;
    hit = true;
    return `${line.replace(/\s*\|?\s*$/, ' |')} answered: ${clean} (${now.toISOString().slice(0, 10)}) |`;
  });
  if (!hit) throw new Error(`open decision ${id} not found in ${slug}`);
  fs.writeFileSync(file, lines.join(eol));
  fs.appendFileSync(path.join(productsDir, slug, 'events.jsonl'), JSON.stringify({ at: now.toISOString(), agent: 'owner', product: slug, kind: 'approval', text: `Owner answered decision ${id}: ${clean}` }) + '\n');
  return { product: slug, id, answer: clean };
}

// Folds alerts with the same product + key (or level + title) into one item, newest first.
function foldAlerts(list) {
  const groups = new Map();
  for (const al of list) {
    const k = al.key ?? `${al.level ?? 'warning'}|${al.title}`;
    const g = groups.get(k);
    if (!g) groups.set(k, { ...al, count: Number(al.repeats ?? 1) });
    else { g.count += Number(al.repeats ?? 1); if (String(al.at ?? '') > String(g.at ?? '')) Object.assign(g, { ...al, count: g.count }); }
  }
  return [...groups.values()];
}

function build() {
  const items = [];
  for (const slug of slugs()) {
    const dir = path.join(productsDir, slug);
    const p = readJson(path.join(dir, 'product.json'), null);
    if (!p) continue;
    const mine = [];
    const add = (level, title, detail, extra = {}) => mine.push({ product: slug, level, title, detail, ...extra });

    // Owner decisions: table rows or list lines that are not answered yet.
    const dec = path.join(dir, 'reports', 'owner-decisions.md');
    if (fs.existsSync(dec)) {
      for (const line of fs.readFileSync(dec, 'utf8').split(/\r?\n/)) {
        const m = line.match(DECISION_ROW);
        if (isOpenDecision(line, m)) {
          const q = m[2].replace(/\*/g, '');
          const due = (line.match(/20\d\d-\d\d-\d\d|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]* (?:Nov|Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct)[a-z]* \d+/) ?? [])[0];
          add(/blocker|★|hard stop|\bgate\b/i.test(line) ? 'critical' : 'decision', `Decision ${m[1]}: ${q.slice(0, 110)}`, due ? `Due ${due}` : 'Needs your answer', { id: decisionId(m[1], q), kind: 'owner-decision', number: m[1], source: 'reports/owner-decisions.md' });
        }
      }
    }

    for (const ap of readJson(path.join(dir, 'approvals.json'), [])) {
      // Booster specs can list what the owner must do first (e.g. add a privacy page): show it.
      let needs = [];
      if (ap.channel === 'onsite-booster' && ap.file && ['pending', 'failed'].includes(ap.status) && ap.override_needs !== true) {
        const spec = readJson(path.join(dir, ap.file), null);
        if (Array.isArray(spec?.needs_owner)) needs = spec.needs_owner.map(String).filter(Boolean);
      }
      const needsText = needs.length ? ` Before approving: ${needs.join(' ')}` : '';
      if (ap.status === 'pending') {
        // A compliance block still needs the owner's word: they can reject it, or approve to override.
        if (ap.compliance === 'block') add('approval', `Approve: ${ap.title}`, `Blocked by review: ${ap.review_notes ?? ''}`.slice(0, 160) + ` Approving overrides the review.${needsText}`, { id: ap.id, source: ap.file, blocked: true, override: true, ...(needs.length ? { needs_owner: needs } : {}) });
        else add('approval', `Approve: ${ap.title}`, `${ap.type} · by ${ap.agent} · review ${ap.compliance}${needsText}`, { id: ap.id, source: ap.file, ...(needs.length ? { needs_owner: needs } : {}) });
      }
      if (ap.status === 'failed' && needs.length) add('warning', `Waiting on you: ${ap.title}`, `It could not go live.${needsText}`, { id: ap.id, source: ap.file, needs_owner: needs });
      if (ap.status === 'auto-approved') add('info', `Done automatically: ${ap.title}`, `Approved by policy (${ap.decided_by})`, { id: ap.id });
    }

    const tasks = readJson(path.join(dir, 'tasks.json'), []);
    for (const t of tasks.filter((x) => x.status === 'blocked')) add('warning', `Blocked: ${t.title}`, (t.error ?? t.review ?? '').slice(0, 160), { id: t.id });

    const b = p.budget ?? {};
    if (Number(b.monthly_cap) > 0) {
      const pct = Number(b.spent_this_month ?? 0) / Number(b.monthly_cap);
      if (pct >= 0.9) add('critical', `Ad budget ${Math.round(pct * 100)}% used`, `${b.spent_this_month} of ${b.monthly_cap} ${b.currency ?? ''}`);
      else if (pct >= 0.7) add('warning', `Ad budget ${Math.round(pct * 100)}% used`, `${b.spent_this_month} of ${b.monthly_cap} ${b.currency ?? ''}`);
    }

    for (const al of foldAlerts(readJson(path.join(dir, 'alerts.json'), []).filter((x) => !x.resolved))) {
      add(al.level ?? 'warning', al.title, `${al.detail ?? ''}${al.count > 1 ? ` (raised ${al.count} times)` : ''}`, { agent: al.agent, at: al.at, kind: 'alert', alert_key: al.key ?? al.title, ...(al.count > 1 ? { repeats: al.count } : {}) });
    }

    // Revenue milestones from server-side metrics only (Stripe, owner imports; today and the 6 days before).
    // Sales are counted from payments rows only. Ad platform conversions are attributed claims, shown apart;
    // GA4 key events are left out (gtag fires in the browser). Browser-reported conversions are shown apart as unverified.
    const weekAgo = new Date(now - 6 * 86400 * 1000).toISOString().slice(0, 10);
    const kpis = readJson(path.join(dir, 'metrics', 'kpis.json'), []).filter((k) => String(k.date) >= weekAgo);
    const server = kpis.filter((k) => !clientSide(k));
    const sum = (list) => list.reduce((s, k) => s + Number(k.value || 0), 0);
    const rev = sum(server.filter((k) => k.metric === 'revenue'));
    const sales = sum(server.filter((k) => k.metric === 'payments'));
    const adConv = sum(server.filter((k) => k.metric === 'conversions' && k.source !== 'ga4' && (k.campaign || /-ads-metrics$/.test(String(k.source ?? '')))));
    const clientRev = sum(kpis.filter((k) => k.metric === 'client_revenue'));
    if (rev > 0) add('info', `Revenue: ${rev.toFixed(2)} ${p.budget?.currency ?? ''} in the last 7 days`, `${sales} sales verified by payments${adConv > 0 ? `; ${adConv} conversions reported by ad platforms (attributed, not verified)` : ''}${clientRev > 0 ? `; the site tracker also reported ${clientRev.toFixed(2)} (unverified)` : ''}`, { kind: 'revenue' });
    const plan = readJson(path.join(dir, 'budget-plan.json'), null);
    if (plan && Object.keys(plan.proposed_split ?? {}).length) add('info', `Budget plan (${plan.allocation_mode}): ${Object.entries(plan.proposed_split).map(([c, v]) => `${c} ${v}`).join(', ')}`, `${plan.left} ${plan.currency} left this month`, { kind: 'budget' });

    const runs = path.join(dir, 'runs');
    for (const f of fs.existsSync(runs) ? fs.readdirSync(runs).filter((x) => x.endsWith('.start')) : []) {
      const h = readJson(path.join(runs, f), {});
      if (h.started_at && now - Date.parse(h.started_at) > 2 * 3600 * 1000) add('warning', `Agent may be stuck: ${h.agent}`, `Started ${h.started_at} on ${h.task_id}`);
    }

    mine.sort((x, y) => RANK[x.level] - RANK[y.level]);
    items.push(...mine);
    const md = ['# Needs you know', '', `Updated ${now.toISOString()}. Most important first.`, '', ...mine.map((i) => `- **${i.level}** — ${i.title}${i.detail ? ` — ${i.detail}` : ''}`)].join('\n');
    fs.writeFileSync(path.join(dir, 'needs-you-know.md'), md + '\n');
  }

  // System-level alerts (self-debugger, daemon) apply to every product.
  for (const al of foldAlerts(readJson(path.join(root, 'state', 'system-alerts.json'), []).filter((x) => !x.resolved))) {
    items.push({ product: null, level: al.level ?? 'warning', title: al.title, detail: `${al.detail ?? ''}${al.count > 1 ? ` (raised ${al.count} times)` : ''}`, kind: 'system', alert_key: al.key ?? al.title });
  }
  items.sort((x, y) => RANK[x.level] - RANK[y.level]);
  // Approvals and decisions are never cut; the cap applies to everything else.
  const actionable = (i) => i.level === 'approval' || i.level === 'decision' || i.kind === 'owner-decision';
  const keep = [];
  let others = 0;
  for (const i of items) if (actionable(i) || others++ < CAP) keep.push(i);
  fs.mkdirSync(path.join(root, 'state'), { recursive: true });
  fs.writeFileSync(path.join(root, 'state', 'live-nyk.json'), JSON.stringify({ updated_at: now.toISOString(), items: keep }));
  const count = (l) => items.filter((i) => i.level === l).length;
  return { items: items.length, kept: keep.length, critical: count('critical'), decisions: count('decision'), approvals: count('approval'), warnings: count('warning') };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ...args] = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(`--${k}`); return i > -1 ? args[i + 1] : null; };
  try {
    if (cmd === 'resolve') {
      const q = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--product').join(' ');
      if (!q) { console.error('Usage: node tools/needs-you-know.mjs resolve <alert-key-or-title> [--product <slug> | --system]'); process.exit(2); }
      const product = opt('product');
      if (product && !/^[a-z0-9-]+$/i.test(product)) throw new Error('bad product slug');
      const done = resolveAlerts(q, { product, system: args.includes('--system') });
      console.log(JSON.stringify({ resolved: done.reduce((s, d) => s + d.resolved, 0), files: done, feed: build() }));
    } else if (cmd === 'answer') {
      const [slug, id, ...words] = args;
      if (!slug || !id) { console.error('Usage: node tools/needs-you-know.mjs answer <slug> <decision-id> <answer>'); process.exit(2); }
      const r = answerDecision(slug, id, words.join(' '));
      console.log(JSON.stringify({ answered: r, feed: build() }));
    } else {
      console.log(JSON.stringify(build()));
    }
  } catch (e) { console.error(String(e.message ?? e)); process.exit(1); }
}
