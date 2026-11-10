---
name: om-customer-success
description: "Run customer success and support in Whalyom: ticket taxonomy and deflection through the help center, macros in the brand voice, a health score from usage, billing and support signals, onboarding to first value, QBRs for B2B accounts, closing the voice-of-customer loop to product and marketing, NPS and CSAT done right, and escalation. Use for any task about support tickets, help docs, onboarding, account health, churn risk, surveys or customer feedback."
---

# Customer success and support

Customers who reach value stay, buy more and refer. The head is `om-mega-success`. Support answers come from policy and `claims.md`; nobody promises a refund, discount, feature date or term that the written policy does not grant.

## 1. Ticket taxonomy

Read the ticket export the owner provides (helpdesk CSV, inbox, chat logs) and tag every ticket with one category, one product area and one cause:

- Categories: how-to, bug, billing, account access, feature request, complaint, cancellation, sales question.
- Causes: missing docs, unclear UI, defect, policy, expectation set by marketing.

Write `research/success/taxonomy.json` (counts per category and cause, no personal data) and `research/success/top-drivers.md` (the ten causes with the most tickets and an example of each, anonymised).

## 2. Deflection through the help center

For each top how-to driver, `om-docs-writer` writes a help article in `outbox/success/help/<slug>.md`: the question as customers ask it, the answer first, steps with screenshots, and a link to contact support. `om-micro-faq-from-tickets` turns repeated questions into FAQ entries. `om-support-deflection` links the articles from the place the question arises (the form, the app screen, the chat widget). Deflection means the customer got the answer; a hidden contact button is not deflection.

## 3. Macros in brand voice

`outbox/success/macros/<id>.md` holds one macro per common case: greeting, the answer, the next step, the sign-off. Each macro follows `voice.json`, uses only facts from `claims.md` and the policy pages, and has a field the agent must personalise. Refund, cancellation and complaint macros quote the policy text and route to a person when the case falls outside it.

## 4. Health score

`om-health-score-designer` defines the score in `research/success/health.json` from signals the owner can export:

- Usage: logins or orders, key feature used, seats active, trend over 30 days.
- Billing: failed payments, downgrade, plan changes, renewal date.
- Support: open tickets, complaints, unresolved escalations, survey replies.

Weights start simple and documented, then are checked against real churn once there are enough outcomes. Accounts go green, amber or red; red accounts become save tasks for `om-churn-preventer` or a person.

## 5. Onboarding to first value

Define the first-value moment per segment (the first report sent, the first order shipped, the first booking). `om-success-onboarding-manager` writes the path in `outbox/success/onboarding/`: the steps, the help article per step, the check-in message when a customer stalls, and the hand-raise point to a person. `om-customer-education` builds short lessons for the steps that cause the most tickets.

## 6. QBRs for B2B accounts

`om-qbr-builder` drafts a quarterly business review per key account in `outbox/success/qbr/<account>.md`: goals agreed last time, usage and outcomes from the account's own data, open issues and their status, recommendations, and the next quarter's goals. Numbers come from exports, never estimates.

## 7. Closing the voice-of-customer loop

`om-voc-loop-manager` writes `research/success/voc.md` every month: top requests and complaints with counts and anonymised quotes, routed to product (bugs, requests), marketing (expectations set wrong, new proof, words customers use) and `om-mega-pmm` (win/loss input). When a requested fix ships, the customers who asked are told, with approval and consent.

## 8. NPS and CSAT done right

- Ask after a real moment (ticket closed, onboarding done, 90 days in), not on a fixed blast.
- One rating question plus one open question. Report the score with the response count and response rate.
- Read every comment; the reasons matter more than the score.
- Never ask only happy customers for reviews, never offer rewards for high scores, never gate review links by score.

## 9. Escalation

Escalate to a person at once on: legal threats, safety, privacy and data requests, chargebacks, press or public complaints, and any refund or exception outside policy. Write the case to `outbox/success/escalations/<id>.md` with the summary, history and what was promised so far.

## Who does what

| Agent | Work |
|---|---|
| om-mega-success | Plan, priorities, escalation rules, sign-off |
| om-support-deflection | Deflection placement and its tracking |
| om-docs-writer | Help center articles |
| om-micro-faq-from-tickets | FAQ entries from repeated tickets |
| om-support-macro-writer | Macros in brand voice |
| om-micro-support-macro | One macro for one case |
| om-health-score-designer | Health score model and bands |
| om-success-onboarding-manager | Onboarding path to first value |
| om-customer-education | Lessons and academy content |
| om-qbr-builder | QBR decks for key accounts |
| om-voc-loop-manager | VoC report and routing |
| om-nps-survey | NPS and CSAT surveys and summaries |

## Guardrails

- Claims and answers only from `claims.md` and the written policies. No promised refunds, credits, dates or terms outside policy. No invented numbers, testimonials, reviews or customer names.
- Nothing sent without approval: replies, surveys, check-ins and published help pages are drafts plus an entry in `approvals.json`, executed by `tools/execute.mjs`, unless earned autonomy covers that type and channel.
- Consent for every contact; survey and check-in emails respect unsubscribes and suppression. Personal data stays in the workspace files that already hold it, never in reports.
- Agents write results to `runs/<task-id>.json`, never to `tasks.json` or `approvals.json`.

## Measures

Ticket volume per customer by category, share of how-to tickets resolved by an article, first response and resolution time, time to first value, health score distribution and its accuracy against real churn, gross and net retention, and NPS or CSAT with response counts. Changes are logged as experiments in `experiments.json`.
