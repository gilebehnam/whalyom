# Pricing intel: Quoteflow (sample)

Task O15 by om-pricing-intel, 2026-11-02. Updated by T5 (om-pricing-intel), 2026-11-03. Reconciled by K1 (om-knowledge-keeper), 2026-11-03: one competitor price table, this file only. TEST PRODUCT: brief.md says Quoteflow does not exist. Nothing here may be published. Internal research only.

competitors.md no longer holds prices. It points here.

## Status and method
- No domain yet, so the Quoteflow live pricing page is still **pending**.
- Our prices come from brief.md (owner). They are the only verified Quoteflow prices (claims C7 to C10).
- K1 (2026-11-03) opened all four vendor pricing pages with a page-reading tool: hellobonsai.com/pricing, proposify.com/pricing, honeybook.com/pricing, pandadoc.com/pricing. **All four loaded.** The T5 blocks (Bonsai 403, Proposify 403) were not reproduced today. The first HoneyBook and PandaDoc reads returned a domain-check error; the retry with honeybook.com/pricing and pandadoc.com/pricing loaded.
- Every read is a text summary, not a screenshot or a logged-in view. The summaries are not identical to what the page renders. No row is a claim source until the conflict rows are re-read by hand (section 5).
- Status key:
  - **verified**: a vendor page was loaded on 2026-11-03 and no current source contradicts the value.
  - **conflict**: two sources disagree. Both values are shown in the row and in section 2b.
  - **unverified**: search snippets only. None remain in the table.
