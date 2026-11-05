// AI-answer visibility: the prompt panel and recorded answers become share of answer, citation rate and
// position per engine with Wilson intervals, competitors' share, missing prompts and a weekly trend.
// Every file test runs in a temp directory (no repo writes) except the CLI test, which uses a zz- product
// and removes it afterwards. No network anywhere.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  wilson, canonicalEngine, hostOf, redact, detectMentions, normalizePanel, normalizeResult, collectResults,
  visibilityReport, visibilityTrend, renderMarkdown, runVisibility, runAll, initPanel, recordAnswers,
} from '../ai-visibility.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-aiv-'));
const cliSlug = `zz-aiv-${process.pid}`;
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(path.join(root, 'products', cliSlug), { recursive: true, force: true }); });

const NOW = '2026-11-04T12:00:00.000Z';
const product = { name: 'Quoteflow (sample)', domain: 'https://www.quoteflow.example', market: ['US', 'UK'] };
const rawPanel = {
  brand: { name: 'Quoteflow', aliases: ['Quote Flow'] },
  competitors: [{ name: 'Jobber', domains: ['getjobber.com'] }, { name: 'Housecall Pro', aliases: ['HCP'] }, 'ServiceTitan'],
  engines: ['ChatGPT', 'pplx'],
  prompts: [
    { id: 'best-quoting', text: 'What is the best quoting app for plumbers?', market: 'US', priority: 1 },
    { id: 'uk-quotes', text: 'Quote software for UK trades', market: 'UK', priority: 2 },
    { id: 'invoicing', text: 'How do I send invoices from my phone?', priority: 4 },
    'Never checked prompt',
  ],
};
const panel = normalizePanel(rawPanel, product);

const mkProduct = (base, slug, files = {}) => {
  const dir = path.join(base, 'products', slug);
  fs.mkdirSync(path.join(dir, 'research', 'ai-answers'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'product.json'), JSON.stringify(product));
  for (const [f, v] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), typeof v === 'string' ? v : JSON.stringify(v));
  return dir;
};

test('wilson interval: known values, edges and bad input', () => {
  assert.deepEqual(wilson(5, 10), { p: 0.5, lo: 0.237, hi: 0.763, n: 10 });
  const zero = wilson(0, 10); assert.equal(zero.lo, 0); assert.ok(zero.hi > 0.25 && zero.hi < 0.3);
  const all = wilson(10, 10); assert.equal(all.hi, 1); assert.ok(all.lo > 0.7);
  assert.deepEqual(wilson(3, 0), { p: null, lo: null, hi: null, n: 0 });
  assert.deepEqual(wilson(1, Number.NaN), { p: null, lo: null, hi: null, n: 0 });
  assert.equal(wilson(15, 10).p, 1); // clamped
});

test('engine names, hosts and redaction', () => {
  assert.equal(canonicalEngine('ChatGPT'), 'chatgpt');
  assert.equal(canonicalEngine('GPT-4o'), 'chatgpt');
  assert.equal(canonicalEngine('AI Overviews'), 'google-ai-overviews');
  assert.equal(canonicalEngine('Bing Chat'), 'copilot');
  assert.equal(canonicalEngine('Some New Engine'), 'some-new-engine');
  assert.equal(canonicalEngine(''), null);
  assert.equal(hostOf('https://www.Quoteflow.example/pricing?x=1'), 'quoteflow.example');
  assert.equal(hostOf('quoteflow.example'), 'quoteflow.example');
  assert.equal(hostOf(42), null);
  assert.equal(redact('mail ann@example.com or +44 20 7946 0958 on 2026-11-04'), 'mail [email] or [phone] on 2026-11-04');
});

test('panel: brand from product.json, competitors and prompts cleaned, problems listed', () => {
  assert.equal(panel.brand.name, 'Quoteflow');
  assert.deepEqual(panel.brand.domains, ['quoteflow.example']);
  assert.deepEqual(panel.competitors.map((c) => c.name), ['Jobber', 'Housecall Pro', 'ServiceTitan']);
  assert.deepEqual(panel.engines, ['chatgpt', 'perplexity']);
  assert.equal(panel.prompts.length, 4);
  assert.equal(panel.prompts[2].market, 'US'); // default market = first product market
  assert.match(panel.prompts[3].id, /^p-[0-9a-f]{12}$/);
  const bad = normalizePanel({ prompts: [{ text: '' }, { id: 'a', text: 'x' }, { id: 'A', text: 'y' }, null], competitors: ['Quoteflow', 7] }, {});
  assert.equal(bad.brand, null);
  assert.equal(bad.prompts.length, 1);
  assert.equal(bad.competitors.length, 1); // no brand to compare against, so the name is kept; 7 is dropped
  assert.ok(bad.problems.some((p) => /no brand/.test(p)) && bad.problems.some((p) => /duplicate id a/.test(p)) && bad.problems.some((p) => /no text/.test(p)));
  assert.deepEqual(normalizePanel('garbage', {}).prompts, []);
  assert.equal(normalizePanel(['Bare list prompt'], product).prompts.length, 1);
});

