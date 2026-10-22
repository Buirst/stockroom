import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeToolsHome } from './fixtures.js';

const bin = fileURLToPath(new URL('../bin/stockroom.js', import.meta.url));

function cli(home, cwd, ...args) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd, env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8', input: '',
  });
}
const state = (home) => path.join(home, '.claude', 'stockroom');
const config = (home, c) => {
  fs.mkdirSync(state(home), { recursive: true });
  fs.writeFileSync(path.join(state(home), 'config.json'), JSON.stringify(c));
};

test('no command prints usage and exits 2', () => {
  const { home, workRoot } = makeToolsHome();
  const r = cli(home, workRoot);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /status/);
});

test('status counts tools by kind and on/off', () => {
  const { home, workRoot } = makeToolsHome();
  const r = cli(home, workRoot, 'status');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /skill\s+\d+ on\s+\d+ off/);
  assert.match(r.stdout, /mcp-server/);
  assert.match(r.stdout, /Catalog: not written yet/);
});

test('catalog writes the catalog; status then shows its age', () => {
  const { home, workRoot } = makeToolsHome();
  assert.equal(cli(home, workRoot, 'catalog').status, 0);
  assert.ok(fs.existsSync(path.join(state(home), 'catalog', 'skills.md')));
  assert.match(cli(home, workRoot, 'status').stdout, /Catalog: .*catalog.*written/);
});

test('check without a map explains that none is needed', () => {
  const { home, workRoot } = makeToolsHome();
  const r = cli(home, workRoot, 'check');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /No map/);
  assert.match(r.stdout, /map init/);
});

test('check prints names in the map that match no tool', () => {
  const { home, workRoot } = makeToolsHome();
  const map = path.join(home, 'map.md');
  fs.writeFileSync(map, '| Case | Tool | Why |\n|---|---|---|\n| Debug | `debugging`, `ghost-tool` | x |\n');
  config(home, { mapFiles: [map] });
  const r = cli(home, workRoot, 'check');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ghost-tool/);
  assert.doesNotMatch(r.stdout, /`debugging`.*no tool/);
});

test('shelf apply without a plan is an error', () => {
  const { home, workRoot } = makeToolsHome();
  const r = cli(home, workRoot, 'shelf', 'apply');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /shelf plan/);
});

test('shelf plan with shelf null says nothing will be turned off', () => {
  const { home, workRoot } = makeToolsHome();
  const r = cli(home, workRoot, 'shelf', 'plan');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /"shelf"/);
});

test('shelf plan, apply, undo round trip on settings.json', () => {
  const { home, workRoot } = makeToolsHome();
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const before = fs.readFileSync(settingsPath, 'utf8');
  config(home, { shelf: 'list', list: ['debugging'] });
  const plan = cli(home, workRoot, 'shelf', 'plan');
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /skillOverrides.*debugging/);
  assert.equal(fs.readFileSync(settingsPath, 'utf8'), before, 'plan changes nothing');
  assert.equal(cli(home, workRoot, 'shelf', 'apply').status, 0);
  assert.equal(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).skillOverrides.debugging, 'off');
  assert.equal(cli(home, workRoot, 'undo').status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')), JSON.parse(before));
});

test('map init writes an English starter map and refuses to overwrite', () => {
  const { home, workRoot } = makeToolsHome();
  const out = path.join(home, 'maps');
  const r = cli(home, workRoot, 'map', 'init', '--out', out);
  assert.equal(r.status, 0, r.stderr);
  const text = fs.readFileSync(path.join(out, 'stockroom-map.md'), 'utf8');
  assert.match(text, /\| Case \| Tool \| Why \|/);
  assert.match(text, /`tools:design-critique`/);
  const again = cli(home, workRoot, 'map', 'init', '--out', out);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already exists/);
});

test('an invalid config is reported with the key name', () => {
  const { home, workRoot } = makeToolsHome();
  config(home, { shelf: 'ninguna' });
  const r = cli(home, workRoot, 'status');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /shelf/);
});

