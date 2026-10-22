// A cheap hash of what is installed: sizes and dates of the files and folders that define tools.
// If it is unchanged, the catalog is still right and the hook does nothing else.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readJson, claudeDir, claudeJsonPath } from './files.js';

const FORMAT = 1; // bump when the catalog format changes, so every catalog is rewritten
const SKIP = new Set(['node_modules', '.git']);

const stamp = (p) => {
  try { const s = fs.statSync(p); return `${p}|${s.size}|${s.mtimeMs}`; } catch { return `${p}|-`; }
};
const dirs = (p) => {
  try { return fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; }
};

// shortcut: folder dates catch added or removed skills, not a SKILL.md edited by hand in place; updates by
// `npx skills` are caught by its lock file, plugin updates by installed_plugins.json. Stamp each SKILL.md if that matters.
export function fingerprint({ home, workRoot, mapFiles = [], depth = 4 }) {
  const claude = claudeDir(home);
  const parts = [`format ${FORMAT}`, `root ${workRoot || '-'}`];
  for (const f of ['settings.json', 'settings.local.json', 'plugins/installed_plugins.json', 'stockroom/mcp-cache.json',
    'skills', 'agents', 'commands']) parts.push(stamp(path.join(claude, f)));
  for (const acct of dirs(path.join(claude, 'skills', 'synced'))) parts.push(stamp(path.join(claude, 'skills', 'synced', acct)));
  for (const f of mapFiles) parts.push(stamp(f));
  parts.push(stamp(path.join(home, '.agents', '.skill-lock.json')));

  // ~/.claude.json changes all the time; only its MCP servers and claude.ai connectors matter.
  const cj = readJson(claudeJsonPath(home), {});
  parts.push(JSON.stringify([cj.mcpServers || {}, Object.values(cj.projects || {}).map((p) => p?.mcpServers || {}),
    cj.claudeAiMcpEverConnected || []]));

  const homeDir = path.resolve(home);
  const walk = (dir, left) => {
    if (dir !== homeDir) {
      parts.push(stamp(path.join(dir, '.mcp.json')));
      if (fs.existsSync(path.join(dir, '.claude'))) {
        for (const f of ['skills', 'agents', 'commands', 'settings.json', 'settings.local.json']) {
          parts.push(stamp(path.join(dir, '.claude', f)));
        }
      }
    }
    if (left > 0) for (const d of dirs(dir)) if (!SKIP.has(d) && !d.startsWith('.')) walk(path.join(dir, d), left - 1);
  };
  if (workRoot) walk(path.resolve(workRoot), depth);

  return crypto.createHash('sha1').update(parts.join('\n')).digest('hex');
}
