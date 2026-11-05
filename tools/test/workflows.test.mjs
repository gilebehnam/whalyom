// Static and dry-run checks for every saved workflow in .claude/workflows/.
// Nothing here spawns an agent: the dry run executes each script against stub
// agent()/parallel()/pipeline() hooks that return schema-shaped fake data.
// Checks per workflow:
//   - starts with `export const meta = {...}`, a pure literal with name, description, phases
//   - meta.name matches the file name
//   - the script compiles as an async function body (the Workflow runtime's shape)
//   - every phase('…') call has a meta.phases entry and every meta phase is used
//   - every om-* name in the script is a roster agent in .claude/agents/ (or a workflow/skill name)
//   - no Date.now(), Math.random(), new Date(), import or require
//   - dry runs (two fake-data variants) finish, use only existing agent types and declared phases
//   - Whalyom workflows end with apply-results and a Report phase, and use adversarial review
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const wfDir = path.join(root, '.claude', 'workflows');
const files = fs.readdirSync(wfDir).filter((f) => f.endsWith('.js')).sort();
const agents = new Set(fs.readdirSync(path.join(root, '.claude', 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)));
const workflowNames = new Set(files.map((f) => f.slice(0, -3)));
const skillNames = new Set(fs.readdirSync(path.join(root, '.claude', 'skills')));
// The first three workflows predate the shared helper block; the rest must follow it.
const ORIGINAL = new Set(['om-onboard', 'om-autopilot', 'om-portfolio']);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

// Returns [literal, endIndex] for the object literal starting at src[start] === '{'.
function matchBraces(src, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return [src.slice(start, i + 1), i + 1];
  }
  throw new Error('unbalanced braces in meta');
}

function parseMeta(src) {
  const m = /^\s*export const meta = \{/.exec(src);
  assert.ok(m, 'script must begin with `export const meta = {`');
  const [literal] = matchBraces(src, m[0].length - 1);
  // Outside string contents: no template literals, no spreads, and the only bare words allowed
  // are property keys and true/false/null.
  const noStrings = literal.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, '""');
  assert.ok(!noStrings.includes('`'), 'meta must not use template literals');
  assert.ok(!noStrings.includes('...'), 'meta must not use spreads');
  const words = noStrings.replace(/[A-Za-z_$][\w$]*\s*:/g, ':').match(/[A-Za-z_$][\w$]*/g) ?? [];
  const bad = words.filter((w) => !['true', 'false', 'null'].includes(w));
  assert.deepEqual(bad, [], `meta must be a pure literal; found identifiers: ${bad.join(', ')}`);
  return new Function(`"use strict"; return (${literal});`)();
}

// Fake data shaped like a JSON schema, in three variants so every budget branch runs:
//   a: first enum value (free mode, pass verdicts), small numbers, booleans false
//   b: last enum value (hybrid mode, block verdicts), large numbers, booleans true (sniper)
//   c: last enum value, large numbers, booleans false (portfolio, not ready, not ok)
// Spend-so-far fields are always 0 so the paid paths are not cut short by a full cap.
function fake(schema, v, key) {
  if (!schema) return 'ok';
  // Fields that name a roster agent (task queues) get a real one.
  if (key === 'agent' && schema.type === 'string') return 'om-writer';
  if (schema.enum) return v === 'a' ? schema.enum[0] : schema.enum[schema.enum.length - 1];
  switch (schema.type) {
    case 'object': return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([k, p]) => [k, fake(p, v, k)]));
    case 'array': return [fake(schema.items, v)];
    case 'string': return 'x';
    case 'number': case 'integer': return /spent/.test(key ?? '') ? 0 : v === 'a' ? 1 : 500;
    case 'boolean': return v === 'b';
    default: return null;
  }
}

async function dryRun(src, meta, variant) {
  const titles = new Set((meta.phases ?? []).map((p) => p.title));
  const problems = [];
  const seenPhases = new Set();
  let calls = 0;
  const agent = async (prompt, opts = {}) => {
    if (++calls > 400) throw new Error('dry run: more than 400 agent calls (runaway loop?)');
    assert.equal(typeof prompt, 'string');
    if (opts.agentType && opts.agentType !== 'general-purpose' && !agents.has(opts.agentType)) problems.push(`unknown agentType ${opts.agentType}`);
    if (opts.phase && !titles.has(opts.phase)) problems.push(`agent phase "${opts.phase}" not in meta.phases`);
    if (opts.schema) {
      assert.equal(opts.schema.type, 'object', 'schema root must be an object');
      for (const r of opts.schema.required ?? []) if (!(r in (opts.schema.properties ?? {}))) problems.push(`schema requires missing property ${r}`);
      return fake(opts.schema, variant);
    }
    return 'ok';
  };
  const parallel = async (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch((e) => { problems.push(`parallel thunk threw: ${e.message}`); return null; })));
  const pipeline = async (items, ...stages) => Promise.all(items.map(async (item, i) => {
    let r = item;
    for (const s of stages) {
      try { r = await s(r, item, i); } catch (e) { problems.push(`pipeline stage threw: ${e.message}`); return null; }
    }
    return r;
  }));
  const phase = (t) => { seenPhases.add(t); if (!titles.has(t)) problems.push(`phase("${t}") not in meta.phases`); };
  const log = () => {};
  const workflow = async (name) => { if (!workflowNames.has(name)) problems.push(`unknown workflow ${name}`); return {}; };
  const budget = { total: null, spent: () => 0, remaining: () => Infinity };
  const body = src.replace(/^\s*export const meta/, 'const meta');
  const fn = new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'workflow', 'budget', body);
  const result = await fn({ slug: 'dry-run-product', now: '2026-11-03T06:00:00Z' }, agent, parallel, pipeline, phase, log, workflow, budget);
  return { result, problems, calls, seenPhases };
}

