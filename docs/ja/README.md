<p align="center"><img src="../../assets/brand/hero.svg" alt="Whalyom：Claude Code の中に、マーケティング部門をまるごと" width="100%"></p>

<p align="center"><img alt="license" src="https://img.shields.io/badge/license-MIT-2b6cb0"> <img alt="agents" src="https://img.shields.io/badge/agents-536-F2C230"> <img alt="skills" src="https://img.shields.io/badge/skills-498-7FE6F2"> <img alt="departments" src="https://img.shields.io/badge/departments-28-7FE6F2"> <img alt="commands" src="https://img.shields.io/badge/commands-106-7FE6F2"> <img alt="rules" src="https://img.shields.io/badge/rules-50-9BE7A2"> <img alt="verified facts" src="https://img.shields.io/badge/verified%20facts-1%2C152-9BE7A2"></p>

<p align="center"><a href="../../README.md">English</a> · <a href="../../README.fa.md">فارسی</a> · <a href="../ar/README.md">العربية</a> · <a href="../tr/README.md">Türkçe</a> · <a href="../es/README.md">Español</a> · <a href="../de/README.md">Deutsch</a> · <a href="../fr/README.md">Français</a> · <a href="../zh-CN/README.md">简体中文</a> · <b>日本語</b> · <a href="../pt-BR/README.md">Português (Brasil)</a></p>

<p align="center"><a href="../../STORY.md">ストーリー</a> · <a href="../COMMANDS.md">コマンド</a> · <a href="../../rules/README.md">ルール</a></p>

# Whalyom

**マーケティング部門をまるごと、Claude Code の中に。無料で。**

良いものをつくった。そして、つくることは簡単な部分だったと気づいた。
Whalyom は Claude Code にマーケティング部門を与えます。28 の部門に 536 の AI エージェントが所属し、各部門には責任者、担当業務、スキルパックがあります。
あなたを必要としている人を見つけ、何を伝えるべきかを書き、すべてのリードを成約まで追いかけ、うまくいったことから学びます。
あなたの承認なしには、何も外に出ません。

```text
find -> plan -> make -> review -> you approve -> send -> measure -> learn
```

## 数字で見る Whalyom

| | |
|---|---:|
| AI エージェント（部門責任者 30、単発の素早い作業を担うマイクロエージェント 59） | **536** |
| 部門（指揮から自己改善までの 6 レイヤー） | **28** |
| スキル（SEO 監査からディスカバリーコールまで） | **498** |
| すぐに使えるスラッシュコマンド | **106** |
| ルール（すべてコードで強制） | **50** |
| 保存済みのマルチエージェントワークフロー | **22** |
| 検証済みのナレッジ（46 の公式・研究ソースから、28 のトピック） | **1,152** |
| エンジンスクリプト（Node、npm 依存関係は 2 つ） | **73** |

上記の数字はすべて、`npm run stats` がファイルから直接数えたものです。

## 1 分でインストール

**Claude Code プラグインとして:**

```bash
claude plugin marketplace add gilebehnam/whalyom
claude plugin install whalyom@whalyom
```

**ワークスペースとして（エンジン一式、ローカルの Command Center、デーモン）:**

```bash
git clone https://github.com/gilebehnam/whalyom.git whalyom
cd whalyom
./install.sh          # runs npm install
claude
```

