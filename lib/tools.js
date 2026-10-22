// Finds every installed tool of every kind: skills, commands, agents, plugins, MCP servers and hooks.
// Descriptions are copied from their source as they are; disabled plugins' items are listed with enabled: false.
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from './frontmatter.js';
import { readJson, subdirs, claudeDir, claudeJsonPath } from './files.js';

const SKIP = new Set(['node_modules', '.git']);

// True when the command's first word is a file in a PATH folder (with PATHEXT on Windows). No process is started.
export function findOnPath(command, { env = process.env, platform = process.platform } = {}) {
  const name = command.trim().split(/\s+/)[0];
  const win = platform === 'win32';
  const exts = win ? ['', ...(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)] : [''];
  const dirs = (env.PATH || env.Path || '').split(win ? ';' : path.delimiter).filter(Boolean);
  return dirs.some((d) => exts.some((e) => {
    try { return fs.statSync(path.join(d, name + e)).isFile(); } catch { return false; }
  }));
}
const list = (v) => (v == null ? [] : [].concat(v));
const files = (dir, ext) => { try { return fs.readdirSync(dir).filter((f) => f.endsWith(ext)); } catch { return []; } };

function readMd(file) {
  try {
    return { data: parseFrontmatter(fs.readFileSync(file, 'utf8')).data };
  } catch (e) {
    return { data: {}, warning: `unreadable: ${e.code || e.message}` };
  }
}

// Same text Claude Code lists for a skill: description, then when_to_use on its own line.
function skillText(data) {
  const desc = typeof data.description === 'string' ? data.description : '';
  const when = typeof data.when_to_use === 'string' ? data.when_to_use : '';
  return when ? `${desc}\n${when}` : desc;
}

function make(kind, name, description, ctx, extra = {}) {
  const t = { kind, name, description, origin: ctx.origin, enabled: ctx.enabled !== false, ...extra };
  if (ctx.plugin) Object.assign(t, { plugin: ctx.plugin, pluginRoot: ctx.pluginRoot });
  if (ctx.off) t.off = ctx.off;
  return t;
}

// ctx: { origin, prefix, plugin, pluginRoot, enabled, off, overrides } — off unset means "per name via skillOverrides".
function skillOrCommand(kind, file, name, ctx) {
  const { data, warning } = readMd(file);
  const own = ctx.overrides && !ctx.plugin && ctx.origin !== 'account';
  const t = make(kind, name, skillText(data), {
    ...ctx,
    enabled: ctx.enabled !== false && ctx.overrides?.[name] !== 'off',
    off: own ? { via: 'skillOverrides', key: name } : ctx.off,
  }, { path: file });
  // disable-model-invocation: not in the listing Claude sees, so turning it off saves nothing.
  if (data['disable-model-invocation'] === true) t.modelInvocable = false;
  if (own && ['name-only', 'user-invocable-only'].includes(ctx.overrides[name])) t.listing = ctx.overrides[name];
  if (kind === 'skill') t.skillDir = path.dirname(file);
  if (warning) t.warning = warning;
  return t;
}

function skillsIn(dir, ctx) {
  if (fs.existsSync(path.join(dir, 'SKILL.md'))) {
    return [skillOrCommand('skill', path.join(dir, 'SKILL.md'), ctx.prefix + path.basename(dir), ctx)];
  }
  return subdirs(dir)
    .filter((d) => fs.existsSync(path.join(dir, d, 'SKILL.md')))
    .map((d) => skillOrCommand('skill', path.join(dir, d, 'SKILL.md'), ctx.prefix + d, ctx));
}

function commandsIn(dir, ctx) {
  return files(dir, '.md').map((f) => skillOrCommand('command', path.join(dir, f), ctx.prefix + f.slice(0, -3), ctx));
}

function agentsIn(dir, ctx) {
  const paths = dir.endsWith('.md') ? [dir] : files(dir, '.md').map((f) => path.join(dir, f));
  return paths.map((file) => {
    const { data, warning } = readMd(file);
    const name = ctx.prefix + (typeof data.name === 'string' && data.name ? data.name : path.basename(file, '.md'));
    const t = make('agent', name, typeof data.description === 'string' ? data.description : '', ctx, { path: file });
    if (warning) t.warning = warning;
    return t;
  });
}

