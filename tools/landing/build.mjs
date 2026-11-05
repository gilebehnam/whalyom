// Landing page builder core: workspace → checked content → static HTML per template and variant.
// Output: <out>/<template>/index.html (control) and <out>/<template>/<variant>/index.html,
// each folder with sitemap.xml, llms.txt and build.json; plus landing/variants.json for
// om-bandit-cro / om-experiment-manager (proposals only — experiments.json is never written here).
import fs from 'node:fs';
import path from 'node:path';
import { loadWorkspace, buildModel } from './content.mjs';
import { SECTIONS, esc } from './sections.mjs';
import { TEMPLATES, TEMPLATE_NAMES, baseCss, treeline } from './templates.mjs';
import { pageUrls, jsonLd, headTags, sitemapXml, llmsTxt, jsonForScript } from './seo.mjs';

const ICON = (accent, ink) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${accent}"/><path d="M16 40c8-14 24-14 32 0" fill="none" stroke="${ink}" stroke-width="6" stroke-linecap="round"/></svg>`)}`;

// Client script: UTM capture and pass-through, lead submit by mode. Small and dependency-free.
const SCRIPT = `(function(){var c=JSON.parse(document.getElementById('wy-cfg').textContent),K=['utm_source','utm_medium','utm_campaign','utm_term','utm_content'],u={},q;
try{u=JSON.parse(sessionStorage.getItem('wy_utm')||'{}')||{}}catch(e){}
try{q=new URLSearchParams(location.search);K.forEach(function(k){var v=q.get(k);if(v)u[k]=v.slice(0,120)});sessionStorage.setItem('wy_utm',JSON.stringify(u))}catch(e){}
document.querySelectorAll('a[data-keep-utm]').forEach(function(a){try{var x=new URL(a.href);K.forEach(function(k){if(u[k]&&!x.searchParams.has(k))x.searchParams.set(k,u[k])});a.href=x.toString()}catch(e){}});
var f=document.getElementById('lead-form');if(!f)return;var s=f.querySelector('.wy-status');
K.forEach(function(k){var i=f.querySelector('input[name="'+k+'"]');if(i)i.value=u[k]||''});
f.addEventListener('submit',function(ev){var d={};new FormData(f).forEach(function(v,k){d[k]=String(v)});
if(c.mode==='action'){if(c.satellite)try{navigator.sendBeacon(c.satellite,JSON.stringify({type:'lead',form:c.form,path:location.pathname,ref:document.referrer,utm:{source:u.utm_source||'',medium:u.utm_medium||'',campaign:u.utm_campaign||''},variant:c.variant}))}catch(e){}return}
ev.preventDefault();
if(c.mode==='satellite'){var b=f.querySelector('button');b.disabled=true;s.textContent=c.sending;
fetch(c.endpoint,{method:'POST',headers:{'content-type':'text/plain'},keepalive:true,body:JSON.stringify({type:'lead',form:c.form,variant:c.variant,path:location.pathname,ref:document.referrer,utm:{source:u.utm_source||'',medium:u.utm_medium||'',campaign:u.utm_campaign||'',term:u.utm_term||'',content:u.utm_content||''},email:d.email||'',name:d.name||'',company:d.company||'',consent:d.consent==='yes',ts:Date.now()})}).then(function(r){s.textContent=r.ok?c.thanks:c.error;if(r.ok)f.reset()}).catch(function(){s.textContent=c.error}).then(function(){b.disabled=false});return}
if(c.mode==='mailto'){location.href='mailto:'+c.mailto+'?subject='+encodeURIComponent(c.subject)+'&body='+encodeURIComponent('Email: '+(d.email||'')+'\\nName: '+(d.name||'')+'\\nSource: '+(u.utm_source||'direct')+' / '+(u.utm_campaign||'')+'\\nConsent: '+(d.consent==='yes'?'yes':'no'));return}
s.textContent=c.noop});})();`;

