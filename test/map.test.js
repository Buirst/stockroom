import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseMap, matchName, checkMap, externalTools, mapIndex } from '../lib/map.js';
import { findOnPath } from '../lib/tools.js';
import { serverKey } from '../lib/mcp.js';

// A sample map in the format users write: tables whose tool column is named Tool, Skills or Herramienta.
const MAP = `# Tools

Text outside tables is ignored: \`ignored\`.

## 4. By domain

### Browser and data extraction (scraping)

| Job | Tool | Why |
|---|---|---|
| The site has a public API | \`curl\` + \`jq\` (GitHub, npm) | Clean data, no HTML |
| Whole article or docs page | \`defuddle\` (CLI, skill \`obsidian:defuddle\`) | Clean Markdown |
| Page with JavaScript or tables | MCP \`playwright\` → \`browser_evaluate\` returning JSON | Only the data, not the whole DOM |
| **Behind a login** of the user | MCP \`playwright-extension\`, fallback MCP \`playwright\` | Their browser with the session open |
| Video | \`yt-dlp\`; to understand it: \`/watch\` | Direct download |
| A filter | \`a \\| b\` | Escaped pipe |

| What you look for | First choice | If it fails |
|---|---|---|
| Not a map table | \`playwright\` | \`nothing\` |

\`\`\`
| Job | Tool | Why |
|---|---|---|
| Inside a code fence | \`fenced\` | no |
\`\`\`

## Music

| What for | Skills |
|---|---|
| Measure | \`beatlab-analytics\`, \`beatlab-anr\` |
`;

const tools = [
  { kind: 'mcp-server', name: 'playwright', origin: 'user-mcp' },
  { kind: 'skill', name: 'playwright-cli', origin: 'personal' },
  { kind: 'mcp-server', name: 'playwright-extension', origin: 'user-mcp' },
  { kind: 'skill', name: 'obsidian:defuddle', origin: 'plugin', plugin: 'obsidian' },
  { kind: 'skill', name: 'watch:watch', origin: 'plugin', plugin: 'watch' },
  { kind: 'skill', name: 'beatlab-analytics', origin: 'personal' },
  { kind: 'skill', name: 'beatlab-anr', origin: 'personal' },
  { kind: 'skill', name: 'debugging', origin: 'personal' },
  { kind: 'skill', name: 'debugging', origin: 'project' },
  { kind: 'skill', name: 'tools:debugging', origin: 'plugin', plugin: 'tools' },
  { kind: 'skill', name: 'never-named', origin: 'personal' },
];

const cases = parseMap(MAP, 'tools.md');
const byTitle = Object.fromEntries(cases.map((c) => [c.title, c]));

test('reads only tables with a tool column, outside code fences', () => {
  assert.deepEqual(cases.map((c) => c.title), [
    'The site has a public API', 'Whole article or docs page', 'Page with JavaScript or tables',
    'Behind a login of the user', 'Video', 'A filter', 'Measure',
  ]);
  assert.equal(cases[0].file, 'tools.md');
});

test('tools keep their order of appearance; MCP prefix travels with the name', () => {
  assert.deepEqual(byTitle['Behind a login of the user'].tools, ['MCP playwright-extension', 'MCP playwright']);
  assert.deepEqual(byTitle['Whole article or docs page'].tools, ['defuddle', 'skill obsidian:defuddle']);
  assert.deepEqual(byTitle['Measure'].tools, ['beatlab-analytics', 'beatlab-anr']);
});

test('section is the nearest heading, why is the last column, bold is stripped', () => {
  const c = byTitle['Behind a login of the user'];
  assert.equal(c.section, 'Browser and data extraction (scraping)');
  assert.equal(c.why, 'Their browser with the session open');
  assert.equal(byTitle['Measure'].section, 'Music');
});

test('escaped pipes stay inside the cell', () => {
  assert.deepEqual(byTitle['A filter'].tools, ['a | b']);
  assert.equal(byTitle['A filter'].why, 'Escaped pipe');
});

test('matchName: MCP prefix resolves to the server, not a same-prefixed skill', () => {
  assert.deepEqual(matchName('MCP playwright', tools).map((t) => t.kind + ' ' + t.name), ['mcp-server playwright']);
});

