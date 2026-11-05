# Third-party notices

Skills in `.claude/skills/` and agents in `.claude/agents/` (other than `om-*`, `om`, `om-mega`) were copied from these open-source projects. Each keeps its original license.

| Prefix / files | Source | License |
|---|---|---|
| `kj-*` | https://github.com/kostja94/marketing-skills | MIT |
| `oc-*` | https://github.com/OpenClaudia/openclaudia-skills | MIT |
| `ph-*` | https://github.com/yoanbernabeu/producthunt-skills | MIT |
| `market`, `market-*`, agents `market-*` | https://github.com/zubair-trabzada/ai-marketing-claude | MIT |
| `geo`, `geo-*`, agents `geo-*` | https://github.com/zubair-trabzada/geo-seo-claude | MIT |

## External skills and agents (`ext-*`), installed 2026-11-03

Markdown only. Each `ext-*` skill keeps its upstream frontmatter (with `name` changed to the `ext-` name), has a "Whalyom note" added at the top, and has the upstream "Install" section (git clone / npx commands) removed. A copy of the upstream LICENSE is kept as `LICENSE.txt` inside each skill folder where the source repository ships one. Catalog and agent mapping: `docs/SKILLS_CATALOG.md`.

| Prefix / files | Source | License | Copyright |
|---|---|---|---|
| `.claude/skills/ext-rae-*` (13 skills: account-structure-review, brand-dna, competitor-ads-analyst, copywriting-frameworks, cro-auditor, cross-platform-audit, facebook-ads, google-ads, google-tag-manager, microsoft-ads, utm-attribution-strategy, wasted-spend-finder, research-digest) | https://github.com/thatrebeccarae/claude-marketing | MIT | (c) 2026 Rebecca Rae Barton |
| `.claude/skills/ext-bw-*` (13 skills: ai-discoverability-audit, case-study-builder, cold-outreach-sequence, content-idea-generator, homepage-audit, linkedin-authority-builder, linkedin-profile-optimizer, marketing-principles, newsletter-creation-curation, positioning-basics, testimonial-collector, tweet-draft-reviewer, voice-extractor) | https://github.com/BrianRWagner/ai-marketing-claude-code-skills | MIT (declared in README; the repo ships no LICENSE file) | Brian R. Wagner |
| `.claude/skills/ext-wsh-*` (7 skills: avoid-ai-writing, data-storytelling, kpi-dashboard-design, competitive-landscape, market-sizing-analysis, startup-metrics-framework, social-evidence-research) and `.claude/agents/ext-wsh-seo-*.md` (10 agents: seo-content-auditor, seo-content-planner, seo-content-writer, seo-keyword-strategist, seo-meta-optimizer, seo-snippet-hunter, seo-structure-architect, seo-authority-builder, seo-cannibalization-detector, seo-content-refresher) | https://github.com/wshobson/agents | MIT | (c) 2024 Seth Hobson; `avoid-ai-writing` plugin by Conor Bronsdon (MIT) |
| `.claude/skills/ext-wd-*` (22 skills: blue-ocean-strategy, cold-start-problem, contagious, cro-methodology, conversion-optimization, crossing-the-chasm, hooked-ux, hundred-million-offers, influence-psychology, lean-analytics, made-to-stick, mom-test, monetizing-innovation, obviously-awesome, one-page-marketing, predictable-revenue, scorecard-marketing, storybrand-messaging, negotiation, improve-retention, grow-business, grow-website) | https://github.com/wondelai/skills | MIT | (c) 2025 Wondel.ai sp. z o.o. |
| `.claude/skills/ext-emb-email-marketing-bible` (SKILL.md + 14 reference files) | https://github.com/CosmoBlk/email-marketing-bible | MIT | (c) 2026 George Hartley |

Changes made on install: frontmatter `name` renamed; Whalyom note inserted; "Install" sections removed; backticked references to sibling skills renamed to their `ext-` names; rae paths `skills/shared/...` and `skills/<platform>/CHECKS.md` repointed to `.claude/skills/ext-rae-.../`; wondelai `npx skills add` fallbacks and Amazon affiliate tags (`?tag=wondelai00-20`) removed; the three wondelai journey skills (grow-business, grow-website, conversion-optimization) told to write to `products/<slug>/research/journeys/` instead of `docs/`; agents got an explicit `tools:` list (no Bash) and "Use PROACTIVELY" removed from their descriptions so they do not compete with `om-*` agents for automatic dispatch.

Files dropped (not installed): rae `facebook-ads`, `google-ads`, `microsoft-ads`: `.env.example`, `requirements.txt`; all bw skills: `SKILL-OC.md` (OpenClaw variant), bw newsletter `README.md` and `.clawdhub/origin.json`; email-marketing-bible: `README.md`, `CHANGELOG.md`, `RELEASING.md`, `.claude-plugin/`, `.github/workflow`, `assets/`, duplicate `skills/` copy. No scripts, binaries, hooks or MCP servers were installed.

Plugins referenced in `.claude/settings.json` (installed from their own marketplaces, not copied): AgriciDaniel/claude-seo, AgriciDaniel/claude-blog, coreyhaines31/marketingskills, czlonkowski/n8n-skills, gingiris-1031/gingiris-skills.

The MIT License requires the copyright notice and permission notice to be included with copies; see each source repository's LICENSE file.
