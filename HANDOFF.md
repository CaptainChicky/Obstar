# Obstar / Korexk.io — Codebase Reference

Written so a fresh agent can work in this repo **without reading most of it first.** This is a
map and a gotcha list, not a history of how the code got here — for the diep.io fidelity diff, see
[plan.md](plan.md); for open decisions and untested areas, see [PENDING.md](PENDING.md).

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
| `lib/boot.js` | 22 | Constructs the `Controller` singleton, memoised. |
| `net/gameSocket.js` | 336 | `attach(httpServer, controller)`: `income()` router, per-socket `loop`, `talk()`, `kick()`. |
| `lib/Controller.js` | 660 | `Main` — the singleton controller. Connections, rooms, chat, admin commands, leaderboard. |
| `lib/clock.js` | 160 | Fixed-timestep clock (§4). One accumulator drives every room's `step()`. |
| `rooms/Room.js` | 1848 | **The simulation, once.** Tick, quadtree, collision, spawning, bosses, Dominators, per-player views. Takes a `controller` constructor argument (§3). |
| `rooms/index.js` | 19 | **The one list of gamemodes**, keyed by the string the client's `init` packet sends. |
| `rooms/Ffa.js` | 43 | Free-for-all: tunables only. `Room`'s defaults *are* ffa's behaviour. |
| `rooms/TwoTeam.js` | 147 | 2-team: two base strips, guard drones, team colours. Constructor takes an optional `extraRules` param that `Domination.js` merges over. |
| `rooms/FourTeam.js` | 179 | 4-team: four corner bases, guard arcs, team colours. |
| `rooms/BossMode.js` | 45 | Boss hunt: ffa with the boss knobs turned up. |
| `rooms/Tag.js` | 358 | Tag: 4 teams, no bases, killer-tags-victim respawn, timed arena shrink, per-team leaderboard, ×3 xp, Arena Closer win condition. No new entity types — a Closer is a `Player` bound to `CONFIG.CLOSER`, like a boss. |
| `rooms/Maze.js` | 211 | Maze: ffa's own tuning plus a real generated rectangular wall layout (`lib/mazeGenerator.js`), a minimap dot per wall rectangle, a 5-hour close reusing Tag's Arena Closer swarm. |
| `rooms/Domination.js` | ~40 | Domination: `TwoTeam`'s own base/tuning plus 4 neutral Dominators placed from `build()`. No new entity types — a Dominator is a `Player` bound to `CONFIG.DOMINATOR`. |
| `entities/Player.js` | 983 | Tank entity: motion, shooting, upgrades, class changes, collision — including a Closer's invincibility guard and a `lastAttacker` write a Dominator's AI reads. Takes a `room` constructor argument (§3). |
| `entities/Bullet.js` | 1384 | Projectiles, incl. drone/trap/necro behaviour and the base-drone steering field. Takes a `room` constructor argument. |
| `entities/Objects.js` | 296 | Farmable polygons, incl. the Closer body-damage exemption. Takes a `room` constructor argument. |
| `entities/Detector.js` | 96 | Invisible "vision cone" query entity used by AI. A leaf — no `room`/`controller` reference needed. |
| `lib/gameAI.js` | 690 | Bot/boss/pet/Arena-Closer/Dominator AI. A plain module — `module.exports = CONFIG` directly. Bots steer through `Physics.stepBody` (tank `FRICTION`); the boss's drift, the Closer's chase, the Dominator (stationary) and the pet do not. |
| `lib/quadTree.js` | 124 | Spatial index for broad-phase collision. |
| `lib/SlotMap.js` | 147 | Server-only integer-slot entity store (allocation, `KEEP_PLACE` tombstoning, live iteration) behind `INSTANCE.players`/`objs`/`bullets`/`detectors`. `maxIndex` is the highest allocatable id, not a capacity. |
| `lib/crash.js` | 47 | Fail-fast crash handler (both entry points share it). |
| `lib/config.js` | 224 | Live tunables/flags. **`TICK_MS`/`REF_TICK_MS`** live here — read §3/§4 first. Also `FOV_*`, `OOB_MARGIN`, `BASE_DRONE_*` and `BASE_BULLET_MARGIN` (§4). |
| `lib/tick.js` | 99 | `SCALE = TICK_MS/REF_TICK_MS` and the `perTick`/`impulse`/`drag`/`ticks`/`chance`/`quadratic`/`lead`/`smoothing` conversions every per-reference-tick constant is read through. |
| `lib/damage.js` | 63 | diep's damage-multiplier table (`common(a,b)`) and `LETHAL_EPS`, shared by every collision arm and `rooms/Room.js`'s own proration resolver. |
| `lib/db.js` | 27 | The one Postgres connection point — `db.enabled`, `db.query()`, `db.check()`. Off unless `config.DB.ON`. |
| `lib/terminal.js` | 34 | Terminal colour codes (`termColors`). |
| `lib/constants.js` | 93 | **The tank/body friction split** and wall-contact physics — `TANK_FRICTION`/`BODY_FRICTION`, `BULLET_MAINTAIN`/`BULLET_CRUISE_ORDER`, `WALL_TANK_KEEP_SPEED`/`WALL_PUSH_OUT`. |
| `lib/dbConfig.js` | 17 | Postgres credentials, env-overridable. |
| `lib/mazeGenerator.js` | 162 | Maze wall generation — a port of `diepcustom/src/Misc/MazeGenerator.ts`. |
| `db/schema.sql` | ~40 | Postgres table definitions (`acc`, `wrs`, `shop`, `devs`), applied on first container init. |
| `docker-compose.yml` | ~15 | Local Postgres (`postgres:16`). |
| `lib/botNames.js` | 1 | Bot name list. Non-ASCII, deliberately. |
| `public/SHARE/kinds.js` | 37 | Entity type tags (`KIND`), used for `obj.kind` dispatch. Dual-mode: server `require()` + client global. |
| `public/SHARE/World.js` | 22 | The one grid-pitch constant (`GU`/`gu()`) — 1 grid square = 1 diep grid unit = 28 world units. |
| `public/SHARE/SocketSchema.js` | 1005 | Binary wire protocol, declarative (§5). Dual-mode. |
| `public/SHARE/TanksConfig.js` | 3123 | Tank classes, stats, barrels, upgrade tree. Shared client/server. Cross-checked against itself by `test/tanks.js`. |
| `public/SHARE/Physics.js` | 112 | **The one movement integrator** (`moveAccel`/`stepBody`/`FRICTION`) — `entities/Player.js`, `lib/gameAI.js`'s bots and `public/client/game.js` all call into it. Its `FRICTION` is the **tank's**; bullets/shapes/the boss decay through `lib/constants.js`'s `BODY_FRICTION`. |
| `public/SHARE/ObjectsConfig.js` | 22 | Rarity tiers for farmable polygons (Shiny, packed into 3 bits of the existing `states` field). |
| `public/SHARE/PetsConfig.js` | 132 | Cosmetic pet definitions. |
| `public/SHARE/ws_link.js` | 18 | Game server URL: `POST.ws`, else the page's own origin. |
| `public/client/runtime.js` | 38 | **Late-bound client registry** (`CLIENT`). Purely a client-side sequencing device for scripts loaded by `<script>` tag with no bundler. |
| `public/client/config.js` | 177 | `CONST`, palette `C`, `CLASS`/`CLASS_TREE`, mutable bags `Global`/`Game`. |
| `public/client/util.js` | 148 | `roundedPoly`, `roundRect`, `sleep`, the `General` namespace, `NET`/`Interp`. |
| `public/client/drawings.js` | 324 | Shape table: one function per body/barrel/turret/bullet/pet. |
| `public/client/entities.js` | 675 | `Tank`, `Obj`, `Bullet` — everything the server can put in the world. `Obj.update()` derives a Crasher's facing from its own movement delta (the wire has no facing angle). |
| `public/client/render.js` | 241 | `initRender()` (off-screen sprite caches), `initBackground()` (grid + team zones). |
| `public/client/ui.js` | 1395 | `initUi()`: minimap, stats, upgrades, class picker, leaderboard, messages, death screen, doors. |
| `public/client/game.js` | 908 | `CLIENT.Run()`: world state, camera, input, frame loop, `SetPacket`, `onmessage`. |
| `public/client/overlay.js` | 240 | `General.DEV` and `General.CHAT` — the two DOM-rendered widgets. |
| `public/client/boot.js` | 156 | `preRun()`: connecting screen, socket handshake, handover to `CLIENT.Run()`. |
| `public/motion.js` | 376 | Client motion primitives (§6): snapshot interpolation, frame-rate-independent smoothing. |
| `public/queue.js` | 173 | Menu page: gamemode selection, form submit. |
| `public/shop.js` | 344 | Menu page: pet shop carousel + purchase calls. |
| `public/font.js` | 851 | Animated canvas background on the menu, incl. the per-mode "door" reveal. |
| `views/index.ejs` | 187 | Menu page. |
| `views/play.ejs` | 131 | Game page. **`<script>` order is the client's dependency graph** — §6. |
| `test/*.js` | ~2835 total | 9 suites, see §8. |

