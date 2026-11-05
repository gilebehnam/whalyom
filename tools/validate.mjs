// Checks a product workspace for broken JSON, unknown agents, bad dependencies and stuck tasks.
// Usage: node tools/validate.mjs <slug>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { roster } from './roster.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2];
if (!slug) { console.error('Usage: node tools/validate.mjs <slug>'); process.exit(2); }
const dir = path.join(root, 'products', slug);
const problems = [];

const load = (name, required) => {
  const f = path.join(dir, name);
  if (!fs.existsSync(f)) { if (required) problems.push(`missing ${name}`); return null; }
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { problems.push(`${name}: invalid JSON (${e.message})`); return null; }
};

const product = load('product.json', true);
// The ledgers must be arrays; apply-results refuses to merge into anything else.
const list = (name) => { const v = load(name, true); if (v != null && !Array.isArray(v)) { problems.push(`${name}: not an array`); return []; } return v ?? []; };
const tasks = list('tasks.json').filter((t) => (t && typeof t === 'object') || (problems.push('tasks.json: an entry is not an object'), false));
list('approvals.json');
list('experiments.json');

if (product) {
  if (!product.domain && !fs.existsSync(path.join(dir, 'brief.md'))) problems.push('product.json: no domain and no brief.md');
  const b = product.budget ?? {};
  if ((b.spent_this_month ?? 0) > (b.monthly_cap ?? 0)) problems.push('budget: spent_this_month is over monthly_cap');
}

const agents = new Set(roster.map((a) => a.name));
const ids = new Set(tasks.map((t) => t.id));
const STALE_MS = 6 * 60 * 60 * 1000;
for (const t of tasks) {
  if (!agents.has(t.agent)) problems.push(`task ${t.id}: unknown agent ${t.agent}`);
  for (const d of t.depends_on ?? []) if (!ids.has(d)) problems.push(`task ${t.id}: depends on missing task ${d}`);
  if (t.status === 'running' && t.started_at && Date.now() - Date.parse(t.started_at) > STALE_MS) problems.push(`task ${t.id}: running for over 6 hours`);
}

if (problems.length) { console.log(`${slug}: ${problems.length} problem(s)\n- ` + problems.join('\n- ')); process.exit(1); }
console.log(`${slug}: OK (${tasks.length} tasks)`);
