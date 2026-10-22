// Writes the catalog: one markdown file per kind of tool, each entry with its original description, plus a README
// and, when the user has a map, a by-function index. Written to a temp folder and swapped in whole.
import fs from 'node:fs';
import path from 'node:path';
import { resolveRow, externalTools, isIgnored } from './map.js';
import { sourceLine } from './sources.js';
import { serverKey } from './mcp.js';
import { slugger } from './files.js';
import { keyOf } from './rules.js';

const FILES = {
  skill: 'skills.md', command: 'commands.md', agent: 'agents.md',
  'mcp-server': 'mcp.md', hook: 'hooks.md', plugin: 'plugins.md', external: 'external.md',
};
const TITLES = {
  skill: 'Skills', command: 'Commands', agent: 'Subagents', 'mcp-server': 'MCP servers', hook: 'Hooks', plugin: 'Plugins',
  external: 'External tools (websites, apps, CLIs) named in the map',
};
const ORIGINS = ['personal', 'project', 'account', 'plugin', 'user-mcp', 'project-mcp', 'claude-ai', 'settings'];

function status(t) {
  if (t.enabled) return 'on';
  const { via, key } = t.off || {};
  if (via === 'enabledPlugins') return `off (turn on: enabledPlugins["${key}"] = true)`;
  if (via === 'skillOverrides') return `off (turn on: remove skillOverrides["${key}"])`;
  if (via) return `off (turn on: remove "${key}" from ${via})`;
  return 'off';
}

function mcpText(t, mcp) {
  const r = mcp.get(serverKey(t));
  if (!r) return t.server?.command ? 'MCP tools not read yet (run `stockroom catalog --read-mcp`).' : '';
  if (r.error) return `MCP tools not read: ${r.error}`;
  return [r.instructions, ...r.tools.map((x) => `#### ${x.name}\n${x.description}`)].filter(Boolean).join('\n\n');
}

function externalEntry(t) {
  const found = t.type !== 'cli' ? '' : ` · found on PATH: ${t.found === undefined ? 'not checked' : t.found ? 'yes' : 'no'}`;
  return [
    `### ${t.name}`,
    `- kind: external · type: ${t.type}${t.url ? ` · url: ${t.url}` : ''}${found}`,
    `- named in: ${t.rows.map((r) => `${r.section || '(no section)'} › ${r.title}`).join('; ')}`,
  ].join('\n');
}

// withMcp: plugins that have MCP servers. A skill of such a plugin, while off, can be read but its servers cannot run.
function entry(t, mcp, withMcp = new Set(), rulesByTool = {}) {
  if (t.kind === 'external') return externalEntry(t);
  const body = t.kind === 'mcp-server' ? [t.description, mcpText(t, mcp)].filter(Boolean).join('\n\n') : t.description;
  return [
    `### ${t.name}`,
    `- kind: ${t.kind} · origin: ${t.origin} · plugin: ${t.plugin || '-'} · status: ${status(t)}`,
    `- path: ${t.path || '-'} · skill folder: ${t.skillDir || '-'} · plugin root: ${t.pluginRoot || '-'}`,
    ...(t.source ? [`- source: ${sourceLine(t.source)}`] : []),
    ...(t.warning ? [`- warning: ${t.warning}`] : []),
    ...(rulesByTool[keyOf(t)] || []).map((r) => `- rules: ${r}`),
    ...(!t.enabled && ['skill', 'command', 'agent'].includes(t.kind) && withMcp.has(t.plugin)
      ? [`- needs: the MCP servers of plugin ${t.plugin}, off with it. Steps that call them fail until the user turns `
        + 'the plugin on and restarts; say so before starting.'] : []),
    body,
  ].join('\n');
}

const order = (a, b) => (ORIGINS.indexOf(a.origin) - ORIGINS.indexOf(b.origin))
  || (a.plugin || '').localeCompare(b.plugin || '') || a.name.localeCompare(b.name);


