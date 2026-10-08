# AGENTS.md — how to work in this repo without bloating it

For any agent (or human) adding features or changing code. The architecture map and the
load-bearing invariants are in **[HANDOFF.md](HANDOFF.md)** — read its §3 once before touching
anything. Open decisions: **[PENDING.md](PENDING.md)**. Punch list: **[issues.md](issues.md)**.
The in-progress simplification and its bit-exact oracles: **[REFACTORPLAN.md](REFACTORPLAN.md)**.
This file is about *how to write code here*, not *what the code is*.

Two priorities, in this order: **correct first, small second.** "Small" means fewer concepts
and fewer copies, not fewer characters.

---

## 1. Before you write anything

1. **Find the existing seam.** Every extension point already has a name. Rooms: the hook table
   at the top of `rooms/Room.js`. Scripted entities: `lib/gameAI.js`'s
   `CONFIG.BOSS/CLOSER/DOMINATOR/MOTHERSHIP` tables. Projectile behaviour: the `switch
   (this.type)` in `entities/Bullet.js`. Collision: each entity's own `collision()` switching
   on `other.kind`. Wire: the five tables in `public/SHARE/SocketSchema.js`. Client HUD: the
   namespaces in `public/client/ui.js`. If your change does not fit any seam, the first
   question is "which seam should grow?", not "where do I add a branch?".
2. **Grep before you write a helper.** Shared helpers live in fixed places: contact geometry in
   `lib/geom.js` (`pushAway`, `clampToArena`, `circleVsAabb` — created by REFACTORPLAN 1.1; if
   it does not exist yet, create it there rather than inlining), movement in
   `public/SHARE/Physics.js` (`moveAccel`, `stepBody`, `lerpAngle`), tick scaling in
   `lib/tick.js`, damage multipliers in `lib/damage.js`, client drawing/smoothing helpers in
   `public/client/util.js`. A second copy of any of these anywhere is a bug.
3. **Read the tests that pin the area** (`test/rooms.js` is organised by `*Tests()` function
   per mode/feature). They tell you which fields and hooks are contracts.
4. **Check the number's category** before adding any per-tick constant: `lib/tick.js`'s header
   lists `perTick / impulse / drag / ticks / chance / quadratic / lead / smoothing`. Getting it
   wrong does not fail loudly.

---

## 2. Anti-bloat rules (the ones that actually keep the tree small)

- **Two copies is the limit.** The moment a block of ≥ 5 lines would exist in a second place,
  extract it. Put it in the module that owns the concept (see §1.2), not in a new "utils" file.
- **One definition per concept.** A constant, a formula, a geometry step, a draw routine: one
  home, imported everywhere else. If two numbers must move together (e.g. `BASE_DRONE_CHASE_SPEED`
  and `_CHASE_TURN`), derive one from the other or put them next to each other with a one-line
  note — never two independent literals in two files.
- **Extend by data, not by branch.** A new gamemode is a `rules` block plus the hooks it
  genuinely needs. A new boss is a `CONFIG.BOSS` row plus a `TanksConfig` class. A new bullet
  behaviour is a `type` and one `case`. Do not add `if (this.gm === 'x')` or `if (class ===
  'Y')` in shared code — add a hook with the current behaviour as its default and override it.
- **No new files unless a concept has no home.** Allowed new files are listed in §3's recipes.
  In particular: **no new client `<script>` file** (`views/play.ejs` order is the client's
  dependency graph and `test/web.js` asserts it); helpers go in `public/client/util.js`.
- **No new dependencies.** `victor`, `ws`, `express`, `pg`, `ejs`, `cookie-parser` — that is
  the list. Vector maths is `victor`; do not add a second maths library.
- **No speculative generality.** No options objects with one caller, no abstract base classes
  with one subclass, no "future-proof" parameters. Add the parameter when the second caller
  arrives.
- **No dead code, no commented-out code, no feature flags for unfinished features.** Unfinished
  work lives on a branch or in `issues.md`, not behind `if (0)`.
- **Entity fields are a contract.** Do not add per-instance fields for something derivable at
  the use site, and never add a field "for debugging" that nothing reads. Fields read by tests
  are frozen (REFACTORPLAN Appendix A).
- **Delete when you replace.** A refactor that leaves the old path "just in case" is not a
  refactor.

---

## 3. Recipes — adding things

Each recipe lists *every* file that changes. If you find yourself editing a file not listed,
stop and check whether you are adding a branch where a hook already exists.

Helper names below (`startClosing`, `stripPosts`, `cornerPosts`, `bossTick`,
`bossUpdateGated`, `refreshDroneDetector`, `droneAutoTarget`, `spawnSubShot`, `lib/geom.js`,
`test/simDiff.js`) are the post-REFACTORPLAN names. If one does not exist yet, the plan step
that introduces it is its spec — create it there, in that shape, rather than inlining a copy.

