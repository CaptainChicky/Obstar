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

**The DB (Postgres) is off by default.** `lib/config.js`'s `DB.ON` is `false`; every player gets
the anonymous key `'0'.repeat(25)`, the shop is hidden client-side, the leaderboard renders
empty. All DB access goes through the single adapter `lib/db.js` — nothing else calls `pg`
directly. Credentials live in `lib/dbConfig.js`, overridable via `DB_HOST`/`DB_PORT`/`DB_USER`/
`DB_PASSWORD`/`DB_NAME`.

To turn it on locally:

```bash
docker compose up -d          # starts postgres:16, applies db/schema.sql on first init
```

then set `DB.ON: true` (plus whichever of `DB.ACC`/`DB.SHOP`/`DB.DEV`/`DB.LB` you want) in
`lib/config.js` and `npm start`. `db/schema.sql` only runs on the container's **first** init
(empty data dir) — to reapply it after editing, `docker compose down -v` then `up -d` again.
Committed default stays off so `npm test` (which runs with the DB off) stays green regardless.

**The game is being remade from scratch and the DB will be emptied and rebuilt** — there is no
legacy data or old-client compatibility to preserve. Postgres columns are lowercase
(`userkey`, `userdata`, `lastconnection`, …) since Postgres folds unquoted identifiers anyway.

