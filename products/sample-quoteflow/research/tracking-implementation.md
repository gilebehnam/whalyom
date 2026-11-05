# Tracking implementation guide: Quoteflow (sample)

Task G07, 2026-11-03, om-tracking-engineer. Builds on research/tracking.md (O16) for the event spec and UTM convention; this file does not repeat them. Facts from knowledge/briefs/finops.md are cited by id.

**Install nothing without the owner.** This is a guide only. No tag, account, property or code has been created. Quoteflow is a fictional test product: nothing is published, sent or spent.

## 0. Status and what is missing

- The stack is not decided. reports/owner-decisions.md has no stack line; it has decision 1 (domain), 2 (EU in scope), 5 (card for trial), 9 (which GA4, Search Console, email and payments accounts, all null in product.json) and 12 (is a free signup a conversion). Where this guide needs a stack, it uses the free-mode default from tracking.md section 5: plain gtag.js on the marketing site, GA4 Measurement Protocol (MP) from the app backend, no GTM, no ad pixels. If the owner picks a different stack, steps 2 to 6 change; the event spec does not.
- research/site-inventory.md does not exist (no domain), so existing tags, forms and any consent banner could not be inspected.
- Backend language, auth provider and billing tool are unknown. Code below is pseudo-code with `<placeholders>`.
- Cap is $0 and no paid channels: no ad pixels, no ad conversion APIs.

## 1. Decisions to collect first (blocking)

| Needed | Owner decision | Effect on this guide |
|---|---|---|
| Domain | #1 | Search Console property, GA4 stream URL, cookie domain |
| GA4 property and Search Console owner account | #9 | Steps 2, 3 |
| EU in scope | #2 | Step 6: EU gets the same default-denied consent as UK; if No, geo-block EU from the banner list and from claims |
| Free signup a conversion? | #12 | Step 4: whether `sign_up` is marked a key event |
| Trial needs a card? | #5 | Where `trial_started` fires (account creation vs card capture). Do not describe the trial as "no card" (claim C19 is needs-proof) |
| Payments processor / deposits processed? | #3 | Which webhook sends `subscription_started`. Do not log "deposit paid" unless payments exist (C15) |
| Cookie and privacy pages | #8 (legal route), G06 | Banner links; must exist before the banner goes live |

## 2. GA4 (about 20 min once the property exists)

Owner action: create the property under the owner's Google account (or add the agent's work account as Editor). OM never holds the credentials.

1. Create a GA4 property, one web data stream for the production domain. Time zone and currency: USD (C14 not verified, so no local currency).
2. Data retention: set event data to **14 months** and keep "reset user data on new activity" on (K-f512726fdf). Standard properties allow 2 or 14 months only. Export to BigQuery later if cohort work needs longer history.
3. Enhanced measurement: leave page views on; turn off outbound clicks and site search if they add noise. The `cta_click`, `pricing_view` and `plan_selected` events are custom.
4. Install gtag.js in the marketing site `<head>` using the Measurement ID (`G-XXXXXXX`), but only after step 6 (consent default) is in place, so the order is: consent default, then config. Do not install the tag on the signed-in app until the data-sharing rules in tracking.md section 3 (no client names, emails, brief text) are enforced in code review.
5. Internal traffic: define the owner's IPs under Data Streams > Configure tag settings > Define internal traffic, then activate the data filter after testing. Use a separate test stream or `debug_mode=true` for test runs.
6. Custom dimensions (budget is 50 event-scoped, K-1317b85450): register only `plan`, `cta_id`, `source` (first-touch source), `medium`, `campaign`. Event and parameter names stay under 40 characters and parameter values under 100 (K-975cd0ff75).
7. Key events: mark `trial_started` and `subscription_started` only. Mark `sign_up` only if owner decision #12 is "free signup counts". All other events stay unmarked (limit 30 key events).
8. Create the Measurement Protocol API secret (Data Streams > Measurement Protocol API secrets). Store it as a server environment variable, never in the repo or client code.

