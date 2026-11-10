<div dir="rtl">

<p align="center"><img src="../../assets/brand/hero.svg" alt="Whalyom: قسم التسويق بالكامل داخل Claude Code" width="100%"></p>

<p align="center"><img alt="license" src="https://img.shields.io/badge/license-MIT-2b6cb0"> <img alt="agents" src="https://img.shields.io/badge/agents-536-F2C230"> <img alt="skills" src="https://img.shields.io/badge/skills-498-7FE6F2"> <img alt="departments" src="https://img.shields.io/badge/departments-28-7FE6F2"> <img alt="commands" src="https://img.shields.io/badge/commands-106-7FE6F2"> <img alt="rules" src="https://img.shields.io/badge/rules-50-9BE7A2"> <img alt="verified facts" src="https://img.shields.io/badge/verified%20facts-1%2C152-9BE7A2"></p>

<p align="center"><a href="../../README.md">English</a> · <a href="../../README.fa.md">فارسی</a> · <b>العربية</b> · <a href="../tr/README.md">Türkçe</a> · <a href="../es/README.md">Español</a> · <a href="../de/README.md">Deutsch</a> · <a href="../fr/README.md">Français</a> · <a href="../zh-CN/README.md">简体中文</a> · <a href="../ja/README.md">日本語</a> · <a href="../pt-BR/README.md">Português (Brasil)</a></p>

<p align="center"><a href="../../STORY.md">القصة</a> · <a href="../COMMANDS.md">الأوامر</a> · <a href="../../rules/README.md">القواعد</a></p>

# Whalyom

**قسم التسويق بالكامل، داخل Claude Code. مجانًا.**

بنيت شيئًا جيدًا. ثم اكتشفت أن البناء كان الجزء السهل.
يمنح Whalyom أداة Claude Code قسم تسويق كاملًا: 536 وكيل ذكاء اصطناعي في 28 قسمًا، لكل قسم رئيس ومهمة واضحة وحزمة مهارات.
يجدون الأشخاص الذين يحتاجون إليك، ويكتبون ما تقوله لهم، ويتابعون كل عميل محتمل حتى إتمام البيع، ويتعلمون مما نجح.
لا يخرج شيء دون موافقتك.

<div dir="ltr">

```text
find -> plan -> make -> review -> you approve -> send -> measure -> learn
```

</div>

## الأرقام

| | |
|---|---:|
| وكلاء الذكاء الاصطناعي (30 رئيس قسم، و59 وكيلًا مصغّرًا للمهام السريعة المفردة) | **536** |
| الأقسام، موزعة على 6 طبقات من القيادة حتى التحسين الذاتي | **28** |
| المهارات، من تدقيق SEO إلى مكالمات الاستكشاف | **498** |
| أوامر slash جاهزة | **106** |
| القواعد، وكل واحدة منها مطبّقة في الكود | **50** |
| مسارات عمل محفوظة متعددة الوكلاء | **22** |
| حقائق معرفية موثّقة، من 46 مصدرًا رسميًا وبحثيًا في 28 موضوعًا | **1,152** |
| سكربتات المحرك (Node، مع اعتماديتين فقط من npm) | **73** |

كل رقم أعلاه يُحسب مباشرة من الملفات بواسطة `npm run stats`.

## التثبيت في دقيقة واحدة

**كإضافة (plugin) لـ Claude Code:**

<div dir="ltr">

```bash
claude plugin marketplace add gilebehnam/whalyom
claude plugin install whalyom@whalyom
```

</div>

**كمساحة عمل (المحرك الكامل، ومركز القيادة Command Center المحلي، والخدمة الخلفية daemon):**

<div dir="ltr">

```bash
git clone https://github.com/gilebehnam/whalyom.git whalyom
cd whalyom
./install.sh          # runs npm install
claude
```

</div>

**على Windows** (في PowerShell، داخل المجلد المستنسخ):

