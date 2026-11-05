// Native CRM: funnel leads become contacts and deals, owner edits change fields (stage moves are handed
// to the funnel), HubSpot and Pipedrive CSV files import and export, and the pipeline view totals stages,
// weights the forecast and lists deals slipping past their close date. No network; no personal data in
// state; nothing sent (follow-ups are pending approvals for consented contacts only).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  syncFromFunnel, applyEdits, importRows, exportCsv, pipelineView, parseCsv, toCsv, detectFormat, dealStage,
  stageProbabilities, followUpProposals, crmState, crmMarkdown,
} from '../crm.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const slug = `zz-crm-${process.pid}`;
const P = (f = '') => path.join(root, 'products', slug, f);
const NOW = '2026-11-04T12:00:00.000Z';
after(() => fs.rmSync(P(), { recursive: true, force: true }));

const pipeline = {
  leads: [
    { id: 'a1', lead_id: 'a1', email_hash: 'h-ann', channel: 'community', consent: 'opted-in', stage: 'opportunity', max_rank: 4, first_seen: '2026-10-01T10:00:00.000Z', value: 0 },
    { id: 'b1', lead_id: 'b1', email_hash: 'h-bob', channel: 'organic', consent: 'unknown', stage: 'new', max_rank: 0, first_seen: '2026-10-02T10:00:00.000Z', value: 0 },
    { id: 'c1', lead_id: 'c1', email_hash: 'h-cy', channel: 'organic', consent: 'inbound', stage: 'won', max_rank: 5, won_at: '2026-11-01T00:00:00.000Z', value: 1200, currency: 'USD', first_seen: '2026-09-01T10:00:00.000Z' },
    { id: 'd1', lead_id: 'd1', channel: 'ads', consent: 'unknown', stage: 'lost', max_rank: 3, first_seen: '2026-09-15T10:00:00.000Z', value: 0 },
    { stage: 'new' }, // no id: skipped
  ],
};
const leadLog = [
  { lead_id: 'a1', contact: { email: 'Ann@Example.com', name: 'Ann Lee', phone: '+1 555 0100' } },
  { lead_id: 'b1', contact: { email: 'not-an-email', name: 'Bob' } },
];

test('stage words from HubSpot, Pipedrive and the funnel map to deal stages', () => {
  assert.equal(dealStage('closedwon'), 'won');
  assert.equal(dealStage('Closed Lost'), 'lost');
  assert.equal(dealStage('Proposal Made'), 'proposal');
  assert.equal(dealStage('contractsent'), 'negotiation');
  assert.equal(dealStage('qualifiedtobuy'), 'qualified');
  assert.equal(dealStage('trial'), 'proposal'); // funnel alias → opportunity → proposal
  assert.equal(dealStage('banana'), null);
  assert.equal(dealStage(''), null);
  assert.equal(dealStage(undefined), null);
});

test('funnel sync: one contact per lead, deals from "qualified" on, raw details only from the lead log', () => {
  const { crm, stats } = syncFromFunnel(null, pipeline, { leadLog, now: NOW, currency: 'USD' });
  assert.deepEqual(Object.keys(crm.contacts), ['a1', 'b1', 'c1', 'd1']);
  assert.equal(crm.contacts.a1.email, 'ann@example.com');
  assert.equal(crm.contacts.a1.phone, '+1 555 0100');
  assert.equal(crm.contacts.b1.email, null, 'invalid email is dropped, not stored');
  assert.equal(crm.contacts.b1.name, 'Bob');
  assert.equal(stats.contacts_new, 4);
  const byLead = Object.fromEntries(crm.deals.map((d) => [d.lead_id, d]));
  assert.equal(byLead.b1, undefined, 'a new lead has no deal yet');
  assert.equal(byLead.a1.stage, 'proposal');
  assert.equal(byLead.c1.stage, 'won');
  assert.equal(byLead.c1.amount, 1200, 'verified funnel revenue fills the won amount');
  assert.equal(byLead.d1.stage, 'lost', 'a qualified lead that was lost is a lost deal, not an open one');
  // Deterministic: same input, same output; re-running changes nothing.
  const again = syncFromFunnel(crm, pipeline, { leadLog, now: NOW });
  assert.deepEqual(again.crm, crm);
  assert.equal(again.stats.deals_new, 0);
  assert.equal(again.stats.contacts_updated, 0);
});

