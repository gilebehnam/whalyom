#!/usr/bin/env sh
# Whalyom installer: checks Node, installs the two dependencies, builds the agents and the dashboard data.
#   ./install.sh            set up this folder as a Whalyom workspace for Claude Code
#   ./install.sh --codex    also link the skills and the commands into ~/.codex for Codex
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then echo "Whalyom needs Node.js 20 or newer: https://nodejs.org"; exit 1; fi
major=$(node -p "process.versions.node.split('.')[0]")
if [ "$major" -lt 20 ]; then echo "Whalyom needs Node.js 20 or newer (found $(node -v))."; exit 1; fi

npm install --no-audit --no-fund
node tools/build-state.mjs >/dev/null 2>&1 || true
[ -f .env ] || cp .env.example .env

if [ "$1" = "--codex" ]; then
  CODEX="${CODEX_HOME:-$HOME/.codex}"
  mkdir -p "$CODEX/skills" "$CODEX/prompts"
  for d in .claude/skills/*/; do n=$(basename "$d"); [ -e "$CODEX/skills/$n" ] || ln -s "$PWD/$d" "$CODEX/skills/$n"; done
  for f in .claude/commands/*.md; do n=$(basename "$f"); [ -e "$CODEX/prompts/$n" ] || ln -s "$PWD/$f" "$CODEX/prompts/$n"; done
  echo "Codex: skills in $CODEX/skills, commands in $CODEX/prompts. AGENTS.md in this folder explains the rest."
fi

node tools/stats.mjs >/dev/null
node -e "const s=require('./docs/STATS.json');console.log('\nWhalyom is ready: '+s.agents+' agents, '+s.departments+' departments, '+s.skills+' skills, '+s.commands+' commands, '+s.rules+' rules, '+s.knowledge_facts+' verified facts.')"
echo "Next: run 'claude' here, then /whalyom-new <slug> <domain>."
