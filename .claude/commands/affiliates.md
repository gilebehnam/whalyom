---
description: "An affiliate program: who to recruit, terms, fraud checks"
argument-hint: "<product-slug>"
---

Dispatch the `om-affiliate-recruiter` agent (`.claude/agents/om-affiliate-recruiter.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: affiliate candidates and the pitch; terms and payouts are owner decisions.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
