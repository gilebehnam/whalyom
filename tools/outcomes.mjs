// Outcome credit: which agents' work actually produced leads and sales. The evaluator scores an output
// against its brief; this scores it against the market. For each product it joins the funnel report
// (leads, sales and revenue per channel, tools/funnel.mjs) with the approvals that went out (agent,
// channel or utm_source, executed) and splits each channel's results across the agents whose items went
// out on it, in proportion to their items. Agents whose items have been out for 14+ days on a channel
// with no lead are listed as "no result yet": the evolution loop and the product manager read both.
// When the pipeline ledger (funnel/pipeline.json) is there, only results that came after an item went out
// count: a lead is shared across the items on its first-touch channel executed before its first_seen, a
// sale across the items executed before its won_at. Leads and sales from before any item went out (old
// organic or referral traffic) are credited to no agent. Only counts leave this tool, never lead rows.
//   products/<slug>/reports/agent-outcomes.json   per product
//   state/agent-outcomes.json                     every product, per agent (no personal data)
// Usage: node tools/outcomes.mjs [<slug>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, root } from './lib/env.mjs';

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').slice(0, 40);
const round = (n) => Math.round(n * 100) / 100;

// Per channel and agent, the leads, sales and revenue that came after that agent's items went out on it.
// Each lead (by first_seen) and each sale (by won_at) is split across the items executed before it.
function windowedCredit(pipeline, byChannel, now) {
  const at = (a) => { const t = Date.parse(a.executed_at ?? now); return Number.isFinite(t) ? t : Date.parse(now); };
  const credit = {};
  for (const r of pipeline?.leads ?? []) {
    if (!r || r.suspected_bot) continue;
    const ch = norm(r.channel ?? 'direct');
    const items = byChannel[ch];
    if (!items) continue;
    const share = (when, k, v) => {
      const t = Date.parse(when ?? '');
      if (!Number.isFinite(t)) return;
      const before = items.filter((a) => at(a) <= t);
      for (const a of before) ((credit[ch] ??= {})[a.agent] ??= { leads: 0, won: 0, revenue: 0 })[k] += v / before.length;
    };
    share(r.first_seen, 'leads', 1);
    if (r.won_at) { share(r.won_at, 'won', 1); share(r.won_at, 'revenue', Number(r.value) || 0); }
  }
  return credit;
}

// Pure: report = funnel/report.json, approvals = approvals.json, tasks = tasks.json, pipeline =
// funnel/pipeline.json (optional; when given, results are windowed to after each item went out).
export function creditAgents({ report, approvals = [], tasks = [], pipeline = null, now = new Date().toISOString() }) {
  const channels = Object.fromEntries((report?.channels ?? []).map((c) => [c.channel, c]));
  const out = {};
  const row = (agent) => (out[agent] ??= { agent, items_out: 0, channels: [], leads: 0, won: 0, revenue: 0, waiting_items: 0, no_result_items: 0, tasks_done: 0, tasks_blocked: 0, scores: [] });
  const sent = approvals.filter((a) => a.agent && a.status === 'executed');
  const byChannel = {};
  for (const a of sent) (byChannel[norm(a.utm_source ?? a.channel ?? 'site')] ??= []).push(a);
  const windowed = Array.isArray(pipeline?.leads) ? windowedCredit(pipeline, byChannel, now) : null;
  for (const [ch, items] of Object.entries(byChannel)) {
    const c = channels[ch];
    const per = {};
    for (const a of items) per[a.agent] = (per[a.agent] ?? 0) + 1;
    for (const [agent, n] of Object.entries(per)) {
      const r = row(agent); const share = n / items.length;
      r.items_out += n; if (!r.channels.includes(ch)) r.channels.push(ch);
      let gotLeads;
      if (windowed) {
        const w = windowed[ch]?.[agent] ?? { leads: 0, won: 0, revenue: 0 };
        r.leads = round(r.leads + w.leads); r.won = round(r.won + w.won); r.revenue = round(r.revenue + w.revenue);
        gotLeads = w.leads > 0;
      } else {
        if (c) { r.leads = round(r.leads + c.leads * share); r.won = round(r.won + c.won * share); r.revenue = round(r.revenue + c.revenue * share); }
        gotLeads = Boolean(c) && c.leads > 0;
      }
      const old = items.filter((a) => a.agent === agent && Date.parse(now) - Date.parse(a.executed_at ?? now) >= 14 * 86400000).length;
      if (!gotLeads) { r.no_result_items += old; r.waiting_items += n - old; }
    }
  }
  for (const t of tasks) {
    if (!t.agent) continue;
    const r = row(t.agent);
    if (t.status === 'done') r.tasks_done++;
    if (t.status === 'blocked') r.tasks_blocked++;
    if (Number.isFinite(Number(t.score)) && t.score !== null) r.scores.push(Number(t.score));
  }
  return Object.values(out).map(({ scores, ...r }) => ({ ...r, avg_score: scores.length ? round(scores.reduce((s, x) => s + x, 0) / scores.length) : null }))
    .sort((a, b) => b.revenue - a.revenue || b.leads - a.leads || b.tasks_done - a.tasks_done);
}

const slugs = () => {
  const dir = path.join(root, 'products');
  return (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((s) => !s.startsWith('_') && fs.existsSync(path.join(dir, s, 'product.json')));
};

export function runOutcomes(only = null, now = new Date().toISOString()) {
  const total = {};
  for (const slug of only ? [only] : slugs()) {
    const dir = path.join(root, 'products', slug);
    const rows = creditAgents({ report: readJson(path.join(dir, 'funnel', 'report.json'), null), pipeline: readJson(path.join(dir, 'funnel', 'pipeline.json'), null), approvals: readJson(path.join(dir, 'approvals.json'), []), tasks: readJson(path.join(dir, 'tasks.json'), []), now });
    fs.mkdirSync(path.join(dir, 'reports'), { recursive: true });
    writeJson(path.join(dir, 'reports', 'agent-outcomes.json'), { updated_at: now, agents: rows });
    for (const r of rows) {
      const t = (total[r.agent] ??= { agent: r.agent, products: 0, items_out: 0, leads: 0, won: 0, revenue: 0, no_result_items: 0, tasks_done: 0, tasks_blocked: 0 });
      t.products++; for (const k of ['items_out', 'leads', 'won', 'revenue', 'no_result_items', 'tasks_done', 'tasks_blocked']) t[k] = round(t[k] + r[k]);
    }
  }
  const agents = Object.values(total).sort((a, b) => b.revenue - a.revenue || b.leads - a.leads);
  fs.mkdirSync(path.join(root, 'state'), { recursive: true });
  writeJson(path.join(root, 'state', 'agent-outcomes.json'), { updated_at: now, agents });
  return { agents: agents.length, with_sales: agents.filter((a) => a.won > 0).length, with_leads: agents.filter((a) => a.leads > 0).length };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) console.log(JSON.stringify(runOutcomes(process.argv[2] ?? null)));
