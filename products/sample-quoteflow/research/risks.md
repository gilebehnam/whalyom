# Risk register and pre-mortem: Quoteflow (sample)

Written by om-risk-officer (task O17), 2026-11-02. Sources: brief.md, product.json, profile.md, claims.md. There is no domain, so all live-site checks are listed under Pending. Competitor facts and platform rules below are general knowledge or unverified; check them before relying on them.

> brief.md says this product is fictional and nothing may be published. Every guardrail below is also true for a real launch.

## Summary
Tigers: 10 (4 launch-blocking, 4 fast-follow, 2 track). Paper Tigers: 4. Elephants: 4.
Premise: it is 30 days after launch and Quoteflow got fewer than 50 trial signups, or got banned or flagged. Why?

## Launch-blocking Tigers
| # | Risk | Likelihood | Impact | Guardrail | Owner |
|---|---|---|---|---|---|
| T1 | Unproven claims in copy: "in minutes" (C12), "cheaper than X" (C16), EU suitability (C13), local currency or VAT/GST (C14), no-card trial (C19), integrations (C17), any customer count or testimonial (C18). Exposure: ad and consumer-protection rules (FTC, ASA UK, ACCC AU), trust loss. | High | High | Use only claims C1-C11. Reviewers reject any draft with a needs-proof claim. For "in minutes", run and time a demo, then re-mark C12 verified. Comparison copy waits for checked competitor pages. | om-copywriters, owner |
| T2 | Fabricated social proof. The product has no users, so any quote, logo, rating or "join N freelancers" line is false. Exposure: FTC rule on fake reviews, platform bans. | Medium | High | Zero testimonials until real, consented ones exist. Use "early access" or "beta" wording only if it is true. Never seed reviews on G2, Capterra, Product Hunt or Trustpilot. | om-risk-officer, all content agents |
| T3 | Legal and payments exposure from the product itself. E-signature validity differs by country (ESIGN/UETA in the US, eIDAS in the UK/EU, ETA in AU/CA). A "deposit request" may be read as Quoteflow taking payments (C15), which brings processor terms, money-transmitter and refund questions. No ToS, privacy policy, DPA or refund policy exists yet. | Medium | High | Do not say "legally binding" or "collects payments". Say "deposit request" only. Before launch, the owner provides ToS, privacy policy and cookie notice, and confirms the payment flow and processor. Have a lawyer review the e-signature wording. | owner (legal) |
| T4 | Privacy and email compliance. Trial signup collects personal data and the product holds client data of third parties. GDPR/UK GDPR applies if EU or UK people sign up (EU is in product.json but not in the brief). CAN-SPAM, CASL (Canada) and the Australian Spam Act cover marketing email. | Medium | High | Resolve the EU question (owner). Use opt-in only, an unsubscribe link and a physical address in every email, and record consent. No purchased lists. No cold email until consent rules are signed off. The email provider is not set up, so there is no sending. | om-email agents, owner |

## Fast-follow Tigers
| # | Risk | Likelihood | Impact | Planned response |
|---|---|---|---|---|
| T5 | Account bans and spam flags in communities (Reddit, Indie Hackers, Hacker News, Facebook groups, LinkedIn). A new account that only promotes a tool gets removed or shadow-banned. | High | Medium | Participate first (about 9 helpful posts to 1 mention). Read each community's self-promotion rule before posting. One account per real person, no vote asking, no multiple accounts. All posts go through approvals. Check the platform rules at the live community before each post. |
| T6 | Directory and review-site penalties. Submitting to many directories or posting self-reviews can get listings removed. Link schemes can hurt SEO. | Medium | Medium | Submit only to relevant directories, once each, with accurate listings. No paid link bundles and no AI-generated review posts. |
| T7 | SEO and GEO thin or duplicate content. Programmatic comparison pages ("Quoteflow vs Bonsai") built on unverified competitor facts risk defamation, trademark complaints and a quality penalty. | Medium | Medium | Compare only after checking each competitor's own page and cite it with a date. Use competitor names descriptively, never in logos or titles that imply endorsement. Cap new pages until the first ones are indexed. |
| T8 | Weak trial-to-value path and bad first reviews. Free plan at 3 proposals/month plus a 14-day Pro trial may attract tire-kickers. Early bugs in signing or the deposit flow hurt more than in other tools because clients see them. | Medium | High | Run a closed beta before any public push. Test the signature and deposit flow end to end with real test clients. Have a support inbox and a response target. Ask for reviews only from users who completed a proposal. |

## Track Tigers
- T9: Incumbent response. Bonsai, HoneyBook, Proposify and PandaDoc have bigger budgets and may undercut on price or SEO. Trigger: a competitor launches a free tier or a "brief to proposal" feature. Response: re-run positioning (om-positioning agents).
- T10: Free mode caps ads at $0, so reach depends on organic channels with slow feedback. Trigger: fewer than 10 signups by day 14. Response: narrow to one channel and one ICP segment; do not raise the cap without the owner.

## Paper Tigers
- Competition from large suites: they serve a broader job; a narrow tool can still win a niche. It becomes a Tiger if suites ship a free standalone proposal tool.
- Pricing too low at $19 and $49: the price is unproven but cheap to change. Price changes need owner approval anyway.
- "Fictional test product" label: it only matters if anything is published. All work stays in outbox/.
- Missing logo or testimonials: not a risk if the copy never pretends to have them.

## Elephants
1. Nobody has validated demand. There are no customers and the evidence is second-hand (research/voc.md). Start: "What would make us stop at day 14?"
2. The founder may not have time or skill to build and support signing and deposits safely. Start: "Who answers support at 9pm?"
3. The 50-signup goal has no target for activation or revenue; signups alone may not matter. Start: "What is a good signup?"
4. Are signatures and deposits legally ready in four countries, or only in one? Start: "Which country do we launch in first?"

## Guardrails by channel (apply to all agents)
- Social, communities: no fake accounts, no vote asking, no bulk DMs, no scraping against terms. Disclose affiliation ("I built this").
- Email: opt-in, unsubscribe, sender identity, honor opt-outs within 10 business days (CAN-SPAM), CASL consent in Canada.
- Ads: none ($0 cap). If ever added, owner approves, and landing pages must match claims.
- Reviews and press: no incentives without disclosure; never write reviews for the product.
- Brand: do not use competitor logos or imply partnership. Do not use "best", "#1", "fastest".
- Data: do not collect more than needed; no client data in marketing examples.

## Go/No-Go checklist
- [ ] Copy uses only C1-C11 (T1)
- [ ] ToS, privacy policy and refund policy exist, e-signature wording reviewed (T3)
- [ ] EU decision made (T4)
- [ ] Email provider with consent and unsubscribe set up (T4)
- [ ] Signature and deposit flow tested end to end (T8)
- [ ] Support inbox and owner named (T8)
- [ ] Community rules read before each post (T5)

## Pending (needs a domain or the owner)
- Check the live site for unproven claims, missing legal pages, cookie consent, tracking scripts and form consent text.
- Check competitor pages before any comparison.
- Owner: confirm EU scope, payment flow and processor, country list, currencies.
- Verify platform rules (Reddit, Product Hunt, directories) at the time of each post.
