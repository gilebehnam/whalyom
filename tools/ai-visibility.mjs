// AI-answer visibility: how often AI answer engines (ChatGPT, Perplexity, Gemini, Google AI Overviews,
// Copilot, Claude ...) name the brand when buyers ask them the questions that matter. Closes the
// measurement loop of "SEO + AI-answer optimization": the om-aeo-* agents optimize, this tool measures.
//   products/<slug>/research/ai-prompts.json      the prompt panel (owner or om-prompt-librarian writes):
//       { brand: { name, aliases[], domains[] }, competitors: [{ name, aliases[], domains[] }],
//         engines: ["chatgpt", ...], prompts: [{ id, text, market, intent?, priority? }] }
//       (priority 1 = most important ... 5; default 3)
//       A bare array is read as the prompt list. Brand falls back to product.json name and domain.
//   products/<slug>/research/ai-answers/<YYYY-MM-DD>.json   results that agents or connectors record:
//       { date?, results: [{ engine, prompt_id | prompt, mentioned, cited_url | cited_urls[], position,
//         competitors_mentioned[], accuracy: correct|partial|wrong|unknown, accuracy_notes, sample?,
//         answer? }] }  (a bare array works too). When `mentioned`, `position` or `competitors_mentioned`
//       is missing and the raw `answer` text is there, they are detected from the text. Repeated samples
//       of one prompt on one engine and day need distinct `sample` numbers; otherwise the last row wins.
//   products/<slug>/reports/ai-visibility.json    share of answer, citation rate and position per engine,
//       per market and overall (Wilson 95% intervals), competitors' share and share of voice, prompts
//       where the brand is missing, inaccurate answers, change versus the previous window, next actions
//   products/<slug>/reports/ai-visibility.md      the same report for people
//   products/<slug>/reports/ai-visibility-trend.json   weekly series per engine for the dashboard
//   state/ai-visibility.json                      every product (--all), aggregates only, no answer text
// Measurement only: nothing is sent, posted or bought. Next actions are internal briefs for agents
// (approval_required: false, since nothing leaves the workspace); content they produce still goes
// through outbox/ and approvals.json. Emails and phone numbers in notes and excerpts are redacted; the
// raw answer text never leaves products/<slug>/. Deterministic: same files and --now give the same output.
// Usage: node tools/ai-visibility.mjs <slug> [--days 28] [--now <ISO>]
//        node tools/ai-visibility.mjs --all [--days 28]            every active product, then state/
//        node tools/ai-visibility.mjs init <slug>                   writes an empty panel if none exists
//        node tools/ai-visibility.mjs record <slug> <file.json> [--date YYYY-MM-DD]   validate and merge
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, root as repoRoot } from './lib/env.mjs';

export const DEFAULT_DAYS = 28;
export const MAX_ROWS_PER_FILE = 5000;
const Z = 1.96;
const DAY = 86400000;

// Engine names as agents, connectors and people write them, mapped to one id.
const ENGINE_ALIASES = {
  chatgpt: ['chatgpt', 'openai', 'gpt', 'gpt-4', 'gpt-4o', 'gpt-5', 'chat-gpt', 'searchgpt', 'chatgpt-search'],
  perplexity: ['perplexity', 'pplx', 'perplexity-ai', 'sonar'],
  gemini: ['gemini', 'bard', 'google-gemini'],
  'google-ai-overviews': ['google-ai-overviews', 'ai-overviews', 'aio', 'google-aio', 'sge', 'google-ai-mode', 'ai-mode'],
  copilot: ['copilot', 'bing', 'bing-chat', 'microsoft-copilot', 'bing-copilot'],
  claude: ['claude', 'anthropic'],
  grok: ['grok', 'xai'],
  'meta-ai': ['meta-ai', 'meta', 'llama'],
  deepseek: ['deepseek'],
  'you-com': ['you', 'you-com'],
};
const ENGINE = Object.fromEntries(Object.entries(ENGINE_ALIASES).flatMap(([id, list]) => list.map((w) => [w, id])));
const slugify = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
// Unknown engines pass through as a slug, but never a value that looks like an email or phone number
// (engine ids reach state/ai-visibility.json).
export const canonicalEngine = (s) => { if (/@|\d{7,}/.test(String(s ?? '').replace(/[\s().+-]/g, ''))) return null; const k = slugify(s); return k ? (ENGINE[k] ?? k) : null; };

// Which agent acts on a gap, per engine (all exist in the roster).
const ENGINE_AGENT = { chatgpt: 'om-aeo-chatgpt', perplexity: 'om-aeo-perplexity', gemini: 'om-aeo-gemini', 'google-ai-overviews': 'om-aeo-gemini', copilot: 'om-aeo-copilot' };
const agentFor = (engine) => ENGINE_AGENT[engine] ?? 'om-geo-optimizer';

const ACCURACY = { correct: 'correct', accurate: 'correct', ok: 'correct', true: 'correct', partial: 'partial', partly: 'partial', outdated: 'partial', mixed: 'partial', wrong: 'wrong', inaccurate: 'wrong', false: 'wrong', incorrect: 'wrong', hallucinated: 'wrong' };
const accuracyOf = (v) => (v == null || v === '' ? 'unknown' : ACCURACY[String(v).trim().toLowerCase()] ?? 'unknown');

