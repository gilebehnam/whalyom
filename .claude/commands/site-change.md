---
description: "Ship an approved site change as a reviewed diff with a rollback"
argument-hint: "<slug> <change>"
---

Dispatch the `om-site-engineer` agent (`.claude/agents/om-site-engineer.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: the change as files under outbox/martech/changes/ with test and rollback; nothing goes live without approval.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
