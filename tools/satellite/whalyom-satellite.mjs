#!/usr/bin/env node
// Whalyom Satellite — the small agent that lives on a product's own server (e.g. example.test).
// One file, zero dependencies, Node 18+. The Whalyom hub on the owner's computer connects to it;
// it never calls out. It gives the hub full knowledge of the site and, when allowed, the power
// to change it:
//   GET  /whalyom.js                 first-party, cookieless tracking snippet (page views, scroll depth,
//                                    CTA/outbound clicks, form submits, leads, conversions, UTMs, web vitals)
//   POST /collect                    beacon endpoint for that snippet (public, rate-limited, de-duplicated,
//                                    honeypot-filtered, optional Origin allow-list)
//   GET  /_whalyom/health            signed: version, site root, write permission, event counts, server time
//   GET  /_whalyom/files?path=       signed: list a folder or read a file inside the site root
//   GET  /_whalyom/events?since=     signed: collected events after a timestamp (never contains personal fields)
//   GET  /_whalyom/leads?since=      signed: consented lead details (email, name, phone, message) from .whalyom/leads.jsonl
//   POST /_whalyom/apply             signed: write a file (only with --allow-writes); the old version is backed up
// Signed (v2) = headers x-whalyom-ts, x-whalyom-nonce and
//   x-whalyom-sig = HMAC-SHA256(secret, ts + "\n" + nonce + "\n" + METHOD + "\n" + path+query + "\n" + body).
// Legacy v1 (no nonce) = HMAC-SHA256(secret, ts + "\n" + METHOD + "\n" + path+query + "\n" + body); refused with --strict.
// Every signed request is accepted once (replay cache over the timestamp window). Signed 200 responses carry
//   x-whalyom-resp-sig = HMAC-SHA256(secret, "resp\n" + nonce + "\n" + status + "\n" + body) so the hub can tell
// it is talking to its own satellite.
// Secrets, .git, node_modules, .env files, keys, CMS credential files (wp-config.php, configuration.php,
// settings.php, env.php, config.inc.php, LocalSettings.php), database dumps and the satellite's own .whalyom folder are never
// readable or writable; symlinks that leave the site root are refused.
//
// Run:  node whalyom-satellite.mjs --root /var/www/site --secret <hex> [--port 4610] [--host 127.0.0.1]
//         [--allow-writes] [--strict] [--trust-proxy] [--origins https://example.test,https://www.example.test]
//         [--max-body 5000000] [--max-skew 300]
// The secret can also come from the WHALYOM_SECRET environment variable (preferred: it stays out of `ps`).
// Put it behind the site's HTTPS reverse proxy (route /_whalyom, /collect and /whalyom.js to this port).
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const VERSION = '1.1.0';
export const SIG_VERSIONS = [1, 2];

