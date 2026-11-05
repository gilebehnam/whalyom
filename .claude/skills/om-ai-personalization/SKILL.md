---
name: om-ai-personalization
description: "Design AI-driven personalization (pages, emails, offers, recommendations) that lifts conversion without breaking consent, fairness or trust: signals allowed, segment-vs-1:1 choice, guardrails, holdouts and measurement. Use before any personalized experience or dynamic content goes live."
---

# Safe AI personalization

**1. Signals.**
List every signal used and its lawful basis:
- traffic source, campaign, query
- page behaviour
- declared preferences
- purchase history
- firmographics for B2B

Never use sensitive categories (health, religion, sexuality, politics, ethnicity, precise location) without explicit consent and a clear user benefit. Never infer them.

**2. Start with segments.**
- Begin with 3–6 segments that are clear and explainable: source × intent, or industry × size.
- Go 1:1 only when each segment has enough traffic, and a test shows 1:1 beats segments.

**3. What may change.**
- **May change:** headline, examples, proof shown, order of benefits, recommended plan, content topics.
- **Never personalized:**
  - prices for protected groups
  - the legal terms
  - claims (all variants use claims.md)
  - anything that would mislead a person who sees a different variant

**4. Guardrails.**
- Every generated variant passes the claim check and the brand check before it is eligible.
- A fallback default exists for unknown visitors.
- Users can see why they get a recommendation where the law requires it, and can turn personalization off.

**5. Measure with a holdout.**
- Keep 10–20% of traffic on the default.
- Report lift against the holdout with an interval.
- Watch guardrail metrics: refunds, complaints, unsubscribes, the gap in experience between segments.

**6. Review.** Before launch, `om-privacy-officer` checks the data map and `om-consent-compliance` checks the consent signals. Check `om-knowledge-privacy-law` for current rules.
