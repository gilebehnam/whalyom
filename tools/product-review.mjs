// Product review: Whalyom grading itself as a product, from measured evidence, and turning every gap
// into a ranked backlog. The product manager (om-product-manager, workflow om-product-evolution) works
// from this; nothing here is self-reported by an agent.
//   pm/scorecard.json, pm/SCORECARD.md   dimensions 0–5 with the evidence behind each score
//   pm/backlog.json, pm/BACKLOG.md       ranked items: what, why, who (system or owner), the metric it moves
//   state/product-scorecard.json         the same scorecard for the dashboard
// Inputs: every product's funnel report, approvals and tasks, state/agent-outcomes.json,
// state/knowledge.json, state/system-alerts.json, state/live-sites.json, the roster, and
// pm/competitors.json (the competitor feature matrix the product manager keeps; optional).
// Usage: node tools/product-review.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, root } from './lib/env.mjs';

const clamp = (n) => Math.max(0, Math.min(5, Math.round(n * 10) / 10));
const WEIGHT = { outcomes: 5, response: 4, autonomy: 3, agent_outcomes: 3, connectors: 3, reliability: 3, agent_use: 2, knowledge: 2, parity: 3 };

// Pure: grades a snapshot of the system. Returns {dimensions, backlog}.
export function gradeProduct(s) {
  const dims = [];
  const add = (id, label, score, evidence, fix, owner = 'system') => dims.push({ id, label, score: clamp(score), weight: WEIGHT[id] ?? 1, evidence, fix, owner });
  const live = s.products.filter((p) => p.stage !== 'paused');
  const withSite = live.filter((p) => p.domain);
  const withLeads = live.filter((p) => (p.funnel?.leads ?? 0) > 0);
  const withSales = live.filter((p) => (p.funnel?.won ?? 0) > 0);
  const verified = live.filter((p) => (p.funnel?.revenue_verified ?? 0) > 0);
  const outcome = !live.length ? 0 : !withSite.length ? 0.5 : !withLeads.length ? 1 : !withSales.length ? 2.5 : verified.length >= Math.ceil(live.length / 2) ? 5 : 4;
  add('outcomes', 'Proof of results: leads and verified sales on real products', outcome,
    `${live.length} active product(s), ${withSite.length} with a site, ${withLeads.length} with leads, ${withSales.length} with sales, ${verified.length} with verified revenue`,
    !withSite.length ? 'Attach a real product with a domain (/whalyom attach <domain>) and the site tracker, so every claim about Whalyom is measured on real buyers.' : !withLeads.length ? 'Turn on a consented lead capture and run om-free-growth weekly until the first leads arrive.' : 'Connect payments (Stripe read key or order exports to funnel/updates) so sales are verified, then compound what sells.',
    withSite.length ? 'system' : 'owner');

  const overdue = live.reduce((n, p) => n + (p.funnel?.uncontacted_over_sla ?? 0), 0);
  add('response', 'Speed to lead: no lead waits past its limit', withLeads.length ? 5 - overdue : 2, withLeads.length ? `${overdue} lead(s) waiting past the reply limit` : 'no leads yet to answer',
    'Approve or auto-approve (earned autonomy) the first replies; run om-lead-to-sale on every daemon cycle that finds new leads.');

  const executed = s.approvals.filter((a) => a.status === 'executed');
  const auto = executed.filter((a) => /^policy:/.test(String(a.decided_by ?? ''))).length;
  const earnedOn = live.filter((p) => p.autonomy?.earned).length;
  add('autonomy', 'Zero-touch operation inside the owner\'s guardrails', executed.length ? (5 * auto) / executed.length : (earnedOn ? 1.5 : 0.5),
    `${executed.length} item(s) went out, ${auto} without a human click; earned autonomy on for ${earnedOn} of ${live.length} product(s)`,
    'Switch on earned autonomy (product.json autonomy.earned: true) so action types the owner keeps approving unchanged run on their own; caps, compliance and price stay guarded.', 'owner');

  const out = s.outcomes.filter((a) => a.items_out > 0);
  const producing = out.filter((a) => a.leads > 0).length;
  add('agent_outcomes', 'Agents judged by sales, not by output', out.length ? (5 * producing) / out.length : 1, out.length ? `${producing} of ${out.length} agents with work in the market produced leads` : 'no agent output has reached the market yet',
    'Feed state/agent-outcomes.json into om-evolve: improve or retire agents whose items reach the market without results, copy the playbooks of agents that sell.');

  const sites = s.sites.filter((x) => x.state === 'connected').length;
  const keys = s.keys;
  add('connectors', 'Connected to the channels it acts on', Math.min(5, sites * 1.5 + keys.length * 0.5), `${sites} connected site(s); channel keys present: ${keys.join(', ') || 'none'}`,
    'Connect the site (satellite or edge), email sending (Resend), payments (Stripe read key) and one social or ad account; Whalyom cannot open accounts or accept terms itself.', 'owner');

  const openAlerts = s.systemAlerts.filter((a) => !a.resolved).length;
  const lastDaemon = s.daemon;
  add('reliability', 'Runs on its own without breaking', 5 - openAlerts - (lastDaemon && lastDaemon.ok === false ? 2 : 0) - (lastDaemon ? 0 : 2), `${openAlerts} open system alert(s); last daemon cycle ${lastDaemon ? (lastDaemon.ok ? 'ok' : 'failed') : 'not found'}${lastDaemon?.skipped ? ` (${String(lastDaemon.skipped).slice(0, 80)})` : ''}`,
    'Run om-self-heal on every open system alert; keep one scheduler holding the lease (cloud daemon or local), not two.');

  const used = new Set(s.tasks.map((t) => t.agent).filter(Boolean));
  add('agent_use', 'The workforce is used, not just listed', (5 * Math.min(1, used.size / Math.max(1, s.rosterSize * 0.3))), `${used.size} of ${s.rosterSize} agents have done at least one task`,
    'Route work by results: the mega heads delegate to specialists with outcome credit first; agents unused for 90 days become candidates to merge.');

  const k = s.knowledge ?? {};
  add('knowledge', 'Current, verified knowledge', k.facts_active ? 5 - Math.min(3, (k.facts_stale ?? 0) / Math.max(1, k.facts_active) * 20) - Math.min(1, (k.sources_overdue?.length ?? 0) / 10) - Math.min(1, (k.topics_without_facts?.length ?? 0) / 3) : 0,
    `${k.facts_active ?? 0} facts, ${k.facts_stale ?? 0} stale, ${k.sources_overdue?.length ?? 0} feed(s) overdue, ${k.topics_without_facts?.length ?? 0} empty topic(s)`,
    'Run om-knowledge-refresh daily; re-verify stale facts; replace feeds that stopped answering.');

  const feats = s.competitors?.features ?? [];
  const missing = feats.filter((f) => f.whalyom !== 'yes');
  add('parity', 'Ahead of competitors feature by feature', feats.length ? 5 * (1 - missing.reduce((n, f) => n + (f.whalyom === 'partial' ? 0.5 : 1), 0) / feats.length) : 2,
    feats.length ? `${feats.length - missing.length} of ${feats.length} tracked competitor features matched or beaten (pm/competitors.json, ${s.competitors.updated_at ?? 'undated'})` : 'no competitor matrix yet (pm/competitors.json)',
    'om-product-manager keeps pm/competitors.json from competitors\' own pages and ships the missing features with the highest buyer impact first.');

  const backlog = [];
  for (const d of dims) if (d.score < 4.5) backlog.push({ id: `PM-${d.id}`, dimension: d.id, title: d.fix, why: `${d.label}: ${d.score}/5 (${d.evidence})`, owner: d.owner, priority: Math.round((5 - d.score) * d.weight * 10) / 10 });
  for (const f of missing) backlog.push({ id: `PM-parity-${String(f.feature).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`, dimension: 'parity', title: `Build or beat: ${f.feature}`, why: `${(f.competitors ?? []).length} competitor(s) have it; Whalyom: ${f.whalyom}${f.note ? ` (${f.note})` : ''}`, owner: 'system', priority: Math.round(((f.whalyom === 'partial' ? 1 : 2) + (f.competitors ?? []).length * 0.5 + Number(f.buyer_impact ?? 1)) * 10) / 10 });
  // Section C items: accounts, keys and payment methods only the owner can give; the rest is build work.
  for (const o of s.ownerItems) { const owner = /account|key|token|payment method|secret|terms/i.test(o.title) ? 'owner' : 'system'; backlog.push({ id: `PM-open-${o.key}`, dimension: 'open', title: o.title, why: o.text.slice(0, 240), owner, priority: owner === 'owner' ? 4 : 5 }); }
  backlog.sort((a, b) => b.priority - a.priority);
  const overall = clamp(dims.reduce((n, d) => n + d.score * d.weight, 0) / dims.reduce((n, d) => n + d.weight, 0));
  return { overall, dimensions: dims, backlog };
}

