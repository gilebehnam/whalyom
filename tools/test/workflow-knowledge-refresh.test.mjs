// Scripted dry runs of .claude/workflows/om-knowledge-refresh.js: stub agents answer by label,
// so the tests can pin how the Teach phase ships rules and how merge counts add up.
// workflows.test.mjs covers the generic checks (meta, phases, roster names, fake-data runs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = fs.readFileSync(path.join(root, '.claude', 'workflows', 'om-knowledge-refresh.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

// Minimal schema-shaped answer: empty arrays, zeros, first enum value.
function blank(schema) {
  if (!schema) return 'ok';
  if (schema.enum) return schema.enum[0];
  switch (schema.type) {
    case 'object': return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([k, p]) => [k, blank(p)]));
    case 'array': return [];
    case 'string': return 'x';
    case 'number': case 'integer': return 0;
    case 'boolean': return false;
    default: return null;
  }
}

// answers: { [label]: object | (prompt) => object } merged over the blank answer.
async function run(answers) {
  const calls = [];
  const agent = async (prompt, opts = {}) => {
    calls.push({ label: opts.label, prompt });
    const a = answers[opts.label];
    const extra = typeof a === 'function' ? a(prompt) : a;
    if (!opts.schema) return extra ?? 'ok';
    return { ...blank(opts.schema), ...(extra ?? {}) };
  };
  const parallel = async (thunks) => Promise.all(thunks.map((t) => t()));
  const pipeline = async (items, ...stages) => Promise.all(items.map(async (item, i) => {
    let r = item;
    for (const s of stages) r = await s(r, item, i);
    return r;
  }));
  const body = src.replace(/^\s*export const meta/, 'const meta');
  const fn = new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'workflow', 'budget', body);
  const result = await fn({ now: '2026-11-03T06:00:00Z' }, agent, parallel, pipeline, () => {}, () => {}, async () => ({}), { total: null, spent: () => 0, remaining: () => Infinity });
  return { result, calls, byLabel: (l) => calls.filter((c) => c.label === l) };
}

test('om-knowledge-refresh ships only the proposals the red team passed, never apply all', async () => {
  const { byLabel, result } = await run({
    'apply + check': { added: 3 },
    'skill smith': { ids: ['EVO-2026-11-03-om-seo', 'EVO-2026-11-03-om-ads', 'EVO-2026-11-03-om-email'] },
    'red-team EVO-2026-11-03-om-ads': { verdict: 'block', issues: ['overstates the fact'] },
  });
  const ship = byLabel('ship rules');
  assert.equal(ship.length, 1);
  const p = ship[0].prompt;
  assert.ok(!p.includes('apply all'), 'ship step must not run evolve apply all');
  assert.ok(p.includes('apply EVO-2026-11-03-om-seo'));
  assert.ok(p.includes('apply EVO-2026-11-03-om-email'));
  assert.ok(!p.includes('EVO-2026-11-03-om-ads'), 'a blocked id must not reach the ship step');
  assert.ok(p.includes('node tools/build-agents.mjs'));
  assert.deepEqual(result.blocked, ['EVO-2026-11-03-om-ads']);
});

test('om-knowledge-refresh skips the ship step when every proposal is blocked', async () => {
  const { byLabel } = await run({
    'apply + check': { added: 1 },
    'skill smith': { ids: ['EVO-2026-11-03-om-seo'] },
    'red-team EVO-2026-11-03-om-seo': { verdict: 'block', issues: ['duplicate'] },
  });
  assert.equal(byLabel('ship rules').length, 0);
  assert.equal(byLabel('park blocked').length, 1);
});

test('om-knowledge-refresh never ships an id that is not a plain proposal id', async () => {
  const { byLabel } = await run({
    'apply + check': { added: 1 },
    'skill smith': { ids: ['all', 'EVO-2026-11-03-om-seo --owner', 'EVO-2026-11-03-om-seo'] },
  });
  const p = byLabel('ship rules')[0].prompt;
  assert.ok(!p.includes('apply all'));
  assert.ok(!p.includes('--owner'));
  assert.ok(p.includes('apply EVO-2026-11-03-om-seo --now'));
});

test('om-knowledge-refresh keeps the facts added by the first merge when a later merge adds none', async () => {
  const { byLabel, result } = await run({
    'apply + check': { added: 5, rejected: 1, stale: 0, facts_active: 40 },
    'find gaps': { gaps: [{ topic: 'search', facts: 3, need: 4 }] },
    'grow search': { run_id: 'KR-2026-11-03-G1', facts: 2 },
    'verify grow search': { keep: 0, fix: 0, reject: 2 },
    'apply growth': { added: 0, rejected: 2, stale: 0, facts_active: 40 },
    'skill smith': { ids: [] },
    'active products': { slugs: ['demo'] },
  });
  assert.equal(byLabel('apply growth').length, 1, 'the growth merge ran');
  assert.equal(byLabel('skill smith').length, 1, 'Teach still runs for the facts verified earlier');
  assert.equal(byLabel('active products').length, 1, 'Impact still alerts products');
  assert.equal(byLabel('impact demo').length, 1);
  const report = byLabel('reporter')[0].prompt;
  assert.ok(report.includes('facts added (5)'), 'report shows the run total');
  assert.ok(report.includes('rejected (3)'));
  assert.equal(result.merged.added, 5);
});
