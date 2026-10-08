# Issues & TODO

## Open

- **Finish gamemodes one by one** — sandbox gaps (party links, arena/shape scaling, bosses
  after 50–60 min), survival arena management, mothership/survival polish.

- **Game complexity** — consider a refactor to simplify if applicable.

- **Survival arena management** and arena management in general needs fine tuning.

- **FFA area size changing** - the arena should be scaling live ig we will see what basesize should be and how it scales etc. also arena closing when etc

- **Drone class (Overlord & co.) still "meh"** — idle orbit, swoosh, drawn size, and hit circle
  were all attacked in a chain of commits that got discarded. Every open thread and what was
  learned is under "Reverted attempts" below. Retry one thread at a time.

- **`test/clientDiff.js` golden is stale** — pinned at `327739/90ff3e28` (commit `c8ee14b`);
  the tree now deterministically produces `314699/bbb08148` after the orbit-bias, chase-lead
  and priming commits. Decide whether those are the intended render, then re-pin with
  `OBSTAR_DIFF_CAPTURE=1`. Don't re-pin blindly — it's the only canvas regression guard.

this needs a toggle later we will see:
Diep (wiki + diepcustom): you get the victim’s level score, capped at 23,537. A 1M tank still gives 23,537.

Obstar uses pow(xp/mlx, 1.8), then 10% of score past level 43. Versus diep that is:

Worse for almost everyone (a ~6k tank gives ~2,280 vs diep ~5,500–6,200)
About even around a fresh 45
More only after the victim is a whale (~45k+). A 1M tank gives ~119k vs diep’s 23,537

## Reverted attempts (retry later)

Four commits were dropped from the line. Each one's goal, what it changed, and why it was
pulled is recorded here so the next attempt starts from the lesson, not from zero. The
discarded code is still reachable in git history under the original hashes.

### R1. Mothership geometry re-derivation — `6c37a00` (reverted in `16c23ea`)

- **Goal:** derive Mothership's barrels/drones/body from diep `TankDefinitions.json` id27 the
  same way Defender and Summoner were (`du × 0.56 × 35 / bossSize`), and pin it with a
  `mothershipGeometryTests()` in `test/rooms.js`.
- **Changed:** client `height 42 → 10.74`, `width 7.35 → 1.88`; `bossSize 112.8 → 109.497`
  (apothem of the level-140 16-gon instead of the raw body radius); server `canonLength
  42 → 10.74`; drone `size 3.675 → 0.94`.
- **Result:** the test passed; in-game the barrels were effectively gone and the drones were
  tiny. The old numbers were restored exactly (verified by dumping both halves of
  `CLASS['Mothership']` at `bfaba82` and on this branch — byte-identical).
- **Why it's wrong (hypothesis, not proven):** the Defender/Summoner axis treats `bossSize` as
  the apothem and converts client dims through `35/bossSize`; for Mothership the hand-tuned
  values behave as if they are already in the normal-tank axis (barrel 60 du × 0.7 = 42, the
  same identity every ordinary tank uses). Either Mothership should be converted on the
  ordinary-tank axis, or `drawings.js`'s trapezoid (type 2) barrel scales differently from
  the Defender/Summoner barrel types. Prove which before touching the numbers again.
- **How to retry:** keep `bossSize 112.8` fixed first and only re-derive one quantity at a time,
  checking each against a live screenshot of a Mothership next to a level-45 tank. Only write
  the geometry test once the screen looks right. `PENDING.md` "Still open" carries the item.

### R2. Base-drone sprite / size unification — `6f59578` ("drone stuff")

- **Goal:** make the base (team-nest) drone an equilateral triangle whose collision radius is
  its drawn circumradius, matching diep's "n-gon vertices at physics.size" convention, and
  land the base-drone side at diep's ratio (side / L1-tank diameter ≈ 28.8/57.3).
