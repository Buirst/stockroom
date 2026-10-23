// A one-time reminder for sessions that plan or search without looking at the user's tool map.
// Measured: in the misses of the real test, Claude never opened the map at all (it searched the disk or the web).
import os from 'node:os';
import { expandHome, normPath } from './pretool.js';

// True when any tool call of the transcript names the catalog folder (by-function.md, skills.md…).
export function consultedMap(transcriptText, catalogDir, home = os.homedir()) {
  const cat = normPath(catalogDir);
  for (const text of String(transcriptText).split('\n')) {
    if (!text.includes('tool_use')) continue;
    let line;
    try { line = JSON.parse(text); } catch { continue; }
    for (const b of line.message?.content || []) {
      if (b.type === 'tool_use' && normPath(expandHome(JSON.stringify(b.input || {}), home)).replace(/\/\//g, '/').includes(cat.replace(/^([a-z]):/, ''))) return true;
    }
  }
  return false;
}

export const nudgeText = (index) => `Stockroom: this session has not checked the tool map yet. Before you finish, grep ${index} `
  + 'for this job and read the SKILL.md of the tool it names, even one marked "off: read <path>" (it works now through '
  + 'that file); build the plan on it, not just its name.';
