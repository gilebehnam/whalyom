// SEO and answer-engine (AEO) output: head tags, JSON-LD, sitemap entry and llms.txt snippet.
import { escAttr as esc } from './sections.mjs';

// JSON inside <script> must not be able to close the tag.
export const jsonForScript = (v) => JSON.stringify(v, null, 0).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const SOFTWARE = /saas|software|app|api|platform|tool|mobile/i;

export function pageUrls(model, template, variantId) {
  const { ws, brief } = model;
  const domain = String(ws.product.domain ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const pagePath = String(brief.page?.path ?? '').replace(/^\/+/, '');
  let base;
  if (brief.page?.url) base = brief.page.url;
  else if (domain) base = `https://${domain}/${pagePath}`;
  else base = `${(process.env.OM_SITE_BASE_URL ?? 'http://localhost:4321/site').replace(/\/$/, '')}/${ws.slug}/landing/${template}/`;
  const canonical = base;
  const self = variantId && variantId !== 'control' ? `${base.replace(/\/?$/, '/')}${variantId}/` : base;
  return { canonical, self, site: domain ? `https://${domain}/` : null, local: !domain && !brief.page?.url };
}

function offers(model) {
  const cur = model.ws.product.budget?.currency ?? 'USD';
  const sym = { $: 'USD', '€': 'EUR', '£': 'GBP' };
  return (model.brief.pricing?.plans ?? []).map((p) => {
    const m = String(p.price ?? '').match(/([$€£])?\s?(\d+(?:[.,]\d+)?)/);
    const price = p.price_value ?? (m ? Number(m[2].replace(',', '.')) : /free/i.test(p.price ?? '') ? 0 : null);
    if (price == null) return null;
    return { '@type': 'Offer', name: p.name, price: String(price), priceCurrency: p.currency ?? (m?.[1] ? sym[m[1]] : cur), ...(p.period ? { description: `${p.price ?? ''} ${p.period}`.trim() } : {}) };
  }).filter(Boolean);
}

export function jsonLd(model, urls) {
  const { brand, brief, ws } = model;
  const desc = brief.page?.description ?? brief.hero?.subhead ?? '';
  const org = { '@type': 'Organization', '@id': `${urls.site ?? urls.canonical}#org`, name: brand, ...(urls.site ? { url: urls.site } : {}), ...(Array.isArray(brief.page?.same_as) && brief.page.same_as.length ? { sameAs: brief.page.same_as } : {}) };
  const type = brief.page?.schema_type ?? (SOFTWARE.test(`${ws.product.model ?? ''} ${ws.product.preset ?? ''}`) ? 'SoftwareApplication' : 'Product');
  const off = offers(model);
  const thing = { '@type': type, name: brand, description: desc, url: urls.canonical, ...(type === 'SoftwareApplication' ? { applicationCategory: brief.page?.category ?? 'BusinessApplication', operatingSystem: brief.page?.operating_system ?? 'Web' } : { brand: { '@id': org['@id'] } }), ...(type === 'SoftwareApplication' ? { publisher: { '@id': org['@id'] } } : {}) };
  // Never aggregateRating or review: ratings must come from real, verified reviews.
  if (off.length) thing.offers = off.length === 1 ? off[0] : off;
  else if (type === 'Product') delete thing.offers;
  const graph = [org, thing, { '@type': 'WebPage', '@id': `${urls.canonical}#page`, url: urls.canonical, name: brief.page?.title ?? brand, description: desc, inLanguage: brief.page?.lang ?? ws.product.language ?? 'en', isPartOf: urls.site ? { '@type': 'WebSite', url: urls.site, name: brand } : undefined }];
  const faq = (brief.faq?.items ?? []).filter((x) => x.q && x.a);
  if (faq.length) graph.push({ '@type': 'FAQPage', mainEntity: faq.map((x) => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })) });
  return { '@context': 'https://schema.org', '@graph': JSON.parse(JSON.stringify(graph)) };
}

export function headTags(model, urls, { title, description, fonts, noindex, variantId }) {
  const lang = model.brief.page?.lang ?? model.ws.product.language ?? 'en';
  const locale = { en: 'en_US', de: 'de_DE', fr: 'fr_FR', es: 'es_ES', fa: 'fa_IR' }[lang] ?? 'en_US';
  const img = model.brief.page?.og_image;
  const t = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    `<link rel="canonical" href="${esc(urls.canonical)}">`,
    `<meta name="robots" content="${noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large'}">`,
    `<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(model.brand)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(urls.canonical)}"><meta property="og:locale" content="${locale}">`,
    img ? `<meta property="og:image" content="${esc(img)}"><meta name="twitter:image" content="${esc(img)}">` : '',
    `<meta name="twitter:card" content="${img ? 'summary_large_image' : 'summary'}"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}">`,
    model.brief.page?.twitter ? `<meta name="twitter:site" content="${esc(model.brief.page.twitter)}">` : '',
    `<meta name="generator" content="Whalyom landing builder"><meta name="whalyom:variant" content="${esc(variantId)}">`,
    fonts ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${esc(fonts)}">` : '',
  ];
  return t.filter(Boolean).join('\n');
}

export const sitemapXml = (urls) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${esc(urls.canonical)}</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>\n</urlset>\n`;

// llms.txt snippet (llmstxt.org format): a summary plus the facts the page states, each a verified claim.
export function llmsTxt(model, urls, cited) {
  const { brand, brief } = model;
  const lines = [`# ${brand}`, '', `> ${brief.page?.description ?? brief.hero?.subhead ?? brand}`, '', '## Pages', `- [${brief.page?.title ?? brand}](${urls.canonical}): ${brief.hero?.headline ?? ''}`.trimEnd()];
  if (cited.length) lines.push('', '## Facts (verified)', ...cited.map((c) => `- ${c.text}`));
  const faq = (brief.faq?.items ?? []).filter((x) => x.q && x.a);
  if (faq.length) lines.push('', '## FAQ', ...faq.map((x) => `- ${x.q} ${x.a}`));
  return lines.join('\n') + '\n';
}
