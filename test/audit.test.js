// Fixes from the audit of 2026-10-21: one test per finding.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planShelf, applyShelf, undoShelf } from '../lib/shelf.js';
import { toolUsage } from '../lib/measure.js';
import { writeCatalog } from '../lib/catalog.js';
import { readableServers } from '../lib/mcp.js';
import { discoverTools } from '../lib/tools.js';
import { fingerprint } from '../lib/fingerprint.js';
import { HOOK_LINE } from '../lib/hook.js';
import { parseMap } from '../lib/map.js';
import { makeToolsHome } from './fixtures.js';

const DAY = 86400000;
const now = Date.UTC(2026, 9, 21);
const base = { shelf: null, days: 30, list: [], neverOff: [] };
const S = (name, extra = {}) => ({ kind: 'skill', name, origin: 'personal', enabled: true, off: { via: 'skillOverrides', key: name }, ...extra });
const P = (id) => ({ via: 'enabledPlugins', key: id });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'stockroom-audit-'));
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');

test('1. --read-mcp starts only servers that are on, local, and approved when from a project .mcp.json', () => {
  const s = (name, extra) => ({ kind: 'mcp-server', name, enabled: true, server: { command: 'node' }, ...extra });
  const all = [s('on'), s('off', { enabled: false }), s('unapproved', { approved: false }), s('approved', { approved: true }),
    s('remote', { server: { type: 'http', url: 'https://x.test' } }), s('claude.ai Linear', { server: { type: 'claude-ai' } }),
    { kind: 'skill', name: 'x', enabled: true }];
  assert.deepEqual(readableServers(all).map((t) => t.name), ['on', 'approved']);
});

test('1. project .mcp.json servers carry whether the user approved them', () => {
  const h = makeToolsHome();
  fs.writeFileSync(path.join(h.repo, '.mcp.json'), JSON.stringify({ mcpServers: { yes: { command: 'node' }, no: { command: 'node' } } }));
  fs.writeFileSync(path.join(h.repo, '.claude', 'settings.local.json'), JSON.stringify({ enabledMcpjsonServers: ['yes'] }));
  const all = discoverTools({ home: h.home, workRoot: h.workRoot }).filter((t) => t.path?.endsWith('.mcp.json'));
  assert.deepEqual(Object.fromEntries(all.map((t) => [t.name, t.approved])), { yes: true, no: false });
});

test('2. the shelf never turns off Stockroom itself, in any mode', () => {
  const tools = [S('a'),
    { kind: 'plugin', name: 'stockroom', origin: 'plugin', plugin: 'stockroom', enabled: true, off: P('stockroom@stockroom') },
    { kind: 'skill', name: 'stockroom:stockroom', origin: 'plugin', plugin: 'stockroom', enabled: true, off: P('stockroom@stockroom') }];
  for (const config of [{ shelf: 'none' }, { shelf: 'list', list: ['*'] }, { shelf: 'usage', alwaysOff: ['stock*'] }]) {
    const r = planShelf({ tools, config: { ...base, ...config }, now });
    assert.ok(!r.off.some((o) => o.key === 'stockroom@stockroom'), JSON.stringify(config));
  }
});

test('3. a failed swap puts the previous catalog back: there is never no catalog', (t) => {
  const outDir = path.join(tmp(), 'catalog');
  const tools = [S('debugging', { description: 'Find the cause' })];
  writeCatalog({ tools, outDir });
  const before = read(outDir, 'skills.md');
  const real = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (String(from).includes('.tmp-')) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    return real(from, to);
  });
  assert.throws(() => writeCatalog({ tools: [S('other', { description: 'New' })], outDir }), /EPERM/);
  t.mock.restoreAll();
  assert.equal(read(outDir, 'skills.md'), before);
  assert.deepEqual(fs.readdirSync(path.dirname(outDir)), ['catalog']);
});

test('4. by-function.md is a short index; each section has its own file with every alternative', () => {
  const outDir = path.join(tmp(), 'catalog');
  const tools = [S('debugging', { description: 'x' }), S('impeccable', { description: 'y' })];
  const cases = [
    { file: 'm', section: 'Debug', title: 'A test fails', tools: ['debugging', 'nope'], why: 'Root cause' },
    { file: 'm', section: 'Diseño web', title: 'Review', tools: ['impeccable'], why: '' },
  ];
  writeCatalog({ tools, cases, outDir });
  const index = read(outDir, 'by-function.md');
  assert.match(index, /## Debug · by-function\/debug\.md\n- A test fails → `debugging`/);
  assert.match(index, /## Diseño web · by-function\/diseno-web\.md\n- Review → `impeccable`/);
  assert.ok(!index.includes('not an installed tool name'), 'alternatives live in the section files');
  assert.deepEqual(fs.readdirSync(path.join(outDir, 'by-function')).sort(), ['debug.md', 'diseno-web.md']);
  assert.match(read(path.join(outDir, 'by-function'), 'debug.md'), /`nope`.*not an installed tool name/);
  assert.match(HOOK_LINE('/c', true), /grep the tool map .*Not for plain questions/);
});

test('4. tables before the first ## heading take the file title as their section', () => {
  const text = '# Tools at work\n\n| Case | Tool |\n|---|---|\n| Lint | `biome` |\n\n## Web\n\n| Case | Tool |\n|---|---|\n| Look | `playwright` |\n';
  assert.deepEqual(parseMap(text, 'm').map((c) => c.section), ['Tools at work', 'Web']);
});

test('5. a manifest that names a file inside agents/ does not list the agent twice', () => {
  const h = makeToolsHome();
  const root = path.join(h.home, '.claude', 'plugins', 'cache', 'mk', 'tools', '1.0.0');
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'tools', skills: ['./extra'], agents: ['./agents/reviewer.md'] }));
  const all = discoverTools({ home: h.home, workRoot: h.workRoot });
  assert.equal(all.filter((t) => t.kind === 'agent' && t.name === 'tools:reviewer').length, 1);
});

