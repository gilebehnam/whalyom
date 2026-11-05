# Site changes are reviewed diffs

**Group:** Owner control · **Id:** `safe-site-changes`

Changes to a live site are prepared as files or a diff with a test and a rollback, staged first, and applied only after approval; installers add files and never delete.

**Enforced by:** om-site-engineer, `tools/connectors/site-install.mjs`
