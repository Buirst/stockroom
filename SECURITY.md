# Security

Stockroom reads your Claude Code settings and installed tools, and can edit `~/.claude/settings.json` (only after you
approve a plan, with a backup first). It makes no network requests. It starts local MCP servers only when you ask
(`--read-mcp`), and only servers you already configured and approved.

To report a vulnerability, use GitHub's private reporting: **Security → Report a vulnerability** on this repository.
Please do not open a public issue for it. You will get an answer within 7 days.
