# Trial-window forecast: Quoteflow (sample)

Task G39, om-forecaster, 2026-11-03. Window: Day 1 Tue 2026-11-03 to Day 30 Wed 2026-12-02.
Sources: plan.md §7, §8, §8a; reports/red-team.md Risk 1; reports/owner-decisions.md; metrics/kpi-tree.md.
TEST PRODUCT. Internal planning numbers only. **No number in this file goes into copy.**

## 0. Read this first

**The owner has not answered yet.** owner-decisions.md still has decision 0 (go-live date for signup plus billing tested end to end) and decision 14 (warm-network ICP count) open. So **no input below is owner-supplied.** Every input is an assumption or a plan-set date. This forecast is a stress test of the plan's own dates, not a prediction. Re-run it the day the owner answers decisions 0 and 14 (section 6).

## 1. Method

paid by Wed Dec 2 = (pre-launch trial-eligible days x trials per day + launch-day trials) x trial-to-paid rate

- **Trial-eligible days:** a trial that starts on or before Wed Nov 18 ends its 14 days by Dec 2. Source: plan.md §7 (plan rule, not owner-supplied).
- **Billing-lag caution:** kpi-tree.md counts a trial only after start + 15 days. On that rule a trial must start by Tue Nov 17, so Nov 18 trials are borderline. This forecast uses the plan's Nov 18 cut-off, which is the generous case.
- Early upgrades before the trial ends are set to 0 (assumption, no data). They would only add upside.
- Revenue: 5 paid x $19 Pro = $95 (C8). There is no Team/Pro mix data, so Pro only.

## 2. Inputs and their labels

| # | Input | Value | Label |
|---|---|---|---|
| 1 | Go-live of signup plus billing, tested end to end | Not given. Modelled: Nov 10 (plan) and Nov 13 (3 days late) | **Assumption.** Owner decision 0 open. Nov 10 is the plan date (GN-4) |
| 2 | Last trial start that can close by Dec 2 | Nov 18 | Plan rule (plan §7). Tighter kpi-tree rule: Nov 17 |
| 3 | Pre-launch trials per day (warm network, early communities, directories) | 0.5 / 1 / 2 (low / mid / high) | **Assumption.** No traffic or analytics data. Red-team notes communities need 1-3 weeks of history |
| 4 | Warm-network ICP count | Not given | **Assumption.** Decision 14 open. Plan §7 assumes 5-10 beta invitations. Input 3 implies roughly 5-30 warm trials over the 2 weeks |
| 5 | Product Hunt trials over the two eligible days (Nov 17 and 18) | 10 / 25 / 50 (low / mid / high) | **Assumption.** Red-team Risk 1 calls about 25 the top of what 2 launch days plus a small network could plausibly bring |
| 6 | Trial-to-paid | 10% and 20% | Plan §7 assumption, "unverified for this product" |
| 7 | PH date | Nov 17 (only if gates GN-1 to GN-5 pass on Nov 13) vs Dec 8 (default) | Plan §8a |
| 8 | Early upgrades | 0 | **Assumption** |

## 3. Required volume for the goal

5 paid needs about **50 trials started by Nov 18 at 10%**, or **25 at 20%**. This matches plan.md §7.

## 4. Scenarios

Expected trials started by Nov 18, then paid by Dec 2. Pre-launch days run from go-live through Nov 16.

### A. PH on Tue Nov 17, go-live Tue Nov 10 (7 pre-launch days)

| Case | Trials by Nov 18 | Paid at 10% | Paid at 20% | MRR at 10% / 20% |
|---|---|---|---|---|
| Low (0.5/day, PH 10) | 13.5 | 1.4 | 2.7 | $26 / $51 |
| Mid (1/day, PH 25) | 32 | 3.2 | 6.4 | $61 / $122 |
| High (2/day, PH 50) | 64 | **6.4** | 12.8 | $122 / $243 |

### B. PH on Tue Nov 17, go-live Fri Nov 13 (4 pre-launch days)

