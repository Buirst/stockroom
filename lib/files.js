// Small file helpers shared by every module: never throw on a missing or broken file.
import fs from 'node:fs';
import path from 'node:path';

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch {
    return fallback;
  }
}

export const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
export const subdirs = (p) => { try { return fs.readdirSync(p).filter((d) => isDir(path.join(p, d))); } catch { return []; } };

// Claude Code's folder: CLAUDE_CONFIG_DIR when set (absolute path), else ~/.claude.
export const claudeDir = (home, env = process.env) => env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');

// ~/.claude.json, or the one inside CLAUDE_CONFIG_DIR when that folder has one.
export function claudeJsonPath(home, env = process.env) {
  const inside = env.CLAUDE_CONFIG_DIR && path.join(env.CLAUDE_CONFIG_DIR, '.claude.json');
  return inside && fs.existsSync(inside) ? inside : path.join(home, '.claude.json');
}

// "Diseño y web" -> "diseno-y-web"; repeated names get -2, -3.
export function slugger() {
  const used = new Map();
  return (s) => {
    const base = (s || 'no-section').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'section';
    const n = (used.get(base) || 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
}

// Writes a file whole or not at all: a temp file beside it, then a rename. A hook can be killed at its timeout in the
// middle of a write, and a half-written settings.json would break Claude Code. On Windows the rename fails while
// another program holds the file (an antivirus, an editor), so it is tried a few times before giving up.
export function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // A settings.json kept as a link into a dotfiles folder stays a link: the file it points to is the one replaced.
  try { file = fs.realpathSync(file); } catch { /* not there yet: written where asked */ }
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { fs.rmSync(tmp, { force: true }); throw e; }
      pause(40 * (attempt + 1));
    }
  }
}

// Keeps the newest `keep` entries of a folder whose names start with `prefix` (dated names sort by age).
export function pruneOld(dir, prefix, keep) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.startsWith(prefix)).sort(); } catch { return; }
  for (const n of names.slice(0, Math.max(0, names.length - keep))) {
    try { fs.rmSync(path.join(dir, n), { recursive: true, force: true }); } catch { /* in use: next time */ }
  }
}

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Runs fn while holding a lock folder, so two Stockroom processes (hooks of two sessions, the daily run) never change
// the same files at once. A lock older than 15 s belongs to a process that died: it is taken over. If the lock cannot
// be had in about 4 s, fn does not run and this throws: better no change than a lost one.
export function withLock(dir, fn) {
  const lock = path.join(dir, 'lock');
  fs.mkdirSync(dir, { recursive: true });
  for (let waited = 0; ; waited += 25) {
    try { fs.mkdirSync(lock); break; } catch (e) {
      if (e.code !== 'EEXIST' && e.code !== 'EPERM') throw e;
      // Checked first, on every turn: a folder that cannot be written (EPERM for good) must end here, not spin.
      if (waited >= 4000) throw new Error('Stockroom is busy in another session; nothing was changed. Try again.');
      pause(25);
      let age = 0;
      try { age = Date.now() - fs.statSync(lock).mtimeMs; } catch { continue; } // released just now
      if (age > 15000) { try { fs.rmdirSync(lock); } catch { /* another process took it over */ } }
    }
  }
  try { return fn(); } finally { try { fs.rmdirSync(lock); } catch { /* already gone */ } }
}
