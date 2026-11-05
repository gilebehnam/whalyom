// apply-decisions: a malformed request url is reported, never crashes the pass, and every decision
// applied before it stays recorded in decisions-applied.json (no double events on the next run).
// Run: node --test tools/test/apply-decisions.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const slug = `zz-decide-${process.pid}`;
const pdir = path.join(root, 'products', slug);
const inbox = path.join(os.tmpdir(), `om-inbox-${process.pid}.json`);
const at = `2026-01-01T00:00:${String(process.pid % 60).padStart(2, '0')}Z`;
const run = () => spawnSync(process.execPath, [path.join(root, 'tools', 'apply-decisions.mjs'), inbox], { encoding: 'utf8' });
after(() => { fs.rmSync(pdir, { recursive: true, force: true }); fs.rmSync(inbox, { force: true }); });

test('an invalid request url is an error, not a crash, and earlier decisions stay applied', () => {
  fs.mkdirSync(pdir, { recursive: true });
  fs.writeFileSync(path.join(pdir, 'approvals.json'), JSON.stringify([{ id: 'A1', type: 'publish', title: 'Store page', status: 'pending', compliance: 'pass' }]));
  fs.writeFileSync(inbox, JSON.stringify({
    decisions: [{ product: slug, approval_id: 'A1', decision: 'reject', at }],
    requests: [{ id: 'r1', kind: 'new-product', name: 'Zz Bad', description: 'x', url: 'http://' }],
  }));
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(out.decisions, 1);
  assert.ok(out.errors.some((e) => /request r1: invalid url/.test(e)), JSON.stringify(out.errors));
  assert.equal(fs.existsSync(path.join(root, 'products', 'zz-bad')), false, 'no product created from a bad url');
  const applied = JSON.parse(fs.readFileSync(path.join(root, 'state', 'decisions-applied.json'), 'utf8'));
  assert.ok(applied.includes(`d:${slug}:A1:${at}`));
  const events = fs.readFileSync(path.join(pdir, 'events.jsonl'), 'utf8').trim().split(/\r?\n/).map((l) => JSON.parse(l));
  assert.equal(events.length, 1);
  assert.equal(events[0].text, 'Owner rejected: Store page');
  // The next run applies nothing twice and still exits cleanly.
  const again = run();
  assert.equal(again.status, 0, again.stderr);
  assert.equal(JSON.parse(again.stdout.trim().split(/\r?\n/).at(-1)).decisions, 0);
  assert.equal(fs.readFileSync(path.join(pdir, 'events.jsonl'), 'utf8').trim().split(/\r?\n/).length, 1);
});

test('an agency client decision is recorded as the client, never the owner, and cannot go live', () => {
  fs.writeFileSync(path.join(pdir, 'approvals.json'), JSON.stringify([{ id: 'C1', type: 'post', channel: 'linkedin', title: 'Client post', status: 'pending', compliance: 'pass' }]));
  const cat = `2026-01-02T00:00:${String(process.pid % 60).padStart(2, '0')}Z`;
  fs.writeFileSync(inbox, JSON.stringify({ decisions: [{ product: slug, approval_id: 'C1', decision: 'approve', activate: true, at: cat, by: 'client:t1:c1' }], requests: [] }));
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  const ap = JSON.parse(fs.readFileSync(path.join(pdir, 'approvals.json'), 'utf8'))[0];
  assert.equal(ap.status, 'approved');
  assert.equal(ap.decided_by, 'client:t1:c1');
  assert.ok(!/owner/i.test(ap.decided_by), 'a client approval never counts toward the owner\'s earned autonomy');
  assert.notEqual(ap.activate, true, 'only the owner can make an item go live');
});
