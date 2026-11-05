// om-autopilot stops before any planning or waves when the product is paused or
// kill-switched. Dry run against stub agents; nothing is spawned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = fs.readFileSync(path.join(root, '.claude', 'workflows', 'om-autopilot.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function run(haltReply) {
  const calls = [];
  const agent = async (prompt, opts = {}) => {
    calls.push(opts.label ?? '');
    if (opts.schema?.properties?.kill) return haltReply;
    if (opts.schema?.properties?.ready) return { ready: [], open: 1, done: 0, blocked: 0, total: 1 };
    return 'ok';
  };
  const noop = async () => [];
  const body = src.replace(/^\s*export const meta/, 'const meta');
  const fn = new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'workflow', 'budget', body);
  const result = await fn({ slug: 'dry-run-product', now: '2026-11-03T06:00:00Z' }, agent,
    async (ts) => Promise.all(ts.map((t) => t())), noop, () => {}, () => {}, async () => ({}), {});
  return { result, calls };
}

test('om-autopilot: paused product returns skipped after one agent call', async () => {
  const { result, calls } = await run({ stage: 'paused', kill: false });
  assert.deepEqual(result, { slug: 'dry-run-product', skipped: 'paused' });
  assert.equal(calls.length, 1);
  assert.ok(!calls.some((l) => /cmo plan|wave|ops-doctor/.test(l)));
});

test('om-autopilot: autonomy.kill / OM_KILL also stops the run', async () => {
  const { result, calls } = await run({ stage: 'active', kill: true });
  assert.equal(result.skipped, 'paused');
  assert.equal(calls.length, 1);
});

test('om-autopilot: active product runs the normal path with the usual return shape', async () => {
  const { result, calls } = await run({ stage: 'active', kill: false });
  assert.equal(result.skipped, undefined);
  assert.ok(calls.includes('ops-doctor'));
  for (const k of ['slug', 'waves', 'tasksRun', 'remainingReady', 'open', 'blocked', 'report']) assert.ok(k in result, k);
});
