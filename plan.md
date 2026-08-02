# plan.md — the full diep-fidelity pass (graphics, mechanics, bosses)

The previous plan.md (the 0.56→0.70 rescale pass, R1–R11) ran to completion and was deleted.
This plan is built from a fresh audit of the tree against the sources of truth, plus a playtest
bug list. **Sources of truth, in order:** `diepcustom/src` (server behaviour + all numeric
definitions), `diepindepth/` (client/canvas RE), `diep_wiki/` non-fanon pages (secondary
verification only), the six reference `.webp` screenshots in the repo root (Dominator ×3, Spike,
Skimmer, Mothership, Auto 3). Deliberate departures from diep are listed in README.md — do not
"fix" those.

**Unit table (unchanged, do not re-derive):**
| quantity | conversion |
|---|---|
| absolute length (arena, body radius, `bossSize`) | 1 du = 0.56 units |
| barrel/turret fields divided by `CONST.SIZE=35` (`height`/`width`/`offx`/`distance`/`rad`, server `canonLength`/`can.size`) | 1 du = **0.70** units |
| boss barrels | ×`35 / BOSS_BASE_SIZE` against the boss's own base size, not 50 |
| time | raw constants are per 40 ms reference tick, converted via `lib/tick.js` |

Verification rule (standing): any change to a drawn quantity needs at least one assertion
anchored *outside* our tree (`test/tanks.js` vs `diepcustom/src/Const/TankDefinitions.json`),
and any change to a rendered silhouette should be eyeballed against the reference webp or the
wiki's non-fanon tank image.

---

## Part A — client rendering rules we currently get wrong everywhere

These are one-time mechanisms; most of Part B falls out of them.

### A1. Z-order is diep's, not ours
diep is a scene graph with explicit z-order; flattened into our draw calls the order per tank is:

