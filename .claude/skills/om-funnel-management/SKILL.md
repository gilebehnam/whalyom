---
name: om-funnel-management
description: Manage the lead pipeline in Whalyom: how many leads arrive, which stage each one is in and for how long, which channels turn leads into sales, and what happens next. Covers the stage model, the funnel ledger, how agents record stage changes, SLAs, stuck leads and the funnel report. Use for any task about leads, pipeline, funnel stages, conversion rates or whether leads became sales.
---

# Funnel management

One ledger per product follows every lead from first touch to sale: `products/<slug>/funnel/pipeline.json`, kept by `tools/funnel.mjs` (single writer, like `apply-results.mjs`). The daemon runs it every cycle.

## Stages

| Stage | Means | Typical words mapped to it |
|---|---|---|
| new | A person became a lead (form, signup, inquiry) | lead, signup, subscribed, call_or_form |
| contacted | We replied (after the owner approved and sent it) | sent, first_reply, called |
| engaged | They answered or acted | replied, clicked, activated |
| qualified | Need, fit and timing confirmed | mql, sql, pql, quote |
| opportunity | A concrete next step to buy | demo, booked, proposal, trial, add_to_cart, checkout |
| won | They paid | purchase, paid, customer, trial_to_paid, booked_job |
| nurture | Not now; stays in a consented sequence | not_now, later |
| lost | No, or gone | closed_lost, unsubscribed, refunded, spam |

Stages move forward only (an old CRM row cannot pull a customer back), except nurture and lost, which apply at any time. Each `won` adds an order and its value; repeat purchases count again.

## Recording a stage change

Agents never edit the ledger. Write `funnel/updates/<task-id>.json`:

```json
[{ "lead": "lead id or email", "stage": "contacted", "at": "2026-11-04T10:00:00Z", "source": "om-speed-to-lead", "note": "first reply sent after approval" }]
```

CSV with the header `lead,stage,at,value,source,note` works too, as do CRM or order exports dropped there by the owner or n8n. A `won` row carries `value` and `currency`; `source` owner, crm, shopify or stripe marks the revenue as verified. With `STRIPE_API_KEY` set, paid charges are matched to leads by email automatically.

Only record what happened: a draft is not contacted until it was sent; a click is not a sale.

## Reading the funnel

```bash
node tools/funnel.mjs <slug>
```

- `funnel/FUNNEL.md`: leads, sales, lead-to-sale rate, revenue (verified and reported), speed to lead, time to sale, the stage table, channels from visit to lead to sale, weekly cohorts, why leads were lost.
- `funnel/next-actions.json`: every new or overdue lead with the agent that should act next (new → om-speed-to-lead, contacted → om-follow-up, engaged → om-sdr, qualified → om-checkout-finisher, opportunity → om-follow-up or om-cart-recovery for stores, nurture → om-email-nurture, lost after 60 days → om-winback, consented leads only).
- Alerts in Needs-You-Know: new leads past the reply limit (critical), leads stuck past their stage limit, and customers won in the last 24 hours.

## SLAs

Hours a lead may wait per stage: new 24, contacted 72, engaged 168, qualified 336, opportunity 504, nurture and lost 1440. The owner overrides them in `product.json` → `funnel_sla`.

## What to look at first

1. Uncontacted leads past the limit: fix before anything else.
2. The biggest leak: the stage with the lowest conversion from the previous one.
3. Channels ranked by sales and revenue per lead, not by lead count.
4. Payments with no tracked lead: buyers the capture or tracking missed.

## Personal data

The ledger keeps the lead id and a hash of the email, never the address. Contact details stay in `leads.jsonl`. The dashboard and live page get counts only.
