# Plan: Quoteflow (sample), 30 days (revision 3)

Written by om-cmo. O18 wrote the first version on 2026-11-02. O20 revised it on 2026-11-02T19:14:07Z after the red-team review (reports/red-team.md, O19). T39 made revision 3 on 2026-11-02T19:55Z. It adds explicit go/no-go lines (§8a), names G33 as the owner of the interview gate, ties the decision-4 blocker to T41, and flags that the task list is over the 40-task cap (§13). Window: **Day 1 = Tue 2026-11-03, Day 30 = Wed 2026-12-02.**
Missing input: reports/owner-decisions.md does not exist yet (G01/T41 not run). Every owner decision below is still open, and no date in this plan has been confirmed by the owner.
Method: marketing-skills:marketing-plan (AARRR structure, compounding-portfolio logic, leading indicators, kill criteria), cut down from 12 months to 30 days.
Sources: brief.md (owner, source of truth), product.json, profile.md, claims.md, LEARNINGS.md (empty, no experiments yet), research/ (positioning, icp, keywords, serp, communities, pricing-intel, tracking, risks), reports/red-team.md. No playbooks exist yet in ../../playbooks/.

> TEST PRODUCT. brief.md says Quoteflow is fictional and nothing about it may be published. Every task below produces drafts in outbox/ or internal files. Nothing is posted, sent or spent. The plan is also written to hold for a real launch.

## 0. What changed in revision 2 (from the red team)

| Red-team finding | Accepted? | Change in this plan |
|---|---|---|
| R1: $95 MRR by Day 30 cannot be reached on the plan's own dates; two kill triggers fire at the wrong time | Yes | The Day-30 goal is now **activated trials in closed cohorts** (§1). $95 MRR stays the revenue goal, but for the next window. MRR is still reported, with no target this window. Triggers re-timed (§8). The Dec 1 fallback is marked as giving no revenue inside the window |
| R2: no evidence that a working app exists; no closed beta; interviews gate nothing | Yes | New first go/no-go line: the product is tested end to end by 5 non-owner beta users. Closed beta added (G40). Interview synthesis is now a gate (G41). PH moves by default to **Tue 2026-12-08** (next window). Nov 17 stays only if both gates pass by Fri Nov 13. Owner hours added to G01 |
| R3: the free cap (3/month) may cover the whole beachhead, so trials end in a downgrade | Yes | G01 decision 4 (what Pro adds over Free) is now a hard blocker for approving the pricing page (G05) and for the trial emails (G11). Proposal-volume questions added to G33. Free-cap trigger added (§8). No price is proposed |
| Skeptical-buyer objections | Yes | Honest FAQ answers added to the G17 and G28 briefs. They stay "pending" until the lawyer review and the C15 decision |
| Cheapest test: a trial-window spreadsheet | Yes | New task G39 (om-forecaster) |

Kept as is, because the red team judged them sound: claims discipline, no paid or cold outbound, SEO/GEO not counted this window, closed-cohort rules, skipping Thanksgiving week.

### 0b. What changed in revision 3 (T39)

T39 asked for the same five changes that revision 2 already made. This revision checks each one and makes them explicit and enforceable:

| T39 ask | Where it lives now |
|---|---|
| Day-30 primary goal = activated trials (closed cohorts); MRR reported with no target | §1, §7, §9 (unchanged from rev 2, confirmed) |
| Go/no-go: working app tested end to end by 5 beta users | **New §8a, line GN-2** (with the owner pre-test as GN-1) |
| Go/no-go: interview gate (G33) | **New §8a, line GN-3.** G33 (kit plus owner-run interviews) owns the gate. G41 gives the verdict. T40 adds the volume and pain questions to the kit |
| "<10 trials" trigger re-timed to 7 days after launch | §8 (Tue Nov 24 if PH Nov 17, Tue Dec 15 if PH Dec 8) |
| Activation trigger re-timed to the beta cohort | §8, now a **count** (see the beta cohort row), so it fits a sample of 5-10 |
| Decision 4 (Pro vs Free) blocks G05 pricing and G11 | §8a line GN-5 and §13b: G05's pricing-page approval and G11 both depend on T41 (which puts decision 4 at the top of owner-decisions.md) and on the owner's answer |
| (Found while checking) the §13b edits from rev 2 are not in tasks.json yet, and tasks.json has 57 open tasks against the 40 cap | §13b (still to be applied) and new §13d (duplicates to close or merge) |

