---
description: "Edit and fact-check a draft before it goes anywhere"
argument-hint: "<slug> <file>"
---

Dispatch the `om-editor` agent (`.claude/agents/om-editor.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: edit the named draft for clarity and voice and check every fact and claim.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
