---
description: "Spend this month against the caps, per channel, and the proposed split"
argument-hint: "<product-slug>"
---

Run `node tools/budget.mjs $ARGUMENTS` and `node tools/reallocate.mjs $ARGUMENTS --dry-run`.

Show spend against `monthly_cap` and `daily_cap`. Only the owner can raise a cap.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