---

## 1. Summary (60-second read)

- **Revenue goal (one):** **$95 MRR**, meaning 5 paid Pro subscriptions at $19/month (C8), or the same amount from Team at $49 (C9). It is now timed for the **next 30-day window (Dec 3 - Jan 1)**, not for Dec 2. Why: a 14-day trial (C10) has to start by **Wed Nov 18** to end inside this window. With the site live at the earliest on Tue Nov 10, only about 9 days of trials could close. That cannot carry 5 paid on the plan's own conversion assumptions (§7). G39 re-checks this against the owner's real go-live date. If the forecast shows 5 or more paid are reachable by Dec 2, the owner can restore the Day-30 date.
- **Day-30 goal for this window:** **activated trials**, meaning `proposal_sent` within 7 days of `sign_up`, counted only in cohorts whose 7 days have ended, and split by source. G02 sets the number. Until then, the floor is the beta gate: **at least 5 non-owner users who each sent a real proposal through the app.**
- **Secondary count:** `trial_started` (product.json goal: 50). It is reported, but it no longer drives decisions on its own, because trials that end in a free downgrade are not progress (R3).
- **MRR:** reported weekly with no target this window. Any early upgrade is a bonus.
- **Sequence:** prove, then launch.
  1. **Week 1:** get the owner decisions (G01), run interviews (G33/G41), forecast (G39).
  2. **Week 2:** go live, then run a closed beta with the owner's warm network (G32, G40).
  3. **Weeks 3-4:** launch publicly only if the gates pass. Otherwise keep running the beta, community value posts and content, and launch on PH Tue Dec 8.
- **Three bets:**
  1. **Closed beta plus activation** (warm network, first-proposal flow, trial emails). This is now the main bet, because it is the cheapest way to show the product works and is wanted.
  2. **Launch and directories**, gated. PH plus launch platforms plus free directories, on Nov 17 only if the gates pass by Nov 13. Otherwise Dec 8.
  3. **Owner-led community participation from Day 1** (value-only answers that build account history). Product mentions come later.
- **SEO and GEO start on Day 1 but are not counted on for this window.**
- **Paid: none.** The ad cap is $0 (product.json).
- **Hard dependency:** a **working app** is the real blocker, not only a domain. The app has to send a real proposal with e-signature and a deposit request, and have signup, billing and a 14-day trial switch. G01 must answer: "Can you send a real proposal, with signature and deposit request, to a test client today?"

## 2. Strategic frame

- **Category:** proposal app for freelancers and small agencies (research/positioning.md §5).
- **Beachhead:** solo freelance web designers and developers ("Solo Sam", research/icp.md). Agency Alex (Team plan) is secondary: one landing section and LinkedIn posts.
- **Lead message:** Idea A, "from brief to signed proposal and deposit request, in one link" (C2-C6). Idea B (price options, C3) is the A/B variant (E-O8-1). Idea C ("without the suite") supports both. If G41 shows fewer than 3 of 10 interviewees feel the gap as a current pain, positioning is re-run before any launch (§8).
- **Market-quality gate:** problem size is medium. Frequency is medium-high on the ICP hypothesis of 2-6 briefs a month, which is unvalidated. **New in rev 2:** the same frequency number decides whether the Free cap of 3 a month leaves room for Pro. If most of the beachhead sends 3 or fewer proposals a month, Free covers them and Pro needs a real gate. That is the owner's call (G01 decision 4). G41 supplies the tally.
- **Voice:** plain, direct, peer-to-peer. Short sentences. No "best", "fastest", "#1" and no invented social proof (profile.md §7).
- **Claims allowed:** C1-C11 only. Banned until proven: "in minutes" (C12), EU (C13), local currency or tax handling (C14), payment processing (C15), "cheaper than X" (C16), integrations (C17), any customer, usage or review proof (C18), "no credit card" (C19).

## 3. Current state

