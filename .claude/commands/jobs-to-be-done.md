---
description: "The jobs, triggers, anxieties and forces that make buyers switch"
argument-hint: "<product-slug>"
---

Dispatch the `om-jtbd-analyst` agent (`.claude/agents/om-jtbd-analyst.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: jobs, triggers and switching forces with quotes and sources.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