`public/SHARE/` is loaded by `<script>` in the browser **and** by `require()` in Node, via a
`typeof(exports)` sniff footer. `public/motion.js` and everything in `public/client/` carry the
same footer, which is why the test suite can run the client (§6, §8) without a bundler existing
anywhere in this repo.

---

## 3. Read this before you touch anything

The things in this codebase that are *not* obvious from reading the code around them:

- **`TICK_MS` (25, 40 Hz) and `REF_TICK_MS` (40) are different numbers on purpose.** The server
  steps at `TICK_MS` (a cost decision — ~30% of a core per busy room at 40Hz against ~23% at
  30Hz), while every raw gameplay constant (speed, reload, friction, recoil, knockback) is
  denominated against `REF_TICK_MS` = 40 ms, diep's own loop, so diep's per-loop figures read
  straight in with no fudge factor. `lib/tick.js`'s `perTick()`/`impulse()`/`drag()`/`ticks()`/
  `chance()`/`quadratic()`/`lead()`/`smoothing()` convert between them at each consumption site —
  read that file's header before adding any new per-tick constant, and get the category right:
  getting it wrong doesn't fail loudly, the value just silently stops being real-world-correct at
  the live tick rate.
  **A one-shot velocity impulse needs the OPPOSITE category depending on how its body
  integrates position**: `entities/Player.js`'s recoil and collision knockback route through
  `Physics.stepBody`, which re-scales `vec` by `dtTicks` on every subsequent position step, so an
  impulse landing in `vec` is already reference-tick-denominated and must be `impulse()` (flat).
  `entities/Bullet.js` and `entities/Objects.js` integrate their own `vec` into position directly
  (`x += vec.x`, no `dtTicks` multiply of their own), so a one-shot impulse there correctly stays
  `perTick()`. `SEND_MS` must stay `>= TICK_MS`, or consecutive packets carry an identical world
  and the client's interpolator reads that as "this entity stopped."
