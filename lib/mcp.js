// Asks MCP servers for their instructions and tool descriptions (stdio only), on demand, with a cache.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { readJson } from './files.js';

const PROTOCOL = '2025-06-18';
const win = process.platform === 'win32';

export const serverKey = (tool) => {
  const { command, args, url } = tool.server || {};
  return crypto.createHash('sha1').update(JSON.stringify([command ?? null, args ?? [], url ?? null])).digest('hex');
};

// ${VAR} and ${VAR:-default}, as Claude Code expands them in MCP configs; plus ${CLAUDE_PLUGIN_ROOT}.
function expand(value, vars) {
  return typeof value === 'string'
    ? value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (m, name, def) => vars[name] ?? def ?? m)
    : value;
}

const quote = (s) => (/[\s"&|<>^()%!]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

function start(command, args, opts) {
  // cmd.exe runs .cmd shims (npx, uvx) that a plain spawn cannot.
  if (!win) return spawn(command, args, opts);
  const line = [command, ...args].map(quote).join(' ');
  return spawn('cmd.exe', ['/d', '/s', '/c', `"${line}"`], { ...opts, windowsVerbatimArguments: true });
}

function kill(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (win) execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
  else child.kill('SIGKILL');
}

export function readMcpServer(tool, { timeoutMs = 10000 } = {}) {
  const s = tool.server || {};
  if (!s.command || (s.type && s.type !== 'stdio')) return Promise.resolve({ error: 'remote server: not read in v1' });

  const vars = { ...process.env, ...(tool.pluginRoot ? { CLAUDE_PLUGIN_ROOT: tool.pluginRoot } : {}) };
  const env = { ...process.env };
  for (const [k, v] of Object.entries(s.env || {})) env[k] = expand(String(v), vars);
  const base = tool.pluginRoot || process.cwd();
  const cwd = path.resolve(base, expand(s.cwd || '.', vars));

  return new Promise((resolve) => {
    let child;
    let done = false;
    let stderr = '';
    const pending = new Map();
    let nextId = 1;

    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (child) kill(child);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ error: `timed out after ${timeoutMs} ms` }), timeoutMs);

    try {
      child = start(expand(s.command, vars), (s.args || []).map((a) => expand(String(a), vars)),
        { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      return finish({ error: `could not start: ${e.message}` });
    }
    child.on('error', (e) => finish({ error: `could not start: ${e.message}` }));
    child.on('exit', (code) =>
      finish({ error: `exited with code ${code}${stderr ? `: ${stderr.trim().split('\n').slice(-3).join(' | ')}` : ''}` }));
    child.stdin.on('error', () => {});
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });

    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        let msg;
        try { msg = JSON.parse(line); } catch { continue; } // servers may log to stdout
        const p = pending.get(msg.id);
        if (p) { pending.delete(msg.id); p(msg); }
      }
    });

    const send = (msg) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
    const request = (method, params) => new Promise((ok) => {
      const id = nextId++;
      pending.set(id, ok);
      send({ id, method, params });
    });

    (async () => {
      const init = await request('initialize', {
        protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'stockroom', version: '1' },
      });
      if (init.error) return finish({ error: `initialize: ${init.error.message}` });
      send({ method: 'notifications/initialized' });
      const tools = [];
      let cursor;
      do {
        const page = await request('tools/list', cursor ? { cursor } : {});
        if (page.error) return finish({ error: `tools/list: ${page.error.message}` });
        for (const t of page.result?.tools || []) tools.push({ name: t.name, description: t.description ?? '' });
        cursor = page.result?.nextCursor;
      } while (cursor);
      finish({ instructions: init.result?.instructions ?? '', tools });
    })().catch((e) => finish({ error: e.message }));
  });
}

// The servers it is safe to start: turned on, a local command, and (from a project .mcp.json) approved by the user.
export const readableServers = (tools) => tools.filter((t) => t.kind === 'mcp-server' && t.enabled
  && t.approved !== false && t.server?.command && (!t.server.type || t.server.type === 'stdio'));

// Reads several servers, at most 4 at a time. Successes are cached by serverKey; failures are retried next time.
export async function readMcpAll(servers, { cachePath, timeoutMs } = {}) {
  const cache = cachePath ? readJson(cachePath, {}) : {};
  const results = new Map();
  const todo = [];
  for (const s of servers) {
    const key = serverKey(s);
    if (cache[key] && !cache[key].error) results.set(key, cache[key]);
    else if (!todo.some((t) => serverKey(t) === key)) todo.push(s);
  }
  const queue = [...todo];
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const s = queue.shift();
      const r = await readMcpServer(s, { timeoutMs });
      results.set(serverKey(s), r);
      if (!r.error) cache[serverKey(s)] = r;
    }
  }));
  if (cachePath && todo.length) {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const tmp = `${cachePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
    fs.renameSync(tmp, cachePath);
  }
  return results;
}
