<p align="center"><img src="../../assets/brand/hero.svg" alt="Whalyom: Ihre komplette Marketingabteilung in Claude Code" width="100%"></p>

<p align="center"><img alt="license" src="https://img.shields.io/badge/license-MIT-2b6cb0"> <img alt="agents" src="https://img.shields.io/badge/agents-536-F2C230"> <img alt="skills" src="https://img.shields.io/badge/skills-498-7FE6F2"> <img alt="departments" src="https://img.shields.io/badge/departments-28-7FE6F2"> <img alt="commands" src="https://img.shields.io/badge/commands-106-7FE6F2"> <img alt="rules" src="https://img.shields.io/badge/rules-50-9BE7A2"> <img alt="verified facts" src="https://img.shields.io/badge/verified%20facts-1%2C152-9BE7A2"></p>

<p align="center"><a href="../../README.md">English</a> · <a href="../../README.fa.md">فارسی</a> · <a href="../ar/README.md">العربية</a> · <a href="../tr/README.md">Türkçe</a> · <a href="../es/README.md">Español</a> · <b>Deutsch</b> · <a href="../fr/README.md">Français</a> · <a href="../zh-CN/README.md">简体中文</a> · <a href="../ja/README.md">日本語</a> · <a href="../pt-BR/README.md">Português (Brasil)</a> · <a href="../ko/README.md">한국어</a></p>

<p align="center"><a href="../../STORY.md">Die Geschichte</a> · <a href="../COMMANDS.md">Befehle</a> · <a href="../../rules/README.md">Regeln</a></p>

# Whalyom

**Ihre komplette Marketingabteilung, direkt in Claude Code. Kostenlos.**

Sie haben etwas Gutes gebaut. Dann haben Sie gemerkt, dass das Bauen der einfache Teil war.
Whalyom gibt Claude Code eine Marketingabteilung: 536 KI-Agenten in 28 Abteilungen, jede mit einer Leitung, einer klaren Aufgabe und einem Skill-Paket.
Sie finden die Menschen, die Sie brauchen, schreiben, was Sie ihnen sagen sollten, begleiten jeden Lead bis zum Abschluss und lernen aus dem, was funktioniert hat.
Nichts geht raus ohne Ihr Ja.

```text
find -> plan -> make -> review -> you approve -> send -> measure -> learn
```

## Die Zahlen

| | |
|---|---:|
| KI-Agenten (30 Abteilungsleitungen, 59 Mikro-Agenten für einzelne schnelle Aufgaben) | **536** |
| Abteilungen, in 6 Ebenen von der Steuerung bis zur Selbstverbesserung | **28** |
| Skills, von SEO-Audits bis zu Erstgesprächen | **498** |
| Fertige Slash-Befehle | **106** |
| Regeln, jede im Code durchgesetzt | **50** |
| Gespeicherte Multi-Agenten-Workflows | **22** |
| Geprüfte Wissensfakten aus 46 offiziellen und wissenschaftlichen Quellen in 28 Themen | **1,152** |
| Engine-Skripte (Node, zwei npm-Abhängigkeiten) | **73** |

Jede Zahl oben wird von `npm run stats` direkt aus den Dateien gezählt.

## Installation in einer Minute

**Als Claude-Code-Plugin:**

```bash
claude plugin marketplace add gilebehnam/whalyom
claude plugin install whalyom@whalyom
```

**Als Workspace (die komplette Engine, das lokale Command Center und der Daemon):**

```bash
git clone https://github.com/gilebehnam/whalyom.git whalyom
cd whalyom
./install.sh          # runs npm install
claude
```

