# CRO review: landing, signup and trial path (Quoteflow sample)

Task G09, om-cro (SaaS), 2026-11-03. Inputs read: outbox/landing/home-a.md, home-b.md, pricing.md, research/tracking.md, research/icp.md, claims.md, reports/owner-decisions.md, LEARNINGS.md, experiments.json.
Knowledge brief: knowledge/briefs/funnel.md has no verified facts in its "Conversion, UX, speed and accessibility" section, so nothing below rests on a platform or research fact except one pricing law item (K-d61ac4930b, section 5). Everything else is analysis of the drafts and standard CRO practice, not measured data.

> TEST PRODUCT (fictional per brief.md). No domain, no site, no analytics, no users. This is a **draft-level review**, not a live-page audit (pending the domain; see section 8). All "lift" rankings are my judgment of expected impact and effort, not forecasts. No conversion rates or benchmarks are quoted because none are verified.

## 1. Verdict in five lines
1. The drafts are claim-safe and clear on what the product is. The biggest conversion risks are not wording: they are **an empty Pro card, an unanswered "do I need a card?" question, and no visible proof of the real product** (no screenshot, demo or sample client link).
2. Two competing primary actions ("Start your 14-day Pro trial" vs the Free plan) are never reconciled. The visitor and the KPI tree both need one defined path.
3. The pricing table on the home page and the Pro card describe the trial, not the plan, so a visitor cannot tell what $19 buys.
4. Signup and trial-start steps are not specified anywhere yet. Section 4 specs them, with the owner-decision branches marked.
5. At the planned traffic (goal is about 50 trials in 30 days), A/B tests will be directional at best. Sequence one test at a time (LEARNINGS P3).

## 2. Ranked changes (highest expected lift first)

Scoring: Impact (1-5) = how much it could move visit to trial_started; Confidence (1-5) = how sure I am the problem is real, given only drafts; Effort (1-5, 5 = hardest). Rank = impact then confidence then lower effort. These are my estimates.

| Rank | Change | Page | Impact | Conf. | Effort | Blocked by |
|---|---|---|---|---|---|---|
| 1 | Fill the Pro card and the home plan table with what Pro actually includes and its limit. Show "Free: 3 proposals a month" vs "Pro: [limit, features]" side by side. | pricing, home A/B | 5 | 5 | 1 | Owner decision 4 (Fri Nov 6). Hard blocker: pricing cannot ship without it |
| 2 | Answer the card question next to every trial CTA: one line under the button, in whichever form is true ("No card needed" or "Card required, you can cancel any time"). Do not use "no card" until C19 is verified. | all CTAs | 5 | 4 | 1 | Owner decision 5 |
| 3 | Add real product proof above the fold or directly below it: a screenshot or short clip of the actual client link (scope, timeline, price options, signature, deposit request) and, ideally, a clickable sample proposal. Use only the real app; no mockups presented as the product. | home A/B | 5 | 4 | 3 | A working app (decision 0, GN gate). Timed demo (G14) feeds this, but the "in minutes" claim stays banned (C12) until timed |
| 4 | Make one primary CTA and one secondary on every page, with fixed ids. Recommended default: primary "Start your 14-day Pro trial", secondary text link "or start free" (see 6.1 for why this needs the owner). | all | 4 | 3 | 1 | Owner decision 12 (is a free signup a conversion?) |
| 5 | Replace the Team CTA "Start with a 14-day Pro trial, then choose Team" with a clear single action. The trial is Pro only (C10); Team trial is not stated. Offer "Start free" or "Start Pro trial" and keep "5 seats for $49/month" as information. | pricing | 3 | 4 | 1 | none |
| 6 | Reduce repetition on home A: hero, Section 1 and Section 2 list the same five items three times. Keep the five-item list once (Section 1), shorten the how-it-works steps to one line each, and move the plan table up so the price is seen before the page ends. | home A | 3 | 3 | 1 | none |
| 7 | Add an honest "What Quoteflow does not do yet" line near the plans (no integrations, brief says none). This pre-empts the technical objection and filters Agency Alex early. Wording needs the owner to confirm C17. | home, pricing FAQ | 3 | 3 | 1 | C17 confirmation |
| 8 | Answer the payment objection precisely in the FAQ: "The proposal includes a deposit request." Keep it, but add the line the visitor needs next: who collects the money (decision 3). A vague answer here is a likely stall for a freelancer who wants to be paid. | pricing FAQ, home | 4 | 3 | 1 | Owner decision 3 (C15) |
| 9 | Show prices with a currency note ("USD") once decision on C14 is made. UK, CA and AU visitors will otherwise guess. | pricing, home | 2 | 3 | 1 | Owner (C14) |
| 10 | State what happens when the trial ends (downgrade to Free or charge). Without it, trial starters hesitate and the UK subscription rules, if applicable, require it (section 5). | pricing, signup | 4 | 4 | 1 | Owner decision on post-trial behaviour, and card decision |
| 11 | Home B headline is a strong idea but "one number to accept or refuse" is long; test a shorter form only after E-O8-1 reads. Do not tweak A or B before the test, or the arms stop being comparable (LEARNINGS P8). | home B | 2 | 2 | 1 | E-O8-1 |
| 12 | Add trust basics that exist without customers: a named contact or support address, privacy and terms links in the footer, a plain statement of who makes Quoteflow. No logos, counts or quotes (C18). | footer, signup | 3 | 4 | 1 | Legal pages (G06, decision 2/3), entity details |

