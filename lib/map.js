// Reads the user's map: markdown tables "case | tool(s) | why", where the order of the tools is the preference.
import fs from 'node:fs';
import path from 'node:path';
import { serverKey } from './mcp.js';

// A column is the tool column when its header starts with one of these words (Herramienta, Skills, Tool…).
const TOOL_HEADER = /^(herramienta|tool|skill)/i;
const PIPE = '\u0000';

const clean = (s) => s.replace(/\*\*|__/g, '').trim();

function cells(line) {
  const parts = line.replace(/\\\|/g, PIPE).trim().replace(/^\||\|$/g, '').split('|');
  return parts.map((c) => c.replaceAll(PIPE, '|').trim());
}

// Backtick names in order; a preceding "MCP", "skill", "plugin", "web", "app" or "CLI" word stays with the name as a
// kind hint. A bare http(s) URL is a web tool.
function tokens(cell) {
  return [...cell.matchAll(/(?:\b(MCP|skill|plugin|web|app|CLI)\s+)?`([^`]+)`/gi)].map(([, hint, name]) => {
    name = name.trim();
    if (!hint && /^https?:\/\//i.test(name)) hint = 'web';
    if (!hint) return name;
    return `${/^(mcp|cli)$/i.test(hint) ? hint.toUpperCase() : hint.toLowerCase()} ${name}`;
  });
}

const EXTERNAL = /^(web|app|CLI)\s+(.+)$/;
const externalName = (type, rest) => (type === 'cli' ? rest.split(/\s+/)[0] : rest.trim());

// Tools outside Claude Code (websites, apps, CLIs): they exist only because a map names them.
export function externalTools(cases) {
  const byKey = new Map();
  for (const c of cases) {
    for (const token of c.tools) {
      const m = token.match(EXTERNAL);
      if (!m) continue;
      const type = m[1].toLowerCase();
      const name = externalName(type, m[2]);
      const key = `${type} ${name}`;
      if (!byKey.has(key)) {
        byKey.set(key, { kind: 'external', type, name, origin: 'map', enabled: true, description: '', rows: [],
          ...(type === 'web' ? { url: /^https?:\/\//i.test(name) ? name : `https://${name}` } : {}) });
      }
      const t = byKey.get(key);
      if (!t.rows.some((r) => r.file === c.file && r.title === c.title)) {
        t.rows.push({ file: c.file, section: c.section, title: c.title });
      }
    }
  }
  return [...byKey.values()];
}

export function parseMap(text, file) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  const out = [];
  let section = '';
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    // The file's title (#) names the tables before its first ## heading.
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { if (h[1].length > 1 || !section) section = clean(h[2]); continue; }
    if (!line.trim().startsWith('|') || !/^\s*\|[\s|:-]*-[\s|:-]*$/.test(lines[i + 1] || '')) continue;

    const header = cells(line);
    const col = header.findIndex((c) => TOOL_HEADER.test(clean(c)));
    i++; // separator
    while (i + 1 < lines.length && lines[i + 1].trim().startsWith('|')) {
      const row = cells(lines[++i]);
      if (col < 0) continue;
      const last = row.length - 1;
      out.push({
        file, section, title: clean(row[0] || ''), tools: tokens(row[col] || ''),
        why: last === col ? '' : clean(row[last] || ''),
      });
    }
  }
  return out;
}

const HINTS = { MCP: ['mcp-server'], skill: ['skill', 'command'], plugin: ['plugin'] };

