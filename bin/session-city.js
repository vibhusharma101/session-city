#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer, exitWhenIdle } from '../src/server.js';
import { CLAUDE_DIR } from '../src/scan.js';

const args = process.argv.slice(2);

if (args.includes('-h') || args.includes('--help')) {
  console.log(`session-city — your Claude Code sessions as a city

Usage: session-city [--port <n>] [--no-open] [--detach]

  --port <n>   port to serve on (default 4747, falls back to the next free one)
  --no-open    don't open the browser
  --detach     run in the background and return immediately; the server
               stops by itself a few minutes after the city tab is closed

Reads ${CLAUDE_DIR} and serves the city at http://127.0.0.1:<port>.
Everything stays on this machine.`);
  process.exit(0);
}

const portArg = args.indexOf('--port');
const port = portArg >= 0 ? Number(args[portArg + 1]) : 4747;
const IDLE_MS = 5 * 60_000;

function openBrowser(url) {
  const [cmd, cmdArgs] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
  spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref();
}

async function alreadyRunning(url) {
  try {
    const res = await fetch(`${url}/api/ping`, { signal: AbortSignal.timeout(1000) });
    return (await res.json()).app === 'session-city';
  } catch {
    return false;
  }
}

// Starts a background copy of this script and waits for it to report its URL.
function spawnDetached() {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--port', String(port), '--no-open', '--idle-exit'], {
    detached: true,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.stdout.on('data', (d) => {
      const url = String(d).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (!url) return;
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      resolve(url);
    });
    child.on('exit', (code) => reject(new Error(err.trim() || `server exited with code ${code}`)));
  });
}

if (args.includes('--detach')) {
  const existing = `http://127.0.0.1:${port}`;
  const url = (await alreadyRunning(existing)) ? existing : await spawnDetached();
  console.log(`Session City is open at ${url} (local only)`);
  if (!args.includes('--no-open')) openBrowser(url);
  process.exit(0);
}

const { port: bound } = await startServer(port);
const url = `http://127.0.0.1:${bound}`;
console.log(`Session City is open at ${url}  (local only — Ctrl+C to stop)`);
if (args.includes('--idle-exit')) exitWhenIdle(IDLE_MS);
if (!args.includes('--no-open')) openBrowser(url);
