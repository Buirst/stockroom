// Renders brand-sheet.png, social-preview.png and app-icon.png in docs/brand/. Needs Playwright:
// node docs/brand/render.mjs   (BROWSER=<path to a Chromium-based browser> to use it instead of Playwright's own)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }

const svg = (f) => 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(here, f)).toString('base64');
const social = `<!doctype html><meta charset="utf-8"><style>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;800&display=swap');
* { margin: 0; } html, body { width: 1280px; height: 640px; background: #0f0e0d; color: #ece5d8; }
body { display: grid; place-content: center; justify-items: center; gap: 40px; font-family: 'JetBrains Mono', monospace; }
img { height: 150px; } h1 { font-size: 40px; font-weight: 800; letter-spacing: -.01em; }
p { font-size: 20px; color: #a39b90; }
</style><img src="${svg('lockup-dark.svg')}"><h1>Turned off is not gone.</h1>
<p>Install every tool you want. Claude still knows what each one is for.</p>`;

const browser = await pw.chromium.launch({ executablePath: process.env.BROWSER || undefined });
async function shot(html, file, width, height, full = false) {
  const page = await browser.newPage({ viewport: { width, height } });
  if (html.endsWith('.html')) await page.goto('file:///' + path.join(here, html).replace(/\\/g, '/'));
  else await page.setContent(html);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(here, file), fullPage: full, omitBackground: file === 'app-icon.png' });
  await page.close();
}
await shot('sheet.html', 'brand-sheet.png', 1600, 900, true);
await shot(social, 'social-preview.png', 1280, 640);
await shot(`<style>*{margin:0}html,body{background:transparent}</style><img src="${svg('app-icon.svg')}" width="512" height="512">`, 'app-icon.png', 512, 512);
await browser.close();
