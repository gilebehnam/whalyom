// Log rotation: tools/lib/rotate.mjs and the daemon hook that rotates products/<slug>/events.jsonl
// and state/*.log once per cycle.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rotate, rotationDefaults, tailLines, logsIn, DEFAULT_MAX_BYTES, DEFAULT_KEEP } from '../lib/rotate.mjs';
import { rotateLogs } from '../daemon.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-rotate-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const lines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);

test('defaults are 5 MB and 3 copies; env overrides are validated', () => {
  assert.equal(DEFAULT_MAX_BYTES, 5 * 1024 * 1024); assert.equal(DEFAULT_KEEP, 3);
  assert.deepEqual(rotationDefaults({}), { maxBytes: DEFAULT_MAX_BYTES, keep: 3 });
  assert.deepEqual(rotationDefaults({ OM_LOG_MAX_BYTES: '1000', OM_LOG_KEEP: '5' }), { maxBytes: 1000, keep: 5 });
  assert.deepEqual(rotationDefaults({ OM_LOG_MAX_BYTES: '-1', OM_LOG_KEEP: '0' }), { maxBytes: DEFAULT_MAX_BYTES, keep: 3 });
});

test('rotates past the limit, shifts copies, keeps N and drops the oldest', () => {
  const f = path.join(tmp, 'events.jsonl');
  assert.equal(rotate(f, { maxBytes: 10 }).reason, 'missing');
  fs.writeFileSync(f, 'a\n');
  assert.equal(rotate(f, { maxBytes: 10 }).rotated, false, 'under the limit');
  for (const gen of ['g1', 'g2', 'g3', 'g4']) {
    fs.writeFileSync(f, `${gen}-line-1\n${gen}-line-2\n`);
    assert.equal(rotate(f, { maxBytes: 10, keep: 3 }).rotated, true);
    assert.equal(fs.existsSync(f), false, 'live file moved away; the next append creates it');
  }
  assert.deepEqual(lines(`${f}.1`), ['g4-line-1', 'g4-line-2']);
  assert.deepEqual(lines(`${f}.3`), ['g2-line-1', 'g2-line-2']);
  assert.equal(fs.existsSync(`${f}.4`), false, 'only 3 old copies kept; g1 dropped');
  // The writer keeps appending by path: new lines land in a fresh file, nothing is lost.
  fs.appendFileSync(f, 'after-rotation\n');
  assert.deepEqual(lines(f), ['after-rotation']);
  assert.deepEqual(tailLines(f, 3), ['g4-line-1', 'g4-line-2', 'after-rotation'], 'tailLines reads across the rotation');
});

test('a file with a partial last line is not rotated (no cut lines)', () => {
  const f = path.join(tmp, 'partial.jsonl');
  fs.writeFileSync(f, '{"a":1}\n{"b":');
  const r = rotate(f, { maxBytes: 4 });
  assert.equal(r.rotated, false); assert.match(r.reason, /partial/);
  fs.appendFileSync(f, '2}\n');
  assert.equal(rotate(f, { maxBytes: 4 }).rotated, true);
  assert.deepEqual(lines(`${f}.1`).map((l) => JSON.parse(l)), [{ a: 1 }, { b: 2 }]);
});

test('daemon rotateLogs covers every product events.jsonl and state/*.log only', () => {
  const base = path.join(tmp, 'repo');
  for (const p of ['alpha', 'beta', '_template']) fs.mkdirSync(path.join(base, 'products', p), { recursive: true });
  fs.mkdirSync(path.join(base, 'state'), { recursive: true });
  const big = 'x'.repeat(40) + '\n';
  fs.writeFileSync(path.join(base, 'products', 'alpha', 'events.jsonl'), big);
  fs.writeFileSync(path.join(base, 'products', 'beta', 'events.jsonl'), 'small\n');
  fs.writeFileSync(path.join(base, 'state', 'hub.log'), big);
  fs.writeFileSync(path.join(base, 'state', 'live-state.json'), big);
  assert.deepEqual(logsIn(path.join(base, 'state')).map((f) => path.basename(f)), ['hub.log']);
  const rotated = rotateLogs({ base, opts: { maxBytes: 20, keep: 3 } });
  assert.deepEqual(rotated.sort(), ['products/alpha/events.jsonl', 'state/hub.log']);
  assert.ok(fs.existsSync(path.join(base, 'products', 'alpha', 'events.jsonl.1')));
  assert.ok(fs.existsSync(path.join(base, 'products', 'beta', 'events.jsonl')), 'under the limit stays');
  assert.ok(fs.existsSync(path.join(base, 'state', 'live-state.json')), 'non-log state files are never touched');
  assert.deepEqual(rotateLogs({ base: path.join(tmp, 'empty'), opts: { maxBytes: 20, keep: 3 } }), []);
});
