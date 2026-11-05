---
description: "Win back churned and inactive customers"
argument-hint: "<product-slug>"
---

Dispatch the `om-winback` agent (`.claude/agents/om-winback.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: a win-back campaign for consented contacts only.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