| Area | State | Score 0-5 (from the materials) |
|---|---|---|
| Product/app | No domain, no live app reachable, no signup. **Whether a working app exists is unknown** (only the owner can answer) | 0 |
| Positioning and messaging | Done (positioning.md, message-house.md, profile.md) | 4 |
| ICP and research | Done, hypothesis-grade with second-hand VoC. No first-hand interviews yet | 3 |
| Keyword/SERP | Done, no measured volumes | 2 |
| Tracking | Plan written, nothing built | 1 |
| Email | No provider, no list | 0 |
| Communities | Shortlist done, rules not checked live | 2 |
| Proof | Price and feature list only. No customers, no testimonials | 1 |
| Legal | No ToS, privacy or cookie pages. E-signature and deposit wording not reviewed (risks.md T3) | 0 |
| Packaging | Free-to-Pro gap undefined beyond volume; Pro limit not stated (pricing-intel.md calls the anchor weak) | 1 |
| Budget | $0 paid, free tools only | n/a |
| Team | The owner plus OM agents. **Owner hours per week unknown** (G01 10b). Every post, send and listing is owner-approved and owner-run | n/a |

Growth phase: $0 ARR, before the first $10K. The binding constraint is **a working, wanted product**, then distribution.

## 4. Channel portfolio (ordered by speed to first revenue)

| # | Channel | Role in this 30 days | Effort share | Status |
|---|---|---|---|---|
| 1 | **CRO: landing, pricing, signup, trial path, first run** | Build the first pages to convert (landing A/B E-O8-1, pricing, signup without extra steps) and the first-proposal flow. The pricing page cannot be approved until G01 decision 4 is answered | 20% | Drafts now. Live page pending domain |
| 2 | **Warm network and closed beta** | 5-10 people the owner knows, invited by hand-sent notes (G32) into a closed beta (G40). This is the first source of activated users and of the launch gate | 20% (up from 5%) | Draft now; owner sends after approval |
| 3 | **Launches and directories (gated)** | PH **default Tue 2026-12-08** (next window). Tue 2026-11-17 only if the beta gate and the interview gate both pass by Fri Nov 13. Skip Thanksgiving week (Nov 23-27). Tue Dec 1 is possible but gives no revenue inside this window. Directories and launch platforms go in the same week as PH | 15% (down from 25%) | Drafts now. Submissions wait for the domain, the gates and approval |
| 4 | **Communities and owner-led social** | Value-only participation from Day 1 to build account history (r/freelance first, Indie Hackers, LinkedIn, X). Product mentions only after the rules are checked and the beta gate passes. Scope is held to the owner's hours (§6) | 15% | Start Day 1 |
| 5 | **Email (lifecycle)** | Beta and trial sequence (G11), waitlist capture, launch email to opt-in contacts only | 15% | Drafts now. Sending waits for the provider, consent setup and G01 decision 4 |
| 6 | **SEO / GEO** | Two guides, a template cluster, alternative pages after verification, llms.txt and entity facts | 15% | Write now. Publish when the domain exists |
| 7 | Paid search / paid social | **Skipped.** $0 cap | 0% | Skip |
| 8 | Cold outbound | **Skipped.** Consent rules not signed off (risks.md T4) | 0% | Skip |

Effort split by horizon: about 70% current (1-5), 20% next (SEO/GEO, alternative pages), 10% experiments. The free-tool spec (G31) and the Slack/Discord scan (G22) are deferred to the next window to keep within the open-task cap and the owner's hours.

## 5. AARRR moves

**Acquisition**
- Weeks 1-2: warm network into the closed beta (G32, G40) and value-only community answers (G18).
- The launch kit (PH, launch platforms, directories) is drafted now and submitted only after the gates (G15-G17).
- Content: deposit guide (SERP Q13) and good-better-best guide (Q15) (G23-G27).

**Activation** (first value = first proposal sent to a client)
- First run goes brief → proposal with price options → send link (G09, G10).
- Activation metric: `proposal_sent` within 7 days of `sign_up`. Count only cohorts whose 7 days have ended; open cohorts are "pending", not failures.
- **The closed beta is the first closed cohort.** Beta users who sign up Tue Nov 10 - Fri Nov 13 close their 7 days on Nov 17-20.

