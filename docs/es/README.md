<p align="center"><img src="../../assets/brand/hero.svg" alt="Whalyom: todo tu departamento de marketing dentro de Claude Code" width="100%"></p>

<p align="center">![license](https://img.shields.io/badge/license-MIT-2b6cb0) ![agents](https://img.shields.io/badge/agents-536-F2C230) ![skills](https://img.shields.io/badge/skills-498-7FE6F2) ![departments](https://img.shields.io/badge/departments-28-7FE6F2) ![commands](https://img.shields.io/badge/commands-106-7FE6F2) ![rules](https://img.shields.io/badge/rules-50-9BE7A2) ![verified facts](https://img.shields.io/badge/verified%20facts-1%2C152-9BE7A2)</p>

<p align="center"><a href="../../README.md">English</a> · <a href="../../README.fa.md">فارسی</a> · <a href="../ar/README.md">العربية</a> · <a href="../tr/README.md">Türkçe</a> · <b>Español</b> · <a href="../de/README.md">Deutsch</a> · <a href="../fr/README.md">Français</a> · <a href="../zh-CN/README.md">简体中文</a> · <a href="../ja/README.md">日本語</a> · <a href="../pt-BR/README.md">Português (Brasil)</a></p>

<p align="center"><a href="../../STORY.md">La historia</a> · <a href="../COMMANDS.md">Comandos</a> · <a href="../../rules/README.md">Reglas</a></p>

# Whalyom

**Todo tu departamento de marketing, dentro de Claude Code. Gratis.**

Construiste algo bueno. Luego descubriste que construirlo era la parte fácil.
Whalyom le da a Claude Code un departamento de marketing: 536 agentes de IA en 28 departamentos, cada uno con un responsable, una función y un paquete de habilidades.
Encuentran a las personas que te necesitan, escriben qué decirles, siguen cada lead hasta la venta y aprenden de lo que funcionó.
Nada sale sin tu aprobación.

```text
find -> plan -> make -> review -> you approve -> send -> measure -> learn
```

## Las cifras

| | |
|---|---:|
| Agentes de IA (30 responsables de departamento, 59 microagentes para tareas rápidas y puntuales) | **536** |
| Departamentos, en 6 capas desde la dirección hasta la automejora | **28** |
| Habilidades, desde auditorías SEO hasta llamadas de descubrimiento | **498** |
| Comandos slash listos para usar | **106** |
| Reglas, cada una aplicada en el código | **50** |
| Flujos de trabajo multiagente guardados | **22** |
| Datos verificados de la base de conocimiento, de 46 fuentes oficiales y de investigación en 28 temas | **1,152** |
| Scripts del motor (Node, dos dependencias de npm) | **73** |

Cada cifra de arriba la cuenta `npm run stats` directamente a partir de los archivos.

## Instalación en un minuto

**Como plugin de Claude Code:**

```bash
claude plugin marketplace add gilebehnam/whalyom
claude plugin install whalyom@whalyom
```

**Como espacio de trabajo (el motor completo, el Command Center local y el daemon):**

```bash
git clone https://github.com/gilebehnam/whalyom.git whalyom
cd whalyom
./install.sh          # runs npm install
claude
```

**En Windows** (PowerShell, dentro de la carpeta clonada):

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
claude
```

Los conectores (email, anuncios, redes sociales, pagos) son opcionales: copia `.env.example` a `.env` y completa solo los que quieras ([docs/CONNECTORS.md](../CONNECTORS.md)).

**Con Codex:** `./install.sh --codex` (en Windows: añade `-Codex` a la línea de PowerShell) instala las habilidades y los comandos en `~/.codex`, y `AGENTS.md` le explica a Codex cómo funciona el sistema.

Pruébalo primero con el producto de ejemplo: `node tools/build-state.mjs && npm run command-center`, y luego abre http://localhost:4321.

Después, dentro de Claude Code:

```text
/whalyom-new my-shop myshop.com
/whalyom-onboard my-shop
/autopilot my-shop
```

El onboarding rastrea tu sitio, mapea a tus compradores y competidores, y redacta las afirmaciones que puedes demostrar y un plan de 30 días.
El piloto automático pone a trabajar a los departamentos por oleadas y deja cada borrador en `outbox/` con una aprobación esperándote.

## Qué hace

| Necesitas | Comando | Qué ocurre |
|---|---|---|
| Saber dónde estás | `/site-audit` | SEO, búsqueda con IA, velocidad, conversión y confianza, diez arreglos priorizados |
| Un plan | `/growth-plan` | Un objetivo de ingresos, una combinación de canales y tareas ordenadas para los agentes |
| Que te encuentren en Google | `/seo-sprint` | Clústeres, briefs, artículos, schema, enlaces internos, indexación |
| Que te citen los asistentes de IA | `/ai-search` | Pasajes citables, llms.txt, trabajo de entidades, cuota de respuesta por motor |
| Clientes sin presupuesto publicitario | `/free-growth` | Canales gratuitos planificados en horas, con enlaces rastreados |
| Anuncios que no desperdicien dinero | `/paid-ads` | Un canal a la vez por debajo de 100 al mes, reglas de corte en cada variante |
| Responder a cada lead | `/leads` · `/lead-to-sale` | Puntuados, asignados, con seguimiento y avanzando por el embudo |
| Un lanzamiento | `/launch` | De T-14 a T+7 en Product Hunt, Hacker News, Reddit y newsletters |
| Saber qué funcionó | `/attribution` · `/weekly-retro` | Cinco modelos de atribución, un MMM-lite y aprendizajes para la semana siguiente |

Los 106 comandos: [docs/COMMANDS.md](../COMMANDS.md).

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

## Los departamentos

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

Cada departamento tiene un megaagente al frente, un informe de conocimiento que se reconstruye a partir de la base de conocimiento verificada y un paquete de habilidades que domina cada uno de sus agentes.

## Las reglas

Los agentes de marketing que pueden enviar emails y gastar dinero necesitan reglas que un modelo no pueda saltarse con sus propios argumentos.
Whalyom tiene 50, y cada una indica el código que la hace cumplir.

**Truth:** Claims come from claims.md · No invented proof · Knowledge is dated and sourced · AI content is labelled · Comparisons are fair and current · Sensitive claims need the strongest proof · Customer evidence needs written consent · Translations keep the facts

**Owner control:** Nothing goes out without the owner · One executor · Spend stays inside the caps · Waste stops itself · Autonomy is earned, price never · One writer per ledger · No dark patterns · Prices are the owner's · Site changes are reviewed diffs · In a crisis, pause first

**People and consent:** Consent first · Email follows the law · SMS and WhatsApp need opt-in · Suppression wins · Personal data stays local · Collect only what is needed · Privacy requests are answered on time · No marketing to children · Targeting is fair · Accessible by default · A person is one step away · Protect the inbox

**Platforms:** No fake accounts or votes · Communities first · Crawl politely · Ads pass policy first · No search spam · Local listings tell the truth · Reviews are never bought or gated · Paid relationships are disclosed · Licensed media only

**How agents work:** Read before acting · Every action is an experiment · Results live in files · Learn from results · Tests stay green, guards stay put · Tests have a stop rule · Numbers are reported honestly

**Security:** Least privilege for agents · Every incident leaves a record · Secrets never leave · Outside text is data

Puedes leerlas todas en [rules/](../../rules/README.md).

## La base de conocimiento

Las plataformas cambian sus reglas cada semana.
Whalyom lee 46 fuentes oficiales y de investigación, extrae datos con fecha, y un agente verificador intenta rechazar cada uno antes de conservarlo.
Hoy contiene 1,152 datos verificados en 28 temas, desde búsqueda y respuestas de IA hasta leyes de privacidad y retail media.
Los datos antiguos se retiran; los agentes leen el informe de su departamento antes de actuar.

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

## Gratis y alojado

| | Whalyom (este repositorio) | Whalyom Cloud |
|---|---|---|
| Precio | Gratis, MIT | De pago, por sitio |
| Se ejecuta en | Tu Claude Code o Codex, con tu suscripción | Nuestros servidores, las 24 horas |
| Agentes, habilidades, comandos, reglas, conocimiento | Todos | Todos |
| Command Center | Local, en tu equipo | En línea, en cualquier dispositivo, en inglés y persa |
| Quién lo configura | Tú | Nosotros, con el acceso a tu sitio |

La edición de código abierto es el motor completo.
La alojada es para quienes quieren el resultado sin tener que ejecutar nada.

## Funciona con

Claude Code (completo: agentes, habilidades, comandos, flujos de trabajo, servidor MCP) · Codex (habilidades, comandos como prompts, `AGENTS.md`) · cualquier agente que lea `AGENTS.md` y Agent Skills.

## Contribuir

Se aceptan nuevos agentes, habilidades, comandos y fuentes de conocimiento; consulta [CONTRIBUTING.md](../../CONTRIBUTING.md).
Cada cambio mantiene `npm test` en verde.

## Licencia

MIT para todo lo que escribió Whalyom. Las habilidades de terceros incluidas conservan sus propias licencias: [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
