import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planShelf, applyShelf, undoShelf, projectConflicts, mcpPrefix } from '../lib/shelf.js';
import { toolUsage } from '../lib/measure.js';

const DAY = 86400000;
const now = Date.UTC(2026, 9, 21);
const base = { shelf: null, days: 30, list: [], neverOff: [] };
const P = (id) => ({ via: 'enabledPlugins', key: id });

const tools = [
  { kind: 'skill', name: 'used', origin: 'personal', enabled: true, off: { via: 'skillOverrides', key: 'used' } },
  { kind: 'skill', name: 'idle', origin: 'personal', enabled: true, off: { via: 'skillOverrides', key: 'idle' } },
  { kind: 'skill', name: 'idle', origin: 'project', enabled: true, off: { via: 'skillOverrides', key: 'idle' } },
  { kind: 'skill', name: 'beatlab-x', origin: 'personal', enabled: true, off: { via: 'skillOverrides', key: 'beatlab-x' } },
  { kind: 'skill', name: 'already', origin: 'personal', enabled: false, off: { via: 'skillOverrides', key: 'already' } },
  { kind: 'skill', name: 'anthropic-skills:pdf', origin: 'account', enabled: true },
  { kind: 'agent', name: 'helper', origin: 'personal', enabled: true },
  { kind: 'hook', name: 'settings:Stop', origin: 'settings', enabled: true },
  { kind: 'plugin', name: 'busy', origin: 'plugin', plugin: 'busy', enabled: true, off: P('busy@mk') },
  { kind: 'skill', name: 'busy:a', origin: 'plugin', plugin: 'busy', enabled: true, off: P('busy@mk') },
  { kind: 'skill', name: 'busy:b', origin: 'plugin', plugin: 'busy', enabled: true, off: P('busy@mk') },
  { kind: 'plugin', name: 'quiet', origin: 'plugin', plugin: 'quiet', enabled: true, off: P('quiet@mk') },
  { kind: 'skill', name: 'quiet:a', origin: 'plugin', plugin: 'quiet', enabled: true, off: P('quiet@mk') },
  { kind: 'plugin', name: 'hooky', origin: 'plugin', plugin: 'hooky', enabled: true, off: P('hooky@mk') },
  { kind: 'hook', name: 'hooky:SessionStart', origin: 'plugin', plugin: 'hooky', enabled: true, off: P('hooky@mk') },
  { kind: 'mcp-server', name: 'docs', origin: 'plugin', plugin: 'quiet', enabled: true, off: P('quiet@mk') },
  { kind: 'mcp-server', name: 'fs', origin: 'user-mcp', enabled: true, off: { via: 'deniedMcpServers', key: 'fs' } },
  { kind: 'mcp-server', name: 'web', origin: 'project-mcp', enabled: true, off: { via: 'disabledMcpjsonServers', key: 'web' } },
];
const usage = new Map([['used', now - 2 * DAY], ['busy:b', now - 3 * DAY], ['mcp__fs', now - 1 * DAY]]);
const offKeys = (r) => r.off.map((o) => `${o.via}/${o.key}`).sort();

test('shelf null turns nothing off', () => {
  assert.deepEqual(planShelf({ tools, config: base, usage, now }), { off: [], on: [], cannot: [], kept: [] });
});

test("shelf 'none' turns off everything except neverOff; plugin items go with their plugin", () => {
  const r = planShelf({ tools, config: { ...base, shelf: 'none', neverOff: ['beatlab-*', 'hooky'] }, usage, now });
  assert.deepEqual(offKeys(r), [
    'deniedMcpServers/fs', 'disabledMcpjsonServers/web', 'enabledPlugins/busy@mk', 'enabledPlugins/quiet@mk',
    'skillOverrides/idle', 'skillOverrides/used',
  ]);
  assert.deepEqual(r.cannot.map((c) => c.tool.name).sort(), ['anthropic-skills:pdf', 'helper', 'settings:Stop']);
  assert.ok(r.cannot.every((c) => c.reason));
});

test("shelf 'usage' keeps what was used within days, and plugins whose use cannot be measured", () => {
  const r = planShelf({ tools, config: { ...base, shelf: 'usage' }, usage, now });
  assert.deepEqual(offKeys(r), [
    'disabledMcpjsonServers/web', 'enabledPlugins/quiet@mk', 'skillOverrides/beatlab-x', 'skillOverrides/idle',
  ]);
  assert.ok(r.cannot.some((c) => c.tool.name === 'hooky' && /hook/i.test(c.reason)));
});

