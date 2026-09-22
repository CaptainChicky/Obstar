# Issues & TODO

## Open

- **Finish gamemodes one by one** — sandbox gaps (party links, arena/shape scaling, bosses
  after 50–60 min), survival arena management, mothership/survival polish.

- **Game complexity** — consider a refactor to simplify if applicable.

- **Survival arena management** and arena management in general needs fine tuning.

- **FFA area size changing** - the arena should be scaling live ig we will see what basesize should be and how it scales etc. also arena closing when etc

base drone sizes: this ratio we have will be base drone equilateral (is it equilateral?) triangle side length vs basic level1 0 score tank diameter
28.8/57.3 this is diep
29.5/57.3 this is obstar
========
Size cause (base drones):
- Diep triangles ARE equilateral. Regular 3-gon, vertices at physics.size (circumradius).
  diepcustom BaseDrones.ts: fake tank size 50, barrel width 42, sizeRatio 1 → circumradius 21 du
  → side = 21√3 ≈ 36.4 du. L1 tank diameter 100 du. Side/diam = 0.364.
  At a 57.3px L1 tank that is ~20.8px side — not 28.8. If 28.8 is what you traced in live
  diep, it does not match diepcustom's width-42; could be stroke/bbox/rotation, or live
  diep base drones are bigger than the reversal. Cross-check against a still screenshot.
- Obstar base drones are NOT equilateral. Drawings.bullet[7] (the old tank-drone sprite):
  $1 = size × 1.7, vertices ( $1, 0 ) and ( -0.6*$1, ±0.866*$1 ). Base = 1.732*$1,
  the two long edges = 1.819*$1. BASE_DRONE_SIZE 9.2 was back-solved so
  size × 1.7 × 1.79 ≈ 28 (one grid square), not so side/L1-diam = diep's ratio.
  Long edge 9.2×1.7×1.819 ≈ 28.45 world; vs L0 tank diam 56 → 29.1px at your 57.3/56
  scale ≈ your 29.5. Collision 9.2 is the inscribed circle, not the drawn circumradius (15.6).
- Tank/overlord drones were patched to diep (type 1: circumradius = size, -0.5). Base
  drones were split onto drawType 7 on purpose so that 28-unit side would not shrink
  with them. Remaining 29.5 vs 28.8 is that leftover 1.7/-0.6 sprite, not can.size.
  To hit 28.8/57.3: draw them equilateral like type 1, then set BASE_DRONE_SIZE so
  size×√3 / tankDiam matches. LEVEL_GAP 28, SEPARATION 26.3, the 3.05 tank-drone
  lane, and tests all assume the 1.7×9.2 = 28-unit side — they move with a size change.

Whoosh cause (base + tank drones):
- Obstar does not run diep's restCycle. Both team-base drones (Bullet.js case 1.4,
  planCross) and idle tank drones (droneIdleOrbit → planTankCross) use a 10s-timer
  planned path: arc → C2 blend → straight THROUGH the centre → C2 blend → inner ring.
  Config: BASE_DRONE_CROSS / TANK_DRONE_CROSS (250 ref ticks), CROSS_SPEED 370 u/s
  (base) / TANK_DRONE_CROSS_SPEED_FRAC 0.941×terminal (tank). Steady ring is the 1/6
  we copied; the dive is still ~full speed by design.
- Diep whoosh (diepcustom Drone.ts, also what BaseDrones fire — type "drone") is:
  wander inside 400 du at accel/6, then full-accel seek to a point 1.2×tank.size
  perpendicular to current bearing (not through centre). restCycle false on mouse-up
  forces it. Overshoot-through is leftover velocity + friction, not a baked diameter.
  Base-drone barrel.speed is 2.7 vs Overlord 0.8, so diep *base* whooshes are faster
  than overlord ones. Full dump under WHOOSHES: at the bottom of this file.
========

this needs a toggle later we will see:
Diep (wiki + diepcustom): you get the victim’s level score, capped at 23,537. A 1M tank still gives 23,537.

Obstar uses pow(xp/mlx, 1.8), then 10% of score past level 43. Versus diep that is:

Worse for almost everyone (a ~6k tank gives ~2,280 vs diep ~5,500–6,200)
About even around a fresh 45
More only after the victim is a whale (~45k+). A 1M tank gives ~119k vs diep’s 23,537

## Testing policy

UI tests should never be added. Verify those in-game (sandbox, tester mode). Only logic and
key tests for race conditions, subtle logic bugs, or anything that can't be easily tested by
playing should be added.

=========================
WHOOSHES:

Diep idle drones do dash past/through the tank. It is not a planned diameter cross.
It is the rest-cycle AI in diepcustom (a slightly-inaccurate reversal of live diep).

## Diep / diepcustom

