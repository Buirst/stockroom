# Testing Stockroom

Thanks for trying it. It takes about 15 minutes. Stockroom turns nothing off unless you approve a plan, and `undo`
reverts what it changed.

## 1. Install

```sh
claude plugin marketplace add Buirst/stockroom
claude plugin install stockroom@stockroom
```

Needs Node.js 18+. Start a new Claude Code session: the first one writes the catalog to `~/.claude/stockroom/catalog/`
(about a second); later sessions take about 200 ms when nothing changed.

## 2. Three things to try

1. **The panel.** Type `/stockroom`. Check that the tool count looks right for your setup.
2. **Draft a map.** In the panel, choose *Draft the map with Claude*, section by section. Claude proposes one row per
   job (the tool to use first, and why); approve, change or skip each one. Note anything it got wrong.
3. **A task that needs a tool you have but rarely use.** Ask Claude for something only that tool covers, without naming
   it. Did Claude find it in the catalog and read its `SKILL.md`? For a stronger test, turn the tool off first (panel →
   *Turn unused tools off*, or `"shelf": "list"` with `alwaysOff`), start a new session, and ask again.

## 3. Report

Open an issue with the **Test report** template. The most useful details: your OS, how many tools `status` reports,
and what Claude did on step 3. Remove anything private before pasting output.

## 4. Uninstall

1. `/stockroom` → **Undo** (restores anything Stockroom turned off).
2. `claude plugin uninstall stockroom@stockroom`
3. Delete `~/.claude/stockroom/` if you want the catalog, backups and cache gone.
