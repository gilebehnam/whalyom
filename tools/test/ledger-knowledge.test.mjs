// Audit items 14, 15 and 19 (research/audit/gaps-2026-11-04.md):
//   14 knowledge facts enter base.json only with a keep/fix verdict from a separate verifier run
//   15 compliance verdicts come from runs/REVIEW-*.json reviewer files; approve_item needs an owner
//      token from the process environment, never the repo .env
//   19 apply-results survives a bad run, moves files only after saving, and keeps transition ids monotonic
// Knowledge runs in a temp folder (WHALYOM_KNOWLEDGE), so knowledge/base.json is never touched.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-ledger-'));
process.env.WHALYOM_KNOWLEDGE = path.join(tmp, 'knowledge');
process.env.WHALYOM_KNOWLEDGE_SKILLS = path.join(tmp, 'skills');
const { apply, loadBase, K, statementHash } = await import('../knowledge/engine.mjs');
const { ownerTokenStatus } = await import('../mcp/extra-tools.mjs');

const slug = `zz-ledger-${process.pid}`;
const P = (...f) => path.join(ROOT, 'products', slug, ...f);
after(() => {
  fs.rmSync(P(), { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
});

const NOW = '2026-11-04T10:00:00.000Z';
const kw = (f, v) => { fs.mkdirSync(path.dirname(K(f)), { recursive: true }); fs.writeFileSync(K(f), JSON.stringify(v)); };
const fact = (statement, extra = {}) => ({ topic: 'search', statement, source_url: `https://developers.google.com/search/${encodeURIComponent(statement.slice(0, 12))}`, source_tier: 'official', confidence: 'high', published: '2026-10-01', ...extra });

// ── Item 14 ─────────────────────────────────────────────────────────────────
test('knowledge: a fact with no verdict from the separate verifier is rejected (default reject)', () => {
  const s1 = fact('Google Search Console now reports AI Mode impressions in the performance report.');
  kw('runs/S1.json', { run_id: 'S1', agent: 'om-knowledge-scout', facts: [s1, fact('Google Search Central publishes a changelog of every documentation update it makes.')] });
  kw('runs/S1-V.json', { run_id: 'S1-V', agent: 'om-fact-verifier', verifies: 'S1', verdicts: [{ index: 0, verdict: 'keep', statement_hash: statementHash(s1) }] });
  const r = apply({ now: NOW });
  assert.equal(r.added.length, 1, 'only the fact with a keep verdict is added');
  assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0].index, 1);
  assert.match(r.rejected[0].reason, /no keep or fix verdict/);
  assert.equal(loadBase().facts.length, 1);
});

test('knowledge: a run cannot verify itself, and only om-fact-verifier verdicts count', () => {
  const before = loadBase().facts.length;
  // Scout claims to be the verifier and carries its own verdicts.
  kw('runs/S2.json', { run_id: 'S2', agent: 'om-fact-verifier', verdicts: [{ index: 0, verdict: 'keep' }], facts: [fact('Self-verified facts must never enter the Whalyom knowledge base at all.')] });
  // A run whose `verifies` names itself.
  kw('runs/S3.json', { run_id: 'S3', agent: 'om-fact-verifier', verifies: 'S3', verdicts: [{ index: 0, verdict: 'keep' }], facts: [fact('A run naming itself in verifies is not a separate verifier run either.')] });
  // A separate run that is not from the fact verifier.
  kw('runs/S4.json', { run_id: 'S4', agent: 'om-knowledge-scout', facts: [fact('Verdicts from an agent other than the fact verifier do not verify a run.')] });
  kw('runs/S4-V.json', { run_id: 'S4-V', agent: 'om-knowledge-scout', verifies: 'S4', verdicts: [{ index: 0, verdict: 'keep' }] });
  const r = apply({ now: NOW });
  assert.deepEqual(r.waiting.sort(), ['S2', 'S3', 'S4']);
  assert.equal(r.added.length, 0);
  assert.equal(loadBase().facts.length, before);
  // A real verifier run for S3 then works, and a reject beats a keep for the same index.
  kw('runs/S3-V.json', { run_id: 'S3-V', agent: 'om-fact-verifier', verifies: 'S3', verdicts: [{ index: 0, verdict: 'reject', reason: 'not on page' }] });
  kw('runs/S3-V2.json', { run_id: 'S3-V2', agent: 'om-fact-verifier', verifies: 'S3', verdicts: [{ index: 0, verdict: 'keep' }] });
  const r2 = apply({ now: NOW });
  assert.ok(!r2.waiting.includes('S3'));
  assert.equal(r2.added.length, 0);
  assert.ok(r2.rejected.some((x) => x.run === 'S3' && x.reason === 'not on page'));
});

