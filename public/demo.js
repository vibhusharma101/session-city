// Sample data for ?demo: a made-up city, so the page can be shown (screenshots,
// a hosted demo) without anyone's real sessions.
import { rng } from './util.js';

const H = 36e5, DAY = 864e5;

// [project, title, kind, status, hours since last activity, turns, subagents]
const SESSIONS = [
  ['api-server', 'Add rate limiting to the public API', 'build', 'working', 0.05, 140, 2],
  ['api-server', 'Fix flaky auth tests', 'shell', 'waiting', 0.2, 60, 0],
  ['api-server', 'Postgres migration for invoices', 'build', 'open', 3, 95, 0],
  ['api-server', 'Explain the billing webhook flow', 'research', 'closed', 50, 22, 0],
  ['mobile-app', 'Dark mode for settings screen', 'build', 'working', 0.02, 75, 1],
  ['mobile-app', 'Crash on Android 14 share sheet', 'web', 'closed', 30, 48, 0],
  ['mobile-app', 'Quick question about Expo', 'chat', 'closed', 110, 3, 0],
  ['docs-site', 'Rewrite the getting-started guide', 'research', 'closed', 6, 34, 0],
  ['docs-site', 'Broken links audit', 'web', 'closed', 72, 41, 0],
  ['data-pipeline', 'Parallelise the nightly ETL', 'agents', 'closed', 20, 120, 6],
  ['data-pipeline', 'Backfill March events', 'shell', 'closed', 400, 66, 0],
  ['data-pipeline', 'Schema drift alerts', 'mcp', 'closed', 500, 30, 0],
  ['design-system', 'Button variants and tokens', 'build', 'closed', 260, 88, 0],
  ['design-system', 'Storybook upgrade', 'shell', 'closed', 330, 52, 0],
  ['design-system', 'Icon set cleanup', 'build', 'closed', 600, 18, 0],
  ['cli-tool', 'Prototype the init command', 'build', 'closed', 900, 70, 0],
  ['cli-tool', 'What does this regex do?', 'chat', 'closed', 1000, 2, 0],
];

const GROUP_TOOLS = {
  build: ['Edit', 'Write'], research: ['Read', 'Grep'], shell: ['Bash'], web: ['WebFetch', 'WebSearch'],
  agents: ['Agent'], mcp: ['mcp__linear__create_issue'], chat: [],
};

let cache = null;

export function demoCity() {
  if (cache) return cache;
  const r = rng(42);
  const now = Date.now();
  const districts = new Map();
  SESSIONS.forEach(([project, title, kind, status, hours, turns, subagents], i) => {
    const tools = {}, groups = {};
    const total = kind === 'chat' ? 1 : Math.round(turns * (1.6 + r()));
    // mostly the session's own kind of work, with some reading and shell on the side
    for (const [g, share] of [[kind, 0.6], ['research', 0.25], ['shell', 0.15]]) {
      const n = Math.round(total * share);
      if (!n || !GROUP_TOOLS[g].length) continue;
      groups[g] = (groups[g] || 0) + n;
      const tool = GROUP_TOOLS[g][Math.floor(r() * GROUP_TOOLS[g].length)];
      tools[tool] = (tools[tool] || 0) + n;
    }
    const last = now - hours * H;
    const s = {
      id: `de300000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      title, kind, status, turns, subagents,
      project, cwd: `~/code/${project}`, branch: i % 3 ? 'main' : 'feature/' + title.split(' ')[0].toLowerCase(),
      model: 'claude-opus-5-5',
      prompts: Math.max(1, Math.round(turns / 6)),
      errors: Math.round(total * 0.04 * r()),
      outputTokens: Math.round(turns * (900 + r() * 1500)),
      tools, groups, lastGroup: kind,
      startedAt: new Date(last - (0.5 + r() * 3) * H).toISOString(),
      lastActivity: new Date(last).toISOString(),
      name: null,
    };
    if (!districts.has(project)) districts.set(project, []);
    districts.get(project).push(s);
  });
  cache = { generatedAt: new Date(now).toISOString(), districts: [...districts].map(([name, sessions]) => ({ name, sessions })) };
  return cache;
}

const ACTIONS = {
  build: ['Edited src/routes/limits.ts', 'Wrote src/middleware/rateLimit.ts', 'Edited tests/limits.test.ts'],
  research: ['Read src/billing/webhook.ts', 'Searched for "invoice_id"', 'Read docs/architecture.md'],
  shell: ['Ran npm test', 'Ran npm run lint', 'Ran git status'],
  web: ['Fetched developer.android.com/reference', 'Searched the web for "share sheet crash"', 'Browser: screenshot'],
  agents: ['Started a subagent: profile the ETL', 'Started a subagent: write the backfill', 'Agent finished'],
  mcp: ['linear: create issue', 'linear: list issues'],
  chat: ['Answered a question'],
};

export function demoActivity(s) {
  const list = [...(ACTIONS[s.kind] ?? []), ...ACTIONS.research, ...ACTIONS.shell];
  const last = Date.parse(s.lastActivity);
  return list.slice(0, 8).map((text, i) => ({ text, at: new Date(last - i * 95e3).toISOString(), failed: i === 4 && s.errors > 0 }));
}
