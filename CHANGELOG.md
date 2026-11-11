# Changelog

## 0.6.1 (2026-11-11)

Hardening, from an audit of three weeks of real use.

- **settings.json is written whole or not at all.** Stockroom wrote it in place; a hook cut off at its timeout in the
  middle of a write could leave it broken. It now writes a temp file and renames it, retries while another program
  holds the file, and, if something else changed settings.json between the read and the write, makes its change again
  on the new content instead of overwriting it.
- **One Stockroom process at a time changes the settings.** Hooks of two sessions and the daily run could write at
  once and lose each other's changes (measured: 12 at once kept 5 to 9, some unrecorded). A lock makes them take
  turns: 12 of 12 kept and recorded, four runs in a row.
- **A broken `applied.json` stops `shelf apply` before settings.json changes.** Before, the settings were written first
  and the record after, so a failure in between left changes that `undo` could not revert.
- **Skills a plugin update renamed or removed.** A map row or a rule that names `plugin:skill` keeps pointing nowhere
  after the plugin drops that skill, and nothing said so. Now `stockroom check` lists them first, `doctor` reports
  them as a problem, the job index marks the row as gone, and the session is told once when it happens.
- **A skill whose frontmatter name differs from its folder answers to both names.** Claude Code launches
  `taste-skill/skills/taste-skill` as `taste-skill:design-taste-frontend`; Stockroom knew only the folder name, so
  those launches were not counted as use and its rules were not shown.
- `check` lists the tools used three times or more in the last `days` that no row names, most used first: the rows
  worth adding. A map that follows what is really used stays useful.
- `report` separates the sessions that read the map on their own from the ones where you named Stockroom, and no
  longer counts `claude -p` runs (scripts, benchmarks) as your sessions.
- Housekeeping: settings and rules backups are kept to the newest 30; reminder flags of sessions that ended more than
  two weeks ago are deleted.

## 0.6.0 (2026-11-07)

- `stockroom scan`: a read-only check anyone can run without installing (`npx github:Buirst/stockroom scan`). It
  counts the skills Claude sees in every session, how many were not used in the last 30 days (`--days N`) and their
  share of the listing, and prints one line to share. It writes nothing.
- `package.json` declares the `stockroom` command, so `npx` can run it straight from GitHub.

## 0.5.4 (2026-10-29)

- `keepTop` counts a SKILL.md read again when the tool was on: Claude chose it from the listing, and project skills are
  often opened that way. A read that woke a tool from off still does not count (0.5.3 dropped every read, which would
  have turned off skills used only by reading).
- A shell command that only searches for a SKILL.md path (`grep`, `find`, `rg`) is no longer taken as a read: it woke
  the skill, showed its notice and counted as use. Only commands that print the file count (`cat`, `sed`, `head`,
  `Get-Content`…).

## 0.5.3 (2026-10-29)

- A tool used or read in the last day is never turned off by the `usage` shelf. Before, a skill woken by a read could
  go off again a few hours later in the next daily run.
- `keepTop` ranks tools by launches only. Reading a SKILL.md still wakes a tool and keeps it on for the day, but
  Claude can read a skill and then pass it over, so a read no longer counts as a launch.
- A SKILL.md read through a path the shell builds (`$I/skills/x/SKILL.md`, a relative path) now counts as use of the
  skill with that folder name. Before, it was recorded under the literal path and credited to no skill.
- `auto.log` gives each turned-off tool its real reason (it said "unused 30 days" even for `keepTop`) and logs, every
  day, how many tools are on, so you can see whether the shelf holds or creeps up.

## 0.5.2 (2026-10-24)

- One line next to each prompt (a `UserPromptSubmit` hook, about 0.15 s) tells Claude to grep the map for the job in
  its own words before exploring files. Why: in a test where tasks share no keyword with the tool's description or map
  row, the misses came from sessions that searched the disk for all their turns and never reached the plan write that
  fires the one-time reminder. With the line those misses passed 5 of 6 runs (3 of 4 counting only runs where the tool
  was still off), and plain questions still touched no tool (4 of 4).

## 0.5.1 (2026-10-23)

- An MCP server or connector added recently is no longer turned off as unused: they carry no install date, so
  Stockroom now records when it first sees each one (`first-seen.json`) and counts that as the install. Before, a
  server added today went off in the next daily run, and an MCP server cannot come back on by being used.
- `keepTop` never turns off an MCP server, or a plugin that holds one, for the same reason.
- Hook notices (rules, the fit-to-task line, a tool back on) are on separate lines.

## 0.5.0 (2026-10-23)

- New `keepTop` for `"usage"`: only the N most-used tools stay on; everything else goes off and stays findable through
  the catalog. Why: in an A/B test of 10 tasks, a small set of tools on scored the same as 208 on (within noise), for about
  40% less per task. With `keepTop`, a new install gets 7 days to be tried instead of `days`.
- `claude -p` sessions (entrypoint `sdk-cli`: scripts and benchmarks) no longer count as use.
- The one-time reminder now says to keep the plan as it is when the map names nothing better, instead of rewriting it.
- When Claude opens a skill, one line asks it to take only the steps the task asks for and to leave Stockroom out of
  the answer. In the A/B (judge with web access) plans built on skills went from 7.75 to 8.20 on "proportionate", and
  answers naming Stockroom or its map from 3 in 10 to 0.

## 0.4.4 (2026-10-22)

- Reading a SKILL.md from the shell (`cat`, `sed`, `head`, `Get-Content`) now counts like the Read tool: it shows the
  tool's on-use rules, turns an off tool back on with `"auto"`, and counts as use for the shelf. The hook only starts
  for shell commands that name a SKILL.md (`Bash(*SKILL.md*)`), so other commands cost nothing.
- The one-time reminder no longer fires when Claude already grepped the map through `~/` or `$HOME/`: those paths now
  count as reading the catalog.

## 0.4.3 (2026-10-22)

- A recent install only keeps a tool on; it never turns back on a tool Stockroom already turned off (0.4.2 would have
  turned back on every off tool installed in the last `days`). Turning one back on still needs a real use.

## 0.4.2 (2026-10-22)

- Installing counts as a use: with `"usage"` and the automatic shelf, a plugin installed (or a personal skill added or
  edited) less than `days` ago is never turned off as unused. Before, a tool installed today went off in the next daily run.

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
