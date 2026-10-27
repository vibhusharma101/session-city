import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, classify } from '../src/scan.js';

const line = (o) => JSON.stringify(o);
const assistant = (ts, tools) => line({
  type: 'assistant',
  timestamp: ts,
  cwd: '/work/app',
  message: { model: 'm', usage: { output_tokens: 10 }, content: tools.map((name) => ({ type: 'tool_use', name, input: { secret: 'sk-live-123' } })) },
});

test('summarize keeps only allowlisted metadata', () => {
  const text = [
    line({ type: 'user', timestamp: '2026-10-01T10:00:00Z', cwd: '/work/app', gitBranch: 'main', message: { content: 'my password is hunter2' } }),
    assistant('2026-10-01T10:01:00Z', ['Edit', 'Edit', 'Bash']),
    line({ type: 'user', timestamp: '2026-10-01T10:02:00Z', message: { content: [{ type: 'tool_result', is_error: true, content: 'boom' }] } }),
    line({ type: 'ai-title', aiTitle: 'Fix login' }),
    line({ type: 'cost-state', totalCostUSD: 0.5, totalLinesAdded: 12, totalLinesRemoved: 3 }),
    '{"type":"assistant", "trunc', // half-written last line
  ].join('\n');

  const s = summarize(text);
  assert.equal(s.title, 'Fix login');
  assert.equal(s.prompts, 1);
  assert.equal(s.turns, 1);
  assert.equal(s.errors, 1);
  assert.equal(s.outputTokens, 10);
  assert.deepEqual(s.tools, { Edit: 2, Bash: 1 });
  assert.equal(s.costUSD, 0.5);
  assert.equal(s.branch, 'main');
  assert.equal(s.kind, 'build');

  const json = JSON.stringify(s);
  assert.ok(!json.includes('hunter2'), 'prompt text must not leak');
  assert.ok(!json.includes('sk-live'), 'tool inputs must not leak');
  assert.ok(!json.includes('boom'), 'tool output must not leak');
});

test('summarize returns null for an empty transcript', () => {
  assert.equal(summarize(''), null);
});

test('classify weights edits above shell noise', () => {
  assert.equal(classify({ Bash: 20, Edit: 8 }), 'build');
  assert.equal(classify({ Bash: 20, Edit: 2 }), 'shell');
  assert.equal(classify({ WebSearch: 6, Bash: 10 }), 'web');
  assert.equal(classify({ 'mcp__claude-in-chrome__navigate': 5, Bash: 2 }), 'web');
  assert.equal(classify({ Agent: 4, Bash: 10 }), 'agents');
  assert.equal(classify({ Read: 1 }), 'chat');
});
