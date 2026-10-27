// Reads Claude Code's local session files and reduces each session to an
// allowlisted set of metadata. Prompt text, tool inputs and tool outputs are
// never copied out of the transcript.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { readPrompt } from './report.js';

export const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');

// Bash/PowerShell show up in almost every session, so other kinds of work
// carry more weight per call when picking the dominant one.
const TOOL_GROUPS = {
  build: { weight: 4, tools: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'] },
  research: { weight: 2, tools: ['Read', 'Grep', 'Glob', 'LS'] },
  shell: { weight: 1, tools: ['Bash', 'PowerShell'] },
  web: { weight: 4, tools: ['WebFetch', 'WebSearch'], prefix: 'mcp__claude-in-chrome__' },
  agents: { weight: 6, tools: ['Agent', 'Task'] },
  mcp: { weight: 1, prefix: 'mcp__' },
};
const SUBAGENT_TOOLS = TOOL_GROUPS.agents.tools;

// Building type per dominant kind of work.
export const BUILDINGS = {
  build: 'Workshop',
  research: 'Library',
  shell: 'Factory',
  web: 'Observatory',
  agents: 'HQ',
  mcp: 'Exchange',
  chat: 'Café',
};

const cache = new Map(); // transcript path -> { mtimeMs, size, summary }

export function groupOf(name) {
  return Object.keys(TOOL_GROUPS).find((g) => {
    const { tools: list = [], prefix } = TOOL_GROUPS[g];
    return list.includes(name) || (prefix && name.startsWith(prefix));
  }) ?? null;
}

// Raw call counts per kind of work.
export function groupCounts(tools) {
  const counts = {};
  for (const [name, n] of Object.entries(tools)) {
    const g = groupOf(name);
    if (g) counts[g] = (counts[g] || 0) + n;
  }
  return counts;
}

export function classify(tools) {
  const total = Object.values(tools).reduce((a, b) => a + b, 0);
  const scores = {};
  for (const [g, n] of Object.entries(groupCounts(tools))) scores[g] = n * TOOL_GROUPS[g].weight;
  if (total < 3) return 'chat';
  const [best] = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return best ? best[0] : 'chat';
}

export function summarize(text) {
  const s = {
    title: null,
    cwd: null,
    branch: null,
    model: null,
    startedAt: null,
    lastActivity: null,
    prompts: 0,
    turns: 0,
    outputTokens: 0,
    errors: 0,
    tools: {},
    lastTool: null,
    costUSD: null,
    linesAdded: null,
    linesRemoved: null,
  };
  for (const line of text.split('\n')) {
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // partially written last line of a live session
    }
    if (o.timestamp) {
      s.startedAt ??= o.timestamp;
      s.lastActivity = o.timestamp;
    }
    if (o.cwd) s.cwd ??= o.cwd;
    if (o.gitBranch) s.branch = o.gitBranch;

    if (o.type === 'ai-title') s.title = o.aiTitle;
    else if (o.type === 'cost-state') {
      s.costUSD = o.totalCostUSD ?? s.costUSD;
      s.linesAdded = o.totalLinesAdded ?? s.linesAdded;
      s.linesRemoved = o.totalLinesRemoved ?? s.linesRemoved;
    } else if (o.type === 'assistant' && o.message) {
      s.turns++;
      s.model = o.message.model || s.model;
      s.outputTokens += o.message.usage?.output_tokens || 0;
      for (const c of Array.isArray(o.message.content) ? o.message.content : []) {
        if (c.type === 'tool_use') {
          s.tools[c.name] = (s.tools[c.name] || 0) + 1;
          s.lastTool = c.name;
        }
      }
    } else if (o.type === 'user' && o.message && !o.isMeta && !o.isSidechain) {
      const content = o.message.content;
      if (Array.isArray(content)) s.errors += content.filter((c) => c.type === 'tool_result' && c.is_error).length;
      const p = readPrompt(content);
      if (p && p.kind !== 'interrupt') s.prompts++;
    }
  }
  if (!s.startedAt) return null;
  s.kind = classify(s.tools);
  s.groups = groupCounts(s.tools);
  s.lastGroup = s.lastTool ? groupOf(s.lastTool) : null;
  s.building = BUILDINGS[s.kind];
  s.subagents = SUBAGENT_TOOLS.reduce((n, t) => n + (s.tools[t] || 0), 0);
  return s;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

// Running sessions register themselves in ~/.claude/sessions/<pid>.json.
function readLive() {
  const live = new Map();
  const dir = join(CLAUDE_DIR, 'sessions');
  if (!existsSync(dir)) return live;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const o = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (o.sessionId && isAlive(o.pid)) live.set(o.sessionId, { status: o.status, name: o.name });
    } catch {
      // registry file being rewritten; pick it up on the next scan
    }
  }
  return live;
}

function liveStatus(raw) {
  if (!raw) return 'open';
  if (raw === 'busy') return 'working';
  if (/wait|permission|input|ask/i.test(raw)) return 'waiting';
  return 'open';
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function findTranscript(id) {
  if (!SESSION_ID.test(id)) return null; // also rules out path traversal
  const projectsDir = join(CLAUDE_DIR, 'projects');
  if (!existsSync(projectsDir)) return null;
  for (const p of readdirSync(projectsDir, { withFileTypes: true })) {
    const path = join(projectsDir, p.name, `${id}.jsonl`);
    if (p.isDirectory() && existsSync(path)) return path;
  }
  return null;
}

export function sessionStatus(id) {
  const l = readLive().get(id);
  return l ? liveStatus(l.status) : 'closed';
}

export function scanCity() {
  const projectsDir = join(CLAUDE_DIR, 'projects');
  const live = readLive();
  const sessions = [];
  if (existsSync(projectsDir)) {
    for (const p of readdirSync(projectsDir, { withFileTypes: true })) {
      if (!p.isDirectory()) continue;
      const pdir = join(projectsDir, p.name);
      for (const f of readdirSync(pdir)) {
        if (!f.endsWith('.jsonl')) continue;
        const path = join(pdir, f);
        const st = statSync(path);
        let entry = cache.get(path);
        if (!entry || entry.mtimeMs !== st.mtimeMs || entry.size !== st.size) {
          entry = { mtimeMs: st.mtimeMs, size: st.size, summary: summarize(readFileSync(path, 'utf8')) };
          cache.set(path, entry);
        }
        if (!entry.summary) continue;
        const id = f.slice(0, -'.jsonl'.length);
        const l = live.get(id);
        sessions.push({
          id,
          ...entry.summary,
          project: entry.summary.cwd ? basename(entry.summary.cwd) : p.name,
          status: l ? liveStatus(l.status) : 'closed',
          name: l?.name ?? null,
        });
      }
    }
  }

  const districts = new Map();
  for (const s of sessions) {
    if (!districts.has(s.project)) districts.set(s.project, []);
    districts.get(s.project).push(s);
  }
  return {
    generatedAt: new Date().toISOString(),
    districts: [...districts]
      .map(([name, list]) => ({
        name,
        sessions: list.sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
        lastActivity: list.reduce((m, s) => (s.lastActivity > m ? s.lastActivity : m), ''),
      }))
      .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity)),
  };
}
