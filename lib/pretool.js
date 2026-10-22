// PreToolUse: when Claude uses a tool that has on-use rules in the map, give Claude those rules with the result.
// Reads only rules-index.json (written by "rules apply"); never decides permissions, never blocks.
const MAX = 500;

export const normPath = (p) => String(p).replace(/\\/g, '/').toLowerCase();

export function toolKey(input, index) {
  const name = input?.tool_name || '';
  const args = input?.tool_input || {};
  if (name === 'Skill') return args.skill || null;
  // MCP calls are not hooked: they are frequent, and each hook run costs a Node start-up (spec § 4.3, measured).
  if (name === 'Read') return index.paths?.[normPath(args.file_path || '')] || null;
  return null;
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

export function pretoolOutput(input, index) {
  const key = toolKey(input, index);
  const rules = key && index.rules?.[key];
  if (!rules?.length) return '';
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: pretoolText(key, rules) } });
}
