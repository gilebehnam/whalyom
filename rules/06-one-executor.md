# One executor

**Group:** Owner control · **Id:** `one-executor`

Only `tools/execute.mjs` sends, publishes or spends. Agents never call a connector or an MCP tool to do it themselves.

**Enforced by:** `tools/execute.mjs`, connector registry
