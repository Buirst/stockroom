#!/usr/bin/env node
// Stockroom command line.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJson, claudeDir } from '../lib/files.js';
import { discoverTools, findOnPath } from '../lib/tools.js';
import { listingChars, listedSkills, toolUsage } from '../lib/measure.js';
import { checkNode, loadConfig } from '../lib/config.js';
import { planShelf, applyShelf, undoShelf, projectConflicts } from '../lib/shelf.js';
import { parseMap, parseRules, checkMap, externalTools, resolveRow, mapIndex } from '../lib/map.js';
import { buildRules, planRules, writeRules, removeRules, targets } from '../lib/rules.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { toolOrigin, sourceLine, readSource, sourcePath } from '../lib/sources.js';
import { readMcpAll, readableServers, serverKey } from '../lib/mcp.js';
import { gradeE2E } from '../lib/e2e.js';
import { report } from '../lib/report.js';
import { runHook, regenerate, expandMaps } from '../lib/hook.js';

// SessionStart hook: must never fail the session, so it runs before anything that can exit.
if (process.argv[2] === 'hook') {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { /* no or bad stdin */ }
  process.stdout.write(runHook({ home: os.homedir(), input }));
  process.exit(0);
}

const nodeProblem = checkNode(process.versions.node);
if (nodeProblem) {
  console.error(nodeProblem);
  process.exit(1);
}

const home = os.homedir();
const cwd = process.cwd();
const settingsPath = path.join(claudeDir(home), 'settings.json');
const stateDir = path.join(claudeDir(home), 'stockroom');
const configPath = path.join(stateDir, 'config.json');
const planPath = path.join(stateDir, 'plan.json');
const [cmd, ...args] = process.argv.slice(2);
const KINDS = ['skill', 'command', 'agent', 'plugin', 'mcp-server', 'hook'];

// --name value, repeatable.
const option = (name) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] !== undefined ? [args[i + 1]] : []));
const flag = (name) => args.includes(`--${name}`);
let config;
const cfg = () => (config ??= loadConfig(home));

function status() {
  const c = cfg();
  const tools = discoverTools({ home, workRoot: cwd });
  console.log(`Tools found: ${tools.length} (user, plugins, account, and projects under ${cwd})`);
  for (const k of KINDS) {
    const of = tools.filter((t) => t.kind === k);
    console.log(`  ${k.padEnd(10)} ${of.filter((t) => t.enabled).length} on  ${of.filter((t) => !t.enabled).length} off`);
  }
  const st = readJson(path.join(stateDir, 'state.json'), {});
  console.log(fs.existsSync(path.join(c.catalogDir, 'README.md'))
    ? `Catalog: ${c.catalogDir} (written ${st.at || 'at an unknown time'})`
    : 'Catalog: not written yet (written at the start of the next session, or run "stockroom catalog")');
  const settings = readJson(settingsPath, {});
  const { total } = listingChars(listedSkills({ home, projectDir: cwd }), settings.skillOverrides || {},
    settings.skillListingMaxDescChars);
  console.log(`Skill listing sent to Claude every session: ${total} characters`);
  const applied = readJson(path.join(stateDir, 'applied.json'), []);
  console.log(`Shelf: ${c.shelf ?? 'not set (nothing is turned off)'}; settings changed by Stockroom: ${applied.length}`);
  const hint = readHint(settings, c.catalogDir);
  if (hint) console.log(hint);
}

