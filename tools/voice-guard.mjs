// Brand voice and claim guard: checks every outbox draft against the product's voice rules and its
// claims ledger before anything goes out, and turns the result into compliance verdicts the reviewer
// merge in tools/apply-results.mjs understands (agent "om-micro-claim-check").
//   products/<slug>/voice.json              voice rules (optional; defaults below when missing):
//     { "banned":   ["revolutionary", { "phrase": "game-changer", "severity": "block", "reason": "…" }],
//       "required": ["Quoteflow", { "term": "unsubscribe", "files": "outbox/email/" }],
//       "tone":     { "max_exclamations": 1, "reading_grade_max": 9, "reading_grade_tolerance": 1,
//                     "words_per_sentence_max": 22, "sentence_hard_max": 40, "max_all_caps_words": 2,
//                     "min_words_for_grade": 30 },
//       "claims":   { "allow_numbers": ["24/7"], "superlatives": ["unrivalled"], "allow_superlatives": [],
//                     "min_quote_words": 4 } }
//   products/<slug>/claims.md               the claims table (| id | claim | status | source |). Only rows
//                                           with status "verified" support a draft; a match that exists
//                                           only in a needs-proof row is named in the reason.
//   products/<slug>/outbox/**               drafts (.md .markdown .txt .html .htm .json), read only
//   products/<slug>/approvals.json          read only: maps each draft to its pending approval
//   products/<slug>/reports/voice-guard.json  output: per-file verdict pass | fix | block with reasons
//   products/<slug>/runs/REVIEW-voice-guard-<date>.json  output with --review: { agent:
//                                           "om-micro-claim-check", reviews: [{ approval_id, compliance,
//                                           notes }] } for apply-results. Only fix and block verdicts that are
//                                           stricter than the approval's current compliance are written: the
//                                           guard never downgrades another reviewer's verdict and never
//                                           writes "pass" (policy.mjs auto-approves on pass, and this guard
//                                           does not check consent, platform rules or the law).
//   Email drafts (outbox/email/) must contain an unsubscribe line (CAN-SPAM / GDPR) unless voice.json sets
//   "email_unsubscribe": false; a missing one asks for a fix.
// Claims check: any number, percentage or price, any superlative ("best", "#1", "fastest" …) and any
// testimonial-like quote (a quoted span of 4+ words in the first person or followed by "says", or a
// blockquote with an attribution line) that is
// not backed by a verified claim is flagged. Unbacked numbers and quotes block (rule 2: no invented
// numbers or testimonials); unbacked superlatives, banned words, missing required terms and tone rules
// ask for a fix; a banned entry with severity "block" blocks.
// Personal data: excerpts in the report have emails and phone numbers replaced by a short hash, and
// contact details are never treated as claims. Nothing here sends, posts or publishes anything.
// Deterministic: files are sorted, timestamps come from --now (or the clock), no network.
// Usage: node tools/voice-guard.mjs <slug> [--review] [--file outbox/x.md] [--now ISO] [--strict]
//        node tools/voice-guard.mjs --all [--review] [--strict]   every product except _template
//   --strict exits 1 when any draft is blocked (for CI and the daemon gate).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, root } from './lib/env.mjs';

export const REVIEWER = 'om-micro-claim-check';
export const VERDICTS = ['pass', 'fix', 'block'];
const rank = (v) => Math.max(0, VERDICTS.indexOf(v));
const TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.html', '.htm', '.json']);
const MAX_BYTES = 1024 * 1024;
const MAX_REASONS = 50;

export const DEFAULT_SUPERLATIVES = [
  'best', 'best-in-class', '#1', 'number one', 'no. 1', 'no.1', 'fastest', 'cheapest', 'easiest', 'simplest',
  'quickest', 'biggest', 'largest', 'smartest', 'most advanced', 'most popular', 'most trusted',
  'most powerful', 'most affordable', 'leading', 'industry-leading', 'market-leading', 'top-rated',
  'top rated', 'world-class', "world's", 'unbeatable', 'unmatched', 'unrivaled', 'unrivalled', 'guaranteed',
];

