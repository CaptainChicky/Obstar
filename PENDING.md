# Pending & Decisions

Short-form companion to [HANDOFF.md](HANDOFF.md). Everything mechanical (the refactor, §1–9,
§12.1–12.2) is done and tested — this doc is only what's *left*: things needing a human call,
decisions already made but not yet built, and things nobody has verified yet. No status prose,
just the list.

---

*The game is being remade from scratch: the DB will be emptied and rebuilt, and nothing
documented from the old dev (naming, MySQL, anything below) needs a migration path or
backward-compat story. Old conventions are defaults to improve on, not constraints.*

## 🔵 Decided — queued for implementation (not yet built)

2. **Next gamemodes: Domination/Maze get real new entity types.** Decided — not tunable-only.
   Needs: a new `kind` in `public/SHARE/kinds.js` for static geometry (walls) and one for capturable
   structures; a static (no `step()`) entity class with its own `collision()`; quadtree
   insertion for that static geometry; a wire-schema addition (`SocketSchema.js`) so the client
   can draw walls/structures; team-ownership state on capturable structures synced over the
   wire. New `kind`s go in `public/SHARE/kinds.js`, which `TanksConfig.js`'s `DETEC` filters
   now reference by constant (#16 done) rather than hardcoding — nothing to keep in sync by hand.

## 🟣 Needs a human balance call (flagged by `test/tanks.js`)

26. `test/tanks.js` cross-checks `public/SHARE/TanksConfig.js`'s client (drawn) and server (spawn)
    cannon tables and whitelists a handful of real, deliberate deviations that aren't bugs but
    aren't confirmed-intentional either — full reasoning is in the `WHITELIST` table in that file,
    not duplicated here:
    - Twin, Twin Flank, and Triple Twin's cannons are all drawn `offx` ±17 but spawn bullets at
      ±18 - too consistent across three independently-written classes to be a typo, but never
      confirmed as an intentional spawn nudge either.
    - Summoner is the only class in the table where the drawn barrel is *shorter* than the spawn
      point (by 2.5 units) rather than the usual few-unit muzzle-tip lead - fixing it means either
      lengthening the drawn barrel or shortening the spawn radius, both of which change this
      boss's visuals or bullet range.
    - Minor test gap, low priority: the whitelist's `offdir` comparison is a literal `!==` and
      doesn't normalize angles mod 2π, so two float64 expressions for the same angle
      (Fortress/Summoner) read as a mismatch and need a whitelist entry that a correct comparison
      wouldn't require. Only ever a false positive, never a false negative.

## 🟢 Untested — real risk, nobody has watched these happen

3. A full match, start to finish: leveling into the class tree, death screen, respawn.
4. Two real humans in the same room (only single-player/single-tab has been tested).
5. Boss AI behavior — no longer entirely unwatched: `test/rooms.js` now drives a Summoner
   through two real `step()`s and asserts it actually adds a nearby player to `this.detected`,
   which caught a real bug (below) rather than just proving bosses *exist*. Still never watched
   in a live match with a human moving around it, though.
   - **Bug found and fixed**: `rooms/Room.js`'s `respawn()` swaps in a brand-new `Player`
     object and was not carrying over `inputs`, `userKey`, `unlocked`, or `killCounts` from the
     tank it replaced. A movement key held through the moment of death stayed physically held
     but arrived on the new tank looking exactly like "never pressed" (the client only re-sends
     `keydown` on an actual state change) — and since `shield` (spawn protection) only clears
     inside `motion()`/`shoot()` when they see real input, that silently extended spawn
     protection, which `Detector.js` hides from every boss/bot, until the player happened to
     press something new. Losing `userKey` also meant `Controller.disconnect()`'s achievement
     write-back silently no-op'd for the rest of the session after a single death. Also floored
     `lib/gameAI.js`'s Summoner distance divide (`n.level` → `Math.max(1, n.level)`) — level 0 is
     real for one tick on every join/respawn and made the divide `Infinity`.
6. The client in an actual browser (only a stub-DOM harness has run it — no real frame timing,
   no tab throttling). This pass touched rendering/feel more than anything before it has, so the
   in-browser checklist is longer than usual:
   - Account chip shows `Guest`; signing up carries coins over; the achievements edge-hover zone
     darkens/scrolls the way it's supposed to and a manual scroll actually pauses the auto-scroll.
   - `Ctrl+Shift+L` accepts `color`/`uiscale`/etc. and refuses an admin command for a non-admin.
   - Bullets visibly leave from the barrel tip, including while strafing hard perpendicular to
     the aim direction. Reported broken twice. The owner is now a real wire bit (`states[1]` on
     a `Bullets` instance), not a proximity guess, and the second fix replaced the temporal lead
     — which could only ever slide a bullet along its own velocity, and so did nothing for the
     strafing case, where the whole error is perpendicular to it — with a spatial offset that
     rides the drawn tank for the first packet interval and then decays
     (`public/client/entities.js`, `Bullet.update()`; `CONST.BULLET_LEAD_DECAY`).
     `test/client.js` now asserts the alignment directly, so this is a "confirm it *feels*
     right" check rather than a "confirm it works" one.
   - The camera has a *slight* trailing lag again (`CONST.CAM_SMOOTH`) — confirm it reads as a
     hair of chase, not the old pre-refactor drift. `CONST.CAM_SMOOTH` was playtest-tuned on top
     of a since-fixed bug in the local tank's own input-prediction lead (item 24) — the lead is now
     smaller and frame-rate-stable instead of growing with refresh rate, so this needs a genuine
     human retune with the game open, not just a "does it still look ok" check.
   - A green "shiny" polygon and a rainbow "Mythic" one are both visibly distinct from an
     ordinary shape (`public/SHARE/ObjectsConfig.js` — chances were retuned rarer than the
     first-pass defaults; confirm they still turn up often enough to notice in a normal session).
   - The minimap shows other players' dots, not just your own, moving smoothly (`Room.getUi`'s
     `map`, `Ui.map()` in `public/client/ui.js`).
   - The minimap has a thin dark frame, about half what it showed before this pass, in every mode
     (`public/client/ui.js`'s `MAP.lw`, 12 → 6 — plan.md WP4.5.3).
   - Level 1 vs. level 30 with Movement Speed maxed: confirm the tank no longer rubber-bands
     differently at the two speeds (`public/client/game.js`'s prediction constants now match
     `entities/Player.js`'s exactly instead of a stale, unscaled guess).
   - **Base drones and bases (massplanchunks WP-E).** Nothing here is covered by a browser-free
     test beyond placement and arithmetic:
     - 4team: each corner base is a coloured **square**, in-world and on the minimap; 2team's
       strips match `baseSize` rather than the old hardcoded 600.
     - 4team: 12 small triangles orbit each base centre together, each cutting straight across
       the ring roughly every 10 s. 2team: 15 evenly spaced pairs down each side on visibly
       tighter rings, same ~10 s cadence.
     - Walk your own tank through your own base drones: no damage, no knockback, no shove — they
       phase through. Shoot through them with your own bullets: nothing happens to either.
     - Fire into an enemy base: bullets die about a grid square and a half past the line, not on
       it. Standing in one still kills you in about a second.
     - Kill a base drone (poke in and out with something high-DPS): it dies, and a new one is
       orbiting that post ~1 s later. This is the one that most needs eyes on it — see item 23 on
       whether `BASE_DRONE_HP`/`BASE_DRONE_DAMAGE` are on the right scale at all.
     - Walk into an enemy base: the drones run you down fast (`BASE_DRONE_CHASE_SPEED`, a level-0
       tank's own top speed), and a drone knocked off its ring visibly sprints back and settles
       rather than ringing around the target radius. A drone drifting home (including a post-swoosh
       climb back to level 3) leans onto the next ring over a long, gentle arc, visibly different
       from a shape-hit/proximity peel's sharp ~60° jerk.
     - **Drive around the outside of an enemy base through the dark grey border** — you should not
       die out there, and should be able to get the whole way round, including a 4team corner. You
       do get chased into it (the drones follow, `Room.inArena() && inEnemyBase()`), so whether you
       survive the lap is a race between your own top speed and `BASE_DRONE_CHASE_SPEED` — that race
       being close is the point (plan.md WP4.5.0).
     - Drones do not stick to the arena edge. Drive a fast tank into an enemy base's outboard
       corner and look behind you: a chasing/returning drone should follow, turn, and keep moving —
       never park itself flat against the boundary and sit there motionless (plan.md WP4.5.2's
       `clampToMap()` fix, rewritten again by WP4.5.12). Then leave, die, and come back: the base
       must chase you again — before this fix, a base that killed you once could stop chasing
       anything at all for the rest of the round.
     - **Walk into an enemy base in a maxed tank and confirm you die in ~1 s to a full base, and in
       about thirteen seconds to a single drone that has caught you alone — not the instant you are
       touched** (plan.md WP4.5.11). Until that fix any contact was a one-tick kill at any HP, so
       this is the first time `BASE_DRONE_DAMAGE` is actually observable; judge it against the
       wiki's "low damage, delivered extremely quickly" and see item 23.
     - **Bait a base out to the arena corner through the dark band, then die or leave: every drone
       turns for home on the tick the chase drops** (plan.md WP4.5.16). Watch one drone — it should
       be visibly closer to its base on the very next frame, and closer again on every frame after
       that. Not after a beat, not after a wide arc, not after peeling along the wall first.
       Nothing ever sits still against the arena edge; not one drone, not for one frame.
     - **Watch a returning drone all the way in**: one clean curve that eases onto its ring
       (plan.md WP4.5.13). It must never slow to a crawl and peel off through the base centre
       halfway home — that was a diameter cross firing mid-return (plan.md WP4.5.14).
     - **Stand next to the Summoner inside a base's detect range in a team mode**: nothing happens
       until the Summoner hits a drone, and then the whole base engages it (plan.md WP4.5.17).
7. Chat over a real client connection — admin commands are now proven end-to-end over a real
   socket against Postgres (connect/disconnect, permission gating, `broadcast`, `tps` all
   confirmed live), but chat hasn't been exercised the same way.
8. Real browser hitting the new packet-length validation (`chat`/`com` in particular) — a
    mistake here shows up as a kicked player, not a crash.
9. Load: multiple busy rooms at once on one process (everything so far is one room alone).

## 🟠 Known bug, not yet fixed

- achivements bar is still fucked will revisit this later

25. **`Room.spawnPoint()`'s `while(1)` can hang the server on a small enough map.** The default
    implementation (`rooms/Room.js`) rejects any point within a hardcoded 1540-unit radius of the
    origin plus two 1120-unit nests at the quarter-points - written against ffa's gu(451)-unit map,
    where that's a small carve-out (radii x1.4 under the grid rescale, plan.md WP1 - was 1100/800
    against a 9020-unit map). Below roughly 2744 units wide, no point on the map can ever be 1540
    units from the origin, so the loop never finds an accepted point and spins forever, on
    the simulation thread, taking the whole room (every player in it) down with it. Currently
    survived only because `rooms/Sandbox.js` documents the floor in a comment and stays at gu(150)
    = 4200 (comfortably clear, though the margin is thinner in square terms than before); nothing
    stops a future mode, an admin `mapResize`, or a typo'd config from landing under 2744 and
    hitting it for real. Fix is either a loop iteration cap that falls back to a cheaper placement,
    or deriving the rejection radii from `mapSize` instead of hardcoding them against ffa's map.

27. **A bullet's own thrust does not scale correctly with `TICK_MS` — found by massplanchunks
    WP-D's independent re-audit of the WP3 rescale, proven with `test/rooms.js`'s new (reporting,
    not asserting) bullet-range case.** `entities/Player.js`'s movement reaches the standard
    "add an accel, decay through `FRICTION`" recurrence through `public/SHARE/Physics.js`'s
    `stepBody`, whose `dtTicks` parameter scales *both* the velocity add and the position step
    (`body.x += body.vx * dtTicks`) — that double scaling is why `Physics.js`'s
    `MOVE_ACCEL_BASE`/`PER_UP` needed a numerically-solved one-time factor (`1.462688`) instead of
    a plain linear one. `entities/Bullet.js`'s shared motion tail (every bullet type falls through
    to it) hand-rolls the same shape — `vec.add(tick.perTick(this.speed)...); vec *= FRICTION;` —
    but then does a bare `this.x += this.vec.x`, with no second `dtTicks`/`SCALE` factor. Measured
    directly (drive `Physics.stepBody`-equivalent code at `TICK_MS` 16/25/33): a bullet's one-time
    muzzle kick (`can.exitSpeed`) is unaffected and stays invariant on its own, but the *ongoing*
    per-tick thrust that keeps it cruising is not — total range comes out roughly proportional to
    `1/TICK_MS` (955 to 1695 units across that range for the same class, a bullet whose own
    lifetime is itself correctly wall-clock-constant). The correct category is `tick.quadratic()`,
    not `tick.perTick()` — verified numerically: re-deriving the accumulation without the
    per-tick-then-position-again double-scale (i.e. `vec.quadratic(speed)`-shaped instead of
    `vec.perTick(speed)`-shaped) reproduces a stable, TICK_MS-invariant range to <1%, exactly the
    "accumulator that integrates twice over ticks" category `lib/tick.js`'s header already
    describes for `hpregan` — bullets are a second instance of the same shape nobody noticed
    because a bullet's own dominant, *visible* number (`can.speed`) is currently read as a plain
    `perTick` value, not a `quadratic` one.
    **Not fixed this pass, on purpose:** changing the category without also changing what
    `can.speed` numerically *means* would silently roughly double every bullet's cruising
    contribution to range at today's live `TICK_MS` (25) — a real balance change hiding inside a
    "correctness" fix. The actual fix is to route `entities/Bullet.js`'s shared motion tail
    through `public/SHARE/Physics.js`'s `stepBody` the way `entities/Player.js` and
    `lib/gameAI.js`'s bots already do (so it inherits the same, already-proven-invariant shape),
    which requires re-deriving `public/SHARE/TanksConfig.js`'s `speed` column - all ~118 cannons -
    against a solved compound factor (`Physics.js`-style, not a plain `40/33`) to keep today's
    actual bullet ranges from moving. That is the same shape of work as item 16's `back` column or
    item 18's damage model - a deliberate numeric pass, not a mid-audit patch.
    **The same bug, same fix, same non-fix-here, in two more places** that hand-roll "add a
    per-tick thrust, decay via `FRICTION`, then `position += vec`" instead of going through
    `stepBody`: `entities/Objects.js`'s `DETEC`-driven homing/return-to-nest pull (`update()`'s two
    `this.vec.add(v)` calls, `v = tick.perTick(0.33939)...`) and `lib/gameAI.js`'s Summoner-boss
    steering and pet-follow motion (`this.vec.add(new Vec(tick.perTick(...))...)` in both `BOSS`
    and `PETS`). Objects.js's own collision-knockback impulses and its speed-clamp drift are *not*
    affected - those are one-time or bounded-decay shapes, verified separately to already be
    invariant.
    **A second, narrower finding in the same audit, also not fixed:** `AUTOTURRET_LEAD`
    (`entities/Player.js` and its identical copy in `lib/gameAI.js`, `tick.lead(9.9)`) is not
    tick-scale invariant either, the opposite direction from the bug above - the divisor's
    `tick.lead()` conversion makes `other.vec * dis / AUTOTURRET_LEAD` vary by over 100% across
    `TICK_MS` 16/25/33/40, where leaving the divisor unconverted (flat `9.9`) stays within ~1.5%,
    because `other.vec`'s magnitude is itself already close to `TICK_MS`-invariant (same reasoning
    as the two comments massplanchunks WP-D added at `entities/Player.js`'s and
    `entities/Objects.js`'s knockback-threshold checks). Left as-is because un-wrapping it changes
    today's auto-aim feel at live `TICK_MS` (25), which is a balance call. `lib/gameAI.js`'s
    pet-follow lead (the `2.475` multiplying `play.vec`) already avoids this trap correctly - it
    is *not* run through `tick.lead()`, and WP-D confirmed by testing, not just reading, that this
    is the right call, not an oversight.
    **Corroborating evidence from `public/SHARE/TanksConfig.js`'s own numbers,** checked with a
    throwaway script (massplanchunks WP-D pass 3) that divides every `reload`/`speed`/`back`/
    `weight`/`damage`/`pene` in the server cannon table by each candidate one-time-rescale factor
    and checks whether the result round-trips to a clean number: `reload` (all 118 cannons) round-
    trips cleanly through the `ticks`-category factor (`Math.round(x*33/40)`, inverted); `back` and
    `weight` (118/118 each) round-trip cleanly through `Physics.js`'s compound `1.462688` factor,
    *not* the plain `40/33` `perTick` one - i.e. they were already correctly treated as the
    "decays through the recipient's own `stepBody`-shaped friction" category the two comments above
    describe; `damage` (118/118) round-trips cleanly through the plain `perTick` `40/33`; `pene`
    (118/118) is already round *unconverted*, confirming it's an absolute HP-like pool (matching
    `entities/Objects.js`'s own `hp`), never meant to be rescaled at all. **`speed` is the outlier**
    - only 82/118 cannons round-trip through either factor (`perTick` or the `1.462688` compound),
    leaving 36 (Basic, Twin, Twin Flank, Triple Twin, Destroyer, Fortress, Summoner, BattleShip and
    others) that round-trip through neither. Given item 27 above, that's expected: bullet `speed`
    is consumed by a doubly-integrated (`quadratic`-shaped) recurrence, not a `perTick` or
    `stepBody`-compound one, so neither candidate factor was ever going to be the right one to
    check it against - the 36 outliers aren't 36 separate typos, they're the same missing category
    showing up in the one place a script could see it numerically. Re-deriving `speed` is exactly
    the re-derivation item 27 already scopes; nothing further to do here independently.

