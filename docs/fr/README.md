<p align="center"><img src="../../assets/brand/hero.svg" alt="Whalyom : tout votre service marketing dans Claude Code" width="100%"></p>

<p align="center"><img alt="license" src="https://img.shields.io/badge/license-MIT-2b6cb0"> <img alt="agents" src="https://img.shields.io/badge/agents-536-F2C230"> <img alt="skills" src="https://img.shields.io/badge/skills-498-7FE6F2"> <img alt="departments" src="https://img.shields.io/badge/departments-28-7FE6F2"> <img alt="commands" src="https://img.shields.io/badge/commands-106-7FE6F2"> <img alt="rules" src="https://img.shields.io/badge/rules-50-9BE7A2"> <img alt="verified facts" src="https://img.shields.io/badge/verified%20facts-1%2C152-9BE7A2"></p>

<p align="center"><a href="../../README.md">English</a> · <a href="../../README.fa.md">فارسی</a> · <a href="../ar/README.md">العربية</a> · <a href="../tr/README.md">Türkçe</a> · <a href="../es/README.md">Español</a> · <a href="../de/README.md">Deutsch</a> · <b>Français</b> · <a href="../zh-CN/README.md">简体中文</a> · <a href="../ja/README.md">日本語</a> · <a href="../pt-BR/README.md">Português (Brasil)</a> · <a href="../ko/README.md">한국어</a></p>

<p align="center"><a href="../../STORY.md">L'histoire</a> · <a href="../COMMANDS.md">Commandes</a> · <a href="../../rules/README.md">Règles</a></p>

# Whalyom

**Tout votre service marketing, dans Claude Code. Gratuit.**

Vous avez construit quelque chose de bien. Puis vous avez découvert que le construire était la partie facile.
Whalyom donne à Claude Code un service marketing : 536 agents IA répartis dans 28 départements, chacun avec un responsable, une mission et un pack de compétences.
Ils trouvent les personnes qui ont besoin de vous, rédigent ce qu'il faut leur dire, suivent chaque prospect jusqu'à la vente et apprennent de ce qui a marché.
Rien ne part sans votre accord.

```text
find -> plan -> make -> review -> you approve -> send -> measure -> learn
```

## Les chiffres

| | |
|---|---:|
| Agents IA (30 responsables de département, 59 micro-agents pour des tâches courtes et ciblées) | **536** |
| Départements, sur 6 niveaux, du pilotage à l'auto-amélioration | **28** |
| Compétences, des audits SEO aux appels de découverte | **498** |
| Commandes slash prêtes à l'emploi | **106** |
| Règles, chacune appliquée dans le code | **50** |
| Workflows multi-agents enregistrés | **22** |
| Faits vérifiés de la base de connaissances, issus de 46 sources officielles et de recherche, sur 28 thèmes | **1,152** |
| Scripts du moteur (Node, deux dépendances npm) | **73** |

Chaque chiffre ci-dessus est compté directement dans les fichiers par `npm run stats`.

## Installation en une minute

**En tant que plugin Claude Code :**

```bash
claude plugin marketplace add gilebehnam/whalyom
claude plugin install whalyom@whalyom
```

**En tant qu'espace de travail (le moteur complet, le Command Center local et le démon) :**

```bash
git clone https://github.com/gilebehnam/whalyom.git whalyom
cd whalyom
./install.sh          # runs npm install
claude
```