export const DEFAULT_VOICE = Object.freeze({
  banned: [],
  required: [],
  tone: { max_exclamations: 1, reading_grade_max: 9, reading_grade_tolerance: 1, words_per_sentence_max: 22, sentence_hard_max: 40, max_all_caps_words: 2, min_words_for_grade: 30 },
  claims: { allow_numbers: [], superlatives: [], allow_superlatives: [], min_quote_words: 4 },
});

const str = (s) => (typeof s === 'string' ? s : s == null ? '' : String(s));
const lc = (s) => str(s).toLowerCase();
const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' && typeof v !== 'boolean' ? Number(v) : d);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hash = (s) => crypto.createHash('sha256').update(str(s).trim().toLowerCase()).digest('hex').slice(0, 10);
const posix = (p) => p.split(path.sep).join('/');

// --- personal data -------------------------------------------------------------------------------
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?<![\w/])\+?\d[\d\s().-]{7,}\d(?![\w/])/g;
const isPhone = (m) => { const d = m.replace(/\D/g, ''); return d.length >= 9 && d.length <= 15 && /[\s().-]|^\+/.test(m); };
export const redact = (s) => str(s)
  .replace(EMAIL_RE, (m) => `[email:${hash(m)}]`)
  .replace(PHONE_RE, (m) => (isPhone(m) ? `[phone:${hash(m.replace(/\D/g, ''))}]` : m));

// --- voice.json ----------------------------------------------------------------------------------
// Returns { voice, warnings }: malformed entries are dropped with a warning instead of throwing.
export function normalizeVoice(raw) {
  const warnings = [];
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  if (raw != null && src !== raw) warnings.push('voice.json is not an object; defaults used');
  const list = (v, name) => { if (v == null) return []; if (Array.isArray(v)) return v; warnings.push(`voice.${name} must be an array; ignored`); return []; };
  const banned = [];
  for (const b of list(src.banned, 'banned')) {
    const phrase = typeof b === 'string' ? b : b?.phrase ?? b?.word;
    if (!str(phrase).trim()) { warnings.push('voice.banned entry without a phrase ignored'); continue; }
    const severity = b?.severity === 'block' ? 'block' : 'fix';
    banned.push({ phrase: str(phrase).trim(), severity, reason: str(b?.reason).slice(0, 200) || null, ...(b?.instead ? { instead: str(b.instead).slice(0, 120) } : {}) });
  }
  const required = [];
  for (const r of list(src.required, 'required')) {
    const term = typeof r === 'string' ? r : r?.term;
    if (!str(term).trim()) { warnings.push('voice.required entry without a term ignored'); continue; }
    required.push({ term: str(term).trim(), files: r?.files ? str(r.files).replace(/\\/g, '/') : null });
  }
  const t = src.tone && typeof src.tone === 'object' ? src.tone : {};
  const d = DEFAULT_VOICE.tone;
  const tone = Object.fromEntries(Object.keys(d).map((k) => [k, t[k] === null ? null : num(t[k], d[k])]));
  const c = src.claims && typeof src.claims === 'object' ? src.claims : {};
  const strs = (v, name) => list(v, `claims.${name}`).map((x) => str(x).trim()).filter(Boolean);
  const claims = {
    allow_numbers: strs(c.allow_numbers, 'allow_numbers'),
    superlatives: strs(c.superlatives, 'superlatives'),
    allow_superlatives: strs(c.allow_superlatives, 'allow_superlatives').map(lc),
    min_quote_words: Math.max(2, num(c.min_quote_words, DEFAULT_VOICE.claims.min_quote_words)),
  };
  return { voice: { banned, required, tone, claims, email_unsubscribe: src.email_unsubscribe !== false }, warnings };
}

