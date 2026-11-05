// Pulls every attached site's satellite from the owner's computer: health, new events (page views,
// leads, conversions with UTM source, CTA clicks, form submits, web vitals) and turns them into metrics,
// leads and status.
//   node tools/sync-sites.mjs              → state/live-sites.json (site status for the Command Center)
//   node tools/sync-sites.mjs --only <slug> → refresh one site and merge it into state/live-sites.json
// Per product: metrics/inbox/satellite-<ts>.json (daily rows per channel, cumulative per day so a later
// sync never lowers a day's count), leads.jsonl, connection.json last_sync / vitals / verification.
// Consented lead details (email, name, phone, message) come from the satellite's separate leads log
// (signed /_whalyom/leads) and are merged into products/<slug>/leads.jsonl. Only leads submitted with consent: true
// carry them. Note: products/ is not gitignored, so do not commit leads.jsonl to a public repo.
// Browser-reported conversions and checkouts are recorded as client_conversions / client_revenue (value
// capped per event): anyone can send a beacon, so they never feed budget allocation, learning or revenue
// milestones. Real revenue comes from Stripe or another server-side source (tools/metrics.mjs).
// Cursor: metrics/satellite-totals.json holds {cursor: {at, keys}, rows} and is written in one step, so a
// crash can never count a batch twice; events in the same millisecond as the cursor are re-read and the
// ones already counted (by eid) are skipped.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadEnv, readJson, writeJson, root } from './lib/env.mjs';
import { satellite, secretEnvName } from './lib/satellite-client.mjs';
import { edgeSource } from './cloud/edge.mjs';

