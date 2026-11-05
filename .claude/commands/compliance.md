---
description: "Check drafts against claims, platform rules and email law before approval"
argument-hint: "<slug> [file]"
---

Dispatch the `om-compliance-guard` agent (`.claude/agents/om-compliance-guard.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: review the named drafts (or every pending one) and write the verdicts.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
