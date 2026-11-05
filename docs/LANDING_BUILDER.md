# Landing page builder

`tools/landing-builder.mjs` turns a product workspace into static landing pages: one HTML file per template and variant, CSS inlined, no framework, no npm dependencies. Agents write the brief; the builder writes the HTML, so copy never drifts from `claims.md`.

```
node tools/landing-builder.mjs <slug> [--template <name>|a,b|all] [--variant <id>|all] [--out <dir>]
                                      [--clean] [--publish] [--task <task-id>] [--strict]
node tools/landing-builder.mjs --list          # templates
```

| Flag | Effect |
|---|---|
| `--template` | `saas`, `editorial`, `bold`, `minimal`, `product`, `night`, a comma list or `all`. Default: `page.template(s)` in the brief, else all |
| `--variant` | also build an A/B arm from `brief.variants[]` (`all` = every arm); writes `landing/variants.json` |
| `--out` | output folder (default `products/<slug>/landing/dist`) |
| `--clean` | leave out placeholder sections and the preview bar |
| `--publish` | copy the build to `site/<slug>/landing/` for a local preview at http://localhost:4321/site/<slug>/landing/ |
| `--task` | also write `runs/<task-id>.json` (outputs, `publish` approvals on channel `landing`, proposed experiments) for `apply-results.mjs` |
| `--strict` | exit 1 when the claims guard dropped any copy |