## 🟡 Explicitly deferred (told not to do this pass)

11. The Spade Squad diep-physics balance pass. Part 4.1 of THEPLAN.md fixed the *client/server
    mismatch* in the existing movement constants (accel, drag, tick conversion) so prediction
    matches what the server actually does — it deliberately did not retune the underlying
    movement/knockback/recoil numbers themselves against any external reference. `lib/config.js`
    is explicit that every one of those was hand-tuned against a measured ~29Hz tick; retuning
    them is its own pass, to be scoped once real reference numbers are available.
    **The reference numbers now exist** — `physics.html` has been read against the whole tree and
    the mismatches are itemised in items 13–24 below. Still deferred, but no longer unscoped.

10. **The comment-bloat sweep.** Comments should carry architecture and load-bearing "why", not
    history. `test/clientDiff.js`'s rebaseline trail, `lib/config.js`'s TICK_MS essay, the
    `THEPLAN 4.1` / `PENDING #14` / `HANDOFF 5.8` back-references scattered through `entities/`,
    `rooms/` and `public/client/`, and `rooms/Room.js`'s respawn narrative are all deletable. Its
    own pass — folding it into a feature diff buries the real change.

12. **Forward velocity inheritance on bullets** — a real diep/arras feel difference, deliberately
    not taken while fixing the muzzle alignment above, because it changes damage-relevant physics
    rather than what gets drawn. `entities/Bullet.js`'s constructor gives a bullet
    `Vec(speed*exitSpeed, 0).rotate(direction)` and nothing else: driving forward into your own
    shot changes nothing about it. arras adds the tank's velocity *projected onto the firing
    direction*, clamped at zero so it can only ever speed a bullet up, never slow it or bend it
    (`open-source-arras-main/server/game/entities/gun.js`, the `extraBoost` block in `fire()`) —
    which is why a rammer's shots there feel like they carry. Sideways motion is correctly
    ignored by that formula, so it does not reintroduce anything the muzzle fix just solved. Cheap
    to add; needs a balance opinion first, and interacts with #11.