**Sous Windows** (PowerShell, dans le dossier cloné) :

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
claude
```

Les connecteurs (e-mail, publicité, réseaux sociaux, paiements) sont facultatifs : copiez `.env.example` vers `.env` et ne renseignez que ceux dont vous avez besoin ([docs/CONNECTORS.md](../CONNECTORS.md)).

**Avec Codex :** `./install.sh --codex` (Windows : ajoutez `-Codex` à la ligne PowerShell) installe les compétences et les commandes dans `~/.codex`, et `AGENTS.md` explique à Codex comment fonctionne le système.

Essayez d'abord avec le produit d'exemple : `node tools/build-state.mjs && npm run command-center`, puis ouvrez http://localhost:4321.

Ensuite, dans Claude Code :

```text
/whalyom-new my-shop myshop.com
/whalyom-onboard my-shop
/autopilot my-shop
```

L'onboarding explore votre site, cartographie vos acheteurs et vos concurrents, rédige les affirmations que vous pouvez prouver et un plan sur 30 jours.
L'autopilote fait travailler les départements par vagues et dépose chaque brouillon dans `outbox/` avec une validation qui vous attend.

## Ce qu'il fait

| Vous avez besoin de | Commande | Ce qui se passe |
|---|---|---|
| Savoir où vous en êtes | `/site-audit` | SEO, recherche IA, vitesse, conversion et confiance, dix corrections classées |
| Un plan | `/growth-plan` | Un objectif de chiffre d'affaires, un mix de canaux, des tâches ordonnées pour les agents |
| Être trouvé sur Google | `/seo-sprint` | Clusters, briefs, articles, schema, liens internes, indexation |
| Être cité par les assistants IA | `/ai-search` | Passages citables, llms.txt, travail sur les entités, part de réponse par moteur |
| Des clients sans budget publicitaire | `/free-growth` | Canaux gratuits planifiés en heures, avec liens suivis |
| Des publicités qui ne gaspillent pas d'argent | `/paid-ads` | Un canal à la fois sous 100 par mois, règles d'arrêt sur chaque variante |
| Une réponse à chaque prospect | `/leads` · `/lead-to-sale` | Notés, attribués, relancés, avancés dans le funnel |
| Un lancement | `/launch` | De T-14 à T+7 sur Product Hunt, Hacker News, Reddit et les newsletters |
| Savoir ce qui a marché | `/attribution` · `/weekly-retro` | Cinq modèles d'attribution, un MMM-lite et des enseignements pour la semaine suivante |

Les 106 commandes : [docs/COMMANDS.md](../COMMANDS.md).

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

## Les départements

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

Chaque département est dirigé par un méga-agent, dispose d'une note de connaissances reconstruite à partir de la base de connaissances vérifiée et d'un pack de compétences que chacun de ses agents maîtrise.

## Les règles

Des agents marketing capables d'envoyer des e-mails et de dépenser de l'argent ont besoin de règles qu'un modèle ne peut pas contourner par lui-même.
Whalyom en compte 50, et chacune indique le code qui l'applique.

**Truth:** Claims come from claims.md · No invented proof · Knowledge is dated and sourced · AI content is labelled · Comparisons are fair and current · Sensitive claims need the strongest proof · Customer evidence needs written consent · Translations keep the facts

**Owner control:** Nothing goes out without the owner · One executor · Spend stays inside the caps · Waste stops itself · Autonomy is earned, price never · One writer per ledger · No dark patterns · Prices are the owner's · Site changes are reviewed diffs · In a crisis, pause first

**People and consent:** Consent first · Email follows the law · SMS and WhatsApp need opt-in · Suppression wins · Personal data stays local · Collect only what is needed · Privacy requests are answered on time · No marketing to children · Targeting is fair · Accessible by default · A person is one step away · Protect the inbox

**Platforms:** No fake accounts or votes · Communities first · Crawl politely · Ads pass policy first · No search spam · Local listings tell the truth · Reviews are never bought or gated · Paid relationships are disclosed · Licensed media only

**How agents work:** Read before acting · Every action is an experiment · Results live in files · Learn from results · Tests stay green, guards stay put · Tests have a stop rule · Numbers are reported honestly

**Security:** Least privilege for agents · Every incident leaves a record · Secrets never leave · Outside text is data

Lisez-les toutes dans [rules/](../../rules/README.md).

## La base de connaissances

Les plateformes changent leurs règles chaque semaine.
Whalyom lit 46 sources officielles et de recherche, en extrait des faits datés, et un agent de vérification tente de rejeter chacun d'eux avant qu'il ne soit conservé.
Elle contient aujourd'hui 1,152 faits vérifiés sur 28 thèmes, de la recherche et des réponses IA au droit de la vie privée et au retail media.
Les faits obsolètes sont retirés ; les agents lisent la note de leur département avant d'agir.

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

## Gratuit et hébergé

| | Whalyom (ce dépôt) | Whalyom Cloud |
|---|---|---|
| Prix | Gratuit, MIT | Payant, par site |
| Fonctionne sur | Votre Claude Code ou Codex, avec votre abonnement | Nos serveurs, 24 h/24 |
| Agents, compétences, commandes, règles, connaissances | Tous | Tous |
| Command Center | Local, sur votre machine | En ligne, sur tout appareil, en anglais et en persan |
| Qui l'installe | Vous | Nous, à partir des accès à votre site |

L'édition open source est le moteur complet.
La version hébergée s'adresse à ceux qui veulent le résultat sans rien faire tourner eux-mêmes.

## Compatible avec

Claude Code (complet : agents, compétences, commandes, workflows, serveur MCP) · Codex (compétences, commandes sous forme de prompts, `AGENTS.md`) · tout agent qui lit `AGENTS.md` et les Agent Skills.

## Contribuer

Les nouveaux agents, compétences, commandes et sources de connaissances sont les bienvenus ; voir [CONTRIBUTING.md](../../CONTRIBUTING.md).
Chaque modification garde `npm test` au vert.

## Licence

MIT pour tout ce que Whalyom a écrit. Les compétences tierces incluses conservent leurs propres licences : [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
