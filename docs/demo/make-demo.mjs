// Rebuilds docs/demo.gif: a sample home with invented tools, real Stockroom output, frames drawn by Playwright and
// joined by ffmpeg. node docs/demo/make-demo.mjs   (needs Playwright with its Chromium, and ffmpeg on PATH)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bin = (f) => path.join(root, 'bin', f);
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }

// --- 1. A sample home -------------------------------------------------------------------------------------------
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stockroom-demo-'));
const claude = path.join(home, '.claude');
const work = path.join(home, 'work', 'app');
const put = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
const skill = (name, d) => `---\nname: ${name}\ndescription: ${d}\n---\n\n# ${name}\n`;
const plugin = (name, skills) => {
  const dir = path.join(claude, 'plugins', 'cache', 'market', name, '1.0.0');
  put(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name }));
  for (const [s, d] of Object.entries(skills)) put(path.join(dir, 'skills', s, 'SKILL.md'), skill(s, d));
  return dir;
};
const plugins = {
  design: plugin('design', { critique: 'Critique a page: hierarchy, type, color, layout', palette: 'Build an accessible color palette' }),
  media: plugin('media', { 'add-captions': 'Transcribe a video and burn in captions, timed to the speech', trim: 'Cut silences from a video' }),
  deploy: plugin('deploy', { preview: 'Deploy a preview build and return its URL' }),
};
for (const [s, d] of Object.entries({
  debugging: 'Find the root cause of a failing test before fixing it',
  'release-notes': 'Write release notes from merged pull requests',
  'sql-tuning': 'Read a query plan and suggest indexes',
  'pitch-deck': 'Outline a ten-slide pitch deck',
})) put(path.join(claude, 'skills', s, 'SKILL.md'), skill(s, d));
put(path.join(claude, 'plugins', 'installed_plugins.json'), JSON.stringify({
  version: 2, plugins: Object.fromEntries(Object.entries(plugins).map(([n, p]) => [`${n}@market`, [{ scope: 'user', installPath: p }]])),
}));
put(path.join(claude, 'settings.json'), JSON.stringify({ enabledPlugins: { 'design@market': true, 'media@market': true, 'deploy@market': true } }));
fs.mkdirSync(path.join(work, '.git'), { recursive: true });

// Last week's use: debugging, design and deploy were used; media, sql-tuning, pitch-deck and release-notes were not.
const used = ['debugging', 'design:critique', 'deploy:preview'];
put(path.join(claude, 'projects', 'work-app', 's1.jsonl'), used.map((s, i) => JSON.stringify({
  timestamp: new Date(Date.now() - (i + 1) * 86400000).toISOString(),
  message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: s } }] },
})).join('\n') + '\n');

const map = path.join(claude, 'tool-map.md');
put(map, `## Video

| Case | Tool | Why |
|---|---|---|
| Burned-in captions | \`media:add-captions\` | Times captions to the speech |
| Cut silences | \`media:trim\` | Keeps the cuts on the beat |

## Rules

| Tool | Rule | Level |
|---|---|---|
| \`media:add-captions\` | Work on a copy; never overwrite the source video | on use |
| \`deploy:preview\` | Previews are public: ask before deploying client work | critical |
`);
put(path.join(claude, 'stockroom', 'config.json'), JSON.stringify({ shelf: 'usage', days: 30, auto: true, mapFiles: [map] }, null, 2));

