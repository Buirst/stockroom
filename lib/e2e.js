// Grades one `claude -p --output-format stream-json` run: skills launched, SKILL.md files read, catalog reads.
// A skill counts as used if launched with Skill or if its SKILL.md was read (the way a turned-off skill is used).
const norm = (s) => String(s).replace(/\\\\/g, '/').replace(/\\/g, '/').toLowerCase();

export function gradeE2E(streamJsonText, expect, { catalogDir = 'stockroom/catalog' } = {}) {
  const catalog = norm(catalogDir);
  const skillsLaunched = [];
  const skillFilesRead = [];
  let catalogReads = 0;
  for (const text of String(streamJsonText).split('\n')) {
    let line;
    try { line = JSON.parse(text); } catch { continue; }
    if (line.type !== 'assistant' || !Array.isArray(line.message?.content)) continue;
    for (const b of line.message.content) {
      if (b.type !== 'tool_use') continue;
      if (b.name === 'Skill' && b.input?.skill) skillsLaunched.push(b.input.skill);
      if (!['Read', 'Grep', 'Glob', 'Bash', 'PowerShell'].includes(b.name)) continue;
      const input = norm(JSON.stringify(b.input || {}));
      if (input.includes(catalog)) catalogReads++;
      if (b.name === 'Read' && /(^|\/)skill\.md$/.test(norm(b.input?.file_path || ''))) skillFilesRead.push(b.input.file_path);
      // A shell command can read a SKILL.md too (cat, sed, Get-Content).
      if (['Bash', 'PowerShell'].includes(b.name)) {
        for (const [p] of norm(b.input?.command || '').matchAll(/[^\s"'`;|&]+\/skill\.md/g)) skillFilesRead.push(p);
      }
    }
  }
  const folder = expect ? `/${norm(expect.split(':').pop())}/skill.md` : null;
  const pass = expect == null
    ? !skillsLaunched.length && !skillFilesRead.length && !catalogReads
    : skillsLaunched.includes(expect) || skillFilesRead.some((f) => norm(f).endsWith(folder));
  return { pass, skillsLaunched, skillFilesRead, catalogReads };
}
