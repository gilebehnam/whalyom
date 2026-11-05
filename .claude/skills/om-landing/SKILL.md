---
name: om-landing
description: Whalyom landing page builder. Builds production-quality static landing pages (6 templates incl. the Whalyom "night" poster style) from a product workspace, using only claims verified in claims.md, with SEO/AEO, JSON-LD, A/B variants and GDPR-safe lead capture. Use for "/om landing", "build a landing page", "landing variants", "A/B test the hero", or when om-landing-builder, om-cro or om-personalizer output needs to become HTML.
---

# om-landing — landing pages from verified claims

Engine: `node tools/landing-builder.mjs` (zero dependencies). Full reference: `docs/LANDING_BUILDER.md`.

## Steps

1. **Read** `products/<slug>/product.json`, `claims.md`, `profile.md`, `LEARNINGS.md`, and `landing/brief.json` if it exists.
2. **Brief.** If `landing/brief.json` is missing or stale, dispatch `om-landing-builder` (copy and structure), optionally `om-cro` (section order, CTA) and `om-personalizer` (variants per source). Each writes or edits `products/<slug>/landing/brief.json` only. Every copy unit cites the claim ids it relies on (`"claims": ["C2"]`). Without a brief the builder derives a plain page from verified claims.
3. **Build:** `node tools/landing-builder.mjs <slug> [--template saas|editorial|bold|minimal|product|night|all] [--variant <id>|all] [--task <task-id>]`.
   - Read the printed JSON. `issues` lists every copy unit the claims guard dropped (unverified claim, a number not in the cited claims, or an unbacked phrase such as "best", "trusted by", "in minutes"). Fix the brief (or ask the owner to verify the claim), never the HTML. Use `--strict` to fail on any issue.
   - `placeholders` lists the marked boxes the owner must fill: customer proof, guarantee, lead endpoint, privacy link.
4. **Preview:** add `--publish` to copy the build to `site/<slug>/landing/`, then open http://localhost:4321/site/<slug>/landing/ (start the Command Center with `npm run command-center` if it is not running). Check desktop and mobile widths.
5. **Variants:** `--variant all` builds every `brief.variants[]` arm next to the control and writes `landing/variants.json` (arms, hypothesis, metric) for `om-bandit-cro`. Never write `experiments.json`: with `--task <id>` the builder writes `runs/<id>.json` (outputs, one `publish` approval per template on channel `landing`, proposed experiments); then run `node tools/apply-results.mjs <slug>`.
6. **Go live** only through the approval flow: compliance review → owner approval (or policy) → `node tools/execute.mjs <slug>`. The `local-site` connector copies an approved `landing/dist/<template>/index.html` into the static site; `site-git` or a host deploy takes it public.

## Rules

- Only claims marked `verified` in `claims.md`. No invented numbers, testimonials, reviews, ratings, logos or customer names; social proof renders only when it cites verified claims.
- Lead form: email consent checkbox is required and never pre-checked; UTM parameters are kept; when a site is attached (`connection.json` → `satellite`) the form posts to the satellite's `/collect`; otherwise it posts to `lead_form.action`, opens `lead_form.mailto`, or shows a visible "not connected" note.
- Products whose stage is not `active` build with `noindex` and a preview bar.
- Pick the template from the brand: `night` for the Whalyom dark-poster look, `saas`/`product` for software, `editorial` for content-led brands, `bold` for consumer launches, `minimal` for speed and paid traffic.
