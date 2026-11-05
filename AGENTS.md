# AGENTS.md

Instructions for coding agents (Codex, Claude Code, Cursor and others) working in a Whalyom workspace.

## What this is

Whalyom is a marketing and sales operating system that runs inside a coding agent.
The workforce is 536 agents (`.claude/agents/om-*.md`) in 28 departments and 6 layers.
Their methods are 498 skills (`.claude/skills/<name>/SKILL.md`, Agent Skills format).
The owner drives it with 106 commands (`.claude/commands/*.md`; in Codex they are installed as prompts by `./install.sh --codex`).
The engine is Node scripts in `tools/` (no LLM inside; deterministic, tested).

## How to work here

1. Read `rules/README.md` first. The 50 rules are not optional.
2. One workspace per product: `products/<slug>/`. Before any task read its `product.json`, `profile.md`, `claims.md` and `LEARNINGS.md`, and `knowledge/briefs/<department>.md`.
3. To act as an agent, read its file in `.claude/agents/` and follow it. If your harness cannot launch sub-agents, do the agents' steps yourself in order.
4. Write results to files and to `products/<slug>/runs/<task-id>.json`. Never edit `tasks.json`, `approvals.json` or `experiments.json`; run `node tools/apply-results.mjs <slug>`.
5. Nothing outbound without the owner: drafts go to `outbox/` with an entry the owner approves. Only `node tools/execute.mjs <slug>` sends, publishes or spends.
6. Use only claims listed in `claims.md`. No invented numbers, testimonials or customer names.
7. After changing anything in `tools/`, run `npm test` and keep it green.

## Useful entry points

| Goal | Run |
|---|---|
| New product | `node tools/new-product.mjs <slug> --domain <domain>` |
| Instant audit of a site | `node tools/instant-onboard.mjs <domain>` |
| What is ready to work on | `node tools/ready.mjs <slug> 10` |
| Funnel and next actions | `node tools/funnel.mjs <slug>` |
| One deterministic cycle | `node tools/daemon.mjs` |
| Local Command Center | `npm run command-center` (http://localhost:4321) |
| MCP server | `npm run mcp` |
