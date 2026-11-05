---
name: om-zero-budget-growth
description: Get leads and sales with no ad budget. Picks the free channels that fit the business (store, SaaS, local service, B2B, creator), spends the owner's hours where they pay back, runs the attract, capture, respond, close and refer loop, and shifts hours to the channels that produce sales. Use in free mode, before a first ad budget, or when paid channels are paused.
---

# Zero-budget growth

In free mode the budget is the owner's time and the product itself. Plan in hours, measure in sales.

## 1. Start from the plan and the funnel

```bash
node tools/funnel.mjs <slug>        # where every lead is and which channels sell
node tools/free-engine.mjs <slug>   # this week's free channels, quotas, hours and tracked links
```

Read `funnel/FUNNEL.md` and `funnel/FREE-PLAN.md`. Tune the plan in `product.json` → `free: {hours_per_week, include, exclude}`.

## 2. Fix the leak before adding leads

Order of work, every week:

1. **Capture.** The site has one consented way to become a lead: a lead magnet, a quiz, a discount for the first order, a free trial or a booking form. With no capture, every free channel leaks.
2. **Speed to lead.** New leads get a reply inside the SLA (24 hours by default). An unanswered lead is the most expensive leak in free mode.
3. **Follow-up and close.** Qualified leads get the checkout, booking or proposal link. Stores recover carts with consent.
4. **Refer.** Every new customer is asked for a review, a referral or UGC, with disclosure.
5. Only then add attention: the channels in the plan.

## 3. Free channels by business

| Business | Core free channels |
|---|---|
| Online store | Free shopping listings, short video, customer UGC and referrals, partner swaps (bundles, inserts, newsletter swaps), giveaways where the prize is the product, email to consented buyers, SEO category and buying-guide pages |
| SaaS | Lead magnet or free tool, SEO quick wins, AI-answer citations, communities, directories and launch sites, founder posts, email |
| Local service | Google Business Profile, reviews, free map listings, warm network, referrals, local partners |
| B2B services | Founder posts, warm network, free PR (journalist requests, podcasts), partner swaps, case studies |
| Course or creator | Short video, lead magnet, communities, collaborations, newsletter swaps |

## 4. Rules that keep free channels open

- Every outbound item is a draft plus an approval. The owner posts and sends from their own accounts.
- No fake accounts, vote rings, engagement pods, bought reviews or followers, bulk DMs, or scraping against a site's terms.
- Community answers help first and disclose that the product is ours, where the community allows a mention at all.
- Email and messaging only to consented contacts, with one-click unsubscribe (CAN-SPAM, GDPR).
- Giveaways have official rules, no purchase needed where required, and marketing consent as a separate unticked box.
- Referral rewards are disclosed; reviews are asked of every customer, never only happy ones, never paid.

## 5. Measure every channel

Every link carries the plan's `utm_source` (for example `community`, `short-video`, `partner`, `referral`). The site tracker records it on the lead, `tools/funnel.mjs` credits leads and sales to it, and the next `free-engine` run moves hours toward the channels that sold. A channel with many leads and no sales gets its follow-up fixed before it gets more hours.

## 6. When to spend

When a free channel converts and the owner adds a budget, the same funnel shows which channel to amplify first (`/whalyom inject-budget`). Until then, nothing in this skill spends money.
