/*! Whalyom boosters 1.0.0 | owner-approved on-site changes */
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
function closeBtn(onclose,fg){var x=el('button','background:none;border:0;color:'+fg+';font-size:20px;line-height:1;cursor:pointer;padding:4px 8px','\u00d7');x.setAttribute('aria-label','Close');x.onclick=onclose;return x}
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
