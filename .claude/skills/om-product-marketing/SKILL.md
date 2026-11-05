---
name: om-product-marketing
description: Run product marketing in Whalyom: buyer research turned into positioning per segment, release tiers for launches, messaging per feature (problem, value, proof), the sales enablement kit, a customer evidence program with written consent, the pricing page and win/loss inputs. Use for any task about positioning, a feature or release launch, battlecards, case studies, sales collateral, the pricing page or why deals are won and lost.
---

# Product marketing

Product marketing turns what the product does into reasons a specific buyer chooses it, and gives sales and the site the words and proof to say so. The head is `om-mega-pmm`. Every claim comes from `claims.md`; a feature with no proof is described, never sold with numbers.

## 1. Buyer research first

Read `profile.md`, `claims.md`, `LEARNINGS.md`, `research/` (ICP, JTBD, VoC, competitors) and `funnel/FUNNEL.md` before writing a line.

1. List the segments that buy today and the ones the plan targets. For each: the job, the trigger, the alternatives they compare, the words they use.
2. Source only from real material: interviews and notes the owner pastes in, support tickets, call transcripts, reviews, lost-deal reasons. Synthetic personas are hypotheses and are labelled that way.
3. Write `research/pmm/buyers.md`: one section per segment with quotes kept verbatim and their source.

## 2. Positioning per segment

For each segment, one positioning block in `research/pmm/positioning.md`: competitive alternatives, the unique capability, the value it enables, the proof (claim id from `claims.md`), the best-fit customer and the category frame. If two segments need contradictory positioning, say so and let `om-mega-strategy` decide.

## 3. Release tiering

Every release gets a tier before any asset is written, recorded in `research/pmm/releases/<release>.json`:

| Tier | When | Assets |
|---|---|---|
| 1 | New product, new segment, or a change that alters why people buy | Positioning update, launch page, email to consented users, sales briefing, battlecard updates, PR angle, social and video, customer evidence |
| 2 | A meaningful feature for an existing segment | Changelog, feature page or section, in-app or email note to affected users, sales one-pager |
| 3 | Improvements and fixes | Changelog line and release note only |

Tier 1 launches hand the calendar to `om-mega-launch`. Tiers 2 and 3 stay here.

## 4. Messaging per feature

One card per feature in `outbox/pmm/messaging/<feature>.md`: the problem in the buyer's words, the value (what they can now do), the proof (claim id, demo, case study or "no proof yet"), who it is for, who it is not for, and one line per channel. No superlatives without a claim behind them.

## 5. Sales enablement kit

`outbox/pmm/enablement/` holds: a one-page pitch per segment, discovery questions, the objection list with answers from `claims.md`, battlecards per competitor (where we win, where we lose, landmines, proof, all from public sources), a demo flow and the email snippets reps reuse. Battlecards state facts about competitors that can be checked on their own pages, with the date checked.

## 6. Customer evidence program

- References, quotes, logos and case studies only with the customer's written consent, stored as a file under `research/pmm/evidence/consents/` before any draft goes out.
- The customer approves the final text, numbers and quotes. Numbers come from the customer or from data the owner shares, never estimated.
- No invented customers, names, results, reviews or testimonials. Composite or anonymised stories are labelled.
- Each approved piece is added to `claims.md` by the owner with its proof, then reused.

## 7. Pricing page

`om-pricing-page-strategist` drafts `outbox/pmm/pricing-page.md`: plans by segment, what each includes, the value metric, the FAQ (billing, cancellation, refunds as written in policy), comparison with alternatives only where verifiable. Prices come from `product.json` or the owner. The page changes the live site only through an approval.

## 8. Win/loss inputs

Collect lost and won reasons from `funnel/pipeline.json` (lost reasons), CRM exports, call notes and cancellations. `om-buyer-research-lead` writes `research/pmm/win-loss.md` each month: top reasons by count, segment and competitor, with quotes, and the messaging or enablement change each one suggests.

## Who does what

| Agent | Work |
|---|---|
| om-mega-pmm | Owns the plan, the tiers and sign-off of every pmm draft |
| om-buyer-research-lead | Segments, buyer research, win/loss synthesis |
| om-product-marketer | Positioning blocks and feature messaging cards |
| om-release-marketer | Release tiering and the tier 2 and 3 asset sets |
| om-changelog-writer | Changelog entries and release notes |
| om-micro-release-note | One release note for one change |
| om-sales-enablement-lead | The enablement kit and rep briefings |
| om-battlecard | One battlecard per competitor |
| om-customer-evidence-manager | Consents, references, the evidence library |
| om-case-study-writer | Case studies from approved customer results |
| om-micro-proof-point | One proof point mapped to one claim id |
| om-pricing-page-strategist | Pricing page structure, copy and FAQ |

## Guardrails

- Claims only from `claims.md`. No invented numbers, testimonials, reviews or customer names.
- Nothing outbound without approval: launch emails, posts, page changes and pricing updates are drafts in `outbox/pmm/` plus an entry the owner approves in `approvals.json`; `tools/execute.mjs` executes them.
- Emails only to consented contacts. Paid launch support stays inside `budget.monthly_cap` and `budget.daily_cap`.
- Agents write results to `runs/<task-id>.json`, never to `tasks.json` or `approvals.json`.

## Measures

Win rate by segment and competitor, sales cycle length, and adoption of each launched feature by the users it was meant for, read from `funnel/`, the CRM and product exports. Each tier 1 and 2 release names its hypothesis and metric in `experiments.json`, and the result goes to `LEARNINGS.md`.