- **Never destructure or cache a value off client `CLIENT` at module load time.** `CLIENT.Run()`
  builds `User`/`Instances`/the 2D context after every `public/client/*.js` file has already
  loaded, so a module-scope `const {User} = CLIENT` captures `undefined`; always read through
  `CLIENT.X` at the point of use. See the header comment in `public/client/runtime.js`.
- **The movement integrator and the two tank tables are enforced by code, not by memory.**
  `public/SHARE/Physics.js` is the one place the per-tick accel/friction constants are written
  down — `entities/Player.js`, `lib/gameAI.js`'s bots and `public/client/game.js`'s input
  prediction all call into it rather than keeping their own copy.
  **There are two frictions and they are not interchangeable.** `Physics.FRICTION` is the
  *tank's*, `10/11` per 40 ms loop, derived from diep's `V_max = 10·A` (stated for tanks only) —
  base top speed **362.25 u/s** (diep's 12.94 gu/s at our 28 units/gu; the live 25 ms server
  actually runs 1.8% over this, see PENDING). Everything diep does not model as a steered tank
  decays through `lib/constants.js`'s `BODY_FRICTION` = **0.9** instead: bullets, traps, drones,
  shapes, the Summoner's scripted drift. diep applies the *same* 0.9 to every entity including
  tanks, but a tank integrates it in a different order (`v += A; x += v; v *= 0.9` vs this tree's
  `v = (v+A)·F; x += v`) — `10/11` is the number that makes those two orders reach the same steady
  state, not a different fact about tanks. **Do not merge the two constants.**
  **The tank `FRICTION` also owns `TanksConfig.js`'s whole `back` (recoil) column**: a one-shot
  impulse's total displacement under `v *= F; x += v` is `v₀·F/(1−F)`, so `back` is diep's own
  per-shot recoil table (grid squares) run through `back = gu × 28 × (1−F)/F`, which at
  `F = 10/11` collapses to exactly `gu × 2.8`. Edit `FRICTION` and this whole column has to be
  recomputed with it — nothing tests the relationship. Consumed through `tick.impulse()`, not
  `tick.perTick()`.
  **Knockback (`weight`) is the same shape**: diep's "Tanks Knockbackfactor" table run through
  `weight = gu × 5.25`, since `entities/Player.js`'s bullet arm turns the column into an impulse
  as `weight / 3 * 1.6` and `gu × 5.25 × 0.53333 × 10 / 28 = gu` at `F = 10/11`. The tank *body*
  rides the same identity as a bare constant: `tick.impulse(4.48)` in the `KIND.PLAYER` arm
  (diep's "All Tank Bodies", 1.6 gu); the sandbox `'god'` repulsion sits at twice that (not a diep
  number — diep has no god mode). **The `weight` table is a measurement at 1 Bullet Damage point,
  not 0** — see PENDING for the real 4× span this doesn't model.
  **`weight` and `push` are two different fields, split from one overloaded column — do not merge
  them back.** `weight` is knockback dealt to a tank (one consumer, the bullet arm above); `push`
  is the bullet's own bounce off what it hit (three consumers in `entities/Bullet.js`'s own
  `collision()`, decayed through the bullet's `BODY_FRICTION`). They differ by ~14× in what they
  do with the same number.
  **Tank bodies are solid**: the `KIND.PLAYER` arm resolves positional overlap directly, splitting
  it by size, on top of the velocity impulse — the impulse alone decays through `stepBody` over
  many ticks while the pair is still overlapping, so without this tanks would interpenetrate. One
  non-obvious knock-on: standing *inside* another body is no longer possible, which is why a
  boss's aggro radius has to be measured from its hull rather than its centre (PENDING).
  **The tank-vs-shape arm has no equivalent overlap resolution** — open, see PENDING.
  `public/SHARE/TanksConfig.js`'s client (drawn) and server (spawn) cannon tables are
  cross-checked index-by-index by `test/tanks.js`, which fails `npm test` on drift instead of
  relying on a comment asking the next editor to keep two hand-authored tables in sync.
