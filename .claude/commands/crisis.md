---
description: "Holding statement, FAQ, replies and what to pause when something goes wrong"
argument-hint: "<slug> <what happened>"
---

Dispatch the `om-crisis-responder` agent (`.claude/agents/om-crisis-responder.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: holding statement and FAQ for the incident described, and the list of scheduled posts and ads to pause.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
