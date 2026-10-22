// Where each tool comes from (repo, package or url, with its version) and the cache of its official source text.
// No network here: Claude reads sources online from the /stockroom map skill and saves them at sourcePath.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, claudeDir } from './files.js';

const data = new Map();
function load(home) {
  if (data.has(home)) return data.get(home);
  const plugins = path.join(claudeDir(home), 'plugins');
  const markets = readJson(path.join(plugins, 'known_marketplaces.json'), {});
  const entries = {};
  for (const [name, m] of Object.entries(markets)) {
    const list = readJson(path.join(m.installLocation || '', '.claude-plugin', 'marketplace.json'), {}).plugins || [];
    entries[name] = Object.fromEntries(list.map((p) => [p.name, p.source]));
  }
  const d = {
    installed: readJson(path.join(plugins, 'installed_plugins.json'), {}).plugins || {},
    markets, entries,
    lock: readJson(path.join(home, '.agents', '.skill-lock.json'), {}).skills || {},
  };
  data.set(home, d);
  return d;
}

// "https://github.com/Maker/tools.git" -> "Maker/tools"; other hosts keep their url.
function repoOf(url) {
  const m = String(url || '').match(/github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?\/?$/);
  return m ? { repo: m[1] } : url ? { url } : {};
}
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v));
const relPath = (p) => String(p || '').replace(/^\.\/?/, '').replace(/\/$/, '');

function pluginOrigin(id, d) {
  const [name, market] = id.split('@');
  const info = (d.installed[id] || [])[0] || {};
  const version = [info.version, info.gitCommitSha?.slice(0, 12)].filter(Boolean).join('+');
  const src = d.entries[market]?.[name];
  let where;
  if (src && typeof src === 'object') where = { ...repoOf(src.url || (src.repo && `https://github.com/${src.repo}`)), path: src.path };
  else {
    const m = d.markets[market]?.source || {};
    where = { ...(m.repo ? { repo: m.repo } : repoOf(m.url)), path: relPath(src) };
  }
  return where.repo || where.url ? clean({ ...where, version }) : null;
}

// npx/uvx/pipx (also behind "cmd /c") with the package as the first argument that is not a flag.
function packageOrigin(server = {}) {
  const words = [server.command, ...(server.args || [])].map((w) => String(w));
  const i = words.findIndex((w) => /^(npx|uvx|pipx|bunx)(\.exe|\.cmd)?$/i.test(path.basename(w)));
  if (i < 0) return server.url ? { url: server.url } : null;
  const pkg = words.slice(i + 1).find((w) => !w.startsWith('-') && w !== 'run');
  if (!pkg) return null;
  const at = pkg.lastIndexOf('@');
  const [name, version] = at > 0 ? [pkg.slice(0, at), pkg.slice(at + 1)] : [pkg, ''];
  const registry = /^npx|^bunx/i.test(path.basename(words[i])) ? 'npm' : 'pypi';
  return clean({ package: `${registry}:${name}`, version });
}

export function toolOrigin(tool, { home }) {
  const d = load(home);
  if (tool.off?.via === 'enabledPlugins') return pluginOrigin(tool.off.key, d);
  if (tool.kind === 'mcp-server') return packageOrigin(tool.server);
  if (tool.origin === 'personal' && tool.skillDir) {
    const lock = d.lock[path.basename(tool.skillDir)];
    if (!lock) return null;
    const folder = relPath(path.posix.dirname(lock.skillPath || '.')).replace(/^\.$/, '');
    return clean({ ...repoOf(lock.sourceUrl), path: folder, version: lock.skillFolderHash?.slice(0, 12) });
  }
  return null;
}

export function sourceLine(o) {
  if (!o) return '';
  const where = o.repo ? `https://github.com/${o.repo}` : o.url || o.package;
  return [where + (o.path ? ` (folder ${o.path})` : ''), ...(o.version ? [`version ${o.version}`] : [])].join(' · ');
}

const dir = (home) => path.join(claudeDir(home), 'stockroom', 'sources');
const key = (o) => `${[o.repo || o.url || o.package, o.path].filter(Boolean).join('/')}@${o.version || 'latest'}`
  .replace(/[^\w.@-]+/g, '_');
export const sourcePath = (home, o) => path.join(dir(home), `${key(o)}.md`);

export function readSource(home, origin) {
  try { return fs.readFileSync(sourcePath(home, origin), 'utf8'); } catch { return null; }
}

export function listSources(home) {
  try { return fs.readdirSync(dir(home)).filter((f) => f.endsWith('.md')); } catch { return []; }
}

// Deletes cached sources that no current origin points to (an updated tool's old version).
export function pruneSources(home, origins) {
  const live = new Set(origins.filter(Boolean).map((o) => `${key(o)}.md`));
  const gone = listSources(home).filter((f) => !live.has(f));
  for (const f of gone) fs.rmSync(path.join(dir(home), f));
  return gone;
}
