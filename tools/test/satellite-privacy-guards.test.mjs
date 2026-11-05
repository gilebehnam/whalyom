// Privacy guards of the Node satellite: the tracker only treats explicit consent checkboxes as lead consent
// (not "agree to terms" or "privacy policy read"), and CMS credential files and database dumps are never
// readable through the signed files API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createSatellite, isBlocked, TRACKER_JS } from '../satellite/whalyom-satellite.mjs';
import { signRequestV2 } from '../lib/satellite-client.mjs';

// Pull fields() (and the BAD pattern it uses) out of the shipped tracker and run it against fake forms.
const src = TRACKER_JS.slice(TRACKER_JS.indexOf('var BAD='), TRACKER_JS.indexOf('return o}', TRACKER_JS.indexOf('function fields(')) + 'return o}'.length);
const ctx = vm.createContext({});
vm.runInContext(`${src};this.fields=fields;`, ctx);
const input = (name, { type = 'text', value = '', checked = false, attrs = [] } = {}) => ({ name, type, value, checked, tagName: 'INPUT', hasAttribute: (a) => attrs.includes(a) });
const form = (...elements) => ({ elements });

test('tracker: a terms or privacy-notice checkbox is not consent to keep lead details', () => {
  for (const n of ['agree_terms', 'agree', 'privacy_policy_read', 'privacy', 'i_agree_to_tos', 'accept-privacy']) {
    const o = ctx.fields(form(input('email', { type: 'email', value: 'a@example.test' }), input(n, { type: 'checkbox', value: 'on', checked: true })));
    assert.equal(o.consent, undefined, `${n} must not set consent`);
    assert.equal(o.email, 'a@example.test');
  }
});

test('tracker: explicit consent fields and data-whalyom-consent set consent only when checked', () => {
  for (const n of ['consent', 'gdpr_consent', 'marketing-opt-in', 'newsletter_optin', 'marketing_optin', 'whalyom-consent', 'gdpr']) {
    assert.equal(ctx.fields(form(input(n, { type: 'checkbox', checked: true }))).consent, true, `${n} must set consent`);
    assert.equal(ctx.fields(form(input(n, { type: 'checkbox', checked: false }))).consent, undefined, `${n} unchecked must not set consent`);
  }
  assert.equal(ctx.fields(form(input('subscribe_box', { type: 'checkbox', checked: true, attrs: ['data-whalyom-consent'] }))).consent, true);
  assert.equal(ctx.fields(form(input('subscribe_box', { type: 'checkbox', checked: true }))).consent, undefined);
});

test('isBlocked covers CMS credential files and database dumps, not ordinary pages', () => {
  for (const p of ['configuration.php', 'sites/default/settings.php', 'sites/default/settings.local.php', 'app/etc/env.php', 'phpmyadmin/config.inc.php', 'LocalSettings.php', 'backup/db.sql', 'dump.sql.gz', 'data/site.dump', 'index.php.bak', 'wp-config.php']) {
    assert.equal(isBlocked(p), true, p);
  }
  for (const p of ['index.php', 'content/settings-guide.md', 'settings.html', 'blog/sql-tips.html', 'env.html']) {
    assert.equal(isBlocked(p), false, p);
  }
});

const secret = crypto.randomBytes(32).toString('hex');
const siteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-priv-'));
let server; let base;
before(async () => {
  fs.writeFileSync(path.join(siteRoot, 'index.php'), '<?php echo "home";');
  fs.writeFileSync(path.join(siteRoot, 'configuration.php'), "<?php class JConfig { public $password = 'x'; }");
  fs.writeFileSync(path.join(siteRoot, 'db.sql'), 'INSERT INTO users VALUES (1, "a@example.test");');
  server = createSatellite({ root: siteRoot, secret });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(siteRoot, { recursive: true, force: true });
});
const signedGet = (pq) => {
  const ts = Date.now(); const nonce = crypto.randomBytes(16).toString('hex');
  return fetch(base + pq, { headers: { 'x-whalyom-ts': String(ts), 'x-whalyom-nonce': nonce, 'x-whalyom-sig': signRequestV2(secret, ts, nonce, 'GET', pq, '') } });
};

test('a running satellite refuses credential files and dumps through /_whalyom/files and hides them in listings', async () => {
  assert.equal((await signedGet('/_whalyom/files?path=index.php')).status, 200);
  assert.equal((await signedGet('/_whalyom/files?path=configuration.php')).status, 404);
  assert.equal((await signedGet('/_whalyom/files?path=db.sql')).status, 404);
  const r = await signedGet('/_whalyom/files?path=');
  assert.equal(r.status, 200);
  const listing = await r.json();
  const names = (listing.entries ?? []).map((e) => e.name);
  assert.ok(names.includes('index.php'));
  assert.ok(!names.includes('configuration.php') && !names.includes('db.sql'));
});