**Unter Windows** (PowerShell, im geklonten Ordner):

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
claude
```

Konnektoren (E-Mail, Anzeigen, Social Media, Zahlungen) sind optional: Kopieren Sie `.env.example` nach `.env` und füllen Sie nur die aus, die Sie brauchen ([docs/CONNECTORS.md](../CONNECTORS.md)).

**Mit Codex:** `./install.sh --codex` (Windows: `-Codex` an die PowerShell-Zeile anhängen) legt die Skills und Befehle in `~/.codex` ab, und `AGENTS.md` erklärt Codex, wie das System funktioniert.

Probieren Sie es zuerst mit dem Beispielprodukt aus: `node tools/build-state.mjs && npm run command-center`, dann http://localhost:4321 öffnen.

Danach in Claude Code:

```text
/whalyom-new my-shop myshop.com
/whalyom-onboard my-shop
/autopilot my-shop
```

Das Onboarding durchsucht Ihre Website, erfasst Ihre Käufer und Wettbewerber und schreibt die Aussagen, die Sie belegen können, sowie einen 30-Tage-Plan.
Der Autopilot lässt die Abteilungen in Wellen arbeiten und legt jeden Entwurf in `outbox/` ab, jeweils mit einer Freigabe, die auf Sie wartet.

## Was es kann

| Sie brauchen | Befehl | Was passiert |
|---|---|---|
| Einen klaren Stand | `/site-audit` | SEO, KI-Suche, Geschwindigkeit, Conversion und Vertrauen, zehn Fixes nach Priorität |
| Einen Plan | `/growth-plan` | Ein Umsatzziel, ein Kanal-Mix, Aufgaben in der richtigen Reihenfolge für die Agenten |
| Sichtbarkeit bei Google | `/seo-sprint` | Cluster, Briefings, Artikel, Schema, interne Links, Indexierung |
| Zitate in KI-Assistenten | `/ai-search` | Zitierfähige Passagen, llms.txt, Entity-Arbeit, Antwortanteil pro Engine |
| Kunden ohne Werbebudget | `/free-growth` | Kostenlose Kanäle, in Stunden geplant, mit getrackten Links |
| Anzeigen, die kein Geld verschwenden | `/paid-ads` | Ein Kanal nach dem anderen unter 100 im Monat, Abschaltregeln für jede Variante |
| Eine Antwort auf jeden Lead | `/leads` · `/lead-to-sale` | Bewertet, zugewiesen, nachgefasst, durch den Funnel bewegt |
| Einen Launch | `/launch` | T-14 bis T+7 über Product Hunt, Hacker News, Reddit und Newsletter |
| Wissen, was funktioniert hat | `/attribution` · `/weekly-retro` | Fünf Attributionsmodelle, ein MMM-lite und Erkenntnisse für die nächste Woche |

Alle 106 Befehle: [docs/COMMANDS.md](../COMMANDS.md).

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

## Die Abteilungen

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

Jede Abteilung hat einen Mega-Agenten an der Spitze, ein Wissensbriefing, das aus der geprüften Wissensbasis neu aufgebaut wird, und ein Skill-Paket, das jeder Agent der Abteilung beherrscht.

## Die Regeln

Marketing-Agenten, die E-Mails senden und Geld ausgeben können, brauchen Regeln, die ein Modell sich nicht wegdiskutieren kann.
Whalyom hat 50 davon, und jede nennt den Code, der sie durchsetzt.

**Truth:** Claims come from claims.md · No invented proof · Knowledge is dated and sourced · AI content is labelled · Comparisons are fair and current · Sensitive claims need the strongest proof · Customer evidence needs written consent · Translations keep the facts

**Owner control:** Nothing goes out without the owner · One executor · Spend stays inside the caps · Waste stops itself · Autonomy is earned, price never · One writer per ledger · No dark patterns · Prices are the owner's · Site changes are reviewed diffs · In a crisis, pause first

**People and consent:** Consent first · Email follows the law · SMS and WhatsApp need opt-in · Suppression wins · Personal data stays local · Collect only what is needed · Privacy requests are answered on time · No marketing to children · Targeting is fair · Accessible by default · A person is one step away · Protect the inbox

**Platforms:** No fake accounts or votes · Communities first · Crawl politely · Ads pass policy first · No search spam · Local listings tell the truth · Reviews are never bought or gated · Paid relationships are disclosed · Licensed media only

**How agents work:** Read before acting · Every action is an experiment · Results live in files · Learn from results · Tests stay green, guards stay put · Tests have a stop rule · Numbers are reported honestly

**Security:** Least privilege for agents · Every incident leaves a record · Secrets never leave · Outside text is data

Alle Regeln finden Sie in [rules/](../../rules/README.md).

## Die Wissensbasis

Plattformen ändern ihre Regeln jede Woche.
Whalyom liest 46 offizielle und wissenschaftliche Quellen, extrahiert datierte Fakten, und ein Faktenprüfer-Agent versucht, jeden einzelnen zu widerlegen, bevor er aufgenommen wird.
Heute umfasst sie 1,152 geprüfte Fakten in 28 Themen, von Suche und KI-Antworten bis zu Datenschutzrecht und Retail Media.
Veraltete Fakten werden aussortiert; die Agenten lesen vor jeder Aktion das Briefing ihrer Abteilung.

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

## Kostenlos und gehostet

| | Whalyom (dieses Repo) | Whalyom Cloud |
|---|---|---|
| Preis | Kostenlos, MIT | Kostenpflichtig, pro Website |
| Läuft auf | Ihrem Claude Code oder Codex, mit Ihrem Abo | Unseren Servern, rund um die Uhr |
| Agenten, Skills, Befehle, Regeln, Wissen | Alle | Alle |
| Command Center | Lokal, auf Ihrem Rechner | Online, auf jedem Gerät, Englisch und Persisch |
| Wer richtet es ein | Sie | Wir, mit dem Zugang zu Ihrer Website |

Die Open-Source-Edition ist die komplette Engine.
Die gehostete Version ist für alle, die das Ergebnis wollen, ohne selbst etwas zu betreiben.

## Funktioniert mit

Claude Code (vollständig: Agenten, Skills, Befehle, Workflows, MCP-Server) · Codex (Skills, Befehle als Prompts, `AGENTS.md`) · jedem Agenten, der `AGENTS.md` und Agent Skills liest.

## Mitwirken

Neue Agenten, Skills, Befehle und Wissensquellen sind willkommen; siehe [CONTRIBUTING.md](../../CONTRIBUTING.md).
Jede Änderung hält `npm test` grün.

## Lizenz

MIT für alles, was Whalyom geschrieben hat. Mitgelieferte Skills von Drittanbietern behalten ihre eigenen Lizenzen: [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