test('matchName: exact name first, then <plugin>:<token>, then / and skill prefixes', () => {
  assert.deepEqual(matchName('debugging', tools).map((t) => t.origin), ['personal', 'project']);
  assert.deepEqual(matchName('/watch', tools).map((t) => t.name), ['watch:watch']);
  assert.deepEqual(matchName('skill obsidian:defuddle', tools).map((t) => t.name), ['obsidian:defuddle']);
  assert.deepEqual(matchName('defuddle', tools).map((t) => t.name), ['obsidian:defuddle']);
  assert.deepEqual(matchName('/watch <url>', tools).map((t) => t.name), ['watch:watch']);
  assert.deepEqual(matchName('curl', tools), []);
});

test('matchName: "skill /x", any namespace:<token>, and * patterns', () => {
  const more = [...tools,
    { kind: 'skill', name: 'export-inventory', origin: 'project' },
    { kind: 'skill', name: 'anthropic-skills:pdf', origin: 'account' },
    { kind: 'skill', name: 'gsap-skills:gsap-core', origin: 'plugin', plugin: 'gsap-skills' }];
  assert.deepEqual(matchName('skill /export-inventory', more).map((t) => t.name), ['export-inventory']);
  assert.deepEqual(matchName('pdf', more).map((t) => t.name), ['anthropic-skills:pdf']);
  assert.deepEqual(matchName('beatlab-*', more).map((t) => t.name), ['beatlab-analytics', 'beatlab-anr']);
  assert.deepEqual(matchName('gsap-*', more).map((t) => t.name), ['gsap-skills:gsap-core']);
});

test('checkMap: unknown tokens and unmapped tools', () => {
  const { unknown, unmapped } = checkMap(cases, tools);
  assert.ok(unknown.some((u) => u.token === 'browser_evaluate' && u.title.startsWith('Page with')));
  assert.ok(unknown.some((u) => u.token === 'curl' && u.file === 'tools.md'));
  assert.ok(!unknown.some((u) => u.token === 'MCP playwright'));
  assert.deepEqual(unmapped.map((t) => t.name).sort(), ['debugging', 'debugging', 'never-named', 'playwright-cli', 'tools:debugging']);
});

const EXT = `## Media

<!-- Spanish headers work too. -->
| Caso | Herramienta | Por qué |
|---|---|---|
| Convert video | CLI \`ffmpeg\`, then app \`Upscayl\` | Local |
| Design ideas | web \`getlayers.ai\`, \`https://motionsites.ai/x\` | Prompts |
| Again | cli \`ffmpeg -i x\` and \`ffmpeg\` | Same program |
| No prefix | \`loose-program\` | Nobody declares it |
`;

test('external tools: web/app/CLI prefixes and bare URLs', () => {
  const ext = parseMap(EXT, 'm.md');
  assert.deepEqual(ext[0].tools, ['CLI ffmpeg', 'app Upscayl']);
  assert.deepEqual(ext[1].tools, ['web getlayers.ai', 'web https://motionsites.ai/x']);
  const list = externalTools(ext);
  assert.deepEqual(list.map((t) => `${t.type} ${t.name}`), ['cli ffmpeg', 'app Upscayl', 'web getlayers.ai', 'web https://motionsites.ai/x']);
  assert.equal(list[2].url, 'https://getlayers.ai');
  assert.equal(list[3].url, 'https://motionsites.ai/x');
  assert.deepEqual(list[0].rows.map((r) => r.title), ['Convert video', 'Again']);
  assert.ok(list.every((t) => t.kind === 'external' && t.enabled));
});

test('checkMap: declared externals are not unknown; an undeclared plain name still is', () => {
  const ext = parseMap(EXT, 'm.md');
  const { unknown, unmapped } = checkMap(ext, tools);
  assert.deepEqual(unknown.map((u) => u.token), ['loose-program']);
  assert.ok(!unmapped.some((t) => t.kind === 'external'));
  assert.deepEqual(matchName('app ffmpeg', [...tools, ...externalTools(ext)]), []);
});

