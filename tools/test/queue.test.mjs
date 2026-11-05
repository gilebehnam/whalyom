// The hub's queue selection (tools/lib/queue.mjs nextQueueJob): a public-snippet site (needs_owner) gets
// its AI onboarding only after the owner approves it, onboardings run before lead replies, and only
// well-formed file names are picked up.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nextQueueJob } from '../lib/queue.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-queue-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));
const queueDir = path.join(base, 'queue');
const productsDir = path.join(base, 'products');
fs.mkdirSync(queueDir, { recursive: true });
const put = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); };
const q = (name, v = {}) => put(path.join(queueDir, name), v);
const approvals = (slug, v) => put(path.join(productsDir, slug, 'approvals.json'), v);
const next = () => nextQueueJob({ queueDir, productsDir });

test('an empty or missing queue gives null', () => {
  assert.equal(next(), null);
  assert.equal(nextQueueJob({ queueDir: path.join(base, 'nope'), productsDir }), null);
});

test('a needs_owner onboarding waits for an approved ai-onboarding approval', () => {
  q('onboard-a.json', { slug: 'a', needs_owner: true });
  assert.equal(next(), null, 'no approvals file');
  approvals('a', [{ channel: 'ai-onboarding', status: 'pending' }]);
  assert.equal(next(), null, 'pending is not approval');
  approvals('a', [{ channel: 'ai-onboarding', status: 'rejected' }, { channel: 'onsite-booster', status: 'approved' }]);
  assert.equal(next(), null, 'another channel does not count');
  for (const status of ['approved', 'auto-approved', 'approved-manual', 'executed']) {
    approvals('a', [{ channel: 'ai-onboarding', status }]);
    assert.deepEqual(next(), { file: 'onboard-a.json', slug: 'a', respond: false }, status);
  }
  fs.rmSync(path.join(queueDir, 'onboard-a.json'));
});

test('the gate reads the approval of the slug in the file name, not a slug inside the job', () => {
  approvals('approved-site', [{ channel: 'ai-onboarding', status: 'approved' }]);
  q('onboard-evil.json', { slug: 'approved-site', needs_owner: true });
  assert.equal(next(), null);
  fs.rmSync(path.join(queueDir, 'onboard-evil.json'));
});

test('a ready onboarding runs before a lead reply; a waiting one does not block replies', () => {
  q('respond-b.json', { slug: 'b' });
  q('onboard-c.json', { slug: 'c' });
  assert.deepEqual(next(), { file: 'onboard-c.json', slug: 'c', respond: false });
  fs.rmSync(path.join(queueDir, 'onboard-c.json'));
  q('onboard-d.json', { slug: 'd', needs_owner: true });
  assert.deepEqual(next(), { file: 'respond-b.json', slug: 'b', respond: true });
  fs.rmSync(path.join(queueDir, 'onboard-d.json'));
  fs.rmSync(path.join(queueDir, 'respond-b.json'));
});

test('malformed names, running and finished jobs are ignored', () => {
  for (const name of ['respond-A.json', 'onboard-x.y.json', 'onboard-.json.bak', 'onboard-e.json.running', 'onboard-f.json.done', 'onboard-g.json.failed', 'respond-h.json.running', 'other.json']) q(name);
  // A name with a path in it cannot even be created inside the queue dir; the regex rejects it anyway.
  assert.equal(/^onboard-[a-z0-9-]+\.json$/.test('onboard-../x.json'), false);
  assert.equal(next(), null);
});

test('an unreadable needs-owner check fails closed', () => {
  fs.writeFileSync(path.join(queueDir, 'onboard-z.json'), '{not json');
  assert.equal(next(), null, 'a half-written job waits');
  fs.rmSync(path.join(queueDir, 'onboard-z.json'));
});
