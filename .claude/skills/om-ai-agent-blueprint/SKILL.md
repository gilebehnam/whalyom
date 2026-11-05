---
name: om-ai-agent-blueprint
description: "Design a marketing or sales AI agent (website chat, SDR, support, voice, internal analyst) as a reviewable blueprint: job, users, tools, knowledge, memory, guardrails, human handoff, evals and launch gates. Use before building or changing any AI agent for a product or a client."
---

# AI agent blueprint

Write the blueprint to `research/ai/agents/<agent-slug>.md` before anyone builds. Fill every section; "n/a" needs a reason.

1. **Job.** One sentence: who it serves, the outcome it owns, the metric that proves it (e.g. "qualified demos booked per 100 chats"). One agent, one job; split when two metrics pull apart.
2. **Users and channels.** Visitor, lead, customer, staff; web chat, WhatsApp, email, phone, Slack. Languages and markets (they change the law that applies).
3. **Autonomy level.** 0 drafts for a human · 1 answers from approved knowledge only · 2 takes reversible actions (book, tag, create a ticket) · 3 takes irreversible actions (refund, discount, send to a list). Whalyom builds 0–2; level 3 always routes through an approval in `approvals.json`.
4. **Tools.** Each tool with: what it can change, rate limits, and the confirmation it needs. Least privilege: read-only unless the job needs writes.
5. **Knowledge.** Sources (claims.md, docs, pricing, policies), the owner of each, refresh cadence. The agent answers only from them; unknown → say so and hand off. Never let it invent prices, discounts, timelines or legal answers.
6. **Memory.** What it keeps per user, for how long, the lawful basis, and how a user deletes it.
7. **Guardrails.** Disclose it is an AI in the first message; refuse out-of-scope, medical, legal and financial advice; no impersonation of real people; prompt-injection defence (see `om-ai-guardrails`); PII redaction in logs.
8. **Human handoff.** Triggers (frustration, purchase above a threshold, complaint, legal words, two failed answers), the route, the response-time promise, and the summary passed to the human.
9. **Evals.** A golden set of 30+ real conversations with expected behaviour and a rubric (`om-ai-evals`); launch gate = pass rate and zero critical failures; re-run on every prompt, model or knowledge change.
10. **Launch.** Shadow mode (drafts only) → limited traffic → full; dashboards for containment, CSAT, handoff rate, conversion, cost per conversation.
11. **Costs.** Model tier per step (`om-ai-cost-routing`), expected tokens per conversation, monthly cap.

Before you hand it off, check the current rules in `om-knowledge-ai-tech` and `om-knowledge-ai-regulation` (disclosure, voice and robocall rules, the EU AI Act).
