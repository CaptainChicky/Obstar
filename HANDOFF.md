# Obstar / Korexk.io — Codebase Handoff

Written for a fresh agent session tasked with refactoring this repo. It describes the code
**as it actually is today**, including the parts that are wrong. Nothing here is aspirational.

Obstar is an open-source clone of diep.io: a 2D multiplayer arena shooter. Players are tanks
that shoot bullets, farm polygon "objects" for XP, level up, pick stat upgrades, and evolve
through a class tree. It was a real production game (korexk.io), later open-sourced. The
original author's own README says *"the code is not clean, so it might be hard to understand."*
That is accurate.

---

## 1. How to run it (verified working on Node v24.15.0, Windows, 2026-07-22)

```bash
npm install     # ← the repo ships with NO node_modules; nothing runs until you do this
node Alex.js        # game server  → ws://localhost:8080
node obstarWeb.js   # web server   → http://localhost:80
```

Two **separate processes**, in two terminals. Both are needed. Then open <http://localhost>.

Verified end-to-end during this session: `GET /` returns 200 and renders `index.ejs`;
`POST /play` renders `play.ejs`; a raw WebSocket client sent a binary `init` packet to
`Alex.js` and received a continuous stream of `GameUpdate` packets. The game logic works.

### Why it appeared "not running at all"
Almost certainly one of these, in order of likelihood:

1. **`npm install` was never run.** There is no `node_modules` in the repo and no lockfile.
   Every `require` fails instantly.
2. **Only one server was started.** Running just `obstarWeb.js` gives you a working menu page
   that hangs forever when you press Play, because nothing is listening on `:8080`. Running
   just `Alex.js` gives you no web page at all.
3. **Port 80 is privileged/occupied.** On this machine it bound fine, but if IIS, Skype, or
   another dev server holds `:80`, `obstarWeb.js` dies with `EADDRINUSE` or `EACCES`.
   Workaround: `PORT=3000 node obstarWeb.js` — the port is read from `process.env.PORT`.
4. **Errors are swallowed and hidden.** Both entry files install a `process.on('uncaughtException')`
   handler that logs to `web_error.log` / `error.log` and **keeps the process alive**. A server
   can therefore look "started" while being completely broken. *Always check those two log
   files when debugging.* This is also the single most dangerous habit in the codebase — it
   turns crashes into silent corruption.

### Ports and wiring
| Thing | Where it's set | Default |
|---|---|---|
| Web server port | `obstarWeb.js` (last lines), `process.env.PORT` | 80 |
| Game server port | `Alex.js` (last lines of the ws IIFE), `process.env.PORT` | 8080 |
| Client → game link | [public/SHARE/ws_link.js](public/SHARE/ws_link.js) | `ws://localhost:8080` |

`ws_link.js` is a **one-line hardcoded global** (`window.WS_LINK = 'ws://localhost:8080'`).
If you deploy, this must change, and it must become `wss://` behind TLS or browsers will
block it as mixed content.

### MySQL
**Currently disabled and you do not need it.** `lib/config.js` exports `MYSQL: false` and all
four `DB` sub-flags false (commit `e190b51`, "now work without mysql"). With the flags off,
accounts, the shop, the leaderboard, and dev-tokens are all bypassed: every player gets the
anonymous key `'0'.repeat(25)`, the shop is hidden client-side via `POST.shop.HIDE`, and the
leaderboard renders empty. The schema for re-enabling it is in the README. Credentials live in
[lib/AlexMysql.js](lib/AlexMysql.js) and [lib/webMysql.js](lib/webMysql.js) (both localhost).
**Warning: the MySQL paths are known-broken — see §5.** Do not assume flipping `MYSQL: true`
works; it does not.

---

## 2. Architecture

```
Browser
  ├── HTTP  ─────► obstarWeb.js  (Express)  :80   ── menu, static files, accounts/shop/LB
  └── WS(binary) ► Alex.js       (ws)       :8080 ── the actual game simulation
```

