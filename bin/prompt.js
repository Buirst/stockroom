#!/usr/bin/env node
// UserPromptSubmit hook: one line next to the user's prompt pointing at the tool map. Never blocks; any problem means
// silence.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeDir } from '../lib/files.js';
import { promptText } from '../lib/nudge.js';

try {
  const state = path.join(claudeDir(os.homedir()), 'stockroom');
  let catalogDir = path.join(state, 'catalog');
  try { catalogDir = JSON.parse(fs.readFileSync(path.join(state, 'config.json'), 'utf8')).catalogDir || catalogDir; } catch { /* default */ }
  const index = path.join(catalogDir.replace(/^~/, os.homedir()), 'by-function.md');
  if (fs.existsSync(index)) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: promptText(index) } }));
} catch { /* unreadable state: say nothing */ }
process.exit(0);
