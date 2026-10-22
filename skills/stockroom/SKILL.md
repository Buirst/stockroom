---
name: stockroom
description: Stockroom panel. Use when the user asks what tools are installed or turned off, wants to check their tool map or tool rules, rebuild the catalog, see whether the map is being used, or turn unused tools off or back on (with a backup).
---

# Stockroom panel

The CLI is `bin/stockroom.js` two folders above this skill's base directory. Run it with Node from the user's
working folder: `node "<base directory>/../../bin/stockroom.js" <command>`.

## Fixed rules for this panel

- Run only these commands: `status`, `check`, `catalog`, `catalog --read-mcp`, `doctor`, `report`, `shelf plan`,
  `shelf apply`, `rules plan`, `rules apply`, `undo`, `map init`, `map index`, `map draft-data`. Nothing else.
- Every change follows the same three steps, never fewer: run the `plan` command and show its whole output → wait for
  an explicit yes to that plan → run the matching `apply`. A yes to something else is not a yes to the plan.
- Never edit `settings.json`, files in `~/.claude/rules/`, or the map by hand. The map changes only through the
  `stockroom-map` skill, after the user's yes.
- `config.json` changes only as in "Set rules in the user's words" below: show the exact change, write it after a yes.
- If a command fails, show its message as it is and stop; do not work around it.

## Steps

1. Run `status` and show the result in a few lines.
2. If `mapFiles` in `~/.claude/stockroom/config.json` is empty, offer the setup first: "Claude can draft your tool
   map: one row per job, the tool to use first, and why, plus the rules for each tool. You decide every row." Let the
   user pick **section by section**, **all at once**, or **not now**. Then read
   `<base directory>/../stockroom-map/SKILL.md` and follow it in that mode.
3. Offer these actions and wait for a choice:
   - **Check the map** (`check`): names that match no installed tool, tools no row names, and rule warnings (sizes,
     unknown projects, rules for MCP servers).
   - **Health check** (`doctor`): hooks registered, generated rules in step with the map, project paths that find
     files. Show every `problem:` line with its fix.
   - **Is the map being used?** (`report`, `report --days 30`): map reads followed by a tool they named, rows
     consulted and followed, rules shown on use, and what Stockroom loads in every session.
   - **Apply the rules** (`rules plan`, then `rules apply` after a yes): writes the critical rules file and one file
     per project to `~/.claude/rules/`, and the index the on-use hook reads. Say that a file Stockroom did not write is
     never touched, and that `undo` removes them.
   - **Rebuild the catalog** (`catalog`, or `catalog --read-mcp` to also ask MCP servers for their tool descriptions;
     that starts each local server for a few seconds).
   - **Turn unused tools off** (`shelf plan`, then `shelf apply` after a yes): needs `"shelf"` in `config.json`:
     `"map"`, `"usage"`, `"list"` or `"none"`. With a map, recommend `"shelf": "map", "unmapped": "usage"`: the map
     keeps each job's first tool, use decides the rest, and tools named by a critical rule always stay on.
   - **Set rules in the user's words**: turn what they say into config keys. "Leave the first two animation tools on"
     → `"sections": { "<heading>": { "keep": 2 } }`; "in design, impeccable first" → `"sections": { "<heading>": {
     "order": ["impeccable"] } }`; "Blender never goes off" → `"neverOff": ["blender-*"]`; "turn off everything
     Shopify" → `"alwaysOff": ["shopify-*"]`; "count 60 days in design" → `"days": 60` in that section; "the Empresa
     folder is a project" → `"projects": { "Empresa": ["Empresa/**"] }` (paths relative to where sessions start).
     Strongest first: `neverOff`, then `alwaysOff`, then the section rules. Then run the matching `plan` again.
   - **Undo** (`undo`): reverts only what Stockroom changed (settings and generated rule files).
   - **Draft or extend the map with Claude**: read `<base directory>/../stockroom-map/SKILL.md` and follow it.
   - **Start a map** (`map init`): writes a starter table the user edits; it never overwrites.
4. After any `apply` or `undo`, say that the change takes effect in the next session, and that every tool stays in
   the catalog.
