// Measures the skill listing and reads how often each skill was used.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, claudeDir, claudeJsonPath } from './files.js';
import { discoverTools } from './tools.js';
import { skillReads } from './pretool.js';

// Folders whose .claude/skills a session started in projectDir lists: from it up to the git root (or only itself).
function projectSkillDirs(projectDir, home) {
  const dirs = [];
  const start = path.resolve(projectDir);
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (dir !== path.resolve(home)) dirs.push(dir);
    if (fs.existsSync(path.join(dir, '.git'))) return dirs;
    if (path.dirname(dir) === dir) return [start];
  }
}

// The skills Claude Code lists to Claude in a session started in projectDir: skills and plugin commands that are on.
export function listedSkills({ home, projectDir }) {
  const dirs = projectDir ? projectSkillDirs(projectDir, home) : [];
  const skillsOf = new Set(dirs.map((d) => path.join(d, '.claude', 'skills')));
  const tools = discoverTools({ home, workRoot: dirs.at(-1), depth: dirs.length - 1 });
  const seen = new Set();
  return tools
    .filter((t) => t.enabled && (t.kind === 'skill' || (t.kind === 'command' && t.origin === 'plugin'))
      && (t.origin !== 'project' || (t.skillDir && skillsOf.has(path.dirname(t.skillDir)))))
    .filter((t) => !seen.has(t.name) && seen.add(t.name))
    .map((t) => ({
      name: t.name, description: t.description, path: t.path,
      source: t.origin === 'account' || t.origin === 'plugin' ? 'plugin' : t.origin,
      invocable: t.modelInvocable !== false && t.listing !== 'user-invocable-only',
    }));
}

export function readUsage(home) {
  const usage = readJson(claudeJsonPath(home), {}).skillUsage || {};
  return new Map(Object.entries(usage).map(([name, u]) => [name, { usageCount: u.usageCount, lastUsedAt: u.lastUsedAt }]));
}

// Characters each skill adds to the listing: name + description, name only, or nothing.
export function listingChars(skills, overrides, maxDesc = 1536) {
  const bySource = {};
  let total = 0;
  for (const s of skills) {
    let n = 0;
    if (s.invocable) n = overrides[s.name] === 'name-only' ? s.name.length : s.name.length + Math.min(s.description.length, maxDesc);
    bySource[s.source] = (bySource[s.source] || 0) + n;
    total += n;
  }
  return { total, bySource };
}

// Key for "this SKILL.md was read": how a turned-off skill is used from the catalog.
export const readKey = (file) => `read:${String(file).replace(/\\/g, '/').toLowerCase()}`;

// Last use of every tool, by name: skills (and slash commands), subagents, and MCP servers as mcp__<server>.
// From ~/.claude.json skillUsage and the transcripts; subagent lines (isSidechain) are not the user's work, nor are
// `claude -p` runs (entrypoint "sdk-cli": scripts and benchmarks). counts, when given, gets uses per name from the transcripts.
export function toolUsage({ home, projectsDir = path.join(claudeDir(home), 'projects'), days = 30, now = Date.now(), counts }) {
  const since = now - days * 86400000;
  const last = new Map();
  const seen = (name, at) => {
    if (!name || !(at >= since)) return;
    if (at > (last.get(name) || 0)) last.set(name, at);
    if (counts && fromTranscript) counts.set(name, (counts.get(name) || 0) + 1);
  };
  let fromTranscript = false;
  for (const [name, u] of readUsage(home)) seen(name, u.lastUsedAt);
  fromTranscript = true;

  let folders = [];
  try { folders = fs.readdirSync(projectsDir); } catch { /* no transcripts */ }
  for (const folder of folders) {
    let files = [];
    try { files = fs.readdirSync(path.join(projectsDir, folder)).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const file = path.join(projectsDir, folder, f);
      let body;
      try {
        if (fs.statSync(file).mtimeMs < since) continue;
        body = fs.readFileSync(file, 'utf8');
      } catch { continue; } // deleted while reading (a session cleaned up)
      for (const text of body.split('\n')) {
        if (!text.includes('tool_use') && !text.includes('<command-name>')) continue;
        let line;
        try { line = JSON.parse(text); } catch { continue; }
        const at = Date.parse(line.timestamp);
        if (line.isSidechain || line.entrypoint === 'sdk-cli' || !(at >= since)) continue;
        const c = line.message?.content;
        if (typeof c === 'string') seen(c.match(/<command-name>\/?([^<\s]+)<\/command-name>/)?.[1], at);
        if (!Array.isArray(c)) continue;
        for (const b of c) {
          if (b.type === 'text') seen(b.text?.match(/<command-name>\/?([^<\s]+)<\/command-name>/)?.[1], at);
          if (b.type !== 'tool_use') continue;
          if (b.name === 'Skill') seen(b.input?.skill, at);
          else if (b.name === 'Agent' || b.name === 'Task') seen(b.input?.subagent_type, at);
          else if (b.name?.startsWith('mcp__')) seen(b.name.split('__').slice(0, 2).join('__'), at);
          else for (const f of skillReads({ tool_name: b.name, tool_input: b.input }, home)) seen(readKey(f), at);
        }
      }
    }
  }
  return last;
}