- **Health, regen and the damage model are diep's own shape**, though the *magnitude* of damage
  itself is currently wrong on a stale scale factor — see [plan.md](plan.md) item D1 before
  touching any damage number. What's structurally correct and load-bearing:
  `entities/Player.js`'s `maxHp` starts at diep's `MH₀ = 50`, gains `+2` per level-up and `+20`
  per Max Health point. Regen reads two direct `tick.perTick()` rates in `update()`: diep's linear
  `HPS = maxHp×(0.03+0.12×rr)/30` below a 30 s no-damage threshold, and — once past it — diep's
  own `maxHp/250` per reference tick **added** on top of the linear rate, not replacing it
  (`diepcustom/src/Entity/Live.ts:130-135`). No accumulator either way, so there's no `lib/tick.js`
  quadratic-vs-perTick miscategorisation risk.
  **`lib/damage.js`'s `common(a,b)` table is diep's real damage-multiplier rule** —
  `max(minA,minB) × min(maxA,maxB)` — replacing an old ad-hoc `damageReduction()` term that had no
  diep counterpart at all (diep's own `damageReduction` is a binary invulnerability multiplier,
  already fully expressed by this tree's `dev.ghost`/`closer`/`dev.god`/`shield` early-return
  guards). **`rooms/Room.js`'s pair loop prorates mutual damage** (diep's `Live.ts:67-84`): both
  sides' output that tick scales by the same surviving fraction if either would die mid-tick,
  computed once before either `collision()` call mutates anything, read back as `option.dmgScale`
  (default `1`). **`LETHAL_EPS` (0.0001) at every hp/pene subtraction is load-bearing, not
  decorative** — proration deliberately lands a killing blow on the target's exact remaining HP,
  and float error then leaves it alive at ~1e-16 forever if you clamp against a bare `<= 0`
  instead. A bullet's own `pene` is spent against the *target's* damage output, not against
  itself, at all three collision sites uniformly now (this used to be a base-drone-only special
  case). **`KIND.WALL`**: a bullet/trap/drone (anything with an owner) is destroyed outright on
  real contact with a real Maze wall, no bounce, no pene drain — diep's own rule
  (`Object.ts:297-300`). A tank instead sheds to `WALL_TANK_KEEP_SPEED` (0.3) of its own velocity
  and gets a `WALL_PUSH_OUT` axis-aligned push away from the wall — a pure velocity effect, no
  position-overlap teleport. Real collision against a rectangle is circle-vs-AABB (diepcustom's
  own closest-point "constrain" test), done *inside* both `entities/Player.js`'s and
  `entities/Bullet.js`'s `KIND.WALL` arms, since the broad-phase half-diagonal bound can wave a
  false positive through for a long merged wall chunk. `entities/Wall.js` is `{x, y, w, h}` plus a
  server-only `.size` (the rectangle's half-diagonal) for the generic circle-shaped broad phase.
- **Entities hold `this.room` and rooms hold `this.controller` — reached directly, not through a
  registry.** `Player`/`Bullet`/`Objects` take a trailing `room` constructor argument;
  `rooms/Room.js` takes a trailing `controller` argument. The dependency graph is a tree
  (`Detector` ← `Bullet`/`Player`/`Objects` ← `Room` ← `Controller`). `rooms/index.js` is the one
  list of gamemode classes.
- **Entity storage is integer-slot-indexed, not identity-keyed.** Server-side, `this.INSTANCE =
  {players, objs, bullets, detectors}` are `lib/SlotMap.js` instances — allocation, `KEEP_PLACE`
  (20) tombstoning, and live-only iteration (`.live()`/`.entries()`) live behind that class. The
  client's own `Instances` store (`public/client/game.js`) is untouched — still the sparse-array/
  tombstone idiom described in §6, since it never reaches the wire either way. IDs are still
  `{oId: <index>}` — the slot index, not a monotonic id — because it travels the wire as a
  `uint16`; a recycled index can still point at a different entity between frames on the client,
  which is exactly what the tombstone delay is for.
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
  before `TanksConfig.js` — that's what lets `TanksConfig.js`'s `DETEC:{type:[KIND.PLAYER,
  KIND.OBJECTS]}` auto-turret filters name the constants directly.
- **A room self-destructs when it has zero human players** (bots and bosses excluded from the
  count) — see `Room.js`. This is why an empty `boss`-mode room doesn't tick forever.
- **No HTML is ever escaped, anywhere.** Rendering is canvas-only, so there is currently no DOM
  sink to escape *for*. If a name/chat string is ever routed into a DOM node or an EJS template,
  it needs escaping at that point — nothing upstream does it for you.
- **Two read-only reference repos back every diep-fidelity decision in this tree — `diepcustom/`**
  (a reverse-engineered TypeScript reimplementation of diep.io's own server, `mspt = 40`) **and
  `diepindepth/`** (the raw RE research behind it: `physics/README.txt`, `extras/stats.md`,
  `canvas/`). Neither is built or run here — they're read for citations only.
  **`diepcustom` is the physics authority where the two disagree** — the one confirmed case is
  Bullet Speed: `diepindepth/extras/stats.md` states `(5 + 4P) × M` (a 6.6× span at the cap)
  against `diepcustom`'s own `Barrel.ts:222` `(20 + 3P) × M` (2.05×). `diepindepth`'s own Bullet
  HP row is provably on a rescaled axis (it states `(8 + 6P) × M` where `diepcustom` has
  `(2 + 1.5P) × M` — exactly 4× on both terms, the same 6.25× span either way), which is the
  evidence that made `diepcustom`'s number the one taken for speed too.
  **`diep_wiki/` contains fan-made pages** (anything filed under `Draft_*`/`Fanon*`/`Fannon*` and
  similar) — treat as unreliable; `diepcustom`/`diepindepth` win every disagreement. See
  [plan.md](plan.md)'s header for the full exclusion list.
  What neither reference repo can help with is pure client feel — camera lag, health-bar hold
  timing — see [MEASUREMENTS.md](MEASUREMENTS.md).

---

## 4. Server core: timing, rooms, entities, collision

**Timing.** One fixed-timestep clock (`lib/clock.js`) calls every room's `step()` on an
accumulator, at `config.TICK_MS` (25 ms / 40 Hz) of wall clock — overrun is repaid, and a stall
beyond the catch-up budget (5 steps) is dropped and logged rather than repaid as a burst. Every raw
gameplay constant is denominated against `config.REF_TICK_MS` (40 ms) instead, converted to
`TICK_MS` at its consumption site by `lib/tick.js` — see §3. Per-socket send loop (`SEND_MS`,
33 ms) is independent of the simulation tick and skips a send if the world hasn't stepped since the
last one. Per-socket slow loop (1 s): heartbeats, AFK kick, rate-limit reset. Object respawn
(`generate()`) is a simulation event run every `400/TICK_MS` steps. The `tps` admin command reports
target rate, measured rate, steps, and drops — a stall also prints a throttled `[clock]` line to
stderr.

**Rooms.** `rooms/Room.js` is the whole simulation; each gamemode is a subclass passing a block of
tunables to `super()` and overriding named hooks (table at the top of `Room.js` lists them all).
`Ffa` is 43 lines because `Room`'s defaults *are* ffa. `rooms/Tag.js` is the worked example of how
far that gets you: four teams, no bases, per-kill team reassignment, a timed arena shrink, a
per-team leaderboard and ×3 xp, with **no new entity types** — three hooks (`respawnTeam()`,
`leaderRows()`, a shrink timer that writes `newMap` and lets the existing lerp move it) plus rules.
The pattern to copy: add a hook with the current behaviour as its default rather than branching on
`this.gm`. Tag's win condition (an Arena Closer is a `Player` bound to `CONFIG.CLOSER`, exactly the
way `createBoss()` binds `CONFIG.BOSS`) keeps that same "no new entity types" property: `winner()`
fires `startClosing()` once, which spawns a fixed burst rather than maintaining a population,
because a Closer is invincible and never dies. Once `closing`, `respawn()` is a no-op so nobody
comes back — the match ends by becoming empty, which lets `rooms/Room.js`'s existing zero-human
self-destruct finish the job with no new termination path of its own.

**Base drones** are `Bullet`s of `type 1.4` with `life = -1`, and their **`pene` *is* their health
pool** (`collision()` decrements it) — which is why `config.BASE_DRONE_HP` is written there and
not to an `hp` field. A mode declares them by overriding **`basePosts()`**, which returns one
`{team, x, y, level, phase, levels}` per drone (optionally `spin`, `crossIn`) where `x,y` is the
*orbit centre*, `level` its starting energy level and `levels` the per-centre saturation ledger
shared by reference across every post at that centre; the constructor calls it once, stores the
list as `this.dronePosts`, and spawns one drone per post via **`spawnBaseDrone(post)`**.
**`tickBaseDrones()`** runs from `step()` and refills a post `config.BASE_DRONE_RESPAWN` ticks
after its drone dies.

There is exactly one drone AI — the `type 1.4` branch in `entities/Bullet.js` — and it is a
**steered field**, not a state machine walking a polar path: every drone carries `head`/`spd`,
both rate-limited toward a per-state desired direction/target speed, and position is their
integral outside a cross or a planned level-switch arc, so every transition between orbiting and
chasing an enemy is continuous by construction. `chasing`, `crossing` and `switching` are the
three real branches; ORBIT/RETURN share one "orbit field" driven off position relative to the base
centre (`ox,oy`), so a drone far from its ring just leans harder toward it and curls back on.
`orbitState` is written every tick purely for tests/the admin dump; nothing branches on it.

**Chase/return is a real dash at diep's own flat number**: `BASE_DRONE_CHASE_SPEED` is
`756 u/s` (`diepcustom/src/Entity/Misc/BaseDrones.ts`, `bullet.speed 2.7`), pinned to nothing —
this outruns even a maxed-Movement Sniper's own dash, so the old "circling a base in the fastest
tank is always survivable on the head start" race is gone by design (PENDING has the human-read
flag on this). A chasing drone uses its own tighter turn limit (`BASE_DRONE_CHASE_TURN`, derived
with the speed as `turn = speed_u_per_s / 60 / 25`); the orbit field's own target speed blends
cruise-to-dash as a smoothstep of how far off its ring the drone is, and the turn limiter blends on
the same curve, so `v/ω` holds at 34–60 units in every state.

