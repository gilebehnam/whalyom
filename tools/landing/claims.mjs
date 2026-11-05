// Claims guard for landing pages. claims.md is the only source of facts a page may state.
// Every copy unit in brief.json cites the claim ids it relies on (`claims: ["C2"]`). A unit passes when:
//   1. every cited id exists in claims.md and is marked `verified`;
//   2. every number in its copy appears in the text of the claims it cites (no invented numbers);
//   3. every risky phrase (social proof, superlatives, guarantees, speed promises) appears in the
//      text of the claims it cites (no invented testimonials, ratings, "best", "in minutes"...).
// Units that fail are dropped and reported; the builder never "fixes" copy by guessing.

export function parseClaims(md = '') {
  const claims = [];
  for (const line of String(md).split(/\r?\n/)) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 5) continue;
    const [, id, text, status, source] = cells;
    if (!/^[A-Za-z]+[-_]?\d+$/.test(id ?? '') || !text) continue;
    claims.push({ id, text, status: (status ?? '').toLowerCase(), source: source ?? '' });
  }
  return claims;
}

export const verifiedOnly = (claims) => claims.filter((c) => c.status === 'verified');

// Phrases that need explicit backing in a cited claim. Kept broad on purpose.
export const RISKY = /★|#\s?1\b|\b(best|number one|fastest|leading|top[- ]rated|award[- ]winning|guarantee[sd]?|trusted by|loved by|used by|join (?:thousands|hundreds|millions)|customers?|reviews?|rated|ratings?|testimonials?|case stud(?:y|ies)|world[- ]class|revolutionary|instant(?:ly)?|in (?:minutes|seconds)|unlimited|no credit card|risk[- ]free|money[- ]back|certified|compliant|secure|official)\b/gi;

const numbersIn = (s) => (String(s).match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, '').replace(/\.0+$/, ''));

// Keys whose values are never shown as copy (links, ids, internal notes for agents).
export const NON_COPY = new Set(['claims', 'href', 'id', 'icon', 'kind', 'source', 'action', 'mailto', 'type', 'form_id', 'metric', 'hypothesis', 'note', 'notes', 'url', 'canonical', 'base_url', 'lang', 'template', 'path', 'og_image', 'privacy_url', 'terms_url', 'schema_type', 'currency', 'price_value', 'min_sample', 'highlight', 'noindex', 'required', 'consent_required', 'fields', 'order', 'sections', 'variants', 'version', 'theme']);

// Collects the copy strings of one unit: its own string fields and strings in plain arrays.
// Nested objects are separate units and are checked on their own.
export function copyOf(unit) {
  const out = [];
  for (const [k, v] of Object.entries(unit ?? {})) {
    if (NON_COPY.has(k) || k.startsWith('_')) continue;
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') out.push(x);
  }
  return out;
}

export function makeGuard(claims, { allowNumbersFrom = '' } = {}) {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const freeNumbers = new Set(numbersIn(allowNumbersFrom));
  // Checks a unit; `extraText` lets a unit be checked as if it held more copy (e.g. a variant's CTA).
  return function check(unit, where) {
    const issues = [];
    const cited = Array.isArray(unit?.claims) ? unit.claims : [];
    for (const id of cited) {
      const c = byId.get(id);
      if (!c) issues.push({ where, rule: 'unknown-claim', detail: `${id} is not in claims.md` });
      else if (c.status !== 'verified') issues.push({ where, rule: 'unverified-claim', detail: `${id} is "${c.status}", not verified` });
    }
    const backing = cited.map((id) => byId.get(id)).filter((c) => c?.status === 'verified').map((c) => c.text).join(' \n ');
    const backNums = new Set(numbersIn(backing));
    const backLower = backing.toLowerCase();
    for (const text of copyOf(unit)) {
      for (const n of numbersIn(text)) if (!backNums.has(n) && !freeNumbers.has(n)) issues.push({ where, rule: 'number-not-in-claims', detail: `"${n}" in "${text}" is not in the cited verified claims (${cited.join(', ') || 'none cited'})` });
      for (const m of text.matchAll(RISKY)) if (!backLower.includes(m[0].toLowerCase())) issues.push({ where, rule: 'unbacked-phrase', detail: `"${m[0]}" in "${text}" needs a verified claim that says it` });
    }
    return issues;
  };
}
