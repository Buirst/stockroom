import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listingChars, readUsage } from '../lib/measure.js';

const sk = (name, description, source = 'personal', invocable = true) => ({ name, description, source, path: '', invocable });

test('listingChars counts full, name-only and hidden skills', () => {
  const skills = [
    sk('alpha', 'abcdefghij'),
    sk('beta', 'long description', 'project'),
    sk('gamma', 'x', 'plugin', false),
  ];
  const r = listingChars(skills, { beta: 'name-only' });
  assert.equal(r.total, 'alpha'.length + 10 + 'beta'.length);
  assert.deepEqual(r.bySource, { personal: 15, project: 4, plugin: 0 });
});

test('listingChars caps each description at maxDesc', () => {
  const r = listingChars([sk('a', 'x'.repeat(2000))], {});
  assert.equal(r.total, 1 + 1536);
  assert.equal(listingChars([sk('a', 'x'.repeat(2000))], {}, 100).total, 101);
});

test('readUsage reads skillUsage from ~/.claude.json', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'compass-usage-'));
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({
    skillUsage: { animate: { usageCount: 4, lastUsedAt: 1700000000000 } },
  }));
  const u = readUsage(home);
  assert.deepEqual(u.get('animate'), { usageCount: 4, lastUsedAt: 1700000000000 });
  assert.equal(u.size, 1);
});

test('readUsage without the file gives an empty map', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'compass-usage-'));
  assert.equal(readUsage(home).size, 0);
});
