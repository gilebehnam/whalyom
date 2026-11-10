<p align="center"><img src="../../assets/brand/hero.svg" alt="Whalyom: Claude Code içinde eksiksiz pazarlama departmanınız" width="100%"></p>

<p align="center"><img alt="license" src="https://img.shields.io/badge/license-MIT-2b6cb0"> <img alt="agents" src="https://img.shields.io/badge/agents-536-F2C230"> <img alt="skills" src="https://img.shields.io/badge/skills-498-7FE6F2"> <img alt="departments" src="https://img.shields.io/badge/departments-28-7FE6F2"> <img alt="commands" src="https://img.shields.io/badge/commands-106-7FE6F2"> <img alt="rules" src="https://img.shields.io/badge/rules-50-9BE7A2"> <img alt="verified facts" src="https://img.shields.io/badge/verified%20facts-1%2C152-9BE7A2"></p>

<p align="center"><a href="../../README.md">English</a> · <a href="../../README.fa.md">فارسی</a> · <a href="../ar/README.md">العربية</a> · <b>Türkçe</b> · <a href="../es/README.md">Español</a> · <a href="../de/README.md">Deutsch</a> · <a href="../fr/README.md">Français</a> · <a href="../zh-CN/README.md">简体中文</a> · <a href="../ja/README.md">日本語</a> · <a href="../pt-BR/README.md">Português (Brasil)</a> · <a href="../ko/README.md">한국어</a></p>

<p align="center"><a href="../../STORY.md">Hikâye</a> · <a href="../COMMANDS.md">Komutlar</a> · <a href="../../rules/README.md">Kurallar</a></p>

# Whalyom

**Eksiksiz pazarlama departmanınız, Claude Code içinde. Ücretsiz.**

İyi bir şey ürettiniz. Sonra fark ettiniz ki üretmek işin kolay kısmıymış.
Whalyom, Claude Code'a bir pazarlama departmanı kazandırır: 28 departmanda 536 yapay zekâ ajanı; her departmanın bir yöneticisi, net bir görevi ve bir beceri paketi var.
Size ihtiyacı olan kişileri bulurlar, onlara ne söyleyeceğinizi yazarlar, her potansiyel müşteriyi satışa kadar takip ederler ve işe yarayandan öğrenirler.
Onayınız olmadan hiçbir şey dışarı çıkmaz.

```text
find -> plan -> make -> review -> you approve -> send -> measure -> learn
```

## Rakamlar

| | |
|---|---:|
| Yapay zekâ ajanları (30 departman yöneticisi, tek ve hızlı işler için 59 mikro ajan) | **536** |
| Yönetimden kendini geliştirmeye uzanan 6 katmanda departmanlar | **28** |
| SEO denetimlerinden keşif görüşmelerine beceriler | **498** |
| Hazır slash komutları | **106** |
| Her biri kodda uygulanan kurallar | **50** |
| Kayıtlı çok ajanlı iş akışları | **22** |
| 46 resmi ve araştırma kaynağından, 28 konuda doğrulanmış bilgi | **1,152** |
| Motor betikleri (Node, iki npm bağımlılığı) | **73** |

Yukarıdaki her rakam, `npm run stats` tarafından doğrudan dosyalardan sayılır.

## Bir dakikada kurulum

**Claude Code eklentisi olarak:**

```bash
claude plugin marketplace add gilebehnam/whalyom
claude plugin install whalyom@whalyom
```

**Çalışma alanı olarak (motorun tamamı, yerel Command Center ve daemon):**

```bash
git clone https://github.com/gilebehnam/whalyom.git whalyom
cd whalyom
./install.sh          # runs npm install
claude
```