test("shelf 'list' turns off only the listed patterns", () => {
  const r = planShelf({ tools, config: { ...base, shelf: 'list', list: ['idle', 'quiet'] }, usage, now });
  assert.deepEqual(offKeys(r), ['enabledPlugins/quiet@mk', 'skillOverrides/idle']);
});

test('a plugin with a neverOff item stays on', () => {
  const r = planShelf({ tools, config: { ...base, shelf: 'none', neverOff: ['quiet:a'] }, usage, now });
  assert.ok(!offKeys(r).includes('enabledPlugins/quiet@mk'));
});

function tmp(settings) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stockroom-shelf-'));
  const settingsPath = path.join(dir, 'settings.json');
  if (settings !== undefined) fs.writeFileSync(settingsPath, typeof settings === 'string' ? settings : JSON.stringify(settings));
  return { settingsPath, stateDir: path.join(dir, 'state') };
}
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const off = [
  { via: 'skillOverrides', key: 'idle' }, { via: 'skillOverrides', key: 'mine' },
  { via: 'enabledPlugins', key: 'quiet@mk' }, { via: 'enabledPlugins', key: 'busy@mk' },
  { via: 'deniedMcpServers', key: 'fs' }, { via: 'disabledMcpjsonServers', key: 'web' },
];

test('applyShelf writes every route, keeps the user entries, backs up', () => {
  const s = tmp({ theme: 'dark', skillOverrides: { mine: 'name-only' }, enabledPlugins: { 'busy@mk': true },
    deniedMcpServers: [{ serverName: 'other' }] });
  const { backupPath } = applyShelf({ ...s, off });
  assert.deepEqual(read(s.settingsPath), {
    theme: 'dark',
    skillOverrides: { mine: 'name-only', idle: 'off' },
    enabledPlugins: { 'busy@mk': false, 'quiet@mk': false },
    deniedMcpServers: [{ serverName: 'other' }, { serverName: 'fs' }],
    disabledMcpjsonServers: ['web'],
  });
  assert.equal(read(backupPath).theme, 'dark');
});

test('undoShelf restores what it changed, leaves what the user changed since', () => {
  const s = tmp({ skillOverrides: { mine: 'name-only' }, enabledPlugins: { 'busy@mk': true } });
  applyShelf({ ...s, off });
  const now2 = read(s.settingsPath);
  now2.enabledPlugins['quiet@mk'] = true; // user turned it back on by hand
  now2.theme = 'light';
  fs.writeFileSync(s.settingsPath, JSON.stringify(now2));
  const { restored } = undoShelf(s);
  assert.equal(restored.length, 4); // 5 written; quiet@mk was turned back on by hand
  assert.deepEqual(read(s.settingsPath), {
    skillOverrides: { mine: 'name-only' },
    enabledPlugins: { 'busy@mk': true, 'quiet@mk': true },
    theme: 'light',
  });
  assert.deepEqual(undoShelf(s).restored, []);
});

test('apply then undo gives back the exact settings', () => {
  const s = tmp({ theme: 'dark' });
  applyShelf({ ...s, off });
  undoShelf(s);
  assert.deepEqual(read(s.settingsPath), { theme: 'dark' });
});

test('broken settings JSON: clear error, nothing written', () => {
  const s = tmp('{ broken');
  assert.throws(() => applyShelf({ ...s, off }), /not valid JSON/);
  assert.equal(fs.readFileSync(s.settingsPath, 'utf8'), '{ broken');
  assert.equal(fs.existsSync(s.stateDir), false);
});

test('a missing settings.json is created, with no backup', () => {
  const s = tmp();
  const { backupPath } = applyShelf({ ...s, off: [{ via: 'skillOverrides', key: 'a' }] });
  assert.equal(backupPath, null);
  assert.deepEqual(read(s.settingsPath), { skillOverrides: { a: 'off' } });
});

