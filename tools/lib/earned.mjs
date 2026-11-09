// Earned autonomy: an action type and channel the owner has approved unchanged the last `streak` times
// in a row (default 10, never fewer than 5), with no rejection in that run, may become automatic for
// that channel (tools/policy.mjs, when product.json autonomy.earned is on). Price changes never earn
// autonomy, and neither do AI voice calls (type 'call': the owner approves every call, see
// tools/connectors/voice.mjs). One rejection resets the streak, so trust is lost faster than it is
// earned. An owner's edit
// ('changes', edited_by_owner) or an approval over a compliance block (override_review) also breaks it:
// only items approved unchanged and clean earn trust.
// Types that never earn autonomy, however long the streak.
export const NEVER_EARNED = new Set(['price', 'call']);
export const earnedKey = (ap) => `${ap.type ?? 'publish'}|${String(ap.channel ?? '').toLowerCase()}`;

export function earnedTypes(list, { streak = 10, types = null } = {}) {
  const need = Math.max(5, Number(streak) || 10);
  const byKey = {};
  for (const x of list ?? []) {
    if (!/owner/i.test(String(x.decided_by ?? '')) || !x.decided_at) continue;
    if (!['approved', 'executed', 'rejected', 'changes'].includes(x.status)) continue;
    (byKey[earnedKey(x)] ??= []).push(x);
  }
  const out = new Map();
  for (const [k, xs] of Object.entries(byKey)) {
    const type = k.split('|')[0];
    if (NEVER_EARNED.has(type) || (types && !types.includes(type))) continue;
    const recent = xs.sort((p, q) => String(q.decided_at).localeCompare(String(p.decided_at))).slice(0, need);
    if (recent.length >= need && recent.every((x) => ['approved', 'executed'].includes(x.status) && !x.edited_by_owner && !x.override_review && !x.owner_note_edit)) out.set(k, recent.length);
  }
  return out;
}
