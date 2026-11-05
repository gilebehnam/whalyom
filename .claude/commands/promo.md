---
description: "An in-store, pop-up or event promotion with a code that proves what it brought"
argument-hint: "<slug> <occasion>"
---

Dispatch the `om-field-promo-planner` agent (`.claude/agents/om-field-promo-planner.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: the promotion with its code, dates and material; printing and spend are approvals.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
