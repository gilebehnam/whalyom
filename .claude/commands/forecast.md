---
description: "Next month's leads and revenue from trends and planned work"
argument-hint: "<product-slug>"
---

Dispatch the `om-forecaster` agent (`.claude/agents/om-forecaster.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: forecast with a range and the assumptions.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
