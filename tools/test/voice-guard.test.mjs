// Brand voice and claim guard: voice.json rules (banned, required, tone), the claims check (numbers,
// superlatives, testimonial-like quotes against claims.md), per-file verdicts, the reviewer run file
// that apply-results merges, and the guard paths (never downgrade, redaction, malformed input).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeVoice, parseClaims, draftText, extractNumbers, claimIssues, voiceIssues, checkDraft,
  reviewsFor, guardProduct, redact, syllables, readingStats, REVIEWER,
} from '../voice-guard.mjs';

const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'voice-guard.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-voice-guard-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const CLAIMS_MD = `# Claims

| id | claim | status | source |
|---|---|---|---|
| C1 | Quoteflow is a web app for freelancers and small agencies. | verified | brief.md |
| C7 | Free plan: 3 proposals per month. | verified | brief.md |
| C8 | Pro plan: $19/month. | verified | brief.md |
| C10 | 14-day Pro trial. | verified | brief.md |
| C12 | Creates a proposal 40% faster than doing it by hand. | needs-proof | none |
| C20 | The easiest proposal tool for designers. | verified | owner survey |
| C21 | "Quoteflow saved my Friday afternoons." Jane, designer | verified | signed release |
`;
const claims = parseClaims(CLAIMS_MD);
const { voice } = normalizeVoice({
  banned: ['revolutionary', { phrase: 'game changer', severity: 'block', reason: 'hype', instead: 'useful' }],
  required: ['Quoteflow', { term: 'unsubscribe', files: 'outbox/email/' }],
  tone: { max_exclamations: 1, reading_grade_max: 8, words_per_sentence_max: 20, sentence_hard_max: 30 },
});

test('claims table: columns by header, verified flag, template row', () => {
  assert.equal(claims.length, 7);
  assert.deepEqual(claims[0], { id: 'C1', text: 'Quoteflow is a web app for freelancers and small agencies.', status: 'verified', verified: true });
  assert.equal(claims.find((c) => c.id === 'C12').verified, false);
  const tpl = parseClaims('| id | claim | status | source |\n|---|---|---|---|\n| C1 | | needs-proof | |\n');
  assert.deepEqual(tpl, []);
  assert.deepEqual(parseClaims(null), []);
});

test('voice.json: defaults, malformed entries dropped with warnings', () => {
  const d = normalizeVoice(undefined);
  assert.equal(d.voice.tone.max_exclamations, 1);
  assert.deepEqual(d.warnings, []);
  const bad = normalizeVoice({ banned: 'nope', required: [{}, 'X'], tone: { max_exclamations: 'lots', reading_grade_max: null } });
  assert.deepEqual(bad.voice.banned, []);
  assert.deepEqual(bad.voice.required, [{ term: 'X', files: null }]);
  assert.equal(bad.voice.tone.max_exclamations, 1);
  assert.equal(bad.voice.tone.reading_grade_max, null, 'null switches a rule off');
  assert.ok(bad.warnings.some((w) => w.includes('banned')));
  assert.ok(normalizeVoice([1, 2]).warnings[0].includes('not an object'));
});

test('draft text: front matter copy keys kept, code, urls, contact data and markup removed', () => {
  const t = draftText('---\ntitle: Quoteflow plans\nutm_source: 99\n---\n# Heading\n- item **bold** [link](https://x.y/99)\n```\nconst a = 77;\n```\nMail ann@example.com or +1 (555) 123-4567.\n', '.md');
  assert.match(t, /^Quoteflow plans\nHeading\nitem bold link\nMail\s+or\s+\.$/);
  const h = draftText('<html><body><h1>Hi &amp; bye</h1><script>var x=50</script><p>Pro is $19</p></body></html>', '.html');
  assert.deepEqual(h.split('\n'), ['Hi & bye', 'Pro is $19']);
  assert.equal(draftText('{"subject":"Try 14 days","url":"https://a.b/5","body":["one"]}', '.json'), 'Try 14 days\none');
});

test('numbers: claim ids, dates and list markers are not claims; units are kept apart', () => {
  const keys = extractNumbers('See C12 and G05 on 2026-11-04 at 10:30. Pro is $19, 40% off, 3x faster, 1,200 users').map((n) => n.key);
  assert.deepEqual(keys, ['19', '40%', '3x', '1200']);
});

test('claims check: verified numbers pass, invented numbers and needs-proof numbers block', () => {
  assert.deepEqual(claimIssues('Pro is $19 a month with a 14-day trial and 3 proposals free.', claims), []);
  const iss = claimIssues('Write proposals 40% faster. Join 2,000 agencies. 19% off.', claims);
  assert.deepEqual(iss.map((i) => [i.kind, i.severity]), [['unsupported_number', 'block'], ['unsupported_number', 'block'], ['unsupported_number', 'block']]);
  assert.match(iss[0].message, /percentage "40%".*claim C12 needs proof/);
  assert.equal(iss[0].claim, 'C12');
  assert.match(iss[1].message, /"2,000"/);
  assert.match(iss[2].message, /"19%"/, 'a verified 19 does not back 19%');
});

test('claims check: superlatives need a verified claim; voice.json can allow one', () => {
  assert.deepEqual(claimIssues('The easiest proposal tool.', claims), []);
  const iss = claimIssues('The #1 and fastest proposal app. Best of all, it is free.', claims);
  assert.deepEqual(iss.map((i) => i.message.match(/"([^"]+)"/)[1]).sort(), ['#1', 'Best', 'fastest']);
  assert.ok(iss.every((i) => i.kind === 'unsupported_superlative' && i.severity === 'fix'));
  const allowed = normalizeVoice({ claims: { allow_superlatives: ['best'] } }).voice.claims;
  assert.equal(claimIssues('Best of all.', claims, allowed).length, 0);
  assert.equal(claimIssues('This is unbelievably fast and leading-edge.', claims).length, 0, 'whole words only');
});

test('claims check: testimonial-like quotes block unless a verified claim holds them', () => {
  assert.deepEqual(claimIssues('“Quoteflow saved my Friday afternoons.”', claims), []);
  const q = claimIssues('"This tool doubled our close rate overnight," says Mark.', claims);
  assert.equal(q.length, 1);
  assert.equal(q[0].kind, 'unsupported_quote');
  assert.equal(q[0].severity, 'block');
  assert.deepEqual(claimIssues('Not used: "in minutes" (C12).', claims), [], 'short quoted words are not testimonials');
  const bq = claimIssues('> Love it\n— Sam Lee, Acme', claims);
  assert.equal(bq.length, 1, 'attributed blockquote counts even when short');
});

test('voice: banned (fix or block), required per folder, exclamations, shouting, sentence length, grade', () => {
  const a = voiceIssues('Quoteflow is revolutionary! A real game changer! WOW AMAZING STUFF HERE', voice, 'outbox/email/a.md');
  const kinds = a.issues.map((i) => `${i.kind}:${i.severity}`).sort();
  assert.deepEqual(kinds, ['banned:block', 'banned:fix', 'missing_required:fix', 'tone_exclamations:fix', 'tone_shouting:fix']);
  assert.match(a.issues.find((i) => i.severity === 'block').message, /use "useful" \(hype\)/);
  const b = voiceIssues('Quoteflow helps.', voice, 'outbox/landing/a.md');
  assert.deepEqual(b.issues, [], 'unsubscribe is required only under outbox/email/');
  const long = `Quoteflow ${'considerably sophisticated organisational infrastructure '.repeat(12)}.`;
  const c = voiceIssues(long, voice, 'outbox/x.md');
  assert.ok(c.issues.some((i) => i.kind === 'tone_long_sentence'));
  assert.ok(c.issues.some((i) => i.kind === 'tone_reading_grade'));
  assert.ok(c.stats.reading_grade > 8);
});

test('readability helpers are stable', () => {
  assert.equal(syllables('cat'), 1);
  assert.equal(syllables('proposal'), 3);
  assert.equal(syllables('freelancers'), 3);
  const s = readingStats('Short one. Another short one here.');
  assert.equal(s.sentences, 2);
  assert.equal(s.words, 6);
});

test('checkDraft: strictest severity wins, reasons sorted, empty draft asks for a fix', () => {
  const r = checkDraft({ file: 'outbox/a.md', raw: 'Quoteflow is the best. Save 50% today!', voice, claims });
  assert.equal(r.verdict, 'block');
  assert.deepEqual(r.reasons.map((x) => x.severity), ['block', 'fix']);
  assert.equal(checkDraft({ file: 'outbox/b.md', raw: 'Quoteflow is a web app for freelancers.', voice, claims }).verdict, 'pass');
  assert.equal(checkDraft({ file: 'outbox/c.md', raw: '   \n# \n', voice, claims }).verdict, 'fix');
  assert.deepEqual(checkDraft({ file: 'x.md', raw: 'Quoteflow is the best.', voice, claims }), checkDraft({ file: 'x.md', raw: 'Quoteflow is the best.', voice, claims }), 'deterministic');
});

test('redaction: excerpts never carry raw emails or phone numbers', () => {
  assert.match(redact('Mail ann@example.com or call +44 20 7946 0958'), /^Mail \[email:[0-9a-f]{10}\] or call \[phone:[0-9a-f]{10}\]$/);
  const r = checkDraft({ file: 'o.md', raw: '> Great product, ann@example.com\n— Ann Smith', voice: normalizeVoice(null).voice, claims });
  assert.ok(!JSON.stringify(r).includes('ann@example.com'));
});

test('reviewsFor: pending approvals only, never downgrades or repeats another verdict', () => {
  const results = [
    { file: 'outbox/a.md', verdict: 'block', reasons: [{ message: 'number "40%" is not in a verified claim' }] },
    { file: 'outbox/b.md', verdict: 'pass', reasons: [] },
    { file: 'outbox/c.md', verdict: 'fix', reasons: [{ message: 'banned word "revolutionary" used 1x' }] },
    { file: 'outbox/d.md', verdict: 'fix', reasons: [] },
  ];
  const approvals = [
    { id: 'A2', file: 'outbox/b.md', status: 'pending', compliance: 'fix' },
    { id: 'A1', file: 'outbox/a.md', status: 'pending', compliance: 'pass' },
    { id: 'A3', file: './outbox/c.md', status: 'pending' },
    { id: 'A4', file: 'outbox/d.md', status: 'pending', compliance: 'fix' },
    { id: 'A5', file: 'outbox/a.md', status: 'executed' },
    null,
  ];
  const rv = reviewsFor(results, approvals);
  assert.deepEqual(rv.map((r) => [r.approval_id, r.compliance]), [['A1', 'block'], ['A3', 'fix']]);
  assert.match(rv[0].notes, /^voice-guard: block \(number "40%"/);
  assert.deepEqual(reviewsFor(results, 'not-an-array'), []);
});

test('reviewsFor: never writes "pass", even on an unchecked approval (pass is the auto-approve gate)', () => {
  const rv = reviewsFor([{ file: 'outbox/b.md', verdict: 'pass', reasons: [] }], [
    { id: 'A1', file: 'outbox/b.md', status: 'pending', compliance: 'unchecked' },
    { id: 'A2', file: 'outbox/b.md', status: 'pending' },
  ]);
  assert.deepEqual(rv, []);
  const dup = reviewsFor([{ file: 'outbox/a.md', verdict: 'fix', reasons: [] }], [
    { id: 'A1', file: 'outbox/a.md', status: 'pending', compliance: 'unchecked' },
    { id: 'A2', file: '.\\outbox\\a.md', status: 'pending' },
  ]);
  assert.deepEqual(dup.map((r) => r.approval_id), ['A1', 'A2'], 'every pending approval on the same draft is reviewed');
});

test('email drafts need an unsubscribe line; sign-offs are not superlatives', () => {
  const base = normalizeVoice(null).voice;
  const miss = voiceIssues('Hi Ann, the Pro trial is ready.', base, 'outbox/email/w.md');
  assert.ok(miss.issues.some((i) => i.kind === 'missing_unsubscribe' && i.severity === 'fix'));
  assert.ok(!voiceIssues('Hi Ann. Unsubscribe any time.', base, 'outbox/email/w.md').issues.some((i) => i.kind === 'missing_unsubscribe'));
  assert.ok(!voiceIssues('Hi Ann.', base, 'outbox/landing/w.md').issues.some((i) => i.kind === 'missing_unsubscribe'));
  assert.ok(!voiceIssues('Hi Ann.', normalizeVoice({ email_unsubscribe: false }).voice, 'outbox/email/w.md').issues.some((i) => i.kind === 'missing_unsubscribe'));
  assert.deepEqual(claimIssues('Thanks for reading.\nBest,\nSam', claims), []);
  assert.deepEqual(claimIssues('Thanks.\nBest regards', claims), []);
  assert.equal(claimIssues('The best tool.\nBest,\nSam', claims).length, 1);
});

test('guardProduct: --now in any zone is stored as UTC; an invalid date throws', () => {
  const dir = mkProduct('p3');
  const out = guardProduct('p3', { dir, now: '2026-11-04T23:30:00-05:00', review: true });
  assert.equal(out.report.generated_at, '2026-11-05T04:30:00.000Z');
  assert.equal(out.review_file, 'runs/REVIEW-voice-guard-2026-11-05.json');
  assert.throws(() => guardProduct('p3', { dir, now: 'not a date' }), /invalid --now/);
  fs.writeFileSync(path.join(dir, 'approvals.json'), '{ broken');
  fs.writeFileSync(path.join(dir, 'outbox', 'landing', 'empty.md'), '');
  const out2 = guardProduct('p3', { dir, now: '2026-11-04T00:00:00Z', review: true });
  assert.deepEqual(out2.reviews, [], 'malformed approvals.json: nothing to review');
  assert.equal(out2.report.files.find((f) => f.file === 'outbox/landing/empty.md').verdict, 'fix');
});

const mkProduct = (name, extra = {}) => {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, 'outbox', 'email'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'outbox', 'landing'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'claims.md'), CLAIMS_MD);
  fs.writeFileSync(path.join(dir, 'voice.json'), JSON.stringify(extra.voice ?? { banned: ['revolutionary'], required: [{ term: 'unsubscribe', files: 'outbox/email/' }] }));
  fs.writeFileSync(path.join(dir, 'outbox', 'landing', 'home.md'), '# Quoteflow\nQuoteflow is a web app for freelancers and small agencies. Start the 14-day Pro trial.\n');
  fs.writeFileSync(path.join(dir, 'outbox', 'email', 'welcome.md'), '---\nsubject: The #1 proposal app\n---\nJoin 5,000 agencies. Revolutionary!\n');
  fs.writeFileSync(path.join(dir, 'outbox', 'landing', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(dir, 'approvals.json'), JSON.stringify([
    { id: 'A1', type: 'publish', file: 'outbox/landing/home.md', status: 'pending' },
    { id: 'A2', type: 'email', file: 'outbox/email/welcome.md', status: 'pending', compliance: 'pass' },
  ]));
  return dir;
};

test('guardProduct: report per file, review run file in the shape apply-results merges', () => {
  const dir = mkProduct('p1');
  const now = '2026-11-04T09:00:00.000Z';
  const out = guardProduct('p1', { dir, now, review: true });
  const rep = JSON.parse(fs.readFileSync(path.join(dir, 'reports', 'voice-guard.json'), 'utf8'));
  assert.deepEqual(rep, out.report);
  assert.equal(rep.generated_at, now);
  assert.equal(rep.voice_source, 'voice.json');
  assert.deepEqual(rep.summary, { files: 2, pass: 1, fix: 0, block: 1 });
  assert.deepEqual(rep.files.map((f) => [f.file, f.verdict, f.approval_id]), [['outbox/email/welcome.md', 'block', 'A2'], ['outbox/landing/home.md', 'pass', 'A1']]);
  const kinds = rep.files[0].reasons.map((r) => r.kind);
  for (const k of ['unsupported_number', 'unsupported_superlative', 'banned', 'missing_required']) assert.ok(kinds.includes(k), k);
  assert.equal(out.review_file, 'runs/REVIEW-voice-guard-2026-11-04.json');
  const run = JSON.parse(fs.readFileSync(path.join(dir, out.review_file), 'utf8'));
  assert.equal(run.agent, REVIEWER);
  assert.equal(run.agent, 'om-micro-claim-check');
  assert.match(path.basename(out.review_file), /^REVIEW-.+\.json$/, 'apply-results only reads REVIEW-*.json as reviews');
  assert.deepEqual(run.reviews.map((r) => [r.approval_id, r.compliance]), [['A2', 'block']], 'a clean draft gets no "pass": policy.mjs would auto-approve it');
  for (const r of run.reviews) { assert.ok(['pass', 'fix', 'block'].includes(r.compliance)); assert.ok(r.notes.length <= 500); }
  assert.deepEqual(guardProduct('p1', { dir, now, write: false }).report, rep, 'same input, same output');
});

test('guardProduct: guard paths (bad voice.json, no claims, only selected files, no review when nothing to say)', () => {
  const dir = mkProduct('p2');
  fs.writeFileSync(path.join(dir, 'voice.json'), '{ not json');
  fs.rmSync(path.join(dir, 'claims.md'));
  fs.writeFileSync(path.join(dir, 'approvals.json'), JSON.stringify([{ id: 'A1', file: 'outbox/landing/home.md', status: 'pending', compliance: 'block' }]));
  const out = guardProduct('p2', { dir, now: '2026-11-04T00:00:00Z', files: ['outbox/landing/home.md', 'outbox/missing.md'], review: true });
  assert.equal(out.report.voice_source, 'default');
  assert.ok(out.report.warnings.some((w) => w.includes('not valid JSON')));
  assert.ok(out.report.warnings.some((w) => w.includes('no claims')));
  assert.ok(out.report.warnings.some((w) => w.includes('outbox/missing.md')));
  assert.deepEqual(out.report.files.map((f) => f.file), ['outbox/landing/home.md']);
  assert.equal(out.report.files[0].verdict, 'block', 'with no verified claims, 14 is unsupported');
  assert.deepEqual(out.reviews, [], 'already block: nothing stricter to say');
  assert.equal(out.review_file, null);
  assert.ok(!fs.existsSync(path.join(dir, 'runs')));
  assert.throws(() => guardProduct('../etc'), /invalid product slug/);
  assert.throws(() => guardProduct('x', { dir: path.join(tmp, 'nope') }), /not found/);
});

test('CLI: usage error without a slug, unknown product fails', () => {
  const r = spawnSync(process.execPath, [tool], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Usage/);
  const r2 = spawnSync(process.execPath, [tool, 'zz-no-such-product-voice-guard'], { encoding: 'utf8' });
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /not found/);
});

test('claims check calibration: structure labels, a free plan as $0, quoted editorial lines', () => {
  assert.deepEqual(extractNumbers('Section 1: Hero. Step 2 of the flow. Variant 3. 4 seats').map((n) => n.key), ['4']);
  assert.deepEqual(extractNumbers('Test E-O8-1 for teams of 2-10 people').map((n) => n.key), ['2', '10'], 'ids are skipped, ranges are kept');
  const withFree = parseClaims('| id | claim | status |\n|---|---|---|\n| C1 | Free plan for solo users. | verified |\n');
  assert.deepEqual(claimIssues('Free: $0 forever.', withFree), []);
  assert.equal(claimIssues('Free: $0 forever.', claims.filter((c) => !/free/i.test(c.text))).length, 1, 'no verified free plan, $0 is unbacked');
  assert.deepEqual(claimIssues('Safe line for now: "The Free plan covers three proposals."', claims), [], 'third-person quoted copy is not a testimonial');
  assert.equal(claimIssues('"The app changed everything for the team," said Priya.', claims).length, 1, 'quote followed by said');
});
