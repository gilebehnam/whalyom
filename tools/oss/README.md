<p align="center"><img src="assets/brand/hero.svg" alt="Whalyom: your entire marketing department inside Claude Code" width="100%"></p>

<p align="center">{{badges}}</p>

<p align="center"><b>English</b> · <a href="README.fa.md">فارسی</a> · <a href="STORY.md">The story</a> · <a href="docs/COMMANDS.md">Commands</a> · <a href="rules/README.md">Rules</a></p>

# Whalyom

**Your entire marketing department, inside Claude Code. Free.**

You built something good. Then you found out that building it was the easy part.
Whalyom gives Claude Code a marketing department: {{agents_fmt}} AI agents in {{departments}} departments, each with a head, a job and a skill pack.
They find the people who need you, write what to say to them, follow every lead to the sale and learn from what worked.
Nothing leaves without your yes.

```text
find -> plan -> make -> review -> you approve -> send -> measure -> learn
```

## The numbers

| | |
|---|---:|
| AI agents ({{mega_agents}} department heads, {{micro_agents}} micro agents for single fast jobs) | **{{agents_fmt}}** |
| Departments, in {{layers}} layers from command to self-improvement | **{{departments}}** |
| Skills, from SEO audits to discovery calls | **{{skills_fmt}}** |
| Ready-made slash commands | **{{commands}}** |
| Rules, each enforced in code | **{{rules}}** |
| Saved multi-agent workflows | **{{workflows}}** |
| Verified knowledge notes, from {{knowledge_sources}} official and research sources in {{knowledge_topics}} topics | **{{knowledge_notes_fmt}}** |
| Engine scripts (Node, two npm dependencies) | **{{engine_tools}}** |

Every number above is counted from the files by `npm run stats`.

## Install in one minute

**As a Claude Code plugin:**

```bash
claude plugin marketplace add {{repo}}
claude plugin install whalyom@whalyom
```

**As a workspace (the full engine, the local Command Center and the daemon):**

```bash
git clone https://github.com/{{repo}}.git whalyom
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

All {{commands}} commands: [docs/COMMANDS.md](docs/COMMANDS.md).

{{commands_table}}

## The departments

{{departments_table}}

Each department has a mega agent at its head, a knowledge brief that is rebuilt from the verified knowledge base, and a skill pack every agent in it masters.

## The rules

Marketing agents that can send email and spend money need rules a model cannot talk itself out of.
Whalyom has {{rules}} of them, and each one names the code that enforces it.

{{rules_list}}

Read them all in [rules/](rules/README.md).

## The knowledge base

Platforms change their rules every week.
Whalyom reads {{knowledge_sources}} official and research sources, extracts dated facts, and a fact-verifier agent tries to reject each one before it is kept.
Today it holds {{knowledge_notes_fmt}} verified notes in {{knowledge_topics}} topics, from search and AI answers to privacy law and retail media.
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
