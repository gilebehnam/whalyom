// Reinforcement learner: scores every campaign / variant / asset on real results and turns the
// scores into rules. Fitness(a) = w1·ROAS + w2·CVR + w3·NetRevenue/(Cost+ε), from metrics/kpis.json
// rows carrying a campaign id (metrics: spend, revenue, conversions, clicks).
// Winners (top quartile, with enough spend) are promoted to LEARNINGS.md and the shared scoreboard;
// losers (bottom quartile) are recorded as patterns to avoid. Never invents data: no rows, no rules.
// Usage: node tools/learn.mjs <slug>
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, root } from './lib/env.mjs';
import { acquireLock } from './lib/lock.mjs';

const slug = process.argv[2];
if (!slug) { console.error('Usage: node tools/learn.mjs <slug>'); process.exit(2); }
const dir = path.join(root, 'products', slug);
const product = readJson(path.join(dir, 'product.json'), {});
const W = { roas: 0.5, cvr: 0.2, net: 0.3, ...(product.learning?.weights ?? {}) };
const minSpend = Number(product.learning?.min_spend ?? 10);
const margin = Number(product.goals?.margin ?? 1);

export function fitness({ spend, revenue, conversions, clicks }, w = W, m = margin) {
  const roas = spend > 0 ? revenue / spend : 0;
  const cvr = clicks > 0 ? conversions / clicks : 0;
  const net = revenue * m - spend;
  return w.roas * roas + w.cvr * cvr * 10 + w.net * (net / (spend + 1));
}

const agg = {};
// Browser-reported numbers (client_* metrics from the site tracker, and older rows the satellite sync
// wrote as conversions/revenue) can be forged by anyone who can send a beacon: never learn from them.
const clientSide = (r) => String(r.metric ?? '').startsWith('client_') || ['satellite', 'edge'].includes(r.source);
for (const r of readJson(path.join(dir, 'metrics', 'kpis.json'), [])) {
  if (!r.campaign || clientSide(r)) continue;
  const k = `${r.channel}|${r.campaign}`;
  const a = (agg[k] ??= { channel: r.channel, campaign: r.campaign, spend: 0, revenue: 0, conversions: 0, clicks: 0 });
  if (a[r.metric] !== undefined) a[r.metric] += Number(r.value || 0);
}
const scored = Object.values(agg).filter((a) => a.spend >= minSpend).map((a) => ({ ...a, fitness: Math.round(fitness(a) * 1000) / 1000 })).sort((x, y) => y.fitness - x.fitness);
const q = Math.max(1, Math.floor(scored.length / 4));
// A winner needs a real (server-side) result; ranking first among campaigns that sold nothing is not a win.
const winners = scored.length >= 2 ? scored.slice(0, q).filter((w) => w.revenue > 0 || w.conversions > 0) : [];
const losers = scored.length >= 2 ? scored.slice(-q).filter((l) => !winners.includes(l)) : [];

const now = new Date().toISOString();
const board = { at: now, weights: W, scored, winners: winners.map((w) => w.campaign), losers: losers.map((l) => l.campaign) };
writeJson(path.join(dir, 'scoreboard.json'), board);

if (winners.length || losers.length) {
  const learn = path.join(dir, 'LEARNINGS.md');
  const existing = fs.existsSync(learn) ? fs.readFileSync(learn, 'utf8') : '# Learnings\n';
  // Dedupe on the exact tagged line, not a substring: a campaign id in prose or inside another id
  // does not count, and a verdict that changed (AVOID, now a WIN) is recorded again.
  const esc = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lastVerdict = (c) => {
    const re = new RegExp(`^- (WIN|AVOID) \\(\\d{4}-\\d{2}-\\d{2}\\): ${esc(c.channel)} ${esc(c.campaign)} —`, 'gm');
    let v = null; for (const m of existing.matchAll(re)) v = m[1];
    return v;
  };
  const lines = [
    ...winners.filter((w) => lastVerdict(w) !== 'WIN').map((w) => `- WIN (${now.slice(0, 10)}): ${w.channel} ${w.campaign} — fitness ${w.fitness}, ROAS ${(w.revenue / w.spend).toFixed(2)}, ${w.conversions} conversions on ${w.spend.toFixed(2)} spend. Do more like this. (scoreboard)`),
    ...losers.filter((l) => lastVerdict(l) !== 'AVOID').map((l) => `- AVOID (${now.slice(0, 10)}): ${l.channel} ${l.campaign} — fitness ${l.fitness}, ${l.conversions} conversions on ${l.spend.toFixed(2)} spend. Change angle or audience before retrying. (scoreboard)`),
  ];
  if (lines.length) fs.appendFileSync(learn, '\n' + lines.join('\n') + '\n');
  // Shared cross-product scoreboard, so other products' planners can see which channels win where.
  const shared = path.join(root, 'playbooks', 'scoreboard.json');
  // Parallel per-product runs (om-portfolio) share this file: re-read and write it under a lock, atomically.
  fs.mkdirSync(path.dirname(shared), { recursive: true });
  const release = acquireLock(path.join(root, 'playbooks', '.scoreboard.lock'), { waitMs: 10000, staleMs: 60 * 1000, owner: `learn:${slug}` });
  if (!release) console.error('learn: shared scoreboard busy, skipped this run (the product scoreboard is written)');
  else {
    try {
      const all = readJson(shared, {});
      all[slug] = { at: now, preset: product.preset ?? null, winners: winners.map(({ channel, campaign, fitness: f }) => ({ channel, campaign, fitness: f })) };
      const tmp = `${shared}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
      fs.renameSync(tmp, shared);
    } finally { release(); }
  }
}
console.log(JSON.stringify({ slug, campaigns: Object.keys(agg).length, scored: scored.length, winners: winners.length, losers: losers.length }));