test('projectConflicts lists project settings that override the user file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stockroom-pc-'));
  fs.mkdirSync(path.join(root, 'repo', '.claude'), { recursive: true });
  fs.writeFileSync(path.join(root, 'repo', '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'x@y': true } }));
  fs.writeFileSync(path.join(root, 'repo', '.claude', 'settings.local.json'), JSON.stringify({ theme: 'dark' }));
  const found = projectConflicts({ workRoot: root });
  assert.equal(found.length, 1);
  assert.match(found[0], /settings\.json.*enabledPlugins/);
});

test('mcpPrefix matches how Claude Code names MCP tools', () => {
  assert.equal(mcpPrefix({ name: 'codebase-memory-mcp', origin: 'user-mcp' }), 'mcp__codebase-memory-mcp');
  assert.equal(mcpPrefix({ name: 'cloudflare', origin: 'plugin', plugin: 'cloudflare' }), 'mcp__plugin_cloudflare_cloudflare');
  assert.equal(mcpPrefix({ name: 'my.server', origin: 'user-mcp' }), 'mcp__my_server');
});

test('toolUsage: skills from .claude.json and transcripts, MCP servers, agents, commands; sidechains ignored', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stockroom-use-'));
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ skillUsage: { 'weekly-review': { usageCount: 2, lastUsedAt: now - 5 * DAY } } }));
  const dir = path.join(home, '.claude', 'projects', 'p');
  fs.mkdirSync(dir, { recursive: true });
  const at = (d) => new Date(now - d * DAY).toISOString();
  const call = (name, input, d, extra = {}) => JSON.stringify({ type: 'assistant', timestamp: at(d), ...extra,
    message: { content: [{ type: 'tool_use', id: 't', name, input }] } });
  fs.writeFileSync(path.join(dir, 's.jsonl'), [
    call('Skill', { skill: 'impeccable:impeccable' }, 3),
    call('mcp__codebase-memory-mcp__search_graph', {}, 1),
    call('mcp__plugin_cloudflare_cloudflare__docs', {}, 2),
    call('Agent', { subagent_type: 'codebase-memory' }, 4),
    JSON.stringify({ type: 'user', timestamp: at(6), message: { content: '<command-name>/watch</command-name>' } }),
    call('Skill', { skill: 'from-subagent' }, 1, { isSidechain: true }),
    call('Skill', { skill: 'too-old' }, 60),
  ].join('\n'));
  const u = toolUsage({ home, days: 30, now });
  assert.equal(u.get('weekly-review'), now - 5 * DAY);
  assert.equal(u.get('impeccable:impeccable'), now - 3 * DAY);
  assert.equal(u.get('mcp__codebase-memory-mcp'), now - 1 * DAY);
  assert.equal(u.get('mcp__plugin_cloudflare_cloudflare'), now - 2 * DAY);
  assert.equal(u.get('codebase-memory'), now - 4 * DAY);
  assert.equal(u.get('watch'), now - 6 * DAY);
  assert.equal(u.has('from-subagent'), false);
  assert.equal(u.has('too-old'), false);
});

// Task 13: shelf "map" and the user's rules.
const S = (name, extra = {}) => ({ kind: 'skill', name, origin: 'personal', enabled: true, off: { via: 'skillOverrides', key: name }, ...extra });
const mapTools = [
  S('animate'), S('emil-design-eng'), S('review-animations'), S('gsap-timeline'), S('gsap-core'), S('blender-x'),
  S('loose'), S('loose-used'), S('impeccable'), S('frontend-design'),
  { kind: 'plugin', name: 'gs', origin: 'plugin', plugin: 'gs', enabled: true, off: P('gs@mk') },
  { kind: 'skill', name: 'gs:scroll', origin: 'plugin', plugin: 'gs', enabled: true, off: P('gs@mk') },
  { kind: 'skill', name: 'gs:react', origin: 'plugin', plugin: 'gs', enabled: true, off: P('gs@mk') },
];
const mapCases = [
  { file: 'm', section: 'Movimiento web', title: 'Decidir', tools: ['animate', 'emil-design-eng'], why: '' },
  { file: 'm', section: 'Movimiento web', title: 'Secuencias', tools: ['gsap-timeline', 'gsap-core', 'review-animations'], why: '' },
  { file: 'm', section: 'Movimiento web', title: 'Scroll', tools: ['gs:scroll', 'gs:react'], why: '' },
  { file: 'm', section: 'Diseño', title: 'Revisar', tools: ['frontend-design', 'impeccable'], why: '' },
  { file: 'm', section: '3D', title: 'Modelar', tools: ['blender-x'], why: '' },
];
const mapUsage = new Map([['review-animations', now - 2 * DAY], ['loose-used', now - 1 * DAY]]);
const plan = (extra) => planShelf({ tools: mapTools, cases: mapCases, usage: mapUsage, now,
  config: { ...base, shelf: 'map', keep: 1, unmapped: 'keep', alwaysOff: [], sections: {}, ...extra } });
