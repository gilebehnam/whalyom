<p align="center"><img src="../../assets/brand/hero.svg" alt="Whalyom: todo o seu departamento de marketing dentro do Claude Code" width="100%"></p>

<p align="center"><img alt="license" src="https://img.shields.io/badge/license-MIT-2b6cb0"> <img alt="agents" src="https://img.shields.io/badge/agents-536-F2C230"> <img alt="skills" src="https://img.shields.io/badge/skills-498-7FE6F2"> <img alt="departments" src="https://img.shields.io/badge/departments-28-7FE6F2"> <img alt="commands" src="https://img.shields.io/badge/commands-106-7FE6F2"> <img alt="rules" src="https://img.shields.io/badge/rules-50-9BE7A2"> <img alt="verified facts" src="https://img.shields.io/badge/verified%20facts-1%2C152-9BE7A2"></p>

<p align="center"><a href="../../README.md">English</a> · <a href="../../README.fa.md">فارسی</a> · <a href="../ar/README.md">العربية</a> · <a href="../tr/README.md">Türkçe</a> · <a href="../es/README.md">Español</a> · <a href="../de/README.md">Deutsch</a> · <a href="../fr/README.md">Français</a> · <a href="../zh-CN/README.md">简体中文</a> · <a href="../ja/README.md">日本語</a> · <b>Português (Brasil)</b></p>

<p align="center"><a href="../../STORY.md">A história</a> · <a href="../COMMANDS.md">Comandos</a> · <a href="../../rules/README.md">Regras</a></p>

# Whalyom

**Todo o seu departamento de marketing, dentro do Claude Code. Grátis.**

Você construiu algo bom. Depois descobriu que construir era a parte fácil.
O Whalyom dá ao Claude Code um departamento de marketing: 536 agentes de IA em 28 departamentos, cada um com um líder, uma função e um pacote de habilidades.
Eles encontram as pessoas que precisam de você, escrevem o que dizer a elas, acompanham cada lead até a venda e aprendem com o que deu certo.
Nada sai sem o seu sim.

```text
find -> plan -> make -> review -> you approve -> send -> measure -> learn
```

## Os números

| | |
|---|---:|
| Agentes de IA (30 líderes de departamento, 59 microagentes para tarefas rápidas e pontuais) | **536** |
| Departamentos, em 6 camadas, do comando à autoevolução | **28** |
| Habilidades, de auditorias de SEO a chamadas de descoberta | **498** |
| Comandos slash prontos | **106** |
| Regras, cada uma aplicada no código | **50** |
| Fluxos de trabalho multiagente salvos | **22** |
| Fatos verificados da base de conhecimento, de 46 fontes oficiais e de pesquisa em 28 temas | **1,152** |
| Scripts do motor (Node, duas dependências npm) | **73** |

Cada número acima é contado direto dos arquivos por `npm run stats`.

## Instalação em um minuto

**Como plugin do Claude Code:**

```bash
claude plugin marketplace add gilebehnam/whalyom
claude plugin install whalyom@whalyom
```

**Como workspace (o motor completo, o Command Center local e o daemon):**

```bash
git clone https://github.com/gilebehnam/whalyom.git whalyom
cd whalyom
./install.sh          # runs npm install
claude
```