test('6. the fingerprint changes when `npx skills` updates a skill in place (its lock file)', () => {
  const { home, workRoot } = makeToolsHome();
  const a = fingerprint({ home, workRoot, mapFiles: [] });
  fs.mkdirSync(path.join(home, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(home, '.agents', '.skill-lock.json'), '{"skills":{}}');
  assert.notEqual(fingerprint({ home, workRoot, mapFiles: [] }), a);
});

test('7. the panel can be opened by intent (no disable-model-invocation)', () => {
  const skill = fileURLToPath(new URL('../skills/stockroom/SKILL.md', import.meta.url));
  assert.doesNotMatch(fs.readFileSync(skill, 'utf8'), /disable-model-invocation/);
});

test('8. reading a SKILL.md counts as use, so a skill used from the catalog stays on', () => {
  const t = S('from-catalog', { path: 'C:\\h\\.claude\\skills\\from-catalog\\SKILL.md' });
  const used = new Map([['read:c:/h/.claude/skills/from-catalog/skill.md', now - DAY]]);
  assert.equal(planShelf({ tools: [t], config: { ...base, shelf: 'usage' }, usage: used, now }).off.length, 0);
  assert.equal(planShelf({ tools: [t], config: { ...base, shelf: 'usage' }, usage: new Map(), now }).off.length, 1);

  const home = tmp();
  const dir = path.join(home, '.claude', 'projects', 'p');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 's.jsonl'), JSON.stringify({ type: 'assistant', timestamp: new Date(now - DAY).toISOString(),
    message: { content: [{ type: 'tool_use', id: 't', name: 'Read', input: { file_path: 'C:\\Users\\X\\skills\\a\\SKILL.md' } }] } }));
  assert.equal(toolUsage({ home, days: 30, now }).get('read:c:/users/x/skills/a/skill.md'), now - DAY);
});

test('8. skills hidden from Claude (disable-model-invocation) are never turned off: they cost nothing', () => {
  const r = planShelf({ tools: [S('typed-only', { modelInvocable: false }), S('normal')], config: { ...base, shelf: 'none' }, now });
  assert.deepEqual(r.off.map((o) => o.key), ['normal']);
});

test('C. used while off: back on if Stockroom turned it off, otherwise only reported', () => {
  const off = (name) => S(name, { enabled: false, path: `/s/${name}/SKILL.md` });
  const used = new Map([['read:/s/mine/skill.md', now - DAY], ['read:/s/users/skill.md', now - DAY]]);
  const r = planShelf({ tools: [off('mine'), off('users'), off('idle')], config: { ...base, shelf: 'usage' }, usage: used, now,
    applied: [{ via: 'skillOverrides', key: 'mine' }, { via: 'skillOverrides', key: 'idle' }] });
  assert.deepEqual(r.on.map((o) => o.key), ['mine']);
  assert.ok(r.cannot.some((c) => c.tool.name === 'users' && /you turned it off/.test(c.reason)));
});

test('B. offAs "name-only" keeps the name in the listing; undo of some keeps the rest', () => {
  const dir = tmp();
  const settingsPath = path.join(dir, 'settings.json');
  const stateDir = path.join(dir, 'state');
  fs.writeFileSync(settingsPath, '{}');
  const r = planShelf({ tools: [S('a'), S('b'), S('c', { listing: 'name-only' })],
    config: { ...base, shelf: 'none', offAs: 'name-only' }, now });
  assert.deepEqual(r.off.map((o) => [o.key, o.value]), [['a', 'name-only'], ['b', 'name-only']]);
  applyShelf({ settingsPath, off: r.off, stateDir });
  const settings = () => JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.deepEqual(settings().skillOverrides, { a: 'name-only', b: 'name-only' });
  assert.deepEqual(undoShelf({ settingsPath, stateDir, only: new Set(['skillOverrides/a']) }).restored.map((x) => x.key), ['a']);
  assert.deepEqual(settings().skillOverrides, { b: 'name-only' });
  assert.deepEqual(undoShelf({ settingsPath, stateDir }).restored.map((x) => x.key), ['b']);
  assert.deepEqual(settings(), {});
});