test('funnel moves deals forward only and never reopens a closed deal', () => {
  let { crm } = syncFromFunnel(null, pipeline, { leadLog, now: NOW });
  // Owner pushed a1 to negotiation; an older funnel stage (opportunity → proposal) must not pull it back.
  crm = applyEdits(crm, [{ lead: 'a1', stage: 'negotiation' }], { now: NOW }).crm;
  crm = syncFromFunnel(crm, pipeline, { now: NOW }).crm;
  assert.equal(crm.deals.find((d) => d.lead_id === 'a1').stage, 'negotiation');
  const back = { leads: pipeline.leads.map((l) => (l.lead_id === 'c1' ? { ...l, stage: 'qualified' } : l)) };
  crm = syncFromFunnel(crm, back, { now: NOW }).crm;
  assert.equal(crm.deals.find((d) => d.lead_id === 'c1').stage, 'won');
  const won = { leads: pipeline.leads.map((l) => (l.lead_id === 'a1' ? { ...l, stage: 'won', won_at: NOW } : l)) };
  crm = syncFromFunnel(crm, won, { now: NOW }).crm;
  assert.equal(crm.deals.find((d) => d.lead_id === 'a1').stage, 'won');
});

test('owner edits: fields apply, stage changes go to the funnel, bad or unknown fields are rejected whole', () => {
  const base = syncFromFunnel(null, pipeline, { leadLog, now: NOW }).crm;
  const a1 = base.deals.find((d) => d.lead_id === 'a1').id;
  const res = applyEdits(base, [
    { lead: 'a1', amount: '4,500', close_date: '2026-12-15', next_step: 'Send contract', note: 'Budget approved', at: '2026-11-03T09:00:00Z' },
    { deal: a1, stage: 'Closed Won', at: '2026-11-04T09:00:00Z' },
    { lead: 'b1', contact: { company: 'Bob Co', email: 'bob@bob.co', tags: 'vip, b2b, vip' } },
    { lead: 'b1', amount: 300, deal_title: 'Starter plan' }, // creates b1's first deal
    { lead: 'b1', amount: -5 },
    { lead: 'b1', close_date: 'someday' },
    { lead: 'b1', stage: 'flying' },
    { lead: 'b1', favourite_color: 'blue' },
    { lead: 'zz' , amount: 1 },
    { deal: 'D-nope', amount: 1 },
    { amount: 1 },
    'not an object',
    { lead: 'b1', contact: { email: 'nope' }, amount: 999 }, // the bad email blocks the amount too
  ], { now: NOW, currency: 'USD' });
  assert.equal(res.applied, 4);
  assert.equal(res.rejected.length, 9);
  assert.ok(res.rejected.some((r) => /unknown field/.test(r.reason)));
  assert.ok(res.rejected.some((r) => /amount/.test(r.reason)));
  assert.ok(res.rejected.some((r) => /close_date/.test(r.reason)));
  assert.ok(res.rejected.some((r) => /unknown stage/.test(r.reason)));
  assert.ok(res.rejected.some((r) => /no contact zz/.test(r.reason)));
  assert.ok(res.rejected.some((r) => /no deal/.test(r.reason)));
  const d = res.crm.deals.find((x) => x.id === a1);
  assert.equal(d.amount, 4500);
  assert.equal(d.close_date, '2026-12-15');
  assert.equal(d.next_step, 'Send contract');
  assert.equal(d.notes[0].text, 'Budget approved');
  assert.equal(d.stage, 'won');
  assert.equal(d.won_at, '2026-11-04T09:00:00.000Z');
  assert.deepEqual(res.funnel_updates, [{ lead: 'a1', stage: 'won', at: '2026-11-04T09:00:00.000Z', source: 'crm', value: 4500, currency: 'USD', note: `CRM: deal ${a1} → won` }]);
  const b1 = res.crm.contacts.b1;
  assert.equal(b1.company, 'Bob Co');
  assert.equal(b1.email, 'bob@bob.co');
  assert.notEqual(b1.email_hash, null);
  assert.deepEqual(b1.tags, ['b2b', 'vip']);
  const bd = res.crm.deals.find((x) => x.lead_id === 'b1');
  assert.equal(bd.amount, 300);
  assert.equal(bd.title, 'Starter plan');
  assert.equal(bd.stage, 'lead');
  assert.equal(base.deals.find((x) => x.id === a1).amount, null, 'input is not mutated');
});