// ---------------------------------------------------------------------------------------------
// Tracker served at /whalyom.js. ES5 only (it also runs as a GTM Custom HTML tag). Configure with
// data-endpoint / data-site / data-consent on the script tag, or window.WHALYOM_CONFIG before it.
// Cookieless: no cookies, no visitor id; UTMs are kept in sessionStorage for the visit only.
// Respects Do Not Track and Global Privacy Control (no automatic events). With consent "required",
// nothing is sent until whalyom.consent(true) (or window.whalyomConsent = true).
// Copies of this exact text live in integrations/snippet/whalyom.js and the WordPress plugin; a test
// keeps them identical (regenerate with: node tools/satellite/sync-tracker.mjs).
export const TRACKER_JS = `/*! Whalyom tracker 1.1.0 | first-party, cookieless | https://whalyom */
(function(w,d){'use strict';
if(w.whalyom&&w.whalyom._v)return;
var C=w.WHALYOM_CONFIG||{},s=d.currentScript;
if(!s||!s.getAttribute){var ss=d.getElementsByTagName('script');for(var i=0;i<ss.length;i++){if(/whalyom(\\.min)?\\.js/.test(ss[i].src||'')){s=ss[i];break}}}
function A(k){try{return s&&s.getAttribute?s.getAttribute('data-'+k):null}catch(_){return null}}
var origin=location.origin||(location.protocol+'//'+location.host);
var ep=C.endpoint||A('endpoint');
if(!ep){try{ep=(s&&s.src?new URL(s.src,location.href).origin:origin)+'/collect'}catch(_){ep=origin+'/collect'}}
var site=C.site||A('site')||'';
var needConsent=(C.consent||A('consent'))==='required';
var nav=w.navigator||{};
var optout=(C.respectDnt!==false&&A('respect-dnt')!=='false')&&(nav.doNotTrack==='1'||w.doNotTrack==='1'||nav.msDoNotTrack==='1'||nav.globalPrivacyControl===true);
var consent=!needConsent||w.whalyomConsent===true,queue=[];
function rid(){try{var a=new Uint8Array(12);(w.crypto||w.msCrypto).getRandomValues(a);var o='';for(var i=0;i<a.length;i++)o+=('0'+a[i].toString(16)).slice(-2);return o}catch(_){return(Date.now().toString(36)+Math.random().toString(36).slice(2,12))}}
function q(k){try{return new URLSearchParams(location.search).get(k)||''}catch(_){return''}}
var u={source:q('utm_source'),medium:q('utm_medium'),campaign:q('utm_campaign'),term:q('utm_term'),content:q('utm_content')};
if(!u.source){if(q('gclid')){u.source='google';u.medium=u.medium||'cpc'}else if(q('fbclid')){u.source='facebook';u.medium=u.medium||'paid-social'}else if(q('msclkid')){u.source='bing';u.medium=u.medium||'cpc'}}
function keepUtm(){try{if(u.source)sessionStorage.setItem('wy_utm',JSON.stringify(u));else{var x=JSON.parse(sessionStorage.getItem('wy_utm')||'null');if(x&&x.source)u=x}}catch(_){}}
function ref(){var r=d.referrer||'';if(!r)return'';try{var x=new URL(r);if(x.host===location.host)return'';return x.origin+x.pathname}catch(_){return''}}
var R=ref();
function post(b){try{if(nav.sendBeacon&&nav.sendBeacon(ep,b))return}catch(_){}try{fetch(ep,{method:'POST',body:b,keepalive:true,mode:'no-cors',credentials:'omit'})}catch(_){}}
function send(t,data,force){
 var priv=optout||!consent;
 if(priv&&!force){if(!optout&&queue.length<30)queue.push([t,data]);return}
 var e={type:t,site:site,eid:rid(),path:location.pathname,ts:Date.now()};
 if(!priv){e.ref=R;e.utm=u}
 if(data)for(var k in data)if(Object.prototype.hasOwnProperty.call(data,k))e[k]=data[k];
 post(JSON.stringify(e))}
function flush(){var x=queue;queue=[];for(var i=0;i<x.length;i++)send(x[i][0],x[i][1])}
function closest(el,sel){while(el&&el.nodeType===1){if(el.matches?el.matches(sel):(el.msMatchesSelector&&el.msMatchesSelector(sel)))return el;el=el.parentNode}return null}
var BAD=/pass|card|cvv|cvc|ssn|iban|account|routing|secret|token/i;
function fields(f){var o={},el=f.elements||[];for(var i=0;i<el.length;i++){var x=el[i],n=(x.name||x.id||'').toLowerCase(),ty=(x.type||'').toLowerCase();
 if(ty==='checkbox'&&((x.hasAttribute&&x.hasAttribute('data-whalyom-consent'))||/(^|[_-])(consent|gdpr|opt-?in|marketing[_-]?opt-?in|whalyom[_-]consent)([_-]|$)/.test(n))){if(x.checked)o.consent=true;continue}if(!n||ty==='password'||ty==='hidden'||ty==='file'||ty==='checkbox'||ty==='radio'||BAD.test(n))continue;var v=String(x.value||'').slice(0,1000);if(!v)continue;
 if(ty==='email'||/e-?mail/.test(n))o.email=v;else if(/first|last|full|^name$|your-name/.test(n))o.name=(o.name?o.name+' ':'')+v;
 else if(/company|organi[sz]ation|business/.test(n))o.company=v;else if(ty==='tel'||/phone|tel/.test(n))o.phone=v;
 else if(ty==='textarea'||x.tagName==='TEXTAREA'||/message|comment|question/.test(n))o.message=v}return o}
var t0=Date.now();
function honeypots(){var fs=d.querySelectorAll?d.querySelectorAll('form[data-whalyom-lead]'):[];for(var i=0;i<fs.length;i++){if(fs[i].querySelector('input[name="_wy_hp"]'))continue;
 var h=d.createElement('input');h.type='text';h.name='_wy_hp';h.tabIndex=-1;h.autocomplete='off';h.setAttribute('aria-hidden','true');h.style.cssText='position:absolute;left:-9999px;width:1px;height:1px;opacity:0';fs[i].appendChild(h)}}
d.addEventListener('submit',function(ev){var f=ev.target;if(!f||!f.getAttribute)return;
 var hp=f.querySelector?f.querySelector('input[name="_wy_hp"]'):null,name=f.getAttribute('data-whalyom-lead');
 if(name!==null){var p=fields(f);p.form=name||f.id||f.getAttribute('name')||'lead';p.hp=hp?hp.value:'';if(Date.now()-t0<1500)p.fast=1;send('lead',p,true)}
 else send('form_submit',{form:(f.id||f.getAttribute('name')||(f.getAttribute('action')||'').split('?')[0]||'form').slice(0,60)})},true);
d.addEventListener('click',function(ev){var el=closest(ev.target,'a,button,[data-whalyom-cta]');if(!el)return;
 var cta=el.getAttribute('data-whalyom-cta');
 if(cta!==null||/(^|\\s)(cta|btn-cta|button-cta)(\\s|$)/.test(el.className||''))send('cta',{label:(cta||el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,80)});
 else if(el.tagName==='A'&&el.href){try{var x=new URL(el.href,location.href);if(/^https?:$/.test(x.protocol)&&x.host!==location.host)send('outbound',{href:x.host})}catch(_){}}},true);
var marks=[25,50,75,90],hit={},ticking=false;
function sc(){ticking=false;var de=d.documentElement,b=d.body||{},h=Math.max(de.scrollHeight,b.scrollHeight||0),y=(w.pageYOffset||de.scrollTop)+w.innerHeight;if(h<=w.innerHeight*1.2)return;
 var p=Math.round(y/h*100);for(var i=0;i<marks.length;i++)if(p>=marks[i]&&!hit[marks[i]]){hit[marks[i]]=1;send('scroll',{depth:marks[i]})}}
w.addEventListener('scroll',function(){if(!ticking){ticking=true;(w.requestAnimationFrame||setTimeout)(sc)}},{passive:true});
var V={},vsent=false;
function po(type,cb,opts){try{var o=new PerformanceObserver(function(l){var es=l.getEntries();for(var i=0;i<es.length;i++)cb(es[i])});var x={type:type,buffered:true};if(opts)for(var k in opts)x[k]=opts[k];o.observe(x)}catch(_){}}
if(w.PerformanceObserver){
 po('largest-contentful-paint',function(e){V.lcp=Math.round(e.startTime)});
 var cs=0,cf=0,cl=0;po('layout-shift',function(e){if(e.hadRecentInput)return;if(cs&&(e.startTime-cl>1000||e.startTime-cf>5000)){cs=0}if(!cs)cf=e.startTime;cs+=e.value;cl=e.startTime;if(!V.cls||cs>V.cls)V.cls=Math.round(cs*1000)/1000});
 po('event',function(e){if(e.interactionId&&(!V.inp||e.duration>V.inp))V.inp=Math.round(e.duration)},{durationThreshold:40})}
function vitals(){if(vsent)return;if(V.lcp===undefined&&V.cls===undefined&&V.inp===undefined)return;vsent=true;send('vitals',{lcp:V.lcp,cls:V.cls||0,inp:V.inp})}
d.addEventListener('visibilitychange',function(){if(d.visibilityState==='hidden')vitals()});w.addEventListener('pagehide',vitals);
var last=location.pathname;function spa(){if(location.pathname!==last){last=location.pathname;hit={};send('pageview')}}
try{var hp=history.pushState;history.pushState=function(){var r=hp.apply(this,arguments);spa();return r};w.addEventListener('popstate',spa)}catch(_){}
var api={_v:'1.1.0',track:function(t,x){send(t,x)},lead:function(x){send('lead',x||{},true)},conversion:function(v,x){var o={value:v};if(x)for(var k in x)o[k]=x[k];send('conversion',o)},
 consent:function(on){consent=!!on;w.whalyomConsent=consent;if(consent){keepUtm();flush()}else queue=[]}};
w.whalyom=api;if(consent&&!optout)keepUtm();
var pq=w.whalyomQ||[];for(var j=0;j<pq.length;j++){try{var c=pq[j];api[c[0]].apply(api,c.slice(1))}catch(_){}}
w.whalyomQ={push:function(c){try{api[c[0]].apply(api,c.slice(1))}catch(_){}}};
if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',honeypots);else honeypots();
if(C.boost!==false&&A('boost')!=='false'&&w.fetch){try{var bx=ep.lastIndexOf('/collect'),bb=bx>-1?ep.slice(0,bx):ep;
 w.fetch(bb+'/boosters?site='+encodeURIComponent(site)+'&host='+encodeURIComponent(location.host),{credentials:'omit'}).then(function(r){return r&&r.ok?r.json():null}).then(function(j){
 if(j&&j.items&&j.items.length){w.WHALYOM_BOOST=j.items;var sc=d.createElement('script');sc.async=true;sc.src=j.script||C.boostScript||bb+'/whalyom-boost.js';(d.head||d.documentElement).appendChild(sc)}})['catch'](function(){})}catch(_){}}
send('pageview')})(window,document);
`;
export const SNIPPET = TRACKER_JS;

