/*! Whalyom tracker 1.1.0 | first-party, cookieless | https://whalyom */
(function(w,d){'use strict';
if(w.whalyom&&w.whalyom._v)return;
var C=w.WHALYOM_CONFIG||{},s=d.currentScript;
if(!s||!s.getAttribute){var ss=d.getElementsByTagName('script');for(var i=0;i<ss.length;i++){if(/whalyom(\.min)?\.js/.test(ss[i].src||'')){s=ss[i];break}}}
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
 if(cta!==null||/(^|\s)(cta|btn-cta|button-cta)(\s|$)/.test(el.className||''))send('cta',{label:(cta||el.textContent||'').replace(/\s+/g,' ').trim().slice(0,80)});
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
