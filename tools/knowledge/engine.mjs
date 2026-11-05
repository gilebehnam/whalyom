// Whalyom knowledge engine: keeps what every agent knows about digital marketing current.
//   refresh - fetch the official and research feeds in knowledge/sources.json into knowledge/inbox.jsonl
//   apply   - merge agent knowledge runs (knowledge/runs/*.json) into knowledge/base.json, after checks
//   check   - find stale facts, overdue sources and out-of-date briefs
//   brief   - write knowledge/briefs/<dept>.md, knowledge/BRIEFING.md and one generated skill per topic
//             (.claude/skills/om-knowledge-<topic>/SKILL.md), which every agent's skill library lists
// Single-writer rule, as for the product ledgers: agents never edit base.json; they write
// knowledge/runs/<run-id>.json and `apply` merges them. Nothing here uses an LLM.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { root, readJson } from '../lib/env.mjs';
import { TOPICS, TIERS, CONFIDENCE, KINDS, TARGET_FACTS, knowledgeSkill } from './topics.mjs';
import { DEPARTMENTS } from '../roster-extra.mjs';

export const K = (...p) => path.join(process.env.WHALYOM_KNOWLEDGE ?? path.join(root, 'knowledge'), ...p);
const SKILLS_DIR = () => process.env.WHALYOM_KNOWLEDGE_SKILLS ?? path.join(root, '.claude', 'skills');
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n'); };
const day = (iso) => String(iso).slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString();
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex');
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} %.$€£¥-]/gu, '').trim();

export const config = () => readJson(path.join(root, 'config', 'evolution.json'), {}).knowledge ?? {};
export const loadBase = () => readJson(K('base.json'), { version: 1, updated_at: null, facts: [] });
export const loadSources = () => readJson(K('sources.json'), { sources: [] }).sources;
export const statementHash = (f) => hash(norm(f.statement) + '|' + String(f.source_url).trim());
export const factId = (f) => `K-${statementHash(f).slice(0, 10)}`;
// Usable window shared by briefs and search: active or stale, and not more than one review period
// past review_by. Older facts drop out until re-verified.
const usableAt = (f, now) => (f.status === 'active' || f.status === 'stale') && Date.parse(f.review_by) + f.review_days * 86400000 > Date.parse(now);

