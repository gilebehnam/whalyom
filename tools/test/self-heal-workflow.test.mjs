// Recovery paths of om-self-heal and om-product-evolution, run against stub agents.
// Uncommitted work is not recoverable from git, so a fix the red team blocks, or a suite left red,
// must be undone by the workflow itself: om-self-heal restores the round's backups and
// om-product-evolution measures the suite again after its repair round.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

// Schema-shaped filler for answers the scenario does not set.
function fill(schema) {
  if (!schema) return 'ok';
  if (schema.enum) return schema.enum[0];
  switch (schema.type) {
    case 'object': return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([k, p]) => [k, fill(p)]));
    case 'array': return [fill(schema.items)];
    case 'string': return 'x';
    case 'number': case 'integer': return 1;
    case 'boolean': return true;
    default: return null;
  }
}

// Runs a workflow; answer(label, schema, n) returns the reply for the n-th call with that label, or undefined.
async function run(name, answer, args = { now: '2026-11-03T06:00:00Z' }) {
  const src = fs.readFileSync(path.join(root, '.claude', 'workflows', `${name}.js`), 'utf8');
  const labels = [];
  const seen = {};
  const agent = async (prompt, opts = {}) => {
    const label = opts.label ?? '';
    labels.push(label);
    seen[label] = (seen[label] ?? 0) + 1;
    const r = answer(label, opts.schema, seen[label]);
    return r === undefined ? fill(opts.schema) : r;
  };
  const pipeline = async (items, ...stages) => Promise.all(items.map(async (item, i) => {
    let r = item;
    for (const s of stages) r = await s(r, item, i);
    return r;
  }));
  const parallel = async (thunks) => Promise.all(thunks.map((t) => t()));
  const body = src.replace(/^\s*export const meta/, 'const meta');
  const fn = new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'workflow', 'budget', body);
  const result = await fn(args, agent, parallel, pipeline, () => {}, () => {}, async () => ({}), { total: null, spent: () => 0, remaining: () => Infinity });
  return { result, labels };
}

test('om-self-heal: a red-team block restores the round before the suite runs', async () => {
  const { result, labels } = await run('om-self-heal', (label) => {
    if (label === 'list products') return { slugs: ['p1'] };
    if (label === 'self-debug') return { ok: false, problems: 2, brief: 'x' };
    if (label.startsWith('bug-hunter')) return { summary: 'changed a guard', files: ['tools/policy.mjs'] };
    if (label.startsWith('red-team')) return { verdict: 'block', issues: ['loosens a guard'] };
    if (label.startsWith('restore')) return { restored: ['tools/policy.mjs'], passed: true, summary: 'pass' };
    if (label.startsWith('npm test')) return { passed: true, summary: 'pass', failing: [] };
  });
  const red = labels.indexOf('red-team R1');
  const restore = labels.findIndex((l) => l.startsWith('restore'));
  const tests = labels.indexOf('npm test');
  assert.ok(red >= 0, 'the red team ran');
  assert.ok(restore > red, `a restore runs after the red team: ${labels.join(' > ')}`);
  assert.ok(tests > restore, 'npm test runs after the restore');
  assert.equal(labels.filter((l) => l.startsWith('bug-hunter')).length, 1, 'no further round after a block');
  assert.match(result.halted, /blocked by the red team/);
  assert.deepEqual(result.restores.map((r) => r.why), ['red-team block']);
  assert.equal(result.rounds[0].restored, true);
});

test('om-self-heal: the bug hunter is told to back up files before editing', () => {
  const src = fs.readFileSync(path.join(root, '.claude', 'workflows', 'om-self-heal.js'), 'utf8');
  assert.ok(src.includes('state/self-heal/backup/${PFX}-R${r}'), 'backups go to state/self-heal/backup/<PFX>-R<n>');
  assert.match(src, /Before you edit any existing file, copy it to \$\{backupDir\(round\)\}/);
  assert.match(src, /"Backups" section/);
});

test('om-self-heal: a red suite after rounds that changed files restores them and runs the suite again', async () => {
  const { result, labels } = await run('om-self-heal', (label, schema, n) => {
    if (label === 'list products') return { slugs: ['p1'] };
    if (label === 'self-debug') return { ok: false, problems: 1, brief: 'x' };
    if (label === 'self-debug R1') return { ok: true, problems: 0, brief: '' };
    if (label.startsWith('bug-hunter')) return { summary: 'fix', files: ['tools/x.mjs'] };
    if (label.startsWith('red-team')) return { verdict: 'pass', issues: [] };
    if (label.startsWith('restore')) return { restored: ['tools/x.mjs'], passed: true, summary: 'pass' };
    if (label === 'npm test') return { passed: false, summary: '1 failing', failing: ['t1'] };
    if (label === 'npm test after restore') return { passed: true, summary: 'all pass', failing: [] };
  });
  const first = labels.indexOf('npm test');
  const restore = labels.indexOf('restore R1');
  const again = labels.indexOf('npm test after restore');
  assert.ok(first >= 0 && restore > first && again > restore, `order: ${labels.join(' > ')}`);
  assert.equal(result.tests.passed, true, 'the result carries the suite after the restore');
  assert.deepEqual(result.restores.map((r) => r.why), ['suite failing']);
});

test('om-self-heal: a green suite or rounds without changes trigger no restore', async () => {
  const { labels } = await run('om-self-heal', (label) => {
    if (label === 'list products') return { slugs: ['p1'] };
    if (label === 'self-debug') return { ok: false, problems: 1, brief: 'x' };
    if (label === 'self-debug R1') return { ok: true, problems: 0, brief: '' };
    if (label.startsWith('bug-hunter')) return { summary: 'data only', files: [] };
    if (label.startsWith('red-team')) return { verdict: 'pass', issues: [] };
    if (label.startsWith('npm test')) return { passed: false, summary: '1 failing', failing: ['t1'] };
  });
  assert.equal(labels.filter((l) => l.startsWith('restore')).length, 0);
  assert.equal(labels.filter((l) => l.startsWith('npm test')).length, 1);
});

test('om-product-evolution: a failing suite is measured again after the repair round', async () => {
  const { result, labels } = await run('om-product-evolution', (label, schema, n) => {
    if (label === 'product manager') return { items: [], owner_requests: 0 };
    if (label === 'npm test') return { passed: false, summary: '1 failing', failing: ['t1'] };
    if (label === 'npm test after repair') return { passed: true, summary: 'all pass', failing: [] };
  }, { now: '2026-11-03T06:00:00Z', compete: false });
  const runs = labels.filter((l) => l.startsWith('npm test'));
  assert.equal(runs.length, 2, `two npm test calls: ${labels.join(' > ')}`);
  assert.ok(labels.indexOf('repair') < labels.indexOf('npm test after repair'), 'the second run follows the repair');
  assert.equal(result.tests, true, 'the return value uses the second result');
});

test('om-product-evolution: a passing suite runs once and needs no repair', async () => {
  const { result, labels } = await run('om-product-evolution', (label) => {
    if (label === 'product manager') return { items: [], owner_requests: 0 };
    if (label === 'npm test') return { passed: true, summary: 'all pass', failing: [] };
  }, { now: '2026-11-03T06:00:00Z', compete: false });
  assert.equal(labels.filter((l) => l.startsWith('npm test')).length, 1);
  assert.ok(!labels.includes('repair'));
  assert.equal(result.tests, true);
});
