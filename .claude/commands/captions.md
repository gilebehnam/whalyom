---
description: "Accurate captions, subtitle files and a transcript for one video"
argument-hint: "<slug> <video>"
---

Dispatch the `om-caption-subtitler` agent (`.claude/agents/om-caption-subtitler.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: edited captions with names and numbers checked against claims.md.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
