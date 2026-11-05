---
description: "The marketing tools you pay for: overlap, unused seats, cost and data flows"
argument-hint: "<product-slug>"
---

Dispatch the `om-martech-stack-auditor` agent (`.claude/agents/om-martech-stack-auditor.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: stack table with keep, replace or cancel and the reason.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
