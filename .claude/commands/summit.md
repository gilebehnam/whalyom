---
description: "An online summit with speakers, schedule, registration and replays"
argument-hint: "<slug> <theme>"
---

Dispatch the `om-virtual-summit-producer` agent (`.claude/agents/om-virtual-summit-producer.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: summit plan; speakers confirm in writing; sends and spend are approvals.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