// ---------------------------------------------------------------------------------------------
// On-site boosters: small, owner-approved changes the tracker applies in the browser, so a site
// starts converting better the moment Whalyom is installed, without anyone editing the site code.
//   lead-capture  exit-intent or timed box with an email field and a consent checkbox; submits through
//                 the tracker as a consented lead (form "booster-<id>")
//   sticky-cta    a slim bar with one call to action
//   announcement  a top bar with one line and an optional link
//   schema        JSON-LD added to <head> (Organization, WebSite, FAQPage, Product…)
// Only boosters the owner approved are ever served (tools/lib/boosters.mjs filters them); each shows
// at most once per visit, respects Do Not Track / GPC for anything that collects data, can be closed
// with Esc, and reports impressions and clicks as "cta" events labelled "booster:<id>".
// ES5 only. Served at /whalyom-boost.js by the satellite and by the Whalyom edge.
export const BOOST_VERSION = '1.0.0';

export const BOOST_JS = `/*! Whalyom boosters ${BOOST_VERSION} | owner-approved on-site changes */
(function(w,d){'use strict';
if(w.whalyomBoost)return;w.whalyomBoost=true;
var items=w.WHALYOM_BOOST||[],api=w.whalyom||{track:function(){}},nav=w.navigator||{};
var optout=nav.doNotTrack==='1'||w.doNotTrack==='1'||nav.globalPrivacyControl===true;
function seen(id){try{return sessionStorage.getItem('wyb_'+id)==='1'}catch(_){return false}}
function mark(id){try{sessionStorage.setItem('wyb_'+id,'1')}catch(_){}}
function onPath(b){var p=location.pathname,i;if(b.exclude)for(i=0;i<b.exclude.length;i++)if(p.indexOf(b.exclude[i])===0)return false;
 if(!b.include||!b.include.length)return true;for(i=0;i<b.include.length;i++)if(p.indexOf(b.include[i])===0)return true;return false}
function el(tag,css,text){var e=d.createElement(tag);if(css)e.style.cssText=css;if(text)e.appendChild(d.createTextNode(text));return e}
function track(b,what){try{api.track('cta',{label:('booster:'+b.id+':'+what).slice(0,80)})}catch(_){}}
var C={bg:'#111827',fg:'#ffffff',accent:'#2563eb'};
function colors(b){return{bg:b.bg||C.bg,fg:b.fg||C.fg,accent:b.accent||C.accent}}
function link(b,label,url,css){var a=el('a',css,label);a.href=url;a.setAttribute('data-whalyom-cta','booster:'+b.id);a.onclick=function(){track(b,'click')};return a}
function closeBtn(onclose,fg){var x=el('button','background:none;border:0;color:'+fg+';font-size:20px;line-height:1;cursor:pointer;padding:4px 8px','\\u00d7');x.setAttribute('aria-label','Close');x.onclick=onclose;return x}
function bar(b,top){var c=colors(b);var box=el('div','position:fixed;left:0;right:0;'+(top?'top:0':'bottom:0')+';z-index:2147483000;background:'+c.bg+';color:'+c.fg+';font:15px/1.4 system-ui,sans-serif;padding:10px 16px;display:flex;gap:12px;align-items:center;justify-content:center;box-shadow:0 2px 12px rgba(0,0,0,.2)');
 box.setAttribute('role','region');box.setAttribute('aria-label',b.label||'Announcement');box.appendChild(el('span','',b.text||''));
 if(b.url&&b.button)box.appendChild(link(b,b.button,b.url,'background:'+c.accent+';color:#fff;padding:6px 14px;border-radius:6px;text-decoration:none;font-weight:600'));
 else if(b.url)box.appendChild(link(b,b.link_text||'Learn more',b.url,'color:'+c.fg+';text-decoration:underline'));
 box.appendChild(closeBtn(function(){box.parentNode&&box.parentNode.removeChild(box);mark(b.id)},c.fg));d.body.appendChild(box);track(b,'view');mark(b.id)}
function schema(b){try{var s=d.createElement('script');s.type='application/ld+json';s.text=JSON.stringify(b.jsonld);(d.head||d.documentElement).appendChild(s)}catch(_){}}
function leadBox(b){if(optout)return;var c=colors(b),shown=false,last=null;
 function show(){if(shown||seen(b.id))return;shown=true;mark(b.id);last=d.activeElement;
  var wrap=el('div','position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px');
  var card=el('div','background:#fff;color:#111;max-width:420px;width:100%;border-radius:12px;padding:24px;font:15px/1.5 system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.3);position:relative');
  card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');card.setAttribute('aria-label',b.headline||'Stay in touch');
  function close(){wrap.parentNode&&wrap.parentNode.removeChild(wrap);d.removeEventListener('keydown',esc);try{last&&last.focus&&last.focus()}catch(_){}}
  function esc(e){if(e.key==='Escape'||e.keyCode===27)close()}
  var x=closeBtn(close,'#111');x.style.position='absolute';x.style.top='8px';x.style.right='8px';card.appendChild(x);
  card.appendChild(el('h2','margin:0 0 8px;font-size:20px',b.headline||''));if(b.text)card.appendChild(el('p','margin:0 0 16px',b.text));
  var f=el('form','display:flex;flex-direction:column;gap:10px');f.setAttribute('data-whalyom-lead','booster-'+b.id);
  var em=el('input','padding:10px;border:1px solid #ccc;border-radius:6px;font-size:15px');em.type='email';em.name='email';em.required=true;em.placeholder=b.placeholder||'you@example.com';em.setAttribute('aria-label','Email');f.appendChild(em);
  var lab=el('label','display:flex;gap:8px;align-items:flex-start;font-size:13px;color:#444');var cb=el('input','margin-top:3px');cb.type='checkbox';cb.name='consent';cb.required=true;lab.appendChild(cb);
  var ct=el('span','',b.consent_text||'I agree to receive emails. I can unsubscribe at any time.');if(b.privacy_url){ct.appendChild(d.createTextNode(' '));var pa=el('a','color:inherit','Privacy');pa.href=b.privacy_url;pa.target='_blank';pa.rel='noopener';ct.appendChild(pa)}lab.appendChild(ct);f.appendChild(lab);
  var btn=el('button','background:'+c.accent+';color:#fff;border:0;border-radius:6px;padding:11px;font-size:15px;font-weight:600;cursor:pointer',b.button||'Send');btn.type='submit';f.appendChild(btn);
  f.addEventListener('submit',function(e){e.preventDefault();track(b,'submit');card.innerHTML='';card.appendChild(el('p','margin:0;font-size:16px',b.success||'Thanks! Check your inbox.'));setTimeout(close,2500)});
  card.appendChild(f);wrap.appendChild(card);wrap.onclick=function(e){if(e.target===wrap)close()};d.body.appendChild(wrap);d.addEventListener('keydown',esc);try{em.focus()}catch(_){}track(b,'view')}
 if(b.trigger==='delay'||!('onmouseout' in d)){setTimeout(show,Math.max(3,Number(b.delay_s)||20)*1000)}
 else{d.addEventListener('mouseout',function(e){if(!e.relatedTarget&&e.clientY<=0)show()});setTimeout(show,Math.max(10,Number(b.delay_s)||45)*1000)}}
function run(){for(var i=0;i<items.length;i++){var b=items[i];if(!b||!b.id||!onPath(b))continue;
 try{if(b.type==='schema')schema(b);else if(seen(b.id))continue;else if(b.type==='sticky-cta')bar(b,false);else if(b.type==='announcement')bar(b,true);else if(b.type==='lead-capture')leadBox(b)}catch(_){}}}
if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',run);else run()})(window,document);
`;

