// On-site boosters (lead-capture box, sticky CTA, announcement bar, structured data).
// An approved "publish" item with channel "onsite-booster" switches its booster on: the spec in the
// item's file is merged into products/<slug>/boosters.json with approved: true, and the tracker on the
// site loads it on the next page view (from the Whalyom edge, or pushed to the site's satellite).
// Free and local: no keys needed. Only tools/execute.mjs calls it, after the owner approved the item.
import fs from 'node:fs';
import path from 'node:path';
import { liveBoosters } from '../satellite/whalyom-boost.mjs';
import { satellite, secretEnvName } from '../lib/satellite-client.mjs';

const readList = (f) => { try { const v = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(v) ? v : []; } catch { return []; } };

export default {
  name: 'boosters',
  handles: 'type "publish" with channel "onsite-booster" (switches an approved on-site booster on)',
  needs: [],
  accepts: (item) => item.type === 'publish' && item.channel === 'onsite-booster',
  configured: () => true,
  async execute(item, ctx) {
    let spec;
    try { spec = JSON.parse(fs.readFileSync(path.join(ctx.dir, item.file), 'utf8')); } catch (e) { return { ok: false, detail: `cannot read booster spec ${item.file}: ${e.message}` }; }
    const candidate = liveBoosters([{ ...spec, approved: true }]);
    if (!candidate.length) return { ok: false, detail: `booster ${spec.id ?? '?'} is not valid (type, id, consent text or URLs)` };
    if (spec.needs_owner?.length && item.override_needs !== true) return { ok: false, detail: `booster ${spec.id} still needs: ${spec.needs_owner.join(' ')}` };
    const file = path.join(ctx.dir, 'boosters.json');
    const list = readList(file).filter((b) => b.id !== spec.id);
    list.push({ ...spec, approved: true, approved_item: item.id, live_since: ctx.now });
    if (ctx.dryRun) return { ok: true, ref: 'dry-run', detail: `would switch on booster ${spec.id}` };
    fs.writeFileSync(file, JSON.stringify(list, null, 2));
    // Sites with a satellite get the approved list pushed to it; edge-hosted sites read boosters.json directly.
    let pushed = '';
    const conn = (() => { try { return JSON.parse(fs.readFileSync(path.join(ctx.dir, 'connection.json'), 'utf8')); } catch { return null; } })();
    const secret = conn?.satellite ? ctx.env[secretEnvName(ctx.slug)] : null;
    if (conn?.satellite && secret) {
      try { await satellite(conn.satellite, secret, { prefix: conn.prefix ?? '/_whalyom' }).boosters(list.filter((b) => b.approved), `approval ${item.id}`); pushed = ' and pushed to the satellite'; }
      catch (e) { pushed = ` (satellite push failed: ${String(e.message ?? e).slice(0, 120)}; it retries on the next approval)`; }
    }
    return { ok: true, ref: spec.id, detail: `booster ${spec.id} (${spec.type}) is live${pushed}` };
  },
};