| Case | Trials by Nov 18 | Paid at 10% | Paid at 20% | MRR at 10% / 20% |
|---|---|---|---|---|
| Low | 12 | 1.2 | 2.4 | $23 / $46 |
| Mid | 29 | 2.9 | 5.8 | $55 / $110 |
| High | 58 | 5.8 | 11.6 | $110 / $220 |

Billing live on Nov 13 means GN-4 failed on Nov 10, and plan §8 then moves PH to Dec 8 by default. B is shown only to price a 3-day slip: about 1 to 6 trials.

### C. PH on Tue Dec 8 (default if any gate fails), go-live Nov 10

PH trials fall outside the window. Only warm and organic trials from Nov 10 to Nov 18 count (9 days).

| Case | Trials by Nov 18 | Paid at 10% | Paid at 20% | MRR at 10% / 20% |
|---|---|---|---|---|
| Low (0.5/day) | 4.5 | 0.5 | 0.9 | $9 / $17 |
| Mid (1/day) | 9 | 0.9 | 1.8 | $17 / $34 |
| High (2/day) | 18 | 1.8 | 3.6 | $34 / $68 |

Even the high case misses 5 paid at 20%.

### D. Go-live after Nov 18

Zero trial-eligible days. Paid by Dec 2 is about 0, apart from early upgrades.

## 5. Result and recommendation

- Cases that reach 5 or more paid at 10%: **one of nine** (A high, 6.4 paid). It needs 64 trials by Nov 18, above the red-team plausibility ceiling, and rests on assumed rates with no data.
- At 20%: A mid, A high, B mid and B high reach 5. All need PH on Nov 17, so the Nov 13 gates must pass first.
- The Dec 8 PH default (Scenario C) cannot reach 5 in any case.

**Recommendation: keep the $95 MRR goal in the next window (Dec 3 to Jan 1). Do not return it to Day 30.** The rule was "only if 5 or more paid at 10%". The mid case gives 3.2, and the one passing case uses the most optimistic assumptions. This agrees with red-team Risk 1 and plan.md §7. MRR stays reported with no target this window.

**What would reverse this call** (all must hold, then re-run the model):
1. Owner confirms go-live (decision 0) on or before Tue Nov 10 and billing is tested end to end (GN-4).
2. Owner's warm-network ICP count (decision 14), or a measured rate from the first beta cohort, supports at least about 2 trials a day.
3. The Nov 13 gates GN-1 to GN-5 pass, so PH stays on Nov 17.
4. The forecast of trials started by Nov 18 reaches 50 or more at 10%, using observed rates, not these assumptions.

Planning band if dates hold: about 1 to 3 paid at 10% with PH on Nov 17 ($26 to $61 MRR), and 0 to 1 paid (under $20) if PH moves to Dec 8. Order of magnitude only.

## 6. Re-run triggers

| When | Replace this assumption | With this input |
|---|---|---|
| Owner answers decision 0 (due Fri Nov 6) | Input 1 | The real go-live date. If after Nov 10, set PH to Dec 8; the goal stays in the next window |
| Owner answers decision 14 (due Fri Nov 6) | Input 4 | Real ICP count, plus the owner's labelled guess of the invite-to-trial share |
| First closed beta cohort (Nov 17 to 20) | Inputs 3 and 6 | Observed signup-to-trial and activation rates. Trial-to-paid cannot be seen before Nov 24 |
| Fri Nov 13 gate review | Input 7 | Pass or fail of GN-1 to GN-5 |

## 7. Limits

- No analytics, domain or billing account: no observed baseline for any rate.
- Expected values only. With single-digit counts, 3.2 expected paid could be 0 or 6 in practice.
- Trials per day are flat before launch; real traffic is lumpy.
- Pro $19 only; Team $49 mix and annual plans are not modelled.

Knowledge base: no fact applies to this model; the finops brief had no forecasting rule. Method: finance-skills:saas-metrics-coach.
