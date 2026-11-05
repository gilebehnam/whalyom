# Legal and payments escalation: Quoteflow (sample)

Task T7, written 2026-11-03 by om-cmo. Sources: research/risks.md (T3, T4, Elephant 4), reports/owner-decisions.md (G01 lines 2, 3, 6, 8, 9), claims.md (C4, C5, C13, C14, C15), product.json, brief.md, plan.md (GN-6).
This is not legal advice. The legal frameworks named below are general knowledge and have not been checked. A lawyer must confirm them before anything goes live.
Reminder: brief.md says Quoteflow is a fictional test product. Nothing is published, sent or spent.

## Why this is escalated to you
The plan cannot clear go/no-go item GN-6 (plan.md) or the risks.md checklist line "ToS, privacy policy and refund policy exist, e-signature wording reviewed" until you answer the five questions below. OM agents cannot make these decisions. They can only draft outlines for your lawyer (G06) after you answer.

These questions are the same as G01 lines 2, 3, 8 and 9 in reports/owner-decisions.md, with more detail. One answer covers both documents.

| # | Decision | Answer by | G01 line | Blocks |
|---|---|---|---|---|
| L1 | EU scope | Fri Nov 6 | 2 | G06 privacy and cookie drafts, G13 email compliance, any EU copy (C13) |
| L2 | Deposit flow: request only, or processed? Which processor? | Fri Nov 6 | 3 | G06 terms and refund drafts, FAQ answers in G17 and G28, C15 |
| L3 | Subscription billing processor and refund policy for Pro and Team | Fri Nov 6 | 9 | G05 pricing page, G06 refund draft, G11 trial emails |
| L4 | Who drafts or reviews ToS, privacy, cookie and refund pages | Fri Nov 13 | 8 | G06 hand-off, G35 compliance pass |
| L5 | E-signature: what the product records, and lawyer review of the wording | Fri Nov 13 | 8 | All copy that mentions signing (C4), G17 and G28 FAQ |

## L1. Is the EU in scope? Yes / No
- product.json lists EU in `market`. brief.md and verified claim C11 list only US, UK, Canada and Australia. Until you answer, C13 ("suited to EU customers") stays needs-proof and no copy targets the EU.
- The UK is in scope either way. UK GDPR and the UK cookie rules (PECR) apply to UK signups no matter what you decide for the EU. So a privacy policy, a cookie notice and a data processing agreement (DPA) are needed in any case.
- A DPA is needed even without the EU: Quoteflow stores the personal data of your users' clients (names, emails, signatures), so Quoteflow acts as a processor for your users.
- If you answer **Yes**, the lawyer should also cover: EU GDPR, consent before any non-essential cookies, whether an EU representative is needed (the company has no EU establishment, as far as OM knows), where data is hosted and how it is transferred, and EU VAT on digital services. That last point also feeds G01 line 6 (currencies and VAT/GST, C14).
- If you answer **No**: remove EU from `market` in product.json (you or the main session does this, not an agent). Do not target EU communities, directories or keywords. Decide whether EU visitors can still sign up. If they can, GDPR may still apply to them, so ask the lawyer.

**Answer:** Yes / No. If No: can EU visitors still sign up? Yes / No.

## L2. Deposit flow: request only, or processed?
Verified claim C5 says proposals "include a deposit request". C15 (Quoteflow collects or processes payments) is needs-proof. Buyers will ask "does it take the deposit or just ask for it?" Pick one:

| Option | What happens | What you need before launch |
|---|---|---|
| A. Request only | The proposal shows the deposit amount and the freelancer's own payment link or bank details. No money passes through Quoteflow. | ToS text saying Quoteflow does not handle payments and is not a party to the freelancer-client payment. Copy says "deposit request" only. Lowest risk. |
| B. Processed through a third-party processor on the freelancer's own account | The client pays inside the proposal. The processor holds and moves the money to the freelancer's account. Quoteflow never holds funds. | Name the processor. Its platform terms, identity checks for freelancers, and dispute and refund handling. ToS and refund text that says who handles chargebacks. A lawyer check of the processor's platform rules. C15 can be re-marked verified only after an end-to-end test. |
| C. Quoteflow holds the funds | Money lands in a Quoteflow account and is paid out later. | Not recommended. In some countries this may need a money-transmission or payment licence. Do not choose this without a lawyer. |