**Testing admin commands locally.** With `DB.ON`/`DB.DEV` both `true`, insert a password row:
```bash
docker compose exec db psql -U root -d users -c "INSERT INTO devs (password, level) VALUES ('changeme', 3);"
```
Level 3 is the top tier (`lib/Controller.js`'s `command()` switch). There's no in-game keybind
for the dev console — it's opened from the browser devtools console with `toggleConsole()`
(`public/client/overlay.js` puts it on `window`), then type `connect changeme` and hit Enter to
authenticate the tab, followed by commands like `player <id> invisible on` or `broadcast <msg>`.
The regular chat box (`/join`, `/quit`, `/name`) is bound to Enter the same way but doesn't need
a `connect` step.

---

## 2. Architecture

```
Browser ──► server.js  :80
              ├── HTTP  ─► web/app.js       (Express) ── menu, static files, accounts/shop/LB
              └── WS(bin) ► net/gameSocket.js (ws)    ── the actual game simulation
```

The two halves **do not talk to each other** in-process — they share the Postgres DB (when
enabled), `public/SHARE/`, and one http server. No authentication beyond a 25-char `userKey`
cookie.

### File map

| File | Lines | Role |
|---|---|---|
| `server.js` | 69 | **The only entry point.** Crash handler, flags, `boot()`, one http server. |
| `web/app.js` | 205 | `createApp()` — the Express site. Menu, cookies, shop purchase, leaderboard reads. Opens no port. |
| `lib/boot.js` | 22 | Constructs the `Controller` singleton, memoised. No registry to fill any more — see §3. |
| `net/gameSocket.js` | 336 | `attach(httpServer, controller)`: `income()` router, per-socket `loop`, `talk()`, `kick()`. |
| `lib/Controller.js` | 649 | `Main` — the singleton controller. Connections, rooms, chat, admin commands, leaderboard. |
| `lib/clock.js` | 160 | Fixed-timestep clock (§4). One accumulator drives every room's `step()`. |
| `rooms/Room.js` | 968 | **The simulation, once.** Tick, quadtree, collision, spawning, bosses, per-player views. Takes a `controller` constructor argument (§3). |
| `rooms/index.js` | 16 | **The one list of gamemodes**, keyed by the string the client's `init` packet sends. |
| `rooms/Ffa.js` | 30 | Free-for-all: tunables only. `Room`'s defaults *are* ffa's behaviour. |
| `rooms/TwoTeam.js` | 108 | 2-team: two base strips, guard drones, team colours. |
| `rooms/FourTeam.js` | 134 | 4-team: four corner bases, guard arcs, team colours. |
| `rooms/BossMode.js` | 39 | Boss hunt: ffa with the boss knobs turned up. |
| `entities/Player.js` | 508 | Tank entity: motion, shooting, upgrades, class changes, collision. Takes a `room` constructor argument (§3). |
| `entities/Bullet.js` | 468 | Projectiles, incl. drone/trap/necro behaviour. Takes a `room` constructor argument (§3). |
| `entities/Objects.js` | 220 | Farmable polygons. Takes a `room` constructor argument (§3). |
| `entities/Detector.js` | 94 | Invisible "vision cone" query entity used by AI. A leaf — no `room`/`controller` reference needed. |
| `lib/gameAI.js` | 403 | Bot/boss/pet AI. A plain module now — `Detector`/`Vec`/`FRICTION`/`CLASS`/`DES` are all leaves, so `module.exports = CONFIG` directly. |
| `lib/quadTree.js` | 75 | Spatial index for broad-phase collision. |
| `lib/SlotMap.js` | 128 | Server-only integer-slot entity store (allocation, `KEEP_PLACE` tombstoning, live iteration) behind `INSTANCE.players`/`objs`/`bullets`/`detectors`. `maxIndex` is the highest allocatable id, not a capacity. |
| `lib/crash.js` | 47 | Fail-fast crash handler (both entry points share it). |
| `lib/config.js` | ~100 | Live tunables/flags. **`TICK_MS`/`REF_TICK_MS`** live here — read §3/§4 first. Also `FOV_*`, `OOB_MARGIN`, `BASE_DRONE_*` and `BASE_BULLET_MARGIN` (§4). |
| `lib/tick.js` | ~55 | `SCALE = TICK_MS/REF_TICK_MS` and the `perTick`/`drag`/`ticks`/`chance`/`quadratic`/`lead`/`smoothing` conversions every per-reference-tick constant is read through (massplanchunks WP3). |
| `lib/db.js` | ~25 | The one Postgres connection point — `db.enabled`, `db.query()`, `db.check()`. Off unless `config.DB.ON`. |
| `lib/terminal.js` | 34 | Terminal colour codes (`termColors`). |
| `lib/constants.js` | 7 | Re-exports `FRICTION` from `public/SHARE/Physics.js`. |
| `lib/dbConfig.js` | 18 | Postgres credentials, env-overridable. |
| `db/schema.sql` | ~40 | Postgres table definitions (`acc`, `wrs`, `shop`, `devs`), applied on first container init. |
| `docker-compose.yml` | ~15 | Local Postgres (`postgres:16`), version-pinned to rehearse the eventual managed-Postgres target. |
| `lib/botNames.js` | ~100 | Bot name list. Non-ASCII, deliberately. |
| `public/SHARE/kinds.js` | 36 | Entity type tags (`KIND`), used for `obj.kind` dispatch. Dual-mode: server require() + client global. |
| `public/SHARE/World.js` | ~15 | The one grid-pitch constant (`GU`/`gu()`, plan.md WP1) — 1 grid square = 1 diep grid unit = 28 world units. Dual-mode, same footer idiom as `kinds.js`. |
| `public/SHARE/SocketSchema.js` | 905 | Binary wire protocol, declarative (§6). Dual-mode: client *and* server. |
| `public/SHARE/TanksConfig.js` | 2648 | Tank classes, stats, barrels, upgrade tree. Shared client/server. Cross-checked against itself by `test/tanks.js` — see §3. |
| `public/SHARE/Physics.js` | 37 | **The one movement integrator** (`moveAccel`/`stepBody`/`FRICTION`) — `entities/Player.js`, `lib/gameAI.js`'s bots and `public/client/game.js` all call into it. Dual-mode. |
| `public/SHARE/PetsConfig.js` | 132 | Cosmetic pet definitions. |
| `public/SHARE/ws_link.js` | 18 | Game server URL: `POST.ws`, else the page's own origin. |
| `public/client/runtime.js` | 38 | **Late-bound client registry** (`CLIENT`). The server side no longer has an equivalent (§3) — this one is purely a client-side sequencing device, for scripts loaded by `<script>` tag with no bundler. |
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
| `test/*.js` | ~2835 total | 9 suites, see §9. |

`public/SHARE/` is loaded by `<script>` in the browser **and** by `require()` in Node, via a
`typeof(exports)` sniff footer. `public/motion.js` and everything in `public/client/` carry the
same footer, which is why the test suite can run the client (§7, §9) without a bundler existing
anywhere in this repo.

---

## 3. Read this before you touch anything

The things in this codebase that are *not* obvious from reading the code around them:

- **`TICK_MS` (25, 40 Hz) and `REF_TICK_MS` (40) are different numbers on purpose — read
  `lib/tick.js` and `lib/config.js`'s `TICK_MS` comment before touching either.** The old loop
  never actually ran at the 50 Hz (`20ms`) it claimed; it ran at ~29 Hz, and every gameplay
  constant (speed, reload, friction, recoil, knockback) was tuned by feel against that rate.
  massplanchunks WP3 split "how often the server steps" (`TICK_MS`) from "what tick every raw
  constant in `entities/`, `lib/gameAI.js` and `public/SHARE/TanksConfig.js` is denominated
  against" (`REF_TICK_MS`) — the server now steps at diep.io's own real rate (40 Hz) while every
  constant is still readable as "per 40ms of gameplay," converted to the actual step at its
  consumption site by `lib/tick.js`'s `perTick()`/`drag()`/`ticks()`/`chance()`/`quadratic()`/
  `lead()`/`smoothing()`. Changing `TICK_MS` alone is a simulation-cost knob, not a balance
  change, because of that split — but if you ever add a *new* per-tick constant, get the category
  right (see `lib/tick.js`'s header) or it silently drifts from real-world-correct. `SEND_MS`
  must stay `>= TICK_MS`, or consecutive packets carry an identical world and the client's
  interpolator reads that as "this entity stopped."
- **Never destructure or cache a value off client `CLIENT` at module load time.** The server side
  no longer has an `RT`-style registry to worry about (below) — this rule is client-only now.
  `CLIENT.Run()` builds `User`/`Instances`/the 2D context after every `public/client/*.js` file has
  already loaded, so a module-scope `const {User} = CLIENT` captures `undefined`; always read
  through `CLIENT.X` at the point of use. See the header comment in `public/client/runtime.js`.
- **The movement integrator and the two tank tables are enforced by code, not by memory.**
  `public/SHARE/Physics.js` is the one place the per-tick accel/friction constants are written
  down — `entities/Player.js`, `lib/gameAI.js`'s bots and `public/client/game.js`'s input
  prediction all call into it rather than keeping their own copy. `public/SHARE/TanksConfig.js`'s
  client (drawn) and server (spawn) cannon tables are cross-checked index-by-index by
  `test/tanks.js`, which fails `npm test` on drift instead of relying on a comment asking the next
  editor to keep two hand-authored tables in sync (see PENDING.md item 26 for what that check
  has already caught and still has open as a human balance call).
- **Entities hold `this.room` and rooms hold `this.controller` — reached directly, not through a
  registry.** `Player`/`Bullet`/`Objects` take a trailing `room` constructor argument;
  `rooms/Room.js` takes a trailing `controller` argument. The dependency graph was never actually
  circular (`Detector` ← `Bullet`/`Player`/`Objects` ← `Room` ← `Controller`, a tree) — the only
  cycle was entities reaching back to *their own* room through a global lookup instead of a
  reference they were already handed. `rooms/index.js` is the one list of gamemode classes.
- **Entity storage is integer-slot-indexed, not identity-keyed.** Server-side, `this.INSTANCE =
  {players, objs, bullets, detectors}` are `lib/SlotMap.js` instances now (PENDING.md's old #14) —
  allocation, `KEEP_PLACE` (20) tombstoning, and live-only iteration (`.live()`/`.entries()`) live
  behind that class, so server call sites no longer hand-roll `!isNaN(obj)` guards. The client's
  own `Instances` store (`public/client/game.js`) is untouched — still the sparse-array/tombstone
  idiom described in §6, deliberately, since it never reaches the wire either way. IDs are still
  `{oId: <index>}` — the slot index, not a monotonic id — because it travels the wire as a
  `uint16` (`SocketSchema.js`); a recycled index can still point at a different entity between
  frames on the client, which is exactly what the tombstone delay is for.
- **`SocketSchema.js`'s `CODEC` table is keyed by record, not by field name.** The same field
  name means different things in different messages — `xp` is a raw `uint32` in the
  `GameUpdate` head but a packed value in a `Players` record. Don't collapse it into a
  global field→codec map.
- **Packet sizes are self-computed.** The `Encoder` grows itself; nothing needs to hand-compute
  a byte length. If you see one being computed by hand, that's new code to remove, not a
  pattern to copy.
- **Entity type dispatch is `obj.kind` against `public/SHARE/kinds.js`, not `constructor.name`.**
  `kind` sits on each class's prototype. `kinds.js` is dual-mode (the same `typeof(exports)`
  footer as `TanksConfig.js`): the server `require()`s it, the browser loads it as a `<script>`
  before `TanksConfig.js`. That's what lets `TanksConfig.js`'s three `DETEC:{type:[KIND.PLAYER,
  KIND.OBJECTS]}` auto-turret filters name the constants directly — there is no longer any
  keep-in-sync-by-hand coupling.
- **A room self-destructs when it has zero human players** (bots and bosses excluded from the
  count) — see `Room.js`. This is why an empty `boss`-mode room doesn't tick forever.
- **No HTML is ever escaped, anywhere.** Rendering is canvas-only, so there is currently no DOM
  sink to escape *for*. If a name/chat string is ever routed into a DOM node or an EJS template,
  it needs escaping at that point — nothing upstream does it for you.

---

## 4. Server core: timing, rooms, entities, collision

**Timing.** One fixed-timestep clock (`lib/clock.js`) calls every room's `step()` on an
accumulator, at `config.TICK_MS` (25 ms / 40 Hz, diep.io's own real rate — massplanchunks WP3) of
wall clock — overrun is repaid, and a stall beyond the catch-up budget (5 steps) is dropped and
logged rather than repaid as a burst. Every raw gameplay constant is denominated against
`config.REF_TICK_MS` (40 ms) instead, converted to `TICK_MS` at its consumption site by
`lib/tick.js` — see §3. Per-socket send loop (`SEND_MS`, 33 ms) is independent of the simulation tick and skips a
send if the world hasn't stepped since the last one. Per-socket slow loop (1 s): heartbeats, AFK
kick, rate-limit reset. Object respawn (`generate()`) is a simulation event run every
`400/TICK_MS` steps. The `tps` admin command reports target rate, measured rate, steps, and
drops — a stall also prints a throttled `[clock]` line to stderr.

**Rooms.** `rooms/Room.js` is the whole simulation; each gamemode is a subclass passing a block
of tunables to `super()` and overriding named hooks (table at the top of `Room.js` lists them
all). `Ffa` is 30 lines because `Room`'s defaults *are* ffa.

**Base drones** are `Bullet`s of `type 1.4` with `life = -1`, and their **`pene` *is* their health
pool** (`collision()` decrements it) — which is why `config.BASE_DRONE_HP` is written there and
not to an `hp` field. A mode declares them by overriding **`basePosts()`**, which returns one
`{team, x, y, level, phase, levels}` per drone (optionally `spin`, `crossIn`) where `x,y` is the
*orbit centre*, `level` its starting energy level and `levels` the per-centre saturation ledger
shared by reference across every post at that centre; the constructor calls it once, stores the list
as `this.dronePosts`, and spawns one drone per post via **`spawnBaseDrone(post)`**. **`tickBaseDrones()`** runs from `step()` and refills a
post `config.BASE_DRONE_RESPAWN` ticks after its drone dies.

There is exactly one drone AI — the `type 1.4` branch in `entities/Bullet.js` — and it is a
*steered field*, not a state machine walking a polar path (plan.md WP4, corrected and extended by
WP4.5): every drone carries `head`/`spd`, both rate-limited toward a per-state desired
direction/target speed, and position is their integral outside a cross or a planned level-switch
arc (below), so every transition between orbiting and chasing an enemy is continuous by
construction — nothing can turn the drone instantly or stop it dead. `chasing`, `crossing` and
`switching` are the three real branches; ORBIT/RETURN share one "orbit field" driven off position
relative to the base centre (`ox,oy`), so a drone far from its ring just leans harder toward it and
curls back on — there is no separate RETURN state to enter or an explicit snap back into ORBIT.
`orbitState` is written every tick purely for tests/the admin dump; nothing branches on it.

**Chase and return are a real dash** (plan.md WP4.5.0): `BASE_DRONE_CHASE_SPEED` is **the fastest
sustained speed any build in this game can hold** — 400 u/s, measured rather than asserted by
`test/rooms.js`'s `fastestTankSpeed()`, which replays `entities/Player.js`'s own `motion()`/
`shoot()` recurrence over every reachable class at 6 Movement Speed and 6 Reload (the ceiling is a
Fighter at level 29 riding its own rear-pair recoil, 399.2 u/s). It is pinned to exactly that
ceiling on purpose: nothing can outrun a base drone on straight-line speed, and nothing is outrun
absurdly either, so lapping an enemy base in the fastest tank in the game is still winnable — on
the head start and the `BASE_DRONE_LEASH` boundary, not on top speed. If a lap ever reads unfair,
move `BASE_DRONE_LEASH`/`BASE_DRONE_DETECT`, **not** the chase speed, which is pinned to a
measurement and fails `npm test` if a cannon retune moves the ceiling out from under it. A chasing
drone uses its own, much tighter turn limit (`BASE_DRONE_CHASE_TURN`, 6.67 rad/s), since the
limiter that governs a leisurely orbit would give a 400 u/s drone a turn radius wide enough to arc
around a strafing target instead of into it. A return is a chase back to the ring at the same speed
— no separate constant — the orbit field's own target speed blends from cruise to dash as a
smoothstep of how far off its ring the drone is (`BASE_DRONE_RETURN_ERR`), so a knocked-off drone
visibly sprints back and eases onto its ring rather than snapping or ringing around the radius.
**The turn limiter blends on that same `k`** (plan.md WP4.5.13): speed and turn rate are one
decision, so `v/ω` holds at 34–60 units in every state. They used not to, and a returning drone ran
the 400 u/s dash under the orbit limiter's 2.5 rad/s — a 160-unit turn radius against a 224-unit
home ring — which is what made a long return swing wide and overshoot.

**The chase itself is pure pursuit, and stays that way**: aim at where the target *is*, this tick
(`entities/Bullet.js`'s `dx = other.x - this.x`). No lead, no interception, no destination
prediction — that is the user's explicit instruction, not an oversight, so do not re-propose lead
pursuit off `basedrones.txt`. A chase ends on exactly two conditions, target death and
`BASE_DRONE_LEASH`; there is no "target is out of bounds" drop (plan.md WP4.5.15 deleted one that
could never fire — `DETEC.type` is `[KIND.PLAYER]` and `entities/Player.js`'s `motion()` clamps a
Player to *exactly* the drone's own clamp box, so its strict `>` never held at equality). A drone
follows a live target as far into the dark OOB band as a player may run, and slides along the wall
beside it.

**When a pursuit ends, the return starts on that tick** (plan.md WP4.5.16). The drop block snaps
`head` straight onto the orbit field's own desired direction (`orbitDesired()`, module scope in
`entities/Bullet.js` — the single expression in the tree that answers "which way is home", also used
by `clampToMap()`'s corner fallback and by the steering tail itself). This is a deliberate
discontinuity in `head`; `spd` is untouched, so the drone leaves at whatever dash speed it was
chasing at. Without it the drone spent up to a 180° turn's worth of ticks flying *further out*
before it was even moving homeward — measured, `r` climbing 1384 → 1439 over the first 20 ticks —
and against the map clamp it did that turn pressed on the boundary, which is exactly the user's
"hangs at the arena edge". Snapping onto the *field* rather than "at the orbit centre" is what makes
it right in both directions: a chase that ended inside the ring turns outward, one that ended far
outside turns near-radially in. The requirement this delivers is absolute — **no drone lingers
anywhere after a chase drops, not for one tick** — and `test/rooms.js` holds a whole baited 4team
base to it.

**A diameter cross only ever launches from the drone's own ring** (plan.md WP4.5.14). `planCross()`
builds its entry seam from the centripetal acceleration of the circle the drone is *currently*
flying, which is meaningless for one sprinting radially home off a chase — measured, crosses firing
from `r = 1300` against a `168…280` level table, which is most of what "a select few drones don't
return properly" was. `crossIn` still counts down while off-ring (it goes negative and keeps its
place in the queue, exactly the way a blocked `crossCap` lane does), so a cross is deferred, never
lost.

**Polygon bosses are ignored until they start it** (plan.md WP4.5.17, `basedrones.txt`). Base drones
engage the Fallen bosses on sight but not the polygon ones — Guardian, Summoner, Defender — "unless
those provoke them first via body damage or drone damage". Our only boss is the Summoner, a polygon
boss on `rules.bossTeam`, so without this the whole base rushed it the moment it drifted into detect
range. The gate sits at the one place a target enters the shared per-centre ledger, so the whole
centre agrees; provocation is recorded there too (`provoked`/`provokedAt`, set from
`entities/Bullet.js`'s `collision()` on either a boss body hit or a boss bullet hit) and expires
after `BASE_DRONE_PROVOKE_MEMORY`. `t.fallen` is the hook for the Fallen bosses; nothing sets it
today because we only ship the Summoner.

**Contact damage reads `BASE_DRONE_PENE`, never the drone's own `pene`** (plan.md WP4.5.11). A base
drone's `pene` is its 2000-point health pool, so `entities/Player.js`'s ordinary-bullet
`pene / 5` penetration multiplier evaluated to **400** and one drone killed any tank in a single
25 ms tick. `entities/Objects.js` already made the same substitution for shapes; `entities/Player.js`
does now too. The resulting feel is the wiki's "low damage, delivered extremely quickly": one drone
in contact is 74 HP/s (~13.6 s to kill a maxed tank), a full 4team base of twelve is ~891 HP/s
(~1.1 s). `BASE_DRONE_DAMAGE` itself is correct as it stands and was **not** retuned.

**Radius is quantised into five shared "energy levels"** (plan.md WP4.5.0, `rooms/Room.js`'s
`levelR()`/`levelPlan()`), not a continuous random band: a drone is always *at*
`levelR(1..5) = BASE_DRONE_ORBIT_R + (level - BASE_DRONE_LEVEL_HOME) * BASE_DRONE_LEVEL_GAP`, one
`BASE_DRONE_LEVEL_GAP` (one drone-side) apart, level 3 the home level. Both team modes read this one
table now — 2team's old per-mode `nominalR` derivation is gone. Each orbit centre owns one
saturation ledger — `{caps, count, crossing, target, targets, crossCap, threat, scoutIdx,
scoutTimer, sortTimer}`, the whole thing built once by `levelPlan()` (plan.md WP4.5.3a/4.5.7) and
handed back by reference, so both team modes' `basePosts()` just alias it as `levels` instead of
each rebuilding a subset of its fields by hand — off `BASE_DRONE_LEVEL_WEIGHTS`, a `Binomial(4,½)`
centred on level 3, shared across every post at that centre, so a level switch, a cross or a sort
pass on one drone is visible to its orbit-mates immediately. The **only** place a drone's target
radius (`orbRTarget`) ever moves is `entities/Bullet.js`'s module-level `levelSwitch()`, one level
at a time, from four triggers that all funnel through it: a shape hit, a drone-vs-drone proximity
overlap (`rooms/Room.js`'s pair loop sets `tooClose` on **exactly one** side when two same-side
drones are within `BASE_DRONE_SEPARATION` — deliberately less than `BASE_DRONE_LEVEL_GAP`, so it
can only ever fire between two drones sharing a level), the per-centre binomial sorter's restoring
move, and a post-swoosh drone's scripted climb back to level 3 (`homing`) — the last two replace
what used to be a single "drift back toward home on a timer" trigger; see below.

**A reactive switch cannot fail; the two gradual movers no longer wait either** (plan.md
WP4.5.0/4.5.3). `levelSwitch(drone, 'random')` — a shape hit or an overlap — always moves the
drone, preferring an open neighbour and otherwise taking whichever is least over-full, exactly as
before. `levelSwitch(drone, 'sort')` — the binomial sorter's directed move — is cap-free by
construction: the sorter only ever aims a drone at a level it has already established is in
deficit, so there is nothing left to veto. `levelSwitch(drone, 'home')` is now exclusively the
post-swoosh `homing` climb (the old general drift-home timer is gone — see below), and it is
cap-free too, but *only* while `drone.homing` is set: a scripted return must not be able to stall
behind a full level 2. The ledger may therefore transiently exceed a cap — exactly as a swoosh's
landing on level 1 already could — and the excess drains back out through the sorter a second
later; the invariant that still holds (and that `test/rooms.js` asserts) is that each centre's
`count` sums to its own live drone count. A reaction that arrives while the drone is busy —
mid-arc, mid-chase, or on `BASE_DRONE_SWITCH_COOLDOWN` — is **latched** in `reactPending` and paid
the moment it is free, rather than dropped. Mid-swoosh is the one deliberate exception: the drone
ploughs straight through, and the cross's own landing on level 1 *is* its level change, so the exit
clears the latch. This is what fixed the user-reported "base drones don't seem to turn 60° into
another energy level when they hit a shape all the time" — measured before the fix, 24 of 48
drones in a live 4team room had no open neighbour at all and silently ignored every shape they
touched.

**A level switch is one of two motions now, chosen by trigger** (plan.md WP4.5.3c): a shape hit or
a drone-proximity overlap (`mode 'random'`) still just writes `orbRTarget` immediately and lets the
orbit field's own lean do the rest — `BASE_DRONE_LEAN_SCALE` is pinned so a one-level radius error
leans the field by exactly 60°, unchanged, still a sharp reactive peel. Both other triggers — the
sorter's `mode 'sort'` and the homing climb's `mode 'home'` — fly the same gradual quintic Hermite
(`planSwitchArc()`), which now sweeps an angle derived from **`BASE_DRONE_SWITCH_LEAN`** (10°, in
radians) instead of a fixed fraction of the ring's circumference (the old `BASE_DRONE_SWITCH_ARC`,
deleted): `dtheta = LEVEL_GAP / (tan(SWITCH_LEAN) * r0) * spin`, so the swept angle shrinks as the
ring grows and every gradual switch takes the *same* 76 ticks (1.90 s) regardless of which ring it
happens on, instead of a different sweep time per ring (51–84 ticks under the old
fraction-of-circumference rule). While it flies, `this.switching` is a third exclusive state
alongside `chasing`/`crossing`: position, head and speed come from the curve, the cross trigger is
suppressed without losing its place in the queue, and a chase (but not a cross) interrupts it
cleanly. The two motions are still deliberately different reads of "move a level" — one is a
reaction, sharp on purpose; the other is a drone choosing (or being nudged) to move, and reads as
an unmistakably smoother arc beside it.

**The general drift-home timer is gone; two purpose-built movers replace it** (plan.md
WP4.5.3b/d). A per-centre **binomial sorter** (`rooms/Room.js`'s `sortDroneCentre()`, run from
`tickDroneCentres()` once per `BASE_DRONE_SORT_PERIOD`, 25 ref ticks = 1.0 s) compares the centre's
live occupancy against `levelPlan().target` — the same largest-remainder apportionment over
`BASE_DRONE_LEVEL_WEIGHTS` used to seed the ledger, recomputed for whatever the *live* drone count
happens to be right now and memoised in `levels.targets` — and, for every level with a surplus,
moves *some random number* of eligible drones (alive, not crossing/chasing/switching/homing, and
within half a `LEVEL_GAP` of their own ring) one level toward the **nearest** level with a deficit
via `mode 'sort'`. "Nearest deficit" rather than "toward home" is what makes it provably converge:
the five levels are a path graph, so this is transportation on a line — each move strictly
decreases `Σ|count − target|` by 2, so the sorter reaches the target in bounded time from any
perturbed state (`test/rooms.js` asserts this from randomised states, not just the common case). It
is the distribution's *only* ongoing restoring force now. Separately, **a drone fresh off a cross
climbs 1 → 2 → 3 and stops**: the cross's exit sets `drone.homing = 1` alongside the existing
`level = 1`; while `homing`, the drone is invisible to the sorter (it isn't part of the
distribution's slack yet) and its `'home'` switches ignore the saturation cap; `homing` clears the
instant `level === BASE_DRONE_LEVEL_HOME`. Running both the sorter and a general "drift to 3"
trigger at once would fight over the same drone — the sorter pushing surplus drones out to
1/2/4/5, the timer immediately pulling them back — so the general trigger is deleted outright, not
merely superseded.

**The diameter cross's geometry is unchanged — arc → C² blend → a straight line through the
centre → C² blend → level 1 — but its speed profile and the size of the two blends are not**
(plan.md WP4.5.1/4.5.2), precomputed into a per-tick table, not a steered pursuit: a turn-limited
pursuit of an antipodal aim point cannot be made to pass through a *specific* point, so the orbit
centre is a point the path runs straight over. **The speed profile is a plateau** (plan.md WP4.5.1,
replacing an earlier single-ramp-to-the-centre build): `v(s)` climbs by `smoothstep` from
`ORBIT_SPEED` at the ring up to peak over the path's first `BASE_DRONE_CROSS_RAMP` (25%), holds
peak across the middle, then falls by the mirrored `smoothstep` back to `ORBIT_SPEED` over the last
25% — a real held stretch at peak (the orbit centre sits somewhere inside it, not at a special
point of its own), not a single point touched once. `dv/ds = 0` at all four of s=0, s=ramp,
s=L-ramp and s=L, so both knees stay corner-free in *acceleration value* (the seams' own curvature
term is untouched), but the two knees land deep inside the still-tight entry/exit C² blends
(`BASE_DRONE_CROSS_BLEND_FRAC` puts ~80% of the path there), so peak turn rate and peak
acceleration are both *higher* than a single-ramp build would produce — 8.46 rad/s and 1.95
ref-units/tick², pinned in `test/rooms.js` with headroom (10 rad/s / 2.5) — in exchange for a dive
that is ~25% quicker (**2.00–2.65 s**, down from 2.67–3.58 s) and an actual plateau instead of a
momentary peak. `vPeak` is *solved*, not scaled, so the traversal lands on a whole tick with both
seam speeds exactly at `ORBIT_SPEED` — measured within ~1% of nominal `BASE_DRONE_CROSS_SPEED` at
every level (it can now land slightly *under* nominal too, not just over, since rounding the
duration up to a whole tick costs speed over a much longer stretch of path than a single-point peak
did). `BASE_DRONE_CROSS_SPEED`'s comment reflects this: it is *the nominal peak, held from
`BASE_DRONE_CROSS_RAMP` of the path to `1 - BASE_DRONE_CROSS_RAMP` of it*, not a point or a
constant run. **The two blends are ~2× longer**:
`BASE_DRONE_CROSS_BLEND_FRAC` (0.70, up from 0.20) is now a fraction of **each end's own radius**
rather than of the chord — which is also what removes the old `f < min(r0,R1)/D` geometric cap,
since the orbit centre now stays on the straight at fraction `r0/(r0+R1)` along it for any `f < 1`
— and `BASE_DRONE_CROSS_LEAD` (0.125, up from 0.05) rotates the line further round the orbit to
give the blend more arc to sweep before it joins. Together the blends are now ~80% of the path
(were ~50%); see above for what that costs the plateau's turn/accel bounds and buys it in dive time.
`planCross()` builds the whole
table once at trigger and `case 1.4` just indexes it, writing `x`/`y`/`vec`/`head`/`spd` straight
from it and bypassing the turn/accel limiter. The entry curls inward from the first tick, so a
cross never bulges past the ring it left. A cross always lands at level 1, ignoring the saturation
cap on the way in (deliberately — a swoosh always ends at the lowest level); the `homing` climb
above is what walks it back up afterwards, not a drift timer. **Cross concurrency is now sized
from measured demand instead of fixed at one** (plan.md WP4.5.7): each centre's ledger carries a
`crossCap`, computed once when the ledger is built (`Bullet.estimateCrossTicks(r0, R1)`, the same
duration solve `planCross()` uses, weighted by `BASE_DRONE_LEVEL_WEIGHTS` and averaged over the
five levels — `crossCap = max(1, ceil(n · meanCrossTicks / BASE_DRONE_CROSS_TICKS))`) — a fixed
cap of 1 left a 12-drone 4team centre's per-drone crossing cadence far behind a 10 s target once the
swoosh got longer than the original single-piece design. A 4team base's twelve drones get
`crossCap = 3` (moves on its own whenever `BASE_DRONE_CROSS_RAMP` does, since `estimateCrossTicks()`
routes through the same `crossVAt()` the live cross uses — it was 4 under the superseded
single-ramp-to-the-centre profile, not a hand-retuned number); a 2team pair still gets
`crossCap = 1` — two drones sharing one lane were never the problem. The
trigger's guard is `this.levels.crossing < this.levels.crossCap` now, not `=== 0`; a blocked
drone's countdown still does not reset, so it starts the instant a lane frees up rather than
losing its place.

**Enemy detection is one scout per orbit centre now, not every drone every tick** (plan.md
WP4.5.4) — kept on its own merits (a real, if smaller, saving), not for the reason first given: an
early measurement claimed base drones were 46% of a 4team tick and 93% of that was this query, but
that profile settled the room for only 600 steps before measuring, on a room needing ~6500 to reach
its real polygon count, so it was measuring base drones against a fifteenth of the entities they
actually share the world with. Re-measured properly (§4 "Collision" below): the whole base-drone AI
is ~0.8% of a tick. `rooms/Room.js`'s `tickDroneCentres()` rotates exactly one drone's
`DETEC.enabled` per centre, round-robin, every `BASE_DRONE_SCAN` (5, a raw real-tick count, not
ref-tick-converted) ticks; every other drone at that centre has its detector disabled, so its query
radius collapses from `1680*2` to `size*2`. A found target is written to the shared `levels.threat`
on the ledger, alongside a `levels.threatAt` timestamp (plan.md WP4.5.2B — see below), which every
drone at that centre reads when *deciding to start* a chase — so detection latency is at most
`BASE_DRONE_SCAN` ticks (0.125 s), during which the fastest thing in the game covers 50 units
against a 1680-unit detect radius. A drone that is already chasing keeps its own `DETEC.select` and
its own per-tick leash check exactly as before; nothing about the chase itself changed. `DETEC` is
now constructed once in `spawnBaseDrone()` (disabled) rather than lazily on first detection.

**Three base-drone bugs, all reproduced headlessly and fixed (plan.md WP4.5.2).**
`Bullet.clampToMap()` used to zero the clamped axis of `vec`, but case 1.4's own steering tail
derives `vec` FROM `head`/`spd` every tick, so the zeroed component was overwritten before it was
ever read — the clamp only ever teleported a drone back onto the map boundary once a tick, forever,
while `spd` stayed pinned at full chase speed (measured: 15 consecutive identical-position ticks
parked at a corner, or a chasing drone frozen dead at the exact corner indefinitely if its target
sat beyond the edge — the user's literal "get stuck on the edge of the arena").

**`clampToMap()` slides; it never stops** (plan.md WP4.5.12, superseding the first half of the fix
described above). WP4.5.2's version rewrote `head`/`spd` *from the clamped velocity* outside a
cross/switch arc, which slides fine against one wall but sets `spd` to exactly `hypot(0, 0) = 0` at
a **corner**, where both components are zeroed — and it deliberately left `head` alone there rather
than adopt an undefined `atan2(0,0)`. The drone then drove back into the same corner every tick
while `head` slewed away at the leisurely orbit turn rate: measured, **14 consecutive byte-identical
position ticks**. The clamp now projects the **heading** onto whichever wall is actually pressing
outward and never writes `spd` at all; pressed exactly into a corner, where no along-the-wall
direction survives, it takes `orbitDesired()`'s answer and heads home. `head` therefore jumps
discontinuously (up to 90°) on a wall contact — that is correct, it *is* a collision, and it is
strictly better than the freeze it replaces. The `vec` writes are gone from the steered path on
purpose: case 1.4's tail copies `vec` into `pvec` before calling this and rebuilds `vec` from
`head`/`spd` on its next pass, so nothing downstream ever read them. The second half of WP4.5.2's
fix — dropping a chase whose target sat beyond the drone's own clamp box — was **deleted**
(plan.md WP4.5.15): it could never fire, and the pin it was credited with was always this.

Separately, `levels.threat` (above) was written and never cleared, so acquisition silently
became "has ever been seen" rather than "is currently visible", and a target that died mid-chase
(`respawn()` swaps in a brand-new `Player`, leaving the old one's `destroy` at 1 forever) could
permanently latch a whole centre out of ever chasing again; fixed with the `threatAt` stamp,
expired after two scout rotations with no re-sighting or the instant the threat is confirmed dead.
And `Detector.reset()` left `select` pointing at the last thing it ever found instead of clearing
it, so every "forget this target and re-scan" call site in the tree (nine of them) was silently
only half working — fixed at the source, all nine callers audited; the one visible behaviour change
is that bots/bosses (`lib/gameAI.js`) now genuinely forget a target they can no longer see instead
of holding a stale reference to it.

**"In an enemy base" also means inside the drawn arena now** (plan.md WP4.5.0): both team modes'
`inEnemyBase()` are still deliberately unbounded outward on their own, but `rooms/Room.js`'s
`inArena()` bounds that at the one call site in `step()`, so the ~5-square dark OOB band around a
base is neutral ground — a fast tank can lap an enemy base through it without dying. Base drones get
the same `config.OOB_MARGIN` allowance `entities/Player.js`'s own clamp gives a tank
(`Bullet.clampToMap()`), so a chasing drone can follow a target out there exactly as far as the
target can run — and, since both are clamped to the *same* box, it works the wall right beside it
and keeps dealing damage rather than being turned back (plan.md WP4.5.15: a base is "impossible to
linger around"). A natural orbit/cross/switch-arc geometry never comes near that clamp (pinned by
`test/rooms.js`), so it only ever fires mid-chase or on a long return.

The only per-mode difference now is the orbit centre — which both team modes derive from
`baseSize` rather than a literal inset, so a base resize can't leave the drones sitting off-centre
again — and how many drones share one centre (2team's fifteen paired centres vs. 4team's single
twelve-drone centre), which only matters for `levelPlan()`'s cap/occupancy numbers. A base
drone is transparent to its own side in every state (`rooms/Room.js`'s pair loop skips a same-team
pair outright when either side is a drone — no damage, no knockback, no jitter) but always tangible
to enemies and to polygons regardless of team. `basePosts()` returning `[]` costs a mode one length
check per tick. Adding a gamemode = a subclass +
one line in `rooms/index.js` (`Controller`'s whitelist, its `server` map, and the tests all derive
from that one table). The wire enum in `SocketSchema.js`
(`toBUFFER.gamemode`/`toSTRING.gamemode`) does **not** derive from `rooms/index.js` — the client
can't `require()` server modules — so a new mode needs a key added to both tables in the same
order; `test/rooms.js` cross-checks all three lists against each other.

**Collision.** Per tick: rebuild a `quadTree`, insert every live entity, then `a.collision(b, {dis})`
per candidate pair. Each entity class implements its own `collision()`, switching on `other.kind`.
The candidate query itself is `quadTree.queryCircle()` now, not `query(closure, {x,y,r})` (plan.md
WP4.5.4) — a profiler found the broad phase (this query plus the pair-loop body right after it) is
~40% of a tick, `entities/` update methods barely register by comparison, and the old `query()` paid
for it three times over: a closure defined fresh inside the loop, an allocated `{x,y,w,h}`/
`{x,y,w:0,h:0}` object per node/point visited, and (once a leaf split) a leaf handing back its own
`this.points` *unfiltered* rather than the array it had just built to filter them. `queryCircle()`
is the same AABB/circle test against primitives, squared-distance point filtering (no `Math.sqrt`),
writing into a caller-owned scratch array so the whole pass allocates nothing; `lib/quadTree.js`'s
`insert()` was rewritten alongside it to pick the single quadrant a point belongs in rather than
recursing into all four (which also fixed a duplicate-candidate bug at internal node boundaries, a
side effect rather than the point of the change) — the two land together because the query rewrite
alone buys almost nothing until `Room.js` actually calls it. Measured: 3510 µs → 1504 µs (−57%) on
a settled 4team room, 4239 µs → 2166 µs (−49%) on 2team. `lib/SlotMap.js`'s `live()`/`entries()`
also cache their sorted key array now (invalidated on anything that changes the key set) instead of
re-deriving `[...map.keys()].sort()` on every call. `query()` itself is untouched and kept — the
per-viewer rectangle buffer query later in `step()` is its one remaining caller.

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

`GameUpdate`'s head carries `timestamp, width, height, screen, xp, level, still, cLvl, baseSize`.
`baseSize` is the room's own `this.baseSize` (the strip's width in 2team, the square's side in
4team, `0` where a mode has no bases) — the client used to re-derive 2team's strip from a
hardcoded `600` in `render.js` and could not draw 4team's at all. Both figures are exact grid-square
counts against the shared pitch now (plan.md WP1/WP2): **2team `gu(40)`, 4team `gu(67)`**, the
user's measurements off real diep, up from `gu(30)`/`gu(45)` — pinned as `gu()` multiples by
`test/rooms.js`'s grid-anchor block, so a future re-pitch moves them with the grid or fails.

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

**The upgrade queue** (`ui.js`'s `UP` namespace; keys handled in `game.js`'s `onkeydown`) lets a
point be banked ahead of the packet that grants it. `M`+digit spends whatever `Ui.still` covers
right now — one `upgrade` packet per point, immediately, not on the next `UpdateUp` — and queues
the rest of that stat's room up to its own 6-point cap; this is the *corrected* semantics; `M`+
digit originally only queued, so the bar visibly lagged a keypress even when points were already
banked. `U`+digit queues exactly one point (also spent immediately if one is banked); a bare
digit spends one point now and never queues. `M`+`U` (either held while the other is pressed)
clears the client-side queue. `UP.drain()` re-runs the queue against `Ui.still` on every `still`
update (`GameUpdate`'s head and `UpdateUp`) as well as on each keypress, so a queued point spends
the instant it's affordable rather than waiting on a UI tick. All three caps — 6 per stat,
`Ui.still` availability, and the lifetime `CONST.MAX_UP_POINTS` (28) — collapse into one place,
`UP.enqueue()`'s `budget()` helper, which subtracts points already spent (`Ui.upNb`, wire-
authoritative) and already queued from 28. The server enforces the same lifetime cap a different
way — `entities/Player.js`'s `upgrade()` gates on `this.level - this.stillLvl`, so a point can
never be spent ahead of a level-up — which is why `CONST.MAX_UP_POINTS` is a hand-mirrored
constant (assuming a 30-level cap) rather than something the server tells the client directly;
see PENDING.md.

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

The DB is off by default (§1) — every DB-touching code path in `web/app.js` and
`lib/Controller.js` goes through the single `lib/db.js` adapter. Account create/lookup, shop
purchase, and a leaderboard write have been run end to end against a real local Postgres
(`docker compose up -d`) and confirmed correct; admin commands/chat over a live dev-authed
socket haven't — see [PENDING.md](PENDING.md).

**Accounts, achievements, and the cosmetics console** (THEPLAN.md) sit on top of the same
DB-off-by-default pattern, gated behind `config.DB.AUTH`:

- `lib/auth.js` — `scrypt` password hashing, a stateless HMAC-signed session cookie (no session
  table), username/password validation, an in-memory login-attempt throttle.
- `web/app.js`'s `/auth/signup|login|logout` — signup is a *claim*: it attaches credentials to
  the caller's existing anonymous `obstarkey` row (read via `resolveKey()`, which trusts only the
  `obstarkey` cookie now, never a request-body field — the same fix applied to `/userData`/`/buy`).
- `public/SHARE/AchievementsConfig.js` is the one registry both server (`entities/Player.js`'s
  `unlock()`/`registerKill()`) and client (`public/account.js`, the menu's `#ach-edge` hover
  panel) read; guests get `localStorage`, unioned into the account on claim.
- `Ctrl+Shift+L` (`public/client/overlay.js`) now opens for anyone: a small client-side command
  table handles cosmetics locally (never reaching the server), and only an unrecognised line is
  forwarded — where `lib/Controller.js`'s permission check still gates on `devlevel`
  (`askConnection`'s `SELECT * FROM acc`), not the old plaintext `devs` table.

**Diep-feel fixes** (also THEPLAN.md, Part 4): `public/client/game.js`'s input-prediction accel/
drag now match `entities/Player.js`'s real per-tick constants instead of a stale, unscaled guess
(both files note the duplication — retune together); a bullet spawned close to the local tank
gets the same prediction lead the tank itself is drawn with, so it appears to leave the barrel
tip instead of a fixed world point (no real per-bullet owner field exists on the wire, so this is
a proximity heuristic, not a certainty); the camera carries a small `CONST.CAM_SMOOTH` trailing
lag again instead of sitting pinned dead-centre; `public/SHARE/ObjectsConfig.js` adds rarity
tiers to farmable polygons, packed into 3 previously-unused bits of the existing `states`
bitfield (no packet growth); and `UiUpdate` split off `longloop` into its own `UI_MS`-paced
`uiloop` (`net/gameSocket.js`) and now actually fills `map` with every live player's position, so
the minimap draws more than your own dot.

---

## 9. Test coverage

`npm test` runs 9 suites in dependency order (cheapest/most load-bearing first):

| Suite | What it covers |
|---|---|
| `test/proto.js` | Wire protocol: golden bytes, self-sizing, round trips, input validation, Unicode, `UiUpdate.map` and Objects rarity-tier bits. |
| `test/tanks.js` | Cross-checks `TanksConfig.js`'s client (drawn) and server (spawn) cannon tables index-by-index, via a client-mode load of the file (`test/clientTanks.js`) — every whitelisted deviation carries a reason. See §3 and PENDING.md. |
| `test/interp.js` | Client motion arithmetic (§7). |
| `test/clock.js` | Fixed-timestep clock: drift, catch-up, stalls, self-removal. |
| `test/rooms.js` | All four gamemodes — teams, bases, bot rosters, colours, respawn xp, a Summoner actually detecting a nearby player, and that `respawn()` carries a player's live `inputs`/`userKey`/`unlocked`/`killCounts` across a death. Also: base drones (placement, that they are killable at all, the respawn delay, the base fence's bullet margin — WP-E), tick-scale invariance (real-world top speed agrees within 2% whether `Physics.stepBody` is driven as if `TICK_MS` were 16, 25, or 33 — WP3) and the FOV formula (WP4). No socket, built via `boot()`. |
| `test/client.js` | Runs the actual client under a stub DOM (`test/clientDom.js`): camera, bullet speed, entity completeness, no NaN to canvas, and that the input-prediction lead (`public/SHARE/Physics.js`) reaches the same steady state at 30/60/144fps. |
| `test/clientDiff.js` | Canvas-call differential guard — pins the client's current behaviour (op count/hash in the `GOLDEN` const at the top of the file, with a comment trail of why each rebaseline happened) so a future edit that silently changes rendering fails loud. Re-baseline deliberately if you change client rendering/iteration order on purpose. |
| `test/smoke.js` | End-to-end: real socket, real protocol, real server, all four modes. |
| `test/web.js` | The merged entry point: one port serves site + socket, `play.ejs` script order, split-mode wiring, and that the auth routes degrade to a clean `{error}` (never a 500) with `DB.AUTH` off. |
| `test/clientProto.js` | Loads `SocketSchema.js` in *client* mode inside Node via `vm` — used by the above, not a standalone suite. |

**What's not covered:** a full match beyond the first minute (leveling, death screen, respawn),
two real human players in one room, the client under real browser frame timing (this pass leaned
harder on that gap than usual — see PENDING.md's item 6 for the specific things this round of
changes needs a browser to actually confirm), the full signup→login DB round trip (needs a real
Postgres), admin commands/chat over a live dev-authed socket, and load with several busy rooms at
once. Full list and reasoning: [PENDING.md](PENDING.md).

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
---

For what's undecided, unverified, or intentionally deferred, see **[PENDING.md](PENDING.md)** —
that's the living punch list; this file is the map.
