import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consultedMap } from '../lib/nudge.js';

const bin = fileURLToPath(new URL('../bin/nudge.js', import.meta.url));
const use = (name, input) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x', name, input }] } });

test('consultedMap: a tool call that reads the catalog or the map index counts; anything else does not', () => {
  const cat = 'C:\\Users\\X\\.claude\\stockroom\\catalog';
  assert.equal(consultedMap(use('Grep', { pattern: 'sentry', path: `${cat}\\by-function.md` }), cat), true);
  assert.equal(consultedMap(use('Bash', { command: 'grep -i neon /c/Users/X/.claude/stockroom/catalog/skills.md' }), cat), true);
  assert.equal(consultedMap([use('Bash', { command: 'ls D:/work' }), use('Grep', { pattern: 'postgres', path: 'D:\\work' })].join('\n'), cat), false);
});

function home({ map = true } = {}) {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'stockroom-nudge-'));
  const cat = path.join(h, '.claude', 'stockroom', 'catalog');
  fs.mkdirSync(cat, { recursive: true });
  if (map) fs.writeFileSync(path.join(cat, 'by-function.md'), '# By function\n');
  return { h, cat };
}
const transcript = (h, lines) => { const f = path.join(h, 't.jsonl'); fs.writeFileSync(f, lines.join('\n')); return f; };
const run = (h, input) => spawnSync(process.execPath, [bin], { input: JSON.stringify(input), env: { ...process.env, HOME: h, USERPROFILE: h }, encoding: 'utf8' });

test('the reminder: once per session, only while the map was not consulted', () => {
  const { h } = home();
  const t = transcript(h, [use('Bash', { command: 'ls D:/work' })]);
  const first = run(h, { session_id: 's1', transcript_path: t, tool_name: 'Write' });
  assert.equal(first.status, 0);
  const said = JSON.parse(first.stdout).hookSpecificOutput;
  assert.equal(said.hookEventName, 'PreToolUse');
  assert.match(said.additionalContext, /^Stockroom: this session has not checked the tool map yet\. Before you finish, grep .*by-function\.md/);
  assert.equal(said.permissionDecision, undefined);
  assert.equal(run(h, { session_id: 's1', transcript_path: t, tool_name: 'Write' }).stdout, '', 'only once');
});

test('no reminder when the session already read the map, when there is no map, or on bad input', () => {
  const { h, cat } = home();
  const t = transcript(h, [use('Grep', { pattern: 'x', path: path.join(cat, 'by-function.md') })]);
  assert.equal(run(h, { session_id: 's2', transcript_path: t, tool_name: 'ExitPlanMode' }).stdout, '');
  const none = home({ map: false });
  const t2 = transcript(none.h, [use('Bash', { command: 'ls' })]);
  assert.equal(run(none.h, { session_id: 's3', transcript_path: t2, tool_name: 'WebSearch' }).stdout, '');
  for (const input of [{}, { session_id: 's4' }, { session_id: 's5', transcript_path: path.join(h, 'missing.jsonl') }]) {
    const r = run(h, input);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  }
});

test('hooks.json: the reminder runs on plan writes, ExitPlanMode, WebSearch and ToolSearch', () => {
  const pre = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../hooks/hooks.json', import.meta.url)), 'utf8')).hooks.PreToolUse;
  const nudges = pre.filter((g) => /bin\/nudge\.js/.test(g.hooks[0].command));
  assert.deepEqual(nudges.map((g) => g.matcher), ['ExitPlanMode|WebSearch|ToolSearch', 'Write']);
  assert.equal(nudges[1].hooks[0].if, 'Write(**/.claude/plans/**)');
});
