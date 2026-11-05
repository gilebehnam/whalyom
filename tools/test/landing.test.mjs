// Landing page builder: claims-only copy, valid JSON-LD, every template renders, variants differ,
// lead capture modes, contrast, local publishing. Builds into temporary folders only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseClaims, makeGuard } from '../landing/claims.mjs';
import { buildLanding } from '../landing/build.mjs';
import { publishLanding } from '../landing/publish.mjs';
import { TEMPLATES, TEMPLATE_NAMES } from '../landing/templates.mjs';
import localSite from '../connectors/local-site.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wy-landing-'));
const sampleDir = path.join(root, 'products', 'sample-quoteflow');

const CLAIMS = `# Claims
| id | claim | status | source |
|---|---|---|---|
| C1 | Acme Notes is a note-taking app for small teams. | verified | owner |
| C2 | Notes sync across devices. | verified | owner |
| C3 | Pro plan: $12/month. | verified | owner |
| C4 | 30-day free trial. | verified | owner |
| C5 | Saves teams 10 hours a week. | needs-proof | none |
| C6 | Loved by 500 teams. | needs-proof | none |
`;

const BRIEF = {
  page: { title: 'Acme Notes — notes for small teams', description: 'A note-taking app for small teams.' },
  hero: { headline: 'Notes for small teams', subhead: 'Notes sync across devices.', claims: ['C1', 'C2'], cta: { label: 'Start the 30-day free trial', href: '#lead', claims: ['C4'] } },
  problem: { title: 'Notes get lost', points: [{ text: 'Notes end up scattered across apps.' }] },
  features: { title: 'Features', items: [
    { title: 'Sync', body: 'Notes sync across devices.', claims: ['C2'] },
    { title: 'Time saver', body: 'Saves teams 10 hours a week.', claims: ['C5'] },
    { title: 'Faster', body: 'Cut meeting time by 40%.', claims: ['C2'] },
    { title: 'Popular', body: 'Trusted by agencies everywhere.', claims: ['C1'] },
  ] },
  social_proof: { items: [{ quote: 'Best app ever!', author: 'A customer', claims: ['C6'] }] },
  pricing: { plans: [{ name: 'Pro', price: '$12', period: '/month', features: ['30-day free trial'], claims: ['C3', 'C4'], cta: { label: 'Choose Pro', href: '#lead' } }, { name: 'Team', price: '$99', period: '/month', claims: ['C3'] }] },
  faq: { items: [{ q: 'Is there a trial?', a: 'Yes, a 30-day free trial.', claims: ['C4'] }, { q: 'How fast is it?', a: 'Set up in minutes.', claims: ['C1'] }] },
  final_cta: { headline: 'Try Acme Notes', cta: { label: 'Get started', href: '#lead' } },
  lead_form: { title: 'Get started', form_id: 'trial' },
  variants: [
    { id: 'b', hypothesis: 'Sync-first headline lifts submits', hero: { headline: 'Your notes, on every device', claims: ['C2'] }, cta: { label: 'Try it free for 30 days', claims: ['C4'] } },
    { id: 'bad', hypothesis: 'Proof-first', hero: { headline: 'Loved by 500 teams', claims: ['C6'] } },
  ],
};

function workspace(name, { brief = BRIEF, connection } = {}) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, 'landing'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'product.json'), JSON.stringify({ name: 'Acme Notes', slug: name, domain: 'acmenotes.example', stage: 'active', model: 'b2b-saas', language: 'en', budget: { currency: 'USD' } }));
  fs.writeFileSync(path.join(dir, 'claims.md'), CLAIMS);
  if (brief) fs.writeFileSync(path.join(dir, 'landing', 'brief.json'), JSON.stringify(brief));
  if (connection) fs.writeFileSync(path.join(dir, 'connection.json'), JSON.stringify(connection));
  return dir;
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, 'landing', 'dist', rel), 'utf8');
const textOf = (html) => html.replace(/<style>[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, '');
const ldOf = (html) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);

