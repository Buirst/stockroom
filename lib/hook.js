// SessionStart hook: keep the catalog up to date and tell Claude, in one line, that it exists.
// Never fails the session: errors go to ~/.claude/stockroom/errors.log and are mentioned in the line.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJson, claudeDir } from './files.js';
import { loadConfig } from './config.js';
import { discoverTools } from './tools.js';
import { parseMap, parseRules } from './map.js';
import { buildRules, writeRules } from './rules.js';
import { writeCatalog } from './catalog.js';
import { toolOrigin, pruneSources } from './sources.js';
import { serverKey } from './mcp.js';
import { fingerprint } from './fingerprint.js';

export const HOOK_LINE = (dir, hasMap = false) => (hasMap
  ? `Stockroom: before planning or building, grep the tool map ${path.join(dir, 'by-function.md')} (job → tool) and `
    + 'read the SKILL.md of the tool it names, before building from scratch; "off: read <path>" tools work now through '
    + 'that file. Not for plain questions.'
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
export function regenerate({ home, workRoot, catalogDir, mapFiles, onPath, config = { projects: {} }, print = fingerprint({ home, workRoot, mapFiles }) }) {
  const state = path.join(claudeDir(home), 'stockroom');
  const tools = discoverTools({ home, workRoot }).map((t) => ({ ...t, source: toolOrigin(t, { home }) }));
  const texts = mapFiles.map((f) => fs.readFileSync(f, 'utf8'));
  const cases = mapFiles.flatMap((f, i) => parseMap(texts[i], f));
  const built = buildRules({ rules: mapFiles.flatMap((f, i) => parseRules(texts[i], f)), cases, tools, config: { ...config, catalogDir } }, mapFiles);
  const cache = readJson(path.join(state, 'mcp-cache.json'), {});
  const mcp = new Map(tools.filter((t) => t.kind === 'mcp-server' && cache[serverKey(t)])
    .map((t) => [serverKey(t), cache[serverKey(t)]]));
  writeCatalog({ tools, cases, mcp, outDir: catalogDir, onPath, rulesByTool: built.byTool });
  // Cached official sources of versions no longer installed. A group's source is cached without its folder.
  try { pruneSources(home, tools.flatMap((t) => (t.source ? [t.source, { ...t.source, path: undefined }] : []))); } catch { /* next time */ }
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, 'state.json'), JSON.stringify({ fingerprint: print, catalogDir, at: new Date().toISOString() }));
  return { tools, cases, built };
}

// Returns the hook's stdout text ('' when there is nothing to say).
export function runHook({ home, input = {} }) {
  const state = path.join(claudeDir(home), 'stockroom');
  let config;
  let configError;
  try { config = loadConfig(home); } catch (e) { configError = e; }
  const catalogDir = config?.catalogDir || path.join(state, 'catalog');
  const errors = path.join(state, 'errors.log');
  const log = (text) => {
    try {
      fs.mkdirSync(state, { recursive: true });
      fs.appendFileSync(errors, `${new Date().toISOString()} ${text}\n`);
    } catch { /* nowhere to log */ }
  };
  let notice = '';
  try {
    if (configError) throw configError;
    const workRoot = input.cwd || process.cwd();
    const mapFiles = expandMaps(config.mapFiles, home);
    // config.json too: a change of "projects" changes the generated rules.
    const print = fingerprint({ home, workRoot, mapFiles: [...mapFiles, path.join(state, 'config.json')] });
    const last = readJson(path.join(state, 'state.json'), {});
    if (last.fingerprint !== print || last.catalogDir !== catalogDir || !fs.existsSync(catalogDir)) {
      const { built } = regenerate({ home, workRoot, catalogDir, mapFiles, print, config });
      notice = syncRules({ home, built, mapFiles, log, errors });
    }
  } catch (e) {
    log(e.stack || e.message);
    notice = `Stockroom: an internal error occurred; details: ${errors}.`;
  }
  if (config?.auto && config.shelf) notice = [notice, autoStep({ state, errors, workRoot: input.cwd || process.cwd(), log })].filter(Boolean).join(' ');
  const line = fs.existsSync(path.join(catalogDir, 'README.md'))
    ? HOOK_LINE(catalogDir, fs.existsSync(path.join(catalogDir, 'by-function.md'))) : '';
  const text = [line, notice].filter(Boolean).join(' ');
  return text ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }) : '';
}

// "auto": once a day, re-plan and apply the shelf in a detached process (it reads days of transcripts, which takes
// seconds), and tell Claude once what the last run changed.
export function autoStep({ state, errors, workRoot, log, now = Date.now(), run = startAuto }) {
  try {
    const file = path.join(state, 'auto.json');
    const last = readJson(file, {});
    const said = last.shown === false
      ? `Stockroom turned off for lack of use: ${last.off?.join(', ') || 'nothing'}; back on: ${last.on?.join(', ') || 'nothing'}. `
        + 'They stay in the catalog and work through their SKILL.md; "stockroom undo" reverts.'
      : '';
    const due = !last.at || now - Date.parse(last.at) >= 86400000;
    if (said || due) {
      fs.writeFileSync(file, JSON.stringify({ ...last, ...(said ? { shown: true } : {}), ...(due ? { at: new Date(now).toISOString() } : {}) }, null, 2) + '\n');
    }
    if (due) run({ errors, workRoot });
    return said;
  } catch (e) {
    log(`auto: ${e.message}`);
    return '';
  }
}

function startAuto({ errors, workRoot }) {
  const err = fs.openSync(errors, 'a');
  spawn(process.execPath, [fileURLToPath(new URL('../bin/stockroom.js', import.meta.url)), 'auto'],
    { cwd: workRoot, detached: true, stdio: ['ignore', 'ignore', err], windowsHide: true }).unref();
  fs.closeSync(err);
}

// Keeps the generated rule files in step with the map, once the user has applied them. Never drops critical rules
// silently: a map with fewer than before keeps the previous files and returns a sentence for Claude.
function syncRules({ home, built, mapFiles, log, errors }) {
  const applied = readJson(path.join(claudeDir(home), 'stockroom', 'rules-applied.json'), null);
  if (!applied) return '';
  if (built.criticalCount < applied.criticalCount) {
    const why = `the map now has ${built.criticalCount} critical rules, ${applied.criticalCount} before`;
    log(`rules not updated: ${why}`);
    return `Stockroom: rules not updated (${why}); the previous ones still apply. Details: ${errors}.`;
  }
  try {
    writeRules({ home, built, mapFiles });
    return '';
  } catch (e) {
    log(`rules not updated: ${e.message}`);
    return `Stockroom: rules not updated (${e.message}); the previous ones still apply. Details: ${errors}.`;
  }
}