// Reads the live system into the snapshot gradeProduct expects.
export function snapshot() {
  const pdir = path.join(root, 'products');
  const products = []; const approvals = []; const tasks = [];
  for (const slug of fs.existsSync(pdir) ? fs.readdirSync(pdir) : []) {
    if (slug.startsWith('_')) continue;
    const p = readJson(path.join(pdir, slug, 'product.json'), null);
    if (!p) continue;
    const rep = readJson(path.join(pdir, slug, 'funnel', 'report.json'), null);
    products.push({ slug, stage: p.stage, domain: p.domain, autonomy: p.autonomy, funnel: rep?.totals ?? null });
    approvals.push(...readJson(path.join(pdir, slug, 'approvals.json'), []));
    tasks.push(...readJson(path.join(pdir, slug, 'tasks.json'), []));
  }
  const daemonLog = path.join(root, 'state', 'daemon-log.jsonl');
  let daemon = null;
  try { daemon = JSON.parse(fs.readFileSync(daemonLog, 'utf8').trim().split(/\r?\n/).at(-1)); } catch { daemon = null; }
  const KEY_NAMES = { STRIPE_API_KEY: 'stripe', RESEND_API_KEY: 'email', META_ACCESS_TOKEN: 'meta', GOOGLE_ADS_DEVELOPER_TOKEN: 'google-ads', OM_WEBHOOK_URL: 'webhook', OM_SITE_REPO: 'site-repo', X_BEARER_TOKEN: 'x', LINKEDIN_ACCESS_TOKEN: 'linkedin' };
  const env = { ...process.env };
  try { for (const l of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/); if (m && !l.trim().startsWith('#')) env[m[1]] ??= m[2]; } } catch { /* no .env */ }
  const keys = Object.entries(KEY_NAMES).filter(([k]) => String(env[k] ?? '').trim()).map(([, v]) => v);
  // Owner-only gaps from docs/ARCHITECTURE_STATE.md Section C ("- **Title:** text").
  const ownerItems = [];
  try {
    const doc = fs.readFileSync(path.join(root, 'docs', 'ARCHITECTURE_STATE.md'), 'utf8');
    const sec = doc.slice(doc.indexOf('## Section C'));
    for (const m of sec.matchAll(/^- \*\*(.+?):\*\*\s*(.+)$/gm)) if (!/not built on purpose|no system can guarantee/i.test(m[2])) ownerItems.push({ key: m[1].toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40), title: m[1], text: m[2] });
  } catch { /* no doc */ }
  let rosterSize = 0;
  try { rosterSize = fs.readdirSync(path.join(root, '.claude', 'agents')).filter((f) => /^om-.*\.md$/.test(f)).length; } catch { rosterSize = 0; }
  return {
    products, approvals, tasks, daemon, keys, ownerItems, rosterSize,
    outcomes: readJson(path.join(root, 'state', 'agent-outcomes.json'), { agents: [] }).agents ?? [],
    knowledge: readJson(path.join(root, 'state', 'knowledge.json'), null),
    systemAlerts: readJson(path.join(root, 'state', 'system-alerts.json'), []),
    sites: readJson(path.join(root, 'state', 'live-sites.json'), { sites: [] }).sites ?? [],
    competitors: readJson(path.join(root, 'pm', 'competitors.json'), null),
  };
}

