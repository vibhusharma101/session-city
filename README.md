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

## Play

Session City is a little 3D city-builder made of your real sessions.

- **Move around:** drag to pan, scroll to zoom, right-drag or Q/E to rotate,
  WASD or the arrow keys to pan. ⤢ shows the whole city.
- **Your car:** the only car in town is yours. Click a building and it
  drives over; click a street to just drive there. More cars unlock as you
  level up.
- **Coins:** every action an agent took (an edit, a search, a command) is a
  coin waiting above its building. Click the coin to collect it.
- **Levels:** collecting coins and finishing quests earns XP. Each level
  unlocks a new car.
- **Quests:** three daily goals, like collecting from three buildings,
  answering a session that needs you, or exploring Old Town.
- **Sound:** small synthesized blips for clicks, coins and level-ups. 🔊 mutes them.

Coins, XP and quests are kept in your browser only.

## Reading the city

Sessions live in three walled colonies, each with a gate onto the avenue:

| Colony | Sessions | Looks like |
|---|---|---|
| **Uptown** | live, or used in the last 24 hours | hedges, gold gate, fountains, flower beds |
| **Midtown** | used this week | white picket fence, tidy streets |
| **Old Town** | untouched for a week or more | broken fence, dry grass, dead trees, boarded windows |

Inside a colony each project gets its own block.

| You see | It means |
|---|---|
| Building height | How many turns the session ran |
| Lit windows, green ripple on the ground | Session is working right now |
| Bouncing yellow **!** | Session is waiting for you |
| Gold coin with a number | Actions you haven't collected yet |
| Drones circling | Subagents the session dispatched |

Building types come from the session's dominant kind of work:

- **Workshop** (crane): editing code
- **Library** (pitched roof): reading and searching
- **Factory** (chimney): running commands
- **Observatory** (dome): web and browser work
- **HQ** (antenna and dish): dispatching subagents
- **Exchange** (gold spire): MCP tools
- **Café** (umbrellas): mostly conversation

## Inside a building

Each room is furnished with what the session did: a bookshelf (reading and
searching), a workbench (editing), a terminal rack (commands), a globe (web
and browser), a switchboard (MCP tools), and always the workbench and coffee
machine. Hover one to see how much of that work the session did. Drag to look
around; click the EXIT door (or press Escape) to go back outside.

The session's agent is the robot:

- **Working:** it walks to the station for what it's doing right now, with
  its latest action in a speech bubble
- **Waiting for you:** it stands in the middle waving at you
- **Idle:** it's at the coffee machine
- **Closed:** it's asleep

Subagents work at the desks in the middle. The side panel shows the stats,
the latest actions, the full story and the command to resume the session.

## Share your city

**Share** makes a postcard from a snapshot of your 3D city, with your stats on it.
Project names are hidden unless you turn them on. Download it, copy it, or
post it to X or LinkedIn. The image is made on your machine and only goes
where you put it.

## What happened in a session

**Read the full story** (inside any building) opens the session as a story, built on your
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

No npm dependencies; requires Node 18+. [Three.js](https://threejs.org) (MIT) is
vendored in `public/three.js` and `public/three-core.js` so the page never loads
anything from the internet. Open the page with `?debug` to get `window.sc`
(the city, game state and app state) in devtools.

Branches: `main` is released, `develop` is integration, and every change goes
on its own branch with a PR into `develop`.