// Only approved, well-formed boosters are served; every text field is clipped and URLs must be http(s)
// or site-relative, so a bad entry can never inject markup (the runtime uses text nodes only).
export const BOOSTER_TYPES = ['lead-capture', 'sticky-cta', 'announcement', 'schema'];
export function liveBoosters(list, now = Date.now()) {
  const t = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n) : undefined);
  const u = (v) => { const s = t(v, 500); if (!s) return undefined; if (s.startsWith('/') && !s.startsWith('//')) return s; try { const x = new URL(s); return /^https?:$/.test(x.protocol) ? x.href : undefined; } catch { return undefined; } };
  const color = (v) => (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : undefined);
  const paths = (v) => (Array.isArray(v) ? v.map((p) => t(p, 120)).filter((p) => p && p.startsWith('/')).slice(0, 20) : undefined);
  const out = [];
  for (const b of Array.isArray(list) ? list : []) {
    if (!b || b.approved !== true || !BOOSTER_TYPES.includes(b.type) || !/^[A-Za-z0-9_-]{1,40}$/.test(String(b.id ?? ''))) continue;
    if (b.expires_at && Date.parse(b.expires_at) < now) continue;
    const o = { id: b.id, type: b.type, include: paths(b.include), exclude: paths(b.exclude), bg: color(b.bg), fg: color(b.fg), accent: color(b.accent) };
    if (b.type === 'schema') { if (!b.jsonld || typeof b.jsonld !== 'object') continue; const s = JSON.stringify(b.jsonld); if (s.length > 20000) continue; o.jsonld = JSON.parse(s); }
    else {
      Object.assign(o, { text: t(b.text, 280), button: t(b.button, 40), url: u(b.url), link_text: t(b.link_text, 40), label: t(b.label, 60) });
      if (b.type === 'lead-capture') Object.assign(o, { headline: t(b.headline, 90), placeholder: t(b.placeholder, 60), consent_text: t(b.consent_text, 280), privacy_url: u(b.privacy_url), success: t(b.success, 160), trigger: b.trigger === 'delay' ? 'delay' : 'exit', delay_s: Math.min(600, Math.max(3, Number(b.delay_s) || 30)) });
      if (b.type === 'lead-capture' && !o.consent_text) continue;
    }
    for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
    out.push(o);
  }
  return out.slice(0, 10);
}

