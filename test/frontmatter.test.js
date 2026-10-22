import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter } from '../lib/frontmatter.js';

test('folded block joins lines with spaces', () => {
  const { data } = parseFrontmatter('---\ndescription: >\n  line one\n  line two\nname: x\n---\nbody');
  assert.equal(data.description, 'line one line two');
  assert.equal(data.name, 'x');
});

test('literal block keeps line breaks', () => {
  const { data } = parseFrontmatter('---\ndescription: |\n  line one\n  line two\n---\n');
  assert.equal(data.description, 'line one\nline two');
});

test('single and double quoted values', () => {
  const { data } = parseFrontmatter(`---\na: "say \\"hi\\": now"\nb: 'it''s'\n---\n`);
  assert.equal(data.a, 'say "hi": now');
  assert.equal(data.b, "it's");
});

test('BOM and CRLF are accepted', () => {
  const { data, body } = parseFrontmatter('﻿---\r\nname: x\r\ndescription: y\r\n---\r\nbody\r\n');
  assert.deepEqual(data, { name: 'x', description: 'y' });
  assert.equal(body.trim(), 'body');
});

test('plain value continued on indented lines is folded', () => {
  const { data } = parseFrontmatter('---\ndescription: Use when\n  something breaks\n---\n');
  assert.equal(data.description, 'Use when something breaks');
});

test('no frontmatter gives empty data', () => {
  assert.deepEqual(parseFrontmatter('# just a title').data, {});
});

test('true and false become booleans', () => {
  const { data } = parseFrontmatter('---\ndisable-model-invocation: true\nx: false\n---\n');
  assert.equal(data['disable-model-invocation'], true);
  assert.equal(data.x, false);
});

test('broken YAML gives empty data without throwing', () => {
  assert.deepEqual(parseFrontmatter('---\nname: x\nthis is not yaml\n---\n').data, {});
  assert.deepEqual(parseFrontmatter('---\nname: "unterminated\n---\n').data, {});
  assert.deepEqual(parseFrontmatter('---\nname: x\n').data, {});
});