test('map draft-data: without --group lists the groups', () => {
  const { home, workRoot } = makeToolsHome();
  const r = cli(home, workRoot, 'map', 'draft-data');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ {2}tools: \d+ tools/m);
  assert.match(r.stdout, /--group/);
});

test('map draft-data --group: full description, status, use, map rows, where to save the source', () => {
  const { home, workRoot } = makeToolsHome();
  const map = path.join(home, 'map.md');
  fs.writeFileSync(map, '## Review\n\n| Case | Tool | Why |\n|---|---|---|\n| Review a diff | `design-critique`, `reviewer` | x |\n');
  config(home, { mapFiles: [map] });
  const r = cli(home, workRoot, 'map', 'draft-data', '--group', 'tools');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /### tools:reviewer\n- kind: agent · status: on/);
  assert.ok(r.stdout.includes('Reviews a diff.\nÜnïcode ✓ and two lines.'), 'description verbatim');
  assert.match(r.stdout, /- last used: not in the last 30 days/);
  assert.match(r.stdout, /- in the map: Review › Review a diff \(#2 of 2\)/);
  assert.ok(!/### tools:SessionStart/.test(r.stdout), 'hooks are left out');
});

test('map draft-data: project tools are grouped by their project folder', () => {
  const { home, workRoot } = makeToolsHome();
  const r = cli(home, workRoot, 'map', 'draft-data');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ {2}project other: 3 tools/m);
  const g = cli(home, workRoot, 'map', 'draft-data', '--group', 'project other');
  assert.equal(g.status, 0, g.stderr);
  assert.match(g.stdout, /### debugging/);
});

test('map draft-data: unknown group is an error naming the groups', () => {
  const { home, workRoot } = makeToolsHome();
  const r = cli(home, workRoot, 'map', 'draft-data', '--group', 'nope');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /No group "nope".*tools/s);
});

test('map draft-data: the group source is the repository, without one skill\'s folder', () => {
  const { home, workRoot } = makeToolsHome();
  fs.mkdirSync(path.join(home, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(home, '.agents', '.skill-lock.json'), JSON.stringify({ skills: {
    'design-critique': { sourceUrl: 'https://github.com/emil/skills.git', skillPath: 'skills/design-critique/SKILL.md', skillFolderHash: 'aa' } } }));
  const r = cli(home, workRoot, 'map', 'draft-data', '--group', 'emil/skills');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Official source: https:\/\/github\.com\/emil\/skills · version aa\n/);
  assert.match(r.stdout, /sources[\\/]emil_skills@aa\.md/);
});

test('shelf plan with shelf "map" prints the reason for each tool', () => {
  const { home, workRoot } = makeToolsHome();
  const map = path.join(home, 'map.md');
  fs.writeFileSync(map, '## Review\n\n| Case | Tool | Why |\n|---|---|---|\n| Critique | `design-critique`, `x` | x |\n');
  config(home, { shelf: 'map', mapFiles: [map] });
  const r = cli(home, path.join(workRoot, 'other'), 'shelf', 'plan');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /skillOverrides: x {2}\(skill x: alternative #2 in "Critique"\)/);
  config(home, { shelf: 'map' });
  const e = cli(home, workRoot, 'shelf', 'plan');
  assert.equal(e.status, 1);
  assert.match(e.stderr, /needs a map/);
});

test('map index writes the short index and never overwrites a file it did not write', () => {
  const { home, workRoot } = makeToolsHome();
  const map = path.join(home, 'map.md');
  fs.writeFileSync(map, '## Review\n\n| Case | Tool | Why |\n|---|---|---|\n| Critique | `design-critique`, `x` | x |\n');
  config(home, { mapFiles: [map] });
  const out = path.join(home, 'index.md');
  const r = cli(home, workRoot, 'map', 'index', '--out', out);
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(out, 'utf8'), /- Review: Critique → `design-critique`/);
  assert.equal(cli(home, workRoot, 'map', 'index', '--out', out).status, 0, 'rewrites its own file');
  fs.writeFileSync(out, 'my notes');
  const again = cli(home, workRoot, 'map', 'index', '--out', out);
  assert.equal(again.status, 1);
  assert.equal(fs.readFileSync(out, 'utf8'), 'my notes');
});