test('A. claude.ai connectors are listed by display name and turned off with deniedMcpServers', () => {
  const h = makeToolsHome();
  const cj = path.join(h.home, '.claude.json');
  fs.writeFileSync(cj, JSON.stringify({ ...JSON.parse(read(h.home, '.claude.json')), claudeAiMcpEverConnected: ['claude.ai Linear'] }));
  const c = discoverTools({ home: h.home }).find((t) => t.name === 'claude.ai Linear');
  assert.equal(c.origin, 'claude-ai');
  assert.deepEqual(c.off, { via: 'deniedMcpServers', key: 'claude.ai Linear' });
});

test('E. status suggests a Read rule for the catalog unless one exists or the mode never asks', () => {
  const bin = fileURLToPath(new URL('../bin/stockroom.js', import.meta.url));
  const { home, workRoot } = makeToolsHome();
  const run = () => spawnSync(process.execPath, [bin, 'status'], {
    cwd: workRoot, env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8', input: '' }).stdout;
  assert.match(run(), /Read\(~\/\.claude\/stockroom\/catalog\/\*\*\)/);
  const file = path.join(home, '.claude', 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(read(path.dirname(file), 'settings.json')),
    permissions: { allow: ['Read(~/.claude/stockroom/catalog/**)'] } }));
  assert.doesNotMatch(run(), /add "Read/);
});

test('6. the fingerprint changes when a claude.ai connector is connected', () => {
  const { home, workRoot } = makeToolsHome();
  const a = fingerprint({ home, workRoot, mapFiles: [] });
  const cj = path.join(home, '.claude.json');
  fs.writeFileSync(cj, JSON.stringify({ ...JSON.parse(read(home, '.claude.json')), claudeAiMcpEverConnected: ['claude.ai Gmail'] }));
  assert.notEqual(fingerprint({ home, workRoot, mapFiles: [] }), a);
});

test('4. the index names the first tool, not a path or setting written before it', () => {
  const outDir = path.join(tmp(), 'catalog');
  writeCatalog({ tools: [S('weekly-review', { description: 'x' })], outDir,
    cases: [{ file: 'm', section: 'S', title: 'Weekly', tools: ['tools.md', 'weekly-review'], why: '' }] });
  assert.match(read(outDir, 'by-function.md'), /- Weekly → `weekly-review`/);
});

test('5. an off plugin skill whose plugin has MCP servers says it needs them', () => {
  const outDir = path.join(tmp(), 'catalog');
  const off = { origin: 'plugin', plugin: 'adobe', enabled: false, off: P('adobe@mk') };
  writeCatalog({ outDir, tools: [
    { kind: 'skill', name: 'adobe:resize', description: 'Resize', ...off },
    { kind: 'mcp-server', name: 'Adobe', description: '', server: { type: 'http', url: 'https://a.test' }, ...off },
    { kind: 'skill', name: 'gsap:core', description: 'Tweens', origin: 'plugin', plugin: 'gsap', enabled: false, off: P('gsap@mk') },
  ] });
  const skills = read(outDir, 'skills.md');
  assert.match(skills, /### adobe:resize[^#]*- needs: the MCP servers of plugin adobe/);
  assert.doesNotMatch(skills, /### gsap:core[^#]*- needs:/);
});

test('7. CLAUDE_CONFIG_DIR moves every Claude Code path, .claude.json included when it is there', async () => {
  const { claudeDir, claudeJsonPath } = await import('../lib/files.js');
  const dir = tmp();
  assert.equal(claudeDir('/h', {}), path.join('/h', '.claude'));
  assert.equal(claudeDir('/h', { CLAUDE_CONFIG_DIR: dir }), dir);
  assert.equal(claudeJsonPath('/h', { CLAUDE_CONFIG_DIR: dir }), path.join('/h', '.claude.json'), 'not there: the home one');
  fs.writeFileSync(path.join(dir, '.claude.json'), '{}');
  assert.equal(claudeJsonPath('/h', { CLAUDE_CONFIG_DIR: dir }), path.join(dir, '.claude.json'));

  const { home, workRoot } = makeToolsHome();
  const moved = path.join(tmp(), 'cfg');
  fs.cpSync(path.join(home, '.claude'), moved, { recursive: true });
  fs.rmSync(path.join(home, '.claude'), { recursive: true });
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = moved;
  try {
    // installed_plugins.json still points into the old folder here, so check a personal skill and the user MCP list.
    const found = discoverTools({ home, workRoot });
    assert.ok(found.some((t) => t.name === 'quiet' && t.origin === 'personal'));
    assert.ok(found.some((t) => t.name === 'fs' && t.origin === 'user-mcp'));
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev;
  }
});

test('8. no Read-rule hint for a user who runs in bypass mode', () => {
  const bin = fileURLToPath(new URL('../bin/stockroom.js', import.meta.url));
  const { home, workRoot } = makeToolsHome();
  const file = path.join(home, '.claude', 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(read(path.dirname(file), 'settings.json')), skipDangerousModePermissionPrompt: true }));
  const out = spawnSync(process.execPath, [bin, 'status'], {
    cwd: workRoot, env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8', input: '' }).stdout;
  assert.doesNotMatch(out, /add "Read/);
});
