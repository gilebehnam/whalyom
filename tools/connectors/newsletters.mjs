// Newsletter platforms: Mailchimp, Brevo and Kit (ConvertKit). They create CAMPAIGN DRAFTS only and
// never send: the owner reviews and sends inside the platform, where the list's consent records,
// unsubscribe link and postal address (CAN-SPAM / GDPR) are enforced.
// Approval type "send" on channel "mailchimp" / "brevo" / "convertkit" (or "kit"), or on
// channel "newsletter" (first configured of Mailchimp, Brevo, Kit). Draft front matter: subject
// (required), preview_text, list_id (else the env default), from_name.
// Each module also exports lists(ctx) to read the audiences/lists (read-only).
import { defineConnector, loadDraft, request, fail } from './_http.mjs';
import { mdToHtml } from './local-site.mjs';

const isSend = (item, channels) => item.type === 'send' && [...channels, 'newsletter'].includes(item.channel);
function campaign(item, ctx) {
  const d = loadDraft(item, ctx);
  if (!d.meta.subject) throw new Error('draft front matter needs "subject"');
  if (!d.body) throw new Error('empty newsletter');
  return { ...d, html: mdToHtml(d.body) };
}

// ── Mailchimp Marketing API 3.0 (key ends in -<dc>, e.g. -us21) ──
const mcBase = (env) => `https://${String(env.MAILCHIMP_API_KEY).split('-').pop()}.api.mailchimp.com/3.0`;
const mcAuth = (env) => `Basic ${Buffer.from(`whalyom:${env.MAILCHIMP_API_KEY}`).toString('base64')}`;

export const mailchimp = defineConnector({
  name: 'mailchimp',
  handles: 'type "send" with channel "mailchimp" or "newsletter": creates a campaign draft (never sends)',
  needs: ['MAILCHIMP_API_KEY', 'MAILCHIMP_LIST_ID', 'OM_EMAIL_FROM'],
  accepts: (item) => isSend(item, ['mailchimp']),
  prepare(item, ctx) { const c = campaign(item, ctx); return { ...c, list: c.meta.list_id || ctx.env.MAILCHIMP_LIST_ID, preview: `create a Mailchimp campaign draft "${c.meta.subject}" for list ${c.meta.list_id || ctx.env.MAILCHIMP_LIST_ID || '(MAILCHIMP_LIST_ID)'}` }; },
  async send(p, item, ctx) {
    const headers = { authorization: mcAuth(ctx.env) };
    const c = await request(ctx, { url: `${mcBase(ctx.env)}/campaigns`, headers, json: { type: 'regular', recipients: { list_id: p.list },
      settings: { subject_line: p.meta.subject, preview_text: p.meta.preview_text || undefined, title: `Whalyom ${item.id}: ${p.title}`.slice(0, 100), from_name: p.meta.from_name || ctx.env.OM_EMAIL_FROM_NAME || 'Newsletter', reply_to: ctx.env.OM_EMAIL_FROM } } });
    if (!c.ok || !c.data?.id) return { ok: false, detail: fail(c, ctx, 'Mailchimp campaign') };
    const body = await request(ctx, { url: `${mcBase(ctx.env)}/campaigns/${c.data.id}/content`, method: 'PUT', headers, json: { html: p.html } });
    if (!body.ok) return { ok: false, ref: c.data.id, detail: fail(body, ctx, `Mailchimp content (campaign ${c.data.id} exists)`) };
    return { ok: true, ref: c.data.id, detail: `Mailchimp draft campaign ${c.data.id} ready; review and send it in Mailchimp` };
  },
});
mailchimp.lists = async (ctx) => {
  const r = await request(ctx, { url: `${mcBase(ctx.env)}/lists?count=100&fields=lists.id,lists.name,lists.stats.member_count`, method: 'GET', headers: { authorization: mcAuth(ctx.env) } });
  if (!r.ok) throw new Error(fail(r, ctx, 'Mailchimp lists'));
  return (r.data?.lists ?? []).map((l) => ({ id: l.id, name: l.name, members: l.stats?.member_count ?? null }));
};

