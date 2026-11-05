// Email through Resend (https://resend.com, free tier). Sends one approved email draft.
// The draft's front matter sets: to (address or comma list), subject, from (optional), reply_to.
// Needs RESEND_API_KEY and OM_EMAIL_FROM (a sender on a domain verified in Resend).
// Bulk newsletters should go through an email platform via the webhook connector instead.
// Built on defineConnector(): ctx.fetch for tests, redact() on every detail, no network when keys
// are missing. Each send carries an Idempotency-Key derived from the approval id, so a retry after
// a timeout (the executor retries up to 3 times) cannot deliver the same email twice (Resend keeps
// the key for 24h).
import { defineConnector, loadDraft, request, fail } from './_http.mjs';

export const MAX_RECIPIENTS = 50;
export const idempotencyKey = (ctx, item) => `whalyom-${ctx.slug}-${item.id}`.slice(0, 256);

export default defineConnector({
  name: 'resend',
  handles: 'type "send" with channel "email" (single or small-batch emails)',
  needs: ['RESEND_API_KEY', 'OM_EMAIL_FROM'],
  accepts: (item) => item.type === 'send' && (item.channel ?? 'email') === 'email',
  prepare(item, ctx) {
    if (!item.file) return { error: 'email approval has no draft file' };
    const { meta, body } = loadDraft(item, ctx);
    const to = String(meta.to ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!to.length || !meta.subject) return { error: 'draft front matter needs "to" and "subject"' };
    if (to.length > MAX_RECIPIENTS) return { error: `more than ${MAX_RECIPIENTS} recipients: use an email platform through the webhook connector` };
    const payload = { from: meta.from || ctx.env.OM_EMAIL_FROM, to, subject: meta.subject, text: body, reply_to: meta.reply_to || undefined };
    return { payload, count: to.length, preview: `email ${to.length} recipient(s): ${meta.subject}` };
  },
  async send(p, item, ctx) {
    const r = await request(ctx, {
      url: 'https://api.resend.com/emails',
      headers: { authorization: `Bearer ${ctx.env.RESEND_API_KEY}`, 'idempotency-key': idempotencyKey(ctx, item) },
      json: p.payload,
    });
    if (!r.ok) return { ok: false, ref: '', detail: fail(r, ctx, 'resend') };
    return { ok: true, ref: r.data?.id ?? '', detail: `sent to ${p.count}` };
  },
});