The two servers **do not talk to each other**. They share only the MySQL database (when
enabled) and the files in `public/SHARE/`. They can run on different machines. There is no
authentication between client and game server beyond a 25-char `userKey` cookie.

### File map

| File | Lines | Role |
|---|---|---|
| [Alex.js](Alex.js) | 3918 | **The whole game server.** Sockets, rooms, entities, physics, AI, chat, admin commands. |
| [obstarWeb.js](obstarWeb.js) | ~200 | Express web server. Menu, cookies, shop purchase, leaderboard reads. |
| [lib/config.js](lib/config.js) | 379 | Tunables + bot/boss/pet AI. **Half of it is dead code — see §5.** |
| [lib/AlexMysql.js](lib/AlexMysql.js) / [lib/webMysql.js](lib/webMysql.js) | 7 each | DB credentials. |
| [name.js](name.js) | ~100 | Bot name list. |
| [public/new2Init.js](public/new2Init.js) | 3241 | **The whole game client.** Rendering, input, UI, netcode. |
| [public/SHARE/SocketSchema.js](public/SHARE/SocketSchema.js) | 1158 | Binary wire protocol. Dual-mode: runs on client *and* server. |
| [public/SHARE/TanksConfig.js](public/SHARE/TanksConfig.js) | 2648 | Tank classes, stats, barrels, upgrade tree. Shared client/server. |
| [public/SHARE/PetsConfig.js](public/SHARE/PetsConfig.js) | 132 | Cosmetic pet definitions. |
| [public/SHARE/ws_link.js](public/SHARE/ws_link.js) | 1 | Game server URL. |
| [public/queue.js](public/queue.js) | 155 | Menu page: gamemode selection, form submit. |
| [public/shop.js](public/shop.js) | 344 | Menu page: pet shop carousel + purchase calls. |
| [public/font.js](public/font.js) | 655 | Animated canvas background on the menu. |
| [views/index.ejs](views/index.ejs) | 153 | Menu page. |
| [views/play.ejs](views/play.ejs) | 114 | Game page (canvas + inline CSS). |
| [views/redirec.ejs](views/redirec.ejs) | 6 | Hardcoded redirect to `http://korexk.io/`. Vestigial. |

`public/SHARE/` is the client/server shared boundary and the most important architectural idea
in the repo. Files there are loaded by `<script>` in the browser **and** by `require()` in
Node, using a UMD-ish footer that sniffs `typeof(exports)`.

---

## 3. The game server (`Alex.js`) — read this before touching anything

Structure, in file order:

| Lines | Contents |
|---|---|
| 1–24 | Crash-swallowing handler, MySQL pool, HTTP server (404s everything). |
| 25–263 | **The `ws` IIFE**: `income()` packet router, the per-socket `loop` class, `talk()`, `kick()`. |
| 266–660 | Terminal colors `cc`, `FRICTION`, `CLASS`/`CLASS_TREE` from TanksConfig, and a **second inline copy of `CONFIG`**. |
| 662–729 | `quadTree` — spatial index for broad-phase collision. |
| 730–1281 | `Main` (the singleton `Controller`) — connections, rooms, chat, admin commands, leaderboard writes. |
| 1282–1980 | `Sffa` — the free-for-all room. |
| 1981–2757 | `S2team` — the 2-team room. **~90% copy-paste of `Sffa`.** |
| 2758–3202 | `Player` — tank entity: motion, shooting, upgrades, class changes, collision. |
| 3203–3394 | `Objects` — farmable polygons (squares, triangles, pentagons). |
| 3395–3845 | `Bullet` — projectiles, including drones/traps/necro behaviour. |
| 3846–3917 | `Detector` — an invisible entity used as a "vision cone" query for AI. |
| 3918 | `var Controller = new Main();` |

### Loops and timing
There is **no single game loop**. Timing is a mesh of independent `setTimeout` chains:

