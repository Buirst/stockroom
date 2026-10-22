import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHook, HOOK_LINE } from '../lib/hook.js';
import { fingerprint } from '../lib/fingerprint.js';
import { makeToolsHome } from './fixtures.js';
import { parseMap, parseRules } from '../lib/map.js';
import { buildRules, writeRules } from '../lib/rules.js';
import { discoverTools } from '../lib/tools.js';

const bin = fileURLToPath(new URL('../bin/stockroom.js', import.meta.url));
const stateDir = (home) => path.join(home, '.claude', 'stockroom');
const catalog = (home) => path.join(stateDir(home), 'catalog');

function spawnHook(home, cwd) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [bin, 'hook'], {
    input: JSON.stringify({ hook_event_name: 'SessionStart', cwd }),
    env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8',
  });
  return { ...r, ms: Date.now() - t0 };
}

function bigHome() {
  const { home, workRoot } = makeToolsHome();
  for (let i = 0; i < 500; i++) {
    const dir = path.join(home, '.claude', 'skills', `s${i}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: s${i}\ndescription: Skill number ${i}\n---\n`);
  }
  return { home, workRoot };
}

test('first run writes the catalog and prints one line of context', () => {
  const { home, workRoot } = makeToolsHome();
  const r = spawnHook(home, workRoot);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  const line = out.hookSpecificOutput.additionalContext;
  // The catalog path depends on the temp folder (long on macOS); the line itself stays short.
  const bare = line.replaceAll(catalog(home), '<catalog>');
  assert.ok(bare.length <= 300, `${bare.length} chars`);
  assert.ok(!line.includes('\n'));
  assert.ok(line.includes(catalog(home)));
  assert.ok(fs.existsSync(path.join(catalog(home), 'skills.md')));
});

// Node's start-up alone swings with the machine's load (the other test files spawn processes in parallel), so the
// budget is what the hook adds over an empty Node: under 200 ms, best of 3 (about 100 ms on the author's laptop).
test('unchanged: no rewrite, and fast with 500+ tools', () => {
  const { home, workRoot } = bigHome();
  assert.equal(spawnHook(home, workRoot).status, 0);
  const mtime = fs.statSync(path.join(catalog(home), 'skills.md')).mtimeMs;
  const runs = [1, 2, 3].map(() => spawnHook(home, workRoot));
  for (const r of runs) assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.statSync(path.join(catalog(home), 'skills.md')).mtimeMs, mtime);
  const empty = Math.min(...[1, 2, 3].map(() => { const t0 = Date.now(); spawnSync(process.execPath, ['-e', '']); return Date.now() - t0; }));
  const best = Math.min(...runs.map((r) => r.ms));
  assert.ok(best - empty < 200, `best of 3: ${best} ms, empty node ${empty} ms`);
});

test('a change in what is installed rewrites the catalog', () => {
  const { home, workRoot } = makeToolsHome();
  runHook({ home, input: { cwd: workRoot } });
  const dir = path.join(home, '.claude', 'skills', 'brand-new');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: brand-new\ndescription: Just installed\n---\n');
  runHook({ home, input: { cwd: workRoot } });
  assert.match(fs.readFileSync(path.join(catalog(home), 'skills.md'), 'utf8'), /Just installed/);
});

test('map files from config produce by-function.md', () => {
  const { home, workRoot } = makeToolsHome();
  const map = path.join(home, 'maps', 'tools-web.md');
  fs.mkdirSync(path.dirname(map), { recursive: true });
  fs.writeFileSync(map, '## Web\n\n| Case | Tool | Why |\n|---|---|---|\n| Review a page | `tools:design-critique` | House rule |\n');
  fs.mkdirSync(stateDir(home), { recursive: true });
  fs.writeFileSync(path.join(stateDir(home), 'config.json'),
    JSON.stringify({ mapFiles: [path.join(home, 'maps', 'tools-*.md')] }));
  runHook({ home, input: { cwd: workRoot } });
  assert.match(fs.readFileSync(path.join(catalog(home), 'by-function.md'), 'utf8'), /Review a page[\s\S]*tools:design-critique/);
});

test('corrupt state.json: regenerated, no throw', () => {
  const { home, workRoot } = makeToolsHome();
  fs.mkdirSync(stateDir(home), { recursive: true });
  fs.writeFileSync(path.join(stateDir(home), 'state.json'), '{not json');
  const out = runHook({ home, input: { cwd: workRoot } });
  assert.ok(out.includes('additionalContext'));
  assert.ok(fs.existsSync(path.join(catalog(home), 'README.md')));
});

test('an error is logged and exit code is 0; no catalog where configured means no line', () => {
  const { home, workRoot } = makeToolsHome();
  assert.equal(spawnHook(home, workRoot).status, 0);
  // Break the next regeneration: catalogDir points at a file.
  const blocker = path.join(home, 'not-a-dir');
  fs.writeFileSync(blocker, 'x');
  fs.writeFileSync(path.join(stateDir(home), 'config.json'), JSON.stringify({ catalogDir: path.join(blocker, 'catalog') }));
  const r = spawnHook(home, workRoot);
  assert.equal(r.status, 0);
  assert.match(fs.readFileSync(path.join(stateDir(home), 'errors.log'), 'utf8'), /\S/);
  const said = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  assert.match(said, /^Stockroom: an internal error occurred; details: .*errors\.log\.$/, 'no catalog: only the error');
});

