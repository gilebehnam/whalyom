---
description: "Profit per order and per customer by channel, and break-even ROAS"
argument-hint: "<product-slug>"
---

Dispatch the `om-unit-economics-analyst` agent (`.claude/agents/om-unit-economics-analyst.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: contribution margin per channel from real exports.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
