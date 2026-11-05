// The live Command Center page (live/index.html) without three.js: its inline scripts run in a vm
// sandbox with a small DOM stub and a fake claude.ai db, so the owner paths (approvals, tabs, status,
// lists, the Vault dialog) are checked the way a blocked CDN or a GPU-less laptop would run them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { root } from '../lib/env.mjs';

const html = fs.readFileSync(path.join(root, 'live', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const readFixture = (name, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(root, 'state', name), 'utf8')); } catch { return fallback; } };
const NYK = readFixture('live-nyk.json', { items: [
  { product: 'demo', level: 'approval', title: 'Publish the launch post', id: 'ap-1' },
  { product: 'demo', level: 'decision', title: 'Pick a domain', id: 'dec-1', kind: 'owner-decision' },
  { product: 'demo', level: 'info', title: 'A note' },
] });
const STATE = readFixture('live-state.json', { mode: 'running', run: null, phase: null, product: null, note: null, counts: { active: 3, todo: 51 } });
const flush = () => new Promise((r) => setImmediate(r));

// ── a DOM just big enough for the page ──
// Anything the page only draws with (canvas contexts) is an inert proxy that accepts every call.
const inert = () => new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : typeof k === 'symbol' || k === 'then' ? undefined : inert()),
  set: () => true, apply: () => inert(), construct: () => inert(),
});
class El {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.className = ''; this.hidden = false; this.disabled = false;
    this.style = { setProperty() {} }; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.open = false; this.value = '';
    this.parentNode = null; this.parentElement = null; this.offsetWidth = 0; this.clientWidth = 0; this.clientHeight = 0; this.offsetParent = null; this.isConnected = true;
  }
  get classList() {
    const get = () => new Set(this.className.split(/\s+/).filter(Boolean)), put = (s) => { this.className = [...s].join(' '); };
    return {
      add: (...c) => { const s = get(); c.forEach((x) => s.add(x)); put(s); },
      remove: (...c) => { const s = get(); c.forEach((x) => s.delete(x)); put(s); },
      toggle: (c, f) => { const s = get(); const on = f === undefined ? !s.has(c) : !!f; if (on) s.add(c); else s.delete(c); put(s); return on; },
      contains: (c) => get().has(c),
    };
  }
  get textContent() { return this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); }
  set textContent(v) { this.children = v == null || v === '' ? [] : [String(v)]; }
  get childElementCount() { return this.elements.length; }
  get elements() { return this.children.filter((c) => typeof c !== 'string'); }
  get firstChild() { return this.children[0] || null; }
  get firstElementChild() { return this.elements[0] || null; }
  append(...n) { for (const c of n) { if (typeof c !== 'string') { c.parentNode = c.parentElement = this; } this.children.push(typeof c === 'string' ? c : c); } }
  replaceChildren(...n) { this.children = []; this.append(...n); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  async fire(type, ev = {}) {
    const e = { target: this, preventDefault() {}, ...ev };
    if (type === 'click' && this.onclick) await this.onclick(e);
    for (const fn of this.listeners[type] || []) await fn(e);
  }
  getBoundingClientRect() { return { left: 100, top: 100, right: 500, bottom: 500, width: 400, height: 400 }; }
  getContext() { return inert(); }
  focus() {} select() {} setPointerCapture() {} reset() {}
  showModal() { this.open = true; } close() { this.open = false; }
  all(pred) { const out = []; const walk = (n) => { for (const c of n.elements) { if (pred(c)) out.push(c); walk(c); } }; walk(this); return out; }
}

const boot = async ({ db, extra = {} } = {}) => {
  const ids = new Map(), body = new El('body');
  const byId = (id) => { if (!ids.has(id)) { const e = new El('div', id); e.parentElement = body; ids.set(id, e); } return ids.get(id); };
  // the markup's own empty states, so the page starts where a browser would
  for (const [id, cls, text] of [['feed', 'none', 'x'], ['feedM', 'none', 'x'], ['pods', 'none', 'x'], ['podsM', 'none', 'x']]) { const n = new El(id.startsWith('feed') ? 'li' : 'div'); n.className = cls; n.textContent = text; byId(id).append(n); }
  const docEl = new El('html'), win = new EventTarget(), errors = [];
  for (const id of ['actPane', 'trPane', 'sitesPane', 'funnelPane', 'feedPane', 'deptPane']) byId(id).hidden = true;
  const sandbox = {
    console: { log() {}, warn() {}, error: (...a) => errors.push(a) },
    document: {
      getElementById: byId, createElement: (t) => new El(t), createElementNS: (ns, t) => new El(t),
      documentElement: docEl, head: new El('head'), body, hidden: false, activeElement: null,
      addEventListener() {}, querySelectorAll: () => [],
    },
    location: { hostname: 'claude.ai' }, navigator: {},
    matchMedia: (q) => ({ matches: q.includes('reduce'), addEventListener() {} }),
    localStorage: { getItem: () => null, setItem() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    MutationObserver: class { observe() {} }, ResizeObserver: class { observe() {} },
    requestAnimationFrame: () => 1, setTimeout: () => 0, setInterval: () => 0, clearTimeout() {},
    performance, CustomEvent, Node: El,
    addEventListener: win.addEventListener.bind(win), dispatchEvent: win.dispatchEvent.bind(win),
    claude: { use: async (name) => (name === 'db' ? db : null) },
  };
  Object.assign(sandbox, extra);
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const s of scripts) vm.runInContext(s, ctx);
  await flush(); await flush();
  return { $: byId, ctx, errors, win: sandbox };
};