test('there are saved workflows to check', () => {
  assert.ok(files.length >= 3, 'expected at least the three original workflows');
});

for (const file of files) {
  const name = file.slice(0, -3);
  const src = fs.readFileSync(path.join(wfDir, file), 'utf8');

  test(`${name}: meta is a pure literal that names this file`, () => {
    const meta = parseMeta(src);
    assert.equal(meta.name, name);
    assert.ok(meta.description && typeof meta.description === 'string');
    assert.ok(Array.isArray(meta.phases) && meta.phases.length > 0, 'meta.phases must list the phases');
    const titles = meta.phases.map((p) => p.title);
    assert.equal(new Set(titles).size, titles.length, 'phase titles must be unique');
  });

  test(`${name}: compiles as a workflow script body`, () => {
    const body = src.replace(/^\s*export const meta/, 'const meta');
    assert.doesNotThrow(() => new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'workflow', 'budget', body));
  });

  test(`${name}: phase() calls match meta.phases`, () => {
    const meta = parseMeta(src);
    const titles = new Set(meta.phases.map((p) => p.title));
    const calls = [...src.matchAll(/\bphase\(\s*(['"])(.*?)\1\s*\)/g)].map((m) => m[2]);
    assert.equal([...src.matchAll(/\bphase\(\s*[^'"\s)]/g)].length, 0, 'phase() must be called with a string literal');
    for (const c of calls) assert.ok(titles.has(c), `phase('${c}') has no meta.phases entry`);
    for (const t of titles) assert.ok(calls.includes(t), `meta phase "${t}" is never started with phase()`);
    for (const m of src.matchAll(/\bphase:\s*(['"])(.*?)\1/g)) assert.ok(titles.has(m[2]), `phase: '${m[2]}' is not in meta.phases`);
  });

  test(`${name}: every referenced om-* agent exists`, () => {
    const names = new Set(src.match(/\bom-[a-z][a-z0-9-]*[a-z0-9]/g) ?? []);
    const missing = [...names].filter((n) => !agents.has(n) && !workflowNames.has(n) && !skillNames.has(n));
    assert.deepEqual(missing, [], `not in .claude/agents/: ${missing.join(', ')}`);
    for (const m of src.matchAll(/agentType:\s*(['"])(.*?)\1/g)) {
      assert.ok(m[2] === 'general-purpose' || agents.has(m[2]), `agentType '${m[2]}' does not exist`);
    }
  });

  test(`${name}: no clock, randomness or module access`, () => {
    assert.ok(!/Date\.now\s*\(/.test(src), 'Date.now() breaks resume; pass time in args.now');
    assert.ok(!/Math\.random\s*\(/.test(src), 'Math.random() breaks resume');
    assert.ok(!/new\s+Date\b/.test(src), 'new Date breaks resume; pass time in args.now');
    assert.ok(!/^\s*import\s/m.test(src) && !/\brequire\s*\(/.test(src), 'workflow scripts have no module access');
  });

  if (!ORIGINAL.has(name)) {
    test(`${name}: follows the Whalyom workflow contract`, () => {
      const meta = parseMeta(src);
      assert.ok(meta.whenToUse && meta.whenToUse.includes('args'), 'whenToUse documents the args');
      assert.equal(meta.phases.at(-1).title, 'Report', 'the last phase is Report');
      assert.ok(src.includes('tools/apply-results.mjs'), 'merges run files with apply-results');
      assert.ok(src.includes('runs/'), 'agents write runs/<task-id>.json');
      assert.ok(/om-compliance-guard|om-red-team|om-editor/.test(src), 'uses adversarial review');
      assert.ok(src.includes('approvals'), 'routes outbound actions through approvals');
      assert.ok(!/approvals\.json[^.]*\b(set|write) (it|the) status to "?approved/i.test(src), 'never approves on the owner\'s behalf');
    });
  }

  for (const variant of ['a', 'b', 'c']) {
    test(`${name}: dry run (variant ${variant}) finishes with existing agents and declared phases`, async (t) => {
      const meta = parseMeta(src);
      const { result, problems, calls } = await dryRun(src, meta, variant);
      assert.deepEqual(problems, []);
      assert.ok(calls > 0, 'the workflow dispatched no agents');
      t.diagnostic(`${calls} agent calls`);
      assert.ok(result && typeof result === 'object', 'the workflow returns an object');
    });
  }
}