- **Room simulation**: each room's `update()` ends with `setTimeout(..., 20, this)` → ~50 Hz,
  but it's `setTimeout` not `setInterval`, so it *drifts* under load and silently slows the
  whole simulation. This is why the game feels laggy with many entities.
- **Per-socket send loop** (`loop.gameloop`): `setTimeout(..., 30)` → ~33 Hz per client,
  independent of the simulation tick. Falls back to 200 ms when idle/waiting.
- **Per-socket slow loop** (`loop.longloop`): 1 s. Heartbeats, AFK kick, rate-limit reset, UI
  updates.
- **Object respawn**: `generate()` re-arms itself on a 300 ms timer.
- **Leaderboard/shop refresh** (web server): `setInterval(..., 120000)`.

Room lifecycle: `Main.askConnection()` places a client in an existing room or calls
`newServer()`. A room self-destructs inside its own `update()` when zero non-bot players
remain (`this.destroy = 1; delete Controller.server[gm][id]`).

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
its own `collision()` with type-name string dispatch (`other.constructor.name == 'Bullet'`).
**`constructor.name` string comparison is used for all type dispatch across the codebase** —
this breaks under any minifier, and is the reason you can't bundle the server.

---

## 4. The wire protocol (`SocketSchema.js`)

Hand-rolled binary over WebSocket, using `DataView`/`Buffer`. One file implements both
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

The server validates with `checkLength(data.byteLength, min, max)` and returns
`{error: 'ERR_PACKET_LENGTH'}` on mismatch, which causes a `kick()`. This length validation is
the *only* real input hardening in the protocol.

**Everything is positional and duplicated between the encode and decode halves.** Adding one
field to one message means editing the TYPE table, the SCHEMA table, the client encoder, the
server decoder, and the byte-size arithmetic in `ENC.init(n)` — five places, no shared source
of truth, no tests. Get the size wrong and you get silent truncation, not an error. **This is
the highest-value refactor target in the repo.**

Kick reasons are an enum of strings: `ERR_GAMEMODE`, `ERR_DOUBLE_IP`, `ERR_BROKEN_KEY`,
`ERR_SERVER_FULL`, `ERR_SERVER_OFF`, `ERR_REQUESTS_DELAY`, `ERR_PACKET_LENGTH`,
`ERR_HEARTBEATS_LOST`, `ERR_DOUBLE_ACC`, `ERR_PACKET_TYPE`.

Anti-abuse, such as it is: `socket.main.request++` per packet, kicked at ≥50/sec
(`ERR_REQUESTS_DELAY`); missing 10 heartbeats → `ERR_HEARTBEATS_LOST`; `c.MAX_IP` (2)
concurrent connections per IP; `c.S_BEFORE_KICK` (120 s) idle on the death screen.

---

## 5. Known bugs and traps — verified in the current tree

These are real defects found while reading, not style complaints. A refactor should fix or at
minimum preserve awareness of each.

1. **`lib/config.js`'s `CONFIG` block is dead code, and it's the broken copy.**
   `Alex.js:298` declares its own `var CONFIG = {…}` (lines 298–660) that shadows the
   `c.CONFIG` coming from `lib/config.js`. The two copies have diverged. The `lib` copy
   references `CONFIG.BOT_PATHS` and `CONFIG.BOTS_UPS` (`lib/config.js:5,8`) but defines the
   keys as `BOT_PATH` and `BOT_UPS` (`lib/config.js:216,241`) — it would throw on the first
   bot tick if it were ever used. `Alex.js` has the corrected names. **Only the flag block at
   the bottom of `lib/config.js` (`MYSQL`, `DB`, `MAX_IP`, …) is live.** Anyone editing bot AI
   in `lib/config.js` is editing a file that never executes — an easy hours-lost trap.