const round = (n, d = 3) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 12);
const normText = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').replace(/[?.!\s]+$/g, '').trim();
// Calendar-valid YYYY-MM-DD only (Date.parse rolls 2026-02-31 over to March, so round-trip it).
const isDate = (s) => { if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const t = Date.parse(`${s}T00:00:00Z`); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s; };
const toDate = (v) => { if (isDate(v)) return v; if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.trim()) && !isDate(v.trim().slice(0, 10))) return null; if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString().slice(0, 10); return null; };
const weekOf = (d) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
const median = (xs) => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const strList = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());

// Personal data never travels in reports: emails and phone-like digit runs become placeholders.
export const redact = (s, max = 280) => String(s ?? '')
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
  .replace(/\+?\d[\d\s().-]{7,}\d/g, (m) => (m.replace(/\D/g, '').length >= 9 ? '[phone]' : m))
  .replace(/\s+/g, ' ').trim().slice(0, max);

// Wilson score interval for k successes in n trials (95%). Stable for small n and for 0 or n successes.
export function wilson(k, n, z = Z) {
  if (!Number.isFinite(n) || n <= 0) return { p: null, lo: null, hi: null, n: 0 };
  const kk = Math.min(Math.max(Number(k) || 0, 0), n);
  const p = kk / n; const z2 = z * z;
  const den = 1 + z2 / n;
  const mid = (p + z2 / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return { p: round(p), lo: round(Math.max(0, mid - half)), hi: round(Math.min(1, mid + half)), n };
}

// Hostname of a URL or bare domain, without "www.". Null when it cannot be parsed.
export const hostOf = (u) => {
  if (typeof u !== 'string' || !u.trim()) return null;
  const s = u.trim(); try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
};
const hostMatches = (host, domains) => Boolean(host) && domains.some((d) => host === d || host.endsWith(`.${d}`));

const entity = (e) => {
  if (typeof e === 'string') e = { name: e };
  if (!e || typeof e !== 'object') return null;
  const name = typeof e.name === 'string' ? e.name.trim() : '';
  if (!name) return null;
  const domains = [...new Set([...strList(e.domains), ...strList(e.domain)].map(hostOf).filter(Boolean))].sort();
  const aliases = [...new Set([name, ...strList(e.aliases)].map((a) => a.trim()).filter((a) => a.length >= 2))];
  return { name, aliases, domains };
};

// Pure: the prompt panel, cleaned. `product` (product.json) supplies brand defaults and markets.
export function normalizePanel(raw, product = {}) {
  const panel = Array.isArray(raw) ? { prompts: raw } : raw && typeof raw === 'object' ? raw : {};
  const problems = [];
  const brand = entity(panel.brand ?? (product?.name ? { name: String(product.name).replace(/\s*\(sample\)\s*$/i, ''), domain: product.domain } : null));
  if (!brand) problems.push('no brand name: set brand.name in ai-prompts.json or name in product.json');
  if (brand && product?.domain) { const h = hostOf(product.domain); if (h && !brand.domains.includes(h)) brand.domains = [...brand.domains, h].sort(); }
  const competitors = [];
  for (const c of Array.isArray(panel.competitors) ? panel.competitors : []) {
    const e = entity(c);
    if (e && (!brand || e.name.toLowerCase() !== brand.name.toLowerCase()) && !competitors.some((x) => x.name.toLowerCase() === e.name.toLowerCase())) competitors.push(e);
  }
  const markets = strList(product?.market);
  const defaultMarket = markets[0] ?? 'global';
  const prompts = []; const seen = new Set();
  for (const [i, p0] of (Array.isArray(panel.prompts) ? panel.prompts : []).entries()) {
    const p = typeof p0 === 'string' ? { text: p0 } : p0;
    const text = typeof p?.text === 'string' ? p.text.trim().slice(0, 500) : '';
    if (!text) { problems.push(`prompt ${i}: no text`); continue; }
    const id = slugify(p.id) || `p-${hash(normText(text))}`;
    if (seen.has(id)) { problems.push(`prompt ${i}: duplicate id ${id}`); continue; }
    seen.add(id);
    const pr = Number(p.priority);
    prompts.push({ id, text, market: String(p.market ?? defaultMarket).trim() || defaultMarket, intent: typeof p.intent === 'string' ? p.intent.trim().slice(0, 40) : null, priority: Number.isFinite(pr) ? Math.min(Math.max(Math.round(pr), 1), 5) : 3 });
  }
  const engines = [...new Set(strList(panel.engines).map(canonicalEngine).filter(Boolean))].sort();
  return { brand, competitors, prompts, engines, markets, problems };
}

// Finds the entities an answer names, in the order they first appear. Word-boundary match on any alias,
// case-insensitive; an entity also counts when one of its domains appears in the text.
export function detectMentions(text, entities) {
  const t = String(text ?? ''); const lower = t.toLowerCase();
  const found = [];
  for (const e of entities) {
    let at = Infinity;
    for (const a of e.aliases) {
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${a.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'u');
      const m = re.exec(lower); if (m) at = Math.min(at, m.index + m[1].length);
    }
    for (const d of e.domains) { // whole host or subdomain only: "notquoteflow.example" is not "quoteflow.example"
      const m = new RegExp(`(^|[^\\p{L}\\p{N}-])(?:[\\p{L}\\p{N}-]+\\.)*${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}-])`, 'u').exec(lower);
      if (m) at = Math.min(at, m.index + m[1].length);
    }
    if (at !== Infinity) found.push({ name: e.name, at });
  }
  return found.sort((a, b) => a.at - b.at || cmp(a.name, b.name)).map((f, i) => ({ name: f.name, position: i + 1 }));
}

// Pure: one recorded result, validated against the panel. Returns { row } or { reason }.
export function normalizeResult(r, panel, fallbackDate = null) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { reason: 'not an object' };
  const engine = canonicalEngine(r.engine);
  if (!engine) return { reason: 'no engine' };
  const date = toDate(r.date) ?? toDate(r.at) ?? fallbackDate;
  if (!date) return { reason: 'no valid date' };
  let prompt = null;
  if (r.prompt_id != null) prompt = panel.prompts.find((p) => p.id === slugify(r.prompt_id)) ?? null;
  const ptext = typeof r.prompt === 'string' ? r.prompt : typeof r.prompt_text === 'string' ? r.prompt_text : '';
  if (!prompt && ptext) prompt = panel.prompts.find((p) => normText(p.text) === normText(ptext)) ?? null;
  if (!prompt && r.prompt_id == null && !ptext) return { reason: 'no prompt_id or prompt text' };
  const promptId = prompt ? prompt.id : `adhoc-${hash(normText(ptext || r.prompt_id))}`;
  const brand = panel.brand;
  const answer = typeof r.answer === 'string' ? r.answer : typeof r.answer_text === 'string' ? r.answer_text : '';
  const detected = answer && brand ? detectMentions(answer, [brand, ...panel.competitors]) : null;
  let mentioned = typeof r.mentioned === 'boolean' ? r.mentioned : r.mentioned === 'true' || r.mentioned === 1 ? true : r.mentioned === 'false' || r.mentioned === 0 ? false : null;
  if (mentioned == null && detected) mentioned = detected.some((d) => d.name === brand.name);
  if (mentioned == null) return { reason: 'mentioned missing and no answer text to detect it' };
  let position = Number(r.position);
  position = Number.isFinite(position) && position >= 1 ? Math.round(position) : null;
  if (position == null && mentioned && detected) position = detected.find((d) => d.name === brand.name)?.position ?? null;
  if (!mentioned) position = null;
  const urls = [...new Set([...strList(r.cited_urls), ...strList(r.cited_url), ...strList(r.citations)])].slice(0, 50);
  const hosts = urls.map(hostOf).filter(Boolean);
  const cited = r.cited === true || (brand ? hosts.some((h) => hostMatches(h, brand.domains)) : false);
  const canon = (n) => { const k = String(n).trim().toLowerCase(); const c = panel.competitors.find((x) => x.aliases.some((a) => a.toLowerCase() === k) || x.domains.includes(hostOf(n) ?? '')); return c ? c.name : String(n).trim().slice(0, 60); };
  let comps = [...new Set(strList(r.competitors_mentioned ?? r.competitors).map(canon))];
  if (!comps.length && detected) comps = detected.filter((d) => d.name !== brand.name).map((d) => d.name);
  if (brand) comps = comps.filter((c) => c.toLowerCase() !== brand.name.toLowerCase());
  const competitorsCited = panel.competitors.filter((c) => hosts.some((h) => hostMatches(h, c.domains))).map((c) => c.name);
  const sample = Number.isFinite(Number(r.sample)) ? Number(r.sample) : 0;
  return {
    row: {
      date, engine, prompt_id: promptId, on_panel: Boolean(prompt), market: prompt?.market ?? (typeof r.market === 'string' ? r.market : 'unknown'),
      mentioned, cited, position, competitors: comps.sort(), competitors_cited: competitorsCited.sort(),
      accuracy: mentioned ? accuracyOf(r.accuracy) : 'unknown', accuracy_notes: r.accuracy_notes ? redact(r.accuracy_notes) : null, sample,
    },
  };
}

