import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolOrigin, sourceLine, sourcePath, readSource, listSources, pruneSources } from '../lib/sources.js';

const put = (f, text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };

function home() {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'stockroom-src-'));
  const plugins = path.join(h, '.claude', 'plugins');
  put(path.join(plugins, 'installed_plugins.json'), JSON.stringify({ plugins: {
    'ext@official': [{ version: '1.2.0', gitCommitSha: 'abcdef1234567890' }],
    'local@official': [{ version: '0.3.0' }],
    'own@solo': [{ version: '2.0.0' }],
  } }));
  put(path.join(plugins, 'known_marketplaces.json'), JSON.stringify({
    official: { source: { source: 'github', repo: 'acme/plugins' }, installLocation: path.join(plugins, 'marketplaces', 'official') },
    solo: { source: { source: 'github', repo: 'jane/own' }, installLocation: path.join(plugins, 'marketplaces', 'solo') },
  }));
  put(path.join(plugins, 'marketplaces', 'official', '.claude-plugin', 'marketplace.json'), JSON.stringify({ plugins: [
    { name: 'ext', source: { source: 'git-subdir', url: 'https://github.com/Maker/tools.git', path: 'plugins/ext' } },
    { name: 'local', source: './plugins/local' },
  ] }));
  put(path.join(plugins, 'marketplaces', 'solo', '.claude-plugin', 'marketplace.json'), JSON.stringify({ plugins: [
    { name: 'own', source: './' }] }));
  put(path.join(h, '.agents', '.skill-lock.json'), JSON.stringify({ skills: {
    animate: { sourceUrl: 'https://github.com/emil/skills.git', skillPath: 'skills/animate/SKILL.md', skillFolderHash: '99aa88bb77cc66dd' },
  } }));
  return h;
}

const plug = (name, id) => ({ kind: 'skill', name: `${name}:x`, origin: 'plugin', plugin: name, off: { via: 'enabledPlugins', key: id } });

test('toolOrigin: plugins from their marketplace entry, with version', () => {
  const h = home();
  assert.deepEqual(toolOrigin(plug('ext', 'ext@official'), { home: h }),
    { repo: 'Maker/tools', path: 'plugins/ext', version: '1.2.0+abcdef123456' });
  assert.deepEqual(toolOrigin(plug('local', 'local@official'), { home: h }),
    { repo: 'acme/plugins', path: 'plugins/local', version: '0.3.0' });
  assert.deepEqual(toolOrigin(plug('own', 'own@solo'), { home: h }), { repo: 'jane/own', version: '2.0.0' });
});

test('toolOrigin: personal skills from the skills lock; MCP servers from package or url; own skills have none', () => {
  const h = home();
  const skill = { kind: 'skill', name: 'animate', origin: 'personal', skillDir: '/h/.claude/skills/animate' };
  assert.deepEqual(toolOrigin(skill, { home: h }), { repo: 'emil/skills', path: 'skills/animate', version: '99aa88bb77cc' });
  const mine = { kind: 'skill', name: 'weekly-review', origin: 'personal', skillDir: '/h/.claude/skills/weekly-review' };
  assert.equal(toolOrigin(mine, { home: h }), null);
  const npx = { kind: 'mcp-server', name: 'a', origin: 'user-mcp', server: { command: 'npx', args: ['-y', '@acme/mcp@1.4.0'] } };
  assert.deepEqual(toolOrigin(npx, { home: h }), { package: 'npm:@acme/mcp', version: '1.4.0' });
  const cmd = { kind: 'mcp-server', name: 'b', origin: 'user-mcp', server: { command: 'cmd', args: ['/c', 'npx', 'tool-mcp'] } };
  assert.deepEqual(toolOrigin(cmd, { home: h }), { package: 'npm:tool-mcp' });
  const uvx = { kind: 'mcp-server', name: 'c', origin: 'user-mcp', server: { command: 'uvx', args: ['example-mcp'] } };
  assert.deepEqual(toolOrigin(uvx, { home: h }), { package: 'pypi:example-mcp' });
  const remote = { kind: 'mcp-server', name: 'd', origin: 'user-mcp', server: { type: 'http', url: 'https://mcp.x.test/mcp' } };
  assert.deepEqual(toolOrigin(remote, { home: h }), { url: 'https://mcp.x.test/mcp' });
  const exe = { kind: 'mcp-server', name: 'e', origin: 'user-mcp', server: { command: 'C:/bin/thing.exe' } };
  assert.equal(toolOrigin(exe, { home: h }), null);
});

test('sourceLine: one readable line per kind of origin', () => {
  assert.equal(sourceLine({ repo: 'Maker/tools', path: 'plugins/ext', version: '1.2.0' }),
    'https://github.com/Maker/tools (folder plugins/ext) · version 1.2.0');
  assert.equal(sourceLine({ package: 'npm:@acme/mcp' }), 'npm:@acme/mcp');
  assert.equal(sourceLine(null), '');
});

test('source cache: read, list; a version change invalidates and prune removes the old file', () => {
  const h = home();
  const v1 = { repo: 'Maker/tools', path: 'plugins/ext', version: '1.2.0' };
  // Claude writes it with its own tools, at the path draft-data prints.
  fs.mkdirSync(path.dirname(sourcePath(h, v1)), { recursive: true });
  fs.writeFileSync(sourcePath(h, v1), '# Ext\nOfficial README.');
  assert.equal(readSource(h, v1), '# Ext\nOfficial README.');
  const v2 = { ...v1, version: '1.3.0' };
  assert.equal(readSource(h, v2), null, 'new version: not cached');
  assert.equal(listSources(h).length, 1);
  assert.deepEqual(pruneSources(h, [v2]).length, 1);
  assert.equal(listSources(h).length, 0);
});