**Retention** (in-trial)
- Trial emails on Day 0, 1, 3, 7, 12 and 14, one action each (G11). **The Day 12 and Day 14 emails must say plainly what the user keeps and loses when the trial ends.** If the owner's answer to decision 4 means they lose nothing, the copy will show it, and that goes back to the owner rather than being covered up.
- A `plan_limit_reached` prompt for free users at proposal 3 (C7) (G10). How often it fires, as a share of active free users, is the post-launch test of the Free cap.

**Referral**
- Out of scope this window. Possible later: a "made with Quoteflow" footer on the client-facing link, which needs an owner decision.

**Revenue**
- Pricing stays as in the brief. **No price change is proposed.** What Pro adds over Free (G01 decision 4) is a hard blocker for the pricing page and the trial emails. Any change to the Free limit or a Pro gate is a price change, so the owner decides (product.json price_change: true).

## 6. Week by week

| Week | Dates | Focus | Exit check |
|---|---|---|---|
| 1 Prove | Nov 3-9 | Owner decisions (G01), including "working app today?", owner hours and Pro vs Free. Interviews: kit (G33) and the first 5-10 run by the owner, synthesis (G41). Forecast (G39). KPI tree (G02). Landing and pricing drafts (G05). Beta notes (G32). Demo script (G14). Value-only community answers (G18). Content calendar (G23) | G01 answered. First 5 interviews done. G39 forecast written |
| 2 Beta | Nov 10-16 | **Tue Nov 10: signup plus billing live and tested end to end** (kill line, §8). Closed beta opens (G40). Tracking verified (G07). Email provider plus trial sequence (G11, G13). Legal drafts to lawyer (G06). Launch kit drafted, not submitted (G15-G17). Compliance pass (G35) | **Gate review Fri Nov 13** against §8a GN-1 to GN-6: beta gate (5 non-owner users each sent a real proposal), interview gate (G33: 3 or more of the first 10 feel the pain), Pro vs Free answered. All pass → PH Nov 17. Otherwise → PH Dec 8 |
| 3 Launch or extend beta | Nov 17-23 | **If the gates passed:** PH Tue Nov 17, launch platforms and directories the same week, owner replies daily. **If not:** extend the beta (second invite wave), fix the first run from beta findings, keep community value posts going, and rewrite positioning if the interview gate failed | Closed beta cohort activation counted. UTM source on every signup |
| 4 Convert and compound | Nov 24-Dec 2 | Trial emails running. Activation fixes (G36). Guides and templates published once the domain exists. Alternative pages if competitor facts are verified (G30). Day-30 retro (G38) and next-window plan with the revenue goal | Activated trials vs the G02 target. Trials and MRR reported. LEARNINGS updated |

**Capacity rule (new):** G01 10b gives the owner's hours per week for build, support and replies. The channel plan is held to that number. Planning rule, to be confirmed with the owner: if the hours do not cover the beta, the interviews and daily launch replies, then the following are dropped in this order: X (G21), LinkedIn (G20), then the IH series (G19). The beta and the interviews are never dropped.

## 7. Targets and funnel math (planning assumptions, not claims)

These numbers are internal. None of them goes into copy.

