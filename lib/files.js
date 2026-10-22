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
