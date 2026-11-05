---
description: "Names for a product, plan or campaign, screened for meaning, domains and conflicts"
argument-hint: "<slug> <what to name>"
---

Dispatch the `om-naming-strategist` agent (`.claude/agents/om-naming-strategist.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: candidates for what the owner named, screened in each target language, with domain and handle checks.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
