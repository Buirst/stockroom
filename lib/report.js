// Did the map help? From the session transcripts: which map rows Claude read (consulted) and whether it then used one
// of their tools (followed); plus the on-use rules the PreToolUse hook showed, and what is loaded in every session.
import fs from 'node:fs';
import path from 'node:path';
import { claudeDir } from './files.js';
import { parseMap } from './map.js';
import { HOOK_LINE } from './hook.js';

const MAP_READERS = new Set(['Grep', 'Read', 'Bash', 'PowerShell']);
const textOf = (content) => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.map((b) => b?.text || '').join('\n') : '');
const bare = (tok) => tok.replace(/^(MCP|skill|plugin)\s+/, '').replace(/^\//, '');
const last = (name) => name.split(':').pop();

// Does this tool call use the map token? Skills by name, a SKILL.md by its folder, MCP calls by server, subagents.
function uses(tok, name, input) {
  const t = bare(tok);
  if (name === 'Skill') return input?.skill === t || last(input?.skill || '') === last(t);
  if (name === 'Read' && /SKILL\.md$/i.test(input?.file_path || '')) {
    return path.basename(path.dirname(input.file_path.replace(/\\/g, '/'))) === last(t);
  }
  if (name === 'Agent' || name === 'Task') return input?.subagent_type === t;
  const mcp = name.match(/^mcp__(.+?)__/);
  return Boolean(mcp) && /^MCP\s/.test(tok) && mcp[1] === t;
}

function session(file, rows, mapNames) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const calls = new Map();
  const consulted = [];
  const reads = []; // one per map read: { tools of every row it returned, followed }
  for (const text of lines) {
    if (!text.includes('tool_use') && !text.includes('tool_result')) continue;
    let line;
    try { line = JSON.parse(text); } catch { continue; }
    if (line.isSidechain) continue;
    const content = line.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b.type === 'tool_use') {
        calls.set(b.id, b);
        for (const c of [...consulted, ...reads]) if (!c.followed && c.tools.some((tok) => uses(tok, b.name, b.input))) c.followed = true;
      } else if (b.type === 'tool_result') {
        const call = calls.get(b.tool_use_id);
        if (!call || !MAP_READERS.has(call.name)) continue;
        const input = JSON.stringify(call.input || {});
        if (!mapNames.some((n) => input.includes(n))) continue;
        const out = textOf(b.content);
        const found = rows.filter((r) => r.title && out.includes(r.title));
        if (found.length) reads.push({ tools: found.flatMap((r) => r.tools), followed: false });
        for (const r of found) {
          if (!consulted.some((c) => c.title === r.title)) consulted.push({ title: r.title, tools: r.tools, followed: false });
        }
      }
    }
  }
  return { consulted, reads };
}

export function report({ home, days = 7, mapFiles = [], catalogDir = path.join(claudeDir(home), 'stockroom', 'catalog'), now = Date.now() }) {
  const since = now - days * 86400000;
  const rows = mapFiles.flatMap((f) => parseMap(fs.readFileSync(f, 'utf8'), f));
  const mapNames = [...mapFiles.map((f) => path.basename(f)), 'by-function'];
  const projects = path.join(claudeDir(home), 'projects');
  const injections = new Map();
  try {
    for (const l of fs.readFileSync(path.join(claudeDir(home), 'stockroom', 'injections.jsonl'), 'utf8').split('\n')) {
      let x;
      try { x = JSON.parse(l); } catch { continue; }
      if (Date.parse(x.at) < since) continue;
      const per = injections.get(x.session) || new Map();
      per.set(x.tool, (per.get(x.tool) || 0) + 1);
      injections.set(x.session, per);
    }
  } catch { /* no injections yet */ }

  const sessions = [];
  let folders = [];
  try { folders = fs.readdirSync(projects); } catch { /* no transcripts */ }
  for (const folder of folders) {
    let files = [];
    try { files = fs.readdirSync(path.join(projects, folder)).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const file = path.join(projects, folder, f);
      try { if (fs.statSync(file).mtimeMs < since) continue; } catch { continue; }
      const id = f.slice(0, -'.jsonl'.length);
      const injected = [...(injections.get(id) || new Map())].map(([tool, count]) => ({ tool, count }));
      const { consulted, reads } = session(file, rows, mapNames);
      sessions.push({ id, consulted, reads: { total: reads.length, followed: reads.filter((r) => r.followed).length }, injected });
    }
  }
  const all = sessions.flatMap((s) => s.consulted);
  let critical = 0;
  try { critical = fs.statSync(path.join(claudeDir(home), 'rules', 'stockroom-critical.md')).size; } catch { /* none */ }
  return {
    sessions,
    totals: {
      consulted: all.length, followed: all.filter((c) => c.followed).length,
      reads: sessions.reduce((n, s) => n + s.reads.total, 0), readsFollowed: sessions.reduce((n, s) => n + s.reads.followed, 0),
    },
    alwaysLoadedBytes: critical + Buffer.byteLength(HOOK_LINE(catalogDir, rows.length > 0)),
  };
}
