# Obstar / Korexk.io — Codebase Handoff

Written for a fresh agent session tasked with refactoring this repo. It describes the code
**as it actually is today**, including the parts that are wrong. Nothing here is aspirational.

> **Status — updated 2026-07-22, after refactor chunks 1–4.**
> Items 1–4 of the refactor order in §8 are **done and verified**; `Alex.js` is now a 52-line
> bootstrap instead of a 3918-line monolith. Sections below are marked ✅ DONE / ⬜ TODO
> throughout, and descriptions have been rewritten to match the current tree — where a bug is
> fixed, the text now says where the fix lives rather than describing the old breakage.
> §8 items 5–10 are untouched and remain the roadmap.
>
> Verification: `npm test` → **29 passed, 0 failed** (binary protocol round-trips plus a live
> server run per gamemode). Nothing has been committed yet.

Obstar is an open-source clone of diep.io: a 2D multiplayer arena shooter. Players are tanks
that shoot bullets, farm polygon "objects" for XP, level up, pick stat upgrades, and evolve
through a class tree. It was a real production game (korexk.io), later open-sourced. The
original author's own README says *"the code is not clean, so it might be hard to understand."*
That is accurate.

---

## 1. How to run it (verified working on Node v24.15.0, Windows, 2026-07-22)

```bash
npm install     # ← the repo ships with NO node_modules; nothing runs until you do this
npm start       # starts BOTH servers; if either dies, the other is taken down too
npm test        # boots a real server and drives it over the real binary protocol
```