test('knowledge: the owner --trust override still applies a run with no verifier', () => {
  kw('runs/SEED2.json', { run_id: 'SEED2', agent: 'om-knowledge-scout', facts: [fact('Owner-trusted seed facts apply without a verifier run when trusted.')] });
  assert.ok(apply({ now: NOW }).waiting.includes('SEED2'));
  const r = apply({ now: NOW, trust: ['SEED2'] });
  assert.equal(r.added.length, 1);
  assert.ok(fs.existsSync(K('runs', 'applied', 'SEED2.json')));
});

// ── Items 15 and 19: apply-results ─────────────────────────────────────────
const run = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'tools', 'apply-results.mjs'), slug, ...args], { encoding: 'utf8', cwd: ROOT });
const rd = (f, d = []) => { try { return JSON.parse(fs.readFileSync(P(f), 'utf8')); } catch { return d; } };
const wr = (f, v) => { fs.mkdirSync(path.dirname(P(f)), { recursive: true }); fs.writeFileSync(P(f), JSON.stringify(v)); };
const reset = () => {
  fs.rmSync(P(), { recursive: true, force: true });
  for (const f of ['tasks.json', 'approvals.json', 'experiments.json']) wr(f, []);
  fs.mkdirSync(P('runs'), { recursive: true });
};

test('apply-results: a bad run goes to runs/failed with its error, is rolled back, and the rest still apply', () => {
  reset();
  wr('runs/T1.json', { task_id: 'T1', agent: 'om-writer', status: 'done', summary: 'good', approvals: [{ id: 'A1', type: 'post', title: 'Post' }] });
  wr('runs/T2.json', { task_id: 'T2', agent: 'om-writer', status: 'done', approvals: { not: 'an array' } });
  // Throws after it has already changed the ledgers (numeric task id has no startsWith): must roll back.
  wr('runs/T3.json', { task_id: 42, agent: 'om-writer', status: 'blocked', error: 'x' });
  wr('runs/T4.json', { task_id: 'T4', agent: 'om-writer', status: 'done', alerts: [{ level: 'info', title: 'Hello' }] });
  const r = run('--now', NOW);
  assert.equal(r.status, 0, r.stderr);
  const stats = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(stats.failed.length, 2);
  const tasks = rd('tasks.json');
  assert.deepEqual(tasks.map((t) => t.id).sort(), ['T1', 'T4']);
  assert.ok(!tasks.some((t) => t.id === 42 || t.id === 'HEAL-42'), 'the failed run left no trace in the ledgers');
  assert.deepEqual(rd('approvals.json').map((a) => a.id), ['A1']);
  assert.equal(rd('alerts.json').length, 1);
  const failed = fs.readdirSync(P('runs', 'failed'));
  assert.ok(failed.some((f) => f.endsWith('-T2.json')) && failed.some((f) => f.endsWith('-T3.json')));
  assert.ok(failed.some((f) => /T2\.error\.txt$/.test(f)));
  assert.match(fs.readFileSync(P('runs', 'failed', failed.find((f) => /T2\.error\.txt$/.test(f))), 'utf8'), /must be an array/);
  const applied = fs.readdirSync(P('runs', 'applied')).filter((f) => f !== 'index.json'); // index.json: the applied-run index
  assert.equal(applied.length, 2);
  assert.deepEqual(fs.readdirSync(P('runs')).filter((f) => f.endsWith('.json')), [], 'queue is empty');
});

test('apply-results: run files stay in the queue when the ledgers cannot be saved', () => {
  reset();
  wr('runs/T5.json', { task_id: 'T5', agent: 'om-writer', status: 'done' });
  fs.rmSync(P('tasks.json'));
  fs.mkdirSync(P('tasks.json')); // a directory: save('tasks.json') throws
  const r = run('--now', NOW);
  assert.notEqual(r.status, 0);
  assert.ok(fs.existsSync(P('runs', 'T5.json')), 'the run was not moved, so nothing is lost');
  fs.rmSync(P('tasks.json'), { recursive: true, force: true });
});

test('apply-results: transition ids are monotonic after trimming', () => {
  reset();
  wr('transitions.json', [{ id: 'X1998', status: 'completed', task_id: 'old1' }, { id: 'X2000', status: 'completed', task_id: 'old2' }]);
  wr('runs/T6.json', { task_id: 'T6', agent: 'om-writer', status: 'done', new_tasks: [{ id: 'T7', title: 'next', agent: 'om-editor' }, { id: 'T8', title: 'next 2', agent: 'om-editor' }] });
  assert.equal(run('--now', NOW).status, 0);
  const ids = rd('transitions.json').map((x) => x.id);
  assert.deepEqual(ids, ['X1998', 'X2000', 'X2001', 'X2002']);
});