function hooksIn(hooks, label, ctx, file) {
  const out = [];
  for (const [event, groups] of Object.entries(hooks || {})) {
    for (const g of list(groups)) {
      for (const h of list(g?.hooks)) {
        out.push(make('hook', `${label}:${event}`, `${event}: ${h?.command ?? h?.type ?? ''}`, ctx, file ? { path: file } : {}));
      }
    }
  }
  return out;
}

function serversIn(servers, ctx, file, routeFor) {
  return Object.entries(servers || {}).map(([name, cfg]) => {
    const { type, command, args, env, url, cwd } = cfg || {};
    const route = routeFor ? routeFor(name) : {};
    return make('mcp-server', name, '', { ...ctx, ...route },
      { server: { type, command, args, env, url, cwd }, ...(file ? { path: file } : {}),
        ...('approved' in route ? { approved: route.approved } : {}) });
  });
}

const deniedNames = (settings) => list(settings.deniedMcpServers).map((d) => (typeof d === 'string' ? d : d?.serverName));

function pluginTools(claude, settings, overrides) {
  const installed = readJson(path.join(claude, 'plugins', 'installed_plugins.json'), {}).plugins || {};
  const enabledMap = settings.enabledPlugins || {};
  const out = [];
  for (const [id, entries] of Object.entries(installed)) {
    const root = list(entries)[0]?.installPath;
    if (!root) continue;
    const manifestPath = path.join(root, '.claude-plugin', 'plugin.json');
    const manifest = readJson(manifestPath, {});
    const plugin = manifest.name || id.split('@')[0];
    const enabled = enabledMap[id] !== false;
    const ctx = { origin: 'plugin', plugin, pluginRoot: root, enabled, off: { via: 'enabledPlugins', key: id }, overrides };
    const at = (p) => path.resolve(root, p);

    out.push(make('plugin', plugin, typeof manifest.description === 'string' ? manifest.description : '', ctx,
      { path: manifestPath }));
    // A manifest may list "./skills/" too (gsap-skills does): each folder once.
    for (const dir of new Set([path.join(root, 'skills'), ...list(manifest.skills).map(at)].map((d) => path.resolve(d)))) {
      out.push(...skillsIn(dir, { ...ctx, prefix: `${plugin}:` }));
    }
    // The manifest may also name a file inside the default folder: each file once.
    const files = new Set();
    const once = (t) => !files.has(t.path) && files.add(t.path);
    for (const dir of [path.join(root, 'commands'), ...list(manifest.commands).map(at)]) {
      out.push(...commandsIn(dir, { ...ctx, prefix: `${plugin}:` }).filter(once));
    }
    for (const dir of [path.join(root, 'agents'), ...list(manifest.agents).map(at)]) {
      out.push(...agentsIn(dir, { ...ctx, prefix: `${plugin}:` }).filter(once));
    }

    // MCP servers: inline in plugin.json, or JSON files it points to, plus the default .mcp.json.
    const servers = {};
    const serverFiles = new Set([path.join(root, '.mcp.json')]);
    for (const v of list(manifest.mcpServers)) {
      if (typeof v === 'string') serverFiles.add(at(v));
      else Object.assign(servers, v);
    }
    for (const f of serverFiles) {
      const json = readJson(f, null);
      if (json) Object.assign(servers, json.mcpServers || json);
    }
    out.push(...serversIn(servers, ctx, manifestPath));

    // Hooks: inline in plugin.json, or files it points to, plus the default hooks/hooks.json.
    const hookFiles = new Set([path.join(root, 'hooks', 'hooks.json')]);
    for (const v of list(manifest.hooks)) {
      if (typeof v === 'string') hookFiles.add(at(v));
      else out.push(...hooksIn(v.hooks || v, plugin, ctx, manifestPath));
    }
    for (const f of hookFiles) {
      const json = readJson(f, null);
      if (json) out.push(...hooksIn(json.hooks || json, plugin, ctx, f));
    }
  }
  return out;
}

