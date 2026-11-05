# Red team: Quoteflow (sample) 30-day plan

Task O19 by om-red-team, 2026-11-02T19:14:07Z. Method: pm-execution:strategy-red-team.
Attacked: plan.md (O18). Sources: brief.md (owner, source of truth), product.json, profile.md, claims.md, LEARNINGS.md (empty), research/risks.md, research/pricing-intel.md, runs/O18.json.

> TEST PRODUCT. brief.md says Quoteflow is fictional and nothing about it may be published. This report is internal.
> Note: O19 is not in tasks.json (the file is `[]`). I worked from the brief the main session gave me.

## Red team: "Launch on Product Hunt Day 15, get 50 trials, turn 5 of them into $95 MRR by Day 30, at $0 spend, before the product has a domain"

Every date and count below comes from plan.md or brief.md. I added no outside data.

---

## The three biggest risks (ranked by impact x likelihood x how cheap they are to test)

### Risk 1. The revenue goal cannot be reached inside this window, and two kill triggers fire at the wrong time

- **Claim:** 25+ trials start by Day 16 (Wed Nov 18), and 10-20% of them pay by Day 30, which gives 5 paid subscriptions and $95 MRR.
- **Steelman:** The plan sees the 14-day trial limit itself (§1). It front-loads launch, it allows early upgrades, and it already has a fallback (§8) that moves revenue to the next plan if the site is late.
- **Attack:** Even on the plan's best-case dates, the window where a trial can still convert is very small.
  - The site goes live in week 2, Nov 10-16. The deadline is Thu Nov 12 (Day 10).
  - Product Hunt is Tue Nov 17 (Day 15). Only trials started on Nov 17 and 18 come from the launch and still end before Dec 2.
  - Before that, about 4-6 days of pre-launch traffic come only from communities and the warm network. The plan itself says communities need 1-3 weeks of account history (§4 row 3).
  - So the goal needs about 25 trials from 2 launch days plus a few warm contacts, then a 20% conversion. That is the top of an assumed range (§7, "unverified for this product").
  - At 10%, 25 trials give 2.5 paid. The fallback date (Tue Dec 1, Day 29) gives no trial that can finish its 14 days.
- **Fails if:** fewer than 25 trials start by Nov 18, or trial-to-paid in the first closed cohort is under 20%. On the plan's own numbers, both are likely.
- **The triggers cannot work as written:**
  - "Fewer than 10 trials by Day 14" (§8) is checked on Mon Nov 16. That is the day before launch, with at most about 4 days of live site. It will almost always fire. Its response ("narrow to one channel") then clashes with the PH launch the next day.
  - "Activation under 20% in the first closed cohort: fix before launch-week traffic arrives" (§8) cannot fire in time. A 7-day cohort that starts after Nov 12 closes on Nov 19 at the earliest, which is after the launch.
- **Evidence to get this week:** the owner's realistic go-live date for a working signup plus billing (G01). Also, how many people in the owner's warm network are in the ICP (a count, not names).
- **Kill criterion:** if the signup with billing is not live and tested end to end by Tue Nov 10, drop $95 MRR as a Day-30 target now, not on Nov 12.
- **Cheapest test:** a spreadsheet. Plug the owner's real go-live date into §7: trial-eligible days × expected trials per day × 10% conversion. If the result is under 5 paid, change the goal before Day 1.
- **What to change:**
  1. Make the Day-30 goal **activated trials**: `proposal_sent` within 7 days, in closed cohorts, counted by source. Use a target set by G02, plus trial starts as a secondary count. Report MRR, but do not set a target for it this window.
  2. Re-time the kill triggers. Move "<10 trials" to 7 days after launch (Tue Nov 24). Rewrite the activation trigger as "first closed beta cohort", which needs Risk 2's change.
  3. Say clearly that the Dec 1 fallback date has no revenue inside this window.

### Risk 2. The plan launches a product that nobody has shown exists or is wanted

