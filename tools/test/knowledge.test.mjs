// Knowledge engine: feed parsing, refresh, verified merge, freshness and generated briefs/skills.
// Runs in a temp knowledge folder (WHALYOM_KNOWLEDGE) with a fake fetcher: no network.
// Run alone with: node --test tools/test/knowledge.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-know-'));
process.env.WHALYOM_KNOWLEDGE = path.join(tmp, 'knowledge');
process.env.WHALYOM_KNOWLEDGE_SKILLS = path.join(tmp, 'skills');
const { parseFeed, refresh, apply, check, brief, factId, statementHash, validateFact, loadBase, readInbox, search, K } = await import('../knowledge/engine.mjs');
const { TOPICS } = await import('../knowledge/topics.mjs');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const NOW = '2026-11-03T06:00:00.000Z';
const w = (rel, data) => { const f = K(rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(data)); };
const fact = (over = {}) => ({
  topic: 'search', statement: 'Google ignores the llms.txt file for Search ranking and crawling decisions.', source_url: 'https://developers.google.com/search/docs/example',
  source_title: 'Example', source_tier: 'official', published: '2026-09-01', confidence: 'high', review_days: 90, affects: ['om-geo-optimizer'], tags: [], ...over,
});

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[Core update &amp; spam]]></title><link>https://example.com/a</link><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;Rolling out now&lt;/p&gt;</description></item>
<item><title>Old news</title><link>https://example.com/old</link><pubDate>Mon, 02 Jan 2023 10:00:00 GMT</pubDate></item>
<item><title>Hiring news</title><link>https://example.com/jobs</link><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate></item>
</channel></rss>`;
const ATOM = `<feed><entry><title>Gmail sender rules</title><link rel="alternate" href="https://example.com/gmail"/><updated>2026-11-01T00:00:00Z</updated><summary>unsubscribe headers</summary></entry></feed>`;

test('parses RSS and Atom, decodes entities and CDATA', () => {
  const r = parseFeed(RSS);
  assert.equal(r.length, 3);
  assert.equal(r[0].title, 'Core update & spam');
  assert.equal(r[0].summary, 'Rolling out now');
  assert.equal(r[0].published, '2026-11-02T10:00:00.000Z');
  const a = parseFeed(ATOM);
  assert.deepEqual([a[0].title, a[0].url], ['Gmail sender rules', 'https://example.com/gmail']);
});

test('refresh fetches due sources, filters old and off-topic items, dedupes, records failures', async () => {
  w('sources.json', { sources: [
    { id: 's1', url: 'https://feeds.test/rss', tier: 'official', topics: ['search'], cadence_hours: 24, keywords: ['update', 'spam'] },
    { id: 's2', url: 'https://feeds.test/atom', tier: 'official', topics: ['email'], cadence_hours: 24 },
    { id: 's3', url: 'https://feeds.test/down', tier: 'official', topics: ['email'], cadence_hours: 24 },
  ] });
  const fetcher = async (url) => (url.endsWith('/rss') ? { ok: true, status: 200, text: RSS } : url.endsWith('/atom') ? { ok: true, status: 200, text: ATOM } : { ok: false, status: 503, text: '' });
  const r = await refresh({ now: NOW, fetcher });
  assert.equal(r.new_items, 2, 'one recent on-topic RSS item and one Atom item');
  assert.equal(r.sources.find((s) => s.id === 's3').ok, false);
  assert.deepEqual(readInbox().map((i) => i.url).sort(), ['https://example.com/a', 'https://example.com/gmail']);
  const again = await refresh({ now: NOW, fetcher });
  assert.ok(again.sources.every((s) => s.skipped === 'not due'), 'cadence respected');
  const forced = await refresh({ now: NOW, fetcher, force: true });
  assert.equal(forced.new_items, 0, 'seen items are not added twice');
});

test('validateFact rejects weak facts', () => {
  assert.deepEqual(validateFact(fact(), NOW), []);
  assert.ok(validateFact(fact({ source_tier: 'industry' }), NOW).length, 'industry press is never the only source');
  assert.ok(validateFact(fact({ source_url: 'http://x.test/a' }), NOW).length, 'https only');
  assert.ok(validateFact(fact({ published: '2027-01-01' }), NOW).length, 'no future dates');
  assert.ok(validateFact(fact({ topic: 'astrology' }), NOW).length);
  assert.ok(validateFact(fact({ confidence: 'low' }), NOW).length);
  assert.deepEqual(validateFact(fact({ kind: 'framework', topic: 'consulting', review_days: 730 }), NOW), []);
  assert.ok(validateFact(fact({ kind: 'opinion' }), NOW).length, 'kind must be a known kind');
});

test('check reports gaps, thinnest topics first', () => {
  const c = check({ now: NOW });
  assert.ok(Array.isArray(c.gaps) && c.gaps.length);
  for (let i = 1; i < c.gaps.length; i++) assert.ok(c.gaps[i - 1].facts <= c.gaps[i].facts);
  assert.ok(c.gaps.some((g) => g.topic === 'consulting'));
  assert.equal(typeof c.facts_by_topic['ai-tech'], 'number');
});

test('apply merges only verified runs, honours verdicts, supersedes and retires', () => {
  const a = fact();
  const b = fact({ statement: 'Gmail requires one-click unsubscribe for bulk senders of marketing mail.', topic: 'email', source_url: 'https://support.google.com/a/example' });
  const c = fact({ statement: 'A claim that the verifier will reject because the page does not say it.', source_url: 'https://developers.google.com/x' });
  w('runs/R1.json', { run_id: 'R1', agent: 'om-knowledge-scout', processed: [readInbox()[0].id], facts: [a, b, c] });
  let r = apply({ now: NOW });
  assert.deepEqual(r.waiting, ['R1'], 'unverified run waits');
  assert.equal(loadBase().facts.length, 0);
  w('runs/R1-V.json', { run_id: 'R1-V', agent: 'om-fact-verifier', verifies: 'R1', verdicts: [{ index: 0, verdict: 'keep', statement_hash: statementHash(a) }, { index: 1, verdict: 'fix', statement_hash: factId(b), statement: 'Gmail requires one-click unsubscribe (RFC 8058) for bulk senders of marketing mail.' }, { index: 2, verdict: 'reject', reason: 'not on page' }] });
  r = apply({ now: NOW });
  assert.equal(r.added.length, 2);
  assert.equal(r.rejected.length, 1);
  const base = loadBase();
  assert.ok(base.facts.some((f) => f.statement.includes('RFC 8058')), 'fix verdict rewrites the statement');
  assert.ok(fs.existsSync(K('runs', 'applied', 'R1.json')) && fs.existsSync(K('runs', 'applied', 'R1-V.json')));
  assert.equal(readInbox()[0].status, 'processed');
  assert.match(fs.readFileSync(K('CHANGELOG.md'), 'utf8'), /added K-/);

  const oldId = factId(a);
  const newer = fact({ statement: 'Google ignores llms.txt for Search; its shared AI-training robots control arrives in 2027.', supersedes: oldId });
  const emailId = base.facts.find((f) => f.topic === 'email').id;
  w('runs/R2.json', { run_id: 'R2', agent: 'om-fact-verifier', facts: [newer], retire: [{ id: emailId, reason: 'test' }] });
  assert.deepEqual(apply({ now: NOW }).waiting, ['R2'], 'a run cannot verify itself, even when its agent is the verifier');
  w('runs/R2-V.json', { run_id: 'R2-V', agent: 'om-fact-verifier', verifies: 'R2', verdicts: [{ index: 0, verdict: 'keep', statement_hash: statementHash(newer) }, { retire: emailId, verdict: 'keep' }] });
  r = apply({ now: NOW });
  assert.deepEqual(r.superseded, [oldId]);
  assert.equal(r.retired.length, 1);
  const after = loadBase().facts;
  assert.equal(after.find((f) => f.id === oldId).superseded_by, factId(newer));
  assert.equal(after.filter((f) => f.status === 'active').length, 1);
});

test('trusted runs can bootstrap without a verifier run', () => {
  w('runs/SEED.json', { run_id: 'SEED', agent: 'om-knowledge-scout', facts: [fact({ statement: 'Meta stopped political and social issue ads in the EU from October 2025.', topic: 'paid-social', source_url: 'https://about.fb.com/x' })] });
  assert.deepEqual(apply({ now: NOW }).waiting, ['SEED']);
  assert.equal(apply({ now: NOW, trust: ['SEED'] }).added.length, 1);
});

test('check marks stale facts; brief writes department briefs and one skill per topic', () => {
  const later = '2027-03-01T00:00:00.000Z';
  const c = check({ now: later, mark: true });
  assert.ok(c.facts_stale >= 1, 'facts past review_by are stale');
  assert.equal(loadBase().facts.filter((f) => f.status === 'stale').length, c.facts_stale);
  const b = brief({ now: NOW, agentDept: { 'om-geo-optimizer': 'seo' } });
  assert.equal(b.files, 28 + 1 + Object.keys(TOPICS).length); // 28 department briefs, BRIEFING.md, one skill per topic
  const seo = fs.readFileSync(K('briefs', 'seo.md'), 'utf8');
  assert.match(seo, /llms\.txt/);
  assert.doesNotMatch(seo, /llms\.txt file for Search ranking/, 'superseded facts leave the briefs');
  const skill = fs.readFileSync(path.join(process.env.WHALYOM_KNOWLEDGE_SKILLS, 'om-knowledge-search', 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: om-knowledge-search\ndescription: "/);
  assert.equal(check({ now: NOW }).briefs_outdated, false);
});

test('the shipped source list is well formed', () => {
  const real = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'knowledge', 'sources.json'), 'utf8')).sources;
  assert.ok(real.length >= 20);
  assert.equal(new Set(real.map((s) => s.id)).size, real.length);
  for (const s of real) {
    assert.match(s.url, /^https:\/\//, s.id);
    assert.ok(['official', 'research', 'industry'].includes(s.tier), s.id);
    for (const t of s.topics) assert.ok(TOPICS[t], `${s.id} topic ${t}`);
  }
  assert.ok(real.filter((s) => s.tier === 'official').length >= real.length / 2, 'mostly official sources');
});

// ── Verifier binding, retire verdicts, superseded facts and search freshness ─
// Each case runs in its own knowledge folder so earlier tests' facts do not interfere.
const fresh = (name) => {
  process.env.WHALYOM_KNOWLEDGE = path.join(tmp, name, 'knowledge');
  process.env.WHALYOM_KNOWLEDGE_SKILLS = path.join(tmp, name, 'skills');
};
const keep = (f, extra = {}) => ({ verdict: 'keep', statement_hash: statementHash(f), ...extra });
const seeded = (f, over = {}) => ({ id: factId(f), ...f, verified_at: NOW, review_by: '2027-02-01T00:00:00.000Z', review_days: 90, status: 'active', ...over });

test('a run reusing a verified run_id gets no verdicts, and a fact edited after its verdict is rejected', () => {
  fresh('dup');
  const A = fact({ statement: 'Good statement verified by the separate fact verifier on its source page.' });
  const B = fact({ statement: 'Unreviewed statement that nobody verified at all, smuggled in by run_id.' });
  w('runs/a.json', { run_id: 'R1', agent: 'om-knowledge-scout', facts: [A] });
  w('runs/b.json', { run_id: 'R1', agent: 'om-knowledge-scout', facts: [B] });
  w('runs/v.json', { run_id: 'V1', agent: 'om-fact-verifier', verifies: 'R1', verdicts: [{ index: 0, verdict: 'keep' }] });
  let r = apply({ now: NOW });
  assert.equal(r.added.length, 0);
  assert.ok(r.waiting.some((x) => /duplicate run_id R1/.test(x)) || r.rejected.length, 'B waits or is rejected');
  assert.ok(!loadBase().facts.some((f) => f.id === factId(B)), 'B never enters the base');

  // Once a.json is the only R1, a verdict bound to A applies only to A: an edited fact 0 loses it.
  fs.rmSync(K('runs', 'b.json'));
  w('runs/v.json', { run_id: 'V1', agent: 'om-fact-verifier', verifies: 'R1', verdicts: [{ index: 0, ...keep(A) }] });
  w('runs/a.json', { run_id: 'R1', agent: 'om-knowledge-scout', facts: [B] }); // fact 0 changed after the verdict
  r = apply({ now: NOW });
  assert.equal(r.added.length, 0);
  assert.equal(r.rejected[0].reason, 'verdict does not match fact');
  assert.ok(!loadBase().facts.some((f) => f.id === factId(B)));
});

test('retire needs its own verdict from a separate verifier run', () => {
  fresh('retire');
  const F = fact({ statement: 'A verified active fact that a single scout must not be able to retire.' });
  w('base.json', { version: 1, updated_at: NOW, facts: [seeded(F)] });
  w('runs/R.json', { run_id: 'R', agent: 'om-knowledge-curator', facts: [], retire: [{ id: factId(F), reason: 'gone' }] });
  w('runs/R-V.json', { run_id: 'R-V', agent: 'om-fact-verifier', verifies: 'R', verdicts: [] });
  let r = apply({ now: NOW });
  assert.equal(loadBase().facts[0].status, 'active');
  assert.ok(r.rejected.some((x) => x.retire === factId(F) && x.reason === 'retire not confirmed by a separate verifier run'));
  w('runs/R2.json', { run_id: 'R2', agent: 'om-knowledge-curator', facts: [], retire: [{ id: factId(F), reason: 'gone' }] });
  w('runs/R2-V.json', { run_id: 'R2-V', agent: 'om-fact-verifier', verifies: 'R2', verdicts: [{ retire: factId(F), verdict: 'keep' }] });
  r = apply({ now: NOW });
  assert.deepEqual(r.retired, [factId(F)]);
  assert.equal(loadBase().facts[0].status, 'retired');
});

test('a superseded fact extracted again stays superseded unless reinstated with verifier confirmation', () => {
  fresh('supersede');
  const A = fact({ statement: 'Old platform rule: one-click unsubscribe is optional for bulk senders.' });
  const B = fact({ statement: 'New platform rule: one-click unsubscribe is required for bulk senders.', source_url: 'https://developers.google.com/search/docs/new', supersedes: factId(A) });
  w('runs/A.json', { run_id: 'A', agent: 'om-knowledge-scout', facts: [A] });
  w('runs/A-V.json', { run_id: 'A-V', agent: 'om-fact-verifier', verifies: 'A', verdicts: [{ index: 0, ...keep(A) }] });
  apply({ now: NOW });
  w('runs/B.json', { run_id: 'B', agent: 'om-knowledge-scout', facts: [B] });
  w('runs/B-V.json', { run_id: 'B-V', agent: 'om-fact-verifier', verifies: 'B', verdicts: [{ index: 0, ...keep(B) }] });
  assert.deepEqual(apply({ now: NOW }).superseded, [factId(A)]);
  w('runs/C.json', { run_id: 'C', agent: 'om-knowledge-scout', facts: [A] });
  w('runs/C-V.json', { run_id: 'C-V', agent: 'om-fact-verifier', verifies: 'C', verdicts: [{ index: 0, ...keep(A) }] });
  const r = apply({ now: NOW });
  const a = loadBase().facts.find((f) => f.id === factId(A));
  assert.equal(a.status, 'superseded');
  assert.equal(r.updated.length, 0);
  assert.ok(r.rejected.some((x) => x.run === 'C' && x.reason === `previously superseded by ${factId(B)}`));
  brief({ now: NOW });
  const skill = fs.readFileSync(path.join(process.env.WHALYOM_KNOWLEDGE_SKILLS, 'om-knowledge-search', 'SKILL.md'), 'utf8');
  assert.match(skill, /New platform rule/);
  assert.doesNotMatch(skill, /Old platform rule/);

  // An explicit reinstate that the verifier confirms brings it back, with superseded_by cleared.
  const later = '2026-12-01T00:00:00.000Z';
  w('runs/D.json', { run_id: 'D', agent: 'om-knowledge-scout', facts: [{ ...A, reinstate: true, review_days: 30 }] });
  w('runs/D-V.json', { run_id: 'D-V', agent: 'om-fact-verifier', verifies: 'D', verdicts: [{ index: 0, ...keep(A, { reinstate: true }) }] });
  assert.deepEqual(apply({ now: later }).updated, [factId(A)]);
  const back = loadBase().facts.find((f) => f.id === factId(A));
  assert.equal(back.status, 'active');
  assert.equal(back.superseded_by, undefined);
  assert.equal(back.retired_at, undefined);
  assert.equal(back.review_days, 30, 'review_days follows the new review_by');
});

test('search uses the brief usable window and flags facts due for re-check', () => {
  fresh('search');
  const act = fact({ statement: 'Active rule: canonical tags consolidate duplicate URLs for Search.' });
  const old = fact({ statement: 'Expired rule: canonical tags were advisory only in older guidance.', source_url: 'https://developers.google.com/search/old', published: '2022-01-01' });
  const due = fact({ statement: 'Due rule: canonical hints are weighed with other signals by Search.', source_url: 'https://developers.google.com/search/due' });
  w('base.json', { version: 1, updated_at: NOW, facts: [seeded(old, { status: 'stale', review_by: '2023-01-01T00:00:00.000Z' }), seeded(act)] });
  assert.deepEqual(search('canonical', { now: NOW }).map((x) => x.id), [factId(act)], 'a fact past its review window is left out');
  w('base.json', { version: 1, updated_at: NOW, facts: loadBase().facts.concat(seeded(due, { status: 'stale', review_by: '2026-10-25T00:00:00.000Z' })) });
  const res = search('canonical', { now: NOW });
  assert.deepEqual(res.map((x) => x.id), [factId(act), factId(due)], 'stale ranks below active');
  const d = res.find((x) => x.id === factId(due));
  assert.deepEqual([d.status, d.due_for_recheck, d.review_by], ['stale', true, '2026-10-25']);
  assert.equal(res[0].status, 'active');
  assert.equal(res[0].due_for_recheck, undefined);
});

test('knowledge.mjs hashes prints the statement_hash a verifier copies into its keep verdict', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  fresh('hashes');
  const A = fact({ statement: 'Statement whose hash the verifier copies from the hashes command output.' });
  w('runs/h.json', { run_id: 'H1', agent: 'om-knowledge-scout', facts: [A], retire: [{ id: 'K-0000000000', reason: 'gone' }] });
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'knowledge.mjs');
  const env = { ...process.env }; delete env.HTTPS_PROXY; delete env.HTTP_PROXY; delete env.https_proxy;
  const out = spawnSync(process.execPath, [cli, 'hashes', K('runs', 'h.json')], { encoding: 'utf8', env });
  assert.equal(out.status, 0, out.stderr);
  const h = JSON.parse(out.stdout);
  assert.deepEqual(h.retire, ['K-0000000000']);
  assert.equal(h.facts[0].index, 0);
  w('runs/hv.json', { run_id: 'H1-V', agent: 'om-fact-verifier', verifies: 'H1', verdicts: [{ index: 0, verdict: 'keep', statement_hash: h.facts[0].statement_hash }] });
  w('runs/h.json', { run_id: 'H1', agent: 'om-knowledge-scout', facts: [A] });
  assert.deepEqual(apply({ now: NOW }).added, [factId(A)]);
});