test('fingerprint changes with settings, plugins, skill folders and maps; not with time alone', () => {
  const { home, workRoot } = makeToolsHome();
  const a = fingerprint({ home, workRoot, mapFiles: [] });
  assert.equal(fingerprint({ home, workRoot, mapFiles: [] }), a);
  const settings = path.join(home, '.claude', 'settings.json');
  fs.writeFileSync(settings, fs.readFileSync(settings, 'utf8').replace('}', ',"x":1}'));
  assert.notEqual(fingerprint({ home, workRoot, mapFiles: [] }), a);
});

test('HOOK_LINE fits in 300 characters for a long catalog path', () => {
  assert.ok(HOOK_LINE('C:\\Users\\someone-with-a-long-name\\.claude\\stockroom\\catalog').length <= 300);
});

test('with a map, the line points to by-function.md first and stays one short line', () => {
  const dir = path.join('C:', 'Users', 'someone-with-a-long-name', '.claude', 'stockroom', 'catalog');
  for (const line of [HOOK_LINE(dir, true), HOOK_LINE(dir, false)]) {
    assert.ok(line.length <= 300, `${line.length} chars`);
    assert.ok(!line.includes('\n'));
  }
  assert.match(HOOK_LINE(dir, true), /by-function\.md/);
  assert.doesNotMatch(HOOK_LINE(dir, false), /by-function/);
});

test('runHook names by-function.md when the user has a map', () => {
  const { home, workRoot } = makeToolsHome();
  const map = path.join(home, 'map.md');
  fs.writeFileSync(map, '## Jobs\n\n| Case | Tool | Why |\n|---|---|---|\n| Review | `design-critique` | x |\n');
  fs.mkdirSync(path.join(home, '.claude', 'stockroom'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'stockroom', 'config.json'), JSON.stringify({ mapFiles: [map] }));
  const out = JSON.parse(runHook({ home, input: { cwd: workRoot } }));
  assert.match(out.hookSpecificOutput.additionalContext, /by-function\.md/);
});

// Rules: a home with a map holding two critical rules and one on-use rule, applied once.
const RULE_MAP = '# Map\n\n| Tool | Rule | Level |\n|---|---|---|\n| `debugging` | Never on production data | critical |\n'
  + '| * | Ask before publishing | critical |\n| `quiet` | Keep it short | |\n';
function ruledHome({ apply = true } = {}) {
  const { home, workRoot } = makeToolsHome();
  const map = path.join(home, 'map.md');
  fs.writeFileSync(map, RULE_MAP);
  fs.mkdirSync(stateDir(home), { recursive: true });
  fs.writeFileSync(path.join(stateDir(home), 'config.json'), JSON.stringify({ mapFiles: [map] }));
  if (apply) {
    const built = buildRules({ rules: parseRules(RULE_MAP, map), cases: parseMap(RULE_MAP, map),
      tools: discoverTools({ home, workRoot }), config: { projects: {}, catalogDir: catalog(home) } }, [map]);
    writeRules({ home, built, mapFiles: [map] });
  }
  runHook({ home, input: { cwd: workRoot } });
  return { home, workRoot, map };
}
const critical = (home) => path.join(home, '.claude', 'rules', 'stockroom-critical.md');
const context = (out) => JSON.parse(out).hookSpecificOutput.additionalContext;

test('rules never applied: no rules folder and the usual line', () => {
  const { home, workRoot } = ruledHome({ apply: false });
  fs.appendFileSync(path.join(home, 'map.md'), '| `quiet` | Changed | |\n');
  const out = runHook({ home, input: { cwd: workRoot } });
  assert.ok(!fs.existsSync(path.join(home, '.claude', 'rules')));
  assert.equal(context(out), HOOK_LINE(catalog(home), false));
});

test('a map that loses a critical rule keeps the old files and says so', () => {
  const { home, workRoot, map } = ruledHome();
  const before = fs.readFileSync(critical(home), 'utf8');
  fs.writeFileSync(map, RULE_MAP.replace('| * | Ask before publishing | critical |\n', ''));
  const said = context(runHook({ home, input: { cwd: workRoot } }));
  assert.equal(fs.readFileSync(critical(home), 'utf8'), before);
  assert.match(said, /Stockroom: rules not updated \(the map now has 1 critical rules, 2 before\); the previous ones still apply\. Details: .*errors\.log\./);
});

test('a changed on-use rule updates the index without a warning', () => {
  const { home, workRoot, map } = ruledHome();
  fs.writeFileSync(map, RULE_MAP.replace('Keep it short', 'Keep it very short'));
  const said = context(runHook({ home, input: { cwd: workRoot } }));
  const index = JSON.parse(fs.readFileSync(path.join(stateDir(home), 'rules-index.json'), 'utf8'));
  assert.deepEqual(index.rules.quiet, ['Keep it very short']);
  assert.doesNotMatch(said, /not updated|error/);
});

test('an unreadable config: the usual line plus the error sentence', () => {
  const { home, workRoot } = ruledHome();
  fs.writeFileSync(path.join(stateDir(home), 'config.json'), '{broken');
  const said = context(runHook({ home, input: { cwd: workRoot } }));
  assert.ok(said.startsWith('Stockroom: '));
  assert.match(said, /Stockroom: an internal error occurred; details: .*errors\.log\.$/);
});

test('with a map, the line says an off tool works through its SKILL.md', () => {
  const line = HOOK_LINE(path.join('C:', 'Users', 'someone-with-a-long-name', '.claude', 'stockroom', 'catalog'), true);
  assert.match(line, /even when the tool is off/);
  assert.ok(line.length <= 300, `${line.length} chars`);
});
