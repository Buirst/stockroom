// PreToolUse: when Claude uses a tool that has on-use rules in the map, give Claude those rules with the result.
// Reads only rules-index.json (written by "rules apply"); never decides permissions, never blocks.
const MAX = 500;

export const normPath = (p) => String(p).replace(/\\/g, '/').toLowerCase();

// Paths as a shell writes them: ~, $HOME, $env:USERPROFILE and Git Bash's /c/ become the real folder.
export const expandHome = (text, home) => String(text)
  .replace(/(^|[\s"'`=(])(?:~|\$\{?HOME\}?|\$env:USERPROFILE)(?=[\\/])/gi, (_, pre) => pre + home)
  .replace(/(^|[\s"'`=(])\/([a-z])\//gi, (_, pre, drive) => `${pre}${drive}:/`);

// The SKILL.md files a tool call reads: Read by its path, a shell command (cat, sed, Get-Content) by the paths it names.
export function skillReads(input, home) {
  const args = input?.tool_input || {};
  if (input?.tool_name === 'Read') return /(^|[\\/])SKILL\.md$/i.test(args.file_path || '') ? [normPath(args.file_path)] : [];
  if (!['Bash', 'PowerShell'].includes(input?.tool_name)) return [];
  return [...normPath(expandHome(args.command || '', home)).matchAll(/[^\s"'`;|&<>()]+\/skill\.md/g)].map(([p]) => p);
}

export function toolKey(input, index, home = '') {
  const name = input?.tool_name || '';
  const args = input?.tool_input || {};
  if (name === 'Skill') return args.skill || null;
  // MCP calls are not hooked: they are frequent, and each hook run costs a Node start-up (spec § 4.3, measured).
  for (const p of skillReads(input, home)) if (index.paths?.[p]) return index.paths[p];
  return null;
}

// "auto": the applied.json records a SKILL.md read belongs to: the skill itself, or the plugin that holds it.
export function wakeIds(filePath, applied) {
  const p = normPath(filePath);
  if (!p.endsWith('/skill.md')) return [];
  return applied.filter(({ via, key }) => {
    const k = String(key).toLowerCase();
    if (via === 'skillOverrides') return !p.includes('/plugins/cache/') && p.endsWith(`/skills/${k}/skill.md`);
    if (via !== 'enabledPlugins') return false;
    const [plugin, market] = k.split('@');
    return p.includes(`/plugins/cache/${market}/${plugin}/`);
  }).map(({ via, key }) => `${via}/${key}`);
}

export function pretoolText(key, rules) {
  const head = `Stockroom rules for ${key}: `;
  let text = head + rules.join('; ');
  if (text.length <= MAX) return text;
  for (let n = rules.length - 1; n >= 1; n--) {
    text = `${head}${rules.slice(0, n).join('; ')}…(${rules.length - n} more in the catalog)`;
    if (text.length <= MAX) return text;
  }
  return `Stockroom rules for ${key}: ${rules.length} rules, too long to show here; read them in the catalog.`;
}

export function pretoolOutput(input, index, home = '') {
  const key = toolKey(input, index, home);
  const rules = key && index.rules?.[key];
  if (!rules?.length) return '';
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: pretoolText(key, rules) } });
}
