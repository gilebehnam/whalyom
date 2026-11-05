// A/B and bandit testing: validation, deterministic Thompson allocation with an exploration floor,
// unique-visitor tallies, stop rules, approvals before anything is served or rolled out, budget guards,
// hashed visitor ids, and a client snippet that assigns visitors exactly like the server.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  validateExperiment, budgetGuard, normalizeBeacon, conversionsFromFunnel, tally, posterior, allocation, chooseArm,
  thompsonChoose, decide, stepBandits, resolveLive, clientSnippet, runBandits, writeBanditState, fnv1a, hashUnit,
  mulberry32, betaSample, hashVisitor, banditMarkdown, unsafeUrl, approvalId,
} from '../bandit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-bandit-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const T0 = '2026-10-01T00:00:00.000Z';
const at = (min) => new Date(Date.parse(T0) + min * 60000).toISOString();
const draft = (over = {}) => ({
  id: 'hero-cta', name: 'Hero CTA', element: '#hero .cta', goal: { kind: 'click', selector: '#hero .cta' },
  arms: [{ id: 'control', label: 'Original' }, { id: 'b', label: 'Get a quote', variant: { type: 'text', value: 'Get a quote in 2 minutes' } }],
  ...over,
});
const running = (over = {}) => ({ ...validateExperiment(draft(over)).experiment, status: 'running', started_at: T0, ...over });
// n visitors per arm, c of them convert.
function synth(exp, perArm) {
  const ev = [];
  let k = 0;
  for (const [arm, [n, c]] of Object.entries(perArm)) for (let i = 0; i < n; i++) {
    const vid = hashVisitor(`${arm}-visitor-${i}`); k++;
    ev.push({ at: at(k), kind: 'exposure', exp: exp.id, arm, vid });
    if (i < c) ev.push({ at: at(k + 1), kind: 'conversion', exp: exp.id, vid });
  }
  return ev;
}

test('validation keeps good experiments and refuses unsafe or malformed ones', () => {
  const ok = validateExperiment(draft());
  assert.ok(ok.experiment);
  assert.equal(ok.experiment.status, 'draft');
  assert.equal(ok.experiment.explore, 0.1);
  assert.equal(ok.experiment.threshold, 0.95);
  assert.deepEqual(ok.experiment.arms[0].variant, { type: 'none' });
  assert.ok(validateExperiment(null).errors);
  assert.ok(validateExperiment(draft({ id: 'bad id!' })).errors);
  assert.ok(validateExperiment(draft({ arms: [{ id: 'a' }] })).errors.some((e) => e.includes('2 to 8')));
  assert.ok(validateExperiment(draft({ arms: [{ id: 'a' }, { id: 'a' }] })).errors.some((e) => e.includes('duplicate')));
  assert.ok(validateExperiment(draft({ arms: [{ id: 'a' }, { id: 'b', variant: { type: 'html', value: '<script>' } }] })).errors);
  assert.ok(validateExperiment(draft({ arms: [{ id: 'a' }, { id: 'b', variant: { type: 'attr', name: 'onclick', value: 'x' } }] })).errors);
  assert.ok(validateExperiment(draft({ arms: [{ id: 'a' }, { id: 'b', variant: { type: 'attr', name: 'href', value: 'javascript:alert(1)' } }] })).errors);
  assert.ok(validateExperiment(draft({ arms: [{ id: 'a' }, { id: 'b', variant: { type: 'text', ref: '../../secrets.txt' } }] })).errors);
  assert.equal(validateExperiment(draft({ explore: 5, threshold: 0.1 })).experiment.explore, 1);
});

