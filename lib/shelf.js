// The shelf: which tools stay on. Plans what to turn off, applies it to ~/.claude/settings.json with a backup,
// and undoes only what Stockroom wrote and nobody changed since.
import fs from 'node:fs';
import path from 'node:path';
import { matchName } from './map.js';
import { readKey } from './measure.js';

const DAY = 86400000;
const SELF = 'stockroom'; // the shelf never turns off its own plugin: its hook is what keeps the catalog
const glob = (p) => new RegExp(`^${p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
const matches = (patterns, t) => patterns.some((p) => glob(p).test(t.name) || (t.plugin && glob(p).test(t.plugin)));

// How Claude Code names an MCP server's tools in transcripts: mcp__<server>__<tool>.
export function mcpPrefix(t) {
  const safe = (s) => s.replace(/[^A-Za-z0-9_-]/g, '_');
  if (t.origin === 'claude-ai') return `mcp__claude_ai_${safe(t.name.replace(/^claude\.ai /, ''))}`;
  return t.origin === 'plugin' ? `mcp__plugin_${safe(t.plugin)}_${safe(t.name)}` : `mcp__${safe(t.name)}`;
}
const usageKey = (t) => (t.kind === 'mcp-server' ? mcpPrefix(t) : t.name);

const NO_ROUTE = {
  account: 'account skills can only be turned off all together (syncClaudeAiSkills)',
  agent: 'no setting turns off a single user or project subagent',
  hook: 'no setting turns off a single hook (disableAllHooks would turn off all of them)',
};

// For shelf "map": every place the map names a tool, as { pos, title, keep, days }. A section rule
// (config.sections, keys may use *) can set keep and days, and "order" puts the tools it names first.
function mapPlaces(tools, cases, config) {
  const places = new Map();
  for (const c of cases) {
    const key = Object.keys(config.sections || {}).find((k) => new RegExp(glob(k).source, 'i').test(c.section));
    const rule = key ? config.sections[key] : {};
    let groups = c.tools.map((token) => matchName(token, tools)).filter((g) => g.length);
    if (rule.order) {
      const rank = (g) => { const i = rule.order.findIndex((p) => g.some((t) => matches([p], t))); return i < 0 ? Infinity : i; };
      groups = groups.map((g, i) => [g, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([g]) => g);
    }
    groups.forEach((g, pos) => g.forEach((t) => places.set(t, [...(places.get(t) || []),
      { pos, title: c.title, keep: rule.keep ?? config.keep ?? 1, days: rule.days ?? config.days }])));
  }
  return places;
}

// applied: what Stockroom turned off earlier ({ via, key }), so a tool used while off can be offered back on.
// protectedNames: tools a critical rule names; they and the plugin that holds them never go off.
export function planShelf({ tools, config, usage = new Map(), now = Date.now(), cases = [], applied = [], protectedNames = new Set() }) {
  const result = { off: [], on: [], cannot: [], kept: [] };
  if (!config.shelf) return result;
  const protectedPlugins = new Set(tools.filter((t) => protectedNames.has(t.name) && t.plugin).map((t) => t.plugin));
  const isProtected = (t) => protectedNames.has(t.name) || (t.plugin && protectedPlugins.has(t.plugin));
  const keptSeen = new Set();
  if (config.shelf === 'map' && !cases.length) throw new Error('shelf "map" needs a map: add your map files to "mapFiles".');
  // A turned-off skill is used by reading its SKILL.md, so that read counts as use too.
  const lastUse = (t) => Math.max(usage.get(usageKey(t)) || 0, t.path ? usage.get(readKey(t.path)) || 0 : 0);
  const usedIn = (t, days) => lastUse(t) >= now - days * DAY;
  const used = (t) => usedIn(t, config.days);
  const places = config.shelf === 'map' ? mapPlaces(tools, cases, config) : new Map();

  // Why a tool should go to the stockroom, or null to keep it.
  const reasonFor = (t) => {
    if (matches(config.alwaysOff || [], t)) return 'alwaysOff';
    if (config.shelf === 'none') return 'shelf "none"';
    if (config.shelf === 'list') return matches(config.list, t) ? 'listed' : null;
    if (config.shelf === 'usage') return used(t) ? null : `unused ${config.days} days`;
    const at = places.get(t);
    if (!at) {
      if (config.unmapped === 'off') return 'not in the map';
      return config.unmapped === 'usage' && !used(t) ? `not in the map, unused ${config.days} days` : null;
    }
    if (at.some((p) => p.pos < p.keep || usedIn(t, p.days))) return null;
    const first = at.reduce((a, b) => (b.pos < a.pos ? b : a));
    return `alternative #${first.pos + 1} in "${first.title}"`;
  };

  // A plugin's items go with the plugin; only the plugin itself is a candidate.
  const items = (p) => tools.filter((t) => t.kind !== 'plugin' && t.origin === 'plugin' && t.plugin === p.plugin);
  const wanted = (t) => {
    if (t.kind !== 'plugin') return reasonFor(t);
    const own = reasonFor(t);
    if (own === 'alwaysOff' || config.shelf === 'none' || config.shelf === 'list') return own;
    if (config.shelf === 'usage') return items(t).some(used) ? null : own;
    if (places.has(t) && !own) return null;
    const its = items(t).filter((i) => i.kind !== 'hook');
    const keptItem = its.find((i) => !reasonFor(i));
    if (keptItem) {
      for (const i of its) {
        const r = reasonFor(i);
        if (r && i.enabled) result.cannot.push({ tool: i, reason: `${r}, but its plugin ${t.plugin} stays on for ${keptItem.name}` });
      }
      return null;
    }
    return its.length ? 'all its tools are alternatives or unused' : own;
  };

  const seen = new Set();
  const mine = new Set(applied.map((a) => `${a.via}/${a.key}`));
  const offAs = config.offAs || 'off';
  for (const t of tools) {
    if (t.origin === 'plugin' && t.kind !== 'plugin') continue;
    if (t.kind === 'plugin' && t.name === SELF) continue;
    if (!t.enabled) {
      // Used while off (from the catalog): offer it back on, if Stockroom was the one that turned it off.
      const usedOff = t.kind === 'plugin' ? items(t).some(used) : used(t);
      if (!usedOff || !t.off) continue;
      const id = `${t.off.via}/${t.off.key}`;
      if (!mine.has(id)) {
        result.cannot.push({ tool: t, reason: `used in the last ${config.days} days while off, but you turned it off, not Stockroom` });
      } else if (!result.on.some((o) => `${o.via}/${o.key}` === id)) {
        result.on.push({ tool: t, via: t.off.via, key: t.off.key, reason: `used in the last ${config.days} days while off` });
      }
      continue;
    }
    // Not in the listing Claude sees (disable-model-invocation), or already name-only: turning it off saves nothing.
    if (t.modelInvocable === false || (offAs === 'name-only' && t.listing === 'name-only')) continue;
    if (matches(config.neverOff, t)) continue;
    if (t.kind === 'plugin' && items(t).some((i) => matches(config.neverOff, i))) continue;
    const reason = wanted(t);
    if (!reason) continue;
    if (isProtected(t)) {
      const id = t.off ? `${t.off.via}/${t.off.key}` : t.name;
      if (!keptSeen.has(id)) {
        keptSeen.add(id);
        const shown = (t.plugin && tools.find((x) => x.kind === 'plugin' && x.plugin === t.plugin)) || t;
        result.kept.push({ tool: shown, reason: 'required by a critical rule' });
      }
      continue;
    }
    if ((config.shelf === 'usage' || config.shelf === 'map') && t.kind === 'plugin' && reason !== 'alwaysOff') {
      const its = items(t);
      // Hooks and LSP servers work without being called: their use cannot be measured.
      if (its.some((i) => i.kind === 'hook') || !its.length) {
        result.cannot.push({ tool: t, reason: 'its hooks or language servers run on their own, so its use cannot be measured; kept on' });
        continue;
      }
    }
    if (!t.off) {
      result.cannot.push({ tool: t, reason: NO_ROUTE[t.origin] || NO_ROUTE[t.kind] || 'no official setting turns it off' });
      continue;
    }
    const id = `${t.off.via}/${t.off.key}`;
    const value = t.off.via === 'skillOverrides' ? offAs : undefined;
    if (!seen.has(id)) { seen.add(id); result.off.push({ tool: t, via: t.off.via, key: t.off.key, reason, ...(value ? { value } : {}) }); }
  }
  return result;
}

