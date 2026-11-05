// Section library. Each renderer takes (data, ctx) and returns HTML, or '' when there is nothing
// verified to show. Placeholders are visible, marked boxes the owner fills (ctx.placeholder records them).
export const escAttr = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Visible text: also keeps "14-day" on one line (non-breaking hyphen between a digit and a word).
export const esc = (s) => escAttr(String(s ?? '').replace(/(\d)-(?=[A-Za-z])/g, '$1‑'));
const attr = escAttr;

const safeHref = (h) => {
  const s = String(h ?? '').trim();
  if (!s) return '#lead';
  if (/^(#|\/|https?:\/\/|mailto:)/i.test(s)) return s;
  return '#lead';
};

export function cta(c, cls = 'btn') {
  if (!c?.label) return '';
  const href = safeHref(c.href);
  const ext = /^https?:/i.test(href);
  return `<a class="${cls}" href="${attr(href)}"${ext ? ' data-keep-utm' : ''} data-cta="${attr(c.id ?? c.label)}">${esc(c.label)}</a>`;
}

const head = (s, ctx, { center = false, fallback = '' } = {}) => {
  const t = s?.title ?? fallback;
  if (!t && !s?.eyebrow && !s?.intro) return '';
  return `<div class="sec-head${center ? ' center' : ''}">${s?.eyebrow ? `<span class="eyebrow">${esc(s.eyebrow)}</span>` : ''}${t ? `<h2 id="${ctx.id}-title">${esc(t)}</h2>` : ''}${s?.intro ? `<p class="lede">${esc(s.intro)}</p>` : ''}</div>`;
};
const open = (ctx, cls = '') => `<section id="${ctx.id}" class="${cls}" aria-labelledby="${ctx.id}-title">`;
const labelOnly = (ctx, text) => `<h2 id="${ctx.id}-title" class="sr-only">${esc(text)}</h2>`;

export const placeholderBox = (ctx, key, title, text) => {
  ctx.placeholders.push({ key, title, text });
  return `<div class="wy-ph" role="note" data-placeholder="${attr(key)}"><strong>[Placeholder] ${esc(title)}</strong>${esc(text)}</div>`;
};

function mock(features, ctx) {
  const rows = (features?.items ?? []).filter((f) => f.title).slice(0, 4);
  if (!rows.length) return '';
  return `<div class="mock" aria-hidden="true"><div class="mock-bar"><i></i><i></i><i></i></div><div class="mock-body">${rows.map((f, i) => `<div class="mock-row"><span>${esc(f.title)}</span><b class="${i % 2 ? 's' : ''}"></b></div>`).join('')}${ctx.brief.hero?.cta?.label ? `<span class="mock-pill">${esc(ctx.brief.hero.cta.label)}</span>` : ''}</div></div>`;
}

export const SECTIONS = {
  hero(h, ctx) {
    const t = ctx.template;
    const sub = h.subhead ? `<p class="lede">${esc(h.subhead)}</p>` : '';
    const ctas = `<div class="ctas">${cta(h.cta)}${cta(h.secondary_cta, 'btn ghost')}</div>`;
    const offer = h.offer?.text ? `<p class="offer">${esc(h.offer.text)}</p>` : '';
    const eyebrow = h.eyebrow ? `<span class="eyebrow">${esc(h.eyebrow)}</span>` : '';
    const h1 = `<h1 id="hero-title">${esc(h.headline)}</h1>`;
    if (t.hero === 'poster') {
      return `<section id="hero" class="hero" aria-labelledby="hero-title"><div class="fog" aria-hidden="true"></div><div class="fog f2" aria-hidden="true"></div><span class="rule l" aria-hidden="true"></span><span class="rule r" aria-hidden="true"></span>${h.eyebrow ? `<span class="side l" aria-hidden="true">${esc(h.eyebrow)}</span>` : ''}<span class="side r" aria-hidden="true">${esc(ctx.brand)}</span><div class="wrap">${eyebrow}${h1}${sub}${ctas}${offer}</div>${ctx.trees}</section>`;
    }
    if (t.hero === 'editorial') {
      return `<section id="hero" class="hero" aria-labelledby="hero-title"><div class="wrap"><div class="kicker"><span>${esc(h.eyebrow ?? ctx.brand)}</span><span>${esc(ctx.brand)}</span></div>${h1}<div class="cols">${sub || '<div></div>'}<div>${ctas}${offer}</div></div></div></section>`;
    }
    if (t.hero === 'stack') {
      const words = esc(h.headline).split(' ');
      const k = Math.max(1, Math.ceil(words.length / 3));
      const hl = `${words.slice(0, -k).join(' ')} <span class="hl">${words.slice(-k).join(' ')}</span>`;
      const items = (ctx.brief.features?.items ?? []).map((f) => f.title).filter(Boolean);
      return `<section id="hero" class="hero" aria-labelledby="hero-title"><div class="wrap">${eyebrow}<h1 id="hero-title">${hl}</h1>${sub}${ctas}${offer}</div></section>${items.length ? `<div class="marquee" aria-hidden="true"><span>${esc(items.join('  ·  '))}  ·  ${esc(items.join('  ·  '))}</span></div>` : ''}`;
    }
    if (t.hero === 'split') {
      return `<section id="hero" class="hero" aria-labelledby="hero-title"><div class="wrap"><div>${eyebrow}${h1}${sub}${ctas}${offer}</div>${mock(ctx.brief.features, ctx)}</div></section>`;
    }
    if (t.hero === 'center') {
      return `<section id="hero" class="hero" aria-labelledby="hero-title"><div class="wrap">${eyebrow}${h1}${sub}${ctas}${offer}${mock(ctx.brief.features, ctx)}</div></section>`;
    }
    return `<section id="hero" class="hero" aria-labelledby="hero-title"><div class="wrap">${eyebrow}${h1}${sub}${ctas}${offer}</div></section>`;
  },

  problem(s, ctx) {
    const pts = (s.points ?? []).map((p) => (typeof p === 'string' ? p : p.text)).filter(Boolean);
    if (!pts.length && !s.title) return '';
    return `${open(ctx)}<div class="wrap">${head(s, ctx, { fallback: 'The problem' })}${pts.length ? `<ul class="pains">${pts.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}</div></section>`;
  },

  solution(s, ctx) {
    if (!s.title && !s.body) return '';
    const pts = (s.points ?? []).filter((x) => typeof x === 'string');
    return `${open(ctx)}<div class="wrap">${head({ ...s, intro: undefined }, ctx, { fallback: 'How it helps' })}${s.body ? `<p class="lede">${esc(s.body)}</p>` : ''}${pts.length ? `<ul class="ticks">${pts.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}</div></section>`;
  },

  features(s, ctx) {
    const items = (s.items ?? []).filter((f) => f.title || f.body);
    if (!items.length) return '';
    const style = ctx.template.features;
    let body;
    if (items.every((f) => !f.title)) body = `<ul class="ticks">${items.map((f) => `<li>${esc(f.body)}</li>`).join('')}</ul>`;
    else if (style === 'columns') body = `<ul class="cols-list">${items.map((f) => `<li><h3>${esc(f.title)}</h3><p>${esc(f.body)}</p></li>`).join('')}</ul>`;
    else if (style === 'list') body = `<dl class="def">${items.map((f) => `<div><dt>${esc(f.title)}</dt><dd>${esc(f.body)}</dd></div>`).join('')}</dl>`;
    else if (style === 'rows') body = `<div class="rows">${items.map((f) => `<article class="row"><div><h3>${esc(f.title)}</h3><p>${esc(f.body)}</p></div><div class="row-ui" aria-hidden="true"><span>${esc(f.title)}</span><b></b><b></b><b></b></div></article>`).join('')}</div>`;
    else if (style === 'bento') body = `<div class="bento">${items.map((f) => `<article class="card"><h3>${esc(f.title)}</h3><p>${esc(f.body)}</p></article>`).join('')}</div>`;
    else body = `<div class="grid">${items.map((f) => `<article class="card"><h3>${esc(f.title)}</h3><p>${esc(f.body)}</p></article>`).join('')}</div>`;
    return `${open(ctx)}<div class="wrap">${head(s, ctx, { fallback: 'Features' })}${body}</div></section>`;
  },

  how_it_works(s, ctx) {
    const steps = (s.steps ?? []).filter((x) => x.title);
    if (!steps.length) return '';
    return `${open(ctx)}<div class="wrap">${head(s, ctx, { fallback: 'How it works' })}<ol class="steps">${steps.map((x) => `<li><h3>${esc(x.title)}</h3>${x.body ? `<p>${esc(x.body)}</p>` : ''}</li>`).join('')}</ol></div></section>`;
  },

  // Social proof only shows items that cite verified claims (a real quote the customer approved,
  // a logo they allowed). Otherwise the slot is a placeholder for the owner.
  social_proof(s, ctx) {
    const items = (s?.items ?? []).filter((x) => (x.quote || x.text) && (x.claims ?? []).length);
    if (items.length) {
      return `${open(ctx)}<div class="wrap">${head(s, ctx, { fallback: 'What people say' })}<div class="grid">${items.map((x) => `<figure class="card"><blockquote><p>${esc(x.quote ?? x.text)}</p></blockquote>${x.author ? `<figcaption class="muted">${esc(x.author)}${x.role ? `, ${esc(x.role)}` : ''}</figcaption>` : ''}</figure>`).join('')}</div></div></section>`;
    }
    if (ctx.clean) return '';
    return `${open(ctx, 'ph-sec')}<div class="wrap">${labelOnly(ctx, 'Customer proof')}${placeholderBox(ctx, 'social-proof', 'Customer proof', 'No testimonials, reviews, logos or usage numbers are verified in claims.md, so none are shown. Add real ones with the customer\'s written consent to claims.md (status: verified), cite them in landing/brief.json under social_proof.items, and rebuild.')}</div></section>`;
  },

  comparison(s, ctx) {
    const rows = (s.rows ?? []).filter((r) => r.label && Array.isArray(r.values));
    const cols = s.columns ?? [ctx.brand, 'Without it'];
    if (!rows.length) return '';
    return `${open(ctx)}<div class="wrap">${head(s, ctx, { fallback: 'Compared' })}<div class="table-wrap" role="region" aria-labelledby="${ctx.id}-title" tabindex="0"><table><thead><tr><th scope="col"><span class="sr-only">Feature</span></th>${cols.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr><th scope="row">${esc(r.label)}</th>${r.values.map((v, i) => `<td${i === 0 ? ' class="us"' : ''}>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div></section>`;
  },

  pricing(s, ctx) {
    const plans = (s.plans ?? []).filter((p) => p.name);
    const items = (s.items ?? []).filter((x) => x.body);
    if (!plans.length && !items.length) return '';
    let body;
    if (!plans.length) body = `<ul class="ticks">${items.map((x) => `<li>${esc(x.body)}</li>`).join('')}</ul>`;
    else if (ctx.template.pricing === 'table') {
      body = `<div class="table-wrap" role="region" aria-labelledby="${ctx.id}-title" tabindex="0"><table><thead><tr><th scope="col">Plan</th><th scope="col">Price</th><th scope="col">Includes</th><th scope="col"><span class="sr-only">Action</span></th></tr></thead><tbody>${plans.map((p) => `<tr><th scope="row">${esc(p.name)}</th><td>${esc(p.price ?? '')}${p.period ? ` <span class="muted">${esc(p.period)}</span>` : ''}</td><td>${esc((p.features ?? []).join(' · '))}</td><td>${cta(p.cta, 'btn small')}</td></tr>`).join('')}</tbody></table></div>`;
    } else {
      body = `<div class="plans">${plans.map((p) => `<article class="plan${p.highlight ? ' hl' : ''}">${p.badge ? `<span class="tag">${esc(p.badge)}</span>` : ''}<h3>${esc(p.name)}</h3><p class="price">${esc(p.price ?? '')}${p.period ? `<small>${esc(p.period)}</small>` : ''}</p>${p.summary ? `<p class="muted">${esc(p.summary)}</p>` : ''}${(p.features ?? []).length ? `<ul class="ticks">${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}${cta(p.cta, p.highlight ? 'btn' : 'btn ghost')}</article>`).join('')}</div>`;
    }
    return `${open(ctx)}<div class="wrap">${head(s, ctx, { fallback: 'Pricing', center: ctx.template.pricing === 'cards' })}${body}</div></section>`;
  },

  guarantee(s, ctx) {
    if (s?.body && (s.claims ?? []).length) return `${open(ctx)}<div class="wrap">${head(s, ctx, { fallback: 'Our promise' })}<p class="lede">${esc(s.body)}</p></div></section>`;
    if (ctx.clean) return '';
    return `${open(ctx, 'ph-sec')}<div class="wrap">${labelOnly(ctx, 'Guarantee')}${placeholderBox(ctx, 'guarantee', 'Guarantee or refund terms', 'claims.md has no verified guarantee or refund policy, so none is promised. If one exists, add it to claims.md as verified and cite it under guarantee in landing/brief.json.')}</div></section>`;
  },

  faq(s, ctx) {
    const items = (s.items ?? []).filter((x) => x.q && x.a);
    if (!items.length) return '';
    return `${open(ctx)}<div class="wrap">${head(s, ctx, { fallback: 'Questions' })}<div class="faq">${items.map((x, i) => `<details${i === 0 ? ' open' : ''}><summary>${esc(x.q)}</summary><p>${esc(x.a)}</p></details>`).join('')}</div></div></section>`;
  },

  final_cta(s, ctx) {
    if (!s.headline) return '';
    return `<section id="${ctx.id}" class="final" aria-labelledby="${ctx.id}-title"><div class="wrap"><h2 id="${ctx.id}-title">${esc(s.headline)}</h2>${s.body ? `<p class="lede">${esc(s.body)}</p>` : ''}<div class="ctas">${cta(s.cta)}</div></div></section>`;
  },

  lead_form(s, ctx) {
    const lead = ctx.lead;
    const fields = Array.isArray(s.fields) && s.fields.length ? s.fields : ['name', 'email'];
    const utm = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].map((k) => `<input type="hidden" name="${k}" value="">`).join('');
    const privacy = ctx.brief.page?.privacy_url ? `<a href="${attr(safeHref(ctx.brief.page.privacy_url))}">privacy policy</a>` : 'privacy policy';
    const consent = s.consent_text ?? `I agree that ${ctx.brand} may email me about this request and related updates. I can unsubscribe at any time.`;
    const fieldHtml = fields.map((f) => {
      if (f === 'email') return `<div class="field"><label for="lf-email">Work email</label><input id="lf-email" name="email" type="email" autocomplete="email" required inputmode="email" placeholder="you@company.com"></div>`;
      if (f === 'name') return `<div class="field"><label for="lf-name">Name <span class="opt">(optional)</span></label><input id="lf-name" name="name" type="text" autocomplete="name"></div>`;
      if (f === 'company') return `<div class="field"><label for="lf-company">Company <span class="opt">(optional)</span></label><input id="lf-company" name="company" type="text" autocomplete="organization"></div>`;
      return '';
    }).join('');
    const note = {
      satellite: 'Submissions go to this site\'s Whalyom satellite (/collect) with the page\'s UTM parameters.',
      action: 'Submissions go to the form endpoint set in landing/brief.json.',
      mailto: 'Submitting opens your email app with the details filled in.',
      none: 'Preview: this form is not connected yet, so nothing is sent. Attach the site (node tools/attach.mjs) or set lead_form.action in landing/brief.json.',
    }[lead.mode];
    if (lead.mode === 'none') ctx.placeholders.push({ key: 'lead-endpoint', title: 'Lead form endpoint', text: note });
    if (!ctx.brief.page?.privacy_url) ctx.placeholders.push({ key: 'privacy-url', title: 'Privacy policy link', text: 'Set page.privacy_url in landing/brief.json (om-legal-pages drafts the policy).' });
    const action = lead.mode === 'action' ? ` action="${attr(lead.endpoint)}" method="post"` : '';
    return `<section id="lead" aria-labelledby="lead-title"><div class="wrap lead-box"><div>${s.eyebrow ? `<span class="eyebrow">${esc(s.eyebrow)}</span>` : ''}<h2 id="lead-title">${esc(s.title ?? `Get ${ctx.brand}`)}</h2>${s.body ? `<p class="lede">${esc(s.body)}</p>` : ''}</div><form id="lead-form" class="lead-form"${action} data-mode="${lead.mode}">${fieldHtml}${utm}<input type="hidden" name="form" value="${attr(s.form_id ?? 'lead')}"><input type="hidden" name="variant" value="${attr(ctx.variantId)}"><label class="consent"><input type="checkbox" name="consent" value="yes"${s.consent_required === false ? '' : ' required'}><span>${esc(consent)} See the ${privacy}.</span></label><button class="btn" type="submit">${esc(s.submit_label ?? 'Send')}</button><p class="wy-status" role="status" aria-live="polite"></p><p class="wy-note">${esc(note)}</p></form></div></section>`;
  },
};
