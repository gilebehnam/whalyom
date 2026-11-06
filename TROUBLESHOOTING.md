# Troubleshooting

## Install

| Problem | Fix |
|---|---|
| `Whalyom needs Node.js 20 or newer` | Install the current LTS from [nodejs.org](https://nodejs.org) and open a new terminal. |
| Windows: `running scripts is disabled on this system` | Run the installer this way: `powershell -ExecutionPolicy Bypass -File .\install.ps1` |
| `npm install` fails behind a proxy | Set `npm config set proxy http://host:port` (and `https-proxy`), then run the installer again. |
| The commands do not appear in Claude Code | Start `claude` from the Whalyom folder (project commands live in `.claude/commands/`), or install the plugin and type `/whalyom:`. |
| Codex does not see the skills | Run the installer with `--codex` (Windows: `-Codex`) and restart Codex. `CODEX_HOME` changes where they go. |

## Running

| Problem | Fix |
|---|---|
| `tools/lib/claude-run.mjs refuses to start` | Headless AI runs need `WHALYOM_ANTHROPIC_API_KEY` in `.env`. Inside an interactive Claude Code session you do not need it. |
| The Command Center is empty | Run `node tools/build-state.mjs` and `node tools/live-snapshot.mjs`, then `npm run command-center`. |
| A product shows nothing | Check `products/<slug>/product.json` has `"stage": "active"`, then run `node tools/daemon.mjs` once. |
| Nothing is sent or published | That is by design: approve the item first (`/approvals`), then `node tools/execute.mjs <slug>` sends it through a configured connector. |
| A connector says "missing key" | `node tools/integrations.mjs --missing` lists the keys; put them in `.env`. |
| Something is broken | `node tools/self-debug.mjs`, then `/self-heal`. Open an issue with the output (never paste keys or customer data). |
