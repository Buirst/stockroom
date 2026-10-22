# Changelog

## 0.4.1 (2026-10-22)

- The one-time reminder asks Claude to read the SKILL.md of the tool the map names, not only to grep the map. In
  the real test Claude found the tool after the reminder but only added its name to the plan.

## 0.4.0 (2026-10-22)

- `"auto": true`: the shelf keeps itself up to date. Reading the SKILL.md of something Stockroom turned off turns it
  back on at once; once a day the session hook re-plans and applies the shelf in the background. Logged in
  `auto.log`; `undo` reverts.
- On-use rules now reach skills under `~/` (plugins, personal skills): `Read(**/SKILL.md)` only matched files under the
  working folder.

## 0.3.5 (2026-10-22)

- The reminder now fires when Claude writes a plan. Plans live in `~/.claude/plans`, and the hook looked for them under
  the working folder, so in the real test it never fired on a plan write.

## 0.3.4 (2026-10-22)

- With a map: a one-time reminder per session, when Claude writes a plan, leaves plan mode or searches the web or the
  tool list without having looked at the map yet. In the real test the remaining misses never opened the map.

## 0.3.3 (2026-10-22)

- The session line says that a tool marked "off: read <path>" in the map works now through that file.

## 0.3.2 (2026-10-22)

- The map index (`by-function.md`) shows the SKILL.md path of a turned-off first tool on its own line. In the real
  test Claude only grepped the index, never the section files, so the 0.3.1 paths were out of its sight.

## 0.3.1 (2026-10-22)

- The map index sections give each skill's SKILL.md path, and the session line says a tool works through its SKILL.md
  even when it is off. In the real test, Claude found turned-off tools in the map but proposed turning them on instead
  of reading them (strict score 3/10).
- Rule tables: `web`, `app` and `CLI` tools no longer warn "matches no installed tool".

## 0.3.0 (2026-10-22)

Tool rules and projects, from the map.

- Rule tables in the map (`Tool | Rule | Level | Project`, English or Spanish headers). `rules plan` / `rules apply`
  write `~/.claude/rules/stockroom-critical.md` (always loaded) and one `stockroom-<project>.md` per project, loaded
  by path. Files Stockroom did not write are never touched; `undo` removes the ones it wrote.
- On-use rules: a `PreToolUse` hook shows a skill's rules to Claude when it launches the skill or reads its
  `SKILL.md`. MCP calls are not hooked (cost measured: one Node start-up per call).
- The session-start hook keeps the rule files in step with the map, keeps the previous files if an edit would drop a
  critical rule, and mentions any internal error in its line (details in `errors.log`, which replaces `hook.log`).
- The shelf never turns off a tool named by a critical rule (`Kept on` in `shelf plan`).
- `report`: whether the map is used (map reads followed by a tool they named; rows consulted and followed; rules
  shown on use; bytes loaded every session).
- `doctor`: health check for hooks, generated rules and project paths.
- The catalog shows each tool's rules; `check` warns about rule sizes, unknown projects and MCP rules.
- The panel and map skills follow fixed steps: plan, explicit yes, apply.

## 0.2.0 (2026-10-21)

First public release.

- Catalog of every installed skill, plugin, MCP server, hook, subagent and command, with each original description in
  full, written outside the context on session start (only when something changed).
- `/stockroom` panel: status, map check, catalog rebuild, shelf (turn unused tools off with a backup), undo.
- `/stockroom map`: Claude drafts a tool map (one row per job, the tool to use first, and why); you approve every row.
- `shelf` modes: `map`, `usage`, `list`, `none`, with `neverOff`, `alwaysOff` and per-section rules.
- `map index`: a short index of the map to load instead of a long tool guide.