// ── Feeds ────────────────────────────────────────────────────────────────────
const decode = (s) => String(s ?? '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[e]))
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ').trim();
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i')); return m ? m[1] : ''; };

// Parses RSS 2.0, RSS 1.0 (RDF) and Atom into {title, url, published, summary}.
export function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) ?? [];
  for (const b of blocks) {
    const atomLink = b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) ?? b.match(/<link[^>]*href=["']([^"']+)["']/i);
    const url = decode(tag(b, 'link')) || (atomLink ? atomLink[1] : '') || decode(tag(b, 'guid'));
    const dateRaw = decode(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
    const t = Date.parse(dateRaw);
    items.push({
      title: decode(tag(b, 'title')).slice(0, 300),
      url: url.trim(),
      published: Number.isNaN(t) ? null : new Date(t).toISOString(),
      summary: decode(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')).slice(0, 500),
    });
  }
  return items.filter((i) => i.title && /^https?:\/\//.test(i.url));
}

// Fetches due sources. opts: { now, only?, force?, fetcher?(url) -> {ok, status, text}, maxAgeDays? }
export async function refresh(opts = {}) {
  const now = opts.now ?? new Date().toISOString();
  const cfg = config();
  const maxAge = opts.maxAgeDays ?? cfg.max_item_age_days ?? 45;
  const fetcher = opts.fetcher ?? (async (url) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'WhalyomKnowledgeBot/1.0 (marketing knowledge refresh; respects feed cadence)', accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9' } });
      return { ok: r.ok, status: r.status, text: r.ok ? await r.text() : '' };
    } catch (e) { return { ok: false, status: 0, text: '', error: e.message }; } finally { clearTimeout(timer); }
  });
  const state = readJson(K('state.json'), { sources: {}, seen: [] });
  const seen = new Set(state.seen);
  const added = [];
  const report = [];
  for (const s of loadSources()) {
    if (s.enabled === false || (opts.only && s.id !== opts.only)) continue;
    const st = state.sources[s.id] ?? {};
    const due = opts.force || !st.last_fetch || Date.parse(now) - Date.parse(st.last_fetch) >= (s.cadence_hours ?? 24) * 3600000;
    if (!due) { report.push({ id: s.id, skipped: 'not due' }); continue; }
    const r = await fetcher(s.url);
    st.last_fetch = now;
    if (!r.ok) {
      st.failures = (st.failures ?? 0) + 1; st.last_error = r.error ?? `HTTP ${r.status}`;
      state.sources[s.id] = st; report.push({ id: s.id, ok: false, error: st.last_error }); continue;
    }
    st.failures = 0; st.last_ok = now; delete st.last_error;
    const kw = (s.keywords ?? []).map((k) => k.toLowerCase());
    let n = 0;
    for (const it of parseFeed(r.text)) {
      const id = `I-${hash(it.url).slice(0, 12)}`;
      if (seen.has(id)) continue;
      if (it.published && Date.parse(now) - Date.parse(it.published) > maxAge * 86400000) continue;
      if (kw.length && !kw.some((k) => `${it.title} ${it.summary}`.toLowerCase().includes(k))) continue;
      seen.add(id); n++;
      added.push({ id, source: s.id, tier: s.tier, topics: s.topics, ...it, fetched_at: now, status: 'new' });
    }
    st.last_new = n; state.sources[s.id] = st;
    report.push({ id: s.id, ok: true, new: n });
  }
  state.seen = [...seen].slice(-8000);
  state.last_refresh = now;
  if (!opts.dry) {
    const inbox = readInbox().concat(added);
    // Keep every unprocessed item and the newest 300 processed ones.
    const keep = inbox.filter((i) => i.status === 'new').concat(inbox.filter((i) => i.status !== 'new').slice(-300));
    write(K('inbox.jsonl'), keep.map((i) => JSON.stringify(i)).join('\n') + (keep.length ? '\n' : ''));
    write(K('state.json'), state);
  }
  return { at: now, new_items: added.length, sources: report };
}

