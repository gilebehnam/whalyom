---
description: "Grow and answer reviews honestly on the sites buyers check"
argument-hint: "<product-slug>"
---

Dispatch the `om-reputation-manager` agent (`.claude/agents/om-reputation-manager.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: review audit and plan; ask every customer, never gated or paid; replies are approvals.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
