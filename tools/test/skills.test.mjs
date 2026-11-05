// Checks that the om skill's commands keep the guards the tools enforce: owner approvals go through
// tools/execute.mjs, carry decided_by/decided_at (earned autonomy reads them), and every `om <cmd>`
// the other skills mention exists. The behaviour tests work in a throwaway products/zz-skill-* folder.
// Run: node --test tools/test/skills.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { earnedTypes } from '../lib/earned.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const skill = fs.readFileSync(path.join(root, '.claude', 'skills', 'om', 'SKILL.md'), 'utf8');
const section = (heading) => {
  const i = skill.indexOf(heading);
  assert.ok(i > -1, `${heading} section present`);
  const j = skill.indexOf('\n### ', i + heading.length);
  return skill.slice(i, j > -1 ? j : undefined);
};
const approve = section('### `approve');

const slug = `zz-skill-${process.pid}`;
const dir = path.join(root, 'products', slug);
const noHooks = Object.fromEntries(Object.keys(process.env).filter((k) => k.startsWith('OM_WEBHOOK_')).map((k) => [k, '']));
const run = (script, args = [], env = {}) => {
  const r = spawnSync(process.execPath, [path.join(root, 'tools', script), ...args], { encoding: 'utf8', env: { ...process.env, OM_KILL: '', ...noHooks, ...env } });
  assert.equal(r.status, 0, `${script} failed: ${r.stderr || r.stdout}`);
  const last = r.stdout.trim().split(/\r?\n/).at(-1);
  try { return JSON.parse(last); } catch { return last; }
};
const readAp = () => JSON.parse(fs.readFileSync(path.join(dir, 'approvals.json'), 'utf8'));
const writeAp = (v) => fs.writeFileSync(path.join(dir, 'approvals.json'), JSON.stringify(v, null, 2));

// The decision exactly as the `approve` section says to write it.
const decide = (ap, answer, at) => {
  if (answer === 'yes') ap.status = 'approved';
  else if (answer === 'no') ap.status = 'rejected';
  else if (answer.startsWith('edit:')) Object.assign(ap, { status: 'changes', edited_by_owner: true, owner_note: answer.slice(5).trim() });
  else if (answer === 'done') {
    assert.equal(ap.status, 'approved-manual', 'done is allowed only from approved-manual');
    Object.assign(ap, { status: 'executed', executed_at: at, executed_by: 'owner (manual)' });
  }
  Object.assign(ap, { decided_at: at, decided_by: 'owner (/om approve)' });
  return ap;
};

before(() => run('new-product.mjs', [slug, '--preset', 'saas', '--autonomy', 'supervised', '--domain', 'zz-skill.example']));
after(() => { fs.rmSync(dir, { recursive: true, force: true }); spawnSync(process.execPath, [path.join(root, 'tools', 'build-state.mjs')], { encoding: 'utf8' }); });

