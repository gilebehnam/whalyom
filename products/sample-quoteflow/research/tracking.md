# Tracking plan: Quoteflow (sample)

Task O16, 2026-11-02. Source: brief.md, product.json, claims.md, profile.md. No domain, no site, no analytics account (accounts.analytics = null), so nothing here is "observed". All items are **inferred** from the brief or **pending** the live site. Test product: nothing is published or sent.

## 1. Goal and measurement scope
- Goal (product.json): 50 trial signups in 30 days. North star: revenue.
- Budget: free mode, ad cap $0, no paid channels. So **no ad pixels or ad conversion APIs now**. Section 7 lists what to add if paid is ever enabled.
- Enabled channels to measure: seo, content, geo, directories, communities, social, email, cro.
- Model: b2b-saas, product-led (free plan + 14-day Pro trial). This is a "backend-confirmed" conversion model: signup and subscription exist in the app database, so the server is the source of truth, not the browser.

## 2. Conversion definitions (decide before any code)
| Level | Event | Counts when | Primary? |
|---|---|---|---|
| Primary (goal) | `trial_started` | Pro trial confirmed in the backend (account exists, trial flag set) | Yes. This is the "50 trial signups" |
| Primary | `subscription_started` | First paid Pro/Team charge confirmed | Yes (revenue) |
| Secondary | `signup_completed` | Account created (free plan or trial) | Secondary |
| Secondary | `proposal_sent` | First proposal link sent to a client (activation) | Secondary |
| Soft | `waitlist_joined` | Only if a pre-launch waitlist page exists | Secondary |
| Not conversions | pricing view, CTA click, form start | Intent only. Never mark Primary | No |

Open decision for owner: is a free-plan signup a conversion or only a trial start? Brief goal says "trial signups", so `signup_completed` on free is Secondary.

## 3. Event spec (GA4 naming, snake_case, fire on confirmed success only)
Send from the server (or the app's success callback after the API returns 2xx), never on button click. Dedupe on `event_id`.

**Marketing site (browser)**
| Event | Trigger | Params |
|---|---|---|
| `page_view` | automatic | page_location, referrer |
| `cta_click` | click on signup/trial CTA (Secondary, diagnostic) | cta_id, page_path |
| `pricing_view` | /pricing view (diagnostic only) | plan_shown |
| `plan_selected` | plan chosen at signup | plan (free/pro/team) |
| `waitlist_joined` | form success response, not submit click | source |

**App (server-confirmed)**
| Event | Params |
|---|---|
| `sign_up` (GA4 recommended name; maps to `signup_completed`) | method, plan |
| `trial_started` | plan=pro, trial_days=14 |
| `brief_created` | proposal_id (no client PII) |
| `proposal_created` | proposal_id, price_options_count |
| `proposal_sent` | proposal_id |
| `proposal_viewed_by_client` | proposal_id |
| `proposal_signed` | proposal_id |
| `deposit_requested` | proposal_id (claim C15: do not log "deposit paid" unless payments are confirmed to exist) |
| `plan_limit_reached` | plan=free, limit=3 |
| `subscription_started` | plan (pro/team), value (19 or 49), currency=USD |
| `trial_converted` / `trial_expired` | days_in_trial |
| `subscription_canceled` | plan |

Rules: no client names, emails or brief text in event params. Hash nothing into analytics (no ad platform). Currency is USD only until C14 (local currency) is verified.

Activation funnel: `sign_up` -> `brief_created` -> `proposal_sent` -> `proposal_signed` -> `subscription_started`. Report drop-off weekly.

## 4. UTM and source convention
Lowercase, hyphens, no spaces. Required on every link we control.
| Param | Values |
|---|---|
| `utm_source` | site or platform, e.g. `reddit`, `linkedin`, `x`, `producthunt`, `newsletter`, `directory-<name>`, `community-<name>` |
| `utm_medium` | `organic-social`, `community`, `email`, `directory`, `referral`, `content`, `geo` (never `cpc`; no paid) |
| `utm_campaign` | `<yyyy-mm>-<theme>`, e.g. `2026-11-launch` |
| `utm_content` | asset or variant id, e.g. `post-03`, `cta-a` |
| `utm_term` | unused (no paid search) |
Rules: never tag internal links; keep a log of every tagged URL in `outbox/utm-log.md` when drafts are made. SEO, GEO and AI-referral traffic cannot be tagged: classify by referrer in GA4 (google, bing, chatgpt.com, perplexity.ai, etc.). Store first-touch UTMs (cookie, 90 days) and write them to the account record at signup, so `trial_started` and `subscription_started` can be attributed to channel server-side.

## 5. Tooling (free-mode stack, owner to confirm)
- GA4 (free) plus Google Search Console (free); optional lightweight alternative: Plausible/PostHog (paid or self-host, owner decides, not required).
- GTM optional; a plain gtag install plus server-side Measurement Protocol sends for backend events is enough at this volume.
- Consent: US/UK/CA/AU (and EU if confirmed, claim C13). UK and EU need consent before analytics cookies. Use consent mode default-denied for UK/EU and a banner. Needs privacy and cookie pages on the live site.
- Internal traffic filter and a test property or `debug_mode` for team traffic.
- Server-side senders: none exist yet (confirmed by brief: pre-launch). When built, there must be one sender per event to avoid double counting.

## 6. Verification checklist (run once the site and app exist)
1. GA4 DebugView: each event arrives exactly once, params present. Expected: `trial_started` appears once per test trial, not on refresh.
2. Test signup with a marked email (`test+qf@...`), then delete it afterward.
3. Confirm Measurement Protocol events carry the same `client_id` as the browser session (otherwise attribution breaks).
4. Mark `trial_started` and `subscription_started` as key events in GA4; leave others unmarked.
5. UTM test: open a tagged link, sign up, confirm source/medium on the account record and in GA4.
6. Search Console linked to GA4.
Status today: nothing built, nothing verified.

## 7. If paid is enabled later (not now, cap $0)
Per platform, add on approval only: Google Ads conversion on `trial_started` (One, Primary) with Enhanced Conversions; Meta pixel + CAPI with shared `event_id`; LinkedIn Insight tag + CAPI. Reuse the same event spec. Any spend needs owner approval.

## 8. Metrics dashboard (weekly)
Visitors by channel; visitor->signup rate; signup->trial_started; trial_started count vs 50 target; activation rate (`proposal_sent` within 7 days); trial->paid; MRR; top landing pages. Do not publish numbers before data exists.

## Pending (needs domain, accounts or owner)
- Site inventory (research/site-inventory.md) missing: existing tags, forms, consent banner, CMS cannot be inspected.
- GA4 property and Search Console accounts (accounts.* are null).
- Owner: confirm signup flow (credit card for trial? claim C19 unverified), whether a waitlist page exists, EU in scope, currencies, whether deposits are processed in-app.
- Real success signals for the signup form and billing tool (e.g. Stripe webhook) once the stack is known.
- Consent banner and cookie/privacy pages.
