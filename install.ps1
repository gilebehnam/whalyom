# Whalyom installer for Windows: checks Node, installs the two dependencies, builds the agents and the dashboard data.
#   ./install.ps1           set up this folder as a Whalyom workspace for Claude Code
#   ./install.ps1 -Codex    also copy the skills and the commands into ~/.codex for Codex
param([switch]$Codex)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host 'Whalyom needs Node.js 20 or newer: https://nodejs.org'; exit 1 }
$major = [int](node -p "process.versions.node.split('.')[0]")
if ($major -lt 20) { Write-Host "Whalyom needs Node.js 20 or newer (found $(node -v))."; exit 1 }

npm install --no-audit --no-fund
try { node tools/build-state.mjs | Out-Null } catch {}
if (-not (Test-Path .env)) { Copy-Item .env.example .env }

if ($Codex) {
  $home2 = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }
  New-Item -ItemType Directory -Force (Join-Path $home2 'skills'), (Join-Path $home2 'prompts') | Out-Null
  Get-ChildItem .claude/skills -Directory | ForEach-Object { $t = Join-Path $home2 "skills/$($_.Name)"; if (-not (Test-Path $t)) { Copy-Item $_.FullName $t -Recurse } }
  Get-ChildItem .claude/commands -Filter *.md | ForEach-Object { $t = Join-Path $home2 "prompts/$($_.Name)"; if (-not (Test-Path $t)) { Copy-Item $_.FullName $t } }
  Write-Host "Codex: skills and commands copied into $home2. AGENTS.md in this folder explains the rest."
}

node tools/stats.mjs | Out-Null
node -e "const s=require('./docs/STATS.json');console.log('\nWhalyom is ready: '+s.agents+' agents, '+s.departments+' departments, '+s.skills+' skills, '+s.commands+' commands, '+s.rules+' rules, '+s.knowledge_notes+' verified notes.')"
Write-Host "Next: run 'claude' here, then /whalyom-new <slug> <domain>."