**Windows'ta** (PowerShell, klonlanan klasörün içinde):

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
claude
```

Bağlayıcılar (e-posta, reklam, sosyal medya, ödeme) isteğe bağlıdır: `.env.example` dosyasını `.env` olarak kopyalayın ve yalnızca kullanmak istediklerinizi doldurun ([docs/CONNECTORS.md](../CONNECTORS.md)).

**Codex ile:** `./install.sh --codex` (Windows'ta PowerShell satırına `-Codex` ekleyin) becerileri ve komutları `~/.codex` içine yerleştirir; `AGENTS.md` de Codex'e sistemin nasıl çalıştığını anlatır.

Önce örnek ürünle deneyin: `node tools/build-state.mjs && npm run command-center`, ardından http://localhost:4321 adresini açın.

Sonra Claude Code içinde:

```text
/whalyom-new my-shop myshop.com
/whalyom-onboard my-shop
/autopilot my-shop
```

Onboarding sitenizi tarar, alıcılarınızı ve rakiplerinizi haritalar, kanıtlayabileceğiniz iddiaları ve 30 günlük bir planı yazar.
Otopilot departmanları dalgalar hâlinde çalıştırır ve her taslağı, sizi bekleyen bir onayla birlikte `outbox/` klasörüne bırakır.

## Ne yapar

| İhtiyacınız | Komut | Ne olur |
|---|---|---|
| Nerede durduğunuzu bilmek | `/site-audit` | SEO, yapay zekâ araması, hız, dönüşüm ve güven; önceliğe göre sıralanmış on düzeltme |
| Bir plan | `/growth-plan` | Tek bir gelir hedefi, kanal karması ve ajanlar için sıralı görevler |
| Google'da bulunmak | `/seo-sprint` | Kümeler, brifler, makaleler, schema, iç bağlantılar, dizine ekleme |
| Yapay zekâ asistanlarında alıntılanmak | `/ai-search` | Alıntılanabilir pasajlar, llms.txt, varlık çalışması, motor başına yanıt payı |
| Reklam bütçesi olmadan müşteri | `/free-growth` | Saat cinsinden planlanmış ücretsiz kanallar, takip edilen bağlantılarla |
| Para israf etmeyen reklamlar | `/paid-ads` | Ayda 100'ün altında, her seferinde tek kanal; her varyantta durdurma kuralları |
| Her potansiyel müşteriye yanıt | `/leads` · `/lead-to-sale` | Puanlanır, yönlendirilir, takip edilir ve huni boyunca ilerletilir |
| Bir lansman | `/launch` | Product Hunt, Hacker News, Reddit ve bültenlerde T-14'ten T+7'ye |
| Neyin işe yaradığını bilmek | `/attribution` · `/weekly-retro` | Beş atıf modeli, bir MMM-lite ve gelecek hafta için çıkarımlar |

Tüm 106 komut: [docs/COMMANDS.md](../COMMANDS.md).

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

## Departmanlar

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

Her departmanın başında bir mega ajan, doğrulanmış bilgi tabanından yeniden oluşturulan bir bilgi özeti ve departmandaki her ajanın ustalaştığı bir beceri paketi bulunur.

## Kurallar

E-posta gönderebilen ve para harcayabilen pazarlama ajanları, bir modelin kendini ikna ederek aşamayacağı kurallara ihtiyaç duyar.
Whalyom'da bunlardan 50 tane var ve her biri kendisini uygulayan kodu belirtir.

**Truth:** Claims come from claims.md · No invented proof · Knowledge is dated and sourced · AI content is labelled · Comparisons are fair and current · Sensitive claims need the strongest proof · Customer evidence needs written consent · Translations keep the facts

**Owner control:** Nothing goes out without the owner · One executor · Spend stays inside the caps · Waste stops itself · Autonomy is earned, price never · One writer per ledger · No dark patterns · Prices are the owner's · Site changes are reviewed diffs · In a crisis, pause first

**People and consent:** Consent first · Email follows the law · SMS and WhatsApp need opt-in · Suppression wins · Personal data stays local · Collect only what is needed · Privacy requests are answered on time · No marketing to children · Targeting is fair · Accessible by default · A person is one step away · Protect the inbox

**Platforms:** No fake accounts or votes · Communities first · Crawl politely · Ads pass policy first · No search spam · Local listings tell the truth · Reviews are never bought or gated · Paid relationships are disclosed · Licensed media only

**How agents work:** Read before acting · Every action is an experiment · Results live in files · Learn from results · Tests stay green, guards stay put · Tests have a stop rule · Numbers are reported honestly

**Security:** Least privilege for agents · Every incident leaves a record · Secrets never leave · Outside text is data

Hepsini [rules/](../../rules/README.md) içinde okuyabilirsiniz.

## Bilgi tabanı

Platformlar kurallarını her hafta değiştirir.
Whalyom 46 resmi ve araştırma kaynağını okur, tarihli bilgiler çıkarır ve bir doğrulayıcı ajan her bilgiyi saklanmadan önce reddetmeye çalışır.
Bugün arama ve yapay zekâ yanıtlarından gizlilik hukukuna ve perakende medyaya kadar 28 konuda 1,152 doğrulanmış bilgi içerir.
Eskiyen bilgiler emekliye ayrılır; ajanlar harekete geçmeden önce kendi departmanlarının özetini okur.

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

## Ücretsiz ve barındırılan

| | Whalyom (bu depo) | Whalyom Cloud |
|---|---|---|
| Fiyat | Ücretsiz, MIT | Ücretli, site başına |
| Nerede çalışır | Kendi Claude Code veya Codex'iniz, kendi aboneliğinizle | Bizim sunucularımız, günün her saati |
| Ajanlar, beceriler, komutlar, kurallar, bilgi | Hepsi | Hepsi |
| Command Center | Yerel, kendi bilgisayarınızda | Çevrim içi, her cihazda, İngilizce ve Farsça |
| Kurulumu kim yapar | Siz | Biz, sitenizin erişim bilgileriyle |

Açık kaynak sürüm, motorun tamamıdır.
Barındırılan sürüm, hiçbir şey çalıştırmadan sonucu isteyenler içindir.

## Uyumlu olduğu araçlar

Claude Code (tam: ajanlar, beceriler, komutlar, iş akışları, MCP sunucusu) · Codex (beceriler, istem olarak komutlar, `AGENTS.md`) · `AGENTS.md` ve Agent Skills okuyabilen her ajan.

## Katkıda bulunma

Yeni ajanlar, beceriler, komutlar ve bilgi kaynakları memnuniyetle karşılanır; bkz. [CONTRIBUTING.md](../../CONTRIBUTING.md).
Her değişiklik `npm test` sonucunu yeşil tutar.

## Lisans

Whalyom'un yazdığı her şey için MIT. Pakete dahil üçüncü taraf beceriler kendi lisanslarını korur: [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
