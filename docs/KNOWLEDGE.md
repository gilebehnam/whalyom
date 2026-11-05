# Knowledge and self-update

Whalyom keeps what its agents know about digital marketing current, and improves its own agents, without loosening any guard the owner set.

## How knowledge stays current

```
29 official / research feeds ──refresh──▶ knowledge/inbox.jsonl
        │                                   (agents' "knowledge_tips" join here too)
        ▼
 scouts and watchers ──▶ knowledge/runs/<id>.json   candidate facts, each with its source page and date
        ▼
 om-fact-verifier    ──▶ knowledge/runs/<id>-V.json keep / fix / reject from a separate verifier run; no verdict = reject
        ▼
 node tools/knowledge.mjs apply  ──▶ knowledge/base.json   (single writer, like apply-results)
        ▼
 node tools/knowledge.mjs brief  ──▶ knowledge/briefs/<dept>.md, knowledge/BRIEFING.md,
                                     .claude/skills/om-knowledge-<topic>/SKILL.md
        ▼
 every agent: "Before you start" reads its department brief; "Current knowledge" lists its topic skills
```

- **Sources** (`knowledge/sources.json`): platform and regulator feeds first (Google Search Central, Search Status, Google Ads, Bing, Microsoft Advertising, Meta, YouTube, OpenAI, Apple, Google Play, Stripe, Cloudflare, IAB Tech Lab, W3C WAI, EDPB, CNIL, FTC), research (arXiv cs.IR and econ.GN, Nielsen Norman Group, McKinsey Insights, MIT Sloan Management Review; HBR and the consulting firms that block feeds are read by om-management-research-reader in the Grow step), and trade press only to find primary sources. Sites that refuse automated fetches are left out.
- **Facts** are specific, dated and sourced: topic, statement, source URL and tier, published date, confidence (high or medium), review date, the agents they affect. Industry press can never be a fact's only source. `tools/knowledge/topics.mjs` maps 16 topics to departments.
- **Growth**: `node tools/knowledge.mjs check` lists `gaps`, the topics under the target of 15 verified facts, thinnest first. The Grow step of `om-knowledge-refresh` sends the thinnest topics to the right researcher (consulting and research to the marketing science reader, laws to the regulation watcher, platforms to the algorithm and policy watchers, AI to the frontier radar), and the fact verifier checks every new fact. So the base deepens itself where it is weakest, every run.
- **Kinds**: rule (platform, law, policy), framework (the consulting canon: evergreen methods with their primary source), benchmark (dated number with segment and sample), finding (research result with effect size), case. 22 topics, including digital marketing management consulting, the marketing, sales and brand canon (canon-marketing, canon-sales, canon-brand) and the strategy and management canon (McKinsey, BCG, Bain, the Big Four, HBR, HBS; facts cite the firms' and journals' own pages, written in Whalyom's own words) and AI agents and agentic commerce.
- **Freshness**: each fact has a review date (30 days for fast-moving topics, 90 by default, 180 for laws in force). `check --mark` flags stale facts; the curator re-verifies or retires them; facts left unverified for a full extra period drop out of the briefs. Nothing is deleted: superseded and retired facts keep their history (`knowledge/CHANGELOG.md`).
- **Seed**: 69 facts from official pages, collected and spot-checked on 2026-11-03 (run `SEED-2026-11-03`, merged as a trusted bootstrap).

| Command | What it does |
|---|---|
| `node tools/knowledge.mjs cycle` | Fetch feeds if due, merge verified runs, mark stale facts, rebuild briefs and skills. The daemon runs it every cycle; fetching happens once per `refresh_every_hours`. |
| `node tools/knowledge.mjs refresh [--force] [--only <id>]` | Fetch only. Honours HTTP(S)_PROXY. |
| `node tools/knowledge.mjs apply [--trust <run-id>]` | Merge runs. Unverified runs wait unless the owner trusts them. |
| `node tools/knowledge.mjs check [--mark]` | Stale facts, failing feeds, outdated briefs, topics with no facts. Also writes `state/knowledge.json` and Needs-You-Know alerts. |
| `node tools/knowledge.mjs search "<words>" [--topic t] [--limit n]` | The best-matching verified facts from the whole base. Every agent's "Current knowledge" section tells it to search the base (Grep `knowledge/base.json`, or this command when it has Bash) for anything its topic skills do not cover. |
| `node tools/knowledge.mjs brief` | Department briefs, `BRIEFING.md`, the 16 `om-knowledge-*` skills. |
| `flow om-knowledge-refresh` | The full loop with the LLM steps: extract, verify, curate, teach agents, alert affected products. |

`OM_KNOWLEDGE_OFFLINE=1` skips fetching (tests use it).

## How the agents improve themselves

`om-evolve` (weekly) and the Teach step of `om-knowledge-refresh` produce **proposals** in `state/evolution/proposals/`. `tools/evolve.mjs` is the only thing that ships them, and it writes only to `config/agent-overrides.json` (rules and skills per agent) or `.claude/skills/om-learned-*`; `tools/roster.mjs` merges the overrides into every agent's "Learned rules" at build time.

A proposal ships only when all of these hold (`config/evolution.json`, an owner-only file):

1. `mode` is `auto-safe` (the default the owner chose), or the owner runs `apply <id> --owner`.
2. It survived the red team (and the skill auditor in `om-evolve`).
3. An agent rule either cites active, high-confidence knowledge facts, or shows a benchmark gain of at least `min_bench_gain` on that agent's golden set (`om-agent-bench`).
4. The text passes the guards: nothing that skips approvals, touches budget caps, acts outbound without approval, overrides CLAUDE.md or claims.md, invents claims, mentions credentials or breaks platform rules.
5. No protected path is touched (CLAUDE.md, the evolution config, policy, execute, budget, killswitch, apply-results, connectors, satellite, .env).
6. At most `max_changes_per_cycle` changes per cycle and `max_rules_per_agent` rules per agent; then `npm test` must pass, or every change of the cycle is rolled back.

**New agents.** The Grow phase of `om-evolve` looks for gaps no agent or skill covers (new AI marketing tools, blocked tasks, new knowledge) and writes `new-agent` or `local-skill` proposals. A new agent ships as `om-grown-<slug>` in `config/learned-agents.json` (merged by the roster as pod "Grown by Whalyom") only if: `agents.new_agents` in `config/evolution.json` allows it; it uses sonnet or haiku and web tools only (no shell); its skills are installed; it cites at least one active knowledge fact showing the gap; the red team and the skill auditor passed it; and at most `max_per_cycle` (3) per run and `max_total` (80) overall. `node tools/evolve.mjs rollback <id> --build` removes it.

**Daily.** The local scheduled task "Whalyom: daily learning and self-improvement" (07:30 every day, while the Claude app is open) runs `knowledge.mjs cycle`, `om-knowledge-refresh`, `om-evolve` (with Grow) and, on Mondays, the skill scout; then builds, tests (rolling back on failure), commits and pushes. The cloud routine "OM daily autopilot" keeps running the products.

External skills and connectors are never installed by the loop: `om-tool-scout` proposes them, `om-skill-auditor` reviews them, the owner installs them.

| Command | What it does |
|---|---|
| `node tools/evolve.mjs status` | Mode, learned rules and skills, pending proposals, last changes |
| `node tools/evolve.mjs validate <id>` | Why a proposal would or would not ship |
| `node tools/evolve.mjs apply <id\|all> [--owner] [--build]` | Ship proposals inside the limits |
| `node tools/evolve.mjs rollback <id> --build` | Remove exactly what one proposal added |

## The workforce this feeds

- **30 mega agents** (`om-mega-<dept>` for each of the 28 departments, plus `om-mega-revenue` and `om-mega-launch`): opus department heads that run a whole department in one pass, master every skill pack their mandate spans, and hand the rest to the specialists listed in their file. `flow om-mega-sweep <slug>` runs them all.
- **Core specialists** (the current count per tier is in `state/agents.json`), each with its method skills, its department skill pack and its current-knowledge skills (32 skills per agent on average).
- **Micro agents** (`om-micro-*`, haiku): one input, one output, one job (meta titles, UTM links, sample sizes, spam checks, claim checks…), cheap enough to run by the hundred.
- **12 knowledge and evolution agents**: knowledge scout, algorithm, policy and regulation watchers, marketing science reader, benchmark keeper, martech and skill scout, fact verifier, knowledge curator, skill smith, evolution director, playbook editor.