const offNames = (r) => r.off.map((o) => o.tool.name).sort();

test("shelf 'map': first of each case stays, unused alternatives go, used ones stay; reasons given", () => {
  const r = plan();
  assert.deepEqual(offNames(r), ['emil-design-eng', 'gsap-core', 'impeccable']);
  assert.equal(r.off.find((o) => o.tool.name === 'gsap-core').reason, 'alternative #2 in "Secuencias"');
  assert.ok(!offNames(r).includes('review-animations'), 'used within days');
  assert.ok(!offNames(r).includes('loose'), 'unmapped: keep');
});

test("shelf 'map': keep 2, a plugin stays when one of its items stays", () => {
  assert.deepEqual(offNames(plan({ keep: 2 })), []);
  const r = plan();
  assert.ok(!offNames(r).includes('gs'));
  assert.match(r.cannot.find((x) => x.tool.name === 'gs:react').reason, /plugin gs stays on/);
});

test("shelf 'map': section rules (keep, days, order) and unmapped", () => {
  assert.deepEqual(offNames(plan({ sections: { 'Movimiento*': { keep: 2 } } })), ['impeccable']);
  assert.deepEqual(offNames(plan({ sections: { 'Diseño': { order: ['impeccable'] } } })), ['emil-design-eng', 'frontend-design', 'gsap-core']);
  assert.ok(offNames(plan({ sections: { 'Movimiento web': { days: 1 } } })).includes('review-animations'),
    'used 2 days ago, but the section only counts 1 day');
  assert.deepEqual(offNames(plan({ unmapped: 'off' })).filter((n) => n.startsWith('loose')), ['loose', 'loose-used']);
  assert.deepEqual(offNames(plan({ unmapped: 'usage' })).filter((n) => n.startsWith('loose')), ['loose']);
});

test("alwaysOff turns off in any mode; neverOff beats it", () => {
  assert.ok(offNames(plan({ alwaysOff: ['animate'] })).includes('animate'));
  assert.equal(plan({ alwaysOff: ['animate'] }).off.find((o) => o.tool.name === 'animate').reason, 'alwaysOff');
  assert.ok(!offNames(plan({ alwaysOff: ['blender-*'], neverOff: ['blender-*'] })).includes('blender-x'));
  const usageMode = planShelf({ tools: mapTools, usage: mapUsage, now, config: { ...base, shelf: 'usage', alwaysOff: ['loose-used'] } });
  assert.ok(offNames(usageMode).includes('loose-used'));
});

test("shelf 'map' without a map is an error", () => {
  assert.throws(() => planShelf({ tools: mapTools, cases: [], now, config: { ...base, shelf: 'map' } }), /map/);
});

test('protected tools: a critical rule keeps them on, listed under kept; a plugin with a protected item stays on', () => {
  const r = planShelf({ tools, config: { ...base, shelf: 'usage' }, usage, now, protectedNames: new Set(['idle', 'quiet:a']) });
  const off = r.off.map((o) => o.tool.name);
  assert.ok(!off.includes('idle'));
  assert.ok(!off.includes('quiet'), 'plugin "quiet" holds the protected skill');
  assert.deepEqual(r.kept.map((k) => [k.tool.name, k.reason]).sort(),
    [['idle', 'required by a critical rule'], ['quiet', 'required by a critical rule']]);
});

test('without protected names the plan is the same as before', () => {
  const a = planShelf({ tools, config: { ...base, shelf: 'usage' }, usage, now });
  const b = planShelf({ tools, config: { ...base, shelf: 'usage' }, usage, now, protectedNames: new Set() });
  assert.deepEqual(b.off, a.off);
  assert.deepEqual(a.kept, []);
});