function readSettings(settingsPath) {
  if (!fs.existsSync(settingsPath)) return null;
  const text = fs.readFileSync(settingsPath, 'utf8').replace(/^﻿/, '');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${settingsPath} is not valid JSON (${err.message}). Nothing was changed.`);
  }
}

const writeJson = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
};

// Each route: what Stockroom writes, how to read it back, how to take it out.
const ROUTES = {
  skillOverrides: {
    has: (s, k) => s.skillOverrides && k in s.skillOverrides,
    get: (s, k) => s.skillOverrides?.[k],
    set: (s, k, v = 'off') => { s.skillOverrides = { ...(s.skillOverrides || {}), [k]: v }; },
    value: 'off',
  },
  enabledPlugins: {
    has: (s, k) => s.enabledPlugins?.[k] === false,
    get: (s, k) => s.enabledPlugins?.[k],
    set: (s, k) => { s.enabledPlugins = { ...(s.enabledPlugins || {}), [k]: false }; },
    value: false,
  },
  deniedMcpServers: {
    has: (s, k) => (s.deniedMcpServers || []).some((d) => d?.serverName === k),
    set: (s, k) => { s.deniedMcpServers = [...(s.deniedMcpServers || []), { serverName: k }]; },
  },
  disabledMcpjsonServers: {
    has: (s, k) => (s.disabledMcpjsonServers || []).includes(k),
    set: (s, k) => { s.disabledMcpjsonServers = [...(s.disabledMcpjsonServers || []), k]; },
  },
};

export function applyShelf({ settingsPath, off, stateDir }) {
  const settings = readSettings(settingsPath);
  let backupPath = null;
  if (settings) {
    backupPath = path.join(stateDir, 'backups', `settings-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.copyFileSync(settingsPath, backupPath);
  }
  const next = settings || {};
  const written = [];
  for (const { via, key, value } of off) {
    const route = ROUTES[via];
    if (!route || route.has(next, key)) continue; // the user's own entry wins
    const prev = route.get ? route.get(next, key) : undefined;
    route.set(next, key, value);
    written.push({ via, key, ...(value ? { value } : {}), ...(prev === undefined ? {} : { prev }) });
  }
  writeJson(settingsPath, next);

  const appliedPath = path.join(stateDir, 'applied.json');
  const before = fs.existsSync(appliedPath) ? JSON.parse(fs.readFileSync(appliedPath, 'utf8')) : [];
  writeJson(appliedPath, [...before, ...written]);
  return { backupPath, written };
}