// --- 2. Real Stockroom output ------------------------------------------------------------------------------------
const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: '' };
delete env.CLAUDE_CONFIG_DIR;
const run = (file, args, input = '') => spawnSync(process.execPath, [bin(file), ...args], { cwd: work, env, input, encoding: 'utf8' }).stdout;
const clean = (s) => s.split(home).join('~').replace(/\\/g, '/').replace(/\/\//g, '/').trimEnd();
const context = (json) => JSON.parse(json).hookSpecificOutput.additionalContext;

run('stockroom.js', ['catalog']);
run('stockroom.js', ['rules', 'plan']);
run('stockroom.js', ['rules', 'apply']);
const status = clean(run('stockroom.js', ['status'])).split('\n').filter((l) => !/^Catalog:|\b0 on\s+0 off|permission/.test(l));
const plan = clean(run('stockroom.js', ['shelf', 'plan'])).split('\n').filter((l) => /would turn off|^\s+(skillOverrides|enabledPlugins):/.test(l));
run('stockroom.js', ['auto']);
const start = clean(context(run('stockroom.js', ['hook'], JSON.stringify({ cwd: work, session_id: 'demo' }))));
const index = path.join(claude, 'stockroom', 'catalog', 'by-function.md');
const hit = clean(fs.readFileSync(index, 'utf8').split('\n').find((l) => l.includes('add-captions')));
const skillMd = path.join(plugins.media, 'skills', 'add-captions', 'SKILL.md');
const onRead = clean(context(run('pretool.js', [], JSON.stringify({ session_id: 'demo', tool_name: 'Read', tool_input: { file_path: skillMd } }))));
const t = (text, c = '') => ({ text, c });

const scenes = [
  [t('> /stockroom', 'you'), ...status.map((l) => t(l)), t(''), t('> /stockroom shelf plan', 'you'), ...plan.map((l) => t(l, /would/.test(l) ? '' : 'off'))],
  [t(`SessionStart hook › ${start}`, 'hook'), t(''), t('> Add burned-in captions to demo.mp4', 'you'), t(`● Grep("captions", ${clean(index)})`, 'tool'), t(hit, 'off'),
    t(`● Read(${clean(skillMd)})`, 'tool'), t(`PreToolUse hook › ${onRead}`, 'hook'),
    t('● media is off, but its add-captions skill covers this. Following its SKILL.md on a copy of demo.mp4,', 'say'),
    t('  instead of writing a caption script from scratch.', 'say')],
];
fs.rmSync(home, { recursive: true, force: true });

// --- 3. Frames ---------------------------------------------------------------------------------------------------
const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'stockroom-frames-'));
const css = `* { box-sizing: border-box; margin: 0 } body { background: #0f1117; }
#t { width: 960px; height: 400px; padding: 14px 22px; font: 13.5px/1.55 'Cascadia Mono', Consolas, monospace; color: #d6d9e0; background: #0f1117; overflow: hidden }
.bar { color: #8a909c; padding-bottom: 8px; margin-bottom: 10px; border-bottom: 1px solid #262a33 }
p { white-space: pre-wrap; word-break: break-word } .you { color: #fff; font-weight: 700 } .tool { color: #6cb6ff }
.off { color: #ff8a65 } .hook { color: #8a909c } .say { color: #d6d9e0 } .on { color: #7ee0a3 }`;
const browser = await pw.chromium.launch({ executablePath: process.env.BROWSER || undefined }); // BROWSER=<Chromium-based browser>, e.g. Brave;
const tab = await browser.newPage({ viewport: { width: 960, height: 400 } });
await tab.setContent(`<style>${css}</style><div id="t"></div>`);
let n = 0;
const shot = async (lines, typed = null) => {
  await tab.evaluate(({ lines, typed }) => {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const hl = (s) => esc(s).replace(/(back on from the next session)/g, '<span class="on">$1</span>').replace(/(turned off for lack of use)/g, '<span class="off">$1</span>');
    document.getElementById('t').innerHTML = '<div class="bar">Claude Code · ~/work/app</div>'
      + lines.map((l, i) => `<p class="${l.c}">${hl(i === lines.length - 1 && typed !== null ? l.text.slice(0, typed) : l.text) || '&nbsp;'}</p>`).join('');
  }, { lines, typed });
  await tab.screenshot({ path: path.join(frames, `f${String(n++).padStart(4, '0')}.png`) });
};
for (const scene of scenes) {
  const shown = [];
  for (const line of scene) {
    shown.push(line);
    if (line.c === 'you') for (let k = 0; k <= line.text.length; k += 3) await shot(shown, k);
    else for (let k = 0; k < (line.c === 'hook' ? 4 : 2); k++) await shot(shown);
  }
  for (let k = 0; k < 40; k++) await shot(shown);
}
await browser.close();

// --- 4. GIF --------------------------------------------------------------------------------------------------------
const gif = path.join(root, 'docs', 'demo.gif');
execSync(`ffmpeg -v error -y -framerate 10 -i "${path.join(frames, 'f%04d.png')}" -vf "split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=none" "${gif}"`);
fs.rmSync(frames, { recursive: true, force: true });
console.log(`${gif}: ${n} frames, ${Math.round(fs.statSync(gif).size / 1024)} KB`);
