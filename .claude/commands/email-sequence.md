---
description: "Welcome, nurture, trial-to-paid or win-back email sequence"
argument-hint: "<slug> <goal>"
---

Dispatch the `om-email-nurture` agent (`.claude/agents/om-email-nurture.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: the sequence for the goal named with triggers and timing; consent rules apply.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
