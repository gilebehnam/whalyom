# KPI tree: Quoteflow (sample), 30-day window

Written by om-kpi-definer (task G02), 2026-11-03. Window: Day 1 Tue 2026-11-03 to Day 30 Wed 2026-12-02 (plan.md rev 3).

> TEST PRODUCT. Nothing is published. There is no live data: no domain, no analytics account (accounts.analytics is null), no payments account (accounts.payments is null), and no confirmed app events. Every target below is an **assumption** unless it is marked as an owner goal. No rate has an observed baseline.

## 1. Game and north star

**Game: Productivity.** The product helps a freelancer finish one job faster: turn a client brief into a priced, signable proposal with a deposit request. The transaction parts (signature, deposit) are inside that job, not the business model.

**Company north star: MRR** (product.json `north_star: revenue`; plan.md §1). Keep it as the top line, reported weekly. It is lagging: no paid subscription can exist before the first trials close, so it cannot steer this window.

**Steering metric for this window: activated accounts.** An account counts when it sends its first proposal to a client (`proposal_sent`) within 7 days of `sign_up`, counted in closed 7-day cohorts. Checked against the skill's criteria:

| Criterion | Activated accounts |
|---|---|
| Easy to understand | Yes: "signed up, sent a proposal within a week" |
| Customer-centric | Yes: the first proposal is the value moment (C2-C6) |
| Sustainable value | Partly: it shows habit only once repeat sends are measured (add in the next window) |
| Vision alignment | Yes: it is the first step toward a paid proposal tool |
| Quantitative | Yes: app database events |
| Actionable | Yes: first-run spec (G10), beta (G40), trial emails (G11) |
| Leading indicator | Yes: it comes before trial and paid, and plan.md §5 names it the decision metric |

Known weakness: MRR fails criterion 2 (revenue, not customer value). That is why it stays the business KPI and activated accounts steer the window. Owner decision (see §5).

## 2. Tree

```
MRR (business KPI, reported weekly, no target this window)
 └─ Paid subscriptions (lag of 14 days after trial start)
     └─ Step 4: trial_to_paid rate            [input I5]
         └─ Step 3: trial_started             [input I4 = trial start rate from signup]
             └─ Step 3: activated accounts    [PRIMARY steering metric, input I3]
                 └─ Step 2: sign_up           [input I2 = visit-to-signup rate]
                     └─ Step 1: visitors      [input I1]
```

Five inputs, one per funnel step plus the top of funnel:

| Input | Step | Metric | Why it moves |
|---|---|---|---|
| I1 | Visit | Visitors by first-touch source | Distribution (PH, directories, communities, warm network, SEO/GEO) |
| I2 | Visit to signup | Visit-to-signup rate | Landing (A/B drafts G05), pricing clarity, signup friction (G09) |
| I3 | Signup to activated | Activation rate (`proposal_sent` within 7 days) | First-run flow (G10), empty states, beta fixes (G40) |
| I4 | Signup to trial | Trial start rate (`trial_started` / sign_up) | Trial path, card requirement (C19), free vs trial choice (decision 12) |
| I5 | Trial to paid | Trial-to-paid rate (closed 14-day cohorts) | Pro definition (decision 4), trial emails (G11) |

## 3. Definitions and closed-window rules

| Metric | Formula | Source (event) | Counts when | Closed-window rule |
|---|---|---|---|---|
| Visitors (I1) | Distinct visitor ids on the marketing site per week, tagged by first-touch `utm_source`, else referrer class | GA4 `page_view` (install is G07/T6, blocked on domain) | Each visitor once per week | Report closed weeks only (Mon-Sun) |
| Visit-to-signup (I2) | `sign_up` accounts whose first-touch visitor matches / visitors, same week | GA4 + app `sign_up` with first-touch UTM stored at signup (tracking §4) | Account created | Week closed; signups up to 7 days after week end attributed to that week; late ones shown as pending |
| Activated accounts (steering) | Accounts with `proposal_sent` at most 7 days after their `sign_up` | App DB, server-confirmed: `sign_up`, `proposal_sent` | First proposal link sent to a client | Cohort = signups in a Mon-Sun week. Closes at last signup + 7 days. Open cohorts are "pending", not failures |
| Activation rate (I3) | Activated accounts / signups in the same closed cohort | As above | As above | Rate shown only for closed cohorts |
| Trial start rate (I4) | `trial_started` accounts / signups in the same closed cohort | App DB, server-confirmed trial flag | Pro 14-day trial confirmed in backend | Same cohort rule as I3 |
| Trial-to-paid (I5) | Accounts with `subscription_started` within 14 days of `trial_started` / `trial_started` accounts | App DB + billing (not set up, decision 3) | First paid Pro or Team charge confirmed | Trials count only when `trial_started` + 15 days has passed (14-day trial plus 1 day billing lag). A cancel before conversion counts as not converted |
| MRR | Sum of monthly price of active paid subscriptions at snapshot: Pro $19 x n + Team $49 x n (C8, C9) | Billing (not set up) | Active paid, not in trial, not free. Annual plans normalised /12 if sold (not in brief) | Weekly snapshot (Mon). No target this window |
| trial_started count | Count of server-confirmed trials | App DB | Trial starts in window | Reported as a count, not a rate |