1. **Guards** (smasher hexes, spike triangles, dombase) — bottom. *(already done)*
2. **Auto-turret ring barrels** (Auto 3/5) — under their own base circles AND under the body.
3. **Auto-turret ring base circles** (the grey circles) — above their barrels, under the body.
4. **preAddon `launcher`** (Skimmer/Rocketeer nub) — under the barrels.
5. **Cannons** (main barrels; within a class, array order = draw order, first = bottom).
6. **postAddon `pronounced`** (Ranger's trapezoid) — above the barrel, under the body.
7. **Body** on top of all of the above.
8. **Centered auto turrets** (Auto Gunner/Trapper/Smasher/Auto Hover, `dompronounced`, Dominator
   barrels, Defender's turrets) — `showsAboveParent` stays ON → above the body.

Today [render.js](public/client/render.js#L114-L132) draws ring barrels *after* the body (step 8
instead of 2/3) and has no pronounced slot. Fix: give each turret/cannon entry an
`aboveBody: true/false` (default per the table above) and split the render loop into a pre-body
and post-body pass. The Auto 3 webp (`Auto_3.webp`) is the reference: barrel under grey circle,
both under the hull, which is also what creates the visual ±90° arc limit.

### A2. The trapezoid taper is ~5/3, and `trapezoidDirection` is inverted for Stalker
Pixel-measured from the reference images (2026-08, PIL width-profiles along the barrel axis):
the wiki's Mothership render gives tip/base ≈ 1.7–1.8 after stroke correction, and the Trapper
Dominator launcher flare gives 1.66–1.70 (stroke-robust, both ends equally inflated). **Use
wide end = width × 5/3 ≈ 1.667**; if the browser eyeball pass reads it as too narrow, the only
other candidate is 1.75. It is definitively NOT our current 0.4×
([drawings.js:161-162](public/client/drawings.js#L161)) and NOT 2×. (Corrected from the user's
"Mothership barrels span the full side" — measured: 10.5 du base tapering to ~17.5 du at the
tip vs a ~19.5 du flat side; *nearly* full at the muzzle, not literally full.)

Caveat on the reference webps: they are wiki **recreations**, not screenshots — reliable for
shape *ratios*, unreliable for absolute scale (the Trapper Dominator one draws its launchers
~3.5× the definition width). Numbers come from diepcustom; the images only settle shapes.

- `trapezoidDirection: 0` (Machine Gun, Sprayer's MG barrel, all drone spawners, Mothership,
  Guardian/Summoner spawners): **wide end at the muzzle**.
- `trapezoidDirection: π` (Stalker, Rocketeer, Battleship): **wide end at the base, narrow at
  the muzzle**. Our Stalker currently renders the flare outward (user-visible "concave" look);
  diep's Stalker is a straight taper 42 du at the hull → narrower tip over a 120 du barrel.

Fix `Drawings.cannons[2]`: `baseHalf/tipHalf = w/2` and `w` (×2 total) per direction, and audit
every `td` flag in the client table against `TankDefinitions.json`'s `trapezoidDirection`.
Machine Gun / Necromancer / Overseer / Overlord / Manager / Factory currently fake the trapezoid
with `open` flares on a type-0 barrel — migrate them to type 2 so the taper ratio is uniform.

### A3. `trapLauncher` — every trapper barrel is missing its cosmetic launcher
diep's trap barrel is a **short plain rectangle** (`size 60`, i.e. height 42 ours) plus a
`TrapLauncher` child ([BarrelAddons.ts:49-74](diepcustom/src/Entity/Tank/BarrelAddons.ts#L49)):

- launcher **width = barrel width** (at its base), flaring **wide side outward** to
  `width × 5/3` at the mouth (A2's measured ratio — the classic "arrowhead");
- launcher **length = barrel.width × 20/42** — pixel-verified: the Trapper Dominator reference
  image's flare length / neck width = 0.46, matching 20/42 = 0.476 almost exactly;
- centered on the barrel tip: it spans `barrel.height − len/2 … barrel.height + len/2`, so the
  visible result is a plain neck, then a flare replacing the last `len/2` of barrel and
  extending `len/2` past it.

Our Trapper/Mega Trapper/Auto Trapper/Overtrapper/Tri-Trapper/Gunner Trapper/Trapper Dominator
instead draw a type-1/2 "flared muzzle" (`open`/`openlength`) with **no launcher** — the stubby
look. Fix: every `bullet.type: "trap"` barrel client-side becomes
`{type: 0, height: 42, width: <w>, trapLauncher: true}` and `drawTrapLauncher` gets diep's
geometry (today it uses 0.458/0.235 of width and doesn't extend past the tip properly).
Defender's trap turrets (already type 2) are the look to match — user confirms those are right.
Sizes per class from `TankDefinitions.json` × 0.7: Trapper/Auto/Over/Tri 42×29.4; Mega Trapper &
Gunner Trapper rear 42×38.22; Trapper Dominator 42×14.7.

### A4. `pronounced` (Ranger) — a postAddon, not a second cannon
[Addons.ts:293-316](diepcustom/src/Entity/Tank/Addons.ts#L293): a barrel-coloured trapezoid,
`size 50/50 × owner`, `width 42/50 × owner`, offset `40/50 × owner` forward, `angle π` (so its
**wide side points backward/under the body, narrow side out**). In our units (×35 reference):
length 35, width 29.4, centre offset 28 — so it spans 10.5…45.5 from the hull centre: only the
last ~10 units peek past a 35-radius body, exactly the user's "6px stub out of a 48px tank".
It draws **above the main barrel, below the body** (A1 step 6).

Our Ranger currently fakes it as a second cannon `{h 56.25, w 75, open −30}` — delete that and
add a real `pronounced` overlay (same drawing family as `launcher`). Verify the main barrel
stays 84 long (120 du) underneath, poking out past the trapezoid.

### A5. Menu-screen tanks must use the real table
`public/font.js`'s `tank()` has its own private hardcoded CLASS table ("Basic" h60 w24,
"Doble" twin h60 w22 offx15, "Pilote", …) — that's why the menu Twin/Basic/Ranger look wrong
regardless of TanksConfig fixes. Replace the private table with lookups into
`TanksConfig.class` + `Drawings` (the file already loads after TanksConfig on the menu page, or
can). Any decorative fictional classes there can be re-expressed as real classes.

---

## Part B — per-class silhouette fixes (client table)

All heights/widths below are diep `TankDefinitions.json` × 0.7 unless noted. Current values
verified by dumping the live client table; ✓ means already correct, only the listed fields move.

| class | fix |
|---|---|
| **Basic / Twin** | table is correct (66.5×29.4, Twin offx ±18.2 — ours has 18, nudge). The "too short" complaint is the **menu** (A5). |
| **Triple Shot** | angles `±0.4` → **±π/4 (0.785)**; `offx ±6` → **0**; all three h 66.5 ✓. Draw order (side pair first, centre last=top) already matches diep's definition order. |
| **Penta Shot** | angles `±0.6/±0.3` → **±π/4 / ±π/8 (0.3927)**; `offx ±7/±3` → **0**; heights 56/66.5/77 ✓. Server fire delays must be centre `0` → inner `0.33` → outer `0.66` (id14) — verify `offTime` matches, the user reports the 3-phase pattern missing. |
| **Spread Shot** | heights/widths ✓ (45.5→66.5, w 20.58, centre 29.4). **Array order wrong for draw**: must be outermost pair first → … → centre **last** (drawn on top); ours currently ends with the +1.309 outer barrel, so the fan stacks the wrong way. Reorder the client array (and keep server delays paired: outer 0.833 → 0.667 → 0.5 → 0.333 → 0.167 → centre 0). |
| **Battleship** | 4 barrels **75→52.5 long**, width **29.4×0.7=20.58** as real type-2 trapezoids, `trapezoidDirection π` (wide at hull, narrow at muzzle — kill the `open −16` spike), `offx` **±20×0.7 = ±14** (ours ±12). Two barrels per side, one controllable + one auto pair (server `canControlDrones` split id48) — swarm drones sizeRatio 0.7. |
| **Sprayer** | it currently renders as a 5-barrel Streamliner. diep Sprayer (id29) is **2 barrels**: `[0]` inner straight barrel h **77** w 29.4 (bullet sizeRatio 0.7, delay 0.5, reload 1) drawn first/under; `[1]` the Machine Gun trapezoid h **66.5** w 29.4 (reload 0.5, scatter 3) on top. Visible inner portion = 77−66.5 ≈ user's "12×33px poking out". Delete c[2..4] both halves. |
| **Streamliner** | heights 77/70/63/56/49 ✓ w 29.4 ✓ (5 barrels, delays 0/0.2/0.4/0.6/0.8, reload 1 — verify server cadence; all five fire). The look should be stacked rectangles all starting at the hull — compare against diep image; no gap mechanic exists in the definition, the perceived gaps are the outline strokes. |
| **Stalker** | A2's direction fix (wide base → narrow tip), h 84 w 29.4 ✓. |
| **Necromancer** | body: real square (`sides 4`, diep baseSize `32.5√2` du — 0.919× a circle tank's radius; our roundRect 0.95/1.05 is close but should become the n-gon path with the √2 vertex identity so barrels seat right); barrels → type-2 trapezoids direction 0 (wide at muzzle), h 49 w 29.4, at ±π/2 ✓. Barrel visibly protrudes ~17 units past the flat side; today the `open` fake + roundRect makes them look swallowed. |
| **Ranger** | A4. |
| **Trapper line** | A3 (Trapper, Mega, Auto, Overtrapper, Tri-Trapper, Gunner Trapper rear barrel). |
| **Skimmer** | body barrel 56×49.98 ✓ + `launcher` preAddon ✓. Projectile: the type-4 sprite's sub-barrels must not overlap the main circle — diep's Skimmer sub-barrels are their own `size 70` barrels scaled by `skimmerSize/50`, so their visible span starts at the bullet's edge and **sub-bullets spawn at the sub-barrel tip** (`Bullet.ts:100`: spawn at parent pos + barrel length along shoot angle) — never inside the main bullet. Server: spawn sub-bullets from the rotated barrel tip (offset = skimmer radius + subBarrelLen), not from the skimmer centre. Also: launcher trapezoid on the *tank* barely peeks past the main barrel (`65.5√2/50` long, wide side out) — verify against `Skimmer_Screenshot1.webp`. Skimmer spins ±0.1 rad/tick, direction flips with right-click at fire time (`Barrel.ts:163`). |
| **Auto 3 / Auto 5** | A1 z-order (barrel under circle under body), mount `0.8 × size` ✓, ±90° arc + click-to-aim (already server-side per old R9 — verify), turret 38.5×20.58 rad 18 ✓. |
| **Smasher line** | guards data ✓ (hex 1.15, landmine ×2, spike 4×tri 1.3). Three fixes: **(a)** guard colour, pixel-verified from the Spike reference image + `Enums.ts` `Color.Border`: **fill `#555555`, stroke `#404040`** (diep's universal stroke rule, stroke = fill × 0.75 — verified against every pair in `color_constants.md`), drawn as fill+stroke like any entity, NOT our current `param.tankC[1]` team-shade flat fill and NOT pure black (user's "black" corrected — it's dark grey that reads black). This one change also delivers Spike's "grey interior, thick dark outline" for free. **(b)** hexagon size: drawn circumradius = `size × 1.15` → hex flat side = `1.15·cos30° = 0.996 × size`, i.e. the flat sits exactly at the body rim with the body outline covering it — verify ours reproduces that, per the user's description. **(c)** the **body must not rotate** — smasher-class hulls never visibly spin, only the guard hexes at their own rates (and the class-picker icons must be static, see C7). |
| **Arena Closer** | barrel 52.5×29.4 ✓. Behaviour fix in C10. |
| **Dominators** | see Part E. |
| **Mothership** | see Part E. |

---

## Part C — mechanics

### C0. Regenerate the whole server bullet-stat table from `TankDefinitions.json` ⭐
Audited 2026-08: the per-barrel bullet multipliers are a mix of eras. Verified examples —
Fighter's side barrels are exact (`damage 5.6 = 7 × 0.8` ✓) but **Booster's four rear
thrusters bake `damage 3.5` where diep is `7 × 0.2 = 1.4`** (2.5× too strong); Twin Flank bakes
`5.25` vs diep `3.5` (1.5×); Octo/most front barrels sit on a third scale (~×0.825). The `pene`
column has the same disease (Booster front 1.588 vs rear 0.706 where diep has both barrels at
`health 1`). Booster's recoil is per-barrel wrong too: diep gives the upper-rear pair
`recoil 0.2` and only the lower pair `2.5`; ours bakes 2.408 on all four (`back` column —
diep gu × 2.8 → should be 0.56 / 0.56 / 7.0 / 7.0… careful: `back = recoil_gu × 2.8` where
recoil is diep's `recoil` field directly).

**Do not hand-patch class by class.** Write a one-off generator script that walks
`TankDefinitions.json` and emits every diep-native class's server rows from the identities:

| column | identity (0 stat points baked; the shared up-curve carries the points) |
|---|---|
| `damage` | `7 × bullet.damage` (diep `(7 + 3·BD) × bullet.damage`, Bullet.ts:92 — a multiplicative up factor `(7+3p)/7` distributes correctly) |
| `pene` (bullet HP) | `2 × bullet.health` on our HP axis (diep `(2 + 1.5·BP) × health`, Bullet.ts:91) |
| `speed` | `1.12 × bullet.speed` (existing identity) |
| `life` | `75 × lifeLength` (bullets), drones `88×`/∞, traps `(600·L)>>3` |
| `size` | `(width/2) × sizeRatio × 0.7` |
| `back` | `recoil × 2.8`, **per barrel** |
| `reload` | `15 × barrel.reload`, per barrel (Fighter side barrels 22.5, Gunner Trapper rear 45, …) |
| `rand` (scatter) | `scatterRate` through the existing conversion |

Diff the generator's output against the live table, take diep's number everywhere the class is
diep-native, keep documented stand-ins (README departures / PENDING stand-in list) untouched.
Then F2's test asserts the whole thing stays pinned. This one item is what makes "Booster back
turret bullets much weaker than its front" and every similar per-barrel asymmetry correct
tree-wide, permanently.

### C1. Bullet spawn point, size, and death animation
- **Spawn**: diep spawns the bullet's **centre at the barrel tip**:
  `pos = tank + cos(angle) × barrelLength (+ offset ⊥, + distance)` ([Bullet.ts:100](diepcustom/src/Entity/Tank/Projectile/Bullet.ts#L100)).
  Ours reportedly spawns outside the tip — audit `entities/Player.js`'s `shoot()` spawn maths
  against this exact expression (server) *and* the client muzzle-weld origin; both must use
  `canonLength` (=drawn height), no extra bullet-radius padding.
- **Size**: `bulletRadius = (barrelWidth / 2) × sizeRatio` (`Bullet.ts:77`) — `sizeRatio` is 1
  for most classes, so **bullet diameter = barrel width** and the bullet visually plugs the
  muzzle. The exceptions are per-barrel and carried by C0's generator, not special-cased:
  Hunter/Predator/Streamliner/Sprayer-inner 0.7, Gunner Dominator 0.6, traps 0.8 (Mega Trapper
  1.28), Battleship swarm 0.7, Fallen Overlord drones 0.5, Guardian's crasher-sized drones,
  Minion ×1.2 body. F2 asserts `can.size == width/2 × sizeRatio × 0.7` for every barrel in the
  roster.
- **Death**: diep's deletion animation is **6 ticks** (~240 ms): each tick `scale ×1.1`,
  `opacity −1/6` ([Object.ts:30-61](diepcustom/src/Entity/Object.ts#L30)). A bullet that dies on
  a Pentagon must start this on the tick it dies — the client today keeps animating the corpse
  much longer ("continues way past"). Wire truth: server should broadcast the death tick
  promptly; the client fade should be ≤240 ms and grow-while-fading, then remove. Also stop
  dead-reckoning a bullet the moment its death state arrives.
- **Lifetime**: `lifeLength × 75` ticks (bullets), drones `88 ×` or ∞, traps `(600 × L) >> 3`.
  Already ported (life 75) — leave.

### C2. Upgrade points: the 6-segment fallback bug
`ui.js:1124` passes `CLASS[User.class].statMax || 6` — every non-smasher class draws **6**
segments. `MAX_PER_STAT` is 7 everywhere else. One-character fix (`|| CONST.MAX_PER_STAT`), plus
a client test asserting the panel segment count for Basic is 7.

### C3. Smasher-class stat panels
diep (`TankDefinitions.json` stats): Smasher/Landmine/Spike = Movement/Body/MaxHealth/Regen at
**10**, the four bullet stats at **0** (disabled); **Auto Smasher = all eight at 10**. Verify our
`statMax` tables match exactly (Auto Smasher must not have any 0 rows), and that the server
rejects points into a 0-cap stat.

### C4. Sandbox `K` levelling speed
diep grants **+1 level per input packet** with the levelup flag ([Client.ts:313-320](diepcustom/src/Client.ts#L313)) —
effectively one per tick while held (~25/s), so 1→45 takes under 2 s.
Ours throttles to one per `SANDBOX_LEVELUP_TICKS = tick.ticks(5)` (200 ms) — change to 1
reference tick (40 ms).

### C5. XP curve / level economy (verify only)
Score to reach level *n+1* adds `40/9 × 1.06^(n−1) × min(31, n)` (`Enums.ts:301`); stat points =
`level−1` up to 28, then `floor(level/3)+18` (Camera.ts:168) — 33 at 45. Our `pointsAtLevel`
claims this shape; add the closed-form table to `test/rooms.js` as an anchored assertion.

### C6. Class-picker slide behaviour (level 30 → 45)
diep keeps existing option cards in place and **new options slide in alongside**; ours empties
and re-fills (`ui.js` TNK: `show=-.5; hide=0` → waits for `dshow<0.01` → swaps `choices`),
causing the fly-out/fly-back. Fix: diff `tochoices` vs `choices`; keep common entries where they
are and animate only the added rows (per-row `dshow`), no global hide when the previous set is a
subset of the new one.

### C7. Smasher-class icons must not spin
The class-picker/menu icons currently render the whole cached sprite spinning (or bake `dir`
into the body). Smasher-line bodies are featureless circles — the *hull* never visibly rotates;
only guard hexes spin. Ensure `param.dir` rotates barrels/turrets, never the plain circular
body, and picker icons render with a fixed dir and (ideally) static guards.

### C8. Invisibility (Stalker / Landmine / Manager)
diep applies per tick: `opacity −= invisibilityRate`, `+= visibilityRateMoving` while any
movement input, `+= visibilityRateShooting` **each tick the fire input is held** (TankBody.ts:347-355),
plus `+= visibilityRateDamage` on being hit. Rates: Stalker/Manager decay 0.03 (full invis
~1.3 s), moving 0.08, shooting 0.23 (Manager 0 — shooting doesn't reveal it); Landmine decay
0.003 (~13 s), moving 0.16, shooting 0. Ours adds the shooting term per *shot event*, not per
held tick, and needs the damage-reveal term. If invis still "feels" instant after this, the
numbers are right and the feel item moves to the browser-session list.

### C9. Predator zoom (right-click)
`TankBody.ts:338-345`: while right-click is held, camera locks to a point **1500 du in the
mouse direction from the tank**, set once at press (`usesCameraCoords`); released → camera
returns to the tank. Your tank can walk out of that locked view — that is diep's behaviour.
Needs: an input path for right-click (wire has mouseR?), a `usesCameraCoords`-style camera
override in `getBuffer()`/client camera, and the flag is already data-recorded
(`flags.zoomAbility`). Also Overseer-class right-click repel is a separate existing mechanic —
make sure the two don't collide (zoom only for `zoomAbility` classes).

### C10. Arena Closer under player control must not auto-fire
Our AC cannon carries `auto: 1, autoShoot: 1, autoDir: 1` in the class table, so a sandbox
player's AC aims and fires itself. In diep the AC is an ordinary tank; the *AI* aims it, and a
possessed one uses the player's inputs. Move the auto behaviour out of the class table and into
the spawn site (`lib/gameAI.js`'s CLOSER binding), so the class itself is clean when the
sandbox cycler hands it to a player. Same review for the Dominator classes (sandbox-cycled
Dominators should fire where the player aims; Trapper Dominator keeps `forceFire` — it always
fires, but from *all 8 barrels radially*, see E2).

### C11. Drones pass through same-team players
diep drones/traps/minions set `onlySameOwnerCollision` (Drone.ts:57) — they collide with their
**owner's** own entities and enemies, and pass through teammates (and in FFA, a drone never
bodies its own owner either). Ours suppresses same-team *damage* (`noDam`) but the physical
push/knockback paths in `entities/Bullet.js`'s collision arms still resolve. Fix: early-return
the whole pair (no damage, no impulse, no positional resolve) for same-team drone↔player and
drone↔drone-of-different-owner… precisely: same-team pairs skip everything unless both sides
share an owner (diep's flag semantics). Base drones already do this ("transparent to its own
side") — generalise that path.

### C12. Crasher spawning
diep: crashers exist **only in the Crasher Zone** (the ring where `max(|x|,|y|) < R/5` minus the
pentagon nest `R/10`), spawned by the same "keep N shapes alive" fill as everything else — no
timed spawner, no spawn-near-player logic; 20% large. Chase: viewRange **2000 du (=1120 units)**,
target re-scan every 25 ticks, speed 2.602/2.64 du/tick. Audit `rooms/Room.js`'s crasher spawn
(rate + location) against this — "too fast, too near people" suggests ours spawns them on a
timer or outside the zone. The refill cadence should be the shared `generate()` slot pass, not a
crasher-specific timer — and crasher **density** is just the zone's share of the global shape
budget (a spawn only becomes a crasher because its random point landed in the zone); no separate
crasher count/rate knob should exist. If ours has one, delete it.

**OOB chase**: a chasing crasher must be able to follow a player out of the arena into the
dark-grey band and hit them there — the same `config.OOB_MARGIN` allowance tanks and chasing
base drones already get (diep's crashers carry `canMoveThroughWalls` and aren't clamped while
chasing, `Crasher.ts:44`). Ours presumably clamps them at the arena edge; unclamp while chasing,
re-clamp when idle so strays drift home.

### C13. Maze walls: culling, darkness, minimap
- **Culling**: walls must render whenever their rect intersects the viewport **plus a buffer**
  (diep client keeps entities until out of `usesCameraCoords` view + margin). Ours drops them
  while still visible — the server-side viewer query for `Walls` needs the wall's full AABB (not
  its centre) against the buffer rect, and the client should keep last-known walls until told
  otherwise (they never move).
- **Colour**: diep maze walls are the grid-grey `Color.Box` family, drawn *lighter* than our
  current near-black — take `diepindepth/canvas/color_constants.md`'s wall/border value.
- **Minimap**: draw each wall rect scaled exactly `wall.w / arenaW × mapW` (proportional);
  ours inflates them ("bloated"). One clamp: minimum 1 px so thin walls stay visible.

### C14. Shapes: health bar + regen
diep shapes have **no regen** (`regenPerTick` stays 0 for shapes) and health bars hide when at
full HP; the bar renders only while damaged (and diep hides bullets' bars entirely).
Decision (user): keep **our** slow shape self-heal as a departure, but make the health bar
behave: fade it out after ~2 s without damage (the existing hpAlpha fade path), let the shape
keep healing invisibly, bar reappears on next hit. Optional follow-up: heal only after a
no-damage delay (30 s tank-style window) instead of always — pick when implementing.

### C15. Spawn shield (new, small)
diep gives a fresh spawn `isFlashing` + `damageReduction 0` until first move/shoot or 374 ticks
(TankBody.ts:95, :357). We have neither. Cheap to add server-side (a `shield` flag we already
have for god mode) + client flash on the existing damage-flash bit. Optional but it closes
PENDING #13.

---

## Part D — bosses

Shared scaffolding (diepcustom `AbstractBoss.ts`): HP **3000**, body damage 10/tick,
`absorbtionFactor 0.05`, regen `maxHP/25000`/tick, reload base `15 × 0.914⁷`, score reward
30000, view range 2000, movement: patrols the four ¾-corner waypoints, retargeting within 300 du.
Boss barrels convert at `35 / BOSS_BASE_SIZE` per boss (they are denominated against the boss's
own size). All four below are already partially in the tree — this is the fidelity spec to
finish them against.

| boss | body | armament (diep values) |
|---|---|---|
| **Guardian** | crasher-pink triangle, base 135 du, faces its movement direction | ONE rear spawner (`angle π`, size 100, width 71.4, trapezoid), reload 0.36, **droneCount 24**, crasher-sized drones (`sizeRatio 21/35.7`), drone stats h 12.5 / d 0.56 / speed 1.7, **lifeLength 1.5** (they expire — a rolling swarm boiling out of its back), `canControlDrones` (possession). |
| **Defender** | orange triangle, base 150 du, hull spins at 2× passive rotation, `viewRange 0` (never chases) | 3 **trap launchers** at the flat sides (`angle = 2π(i/3 + 1/6)`, size 120, width 71.4, `forceFire`, reload 5, trap h 12.5 / d 4 / speed 5 / life 8) each with the real trapLauncher addon (A3), **and** 3 auto turrets ON TOP of the body at the corners (mount `offset 60/(150·√½) ≈ 0.566 × size`, AutoTurret geometry 55/29.4, bullets speed 2.46 / damage 1.2 / health 5.75, `influencedByOwnerInputs`). Turrets draw **above** the triangle (A1 step 8). |
| **Fallen Overlord** | grey (`Color.Fallen`) circle, level-75 scale (`50 × 1.01^74 ≈ 105 du`) | Overlord's own 4 spawners with overrides `droneCount 7 (per barrel), reload 0.36, sizeRatio 0.5, speed 1.7, damage 0.56, health 12.5` — a permanent drone spam. Hull spins passively when idle. |
| **Fallen Booster** | grey circle, level-75 scale, `movementSpeed 1` (fastest boss — a rammer) | Booster's own 5 barrels with bullet overrides `speed 1.7, health 6.25, damage ×0.8`. Faces movement when idle, faces target when aggroed. Its threat is body damage + speed. |
| **Summoner** | yellow square (`EnemySquare`), base 150 du | 4 spawners at the flats (size 135, width 71.4, trapezoid), reload 0.36, droneCount 7 each, **square drones** (sides 4, NecromancerSquare colour, `sizeRatio 55√½/35.7`), h 12.5 / d 0.56 / speed 1.7, life ∞. **Note: diepcustom has a real Summoner** — PENDING's old "Summoner is entirely ours" claim is stale; converge our stats/body onto this table (keeping our drift/aggro engine underneath is fine). |
| **Fallen AC / Fallen Mega Trapper / Fallen Spike** (`Entity/Misc/Boss/*`) | grey variants | optional; cite from their files if/when built. |

Boss spawn schedule (`Misc/BossManager.ts` — check exact numbers when wiring): one boss at a
time, random pick, timed respawn after death. Cross-check wiki `Bosses.txt` for spawn-message
wording if you want the flavour text.

---

## Part E — Mothership, Dominators, Arena Closer (the oversized tanks)

### E1. Sizes are level-derived, verified against the images
| entity | diep source | size |
|---|---|---|
| Dominator | `Dominator.SIZE = 160` du, spawned at level 75 (visual level-120-ish by wiki lore; the fixed 160 is authoritative) | body radius **89.6 units**; `dombase` hex circumradius ×1.24 = 111 units — matches the webp's "103 px body / 112 px hex" ratio (1.087; 1.24/√…: hex flat = 1.24·cos30 = 1.074 × body ✓ user's "black extends past the flat sides") |
| Arena Closer | `BASE_SIZE = 175` du (level 300 stats) | 98 units ✓ already |
| Mothership | 16-gon, `baseSize 25√2` du at level **140** → physics size ≈141 du, drawn corner radius ≈ size×√2 ≈ 199 du | body (vertex) radius ≈ **111.6 units** — the user's 127 px vs 50 px lvl-45 tank checks out against this ✓ (current `bossSize 112.8` is right; verify the *drawn* 16-gon uses the vertex radius, not the apothem) |

### E2. Dominator fidelity (ids 45/46/47 + `Dominator.ts`)
- **All three:** `preAddon dombase` (static black hex ✓ have), stats all 0, `absorbtionFactor 0`
  (immovable), `fieldFactor 1`, HP 6000, never moves in Domination (AI `movementSpeed 0`);
  sandbox player-controlled ones may move (our departure, keep). Barrels draw **above** the hex
  (A1 — guards bottom, but Dominator barrels + `dompronounced` are post-addons ON TOP: current
  render order guards→cannons→body means the barrel is above the hex ✓ but must also be above
  the *body*? No — diep: dombase (bottom) → body → barrel + dompronounced on top. Give Dominator
  cannons `aboveBody: true`.)
- **`dompronounced`** (Destroyer + Gunner variants only): a trapezoid **above** the barrel:
  size 22/50, width 35/50 of body, offset 50/50 (i.e. its centre sits ON the rim), angle π
  (wide side outward per user: "larger side below/at the body, smaller outwards" — Addons.ts has
  angle π like Ranger's: wide side pointing back). In our units on the Dominator's own base:
  length `22×35/160 = 4.8`… **use the per-boss factor**: these addon ratios are of the
  *owner's live size*, so draw them as ratios (like guards), not baked units: len 0.44×size,
  width 0.7×size, centre at 1.0×size.
- **Destroyer Dominator (45):** one barrel 80×35 du → at 35-ref: `h 17.5, w 7.66`… again: barrel
  fields are `size × scaleFactor` where Dominator's scaleFactor = size/50 like a tank — since we
  bake per-class tables against ref 35 and scale by param.size, converting via ×0.7 is correct
  **only if** our Dominator's `param.size` equals `28×1.01^…`-style body radius: our bossSize
  89.6 with CONST.SIZE 35 → r = 89.6/35 = 2.56, h 80×0.7=56 drawn ×2.56 = 143 units ≈ 160 du×0.56×... ✓
  consistent. So: `h 56, w 24.5`, bullet h100/d10/absorb 0.1, reload 3, delay 0.001.
- **Gunner Dominator (46):** 3 barrels ALL forward: ±6 du offset (`offx ±4.2`) h `75×0.7=52.5`
  w 12.25, centre h `80×0.7=56` w 12.25, delays 0.666/0.333/0.001, reload 0.3, bullets
  sizeRatio 0.6 / h5 / d1 / speed 1.2. All three shoot the same bullets, middle slightly longer ✓
  matches user. **Fix the sandbox crash on switching to it** — reproduce via the cycler; suspect
  the `sub`/`offTime`/`ups` shape of the entry or a missing client field; add a regression test
  that class-cycles through every roster entry server-side and renders one frame client-side
  (that test also guards the whole roster forever).
- **Trapper Dominator (47):** 8 trap barrels at `i·π/4`, each 42×14.7 with trapLauncher (A3),
  `forceFire` — every barrel fires **its own trap radially**; ours currently funnels traps in
  one direction — the shoot loop must fire per-barrel along `offdir`, not along aim. reload 1.5,
  traps h20/d3/speed 4/life 3.2.

### E3. Mothership (id 27 + `Mothership.ts` + `Gamemodes/Mothership.ts`)
- 16 trapezoid barrels ✓ at half-step angles ✓, `width 7.35`, `h 42`, reload 6, recoil 0.
- **Drones:** 2 per barrel (32 total), triangle drones speed 0.48, h2/d0.7, life ∞ — drone size:
  `sizeRatio 1 × width/2 = 5.25 du × sizeFactor` — an equilateral triangle with ~16 px sides at
  the user's scale ✓ (our `can.size` should be `7.35/2 = 3.675` on the 0.7 axis ✓ from old R6).
- **Alternating control**: `canControlDrones` is **true on even barrels, false on odd** — when a
  player pilots the Mothership, half the drones obey the mouse, half stay AI. Wire this into the
  drone-control path (drones check their barrel's flag).
- **Possession**: `H` takes control (same claim flow as Dominator, E4) but a **5-minute timer**
  (`POSSESSION_TIMER = tps×60×5`) with a 10-s warning, then the pilot is kicked (their vacated
  tank has been HP-chipping the whole time, see E4). Dominator possession has **no timer**.
- Stats while possessed: all 7s except Regen 1 (Mothership.ts:66) — bake into the spawned
  instance. `absorbtionFactor 0.01` — nearly immovable but not fixed.

### E4. `H`-key piloting (Dominator + Mothership)
diep's mechanic ([Client.ts:391-418](diepcustom/src/Client.ts#L391), `possess()`):
- Press `H` → nearest same-team claimable AI (captured Dominator, own team's Mothership) is
  possessed; **your own tank's inputs are marked deleted** → it loses regen and bleeds
  `2 + maxHP/500` HP/tick until dead (TankBody.ts:324-336) — that's "at the cost of your tank".
- Your camera/pilot inputs drive the possessed entity; pressing `H` again releases (and diep
  kills the leftover). A Dominator flip (`onDeath`) force-ejects the pilot and deletes its
  in-flight bullets ✓ (we have the bullet purge).
- PENDING #2's design (input-redirect on the socket, `pilotedBy` field) is the right shape —
  implement with the HP-chip cost above, claim radius = nearest, notification on capture
  ("Press H to take control…").

---

## Part F — verification additions

1. **Roster sweep test**: for every class in `TanksConfig`, (a) server spawns it and fires every
   barrel once without throwing; (b) client draws one frame of it (stub DOM) without throwing —
   catches the Gunner Dominator crash class of bug permanently.
2. **Anchored geometry + stats test** (extend `test/tanks.js`): for every diep-native class,
   assert `height == json.size × 0.7`, `width == json.width × 0.7`, `offx == json.offset × 0.7`,
   `offdir == json.angle`, `can.size == json.width/2 × sizeRatio × 0.7`, fire delays ==
   `json.delay`, trapezoid direction flags, **and every C0 bullet-stat identity per barrel**
   (`damage`, `pene`, `speed`, `life`, `back`, `reload`, `rand`) — read live from
   `diepcustom/.../TankDefinitions.json`, with the documented stand-in whitelist carrying a
   reason string, same pattern the suite already uses.
3. **Draw-order test**: assert the pre-body/post-body pass assignment per A1 for Auto 3/5,
   Ranger (pronounced), Dominators (barrels above body), smasher line (guards below).
4. Golden rebaseline (`test/clientDiff.js`) once at the end, with the reason trail.
5. Browser eyeball pass against the six webp references + wiki images (the taper ratios A2/A3
   are the only judgement calls left — pin them to the screenshots).

## Execution order

1. **A1 z-order mechanism** (+ Dominator `aboveBody`) — everything else draws into it.
2. **A2 trapezoid ratio + direction audit** — unblocks Stalker/Battleship/Necromancer/spawners.
3. **A3 trapLauncher** across the trapper line + Trapper Dominator + Defender.
4. **A4 pronounced** (Ranger) and **A5 menu table**.
5. **Part B table fixes** (Triple/Penta/Spread angles & order, Sprayer 2-barrel, Battleship,
   offx nudges) — one commit per class family, server+client together, tests updated per F2.
   **C0 (the bullet-stat regeneration) rides with this step** — same generator, same anchored
   test, one commit of its own since it moves combat balance everywhere.
6. **C1 bullets** (spawn/size/death) — the biggest feel fix.
7. **C2/C3/C4/C6/C7** UI batch (7 segments, smasher panels, K rate, picker slide, static icons).
8. **C10/C11/C12/C13** behaviour batch (AC control, drone pass-through, crashers, maze walls).
9. **C8/C9** stealth + Predator zoom.
10. **E2/E3/E4** Dominator/Mothership fidelity + H-piloting (+ gunner-dom crash fix early if
    trivial once F1's sweep test exists).
11. **Part D bosses** to spec.
12. **C14/C15** shapes bar/regen decision + spawn shield.
13. **F tests + golden rebaseline** continuously, final sweep at the end.