// Pure: rows from all answer files. `files` = [{ name: '2026-11-03.json', data }]. Later files and rows
// replace earlier ones with the same date, engine, prompt and sample.
export function collectResults(files, panel) {
  const keep = new Map(); const rejected = [];
  const sorted = [...files].sort((a, b) => cmp(a.name, b.name));
  for (const f of sorted) {
    const data = f.data;
    const list = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : null;
    if (!list) { rejected.push({ file: f.name, index: null, reason: 'no results array' }); continue; }
    const fileDate = toDate(Array.isArray(data) ? null : data.date) ?? toDate(path.basename(f.name).slice(0, 10));
    const fileEngine = Array.isArray(data) ? null : data.engine;
    for (const [i, r] of list.slice(0, MAX_ROWS_PER_FILE).entries()) {
      const { row, reason } = normalizeResult(r && typeof r === 'object' && !Array.isArray(r) && r.engine == null && fileEngine ? { ...r, engine: fileEngine } : r, panel, fileDate);
      if (!row) { rejected.push({ file: f.name, index: i, reason }); continue; }
      keep.set(`${row.date}|${row.engine}|${row.prompt_id}|${row.sample}`, row);
    }
    if (list.length > MAX_ROWS_PER_FILE) rejected.push({ file: f.name, index: MAX_ROWS_PER_FILE, reason: `more than ${MAX_ROWS_PER_FILE} rows, rest skipped` });
  }
  const rows = [...keep.values()].sort((a, b) => cmp(a.date, b.date) || cmp(a.engine, b.engine) || cmp(a.prompt_id, b.prompt_id) || a.sample - b.sample);
  return { rows, rejected };
}

