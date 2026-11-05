// loadEnv opt-out: OM_NO_DOTENV=1 keeps a stripped child environment stripped (no key refilled from .env),
// OM_ENV_FILE moves the default file, and the opt-out can only tighten (OM_KILL=1 still applies).
// Run: node --test tools/test/env.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnv, root } from '../lib/env.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whalyom-envtest-'));
const file = path.join(dir, '.env');
fs.writeFileSync(file, 'ZZ_FAKE_KEY=1\nZZ_FAKE_BLANK=filled\n');
const saved = { ...process.env };
const reset = () => { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); };
after(() => { reset(); fs.rmSync(dir, { recursive: true, force: true }); });

test('OM_NO_DOTENV=1 loads nothing, not even keys blanked to ""', () => {
  reset(); delete process.env.ZZ_FAKE_KEY; process.env.ZZ_FAKE_BLANK = ''; process.env.OM_NO_DOTENV = '1';
  loadEnv(file);
  assert.equal(process.env.ZZ_FAKE_KEY, undefined);
  assert.equal(process.env.ZZ_FAKE_BLANK, '');
});

test('without the flag the file fills unset and empty keys', () => {
  reset(); delete process.env.ZZ_FAKE_KEY; delete process.env.OM_NO_DOTENV; process.env.ZZ_FAKE_BLANK = '';
  loadEnv(file);
  assert.equal(process.env.ZZ_FAKE_KEY, '1');
  assert.equal(process.env.ZZ_FAKE_BLANK, 'filled');
});

test('the opt-out cannot loosen: a kill switch in the file still applies, nothing else does', () => {
  const kill = path.join(dir, 'kill.env');
  fs.writeFileSync(kill, 'OM_KILL=1\nZZ_FAKE_KEY=1\n');
  reset(); delete process.env.ZZ_FAKE_KEY; process.env.OM_KILL = ''; process.env.OM_NO_DOTENV = '1';
  loadEnv(kill);
  assert.equal(process.env.OM_KILL, '1');
  assert.equal(process.env.ZZ_FAKE_KEY, undefined);
});

test('a spawned tool with OM_ENV_FILE and OM_NO_DOTENV=1 sees no key; with OM_ENV_FILE alone it does', () => {
  const env = Object.fromEntries(Object.entries(saved).filter(([k]) => k !== 'ZZ_FAKE_KEY' && k !== 'OM_NO_DOTENV'));
  const probe = (extra) => spawnSync(process.execPath, ['-e', "import('./tools/lib/env.mjs').then(m=>{m.loadEnv();console.log(process.env.ZZ_FAKE_KEY??'none')})"], { cwd: root, encoding: 'utf8', env: { ...env, OM_ENV_FILE: file, ...extra } });
  const off = probe({ OM_NO_DOTENV: '1' });
  assert.equal(off.status, 0, off.stderr);
  assert.equal(off.stdout.trim(), 'none');
  const on = probe({});
  assert.equal(on.status, 0, on.stderr);
  assert.equal(on.stdout.trim(), '1');
});