export function matchName(token, tools) {
  let name = token.trim();
  let kinds = null;
  const ext = name.match(EXTERNAL);
  if (ext) {
    const type = ext[1].toLowerCase();
    const n = externalName(type, ext[2]);
    return tools.filter((t) => t.kind === 'external' && t.type === type && t.name === n);
  }
  const m = name.match(/^(MCP|skill|plugin)\s+(.+)$/);
  if (m) { kinds = HINTS[m[1]]; name = m[2].trim(); }
  if (name.startsWith('/')) { kinds = kinds || HINTS.skill; name = name.slice(1); }
  const pool = kinds ? tools.filter((t) => kinds.includes(t.kind)) : tools;

  const find = (n) => {
    if (n.includes('*')) {
      const re = new RegExp(`^(?:[^:]+:)?${n.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
      return pool.filter((t) => re.test(t.name));
    }
    const exact = pool.filter((t) => t.name === n);
    // Any namespace: plugin skills (<plugin>:x) and account skills (anthropic-skills:x).
    return exact.length ? exact : pool.filter((t) => t.name.endsWith(`:${n}`) && !t.name.slice(0, -n.length - 1).includes(':'));
  };
  let hits = find(name);
  // "MCP superpowers-chrome": the MCP servers of the plugin of that name.
  if (!hits.length && kinds === HINTS.MCP) hits = pool.filter((t) => t.plugin === name);
  // "/impeccable audit", "/watch <url>": the tool is the first word.
  return hits.length || !/\s/.test(name) ? hits : find(name.split(/\s+/)[0]);
}

// Claude Code's own tools, commands and bundled skills: never installed files, so never in the catalog.
const BUILTIN = new Set([
  'Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash', 'PowerShell', 'WebFetch', 'WebSearch', 'Agent', 'Task', 'Skill',
  'TodoWrite', 'NotebookEdit', 'LSP', 'Monitor', 'AskUserQuestion', 'claude',
  'clear', 'compact', 'resume', 'continue', 'mcp', 'model', 'context', 'goal', 'loop', 'reload-plugins',
  'reload-skills', 'doctor', 'config', 'plugin', 'help', 'init', 'memory', 'permissions', 'hooks', 'agents', 'cost',
  'status', 'login', 'logout', 'exit', 'rewind', 'export', 'statusline', 'skill-doctor',
  'code-review', 'simplify', 'security-review', 'run', 'schedule', 'claude-api', 'update-config',
  'fewer-permission-prompts', 'keybindings-help', 'dataviz', 'artifact-design', 'artifact-diagramming',
  'artifact-capabilities', 'workflow-authoring', 'plugin-authoring',
]);
const unhinted = (token) => token.replace(/^(MCP|skill|plugin)\s+/, '').replace(/^\//, '');
const isBuiltin = (token) => BUILTIN.has(unhinted(token).split(/\s+/)[0]);
// Paths, files, settings, option flags ("-ts") and environment variables ("JAVA_HOME"): not tool names.
export const isIgnored = (token) => /[\\=~%"[\]{}]/.test(token) || /.\//.test(token) || /^-/.test(token)
  || /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(token)
  || /\.(md|json|ya?ml|txt|js|mjs|py|toml|ini|log)$/i.test(token);
const bare = (name) => name.split(':').pop();
const wordRe = (s) => new RegExp(`(^|[^\\w-])${s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[\\w-]*')}($|[^\\w-])`);

// The installed tool whose name shares the most leading "-" segments with a name that matches nothing. One shared
// segment counts only for a plugin named after it (shopify-admin -> shopify-plugin:shopify, not hookify:list).
function closest(token, tools) {
  const segs = bare(unhinted(token)).split('-');
  const kinds = HINTS[token.match(/^(MCP|skill|plugin)\s/)?.[1]];
  let best; let score = 0;
  for (const t of tools) {
    if (t.kind === 'external' || (kinds && !kinds.includes(t.kind))) continue;
    const b = bare(t.name).split('-');
    let n = 0;
    while (n < segs.length && segs[n] === b[n]) n++;
    if (n === 1 && (t.plugin || '').split('-')[0] !== segs[0]) n = 0;
    if (n > score || (n === score && n && bare(t.name).length < bare(best.name).length)) { best = t; score = n; }
  }
  return score ? best : undefined;
}

// Resolves every token of one map row. Beyond a tool name, a token can be a part of a tool named in the same row (a
// tool of an MCP server, from the MCP cache; a word of a skill's SKILL.md, such as a sub-command), a Claude Code
// built-in, or a path or setting (ignored). What is left is unknown, with the closest installed name when there is one.
export function resolveRow(c, all, { mcp = new Map(), readText = readCached } = {}) {
  const rows = c.tools.map((token) => ({ token, hits: matchName(token, all) }));
  const hit = rows.flatMap((r) => r.hits);
  // A plugin named in the row brings its MCP servers ("`context7` → `query-docs`").
  const plugins = new Set(hit.filter((t) => t.kind === 'plugin').map((t) => t.name));
  const named = [...hit, ...all.filter((t) => t.kind === 'mcp-server' && plugins.has(t.plugin))];
  for (const r of rows) {
    if (r.hits.length) continue;
    const t = r.token;
    if (isBuiltin(t)) { r.builtin = true; continue; }
    if (isIgnored(t)) { r.ignored = true; continue; }
    const re = /^[\w*-]+$/.test(t) ? new RegExp(`^${t.replace(/\*/g, '.*')}$`) : null;
    r.of = re && named.find((s) => s.kind === 'mcp-server' && (mcp.get(serverKey(s))?.tools || []).some((x) => re.test(x.name)));
    if (!r.of && re) r.of = named.find((s) => s.kind === 'skill' && s.path && wordRe(t).test(readText(s.path)));
    if (!r.of) r.closest = closest(t, all);
  }
  return rows;
}

const texts = new Map();
function readCached(file) {
  if (!texts.has(file)) { try { texts.set(file, fs.readFileSync(file, 'utf8')); } catch { texts.set(file, ''); } }
  return texts.get(file);
}

export function checkMap(cases, tools, opts = {}) {
  const out = { unknown: [], parts: [], builtin: [], ignored: [] };
  const named = new Set();
  const all = [...tools, ...externalTools(cases)];
  for (const c of cases) {
    for (const r of resolveRow(c, all, opts)) {
      const at = { file: c.file, title: c.title, token: r.token };
      r.hits.forEach((t) => named.add(t));
      if (r.of) { out.parts.push({ ...at, of: r.of }); named.add(r.of); }
      else if (r.builtin) out.builtin.push(at);
      else if (r.ignored) out.ignored.push(at);
      else if (!r.hits.length) out.unknown.push({ ...at, closest: r.closest });
    }
  }
  return { ...out, unmapped: tools.filter((t) => !named.has(t)) };
}

// A short index of the map for an always-loaded rule file: one line per section, the first tool of each case. The
// full map stays in the catalog (by-function.md). Over `max` bytes: tools only, then fewer tools per section.
export function mapIndex(cases, { catalogDir, max = 4096 }) {
  const sections = new Map();
  for (const c of cases) {
    const tool = c.tools.find((t) => !isIgnored(t));
    if (!tool) continue;
    const key = c.section || '(no section)';
    sections.set(key, [...(sections.get(key) || []), { title: c.title, tool }]);
  }
  const head = ['# Tool map (index)', '',
    `First choice for each job. Every alternative, in order, is in ${path.join(catalogDir, 'by-function.md')}.`, ''];
  const render = (line) => [...head, ...[...sections].map(([s, rows]) => `- ${s}: ${line(rows)}`), ''].join('\n');
  let text = render((rows) => rows.map((r) => `${r.title} → \`${r.tool}\``).join('; '));
  if (Buffer.byteLength(text) <= max) return text;
  const tools = (rows) => [...new Set(rows.map((r) => r.tool))];
  for (let k = Math.max(...[...sections.values()].map((r) => tools(r).length)); k >= 0; k--) {
    text = render((rows) => {
      const t = tools(rows);
      return [t.slice(0, k).map((x) => `\`${x}\``).join(', '), t.length > k ? `(+${t.length - k})` : ''].filter(Boolean).join(' ');
    });
    if (Buffer.byteLength(text) <= max) return text;
  }
  return text;
}