<div dir="ltr">

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
claude
```

</div>

الموصلات (البريد الإلكتروني، الإعلانات، وسائل التواصل، المدفوعات) اختيارية: انسخ `.env.example` إلى `.env` واملأ فقط ما تحتاج إليه ([docs/CONNECTORS.md](../CONNECTORS.md)).

**مع Codex:** الأمر `./install.sh --codex` (على Windows: أضف `-Codex` إلى سطر PowerShell) يضع المهارات والأوامر في `~/.codex`، ويشرح الملف `AGENTS.md` لـ Codex كيف يعمل النظام.

جرّبه أولًا على المنتج التجريبي: `node tools/build-state.mjs && npm run command-center`، ثم افتح http://localhost:4321.

بعد ذلك، داخل Claude Code:

<div dir="ltr">

```text
/whalyom-new my-shop myshop.com
/whalyom-onboard my-shop
/autopilot my-shop
```

</div>

تزحف عملية الإعداد على موقعك، وترسم خريطة لمشتريك ومنافسيك، وتكتب الادعاءات التي يمكنك إثباتها وخطة لمدة 30 يومًا.
ويشغّل الطيار الآلي الأقسام على دفعات، ويترك كل مسودة في `outbox/` مع طلب موافقة بانتظارك.

## ماذا يفعل

| تحتاج إلى | الأمر | ما الذي يحدث |
|---|---|---|
| معرفة موقعك الحالي | `/site-audit` | SEO والبحث بالذكاء الاصطناعي والسرعة والتحويل والثقة، مع عشرة إصلاحات مرتبة حسب الأولوية |
| خطة | `/growth-plan` | هدف إيرادات واحد، ومزيج قنوات، ومهام مرتبة للوكلاء |
| الظهور في Google | `/seo-sprint` | مجموعات مواضيع، وموجزات، ومقالات، وschema، وروابط داخلية، وفهرسة |
| أن تستشهد بك مساعدات الذكاء الاصطناعي | `/ai-search` | مقاطع قابلة للاستشهاد، وllms.txt، وعمل على الكيانات، وحصة الإجابات لكل محرك |
| عملاء دون ميزانية إعلانية | `/free-growth` | قنوات مجانية مخططة بالساعات، مع روابط قابلة للتتبع |
| إعلانات لا تهدر المال | `/paid-ads` | قناة واحدة في كل مرة تحت 100 شهريًا، مع قواعد إيقاف لكل نسخة |
| الرد على كل عميل محتمل | `/leads` · `/lead-to-sale` | تقييم وتوجيه ومتابعة وتحريك عبر مسار المبيعات |
| إطلاق | `/launch` | من T-14 إلى T+7 على Product Hunt وHacker News وReddit والنشرات البريدية |
| معرفة ما الذي نجح | `/attribution` · `/weekly-retro` | خمسة نماذج إسناد، ونموذج MMM-lite، ودروس للأسبوع التالي |

جميع الأوامر الـ 106: [docs/COMMANDS.md](../COMMANDS.md).

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

## الأقسام

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

لكل قسم وكيل رئيسي (mega agent) على رأسه، وموجز معرفي يُعاد بناؤه من قاعدة المعرفة الموثّقة، وحزمة مهارات يتقنها كل وكيل فيه.

## القواعد

وكلاء التسويق القادرون على إرسال البريد الإلكتروني وإنفاق المال يحتاجون إلى قواعد لا يستطيع النموذج أن يقنع نفسه بتجاوزها.
لدى Whalyom 50 قاعدة من هذا النوع، وكل قاعدة تذكر الكود الذي يطبّقها.

**Truth:** Claims come from claims.md · No invented proof · Knowledge is dated and sourced · AI content is labelled · Comparisons are fair and current · Sensitive claims need the strongest proof · Customer evidence needs written consent · Translations keep the facts

**Owner control:** Nothing goes out without the owner · One executor · Spend stays inside the caps · Waste stops itself · Autonomy is earned, price never · One writer per ledger · No dark patterns · Prices are the owner's · Site changes are reviewed diffs · In a crisis, pause first

**People and consent:** Consent first · Email follows the law · SMS and WhatsApp need opt-in · Suppression wins · Personal data stays local · Collect only what is needed · Privacy requests are answered on time · No marketing to children · Targeting is fair · Accessible by default · A person is one step away · Protect the inbox

**Platforms:** No fake accounts or votes · Communities first · Crawl politely · Ads pass policy first · No search spam · Local listings tell the truth · Reviews are never bought or gated · Paid relationships are disclosed · Licensed media only

**How agents work:** Read before acting · Every action is an experiment · Results live in files · Learn from results · Tests stay green, guards stay put · Tests have a stop rule · Numbers are reported honestly

**Security:** Least privilege for agents · Every incident leaves a record · Secrets never leave · Outside text is data

اقرأها كلها في [rules/](../../rules/README.md).

## قاعدة المعرفة

تغيّر المنصات قواعدها كل أسبوع.
يقرأ Whalyom 46 مصدرًا رسميًا وبحثيًا، ويستخرج حقائق مؤرخة، ويحاول وكيل للتحقق من الحقائق رفض كل واحدة منها قبل حفظها.
تضم اليوم 1,152 حقيقة موثّقة في 28 موضوعًا، من البحث وإجابات الذكاء الاصطناعي إلى قوانين الخصوصية وإعلانات منصات البيع بالتجزئة.
تُستبعد الحقائق القديمة، ويقرأ الوكلاء موجز قسمهم قبل أن يتصرفوا.

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

## المجاني والمستضاف

| | Whalyom (هذا المستودع) | Whalyom Cloud |
|---|---|---|
| السعر | مجاني، MIT | مدفوع، لكل موقع |
| يعمل على | Claude Code أو Codex الخاص بك، باشتراكك | خوادمنا، على مدار الساعة |
| الوكلاء والمهارات والأوامر والقواعد والمعرفة | جميعها | جميعها |
| مركز القيادة Command Center | محلي، على جهازك | عبر الإنترنت، على أي جهاز، بالإنجليزية والفارسية |
| من يتولى الإعداد | أنت | نحن، عبر صلاحيات الوصول إلى موقعك |

النسخة مفتوحة المصدر هي المحرك كاملًا.
أما النسخة المستضافة فهي لمن يريد النتيجة دون تشغيل أي شيء بنفسه.

## يعمل مع

Claude Code (دعم كامل: الوكلاء، المهارات، الأوامر، مسارات العمل، خادم MCP) · Codex (المهارات، الأوامر كموجّهات، `AGENTS.md`) · أي وكيل يقرأ `AGENTS.md` وAgent Skills.

## المساهمة

نرحّب بالوكلاء والمهارات والأوامر ومصادر المعرفة الجديدة؛ راجع [CONTRIBUTING.md](../../CONTRIBUTING.md).
كل تغيير يحافظ على نجاح `npm test`.

## الترخيص

MIT لكل ما كتبه Whalyom. أما المهارات المضمّنة من أطراف ثالثة فتحتفظ بتراخيصها الخاصة: [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

</div>
