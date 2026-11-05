// Competitor watch: a polite crawler that snapshots each competitor's own pages and reports what changed.
// It closes "Competitor monitoring": the om-competitor-watch workflow and om-competitor-monitor read the
// diff this tool computes in code instead of re-reading every site by hand.
//   products/<slug>/research/competitors.json     the watch list (owner or om-competitor-monitor writes it):
//       { "competitors": [ { "name": "Bonsai", "urls": { "home": "https://…", "pricing": "https://…",
//         "changelog": "https://…" } } ] }   (a bare array of the same objects also works; "url" alone
//         counts as "home"). Only http(s) URLs on public hosts are fetched; at most 25 competitors.
//   products/<slug>/research/competitor-snapshots/<name>/<date>.json
//       one snapshot per competitor per day: per page the status, title, headings, prices, feature
//       lines, visible text (emails redacted, capped) and a sha256 content hash. A re-run on the same
//       day replaces that day's file; the diff is always against the newest earlier day.
//   products/<slug>/research/competitor-diff.json  the diff report (machine readable, deterministic)
//   products/<slug>/research/competitor-diff.md    the same report for people and agents
//   products/<slug>/runs/<task-id>.json            only with --task: summary, alerts and suggested tasks
//                                                   for tools/apply-results.mjs (approvals stay empty:
//                                                   watching is read-only and sends or spends nothing)
//   state/competitor-watch.json                    only with --all: counts per product, no page text
// Politeness: robots.txt is read once per origin and its Disallow/Allow rules (longest match, * and $)
// are honoured for our user agent; at most one request per second across the whole run (robots
// included); a request cap per run; a timeout (covering the body) and a streamed size cap per page; html
// and text responses only. Redirects are followed by hand (at most 5): every hop must be a public URL and
// allowed by the robots.txt of its own origin, so a redirect cannot reach a private host or a Disallow.
// Emails are redacted in stored text, titles, headings and feature lines.
// A robots.txt that answers 5xx or cannot be fetched blocks that origin for the run (conservative);
// 404 means no rules. Paused products are skipped. Crawling is free, so budget caps are not touched.
// fetch, sleep and the clock are injectable, so the tests never touch the network.
// Usage: node tools/competitor-watch.mjs <slug> [--task <task-id>] [--date YYYY-MM-DD] [--dry-run]
//        node tools/competitor-watch.mjs --all     every product with a watch list, then state/
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, root as repoRoot } from './lib/env.mjs';

export const USER_AGENT = 'WhalyomBot/1.0 (+competitor-watch; polite; respects robots.txt)';
export const UA_TOKEN = 'whalyombot';
export const PAGE_KINDS = ['home', 'pricing', 'changelog'];
export const LIMITS = { competitors: 25, requests: 80, intervalMs: 1000, timeoutMs: 15000, maxBytes: 2_000_000, textChars: 20000, headings: 80, features: 150, prices: 60 };

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const sortU = (xs) => [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const today = (now) => new Date(now).toISOString().slice(0, 10);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? '')) && !Number.isNaN(Date.parse(s));

// Folder-safe competitor id: "Acme, Inc." -> "acme-inc". Empty or odd names get a stable hash id.
export const safeName = (s) => {
  const n = String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return n || (String(s ?? '').trim() ? `c-${sha256(s).slice(0, 10)}` : '');
};

// Public http(s) URLs only: no credentials in the URL, no localhost, no private or link-local literals.
export function publicUrl(u) {
  let url;
  try { url = new URL(String(u ?? '').trim()); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  const h = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return null;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h === '::1' || h === '::' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h) || /^::ffff:/.test(h) || /^64:ff9b:/.test(h) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return null;
  if (!h.includes('.') && !h.includes(':')) return null;
  url.hash = '';
  return url.href;
}

