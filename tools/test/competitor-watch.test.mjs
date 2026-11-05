// Competitor watch: the watch list is validated, robots.txt is honoured, requests are spaced one second
// apart, visible text, headings, features and prices are extracted, snapshots are stored per day with a
// content hash, and the diff report names price changes, new headings and new features. No network:
// every test injects fetch, sleep and the clock, and works in a temporary folder.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeWatchList, publicUrl, safeName, parseRobots, robotsAllows, visibleText, headings, featureLines,
  extractPrices, extractPage, diffPage, diffSnapshots, buildReport, reportMarkdown, runResult, createThrottle,
  createCrawler, watchProduct, watchAll, USER_AGENT,
} from '../competitor-watch.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-cw-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const pricingHtml = (pro, extra = '') => `<!doctype html><html><head><title>Acme pricing</title><style>.x{}</style><script>var price="$999";</script></head><body>
<nav><ul><li>Home</li><li>Pricing page link</li></ul></nav>
<h1>Simple pricing</h1><h2>Starter</h2><p>Starter $0/month</p>
<h2>Pro</h2><p>Pro $${pro}/month billed yearly</p><ul><li>Unlimited quotes and invoices</li><li>E-signature on every plan</li>${extra}</ul>
<!-- $5 hidden comment --><p>Contact sales@acme.example for &amp; more</p></body></html>`;

// Fake web: url -> { status, body, type } | Error. Records every request and its headers.
const fakeWeb = (pages) => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, ua: init?.headers?.['user-agent'] });
    const p = pages[url];
    if (p instanceof Error) throw p;
    if (!p) return { status: 404, headers: new Map([['content-type', 'text/html']]), text: async () => 'not found' };
    const headers = new Map([['content-type', p.type ?? 'text/html; charset=utf-8']]);
    if (p.location) headers.set('location', p.location);
    return { status: p.status ?? 200, headers, text: async () => p.body ?? '' };
  };
  return { fetch, calls };
};
const fakeTime = () => { let t = 0; const waits = []; return { now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; }, waits }; };

const makeProduct = (slug, list, product = { name: slug, stage: 'launch' }) => {
  const ws = path.join(tmp, 'products', slug);
  fs.mkdirSync(path.join(ws, 'research'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'product.json'), JSON.stringify(product));
  if (list !== undefined) fs.writeFileSync(path.join(ws, 'research', 'competitors.json'), typeof list === 'string' ? list : JSON.stringify(list));
  return ws;
};

test('watch list: names become folder ids, only public http(s) urls survive, duplicates and junk are skipped', () => {
  assert.equal(safeName('Acme, Inc.'), 'acme-inc');
  assert.equal(safeName('Café Ünïcode'), 'cafe-unicode');
  assert.match(safeName('日本'), /^c-[0-9a-f]{10}$/);
  assert.equal(safeName(''), '');
  assert.equal(publicUrl('https://acme.example/pricing#plans'), 'https://acme.example/pricing');
  for (const bad of ['ftp://acme.example', 'http://localhost/x', 'http://127.0.0.1/', 'http://10.1.2.3/', 'http://192.168.1.1', 'http://[::1]/', 'https://user:pw@acme.example', 'javascript:alert(1)', 'intranet', 'http://printer.local/']) assert.equal(publicUrl(bad), null, bad);
  const { competitors, skipped } = normalizeWatchList({ competitors: [
    { name: 'Acme', urls: { home: 'https://acme.example', pricing: 'https://acme.example/pricing', changelog: 'http://localhost/x' } },
    { name: 'acme', urls: { home: 'https://other.example' } },
    { name: 'Solo', url: 'https://solo.example' },
    { name: '', urls: { home: 'https://x.example' } },
    { name: 'NoUrls' },
    'junk', null,
  ] });
  assert.deepEqual(competitors.map((c) => [c.id, Object.keys(c.urls)]), [['acme', ['home', 'pricing']], ['solo', ['home']]]);
  assert.deepEqual(skipped.map((s) => s.reason), ['invalid or non-public url: changelog', 'duplicate name', 'no name', 'no urls', 'not an object', 'not an object']);
  assert.equal(normalizeWatchList([{ name: 'A', url: 'https://a.example' }]).competitors.length, 1, 'bare array works');
  assert.deepEqual(normalizeWatchList('nonsense').competitors, []);
  const many = Array.from({ length: 30 }, (_, i) => ({ name: `C${i}`, url: `https://c${i}.example` }));
  assert.equal(normalizeWatchList(many).competitors.length, 25);
});