// --- claims.md -----------------------------------------------------------------------------------
// Parses the markdown claims table. Columns are found by header name (id, claim, status); a table
// without a header row is read as id | claim | status. Returns [{ id, text, status, verified }].
export function parseClaims(md) {
  const rows = [];
  let cols = null;
  for (const line of str(md).split(/\r?\n/)) {
    const l = line.trim();
    if (!l.startsWith('|')) { cols = null; continue; }
    const cells = l.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) continue;
    const low = cells.map(lc);
    if (!cols && low.includes('claim')) { cols = { id: low.indexOf('id'), text: low.indexOf('claim'), status: low.indexOf('status') }; continue; }
    const c = cols ?? { id: 0, text: 1, status: 2 };
    const text = cells[c.text] ?? '';
    if (!text) continue;
    const status = lc(cells[c.status] ?? '').replace(/[`*]/g, '').trim();
    rows.push({ id: c.id >= 0 ? cells[c.id] || null : null, text, status, verified: status === 'verified' });
  }
  return rows;
}

// --- text extraction -----------------------------------------------------------------------------
const COPY_META = new Set(['title', 'subject', 'preheader', 'description', 'meta_description', 'headline', 'cta', 'excerpt', 'summary']);
export function splitFrontMatter(text) {
  const m = str(text).match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: str(text).replace(/^﻿/, '') };
  const meta = {};
  for (const l of m[1].split(/\r?\n/)) { const kv = l.match(/^([A-Za-z0-9_]+):\s*(.*)$/); if (kv) meta[kv[1]] = kv[2].replace(/^['"]|['"]$/g, ''); }
  return { meta, body: m[2] };
}
const jsonStrings = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => jsonStrings(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!/^(id|url|href|src|link|file|path|agent|task_id|status|channel|utm_.*|at|date|created_at|type|lang|language)$/i.test(k)) jsonStrings(x, out);
  return out;
};
// Turns a draft into plain copy text (one block per line). Code, comments, URLs and markup are removed.
export function draftText(raw, ext = '.md') {
  let text = str(raw);
  if (ext === '.json') { try { return jsonStrings(JSON.parse(text)).join('\n'); } catch { /* fall through: treat as text */ } }
  const { meta, body } = splitFrontMatter(text);
  const head = Object.entries(meta).filter(([k]) => COPY_META.has(k.toLowerCase())).map(([, v]) => v);
  text = body;
  if (ext === '.html' || ext === '.htm' || /<\/?(p|div|h[1-6]|span|br|li|section)\b/i.test(text)) {
    text = text.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|h[1-6]|li|section|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }
  text = text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, ' ')
    .replace(EMAIL_RE, ' ')
    .replace(PHONE_RE, (m) => (isPhone(m) ? ' ' : m));
  const lines = text.split(/\r?\n/).map((l) => l
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*(?:[-*+]|\d{1,3}[.)])\s+/, '')
    .replace(/^\s*\|?\s*-{3,}.*$/, '')
    .replace(/\*\*|__|(?<!\w)[*_](?!\s)|(?<!\s)[*_](?!\w)/g, '')
    .replace(/\s+/g, ' ').trim());
  return [...head, ...lines].filter(Boolean).join('\n');
}

// --- readability ---------------------------------------------------------------------------------
export function syllables(word) {
  let w = lc(word).replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, (m) => m[0]).replace(/^y/, '');
  return Math.max(1, (w.match(/[aeiouy]{1,2}/g) ?? []).length);
}
const WORD_RE = /[A-Za-z0-9][A-Za-z0-9'’-]*/g;
export const words = (s) => (str(s).match(WORD_RE) ?? []).filter((w) => /[A-Za-z]/.test(w) || /\d/.test(w));
// Sentences: split on . ! ? followed by space, and on line breaks (headings and list items stand alone).
export const sentences = (text) => str(text).split(/\n+/).flatMap((l) => l.split(/(?<=[.!?])["'”’)]*\s+(?=[A-Z0-9"“'‘(])/)).map((s) => s.trim()).filter((s) => words(s).length);
export function readingStats(text) {
  const sents = sentences(text);
  const ws = sents.flatMap(words);
  const syl = ws.reduce((a, w) => a + syllables(w), 0);
  const nW = ws.length; const nS = sents.length || 1;
  const grade = nW ? Math.round((0.39 * (nW / nS) + 11.8 * (syl / nW) - 15.59) * 10) / 10 : null;
  const lengths = sents.map((s) => words(s).length);
  return { words: nW, sentences: sents.length, avg_words_per_sentence: nW ? Math.round((nW / nS) * 10) / 10 : 0, longest_sentence: lengths.length ? Math.max(...lengths) : 0, grade, _sentences: sents, _lengths: lengths };
}

// --- claims check --------------------------------------------------------------------------------
const NUM_RE = /(?<![\w.#/])(?<![A-Za-z]\d*-)([$€£¥]\s?)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(\s?(?:%|percent\b|x\b|k\b|m\b|bn\b))?(?![\w])/gi;
const DATE_RE = /\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?\b|\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:am|pm)?\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/gi;
const numKey = (m) => {
  const value = m[2].replace(/,/g, '') + (m[3] ? `.${m[3]}` : '');
  const unit = lc(m[4] ?? '').trim();
  const kind = unit === '%' || unit === 'percent' ? '%' : unit === 'x' ? 'x' : unit;
  return `${String(Number(value))}${kind}`;
};
// Structure labels ("Section 2", "Step 3", "Variant 1") number the draft, they do not claim anything.
const LABEL_RE = /\b(section|step|part|phase|variant|version|option|chapter|slide|email|week|day|tab|figure|table|question|q|h)\s?(\d{1,2})(?![\w%])/gi;
export function extractNumbers(text) {
  const clean = str(text).replace(DATE_RE, ' ').replace(LABEL_RE, (m, w) => `${w} #`);
  const out = [];
  for (const m of clean.matchAll(NUM_RE)) out.push({ raw: m[0].trim(), key: numKey(m), index: m.index, currency: Boolean(m[1]) });
  return out;
}
const supKey = (s) => lc(s).replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
const supRegex = (s) => {
  const k = esc(supKey(s)).replace(/ /g, '\\s+');
  return new RegExp(`(?<![\\w#-])${k}(?![\\w-])`, 'gi');
};
const normQuote = (s) => lc(s).replace(/[’‘]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Builds the lookup of what verified (and needs-proof) claims back up.
export function claimsIndex(claims = []) {
  const idx = { verified: new Map(), unproven: new Map(), sup: [], text: [] };
  for (const c of claims) {
    const bucket = c.verified ? idx.verified : idx.unproven;
    for (const n of extractNumbers(c.text)) if (!bucket.has(n.key)) bucket.set(n.key, c.id);
    idx.text.push({ id: c.id, verified: c.verified, norm: normQuote(c.text), low: supKey(c.text) });
  }
  return idx;
}
const supportFor = (idx, test) => {
  const v = idx.text.find((t) => t.verified && test(t)); if (v) return { ok: true, id: v.id };
  const u = idx.text.find((t) => !t.verified && test(t)); return { ok: false, id: u?.id ?? null };
};
const excerpt = (text, i, len) => redact(text.slice(Math.max(0, i - 40), i + len + 40).replace(/\s+/g, ' ').trim()).slice(0, 160);

// Flags numbers, superlatives and testimonial-like quotes not backed by a verified claim.
export function claimIssues(text, claims, voiceClaims = DEFAULT_VOICE.claims) {
  const idx = claimsIndex(claims);
  const issues = [];
  const allowNums = new Set(voiceClaims.allow_numbers.flatMap((a) => extractNumbers(a).map((n) => n.key)));
  const allowRaw = voiceClaims.allow_numbers.map(lc);
  const seen = new Set();
  for (const n of extractNumbers(text)) {
    if (allowNums.has(n.key) || allowRaw.includes(lc(n.raw)) || seen.has(n.key)) continue;
    seen.add(n.key);
    if (idx.verified.has(n.key)) continue;
    if (n.key === '0' && idx.text.some((t) => t.verified && /\bfree\b/.test(t.low))) continue; // "$0" restates a verified free plan
    const pending = idx.unproven.get(n.key);
    const what = n.key.endsWith('%') ? 'percentage' : n.currency ? 'price' : 'number';
    issues.push({ kind: 'unsupported_number', severity: 'block', message: `${what} "${n.raw}" is not in a verified claim${pending ? ` (claim ${pending} needs proof)` : ''}`, excerpt: excerpt(text, n.index, n.raw.length), ...(pending ? { claim: pending } : {}) });
  }
  const sups = [...new Set([...DEFAULT_SUPERLATIVES, ...voiceClaims.superlatives].map(supKey))].filter((s) => !voiceClaims.allow_superlatives.includes(s)).sort();
  // Sign-offs ("Best,", "Best regards") are not superlatives; blanked with spaces so indices stay put.
  const supText = text.replace(/^[ \t]*(?:all the |my )?best(?:[ \t]+(?:regards|wishes))?[ \t]*,?[ \t]*$/gim, (m) => ' '.repeat(m.length));
  for (const s of sups) {
    const re = supRegex(s);
    const m = re.exec(supText);
    if (!m) continue;
    const sup = supportFor(idx, (t) => supRegex(s).test(t.low));
    if (sup.ok) continue;
    issues.push({ kind: 'unsupported_superlative', severity: 'fix', message: `superlative "${m[0]}" is not backed by a verified claim${sup.id ? ` (claim ${sup.id} needs proof)` : ''}`, excerpt: excerpt(text, m.index, m[0].length), ...(sup.id ? { claim: sup.id } : {}) });
  }
  const quotes = [];
  for (const m of text.matchAll(/“([^”\n]{3,400})”|"([^"\n]{3,400})"/g)) quotes.push({ q: m[1] ?? m[2], index: m.index, len: m[0].length });
  const lines = text.split('\n');
  let off = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*>/.test(l)) {
      const next = (lines[i + 1] ?? '').trim();
      const inline = l.match(/^\s*>\s*(.+?)\s+(?:—|–|--)\s*[A-Z][\w.' -]{1,60}$/);
      if (inline) quotes.push({ q: inline[1], index: off, len: l.length, attributed: true });
      else if (/^(?:>\s*)?(?:—|–|--|-)\s*[A-Z][\w.' ,-]{1,80}$/.test(next)) quotes.push({ q: l.replace(/^\s*>\s*/, ''), index: off, len: l.length, attributed: true });
    }
    off += l.length + 1;
  }
  const qSeen = new Set();
  for (const q of quotes) {
    const body = normQuote(q.q.replace(/^\s*>\s*/, '').replace(/^["“]|["”]$/g, ''));
    if (!body || qSeen.has(body)) continue;
    // Unattributed quotes count as testimonials only when they speak in the first person ("I", "we", "my" …)
    // or are followed by "says" / "said".
    const saidAfter = /^\W{0,4}\s*(?:says|said|according to)\b/i.test(text.slice(q.index + q.len, q.index + q.len + 30));
    if (!q.attributed && (words(body).length < voiceClaims.min_quote_words || (!/\b(?:i|i'm|i've|me|my|we|we've|we're|our|us)\b/.test(body) && !saidAfter))) continue;
    qSeen.add(body);
    const sup = supportFor(idx, (t) => t.norm.includes(body));
    if (sup.ok) continue;
    issues.push({ kind: 'unsupported_quote', severity: 'block', message: `testimonial-like quote is not in a verified claim${sup.id ? ` (claim ${sup.id} needs proof)` : ''}`, excerpt: excerpt(text, q.index, q.len), ...(sup.id ? { claim: sup.id } : {}) });
  }
  return issues;
}

// --- voice check ---------------------------------------------------------------------------------
export function voiceIssues(text, voice, file = '') {
  const issues = [];
  for (const b of voice.banned) {
    const re = new RegExp(`(?<![\\w-])${esc(b.phrase).replace(/\s+/g, '\\s+')}(?![\\w-])`, 'gi');
    const hits = [...text.matchAll(re)];
    if (!hits.length) continue;
    issues.push({ kind: 'banned', severity: b.severity, message: `banned ${/\s/.test(b.phrase) ? 'phrase' : 'word'} "${b.phrase}" used ${hits.length}x${b.instead ? `; use "${b.instead}"` : ''}${b.reason ? ` (${b.reason})` : ''}`, excerpt: excerpt(text, hits[0].index, hits[0][0].length) });
  }
  for (const r of voice.required) {
    if (r.files && !file.startsWith(r.files)) continue;
    const re = new RegExp(`(?<![\\w-])${esc(r.term).replace(/\s+/g, '\\s+')}(?![\\w-])`, 'i');
    if (!re.test(text)) issues.push({ kind: 'missing_required', severity: 'fix', message: `required term "${r.term}" is missing` });
  }
  if (voice.email_unsubscribe !== false && file.startsWith('outbox/email/') && !/unsubscribe|opt[\s-]?out/i.test(text)
    && !voice.required.some((r) => /unsubscribe/i.test(r.term) && (!r.files || file.startsWith(r.files)))) {
    issues.push({ kind: 'missing_unsubscribe', severity: 'fix', message: 'email draft has no unsubscribe line (CAN-SPAM / GDPR)' });
  }
  const t = voice.tone;
  const bangs = (text.match(/!/g) ?? []).length;
  if (t.max_exclamations != null && bangs > t.max_exclamations) issues.push({ kind: 'tone_exclamations', severity: 'fix', message: `${bangs} exclamation marks (max ${t.max_exclamations})` });
  const caps = (text.match(/\b[A-Z]{4,}\b/g) ?? []).filter((w) => !/^(HTML|HTTP|HTTPS|JSON|HIPAA|GDPR|CCPA|SaaS|SMS|API|URL|FAQ|USD|EUR|GBP)$/.test(w));
  if (t.max_all_caps_words != null && caps.length > t.max_all_caps_words) issues.push({ kind: 'tone_shouting', severity: 'fix', message: `${caps.length} all-caps words (max ${t.max_all_caps_words}): ${[...new Set(caps)].slice(0, 5).join(', ')}` });
  const st = readingStats(text);
  if (t.words_per_sentence_max != null && st.sentences >= 2 && st.avg_words_per_sentence > t.words_per_sentence_max) issues.push({ kind: 'tone_sentence_length', severity: 'fix', message: `average ${st.avg_words_per_sentence} words per sentence (max ${t.words_per_sentence_max})` });
  if (t.sentence_hard_max != null) {
    const i = st._lengths.findIndex((n) => n > t.sentence_hard_max);
    if (i > -1) issues.push({ kind: 'tone_long_sentence', severity: 'fix', message: `${st._lengths.filter((n) => n > t.sentence_hard_max).length} sentence(s) over ${t.sentence_hard_max} words`, excerpt: redact(st._sentences[i]).slice(0, 160) });
  }
  if (t.reading_grade_max != null && st.grade != null && st.words >= (t.min_words_for_grade ?? 0) && st.grade > t.reading_grade_max + (t.reading_grade_tolerance ?? 0)) {
    issues.push({ kind: 'tone_reading_grade', severity: 'fix', message: `reading grade ${st.grade} (target ${t.reading_grade_max})` });
  }
  return { issues, stats: { words: st.words, sentences: st.sentences, avg_words_per_sentence: st.avg_words_per_sentence, longest_sentence: st.longest_sentence, reading_grade: st.grade, exclamations: bangs } };
}

// --- one draft -----------------------------------------------------------------------------------
// Pure: raw draft text in, verdict out. voice is a normalized voice (normalizeVoice(raw).voice).
export function checkDraft({ file = '', raw = '', ext = null, voice = normalizeVoice(null).voice, claims = [] } = {}) {
  const e = (ext ?? path.extname(file) ?? '.md').toLowerCase() || '.md';
  const text = draftText(raw, e);
  let reasons;
  let stats = { words: 0 };
  if (!words(text).length) reasons = [{ kind: 'empty', severity: 'fix', message: 'draft has no copy text' }];
  else {
    const v = voiceIssues(text, voice, file);
    stats = v.stats;
    reasons = [...claimIssues(text, claims, voice.claims), ...v.issues];
  }
  reasons.sort((a, b) => rank(b.severity) - rank(a.severity) || a.kind.localeCompare(b.kind) || a.message.localeCompare(b.message));
  const verdict = reasons.reduce((v, r) => (rank(r.severity) > rank(v) ? r.severity : v), 'pass');
  return { file, verdict, reasons: reasons.slice(0, MAX_REASONS), ...(reasons.length > MAX_REASONS ? { reasons_truncated: reasons.length - MAX_REASONS } : {}), stats };
}

const apFile = (f) => str(f).replace(/\\/g, '/').replace(/^\.\//, '');
// --- reviews for apply-results -------------------------------------------------------------------
// Pure: one review per pending approval whose file was checked, only when this verdict is stricter than
// the approval's current compliance (or it has none), so another reviewer's verdict is never lowered.
export function reviewsFor(results, approvals = []) {
  const byFile = new Map(results.map((r) => [r.file, r]));
  const out = [];
  for (const ap of Array.isArray(approvals) ? approvals : []) {
    if (!ap || ap.status !== 'pending' || !ap.id || !ap.file) continue;
    const r = byFile.get(apFile(ap.file));
    if (!r) continue;
    // Never "pass": tools/policy.mjs auto-approves an approval whose compliance is "pass", and this guard
    // checks voice and claims only (not consent, platform rules or the law), so a clean draft must still
    // wait for om-compliance-guard or the owner.
    if (r.verdict === 'pass') continue;
    if (ap.compliance && VERDICTS.includes(ap.compliance) && rank(r.verdict) <= rank(ap.compliance)) continue;
    const why = r.reasons.slice(0, 6).map((x) => x.message).join('; ');
    out.push({ approval_id: ap.id, compliance: r.verdict, notes: `voice-guard: ${r.verdict}${why ? ` (${why})` : ''}`.slice(0, 500) });
  }
  return out.sort((a, b) => str(a.approval_id).localeCompare(str(b.approval_id)));
}

// --- product run ---------------------------------------------------------------------------------
const listDrafts = (dir, base) => {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listDrafts(p, base));
    else if (e.isFile() && TEXT_EXT.has(path.extname(e.name).toLowerCase())) out.push(posix(path.relative(base, p)));
  }
  return out;
};

// Checks a product's outbox. Options: dir (product folder, default products/<slug>), now, files (only
// these outbox paths), write (report, default true), review (also write the REVIEW run file).
export function guardProduct(slug, { dir = null, now: nowIn = new Date().toISOString(), files = null, write = true, review = false } = {}) {
  // Any parseable date is normalized to UTC ISO, so the run file's date matches policy.mjs's UTC day.
  const at = new Date(nowIn);
  if (Number.isNaN(at.getTime())) throw new Error(`invalid --now: ${nowIn}`);
  const now = at.toISOString();
  if (!dir && (!slug || !/^[a-z0-9][a-z0-9_-]*$/i.test(slug))) throw new Error(`invalid product slug: ${slug}`);
  const pdir = dir ?? path.join(root, 'products', slug);
  if (!fs.existsSync(pdir)) throw new Error(`product folder not found: ${pdir}`);
  const voiceFile = path.join(pdir, 'voice.json');
  const hasVoice = fs.existsSync(voiceFile);
  const rawVoice = hasVoice ? readJson(voiceFile, undefined) : null;
  const { voice, warnings } = normalizeVoice(rawVoice);
  if (hasVoice && rawVoice === undefined) warnings.unshift('voice.json is not valid JSON; defaults used');
  const claimsFile = path.join(pdir, 'claims.md');
  const claims = fs.existsSync(claimsFile) ? parseClaims(fs.readFileSync(claimsFile, 'utf8')) : [];
  if (!claims.length) warnings.push('claims.md has no claims: every number, superlative and quote will be flagged');
  let list = listDrafts(path.join(pdir, 'outbox'), pdir).sort();
  if (files) {
    const want = new Set((Array.isArray(files) ? files : [files]).map((f) => posix(str(f)).replace(/^\.\//, '')));
    list = list.filter((f) => want.has(f));
    for (const f of want) if (!list.includes(f)) warnings.push(`not an outbox draft: ${f}`);
  }
  const results = [];
  for (const f of list) {
    const abs = path.join(pdir, f);
    let raw;
    try {
      const size = fs.statSync(abs).size;
      if (size > MAX_BYTES) { results.push({ file: f, verdict: 'fix', reasons: [{ kind: 'too_large', severity: 'fix', message: `draft is ${size} bytes (max ${MAX_BYTES}); not checked` }], stats: { words: 0 } }); continue; }
      raw = fs.readFileSync(abs, 'utf8');
    } catch (e) { results.push({ file: f, verdict: 'fix', reasons: [{ kind: 'unreadable', severity: 'fix', message: `could not read draft: ${e.code ?? e.message}` }], stats: { words: 0 } }); continue; }
    results.push(checkDraft({ file: f, raw, voice, claims }));
  }
  const approvals = readJson(path.join(pdir, 'approvals.json'), []);
  for (const r of results) { const ap = (Array.isArray(approvals) ? approvals : []).find((a) => a?.file && apFile(a.file) === r.file && a.status === 'pending'); if (ap) r.approval_id = ap.id; }
  const count = (v) => results.filter((r) => r.verdict === v).length;
  const report = {
    product: slug ?? path.basename(pdir), generated_at: now, agent: REVIEWER,
    voice_source: hasVoice && rawVoice !== undefined ? 'voice.json' : 'default', claims_verified: claims.filter((c) => c.verified).length,
    summary: { files: results.length, pass: count('pass'), fix: count('fix'), block: count('block') },
    warnings, files: results,
  };
  const reviews = reviewsFor(results, approvals);
  const out = { report, reviews, review_file: null };
  if (write) {
    fs.mkdirSync(path.join(pdir, 'reports'), { recursive: true });
    writeJson(path.join(pdir, 'reports', 'voice-guard.json'), report);
  }
  if (review && reviews.length) {
    const id = `REVIEW-voice-guard-${now.slice(0, 10).replace(/[^0-9-]/g, '') || 'run'}`;
    const run = { task_id: id, agent: REVIEWER, status: 'done', summary: `Voice and claim guard: ${report.summary.pass} pass, ${report.summary.fix} fix, ${report.summary.block} block`, output: ['reports/voice-guard.json'], reviews };
    fs.mkdirSync(path.join(pdir, 'runs'), { recursive: true });
    writeJson(path.join(pdir, 'runs', `${id}.json`), run);
    out.review_file = posix(path.join('runs', `${id}.json`));
  }
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : null; };
  const now = opt('--now') ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(now))) { console.error('--now must be an ISO date'); process.exit(2); }
  const files = args.flatMap((a, i) => (a === '--file' && args[i + 1] ? [args[i + 1]] : []));
  const review = args.includes('--review');
  const slugs = args.includes('--all')
    ? fs.readdirSync(path.join(root, 'products'), { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.')).map((e) => e.name).sort()
    : [args.find((a, i) => !a.startsWith('--') && !['--now', '--file'].includes(args[i - 1]))].filter(Boolean);
  if (!slugs.length) { console.error('Usage: node tools/voice-guard.mjs <slug> [--review] [--file outbox/x.md] [--now ISO] [--strict] | --all'); process.exit(2); }
  const summary = [];
  let blocked = 0;
  for (const s of slugs) {
    try {
      const r = guardProduct(s, { now, files: files.length ? files : null, review });
      blocked += r.report.summary.block;
      summary.push({ product: s, ...r.report.summary, reviews: r.reviews.length, review_file: r.review_file });
    } catch (e) { summary.push({ product: s, error: e.message }); if (!args.includes('--all')) { console.error(e.message); process.exit(1); } }
  }
  console.log(JSON.stringify(slugs.length === 1 ? summary[0] : { products: summary }));
  if (args.includes('--strict') && blocked) process.exit(1);
}