Reading the table: rows 1, 2, 10 are one decision cluster for the owner (decisions 4, 5 and post-trial). Until they are answered, any further copy testing is polishing a page that cannot be approved.

## 3. Page-by-page notes

### Home A (one-link flow)
- Clarity: good. The H1 says what the product delivers and the subhead says who it is for (C1, C2, C3, C6). Passes a quick "what is this, who is it for, what do I do" read.
- Weak point: the headline says "signed proposal and deposit request". A visitor may read it as an outcome promise ("you will get signed"). Safe as written because it describes the flow, but keep "no outcome claims" as the draft says.
- Proof gap: nothing visual. Section 1 describes the client link in words only. See change 3.
- The plan table lists "Pro $19/month: 14-day trial". That reads as a trial, not a plan. See change 1.

### Home B (price options)
- The strongest differentiated idea (price options, C3), and it ties to Marketing Maya as well as Sam. Same layout as A so E-O8-1 stays clean.
- Risk: "options, not one number" assumes the visitor already prices with a single number. Fine as a hypothesis, which is exactly what E-O8-1 tests.
- Same gaps as A: no proof visual, same plan table issue.

### Pricing
- Blocked (the draft itself says so): the Pro card has an owner placeholder. Rank 1.
- Good: Free card CTA "Start free" is clear and honest. Trial section does not promise "no card".
- Problem: three different trial CTAs on one page (hero area, trial section, Team section) all point to the same action. Fine for repetition, but the Team CTA changes the action. See change 5.
- FAQ is useful but the Free-plan question has a placeholder, and "What happens after the trial?" and "Do I need a card?" are missing. Add both once decided.

## 4. Signup and trial-start spec (for the builder and om-tracking-engineer)

Owner-dependent branches are marked **[D4]**, **[D5]** etc. = owner decision numbers in reports/owner-decisions.md. Nothing here is built; this is the target spec.

### 4.1 Principles
- Fewest possible fields before value. Ask only what the product needs to create the account.
- The proposal creation screen is the first thing a new user sees, not an empty dashboard (hand-off to G10 activation plan).
- Fire conversion events only on confirmed success, server-side (tracking.md section 3).
- Every plan choice is explicit in the URL so attribution survives: `/signup?plan=pro` or `/signup?plan=free`.

### 4.2 Steps

**Step 0, entry (marketing site).** CTA click opens `/signup` with `plan` set by the CTA (`pro` for the trial CTA, `free` for the free link). First-touch UTM params are stored (tracking.md section 4) and carried to the account record. Event: `cta_click` (cta_id, page_path). Diagnostic only, never a conversion.

