import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, checkNode } from '../lib/config.js';

function home(config) {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'stockroom-cfg-'));
  if (config !== undefined) {
    fs.mkdirSync(path.join(h, '.claude', 'stockroom'), { recursive: true });
    fs.writeFileSync(path.join(h, '.claude', 'stockroom', 'config.json'),
      typeof config === 'string' ? config : JSON.stringify(config));
  }
  return h;
}

test('defaults when there is no config file', () => {
  const h = home();
  assert.deepEqual(loadConfig(h), {
    shelf: null, days: 30, list: [], neverOff: [], mapFiles: [], readMcp: false,
    keep: 1, unmapped: 'keep', alwaysOff: [], sections: {}, offAs: 'off',
    catalogDir: path.join(h, '.claude', 'stockroom', 'catalog'),
  });
});

test('user values override defaults; ~ expands in paths', () => {
  const h = home({ shelf: 'usage', days: 14, neverOff: ['beatlab-*'], catalogDir: '~/cat', mapFiles: ['~/m/*.md'] });
  const c = loadConfig(h);
  assert.equal(c.shelf, 'usage');
  assert.equal(c.days, 14);
  assert.deepEqual(c.neverOff, ['beatlab-*']);
  assert.equal(c.catalogDir, path.join(h, 'cat'));
  assert.deepEqual(c.mapFiles, [path.join(h, 'm', '*.md')]);
});

test('an invalid shelf value names the key and the allowed values', () => {
  assert.throws(() => loadConfig(home({ shelf: 'ninguna' })), /shelf.*null.*none.*usage.*list/);
});

test('other invalid values name their key', () => {
  assert.throws(() => loadConfig(home({ days: -3 })), /days/);
  assert.throws(() => loadConfig(home({ neverOff: 'beatlab-*' })), /neverOff/);
  assert.throws(() => loadConfig(home({ readMcp: 'yes' })), /readMcp/);
});

test('broken JSON gives a clear error', () => {
  assert.throws(() => loadConfig(home('{ nope')), /config\.json is not valid JSON/);
});

test('checkNode rejects versions older than 18', () => {
  assert.match(checkNode('16.20.0'), /Node\.js 18 or newer/);
  assert.equal(checkNode('18.0.0'), null);
  assert.equal(checkNode('24.20.0'), null);
});

test('map rules: valid keys load; invalid ones name the key', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stockroom-cfg-'));
  const write = (c) => { fs.mkdirSync(path.join(home, '.claude', 'stockroom'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'stockroom', 'config.json'), JSON.stringify(c)); };
  write({ shelf: 'map', keep: 2, unmapped: 'usage', alwaysOff: ['x'], sections: { 'Diseño': { keep: 1, days: 60, order: ['a'] } } });
  const c = loadConfig(home);
  assert.equal(c.keep, 2);
  assert.deepEqual(c.sections['Diseño'].order, ['a']);
  for (const [bad, key] of [[{ keep: 0 }, 'keep'], [{ unmapped: 'maybe' }, 'unmapped'], [{ alwaysOff: 'x' }, 'alwaysOff'],
    [{ sections: { A: { keep: 'two' } } }, 'sections'], [{ sections: { A: { color: 1 } } }, 'sections']]) {
    write(bad);
    assert.throws(() => loadConfig(home), new RegExp(`"${key}`));
  }
  write({});
  assert.deepEqual([loadConfig(home).keep, loadConfig(home).unmapped, loadConfig(home).alwaysOff, loadConfig(home).sections], [1, 'keep', [], {}]);
});