### 3.1 A gamemode
1. `rooms/<Name>.js`: `class X extends Room` (or `TwoTeam`), constructor passes only the
   `rules` that differ from `DEFAULT_RULES`; override only the hooks you need (see the table
   at the top of `Room.js`). Arena Closers via `this.startClosing(team)`, bots via the roster
   rules, base drones via `stripPosts()`/`cornerPosts()` — never a local copy.
2. `rooms/index.js`: one line.
3. `public/SHARE/SocketSchema.js`: add the key to **both** `toBUFFER.gamemode` and
   `toSTRING.gamemode`, same position in both (the client cannot `require` `rooms/index.js`).
4. `public/client/render.js` only if the mode draws base zones (the `switch (POST.gm)` in
   `initBackground`); `views/index.ejs`/`public/queue.js` for the menu card.
5. `test/rooms.js`: a `<name>Tests()` for the mode's own rules (teams, spawn, win condition);
   `test/simDiff.js` picks the mode up automatically from `rooms/index.js` — capture and pin
   its hash in the same commit.
6. `HANDOFF.md` file map: one row.

### 3.2 A boss / scripted Player (Closer, Dominator, Mothership-like)
1. `public/SHARE/TanksConfig.js`: the class in **both** halves (client draw table, server
   stats). Boss-scale geometry converts on the boss axis — see HANDOFF §3 and the
   `defenderGeometryTests()` pattern; anchor at least one assertion to a diep du figure.
2. `lib/gameAI.js`: `motion`/`update` functions built from the shared pieces (`bossDetect`,
   `aiAimInputs`, `bossThrust`, `bossPatrol`, `bossTick`/`bossUpdateGated`/`bossUpdateAlways`,
   `Player.prototype.regenTick`). A new table row `[motion, update, className]`. Do not
   reimplement regen, death animation, or the arena clamp.
3. Spawn site: `Room.createBoss()` handles `CONFIG.BOSS` rows; anything else gets a
   `Room.create<Thing>()` hook **on Room**, not on one mode.
4. `test/rooms.js`: spawn, HP/level, aggro gate, death → cleanup (`bosses`/`motherships`
   list), and the geometry test.

### 3.3 A tank class
1. `public/SHARE/TanksConfig.js`: client half (drawn cannons/body/turrets), server half
   (stats, `cannons[]`, `maxDrone`, `DETEC`, `statMax`, `ups`), the `tree` entry, the `list`
   entry. `test/tanks.js` enforces `client.height === server.canonLength` etc. — run it first.
2. `public/client/drawings.js` only for a genuinely new *shape* (not a new arrangement of
   existing ones).
3. Nothing in `entities/Player.js` — if the class needs new *behaviour*, that is a new cannon
   flag (`auto`, `autoDir`, `ring`, `droneCap`, `sub`, `weapon`, …) handled in `shoot()`'s
   existing branches, or a new bullet `type` (3.4).
4. Bot build orders in `lib/gameAI.js` `BOT_PATHS` if bots should use it.

### 3.4 A projectile behaviour
1. Pick the next unused `type` (`0` bullet, `1.x` drones, `2` trap, `3.x` necro/boss drones,
   `4` skimmer, `1.5` minion). Wire type is `parseInt(type)` unless `rooms/Room.js`'s
   module-level `bulletWireType()` maps it — extend that function, not the callers.
2. `entities/Bullet.js`: one `case` in `update()`. Reuse `refreshDroneDetector`,
   `droneAutoTarget`, `droneIdleOrbit`, `spawnSubShot`. If the projectile needs a collision
   rule, add it to the existing `KIND.*` arms via a condition on `type` — or to
   `lib/damage.js`'s `projectileMultiplier()` if it is a damage-class question.
3. `rooms/Room.js`: `NO_OWN_TEAM_TYPES` / `SAME_OWNER_TYPES` if it has team-passthrough
   semantics.
4. `public/client/drawings.js` `bullet[n]` and `render.js`'s alpha-fade `case` list.
5. `test/rooms.js`: lifecycle (spawn, cap accounting if `maxDrone`, release on owner death).

### 3.5 A wire field
`public/SHARE/SocketSchema.js` only: `TYPE` + `SCHEMA`, plus `CODEC` if transformed, plus
`LIMITS` if it changes a packet's legal size. Producer in `Room.getBuffer()/getUi()`, consumer
in `public/client/game.js` `SetPacket`. `test/proto.js` golden bytes will move — update them
in the same commit with the reason. Never compute a byte length by hand.

