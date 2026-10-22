---
name: stockroom
description: Stockroom panel. Use when the user asks what tools are installed or turned off, wants to check their tool map, rebuild the catalog, or turn unused tools off or back on (with a backup).
---

# Stockroom panel

The CLI is `bin/stockroom.js` two folders above this skill's base directory. Run it with Node from the user's
working folder: `node "<base directory>/../../bin/stockroom.js" <command>`.

1. Run `status` and show the user the result in a few lines.
2. If `mapFiles` in `~/.claude/stockroom/config.json` is empty, offer the setup first: "Claude
   can draft your tool map: one row per job, the tool to use first, and why. You decide every row." Let the user pick:
   **section by section** (approve each group), **all at once** (Claude drafts every group, you review the whole map at
   the end), or **not now**. Then read `<base directory>/../stockroom-map/SKILL.md` and follow it in that mode.
3. Offer these actions and wait for a choice:
   - **Check the map** (`check`): names in the map that match no installed tool, and tools no row names. Never edit
     the map without the user's yes.
   - **Rebuild the catalog** (`catalog`, or `catalog --read-mcp` to also ask MCP servers for their tool descriptions;
     that starts each local server for a few seconds).
   - **Turn unused tools off** (`shelf plan`): needs `"shelf"` in `~/.claude/stockroom/config.json`: `"map"` (keep
     the first tools of each case of the map), `"usage"`, `"list"` or `"none"`. Show the whole plan with its reasons,
     then ask. Run `shelf apply` only after an explicit yes to that plan.
   - **Set rules in the user's words**: turn what they say into config keys, show the change to `config.json`, and
     write it only after a yes. "Leave the first two animation tools on" → `"sections": { "<heading>": { "keep": 2 } }`;
     "in design, impeccable first" → `"sections": { "<heading>": { "order": ["impeccable"] } }`; "Blender never goes
     off" → `"neverOff": ["blender-*"]`; "turn off everything Shopify" → `"alwaysOff": ["shopify-*"]`; "count 60 days
     in design" → `"days": 60` in that section; tools no case names follow `"unmapped"` (`"keep"`, `"usage"`,
     `"off"`). Strongest first: `neverOff`, then `alwaysOff`, then the section rules. Then run `shelf plan` again.
   - **Undo** (`undo`): reverts only what Stockroom changed.
   - **Draft the map with Claude**: read `<base directory>/../stockroom-map/SKILL.md` and follow it. You propose
     each section from the tools' descriptions, official sources and use; the user approves it.
   - **Start a map** (`map init`): writes a starter table the user edits; it never overwrites.
4. After `shelf apply` or `undo`, say that the change takes effect in the next session, and that every tool stays in
   the catalog.