// only: "via/key" ids to undo (turning those back on); without it, everything Stockroom changed.
export function undoShelf({ settingsPath, stateDir, only }) {
  const appliedPath = path.join(stateDir, 'applied.json');
  const settings = readSettings(settingsPath);
  if (!settings || !fs.existsSync(appliedPath)) return { restored: [] };
  const restored = [];
  const kept = [];
  for (const rec of JSON.parse(fs.readFileSync(appliedPath, 'utf8'))) {
    const { via, key } = rec;
    if (only && !only.has(`${via}/${key}`)) { kept.push(rec); continue; }
    if (via === 'skillOverrides' || via === 'enabledPlugins') {
      const map = settings[via];
      if (!map || map[key] !== (rec.value ?? ROUTES[via].value)) continue; // changed since: leave it
      if ('prev' in rec) map[key] = rec.prev;
      else delete map[key];
      if (!Object.keys(map).length) delete settings[via];
    } else {
      const list = settings[via] || [];
      const i = list.findIndex((d) => (via === 'deniedMcpServers' ? d?.serverName === key : d === key));
      if (i < 0) continue;
      list.splice(i, 1);
      if (!list.length) delete settings[via];
    }
    restored.push(rec);
  }
  writeJson(settingsPath, settings);
  if (kept.length) writeJson(appliedPath, kept);
  else fs.rmSync(appliedPath);
  return { restored };
}

// Project settings override the user file: list the ones that set a key the shelf writes (a warning, not a block).
export function projectConflicts({ workRoot, depth = 4 }) {
  const found = [];
  const walk = (dir, left) => {
    for (const f of ['settings.json', 'settings.local.json']) {
      const file = path.join(dir, '.claude', f);
      let s;
      try { s = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { continue; }
      const keys = Object.keys(ROUTES).filter((k) => k in s);
      if (keys.length) found.push(`${file}: ${keys.join(', ')}`);
    }
    if (left <= 0) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.')) walk(path.join(dir, e.name), left - 1);
    }
  };
  if (workRoot) walk(path.resolve(workRoot), depth);
  return found;
}