// Share of answer, citation rate, position and accuracy for a set of rows.
function summarize(rows) {
  const n = rows.length; const m = rows.filter((r) => r.mentioned);
  const positions = m.map((r) => r.position).filter(Number.isFinite);
  const judged = m.filter((r) => r.accuracy !== 'unknown');
  return {
    answers: n, mentions: m.length,
    share_of_answer: wilson(m.length, n),
    citation_rate: wilson(rows.filter((r) => r.cited).length, n),
    cited_when_mentioned: wilson(m.filter((r) => r.cited).length, m.length),
    first_position_rate: wilson(m.filter((r) => r.position === 1).length, n),
    avg_position: positions.length ? round(positions.reduce((s, x) => s + x, 0) / positions.length, 2) : null,
    median_position: median(positions),
    accuracy: { correct: judged.filter((r) => r.accuracy === 'correct').length, partial: judged.filter((r) => r.accuracy === 'partial').length, wrong: judged.filter((r) => r.accuracy === 'wrong').length, unknown: m.length - judged.length, correct_rate: wilson(judged.filter((r) => r.accuracy === 'correct').length, judged.length) },
  };
}
const groupBy = (rows, key) => { const g = {}; for (const r of rows) (g[key(r)] ??= []).push(r); return Object.fromEntries(Object.entries(g).sort(([a], [b]) => cmp(a, b))); };
const overlaps = (a, b) => a.lo != null && b.lo != null && a.lo <= b.hi && b.lo <= a.hi;

function competitorTable(rows, brandMentions) {
  const count = {}; const cited = {};
  for (const r of rows) { for (const c of r.competitors) count[c] = (count[c] ?? 0) + 1; for (const c of r.competitors_cited) cited[c] = (cited[c] ?? 0) + 1; }
  const total = brandMentions + Object.values(count).reduce((s, x) => s + x, 0);
  return {
    share_of_voice: total ? round(brandMentions / total) : null,
    competitors: Object.entries(count).map(([name, k]) => ({ name, mentions: k, share_of_answer: wilson(k, rows.length), citation_rate: wilson(cited[name] ?? 0, rows.length), share_of_voice: total ? round(k / total) : null }))
      .sort((a, b) => b.mentions - a.mentions || cmp(a.name, b.name)),
  };
}

