// Builds the live control room documents from every product workspace:
//   state/live-state.json   → db live/state   (what the system is doing now)
//   state/live-agents.json  → db live/agents  (status of every agent that is not idle)
//   state/live-events.json  → db live/events  (latest activity feed)
//   state/live-roster.json  → db live/roster  (all agents grouped by pod)
// Usage: node tools/live-snapshot.mjs [--run <name>] [--phase <text>] [--product <slug>] [--note <text>] [--idle]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { roster, pods, DEPARTMENTS } from './roster.mjs';
import { tailLines } from './lib/rotate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const productsDir = path.join(root, 'products');
const stateDir = path.join(root, 'state');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : undefined; };
const now = new Date().toISOString();
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

const byName = Object.fromEntries(roster.map((a) => [a.name, a]));
const agents = {};
let events = [];
// 'running' sits beside 'todo' so the live counts match build-state's tasks_open (todo + running).
const counts = { products: 0, active: 0, running: 0, done: 0, blocked: 0, todo: 0, approvals: 0, stale: 0 };
// A heartbeat older than this is a run that crashed or never wrote its result (needs-you-know warns at
// the same age): it shows as 'stale', never as 'active', so the room does not stay "running" forever.
const STALE_MS = 2 * 3600 * 1000;
const isStale = (startedAt) => { const t = Date.parse(startedAt ?? ''); return Number.isFinite(t) && Date.now() - t > STALE_MS; };

for (const slug of fs.existsSync(productsDir) ? fs.readdirSync(productsDir) : []) {
  if (slug.startsWith('_')) continue;
  const dir = path.join(productsDir, slug);
  const product = readJson(path.join(dir, 'product.json'), null);
  if (!product) continue;
  counts.products++;

  const tasks = readJson(path.join(dir, 'tasks.json'), []);
  for (const t of tasks) if (counts[t.status] !== undefined) counts[t.status]++;
  counts.approvals += readJson(path.join(dir, 'approvals.json'), []).filter((a) => a.status === 'pending').length;

  // Most recent finished work per agent (shown as "done" for a while after it finishes).
  for (const t of tasks) {
    if (!t.agent || !t.finished_at || !byName[t.agent]) continue;
    const prev = agents[t.agent];
    if (!prev || prev.at < t.finished_at) agents[t.agent] = { status: t.status === 'blocked' ? 'blocked' : 'done', task: t.title ?? t.id, product: slug, at: t.finished_at };
  }

  // Heartbeats of agents still working.
  const runs = path.join(dir, 'runs');
  for (const f of fs.existsSync(runs) ? fs.readdirSync(runs).filter((x) => x.endsWith('.start')) : []) {
    const h = readJson(path.join(runs, f), null);
    if (!h?.agent || !byName[h.agent]) continue;
    const stale = isStale(h.started_at);
    const prev = agents[h.agent];
    // A stale heartbeat never hides a live heartbeat or newer finished work of the same agent.
    if (!stale || !prev || (prev.status !== 'active' && String(prev.at) < String(h.started_at))) agents[h.agent] = { status: stale ? 'stale' : 'active', task: h.doing ?? h.task_id, product: slug, at: h.started_at ?? now };
    events.push({ at: h.started_at ?? now, agent: h.agent, product: slug, task_id: h.task_id, kind: stale ? 'stale' : 'start', text: h.doing ?? '' });
  }

  // tailLines also reads events.jsonl.1 … so the feed stays full right after the daemon rotates the log.
  for (const l of tailLines(path.join(dir, 'events.jsonl'), 120)) { try { events.push(JSON.parse(l)); } catch { /* skip bad line */ } }
}

counts.active = Object.values(agents).filter((a) => a.status === 'active').length;
counts.stale = Object.values(agents).filter((a) => a.status === 'stale').length;
events = events.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 60);
const label = (n) => byName[n]?.title ?? n;
for (const e of events) e.title = label(e.agent);
for (const [n, a] of Object.entries(agents)) { a.title = label(n); a.pod = pods[byName[n].pod]; a.color = byName[n].color; }

const state = {
  updated_at: now,
  mode: args.includes('--idle') || counts.active === 0 ? 'idle' : 'running',
  run: opt('--run') ?? null,
  phase: opt('--phase') ?? null,
  product: opt('--product') ?? null,
  note: opt('--note') ?? null,
  counts,
};
const podList = Object.entries(pods).map(([key, name]) => ({ key, name, agents: roster.filter((a) => a.pod === key).map((a) => ({ name: a.name, title: a.title, model: a.model })) }));