**Windows の場合**（クローンしたフォルダで PowerShell を使用）:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
claude
```

コネクタ（メール、広告、ソーシャル、決済）は任意です。`.env.example` を `.env` にコピーし、使いたいものだけを入力してください（[docs/CONNECTORS.md](../CONNECTORS.md)）。

**Codex で使う場合:** `./install.sh --codex`（Windows では PowerShell の行に `-Codex` を追加）でスキルとコマンドが `~/.codex` に配置され、`AGENTS.md` がシステムの仕組みを Codex に伝えます。

まずはサンプル製品で試してください: `node tools/build-state.mjs && npm run command-center` を実行し、http://localhost:4321 を開きます。

次に、Claude Code の中で:

```text
/whalyom-new my-shop myshop.com
/whalyom-onboard my-shop
/autopilot my-shop
```

オンボーディングはサイトをクロールし、購入者と競合を整理し、証明できる主張と 30 日間の計画を書き上げます。
オートパイロットは各部門を段階的に動かし、すべての下書きを承認待ちの状態で `outbox/` に置きます。

## できること

| 必要なこと | コマンド | 何が起きるか |
|---|---|---|
| 現状を知る | `/site-audit` | SEO、AI 検索、速度、コンバージョン、信頼性を診断し、優先順位付きの改善策を 10 件 |
| 計画を立てる | `/growth-plan` | 1 つの売上目標、チャネル構成、エージェント向けに順序立てたタスク |
| Google で見つけてもらう | `/seo-sprint` | クラスター、ブリーフ、記事、schema、内部リンク、インデックス登録 |
| AI アシスタントに引用される | `/ai-search` | 引用されやすい文章、llms.txt、エンティティ対策、エンジンごとの回答シェア |
| 広告費ゼロで顧客を得る | `/free-growth` | 無料チャネルを時間単位で計画し、トラッキングリンクを付与 |
| お金を無駄にしない広告 | `/paid-ads` | 月 100 未満なら 1 チャネルずつ、すべてのバリエーションに停止ルール |
| すべてのリードに対応する | `/leads` · `/lead-to-sale` | スコアリング、振り分け、フォローアップ、ファネルでの前進 |
| ローンチ | `/launch` | Product Hunt、Hacker News、Reddit、ニュースレターで T-14 から T+7 まで |
| 何が効いたかを知る | `/attribution` · `/weekly-retro` | 5 つのアトリビューションモデル、MMM-lite、翌週に活かす学び |

全 106 コマンド: [docs/COMMANDS.md](../COMMANDS.md)。

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

## 部門

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

各部門のトップにはメガエージェントがいて、検証済みナレッジベースから再構築されるナレッジブリーフと、部門内のすべてのエージェントが習得するスキルパックを持っています。

## ルール

メールを送り、お金を使えるマーケティングエージェントには、モデルが自分を説得して抜け出すことのできないルールが必要です。
Whalyom には 50 のルールがあり、それぞれが自らを強制するコードを明記しています。

**Truth:** Claims come from claims.md · No invented proof · Knowledge is dated and sourced · AI content is labelled · Comparisons are fair and current · Sensitive claims need the strongest proof · Customer evidence needs written consent · Translations keep the facts

**Owner control:** Nothing goes out without the owner · One executor · Spend stays inside the caps · Waste stops itself · Autonomy is earned, price never · One writer per ledger · No dark patterns · Prices are the owner's · Site changes are reviewed diffs · In a crisis, pause first

**People and consent:** Consent first · Email follows the law · SMS and WhatsApp need opt-in · Suppression wins · Personal data stays local · Collect only what is needed · Privacy requests are answered on time · No marketing to children · Targeting is fair · Accessible by default · A person is one step away · Protect the inbox

**Platforms:** No fake accounts or votes · Communities first · Crawl politely · Ads pass policy first · No search spam · Local listings tell the truth · Reviews are never bought or gated · Paid relationships are disclosed · Licensed media only

**How agents work:** Read before acting · Every action is an experiment · Results live in files · Learn from results · Tests stay green, guards stay put · Tests have a stop rule · Numbers are reported honestly

**Security:** Least privilege for agents · Every incident leaves a record · Secrets never leave · Outside text is data

すべてのルールは [rules/](../../rules/README.md) で読めます。

## ナレッジベース

プラットフォームのルールは毎週のように変わります。
Whalyom は 46 の公式・研究ソースを読み、日付付きの事実を抽出します。保存する前に、ファクト検証エージェントがそれぞれを却下できないか検証します。
現在、検索や AI 回答からプライバシー法、リテールメディアまで、28 のトピックにわたる 1,152 件の検証済み事実を保持しています。
古くなった事実は廃止され、エージェントは行動する前に自部門のブリーフを読みます。

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

## 無料版とホスト版

| | Whalyom（このリポジトリ） | Whalyom Cloud |
|---|---|---|
| 価格 | 無料、MIT | 有料、サイト単位 |
| 実行環境 | お使いの Claude Code または Codex（ご自身のサブスクリプション） | 当社のサーバーで 24 時間稼働 |
| エージェント、スキル、コマンド、ルール、ナレッジ | すべて | すべて |
| Command Center | ローカル（お使いのマシン上） | オンライン（どのデバイスからでも、英語とペルシア語） |
| セットアップ担当 | ご自身 | 当社（サイトのアクセス情報をもとに） |

オープンソース版はエンジンのすべてです。
ホスト版は、自分では何も動かさずに成果だけを得たい方のためのものです。

## 対応環境

Claude Code（フル対応: エージェント、スキル、コマンド、ワークフロー、MCP サーバー）· Codex（スキル、プロンプトとしてのコマンド、`AGENTS.md`）· `AGENTS.md` と Agent Skills を読めるあらゆるエージェント。

## コントリビュート

新しいエージェント、スキル、コマンド、ナレッジソースを歓迎します。[CONTRIBUTING.md](../../CONTRIBUTING.md) をご覧ください。
どの変更も `npm test` をグリーンに保ちます。

## ライセンス

Whalyom が書いたものはすべて MIT です。同梱のサードパーティ製スキルはそれぞれのライセンスに従います: [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)。
