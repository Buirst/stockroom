// Builds a fake home directory with a ~/.claude tree for tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function put(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const skill = (name, description, extra = '') =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n# ${name}\n`;

export function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'compass-home-'));
  const claude = path.join(home, '.claude');
  const skills = path.join(claude, 'skills');

  put(path.join(skills, 'debugging', 'SKILL.md'),
    skill('debugging', 'Use when a test fails or a bug appears, to find the root cause before fixing'));
  put(path.join(skills, 'quiet', 'SKILL.md'), skill('quiet', 'Write release notes for a changelog'));
  put(path.join(skills, 'hidden', 'SKILL.md'), skill('hidden', 'Debug failing tests in hidden mode'));
  put(path.join(skills, 'uonly', 'SKILL.md'), skill('uonly', 'Debug failing tests for the user only'));
  put(path.join(skills, 'manual', 'SKILL.md'),
    skill('manual', 'Debug failing tests manually', 'disable-model-invocation: true\n'));
  put(path.join(skills, 'nodesc', 'SKILL.md'), '---\nname: nodesc\n---\nbody\n');
  put(path.join(skills, 'synced', 'acct', 'manifest.json'), '{"skills":[]}');
  put(path.join(skills, 'synced', 'acct', 'pdf', 'SKILL.md'),
    skill('pdf', 'Read, merge and fill PDF files', 'when_to_use: when the user mentions a .pdf file\n'));

  const tools = path.join(claude, 'plugins', 'cache', 'mk', 'tools', '1.0.0');
  put(path.join(tools, 'skills', 'design-critique', 'SKILL.md'),
    skill('design-critique', 'Critique a web page design: hierarchy, typography, color and layout'));
  put(path.join(tools, 'extra', 'deploy', 'SKILL.md'),
    skill('deploy', 'Deploy a static website to a hosting provider'));
  put(path.join(tools, 'commands', 'watch.md'), '---\ndescription: Watch a video and answer questions about it\n---\nRun it.\n');
  put(path.join(tools, 'commands', 'secret.md'), '---\ndescription: Internal command\ndisable-model-invocation: true\n---\n');
  put(path.join(tools, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'tools', skills: ['./extra'] }));

  const off = path.join(claude, 'plugins', 'cache', 'mk', 'off', '1.0.0');
  put(path.join(off, 'skills', 'video', 'SKILL.md'), skill('video', 'Edit a video and add captions'));

  put(path.join(claude, 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'tools@mk': [{ scope: 'user', installPath: tools }],
      'off@mk': [{ scope: 'user', installPath: off }],
    },
  }));
  put(path.join(claude, 'settings.json'), JSON.stringify({
    enabledPlugins: { 'tools@mk': true, 'off@mk': false },
    skillOverrides: { hidden: 'off', uonly: 'user-invocable-only', quiet: 'name-only' },
  }));

  // A project inside a git repo, with skills at the repo root and in a subfolder.
  const repo = path.join(home, 'work', 'repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  put(path.join(repo, '.claude', 'skills', 'migrate', 'SKILL.md'),
    skill('migrate', 'Plan a database schema migration'));
  put(path.join(repo, 'app', '.claude', 'skills', 'lint', 'SKILL.md'), skill('lint', 'Run the linter on the app'));
  // Above the repo root: must not be picked up.
  put(path.join(home, 'work', '.claude', 'skills', 'outside', 'SKILL.md'), skill('outside', 'Outside the repo'));

  return { home, projectDir: path.join(repo, 'app') };
}

// makeHome plus every other kind of tool: agents, MCP servers, hooks, a second repo, name clashes, a broken skill.
export function makeToolsHome() {
  const { home, projectDir } = makeHome();
  const claude = path.join(home, '.claude');
  const tools = path.join(claude, 'plugins', 'cache', 'mk', 'tools', '1.0.0');
  const off = path.join(claude, 'plugins', 'cache', 'mk', 'off', '1.0.0');
  const work = path.join(home, 'work');

  put(path.join(tools, 'agents', 'reviewer.md'),
    '---\nname: reviewer\ndescription: |\n  Reviews a diff.\n  Ünïcode ✓ and two lines.\n---\nPrompt.\n');
  put(path.join(tools, '.mcp.json'), JSON.stringify({ mcpServers: { docs: { command: 'node', args: ['docs.js'] } } }));
  put(path.join(tools, 'hooks', 'hooks.json'), JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node start.js' }] }] },
  }));
  put(path.join(off, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name: 'off', description: 'Video editing tools',
    mcpServers: { cutter: { type: 'http', url: 'https://example.test/mcp' } },
  }));
  put(path.join(off, 'agents', 'editor.md'), '---\ndescription: Edits videos\n---\n');

  put(path.join(claude, 'agents', 'helper.md'), '---\nname: helper\ndescription: Helps with chores\n---\n');
  put(path.join(claude, 'skills', 'design-critique', 'SKILL.md'), skill('design-critique', 'My own design critique'));
  fs.mkdirSync(path.join(claude, 'skills', 'broken', 'SKILL.md'), { recursive: true }); // unreadable: a folder

  const settings = JSON.parse(fs.readFileSync(path.join(claude, 'settings.json'), 'utf8'));
  put(path.join(claude, 'settings.json'), JSON.stringify({
    ...settings,
    deniedMcpServers: [{ serverName: 'old' }],
    hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'echo bye' }] }] },
  }));

  const repo = path.join(work, 'repo');
  put(path.join(home, '.claude.json'), JSON.stringify({
    mcpServers: { fs: { command: 'node', args: ['fs.js'], env: { A: '1' } }, old: { command: 'old' } },
    projects: { [repo]: { mcpServers: { fs: { command: 'node', args: ['fs2.js'] } } } },
  }));
  put(path.join(repo, '.mcp.json'), JSON.stringify({ mcpServers: { web: { type: 'http', url: 'https://web.test' } } }));
  put(path.join(repo, '.claude', 'settings.local.json'), JSON.stringify({ disabledMcpjsonServers: ['web'] }));

  const other = path.join(work, 'other');
  fs.mkdirSync(path.join(other, '.git'), { recursive: true });
  put(path.join(other, '.claude', 'skills', 'x', 'SKILL.md'), skill('x', 'Skill of the second repo'));
  put(path.join(other, '.claude', 'skills', 'debugging', 'SKILL.md'), skill('debugging', 'Project debugging'));
  put(path.join(other, '.claude', 'agents', 'proj-agent.md'), '---\ndescription: Project agent\n---\n');
  put(path.join(other, 'node_modules', 'pkg', '.claude', 'skills', 'nm', 'SKILL.md'), skill('nm', 'Inside node_modules'));

  return { home, projectDir, workRoot: work, repo, other };
}