2. **Config variable `c` is shadowed by loop variables inside the room update loops.**
   `Alex.js` binds config to the one-letter global `var c`. Both room classes then write
   `for(let c in this.INSTANCE)`, shadowing it. Inside those loops:
   - `Alex.js:1534` `i.size += c.SIZE_GET_POS` → `size + undefined` → **the entity's `size`
     becomes `NaN` permanently**, corrupting its collision and quadtree insertion.
   - `Alex.js:1700` `obj.size -= c.SIZE_GET_POS` → same.
   - `Alex.js:1531`, `2305`, `2306` `this.INSTANCE[c][j] = c.KEEP_PLACE` → writes `undefined`
     instead of the intended numeric tombstone `20`.
   Renaming `c` to `config` is a one-line fix that changes live gameplay behaviour — expect
   the spawn-protection/"getPlace" mechanic to start working differently once fixed.

3. **`obstarWeb.js:79` — `c.DB.AC` is a typo for `c.DB.ACC`.** The account lookup branch on
   `GET *` can never be entered, so with MySQL enabled, users would never get a persistent key
   from the landing page. Dormant today only because MySQL is off.

4. **`Alex.js:833` — malformed SQL.** `'SELECT score, id FROM wrs ORDER BY score c.DESC LIMIT '`
   contains a literal `c.DESC` (a botched find-and-replace of `DESC`). Throws a syntax error
   the moment `MYSQL` + `DB.LB` are enabled.

5. **SQL string concatenation.** Same line interpolates `this.scoresLimit` directly. It's an
   internal number today, but the pattern recurs; the rest of the queries do use `?`
   placeholders, so keep it that way.

6. **`views/index.ejs:7` — `<script src=''></script>`.** An empty `src` makes the browser
   re-request the current page URL and execute the HTML as JS. Harmless-looking, wasteful,
   and pollutes the console. Just delete the tag.

7. **Crash handlers keep a corrupted process alive.** See §1.4. Both entry points swallow every
   uncaught exception. Combined with the `NaN` bugs above, a room can enter a permanently
   broken state and keep serving clients.

8. **`Sffa` and `S2team` are ~90% duplicated** (~700 lines each). Every gameplay change must be
   made twice, and they have already drifted. `4team` and `boss` room slots exist in
   `Main.server` but have no implementing class — the menu's 2-team/4-team buttons are marked
   `deactivated` in `index.ejs` for this reason.

9. **`constructor.name` string dispatch everywhere** — blocks minification/bundling of the
   server, and is slow in hot collision paths.

10. **No tests, no lockfile, no linter, no `scripts` block in `package.json`.** Dependencies are
    pinned with `~` to versions from ~2019 (`express ~4.17`, `ws ~7.2`, `ejs ~2.7`,
    `mysql ~2.17`). `npm install` currently reports 10 vulnerabilities (1 critical). They all
    install and run on Node 24 today, but `ejs@2` and `mysql@2` are unmaintained.

11. **No input sanitation on chat/names beyond length.** `Main.maxPseudoLength` is 16 and chat
    goes through a `/`-command parser (`/join`, `/name`, `/quit`, `/color`); rendering is
    canvas-based so XSS risk is low, but nothing is escaped anywhere.

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

1. `GET /` → `obstarWeb.js` reads the `obstarkey` cookie → (with DB on) looks up/creates the
   account → renders `index.ejs` with `POST = {key, leader, shop}` injected as a JSON global.
2. Player picks a gamemode/name/pet (`queue.js`, `shop.js`) and submits a form.
3. `POST /play` → sets a `preference` cookie → renders `play.ejs` with
   `POST = {key, gm, name, pet}`.
4. `new2Init.js` opens `WS_LINK` and sends the binary `init` packet.
5. `Alex.js` `income()` → `Controller.askConnection()` → assigned to a room → `new loop(socket)`
   starts the two per-socket timers.
