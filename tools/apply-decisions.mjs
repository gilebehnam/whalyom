// Applies one-click owner decisions and product launch requests made on the Whalyom Command Center.
// The page writes them to its database (collections "decisions" and "requests"); the session or the
// cloud routine exports those documents to state/inbox-decisions.json as
//   {"decisions": [{product, approval_id, decision: "approve"|"reject", note, at, by, activate?}],
//    "requests":  [{id, kind: "new-product", name, description, url, market, price, mode, budget, currency, at}]}
// and runs this script. Each document is applied once (state/decisions-applied.json remembers ids).
// activate: true on an approve is the owner's go-live (the connector creates it live, not paused/draft).
// Usage: node tools/apply-decisions.mjs [file]
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, root } from './lib/env.mjs';
import { acquireLock, productLockFile } from './lib/lock.mjs';

const file = process.argv[2] ?? path.join(root, 'state', 'inbox-decisions.json');
const inbox = readJson(file, { decisions: [], requests: [] });
const appliedFile = path.join(root, 'state', 'decisions-applied.json');
const applied = new Set(readJson(appliedFile, []));
const out = { decisions: 0, requests: 0, skipped: 0, errors: [] };
const slugOk = (s) => /^[a-z0-9-]+$/.test(String(s ?? ''));

// The applied ids are written in finally, so one bad document never makes the whole pass run again.
try {
for (const d of inbox.decisions ?? []) {
  const key = `d:${d.product}:${d.approval_id}:${d.at}`;
  if (applied.has(key)) { out.skipped++; continue; }
  // Answers to questions in reports/owner-decisions.md (Yes/No buttons in Needs You Know).
  if (d.kind === 'owner-decision') {
    if (!slugOk(d.product) || !/^dec-[a-f0-9]{10}$/.test(String(d.decision_id ?? ''))) { out.errors.push(`bad owner decision ${key}`); continue; }
    const answer = String(d.answer ?? (d.decision === 'approve' ? 'yes' : d.decision === 'reject' ? 'no' : 'done')).slice(0, 200);
    const r = spawnSync(process.execPath, [path.join(root, 'tools', 'needs-you-know.mjs'), 'answer', d.product, d.decision_id, answer], { cwd: root, encoding: 'utf8' });
    if (r.status !== 0) { out.errors.push(`owner decision ${d.decision_id} in ${d.product}: ${String(r.stderr || r.stdout).trim().slice(0, 200)}`); continue; }
    applied.add(key); out.decisions++; continue;
  }
  if (!slugOk(d.product) || !['approve', 'reject'].includes(d.decision)) { out.errors.push(`bad decision ${key}`); continue; }
  const pdir = path.join(root, 'products', d.product);
  const f = path.join(pdir, 'approvals.json');
  // Same per-product lock as apply-results, execute and policy, so none of them overwrites this decision
  // with a stale copy. When it is held the decision is not marked applied and is retried on the next run.
  const release = fs.existsSync(pdir) ? acquireLock(productLockFile(pdir), { waitMs: Number(process.env.OM_EXECUTE_LOCK_WAIT_MS ?? 3000), owner: 'apply-decisions' }) : () => {};
  if (!release) { out.errors.push(`${d.product}: product lock held; decision for ${d.approval_id} retried next run`); continue; }
  try {
    const list = readJson(f, null);
    const ap = Array.isArray(list) ? list.find((a) => a?.id === d.approval_id) : null;
    if (!ap) { out.errors.push(`approval ${d.approval_id} not found in ${d.product}`); continue; }
    if (['executed', 'rejected'].includes(ap.status)) { applied.add(key); out.skipped++; continue; }
    ap.status = d.decision === 'approve' ? 'approved' : 'rejected';
    // An agency client's decision (by "client:<tenant>:<client>", tools/cloud/agency.mjs) is recorded as the
    // client's, never the owner's: it does not count toward earned autonomy and can never set activate.
    const client = typeof d.by === 'string' && /^client:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(d.by) ? d.by : null;
    ap.decided_at = d.at; ap.decided_by = client ?? 'owner (command center)';
    if (d.decision === 'approve' && ap.compliance === 'block') ap.override_review = true;
    // Going live (ENABLED/published instead of PAUSED/draft) needs the owner's explicit flag on the decision;
    // an agent's activate_requested alone never sets it.
    if (d.decision === 'approve' && d.activate === true && !client) { ap.activate = true; ap.activated_by = 'owner (command center)'; }
    if (d.note) ap.owner_note = String(d.note).slice(0, 500);
    writeJson(f, list);
    fs.appendFileSync(path.join(pdir, 'events.jsonl'), JSON.stringify({ at: d.at, agent: 'owner', product: d.product, kind: 'approval', text: `Owner ${d.decision === 'approve' ? 'approved' : 'rejected'}: ${ap.title}` }) + '\n');
    applied.add(key); out.decisions++;
  } finally { release(); }
}

for (const r of inbox.requests ?? []) {
  const key = `r:${r.id}`;
  if (applied.has(key) || r.kind !== 'new-product') { out.skipped++; continue; }
  const slug = String(r.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  if (!slug || !r.description) { out.errors.push(`request ${r.id} needs a name and a description`); continue; }
  if (fs.existsSync(path.join(root, 'products', slug))) { applied.add(key); out.skipped++; continue; }
  // A value such as 'http://' passes the scheme check but is not a URL; report it instead of crashing the pass.
  let host;
  if (r.url && /^https?:\/\//.test(r.url)) { try { host = new URL(r.url).hostname; } catch {} if (!host) { out.errors.push(`request ${r.id}: invalid url`); continue; } }
  const briefFile = path.join(root, 'state', `brief-${slug}.md`);
  fs.writeFileSync(briefFile, [`# Brief: ${r.name}`, '', `Requested from the Command Center on ${r.at}.`, '', `**What it is:** ${r.description}`, r.url ? `**URL:** ${r.url}` : '', r.market ? `**Target market:** ${r.market}` : '', r.price ? `**Price point:** ${r.price}` : '', `**Mode:** ${r.mode ?? 'free'}${r.budget ? `, budget ${r.budget} ${r.currency ?? 'USD'} per month` : ''}`, '', 'Claims: only what is stated above is verified.'].filter(Boolean).join('\n') + '\n');
  const args = [path.join(root, 'tools', 'new-product.mjs'), slug, '--name', String(r.name), '--brief-file', briefFile];
  if (host) args.push('--domain', host);
  if ((r.mode === 'paid' || r.mode === 'hybrid') && Number(r.budget) > 0) args.push('--budget', String(Number(r.budget)), '--currency', ['USD', 'EUR', 'GBP'].includes(r.currency) ? r.currency : 'USD');
  try {
    execFileSync(process.execPath, args, { encoding: 'utf8' });
    const pf = path.join(root, 'products', slug, 'product.json');
    const p = readJson(pf, {});
    p.budget.mode = r.mode === 'hybrid' ? 'hybrid' : (r.mode === 'paid' ? 'paid' : 'free');
    p.stage = 'onboarding';
    writeJson(pf, p);
    fs.rmSync(briefFile, { force: true });
    applied.add(key); out.requests++;
  } catch (e) { out.errors.push(`request ${r.id}: ${e.message}`); }
}
} finally {
  writeJson(appliedFile, [...applied].slice(-5000));
}
console.log(JSON.stringify(out));
