# Pending & Decisions

What's **left**: things needing a human call, things nobody has watched happen, and places the tree
is knowingly in a wrong or stand-in state.

- The **diep.io fidelity diff** — everything we do differently from diep, chunked and ordered —
  lives in **[plan.md](plan.md)**, not here. Items below cross-reference it by ID (`D1`, `S2`, …).
- The **codebase map and invariants** live in **[HANDOFF.md](HANDOFF.md)**.
- The two quantities that still need a real diep client live in **[MEASUREMENTS.md](MEASUREMENTS.md)**.

**Rule for this file: a finished thing with no nuance left is deleted.** If something reads as
"already done", it is here only because part of it is still open, or because the current value
*looks* wrong until you know why it is what it is.

*The game is being remade from scratch: the DB will be emptied and rebuilt. Nothing from the old
dev needs a migration path. Old conventions are defaults to improve on, not constraints.*

---

## Notes
crashers spawn too fast? and on top of people? chrck this
also bullets dont seem to do enough damage? a destroyer bullet cant even kill a pentagon

## 🟣 Needs a human decision

### 1. Arena Closer and Dominator borrow the boss's scaffolding
Both are `Player` instances with `motion`/`update` rebound at spawn (`lib/gameAI.js`'s
`CONFIG.CLOSER` / `CONFIG.DOMINATOR`), the same pattern `createBoss()` uses. Body shape and size are
now diep's own (Closer 98 units, Dominator 89.6, both circles). **Still open:** whether each gets a
real class of its own instead of borrowing the boss's, and whether their *AI behaviour* matches
diep. Unscoped. → plan X5.

### 2. `H`-key Dominator piloting — designed, not built
The design call, so it isn't re-derived:
- **The cost.** Don't move a socket's control between `Player` objects. Set `state.disconnect = 1`
  on the pilot's own tank — the existing flag already makes `motion()` ignore WASD and `update()`
  chip HP down over time, which *is* "at the cost of your own tank", with no new decay mechanic.
- **What piloting grants.** Aim and fire only. A Dominator cannot move even while piloted, so the
  right shape is a third `motion`/`update` pair: `dominatorUpdate`'s regen/idle bookkeeping, but
  reading real `inputs.mouse_x/mouse_y/mouseL` instead of running the auto-turret `DETEC` scan.
  `motion()` stays a no-op either way.
