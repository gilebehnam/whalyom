---
description: "One answer-first, sourced article from a brief"
argument-hint: "<slug> <topic or keyword>"
---

Dispatch the `om-writer` agent (`.claude/agents/om-writer.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: one article for the topic named, answer first, every fact sourced, then om-editor checks it.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
