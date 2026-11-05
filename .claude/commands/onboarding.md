---
description: "The first 30 days of a new customer, to the first value moment"
argument-hint: "<product-slug>"
---

Dispatch the `om-success-onboarding-manager` agent (`.claude/agents/om-success-onboarding-manager.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: first value moment from usage data and the steps to reach it.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