- **Ownership.** A `pilotedBy` field on the Dominator (the piloting socket's id), checked before
  honouring another player's `H`; cleared when the vacated tank finally dies or `H` is pressed
  again. The socket's `oId` is **not** reassigned — what changes is which entity's `inputs` the
  packets are copied onto, and which entity `getBuffer()` centres the camera on for that viewer.
- **Out of scope for the design:** the exact input-redirect site (`net/gameSocket.js` vs
  `rooms/Room.js`), and whether `H` targets "nearest friendly Dominator in range" or requires
  touching one.

### 3. Reload quantisation to whole ticks
We do `Math.round(can.reload × up.Reload)`; diep keeps `reloadTime` a float and compares an integer
cycle position against it (`Barrel.ts:60`) — sub-tick. It started mattering once `up.Reload` became
geometric (`0.914^p` lands on non-integers far more often than the old linear form). Dropping the
`round()` changes every class's cadence at non-integer point counts, and lives at two sites
(`entities/Player.js`'s `shoot()` and its mirror in `test/rooms.js`'s `fastestTankSpeed()`).
Deliberately deferred so it isn't a second behavioural cause in someone else's `clientDiff` golden.

### 4. `A₀` is 1.47% high — two diep sources disagree
`physics.html` says `2.58825 du/loop²`; `diepcustom`'s `TankBody.ts:271` says `2.55` with a
`1.015^(L−1)` level term (`2.55 × 1.015 = 2.58825` — the same formula quoted one level apart). Our
`this.level` is 0-based, i.e. already diep's `L−1` form, so the coefficient we want is `1.428`, not
`1.449`. One literal in `public/SHARE/Physics.js`; base top speed `362.25 → 357.0 u/s`. Left on
physics.html's figure because that was a deliberate choice. → plan M2.

### 5. `rules.arenaLive` for 2team/4team is more than a flag flip
`rooms/Room.js`'s constructor calls `this.dronePosts = this.basePosts()` **once**, and
`TwoTeam.js`/`FourTeam.js` bake each base's `post.x`/`post.y` as absolute world coordinates at that
moment. `tickArena()` keeps `baseSize`/`nestScale` current as the map lerps but nothing rebuilds
`dronePosts`. Turning `arenaLive` on for either mode would lay out every base's drone ring for the
150 gu starting floor and freeze it there while the arena grows around it. Fixing it for real means
making `dronePosts` re-derive from the live map. Sandbox and Tag never hit this (no bases).

### 6. Tank-vs-shape has no positional overlap resolution
Still open (unrelated to the mass-divisor question resolved by plan D7/D8): the tank-vs-tank arm
resolves positional overlap directly (§3), the tank-vs-shape arm does not — a tank can stand inside
a shape's hitbox, held apart only by whatever knockback impulse is currently in flight.

### 7. Base drones outrun everything, by design
`BASE_DRONE_CHASE_SPEED` is diep's own flat **756 u/s** (`BaseDrones.ts`, `bullet.speed 2.7`),
pinned to nothing. That outruns even a maxed-Movement Sniper's 546 u/s dash, so circling a base is
no longer a survivable race on speed alone; `BASE_DRONE_DETECT` dropped to diep's `ai.viewRange`
(504 units, was 1680) at the same time, so the encounter got shorter and sharper rather than simply
harder. **Not pre-tuned back — needs a human read in a browser.** If a lap reads unfair, move
`BASE_DRONE_LEASH`/`BASE_DRONE_DETECT`, not the chase speed.

### 8. Base-drone lethality was never separately playtested
A lone drone deals its full ~121 HP/s (`test/rooms.js` pins ≈3.03 hp/tick at `TICK_MS` 25); twelve
of them kill a maxed 278 HP tank in about a fifth of a second. That is the combined effect of the
health-model rewrite and the removal of the old defensive `dr` term, and the pair was never checked
together. Judge against the wiki's "low damage, delivered extremely quickly". Note plan D1 moves
this again.

### 9. Sandbox gaps still open
Party-link invites; arena size and shape count scaling with player count; bosses spawning after
50–60 minutes. (The four cheat keys `K`/`O`/`\`/`;` are done.)

### 10. Comment-style cleanup pass
Comments should describe **what the code does** — the function, the invariant, the unit — not
cross-file references (`see plan.md Step 3`, `PENDING #19`), change history (`was 0.511941`), or
narrative about why a past approach was wrong. Much of the tree is currently the opposite
(`rooms/Room.js`, `entities/Player.js`, `entities/Bullet.js`, `public/client/entities.js` carry long
historical blocks). **Scope:** strip references and history, keep and sharpen the functional
statement (units, ranges, why a value is what it is *in terms of the formula*, genuinely non-obvious
invariants like "`pene` IS a drone's health pool"). Worth one deliberate pass — it touches nearly
every file and would make any other diff in the same commit unreviewable.

### 11. C1's causes 2/3 and C4 still need a real browser session
Re-checked this pass (plan.md's chunk 10, C1/C3/C5): cause 1 (`.93`) is confirmed still fixed.
Causes 2/3 (the client muzzle-weld ramp being tuned against a since-changed prediction path, and
the local tank's own reference frame under strafing) are exactly what plan.md's own C1 text says to
"re-judge in a browser" - still nobody has. Left untouched again rather than blind-tuned from source
reading alone, since the prediction math is carefully measured (its own comments, `test/client.js`
pins part of it) and a wrong guess here is worse than the current bug. `C4` (`CONST.CAM_SMOOTH`/
`HP_BAR_HOLD`) is the same story - MEASUREMENTS.md's protocol is ready, nobody has run it.

### 12. Damage-flash duration is client-timed, not server-timed
Investigated this pass (plan.md C3/C5): the *signal* diep calls `StyleFlags.hasBeenDamaged` is, in
substance, already on the wire - both `Players` and `Objects`' `states[0]` bit is exactly "this
entity is inside its post-hit flash window" (`entities/Objects.js`'s `this.hit`, similarly on
`Player.js`), so there is no missing field. What's actually missing is that
`public/client/entities.js`'s `hit()` re-times its own animation independently (a fixed
`sleep(50)` then `sleep(16)`) instead of trusting how long the server actually holds the bit
(`tick.ticks(1.65)` - 3 real ticks, ~75 ms at `TICK_MS` 25, and moves if `TICK_MS` does). Fixing it
means rewriting `hit()` to extend the flash for as long as consecutive packets keep reporting the
bit set, instead of firing a fixed one-shot timer - real, scoped work, not attempted this pass for
the same reason as #11 above (an animation-timing change nobody could watch happen).

### 13. `StyleFlags.isFlashing` (diep's spawn-shield visual) has no mechanic behind it
Investigated for plan.md C5 alongside the other `StyleFlags`. Diep sets this on tank spawn
(`TankBody.ts:95`) and clears it on the first move/shoot or after 374 ticks - a temporary
invulnerability-adjacent visual (`Dominator.ts` clears the same flag on capture, similarly). This
engine has no spawn-shield concept at all to drive the bit, so it was left off the wire rather than
added as a stub with nothing behind it - a real gap (an actual feature this tree doesn't have), not
a decision to revisit.

### 14. `HealthFlags.hiddenHealthbar` and scoreboard-entry wire fields not attempted
Named in plan.md C5 alongside the fields that did land this pass (`Objects.dir`, the arena-state
head fields). Not a decision - just ran out of session before reaching them. diep's own uses
(`Bullet.ts` hides every bullet's bar - moot for us, `Bullets` has no `hp` field to begin with;
`TeamBase.ts` hides the base's; `TankBody.ts`'s Necromancer-claim case hides a square's mid-deletion)
are all narrow and entity-specific, so whoever picks this up should decide the mapping per entity
rather than adding one blanket bit.

---

## 🟠 Live stand-ins — real numbers with no diep source behind them

These are **ours, flagged**. Don't present them as measured, and don't "finish the job" off a
qualitative wiki phrase.

**Classes with no diep counterpart at all** — Cyclone, Submachine, Auto Hover, Fortress (plus
Summoner, which is entirely ours). Every column that needed a value took a nearest-relative
stand-in, and **the three columns do not share one mapping** — you cannot reconstruct a value from
"it's a stand-in like the others":

| column | mapping |
|---|---|
| `reload`, `weight` (knockback) | Cyclone ← Octo Tank (0.4333, not parent Quad Tank — the table is monotone in barrel count and Cyclone has ten); Submachine ← Machine Gun; Rocketeer (renamed from "Rocket", plan.md T1) ← the rear-thruster row (0.1333, not Flank Guard's 0.666 — both its barrels point backwards); Gunner ← Gunner Trapper's bullet row; Fortress ← Tri-Trapper's traps / Battleship's drones; Summoner ← the drone row |
| `speed`, `life`, `rand` (scatter) | Cyclone ← Octo Tank (all ten barrels identical); Submachine ← Machine Gun; Auto Hover's three manual barrels ← Tri-Angle's own three; Fortress's launchers ← Tri-Trapper's trap row (`speed 2`, `scatterRate 1`, `lifeLength 3.2`), its small drones ← Battleship's swarm row; **every auto-turret slot** ← `Entity/Tank/AutoTurret.ts`'s shared `AutoTurretDefinition` (`speed 1.2` / `scatterRate 1` / `lifeLength 1` → `1.344` / `0.174533` / `75`), not a `TankDefinitions.json` entry at all |
| Rocketeer's two backward thrusters | **not** `TankDefinitions.json` — diep's Rocketeer fires a rocket that spawns its own inline exhaust sub-barrel (`Projectile/Rocket.ts`'s `RocketBarrelDefinition`: `speed 1.5`, `scatterRate 5`, `lifeLength 0.1`); *that* sub-barrel is the model |

**The 16 tanks plan.md T2 adds (landed) carry the same kind of stand-in, for the same reason —
diep's own Knockbackfactor table (`physics.html`) predates every one of them, so `weight`/`push`
has no row to read at all:**

| column | mapping |
|---|---|
| `weight`, `push`, `back` | Hunter/Predator ← Sniper's own barrel row; Streamliner ← Gunner's (its other tree parent); Stalker ← Assassin's, with `back` recomputed from diep's own real recoil (3 gu) rather than inherited; Auto 3/Auto 5's turret ring ← the existing `AutoTurretDefinition` row every other auto-turret cannon in the file already shares (Auto Hover's `c[0]`); Spread Shot ← Triple Shot's; Gunner Trapper's two gunner barrels ← Gunner's own row (its trap barrel uses Trapper's); Tri-Trapper ← Trapper's trap row; Skimmer ← Destroyer's (its tree parent); Factory/Mothership's drone barrels ← Overseer's drone row |
| Streamliner's `reload` | diepcustom does not give this class its own reload multiplier - inherited Gunner's cadence (15) rather than left unset |
| Auto 3/Auto 5's ring `distance` (14 units) | no diepcustom source captured for the turret-ring mount radius (`Addons.ts`'s `createAutoTurrets()` is an abstract helper with no concrete offset) - an engine-quality guess, not measured |
| Tri-Trapper's fire order (`offTime: i/3`) | evenly-thirded, no diep source - same spirit as Auto Hover's own paired-barrel stagger |
| Spread Shot's outer-barrel `speed`/`pene`/`rand` | diepcustom's own entry gives `damage`/`width`/`reload`/`recoil` per barrel but not `bullet.speed`/`scatterRate` - inherited from Triple Shot (its tree parent) rather than left unset |

**Other live stand-ins:**
- **Annihilator's recoil** is deliberately off-table (4 gu against diep's 6.8). Its `weight` is
  on-table — the two calls are independent.
- **`DOMINATOR_RETARGET_IDLE`** (3 s) — how long a Dominator holds a target that has stopped
  shooting back. No diep number.
- **`BASE_DRONE_LEASH`** (`gu(90)`) — diep's single 900 du filter is both acquire radius and leash;
  ours is a much longer-range mechanic and collapsing the two would change base behaviour more than
  the reference justifies.
- **Tag's `INVIS_FLOOR`** and **`CLOSER_COUNT` 4** (diep says "up to 16"; this room's 30-slot cap
  can't fit 16 more and an immortal Closer never needs replacing).
- **Domination's Dominator layout** — a loose diamond around the arena centre. diep_wiki gives 4
  Dominators and no coordinates. Due a playtest once a human can see the map.
- **`SANDBOX_LEVELUP_TICKS`** (200 ms per level while holding `K`). diep gives no rate.
- **Summoner's whole stat block, body, drift and aggro model** — diep has no boss of this shape.
  Its `screen / 30` aggro radius, the `/ level` scaling and the 0.5625 ellipse are all unreferenced.
  → plan X3.
- **The Crasher Zone/Pentagon Nest are circles, not diep's squares.** diep's own zone test is
  `max(|x|,|y|) < R/10` (a square region) - kept circular here (`entities/Objects.js`'s `'bull'`
  case, `rooms/Room.js`'s `createObj()`) for consistency with every other nest/carve-out in the
  tree, which are all circles. → plan S2.
- **Square/Triangle corner nests are kept on top of diep's zones, not replaced by them** - a
  deliberate user call (plan K5): diep decides a shape's type purely from its landing point, with
  no concept of "Squares live NE". Ours does, and stays, alongside diep's own Pentagon
  Nest/Crasher Zone radii.
- **Shape edge-avoidance turning snaps to target instead of diep's literal fixed-sign increment.**
  `AbstractShape.ts`'s `orbitAngle += orbitRate` is unconditional even when it overshoots the
  target (diep's own `rotationDir` sign can occasionally send a shape most of the way around
  before it lands) - `entities/Objects.js`'s port instead clamps the last step to land exactly on
  the target angle, so a shape can't overshoot and oscillate. Same visible "turn away from the
  wall" behaviour, a deliberately gentler mechanic underneath. → plan S5.
- **Respawn cadence closes 85% of the gap to diep's instant refill, not all of it**
  (`RESPAWN_CATCHUP` in `rooms/Room.js`) - a deliberate user call (plan K6), keeping some of the
  "farming visibly thins a patch out" feel rather than diep's "a nest never looks empty". The
  400 ms `generate()` pass itself is also kept as our own engine-cost knob rather than switched to
  diep's true per-(reference-)tick check.
- **Smasher/Landmine/Auto Smasher/Spike's guard shapes are a single enlarged collision circle,
  not diep's separate `GuardObject` physics entity** (plan.md T6, decided simplification) -
  `entities/Player.js`'s `this.guardSize` widens both contact-damage AND physical overlap
  resolution to `size × sizeRatio`, reusing the existing circle-circle `collision()` code path
  entirely rather than spawning a real child entity with its own position. Diep's own guard is a
  genuinely separate object (can, in principle, be caught on something the tank body itself
  isn't touching); ours cannot. Revisit if that distinction ever matters in play.
- **Guard shapes have no client rendering yet.** Smasher/Landmine/Spike's `guards` are real and
  enforced server-side (`guardSize`), but `public/SHARE/TanksConfig.js`'s client entries for all
  four Smasher-line tanks draw as a plain circle - no spinning hexagon/triangle ring, unlike
  diep's own visibly larger silhouette. The intended idiom (`PetsConfig.js`'s cosmetic
  `ctx.rotate(Date.now()/...)`) was never wired up.
- **Skimmer (type 4) and Minion (type 1.5, Factory) are built (plan B3), with real gaps left on
  purpose.** Both projectiles' sub-fire `weight`/`push` borrow their PARENT cannon's own row -
  diep's real per-sub-bullet `absorbtionFactor` table (Skimmer 1, Minion 1) still has no home in
  this codebase (T5's still-missing generic `bullet.absorbtionFactor`, same gap as ever). Neither
  draws any different from a plain circle client-side - Skimmer's own spinning twin-barrel
  silhouette and Minion's own barrel are not rendered, matching T6's guard-shape precedent (real
  server mechanic, no art yet). Minion's `AIState.idle` gate is approximated as "the shared
  `droneSteer1()` found a live target or the owner is aiming", not a ported idle-state machine -
  cheap and behaviourally equivalent for the cases that matter (a resting minion doesn't waste
  ammunition into empty air) without a new state field. Verified only by a hand-run script against
  a bare Skimmer/Factory tank (see this file's own tooling notes) - never watched in a browser, and
  not yet given a permanent `test/rooms.js` entry.
- **The four new bosses' knockback rows (`weight`/`push`) borrow the nearest existing drone/trap
  row on file** (Overlord's own drone row for Guardian/Fallen Overlord's drones, Fallen Booster's
  own barrel rows unchanged from Booster's) - same "no diep table entry" gap as T2's own roster,
  not a new one. **Travel speed for Guardian/Fallen Overlord/Fallen Booster's patrol/chase reuses
  Summoner's own `BOSS_DRIFT` magnitude** (`lib/gameAI.js`'s `bossThrust()`), not a fresh
  measurement - diep's raw `movementSpeed` is an accel term for AbstractBoss's real tank-body
  physics, which this engine's boss integrator diverged from entirely when Summoner was built (no
  `Physics.stepBody` at all); there is no clean unit conversion from one to the other. **No true
  polygon boss body for Guardian/Defender's triangle or Fallen Overlord/Fallen Booster's own tank
  shape** - inherits Summoner/the Dominators' pre-existing `body: {shape: 1}` (rounded rectangle)
  simplification (PENDING #51's own note), not a new gap. **`Misc/Boss/FallenAC`/`FallenMegaTrapper`/
  `FallenSpike`** (the `Misc/Boss/` addon variants plan.md X1 also names) were not built - no
  citation gathered, out of this pass's scope. **`test/rooms.js`'s boss-mode suite was adapted**,
  not just left passing by luck - one assertion used to assume `room.bosses[0]` was always a
  Summoner (the only boss that existed); it now picks any boss other than Defender (which diep
  gives `ai.viewRange 0` - it never aggros, correctly, not a bug) to test the shared aggro
  mechanism against.
- **A4's `state`/`ticksUntilStart`/`playersNeeded` fields are on the wire now (plan.md C5)** -
  `GameUpdate`'s head carries `arenaState`/`ticksUntilStart`/`playersNeeded` and the client stores
  them on `Game` (`game.js`, mirroring how `Game.baseSize` already works) - but there is still **no
  "waiting for players" countdown screen**, just the data sitting there unused. A human joining a
  Survival room mid-`COUNTDOWN` still sees an ordinary tank with no on-screen indication a match
  hasn't started; someone needs to actually draw it (`public/client/ui.js`, in the spirit of diep's
  own `RenderWaitingForPlayers()`/`RenderCountdown()`).
- **Tag/Maze's own "closing" was deliberately NOT migrated onto the new `Room.ArenaState`.** A4's
  own note explains why - Tag's `this.closing` flag and Arena-Closer-swarm mechanism is untested
  surface if touched for no behavioural gain, so it stays exactly as it was; Mothership/Survival
  each carry their own independent copy of the same closing pattern (`startClosing()`/
  `createCloser()`, duplicated three ways now across Tag/Mothership/Survival, not shared) rather
  than factoring all three onto one mechanism. Worth a real unification pass some day, not this one.
- **Mothership/Survival have no dedicated front-page door animation or button icon.**
  `public/client/ui.js`'s per-mode draw-case switch falls through to its `default` arm for both
  (views/index.ejs's own comment at the two new buttons) - functionally complete, cosmetically
  unfinished, the same kind of gap plan.md's own C3/C4 chunk exists for.
- **Neither new mode's diep-real shape-XP-only multiplier (`shapeScoreRewardMultiplier`, both
  ×3.0) is modelled.** This engine's `rules.xpMul` is a single multiplier `awardXp()` applies to
  every award alike (kills included) - there is no separate "shapes only" hook to carry either
  figure into without touching every kill-XP call site too, so both modes were left at the
  ordinary ×1 rather than over-applying it. Real gap, flagged rather than approximated wrong.
- **Survival's shape density is a static mix, not diep's own live-rescaling formula.**
  `SurvivalShapeManager`'s `floor(12.5 × ceil((width/2500)²))` re-evaluates every tick as the
  arena shrinks; `rooms/Survival.js` instead sizes a fixed `shapeMix` for the `MIN_PLAYERS`
  starting arena once and never touches it again as the arena grows/shrinks around it.
- **Neither new mode has been seen in a browser.** Both are verified only by hand-run scripts
  (spawn, tick, kill a Mothership / thin Survival down to one) - the same "code-tested only"
  caveat every other mode in this tree's 🟢 Untested section already carries.
- **`Flame`/`CrocSkimmer` were not built.** Both bullet types exist only in diepcustom's
  `DevTankDefinitions.ts` (dev/test tanks) - no entry in the real, player-reachable
  `TankDefinitions.json` roster ever sets `bullet.type: "flame"`/`"croc"`, and this codebase's own
  Sandbox tank-cycler is real-tanks-only (PENDING checklist: "never a blank silhouette or
  Summoner"), so there would be no in-game path to ever trigger either. B3 (plan.md) scoped them
  out rather than add unreachable engine surface.
- **Mothership has no spawn path.** Its `TanksConfig.js` entry is data-complete (barrels, stats,
  `ups` override) but nothing in `exports.tree` reaches it and no gamemode spawns one - it needs
  the real Mothership gamemode (plan G1, chunk 9, not yet built). Also unconfirmed: its
  `fieldFactor` (no diepcustom value was captured for this class specifically, defaulted to 1) and
  its `absorbtionFactor: 0.01` (recorded on the class but not read anywhere - `collision()` only
  special-cases Dominator/Closer today, there is no generic per-class receiver-side
  absorbtionFactor mechanism). Its 16-sided body also draws as the ordinary near-circle body
  shape, not a true 16-gon (chunk 10/C3 cosmetic territory).
- **Manager's stealth is not diep's `flags.invisibility`.** `entities/Player.js`'s stealth
  mechanism (decay/moving/shooting rates, plan.md T3) now also runs Manager's pre-existing
  custom ability, converted losslessly from its old single-constant form
  (`stealth: {decay: 0.00727, moving: 0.00727×10, shooting: 0.00727×30}` - the exact ratios the
  code always used). But Manager was never in T3's `flags.invisibility` table (only Landmine and
  Stalker are diep-real stealth tanks) - it has no `flags` object, on purpose, so a future reader
  doesn't mistake it for a cross-checked diep number.
- **`flags.zoomAbility` (Predator) is data-only.** diep's right-click zoom has no input path in
  this codebase yet - the flag is recorded (plan.md T3) but nothing reads it.
- **Bots have no path to 15 of the 16 new tanks.** `lib/gameAI.js`'s `CONFIG.BOT_PATHS` only
  reaches one (Stalker, via the fixed-up Sniper→Assassin path below) - Smasher/Landmine/Auto
  Smasher/Spike/Hunter/Predator/Streamliner/Auto 3/Auto 5/Spread Shot/Gunner Trapper/Tri-Trapper/
  Skimmer/Factory/Mothership are all unreachable by AI. Not a regression (no bot path referenced
  their tree slots before they existed either) - just not authored yet.
- **One `BOT_PATHS` entry was retargeted, not just left broken.** `['Sniper', 'Assassin',
  'Sprayer']` stopped working the moment `Sprayer` moved off Assassin onto Machine Gun (plan.md
  T1's tree rewrite matches diep's real edges - diep has no Assassin→Sprayer path). Repointed at
  `['Sniper', 'Assassin', 'Stalker']`, Assassin's other real child, rather than leaving a bot
  stranded mid-evolution. `test/clientDiff.js`'s golden moved as a result (recaptured, noted in
  that file's own header) alongside plan.md T4/9d's FOV fix (Sniper/Assassin/Trapper/Ranger/
  Overseer/Overlord/Manager/Necromancer/BattleShip/the rest of the Trapper line/Sprayer/every
  Dominator all now carry diep's real `fieldFactor` instead of an uncross-checked screen literal)
  - both are real bots the corpus's default rooms already spawn, so either alone could move it;
  not worth separating further since both changes are deliberate and correct.

---

## 🔴 Knowingly wrong right now

### `weight` and `push` are two fields — do not merge them back
- **`weight` is knockback dealt to a TANK.** One consumer: `entities/Player.js`'s `KIND.BULLET`
  arm, `tick.impulse(other.weight / 3 * 1.6)`. It is diep's Knockbackfactor table × 5.25.
- **`push` is the bullet's own bounce off what it hit.** Three consumers, all in
  `entities/Bullet.js`'s `collision()`. It carries the pre-rewrite `weight` values verbatim — that
  half of the old overloaded field never had a reference behind it.

They differ by ~14× in what they do with the same number, and the rewrite moved individual entries
non-uniformly (×0.77 to ×12.8), so no single divisor carries the old behaviour through both.
`rooms/Room.js`'s base drone sets both by hand (`weight 4.2`, `push 2`); its `push` is load-bearing
— base drones hold a ring and would stack without it.

### `V_max = 10·A` is exact only at the 40 ms reference — the live 25 ms server runs 1.8% over
`Physics.stepBody`'s steady state rises from 362.25 u/s (`d=1`) toward 380.1 (`d→0`); at the live
`d = 0.625` it is **368.9**. Ordinary semi-implicit Euler drag error. Quoting 362.25 is quoting the
reference, not the server — fine for comparing against diep, misleading if someone measures in-game
and finds 369. `test/rooms.js`'s tick-scale band is 3% for this reason. The real fix is an
exponential integrator, which changes the meaning of every per-reference-tick constant in the tree.
→ plan M4.

### `PET_FRICTION`'s 2×-braking relationship is against `BODY_FRICTION`, not the tank's
Exact at `1.992040×`: `1 - PET_FRICTION = (1 - 0.9) × 1.992040`, so `PET_FRICTION = 0.800796`. A
future reader "restoring" the ratio against the tank's `10/11` instead gets `0.8182` and a pet that
brakes ~2.2× harder and parks behind its owner. Documented at the constant in `lib/gameAI.js`; this
is the second copy.

### Per-tick contact is an approximation of diep's once-per-reference-tick quantization
diep keeps a `damagedEntities` list per entity, cleared each 40 ms tick, so a colliding pair
exchanges damage **exactly once** per diep tick. We run at `TICK_MS` 25 and scale each hit by
`tick.perTick()` (x 0.625) instead - approximately the same integral, but not the same
quantization: a bullet that dies in exactly one diep tick spends ~2 of ours, and the proration on
the final partial tick is a different number than diep's own. Deliberately accepted rather than
fixed - plan.md's own D6 already called it "within a few percent once D1 lands," and D1 has
landed. The exact fix (a per-pair "already exchanged this reference tick" guard, cleared every
reference tick) would add real state to `rooms/Room.js`'s hottest loop for a few-percent gain, so
it stays a known, accepted gap rather than new surface. → plan D6.

### A boss's aggro radius is smaller than its own hitbox at low level
`lib/gameAI.js`'s Summoner test is `dis / max(1, level) < screen / 30` — **65.6 units** for a
level-0/1 tank, against a boss body radius of 64 plus a ~28-radius tank. It only ever passed because
tanks could stand *inside* the boss, which tank-vs-tank overlap resolution now makes impossible.
Patched by measuring from the boss's **hull** as a fraction of raw distance (`(raw − size) / raw`,
so it survives the metric's 0.5625 y-squash — a flat subtraction would be worth 1.78× more along one
axis than the other). Nothing here is referenced against diep. → plan X3.

### 40% more shapes is a per-tick cost as well as a balance change
ffa 725 → 1017, 2team 555 → 800, 4team 669 → 1012. `test/clientDiff.js`'s ffa canvas-op count went
59534 → 92856 (+56%) for the density change alone. Intended, but the first thing to check if room
tick time becomes a problem. Knob: `SHAPE_DENSITY_GU2` in `rooms/Room.js`.

### The class-tier gate is `parseInt(level / 15)`, not `parseInt((1 + level) / 15)`
Our `level` is 1-based in diep's sense, so the `1 +` an older reference quotes is an off-by-one that
opens tier 1 at level 9. `test/rooms.js` pins 15/30/45. Don't "restore" it.

---

## 🟢 Untested — nobody has watched these happen

1. A full match start to finish: levelling into the class tree, death screen, respawn.
2. Two real humans in the same room (only single-player/single-tab has been tested).
3. Boss AI in a live match with a human moving around it.
4. Chat over a real client connection (admin commands *are* proven end-to-end over a real socket
   against Postgres).
5. A real browser hitting the packet-length validation (`chat`/`com`) — a mistake shows up as a
   kicked player, not a crash.
6. Load: several busy rooms at once on one process.
7. The full signup → login DB round trip.

### The in-browser checklist
Only a stub-DOM harness has run the client. Everything below is code-tested only.

**Core feel**
- Bullets visibly leave the barrel tip, including while strafing hard perpendicular to aim.
  (plan C1 — expect this to be *wrong* today.)
- Camera reads as a hair of chase, not drift (`CONST.CAM_SMOOTH` — needs a genuine retune, see
  MEASUREMENTS M5).
- Own bullets: no pop or kink where interpolation takes over from the muzzle weld.
- Incoming bullets connect on the frame they visually touch you, not slightly before. Judge under a
  throttled connection too.
- Level 1 vs level 45 with Movement Speed maxed — the tank shouldn't rubber-band differently at the
  two speeds. Ratio at the cap is 0.82× a fresh spawn (diep's own endgame figure).
- Recoil: a Destroyer's kick should push it ~6 grid squares per shot, a Basic's ~0.4, measurable
  against the background grid.
- Knockback: a Basic's bullet shoves a tank 0.666 squares per tick of contact, a Destroyer's 0.2, a
  Mega Trapper's trap 1.07, a tank *body* 1.6.
- Tanks are solid — drive into another player and confirm you're held apart, bigger tank yielding
  less, no jitter or stickiness.
- Health: a fresh spawn is **50** HP. At 0 Regen points, take damage and watch it creep back
  immediately, then **visibly speed up after ~30 s** — confirm that reads as a rate change, not a
  glitch.
- `c` auto-spin starts from where the barrel is pointing and leaves it there on release; rate is
  1 rad/s. Toggle it on/off repeatedly and watch for a one-frame barrel flick.
- Tank growth (`28 × 1.01^level`) is smooth, and nothing keyed to `size` looks off at the cap
  (1.56× a spawn's radius).

**Upgrade economy**
- Each stat bar draws **7** segments (widget correspondingly wider — check a few UI scales).
- A fresh spawn shows **no** point to spend; the first arrives at level 2.
- The class picker opens at **15/30/45**.
- Levels 29–45 grant a point only every third level — the badge stops ticking every level near the
  cap by design.
- **Smasher/Landmine/Spike's panel** (plan.md P3) - four bars (Reload/Bullet Speed/Bullet
  Damage/Bullet Penetration) should show as permanently empty/disabled, the other four (Movement
  Speed/Body Damage/Max Health/Health Regen) should draw **10** segments, wider than the ordinary
  7-segment panel. Auto Smasher's panel is ordinary (10 segments on all eight). Code-tested only
  (`test/rooms.js`) - the widened/disabled bar rendering itself has never been seen in a browser.

**New tanks (plan.md T2)**
- The 16 new classes appear in the level-up evolution picker at the right levels (Smasher/Auto 3/
  Hunter at 15/30/30 respectively per their real parents, the rest at 30/45 per plan.md T1's
  table) and are selectable.
- Auto 3/Auto 5's turret ring actually fires at a live target and each turret pivots independently
  while the ring itself stays fixed on the hull (plan.md T5's `distance`/mount-angle split) -
  never checked outside the unit-tested math.
- Tri-Trapper/Gunner Trapper's `trapLauncher` nub is visible at the tip of their trap barrel(s).
- Stalker's barrel actually draws as a flared trapezoid, not a plain rectangle.
- Smasher-line tanks visibly look like ordinary tanks with no guard ring (known gap, see 🟠 above)
  - confirm that reads as "missing art," not as broken collision, since the enlarged hitbox is
  real even though nothing draws it yet.

**World**
- A green Shiny polygon and a rainbow Mythic one are visibly distinct — and turn up often enough to
  notice in a normal session.
- The minimap shows other players' dots moving smoothly, with a thin dark frame, in every mode.
- Crashers read as pink triangles that actually run a nearby tank down (plan S1's chase-speed/
  detection-range fix is unit-tested, `test/rooms.js`'s `crasherChaseTests()`, but the seeded
  60-tick `clientDiff` corpus never spawns one, so the in-browser feel is still unexercised). Their
  point should track the tank they're chasing, turning smoothly - the server-authoritative facing
  angle this needed (plan S4) is now built and on the wire (plan.md C5), replacing the client's old
  motion-diff approximation entirely, but nobody has watched a live Crasher's point actually track
  its target in a browser yet - code-tested only.
- Every shape's own slow idle spin (plan.md S4/C5, `AbstractShape.ts`'s `BASE_ROTATION`) is now
  server-driven end to end (`entities/Objects.js`'s `this.dir`/`this.spin`, the wire's new `Objects`
  `dir` field, `entities.js` drawing it directly) instead of a client-only per-frame wobble - never
  seen running in a browser, only exercised by `test/tanks.js`/`test/rooms.js`/`test/proto.js`'s
  code-level checks and the `clientDiff` corpus (which never lets one spin long enough to notice a
  visible stutter or direction flip, if there is one).
- Farming speed at low level, and frame rate / room tick under a busy 4team.

**Bases and base drones** — nothing here is covered by a browser-free test beyond placement:
- 4team bases are coloured squares at corners; 2team's strips match `baseSize`. 4team: 12 small
  triangles orbit each base, crossing the ring every ~10 s. 2team: 15 evenly spaced pairs per side.
- Own drones phase through you; your own bullets pass through them.
- Bullets fired into an enemy base die about a grid square and a half past the line, not on it.
  Standing in one kills you in about a second.
- Kill a drone: a new one is orbiting that post ~1 s later.
- Drive around the *outside* of an enemy base through the dark grey border — you shouldn't die out
  there and should get the whole way round, including a 4team corner.
- Drones must never park against the arena edge — a chasing or returning drone should follow, turn,
  and keep moving.
- Bait a base out to a corner then die or leave: every drone turns for home on that tick, visibly
  closer to base on the very next frame, in one clean curve with no peeling off through the centre.
- Stand next to the Summoner inside a base's detect range in a team mode: nothing happens until it
  hits a drone, then the whole base engages.

**Modes**
- **Tag** — no bases; leaderboard is one row per team with a headcount; XP ×3. Killed by a bot →
  you respawn on that bot's team; killed by a polygon → you keep your colour. Arena shrinks every
  ~12.5 s (glides, stops at a floor). Play until one team absorbs everyone: Arena Closers appear,
  beeline for everyone left, are unkillable, and the room empties and self-destructs. Stealth
  classes stay faintly visible.
- **Domination** — 4 yellow Dominators between the two bases, XP ×2. Shoot one to 0 HP → flips to
  your team and refills. Have the enemy knock *yours* down → back to neutral first, not straight to
  them. A Dominator's bullets vanish the instant it flips. It never physically moves even when
  several tanks ram it.
- **Maze** — walls are real rectangular chunks; one minimap dot per rectangle; a 5-hour close.
- **Sandbox** — hold `K` and climb one level at a time, stopping at 45; `\` cycles real tanks (never
  a blank silhouette or Summoner) including Arena Closer and the 3 Dominators, which appear with
  their normal stats under your control, *not* the scripted AI's invincibility; `;` toggles god mode
  both ways.
- **The front-page menu** — 8 mode buttons cap to the right column's height and scroll with no
  visible scrollbar; every mode's "door" animation plays its own case (none falls through to ffa's);
  `tag`'s ball reads as a small circle running the screen's edge at rest; `domination`'s reveal is a
  half-screen wipe with a diamond accent, not a sliver; nothing clips or seams at common window
  sizes.
- **Accounts** — account chip shows `Guest`; signing up carries coins over; the achievements
  edge-hover panel darkens and scrolls, and a manual scroll pauses the auto-scroll.
  `Ctrl+Shift+L` accepts `color`/`uiscale` and refuses an admin command for a non-admin.

---

## ⚪ Tooling notes worth not rediscovering

**`test/clientDiff.js` seeds ONE RNG across four rooms built in sequence.** Mode *N*'s divergence
shifts mode *N+1*'s `Init()` (different spawn point, different bot roster) before a tick runs.
**Rule of thumb:** a change to how many entities exist, or how long one *lives*, shifts the
random-draw stream and every downstream mode's positions with it; a change to how existing entities
*move* usually doesn't. The technique that makes a golden move legible: override the suspect
constant at load time and re-run the corpus once per candidate cause — the causes that contribute
nothing are then *proved* to. If the illegible deltas ever become a nuisance, re-seed per mode;
deliberately not done yet, since changing the corpus and the physics in one commit would make
neither reviewable.

**Prose goes stale silently — nothing tests it.** When a step changes a number, **grep the tree for
the old number, not just the constant's name.** Two known false-positive near-collisions: Gunner's
bullet `speed 0.511936` vs the old `MOVE_ACCEL_BASE 0.511941`; the retired tank-body knockback
impulse `0.43881` vs a bullet `speed 0.438816` that eight drone/trap cannons share.

**`motion()`/`update()` *replacement* is a three-way pattern.** `createBoss()`, Tag's
`createCloser()` and `createDominator()` all bind their own function pair at spawn, so none of them
ever reaches `Physics.stepBody` and none of the tank movement work applies to them. Any future
entity built this way inherits the same property — decide deliberately whether it should.

**One known stale citation:** `TanksConfig.js`'s Arena Closer comment derives its hardcoded
`speed: 0.995491` from "the engine's own maxed BSpeed multiplier, 7 × 0.0942857/pt" — that per-point
step is diep's `0.15` now (cap 2.05×, not 1.66×). The literal is harmless (an Arena Closer never
calls `upgrade()`), but the derivation no longer reproduces.