**The chase itself is pure pursuit and stays that way**: aim at where the target *is*, this tick.
No lead, no interception. A chase ends on exactly two conditions — target death and
`BASE_DRONE_LEASH`. When it ends, `head` snaps straight onto the orbit field's own desired
direction (`orbitDesired()`, the single expression in the file that answers "which way is home"),
a deliberate discontinuity — without it a drone spent up to a 180° turn's worth of ticks flying
*further out* before it even started homeward.

**A diameter cross only ever launches from the drone's own ring.** `planCross()` builds its entry
seam from the centripetal acceleration of the circle the drone is *currently* flying — meaningless
for one sprinting radially home off a chase, so a cross defers (never loses its place in the
queue) rather than firing from the wrong radius.

**Polygon bosses are ignored by base drones until they provoke one** (a body hit or a drone hit) —
gated at the one place a target enters the shared per-centre ledger, so the whole centre agrees at
once, and expiring after `BASE_DRONE_PROVOKE_MEMORY`.

**Radius is quantised into five shared "energy levels"**, not a continuous random band:
`levelR(1..5) = BASE_DRONE_ORBIT_R + (level - BASE_DRONE_LEVEL_HOME) * BASE_DRONE_LEVEL_GAP`, one
`LEVEL_GAP` apart, level 3 home. Each orbit centre owns one saturation ledger (`{caps, count,
crossing, target, targets, crossCap, threat, scoutIdx, scoutTimer, sortTimer}`), built once by
`levelPlan()` off `BASE_DRONE_LEVEL_WEIGHTS` (a `Binomial(4,½)` centred on level 3) and handed back
by reference, so a level switch, cross, or sort pass on one drone is visible to its orbit-mates
immediately. The only place a drone's target radius ever moves is `entities/Bullet.js`'s
module-level `levelSwitch()`, one level at a time, from four triggers: a shape hit or drone-vs-drone
proximity overlap (mode `'random'` — a sharp reactive 60° lean, cannot fail), the per-centre
binomial sorter's restoring move, and a post-swoosh drone's scripted climb back to level 3 (both
`'sort'`/`'home'` — a shallow gradual quintic-Hermite arc instead, `planSwitchArc()`). A reaction
that arrives while the drone is busy is latched in `reactPending` and paid the moment it's free,
except mid-swoosh, where the cross's own landing on level 1 *is* the level change.