test('findOnPath: looks in PATH folders, with PATHEXT on Windows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stockroom-path-'));
  fs.writeFileSync(path.join(dir, 'tool.EXE'), '');
  fs.writeFileSync(path.join(dir, 'plain'), '');
  const win = { env: { PATH: `C:\nowhere;${dir}`, PATHEXT: '.COM;.EXE' }, platform: 'win32' };
  assert.equal(findOnPath('tool', win), true);
  assert.equal(findOnPath('missing', win), false);
  assert.equal(findOnPath('plain', { env: { PATH: `/nowhere${path.delimiter}${dir}` }, platform: 'linux' }), true);
  assert.equal(findOnPath('tool -v', win), true, 'only the first word is the command');
});

// Task 10: parts of a tool, Claude Code built-ins, ignored tokens, stale names.
const skillDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stockroom-sub-'));
fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: impeccable\n---\nCommands: craft, polish and audit.\n');
const pw = tools.find((t) => t.name === 'playwright');
const t10 = [...tools,
  { kind: 'skill', name: 'impeccable:impeccable', origin: 'plugin', plugin: 'impeccable', path: path.join(skillDir, 'SKILL.md') },
  { kind: 'skill', name: 'shopify-plugin:shopify', origin: 'plugin', plugin: 'shopify-plugin' },
  { kind: 'skill', name: 'liquid-skills:shopify-liquid-themes', origin: 'plugin', plugin: 'liquid-skills' }];
const mcpCache = new Map([[serverKey(pw), { tools: [{ name: 'browser_evaluate' }, { name: 'browser_click' }] }]]);
const T10 = `## Parts

| Job | Tool | Why |
|---|---|---|
| Data | MCP \`playwright\` → \`browser_evaluate\`, \`browser_*\` | Part of the server |
| Design | \`/impeccable\`: \`craft\`, \`polish\`, \`unknownsub\` | Sub-commands |
| Session | \`/clear\`, \`/compact\`, \`WebFetch\`, \`Grep\`, \`/code-review\`, \`claude --continue\` | Built in |
| Files | \`MEMORY.md\`, \`.claude/rules/\`, \`PONYTAIL_MAP=0\`, \`~/.claude/settings.json\`, \`%APPDATA%\caveman\` | Not tools |
| Old | \`shopify-admin\`, \`shopify-liquid\`, \`curl\` | No longer exist |
| No server | \`browser_evaluate\` | Outside its row |
`;

test('checkMap: tools of a matched MCP server in the same row are parts of it', () => {
  const r = checkMap(parseMap(T10, 'm.md'), t10, { mcp: mcpCache });
  const parts = r.parts.map((p) => `${p.token}<${p.of.name}`);
  assert.ok(parts.includes('browser_evaluate<playwright'));
  assert.ok(parts.includes('browser_*<playwright'), 'patterns match server tools');
  assert.ok(r.unknown.some((u) => u.token === 'browser_evaluate' && u.title === 'No server'), 'only in its row');
});

test('checkMap: a word of a matched skill\'s SKILL.md in the same row is a sub-command', () => {
  const r = checkMap(parseMap(T10, 'm.md'), t10, { mcp: mcpCache });
  assert.deepEqual(r.parts.filter((p) => p.of.name === 'impeccable:impeccable').map((p) => p.token), ['craft', 'polish']);
  assert.ok(r.unknown.some((u) => u.token === 'unknownsub'));
});

test('checkMap: Claude Code built-ins and ignored tokens', () => {
  const r = checkMap(parseMap(T10, 'm.md'), t10, { mcp: mcpCache });
  assert.deepEqual(r.builtin.map((b) => b.token), ['/clear', '/compact', 'WebFetch', 'Grep', '/code-review', 'claude --continue']);
  assert.equal(r.ignored.length, 5);
  assert.ok(!r.unknown.some((u) => r.ignored.some((i) => i.token === u.token)));
});

test('checkMap: stale names get the closest installed name', () => {
  const r = checkMap(parseMap(T10, 'm.md'), t10, { mcp: mcpCache });
  const s = Object.fromEntries(r.unknown.map((u) => [u.token, u.closest?.name]));
  assert.equal(s['shopify-admin'], 'shopify-plugin:shopify');
  assert.equal(s['shopify-liquid'], 'liquid-skills:shopify-liquid-themes');
  assert.equal(s.curl, undefined);
});