test('mention detection from raw answer text: order, aliases, word boundaries, domains', () => {
  const ents = [panel.brand, ...panel.competitors];
  const found = detectMentions('Top picks: Jobber, then quote flow, and HCP. See getjobber.com. Not ServiceTitanic.', ents);
  assert.deepEqual(found, [{ name: 'Jobber', position: 1 }, { name: 'Quoteflow', position: 2 }, { name: 'Housecall Pro', position: 3 }]);
  assert.deepEqual(detectMentions('', ents), []);
  assert.deepEqual(detectMentions('See notgetjobber.com', ents), []);
  assert.deepEqual(detectMentions('See app.getjobber.com.', ents), [{ name: 'Jobber', position: 1 }]);
  const r = normalizeResult({ engine: 'perplexity', prompt: 'what is the best quoting app for plumbers', answer: 'Try Jobber or Quoteflow (quoteflow.example).', cited_urls: ['https://quoteflow.example/plumbers', 'https://getjobber.com'] }, panel, '2026-11-03');
  assert.equal(r.row.prompt_id, 'best-quoting');
  assert.equal(r.row.mentioned, true);
  assert.equal(r.row.position, 2);
  assert.equal(r.row.cited, true);
  assert.deepEqual(r.row.competitors, ['Jobber']);
  assert.deepEqual(r.row.competitors_cited, ['Jobber']);
});

test('result guards: bad rows are rejected with a reason, explicit fields win over detection', () => {
  assert.equal(normalizeResult(null, panel).reason, 'not an object');
  assert.equal(normalizeResult({ prompt_id: 'x', mentioned: true }, panel, '2026-11-01').reason, 'no engine');
  assert.equal(normalizeResult({ engine: 'chatgpt', prompt_id: 'best-quoting', mentioned: true }, panel, null).reason, 'no valid date');
  assert.equal(normalizeResult({ engine: 'chatgpt', mentioned: true }, panel, '2026-11-01').reason, 'no prompt_id or prompt text');
  assert.match(normalizeResult({ engine: 'chatgpt', prompt_id: 'best-quoting' }, panel, '2026-11-01').reason, /mentioned missing/);
  const r = normalizeResult({ engine: 'chatgpt', prompt_id: 'best-quoting', mentioned: false, position: 2, accuracy: 'wrong', answer: 'Quoteflow is great' }, panel, '2026-11-01').row;
  assert.equal(r.mentioned, false); assert.equal(r.position, null); assert.equal(r.accuracy, 'unknown');
  const adhoc = normalizeResult({ engine: 'chatgpt', prompt: 'Something off panel', mentioned: true, position: -3, competitors_mentioned: ['jobber', 'quoteflow', 'NewCo'], accuracy: 'Outdated', accuracy_notes: 'says call 555-123-4567 or ann@x.io' }, panel, '2026-11-01').row;
  assert.equal(adhoc.on_panel, false); assert.match(adhoc.prompt_id, /^adhoc-/);
  assert.equal(adhoc.position, null);
  assert.deepEqual(adhoc.competitors, ['Jobber', 'NewCo']); // canonical name, brand removed
  assert.equal(adhoc.accuracy, 'partial');
  assert.equal(adhoc.accuracy_notes, 'says call [phone] or [email]');
});