export function runReview(now = new Date().toISOString()) {
  const g = gradeProduct(snapshot());
  const dir = path.join(root, 'pm');
  fs.mkdirSync(dir, { recursive: true });
  const prev = readJson(path.join(dir, 'scorecard.json'), null);
  const card = { updated_at: now, overall: g.overall, previous_overall: prev?.overall ?? null, dimensions: g.dimensions };
  writeJson(path.join(dir, 'scorecard.json'), card);
  writeJson(path.join(dir, 'backlog.json'), { updated_at: now, items: g.backlog });
  writeJson(path.join(root, 'state', 'product-scorecard.json'), card);
  fs.writeFileSync(path.join(dir, 'SCORECARD.md'), [
    '# Whalyom product scorecard', '', `Updated ${now}. Overall **${g.overall}/5**${prev ? ` (was ${prev.overall})` : ''}. Every score comes from measured evidence (tools/product-review.mjs).`, '',
    '| Dimension | Score | Evidence |', '|---|---|---|', ...g.dimensions.map((d) => `| ${d.label} | ${d.score} | ${d.evidence} |`), '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'BACKLOG.md'), [
    '# Whalyom backlog', '', `Updated ${now}. Ranked by priority (gap × weight). "owner" items need an account, key or decision only the owner can give.`, '',
    ...g.backlog.map((b, i) => `${i + 1}. **[${b.owner}] ${b.title}** (priority ${b.priority})\n   ${b.why}`), '',
  ].join('\n'));
  return { overall: g.overall, previous: prev?.overall ?? null, backlog: g.backlog.length, top: g.backlog.slice(0, 3).map((b) => b.id) };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) console.log(JSON.stringify(runReview()));