// A fake claude.ai db: every watched document replays its fixture; emit() pushes a later snapshot.
const fakeDb = (docs, set = async () => {}) => {
  const subs = new Map();
  return {
    writes: [],
    doc: (p) => ({ onSnapshot: (fn) => { subs.set(p, fn); if (docs[p]) fn({ data: () => docs[p] }); } }),
    collection: (name) => ({ doc: (id) => ({ set: (data) => set(data, name, id) }) }),
    emit: (p, d) => subs.get(p)?.({ data: () => d }),
  };
};
const notes = ($) => $('nykPane').elements.filter((n) => n.className.split(' ').includes('note'));
const buttons = ($, label) => $('nykPane').all((n) => n.tagName === 'BUTTON' && n.textContent === label);

// ── 1. no three.js: the owner paths still run ──

test('without three.js the needs-you-know pane, the approve buttons and the tabs still work', async () => {
  const db = fakeDb({ 'live/nyk': NYK, 'live/state': STATE });
  const { $, errors } = await boot({ db });
  assert.equal(errors.length, 0, JSON.stringify(errors));
  const items = NYK.items.filter(Boolean);
  const actionable = items.filter((i) => i.level === 'approval' || i.level === 'decision' || i.kind === 'owner-decision');
  assert.equal(notes($).length, actionable.length + Math.min(40, items.length - actionable.length));
  const decidable = actionable.filter((i) => i.id && i.product).length;
  assert.ok(decidable > 0, 'the fixture has something to approve');
  assert.equal(buttons($, 'Approve').length + buttons($, 'Yes').length + buttons($, 'Override and approve').length, decidable);
  assert.equal($('trPane').hidden, true);
  await $('tTr').fire('click');
  assert.equal($('trPane').hidden, false);
  assert.equal($('nykPane').hidden, true);
  assert.match($('hintTxt').textContent, /3D view is off/);
});

// ── 2. the Vault dialog always has a way out ──

test('the Vault close button sits outside the form that claude.ai hides', () => {
  const dlg = html.match(/<dialog[^>]*id="vaultDlg"[\s\S]*?<\/dialog>/)[0];
  const form = dlg.match(/<form id="vaultForm">[\s\S]*?<\/form>/)[0];
  assert.match(dlg, /id="vClose"/);
  assert.doesNotMatch(form, /id="vClose"/);
});

test('on claude.ai the Vault dialog opens with a visible close button, and a backdrop tap closes it', async () => {
  const { $ } = await boot({ db: fakeDb({}) });
  await $('vaultBtn').fire('click');
  assert.equal($('vaultDlg').open, true);
  assert.equal($('vaultForm').hidden, true);
  assert.equal($('vClose').hidden, false);
  await $('vClose').fire('click');
  assert.equal($('vaultDlg').open, false);
  await $('vaultBtn').fire('click');
  await $('vaultDlg').fire('click', { clientX: 300, clientY: 300 }); // on the dialog's own padding
  assert.equal($('vaultDlg').open, true);
  await $('vaultDlg').fire('click', { clientX: 10, clientY: 10 }); // on the backdrop
  assert.equal($('vaultDlg').open, false);
});

// ── 3. a failed write can be retried, and only a refusal says "owner only" ──

const approvalNyk = { items: [{ product: 'demo', level: 'approval', title: 'Publish the launch post', id: 'ap-1' }] };
test('a failed approval write leaves the buttons usable and says to try again', async () => {
  let calls = 0;
  const db = fakeDb({ 'live/nyk': approvalNyk }, async () => { if (calls++ === 0) throw new Error('HTTP 500'); });
  const { $ } = await boot({ db });
  await buttons($, 'Approve')[0].onclick(); await flush();
  const [ok] = buttons($, 'Approve'), [no] = buttons($, 'Reject');
  assert.equal(ok.disabled, false); assert.equal(no.disabled, false);
  assert.doesNotMatch($('nykPane').textContent, /Only the owner/);
  assert.match($('nykPane').textContent, /Could not send it/);
  await ok.onclick(); await flush();
  assert.match($('nykPane').textContent, /Sent\. Whalyom will act on it/);
  assert.equal(buttons($, 'Approve').length, 0);
});

