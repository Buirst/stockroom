import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIT_TEXT, toolKey, pretoolOutput, skillReads, wakeIds } from '../lib/pretool.js';

const bin = fileURLToPath(new URL('../bin/pretool.js', import.meta.url));
const index = {
  rules: { pdf: ['Local first: never upload client documents'], 'MCP adobe': ['Uploads to the cloud'], long: ['a'.repeat(300), 'b'.repeat(300), 'c'] },
  paths: { 'c:/users/x/.claude/skills/pdf/skill.md': 'pdf', '/home/x/.claude/skills/pdf/skill.md': 'pdf' },
};

test('toolKey: Skill by name, Read of a SKILL.md by path on any OS; MCP calls are not hooked', () => {
  assert.equal(toolKey({ tool_name: 'Skill', tool_input: { skill: 'pdf' } }, index), 'pdf');
  assert.equal(toolKey({ tool_name: 'Read', tool_input: { file_path: 'C:\\Users\\X\\.claude\\skills\\pdf\\SKILL.md' } }, index), 'pdf');
  assert.equal(toolKey({ tool_name: 'Read', tool_input: { file_path: '/home/x/.claude/skills/pdf/SKILL.md' } }, index), 'pdf');
  assert.equal(toolKey({ tool_name: 'Read', tool_input: { file_path: '/home/x/notes.md' } }, index), null);
  assert.equal(toolKey({ tool_name: 'mcp__adobe__upload', tool_input: {} }, index), null);
  assert.equal(toolKey({ tool_name: 'Bash', tool_input: { command: 'ls' } }, index), null);
});

test('skillReads: a shell command reads a SKILL.md by any spelling of the path; toolKey and rules follow it', () => {
  const sh = (command, tool_name = 'Bash') => ({ tool_name, tool_input: { command } });
  const want = ['c:/users/x/.claude/skills/pdf/skill.md'];
  assert.deepEqual(skillReads(sh('sed -n 1,90p ~/.claude/skills/pdf/SKILL.md'), 'C:\\Users\\X'), want);
  assert.deepEqual(skillReads(sh('cat "$HOME/.claude/skills/pdf/SKILL.md" | head'), 'C:\\Users\\X'), want);
  assert.deepEqual(skillReads(sh('cat /c/Users/X/.claude/skills/pdf/SKILL.md'), '/unused'), want);
  assert.deepEqual(skillReads(sh('Get-Content $env:USERPROFILE\\.claude\\skills\\pdf\\SKILL.md', 'PowerShell'), 'C:\\Users\\X'), want);
  assert.deepEqual(skillReads(sh('cat ~/a/SKILL.md ~/b/SKILL.md'), '/home/x'), ['/home/x/a/skill.md', '/home/x/b/skill.md']);
  assert.deepEqual(skillReads(sh('grep -rn foo D:/notes'), '/home/x'), []);
  assert.deepEqual(skillReads({ tool_name: 'Grep', tool_input: { path: '/home/x/a/SKILL.md' } }, '/home/x'), []);
  assert.equal(toolKey(sh('cat ~/.claude/skills/pdf/SKILL.md'), index, '/home/x'), 'pdf');
  assert.match(pretoolOutput(sh('cat ~/.claude/skills/pdf/SKILL.md'), index, '/home/x'), /Stockroom rules for pdf/);
});

test('pretoolOutput: rules as additionalContext, nothing for a tool without rules', () => {
  const out = JSON.parse(pretoolOutput({ tool_name: 'Skill', tool_input: { skill: 'pdf' } }, index));
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.additionalContext, 'Stockroom rules for pdf: Local first: never upload client documents');
  assert.equal(out.hookSpecificOutput.permissionDecision, undefined);
  assert.equal(pretoolOutput({ tool_name: 'Skill', tool_input: { skill: 'other' } }, index), '');
});

test('an injection over 500 characters is cut at a rule boundary', () => {
  const text = JSON.parse(pretoolOutput({ tool_name: 'Skill', tool_input: { skill: 'long' } }, index)).hookSpecificOutput.additionalContext;
  assert.ok(text.length <= 500, `${text.length}`);
  assert.match(text, /…\(2 more in the catalog\)$/);
});

function home(withIndex = true) {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'stockroom-pre-'));
  if (withIndex) {
    fs.mkdirSync(path.join(h, '.claude', 'stockroom'), { recursive: true });
    fs.writeFileSync(path.join(h, '.claude', 'stockroom', 'rules-index.json'), JSON.stringify(index));
  }
  return h;
}
const run = (h, input) => {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [bin], { input, env: { ...process.env, HOME: h, USERPROFILE: h }, encoding: 'utf8' });
  return { ...r, ms: Date.now() - t0 };
};

