// Local stand-in for the claude.ai runtime, so the Command Center page runs unchanged on localhost.
// Provides window.claude.use('db') with doc(path).onSnapshot / get / set and collection(name).doc(id).set,
// backed by the local Whalyom server: live documents stream over Server-Sent Events, writes are POSTs.
(() => {
  const cfg = window.__WHALYOM_LOCAL__ || {};
  const listeners = new Map(); // docPath -> Set<fn>
  const cache = new Map();
  const snap = (d) => ({ data: () => d, exists: d != null });
  const emit = (p, d) => { cache.set(p, d); for (const fn of listeners.get(p) || []) try { fn(snap(d)); } catch (e) { console.error(e); } };

  const es = new EventSource('/stream');
  es.addEventListener('doc', (ev) => { try { const { path, data } = JSON.parse(ev.data); emit(path, data); } catch (e) { console.error(e); } });
  es.onerror = () => window.dispatchEvent(new CustomEvent('whalyom-local-status', { detail: 'reconnecting' }));
  es.onopen = () => window.dispatchEvent(new CustomEvent('whalyom-local-status', { detail: 'live' }));

  const post = async (url, body) => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-whalyom-token': cfg.token || '' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || `HTTP ${r.status}`); e.code = r.status === 403 ? 'not_granted' : 'error'; throw e; }
    return j;
  };
  const doc = (p) => ({
    onSnapshot(fn) {
      if (!listeners.has(p)) listeners.set(p, new Set());
      listeners.get(p).add(fn);
      if (cache.has(p)) setTimeout(() => fn(snap(cache.get(p))), 0);
      return () => listeners.get(p).delete(fn);
    },
    async get() { return snap(cache.get(p) ?? null); },
    async set(data) { return post('/api/write', { path: p, data }); },
    async update(data) { return post('/api/write', { path: p, data, merge: true }); },
  });
  const db = Object.freeze({ doc, collection: (name) => ({ doc: (id) => doc(`${name}/${id}`) }) });

  // Local-only API for the Connections & Vault drawer.
  window.__whalyomLocal = Object.freeze({
    connectors: () => fetch('/api/connectors').then((r) => r.json()),
    setSecret: (key, value) => post('/api/vault', { key, value }),
    setProduct: (settings) => post('/api/product', settings),
    ignite: (slug) => post('/api/ignite', { slug }),
    install: () => fetch('/api/install').then((r) => r.json()),
    installKey: () => post('/api/install/key', {}),
    auditSite: (domain) => post('/api/install/site', { domain }),
    resolveAlert: (product, key) => post('/api/resolve-alert', { product, key }),
    answerDecision: (product, id, answer) => post('/api/owner-decision', { product, id, answer }),
  });
  window.claude = Object.freeze({ use: async (name) => (name === 'db' ? db : null) });
})();
