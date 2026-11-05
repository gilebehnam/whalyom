// Install-and-go: instant audit, booster safety, the boosters connector, the public edge and the
// satellite booster routes. Everything runs against temp folders and fixture HTML: no network.
// Run alone with: node --test tools/test/install-and-go.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { auditSite, auditMarkdown } from '../lib/site-audit.mjs';
import { liveBoosters, BOOST_JS, TRACKER_JS, createSatellite, signV2 } from '../satellite/whalyom-satellite.mjs';
import { createEdge, edgeSource } from '../cloud/edge.mjs';
import boosters from '../connectors/boosters.mjs';
import { pick } from '../connectors/index.mjs';
import { snippet } from '../install-snippet.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-iag-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const HTML = '<html lang="en"><head><title>Mug Studio | Handmade mugs</title><meta name="description" content="Handmade ceramic mugs shipped worldwide from our small studio."><meta property="og:site_name" content="Mug Studio"></head><body><h1>Handmade mugs</h1><a href="/shop">Shop now</a><a href="/privacy-policy">Privacy</a><a href="https://instagram.com/mugstudio">Instagram</a></body></html>';
const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`)));

test('instant audit scores the page, ranks fixes and drafts boosters only from page facts', () => {
  const a = auditSite({ url: 'https://mugstudio.test/', html: HTML, robots: 'User-agent: *\nAllow: /', bytes: HTML.length });
  assert.ok(a.scores.overall > 0 && a.scores.overall < 100);
  assert.equal(a.facts.name, 'Mug Studio');
  assert.equal(a.facts.privacy, 'https://mugstudio.test/privacy-policy');
  assert.ok(a.quickWins[0].weight >= a.quickWins.at(-1).weight, 'highest impact first');
  const lead = a.boosters.find((b) => b.type === 'lead-capture');
  assert.ok(lead && lead.approved === false, 'drafts wait for approval');
  assert.match(lead.consent_text, /Mug Studio/);
  assert.equal(lead.privacy_url, 'https://mugstudio.test/privacy-policy');
  const schema = a.boosters.find((b) => b.type === 'schema');
  assert.deepEqual(schema.jsonld['@graph'][0].sameAs, ['https://instagram.com/mugstudio']);
  assert.match(auditMarkdown(a, '2026-11-04'), /Fix first/);
  const none = auditSite({ url: 'https://x.test/', html: '<html><body>hi</body></html>' });
  assert.ok(none.boosters.find((b) => b.type === 'lead-capture').needs_owner.length, 'no privacy page → owner must add one first');
});

test('only approved, well-formed boosters are served; unsafe URLs and missing consent are dropped', () => {
  const out = liveBoosters([
    { id: 'ok', type: 'sticky-cta', approved: true, text: 'Shop', button: 'Go', url: 'https://a.test/shop' },
    { id: 'js', type: 'sticky-cta', approved: true, text: 'x', url: 'javascript:alert(1)' },
    { id: 'draft', type: 'announcement', approved: false, text: 'x' },
    { id: 'lead', type: 'lead-capture', approved: true, headline: 'Hi' },
    { id: 'old', type: 'announcement', approved: true, text: 'x', expires_at: '2020-01-01T00:00:00Z' },
    { id: 'bad id!', type: 'announcement', approved: true, text: 'x' },
  ]);
  assert.deepEqual(out.map((b) => b.id), ['ok', 'js']);
  assert.equal(out[1].url, undefined, 'javascript: URL removed');
  assert.match(BOOST_JS, /createTextNode/);
  assert.doesNotMatch(BOOST_JS, /innerHTML\s*=\s*[^'"]/, 'runtime never writes HTML from data');
  assert.match(TRACKER_JS, /\/boosters\?site=/, 'tracker asks for approved boosters');
});

test('boosters connector switches an approved booster on and routes before the generic publishers', async () => {
  const dir = path.join(tmp, 'p1');
  fs.mkdirSync(path.join(dir, 'outbox', 'boosters'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'outbox', 'boosters', 'sticky-cta.json'), JSON.stringify({ id: 'sticky-cta', type: 'sticky-cta', text: 'Shop the mugs', button: 'Shop', url: 'https://a.test/shop', needs_owner: [] }));
  const item = { id: 'A1', type: 'publish', channel: 'onsite-booster', file: 'outbox/boosters/sticky-cta.json', status: 'approved' };
  assert.equal(pick(item, {}, { slug: 'p1', dir }).name, 'boosters');
  const r = await boosters.execute(item, { slug: 'p1', dir, env: {}, now: '2026-11-04T00:00:00Z', dryRun: false });
  assert.equal(r.ok, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'boosters.json'), 'utf8'))[0].approved, true);
  fs.writeFileSync(path.join(dir, 'outbox', 'boosters', 'lead.json'), JSON.stringify({ id: 'lead', type: 'lead-capture', consent_text: 'ok', needs_owner: ['Add a privacy page'] }));
  const held = await boosters.execute({ ...item, file: 'outbox/boosters/lead.json' }, { slug: 'p1', dir, env: {}, now: 'x', dryRun: false });
  assert.equal(held.ok, false, 'a booster with open owner prerequisites does not go live');
});

test('edge: wrong key refused, new domain onboarded once, events and consented leads stored, boosters served', async () => {
  const root = path.join(tmp, 'edge');
  const onboarded = [];
  const onboard = async (host) => {
    onboarded.push(host);
    const dir = path.join(root, 'products', 'mugstudio');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'product.json'), JSON.stringify({ name: 'Mug Studio', domain: host }));
    fs.writeFileSync(path.join(dir, 'boosters.json'), JSON.stringify([{ id: 'sticky-cta', type: 'sticky-cta', approved: true, text: 'Shop', url: 'https://mugstudio.test/shop' }, { id: 'draft', type: 'announcement', approved: false, text: 'x' }]));
    return { slug: 'mugstudio' };
  };
  fs.mkdirSync(path.join(root, 'products'), { recursive: true });
  const { server } = createEdge({ root, installKey: 'wy_testkey_123456789', onboard, maxNewSitesPerDay: 5 });
  const base = await listen(server);
  try {
    const post = (body, origin = 'https://www.mugstudio.test') => fetch(`${base}/collect`, { method: 'POST', headers: { origin, 'content-type': 'text/plain' }, body: JSON.stringify(body) });
    assert.equal((await post({ type: 'pageview', site: 'nope', path: '/' })).status, 403);
    assert.equal((await post({ type: 'pageview', site: 'wy_testkey_123456789', path: '/', eid: 'e000000001' })).status, 204);
    assert.equal((await post({ type: 'pageview', site: 'wy_testkey_123456789', path: '/b', eid: 'e000000002' })).status, 204);
    assert.deepEqual(onboarded, ['mugstudio.test'], 'onboarded once');
    assert.equal((await post({ type: 'lead', site: 'wy_testkey_123456789', path: '/', eid: 'e000000003', email: 'a@b.co', consent: true, form: 'booster-lead' })).status, 204);
    const src = edgeSource(path.join(root, 'products', 'mugstudio'));
    const { events } = await src.events('');
    assert.equal(events.length, 3);
    assert.equal(events[2].has_contact, true);
    assert.ok(!JSON.stringify(events).includes('a@b.co'), 'personal fields stay out of the event log');
    assert.equal((await src.leads('')).leads[0].contact.email, 'a@b.co');
    const b = await (await fetch(`${base}/boosters?site=wy_testkey_123456789&host=mugstudio.test`)).json();
    assert.deepEqual(b.items.map((x) => x.id), ['sticky-cta']);
    assert.deepEqual((await (await fetch(`${base}/boosters?site=other&host=mugstudio.test`)).json()).items, []);
    assert.match(await (await fetch(`${base}/whalyom-boost.js`)).text(), /Whalyom boosters/);
  } finally { server.close(); }
  assert.match(snippet('https://edge.example.com/', 'wy_k'), /src="https:\/\/edge\.example\.com\/whalyom\.js" data-site="wy_k" data-endpoint="https:\/\/edge\.example\.com\/collect"/);
});

test('satellite serves approved boosters and accepts a signed booster update only with writes on', async () => {
  const root = path.join(tmp, 'site');
  fs.mkdirSync(root, { recursive: true });
  const secret = 'x'.repeat(40);
  const signed = (url, body) => { const ts = Date.now(); const nonce = `n${Math.random().toString(36).slice(2)}abcdefghijklmnop`.slice(0, 24); return { method: 'POST', headers: { 'x-whalyom-ts': String(ts), 'x-whalyom-nonce': nonce, 'x-whalyom-sig': signV2(secret, ts, nonce, 'POST', url, body), 'content-type': 'application/json' }, body }; };
  for (const allowWrites of [false, true]) {
    const sat = createSatellite({ root, secret, allowWrites });
    const base = await listen(sat.server ?? sat);
    try {
      const body = JSON.stringify({ items: [{ id: 'sticky-cta', type: 'sticky-cta', text: 'Shop', url: '/shop' }] });
      const r = await fetch(`${base}/_whalyom/boosters`, signed('/_whalyom/boosters', body));
      assert.equal(r.status, allowWrites ? 200 : 403);
      const live = await (await fetch(`${base}/boosters`)).json();
      assert.equal(live.items.length, allowWrites ? 1 : 0);
    } finally { (sat.server ?? sat).close(); }
  }
});

test('WordPress plugin sanitizes boosters exactly like the satellite', { skip: spawnSync('php', ['-v']).status !== 0 && 'php not installed' }, () => {
  const items = [
    { id: 'ok', type: 'sticky-cta', approved: true, text: 'Shop', button: 'Go', url: 'https://a.test/shop', exclude: ['/cart'] },
    { id: 'js', type: 'sticky-cta', approved: true, text: 'x', url: 'javascript:alert(1)' },
    { id: 'draft', type: 'announcement', approved: false, text: 'x' },
    { id: 'lead', type: 'lead-capture', approved: true, headline: 'Hi' },
    { id: 'lead2', type: 'lead-capture', approved: true, headline: 'Hi', consent_text: 'I agree', trigger: 'delay', delay_s: 1 },
  ];
  const r = spawnSync('php', [path.join(import.meta.dirname, '..', '..', 'integrations', 'wordpress', 'tests', 'harness.php')], { input: JSON.stringify({ op: 'boosters', items }), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const php = JSON.parse(r.stdout);
  const js = liveBoosters(items);
  assert.deepEqual(php.map((b) => b.id), js.map((b) => b.id));
  assert.equal(php.find((b) => b.id === 'js').url, undefined);
  assert.equal(php.find((b) => b.id === 'lead2').delay_s, js.find((b) => b.id === 'lead2').delay_s);
});

test('an unreachable home page is not audited: no boosters, approvals or quick wins, the reason is reported', async () => {
  const { instantOnboard } = await import('../instant-onboard.mjs');
  const productsDir = path.join(tmp, 'io-down');
  fs.mkdirSync(path.join(productsDir, 'down'), { recursive: true });
  const r = await instantOnboard('down.example.com', { productsDir, slug: 'down', now: '2026-11-04T00:00:00Z', queue: false, home: { status: 0, text: '', bytes: 0, error: 'down.example.com does not resolve (ENOTFOUND)' } });
  const dir = path.join(productsDir, 'down');
  assert.equal(r.reachable, false);
  assert.match(r.error, /ENOTFOUND/);
  assert.equal(r.approvals, 0);
  assert.deepEqual(r.boosters, []);
  assert.ok(!fs.existsSync(path.join(dir, 'outbox', 'boosters')) || !fs.readdirSync(path.join(dir, 'outbox', 'boosters')).some((f) => f.endsWith('.json')), 'no booster drafts');
  const run = JSON.parse(fs.readFileSync(path.join(dir, 'runs', 'INSTANT-20261104000000.json'), 'utf8'));
  assert.deepEqual(run.approvals, []);
  assert.ok(!run.new_tasks.some((t) => /^QW/.test(t.id)), 'no quick-win tasks');
  const md = fs.readFileSync(path.join(dir, 'reports', 'instant-audit.md'), 'utf8');
  assert.match(md, /ENOTFOUND/);
  assert.match(md, /--html-file saved\.html/);
  assert.ok(!fs.existsSync(path.join(dir, 'research', 'crawl', 'instant.json')), 'no audit facts from an empty page');
  const err5 = await instantOnboard('down.example.com', { productsDir, slug: 'down', now: '2026-11-04T00:00:01Z', queue: false, home: { status: 503, text: 'busy', bytes: 4 } });
  assert.equal(err5.reachable, false, '5xx counts as unreadable');
  assert.match(err5.error, /503/);
});

test('a re-audit keeps a profile the analyst wrote; only the untouched template is replaced by the draft', async () => {
  const { instantOnboard } = await import('../instant-onboard.mjs');
  const productsDir = path.join(tmp, 'io-profile');
  const dir = path.join(productsDir, 'mug');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(import.meta.dirname, '..', '..', 'products', '_template', 'profile.md'), path.join(dir, 'profile.md'));
  const r1 = await instantOnboard('mugstudio.test', { productsDir, slug: 'mug', now: '2026-11-04T00:00:00Z', queue: false, html: HTML });
  assert.equal(r1.reachable, true);
  assert.match(fs.readFileSync(path.join(dir, 'profile.md'), 'utf8'), /first draft from the instant audit/, 'template replaced on the first run');
  fs.writeFileSync(path.join(dir, 'profile.md'), '# Profile\n\n## Product\nReal analyst text\n');
  await instantOnboard('mugstudio.test', { productsDir, slug: 'mug', now: '2026-11-05T00:00:00Z', queue: false, html: HTML });
  const after = fs.readFileSync(path.join(dir, 'profile.md'), 'utf8');
  assert.match(after, /Real analyst text/);
  assert.doesNotMatch(after, /first draft from the instant audit/);
});
