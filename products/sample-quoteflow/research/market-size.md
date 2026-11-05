# Market size: Quoteflow (sample)

Task O5, 2026-11-02. Sources: brief.md, product.json, profile.md, claims.md, two web searches (secondary sources only). No domain, so nothing from the live site.
TEST PRODUCT (fictional per brief.md). Nothing here is for publication.

Legend: DATA = from a cited source. ASSUMPTION = my estimate, not data. Every number below that is not marked DATA is an assumption and needs validation.

## 1. Market definition
- Problem: turning a client brief into a priced, signed proposal plus deposit request (C2-C6, verified).
- Customers: freelance designers, developers, marketers; agencies of 2-10 people (C11).
- Geography: US, UK, CA, AU. EU is excluded until the owner confirms (C13 needs-proof; discrepancy between product.json and brief.md).
- Value basis: annual subscription revenue at list price (Pro $19/mo = $228/yr; Team $49/mo = $588/yr; Free = $0). Source: C7-C9 (verified). Annual pricing, local currencies and extra seats are unknown, so list USD monthly x 12 is used.

## 2. TAM (bottom-up, 4 markets)
Accounts that regularly send proposals, if every one paid list price.

| Market | Anchor | Proposal-sending accounts (ASSUMPTION) |
|---|---|---|
| US | DATA: Upwork reports 64M Americans freelanced in 2023 ([MarketScreener copy of Upwork release](https://uk.marketscreener.com/quote/stock/UPWORK-INC-46415520/news/Upwork-Study-Finds-64-Million-Americans-Freelanced-in-2023-Adding-1-27-Trillion-to-U-S-Economy-45549837)). This is a broad definition including side gigs; 2025 estimates of 72.9-76.4M come from secondary sites and are unverified. | 1.6M (about 2.5% of the broad count: professional/creative/dev/marketing freelancers who write proposals) |
| UK | DATA: about 4.38M self-employed, Q4 2025, ONS figures via [Statista](https://statista.com/statistics/318234/united-kingdom-self-employed). Contested methodology ([IFS via WRP](https://www.wrp.uk.com/news/latest-news-for-business/archive/news-article/2025/December/self-employed-overcounted-for-decades-by-official-data)). | 0.45M (about 10% of self-employed) |
| CA | Not searched. | 0.20M |
| AU | Not searched. | 0.25M |
| Total | | 2.5M accounts |

Split (ASSUMPTION): 2.35M solo freelancers at Pro price, 0.15M small agencies at Team price.
- Solo: 2.35M x $228 = $536M
- Agencies: 0.15M x $588 = $88M
- **TAM bottom-up: about $0.62B per year (range $0.3B-$1.0B)**

Top-down cross-check: NOT DONE. The searches returned no usable proposal-software market report, and vendor-sold market reports are unreliable. Pending: check a credible analyst figure for proposal/e-sign/freelancer-management software and reconcile. Until then the TAM is a single-method estimate with wide error.

## 3. SAM
Portion that would pay for a dedicated proposal tool and that a free-mode, English-language, no-integration product can reach.
- Pay-for-dedicated-tool share: 30% (ASSUMPTION). Most freelancers use docs, Canva or Notion templates, or a suite they already pay for.
- Reachable by free channels and English: folded into the 30%.
- SAM accounts: about 750k. **SAM about $0.19B per year (range $0.09B-$0.33B), about 30% of TAM.**
- Excluded: EU, non-English markets, sales teams (PandaDoc territory), event/wedding businesses (profile.md).

## 4. SOM (year 3, free mode, $0 ad cap)
- Share of SAM accounts won: 0.1% base (0.05% low, 0.3% high) (ASSUMPTION). Basis: pre-launch, no customers, no proof, no integrations, four established competitors, organic channels only.
- Base: 750 paying accounts x about $270 blended (mostly Pro, some Team) = **about $0.2M ARR** (range $0.1M-$0.6M), about 0.1% of SAM.
- Sanity check against the 30-day goal: 50 trial signups at an assumed 15% trial-to-paid = about 7 paying accounts, roughly $1.9k ARR. Reaching 750 payers in 3 years needs about 21 net new payers a month, which means about 140 trial signups a month at 15%. This is the number to test first.

## 5. Summary

| Metric | Current estimate | 2-3 year projection |
|---|---|---|
| TAM | about $0.62B (range $0.3-1.0B) | Not projected with data. Assumed flat to +5-8%/yr with freelancer growth (ASSUMPTION, low confidence). |
| SAM | about $0.19B | About $0.2-0.25B if tool adoption rises (ASSUMPTION). |
| SOM | about $0.2M ARR | Year 1 about $0.03-0.06M ARR, year 3 about $0.2M (ASSUMPTION). |

## 6. Growth drivers and risks
- Drivers: growth in independent work (Upwork and MBO figures point up but are secondary and definition-dependent); small teams wanting one narrow tool instead of a suite; AI-drafted scopes (unverified).
- Risks: free tiers and bundled proposal features in suites (Bonsai, HoneyBook) and e-sign tools; payment collection not verified (C15), so "deposit request" may be weaker than a built-in payment; price compression at $19/mo.

## 7. Assumptions and confidence

| # | Assumption | Confidence | How to validate |
|---|---|---|---|
| 1 | Proposal-sending share of broad US freelancer count is 2.5% | Low | Use BLS occupation counts (designers, developers, marketing consultants) plus a survey question |
| 2 | UK 10%, CA 0.2M, AU 0.25M | Low | Search Statistics Canada and ABS self-employed counts (not searched) |
| 3 | 0.15M agencies at Team price | Low | Business-count data (US Census, UK ONS) for 2-10 person creative/dev/marketing firms |
| 4 | List price x 12 with no discounts, FX, annual plans or extra seats | Medium | Owner to confirm pricing details |
| 5 | 30% would pay for a dedicated tool | Low | Interviews with 15-20 freelancers; the first trial funnel |
| 6 | 0.1% share and 15% trial-to-paid | Low | Experiment results from the first 50-100 trial signups |
| 7 | Free plan (3 proposals/month) users are zero revenue | High | Arithmetic from C7 |

What would move the numbers most: assumption 1 (TAM scales linearly with it), assumption 5, and whether EU is added (C13).

## Pending
- Top-down figure and reconciliation (needs a credible analyst source).
- CA and AU official counts.
- Competitor user counts and pricing (unverified, research/competitors.md).
- Owner: EU yes/no, currencies, annual pricing, Pro limits.
- Site-based checks: no domain.
