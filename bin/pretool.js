#!/usr/bin/env node
// PreToolUse hook entry, kept apart from bin/stockroom.js so it loads almost nothing: it runs on tool calls.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeDir, readJson } from '../lib/files.js';
import { pretoolOutput, toolKey, wakeIds } from '../lib/pretool.js';

const state = path.join(claudeDir(os.homedir()), 'stockroom');
const texts = [];
let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { /* bad input: say nothing */ }

try {
  const index = JSON.parse(fs.readFileSync(path.join(state, 'rules-index.json'), 'utf8'));
  const out = pretoolOutput(input, index);
  if (out) {
    texts.push(JSON.parse(out).hookSpecificOutput.additionalContext);
    const tool = toolKey(input, index);
    fs.appendFileSync(path.join(state, 'injections.jsonl'), `${JSON.stringify({
      at: new Date().toISOString(), session: input.session_id || null, tool, rules: index.rules[tool].length,
    })}\n`);
  }
} catch { /* no index or unwritable log: no rules */ }

// "auto": reading the SKILL.md of something the shelf turned off is using it, so it comes back on now.
try {
  const ids = input.tool_name === 'Read' && readJson(path.join(state, 'config.json'), {}).auto === true
    ? wakeIds(input.tool_input?.file_path || '', readJson(path.join(state, 'applied.json'), [])) : [];
  if (ids.length) {
    const { undoShelf } = await import('../lib/shelf.js');
    const { restored } = undoShelf({ settingsPath: path.join(claudeDir(os.homedir()), 'settings.json'), stateDir: state, only: new Set(ids) });
    if (restored.length) {
      const names = restored.map((r) => r.key).join(', ');
      fs.appendFileSync(path.join(state, 'auto.log'), `${new Date().toISOString()} on (used): ${names}\n`);
      texts.push(`Stockroom: ${names} was off for lack of use and is back on from the next session; this SKILL.md works now.`);
    }
  }
} catch { /* unreadable state or settings: leave everything as it is */ }

if (texts.length) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: texts.join(' ') } }));
process.exit(0);
