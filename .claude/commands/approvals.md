---
description: "See and decide what is waiting for you; nothing goes out without it"
argument-hint: "<slug> [id] [yes|no|edit: ...]"
---

Without an id: list `products/<slug>/approvals.json` items with status `pending`, each with its compliance verdict.

With an id and a decision from the owner: Use the `om` skill and run its `approve $ARGUMENTS` command.

Only the owner decides. Never approve on the owner's behalf.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