test('apply-results: compliance comes only from REVIEW files by an allowed reviewer; the strictest verdict wins', () => {
  reset();
  wr('approvals.json', [{ id: 'A9', type: 'post', title: 'Old', status: 'approved', compliance: 'pass' }]);
  wr('runs/T10.json', { task_id: 'T10', agent: 'om-writer', status: 'done', approvals: [{ id: 'A10', type: 'post', title: 'One' }, { id: 'A11', type: 'post', title: 'Two', compliance: 'pass' }] });
  // Sorts before T10 but must still see A10/A11: reviews apply after all regular runs.
  wr('runs/REVIEW-a.json', { agent: 'om-compliance-guard', reviews: [{ approval_id: 'A10', compliance: 'pass', notes: 'claims ok' }, { approval_id: 'A11', compliance: 'fix', notes: 'shorten' }, { approval_id: 'A9', compliance: 'block' }, { approval_id: 'NOPE', compliance: 'pass' }] });
  wr('runs/REVIEW-b.json', { agent: 'om-micro-claim-check', reviews: [{ approval_id: 'A10', compliance: 'block', notes: 'claim not in claims.md' }, { approval_id: 'A11', compliance: 'pass' }] });
  wr('runs/REVIEW-c.json', { agent: 'om-writer', reviews: [{ approval_id: 'A10', compliance: 'pass' }] });
  wr('runs/REVIEW-d.json', { agent: 'om-compliance-guard', reviews: [{ approval_id: 'A10', compliance: 'approved' }] });
  const r = run('--now', NOW);
  assert.equal(r.status, 0, r.stderr);
  const stats = JSON.parse(r.stdout.trim().split('\n').pop());
  const ap = Object.fromEntries(rd('approvals.json').map((a) => [a.id, a]));
  assert.equal(ap.A10.compliance, 'block', 'block beats pass');
  assert.match(ap.A10.review_notes, /claim not in claims\.md/);
  assert.equal(ap.A10.compliance_by, 'om-micro-claim-check');
  assert.equal(ap.A11.compliance, 'fix', 'an agent cannot set its own approval to pass; fix beats pass');
  assert.equal(ap.A9.compliance, 'pass', 'decided approvals are not re-reviewed');
  assert.ok(stats.rejected.some((x) => /REVIEW-c\.json: reviews from om-writer ignored/.test(x)));
  assert.ok(stats.rejected.some((x) => /invalid compliance approved/.test(x)));
  assert.ok(stats.rejected.some((x) => /unknown approval NOPE/.test(x)));
  assert.deepEqual(fs.readdirSync(P('runs')).filter((f) => f.endsWith('.json')), []);
});

// ── Item 15: owner token ────────────────────────────────────────────────────
test('approve_item owner token: process environment only, refused when the repo .env holds it', () => {
  const envFile = path.join(tmp, '.env');
  fs.writeFileSync(envFile, '# WHALYOM_OWNER_TOKEN=commented-out-is-fine-0000\nOTHER=1\n');
  assert.equal(ownerTokenStatus({ startToken: 'o'.repeat(20), envFile }).ok, true);
  assert.equal(ownerTokenStatus({ startToken: 'short', envFile }).ok, false);
  assert.equal(ownerTokenStatus({ startToken: undefined, envFile }).ok, false);
  fs.writeFileSync(envFile, 'WHALYOM_OWNER_TOKEN=' + 'o'.repeat(20) + '\n');
  const s = ownerTokenStatus({ startToken: 'o'.repeat(20), envFile });
  assert.equal(s.ok, false);
  assert.match(s.reason, /repo \.env/);
  fs.writeFileSync(envFile, 'WHALYOM_OWNER_TOKEN=\n');
  assert.equal(ownerTokenStatus({ startToken: 'o'.repeat(20), envFile }).ok, true, 'an empty placeholder (as in .env.example) is not a stored token');
});

test('om-* workflows write REVIEW files instead of editing approvals.json compliance', () => {
  const dir = path.join(ROOT, '.claude', 'workflows');
  for (const f of fs.readdirSync(dir).filter((x) => /^om-.*\.js$/.test(x))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/You are the only writer of approvals\.json/.test(src), `${f} still lets an LLM write approvals.json`);
    assert.ok(!/set "compliance" to/.test(src), `${f} still sets compliance by editing approvals.json`);
  }
});
