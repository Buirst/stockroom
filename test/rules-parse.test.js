import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMap, parseRules } from '../lib/map.js';
import { loadConfig } from '../lib/config.js';

const MAP = `# Map

## Media

| Job | Tool | Why |
|---|---|---|
| Edit photos | \`photo-kit\` | Local |

| Herramienta | Regla | Nivel |
|---|---|---|
| \`adobe-*\`, MCP \`adobe\` | Uploads files to the cloud: never client documents | crítica |
| \`skillui\` | Run it with a fake HOME | |
| * | Ask before spending credits | critical |
| \`odd\` | Strange level | sometimes |

## Company
Project: Empresa

| Job | Tool | Why |
|---|---|---|
| Pricing | \`pricing\` | Three tiers |
| Build a mod | \`modkit\` | Elsewhere |

| Tool | Rule | Project |
|---|---|---|
| \`taste-skill\` | Second opinion before showing a design | |
| \`brandkit\` | Check the cost first | Games |
`;

const rules = parseRules(MAP, 'm.md');
const jobs = parseMap(MAP, 'm.md');

test('rule tables give rules with their level, Spanish or English', () => {
  assert.deepEqual(rules[0].tools, ['adobe-*', 'MCP adobe']);
  assert.equal(rules[0].level, 'critical');
  assert.equal(rules[0].rule, 'Uploads files to the cloud: never client documents');
  assert.equal(rules[1].level, 'on use');
  assert.equal(rules[0].section, 'Media');
  assert.equal(rules[0].file, 'm.md');
});

test('an empty or * tool cell is a general rule', () => {
  assert.deepEqual(rules[2].tools, []);
  assert.equal(rules[2].level, 'critical');
});

test('an unknown level keeps the row as on use, with a warning', () => {
  assert.equal(rules[3].level, 'on use');
  assert.equal(rules[3].warning, 'unknown level "sometimes"');
});

test('rule tables give no job rows', () => {
  assert.deepEqual(jobs.map((j) => j.title), ['Edit photos', 'Pricing', 'Build a mod']);
});

test('a "Project:" line under a heading sets the project of its rows; a Project cell wins', () => {
  assert.equal(jobs[0].project, null);
  assert.equal(jobs[1].project, 'Empresa');
  assert.equal(rules[0].project, null);
  assert.equal(rules[4].project, 'Empresa');
  assert.equal(rules[5].project, 'Games');
});

function home(config) {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'stockroom-rcfg-'));
  fs.mkdirSync(path.join(h, '.claude', 'stockroom'), { recursive: true });
  fs.writeFileSync(path.join(h, '.claude', 'stockroom', 'config.json'), JSON.stringify(config));
  return h;
}

test('config: projects is an object of glob lists', () => {
  assert.deepEqual(loadConfig(home({ projects: { Empresa: ['Empresa/**'] } })).projects, { Empresa: ['Empresa/**'] });
  assert.throws(() => loadConfig(home({ projects: ['Empresa'] })), /projects/);
  assert.throws(() => loadConfig(home({ projects: { Empresa: 'Empresa/**' } })), /projects/);
});

test('a "Project:" line may follow a blank line under its heading', () => {
  const map = '## Games\n\nProject: Games\n\n| Job | Tool | Why |\n|---|---|---|\n| Build a mod | `modkit` | x |\n';
  assert.equal(parseMap(map, 'm.md')[0].project, 'Games');
});
