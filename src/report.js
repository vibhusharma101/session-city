// Renders one session transcript as a readable HTML story: what you asked,
// what Claude said, and what it did. Served only on 127.0.0.1.
import { basename } from 'node:path';
import { BUILDINGS } from './scan.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Masks things that look like credentials, so the page is safe to screen-share.
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:sk-ant-[\w-]{10,}|sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_\w{20,}|gho_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[\w-]{10,}|AIza[\w-]{30,}|eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,})\b/g,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/gi, // user:pass@ in URLs
];
export function redact(text) {
  let out = String(text ?? '');
  for (const re of SECRET_PATTERNS) out = out.replace(re, '••••••');
  return out.replace(/\b(password|passwd|pwd|secret|token|api[_-]?key)(["']?\s*[:=]\s*["']?)([^\s"',;]{4,})/gi, '$1$2••••••');
}

// Reduces a user message to what the person actually did, or null for
// bookkeeping entries (command output, hook context, tool results).
export function readPrompt(content) {
  const raw = typeof content === 'string'
    ? content
    : Array.isArray(content) ? content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') : '';
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^<(bash-stdout|bash-stderr|local-command-stdout|local-command-stderr|local-command-caveat)/.test(trimmed)) return null;
  if (trimmed.startsWith('[Request interrupted')) return { kind: 'interrupt', text: 'You interrupted Claude' };
  const cmd = trimmed.match(/<command-name>([^<]*)<\/command-name>/);
  if (cmd) {
    const args = trimmed.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1] ?? '';
    return { kind: 'command', text: `${cmd[1]} ${args}`.trim() };
  }
  const bash = trimmed.match(/<bash-input>([\s\S]*?)<\/bash-input>/);
  if (bash) return { kind: 'shell', text: bash[1] };
  const text = trimmed
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<\/?pasted_content[^>]*>/g, '')
    .trim();
  return text ? { kind: 'prompt', text } : null;
}

const shortPath = (p) => String(p).replace(/\\/g, '/').split('/').filter(Boolean).slice(-3).join('/');

function toolTarget(name, input = {}) {
  switch (name) {
    case 'Read': case 'Edit': case 'Write': case 'MultiEdit':
      return input.file_path ? shortPath(input.file_path) : '';
    case 'NotebookEdit':
      return input.notebook_path ? shortPath(input.notebook_path) : '';
    case 'Bash': case 'PowerShell':
      return input.description || String(input.command ?? '').split('\n')[0];
    case 'Grep': case 'Glob':
      return input.pattern ?? '';
    case 'WebFetch':
      return input.url ?? '';
    case 'WebSearch':
      return input.query ?? '';
    case 'Agent': case 'Task':
      return input.description ?? '';
    case 'Skill':
      return input.skill ?? '';
    default:
      return '';
  }
}

const VERBS = {
  Read: 'Read', Edit: 'Edited', MultiEdit: 'Edited', Write: 'Wrote', NotebookEdit: 'Edited notebook',
  Bash: 'Ran', PowerShell: 'Ran', Grep: 'Searched for', Glob: 'Listed files', WebFetch: 'Fetched',
  WebSearch: 'Searched the web for', Agent: 'Sent a subagent to', Task: 'Sent a subagent to', Skill: 'Used skill',
  AskUserQuestion: 'Asked you a question', ToolSearch: 'Loaded tools',
};
const verb = (name) => VERBS[name] ?? name.replace(/^mcp__([^_]+(?:-[^_]+)*)__/, '$1 · ');

// Escapes first, then renders the two markdown marks that matter most for reading.
const md = (s) => esc(s)
  .replace(/`([^`\n]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');

function textBlock(text, limit) {
  const t = redact(text);
  if (t.length <= limit) return `<div class="text">${md(t)}</div>`;
  return `<div class="text">${md(t.slice(0, limit))}…</div>` +
    `<details><summary>Show all ${t.length.toLocaleString()} characters</summary><div class="text">${md(t)}</div></details>`;
}