test('approve runs through tools/execute.mjs and records the owner decision', () => {
  for (const s of ['tools/execute.mjs', 'decided_by', 'decided_at', 'edited_by_owner', 'owner_note', 'override_review', 'events.jsonl', 'compliance']) assert.ok(approve.includes(s), `approve section names ${s}`);
  assert.ok(!/carry out the action/i.test(approve), 'approve never tells the session to act through a connector itself');
  assert.match(approve, /decided_by: "owner/);
  assert.match(approve, /`block`/, 'a blocked item needs an explicit override');
});

test('approve defines done (approved-manual -> executed) and sends edits back through apply-results', () => {
  const heading = approve.split('\n')[0];
  for (const d of ['yes', 'no', 'edit:', 'done']) assert.ok(heading.includes(d), `heading lists ${d}`);
  assert.match(approve, /`approved-manual` → `status: executed`/);
  assert.ok(approve.includes('executed_by: "owner (manual)"'));
  assert.ok(approve.includes('tools/budget.mjs <slug> --record'), 'spend done reminds the owner to record it');
  assert.ok(approve.includes('runs/EDIT-<id>.json') && approve.includes('tools/apply-results.mjs'), 'edits re-queue through a run file');
});

test('every `om <cmd>` the whalyom and om-mega skills use has a command in the om skill', () => {
  const headings = new Set([...skill.matchAll(/^### `([a-z-]+)/gm)].map((m) => m[1]));
  const used = new Set();
  for (const f of ['whalyom', 'om-mega']) {
    const src = fs.readFileSync(path.join(root, '.claude', 'skills', f, 'SKILL.md'), 'utf8');
    for (const m of src.matchAll(/`\/?om ([a-z][a-z-]*)/g)) used.add(m[1]);
  }
  assert.ok(used.size >= 5, `found ${[...used].join(', ')}`);
  assert.deepEqual([...used].filter((c) => !headings.has(c)), [], 'om commands without a ### heading');
  const plan = section('### `plan');
  for (const s of ['om-cmo', 'plan.md', 'runs/<task-id>.json', 'tools/apply-results.mjs', 'LEARNINGS.md', 'claims.md']) assert.ok(plan.includes(s), `plan names ${s}`);
});

test('approvals decided as the om skill says count toward earned autonomy; a rejection resets the streak', () => {
  const list = Array.from({ length: 10 }, (_, i) => decide({ id: `A${i + 1}`, type: 'post', channel: 'x', status: 'pending' }, 'yes', `2026-01-01T00:${String(i).padStart(2, '0')}:00Z`));
  assert.equal(earnedTypes(list).get('post|x'), 10);
  list.push(decide({ id: 'A11', type: 'post', channel: 'x', status: 'pending' }, 'no', '2026-01-01T01:00:00Z'));
  assert.equal(earnedTypes(list).has('post|x'), false);
  const edited = Array.from({ length: 10 }, (_, i) => decide({ id: `E${i + 1}`, type: 'post', channel: 'y', status: 'pending' }, 'yes', `2026-01-01T00:${String(i).padStart(2, '0')}:00Z`));
  assert.equal(earnedTypes(edited).get('post|y'), 10);
  edited.push(decide({ id: 'E11', type: 'post', channel: 'y', status: 'pending' }, 'edit: shorter', '2026-01-01T01:00:00Z'));
  assert.equal(earnedTypes(edited).has('post|y'), false, 'an owner edit through /om approve resets the streak');
  const undecided = list.slice(0, 10).map(({ decided_by, decided_at, ...x }) => x);
  assert.equal(earnedTypes(undecided).size, 0, 'without decided_by/decided_at nothing counts');
});

test('done closes an approved-manual item as executed and build-state shows it', () => {
  fs.mkdirSync(path.join(dir, 'outbox'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'outbox', 'post.md'), 'Founder post');
  writeAp([decide({ id: 'M1', type: 'post', channel: 'zz-nowhere', title: 'Manual post', file: 'outbox/post.md', compliance: 'pass', manual: true, status: 'pending' }, 'yes', '2026-01-01T00:00:00Z')]);
  const r = run('execute.mjs', [slug]);
  assert.equal(r.manual, 1, JSON.stringify(r));
  const ap = readAp();
  assert.equal(ap[0].status, 'approved-manual');
  const steps = fs.readFileSync(path.join(dir, 'outbox', 'manual', 'M1.md'), 'utf8');
  assert.match(steps, new RegExp(`/om approve ${slug} M1 done`), 'manual steps point to the done command');
  decide(ap[0], 'done', '2026-01-02T00:00:00Z');
  writeAp(ap);
  run('build-state.mjs');
  const rows = JSON.parse(fs.readFileSync(path.join(root, 'state', 'approvals.json'), 'utf8'));
  const list = Array.isArray(rows) ? rows : rows.rows ?? rows.data ?? [];
  const row = list.find((x) => x.product === slug && x.id === 'M1');
  assert.ok(row, 'build-state lists the item');
  assert.equal(row.status, 'executed');
});
