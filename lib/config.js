// Stockroom's own settings: ~/.claude/stockroom/config.json, every key optional.
import fs from 'node:fs';
import path from 'node:path';
import { claudeDir } from './files.js';

export function checkNode(version) {
  return Number(String(version).split('.')[0]) >= 18
    ? null
    : `Stockroom needs Node.js 18 or newer (found ${version}).`;
}

const SHELVES = [null, 'none', 'usage', 'list', 'map'];
const UNMAPPED = ['keep', 'usage', 'off'];
const SECTION_KEYS = ['keep', 'days', 'order'];
const positive = (v) => typeof v === 'number' && v > 0;
const validSection = (r) => r && typeof r === 'object' && Object.keys(r).every((k) => SECTION_KEYS.includes(k))
  && (r.keep === undefined || (Number.isInteger(r.keep) && r.keep > 0)) && (r.days === undefined || positive(r.days))
  && (r.order === undefined || strings(r.order));
const strings = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');
const expandHome = (p, home) => (p.startsWith('~') ? path.join(home, p.slice(1)) : p);

export function loadConfig(home) {
  const file = path.join(claudeDir(home), 'stockroom', 'config.json');
  let user = {};
  if (fs.existsSync(file)) {
    try {
      user = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    } catch (e) {
      throw new Error(`${file}: config.json is not valid JSON (${e.message}).`);
    }
  }
  const c = {
    shelf: null, days: 30, list: [], neverOff: [], mapFiles: [], readMcp: false,
    keep: 1, unmapped: 'keep', alwaysOff: [], sections: {}, offAs: 'off', projects: {}, auto: false,
    catalogDir: path.join(claudeDir(home), 'stockroom', 'catalog'),
    ...user,
  };
  const bad = (key, allowed) => new Error(`${file}: "${key}" must be ${allowed} (found ${JSON.stringify(c[key])}).`);
  if (!SHELVES.includes(c.shelf)) throw bad('shelf', 'one of null, "none", "usage", "list", "map"');
  if (!positive(c.days)) throw bad('days', 'a number of days above 0');
  if (!(Number.isInteger(c.keep) && c.keep > 0)) throw bad('keep', 'a whole number above 0');
  if (c.keepTop != null && !(Number.isInteger(c.keepTop) && c.keepTop > 0)) throw bad('keepTop', 'a whole number above 0, or null');
  if (!UNMAPPED.includes(c.unmapped)) throw bad('unmapped', 'one of "keep", "usage", "off"');
  for (const key of ['list', 'neverOff', 'mapFiles', 'alwaysOff']) if (!strings(c[key])) throw bad(key, 'a list of names or patterns');
  if (!(c.sections && typeof c.sections === 'object' && !Array.isArray(c.sections) && Object.values(c.sections).every(validSection))) {
    throw bad('sections', 'an object of { "<map heading or pattern>": { "keep": 2, "days": 60, "order": ["name"] } }');
  }
  if (!['off', 'name-only'].includes(c.offAs)) throw bad('offAs', '"off" or "name-only"');
  if (typeof c.auto !== 'boolean') throw bad('auto', 'true or false');
  if (!(c.projects && typeof c.projects === 'object' && !Array.isArray(c.projects)
    && Object.entries(c.projects).every(([k, v]) => k.trim() && strings(v)))) {
    throw bad('projects', 'an object of { "<name>": ["<glob>", …] }');
  }
  if (typeof c.readMcp !== 'boolean') throw bad('readMcp', 'true or false');
  if (typeof c.catalogDir !== 'string') throw bad('catalogDir', 'a folder path');
  c.catalogDir = expandHome(c.catalogDir, home);
  c.mapFiles = c.mapFiles.map((p) => expandHome(p, home));
  return c;
}
