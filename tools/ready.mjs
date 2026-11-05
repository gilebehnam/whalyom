// Prints the tasks that can run now (status todo, every dependency done) as JSON.
// Usage: node tools/ready.mjs <slug> [limit]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { instanceFor } from './agent-factory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [slug, limitArg] = process.argv.slice(2);
if (!slug) { console.error('Usage: node tools/ready.mjs <slug> [limit]'); process.exit(2); }
const limit = Number(limitArg) || 10;

let product = {};
try { product = JSON.parse(fs.readFileSync(path.join(root, 'products', slug, 'product.json'), 'utf8')); } catch { /* no product file */ }
let tasks = [];
try { tasks = JSON.parse(fs.readFileSync(path.join(root, 'products', slug, 'tasks.json'), 'utf8')); } catch { /* no tasks yet */ }
// Pre-transition gate: an upstream task only unblocks its dependents when it is done and, if it
// was scored, scored at least autonomy.transition_gate (1–5 scale, default 3).
const gate = Number(product.autonomy?.transition_gate ?? 3);
const done = new Set(tasks.filter((t) => t.status === 'done' && (t.score == null || Number(t.score) >= gate)).map((t) => t.id));
const ready = tasks
  .filter((t) => t.status === 'todo' && (t.depends_on ?? []).every((d) => done.has(d)))
  .sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5))
  .slice(0, limit)
  .map(({ id, title, agent, brief, depends_on, channel }) => {
    // Each task runs as a micro-agent instance: the core agent specialized for this product's business type and channel.
    const inst = instanceFor(product, agent, channel);
    const spec = inst?.specialization ? `\nSpecialization (${inst.id}): ${inst.specialization}.` : '';
    return { id, title, agent, instance: inst?.id ?? agent, brief: (brief ?? title) + spec, depends_on: depends_on ?? [] };
  });

const open = tasks.filter((t) => t.status === 'todo' || t.status === 'running').length;
console.log(JSON.stringify({ slug, ready, open, done: done.size, blocked: tasks.filter((t) => t.status === 'blocked').length, total: tasks.length }));
