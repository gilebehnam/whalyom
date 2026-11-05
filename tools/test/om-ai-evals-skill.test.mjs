// om-ai-evals SKILL.md must match the ship gate in tools/evolve.mjs and the
// no-personal-data-in-state rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkProposal } from '../evolve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const skill = fs.readFileSync(path.join(root, '.claude', 'skills', 'om-ai-evals', 'SKILL.md'), 'utf8');

test('om-ai-evals names the evolve gate and fraction scale', () => {
  assert.match(skill, /min_bench_gain/);
  assert.match(skill, /fractions? from 0 to 1/);
  assert.doesNotMatch(skill, /pass rate ≥ the previous version/);
});

test('om-ai-evals requires redaction and keeps case text out of state/', () => {
  assert.match(skill, /[Rr]edact/);
  assert.match(skill, /never case text/);
  assert.match(skill, /fully redacted or synthetic/);
});

test('golden-set path agrees with the om-ai-eval-designer roster write path', () => {
  const roster = fs.readFileSync(path.join(root, 'tools', 'roster-wave4.mjs'), 'utf8');
  const at = roster.indexOf("'om-ai-eval-designer'");
  assert.ok(at > 0, 'om-ai-eval-designer missing from roster-wave4');
  assert.ok(roster.slice(at, at + 1500).includes("writes: ['../../state/evolution/bench/']"));
  assert.ok(skill.includes('state/evolution/bench/<agent>-golden.json'));
  assert.ok(!skill.includes('never in `state/`'));
});

const cfg = { mode: 'auto-safe', agents: { auto_apply: true, min_bench_gain: 0.02 } };
const rule = (bench) => ({ id: 'evals-gate-test', kind: 'agent-notes', target: 'om-x', text: 'Always cite the claim id from claims.md next to each claim.', bench });

test('equal bench score is rejected by evolve (old "≥ previous" wording was wrong)', () => {
  const why = checkProposal(rule({ before: 0.8, after: 0.8 }), { cfg, base: { facts: [] } });
  assert.ok(why.some((w) => /below 0.02/.test(w)), why.join('; '));
});

test('gain above the threshold passes the bench check', () => {
  const why = checkProposal(rule({ before: 0.8, after: 0.83 }), { cfg, base: { facts: [] } });
  assert.ok(!why.some((w) => /benchmark/.test(w)), why.join('; '));
});