**The diameter cross's geometry**: arc → C² blend → a straight line through the orbit centre → C²
blend → level 1, precomputed once at trigger into a per-tick `{x,y,vx,vy}` table by `planCross()`
(`case 1.4` just indexes it, bypassing the turn/accel limiter entirely). The speed profile is a
plateau — ramps from cruise to peak over the first `BASE_DRONE_CROSS_RAMP` of the path, holds peak
across the middle, ramps back down over the last stretch — and `vPeak` is *solved*, not scaled, so
the traversal lands on a whole tick with both seam speeds exactly at `ORBIT_SPEED`. Each centre's
ledger carries a `crossCap` sized from measured demand (`Bullet.estimateCrossTicks()`, the same
duration solve `planCross()` uses), not fixed at one — a 4team centre's twelve drones get
`crossCap = 3`.

**Enemy detection is one scout per orbit centre**, round-robin every `BASE_DRONE_SCAN` ticks;
every other drone at that centre has its detector disabled. A found target is written to the
shared `levels.threat` (with a `levels.threatAt` timestamp, expired after two scout rotations with
no re-sighting or the instant the threat is confirmed dead) — every drone reads that when deciding
to start a chase, then copies it into its own `DETEC.select` so the per-tick leash check keeps
working whichever drone is scout.

**`clampToMap()` slides; it never stops.** The clamp projects the drone's **heading** onto
whichever wall is actually pressing outward and never writes `spd` — pressed exactly into a
corner, where no along-the-wall direction survives, it takes `orbitDesired()`'s answer and heads
home. `head` therefore jumps discontinuously on a wall contact, which is correct — it *is* a
collision.

**"In an enemy base" also means inside the drawn arena.** `rooms/Room.js`'s `inArena()` bounds
`inEnemyBase()`'s own deliberately-unbounded-outward test at the one call site in `step()`, so the
~5-square dark OOB band around a base is neutral ground. Base drones get the same
`config.OOB_MARGIN` allowance `entities/Player.js`'s own clamp gives a tank, so a chasing drone can
follow a target out there exactly as far as the target can run.

The only per-mode difference is the orbit centre (derived from `baseSize`, never a literal inset)
and how many drones share one centre (2team's fifteen paired centres vs. 4team's single
twelve-drone centre). A base drone is transparent to its own side in every state but always
tangible to enemies and polygons. `basePosts()` returning `[]` costs a mode one length check per
tick. Adding a gamemode = a subclass + one line in `rooms/index.js` (`Controller`'s whitelist, its
`server` map, and the tests all derive from that one table). The wire enum in `SocketSchema.js`
(`toBUFFER.gamemode`/`toSTRING.gamemode`) does **not** derive from `rooms/index.js` — the client
can't `require()` server modules — so a new mode needs a key added to both tables in the same
order; `test/rooms.js` cross-checks all three lists against each other.

**Collision.** Per tick: rebuild a `quadTree`, insert every live entity, then `a.collision(b, {dis})`
per candidate pair. Each entity class implements its own `collision()`, switching on `other.kind`.
The candidate query is `quadTree.queryCircle()` (AABB/circle test against primitives, squared-
distance point filtering, writing into a caller-owned scratch array — no per-call allocation).
`lib/quadTree.js`'s `insert()` picks the single quadrant a point belongs in rather than recursing
into all four. `lib/SlotMap.js`'s `live()`/`entries()` cache their sorted key array, invalidated
only when the key set changes. `query()` (the older closure-based API) is untouched and kept — the
per-viewer rectangle buffer query later in `step()` is its one remaining caller.

**Diep resolves a collision as mutual, simultaneous, partial-loop-prorated destruction** — see §3's
damage paragraph. Where it lives: `damageOutput()`/`damageGuarded()` in `rooms/Room.js`, run once
per pair before either side's `collision()` mutates anything, feeding `option.dmgScale` into every
per-kind `collision()` arm's existing damage line. Bullet-vs-bullet is deliberately not one of the
pairings here — it resolves through `entities/Bullet.js`'s own separate pene-vs-pene `KIND.BULLET`
arm (flagged for consolidation into `common()` in [plan.md](plan.md), item D4).

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
4team, `0` where a mode has no bases). Both figures are exact grid-square counts against the
shared pitch: 2team `gu(40)`, 4team `gu(67)` — pinned as `gu()` multiples by `test/rooms.js`'s
grid-anchor block, so a future re-pitch moves them with the grid or fails.

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