// Pure: watch-list JSON -> [{ name, id, urls: { home?, pricing?, changelog? } }] plus skipped reasons.
export function normalizeWatchList(raw, { max = LIMITS.competitors } = {}) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.competitors) ? raw.competitors : [];
  const out = []; const skipped = []; const seen = new Set();
  for (const c of list) {
    if (!c || typeof c !== 'object') { skipped.push({ name: String(c ?? ''), reason: 'not an object' }); continue; }
    const name = String(c.name ?? '').trim().slice(0, 80);
    const id = safeName(name);
    if (!id) { skipped.push({ name, reason: 'no name' }); continue; }
    if (seen.has(id)) { skipped.push({ name, reason: 'duplicate name' }); continue; }
    const src = { ...(typeof c.urls === 'object' && c.urls && !Array.isArray(c.urls) ? c.urls : {}) };
    if (!src.home && c.url) src.home = c.url;
    const urls = {}; const bad = [];
    for (const k of PAGE_KINDS) {
      if (src[k] == null || src[k] === '') continue;
      const u = publicUrl(src[k]);
      if (u) urls[k] = u; else bad.push(k);
    }
    if (bad.length) skipped.push({ name, reason: `invalid or non-public url: ${bad.join(', ')}` });
    if (!Object.keys(urls).length) { if (!bad.length) skipped.push({ name, reason: 'no urls' }); continue; }
    if (out.length >= max) { skipped.push({ name, reason: `over the ${max}-competitor limit` }); continue; }
    seen.add(id);
    out.push({ name, id, urls });
  }
  return { competitors: out, skipped };
}

// ── robots.txt ──────────────────────────────────────────────────────────────
// Pure: robots.txt text -> groups [{ agents: [...], rules: [{ allow, path }] }].
export function parseRobots(text) {
  const groups = []; let cur = null; let lastWasAgent = false;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = line.replace(/#.*$/, '').trim().match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(); const val = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      lastWasAgent = false;
      if (!cur) continue;
      if (key === 'disallow' && val === '') continue; // empty Disallow allows everything
      cur.rules.push({ allow: key === 'allow', path: val });
    } else lastWasAgent = false;
  }
  return groups;
}

const ruleRegex = (p) => {
  const end = p.endsWith('$'); const body = end ? p.slice(0, -1) : p;
  return new RegExp('^' + body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + (end ? '$' : ''));
};
// Pure: is this path (with query) allowed for our agent? Our own group wins over "*"; inside a group the
// longest matching rule wins and Allow wins a tie (RFC 9309).
export function robotsAllows(groups, pathWithQuery, ua = UA_TOKEN) {
  const own = groups.filter((g) => g.agents.some((a) => a && a !== '*' && a.split('/')[0].trim() === ua));
  const pick = own.length ? own : groups.filter((g) => g.agents.includes('*'));
  const rules = pick.flatMap((g) => g.rules);
  let best = null;
  for (const r of rules) {
    if (!r.path || !ruleRegex(r.path).test(pathWithQuery)) continue;
    const len = r.path.replace(/\*|\$$/g, '').length;
    if (!best || len > best.len || (len === best.len && r.allow && !best.allow)) best = { len, allow: r.allow };
  }
  return best ? best.allow : true;
}

// ── extraction ──────────────────────────────────────────────────────────────
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', pound: '£', yen: '¥', cent: '¢', copy: '©', reg: '®', trade: '™', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
export const decodeEntities = (s) => String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
  return ENT[e.toLowerCase()] ?? m;
});
const squash = (s) => s.replace(/[\s ​]+/g, ' ').trim();
const stripInvisible = (html) => String(html ?? '')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<(script|style|noscript|template|svg|head|iframe|canvas)\b[\s\S]*?<\/\1\s*>/gi, ' ');
const redact = (s) => s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]');
const inner = (s) => redact(squash(decodeEntities(s.replace(/<[^>]+>/g, ' '))));

