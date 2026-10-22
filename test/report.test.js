import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { report } from '../lib/report.js';

const MAP = `## Media

| Job | Tool | Why |
|---|---|---|
| Add captions to a video | \`media:add-captions\` | Timed to speech |
| Cut a video | \`cut-video\` | Fast |
| Upscale an image | \`escalar-medios\` | Local |
| Read a page with JavaScript | MCP \`playwright\` | Data, not DOM |
`;

const ts = (min) => new Date(Date.now() - (60 - min) * 60000).toISOString();
const use = (id, name, input, min) => JSON.stringify({ type: 'assistant', timestamp: ts(min), message: { content: [{ type: 'tool_use', id, name, input }] } });
const result = (id, text, min) => JSON.stringify({ type: 'user', timestamp: ts(min), message: { content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });

function home() {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'stockroom-rep-'));
  const map = path.join(h, 'map.md');
  fs.writeFileSync(map, MAP);
  const proj = path.join(h, '.claude', 'projects', 'p');
  fs.mkdirSync(proj, { recursive: true });
  // Session a: greps by-function, three rows come back, then uses one of them.
  fs.writeFileSync(path.join(proj, 'a.jsonl'), [
    use('t1', 'Grep', { pattern: 'video|image', path: path.join(h, '.claude', 'stockroom', 'catalog', 'by-function.md') }, 1),
    result('t1', '- Add captions to a video → `media:add-captions`\n- Cut a video → `cut-video`\n- Upscale an image → `escalar-medios`', 2),
    use('t2', 'Skill', { skill: 'media:add-captions' }, 3),
  ].join('\n'));
  // Session b: never reads the map; uses playwright anyway.
  fs.writeFileSync(path.join(proj, 'b.jsonl'), [use('t1', 'mcp__playwright__browser_navigate', { url: 'x' }, 1)].join('\n'));
  // Session c: reads the map with Bash, then reads a SKILL.md of a consulted row and calls an MCP tool of another.
  fs.writeFileSync(path.join(proj, 'c.jsonl'), [
    use('t1', 'Bash', { command: `grep -i page ${map}` }, 1),
    result('t1', '| Upscale an image | `escalar-medios` | Local |\n| Read a page with JavaScript | MCP `playwright` | Data, not DOM |', 2),
    use('t2', 'Read', { file_path: 'C:\\Users\\X\\.claude\\skills\\escalar-medios\\SKILL.md' }, 3),
    use('t3', 'mcp__playwright__browser_evaluate', {}, 4),
  ].join('\n'));
  const state = path.join(h, '.claude', 'stockroom');
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, 'injections.jsonl'), [
    JSON.stringify({ at: ts(3), session: 'a', tool: 'media:add-captions', rules: 1 }),
    JSON.stringify({ at: ts(4), session: 'a', tool: 'media:add-captions', rules: 1 }),
  ].join('\n'));
  fs.mkdirSync(path.join(h, '.claude', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(h, '.claude', 'rules', 'stockroom-critical.md'), 'x'.repeat(100));
  return { h, map };
}

test('consulted rows come from map reads; followed when one of their tools is used later', () => {
  const { h, map } = home();
  const r = report({ home: h, days: 7, mapFiles: [map] });
  const a = r.sessions.find((s) => s.id === 'a');
  assert.deepEqual(a.consulted.map((c) => [c.title, c.followed]),
    [['Add captions to a video', true], ['Cut a video', false], ['Upscale an image', false]]);
  const c = r.sessions.find((s) => s.id === 'c');
  assert.deepEqual(c.consulted.map((x) => [x.title, x.followed]), [['Upscale an image', true], ['Read a page with JavaScript', true]]);
  assert.deepEqual(r.sessions.find((s) => s.id === 'b').consulted, []);
  assert.deepEqual(r.totals, { consulted: 5, followed: 3, reads: 2, readsFollowed: 2 });
});

test('injections are counted per session and tool', () => {
  const { h, map } = home();
  const a = report({ home: h, days: 7, mapFiles: [map] }).sessions.find((s) => s.id === 'a');
  assert.deepEqual(a.injected, [{ tool: 'media:add-captions', count: 2 }]);
});

test('always loaded: the critical rules file plus the hook line', () => {
  const { h, map } = home();
  const r = report({ home: h, days: 7, mapFiles: [map] });
  assert.ok(r.alwaysLoadedBytes > 100 && r.alwaysLoadedBytes < 100 + 400, `${r.alwaysLoadedBytes}`);
});