**Trial-window check (G39 runs it with the owner's real dates):**
`paid by Dec 2 ≈ (trials started on or before Nov 18) × trial-to-paid rate + early upgrades`

On the plan's own dates (site live Nov 10, PH Nov 17), trials that can close inside the window come from about 9 days. Two of those days are launch days. At the assumed 10% trial-to-paid, 5 paid needs about 50 trials by Nov 18. At 20% it needs about 25. Both sit at or beyond the top of what 2 launch days plus a small warm network could plausibly bring. **So the Day-30 MRR target is moved to the next window**, unless G39 shows otherwise with real inputs.

| Step | Target this window | Assumption / rule |
|---|---|---|
| Closed beta invitations (warm network) | 5-10 people | Owner's own contacts only, sent by hand after approval |
| Beta users who each sent one real proposal | **5 (gate)** | A count, not a rate, because the sample is tiny |
| Activated trials (proposal_sent in 7 days, closed cohorts) | **Set by G02** | Primary Day-30 goal. Open cohorts are pending |
| trial_started | Reported (product.json: 50) | Secondary. Depends on whether and when the public launch happens |
| Visitor → trial_started | 2-5% | Planning assumption, unverified for this product. Only applies after a public launch |
| Trial → paid | 10-20% of trials whose 14 days have ended | Assumption. No mechanism behind it until G01 decision 4 is answered |
| MRR | Reported, **no target** | Revenue goal of $95 applies to the next window |

## 8. Kill criteria and triggers (re-timed)

| Date | Trigger | Response |
|---|---|---|
| Fri Nov 6 (Day 4) | G01 says no working app can send a real proposal with signature and deposit request | Drop any public launch from this window. The window becomes interviews, beta prep, content and community history. Revenue stays a next-window goal |
| Tue Nov 10 (Day 8) | Signup with billing not live and tested end to end | No PH on Nov 17. Default PH Dec 8. Confirms that this window has no MRR target |
| Fri Nov 13 (Day 11) | **Beta gate:** fewer than 5 non-owner beta users have each sent one real proposal through the app | No public launch. Extend the beta (second invite wave) and fix the first run |
| Fri Nov 13 (Day 11) | **Interview gate:** fewer than 3 of the first 10 interviewees describe the brief-to-proposal-to-deposit gap as a current pain | Re-run positioning (om-positioning-strategist) before any launch. Pause launch drafts |
| End of week 1 (G41) | **Free-cap trigger:** the median interviewee sent 3 or fewer proposals a month | The owner decides on a Pro gate or a different Free limit before the pricing page is approved. No price is proposed by OM |
| First closed beta cohort closes (Nov 17-20 for signups Nov 10-13) | Fewer than 5 beta users sent a real proposal within 7 days of `sign_up`, **or** fewer than half of beta signups did (whichever is stricter; counts first, because the sample is 5-10) | Fix the first-run flow before any public traffic arrives. No public launch until the next beta wave passes. This is the activation trigger. It no longer depends on launch-week traffic |
| 7 days after the public launch (Tue Nov 24, or Tue Dec 15 if PH is Dec 8) | Fewer than 10 trials (risks.md T10) | Narrow to one channel (best UTM source) and one segment (Solo Sam) |
| After launch | `plan_limit_reached` rarely fires among active free users | Free cap not doing its job; back to the owner (decision 4) |
| Any time | Mod removal or ban | Stop posting in that community, log it in LEARNINGS, re-read its rules |
| Any time | Draft with a needs-proof claim | Rejected at compliance (G35) |

**Fallback note:** a PH launch on Tue Dec 1 (Day 29) is allowed, but no trial from it can finish its 14 days inside this window. It produces trials and activation data, not revenue.

## 8a. Go/no-go lines for any public launch (new in rev 3)

Checked at the gate review on **Fri 2026-11-13**. All of GN-1 to GN-5 must pass for PH on Tue Nov 17. If any line fails, PH moves to Tue Dec 8 by default, and the failed line is re-checked before that date. GN-6 is the existing risks.md checklist and stays as it was.

| # | Line | Evidence | Owner task | Pass |
|---|---|---|---|---|
| GN-1 | **Working app.** The owner sends one real proposal, with e-signature and deposit request, to a test client, screen-recorded | Recording plus the G01 question 0 answer | G01 / T41, G40 pre-test | Yes by Fri Nov 6. A "no" fires the Nov 6 trigger (§8) |
| GN-2 | **Tested by 5 beta users.** At least 5 non-owner beta users have each sent one real proposal to a real client through the app, end to end (signup, create, send, signature, deposit request) | `proposal_sent` events plus the G40 beta log (counts, no names) | G40 (after G10, G32) | 5 or more by Fri Nov 13 |
| GN-3 | **Interview gate (G33).** At least 3 of the first 10 interviewees describe the brief-to-proposal-to-deposit gap as a current pain | G33 interviews (kit with the T40 questions), verdict in G41 | G33 → G41 | 3 or more of 10. A fail means re-running positioning before any launch. Fewer than 10 interviews done means "pending", which counts as no-go |
| GN-4 | **Signup, billing and the 14-day trial switch** are live and tested end to end | Owner test plus G07 tracking check (`sign_up`, `trial_started`, `subscription_started` firing) | G01, G07 | By Tue Nov 10 |
| GN-5 | **Pro vs Free answered (decision 4).** The owner has said what Pro adds over Free and the Pro limit. The pricing page (G05) and the trial emails (G11, Day 12 and Day 14 keep/lose copy) reflect that answer | owner-decisions.md decision 4 | T41 / G01 → G05 pricing, G11 | Answered before the G05 pricing approval and before G11 is drafted in final form. If the G41 median is 3 or fewer proposals a month, the owner must also rule on the Free cap |
| GN-6 | risks.md go/no-go checklist: legal drafts reviewed (G06), email consent set up (G13), compliance pass (G35) | Those outputs | G06, G13, G35 | All done |

No line can be passed on paper. Pages existing is not a pass for GN-1, GN-2 or GN-4.

## 9. Measurement

- North star: MRR (reported weekly, no target this window). **Primary decision metric this window: activated trials in closed cohorts, by source.** Secondary: `trial_started`, `sign_up`, `proposal_sent`, `subscription_started`, `plan_limit_reached` rate among active free users.
- Every link we control carries a UTM from the registry (G08), including beta invites (`utm_source=warm-network`, `utm_campaign=2026-11-beta`).
- Weekly scorecard every Monday: Nov 9, 16, 23, 30 (G36), with the re-timed triggers from §8.
- Experiments: E-O18-1 to E-O18-5 (E-O18-1 and E-O18-5 updated in runs/O20.json), new E-O20-1 and E-O20-2, plus the existing E-O8-1/2/3 and E-O15-1.

## 10. Budget

$0 paid (monthly_cap 0, daily_cap 0). Free stack only. Any paid tool, sponsorship or listing fee needs the owner to raise the cap first. This plan proposes no spend.

## 11. Pending: needs the live site / domain or the owner

- Whether a working app exists, and its go-live date (owner, G01).
- Landing and pricing pages live; message test E-O8-1.
- Site inventory and live-copy check (re-run `/om onboard` after the domain is set).
- Tracking install and verification, Search Console, sitemap and indexing.
- Every directory, launch-platform and PH submission (they need a URL and the gates).
- Community posts that mention the product.
- Publishing guides, templates, alternative pages, llms.txt.
- Measured keyword volumes and live SERPs (no SEO tool connected).
- Live community rules (G04) and PH rules at the time of launch.
- Real proposal volume per freelancer (G41, from interviews).

## 12. Open decisions for the owner (G01)

Questions 0, 4 and 10b are **hard blockers** (marked ★).

0. ★ **Can you send a real proposal, with signature and deposit request, to a test client today?** Yes or no, with a screen recording. If no: what is the realistic date for signup plus billing tested end to end?
1. Domain and brand-name collision check ("Quoteflow" / "Quote Flow").
2. Is EU in scope? product.json lists it; brief.md does not (C13).
3. Payments: does Quoteflow process deposits or only request them (C15)? Which processor? (Buyers will ask "does it take the deposit or just ask for it?")
4. ★ Pro vs Free: what Pro adds besides volume, the Pro proposal limit, and the extra-seat price on Team. **Blocks approval of the pricing page (G05) and the trial emails (G11).**
5. Trial: is a card required (C19)?
6. Currencies and VAT/GST for UK, CA, AU (C14).
7. Timed demo to prove or drop "in minutes" (C12).
8. Legal: ToS, privacy, cookie and refund pages; e-signature wording reviewed by a lawyer (T3), including an honest answer on validity in the UK, CA and AU.
9. Accounts: GA4, Search Console, email provider, payments (all null in product.json).
10. Which personal accounts the owner will use for Reddit, IH, LinkedIn, X and PH.
10b. ★ **Owner hours per week** for build, support, interviews and replies.
11. English spelling standard (US or UK).
12. Is a free-plan signup a conversion, or only a trial start?
13. product.json has `target_30d: null`. Confirm the revised targets: activated trials this window (number from G02), $95 MRR in the next window.
14. How many people in the owner's warm network fit the ICP (a count, not names)? This sizes the closed beta.

## 13. Task list (dependency-ordered)

Priority 1 = highest. 38 tasks were proposed in O18, plus 3 new ones in O20 (G39-G41). G22 and G31 are deferred to the next window, which leaves 39 plan tasks. **But tasks.json now has 57 open tasks**, because other agents added T1-T7 and T39-T47. That is over the 40 cap. §13d lists what to close or merge.

### 13a. New tasks (in runs/O20.json)

| id | Agent | Task | Depends on | P |
|---|---|---|---|---|
| G39 | om-forecaster | Trial-window forecast from the owner's real go-live date | G01, G02 | 1 |
| G40 | om-onboarding-optimizer | Closed beta protocol and end-to-end proposal test (beta gate) | G10, G32 | 1 |
| G41 | om-persona-interviewer | Interview synthesis and launch-gate verdict (pain gate, proposal volume) | G33 | 1 |

### 13b. Changes to existing tasks (to be applied by the main session)

`tools/apply-results.mjs` adds new tasks but cannot edit existing ones. These changes have to be applied to tasks.json by the main session. As of 2026-11-02T19:55Z **none of them is applied yet** (checked against tasks.json: G05, G11, G15-G17 still have their O18 depends_on and dates).

| id | Change |
|---|---|
| G01 | Add questions 0, 10b and 14 (§12). Mark 0, 4 and 10b as hard blockers. Deadline for 0: Fri Nov 6. T41 already covers 0, 4 and 10b, so G01 can depend on T41 or the two can be merged |
| G05 (rev 3) | Add depends_on T41 for the **pricing page approval only**. Home A/B drafts are not blocked |
| G11 (rev 3) | Add depends_on T41. The final copy waits on the owner's decision 4 answer (GN-5) |
| G41 (rev 3) | Add depends_on T40, so the tally uses the volume and pain questions |
| G40 (rev 3) | Add depends_on T41 (GN-1 pre-test needs the question 0 answer) |
| G02 | Primary KPI = activated trials (closed 7-day cohorts, by source), with a target. `trial_started` secondary. MRR reported with no target this window |
| G05 | The pricing page draft can be written now. Its publish approval waits on the G01 decision 4 answer |
| G11 | Add depends on the G01 decision 4 answer. Day 12 and Day 14 emails state what the user keeps and loses at trial end |
| G15, G16, G17 | Add depends_on G40 and G41. Drafts can be written now; submission dates follow the gate review (Nov 17 if both pass by Nov 13, else Dec 8) |
| G17 | Default date Tue 2026-12-08; Nov 17 conditional; Dec 1 marked "no revenue inside window". Add honest FAQ answers for: trust in an unknown signing tool, signature validity in UK/CA/AU (pending lawyer), "does it take the deposit or only request it" (pending C15), "why not Docs plus a payment link". No claims beyond C1-C11 |
| G28 | Same FAQ topics, same rules |
| G32 | Priority 3 → 2. The notes are now beta invitations (5-10 people), feeding G40 |
| G33 | Add: "How many proposals did you send last month and the month before?" and "What would you pay for, beyond more proposals?" Target: first 5 interviews by Fri Nov 6, first 10 by Thu Nov 12 |
| G36 | Use the re-timed triggers in §8. Activated trials are the headline number |
| G22, G31 | Defer to the next window (keep, but not open this window) |

### 13c. Full list

| id | Agent | Task | Depends on | P |
|---|---|---|---|---|
| G01 | om-chief-of-staff | Owner decision pack (§12) | - | 1 |
| G02 | om-kpi-definer | 30-day KPI tree and targets (activated trials primary) | - | 2 |
| G33 | om-persona-interviewer | Interview kit and recruit post (+ volume questions) | - | 2 |
| G41 | om-persona-interviewer | Interview synthesis and launch-gate verdict | G33 | 1 |
| G39 | om-forecaster | Trial-window forecast | G01, G02 | 1 |
| G03 | om-competitor-intel | Verify competitor pages with dates | - | 2 |
| G04 | om-community-scout | Verify live community rules | - | 2 |
| G05 | om-landing-builder | Landing (A/B) and pricing page drafts | - (pricing approval waits on G01 #4) | 1 |
| G10 | om-onboarding-optimizer | First-proposal activation spec | - | 3 |
| G32 | om-sales-agent | Warm-network beta invitation notes | G05, G01 | 2 |
| G40 | om-onboarding-optimizer | Closed beta protocol and end-to-end test | G10, G32 | 1 |
| G06 | om-legal-pages | ToS, privacy, cookie, refund drafts for lawyer review | G01 | 2 |
| G07 | om-tracking-engineer | Tracking implementation guide | G01 | 2 |
| G08 | om-utm-manager | UTM registry (incl. beta invites) | G02 | 4 |
| G09 | om-cro | CRO review of landing, signup, trial path | G05 | 2 |
| G11 | om-activation-emails | 14-day trial email sequence | G10, G01 | 2 |
| G12 | om-email-nurture | Waitlist and launch emails | G05 | 3 |
| G13 | om-deliverability | Email setup and compliance checklist | G01 | 3 |
| G14 | om-video-producer | Timed demo script | - | 2 |
| G15 | om-directory-submitter | Directory shortlist and listing drafts | G05, G01, (G40, G41) | 2 |
| G16 | om-launch-platforms | Launch platform drafts | G05, (G40, G41) | 3 |
| G17 | om-producthunt | Product Hunt launch kit (default Dec 8) | G05, G14, (G40, G41) | 2 |
| G18 | om-reddit | Reddit 90/10 plan and value-only answers | G04 | 2 |
| G19 | om-hn-indiehackers | IH series and Show HN draft | G04, G14 | 3 |
| G20 | om-linkedin | Owner LinkedIn posts | G05 | 3 |
| G21 | om-x | X build-in-public set | G05 | 4 |
| G23 | om-content-strategist | 30-day content calendar and briefs | - | 2 |
| G24 | om-writer | Guide: deposit request in a proposal | G23 | 2 |
| G25 | om-writer | Guide: good-better-best price options | G23 | 2 |
| G26 | om-template-maker | Niche proposal templates with price options | G23 | 3 |
| G27 | om-editor | Fact-check G24-G26 | G24, G25, G26 | 2 |
| G28 | om-geo-optimizer | llms.txt, entity facts, FAQ drafts | G05 | 4 |
| G29 | om-tech-seo | Launch technical SEO checklist | G01 | 3 |
| G30 | om-comparison-pages | Alternative pages on verified facts | G03 | 3 |
| G34 | om-social-proof | Consented beta-quote process | G33 | 4 |
| G35 | om-compliance-guard | Compliance pass on all wave-1 drafts | G05, G11, G15, G17, G18, G20 | 1 |
| G36 | om-analyst | Weekly scorecard and re-timed triggers | G02, G07 | 3 |
| G37 | om-experiment-manager | Experiment designs E-O18-*, E-O8-*, E-O20-* | G02 | 3 |
| G38 | om-retro | Day-30 retro, LEARNINGS input, next-window plan input | G36 | 5 |
| ~~G22~~ | om-discord-slack | Deferred to next window | - | - |
| ~~G31~~ | om-free-tool-builder | Deferred to next window | - | - |

Dependencies in parentheses are the changes in 13b, which the main session has to add.

### 13d. Open-task cap: duplicates to close or merge (new in rev 3)

tasks.json has 57 open tasks. Closing these duplicates brings it to 40 or fewer without losing work. The main session decides; om-cmo does not edit tasks.json.

| Close or merge | Into | Why |
|---|---|---|
| T1 (switch-interview script) | G33 | Same interview kit |
| T40 (interview questions) | G33 (or keep as G33's first step) | Same file, research/interview-kit.md |
| T2 (landing copy) | G05 | Same landing drafts |
| T3, T5, T44, T47 (competitor checks) | G03 | Four versions of the same verification. Fold T47's "one-link" and UK/AU questions into G03 |
| T6 (tracking install) | G07 | Same work, blocked on the domain |
| T7 (legal and payments escalation) | G01 / T41 | Same owner questions (2, 3, 8) |
| T41 (red-team owner questions) | G01 | Same decision pack. Run T41 first if G01 is not started |
| T43 (price-options guide) | G25 | Same guide |
| T46 (message house) | Close as done | research/message-house.md already exists |
| T39 (this task) | Done | |

That closes 11 or 12 tasks (T1, T2, T3, T5, T6, T7, T39, T43, T44, T46, T47, plus T40 or T41 if merged), which leaves 45-46 open. To reach 40, also defer G21 (X, P4), G28 (GEO, P4), G34 (beta quotes, P4), G08 (fold into G07), G29 (until the domain exists) and T4 (live SERP check, until a connector exists). Those are the lowest-priority items and match the capacity rule in §6.

Recommended next task: **T41 / G01** (owner decision pack: questions 0, 4 and 10b first), and **G33 with the T40 questions** in parallel. Then the main session applies §13b and §13d.
