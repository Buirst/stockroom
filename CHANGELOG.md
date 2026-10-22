# Changelog

## 0.2.0 (2026-10-21)

First public release.

- Catalog of every installed skill, plugin, MCP server, hook, subagent and command, with each original description in
  full, written outside the context on session start (only when something changed).
- `/stockroom` panel: status, map check, catalog rebuild, shelf (turn unused tools off with a backup), undo.
- `/stockroom map`: Claude drafts a tool map (one row per job, the tool to use first, and why); you approve every row.
- `shelf` modes: `map`, `usage`, `list`, `none`, with `neverOff`, `alwaysOff` and per-section rules.
- `map index`: a short index of the map to load instead of a long tool guide.