test('seeded randomness is deterministic and Beta draws have the right mean', () => {
  const a = mulberry32(42); const b = mulberry32(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  const r = mulberry32(7); let s = 0;
  for (let i = 0; i < 4000; i++) s += betaSample(3, 7, r);
  assert.ok(Math.abs(s / 4000 - 0.3) < 0.02);
  assert.equal(fnv1a('abc'), 440920331);
  assert.ok(hashUnit('x') >= 0 && hashUnit('x') < 1);
});

test('beacons are validated and visitor ids are hashed before storage', () => {
  const ok = normalizeBeacon({ kind: 'exposure', exp: 'hero-cta', arm: 'b', vid: 'abcdefghij12' }, new Date(T0));
  assert.equal(ok.event.vid, hashVisitor('abcdefghij12'));
  assert.ok(!JSON.stringify(ok.event).includes('abcdefghij12'));
  assert.equal(normalizeBeacon({ kind: 'conversion', vid: 'abcdefghij12', value: 49 }).event.value, 49);
  assert.ok(normalizeBeacon({ kind: 'exposure', exp: 'hero-cta', vid: 'abcdefghij12' }).error);
  assert.ok(normalizeBeacon({ kind: 'click', exp: 'x', arm: 'y', vid: 'abcdefghij12' }).error);
  assert.ok(normalizeBeacon({ kind: 'exposure', exp: 'x', arm: 'y', vid: 'me@example.com' }).error);
  assert.ok(normalizeBeacon('nope').error);
  assert.ok(normalizeBeacon([]).error);
});

test('tally counts unique visitors, first arm wins, conversions only after exposure and in the window', () => {
  const x = running();
  const v1 = hashVisitor('visitor-one-1'); const v2 = hashVisitor('visitor-two-2'); const v3 = hashVisitor('visitor-three');
  const events = [
    { at: at(5), kind: 'exposure', exp: x.id, arm: 'b', vid: v1 },
    { at: at(6), kind: 'exposure', exp: x.id, arm: 'control', vid: v1 }, // same visitor again: ignored
    { at: at(7), kind: 'conversion', exp: x.id, vid: v1, value: 10 },
    { at: at(8), kind: 'conversion', vid: v1, value: 10 }, // second conversion: ignored
    { at: at(3), kind: 'conversion', vid: v2 }, // before exposure: ignored
    { at: at(4), kind: 'exposure', exp: x.id, arm: 'control', vid: v2 },
    { at: '2026-09-01T00:00:00Z', kind: 'exposure', exp: x.id, arm: 'control', vid: v3 }, // before start
    { at: at(9), kind: 'exposure', exp: x.id, arm: 'zzz', vid: v3 }, // unknown arm
    { at: 'not a date', kind: 'exposure', exp: x.id, arm: 'b', vid: v3 },
    null,
  ];
  const t = tally([x], events)[x.id];
  assert.deepEqual(t.b, { exposures: 1, conversions: 1, value: 10 });
  assert.deepEqual(t.control, { exposures: 1, conversions: 0, value: 0 });
  assert.deepEqual(tally([x], [...events].reverse()), tally([x], events));
  const notStarted = validateExperiment(draft()).experiment;
  assert.equal(tally([notStarted], events)[notStarted.id].b.exposures, 0);
});

test('funnel rows with a visitor id become conversions; others are ignored', () => {
  const pipeline = { leads: [
    { vid: 'raw-visitor-id-1', max_rank: 5, value: 120, history: [{ stage: 'new', at: at(10) }, { stage: 'won', at: at(50) }] },
    { email_hash: 'abc', max_rank: 5, history: [{ stage: 'won', at: at(10) }] },
    { bandit_vid: 'raw-visitor-id-2', max_rank: 1, history: [{ stage: 'new', at: at(20) }] },
  ] };
  const any = conversionsFromFunnel(pipeline);
  assert.equal(any.length, 2);
  assert.equal(any[0].vid, hashVisitor('raw-visitor-id-1'));
  const won = conversionsFromFunnel(pipeline, { stage: 'won' });
  assert.equal(won.length, 1);
  assert.equal(won[0].at, at(50));
  assert.equal(won[0].value, 120);
  assert.deepEqual(conversionsFromFunnel(null), []);
});

test('posterior is deterministic for a seed and favours the better arm', () => {
  const stats = { control: { exposures: 1000, conversions: 50 }, b: { exposures: 1000, conversions: 90 } };
  const p1 = posterior(stats, { seed: 9 }); const p2 = posterior(stats, { seed: 9 });
  assert.deepEqual(p1, p2);
  assert.ok(p1.b.prob_best > 0.99);
  assert.ok(p1.b.prob_beat_control > 0.99);
  assert.equal(p1.control.prob_beat_control, null);
  assert.ok(p1.b.ci95[0] < 0.09 && p1.b.ci95[1] > 0.09);
});

test('allocation keeps a 10% exploration floor, sums to 1 and assigns visitors deterministically', () => {
  const x = running();
  const post = posterior({ control: { exposures: 2000, conversions: 20 }, b: { exposures: 2000, conversions: 200 } }, { seed: 3 });
  const w = allocation(x, post);
  assert.ok(w.control >= 0.05 - 1e-9, `floor ${w.control}`);
  assert.ok(Math.abs(w.control + w.b - 1) < 1e-9);
  const three = { ...x, arms: [...x.arms, { id: 'c', label: 'c', variant: { type: 'hide' } }] };
  const w3 = allocation(three, { control: { prob_best: 0 }, b: { prob_best: 1 }, c: { prob_best: 0 } });
  assert.ok(w3.control >= 0.1 / 3 - 1e-4 && w3.c >= 0.1 / 3 - 1e-4);
  assert.equal(chooseArm(x, 'visitor-42', w), chooseArm(x, 'visitor-42', w));
  let b = 0; for (let i = 0; i < 4000; i++) if (chooseArm(x, `v${i}`, w) === 'b') b++;
  assert.ok(Math.abs(b / 4000 - w.b) < 0.03, `share ${b / 4000} vs ${w.b}`);
  assert.deepEqual(allocation({ ...x, status: 'rolled_out', winner: 'b' }, post), { control: 0, b: 1 });
  const s = { control: { exposures: 10, conversions: 1 }, b: { exposures: 10, conversions: 5 } };
  assert.equal(thompsonChoose(x, 'visitor-7', s), thompsonChoose(x, 'visitor-7', s));
  assert.ok(['control', 'b'].includes(thompsonChoose(x, 'visitor-7', s, { explore: 1 })));
});

test('stop rules: winner needs threshold and min samples; max duration stops inconclusive', () => {
  const x = running({ min_samples: 500 });
  const strong = posterior({ control: { exposures: 600, conversions: 30 }, b: { exposures: 600, conversions: 80 } }, { seed: 1 });
  assert.equal(decide(x, strong, at(60)).verdict, 'winner');
  assert.equal(decide(x, strong, at(60)).leader, 'b');
  const few = posterior({ control: { exposures: 100, conversions: 1 }, b: { exposures: 100, conversions: 40 } }, { seed: 1 });
  assert.equal(decide(x, few, at(60)).verdict, 'running');
  const tie = posterior({ control: { exposures: 600, conversions: 30 }, b: { exposures: 600, conversions: 31 } }, { seed: 1 });
  assert.equal(decide(x, tie, at(60)).verdict, 'running');
  assert.equal(decide(x, tie, '2026-11-15T00:00:00Z').verdict, 'inconclusive');
});

test('drafts wait for owner approval, then run, then a winner is proposed for rollout (never auto)', () => {
  const now1 = at(1);
  const s1 = stepBandits(null, { drafts: [draft()], now: now1 });
  assert.equal(s1.ledger.experiments[0].status, 'draft');
  assert.equal(s1.live.experiments.length, 0, 'nothing is served before approval');
  assert.deepEqual(s1.proposals.map((p) => p.target), ['bandit:hero-cta:start']);
  const pending = [{ id: 'A1', target: 'bandit:hero-cta:start', status: 'pending' }];
  const s1b = stepBandits(s1.ledger, { approvals: pending, now: at(2) });
  assert.equal(s1b.proposals.length, 0, 'no duplicate proposal while pending');
  assert.equal(s1b.ledger.experiments[0].status, 'draft');
  const approved = [{ id: 'A1', target: 'bandit:hero-cta:start', status: 'approved' }];
  const s2 = stepBandits(s1.ledger, { approvals: approved, now: T0 });
  const x = s2.ledger.experiments[0];
  assert.equal(x.status, 'running');
  assert.equal(s2.live.experiments.length, 1);
  const events = synth(x, { control: [400, 20], b: [400, 60] });
  const s3 = stepBandits(s2.ledger, { approvals: approved, events, now: at(5000) });
  const y = s3.ledger.experiments[0];
  assert.equal(y.status, 'winner');
  assert.equal(y.winner, 'b');
  assert.equal(s3.live.experiments.length, 0, 'winner is not served at 100% before rollout approval');
  assert.deepEqual(s3.proposals.map((p) => p.target), ['bandit:hero-cta:rollout']);
  assert.equal(s3.results[0].id, 'BX-hero-cta');
  assert.match(banditMarkdown('Demo', s3.report), /Hero CTA/);
  const s4 = stepBandits(s3.ledger, { approvals: [...approved, { target: 'bandit:hero-cta:rollout', status: 'approved' }], events, now: at(6000) });
  assert.equal(s4.ledger.experiments[0].status, 'rolled_out');
  assert.deepEqual(s4.live.experiments[0].weights, { control: 0, b: 1 });
  // Same inputs, same outputs.
  assert.deepEqual(stepBandits(s2.ledger, { approvals: approved, events, now: at(5000) }), s3);
});

test('rejected starts stop the draft; bad drafts and duplicates are reported, not merged', () => {
  const s = stepBandits({ experiments: [validateExperiment(draft()).experiment, { id: 'broken' }] }, {
    approvals: [{ target: 'bandit:hero-cta:start', status: 'rejected' }], drafts: [draft(), { id: 'x' }], now: T0,
  });
  assert.equal(s.ledger.experiments.length, 1);
  assert.equal(s.ledger.experiments[0].status, 'stopped');
  assert.equal(s.report.rejected.length, 3);
  assert.deepEqual(stepBandits('garbage', { now: T0 }).ledger.experiments, []);
});

test('budget guard: paid tests must fit caps and paid mode; running tests stop when caps drop', () => {
  const paid = draft({ cost: { daily: 20 } });
  assert.equal(budgetGuard(validateExperiment(paid).experiment, { budget: { mode: 'free' } }).ok, false);
  assert.equal(budgetGuard(validateExperiment(paid).experiment, { budget: { mode: 'paid', daily_cap: 10, monthly_cap: 1000 } }).ok, false);
  assert.equal(budgetGuard(validateExperiment(paid).experiment, { budget: { mode: 'paid', daily_cap: 50, monthly_cap: 1000, spent_this_month: 900 } }).ok, false);
  assert.equal(budgetGuard(validateExperiment(paid).experiment, { budget: { mode: 'paid', daily_cap: 50, monthly_cap: 2000 } }).ok, true);
  const s = stepBandits(null, { drafts: [paid], approvals: [{ target: 'bandit:hero-cta:start', status: 'approved' }], product: { budget: { mode: 'free' } }, now: T0 });
  assert.equal(s.ledger.experiments[0].status, 'draft');
  assert.equal(s.proposals.length, 0);
  assert.match(s.report.experiments[0].blocked, /free mode/);
  const r = stepBandits({ experiments: [running({ cost: { daily: 20 } })] }, { product: { budget: { mode: 'paid', daily_cap: 5 } }, now: at(10) });
  assert.equal(r.ledger.experiments[0].status, 'stopped');
});

test('client snippet assigns the same arm as the server, applies the variant and respects GPC', () => {
  const x = running();
  const weights = { control: 0.3, b: 0.7 };
  const live = resolveLive({ experiments: [{ id: x.id, element: x.element, page: '', goal: x.goal, weights, arms: [{ id: 'control', variant: { type: 'none' } }, { id: 'b', variant: { type: 'text', ref: 'outbox/cta.md' } }] }] }, (ref) => (ref === 'outbox/cta.md' ? '---\ntitle: x\n---\nGet a quote</script>' : null));
  assert.equal(live.experiments[0].arms[1].variant.value, 'Get a quote</script>');
  const js = clientSnippet(live, { endpoint: 'https://edge.example/', site: 'demo' });
  assert.ok(!js.includes('</script>'), 'config cannot close a script tag');
  const runIt = (vid, nav = {}) => {
    const el = { textContent: 'Original', style: {}, setAttribute() {}, className: '' };
    const beacons = [];
    const ctx = {
      navigator: { sendBeacon: (u, b) => { beacons.push(u); return true; }, ...nav }, Blob: class { constructor(p) { this.p = p; } },
      document: { querySelector: () => el, addEventListener() {} }, location: { pathname: '/' }, localStorage: { getItem() { return null; }, setItem() {} },
      Math, JSON, Object, fetch() {},
    };
    ctx.window = ctx; ctx.window.whalyomVid = vid;
    vm.runInNewContext(js, ctx);
    return { el, beacons, api: ctx.whalyomBandit };
  };
  for (const vid of ['alpha-visitor', 'beta-visitor', 'gamma-visitor', 'delta-visitor']) {
    const r = runIt(vid);
    const arm = chooseArm(x, vid, weights);
    assert.equal(r.api.arm(x.id), arm);
    assert.equal(r.el.textContent, arm === 'b' ? 'Get a quote</script>' : 'Original');
    assert.deepEqual(r.beacons, ['https://edge.example/bandit']);
  }
  const gpc = runIt('alpha-visitor', { globalPrivacyControl: true });
  assert.equal(gpc.el.textContent, 'Original');
  assert.equal(gpc.beacons.length, 0);
  assert.equal(gpc.api, undefined);
});

test('runBandits writes ledger, report, live table and a run file with approval proposals', () => {
  const dir = path.join(tmp, 'products', 'demo');
  fs.mkdirSync(path.join(dir, 'experiments', 'bandit-drafts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'product.json'), JSON.stringify({ name: 'Demo', budget: { mode: 'free', daily_cap: 0, monthly_cap: 0 } }));
  fs.writeFileSync(path.join(dir, 'experiments', 'bandit-drafts', 'hero.json'), JSON.stringify(draft()));
  const r = runBandits('demo', { base: tmp, now: T0 });
  assert.equal(r.experiments, 1);
  assert.equal(r.proposals, 1);
  assert.equal(r.run_file, 'products/demo/runs/BANDIT-2026-10-01.json');
  const run = JSON.parse(fs.readFileSync(path.join(tmp, r.run_file), 'utf8'));
  assert.equal(run.approvals[0].target, 'bandit:hero-cta:start');
  assert.ok(fs.existsSync(path.join(dir, 'experiments', 'bandit-drafts', 'done', 'hero.json')));
  assert.ok(fs.existsSync(path.join(dir, 'experiments', 'BANDITS.md')));
  runBandits('demo', { base: tmp, now: at(1) });
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, r.run_file), 'utf8')).approvals.length, 1, 'no duplicate proposal');
  assert.equal(writeBanditState(['demo'], { base: tmp, now: T0 }), 1);
  assert.ok(!fs.readFileSync(path.join(tmp, 'state', 'bandits.json'), 'utf8').includes('vid'));
  assert.throws(() => runBandits('../etc', { base: tmp }), /bad product slug/);
  assert.throws(() => runBandits('missing', { base: tmp }), /no product/);
});

