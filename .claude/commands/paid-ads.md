---
description: "Paid media inside the caps: sniper mode for small budgets, portfolio for larger ones"
argument-hint: "<product-slug>"
---

Read `budget.monthly_cap` and `budget.micro_threshold` in `products/<slug>/product.json`.

At or under the threshold: Use the `om` skill and run `flow om-paid-sniper <slug>` (the saved workflow `.claude/workflows/om-paid-sniper.js`).

Above it: Use the `om` skill and run `flow om-paid-portfolio <slug>` (the saved workflow `.claude/workflows/om-paid-portfolio.js`).

No spend happens without an approval and the caps.

Rules: follow `rules/` (claims only from `claims.md`, nothing outbound without the owner's approval, spend inside the caps, platform and privacy rules).
