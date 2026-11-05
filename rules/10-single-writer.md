# One writer per ledger

**Group:** Owner control · **Id:** `single-writer`

Agents never edit `tasks.json`, `approvals.json` or `experiments.json`. They write `runs/<task-id>.json`; `tools/apply-results.mjs` merges it.

**Enforced by:** `tools/apply-results.mjs`
