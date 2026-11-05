---
description: "Analytics, conversion events, UTMs and pixels so every channel can be measured"
argument-hint: "<product-slug>"
---

Dispatch the `om-tracking-engineer` agent (`.claude/agents/om-tracking-engineer.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: the tracking plan and what is broken today.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
