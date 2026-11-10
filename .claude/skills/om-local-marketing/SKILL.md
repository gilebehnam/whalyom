---
name: om-local-marketing
description: "Run local and field marketing in Whalyom: Google Business Profile, Apple Business Connect and Bing Places completeness, posts, Q&A, photos and hours, NAP consistency and citations, reviews asked of every customer, local landing pages with real local content, local service ads and radius campaigns inside the caps, partnerships with nearby businesses, and in-store and event promotions with trackable codes. Use for any business with a location or a service area."
---

# Local and field marketing

Local buyers search, compare a few nearby options, then call, get directions or book. The head is `om-mega-local`. The work is accurate listings, real reviews, useful local pages and offers people can trace back to a channel.

## 1. Listings complete and correct

For each location, `om-gbp-manager` keeps `research/local/locations.json`: name exactly as on the storefront, address or service area, phone, website, hours (including holidays), categories, attributes, services or menu, booking link and photos.

1. Claim and verify Google Business Profile, Apple Business Connect and Bing Places. The owner verifies; agents never create profiles for locations that do not exist.
2. Fill every field the platform offers that is true for the business. Pick the primary category that matches the main service.
3. Hours are updated before holidays and closures, never left stale.
4. Photos are real: storefront, interior, team (with consent), work and products. No stock images presented as the business.

## 2. Posts, Q&A and photos

`om-micro-gbp-post` drafts one post per week per location in `outbox/local/gbp/`: an offer, an event, news or a product, with a tracked link. Common questions get answered on the profile from `claims.md` and the FAQ. Replies to reviews and questions are drafts until approved.

## 3. NAP consistency and citations

`om-local-citations` lists every place the business appears (data aggregators where the market has them, maps, industry directories, chambers, social profiles) in `research/local/citations.json` with the name, address and phone shown. Fix mismatches at the source, remove duplicates, and add the directories that matter for the category and city. Quality over count.

## 4. Reviews

- Ask every customer, after the service or delivery, through one simple link. Never ask only the happy ones.
- No gating (no satisfaction filter before the review link), no rewards or discounts for reviews where the platform forbids it, no reviews from staff, family or bought services.
- Reply to every review: specific thanks for praise, ownership and a fix path for complaints, no personal details in the reply.
- Review requests go only to consented contacts and through approved messages.

## 5. Local landing pages

One page per location or real service area in `outbox/local/pages/<city>.md`: address and map, hours, the services offered there, the team, local photos, directions and parking, local reviews (quoted with permission), and local FAQs. No doorway pages: no near-identical pages for towns the business does not serve. Pages go live through the martech change process after approval.

## 6. Local ads and radius campaigns

`om-local-ads-planner` plans local service ads where the category qualifies, search campaigns with location targeting, and radius campaigns around each location in `outbox/local/ads/`. Each plan has the radius, schedule, budget split inside `budget.monthly_cap` and `budget.daily_cap`, call tracking and the kill rule. Small budgets run on one channel only.

## 7. Partnerships with nearby businesses

`om-local-partnerships` finds complementary businesses with the same customers (a gym and a physio, a florist and a venue) and drafts the offer in `outbox/local/partners/`: referral swap, joint event, shared window display, bundle. Terms are written down and disclosed.

## 8. In-store and event promotions

`om-field-promo-planner` plans in-store offers, flyers, local events and sponsorships in `outbox/local/promos/` with a unique code or QR link per channel, the start and end date, the stock or capacity limit, and the consent capture for any sign-up. Prize promotions have written rules and no purchase required where the law asks.

## Who does what

| Agent | Work |
|---|---|
| om-mega-local | Plan per location, priorities, sign-off |
| om-gbp-manager | Profiles on Google, Apple and Bing, hours, photos, Q&A |
| om-micro-gbp-post | One profile post |
| om-local-citations | NAP audit, citations, duplicates |
| om-local-seo | Local pages, local schema, location keywords |
| om-local-ads-planner | Local service ads and radius campaigns |
| om-local-partnerships | Partnerships with nearby businesses |
| om-field-promo-planner | In-store, event and print promotions with codes |

## Guardrails

- Claims only from `claims.md`. No invented numbers, testimonials, reviews or customer names; no fake locations or listings.
- Nothing outbound without approval: profile edits, posts, review replies, pages, ads and partner messages are drafts plus an entry in `approvals.json`, executed by `tools/execute.mjs`.
- Spend inside `budget.monthly_cap` and `budget.daily_cap`. Consent for every contact, review request and sign-up.
- Agents write results to `runs/<task-id>.json`, never to `tasks.json` or `approvals.json`.

## Measures

Per location: calls, direction requests, website clicks and bookings from the profiles, review count, rating and response rate, citation accuracy, local page leads, redemptions per promo code, and footfall where the business can measure it (counters, bookings, POS). Ad results come with cost per call and per booking. Every test is logged in `experiments.json`.