Until you answer, every agent uses option A wording: "deposit request", never "collects payments", "get paid in the proposal" or "secure payments".

**Answer:** A / B (processor name) / C.

## L3. Subscription billing and refund policy for Pro ($19) and Team ($49)
This is a separate question from L2. It is about how users pay you, not how their clients pay them. `accounts.payments` is null in product.json.
- Which processor bills Pro and Team subscriptions? (Also answers G01 line 9.)
- Refund policy. Pick one, or write your own: no refunds for partial months / pro-rated refunds / refund within N days of the first charge (you give N).
- What happens when the 14-day trial (C10) ends without payment: drop to Free (3 proposals per month, C7) or lock the account?
- Is a card required for the trial? This is G01 line 5 (C19). It changes what the refund and cancellation text must say.
- Cancellation: self-serve in the app, or by email?
- Some markets have rules on automatic renewals and cancellation. The lawyer should confirm what the US states, UK, CA and AU need on the pricing page and in the checkout.

**Answer:** processor / refund rule / trial-end behaviour / cancellation route.

## L4. Who drafts and reviews the legal pages?
Needed pages: Terms of Service, privacy policy, cookie notice, refund and cancellation policy, and a DPA for users.
- OM can draft outlines marked "for lawyer review" (task G06, agent om-legal-pages, output outbox/legal/). Outlines are not final legal text and must not go live without your lawyer's sign-off.
- Please name the route: a named lawyer, a legal-template service you will have reviewed, or "owner writes them". Confirm that drafts may be sent to them.
- The entity that will appear in the ToS (company name, country, address) is needed for every page. Marketing email also needs a physical postal address (CAN-SPAM). Please give both, or say when they will exist.

**Answer:** route / entity name and country / postal address for email.

## L5. E-signature (C4)
Verified claim C4 says proposals "include e-signature". Validity differs by country. For a lawyer to confirm (general knowledge, unchecked): US ESIGN Act and UETA; UK Electronic Communications Act 2000 and UK eIDAS; EU eIDAS (only if L1 is Yes); Canada PIPEDA Part 2 and provincial electronic commerce laws; Australia Electronic Transactions Act 1999 and state acts.

What OM needs from you (for the lawyer):
1. What does the product record when a client signs? For example: typed name or drawn signature, email address, IP address, time stamp, a copy or hash of the signed document, and a completion certificate. Say which of these exist today.
2. Can the signer see the full proposal before signing and download a copy afterwards?
3. Is there a consent step ("I agree to sign electronically") before signing?

Wording rules until the lawyer signs off:
- Allowed: "e-signature", "clients sign online", "sign in the same link" (C4, C6).
- Banned: "legally binding", "legally valid in [country]", "court-admissible", "compliant with ESIGN / eIDAS", "as good as a wet signature".
- The FAQ answer on validity in the UK, CA and AU stays "pending lawyer review" (G17, G28).

**Answer:** list of what is recorded / view and download yes-no / consent step yes-no / lawyer route (same as L4).

## If you do not answer by the deadline
- Nov 6, L1 open: EU treated as out of scope for marketing. No EU targeting. Privacy and cookie work proceeds on UK GDPR and PECR as a minimum.
- Nov 6, L2 open: option A wording everywhere. C15 stays needs-proof.
- Nov 6, L3 open: the pricing page (G05) and trial emails (G11) cannot be approved.
- Nov 13, L4 or L5 open: GN-6 fails, and no public launch happens (no PH on Nov 17).

## What OM does after you answer
- G06 (om-legal-pages): outlines in outbox/legal/ for your lawyer.
- G13 (om-deliverability): email consent and unsubscribe checklist, using L1 and the L4 address.
- G35 (om-compliance-guard): checks every draft against the wording rules above.
- claims.md: C13 and C15 change only on your written answer plus proof. OM does not change them on its own.
