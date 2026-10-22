#!/usr/bin/env node
// PreToolUse hook (plan writes, ExitPlanMode, WebSearch, ToolSearch): once per session, if Claude has not looked at the
// tool map yet, remind it. Never blocks; any problem means silence.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeDir } from '../lib/files.js';
import { consultedMap, nudgeText } from '../lib/nudge.js';

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const state = path.join(claudeDir(os.homedir()), 'stockroom');
  let catalogDir = path.join(state, 'catalog');
  try { catalogDir = JSON.parse(fs.readFileSync(path.join(state, 'config.json'), 'utf8')).catalogDir || catalogDir; } catch { /* default */ }
  catalogDir = catalogDir.replace(/^~/, os.homedir());
  const index = path.join(catalogDir, 'by-function.md');
  const flag = path.join(state, 'nudged', `${String(input.session_id || '').replace(/[^\w-]/g, '')}.flag`);
  if (input.session_id && input.transcript_path && fs.existsSync(index) && !fs.existsSync(flag)) {
    const seen = consultedMap(fs.readFileSync(input.transcript_path, 'utf8'), catalogDir);
    fs.mkdirSync(path.dirname(flag), { recursive: true });
    fs.writeFileSync(flag, seen ? 'consulted' : 'reminded');
    if (!seen) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: nudgeText(index) } }));
  }
} catch { /* no transcript, bad input or unwritable state: say nothing */ }
process.exit(0);