// The map by job: a short index (one line per case, its first tool) and one file per section with every alternative,
// so Claude reads the index and then only the section of the job at hand.
function byFunction(cases, tools, mcp, rulesByTool = {}) {
  const slug = slugger();
  const sections = [];
  for (const c of cases) {
    if (sections.at(-1)?.name !== c.section) sections.push({ name: c.section, file: `${slug(c.section)}.md`, cases: [] });
    sections.at(-1).cases.push(c);
  }
  const index = ['# By function', '',
    'The user\'s map: for each job, the first tool to prefer. Every alternative, in order, is in the section file '
    + '(by-function/<file>); read only the section of the job at hand. Full descriptions are in the kind files.', ''];
  const files = new Map();
  for (const s of sections) {
    index.push(`## ${s.name || '(no section)'} · by-function/${s.file}`,
      ...s.cases.map((c) => {
        const first = c.tools.find((t) => !isIgnored(t)); // not a path or setting written before the tool
        return `- ${c.title}${first ? ` → \`${first}\`` : ''}`;
      }), '');
    files.set(s.file, sectionText(s, tools, mcp, rulesByTool));
  }
  return { index: index.join('\n'), files };
}

function sectionText(s, tools, mcp, rulesByTool = {}) {
  const out = [`# ${s.name || '(no section)'}`, '',
    'Tools in order of preference (first = preferred). Kind files (skills.md, mcp.md…) are one folder up.', ''];
  for (const c of s.cases) {
    out.push(`### ${c.title}`, ...(c.why ? [c.why] : []));
    for (const { token, hits, of, builtin, ignored } of resolveRow(c, tools, { mcp })) {
      if (ignored) continue;
      if (of) out.push(`- \`${token}\`: ${of.kind === 'mcp-server' ? 'tool of MCP server' : 'part of'} \`${of.name}\``);
      else if (builtin) out.push(`- \`${token}\`: Claude Code built-in`);
      else if (!hits.length) {
        out.push(`- \`${token}\`: not an installed tool name (may be a program, a file or a tool inside an MCP server)`);
      }
      for (const t of hits) {
        out.push(t.kind === 'external' ? `- \`${t.name}\`: external ${t.type} · ${FILES.external}`
          : `- \`${t.name}\`: ${t.enabled ? 'on' : 'off'} · ${t.origin} · ${FILES[t.kind]}`
            + (t.source ? ` · source: ${sourceLine({ ...t.source, path: undefined, version: undefined })}` : '')
            // The path saves a lookup in skills.md: reading it is how an off skill is used.
            + (t.kind === 'skill' && t.path ? ` · SKILL.md: ${t.path}` : ''));
        const rules = rulesByTool[keyOf(t)];
        if (rules) out.push(`- rules for \`${t.name}\`: ${rules.join('; ')}`);
      }
    }
    out.push('');
  }
  return out.join('\n');
}

function readme(kinds, counts, hasMap) {
  return [
    '# Stockroom catalog',
    '',
    'Every tool installed for Claude Code, including the ones turned off, with its original description, unabridged.',
    'Generated by Stockroom; do not edit (it is rewritten when what is installed changes).',
    '',
    '## How to use it',
    '',
    '- Search it with Grep (a word from the task, a tool name) and read only the entries you need.',
    ...(hasMap ? ['- `by-function.md`: the user\'s own map, one line per job with its first tool. Check it first, then '
      + 'read only the section file it names (`by-function/<section>.md`) for the alternatives.'] : []),
    '- A skill that is **off** can still be used: read its `SKILL.md` at `path` and follow it, replacing '
      + '`${CLAUDE_PLUGIN_ROOT}` with its `plugin root`.',
    '- An MCP server, subagent or hook that is **off** cannot be used in this session: tell the user what to turn on '
      + '(the `status` line says how) and that Claude Code needs a restart.',
    '',
    '## Files',
    '',
    ...(hasMap ? ['- `by-function.md`: index of jobs; `by-function/`: each section, tools in order of preference'] : []),
    ...kinds.map((k) => `- \`${FILES[k]}\`: ${TITLES[k]} (${counts[k]})`),
    '',
  ].join('\n');
}

// onPath(command) -> boolean checks external CLIs; the hook passes none, so they read "not checked".
export function writeCatalog({ tools, cases = [], mcp = new Map(), outDir, onPath, rulesByTool = {} }) {
  tools = [...tools, ...externalTools(cases).map((t) => (t.type === 'cli' && onPath ? { ...t, found: onPath(t.name) } : t))];
  const tmp = `${outDir}.tmp-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  try {
    const kinds = Object.keys(FILES).filter((k) => tools.some((t) => t.kind === k));
    const withMcp = new Set(tools.filter((t) => t.kind === 'mcp-server' && t.plugin).map((t) => t.plugin));
    const counts = {};
    const names = [];
    for (const k of kinds) {
      const list = tools.filter((t) => t.kind === k).sort(order);
      counts[k] = list.length;
      fs.writeFileSync(path.join(tmp, FILES[k]), [`# ${TITLES[k]}`, '', ...list.map((t) => `${entry(t, mcp, withMcp, rulesByTool)}\n`)].join('\n'));
      names.push(FILES[k]);
    }
    if (cases.length) {
      const { index, files } = byFunction(cases, tools, mcp, rulesByTool);
      fs.writeFileSync(path.join(tmp, 'by-function.md'), index);
      fs.mkdirSync(path.join(tmp, 'by-function'));
      for (const [f, text] of files) fs.writeFileSync(path.join(tmp, 'by-function', f), text);
      names.push('by-function.md', ...[...files.keys()].map((f) => path.join('by-function', f)));
    }
    fs.writeFileSync(path.join(tmp, 'README.md'), readme(kinds, counts, cases.length > 0));
    names.push('README.md');

    // Windows cannot rename over a folder: move the old one aside, swap, then delete it. If the swap fails (an
    // antivirus holding the new folder), the old catalog goes back, so there is never no catalog.
    const old = `${outDir}.old-${process.pid}`;
    const hadOld = fs.existsSync(outDir);
    if (hadOld) fs.renameSync(outDir, old);
    try {
      fs.renameSync(tmp, outDir);
    } catch (e) {
      if (hadOld) fs.renameSync(old, outDir);
      throw e;
    }
    // Leftovers of earlier runs too (older than a minute, so never another session's swap in progress).
    const parent = path.dirname(outDir);
    for (const f of fs.readdirSync(parent).filter((n) => n.startsWith(`${path.basename(outDir)}.old-`))) {
      const p = path.join(parent, f);
      try {
        if (p === old || Date.now() - fs.statSync(p).mtimeMs > 60000) fs.rmSync(p, { recursive: true, force: true });
      } catch { /* a file still open: removed next time */ }
    }
    return { files: names.map((n) => path.join(outDir, n)) };
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}
