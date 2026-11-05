// The local Command Center streams the growth docs (sequences, lead scores, attribution, AI visibility,
// integrations) copied from state/ through a whitelist, serves the PWA files and puts the PWA tags in <head>.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testEnv } from './_env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stateDir = path.join(root, 'state');
const NAMES = ['sequences', 'leadscores', 'attribution', 'aivisibility', 'integrations'];
const env = testEnv(Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(META_|RESEND_|OM_WEBHOOK_|OM_SITE_REPO|STRIPE_|OM_KILL)/.test(k))));

test('server streams the growth docs without personal data and serves the installable app', async () => {
  // A planted source with personal data and unknown fields; only created when the real file is absent.
  const seqFile = path.join(stateDir, 'sequences.json');
  const planted = !fs.existsSync(seqFile);
  if (planted) fs.writeFileSync(seqFile, JSON.stringify({ updated_at: '2026-11-04T10:00:00.000Z', sequences: [{ product: 'zz-demo', sequence: 'welcome jane@example.com', active: 2, waiting_approval: 1, completed: 0, stopped: 1, expired: 0, proposed: 3, sent: 1, stop_reasons: { reply: 1, 'x@y.io': 4 }, lead: 'L-123', email: 'jane@example.com', phone: '+44 7700 900123' }], leads: [{ id: 'L-123', email: 'jane@example.com' }] }));
  const port = 5000 + (process.pid % 90);
  const srv = spawn(process.execPath, [path.join(root, 'tools', 'server.mjs'), '--port', String(port)], { cwd: root, env });
  try {
    await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('server did not start')), 20000); srv.stdout.on('data', (d) => { if (String(d).includes('localhost')) { clearTimeout(t); resolve(); } }); });
    const base = `http://127.0.0.1:${port}`;
    const html = await (await fetch(base + '/')).text();
    const head = html.slice(0, html.indexOf('</head>'));
    assert.match(head, /<link rel="manifest" href="\/manifest\.webmanifest">/, 'manifest link is in <head>');
    assert.match(head, /<meta name="theme-color"/);
    assert.match(html, /serviceWorker\.register\('\/sw\.js'/);
    assert.match(html, /id="growthPane"/);
    const man = await fetch(base + '/manifest.webmanifest');
    assert.equal(man.status, 200); assert.match(man.headers.get('content-type'), /manifest\+json/);
    assert.equal((await man.json()).display, 'standalone');
    const sw = await fetch(base + '/sw.js');
    assert.equal(sw.status, 200); assert.equal(sw.headers.get('service-worker-allowed'), '/');
    assert.equal((await fetch(base + '/icon-192.png')).headers.get('content-type'), 'image/png');
    assert.equal((await fetch(base + '/constructor')).status, 404, 'no prototype keys as routes');

    const ctrl = new AbortController();
    const res = await fetch(base + '/stream', { signal: ctrl.signal });
    // One streaming decoder (multibyte characters can straddle chunks) and only complete lines are parsed:
    // a large doc can arrive across several chunks, so the trailing partial line waits for the next read.
    const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = ''; const docs = {};
    const seen = () => NAMES.every((n) => `live/${n}` in docs);
    const deadline = Date.now() + 10000;
    while (!seen() && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      for (const l of lines) if (l.startsWith('data: ')) { const d = JSON.parse(l.slice(6)); docs[d.path] = d.data; }
    }
    ctrl.abort();
    for (const n of NAMES) assert.ok(`live/${n}` in docs, `streams live/${n}`);
    const seq = docs['live/sequences'];
    if (planted) {
      assert.equal(seq.source, 'ok');
      const r = seq.sequences[0];
      assert.equal(r.active, 2); assert.equal(r.waiting_approval, 1); assert.deepEqual(r.stop_reasons, { reply: 1 });
      assert.equal(r.sequence, 'welcome [redacted]');
      assert.equal(seq.updated_at, '2026-11-04T10:00:00.000Z');
    }
    for (const n of NAMES) {
      const text = JSON.stringify(docs[`live/${n}`]);
      assert.doesNotMatch(text, /@[a-z0-9-]+\.[a-z]/i, `no email in live/${n}`);
      assert.doesNotMatch(text, /L-123|7700 900123|"leads":\[\{|"email":|"phone":|"lead":/, `no lead ids or contact fields in live/${n}`);
    }
    assert.ok(['ok', 'missing'].includes(docs['live/integrations'].source));
  } finally {
    srv.kill();
    if (planted) {
      fs.rmSync(seqFile, { force: true });
      // Rebuild the copy from the (now missing) source so no planted counts stay behind.
      fs.writeFileSync(path.join(stateDir, 'live-sequences.json'), JSON.stringify({ updated_at: null, sequences: [], source: 'missing' }));
    }
  }
});