- **Claim:** By week 2 the owner can ship a site that works and is safe to launch: landing, pricing, legal pages, signup, billing, tracking, an email provider, and a signature and deposit flow that has been tested. A cold Product Hunt audience then starts trials.
- **Steelman:** The plan lists the go/no-go checklist (risks.md) on Fri Nov 13. It runs interviews (G33) in week 1, and it keeps every outbound action behind approval. A narrow tool with a free plan is easy to try.
- **Attack:**
  - **Nothing shows the app exists.** §3 scores "Product/site" 0 and says "no live app reachable". brief.md says "no domain yet". The plan treats G01 (domain plus stack) as the blocker. The real blocker is a working app with e-signature, a deposit request, billing and a 14-day trial switch, tested with real clients (risks.md T8, Elephant 2).
  - **Too much lands on one person in one week.** In 7 days (Nov 10-16) the owner must build or finish the app, get a lawyer to review the e-signature wording (T3), choose a payments approach (C15), set up an email provider with consent (T4), set up tracking, and also run interviews and community replies. The plan never asks how many hours the owner has; it is open decision 10, and §6 counts on it anyway.
  - **No closed beta comes first.** risks.md T8 says "run a closed beta before any public push". The plan goes straight from site live to Product Hunt in 1-5 days. Bugs in signing or deposits are seen by the user's own clients, which is the worst place for a first impression.
  - **Demand is still unproven, and the interviews do not gate anything.** G33 runs in week 1, but no interview result can stop or change the launch. Elephant 1 (risks.md) stays open, and the launch goes ahead whatever the interviews find.
- **Fails if:** on Nov 13 the go/no-go passes on paper (pages exist) but no real user has sent a proposal to a real client and got it signed with a deposit request. Or: 10-15 interviews show the ICP is happy with Docs plus an invoice link.
- **Evidence to get this week:**
  - The owner's answer to "can you send a real proposal, with signature and deposit request, to a test client today?" (yes or no, with a screen recording).
  - The first 5 interviews: how they send proposals today, and whether they have paid for a proposal tool before.
- **Kill criterion:**
  - No PH launch until at least 5 beta users (not the owner) have each sent one real proposal through the app. The bar is a number, not a percentage, because the sample is tiny.
  - If fewer than 3 of the first 10 interviewees describe the brief-to-proposal-to-deposit gap as a current pain, re-run positioning before launch.
- **Cheapest test:** a concierge or closed beta with 5-10 people from the owner's warm network (G32 notes, sent by hand after approval). It needs no PH, no directories and no public traffic.
- **What to change:**
  1. Add "working product, tested end to end with 5 beta users" as the first go/no-go line.
  2. Make G33 a gate with the kill criterion above, and put G33 and G32 ahead of G15-G17.
  3. Move PH by default to the next window, after the closed beta. Keep Nov 17 only if both gates pass by Nov 13.
  4. Add G01 question 10b: owner hours per week for build, support and replies. Hold the channel plan to that number.

### Risk 3. The free plan may already cover the whole beachhead, so trials end in a downgrade instead of a payment

- **Claim:** Solo Sam starts on Free (3 proposals/month), tries Pro, and pays $19/month.
- **Steelman:** Freemium with a volume cap matches the value metric (pricing-intel.md §4). Only Quoteflow has a free plan among the four named competitors (unverified). A 14-day trial is long enough to show value.
- **Attack:**
  - The plan's own ICP guess is **2-6 briefs a month** (§2). A freelancer at 2-3 a month never hits the Free cap.
  - Pro adds nothing defined except volume (open decision 4; pricing-intel.md calls the Free-to-Pro anchor "weak"). Pro's proposal limit is not stated at all.
  - So when a 14-day Pro trial ends, the typical beachhead user drops to Free and loses nothing. The 10-20% trial-to-paid assumption (§7) has no mechanism behind it.
  - This hits the revenue target directly, and it also skews the 50-trial count: plenty of trials, no paid users.
  - Open decision 12 (is a free signup a conversion?) shows that the funnel is not even defined yet.