// ---------------------------------------------------------------------------------------------
// Event normalisation (mirrored in integrations/common/whalyom-core.mjs and the WordPress plugin;
// a test runs the same fixtures through every copy).
export const EVENT_TYPES = ['pageview', 'lead', 'conversion', 'click', 'signup', 'checkout', 'scroll', 'cta', 'form_submit', 'outbound', 'vitals'];
const str = (v, n) => (v === undefined || v === null || typeof v === 'object') ? '' : String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const num = (v, min, max) => { if (v === undefined || v === null || v === '' || typeof v === 'boolean' || typeof v === 'object') return undefined; const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : undefined; };
const cleanUrl = (v) => { const s = str(v, 500); if (!s) return ''; try { const u = new URL(s); return /^https?:$/.test(u.protocol) ? (u.origin + u.pathname).slice(0, 300) : ''; } catch { return ''; } };
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}$/;

export function normalizeEvent(ev, now = new Date()) {
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return { error: 'bad event' };
  const type = str(ev.type, 20);
  if (!EVENT_TYPES.includes(type)) return { error: 'unknown type' };
  if (str(ev.hp, 200)) return { drop: 'honeypot' };
  const utm = { source: str(ev.utm?.source, 80), medium: str(ev.utm?.medium, 80), campaign: str(ev.utm?.campaign, 120) };
  const term = str(ev.utm?.term, 120); const content = str(ev.utm?.content, 120);
  if (term) utm.term = term;
  if (content) utm.content = content;
  const out = { at: now.toISOString(), type, path: str(ev.path, 300).split(/[?#]/)[0], ref: cleanUrl(ev.ref), utm };
  const eid = str(ev.eid, 40); if (/^[A-Za-z0-9_-]{8,40}$/.test(eid)) out.eid = eid;
  const site = str(ev.site, 60); if (site) out.site = site;
  if (['conversion', 'checkout', 'signup', 'lead'].includes(type)) { const v = num(ev.value, 0, 1e9); if (v !== undefined) out.value = v; }
  if (ev.form !== undefined && ev.form !== null && ev.form !== '') out.form = str(ev.form, 60);
  if (type === 'scroll') { const dpt = num(ev.depth, 0, 100); if (dpt === undefined) return { error: 'bad depth' }; out.depth = Math.round(dpt); }
  if (type === 'cta' || type === 'click') { const l = str(ev.label, 80); if (l) out.label = l; }
  if (type === 'outbound') { const h = str(ev.href, 300).replace(/^https?:\/\//, '').split(/[/?#]/)[0].toLowerCase(); if (!/^[a-z0-9.-]+(:\d+)?$/.test(h)) return { error: 'bad href' }; out.href = h; }
  if (type === 'vitals') {
    const lcp = num(ev.lcp, 0, 120000); const cls = num(ev.cls, 0, 100); const inp = num(ev.inp, 0, 120000);
    if (lcp === undefined && cls === undefined && inp === undefined) return { error: 'no vitals' };
    if (lcp !== undefined) out.lcp = Math.round(lcp);
    if (cls !== undefined) out.cls = Math.round(cls * 1000) / 1000;
    if (inp !== undefined) out.inp = Math.round(inp);
  }
  if (type === 'lead' || type === 'signup') {
    // Personal fields are kept only with explicit consent (consent === true); otherwise the lead is counted without them.
    const c = {};
    if (ev.consent === true) {
    const email = str(ev.email, 254).toLowerCase(); if (email && EMAIL.test(email)) c.email = email;
    const name = str(ev.name, 120); if (name) c.name = name;
    const company = str(ev.company, 120); if (company) c.company = company;
    const phone = str(ev.phone, 40).replace(/[^0-9+()\-. ]/g, ''); if (phone.replace(/\D/g, '').length >= 5) c.phone = phone;
    const message = str(ev.message, 1000); if (message) c.message = message;
    }
    if (Object.keys(c).length) { out.contact = c; out.consent = true; }
    if (ev.fast) out.bot_hint = 'fast-submit';
  }
  return { event: out };
}

// ---------------------------------------------------------------------------------------------
// Request signing.
export function sign(secret, ts, method, pathAndQuery, body) {
  return crypto.createHmac('sha256', secret).update(`${ts}\n${method}\n${pathAndQuery}\n${body}`).digest('hex');
}
export function signV2(secret, ts, nonce, method, pathAndQuery, body) {
  return crypto.createHmac('sha256', secret).update(`${ts}\n${nonce}\n${method}\n${pathAndQuery}\n${body}`).digest('hex');
}
export function signResponse(secret, nonce, status, body) {
  return crypto.createHmac('sha256', secret).update(`resp\n${nonce}\n${status}\n${body}`).digest('hex');
}
// Constant-time compare of two hex digests. Never throws (mismatched or non-hex input is just "false").
export function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a.toLowerCase(), 'hex'), Buffer.from(b.toLowerCase(), 'hex'));
}

// Sliding-window counter per key, with bounded memory.
export function rateLimiter(limit, windowMs, maxKeys = 50000) {
  const hits = new Map();
  const fn = (key, now = Date.now()) => {
    const h = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    h.push(now); hits.delete(key); hits.set(key, h);
    if (hits.size > maxKeys) { for (const k of hits.keys()) { hits.delete(k); if (hits.size <= maxKeys * 0.9) break; } }
    return h.length > limit;
  };
  // Already over the limit? (does not count as a hit)
  fn.peek = (key, now = Date.now()) => (hits.get(key) ?? []).filter((t) => now - t < windowMs).length >= limit;
  return fn;
}
// "Seen before?" cache with expiry, bounded memory (oldest entries go first).
export function seenCache(ttlMs, maxKeys = 100000) {
  const seen = new Map();
  return (key, now = Date.now()) => {
    if (seen.size > 1000) for (const [k, exp] of seen) { if (exp > now) break; seen.delete(k); }
    if (seen.has(key) && seen.get(key) > now) return true;
    seen.set(key, now + ttlMs);
    while (seen.size > maxKeys) seen.delete(seen.keys().next().value);
    return false;
  };
}

const BLOCKED = /(^|[\\/])(\.git|\.svn|\.hg|node_modules|\.whalyom|\.ssh|\.aws|\.gnupg)([\\/]|$)|(^|[\\/])\.env(\.|$|[\\/])|\.(pem|key|p12|pfx|crt|kdbx|sqlite3?|db|sql|sql\.gz|dump|bak)$|(^|[\\/])(configuration\.php|settings(\.local)?\.php|env\.php|config\.inc\.php|LocalSettings\.php)$|(^|[\\/])(id_rsa|id_ed25519|credentials[^\\/]*\.json|secrets?|wp-config\.php|\.htpasswd|\.htaccess|\.user\.ini|\.npmrc|\.pypirc|\.netrc)([\\/.]|$)/i;
export const isBlocked = (rel) => BLOCKED.test(rel) || /\0/.test(rel);

// ---------------------------------------------------------------------------------------------
export function createSatellite(options = {}) {
  const ROOT = path.resolve(options.root ?? process.cwd());
  const SECRET = options.secret ?? '';
  const ALLOW_WRITES = Boolean(options.allowWrites);
  const STRICT = Boolean(options.strict);
  const TRUST_PROXY = Boolean(options.trustProxy);
  const ORIGINS = (options.origins ?? []).map((o) => String(o).trim().replace(/\/$/, '').toLowerCase()).filter(Boolean);
  const MAX_BODY = Number(options.maxBody ?? 5e6);
  const MAX_SKEW = Number(options.maxSkewMs ?? 5 * 60 * 1000);
  const COLLECT_LIMIT = Number(options.collectPerMinute ?? 120);
  if (!SECRET || SECRET.length < 32) throw new Error('A --secret of at least 32 characters is required (the hub prints one when you attach the site).');

  const DATA = path.join(ROOT, '.whalyom');
  const EVENTS = path.join(DATA, 'events.jsonl');
  const AUDIT = path.join(DATA, 'audit.jsonl');
  const LEADS = path.join(DATA, 'leads.jsonl');
  fs.mkdirSync(path.join(DATA, 'backups'), { recursive: true });
  let REAL_ROOT; try { REAL_ROOT = fs.realpathSync(ROOT); } catch { REAL_ROOT = ROOT; }

  const audit = (entry) => { try { fs.appendFileSync(AUDIT, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n'); } catch { /* audit must never take the server down */ } };
  const within = (base, p) => p === base || p.startsWith(base + path.sep);
  // The resolved path must stay inside the root, also after following symlinks (for new files: the
  // nearest existing parent), and must not match the blocked list.
  const safePath = (rel) => {
    const raw = String(rel ?? '');
    if (raw.length > 1024 || /\0/.test(raw)) return null;
    const p = path.resolve(ROOT, raw.replace(/^[/\\]+/, ''));
    if (!within(ROOT, p)) return null;
    if (isBlocked(path.relative(ROOT, p))) return null;
    let probe = p;
    while (!fs.existsSync(probe) && probe !== ROOT) probe = path.dirname(probe);
    let real; try { real = fs.realpathSync(probe); } catch { return null; }
    if (!within(REAL_ROOT, real)) return null;
    if (real !== REAL_ROOT && isBlocked(path.relative(REAL_ROOT, real))) return null;
    return p;
  };
  const send = (res, code, obj, headers = {}) => { const body = JSON.stringify(obj); res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers }); res.end(body); return body; };
  const readBody = (req, limit) => new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > limit) { const e = new Error('body too large'); e.status = 413; reject(e); return; }
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { const e = new Error('body too large'); e.status = 413; reject(e); req.pause(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
  const clientIp = (req) => {
    if (TRUST_PROXY) { const xff = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean); if (xff.length) return xff.at(-1); const xr = req.headers['x-real-ip']; if (xr) return String(xr); }
    return req.socket.remoteAddress ?? '';
  };

  const collectLimited = rateLimiter(COLLECT_LIMIT, 60000);
  const leadLimited = rateLimiter(Number(options.leadsPer10Min ?? 5), 10 * 60000);
  const badSigLimited = rateLimiter(Number(options.badSigPerMinute ?? 20), 60000);
  const replay = seenCache(MAX_SKEW * 2 + 60000);
  const dedupe = seenCache(24 * 3600 * 1000, 200000);
  // Remember event ids already on disk so a restart does not re-accept retried beacons.
  try { if (fs.existsSync(EVENTS)) for (const l of fs.readFileSync(EVENTS, 'utf8').trim().split('\n').slice(-5000)) { try { const e = JSON.parse(l); if (e.eid) dedupe(e.eid); } catch { /* skip bad line */ } } } catch { /* ignore */ }
  const readLog = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  const readEvents = () => fs.existsSync(EVENTS) ? fs.readFileSync(EVENTS, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];

  const verify = (req, body) => {
    const tsRaw = String(req.headers['x-whalyom-ts'] ?? '');
    const ts = /^\d{10,16}$/.test(tsRaw) ? Number(tsRaw) : 0;
    const sig = String(req.headers['x-whalyom-sig'] ?? '');
    const nonce = req.headers['x-whalyom-nonce'] === undefined ? null : String(req.headers['x-whalyom-nonce']);
    if (!ts || Math.abs(Date.now() - ts) > MAX_SKEW) return { ok: false, why: 'bad signature' };
    if (nonce === null && STRICT) return { ok: false, why: 'bad signature' };
    if (nonce !== null && !/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) return { ok: false, why: 'bad signature' };
    const want = nonce === null ? sign(SECRET, ts, req.method, req.url, body) : signV2(SECRET, ts, nonce, req.method, req.url, body);
    if (!safeEqualHex(sig, want)) return { ok: false, why: 'bad signature' };
    if (replay(nonce === null ? `v1:${sig}` : `v2:${nonce}`)) return { ok: false, why: 'replayed request' };
    return { ok: true, nonce };
  };
  const corsFor = (req) => {
    const origin = req.headers.origin ? String(req.headers.origin).replace(/\/$/, '').toLowerCase() : '';
    if (!ORIGINS.length) return { allowed: true, headers: { 'access-control-allow-origin': '*' } };
    if (!origin) return { allowed: true, headers: {} };
    if (ORIGINS.includes(origin)) return { allowed: true, headers: { 'access-control-allow-origin': req.headers.origin, vary: 'Origin' } };
    return { allowed: false, headers: { vary: 'Origin' } };
  };

  const server = http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://satellite'); } catch { return send(res, 400, { error: 'bad url' }); }
    const ip = clientIp(req);
    try {
      if (url.pathname === '/whalyom.js') {
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'GET only' });
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' });
        return res.end(req.method === 'HEAD' ? undefined : TRACKER_JS);
      }
      if (url.pathname === '/whalyom-boost.js') {
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'GET only' });
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' });
        return res.end(req.method === 'HEAD' ? undefined : BOOST_JS);
      }
      if (url.pathname === '/boosters') {
        if (req.method !== 'GET') return send(res, 405, { error: 'GET only' });
        let saved = []; try { saved = JSON.parse(fs.readFileSync(path.join(DATA, 'boosters.json'), 'utf8')); } catch { saved = []; }
        return send(res, 200, { items: liveBoosters(saved) }, { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' });
      }
      if (url.pathname === '/collect') {
        const cors = corsFor(req);
        if (req.method === 'OPTIONS') { res.writeHead(cors.allowed ? 204 : 403, { ...cors.headers, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' }); return res.end(); }
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
        if (!cors.allowed) return send(res, 403, { error: 'origin not allowed' }, cors.headers);
        if (collectLimited(ip)) return send(res, 429, { error: 'slow down' }, { ...cors.headers, 'retry-after': '60' });
        const raw = await readBody(req, 8000);
        let ev; try { ev = JSON.parse(raw); } catch { return send(res, 400, { error: 'bad json' }, cors.headers); }
        const r = normalizeEvent(ev);
        if (r.error) return send(res, 400, { error: r.error }, cors.headers);
        if (r.drop) { res.writeHead(204, cors.headers); return res.end(); }
        const clean = r.event;
        if (clean.eid && dedupe(clean.eid)) { res.writeHead(204, cors.headers); return res.end(); }
        if ((clean.type === 'lead' || clean.type === 'signup') && leadLimited(ip)) return send(res, 429, { error: 'too many leads' }, { ...cors.headers, 'retry-after': '600' });
        if (clean.contact) {
          // Consented personal fields go to their own log (signed /_whalyom/leads only); the event keeps a reference.
          const lead_id = clean.eid ?? crypto.randomBytes(8).toString('hex');
          fs.appendFileSync(LEADS, JSON.stringify({ at: clean.at, lead_id, type: clean.type, path: clean.path, form: clean.form ?? '', utm: clean.utm, consent: true, contact: clean.contact, ...(clean.bot_hint ? { bot_hint: clean.bot_hint } : {}) }) + '\n', { mode: 0o600 });
          delete clean.contact; delete clean.consent; clean.lead_id = lead_id; clean.has_contact = true;
        }
        fs.appendFileSync(EVENTS, JSON.stringify(clean) + '\n');
        res.writeHead(204, cors.headers); return res.end();
      }

      if (!url.pathname.startsWith('/_whalyom/')) return send(res, 404, { error: 'not found' });
      if (badSigLimited.peek(ip)) return send(res, 429, { error: 'slow down' });
      const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req, MAX_BODY) : '';
      const v = verify(req, body);
      if (!v.ok) {
        audit({ op: 'denied', path: url.pathname, ip, why: v.why });
        if (badSigLimited(ip)) return send(res, 429, { error: 'slow down', sig_versions: STRICT ? [2] : SIG_VERSIONS }, { 'retry-after': '60' });
        return send(res, 401, { error: v.why, sig_versions: STRICT ? [2] : SIG_VERSIONS });
      }
      const ok = (obj, code = 200) => {
        const bodyOut = JSON.stringify(obj);
        const h = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
        if (v.nonce) h['x-whalyom-resp-sig'] = signResponse(SECRET, v.nonce, code, bodyOut);
        res.writeHead(code, h); res.end(bodyOut);
      };

      if (url.pathname === '/_whalyom/health') {
        const events = readEvents();
        return ok({ ok: true, version: VERSION, kind: 'satellite', root: path.basename(ROOT), writes: ALLOW_WRITES, strict: STRICT, events: events.length, last_event: events.length ? events.at(-1).at : null, leads: readLog(LEADS).length, node: process.version, time: Date.now(), sig_versions: STRICT ? [2] : SIG_VERSIONS, origins: ORIGINS.length });
      }
      if (url.pathname === '/_whalyom/files') {
        const p = safePath(url.searchParams.get('path') ?? '');
        if (!p || !fs.existsSync(p)) return send(res, 404, { error: 'not found or not allowed' });
        const st = fs.statSync(p);
        if (st.isDirectory()) return ok({ type: 'dir', entries: fs.readdirSync(p, { withFileTypes: true }).filter((e) => !isBlocked(path.relative(ROOT, path.join(p, e.name))) && (!e.isSymbolicLink() || safePath(path.relative(ROOT, path.join(p, e.name))))).map((e) => ({ name: e.name, dir: e.isDirectory() })) });
        if (st.size > 2e6) return send(res, 413, { error: 'file over 2 MB' });
        const content = fs.readFileSync(p, 'utf8');
        return ok({ type: 'file', size: st.size, sha: crypto.createHash('sha256').update(content).digest('hex'), content });
      }
      if (url.pathname === '/_whalyom/events') {
        const since = url.searchParams.get('since') ?? '';
        const limit = Math.min(20000, Math.max(1, Number(url.searchParams.get('limit') ?? 20000) || 20000));
        const events = readEvents().filter((e) => e.at > since).slice(0, limit);
        return ok({ events, until: events.at(-1)?.at ?? since });
      }
      if (url.pathname === '/_whalyom/leads') {
        const since = url.searchParams.get('since') ?? '';
        const leads = readLog(LEADS).filter((l) => l.at > since).slice(0, 20000);
        return ok({ leads, until: leads.at(-1)?.at ?? since });
      }
      if (url.pathname === '/_whalyom/boosters' && req.method === 'POST') {
        // Owner-approved boosters from the hub replace the served list (the hub only sends approved ones).
        if (!ALLOW_WRITES) return send(res, 403, { error: 'writes are off on this satellite (start it with --allow-writes)' });
        let payload; try { payload = JSON.parse(body); } catch { return send(res, 400, { error: 'bad json' }); }
        const items = liveBoosters((Array.isArray(payload?.items) ? payload.items : []).map((b) => ({ ...b, approved: true }))).map((b) => ({ ...b, approved: true }));
        fs.writeFileSync(path.join(DATA, 'boosters.json'), JSON.stringify(items));
        audit({ op: 'boosters', count: items.length, ip, reason: String(payload?.reason ?? '').slice(0, 200) });
        return ok({ ok: true, live: items.length });
      }
      if (url.pathname === '/_whalyom/apply' && req.method === 'POST') {
        if (!ALLOW_WRITES) return send(res, 403, { error: 'writes are off on this satellite (start it with --allow-writes)' });
        let payload; try { payload = JSON.parse(body); } catch { return send(res, 400, { error: 'bad json' }); }
        const { path: rel, content, base_sha, reason } = payload ?? {};
        const p = safePath(rel);
        if (!p || p === ROOT || typeof content !== 'string') return send(res, 400, { error: 'path not allowed or no content' });
        let backup = null;
        if (fs.existsSync(p)) {
          if (fs.statSync(p).isDirectory()) return send(res, 400, { error: 'path is a folder' });
          const old = fs.readFileSync(p, 'utf8');
          const sha = crypto.createHash('sha256').update(old).digest('hex');
          if (base_sha && base_sha !== sha) return send(res, 409, { error: 'file changed since it was read', sha });
          backup = path.join(DATA, 'backups', `${Date.now()}-${path.relative(ROOT, p).replace(/[\\/]/g, '__')}`);
          fs.copyFileSync(p, backup);
        }
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, content);
        audit({ op: 'apply', path: path.relative(ROOT, p), bytes: content.length, backup: backup && path.relative(ROOT, backup), reason: String(reason ?? '').slice(0, 200), ip });
        return ok({ ok: true, path: path.relative(ROOT, p), backup: backup && path.relative(ROOT, backup) });
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      if (e.status === 413) { if (!res.headersSent) send(res, 413, { error: 'body too large' }); req.resume(); return; }
      if (!res.headersSent) return send(res, 500, { error: 'internal error' });
    }
  });
  server.headersTimeout = 15000; server.requestTimeout = 30000;
  return server;
}

// ---------------------------------------------------------------------------------------------
const isMain = (() => { try { const norm = (u) => (process.platform === 'win32' ? u.toLowerCase() : u); return Boolean(process.argv[1]) && norm(import.meta.url) === norm(pathToFileURL(fs.realpathSync(process.argv[1])).href); } catch { return false; } })();
if (isMain) {
  const argv = process.argv;
  const arg = (k, d) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : d; };
  const flag = (k, env) => argv.includes(k) || process.env[env] === '1';
  const ROOT = path.resolve(arg('--root', process.env.WHALYOM_SITE_ROOT ?? process.cwd()));
  const PORT = Number(arg('--port', process.env.WHALYOM_PORT ?? 4610));
  const HOST = arg('--host', process.env.WHALYOM_HOST ?? '127.0.0.1');
  const opts = {
    root: ROOT, secret: arg('--secret', process.env.WHALYOM_SECRET ?? ''),
    allowWrites: flag('--allow-writes', 'WHALYOM_ALLOW_WRITES'), strict: flag('--strict', 'WHALYOM_STRICT'), trustProxy: flag('--trust-proxy', 'WHALYOM_TRUST_PROXY'),
    origins: String(arg('--origins', process.env.WHALYOM_ALLOWED_ORIGINS ?? '')).split(',').filter(Boolean),
    maxBody: Number(arg('--max-body', process.env.WHALYOM_MAX_BODY ?? 5e6)), maxSkewMs: Number(arg('--max-skew', process.env.WHALYOM_MAX_SKEW ?? 300)) * 1000,
  };
  let server;
  try { server = createSatellite(opts); } catch (e) { console.error(e.message); process.exit(2); }
  server.listen(PORT, HOST, () => console.log(`Whalyom satellite ${VERSION} on ${HOST}:${PORT} for ${ROOT} (writes ${opts.allowWrites ? 'on' : 'off'}${opts.strict ? ', strict' : ''}${opts.origins.length ? `, ${opts.origins.length} allowed origins` : ''})`));
}
