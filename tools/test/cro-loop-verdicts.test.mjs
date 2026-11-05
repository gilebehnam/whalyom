// om-cro-loop Verdicts phase, run against stub agents: a verdict the review challenges must be repaired
// (or held out of runs/) before apply-results merges it into experiments.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

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

async function run(answer) {
  const src = fs.readFileSync(path.join(root, '.claude', 'workflows', 'om-cro-loop.js'), 'utf8');
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
  const result = await fn({ slug: 'p1', now: '2026-11-03T06:00:00Z' }, agent, parallel, pipeline, () => {}, () => {}, async () => ({}), { total: null, spent: () => 0, remaining: () => Infinity });
  return { result, labels };
}

const base = (label) => {
  if (label === 'context') return { ...fill({ type: 'object', properties: {} }), name: 'P', domain: '', stage: 'live', mode: 'free', monthly_cap: 0, daily_cap: 0, spent_this_month: 0, currency: 'EUR', autonomy: 'draft', has_brief: false, channels: [], paid_channels: [] };
  if (label === 'om-bandit-cro V1') return { status: 'done', summary: 'x', files: [], judged: ['E1'], waiting: [] };
  if (label.endsWith(' VERD') || label.endsWith(' VERD-R2')) return undefined;
};

test('om-cro-loop: a passing verdict review goes straight to apply verdicts', async () => {
  const { result, labels } = await run((label) => {
    const b = base(label); if (b) return b;
    if (/ VERD$/.test(label)) return { verdict: 'pass', issues: [] };
  });
  const lastVerd = labels.lastIndexOf('om-red-team VERD');
  const apply = labels.indexOf('apply verdicts');
  assert.ok(lastVerd >= 0 && apply > lastVerd, `apply after the review: ${labels.join(' > ')}`);
  assert.ok(!labels.some((l) => l.includes('V1-FIX') || l === 'hold verdicts'), 'no repair or hold on pass');
  assert.equal(result.verdicts_held, false);
  assert.equal(result.verdict_review, 'pass');
});

test('om-cro-loop: a blocked verdict is repaired before apply verdicts', async () => {
  const { result, labels } = await run((label) => {
    const b = base(label); if (b) return b;
    if (/ VERD$/.test(label)) return { verdict: 'block', issues: ['winner declared below minimum sample'] };
    if (/ VERD-R2$/.test(label)) return { verdict: 'pass', issues: [] };
  });
  const verd = labels.indexOf('om-red-team VERD');
  const fix = labels.findIndex((l) => l.includes('V1-FIX'));
  const r2 = labels.indexOf('om-red-team VERD-R2');
  const apply = labels.indexOf('apply verdicts');
  assert.ok(verd >= 0 && fix > verd, `repair after the review: ${labels.join(' > ')}`);
  assert.ok(r2 > fix && apply > r2, 'second review, then apply');
  assert.ok(!labels.includes('hold verdicts'), 'not held once the repair passes');
  assert.equal(result.verdicts_held, false);
});

test('om-cro-loop: a verdict still blocked after repair is held out of runs/ before apply', async () => {
  const { result, labels } = await run((label) => {
    const b = base(label); if (b) return b;
    if (/ VERD(-R2)?$/.test(label)) return { verdict: 'block', issues: ['peeking'] };
  });
  const fix = labels.findIndex((l) => l.includes('V1-FIX'));
  const hold = labels.indexOf('hold verdicts');
  const apply = labels.indexOf('apply verdicts');
  assert.ok(fix >= 0 && hold > fix && apply > hold, `hold before apply: ${labels.join(' > ')}`);
  assert.equal(labels.filter((l) => l.includes('V1-FIX')).length, 1, 'one repair round only');
  assert.equal(result.verdicts_held, true);
  assert.equal(result.verdict_review, 'block');
});

test('om-cro-loop: no judged verdicts means no verdict review', async () => {
  const { labels } = await run((label) => {
    if (label === 'om-bandit-cro V1') return { status: 'done', summary: 'x', files: [], judged: [], waiting: ['E1'] };
    return base(label);
  });
  assert.ok(!labels.some((l) => / VERD/.test(l) || l.includes('V1-FIX')), labels.join(' > '));
  assert.ok(labels.includes('apply verdicts'));
});
