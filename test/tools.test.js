import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverTools } from '../lib/tools.js';
import { parseFrontmatter } from '../lib/frontmatter.js';
import { makeToolsHome } from './fixtures.js';

const { home, workRoot } = makeToolsHome();
const tools = discoverTools({ home, workRoot });
const find = (kind, name, origin) =>
  tools.filter((t) => t.kind === kind && t.name === name && (!origin || t.origin === origin));
const one = (kind, name, origin) => {
  const hits = find(kind, name, origin);
  assert.equal(hits.length, 1, `${kind} ${name} ${origin || ''}: ${hits.length} hits`);
  return hits[0];
};

test('skills: personal, account, project, plugin, with their turn-off route', () => {
  assert.deepEqual(one('skill', 'debugging', 'personal').off, { via: 'skillOverrides', key: 'debugging' });
  assert.equal(one('skill', 'anthropic-skills:pdf', 'account').off, undefined);
  assert.equal(one('skill', 'migrate', 'project').enabled, true);
  const dc = one('skill', 'tools:design-critique', 'plugin');
  assert.deepEqual(dc.off, { via: 'enabledPlugins', key: 'tools@mk' });
  assert.equal(dc.plugin, 'tools');
  assert.ok(dc.pluginRoot && dc.skillDir.endsWith('design-critique'));
});

test('skillOverrides off marks a skill disabled; name-only stays enabled', () => {
  assert.equal(one('skill', 'hidden').enabled, false);
  assert.equal(one('skill', 'quiet').enabled, true);
});

test('description is the source text, verbatim', () => {
  const dbg = one('skill', 'debugging', 'personal');
  assert.equal(dbg.description, parseFrontmatter(fs.readFileSync(dbg.path, 'utf8')).data.description);
  assert.equal(one('agent', 'tools:reviewer').description, 'Reviews a diff.\nÜnïcode ✓ and two lines.');
  assert.equal(one('plugin', 'off').description, 'Video editing tools');
});

test('disabled plugin: its items are listed with enabled false', () => {
  assert.equal(one('plugin', 'off').enabled, false);
  assert.deepEqual(one('plugin', 'off').off, { via: 'enabledPlugins', key: 'off@mk' });
  assert.equal(one('skill', 'off:video').enabled, false);
  assert.equal(one('agent', 'off:editor').enabled, false);
  assert.equal(one('mcp-server', 'cutter').enabled, false);
  assert.equal(one('plugin', 'tools').enabled, true);
});

test('commands of plugins', () => {
  assert.equal(one('command', 'tools:watch').description, 'Watch a video and answer questions about it');
});

test('agents: user, project and plugin', () => {
  assert.equal(one('agent', 'helper', 'personal').off, undefined);
  assert.equal(one('agent', 'proj-agent', 'project').description, 'Project agent');
  assert.equal(one('agent', 'tools:reviewer', 'plugin').off.via, 'enabledPlugins');
});

test('MCP servers: user, local scope, .mcp.json, plugin; same name twice kept', () => {
  const fs1 = one('mcp-server', 'fs', 'user-mcp');
  assert.deepEqual(fs1.off, { via: 'deniedMcpServers', key: 'fs' });
  assert.deepEqual(fs1.server.args, ['fs.js']);
  assert.equal(fs1.description, '');
  assert.deepEqual(one('mcp-server', 'fs', 'project-mcp').server.args, ['fs2.js']);
  assert.equal(one('mcp-server', 'old').enabled, false);
  const web = one('mcp-server', 'web');
  assert.equal(web.origin, 'project-mcp');
  assert.deepEqual(web.off, { via: 'disabledMcpjsonServers', key: 'web' });
  assert.equal(web.enabled, false);
  assert.equal(web.server.url, 'https://web.test');
  const docs = one('mcp-server', 'docs', 'plugin');
  assert.equal(docs.plugin, 'tools');
  assert.equal(docs.server.command, 'node');
});

test('hooks: settings and plugin, described as "<event>: <command>"', () => {
  const hooks = tools.filter((t) => t.kind === 'hook');
  assert.ok(hooks.some((t) => t.origin === 'settings' && t.description === 'Stop: echo bye' && !t.off));
  assert.ok(hooks.some((t) => t.origin === 'plugin' && t.description === 'SessionStart: node start.js'
    && t.plugin === 'tools' && t.off.via === 'enabledPlugins'));
});

test('every repo under the work root is scanned, node_modules is not', () => {
  assert.equal(one('skill', 'x', 'project').description, 'Skill of the second repo');
  assert.equal(one('skill', 'lint', 'project').enabled, true);
  assert.equal(find('skill', 'nm').length, 0);
});

test('same name in two places: both appear', () => {
  assert.equal(find('skill', 'debugging').length, 2);
  assert.equal(one('skill', 'design-critique', 'personal').description, 'My own design critique');
  assert.ok(one('skill', 'tools:design-critique'));
});

test('an unreadable SKILL.md yields a warning, not a throw', () => {
  assert.match(one('skill', 'broken').warning, /\S/);
});

test('empty home and no work root: no tools, no throw', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'stockroom-empty-'));
  assert.deepEqual(discoverTools({ home: empty }), []);
});

test('depth limits the walk', () => {
  assert.equal(discoverTools({ home, workRoot, depth: 0 }).filter((t) => t.name === 'x').length, 0);
});

test('a plugin whose manifest also lists ./skills/ does not get its skills twice', () => {
  const { home, workRoot } = makeToolsHome();
  const manifest = path.join(home, '.claude', 'plugins', 'cache', 'mk', 'tools', '1.0.0', '.claude-plugin', 'plugin.json');
  const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  fs.writeFileSync(manifest, JSON.stringify({ ...m, skills: ['./skills/', ...[].concat(m.skills || [])] }));
  const names = discoverTools({ home, workRoot }).filter((t) => t.kind === 'skill').map((t) => `${t.origin} ${t.name}`);
  assert.equal(names.length, new Set(names).size, names.join(', '));
});
