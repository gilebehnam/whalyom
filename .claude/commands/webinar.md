---
description: "A webinar or live demo: topic, outline, invites and follow-up"
argument-hint: "<slug> [topic]"
---

Dispatch the `om-webinar-producer` agent (`.claude/agents/om-webinar-producer.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: the webinar plan and invite sequence; sends are approvals.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
