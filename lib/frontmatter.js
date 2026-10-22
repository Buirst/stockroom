// Minimal SKILL.md frontmatter reader: `key: value`, quotes, `>` and `|` blocks.
// Anything it can't read gives empty data, never an exception.

function unquote(raw) {
  const v = raw.trim();
  if (v.startsWith('"')) {
    if (v.length < 2 || !v.endsWith('"')) return undefined;
    return v.slice(1, -1).replace(/\\(["\\])/g, '$1').replace(/\\n/g, '\n');
  }
  if (v.startsWith("'")) {
    if (v.length < 2 || !v.endsWith("'")) return undefined;
    return v.slice(1, -1).replace(/''/g, "'");
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

function parseBlock(lines) {
  const data = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (/^\s/.test(line)) continue; // nested content of a key we keep as text or skip
    const m = line.match(/^([^:\s][^:]*):(?:\s(.*))?$/) || line.match(/^([^:\s][^:]*):$/);
    if (!m) return {};
    const key = m[1].trim();
    const raw = (m[2] ?? '').trim();

    // Indented lines that follow belong to this key.
    const cont = [];
    while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || !lines[i + 1].trim())) cont.push(lines[++i]);
    while (cont.length && !cont[cont.length - 1].trim()) cont.pop();

    if (/^[>|][+-]?$/.test(raw)) {
      const indent = Math.min(...cont.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length));
      const text = cont.map((l) => l.slice(indent));
      data[key] = raw[0] === '|'
        ? text.join('\n')
        : text.join('\n').split(/\n{2,}/).map((p) => p.split('\n').map((s) => s.trim()).join(' ')).join('\n');
    } else {
      const value = unquote(raw);
      if (value === undefined) return {};
      data[key] = typeof value === 'string' && cont.length
        ? [value, ...cont.map((l) => l.trim()).filter(Boolean)].join(' ').trim()
        : value;
    }
  }
  return data;
}

export function parseFrontmatter(text) {
  const t = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const m = t.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!m) return { data: {}, body: t };
  return { data: parseBlock(m[1].split('\n')), body: t.slice(m[0].length) };
}