// Pure: the full report. `now` fixes the window end; `days` is the window length.
export function visibilityReport({ panel, rows, rejected = [], now = new Date().toISOString(), days = DEFAULT_DAYS, slug = null }) {
  const d = Number.isFinite(Number(days)) && Number(days) >= 1 ? Math.min(Math.round(Number(days)), 365) : DEFAULT_DAYS;
  const end = toDate(now) ?? new Date().toISOString().slice(0, 10);
  const endT = Date.parse(`${end}T00:00:00Z`);
  const startT = endT - (d - 1) * DAY; const prevStartT = startT - d * DAY;
  const t = (r) => Date.parse(`${r.date}T00:00:00Z`);
  const valid = rows.filter((r) => t(r) <= endT);
  const cur = valid.filter((r) => t(r) >= startT);
  const prev = valid.filter((r) => t(r) >= prevStartT && t(r) < startT);
  const overall = summarize(cur);
  const before = summarize(prev);
  const change = (a, b) => ({ previous: b.p, current: a.p, change_pp: a.p != null && b.p != null ? round((a.p - b.p) * 100, 1) : null, significant: a.p != null && b.p != null ? !overlaps(a, b) : false });
  const byEngine = Object.fromEntries(Object.entries(groupBy(cur, (r) => r.engine)).map(([e, rs]) => {
    const p = prev.filter((r) => r.engine === e); const s = summarize(rs);
    return [e, { ...s, share_change: change(s.share_of_answer, summarize(p).share_of_answer), ...competitorTable(rs, s.mentions) }];
  }));
  const byMarket = Object.fromEntries(Object.entries(groupBy(cur, (r) => r.market)).map(([mk, rs]) => { const s = summarize(rs); return [mk, { answers: s.answers, mentions: s.mentions, share_of_answer: s.share_of_answer, citation_rate: s.citation_rate }]; }));

  // Prompts: per panel prompt in the window, where the brand shows up and who shows up instead.
  const promptRows = groupBy(cur.filter((r) => r.on_panel), (r) => r.prompt_id);
  const engineSet = [...new Set([...panel.engines, ...cur.map((r) => r.engine)])].sort();
  const prompts = panel.prompts.map((p) => {
    const rs = promptRows[p.id] ?? [];
    const eng = groupBy(rs, (r) => r.engine);
    const missingOn = Object.entries(eng).filter(([, x]) => !x.some((r) => r.mentioned)).map(([e]) => e);
    const comp = {}; for (const r of rs) for (const c of r.competitors) comp[c] = (comp[c] ?? 0) + 1;
    return {
      id: p.id, text: p.text, market: p.market, intent: p.intent, priority: p.priority, answers: rs.length,
      share_of_answer: wilson(rs.filter((r) => r.mentioned).length, rs.length), cited: rs.some((r) => r.cited),
      engines_checked: Object.keys(eng), engines_missing: missingOn, engines_unchecked: engineSet.filter((e) => !eng[e]),
      competitors_present: Object.entries(comp).sort(([a, x], [b, y]) => y - x || cmp(a, b)).map(([name, k]) => ({ name, mentions: k })),
    };
  });
  const missing = prompts.filter((p) => p.answers > 0 && p.share_of_answer.p === 0)
    .sort((a, b) => a.priority - b.priority || b.competitors_present.length - a.competitors_present.length || cmp(a.id, b.id));
  const partlyMissing = prompts.filter((p) => p.answers > 0 && p.share_of_answer.p > 0 && p.engines_missing.length)
    .sort((a, b) => a.priority - b.priority || cmp(a.id, b.id));
  const unchecked = prompts.filter((p) => p.answers === 0).map((p) => p.id);
  const inaccurate = cur.filter((r) => r.mentioned && (r.accuracy === 'wrong' || r.accuracy === 'partial'))
    .map((r) => ({ date: r.date, engine: r.engine, prompt_id: r.prompt_id, accuracy: r.accuracy, notes: r.accuracy_notes }))
    .sort((a, b) => (a.accuracy === b.accuracy ? 0 : a.accuracy === 'wrong' ? -1 : 1) || cmp(b.date, a.date) || cmp(a.engine, b.engine) || cmp(a.prompt_id, b.prompt_id));

  // Next actions: internal briefs only. Nothing here is outbound.
  const actions = [];
  for (const p of missing.slice(0, 10)) {
    for (const e of p.engines_missing) actions.push({ type: 'close_gap', agent: agentFor(e), engine: e, prompt_id: p.id, priority: p.priority, brief: `Brand missing from ${e} answers to "${p.text}"${p.competitors_present.length ? `; named instead: ${p.competitors_present.slice(0, 3).map((c) => c.name).join(', ')}` : ''}. Draft an answer-ready page or section, schema and citations from claims.md.`, approval_required: false });
  }
  for (const [e, s] of Object.entries(byEngine)) {
    if (s.mentions >= 3 && s.cited_when_mentioned.p != null && s.cited_when_mentioned.p < 0.25) actions.push({ type: 'earn_citation', agent: 'om-citation-auditor', engine: e, prompt_id: null, priority: 2, brief: `${e} names the brand in ${s.mentions} answers but links the site in few of them. Find the pages it cites instead and what they have that ours lack.`, approval_required: false });
  }
  const wrongPrompts = [...new Set(inaccurate.filter((x) => x.accuracy === 'wrong').map((x) => `${x.engine}|${x.prompt_id}`))];
  for (const k of wrongPrompts.slice(0, 10)) { const [e, pid] = k.split('|'); actions.push({ type: 'fix_accuracy', agent: 'om-entity-builder', engine: e, prompt_id: pid, priority: 1, brief: `${e} states something wrong about the brand for prompt ${pid}. Strengthen entity facts (about page, schema, profiles) with sources from claims.md.`, approval_required: false }); }
  if (unchecked.length) actions.push({ type: 'check_prompts', agent: 'om-llm-visibility-analyst', engine: null, prompt_id: null, priority: 3, brief: `${unchecked.length} panel prompt(s) have no answer recorded in the last ${d} days: ${unchecked.slice(0, 8).join(', ')}${unchecked.length > 8 ? ' ...' : ''}.`, approval_required: false });
  actions.sort((a, b) => a.priority - b.priority || cmp(a.type, b.type) || cmp(a.engine ?? '', b.engine ?? '') || cmp(a.prompt_id ?? '', b.prompt_id ?? ''));

  const comp = competitorTable(cur, overall.mentions);
  return {
    product: slug, updated_at: now, window: { days: d, from: new Date(startT).toISOString().slice(0, 10), to: end },
    brand: panel.brand ? { name: panel.brand.name, domains: panel.brand.domains } : null,
    panel: { prompts: panel.prompts.length, markets: [...new Set(panel.prompts.map((p) => p.market))].sort(), engines: engineSet, problems: panel.problems },
    coverage: { answers: cur.length, off_panel_answers: cur.filter((r) => !r.on_panel).length, prompts_checked: prompts.length - unchecked.length, prompts_unchecked: unchecked.length, rejected: rejected.length },
    overall: { ...overall, share_change: change(overall.share_of_answer, before.share_of_answer), citation_change: change(overall.citation_rate, before.citation_rate) },
    by_engine: byEngine, by_market: byMarket,
    share_of_voice: comp.share_of_voice, competitors: comp.competitors,
    missing_prompts: missing, partly_missing_prompts: partlyMissing, unchecked_prompts: unchecked,
    inaccurate: inaccurate.slice(0, 50), next_actions: actions.slice(0, 40), rejected: rejected.slice(0, 100),
    status: !panel.brand ? 'no_brand' : !panel.prompts.length ? 'no_panel' : !cur.length ? 'no_data' : 'ok',
  };
}