export function parseStory(text) {
  const chapters = [];
  const toolsById = new Map();
  const files = new Map();
  let current = null;
  const open = (prompt, ts) => {
    current = { prompt, ts, items: [] };
    chapters.push(current);
  };

  for (const line of text.split('\n')) {
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.isSidechain || o.isMeta || !o.message) continue;
    const content = o.message.content;

    if (o.type === 'user') {
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c.type !== 'tool_result' || !c.is_error) continue;
          const tool = toolsById.get(c.tool_use_id);
          if (!tool) continue;
          const body = typeof c.content === 'string' ? c.content
            : Array.isArray(c.content) ? c.content.map((x) => x.text ?? '').join('\n') : '';
          tool.error = body.replace(/<\/?tool_use_error>/g, '').trim().slice(0, 400);
        }
      }
      const p = readPrompt(content);
      if (p) open(p, o.timestamp);
    } else if (o.type === 'assistant' && Array.isArray(content)) {
      if (!current) open(null, o.timestamp);
      for (const c of content) {
        if (c.type === 'text' && c.text.trim()) current.items.push({ type: 'say', text: c.text.trim() });
        else if (c.type === 'tool_use') {
          const tool = { type: 'tool', name: c.name, target: toolTarget(c.name, c.input), error: null };
          toolsById.set(c.id, tool);
          current.items.push(tool);
          if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(c.name)) {
            const f = c.input?.file_path || c.input?.notebook_path;
            if (f) files.set(f, (files.get(f) || 0) + 1);
          }
        }
      }
    }
  }
  return { chapters, files };
}

const time = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
const fmt = (n) => Number(n || 0).toLocaleString();

function renderTools(tools) {
  return `<ul class="tools">${tools.map((t) => `
    <li class="${t.error ? 'err' : ''}"><span class="verb">${esc(verb(t.name))}</span>
      <span class="target">${esc(redact(t.target))}</span>
      ${t.error ? `<div class="errmsg">${esc(redact(t.error))}</div>` : ''}</li>`).join('')}</ul>`;
}

function renderChapter(ch, i) {
  const p = ch.prompt;
  const head = !p
    ? '<div class="prompt quiet">Session resumed</div>'
    : p.kind === 'command' ? `<div class="prompt cmd"><code>${esc(redact(p.text))}</code></div>`
    : p.kind === 'shell' ? `<div class="prompt cmd"><code>! ${esc(redact(p.text))}</code></div>`
    : p.kind === 'interrupt' ? `<div class="prompt quiet">${esc(p.text)}</div>`
    : `<div class="prompt">${textBlock(p.text, 700)}</div>`;

  // group consecutive tool calls so long runs read as one block
  const body = [];
  let run = [];
  const flush = () => { if (run.length) body.push(renderTools(run)); run = []; };
  for (const it of ch.items) {
    if (it.type === 'tool') { run.push(it); continue; }
    flush();
    body.push(`<div class="say">${textBlock(it.text, 900)}</div>`);
  }
  flush();
  const errors = ch.items.filter((t) => t.error).length;
  const toolCount = ch.items.filter((t) => t.type === 'tool').length;

  return `<section class="chapter" id="c${i + 1}">
    <div class="meta"><span class="num">${i + 1}</span>${time(ch.ts)}
      ${toolCount ? ` · ${toolCount} action${toolCount > 1 ? 's' : ''}` : ''}${errors ? ` · <span class="bad">${errors} failed</span>` : ''}</div>
    ${head}
    ${body.join('') || '<div class="quiet">No reply.</div>'}
  </section>`;
}

export function renderReport(text, s) {
  const { chapters, files } = parseStory(text);
  const fileList = [...files].sort((a, b) => b[1] - a[1]);
  const status = { working: 'Working now', waiting: 'Waiting for you', open: 'Open, idle', closed: 'Closed' }[s.status] ?? '';
  const stat = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const toolTotal = Object.values(s.tools).reduce((a, b) => a + b, 0);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(s.title || 'Session')} · Session City</title>