## 🔴 Measured against diep.io's real physics (`physics.html`) — mismatches

*Source: `physics.html`, the archived spade-squad diep.io physics page (2022). Community-derived,
not diep source — one formula in it is internally implausible and is flagged as such below. Every
"ours" number here was read off the current tree, and every ratio is arithmetic on those two, not
a feel judgement. Nothing in this section has been changed; it is the scoping data #11 was waiting
on. Numbers assume the real-world quantities `TICK_MS: 33` / `FRICTION: 0.964` implied (top speed,
recoil, reload in seconds) — massplanchunks WP3 has since landed (`TICK_MS: 25`,
`REF_TICK_MS: 40`, `lib/tick.js`) but preserved those real-world quantities exactly, so no
re-derivation is needed here.*

13. **DECIDED and IMPLEMENTED (plan.md WP1): 1 gu = 28 units, the client grid pitch now matches.**
    `public/SHARE/World.js` is the one place this is written down (`World.GU`/`World.gu()`), read by
    both `lib/config.js` (`OOB_MARGIN` -> `gu(4)` = 112, `BASE_BULLET_MARGIN` -> `gu(1.5)` = 42) and
    every `rooms/*.js` map size (each mode keeps its square count - ffa/4team/2team/boss/sandbox
    land at gu(451)/gu(450)/gu(400)/gu(350)/gu(150)). The rest of this item is kept below as the
    derivation record.

    diep denominates everything in grid units (`gu`, `1 gu = 50 du`) and fixes a tank at
    `Z = 2 × 1.01^(lvl-1)` gu **diameter**. We have two rulers and they disagree by 1.4×:
    - by the **tank** (`entities/Player.js`'s `size` is a radius — `rooms/Room.js:474` tests
      `dis <= a.size + b.size` — so a level-0 tank is 56 units across): `1 gu = 28 units`.
    - by the **grid** (`public/client/game.js:471` draws it at a 20-unit pitch): `1 gu = 20 units`.

    So our tank is 2.8 grid squares wide where diep's is 2.0. Which ruler you pick flips the sign
    of the movement verdict (22% too slow by the tank, 10% too fast by the grid), so pick first.
    **Recommend anchoring on the tank (`1 gu = 28 units`) and widening the client grid pitch
    20 → 28**, on two grounds: every diep gameplay number is gu-denominated and it is the tank that
    interacts with them; and at 28 units/gu our existing recoil constants already *are* diep's
    recoil table (item 16), which is evidence that is the factor the numbers were written against.
    Note that the grid pitch is currently drawn at 27.3 px on a 1920-wide screen against diep's
    27.5 px (diep's `0,55` px/du conversion) — i.e. the grid is already diep-sized on screen, and
    it is the tank that is 1.4× too big for it. Shrinking the tank to a 40-unit diameter is the
    other consistent option and costs no FOV change; it just makes every existing world constant
    (recoil, knockback, sizes, map) 1.4× wrong instead.

    **`config.BASE_BULLET_MARGIN` (30) moves with this decision** — it is `1.5 × the 20-unit grid
    pitch`, measured as how far an enemy bullet visibly penetrates a base before dying. If the
    pitch is widened to 28, that constant becomes 42.

14. **Movement: right shape, wrong stiffness, and level/stat scaling is the wrong *form*.**

    | | diep | ours | ratio |
    |---|---|---|---|
    | top speed, base | `10 × A₀` = 12.94 gu/s = 6.47 tank-diameters/s | 284 u/s = 5.07 diam/s | **0.78×** |
    | accel → top-speed ratio | `v_max = 10 × A` | `v_max = 26.8 × len` | **2.7×** |
    | e-fold time to top speed | 0.42 s | 0.90 s | **2.14× floatier** |
    | speed vs level | `÷ 1.015^lvl` (×0.64 at lvl 30) | `− lvl/155` (×0.447 at lvl 30) | multiplicative vs **subtractive** |
    | speed vs stat | `× 1.07^vm` (+61% at 7) | `+ 0.020/pt` on 0.35 (+34% at 6) | additive, half the range |
    | stat cap / level cap | 7 points, 45 levels | 6 points, 30 levels | — |

    The form mismatch is the load-bearing part: because ours subtracts level and adds stat to the
    same accel term, a maxed-Movement level-30 tank ends up at **0.79× a fresh spawn's speed**,
    where diep's independent multipliers put it at **1.03×** — max move speed is supposed to buy
    back exactly what leveling costs. The linear level term also has no floor (it reaches zero
    speed at level 54), which only the 30-level cap is hiding.

    Diep-faithful replacements, if adopted: `len = 0.978`, `FRICTION = 0.9244` at `TICK_MS 33`
    (`len = 0.556`, `FRICTION = 0.9422` at 25 ms; `len = 1.449`, `FRICTION = 0.9091` at diep's own
    40 ms), with `len = base × 1.07^MSpeedPts / 1.015^level`.

    **The 284 u/s above is a level-0, no-upgrade tank walking — not this game's ceiling.** plan.md
    WP4.5.0 needed the real maximum (it is what `BASE_DRONE_CHASE_SPEED` is pinned to), so
    `test/rooms.js`'s `fastestTankSpeed()` measures it by replaying `entities/Player.js`'s own
    `motion()` + `shoot()` recurrence over every reachable class at 6 Movement Speed and 6 Reload,
    firing continuously with the recoil aimed along the direction of travel:

    | build | sustained |
    |---|---|
    | **Fighter, level 29** (rear pair, `back 2.04776` on a 22-tick reload) | **399.2 u/s** |
    | Machine Gun, level 12 | 394.1 |
    | Booster, level 29 | 393.8 |
    | Triangle, level 19 | 389.9 |
    | Twin, level 12 | 372.8 |
    | walking only, level 0, no upgrades | 284.0 |

    So riding your own recoil is worth ~1.4× a plain walk, and **~400 u/s is the ceiling any build
    in this game can hold.** The level penalty (`Physics.moveAccel` subtracts `level /
    MOVE_LEVEL_FALLOFF`) is why each class is fastest at the lowest level it unlocks at, and why no
    higher-level build beats these. The helper is a live test, not a recorded number — a cannon or
    stat retune that moves the ceiling fails `test/rooms.js` rather than silently drifting from
    item 23's base-drone chase speed.

15. **Reload is uniformly 1.4–2.0× too slow, and the reload *stat* may be far off.**
    diep quantizes reload to whole 40 ms loops with `RT = ⌈X₀ / …⌉` — confirmed by the reference's
    own table, where every non-integer technical time rounds up exactly (`7,5 x → 0,32 s`,
    `22,5 → 0,92`, `59,9 → 2,4`). We quantize the same way (`Math.round(can.reload * up.Reload)`),
    so only the constants are wrong:

    | class | diep | ours | ratio | faithful `reload` @33ms |
    |---|---|---|---|---|
    | Basic / Twin | 15 loops = 0.60 s | 32 / 28 ticks = 1.06 / 0.92 s | 1.76× / 1.54× | 18 |
    | Machine Gun (`Rifle`) | 8 = 0.32 s | 14 = 0.46 s | 1.44× | 10 |
    | Sniper | 23 = 0.92 s | 55 = 1.82 s | 1.97× | 28 |
    | Assassin | 30 = 1.20 s | 52 = 1.72 s | 1.43× | 36 |
    | Destroyer | 60 = 2.40 s | 105 = 3.47 s | 1.44× | 73 |
    | Overlord/Overseer | 90 = 3.60 s | 220 = 7.26 s | 2.02× | 109 |

    **The stat needs an in-game measurement before adopting.** The reference writes
    `RT = ⌈X₀/1,875^br⌉`, which taken literally means a Basic with 5 reload points fires *every
    loop* (25 shots/s) — not credible. `1.875 = 1 + 0.125 × 7`, so it is almost certainly a mangled
    rendering of a linear form reaching 1.875× fire rate at max stat. Under that reading diep is
    ×1.875 and ours is ×2.23 (`up.Reload -= 0.092`/pt, 6 pts) — close enough to leave alone. Under
    the literal reading nothing about our reload stat is salvageable. Measure before choosing.

16. **Recoil is already diep's table (mostly); knockback is 5–7× too weak.**
    At 28 units/gu, an impulse `v` decays to `v × F/(1-F) = 26.8 v` units of displacement, so
    `back` ≈ diep's recoil in gu at a 0.957 conversion — i.e. **1:1**. Spot-checking against the
    reference's recoil table: Basic `0.4` vs 0.4 ✅, Twin `0.3` vs 0.3 ✅ (but our Twin's two barrels
    disagree — `0.3` and `0.4`), Machine Gun `0.6` vs 0.4 ❌, Sniper `0.3` vs 1.2 ❌ (4× weak),
    Destroyer `3.8` vs 6.0 ❌. **Audit the whole `back` column against the table — it is a
    copy job, not a retune.** (If #14's `FRICTION` changes, the conversion stops being 1:1:
    `back = gu × 28 × (1-F)/F`, i.e. ×2.55 at `F = 0.9244`.)

    Knockback did not get the same treatment and is an order of magnitude off:

    | | diep, per loop of contact | ours, per tick of overlap | ratio |
    |---|---|---|---|
    | tank body | 1.6 gu | impulse 0.3 → 0.29 gu | **5.6× weak** |
    | basic bullet | 0.667 gu | `weight/3` = 0.1 → 0.096 gu | **7.0× weak** |
    | drones | 0.8 gu | same 0.3 `weight` as everything else | — |

    diep also *inverts* knockback against damage — Destroyer 0.2 gu, Annihilator 0.1 gu, against
    Basic's 0.667 — where our `weight` is a flat 0.3 for Basic and Destroyer alike. The whole
    `weight` column wants replacing from the Knockbackfactor table.

