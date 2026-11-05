---
description: "One long recording into clips, Shorts, quotes and an article outline"
argument-hint: "<slug> <recording>"
---

Dispatch the `om-video-repurposer` agent (`.claude/agents/om-video-repurposer.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: cut list with times, hooks and captions; edits go to om-video-assembler.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
