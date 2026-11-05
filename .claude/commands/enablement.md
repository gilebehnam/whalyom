---
description: "The kit sellers use: one-pager, discovery questions, objections, proof"
argument-hint: "<product-slug>"
---

Dispatch the `om-sales-enablement-lead` agent (`.claude/agents/om-sales-enablement-lead.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: the sales kit in sales/enablement/, dated, from claims.md and battlecards.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
