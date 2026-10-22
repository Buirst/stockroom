import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeCatalog } from '../lib/catalog.js';
import { serverKey } from '../lib/mcp.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'stockroom-cat-'));
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
// The map by job: every section file, then the index.
const sections = (dir) => fs.readdirSync(path.join(dir, 'by-function')).map((f) => read(path.join(dir, 'by-function'), f));
const byFunction = (dir) => [...sections(dir), read(dir, 'by-function.md')].join('\n');

const multi = 'Line one.\nLine two with ünïcode ✓ and `code`.\n\n- a list item';
const tools = [
  { kind: 'skill', name: 'debugging', origin: 'personal', enabled: true, description: multi,
    path: '/h/.claude/skills/debugging/SKILL.md', skillDir: '/h/.claude/skills/debugging',
    off: { via: 'skillOverrides', key: 'debugging' } },
  { kind: 'skill', name: 'debugging', origin: 'project', enabled: true, description: 'Project debugging',
    path: '/w/.claude/skills/debugging/SKILL.md', skillDir: '/w/.claude/skills/debugging',
    off: { via: 'skillOverrides', key: 'debugging' } },
  { kind: 'skill', name: 'video:cut', origin: 'plugin', plugin: 'video', pluginRoot: '/p/video', enabled: false,
    description: 'Cut a video', path: '/p/video/skills/cut/SKILL.md', skillDir: '/p/video/skills/cut',
    off: { via: 'enabledPlugins', key: 'video@mk' } },
  { kind: 'plugin', name: 'video', origin: 'plugin', plugin: 'video', pluginRoot: '/p/video', enabled: false,
    description: 'Video tools', off: { via: 'enabledPlugins', key: 'video@mk' } },
  { kind: 'mcp-server', name: 'docs', origin: 'user-mcp', enabled: true, description: '',
    server: { command: 'node', args: ['docs.js'] }, off: { via: 'deniedMcpServers', key: 'docs' } },
  { kind: 'mcp-server', name: 'down', origin: 'user-mcp', enabled: true, description: '',
    server: { command: 'node', args: ['down.js'] }, off: { via: 'deniedMcpServers', key: 'down' } },
  { kind: 'mcp-server', name: 'never', origin: 'project-mcp', enabled: false, description: '',
    server: { type: 'http', url: 'https://x.test' }, off: { via: 'disabledMcpjsonServers', key: 'never' } },
  { kind: 'hook', name: 'settings:Stop', origin: 'settings', enabled: true, description: 'Stop: echo bye' },
  { kind: 'agent', name: 'helper', origin: 'personal', enabled: true, description: 'Helps with chores' },
  { kind: 'command', name: 'video:watch', origin: 'plugin', plugin: 'video', enabled: false, description: 'Watch it' },
];
const mcp = new Map([
  [serverKey(tools[4]), { instructions: 'Use for docs.\nReally.', tools: [{ name: 'search', description: 'Search the docs\nfully' }] }],
  [serverKey(tools[5]), { error: 'timed out after 10000 ms' }],
]);
const cases = [
  { file: 'map.md', section: 'Debug', title: 'A test fails', tools: ['video:cut', 'debugging', 'nope'], why: 'Root cause first' },
  { file: 'map.md', section: 'Debug', title: 'Another case', tools: ['debugging'], why: 'Again' },
];

test('every tool appears exactly once in its kind file, description verbatim', () => {
  const outDir = path.join(tmp(), 'catalog');
  const { files } = writeCatalog({ tools, cases, mcp, outDir });
  assert.ok(files.includes(path.join(outDir, 'README.md')));
  const all = { skill: 'skills.md', plugin: 'plugins.md', 'mcp-server': 'mcp.md', hook: 'hooks.md', agent: 'agents.md', command: 'commands.md' };
  for (const t of tools) {
    const text = read(outDir, all[t.kind]);
    const entry = `### ${t.name}\n- kind: ${t.kind} · origin: ${t.origin} ·`;
    const count = text.split(entry).length - 1;
    const same = tools.filter((x) => x.kind === t.kind && x.name === t.name && x.origin === t.origin).length;
    assert.equal(count, same, `${t.name} (${t.origin}) in ${all[t.kind]}`);
    assert.ok(text.includes(t.description), `${t.name} description`);
  }
});

test('entry format: status with how to turn on, paths', () => {
  const outDir = path.join(tmp(), 'catalog');
  writeCatalog({ tools, cases, mcp, outDir });
  const skills = read(outDir, 'skills.md');
  assert.ok(skills.includes(
    '### video:cut\n- kind: skill · origin: plugin · plugin: video · status: off (turn on: enabledPlugins["video@mk"] = true)\n'
    + '- path: /p/video/skills/cut/SKILL.md · skill folder: /p/video/skills/cut · plugin root: /p/video\nCut a video\n'));
  assert.ok(skills.includes('status: on\n- path: /h/.claude/skills/debugging/SKILL.md · skill folder: /h/.claude/skills/debugging · plugin root: -\n'));
  const servers = read(outDir, 'mcp.md');
  assert.match(servers, /status: off \(turn on: remove "never" from disabledMcpjsonServers\)/);
});

