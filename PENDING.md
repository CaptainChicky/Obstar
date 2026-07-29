# Pending & Decisions

Short-form companion to [HANDOFF.md](HANDOFF.md). Only what's *left*: things needing a human call,
decisions already made but not yet built, and things nobody has verified yet. Anything that has
actually shipped is deleted from this file rather than recorded here.

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
   now reference by constant rather than hardcoding — nothing to keep in sync by hand.

30. **Adopt diep's upgrade economy: 45 levels, 7 points per stat, 33 total.** Decided — this is
    the thing that makes every other diep number adoptable, because **every diep formula is
    denominated in diep's caps, not ours**. `1.07^pts` assumes 7 points; `1.015^level` assumes 45
    levels; `+20 HP/pt` assumes 7. Adopting a formula without its domain is what left #14's form
    fix at 0.96× where diep's own figure is quoted at 1.03×.

    | | diep | ours today |
    |---|---|---|
    | level cap | 45 | 30 (`rooms/Room.js`'s `XPLVL`) |
    | points per stat | 7 (Smasher branch 10, over 4 stats; Auto Smasher 10 over 8) | 6 |
    | total budget | 33 | 28 (`CONST.MAX_UP_POINTS`) |
    | grant schedule | 1/level to 28, then at 30 and every 3 levels to 45 | 1/level, minus a takeback at 18 and 27 |
    | tier gates | every 15 levels | every 10 |

    Ours is a coherent ⅔-scale version rather than a bug — both give 3 tier-ups and both land on
    "4 stats maxed plus change" (diep 4 + 5 spare, ours 4 + 4). That is why this is a *deliberate*
    conversion and not a fix.

    **Every site that has to move** (grepped, not guessed):
    - `rooms/Room.js:99,125` — `maxXp: 25000` is described as "the level-30 cap", and the curve
      hardcodes **30 twice**: `new Array(30)` and the `a = 30 / …` coefficient. Both → 45.
    - `entities/Player.js:300` — `upNb[data] >= 6`, the per-stat cap.
    - `entities/Player.js:539` — `level === 18 || level === 27`, the two takeback levels. **This one
      is a rewrite, not a retune**: diep does not take points back, it changes the *grant rate*
      (every level to 28, then every 3rd). Replace the schedule, don't renumber the takebacks.
    - `entities/Player.js:334` — tier gate `parseInt((1 + level) / 10)` → `/ 15`.
    - `entities/Player.js:576` — Rocket's unlock reads `upNb[0] === 6 && upNb[1] === 6`.
    - `entities/Player.js:310-320` — **the stat step values are all sized for a 6-point span** and
      will overshoot by ~17% each at 7 points unless re-derived. The exception is `MSpeed`, which
      is multiplicative since #14 (`1.07^pts`) and therefore becomes *automatically* diep-correct
      the moment the cap is 7 — a useful sign the multiplicative form was the right call.
    - `public/client/config.js:44` — `MAX_UP_POINTS: 28` → 33. Hand-mirrored from the server, so it
      is one of the two constants #23 flags as desynchronisable.
    - `public/client/ui.js:269,282,292` — `perStat = 6 - …`, `>= 6`, and `drawAll(…, max = 6)`.
      That last one is **layout, not logic**: the upgrade bar draws 6 segments and a 7th changes
      the widget's geometry.
    - `test/rooms.js:622` — `MAXUP = 6`, which feeds `fastestTankSpeed()` and therefore forces a
      `BASE_DRONE_CHASE_SPEED` re-pin (#14) as a matter of course.

    **No wire change needed** — `upNb` is `uint8` per stat, so 7 (or a Smasher's 10) already fits.

    **Consequence worth knowing before starting, because it is counter-intuitive:** at diep's own
    caps a maxed-Movement **level-45** tank runs at `1.07^7 / 1.015^45` = **0.82× a fresh spawn**.
    The 1.03× figure quoted in #14 is a *level-30* comparison, not diep's endgame. So this
    conversion makes high-level tanks **slower relative to a spawn** than our current 0.96×, not
    faster. That is faithful, but it is a real feel change and it moves the speed ceiling
    `BASE_DRONE_CHASE_SPEED` is pinned to.

    **Do this before #17's health adoption and #15's reload-stat decision.** Both are described in
    those items as "arithmetic now" — true, but only once the domain is 7 points. Doing them at 6
    means doing them twice.

## 🟠 Wiki cross-check: GAME MODES — pick what goes in, strike what doesn't

*Source: `diep_wiki/` (`Game Modes.txt`, `Maze.txt`, `Domination.txt`, `Dominator.txt`,
`Polygons.txt`, `Stats.txt`). Official game only — every fanon page in that folder is ignored.
This is a menu, not a plan: nothing here is decided. Tick or strike each line, then the survivors
become real items. We currently ship **ffa / 2team / 4team / boss / sandbox**.*

**diep's nine modes, against ours:**

| diep mode | we have | notes |
|---|---|---|
| FFA | ✅ | — |
| 2 Teams | ✅ | — |
| 4 Teams | ✅ | — |
| Sandbox | ✅ | ours lacks diep's cheat keys, below |
| Maze | ❌ | item 2's static-geometry work |
| Domination | ❌ | item 2's capturable-structure work |
| Tag | ❌ | no new entity types needed — cheapest new mode by far |
| Breakout | ❌ | tile/turf war, needs a claimable grid |
| Capture the Flag | ❌ | needs a carryable entity + 3 bases/team |
| *(removed)* Mothership, Survival, Team DM | ❌ | historical; listed only so they aren't "missed" |

**26. Maze — what the mode actually needs** (feeds item 2's `kinds.js` static-geometry work):
- Randomly generated grey walls, **solid to tanks, bullets, traps and drones alike**. Visible on
  the minimap.
- **Walls have friction** (grinding along one slows you) **and bounciness** (a fast tank rebounds),
  but deal **no body damage**. The wiki explicitly likens them to 2team/4team base edges: "they
  give knockback, except without Body Damage" — so our existing base-edge code is the closest
  thing we already have to model them on.
- **Drones die instantly on contact with a wall.** Crashers (and Arena Closers) are the only
  things that pass through.
- **Bosses do not spawn in Maze at all** — a deliberate exclusion, because a boss can spawn inside
  a wall and become unkillable. Cheap to honour, expensive to forget.
- Known diep bug worth *not* reproducing: barrels are not part of the hitbox, so they poke through
  walls and can shoot through double corners at exactly 45°.
- Match length: the arena closes 5 hours in.

**27. Domination — what the mode actually needs** (feeds item 2's capturable structures):
- **4 Dominators**, stationary, on a 2-team map. Neutral (yellow) until captured; capture = drop
  HP to 0 and land the last blow. An **enemy** Dominator takes **two** knockdowns — first back to
  neutral, then to yours. Capturing refills its health, despawns its projectiles, recolours it.
- **Stats are fully specified:** base health **5998**, **+2/level**, level 75 → **6148 HP**, weak
  regen, no upgrades, **no recoil**, cannot move.
- **Three variants**, each with its own barrels and its own numbers:
  - *Destroyer Dominator* — 1 cannon; penetration **200 HP (×100 tank)**, damage **70/hit
    (×10 tank)**, Hybrid-sized bullet, reload ≈ Hybrid at 3 points, bullet speed below Destroyer's.
  - *Gunner Dominator* — 3 cannons; penetration **10 HP (×5 tank)**, damage **7 (×1 tank)**, high
    reload, normal bullet speed.
  - *Trapper Dominator* — 8 launchers, evenly spaced; trap health **30 (×15 tank)**, trap damage
    **25.2 (×3.6 tank)**, trap speed above a maxed Tri-Trapper, reload = Trapper at 0 points,
    auto-fire always on.
- **AI:** targets nearest enemy, holds that target until it leaves FoV, re-targets on capture or
  after the current target stops damaging it, and **leads its shots** (predicts movement).
  Prioritises players, falls back to polygons/bosses/closers. Neutral Dominators cannot damage
  shapes or bosses. FoV is roughly Sniper-to-Hunter range depending on variant.
- **Player control:** press `H` to pilot an uncontrolled friendly Dominator, one player at a time,
  at the cost of your own tank. This is a whole input/ownership path, not a cosmetic feature —
  worth deciding separately from the rest of the mode.
- XP gain is **doubled** in this mode.

**28. Tag — the cheapest mode on this list, and we can already build all of it.** 4 teams, no
bases, random spawns. Killing a player **converts them to your team** on respawn; dying to a
polygon keeps your colour; suiciding into a colour is a legitimate way to switch. Win by owning
every player. The leaderboard shows **player counts per team**, not scores. The arena **shrinks
every ~12–13 s**. XP ×3. Needs: per-kill team reassignment, a shrinking arena bound, and a
leaderboard variant — no new entity types at all. If any new mode ships first, this is the one.

**Deliberately not itemised here:** Breakout (claimable tile grid, tiles block outside fire, and a
camping-reset rule that instakills squatters) and Capture the Flag (3 bases/team, carryable flags,
a mid-map barrier that drops after a few minutes, first to 10). Both are real modes and both are
bigger than Maze and Domination combined. Listed so the roster is complete, not because they are
next.

**Sandbox gaps** (ours exists but is thinner than diep's): `K` level up (hold to repeat, cap 45),
`\` cycle classes, `O` self-destruct, `;` god mode, party-link invites, arena size and shape count
scaling with player count, and bosses still spawning after 50–60 minutes.

## 🟢 Untested — real risk, nobody has watched these happen

3. A full match, start to finish: leveling into the class tree, death screen, respawn.
4. Two real humans in the same room (only single-player/single-tab has been tested).
5. Boss AI behavior — `test/rooms.js` drives a Summoner through two real `step()`s and asserts it
   adds a nearby player to `this.detected`, but it has never been watched in a live match with a
   human moving around it.
6. The client in an actual browser (only a stub-DOM harness has run it — no real frame timing,
   no tab throttling). The in-browser checklist:
   - Account chip shows `Guest`; signing up carries coins over; the achievements edge-hover zone
     darkens/scrolls the way it's supposed to and a manual scroll actually pauses the auto-scroll.
   - `Ctrl+Shift+L` accepts `color`/`uiscale`/etc. and refuses an admin command for a non-admin.
   - Bullets visibly leave from the barrel tip, including while strafing hard perpendicular to
     the aim direction. `test/client.js` asserts the alignment directly, so this is a "confirm it
     *feels* right" check rather than a "confirm it works" one.
   - The camera has a *slight* trailing lag (`CONST.CAM_SMOOTH`) — confirm it reads as a hair of
     chase, not drift. The value was playtest-tuned on top of a since-fixed input-prediction bug,
     so it needs a genuine human retune with the game open, not a "does it still look ok" check.
   - A green "shiny" polygon and a rainbow "Mythic" one are both visibly distinct from an
     ordinary shape (`public/SHARE/ObjectsConfig.js` — confirm the tuned chances still turn them
     up often enough to notice in a normal session).
   - The minimap shows other players' dots, not just your own, moving smoothly (`Room.getUi`'s
     `map`, `Ui.map()` in `public/client/ui.js`).
   - The minimap has a thin dark frame in every mode (`public/client/ui.js`'s `MAP.lw`).
   - Level 1 vs. level 30 with Movement Speed maxed: confirm the tank does not rubber-band
     differently at the two speeds. **#14's form change is most visible exactly here** — a maxed
     level-30 tank now keeps 0.96× a fresh spawn's speed where it used to keep 0.79×, so leveling
     should no longer feel like it quietly takes your mobility away.
   - **Regen actually starts immediately** (#17). At 0 Health Regen points, take a few HP off a
     fresh 150 HP tank and watch the bar: it should begin creeping back straight away, where it
     used to sit dead flat for ~22 s before the first tick of healing landed.
   - **The prediction lead is derived from a real RTT now** (#24a). It scales with your actual
     latency and speed rather than sitting at a flat 70-unit cap, so it is smaller than it was —
     confirm your own tank still feels immediate on WASD and does not snap when the server
     position lands. Throttling the connection should visibly widen the lead, not break it.
   - **Tank growth is diep's exponential now** (`28 * 1.01^level`, a radius, continuous rather
     than stepping every 2.8 levels). Confirm a tank visibly grows smoothly as it levels and that
     nothing keyed to `size` (barrel scaling, drawn hitbox, minimap dot) looks off at level 30.
   - **The `c` auto-spin** starts from wherever the barrel is pointing when you press it and
     spins from there; releasing leaves the tank facing where the spin left it, and the next
     mouse move takes over cleanly. Two changes to re-check here specifically: the rate is diep's
     `1 rad/s` now (was ~0.455 — a 2.2× speed-up, so confirm it reads as a spin and not a blur),
     and a **toggle-off-then-on used to flick the barrel to where the previous spin ended for one
     frame before snapping back** — a race between the keydown packet and the room tick, fixed in
     `rooms/Room.js`'s `getBuffer()` and covered by `test/rooms.js`, but it was a wire-timing bug
     and the browser is where it was visible, so press `c` on and off repeatedly and watch for it.
   - **Base drones and bases.** Nothing here is covered by a browser-free test beyond placement
     and arithmetic:
     - 4team: each corner base is a coloured **square**, in-world and on the minimap; 2team's
       strips match `baseSize`.
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
     - Walk into an enemy base: the drones run you down fast (`BASE_DRONE_CHASE_SPEED`, pinned to
       the fastest *sustained* speed any build in this game can hold — see #14, not a level-0
       tank's walking speed), and a drone knocked off its ring visibly sprints back and settles
       rather than ringing around the target radius. A drone drifting home (including a post-swoosh
       climb back to level 3) leans onto the next ring over a long, gentle arc, visibly different
       from a shape-hit/proximity peel's sharp ~60° jerk.
     - **Drive around the outside of an enemy base through the dark grey border** — you should not
       die out there, and should be able to get the whole way round, including a 4team corner. You
       do get chased into it, so whether you survive the lap is a race between your own top speed
       and `BASE_DRONE_CHASE_SPEED` — that race being close is the point.
     - Drones do not stick to the arena edge. Drive a fast tank into an enemy base's outboard
       corner and look behind you: a chasing/returning drone should follow, turn, and keep moving —
       never park itself flat against the boundary. Then leave, die, and come back: the base
       must chase you again.
     - **Walk into an enemy base in a maxed tank and confirm you die in ~1 s to a full base, and in
       about thirteen seconds to a single drone that has caught you alone** — judge it against the
       wiki's "low damage, delivered extremely quickly" and see item 23.
     - **Bait a base out to the arena corner through the dark band, then die or leave: every drone
       turns for home on the tick the chase drops.** Watch one drone — it should be visibly closer
       to its base on the very next frame, and closer again on every frame after that.
     - **Watch a returning drone all the way in**: one clean curve that eases onto its ring, never
       slowing to a crawl and peeling off through the base centre halfway home.
     - **Stand next to the Summoner inside a base's detect range in a team mode**: nothing happens
       until the Summoner hits a drone, and then the whole base engages it.
7. Chat over a real client connection — admin commands are now proven end-to-end over a real
   socket against Postgres (connect/disconnect, permission gating, `broadcast`, `tps` all
   confirmed live), but chat hasn't been exercised the same way.
8. Real browser hitting the new packet-length validation (`chat`/`com` in particular) — a
    mistake here shows up as a kicked player, not a crash.
9. Load: multiple busy rooms at once on one process (everything so far is one room alone).

## 🟣 Needs a human balance call

29. **Summoner's drawn barrel is short of its own spawn point, and fixing it is a visible boss
    silhouette change — left alone on purpose.** `public/SHARE/TanksConfig.js`: client `height: 44`
    vs server `canonLength: 50` (spawn radius `50 * .93 = 46.5`) is a **-2.5** gap; every other
    class in the table draws its barrel a little *past* the spawn radius (band 0-12, median 4.2)
    so bullets appear at the muzzle tip, and Summoner is the one class that runs the other way.
    The server's 50 is a floor, not a free number to shrink: a boss's body radius is 64
    (`rooms/Room.js`), and a drone's own trailing edge already sits only ~1 unit clear of the body
    at that spawn radius (`entities/Player.js`'s spawn math) — shortening `canonLength` spawns
    drones intersecting their own boss. So the only way to close the gap is to grow the *drawn*
    barrel (44 → ~51 gets the table's own median gap), which makes the boss's barrels visibly
    longer (drawn tip 1.26× → 1.46× the body radius) — a silhouette call for a human to make
    in-browser (`boss` mode, or the `summonRandBoss` admin command), not a mechanical sync.
    `test/tanks.js` whitelists all four `Summoner` cannons (`geom`) for exactly this reason so the
    gap doesn't silently regress into something else while it's open.
    **The same check applies to every future boss, not just this one.** `lib/gameAI.js`'s
    `CONFIG.BOSS` list has exactly one entry (Summoner) today, but item 2's Domination/Maze work
    and any other boss added later will have the same tension the moment its body is drawn at a
    non-default `size` (`rooms/Room.js`'s `createBoss()` hardcodes `64` for all bosses today) —
    check the drawn-height-vs-spawn-radius gap deliberately for any new boss cannon table instead
    of assuming the ordinary 0-12 band applies.

## 🟡 Explicitly deferred (told not to do this pass)

11. The Spade Squad diep-physics balance pass. The client/server *mismatch* in the existing
    movement constants (accel, drag, tick conversion) is fixed, so prediction matches what the
    server actually does — that pass deliberately did not retune the underlying
    movement/knockback/recoil numbers themselves against any external reference. Every one of those
    was hand-tuned against a measured ~29Hz tick; retuning them is its own pass.
    **The reference numbers now exist** — `physics.html` has been read against the whole tree and
    the mismatches are itemised in items 14–24 below. Still deferred, but no longer unscoped.

## 🔴 Measured against diep.io's real physics (`physics.html`) — mismatches

*Source: `physics.html`, the archived spade-squad diep.io physics page (2022). Community-derived,
not diep source — one formula in it is internally implausible and is flagged as such below. Every
"ours" number here was read off the current tree, and every ratio is arithmetic on those two, not
a feel judgement. Numbers assume the real-world quantities `TICK_MS: 33` / `FRICTION: 0.964`
implied (top speed, recoil, reload in seconds); the later `TICK_MS: 25` / `REF_TICK_MS: 40` split
preserved those real-world quantities exactly, so no re-derivation is needed here.*

*This started as pure scoping data for #11, but parts have since been adopted — the auto-turret
spin rate (was #21), the FOV half of #19, the per-cannon base `reload`/`back` values in #15/#16,
and the level/stat *form* half of #14. Each item below now states what is still open; anything not
stated as open has shipped and should not be "re-fixed".*

*Before planning work off this section, read **[MEASUREMENTS.md](MEASUREMENTS.md)**. It lists the
handful of quantities that genuinely still need a real diep client, the ~14 that are already pinned
and must not be re-measured, and — most importantly for sequencing — the fact that **almost nothing
here is measurement-blocked any more.** #14's `FRICTION` is exact (`10/11`, derived), so #14, #16,
#17, #19, #30 and the damage model can all be finished before a single measurement is taken.*

14. **Movement: right shape, wrong stiffness.** (**The *form* half is done.** Level and Movement
    Speed are independent multipliers on the base accel now — `base × 1.07^pts / 1.015^level`,
    `public/SHARE/Physics.js` — so a maxed level-30 tank sits at 0.96× a fresh spawn instead of
    0.79×, and the level term no longer reaches zero speed at level 54. The remaining gap to diep's
    1.03× is entirely our 6-point stat cap against diep's 7, not the form. **The magnitudes below
    are still open** — `MOVE_ACCEL_BASE`/`FRICTION` are unchanged, so base top speed is still
    284 u/s, and the table's other rows still stand. **They are no longer blocked, though**: the
    section under the table derives `FRICTION` exactly and dissolves what used to be the blocker.)

    | | diep | ours | ratio |
    |---|---|---|---|
    | top speed, base | `10 × A₀` = 12.94 gu/s = 6.47 tank-diameters/s | 284 u/s = 5.07 diam/s | **0.78×** |
    | accel → top-speed ratio | `v_max = 10 × A` | `v_max = 26.8 × len` | **2.7×** |
    | e-fold time to top speed | 0.42 s | 0.90 s | **2.14× floatier** |
    | speed vs level | `÷ 1.015^lvl` (×0.64 at lvl 30) | `− lvl/155` (×0.447 at lvl 30) | multiplicative vs **subtractive** |
    | speed vs stat | `× 1.07^vm` (+61% at 7) | `+ 0.020/pt` on 0.35 (+34% at 6) | additive, half the range |
    | stat cap / level cap | 7 points, 45 levels | 6 points, 30 levels | **see #30** |

    (The last two rows of the table are what the form fix addressed; the first three are the open
    magnitude gap.)

    ### `FRICTION` is EXACT, and it is a *tank* constant — this is no longer blocked

    **`F = 10/11 = 0.909090…` per 40 ms loop, derived rather than measured.** `physics.html` states
    `V_max = 10 × A` for tanks. For the recurrence `v ← (v + A)·F` the steady state is `A·F/(1−F)`;
    setting that equal to `10A` gives `F/(1−F) = 10`, hence `F = 10/11`. The `0.9091` this item used
    to quote was a rounded 10/11 the whole time. Three independent cross-checks close:
    - the page gives top speed in both `du/loop` (`10A`) and `gu/s` (`5A`), which at 25 loops/s
      forces **1 gu = 50 du** in diep's own units;
    - that yields `10 × 2.58825 / 50 × 25` = **12.94 gu/s**, the table's own figure;
    - `A₀ = 2.58825 du × 28/50` = **1.449**, exactly the `len` quoted below.

    So: `len = 1.449`, `FRICTION = 10/11` at the 40 ms reference (`len = 0.978` / `F = 0.9244` at
    `TICK_MS 33`, `len = 0.556` / `F = 0.9422` at 25 ms). **Nothing here needs measuring.**

    **The old "FRICTION is global" blocker was a mis-framing of a real bug.** It is true that
    `lib/constants.js` re-exports one constant and that `entities/Bullet.js`, `entities/Objects.js`
    and `lib/gameAI.js` all decay through it — but **diep does not model bullets that way at all.**
    `physics.html` parameterises a bullet as `V_b = ρ/t_b`, range over lifetime, with **no drag term
    anywhere**, and defines `ρ_Vb` as "distance a bullet can fly before decay". The `V_max = 10 × A`
    identity that pins `F` is stated *for tanks only*.

    In other words we are currently running a **tank** recurrence on bullets, and sharing one
    constant between two things diep models separately. Splitting them is not a workaround to dodge
    a cascade — **the split is the faithful model**, and it makes the 2.2×-slower-bullets problem
    disappear rather than needing compensation. Recoil and knockback both act on *tank* velocity, so
    #16's rules hold verbatim under the split.

    **What is left is one observation, not a decision:** whether diep's bullets are truly constant
    velocity or carry their own separate drag — see `MEASUREMENTS.md` **M1**, which also yields the
    `ρ`/`t_b` values #23 wants. Adopting tank movement does **not** wait on it; bullets keep today's
    behaviour untouched until M1 lands.

    **The 284 u/s above is a level-0, no-upgrade tank walking — not this game's ceiling.** Riding
    your own recoil is worth ~1.5× a plain walk. `BASE_DRONE_CHASE_SPEED` is pinned to that real
    ceiling, measured live by `test/rooms.js`'s `fastestTankSpeed()` (replays `entities/Player.js`'s
    own `motion()` + `shoot()` recurrence over every reachable class at 6 Movement Speed and 6
    Reload, with the recoil aimed along the direction of travel). The level penalty
    (`Physics.moveAccel` divides by `MOVE_LEVEL_DIV^level` since the form fix) is why each class is
    fastest at the lowest level it unlocks at. **Deliberately not recorded here as a number** — it is a live test,
    so any retune that moves the ceiling (this item's `FRICTION`/`len`, #15's reload stat, #16's
    `weight`) fails `test/rooms.js` and forces a matching re-pin of `BASE_DRONE_CHASE_SPEED` and
    `BASE_DRONE_CHASE_TURN` in `lib/config.js`, rather than silently drifting apart. Run the test
    to see the current leaderboard.

15. **Reload.** (Base per-cannon values are done for Basic/Twin/Machine Gun/Sniper/Assassin/
    Destroyer/Hybrid. `can.reload` is denominated in reference-ticks — `lib/tick.js`, 40 ms loops,
    the same unit diep's own "loops" use — so diep's raw loop counts drop in unconverted. Keep that
    in mind for the two open pieces below; neither needs a tick conversion either.)
    - **Overlord/Overseer are still unconverted, and need a decision first.** The reference's
      merged "90 loops" row doesn't map cleanly onto the code: Overseer's cannon is 182, Overlord's
      is a different 281, and both are drone-*summon* cooldowns rather than a bullet reload, so it
      is ambiguous which one (or whether both) the figure describes. Resolve that before touching
      either number.
    - **The reload *stat*'s scaling (`up.Reload -= 0.092`/pt) needs an in-game measurement before
      anything is adopted.** The reference writes `RT = ⌈X₀/1,875^br⌉`, which taken literally means
      a Basic with 5 reload points fires *every loop* (25 shots/s) — not credible.
      `1.875 = 1 + 0.125 × 7`, so it is almost certainly a mangled rendering of a linear form
      reaching 1.875× fire rate at max stat. Under that reading diep is ×1.875 and ours is ×2.23
      (6 pts) — close enough to leave alone. Under the literal reading nothing about our reload
      stat is salvageable. Measure before choosing. Note this one moves the speed ceiling #14
      pins `BASE_DRONE_CHASE_SPEED` to. **Sequence after #30** — the `× 7` in that identity is
      diep's stat cap, so the whole comparison is only apples-to-apples once ours is 7 too.
    - **Left off the conversion on purpose — do not "finish the job" without re-deciding.**
      Annihilator keeps its 87: unlike Hybrid (a literal stat-clone of Destroyer's cannon, so it
      moved with it), Annihilator's other stats are already tuned away from Destroyer's, so its
      reload reads as its own number. Likewise every tree descendant that merely *shared* a tier-1's
      old value by coincidence (Flank Guard, Twin Flank/Triple Shot/Quad Tank/Triple Twin/Sprayer/
      Triplet/Penta Shot/Octo Tank, Ranger, Booster) — each has its own barrel count/damage/pene, so
      a shared number there is a family trait, not the copy-paste bug Twin's mismatched barrels were.

16. **Knockback (`weight`) is ~5.5× too weak — the whole column still wants replacing.**
    (The recoil `back` column is done and is now diep's table 1:1. Two things about it that matter
    going forward: **Annihilator was deliberately left off-table** for the same reason as its
    reload in #15, and **the 1:1 conversion is only true at today's `FRICTION`** — when #14's
    `F = 10/11` is adopted the whole column must be rescaled by `back = gu × 28 × (1-F)/F`.
    **That factor is 2.19, not the 2.55 this item used to claim** — 2.55 does not follow from the
    formula beside it under any reading; `(1−0.9244)/0.9244 ÷ (1−0.964)/0.964 = 2.19`, and the same
    ratio at the 40 ms reference (10/11 against 0.956532) is 2.20. Use the formula, not the old
    number. Since `back` is an impulse on *tank* velocity, this is unaffected by whatever M1 finds
    out about bullet motion — recoil follows the tank's `F`, always.)

    The gap, re-measured against the **live code path** (`entities/Player.js`'s bullet arm) rather
    than recomputed from the pre-rescale tree:

    | | diep, per loop of contact | ours, today | ratio |
    |---|---|---|---|
    | basic bullet (`weight` 0.27426) | 0.667 gu | 0.0725 gu | **9.2× weak** |
    | common bullet (`weight` 0.45709) | varies by class | 0.1208 gu | — |
    | tank body | 1.6 gu | 0.29 gu | **5.5× weak** |
    | drones | 0.8 gu | no separate value | — |

    **The conversion factor is now pinned: 1 unit of `weight` = 0.264175 gu of displacement**, at
    today's `FRICTION`, measured by replaying the real recurrence (impulse `tick.perTick(weight/3
    × 1.6)` into `this.vec`, decayed through `Physics.stepBody`). So `weight = Kf / 0.264175`, and
    the full diep Knockbackfactor table is in `physics.html` — no measurement is left to do here.
    Knockback lands on *tank* velocity, so like `back` it tracks #14's tank `F` and is independent
    of the bullet-motion question; re-derive the 0.264175 at `F = 10/11` when #14 lands.

    **Two things block finishing it, both human calls:**
    - **~7 of our classes are not in diep's table at all**, so a complete replacement cannot be
      read off it: Cyclone, Submachine, Auto Hover, Fortress, Summoner and Rocket have no diep
      counterpart, and plain **Gunner** is a real diep tank that the Knockbackfactor table simply
      omits. Converting only the mappable classes leaves Basic at 5.5× its current knockback while
      Cyclone keeps the old value — a worse balance state than either endpoint, so this wants doing
      atomically with a decision for the unmapped seven.
    - **The 33 ms → 40 ms rescale did not preserve this column.** At 33 ms a `weight` of 0.3 gave
      0.09563 gu; today's 0.45709 gives 0.12075 gu — **1.26× more knockback than before the
      "one-time relabelling, not a balance change" conversion**, and dropping the `× 1.6` instead
      gives 0.07547 (0.79×). Neither reproduces the original, so one of the two factors is wrong.
      Worth settling *before* the column is rewritten, since the same factor scales the new values.

    diep also *inverts* knockback against damage — Destroyer 0.2 gu, Annihilator 0.1 gu, against
    Basic's 0.667 — where ours is nearly flat across those three.

17. **Health, regen and body damage.**
    - **Max health. `MH₀ = 50` — CONFIRMED, no longer a measurement task.** `diep_wiki/Stats.txt`
      states it twice: `Base HP = 50 + [2 × (Level − 1)]`, "a level 1 tank has 50 HP, while a max
      level tank (level 45) has 138 HP", and separately "the health of a level 1 tank is exactly
      50.0". The Max Health stat is a flat **+20 HP/point** (table, 0–7 points → +0…+140; Smashers
      alone go to 10 points / +200). So diep's split is exactly the **+180% leveling / +280% stat**
      this item guessed at, against ours at +60%/+440%. Same shape (`MH₀ + 2·lvl + 20·mh` vs
      `150 + 3/lvl + 110/pt`), very different balance of terms: diep is 10 levels per health point,
      ours is 36.7. **That ratio is the real mismatch and it is now fully specified** — adopting it
      is arithmetic, not research. Note this also unblocks #23's `BASE_DRONE_HP` question.
      **Sequence this after #30**: `+20 HP/pt` is denominated in diep's 7-point cap, so adopting it
      at our 6 lands somewhere neither game intends, and would have to be redone.
    - **Regen.** diep is linear in time: `HPS = MH × (0.03 + 0.12·rr)/30` → full heal in 1000 s at
      0 points, 34.5 s at 7. Ours (`hpregan[1]` accumulates, then is added, every tick) is
      *quadratic* — full heal in 46 s at 0 points, 28 s at max. So our base regen is **21× faster
      than diep's** and our regen stat is nearly worthless (1.6× range vs diep's 29×).
      **The out-of-combat rule is now documented: diep calls it "Hyper Regeneration".**
      `diep_wiki/Stats.txt` — after **~30 s without taking damage** the regen rate "greatly
      increases"; below that threshold the linear `1/30 × MaxHP × (0.03 + 0.12·rr)` applies.
      That is what reconciles the two numbers this item treats as contradictory: at 0 points the
      linear rate alone is 0.1%/s (1000 s to full), but the measured time-to-full is **31.97 s**,
      because hyper regen takes over at 30. The wiki's full 0–7 table is 31.97 / 30.67 / 23.07 /
      15.15 / 11.75 / 9.13 / 7.72 / 6.41 s, and "9 or more points" is where a tank refills before
      the 30 s threshold is even reached. Shapes and projectiles have no slow regen but **do** hyper
      regen (polygons: "regenerate health if left unharmed for at least thirty seconds").
      So our quadratic accumulator is a crude stand-in for a real two-regime rule.
      **DECIDED: implement both regimes** — the linear rate below the threshold and hyper regen
      above it — rather than picking one curve. The hyper *rate* is not published, but it is
      solvable from the time-to-full table above (at 0 points the linear rate alone would take
      1000 s and the observed figure is 31.97 s, so the residual pins it). No measurement needed.
      **Still
      open; only the quantizer under it has been fixed.** `parseInt(hpregan[1] * maxHp * 10)/10`
      truncated the per-tick *increment* to 0.1 HP, which is a floor with no carry: every tick
      worth less than 0.1 HP healed nothing and threw the remainder away, so a 150 HP tank at 0
      points sat at a dead 0 HPS for ~22 s, and the dead time *shrank* as maxHp grew. The increment
      is applied unquantized now, so the curve is whatever the accumulator actually says — which
      makes the linear-vs-quadratic decision above a clean one to measure.
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
      `entities/Player.js`'s player-vs-bullet arm is `hp -= other.damage * max(1, other.pene/5)` flat.
    - **A bullet's health is spent against the target's damage output.** In diep a bullet
      (`BP = 20·Pf·PP` HP) loses HP equal to the target's DPL, so a high-body-damage tank eats
      bullets faster. Ours spends penetration against *itself*: `pene -= max(1, pene/5)`
      (`entities/Bullet.js`), target-independent.
    - **Penetration → damage is a coincidence, not a design.** diep's health loss per bullet does
      scale with penetration (`D_b ∝ PP`, because a tougher bullet survives more loops of contact),
      so our `× max(1, pene/5)` is accidentally the right *shape* — but the magnitude is off
      (diep ×6.25 at max bp; ours ×2.89 at max) and ours has a dead zone below `pene 5` where the
      stat does nothing at all. Stat slope is 0.75/pt (diep) vs 1.25/pt (ours).

    Adopting the real model would touch every `collision()` in `entities/`. It is the difference
    between "ramming is a build" and "ramming is chip damage", so it is a design call, not a bug
    fix — but nothing else in this section will make combat feel like diep on its own.

19. **Arena and shape density — the world is emptier per screen than diep's.** (The FOV half of
    this item is done: `config.FOV_MUL` 1.39 and multiplicative `FOV_PER_LEVEL` 1.005.)
    - **Arena.** diep sizes it per room: `AL = ⌊√N_P × 50⌋` gu (244 gu at our `maxPlayer: 24`).
      Ours is fixed and never changes with occupancy: ffa/4team/2team are **451/450/400 gu**, i.e.
      **1.85× diep's 244 gu**. Resizing toward diep is still open.
    - **Shapes.** diep's count is `12,5 × N_P` — independently confirmed by `diep_wiki/Polygons.txt`
      ("the arena gains 12.5 polygons for every player that is connected, rounded down"), so this
      is not a `physics.html` artefact. With the arena rule it is a *constant*
      1 shape per 200 gu² at any player count. Ours is 1 per 261 gu² — 0.76× the density; combined
      with the narrow FOV, a diep screen held ~13.7 shapes and ours ~5.4. The grid rescale held
      this ratio constant rather than improving it (`objCaps` went ×1.96 with the map's area purely
      to stop the per-screen count halving). If the "world feels empty" complaint is being chased,
      **this is still the number** — and the lever is the arena bullet above, since our
      squares-per-screen is now the thing that is 1.85× off.
    - Note also that diep's FOV is *resolution-dependent* (fixed 0.55 px/du, so an ultrawide
      genuinely sees more) where ours scales to fit. Ours is the fairer design; flagged only so
      the difference stays deliberate.

22. **Things that already match — do not "fix" them.** Necromancer base drone count (diep
    `22 + 2·br`; ours `maxDrone = 22` — only the growth differs, ours is +1/reload point against
    diep's +2). Reload quantization to whole ticks. Per-tick-of-contact damage application (diep's
    "law 3").

23. **Not covered by `physics.html` — but `diep_wiki/` has since supplied most of it.**

    **Resolved from the wiki, no measurement needed** (see also #17 and #19):

    | | HP | body damage | XP |
    |---|---|---|---|
    | Square | 10 | 8 | 10 |
    | Triangle | 30 | 8 | 25 |
    | Pentagon | 100 | 12 | 130 |
    | Hexagon | 1500 | — | 1500 |
    | Alpha Pentagon | 3000 | 20 | 3000 |
    | Crasher (small) | = Square | = Square | 15 |
    | Crasher (large) | = Triangle | = Triangle | 25 |

    Green ("shiny") variants: **×10 HP, ×100 XP**, body damage unchanged — worth checking against
    `public/SHARE/ObjectsConfig.js`'s tuned chances in the item 6 browser pass, since ours were
    picked by feel. Gamemode XP multipliers: **Tag ×3, Breakout ×3, Domination ×2**, everything
    else ×1. Body damage is `(BodyDamagePoints + 5) × multiplier`, multiplier **4 vs shapes**
    (so 20 at 0 points, confirming #17's figure), **+50% against tanks**, **−75% against
    projectiles** — that last one is the "body damage reduces damage taken" term #18 wants, stated
    directly. Bullet penetration: each point adds **+75% of the bullet's base HP**; a basic tank
    bullet's base HP is **2** (cross-checked three ways off `diep_wiki/Dominator.txt`, which quotes
    Dominator projectile stats as multiples of a tank's: "200 health (×100 Tank)", "10 Health
    (×5 Tank)", trap "30 (×15 Tank)"). A basic bullet's damage is **7** ("70 damage per hit,
    ×10 Tank"), matching #16/#18.

    **Still genuinely unmeasured — and now each has a written protocol in
    [MEASUREMENTS.md](MEASUREMENTS.md):** bullet range/lifetime (`ρ`/`t_b`, **M1** — which also
    settles whether diep's bullets carry drag at all, see #14), bullet spread (`rand`, **M2** —
    the form `w = h/ρ_Vb` is known, only `h` is missing), the reload stat's real form (**M3**),
    shape drift (**M4**), camera lag (`CONST.CAM_SMOOTH`, **M5**) and `CONST.HP_BAR_HOLD` (**M6**).
    That file also lists the ~14 quantities that are already pinned and must **not** be re-measured.

    Two things about the base drones stay open:
    - **The HP scale — the blocker is gone, the decision is not.** `BASE_DRONE_HP: 2000` is the
      wiki's number on *diep's* HP scale, and ours is not diep's — our base tank is 150 HP, a maxed
      level-30 tank here is 900. **`MH₀ = 50` is now confirmed** (#17), so diep's base drone really
      is ~7.1× a maxed diep tank, and the faithful number on our scale really is **~6400, not
      2000** — a 3.2× increase. **DECIDED: go to ~6400**, i.e. stay true to diep rather than keep
      the 2000 that was shipped on "very durable but killable". Recompute the exact figure against
      whatever a maxed tank's HP becomes once #30's 7-point cap and #17's `+20/pt` land, since
      6400 is derived from that pool rather than being a constant in its own right.
    - **`BASE_DRONE_DAMAGE: 2.97`** is derived (`8.48485 × 7/20`, our tank body damage scaled by the
      wiki's 7-per-loop against diep's 20-per-loop tank body), not observed. At today's rate that is
      ~74 HP/s from a single drone, so a swarm of twelve kills a 900 HP tank in about a second.
      Playtest it before treating it as settled.
    - `CONST.MAX_UP_POINTS` is hand-mirrored between client and server, next to the
      input-prediction constants in item 24.

24. **Close-quarters bullet truth — the remaining error budget.** The dimensional bug in the
    client's input prediction is fixed (the integrator lives in `public/SHARE/Physics.js` now and
    `predic` stays in units-per-*tick*, scaled once at integration). What is left, cheapest-first:
    - **(a) Derive the lead instead of tuning it. DONE.** `ping` carries a probe byte now
      (`[2, 2]`, `TYPE.ping.probe`): `0` is the heartbeat it always was, `1` is a client-initiated
      probe the server echoes verbatim in `net/gameSocket.js` without keeping state. The client
      sends one a second alongside the heartbeat and times it into an EMA on `public/motion.js`'s
      `NET` (`NET.probe()`/`NET.echo()`, gain 0.2, samples over 2 s discarded as a backgrounded
      tab). `NET.leadMs()` is then `interval + rtt/2` — both measured — and `public/client/game.js`
      caps the prediction offset at `leadMs × predicSpeed`, i.e. exactly how far the tank travels
      during the render delay plus half the round trip. `CONST.SIZE*2` survives only as an absolute
      ceiling against a hostile measurement; it no longer decides the size of the lie. On a 50 ms
      RTT at base top speed this is ~16 units against the flat 70 it replaced.
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
