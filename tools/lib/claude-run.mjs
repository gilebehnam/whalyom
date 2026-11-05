// Headless Claude Code runs started by the Command Center (Ignite) and the hub (queued onboardings,
// the hosted daily cycle). Two things matter here:
//   1. Permissions. These runs read untrusted web content (crawled pages, reviews, competitor sites), so
//      a prompt injection must not be able to approve, spend or change the guards. The run may only call
//      the listed tools/ scripts, may not edit the ledgers, product.json, config/, tools/, .env or CI, and
//      may not read .env. Ledgers change only through tools/apply-results.mjs; approvals only through
//      the owner (dashboard, /om approve) and tools/policy.mjs.
//   2. Windows. spawn(..., {shell:true}) joins arguments without escaping, so cmd reads "<id>" as a
//      redirect and splits quoted prompts. The prompt goes on stdin and claude.exe is started directly;
//      only an npm-style claude.cmd falls back to cmd, with every argument quoted.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const TOOLS = ['apply-results', 'build-state', 'budget', 'knowledge', 'evolve', 'killswitch', 'build-agents', 'validate', 'self-debug',
  'needs-you-know', 'metrics', 'learn', 'execute', 'ready', 'policy', 'landing-builder', 'check-skills', 'sync-sites', 'sync-manifest',
  'new-product', 'live-snapshot', 'connectors-status'];
export const HEADLESS_ALLOWED = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Agent', 'Skill', 'Workflow', ...TOOLS.map((t) => `Bash(node tools/${t}.mjs:*)`)];
export const HEADLESS_DENIED = [
  'Bash(*--owner*)', 'Bash(node tools/apply-decisions.mjs:*)', 'Bash(node tools/budget.mjs --record:*)',
  ...['**/approvals.json', '**/tasks.json', '**/experiments.json', '**/transitions.json', '**/product.json', '**/ledger.jsonl',
    '**/.env', '**/.env.*', 'config/**', 'tools/**', '.github/**', '.claude/settings*.json', 'sites/**'].map((p) => `Edit(${p})`),
  'Read(**/.env)', 'Read(sites/**)',
];

const quoteCmd = (a) => `"${String(a).replace(/"/g, '""')}"`;
function resolveClaude(env = process.env) {
  if (env.OM_CLAUDE_BIN) return { bin: env.OM_CLAUDE_BIN, shell: /\.(cmd|bat)$/i.test(env.OM_CLAUDE_BIN) };
  if (process.platform !== 'win32') return { bin: 'claude', shell: false };
  for (const dir of String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)) {
    if (fs.existsSync(path.join(dir, 'claude.exe'))) return { bin: path.join(dir, 'claude.exe'), shell: false };
  }
  return { bin: 'claude.cmd', shell: true };
}

export function claudeArgs({ extraAllowed = [] } = {}) {
  return ['-p', '--output-format', 'json', '--allowedTools', [...HEADLESS_ALLOWED, ...extraAllowed].join(','), '--disallowedTools', HEADLESS_DENIED.join(',')];
}

// The real cost of a finished headless run: the last JSON result line `claude -p --output-format json`
// wrote to its log (total_cost_usd, usage). null when the run printed none.
export function runCostFromLog(logFile, { tailBytes = 65536 } = {}) {
  let text = '';
  try { const st = fs.statSync(logFile); const fd = fs.openSync(logFile, 'r'); const len = Math.min(st.size, tailBytes); const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, st.size - len); fs.closeSync(fd); text = buf.toString('utf8'); } catch { return null; }
  for (const line of text.split(/\r?\n/).reverse()) {
    const t = line.trim();
    if (!t.startsWith('{') || !t.includes('total_cost_usd')) continue;
    try { const j = JSON.parse(t); const usd = Number(j.total_cost_usd); if (Number.isFinite(usd)) return { usd, input_tokens: j.usage?.input_tokens ?? null, output_tokens: j.usage?.output_tokens ?? null, cache_read_tokens: j.usage?.cache_read_input_tokens ?? null }; } catch { /* not JSON */ }
  }
  return null;
}

// Every headless run bills Claude Platform, never the owner's Claude Code subscription: the Platform key in
// WHALYOM_ANTHROPIC_API_KEY is passed to the child as ANTHROPIC_API_KEY. Without it the run does not start,
// unless the owner set OM_ALLOW_SUBSCRIPTION=1 on purpose.
export function platformEnv(env = process.env) {
  const key = String(env.WHALYOM_ANTHROPIC_API_KEY ?? '').trim();
  if (key) { const { ANTHROPIC_AUTH_TOKEN, ...rest } = env; return { ...rest, ANTHROPIC_API_KEY: key }; }
  if (env.OM_ALLOW_SUBSCRIPTION === '1') return env;
  throw new Error('WHALYOM_ANTHROPIC_API_KEY is not set: Whalyom runs AI work on Claude Platform only (add the key in .env)');
}

// Starts `claude -p` with the prompt on stdin; output goes to the open file descriptor `out`.
export function runClaude(prompt, { cwd, out, extraAllowed = [], detached = false, env: baseEnv = process.env } = {}) {
  const env = platformEnv(baseEnv);
  const { bin, shell } = resolveClaude(env);
  const args = claudeArgs({ extraAllowed });
  const child = shell
    ? spawn([quoteCmd(bin), ...args.map(quoteCmd)].join(' '), { cwd, detached, stdio: ['pipe', out, out], shell: true, env })
    : spawn(bin, args, { cwd, detached, stdio: ['pipe', out, out], env });
  child.stdin?.on('error', () => { /* the process failed to start; the 'error' event reports it */ });
  child.stdin?.end(prompt);
  return child;
}
