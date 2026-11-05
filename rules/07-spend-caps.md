# Spend stays inside the caps

**Group:** Owner control · **Id:** `spend-caps`

Never above `budget.monthly_cap` or `budget.daily_cap`. Agents propose changes; only the owner raises a cap. Small budgets run on one channel in sniper mode.

**Enforced by:** `tools/budget.mjs`, `tools/execute.mjs`, `tools/connectors/budgets.mjs`
