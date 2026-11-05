---
name: om-ai-evals
description: "Build and run evaluations for prompts, agents and generated marketing output: golden sets, rubrics, LLM-as-judge with bias controls, pass thresholds and regression checks. Use before shipping or changing a prompt, an agent, a model or a knowledge source, and inside om-evolve benchmarks."
---

# Evals for marketing AI

**Golden set.** 20–50 cases drawn from real work (tasks, chats, briefs), stratified: easy, typical, hard, adversarial (prompt injection, off-topic, angry user, missing data). Store as JSON: `{id, input, context, must, must_not, reference?}`. Freeze it; add cases, never edit old ones silently.

**Redact before storing.** Real cases carry personal data. Redact names, emails, phone numbers, addresses and payment data (replace with placeholders such as `[NAME]`, `[EMAIL]`) before a case enters the golden set. Keep product golden sets in `products/<slug>/research/ai/evals/`. System golden sets live in `state/evolution/bench/<agent>-golden.json` (the write path of om-ai-eval-designer and om-prompt-injection-sentinel) and must be fully redacted or synthetic: no personal data ever enters `state/`.

**Rubric.** 4–6 binary, checkable criteria per case (binary beats 1–10 scales): follows the brief; uses only verified claims; applies current knowledge; complete; correct format and limits; safe (no guardrail broken). A critical criterion (claims, safety, law) fails the whole case.

**Judging.**
- Prefer code checks first (length, required fields, banned words, links resolve, JSON valid).
- LLM judge for the rest: give it the rubric and the case, ask for a verdict per criterion with a quoted reason; temperature low.
- Control bias: shuffle order when comparing two outputs, judge each pair twice with positions swapped, use a different model tier from the one that generated, spot-check 10% by hand.
- Report pass rate with the count (e.g. 41/48), not just a percentage, and list failures.

**Thresholds.** For om-evolve proposals, write `bench: {before, after}` as pass-rate fractions from 0 to 1 (41/48 is `0.854`), not percentages or counts. A change ships only when `after − before ≥ agents.min_bench_gain` in `config/evolution.json` (0.02 today) and there are zero critical failures; an equal or lower score is rejected by `tools/evolve.mjs`, and a gain of exactly 0.02 can round just below the gate, so claim a clear margin. Keep the raw count (41/48) in the proposal notes. A gain near the threshold on fewer than 30 cases is noise: add cases before claiming it.

**Regression.** Re-run on every change of prompt, model, tool or knowledge. Keep scores in `state/evolution/bench/<agent>-<date>.json` so trends are visible. Score files hold scores, counts and case ids only, never case text, inputs or outputs.

**Anti-gaming.** The thing being improved never sees the rubric's hidden cases; rotate 20% of cases each quarter; a red team reviews big jumps.