// Pure: visible text of an HTML page (scripts, styles, comments and hidden blocks removed).
export function visibleText(html) {
  return squash(decodeEntities(stripInvisible(html).replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')));
}
export function pageTitle(html) {
  const m = String(html ?? '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return m ? inner(m[1]).slice(0, 200) : '';
}
export function headings(html, max = LIMITS.headings) {
  const out = [];
  for (const m of stripInvisible(html).matchAll(/<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)) {
    const t = inner(m[2]).slice(0, 160);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}
// Feature lines: short list items (plan feature lists, changelog bullets). Navigation-like one-word
// items and long paragraphs are left out.
export function featureLines(html, max = LIMITS.features) {
  const out = [];
  for (const m of stripInvisible(html).replace(/<(nav|footer|header)\b[\s\S]*?<\/\1\s*>/gi, ' ').matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi)) {
    const t = inner(m[1]);
    if (t.length < 4 || t.length > 140 || !/\s/.test(t)) continue;
    if (!out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

const SYM = { $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', 'US$': 'USD', 'A$': 'AUD', 'C$': 'CAD', 'CA$': 'CAD', 'AU$': 'AUD', 'NZ$': 'NZD', 'R$': 'BRL' };
const PERIOD = [
  [/^(\/|per\s*|a\s*)?\s*(mo|mon|month|monthly)\b/i, 'month'],
  [/^(\/|per\s*|a\s*)?\s*(yr|year|annum|annually|yearly)\b/i, 'year'],
  [/^(\/|per\s*|a\s*)?\s*(wk|week|weekly)\b/i, 'week'],
  [/^(\/|per\s*|a\s*)?\s*(day|daily)\b/i, 'day'],
  [/^(\/|per\s*|a\s*)?\s*(user|seat|member)\b/i, 'user'],
];
const PRICE_RE = /(US\$|CA\$|AU\$|NZ\$|R\$|A\$|C\$|[$€£¥₹])\s?(\d{1,3}(?:[,.]\d{3})+|\d+)(?:[.,](\d{1,2}))?(?!\d)|(\d{1,3}(?:[,.]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s?(USD|EUR|GBP|CAD|AUD|INR|JPY|€|£)\b/g;
const toNumber = (int, frac) => Number(String(int).replace(/[,.]/g, '') + (frac ? `.${frac}` : ''));
// The plan label just before a price ("Pro $29/mo" -> "Pro"): at most two words since the previous
// price, no numbers or period words, repeated words (heading then paragraph) collapsed, and a lowercase
// word before a capitalised one dropped ("pricing Enterprise" -> "Enterprise").
const labelBefore = (chunk) => {
  const words = chunk.replace(/[:;,()[\]|•·–—-]+/g, ' ').split(/\s+/).map((w) => w.replace(/^[.!?]+|[.!?]+$/g, '')).filter((w) => w && !/[\d$€£¥₹/]/.test(w));
  const dedup = words.filter((w, i) => i === 0 || w.toLowerCase() !== words[i - 1].toLowerCase());
  let last = dedup.slice(-2);
  if (last.length === 2 && /^[a-z]/.test(last[0]) && /^[A-Z]/.test(last[1])) last = last.slice(1);
  return last.join(' ').slice(0, 40);
};
// Pure: prices in visible text -> sorted, deduped [{ currency, amount, period, raw, context }].
export function extractPrices(text, max = LIMITS.prices) {
  const s = String(text ?? ''); const seen = new Map(); let lastEnd = 0;
  for (const m of s.matchAll(PRICE_RE)) {
    const cur = m[1] ? SYM[m[1]] : SYM[m[6]] ?? m[6];
    const amount = m[1] ? toNumber(m[2], m[3]) : toNumber(m[4], m[5]);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e7) continue;
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 24).trim();
    let period = 'once';
    for (const [re, p] of PERIOD) if (re.test(after)) { period = p; break; }
    const context = labelBefore(s.slice(Math.max(lastEnd, m.index - 48), m.index));
    lastEnd = m.index + m[0].length;
    const key = `${cur}|${amount}|${period}|${context}`;
    if (!seen.has(key)) seen.set(key, { currency: cur, amount, period, raw: squash(m[0]), context });
    if (seen.size >= max) break;
  }
  return [...seen.values()].sort((a, b) => a.currency.localeCompare(b.currency) || a.period.localeCompare(b.period) || a.amount - b.amount || a.context.localeCompare(b.context));
}

// Pure: html (or plain text) -> page snapshot body. The hash covers what a visitor sees, so markup-only
// changes (class names, tracking scripts) do not count as a change.
export function extractPage(body, contentType = 'text/html') {
  const isHtml = /html|xml/i.test(contentType) || /<html|<body|<h1|<div/i.test(String(body ?? '').slice(0, 2000));
  const text = isHtml ? visibleText(body) : squash(String(body ?? ''));
  return {
    title: isHtml ? pageTitle(body) : '',
    headings: isHtml ? headings(body) : [],
    features: isHtml ? featureLines(body) : [],
    prices: extractPrices(text),
    hash: sha256(text),
    chars: text.length,
    text: redact(text).slice(0, LIMITS.textChars),
  };
}

// ── diff ────────────────────────────────────────────────────────────────────
const priceKey = (p) => `${p.currency}|${p.amount}|${p.period}|${p.context}`;
const fmtPrice = (p) => `${p.currency} ${p.amount}${p.period === 'once' ? '' : `/${p.period}`}${p.context ? ` (${p.context})` : ''}`;
// Pure: previous and current page snapshot -> page diff. Prices that disappeared and appeared with the
// same currency, period and label are paired as changes (from -> to); the rest stay added / removed.
export function diffPage(prev, cur) {
  if (!cur || cur.status !== 'ok') return { status: cur?.status ?? 'missing', changed: false, error: cur?.error ?? null };
  const arr = (x) => (Array.isArray(x) ? x : []);
  cur = { ...cur, prices: arr(cur.prices), headings: arr(cur.headings), features: arr(cur.features) };
  if (!prev || prev.status !== 'ok') return { status: 'new', changed: false, first_seen: true, prices: cur.prices.map(fmtPrice) };
  if (prev.hash === cur.hash) return { status: 'same', changed: false };
  prev = { ...prev, prices: arr(prev.prices), headings: arr(prev.headings), features: arr(prev.features) };
  const pk = new Set(prev.prices.map(priceKey)); const ck = new Set(cur.prices.map(priceKey));
  let removed = prev.prices.filter((p) => !ck.has(priceKey(p)));
  let added = cur.prices.filter((p) => !pk.has(priceKey(p)));
  const changes = [];
  for (const r of [...removed]) {
    const i = added.findIndex((a) => a.currency === r.currency && a.period === r.period && a.context === r.context);
    if (i < 0) continue;
    const a = added[i];
    changes.push({ currency: r.currency, period: r.period, context: r.context, from: r.amount, to: a.amount, direction: a.amount > r.amount ? 'up' : 'down', pct: r.amount ? Math.round(((a.amount - r.amount) / r.amount) * 1000) / 10 : null });
    added = added.filter((_, j) => j !== i); removed = removed.filter((x) => x !== r);
  }
  const ph = new Set(prev.headings); const ch = new Set(cur.headings);
  const pf = new Set(prev.features); const cf = new Set(cur.features);
  const out = {
    status: 'changed', changed: true,
    title: prev.title !== cur.title ? { from: prev.title, to: cur.title } : null,
    price_changes: changes,
    prices_added: added.map(fmtPrice), prices_removed: removed.map(fmtPrice),
    headings_added: cur.headings.filter((h) => !ph.has(h)), headings_removed: prev.headings.filter((h) => !ch.has(h)),
    features_added: cur.features.filter((f) => !pf.has(f)), features_removed: prev.features.filter((f) => !cf.has(f)),
    chars: { from: prev.chars, to: cur.chars },
  };
  // Wording-only churn (dates, rotating quotes) is still "changed" but not substantive: no follow-up task.
  out.substantive = Boolean(out.title || ['price_changes', 'prices_added', 'prices_removed', 'headings_added', 'headings_removed', 'features_added', 'features_removed'].some((k) => out[k].length));
  return out;
}

// Pure: previous and current competitor snapshot -> competitor diff (null prev = first snapshot).
export function diffSnapshots(prev, cur) {
  const pages = {};
  for (const k of PAGE_KINDS) if (cur?.pages?.[k] || prev?.pages?.[k]) pages[k] = diffPage(prev?.pages?.[k], cur?.pages?.[k]);
  const all = Object.values(pages);
  const n = (f) => all.reduce((s, p) => s + (p[f]?.length ?? 0), 0);
  return {
    name: cur?.name ?? prev?.name, id: cur?.id ?? prev?.id, date: cur?.date ?? null, previous_date: prev?.date ?? null,
    first_snapshot: !prev, changed: all.some((p) => p.changed), substantive: all.some((p) => p.substantive),
    counts: { price_changes: n('price_changes'), prices_added: n('prices_added'), prices_removed: n('prices_removed'), headings_added: n('headings_added'), features_added: n('features_added'), features_removed: n('features_removed'), errors: all.filter((p) => ['error', 'blocked', 'skipped'].includes(p.status)).length },
    pages,
  };
}

// Pure: competitor diffs -> report (deterministic: competitors sorted by id, no timestamps besides date).
export function buildReport({ slug, date, diffs, skipped = [], requests = 0 }) {
  const sorted = [...diffs].sort((a, b) => a.id.localeCompare(b.id));
  const sum = (f) => sorted.reduce((s, d) => s + d.counts[f], 0);
  return {
    slug, date, generated_by: 'tools/competitor-watch.mjs', requests,
    totals: { competitors: sorted.length, changed: sorted.filter((d) => d.changed).length, first_snapshots: sorted.filter((d) => d.first_snapshot).length, price_changes: sum('price_changes'), prices_added: sum('prices_added'), prices_removed: sum('prices_removed'), headings_added: sum('headings_added'), features_added: sum('features_added'), errors: sum('errors') },
    skipped, competitors: sorted,
  };
}

export function reportMarkdown(r) {
  const L = [`# Competitor watch: ${r.slug}`, '', `Date ${r.date}. ${r.totals.competitors} competitors watched, ${r.totals.changed} changed, ${r.totals.price_changes} price changes, ${r.totals.errors} pages not read. Source: each competitor's own pages, fetched by tools/competitor-watch.mjs (robots.txt honoured). Verify a number on the live page before it goes into published copy.`, ''];
  for (const d of r.competitors) {
    L.push(`## ${d.name}${d.first_snapshot ? ' (first snapshot, nothing to compare yet)' : d.changed ? ` (changed since ${d.previous_date})` : ' (no change)'}`);
    for (const [k, p] of Object.entries(d.pages)) {
      if (p.status === 'same') { L.push(`- ${k}: no change`); continue; }
      if (p.status === 'new') { L.push(`- ${k}: first read${p.prices?.length ? `; prices seen: ${p.prices.join(', ')}` : ''}`); continue; }
      if (p.status !== 'changed') { L.push(`- ${k}: ${p.status}${p.error ? ` (${p.error})` : ''}`); continue; }
      L.push(`- ${k}: changed${p.substantive ? '' : ' (wording only: no price, heading, feature or title change)'}`);
      for (const c of p.price_changes) L.push(`  - Price ${c.direction}: ${c.currency} ${c.from} -> ${c.to}${c.period === 'once' ? '' : `/${c.period}`}${c.context ? ` (${c.context})` : ''}${c.pct != null ? `, ${c.pct > 0 ? '+' : ''}${c.pct}%` : ''}`);
      for (const x of p.prices_added) L.push(`  - New price: ${x}`);
      for (const x of p.prices_removed) L.push(`  - Price gone: ${x}`);
      if (p.title) L.push(`  - Title: "${p.title.from}" -> "${p.title.to}"`);
      for (const x of p.headings_added) L.push(`  - New heading: ${x}`);
      for (const x of p.features_added) L.push(`  - New feature line: ${x}`);
      for (const x of p.features_removed) L.push(`  - Feature line gone: ${x}`);
    }
    L.push('');
  }
  if (r.skipped.length) { L.push('## Skipped in the watch list'); for (const s of r.skipped) L.push(`- ${s.name || '(no name)'}: ${s.reason}`); L.push(''); }
  return L.join('\n');
}

// Pure: report -> runs/<task-id>.json body for apply-results. Read-only work: no approvals.
export function runResult(report, { taskId, agent = 'om-competitor-monitor', files = [] }) {
  const changed = report.competitors.filter((d) => d.changed && d.substantive);
  const priced = report.competitors.filter((d) => d.counts.price_changes || d.counts.prices_added || d.counts.prices_removed);
  return {
    task_id: taskId, agent, status: 'done', output: files,
    summary: `Competitor watch ${report.date}: ${report.totals.competitors} watched, ${report.totals.changed} changed, ${report.totals.price_changes} price changes, ${report.totals.errors} pages not read (${report.requests} requests).`,
    approvals: [], experiments: [],
    new_tasks: changed.length ? [{ title: `Battlecard and counter-move review for ${changed.map((d) => d.name).join(', ')}`, agent: 'om-competitor-monitor', brief: `Read research/competitor-diff.md (${report.date}) and update research/intel/ for each changed competitor, citing the snapshot file. Drafts only.`, depends_on: [taskId], priority: priced.length ? 'high' : 'normal' }] : [],
    alerts: priced.map((d) => ({ level: 'info', title: `${d.name} changed prices`, detail: `${d.counts.price_changes} changed, ${d.counts.prices_added} new, ${d.counts.prices_removed} gone (research/competitor-diff.md, ${report.date})` })),
  };
}

// ── crawling ────────────────────────────────────────────────────────────────
// One request per intervalMs across the whole run; sleep and now are injectable.
export function createThrottle({ intervalMs = LIMITS.intervalMs, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last = -Infinity;
  return async () => { const wait = last + intervalMs - now(); if (wait > 0) await sleep(wait); last = Math.max(now(), last + intervalMs); };
}

async function readBody(res, maxBytes) {
  const len = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(len) && len > maxBytes) throw new Error(`too large (${len} bytes)`);
  const reader = res.body?.getReader?.();
  if (!reader) {
    const text = await res.text();
    if (text.length > maxBytes) throw new Error(`too large (${text.length} chars)`);
    return text;
  }
  // Streamed: stop reading as soon as the cap is passed (a missing content-length cannot exhaust memory).
  const chunks = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > maxBytes) { try { await reader.cancel(); } catch {} throw new Error(`too large (over ${maxBytes} bytes)`); }
    chunks.push(Buffer.from(value));
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

// Crawler with per-origin robots cache, throttle and request cap.
export function createCrawler({ fetch: fetchFn = globalThis.fetch, sleep, now, intervalMs = LIMITS.intervalMs, maxRequests = LIMITS.requests, timeoutMs = LIMITS.timeoutMs, maxBytes = LIMITS.maxBytes, userAgent = USER_AGENT } = {}) {
  if (typeof fetchFn !== 'function') throw new Error('competitor-watch needs a fetch function');
  const throttle = createThrottle({ intervalMs, sleep, now });
  const robots = new Map(); let requests = 0;
  // One request. `consume(res)` runs inside the timeout, so a slow body is cut off too. fetch never
  // follows redirects itself: every hop is re-checked here (public host, robots.txt of the new origin).
  const get = async (url, consume) => {
    if (requests >= maxRequests) throw Object.assign(new Error(`request cap of ${maxRequests} reached`), { cap: true });
    await throttle(); requests++;
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const t = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
    try {
      const res = await fetchFn(url, { headers: { 'user-agent': userAgent, accept: 'text/html,text/plain;q=0.9,*/*;q=0.1' }, redirect: 'manual', signal: ac?.signal });
      return await consume(res);
    } finally { if (t) clearTimeout(t); }
  };
  const isRedirect = (res) => res.status >= 300 && res.status < 400 && res.status !== 304;
  const location = (res, base) => { const l = res.headers?.get?.('location'); if (!l) return null; try { return publicUrl(new URL(l, base).href); } catch { return null; } };
  const rulesFor = async (origin) => {
    if (robots.has(origin)) return robots.get(origin);
    let entry;
    try {
      let target = `${origin}/robots.txt`;
      for (let hop = 0; !entry; hop++) {
        const r = await get(target, async (res) => {
          if (isRedirect(res)) return { next: location(res, target) };
          if (res.status >= 200 && res.status < 300) return { entry: { groups: parseRobots(await readBody(res, 500_000)) } };
          if (res.status >= 500) return { entry: { blocked: `robots.txt answered ${res.status}` } };
          return { entry: { groups: [] } }; // 4xx: no rules (RFC 9309)
        });
        if (r.entry) entry = r.entry;
        else if (!r.next || hop >= 4) entry = { blocked: 'robots.txt redirect not followed' };
        else target = r.next;
      }
    } catch (e) { if (e.cap) throw e; entry = { blocked: `robots.txt unreadable: ${e.name === 'AbortError' ? 'timeout' : e.message}` }; }
    robots.set(origin, entry);
    return entry;
  };
  const page = async (url, maxHops = 5) => {
    let target = url;
    const at = () => (target !== url ? { final_url: target } : {});
    for (let hop = 0; hop <= maxHops; hop++) {
      const u = new URL(target);
      let rules;
      try { rules = await rulesFor(u.origin); } catch (e) { return { status: 'skipped', url, error: e.message }; }
      if (rules.blocked) return { status: 'blocked', url, ...at(), error: rules.blocked };
      if (!robotsAllows(rules.groups, u.pathname + u.search)) return { status: 'blocked', url, ...at(), error: 'disallowed by robots.txt' };
      let r;
      try {
        r = await get(target, async (res) => {
          if (isRedirect(res)) return { next: location(res, target), http: res.status };
          if (res.status < 200 || res.status >= 300) return { out: { status: 'error', url, ...at(), http: res.status, error: `HTTP ${res.status}` } };
          const type = res.headers?.get?.('content-type') ?? 'text/html';
          if (!/text\/html|application\/xhtml|text\/plain/i.test(type)) return { out: { status: 'error', url, ...at(), http: res.status, error: `unsupported content type ${type.split(';')[0]}` } };
          try { return { out: { status: 'ok', url, ...at(), http: res.status, ...extractPage(await readBody(res, maxBytes), type) } }; }
          catch (e) { if (e.name === 'AbortError') throw e; return { out: { status: 'error', url, ...at(), http: res.status, error: String(e.message).slice(0, 160) } }; }
        });
      } catch (e) { if (e.cap) return { status: 'skipped', url, error: e.message }; return { status: 'error', url, error: e.name === 'AbortError' ? 'timeout' : String(e.message).slice(0, 160) }; }
      if (r.out) return r.out;
      if (!r.next) return { status: 'blocked', url, ...at(), http: r.http, error: 'redirect to a missing or non-public url' };
      target = r.next;
    }
    return { status: 'error', url, error: `more than ${maxHops} redirects` };
  };
  return { page, get requests() { return requests; } };
}

// ── files ───────────────────────────────────────────────────────────────────
const snapDir = (ws, id) => path.join(ws, 'research', 'competitor-snapshots', id);
// Newest snapshot strictly before `date` (same-day re-runs compare against the day before).
export function previousSnapshot(ws, id, date) {
  const dir = snapDir(ws, id);
  if (!fs.existsSync(dir)) return null;
  const days = fs.readdirSync(dir).map((f) => f.match(/^(\d{4}-\d{2}-\d{2})\.json$/)?.[1]).filter((d) => d && d < date).sort();
  for (const d of days.reverse()) { // a corrupt newest file falls back to the next valid one
    const s = readJson(path.join(dir, `${d}.json`), null);
    if (s && typeof s === 'object' && s.pages && typeof s.pages === 'object') return s;
  }
  return null;
}

// Watch one product. Returns { report, files, skipped? }.
export async function watchProduct(slug, { rootDir = repoRoot, now = new Date().toISOString(), date, taskId, dryRun = false, fetch: fetchFn, sleep, clock, intervalMs, maxRequests, crawler } = {}) {
  if (!/^[a-z0-9][a-z0-9_-]{0,80}$/i.test(String(slug ?? '')) || slug === '_template') throw new Error(`invalid product slug: ${slug}`);
  const ws = path.join(rootDir, 'products', slug);
  if (!fs.existsSync(path.join(ws, 'product.json'))) throw new Error(`no product.json for ${slug}`);
  const product = readJson(path.join(ws, 'product.json'), {});
  if (product.stage === 'paused') return { skipped: 'paused', slug };
  const day = date ?? today(now);
  if (!isDate(day)) throw new Error(`invalid date: ${day}`);
  if (taskId != null && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(taskId)) throw new Error(`invalid task id: ${taskId}`);
  const listFile = path.join(ws, 'research', 'competitors.json');
  if (!fs.existsSync(listFile)) return { skipped: 'no watch list', slug, hint: 'write research/competitors.json: {"competitors":[{"name","urls":{"home","pricing","changelog"}}]}' };
  const raw = readJson(listFile, undefined);
  if (raw === undefined) throw new Error(`research/competitors.json in ${slug} is not valid JSON`);
  const { competitors, skipped } = normalizeWatchList(raw);
  const c = crawler ?? createCrawler({ fetch: fetchFn, sleep, now: clock, intervalMs, maxRequests });
  const diffs = []; const files = [];
  for (const comp of competitors) {
    const pages = {};
    for (const k of PAGE_KINDS) if (comp.urls[k]) pages[k] = await c.page(comp.urls[k]);
    const snap = { name: comp.name, id: comp.id, date: day, fetched_at: now, pages };
    const prev = previousSnapshot(ws, comp.id, day);
    diffs.push(diffSnapshots(prev, snap));
    if (!dryRun) {
      fs.mkdirSync(snapDir(ws, comp.id), { recursive: true });
      const f = path.join(snapDir(ws, comp.id), `${day}.json`);
      writeJson(f, snap); files.push(path.relative(ws, f).split(path.sep).join('/'));
    }
  }
  const report = buildReport({ slug, date: day, diffs, skipped, requests: c.requests });
  if (!dryRun) {
    writeJson(path.join(ws, 'research', 'competitor-diff.json'), report);
    fs.writeFileSync(path.join(ws, 'research', 'competitor-diff.md'), reportMarkdown(report));
    files.push('research/competitor-diff.json', 'research/competitor-diff.md');
    if (taskId) {
      fs.mkdirSync(path.join(ws, 'runs'), { recursive: true });
      writeJson(path.join(ws, 'runs', `${taskId}.json`), runResult(report, { taskId, files: [...files] }));
      files.push(`runs/${taskId}.json`);
    }
  }
  return { report, files };
}

// Every product with a watch list (one shared crawler, so the rate limit holds across products), then
// state/competitor-watch.json with counts only.
export async function watchAll({ rootDir = repoRoot, ...opts } = {}) {
  const dir = path.join(rootDir, 'products');
  const slugs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((s) => s !== '_template' && fs.existsSync(path.join(dir, s, 'research', 'competitors.json'))).sort() : [];
  const crawler = opts.crawler ?? createCrawler({ fetch: opts.fetch, sleep: opts.sleep, now: opts.clock, intervalMs: opts.intervalMs, maxRequests: opts.maxRequests });
  const products = [];
  for (const slug of slugs) {
    try {
      const r = await watchProduct(slug, { ...opts, rootDir, crawler, taskId: undefined });
      products.push(r.skipped ? { slug, skipped: r.skipped } : { slug, date: r.report.date, ...r.report.totals });
    } catch (e) { products.push({ slug, error: String(e.message).slice(0, 160) }); }
  }
  const out = { generated_at: opts.now ?? new Date().toISOString(), requests: crawler.requests, products };
  if (!opts.dryRun) { fs.mkdirSync(path.join(rootDir, 'state'), { recursive: true }); writeJson(path.join(rootDir, 'state', 'competitor-watch.json'), out); }
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const opts = { taskId: flag('--task'), date: flag('--date'), dryRun: argv.includes('--dry-run') };
  const slug = argv.find((a, i) => !a.startsWith('--') && !['--task', '--date'].includes(argv[i - 1]));
  const job = argv.includes('--all') ? watchAll(opts) : slug ? watchProduct(slug, opts).then((r) => (r.report ? { ...r.report.totals, slug, date: r.report.date, files: r.files } : r)) : Promise.reject(new Error('usage: node tools/competitor-watch.mjs <slug> [--task <id>] [--date YYYY-MM-DD] [--dry-run] | --all'));
  job.then((r) => console.log(JSON.stringify(r))).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