// ── Brevo API v3 ──
export const brevo = defineConnector({
  name: 'brevo',
  handles: 'type "send" with channel "brevo" or "newsletter": creates an email campaign draft (never sends)',
  needs: ['BREVO_API_KEY', 'BREVO_LIST_ID', 'OM_EMAIL_FROM'],
  accepts: (item) => isSend(item, ['brevo']),
  prepare(item, ctx) { const c = campaign(item, ctx); return { ...c, list: Number(c.meta.list_id || ctx.env.BREVO_LIST_ID), preview: `create a Brevo campaign draft "${c.meta.subject}" for list ${c.meta.list_id || ctx.env.BREVO_LIST_ID || '(BREVO_LIST_ID)'}` }; },
  async send(p, item, ctx) {
    const r = await request(ctx, { url: 'https://api.brevo.com/v3/emailCampaigns', headers: { 'api-key': ctx.env.BREVO_API_KEY, accept: 'application/json' },
      json: { name: `Whalyom ${item.id}: ${p.title}`.slice(0, 120), subject: p.meta.subject, previewText: p.meta.preview_text || undefined, sender: { name: p.meta.from_name || ctx.env.OM_EMAIL_FROM_NAME || 'Newsletter', email: ctx.env.OM_EMAIL_FROM }, htmlContent: p.html, recipients: { listIds: [p.list] } } });
    return r.ok ? { ok: true, ref: String(r.data?.id ?? ''), detail: `Brevo draft campaign ${r.data?.id ?? ''} ready; review and send it in Brevo` } : { ok: false, detail: fail(r, ctx, 'Brevo') };
  },
});
brevo.lists = async (ctx) => {
  const r = await request(ctx, { url: 'https://api.brevo.com/v3/contacts/lists?limit=50', method: 'GET', headers: { 'api-key': ctx.env.BREVO_API_KEY, accept: 'application/json' } });
  if (!r.ok) throw new Error(fail(r, ctx, 'Brevo lists'));
  return (r.data?.lists ?? []).map((l) => ({ id: l.id, name: l.name, members: l.uniqueSubscribers ?? l.totalSubscribers ?? null }));
};

// ── Kit (ConvertKit) API v4: a broadcast without send_at is a draft ──
export const convertkit = defineConnector({
  name: 'convertkit',
  handles: 'type "send" with channel "convertkit"/"kit" or "newsletter": creates a draft broadcast (never sends)',
  needs: ['KIT_API_KEY'],
  unverified: 'Kit v4 broadcasts endpoint and X-Kit-Api-Key header from public docs; v3 (api_secret) is not used.',
  accepts: (item) => isSend(item, ['convertkit', 'kit']),
  prepare(item, ctx) { const c = campaign(item, ctx); return { ...c, preview: `create a Kit draft broadcast "${c.meta.subject}"` }; },
  async send(p, item, ctx) {
    const r = await request(ctx, { url: 'https://api.kit.com/v4/broadcasts', headers: { 'x-kit-api-key': ctx.env.KIT_API_KEY, accept: 'application/json' },
      json: { subject: p.meta.subject, preview_text: p.meta.preview_text || undefined, content: p.html, description: `Whalyom ${item.id}`, public: false, send_at: null } });
    const id = r.data?.broadcast?.id ?? r.data?.id;
    return r.ok ? { ok: true, ref: String(id ?? ''), detail: `Kit draft broadcast ${id ?? ''} ready; review and send it in Kit` } : { ok: false, detail: fail(r, ctx, 'Kit') };
  },
});
convertkit.lists = async (ctx) => {
  const r = await request(ctx, { url: 'https://api.kit.com/v4/tags', method: 'GET', headers: { 'x-kit-api-key': ctx.env.KIT_API_KEY, accept: 'application/json' } });
  if (!r.ok) throw new Error(fail(r, ctx, 'Kit tags'));
  return (r.data?.tags ?? []).map((t) => ({ id: t.id, name: t.name, members: null }));
};

export default [mailchimp, brevo, convertkit];