- **Fails if:** most beachhead users send 3 or fewer proposals a month, and Pro has no feature gate the user needs.
- **Evidence to get this week:** add two questions to the G33 interview script. "How many proposals did you send last month and the month before?" and "What would you pay for, beyond more proposals?" Have the owner answer G01 decision 4 before any pricing page draft is approved.
- **Kill criterion:** if the median interviewee sent 3 or fewer proposals a month, the free cap is cannibalising Pro. The owner then needs a Pro gate or a different Free limit. That is a price change, so the owner decides (product.json price_change: true). I propose no price.
- **Cheapest test:** the interview tally above. It costs nothing and is ready by the end of week 1. After launch, track `plan_limit_reached` (G10) as a share of active free users. If it rarely fires, the cap is not doing its job.
- **What to change:**
  1. Make G01 decision 4 (what Pro adds over Free) a hard blocker for G05's pricing page and G11's trial emails. Today it is one item in a list of 13.
  2. Add the proposal-volume questions to G33.
  3. Have the trial email sequence (G11) say what the user keeps or loses on Day 14. If they lose nothing, the copy will show it.

---

## What a skeptical buyer would say (for G05, G09, G17)

- "My clients will get a signature and deposit request from a tool they have never heard of. Will they trust it?" Today we have no proof (C18) and no security or legal page. G06 and the landing page have to answer this without making claims.
- "Is this signature valid in the UK or Australia?" The plan bans "legally binding" (T3), which is correct, but the question will come up in the first PH comments. Prepare an approved, honest FAQ answer through G06 and the lawyer.
- "Does it actually take the deposit, or does it just ask for it?" C15 is unresolved. If the answer is "it only asks", buyers will compare it with a Stripe payment link plus a Google Doc, which costs them nothing.
- "Why not Docs + an invoice tool + a free e-sign tool?" Positioning Idea A ("one link") answers this. Without a timed demo (C12, G14), it is an assertion.
- "There are no reviews, no customers and no integrations." True, and the plan is right not to fake them. Lead with the free plan and a live demo instead.

## What is well-reasoned

- **Claims discipline.** C1-C11 only, needs-proof claims banned, no fake social proof, and compliance (G35) as a gate. This holds up and matches brief.md exactly.
- **Skipping paid and cold outbound.** The $0 cap (product.json) and unsigned consent rules (T4) make this correct, not timid.
- **Not counting SEO/GEO this window.** This is honest about lead time.
- **Closed-cohort rules for activation**, with open cohorts reported as "pending". This avoids a common false-failure reading.
- **Avoiding Thanksgiving week** for the launch, and the explicit domain-late fallback (§8).
- **Treating activation and trial email as a bet in its own right** (bet 3). This is the right instinct. Risks 1 and 3 just say it should be the main goal, not the third bet.

## What I could not assess (pending)

- Anything on the live site: there is no domain. Landing, pricing, signup, trial and billing flow, legal pages, tracking. Re-run after `/om onboard` with a domain.
- Whether the app exists or is buildable in the time. Only the owner can answer.
- Owner hours per week and the history of the owner's personal accounts (open decision 10). These decide whether communities can contribute before Day 16.
- Live community rules (G04) and Product Hunt rules at the time of launch.
- Competitor prices and features. All are unverified (pricing-intel.md), so the Team-plan seat-cost angle cannot be judged yet.
- Real proposal volume per freelancer. This is the key input for Risk 3, and only interviews can supply it.

## Recommended next step

Before G15-G17 start, the owner answers three questions in G01:
1. Does a working app exist that can send a real proposal with signature and deposit request today?
2. How many hours a week does the owner have?
3. What does Pro add over Free?

In parallel, run G33 with the proposal-volume questions added. Then om-cmo revises plan.md §1, §7 and §8 as described above.
