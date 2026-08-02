# Pending & Decisions

Only what is still **open**: things needing a human call, things nobody has watched happen, and
values that look wrong until you know why they are what they are. The active work plan is
**[plan.md](plan.md)**; deliberate departures from diep are in **README.md → "Departures from
diep"**; the codebase map and load-bearing invariants (the two frictions, `weight` vs `push`,
`LETHAL_EPS`, tick categories) are in **[HANDOFF.md](HANDOFF.md)** §3.

**Rule: a finished thing with no nuance left is deleted from this file.**

---

## Needs a human decision

2. **Reload quantisation** — we `Math.round()` reload ticks; diep compares a float cycle
   (`Barrel.ts:60`). Dropping the round changes every class's cadence at non-integer point
   counts; two sites (`entities/Player.js` `shoot()`, `test/rooms.js`). Deferred so it isn't a
   second cause in someone's clientDiff golden.
3. **`A₀` 1.47% high** — `physics.html` (2.58825) vs `TankBody.ts:271` (2.55 at our 0-based
   level → coefficient 1.428 not 1.449). One literal in `public/SHARE/Physics.js`. Left on
   physics.html's figure deliberately.
4. **`rules.arenaLive` for 2team/4team** — `dronePosts` are baked at construction; a live arena
   would freeze base layouts at the starting floor. Needs `dronePosts` re-derived from the live
   map before either mode can turn it on.
5. **Tank-vs-shape overlap** — no positional resolution (tank-vs-tank has it); a tank can stand
   inside a shape held off only by knockback.
