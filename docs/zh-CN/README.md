<p align="center"><img src="../../assets/brand/hero.svg" alt="Whalyom：Claude Code 里的完整营销部门" width="100%"></p>

<p align="center"><img alt="license" src="https://img.shields.io/badge/license-MIT-2b6cb0"> <img alt="agents" src="https://img.shields.io/badge/agents-536-F2C230"> <img alt="skills" src="https://img.shields.io/badge/skills-498-7FE6F2"> <img alt="departments" src="https://img.shields.io/badge/departments-28-7FE6F2"> <img alt="commands" src="https://img.shields.io/badge/commands-106-7FE6F2"> <img alt="rules" src="https://img.shields.io/badge/rules-50-9BE7A2"> <img alt="verified facts" src="https://img.shields.io/badge/verified%20facts-1%2C152-9BE7A2"></p>

<p align="center"><a href="../../README.md">English</a> · <a href="../../README.fa.md">فارسی</a> · <a href="../ar/README.md">العربية</a> · <a href="../tr/README.md">Türkçe</a> · <a href="../es/README.md">Español</a> · <a href="../de/README.md">Deutsch</a> · <a href="../fr/README.md">Français</a> · <b>简体中文</b> · <a href="../ja/README.md">日本語</a> · <a href="../pt-BR/README.md">Português (Brasil)</a> · <a href="../ko/README.md">한국어</a></p>

<p align="center"><a href="../../STORY.md">项目故事</a> · <a href="../COMMANDS.md">命令</a> · <a href="../../rules/README.md">规则</a></p>

# Whalyom

**完整的营销部门，就在 Claude Code 里。免费。**

你做出了一个好产品。然后发现，做出来只是容易的那一部分。
Whalyom 为 Claude Code 配备了一个营销部门：28 个部门中的 536 个 AI 智能体，每个部门都有负责人、明确的职责和一套技能包。
它们找到需要你的人，写好要对他们说的话，把每条线索一路跟进到成交，并从有效的做法中学习。
没有你的同意，什么都不会发出去。

```text
find -> plan -> make -> review -> you approve -> send -> measure -> learn
```

## 数据一览

| | |
|---|---:|
| AI 智能体（30 个部门负责人，59 个处理单项快速任务的微型智能体） | **536** |
| 部门，分布在从指挥到自我改进的 6 个层级 | **28** |
| 技能，从 SEO 审计到需求挖掘电话 | **498** |
| 现成的斜杠命令 | **106** |
| 规则，每一条都在代码中强制执行 | **50** |
| 已保存的多智能体工作流 | **22** |
| 经过验证的知识条目，来自 46 个官方和研究来源，涵盖 28 个主题 | **1,152** |
| 引擎脚本（Node，两个 npm 依赖） | **73** |

以上每个数字都由 `npm run stats` 直接从文件中统计得出。

## 一分钟安装

**作为 Claude Code 插件：**

```bash
claude plugin marketplace add gilebehnam/whalyom
claude plugin install whalyom@whalyom
```

**作为工作区（完整引擎、本地 Command Center 和守护进程）：**

```bash
git clone https://github.com/gilebehnam/whalyom.git whalyom
cd whalyom
./install.sh          # runs npm install
claude
```