test('a permission refusal still says only the owner can decide', async () => {
  const db = fakeDb({ 'live/nyk': approvalNyk }, async () => { throw Object.assign(new Error('HTTP 403'), { code: 'not_granted' }); });
  const { $ } = await boot({ db });
  await buttons($, 'Approve')[0].onclick(); await flush();
  assert.match($('nykPane').textContent, /Only the owner can decide this/);
});

// ── 4. a lost connection or a long silence is not "Live, at rest" ──

test('an idle state three days old shows as stale, and the hub link status is followed', async () => {
  const old = new Date(Date.now() - 3 * 86400e3).toISOString();
  const { $, win } = await boot({ db: fakeDb({ 'live/state': { mode: 'idle', updated_at: old, counts: { products: 1 } } }) });
  assert.notEqual($('statusText').textContent, 'Live, at rest');
  assert.ok($('status').classList.contains('stale'));
  win.dispatchEvent(new CustomEvent('whalyom-local-status', { detail: 'reconnecting' }));
  assert.equal($('statusText').textContent, 'Reconnecting');
  assert.ok($('status').classList.contains('stale'));
  win.dispatchEvent(new CustomEvent('whalyom-local-status', { detail: 'live' }));
  assert.notEqual($('statusText').textContent, 'Reconnecting');
});

test('a fresh idle state reads as live and at rest', async () => {
  const { $ } = await boot({ db: fakeDb({ 'live/state': { mode: 'idle', updated_at: new Date().toISOString(), counts: {} } }) });
  assert.equal($('statusText').textContent, 'Live, at rest');
  assert.ok(!$('status').classList.contains('stale'));
});

// ── 5. a run without a name still explains itself ──

test('a running state with no run, phase or note still fills the run line', async () => {
  const { $ } = await boot({ db: fakeDb({ 'live/state': { mode: 'running', run: null, phase: null, product: null, note: null, updated_at: new Date().toISOString(), counts: { active: 3, todo: 51 } } }) });
  assert.ok($('run').textContent.trim().length > 0);
  assert.match($('run').textContent, /3 agents active, 51 queued/);
});

// ── 6. the phone tabs are never blank ──

test('the phone Lately and Departments panes start with their empty-state text', () => {
  assert.match(html, /<ol class="tl" id="feedM"><li class="none">/);
  assert.match(html, /<div class="depts" id="podsM"><div class="none">/);
});

test('an empty event list renders one empty row, and clears rows that went stale', async () => {
  const db = fakeDb({ 'live/events': { events: [] } });
  const { $ } = await boot({ db });
  const rows = () => $('feedM').elements;
  assert.equal(rows().length, 1); assert.equal(rows()[0].className, 'none');
  db.emit('live/events', { events: [{ at: new Date().toISOString(), agent: 'om-cmo', kind: 'done', text: 'wrote the plan' }] });
  assert.equal(rows().length, 1); assert.match(rows()[0].className, /\bev\b/);
  db.emit('live/events', { events: [] });
  assert.equal(rows().length, 1); assert.equal(rows()[0].className, 'none');
  assert.equal($('podsM').elements[0].className, 'none');
});

// ── 7. no agent is dropped past the old 640 cap ──

test('a 700-agent roster is counted in full and its 700th agent can be seen working', async () => {
  const mk = (n0, n) => Array.from({ length: n }, (_, i) => ({ name: `om-a${n0 + i}`, title: `Agent ${n0 + i}`, layer: 1 + ((n0 + i) % 6), dept: n0 ? 'Growth' : 'Brand' }));
  const roster = { pods: [{ key: 'a', name: 'Brand', agents: mk(0, 350) }, { key: 'b', name: 'Growth', agents: mk(350, 350) }] };
  const db = fakeDb({ 'live/roster': roster });
  const { $ } = await boot({ db });
  assert.match($('total').textContent, /^700 agents/);
  db.emit('live/agents', { agents: { 'om-a699': { status: 'active', task: 'the last one', at: new Date().toISOString() } } });
  assert.match($('actPane').textContent, /Agent 699/);
  assert.match($('actPane').textContent, /the last one/);
});

// ── 8. Autonomy panel, New agent form, white-label branding ──