Rules that apply to all rates:
- USD only until C14 is verified (tracking §3).
- No rate is read with fewer than 10 closed-cohort members. Below 10, report the count only (plan §7 uses counts for the same reason).
- No client names, emails or brief text in any metric export (tracking §3).
- Weekly scorecard (G36) reports "no data" for any metric whose source is not live.

## 4. 30-day targets (all assumptions unless marked)

Two scenarios, because the launch date depends on the gates (plan §8a):
- **A:** gates pass by Fri 2026-11-13, public launch on PH Tue 2026-11-17, about 15 days of public traffic.
- **B:** gates fail, beta only, public launch Tue 2026-12-08 (plan default). Visitors come from SEO/GEO, the warm network and communities.

| Metric | A target by Dec 2 | B target by Dec 2 | Basis |
|---|---|---|---|
| Visitors (I1) | 1,500 | 300 | Assumption. No baseline; A assumes PH day plus directories and communities |
| Visit-to-signup (I2) | 3% (range 2-5%) | 3% | Assumption. Plan §7 uses 2-5% for visit-to-trial, not verified |
| Signups (derived) | about 45 | about 9 | I1 x I2 |
| Activation rate (I3), closed cohorts | 30% | 30% | Assumption. Only first-hand evidence will be the closed beta |
| Activated accounts (steering) | 10 (signups through Nov 25) | 5 (beta gate, GN-2) | A: beta users plus about 5 public. B: beta gate, not a target |
| Trial start rate (I4) | 80% | 80% | Assumption. Depends on card requirement (C19) and decision 12 |
| trial_started count | about 36 vs owner goal 50 | about 7 | Derived. See gap note below |
| Trial-to-paid (I5), closed cohorts | 10% (range 10-20%) | 10% | Plan §7 assumption. No mechanism until decision 4 is answered |
| Paid subscriptions by Dec 2 | 0-2 (no target) | 0 | Derived. Only trials started by about Nov 18 can close inside the window |
| MRR | Reported, no target | Reported, no target | Plan §1: $95 MRR (5 Pro) moves to the next window, Dec 3 to Jan 1 (E-O18-5) |
| trial_started (owner goal) | 50 | 50 | product.json `goals.primary`. Owner goal, not an OM assumption |

**Gap note.** Under the A assumptions, trial_started reaches about 36, not 50. To reach 50 at 3% visit-to-signup and 80% trial start, the window needs about 2,100 visitors. That is about 40% more than the A assumption. Owner goal stays at 50; the forecast (G39) should test whether 2,100 visitors is realistic.

## 5. Decisions the owner must make before these targets are used

1. **North star.** Accept MRR as the business KPI and activated accounts as the window steering metric (this document), or make activated accounts the north star. (Plan §1 already does the first.)
2. **Free-plan signup.** Is a free `sign_up` a conversion or only a trial start (plan §12 Q12)? This changes I2 and I4.
3. **Trial card requirement** (C19). Changes I4.
4. **Payments.** Is subscription billing live and tested? Without it I5 and MRR cannot be measured (plan §12 Q3, GN-4).
5. **Targets in §4.** Confirm or replace them; product.json `target_30d` is null (plan §12 Q13).
6. **Output path.** The G02 task brief says `metrics/kpi-tree.md`; the run instruction says `reports/kpi-tree.md`. This file is at `reports/kpi-tree.md`. G08, G36, G37 and G39 read `metrics/kpi-tree.md`. The main session should choose one path and fix those references. No copy was written, so there is one source of truth.

## 6. Data readiness (today)

| Input | Source | Status |
|---|---|---|
| Visitors, visit-to-signup | GA4, Search Console | Not installed (accounts.analytics null; blocked on domain) |
| sign_up, trial_started, proposal_sent | App database, server events | App not confirmed to exist (plan §3, G01 question 0) |
| subscription_started, MRR | Billing tool | Not set up (accounts.payments null; plan decision 3) |
| First-touch UTM | Registry G08, cookie per tracking §4 | Not built |

Nothing in this file is observed. The window's numbers will be "no data" until the app and tracking are live.
