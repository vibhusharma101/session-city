import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanCity, findTranscript, sessionStatus, summarize } from './scan.js';
import { renderReport, recentActivity } from './report.js';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

let lastRequest = Date.now();

function send(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}
const json = (res, status, data) => send(res, status, 'application/json', JSON.stringify(data));

function loadSession(id) {
  const path = findTranscript(id);
  const text = path && readFileSync(path, 'utf8');
  const s = text && summarize(text);
  return s ? { text, s } : null;
}

function handler(req, res) {
  lastRequest = Date.now();
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  if (path === '/api/ping') return json(res, 200, { app: 'session-city' });
  if (path === '/api/city') {
    try {
      return json(res, 200, scanCity());
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  const activity = path.match(/^\/api\/session\/([^/]+)\/activity$/);
  if (activity) {
    const found = loadSession(activity[1]);
    if (!found) return json(res, 404, { error: 'Session not found' });
    return json(res, 200, { status: sessionStatus(activity[1]), actions: recentActivity(found.text, 8) });
  }

  const story = path.match(/^\/session\/([^/]+)$/);
  if (story) {
    const id = story[1];
    const found = loadSession(id);
    if (!found) return send(res, 404, 'text/plain', 'Session not found');
    const cwd = found.s.cwd ?? '';
    const html = renderReport(found.text, { ...found.s, id, project: cwd ? basename(cwd) : '', status: sessionStatus(id) });
    return send(res, 200, TYPES['.html'], html);
  }

  // Static files: a flat allowlist of names, so no path can escape public/.
  const file = path === '/' ? 'index.html' : path.slice(1);
  const ext = file.match(/^[a-z0-9-]+(\.[a-z]+)$/)?.[1];
  if (ext && TYPES[ext]) {
    try {
      return send(res, 200, TYPES[ext], readFileSync(PUBLIC + file));
    } catch {
      // fall through to 404
    }
  }
  res.writeHead(404).end();
}

// The open city page polls every few seconds, so silence means nobody is watching.
export function exitWhenIdle(ms) {
  setInterval(() => {
    if (Date.now() - lastRequest > ms) process.exit(0);
  }, 15_000).unref();
}

// Binds to loopback only, so the city is never reachable from the network.
export function startServer(port, attempts = 10) {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.once('error', (e) => {
      if (e.code === 'EADDRINUSE' && attempts > 1) resolve(startServer(port + 1, attempts - 1));
      else reject(e);
    });
    server.listen(port, '127.0.0.1', () => resolve({ server, port }));
  });
}