17. **Health, regen and body damage.**
    - **Max health.** Same shape (`MH₀ + 2·lvl + 20·mh` vs `150 + 3/lvl + 110/pt`), very different
      balance of terms: diep is 10 levels per health point, ours is 36.7 — that ratio is
      `MH₀`-independent and is the real mismatch. Ours ends up with leveling worth +60%
      survivability and the stat worth +440%; diep splits it +180%/+280% *if* `MH₀ = 50`, which
      the reference does not state → measurement task.
    - **Bug while in there:** `entities/Player.js:275` adds 110 max HP then scales current HP by
      `maxHp/(maxHp-100)`. The 100 should be 110; as written every Max Health point under-heals.
    - **Regen.** diep is linear in time: `HPS = MH × (0.03 + 0.12·rr)/30` → full heal in 1000 s at
      0 points, 34.5 s at 7. Ours (`hpregan[1]` accumulates, then is added, every tick) is
      *quadratic* — full heal in 46 s at 0 points, 28 s at max. So our base regen is **21× faster
      than diep's** and our regen stat is nearly worthless (1.6× range vs diep's 29×). The
      quadratic ramp is a crude accidental stand-in for diep's out-of-combat regen rule, which the
      reference does not document — decide whether to keep it deliberately or go linear.
      Side effect of `parseInt(hpregan[1] * maxHp * 10)/10`: regen is quantized to 0.1 HP, so
      nothing at all heals for the first ~22 s at 0 points / 150 maxHp. That dead time shrinks as
      maxHp grows, which is backwards.
    - **Body damage.** At zero points in both stats, diep's tank body deals 2.86× a basic bullet's
      per-loop damage (20 vs 7); ours deals 1.75× (7 vs 4). So ramming is relatively 1.6× weaker
      here even before item 18's model differences. The stat *range* matches (diep `BS = 1+0.2·bd`
      → 2.4× at 7; ours `damage 7 → 17.8` = 2.54× at 6). Absolute lethality vs the HP pool can't be
      closed without `MH₀` (above).

