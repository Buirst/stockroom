// Renders the README charts from data.json to docs/assets/*.png. Needs Playwright with its Chromium:
// node docs/charts/render.mjs   (it finds a local or global "playwright" package)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'assets');
const data = JSON.parse(fs.readFileSync(path.join(here, 'data.json'), 'utf8'));
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const num = (n) => n.toLocaleString('en-US');
const title = ([a, hot, b]) => `<h1>${esc(a)}<span class="hot">${esc(hot)}</span>${esc(b)}</h1>`;

const css = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&display=swap');
* { box-sizing: border-box; margin: 0; }
body { background: transparent; font-family: 'JetBrains Mono', 'Cascadia Mono', monospace; color: #ece5d8; }
.card { width: 880px; padding: 44px 44px 36px; background: #0f0e0d; border: 1px solid #262220; border-radius: 22px; }
.eyebrow { font-size: 12.5px; letter-spacing: .32em; text-transform: uppercase; color: #8d857b; }
h1 { font-size: 34px; line-height: 1.22; font-weight: 800; margin: 14px 0 10px; letter-spacing: -.01em; }
.hot { background: linear-gradient(90deg, #7ee0c3, #f4c56a); -webkit-background-clip: text; background-clip: text; color: transparent; }
.sub { font-size: 13.5px; line-height: 1.55; color: #a39b90; max-width: 720px; }
.rows { margin: 30px 0 10px; display: grid; gap: 14px; }
.row { display: grid; grid-template-columns: 200px 1fr; align-items: center; gap: 18px; }
.label { font-size: 15px; font-weight: 500; text-align: right; color: #d9d1c4; line-height: 1.35; }
.track { position: relative; display: flex; align-items: center; gap: 12px; }
.bar { height: 22px; border-radius: 4px; background: #4a433e; min-width: 4px; }
.bar.hero { background: linear-gradient(90deg, #7ee0c3, #f4c56a); box-shadow: 0 0 22px rgba(126, 224, 195, .18); }
.val { font-size: 14px; color: #a39b90; white-space: nowrap; }
.val.hero { color: #ece5d8; font-weight: 700; }
.note { color: #8d857b; font-weight: 400; }
.group { display: grid; grid-template-columns: 200px 1fr; gap: 18px; align-items: center; }
.pair { display: grid; gap: 6px; }
.legend { display: flex; gap: 24px; margin-top: 22px; font-size: 13px; color: #a39b90; }
.legend i { display: inline-block; width: 14px; height: 14px; border-radius: 3px; vertical-align: -2px; margin-right: 8px; background: #4a433e; }
.legend i.hero { background: linear-gradient(135deg, #7ee0c3, #f4c56a); }
.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 28px 0 6px; }
.tile { border: 1px solid #262220; border-radius: 14px; padding: 22px 22px 20px; background: #141210; }
.tile b { display: block; font-size: 34px; font-weight: 800; }
.tile span { display: block; margin-top: 8px; font-size: 13.5px; line-height: 1.5; color: #a39b90; }
.foot { margin-top: 26px; font-size: 12.5px; line-height: 1.6; color: #8d857b; }
`;

const page = (body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div class="card">${body}</div>`;
function bars(d, W = 520) { // W: longest bar in px
  const rows = d.rows.map((r) => {
    const w = Math.max(4, Math.round((W * r.value) / r.of));
    return `<div class="row"><div class="label">${esc(r.label)}</div><div class="track">
      <div class="bar${r.hero ? ' hero' : ''}" style="width:${w}px"></div>
      <div class="val${r.hero ? ' hero' : ''}">${r.value}/${r.of}${r.note ? ` <span class="note">· ${esc(r.note)}</span>` : ''}</div></div></div>`;
  }).join('');
  return page(`<div class="eyebrow">${esc(d.eyebrow)}</div>${title(d.title)}${d.subtitle ? `<p class="sub">${esc(d.subtitle)}</p>` : ''}
    <div class="rows">${rows}</div><p class="foot">${esc(d.footer)}</p>`);
}

function context(d, W = 400) {
  const groups = d.groups.map((g) => {
    const pct = Math.round((100 * g.after) / g.before);
    return `<div class="group"><div class="label">${g.label.map(esc).join('<br>')}</div><div class="pair">
      <div class="track"><div class="bar" style="width:${W}px"></div><div class="val">100% · ${num(g.before)} ${esc(g.unit)}</div></div>
      <div class="track"><div class="bar hero" style="width:${Math.max(4, Math.round((W * g.after) / g.before))}px"></div>
        <div class="val hero">${pct}% · ${num(g.after)} <span class="note">· −${100 - pct}%</span></div></div></div></div>`;
  }).join('');
  return page(`<div class="eyebrow">${esc(d.eyebrow)}</div>${title(d.title)}<div class="rows" style="gap:26px">${groups}</div>
    <div class="legend"><span><i></i>${esc(d.legend[0])}</span><span><i class="hero"></i>${esc(d.legend[1])}</span></div>
    <p class="foot">${esc(d.footer)}</p>`);
}

function speed(d) {
  const tiles = d.tiles.map((t) => `<div class="tile"><b class="hot">${esc(t.value)}</b><span>${esc(t.label)}</span></div>`).join('');
  return page(`<div class="eyebrow">${esc(d.eyebrow)}</div>${title(d.title)}<div class="tiles">${tiles}</div><p class="foot">${esc(d.footer)}</p>`);
}

const charts = { versions: bars(data.versions), scorecard: bars(data.scorecard, 380), context: context(data.context), speed: speed(data.speed) };
fs.mkdirSync(out, { recursive: true });
const browser = await pw.chromium.launch();
const tab = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 960, height: 800 } });
for (const [name, html] of Object.entries(charts)) {
  await tab.setContent(html, { waitUntil: 'networkidle' });
  await tab.evaluate(() => document.fonts.ready);
  await tab.locator('.card').screenshot({ path: path.join(out, `${name}.png`), omitBackground: true });
  console.log(`${name}.png`);
}
await browser.close();
