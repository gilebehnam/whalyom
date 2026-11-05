// Aggregates every products/<slug>/ workspace into the dashboard datasets in state/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { roster, pods } from './roster.mjs';
import { spentThisMonth } from './budget.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const productsDir = path.join(root, 'products');
const stateDir = path.join(root, 'state');
fs.mkdirSync(stateDir, { recursive: true });

const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};
// Browser-reported rows (client_* metrics, satellite snippet or edge beacon) are unverified; same rule
// as needs-you-know. Server-side rows (Stripe, platform APIs, owner imports) are verified.
const clientSide = (k) => String(k?.metric ?? '').startsWith('client_') || ['satellite', 'edge'].includes(k?.source);
const now = new Date().toISOString();
const podOf = Object.fromEntries(roster.map((a) => [a.name, pods[a.pod]]));

const products = [];
const tasks = [];
const approvals = [];
const experiments = [];
const kpis = [];

for (const slug of fs.readdirSync(productsDir)) {
  if (slug.startsWith('_')) continue;
  const dir = path.join(productsDir, slug);
  if (!fs.statSync(dir).isDirectory()) continue;
  const p = readJson(path.join(dir, 'product.json'), null);
  if (!p) continue;

  const t = readJson(path.join(dir, 'tasks.json'), []);
  const a = readJson(path.join(dir, 'approvals.json'), []);
  const e = readJson(path.join(dir, 'experiments.json'), []);
  const k = readJson(path.join(dir, 'metrics', 'kpis.json'), []);

  const count = (s) => t.filter((x) => x.status === s).length;
  products.push({
    product: slug,
    name: p.name,
    domain: p.domain,
    stage: p.stage,
    goal: p.goals?.primary ?? '',
    monthly_cap: p.budget?.monthly_cap ?? 0,
    currency: p.budget?.currency ?? 'USD',
    // Live spend for the current month (ledger + platform spend rows in kpis.json, larger per day).
    // budget.spent_this_month is refreshed only by tools/budget.mjs and goes stale across a month change.
    spent: spentThisMonth(path.join(dir, 'ledger.jsonl'), now, { kpis: Array.isArray(k) ? k : [] }),
    tasks_open: count('todo') + count('running'),
    tasks_done: count('done'),
    tasks_blocked: count('blocked'),
    approvals_pending: a.filter((x) => x.status === 'pending').length,
  });
  for (const x of t) tasks.push({ product: slug, id: x.id, title: x.title, agent: x.agent, pod: podOf[x.agent] ?? '', status: x.status, score: x.score ?? null, updated: x.finished_at ?? x.started_at ?? x.created_at ?? null });
  for (const x of a) approvals.push({ product: slug, id: x.id, type: x.type, title: x.title, agent: x.agent, compliance: x.compliance ?? 'unchecked', status: x.status, created_at: x.created_at ?? null });
  for (const x of e) experiments.push({ product: slug, id: x.id, hypothesis: x.hypothesis, metric: x.metric, status: x.status, result: x.result ?? '' });
  for (const x of Array.isArray(k) ? k : []) if (x && typeof x === 'object') kpis.push({ product: slug, ...x, date: x.date ?? null, channel: x.channel ?? null, campaign: x.campaign ?? null, metric: x.metric ?? null, value: x.value ?? null, source: x.source ?? null, verified: !clientSide(x) });
}

// The dashboard can't read a file with zero rows, so an empty dataset gets one
// placeholder row (every column null, _empty: true) that the page filters out.
const columns = {
  products: ['product', 'name', 'domain', 'stage', 'goal', 'currency', 'monthly_cap', 'spent', 'tasks_open', 'tasks_done', 'tasks_blocked', 'approvals_pending'],
  tasks: ['product', 'id', 'title', 'agent', 'pod', 'status', 'score', 'updated'],
  approvals: ['product', 'id', 'type', 'title', 'agent', 'compliance', 'status', 'created_at'],
  experiments: ['product', 'id', 'hypothesis', 'metric', 'status', 'result'],
  kpis: ['product', 'date', 'channel', 'campaign', 'metric', 'value', 'source', 'verified'],
};
const write = (name, rows) => {
  const out = rows.length ? rows : [{ ...Object.fromEntries(columns[name].map((c) => [c, null])), _empty: true }];
  fs.writeFileSync(path.join(stateDir, `${name}.json`), JSON.stringify(out, null, 2));
};
write('products', products);
write('tasks', tasks);
write('approvals', approvals);
write('experiments', experiments);
write('kpis', kpis);
console.log(`state/: ${products.length} products, ${tasks.length} tasks, ${approvals.length} approvals, ${experiments.length} experiments, ${kpis.length} KPI rows.`);