6. Room `update()` simulates at ~50 Hz; each socket's `gameloop` pulls a per-player view via
   `Controller.getBuffer(id)` → `room.getBuffer(id)` (which culls to the player's screen) and
   sends `GameUpdate`. `longloop` sends `UiUpdate` + `ping` at 1 Hz.
7. Client decodes, lerps, draws. Inputs go back as `keydown`/`keyup`/`mousemove`/`upgrade`/
   `upClass` packets.
8. On death with DB on, `Main.insertLB()` writes to the `wrs` table.

---

## 8. Suggested refactor order

Ordered by (risk reduction × unblocking) per unit of effort:

1. **Make failure visible.** Delete or gate the `uncaughtException` handlers; add
   `scripts: {start, dev}` to `package.json`; commit a lockfile. You cannot safely refactor a
   system that hides its own crashes.
2. **Add a smoke test harness first.** A headless script that boots `Alex.js`, connects a raw
   `ws` client, sends `init`, and asserts `GameUpdate` packets arrive is ~30 lines (one was
   written and verified during this session) and is the only way to refactor the protocol
   without a browser in the loop.
3. **Fix the `c` shadowing (§5.2) and delete the dead `CONFIG` in `lib/config.js` (§5.1).**
   Cheap, high-confidence, and removes two whole classes of confusion. Expect visible gameplay
   changes from the `NaN` fix; verify before/after.
4. **Split `Alex.js`.** Natural seams already exist along class boundaries: `net/` (the ws
   IIFE + protocol glue), `rooms/`, `entities/` (Player, Objects, Bullet, Detector),
   `spatial/quadTree.js`, `config/`. Mechanical, low-risk, and makes everything after it
   tractable.
5. **Unify `Sffa` and `S2team`** into one `Room` base with a gamemode strategy (team
   assignment, spawn rules, win conditions). This is where the duplicated-bug risk lives, and
   it's what unblocks the never-finished `4team` and `boss` modes.
6. **Replace the hand-rolled protocol** with a single declarative schema that generates both
   encoder and decoder, or adopt an existing binary format. Keep the wire format
   byte-compatible during the transition so client and server can be migrated separately.
7. **Replace `constructor.name` dispatch** with an explicit `type` field or class constants.
   Prerequisite for ever bundling/minifying.
8. **Fix the fixed-timestep problem.** Replace the drifting `setTimeout(20)` chain with an
   accumulator-based fixed-step loop that decouples simulation rate from send rate.
9. **Modernize the client last.** It's the largest single file but the least dangerous —
   nothing else depends on its internals. Introduce a bundler and split by the existing
   `General.*` namespaces.
10. **Dependencies and DB.** Upgrade `express`/`ws`/`ejs`, replace `mysql` with `mysql2`, and
    fix §5.3–5.5 before ever turning `MYSQL: true` back on.

---

## 9. Conventions you'll see (so you don't mistake them for bugs)

- `let`/`var`/`const` mixed freely; `var` dominates at module scope.
- Semicolons after block closes (`};`), inconsistent 2-space indent.
- Single-letter globals: `c` (config), `C` (client colours), `cc` (terminal colours).
- Objects used as enums with parallel string↔int tables (`toBUFFER` / `toSTRING`).
- French/English mixed identifiers: `origine` (not `origin`), `Assasin` (sic — the class name
  is misspelled in `TanksConfig.js` and the misspelling is load-bearing across client, server,
  and any DB rows).
- `parseInt(Math.random()*n)` instead of `Math.floor` throughout.
- Vector math via the `victor` package (`new Vec(x,y).rotate(dir).add(…)`), but plenty of
  places do raw `Math.sqrt(Math.pow(…))` distance instead.

## 10. Open questions for the human

- Is the goal a faithful refactor (same gameplay, better code) or a rewrite that's allowed to
  change balance? Fixing §5.2 alone changes gameplay.
- Should MySQL come back, or should accounts/shop/leaderboard move to something else (SQLite,
  Postgres, or drop persistence entirely)?
- Are `4team` and `boss` modes meant to be finished, or removed from the menu?
- Target deployment: single box, or the split web/game/db topology the original supported?