test('CSV: quotes, commas, newlines, BOM; formula cells are guarded on export and restored on import', () => {
  const rows = parseCsv('﻿Name,Note\r\n"Lee, Ann","said ""hi""\nthen left"\r\n\r\nBob,plain\n');
  assert.deepEqual(rows, [{ Name: 'Lee, Ann', Note: 'said "hi"\nthen left' }, { Name: 'Bob', Note: 'plain' }]);
  const csv = toCsv(['a', 'b'], [{ a: '=HYPERLINK("x")', b: '+1 555 0100' }]);
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`), 'formula is neutralised');
  assert.ok(csv.includes(',+1 555 0100'), 'phone numbers stay as they are');
  assert.deepEqual(parseCsv(csv), [{ a: '=HYPERLINK("x")', b: '+1 555 0100' }]);
  assert.deepEqual(parseCsv(''), []);
  assert.equal(detectFormat(['Record ID', 'Deal Name', 'Deal Stage']), 'hubspot');
  assert.equal(detectFormat(['First Name', 'Email', 'Lifecycle Stage']), 'hubspot');
  assert.equal(detectFormat(['Deal - Title', 'Deal - Value', 'Person - Email']), 'pipedrive');
  assert.equal(detectFormat(['foo', 'bar']), null);
  assert.equal(detectFormat(null), null);
});

test('HubSpot import: contacts matched by email, deals by record id, stages handed to the funnel', () => {
  const base = syncFromFunnel(null, pipeline, { leadLog, now: NOW }).crm;
  const contacts = parseCsv([
    'Record ID,First Name,Last Name,Email,Phone Number,Company Name,Job Title,Lifecycle Stage,Contact owner',
    '101,Ann,Lee,ANN@example.com,+1 555 0100,Lee Ltd,CEO,opportunity,Sam',
    '102,Dan,Ng,dan@ng.io,,Ng Inc,CTO,salesqualifiedlead,Sam',
    ',,,,,,,,',
  ].join('\n'));
  const r1 = importRows(base, contacts, { format: 'hubspot', now: NOW });
  assert.equal(r1.stats.contacts_updated, 1, 'Ann is matched by email to the funnel lead');
  assert.equal(r1.stats.contacts_new, 1);
  assert.equal(r1.crm.contacts.a1.company, 'Lee Ltd');
  assert.equal(r1.crm.contacts.a1.external.hubspot, '101');
  const dan = Object.values(r1.crm.contacts).find((c) => c.email === 'dan@ng.io');
  assert.match(dan.lead_id, /^C-[0-9a-f]{16}$/);
  assert.deepEqual(r1.leads, [{ lead_id: dan.lead_id, email: 'dan@ng.io', name: 'Dan Ng', channel: 'crm-import', source: 'crm-import:hubspot' }]);
  assert.ok(r1.funnel_updates.some((u) => u.lead === dan.lead_id && u.stage === 'qualified'));
  const deals = parseCsv([
    'Record ID,Deal Name,Pipeline,Deal Stage,Amount,Close Date,Deal owner,Associated Contact Email',
    '900,Ng rollout,Sales Pipeline,contractsent,"12,000",2026-10-20,Sam,dan@ng.io',
  ].join('\n'));
  const r2 = importRows(r1.crm, deals, { format: 'hubspot', now: NOW });
  const d = r2.crm.deals.find((x) => x.external.hubspot === '900');
  assert.equal(d.lead_id, dan.lead_id);
  assert.equal(d.stage, 'negotiation');
  assert.equal(d.amount, 12000);
  assert.equal(d.close_date, '2026-10-20');
  // Same file again: no duplicates.
  const r3 = importRows(r2.crm, deals, { format: 'hubspot', now: NOW });
  assert.equal(r3.crm.deals.length, r2.crm.deals.length);
  assert.equal(r3.stats.deals_updated, 1);
  assert.throws(() => importRows(base, [], { format: 'salesforce' }), /unknown format/);
});

test('Pipedrive import: status won/lost wins over stage; an old export never reopens a won deal', () => {
  const rows = parseCsv([
    'Deal - ID,Deal - Title,Deal - Value,Deal - Currency,Deal - Stage,Deal - Status,Deal - Expected close date,Deal - Owner,Person - Name,Person - Email,Organization - Name',
    '7,Widget order,800,EUR,Proposal Made,won,2026-11-01,Kim,Eve Park,eve@park.de,Park GmbH',
    '8,Second order,50,USD,Qualified,open,,Kim,Eve Park,eve@park.de,Park GmbH',
  ].join('\n'));
  const r = importRows(null, rows, { format: 'pipedrive', now: NOW });
  assert.equal(Object.keys(r.crm.contacts).length, 1, 'both deals belong to one person');
  const won = r.crm.deals.find((x) => x.external.pipedrive === '7');
  assert.equal(won.stage, 'won');
  assert.equal(won.currency, 'EUR');
  assert.equal(r.funnel_updates.length, 1, 'one stage move per lead per import, the furthest');
  assert.equal(r.funnel_updates[0].stage, 'won');
  const old = parseCsv('Deal - ID,Deal - Title,Deal - Stage,Deal - Status,Person - Email\n7,Widget order,Qualified,open,eve@park.de\n');
  const r2 = importRows(r.crm, old, { format: 'pipedrive', now: NOW });
  assert.equal(r2.crm.deals.find((x) => x.external.pipedrive === '7').stage, 'won');
  assert.equal(r2.stats.kept_closed, 1);
});

test('export round trip: HubSpot and Pipedrive files import back to the same deals', () => {
  let crm = syncFromFunnel(null, pipeline, { leadLog, now: NOW }).crm;
  crm = applyEdits(crm, [{ lead: 'a1', amount: 2500, close_date: '2026-11-30', owner: 'Sam', next_step: 'Call' }], { now: NOW }).crm;
  for (const format of ['hubspot', 'pipedrive']) {
    const csv = exportCsv(crm, format, 'deals');
    const rows = parseCsv(csv);
    assert.equal(rows.length, crm.deals.length);
    assert.equal(detectFormat(Object.keys(rows[0])), format);
    const back = importRows(crm, rows, { format, now: NOW });
    assert.equal(back.crm.deals.length, crm.deals.length, `${format}: no duplicate deals`);
    assert.equal(back.stats.contacts_new, 0, `${format}: no duplicate contacts`);
    const a = back.crm.deals.find((d) => d.lead_id === 'a1');
    assert.equal(a.amount, 2500); assert.equal(a.close_date, '2026-11-30'); assert.equal(a.stage, 'proposal');
    assert.equal(parseCsv(exportCsv(crm, format, 'contacts')).length, 2, 'only people with a name, email or phone');
  }
  assert.throws(() => exportCsv(crm, 'zoho', 'deals'), /unknown export/);
});

test('pipeline view: stage totals, weighted forecast, close months, slipping deals, other currencies apart', () => {
  let crm = syncFromFunnel(null, pipeline, { leadLog, now: NOW }).crm;
  crm = applyEdits(crm, [
    { lead: 'a1', amount: 1000, close_date: '2026-10-25', next_step: 'Chase' }, // proposal, 10 days late
    { lead: 'b1', amount: 400, close_date: '2026-12-10', stage: 'qualified' },
  ], { now: NOW }).crm;
  crm.deals.push({ id: 'D-eur', lead_id: 'b1', title: 'EU', amount: 999, currency: 'EUR', stage: 'proposal', probability: null, close_date: null, owner: '', next_step: '', notes: [], history: [], created_at: NOW, updated_at: NOW, external: {} });
  const v = pipelineView(crm, { now: NOW, currency: 'USD', probabilities: { proposal: 40, won: 0.1, bogus: 0.5 } });
  const st = Object.fromEntries(v.stages.map((s) => [s.stage, s]));
  assert.equal(st.proposal.probability, 0.4, 'product overrides apply (0–100 accepted)');
  assert.equal(st.won.probability, 1, 'won stays 1');
  assert.equal(st.proposal.weighted, 400);
  assert.equal(st.qualified.weighted, 80);
  assert.equal(v.totals.open_amount, 1400);
  assert.equal(v.totals.weighted_forecast, 480);
  assert.equal(v.totals.won_count, 1);
  assert.equal(v.totals.won_amount, 1200);
  assert.equal(v.totals.win_rate_pct, 50); // c1 won, d1 lost
  assert.deepEqual(v.by_close_month.map((m) => m.month), ['2026-10', '2026-12']);
  assert.equal(v.slipping.length, 1);
  assert.equal(v.slipping[0].days_late, 10);
  assert.equal(v.slipping[0].consent, 'opted-in');
  assert.deepEqual(v.other_currencies, [{ currency: 'EUR', count: 1, amount: 999, weighted: 399.6 }]);
  assert.ok(v.no_close_date.includes('D-eur'));
  assert.deepEqual(stageProbabilities({ lead: 'x', negotiation: 101 }), stageProbabilities());
  // Follow-ups are proposals for consented contacts only; nothing goes out.
  const props = followUpProposals(v);
  assert.equal(props.length, 1);
  assert.equal(props[0].type, 'crm-follow-up');
  assert.ok(!('status' in props[0]) || props[0].status === 'pending');
  const unconsented = { slipping: [{ ...v.slipping[0], consent: 'unknown' }] };
  assert.equal(followUpProposals(unconsented).length, 0);
  // Dashboard row has no personal data.
  const row = JSON.stringify(crmState('x', v));
  for (const bad of ['ann@example.com', 'Ann Lee', 'a1', 'Chase', 'D-eur', '+1 555']) assert.ok(!row.includes(bad), `state leaks ${bad}`);
  assert.match(crmMarkdown('X', v), /weighted forecast:\*\* 480 USD/);
  assert.deepEqual(pipelineView(null, { now: NOW }).totals.deals, 0);
});

test('CLI: sync, edits folder, drop-in import, proposals as pending approvals, export, guards', () => {
  fs.mkdirSync(P('funnel'), { recursive: true });
  fs.mkdirSync(P('crm/edits'), { recursive: true });
  fs.mkdirSync(P('crm/imports'), { recursive: true });
  fs.writeFileSync(P('product.json'), JSON.stringify({ name: 'CRM test', slug, stage: 'active', budget: { currency: 'USD', monthly_cap: 0, daily_cap: 0 }, crm: { stage_probability: { proposal: 0.5 } } }));
  fs.writeFileSync(P('funnel/pipeline.json'), JSON.stringify(pipeline));
  fs.writeFileSync(P('leads.jsonl'), leadLog.map((l) => JSON.stringify(l)).join('\n') + '\n{bad json\n');
  fs.writeFileSync(P('crm/edits/owner.json'), JSON.stringify([{ lead: 'a1', amount: 1000, close_date: '2020-01-01' }, { lead: 'a1', wrong: 1 }]));
  fs.writeFileSync(P('crm/edits/broken.json'), '{not json');
  fs.writeFileSync(P('crm/imports/hs.csv'), 'Record ID,First Name,Last Name,Email,Lifecycle Stage\n5,Zed,Q,zed@q.io,customer\n');
  const run = (...args) => spawnSync(process.execPath, [path.join(root, 'tools', 'crm.mjs'), ...args], { encoding: 'utf8', cwd: root });
  const r = run(slug, '--propose');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(out.edits_applied, 1);
  assert.equal(out.edits_rejected, 1);
  assert.equal(out.imports[0].format, 'hubspot');
  assert.ok(out.errors.some((e) => /broken\.json/.test(e)));
  assert.equal(out.proposals, 1);
  assert.deepEqual(fs.readdirSync(P('crm/edits')).filter((f) => f.endsWith('.json')), [], 'edit files moved to done/');
  assert.deepEqual(fs.readdirSync(P('crm/imports')).filter((f) => f.endsWith('.csv')), []);
  const contacts = JSON.parse(fs.readFileSync(P('crm/contacts.json'), 'utf8')).contacts;
  assert.equal(contacts.a1.email, 'ann@example.com', 'raw details stay in the product folder');
  const view = JSON.parse(fs.readFileSync(P('crm/pipeline.json'), 'utf8'));
  assert.ok(!JSON.stringify(view).includes('ann@example.com'));
  assert.equal(view.slipping.length, 1);
  const runFile = JSON.parse(fs.readFileSync(P(`runs/CRM-${new Date().toISOString().slice(0, 10)}.json`), 'utf8'));
  assert.equal(runFile.approvals.length, 1);
  assert.equal(runFile.approvals[0].type, 'crm-follow-up');
  assert.ok(fs.readdirSync(P('leads')).some((f) => /^crm-import-hubspot/.test(f)), 'new person handed to the funnel lead folder');
  assert.ok(fs.readdirSync(P('funnel/updates')).some((f) => /^crm-hubspot/.test(f)), 'stage handed to the funnel');
  assert.ok(fs.existsSync(P('crm/CRM.md')));
  const ex = run('export', slug, 'pipedrive', 'deals');
  assert.equal(ex.status, 0, ex.stderr);
  const exOut = JSON.parse(ex.stdout.trim());
  assert.match(exOut.file, new RegExp(`^products/${slug}/crm/exports/pipedrive-deals-`));
  const back = run('import', slug, path.join(root, exOut.file), '--format', 'pipedrive');
  assert.equal(back.status, 0, back.stderr);
  assert.equal(JSON.parse(back.stdout.trim()).contacts_new, 0);
  // Guards: bad slug, unknown product, missing args.
  assert.equal(run('../etc').status, 2);
  assert.equal(run('zz-no-such-product').status, 2);
  assert.equal(run('import', slug).status, 2);
  assert.equal(run().status, 2);
});

test('guards: suppression.json and missing addresses block follow-ups; close dates keep their calendar day', () => {
  const crm = {
    contacts: {
      s1: { lead_id: 's1', email: 's1@example.com', email_hash: 'h-s1', consent: 'opted-in' },
      s2: { lead_id: 's2', email: null, email_hash: null, consent: 'opted-in' },
      s3: { lead_id: 's3', email_hash: 'h-s3', consent: 'inbound', aliases: ['old-s3'] },
      s4: { lead_id: 's4', email_hash: 'h-s4', consent: 'opted-in' },
    },
    deals: ['s1', 's2', 's3', 's4'].map((l) => ({ id: `D-${l}`, lead_id: l, stage: 'proposal', amount: 10, currency: 'USD', close_date: '2026-10-01', next_step: '', notes: [], history: [] })),
  };
  const v = pipelineView(crm, { now: NOW });
  assert.equal(v.slipping.length, 4);
  assert.deepEqual(followUpProposals(v).map((p) => p.deal).sort(), ['D-s1', 'D-s3', 'D-s4'], 'no address, no proposal');
  const sup = { entries: [{ email_hash: 'h-s1' }, { lead: 'old-s3' }] };
  assert.deepEqual(followUpProposals(v, { suppression: sup }).map((p) => p.deal), ['D-s4']);
  assert.deepEqual(followUpProposals(v, { suppression: [{ lead: 's4' }] }).map((p) => p.deal).sort(), ['D-s1', 'D-s3']);
  // Dates: "YYYY-MM-DD hh:mm" keeps its day whatever the machine's time zone; impossible dates are rejected.
  const base = { contacts: { a1: { lead_id: 'a1', sources: [] } }, deals: [] };
  const ok = applyEdits(base, [{ lead: 'a1', close_date: '2026-11-04 23:30' }], { now: NOW });
  assert.equal(ok.crm.deals[0].close_date, '2026-11-04');
  const bad = applyEdits(base, [{ lead: 'a1', close_date: '2026-02-30' }], { now: NOW });
  assert.equal(bad.applied, 0);
  assert.match(bad.rejected[0].reason, /close_date/);
});
