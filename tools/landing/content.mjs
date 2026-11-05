// Turns a product workspace into a checked content model for the templates.
// Inputs: product.json, claims.md, profile.md (voice/positioning, read for the summary only),
// optional landing/brief.json (written by om-landing-builder, om-cro, om-personalizer) and
// optional connection.json (satellite URL when a site is attached).
import fs from 'node:fs';
import path from 'node:path';
import { parseClaims, verifiedOnly, makeGuard } from './claims.mjs';

export const SECTION_ORDER = ['hero', 'problem', 'solution', 'features', 'how_it_works', 'social_proof', 'comparison', 'pricing', 'guarantee', 'faq', 'final_cta', 'lead_form'];
const PRICE_RE = /(\$|€|£|\bprice|\bplan\b|\btrial\b|\/\s?month|per month|per year|\/\s?year)/i;

const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const readJsonSafe = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const clone = (v) => JSON.parse(JSON.stringify(v ?? null));

export function loadWorkspace(dir) {
  const product = readJsonSafe(path.join(dir, 'product.json'), null);
  if (!product) throw new Error(`no product.json in ${dir}`);
  const briefFile = path.join(dir, 'landing', 'brief.json');
  const briefRaw = fs.existsSync(briefFile) ? readText(briefFile) : null;
  let brief = null;
  if (briefRaw != null) { try { brief = JSON.parse(briefRaw); } catch (e) { throw new Error(`landing/brief.json is not valid JSON: ${e.message}`); } }
  return {
    dir,
    slug: product.slug ?? path.basename(dir),
    product,
    claims: parseClaims(readText(path.join(dir, 'claims.md'))),
    profile: readText(path.join(dir, 'profile.md')),
    brief,
    connection: readJsonSafe(path.join(dir, 'connection.json'), null),
  };
}

// Display name: "Quoteflow (sample)" → "Quoteflow". The preview banner keeps the sample status visible.
export const brandOf = (ws) => ws.brief?.page?.brand ?? String(ws.product.name ?? ws.slug).replace(/\s*\([^)]*\)\s*/g, ' ').trim();

// With no brief.json the page is built from verified claims only, in plain wording.
export function deriveBrief(ws) {
  const v = verifiedOnly(ws.claims);
  const pricing = v.filter((c) => PRICE_RE.test(c.text));
  const rest = v.filter((c) => !PRICE_RE.test(c.text));
  const [lead, ...features] = rest;
  return {
    derived: true,
    page: {},
    hero: { headline: brandOf(ws), subhead: lead?.text ?? '', claims: lead ? [lead.id] : [], cta: { label: 'Get started', href: '#lead' } },
    features: features.length ? { title: 'What you get', items: features.map((c) => ({ body: c.text, claims: [c.id] })) } : undefined,
    pricing: pricing.length ? { title: 'Pricing', items: pricing.map((c) => ({ body: c.text, claims: [c.id] })) } : undefined,
    final_cta: { headline: `Try ${brandOf(ws)}`, cta: { label: 'Get started', href: '#lead' } },
    lead_form: {},
  };
}

// Walks the brief, checks every copy unit with the claims guard and drops the ones that fail.
// Returns the cleaned brief and the list of issues (what was dropped and why).
export function enforceClaims(brief, ws) {
  const guard = makeGuard(ws.claims, { allowNumbersFrom: `${ws.product.name ?? ''} ${brief?.page?.brand ?? ''}` });
  const issues = [];
  const dropped = [];
  const walk = (node, where) => {
    if (Array.isArray(node)) {
      return node.map((x, i) => walk(x, `${where}[${i}]`)).filter((x) => x !== undefined);
    }
    if (!node || typeof node !== 'object') return node;
    const found = guard(node, where);
    if (found.length) { issues.push(...found); dropped.push(where); return undefined; }
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'variants') { out[k] = v; continue; } // variants are checked when applied
      const w = walk(v, `${where}.${k}`);
      if (w !== undefined) out[k] = w;
    }
    return out;
  };
  const clean = walk(clone(brief), 'brief') ?? {};
  return { brief: clean, issues, dropped };
}

// Merges a variant (alternate hero / CTA copy) over the control brief, after checking it.
export function applyVariant(brief, ws, variantId) {
  if (!variantId || variantId === 'control') return { brief, variant: null, issues: [] };
  const variant = (brief.variants ?? []).find((x) => x.id === variantId);
  if (!variant) throw new Error(`variant "${variantId}" is not in landing/brief.json (have: ${(brief.variants ?? []).map((x) => x.id).join(', ') || 'none'})`);
  const { brief: checked, issues } = enforceClaims({ hero: variant.hero, cta: variant.cta, final_cta: variant.final_cta }, ws);
  const out = clone(brief);
  if (checked.hero) out.hero = { ...out.hero, ...checked.hero, cta: { ...(out.hero?.cta ?? {}), ...(checked.hero.cta ?? {}) } };
  if (checked.cta) {
    out.hero = { ...out.hero, cta: { ...(out.hero?.cta ?? {}), ...checked.cta } };
    if (out.final_cta) out.final_cta = { ...out.final_cta, cta: { ...(out.final_cta.cta ?? {}), ...checked.cta } };
  }
  if (checked.final_cta) out.final_cta = { ...out.final_cta, ...checked.final_cta };
  return { brief: out, variant: { id: variant.id, name: variant.name ?? variant.id, hypothesis: variant.hypothesis ?? '', metric: variant.metric ?? brief.experiment?.metric ?? 'lead_submit_rate' }, issues };
}

// Where the lead form sends its data.
export function leadTarget(ws, brief) {
  const lf = brief.lead_form ?? {};
  const sat = ws.connection?.satellite;
  if (lf.action) return { mode: 'action', endpoint: lf.action, satellite: sat ? `${sat.replace(/\/$/, '')}/collect` : null };
  if (sat) return { mode: 'satellite', endpoint: `${sat.replace(/\/$/, '')}/collect`, satellite: `${sat.replace(/\/$/, '')}/collect`, snippet: `${sat.replace(/\/$/, '')}/whalyom.js` };
  if (lf.mailto) return { mode: 'mailto', mailto: lf.mailto };
  return { mode: 'none' };
}

export function buildModel(ws, { variant } = {}) {
  const raw = ws.brief ?? deriveBrief(ws);
  const { brief: clean, issues, dropped } = enforceClaims(raw, ws);
  if (raw.variants) clean.variants = raw.variants;
  const v = applyVariant(clean, ws, variant);
  const b = v.brief;
  // A hero must exist; fall back to the brand name when its copy was dropped.
  b.hero = b.hero ?? {};
  if (!b.hero.headline) b.hero.headline = brandOf(ws);
  if (!b.hero.cta) b.hero.cta = { label: 'Get started', href: '#lead' };
  if (!b.lead_form) b.lead_form = {};
  const order = (Array.isArray(raw.sections) && raw.sections.length ? raw.sections : SECTION_ORDER).filter((s) => SECTION_ORDER.includes(s));
  return {
    ws, brand: brandOf(ws), brief: b, order, variant: v.variant,
    derived: Boolean(raw.derived),
    issues: [...issues, ...v.issues], dropped,
    lead: leadTarget(ws, b),
    verified: verifiedOnly(ws.claims),
    preview: ws.product.stage !== 'active',
  };
}
