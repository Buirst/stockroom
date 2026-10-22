import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listedSkills } from '../lib/measure.js';
import { makeHome } from './fixtures.js';

const { home, projectDir } = makeHome();
const skills = listedSkills({ home, projectDir });
const byName = Object.fromEntries(skills.map((s) => [s.name, s]));

test('finds personal skills', () => {
  assert.equal(byName.debugging.source, 'personal');
  assert.match(byName.debugging.description, /root cause/);
  assert.match(byName.debugging.path, /SKILL\.md$/);
});

test('finds synced skills as anthropic-skills:<name>, with when_to_use appended', () => {
  const pdf = byName['anthropic-skills:pdf'];
  assert.ok(pdf);
  assert.equal(pdf.source, 'plugin');
  assert.equal(pdf.description, 'Read, merge and fill PDF files\nwhen the user mentions a .pdf file');
});

test('finds project skills up to the git root, not above it', () => {
  assert.equal(byName.lint.source, 'project');
  assert.equal(byName.migrate.source, 'project');
  assert.equal(byName.outside, undefined);
});

test('finds skills of enabled plugins, including extra skill folders', () => {
  assert.equal(byName['tools:design-critique'].source, 'plugin');
  assert.ok(byName['tools:deploy']);
});

test('skips skills of disabled plugins', () => {
  assert.equal(byName['off:video'], undefined);
});

test('a skill without description gets an empty one', () => {
  assert.equal(byName.nodesc.description, '');
});

test('invocable follows disable-model-invocation and skillOverrides', () => {
  assert.equal(byName.debugging.invocable, true);
  assert.equal(byName.quiet.invocable, true);
  assert.equal(byName.manual.invocable, false);
  assert.equal(byName.hidden, undefined, 'off: not listed at all');
  assert.equal(byName.uonly.invocable, false);
});

test('works without any plugins or settings', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'compass-empty-'));
  assert.deepEqual(listedSkills({ home: empty }), []);
});

test('finds plugin commands as skills, named <plugin>:<file>', () => {
  assert.equal(byName['tools:watch'].description, 'Watch a video and answer questions about it');
  assert.equal(byName['tools:watch'].source, 'plugin');
  assert.equal(byName['tools:secret'].invocable, false);
});