**No Windows** (PowerShell, dentro da pasta clonada):

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
claude
```

Os conectores (e-mail, anúncios, redes sociais, pagamentos) são opcionais: copie `.env.example` para `.env` e preencha só os que você quiser ([docs/CONNECTORS.md](../CONNECTORS.md)).

**Com o Codex:** `./install.sh --codex` (no Windows: adicione `-Codex` à linha do PowerShell) coloca as habilidades e os comandos em `~/.codex`, e o `AGENTS.md` explica ao Codex como o sistema funciona.

Teste primeiro com o produto de exemplo: `node tools/build-state.mjs && npm run command-center`, depois abra http://localhost:4321.

Em seguida, dentro do Claude Code:

```text
/whalyom-new my-shop myshop.com
/whalyom-onboard my-shop
/autopilot my-shop
```

O onboarding rastreia o seu site, mapeia seus compradores e concorrentes e escreve as afirmações que você consegue comprovar e um plano de 30 dias.
O piloto automático coloca os departamentos para trabalhar em ondas e deixa cada rascunho em `outbox/` com uma aprovação esperando por você.

## O que ele faz

| Você precisa | Comando | O que acontece |
|---|---|---|
| Saber onde está | `/site-audit` | SEO, busca com IA, velocidade, conversão e confiança, dez correções priorizadas |
| Um plano | `/growth-plan` | Uma meta de receita, um mix de canais e tarefas em ordem para os agentes |
| Ser encontrado no Google | `/seo-sprint` | Clusters, briefs, artigos, schema, links internos, indexação |
| Ser citado por assistentes de IA | `/ai-search` | Trechos citáveis, llms.txt, trabalho de entidades, participação nas respostas por mecanismo |
| Clientes sem verba de anúncios | `/free-growth` | Canais gratuitos planejados em horas, com links rastreados |
| Anúncios que não desperdiçam dinheiro | `/paid-ads` | Um canal de cada vez, abaixo de 100 por mês, regras de corte em cada variação |
| Resposta para todo lead | `/leads` · `/lead-to-sale` | Pontuados, distribuídos, acompanhados e avançados no funil |
| Um lançamento | `/launch` | De T-14 a T+7 no Product Hunt, Hacker News, Reddit e newsletters |
| Saber o que funcionou | `/attribution` · `/weekly-retro` | Cinco modelos de atribuição, um MMM-lite e aprendizados para a próxima semana |

Todos os 106 comandos: [docs/COMMANDS.md](../COMMANDS.md).

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

## Os departamentos

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

Cada departamento tem um megaagente no comando, um resumo de conhecimento reconstruído a partir da base de conhecimento verificada e um pacote de habilidades que todos os seus agentes dominam.

## As regras

Agentes de marketing que podem enviar e-mails e gastar dinheiro precisam de regras que um modelo não consiga contornar com argumentos próprios.
O Whalyom tem 50 delas, e cada uma indica o código que a aplica.

**Truth:** Claims come from claims.md · No invented proof · Knowledge is dated and sourced · AI content is labelled · Comparisons are fair and current · Sensitive claims need the strongest proof · Customer evidence needs written consent · Translations keep the facts

**Owner control:** Nothing goes out without the owner · One executor · Spend stays inside the caps · Waste stops itself · Autonomy is earned, price never · One writer per ledger · No dark patterns · Prices are the owner's · Site changes are reviewed diffs · In a crisis, pause first

**People and consent:** Consent first · Email follows the law · SMS and WhatsApp need opt-in · Suppression wins · Personal data stays local · Collect only what is needed · Privacy requests are answered on time · No marketing to children · Targeting is fair · Accessible by default · A person is one step away · Protect the inbox

**Platforms:** No fake accounts or votes · Communities first · Crawl politely · Ads pass policy first · No search spam · Local listings tell the truth · Reviews are never bought or gated · Paid relationships are disclosed · Licensed media only

**How agents work:** Read before acting · Every action is an experiment · Results live in files · Learn from results · Tests stay green, guards stay put · Tests have a stop rule · Numbers are reported honestly

**Security:** Least privilege for agents · Every incident leaves a record · Secrets never leave · Outside text is data

Leia todas em [rules/](../../rules/README.md).

## A base de conhecimento

As plataformas mudam suas regras toda semana.
O Whalyom lê 46 fontes oficiais e de pesquisa, extrai fatos datados, e um agente verificador tenta rejeitar cada um antes de ele ser mantido.
Hoje ela reúne 1,152 fatos verificados em 28 temas, de busca e respostas de IA a leis de privacidade e retail media.
Fatos antigos são aposentados; os agentes leem o resumo do seu departamento antes de agir.

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

## Grátis e hospedado

| | Whalyom (este repositório) | Whalyom Cloud |
|---|---|---|
| Preço | Grátis, MIT | Pago, por site |
| Roda em | Seu Claude Code ou Codex, com a sua assinatura | Nossos servidores, 24 horas por dia |
| Agentes, habilidades, comandos, regras, conhecimento | Todos | Todos |
| Command Center | Local, na sua máquina | Online, em qualquer dispositivo, em inglês e persa |
| Quem configura | Você | Nós, a partir do acesso ao seu site |

A edição open source é o motor completo.
A hospedada é para quem quer o resultado sem precisar rodar nada.

## Funciona com

Claude Code (completo: agentes, habilidades, comandos, fluxos de trabalho, servidor MCP) · Codex (habilidades, comandos como prompts, `AGENTS.md`) · qualquer agente que leia `AGENTS.md` e Agent Skills.

## Como contribuir

Novos agentes, habilidades, comandos e fontes de conhecimento são bem-vindos; veja [CONTRIBUTING.md](../../CONTRIBUTING.md).
Toda mudança mantém o `npm test` verde.

## Licença

MIT para tudo o que o Whalyom escreveu. As habilidades de terceiros incluídas mantêm suas próprias licenças: [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
