---
description: "Review pricing and packaging; prices stay the owner's decision"
argument-hint: "<product-slug>"
---

Dispatch the `om-pricing-offer` agent (`.claude/agents/om-pricing-offer.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: packaging and price review with competitor prices from research/; any price change is an owner decision.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
