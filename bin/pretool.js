#!/usr/bin/env node
// PreToolUse hook entry, kept apart from bin/stockroom.js so it loads almost nothing: it runs on tool calls.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeDir } from '../lib/files.js';
import { pretoolOutput, toolKey } from '../lib/pretool.js';

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const state = path.join(claudeDir(os.homedir()), 'stockroom');
  const index = JSON.parse(fs.readFileSync(path.join(state, 'rules-index.json'), 'utf8'));
  const out = pretoolOutput(input, index);
  if (out) {
    process.stdout.write(out);
    const tool = toolKey(input, index);
    fs.appendFileSync(path.join(state, 'injections.jsonl'), `${JSON.stringify({
      at: new Date().toISOString(), session: input.session_id || null, tool, rules: index.rules[tool].length,
    })}\n`);
  }
} catch { /* no index, bad input or unwritable log: say nothing, never block the tool */ }
process.exit(0);
