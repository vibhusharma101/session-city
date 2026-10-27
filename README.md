# Session City

Your Claude Code sessions as a living city, with one building per session.

## Install as a Claude Code plugin

Inside Claude Code:

```
/plugin marketplace add vibhusharma101/session-city
/plugin install session-city@session-city
```

Then type `/session-city:city` in any session. Your city opens in
the browser at `http://127.0.0.1:4747` with every session found in
`~/.claude/projects`, and live sessions light up as they work. The server
runs in the background and stops by itself a few minutes after you close the
tab. Requires Node 18 or newer.

## Or run it from a terminal

```
npx github:vibhusharma101/session-city
```

## Reading the city

| You see | It means |
|---|---|
| District | A project (the folder you started Claude Code in) |
| Building height | How many turns the session ran |
| Lit windows, glow | Session is running right now |
| Pulsing beacon | Session is waiting for you |
| Flames | Live session hitting a lot of tool errors |
| Orbiting drones | Subagents the session dispatched |
| Dark building | Session is closed |

Building types come from the session's dominant kind of work:

- **Workshop** (crane): editing code
- **Library**: reading and searching
- **Factory** (chimney): running commands
- **Observatory** (dome): web and browser work
- **HQ** (antenna): dispatching subagents
- **Exchange** (spire): MCP tools
- **Café**: mostly conversation

Click a building for its stats, its tool breakdown and the command to resume it.

## What happened in a session

**See what happened in this session** opens the session as a story, built on your
machine from its transcript:

- every prompt you gave, in order, with Claude's replies
- each action Claude took (files read and edited, commands run, searches,
  subagents), with failed actions and their errors in red
- the list of files changed

Anything that looks like a credential (API keys, tokens, private keys,
`password=…`, `user:pass@` URLs) is masked, so the page is safe to screen-share.
Masking is pattern-based, so check before sharing anything sensitive.

## Privacy

Session City runs entirely on your machine:

- The server binds to `127.0.0.1` only and makes no outbound requests.
- The city view uses only an allowlist of metadata (counts, tool names,
  timestamps, title, cost); `test/scan.test.js` checks that prompt text,
  tool inputs and tool outputs never reach it.
- The session story reads the full transcript, but only when you open it, and
  only on `127.0.0.1`.
- Nothing is written anywhere; the city is computed fresh from your files.

## Options

```
session-city --port 5000    # pick a port (falls back to the next free one)
session-city --no-open      # don't open the browser
session-city --detach       # run in the background (what /city uses)
```

Set `CLAUDE_CONFIG_DIR` if your Claude Code data lives somewhere other than `~/.claude`.

## Development

```
npm start
npm test
claude --plugin-dir .       # try the plugin without installing it
claude plugin validate .
```

No dependencies; requires Node 18+.
