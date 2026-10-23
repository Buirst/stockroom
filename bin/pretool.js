#!/usr/bin/env node
// PreToolUse hook entry, kept apart from bin/stockroom.js so it loads almost nothing: it runs on tool calls.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeDir, readJson } from '../lib/files.js';
import { FIT_TEXT, pretoolOutput, skillReads, toolKey, wakeIds } from '../lib/pretool.js';

const state = path.join(claudeDir(os.homedir()), 'stockroom');
const texts = [];
let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { /* bad input: say nothing */ }

try {
  const index = JSON.parse(fs.readFileSync(path.join(state, 'rules-index.json'), 'utf8'));
  const out = pretoolOutput(input, index, os.homedir());
  if (out) {
    texts.push(JSON.parse(out).hookSpecificOutput.additionalContext);
    const tool = toolKey(input, index, os.homedir());
    fs.appendFileSync(path.join(state, 'injections.jsonl'), `${JSON.stringify({
      at: new Date().toISOString(), session: input.session_id || null, tool, rules: index.rules[tool].length,
    })}\n`);
  }
} catch { /* no index or unwritable log: no rules */ }

// Measured 2026-10-23 (A/B, judge with web): plans built on a skill copied its whole workflow and named the map.
let files = [];
try { files = skillReads(input, os.homedir()); } catch { /* bad input */ }
if ((files.length || input.tool_name === 'Skill') && fs.existsSync(state)) texts.push(FIT_TEXT); // silent until Stockroom is set up

// "auto": reading the SKILL.md of something the shelf turned off is using it, so it comes back on now.
try {
  const applied = files.length && readJson(path.join(state, 'config.json'), {}).auto === true ? readJson(path.join(state, 'applied.json'), []) : [];
  const ids = [...new Set(files.flatMap((f) => wakeIds(f, applied)))];
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

if (texts.length) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: texts.join('\n') } }));
process.exit(0);