**Step 1, account creation.**
- Fields: work or personal email, password (or email magic link, owner to choose). Nothing else: no company name, no phone, no team size, no role.
- Optional single-click sign-up with Google: **not verified as supported**; include only if the owner confirms the build. Treat as an enhancement, not a requirement.
- Show the plan chosen and the key terms on this screen: "14-day Pro trial", the price after the trial, and what happens at the end **[D5, post-trial behaviour]**. Show a link to terms and privacy.
- Consent: UK/EU consent for analytics is handled by the banner (tracking.md section 5). Marketing-email consent is a separate, unticked checkbox; do not pre-tick.
- Errors: inline, plain language, keep what the user typed. Duplicate email: offer sign-in, not a dead end.
- Event: `sign_up` (method, plan) on server success. Dedupe on `event_id`.

**Step 2, email verification.**
- Recommended: let the user into the app immediately and require verification before the first proposal is **sent** (not before it is drafted). This keeps friction away from the signup, and protects deliverability and the integrity of client-facing links.
- Verification email is transactional. Its copy is separate from the G11 trial sequence.

**Step 3, trial start (only when plan = pro).**
- **[D5 = card not required]:** trial starts right after Step 1. Set trial flag and end date (14 days, C10). Event `trial_started` (plan=pro, trial_days=14) from the server.
- **[D5 = card required]:** add a payment step before the trial starts, showing the date of the first charge and the amount, and an easy cancel path. Event `trial_started` fires only after the payment method is confirmed. Expect fewer trial starts for more committed ones; this is an owner trade-off, not a CRO default. Do not publish "no card" in this branch.
- Free signups (plan = free): no Step 3. Event `sign_up` only, plan=free. Whether this counts as the goal is decision 12; tracking.md already treats it as Secondary.
- Trial end behaviour **[owner]**: either automatic downgrade to Free (3 proposals a month, C7) or paid conversion. State it on the signup screen and in the Day 12 email.

**Step 4, first run (hand-off to G10).**
- Land the user on "new proposal" with the brief field focused. Skip a product tour; offer an optional sample proposal.
- Events: `brief_created`, `proposal_created`, `proposal_sent` (tracking.md section 3). Activation = `proposal_sent` within 7 days of `sign_up` (kpi-tree).
- At proposal 3 on Free, show the `plan_limit_reached` prompt (C7), including the Pro option and what it adds (needs decision 4).

### 4.3 Edge cases to cover
- User starts on Free, later wants the trial: one-click "Start 14-day Pro trial" from the limit prompt; fire `trial_started` then.
- User already had a trial: show it as used, do not restart it.
- Abandoned signup: no email to anyone who did not finish Step 1 (no address captured, and no consent).
- Mobile: all of Steps 1 to 3 must work on a phone; check target size and keyboard types (email field uses email keyboard).
- Accessibility: labels not placeholders, visible focus, error text linked to fields.
- Test accounts: the `test+qf@` convention in tracking.md section 6.

### 4.4 Metrics at each step
Visitors to CTA click (diagnostic), CTA click to sign_up, sign_up to trial_started (pro only), trial_started to proposal_sent within 7 days (activation), trial to paid. Report weekly on closed cohorts only (kpi-tree rules). No baselines exist; the first 50 signups set them.

## 5. Legal and policy note that touches the trial (verify with a lawyer)
Fact `K-d61ac4930b` (verified, official, medium confidence, 2026-10-19): UK draft guidance says the new subscription-contract rules apply to contracts entered into on or after 1 January 2027, but the supporting regulations still need Parliament's approval, so the date is **not confirmed**. Under the regime traders must give key pre-contract information, send reminders before renewals and after free or discounted trials, allow a 14-day cooling-off period, and let online sign-ups end the contract online in a straightforward way.
Implication for this spec: Quoteflow targets the UK (C11) and has a free trial. Design now so that (a) terms, price and renewal are visible at trial start, (b) a reminder goes out before the trial converts (the Day 12 email in G11 already fits), (c) cancellation is available in the app without contacting support. These are cheap to build in now. Whether the regime applies to this product is for the owner's lawyer; it is flagged here, not decided. Related owner escalation is in reports/legal-payments-escalation.md.

## 6. Objection coverage (icp.md table against the drafts)

