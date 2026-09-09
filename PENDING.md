# Pending & Decisions

Only what is still **open**: things needing a human call, things nobody has watched happen, and
values that look wrong until you know why they are what they are. Deliberate departures from diep
are in **README.md → "Departures from diep"**; the codebase map and load-bearing invariants (the
two frictions, `weight` vs `push`, `LETHAL_EPS`, tick categories) are in
**[HANDOFF.md](HANDOFF.md)** §3.

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
   around every base where an enemy is inside the drones' reach and nothing reacts. Ours, flagged.
7. **Sandbox gaps** — party-link invites; arena/shape scaling with player count; bosses after
   50–60 min.
8. **Comment-style cleanup pass** — strip cross-file references/change history, keep functional
   statements. Touches nearly every file; do it as its own commit. Done: `/db`, `/entities`
   (except `Bullet.js`), `/lib`, `/net`, `/views`, `/web`. Still pending: `/public`, `/rooms`,
   `/test`, `entities/Bullet.js`.
9. **Contact quantisation (D6)** — we prorate per 25 ms tick; diep exchanges once per 40 ms
   tick. Accepted approximation; the exact fix is a per-pair reference-tick guard.
10. **`prize`/coins/respawn XP** — ours (`pow(xp/mlx,1.8)`, `respawnPow 0.9`) vs diep's
    `scoreReward` + `respawnLevel = min(level−1, floor(√level × 3.2796))`. Decide per mode.
11. **`rules.crasherDensity`** — a multiplier on `crasherTotal()`'s derived Crasher cap
    (`rooms/Room.js`'s `tickArena()`), 1 everywhere except Maze (0.75): its corridors funnel a
    chased player into dead ends, so the same live count reads as far more pressure than in an
    open arena. 0.75 is a guess, not a measured figure — nobody has played it out.

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
- Sandbox self-levelling, the smasher panels, the class-picker slide-in, and silhouette
  fixes — one eyeball pass against the six reference webp files at the end.
- **B2 render, against the reference webp files:** a Guardian's drones should read as small pink
  Crashers (identical to a wild small Crasher), a Summoner's as beige Necromancer squares, and a
  Destroyer/Gunner Dominator's grey barrels AND cosmetic trapezoid should both sit under the
  unbroken gold body circle, over the black hex (`Dominator_tank_4.webp`/`Gunner_dominator_tank_2.webp`).
  All three verified in the in-Node client harness (pixel-identical crasher, correct square size,
  trapezoid-before-body draw order) but not yet with human eyes.
- **Base drones overshoot** a target they cannot kill quickly, circling too fast — needs a real
  browser session before retuning (speed vs. steering vs. intended-and-just-looks-odd). The
  numbers are diep-derived (`BASE_DRONE_CHASE_SPEED`/`_CHASE_TURN`), not ad-hoc knobs.
- **Intro options screen** tries to slide down, fails, then snaps into place.

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
- **Boss `canControlDrones` possession** (Guardian's rear spawner, Summoner's 4 spawners) — diep
  lets a player pilot these two bosses and steer their drones by hand (`AbstractBoss.ts:186-192`),
  but this was deliberately left out. `togglePossession()` only covers Dominators and Motherships.
- **Optional Fallen variants** (`FallenAC.ts`/`FallenMegaTrapper.ts`/`FallenSpike.ts`) —
  explicitly optional; not built.
- **Survival/Mothership modes**: no waiting-room countdown UI (data is on the wire), no
  per-mode front-page door art, no `shapeScoreRewardMultiplier` (×3 shapes-only XP has no hook
  in `awardXp()`), Survival's shape density doesn't rescale with the arena.

## Still open

- **Maze**: minor wall-on-wall visual overlap remains. (Spawn-inside-wall is fixed —
  `rooms/Maze.js`'s `spawnPoint()` rejects candidates via `clearOfWalls()`.)

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
- **Trap/drone-spawner recoil** was settled by the `back`-column rescale. Every trap and drone
  barrel in diep carries `recoil: 1` (`TankDefinitions.json`), and `back = recoil × 0.4 × 2.8`
  puts all of them at 1.12 (0.4 grid squares per shot). If 0.4 reads as too much in a browser,
  the thing that is wrong is the whole column's scale, not the trapper rows.

## Untested — nobody has watched these happen

A full match start→finish; two humans in one room; boss AI vs a live human; chat over a real
socket; packet-length validation from a real browser; several busy rooms at once; the full
signup→login round trip. Plus the standing in-browser checklist: bullets leaving the muzzle
under hard strafe, camera feel, recoil/knockback magnitudes against the grid, base-drone
behaviour around bases, each mode's win/close flow, the accounts/achievements panels.

## Tooling notes worth not rediscovering

- **`test/clientDiff.js` seeds ONE RNG across four rooms in sequence** — a change to how many
  entities exist (or how long one lives) shifts every later mode's positions. Isolate causes by
  overriding the suspect constant at load time and re-running once per candidate. Rebaseline
  deliberately, with the reason in the file header. Current golden: `322908/55106b69`.
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
  anchor at least one assertion outside the tree.
- **`test/tanks.js` was removed** — its `diepCitations()` pass assumed the normal-tank barrel
  identity (`du × 0.7`) for every class, which is wrong for boss-scale entities whose barrel
  dims go through `du × K × CS / bossSize`. Boss geometry is now covered by dedicated tests in
  `test/rooms.js` (`defenderGeometryTests()`, `summonerGeometryTests()`,
  `mothershipGeometryTests()`). `test/clientTanks.js` (the `vm` helper) remains for anything
  that needs the client half of `TanksConfig.js` in Node. Ordinary-tank client/server drift
  has no automated guard — restoring a tanks cross-check that handles the boss conversion
  would close the gap.