// Relationship graph from the real ledgers: product → task, task → agent, task → task (depends_on),
// agent → pod, task → approval, task → experiment. Capped so the document stays small.
const graph = { nodes: [], edges: [] };
const seen = new Set();
const node = (id, type, label, extra = {}) => { if (!seen.has(id)) { seen.add(id); graph.nodes.push({ id, type, label, ...extra }); } };
const edge = (from, to, rel) => graph.edges.push({ from, to, rel });
for (const slug of fs.existsSync(productsDir) ? fs.readdirSync(productsDir) : []) {
  if (slug.startsWith('_')) continue;
  const dir = path.join(productsDir, slug);
  const product = readJson(path.join(dir, 'product.json'), null);
  if (!product) continue;
  const pid = `p:${slug}`;
  node(pid, 'product', product.name ?? slug, { stage: product.growth_stage ?? null });
  const tasks = readJson(path.join(dir, 'tasks.json'), []);
  const recent = [...tasks].sort((x, y) => String(y.finished_at ?? y.created_at ?? '').localeCompare(String(x.finished_at ?? x.created_at ?? ''))).slice(0, 140);
  const keep = new Set(recent.map((t) => t.id));
  for (const t of recent) {
    const tid = `t:${slug}:${t.id}`;
    node(tid, 'task', t.title ?? t.id, { status: agents[t.agent]?.status === 'active' && t.status !== 'done' ? 'active' : t.status, product: slug, task_id: t.id });
    edge(pid, tid, 'has_task');
    if (t.agent && byName[t.agent]) {
      const aid = `a:${t.agent}`;
      node(aid, 'agent', byName[t.agent].title, { name: t.agent, color: byName[t.agent].color, pod: pods[byName[t.agent].pod], layer: byName[t.agent].layer, dept: DEPARTMENTS[byName[t.agent].dept].name, status: agents[t.agent]?.status ?? 'idle' });
      edge(tid, aid, 'assigned_to');
      const podId = `pod:${byName[t.agent].pod}`;
      node(podId, 'pod', pods[byName[t.agent].pod]);
      edge(aid, podId, 'member_of');
    }
    for (const d of t.depends_on ?? []) if (keep.has(d)) edge(`t:${slug}:${d}`, tid, 'unblocks');
  }
  for (const ap of readJson(path.join(dir, 'approvals.json'), [])) {
    const id = `ap:${slug}:${ap.id}`;
    node(id, 'approval', ap.title ?? ap.id, { status: ap.status, compliance: ap.compliance });
    if (ap.task_id && keep.has(ap.task_id)) edge(`t:${slug}:${ap.task_id}`, id, 'produced');
    else edge(pid, id, 'waiting_on');
  }
}
// AI transitions (agent → agent handoffs) and the product list for the switcher.
let transitionsAll = [];
const productList = [];
for (const slug of fs.existsSync(productsDir) ? fs.readdirSync(productsDir) : []) {
  if (slug.startsWith('_')) continue;
  const p = readJson(path.join(productsDir, slug, 'product.json'), null);
  if (!p) continue;
  productList.push({ slug, name: p.name ?? slug, mode: p.budget?.mode ?? 'free', stage: p.stage ?? null, currency: p.budget?.currency ?? 'USD', monthly_cap: p.budget?.monthly_cap ?? 0, spent: p.budget?.spent_this_month ?? 0, north_star: p.goals?.north_star ?? null, preset: p.preset ?? null, growth_stage: p.growth_stage ?? null, autonomy: p.autonomy?.level ?? null });
  for (const x of readJson(path.join(productsDir, slug, 'transitions.json'), [])) {
    transitionsAll.push(x);
    if (seen.has(`a:${x.from_agent}`) && seen.has(`a:${x.to_agent}`)) graph.edges.push({ from: `a:${x.from_agent}`, to: `a:${x.to_agent}`, rel: 'transition', status: x.status });
  }
}
transitionsAll = transitionsAll.sort((a, b) => String(b.updated_at ?? b.at).localeCompare(String(a.updated_at ?? a.at))).slice(0, 80);

graph.counts = graph.nodes.reduce((m, n) => ({ ...m, [n.type]: (m[n.type] ?? 0) + 1 }), {});

fs.mkdirSync(stateDir, { recursive: true });
const write = (n, v) => fs.writeFileSync(path.join(stateDir, `live-${n}.json`), JSON.stringify(v));
write('graph', { updated_at: now, ...graph });
write('transitions', { updated_at: now, transitions: transitionsAll.map(({ payload, ...x }) => x) });
write('products', { updated_at: now, products: productList });
write('state', state);
write('agents', { updated_at: now, agents });
write('events', { updated_at: now, events });
write('roster', { updated_at: now, total: roster.length, pods: podList.map((p) => ({ ...p, agents: p.agents.map((a) => ({ ...a, layer: byName[a.name].layer, dept: DEPARTMENTS[byName[a.name].dept].name, color: byName[a.name].color, family: byName[a.name].colorFamily })) })) });
console.log(JSON.stringify({ mode: state.mode, active: counts.active, events: events.length, agentsWithStatus: Object.keys(agents).length }));