| Objection (icp.md) | Where the draft answers it | Gap | Fix |
|---|---|---|---|
| Trust: "Never heard of you" | Free plan and trial lower the risk. No proof exists (C18) | No product visual, no named contact | Changes 3 and 12. Collect consented beta quotes later (G34); do not fake anything |
| Price: "I already pay for a suite" | Plan table with $0 / $19 / $49 | No comparison allowed (C16); Pro content unknown | Change 1. Lead with Free and $19. No "cheaper than" |
| Inertia: "My template works" | Section 1 (home A) lists what the single link holds | Does not name the template pain directly | Add one line contrasting "a document plus a signing tool plus a separate deposit request" with one link (C6). Draft A already hints at it in Section 1's last line |
| Technical: "Does it integrate?" | Not addressed | Visitor leaves silently | Change 7 |
| Payments: "Do you process the deposit?" | FAQ: "deposit request" | Answer is accurate but incomplete | Change 8 |
| Region: "Currency, VAT/GST?" | Not addressed | UK/CA/AU visitors unsure | Change 9 |
| Speed: "How fast, really?" | Not addressed (C12 banned) | Correct to stay silent without a timed demo | Run G14 timed demo, then re-mark C12 |
| Not in icp.md, but needed: "What does the trial turn into? Do I need a card?" | Not addressed | High-impact gap | Changes 2 and 10 |

## 6.1 The CTA hierarchy question (needs the owner)
Persona Solo Sam sends 2 to 6 briefs a month (a hypothesis in icp.md). The Free plan covers 3 proposals a month (C7). So a visitor can reasonably start on Free and never need Pro, while the KPI goal counts trial starts. Two readings:
- **Trial-first** (current drafts): trial CTA is primary, free is a link. Maximizes `trial_started` if people click it, but a trial that ends in a downgrade with nothing to compare may feel pointless (red team Risk 3).
- **Free-first**: "Start free" is primary, trial offered at the limit prompt (Step 4). Likely more signups and fewer trial starts, and no card friction, but it moves the goal metric.
This is exactly decision 12 and decision 4. I recommend trial-first only if Pro has a clear, visible benefit beyond volume (change 1). If it does not, choose free-first and measure "free signup to trial start at the limit prompt". Do not hide the free option: hiding it would look like a trap to the beachhead.

## 7. Experiments (sequenced; one landing test at a time per LEARNINGS P3)

Existing, not to be duplicated (P2): E-O8-1 (home A vs B), E-O11-1 (same idea), E-O15-1 (cap/trial from pricing page), E-JTBD-1, E-O18-3 (trial emails).

New, registered through the result file:
- **E-G09-1 (after E-O8-1 reads):** On the winning home variant, a visible product visual (real client-link screenshot or clip) above the fold raises CTA click-to-`sign_up`. Metric: sign_up per unique visitor and cta_click rate. One variable.
- **E-G09-2 (only if the owner permits two signup forms):** Showing the trial-end terms and card statement on the signup screen (vs only on the pricing page) raises sign_up to `trial_started`. Metric: trial_started per sign_up with plan=pro. One variable.

Sample-size honesty: with a goal of about 50 trial starts over 30 days, these tests cannot confirm small differences. Treat results as directional, pre-register the stop date and minimum signal in G37 (experiment designs), and never ship a "winner" on a handful of conversions. No numeric thresholds are asserted here.

## 8. What is missing / pending
- Live-page audit: needs the domain (product.json domain empty). research/site-inventory.md does not exist. Once live: check speed and Core Web Vitals, mobile layout, form behaviour, tag firing (tracking.md checklist), accessibility, and real analytics.
- Owner decisions that change this review: 0 (working app), 3 (payments), 4 (Pro vs Free), 5 (card), 12 (free signup as conversion), C14 (currency), post-trial behaviour.
- No Pro contents, no Free-vs-Pro difference, no post-trial rule, no auth method, no email provider, no entity/support contact.
- No user data or session recordings exist, so no friction was measured, only inferred.
- C12 to C19 remain banned and none were used.

## 9. Recommended next steps
1. Owner answers decisions 4, 5, 12 and post-trial behaviour by Fri Nov 6 (all affect the top three changes).
2. Re-run this review as a revision of home A/B and pricing once those answers exist (om-landing-builder), applying changes 1, 2, 4, 5, 6, 10.
3. G10 (activation plan) takes Step 4 of section 4.2 as input.
4. Live-page audit when the domain exists.