test('robots.txt: own group beats *, longest match wins, Allow wins ties, * and $ patterns work', () => {
  const g = parseRobots(`# comment
User-agent: *
Disallow: /private
Allow: /private/ok
Disallow: /*.pdf$
Disallow:

User-agent: OtherBot
User-agent: WhalyomBot
Disallow: /pricing
`);
  assert.equal(g.length, 2);
  assert.deepEqual(g[1].agents, ['otherbot', 'whalyombot']);
  assert.equal(robotsAllows(g, '/pricing'), false, 'own group');
  assert.equal(robotsAllows(g, '/private/x'), true, 'own group replaces *, so /private is open to us');
  const star = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/ok\nDisallow: /*.pdf$\nAllow: /tie\nDisallow: /tie');
  assert.equal(robotsAllows(star, '/private/x'), false);
  assert.equal(robotsAllows(star, '/private/ok/page'), true);
  assert.equal(robotsAllows(star, '/files/a.pdf'), false);
  assert.equal(robotsAllows(star, '/files/a.pdf?x=1'), true, '$ anchors the end');
  assert.equal(robotsAllows(star, '/tie'), true);
  assert.equal(robotsAllows(star, '/'), true);
  assert.equal(robotsAllows(parseRobots('User-agent: *\nDisallow: /'), '/anything'), false);
  assert.equal(robotsAllows(parseRobots(''), '/x'), true);
  assert.equal(robotsAllows(parseRobots('Disallow: /orphan'), '/orphan'), true, 'rules outside a group are ignored');
});

test('extraction: visible text only, headings, feature lines, prices with currency and period', () => {
  const html = pricingHtml(29);
  const text = visibleText(html);
  assert.ok(!text.includes('999') && !text.includes('$5') && !text.includes('.x{}'), 'scripts, styles and comments are not visible');
  assert.ok(text.includes('Contact sales@acme.example for & more'));
  assert.deepEqual(headings(html), ['Simple pricing', 'Starter', 'Pro']);
  assert.deepEqual(featureLines(html), ['Unlimited quotes and invoices', 'E-signature on every plan'], 'nav items left out');
  const prices = extractPrices('Pro $29/month. Team €1.200 per year. Basic 19.99 USD per user. Old US$ 7. Free 0 GBP');
  assert.deepEqual(prices.map((p) => [p.currency, p.amount, p.period]), [['EUR', 1200, 'year'], ['GBP', 0, 'once'], ['USD', 29, 'month'], ['USD', 7, 'once'], ['USD', 19.99, 'user']]);
  assert.deepEqual(prices.map((p) => p.context), ['Team', 'Free', 'Pro', 'Old', 'Basic']);
  assert.equal(prices.find((p) => p.amount === 29).context, 'Pro');
  assert.deepEqual(extractPrices(''), []);
  assert.deepEqual(extractPrices(null), []);
  const page = extractPage(html);
  assert.equal(page.title, 'Acme pricing');
  assert.match(page.hash, /^[0-9a-f]{64}$/);
  assert.ok(page.text.includes('[email]') && !page.text.includes('sales@acme.example'), 'emails redacted in stored text');
  assert.equal(extractPage(html.replace('<body>', '<body class="new-theme">')).hash, page.hash, 'markup-only change keeps the hash');
  assert.notEqual(extractPage(pricingHtml(39)).hash, page.hash);
  const plain = extractPage('Changelog\nv2: $10/mo', 'text/plain');
  assert.deepEqual(plain.headings, []);
  assert.equal(plain.prices[0].amount, 10);
});

test('diff: price changes are paired, new headings and features listed, same hash means no change', () => {
  const a = { status: 'ok', ...extractPage(pricingHtml(29)) };
  const b = { status: 'ok', ...extractPage(pricingHtml(39, '<li>New AI quote builder</li>').replace('<h2>Pro</h2>', '<h2>Pro</h2><h3>Now with AI</h3>')) };
  const b2 = { status: 'ok', ...extractPage(pricingHtml(39, '<li>New AI quote builder</li>').replace('Simple pricing</h1>', 'Simple pricing</h1><h2>Enterprise</h2><p>Enterprise $199/month</p>')) };
  assert.deepEqual(diffPage(a, { ...a }), { status: 'same', changed: false });
  const d = diffPage(a, b2);
  assert.equal(d.changed, true);
  assert.deepEqual(d.price_changes, [{ currency: 'USD', period: 'month', context: 'Pro', from: 29, to: 39, direction: 'up', pct: 34.5 }]);
  assert.deepEqual(d.prices_added, ['USD 199/month (Enterprise)']);
  assert.deepEqual(d.prices_removed, []);
  assert.deepEqual(d.headings_added, ['Enterprise']);
  assert.deepEqual(d.features_added, ['New AI quote builder']);
  assert.deepEqual(diffPage(a, b).headings_added, ['Now with AI']);
  assert.equal(diffPage(null, a).status, 'new');
  assert.equal(diffPage(a, { status: 'blocked', error: 'disallowed by robots.txt' }).status, 'blocked');
  assert.equal(diffPage({ status: 'error' }, a).status, 'new', 'an earlier failed read counts as first read');
  const s = diffSnapshots({ name: 'Acme', id: 'acme', date: '2026-11-03', pages: { pricing: a } }, { name: 'Acme', id: 'acme', date: '2026-11-04', pages: { pricing: b2, home: { status: 'error', error: 'HTTP 500' } } });
  assert.equal(s.changed, true);
  assert.equal(s.counts.price_changes, 1);
  assert.equal(s.counts.errors, 1);
  assert.equal(diffSnapshots(null, { name: 'Acme', id: 'acme', date: '2026-11-04', pages: { pricing: a } }).first_snapshot, true);
  const r = buildReport({ slug: 'x', date: '2026-11-04', diffs: [s, { ...s, id: 'aaa', name: 'Aaa', changed: false, counts: { ...s.counts, price_changes: 0 } }] });
  assert.deepEqual(r.competitors.map((c) => c.id), ['aaa', 'acme'], 'sorted for deterministic output');
  assert.equal(r.totals.price_changes, 1);
  const md = reportMarkdown(r);
  assert.ok(md.includes('Price up: USD 29 -> 39/month (Pro), +34.5%') && md.includes('New feature line: New AI quote builder') && md.includes('home: error (HTTP 500)'));
  const run = runResult(r, { taskId: 'CW-1', files: ['research/competitor-diff.md'] });
  assert.deepEqual(run.approvals, [], 'read-only work proposes no outbound action');
  assert.equal(run.alerts.length, 2);
  assert.equal(run.new_tasks[0].priority, 'high');
  assert.deepEqual(run.new_tasks[0].depends_on, ['CW-1']);
});

test('throttle: one request per second, the first goes straight out', async () => {
  const t = fakeTime();
  const th = createThrottle({ intervalMs: 1000, now: t.now, sleep: t.sleep });
  await th(); await th(); await th();
  assert.deepEqual(t.waits, [1000, 1000]);
});

test('crawler: robots read once per origin, disallowed paths never fetched, polite UA, guards on errors', async () => {
  const t = fakeTime();
  const web = fakeWeb({
    'https://acme.example/robots.txt': { body: 'User-agent: *\nDisallow: /changelog', type: 'text/plain' },
    'https://acme.example/': { body: '<h1>Acme</h1>' },
    'https://acme.example/pricing': { body: pricingHtml(29) },
    'https://acme.example/logo.png': { body: 'x', type: 'image/png' },
    'https://acme.example/big': { body: 'x'.repeat(5000) },
    'https://down.example/robots.txt': { status: 503, body: '' },
    'https://gone.example/robots.txt': new Error('ECONNREFUSED'),
    'https://norobots.example/': { status: 500, body: 'oops' },
  });
  const c = createCrawler({ fetch: web.fetch, sleep: t.sleep, now: t.now, maxBytes: 4000 });
  assert.equal((await c.page('https://acme.example/')).status, 'ok');
  assert.equal((await c.page('https://acme.example/pricing')).prices.length, 2);
  const blocked = await c.page('https://acme.example/changelog');
  assert.deepEqual([blocked.status, blocked.error], ['blocked', 'disallowed by robots.txt']);
  assert.match((await c.page('https://acme.example/logo.png')).error, /unsupported content type image\/png/);
  assert.match((await c.page('https://acme.example/big')).error, /too large/);
  assert.match((await c.page('https://down.example/pricing')).error, /robots.txt answered 503/);
  assert.match((await c.page('https://gone.example/')).error, /robots.txt unreadable/);
  assert.equal((await c.page('https://norobots.example/')).error, 'HTTP 500', '404 robots means no rules');
  const urls = web.calls.map((x) => x.url);
  assert.equal(urls.filter((u) => u === 'https://acme.example/robots.txt').length, 1, 'robots cached per origin');
  assert.ok(!urls.includes('https://acme.example/changelog') && !urls.includes('https://down.example/pricing'), 'blocked pages are never requested');
  assert.ok(web.calls.every((x) => x.ua === USER_AGENT));
  assert.equal(t.waits.length, web.calls.length - 1, 'every request after the first waited');
  assert.ok(t.waits.every((w) => w === 1000));
  const capped = createCrawler({ fetch: web.fetch, sleep: t.sleep, now: t.now, maxRequests: 2 });
  await capped.page('https://acme.example/');
  const over = await capped.page('https://acme.example/pricing');
  assert.equal(over.status, 'skipped');
  assert.equal(capped.requests, 2);
  assert.throws(() => createCrawler({ fetch: 'nope' }), /needs a fetch function/);
});

test('crawler redirects: every hop re-checked for public host and robots, loops capped, fetch never follows', async () => {
  const t = fakeTime();
  const web = fakeWeb({
    'https://acme.example/robots.txt': { body: 'User-agent: *\nDisallow: /secret', type: 'text/plain' },
    'https://acme.example/old': { status: 301, location: '/pricing' },
    'https://acme.example/pricing': { body: pricingHtml(29) },
    'https://acme.example/to-private': { status: 302, location: 'http://169.254.169.254/latest/meta-data' },
    'https://acme.example/to-mapped': { status: 302, location: 'http://[::ffff:127.0.0.1]/' },
    'https://acme.example/to-secret': { status: 302, location: '/secret' },
    'https://acme.example/to-other': { status: 302, location: 'https://other.example/x' },
    'https://other.example/robots.txt': { body: 'User-agent: *\nDisallow: /', type: 'text/plain' },
    'https://acme.example/loop': { status: 302, location: '/loop' },
    'https://acme.example/nowhere': { status: 302 },
  });
  const seen = [];
  const fetch = async (url, init) => { seen.push(init.redirect); return web.fetch(url, init); };
  const c = createCrawler({ fetch, sleep: t.sleep, now: t.now });
  const ok = await c.page('https://acme.example/old');
  assert.deepEqual([ok.status, ok.final_url], ['ok', 'https://acme.example/pricing']);
  assert.match((await c.page('https://acme.example/to-private')).error, /non-public/);
  assert.match((await c.page('https://acme.example/to-mapped')).error, /non-public/);
  assert.equal((await c.page('https://acme.example/to-secret')).error, 'disallowed by robots.txt');
  assert.equal((await c.page('https://acme.example/to-other')).error, 'disallowed by robots.txt', 'robots of the new origin applies');
  assert.match((await c.page('https://acme.example/loop')).error, /more than 5 redirects/);
  assert.match((await c.page('https://acme.example/nowhere')).error, /missing or non-public/);
  const urls = web.calls.map((x) => x.url);
  assert.ok(!urls.some((u) => u.includes('169.254') || u.includes('::ffff') || u.endsWith('/secret') || u === 'https://other.example/x'), 'redirect targets that fail a guard are never requested');
  assert.ok(seen.every((r) => r === 'manual'));
});

test('guards: mapped IPv6 and CGNAT hosts refused, empty user-agent group ignored, streamed size cap, emails redacted in headings', async () => {
  for (const bad of ['http://[::ffff:127.0.0.1]/', 'http://100.64.0.1/', 'http://[fe80::1]/']) assert.equal(publicUrl(bad), null, bad);
  assert.equal(publicUrl('http://100.200.0.1/'), 'http://100.200.0.1/');
  const g = parseRobots('User-agent:\nDisallow: /\n\nUser-agent: bot\nDisallow: /\n\nUser-agent: *\nAllow: /');
  assert.equal(robotsAllows(g, '/x'), true, 'empty or substring agents do not select our group');
  assert.equal(robotsAllows(parseRobots('User-agent: WhalyomBot/1.0\nDisallow: /'), '/x'), false, 'token with version still matches');
  let cancelled = false;
  const stream = { status: 200, headers: new Map([['content-type', 'text/html']]), body: { getReader: () => { let i = 0; return { read: async () => (i++ < 100 ? { done: false, value: new Uint8Array(1000) } : { done: true }), cancel: async () => { cancelled = true; } }; } } };
  const t = fakeTime();
  const c = createCrawler({ fetch: async (u) => (u.endsWith('/robots.txt') ? { status: 404, headers: new Map(), text: async () => '' } : stream), sleep: t.sleep, now: t.now, maxBytes: 5000 });
  assert.match((await c.page('https://big.example/')).error, /too large \(over 5000 bytes\)/);
  assert.ok(cancelled, 'stream cancelled at the cap');
  assert.deepEqual(headings('<h2>Write to ceo@acme.example</h2>'), ['Write to [email]']);
  assert.deepEqual(featureLines('<ul><li>Mail sales@acme.example today</li></ul>'), ['Mail [email] today']);
});

test('diff hardening: wording-only change raises no follow-up task, malformed or corrupt earlier snapshots do not crash', async () => {
  const a = { status: 'ok', ...extractPage(pricingHtml(29)) };
  const w = { status: 'ok', ...extractPage(pricingHtml(29).replace('Contact sales', 'Talk to sales')) };
  const d = diffPage(a, w);
  assert.deepEqual([d.changed, d.substantive], [true, false]);
  const s = diffSnapshots({ name: 'Acme', id: 'acme', date: '2026-11-03', pages: { pricing: a } }, { name: 'Acme', id: 'acme', date: '2026-11-04', pages: { pricing: w } });
  const r = buildReport({ slug: 'x', date: '2026-11-04', diffs: [s] });
  assert.deepEqual(runResult(r, { taskId: 'T' }).new_tasks, []);
  assert.ok(reportMarkdown(r).includes('wording only'));
  assert.equal(diffPage({ status: 'ok', hash: 'x' }, a).changed, true, 'previous page without arrays');
  const ws = makeProduct('zz-corrupt', [{ name: 'Acme', url: 'https://acme.example/' }]);
  const dir = path.join(ws, 'research', 'competitor-snapshots', 'acme');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-11-01.json'), JSON.stringify({ name: 'Acme', id: 'acme', date: '2026-11-01', pages: { home: { status: 'ok', ...extractPage('<h1>Acme</h1>') } } }));
  fs.writeFileSync(path.join(dir, '2026-11-02.json'), '{broken');
  const web = fakeWeb({ 'https://acme.example/': { body: '<h1>Acme</h1>' } });
  const out = await watchProduct('zz-corrupt', { rootDir: tmp, date: '2026-11-04', fetch: web.fetch, sleep: async () => {}, clock: () => 0 });
  assert.equal(out.report.competitors[0].previous_date, '2026-11-01', 'corrupt newest file skipped');
  assert.equal(out.report.competitors[0].pages.home.status, 'same');
});

test('watchProduct: snapshots per day, diff against the newest earlier day, report and run file written', async () => {
  const ws = makeProduct('zz-cw', { competitors: [{ name: 'Acme', urls: { home: 'https://acme.example/', pricing: 'https://acme.example/pricing', changelog: 'https://acme.example/changelog' } }, { name: 'Bad', urls: { home: 'http://127.0.0.1/' } }] });
  const pages = {
    'https://acme.example/robots.txt': { body: 'User-agent: whalyombot\nDisallow: /changelog', type: 'text/plain' },
    'https://acme.example/': { body: '<h1>Acme</h1><p>Quotes for trades</p>' },
    'https://acme.example/pricing': { body: pricingHtml(29) },
  };
  const opts = (date) => ({ rootDir: tmp, now: `${date}T08:00:00.000Z`, sleep: async () => {}, clock: () => 0, fetch: fakeWeb(pages).fetch });
  const first = await watchProduct('zz-cw', { ...opts('2026-11-03') });
  assert.equal(first.report.totals.first_snapshots, 1);
  assert.equal(first.report.skipped[0].name, 'Bad');
  const snap1 = JSON.parse(fs.readFileSync(path.join(ws, 'research/competitor-snapshots/acme/2026-11-03.json'), 'utf8'));
  assert.equal(snap1.pages.changelog.status, 'blocked');
  assert.match(snap1.pages.pricing.hash, /^[0-9a-f]{64}$/);

  pages['https://acme.example/pricing'] = { body: pricingHtml(39, '<li>New AI quote builder</li>') };
  const second = await watchProduct('zz-cw', { ...opts('2026-11-10'), taskId: 'CW-2026-11-10' });
  assert.equal(second.report.totals.changed, 1);
  assert.equal(second.report.totals.price_changes, 1);
  const acme = second.report.competitors[0];
  assert.equal(acme.previous_date, '2026-11-03');
  assert.equal(acme.pages.home.status, 'same');
  assert.deepEqual(acme.pages.pricing.features_added, ['New AI quote builder']);
  assert.ok(fs.readFileSync(path.join(ws, 'research/competitor-diff.md'), 'utf8').includes('Price up: USD 29 -> 39/month (Pro)'));
  const run = JSON.parse(fs.readFileSync(path.join(ws, 'runs/CW-2026-11-10.json'), 'utf8'));
  assert.equal(run.task_id, 'CW-2026-11-10');
  assert.deepEqual(run.approvals, []);
  assert.ok(run.output.includes('research/competitor-snapshots/acme/2026-11-10.json'));

  // Same-day re-run replaces that day's file and still compares against 2026-11-03, byte-identical report.
  const before = fs.readFileSync(path.join(ws, 'research/competitor-diff.json'), 'utf8');
  const again = await watchProduct('zz-cw', { ...opts('2026-11-10') });
  assert.equal(again.report.competitors[0].previous_date, '2026-11-03');
  assert.equal(fs.readFileSync(path.join(ws, 'research/competitor-diff.json'), 'utf8'), before, 'deterministic output');
  assert.deepEqual(fs.readdirSync(path.join(ws, 'research/competitor-snapshots/acme')).sort(), ['2026-11-03.json', '2026-11-10.json']);

  // Dry run writes nothing.
  const dry = await watchProduct('zz-cw', { ...opts('2026-11-11'), dryRun: true });
  assert.equal(dry.files.length, 0);
  assert.ok(!fs.existsSync(path.join(ws, 'research/competitor-snapshots/acme/2026-11-11.json')));
});

test('watchProduct guards: bad slug, missing product, paused, no list, broken JSON, bad date or task id', async () => {
  const base = { rootDir: tmp, fetch: async () => { throw new Error('must not fetch'); }, sleep: async () => {} };
  await assert.rejects(watchProduct('../etc', base), /invalid product slug/);
  await assert.rejects(watchProduct('_template', base), /invalid product slug/);
  await assert.rejects(watchProduct('zz-missing', base), /no product.json/);
  makeProduct('zz-paused', [{ name: 'A', url: 'https://a.example' }], { stage: 'paused' });
  assert.equal((await watchProduct('zz-paused', base)).skipped, 'paused');
  makeProduct('zz-nolist');
  assert.equal((await watchProduct('zz-nolist', base)).skipped, 'no watch list');
  makeProduct('zz-broken', '{not json');
  await assert.rejects(watchProduct('zz-broken', base), /not valid JSON/);
  makeProduct('zz-empty', { competitors: [] });
  assert.equal((await watchProduct('zz-empty', { ...base, date: '2026-11-04' })).report.totals.competitors, 0);
  await assert.rejects(watchProduct('zz-empty', { ...base, date: '2026-13-45' }), /invalid date/);
  await assert.rejects(watchProduct('zz-empty', { ...base, taskId: '../../x' }), /invalid task id/);
});

test('watchAll: one shared crawler across products, state file holds counts only', async () => {
  const root2 = path.join(tmp, 'all');
  fs.mkdirSync(path.join(root2, 'products'), { recursive: true });
  for (const s of ['p1', 'p2']) {
    const ws = path.join(root2, 'products', s);
    fs.mkdirSync(path.join(ws, 'research'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'product.json'), '{"stage":"launch"}');
    fs.writeFileSync(path.join(ws, 'research', 'competitors.json'), JSON.stringify([{ name: 'Acme', url: 'https://acme.example/' }]));
  }
  const web = fakeWeb({ 'https://acme.example/': { body: '<h1>Acme</h1><p>mail ceo@acme.example</p>' } });
  const out = await watchAll({ rootDir: root2, now: '2026-11-04T00:00:00.000Z', fetch: web.fetch, sleep: async () => {}, clock: () => 0 });
  assert.deepEqual(out.products.map((p) => p.slug), ['p1', 'p2']);
  assert.equal(web.calls.filter((c) => c.url.endsWith('/robots.txt')).length, 1, 'robots cache shared');
  const state = fs.readFileSync(path.join(root2, 'state', 'competitor-watch.json'), 'utf8');
  assert.ok(!state.includes('acme.example') && !state.includes('@'), 'no page text or contacts in shared state');
});

test('CLI: usage error without a slug, skip message for a product with no watch list', () => {
  const cli = path.join(repo, 'tools', 'competitor-watch.mjs');
  const r = spawnSync(process.execPath, [cli], { encoding: 'utf8', cwd: repo });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage/);
  const r2 = spawnSync(process.execPath, [cli, 'zz-cw-no-such-product', '--dry-run'], { encoding: 'utf8', cwd: repo });
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /no product.json/);
});
