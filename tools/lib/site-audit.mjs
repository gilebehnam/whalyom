// Instant site audit: everything Whalyom can learn about a site from its public pages in seconds,
// with no LLM. Pure functions (tests feed HTML strings); tools/instant-onboard.mjs does the fetching.
//   auditSite({ url, html, robots, sitemap, llms, bytes }) → { scores, checks, facts, quickWins, boosters }
// Boosters are drafts built only from what the page itself says (its name, its own CTA links, its own
// privacy page, its social profiles); nothing is invented, and every draft waits for the owner.

const strip = (s) => String(s ?? '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const attr = (tag, name) => { const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag); return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null; };
const tags = (html, name) => String(html).match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) ?? [];
const meta = (html, key) => { for (const t of tags(html, 'meta')) { const k = (attr(t, 'name') ?? attr(t, 'property') ?? '').toLowerCase(); if (k === key) return attr(t, 'content'); } return null; };
const abs = (href, base) => { try { const u = new URL(href, base); return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; } };

// Words that mark a call to action, in the languages Whalyom serves first.
const CTA = /\b(get started|start (free|now|your)|sign ?up|try (it )?(free|now)|book (a )?(demo|call|meeting)|request (a )?(demo|quote)|get (a )?(quote|demo|offer)|buy( now)?|shop( now)?|order( now)?|add to cart|subscribe|join( now)?|contact (us|sales)|talk to (sales|us)|free trial|download)\b|شروع|ثبت[‌ ]?نام|خرید|سفارش|رزرو|مشاوره|تماس|دریافت|اشتراک|kostenlos|jetzt|essai gratuit|comenzar|prueba gratis|comprar/i;
const SOCIAL = /^(https?:\/\/)?(www\.)?(x\.com|twitter\.com|linkedin\.com|instagram\.com|facebook\.com|youtube\.com|tiktok\.com|pinterest\.com|github\.com|t\.me|threads\.net)\//i;

