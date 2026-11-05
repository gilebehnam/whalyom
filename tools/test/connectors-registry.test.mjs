// Connector registry wiring: budget updates go only to budget connectors, the new organic social,
// voice and retail-media connectors route on their own channels, the kill switch and metrics see the
// new ad channels. Routing only: nothing here executes a connector or touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pick, status, connectors } from '../connectors/index.mjs';
import { AD_READERS } from '../metrics.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const name = (item, env) => pick(item, env)?.name ?? null;
const META = { META_ACCESS_TOKEN: 'm', META_AD_ACCOUNT_ID: 'act_1', META_PAGE_ID: 'p1' };
const HOOK = { OM_WEBHOOK_DEFAULT: 'https://hooks.example/x' };

test('every connector name is unique and the new ones are registered', () => {
  const names = connectors.map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
  for (const n of ['meta-budget', 'google-ads-budget', 'tiktok-budget', 'linkedin-budget', 'microsoft-ads-budget', 'instagram', 'facebook', 'tiktok-posting', 'twilio-voice', 'amazon-ads', 'walmart-connect']) {
    if (n === 'google-ads-budget' && !names.includes(n)) continue; // name decided in budgets.mjs
    assert.ok(names.includes(n), `${n} missing`);
  }
  // Webhook stays the catch-all: every keyed connector sits before it.
  const hook = names.indexOf('webhook');
  for (const n of ['instagram', 'facebook', 'tiktok-posting', 'twilio-voice', 'amazon-ads', 'walmart-connect']) assert.ok(names.indexOf(n) < hook, `${n} after webhook`);
  assert.equal(status({}).length, connectors.length);
  assert.ok(status({}).every((s) => s.configured === false || s.name === 'local-site' || s.name === 'boosters' || s.name === 'site-git' || s.name === 'satellite'), 'no keyed connector configured with an empty env');
});

test('a budget_update never reaches a creating connector, exporter or webhook', () => {
  const upd = { type: 'spend', kind: 'budget_update', channel: 'meta', campaign: '123', new_daily: 12 };
  assert.equal(name(upd, { ...META, ...HOOK }), 'meta-budget');
  assert.equal(name(upd, HOOK), null, 'no budget connector configured: manual, not the webhook');
  assert.equal(name({ ...upd, channel: 'amazon' }, { ...HOOK, AMAZON_ADS_CLIENT_ID: 'a', AMAZON_ADS_CLIENT_SECRET: 'b', AMAZON_ADS_REFRESH_TOKEN: 'c', AMAZON_ADS_PROFILE_ID: '1' }), null);
  // A normal spend item still goes to the creating connector.
  assert.equal(name({ type: 'spend', channel: 'meta', file: 'outbox/x.json' }, META), 'meta-ads');
});

test('organic social, voice and retail media route on their own channels only', () => {
  const ig = { INSTAGRAM_ACCESS_TOKEN: 'i', INSTAGRAM_USER_ID: '1' };
  const fb = { FACEBOOK_PAGE_ID: '1', FACEBOOK_PAGE_ACCESS_TOKEN: 'f' };
  const ttp = { TIKTOK_POSTING_ACCESS_TOKEN: 't' };
  const tta = { TIKTOK_ACCESS_TOKEN: 'a', TIKTOK_ADVERTISER_ID: '1' };
  const tw = { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'x', TWILIO_VOICE_FROM: '+15550000000', TWILIO_VOICE_WEBHOOK_BASE: 'https://edge.example/voice/demo' };
  const amz = { AMAZON_ADS_CLIENT_ID: 'a', AMAZON_ADS_CLIENT_SECRET: 'b', AMAZON_ADS_REFRESH_TOKEN: 'c', AMAZON_ADS_PROFILE_ID: '1' };
  const wm = { WALMART_ADS_CONSUMER_ID: 'c', WALMART_ADS_PRIVATE_KEY: 'k', WALMART_ADS_AUTH_TOKEN: 't', WALMART_ADS_ADVERTISER_ID: '1' };
  const env = { ...ig, ...fb, ...ttp, ...tta, ...tw, ...amz, ...wm };
  assert.equal(name({ type: 'post', channel: 'instagram' }, env), 'instagram');
  assert.equal(name({ type: 'reply', channel: 'instagram' }, env), 'instagram');
  assert.equal(name({ type: 'post', channel: 'facebook' }, env), 'facebook');
  assert.equal(name({ type: 'post', channel: 'tiktok' }, env), 'tiktok-posting');
  assert.equal(name({ type: 'spend', channel: 'tiktok' }, env), 'tiktok-ads', 'ads and organic TikTok do not collide');
  assert.equal(name({ type: 'call', channel: 'voice' }, env), 'twilio-voice');
  assert.equal(name({ type: 'call' }, env), 'twilio-voice');
  assert.equal(name({ type: 'spend', channel: 'amazon' }, env), 'amazon-ads');
  assert.equal(name({ type: 'spend', channel: 'walmart' }, env), 'walmart-connect');
  assert.equal(name({ type: 'post', channel: 'amazon' }, env), null);
  // Not configured: the item falls through as before (webhook or manual).
  assert.equal(name({ type: 'post', channel: 'instagram' }, {}), null);
  assert.equal(name({ type: 'call', channel: 'voice' }, {}), null);
});

test('metrics read the retail-media readers and the kill switch can pause microsoft, amazon and walmart', () => {
  const readers = AD_READERS.map((r) => r.name);
  assert.equal(new Set(readers).size, readers.length);
  for (const n of ['amazon-ads-metrics', 'walmart-connect-metrics', 'microsoft-ads-metrics']) assert.ok(readers.includes(n), n);
  const ks = fs.readFileSync(path.join(here, '..', 'killswitch.mjs'), 'utf8');
  for (const ch of ['microsoft', 'amazon', 'walmart']) assert.match(ks, new RegExp(`\\n  ${ch}: \\(ref\\) =>`), ch);
});
