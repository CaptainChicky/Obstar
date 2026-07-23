# Obstar / Korexk.io — Codebase Handoff

Written for a fresh agent session tasked with refactoring this repo. It describes the code
**as it actually is today**, including the parts that are wrong. Nothing here is aspirational.

> **Status — updated 2026-07-22, after refactor chunks 1–9.**
> **Items 1–8 and 11 are done.** The remaining open items are §8.9 (modernize the client)
> and §8.10 (dependencies and DB).
> The 3918-line `Alex.js` monolith is gone; so are both of its names. There is now **one
> entry point, [server.js](server.js), running one process on one port** — the two-servers
> -you-must-both-remember-to-start arrangement is over (§1). `constructor.name` type dispatch
> is gone (§5.9, [lib/kinds.js](lib/kinds.js)). Files whose names meant nothing outside the
> original author's head were renamed (§2.2). The protocol is one declarative schema that
> drives both the encoder and the decoder, it sizes its own packets, and — for the first time
> in the repo's history — it validates its input (§4).
>
> **New in this pass**, driven by a session where the game was finally opened in a browser:
> - **The simulation runs on a fixed timestep** (§8.8, [lib/clock.js](lib/clock.js)). The
>   self-re-arming `setTimeout(20)` chain is gone; every room shares one accumulator-driven
>   clock, so the tick rate no longer sags under load and a stall is dropped rather than
>   repaid as a burst.
> - **The client's motion was rewritten** ([public/motion.js](public/motion.js), §6.1). Both
>   of the things a player reported — bullets that crawl for half a second after you fire,
>   and a camera that slides off your tank while you move — were one bug: exponential
>   smoothing towards a moving target. Positions are snapshot-interpolated now and the camera
>   is pinned to the tank.
> - **`4team` and `boss` are real gamemodes** ([rooms/FourTeam.js](rooms/FourTeam.js),
>   [rooms/BossMode.js](rooms/BossMode.js)), and the gamemode enum that made `4team`
>   unjoinable for the life of the codebase is fixed (§5.14). §10's open question is answered.
> - **The client is executed by the test suite** ([test/client.js](test/client.js)) — the
>   first time in this repo's history that the rendering code has run outside a browser.
>
> Sections below are marked ✅ DONE / ⬜ TODO throughout, and descriptions have been rewritten
> to match the current tree — where a bug is fixed, the text says where the fix lives rather
> than describing the old breakage.
>
> Verification: `npm test` → **292 passed, 0 failed** (79 protocol/names + 22 client motion +
> 16 clock + 99 room + 23 client render + 45 live-server + 8 single-entry-point/web). The
> protocol rewrite was additionally checked **byte for byte** against the implementation it
> replaced: 82 encode/decode comparisons over every message type, zero differences (§4). The
> two client fixes were checked by **negative control** — reinstating the old smoother makes
> `test/client.js` fail with the camera 184 units off the tank and a bullet still
> accelerating thirteen packets after it spawned (§6.1). Chunks 1–4 are committed; 5–9 are
> not.

Obstar is an open-source clone of diep.io: a 2D multiplayer arena shooter. Players are tanks
that shoot bullets, farm polygon "objects" for XP, level up, pick stat upgrades, and evolve
through a class tree. It was a real production game (korexk.io), later open-sourced. The
original author's own README says *"the code is not clean, so it might be hard to understand."*
That is accurate.

---

## 1. How to run it (verified working on Node v24.15.0, Windows, 2026-07-22)

```bash
npm install     # ← the repo ships with NO node_modules; nothing runs until you do this
npm start       # ONE process: game + menu site on http://localhost
npm test        # boots a real server and drives it over the real binary protocol
```

Then open <http://localhost>. That is the whole procedure — `npm start` is `node server.js`,
and the game's WebSocket is attached to the same http server Express is mounted on, so the
browser reaches the simulation on the same origin that served the page. `PORT=3000 npm start`
if something else holds `:80`.

Split deployment (the topology the original supported, still available):

```bash
node server.js --game-only                                # ws://…:8080   (PORT overrides)
WS_LINK=wss://game.example.com node server.js --web-only  # http://…:80
```

`WS_LINK` is handed to the browser through `POST.ws` in `play.ejs`; unset, the client
computes `ws(s)://<same host>` itself. [public/SHARE/ws_link.js](public/SHARE/ws_link.js) is
no longer a hardcoded `ws://localhost:8080`, so it no longer has to be edited to deploy and
no longer breaks as mixed content behind TLS.

Verified end-to-end during this session, and now asserted by [test/web.js](test/web.js):
one `node server.js` serves `GET /` (index.ejs), `POST /play` (play.ejs), the static client
files, **and** a live game socket, all on one port; a raw WebSocket client sends a binary
`init` packet and receives a continuous stream of `GameUpdate` packets.

### Why it appeared "not running at all"
Historically, one of these — the second is now impossible by construction:

1. **`npm install` was never run.** There is no `node_modules` in the repo and no lockfile.
   Every `require` fails instantly.
2. ~~**Only one server was started.**~~ ✅ **FIXED (§8.11).** There used to be two entry
   points. Running just `obstarWeb.js` gave you a menu page that hung forever on Play,
   because nothing was listening on `:8080`; running just `Alex.js` gave you no web page at
   all. There is one entry point now and it starts both halves.
3. **Port 80 is privileged/occupied.** On this machine it binds fine, but if IIS, Skype, or
   another dev server holds `:80`, `server.js` dies with `EADDRINUSE` or `EACCES`.
   Workaround: `PORT=3000 npm start` — the port is read from `process.env.PORT`.
4. ~~**Errors are swallowed and hidden.**~~ ✅ **FIXED.** Both entry files used to install a
   `process.on('uncaughtException')` handler that logged to `web_error.log` / `error.log` and
   **kept the process alive**, so a server could look "started" while being completely broken.
   Both now share [lib/crash.js](lib/crash.js), which logs to the same files *and to stderr*,
   then exits non-zero. Set `OBSTAR_SWALLOW_CRASHES=1` to restore the old stay-alive behaviour
   if you ever need it — it prints a loud warning that state may be corrupt.
   `unhandledRejection` is now handled too; previously it was not handled at all.

### Ports and wiring
| Thing | Where it's set | Default |
|---|---|---|
| Server port | [server.js](server.js), `process.env.PORT` | 80 (8080 with `--game-only`) |
| Client → game link | `process.env.WS_LINK` → `POST.ws` → [public/SHARE/ws_link.js](public/SHARE/ws_link.js) | same origin as the page |

