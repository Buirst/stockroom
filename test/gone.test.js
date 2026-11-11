// A plugin update that renames or removes a skill leaves map rows and rules pointing nowhere: these tests cover how
// Stockroom notices and says so, and the second name Claude Code gives a skill whose frontmatter differs from its folder.
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGone, goneNames, matchName, checkMap } from '../lib/map.js';
import { goneNotice, runHook } from '../lib/hook.js';
import { discoverTools } from '../lib/tools.js';
import { planShelf } from '../lib/shelf.js';
import { makeToolsHome } from './fixtures.js';

const tools = [
  { kind: 'plugin', name: 'video', plugin: 'video', enabled: true },
  { kind: 'skill', name: 'video:cut', plugin: 'video', origin: 'plugin', enabled: true },
  { kind: 'skill', name: 'notes', enabled: true },
];

test('gone: a plugin:skill name whose plugin is installed but has no such skill', () => {
  assert.equal(isGone('video:dub', tools), true);
  assert.equal(isGone('skill video:dub', tools), true);
  assert.equal(isGone('video:d*', tools), true);
  assert.equal(isGone('video:cut', tools), false, 'still there');
  assert.equal(isGone('video:c*', tools), false);
  assert.equal(isGone('audio:mix', tools), false, 'a plugin that is not installed: could be anything');
  assert.equal(isGone('ffmpeg', tools), false, 'no plugin prefix: a program or a command');
  assert.equal(isGone('web https://example.test:8080/x', tools), false);
});

test('goneNames lists each name once, from cases and rules, with where it is named', () => {
  const cases = [{ file: 'm.md', title: 'Dub a clip', tools: ['video:dub', 'video:cut'] }, { file: 'm.md', title: 'Dub again', tools: ['video:dub'] }];
  const rules = [{ file: 'm.md', rule: 'Costs credits', tools: ['video:render-*'] }];
  assert.deepEqual(goneNames(cases, rules, tools),
    [{ token: 'video:dub', file: 'm.md', title: 'Dub a clip' }, { token: 'video:render-*', file: 'm.md', title: 'Costs credits' }]);
  assert.deepEqual(checkMap(cases, tools).unknown.map((u) => [u.token, u.gone]), [['video:dub', true], ['video:dub', true]]);
});

test('the session is told once per new missing name, never again for the same ones', () => {
  assert.equal(goneNotice([], []), '');
  assert.match(goneNotice(['video:dub'], []), /renamed or removed 1 tools the user's map names \(video:dub\)/);
  assert.equal(goneNotice(['video:dub'], ['video:dub']), '');
  assert.match(goneNotice(['a:1', 'a:2', 'a:3', 'a:4', 'a:5', 'a:6'], ['a:1']), /5 tools.*\(a:2, a:3, a:4, a:5, a:6\)/);
  assert.match(goneNotice(['a:1', 'a:2', 'a:3', 'a:4', 'a:5', 'a:6'], []), /a:5…\)/);
});

test('end to end: the hook says it when the map names a skill its plugin lost, and the index marks the row', () => {
  const { home, workRoot } = makeToolsHome();
  const map = path.join(home, 'map.md');
  fs.writeFileSync(map, '## Design\n\n| Job | Tool | Why |\n|---|---|---|\n| Old critique | `tools:critique-v1` | x |\n| Deploy | `tools:deploy` | x |\n');
  const state = path.join(home, '.claude', 'stockroom');
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, 'config.json'), JSON.stringify({ mapFiles: [map] }));
  const said = (out) => JSON.parse(out).hookSpecificOutput.additionalContext;
  assert.match(said(runHook({ home, input: { cwd: workRoot } })), /plugin update renamed or removed 1 tools the user's map names \(tools:critique-v1\)/);
  const index = fs.readFileSync(path.join(state, 'catalog', 'by-function.md'), 'utf8');
  assert.match(index, /- Old critique → `tools:critique-v1` \(gone: its plugin no longer has this skill/);
  assert.match(index, /- Deploy → `tools:deploy`\n/);
  // Something else changes (the map gets a row): the catalog is rewritten, the same missing name is not repeated.
  fs.appendFileSync(map, '| Watch | `tools:watch` | x |\n');
  assert.doesNotMatch(said(runHook({ home, input: { cwd: workRoot } })), /renamed or removed/);
});

test('a skill whose frontmatter name differs from its folder answers to both names', () => {
  const { home, workRoot } = makeToolsHome();
  const dir = path.join(home, '.claude', 'plugins', 'cache', 'mk', 'tools', '1.0.0', 'skills', 'taste');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: design-taste\ndescription: Second opinion on a design\n---\n');
  const found = discoverTools({ home, workRoot });
  const t = found.find((x) => x.name === 'tools:taste');
  assert.equal(t.alias, 'tools:design-taste');
  assert.equal(found.find((x) => x.name === 'tools:deploy').alias, undefined, 'same name: no second name');
  for (const n of ['tools:taste', 'tools:design-taste', 'design-taste', 'tools:design-*']) assert.deepEqual(matchName(n, found).includes(t), true, n);
  assert.equal(isGone('tools:design-taste', found), false);
});

test('a launch under the second name is a use: the shelf does not turn the skill off', () => {
  const now = Date.now();
  const t = { kind: 'skill', name: 'taste', alias: 'design-taste', enabled: true, origin: 'personal', description: '',
    off: { via: 'skillOverrides', key: 'taste' }, since: now - 90 * 86400000 };
  const plan = (usage) => planShelf({ tools: [t], config: { shelf: 'usage', days: 30, neverOff: [], alwaysOff: [], sections: {} }, usage, now });
  assert.equal(plan(new Map()).off.length, 1);
  assert.equal(plan(new Map([['design-taste', now - 86400000 * 2]])).off.length, 0);
});

test('on-use rules reach a skill launched under its second name', async () => {
  const { buildRules } = await import('../lib/rules.js');
  const { pretoolOutput } = await import('../lib/pretool.js');
  const t = { kind: 'skill', name: 'tools:taste', alias: 'tools:design-taste', enabled: true, plugin: 'tools', origin: 'plugin' };
  const built = buildRules({ rules: [{ file: 'm.md', section: 'S', tools: ['tools:taste'], rule: 'Lint first', level: 'on use' }], cases: [], tools: [t], config: {} });
  assert.deepEqual(built.index.rules, { 'tools:taste': ['Lint first'], 'tools:design-taste': ['Lint first'] });
  const out = pretoolOutput({ tool_name: 'Skill', tool_input: { skill: 'tools:design-taste' } }, built.index);
  assert.match(JSON.parse(out).hookSpecificOutput.additionalContext, /Stockroom rules for tools:design-taste: Lint first/);
});
