---
description: "An in-person meetup or workshop with run sheet and follow-up"
argument-hint: "<slug> <city or topic>"
---

Dispatch the `om-meetup-organizer` agent (`.claude/agents/om-meetup-organizer.md`) on `products/<slug>/` (the slug is the first word of: $ARGUMENTS; anything after it is the owner's extra instruction).

Brief: the full run sheet, registration with consent and follow-up.

When it returns, run `node tools/apply-results.mjs <slug>` and show the owner what was written and any approvals it created.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