// Pure: weekly series over all rows (dashboard trend). Weeks start on Monday (UTC).
export function visibilityTrend(rows, { now = new Date().toISOString(), weeks = 26 } = {}) {
  const end = toDate(now) ?? new Date().toISOString().slice(0, 10);
  const lastWeek = weekOf(end);
  const firstT = Date.parse(`${lastWeek}T00:00:00Z`) - (Math.max(1, Math.min(Math.round(weeks) || 26, 260)) - 1) * 7 * DAY;
  const inRange = rows.filter((r) => r.date <= end && Date.parse(`${r.date}T00:00:00Z`) >= firstT);
  const point = (rs) => { const s = wilson(rs.filter((r) => r.mentioned).length, rs.length); const c = wilson(rs.filter((r) => r.cited).length, rs.length); return { answers: rs.length, share: s.p, lo: s.lo, hi: s.hi, citation_rate: c.p }; };
  const series = Object.entries(groupBy(inRange, (r) => weekOf(r.date))).map(([week, rs]) => ({ week, ...point(rs), by_engine: Object.fromEntries(Object.entries(groupBy(rs, (r) => r.engine)).map(([e, x]) => [e, point(x)])) }));
  return { updated_at: now, unit: 'week', weeks: series };
}

const pctS = (w) => (w?.p == null ? 'n/a' : `${Math.round(w.p * 100)}% (${Math.round(w.lo * 100)}-${Math.round(w.hi * 100)}%)`);
const mdCell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

// Pure: the report as Markdown.
export function renderMarkdown(rep) {
  const L = [`# AI-answer visibility: ${rep.brand?.name ?? rep.product ?? 'unknown'}`, '', `Window ${rep.window.from} to ${rep.window.to} (${rep.window.days} days). ${rep.coverage.answers} answers, ${rep.panel.prompts} prompts on the panel, ${rep.coverage.prompts_unchecked} not checked. Ranges are 95% Wilson intervals.`, ''];
  if (rep.status !== 'ok') L.push(`Status: **${rep.status}**. ${rep.status === 'no_panel' ? 'Add buyer questions to research/ai-prompts.json.' : rep.status === 'no_brand' ? 'Set brand.name in research/ai-prompts.json.' : 'Record answers in research/ai-answers/<date>.json.'}`, '');
  const o = rep.overall; const ch = o.share_change;
  L.push('## Overall', '', `- Share of answer: ${pctS(o.share_of_answer)}${ch.change_pp != null ? `, ${ch.change_pp >= 0 ? '+' : ''}${ch.change_pp} pp vs previous window${ch.significant ? ' (significant)' : ' (within noise)'}` : ''}`, `- Citation rate (our domain linked): ${pctS(o.citation_rate)}`, `- Named first: ${pctS(o.first_position_rate)}; average position ${o.avg_position ?? 'n/a'}`, `- Share of voice against tracked competitors: ${rep.share_of_voice == null ? 'n/a' : `${Math.round(rep.share_of_voice * 100)}%`}`, `- Accuracy when named: ${o.accuracy.correct} correct, ${o.accuracy.partial} partial, ${o.accuracy.wrong} wrong, ${o.accuracy.unknown} not judged`, '');
  const eng = Object.entries(rep.by_engine);
  if (eng.length) {
    L.push('## By engine', '', '| Engine | Answers | Share of answer | Citation rate | Avg position | Change |', '|---|---|---|---|---|---|');
    for (const [e, s] of eng) L.push(`| ${e} | ${s.answers} | ${pctS(s.share_of_answer)} | ${pctS(s.citation_rate)} | ${s.avg_position ?? 'n/a'} | ${s.share_change.change_pp == null ? 'n/a' : `${s.share_change.change_pp >= 0 ? '+' : ''}${s.share_change.change_pp} pp${s.share_change.significant ? ' *' : ''}`} |`);
    L.push('');
  }
  const mk = Object.entries(rep.by_market);
  if (mk.length > 1) { L.push('## By market', '', '| Market | Answers | Share of answer | Citation rate |', '|---|---|---|---|'); for (const [m, s] of mk) L.push(`| ${mdCell(m)} | ${s.answers} | ${pctS(s.share_of_answer)} | ${pctS(s.citation_rate)} |`); L.push(''); }
  if (rep.competitors.length) { L.push('## Competitors', '', '| Competitor | Mentions | Share of answer | Share of voice |', '|---|---|---|---|'); for (const c of rep.competitors.slice(0, 15)) L.push(`| ${mdCell(c.name)} | ${c.mentions} | ${pctS(c.share_of_answer)} | ${c.share_of_voice == null ? 'n/a' : `${Math.round(c.share_of_voice * 100)}%`} |`); L.push(''); }
  if (rep.missing_prompts.length) { L.push('## Prompts where the brand is missing', ''); for (const p of rep.missing_prompts.slice(0, 25)) L.push(`- **${mdCell(p.text)}** (${p.id}, ${p.market}, priority ${p.priority}): checked on ${p.engines_checked.join(', ')}${p.competitors_present.length ? `; named instead: ${p.competitors_present.slice(0, 4).map((c) => mdCell(c.name)).join(', ')}` : ''}`); L.push(''); }
  if (rep.partly_missing_prompts.length) { L.push('## Prompts missing on some engines', ''); for (const p of rep.partly_missing_prompts.slice(0, 25)) L.push(`- ${mdCell(p.text)} (${p.id}): missing on ${p.engines_missing.join(', ')}`); L.push(''); }
  if (rep.inaccurate.length) { L.push('## Inaccurate answers', ''); for (const x of rep.inaccurate.slice(0, 20)) L.push(`- ${x.date} ${x.engine} ${x.prompt_id}: ${x.accuracy}${x.notes ? ` - ${mdCell(x.notes)}` : ''}`); L.push(''); }
  if (rep.next_actions.length) { L.push('## Next actions (internal briefs, nothing is sent)', ''); for (const a of rep.next_actions.slice(0, 20)) L.push(`- ${a.agent}: ${mdCell(a.brief)}`); L.push(''); }
  if (rep.panel.problems.length || rep.coverage.rejected) L.push('## Data problems', '', ...rep.panel.problems.map((p) => `- panel: ${mdCell(p)}`), ...rep.rejected.slice(0, 20).map((r) => `- ${mdCell(r.file)}${r.index == null ? '' : ` row ${r.index}`}: ${mdCell(r.reason)}`), '');
  return `${L.join('\n').trimEnd()}\n`;
}

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const productDir = (slug, base) => {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) throw new Error(`invalid product slug: ${JSON.stringify(slug)}`);
  return path.join(base, 'products', slug);
};
const readAnswerFiles = (dir) => {
  const d = path.join(dir, 'research', 'ai-answers');
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => /^\d{4}-\d{2}-\d{2}.*\.json$/.test(f)).sort().map((f) => ({ name: f, data: readJson(path.join(d, f), null) }));
};