Then open <http://localhost>. The two servers are still **separate processes** and can still
be run by hand in two terminals — `npm run start:game` (→ ws://localhost:8080) and
`npm run start:web` (→ http://localhost:80), or plain `node Alex.js` / `node obstarWeb.js`.
`npm start` just forks both via [scripts/dev.js](scripts/dev.js) so a crash in one is not
silently survived by the other.

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
| Web server port | `obstarWeb.js` (last lines), `process.env.PORT` | 80 |
| Game server port | `Alex.js` (last line: `net.listen(...)`), `process.env.PORT` | 8080 |
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

Updated after the §8.4 split. Every file below `Alex.js` down to `scripts/dev.js` was carved
out of the old monolith or added by the refactor.

| File | Lines | Role |
|---|---|---|
| [Alex.js](Alex.js) | 52 | Game server **boot sequence only**. Wires modules in dependency order, then listens. |
| [obstarWeb.js](obstarWeb.js) | 182 | Express web server. Menu, cookies, shop purchase, leaderboard reads. |
| [net/server.js](net/server.js) | 256 | The http shell + the ws IIFE: `income()` router, per-socket `loop`, `talk()`, `kick()`. |
| [lib/Controller.js](lib/Controller.js) | 568 | `Main` — the singleton controller. Connections, rooms, chat, admin commands, leaderboard. |
| [rooms/Sffa.js](rooms/Sffa.js) | 710 | Free-for-all room. |
| [rooms/S2team.js](rooms/S2team.js) | 787 | 2-team room. **Still ~90% copy-paste of `Sffa` — see §5.8.** |
| [entities/Player.js](entities/Player.js) | 456 | Tank entity: motion, shooting, upgrades, class changes, collision. |
| [entities/Bullet.js](entities/Bullet.js) | 464 | Projectiles, including drone/trap/necro behaviour. |
| [entities/Objects.js](entities/Objects.js) | 204 | Farmable polygons. |
| [entities/Detector.js](entities/Detector.js) | 84 | Invisible "vision cone" query entity used by the AI. |
| [lib/gameAI.js](lib/gameAI.js) | 380 | Bot/boss/pet AI. A **factory** — the behaviour functions close over `Detector`, `Vec`, `FRICTION`, `CLASS`. |
| [lib/quadTree.js](lib/quadTree.js) | 74 | Spatial index for broad-phase collision. |
| [lib/runtime.js](lib/runtime.js) | 14 | **Late-bound registry.** Stands in for the old shared scope; read §2.1 before using it. |
| [lib/crash.js](lib/crash.js) | 40 | Shared fail-fast crash handler for both entry points. |
| [lib/config.js](lib/config.js) | 25 | Live tunables/flags only. The dead `CONFIG` block is gone (§5.1). |
| [lib/terminal.js](lib/terminal.js) | 32 | Terminal colour codes (`cc`). |
| [lib/constants.js](lib/constants.js) | 4 | `FRICTION`. |
| [lib/AlexMysql.js](lib/AlexMysql.js) / [lib/webMysql.js](lib/webMysql.js) | 7 each | DB credentials. |
| [test/smoke.js](test/smoke.js) | 199 | End-to-end smoke test, 29 assertions. `npm test`. |
| [test/clientProto.js](test/clientProto.js) | 27 | Loads `SocketSchema.js` in *client* mode inside Node, via `vm`. |
| [scripts/dev.js](scripts/dev.js) | 31 | Forks both servers; kills both if either exits. |
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

### 2.1 `lib/runtime.js` — read this before adding a `require`

The old `Alex.js` was one scope, so every name resolved at *call* time and cycles were
invisible. The dependency graph is genuinely circular: entities call into `Controller`, rooms
construct entities, `Main` constructs rooms, and the AI closes over `Detector`. Plain
`require()` between those modules hands back a half-initialised `exports` object.

`lib/runtime.js` is the explicit stand-in for that shared scope — an empty object (`RT`) that
[Alex.js](Alex.js) fills in a documented five-step order: entities → rooms → AI → `Controller`
→ `listen`. Modules reach each other as `RT.Player`, `RT.Controller`, and so on.

**The rule, repeated in the file itself: never destructure off `RT` at module load time, and
never cache an `RT` value in a module-level `const`. Read through `RT` at the point of use.**
`const {Player} = RT` at the top of a module captures `undefined` and fails at the first tick.

This is a deliberate stopgap, not a design to build on. It reproduces the original semantics
exactly, which is what made the split safely verifiable. Breaking the cycles properly
(dependency injection, or an event bus between `Controller` and the entities) is a reasonable
follow-up once §8.5 lands.

---

## 3. The game server — read this before touching anything

The 3918-line `Alex.js` described by earlier versions of this document no longer exists; its
contents are the `net/`, `rooms/`, `entities/` and `lib/` files listed in §2, split along the
class boundaries that were already there. `git show HEAD:Alex.js` still gets you the original
if you need to diff behaviour against it — that is exactly how the split was checked.

What survived unchanged is the *code*: the extraction was mechanical. Class bodies were moved
verbatim, with only cyclic references rewritten to `RT.` prefixes (§2.1) and require paths
adjusted for depth. The bugs fixed along the way are itemised in §5.

One hazard worth naming, because it nearly caused a silent breakage during the split: **the
whole codebase dispatches on `constructor.name` string literals** (§5.9). A rename that also
touches string contents — `'Player'` → `'RT.Player'` — compiles fine, passes `node --check`,
and silently breaks every collision branch. Any mechanical transform here must be
string-literal and comment aware, and should be grepped for corrupted literals before it runs.

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
the *only* real input hardening in the protocol — and it does not work:

> ⚠️ **`checkLength` is a no-op.** [SocketSchema.js:600](public/SHARE/SocketSchema.js#L600) is
> `return(min<=data<=max)`. JavaScript has no chained comparison, so this parses as
> `(min<=data)<=max` → a boolean is coerced to `0`/`1` and compared against `max`, which is
> always true for any `max >= 1`. **Every length check in the protocol passes unconditionally.**
> Confirmed empirically: a 3-character `key` is accepted where it should trigger
> `ERR_BROKEN_KEY`.
>
> Found during the chunk 1–4 refactor; not in the original handoff. **Deliberately not fixed** —
> turning the only input validation on for the first time will reject packets that currently
> get through, and deciding what to reject belongs with the protocol work in §8.6. Do it there,
> and expect fallout.

So in practice the protocol has *no* input validation. Assume any byte sequence reaches the
decoders.

**Everything is positional and duplicated between the encode and decode halves.** Adding one
field to one message means editing the TYPE table, the SCHEMA table, the client encoder, the
server decoder, and the byte-size arithmetic in `ENC.init(n)` — five places, no shared source
of truth, no tests. Get the size wrong and you get silent truncation, not an error. **This is
the highest-value refactor target in the repo.**

Kick reasons are an enum of strings: `ERR_GAMEMODE`, `ERR_DOUBLE_IP`, `ERR_BROKEN_KEY`,
`ERR_SERVER_FULL`, `ERR_SERVER_OFF`, `ERR_REQUESTS_DELAY`, `ERR_PACKET_LENGTH`,
`ERR_HEARTBEATS_LOST`, `ERR_DOUBLE_ACC`, `ERR_PACKET_TYPE`.

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

3. ✅ **FIXED — `obstarWeb.js` `c.DB.AC` typo for `.ACC`.** The account-lookup branch on `GET *`
   was unreachable. Still dormant (MySQL is off), but correct now.

4. ✅ **FIXED — malformed SQL in the leaderboard query.** `ORDER BY score c.DESC` contained a
   literal `c.DESC` from a botched find-and-replace. Now `ORDER BY score DESC`.

5. ✅ **FIXED — SQL string concatenation.** The same query interpolated `this.scoresLimit`
   directly; it is now a `?` placeholder, matching the rest of the queries. Keep it that way.

6. ✅ **FIXED — `views/index.ejs:7` `<script src=''></script>`.** Deleted. An empty `src` makes
   the browser re-request the page URL and try to execute the HTML as JS.

7. ✅ **FIXED — crash handlers kept a corrupted process alive.** See §1.4 and
   [lib/crash.js](lib/crash.js).

8. ⬜ **TODO — `Sffa` and `S2team` are ~90% duplicated** (710 / 787 lines). Splitting them into
   separate files made the duplication easier to see but did not reduce it: every gameplay
   change must still be made twice, and they have already drifted. `4team` and `boss` room
   slots exist in `Main.server` with no implementing class — the menu's 2-team/4-team buttons
   are `deactivated` in `index.ejs` for this reason. **This is §8.5, the next chunk.**

9. ⬜ **TODO — `constructor.name` string dispatch everywhere.** Still blocks minification and
   bundling, still slow in hot collision paths, and see the warning in §3 about mechanical
   renames.

10. ⚠️ **PARTLY FIXED.** `package.json` now has a `scripts` block (`start`, `start:game`,
    `start:web`, `dev`, `test`) and `test/smoke.js` gives 29 end-to-end assertions.
    **Still missing: a lockfile and a linter.** Dependencies remain pinned with `~` to ~2019
    versions (`express ~4.17`, `ws ~7.2`, `ejs ~2.7`, `mysql ~2.17`); `npm install` reports 10
    vulnerabilities (1 critical). They install and run on Node 24, but `ejs@2` and `mysql@2`
    are unmaintained. See §8.10.

11. ⬜ **TODO — no input sanitation on chat/names beyond length**, and per §4 the length checks
    themselves do nothing. `Main.maxPseudoLength` is 16 and chat goes through a `/`-command
    parser (`/join`, `/name`, `/quit`, `/color`); rendering is canvas-based so XSS risk is low,
    but nothing is escaped anywhere.

12. ⬜ **TODO — `checkLength` is a no-op** (`min<=data<=max` chained comparison). New finding;
    full detail in §4. The protocol has no working input validation.

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
5. `net/server.js` `income()` → `Controller.askConnection()` → assigned to a room →
   `new loop(socket)` starts the two per-socket timers.
6. Room `update()` simulates at ~50 Hz; each socket's `gameloop` pulls a per-player view via
   `Controller.getBuffer(id)` → `room.getBuffer(id)` (which culls to the player's screen) and
   sends `GameUpdate`. `longloop` sends `UiUpdate` + `ping` at 1 Hz.
7. Client decodes, lerps, draws. Inputs go back as `keydown`/`keyup`/`mousemove`/`upgrade`/
   `upClass` packets.
8. On death with DB on, `Main.insertLB()` writes to the `wrs` table.

---

## 8. Suggested refactor order

Ordered by (risk reduction × unblocking) per unit of effort. **Items 1–4 are done.**

1. ✅ **DONE — Make failure visible.** [lib/crash.js](lib/crash.js) replaces both
   `uncaughtException` handlers with fail-fast + stderr logging (`OBSTAR_SWALLOW_CRASHES=1`
   restores the old behaviour), and `package.json` has a `scripts` block.
   **Still outstanding from this item: commit a lockfile.**
2. ✅ **DONE — Smoke test harness.** [test/smoke.js](test/smoke.js), 29 assertions: protocol
   round-trips, plus a live server booted per gamemode (`ffa` and `2team` run sequentially,
   because `config.MAX_IP` caps connections per IP at 2), sampled for 6 s.
   The enabling trick is [test/clientProto.js](test/clientProto.js): `SocketSchema.js` picks
   its half by sniffing `typeof(exports)`, so loading it in a `vm` context with no `exports`
   (but with `Buffer` and `TanksConfig` injected as globals) yields the **browser** encoder
   inside Node. The test therefore sends exactly the bytes a real client sends.
3. ✅ **DONE — `c` shadowing (§5.2) and the dead `CONFIG` (§5.1).** Verified by negative
   control; see §5.2 for the measurement.
4. ✅ **DONE — Split `Alex.js`** into `net/`, `rooms/`, `entities/`, `lib/`. See §2's file map
   and §2.1 for the late-bound registry that made the circular graph work.
5. ⬜ **NEXT — Unify `Sffa` and `S2team`** into one `Room` base with a gamemode strategy (team
   assignment, spawn rules, win conditions). This is where the duplicated-bug risk lives, and
   it's what unblocks the never-finished `4team` and `boss` modes. `npm test` already covers
   both modes, which is the safety net this step needs — it was sequenced after the split
   for exactly that reason.
6. ⬜ **Replace the hand-rolled protocol** with a single declarative schema that generates both
   encoder and decoder, or adopt an existing binary format. Keep the wire format
   byte-compatible during the transition so client and server can be migrated separately.
   **Fix `checkLength` (§4/§5.12) here** — it is the only input validation and it currently
   does nothing, so enabling it will start rejecting traffic that works today.
7. ⬜ **Replace `constructor.name` dispatch** with an explicit `type` field or class constants.
   Prerequisite for ever bundling/minifying. Note the string-literal hazard in §3.
8. ⬜ **Fix the fixed-timestep problem.** Replace the drifting `setTimeout(20)` chain with an
   accumulator-based fixed-step loop that decouples simulation rate from send rate.
9. ⬜ **Modernize the client last.** It's the largest single file but the least dangerous —
   nothing else depends on its internals. Introduce a bundler and split by the existing
   `General.*` namespaces.
10. ⬜ **Dependencies and DB.** Commit a lockfile, add a linter, upgrade `express`/`ws`/`ejs`,
    replace `mysql` with `mysql2`. §5.3–5.5 are now fixed, but do not turn `MYSQL: true` on
    without testing those paths — they have never run in this tree.

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
- ~~How far to go in one pass?~~ **Chunks 1–4**, stopping deliberately before §8.5.

**Still open:**

- Should MySQL come back, or should accounts/shop/leaderboard move to something else (SQLite,
  Postgres, or drop persistence entirely)?
- Are `4team` and `boss` modes meant to be finished, or removed from the menu? This gates how
  §8.5 is designed — a `Room` base built for four teams looks different from one built to
  serve exactly the two modes that exist.
- Target deployment: single box, or the split web/game/db topology the original supported?

---

## 11. State of the working tree

Chunks 1–4 are complete and verified, but **nothing is committed.** `git status` shows
`Alex.js`, `lib/config.js`, `obstarWeb.js`, `package.json` and `views/index.ejs` modified, plus
untracked `entities/`, `net/`, `rooms/`, `scripts/`, `test/` and seven new `lib/` files.

The four chunks are cleanly separable into four commits if a bisectable history is wanted.

### What was verified, and what was not

Verified: `npm test` → 29 passed / 0 failed. Both servers under `npm start` → `GET /` 200,
`ws` connects, 108 `GameUpdate` packets received, rooms created and joined. Every extraction
checked with `node --check` plus a grep for corrupted string literals. The §5.2 fix confirmed
by negative control (336 → 0 NaN entities).

**Not verified — treat as unknown:**

- **The game has never been opened in a browser since the refactor.** The client is untouched
  and the protocol round-trips, but nothing has exercised actual rendering. This is the first
  thing to check.
- **MySQL paths.** Still off. §5.3–5.5 are fixed by inspection, not by execution.
- **Admin commands, chat, the shop, and the death/leaderboard flow** are not covered by
  `smoke.js`, which asserts only that the socket → room → encoder → socket pipe is intact.
