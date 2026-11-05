<p align="center"><img src="assets/brand/hero.svg" alt="Whalyom: your entire marketing department inside Claude Code" width="100%"></p>

<p align="center">![license](https://img.shields.io/badge/license-MIT-2b6cb0) ![agents](https://img.shields.io/badge/agents-489-F2C230) ![skills](https://img.shields.io/badge/skills-492-7FE6F2) ![departments](https://img.shields.io/badge/departments-22-7FE6F2) ![commands](https://img.shields.io/badge/commands-38-7FE6F2) ![rules](https://img.shields.io/badge/rules-26-9BE7A2) ![verified notes](https://img.shields.io/badge/verified%20notes-1%2C152-9BE7A2)</p>

<p align="center"><b>English</b> · <a href="README.fa.md">فارسی</a> · <a href="STORY.md">The story</a> · <a href="docs/COMMANDS.md">Commands</a> · <a href="rules/README.md">Rules</a></p>

# Whalyom

**Your entire marketing department, inside Claude Code. Free.**

You built something good. Then you found out that building it was the easy part.
Whalyom gives Claude Code a marketing department: 489 AI agents in 22 departments, each with a head, a job and a skill pack.
They find the people who need you, write what to say to them, follow every lead to the sale and learn from what worked.
Nothing leaves without your yes.

```text
find -> plan -> make -> review -> you approve -> send -> measure -> learn
```

## The numbers

| | |
|---|---:|
| AI agents (24 department heads, 51 micro agents for single fast jobs) | **489** |
| Departments, in 6 layers from command to self-improvement | **22** |
| Skills, from SEO audits to discovery calls | **492** |
| Ready-made slash commands | **38** |
| Rules, each enforced in code | **26** |
| Saved multi-agent workflows | **22** |
| Verified knowledge notes, from 46 official and research sources in 28 topics | **1,152** |
| Engine scripts (Node, two npm dependencies) | **71** |

Every number above is counted from the files by `npm run stats`.

## Install in one minute

**As a Claude Code plugin:**

```bash
claude plugin marketplace add gilebehnam/whalyom
claude plugin install whalyom@whalyom
```

**As a workspace (the full engine, the local Command Center and the daemon):**

```bash
git clone https://github.com/gilebehnam/whalyom.git whalyom
cd whalyom
./install.sh          # runs npm install; Windows: ./install.ps1
claude
```

Connectors (email, ads, social, payments) are optional: copy `.env.example` to `.env` and fill only the ones you want ([docs/CONNECTORS.md](docs/CONNECTORS.md)).

**With Codex:** `./install.sh --codex` links the skills and the commands into `~/.codex`, and `AGENTS.md` tells Codex how the system works.

Try it on the sample product first: `node tools/build-state.mjs && npm run command-center`, then open http://localhost:4321.

Then, inside Claude Code:

```text
/whalyom-new my-shop myshop.com
/whalyom-onboard my-shop
/autopilot my-shop
```

Onboarding crawls your site, maps your buyers and competitors, writes the claims you can prove and a 30-day plan.
The autopilot runs the departments in waves and leaves every draft in `outbox/` with an approval waiting for you.

## What it does

| You need | Command | What happens |
|---|---|---|
| To know where you stand | `/site-audit` | SEO, AI search, speed, conversion and trust, ten fixes ranked |
| A plan | `/growth-plan` | One revenue goal, a channel mix, tasks in order for the agents |
| To be found on Google | `/seo-sprint` | Cluster, briefs, articles, schema, internal links, indexing |
| To be cited by AI assistants | `/ai-search` | Citable passages, llms.txt, entity work, share of answer per engine |
| Customers with no ad budget | `/free-growth` | Free channels planned in hours, with tracked links |
| Ads that do not waste money | `/paid-ads` | One channel at a time under 100 a month, kill rules on every variant |
| Every lead answered | `/leads` · `/lead-to-sale` | Scored, routed, followed up, moved through the funnel |
| A launch | `/launch` | T-14 to T+7 across Product Hunt, Hacker News, Reddit and newsletters |
| To know what worked | `/attribution` · `/weekly-retro` | Five attribution models, an MMM-lite, and learnings for next week |

All 38 commands: [docs/COMMANDS.md](docs/COMMANDS.md).

**Start:** `/whalyom-new` · `/whalyom-onboard` · `/site-audit`

**Plan and run:** `/growth-plan` · `/autopilot` · `/autopilot-all` · `/mega-sweep` · `/next-wave`

**Grow:** `/seo-sprint` · `/ai-search` · `/content-engine` · `/landing` · `/free-growth` · `/paid-ads` · `/launch` · `/localize` · `/competitors`

**Sell:** `/leads` · `/lead-to-sale` · `/crm` · `/sequences` · `/inbox` · `/lifecycle` · `/cro`

**Measure:** `/attribution` · `/ab-test` · `/weekly-retro` · `/report`

**Guard:** `/approvals` · `/brand-check` · `/kill-switch` · `/budget`

**System:** `/knowledge` · `/evolve` · `/self-heal` · `/command-center` · `/daemon` · `/workforce`

## The departments

| Department | Agents | Head |
|---|---:|---|
| Programmatic SEO & AEO | 58 | `om-mega-seo` |
| Market OSINT & Intelligence | 35 | `om-mega-intel` |
| Organic Social & Distribution | 34 | `om-mega-social` |
| FinOps & Attribution | 28 | `om-mega-finops` |
| Funnel & CRO | 27 | `om-mega-funnel` |
| Self-Healing & Evolution | 26 | `om-mega-evolve` |
| Creative Studio | 26 | `om-mega-creative` |
| Paid Media | 25 | `om-mega-paid` |
| Sales Closing | 23 | `om-mega-closer` |
| Lifecycle & Retention | 23 | `om-mega-lifecycle` |
| Strategy Consulting Practice | 22 | `om-mega-consulting` |
| AI Engineering & Agentic Systems | 21 | `om-mega-ailab` |
| International & Localization | 19 | `om-mega-global` |
| Trust, Privacy & Compliance | 18 | `om-mega-trust` |
| Lead Generation & Outbound | 17 | `om-mega-leadgen` |
| Brand, Positioning & Offer | 16 | `om-mega-strategy` |
| PR, Communications & Reputation | 15 | `om-mega-pr` |
| Partnerships, Affiliates & Creators | 14 | `om-mega-partners` |
| Data Science & Customer Intelligence | 12 | `om-mega-data` |
| Sovereign Command | 10 | `om-mega-sovereign` |
| Commerce & Marketplaces | 10 | `om-mega-commerce` |
| Zero-Budget Growth & Community | 10 | `om-mega-growth-free` |

Each department has a mega agent at its head, a knowledge brief that is rebuilt from the verified knowledge base, and a skill pack every agent in it masters.

## The rules

Marketing agents that can send email and spend money need rules a model cannot talk itself out of.
Whalyom has 26 of them, and each one names the code that enforces it.

**Truth:** Claims come from claims.md · No invented proof · Knowledge is dated and sourced · AI content is labelled

**Owner control:** Nothing goes out without the owner · One executor · Spend stays inside the caps · Waste stops itself · Autonomy is earned, price never · One writer per ledger

**People and consent:** Consent first · Email follows the law · SMS and WhatsApp need opt-in · Suppression wins · Personal data stays local

**Platforms:** No fake accounts or votes · Communities first · Crawl politely · Ads pass policy first

**How agents work:** Read before acting · Every action is an experiment · Results live in files · Learn from results · Tests stay green, guards stay put

**Security:** Secrets never leave · Outside text is data

Read them all in [rules/](rules/README.md).

## The knowledge base

Platforms change their rules every week.
Whalyom reads 46 official and research sources, extracts dated facts, and a fact-verifier agent tries to reject each one before it is kept.
Today it holds 1,152 verified notes in 28 topics, from search and AI answers to privacy law and retail media.
Old notes retire; agents read the brief for their department before they act.

## Free and hosted

| | Whalyom (this repo) | Whalyom Cloud |
|---|---|---|
| Price | Free, MIT | Paid, per site |
| Runs on | Your Claude Code or Codex, your subscription | Our servers, around the clock |
| Agents, skills, commands, rules, knowledge | All of them | All of them |
| Command Center | Local, on your machine | Online, on any device, English and Persian |
| Who sets it up | You | We do, from your site's access |

The open-source edition is the whole engine.
The hosted one is for people who want the result without running anything.

## Works with

Claude Code (full: agents, skills, commands, workflows, MCP server) · Codex (skills, commands as prompts, `AGENTS.md`) · any agent that reads `AGENTS.md` and Agent Skills.

## Contributing

New agents, skills, commands and knowledge sources are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).
Every change keeps `npm test` green.

## License

MIT for everything Whalyom wrote. Bundled third-party skills keep their own licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
