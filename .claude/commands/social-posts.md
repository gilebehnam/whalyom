---
description: "Turn one piece into posts for X, LinkedIn, Reddit and newsletters"
argument-hint: "<slug> <source>"
---

Dispatch the `om-social-repurposer` agent (`.claude/agents/om-social-repurposer.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: repurpose the source into channel-native posts with tracked links.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