<style>
  :root { --bg:#0b0e17; --panel:#121726; --line:#242b3f; --text:#e6e9f2; --muted:#8a93ab; --accent:#ffd27a;
    --you:#1b2540; --bad:#ff7b6b; --good:#6fdc8c; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif; }
  main { max-width:820px; margin:0 auto; padding:24px 16px 80px; }
  a { color:var(--accent); }
  .back { font-size:13px; text-decoration:none; }
  h1 { font-size:26px; line-height:1.25; margin:14px 0 6px; }
  .sub { color:var(--muted); font-size:13px; }
  .pill { display:inline-block; font-size:12px; padding:2px 9px; border:1px solid var(--line); border-radius:999px; margin-right:6px; }
  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:8px; margin:20px 0; }
  .stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:8px 12px; }
  .stat .k { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.04em; }
  .stat .v { font-size:18px; font-weight:600; }
  h2 { font-size:13px; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; margin:28px 0 10px; }
  .files { margin:0; padding:0; list-style:none; columns:2 260px; font-size:13px; }
  .files li { padding:2px 0; break-inside:avoid; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .files .n { color:var(--muted); }
  .chapter { border-left:2px solid var(--line); padding:4px 0 18px 18px; margin-left:8px; position:relative; }
  .meta { color:var(--muted); font-size:12px; margin-bottom:6px; }
  .num { position:absolute; left:-12px; width:22px; height:22px; border-radius:50%; background:var(--panel);
    border:1px solid var(--line); text-align:center; font-size:11px; line-height:20px; color:var(--text); }
  .meta .num + * { margin-left:4px; }
  .prompt { background:var(--you); border:1px solid #2c3a62; border-radius:10px; padding:10px 14px; margin-bottom:10px; }
  .prompt.cmd code { color:var(--accent); }
  .quiet { color:var(--muted); font-style:italic; background:none; border:0; padding:0; }
  .say { margin:8px 0; }
  .text { white-space:pre-wrap; word-break:break-word; }
  .text code { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:.88em; background:#1a2030;
    padding:1px 5px; border-radius:4px; }
  details summary { cursor:pointer; color:var(--muted); font-size:12px; margin-top:4px; }
  .tools { list-style:none; margin:6px 0; padding:8px 12px; background:var(--panel); border:1px solid var(--line);
    border-radius:8px; font-size:13px; }
  .tools li { padding:2px 0; overflow-wrap:anywhere; }
  .tools .verb { color:var(--muted); }
  .tools .target { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:12px; }
  .tools li.err .verb, .bad { color:var(--bad); }
  .errmsg { color:var(--bad); font-size:12px; white-space:pre-wrap; margin:2px 0 4px 12px; opacity:.85; }
  .note { margin-top:40px; color:var(--muted); font-size:12px; }
</style></head>
<body><main>
  <a class="back" href="/">← Back to the city</a>
  <h1>${esc(s.title || 'Untitled session')}</h1>
  <div class="sub">
    <span class="pill">${esc(BUILDINGS[s.kind])}</span><span class="pill">${status}</span>
    ${esc(s.project)}${s.branch ? ' · ' + esc(s.branch) : ''} · ${new Date(s.startedAt).toLocaleString()}
  </div>
  <div class="stats">
    ${stat('Your prompts', fmt(s.prompts))}
    ${stat('Actions', fmt(toolTotal))}
    ${stat('Files changed', fmt(files.size))}
    ${stat('Failed actions', fmt(s.errors))}
    ${s.costUSD != null ? stat('Cost', '$' + s.costUSD.toFixed(2)) : stat('Output tokens', fmt(s.outputTokens))}
    ${s.linesAdded != null ? stat('Lines', `+${fmt(s.linesAdded)} / −${fmt(s.linesRemoved)}`) : ''}
  </div>
  ${fileList.length ? `<h2>Files changed</h2><ul class="files">${fileList.map(([f, n]) =>
    `<li title="${esc(f)}">${esc(shortPath(f))} <span class="n">×${n}</span></li>`).join('')}</ul>` : ''}
  <h2>What happened</h2>
  ${chapters.map(renderChapter).join('') || '<p class="quiet">Nothing recorded yet.</p>'}
  <p class="note">Built on this machine from ${esc(basename(s.id))}.jsonl. Things that look like secrets are masked.
  Nothing was sent anywhere.</p>
</main></body></html>`;
}