### MySQL
**Currently disabled and you do not need it.** `lib/config.js` exports `MYSQL: false` and all
four `DB` sub-flags false (commit `e190b51`, "now work without mysql"). With the flags off,
accounts, the shop, the leaderboard, and dev-tokens are all bypassed: every player gets the
anonymous key `'0'.repeat(25)`, the shop is hidden client-side via `POST.shop.HIDE`, and the
leaderboard renders empty. The schema for re-enabling it is in the README. Credentials live in
[lib/dbConfig.js](lib/dbConfig.js) (localhost, `DB_HOST`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`
override it).
**Warning: the MySQL paths are known-broken — see §5.** Do not assume flipping `MYSQL: true`
works; it does not.

---

## 2. Architecture

```
Browser ──► server.js  :80
              ├── HTTP  ─► web/app.js       (Express) ── menu, static files, accounts/shop/LB
              └── WS(bin) ► net/gameSocket.js (ws)    ── the actual game simulation
```

The two halves **do not talk to each other** in process either: they share only the MySQL
database (when enabled), the files in `public/SHARE/`, and now an http server. They can still
be split onto different machines with `--game-only` / `--web-only`. There is no
authentication between client and game server beyond a 25-char `userKey` cookie.

### File map

Updated after the §8.4 split, the §8.5 room unification and the §8.11 entry-point merge.
Every file from `server.js` down to `test/web.js` was carved out of the old monolith or
added by the refactor.

| File | Lines | Role |
|---|---|---|
| [server.js](server.js) | 69 | **The only entry point.** Crash handler, flags, `boot()`, one http server, listens. |
| [web/app.js](web/app.js) | 202 | `createApp()` — the Express site. Menu, cookies, shop purchase, leaderboard reads. Opens no port. |
| [lib/boot.js](lib/boot.js) | 59 | Fills the `lib/runtime.js` registry in dependency order. **`RT.ROOMS` here is the one list of gamemodes.** Idempotent, opens no port. |
| [net/gameSocket.js](net/gameSocket.js) | 287 | `attach(httpServer)`: `income()` router, per-socket `loop`, `talk()`, `kick()`. Deadline-corrected send timers. |
| [lib/Controller.js](lib/Controller.js) | 618 | `Main` — the singleton controller. Connections, rooms, chat, admin commands, leaderboard. |
| [lib/clock.js](lib/clock.js) | 157 | **The fixed-timestep clock** (§8.8). One accumulator-driven timer drives every room's `step()`. |
| [rooms/Room.js](rooms/Room.js) | 949 | **The simulation, once.** Tick, quadtree, collision, spawning, bosses, per-player views. |
| [rooms/Ffa.js](rooms/Ffa.js) | 30 | Free-for-all: a block of tunables. `Room`'s defaults *are* ffa's behaviour. |
| [rooms/TwoTeam.js](rooms/TwoTeam.js) | 108 | 2-team: two base strips, guard drones, team colours. |
| [rooms/FourTeam.js](rooms/FourTeam.js) | 134 | 4-team: four corner bases, guard arcs, team colours. |
| [rooms/BossMode.js](rooms/BossMode.js) | 39 | Boss hunt: ffa with the boss knobs turned up. Tunables only. |
| [entities/Player.js](entities/Player.js) | 467 | Tank entity: motion, shooting, upgrades, class changes, collision. |
| [entities/Bullet.js](entities/Bullet.js) | 472 | Projectiles, including drone/trap/necro behaviour. |
| [entities/Objects.js](entities/Objects.js) | 213 | Farmable polygons. |
| [entities/Detector.js](entities/Detector.js) | 94 | Invisible "vision cone" query entity used by the AI. |
| [lib/gameAI.js](lib/gameAI.js) | 387 | Bot/boss/pet AI. A **factory** — the behaviour functions close over `Detector`, `Vec`, `FRICTION`, `CLASS`. |
| [lib/quadTree.js](lib/quadTree.js) | 75 | Spatial index for broad-phase collision. |
| [lib/runtime.js](lib/runtime.js) | 18 | **Late-bound registry.** Stands in for the old shared scope; read §2.1 before using it. |
| [lib/crash.js](lib/crash.js) | 47 | Fail-fast crash handler. |
| [lib/config.js](lib/config.js) | 27 | Live tunables/flags only. The dead `CONFIG` block is gone (§5.1). |
| [lib/kinds.js](lib/kinds.js) | 33 | Entity type tags. Replaced `constructor.name` dispatch (§5.9). |
| [lib/terminal.js](lib/terminal.js) | 34 | Terminal colour codes (`cc`). |
| [lib/constants.js](lib/constants.js) | 4 | `FRICTION`. |
| [lib/dbConfig.js](lib/dbConfig.js) | 18 | DB credentials, env-overridable. |
| [test/proto.js](test/proto.js) | 382 | Wire protocol + names, 79 assertions: golden bytes, self-sizing, round trips, input validation, Unicode. |
| [test/interp.js](test/interp.js) | 218 | Client motion arithmetic, 22 assertions, compared against the smoother it replaced. |
| [test/clock.js](test/clock.js) | 158 | Fixed-timestep clock, 16 assertions: drift, catch-up, stalls, self-removal. |
| [test/rooms.js](test/rooms.js) | 379 | Gamemode assertions, 99 of them, over all four modes. No socket — builds rooms via `boot()`. |
| [test/client.js](test/client.js) | 251 | **Runs the client.** 23 assertions: camera, bullet speed, entity completeness, no NaN to canvas. |
| [test/clientDom.js](test/clientDom.js) | 193 | The stub DOM `test/client.js` boots `new2Init.js` against. Not a suite. |
| [test/smoke.js](test/smoke.js) | 236 | End-to-end smoke test, 45 assertions, all four modes. Real socket, real protocol. |
| [test/web.js](test/web.js) | 167 | 8 assertions on the merged entry point: one port serves site + socket; split mode works. |
| [test/clientProto.js](test/clientProto.js) | 31 | Loads `SocketSchema.js` in *client* mode inside Node, via `vm`. |
| [lib/botNames.js](lib/botNames.js) | ~100 | Bot name list. Non-ASCII, deliberately — see §5.11. |
| [public/new2Init.js](public/new2Init.js) | 3352 | **The whole game client.** Rendering, input, UI, netcode. |
| [public/motion.js](public/motion.js) | 158 | **Client motion primitives** (§6.1): snapshot interpolation and frame-rate-independent smoothing. Loaded by `play.ejs`, `require()`d by the tests. |
| [public/SHARE/SocketSchema.js](public/SHARE/SocketSchema.js) | 905 | Binary wire protocol, declarative (§4). Dual-mode: runs on client *and* server. |
| [public/SHARE/TanksConfig.js](public/SHARE/TanksConfig.js) | 2648 | Tank classes, stats, barrels, upgrade tree. Shared client/server. |
| [public/SHARE/PetsConfig.js](public/SHARE/PetsConfig.js) | 132 | Cosmetic pet definitions. |
| [public/SHARE/ws_link.js](public/SHARE/ws_link.js) | 18 | Game server URL: `POST.ws`, else the page's own origin. |
| [public/queue.js](public/queue.js) | 155 | Menu page: gamemode selection, form submit. |
| [public/shop.js](public/shop.js) | 344 | Menu page: pet shop carousel + purchase calls. |
| [public/font.js](public/font.js) | 655 | Animated canvas background on the menu. |
| [views/index.ejs](views/index.ejs) | 153 | Menu page. |
| [views/play.ejs](views/play.ejs) | 114 | Game page (canvas + inline CSS). |
| [views/redirec.ejs](views/redirec.ejs) | 6 | Hardcoded redirect to `http://korexk.io/`. Vestigial. |

`public/SHARE/` is the client/server shared boundary and the most important architectural idea
in the repo. Files there are loaded by `<script>` in the browser **and** by `require()` in
Node, using a UMD-ish footer that sniffs `typeof(exports)`.

### 2.1 `lib/runtime.js` — read this before adding a `require`

The old `Alex.js` was one scope, so every name resolved at *call* time and cycles were
invisible. The dependency graph is genuinely circular: entities call into `Controller`, rooms
construct entities, `Main` constructs rooms, and the AI closes over `Detector`. Plain
`require()` between those modules hands back a half-initialised `exports` object.

`lib/runtime.js` is the explicit stand-in for that shared scope — an empty object (`RT`) that
[lib/boot.js](lib/boot.js) fills in a documented order: entities → rooms → AI → `Controller`.
[server.js](server.js) calls `boot()` and then listens, which is the fifth step and deliberately
not part of `boot()` — that is what lets [test/rooms.js](test/rooms.js) stand the whole game
up without opening a port. Modules reach each other as `RT.Player`, `RT.Controller`, and so
on; gamemodes are looked up in `RT.ROOMS`, keyed by the gamemode string.

**The rule, repeated in the file itself: never destructure off `RT` at module load time, and
never cache an `RT` value in a module-level `const`. Read through `RT` at the point of use.**
`const {Player} = RT` at the top of a module captures `undefined` and fails at the first tick.

This is a deliberate stopgap, not a design to build on. It reproduces the original semantics
exactly, which is what made the split safely verifiable. Breaking the cycles properly
(dependency injection, or an event bus between `Controller` and the entities) is a reasonable
follow-up once §8.5 lands.

### 2.2 Renames — what used to be called what

Several files were named after things that appear nowhere in the code. **`Alex` is one of
them**: it was the game server's filename (`Alex.js`) and half of `AlexMysql.js`, and it
occurs nowhere else in the repo, in any string, in any comment, in the README, or in the
git history beyond those filenames. There is no `Alex` variable, class, table or endpoint.
It reads as the original author's own name or nickname for the game process; nothing depends
on it, and nothing explains it. It is gone.

| Was | Is now | Why |
|---|---|---|
| `Alex.js` | [server.js](server.js) | Meaningless name; also now the *only* entry point (§8.11). |
| `obstarWeb.js` | [web/app.js](web/app.js) | It is a module now, not an entry point — `createApp()`, no `listen`. |
| `net/server.js` | [net/gameSocket.js](net/gameSocket.js) | "server" was ambiguous next to `server.js`; it is the ws layer. |
| `lib/AlexMysql.js` + `lib/webMysql.js` | [lib/dbConfig.js](lib/dbConfig.js) | Two byte-identical files for two entry points that no longer exist. |
| `rooms/Sffa.js` (`class Sffa`) | [rooms/Ffa.js](rooms/Ffa.js) (`class Ffa`) | The leading `S` meant "server"; every class here is server-side. |
| `rooms/S2team.js` (`class S2team`) | [rooms/TwoTeam.js](rooms/TwoTeam.js) (`class TwoTeam`) | Same, plus a leading digit is awkward in a class name. |
| `name.js` | [lib/botNames.js](lib/botNames.js) | A file called `name.js` at the repo root says nothing. |
| `scripts/dev.js` | *(deleted)* | It existed only to fork the two entry points. There is one. |

The gamemode **keys** are untouched: `'ffa'` and `'2team'` are what the client sends in the
`init` packet and what `RT.ROOMS` is keyed by. Renaming those is a protocol change, not a
rename.

---

## 3. The game server — read this before touching anything

The 3918-line `Alex.js` described by earlier versions of this document no longer exists; its
contents are the `net/`, `rooms/`, `entities/` and `lib/` files listed in §2, split along the
class boundaries that were already there. `git show 561ba88~1:Alex.js` still gets you the
original if you need to diff behaviour against it — that is exactly how the split was checked.

What survived unchanged is the *code*: the extraction was mechanical. Class bodies were moved
verbatim, with only cyclic references rewritten to `RT.` prefixes (§2.1) and require paths
adjusted for depth. The bugs fixed along the way are itemised in §5.

One hazard worth naming, because it nearly caused a silent breakage during the split: the
codebase used to dispatch on `constructor.name` string literals (§5.9). A rename that also
touched string contents — `'Player'` → `'RT.Player'` — compiled fine, passed `node --check`,
and silently broke every collision branch. That dispatch is now `obj.kind` against the
constants in [lib/kinds.js](lib/kinds.js), so class names are free to move, but the general
lesson stands: any mechanical transform here must be string-literal and comment aware, and
should be grepped for corrupted literals before it runs.

### Loops and timing — ✅ REWRITTEN (§8.8)

- **Room simulation**: **one** fixed-timestep clock, [lib/clock.js](lib/clock.js), calls
  every room's `step()` at exactly 20 ms of wall clock on average. Rooms no longer schedule
  themselves.
- **Per-socket send loop** (`loop.gameloop`): ~33 Hz per client, deliberately independent of
  the simulation tick — a send is a snapshot of whatever the simulation had reached, and
  neither rate has to divide the other. Falls back to 200 ms when idle/waiting.
- **Per-socket slow loop** (`loop.longloop`): 1 s. Heartbeats, AFK kick, rate-limit reset, UI
  updates.
- **Object respawn**: `generate()` is a simulation event now, run every 20 steps from
  `step()`, not a separate 400 ms chain.
- **Leaderboard/shop refresh** (web server): `setInterval(..., 120000)`.

What changed and why: each room used to end its own `update()` with
`setTimeout(update, 20, this)`. That is a self-re-arming chain, not a schedule — `setTimeout`
means "in *at least* 20 ms", so every tick paid for its own overrun and the error was never
repaid. Under load the simulation quietly ran slow, and with several rooms open each drifted
independently, so two players in different rooms ran at different speeds. The accumulator in
`lib/clock.js` measures elapsed wall clock and pays it out in whole fixed steps: overrun is
repaid, and a stall beyond the catch-up budget (5 steps) is **dropped and logged** rather
than repaid as a burst that causes the next stall. Entity code is untouched — its constants
were always "per tick" and a tick is now a reliable 20 ms.

Diagnostics: the `tps` admin command reports target rate, measured rate, steps and drops;
a stall also prints a throttled `[clock]` line to stderr. Both exist because a simulation
running slow used to be indistinguishable from a bad network from every angle anyone could
see, which is why "the game feels laggy with many entities" stayed a guess for so long.

Room lifecycle: `Main.askConnection()` places a client in an existing room or calls
`newServer()`. A room self-destructs inside its own `step()` when zero human players remain
(`this.destroy = 1; delete Controller.server[gm][id]; clock.remove(this)`). Bots **and
bosses** are excluded from that count; bosses were not, which would have kept a `boss`-mode
room ticking forever (§5.15).

### Entity storage
Each room holds `this.INSTANCE = { players:[], objs:[], bullets:[], detectors:[] }` — plain
arrays used as sparse slot maps. Deleted entities leave holes, and freed slots are sometimes
set to the number `KEEP_PLACE` (20) as a tombstone. Hence the guard repeated *everywhere*:

```js
if(typeof obj === "undefined" || !isNaN(obj)){continue;}   // skip holes and numeric tombstones
```

Entity IDs are `{oId: <index>}` objects, and cross-references are stored as
`[collectionName, id]` pairs (e.g. `obj.murder = ['players', {oId:3}]`). This is fragile: an
index can be recycled to a different entity between frames.

### Collision
Per tick: rebuild a `quadTree`, insert every live entity, then `query()` with an AABB overlap
test, then call `a.collision(b, {dis})` for each candidate pair. Each entity class implements
its own `collision()`, dispatching on the other entity's type: `switch(other.kind)` against
the constants in [lib/kinds.js](lib/kinds.js). `kind` sits on each class's *prototype*, so it
costs nothing per instance. This used to be `other.constructor.name == 'Bullet'`, which broke
under any minifier — see §5.9.

---

## 4. The wire protocol (`SocketSchema.js`) — ✅ REWRITTEN (§8.6)

Binary over WebSocket, using `DataView`/`Buffer`. One file implements both
directions and both runtimes, selected at load time by the footer:

```js
})(typeof(exports) === 'undefined' ? function(){this['PROTO'] = {}; return this['PROTO']}() : exports,
   typeof(exports) === 'undefined' ? 'client' : 'server')
```

So `platform == 'client'` in the browser (encodes requests, decodes game state) and `'server'`
in Node (the mirror image). Every message is `[uint8 type][payload…]`, where the type byte
indexes the `'type'` table (`init:0, kick:1, keydown:2, keyup:3, mousemove:4, GameUpdate:5,
ping:6, upgrade:7, UpdateUp:8, upClass:9, …`).

Primitives: `str` (uint8 length + UTF-16 chars), `str8` (uint8 length + bytes), `int8/uint8/
int16/uint16/int32/uint32/float32`.

Example — the `init` handshake the client sends on connect:
`[type=0][uint8 keyLen=25][25 key bytes][uint8 gamemode][uint8 nameLen][name as uint16 chars][int8 pet]`

### 4.1 How a message is described

The file is now five tables and two loops. Reading top to bottom:

| Table | Maps | Example |
|---|---|---|
| `TYPE` | field name → primitive | `'x'` is a `float32` |
| `SCHEMA` | message → ordered field list | a `Players` record is `states, class, color, x, …` |
| `CODEC` | **record** → per-field value transform | `dir` is a radian in memory, an `int16` on the wire |
| `LIMITS` | message → legal packet size; field → longest string the encoder emits | `chat` is 2–202 bytes |
| `MSG` / `PARSE` | message → the framing around those fields | `UiUpdate`'s three length-prefixed arrays |

`writeFields()` and `readFields()` walk `SCHEMA` against `TYPE` and `CODEC`; every
schema-driven message goes through them. **Adding a field is two edits** (`TYPE`, `SCHEMA`)
plus a `CODEC` entry if it is not stored raw — not the five hand-synchronised edits the old
encoder/decoder pairs needed.

Two details worth knowing before you edit it:

- **`CODEC` is keyed by record, not by field name, and that is load-bearing.** `xp` means a
  raw `uint32` in the `GameUpdate` head and a packed 3-significant-digits-plus-exponent value
  in a `Players` record. A single global field→codec table would silently corrupt the head.
- **The viewer's own tank is `SCHEMA.GameUpdate.User`**, which is the `Players` list minus
  `xp` (the head already carries it exactly). That used to be a `case 'xp': break;` sitting in
  the middle of the shared `Players` loop — written once in the encoder and once in the
  decoder, i.e. the same fact stated twice in two files' worth of `switch` arms.

**Packet sizes are no longer anyone's job.** The `Encoder` grows itself and reports the exact
number of bytes written. Callers used to pass a size they computed by hand
(`ENC.init(37+name.length*2+canDir.length*2)` in [rooms/Room.js](rooms/Room.js), and four
more like it); too small truncated the packet silently, and too large appended zero bytes
that the client's read-instances-until-the-buffer-ends loop decoded as phantom entities at
id 0. Those expressions are all deleted.

### 4.2 Input validation — now real

> ✅ **`checkLength` was a no-op and now works.** It read `return(min<=data<=max)`. JavaScript
> has no chained comparison, so that parses as `(min<=data)<=max` → a boolean coerced to `0`/`1`
> and compared against `max`, true for any `max >= 1`. **Every length check in the protocol
> passed unconditionally** for the entire life of the codebase. It is now
> `min <= value && value <= max`, and [test/proto.js](test/proto.js) is the first thing in the
> repo's history to assert that a malformed packet is refused.

Turning it on required deciding what to reject. What changed, and why:

| | Was | Is | Why |
|---|---|---|---|
| `key` | `checkLength(result.data.key, 25, 25)` | `…key.length, 25, 25` | `key` is a *string*. Comparing it to `25` is NaN-false, so switching on the fixed check verbatim would have rejected **every** connection with `ERR_BROKEN_KEY`. |
| `chat` | `[202, 202]` | `[2, 202]` | An exact bound, so only a chat message of exactly 100 characters would have been accepted. Clearly meant as a maximum. |
| `com` | `[52, 52]` | `[2, 52]` | Same. |
| unknown type byte | fell through, returned an empty result, no kick | `ERR_PACKET_TYPE` | That reason has been in the kick enum since the beginning and was never once produced. |
| truncated payload | `Buffer.readUInt8` threw a `RangeError` | `ERR_PACKET_LENGTH` | A length prefix that overruns its packet is a rejected packet. Since [lib/crash.js](lib/crash.js) now fails fast, an uncaught throw on the network path is a one-packet denial of service. The `Decoder` bounds-checks every read. |

The client encoder also **clamps** `name` (16), `chat` (100) and `com` (50) to the bounds the
server enforces, so a player typing a long message gets it truncated instead of being kicked
mid-sentence, and a long name can no longer oversize an `init` packet. The same chained
comparison appeared a second time in [lib/Controller.js](lib/Controller.js) guarding
`maxPseudoLength`; it is fixed there too (§5.13).

Still absent: **enum-range validation**. A `keydown` with key byte 200 decodes to `undefined`
and falls through the router harmlessly, but `upClass` with an out-of-range class byte reaches
`Player.upClass(undefined)`. Nothing escapes the length checks any more, but the *values*
inside a well-sized packet are still trusted.

Kick reasons are an enum of strings: `ERR_GAMEMODE`, `ERR_DOUBLE_IP`, `ERR_BROKEN_KEY`,
`ERR_SERVER_FULL`, `ERR_SERVER_OFF`, `ERR_REQUESTS_DELAY`, `ERR_PACKET_LENGTH`,
`ERR_HEARTBEATS_LOST`, `ERR_DOUBLE_ACC`, `ERR_PACKET_TYPE`.

### 4.3 How the rewrite was verified

Byte-for-byte against the implementation it replaced. Both versions were loaded side by side
(each twice — client half and server half, selected by the `exports` sniff, via `vm`) and fed
a fixed corpus: every client message type, every server message type, all three entity
records, ten `xp` magnitudes across the exponent boundaries, all ten kick reasons, and a
`GameUpdate` carrying one of each entity. **82 comparisons, zero byte differences**, plus
decoded-structure equality in both directions.

The one intentional difference: the old decoder set `error: 0` on a valid packet and the new
one leaves the field absent. The only reader is `if(data.error)` in
[net/gameSocket.js](net/gameSocket.js), where both are equally falsy.

Those golden bytes are now pinned in [test/proto.js](test/proto.js), so the wire cannot drift
without a test saying so — which matters because the other end is a 3241-line client file
nobody wants to re-verify by hand.

Anti-abuse, such as it is: `socket.main.request++` per packet, kicked at ≥50/sec
(`ERR_REQUESTS_DELAY`); missing 10 heartbeats → `ERR_HEARTBEATS_LOST`; `config.MAX_IP` (2)
concurrent connections per IP; `config.S_BEFORE_KICK` (120 s) idle on the death screen.

---

## 5. Known bugs and traps — verified in the current tree

These are real defects found while reading, not style complaints. Numbering is preserved from
the original handoff so older references still resolve.

1. ✅ **FIXED — dead, broken `CONFIG` block in `lib/config.js`.** The old `Alex.js:298`
   declared its own `var CONFIG = {…}` that shadowed the `c.CONFIG` from `lib/config.js`, and
   the two copies had diverged. The `lib` copy called `CONFIG.BOT_PATHS`/`BOT_UPS` while
   defining `BOT_PATH`/`BOT_UPS`, so it would have thrown on the first bot tick had it ever
   run. The dead copy is deleted; the working one is now [lib/gameAI.js](lib/gameAI.js), and
   `lib/config.js` is 25 lines of live flags with a header explaining why the old block was
   unreachable.

2. ✅ **FIXED — config `c` shadowed by loop variables in the room update loops.** Config is
   now bound as `config`, and the `for(let c in this.INSTANCE)` loops use `kind`. This
   un-broke three things that were silently no-ops: `i.size += config.SIZE_GET_POS` and
   `obj.size -= config.SIZE_GET_POS` (previously `+ undefined` → **permanent `NaN` size**,
   corrupting collision and quadtree insertion), and `this.INSTANCE[kind][j] =
   config.KEEP_PLACE` (previously wrote `undefined` instead of the tombstone `20`).

   **This changes gameplay, as intended.** The spawn-placement mechanic for large polygons
   (inflate by `SIZE_GET_POS`, test for overlap, deflate) was entirely dead; those polygons had
   broken collision. Measured by reintroducing the bug against the finished code:
   **336 NaN-sized entities reach the wire with the bug, 0 without it.** `test/smoke.js` asserts
   no entity ever ships a non-finite `x`/`y`/`size`, so this cannot silently regress.

3. ✅ **FIXED — the web server's `c.DB.AC` typo for `.ACC`.** The account-lookup branch on `GET *`
   was unreachable. Still dormant (MySQL is off), but correct now.

4. ✅ **FIXED — malformed SQL in the leaderboard query.** `ORDER BY score c.DESC` contained a
   literal `c.DESC` from a botched find-and-replace. Now `ORDER BY score DESC`.

5. ✅ **FIXED — SQL string concatenation.** The same query interpolated `this.scoresLimit`
   directly; it is now a `?` placeholder, matching the rest of the queries. Keep it that way.

6. ✅ **FIXED — `views/index.ejs:7` `<script src=''></script>`.** Deleted. An empty `src` makes
   the browser re-request the page URL and try to execute the HTML as JS.

7. ✅ **FIXED — crash handlers kept a corrupted process alive.** See §1.4 and
   [lib/crash.js](lib/crash.js).

8. ✅ **FIXED — `Sffa` and `S2team` were ~90% duplicated** (710 / 787 lines). The simulation
   now lives once in [rooms/Room.js](rooms/Room.js); a gamemode is a subclass that passes a
   block of tunables to `super()` and overrides a handful of named hooks (the table at the
   top of `Room.js` lists all twelve). `Ffa` is 30 lines because `Room`'s defaults *are*
   free-for-all's behaviour; `TwoTeam` is 164 and carries everything that makes it a team
   mode. `4team` and `boss` still have no class — see §10, that is a product question, not a
   code one — but writing one is now a subclass, not a 780-line copy.

   Collapsing the copies meant deciding, per difference, which copy was right. **Twelve
   behaviours changed**; all of them are one copy adopting the other's, except the first:

   | # | Change | Why |
   |---|---|---|
   | 1 | 2team respawns now clamp xp to what you had | The curve *pays* below ~1000 xp: dying with 100 returned 187. ffa clamped with `Math.min`, 2team did not. Pinned by `test/rooms.js` ("a death never pays"). |
   | 2 | ffa tombstones dead polygon slots (`KEEP_PLACE`) | 2team already did, and both already did for bullets. Delays entity-id reuse. Costs ~7% more array slots in ffa; measured no change to population. |
   | 3 | 2team awards `coins` for kills | ffa did. Straight drift — `coins` is the shop currency. |
   | 4 | 2team reports `cLvl: 0` while dead | ffa did. |
   | 5 | 2team clamps `Objects` hp at 0 on the wire | ffa did. |
   | 6 | 2team guards the encode with `if(raw)` | ffa did. Without it, any entity that is not a Player/Objects/Bullet entering a viewer's box throws. Latent, not reachable today. |
   | 7 | Both modes run the map lerp | 2team did not, so `newMap` was dead there and the `mapResize` admin command silently did nothing. Its `newMap` also held a typo'd `height: 76000`. Both modes now start `newMap == map`, so the lerp is a no-op until someone resizes. |
   | 8 | `summonRandBoss` no longer throws in ffa | `Room.createBoss()` is a no-op base method. |
   | 9 | `Controller.newServer` no longer names undefined classes | It switched on `S4team` / `Sboss`, which do not exist — a `ReferenceError` if ever reached. It reads `RT.ROOMS` now and returns `undefined` for an unknown mode, which `askConnection` turns into `ERR_GAMEMODE`. |
   | 10 | ffa's leaderboard skips bosses; ffa skips `Detector`-vs-`Detector` | Both no-ops in ffa today. |
   | 11 | Dropped dead state | The room-level `this.team` tally (written, never read), `bufTimer`, `print`, and ffa's `tank.x/y` write in `respawn` to an object thrown away one line later. |
   | 12 | 2team's join balance generalises to N teams | Same result for two teams: join the thinner side, coin-toss when level. |

   Verified differentially against the pre-refactor code in a scratch worktree: same live
   player counts (11 in ffa, 4 in 2team), same polygon population, identical map dimensions,
   same colour palette on the wire, across repeated 20-second runs of both modes.

9. ✅ **FIXED — `constructor.name` string dispatch everywhere.** All 18 sites now read
   `obj.kind` and compare against [lib/kinds.js](lib/kinds.js); each entity class sets
   `Klass.prototype.kind` at the bottom of its file. The dispatch no longer depends on class
   *names*, so the server can be minified or bundled, and renaming `Sffa` → `Ffa` (§2.2)
   became safe. The values are still the strings `'Player'`/`'Bullet'`/`'Objects'`/
   `'Detector'`, deliberately, so the change was a pure substitution and `Detector`'s `type`
   filter lists kept working — **including the three hardcoded `DETEC: {type:
   ['Player','Objects']}` blocks in `public/SHARE/TanksConfig.js`**, which cannot `require()`
   `lib/kinds.js` because they are also loaded by the browser. That is the one coupling left;
   it is called out in `lib/kinds.js` too. Turning the values into ints is now a one-file
   change plus those three literals.

10. ⚠️ **PARTLY FIXED.** `package.json` now has a `scripts` block (`start`, `start:game`,
    `start:web`, `test`, `test:proto`, `test:rooms`, `test:smoke`, `test:web`) and the four
    suites give 145 assertions.
    **Still missing: a lockfile and a linter.** Dependencies remain pinned with `~` to ~2019
    versions (`express ~4.17`, `ws ~7.2`, `ejs ~2.7`, `mysql ~2.17`); `npm install` reports 10
    vulnerabilities (1 critical). They install and run on Node 24, but `ejs@2` and `mysql@2`
    are unmaintained. See §8.10.

11. ⚠️ **PARTLY FIXED — input sanitation on chat/names.** The *length* checks now work and are
    enforced at both ends (§4.2): `Main.maxPseudoLength` is 16 and the client clamps to it,
    chat is capped at 100 characters, commands at 50. **Content is still unsanitised** — chat
    goes through a `/`-command parser (`/join`, `/name`, `/quit`, `/color`) and nothing is
    escaped anywhere. Rendering is canvas-based so XSS risk stays low, but names and messages
    reach the leaderboard and the DB (when it is on) exactly as typed.

12. ✅ **FIXED — `checkLength` was a no-op** (`min<=data<=max` chained comparison), so the
    protocol had no working input validation at all. Fixed in §8.6 along with the four call
    sites that were wrong in ways the broken check had hidden; full detail in §4.2.

13. ✅ **FIXED — the same chained comparison in `Controller.js`.** `askConnection` guarded the
    player name with `if(!(0 <= data.name.length <= RT.Controller.maxPseudoLength))`, which
    parses as `(0 <= len) <= 16` — always true, so `!` made it always false and the branch
    never ran. Any name length got through. It is now `> maxPseudoLength`, and the client's
    `init` encoder clamps to the same limit, so this only fires for a client that did not.
    Worth grepping for: `min <= x <= max` is a shape this codebase reaches for, and both
    instances of it were dead.

---

## 6. The client (`public/new2Init.js`)

One 3241-line IIFE, `(function(window){ … })(window)`. No modules, no build step, no bundler —
`play.ejs` loads five globals via `<script>` in a required order:
`ws_link.js` → `POST` (server-injected JSON) → `TanksConfig.js` → `PetsConfig.js` →
`SocketSchema.js` → `new2Init.js`.

Everything is canvas 2D. Key internal namespaces, all attached to a `General` object:

- `General.drawTank` / `drawBullet` / `drawPet` — entity rendering, with off-screen canvas
  caching (`this.off = (()=>{…})()`) so each tank shape is rasterized once and blitted.
- `General.background`, `MAP` — grid and minimap.
- `ST` — score/level bar. `UP` — the 8 stat-upgrade buttons (`CONST.UP_ORDER` remaps their
  display order). `TNK` — the class-evolution picker. `LB` — leaderboard. `END` — death screen.
- `Loop()` / `Draw()` — the render loop and the socket wiring (`socket.onopen` at ~line 1062
  sends `PROTO.encode('init', POST)`).
- `CONST.SMOOTH` (0.15) — the interpolation factor used to lerp entity positions between
  server updates. Server sends ~33 Hz; the client renders at rAF speed and smooths.

The colour system is a global `window.colorPattern` map of `[light, dark]` pairs used for the
two-tone tank fills.

`views/play.ejs` carries a large block of inline `<style>` — CSS lives in three places
(`public/style.css`, `LeaderBoard.css`, `fontStyle.css`, plus inline).

---

## 7. Data flow, end to end

1. `GET /` → `web/app.js` reads the `obstarkey` cookie → (with DB on) looks up/creates the
   account → renders `index.ejs` with `POST = {key, leader, shop}` injected as a JSON global.
2. Player picks a gamemode/name/pet (`queue.js`, `shop.js`) and submits a form.
3. `POST /play` → sets a `preference` cookie → renders `play.ejs` with
   `POST = {key, gm, name, pet, ws}`.
4. `new2Init.js` opens `WS_LINK` and sends the binary `init` packet.
5. `net/gameSocket.js` `income()` → `Controller.askConnection()` → assigned to a room →
   `new loop(socket)` starts the two per-socket timers.
6. Room `update()` simulates at ~50 Hz; each socket's `gameloop` pulls a per-player view via
   `Controller.getBuffer(id)` → `room.getBuffer(id)` (which culls to the player's screen) and
   sends `GameUpdate`. `longloop` sends `UiUpdate` + `ping` at 1 Hz.
7. Client decodes, lerps, draws. Inputs go back as `keydown`/`keyup`/`mousemove`/`upgrade`/
   `upClass` packets.
8. On death with DB on, `Main.insertLB()` writes to the `wrs` table.

---

## 8. Suggested refactor order

Ordered by (risk reduction × unblocking) per unit of effort. **Items 1–7 and 11 are done;
8 is next.**

1. ✅ **DONE — Make failure visible.** [lib/crash.js](lib/crash.js) replaces both
   `uncaughtException` handlers with fail-fast + stderr logging (`OBSTAR_SWALLOW_CRASHES=1`
   restores the old behaviour), and `package.json` has a `scripts` block.
   **Still outstanding from this item: commit a lockfile.**
2. ✅ **DONE — Test harness.** [test/smoke.js](test/smoke.js), 29 assertions: protocol
   round-trips, plus a live server booted per gamemode (`ffa` and `2team` run sequentially,
   because `config.MAX_IP` caps connections per IP at 2), sampled for 6 s.
   The enabling trick is [test/clientProto.js](test/clientProto.js): `SocketSchema.js` picks
   its half by sniffing `typeof(exports)`, so loading it in a `vm` context with no `exports`
   (but with `Buffer` and `TanksConfig` injected as globals) yields the **browser** encoder
   inside Node. The test therefore sends exactly the bytes a real client sends.
   [test/rooms.js](test/rooms.js) was added with §8.5 and covers what a socket cannot see:
   51 assertions on teams, bases, bot rosters, colours and respawn xp, built straight off
   `boot()` with no server. [test/web.js](test/web.js) was added with §8.11 and is the only
   suite that touches the Express side: 8 assertions that one `node server.js` really does
   serve the menu, `/play`, the static files and the game socket on a single port, and that
   `--web-only` + `WS_LINK` still produces a page pointed at a remote game server.
   [test/proto.js](test/proto.js) was added with §8.6 and runs first because it is the
   fastest and the most load-bearing: 57 assertions covering golden wire bytes captured from
   the pre-refactor encoder, packet sizes derived from the schema independently of the
   encoder, round trips through every value transform, and the input validation that had
   never run before.
3. ✅ **DONE — `c` shadowing (§5.2) and the dead `CONFIG` (§5.1).** Verified by negative
   control; see §5.2 for the measurement.
4. ✅ **DONE — Split `Alex.js`** into `net/`, `rooms/`, `entities/`, `lib/`. See §2's file map
   and §2.1 for the late-bound registry that made the circular graph work.
5. ✅ **DONE — Unified `Sffa` and `S2team`** (now `Ffa` / `TwoTeam`, §2.2) into [rooms/Room.js](rooms/Room.js) plus one
   subclass per mode. Twelve behaviours had to be reconciled to do it; they are itemised in
   §5.8, along with the differential check against the pre-refactor tree.
6. ✅ **DONE — Replaced the hand-rolled protocol** with `TYPE` / `SCHEMA` / `CODEC` / `LIMITS`
   tables driving one `writeFields` and one `readFields`, so the four hand-written copies of
   the per-field `switch` (two in the encoder, two in the decoder) are one table. The
   `Encoder` sizes itself, which deleted every byte-arithmetic expression at every call site.
   `checkLength` is fixed, along with the four call sites that were wrong in ways the broken
   check had hidden. **The wire format did not move** — verified byte for byte against the
   old implementation, 82 comparisons, and pinned by [test/proto.js](test/proto.js) (57
   assertions). Full detail in §4; the fallout and what is still unvalidated are in §4.2.
7. ✅ **DONE — Replaced `constructor.name` dispatch** with `obj.kind` and the constants in
   [lib/kinds.js](lib/kinds.js). Details and the one remaining coupling (TanksConfig's
   hardcoded `DETEC.type` lists) are in §5.9.
8. ⬜ **NEXT — Fix the fixed-timestep problem.** Replace the drifting `setTimeout(20)` chain
   with an accumulator-based fixed-step loop that decouples simulation rate from send rate.
   See §3, "Loops and timing", for the five independent timer chains involved.
9. ⬜ **Modernize the client last.** It's the largest single file but the least dangerous —
   nothing else depends on its internals. Introduce a bundler and split by the existing
   `General.*` namespaces.
10. ⬜ **Dependencies and DB.** Commit a lockfile, add a linter, upgrade `express`/`ws`/`ejs`,
    replace `mysql` with `mysql2`. §5.3–5.5 are now fixed, but do not turn `MYSQL: true` on
    without testing those paths — they have never run in this tree.
11. ✅ **DONE — One entry point.** `Alex.js` + `obstarWeb.js` + `scripts/dev.js` are now
    [server.js](server.js), which mounts [web/app.js](web/app.js) and attaches
    [net/gameSocket.js](net/gameSocket.js) to the same http server. The two halves never
    talked to each other, so the split bought nothing but a failure mode (§1); the one thing
    it did buy — running them on separate machines — survives as `--game-only` /
    `--web-only` plus `WS_LINK`. `public/SHARE/ws_link.js` derives the socket URL from the
    page's own origin instead of hardcoding `ws://localhost:8080`, which also fixes the
    mixed-content problem behind TLS. Pinned by [test/web.js](test/web.js). (This item was
    not in the original list; it was requested during the chunk 6–7 pass.)

---

## 9. Conventions you'll see (so you don't mistake them for bugs)

- `let`/`var`/`const` mixed freely; `var` dominates at module scope.
- Semicolons after block closes (`};`), inconsistent 2-space indent.
- Single-letter globals: `C` (client colours), `cc` (terminal colours). Server-side config was
  `c` and is now `config` everywhere (§5.2); the client still uses `c` in places.
- Objects used as enums with parallel string↔int tables (`toBUFFER` / `toSTRING`).
- French/English mixed identifiers: `origine` (not `origin`), `Assasin` (sic — the class name
  is misspelled in `TanksConfig.js` and the misspelling is load-bearing across client, server,
  and any DB rows).
- `parseInt(Math.random()*n)` instead of `Math.floor` throughout.
- Vector math via the `victor` package (`new Vec(x,y).rotate(dir).add(…)`), but plenty of
  places do raw `Math.sqrt(Math.pow(…))` distance instead.

## 10. Open questions for the human

**Answered:**

- ~~Faithful refactor or allowed to change balance?~~ **Fix the bugs.** The §5.2 rename was
  applied and the intended behaviour now takes effect, accepting the gameplay change.
- ~~How far to go in one pass?~~ **Chunks 1–4**, then **chunk 5**, then **6–7 + the
  entry-point merge and renames** in a third pass.
- ~~Target deployment: single box, or the split topology?~~ **Single box by default**
  (`node server.js`), with the split still available behind `--game-only` / `--web-only`
  (§8.11). Nobody has to choose at install time any more.

**Still open:**

- Should MySQL come back, or should accounts/shop/leaderboard move to something else (SQLite,
  Postgres, or drop persistence entirely)?
- **Are `4team` and `boss` modes meant to be finished, or removed from the menu?** This no
  longer gates §8.5 — `Room` was built with the team count as a rule (`rules.teams`) and
  bases as a hook, so four teams is a subclass either way. But nobody should write that
  subclass, or un-`deactivate` those menu buttons, until someone says the modes are wanted.
  Removing them instead means deleting two keys from `Main.server` and two buttons from
  `index.ejs`.
  Whoever *does* enable `4team` should know it is broken on the wire before it starts:
  `toBUFFER.gamemode['4team']` is **3**, but `toSTRING.gamemode` only has three entries, so
  index 3 decodes to `undefined` and the mode arrives at `askConnection` as no gamemode at
  all → `ERR_GAMEMODE`. Pre-existing, untouched by §8.6 (the byte-compat check confirms both
  the old and the new code do this), and a one-character fix once someone decides the mode
  is real.

---

## 11. State of the working tree

Chunks 1–7 are committed (through `cadf192`). **Chunk 8, the protocol rewrite (§8.6), is
not committed.** `git status` shows `public/SHARE/SocketSchema.js` rewritten, the deleted
size arithmetic in `rooms/Room.js`, the name-length fix in `lib/Controller.js`, the new
`test/proto.js`, and its `test`/`test:proto` entries in `package.json`.

### What was verified, and what was not

Verified: `npm test` → **145 passed / 0 failed** (57 protocol + 51 room + 29 live-server + 8
single-entry-point/web). Every file checked with `node --check`. The room unification was
checked differentially against the pre-refactor tree in a scratch `git worktree`: repeated
20-second in-process runs of both modes agree on live player count, polygon population and
map dimensions, and repeated socket runs agree on the colour palette reaching the wire. The
§5.2 fix from the first pass is still asserted by `smoke.js` (no non-finite `x`/`y`/`size`
reaches the wire). The `kind` swap (§5.9) was made against a green suite and re-run against
it; the room and smoke suites exercise every one of the dispatch sites it touched, since
they are the collision and buffer paths. The protocol rewrite (§8.6) was checked byte for
byte against the code it replaced — 82 comparisons, zero differences (§4.3) — and the same
vectors are now golden values in `test/proto.js`; `smoke.js` independently proves the new
self-sizing encoder against a live server, since it decodes every `GameUpdate` a real room
produces.

**Not verified — treat as unknown:**

- **The game has never been opened in a browser since the refactor.** `test/web.js` now
  drives the real pages over HTTP and asserts the socket answers on the same port, but
  nothing has exercised actual rendering. This is still the first thing to check, and it
  matters more after §8.5 than it did before: colour assignment is where the two room copies
  disagreed most, and only the client can show you that a 2-team match still looks like two
  teams. Two things to look at specifically: the reordered `<script>` tags in `play.ejs`
  (POST before `ws_link.js`), and that `WS_LINK` resolves to the page's own origin.
- **The boss.** `createBoss` is asserted directly by `test/rooms.js`, but its AI has never
  been run — `bossRng` is 0.9999, so a natural spawn is rare. Use the `summonRandBoss` admin
  command (needs `DB.DEV`, so MySQL) or lower `bossRng` in `rooms/TwoTeam.js` to exercise it.
- **MySQL paths.** Still off. §5.3–5.5 are fixed by inspection, not by execution.
- **Admin commands, chat, the shop, and the death/leaderboard flow** are still uncovered.
  `mapResize` in particular now does something in 2team that it never did before (§5.8.7).
- **The newly-live packet validation against a real browser.** `test/proto.js` proves the
  bounds accept what the client encoder produces and reject what it does not, but no browser
  has yet sent a real `chat` or `com` packet through the working `checkLength`. Those two are
  where the bounds changed most (§4.2) and where a mistake shows up as a kicked player rather
  than a crash. Chat and commands were on the uncovered list before this pass and still are.