// Reads the panel and answers of one product, writes the three report files, returns a short summary.
export function runVisibility(slug, { now = new Date().toISOString(), days = DEFAULT_DAYS, base = repoRoot } = {}) {
  const dir = productDir(slug, base);
  if (!fs.existsSync(path.join(dir, 'product.json'))) throw new Error(`no product.json for ${slug}`);
  const product = readJson(path.join(dir, 'product.json'), {});
  const panel = normalizePanel(readJson(path.join(dir, 'research', 'ai-prompts.json'), null), product);
  const { rows, rejected } = collectResults(readAnswerFiles(dir), panel);
  const rep = visibilityReport({ panel, rows, rejected, now, days, slug });
  const trend = visibilityTrend(rows, { now });
  fs.mkdirSync(path.join(dir, 'reports'), { recursive: true });
  writeJson(path.join(dir, 'reports', 'ai-visibility.json'), rep);
  fs.writeFileSync(path.join(dir, 'reports', 'ai-visibility.md'), renderMarkdown(rep));
  writeJson(path.join(dir, 'reports', 'ai-visibility-trend.json'), { product: slug, ...trend });
  return { product: slug, status: rep.status, answers: rep.coverage.answers, share_of_answer: rep.overall.share_of_answer.p, citation_rate: rep.overall.citation_rate.p, missing_prompts: rep.missing_prompts.length, rejected: rep.coverage.rejected };
}

// Every active product, then state/ai-visibility.json (aggregates only: no prompt text, no answers).
export function runAll({ now = new Date().toISOString(), days = DEFAULT_DAYS, base = repoRoot } = {}) {
  const pdir = path.join(base, 'products');
  const slugs = (fs.existsSync(pdir) ? fs.readdirSync(pdir) : []).filter((s) => !s.startsWith('_') && SLUG_RE.test(s) && fs.existsSync(path.join(pdir, s, 'product.json'))).sort();
  const products = []; const errors = [];
  for (const slug of slugs) {
    try {
      runVisibility(slug, { now, days, base });
      const rep = readJson(path.join(pdir, slug, 'reports', 'ai-visibility.json'), null);
      const trend = readJson(path.join(pdir, slug, 'reports', 'ai-visibility-trend.json'), { weeks: [] });
      products.push({ product: slug, status: rep.status, answers: rep.coverage.answers, prompts: rep.panel.prompts, share_of_answer: rep.overall.share_of_answer, citation_rate: rep.overall.citation_rate, share_of_voice: rep.share_of_voice, share_change_pp: rep.overall.share_change.change_pp, missing_prompts: rep.missing_prompts.length, inaccurate: rep.inaccurate.length, by_engine: Object.fromEntries(Object.entries(rep.by_engine).map(([e, s]) => [e, { answers: s.answers, share: s.share_of_answer.p, citation_rate: s.citation_rate.p }])), trend: trend.weeks.map((w) => ({ week: w.week, answers: w.answers, share: w.share, lo: w.lo, hi: w.hi })) });
    } catch (e) { errors.push({ product: slug, error: String(e.message).slice(0, 200) }); }
  }
  fs.mkdirSync(path.join(base, 'state'), { recursive: true });
  const windowDays = Number.isFinite(Number(days)) && Number(days) >= 1 ? Math.min(Math.round(Number(days)), 365) : DEFAULT_DAYS;
  writeJson(path.join(base, 'state', 'ai-visibility.json'), { updated_at: now, window_days: windowDays, products, errors });
  return { products: products.length, with_data: products.filter((p) => p.status === 'ok').length, errors: errors.length };
}