test("shelf 'usage': a tool installed less than \"days\" ago counts as used", () => {
  const fresh = tools.map((t) => (t.plugin === 'quiet' || t.name === 'beatlab-x' ? { ...t, since: now - 2 * DAY } : t));
  const r = planShelf({ tools: fresh, config: { ...base, shelf: 'usage' }, usage, now });
  assert.deepEqual(offKeys(r), ['disabledMcpjsonServers/web', 'skillOverrides/idle']);
  const old = tools.map((t) => (t.name === 'beatlab-x' ? { ...t, since: now - 40 * DAY } : t));
  assert.ok(offKeys(planShelf({ tools: old, config: { ...base, shelf: 'usage' }, usage, now })).includes('skillOverrides/beatlab-x'));
});

test('a recent install never turns back on a tool Stockroom turned off: that needs a real use', () => {
  const off = [{ kind: 'skill', name: 'fresh', origin: 'personal', enabled: false, since: now - DAY, off: { via: 'skillOverrides', key: 'fresh' } }];
  const applied = [{ via: 'skillOverrides', key: 'fresh' }];
  assert.deepEqual(planShelf({ tools: off, config: { ...base, shelf: 'usage' }, usage: new Map(), now, applied }).on, []);
  const r = planShelf({ tools: off, config: { ...base, shelf: 'usage' }, usage: new Map([['fresh', now - DAY]]), now, applied });
  assert.deepEqual(r.on.map((o) => o.key), ['fresh']);
});

test("shelf 'usage' + keepTop: only the N most-used stay on, a plugin scored by its items; a week-old install stays", () => {
  const two = [
    { kind: 'skill', name: 'top', origin: 'personal', enabled: true, off: { via: 'skillOverrides', key: 'top' } },
    { kind: 'skill', name: 'rare', origin: 'personal', enabled: true, off: { via: 'skillOverrides', key: 'rare' } },
    { kind: 'skill', name: 'new', origin: 'personal', enabled: true, since: now - 3 * DAY, off: { via: 'skillOverrides', key: 'new' } },
    { kind: 'skill', name: 'month', origin: 'personal', enabled: true, since: now - 20 * DAY, off: { via: 'skillOverrides', key: 'month' } },
    { kind: 'plugin', name: 'busy', origin: 'plugin', plugin: 'busy', enabled: true, off: P('busy@mk') },
    { kind: 'skill', name: 'busy:a', origin: 'plugin', plugin: 'busy', enabled: true, off: P('busy@mk') },
    { kind: 'skill', name: 'busy:b', origin: 'plugin', plugin: 'busy', enabled: true, off: P('busy@mk') },
  ];
  const used = new Map(['top', 'rare', 'busy:a', 'busy:b'].map((n) => [n, now - DAY]));
  const counts = new Map([['top', 5], ['rare', 1], ['busy:a', 2], ['busy:b', 2]]);
  const r = planShelf({ tools: two, config: { ...base, shelf: 'usage', keepTop: 2 }, usage: used, counts, now });
  assert.deepEqual(offKeys(r), ['skillOverrides/month', 'skillOverrides/rare']);
  assert.match(r.off.find((o) => o.key === 'rare').reason, /not in your 2 most used/);
  // Without keepTop nothing used changes.
  assert.deepEqual(offKeys(planShelf({ tools: two, config: { ...base, shelf: 'usage' }, usage: used, counts, now })), []);
});

test('toolUsage: claude -p runs (entrypoint sdk-cli) do not count; counts tallies transcript uses', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stockroom-sdk-'));
  const dir = path.join(home, '.claude', 'projects', 'p');
  fs.mkdirSync(dir, { recursive: true });
  const call = (skill, entrypoint) => JSON.stringify({ type: 'assistant', entrypoint, timestamp: new Date(now - DAY).toISOString(),
    message: { content: [{ type: 'tool_use', id: 't', name: 'Skill', input: { skill } }] } });
  fs.writeFileSync(path.join(dir, 's.jsonl'), [call('mine', 'cli'), call('mine', 'cli'), call('exam', 'sdk-cli')].join('\n'));
  const counts = new Map();
  const u = toolUsage({ home, days: 30, now, counts });
  assert.equal(u.has('exam'), false);
  assert.equal(counts.get('mine'), 2);
});
