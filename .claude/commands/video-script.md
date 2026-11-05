---
description: "A short-form script or a YouTube outline that demos the product"
argument-hint: "<slug> <topic>"
---

Dispatch the `om-video-scripter` agent (`.claude/agents/om-video-scripter.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: a script with a hook in the first seconds, the demo and one call to action.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