File: `diepcustom/src/Entity/Tank/Projectile/Drone.ts`
Idle only when you are not holding LMB/RMB and the drone AI has no target
(`usingAI && ai.state === AIState.idle`).

Properties / constants:
- `MAX_RESTING_RADIUS = 400 ** 2`  (rest disc radius 400 du ≈ 224 Obstar units)
- `restCycle` boolean, starts true. Cleared to false when you start steering
  (`restCycle = false` on the non-idle branch — every mouse-release forces a whoosh)
- `unitDist = dist² / MAX_RESTING_RADIUS`  so 1 = 400 du, 0.5 ≈ 283 du
- `baseAccel` is free-flight drone accel. Rest divides it; motion is still the
  normal bullet integrator (`maintainVelocity` + 0.9 friction, 40ms tick)
- `usePosAngle = true` so thrust follows `positionData.angle`

Two modes, no timer:

1. REST (`unitDist <= 1 && restCycle`):
   - `baseAccel /= 6`  (this is the 1/6 we copied onto `TANK_DRONE_ORBIT_SPEED_FRAC`)
   - `angle += 0.01 + 0.012 * unitDist` rad/tick  (~0.25–0.55 rad/s)
   - wander inside the 400 du disc, not a locked ring

2. WHOOSH (the `else`):
   Trigger: drifted past 400 du, OR restCycle was cleared (let go of mouse).
   - Aim at a point `1.2 * tank.physics.size` from the tank, 90° CCW from the
     current tank→drone bearing. NOT the tank centre.
     (`offset = atan2(dy,dx) + PI/2`, target = tank + polar(offset, size*1.2))
   - Accel: full if `unitDist >= 0.5`, else `baseAccel /= 3`
   - `restCycle = true` again when within `2 * tank.size` of that *gather point*
     (not of the tank)
   - Velocity is never zeroed. 1/6 rest thrust onto leftover full-speed momentum
     is the through-the-middle look; they often exit 400 on the far side and
     whoosh back.

Related: `diepcustom/src/Entity/Tank/Projectile/Swarm.ts` extends Drone, same
rest AI (TODO in that file says custom resting state was never added).
`diepcustom/src/Entity/Tank/Projectile/Bullet.ts` — `maintainVelocity`,
`baseAccel`. Barrel `bulletAccel = (20 + 3*stat) * bullet.speed`.
`diepcustom/src/Entity/Object.ts` — friction 0.9 / `maintainVelocity` * 0.1.

Diepcustom comment on this block: "still a bit inaccurate, works though".

## Obstar (current, not diep)

Idle tank/boss drones: `entities/Bullet.js` `droneIdleOrbit()`.
This is the base-drone 5-level field + planned swoosh, flown in the owner's
frame. It does NOT run diep's restCycle.

Steady ring (already patched to 1/6):
- `lib/config.js` `TANK_DRONE_ORBIT_SPEED_FRAC`  (was 0.37 = team-base 85 u/s)
- consumed in `droneIdleOrbit` as `vOrbit = vTerm * TANK_DRONE_ORBIT_SPEED_FRAC`
- ring radius: `TANK_DRONE_ORBIT_R` (4.5 × owner size) + `TANK_DRONE_ORBIT_BIAS`,
  lanes `TANK_DRONE_LEVEL_GAP` × drone size, `tankLevelR()`

Swoosh (unchanged, to revisit):
- `lib/config.js`:
  `TANK_DRONE_CROSS` (250 ref ticks = 10s),
  `TANK_DRONE_CROSS_JITTER` (0.4),
  `TANK_DRONE_CROSS_SPEED_FRAC` (0.941 of terminal)
- trigger in `droneIdleOrbit`: `--orbCrossIn <= 0 && onRing && !orbHoming`
  then `planTankCross()`
- geometry (shared with team-base drones):
  `crossPolyline()` / `blendShape()` / `crossSolvePeak()` / `crossVAt()`
  path: arc → C2 blend → straight THROUGH the owner → C2 blend → level 1
  `planTankCross()` poses it in the owner frame so a moving tank carries the curve
- `BASE_DRONE_CROSS_*` in `lib/config.js` is the team-base copy of the same
  machinery (`entities/Bullet.js` case 1.4, `planCross()`)
- after landing: `orbLevel = 1`, `orbHoming = 1`, climb home via `planTankSwitchArc()`

Vs diep whoosh: Obstar is a 10s-metronome kinematically planned diameter; diep is
full-accel seek to a 1.2×size perpendicular point, physics-overshoot, fired by
the 400 du disc or by releasing the mouse.

## If matching diep whooshes later

Copy the restCycle pair from `Drone.ts` (slow wander inside ~400 du, full-accel
seek to 1.2×size perpendicular, restCycle gate on mouse-up), rather than only
retuning `TANK_DRONE_CROSS_SPEED_FRAC` on the planned 10s diameter cross.
