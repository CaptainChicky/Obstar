# Obstar / Korexk.io — Codebase Reference

Written so a fresh agent can work in this repo **without reading most of it first.** This is a
map and a gotcha list, not a history of how the code got here — for what changed recently or
what's still undecided, see [PENDING.md](PENDING.md).

Obstar is an open-source clone of diep.io: a 2D multiplayer arena shooter. Players are tanks
that shoot bullets, farm polygon "objects" for XP, level up, pick stat upgrades, and evolve
through a class tree.

---

## 1. Running it

```bash
npm install     # repo ships with no node_modules
npm start       # ONE process: game + menu on http://localhost (PORT=3000 npm start if :80 is taken)
npm test        # boots a real server, drives it over the real binary protocol, ~300+ assertions
npm run lint    # eslint, flat config, clean
```

Split deployment (game and web on different machines):

```bash
node server.js --game-only                                # ws://…:8080 (PORT overrides)
WS_LINK=wss://game.example.com node server.js --web-only  # http://…:80
```

`WS_LINK` reaches the browser through `POST.ws` in `play.ejs`; unset, the client computes
`ws(s)://<same host>` itself.

**MySQL is off.** `lib/config.js` exports `MYSQL: false`; every player gets the anonymous key
`'0'.repeat(25)`, the shop is hidden client-side, the leaderboard renders empty. Credentials
(when enabled) live in `lib/dbConfig.js`, overridable via `DB_HOST`/`DB_USER`/`DB_PASSWORD`/
`DB_NAME`. The MySQL code paths exist and are wired to `mysql2`, but have **never been executed**
in this environment — see [PENDING.md](PENDING.md). **The game is being remade from scratch and
the DB will be emptied and rebuilt** — there is no legacy data or old-client compatibility to
preserve, so persistence decisions (MySQL vs. SQLite vs. something else) are unconstrained by
anything documented here; treat old-dev conventions as defaults to improve on, not rules to
honor for their own sake.

---

## 2. Architecture

```
Browser ──► server.js  :80
              ├── HTTP  ─► web/app.js       (Express) ── menu, static files, accounts/shop/LB
              └── WS(bin) ► net/gameSocket.js (ws)    ── the actual game simulation
```

The two halves **do not talk to each other** in-process — they share the MySQL DB (when
enabled), `public/SHARE/`, and one http server. No authentication beyond a 25-char `userKey`
cookie.

### File map