test('the hook script: injects, logs the injection, and exits 0 on any input', () => {
  const h = home();
  const r = run(h, JSON.stringify({ session_id: 's1', tool_name: 'Skill', tool_input: { skill: 'pdf' } }));
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Stockroom rules for pdf/);
  const log = fs.readFileSync(path.join(h, '.claude', 'stockroom', 'injections.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual([log[0].session, log[0].tool, log[0].rules], ['s1', 'pdf', 1]);
  for (const input of ['', '{not json']) {
    const x = run(h, input);
    assert.equal(x.status, 0);
    assert.equal(x.stdout, '');
  }
  // A skill without rules still gets the fit-to-task line, and nothing else.
  const plain = run(h, JSON.stringify({ tool_name: 'Skill', tool_input: { skill: 'none' } }));
  assert.equal(JSON.parse(plain.stdout).hookSpecificOutput.additionalContext, FIT_TEXT);
  const missing = run(home(false), JSON.stringify({ tool_name: 'Skill', tool_input: { skill: 'pdf' } }));
  assert.equal(missing.status, 0);
  assert.equal(missing.stdout, '');
});

// Node's own start-up varies with the machine's load (measured 97 ms p50, 190 ms p95 for an empty script on the
// author's Windows laptop), so the budget is what the hook adds on top of an empty Node: under 80 ms, best of 5.
test('the hook script adds little to Node start-up, with and without rules', () => {
  const h = home();
  const best = (args, input) => Math.min(...[1, 2, 3, 4, 5].map(() => {
    const t0 = Date.now();
    spawnSync(process.execPath, args, { input, env: { ...process.env, HOME: h, USERPROFILE: h } });
    return Date.now() - t0;
  }));
  const empty = best(['-e', ''], '');
  for (const input of [JSON.stringify({ tool_name: 'Skill', tool_input: { skill: 'pdf' } }), JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/x' } })]) {
    const ms = best([bin], input);
    console.log(`pretool best of 5: ${ms} ms (empty node: ${empty} ms)`);
    if (!process.env.CI) assert.ok(ms - empty < 80, `${ms - empty} ms over an empty node`);
  }
});

test('hooks.json registers the PreToolUse handlers on the pretool script, not on MCP calls', () => {
  const all = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../hooks/hooks.json', import.meta.url)), 'utf8')).hooks.PreToolUse;
  const hooks = all.filter((g) => /bin\/pretool\.js/.test(g.hooks[0].command));
  assert.deepEqual(hooks.map((g) => g.matcher), ['Skill', 'Read', 'Read', 'Bash', 'PowerShell']);
  assert.ok(!all.some((g) => /mcp__/.test(g.matcher)), 'no handler on MCP calls');
  // A rule path without a prefix is relative to the working folder: plugin and personal skills need the ~ one.
  assert.deepEqual(hooks.slice(1).map((g) => g.hooks[0].if),
    ['Read(**/SKILL.md)', 'Read(~/**/SKILL.md)', 'Bash(*SKILL.md*)', 'PowerShell(*SKILL.md*)']);
  for (const g of hooks) assert.match(g.hooks[0].command, /bin\/pretool\.js/);
});

const applied = [
  { via: 'enabledPlugins', key: 'neon@claude-plugins-official', value: false, prev: true },
  { via: 'skillOverrides', key: 'write-swift', value: 'off' },
  { via: 'deniedMcpServers', key: 'claude.ai Gmail' },
];

test('wakeIds: a SKILL.md read belongs to its plugin or to its own skill, on any OS', () => {
  assert.deepEqual(wakeIds('C:\\Users\\X\\.claude\\plugins\\cache\\claude-plugins-official\\neon\\2.0.1\\skills\\neon\\SKILL.md', applied),
    ['enabledPlugins/neon@claude-plugins-official']);
  assert.deepEqual(wakeIds('/home/x/.claude/skills/write-swift/SKILL.md', applied), ['skillOverrides/write-swift']);
  assert.deepEqual(wakeIds('/home/x/.claude/plugins/cache/m/p/1/skills/write-swift/SKILL.md', applied), []);
  assert.deepEqual(wakeIds('/home/x/.claude/skills/write-swift/notes.md', applied), []);
  assert.deepEqual(wakeIds('/home/x/.claude/plugins/cache/claude-plugins-official/neon-extra/1/skills/a/SKILL.md', applied), []);
});

test('the hook script with "auto": reading an off skill turns it back on and says so; without "auto" nothing changes', () => {
  for (const auto of [true, false]) {
    const h = home();
    const st = path.join(h, '.claude', 'stockroom');
    fs.writeFileSync(path.join(st, 'config.json'), JSON.stringify({ auto }));
    fs.writeFileSync(path.join(st, 'applied.json'), JSON.stringify(applied));
    const settings = { enabledPlugins: { 'neon@claude-plugins-official': false }, skillOverrides: { 'write-swift': 'off' } };
    fs.writeFileSync(path.join(h, '.claude', 'settings.json'), JSON.stringify(settings));
    const file = path.join(h, '.claude', 'skills', 'write-swift', 'SKILL.md');
    const r = run(h, JSON.stringify({ tool_name: 'Bash', tool_input: { command: `sed -n 1,80p "${file}"` } }));
    assert.equal(r.status, 0);
    const now = JSON.parse(fs.readFileSync(path.join(h, '.claude', 'settings.json'), 'utf8'));
    if (auto) {
      assert.match(r.stdout, /write-swift was off for lack of use and is back on/);
      assert.equal(now.skillOverrides, undefined);
      assert.equal(now.enabledPlugins['neon@claude-plugins-official'], false, 'other records stay off');
      assert.equal(JSON.parse(fs.readFileSync(path.join(st, 'applied.json'), 'utf8')).length, 2);
      assert.match(fs.readFileSync(path.join(st, 'auto.log'), 'utf8'), /on \(used\): write-swift/);
    } else {
      assert.equal(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, FIT_TEXT);
      assert.deepEqual(now, settings);
    }
  }
});