test('checkMap: hints, flags and env vars; one shared segment only for the namesake plugin', () => {
  const more = [...t10, { kind: 'skill', name: 'hookify:list', origin: 'plugin', plugin: 'hookify' },
    { kind: 'mcp-server', name: 'codebase-memory-mcp', origin: 'user-mcp' }];
  const rows = [{ file: 'm', section: 'S', title: 'T', why: '',
    tools: ['skill dataviz', '-ts', 'JAVA_HOME', 'list-deployments', 'MCP codebase-memory'] }];
  const r = checkMap(rows, more);
  assert.deepEqual(r.builtin.map((b) => b.token), ['skill dataviz']);
  assert.deepEqual(r.ignored.map((b) => b.token), ['-ts', 'JAVA_HOME']);
  const s = Object.fromEntries(r.unknown.map((u) => [u.token, u.closest?.name]));
  assert.equal(s['list-deployments'], undefined);
  assert.equal(s['MCP codebase-memory'], 'codebase-memory-mcp');
});

test('matchName: "MCP <plugin>" finds that plugin\'s servers; closest keeps the hinted kind', () => {
  const more = [...t10, { kind: 'mcp-server', name: 'chrome', origin: 'plugin', plugin: 'superpowers-chrome' },
    { kind: 'skill', name: 'codebase-memory', origin: 'personal' },
    { kind: 'mcp-server', name: 'codebase-memory-mcp', origin: 'user-mcp' }];
  assert.deepEqual(matchName('MCP superpowers-chrome', more).map((t) => t.name), ['chrome']);
  const r = checkMap([{ file: 'm', section: 'S', title: 'T', why: '', tools: ['MCP codebase-memory'] }], more);
  assert.equal(r.unknown[0].closest.name, 'codebase-memory-mcp');
});

test('resolveRow: a plugin named in the row brings its MCP servers\' tools', () => {
  const ctx = { kind: 'mcp-server', name: 'context7', origin: 'plugin', plugin: 'context7', server: { url: 'https://c7.test' } };
  const more = [...t10, ctx, { kind: 'plugin', name: 'context7', origin: 'plugin', plugin: 'context7' }];
  const r = checkMap([{ file: 'm', section: 'S', title: 'T', why: '', tools: ['plugin context7', 'query-docs'] }], more,
    { mcp: new Map([[serverKey(ctx), { tools: [{ name: 'query-docs' }] }]]) });
  assert.deepEqual(r.parts.map((p) => `${p.token}<${p.of.name}`), ['query-docs<context7']);
});

test('mapIndex: one line per section with the first tool of each case, under the size cap', () => {
  const rows = [
    { file: 'm', section: 'Web', title: 'Animate', tools: ['animate', 'gsap-core'], why: '' },
    { file: 'm', section: 'Web', title: 'Test a page', tools: ['MCP playwright'], why: '' },
    { file: 'm', section: '3D', title: 'Model', tools: ['blender-x'], why: '' },
    { file: 'm', section: '3D', title: 'Empty', tools: [], why: '' },
  ];
  const text = mapIndex(rows, { catalogDir: '/cat' });
  assert.match(text, /^- Web: Animate → `animate`; Test a page → `MCP playwright`$/m);
  assert.match(text, /^- 3D: Model → `blender-x`$/m);
  assert.match(text, /[\\/]cat[\\/]by-function\.md/);
  const many = Array.from({ length: 300 }, (_, i) => ({ file: 'm', section: `S${i % 40}`, title: `A rather long case title number ${i}`, tools: [`tool-${i}`], why: '' }));
  const big = mapIndex(many, { catalogDir: '/cat', max: 4096 });
  assert.ok(Buffer.byteLength(big) <= 4096, `${Buffer.byteLength(big)} bytes`);
  for (let i = 0; i < 40; i++) assert.match(big, new RegExp(`^- S${i}:`, 'm'), `section S${i} present`);
});

test('mapIndex skips paths and settings when choosing the first tool of a case', () => {
  const text = mapIndex([{ file: 'm', section: 'Web', title: 'Rules', tools: ['tools.md', 'C:\\Program Files\\X', 'impeccable'], why: '' }],
    { catalogDir: '/cat' });
  assert.match(text, /- Web: Rules → `impeccable`/);
});