Output per template: `index.html`, `sitemap.xml` (the page's entry), `llms.txt` (summary, the verified facts the page states, FAQ) and `build.json` (headline, CTA, claims cited, placeholders, issues). Variants go to `<template>/<variant>/index.html` with the control as canonical.

## Inputs

| File | Used for |
|---|---|
| `product.json` | name, domain (canonical URL), stage (`noindex` + preview bar unless `active`), language, currency, model (`SoftwareApplication` vs `Product` schema) |
| `claims.md` | the only facts the page may state; parsed from the claims table |
| `landing/brief.json` | sections, copy, CTA, offer, pricing, FAQ, variants (written by om-landing-builder, om-cro, om-personalizer) |
| `connection.json` | `satellite` URL from `tools/attach.mjs` → lead form endpoint and `whalyom.js` tracking |

Without `brief.json` the page is derived from verified claims: the first is the subhead, price-related ones become the pricing list, the rest a feature list.

## Claims guard

Every copy unit (an object with text: hero, feature item, plan, FAQ item, comparison row, CTA…) cites claim ids: `"claims": ["C2", "C6"]`. A unit is dropped and reported under `issues` when:

- a cited id is unknown or not `verified` (`unknown-claim`, `unverified-claim`);
- its copy has a number that is not in the cited verified claims (`number-not-in-claims`);
- its copy uses a risky phrase that the cited claims do not contain: best, #1, fastest, trusted by, customers, reviews, rated, testimonial, guarantee, instant, in minutes, unlimited, no credit card, secure… (`unbacked-phrase`).

Copy without numbers or risky phrases (a problem statement in the buyer's words, a section title) needs no citation. A dropped hero headline falls back to the brand name; a variant that fails keeps the control copy. Social proof renders only from items that cite verified claims; the guarantee only when it cites one. Otherwise both are visible, marked `[Placeholder]` boxes.

## brief.json

```json
{
  "page": { "brand": "Quoteflow", "title": "…", "description": "…", "lang": "en", "template": "night",
            "url": "https://…/", "privacy_url": "/privacy", "og_image": "https://…/og.png", "noindex": false },
  "experiment": { "id": "LP-QF-hero", "hypothesis": "…", "metric": "lead_submit_rate", "method": "thompson-bandit", "min_sample": 200 },
  "sections": ["hero", "problem", "solution", "features", "how_it_works", "social_proof", "comparison", "pricing", "guarantee", "faq", "final_cta", "lead_form"],
  "hero": { "eyebrow": "…", "headline": "…", "subhead": "…", "claims": ["C2"],
            "cta": { "label": "…", "href": "#lead", "claims": ["C10"] }, "secondary_cta": { "label": "See pricing", "href": "#pricing" },
            "offer": { "text": "…", "claims": ["C7"] } },
  "problem": { "title": "…", "points": [{ "text": "…", "kind": "voc" }] },
  "solution": { "title": "…", "body": "…", "claims": [] },
  "features": { "title": "…", "items": [{ "title": "…", "body": "…", "claims": [] }] },
  "how_it_works": { "steps": [{ "title": "…", "body": "…", "claims": [] }] },
  "social_proof": { "items": [{ "quote": "…", "author": "…", "role": "…", "claims": ["C20"] }] },
  "comparison": { "columns": ["Us", "Them"], "rows": [{ "label": "…", "values": ["…", "…"], "claims": [] }] },
  "pricing": { "plans": [{ "name": "Pro", "price": "$19", "period": "/month", "badge": "…", "highlight": true, "features": ["…"], "claims": ["C8"], "cta": { "label": "…", "href": "#lead" } }] },
  "guarantee": { "title": "…", "body": "…", "claims": ["C21"] },
  "faq": { "items": [{ "q": "…", "a": "…", "claims": [] }] },
  "final_cta": { "headline": "…", "body": "…", "cta": { "label": "…", "href": "#lead" } },
  "lead_form": { "title": "…", "body": "…", "form_id": "trial", "fields": ["name", "email", "company"], "submit_label": "…",
                 "consent_text": "…", "action": "https://forms.example/endpoint", "mailto": "hello@…", "thanks": "…" },
  "variants": [{ "id": "b", "name": "…", "hypothesis": "…", "metric": "lead_submit_rate",
                 "hero": { "headline": "…", "subhead": "…", "claims": [] }, "cta": { "label": "…", "claims": [] } }]
}
```

The worked example is `products/sample-quoteflow/landing/brief.json` (fictional product).

## Templates

| Name | Look | Hero | Features | Pricing |
|---|---|---|---|---|
| `saas` | clean SaaS, Inter, indigo | split with an app frame | card grid | cards |
| `editorial` | magazine feature, Fraunces + Public Sans, rust | kicker, drop cap | ruled columns | table |
| `bold` | bold startup, Space Grotesk, hard shadows | oversized type + marquee | colour bento | cards |
| `minimal` | system fonts, one 720px column | plain | definition list | table |
| `product` | product-led, IBM Plex, teal | centred over a large app frame | alternating rows with UI panels | cards |
| `night` | Whalyom Dark-poster: navy-teal night, fog, pine treeline, thin wide-tracked Jost, yellow `#F2C230` | full-height poster | line cards | cards |

All templates: skip link, `header`/`nav`/`main`/`footer` landmarks, one `h1`, labelled sections, labelled inputs, visible focus, `prefers-reduced-motion`, WCAG AA token contrast (checked in the tests), responsive down to 320px, Google Fonts only (or system fonts), inline SVG favicon, no external scripts unless a satellite is attached. Head: title, description, canonical, robots, Open Graph, Twitter card. JSON-LD `@graph`: Organization, SoftwareApplication or Product (offers from verified plans, never ratings or reviews), WebPage, FAQPage.

## Lead capture

| Condition | Form behaviour |
|---|---|
| `lead_form.action` set | normal POST to that URL (plus a satellite beacon when attached) |
| site attached (`connection.json` `satellite`) | `fetch` POST to `<satellite>/collect` with `type: "lead"`, form id, variant, UTMs and the fields; `whalyom.js` is loaded for page views |
| `lead_form.mailto` set | opens the visitor's email app with the details |
| none | nothing is sent; a visible note says the form is not connected |

UTM parameters (`utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`) are kept in `sessionStorage`, put in hidden fields and appended to outbound `http(s)` CTA links. The consent checkbox is required for submission and never pre-checked.

## A/B variants

`--variant all` builds every arm and writes `products/<slug>/landing/variants.json`: per template one experiment with its arms (file, URL, headline, CTA, claims cited), hypothesis, metric and method, for `om-bandit-cro`. The builder never writes `experiments.json`; with `--task` it proposes the experiments in `runs/<task-id>.json`, which `apply-results.mjs` merges. Each variant page carries `data-variant`, a `whalyom:variant` meta tag and a hidden `variant` field, so satellite lead events can be split by arm.

## Publishing

- Local preview: `--publish` copies `landing/dist/<template>/` to `site/<slug>/landing/<template>/` and rebuilds `site/<slug>/landing/index.html` (gallery), `sitemap.xml` and `llms.txt`. `tools/server.mjs` serves them under `/site/<slug>/landing/`.
- Going live: an approval `{ "type": "publish", "channel": "landing", "file": "landing/dist/<template>/index.html" }` (written by `--task`). After compliance and owner approval, `execute.mjs` hands it to the `local-site` connector, which routes landing builds to `tools/landing/publish.mjs`.

## Code

`tools/landing/claims.mjs` (parser, guard) · `content.mjs` (workspace, derived brief, enforcement, variants, lead target) · `sections.mjs` (section library) · `templates.mjs` (six templates, treeline) · `seo.mjs` (head, JSON-LD, sitemap, llms.txt) · `build.mjs` (render, write, variants.json, runs file) · `publish.mjs` (static site). Tests: `node --test tools/test/landing.test.mjs`.

## Limitations

- The satellite's `/collect` currently stores the event (type, form, path, UTM source/medium/campaign) but not contact fields; to keep the email itself, set `lead_form.action` to a form handler or extend the satellite to store consented contacts.
- No OG image is generated; set `page.og_image` (om-image-briefer writes the brief).
- Without a domain the canonical URL is the local preview URL (or `OM_SITE_BASE_URL`); set `product.json` `domain` or `page.url` before going live.
- The claims guard is lexical: it catches numbers and risky phrases, not every paraphrase. om-compliance-guard still reviews each page before approval.
