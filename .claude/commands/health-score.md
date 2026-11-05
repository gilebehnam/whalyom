---
description: "Customer health from usage, billing and support, and who needs attention"
argument-hint: "<product-slug>"
---

Dispatch the `om-health-score-designer` agent (`.claude/agents/om-health-score-designer.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: a health score with stated weights and this week's at-risk accounts.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