**Shared-scope rule** (client analogue of §3's rule): a file may alias a name off `CLIENT`
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
- `Interp`/`NET` — entity motion, from `public/motion.js` (below).

**The upgrade queue** (`ui.js`'s `UP` namespace; keys handled in `game.js`'s `onkeydown`) lets a
point be banked ahead of the packet that grants it. `M`+digit spends whatever `Ui.still` covers
right now — one `upgrade` packet per point, immediately — and queues the rest of that stat's room
up to its own per-stat cap (`CONST.MAX_PER_STAT`, 7). `U`+digit queues exactly one point (also
spent immediately if one is banked); a bare digit spends one point now and never queues. `M`+`U`
(either held while the other is pressed) clears the client-side queue. `UP.drain()` re-runs the
queue against `Ui.still` on every `still` update (`GameUpdate`'s head and `UpdateUp`) as well as on
each keypress, so a queued point spends the instant it's affordable rather than waiting on a UI
tick. All three caps — 7 per stat, `Ui.still` availability, and the lifetime
`CONST.MAX_UP_POINTS` (33) — collapse into one place, `UP.enqueue()`'s `budget()` helper.

**The economy is diep's own shape (see [plan.md](plan.md) P1/P2 for what's still off): 45 levels,
7 points per stat, 33 over a life, a class tier every 15 levels.** Points are a *grant schedule* —
one per level-up to 28, then one at 30 and every third level to the cap — written once in
`entities/Player.js`'s `pointsAtLevel()`. A fresh level-1 spawn has **zero** points. The server
enforces the lifetime cap through that same function — `upgrade()` gates on
`pointsAtLevel(level) - stillLvl` — and `rooms/Room.js`'s `getUi()` sends its result as the wire's
`still`. `CONST.MAX_UP_POINTS`/`MAX_PER_STAT` remain hand-mirrored client constants, cross-checked
against the server by `test/rooms.js`.

`window.colorPattern` is a global `[light, dark]` pair map for two-tone tank fills. CSS lives in
four places: `public/style.css`, `LeaderBoard.css`, `fontStyle.css`, and a large inline
`<style>` in `play.ejs`.

`Instances`/`INSTANCE` (both client and `Room.js`) are walked with `for...in` rather than an
indexed loop — deliberate, not unswept idiom: they're sparse id-indexed arrays
(`delete Instances[C][I]` on removal), and `for...in` only visits live keys. Profiled: the cost
of this is 0.01–0.04% of a 60fps frame budget at realistic entity counts, so it isn't worth
converting to a `Map` for speed — only clarity, if ever.

### Motion (`public/motion.js`)

Entity movement is **snapshot interpolation**, not exponential smoothing: each entity keeps its
last two server positions with arrival times, and `sample(now)` draws the point between them — no
filter state, so no startup wind-up and no steady-state lag proportional to speed. A **teleport
threshold** (400 units) snaps instead of interpolating across a respawn/map-wrap. **Capped
extrapolation** (2 packet intervals) lets entities coast briefly if packets stop arriving, rather
than freezing/flying off. The camera is pinned directly to the drawn tank (not smoothed
independently), so it can't disagree with what's rendered. Where exponential smoothing survives
(UI, not entity position), `lerpK(k, dtFrames) = 1-(1-k)^dtFrames` keeps it frame-rate independent
— a raw `d += (t-d)*k` is not. `Global.dtFrames` is clamped to `[0.2, 4]` because a backgrounded
browser tab produces frame gaps the interpolator would otherwise take literally.

**Ordinary bullets are the one exception — they are dead-reckoned, not interpolated.** Drawing one
packet interval in the past is what buys the smoothness for everything else, but for an incoming
bullet it means the shot damages you before its picture arrives. A non-drone bullet's motion is
deterministic between collisions, so `public/client/entities.js`'s `Bullet.reckonMs()` hands
`sample()` a lead of `NET.leadMs()` — the same measured quantity the local tank's own prediction
uses (`interval + rtt/2`), capped at `CONST.DEAD_RECKON_MAX_INTERVALS`. **Drones (`type >= 1`) and
pets stay on interpolation** — a drone steers, so extrapolating it just flings it along last
packet's heading. **Your own bullets get the lead too, but ramped in rather than switched on**: an
own bullet is welded to the drawn muzzle for its first interval, then `Bullet.reckonRamp` eases
from 0 to 1 on `CONST.BULLET_LEAD_DECAY` as the muzzle-weld offset decays the other way, so the two
trade off continuously instead of popping. See [plan.md](plan.md) item C1 for why this still reads
wrong in practice (a real bug upstream, not this mechanism).

---

## 7. Web/menu side & DB

`GET /` → `web/app.js` reads the `obstarkey` cookie → (DB on) looks up/creates account →
renders `index.ejs` with `POST = {key, leader, shop}` injected as a JSON global. Player picks
gamemode/name/pet (`queue.js`, `shop.js`), submits → `POST /play` sets a `preference` cookie →
renders `play.ejs` with `POST = {key, gm, name, pet, ws}`. On death (DB on), `Main.insertLB()`
writes to the `wrs` table. Leaderboard/shop refresh: `setInterval(..., 120000)`.

The DB is off by default (§1) — every DB-touching code path in `web/app.js` and
`lib/Controller.js` goes through the single `lib/db.js` adapter. Account create/lookup, shop
purchase, and a leaderboard write have been run end to end against a real local Postgres and
confirmed correct; admin commands/chat over a live dev-authed socket haven't — see PENDING.md.

**Accounts, achievements, and the cosmetics console** sit on top of the same DB-off-by-default
pattern, gated behind `config.DB.AUTH`:

- `lib/auth.js` — `scrypt` password hashing, a stateless HMAC-signed session cookie (no session
  table), username/password validation, an in-memory login-attempt throttle.
- `web/app.js`'s `/auth/signup|login|logout` — signup is a *claim*: it attaches credentials to
  the caller's existing anonymous `obstarkey` row (read via `resolveKey()`, which trusts only the
  `obstarkey` cookie, never a request-body field).
