import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanCity, findTranscript, sessionStatus, summarize } from './scan.js';
import { renderReport } from './report.js';

const INDEX = fileURLToPath(new URL('../public/index.html', import.meta.url));

let lastRequest = Date.now();

function handler(req, res) {
  lastRequest = Date.now();
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/ping') {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"app":"session-city"}');
    return;
  }
  if (url.pathname === '/api/city') {
    try {
      const body = JSON.stringify(scanCity());
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(body);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  const story = url.pathname.match(/^\/session\/([^/]+)$/);
  if (story) {
    const id = story[1];
    const path = findTranscript(id);
    const text = path && readFileSync(path, 'utf8');
    const s = text && summarize(text);
    if (!s) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Session not found');
      return;
    }
    const cwd = s.cwd ?? '';
    const html = renderReport(text, { ...s, id, project: cwd ? basename(cwd) : '', status: sessionStatus(id) });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
    return;
  }
  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(readFileSync(INDEX));
    return;
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