// The catalog is outside the working folder; in a mode that asks, each read of it may ask too.
function readHint(settings, catalogDir) {
  // Bypass mode is often turned on at launch, not in settings; skipDangerousModePermissionPrompt says the user uses it.
  if (['bypassPermissions', 'auto'].includes(settings.permissions?.defaultMode) || settings.skipDangerousModePermissionPrompt) return '';
  if ((settings.permissions?.allow || []).some((r) => /^Read\(.*stockroom/i.test(r))) return '';
  // Permission paths: "~/x" is under home, "//x" is absolute, "/x" would be relative to the project.
  const rel = path.relative(home, catalogDir);
  const rule = (rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? `~/${rel}` : `//${catalogDir}`).replace(/\\/g, '/');
  return `If Claude asks permission each time it reads the catalog, add "Read(${rule}/**)" `
    + `to "permissions.allow" in ${settingsPath}.`;
}

function check() {
  const c = cfg();
  const mapFiles = expandMaps(c.mapFiles, home);
  if (!mapFiles.length) {
    console.log('No map configured. Stockroom works without one: the catalog lists every tool by kind.');
    console.log(`To rank tools per job, run "stockroom map init" and add the file to "mapFiles" in ${configPath}.`);
    return;
  }
  const cases = mapFiles.flatMap((f) => parseMap(fs.readFileSync(f, 'utf8'), f));
  const tools = discoverTools({ home, workRoot: cwd });
  const cache = readJson(path.join(stateDir, 'mcp-cache.json'), {});
  const mcp = new Map(Object.entries(cache));
  const { unknown, unmapped, parts, builtin, ignored } = checkMap(cases, tools, { mcp });
  console.log(`Map: ${mapFiles.length} files, ${cases.length} cases.`);
  console.log(`Recognized without an entry of their own: ${parts.length} parts of a tool (MCP tools, sub-commands), `
    + `${builtin.length} Claude Code built-ins, ${ignored.length} paths or settings (ignored).`);
  if (!Object.keys(cache).length) console.log('  MCP tools are recognized only after "catalog --read-mcp".');
  const external = externalTools(cases);
  if (external.length) {
    const missing = external.filter((t) => t.type === 'cli' && !findOnPath(t.name));
    const n = (type) => external.filter((t) => t.type === type).length;
    console.log(`External tools in the map: ${n('web')} websites, ${n('app')} apps, ${n('cli')} CLIs.`);
    if (missing.length) console.log(`  CLIs not found on PATH: ${missing.map((t) => t.name).join(', ')}`);
  }
  if (unknown.length) {
    console.log(`\nNames in the map that match nothing (${unknown.length}): renamed or removed tools, or programs and`
      + ' websites to mark with web/app/CLI:');
    for (const u of unknown) {
      console.log(`  ${path.basename(u.file)} · ${u.title}: \`${u.token}\`${u.closest ? ` (closest installed: ${u.closest.name})` : ''}`);
    }
  }
  console.log(`\nInstalled tools that no case names: ${unmapped.length} (they are still in the catalog)`);
  for (const k of KINDS) {
    const of = unmapped.filter((t) => t.kind === k);
    if (of.length) console.log(`  ${k}: ${of.length}${flag('all') ? `: ${of.map((t) => t.name).join(', ')}` : ''}`);
  }
  if (!flag('all')) console.log('Add --all to list their names.');
  const { built } = rulesNow();
  if (built.warnings.length) console.log(`\nRules to fix in the map (${built.warnings.length}):\n  ${built.warnings.join('\n  ')}`);
}

// The rules as the map says now, and a hash that changes when the map or the projects change.
function rulesNow() {
  const c = cfg();
  const mapFiles = expandMaps(c.mapFiles, home);
  const texts = mapFiles.map((f) => fs.readFileSync(f, 'utf8'));
  const tools = discoverTools({ home, workRoot: cwd });
  const built = buildRules({
    rules: mapFiles.flatMap((f, i) => parseRules(texts[i], f)), cases: mapFiles.flatMap((f, i) => parseMap(texts[i], f)), tools, config: c,
  }, mapFiles);
  const hash = crypto.createHash('sha256').update(JSON.stringify([texts, c.projects])).digest('hex');
  return { built, hash, mapFiles };
}

const rulesPlanPath = path.join(stateDir, 'rules-plan.json');

function rulesPlan() {
  const { built, hash } = rulesNow();
  const plan = planRules({ home, built });
  console.log(`Critical rules: ${built.criticalCount}; tools with rules shown on use: ${Object.keys(built.index.rules).length}.`);
  for (const w of plan.write) console.log(`  write ${w.path} (${w.bytes} bytes)`);
  for (const r of plan.remove) console.log(`  remove ${r} (no longer in the map)`);
  for (const c of plan.conflicts) console.log(`  conflict: ${c} exists and was not written by Stockroom; it will not be touched`);
  if (built.warnings.length) console.log(`Warnings:\n  ${built.warnings.join('\n  ')}`);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(rulesPlanPath, JSON.stringify({ at: new Date().toISOString(), hash }));
  console.log('\nNothing has been changed. To apply: "stockroom rules apply" ("stockroom undo" removes the files).');
}

function rulesApply() {
  if (!fs.existsSync(rulesPlanPath)) throw new Error('No rules plan found: run "stockroom rules plan" first.');
  const { built, hash, mapFiles } = rulesNow();
  if (JSON.parse(fs.readFileSync(rulesPlanPath, 'utf8')).hash !== hash) {
    throw new Error('Not applied: the map changed since the plan; run "stockroom rules plan" again and check it.');
  }
  const { written } = writeRules({ home, built, mapFiles });
  fs.rmSync(rulesPlanPath);
  console.log(`Wrote ${written.length} files:\n  ${written.join('\n  ')}`);
  console.log('Claude Code loads them from the next session. The session-start hook keeps them in step with the map.');
}

async function catalog() {
  const c = cfg();
  if (flag('read-mcp') || c.readMcp) {
    const all = discoverTools({ home, workRoot: cwd }).filter((t) => t.kind === 'mcp-server');
    const servers = readableServers(all);
    const timeoutMs = Number(option('timeout')[0] ?? 10000);
    console.log(`Asking ${servers.length} MCP servers for their tools (up to ${timeoutMs / 1000} s each)...`);
    if (all.length > servers.length) {
      console.log(`  Not started: ${all.length - servers.length} turned off, remote, or from a project .mcp.json you have not approved.`);
    }
    const results = await readMcpAll(servers, { cachePath: path.join(stateDir, 'mcp-cache.json'), timeoutMs });
    for (const s of servers) {
      const r = results.get(serverKey(s));
      console.log(`  ${s.name}: ${r?.error ? `not read (${r.error})` : `${r?.tools.length ?? 0} tools`}`);
    }
  }
  const { tools } = regenerate({ home, workRoot: cwd, catalogDir: c.catalogDir, mapFiles: expandMaps(c.mapFiles, home),
    onPath: (n) => findOnPath(n), config: c });
  console.log(`Catalog written to ${c.catalogDir}: ${tools.length} tools.`);
}

function shelfPlan() {
  const c = cfg();
  if (!c.shelf) {
    console.log(`"shelf" is not set in ${configPath}: nothing would be turned off.`);
    console.log('Set it to "map" (keep the first tools of each case of your map), "usage" (what was not used in "days"),'
      + ' "list" or "none" (everything except "neverOff").');
    return;
  }
  const { r, off, on } = computeShelf(c);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(planPath, JSON.stringify({ at: new Date().toISOString(), shelf: c.shelf, off, on }, null, 2) + '\n');
  printShelf(c, r);
}

function computeShelf(c) {
  const tools = discoverTools({ home, workRoot: cwd });
  const counts = new Map();
  const usage = ['usage', 'map'].includes(c.shelf) || c.unmapped === 'usage'
    ? toolUsage({ home, days: Math.max(c.days, ...Object.values(c.sections).map((s) => s.days || 0)), counts }) : new Map();
  const cases = expandMaps(c.mapFiles, home).flatMap((f) => parseMap(fs.readFileSync(f, 'utf8'), f));
  const applied = readJson(path.join(stateDir, 'applied.json'), []);
  const r = planShelf({ tools, config: c, usage, counts, cases, applied, protectedNames: rulesNow().built.protected });
  const brief = ({ tool, via, key, value }) => ({ via, key, ...(value ? { value } : {}), kind: tool.kind, name: tool.name });
  return { r, off: r.off.map(brief), on: r.on.map(brief) };
}

function printShelf(c, r) {
  console.log(`Shelf "${c.shelf}"${c.shelf === 'usage' ? ` (last ${c.days} days)` : ''}: would turn off ${r.off.length}.`);
  for (const o of r.off) {
    console.log(`  ${o.via}: ${o.key}${o.value && o.value !== 'off' ? ` = ${o.value}` : ''}  (${o.tool.kind} ${o.tool.name}: ${o.reason})`);
  }
  if (r.on.length) {
    console.log(`\nWould turn back on (${r.on.length}), turned off earlier by Stockroom:`);
    for (const o of r.on) console.log(`  ${o.via}: ${o.key}  (${o.tool.kind} ${o.tool.name}: ${o.reason})`);
  }
  if (r.kept.length) {
    console.log(`\nKept on (${r.kept.length}), named by a critical rule in your map:`);
    for (const k of r.kept) console.log(`  ${k.tool.kind} ${k.tool.name}`);
  }
  if (r.cannot.length) {
    console.log(`\nStay on (${r.cannot.length}):`);
    for (const x of r.cannot) console.log(`  ${x.tool.name}: ${x.reason}`);
  }
  const conflicts = projectConflicts({ workRoot: cwd });
  if (conflicts.length) {
    console.log('\nThese project settings override the user file, so they may keep some of these on:');
    for (const f of conflicts) console.log(`  ${f}`);
  }
  console.log(`\nNothing has been changed. To apply: "stockroom shelf apply" (settings.json is backed up; "stockroom undo" reverts).`);
}

function shelfApply() {
  if (!fs.existsSync(planPath)) throw new Error('No plan found. Run "stockroom shelf plan" first.');
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const { backupPath, written } = applyShelf({ settingsPath, off: plan.off, stateDir });
  const on = plan.on?.length
    ? undoShelf({ settingsPath, stateDir, only: new Set(plan.on.map((o) => `${o.via}/${o.key}`)) }).restored : [];
  fs.rmSync(planPath);
  console.log(`Turned off ${written.length}${on.length ? ` and back on ${on.length}` : ''} in ${settingsPath}.`);
  if (backupPath) console.log(`Backup of the previous settings: ${backupPath}`);
  console.log('It takes effect in the next session. Everything stays in the catalog; "stockroom undo" reverts.');
}

// "auto": the session hook runs this in the background once a day: plan the shelf and apply it at once.
function autoShelf() {
  const c = cfg();
  if (!c.auto || !c.shelf) return;
  const { off, on } = computeShelf(c);
  const written = off.length ? applyShelf({ settingsPath, off, stateDir }).written : [];
  const back = on.length ? undoShelf({ settingsPath, stateDir, only: new Set(on.map((o) => `${o.via}/${o.key}`)) }).restored : [];
  const names = (list) => list.map((o) => o.key);
  const changed = written.length || back.length;
  const autoPath = path.join(stateDir, 'auto.json');
  fs.writeFileSync(autoPath, JSON.stringify({
    ...readJson(autoPath, {}), at: new Date().toISOString(), ...(changed ? { off: names(written), on: names(back), shown: false } : {}),
  }, null, 2) + '\n');
  if (changed) {
    fs.appendFileSync(path.join(stateDir, 'auto.log'), `${new Date().toISOString()} off (unused ${c.days} days): `
      + `${names(written).join(', ') || '-'}; on (used): ${names(back).join(', ') || '-'}\n`);
  }
}

function undo() {
  const { restored } = undoShelf({ settingsPath, stateDir });
  const { removed } = removeRules({ home });
  const lines = [...restored.map((r) => `${r.via}: ${r.key}`), ...removed.map((f) => `removed ${f}`)];
  console.log(lines.length ? `Undid ${lines.length} changes made by Stockroom:\n  ${lines.join('\n  ')}` : 'Nothing to undo.');
}

function mapInit() {
  const out = option('out')[0] || stateDir;
  const file = path.join(out, 'stockroom-map.md');
  if (fs.existsSync(file)) throw new Error(`${file} already exists. Nothing was written.`);
  const tools = discoverTools({ home, workRoot: cwd });
  const lines = ['# Tool map', '',
    'Which tool to prefer for each job. One row per job: list tools in backticks, preferred first. Edit freely:',
    'merge rows, rename cases, delete what you never use. Stockroom only reads tables with a "Tool" column.', ''];
  for (const k of KINDS.filter((x) => x !== 'hook')) {
    const of = tools.filter((t) => t.kind === k).sort((a, b) => a.name.localeCompare(b.name));
    if (!of.length) continue;
    lines.push(`## ${k}`, '', '| Case | Tool | Why |', '|---|---|---|');
    for (const t of of) lines.push(`| (when to use it) | ${k === 'mcp-server' ? 'MCP ' : ''}\`${t.name}\` |  |`);
    lines.push('');
  }
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(file, lines.join('\n'));
  console.log(`Wrote ${file}. Edit it, then add it to "mapFiles" in ${configPath}.`);
}

// map index [--out <file>]: the short index for an always-loaded rule file. Rewrites only its own earlier output.
function mapIndexCmd() {
  const c = cfg();
  const cases = expandMaps(c.mapFiles, home).flatMap((f) => parseMap(fs.readFileSync(f, 'utf8'), f));
  if (!cases.length) throw new Error(`No map configured: add your map files to "mapFiles" in ${configPath}.`);
  const file = option('out')[0] || path.join(stateDir, 'map-index.md');
  if (fs.existsSync(file) && !fs.readFileSync(file, 'utf8').startsWith('# Tool map (index)')) {
    throw new Error(`${file} exists and was not written by Stockroom. Nothing was written.`);
  }
  const text = mapIndex(cases, { catalogDir: c.catalogDir });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  console.log(`Wrote ${file}: ${Buffer.byteLength(text)} bytes for ${cases.length} cases (the full map stays in the catalog).`);
}

// The material Claude drafts a map section from, one group at a time (a plugin, a source repo, or an origin).
// Project tools group by the folder that holds their .claude, so each project is drafted on its own.
const projectOf = (t) => `project ${path.relative(cwd, t.path.split(/[\\/]\.claude[\\/]/)[0]).replace(/\\/g, '/') || '.'}`;
const groupOf = (t) => t.plugin || t.source?.repo || t.source?.package || t.source?.url
  || (t.origin === 'project' && t.path ? projectOf(t) : t.origin);

function mapDraftData() {
  const tools = discoverTools({ home, workRoot: cwd }).filter((t) => t.kind !== 'hook')
    .map((t) => ({ ...t, source: toolOrigin(t, { home }) }));
  const groups = new Map();
  for (const t of tools) groups.set(groupOf(t), [...(groups.get(groupOf(t)) || []), t]);
  const wanted = option('group');
  if (!wanted.length) {
    console.log(`Groups (${groups.size}). Draft one at a time with: map draft-data --group <name>`);
    for (const [g, of] of [...groups].sort((a, b) => b[1].length - a[1].length)) console.log(`  ${g}: ${of.length} tools`);
    return;
  }
  const missing = wanted.filter((g) => !groups.has(g));
  if (missing.length) throw new Error(`No group "${missing.join('", "')}". Groups: ${[...groups.keys()].join(', ')}`);

  const c = cfg();
  const cases = expandMaps(c.mapFiles, home).flatMap((f) => parseMap(fs.readFileSync(f, 'utf8'), f));
  const mcp = new Map(Object.entries(readJson(path.join(stateDir, 'mcp-cache.json'), {})));
  const rows = new Map();
  for (const cs of cases) {
    const hits = resolveRow(cs, tools, { mcp }).map((r) => r.hits);
    hits.forEach((h, i) => h.forEach((t) => rows.set(t, [...(rows.get(t) || []),
      `${cs.section || '(no section)'} › ${cs.title} (#${i + 1} of ${hits.length})`])));
  }
  const used = toolUsage({ home, days: c.days });
  const lastUse = (t) => [t.name, `mcp__${t.name}`, `mcp__plugin_${t.plugin}_${t.name}`]
    .map((k) => used.get(k)).find(Boolean)
    || (t.kind === 'plugin' ? Math.max(0, ...tools.filter((x) => x.plugin === t.name).map((x) => used.get(x.name) || 0)) : 0);

  for (const g of wanted) {
    const of = groups.get(g);
    // The group's source is the repository or package, not one skill's folder in it.
    const first = of.find((t) => t.source)?.source;
    const src = first && { ...first, path: undefined };
    console.log(`# Group ${g}: ${of.length} tools`);
    if (src) {
      const cached = readSource(home, src) !== null;
      console.log(`Official source: ${sourceLine(src)}`);
      console.log(cached ? `Cached copy: ${sourcePath(home, src)}`
        : `Not cached. Read it online only with the user's yes; save what you read to ${sourcePath(home, src)}`);
    }
    for (const t of of) {
      const at = lastUse(t);
      console.log([
        '', `### ${t.name}`,
        `- kind: ${t.kind} · status: ${t.enabled ? 'on' : 'off'}`,
        `- last used: ${at ? new Date(at).toISOString().slice(0, 10) : `not in the last ${c.days} days`}`,
        ...(rows.get(t) || []).map((r) => `- in the map: ${r}`),
        t.description,
      ].join('\n'));
    }
  }
}

function usage() {
  const days = Number(option('days')[0] ?? cfg().days);
  const used = [...toolUsage({ home, days })].sort((a, b) => b[1] - a[1]);
  console.log(`Tools used in the last ${days} days (main sessions only): ${used.length}`);
  for (const [name, at] of used) console.log(`  ${new Date(at).toISOString().slice(0, 10)}  ${name}`);
}

// e2e-grade <stream-json file> --expect <skill|none> [--catalog <dir>]
function e2eGrade() {
  const expect = option('expect')[0];
  const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
  const catalogDir = option('catalog')[0] || cfg().catalogDir;
  const r = gradeE2E(fs.readFileSync(file, 'utf8'), !expect || expect === 'none' ? null : expect, { catalogDir });
  console.log(`${r.pass ? 'PASS' : 'FAIL'} launched: ${r.skillsLaunched.join(', ') || 'none'}; `
    + `SKILL.md read: ${r.skillFilesRead.length}; catalog reads: ${r.catalogReads}`);
  process.exitCode = r.pass ? 0 : 1;
}

// One line per check; exit 1 if any problem. Catches a Claude Code or plugin change that breaks what Stockroom expects.
function doctor() {
  const rows = [];
  const ok = (what) => rows.push(`ok       ${what}`);
  const problem = (what) => rows.push(`problem: ${what}`);
  let c;
  try { c = cfg(); ok('config.json is valid'); } catch (e) { problem(e.message); }

  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const hooks = readJson(path.join(root, 'hooks', 'hooks.json'), {}).hooks || {};
  const pre = (hooks.PreToolUse || []).map((g) => g.matcher);
  if (hooks.SessionStart?.length && pre.includes('Skill') && pre.includes('Read')) ok('hooks registered (SessionStart, PreToolUse on Skill and SKILL.md reads)');
  else problem(`hooks.json in ${root} lacks SessionStart or the PreToolUse handlers; reinstall the plugin`);

  if (c) {
    const { built } = rulesNow();
    if (fs.existsSync(path.join(stateDir, 'rules-applied.json'))) {
      const stale = [...targets(home, built)].filter(([p, text]) => !fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== text);
      if (stale.length) for (const [p] of stale) problem(`${p} differs from the map; run "stockroom rules plan" then "rules apply", or edit the map`);
      else ok('generated rules match the map');
    } else ok('no generated rules (run "stockroom rules plan" to start)');
    for (const [name, globs] of Object.entries(c.projects)) {
      // shortcut: checks the folder before the first wildcard exists and is not empty; enough for "Folder/**" globs.
      const found = globs.some((g) => {
        const dir = path.join(cwd, g.split(/[*?[{]/)[0]);
        try { return fs.statSync(dir).isDirectory() ? fs.readdirSync(dir).length > 0 : true; } catch { return false; }
      });
      if (found) ok(`project "${name}" matches files`);
      else problem(`project "${name}" matches no files under ${cwd}; sessions must start in the folder its paths are relative to`);
    }
  }

  const t0 = Date.now();
  spawnSync(process.execPath, [path.join(root, 'bin', 'pretool.js')], { input: '{}' });
  ok(`PreToolUse hook start-up: ${Date.now() - t0} ms`);
  console.log(rows.join('\n'));
  if (rows.some((r) => r.startsWith('problem'))) process.exitCode = 1;
}

function reportCmd() {
  const c = cfg();
  const r = report({ home, days: Number(option('days')[0] || 7), mapFiles: expandMaps(c.mapFiles, home), catalogDir: c.catalogDir });
  if (flag('json')) { console.log(JSON.stringify(r, null, 2)); return; }
  const pct = r.totals.consulted ? ` (${Math.round((100 * r.totals.followed) / r.totals.consulted)} %)` : '';
  console.log(`Map reads: ${r.totals.reads}, followed by a tool they named: ${r.totals.readsFollowed}.`);
  console.log(`Map rows consulted: ${r.totals.consulted}, followed: ${r.totals.followed}${pct}.`);
  console.log(`Loaded in every session by Stockroom: ${r.alwaysLoadedBytes} bytes (critical rules file + hook line).`);
  for (const s of r.sessions.filter((x) => x.consulted.length || x.injected.length)) {
    const shown = s.injected.map((i) => `${i.tool} ×${i.count}`).join(', ');
    console.log(`  ${s.id}: consulted ${s.consulted.length}, followed ${s.consulted.filter((x) => x.followed).length}`
      + (shown ? `; rules shown for ${shown}` : ''));
  }
}

const commands = {
  status, check, catalog, undo, usage, auto: autoShelf, doctor, 'e2e-grade': e2eGrade, report: reportCmd,
  shelf: () => ({ plan: shelfPlan, apply: shelfApply }[args[0]] || fail)(),
  map: () => ({ init: mapInit, 'draft-data': mapDraftData, index: mapIndexCmd }[args[0]] || fail)(),
  rules: () => ({ plan: rulesPlan, apply: rulesApply }[args[0]] || fail)(),
};
function fail() {
  console.error('Usage: stockroom <status | check [--all] | catalog [--read-mcp] | shelf plan | shelf apply | rules plan | rules apply | undo |'
    + ' map init [--out <dir>] | map draft-data [--group <name>] | map index [--out <file>] | usage [--days N] | report [--days N] [--json] | doctor | e2e-grade <file> --expect <skill|none>>');
  process.exit(2);
}
if (!commands[cmd]) fail();
try {
  await commands[cmd]();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