- Old price sets (HoneyBook help-centre and third-party figures, Bonsai's older Starter/Professional/Business tiers) are superseded by the live pages. They are not counted as sources. Section 2b lists them so nobody reuses them.
- Competitor claims in claims.md (C16 "cheaper than", C18 counts) stay **needs-proof**. This file does not change that.

## 1. Our price points (verified, brief.md)
| Plan | Price | Limit or seats | Claim id |
|---|---|---|---|
| Free | $0 | 3 proposals/month | C7 |
| Pro | $19/month | Proposal limit not stated (open question) | C8 |
| Team | $49/month | 5 seats | C9 |
| Trial | 14 days of Pro | Card requirement not stated | C10, C19 (needs-proof) |

Derived (arithmetic on verified prices only): Team at 5 seats is $9.80 per seat per month if all 5 seats are used. Pro is $19 for one user.

## 2. Competitor price table (one table, USD)

All prices are USD as shown on each vendor's US page. No page names a currency except through "$". Checked date for every row: 2026-11-03.

### 2a. Table

| Vendor | Plan | Monthly price | Annual price | Seat basis | Free plan | Trial | Card required | Source URL | Checked | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Bonsai | Basic | $15/user/mo | $9/user/mo, billed annually | Per user | No | 7 days, full access | Not at sign-up; asked after the trial | https://www.hellobonsai.com/pricing | 2026-11-03 | verified | No proposals on this plan. Page says "Start for free", which leads to the trial. |
| Bonsai | Essentials | $25/user/mo | $19/user/mo, billed annually | Per user | No | 7 days | Not at sign-up | https://www.hellobonsai.com/pricing | 2026-11-03 | verified | Proposals and contracts, templates and forms start here. Minimum users not stated. |
| Bonsai | Premium | $39/user/mo | $29/user/mo, billed annually | Per user | No | 7 days | Not at sign-up | https://www.hellobonsai.com/pricing | 2026-11-03 | verified | Adds pipeline, custom fields, integrations, removal of Bonsai branding. |
| Bonsai | Elite | $59/user/mo | $49/user/mo, billed annually | Per user, 3-user minimum | No | 7 days | Not at sign-up | https://www.hellobonsai.com/pricing | 2026-11-03 | verified | Custom permissions. |
| HoneyBook | Starter | Not shown (page shows billed-yearly price only) | $29/mo, billed yearly | Not stated | No | 30 days (FAQ) | No (FAQ) | https://www.honeybook.com/pricing | 2026-11-03 | verified | Proposals on all plans, no count stated. Monthly-billed rate not labelled on page. |
| HoneyBook | Essentials | Not shown | $49/mo, billed yearly | Up to 2 team members | No | 30 days (FAQ) | No (FAQ) | https://www.honeybook.com/pricing | 2026-11-03 | verified | Page shows an unlabelled $59 strikethrough next to it. Not a monthly price we can quote. |
| HoneyBook | Premium | Not shown | $109/mo, billed yearly | Unlimited team members | No | 30 days (FAQ) | No (FAQ) | https://www.honeybook.com/pricing | 2026-11-03 | verified | Page shows an unlabelled $129 strikethrough next to it. |
| PandaDoc | Free | $0 | $0 | Free for you and your team; 5 documents/month shared limit | Yes | None needed | No | https://www.pandadoc.com/pricing/ | 2026-11-03 | verified | Limited API calls count toward the 5. Templates up to 5. |
| PandaDoc | Starter | Not shown separately | $19/seat/mo, billed annually | Per seat | No | 14 days (FAQ; page does not tie it to a plan) | No | https://www.pandadoc.com/pricing/ | 2026-11-03 | verified | Unlimited uploads and e-signatures. API and automations need Usage Credits. |
| PandaDoc | Business | Not shown separately | $49/seat/mo, billed annually | Per seat | No | **conflict**: 14 days (competitors.md, T3) vs not stated (T5 and K1 reads; CTA is "Request a demo") | "No credit card required" under the demo CTA (T5, K1) | https://www.pandadoc.com/pricing/ | 2026-11-03 | conflict | Price is consistent across sources. Trial length is not. Payment collection listed on Business (competitors.md, T3). |
| Proposify | Build | $49/user/mo | $39/user/mo ($468/user/yr) | Per user | No | 14 days | No ("14 day trial, no card needed") | https://www.proposify.com/pricing | 2026-11-03 | **conflict** | Annual: $39 on the live page (T3 and K1 both read it) vs **$41** in the T5 search summary (labelled "Team"). See 2b. |
| Proposify | Grow | $65/user/mo | $65/user/mo, billed annually (same figure as monthly) | Per user; extra users $780/yr | No | Not listed ("Book a demo") | Not stated | https://www.proposify.com/pricing | 2026-11-03 | **conflict** | Page shows $65 for both monthly and annual, which no discount structure explains. T3 flagged the cell as ambiguous; K1 read the same. Not in any search summary. |
| Proposify | Scale | $107/user/mo | Not listed separately; platform fee $12,800/yr includes 10 users | Per user; platform fee | No | Not listed ("Book a demo") | Not stated | https://www.proposify.com/pricing | 2026-11-03 | verified | Monthly price from the page (T3 and K1). SSO, multiple workspaces, dedicated success manager. |

Notes that apply to the whole table:
- Free plan: no vendor page offers a named free plan except PandaDoc Free. Bonsai and HoneyBook have no free tier. Proposify's "Get started for free, no credit-card needed" button leads to a trial.
- Trial and card: a card is not needed to start on Bonsai (asked after 7 days), HoneyBook (FAQ), PandaDoc Starter, and Proposify Build. PandaDoc Business is in conflict (above).
- PandaDoc Enterprise ("Let's talk") is not in the table.

### 2b. Conflicts to resolve (both values kept)
1. **Proposify Build annual**: $39/user/mo on the live page (T3, K1) vs $41/user/mo in the T5 search summary (plan named "Team"). The page is the source. The summary may be from an older price.
2. **Proposify Grow annual**: the page shows $65 for both monthly and annual. T3 said the cell was ambiguous. Value not resolved.
3. **Proposify plan names and send limits**: the pricing section uses Build, Grow, Scale. The send-limit table uses Basic, Team, Business, Enterprise (10, 30 and 75 included sends per month, per K1 read). The T5 summary says "Basic capped at 5 sends/month" and names Basic $29 and Team $49. Neither the $29 plan nor a 5-send limit is on the live page. Plan-to-limit mapping not resolved.
4. **PandaDoc Business trial**: "14 days on Starter and Business" (competitors.md, T3) vs "not stated" (T5, K1). The FAQ's 14-day trial is not tied to a plan.

### 2c. Superseded sets (do not use)
- **HoneyBook older sets**: help-centre Starter $19 and Essentials $39 monthly ($16 and $32 annual); third-party Starter $36 and Essentials $59 ($29 and $49 annual). The live page says $29, $49 and $109 per month, billed yearly. Older trial length of 7 days is also superseded by the live 30-day FAQ.
- **Bonsai older tiers**: third-party reviews name Starter, Professional and Business at about $24-25, $39 and $79. Stale. The live page has Basic, Essentials, Premium and Elite.
- **Bonsai search snippets** (T5, 2026-11-03): Basic $15/$9, Essentials $25/$19, Premium $39/$29, Elite $59/$49. These match the live page, so they are not conflicts.

### 2d. Other price-like figures (internal, not for copy)
- Proposify custom template design on Build: $1,500 (T3 read; not re-checked by K1).
- HoneyBook card processing: FAQ says 2.7% + 10c; the plan table says 2.9% + 25c (inconsistent on the page). ACH 1.5% (T3 read). Do not quote.
- PandaDoc annual billing: the page says "Save up to 46%" (K1 read of the toggle; the figure is the page's own maximum, not a per-plan saving).

## 3. What the comparison shows (internal reading, not a claim)
- **Entry price:** Pro at $19 for one user is below HoneyBook Starter ($29 billed yearly, verified). Pro is level with PandaDoc Starter ($19 per seat billed annually, verified) and Bonsai Essentials on annual billing ($19 per user, verified). Bonsai Essentials is $25 per user monthly, which is above Pro. Proposify's lowest verified tier is Build at $49 per user monthly, with the annual figure in conflict. C16 stays needs-proof.
- **Team cost at 5 seats (verified rows only):**
  - PandaDoc Business: $245/mo billed annually (5 x $49).
  - Bonsai Essentials: $95/mo billed annually, $125/mo monthly (5 x $19 and 5 x $25). This is the figure the earlier $95 to $125 estimate was about. It now rests on a verified Bonsai row.
  - HoneyBook Premium: $109/mo billed yearly for unlimited members. HoneyBook Essentials covers only 2 members, so a 5-person team needs Premium.
  - Proposify Build: 5 x $49 = $245 monthly. Annual is in conflict.
  - Quoteflow Team: $49/month for 5 seats (C9), or $9.80 per seat.
  - This is an internal angle, not copy.
- **Free tier:** Quoteflow (3 proposals/month, C7) and PandaDoc Free (5 documents/month, shared) are the only competitors with a free plan. Bonsai, HoneyBook and Proposify have none.
- **Trial:** Our Pro trial is 14 days (C10). HoneyBook is 30 days with no card (FAQ). Bonsai is 7 days, with card details asked after the trial. PandaDoc Starter is 14 days with no card. Proposify Build is 14 days with no card. Our card requirement is unknown (C19). PandaDoc Business is in conflict.
- **Gaps:** Pro has no stated proposal limit. Annual prices for Quoteflow, currencies (GBP, CAD, AUD), VAT or GST, and per-extra-seat price are unknown (profile.md section 6, claim C14). No vendor page shows GBP, CAD or AUD prices. HoneyBook's country selector lists GBP, CAD and AUD, but the prices stay USD.

## 4. Pricing model recommendation (for owner decision, no price change proposed)
- Keep the current model: freemium with a volume cap (3 proposals/month), then flat Pro and Team tiers. This fits the value metric (proposals sent), and the Team tier sells seats for small agencies. No change to price is proposed in this task.
- Open question for the owner: what does Pro add over Free besides volume. Without a Pro limit or feature gate, the anchor between Free and Pro is weak.
- Trial length: the verified HoneyBook trial is 30 days and Bonsai's is 7. Our 14-day trial sits between them. Owner decision, not a recommendation to change it here.
- Annual prepay discount: not in the brief. Common SaaS practice is 15 to 25% (general guidance from kj-pricing-strategy, not a verified claim). Any annual price is a price change and needs owner approval (product.json owner_approval.price_change). Do not publish a number.
- Anchoring: Team at $49 for 5 seats is well below verified PandaDoc Business at 5 seats ($245/mo annual). Showing that comparison needs the PandaDoc page to stay unchanged and a dated citation, and it is still C16, so keep it internal.
- Discounts: see discount-marketing-strategy. No discount is proposed. Founding-user or trial-extension offers would count as discounts and need approval.

## 5. Pending
- Quoteflow live pricing page (needs domain).
- **Re-check by hand (open the pages in a browser, not a summary):** the four conflict rows in 2b. Toggle monthly and annual on each page and record each cell. Check Proposify's send-limit table against its plan names. Check the PandaDoc Business trial on the page and in the FAQ.
- HoneyBook: monthly-billed prices (use the "Billed monthly" toggle) and the proposal limit are not confirmed. GBP, CAD and AUD prices were not shown. Check the country selector pages.
- PandaDoc: monthly-billed prices for Starter and Business are not separate on the page. GBP, CAD and AUD prices were not shown.
- Owner decisions: Pro proposal limit or feature gate; annual price; currency for UK, CA, AU; VAT or GST; trial card requirement (C19); per-extra-seat price; trial length (14 days vs HoneyBook's 30 and Bonsai's 7).

## 6. Experiments (planned, not run)
- E-O15-1 (see runs/O15.json): Test whether the 3-proposal free cap or the 14-day Pro trial is the main driver of trial signups. Metric: trial signups per 1,000 visitors on the pricing page, once a domain exists. Needs a published page, so it is blocked until the owner approves.

## Sources (checked 2026-11-03)
- https://www.hellobonsai.com/pricing: loaded by K1. Matches T3 and the T5 snippets. Verified.
- https://www.proposify.com/pricing: loaded by K1. Matches T3 except the Grow annual cell. Conflicts in 2b.
- https://www.honeybook.com/pricing: loaded by K1 on retry. Matches T3 and T5. Verified (USD page).
- https://www.pandadoc.com/pricing/: loaded by K1 on retry. Matches T3 and T5 on price. Business trial in conflict.
- https://support.proposify.com/hc/en-us/articles/37747171357979-Subscription-plans-and-pricing: T5 got a 403. Not re-read by K1. Not used.
