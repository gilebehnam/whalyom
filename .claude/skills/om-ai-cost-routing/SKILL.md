---
name: om-ai-cost-routing
description: "Choose the model tier, context size and run pattern for each AI step so quality holds at the lowest cost: haiku for narrow single jobs, sonnet for standard work, opus for strategy and judgment; caching, batching and early exits. Use when designing workflows, agents or client AI features, and when costs rise."
---

# Cost routing for AI work

**Tier by task, not by importance.**
| Task shape | Tier | Examples |
|---|---|---|
| One input → one bounded output, a clear check exists | haiku | meta titles, UTM links, classification, extraction, format fixes (the `om-micro-*` agents) |
| Multi-step drafting or analysis with a brief | sonnet | articles, campaigns, audits, sequences |
| Open-ended judgment, strategy, conflicting evidence, adversarial review | opus | plans, mega agents, red team, positioning, evaluation of hard cases |

**Patterns.**
1. **Cascade:** run the cheap tier first; escalate only when its self-check or a code check fails.
2. **Cache:** keep stable context first in the prompt (rules, brand, claims, knowledge brief) so prompt caching hits; put the variable task last.
3. **Batch:** non-urgent bulk work (hundreds of micro jobs) goes through batch processing when the platform offers it.
4. **Trim:** send the fields the task needs, not whole files; summarize long histories once and reuse the summary.
5. **Early exit:** stop a loop when the gain per round falls under a threshold (the evolve and CRO loops do this).
6. **Measure:** log tokens per task and cost per useful output (per published article, per qualified lead), not cost per call.

**Guard.** A cheaper route ships only when its eval score (`om-ai-evals`) is within the agreed tolerance of the expensive one. Check `om-knowledge-ai-tech` for current model and pricing changes before re-routing.