loadEnv();
const only = (() => { const i = process.argv.indexOf('--only'); return i > -1 ? process.argv[i + 1] : null; })();
const productsDir = path.join(root, 'products');
const sites = [];
const MAX_CLIENT_VALUE = 100000;
const p75 = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(s.length * 0.75) - 1)]; };
const channelOf = (e) => e.utm?.source || (e.ref ? (() => { try { return new URL(e.ref).hostname.replace(/^www\./, ''); } catch { return 'referral'; } })() : 'direct');
// Identity of an event or lead for the same-millisecond cursor check.
const idOf = (e) => String(e.eid ?? e.lead_id ?? crypto.createHash('sha1').update(JSON.stringify(e)).digest('hex').slice(0, 16));
// Ask for everything from one millisecond before the cursor, so events stamped in the cursor's own
// millisecond (but not in the last batch) are not skipped by the source's `at > since` filter.
const before = (at) => { const t = Date.parse(at); return at && Number.isFinite(t) ? new Date(t - 1).toISOString() : (at ?? ''); };
// Keeps what the cursor has not seen yet and returns the next cursor.
// A cursor without keys (written before keys existed) counted its whole millisecond already.
const advance = (list, cursor) => {
  const legacy = cursor.keys == null;
  const seen = new Set(cursor.keys ?? []);
  const fresh = list.filter((e) => e && typeof e.at === 'string' && !(cursor.at && e.at < cursor.at) && !(e.at === cursor.at && (legacy || seen.has(idOf(e)))));
  if (!fresh.length) return { fresh, cursor };
  const at = fresh.reduce((m, e) => (e.at > m ? e.at : m), '');
  const keys = [...(at === cursor.at ? seen : []), ...fresh.filter((e) => e.at === at).map(idOf)];
  return { fresh, cursor: { at, keys: [...new Set(keys)].slice(-2000) } };
};
const atomicWrite = (f, v) => { const tmp = `${f}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v, null, 2)); fs.renameSync(tmp, f); };

for (const slug of fs.readdirSync(productsDir).filter((s) => !s.startsWith('_') && (!only || s === only))) {
  const dir = path.join(productsDir, slug);
  const conn = readJson(path.join(dir, 'connection.json'), null);
  if (!conn) continue;
  // A site installed with the one-line snippet after onboarding from the Command Center (no --edge) has
  // edge events but no edge flag: treat it as edge-connected and remember that.
  if (!conn.edge && fs.existsSync(path.join(dir, 'edge', 'events.jsonl'))) { conn.edge = true; conn.edge_detected_at = new Date().toISOString(); }
  const status = { product: slug, domain: conn.domain, repo: Boolean(conn.repo), framework: conn.framework ?? null, stack: conn.stack ?? null, satellite: conn.satellite ?? null, state: 'repo-only', checked_at: new Date().toISOString() };
  if (conn.verification) status.verification = { status: conn.verification.status, score: conn.verification.score, checked_at: conn.verification.checked_at, url: conn.verification.url, failed: conn.verification.failed ?? [], warnings: conn.verification.warnings ?? [] };
  const secret = process.env[secretEnvName(slug)];
  if ((conn.satellite && secret) || conn.edge) {
    try {
      // Edge-hosted sites (one-line snippet → this hub's edge) are read from products/<slug>/edge/ directly.
      const sat = conn.edge && !(conn.satellite && secret) ? edgeSource(dir) : satellite(conn.satellite, secret, { prefix: conn.prefix ?? '/_whalyom' });
      const h = await sat.health();
      // Totals and the event cursor live in one file (new format {cursor, rows}; the old flat map of rows
      // with the cursor in connection.json is still read).
      const totalsFile = path.join(dir, 'metrics', 'satellite-totals.json');
      const stored = readJson(totalsFile, {});
      const v2 = stored && typeof stored.rows === 'object' && stored.rows && !Array.isArray(stored.rows);
      const totals = v2 ? stored.rows : (stored ?? {});
      const cursor0 = v2 && stored.cursor ? stored.cursor : { at: conn.last_event ?? '', keys: conn.last_event_keys ?? null };
      const got = await sat.events(before(cursor0.at));
      const { fresh: events, cursor } = advance(got.events ?? [], cursor0);
      const until = cursor.at;
      // Consented lead details live in their own log; endpoints without it (WordPress, edge, old satellites) answer 404.
      // The lead cursor moves only once the details are in leads.jsonl (below): if a write fails, the
      // next sync asks for the same leads again instead of skipping past them.
      let leadLog = [];
      let nextLeadCursor = null;
      try {
        const lc0 = { at: conn.last_lead ?? '', keys: conn.last_lead_keys ?? null };
        const r = await sat.leads(before(lc0.at));
        const { fresh, cursor: lc } = advance(r.leads ?? [], lc0);
        leadLog = fresh;
        if (lc.at) nextLeadCursor = lc;
      } catch (e) { if (e.status !== 404) throw e; }
      const byLeadId = new Map(leadLog.filter((l) => l.lead_id && l.contact).map((l) => [l.lead_id, l]));
      Object.assign(status, { state: 'connected', version: h.version, kind: h.kind ?? 'satellite', writes: h.writes, events_total: h.events, new_events: events.length });
      if (events.length || byLeadId.size) {
        const rows = {};
        const leads = [];
        const vit = { lcp: [], cls: [], inp: [] };
        for (const e of events) {
          if (!e || typeof e.at !== 'string') continue;
          const date = e.at.slice(0, 10); const ch = channelOf(e);
          const add = (metric, v = 1) => { const k = `${date}|${ch}|${e.utm?.campaign ?? ''}|${metric}`; rows[k] = (rows[k] ?? 0) + v; };
          if (e.type === 'pageview') add('sessions');
          if (e.type === 'lead' || e.type === 'signup') {
            add('leads');
            const lead = { at: e.at, channel: ch, campaign: e.utm?.campaign ?? '', path: e.path, form: e.form ?? '' };
            const logged = e.lead_id ? byLeadId.get(e.lead_id) : null;
            const contact = e.contact ?? logged?.contact;
            if (logged) byLeadId.delete(e.lead_id);
            if (e.lead_id || e.eid) lead.lead_id = e.lead_id ?? e.eid;
            if (contact) Object.assign(lead, { consent: true, contact, ...(e.bot_hint || logged?.bot_hint ? { bot_hint: e.bot_hint ?? logged.bot_hint } : {}) });
            leads.push(lead);
          }
          // Browser-reported, unverified: kept apart from server-side conversions and revenue.
          if (e.type === 'conversion' || e.type === 'checkout') {
            add('client_conversions');
            const v = Number(e.value);
            if (Number.isFinite(v) && v > 0) add('client_revenue', Math.min(v, MAX_CLIENT_VALUE));
          }
          if (e.type === 'cta') add('cta_clicks');
          if (e.type === 'form_submit') add('form_submits');
          if (e.type === 'outbound') add('outbound_clicks');
          if (e.type === 'scroll' && e.depth >= 75) add('deep_scrolls');
          if (e.type === 'vitals') for (const k of ['lcp', 'cls', 'inp']) if (Number.isFinite(e[k])) vit[k].push(e[k]);
        }
        // Cumulative per day+channel+campaign+metric: metrics.mjs keeps the newest value for a key.
        for (const [k, v] of Object.entries(rows)) totals[k] = Math.round(((totals[k] ?? 0) + v) * 100) / 100;
        const cutoff = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
        for (const k of Object.keys(totals)) if (k.slice(0, 10) < cutoff) delete totals[k];
        fs.mkdirSync(path.join(dir, 'metrics', 'inbox'), { recursive: true });
        // The inbox file carries cumulative values, so writing it again after a crash is harmless; the
        // totals and the cursor then move together in one write.
        if (Object.keys(rows).length) writeJson(path.join(dir, 'metrics', 'inbox', `satellite-${Date.now()}.json`), Object.keys(rows).map((k) => { const [date, channel, campaign, metric] = k.split('|'); return { date, channel, ...(campaign ? { campaign } : {}), metric, value: totals[k], source: 'satellite' }; }));
        atomicWrite(totalsFile, { version: 2, cursor, rows: totals });
        // Lead details whose event arrived in an earlier sync still get recorded.
        for (const l of byLeadId.values()) leads.push({ at: l.at, channel: l.utm?.source || 'direct', campaign: l.utm?.campaign ?? '', path: l.path, form: l.form ?? '', lead_id: l.lead_id, consent: true, contact: l.contact });
        if (leads.length) fs.appendFileSync(path.join(dir, 'leads.jsonl'), leads.map((l) => JSON.stringify(l)).join('\n') + '\n');
        const notable = events.filter((e) => ['lead', 'signup', 'conversion', 'checkout'].includes(e?.type)).slice(-50);
        if (notable.length) fs.appendFileSync(path.join(dir, 'events.jsonl'), notable.map((e) => JSON.stringify({ at: e.at, agent: 'satellite', product: slug, kind: e.type === 'lead' || e.type === 'signup' ? 'lead' : 'sale', text: `${e.type} from ${e.utm?.source || 'direct'} on ${e.path}${e.type === 'conversion' || e.type === 'checkout' ? ' (browser-reported)' : ''}` })).join('\n') + '\n');
        if (vit.lcp.length || vit.cls.length || vit.inp.length) {
          conn.vitals = { at: until, samples: Math.max(vit.lcp.length, vit.cls.length, vit.inp.length), lcp_p75_ms: p75(vit.lcp), cls_p75: p75(vit.cls), inp_p75_ms: p75(vit.inp) };
        }
        // Mirror of the cursor for status displays; satellite-totals.json is the one that counts.
        if (events.length) { conn.last_event = until; conn.last_event_keys = cursor.keys; }
      }
      if (nextLeadCursor) { conn.last_lead = nextLeadCursor.at; conn.last_lead_keys = nextLeadCursor.keys; }
      if (conn.vitals) status.vitals = conn.vitals;
      conn.last_sync = status.checked_at; conn.last_error = null;
    } catch (e) { status.state = 'unreachable'; status.error = String(e.message ?? e); conn.last_error = status.error; }
    writeJson(path.join(dir, 'connection.json'), conn);
  } else if (conn.satellite) { status.state = 'no-secret'; }
  else if (!conn.repo) status.state = 'awaiting-install';
  sites.push(status);
}
fs.mkdirSync(path.join(root, 'state'), { recursive: true });
const stateFile = path.join(root, 'state', 'live-sites.json');
let all = sites;
if (only) { const prev = readJson(stateFile, { sites: [] }); all = [...(prev.sites ?? []).filter((s) => s.product !== only), ...sites]; }
writeJson(stateFile, { updated_at: new Date().toISOString(), sites: all });
console.log(JSON.stringify({ sites: all.length, connected: all.filter((s) => s.state === 'connected').length, sites_status: all.map((s) => `${s.domain}:${s.state}`) }));