18. **The damage *model* differs structurally — this is the big one, and it is not a retune.**
    diep resolves a collision as mutual simultaneous destruction with partial-loop proration
    (the page's "3 laws"): each body has a constant damage-per-loop, each loses health equal to the
    *opponent's* DPL, and a body that dies mid-loop deals a proportionally reduced share
    (`GH_L = GH'' × DPL''/DPL`). Three consequences we do not reproduce:
    - **Body damage reduces damage taken.** `MH_L = 4·D_b/BS`, i.e. `dr = 1 − 4/(10·BS)` — a tank
      takes 40% of a bullet's nominal DPL at `bd 0`, 16.7% at `bd 7`. Ours has no such term:
      `entities/Player.js:379` is `hp -= other.damage * max(1, other.pene/5)` flat.
    - **A bullet's health is spent against the target's damage output.** In diep a bullet
      (`BP = 20·Pf·PP` HP) loses HP equal to the target's DPL, so a high-body-damage tank eats
      bullets faster. Ours spends penetration against *itself*: `pene -= max(1, pene/5)`
      (`entities/Bullet.js:65`), target-independent.
    - **Penetration → damage is a coincidence, not a design.** diep's health loss per bullet does
      scale with penetration (`D_b ∝ PP`, because a tougher bullet survives more loops of contact),
      so our `× max(1, pene/5)` is accidentally the right *shape* — but the magnitude is off
      (diep ×6.25 at max bp; ours ×2.89 at max) and ours has a dead zone below `pene 5` where the
      stat does nothing at all. Stat slope is 0.75/pt (diep) vs 1.25/pt (ours).

    Adopting the real model would touch every `collision()` in `entities/`. It is the difference
    between "ramming is a build" and "ramming is chip damage", so it is a design call, not a bug
    fix — but nothing else in this section will make combat feel like diep on its own.

19. **FOV, arena and shape density — the world is 2.5× emptier per screen than diep's.**
    - **FOV.** diep: `1920/0,55 = 3491 du = 69.8 gu` wide at level 1, growing `×1.005/level`
      (i.e. `√1.01`, exactly half the tank's growth rate, which is why diep tanks visibly get
      bigger). Ours: `screen = 1408` = 50.3 gu, growing `+22/level` = +1.56%/level. So we are
      **1.39× too narrow at level 1** and only 1.09× too narrow by level 30 — the base is wrong
      *and* the per-level term is 3× too fast, in opposite directions. Faithful: base ×1.39,
      per-level `× Math.pow(1.005, level)` (≈ +7 units/level at level 1, not 22). **Done** —
      massplanchunks.md WP4 shipped with these numbers (`config.FOV_MUL: 1.39`,
      `config.FOV_PER_LEVEL: 1.005`, multiplicative) rather than its own first-drafted guess
      (`1.3`, flat `+26`/level).
      Note also that diep's FOV is *resolution-dependent* (fixed 0.55 px/du, so an ultrawide
      genuinely sees more) where ours scales to fit. Ours is the fairer design; flagging it only
      so the difference is deliberate.
    - **Arena.** diep sizes it per room: `AL = ⌊√N_P × 50⌋` gu (244 gu at our `maxPlayer: 24`).
      Ours is fixed and never changes with occupancy. **Re-stated after plan.md WP1's rescale**: the
      world's unit dimensions moved with the grid pitch (D1: `×1.4` on every grid-denominated
      distance), so each mode kept the *square count* it already had and the gap in squares is
      unchanged in kind but restated — ffa/4team/2team land at **451/450/400 gu**, i.e.
      **1.85× diep's 244 gu**, up from the 1.32× this item used to record against the old 20-unit
      pitch (9020 units read as 322 gu only because the client was drawing a 20-unit square over a
      world the tank measured at 28). Resizing toward diep is still open and still this item's;
      WP1 deliberately did not touch it.
    - **Shapes.** diep's count is `12,5 × N_P`, which with the arena rule is a *constant*
      1 shape per 200 gu² at any player count. Ours was 1 per 261 gu² — 0.76× the density; combined
      with the narrow FOV, a diep screen held ~13.7 shapes and ours ~5.4. **Held constant across
      WP1's rescale, not improved**: the map grew 1.96× in area while FOV (Category B, tank-
      denominated) deliberately did not move, so every `objCaps` figure went `×1.96` in the same
      pass purely to stop the per-screen count halving. The ratio to diep is therefore where it
      was. If the "world feels empty" complaint in massplanchunks.md is being chased, **this is
      still the number, not the drift rate** — and the lever is the arena bullet above, since our
      squares-per-screen is now the thing that is 1.85× off.

