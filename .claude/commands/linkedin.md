---
description: "Founder and company posts for B2B audiences"
argument-hint: "<product-slug>"
---

Dispatch the `om-linkedin` agent (`.claude/agents/om-linkedin.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: a week of LinkedIn posts from real stories and claims.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