### 3.6 A tunable
`lib/config.js` for live server knobs (state its unit and its `lib/tick.js` category in one
line), `public/client/config.js` `CONST` for client feel. One literal, one home; consumers
read it through the module, pre-converted once at module load when it is per-tick.

### 3.7 A test
Logic only: race conditions, accounting (drone caps, xp, refunds), geometry anchored to an
external diep figure, protocol bytes. **Never UI tests** — verify those in sandbox/tester
(`issues.md` → Testing policy). Put it in the suite that owns the area; add a new
`<thing>Tests()` function to `test/rooms.js` rather than a new file. A test that only compares
two halves of this tree against each other cannot catch a scale error — anchor one assertion
outside the tree.

---

## 4. Numbers and physics

- **Two frictions, never merged**: `Physics.FRICTION` (tank, 10/11) vs
  `lib/constants.js`'s `BODY_FRICTION` (everything else, 0.9). HANDOFF §3 has the derivation.
- **Impulses**: into a `stepBody` body → `tick.impulse()`; into a self-integrating body
  (`Bullet`, `Objects`) → `tick.perTick()`. Thrust added every tick → `tick.quadratic()`.
- **`weight` ≠ `push`**, `TANK_TANK_MULT`/`TANK_SHAPE_MULT`/`LETHAL_EPS` from `lib/damage.js`,
  never a local literal.
- **When you move a number, grep for the old literal, not the constant name** (PENDING
  "Tooling notes" lists known near-collisions).
- **`Math.random()` order is behaviour.** `test/simDiff.js` and `test/clientDiff.js` seed one
  RNG; adding, removing, reordering or changing the short-circuit around a draw moves the
  goldens even when gameplay is identical. Know whether your change is *supposed* to.
- **Floating-point text is behaviour** in a refactor: `Math.hypot` ≠ `Math.sqrt(a*a+b*b)`,
  `a*b*c` ≠ `a*(b*c)`, `PI + atan2(a,b)` ≠ `atan2(-a,-b)`. A behaviour-preserving change moves
  expressions, it does not rewrite them (REFACTORPLAN Appendix B).

---

## 5. Goldens and gates

```
node test/simDiff.js; node test/clientDiff.js; node test/rooms.js; node node_modules/eslint/bin/eslint.js .   # fast
npm test                                                                                                     # full
```

- Both goldens must pass before and after every commit. A **behaviour-preserving** change
  leaves them untouched. A **deliberate** gameplay/render change re-pins only the modes it
  touches, in the same commit, with the reason in the commit body and (for `clientDiff`) in
  the file's comment trail. Never re-pin to make an unexplained failure go away; use
  `OBSTAR_SIM_CAPTURE=1` / `OBSTAR_DIFF_CAPTURE=1` and diff the dumps to find the first
  divergent line.
- Never weaken or delete an assertion to pass. If an assertion is wrong, fix it in its own
  commit with the proof.
- Lint must be clean. The config's `LEGACY` relaxations are the whole list; turning a rule on
  means fixing every hit in the same change.

---

## 6. Comments and docs

- A comment states an invariant, a unit, an ordering requirement, a "do not merge these", or
  *why a number is what it is* — in one or two lines. Not history, not task ids, not pointers
  to markdown, not a restatement of the next line, not a paragraph defending a design.
- When you edit a function, bring its comments to that standard. No repo-wide sweeps outside
  REFACTORPLAN Phase 9.
- `HANDOFF.md` is the map: a new file, hook, or test suite is a row there in the same commit.
  Finished nuance-free items are *deleted* from `PENDING.md`, not marked done. `issues.md` is
  the punch list; a bug found while doing something else goes there, not into your diff.
- `README.md` "Departures from diep" is the only place a deliberate diep divergence is
  recorded. If you add one, add it there.

---

## 7. Commits

One concern per commit; message `<area>: <what>` (`rooms: Survival closes on last contender`,
`refactor(bullet): 5.2 droneAutoTarget()`), body = why + gate summary
(`simDiff 11/11, clientDiff ok, rooms 851/0, lint clean`) + any accepted divergence. No
drive-by edits: a commit that "also" cleans up an unrelated comment is two commits.

---

## 8. Never

- Never bypass a hook with a mode/class check in shared code.
- Never add a second definition of a constant, formula, or helper that already has a home.
- Never add a client script file, a dependency, or a DB table without an owner decision.
- Never "restore" a value flagged in `README.md` departures or `PENDING.md` "knowingly wrong".
- Never commit `lib/config.js` with `DB.ON: true`.
- Never add a UI test, a `console.log` left in a hot path, or a `setTimeout` inside the
  simulation (`Room.step()` and everything it calls must stay synchronous and wall-clock-free —
  that is what makes `test/simDiff.js` possible).