export const readInbox = () => {
  try { return fs.readFileSync(K('inbox.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
};

// ── Facts ────────────────────────────────────────────────────────────────────
export function validateFact(f, now) {
  const e = [];
  if (!TOPICS[f.topic]) e.push(`unknown topic "${f.topic}"`);
  if (!f.statement || String(f.statement).length < 25) e.push('statement missing or too short');
  if (String(f.statement ?? '').length > 700) e.push('statement longer than 700 characters');
  if (!/^https:\/\/[^\s]+$/.test(f.source_url ?? '')) e.push('source_url must be an https URL');
  if (!TIERS.includes(f.source_tier)) e.push(`source_tier must be one of ${TIERS.join(', ')}`);
  if (f.source_tier === 'industry') e.push('industry sources may point to a fact but cannot be its only source');
  if (!CONFIDENCE.includes(f.confidence)) e.push('confidence must be high or medium');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.published ?? '')) e.push('published must be YYYY-MM-DD');
  else if (Date.parse(f.published) > Date.parse(now) + 86400000) e.push('published is in the future');
  if (f.review_days != null && !(Number(f.review_days) >= 7 && Number(f.review_days) <= 730)) e.push('review_days must be 7–730');
  if (f.kind != null && !KINDS.includes(f.kind)) e.push(`kind must be one of ${KINDS.join(', ')}`);
  return e;
}

// A verifier run is a separate run file written by om-fact-verifier whose `verifies` names the
// scout run. A run never verifies itself (same run_id or same file), and a scout run's own
// `agent` or `verdicts` fields count for nothing: only the separate verifier's verdicts do.
const verifierRuns = (run, runs) => runs.filter((r) => r !== run && r.file !== run.file && r.agent === 'om-fact-verifier'
  && run.run_id != null && r.verifies === run.run_id && r.run_id !== run.run_id);
const isVerified = (run, runs) => verifierRuns(run, runs).length > 0;
// A keep or fix verdict is bound to the fact it reviewed: it must carry statement_hash, the sha1 of
// the same input factId uses (statementHash(fact), or the K- fact id), so a fact edited or reordered
// after the verifier ran, or another run reusing the run_id, does not inherit the verdict.
const verdictMatches = (x, raw) => x.statement_hash != null && (x.statement_hash === statementHash(raw) || x.statement_hash === factId(raw));

// Merges runs into base.json. opts: { now, trust?: [run_ids], dry? }
export function apply(opts = {}) {
  const now = opts.now ?? new Date().toISOString();
  const cfg = config();
  const requireVerification = cfg.require_verification !== false;
  const dir = K('runs');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  const runs = files.map((f) => ({ file: f, ...readJson(path.join(dir, f), {}) }));
  const base = loadBase();
  const byId = new Map(base.facts.map((f) => [f.id, f]));
  const result = { at: now, added: [], updated: [], retired: [], superseded: [], rejected: [], waiting: [], processed: 0 };
  const verdictsFor = (run) => verifierRuns(run, runs).flatMap((r) => (Array.isArray(r.verdicts) ? r.verdicts : []));
  // Verdicts are found by run_id, so two runs sharing one run_id could take each other's verdicts:
  // hold every such run until the owner renames one.
  const isVerifier = (r) => r.verifies && r.verifies !== r.run_id;
  const idCount = new Map();
  for (const r of runs) if (!isVerifier(r) && r.run_id != null) idCount.set(r.run_id, (idCount.get(r.run_id) ?? 0) + 1);

  for (const run of runs) {
    if (isVerifier(run)) continue; // verifier runs are read with the run they verify
    if (idCount.get(run.run_id) > 1) { result.waiting.push(`${run.file}: duplicate run_id ${run.run_id}`); continue; }
    const trusted = (opts.trust ?? []).includes(run.run_id);
    if (requireVerification && !trusted && !isVerified(run, runs)) { result.waiting.push(run.run_id ?? run.file); continue; }
    const verdicts = verdictsFor(run);
    (run.facts ?? []).forEach((raw, index) => {
      // Default reject: a fact enters the base only with a 'keep' or 'fix' verdict from a separate
      // verifier run. Any 'reject' wins. The owner's --trust override (and require_verification: false)
      // keeps facts no verifier rejected.
      // A keep or fix counts only when its statement_hash matches this fact; a reject always counts.
      const mine = verdicts.filter((x) => x && x.index === index);
      const rejectedBy = mine.find((x) => x.verdict === 'reject');
      const bound = mine.filter((x) => verdictMatches(x, raw));
      const v = rejectedBy ?? bound.find((x) => x.verdict === 'fix') ?? bound.find((x) => x.verdict === 'keep');
      if (rejectedBy) { result.rejected.push({ run: run.run_id, index, reason: rejectedBy.reason ?? 'rejected by verifier', statement: raw.statement }); return; }
      if (!v && !trusted && requireVerification) {
        const reason = mine.some((x) => x.verdict === 'keep' || x.verdict === 'fix') ? 'verdict does not match fact' : 'no keep or fix verdict from a separate verifier run';
        result.rejected.push({ run: run.run_id, index, reason, statement: raw.statement }); return;
      }
      const f = { ...raw, ...(v?.confidence ? { confidence: v.confidence } : {}), ...(v?.verdict === 'fix' ? { statement: v.statement ?? raw.statement, published: v.published ?? raw.published } : {}) };
      const errors = validateFact(f, now);
      if (errors.length) { result.rejected.push({ run: run.run_id, index, reason: errors.join('; '), statement: f.statement }); return; }
      const id = factId(f);
      const reviewDays = Number(f.review_days ?? cfg.default_review_days ?? 90);
      const entry = {
        id, topic: f.topic, statement: String(f.statement).trim(), source_url: f.source_url, source_title: f.source_title ?? '',
        source_tier: f.source_tier, published: f.published, confidence: f.confidence, kind: f.kind ?? 'rule',
        affects: [...new Set(f.affects ?? [])].filter((a) => /^om-[a-z0-9-]+$/.test(a) && (!opts.agents || opts.agents.has(a))), tags: f.tags ?? [],
        verified_at: now, review_by: addDays(now, reviewDays), review_days: reviewDays, status: 'active',
        added_by: run.agent ?? 'unknown', run_id: run.run_id ?? run.file,
        ...(f.supersedes ? { supersedes: f.supersedes } : {}),
      };
      const old = byId.get(id);
      if (old && (old.status === 'superseded' || old.status === 'retired')) {
        // A superseded or retired fact stays so even when its old page still says it, unless the scout
        // asks to reinstate it and the verifier confirms (or the owner trusts the run).
        const confirmed = raw.reinstate === true && (v?.reinstate === true || trusted || !requireVerification);
        if (!confirmed) { result.rejected.push({ run: run.run_id, index, reason: `previously ${old.status}${old.superseded_by ? ' by ' + old.superseded_by : ''}`, statement: entry.statement }); return; }
        delete old.superseded_by; delete old.retired_at; delete old.retire_reason;
      }
      if (old) { Object.assign(old, { verified_at: now, review_by: entry.review_by, review_days: entry.review_days, status: 'active', confidence: entry.confidence }); result.updated.push(id); }
      else { byId.set(id, entry); base.facts.push(entry); result.added.push(id); }
      if (f.supersedes && byId.has(f.supersedes) && f.supersedes !== id) {
        Object.assign(byId.get(f.supersedes), { status: 'superseded', superseded_by: id, retired_at: now });
        result.superseded.push(f.supersedes);
      }
    });
    // Each retire needs its own verdict from the separate verifier ({retire: '<fact id>', verdict: 'keep'})
    // and no reject naming it, unless the owner trusts the run or verification is off.
    for (const r of run.retire ?? []) {
      const named = verdicts.filter((x) => x && x.retire != null && x.retire === r.id);
      const veto = named.find((x) => x.verdict === 'reject');
      const ok = !veto && (named.some((x) => x.verdict === 'keep') || trusted || !requireVerification);
      if (!ok) { result.rejected.push({ run: run.run_id, retire: r.id, reason: veto ? (veto.reason ?? 'retire rejected by verifier') : 'retire not confirmed by a separate verifier run' }); continue; }
      const old = byId.get(r.id);
      if (old && old.status !== 'retired') { Object.assign(old, { status: 'retired', retired_at: now, retire_reason: r.reason ?? '' }); result.retired.push(r.id); }
    }
    if (Array.isArray(run.processed) && run.processed.length && !opts.dry) {
      const done = new Set(run.processed);
      const inbox = readInbox().map((i) => (done.has(i.id) ? { ...i, status: 'processed' } : i));
      write(K('inbox.jsonl'), inbox.map((i) => JSON.stringify(i)).join('\n') + (inbox.length ? '\n' : ''));
    }
    result.processed++;
    if (!opts.dry) {
      for (const r of [run, ...runs.filter((x) => x.verifies === run.run_id)]) {
        const from = path.join(dir, r.file);
        if (fs.existsSync(from)) { fs.mkdirSync(path.join(dir, 'applied'), { recursive: true }); fs.renameSync(from, path.join(dir, 'applied', r.file)); }
      }
    }
  }
  if (!opts.dry && (result.added.length || result.updated.length || result.retired.length || result.superseded.length)) {
    base.updated_at = now;
    write(K('base.json'), base);
    const lines = [
      `## ${day(now)}`,
      ...result.added.map((id) => `- added ${id}: ${byId.get(id).statement.slice(0, 160)}`),
      ...result.superseded.map((id) => `- superseded ${id} by ${byId.get(id).superseded_by}`),
      ...result.retired.map((id) => `- retired ${id}`),
      result.updated.length ? `- re-verified ${result.updated.length} fact(s)` : null,
    ].filter(Boolean);
    const log = fs.existsSync(K('CHANGELOG.md')) ? fs.readFileSync(K('CHANGELOG.md'), 'utf8') : '# Knowledge changelog\n\nWhat Whalyom learned, newest first. Written by `node tools/knowledge.mjs apply`.\n';
    const [head, ...rest] = log.split(/\n(?=## )/);
    write(K('CHANGELOG.md'), [head.trimEnd(), lines.join('\n'), ...rest].join('\n\n') + '\n');
  }
  if (!opts.dry && result.rejected.length) fs.appendFileSync(K('rejected.jsonl'), result.rejected.map((r) => JSON.stringify({ at: now, ...r })).join('\n') + '\n');
  return result;
}

// ── Freshness ────────────────────────────────────────────────────────────────
export function check(opts = {}) {
  const now = opts.now ?? new Date().toISOString();
  const base = loadBase();
  const active = base.facts.filter((f) => f.status === 'active' || f.status === 'stale');
  const stale = active.filter((f) => Date.parse(f.review_by) < Date.parse(now));
  const state = readJson(K('state.json'), { sources: {} });
  // A feed never fetched yet (added after the last refresh) is pending its first fetch, not overdue.
  const pendingFirst = loadSources().filter((s) => s.enabled !== false && !state.sources[s.id]).map((s) => s.id);
  const overdue = loadSources().filter((s) => s.enabled !== false && state.sources[s.id]).filter((s) => {
    const st = state.sources[s.id];
    return !st?.last_ok || Date.parse(now) - Date.parse(st.last_ok) > 3 * (s.cadence_hours ?? 24) * 3600000;
  }).map((s) => ({ id: s.id, last_ok: state.sources[s.id]?.last_ok ?? null, last_error: state.sources[s.id]?.last_error ?? null }));
  const briefAt = readJson(K('briefs', 'index.json'), {}).built_at ?? null;
  const briefsOutdated = !briefAt || (base.updated_at && Date.parse(base.updated_at) > Date.parse(briefAt));
  const empty = Object.keys(TOPICS).filter((t) => !active.some((f) => f.topic === t && !stale.includes(f)));
  const counts = Object.fromEntries(Object.keys(TOPICS).map((t) => [t, active.filter((f) => f.topic === t && !stale.includes(f)).length]));
  const gaps = Object.entries(counts).filter(([, n]) => n < TARGET_FACTS).map(([t, n]) => ({ topic: t, facts: n, need: TARGET_FACTS - n })).sort((a, b) => a.facts - b.facts);
  const inboxNew = readInbox().filter((i) => i.status === 'new').length;
  if (opts.mark && stale.length) {
    for (const f of stale) f.status = 'stale';
    write(K('base.json'), base);
  }
  const ok = !stale.length && !briefsOutdated && overdue.length <= Math.ceil(loadSources().length / 4);
  return {
    at: now, ok, facts_active: active.length - stale.length, facts_stale: stale.length,
    stale: stale.map((f) => ({ id: f.id, topic: f.topic, review_by: day(f.review_by), statement: f.statement.slice(0, 120) })),
    sources_overdue: overdue, sources_pending_first_fetch: pendingFirst, briefs_outdated: !!briefsOutdated, topics_without_facts: empty, facts_by_topic: counts, gaps, inbox_new: inboxNew,
    last_refresh: state.last_refresh ?? null, knowledge_updated: base.updated_at,
  };
}

// ── Briefs and generated skills ──────────────────────────────────────────────
const line = (f, now) => {
  const due = Date.parse(f.review_by) < Date.parse(now);
  return `- **${f.statement}** (${f.published}; ${f.source_tier}, ${f.confidence}) [source](${f.source_url}) \`${f.id}\`${due ? ' — due for re-check' : ''}`;
};

// Large topics read better in sections: by source firm when facts carry a `firm:<name>` tag
// (the consulting canon), otherwise by kind once a topic holds more than 25 facts.
const FIRMS = { mckinsey: 'McKinsey', bcg: 'BCG', bain: 'Bain', deloitte: 'Deloitte', pwc: 'PwC / Strategy&', ey: 'EY', kpmg: 'KPMG', accenture: 'Accenture', hbr: 'Harvard Business Review', hbs: 'Harvard Business School' };
const FIRM_HOSTS = [[/mckinsey\.com/, 'mckinsey'], [/bcg\.com/, 'bcg'], [/bain\.com/, 'bain'], [/hbr\.org/, 'hbr'], [/hbs\.edu|harvard\.edu/, 'hbs'], [/deloitte\.com|cmosurvey\.org/, 'deloitte'], [/pwc\.com|strategy-business\.com|strategyand/, 'pwc'], [/ey\.com/, 'ey'], [/kpmg\./, 'kpmg'], [/accenture\.com/, 'accenture']];
const KIND_TITLES = { framework: 'Frameworks and methods', benchmark: 'Benchmarks', finding: 'Research findings', case: 'Cases', rule: 'Rules' };
const grouped = (ft, now) => {
  const firmOf = (f) => (f.tags ?? []).map((t) => /^firm:(.+)$/.exec(t)?.[1]).find(Boolean) ?? FIRM_HOSTS.find(([re]) => re.test(f.source_url))?.[1];
  const byFirm = ft.some(firmOf);
  if (!byFirm && ft.length <= 25) return ft.map((f) => line(f, now)).join('\n');
  const keyOf = byFirm ? (f) => firmOf(f) ?? 'other' : (f) => f.kind ?? 'rule';
  const order = byFirm ? [...Object.keys(FIRMS), 'other'] : Object.keys(KIND_TITLES);
  const titleOf = (k) => (byFirm ? FIRMS[k] ?? 'Other sources' : KIND_TITLES[k] ?? k);
  const keys = [...new Set(ft.map(keyOf))].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  const toc = keys.map((k) => `${titleOf(k)} (${ft.filter((f) => keyOf(f) === k).length})`).join(' · ');
  return `Sections: ${toc}\n\n` + keys.map((k) => `## ${titleOf(k)}\n\n${ft.filter((f) => keyOf(f) === k).map((f) => line(f, now)).join('\n')}`).join('\n\n');
};

export function brief(opts = {}) {
  const now = opts.now ?? new Date().toISOString();
  const cfg = config();
  const perDept = cfg.brief_facts_per_department ?? 30;
  const base = loadBase();
  // Facts more than one review period past their review date drop out of briefs until re-verified.
  const usable = base.facts.filter((f) => usableAt(f, now));
  const newest = (a, b) => b.published.localeCompare(a.published) || a.id.localeCompare(b.id);
  const agentDept = opts.agentDept ?? {};
  const header = (title) => `# ${title}\n\nGenerated ${day(now)} by \`node tools/knowledge.mjs brief\` from knowledge/base.json (${usable.length} usable verified facts). Do not edit: change the knowledge base instead. Newer rules here beat older playbook rules; if a rule here conflicts with what you were going to do, follow the rule and say so in your summary.\n`;
  const written = [];
  for (const [dept, d] of Object.entries(DEPARTMENTS)) {
    const topics = Object.keys(TOPICS).filter((t) => TOPICS[t].depts.includes(dept));
    const facts = usable.filter((f) => topics.includes(f.topic) || f.affects.some((a) => agentDept[a] === dept)).sort(newest).slice(0, perDept);
    const body = [header(`${d.name}: what is true now`)];
    for (const t of topics) {
      const ft = facts.filter((f) => f.topic === t);
      body.push(`## ${TOPICS[t].title}\n\n${ft.length ? ft.map((f) => line(f, now)).join('\n') : '_No verified facts yet. Check the official source before relying on memory._'}\n`);
    }
    const cross = facts.filter((f) => !topics.includes(f.topic));
    if (cross.length) body.push(`## From other topics that affect this department\n\n${cross.map((f) => line(f, now)).join('\n')}\n`);
    write(K('briefs', `${dept}.md`), body.join('\n'));
    written.push(`knowledge/briefs/${dept}.md`);
  }
  const recent = usable.filter((f) => Date.parse(now) - Date.parse(f.verified_at) <= 30 * 86400000 || Date.parse(now) - Date.parse(f.published) <= 60 * 86400000).sort(newest).slice(0, 40);
  write(K('BRIEFING.md'), [header('Whalyom briefing: what changed in digital marketing'),
    `## Newest (${recent.length})\n\n${recent.length ? recent.map((f) => `- [${f.topic}] ${line(f, now).slice(2)}`).join('\n') : '_Nothing new in the last 60 days._'}\n`,
    `## By topic\n\n${Object.entries(TOPICS).map(([t, v]) => `- ${v.title}: ${usable.filter((f) => f.topic === t).length} fact(s), skill \`${knowledgeSkill(t)}\``).join('\n')}\n`].join('\n'));
  written.push('knowledge/BRIEFING.md');
  for (const [t, v] of Object.entries(TOPICS)) {
    const ft = usable.filter((f) => f.topic === t).sort(newest);
    const dir = path.join(SKILLS_DIR(), knowledgeSkill(t));
    write(path.join(dir, 'SKILL.md'), `---
name: ${knowledgeSkill(t)}
description: "Current, verified facts about ${v.title.toLowerCase()} (${ft.length} fact(s), updated ${day(now)}). Use before planning or writing anything that depends on ${v.title.toLowerCase()}, to apply today's platform rules, laws and research instead of remembered ones."
---

# ${v.title}: current knowledge

Generated ${day(now)} by \`node tools/knowledge.mjs brief\` from the Whalyom knowledge base. Every line was checked against its source page; the date is when the source published it. Do not edit this file.

How to use it:
1. Apply these rules over anything you remember about ${v.title.toLowerCase()}; your training may be older than they are.
2. A line marked "due for re-check" may have changed: open its source before relying on it.
3. When you notice something new or contradicting that is not here, put it in your result summary so the knowledge scouts can verify it.

${ft.length ? grouped(ft, now) : '_No verified facts yet. Check the official source before relying on memory._'}
`);
    written.push(`.claude/skills/${knowledgeSkill(t)}/SKILL.md`);
  }
  write(K('briefs', 'index.json'), { built_at: now, facts: usable.length, files: written });
  return { at: now, facts: usable.length, files: written.length };
}

// Facts added or re-verified since `since` that affect agents a product uses: the knowledge
// impact the refresh workflow turns into owner alerts.
export function impactSince(since) {
  return loadBase().facts.filter((f) => f.status === 'active' && Date.parse(f.verified_at) >= Date.parse(since));
}

// Keyword search over the usable knowledge base, for agents and the CLI (`knowledge.mjs search`).
// Each query word found in a fact's statement scores 2, in its tags, source title or topic 1;
// high confidence breaks ties, then active beats stale, then the newer source wins. Uses the same
// usable window as brief(); a fact past review_by comes back with due_for_recheck.
export function search(query, opts = {}) {
  const now = opts.now ?? new Date().toISOString();
  const words = String(query).toLowerCase().split(/[^\p{L}\p{N}%$-]+/u).filter((w) => w.length > 2);
  if (!words.length) return [];
  const facts = loadBase().facts.filter((f) => usableAt(f, now) && (!opts.topic || f.topic === opts.topic));
  const scored = facts.map((f) => {
    const body = f.statement.toLowerCase();
    const meta = `${(f.tags ?? []).join(' ')} ${f.source_title ?? ''} ${f.topic}`.toLowerCase();
    const score = words.reduce((s, w) => s + (body.includes(w) ? 2 : 0) + (meta.includes(w) ? 1 : 0), 0);
    return { f, score: score + (f.confidence === 'high' ? 0.5 : 0) };
  }).filter((x) => x.score >= 2);
  const rank = (f) => (f.status === 'active' ? 0 : 1);
  scored.sort((a, b) => b.score - a.score || rank(a.f) - rank(b.f) || b.f.published.localeCompare(a.f.published));
  return scored.slice(0, opts.limit ?? 10).map(({ f }) => ({
    id: f.id, topic: f.topic, kind: f.kind, statement: f.statement, source_url: f.source_url, published: f.published, confidence: f.confidence,
    status: f.status, review_by: day(f.review_by), ...(Date.parse(f.review_by) < Date.parse(now) ? { due_for_recheck: true } : {}),
  }));
}