// A fixed data set used by the report tests: two engines, current and previous window.
const files = [
  { name: '2026-10-01.json', data: { results: [
    { engine: 'chatgpt', prompt_id: 'best-quoting', mentioned: false, competitors_mentioned: ['Jobber'] },
    { engine: 'chatgpt', prompt_id: 'uk-quotes', mentioned: false },
  ] } },
  { name: '2026-11-02.json', data: { engine: 'chatgpt', results: [
    { prompt_id: 'best-quoting', mentioned: true, position: 1, cited_url: 'https://quoteflow.example/a', accuracy: 'correct' },
    { prompt_id: 'uk-quotes', mentioned: false, competitors_mentioned: ['Jobber', 'HCP'] },
    { prompt_id: 'invoicing', mentioned: true, position: 3, accuracy: 'wrong', accuracy_notes: 'Says we have no mobile app' },
  ] } },
  { name: '2026-11-03.json', data: [
    { engine: 'perplexity', prompt_id: 'best-quoting', mentioned: false, competitors_mentioned: ['ServiceTitan'] },
    { engine: 'perplexity', prompt_id: 'uk-quotes', mentioned: false, competitors_mentioned: ['Jobber'] },
    { engine: 'perplexity', prompt_id: 'invoicing', mentioned: true, position: 2, cited_urls: ['https://blog.quoteflow.example/x'] },
    { engine: 'perplexity', prompt_id: 'invoicing', mentioned: true, position: 2 }, // same key: replaces the row above
    { engine: 'perplexity', prompt_id: 'invoicing', mentioned: true, position: 1, sample: 2 },
    { engine: '', prompt_id: 'invoicing', mentioned: true },
    'junk',
  ] },
  { name: '2026-11-09.json', data: { results: [{ engine: 'chatgpt', prompt_id: 'invoicing', mentioned: true }] } }, // after now
  { name: '2026-11-03-broken.json', data: null },
];

test('collect: dedupe on date, engine, prompt and sample; rejected rows listed; sorted output', () => {
  const { rows, rejected } = collectResults(files, panel);
  assert.equal(rows.length, 10);
  const inv = rows.filter((r) => r.engine === 'perplexity' && r.prompt_id === 'invoicing');
  assert.equal(inv.length, 2);
  assert.equal(inv.find((r) => r.sample === 0).cited, false); // later row replaced the cited one
  assert.deepEqual(rejected.map((r) => r.reason).sort(), ['no engine', 'no results array', 'not an object']);
  assert.deepEqual(rows.map((r) => r.date), [...rows.map((r) => r.date)].sort());
});

test('report: share, citation, position, competitors, missing prompts, change and actions', () => {
  const { rows, rejected } = collectResults(files, panel);
  const rep = visibilityReport({ panel, rows, rejected, now: NOW, days: 28, slug: 'demo' });
  assert.equal(rep.status, 'ok');
  assert.deepEqual(rep.window, { days: 28, from: '2026-10-08', to: '2026-11-04' });
  assert.equal(rep.coverage.answers, 7); // 3 chatgpt + 4 perplexity; Oct 1 is previous window, Nov 9 is future
  assert.equal(rep.overall.mentions, 4);
  assert.deepEqual(rep.overall.share_of_answer, wilson(4, 7));
  assert.equal(rep.overall.citation_rate.p, wilson(1, 7).p);
  assert.equal(rep.overall.avg_position, 1.75); // positions 1, 3, 2, 1
  assert.equal(rep.overall.median_position, 1.5);
  assert.deepEqual({ c: rep.overall.accuracy.correct, w: rep.overall.accuracy.wrong, u: rep.overall.accuracy.unknown }, { c: 1, w: 1, u: 2 });
  assert.equal(rep.overall.share_change.previous, 0);
  assert.equal(rep.overall.share_change.change_pp, 57.1);
  assert.equal(rep.overall.share_change.significant, false); // n=2 before: intervals overlap
  assert.equal(rep.by_engine.chatgpt.answers, 3);
  assert.equal(rep.by_engine.perplexity.share_of_answer.p, 0.5);
  assert.deepEqual(Object.keys(rep.by_market), ['UK', 'US']);
  assert.deepEqual(rep.competitors.map((c) => [c.name, c.mentions]), [['Jobber', 2], ['Housecall Pro', 1], ['ServiceTitan', 1]]);
  assert.equal(rep.share_of_voice, 0.5); // 4 brand mentions against 4 competitor mentions
  assert.deepEqual(rep.missing_prompts.map((p) => p.id), ['uk-quotes']);
  assert.deepEqual(rep.missing_prompts[0].engines_missing, ['chatgpt', 'perplexity']);
  assert.deepEqual(rep.partly_missing_prompts.map((p) => [p.id, p.engines_missing]), [['best-quoting', ['perplexity']]]);
  assert.equal(rep.unchecked_prompts.length, 1);
  assert.deepEqual(rep.inaccurate.map((x) => [x.engine, x.prompt_id, x.accuracy]), [['chatgpt', 'invoicing', 'wrong']]);
  const types = rep.next_actions.map((a) => `${a.type}:${a.agent}:${a.engine ?? ''}`);
  assert.ok(types.includes('close_gap:om-aeo-chatgpt:chatgpt') && types.includes('close_gap:om-aeo-perplexity:perplexity'));
  assert.ok(types.includes('fix_accuracy:om-entity-builder:chatgpt'));
  assert.ok(types.includes('check_prompts:om-llm-visibility-analyst:'));
  assert.ok(rep.next_actions.every((a) => a.approval_required === false)); // internal briefs, nothing outbound
  assert.equal(rep.next_actions[0].priority, 1);
  // Deterministic: same input, same output.
  assert.deepEqual(visibilityReport({ panel, rows: [...rows].reverse(), rejected, now: NOW, days: 28, slug: 'demo' }).next_actions, rep.next_actions);
});

