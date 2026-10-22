// Minimal stdio MCP server for tests. Flags: --hang (never answers), --crash (exits at once).
// MARKER env: file written on start, so tests can tell whether it was spawned.
// Without --serve it exits: `node --test` runs every .js under test/, this file included.
import fs from 'node:fs';
import readline from 'node:readline';

if (!process.argv.includes('--serve')) process.exit(0);

if (process.env.MARKER) fs.appendFileSync(process.env.MARKER, 'started\n');
if (process.argv.includes('--crash')) { process.stderr.write('boom\n'); process.exit(3); }

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
const pages = [
  [{ name: 'search', description: 'Search the docs.\nSecond line, ünïcode ✓' }],
  [{ name: 'read', description: 'Read one page' }, { name: 'bare' }],
];

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (process.argv.includes('--hang')) return;
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    send({ id: msg.id, result: {
      protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} },
      serverInfo: { name: 'fake', version: '1.0.0' }, instructions: 'Use me for docs.\nReally.',
    } });
  } else if (msg.method === 'tools/list') {
    const page = msg.params?.cursor ? 1 : 0;
    send({ id: msg.id, result: { tools: pages[page], ...(page === 0 ? { nextCursor: 'p2' } : {}) } });
  }
});
