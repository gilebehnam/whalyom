<div dir="rtl">

<p align="center"><img src="assets/brand/hero.svg" alt="والیوم" width="100%"></p>

<p align="center"><a href="README.md">English</a> · <b>فارسی</b> · <a href="docs/ar/README.md">العربية</a> · <a href="docs/tr/README.md">Türkçe</a> · <a href="docs/es/README.md">Español</a> · <a href="docs/de/README.md">Deutsch</a> · <a href="docs/fr/README.md">Français</a> · <a href="docs/zh-CN/README.md">简体中文</a> · <a href="docs/ja/README.md">日本語</a> · <a href="docs/pt-BR/README.md">Português (Brasil)</a></p>

<p align="center"><a href="https://whalyom.com/open-source?lang=fa">وب‌سایت</a> · <a href="STORY.md">داستان</a> · <a href="docs/COMMANDS.md">دستورها</a> · <a href="rules/README.md">قانون‌ها</a></p>

# والیوم

**یه دپارتمان کامل بازاریابی، توی Claude Code خودتون. رایگان.**

یه چیز خوب ساختین.
بعد فهمیدین ساختنش قسمت آسونش بود.

والیوم به Claude Code یه دپارتمان بازاریابی می‌ده.
۵۳۶ ایجنت هوش مصنوعی، تو ۲۸ دپارتمان.
هر کدوم یه سرپرست داره، یه کار مشخص و یه بسته مهارت.

پیدا می‌کنن کی به شما نیاز داره.
می‌نویسن بهش چی بگین.
هر مشتری رو تا خرید دنبال می‌کنن.
و از هر چی جواب داد یاد می‌گیرن.

تا شما تصمیم نگیرین، هیچی بیرون نمی‌ره.

## عددها

| | |
|---|---:|
| ایجنت هوش مصنوعی | **۵۳۶** |
| دپارتمان، تو ۶ لایه | **۲۸** |
| مهارت | **۴۹۸** |
| دستور آماده | **۱۰۶** |
| قانون، که هر کدوم تو کد اجرا می‌شه | **۵۰** |
| گردش‌کار چندایجنتی | **۲۲** |
| فکت تأییدشده‌ی پایگاه دانش، از ۴۶ منبع رسمی و پژوهشی، تو ۲۸ موضوع | **۱٬۱۵۲** |

همه‌ی این عددها رو `npm run stats` از روی خود فایل‌ها می‌شمره.

## نصب در یه دقیقه

به‌عنوان پلاگین Claude Code:

<div dir="ltr">

```bash
claude plugin marketplace add gilebehnam/whalyom
claude plugin install whalyom@whalyom
```

</div>

یا کل موتور، با مرکز فرماندهی محلی:

<div dir="ltr">

```bash
git clone https://github.com/gilebehnam/whalyom.git whalyom
cd whalyom
./install.sh
claude
```

</div>

روی ویندوز، توی PowerShell و داخل همون پوشه:

<div dir="ltr">

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
claude
```

</div>

بعد توی Claude Code:

<div dir="ltr">

```text
/whalyom-new my-shop myshop.com
/whalyom-onboard my-shop
/autopilot my-shop
```

</div>

<div dir="rtl">

## پرسش‌های رایج

**والیوم رایگانه؟**
بله. همین مخزن کل موتوره، با مجوز MIT، و روی اشتراک Claude Code یا Codex خودتون اجرا می‌شه. والیوم کلاد نسخه‌ی پولی و میزبانی‌شده‌ست.

**بدون اجازه‌ی من ایمیل می‌فرسته یا پول خرج می‌کنه؟**
نه. تا شما تأیید نکنین هیچی بیرون نمی‌ره، و خرج هم از سقفی که تعیین کردین بالاتر نمی‌ره. هر دو قانون‌هایی هستن که توی کد اجرا می‌شن.

**برای سئو و جستجوی هوش مصنوعی چی کار می‌کنه؟**
<span dir="ltr">`/seo-sprint`</span> خوشه‌ی کلمات کلیدی، بریف، مقاله، اسکیما، لینک داخلی و ایندکس رو می‌سازه. <span dir="ltr">`/ai-search`</span> متن‌های قابل استناد و <span dir="ltr">`llms.txt`</span> می‌نویسه.

## محصول‌های دیگه‌ی والیا

والیوم رو **[والیا](https://github.com/whalya-studio)** ساخته، یه ونچر استودیوی محصول‌محور.

- **[والوری](https://github.com/gilebehnam/whalory)**: هوش مصنوعی‌ای که الان استفاده می‌کنین رو مثل یه کپی‌رایتر حرفه‌ای به نوشتن وادار می‌کنه، به فارسی و انگلیسی.
- **[والیون](https://github.com/gilebehnam/whalyon)**: چکاپ سلامت کسب‌وکار؛ ۴۰ جمله، ۸ حوزه، یه کارنامه که ریشه‌ی مشکل رو پیدا می‌کنه.

</div>

## رایگان یا میزبانی‌شده

| | والیوم (همین مخزن) | والیوم کلاد |
|---|---|---|
| قیمت | رایگان، MIT | پولی، برای هر سایت |
| کجا اجرا می‌شه | Claude Code یا Codex خودتون | سرورهای ما، شبانه‌روزی |
| ایجنت‌ها، مهارت‌ها، دستورها، قانون‌ها، دانش | همه | همه |
| مرکز فرماندهی | روی سیستم خودتون | آنلاین، روی هر دستگاهی، فارسی و انگلیسی |
| راه‌اندازی | با خودتون | با ما |

## سازنده

والیوم رو **[بهنام جعفری](https://behnaam.com)** ساخته، بنیان‌گذار ونچر استودیوی والیا (والیوم، والوری، والیون)، تهران.

ایمیل: [bjafaribox@gmail.com](mailto:bjafaribox@gmail.com) · تلفن: <span dir="ltr">+98 912 464 75 35</span> · [تلگرام](https://t.me/gilebehnam) · [لینکدین](https://www.linkedin.com/in/behnamjafari) · [اینستاگرام](https://www.instagram.com/gilebehnam/) · [ایکس](https://x.com/gilebehnam) · [رزرو تماس ۳۰ دقیقه‌ای](https://calendly.com/bjafaribox/30min)

</div>
