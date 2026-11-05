---
name: whalyom
description: Whalyom — Your Entire Marketing Department. Zero Payroll. The main command for the autonomous marketing, branding and revenue engine in this project. Use for "/whalyom", or any request to launch a product, run the swarm, inject a budget, check what needs the owner, evolve or debug the system. Subcommands - attach, launch, auto, auto-all, free-hustle, funnel, inject-budget, nyk, decisions, evolve, know, mega, debug, status, sync, flow, launch-campaign, retro, heal, crm, sequences, inbox, score, ab, attribution, ai-visibility, watch, voice, chat, integrations, creators.
---

# Whalyom

Whalyom is this project. Its command reference is the `om` skill (`.claude/skills/om/SKILL.md`): read it, then map:

| `/whalyom …` | Does |
|---|---|
| `attach <domain> [--repo <path or git url>] [--satellite <url>]` | `node tools/attach.mjs …` (see `docs/ATTACH.md`): workspace + repo link + satellite installer; then `node tools/sync-sites.mjs`. Only for sites the owner names in this conversation |
| `launch <name> [domain]` | `om-mega`: create the workspace (domain optional), onboard, autopilot, sync |
| `auto <slug>` / `auto-all` | `om auto` / `om auto-all` (live mode by default) |
| `free-hustle <slug>` | set `budget.mode` to `free`, then `om flow om-free-growth <slug>`: the zero-budget lead engine (free channels planned in hours by `tools/free-engine.mjs`, leaks fixed first, every item a draft plus an approval with a tracked link), then `om auto` for the rest |
| `funnel <slug>` | `node tools/funnel.mjs <slug>`, then show `funnel/FUNNEL.md`: leads in, where each one is, stuck leads, channels from visit to sale, revenue verified; push `live/funnel` |
| `inject-budget <slug> <amount> <USD\|EUR\|GBP>` | set `budget.mode` `paid` (or `hybrid` if already organic), `monthly_cap`, `daily_cap` = amount/30 rounded to the nearest whole unit (at least 1, never above the amount; the same rule as `tools/new-product.mjs --budget`); then `node tools/budget.mjs <slug>` (≤100 → sniper mode on one channel) and `om plan`. Only the owner raises caps: do this only when the owner asked in this conversation |
| `add <domain> [--cpanel URL --cpanel-user U] [--ssh user@host --ssh-key PATH] [--approve-install]` | `node tools/add-product.mjs ...`: workspace, instant audit, read-only access check, WordPress plugin install over cPanel or SSH (one approval, or --approve-install), then the hub runs the AI onboarding on Claude Platform. Run it in a terminal, not in Claude Code, so no Claude Code capacity is used |
| `web [--port 8080]` | `node tools/cloud/web.mjs --port 8080`: the online app (landing page, sign in, customer and admin panels). Customers add their site and its cPanel or SSH access there; `node tools/cloud/accounts.mjs grant <email> <economy|balanced|aggressive> <sites> forever` gives a plan with no end date; prices in `config/pricing.json` |
| `mode [economy|balanced|aggressive]` | without an argument `node tools/ai-modes.mjs plan` and `status` (setup and monthly AI cost of each mode, spend this month); with one, `node tools/ai-modes.mjs set <mode>`. All AI work runs on Claude Platform (WHALYOM_ANTHROPIC_API_KEY in .env) |
| `nyk` | `node tools/needs-you-know.mjs`, then show the top items and push `live/nyk` |
| `decisions` | read the Command Center's `decisions` and `requests` collections with ArtifactData (url below), write them to `state/inbox-decisions.json` as `{decisions:[…], requests:[…]}`, run `node tools/apply-decisions.mjs`, then `node tools/execute.mjs <slug>` for each product that got an approval, and onboard new products |
| `evolve` | `om learn` for each active product (`node tools/learn.mjs <slug>`), then `om flow om-knowledge-refresh` and `om flow om-evolve`: new verified knowledge, benchmarked agent improvements shipped inside `config/evolution.json`, rollback with `node tools/evolve.mjs rollback <id> --build` |
| `know [topic]` | `node tools/knowledge.mjs check`, then show `knowledge/BRIEFING.md` (or `.claude/skills/om-knowledge-<topic>/SKILL.md`): what changed in digital marketing and what is due for re-check |
| `mega <slug>` | `om flow om-mega-sweep <slug>`: every department head reviews and runs its department |
| `debug` | `node tools/self-debug.mjs`; if it reports problems, dispatch `om-bug-hunter` with its `bug_hunter_brief`, then rerun until ok |
| `status` / `sync` | `om status` / `om sync`, plus the live snapshot push |
| `flow <workflow> <slug> [key=value …]` | `om flow`: runs a saved workflow (`om-launch`, `om-seo-sprint`, `om-aeo`, `om-content-engine`, `om-paid-sniper`, `om-paid-portfolio`, `om-lead-to-sale`, `om-free-growth`, `om-lifecycle`, `om-cro-loop`, `om-competitor-watch`, `om-landing`, `om-localize`, `om-weekly-retro`, `om-self-heal`, `om-knowledge-refresh`, `om-evolve`, `om-mega-sweep`, `om-product-evolution` (no slug)), then `sync`. Drafts and approvals only; see `docs/WORKFLOWS.md` |
| `launch-campaign <slug> [date]` | `om flow om-launch <slug> launchDate=<date>` |
| `retro <slug>` | `om flow om-weekly-retro <slug>` |
| `heal` | `om flow om-self-heal` (every product), the workflow form of `debug` |
| `crm <slug>` | `om crm`: contacts, deals and the pipeline view (`node tools/crm.mjs <slug> --propose`; `import` / `export` for HubSpot and Pipedrive CSV), then show `crm/CRM.md` |
| `sequences <slug>` | `om sequences`: due sequence steps become pending send approvals (`node tools/sequences.mjs <slug>`) |
| `inbox <slug>` | `om inbox`: classify replies, update the funnel and the suppression list (`node tools/inbox.mjs <slug>`), then show who needs an answer |
| `score <slug>` | `om score`: lead scores and hot-lead alerts (`node tools/lead-score.mjs <slug>`) |
| `ab <slug>` | `om ab`: bandit A/B tests (`node tools/bandit.mjs <slug>`); start and rollout only through approvals |
| `attribution <slug>` | `om attribution`: five-model touch credit and MMM-lite (`node tools/attribution.mjs <slug>`); budget shifts are pending approvals |
| `ai-visibility <slug>` | `om ai-visibility`: share of AI answers per engine (`node tools/ai-visibility.mjs <slug>`; `init` / `record`) |
| `watch <slug>` | `om watch`: polite competitor crawl and diff (`node tools/competitor-watch.mjs <slug>`), then `om flow om-competitor-watch <slug>` |
| `voice <slug>` | `om voice`: brand voice and claims guard on outbox drafts (`node tools/voice-guard.mjs <slug> --review`), then `node tools/apply-results.mjs <slug>` |
| `chat <slug> "<question>"` | `om chat`: on-site assistant answer from verified knowledge, or a hand-off (`node tools/chat-agent.mjs ask …`); `report` proposes reply drafts |
| `integrations` | `om integrations`: what is connected and which key names are missing (`node tools/integrations.mjs --missing`) |
| `creators <slug>` | `om creators`: creator roster, gated pipeline, outreach and payout approvals (`node tools/creators.mjs <slug>`) |
| `reallocate <slug>` | `om reallocate`: budget moves between live campaigns by results, inside the caps, as `budget_update` approvals (`node tools/reallocate.mjs <slug>`) |
| `social <slug>` | `om social`: Instagram and Facebook comments and DMs sorted, reply drafts as approvals, buyers into the funnel (`node tools/social-inbox.mjs <slug>`) |
| `realtime` | `om realtime`: the live documents the edge streams and a scrubbed view of one (`node tools/cloud/realtime.mjs docs`) |
| `agency <tenant-id>` | `om agency`: an agency's clients and branding, and the export of client decisions (`node tools/cloud/agency.mjs`) |
| `creative <slug> <brief>` | `om creative`: AI image or video from an approved brief with provenance and the creative cap (`node tools/creative-gen.mjs <slug> --check <brief>` first) |
| `call <slug> <lead>` | `om call`: why a voice call would be allowed or blocked (`node tools/connectors/voice.mjs check …`); calls only through approved `call` items |
| `retail` | `om retail`: Amazon Ads and Walmart Connect key status and metrics (`node tools/connectors/amazon-ads.mjs status`) |
| `new-agent <form.json>` | `om new-agent`: build a new agent as an evolve proposal (`node tools/agent-builder.mjs propose <form.json>`), shipped after the red team or the owner |
| `autonomy <slug>` | `om autonomy`: what runs on its own per type and channel and how close the rest is (`node tools/autonomy-report.mjs <slug>`) |
| `routing [family]` | `om routing`: agents ranked by results per work family (`node tools/routing.mjs`), advisory |

Command Center (3D, live): <your dashboard artifact link> — documents in collection `live` (`state`, `agents`, `events`, `roster`, `nyk`, `graph`, `transitions`, `products`, `sites`, `funnel`); owner writes in `decisions` and `requests`.
Brand: `docs/BRAND_IDENTITY.md`. Architecture and status: `docs/ARCHITECTURE_STATE.md`.
