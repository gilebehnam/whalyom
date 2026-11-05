// Landing page templates. Each one is a set of design tokens, fonts, layout choices and CSS on top
// of the shared base. No framework, no build step: the CSS is inlined in the page.
// `tokens` drive the contrast check in the tests (text, muted and link on bg/surface, accentInk on accent).

const BASE = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth;scroll-padding-top:84px}
body{margin:0;background:var(--bg);color:var(--text);font:var(--fs-body)/1.6 var(--f-body);text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased}
img,svg{max-width:100%}
a{color:var(--link);text-underline-offset:3px}
h1,h2,h3{font-family:var(--f-head);line-height:1.12;margin:0 0 .5em;text-wrap:balance}
p{margin:0 0 1em;text-wrap:pretty}
:focus-visible{outline:3px solid var(--focus);outline-offset:3px}
.skip{position:absolute;left:-9999px;top:8px;z-index:100;padding:10px 16px;background:var(--accent);color:var(--accent-ink);border-radius:6px}
.skip:focus{left:12px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.wrap{width:min(var(--max),100% - 32px);margin-inline:auto}
.preview-bar{background:var(--ph-bg);color:var(--text);border-bottom:1px dashed var(--ph);font:500 13px/1.4 var(--f-body);text-align:center;padding:8px 16px}
.site-head{position:sticky;top:0;z-index:20;background:var(--head-bg);backdrop-filter:saturate(1.4) blur(10px);-webkit-backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid var(--line)}
.site-head .wrap{display:flex;align-items:center;gap:24px;min-height:64px}
.brand{font:700 19px/1 var(--f-head);color:var(--text);text-decoration:none;letter-spacing:-.01em;margin-right:auto}
.site-nav{display:flex;gap:22px}
.site-nav a{color:var(--muted);text-decoration:none;font-size:15px}
.site-nav a:hover{color:var(--text)}
@media (max-width:760px){.site-nav{display:none}}
@media (max-width:560px){.site-head .head-cta{display:none}}
section.ph-sec{padding:20px 0}
section{padding:var(--sec) 0}
.sec-head{max-width:720px;margin-bottom:40px}
.sec-head.center{margin-inline:auto;text-align:center}
.eyebrow{display:inline-block;font:600 13px/1.3 var(--f-body);letter-spacing:.08em;text-transform:uppercase;color:var(--eyebrow);margin-bottom:14px}
h1{font-size:var(--fs-h1);font-weight:var(--w-h1);letter-spacing:var(--ls-h1)}
h2{font-size:var(--fs-h2);font-weight:var(--w-h2);letter-spacing:var(--ls-h2)}
h3{font-size:1.15rem;font-weight:650}
.lede{font-size:var(--fs-lede);color:var(--muted);max-width:640px}
.muted{color:var(--muted)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 24px;border-radius:var(--radius-btn);font:650 16px/1 var(--f-body);text-decoration:none;cursor:pointer;background:var(--accent);color:var(--accent-ink);border:2px solid var(--accent);transition:transform .15s ease,box-shadow .15s ease,background .15s ease}
.btn:hover{transform:translateY(-1px);box-shadow:var(--btn-shadow)}
.btn.ghost{background:transparent;color:var(--text);border-color:var(--line-strong)}
.btn.small{min-height:40px;padding:0 16px;font-size:14px}
.ctas{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}
.offer{margin-top:16px;font-size:15px;color:var(--muted)}
.grid{display:grid;gap:var(--gap);grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--card-min)),1fr))}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:26px}
.card h3{margin-bottom:.4em}
.card p{margin:0;color:var(--muted)}
.ticks{list-style:none;padding:0;margin:0;display:grid;gap:12px}
.ticks li{position:relative;padding-left:30px}
.ticks li::before{content:"";position:absolute;left:0;top:.45em;width:16px;height:9px;border-left:2.5px solid var(--tick);border-bottom:2.5px solid var(--tick);transform:rotate(-45deg)}
.pains{list-style:none;padding:0;margin:0;display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))}
.pains li{padding:20px 22px;border-left:3px solid var(--pain);background:var(--surface);border-radius:0 var(--radius) var(--radius) 0;color:var(--text)}
.steps{list-style:none;padding:0;margin:0;display:grid;gap:var(--gap);grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));counter-reset:s}
.steps li{counter-increment:s;position:relative;padding-top:56px}
.steps li::before{content:counter(s,decimal-leading-zero);position:absolute;top:0;left:0;font:var(--step-font);color:var(--step)}
.steps p{color:var(--muted);margin:0}
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}
table{width:100%;border-collapse:collapse;min-width:520px;font-size:15px}
th,td{text-align:left;padding:14px 18px;border-bottom:1px solid var(--line);vertical-align:top}
thead th{font-weight:650;background:var(--table-head)}
tbody th{font-weight:550}
tr:last-child th,tr:last-child td{border-bottom:0}
td.us{font-weight:600}
.plans{display:grid;gap:var(--gap);grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));align-items:stretch}
.plan{display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:28px}
.plan.hl{border:2px solid var(--accent);box-shadow:var(--hl-shadow)}
.plan .tag{align-self:flex-start;font:700 12px/1 var(--f-body);letter-spacing:.06em;text-transform:uppercase;background:var(--accent);color:var(--accent-ink);padding:6px 10px;border-radius:999px;margin-bottom:14px}
.plan h3{font-size:1.1rem;margin:0}
.price{font:var(--price-font);margin:14px 0 4px;color:var(--text)}
.price small{font:500 15px var(--f-body);color:var(--muted);margin-left:4px}
.plan .ticks{margin:18px 0 24px;font-size:15px}
.plan .btn{margin-top:auto}
.faq{max-width:780px}
.faq details{border-bottom:1px solid var(--line);padding:4px 0}
.faq summary{cursor:pointer;list-style:none;display:flex;justify-content:space-between;gap:16px;align-items:center;padding:18px 0;font:600 17px/1.4 var(--f-body)}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";font:300 26px/1 var(--f-body);color:var(--muted);transition:transform .2s}
.faq details[open] summary::after{transform:rotate(45deg)}
.faq details p{color:var(--muted);margin:0 0 18px}
.final{text-align:center}
.final .ctas{justify-content:center}
.lead-box{display:grid;gap:40px;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));align-items:start}
.lead-form{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:28px;display:grid;gap:16px}
.field{display:grid;gap:6px}
.field label{font:600 14px/1.3 var(--f-body)}
.field .opt{font-weight:400;color:var(--muted)}
.field input{font:16px/1.4 var(--f-body);color:var(--text);background:var(--input-bg);border:1.5px solid var(--line-strong);border-radius:calc(var(--radius) * .6);padding:12px 14px;min-height:48px;width:100%}
.field input:focus-visible{outline:3px solid var(--focus);outline-offset:1px;border-color:var(--accent)}
.consent{display:grid;grid-template-columns:22px 1fr;gap:10px;align-items:start;font-size:14px;color:var(--muted)}
.consent input{width:20px;height:20px;margin:2px 0 0;accent-color:var(--accent)}
.lead-form .btn{width:100%}
.wy-status{min-height:1.4em;font-size:14px;margin:0}
.wy-note{font-size:13px;color:var(--muted);border-top:1px dashed var(--line-strong);padding-top:12px;margin:0}
.wy-ph{border:2px dashed var(--ph);background:var(--ph-bg);color:var(--text);border-radius:var(--radius);padding:18px 20px;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.wy-ph strong{display:block;margin-bottom:4px;font-family:var(--f-body)}
.site-foot{border-top:1px solid var(--line);padding:36px 0;font-size:14px;color:var(--muted)}
.site-foot .wrap{display:flex;flex-wrap:wrap;gap:16px 28px;align-items:center}
.site-foot a{color:var(--muted)}
.site-foot .brand{font-size:16px;margin-right:auto}
.mock{background:var(--mock-bg);border:1px solid var(--line);border-radius:calc(var(--radius) + 4px);box-shadow:var(--mock-shadow);overflow:hidden}
.mock-bar{display:flex;gap:6px;padding:12px 14px;border-bottom:1px solid var(--line);background:var(--mock-bar)}
.mock-bar i{width:10px;height:10px;border-radius:50%;background:var(--line-strong)}
.mock-body{padding:20px;display:grid;gap:14px}
.mock-row{display:grid;grid-template-columns:110px 1fr;gap:12px;align-items:center;font:600 12.5px/1.2 var(--f-body);color:var(--muted)}
.mock-row b{display:block;height:10px;border-radius:6px;background:var(--skel)}
.mock-row b.s{width:62%}
.mock-pill{justify-self:end;font:650 13px/1 var(--f-body);background:var(--accent);color:var(--accent-ink);padding:10px 16px;border-radius:var(--radius-btn)}
@media (max-width:640px){.mock-row{grid-template-columns:86px 1fr}section{padding:calc(var(--sec) * .7) 0}.ctas .btn{flex:1 1 100%}}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*::before,*::after{animation:none!important;transition:none!important}}
@media print{.site-head,.preview-bar,.lead-form{display:none}}
`;

const font = (families) => `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f}`).join('&')}&display=swap`;

