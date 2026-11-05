// Dry runs of om-paid-sniper's review gate and approval merge (no agents are spawned).
//   - a reviewer that returns null (died or skipped) blocks; the gate never fails open
//   - the approval merge gets the script's final verdicts as JSON, and a passing -R2 round supersedes round 1
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = fs.readFileSync(path.join(root, '.claude', 'workflows', 'om-paid-sniper.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

// Schema-shaped fake data for the paid sniper path: hybrid mode, sniper true, landing match true.
function fake(schema, key) {
  if (!schema) return 'ok';
  if (schema.enum) return schema.enum[schema.enum.length - 1];
  switch (schema.type) {
    case 'object': return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([k, p]) => [k, fake(p, k)]));
    case 'array': return [fake(schema.items)];
    case 'string': return 'x';
    case 'number': case 'integer': return /spent/.test(key ?? '') ? 0 : 50;
    case 'boolean': return true;
    default: return null;
  }
}
const isVerdict = (opts) => Boolean(opts.schema?.properties?.verdict);

// verdictFor(label) returns the stub's answer for a VERDICT call (null = the reviewer returned nothing).
async function run(verdictFor) {
  const calls = [];
  const agent = async (prompt, opts = {}) => {
    calls.push({ prompt, opts });
    if (isVerdict(opts)) return verdictFor(opts.label ?? '');
    return opts.schema ? fake(opts.schema) : 'ok';
  };
  const parallel = async (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)));
  const noop = () => {};
  const body = src.replace(/^\s*export const meta/, 'const meta');
  const fn = new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'workflow', 'budget', body);
  const result = await fn({ slug: 'dry-run-product', now: '2026-11-03T06:00:00Z' }, agent, parallel, async () => [], noop, noop, async () => ({}), {});
  return { result, calls };
}
const mergePrompt = (calls) => calls.find((c) => /^merge reviews/.test(c.opts.label ?? ''))?.prompt ?? '';
const finalVerdicts = (prompt) => JSON.parse(/Final verdicts \(JSON\): (\[.*\])/.exec(prompt)?.[1] ?? 'null');

test('om-paid-sniper: reviewers that return no verdict block the ads (fails closed)', async () => {
  const { result, calls } = await run(() => null);
  assert.equal(result.review, 'block');
  const final = finalVerdicts(mergePrompt(calls));
  assert.ok(Array.isArray(final), 'merge prompt carries the final-verdict JSON');
  const ads = final.find((r) => r.code === 'ADS');
  assert.equal(ads.verdict, 'block');
  assert.ok(ads.issues.some((i) => /returned no verdict/.test(i)), 'names the reviewer that returned nothing');
});

test('om-paid-sniper: one missing reviewer among passing ones still blocks', async () => {
  const { result } = await run((label) => (label.startsWith('om-red-team') ? null : { verdict: 'pass', issues: [] }));
  assert.equal(result.review, 'block');
});

test('om-paid-sniper: merge gets the final verdicts and a passing -R2 supersedes round 1', async () => {
  const { result, calls } = await run((label) => (label.includes('-R2') ? { verdict: 'pass', issues: [] } : { verdict: 'block', issues: ['claim not in claims.md'] }));
  assert.equal(result.review, 'pass');
  const prompt = mergePrompt(calls);
  assert.match(prompt, /Use ONLY these final verdicts/);
  assert.match(prompt, /matches no listed code is "block"/);
  const final = finalVerdicts(prompt);
  assert.deepEqual(final.map((r) => [r.code, r.round, r.verdict]), [['ADS', 2, 'pass']]);
  assert.ok(final[0].files.includes('sniper'), 'the verdict names the reviewed files');
  assert.doesNotMatch(prompt, /Forced block/, 'no forced block unless the script asks for one');
});

test('om-paid-sniper: a block that survives repair reaches the merge as block', async () => {
  const { result, calls } = await run(() => ({ verdict: 'block', issues: ['spend above the caps'] }));
  assert.equal(result.review, 'block');
  const final = finalVerdicts(mergePrompt(calls));
  assert.deepEqual(final.map((r) => [r.code, r.round, r.verdict]), [['ADS', 2, 'block']]);
});
