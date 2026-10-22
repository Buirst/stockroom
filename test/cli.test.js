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

function ruledHome() {
  const h = makeToolsHome();
  const map = path.join(h.home, 'map.md');
  fs.writeFileSync(map, '# Map\n\n| Tool | Rule | Level |\n|---|---|---|\n| `debugging` | Never on production data | critical |\n| `quiet` | Keep it short | |\n');
  config(h.home, { mapFiles: [map] });
  return { ...h, map };
}
const rulesFolder = (home) => path.join(home, '.claude', 'rules');

test('rules apply without a plan is an error', () => {
  const { home, workRoot } = ruledHome();
  const r = cli(home, workRoot, 'rules', 'apply');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /run "stockroom rules plan" first/);
});

test('rules plan, apply, undo round trip; plan changes nothing', () => {
  const { home, workRoot } = ruledHome();
  const p = cli(home, workRoot, 'rules', 'plan');
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /stockroom-critical\.md \(\d+ bytes\)/);
  assert.ok(!fs.existsSync(rulesFolder(home)));
  const a = cli(home, workRoot, 'rules', 'apply');
  assert.equal(a.status, 0, a.stderr);
  assert.match(fs.readFileSync(path.join(rulesFolder(home), 'stockroom-critical.md'), 'utf8'), /Never on production data/);
  const u = cli(home, workRoot, 'undo');
  assert.match(u.stdout, /stockroom-critical\.md/);
  assert.deepEqual(fs.readdirSync(rulesFolder(home)), []);
});

test('rules apply refuses when the map changed since the plan', () => {
  const { home, workRoot, map } = ruledHome();
  cli(home, workRoot, 'rules', 'plan');
  fs.appendFileSync(map, '| `quiet` | Another rule | |\n');
  const a = cli(home, workRoot, 'rules', 'apply');
  assert.equal(a.status, 1);
  assert.match(a.stderr, /the map changed since the plan/);
});

test('check prints rule warnings naming the map file', () => {
  const { home, workRoot, map } = ruledHome();
  fs.appendFileSync(map, '| `ghost` | Not installed | |\n');
  const r = cli(home, workRoot, 'check');
  assert.match(r.stdout, /map\.md · Map: "ghost" matches no installed tool/);
});

test('shelf plan keeps on what a critical rule names, in a "Kept on" block', () => {
  const { home, workRoot, map } = ruledHome();
  config(home, { mapFiles: [map], shelf: 'usage', days: 30 });
  const r = cli(home, workRoot, 'shelf', 'plan');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Kept on \(1\), named by a critical rule in your map:\n  skill debugging/);
  assert.doesNotMatch(r.stdout.split('Kept on')[0], /skillOverrides: debugging/);
});

test('report prints totals and --json gives the same numbers', () => {
  const { home, workRoot, map } = ruledHome();
  const proj = path.join(home, '.claude', 'projects', 'p');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 's.jsonl'), [
    JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { content: [{ type: 'tool_use', id: 'a', name: 'Read', input: { file_path: map } }] } }),
    JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: '| Find a bug | `debugging` | x |' }] } }),
  ].join('\n'));
  fs.appendFileSync(map, '\n| Job | Tool | Why |\n|---|---|---|\n| Find a bug | `debugging` | x |\n');
  const r = cli(home, workRoot, 'report', '--days', '7');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Map rows consulted: 1, followed: 0/);
  const j = JSON.parse(cli(home, workRoot, 'report', '--json').stdout);
  assert.deepEqual(j.totals, { consulted: 1, followed: 0, reads: 1, readsFollowed: 0 });
  assert.match(r.stdout, /Map reads: 1, followed by a tool they named: 0/);
});

const applied = (h) => { cli(h.home, h.workRoot, 'rules', 'plan'); return cli(h.home, h.workRoot, 'rules', 'apply'); };

test('doctor: a healthy setup is all ok and exits 0', () => {
  const h = ruledHome();
  assert.equal(applied(h).status, 0);
  const r = cli(h.home, h.workRoot, 'doctor');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /problem/);
  assert.match(r.stdout, /ok +hooks registered/);
  assert.match(r.stdout, /ok +generated rules match the map/);
});

test('doctor: a hand-edited generated file is a problem', () => {
  const h = ruledHome();
  applied(h);
  const f = path.join(rulesFolder(h.home), 'stockroom-critical.md');
  fs.appendFileSync(f, '\n- added by hand\n');
  const r = cli(h.home, h.workRoot, 'doctor');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /problem: .*stockroom-critical\.md differs from the map; run "stockroom rules plan" then "rules apply", or edit the map/);
});

test('doctor: a project whose paths match no file is a problem', () => {
  const h = ruledHome();
  config(h.home, { mapFiles: [h.map], projects: { Games: ['games/**'] } });
  const r = cli(h.home, h.workRoot, 'doctor');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /problem: project "Games" matches no files under /);
});
