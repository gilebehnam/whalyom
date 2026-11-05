---
description: "A case study from a real result, with the customer's written approval"
argument-hint: "<slug> <customer>"
---

Dispatch the `om-case-study-writer` agent (`.claude/agents/om-case-study-writer.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: a case study only from results the owner provides; the customer approves quotes and numbers before use.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
