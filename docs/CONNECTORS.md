# Connectors: how OM acts in the real world

Agents only write drafts. Things leave OM in one place: `tools/execute.mjs`, which carries out approvals marked `approved` (by the owner) or `auto-approved` (by `tools/policy.mjs`, within the product's autonomy level). Each approval goes to the first configured connector that accepts it; if none is configured, OM writes the exact manual steps to `products/<slug>/outbox/manual/<id>.md` and adds it to Needs You Know.

Check what is on: `node tools/connectors-status.mjs` (never prints secrets). The full catalog of connectors, readers, MCP servers and third-party manifests (`config/integrations/*.json`), with configured or missing key names only: `node tools/integrations.mjs` (`--missing` lists only what lacks keys; writes `state/integrations.json` for the Command Center).

## Where secrets go

- **Locally:** a `.env` file in the project root (it is in `.gitignore`; never commit it). Copy `.env.example`.
- **In the cloud routine:** set the same names as environment variables on the routine's cloud environment (claude.ai → Code → Environments), not in the repo.

## Connectors

| Connector | Carries out | Needs |
|---|---|---|
| `boosters` | `publish` items on channel `onsite-booster`: merges the approved booster spec (lead capture with consent, sticky CTA, announcement bar, structured data) into `products/<slug>/boosters.json`; the site's tracker loads it on the next page view, from the edge or the satellite. Checked first | nothing (free and local) |
| `meta-ads` | `spend` items on channel `meta`: campaign + ad set from a JSON spec, **paused unless the approval says `activate: true`**, daily budget never above the approved amount | `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `META_PAGE_ID` (a System User token from Meta Business Manager with `ads_management`) |
| `resend` | `send` items on channel `email` (up to 50 recipients from the draft's front matter) | `RESEND_API_KEY`, `OM_EMAIL_FROM` on a domain verified in Resend |
| `site-git` | `publish` items on channel `site`/`blog`/`landing`: copies the page into the site repo and pushes (any host that deploys on push) | `OM_SITE_REPO_<SLUG>` or `OM_SITE_REPO`: a local clone of the website repo |
| `satellite` | `site-change` items, and `publish` items on channel `site`/`blog`/`landing`/`seo`, on an attached site, through its satellite (signed requests) | `node tools/attach.mjs <domain> --satellite <url>` (see `docs/ATTACH.md`) |
| `local-site` | `publish` items on channel `site`/`blog`/`landing`/`seo`: a free static site in `site/<slug>/` with index, `sitemap.xml` and `llms.txt`, served locally at `/site/<slug>/` and ready for any free static host | nothing (always on, so free mode never fails for want of keys) |
| `webhook` | anything else, by channel: X, LinkedIn, Reddit, Google Ads, newsletters, CRMs… via an automation platform | `OM_WEBHOOK_<CHANNEL>` or `OM_WEBHOOK_DEFAULT`, optional `OM_WEBHOOK_SECRET` (HMAC-SHA256 of the body in `X-OM-Signature`) |
| Stripe (metrics) | daily revenue and payments into `metrics/kpis.json` | `STRIPE_API_KEY`, a **restricted read-only** key |

### Recommended free stack for the webhook connector
Self-hosted **n8n** (free) receives `{product, approval, content, sent_at}` and posts with its built-in nodes: X, LinkedIn, Reddit, Telegram, Discord, Mailchimp/Brevo, Google Ads, Google Sheets. One workflow per channel, each on its own `OM_WEBHOOK_<CHANNEL>` URL. The `n8n-mcp-skills` plugin in this project helps build those workflows.

### Metrics without connectors
Drop CSV files with header `date,channel,metric,value` (exports from GA4, Search Console or ad platforms) into `products/<slug>/metrics/inbox/`; `tools/metrics.mjs` imports them. Use metric `conversions` per channel so the budget allocator can compare channels.

## Safety built in

- Nothing runs unless its approval passed the compliance review (`compliance: pass`) and the autonomy level allows it, or the owner approved it.
- Spend is checked three times: by policy (automatic limit per day), by the executor against `ledger.jsonl` and both caps right before the call, and by the connector against the approved amount.
- Meta campaigns are created paused by default.
- Kill switch: `OM_KILL=1`, product `stage: "paused"`, or `autonomy.kill: true`.
- A failing connector is retried on the next run and marked `failed` after 3 attempts.
- Account creation, payment methods and platform terms are always done by the owner.

## Extended connectors

All of these are zero-dependency `fetch` modules in `tools/connectors/` (registered through `tools/connectors/extra.mjs`). They follow the same contract as the core connectors, so `tools/execute.mjs` remains the only place that enforces the kill switch, free mode, both spend caps and approvals:

- Each accepts **only its own channel names**, so routing for `site`/`blog`/`landing`, `email` and `meta` is unchanged. The budget-update connectors come first in the list, but only `budget_update` items reach them. Order: boosters, meta-ads, resend, extended keyed connectors (including the API ad connectors), the Instagram, Facebook, TikTok posting, Twilio voice, Twilio messaging, Amazon Ads, Walmart Connect, site-install and creative-gen connectors, site-git, satellite, local-site, webhook, then the opt-in ad CSV exporters. So the TikTok and Reddit API connectors come before their CSV exporters, and a configured key always wins over a setup sheet.
- A connector is **off until its keys are set**; an unconfigured item still falls through to the webhook or the manual-steps file.
- With `--dry-run` (or `growth_execute` with its default `dry_run: true`) every connector returns a preview and makes no request. Called without its keys, a connector makes no request and returns `ok: false` with a dry-run preview, so nothing is marked executed by mistake.
- **Secrets are never logged.** Detail and error text has secret env values, bearer tokens and URL credentials replaced with `***`. `list_connectors`, `connector_status` and `connectors-status.mjs` show env names only.
- Posts over the platform limit are refused, never cut. Blog platforms and newsletters create **drafts** unless the approval says `activate: true` (or the draft front matter has `published: true`). Ads are created **paused** unless `activate: true`, and the spec's `daily_budget` must not exceed the approved amount.

| Connector | Approval | Channel | Needs | Notes |
|---|---|---|---|---|
| `indexnow` | `index` | `indexnow` or none | `INDEXNOW_KEY` (+ key file on the site) | URLs from `item.urls` or URL lines in the draft; all on the product domain |
| `gsc-sitemap` | `index` | `gsc`, `sitemap` | `GSC_SITE_URL`, Google OAuth | Search Console `sitemaps.submit` (Google retired the anonymous sitemap ping in 2023) |
| `bluesky` | `post` | `bluesky` | `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD` | App password only; links become facets; 300 graphemes |
| `mastodon` | `post` | `mastodon` | `MASTODON_URL`, `MASTODON_TOKEN` | Idempotency key per approval; 500 chars (`MASTODON_MAX_CHARS`) |
| `telegram` | `post` | `telegram` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Bot must be a channel admin; 4096 chars |
| `discord` | `post` | `discord` | `DISCORD_WEBHOOK_URL` | Mentions disabled; 2000 chars |
| `slack` | `post` | `slack` | `SLACK_WEBHOOK_URL` | Incoming webhook |
| `x` | `post` | `x` | OAuth 1.0a (four keys) or `X_USER_ACCESS_TOKEN` | Threads split on `---` lines; 280 per part, URLs count 23 |
| `linkedin` | `post` | `linkedin` | `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_AUTHOR_URN` | Posts API; reserved characters escaped; `LINKEDIN_VERSION` defaults to two months back |
| `buffer` | `post` | `buffer` | `BUFFER_ACCESS_TOKEN`, `BUFFER_PROFILE_IDS` | **Unverified for new accounts** (legacy v1 API) |
| `devto` | `publish` | `devto` | `DEVTO_API_KEY` | `canonical_url`, up to 4 tags |
| `hashnode` | `publish` | `hashnode` | `HASHNODE_TOKEN`, `HASHNODE_PUBLICATION_ID` | GraphQL `createDraft` / `publishPost` (input shapes from docs) |
| `medium` | `publish` | `medium` | `MEDIUM_TOKEN` | **Legacy**: Medium no longer issues integration tokens |
| `wordpress` | `publish` | `wordpress` | `WP_URL`, `WP_USER`, `WP_APP_PASSWORD` | REST `wp/v2/posts`, status `draft` |
| `ghost` | `publish` | `ghost` | `GHOST_ADMIN_URL`, `GHOST_ADMIN_API_KEY` (`id:secret`) | Admin API JWT (HS256, 5 minutes) |
| `mailchimp` | `send` | `mailchimp`, `newsletter` | `MAILCHIMP_API_KEY`, `MAILCHIMP_LIST_ID`, `OM_EMAIL_FROM` | Campaign draft + content; never sends |
| `brevo` | `send` | `brevo`, `newsletter` | `BREVO_API_KEY`, `BREVO_LIST_ID`, `OM_EMAIL_FROM` | Campaign draft; never sends |
| `convertkit` | `send` | `convertkit`, `kit`, `newsletter` | `KIT_API_KEY` | Kit v4 draft broadcast; never sends |
| `google-ads` | `spend` | `google` | `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`, Google OAuth | Budget, campaign, ad group, keywords, negatives, RSAs; API `v21` by default (`GOOGLE_ADS_API_VERSION`) |
| `microsoft-ads` | `spend` | `microsoft` | `MSADS_DEVELOPER_TOKEN`, `MSADS_ACCESS_TOKEN`, `MSADS_CUSTOMER_ID`, `MSADS_ACCOUNT_ID` | **Unverified** JSON endpoint; prefer the CSV export until tested |
| `tiktok-ads` | `spend` | `tiktok` | `TIKTOK_ACCESS_TOKEN`, `TIKTOK_ADVERTISER_ID` | Campaign, ad group and ad through the TikTok Marketing API, disabled by default; field names need a test-account check |
| `linkedin-ads` | `spend` | `linkedin` | `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_AD_ACCOUNT_ID` (optional `LINKEDIN_ADS_VERSION`) | Campaign group, campaign and sponsored-content creative, draft/paused by default; `post` items on `linkedin` still go to the organic `linkedin` connector |
| `reddit-ads` | `spend` | `reddit` | `REDDIT_ADS_ACCESS_TOKEN`, `REDDIT_ADS_ACCOUNT_ID` | Ads API v3 campaign, ad group and ad, paused by default; request shapes from the docs, not yet run on a live account |
| `x-ads` | `spend` | `x_ads` | `X_ADS_CONSUMER_KEY`, `X_ADS_CONSUMER_SECRET`, `X_ADS_ACCESS_TOKEN`, `X_ADS_ACCESS_SECRET`, `X_ADS_ACCOUNT_ID`, `X_ADS_FUNDING_INSTRUMENT_ID` | X Ads API v12 campaign, line item, targeting and promoted posts, paused by default; channel `x` stays organic |
| `apple-search-ads` | `spend` | `apple` | `APPLE_ADS_CLIENT_ID`, `APPLE_ADS_TEAM_ID`, `APPLE_ADS_KEY_ID`, `APPLE_ADS_PRIVATE_KEY` (PEM), `APPLE_ADS_ORG_ID` | Campaign Management API v5 campaign, ad group and keywords, paused by default; not yet run on a live account |
| `google-ads-csv`, `microsoft-ads-csv` | `spend` | `google`, `microsoft` | `OM_ADS_CSV_EXPORT=1` | Editor import files in `outbox/exports/`; spends nothing |
| `tiktok-ads-csv`, `reddit-ads-csv` | `spend` | `tiktok`, `reddit` | `OM_ADS_CSV_EXPORT=1` | Setup sheets for manual entry (column names unverified) |
| `instagram` | `post`, `reply` | `instagram`, `ig` | `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_USER_ID` (optional `INSTAGRAM_API_BASE`, `META_API_VERSION`, `INSTAGRAM_POLL_ATTEMPTS`, `INSTAGRAM_POLL_MS`, `INSTAGRAM_USERNAME`) | Container then publish; a video still processing is published by the next run, never created twice; sponsored drafts need an ad label, put first in the caption |
| `facebook` | `post`, `reply` | `facebook`, `fb`, `facebook_page`, `facebook-page` | `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN` | Page posts (optional schedule) and comment replies; one publish per approval (`social/published.json`) |
| `tiktok-posting` | `post` | `tiktok`, `tiktok_organic`, `tiktok-organic` | `TIKTOK_POSTING_ACCESS_TOKEN` (separate from the ads token) | Content Posting API; privacy level from the creator info; unaudited apps can post only privately. `tiktok-ads` takes only `spend`, so the two never collide |
| `amazon-ads` | `spend` | `amazon`, `amazon_ads`, `amazon-ads` | `AMAZON_ADS_CLIENT_ID`, `AMAZON_ADS_CLIENT_SECRET`, `AMAZON_ADS_REFRESH_TOKEN`, `AMAZON_ADS_PROFILE_ID` (optional `AMAZON_ADS_REGION` na/eu/fe, `AMAZON_ADS_REPORT_POLLS`) | Sponsored Products campaign, ad group, product ads, keywords and negatives, **PAUSED** unless `activate: true`; `{"action":"budget"}` spec changes a daily budget; bids never above the daily budget |
| `walmart-connect` | `spend` | `walmart`, `walmart_connect`, `walmart-connect`, `walmart_ads`, `walmart-ads` | `WALMART_ADS_CONSUMER_ID`, `WALMART_ADS_PRIVATE_KEY` (PEM or base64 PKCS8), `WALMART_ADS_AUTH_TOKEN`, `WALMART_ADS_ADVERTISER_ID` (optional `WALMART_ADS_KEY_VERSION`, `WALMART_ADS_BASE` for the sandbox, `WALMART_ADS_REPORT_POLLS`) | RSA-SHA256 signed; campaign set paused before anything else is added; **never activated**, `committed_daily` always 0; field names from the docs, not yet run on a live account |
| `site-install` (`tools/connectors/site-install.mjs`) | `publish` | `site-install` | per product: `OM_CPANEL_URL_<SLUG>` + `OM_CPANEL_USER_<SLUG>` + `OM_CPANEL_TOKEN_<SLUG>`, or `OM_SSH_TARGET_<SLUG>` (+ `OM_SSH_KEY_<SLUG>`) | Written by `tools/add-product.mjs`. Adds the WordPress plugin and a must-use loader under the web root over cPanel (UAPI Fileman, API 2 mkdir) or SSH; adds files only, never overwrites, refuses paths outside the web root; the site secret is filled in from .env at upload. cPanel request shapes not yet run on a live account |

The five connectors above (tests: `tools/test/social-publish.test.mjs`, `tools/test/retail-media.test.mjs`, fetch mocked) are registered in `tools/connectors/index.mjs` after the extended keyed connectors and before site-git and the webhook; the kill switch can pause Amazon and Walmart campaigns.

Google OAuth means `GOOGLE_ACCESS_TOKEN`, or `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `GOOGLE_REFRESH_TOKEN` for an OAuth client the owner created, with the scopes needed (`webmasters`, `analytics.readonly`, `adwords`).

The ad CSV exporters are opt-in because the approval is marked `executed` once the file is written (the executor has no "handed to the owner" state). The result text says to import the file and to record real spend with `tools/budget.mjs <slug> --record <amount> <channel>`. They come after the webhook connector, so an automation-platform webhook always wins.

### Budget updates, creative, voice and messaging (2026-11-04, wired 2026-11-09)

These run only through `tools/execute.mjs` like every other connector. The budget connectors (listed first in the registry, but `pick()` sends only `budget_update` items to them), `twilio-voice`, `twilio-messaging` and `creative-gen` (before the webhook catch-all) are registered. The executor checks a `budget_update` with `checkBudgetUpdateCaps` (the campaign's daily amount is replaced, never added) and writes budget-change manual steps for it; `tools/apply-results.mjs` keeps `kind` and the other budget_update fields; `tools/budget.mjs` and `tools/policy.mjs` count live and approved budget updates with `liveCommittedDaily`. `call` is a send type in the executor's send guard (suppression list and expiry before the connector) and never earns autonomy (`tools/lib/earned.mjs`). After `creative-gen` succeeds the executor queues the result's pending `publish` approval in `runs/CREATIVE-<id>.json`, which `tools/apply-results.mjs` merges (pending, compliance unchecked).

| Connector | Approval | Channel | Needs | Notes |
|---|---|---|---|---|
| `meta-budget`, `google-ads-budget`, `tiktok-budget`, `linkedin-budget`, `microsoft-ads-budget` (`tools/connectors/budgets.mjs`) | `spend` with `kind: "budget_update"` (proposed by `tools/reallocate.mjs`) | the platform's ad channels (`meta`/`facebook`/`instagram`, `google`, `tiktok`, `linkedin`, `microsoft`/`bing`) | the same keys as the creating connector for that platform | Change the daily budget of an existing campaign only. Caps re-read from `product.json` right before the call (the campaign's daily amount is replaced, never added), no increase in free mode, never above the approved amount, an increase at most 20% over `old_daily`, a shared Google budget refused. Must be picked before any creating connector (`isBudgetUpdate` first in `pick()`), so an update never opens a new campaign. `pauseMicrosoft` gives the kill switch a Microsoft pauser |
| `creative-gen` (`tools/creative-gen.mjs`) | `creative` with `file: outbox/<brief>` | none | one of `OPENAI_API_KEY`, `STABILITY_API_KEY` (images), `RUNWAYML_API_SECRET`, `LUMAAI_API_KEY` (video); optional `OM_CREATIVE_IMAGE_PROVIDER`, `OM_CREATIVE_VIDEO_PROVIDER`, `OPENAI_IMAGE_MODEL`, `STABILITY_IMAGE_MODEL`, `RUNWAY_VIDEO_MODEL`, `RUNWAY_API_VERSION`, `LUMA_VIDEO_MODEL` | Generates an internal draft asset with `provenance.json`; requires `product.json creative.monthly_cap`; estimated cost booked as kind `creative` (not counted by the ad caps); AI label cannot be removed; public figures refused; real people need consent files; the asset leaves the outbox only through a later `publish` approval |
| `twilio-voice` (`tools/connectors/voice.mjs`) | `call` | `voice` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (or `TWILIO_API_KEY_SID` + `TWILIO_API_KEY_SECRET`), `TWILIO_VOICE_FROM`, `TWILIO_VOICE_WEBHOOK_BASE` (https); optional `TWILIO_VOICE_RELAY_URL` (wss), `TWILIO_VOICE_HANDOFF` (E.164) | One call per approval (lists refused), consent per purpose, calling hours in the callee's zone, do-not-call and suppression checks, caps, AI disclosure first, answers from `claims.md` only; webhooks at `<base>/inbound`, `/gather`, `/status` are signature-checked. `call` is treated like `send`: never auto-approved |
| `twilio-messaging` (`tools/connectors/twilio-messaging.mjs`) | `send` | `sms`, `whatsapp` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (or `TWILIO_API_KEY_SID` + `TWILIO_API_KEY_SECRET`), `TWILIO_MESSAGING_FROM` (E.164 or a Messaging Service SID `MG...`) for SMS, `TWILIO_WHATSAPP_FROM` (E.164) for WhatsApp; optional `TWILIO_MESSAGING_STATUS_URL` (https) | One message per approval to the lead's own number on file (lists and redirected numbers refused); explicit opt-in per channel in `messaging/consent.json`, suppression list and STOP opt-outs (`messaging/optouts.json`), quiet hours in the recipient's zone (at least 21:00-08:00), per-lead caps, money caps (`messaging.cost_per_message`, never in free mode), kill switch; WhatsApp outside the 24 h window needs an approved template (`content_sid`); SMS bodies get "Reply STOP to opt out."; logs in `messaging/messages.jsonl` hold phone hashes only. Needs `product.json messaging.enabled: true` |

### Read-only sources

These are not approval executors and never write anything remote.

| Reader | Gives | Needs | Used by |
|---|---|---|---|
| `stripe` | daily revenue (charges) | `STRIPE_API_KEY` (restricted, read-only) | `metrics_pull` only when named, because `metrics.mjs` already pulls Stripe |
| `plausible` | visitors, pageviews per day | `PLAUSIBLE_API_KEY`, `PLAUSIBLE_SITE_ID` (`PLAUSIBLE_URL` if self-hosted) | `metrics_pull` |
| `umami` | pageviews, sessions per day | `UMAMI_WEBSITE_ID` + `UMAMI_API_KEY` (Cloud) or `UMAMI_URL` + `UMAMI_TOKEN` | `metrics_pull` |
| `ga4` | sessions and key events per day and channel group | `GA4_PROPERTY_ID`, Google OAuth | `metrics_pull` (key events stored as `conversions`) |
| `calcom` | booking links | `CALCOM_API_KEY`, `CALCOM_USERNAME` | `booking_links` |
| `calendly` | scheduling links | `CALENDLY_TOKEN` | `booking_links` |
| `amazon-ads` (`amazonAdsMetrics`) | spend, clicks, conversions, sales and ACoS per campaign and day (Reporting v3, at most 31 days) | the `amazon-ads` keys | `metrics.mjs` (ad readers) and `metrics_pull` (listed in `tools/connectors/readers.mjs`) |
| `walmart-connect` (`walmartConnectMetrics`) | the same rows from a snapshot report | the `walmart-connect` keys | `metrics.mjs` (ad readers) and `metrics_pull` (listed in `tools/connectors/readers.mjs`) |
| Instagram and Facebook inbox (`tools/social-inbox.mjs`) | comments and DMs (GET only) for reply drafts | the `instagram` and `facebook` keys | `node tools/social-inbox.mjs <slug>` |

`metrics_pull` writes `metrics/inbox/<source>-<date>.json`, which `metrics_ingest` (tools/metrics.mjs) imports. `booking_links` writes `research/booking-links.json` for om-checkout-finisher and om-sales-agent.

### MCP tools for connectors and the owner

`list_connectors`, `connector_status`, `metrics_pull`, `booking_links`, `build_landing`, `attach_site_status`, `run_doctor`, `queue_task` (writes `runs/Q-*.json` for apply-results, so the single-writer rule holds), `approve_item` (needs `WHALYOM_OWNER_TOKEN` set in the MCP server process environment, never in the repo `.env`, which agents can read; applied through `apply-decisions.mjs`), `experiments_summary`, `license_status`. None of them publishes, sends or spends.

Tests: `node --test tools/test/connectors-extra.test.mjs tools/test/mcp-extra.test.mjs` (mocked fetch only), and for the 2026-11-04 connectors `node --test tools/test/reallocate.test.mjs tools/test/social-publish.test.mjs tools/test/creative.test.mjs tools/test/voice.test.mjs tools/test/retail-media.test.mjs`.