6. **Base drones** — chase speed is diep's own flat 756 u/s; lethality (12 drones ≈ 0.2 s on a
   maxed tank) still never judged in a browser. `BASE_DRONE_DETECT` is **back at `gu(60)`**, not
   diep's own `gu(18)`: the diep figure applies to a drone that flies free near its owner, while
   ours orbits a fixed ring with one scout per centre, and playtesting showed it leaves a band
   around every base where an enemy is inside the drones' reach and nothing reacts. Ours,
   flagged. (The "they don't attack at all" half of that report was a real bug — a scout's
   detector was never reset, so a centre latched onto its first-ever sighting forever; fixed in
   `entities/Bullet.js`'s type-1.4 acquire block.)
7. **Sandbox gaps** — party-link invites; arena/shape scaling with player count; bosses after
   50–60 min.
8. **Comment-style cleanup pass** — strip cross-file references/change history, keep functional
   statements. Touches nearly every file; do it as its own commit.
9. **Contact quantisation (D6)** — we prorate per 25 ms tick; diep exchanges once per 40 ms
   tick. Accepted approximation; the exact fix is a per-pair reference-tick guard.
10. **`prize`/coins/respawn XP** — ours (`pow(xp/mlx,1.8)`, `respawnPow 0.9`) vs diep's
    `scoreReward` + `respawnLevel = min(level−1, floor(√level × 3.2796))`. Decide per mode.

## Needs a real browser session (nothing else can settle these)

- **C1 causes 2/3** — muzzle-weld ramp vs the current prediction path under strafing. Do not
  blind-tune; the prediction math is measured and pinned by `test/client.js`.
- **`CONST.CAM_SMOOTH`** — camera lag has no reference anywhere (diepcustom is server-only).
  Protocol: accelerate to top speed, measure steady-state offset from screen centre in grid
  squares (the grid is the ruler — 1 square = 1 gu); repeat at maxed Movement Speed to confirm
  it's linear in speed. Do not guess a number.
- **`CONST.HP_BAR_HOLD`** — damage a Pentagon once, count frames until the bar starts fading.
- **Damage-flash duration** — client re-times its own flash (`sleep(50)`+`sleep(16)`) instead
  of tracking how long the server holds the states[0] bit (~75 ms). Rewrite `hit()` to follow
  the bit; needs eyes on it.
- Sandbox self-levelling, the smasher panels, the class-picker slide-in, and every plan.md
  silhouette fix — one eyeball pass against the six reference webp files at the end.

## Live stand-ins (ours, flagged — don't present as diep numbers)

- **Custom classes with no diep counterpart**: Cyclone, Submachine, Auto Hover, Fortress —
  every column is a nearest-relative stand-in (Cyclone ← Octo, Submachine ← Machine Gun,
  Fortress ← Tri-Trapper/Battleship, auto-turret slots ← `AutoTurret.ts`'s shared def).
- **`weight`/`push` columns for post-Knockbackfactor classes** (Hunter, Predator, Streamliner,
  Stalker, Auto 3/5, Spread Shot, Gunner Trapper, Tri-Trapper, Skimmer, Factory, Mothership,
  the bosses' drone/trap rows): diep's knockback table predates them; each borrows its nearest
  relative's row.
- **`TEAM_SOFT_PUSH`** (`entities/Player.js`, 0.2) — two tanks on the SAME team exchange a fifth of
  the ordinary body knockback and skip this tree's positional overlap resolution entirely. Diep has
  no such rule: its same-team filter (`Object.ts:154-171`, our `teamPassThrough()`) is about
  projectiles, and two friendly tanks there collide at full strength. Ours, by request — at full
  strength plus hard separation a friendly crowd cannot stack through a chokepoint. Nothing outside
  a `rules.teamPlay` mode is affected (the flag rides `option.noDam`, which only team modes set).
- **`DOMINATOR_RETARGET_IDLE`** (3 s), **`BASE_DRONE_LEASH`** (`gu(90)`), Tag's `INVIS_FLOOR`,
  `CLOSER_COUNT 4`, Domination's Dominator layout (diamond; diep gives no coordinates) — all
  unreferenced knobs.
- **Bots** (`lib/gameAI.js`) have no path to most post-T2 tanks — not authored yet.
- **A boss's `size` conflates three different diep quantities** — its collision radius, its
  drawn circumradius, and the reference the barrels scale against. Guardian is the only one
  re-derived (it drew at twice diep's size and swallowed its own barrel whole): its `bossSize`
  is now the figure that makes `Drawings.body[3]`'s `size / cos(pi/n)` land on diep's own
  GUARDIAN_SIZE, with barrel/drone figures re-based on it. **Summoner, Defender and Mothership
  carry the same ambiguity untouched** — each is internally consistent today and none was
  reported, but their `bossSize` is not diep's `physicsData.size` either. Fixing them properly
  means moving `body[3]` onto the universal `x sqrt(2)` circumradius identity (the one every
  `Drawings.obj` shape already uses) and re-deriving all three at once.
- **Boss `canControlDrones` possession** (Guardian's rear spawner, Summoner's 4 spawners) — diep
  lets a player pilot these two bosses and steer their drones by hand (`AbstractBoss.ts:186-192`),
  the same `H`-key claim flow plan.md E4 built for Dominator/Mothership. `rooms/Room.js`'s
  `togglePossession()` only iterates `this.dominators.concat(this.motherships)` — a boss was left
  out deliberately (plan.md Part D scoped E4 to Dominator/Mothership only), not by oversight.
  Extending it would need a third claimable-entity list, a possession-timer decision (Guardian/
  Summoner have no diep precedent for one the way Mothership's 5-minute clock does), and the
  drone-steering path (`entities/Bullet.js`'s `droneSteer1`) taught to read a piloted boss's own
  inputs the way it already does for Mothership's even-numbered barrels.
- **Optional Fallen variants** (`Entity/Misc/Boss/FallenAC.ts`/`FallenMegaTrapper.ts`/
  `FallenSpike.ts`) — plan.md Part D explicitly marks these optional; not built. Cite their own
  files (`movementSpeed`/barrel-reuse/`damagePerTick` overrides) if/when they are.
- **Survival/Mothership modes**: no waiting-room countdown UI (data is on the wire), no
  per-mode front-page door art, no `shapeScoreRewardMultiplier` (×3 shapes-only XP has no hook
  in `awardXp()`), Survival's shape density doesn't rescale with the arena.

## Settled by the second issues.md pass (kept only for the nuance)

- **The `back` (recoil) column was uniformly 2.5x diep's**, now rescaled. The identity in
  TanksConfig.js's own header was always right (`gu_value x 2.8`); what had been written into the
  70 literals was `barrel.recoil x 2.8` off TankDefinitions.json's raw field. `Barrel.ts:153`
  spends recoil as `addVelocity(angle + PI, recoil * 2)`, so the grid-square figure is
  `recoil x 0.4` and the raw field ran hot by exactly 1/0.4/1 = 2.5. The axis is settled
  independently of physics.html by an anchor already in this tree: diep's TankBody carries the
  PhysicsGroup default `pushFactor 8`, and entities/Player.js has always stated that same body
  knockback as 4.48 world units - which is 8 x 0.56, the plain absolute-length conversion. An
  impulse column is a length column. **The `weight` column was audited the same way and is fine**
  (99/127 barrels exact; the 28 that miss are the documented post-Knockbackfactor stand-ins listed
  under "Live stand-ins" below, and diepcustom now has real numbers for them - that is a real
  outstanding job, not a mystery). Annihilator's deliberately off-table 4 gu recoil (#15/#16) had
  already been overwritten by the raw-recoil pass and is now on diep's own 6.8 gu; restoring our 4
  is a balance call nobody has made.
- **Predator zoom inversion could not be reproduced.** Reported as "goes to the top when I right
  click at the bottom". The whole chain was driven end to end (server latch -> wire -> client ease
  -> render transform) in all four cardinal directions and every stage agrees with diep: the
  server's `zoomX = x + cos(dir) * 840` matches `TankBody.ts:340-342`'s
  `cos(angle) * 1500 + x` on the 0.56 axis, and the client's `zoomOffX` settles to exactly
  `+840` for a right-aimed click. `General.tankOff()` already subtracts `zoomOffX/Y`, so aiming
  while panned reads the mouse against the tank's real on-screen position. **Nothing was changed** -
  a speculative sign flip would break a path that currently tests correct. Needs a browser session:
  most likely candidates are something in the real input path that the headless harness does not
  model (pointer-lock/`clientX` under a transformed canvas), not the camera maths.

## Knowingly wrong / do-not-"fix"

- **Semi-implicit Euler drag error**: live 25 ms server runs ~1.8% over the 40 ms-reference
  steady state (362.25 → 368.9 u/s); impulse columns read ~1.8% high with it. The real fix (an
  exponential integrator) redefines every per-reference-tick constant. Recorded so nobody
  chases it; `test/rooms.js` uses a 3% band for this reason.
- **Class-tier gate** is `parseInt(level / 15)` — our level is 1-based; do not "restore" the
  `(1 + level)` form, it opens tier 1 at level 9. Pinned by `test/rooms.js`.
- **Boss aggro radius** is measured from the hull (`(raw − size) / raw`) because tanks can no
  longer stand inside a boss; the 0.5625 y-squash makes a flat subtraction wrong. Not a diep
  number (Summoner-engine specific).
- **Shape density** (+40% vs old tree) is also a per-tick cost: ffa canvas ops +56%. Knob:
  `SHAPE_DENSITY_GU2` in `rooms/Room.js`.
- **A GuardObject is filled `#555555` and stroked `#404040`**, not filled flat `#404040`. Those
  are diepcustom's own `Color.Border` (0x555555) and this tree's universal `x0.75` stroke rule,
  and they are what `Spike_transparent_facing_up.webp` measures at — the visible spike tips read
  as #404040 because the stroke covers most of a narrow tip, with the lighter fill only showing
  in the wide overlaps. If a flat #404040 is ever actually wanted, it is one entry in
  `public/client/config.js`'s `Palette.guard`.

## Settled by the third issues.md pass (kept only for the nuance)

- **Every trapper's barrel was clipped in the world, not just in a panel.** `render.js`'s
  `setCoord()` sized the offscreen sprite cache from a per-barrel
  `sqrt(height² + (width/2 + offx + open/2)²)` bound that had never heard of `trapLauncher` — and
  a trap launcher sits ENTIRELY past the barrel tip, so its arrowhead was drawn outside the canvas
  and cut off everywhere the sprite appears. It also read `offx` signed (a barrel offset the other
  way shrank the bound). Rewritten to reduce each feature to a point set or a disc in the body
  frame and take real maxima; the cache grows 29–52 reference units across
  Trapper/Tri-Trapper/Mega Trapper/Gunner Trapper/Overtrapper/Defender/Guardian/Summoner and
  shrinks 4 everywhere else (a stroke owes LINEWIDTH/2, not LINEWIDTH). It now also returns `mR` —
  reach from the VISUAL centre, which is the radius the two spinning panels pivot about — and
  `pX/pY/pR`, the same three figures in the offscreen canvas's own pixels, because both panels
  were mixing reference units and pixels in one expression. `test/client.js` asserts the invariant
  by reading coordinates back out of `drawings.js`'s own draw calls through a transform-tracking
  context, so it cannot be satisfied by recomputing setCoord's arithmetic a second way.
- **The death screen sized its canvas to the sprite's own square** and then rotated the sprite
  inside it (−π/8), losing everything past the inscribed circle, and wrote the class name into
  that same width — which is why "Necromancer" lost both ends. It now sizes to `pR` plus a real
  band for the name.
- **Smasher and Sprayer were each one tier early.** `exports.tree`'s index IS its level gate
  (`upClass()` unions every tier up to `parseInt(level/15)`), which is what lets two edges out of
  the same parent open at different levels: Basic→Smasher is now a level-30 edge and Machine
  Gun→Sprayer a level-45 one, with Smasher's own children moved down with it so a Basic can't take
  Smasher and Spike in the same breath.
- **A bullet only brakes if it hit something.** diep's deletion animation halves velocity per tick
  so a projectile dies where it HIT; applying that to one that ran out of `life`, or that was shot
  down by another projectile, brakes it in mid-air for no reason. `Bullet.impactDeath` is set at
  the four arms that destroy against something solid (tank/boss, shape, Maze wall, base fence) and
  nowhere else.
- **Enter respawns you on your first dead tick.** The old gate made you wait out `tick.DES` AND
  `config.DEAD_DELAY`, and because the request is a one-shot keyup an early press was dropped
  rather than queued — so it read as "Enter does nothing", not as a cooldown. `dead` and `destroy`
  are written at the same moments everywhere, so the gate is now just `!tank.dead`.

## Settled by the fourth issues.md pass (Batch C/D session, kept only for the nuance)

- **Mothership's own odd-numbered drones (type 1.1) were never exempt from same-team collision.**
  `rooms/Room.js`'s `SAME_OWNER_TYPES` had 1/1.5/2 but not 1.1 - the exact "mothership should be
  able to overlap with its own drones" bug, half-fixed (the even/type-1 barrels already passed
  through). Added 1.1 to the set.
- **BattleShip's real swarm barrels (types 1.2/1.3, `TanksConfig.js`'s `BattleShip`/`Fortress`
  entries) carried NEITHER team-collision flag at all** - `NO_OWN_TEAM_TYPES` had a `3` under a
  stale "swarm" comment, but type 3 is actually the Necromancer's own drone (which itself needs
  the OTHER flag, `onlySameOwnerCollision`, per `NecromancerSquare.ts` - it was in the wrong set
  too). Net effect before this pass: a BattleShip's own drones could damage/knock back their own
  owner and teammates in every mode without `rules.teamPlay` (i.e. FFA), and a Necromancer's drone
  passed through teammates it should still jostle. Reclassified: `NO_OWN_TEAM_TYPES = [0, 1.2, 1.3,
  4]`, `SAME_OWNER_TYPES = [1, 1.1, 1.5, 2, 3]`. Pinned in `test/rooms.js`.
- **Ordinary tank-body-vs-tank-body knockback was diep's full 1.6 gu/loop** (issues.md: "everything
  feels so bouncy"). Tuned to `entities/Player.js`'s new `BODY_KB_GU = 1.0`, a deliberate departure
  (README.md's "Departures from diep") - the positional overlap resolution is untouched, so
  enemies still can't stack.
- **Trapper Dominator's traps were never actually immortal** - confirmed no code anywhere reads
  `.dominator` inside a trap's own damage path; the perceived immortality was never reproduced.
  Pinned by a `test/rooms.js` check so nobody re-opens it without evidence.
- **A god-mode Necromancer could not claim squares.** `entities/Player.js`'s `if (this.dev.god)
  {...; return;}` returned before the switch that spawns the necro-drone ever ran, while the
  SQUARE's own side of the interaction (`entities/Objects.js`) doesn't check god mode at all and
  destroyed itself regardless - so the square would just vanish with no drone to show for it.
  Factored the spawn logic into `Player.claimSquare()`, called from both the ordinary
  `KIND.OBJECTS` arm and the god-mode branch.
- **A necromancer's drone was always the flat beige/"necro" colour, even in TDM.** `rooms/Room.js`'s
  `bulletColor()`/`ownBulletColor()` special-cased `type === 3` to color 9 unconditionally; now only
  outside `rules.teamPlay`, matching diep_wiki's "though it otherwise duplicates the [team colour]
  in all non-FFA modes".
  (The square-kill spawn mechanic itself, and the drone-chain/bullet-chain claim paths in
  `entities/Bullet.js`, were already correct when checked directly against the real collision pair
  loop - not reproduced as "completely broken".)
- **Overseer/Overlord's symmetric drone batching (2-at-a-time / 4-at-a-time, capping the last
  partial batch correctly) was already correct** - every barrel of either class shares one
  reload/offTime, so they become ready on the same real tick, and `Player.shoot()`'s per-barrel
  drone-cap check (evaluated barrel-by-barrel within that tick) already both fires them together and
  stops exactly at the cap. Verified empirically (Overseer: batches of 2,2,2,1; Overlord: 4,4) and
  pinned by `test/rooms.js`'s `droneBatchTests()` - no code change.
- **A Factory's Minions (type 1.5) shared `droneSteer1` with every other drone type**, so left/
  right-click just flew them straight at/away from the cursor - literally the "will just ram
  targets" behaviour diep_wiki says the Factory does NOT have. Added a Minion-only three-zone field
  in `entities/Bullet.js`'s `droneSteer1` (left-click: attract beyond World.gu(16), orbit between
  that and World.gu(16)/sqrt(7), back off inside it; right-click: repel beyond World.gu(18), spiral
  between that and World.gu(5), cluster toward the cursor inside it) - diep_wiki's own measured
  squares, cross-checked against `Minion.ts`'s `FOCUS_RADIUS = 800**2` (800 du = 16 gu exactly).
  Movement and aim still share one `dir` field (the existing architecture for every drone type), so
  the wiki's "aim outward while clustering" nuance in the star formation isn't separately modelled -
  the drones cluster together but don't specifically face outward while doing it.

## Still open from issues.md (second batch)

Not started, in rough descending order of how visible each is. Each is a real, specific job, not a
research question - the source for every one of them is cited here so nobody has to re-find it.

- **Boss geometry re-derivation, all at once.** `Summoner.ts`/`Guardian.ts`/`Defender.ts` each set
  `physicsData.size = <NAME>_SIZE * Math.SQRT1_2` (SUMMONER 150, GUARDIAN 135, DEFENDER 150), which
  is the same `x sqrt(2)` circumradius identity `Drawings.obj` already uses and the thing
  `bossSize` still conflates. Summoner additionally draws 45 degrees out of true (`sides: 4` drawn
  vertex-up instead of edge-up). Defender is oversized, its trap-launcher stubs are far too long,
  and its three AutoTurrets must draw ON TOP of the body scaled so their bullets match the turret
  (`AutoTurret.ts`: size 55, width 42*0.7, recoil 0.3, bullet sizeRatio 1). The user supplied
  measured proportions for all five bosses in issues.md - cross-check against those, they are the
  acceptance test. `Defender_boss_3.webp` at the repo root is the reference render.
- **Factory geometry**: square body (`sides: 4`), trapezoid spawner, `MinionBarrelDefinition` size
  85 / width 50.4, drone `size *= 1.2`. (The AI half - `ai.viewRange = 900`, `FOCUS_RADIUS = 800**2`
  circle-and-attack, the right-click cluster - is done, see "Settled by the fourth issues.md pass"
  below. This is drawing-only now, Batch B territory.)
- **Skimmer** (`Skimmer.ts`): `SkimmerBarrelDefinition` size 70 / width 42, two opposed sub-barrels,
  drawn BELOW the main bullet. `skimmerandbullet.png` at the repo root is the reference, with
  measured proportions in issues.md.
- **Guardian drones** should be visually indistinguishable from a small Crasher - same triangle,
  same `bull`/Color.EnemyCrasher pink, `sizeRatio 21 / (71.4/2)` off a 71.4-wide barrel.
- **Auto 3 / Auto 5 turrets** must not overlap the body and are constrained to their grey ring.
- **Dominator**: the cosmetic trapezoid barrel wants the same z-order the attacking barrels got
  (under the circular body, over the black hexagon). (Trap destructibility - the other half of this
  entry - is done, see "Settled by the fourth issues.md pass" below.)
- **Maze**: choose the player spawn area AFTER the walls are generated so a spawn inside a wall is
  impossible, and remove the remaining minor wall-on-wall visual overlap.
- **Base drones overshoot** a target they cannot kill quickly, circling too fast - left alone this
  pass (Batch C/D session): `BASE_DRONE_CHASE_SPEED`/`_CHASE_TURN` are diep-derived (756 u/s flat,
  a turn radius pinned to one tank diameter - `lib/config.js`'s own citations), not ad-hoc tuning
  knobs, and the user's own issues.md line is explicitly unsure ("should this be fixed... idk").
  Retuning either without a browser session to confirm what's actually wrong (speed vs. steering vs.
  intended-and-just-looks-odd) risks trading a real diep number for a guess. Still needs the human
  browser session PENDING #6 already asks for.
- **A gamemode switcher on the death screen.** Not started. It is not a drawing job: `ui.js`'s
  `END` is canvas-only with no hit-testing of its own, and the only path into a different mode is
  `POST /play` (`web/app.js`), which sets the `preference` cookie and re-renders `play.ejs` — so
  this needs a click region, a form POST or an equivalent navigation, and a decision about whether
  the socket closes cleanly first. The "Enter respawns immediately" half of the same issues.md
  line is done (`rooms/Room.js`'s `respawn()` gate, pinned by `test/rooms.js`).
- **Intro options screen** tries to slide down, fails, then snaps into place.
- **Trap/drone-spawner recoil** (issues.md "incredibly incredibly small", "1/10th of a tile") was
  **already settled** by the `back`-column rescale and is left alone deliberately. Every trap and
  drone barrel in diep carries `recoil: 1` (`TankDefinitions.json`) — the same figure a Basic
  carries, against Destroyer's 15 and Annihilator's 17 — and this tree's own identity
  `back = recoil × 0.4 × 2.8` puts all of them at 1.12, i.e. 0.4 grid squares of total
  displacement per shot. Moving it to the eyeballed 0.1 would break that anchor for one class
  family only. If 0.4 really does read as too much in a browser, the thing that is wrong is the
  whole column's scale (and `Physics.FRICTION` with it), not the trapper rows.

## Test determinism

- **`test/rooms.js`'s "idle drift (no live DETEC target) is unaffected by the chase rewrite"
  fails roughly 1 run in 14** — pre-existing, confirmed against a clean tree. The Crasher it
  builds takes a random spawn point, so whether its idle path trips `Objects.update()`'s
  edge-avoidance turn (and the `HOME_PULL` oscillation around it) is a coin toss. Pin the
  shape's `x/y/rx/ry` before the loop to make it deterministic.
- **`test/rooms.js`'s "a drone that kills a shape on contact still takes its level change from
  the hit" fails roughly 1 run in 17** — same family, same fix. It parks a nearly-dead square one
  step ahead of a base drone on its own ring and then steps a real 4team room for 120 ticks; the
  drone's ring phase and every OTHER shape in that room come from an unseeded RNG, so the drone
  can be pulled off the meeting (a chase, a wall, another shape) before it arrives. Observed once
  in 17 consecutive runs while the batch below was landing, then not again in 16. Pin the room's
  RNG, or the drone's ring phase, before the loop.

## Untested — nobody has watched these happen

A full match start→finish; two humans in one room; boss AI vs a live human; chat over a real
socket; packet-length validation from a real browser; several busy rooms at once; the full
signup→login round trip. Plus the standing in-browser checklist: bullets leaving the muzzle
under hard strafe, camera feel, recoil/knockback magnitudes against the grid, base-drone
behaviour around bases, each mode's win/close flow, the accounts/achievements panels. (The old
75-line expansion of this list died with the graphics rewrite plan — re-derive from plan.md's
Part F eyeball pass when the silhouettes land.)

## Tooling notes worth not rediscovering

- **`test/clientDiff.js` seeds ONE RNG across four rooms in sequence** — a change to how many
  entities exist (or how long one lives) shifts every later mode's positions. Isolate causes by
  overriding the suspect constant at load time and re-running once per candidate. Rebaseline
  deliberately, with the reason in the file header.
- **Grep for the old number, not the constant name** when a value moves. Known near-collisions:
  Gunner `speed 0.511936` vs retired `MOVE_ACCEL_BASE 0.511941`; retired impulse `0.43881` vs
  bullet `speed 0.438816` shared by eight drone/trap cannons.
- **`motion()`/`update()` replacement is a three-way pattern** — `createBoss()`, Tag's
  `createCloser()`, `createDominator()` all bind their own pair at spawn and never reach
  `Physics.stepBody`; any new entity built this way inherits that.
- **Get the `lib/tick.js` category right** — it never fails loudly. An impulse into a
  `stepBody` body is `impulse()`; into a self-integrating body (`Bullet.js`, `Objects.js`) it's
  `perTick()`.
- **A test that only compares our two halves against each other cannot catch a scale error** —
  anchor at least one assertion outside the tree (plan.md Part F).