test('review guards: obfuscated URL schemes, time zones, stable approval ids, owner stop, ledger safety', () => {
  // "java\tscript:" and leading control characters are still javascript: to a browser.
  assert.ok(validateExperiment(draft({ arms: [{ id: 'a' }, { id: 'b', variant: { type: 'attr', name: 'href', value: 'java\tscript:alert(1)' } }] })).errors);
  assert.ok(validateExperiment(draft({ arms: [{ id: 'a' }, { id: 'b', variant: { type: 'attr', name: 'href', value: '\u0001javascript:x' } }] })).errors);
  assert.equal(unsafeUrl('https://ok.example'), false);
  const refLive = resolveLive({ experiments: [{ id: 'x1', arms: [{ id: 'b', variant: { type: 'attr', name: 'href', ref: 'outbox/l.md' } }] }] }, () => 'JaVa\nScRiPt:alert(1)');
  assert.equal(refLive.experiments[0].arms[0].variant.type, 'none', 'unsafe value from a ref file is dropped');
  // Offsets: 01:30+02:00 is 23:30Z the day before, i.e. before the test started.
  const x = running();
  const v = hashVisitor('tz-visitor-1');
  const t = tally([x], [
    { at: '2026-10-01T01:30:00+02:00', kind: 'exposure', exp: x.id, arm: 'b', vid: v },
    { at: '2026-10-01T03:00:00+02:00', kind: 'exposure', exp: x.id, arm: 'control', vid: v },
    { at: '2026-10-01T01:00:00Z', kind: 'conversion', vid: v },
  ])[x.id];
  assert.deepEqual(t.control, { exposures: 1, conversions: 1, value: 0 });
  assert.equal(t.b.exposures, 0);
  // Proposals carry stable ids, so a later run before apply-results cannot queue a duplicate approval.
  const s1 = stepBandits(null, { drafts: [draft({ cost: { daily: 5 } })], product: { budget: { mode: 'paid', daily_cap: 10, monthly_cap: 1000 } }, now: T0 });
  assert.equal(s1.proposals[0].id, approvalId('hero-cta', 'start'));
  assert.equal(s1.proposals[0].amount, 140);
  assert.equal(stepBandits(s1.ledger, { product: { budget: { mode: 'paid', daily_cap: 10, monthly_cap: 1000 } }, now: at(5) }).proposals[0].id, s1.proposals[0].id);
  // Owner stop.
  const stopped = stepBandits({ experiments: [running()] }, { approvals: [{ target: 'bandit:hero-cta:stop', status: 'approved' }], now: at(10) });
  assert.equal(stopped.ledger.experiments[0].status, 'stopped');
  assert.equal(stopped.live.experiments.length, 0);
  // Invalid and duplicate ledger entries are kept aside, not erased.
  const kept = stepBandits({ experiments: [running(), running(), { id: 'broken' }] }, { now: at(10) });
  assert.equal(kept.ledger.experiments.length, 1);
  assert.equal(kept.ledger.invalid.length, 2);
  assert.equal(stepBandits(kept.ledger, { now: at(11) }).ledger.invalid.length, 2);
  // A ledger that does not parse is never overwritten.
  const dir = path.join(tmp, 'products', 'corrupt');
  fs.mkdirSync(path.join(dir, 'experiments'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'product.json'), '{}');
  fs.writeFileSync(path.join(dir, 'experiments', 'bandits.json'), '{"experiments": [');
  assert.throws(() => runBandits('corrupt', { base: tmp, now: T0 }), /not valid JSON/);
  assert.equal(fs.readFileSync(path.join(dir, 'experiments', 'bandits.json'), 'utf8'), '{"experiments": [');
  // Empty files are fine: treated as no ledger / no events.
  fs.writeFileSync(path.join(dir, 'experiments', 'bandits.json'), '');
  fs.writeFileSync(path.join(dir, 'experiments', 'bandit-events.jsonl'), '');
  assert.equal(runBandits('corrupt', { base: tmp, now: T0 }).experiments, 0);
});

test('CLI prints usage without arguments and a snippet for a product with no tests', () => {
  const u = spawnSync(process.execPath, [path.join(root, 'tools', 'bandit.mjs')], { encoding: 'utf8', cwd: root });
  assert.equal(u.status, 2);
  const s = spawnSync(process.execPath, [path.join(root, 'tools', 'bandit.mjs'), 'snippet', 'zz-no-such-product'], { encoding: 'utf8', cwd: root });
  assert.equal(s.status, 0, s.stderr);
  assert.match(s.stdout, /Whalyom bandit/);
  assert.equal(spawnSync(process.execPath, [path.join(root, 'tools', 'bandit.mjs'), 'snippet', '../x'], { encoding: 'utf8', cwd: root }).status, 1);
});
