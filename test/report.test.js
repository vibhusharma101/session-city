import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, readPrompt, parseStory, renderReport, recentActivity } from '../src/report.js';
import { summarize } from '../src/scan.js';

test('redact masks common credential shapes', () => {
  const fakes = [
    'sk-ant-api03-abcdefghijklmnop',
    'ghp_abcdefghijklmnopqrstuvwxyz0123',
    'AKIAABCDEFGHIJKLMNOP',
    'postgres://admin:hunter2@db.local/app',
    'password=hunter2',
    'API_KEY: "s3cr3tvalue"',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----',
  ];
  for (const f of fakes) {
    const out = redact(`before ${f} after`);
    assert.ok(out.includes('••••••'), `not masked: ${f}`);
    assert.ok(!/hunter2|s3cr3tvalue|MIIabc|abcdefghijklmnop|ABCDEFGHIJKLMNOP/.test(out), `leaked: ${out}`);
  }
  assert.equal(redact('just a normal sentence'), 'just a normal sentence');
});

test('readPrompt recognises what the person did', () => {
  assert.deepEqual(readPrompt('fix the login bug'), { kind: 'prompt', text: 'fix the login bug' });
  assert.deepEqual(readPrompt('<command-message>x</command-message>\n<command-name>/review</command-name>\n<command-args>42</command-args>'),
    { kind: 'command', text: '/review 42' });
  assert.deepEqual(readPrompt('<bash-input>npm test</bash-input>'), { kind: 'shell', text: 'npm test' });
  assert.equal(readPrompt('<bash-stdout>ok</bash-stdout>'), null);
  assert.equal(readPrompt([{ type: 'tool_result', content: 'x' }]), null);
  assert.equal(readPrompt([{ type: 'text', text: '[Request interrupted by user]' }]).kind, 'interrupt');
  assert.equal(readPrompt('<system-reminder>ctx</system-reminder>\nhello').text, 'hello');
});

test('parseStory groups actions under the prompt and attaches errors', () => {
  const lines = [
    { type: 'user', timestamp: '2026-10-01T10:00:00Z', message: { content: 'add tests' } },
    { type: 'assistant', timestamp: '2026-10-01T10:00:05Z', message: { content: [
      { type: 'text', text: 'On it.' },
      { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: '/repo/test/a.test.js' } },
      { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test', description: 'Run tests' } },
    ] } },
    { type: 'user', timestamp: '2026-10-01T10:00:09Z', message: { content: [
      { type: 'tool_result', tool_use_id: 't2', is_error: true, content: '1 failing' },
    ] } },
  ];
  const text = lines.map((l) => JSON.stringify(l)).join('\n');
  const { chapters, files } = parseStory(text);
  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].prompt.text, 'add tests');
  assert.equal(chapters[0].items.length, 3);
  assert.equal(chapters[0].items[2].error, '1 failing');
  assert.deepEqual([...files.keys()], ['/repo/test/a.test.js']);

  const html = renderReport(text, { ...summarize(text), id: 'x', project: 'repo', status: 'closed' });
  assert.ok(html.includes('add tests') && html.includes('1 failing') && html.includes('test/a.test.js'));
});

test('recentActivity is newest first, readable, and hides home paths', () => {
  const lines = [
    { type: 'user', message: { content: 'go' } },
    { type: 'assistant', timestamp: '2026-10-01T10:00:00Z', message: { content: [
      { type: 'tool_use', id: 'a', name: 'Edit', input: { file_path: 'C:/Users/me/.claude/projects/C--Users-me-app/memory/goal.md' } },
      { type: 'tool_use', id: 'b', name: 'mcp__claude-in-chrome__tabs_context_mcp', input: {} },
      { type: 'tool_use', id: 'c', name: 'Bash', input: { command: 'curl -H "token=abcd1234secret"' } },
    ] } },
  ];
  const acts = recentActivity(lines.map((l) => JSON.stringify(l)).join('\n'), 5);
  assert.deepEqual(acts.map((a) => a.tool), ['Bash', 'mcp__claude-in-chrome__tabs_context_mcp', 'Edit']);
  assert.ok(!acts[0].text.includes('abcd1234secret'), acts[0].text);
  assert.equal(acts[1].text, 'Browser: tabs context');
  assert.ok(!acts[2].text.includes('C--Users'), acts[2].text);
});