export const TEMPLATES = {
  saas: {
    label: 'Clean SaaS',
    description: 'Bright, precise product marketing: split hero with an app frame, card grids, highlighted plan.',
    fonts: font(['Inter:wght@400;500;600;700;800']),
    tokens: { bg: '#ffffff', surface: '#f8fafc', text: '#0f172a', muted: '#475569', link: '#4338ca', accent: '#4f46e5', accentInk: '#ffffff' },
    hero: 'split', features: 'cards', pricing: 'cards', mock: true,
    css: `:root{--bg:#fff;--surface:#f8fafc;--text:#0f172a;--muted:#475569;--link:#4338ca;--accent:#4f46e5;--accent-ink:#fff;--focus:#4f46e5;--eyebrow:#4338ca;--line:#e2e8f0;--line-strong:#cbd5e1;--head-bg:rgba(255,255,255,.86);--tick:#4f46e5;--pain:#f59e0b;--step:#4f46e5;--table-head:#f1f5f9;--input-bg:#fff;--ph:#d97706;--ph-bg:#fffbeb;--mock-bg:#fff;--mock-bar:#f8fafc;--skel:#e2e8f0;--mock-shadow:0 30px 60px -20px rgba(15,23,42,.25),0 0 0 1px rgba(15,23,42,.04);--btn-shadow:0 8px 20px -8px rgba(79,70,229,.6);--hl-shadow:0 20px 40px -24px rgba(79,70,229,.55);
--f-body:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;--f-head:Inter,system-ui,sans-serif;--fs-body:17px;--fs-h1:clamp(2.4rem,5.2vw,3.9rem);--fs-h2:clamp(1.8rem,3.4vw,2.6rem);--fs-lede:1.2rem;--w-h1:800;--w-h2:750;--ls-h1:-.035em;--ls-h2:-.025em;--max:1160px;--sec:96px;--gap:22px;--card-min:250px;--radius:14px;--radius-btn:10px;--price-font:800 44px/1 Inter,sans-serif;--step-font:800 15px/1 Inter,sans-serif}
.hero{padding:72px 0 88px;background:radial-gradient(900px 420px at 85% -10%,#eef2ff,transparent 70%),radial-gradient(700px 380px at -10% 10%,#f0f9ff,transparent 60%)}
.hero .wrap{display:grid;gap:56px;grid-template-columns:1.05fr .95fr;align-items:center}
@media (max-width:900px){.hero .wrap{grid-template-columns:1fr}}
.steps li::before{width:40px;height:40px;display:grid;place-items:center;border-radius:12px;background:#eef2ff}
.card{transition:border-color .2s,transform .2s}.card:hover{border-color:#c7d2fe;transform:translateY(-2px)}
.final{background:#0f172a;color:#f8fafc}.final .lede{color:#cbd5e1;margin-inline:auto}.final .btn{--accent:#fff;--accent-ink:#0f172a}
#features,#pricing{background:var(--surface)}#features .card,#pricing .plan{background:#fff}`,
  },

  editorial: {
    label: 'Editorial',
    description: 'A magazine feature: serif display type, rules and columns, a pricing table instead of cards.',
    fonts: font(['Fraunces:opsz,wght@9..144,400;9..144,600;9..144,800', 'Public+Sans:wght@400;500;600;700']),
    tokens: { bg: '#f7f3ec', surface: '#fffdf8', text: '#1c1917', muted: '#57534e', link: '#9a3412', accent: '#9a3412', accentInk: '#ffffff' },
    hero: 'editorial', features: 'columns', pricing: 'table', mock: false,
    css: `:root{--bg:#f7f3ec;--surface:#fffdf8;--text:#1c1917;--muted:#57534e;--link:#9a3412;--accent:#9a3412;--accent-ink:#fff;--focus:#9a3412;--eyebrow:#9a3412;--line:#d6cfc4;--line-strong:#a8a29e;--head-bg:rgba(247,243,236,.92);--tick:#9a3412;--pain:#9a3412;--step:#9a3412;--table-head:#efe8dc;--input-bg:#fffdf8;--ph:#b45309;--ph-bg:#fef3c7;--mock-bg:#fff;--mock-bar:#f5f5f4;--skel:#e7e5e4;--mock-shadow:none;--btn-shadow:none;--hl-shadow:none;
--f-body:"Public Sans",system-ui,sans-serif;--f-head:Fraunces,Georgia,"Times New Roman",serif;--fs-body:18px;--fs-h1:clamp(2.7rem,6.4vw,5.2rem);--fs-h2:clamp(2rem,3.8vw,3rem);--fs-lede:1.3rem;--w-h1:600;--w-h2:600;--ls-h1:-.02em;--ls-h2:-.015em;--max:1120px;--sec:88px;--gap:0px;--card-min:240px;--radius:2px;--radius-btn:2px;--price-font:600 38px/1 Fraunces,serif;--step-font:italic 600 34px/1 Fraunces,serif}
.brand{font-family:Fraunces,serif;font-weight:800;font-size:24px;letter-spacing:-.02em}
.hero{padding:56px 0 72px;border-bottom:1px solid var(--text)}
.kicker{display:flex;justify-content:space-between;gap:16px;border-top:3px double var(--text);border-bottom:1px solid var(--text);padding:10px 0;font:600 12px/1.3 var(--f-body);letter-spacing:.14em;text-transform:uppercase;margin-bottom:44px}
.hero h1{max-width:16ch}
.hero .cols{display:grid;grid-template-columns:1.2fr 1fr;gap:48px;margin-top:28px;align-items:start}
@media (max-width:820px){.hero .cols{grid-template-columns:1fr}}
.hero .lede{font-family:Fraunces,serif;font-size:1.45rem;line-height:1.45;color:var(--text)}
.hero .lede::first-letter{float:left;font:800 4.2em/.8 Fraunces,serif;margin:.06em .1em 0 0;color:var(--accent)}
section h2{border-top:1px solid var(--text);padding-top:18px}
.eyebrow{letter-spacing:.16em}
.cols-list{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));border-top:1px solid var(--line)}
.cols-list li{padding:26px 26px 26px 0;border-bottom:1px solid var(--line)}
.cols-list li+li{padding-left:26px;border-left:1px solid var(--line)}
@media (max-width:620px){.cols-list li+li{padding-left:0;border-left:0}}
.cols-list h3{font:600 1.35rem/1.2 Fraunces,serif}.cols-list p{color:var(--muted);margin:0}
.pains li{border-left:0;border-top:1px solid var(--text);border-radius:0;background:none;padding:16px 0;font-family:Fraunces,serif;font-size:1.2rem}
.btn{text-transform:uppercase;letter-spacing:.08em;font-size:14px}
.table-wrap{border-radius:0;border-left:0;border-right:0;background:none}
.final{background:var(--text);color:var(--bg)}.final h2{border-color:var(--bg)}.final .lede{color:#e7e5e4;margin-inline:auto}.final .btn{--accent:#f7f3ec;--accent-ink:#1c1917}
.faq summary{font:600 1.2rem/1.35 Fraunces,serif}`,
  },

  bold: {
    label: 'Bold startup',
    description: 'Loud and confident: oversized grotesk type, thick outlines, hard shadows and a colour bento grid.',
    fonts: font(['Space+Grotesk:wght@400;500;600;700']),
    tokens: { bg: '#fdfcf7', surface: '#ffffff', text: '#111111', muted: '#3f3f46', link: '#111111', accent: '#ff5a36', accentInk: '#111111' },
    hero: 'stack', features: 'bento', pricing: 'cards', mock: false,
    css: `:root{--bg:#fdfcf7;--surface:#fff;--text:#111;--muted:#3f3f46;--link:#111;--accent:#ff5a36;--accent-ink:#111;--focus:#2563eb;--eyebrow:#111;--line:#111;--line-strong:#111;--head-bg:#fdfcf7;--tick:#111;--pain:#ff5a36;--step:#111;--table-head:#ffe9a8;--input-bg:#fff;--ph:#111;--ph-bg:#fff3c4;--mock-bg:#fff;--mock-bar:#fff;--skel:#e4e4e7;--mock-shadow:6px 6px 0 #111;--btn-shadow:4px 4px 0 #111;--hl-shadow:8px 8px 0 #111;
--f-body:"Space Grotesk",system-ui,sans-serif;--f-head:"Space Grotesk",system-ui,sans-serif;--fs-body:18px;--fs-h1:clamp(2.9rem,8.4vw,6.6rem);--fs-h2:clamp(2.1rem,5vw,3.6rem);--fs-lede:1.3rem;--w-h1:700;--w-h2:700;--ls-h1:-.045em;--ls-h2:-.035em;--max:1180px;--sec:96px;--gap:18px;--card-min:260px;--radius:18px;--radius-btn:999px;--price-font:700 52px/1 "Space Grotesk",sans-serif;--step-font:700 18px/1 "Space Grotesk",sans-serif}
.site-head{border-bottom:2px solid #111;backdrop-filter:none}
.hero{padding:64px 0 80px}
.hero h1{line-height:.95;max-width:13ch}
.hero h1 .hl{background:var(--accent);padding:0 .12em;border-radius:.12em;box-decoration-break:clone;-webkit-box-decoration-break:clone}
.hero .lede{color:var(--text);font-size:1.4rem;max-width:34ch}
.btn{border:2px solid #111;box-shadow:4px 4px 0 #111}.btn:hover{transform:translate(-2px,-2px);box-shadow:6px 6px 0 #111}
.btn.ghost{background:#fff}
.marquee{border-block:2px solid #111;background:#111;color:#fdfcf7;overflow:hidden;white-space:nowrap;font:700 15px/1 var(--f-body);letter-spacing:.06em;text-transform:uppercase;padding:14px 0}
.marquee span{display:inline-block;padding-left:100%;animation:mq 26s linear infinite}
@keyframes mq{to{transform:translateX(-100%)}}
.bento{display:grid;gap:18px;grid-template-columns:repeat(6,1fr)}
.bento .card{grid-column:span 2;border:2px solid #111;box-shadow:6px 6px 0 #111}
.bento .card:nth-child(5n+1){grid-column:span 4;background:#c7f0d8}
.bento .card:nth-child(5n+2){background:#ffd6a5}.bento .card:nth-child(5n+3){background:#cdd8ff}.bento .card:nth-child(5n+4){background:#ffe9a8}
.bento .card h3{font-size:1.5rem;letter-spacing:-.02em}.bento .card p{color:#27272a}
@media (max-width:820px){.bento{grid-template-columns:1fr}.bento .card,.bento .card:nth-child(5n+1){grid-column:auto}}
.pains li{border:2px solid #111;border-radius:14px;background:#fff;font-weight:500}
.plan{border:2px solid #111}.plan.hl{background:#ffe9a8}
.steps li::before{width:44px;height:44px;display:grid;place-items:center;border:2px solid #111;border-radius:50%;background:var(--accent)}
.table-wrap{border:2px solid #111}th,td{border-bottom:2px solid #111}
.final{background:var(--accent);border-block:2px solid #111}.final h2{font-size:clamp(2.4rem,6vw,4.4rem)}.final .lede{color:#111;margin-inline:auto}.final .btn{--accent:#111;--accent-ink:#fdfcf7}
.lead-form{border:2px solid #111;box-shadow:8px 8px 0 #111}.field input{border:2px solid #111}
.wy-ph{border-color:#111}`,
  },

  minimal: {
    label: 'Minimal',
    description: 'One narrow column, system fonts, no cards: words first, very fast.',
    fonts: null,
    tokens: { bg: '#ffffff', surface: '#ffffff', text: '#111111', muted: '#555555', link: '#111111', accent: '#111111', accentInk: '#ffffff' },
    hero: 'minimal', features: 'list', pricing: 'table', mock: false,
    css: `:root{--bg:#fff;--surface:#fff;--text:#111;--muted:#555;--link:#111;--accent:#111;--accent-ink:#fff;--focus:#2563eb;--eyebrow:#555;--line:#e5e5e5;--line-strong:#bdbdbd;--head-bg:rgba(255,255,255,.92);--tick:#111;--pain:#111;--step:#999;--table-head:#fafafa;--input-bg:#fff;--ph:#a16207;--ph-bg:#fefce8;--mock-bg:#fff;--mock-bar:#fff;--skel:#eee;--mock-shadow:none;--btn-shadow:none;--hl-shadow:none;
--f-body:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;--f-head:var(--f-body);--fs-body:18px;--fs-h1:clamp(2.1rem,4.6vw,3.1rem);--fs-h2:clamp(1.5rem,2.6vw,1.9rem);--fs-lede:1.2rem;--w-h1:650;--w-h2:650;--ls-h1:-.025em;--ls-h2:-.015em;--max:720px;--sec:72px;--gap:28px;--card-min:200px;--radius:8px;--radius-btn:8px;--price-font:650 30px/1 var(--f-body);--step-font:500 14px/1 ui-monospace,Menlo,Consolas,monospace}
.site-head{position:static;border-bottom:0;backdrop-filter:none}
.site-nav{display:none}
.hero{padding:56px 0 24px}
section{border-top:1px solid var(--line)}
.hero+section{border-top:0}
.sec-head{margin-bottom:24px}
.def{display:grid;gap:22px;margin:0}
.def div{display:grid;grid-template-columns:180px 1fr;gap:20px}
.def dt{font-weight:650}.def dd{margin:0;color:var(--muted)}
@media (max-width:600px){.def div{grid-template-columns:1fr;gap:4px}}
.pains{grid-template-columns:1fr}.pains li{background:none;border-left:2px solid var(--text);border-radius:0;padding:4px 0 4px 18px}
.steps{grid-template-columns:1fr;gap:20px}.steps li{padding:0 0 0 48px}.steps li::before{top:4px}
.btn:hover{transform:none;opacity:.86}
.table-wrap{border:0;border-radius:0}th,td{padding:12px 12px 12px 0}
.lead-box{grid-template-columns:1fr;gap:20px}.lead-form{padding:0;border:0}
.final{text-align:left}.final .ctas{justify-content:flex-start}`,
  },

  product: {
    label: 'Product-led',
    description: 'Shows the product: centred hero over a large app frame, alternating feature rows with UI panels, a timeline.',
    fonts: font(['IBM+Plex+Sans:wght@400;500;600;700', 'IBM+Plex+Mono:wght@500']),
    tokens: { bg: '#f4f5f7', surface: '#ffffff', text: '#121826', muted: '#4b5563', link: '#0f766e', accent: '#0f766e', accentInk: '#ffffff' },
    hero: 'center', features: 'rows', pricing: 'cards', mock: true,
    css: `:root{--bg:#f4f5f7;--surface:#fff;--text:#121826;--muted:#4b5563;--link:#0f766e;--accent:#0f766e;--accent-ink:#fff;--focus:#0f766e;--eyebrow:#0f766e;--line:#e3e6eb;--line-strong:#c4c9d2;--head-bg:rgba(244,245,247,.88);--tick:#0f766e;--pain:#e11d48;--step:#0f766e;--table-head:#f8fafb;--input-bg:#fff;--ph:#b45309;--ph-bg:#fff7ed;--mock-bg:#fff;--mock-bar:#f8fafb;--skel:#e8ebef;--mock-shadow:0 40px 80px -30px rgba(18,24,38,.35),0 0 0 1px rgba(18,24,38,.05);--btn-shadow:0 10px 24px -10px rgba(15,118,110,.7);--hl-shadow:0 24px 48px -28px rgba(15,118,110,.6);
--f-body:"IBM Plex Sans",system-ui,sans-serif;--f-head:"IBM Plex Sans",system-ui,sans-serif;--fs-body:17px;--fs-h1:clamp(2.4rem,5.4vw,4.1rem);--fs-h2:clamp(1.8rem,3.4vw,2.5rem);--fs-lede:1.2rem;--w-h1:700;--w-h2:650;--ls-h1:-.03em;--ls-h2:-.02em;--max:1140px;--sec:92px;--gap:20px;--card-min:250px;--radius:12px;--radius-btn:8px;--price-font:700 42px/1 "IBM Plex Sans",sans-serif;--step-font:500 13px/1 "IBM Plex Mono",monospace}
.eyebrow{font-family:"IBM Plex Mono",monospace;font-weight:500;letter-spacing:.04em;text-transform:none;background:#ccfbf1;color:#115e59;padding:6px 10px;border-radius:6px}
.hero{padding:80px 0 0;text-align:center;background:linear-gradient(#fff,var(--bg))}
.hero .lede{margin-inline:auto}.hero .ctas{justify-content:center}
.hero .mock{max-width:900px;margin:56px auto 0;border-bottom-left-radius:0;border-bottom-right-radius:0;border-bottom:0}
.hero .mock-body{grid-template-columns:1fr 1fr;padding:28px}
@media (max-width:700px){.hero .mock-body{grid-template-columns:1fr}}
.rows{display:grid;gap:22px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:36px}
.row:nth-child(even) .row-ui{order:-1}
.row-ui{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:20px;display:grid;gap:10px}
.row-ui b{display:block;height:10px;border-radius:5px;background:var(--skel)}.row-ui b:nth-child(2){width:70%}.row-ui b:nth-child(3){width:45%;background:#99f6e4}
.row-ui span{font:500 12px/1 "IBM Plex Mono",monospace;color:var(--muted)}
@media (max-width:760px){.row{grid-template-columns:1fr;padding:24px}.row:nth-child(even) .row-ui{order:0}}
.row h3{font-size:1.4rem}.row p{color:var(--muted);margin:0}
.steps{grid-template-columns:1fr;gap:0;max-width:720px}.steps li{padding:0 0 32px 44px;border-left:2px solid var(--line);margin-left:10px}
.steps li::before{left:-11px;top:0;width:20px;height:20px;border-radius:50%;background:var(--accent);content:"";box-shadow:0 0 0 5px #ccfbf1}
.steps h3{margin-top:-2px}
.final{background:#121826;color:#f9fafb}.final .lede{color:#d1d5db;margin-inline:auto}.final .btn{--accent:#5eead4;--accent-ink:#042f2e}`,
  },

  night: {
    label: 'Night',
    description: 'Whalyom Dark-poster: navy-teal night, drifting fog, a pine treeline, thin wide-tracked Jost titles, one yellow accent.',
    fonts: font(['Jost:wght@200;300;400', 'Figtree:wght@300;400;500;600']),
    tokens: { bg: '#071419', surface: '#0b2630', text: '#e8e5de', muted: '#a9b8bc', link: '#f2c230', accent: '#f2c230', accentInk: '#0b1a1f' },
    hero: 'poster', features: 'cards', pricing: 'cards', mock: false,
    css: `:root{color-scheme:dark;--bg:#071419;--surface:#0b2630;--text:#e8e5de;--muted:#a9b8bc;--link:#f2c230;--accent:#f2c230;--accent-ink:#0b1a1f;--focus:#f2c230;--eyebrow:#f2c230;--line:rgba(232,229,222,.18);--line-strong:rgba(232,229,222,.42);--head-bg:rgba(7,20,25,.72);--tick:#f2c230;--pain:#e0563d;--step:#f2c230;--table-head:rgba(11,38,48,.9);--input-bg:rgba(7,20,25,.6);--ph:#f2c230;--ph-bg:rgba(242,194,48,.10);--mock-bg:#0b2630;--mock-bar:#071419;--skel:rgba(232,229,222,.14);--mock-shadow:none;--btn-shadow:0 0 0 6px rgba(242,194,48,.16);--hl-shadow:0 0 0 1px #f2c230,0 30px 60px -30px rgba(242,194,48,.35);
--f-body:Figtree,system-ui,sans-serif;--f-head:Jost,Futura,"Century Gothic",system-ui,sans-serif;--fs-body:17px;--fs-h1:clamp(1.9rem,5vw,4.2rem);--fs-h2:clamp(1.3rem,2.6vw,2rem);--fs-lede:1.15rem;--w-h1:200;--w-h2:300;--ls-h1:.32em;--ls-h2:.28em;--max:1140px;--sec:104px;--gap:20px;--card-min:250px;--radius:2px;--radius-btn:0px;--price-font:200 46px/1 Jost,sans-serif;--step-font:200 30px/1 Jost,sans-serif}
body{background:linear-gradient(180deg,#0a1013 0%,#0b2630 34%,#0a1d24 70%,#060a0c 100%) fixed,#071419}
h1,h2{text-transform:uppercase}
h2{padding-left:.28em}
h3{font:400 1.05rem/1.3 Figtree,sans-serif;letter-spacing:.02em}
.brand{font:300 17px/1 Jost,sans-serif;letter-spacing:.5em;text-transform:uppercase}
.site-nav a{font:400 12px/1 Figtree,sans-serif;letter-spacing:.32em;text-transform:uppercase}
.eyebrow{font:400 12px/1.4 Figtree,sans-serif;letter-spacing:.42em}
.btn{font:500 13px/1 Figtree,sans-serif;letter-spacing:.3em;text-transform:uppercase;padding:0 26px}
.btn.ghost{color:var(--text);border:1px solid var(--line-strong)}
.hero{position:relative;min-height:min(92vh,880px);display:grid;align-items:center;overflow:hidden;padding:96px 0 220px;text-align:center;isolation:isolate}
.hero::before{content:"";position:absolute;inset:0;z-index:-2;background:radial-gradient(60% 45% at 50% 46%,rgba(127,230,242,.16),transparent 70%)}
.fog{position:absolute;inset:auto -20% 0;height:62%;z-index:-1;pointer-events:none;background:radial-gradient(40% 50% at 25% 70%,rgba(143,163,168,.20),transparent 70%),radial-gradient(45% 45% at 75% 60%,rgba(143,163,168,.16),transparent 70%),radial-gradient(60% 40% at 50% 95%,rgba(232,229,222,.10),transparent 70%);filter:blur(6px);animation:drift 38s ease-in-out infinite alternate}
.fog.f2{height:40%;opacity:.8;animation-duration:52s;animation-direction:alternate-reverse}
@keyframes drift{from{transform:translateX(-4%)}to{transform:translateX(4%)}}
.trees{position:absolute;left:0;right:0;bottom:0;width:100%;height:auto;z-index:-1}
.hero h1{padding-left:.32em;margin-inline:auto;max-width:22ch;line-height:1.25}
.hero .lede{margin:26px auto 0;color:var(--muted);font-weight:300;letter-spacing:.02em}
.hero .ctas{justify-content:center}
.hero .offer{letter-spacing:.24em;text-transform:uppercase;font-size:12px}
.rule{position:absolute;top:28px;height:1px;width:clamp(40px,10vw,120px);background:var(--line-strong)}.rule.l{left:40px}.rule.r{right:40px}
.side{position:absolute;font:400 10.5px/1 Figtree,sans-serif;letter-spacing:.42em;text-transform:uppercase;color:var(--muted);white-space:nowrap}
.side.l{left:28px;bottom:30%;transform:rotate(-90deg);transform-origin:left bottom}
.side.r{right:28px;top:22%;transform:rotate(90deg);transform-origin:right top}
@media (max-width:860px){.side,.rule{display:none}.hero{padding-bottom:160px}}
.card,.plan,.lead-form,.table-wrap,.pains li{background:rgba(7,20,25,.55);border:1px solid var(--line);backdrop-filter:blur(2px)}
.card h3{color:var(--text)}
.pains li{border-left:1px solid var(--pain)}
.plan.hl{border:1px solid var(--accent)}
.plan .tag{letter-spacing:.3em;border-radius:0}
.plan h3,.price{font-family:Jost,sans-serif}.plan h3{letter-spacing:.3em;text-transform:uppercase;font-weight:300}
.faq summary{font:400 17px/1.4 Figtree,sans-serif}
.final{position:relative;overflow:hidden}.final h2{font-size:clamp(1.4rem,3.4vw,2.6rem)}.final .lede{margin-inline:auto}
.site-foot{letter-spacing:.06em}`,
  },
};

