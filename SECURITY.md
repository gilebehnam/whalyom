# Security

Whalyom can hold connector keys and act on ad accounts, email and social profiles. Please report anything that could let it send, publish or spend without the owner's approval, leak personal data or keys, or follow instructions hidden in web pages, emails or reviews.

**Report privately** through GitHub's "Report a vulnerability" on this repository, or by email to bjafaribox@gmail.com. Please do not open a public issue for security problems.

What is in scope:

- bypassing an approval, a spend cap, consent or suppression checks (`tools/policy.mjs`, `tools/execute.mjs`, `tools/budget.mjs`, `tools/sequences.mjs`);
- prompt injection that makes an agent take an outbound action;
- secrets or personal data written to `state/`, logs, dashboards or the repository;
- the MCP server (`tools/mcp/`) and the local Command Center (`tools/server.mjs`).

Install only from this repository and its plugin marketplace entry. Copies elsewhere are not reviewed.