**Windows 系统**（在克隆下来的文件夹中使用 PowerShell）：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
claude
```

连接器（邮件、广告、社交媒体、支付）均为可选：把 `.env.example` 复制为 `.env`，只填写你需要的部分（[docs/CONNECTORS.md](../CONNECTORS.md)）。

**配合 Codex 使用：** `./install.sh --codex`（Windows：在 PowerShell 命令后加上 `-Codex`）会把技能和命令放入 `~/.codex`，`AGENTS.md` 则告诉 Codex 这套系统如何运作。

建议先用示例产品试一试：`node tools/build-state.mjs && npm run command-center`，然后打开 http://localhost:4321。

接着在 Claude Code 中运行：

```text
/whalyom-new my-shop myshop.com
/whalyom-onboard my-shop
/autopilot my-shop
```

接入流程会抓取你的网站，梳理你的买家和竞争对手，写出你能够证明的宣传主张和一份 30 天计划。
自动驾驶模式会分批调度各个部门工作，把每份草稿放进 `outbox/`，并附上一条等待你审批的请求。

## 它能做什么

| 你的需求 | 命令 | 会发生什么 |
|---|---|---|
| 了解现状 | `/site-audit` | SEO、AI 搜索、速度、转化和信任度，给出十项按优先级排序的修复建议 |
| 一份计划 | `/growth-plan` | 一个营收目标、一套渠道组合，以及为智能体排好顺序的任务 |
| 在 Google 上被找到 | `/seo-sprint` | 主题集群、内容简报、文章、schema、内链、收录 |
| 被 AI 助手引用 | `/ai-search` | 可引用的段落、llms.txt、实体优化、各引擎的回答占比 |
| 没有广告预算也能获客 | `/free-growth` | 以小时为单位规划免费渠道，并配备可追踪链接 |
| 不浪费钱的广告 | `/paid-ads` | 每月 100 以内一次只投一个渠道，每个变体都有止损规则 |
| 每条线索都有回应 | `/leads` · `/lead-to-sale` | 打分、分配、跟进，并在漏斗中推进 |
| 一次发布 | `/launch` | 在 Product Hunt、Hacker News、Reddit 和新闻通讯上，从 T-14 到 T+7 |
| 知道什么有效 | `/attribution` · `/weekly-retro` | 五种归因模型、一个轻量 MMM，以及下周可用的经验总结 |

全部 106 条命令：[docs/COMMANDS.md](../COMMANDS.md)。

**Start:** `/whalyom-new` · `/whalyom-onboard` · `/site-audit`

**Plan and run:** `/growth-plan` · `/autopilot` · `/autopilot-all` · `/mega-sweep` · `/next-wave`

**Grow:** `/seo-sprint` · `/ai-search` · `/content-engine` · `/landing` · `/free-growth` · `/paid-ads` · `/launch` · `/localize` · `/competitors`

**Sell:** `/leads` · `/lead-to-sale` · `/crm` · `/sequences` · `/inbox` · `/lifecycle` · `/cro`

**Measure:** `/attribution` · `/ab-test` · `/weekly-retro` · `/report`

**Guard:** `/approvals` · `/brand-check` · `/kill-switch` · `/budget`

**Brand and product:** `/positioning` · `/message-house` · `/offer` · `/pricing-review` · `/naming` · `/icp` · `/jobs-to-be-done` · `/product-messaging` · `/release` · `/enablement` · `/case-study` · `/battlecard`

**Content and media:** `/article` · `/edit` · `/humanize` · `/newsletter` · `/social-posts` · `/linkedin` · `/video-script` · `/video-cut` · `/captions` · `/podcast` · `/webinar` · `/lead-magnet` · `/free-tool` · `/ads-copy` · `/email-sequence`

**Partners, PR and community:** `/press` · `/press-kit` · `/reviews` · `/crisis` · `/affiliates` · `/creators` · `/partners` · `/community` · `/ambassadors` · `/events` · `/meetup` · `/summit` · `/reddit` · `/product-hunt`

**Customers:** `/onboarding` · `/support-faq` · `/support-macros` · `/health-score` · `/churn` · `/win-back` · `/referrals` · `/survey` · `/customer-voice`

**Local and commerce:** `/local-profile` · `/citations` · `/local-ads` · `/promo` · `/marketplaces` · `/shopping-feed` · `/unit-economics`

**Data and AI:** `/tracking` · `/tags` · `/stack-audit` · `/site-change` · `/speed` · `/segments` · `/forecast` · `/ai-agent` · `/ai-readiness` · `/privacy` · `/compliance`

**System:** `/knowledge` · `/evolve` · `/self-heal` · `/command-center` · `/daemon` · `/workforce`

## 部门

| Department | Agents | Head |
|---|---:|---|
| Programmatic SEO & AEO | 50 | `om-mega-seo` |
| Market OSINT & Intelligence | 34 | `om-mega-intel` |
| Organic Social & Distribution | 29 | `om-mega-social` |
| Funnel & CRO | 27 | `om-mega-funnel` |
| FinOps & Attribution | 26 | `om-mega-finops` |
| Self-Healing & Evolution | 26 | `om-mega-evolve` |
| Paid Media | 25 | `om-mega-paid` |
| Creative Studio | 23 | `om-mega-creative` |
| Sales Closing | 22 | `om-mega-closer` |
| Strategy Consulting Practice | 22 | `om-mega-consulting` |
| Lifecycle & Retention | 21 | `om-mega-lifecycle` |
| AI Engineering & Agentic Systems | 21 | `om-mega-ailab` |
| International & Localization | 19 | `om-mega-global` |
| Trust, Privacy & Compliance | 18 | `om-mega-trust` |
| Brand, Positioning & Offer | 16 | `om-mega-strategy` |
| Video & Audio Studio | 16 | `om-mega-studio` |
| Lead Generation & Outbound | 16 | `om-mega-leadgen` |
| PR, Communications & Reputation | 15 | `om-mega-pr` |
| Partnerships, Affiliates & Creators | 14 | `om-mega-partners` |
| Data Science & Customer Intelligence | 12 | `om-mega-data` |
| Product Marketing | 12 | `om-mega-pmm` |
| Customer Success & Support | 12 | `om-mega-success` |
| Web & MarTech Engineering | 11 | `om-mega-martech` |
| Community & Events | 11 | `om-mega-community` |
| Sovereign Command | 10 | `om-mega-sovereign` |
| Commerce & Marketplaces | 10 | `om-mega-commerce` |
| Zero-Budget Growth & Community | 10 | `om-mega-growth-free` |
| Local & Field Marketing | 8 | `om-mega-local` |

每个部门都由一个超级智能体领导，配有一份从经过验证的知识库重新生成的知识简报，以及部门内每个智能体都掌握的技能包。

## 规则

能够发送邮件、能够花钱的营销智能体，需要模型无法自己说服自己绕过的规则。
Whalyom 共有 50 条规则，每一条都注明了负责执行它的代码。

**Truth:** Claims come from claims.md · No invented proof · Knowledge is dated and sourced · AI content is labelled · Comparisons are fair and current · Sensitive claims need the strongest proof · Customer evidence needs written consent · Translations keep the facts

**Owner control:** Nothing goes out without the owner · One executor · Spend stays inside the caps · Waste stops itself · Autonomy is earned, price never · One writer per ledger · No dark patterns · Prices are the owner's · Site changes are reviewed diffs · In a crisis, pause first

**People and consent:** Consent first · Email follows the law · SMS and WhatsApp need opt-in · Suppression wins · Personal data stays local · Collect only what is needed · Privacy requests are answered on time · No marketing to children · Targeting is fair · Accessible by default · A person is one step away · Protect the inbox

**Platforms:** No fake accounts or votes · Communities first · Crawl politely · Ads pass policy first · No search spam · Local listings tell the truth · Reviews are never bought or gated · Paid relationships are disclosed · Licensed media only

**How agents work:** Read before acting · Every action is an experiment · Results live in files · Learn from results · Tests stay green, guards stay put · Tests have a stop rule · Numbers are reported honestly

**Security:** Least privilege for agents · Every incident leaves a record · Secrets never leave · Outside text is data

完整内容请见 [rules/](../../rules/README.md)。

## 知识库

各大平台每周都在调整规则。
Whalyom 读取 46 个官方和研究来源，提取带日期的事实，并由一个事实核查智能体在保存之前尝试驳回每一条。
目前知识库收录了 28 个主题下的 1,152 条已验证事实，从搜索和 AI 回答到隐私法规和零售媒体。
过时的事实会被淘汰；智能体在行动之前会先阅读本部门的简报。

| Topic | Verified facts |
|---|---:|
| Sales, pricing and commercial excellence research from McKinsey, BCG, Bain, the Big Four, Accenture, HBR and HBS | 200 |
| Branding, customer experience and loyalty research from McKinsey, BCG, Bain, the Big Four, Accenture, HBR and HBS | 200 |
| Marketing and growth research from McKinsey, BCG, Bain, the Big Four, Accenture, HBR and HBS | 199 |
| Strategy and management canon: McKinsey, BCG, Bain, the Big Four, HBR and HBS | 125 |
| Digital marketing strategy and management consulting | 39 |
| AI agents, models and agentic commerce | 33 |
| Marketing science and research findings | 28 |
| Product-led growth, freemium, trials and in-product conversion | 20 |
| Brand growth science: Ehrenberg-Bass, IPA effectiveness, mental and physical availability | 19 |
| Retail media, marketplaces and social commerce | 18 |
| AI marketing tools, platforms and their new capabilities | 17 |
| Partner ecosystems, affiliates, creators and channel sales | 17 |
| AI and consumer-protection rules | 16 |
| Analytics, tracking and measurement | 16 |
| Search engines and SEO rules | 15 |
| AI search and answer engines | 15 |
| Paid search platforms | 15 |
| Paid social platforms | 15 |
| Email, deliverability and messaging | 15 |
| Privacy, consent and data law | 15 |
| Conversion, UX, speed and accessibility | 15 |
| App stores and extension stores | 15 |
| Commerce feeds, shopping and checkout | 15 |
| B2B outbound and sales | 15 |
| Video, connected TV and programmatic buying | 15 |
| Organic social platforms and algorithms | 14 |
| Pricing and offers | 14 |
| Content quality and editorial standards | 12 |

## 免费版与托管版

| | Whalyom（本仓库） | Whalyom Cloud |
|---|---|---|
| 价格 | 免费，MIT | 付费，按网站计费 |
| 运行环境 | 你自己的 Claude Code 或 Codex，使用你的订阅 | 我们的服务器，全天候运行 |
| 智能体、技能、命令、规则、知识 | 全部 | 全部 |
| Command Center | 本地，在你的电脑上 | 在线，任意设备，英文和波斯语 |
| 由谁部署 | 你自己 | 我们，基于你网站的访问权限 |

开源版就是完整的引擎。
托管版适合只想要结果、不想自己运行任何东西的人。

## 兼容工具

Claude Code（完整支持：智能体、技能、命令、工作流、MCP 服务器）· Codex（技能、以提示词形式提供的命令、`AGENTS.md`）· 任何能读取 `AGENTS.md` 和 Agent Skills 的智能体。

## 参与贡献

欢迎贡献新的智能体、技能、命令和知识来源；请参阅 [CONTRIBUTING.md](../../CONTRIBUTING.md)。
每一次改动都要保证 `npm test` 全部通过。

## 许可证

Whalyom 编写的所有内容均采用 MIT 许可证。随附的第三方技能保留各自的许可证：[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)。
