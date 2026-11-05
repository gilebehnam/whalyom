---
description: "Rewrite a draft so it reads like an experienced person wrote it"
argument-hint: "<slug> <file>"
---

Dispatch the `om-humanizer` agent (`.claude/agents/om-humanizer.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: remove AI tells and filler from the named draft and keep every fact.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