test('report guards: no panel, no brand, no data, bad days', () => {
  assert.equal(visibilityReport({ panel: normalizePanel(null, product), rows: [], now: NOW }).status, 'no_panel');
  assert.equal(visibilityReport({ panel: normalizePanel({ prompts: ['q'] }, {}), rows: [], now: NOW }).status, 'no_brand');
  const empty = visibilityReport({ panel, rows: [], now: NOW, days: 'abc' });
  assert.equal(empty.status, 'no_data');
  assert.equal(empty.window.days, 28);
  assert.equal(empty.overall.share_of_answer.p, null);
  assert.equal(empty.share_of_voice, null);
  assert.equal(visibilityReport({ panel, rows: [], now: NOW, days: 9999 }).window.days, 365);
  assert.match(renderMarkdown(empty), /Status: \*\*no_data\*\*/);
});

test('trend: weekly points per engine, Monday weeks, future rows ignored', () => {
  const { rows } = collectResults(files, panel);
  const tr = visibilityTrend(rows, { now: NOW });
  assert.deepEqual(tr.weeks.map((w) => w.week), ['2026-09-28', '2026-11-02']);
  const w = tr.weeks[1];
  assert.equal(w.answers, 7);
  assert.equal(w.share, wilson(4, 7).p);
  assert.deepEqual(Object.keys(w.by_engine), ['chatgpt', 'perplexity']);
  assert.deepEqual(visibilityTrend([], { now: NOW }).weeks, []);
});

test('markdown: sections and escaped cells', () => {
  const { rows, rejected } = collectResults(files, panel);
  const md = renderMarkdown(visibilityReport({ panel, rows, rejected, now: NOW, slug: 'demo' }));
  for (const h of ['# AI-answer visibility: Quoteflow', '## By engine', '## Competitors', '## Prompts where the brand is missing', '## Inaccurate answers', '## Next actions', '## Data problems']) assert.ok(md.includes(h), h);
  assert.ok(md.includes('| chatgpt | 3 |'));
});

test('files: init, record, run and run-all in a temp root; no answer text or prompts in state', () => {
  const base = path.join(tmp, 'a');
  const dir = mkProduct(base, 'demo');
  mkProduct(base, '_template');
  assert.throws(() => initPanel('../evil', { base }), /invalid product slug/);
  assert.throws(() => initPanel('missing', { base }), /no product.json/);
  assert.deepEqual(initPanel('demo', { base }), { created: true, file: 'products/demo/research/ai-prompts.json' });
  const init = JSON.parse(fs.readFileSync(path.join(dir, 'research', 'ai-prompts.json'), 'utf8'));
  assert.equal(init.brand.name, 'Quoteflow'); assert.deepEqual(init.prompts, []);
  assert.equal(initPanel('demo', { base }).created, false); // never overwrites
  fs.writeFileSync(path.join(dir, 'research', 'ai-prompts.json'), JSON.stringify(rawPanel));

  assert.throws(() => recordAnswers('demo', 'nope', { base, now: NOW }), /results must be/);
  const rec = recordAnswers('demo', [
    { engine: 'GPT-4o', prompt_id: 'best-quoting', answer: 'Quoteflow leads. Contact ann@example.com', cited_url: 'quoteflow.example' },
    { engine: 'chatgpt', prompt_id: 'uk-quotes' },
    { engine: 'chatgpt', prompt_id: 'invoicing', mentioned: false, date: '2026-10-01' },
  ], { base, now: NOW, date: '2026-11-03' });
  assert.equal(rec.written, 1);
  assert.deepEqual(rec.rejected.map((r) => r.index), [1, 2]);
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'research', 'ai-answers', '2026-11-03.json'), 'utf8'));
  assert.equal(stored.results[0].engine, 'chatgpt');
  assert.ok(!stored.results[0].answer.includes('@'));
  recordAnswers('demo', { results: [{ engine: 'perplexity', prompt_id: 'best-quoting', mentioned: false, competitors_mentioned: ['Jobber'] }] }, { base, now: NOW, date: '2026-11-03' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'research', 'ai-answers', '2026-11-03.json'), 'utf8')).results.length, 2); // merged

  const sum = runVisibility('demo', { base, now: NOW });
  assert.deepEqual({ s: sum.status, a: sum.answers, share: sum.share_of_answer, c: sum.citation_rate }, { s: 'ok', a: 2, share: 0.5, c: 0.5 });
  for (const f of ['ai-visibility.json', 'ai-visibility.md', 'ai-visibility-trend.json']) assert.ok(fs.existsSync(path.join(dir, 'reports', f)), f);
  const first = fs.readFileSync(path.join(dir, 'reports', 'ai-visibility.json'), 'utf8');
  runVisibility('demo', { base, now: NOW });
  assert.equal(fs.readFileSync(path.join(dir, 'reports', 'ai-visibility.json'), 'utf8'), first); // deterministic

  const all = runAll({ base, now: NOW });
  assert.deepEqual(all, { products: 1, with_data: 1, errors: 0 }); // _template skipped
  const state = fs.readFileSync(path.join(base, 'state', 'ai-visibility.json'), 'utf8');
  assert.ok(!state.includes('best quoting app') && !state.includes('Quoteflow leads') && !state.includes('@'));
  assert.equal(JSON.parse(state).products[0].trend.length, 1);
});

