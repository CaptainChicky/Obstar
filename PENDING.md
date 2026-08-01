# Pending & Decisions

Short-form companion to [HANDOFF.md](HANDOFF.md). Only what's *left*: things needing a human call,
decisions already made but not yet built, and things nobody has verified yet.

**A fully shipped item is deleted from this file. An item marked SHIPPED is still here for one of
two reasons, and it says which:** either part of it is still open, or it records a *"do not re-fix
this"* — a value that looks wrong until you know why it is what it is (#22 is entirely that; #14's
table, #16's two derived columns, #17's body-damage-vs-bullet ratio, #18's four damage fixes, #19's
arena size, #23's `BASE_DRONE_HP`, #24's written floor, and #28's Arena Closer count/invisibility
floor are too). Do not treat a SHIPPED heading as work to redo. **Exception: #26's wall geometry is
NOT a do-not-re-fix any more — reopened 2026-07-31, it's known wrong. See #26 below.**

---

*The game is being remade from scratch: the DB will be emptied and rebuilt, and nothing
documented from the old dev (naming, MySQL, anything below) needs a migration path or
backward-compat story. Old conventions are defaults to improve on, not constraints.*

*Small open threads that are not items in their own right — things that will bite during a later
step if nobody remembers them — are collected in **⚪ Nuances to iron out** near the bottom, with
pointers back into the items below.*

## 🔵 Decided — queued for implementation (not yet built)