- `public/SHARE/AchievementsConfig.js` is the one registry both server (`entities/Player.js`'s
  `unlock()`/`registerKill()`) and client (`public/account.js`, the menu's `#ach-edge` hover
  panel) read; guests get `localStorage`, unioned into the account on claim.
- `Ctrl+Shift+L` (`public/client/overlay.js`) opens for anyone: a small client-side command table
  handles cosmetics locally (never reaching the server); an unrecognised line is forwarded, where
  `lib/Controller.js`'s permission check gates on `devlevel` (`askConnection`'s `SELECT * FROM acc`).

---

## 8. Test coverage

`npm test` runs 9 suites in dependency order (cheapest/most load-bearing first):

| Suite | What it covers |
|---|---|
| `test/proto.js` | Wire protocol: golden bytes, self-sizing, round trips, input validation, Unicode, `UiUpdate.map`, Objects rarity-tier bits, the `Walls` record. |
| `test/tanks.js` | Cross-checks `TanksConfig.js`'s client (drawn) and server (spawn) cannon tables index-by-index, via a client-mode load of the file (`test/clientTanks.js`) — every whitelisted deviation carries a reason, re-verified live each run rather than trusted to sit in the file forever. `offdir` is compared mod 2π (`sameAngle()`). |
| `test/interp.js` | Client motion arithmetic. |
| `test/clock.js` | Fixed-timestep clock: drift, catch-up, stalls, self-removal. |
| `test/rooms.js` | All six gamemodes — teams, bases, bot rosters, colours, respawn xp, a Summoner detecting a nearby player, `respawn()` carrying a player's live `inputs`/`userKey`/`unlocked`/`killCounts` across a death. Also: base drones (placement, killability, respawn delay, the base fence's bullet margin), tick-scale invariance (real-world top speed agrees within 3% whether `Physics.stepBody` is driven as if `TICK_MS` were 16, 25, or 33, and matches diep's derived 10×A), the FOV formula, the 45/7/33 upgrade economy and its client-mirrored constants, `Room.rejectSample()`'s hard cap and fallback on an unsatisfiable/too-small map. Tag's win condition (team reassignment not a random match, to stay unseeded-RNG-free; a spawned Closer takes no damage/knockback; `respawn()` no-ops once `closing`; a stealth class settles at `rules.invisFloor`). `KIND.WALL` direct-collision tests. No socket, built via `boot()`. |
| `test/client.js` | Runs the actual client under a stub DOM (`test/clientDom.js`): camera, bullet speed, entity completeness, no NaN to canvas, that the input-prediction lead reaches the same steady state at 30/60/144fps, dead-reckoning behaviour, own-bullet ramp; a `Walls` instance draws/updates without throwing. |
| `test/clientDiff.js` | Canvas-call differential guard — pins the client's current behaviour (op count/hash in the `GOLDEN` const at the top of the file, with a comment trail of why each rebaseline happened) so a future edit that silently changes rendering fails loud. Re-baseline deliberately if you change client rendering/iteration order on purpose. |
| `test/smoke.js` | End-to-end: real socket, real protocol, real server, all six modes. |
| `test/web.js` | The merged entry point: one port serves site + socket, `play.ejs` script order, split-mode wiring, and that the auth routes degrade to a clean `{error}` (never a 500) with `DB.AUTH` off. |
| `test/clientProto.js` | Loads `SocketSchema.js` in *client* mode inside Node via `vm` — used by the above, not a standalone suite. |

**What's not covered:** a full match beyond the first minute, two real human players in one room,
the client under real browser frame timing, the full signup→login DB round trip, admin
commands/chat over a live dev-authed socket, load with several busy rooms at once. Full checklist:
[PENDING.md](PENDING.md).

---

## 9. Conventions (so you don't mistake them for bugs)

- `let`/`const` dominate now (server-side `var` was swept); a few `for...in` traversals remain
  by design (§6).
- Objects used as enums with parallel string↔int tables (`toBUFFER`/`toSTRING`).
- Vector math via the `victor` package (`new Vec(x,y).rotate(dir).add(…)`), though some code
  still does raw `Math.sqrt(Math.pow(…))` distance instead.
- Bare `parseInt(x)` (no radix arg) is still used throughout for numeric truncation — that's why
  `radix` is off in `eslint.config.js`. Random-int generation is `Math.floor(Math.random()*n)`;
  if you see `parseInt(Math.random()*n)`, that's old code, not a pattern to copy.

---

For the diep.io fidelity diff — what's missing, what's wrong, what to decide — see
**[plan.md](plan.md)**. For open decisions, live stand-ins, and untested areas, see
**[PENDING.md](PENDING.md)**.