test('files: unreadable panel and answer files do not crash the run', () => {
  const base = path.join(tmp, 'b');
  const dir = mkProduct(base, 'broken', { 'research/ai-prompts.json': '{not json' });
  fs.writeFileSync(path.join(dir, 'research', 'ai-answers', '2026-11-01.json'), '{also not json');
  fs.writeFileSync(path.join(dir, 'research', 'ai-answers', 'notes.txt'), 'ignored');
  const sum = runVisibility('broken', { base, now: NOW });
  assert.equal(sum.status, 'no_panel');
  assert.equal(sum.rejected, 1);
  assert.equal(runAll({ base: path.join(tmp, 'empty'), now: NOW }).products, 0);
});

test('guards: calendar-invalid dates, PII-like engine names, re-record replaces, corrupt file is never overwritten', () => {
  assert.equal(normalizeResult({ engine: 'chatgpt', prompt_id: 'best-quoting', mentioned: true, date: '2026-02-31' }, panel, null).reason, 'no valid date');
  assert.equal(canonicalEngine('ann@example.com'), null);
  assert.equal(canonicalEngine('+1 (555) 123-4567'), null);
  assert.equal(normalizeResult({ engine: 'bob@x.io', prompt_id: 'best-quoting', mentioned: true }, panel, '2026-11-01').reason, 'no engine');
  const base = path.join(tmp, 'c');
  const dir = mkProduct(base, 'demo', { 'research/ai-prompts.json': rawPanel });
  const opts = { base, now: NOW, date: '2026-11-03' };
  recordAnswers('demo', [{ engine: 'chatgpt', prompt_id: 'best-quoting', mentioned: false }], opts);
  recordAnswers('demo', [{ engine: 'chatgpt', prompt_id: 'best-quoting', mentioned: true }], opts);
  const file = path.join(dir, 'research', 'ai-answers', '2026-11-03.json');
  const stored = JSON.parse(fs.readFileSync(file, 'utf8')).results;
  assert.equal(stored.length, 1); assert.equal(stored[0].mentioned, true);
  fs.writeFileSync(file, '{broken');
  assert.throws(() => recordAnswers('demo', [{ engine: 'chatgpt', prompt_id: 'uk-quotes', mentioned: true }], opts), /not valid JSON/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
  runAll({ base, now: NOW, days: 'abc' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(base, 'state', 'ai-visibility.json'), 'utf8')).window_days, 28);
});

test('CLI: run one product, bad usage exits non-zero', () => {
  const dir = mkProduct(root, cliSlug, {});
  fs.writeFileSync(path.join(dir, 'research', 'ai-prompts.json'), JSON.stringify(rawPanel));
  fs.writeFileSync(path.join(dir, 'research', 'ai-answers', '2026-11-02.json'), JSON.stringify(files[1].data));
  const r = spawnSync(process.execPath, [path.join(root, 'tools', 'ai-visibility.mjs'), cliSlug, '--now', NOW, '--days', '14'], { encoding: 'utf8', cwd: root });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(out.product, cliSlug); assert.equal(out.answers, 3); assert.equal(out.missing_prompts, 1);
  const bad = spawnSync(process.execPath, [path.join(root, 'tools', 'ai-visibility.mjs'), '--now', 'nope', cliSlug], { encoding: 'utf8', cwd: root });
  assert.notEqual(bad.status, 0);
  const none = spawnSync(process.execPath, [path.join(root, 'tools', 'ai-visibility.mjs')], { encoding: 'utf8', cwd: root });
  assert.notEqual(none.status, 0); assert.match(none.stderr, /usage/);
});