export const TEMPLATE_NAMES = Object.keys(TEMPLATES);
export const baseCss = () => BASE;

// Pine treeline for the night poster: deterministic, three layers, as one inline SVG.
export function treeline(width = 1440, height = 260) {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const tree = (x, base, h) => {
    const w = h * 0.22; const pts = [[x, base - h]];
    for (let k = 1; k <= 6; k++) { const y = base - h + (h * k) / 6.4, ww = (w * k) / 6; pts.push([x + ww, y], [x + ww * 0.45, y]); }
    pts.push([x + w * 0.1, base], [x - w * 0.1, base]);
    for (let k = 6; k >= 1; k--) { const y = base - h + (h * k) / 6.4, ww = (w * k) / 6; pts.push([x - ww * 0.45, y], [x - ww, y]); }
    return pts.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ');
  };
  const layers = [[height * 0.62, '#0d2129', 0.55], [height * 0.8, '#091820', 0.75], [height, '#05090b', 1]];
  const g = layers.map(([base, col, s]) => {
    const polys = [];
    for (let x = -20; x < width + 40; x += (14 + rnd() * 22) * s * 1.4) {
      const centre = Math.abs(x - width / 2) < width * 0.06;
      polys.push(`<polygon points="${tree(x, base, (centre ? 30 : 50 + rnd() * 90) * s * 1.3)}"/>`);
    }
    return `<g fill="${col}">${polys.join('')}<rect x="0" y="${(base - 1).toFixed(1)}" width="${width}" height="${(height - base + 1).toFixed(1)}"/></g>`;
  }).join('');
  return `<svg class="trees" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">${g}</svg>`;
}