test('the Autonomy tab shows automatic, earned and streak "7 of 10" per channel', async () => {
  const db = fakeDb({});
  const { $, errors } = await boot({ db });
  db.emit('live/autonomy', { generated_at: '2026-11-04T10:00:00.000Z', products: [{ slug: 'demo', level: 'supervised', earned_on: true, need: 10, held: false, counts: { level: 1, earned: 1, manual: 1, never: 1 }, rows: [
    { key: 'post|linkedin', mode: 'manual', streak: 7, need: 10, next: 'post|linkedin: 7 of 10', last_break: { reason: 'rejected', at: '2026-11-01T09:00:00.000Z' }, held: false },
    { key: 'post|x', mode: 'earned', streak: 12, need: 10, next: null, last_break: null, held: false },
    { key: 'report|internal', mode: 'level', streak: 0, need: 10, next: null, last_break: null, held: false },
    { key: 'spend|meta', mode: 'never', streak: 0, need: 10, next: null, last_break: null, held: false },
  ] }] });
  const t = $('autoPane').textContent;
  assert.match(t, /post · linkedin7 of 10/);
  assert.match(t, /last break: rejected \(2026-11-01\)/);
  assert.match(t, /post · xearned/);
  assert.match(t, /report · internalautomatic/);
  assert.match(t, /spend · metaalways asks/);
  assert.equal($('autoCount').textContent, '2');
  $('tAuto').onclick();
  assert.equal($('autoPane').hidden, false); assert.equal($('nykPane').hidden, true);
  assert.equal(errors.length, 0, JSON.stringify(errors));
});

test('on claude.ai the New agent form explains it is local-only and sends nothing', async () => {
  const calls = [];
  const { $ } = await boot({ db: fakeDb({}), extra: { fetch: async (...a) => { calls.push(a); return { ok: false, status: 404, json: async () => ({}) }; } } });
  await $('newAgent').onclick();
  assert.equal($('agDlg').open, true);
  assert.equal($('agForm').hidden, true);
  assert.match($('agWhere').textContent, /local Command Center/);
  assert.equal(calls.length, 0, 'no request without the local owner page');
});

test('on the local Command Center the New agent form posts a proposal with the owner token and branding applies', async () => {
  const calls = [];
  const Option = function (text, value) { const o = new El('option'); o.textContent = text; o.value = value; return o; };
  const res = (status, body) => ({ ok: status < 300, status, json: async () => body });
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url === '/branding') return res(200, { branding: { name: 'Acme Growth', primary_color: '#1a73e8', logo_url: null } });
    if (url === '/api/agents/options') return res(200, { departments: [{ id: 'lifecycle', name: 'Lifecycle', shippable: true }, { id: 'ailab', name: 'AI Lab', shippable: false }], models: ['sonnet', 'haiku'], tools: ['WebSearch'], skills: ['kj-retention'] });
    if (url === '/api/agents') return res(200, { ok: true, id: 'EVO-build-2026-11-04-churn-radar', agent: 'om-grown-churn-radar', gates: ['red-team has not passed'], shipped: false });
    return res(404, {});
  };
  const { $, ctx } = await boot({ db: fakeDb({}), extra: { fetch, Option, __WHALYOM_LOCAL__: { token: 'a'.repeat(32), port: 4321 } } });
  await flush();
  assert.equal(ctx.document.title, 'Acme Growth Command Center');
  assert.equal(ctx.document.documentElement.dataset.brand, 'white-label');
  await $('newAgent').onclick();
  assert.equal($('agForm').hidden, false);
  assert.equal($('agDept').elements.find((o) => o.value === 'ailab').disabled, true, 'departments evolve.mjs cannot ship are disabled');
  $('agName').value = 'churn-radar'; $('agTitleIn').value = 'Churn Radar'; $('agDoes').value = 'Flags early churn signals weekly from usage exports.';
  $('agDept').value = 'lifecycle'; $('agModel').value = 'haiku'; $('agSkills').value = 'kj-retention, '; $('agOutputs').value = 'research/grown/churn.md'; $('agTools').value = 'WebSearch, WebFetch';
  await $('agForm').onsubmit({ preventDefault() {} });
  const p = calls.find((c) => c.url === '/api/agents');
  assert.equal(p.init.method, 'POST');
  assert.equal(p.init.headers['x-whalyom-token'], 'a'.repeat(32));
  const body = JSON.parse(p.init.body);
  assert.deepEqual(body.skills, ['kj-retention']); assert.deepEqual(body.tools, ['WebSearch', 'WebFetch']);
  assert.equal(body.red_team, undefined);
  assert.match($('agMsg').textContent, /Proposal EVO-build-2026-11-04-churn-radar written for om-grown-churn-radar/);
  assert.match($('agMsg').textContent, /om-red-team/);
});