// Writes an empty panel (brand from product.json, markets, engines) when none exists. Never overwrites,
// never invents buyer questions: prompts start empty for the owner or om-prompt-librarian to fill.
export function initPanel(slug, { base = repoRoot } = {}) {
  const dir = productDir(slug, base);
  if (!fs.existsSync(path.join(dir, 'product.json'))) throw new Error(`no product.json for ${slug}`);
  const file = path.join(dir, 'research', 'ai-prompts.json');
  if (fs.existsSync(file)) return { created: false, file: path.relative(base, file).replace(/\\/g, '/') };
  const product = readJson(path.join(dir, 'product.json'), {});
  const host = hostOf(product.domain);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJson(file, { brand: { name: String(product.name ?? slug).replace(/\s*\(sample\)\s*$/i, ''), aliases: [], domains: host ? [host] : [] }, competitors: [], engines: ['chatgpt', 'perplexity', 'gemini', 'google-ai-overviews', 'copilot'], markets: strList(product.market), prompts: [] });
  return { created: true, file: path.relative(base, file).replace(/\\/g, '/') };
}

// Validates results and merges them into research/ai-answers/<date>.json. Rows that fail validation are
// returned, not written. The raw answer text is kept (it stays inside products/<slug>/), redacted.
export function recordAnswers(slug, results, { date = null, now = new Date().toISOString(), base = repoRoot } = {}) {
  const dir = productDir(slug, base);
  if (!fs.existsSync(path.join(dir, 'product.json'))) throw new Error(`no product.json for ${slug}`);
  const day = toDate(date) ?? toDate(now);
  if (!day) throw new Error('invalid date');
  const list = Array.isArray(results) ? results : Array.isArray(results?.results) ? results.results : null;
  if (!list) throw new Error('results must be an array or { results: [] }');
  const panel = normalizePanel(readJson(path.join(dir, 'research', 'ai-prompts.json'), null), readJson(path.join(dir, 'product.json'), {}));
  const ok = []; const rejected = [];
  for (const [i, r] of list.slice(0, MAX_ROWS_PER_FILE).entries()) {
    const { row, reason } = normalizeResult(r, panel, day);
    if (!row) { rejected.push({ index: i, reason }); continue; }
    if (row.date !== day) { rejected.push({ index: i, reason: `date ${row.date} differs from file date ${day}` }); continue; }
    const clean = { ...r, engine: row.engine, prompt_id: row.on_panel ? row.prompt_id : r.prompt_id, recorded_at: now };
    for (const k of ['answer', 'answer_text']) if (typeof clean[k] === 'string') clean[k] = redact(clean[k], 8000);
    if (clean.accuracy_notes) clean.accuracy_notes = redact(clean.accuracy_notes);
    ok.push(clean);
  }
  const file = path.join(dir, 'research', 'ai-answers', `${day}.json`);
  if (ok.length) {
    const prev = fs.existsSync(file) ? readJson(file, undefined) : null;
    // Never overwrite a file that exists but cannot be parsed: that would silently drop recorded answers.
    if (prev === undefined) throw new Error(`${path.relative(base, file).replace(/\\/g, '/')} exists but is not valid JSON; fix or move it first`);
    const existing = Array.isArray(prev) ? prev : Array.isArray(prev?.results) ? prev.results : [];
    // Re-recording the same engine, prompt and sample replaces the old row instead of growing the file
    // (rows past MAX_ROWS_PER_FILE are skipped on read, so unbounded appends would hide the newest ones).
    const keyOf = (r) => { const n = normalizeResult(r, panel, day).row; return n ? `${n.engine}|${n.prompt_id}|${n.sample}` : null; };
    const fresh = new Set(ok.map(keyOf));
    const kept = existing.filter((r) => { const k = keyOf(r); return k == null || !fresh.has(k); });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeJson(file, { date: day, results: [...kept, ...ok] });
  }
  return { written: ok.length, rejected, file: path.relative(base, file).replace(/\\/g, '/') };
}

const flag = (args, name, d = null) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };

export function main(argv = process.argv.slice(2)) {
  const now = flag(argv, '--now') ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(now))) throw new Error('--now must be an ISO date');
  const days = Number(flag(argv, '--days', DEFAULT_DAYS));
  const pos = argv.filter((a, i) => !a.startsWith('--') && !['--now', '--days', '--date'].includes(argv[i - 1]));
  if (argv.includes('--all')) return runAll({ now, days });
  if (pos[0] === 'init') return initPanel(pos[1]);
  if (pos[0] === 'record') {
    if (!pos[2]) throw new Error('usage: record <slug> <file.json> [--date YYYY-MM-DD]');
    const data = readJson(path.resolve(pos[2]), undefined);
    if (data === undefined) throw new Error(`cannot read JSON from ${pos[2]}`);
    return recordAnswers(pos[1], data, { date: flag(argv, '--date'), now });
  }
  if (!pos[0]) throw new Error('usage: node tools/ai-visibility.mjs <slug> | --all | init <slug> | record <slug> <file.json>');
  return runVisibility(pos[0], { now, days });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try { console.log(JSON.stringify(main())); } catch (e) { console.error(e.message); process.exit(1); }
}
