// Follow-ups the executor records after a connector succeeded. The executor never adds approvals to
// approvals.json itself: a follow-up approval goes into a run file (products/<slug>/runs/<id>.json) that
// tools/apply-results.mjs, the single writer, merges as a new pending approval (compliance unchecked).
//
// writeCreativeFollowup(): the creative connector (tools/creative-gen.mjs) generates an asset from an approved
// brief and hands back a pending "publish" approval draft. The asset only leaves the outbox through that
// approval, so the draft is written as runs/CREATIVE-<creative id>.json. Writing is idempotent: a run file
// for the same creative id (queued or already applied) is never written twice.
import fs from 'node:fs';
import path from 'node:path';

const safe = (s) => String(s ?? '').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
// The roster agents that own generated images and videos (approvals take the run's agent).
export const CREATIVE_AGENTS = { image: 'om-genai-image-director', video: 'om-genai-video-director' };

// dir: products/<slug>; item: the executed "creative" approval; creative: {id, kind?, approval_draft}.
// Returns {file (relative to dir), id} or null when there is nothing to record.
export function writeCreativeFollowup({ dir, item = {}, creative, now = new Date().toISOString() }) {
  const draft = creative?.approval_draft;
  if (!dir || !draft || typeof draft !== 'object' || !creative?.id) return null;
  const id = `CREATIVE-${safe(creative.id)}`;
  const runs = path.join(dir, 'runs');
  const file = path.join(runs, `${id}.json`);
  if (fs.existsSync(file) || fs.existsSync(path.join(runs, 'applied', `${id}.json`))) return { file: `runs/${id}.json`, id, existed: true };
  const kind = creative.kind === 'video' || /\bvideo\b/i.test(String(draft.title ?? '')) ? 'video' : 'image';
  // Only the fields an approval needs; status and compliance are always set by apply-results.
  const approval = {
    id: draft.id, type: 'publish', title: String(draft.title ?? `AI ${kind}`).slice(0, 120), file: draft.file,
    ...(draft.channel ? { channel: draft.channel } : {}), ...(draft.asset ? { asset: draft.asset } : {}),
    ai_generated: true, ...(draft.label ? { label: draft.label } : {}),
  };
  const run = {
    task_id: id, agent: CREATIVE_AGENTS[kind], status: 'done',
    output: [draft.file, draft.asset].filter(Boolean),
    summary: `Generated AI ${kind} from approved brief ${item.file ?? ''} (approval ${item.id ?? '?'}); publishing waits for approval ${draft.id}.`.slice(0, 300),
    approvals: [approval], created_at: now,
  };
  fs.mkdirSync(runs, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(run, null, 2));
  fs.renameSync(tmp, file);
  return { file: `runs/${id}.json`, id };
}