// Project items of one folder: .claude/{skills,commands,agents,settings*.json} and .mcp.json.
function projectTools(dir, userSettings, overrides) {
  const claudeDir = path.join(dir, '.claude');
  const ctx = { origin: 'project', prefix: '', overrides };
  const out = [
    ...skillsIn(path.join(claudeDir, 'skills'), ctx),
    ...commandsIn(path.join(claudeDir, 'commands'), ctx),
    ...agentsIn(path.join(claudeDir, 'agents'), { origin: 'project', prefix: '' }),
  ];
  const disabled = new Set(list(userSettings.disabledMcpjsonServers));
  const approved = new Set(list(userSettings.enabledMcpjsonServers));
  let approveAll = userSettings.enableAllProjectMcpServers === true;
  for (const f of ['settings.json', 'settings.local.json']) {
    const file = path.join(claudeDir, f);
    const s = readJson(file, {});
    list(s.disabledMcpjsonServers).forEach((n) => disabled.add(n));
    list(s.enabledMcpjsonServers).forEach((n) => approved.add(n));
    if (s.enableAllProjectMcpServers === true) approveAll = true;
    out.push(...hooksIn(s.hooks, 'settings', { origin: 'settings' }, file));
  }
  const mcpFile = path.join(dir, '.mcp.json');
  const mcp = readJson(mcpFile, null);
  if (mcp) {
    out.push(...serversIn(mcp.mcpServers || {}, { origin: 'project-mcp' }, mcpFile, (name) => ({
      enabled: !disabled.has(name),
      // Claude Code asks before it starts a server of a project .mcp.json; Stockroom never starts an unapproved one.
      approved: approveAll || approved.has(name),
      off: { via: 'disabledMcpjsonServers', key: name },
    })));
  }
  return out;
}

function walk(dir, depth, visit) {
  visit(dir);
  if (depth <= 0) return;
  for (const d of subdirs(dir)) {
    if (!SKIP.has(d) && !d.startsWith('.')) walk(path.join(dir, d), depth - 1, visit);
  }
}

export function discoverTools({ home, workRoot, depth = 4 }) {
  const claude = claudeDir(home);
  const settingsFile = path.join(claude, 'settings.json');
  const settings = readJson(settingsFile, {});
  const overrides = settings.skillOverrides || {};
  const personal = path.join(claude, 'skills');
  const own = { origin: 'personal', prefix: '', overrides };

  const out = [
    ...skillsIn(personal, own),
    ...commandsIn(path.join(claude, 'commands'), own),
    ...agentsIn(path.join(claude, 'agents'), { origin: 'personal', prefix: '' }),
    ...subdirs(path.join(personal, 'synced')).flatMap((acct) =>
      skillsIn(path.join(personal, 'synced', acct), { origin: 'account', prefix: 'anthropic-skills:' })),
    ...hooksIn(settings.hooks, 'settings', { origin: 'settings' }, settingsFile),
    ...pluginTools(claude, settings, overrides),
  ];

  // User and local-scope MCP servers from ~/.claude.json; both are turned off by name with deniedMcpServers.
  const claudeJson = claudeJsonPath(home);
  const cj = readJson(claudeJson, {});
  const denied = new Set(deniedNames(settings));
  const byName = (name) => ({ enabled: !denied.has(name), off: { via: 'deniedMcpServers', key: name } });
  out.push(...serversIn(cj.mcpServers, { origin: 'user-mcp' }, claudeJson, byName));
  for (const p of Object.values(cj.projects || {})) {
    out.push(...serversIn(p?.mcpServers, { origin: 'project-mcp' }, claudeJson, byName));
  }
  // claude.ai connectors, by display name ("claude.ai Linear"); deniedMcpServers blocks them by that name.
  // shortcut: claudeAiMcpEverConnected is undocumented and keeps connectors removed since; switch to an official list if one appears.
  for (const name of list(cj.claudeAiMcpEverConnected).filter((n) => typeof n === 'string')) {
    out.push(make('mcp-server', name, 'claude.ai connector: its tools come from your claude.ai account.',
      { origin: 'claude-ai', ...byName(name) }, { server: { type: 'claude-ai' }, path: claudeJson }));
  }

  if (workRoot) {
    const homeDir = path.resolve(home);
    walk(path.resolve(workRoot), depth, (dir) => {
      if (dir !== homeDir) out.push(...projectTools(dir, settings, overrides));
    });
  }
  return out;
}