*Nothing queued right now.* The last entry here (old #2, Domination/Maze's new entity types) split
into #26 (Maze/`KIND.WALL`) and #27 (Domination/Dominator) as each half's own scope firmed up, and
both are now fully documented at their own numbers below — deleted here rather than kept as a
redundant pointer, per this file's own rule that a fully-resolved entry doesn't linger.

## MAJOR BUG
I'm unsure of what the penentration values there are, but when testing, I upgraded to max bullet penetration, and this caused me to not be able to kill shapes. the shapes i attacked coudlnt be killed after getting them downto some small amoutn of health. i tried shooting them and also ramming them but they take 0 damage (their helath bardissapears). this applies to a lot of shapes but some shapes dont. 

## 🟠 Wiki cross-check: GAME MODES — pick what goes in, strike what doesn't

*Source: `diep_wiki/` (`Game Modes.txt`, `Maze.txt`, `Domination.txt`, `Dominator.txt`,
`Polygons.txt`, `Stats.txt`). Official game only. This is a menu, not a plan: nothing here is
decided. We currently ship **ffa / 2team / 4team / boss / sandbox / tag / maze / domination**.*

| diep mode | we have | notes |
|---|---|---|
| FFA | ✅ | — |
| 2 Teams | ✅ | — |
| 4 Teams | ✅ | — |
| Sandbox | ✅ | ours lacks diep's cheat keys, below |
| Maze | ✅ | shipped, item 26 |
| Domination | ✅ | shipped, item 27 (its `H`-key piloting mechanic designed but not built) |
| Tag | ✅ | shipped, item 28 |
| Breakout | ❌ | tile/turf war, needs a claimable grid |
| Capture the Flag | ❌ | needs a carryable entity + 3 bases/team |
| *(removed)* Mothership, Survival, Team DM | ❌ | historical; listed only so they aren't "missed" |

**26. Maze — SHIPPED 2026-07-30, wall geometry and bullet behaviour REOPENED 2026-07-31 as wrong.**
(`rooms/Maze.js`; the `KIND.WALL` entity type and its physics were item 2's wall-only slice, shipped
earlier the same day.) The room-level pieces below (arena tuning reuse, minimap dots, the 5-hour
close, Arena Closer pass-through) are still fine and still SHIPPED. **Two things are not, per a
human correction, and need a real redesign session — do not assume the fix is a quick tune:**
- **Wall shape is wrong.** Real diep Maze walls are **rectangular chunks of various sizes forming
  an actual maze layout** (corridors/rooms you navigate through) — not a chain of circular
  `WALL_STUD_R` studs approximating a blocky line. Every other entity in this tree's collision pass
  is a circle (HANDOFF §3), so giving a wall a rectangle hitbox is a real departure from that
  convention, not a constant tweak — it needs its own collision-resolution arm (AABB or
  circle-vs-rectangle) in both `entities/Player.js` and `entities/Bullet.js`'s `KIND.WALL` cases,
  plus a maze-layout generator (corridors/rooms) to replace `build()`'s "1-3 bent legs of studs"
  algorithm.
- **Bullet contact is wrong.** A bullet touching a maze wall should be **destroyed on contact** —
  deleted, the way a base's own boundary behaves — not bounced. `WALL_BOUNCE`/`WALL_FRICTION`
  (`lib/constants.js`) are the wrong model for bullets entirely; they may still be right for a
  *tank* (tanks can't cross a wall — some form of solid blocking is still needed there, bounce or
  a hard stop, that's part of the redesign call) but a bullet's arm needs to change from
  reflect-and-decay to `this.destroy = tick.DES` (the same one-line pattern a base drone already
  uses for "dies instantly on contact," HANDOFF §3).
- **Scope note:** this touches the entity shape convention, the wall generation algorithm, and both
  movers' `KIND.WALL` collision arms — worth its own session and its own design pass, not a
  same-session patch onto Dominator work. `WALL_STUD_R`/`WALL_STRUCTURE_DENSITY_GU2`/`WALL_BOUNCE`/
  `WALL_FRICTION` (`lib/constants.js`, `rooms/Maze.js`) are all up for replacement, not just retuning.
- **Not yet reopened:** the room-level SHIPPED bullets below (arena tuning, minimap dots, the
  5-hour close, Arena Closer pass-through, no-boss-in-Maze) — kept for their own do-not-re-fix
  reasons, listed for completeness now that the heading above no longer means "all of this is
  settled."
- **The mode is `Ffa`'s own tuning, verbatim** — diep_wiki's own framing is "works similarly to
  Free For All", so `Maze` states the identical `mapSize`/`shapeMix`/`botCount`/`respawnPow`/
  `maxXp` rather than inventing a second tuned arena. `test/rooms.js` pins the arena at ffa's own
  `gu(451)`.
- **Wall chains — SHIPPED, generation and placement.** `build()` runs once in the constructor
  (before the first tick, `this.map` already the real arena size) and scatters "structures": 1-3
  straight "legs" turning ±90° from the last (a blocky right-angled corridor, not diep's own
  algorithm — it states none), each leg a chain of `Wall` studs (`WALL_STUD_R = gu(3)`) spaced at
  1.5× their own radius so consecutive studs overlap enough that neither a straight run nor a
  90° joint has a seam a bullet could thread. One structure per `WALL_STRUCTURE_DENSITY_GU2` (8000)
  gu² of arena — measured 200-260 total studs at ffa's own arena size across repeated rolls, not
  tuned against anything diep states (it gives no geometry or count at all). A chain stops
  extending once it enters the map-edge OOB inset (`WALL_EDGE_MARGIN`) rather than wandering into
  the dark band past the drawn arena. **Untuned by design**, on the same footing as
  `WALL_BOUNCE`/`WALL_FRICTION` themselves — due a real playtest pass now that a Maze room exists
  to actually look at.
- **Visible on the minimap — SHIPPED.** `buildWalls()` precomputes one dot per stud
  (`rooms/Room.js`'s `this.wallDots`, team index 4 = 'gray', a colour no live team dot ever uses)
  in the same pass that spawns the walls, rather than `getUi()` walking `INSTANCE.walls` for every
  viewer on every UI tick — safe because a wall never moves and this mode's arena is fixed size
  (`arenaLive` is not set), so the precomputed map-fraction coordinates never go stale. `getUi()`
  appends `this.wallDots` (empty on every other mode) to the ordinary player-dot array, so no new
  wire record was needed — just a second colour on the existing one.
  **This is what forced `TYPE.UiUpdate.array` (`SocketSchema.js`) from `uint8` to `uint16`**: a
  measured 200-260 wall dots plus a room's live player dots routinely exceeds 255, and a truncated
  uint8 length prefix would desync the rest of the packet silently (the encoder still writes every
  real record regardless of what the truncated header claims) rather than fail loudly. `test/
  proto.js`'s `UiUpdate` wire vector moved with it (three count fields × 1 byte each) —
  reproduced by hand from the encoder itself, not guessed.
- **Walls have friction and bounciness, deal no body damage, and a drone dies instantly on
  contact** — SHIPPED as item 2's wall-only slice, unchanged here.
- **Bosses do not spawn in Maze at all — SHIPPED, and needed no code.** `Maze` states no
  `bossRng`/`maxBoss` override, so it inherits `DEFAULT_RULES`' never-roll defaults — the same
  defaults `Ffa` itself already runs on.
- **The 5-hour close and its Arena Closer swarm — SHIPPED**, reusing rather than re-deriving
  `rooms/Tag.js`'s own win-condition machinery (PENDING #28): `close()` counts down a flat
  wall-clock deadline (`CLOSE_AFTER`, divided by `clock.STEP_MS` like Tag's `SHRINK_EVERY` — a
  schedule, not a per-reference-tick constant) and calls `startClosing()` once, which spawns a
  fixed `CLOSER_COUNT` (4, same reasoning as Tag's own) burst of Arena Closers via a `createCloser()`
  duplicated verbatim from Tag's rather than shared — the two modes' *trigger* for closing (a flat
  timer vs. a win condition) differ enough that a shared method would need a hook of its own for
  what "closing" means, for a saving of about twenty lines. `respawn()` no-ops once closing, same
  override and same reasoning as Tag's.
  **An Arena Closer's own bullets now pass through a wall too** (diep_wiki/Arena Closer.txt: "The
  Arena Closers and their bullets can go through the Maze game mode's walls") — a `Bull.closer`
  flag set at the `entities/Player.js` shoot() site (a bullet has no live reference back to its
  origin) that `entities/Bullet.js`'s `KIND.WALL` arm checks before doing the bounce physics, the
  same exemption `Player.js`'s own `collision()` already gives the closer tank itself.
- Known diep bug deliberately **not** reproduced: barrels aren't part of the hitbox, so they poke
  through walls and can shoot through double corners at exactly 45° — nothing in this tree's
  collision model special-cases a barrel's position at all, so there is no such gap to begin with.

**27. Domination — SHIPPED 2026-07-31**, except the `H`-key piloting mechanic (below), which is
**designed but deliberately not built this session** — the user asked for the design call to be
made without the implementation, so its own subsection below is a decision record, not a shipped
line. A Dominator is a **stationary tank** (`CONFIG.BOSS`/`CONFIG.CLOSER` pattern, `lib/gameAI.js`'s
`CONFIG.DOMINATOR`: an ordinary `Player` with `motion`/`update` bound at spawn, same as
`createBoss()` and Tag's Arena Closers, #28), not a new static `kind`.
- **4 Dominators, stationary, on a 2-team map — SHIPPED.** `rooms/Domination.js` extends
  `rooms/TwoTeam.js` (a new `extraRules` constructor param on `TwoTeam` merges over its rules
  object — `{gm:'domination', xpMul:2}` — rather than duplicating TwoTeam's whole base/drone/colour
  block for two fields) and places all 4 from its own `build()` hook, the same pre-tick hook
  `rooms/Maze.js`'s wall generation runs from. **Layout is a loose diamond around the arena centre,
  untuned by design** — diep_wiki/Domination.txt gives 4 Dominators and no coordinates at all, the
  same footing Maze's wall placement shipped on (#26 as it stood before its own reopening) — due a
  real playtest pass once a human can see the map.
  Neutral (yellow, team 2 — `DOMINATOR_NEUTRAL_TEAM` in `lib/gameAI.js`) until captured; capture =
  drop HP to 0 and land the last blow. An **enemy** Dominator takes **two** knockdowns — first back
  to neutral, then to yours; a **neutral** one takes **one**. Capturing refills its health, despawns
  its projectiles (a `bull.destroy = tick.DES` sweep over `INSTANCE.bullets` keyed on `origin.oId`),
  recolours it (a normal `this.team` write — `entityColor()`/`leaderColor()` already read team,
  no client change needed). All of this is `lib/gameAI.js`'s `dominatorCapture()`, which runs
  instead of the ordinary death path the moment `update()` sees `destroy` set — `collision()`
  itself is the unmodified `entities/Player.js` method, so a Dominator takes damage exactly like
  any other `Player`; only what happens at 0 HP is replaced. A knockdown credited to a non-player
  (e.g. `murder = ['objs', ...]`, a shape's own body damage) heals it with no team change, since
  there's no team to credit.
- **Stats — SHIPPED.** Base health **5998**, weak regen (diep_wiki/Stats.txt's own 0-Regen-point
  linear/hyper rates, `entities/Player.js`'s identical formula reimplemented rather than shared,
  since a Dominator's `update()` is fully replaced and never reaches `Player.prototype.update()`),
  no upgrades (nothing ever calls `upgrade()`), **no recoil** (`back: 0` on every cannon), cannot
  move — enforced two ways: `motion()` is a real no-op, AND `update()` snaps `x`/`y` back to the
  spawn point and zeroes `vec` every tick, since `entities/Player.js`'s own tank-vs-tank overlap
  resolution (nuance 44) moves BOTH bodies on contact regardless of either one's `motion()`, so a
  ramming tank would otherwise still shove a "stationary" Dominator a little on every hit.
  **The "+2/level, level 75 → 6148 HP" figure is not implemented** — a Dominator never levels (no
  XP-driven growth path in its own `update()`), and this engine's level cap (45) never reaches
  diep's hypothetical level 75 anyway; 5998 is used as a flat constant.
  **Its body is a boss-style circle, `size: 64`, the same stand-in `createBoss()` uses — flagged
  unsatisfactory by a human, see #51.**
- **Three variants — SHIPPED**, `public/SHARE/TanksConfig.js` (client + server, `exports.list`),
  each reusing the existing auto-turret `DETEC`/`autoDir`/`autoShoot` machinery Auto Gunner/Auto
  Trapper already use rather than any bespoke targeting code (see the AI paragraph below).
  **Numeric methodology, flagged rather than silent:** diep_wiki/Dominator.txt states pene/damage as
  multiples of "a tank" — diep's own universal 0-point bullet baseline, `MEASUREMENTS.md`'s pinned
  2 HP / 7 damage per loop. Bullet magnitudes aren't diep-adopted in this tree yet (`MEASUREMENTS.md`'s
  **M1**), so — the same call #17/#18's body-damage-magnitude fix already made for an identical
  problem — every multiple is applied to **our own** corresponding live number (Basic's own
  `can.pene` 1.7 / `can.damage` 4.84848, the closest thing this engine has to "a tank's" baseline
  bullet) rather than diep's raw absolute figure, which would land on the wrong scale next to every
  other cannon in the table.
  **Reload/pene/damage/speed stand-ins below — RESOLVED 2026-08-01 (plan.md Step 11)**, against
  `diepcustom/src/Const/TankDefinitions.json` directly rather than diep_wiki's prose paraphrase.
  Kept here as a do-not-re-fix record of the final numbers, not as open flags any more:
  - *Destroyer Dominator* — 1 cannon; pene **170** (100× 1.7), damage **48.4848** (10× 4.84848,
    both confirmed exactly by `TankDefinitions.json`'s own `health 100`/`damage 10`), Hybrid-sized
    bullet (`size: 27`), reload **45** (`15 × barrel.reload 3`, was **46**, a Hybrid-at-3-points
    approximation), bullet speed **1.12** (`1.12 × diep bullet.speed 1.0`, was **0.2896128**, an
    ours/flagged/approximate guess).
  - *Gunner Dominator* — 3 cannons, evenly spaced (120° apart, not Gunner's own forward-cross
    layout); pene **8.5** (5× 1.7), damage **4.84848** (1× 4.84848, both confirmed exactly by
    `TankDefinitions.json`'s `health 5`/`damage 1`), reload **5** (`15 × barrel.reload 0.3 = 4.5`,
    rounded to the nearest reference tick — was **54**, a 12× overestimate the step body itself
    calls out as "the big correction"), bullet speed **1.344** (`1.12 × 1.2`, was Gunner's own
    "normal" 0.511936).
  - *Trapper Dominator* — 8 launchers, evenly spaced; trap pene **34** (20× 1.7, was **25.5**/15×
    — the one case `TankDefinitions.json`'s own `health 20` actually disagreed with diep_wiki's
    "30 HP, x15 tank" prose), trap damage **14.54544** (3× 4.84848, was **17.454528**/3.6× — same
    correction, `TankDefinitions.json`'s `damage 3` against diep_wiki's "25.2, x3.6 tank"), reload
    **23** (`15 × barrel.reload 1.5 = 22.5`, rounded — was **25**, Trapper's own base at 0 points),
    auto-fire always on (`auto: 1`, diep's own `forceFire: true`). Trap speed **4.48**
    (`1.12 × diep bullet.speed 4.0`, was **0.45**, our own maxed-Trapper-with-headroom guess —
    confirms diep_wiki's "above a maxed Tri-Trapper" was directionally right, just not quantitative).
  FoV (each variant's `DETEC.size`/`maxDis`, and `screen`) is **still open**, not touched by Step 11:
  Destroyer 1664 (Sniper's own screen), Gunner 1920 (Assassin's, a mid-band stand-in), Trapper 2208
  (Ranger's, this tree's closest analog to diep's "Hunter") — diep_wiki says only "roughly
  Sniper-to-Hunter range depending on variant", so all three stay **ours, flagged, approximate**.
- **AI — SHIPPED, and cheaper than the spec first read.** Targeting/leading/FoV-hold needed **no
  bespoke code**: `entities/Player.js`'s own `shoot()` already does exactly that for any class whose
  cannons carry `autoDir`/`autoShoot` (the same machinery Auto Gunner/Auto Trapper already ship on)
  — the class's own `CLASS[...].DETEC` picks the nearest target in priority-type order and holds it
  until it dies or leaves `DETEC.maxDis`, and `shoot()`'s `autoDir` branch already leads a moving
  target the way an ordinary auto-turret does. What `lib/gameAI.js`'s `dominatorUpdate()` actually
  adds: dropping a target that has stopped shooting back (a new `lastAttacker` field,
  `entities/Player.js`'s `collision()`, written whenever hp actually drops — inert for every
  ordinary `Player`, the one consumer being this reader; `DOMINATOR_RETARGET_IDLE` = 3s, diep_wiki
  gives no number, **ours, flagged**), and refusing a shape/boss target while neutral (the simplest
  correct statement of "neutral cannot damage shapes/bosses": a bullet that never fires at one can't
  damage one).
  **Simplification, flagged rather than silent:** "falls back to polygons/bosses/closers" reads as a
  THIRD priority tier below ordinary players; a boss/closer is a `KIND.PLAYER` instance in this
  engine (flagged `.boss`/`.closer`), so `DETEC`'s own type-order bucketing only gives two tiers
  (players-including-bosses/closers, then objects), not three. Left this way deliberately rather
  than hand-rolling a second search past the shared `Detector` — a boss/closer is rare enough that
  the distinction is unlikely to matter in a live match.
- **Sandbox spawnability — SHIPPED**, the same pattern as `summonRandBoss`: a `summonDominator`
  admin command (`lib/Controller.js`), optionally naming a variant (`destroyer`/`gunner`/`trapper`),
  calling the same `createDominator()` any Domination room uses.
- XP gain is **doubled** — SHIPPED (`rules.xpMul: 2`, the same field Tag's ×3 already uses).
- **`H`-key piloting — DESIGNED, NOT BUILT** (by explicit request this session; a Dominator has to
  exist before this makes sense to build against). The design call, so a future session doesn't
  have to re-derive it:
  - **What "at the cost of your own tank" means.** Piloting doesn't move a socket's control from one
    live `Player` object to another — it can't, cleanly, without duplicating every input-handling
    site. Instead, reuse `entities/Player.js`'s existing `state.disconnect` mechanic *without*
    actually disconnecting the socket: the moment a human's own tank is vacated, set
    `state.disconnect = 1` on it (the same flag a real disconnect sets), which already makes
    `motion()` ignore WASD and `update()` chip its HP down over time (see `update()`'s
    `this.state.disconnect` branch) — so the vacated tank sits idle and slowly dies exactly the way
    an abandoned connection's tank already does. That *is* the cost the wiki phrase describes, for
    free, with no new decay mechanic to invent.
  - **What piloting actually grants.** A Dominator "cannot move" even while piloted — diep's own
    Dominator is permanently immobile regardless of who's notionally driving it, so piloting is
    **aim and fire only**, not a movement grant. Concretely: temporarily rebind the target
    Dominator's `motion`/`update` from `lib/gameAI.js`'s `CONFIG.DOMINATOR` functions to ordinary
    `Player.prototype.motion`/`update` would be wrong (it would let the "stationary" tank move); the
    right shape is a THIRD small function pair — reuses `dominatorUpdate`'s regen/idle bookkeeping
    but reads real `this.inputs.mouse_x/mouse_y/mouseL` instead of running the auto-turret DETEC
    scan, i.e. `shoot()`'s ordinary manual-fire path instead of its `autoDir` branch. `motion()`
    stays the same no-op either way.
  - **Ownership/one-at-a-time.** A `pilotedBy` field on the Dominator instance (the piloting
    socket's `id`), set on entry and checked before honouring another player's `H`; cleared when the
    pilot's own vacated tank finally dies (the `state.disconnect` chip damage above) or presses `H`
    again to return. The socket's own `oId` is NOT reassigned — net/gameSocket.js keeps routing that
    socket's input packets to the SAME slot it always has (the pilot's own now-idle tank); what
    changes is which entity's `inputs` object those packets actually get copied onto (a redirect at
    the input-application site, not a slot swap), and which entity the view/camera centres on for
    that viewer specifically (`getBuffer()`'s per-viewer main entity).
  - **Explicitly out of scope for the design call:** the exact input-application redirect site
    (`net/gameSocket.js` vs `rooms/Room.js`), and whether `H` targets "nearest friendly Dominator in
    range" or requires being adjacent/touching one — both are implementation details for whichever
    session actually builds this, not decisions that change the shape above.

**28. Tag — SHIPPED** (`rooms/Tag.js`). 4 teams, no bases, random spawns. Killing a player
**converts them to your team** on respawn; dying to a polygon keeps your colour; suiciding into a
colour is a legitimate way to switch. Leaderboard shows **player counts per team**, not scores.
Arena **shrinks every ~12–13 s**. XP ×3.

- **Win condition / Arena Closers, also shipped:** once one team holds every player, `winner()`
  fires `startClosing()` once, spawning a fixed burst (`CLOSER_COUNT`) of Arena Closers — a
  `Player` bound to `CONFIG.CLOSER` (`lib/gameAI.js`), the same pattern `createBoss()` uses. They
  are invincible, deal no damage/knockback on contact (`entities/Player.js`'s `collision()`
  short-circuits for `this.closer`), and never die, so a fixed burst is the whole mechanism —
  `respawn()` no-ops once closing, so the match ends by the room going empty and self-destructing
  the normal way. **`CLOSER_COUNT` is 4, not diep's "up to 16"**: this room's 30-slot cap (10 join
  + 16 seated bots) usually can't fit 16 more, and an immortal Closer never needs replacing, so a
  smaller burst hunts a match this size down just as certainly, only slower. **Its body is a
  boss-style circle, `size: 64`, the closest tank-scale stand-in this tree had — flagged
  unsatisfactory by a human, see #51.**
- The invisibility floor (`rules.invisFloor`, `rooms/Tag.js`'s `INVIS_FLOOR`) replaces the hard-0
  stealth floor in Tag only — diep_wiki gives no number for it, so this value is ours, flagged as
  such rather than presented as measured.
- **A real latent bug this surfaced and fixed:** `tagging()` used to re-evaluate live
  (`Math.min(teamCounts()) >= MIN_PER_TEAM`), which froze `respawnTeam()`'s conversion the moment a
  team got weeded down below the minimum — exactly when the match should be closing in on a
  winner. It's a one-time latch now (`this.tagged`), matching diep_wiki's own one-time framing.
- **Two judgement calls worth not undoing:** `botCount` is 16 across 4 sides specifically to keep
  the tagging gate ("each team needs ≥4 players") open — dropping bot count silently turns tagging
  off. And `teamCounts()` **counts dead-but-respawning players**, because filtering them made the
  gate and the leaderboard flicker on every single death. `test/rooms.js` pins all of the above.

**Deliberately not itemised here:** Breakout (claimable tile grid, tiles block outside fire, a
camping-reset rule that instakills squatters) and Capture the Flag (3 bases/team, carryable flags,
a mid-map barrier that drops after a few minutes, first to 10). Both are bigger than Maze and
Domination combined. Listed for a complete roster, not because they're next.

**Sandbox gaps — the four cheat keys SHIPPED 2026-07-31, the rest still open.** `K`/`O`/`\`/`;`
(`net/gameSocket.js`'s keydown/keyup dispatch, `entities/Player.js` for the actual behaviour,
all sandbox-gated the same way `O` always was) are done: `K` is now a genuine held input
(diep's own hold-to-repeat, climbing one level every `SANDBOX_LEVELUP_TICKS` — 200ms, **ours**,
diep gives no rate) rather than the instant jump-to-cap it used to be; `O` self-destruct was
already there and is unchanged; `\` (`Player.cycleClass()`) previews any real playable tank with
none of `upClass()`'s tree/level gating, filtered off `TanksConfig.js`'s `exports.list` so it never
lands on a dev placeholder or the boss/Closer/Dominator entities; `;` toggles `dev.god`, wired
directly into `collision()`'s existing (previously dead — nothing ever set `option.type`) repulsion
branch as a same-shape guard to `dev.ghost`/`this.closer`, so a god-mode player takes no consequence
from any contact and shoves whatever touched it away. Tested directly (`test/rooms.js`'s
`sandboxTests()`). **Still open, and NOT touched by this pass:** party-link invites, arena size and
shape count scaling with player count, bosses still spawning after 50–60 minutes.

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
     the aim direction (`test/client.js` asserts the alignment directly — this is a "confirm it
     *feels* right" check, not a "confirm it works" one).
   - The camera has a *slight* trailing lag (`CONST.CAM_SMOOTH`) — confirm it reads as a hair of
     chase, not drift. Playtest-tuned on top of a since-fixed input-prediction bug, so it needs a
     genuine human retune with the game open.
   - A green "shiny" polygon and a rainbow "Mythic" one are both visibly distinct from an
     ordinary shape (`public/SHARE/ObjectsConfig.js` — confirm the tuned chances still turn them
     up often enough to notice in a normal session).
   - The minimap shows other players' dots, not just your own, moving smoothly, with a thin dark
     frame in every mode (`Room.getUi`'s `map`, `Ui.map()`/`MAP.lw` in `public/client/ui.js`).
   - Level 1 vs. level 45 with Movement Speed maxed: confirm the tank doesn't rubber-band
     differently at the two speeds. A maxed level-30 tank now keeps 0.96× a fresh spawn's speed
     (was 0.79×) — leveling shouldn't quietly take mobility away anymore. At the 45-level cap the
     figure is 0.82× (`1.07^7 / 1.015^45`), diep's own endgame ratio — judge the feel against diep,
     not against the 0.96×.
   - **The upgrade economy is diep's now** (#30, shipped). Four browser-only checks: each stat bar
     draws **7** segments (widget correspondingly wider — confirm it still fits its corner at a few
     UI scales); a fresh spawn shows **no** point to spend (first arrives at level-up to 2); the
     class picker opens at **15/30/45**, not 9/19/29; and levels 29–45 grant a point only every
     third level, so the badge stops ticking up every level near the cap by design.
   - **The tank moves at diep's speed now** (#14's magnitudes). Base top speed 284 → **362.25 u/s**
     (1.28×), drag scaled with it (e-fold time to top speed halved, 0.90 s → 0.42 s) — judge it as
     *responsiveness*, not just speed. Three knock-ons to check alongside it: **recoil at full
     strength** (a Destroyer's own kick should push it ~6 grid squares per shot, a Basic's ~0.4,
     measurable against the background grid — the live 25 ms tick now delivers it in full, was
     ~0.64×); **knockback at diep's numbers** (a Basic's bullet should shove a tank **0.666** grid
     squares per tick of contact, a Destroyer's only **0.2**, a Mega Trapper's trap 1.07, a tank
     *body* 1.6); **tanks are solid now** (nuance 44) — drive into another player and confirm you're
     held apart rather than sliding through, the bigger tank yielding less, no jitter or
     "stickiness"; and **base drones are faster, four times over now**
     (`BASE_DRONE_CHASE_SPEED` 423.7 → 501.7 → 527.2 → 559.2 → 546.36 → **756** u/s, the last move
     diep's own flat number replacing a measurement-pinned ceiling entirely, plan.md Step 10 — a
     drone now outruns even a maxed-Movement Sniper's own dash, so circling a base is no longer a
     survivable race on speed alone; `BASE_DRONE_DETECT` shrank at the same time (#23), so judge the
     two together, not the speed jump in isolation).
   - **Health and regen are diep's own numbers now** (#17). A fresh spawn is **50** HP, not 150 —
     confirm the bar reads that, not a stale cached number. At 0 Health Regen points, take a few HP
     off and watch the bar: it should creep back at diep's slow linear rate immediately (no more
     ~22 s dead flat), then **visibly speed up after ~30 s** of no further damage (hyper regen) —
     confirm that reads as a genuine rate change, not a glitch.
   - **Ramming deals diep's own body damage now** (#17) — a Basic's own body ram against a shape
     should feel roughly 2.86× its bullet's per-hit damage, not the old 1.75×, a ~1.6× jump in how
     hard bumping into things hurts (and is hurt by, tank-vs-tank). Base drones hit harder too
     (`BASE_DRONE_DAMAGE` moved with it) — confirm a lone drone still feels like "low damage,
     delivered extremely quickly" per the wiki, not a one-shot.
   - **The prediction lead is derived from a real RTT now** (#24a) — smaller than the old flat
     70-unit cap, scales with your actual latency/speed. Confirm your own tank still feels
     immediate on WASD and doesn't snap when the server position lands; throttling the connection
     should visibly widen the lead, not break it.
   - **Tank growth is diep's exponential now** (`28 * 1.01^level`, continuous). Confirm smooth
     growth while leveling and nothing keyed to `size` (barrel scaling, hitbox, minimap dot) looks
     off at the level-45 cap (`1.01^45` = 1.56× a spawn's radius).
   - **The `c` auto-spin** starts from wherever the barrel is pointing and spins from there;
     releasing leaves the tank facing where the spin stopped. The rate is diep's `1 rad/s` now
     (was ~0.455, 2.2× — confirm it reads as a spin, not a blur). A wire-timing race where
     toggle-off-then-on used to flick the barrel for one frame before snapping back is fixed
     (`rooms/Room.js`'s `getBuffer()`) but was only visible in a browser — press `c` on/off
     repeatedly and watch for it.
   - **The world is ~40% denser with shapes** (#19). ffa 725 → **1017**, 2team 555 → 800,
     4team 669 → 1012, diep's own 1-shape-per-200-gu² density. Only a browser can judge whether it
     reads as *diep-like* or cluttered — check farming speed at low level and frame rate / room
     tick under a busy 4team (nuance 45: 40% more entities is a real per-tick cost).
     `SHAPE_DENSITY_GU2` in `rooms/Room.js` is the knob if it's too much.
   - **Tag is a new mode and nobody has played it** (#28). Pick it in the menu, confirm no bases,
     leaderboard shows one row per team with a headcount, XP ×3. Get killed by a bot and confirm
     you respawn on that bot's team; dying to a polygon leaves you on your own team. Watch the
     arena shrink every ~12.5 s (glides, doesn't jump; stops at a floor). Play a match long enough
     that one team absorbs everyone and confirm Arena Closers appear, beeline for everyone left
     (winners included), are unkillable, one-shot-ish anything they touch, and that the room
     actually empties and self-destructs. **Stealth classes can't fully vanish here** — a
     `Manager`-class tank should stay faintly visible instead of invisible.
   - **Domination is a new mode and nobody has played it** (#27). Pick it in the menu, confirm 4
     yellow (neutral) Dominators sit between the two bases, XP ×2. Shoot one down to 0 HP and
     confirm it flips straight to your team and refills; have the enemy team knock YOUR captured
     Dominator down and confirm it goes back to neutral first, not straight to them (two knockdowns
     for an enemy-held one, one for a neutral one). Confirm a Dominator's own bullets vanish the
     instant it flips. Confirm it never physically moves even when several tanks ram it at once.
     Judge the untuned diamond layout and the three variants' feel (Destroyer's single heavy
     cannon, Gunner's 3-barrel spread, Trapper's 8-launcher ring) against diep — every approximate
     number here (reload/speed stand-ins where diep_wiki gave only a qualitative comparison) is
     flagged at the item itself, not a considered final tune. `H`-key Dominator piloting is
     designed (#27) but not built — nothing to test yet.
   - **Sandbox's four cheat keys are code-tested, not browser-played.** In a Sandbox room: hold
     `K` and confirm you visibly climb one level at a time (not an instant jump), stopping dead at
     45; press `\` repeatedly and confirm it cycles through real tanks, never a blank/debug
     silhouette or Summoner, and — as of 2026-07-31, explicit ask — also lands on Arena Closer and
     all 3 Dominators (`entities/Player.js`'s `CYCLE_EXCLUDE`, PENDING #51): expect their normal
     TanksConfig stats/cannons/body under your own WASD+mouse control, NOT the scripted AI's
     invincibility or wall-pass-through, since this is a raw stat/silhouette preview, not the real
     boss-scaffolding entity; press `;` and confirm you shove other tanks/bullets away on contact
     and take no damage from anything touching you, and that pressing it again turns it back off;
     `O` is unchanged (already-shipped self-destruct).
   - **Crashers are now light pink triangles that face what they're chasing, not grey ovals**
     (2026-07-31, explicit ask - `public/client/config.js`'s `Palette.bull`,
     `public/client/drawings.js`'s `Drawings.obj.bull = Drawings.obj.tri`, dropping `entities.js`'s
     old special case that routed `'bull'`-type Objs through `drawBullet`'s circle sprite instead of
     the shared shape table). The wire never carries a facing angle for a shape (only x/y) and
     Crashers are the one shape type that actually chases something (`entities/Objects.js`'s
     `this.DETEC` pulls a Crasher's velocity at whatever `KIND.PLAYER` it has detected, `HOME_PULL`
     every tick) — so `public/client/entities.js`'s `Obj.update()` now derives a Crasher's `this.dir`
     from its own frame-to-frame movement delta (`atan2` of the position change, turned toward
     smoothly rather than snapped, since motion direction and chase target are the same thing here
     by construction) instead of the passive constant self-spin every other shape keeps. Falls back
     to that same idle spin below a small movement-magnitude threshold (freshly spawned, parked,
     between DETEC pulls) so the heading doesn't jitter or go NaN when it isn't really moving.
     `test/clientDiff.js`'s golden did not move — the seeded 60-tick ffa/2team/4team/boss corpus
     never happens to spawn one (`rooms/Room.js`'s `bull` cap is 39 per room, a slow trickle, not
     guaranteed within any short window) — so this is confirmed unexercised by that guard, not
     confirmed correct. Watch a live match long enough for a Crasher to spawn and chase a tank
     (any mode; it's part of the general shape ecology, not mode-specific) and confirm it reads as a
     pink triangle whose point tracks the tank it's chasing, turning smoothly rather than snapping
     or lagging noticeably behind a direction change.
   - **Incoming bullets should now arrive when they look like they arrive** (#24b) — a pure *feel*
     check. Stand still and let a bot shoot you; it should connect on the frame it visually touches
     you, not slightly before. Judge under a throttled connection too. **Your own bullets are
     dead-reckoned too now**, ramped in rather than switched on across the muzzle-weld handoff —
     watch specifically for a pop or kink where an own bullet's interpolation takes over from the
     muzzle ride.
   - **Base drones and bases** — nothing here is covered by a browser-free test beyond placement
     and arithmetic:
     - 4team bases are coloured squares at corners (and on the minimap); 2team's strips match
       `baseSize`. 4team: 12 small triangles orbit each base, cutting across the ring every ~10 s.
       2team: 15 evenly spaced pairs down each side on tighter rings, same cadence.
     - Own drones phase through you (no damage/knockback/shove); your own bullets pass through
       them too.
     - Bullets fired into an enemy base die about a grid square and a half past the line, not on
       it. Standing in one kills you in about a second.
     - Kill a base drone: it dies and a new one is orbiting that post ~1 s later — the one most
       needing eyes on it, see item 23 on whether `BASE_DRONE_HP`/`DAMAGE` are on the right scale.
     - Walking into an enemy base: drones run you down fast (`BASE_DRONE_CHASE_SPEED`, pinned to
       the fastest sustained speed any build can hold, #14); a drone knocked off its ring sprints
       back and settles rather than orbiting the target radius.
     - **Drive around the outside of an enemy base through the dark grey border** — you shouldn't
       die out there and should be able to get the whole way round, including a 4team corner (a
       race between your top speed and `BASE_DRONE_CHASE_SPEED`, deliberately close).
     - Drones shouldn't stick to the arena edge — a chasing/returning drone should follow, turn,
       keep moving, never park flat against the boundary; leave, die, come back, and the base must
       chase you again.
     - **Walk into an enemy base in a maxed tank**: die in ~1 s to a full base, ~13 s to a single
       drone that's caught you alone — judge against the wiki's "low damage, delivered extremely
       quickly" and see item 23.
     - **Bait a base out to the arena corner, then die or leave**: every drone should turn for home
       on the tick the chase drops, visibly closer to base on the very next frame.
     - **Watch a returning drone all the way in**: one clean curve onto its ring, no crawling or
       peeling off through the base centre.
     - **Stand next to the Summoner inside a base's detect range in a team mode**: nothing happens
       until it hits a drone, then the whole base engages.
7. Chat over a real client connection — admin commands are proven end-to-end over a real socket
   against Postgres (connect/disconnect, permission gating, `broadcast`, `tps`), but chat hasn't
   been exercised the same way.
8. Real browser hitting the new packet-length validation (`chat`/`com` in particular) — a mistake
   here shows up as a kicked player, not a crash.
9. Load: multiple busy rooms at once on one process (everything so far is one room alone).
10. **The front-page menu (`views/index.ejs`/`public/queue.js`/`public/font.js`) — untouched by
    this checklist until now, since item 6 above is specifically the in-game client, not the menu.**
    First landed 2026-07-31 code-tested-only; the human then actually opened it in a browser and
    reported 3 real bugs the same day, since fixed (also code-tested-only again — still nobody has
    re-opened a browser on this since the fixes):
    - **`#gamemode-box`'s 8 mode buttons cap to `.right-zone`'s own height and scroll**
      (`public/queue.js`'s `syncGamemodeListHeight()`, a `#gamemode-list` wrapper div around the
      buttons). Bug found in-browser: the scrollbar thumb/track were visible, wanted invisible (like
      the achievements panel's own scroll feel) — fixed by dropping the styled scrollbar rules for
      `scrollbar-width: none` / `::-webkit-scrollbar { display: none }` in `public/style.css`;
      scrolling itself (wheel/touch/drag) is untouched. Confirm in-browser: the left column no longer
      towers over the right one, no scrollbar is visible, all 8 modes are still reachable by
      scrolling, and it re-syncs after the account chip's content settles and on window resize.
    - **`public/font.js`'s per-mode "door" background animation has a case for every mode** —
      previously `tag`/`boss`/`sandbox`/`maze`/`domination` all silently fell through to `ffa`'s own
      animation. `tag` took three rounds to get right; `domination` one:
      - `tag` v1 was "very laggy and uncreative" — 4 corner wedges, each with its own fresh
        `createRadialGradient` + full-screen `hard-light` `fillRect`, 4 full-canvas gradient fills a
        frame. v2 tried a single chaser-and-runner circle pair cut from one path via `evenodd` (the
        same one-hole trick `boss` uses) — but two big, nearly-identical circles overlap almost
        completely, and `evenodd` re-fills the *shared interior* at odd parity (rect + both circles
        = 3), leaving only the thin non-overlapping rim as the actual hole: "a huge white circle
        blocking the middle, a thin strip of map around it" — exactly backwards. v3 dropped to one
        circle (same one-hole trick as `boss`, anchored to a perimeter-walking point) which fixed the
        inversion, but a hole that grows to cover the whole screen once open still reads as "nothing
        there" at rest, not as a moving thing to notice. **v4 (current, explicit ask - "just the
        white circle around the screen... running around")** drops the hole-punch model entirely:
        paints a plain filled circle directly (no `evenodd`, no fill-rule to get backwards), big
        enough to cover the screen from any point on the perimeter while actually closing (`toOpen`
        near 1), shrinking to a small ball that keeps circling once open (`toOpen` near 0) instead of
        growing into something that blocks the view or vanishing into nothing.
      - `domination` "only shows a tiny sliver" — the original left a fixed ~180px-wide gap at the
        centre regardless of screen width, since the gap size never scaled with `Width`/`Height` the
        way every other mode's wipe does. Replaced with the same diagonal two-corner wipe geometry
        `2team` uses (which does scale correctly), green/red colours, plus a thin diamond *outline*
        (not a filled panel) stencilled at the centre so it never blocks the reveal.
      `boss` (radial iris, no literal silhouette — more bosses than the Summoner are coming per
      `diep_wiki`), `sandbox` (box lid, 4 edge panels, left/right leave a persistent thin frame — the
      literal spec given for it), and `maze` (alternating vertical slats in the wall-stud greys) had
      no complaints and are unchanged. Confirm in-browser: `tag`'s ball reads as a small circle
      visibly running around the screen's edge at rest, growing to cover the screen only during an
      actual mode-switch close, never sitting as a big static blocking shape; `domination`'s reveal
      is now a proper half-screen wipe like `2team`'s with a visible diamond accent, not a sliver;
      every mode's animation actually plays when clicked (not a leftover `ffa` flash); and none of
      them clip, flicker, or leave a visible seam at common window sizes.

## 🟣 Needs a human balance call

29. **Summoner's drawn barrel is short of its own spawn point, and fixing it is a visible boss
    silhouette change — left alone on purpose.** `public/SHARE/TanksConfig.js`: client `height: 44`
    vs server `canonLength: 50` (spawn radius `50 * .93 = 46.5`) is a **-2.5** gap; every other
    class draws its barrel a little *past* the spawn radius (band 0-12, median 4.2) so bullets
    appear at the muzzle tip — Summoner is the one class that runs the other way. The server's 50
    is a floor, not a free number to shrink: a boss's body radius is 64 (`rooms/Room.js`), and a
    drone's own trailing edge already sits only ~1 unit clear of the body at that spawn radius, so
    shortening `canonLength` spawns drones intersecting their own boss. The only way to close the
    gap is to grow the *drawn* barrel (44 → ~51), which makes the boss's barrels visibly longer
    (drawn tip 1.26× → 1.46× body radius) — a silhouette call for a human to make in-browser
    (`boss` mode, or `summonRandBoss`), not a mechanical sync. `test/tanks.js` whitelists all four
    `Summoner` cannons for exactly this reason.
    **The same check applies to every future boss.** `lib/gameAI.js`'s `CONFIG.BOSS` list has one
    entry (Summoner) today, but any later boss will hit the same tension the moment its body is
    drawn at a non-default `size` (`createBoss()` hardcodes `64` for all bosses today) — check the
    drawn-height-vs-spawn-radius gap deliberately for any new boss cannon table instead of assuming
    the ordinary 0-12 band applies. #51 below is this same tension arriving in practice, for two
    entities that aren't bosses at all.

51. **Arena Closer and Dominator both reuse the boss's stand-in body — a human has now looked at
    both and flagged them as unsatisfactory: shape, size, and behaviour all worth revisiting.**
    Neither diep_wiki's Arena Closer page nor its Dominator page states a literal shape/hitbox, so
    both were given the one large-stationary/scripted-tank body this tree already had a convention
    for: `createBoss()`'s circular `size: 64` (`rooms/Tag.js`'s `createCloser()` calls it explicitly
    "the closest tank-scale reference already modelled, for a tank the wiki calls Dominator-sized";
    #27's `createDominator()` made the identical call, "the closest existing convention for a large,
    non-levelling scripted tank"). Nuance 42 and #29 already predicted this tension would recur for
    any future boss-pattern entity — it now has, twice. **SHAPE and SIZE are now both fixed on both
    entities — kept only as a do-not-re-fix record; the one thing still open is below.**
    - **Arena Closer's SHAPE half — FIXED 2026-07-31, and it turned out to be a rendering bug, not a
      design gap.** `size: 64` (the boss-scale radius) was the right call at the time — what was
      actually wrong is that `TanksConfig.js`'s "Arena Closer" client entry drew it with
      `body: {shape: 1}`. `public/client/drawings.js`'s `Drawings.body` array is `[circle, rounded
      rect, pentagon]` — shape 1 is a rounded RECTANGLE, not a circle, so the Closer was rendering as
      a square the whole time despite every comment in the tree describing it as "boss-style
      circle." diep_wiki/Arena Closer.txt is explicit ("a large yellow circular base"), so this is
      now `shape: 0` (plain circle, same index Basic/every ordinary tank uses). Confirmed human read:
      Summoner's own `shape: 1` square body is intentional (it's meant to be a square boss) and is
      NOT reopened by this — only Arena Closer's copy of it was wrong. `test/clientDiff.js`'s golden
      didn't move (Arena Closer never spawns in that corpus's short single-mode runs).
    - **SIZE on both entities, and Dominator's own SHAPE — FIXED 2026-08-01 (plan.md Step 11), with
      real diep citations behind both.** Arena Closer `size: 64 → 98` (`ArenaCloser.ts`'s
      `BASE_SIZE 175 du × 0.56`, `rooms/Tag.js`'s `createCloser()` and its duplicate in
      `rooms/Maze.js`). Dominator `size: 64 → 89.6` (`Dominator.ts`'s `SIZE 160 du × 0.56`,
      `rooms/Room.js`'s `createDominator()`) and `body.shape: 1 → 0` — diep's own `Dominator.ts`
      states `sides: 1`, the same circle Arena Closer's own citation gives, so the "real open
      question" this item used to flag is answered: a Dominator is a circle too, not a rounded
      rectangle. `test/clientDiff.js`'s golden did not move (neither entity spawns in that corpus).
    - **Still open:** AI *behaviour* on both (not just the body) against diep_wiki's own description,
      and the restructuring question below. **A human's own framing, worth keeping verbatim for
      whoever picks this up:** Arena Closer and Dominator are reusing the *boss* class as
      scripted-tank scaffolding, and technically each deserves its own class rather than borrowing
      the boss's — that restructuring is still undecided and unscoped, not just the shape/size
      numbers on top of it. (plan.md Step 11 also landed the last of #27's flagged reload/speed
      stand-ins for the three Dominator variants — see #27 below.)
    - **Sandbox `'\'` preview opened up to these 4 classes — 2026-07-31, explicit ask, "for now."**
      `entities/Player.js`'s `CYCLE_EXCLUDE` no longer excludes Arena Closer or the 3 Dominator
      variants (Summoner still excluded — it wasn't part of the ask and is a boss, not a
      Closer/Dominator). This previews only the `Player`-class stats/cannons/body a human cycles
      onto, not the real scripted `CONFIG.CLOSER`/`CONFIG.DOMINATOR` entity's invincibility or
      wall-pass-through — a quick way to eyeball the shape/size fixes above without waiting on the
      "own class" restructuring, not a substitute for it.

## ⚪ Nuances to iron out — small open threads, none of them blocking

*Not items in their own right; each is a detail that will cost a session if rediscovered rather
than remembered. Anything that is genuinely a decision has its own numbered item above.*

### Live right now — the tree is in a knowingly-wrong state

31. **`weight` and `push` are two different things that used to be one field — do not merge them
    back.** Splitting them let #16's knockback rewrite land without moving bullet or drone
    behaviour by a single unit.
    - **`weight` is knockback dealt to a TANK.** One consumer: `entities/Player.js`'s `KIND.BULLET`
      arm, `tick.impulse(other.weight / 3 * 1.6)`. It's diep's Knockbackfactor table × 5.25.
    - **`push` is the bullet's own bounce off whatever it hit.** Three consumers, all in
      `entities/Bullet.js`'s `collision()`, decayed through the bullet's own `BODY_FRICTION`. It
      carries the pre-#16 `weight` values verbatim — that half of the old field never had a
      reference behind it.
    The two mechanisms differ by ~14× in what they do with the same number (`push` displaces
    `weight × 13.76` units, knockback `× 5.33`), and the rewrite moved individual entries
    non-uniformly (×0.77 to ×12.8), so no single divisor could carry the old behaviour through both.
    `rooms/Room.js`'s base drone sets both by hand (`weight = 4.2`; `push = 2`, what the single
    field used to be) — its `push` is genuinely load-bearing, since base drones hold a ring.

32. **SHIPPED — `BASE_DRONE_CHASE_SPEED`/`_TURN`'s pin to a live measurement is retired
    (plan.md Step 10, 2026-08-01).** Kept as a *do-not-re-fix* record of the history, since the
    numbers it built up (546.36 u/s at the pin's end) are still cited elsewhere. It used to be
    pinned to `fastestTankSpeed()` in `test/rooms.js` (replaying `motion()`+`shoot()` over every
    class at max Movement/Reload), so any retune that moved the speed ceiling moved this pair with
    it: 501.7 → 527.2 (the `back` rescale) → 559.2 (the one-shot-impulse fix) → **546.36** (#15's
    reload-stat form becoming diep's geometric `0.914^points` — a maxed-Reload build fires less
    often, so the fastest recoil-rider carries less recoil premium). `#16`'s `weight` column never
    moved the ceiling at all — knockback only enters through contact, which a solo speed replay
    never has. **Now**: `BASE_DRONE_CHASE_SPEED` is diep's own flat **756 u/s**
    (`diepcustom/src/Entity/Misc/BaseDrones.ts`, `bullet.speed 2.7` — `20 × 2.7 × 0.56` units/
    ref-tick), pinned to nothing, outrunning even the old measured ceiling by ~38%.
    `BASE_DRONE_CHASE_TURN` moved with it (`turn = speed_u_per_s / 60 / 25`, the same identity
    every prior re-pin used — now **0.504** rad/ref-tick = 12.6 rad/s). `test/rooms.js`'s
    `fastestTankSpeed()` is still computed and logged in `baseDroneAiTests()` for context (a cannon
    retune that pushes the roster's own ceiling past 756 u/s is now at least visible), but nothing
    asserts agreement with it any more. `BASE_DRONE_DETECT` dropped in the same step
    (`gu(60) → gu(18)`, see #23), so the "race" this pin used to protect (circling a base in the
    fastest tank stays survivable) is gone by design — flagged as a real balance consequence in
    plan.md Step 10's own note, not pre-tuned back. **Do not restore this pin** — the reload-stat
    candidate it used to flag as "the last thing that could move it again" has already fired and
    is folded into the 546.36 figure above; there is nothing left pending on it.

33. **`V_max = 10·A` is exact only at the 40 ms reference — our live 25 ms server runs 1.8% over
    it.** `Physics.stepBody`'s steady state rises from 362.25 u/s (at `d=1`) toward 380.1 u/s
    (`d→0`); at the live `d = 0.625` it's **368.9**. Ordinary semi-implicit Euler drag error, and
    it *grew* with the heavier friction (was 0.8% before). Quoting "362.25 u/s" is quoting the
    reference, not the server — fine for comparing against diep, misleading if someone measures
    in-game and finds 369. `test/rooms.js`'s tick-scale band widened 2% → 3% for this reason.
    **If this ever needs to be exact**, the fix is an exponential integrator (solve the continuous
    ODE the `d=1` recurrence samples) rather than nudging constants — but that changes the meaning
    of every per-reference-tick constant in the tree, so it's a pass of its own, probably not worth
    1.8%.

34. **`test/clientDiff.js` seeds ONE global RNG across all four rooms built in sequence, so a
    physics change can relocate the camera in the last three modes** — mode *N*'s divergence shifts
    mode *N+1*'s `Init()` (different spawn point, different bot roster) before a tick runs.
    **Rule of thumb:** a change to how many ENTITIES exist, or how long one LIVES, shifts the
    random-draw stream (and every downstream mode's positions with it); a change to how existing
    entities MOVE or how much health they have usually doesn't. Worked example of each: the shape-
    density change (#19) moved `ffa`'s draw count 8217 → 10770 (more placement draws), shifting
    every later mode; the one-shot-impulse fix and the damage-model change left the cumulative
    count identical at all four boundaries (pure position drift); `PROJECTILE_BODY_DAMAGE`
    (bullets surviving longer in contact) shifted the stream starting in `ffa` itself.
    **The technique that makes this legible:** override the suspect constant at load time and
    re-run the corpus once per candidate cause — each cause gets its own hash, and the ones that
    contribute nothing are *proved* to contribute nothing rather than assumed. **If the illegible
    deltas become a nuisance, the fix is to re-seed per mode** so each room's corpus is independent
    — deliberately not done yet, since changing the corpus and the physics in the same commit would
    make neither reviewable.

35. **SHIPPED — `BODY_FRICTION` moved, not deleted (plan.md Step 9, 2026-08-01), the opposite of
    this note's own prediction.** `physics.html` has no drag term for a bullet, but
    `diepcustom/src/Entity/Object.ts:274` and `diepindepth/physics/README.txt` §3 both confirm the
    real diep source applies a universal 10% per-tick drag to every `ObjectEntity`, bullets
    included — so the maintained-velocity motion tail in `entities/Bullet.js` was already the
    right shape, and the fix was `0.956532 → 0.9`, not a structural deletion. Every per-cannon
    `speed`/`life` value moved with it, as this note predicted the scale of, just not the
    direction. The two things flagged here as already-separate and not-to-be-swept-up both landed
    correctly: the trap's own hand-rolled `.82` decay **was** swept up and deleted (Step 9,
    replaced by the same shared `BODY_FRICTION` every other bullet/drone/shape now rides — nuance
    35's own warning not to do this *while `BODY_FRICTION` was unresolved* no longer applies, since
    it is resolved now), while `entities/Objects.js`'s `vec.limit(…, BODY_FRICTION)` kept its
    capped-decay shape untouched, riding the new `0.9` automatically since it reads the constant by
    reference. Kept as a *do-not-re-fix* record of the (wrong) prediction rather than deleted, per
    this file's own precedent for a resolved-from-source item.

36. **SHIPPED — `PET_FRICTION`'s 2×-braking relationship is against `BODY_FRICTION`, not the
    tank's, and was recomputed (not just re-verified) when `BODY_FRICTION` moved (plan.md Step 9,
    2026-08-01).** Still exact (1.992040×, held to six figures rather than rounded): the pre-move
    pair gave `1 - 0.91341 = 0.08659` against `1 - 0.956532 = 0.043468`; at the new
    `BODY_FRICTION = 0.9`, `1 - fr = (1 - 0.9) × 1.992040`, so `PET_FRICTION 0.91341 → 0.800796`.
    The hazard this note originally warned about still stands and is unchanged by the move: a
    future reader "restoring" the ratio against the tank's `10/11` instead gives `fr = 0.8182` and
    a pet that brakes ~2.2× harder and parks behind its owner. Documented at the constant in
    `lib/gameAI.js`; this is the second copy.

### Documentation and tooling drift

37. **Prose in `HANDOFF.md` and `PENDING.md` goes stale silently — nothing tests it.** The
    tank-magnitudes pass found stale consumer counts, a stale stat-cap docstring, and wrong file-map
    line counts in `HANDOFF.md`. **When a step changes a number, grep the tree for the old number,
    not just for the constant's name** — that's what caught `284` surviving in `test/client.js` and
    `public/motion.js`. **Two known false-positive near-collisions**: Gunner's bullet `speed`
    `0.511936` vs the old `MOVE_ACCEL_BASE` `0.511941`; the retired tank-body knockback impulse
    `0.43881` vs `0.438816`, a bullet `speed` eight unrelated drone/trap cannons share.

39. **Constants are denominated per `REF_TICK_MS` (40 ms) and converted at the consumption site.**
    Getting the `lib/tick.js` category wrong (`perTick`/`impulse`/`drag`/`ticks`/`chance`/
    `quadratic`/`lead`/`smoothing`) doesn't fail loudly — the value just silently stops being
    real-world-correct at the live tick rate. Read that file's header before adding any new
    per-tick constant; several existing constants are deliberately **flat** (`AUTOTURRET_LEAD`, the
    pet's `2.475`, `BOSS_DRIFT`) with reasoning at each site. **A one-shot velocity impulse into a
    body that reaches `Physics.stepBody`** (recoil, every Player collision knockback) is
    `impulse()`'s category, not `perTick()`'s — getting this wrong was the old nuance-43 bug. The
    reverse case — a one-shot impulse into a body that integrates its own `vec` directly with no
    separate `dtTicks` multiply (`entities/Bullet.js`, `entities/Objects.js`) — correctly stays
    `perTick()`; see that function's header for the derivation.

### Judgement calls already taken that a later step could quietly undo

40. **The economy conversion deliberately did not re-price XP.** `maxXp` still spreads the same
    25000/30000 over 45 levels instead of 30, so leveling is finer rather than slower. Re-pricing
    belongs with #19's shape density — but it *is* a live balance consequence (early levels arrive
    much faster), so if leveling reads as too quick, that's the knob, and it's a deliberate omission.

41. **The economy conversion's `parseInt(level / 15)` tier gate departs from PENDING's literal
    `parseInt((1 + level) / 15)`.** Our `level` is 1-based in diep's sense, so the `1 +` was an
    off-by-one that opened tier 1 at level 9. If a later reader "restores" the reference's
    expression, the gates silently become 14/29/44. `test/rooms.js` pins 15/30/45.

42. **`motion()`/`update()` replacement (not override) is now a three-way pattern, not just the
    Summoner's.** `rooms/Room.js`'s `createBoss()` does `b.motion = spec[0].bind(b)`, so a boss
    never reaches `Physics.stepBody` and none of the tank movement work applies to it — Tag's
    `createCloser()` (#28) and this session's `createDominator()` (#27) both deliberately made the
    identical call for the same reason (an invincible chaser and a stationary tank have no business
    running the WASD/friction integrator either). Any *future* entity built this way inherits the
    same shape — decide deliberately whether it should, alongside #29's drawn-barrel-vs-spawn-radius
    check (same "applies to every future boss-pattern entity" property) and #51 (both existing
    non-Summoner uses of this pattern are already flagged unsatisfactory on shape/size/behaviour).

44. **Tank-vs-tank positional overlap resolution — SHIPPED**, alongside #16's column. Kept as a
    *do-not-undo*: it's the one piece of collision behaviour in the tree with no diep reference
    behind it, raised by a human while #16 was being scoped and decided to build in the same pass.
    `entities/Player.js`'s `KIND.PLAYER` arm now pushes both bodies apart along their separation
    axis by their overlap, split by size (`share = other.size / (this.size + other.size)`), **in
    addition to** the velocity impulse. Because `rooms/Room.js` calls `collision()` on both sides
    sequentially, it behaves as a relaxation rather than a snap — a 10-unit-apart pair of 25-radius
    tanks reaches 45.3 units in one tick and clears contact on the next. Runs **before** the
    `noDam` break, since teammates take up space too.
    **Two non-obvious consequences.** First, "standing on top of another body" is now a state the
    engine actively destroys — `test/rooms.js`'s Summoner detection test re-asserts the player's
    position between its two steps for exactly this reason, modelling a player *holding* against
    the boss. Second, it made `lib/gameAI.js`'s boss aggro test unsatisfiable at low level (see
    nuance 49).
    **Left open on purpose: the tank-vs-shape arm has the same gap.** `entities/Objects.js` moves a
    shape through its own `weight` mass divisor (1 for a Square, 4 for a Pentagon, 100 for a boss
    shape), so resolving overlap there means deciding who yields against an existing mass semantic
    — against a 100-divisor Alpha Pentagon the answer has to be "the tank moves," a different edit
    in a different file, and it changes shape-farming feel in every mode. Real, scoped, and left.

45. **The arena/density work put ~40% more shapes in three of the five modes — a live per-tick cost
    as well as a live balance change.** ffa 725 → 1017, 2team 555 → 800, 4team 669 → 1012 (boss and
    sandbox barely moved). `test/clientDiff.js`'s ffa canvas-op count went **59534 → 92856 (+56%)**
    for the density change alone — the closest measurement of it the tree has. Intended (#19's whole
    point was that the world felt empty), not a regression, but the first thing to check if room
    tick time becomes a problem. Knob: `SHAPE_DENSITY_GU2` in `rooms/Room.js`.

46. **The "`rejectSample()` is unsatisfiable below ~2744 units wide" floor is retired, at the
    source — do not re-derive it.** It was real when carve-out radii were absolute; the
    arena/density work made every radius a fixed *fraction* of the arena (`room.nestScale`,
    referenced to ffa's gu(451), so ffa itself is unchanged by construction), so placement is now
    geometrically similar at every arena size and **no width exists at which the loop is
    unsatisfiable.** The iteration cap stays regardless — it bounds a caller passing its own
    circles, and `test/rooms.js` still drives an explicitly unsatisfiable configuration through it.
    If a comment still quotes 2744 as a live hazard, it's stale.

47. **`plan.md` no longer exists — every "plan.md step N" reference in the tree is a historical
    citation, not a broken link to chase.** It was the measurement-free work queue (the 45/7/33
    economy, diep's tank magnitudes, the friction split, recoil, health/regen, arena/shape density,
    Tag, bullet dead reckoning, most of the damage model) and was deleted once finished, never
    git-tracked, not recoverable. **Where the reasoning went instead:** every load-bearing
    derivation was mirrored into `HANDOFF.md` §3 as each step landed; every part deliberately left
    unshipped became an open item in *this* file. A comment citing a step number tells you *when* a
    value was set; the current justification lives at the call site or in HANDOFF §3. **What did
    NOT survive:** the per-step `clientDiff` golden lineage (op-count/hash chain, isolation tables).
    If a future rebaseline needs that technique, nuance 34 describes it — rebuild from there.

48. **Comment style: a cleanup pass is wanted, and the target style is decided.** Comments should
    describe **what the code does** — the function, the invariant, the unit — not cross-file
    references (`see plan.md step 3`, `PENDING #19`), change history (`was 0.511941`), or narrative
    about why a past approach was wrong. Much of the tree is currently the opposite (`rooms/Room.js`,
    `entities/Player.js`, `public/client/entities.js` carry long historical blocks). **Scope when it
    happens:** strip references and history, keep/sharpen the functional statement (units, ranges,
    why a value is that value *in terms of the formula*, genuinely non-obvious invariants like
    "`pene` IS a drone's health pool"). The reasoning being removed should land in `HANDOFF.md` if
    not already there — a *move*, not a deletion. Worth doing in one deliberate pass, since it'll
    touch nearly every file and would make any other diff in the same commit unreviewable.

49. **A boss's aggro radius is smaller than its own hitbox at low level, and that only stopped
    mattering because tanks used to be able to stand inside it. Worth a `diep_wiki` cross-check.**
    `lib/gameAI.js`'s Summoner test is `dis / max(1, level) < screen / 30`, i.e. **65.6 units** for a
    level-0/1 tank — against a boss body radius of **64** plus a ~28-radius tank. The only way a
    fresh spawn ever satisfied it was by being *inside* the boss, which nuance 44's overlap
    resolution makes impossible; left alone it would have silently blinded every boss to
    freshly-respawned players (including `up.BPene = detected.length * .9`, so an unaggroed boss
    fires zero-penetration drones).
    **Fixed by measuring from the boss's HULL rather than its centre**, as a fraction of the raw
    distance (`(raw − size) / raw`) so it survives the metric's own 0.5625 y-squash — a flat
    subtraction would be worth 1.78× more along one axis than the other, which axis being random is
    the trap that made a first attempt pass and fail on alternate runs. At high level the boss's 64
    units are a ~2% widening of a ~2950-unit radius, so nothing above level 2 moved.
    **Still open:** nothing was checked against `diep_wiki` — diep has no boss of this shape, so the
    `screen / 30` radius, the `/ level` scaling and the 0.5625 ellipse are all ours, unreferenced.
    Whether a boss *should* aggro on contact regardless of level was answered here on gameplay
    grounds by a human; cross-check the whole aggro model against `diep_wiki/`'s boss pages when
    someone next has that file open.

50. **`rules.arenaLive` was declined for ffa/2team/4team (#19, 2026-07-30) — and if that decision is
    ever revisited, it's more than a flag flip for the two team modes.** `rooms/Room.js`'s
    constructor calls `this.dronePosts = this.basePosts()` **once**, and `TwoTeam.js`/`FourTeam.js`
    bake each base's `post.x`/`post.y` as absolute world coordinates at that one moment — consumed
    verbatim forever after, never recomputed. `tickArena()` keeps `baseSize`/`nestScale` current as
    the map lerps, but nothing rebuilds `dronePosts` alongside it. Sandbox and Tag never exposed
    this because neither has a base. Turning `arenaLive` on for 2team/4team would lay out every
    base's drone ring for the 150 gu starting floor and leave it frozen there while the arena grows
    around it — badly off-center. Fixing it for real means making `dronePosts` re-derive from the
    live map (rebuild on resize, or store as ratios of `baseSize` and recompute each tick) — real
    engineering, not a one-line rules change. ffa has no base and wouldn't hit this at all.

52. **Two stale citations found by plan.md Step 2's nuance-37 grep, left alone since they're outside
    that step's own file (`entities/Player.js`'s `upgrade()` switch) — not fixed, just flagged.**
    - `public/SHARE/TanksConfig.js`'s Arena Closer comment (~line 2846) derives its hardcoded
      `speed: 0.995491` as "Assassin's base cannon speed x 1.66 (the engine's own maxed BSpeed
      multiplier, 7 points x 0.0942857/pt)". Step 2 moved that per-point step to diep's own
      `0.15` (7-point cap now 2.05x, not 1.66x) — the literal `0.995491` is untouched (an Arena
      Closer never calls `upgrade()`, so nothing reads `up.BSpeed` for it), but the comment's own
      derivation now cites a multiplier the live engine no longer has. Whoever next touches that
      comment block should either recompute the derivation note against 2.05x or drop the "computed
      rather than eyeballed" framing since it no longer reproduces from current constants.
    - `plan.md`'s "Step 1 LANDED" note (top of the trial-run section) states the reload-only
      `clientDiff` golden as `327834/bccb68b0` and calls it "Final Step 1 golden." Step 2 moved the
      same golden to `286816/e047b820` (`test/clientDiff.js`'s `GOLDEN`) — the note is accurate for
      what Step 1 alone produced but is no longer the tree's current golden. Leave as a historical
      record of Step 1's own isolation, but whoever adds a "Step 2 LANDED" note (or does the final
      doc-cleanup step) should make clear the two hashes describe different points in the sequence,
      not disagree with each other.

## 🔴 Measured against diep.io's real physics (`physics.html`) — mismatches

*Source: `physics.html`, the archived spade-squad diep.io physics page (2022). Community-derived,
not diep source. Numbers assume the real-world quantities `TICK_MS: 33` / `FRICTION: 0.964`
implied; the later `TICK_MS: 25` / `REF_TICK_MS: 40` split preserved those real-world quantities
exactly, so no re-derivation is needed here.*

*Before planning work off this section, read **[MEASUREMENTS.md](MEASUREMENTS.md)** — it lists the
handful of quantities that still need a real diep client, the ones already pinned that must not be
re-measured, and confirms almost nothing here is measurement-blocked any more. #14's tank movement,
#16's recoil/knockback, #17's health/regen/body-damage, #18's damage-model fixes, #19's shape
density, #23's `BASE_DRONE_HP`, #24's bullet dead reckoning and #28's Tag mode have all shipped.
What's left in this section is itemised as open at each entry.*

14. **Movement — SHIPPED, form and magnitudes both**. Level and Movement Speed are independent
    multipliers on base accel — `base × 1.07^pts / 1.015^level`, `public/SHARE/Physics.js` — and
    the level term no longer reaches zero speed at level 54. At the 45 cap a maxed-Movement tank is
    `1.07^7 / 1.015^45` = 0.82× a spawn, diep's own endgame figure. Magnitudes: `MOVE_ACCEL_BASE`
    0.511941 → **1.449**, `FRICTION` 0.956532 → **10/11**, base top speed **362.25 u/s** = diep's
    12.94 gu/s at our 28 units/gu. Top speed, accel ratio, e-fold time, speed-vs-level and
    speed-vs-stat curves, and the 7-point/45-level caps all now match diep exactly.

    **`FRICTION = 10/11` is derived, not measured**, from diep's own `V_max = 10 × A` identity
    (`physics.html`) — three independent cross-checks in the git history close it exactly, nothing
    here needs re-measuring.

    **It is a *tank* constant, not a global one — do not merge it back with bullets.** diep does
    not model bullets with drag at all (`physics.html`: `V_b = ρ/t_b`, no decay term); the
    `V_max = 10 × A` identity is stated for tanks only. So `public/SHARE/Physics.js`'s `FRICTION`
    (`10/11`) is reached only through `stepBody()` (tank motion, bot motion, client prediction);
    `lib/constants.js`'s **`BODY_FRICTION`** keeps the old 0.956532 for bullets, traps, drones,
    shapes and the Summoner's scripted drift. Bullet/trap/drone/shape/boss behaviour is
    **bit-identical** across the split — verified by replaying `test/clientDiff.js`'s prior golden
    with the magnitudes held at their old values. `PET_FRICTION`'s documented 2×-braking
    relationship stays against `BODY_FRICTION` (nuance 36); the boss's drift stays on
    `BODY_FRICTION` too (it never reaches `stepBody`, and diep has no Summoner to pin a speed
    against); the client needed no edit, since it predicts through the same shared
    `Physics.stepBody`/`Physics.moveAccel` with no accel/friction constant of its own.

    **Both derived columns ride the tank's `F`**: recoil `back = gu × 28 × (1−F)/F = gu × 2.8`, and
    knockback `weight = gu × 5.25` (#16, shipped). Edit `F` again and both columns, plus the
    tank-body constant in `entities/Player.js`, move with it — nothing tests that relationship.

    **What's left is one observation, not a decision:** whether diep's bullets are truly
    constant-velocity or carry their own separate drag — `MEASUREMENTS.md`'s **M1**, which also
    yields the `ρ`/`t_b` values #23 wants. Bullets keep today's behaviour (now under
    `BODY_FRICTION`) until M1 lands.

    **362.25 u/s is a level-0, no-upgrade walk — not this game's ceiling.** Riding your own recoil
    is worth ~1.4× a plain walk. `BASE_DRONE_CHASE_SPEED` is pinned to the real ceiling — see
    nuance 32 for the current value and re-pin history.

15. **Reload — SHIPPED, whole column (plan.md Step 3).** Kept only as a *do-not-re-fix* record for
    two things that now look like bugs but aren't. **Annihilator's reload is now 60, identical to
    Destroyer's** — the user re-decided 2026-07-31 that the whole column converts to diep's own
    numbers, which retires the old deliberate 87 (this entry used to warn against "finishing the
    job"; that warning is now reversed). **The six classes with no diep counterpart** (Cyclone,
    Submachine, Auto Hover, Fortress, Summoner, Rocket) each inherit a nearest-relative stand-in
    value instead of a diep citation — flagged with a `STAND-IN` comment at each site in
    `public/SHARE/TanksConfig.js`, not silently copied. Summoner alone is untouched (it stays ours;
    diep has no boss of any kind). Dominator variants are Step 11's, not this step's, and were left
    alone. The reload *stat*'s geometric `0.914^points` scaling and its speed-ceiling consequences
    were already resolved by Step 1 (`test/rooms.js`'s `fastestTankSpeed()` — no further re-pin was
    needed here; the test confirmed it, not a hand derivation).

16. **Knockback and recoil — SHIPPED, both columns.** Kept only as a *do-not-re-fix* record.

    **`weight` is diep's own "Tanks Knockbackfactor" table (grid squares per loop of contact) times
    5.25**, across all 27 classes plus Necromancer's `necro` block and the Summoner boss —
    `entities/Player.js`'s bullet arm turns it into an impulse as `weight / 3 * 1.6`. Verified by
    replaying the recurrence: all 49 distinct entries reproduce diep's gu value to the last digit at
    the 40 ms reference tick; the tank body lands on exactly 1.6 gu. At the live 25 ms tick every row
    reads 1.83% high — nuance 33's semi-implicit Euler drag error, not a column error.
    **The shape of the roster changed, deliberately**: diep inverts knockback against damage, so
    Destroyer (0.2 gu) and Annihilator (0.1 gu) are near the *bottom* and Basic (0.666 gu) near the
    top, where ours used to be nearly flat. Annihilator's `weight` is on-table even though its
    `back` is deliberately off (see below) — the two calls are independent.
    **The tank body**: `entities/Player.js`'s `KIND.PLAYER` arm is `tick.impulse(4.48)`, diep's "All
    Tank Bodies" row (1.6 gu) through the same `gu × 2.8` identity. Sandbox `'god'` repulsion rides
    at twice that (8.96, not a diep number — diep has no god mode). The `KIND.OBJECTS` arm (a shape
    shoving a tank) was left alone — diep's table has no polygon row.
    **Seven classes have no diep counterpart** (Cyclone, Submachine, Auto Hover, Fortress, Summoner,
    Rocket; plain Gunner is a real diep tank the table simply omits) — **decided: each inherits its
    nearest mapped relative's rescaled `weight`**, flagged as a stand-in at its own site in
    `TanksConfig.js`, not a silent copy. Two departed from the obvious class-tree parent for a
    stated reason: **Rocket** takes the rear-thruster row (0.1333) not Flank Guard's forward gun
    (0.666), because both its barrels point backwards; **Cyclone** takes Octo Tank's 0.4333 not
    parent Quad Tank's 0.5, because the table's trend is monotone in barrel count and Cyclone has
    ten. (Submachine ← Machine Gun 0.4666, Gunner ← Gunner Trapper's bullet row 0.333, Auto Gunner's
    manual barrels ← Gunner's stand-in, Fortress ← Tri-Trapper's traps 0.666 / Battleship's drones
    0.1, Summoner ← the drone row 0.8. Auto Hover needed no stand-in — every cannon has a mapped
    analogue.)
    **A second column, `push`, was split out of `weight`** — see nuance 31; it's the reason bullet
    and drone behaviour didn't move at all.

    **Recoil (`back`)**: all 62 nonzero entries, across 27 classes, recomputed as
    `back = gu × 28 × (1−F)/F` against the tank `F = 10/11`, which collapses to a flat
    **`back = gu × 2.8`** — the column is literally diep's "Tanks Recoil" table times 2.8. Verified
    by replaying the recurrence: one Basic shot displaces exactly 0.4 gu at the reference tick.
    **Annihilator stays off-table on purpose**, at 4 gu against diep's 6.8, same call as its reload.
    **The consumption-site bug that used to shortchange both columns is fixed**: `back` and `weight`
    are now consumed through `tick.impulse()`, not `tick.perTick()`, so the live 25 ms tick delivers
    the column's full value rather than ~0.64× of it (the old nuance-43 bug) — a consumption-site
    fix, not a column change, so post-fix numbers are ~1.6× the pre-fix ones.
    **Conversion factor**: 0.193955 gu of tank displacement per unit of `weight` at the live 25 ms
    tick (0.190476 at the 40 ms reference — what a rewrite of the column should be denominated
    against). The full diep Knockbackfactor table is in `physics.html`; nothing left to measure.

17. **Health, regen and body damage — SHIPPED, all three.** Kept only as a *do-not-re-fix* record
    for the body-damage ratio below.
    - **Max health — SHIPPED, diep's raw numbers, not a rescale.** `MH₀ = 50`, `+2/level`,
      `+20/point`, replacing the old `150 + 3/lvl + 110/pt` shape outright — there was no faithful
      ratio in that formula worth preserving. A maxed level-45 tank lands on exactly diep's own
      **278** (`50 + 44×2 + 7×20`), which also resolved #23's `BASE_DRONE_HP` question (see #23).
    - **Regen — SHIPPED, both regimes; the hyper term's SHAPE was re-shipped 2026-07-31 (plan.md
      step 4).** `entities/Player.js`'s `update()` reads diep's linear `HPS = MaxHp ×
      (0.03 + 0.12·rr)/30` below the hyper-regen threshold (30 s) — unchanged — and now ADDS diep's
      own `maxHp/250` per reference tick on top of it once past that threshold, rather than
      replacing the linear term outright (`diepcustom/src/Entity/Live.ts:130-135`, corroborated by
      `diepindepth/extras/stats.md`'s "'Hyper' regen ... stacks with base"). Still no accumulator,
      so the old `lib/tick.js` quantizer-category risk stays gone. **`HYPER_REGEN_RATE` is now
      `1/250`** (diep's own per-reference-tick figure = 10%/s) — the old **`0.085871`**
      (least-squares-fit against diep_wiki's own, differently-captioned "Time to Regen to Full
      Health" table, since that table turned out to measure a post-ram partial refill rather than a
      0%-to-full one) is retired along with the flat-replacement-rate premise it was fit to. Hyper
      regen is point-dependent now (it stacks on the linear term, which is), where it explicitly
      was not before: **10.1%/s at 0 Regen points, 12.9%/s at 7** (was a flat 8.5871% regardless of
      points). `lib/gameAI.js`'s `DOMINATOR_HYPER_REGEN_RATE` moved with it (same value, same
      additive reshape) since its own comment claims to mirror this formula exactly.
      `test/rooms.js`'s `regenInvarianceTest()` re-baselined its hyper-regime case to the additive
      shape; no `clientDiff` golden entities are known to reach the 30 s threshold in the corpus, so
      that golden did not move from this step alone.
    - **Body damage — SHIPPED 2026-07-30.** diep's tank body deals **20** vs shapes at 0 points
      (`(BodyDamagePoints+5)×4`, `diep_wiki/Stats.txt`), **2.857142857×** (20/7) a Basic bullet's
      own 7 damage/loop — ours used to deal only **1.75×** (a legacy, non-diep 7-vs-4 pair, both
      pre-diep-adoption numbers that happened to share the tick-rate rescale's shape). Bullet
      magnitudes themselves aren't diep-adopted yet (`MEASUREMENTS.md`'s **M1**), so the fix applies
      diep's **20/7** ratio to Basic's own live `can.damage` (`public/SHARE/TanksConfig.js`,
      `4.84848`) rather than converting `20` on its own unit scale — `entities/Player.js`'s
      `this.damage` base moves `8.48485 → 13.852814` (`4.84848 × 20/7`), and the `BodyDam` per-point
      step to `2.770563` (`0.2 × base`, diep's own `BS = 1+0.2·bd` slope, landing on exactly diep's
      **2.4×** at the 7-point cap). This is the *offensive* magnitude (how much damage this tank's
      body deals), separate from the old `dr` defensive multiplier on damage taken (shipped earlier,
      **since retired outright** — no diep counterpart, see #18's `damageReduction()` bullet below).
      **`lib/config.js`'s `BASE_DRONE_DAMAGE` moved with it** (`2.97 → 4.84848`) to stay
      scale-consistent — see #23. **`rooms/Tag.js`'s Arena Closer damage moved with it too**
      (`84.8485 → 138.52814`, still exactly 10× the base) — see #28.
      **`test/clientDiff.js`'s golden was rebaselined** (`338725/5560688d → 297741/14e024be`):
      isolated first by temporarily reverting both constants and confirming the prior golden
      reproduced exactly, so the shift is provably these two values changing how long entities
      survive contact (nuance 34's "how long one LIVES" case), not an unrelated regression.

18. **The damage *model* differs structurally — SHIPPED, all four fixes; the first was replaced
    outright 2026-07-31 (contradiction C1, plan.md step 5), not merely retuned.** Kept only as a
    *do-not-re-fix* record — several of the numbers below look arbitrary without the derivation.
    diep resolves a collision as mutual simultaneous destruction with partial-loop proration (each
    body has a constant damage-per-loop, loses health equal to the *opponent's* DPL, prorated if it
    dies mid-loop).
    - **`damageReduction()` is GONE — it had no diep counterpart (contradiction C1).** The
      `dr = 0.4 / (1 + 0.2·bd)` term (`entities/Player.js`'s old `damageReduction()`, applied at all
      three `collision()` damage sites) was an attempt to approximate diep from first principles;
      the reference turned out to say diep has no Body-Damage-points term on the *receiving* side at
      all — `LivingEntity.damageReduction` (`Live.ts:44`) is a **binary** invulnerability multiplier
      (`1.0` normally, `0.0` for spawn shield/godmode/Arena Closers), already fully expressed by this
      tree's own early-return guards (`dev.ghost`/`closer`/`dev.god`/`shield`), which is why removing
      the *term* needed no new guard logic. What diep actually scales damage by is
      `common(a,b) = max(minMultA,minMultB) × min(maxMultA,maxMultB)` (`Live.ts:74-75`,
      `lib/damage.js`'s `TANK_TANK_MULT=6`/`TANK_SHAPE_MULT=4`/`PROJECTILE_BODY_DAMAGE=0.25`, per a
      table of tank `max 6`/shape `max 4`/bullet-drone-trap `max 1`, all `min 1` except bullets'
      `0.25`) — the same 4/6/1 family this tree already modelled via `this.damage`'s baked-in ×4 vs
      shapes plus the old `TANK_BODY_DAMAGE`/`PROJECTILE_BODY_DAMAGE` adjustment factors, just
      re-expressed with `this.damage` un-baked to diep's own raw `damagePerTick` (`13.852814 →
      3.4632035`, `BodyDam`'s step `2.770563 → 0.69264`) so `common()` can apply the *whole*
      multiplier at each site instead of only the adjustment on top of a baked-in one.
      **Numerically a no-op for tank-vs-tank and tank-vs-shape** (proven via `node -e`: both land on
      the exact pre-existing figures, 20.779221 and 13.852814) — `rooms/Tag.js`/`rooms/Maze.js`'s
      Arena Closer damage moved the same way (`138.52814 → 34.632035`, still exactly 10× the base).
      **Not a no-op for shape-vs-tank or shape-vs-bullet**: those two sites read `other.damage`
      un-multiplied still (a shape's own damage figures are not diep-adopted yet, plan.md step 6),
      so **every source of damage to a tank is now `1/dr` stronger** — 2.5× at 0 Body Damage points,
      6× at 7 — a flat factor because none of the three tank-damaging sites (tank ram, shape ram,
      bullet hit) picked up a *new* multiplier, only lost the old defensive one; verified against
      `test/rooms.js`'s base-drone-vs-shape figures, which moved from ~1.212 hp/tick to the plain
      `tick.perTick(BASE_DRONE_DAMAGE)` ≈3.03 hp/tick, exactly `1/0.4`. **Balance consequence, stated
      not hidden**: time-to-kill drops by roughly that factor — the same magnitude of lethality
      change #17's own health-model rewrite made deliberately, now reversed on reference grounds by
      the user. Playtest before step 6's shape table lands on top of it.
    - **Proration — SHIPPED, the structural half of the same step.** diep's mutual, simultaneous
      resolution (`Live.ts:67-84`) — both sides can only ever spend the SAME shared tick, so if
      either would die mid-tick, BOTH sides' damage that tick scales down together by the same
      factor, rather than each landing an independent, un-shortened full hit. Lives in
      `rooms/Room.js`'s pair loop (`damageOutput()`/`damageGuarded()`, right before the two
      `collision()` calls) since it needs both sides' current health and both sides' raw per-tick
      output before either mutates anything — the per-kind `collision()` arms just read
      `option.dmgScale` (default `1` via `??`, so every direct-call test that never sets it is
      unaffected) as one more multiplier at their existing damage line. Found and fixed in the same
      pass: the pair-loop's own `obj.size > other.size || obj.x+obj.y >= other.x+other.y` tie-break
      double-processed any pair tied exactly on both size-ordering *and* position-sum (harmless
      before proration existed, since each `collision()` call was independent; not harmless once
      proration's own `dmgScale` computation assumes the pair it prorates is resolved exactly once)
      — gated the position clause behind `obj.size === other.size` so it only tie-breaks a genuine
      tie instead of independently satisfying both (obj,other) role assignments. `test/rooms.js`
      gained a dedicated `prorationTest()` (two tanks overlapped at 5 hp each, well under one tank's
      full-tick ram damage, both proven to land at ~0 hp exactly rather than deeply negative) since
      no existing test drove the real pair loop into a mutual-death tick.
      Note for whoever next touches `PROJECTILE_BODY_DAMAGE`: the wiki's "−75% against projectiles"
      is a *different* rule from the now-gone `dr` (`(BodyDamagePoints+5)×multiplier`, how fast a
      rammed bullet's own health depletes — the offensive side, #17) and must not be conflated with
      it; the constant itself survives, but only at the shape-vs-bullet site (`entities/Bullet.js`'s
      `KIND.OBJECTS` arm) — the tank-vs-bullet site's own equivalent retired into `common()` above.
    - **A bullet's health spends against the target's damage output.** `entities/Bullet.js`'s
      `collision()` reads `pene -= tick.perTick(other.damage)` unconditionally now (both
      `KIND.PLAYER` and `KIND.OBJECTS` arms) — the old base-drone-only special case (`type === 1.4`)
      generalized to every bullet.
    - **Penetration was counted twice, multiplicatively — this was the real bug.** `pene` decided
      *both* how many ticks of contact a bullet survives (via the point above) *and* was a separate
      damage multiplier at `Math.max(1, pene / 5)` — the same stat spent twice, ~quadratic in `pene`
      above 5. That multiplier is gone from `entities/Player.js` entirely (not replaced): damage per
      tick is now just `can.damage × up.BDamage` (`× dr` too, at the time this was written — `dr`
      itself is gone since, see above), and total damage scales with `pene` purely through contact
      duration — the same shape base drones already used, so numerically a no-op for them. `entities/Objects.js`'s differently-shaped shape-damage formula
      (`(pene>1)?pene:pene/2`) was untouched, deliberately, **until a human flagged shapes as too
      fragile against upgraded/high-pene bullets and this was found to be why, 2026-07-31**: the
      identical double-count was live there too (a shape's damage taken was multiplied by the
      bullet's `pene` on top of `pene` already gating contact duration through `Bullet.js`'s own
      decay), making shape damage scale roughly quadratically with `pene` instead of linearly — a
      maxed-pene bullet could erase an Alpha Pentagon in one hit instead of diep's own 20+. Fixed the
      same way: `this.hp -= tick.perTick(other.damage)`, no multiplier, matching the `KIND.PLAYER`
      arm two cases above it in the same file. Retired `config.BASE_DRONE_PENE`, the stand-in the old
      formula needed to keep a drone's 2000-point pene pool from reading as a 2000× multiplier —
      nothing left for it to guard against. `test/rooms.js`'s base-drone-vs-shape test and
      `test/clientDiff.js`'s golden (`297741/14e024be → 327848/3685f870`, isolated first by
      reverting to the old formula and confirming the prior golden reproduced exactly) both moved
      with it.
      Bundled in the same fix: the wiki's pinned "−75% against projectiles"
      (`PROJECTILE_BODY_DAMAGE = 0.25`) had been applied nowhere, so bullets were eaten 4× faster
      than diep's rule — applied at both `Bullet.js` collision sites at the time (plan.md step 5
      later retired the tank-vs-bullet one of the two into `lib/damage.js`'s `common()` table
      instead, leaving only the shape-vs-bullet site reading this constant directly — see #18's
      `damageReduction()` bullet above). Also found and fixed in the same pass: diep_wiki's "+50%
      against Tanks" for tank-vs-tank body-ram damage had no equivalent — added as
      `TANK_BODY_DAMAGE = 1.5`, multiplied in alongside `damageReduction()` at that one site only
      (not shapes, not bullets) — also retired into `lib/damage.js` by the same later step, as
      `TANK_TANK_MULT`.
    - **Penetration → damage magnitude.** diep's stat slope is linear, `1 + 0.75×points` on a
      bullet's own HP (`diep_wiki/Dominator.txt`); ours accumulated `+1.0714286`/point from a base
      of 1 (an old 6→7-cap rescale carried through unrelated to diep). Fixing the per-point step to
      a flat `+0.75` makes `up.BPene` diep's exact multiplier directly — no restructuring needed,
      since a flat accumulator already *is* "point count × constant." `can.pene` in `TanksConfig.js`
      needed no rescale (the old 0-point baseline already matched diep's); only the *maxed*
      multiplier moved, **8.5× → 6.25×**, the actual fidelity fix.

19. **Arena and shape density — SHIPPED, both halves.** (FOV was already done: `config.FOV_MUL`
    1.39, multiplicative `FOV_PER_LEVEL` 1.005.)
    - **Shapes — SHIPPED. diep's two formulas are a matched pair.** `AL = ⌊√N_P × 50⌋` gu and
      `12.5 × N_P` shapes compose to a *constant* **1 shape per 200 gu²** at every player count —
      the player count cancels. So the real invariant is a density, not "12.5 per player" —
      important because our arenas are bigger and fixed-size, so adopting the per-player count alone
      would have made them *emptier*. `rooms/Room.js` derives every mode's shape caps from that
      density against its own area, keeping each mode's old proportions and moving only the total.
      Result: **ffa 725 → 1017, 2team 555 → 800, 4team 669 → 1012, sandbox 87 → 112**, boss barely
      moved (615 → 612, already near diep's density — a useful cross-check the formula measures
      something real).
    - **Arena size — SHIPPED, decided AGAINST for ffa/2team/4team, kept only as that
      do-not-re-fix record** (nuance 50 has the structural reason revisiting this is more than a
      flag flip). diep sizes it `AL = ⌊√N_P × 50⌋` gu (244 gu at our `maxPlayer: 24`) against our
      fixed 451/450/400 gu — cutting ffa to AL(24) would be a 71% area cut nobody asked for, decided
      against on gameplay grounds, 2026-07-30. Population-varying arena size is only described by
      diep_wiki for **Sandbox**, and a timed shrink for **Tag** — not FFA/2/4 Teams — so
      `rules.arenaLive` stays exactly what it already was for those two and nothing more. Shape
      *density* is the general rule and applies everywhere.
    - Note diep's FOV is resolution-dependent (fixed px/du, so ultrawide genuinely sees more) where
      ours scales to fit — ours is the fairer design, flagged only so the difference stays deliberate.

22. **Things that already match — do not "fix" them.** Necromancer base drone count (diep
    `22 + 2·br`; ours `maxDrone = 22`, only the growth differs, +1/reload point against diep's +2).
    Reload quantization to whole ticks. Per-tick-of-contact damage application (diep's "law 3").

23. **Not covered by `physics.html` — but `diep_wiki/` has since supplied most of it.**

    | | HP | body damage | XP |
    |---|---|---|---|
    | Square | 10 | 8 | 10 |
    | Triangle | 30 | 8 | 25 |
    | Pentagon | 100 | 12 | 130 |
    | Hexagon | 1500 | — | 1500 |
    | Alpha Pentagon | 3000 | 20 | 3000 |
    | Crasher (small) | = Square | = Square | 15 |
    | Crasher (large) | = Triangle | = Triangle | 25 |

    **This table's HP/XP columns, and the shape radii alongside them, SHIPPED as code 2026-07-31
    (plan.md step 6)** — `entities/Objects.js` now carries these HP/XP figures directly (Hexagon has
    no entity in this tree and stays undocumented-as-code) and diep's own collision radii
    (`du × 0.56`). The "body damage" column here is expressed in diep's own per-point units
    (`BodyDamagePoints + 5`); step 6 instead bakes diep's flat `damagePerTick × common(shape,tank)=4`
    straight into each shape's `this.damage` (our own anchor, `× 4.84848/7`) since shapes never read
    a Body-Damage-points term the way a tank's own ram does — Square/Triangle/Crasher **5.54112**,
    Pentagon **8.31168**, Alpha Pentagon **13.8528**. `Bsqr`/`Btri` (this tree's own boss-square/
    boss-triangle, no diep counterpart) were left untouched at every figure, flagged at their own
    site rather than converted. Green ("shiny") variants: **×10 HP, ×100 XP** is now
    `public/SHARE/ObjectsConfig.js`'s own `hpMul`/`prizeMul` (was `2`/`3`, picked by feel — the
    "worth checking" this note used to flag is resolved, not still open); `chance: 1/1000000` needed
    no change, it was already exact. `test/clientDiff.js`'s golden moved twice, in two isolated
    passes per nuance 34 (radius alone, then HP/XP/damage/Shiny together) so each golden move is
    attributed to one cause: `302780/70b95d70 → 351362/3c7d9a51` (radius), then
    `351362/3c7d9a51 → 331911/396262f1` (HP/damage). `test/rooms.js`'s base-drone-vs-shape damage
    assertions (`BASE_DRONE_DAMAGE` × a shape's `maxHp`) were re-checked against the new, smaller
    Square `maxHp` (10) and pass unchanged — the assertion is a loose "under half of maxHp in one
    tick" bound, not a pin tight enough for the HP change to threaten it.

    Gamemode XP
    multipliers: **Tag ×3, Breakout ×3, Domination ×2**, everything else ×1. Body damage is
    `(BodyDamagePoints + 5) × multiplier` — **4 vs shapes** (20 at 0 points, confirming #17),
    **+50% vs tanks**, **−75% vs projectiles** (the "body damage reduces damage taken" term #18
    built). Bullet penetration: each point adds **+75% of the bullet's base HP**; a basic tank
    bullet's base HP is **2**, damage **7** (cross-checked off `diep_wiki/Dominator.txt`'s
    Dominator-projectile-as-multiple-of-tank stats), matching #16/#18.

    **Still genuinely unmeasured**, each with a written protocol in
    [MEASUREMENTS.md](MEASUREMENTS.md): bullet range/lifetime (`ρ`/`t_b`, **M1**, also settles
    whether diep's bullets carry drag at all — see #14), bullet spread (`rand`, **M2** — form
    `w = h/ρ_Vb` known, only `h` missing), the reload stat's real form (**M3**), shape drift
    (**M4**), camera lag (**M5**), `CONST.HP_BAR_HOLD` (**M6**). That file also lists the ~14
    quantities already pinned that must **not** be re-measured.

    - **`BASE_DRONE_HP` — SHIPPED at 2000, and the answer is NOT what this item used to predict.**
      The old reasoning scaled off our then-custom max-health formula (giving ~6400); #17 replaced
      that formula wholesale with diep's own raw numbers, so a maxed tank's pool is now, exactly,
      diep's own maxed pool (278) — `2000 / 278 = 7.194`, matching the wiki's "~7.1×" with no scale
      gap left to bridge. Nothing in `lib/config.js` needed to change except the comment.
    - **`BASE_DRONE_DAMAGE: 4.84848`** (was `2.97` — moved with #17's body-damage fix, see there) is
      derived (`13.852814 × 7/20`, our tank body damage scaled by the wiki's 7-vs-20 bullet:body
      ratio, un-baked to `3.4632035 × 7/20` since plan.md step 5 - same number either way), not
      observed — ~121 HP/s nominal against a fresh victim. **Updated 2026-07-31 (plan.md step 5):**
      the `dr` defensive term this bullet used to fold in (×0.4, giving ~48.5 HP/s effective) is
      gone — `dr` had no diep counterpart (contradiction C1) and was removed outright, not retuned,
      so a lone drone now deals its full ~121 HP/s (test/rooms.js pins ≈3.03 hp/tick at TICK_MS 25).
      A swarm of twelve kills a maxed tank in about a fifth of a second
      (`278 / (12 × 121) ≈ 0.19 s`), down from the already-fast ~0.48s this bullet used to predict.
      **Playtest before treating as settled** — #17 and #18's combined effect here was never
      separately checked, and is now more extreme than when this note was first written.
    - `CONST.MAX_UP_POINTS` (33) and `CONST.MAX_PER_STAT` (7) are hand-mirrored between client and
      server; `test/rooms.js` cross-checks both against `entities/Player.js` so the pair can't drift
      silently.

24. **Close-quarters bullet truth — SHIPPED, kept only for the written floor (c) and the Destroyer
    amplifier, neither fixable client-side.** The client's input-prediction dimensional bug is
    fixed (`public/SHARE/Physics.js`, `predic` stays in units-per-*tick*, scaled once at
    integration).
    - **(a) The lead is derived from a real RTT, not tuned.** `ping` carries a probe byte
      (`net/gameSocket.js`); the client times a probe into an EMA (`public/motion.js`'s `NET`,
      gain 0.2) and `NET.leadMs() = interval + rtt/2` caps the prediction offset — how far the tank
      travels during render delay plus half the round trip. `CONST.SIZE*2` survives only as an
      absolute ceiling against a hostile measurement. On a 50 ms RTT at base top speed this is
      ~16 units against the flat 70 it replaced.
    - **(b) Bullets are dead-reckoned, both halves.** A non-drone bullet's motion is fully
      deterministic between collisions, so the client integrates it forward from the newest snapshot
      instead of drawing it a packet interval in the past (`Bullet.reckonMs()`, the same
      `NET.leadMs()` (a) uses, capped at `CONST.DEAD_RECKON_MAX_INTERVALS` = 3). Excluded: drones
      (steer), pets (chase their owner), traps (decay to a standstill fast anyway). **Your own
      bullets get the lead too now**, ramped in rather than switched on: welded to the drawn muzzle
      for the first packet interval (so a shot visibly leaves the barrel), then `Bullet.reckonRamp`
      eases 0→1 on `CONST.BULLET_LEAD_DECAY` as the muzzle-weld offset decays the other way — a
      hard switch used to pop the bullet forward ~54 units on a frame whose steady travel is ~18;
      `test/client.js` pins both the absence of the pop and that the ramp reaches full strength.
      Client-only; `test/clientDiff.js`'s golden didn't move (no `mine` bullet fires in that
      harness's corpus).
    - **(c) The floor.** Even with both, shooter and target disagree by RTT/2 and every *other*
      entity is still drawn one interval late. Zero error is unreachable client-side; only
      server-side lag compensation (rewinding hit checks by the shooter's latency) removes it, and
      diep doesn't do that either. Written down so this doesn't get "fixed" a third time — the goal
      is bounded, symmetric error, not zero.
    - **Destroyer-specific amplifier, unfixable by tuning:** `predic` is driven by input keys only,
      so a Destroyer's own recoil (`back: 3.8` → ~100 units of displacement) is entirely server-side
      — at the instant of firing, prediction is wrong in the *opposite* direction of the kick until
      the next snapshot lands, and the bullet's spawn `lead` bakes that error in. Only real
      input-replay reconciliation (predicting recoil locally too) removes it.

---

*See HANDOFF.md's "Read this before you touch anything" (tick rate), "Test coverage" (untested
areas), and "The client" (`Instances` sparse-array note) sections for the reasoning behind any
item above.*
