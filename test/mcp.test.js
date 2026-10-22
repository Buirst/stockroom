import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMcpServer, readMcpAll, serverKey } from '../lib/mcp.js';

const fake = fileURLToPath(new URL('./fake-mcp-server.js', import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stockroom-mcp-'));
const tool = (name, args = [], env = {}) =>
  ({ kind: 'mcp-server', name, origin: 'user-mcp', server: { command: process.execPath, args: [fake, '--serve', ...args], env } });

test('instructions and tool descriptions come back literally, across pages', async () => {
  const r = await readMcpServer(tool('ok'), { timeoutMs: 5000 });
  assert.equal(r.instructions, 'Use me for docs.\nReally.');
  assert.deepEqual(r.tools, [
    { name: 'search', description: 'Search the docs.\nSecond line, ünïcode ✓' },
    { name: 'read', description: 'Read one page' },
    { name: 'bare', description: '' },
  ]);
});

test('a hanging server times out within the limit', async () => {
  const t0 = Date.now();
  const r = await readMcpServer(tool('hang', ['--hang']), { timeoutMs: 1000 });
  assert.match(r.error, /timed out/);
  assert.ok(Date.now() - t0 < 4000, `took ${Date.now() - t0} ms`);
});

test('a crashing server gives an error', async () => {
  const r = await readMcpServer(tool('crash', ['--crash']), { timeoutMs: 5000 });
  assert.ok(r.error);
});

test('a command that does not exist gives an error', async () => {
  const r = await readMcpServer({ name: 'nope', server: { command: 'stockroom-no-such-cmd-xyz' } }, { timeoutMs: 5000 });
  assert.ok(r.error);
});

test('remote servers are not read in v1', async () => {
  const r = await readMcpServer({ name: 'web', server: { type: 'http', url: 'https://x.test' } }, {});
  assert.deepEqual(r, { error: 'remote server: not read in v1' });
});

test('readMcpAll caches successes: second call does not spawn', async () => {
  const marker = path.join(tmp, 'marker.txt');
  const cachePath = path.join(tmp, 'cache.json');
  const servers = [tool('a', [], { MARKER: marker }), tool('b', ['--crash'], { MARKER: marker })];
  const first = await readMcpAll(servers, { cachePath, timeoutMs: 5000 });
  assert.equal(first.get(serverKey(servers[0])).tools.length, 3);
  assert.ok(first.get(serverKey(servers[1])).error);
  const starts = fs.readFileSync(marker, 'utf8').split('\n').filter(Boolean).length;
  assert.equal(starts, 2);

  const second = await readMcpAll(servers, { cachePath, timeoutMs: 5000 });
  assert.deepEqual(second.get(serverKey(servers[0])), first.get(serverKey(servers[0])));
  const after = fs.readFileSync(marker, 'utf8').split('\n').filter(Boolean).length;
  assert.equal(after, 3, 'only the failed server is retried');
});

test('serverKey depends on command, args and url only', () => {
  const a = { name: 'x', server: { command: 'node', args: ['a.js'], env: { A: '1' } } };
  const b = { name: 'y', server: { command: 'node', args: ['a.js'], env: { A: '2' } } };
  const c = { name: 'x', server: { command: 'node', args: ['b.js'] } };
  assert.equal(serverKey(a), serverKey(b));
  assert.notEqual(serverKey(a), serverKey(c));
});