## 3. Google Search Console (about 10 min)

1. Add a **Domain property** (preferred) and verify with a DNS TXT record at the registrar; fall back to URL-prefix with the HTML tag if DNS is not available. Owner or domain admin adds the record; OM provides the text only.
2. Submit the sitemap URL once G29 (technical SEO) has produced one; check indexing coverage after 3 to 7 days.
3. Link Search Console to GA4: GA4 Admin > Product links > Search Console links. The linking user needs Owner on the Search Console property and Editor on GA4.
4. Add the agent's work account as a restricted or full user only if the owner approves.
5. Baseline note: with no site, impressions and queries are zero; nothing is reported until data exists.

## 4. Server-side `trial_started` and `subscription_started`

Principle (tracking.md section 1): the server is the source of truth. Send only after the database write or billing webhook succeeds. MP augments gtag; a tagging method must already exist (K-71e291eb75).

### 4.1 Plumbing

1. In the browser, capture `client_id` and `session_id` from the gtag cookie (or `gtag('get', 'G-XXXXXXX', 'client_id', cb)`) and submit them with the signup form as hidden fields. Store both on the user record (`ga_client_id`, `ga_session_id`, plus the first-touch fields in step 5).
2. If consent was denied (step 6), no `client_id` exists. Store `null`. In that case do **not** generate a substitute id to push into GA4 from the server: the server event would then be processed without consent. Record the conversion in the app database only (it still counts for the 50-trial goal and revenue; it just lacks GA4 attribution).
3. Generate a stable `event_id` per conversion (`trial_<user_id>`, `sub_<subscription_id>`) and store it. Use it for dedupe in your own logs and as the idempotency key.

### 4.2 `trial_started`