| File | Lines | Role |
|---|---|---|
| `server.js` | 69 | **The only entry point.** Crash handler, flags, `boot()`, one http server. |
| `web/app.js` | 205 | `createApp()` — the Express site. Menu, cookies, shop purchase, leaderboard reads. Opens no port. |
| `lib/boot.js` | 59 | Fills the `lib/runtime.js` registry in dependency order. **`RT.ROOMS` is the one list of gamemodes.** Idempotent, opens no port. |
| `net/gameSocket.js` | 311 | `attach(httpServer)`: `income()` router, per-socket `loop`, `talk()`, `kick()`. |
| `lib/Controller.js` | 613 | `Main` — the singleton controller. Connections, rooms, chat, admin commands, leaderboard. |
| `lib/clock.js` | 160 | Fixed-timestep clock (§4). One accumulator drives every room's `step()`. |
| `rooms/Room.js` | 949 | **The simulation, once.** Tick, quadtree, collision, spawning, bosses, per-player views. |
| `rooms/Ffa.js` | 30 | Free-for-all: tunables only. `Room`'s defaults *are* ffa's behaviour. |
| `rooms/TwoTeam.js` | 108 | 2-team: two base strips, guard drones, team colours. |
| `rooms/FourTeam.js` | 134 | 4-team: four corner bases, guard arcs, team colours. |
| `rooms/BossMode.js` | 39 | Boss hunt: ffa with the boss knobs turned up. |
| `entities/Player.js` | 464 | Tank entity: motion, shooting, upgrades, class changes, collision. |
| `entities/Bullet.js` | 471 | Projectiles, incl. drone/trap/necro behaviour. |
| `entities/Objects.js` | 213 | Farmable polygons. |
| `entities/Detector.js` | 94 | Invisible "vision cone" query entity used by AI. |
| `lib/gameAI.js` | 384 | Bot/boss/pet AI. A **factory** — closes over `Detector`, `Vec`, `FRICTION`, `CLASS`. |
| `lib/quadTree.js` | 75 | Spatial index for broad-phase collision. |
| `lib/runtime.js` | 18 | **Late-bound registry** standing in for a shared scope. Read §4 before using it. |
| `lib/crash.js` | 47 | Fail-fast crash handler (both entry points share it). |
| `lib/config.js` | 68 | Live tunables/flags. **`TICK_MS`** lives here — read §4 first. |
| `lib/kinds.js` | 33 | Entity type tags, used for `obj.kind` dispatch. |
| `lib/terminal.js` | 34 | Terminal colour codes (`termColors`). |
| `lib/constants.js` | 4 | `FRICTION`. |
| `lib/dbConfig.js` | 18 | DB credentials, env-overridable. |
| `lib/botNames.js` | ~100 | Bot name list. Non-ASCII, deliberately. |
| `public/SHARE/SocketSchema.js` | 905 | Binary wire protocol, declarative (§6). Dual-mode: client *and* server. |
| `public/SHARE/TanksConfig.js` | 2648 | Tank classes, stats, barrels, upgrade tree. Shared client/server. |
| `public/SHARE/PetsConfig.js` | 132 | Cosmetic pet definitions. |
| `public/SHARE/ws_link.js` | 18 | Game server URL: `POST.ws`, else the page's own origin. |
| `public/client/runtime.js` | 38 | **Late-bound client registry** (`CLIENT`). Browser twin of `lib/runtime.js`. |
| `public/client/config.js` | 125 | `CONST`, palette `C`, `CLASS`/`CLASS_TREE`, mutable bags `Global`/`Game`. |
| `public/client/util.js` | 148 | `roundedPoly`, `roundRect`, `sleep`, the `General` namespace, `NET`/`Interp`. |
| `public/client/drawings.js` | 307 | Shape table: one function per body/barrel/turret/bullet/pet. |
| `public/client/entities.js` | 456 | `Tank`, `Obj`, `Bullet` — everything the server can put in the world. |
| `public/client/render.js` | 219 | `initRender()` (off-screen sprite caches), `initBackground()` (grid + team zones). |
| `public/client/ui.js` | 1214 | `initUi()`: minimap, stats, upgrades, class picker, leaderboard, messages, death screen, doors. |
| `public/client/game.js` | 734 | `CLIENT.Run()`: world state, camera, input, frame loop, `SetPacket`, `onmessage`. |
| `public/client/overlay.js` | 150 | `General.DEV` and `General.CHAT` — the two DOM-rendered widgets. |
| `public/client/boot.js` | 146 | `preRun()`: connecting screen, socket handshake, handover to `CLIENT.Run()`. |
| `public/motion.js` | 161 | Client motion primitives (§7): snapshot interpolation, frame-rate-independent smoothing. |
| `public/queue.js` | 146 | Menu page: gamemode selection, form submit. |
| `public/shop.js` | 344 | Menu page: pet shop carousel + purchase calls. |
| `public/font.js` | 655 | Animated canvas background on the menu. |
| `views/index.ejs` | 153 | Menu page. |
| `views/play.ejs` | 131 | Game page. **`<script>` order is the client's dependency graph** — §7. |
| `test/*.js` | ~1976 total | 8 suites, see §9. |

`public/SHARE/` is loaded by `<script>` in the browser **and** by `require()` in Node, via a
`typeof(exports)` sniff footer. `public/motion.js` and everything in `public/client/` carry the
same footer, which is why the test suite can run the client (§7, §9) without a bundler existing
anywhere in this repo.

---

## 3. Read this before you touch anything

The things in this codebase that are *not* obvious from reading the code around them:

- **`TICK_MS` is 33, not 20, and that's deliberate — don't "fix" it.** The old loop never
  actually ran at the 50 Hz (`20ms`) it claimed; it ran at ~29 Hz, and every gameplay constant
  (speed, reload, friction) was tuned by feel against that rate. `TICK_MS = 33` (30 Hz)
  reproduces the speed the game was actually tuned for. Setting it to 20 makes the game run
  ~1.7× too fast — that's a balance project, not a config change. `SEND_MS` must stay `>=
  TICK_MS`, or consecutive packets carry an identical world and the client's interpolator reads
  that as "this entity stopped."
- **Never destructure or cache a value off `RT` (or client `CLIENT`) at module load time.** The
  dependency graph is genuinely circular (entities call `Controller`, rooms construct entities,
  `Main` constructs rooms, AI closes over `Detector`). `lib/runtime.js` / `boot.js` fill an
  empty registry in dependency order; `const {Player} = RT` at the top of a file captures
  `undefined` and fails on first use. Always read through `RT.X` / `CLIENT.X` at the point of
  use. The client's version of the rule is slightly looser — see the header comment in
  `public/client/runtime.js`.
- **Entity storage is sparse arrays used as slot maps, not real arrays.** `this.INSTANCE =
  {players:[], objs:[], bullets:[], detectors:[]}`; deleted slots leave holes or the tombstone
  number `KEEP_PLACE` (20). The guard `if(typeof obj === "undefined" || !isNaN(obj)){continue;}`
  appears throughout the server and client for this reason — it is not defensive cruft, it is
  load-bearing. IDs are `{oId: <index>}`; a recycled index can point at a different entity
  between frames.
- **`SocketSchema.js`'s `CODEC` table is keyed by record, not by field name.** The same field
  name means different things in different messages — `xp` is a raw `uint32` in the
  `GameUpdate` head but a packed value in a `Players` record. Don't collapse it into a
  global field→codec map.
- **Packet sizes are self-computed.** The `Encoder` grows itself; nothing needs to hand-compute
  a byte length. If you see one being computed by hand, that's new code to remove, not a
  pattern to copy.
- **Entity type dispatch is `obj.kind` against `lib/kinds.js`, not `constructor.name`.** `kind`
  sits on each class's prototype. The one remaining coupling: three hardcoded
  `DETEC:{type:['Player','Objects']}` literals in `TanksConfig.js` can't `require()`
  `lib/kinds.js` because that file also loads in the browser — keep them in sync by hand if you
  touch `lib/kinds.js`.
- **A room self-destructs when it has zero human players** (bots and bosses excluded from the
  count) — see `Room.js`. This is why an empty `boss`-mode room doesn't tick forever.
- **No HTML is ever escaped, anywhere.** Rendering is canvas-only, so there is currently no DOM
  sink to escape *for*. If a name/chat string is ever routed into a DOM node or an EJS template,
  it needs escaping at that point — nothing upstream does it for you.

---

## 4. Server core: timing, rooms, entities, collision

**Timing.** One fixed-timestep clock (`lib/clock.js`) calls every room's `step()` on an
accumulator, at `config.TICK_MS` (33 ms / 30.3 Hz average) of wall clock — overrun is repaid,
and a stall beyond the catch-up budget (5 steps) is dropped and logged rather than repaid as a
burst. Per-socket send loop (`SEND_MS`, 33 ms) is independent of the simulation tick and skips a
send if the world hasn't stepped since the last one. Per-socket slow loop (1 s): heartbeats, AFK
kick, rate-limit reset. Object respawn (`generate()`) is a simulation event run every
`400/TICK_MS` steps. The `tps` admin command reports target rate, measured rate, steps, and
drops — a stall also prints a throttled `[clock]` line to stderr.

**Rooms.** `rooms/Room.js` is the whole simulation; each gamemode is a subclass passing a block
of tunables to `super()` and overriding named hooks (table at the top of `Room.js` lists all
twelve). `Ffa` is 30 lines because `Room`'s defaults *are* ffa. Adding a gamemode = a subclass +
one line in `lib/boot.js`'s `RT.ROOMS` (`Controller`'s whitelist, its `server` map, and the
tests all derive from that one object). The wire enum in `SocketSchema.js`
(`toBUFFER.gamemode`/`toSTRING.gamemode`) does **not** derive from `RT.ROOMS` — the client can't
`require()` `boot.js` — so a new mode needs a key added to both tables in the same order;
`test/rooms.js` cross-checks all three lists against each other.

**Collision.** Per tick: rebuild a `quadTree`, insert every live entity, `query()` with an AABB
overlap test, then `a.collision(b, {dis})` per candidate pair. Each entity class implements its
own `collision()`, switching on `other.kind`.

---

## 5. Wire protocol (`public/SHARE/SocketSchema.js`)

Binary over WebSocket via `DataView`/`Buffer`. One file implements both directions and both
runtimes, selected at load time by the `typeof(exports)` footer (`platform == 'client'` in the
browser, `'server'` in Node). Every message is `[uint8 type][payload…]` — the type byte indexes
the `'type'` table (`init:0, kick:1, keydown:2, keyup:3, mousemove:4, GameUpdate:5, ping:6,
upgrade:7, UpdateUp:8, upClass:9, …`).

Primitives: `str` (uint8 length + UTF-16 chars), `str8` (uint8 length + bytes), `int8/uint8/
int16/uint16/int32/uint32/float32`.

Five tables, read top to bottom:

| Table | Maps | Example |
|---|---|---|
| `TYPE` | field name → primitive | `'x'` is a `float32` |
| `SCHEMA` | message → ordered field list | a `Players` record is `states, class, color, x, …` |
| `CODEC` | **record** → per-field value transform | `dir` is radians in memory, `int16` on the wire |
| `LIMITS` | message → legal packet size; field → longest string the encoder emits | `chat` is 2–202 bytes |
| `MSG` / `PARSE` | message → the framing around those fields | `UiUpdate`'s three length-prefixed arrays |

`writeFields()`/`readFields()` walk `SCHEMA` against `TYPE`/`CODEC`. **Adding a field is two
edits** (`TYPE`, `SCHEMA`), plus a `CODEC` entry if it needs a transform.

**Input validation.** `checkLength` does `min <= value && value <= max` and is enforced on
every schema-driven message. Unknown type byte → `ERR_PACKET_TYPE` kick. Truncated payload →
`ERR_PACKET_LENGTH` kick (the `Decoder` bounds-checks every read). The client encoder clamps
`name` (16), `chat` (100), `com` (50) to the same bounds the server enforces. **Still absent:
enum-range validation** — a well-sized packet's *values* are still trusted (e.g. `upClass` with
an out-of-range class byte reaches `Player.upClass(undefined)` unchecked).

Kick reasons: `ERR_GAMEMODE`, `ERR_DOUBLE_IP`, `ERR_BROKEN_KEY`, `ERR_SERVER_FULL`,
`ERR_SERVER_OFF`, `ERR_REQUESTS_DELAY`, `ERR_PACKET_LENGTH`, `ERR_HEARTBEATS_LOST`,
`ERR_DOUBLE_ACC`, `ERR_PACKET_TYPE`.

Anti-abuse: `socket.main.request++` per packet, kicked at ≥50/sec (`ERR_REQUESTS_DELAY`);
missing 10 heartbeats → `ERR_HEARTBEATS_LOST`; `config.MAX_IP` (2) concurrent connections per
IP; `config.S_BEFORE_KICK` (120 s) idle on the death screen.

Content (chat/names) is intentionally **not** filtered beyond length — names are Unicode and
stay Unicode. The only escaping that happens is C0/C1 control chars on the path to the
*operator's terminal* (`consoleSafe()` in `Controller.js`), because a raw name could otherwise
execute terminal escape sequences. That is output-escaping for one sink, not input sanitation —
see §3's note on HTML.

---

## 6. The client (`public/client/`)

Ten files, no bundler, no build step — ordinary `<script>` tags; the source you edit is the
source the browser runs. `play.ejs` loads:

`ws_link.js` → `POST` (server-injected JSON) → `TanksConfig.js` → `PetsConfig.js` →
`SocketSchema.js` → `motion.js` → then, strictly in this order:

```
runtime  config  util  drawings  entities  render  ui  game  overlay  boot
```

`test/web.js` asserts `play.ejs` lists all ten in that order — a reordered tag is a
`ReferenceError` at page load and nothing else catches it.

**Shared-scope rule** (client analogue of §3's `RT` rule): a file may alias a name off `CLIENT`
at load time only if an earlier file already put it there. Anything born inside `CLIENT.Run()`
(`User`, `Instances`, the 2D context) must be read through `CLIENT` at the point of use, not
captured once.

Key namespaces, all attached to a `General` object:

- `General.drawTank`/`drawBullet`/`drawPet` — entity rendering with off-screen canvas caching
  (each shape rasterized once, blitted after). (`render.js`)
- `General.background`, `MAP` — grid and minimap. (`render.js`, `ui.js`)
- `ST` (score/level bar), `UP` (8 stat-upgrade buttons), `TNK` (class-evolution picker), `LB`
  (leaderboard), `END` (death screen) — all `ui.js`.
- `Loop()`/`Draw()` — render loop (`game.js`); `socket.onopen` sends `PROTO.encode('init',
  POST)` (`boot.js`).
- `Interp`/`NET` — entity motion, from `public/motion.js` (§7).

`window.colorPattern` is a global `[light, dark]` pair map for two-tone tank fills. CSS lives in
four places: `public/style.css`, `LeaderBoard.css`, `fontStyle.css`, and a large inline
`<style>` in `play.ejs`.

`Instances`/`INSTANCE` (both client and `Room.js`) are walked with `for...in` rather than an
indexed loop — this is deliberate, not unswept idiom: they're sparse id-indexed arrays
(`delete Instances[C][I]` on removal), and `for...in` only visits live keys. Profiled: the cost
of this is 0.01–0.04% of a 60fps frame budget at realistic entity counts, so it isn't worth
converting to a `Map` for speed — only clarity, if ever.

### 7. Motion (`public/motion.js`)

Entity movement is **snapshot interpolation**, not exponential smoothing: each entity keeps its
last two server positions with arrival times, and `sample(now)` draws the point between them —
no filter state, so no startup wind-up and no steady-state lag proportional to speed (both of
which an exponential filter chasing a moving target produces). A **teleport threshold** (400
units) snaps instead of interpolating across a respawn/map-wrap. **Capped extrapolation** (2
packet intervals) lets entities coast briefly if packets stop arriving, rather than
freezing/flying off. The camera is pinned directly to the drawn tank (not smoothed
independently), so it can't disagree with what's rendered. Where exponential smoothing survives
(UI, not entity position), `lerpK(k, dtFrames) = 1-(1-k)^dtFrames` keeps it frame-rate
independent — a raw `d += (t-d)*k` is not, and previously gave different players different
behaviour on different monitors. `Global.dtFrames` is clamped to `[0.2, 4]` because a
backgrounded browser tab produces frame gaps the interpolator would otherwise take literally.

---

## 8. Web/menu side & DB

`GET /` → `web/app.js` reads the `obstarkey` cookie → (DB on) looks up/creates account →
renders `index.ejs` with `POST = {key, leader, shop}` injected as a JSON global. Player picks
gamemode/name/pet (`queue.js`, `shop.js`), submits → `POST /play` sets a `preference` cookie →
renders `play.ejs` with `POST = {key, gm, name, pet, ws}`. On death (DB on), `Main.insertLB()`
writes to the `wrs` table. Leaderboard/shop refresh: `setInterval(..., 120000)`.

MySQL is off by default (§1) — every DB-touching code path is present and swapped onto `mysql2`,
but untested in this environment.

---

## 9. Test coverage

`npm test` runs 8 suites in dependency order (cheapest/most load-bearing first):

| Suite | What it covers |
|---|---|
| `test/proto.js` | Wire protocol: golden bytes, self-sizing, round trips, input validation, Unicode. |
| `test/interp.js` | Client motion arithmetic (§7). |
| `test/clock.js` | Fixed-timestep clock: drift, catch-up, stalls, self-removal. |
| `test/rooms.js` | All four gamemodes — teams, bases, bot rosters, colours, respawn xp. No socket, built via `boot()`. |
| `test/client.js` | Runs the actual client under a stub DOM (`test/clientDom.js`): camera, bullet speed, entity completeness, no NaN to canvas. |
| `test/clientDiff.js` | Canvas-call differential guard — pins the client's current behaviour (247353 ops / hash `c4eb110d`) so a future edit that silently changes rendering fails loud. Re-baseline deliberately if you change client rendering/iteration order on purpose. |
| `test/smoke.js` | End-to-end: real socket, real protocol, real server, all four modes. |
| `test/web.js` | The merged entry point: one port serves site + socket, `play.ejs` script order, split-mode wiring. |
| `test/clientProto.js` | Loads `SocketSchema.js` in *client* mode inside Node via `vm` — used by the above, not a standalone suite. |

**What's not covered:** a full match beyond the first minute (leveling, death screen, respawn),
two real human players in one room, observed boss AI behavior, the client under real browser
frame timing, MySQL code paths, admin commands/chat/shop end to end, and load with several busy
rooms at once. Full list and reasoning: [PENDING.md](PENDING.md).

---

## 10. Conventions (so you don't mistake them for bugs)

- `let`/`const` dominate now (server-side `var` was swept); a few `for...in` traversals remain
  by design (§6).
- Objects used as enums with parallel string↔int tables (`toBUFFER`/`toSTRING`).
- Vector math via the `victor` package (`new Vec(x,y).rotate(dir).add(…)`), though some code
  still does raw `Math.sqrt(Math.pow(…))` distance instead.
- Bare `parseInt(x)` (no radix arg) is still used throughout for numeric truncation — that's why
  `radix` is off in `eslint.config.js`. Random-int generation was `parseInt(Math.random()*n)`
  and has been swept to `Math.floor(Math.random()*n)`; if you see the old form, it's new code,
  not a pattern to copy.
- The single-letter globals `C` (client colours) and `cc` (terminal colours) have been renamed
  to `Palette` and `termColors`. `Assasin` (sic) has been corrected to `Assassin`, `origine`
  to `origin`, and `canons` to `cannons` (196 occurrences across 10 files) — safe to do without
  a migration because the DB is being wiped and rebuilt from scratch (see §1).

---

For what's undecided, unverified, or intentionally deferred, see **[PENDING.md](PENDING.md)** —
that's the living punch list; this file is the map.
