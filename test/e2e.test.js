import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeE2E } from '../lib/e2e.js';

const line = (content) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content } });
const use = (name, input) => ({ type: 'tool_use', id: 't', name, input });
const catalogDir = 'C:\\Users\\me\\.claude\\stockroom\\catalog';
const run = (...lines) => [JSON.stringify({ type: 'system', subtype: 'init' }), ...lines, 'not json'].join('\n');

test('a skill launched with Skill counts as used', () => {
  const r = gradeE2E(run(line([use('Skill', { skill: 'impeccable:impeccable' })])), 'impeccable:impeccable', { catalogDir });
  assert.deepEqual(r, { pass: true, skillsLaunched: ['impeccable:impeccable'], skillFilesRead: [], catalogReads: 0 });
});

test('a turned-off skill whose SKILL.md was read counts as used', () => {
  const file = 'C:/Users/me/.claude/plugins/cache/mk/video/1.0.0/skills/cut/SKILL.md';
  const r = gradeE2E(run(
    line([use('Grep', { pattern: 'video', path: 'C:/Users/me/.claude/stockroom/catalog/skills.md' })]),
    line([use('Read', { file_path: file })]),
  ), 'video:cut', { catalogDir });
  assert.equal(r.pass, true);
  assert.deepEqual(r.skillFilesRead, [file]);
  assert.equal(r.catalogReads, 1);
});

test('a SKILL.md read through a shell command counts as used', () => {
  const cmd = 'sed -n 1,80p "C:\\Users\\me\\.claude\\plugins\\cache\\mk\\video\\1.0.0\\skills\\cut\\SKILL.md"';
  assert.equal(gradeE2E(run(line([use('Bash', { command: cmd })])), 'video:cut', { catalogDir }).pass, true);
  assert.equal(gradeE2E(run(line([use('Bash', { command: 'ls skills/cut' })])), 'video:cut', { catalogDir }).pass, false);
});

test('another skill does not pass', () => {
  assert.equal(gradeE2E(run(line([use('Skill', { skill: 'superpowers:brainstorming' })])), 'video:cut', { catalogDir }).pass, false);
});

test('a trap passes only with no launch, no SKILL.md read and no catalog read', () => {
  assert.equal(gradeE2E(run(line([{ type: 'text', text: 'ok' }])), null, { catalogDir }).pass, true);
  assert.equal(gradeE2E(run(line([use('Bash', { command: `grep thanks "${catalogDir}\\skills.md"` })])), null, { catalogDir }).pass, false);
  assert.equal(gradeE2E(run(line([use('Read', { file_path: '/x/skills/a/SKILL.md' })])), null, { catalogDir }).pass, false);
  assert.equal(gradeE2E(run(line([use('Skill', { skill: 'a' })])), null, { catalogDir }).pass, false);
});