- **Changed:** `lib/config.js` `BASE_DRONE_SIZE 9.2 → gu(1)/√3` (≈16.17, so side = 28 =
  one grid square) and `BASE_DRONE_SEPARATION 26.3 → 2·BASE_DRONE_SIZE − 5`; `drawings.js`
  `bullet[1]` redrawn with vertices at `size` (was `size×1.7` tip, `−0.6` back — not
  equilateral); `render.js` alpha-fade case extended to draw type 7; `TANK_DRONE_ORBIT_SPEED_FRAC
  0.37 → 1/6` (diep's restCycle `baseAccel /= 6`); clientDiff golden re-pinned.
- **Result:** fixing `bullet[1]` for base drones also shrank every drone-class triangle
  (Overlord, Overseer, Hybrid, Manager, Mothership…) because they share the sprite — their
  `can.size` was tuned for the old 1.7× tip. The next two commits were patching that fallout.
- **Facts worth keeping:**
  - diep base drones (diepcustom `BaseDrones.ts`): fake tank size 50, barrel width 42,
    sizeRatio 1 → circumradius 21 du → side ≈ 36.4 du; L1 tank diameter 100 du; side/diam
    = 0.364 (≈20.8 px at a 57.3 px tank). The traced "28.8/57.3" from live diep does not match
    diepcustom's width-42 — re-measure from a still screenshot before chasing either number.
  - Obstar's old base drone: `BASE_DRONE_SIZE 9.2` was back-solved so `9.2×1.7×1.79 ≈ 28`
    (one grid square side); collision at 9.2 is the inscribed circle, not the drawn
    circumradius (15.6).
  - `TANK_DRONE_LEVEL_GAP 3.05` (= 28/9.2), `BASE_DRONE_LEVEL_GAP 28`, `BASE_DRONE_SEPARATION`,
    and their tests all assume the 28-unit side. Any base-drone size change moves all of them.
- **How to retry:** split the sprites *first* (base drones on their own draw type, drone
  class untouched), then change only the base drone. Never let a base-drone fix touch
  `bullet[1]`.

### R3. Physics swoosh + drone-class draw scale — `6c8bc44` ("temp (incorrect) whoosh")

- **Goal (a):** replace the tank-drone swoosh (a planned quintic `orbTbl` curve through the
  owner, every `TANK_DRONE_CROSS` = 10 s) with a physics dive closer to diep's restCycle.
- **Changed (a):** `entities/Bullet.js` — `planTankCross()` now snaps heading onto the
  diameter through the owner and flies it with thrust + friction (`tankCrossStep()`), thrust
  drops to 1/6 past the centre, orbit field slews onto level 1 under a
  `TANK_DRONE_RECOVER_TURN 0.15` rad/tick cap (`tankCrossFinish()`). `public/client/entities.js`
  — bullet `ddir` snaps instantly when the heading change is > 0.7 rad instead of lerping.
- **Goal (b):** undo R2's shrink of the drone class without un-fixing base drones.
- **Changed (b):** `drawings.js` `DRONE_CLASS_DRAW = 1.59` — `bullet[1]` drawn at
  `size × 1.59`; new `bullet[7]` draws at `size` for base drones; `rooms/Room.js` sets base
  drones to `drawType = 7`.
- **Result:** self-labelled "incorrect". In-game observations recorded at the time:
  - after a swoosh, Overlord drones recover basically *inside* the tank — the inner ring
    (level 1) is too close; extend it outward.
  - the swarm is position-locked to the tank; when the tank moves the drones should lag
    behind and chase, not translate rigidly. Check against diep.
- **Diep reference (diepcustom `Drone.ts`, "still a bit inaccurate, works though"):** there is
  no timer. Idle only when no LMB/RMB and no AI target. `MAX_RESTING_RADIUS = 400²` du.
  REST (`unitDist = dist²/400² ≤ 1` and `restCycle`): `baseAccel /= 6`, `angle += 0.01 +
  0.012·unitDist` rad/tick — a slow wander inside a 400 du disc, not a locked ring. WHOOSH
  (drifted past 400 du, *or* `restCycle` cleared by releasing the mouse): seek a point
  `1.2 × tank.size` from the tank at +90° CCW from the current tank→drone bearing (not the
  centre); full accel if `unitDist ≥ 0.5`, else `/3`; `restCycle = true` again within
  `2 × tank.size` of that gather point. Velocity is never zeroed — the "through the middle"
  look is leftover momentum under 1/6 thrust + friction (0.9/tick). `Swarm.ts` extends this
  unchanged. Base-drone barrel speed 2.7 vs Overlord 0.8, so diep *base* whooshes are faster.
- **Obstar state these touch:** `droneIdleOrbit()` → `planTankCross()` (tank drones) and
  `case 1.4` → `planCross()` (base drones), `crossPolyline()/blendShape()/crossSolvePeak()/
  crossVAt()`; config `TANK_DRONE_CROSS`, `TANK_DRONE_CROSS_JITTER`, `TANK_DRONE_CROSS_SPEED_FRAC`,
  `BASE_DRONE_CROSS_*`; landing → `orbLevel = 1`, `orbHoming = 1`, climb via
  `planTankSwitchArc()`.
- **How to retry:** if matching diep, port the restCycle pair (wander-in-disc + perpendicular
  gather-point seek, gated on mouse-up) as a *replacement state machine*, rather than bolting
  a physics dive onto the 10 s metronome. Keep the draw-scale question (b) in its own commit.

### R4. Drone-class hit circle = drawn circumradius — `794bbb7` ("idfk broken")

- **Goal:** with R3's `DRONE_CLASS_DRAW` the drone class was drawn at 1.59× its collision
  radius; make the server hit circle match the drawn triangle, like diep where the vertices
  sit on the hit circle.
- **Changed:** `World.DRONE_CLASS_DRAW = 1.59` moved to the shared module; `Room.createBullet()`
  calls new `Bullet.applyDroneClassHit()` which sets `guardSize = size × DRONE_CLASS_DRAW` for
  drone-class types; maze-wall contact uses `guardSize || size`; drone-vs-drone same-owner
  shove uses a flat diep-style `DRONE_SEPARATION` kick (pushFactor 4 du/ref-tick ≈ 2.5× an
  Overlord's 0-stat thrust, independent of Bullet Speed) instead of `push` when `guardSize` is
  set; quadtree collision query reach widened from `×2` to `×(1 + DRONE_CLASS_DRAW)` so a
  size-leader doesn't miss a drone whose hit circle is larger than its own radius.
- **Result:** self-labelled broken; it inherited R2/R3 and was never isolated.
- **Open question recorded at the time:** diep's Overlord drone radius is
  `barrel.width/2 × sizeRatio = 42/2 × 1 = 21 du` at scale 1, scaled with the tank; Obstar's
  cannon `size: 14.7` is that same number on the 0.7 axis. Should drone size be derived from
  the barrel (as diep does) instead of hard-coded per class? If so, check the level-45 scaling
  was done right before retuning sprites around it.
- **How to retry:** decide the drone-class *drawn* size first (R3b) against a screenshot, then
  make the hit circle follow it in one commit with a test that a level-45 Overlord drone's
  vertex distance equals its `guardSize`.

## Testing policy

UI tests should never be added. Verify those in-game (sandbox, tester mode). Only logic and
key tests for race conditions, subtle logic bugs, or anything that can't be easily tested by
playing should be added.