let main;
before(() => {
  main = workspace('acme');
  buildLanding({ dir: main, template: 'all', variant: 'all', task: 'T-LP1' });
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('claims.md parses and the guard rejects unverified ids, invented numbers and unbacked phrases', () => {
  const claims = parseClaims(CLAIMS);
  assert.equal(claims.length, 6);
  assert.equal(claims.filter((c) => c.status === 'verified').length, 4);
  const check = makeGuard(claims);
  assert.deepEqual(check({ body: 'Notes sync across devices.', claims: ['C2'] }, 'x'), []);
  assert.equal(check({ body: 'Saves teams 10 hours.', claims: ['C5'] }, 'x')[0].rule, 'unverified-claim');
  assert.ok(check({ body: 'Only $9/month.', claims: ['C3'] }, 'x').some((i) => i.rule === 'number-not-in-claims'));
  assert.ok(check({ body: 'The best notes app.', claims: ['C1'] }, 'x').some((i) => i.rule === 'unbacked-phrase'));
  assert.ok(check({ body: 'Hi', claims: ['C99'] }, 'x').some((i) => i.rule === 'unknown-claim'));
  // the real sample product's claims file parses too
  const sample = parseClaims(fs.readFileSync(path.join(sampleDir, 'claims.md'), 'utf8'));
  assert.ok(sample.filter((c) => c.status === 'verified').length >= 5);
});

test('claims-only: unverified, invented or unbacked copy never reaches the page', () => {
  for (const name of TEMPLATE_NAMES) {
    const html = textOf(read(main, `${name}/index.html`));
    assert.match(html, /Notes sync across devices\./, `${name}: verified copy is kept`);
    for (const bad of ['10 hours', '40%', 'Trusted by', 'Best app ever', 'Loved by 500', '$99', 'in minutes']) assert.ok(!html.includes(bad), `${name}: "${bad}" must be dropped`);
    assert.match(html, /data-placeholder="social-proof"/, `${name}: social proof is a marked placeholder`);
    assert.match(html, /data-placeholder="guarantee"/, `${name}: guarantee is a marked placeholder`);
    assert.ok(!/aggregateRating|"review"/i.test(html), `${name}: no ratings or reviews in markup`);
  }
  const b = JSON.parse(read(main, 'saas/build.json'));
  const rules = new Set(b.issues.map((i) => i.rule));
  for (const r of ['unverified-claim', 'number-not-in-claims', 'unbacked-phrase']) assert.ok(rules.has(r), `issue ${r} is reported`);
});

test('every template renders a complete, accessible page with SEO and AEO built in', () => {
  assert.ok(TEMPLATE_NAMES.length >= 6);
  assert.ok(TEMPLATE_NAMES.includes('night'));
  for (const name of TEMPLATE_NAMES) {
    const html = read(main, `${name}/index.html`);
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /<html lang="en"/);
    for (const re of [/<header class="site-head"/, /<main id="main"/, /<footer/, /<nav [^>]*aria-label=/, /class="skip" href="#main"/, /<h1 id="hero-title">/]) assert.match(html, re, `${name}: ${re}`);
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1, `${name}: one h1`);
    for (const re of [/<title>[^<]+<\/title>/, /<meta name="description" content="[^"]+">/, /<link rel="canonical" href="https:\/\/acmenotes\.example\/">/, /property="og:title"/, /name="twitter:card"/, /<meta name="viewport"/]) assert.match(html, re, `${name}: ${re}`);
    assert.match(html, /<label for="lf-email">/); assert.match(html, /id="lf-email"[^>]*required/);
    assert.match(html, /<input type="checkbox" name="consent" value="yes" required>/, `${name}: consent is required and not pre-checked`);
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign']) assert.match(html, new RegExp(`name="${k}"`));
    assert.ok(!/<link rel="stylesheet" href="(?!https:\/\/fonts\.googleapis\.com)/.test(html), `${name}: only Google Fonts as external CSS`);
    assert.ok(!/<script src=/.test(html), `${name}: no external scripts without a satellite`);
    const ld = ldOf(html);
    const types = ld['@graph'].map((x) => x['@type']);
    for (const t of ['Organization', 'SoftwareApplication', 'WebPage', 'FAQPage']) assert.ok(types.includes(t), `${name}: JSON-LD ${t}`);
    const faq = ld['@graph'].find((x) => x['@type'] === 'FAQPage');
    assert.equal(faq.mainEntity.length, 1, 'only the verified FAQ answer is in FAQPage');
    const app = ld['@graph'].find((x) => x['@type'] === 'SoftwareApplication');
    assert.equal(app.offers.price, '12'); assert.equal(app.offers.priceCurrency, 'USD');
    assert.match(read(main, `${name}/sitemap.xml`), /<loc>https:\/\/acmenotes\.example\/<\/loc>/);
    const llms = read(main, `${name}/llms.txt`);
    assert.match(llms, /^# Acme Notes/); assert.match(llms, /Notes sync across devices\./); assert.ok(!llms.includes('10 hours'));
  }
  assert.match(read(main, 'night/index.html'), /family=Jost/);
  assert.match(read(main, 'night/index.html'), /#f2c230/i);
  assert.match(read(main, 'night/index.html'), /class="trees"/);
});

test('template colours meet WCAG AA contrast', () => {
  const lum = (hex) => { const n = hex.replace('#', ''); const c = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const [name, t] of Object.entries(TEMPLATES)) {
    const k = t.tokens;
    for (const [fg, bg] of [['text', 'bg'], ['muted', 'bg'], ['link', 'bg'], ['text', 'surface'], ['muted', 'surface'], ['accentInk', 'accent']]) {
      const r = ratio(k[fg], k[bg]);
      assert.ok(r >= 4.5, `${name}: ${fg} on ${bg} is ${r.toFixed(2)}:1`);
    }
  }
});

test('variants differ, rejected variant copy falls back to control, and variant metadata is written', () => {
  const control = read(main, 'saas/index.html');
  const b = read(main, 'saas/b/index.html');
  assert.notEqual(control, b);
  assert.match(control, /<h1 id="hero-title">Notes for small teams<\/h1>/);
  assert.match(b, /<h1 id="hero-title">Your notes, on every device<\/h1>/);
  assert.match(b, /Try it free for 30 days/); assert.ok(!control.includes('Try it free for 30 days'));
  assert.match(b, /data-variant="b"/); assert.match(b, /<input type="hidden" name="variant" value="b">/);
  assert.match(b, /<link rel="canonical" href="https:\/\/acmenotes\.example\/">/, 'variants point canonical at the control');
  const bad = read(main, 'saas/bad/index.html');
  assert.ok(!bad.includes('Loved by 500'), 'a variant citing an unverified claim keeps the control headline');
  assert.match(bad, /Notes for small teams/);
  const v = JSON.parse(fs.readFileSync(path.join(main, 'landing', 'variants.json'), 'utf8'));
  assert.equal(v.experiments.length, TEMPLATE_NAMES.length);
  const exp = v.experiments.find((e) => e.id.includes('-saas-'));
  assert.deepEqual(exp.arms.map((a) => a.id), ['control', 'b', 'bad']);
  assert.equal(exp.metric, 'lead_submit_rate');
  assert.ok(!fs.existsSync(path.join(main, 'experiments.json')), 'experiments.json is never written by the builder');
  const run = JSON.parse(fs.readFileSync(path.join(main, 'runs', 'T-LP1.json'), 'utf8'));
  assert.equal(run.task_id, 'T-LP1'); assert.equal(run.agent, 'om-landing-builder');
  assert.equal(run.approvals.length, TEMPLATE_NAMES.length);
  assert.ok(run.approvals.every((a) => a.type === 'publish' && a.channel === 'landing' && /^landing\/dist\/[a-z]+\/index\.html$/.test(a.file)));
  assert.equal(run.experiments[0].status, 'proposed');
});

test('lead capture: satellite /collect when a site is attached, otherwise a visible preview note', () => {
  const sat = workspace('acme-sat', { connection: { domain: 'acmenotes.example', satellite: 'https://acmenotes.example' } });
  buildLanding({ dir: sat, template: 'minimal' });
  const html = read(sat, 'minimal/index.html');
  const cfg = JSON.parse(html.match(/<script type="application\/json" id="wy-cfg">([\s\S]*?)<\/script>/)[1]);
  assert.equal(cfg.mode, 'satellite'); assert.equal(cfg.endpoint, 'https://acmenotes.example/collect');
  assert.match(html, /<script async src="https:\/\/acmenotes\.example\/whalyom\.js"><\/script>/);
  const none = read(main, 'minimal/index.html');
  assert.match(none, /"mode":"none"/);
  assert.match(none, /class="wy-note">Preview: this form is not connected yet/);
  const mail = workspace('acme-mail', { brief: { ...BRIEF, lead_form: { ...BRIEF.lead_form, mailto: 'hello@acmenotes.example' } } });
  buildLanding({ dir: mail, template: 'saas' });
  assert.match(read(mail, 'saas/index.html'), /"mode":"mailto"/);
});

test('with no brief.json the page is built from verified claims only', () => {
  const d = workspace('acme-derived', { brief: null });
  const r = buildLanding({ dir: d, template: 'editorial' });
  assert.equal(r.derived, true);
  const html = read(d, 'editorial/index.html');
  assert.match(html, /Notes sync across devices\./);
  assert.match(html, /Pro plan: \$12\/month\./);
  assert.ok(!html.includes('10 hours') && !html.includes('Loved by'), 'needs-proof claims are not used');
});

test('publishing copies builds into the static site; the local-site connector routes landing approvals', async () => {
  const site = path.join(tmp, 'site');
  const r = publishLanding({ dir: main, slug: 'acme', templates: ['night', 'saas'], siteRoot: site });
  assert.ok(r.ok);
  assert.ok(fs.existsSync(path.join(site, 'acme', 'landing', 'night', 'index.html')));
  assert.ok(fs.existsSync(path.join(site, 'acme', 'landing', 'saas', 'b', 'index.html')));
  assert.match(fs.readFileSync(path.join(site, 'acme', 'landing', 'index.html'), 'utf8'), /href="night\/"/);
  assert.match(fs.readFileSync(path.join(site, 'acme', 'landing', 'sitemap.xml'), 'utf8'), /landing\/night\//);
  const item = { id: 'A9', type: 'publish', channel: 'landing', file: 'landing/dist/night/index.html' };
  assert.ok(localSite.accepts(item));
  const res = await localSite.execute(item, { dir: main, slug: 'acme', dryRun: true });
  assert.equal(res.ok, true); assert.match(res.detail, /site\/acme\/landing\/night\//);
});

test('CLI builds the sample product into a chosen folder and lists templates', () => {
  const out = path.join(tmp, 'cli-out');
  const r = spawnSync(process.execPath, [path.join(root, 'tools', 'landing-builder.mjs'), 'sample-quoteflow', '--template', 'night', '--out', out], { encoding: 'utf8', cwd: root });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(j.pages.length, 1); assert.equal(j.pages[0].template, 'night');
  assert.deepEqual(j.issues, [], 'the sample brief passes the claims guard');
  const html = fs.readFileSync(path.join(out, 'night', 'index.html'), 'utf8');
  assert.match(html, /noindex/, 'the paused sample is never indexed');
  const list = spawnSync(process.execPath, [path.join(root, 'tools', 'landing-builder.mjs'), '--list'], { encoding: 'utf8', cwd: root });
  assert.equal(JSON.parse(list.stdout).length, TEMPLATE_NAMES.length);
  const bad = spawnSync(process.execPath, [path.join(root, 'tools', 'landing-builder.mjs'), 'no-such-product-xyz'], { encoding: 'utf8', cwd: root });
  assert.equal(bad.status, 2);
});