20. **Done.** diep's loop is 40 ms (25 Hz), not 33 and not 25 — the reload table proves it: every
    technical reload time is a multiple of 0.04 s and every fractional one appears rounded *up* to
    a whole 0.04 s in the "Reload Time (0 br)" column. massplanchunks.md WP3 shipped with
    `REF_TICK_MS: 40` on that basis (not the `33` first drafted there), so diep's per-loop
    constants (recoil gu, knockback gu, reload loops, `A₀` du/loop²) drop in unconverted for
    item 11, without a 33/40 fudge factor. See `lib/tick.js` and `public/SHARE/Physics.js` for how
    each constant category converts between the two references.

21. **Auto-turret spin is 2.2× too slow.** diep's `ω = 1 rad/s` exactly (`t_r = 2π s`). Ours is
    still ~0.455 rad/s in real-world terms (`entities/Player.js`'s `autoDir`; base drones
    similarly in `entities/Bullet.js`) — unchanged by WP3 on purpose. Faithful value is real-world
    `1 rad/s`, expressed as a per-reference-tick constant through `lib/tick.js`.

22. **Things that already match — do not "fix" them.** Tank growth (diep `2×1.01^(lvl-1)` gu = ×1.35
    over 30 levels; ours `28 + ⌊lvl/2.8⌋` = ×1.357 — linear vs exponential but the endpoints agree
    to 0.5%). Necromancer base drone count (diep `22 + 2·br`; ours `maxDrone = 22` — only the
    growth differs, ours is +1/reload point against diep's +2). Reload quantization to whole ticks.
    Per-tick-of-contact damage application (diep's "law 3").

23. **Not covered by `physics.html` at all — still needs measuring in a real client.** Bullet base
    speeds and lifetimes (the page defines `V_b = ρ/t_b` but lists no values), bullet spread
    (`rand`), shape HP/XP/drift, `MH₀`, camera lag (`CONST.CAM_SMOOTH` is still a placeholder —
    see item 6), and `CONST.HP_BAR_HOLD`, a pure feel knob that was never measured against
    anything. Shape drift is still on this list unchanged.
    **Base drones are off it** — count, size, speed, respawn, damage and orbit behaviour all ship
    measured in massplanchunks WP-E (`config.BASE_DRONE_*`), corrected in plan.md WP4.5 (motion is
    now a rate-limited steered field rather than a position-authoritative polar path; orbit speed
    is 1.5× the pre-drone baseline, not 2×; a same-team pair is explicitly skipped in the collision
    loop rather than relying on scattered `noDam` checks). The 4team/2team orbit centre is also no
    longer a measured literal — it is derived from `baseSize` (`FourTeam.baseCenter()`,
    `TwoTeam.basePosts()`), since the old `gu(24)` inset was measured back when `baseSize` was
    `gu(45)` (whose centre is `gu(22.5)`) and had gone stale across the later `gu(67)`/`gu(40)`
    resize, leaving the drones low and outboard in the square instead of centred in it.
    **WP4.5's energy-level pass measured/derived the rest of the geometry too**: radius is
    quantised into five shared levels one `BASE_DRONE_LEVEL_GAP` (a drone-side) apart rather than a
    continuous random band; the drone-vs-drone separation threshold (`BASE_DRONE_SEPARATION`) is
    derived from the drawn triangle's own vertex geometry (`2×1.7×BASE_DRONE_SIZE − 5`).
    **WP4.5's follow-on motion-half pass** (plan.md WP4.5.0-4.5.2, superseding what was at the time
    numbered WP4.5.1-4.5.4) replaced the rest with measured
    numbers too: chase/return are a real dash now, with their own tighter turn limit
    (`BASE_DRONE_CHASE_TURN`) so the drone can actually turn inside a target at that speed. A
    gradual level switch flies its own planned quintic arc, now a `BASE_DRONE_SWITCH_LEAN`
    (10°, replacing `BASE_DRONE_SWITCH_ARC`'s fraction-of-circumference) off the tangent so the
    sweep takes the same time at every ring, whichever of the sorter or the post-swoosh `homing`
    climb triggers it; a reactive one (shape hit, drone-proximity) is untouched, still the sharp
    `BASE_DRONE_LEAN_SCALE` lean. "In an enemy base"
    is now also bounded to the drawn arena (`Room.inArena()`), so the ~5-square dark OOB band around
    a base is neutral ground a base drone may follow a target into, exactly as far as a player may
    run (`config.OOB_MARGIN`, shared with `entities/Player.js`'s own allowance).
    **That pass then rebuilt the dash, the swoosh and the reaction (now plan.md WP4.5.0/4.5.1/4.5.2):**
    - `BASE_DRONE_CHASE_SPEED` is **400 u/s** — item 14's own `fastestTankSpeed()` measurement of
      the fastest build this game can hold (399.2, Fighter L29), not a level-0 tank's 284. The user's
      spec is *exactly* that ceiling, not past it: nothing outruns a base drone on straight-line
      speed, and lapping a base in the fastest tank is still winnable on the head start and the
      `BASE_DRONE_LEASH` boundary rather than on top speed. Items 14 and this one are mutually
      load-bearing — a retune of either has to check the other, and `test/rooms.js` fails if they
      drift apart.
    - The diameter cross is **arc → C² blend → a straight line through the orbit centre → C² blend →
      level 1**, precomputed once per swoosh into a per-tick table (`planCross()`). Its speed
      profile is a **plateau now** (plan.md WP4.5.1, superseding the ramp-to-the-centre profile
      described just below): ramp up to peak over the first `BASE_DRONE_CROSS_RAMP` (25%) of the
      path, hold peak across the middle, ramp back down over the last 25% — not a single point
      touched at the orbit centre. ~~One continuous ramp — accelerate the whole way in to the
      centre, decelerate the whole way back out — with peak acceleration down to ~0.47
      ref-units/tick² from the original three-piece profile's ~1.9~~ is the superseded description;
      the plateau's two knees sit deep inside the still-tight entry/exit blends, so peak turn rises
      to **8.46 rad/s** and peak acceleration to **1.95** (both still comfortably inside
      `test/rooms.js`'s pinned 10 rad/s / 2.5 bounds) — a real trade against the previous pass's
      smoother-but-single-point peak, made because the plateau is what the user actually asked for
      and because it also makes the dive **~25% quicker: 2.00–2.65 s, down from 2.67–3.58 s**.
      `BASE_DRONE_CROSS_BLEND_FRAC` 0.20 → 0.70 (now a fraction of each end's own radius, not the
      chord — which is what let it move at all) and `BASE_DRONE_CROSS_LEAD` 0.05 → 0.125 are
      unchanged by the plateau pass; they are what stretched the two blends to ~2× their old length
      (~80% of the path) in the first place. **`BASE_DRONE_CROSS_SEAM_SPEED` and
      `BASE_DRONE_CROSS_BLEND_ARC` are deleted** — a blend's shape parameter is solved by fixed
      point at plan time, so there is no measured-and-pasted-back constant left in the cross at all.
    - **A per-centre binomial sorter is the ongoing restoring force now, not a drift-home timer.**
      Once a second, each orbit centre compares its live occupancy against `levelPlan().target` and
      walks a random number of surplus drones one level toward the nearest deficit level, via the
      same gradual arc; a post-swoosh drone instead runs a scripted `homing` climb (1 → 2 → 3,
      cap-free) and is excluded from the sorter until it arrives. The general drift-home timer that
      used to pull every off-level drone back to 3 is deleted — left in beside the sorter, the two
      would fight over the same drone.
    - **Cross concurrency (`crossCap`) is sized from measured demand, not fixed at 1.** A 4team
      centre's twelve drones each wanting a cross every ~10 s outran a single lane once the swoosh
      got longer; `crossCap` is now derived per centre from `Bullet.estimateCrossTicks()` — **3** for
      a 4team base's twelve drones (was 4 under the superseded ramp-to-the-centre profile — the
      plateau's shorter mean cross duration is what moves it down on its own, not a manual retune),
      1 (unchanged) for a 2team pair.
    - **A reactive level switch can no longer fail.** A saturated ring only vetoes a *voluntary*
      move; a reaction (shape hit, drone-proximity) always moves the drone, and one that arrives
      while it is busy is latched in `reactPending` and paid the moment it is free. Measured before
      the fix: 24 of 48 base drones in a live 4team room had no open neighbour at all and ignored
      every shape they hit. Exactly one side of an overlapping pair is flagged now, not both.
    - **Three chase bugs, all reproduced headlessly and fixed (plan.md WP4.5.2).** (A)
      `clampToMap()` used to zero the clamped axis of `vec`, but case 1.4's own tail derives `vec`
      FROM `head`/`spd` every tick, so the zero was overwritten before it was ever read — a drone at
      the map edge just got teleported back onto the boundary once a tick, forever, while `spd` sat
      at full chase speed (measured: 15 consecutive identical-position ticks parked, or a chasing
      drone pinned dead at the exact corner indefinitely if its target was beyond the edge). ~~Fixed by
      rewriting `head`/`spd` from the clamped velocity outside a cross/switch arc, and by dropping a
      chase whose target sits beyond the drone's own clamp box.~~ **Both halves of that fix are
      superseded by plan.md WP4.5.12/4.5.15** — see the WP4.5.11–17 list below. (B) The shared `levels.threat` was
      written and never cleared, so acquisition silently became "has ever been seen" instead of "is
      currently visible", and a target that died while being chased (`respawn()` swaps in a brand-new
      `Player`, so the old one's `destroy` stays 1 forever) permanently latched the whole centre out
      of ever chasing again — measured, 15 s of a live enemy sitting inside both `DETECT` and `LEASH`
      with nothing reacting. Fixed with a `threatAt` timestamp, expired after two scout rotations
      with no re-sighting or the instant the threat is confirmed dead. (C) `Detector.reset()` left
      `select` pointing at the last thing it ever found, so every "forget this target and re-scan"
      call site across the tree (nine of them) was silently only half working. Fixed at the source;
      audited all nine callers, one behaviour change worth knowing about — bots/bosses (`lib/gameAI.js`)
      now genuinely forget a target they can no longer see instead of holding a stale reference.
    - **Where the compute actually goes, measured correctly this time (plan.md WP4.5.4) — the
      previous number here was wrong, not just outdated.** The prior measurement settled a 4team
      room for only 600 steps before profiling; a 4team room actually needs ~6500 steps to reach its
      eventual polygon count, so that profile ran on a room with ~100 of its eventual 715 polygons —
      base drones read as a third of all entities in the world instead of a fifteenth, and every
      number downstream of that (the 46%/93% split, the 1419/762 µs, the −36%/−48%) was measuring a
      room that never exists in play. Re-measured on a properly settled room (7000 steps, interleaved
      A/B, median of 12 blocks): **base drones are 6.2% of a tick (290 µs of 4685 µs in 4team)**, of
      which all 48 drones' own `Bullet.update()` is **1.6%** and the per-centre sorter/scout
      maintenance is **0.14%**. A CPU profile attributes **~40% of a tick to the broad phase**
      (quadtree query + the collision pair-loop body) and just **0.8%** to the whole base-drone AI —
      steering, orbit field, sorter, swoosh planning, level switching, all of it. **The real win is in
      `lib/quadTree.js`/`rooms/Room.js`, not `entities/Bullet.js`:** a new allocation-free
      `queryCircle()` (squared-distance filtering, no closures, no per-node/per-point object
      allocation) plus an `insert()` that picks a single quadrant instead of recursing into all four
      (fixing a duplicate-candidate bug at internal boundaries as a side effect) took a settled 4team
      tick from 3510 µs to **1504 µs (−57%)** and 2team from 4239 µs to **2166 µs (−49%)**, verified
      against a brute-force point scan before anything else changed. `SlotMap`'s sorted-key-array
      caching and two pair-loop micro-fixes (indexed `for`, `Math.sqrt` over `Math.pow`) contribute
      the last few percent on top. **The detection scout (one enabled `Detector` per orbit centre,
      rotated round-robin) is kept — it is still a reasonable design — but it is not worth what the
      old number sold it as, and a future perf pass should start in the broad phase, not in
      `entities/Bullet.js`, which a profiler cannot see at 0.8% of a tick.**
    - **Contact damage, the chase/return recovery and the `basedrones.txt` alignment (plan.md
      WP4.5.11–4.5.17), all reproduced headlessly before the fix.**
      - **Contact damage is measured and correct now.** `entities/Player.js` read a base drone's
        `pene` — its 2000-point *health pool* — as an ordinary bullet's penetration value, so the
        `pene/5` multiplier was **400** and a single drone dealt 742.5 HP in one 25 ms tick: any
        tank died the instant it was touched, at any HP. It reads `BASE_DRONE_PENE` now, the same
        substitution `entities/Objects.js` already made for shapes. The resulting feel is the wiki's
        "low damage, delivered extremely quickly": **74 HP/s** from one drone (~13.6 s to kill a
        ~1010 HP maxed tank) and **~891 HP/s** from a full 4team base (**~1.1 s**).
        `BASE_DRONE_DAMAGE` was deliberately *not* retuned — see the open bullet below, which is
        now about playtesting a correct number rather than an inflated one.
      - **`clampToMap()` slides instead of stopping.** The WP4.5.2 version rebuilt `spd` from the
        *clamped* velocity, which works against one wall but sets `spd` to exactly 0 at a **corner**
        while leaving `head` pointed into it — measured **14 consecutive byte-identical position
        ticks**, the user's "stuck on the edge of the arena". It projects the heading onto the
        pressing wall now and never writes `spd`; pressed into a corner it takes `orbitDesired()`'s
        answer and heads home.
      - **The "target is past my own clamp box" chase drop is deleted.** It could never fire —
        `DETEC.type` is `[KIND.PLAYER]` and `entities/Player.js`'s `motion()` clamps a Player to
        *exactly* that same box, so the strict `>` never held at equality. Widening it to `>=` would
        make a player standing on the OOB wall permanently un-chaseable, the opposite of the wiki's
        "impossible to linger around a base"; a drone works the wall beside them instead.
      - **The return's turn limiter blends with its speed.** Both now ride the same smoothstep `k`,
        so `v/ω` holds at 34–60 units in every state. They used not to: a returning drone ran the
        400 u/s dash under the orbit limiter's 2.5 rad/s — a 160-unit turn radius against a
        224-unit home ring — which is what made a long return swing wide and overshoot.
      - **A diameter cross is gated on ring proximity.** `planCross()` builds its entry seam from
        the centripetal acceleration of the circle the drone is *currently* flying, which is
        meaningless for one sprinting radially home; measured, crosses launching from `r = 1300`
        against a `168…280` level table. `crossIn` still counts down off-ring, so a cross is
        deferred, never lost.
      - **The return starts on the tick the pursuit ends.** The chase-drop block snaps `head` onto
        the orbit field's own direction (`orbitDesired()`, one expression shared with the steering
        tail and the clamp's corner fallback) instead of slewing to it. Without it a drone flew up
        to a 180° turn's worth *further out* first — measured, `r` climbing 1384 → 1439 over the
        first 20 ticks after a drop, and against the map clamp it did that turn pressed on the
        boundary. This is the user's absolute requirement (no lingering anywhere after a chase
        drops, not for one tick) and `test/rooms.js` holds a whole baited 4team base to it.
      - **Polygon bosses are ignored until provoked** (`basedrones.txt`): the Summoner is a polygon
        boss and the whole base used to rush it on sight. Provocation (a boss body hit or a boss
        bullet hit on any of that centre's drones) is recorded on the shared per-centre ledger and
        expires after `BASE_DRONE_PROVOKE_MEMORY` (10 s).
      - **The chase is and stays pure pursuit** — aim at where the target *is*, every tick. A lead-
        pursuit draft was withdrawn by the user's explicit instruction; do not re-propose it off
        `basedrones.txt`.

    Two things about the drones stay open:
    - **The HP scale.** `BASE_DRONE_HP: 2000` is the wiki's number on *diep's* HP scale, and ours
      is not diep's — our base tank is 150 HP against diep's unmeasured `MH₀`, and a maxed level-30
      tank here is 900. If `MH₀` is 50, diep's base drone is ~7.1× a maxed tank, which on our scale
      would be ~6400, not 2000. 2000 ships because it lands on "very durable but killable", which is
      the design intent; the 6400 alternative is blocked on the same `MH₀` measurement item 17 wants.
    - **`BASE_DRONE_DAMAGE: 2.97`** is derived (`8.48485 × 7/20`, our tank body damage scaled by the
      wiki's 7-per-loop against diep's 20-per-loop tank body), not observed. It is a ~30× buff over
      the old `0.1` — at 40 Hz that is ~74 HP/s from a single drone, so a swarm of twelve kills a
      900 HP tank in about a second. Playtest it before treating it as settled. (Those are the
      numbers a player actually experiences now: until plan.md WP4.5.11 the multiplier bug above
      meant nobody had ever felt this constant at all, only the 400× version of it.)
    - `CONST.MAX_UP_POINTS` joins the list of constants hand-mirrored between client and server,
      next to the input-prediction note in item 24.

24. **Close-quarters bullet truth — the dimensional bug is fixed; the rest of the error budget is
    still open.** `public/client/game.js`'s input prediction used to scale a per-tick acceleration
    by only **one** power of `tickLen`, where the conversion to per-frame needs `tickLen²` — the
    local tank was drawn up to a full tank diameter ahead of the server, growing with refresh
    rate (up to 70 units at 144fps), and every freshly-fired bullet inherited that as its spawn
    lead. Fixed: the integrator moved into `public/SHARE/Physics.js` and `predic` stays in
    units-per-*tick*, scaled once at integration (`Physics.stepBody`). The remaining, unfixed
    sources of client/server bullet-position disagreement rank cheapest-first:
    - **(a) Derive the lead instead of tuning it.** The correct prediction lead is
      `(interp delay + RTT/2) × velocity` ≈ 16 units at base top speed on a 50 ms RTT, smaller
      than what the fixed integrator settles on now. We do not measure RTT — the `ping` message
      is a server→client heartbeat the client echoes (`net/gameSocket.js:44`,
      `public/client/game.js:761`). Making it measurable is cheap and needs no schema change:
      `ping` already carries a value byte, so a client-initiated probe can send `1`, the server
      echoes it back as `1`, and the client times it; `0` stays the heartbeat. Then
      `CONST.SIZE*2` and `CONST.SMOOTH`'s decay stop being the things that decide how big the lie
      is.
    - **(b) Dead-reckon bullets instead of interpolating them.** A non-drone bullet's motion is
      fully deterministic between collisions (`vec += speed·dir; vec *= FRICTION`, no input), so
      the client can integrate it forward from the newest snapshot rather than drawing it one
      packet interval in the past. This is the only item that fixes *incoming* bullets too — an
      enemy Destroyer shot is currently drawn ~12 units behind the server's version, i.e. it hits
      you before it visually arrives, which is the same complaint from the receiving end. Drones
      (`type >= 1`) steer and must stay on interpolation.
    - **(c) The floor.** Even with both, the shooter and the target disagree by RTT/2 and every
      *other* entity is still drawn one interval late. Zero error is unreachable client-side; only
      server-side lag compensation (rewinding hit checks by the shooter's latency) removes it, and
      diep does not do that either. Worth writing down so this doesn't get "fixed" a third time —
      the goal is bounded, symmetric error, not zero.
    - **Destroyer-specific amplifier, unfixable by tuning:** `predic` is driven by *input keys
      only*, so a Destroyer's own recoil (`back: 3.8` → ~100 units of displacement) is entirely
      server-side. At the instant of firing the prediction is therefore wrong in the *opposite*
      direction of the kick until the next snapshot lands, and the bullet's spawn `lead` bakes that
      error in. Only real input-replay reconciliation (predicting recoil locally too) removes it.

---

*See HANDOFF.md's "Read this before you touch anything" (tick rate), "Test coverage" (untested
areas), and "The client" (`Instances` sparse-array note) sections for the reasoning behind any
item above.*
