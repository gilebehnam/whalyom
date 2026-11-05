// Checker micro-agents review drafts: they read outbox/ and content/, write their report outside
// outbox/ (so a verdict never turns into a publish approval) and say they list no approvals.
// Run alone with: node --test tools/test/roster-wave3-checkers.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { roster } from '../roster.mjs';

const CHECKERS = ['om-micro-claim-check', 'om-micro-ad-policy-check', 'om-micro-email-footer-check', 'om-micro-disclosure-check', 'om-micro-spam-check'];

test('checker micros read the drafts and never write into outbox/', () => {
  for (const name of CHECKERS) {
    const a = roster.find((x) => x.name === name);
    assert.ok(a, `${name} exists`);
    assert.ok(a.reads.includes('outbox/'), `${name} reads outbox/`);
    assert.ok(a.reads.includes('content/'), `${name} reads content/`);
    assert.ok(a.reads.includes('claims.md'), `${name} reads claims.md`);
    assert.ok(!a.writes.some((w) => w.startsWith('outbox/')), `${name} writes nothing to outbox/: ${a.writes}`);
    assert.ok(a.writes.includes(`reports/micro/${name.replace('om-micro-', '')}.md`), `${name} writes its report`);
    assert.match(a.notes, /review, not a draft/, `${name} notes say it lists no approvals`);
    assert.equal(a.tier, 'micro');
  }
});

test('claim-check still writes its verdicts to a REVIEW file', () => {
  const a = roster.find((x) => x.name === 'om-micro-claim-check');
  assert.ok(a.writes.includes('runs/REVIEW-<task-id>.json'), a.writes.join(', '));
  assert.match(a.notes, /runs\/REVIEW-/);
});

test('ordinary micros keep their outbox draft folder', () => {
  const a = roster.find((x) => x.name === 'om-micro-meta-title');
  assert.deepEqual(a.writes, ['outbox/micro/meta-title/']);
  assert.ok(!/review, not a draft/.test(a.notes));
});