export function renderPage(model, templateName, { clean = false } = {}) {
  const t = TEMPLATES[templateName];
  if (!t) throw new Error(`unknown template "${templateName}" (have: ${TEMPLATE_NAMES.join(', ')})`);
  const variantId = model.variant?.id ?? 'control';
  const urls = pageUrls(model, templateName, variantId);
  const ctx = { template: t, templateName, brief: model.brief, brand: model.brand, lead: model.lead, placeholders: [], clean, variantId, trees: t.hero === 'poster' ? treeline() : '' };
  const body = model.order.map((key) => {
    const data = model.brief[key];
    if (data == null && !['social_proof', 'guarantee', 'lead_form'].includes(key)) return '';
    return SECTIONS[key](data ?? {}, { ...ctx, id: key.replace(/_/g, '-') });
  }).filter(Boolean).join('\n');
  // placeholders were pushed into ctx copies' shared array
  const title = model.brief.page?.title ?? `${model.brand}${model.brief.hero?.headline && model.brief.hero.headline !== model.brand ? ` — ${model.brief.hero.headline}` : ''}`;
  const description = model.brief.page?.description ?? model.brief.hero?.subhead ?? title;
  const noindex = Boolean(model.brief.page?.noindex ?? model.preview);
  const ld = jsonLd(model, urls);
  const nav = [['features', 'Features'], ['how_it_works', 'How it works'], ['pricing', 'Pricing'], ['faq', 'FAQ']].filter(([k]) => body.includes(`id="${k.replace(/_/g, '-')}"`));
  const cfg = { mode: model.lead.mode, endpoint: model.lead.endpoint ?? null, satellite: model.lead.satellite ?? null, mailto: model.lead.mailto ?? null, form: model.brief.lead_form?.form_id ?? 'lead', variant: variantId,
    subject: `${model.brand}: ${model.brief.lead_form?.title ?? 'request'}`, thanks: model.brief.lead_form?.thanks ?? 'Thanks — check your inbox.', error: 'Something went wrong. Please try again.', sending: 'Sending…',
    noop: 'Preview only: this form is not connected, so nothing was sent.' };
  const tk = t.tokens;
  const html = `<!doctype html>
<html lang="${esc(model.brief.page?.lang ?? model.ws.product.language ?? 'en')}" data-template="${templateName}" data-variant="${esc(variantId)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${headTags(model, urls, { title, description, fonts: t.fonts, noindex, variantId })}
<meta name="theme-color" content="${tk.bg}">
<link rel="icon" href="${ICON(tk.accent, tk.accentInk)}">
<style>${baseCss()}${t.css}</style>
<script type="application/ld+json">${jsonForScript(ld)}</script>
${model.lead.snippet ? `<script async src="${esc(model.lead.snippet)}"></script>` : ''}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${model.preview && !clean ? `<div class="preview-bar" role="note">Preview build of ${esc(model.ws.product.name ?? model.brand)} — not live${noindex ? ', not indexed' : ''}.</div>` : ''}
<header class="site-head"><div class="wrap"><a class="brand" href="#main">${esc(model.brand)}</a><nav class="site-nav" aria-label="Page sections">${nav.map(([k, l]) => `<a href="#${k.replace(/_/g, '-')}">${l}</a>`).join('')}</nav>${model.brief.hero?.cta?.label ? `<a class="btn small head-cta" href="${esc(model.brief.hero.cta.href ?? '#lead')}">${esc(model.brief.hero.cta.label)}</a>` : ''}</div></header>
<main id="main" tabindex="-1">
${body}
</main>
<footer class="site-foot"><div class="wrap"><span class="brand">${esc(model.brand)}</span>${model.brief.page?.privacy_url ? `<a href="${esc(model.brief.page.privacy_url)}">Privacy</a>` : ''}${model.brief.page?.terms_url ? `<a href="${esc(model.brief.page.terms_url)}">Terms</a>` : ''}<span>© ${new Date().getFullYear()} ${esc(model.brand)}</span></div></footer>
<script type="application/json" id="wy-cfg">${jsonForScript(cfg)}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
  return { html, urls, placeholders: ctx.placeholders, jsonld: ld, noindex };
}

// Claims the page actually cites, for the llms.txt facts list and the build report.
function citedClaims(model) {
  const ids = new Set();
  const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === 'object') { for (const id of n.claims ?? []) ids.add(id); for (const [k, v] of Object.entries(n)) if (k !== 'variants') walk(v); } };
  walk(model.brief);
  return model.verified.filter((c) => ids.has(c.id));
}

export function buildLanding({ dir, template, variant, out, clean = false, task } = {}) {
  const ws = loadWorkspace(dir);
  const outDir = out ? path.resolve(out) : path.join(dir, 'landing', 'dist');
  const templates = !template || template === 'all' ? (ws.brief?.page?.templates ?? (ws.brief?.page?.template ? [ws.brief.page.template] : TEMPLATE_NAMES)) : String(template).split(',');
  const variantIds = variant === 'all' ? ['control', ...(ws.brief?.variants ?? []).map((v) => v.id)] : variant ? ['control', ...String(variant).split(',').filter((v) => v !== 'control')] : ['control'];
  const pages = [];
  let issues = [];
  for (const name of templates) {
    for (const vid of variantIds) {
      const model = buildModel(ws, { variant: vid });
      const r = renderPage(model, name, { clean });
      const folder = vid === 'control' ? path.join(outDir, name) : path.join(outDir, name, vid);
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, 'index.html'), r.html);
      const cited = citedClaims(model);
      if (vid === 'control') {
        fs.writeFileSync(path.join(folder, 'sitemap.xml'), sitemapXml(r.urls));
        fs.writeFileSync(path.join(folder, 'llms.txt'), llmsTxt(model, r.urls, cited));
      }
      const info = { template: name, variant: vid, file: path.relative(dir, path.join(folder, 'index.html')).replace(/\\/g, '/'), url: r.urls.self, canonical: r.urls.canonical, noindex: r.noindex, bytes: Buffer.byteLength(r.html), headline: model.brief.hero?.headline, cta: model.brief.hero?.cta?.label, claims_cited: cited.map((c) => c.id), placeholders: r.placeholders.map((p) => p.key), lead_mode: model.lead.mode, derived: model.derived };
      fs.writeFileSync(path.join(folder, 'build.json'), JSON.stringify({ ...info, issues: [...model.issues] }, null, 2));
      pages.push(info);
      issues = issues.concat(model.issues.map((i) => ({ ...i, variant: vid })));
    }
  }
  // de-duplicate issues found once per template
  const seen = new Set();
  issues = issues.filter((i) => { const k = `${i.variant}|${i.where}|${i.rule}|${i.detail}`; if (seen.has(k)) return false; seen.add(k); return true; });

  let variantsFile = null;
  if (variantIds.length > 1) variantsFile = writeVariants(ws, pages);
  let runFile = null;
  if (task) runFile = writeRun(ws, task, pages, issues, variantsFile);
  return { slug: ws.slug, out: outDir, templates, variants: variantIds, pages, issues, variants_file: variantsFile, run_file: runFile, derived: !ws.brief };
}

// Variant metadata for om-bandit-cro: arms, the hypothesis and the metric. A proposal only:
// om-experiment-manager records it in experiments.json through a runs/<task-id>.json result.
function writeVariants(ws, pages) {
  const f = path.join(ws.dir, 'landing', 'variants.json');
  const exp = ws.brief?.experiment ?? {};
  const byTemplate = {};
  for (const p of pages) (byTemplate[p.template] ??= []).push(p);
  const doc = {
    product: ws.slug,
    updated_at: new Date().toISOString(),
    owner: 'om-bandit-cro',
    note: 'Proposal only. Agents never write experiments.json; om-experiment-manager records this through runs/<task-id>.json and the single writer.',
    experiments: Object.entries(byTemplate).map(([tpl, arms]) => ({
      id: exp.id ? `${exp.id}-${tpl}` : `LP-${ws.slug}-${tpl}-hero`,
      hypothesis: exp.hypothesis ?? 'A different hero headline or CTA changes the lead form submit rate.',
      metric: exp.metric ?? 'lead_submit_rate',
      method: exp.method ?? 'thompson-bandit',
      min_sample_per_arm: exp.min_sample ?? null,
      event: { lead: 'satellite /collect type "lead" with field variant', view: 'pageview path' },
      arms: arms.map((a) => {
        const v = (ws.brief?.variants ?? []).find((x) => x.id === a.variant);
        return { id: a.variant, file: a.file, url: a.url, headline: a.headline, cta: a.cta, hypothesis: v?.hypothesis ?? (a.variant === 'control' ? 'control' : ''), claims_cited: a.claims_cited };
      }),
    })),
  };
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(doc, null, 2));
  return path.relative(ws.dir, f).replace(/\\/g, '/');
}

// runs/<task-id>.json in the shape tools/apply-results.mjs merges.
function writeRun(ws, task, pages, issues, variantsFile) {
  const control = pages.filter((p) => p.variant === 'control');
  const exps = variantsFile ? JSON.parse(fs.readFileSync(path.join(ws.dir, variantsFile), 'utf8')).experiments : [];
  const result = {
    task_id: task, agent: 'om-landing-builder', status: 'done',
    output: [...pages.map((p) => p.file), ...(variantsFile ? [variantsFile] : [])],
    summary: `Built ${pages.length} landing page(s) (${[...new Set(pages.map((p) => p.template))].join(', ')}); ${issues.length} copy unit(s) dropped by the claims guard; placeholders: ${[...new Set(pages.flatMap((p) => p.placeholders))].join(', ') || 'none'}.`,
    approvals: control.map((p) => ({ type: 'publish', channel: 'landing', title: `Landing page: ${p.template}`, file: p.file, landing: { template: p.template } })),
    experiments: exps.map((e) => ({ id: e.id, hypothesis: e.hypothesis, metric: e.metric, status: 'proposed', result: null })),
  };
  const f = path.join(ws.dir, 'runs', `${task}.json`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(result, null, 2));
  return path.relative(ws.dir, f).replace(/\\/g, '/');
}