export function auditSite({ url, html = '', robots = null, sitemap = null, llms = null, bytes = null, status = 200 }) {
  const base = String(url);
  const u = new URL(base);
  const text = strip(html);
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim();
  const description = meta(html, 'description');
  const h1 = (String(html).match(/<h1\b[\s\S]*?<\/h1>/gi) ?? []).map(strip).filter(Boolean);
  const lang = attr(tags(html, 'html')[0] ?? '', 'lang');
  const viewport = Boolean(meta(html, 'viewport'));
  const canonical = tags(html, 'link').map((t) => ((attr(t, 'rel') ?? '').toLowerCase() === 'canonical' ? attr(t, 'href') : null)).find(Boolean) ?? null;
  const robotsMeta = (meta(html, 'robots') ?? '').toLowerCase();
  const ogTitle = meta(html, 'og:title'), ogImage = meta(html, 'og:image'), siteName = meta(html, 'og:site_name');
  const jsonld = (String(html).match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) ?? []).flatMap((s) => {
    try { const j = JSON.parse(s.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '')); const arr = Array.isArray(j) ? j : j['@graph'] ?? [j]; return arr.map((x) => [].concat(x?.['@type'] ?? []).join(',')).filter(Boolean); } catch { return ['invalid']; }
  });
  const links = tags(html, 'a').map((t) => ({ tag: t, href: attr(t, 'href') })).filter((l) => l.href);
  const anchors = (String(html).match(/<a\b[\s\S]*?<\/a>/gi) ?? []).map((a) => ({ href: attr(a, 'href'), text: strip(a).slice(0, 80) })).filter((a) => a.href);
  const buttons = (String(html).match(/<button\b[\s\S]*?<\/button>/gi) ?? []).map((b) => strip(b).slice(0, 80)).filter(Boolean);
  const ctas = [...anchors.filter((a) => CTA.test(a.text)).map((a) => ({ text: a.text, url: abs(a.href, base) })), ...buttons.filter((b) => CTA.test(b)).map((b) => ({ text: b, url: null }))].filter((c) => c.text);
  const forms = tags(html, 'form').length;
  const emailInputs = tags(html, 'input').filter((t) => (attr(t, 'type') ?? '').toLowerCase() === 'email' || /e-?mail/i.test(attr(t, 'name') ?? '')).length;
  const find = (re) => anchors.find((a) => re.test(a.href) || re.test(a.text));
  const privacy = find(/privacy|datenschutz|confidentialit|privacidad|حریم|privacy-policy/i);
  const pricing = find(/pricing|prices|plans|preise|tarifs|precios|قیمت|تعرفه/i);
  const contact = find(/contact|kontakt|contacto|تماس/i);
  const signup = find(/sign ?up|register|get-started|start|trial|ثبت/i);
  const social = [...new Set(links.map((l) => abs(l.href, base)).filter((h) => h && SOCIAL.test(h)).map((h) => h.replace(/\/$/, '')))].slice(0, 8);
  const scripts = tags(html, 'script');
  const has = (re) => re.test(html);
  const analytics = { ga4: has(/gtag\(|googletagmanager\.com\/gtag/), gtm: has(/googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+/), meta_pixel: has(/connect\.facebook\.net\/[^"']*fbevents|fbq\(/), plausible: has(/plausible\.io/), whalyom: has(/whalyom(\.min)?\.js/) };
  const chat = has(/intercom|crisp\.chat|tawk\.to|drift\.com|hubspot.*conversations|zendesk|livechat|tidio|chatwoot/i);
  const imgs = tags(html, 'img');
  const noAlt = imgs.filter((t) => attr(t, 'alt') === null || attr(t, 'alt') === '').length;
  const trustWords = /testimonial|review|trusted by|customers|case stud|rated|stars|★|نظر مشتری|رضایت/i.test(text);
  const phone = has(/href=["']tel:/i), email = has(/href=["']mailto:/i);
  const robotsBlocksAll = robots != null && /user-agent:\s*\*[\s\S]*?disallow:\s*\/\s*($|\n)/i.test(robots);
  const name = (siteName || ogTitle || title.split(/\s[|\-–—:·]\s/)[0] || u.hostname.replace(/^www\./, '')).trim().slice(0, 60);

  const checks = [];
  const add = (id, area, ok, weight, fix, agent) => checks.push({ id, area, ok: Boolean(ok), weight, fix, agent });
  add('https', 'trust', u.protocol === 'https:', 3, 'Serve the whole site over HTTPS.', 'om-tech-seo');
  add('reachable', 'trust', status >= 200 && status < 400, 5, `Home page answered HTTP ${status}.`, 'om-tech-seo');
  add('title', 'seo', title.length >= 10 && title.length <= 65, 3, `Title is ${title.length} characters; write a 30–60 character title with the main query first.`, 'om-micro-meta-title');
  add('description', 'seo', description && description.length >= 50 && description.length <= 165, 2, 'Add a 120–160 character meta description that states the offer and the next step.', 'om-micro-meta-title');
  add('h1', 'seo', h1.length === 1, 2, h1.length ? `Use exactly one H1 (found ${h1.length}).` : 'Add one H1 that states what the product does for whom.', 'om-tech-seo');
  add('viewport', 'cro', viewport, 3, 'Add a mobile viewport meta tag.', 'om-tech-seo');
  add('lang', 'seo', Boolean(lang), 1, 'Set the page language (<html lang>).', 'om-tech-seo');
  add('canonical', 'seo', Boolean(canonical), 1, 'Add a canonical link.', 'om-tech-seo');
  add('indexable', 'seo', !/noindex/.test(robotsMeta) && !robotsBlocksAll, 5, 'The page or robots.txt blocks search engines; remove noindex / Disallow: / if the site should be found.', 'om-tech-seo');
  add('og', 'social', Boolean(ogTitle && ogImage), 1, 'Add Open Graph title and image so shared links look right.', 'om-micro-og-tags');
  add('schema', 'ai-search', jsonld.some((t) => /Organization|WebSite|Product|SoftwareApplication|LocalBusiness/i.test(t)), 2, 'Add Organization and WebSite structured data (JSON-LD).', 'om-schema-engineer');
  add('sitemap', 'seo', Boolean(sitemap) || (robots ?? '').toLowerCase().includes('sitemap:'), 2, 'Publish /sitemap.xml and reference it in robots.txt.', 'om-indexing-agent');
  add('llms', 'ai-search', Boolean(llms), 1, 'Publish /llms.txt pointing AI assistants to the pages that explain the product.', 'om-micro-llms-txt');
  add('cta', 'cro', ctas.length >= 1, 5, 'No clear call to action found; add one primary CTA above the fold.', 'om-cro');
  add('lead-capture', 'cro', emailInputs > 0, 4, 'No email capture on the page; offer a reason to leave an email (with consent).', 'om-lead-magnet');
  add('contact', 'trust', Boolean(contact || phone || email), 2, 'Make it obvious how to reach you (contact page, email or phone).', 'om-trust-builder');
  add('privacy', 'trust', Boolean(privacy), 3, 'Link a privacy policy (required before collecting emails in most markets).', 'om-legal-pages');
  add('social-proof', 'cro', trustWords, 2, 'Show real proof (reviews, customer logos, case studies) — only verified ones.', 'om-social-proof');
  add('analytics', 'measurement', Object.values(analytics).some(Boolean), 3, 'No analytics found; Whalyom\'s first-party tracker now measures visits, leads and sales.', 'om-tracking-engineer');
  add('alt', 'seo', imgs.length === 0 || noAlt / imgs.length <= 0.2, 1, `${noAlt} of ${imgs.length} images have no alt text.`, 'om-micro-alt-text');
  add('weight', 'speed', bytes == null || bytes < 1.5e6, 2, `Home page HTML is ${Math.round((bytes ?? 0) / 1024)} KB; trim it.`, 'om-page-speed');
  add('scripts', 'speed', scripts.length <= 40, 1, `${scripts.length} script tags; remove unused third-party scripts.`, 'om-page-speed');

  const areas = [...new Set(checks.map((c) => c.area))];
  const scores = Object.fromEntries(areas.map((a) => { const cs = checks.filter((c) => c.area === a); const w = cs.reduce((n, c) => n + c.weight, 0); return [a, Math.round((100 * cs.filter((c) => c.ok).reduce((n, c) => n + c.weight, 0)) / w)]; }));
  const totalW = checks.reduce((n, c) => n + c.weight, 0);
  scores.overall = Math.round((100 * checks.filter((c) => c.ok).reduce((n, c) => n + c.weight, 0)) / totalW);

  const facts = { url: base, host: u.hostname, name, title, description, h1: h1.slice(0, 3), lang, ctas: ctas.slice(0, 8), forms, email_inputs: emailInputs, pricing: pricing ? abs(pricing.href, base) : null, contact: contact ? abs(contact.href, base) : null, signup: signup ? abs(signup.href, base) : null, privacy: privacy ? abs(privacy.href, base) : null, social, analytics, chat, jsonld, words: text.split(' ').length, bytes };
  const quickWins = checks.filter((c) => !c.ok).sort((a, b) => b.weight - a.weight);

  // Booster drafts (approved: false). Built only from the page's own facts.
  const boosters = [];
  const primary = ctas.find((c) => c.url) ?? (signup ? { text: signup.text || 'Get started', url: abs(signup.href, base) } : null) ?? (pricing ? { text: 'See pricing', url: abs(pricing.href, base) } : null) ?? (contact ? { text: 'Contact us', url: abs(contact.href, base) } : null);
  if (!checks.find((c) => c.id === 'lead-capture').ok) boosters.push({
    id: 'lead-capture', type: 'lead-capture', approved: false, trigger: 'exit', delay_s: 45,
    headline: `Stay in touch with ${name}`, text: 'Leave your email and we will send you updates and offers.', button: 'Keep me posted',
    consent_text: `I agree that ${name} may email me. I can unsubscribe at any time.`, ...(facts.privacy ? { privacy_url: facts.privacy } : {}), success: 'Thank you — you are on the list.',
    exclude: ['/checkout', '/cart', '/account', '/login'], why: 'No email capture on the page: visitors who are not ready to buy leave without a way to follow up.',
    needs_owner: facts.privacy ? [] : ['Add a privacy policy page and its link before turning this on.'],
  });
  if (primary && ctas.length < 3) boosters.push({
    id: 'sticky-cta', type: 'sticky-cta', approved: false, text: (description || title || name).slice(0, 110), button: primary.text.slice(0, 30), url: primary.url,
    exclude: ['/checkout', '/cart'], why: `Only ${ctas.length} clear call(s) to action; a slim bar keeps the next step one click away on every page.`, needs_owner: [],
  });
  if (!checks.find((c) => c.id === 'schema').ok) boosters.push({
    id: 'schema-org', type: 'schema', approved: false, why: 'No Organization/WebSite structured data: search engines and AI assistants understand the brand less well.',
    jsonld: { '@context': 'https://schema.org', '@graph': [
      { '@type': 'Organization', name, url: u.origin + '/', ...(social.length ? { sameAs: social } : {}), ...(ogImage ? { image: abs(ogImage, base) } : {}) },
      { '@type': 'WebSite', name, url: u.origin + '/' },
    ] }, needs_owner: [],
  });
  return { scores, checks, facts, quickWins, boosters };
}

export function auditMarkdown(a, at) {
  const lines = [`# Instant audit: ${a.facts.name} (${a.facts.host})`, '', `Checked ${at} from the public home page, robots.txt, sitemap.xml and llms.txt, in seconds and without AI. The full research team starts next.`, '',
    `**Overall ${a.scores.overall}/100** · ${Object.entries(a.scores).filter(([k]) => k !== 'overall').map(([k, v]) => `${k} ${v}`).join(' · ')}`, '',
    '## Fix first (highest impact)', '', ...a.quickWins.slice(0, 10).map((c, i) => `${i + 1}. **${c.id}** (${c.area}) — ${c.fix} → \`${c.agent}\``), '',
    '## Ready to switch on (needs your approval)', '', ...(a.boosters.length ? a.boosters.map((b) => `- **${b.type}** — ${b.why}${b.needs_owner?.length ? ` _Before approving: ${b.needs_owner.join(' ')}_` : ''}`) : ['- Nothing urgent: the basics are in place.']), '',
    '## What the page says', '', `- Title: ${a.facts.title || '—'}`, `- Description: ${a.facts.description || '—'}`, `- Calls to action: ${a.facts.ctas.map((c) => c.text).join(' · ') || 'none found'}`,
    `- Pricing page: ${a.facts.pricing ?? 'not linked'} · Contact: ${a.facts.contact ?? 'not linked'} · Privacy: ${a.facts.privacy ?? 'not linked'}`,
    `- Analytics: ${Object.entries(a.facts.analytics).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'} · Live chat: ${a.facts.chat ? 'yes' : 'no'} · Structured data: ${a.facts.jsonld.join(', ') || 'none'}`, ''];
  return lines.join('\n');
}
