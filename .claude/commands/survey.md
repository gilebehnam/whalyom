---
description: "An NPS or feedback survey, and a summary of the answers"
argument-hint: "<product-slug>"
---

Dispatch the `om-nps-survey` agent (`.claude/agents/om-nps-survey.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: the survey and, when answers exist, the themes with quotes.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