Fire once, when the backend sets the trial flag (and, if owner decision #5 is "card required", after the card is captured).

```
POST https://www.google-analytics.com/mp/collect?measurement_id=G-XXXXXXX&api_secret=<SECRET>
{
  "client_id": "<ga_client_id>",
  "events": [{
    "name": "trial_started",
    "params": {
      "session_id": "<ga_session_id>",   // must be < 24h old to join the session
      "engagement_time_msec": 1,
      "plan": "pro",
      "trial_days": 14,
      "source": "<first_touch_source>",
      "medium": "<first_touch_medium>",
      "campaign": "<first_touch_campaign>"
    }
  }]
}
```
Params match tracking.md section 3 (plan=pro, trial_days=14, C10). No email, name or proposal text in params. Guard: skip if `trial_event_sent_at` is already set on the user (prevents double fire on retries and page refresh).

### 4.3 `subscription_started`

Fire from the billing webhook for the **first successful paid charge** only (not trial creation, not renewal). Which webhook depends on owner decision #3 and #9 (payments account, null today). Generic steps:

1. Verify the webhook signature (reject unsigned calls).
2. Check `first_paid_at` is empty; set it in the same transaction; then send:
```
{ "client_id": "<ga_client_id from user record>",
  "events": [{ "name": "subscription_started",
    "params": { "plan": "pro|team", "value": 19|49, "currency": "USD",
                "source": "...", "medium": "...", "campaign": "..." } }] }
```
`value` is 19 for Pro (C8) and 49 for Team (C9). Send `value` only on this event, not on `trial_started`. The webhook can arrive after the 24-hour session window, so expect the event to attach to the user (client_id) but not to the original session; that is fine for channel attribution because the source fields travel as params.
3. If `ga_client_id` is null (consent denied), skip GA4 and keep the revenue in the billing system.

### 4.4 Rules for both

- One sender per event. The browser must never also send `trial_started` or `subscription_started`.
- Validate every new payload first against `https://www.google-analytics.com/debug/mp/collect` (returns validation messages; production endpoint returns 2xx even for bad payloads) (K-71e291eb75).
- Retries: use a queue with at most 3 attempts; the guard flags above make retries safe.
- Log failures to the app's error log with the `event_id`, not the payload body.
- Admin/test users: set a `is_test` flag, and do not send MP events for them (or add `debug_mode`).

## 5. First-touch UTM storage

Convention is in tracking.md section 4. Implementation:

1. On the first page view of a visitor (no existing `qf_ft` cookie), parse `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` from the URL. If none, classify by `document.referrer` host: google/bing/duckduckgo = `organic-search`; chatgpt.com, perplexity.ai, gemini.google.com = `ai-referral`; empty = `direct`; anything else = `referral`. Lowercase everything; truncate to 100 characters.
2. Write a first-party cookie `qf_ft` = URL-encoded JSON `{s,m,c,ct,lp,ts}` (source, medium, campaign, content, landing path without query, ISO date). Attributes: `Path=/; Max-Age=7776000` (90 days); `SameSite=Lax; Secure`; set on the apex domain so www and app subdomains both read it. Never overwrite an existing `qf_ft` (first-touch).
3. Consent: UTM storage is not essential. Write `qf_ft` only after analytics or marketing consent in UK/EU (step 6); in US/CA/AU and for Global Privacy Control users, honor the opt-out signal (Connecticut guidance requires honoring GPC for targeted ads and sales, K-db9a4b5319; this cookie is not used for ads, but the safest default is to treat GPC as a denial). If consent is not given, store nothing and the signup is attributed "unknown (no consent)".
4. On signup: the form script copies the cookie values and `ga_client_id` / `ga_session_id` into hidden inputs. The backend validates (allowed characters, length) and writes `ft_source, ft_medium, ft_campaign, ft_content, ft_landing, ft_date` to the user record. These fields are immutable after first write.
5. Cross-domain: if the app lives on a different registrable domain from the marketing site, add both to GA4 cross-domain configuration and pass `_gl`; keeping both on one apex domain avoids this. Decision depends on owner decision #1.
6. Tagged URL log: every outbox draft with a link records the tagged URL in `outbox/utm-log.md` (tracking.md section 4). G08 owns the registry.

## 6. Consent mode for UK/EU

Legal basis: UK and EU require prior consent for analytics cookies. The EU applies only if owner decision #2 is Yes (C13 is needs-proof). Legal wording is for the lawyer (decision #8); this section is the technical setup only, not legal advice.

1. Pick a consent management platform (CMP) with a Google-certified integration or write a minimal banner: Accept, Reject (equal prominence) and a link to the cookie page. Cost and vendor are an owner decision. Banner copy goes through G06 and compliance review.
2. Defaults, in the page `<head>`, **before** any `gtag('config')` or event command; out-of-order code breaks the defaults (K-0f5c3b780a):
```html
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent','default',{
  'ad_storage':'denied','ad_user_data':'denied','ad_personalization':'denied',
  'analytics_storage':'denied',
  'region':['GB','AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','IS','LI','NO','CH'],
  'wait_for_update':500
});
gtag('consent','default',{'ad_storage':'denied','ad_user_data':'denied','ad_personalization':'denied','analytics_storage':'granted'}); // all other regions
gtag('js', new Date());
gtag('config','G-XXXXXXX');
</script>
```
Region codes: ISO 3166-2; a default without `region` applies to everyone else, and the region-specific one overrides it (K-0f5c3b780a). Verify the country list with the lawyer (the EEA plus UK plus Switzerland is a common choice). The second line grants analytics for US/CA/AU, which is a policy choice: if the owner or lawyer wants denied by default everywhere, drop the second call. Ad signals stay denied everywhere because there is no paid channel.
3. On the user's choice, call `gtag('consent','update',{...})` immediately and persist the choice in a first-party cookie `qf_consent` (180 days), read on every page load before the default call (K-0f5c3b780a).
4. Basic vs advanced mode (K-1aab001f7d). Recommended for UK/EU: **basic** (tags load only after the user accepts; nothing is sent while denied). Advanced sends cookieless pings and recovers modelled conversions, but modelling matters mainly for Ads; with no ads and tiny volume, the gain is small and the legal position is weaker. Owner and lawyer decide.
5. Server events follow consent: if `analytics_storage` was denied, send no MP event (step 4.1). Store the consent state (`granted`/`denied`, timestamp, banner version) on the user record at signup for audit.
6. Treat Global Privacy Control as a denial for the first-touch cookie and analytics in the US states that require it.
7. Do not add the Google Signals or ad features until a paid channel exists.

## 7. Verification checklist

Run on staging first, then production with a test account. Record pass/fail and date in this table. Today every row is **not run** (nothing is built).

| # | Check | How | Expected | Status |
|---|---|---|---|---|
| 1 | Consent default fires first | View source; tag assistant | `consent default` precedes `config` on every page | not run |
| 2 | UK/EU default denied | Browser through UK/EU VPN, clear cookies | No `_ga` cookie, no collect requests before accept | not run |
| 3 | US default granted (if chosen) | Same from US | `_ga` set, page_view arrives | not run |
| 4 | Accept updates consent | Click Accept | `consent update` fires, page_view sent, `qf_consent` set | not run |
| 5 | Reject keeps it denied | Click Reject, browse | No GA4 requests, no `qf_ft` cookie | not run |
| 6 | GPC honored | Send `Sec-GPC: 1` | Treated as denied | not run |
| 7 | UTM first-touch | Open `?utm_source=test&utm_medium=email&utm_campaign=2026-11-qa`, accept, sign up | `qf_ft` has the values; user record matches | not run |
| 8 | First touch not overwritten | Re-visit with other UTMs | Cookie and record unchanged | not run |
| 9 | Referrer classification | Visit via search result / AI referral link | `organic-search` / `ai-referral` stored | not run |
| 10 | `trial_started` once | Create test trial (`test+qf@...`); GA4 DebugView / Realtime | Exactly one event with params; none on refresh or retry | not run |
| 11 | MP payload valid | Post to `/debug/mp/collect` | Empty `validationMessages` | not run |
| 12 | client_id match | Compare browser `_ga` client_id to DebugView user | Same user, source/medium attached | not run |
| 13 | No-consent signup | Reject, sign up | Trial exists in DB, no GA4 event, `consent=denied` on the record | not run |
| 14 | `subscription_started` once | Test-mode charge via the billing tool; replay the webhook | One event, value 19 or 49, USD; replay is ignored | not run |
| 15 | No PII in params | Inspect payloads | No email, name, brief text, proposal text | not run |
| 16 | Key events | GA4 Admin | Only `trial_started`, `subscription_started` (and `sign_up` per decision #12) are marked | not run |
| 17 | Search Console linked | GA4 Admin > Product links | Link shows, Search Console report appears in GA4 after data | not run |
| 18 | Internal/test traffic excluded | Visit from owner IP, then check Reports | Not counted after the filter is active | not run |
| 19 | Cleanup | Delete test users and test data | Done and logged | not run |
| 20 | 7-day reconcile | Compare GA4 `trial_started` to app DB trial count | Within 10% (gap = consent denials) | not run |

Go-live gate: rows 1 to 6, 10 to 14 and 16 pass before any tagged link or post goes out (G08 UTMs).

## 8. Implementation order and owners

1. Owner answers decisions #1, #2, #5, #9, #12 (due Fri 2026-11-06 per owner-decisions.md).
2. Owner creates GA4 and Search Console (or adds an editor).
3. Cookie and privacy pages drafted (G06), lawyer review (#8).
4. Developer: consent snippet, gtag, first-touch script, hidden fields, backend fields, MP senders, webhook.
5. Run the checklist; then G08 UTMs go live.
6. Weekly: dashboard per tracking.md section 8; no numbers published before data exists.

## 9. If paid is enabled later

Not now ($0 cap). Reuse the same events; add ad-platform conversions only on owner approval (tracking.md section 7). For any Meta Pixel plus Conversions API setup, share one `event_id` between browser and server within 48 hours for dedupe (K-c893a85124). Server-side GTM is an option only if volume or ad-blocker loss justifies it; it does not remove consent obligations (K-79278cd794).
