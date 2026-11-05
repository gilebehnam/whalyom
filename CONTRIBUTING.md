# Contributing

Thank you for making Whalyom better. Four kinds of contributions help most.

## A new agent

Agents are generated, not hand-written. Add the definition to the right roster file in `tools/` (for example `tools/roster-wave9.mjs`), give it a department (`dept`), a layer and the skills it uses, then:

```bash
node tools/check-skills.mjs     # every referenced skill must exist
node tools/build-agents.mjs     # writes .claude/agents/om-*.md
npm test
```

Or describe it in a form and let the system check it: `node tools/agent-builder.mjs options`.

## A new skill

Add `.claude/skills/<name>/SKILL.md` in the Agent Skills format (frontmatter `name` and `description`, then the method). Say when to use it in the description. Keep claims sourced.

## A new command

Commands come from one catalog: add an entry to `COMMANDS` in `tools/commands.mjs` and run `node tools/commands.mjs`. A command points at something that already exists: an `om` skill command, a workflow or a tool.

## A knowledge source

Add an official or research feed to `knowledge/sources.json` with its topic. Sources must be primary (the platform's own docs, the regulator, peer-reviewed research), never a blog summarising them.

## The rules for every pull request

- `npm test`, `npm run commands` and `npm run rules` pass.
- No secrets, no personal data, no real customer names in examples.
- The rules in `rules/` and the guards in `tools/policy.mjs`, `tools/execute.mjs` and `tools/budget.mjs` are only made stricter, never looser.
