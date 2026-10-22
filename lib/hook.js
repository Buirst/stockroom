// SessionStart hook: keep the catalog up to date and tell Claude, in one line, that it exists.
// Never fails the session: errors go to ~/.claude/stockroom/hook.log.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, claudeDir } from './files.js';
import { loadConfig } from './config.js';
import { discoverTools } from './tools.js';
import { parseMap } from './map.js';
import { writeCatalog } from './catalog.js';
import { toolOrigin, pruneSources } from './sources.js';
import { serverKey } from './mcp.js';
import { fingerprint } from './fingerprint.js';

export const HOOK_LINE = (dir, hasMap = false) => (hasMap
  ? `Stockroom: before planning or building, grep the user's tool map ${path.join(dir, 'by-function.md')} (job → tool) `
    + 'and read the SKILL.md of the tool it names, before building from scratch. Every tool, even off, is in that folder. '
    + 'Not for plain questions.'
  : `Stockroom: every installed tool, even off ones, is described in ${dir}. Before planning or building, grep `
    + 'skills.md there; read the SKILL.md of a tool that covers it, before building from scratch. Not for plain questions.');

const expandHome = (p, home) => (p.startsWith('~') ? path.join(home, p.slice(1)) : p);

// Patterns may use * in the file name only: "~/rules/tools-*.md".
export function expandMaps(patterns, home) {
  return patterns.flatMap((raw) => {
    const p = expandHome(raw, home);
    const name = path.basename(p);
    if (!name.includes('*')) return fs.existsSync(p) ? [p] : [];
    const re = new RegExp(`^${name.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    try { return fs.readdirSync(path.dirname(p)).filter((f) => re.test(f)).sort().map((f) => path.join(path.dirname(p), f)); }
    catch { return []; }
  });
}

// Rewrites the catalog from what is installed now and records the fingerprint it matches.
// MCP tools come only from the cache: this never starts servers.
export function regenerate({ home, workRoot, catalogDir, mapFiles, onPath, print = fingerprint({ home, workRoot, mapFiles }) }) {
  const state = path.join(claudeDir(home), 'stockroom');
  const tools = discoverTools({ home, workRoot }).map((t) => ({ ...t, source: toolOrigin(t, { home }) }));
  const cases = mapFiles.flatMap((f) => parseMap(fs.readFileSync(f, 'utf8'), f));
  const cache = readJson(path.join(state, 'mcp-cache.json'), {});
  const mcp = new Map(tools.filter((t) => t.kind === 'mcp-server' && cache[serverKey(t)])
    .map((t) => [serverKey(t), cache[serverKey(t)]]));
  writeCatalog({ tools, cases, mcp, outDir: catalogDir, onPath });
  // Cached official sources of versions no longer installed. A group's source is cached without its folder.
  try { pruneSources(home, tools.flatMap((t) => (t.source ? [t.source, { ...t.source, path: undefined }] : []))); } catch { /* next time */ }
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, 'state.json'), JSON.stringify({ fingerprint: print, catalogDir, at: new Date().toISOString() }));
  return { tools, cases };
}

// Returns the hook's stdout text ('' when there is nothing to say).
export function runHook({ home, input = {} }) {
  const state = path.join(claudeDir(home), 'stockroom');
  let config;
  let configError;
  try { config = loadConfig(home); } catch (e) { configError = e; }
  const catalogDir = config?.catalogDir || path.join(state, 'catalog');
  const say = () => (fs.existsSync(path.join(catalogDir, 'README.md'))
    ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: HOOK_LINE(catalogDir, fs.existsSync(path.join(catalogDir, 'by-function.md'))) } })
    : '');
  try {
    if (configError) throw configError;
    const workRoot = input.cwd || process.cwd();
    const mapFiles = expandMaps(config.mapFiles, home);
    const print = fingerprint({ home, workRoot, mapFiles });
    const last = readJson(path.join(state, 'state.json'), {});
    if (last.fingerprint !== print || last.catalogDir !== catalogDir || !fs.existsSync(catalogDir)) {
      regenerate({ home, workRoot, catalogDir, mapFiles, print });
    }
  } catch (e) {
    try {
      fs.mkdirSync(state, { recursive: true });
      fs.appendFileSync(path.join(state, 'hook.log'), `${new Date().toISOString()} ${e.stack || e.message}\n`);
    } catch { /* nowhere to log */ }
  }
  return say();
}
