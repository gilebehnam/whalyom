// live-snapshot: a heartbeat left behind by a crashed run shows as 'stale', not 'active', and tasks
// with status 'running' are counted. Run: node --test tools/test/live-snapshot.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { root } from '../lib/env.mjs';
import { testEnv } from './_env.mjs';

const slug = `zz-live-${process.pid}`;
const dir = path.join(root, 'products', slug);
const put = (f, v) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), JSON.stringify(v)); };
const st = (n) => JSON.parse(fs.readFileSync(path.join(root, 'state', `live-${n}.json`), 'utf8'));
const snapshot = () => {
  const r = spawnSync(process.execPath, [path.join(root, 'tools', 'live-snapshot.mjs')], { encoding: 'utf8', env: testEnv() });
  assert.equal(r.status, 0, r.stderr || r.stdout);
};
// Remove the fixture and rebuild state/live-*.json so the real snapshot does not keep the fixture product.
after(() => { fs.rmSync(dir, { recursive: true, force: true }); spawnSync(process.execPath, [path.join(root, 'tools', 'live-snapshot.mjs'), '--idle'], { encoding: 'utf8', env: testEnv() }); });

const STALE_AGENT = 'om-build-in-public-coach';
const LIVE_AGENT = 'om-growth-loop-engineer';

test('a heartbeat older than 2 hours is stale, a fresh one is active, running tasks are counted', () => {
  const before = (() => { try { return st('state').counts.running ?? 0; } catch { return 0; } })();
  put('product.json', { name: 'Live snapshot fixture', stage: 'active' });
  put('tasks.json', [
    { id: 't1', title: 'crashed task', agent: STALE_AGENT, status: 'running' },
    { id: 't2', title: 'live task', agent: LIVE_AGENT, status: 'todo' },
  ]);
  put('runs/t1.start', { task_id: 't1', agent: STALE_AGENT, started_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(), doing: 'crashed task' });
  put('runs/t2.start', { task_id: 't2', agent: LIVE_AGENT, started_at: new Date().toISOString(), doing: 'live task' });
  snapshot();

  const agents = st('agents').agents;
  assert.equal(agents[STALE_AGENT].status, 'stale');
  assert.equal(agents[LIVE_AGENT].status, 'active');
  const state = st('state');
  assert.ok(state.counts.running >= 1, 'running tasks are counted');
  assert.ok(state.counts.running >= before);
  assert.equal(state.counts.active, Object.values(agents).filter((a) => a.status === 'active').length, 'only fresh heartbeats count as active');
  assert.ok(state.counts.stale >= 1);
  const ev = st('events').events;
  assert.ok(ev.some((e) => e.product === slug && e.agent === STALE_AGENT && e.kind === 'stale'));
  assert.ok(ev.some((e) => e.product === slug && e.agent === LIVE_AGENT && e.kind === 'start'));
  const nodes = st('graph').nodes;
  assert.equal(nodes.find((n) => n.id === `t:${slug}:t1`).status, 'running', 'stale agent does not light its task as active');
  assert.equal(nodes.find((n) => n.id === `t:${slug}:t2`).status, 'active');
});

test('with only a stale heartbeat the room is idle, not stuck on running', () => {
  fs.rmSync(path.join(dir, 'runs', 't2.start'), { force: true });
  snapshot();
  const agents = st('agents').agents;
  assert.equal(agents[STALE_AGENT].status, 'stale');
  assert.notEqual(agents[LIVE_AGENT]?.status, 'active');
  const state = st('state');
  const liveElsewhere = Object.values(agents).filter((a) => a.status === 'active').length;
  assert.equal(state.counts.active, liveElsewhere);
  if (liveElsewhere === 0) assert.equal(state.mode, 'idle');
});