test('MCP entries carry instructions and tool descriptions, or why they were not read', () => {
  const outDir = path.join(tmp(), 'catalog');
  writeCatalog({ tools, cases, mcp, outDir });
  const servers = read(outDir, 'mcp.md');
  assert.ok(servers.includes('Use for docs.\nReally.'));
  assert.ok(servers.includes('#### search\nSearch the docs\nfully'));
  assert.ok(servers.includes('tools not read: timed out after 10000 ms'));
  assert.doesNotMatch(servers, /### never[^#]*tools not read yet/, 'a remote server is never read: no promise to read it');
});

test('by-function keeps map order, names on/off, flags names that match no tool', () => {
  const outDir = path.join(tmp(), 'catalog');
  writeCatalog({ tools, cases, mcp, outDir });
  const byFn = sections(outDir).join('\n');
  assert.ok(byFn.indexOf('A test fails') < byFn.indexOf('Another case'));
  const first = byFn.slice(byFn.indexOf('A test fails'), byFn.indexOf('Another case'));
  assert.ok(first.indexOf('video:cut') < first.indexOf('debugging'));
  assert.match(first, /`video:cut`.*off.*skills\.md/);
  assert.match(first, /`nope`.*not an installed tool name/);
  assert.match(first, /Root cause first/);
  assert.ok(!byFn.includes('Cut a video'), 'no descriptions duplicated in by-function');
});

test('no map: no by-function file, README says to browse by kind', () => {
  const outDir = path.join(tmp(), 'catalog');
  const { files } = writeCatalog({ tools, cases: [], mcp: new Map(), outDir });
  assert.ok(!fs.existsSync(path.join(outDir, 'by-function.md')));
  assert.ok(!files.some((f) => f.endsWith('by-function.md')));
  const readme = read(outDir, 'README.md');
  assert.match(readme, /skills\.md/);
  assert.match(readme, /SKILL\.md/);
  assert.match(readme, /restart/i);
});

test('a failure while writing leaves the previous catalog intact', () => {
  const outDir = path.join(tmp(), 'catalog');
  writeCatalog({ tools, cases, mcp, outDir });
  const before = read(outDir, 'skills.md');
  const broken = [...tools, { kind: 'agent', name: 'boom', origin: 'personal', enabled: true,
    get description() { throw new Error('disk full'); } }];
  assert.throws(() => writeCatalog({ tools: broken, cases, mcp, outDir }), /disk full/);
  assert.equal(read(outDir, 'skills.md'), before);
  assert.deepEqual(fs.readdirSync(path.dirname(outDir)), ['catalog']);
});

test('external tools: external.md with type, url, found and the rows that name them', () => {
  const outDir = path.join(tmp(), 'catalog');
  const ext = [
    { file: 'map.md', section: 'Media', title: 'Convert video', tools: ['CLI ffmpeg', 'app Upscayl'], why: 'Local' },
    { file: 'map.md', section: 'Design', title: 'Ideas', tools: ['web getlayers.ai'], why: 'Prompts' },
  ];
  const { files } = writeCatalog({ tools, cases: ext, mcp, outDir, onPath: (n) => n === 'ffmpeg' });
  assert.ok(files.includes(path.join(outDir, 'external.md')));
  const text = read(outDir, 'external.md');
  assert.match(text, /### ffmpeg\n- kind: external · type: cli · found on PATH: yes\n- named in: Media › Convert video/);
  assert.match(text, /### Upscayl\n- kind: external · type: app\n/);
  assert.match(text, /### getlayers\.ai\n- kind: external · type: web · url: https:\/\/getlayers\.ai\n- named in: Design › Ideas/);
  assert.match(byFunction(outDir), /`ffmpeg`: external cli · external\.md/);
  assert.match(read(outDir, 'README.md'), /external\.md/);
});

test('external CLI not checked when no PATH lookup is given (the hook)', () => {
  const outDir = path.join(tmp(), 'catalog');
  writeCatalog({ tools, cases: [{ file: 'm', section: 'S', title: 'T', tools: ['CLI ffmpeg'], why: '' }], mcp, outDir });
  assert.match(read(outDir, 'external.md'), /type: cli · found on PATH: not checked/);
});

test('by-function names parts and built-ins instead of flagging them', () => {
  const outDir = path.join(tmp(), 'catalog');
  const rows = [{ file: 'm', section: 'S', title: 'T', tools: ['MCP docs', 'search', '/clear', 'MEMORY.md'], why: '' }];
  writeCatalog({ tools, cases: rows, mcp, outDir });
  const byFn = byFunction(outDir);
  assert.match(byFn, /`search`: tool of MCP server `docs`/);
  assert.match(byFn, /`\/clear`: Claude Code built-in/);
  assert.ok(!byFn.includes('MEMORY.md'));
});

test('an entry with a known origin gets a source line', () => {
  const outDir = path.join(tmp(), 'catalog');
  const withSource = [{ ...tools[0], source: { repo: 'emil/skills', path: 'skills/debugging', version: 'abc' } }, tools[1]];
  writeCatalog({ tools: withSource, outDir });
  const skills = read(outDir, 'skills.md');
  assert.ok(skills.includes('plugin root: -\n- source: https://github.com/emil/skills (folder skills/debugging) · version abc\n'));
  assert.equal(skills.split('- source:').length, 2, 'no line when the origin is unknown');
});

test('by-function lines carry the tool source when known', () => {
  const outDir = path.join(tmp(), 'catalog');
  const withSource = [{ ...tools[0], source: { repo: 'emil/skills', path: 'skills/debugging' } }];
  writeCatalog({ tools: withSource, cases: [{ file: 'm', section: 'S', title: 'T', tools: ['debugging'], why: '' }], outDir });
  assert.match(byFunction(outDir), /`debugging`: on · personal · skills\.md · source: https:\/\/github\.com\/emil\/skills/);
});
