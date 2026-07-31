# Pending & Decisions

Short-form companion to [HANDOFF.md](HANDOFF.md). Only what's *left*: things needing a human call,
decisions already made but not yet built, and things nobody has verified yet.

**A fully shipped item is deleted from this file. An item marked SHIPPED is still here for one of
two reasons, and it says which:** either part of it is still open, or it records a *"do not re-fix
this"* — a value that looks wrong until you know why it is what it is (#22 is entirely that; #14's
table, #16's two derived columns, #17's body-damage-vs-bullet ratio, #18's four damage fixes, #19's
arena size, #23's `BASE_DRONE_HP`, #24's written floor and #28's Arena Closer count/invisibility
floor are too). Do not treat a SHIPPED heading as work to redo.

---

*The game is being remade from scratch: the DB will be emptied and rebuilt, and nothing
documented from the old dev (naming, MySQL, anything below) needs a migration path or
backward-compat story. Old conventions are defaults to improve on, not constraints.*

*Small open threads that are not items in their own right — things that will bite during a later
step if nobody remembers them — are collected in **⚪ Nuances to iron out** near the bottom, with
pointers back into the items below.*

## 🔵 Decided — queued for implementation (not yet built)

2. **Next gamemodes: Domination/Maze get real new entity types.** Split in two — the wall half
   shipped, the structure/Dominator half is still open and now redesigned (see #27 below).
   - **`KIND.WALL` — SHIPPED 2026-07-30, entity type only, no Maze room yet.** A static circular
     "stud" entity (`entities/Wall.js`) — everything in this codebase's collision pass is a circle,
     so a wall is a chain of these, same convention as every other entity kind. `public/SHARE/
     kinds.js`'s `KIND.WALL`, `rooms/Room.js`'s `INSTANCE.walls` `SlotMap` (which is all it took to
     wire quadtree insertion/collision pairing/the update pass — those three loops already iterate
     `for (const kind in this.INSTANCE)` with no kind filter), a `Walls` wire record
     (`SocketSchema.js`, `{x,y,size}` only — no hp/color/states, since a wall never changes after
     spawn), and client rendering (`entities.js`'s `Wall` class, `drawings.js`'s `Drawings.wall`,
     `config.js`'s `Palette.wall`). Physics live entirely in the *mover's* own `collision()` arm
     (`entities/Player.js`, `entities/Bullet.js`) since `Wall` itself never reacts: normal/tangential
     vec decomposition, `WALL_BOUNCE = 0.4` (dimensionless ratio, self-referential to the live vec —
     deliberately *not* wrapped in `tick.impulse()`/`tick.perTick()`, unlike every other knockback in
     the tree, since it carries no `REF_TICK_MS`-denominated units of its own; see nuance 39) and
     `WALL_FRICTION = 0.85` (a genuine per-reference-tick decay, so it *does* go through
     `tick.drag()`) — both in `lib/constants.js`, flagged as ours, not diep's (diep_wiki gives the
     behaviour, no numbers). Zero body damage in both arms. A base drone dies instantly on contact
     (`this.destroy = tick.DES`, no physics); Arena Closers pass through for free via the existing
     `this.closer` guard; Crashers pass through by omission (no `KIND.WALL` case needed on either
     side). Tested directly (`test/rooms.js`'s `wallTests()`) since no Maze room exists yet to spawn
     one in a real match. **What's still missing:** the `Maze` room/gamemode itself — wall chain
     generation, placement, the boss-exclusion rule, the 5-hour close timer (see #26).
   - **Structure/Dominator — still open, redesigned.** Originally scoped as a second static `kind`
     (`KIND.STRUCTURE`); a Dominator is actually a **stationary tank**, not static geometry — it has
     HP, regen, cannons, an AI that aims/leads/fires, and a capture state machine. The right template
     is `CONFIG.BOSS`/`CONFIG.CLOSER` (`lib/gameAI.js`): an ordinary `Player` with custom
     `motion`/`update` bound on at spawn, reusing `Player.shoot()`'s cannon machinery, the same way
     `createBoss()` and Tag's Arena Closers (#28) already work — not a new entity kind. Needs its own
     session: three cannon variants (#27), a neutral/team/team capture state machine, shot-leading
     AI, and (diep confirms, and it's already true in this codebase's `sandbox`/`;`-god pattern) a
     Dominator should be spawnable in Sandbox too for testing without a real Domination match.

## 🟠 Wiki cross-check: GAME MODES — pick what goes in, strike what doesn't

*Source: `diep_wiki/` (`Game Modes.txt`, `Maze.txt`, `Domination.txt`, `Dominator.txt`,
`Polygons.txt`, `Stats.txt`). Official game only. This is a menu, not a plan: nothing here is
decided. We currently ship **ffa / 2team / 4team / boss / sandbox**.*

| diep mode | we have | notes |
|---|---|---|
| FFA | ✅ | — |
| 2 Teams | ✅ | — |
| 4 Teams | ✅ | — |
| Sandbox | ✅ | ours lacks diep's cheat keys, below |
| Maze | ❌ | `KIND.WALL` entity type shipped (item 2); the room itself (generation/placement) is not |
| Domination | ❌ | item 2's Dominator-as-stationary-tank work, still open |
| Tag | ✅ | shipped, item 28 |
| Breakout | ❌ | tile/turf war, needs a claimable grid |
| Capture the Flag | ❌ | needs a carryable entity + 3 bases/team |
| *(removed)* Mothership, Survival, Team DM | ❌ | historical; listed only so they aren't "missed" |

**26. Maze — what the mode actually needs** (the `KIND.WALL` entity type itself is SHIPPED, item 2;
everything below the entity type is still open):
- Randomly generated grey walls, **solid to tanks, bullets, traps and drones alike**. Visible on
  the minimap — the minimap piece is still open (`Wall` client entities draw in-world today, but
  nothing feeds a wall's position onto `UiUpdate.map`'s dots yet).
- **Walls have friction** (grinding along one slows you) **and bounciness** (a fast tank rebounds),
  but deal **no body damage** — SHIPPED, `entities/Player.js`/`entities/Bullet.js`'s `KIND.WALL`
  collision arms, `WALL_FRICTION`/`WALL_BOUNCE` in `lib/constants.js` (ours, untuned, due a real
  playtest pass once a Maze room exists to spawn a wall to hit).
- **Drones die instantly on contact with a wall.** Crashers (and Arena Closers) are the only
  things that pass through. — SHIPPED alongside the rest of the collision arms above.
- **Still open:** the `Maze` room/gamemode itself — wall chain generation and placement (nothing
  spawns a `Wall` in a real match yet), the minimap dots above, the boss-exclusion rule below, and
  the 5-hour close timer.
- **Bosses do not spawn in Maze at all** — a boss can spawn inside a wall and become unkillable.
- Known diep bug worth *not* reproducing: barrels aren't part of the hitbox, so they poke through
  walls and can shoot through double corners at exactly 45°.
- Match length: the arena closes 5 hours in.

**27. Domination — what the mode actually needs** (feeds item 2's Dominator work, redesigned —
a Dominator is a **stationary tank** (`CONFIG.BOSS`/`CONFIG.CLOSER` pattern, `lib/gameAI.js`: an
ordinary `Player` with custom `motion`/`update` bound on at spawn, same as `createBoss()` and Tag's
Arena Closers, #28), not a new static `kind` — it has HP, regen, cannons and an AI, none of which a
static entity has. Should be spawnable in Sandbox too, the same way a boss already is there):
- **4 Dominators**, stationary, on a 2-team map. Neutral (yellow) until captured; capture = drop
  HP to 0 and land the last blow. An **enemy** Dominator takes **two** knockdowns — first back to
  neutral, then to yours. Capturing refills its health, despawns its projectiles, recolours it.
- **Stats:** base health **5998**, **+2/level**, level 75 → **6148 HP**, weak regen, no upgrades,
  **no recoil**, cannot move.
- **Three variants**, each with its own barrels and numbers:
  - *Destroyer Dominator* — 1 cannon; penetration **200 HP (×100 tank)**, damage **70/hit
    (×10 tank)**, Hybrid-sized bullet, reload ≈ Hybrid at 3 points, bullet speed below Destroyer's.
  - *Gunner Dominator* — 3 cannons; penetration **10 HP (×5 tank)**, damage **7 (×1 tank)**, high
    reload, normal bullet speed.
  - *Trapper Dominator* — 8 launchers, evenly spaced; trap health **30 (×15 tank)**, trap damage
    **25.2 (×3.6 tank)**, trap speed above a maxed Tri-Trapper, reload = Trapper at 0 points,
    auto-fire always on.
- **AI:** targets nearest enemy, holds until it leaves FoV, re-targets on capture or when the
  current target stops damaging it, and **leads its shots**. Prioritises players, falls back to
  polygons/bosses/closers. Neutral Dominators cannot damage shapes or bosses. FoV roughly
  Sniper-to-Hunter range depending on variant.
- **Player control:** `H` pilots an uncontrolled friendly Dominator, one player at a time, at the
  cost of your own tank — a real input/ownership path, worth deciding separately from the rest.
- XP gain is **doubled** in this mode.

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
  smaller burst hunts a match this size down just as certainly, only slower.
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
     "stickiness"; and **base drones are faster three times over**
     (`BASE_DRONE_CHASE_SPEED` 423.7 → 501.7 → 527.2 → 559.2 u/s).
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
    entry (Summoner) today, but item 2's Domination/Maze work and any later boss will hit the same
    tension the moment its body is drawn at a non-default `size` (`createBoss()` hardcodes `64` for
    all bosses today) — check the drawn-height-vs-spawn-radius gap deliberately for any new boss
    cannon table instead of assuming the ordinary 0-12 band applies.

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

32. **`BASE_DRONE_CHASE_SPEED`/`_TURN` are pinned to a live measurement**
    (`fastestTankSpeed()` in `test/rooms.js`, replaying `motion()`+`shoot()` over every class at
    max Movement/Reload), so any retune that moves the speed ceiling moves this pair with it.
    Current value: **559.2 u/s** (a maxed-Movement Sniper at L15), after the `back` rescale
    (501.7 → 527.2) and the one-shot-impulse fix (527.2 → 559.2). `#16`'s `weight` column turned
    out **not** to move the ceiling at all — knockback only enters through contact, which a solo
    speed replay never has, and `npm test` passing with no re-pin across that whole rewrite is the
    proof. The only remaining candidate that could move it again is **#15's reload stat**, if M3
    finds our ×2.23 is wrong. Always move both constants together:
    `turn = speed_u_per_s / 60 / 25` holds the ~60-unit turn radius; `lib/config.js`'s comment
    carries the re-pin chain. Note the ceiling is a *maxed-Movement Sniper's own walk* (473.8 u/s)
    plus a recoil premium, not a bare speed number — quoting "1.4×" against a level-0 walk is
    comparing the wrong baseline.

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

35. **`BODY_FRICTION` is on death row, not on a retune list.** If **M1** finds diep's bullets are
    constant-velocity (the likely answer — `physics.html` has no drag term for them), the right
    change is to **delete** the decay from `entities/Bullet.js`'s motion tail, not fit a new number
    into it. That's a structural edit to the tail plus every per-cannon `speed`/`life` value, so
    budget it as such. Two things in that file are *already* separate and must not be swept up:
    traps decay through their own `.82`, and `entities/Objects.js` uses `vec.limit(…, BODY_FRICTION)`
    (a capped decay, not a bare multiply). See #14 and M1.

36. **`PET_FRICTION`'s 2×-braking relationship is against `BODY_FRICTION`, not the tank's.** Still
    exact (1.99×). The hazard is a future reader "restoring" it against the tank's `10/11`, which
    gives `fr = 0.8182` and a pet that brakes ~2.2× harder and parks behind its owner. Documented at
    the constant in `lib/gameAI.js`; this is the second copy.

### Documentation and tooling drift

37. **Prose in `HANDOFF.md` and `PENDING.md` goes stale silently — nothing tests it.** The
    tank-magnitudes pass found stale consumer counts, a stale stat-cap docstring, and wrong file-map
    line counts in `HANDOFF.md`. **When a step changes a number, grep the tree for the old number,
    not just for the constant's name** — that's what caught `284` surviving in `test/client.js` and
    `public/motion.js`. **Two known false-positive near-collisions**: Gunner's bullet `speed`
    `0.511936` vs the old `MOVE_ACCEL_BASE` `0.511941`; the retired tank-body knockback impulse
    `0.43881` vs `0.438816`, a bullet `speed` eight unrelated drone/trap cannons share.

38. **`npm run lint` is unusable as a gate.** ~4984 errors, all inside the gitignored `reference/`
    vendor dump, all predating this work. Lint the source explicitly instead:
    `npx eslint entities lib rooms net public test server.js web`. Worth scoping the npm script or
    adding `reference/` to the eslint ignore list at some point.

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

42. **The Summoner boss is the only entity whose `motion()` is replaced rather than overridden.**
    `rooms/Room.js`'s `createBoss()` does `b.motion = spec[0].bind(b)`, so a boss never reaches
    `Physics.stepBody` and none of the tank movement work applies to it. Any *future* boss added to
    `lib/gameAI.js`'s `CONFIG.BOSS` inherits that shape — decide deliberately whether it should,
    alongside #29's drawn-barrel-vs-spawn-radius check (same "applies to every future boss"
    property).

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

15. **Reload.** Base per-cannon values are done for Basic/Twin/Machine Gun/Sniper/Assassin/
    Destroyer/Hybrid. `can.reload` is denominated in reference-ticks (40 ms loops, the same unit
    diep's own "loops" use), so diep's raw loop counts drop in unconverted.
    - **Overlord/Overseer are still unconverted, and need a decision first.** The reference's merged
      "90 loops" row doesn't map cleanly: Overseer's cannon is 182, Overlord's is a different 281,
      and both are drone-*summon* cooldowns rather than a bullet reload, so it's ambiguous which (or
      whether both) the figure describes.
    - **The reload *stat*'s scaling (`up.Reload -= 0.092`/pt) needs an in-game measurement before
      anything is adopted.** The reference's literal `RT = ⌈X₀/1,875^br⌉` would mean a Basic with 5
      reload points fires *every loop* (25 shots/s) — not credible. `1.875 = 1 + 0.125 × 7` is
      almost certainly a mangled linear form reaching 1.875× fire rate at max stat; under that
      reading diep is ×1.875 and ours ×2.23 at a full bar, close enough to leave alone. Under the
      literal reading nothing about our reload stat is salvageable. Measure before choosing (M3) —
      this one also moves the speed ceiling #14/#32 pin `BASE_DRONE_CHASE_SPEED` to.
    - **Left off the conversion on purpose — do not "finish the job" without re-deciding.**
      Annihilator keeps its 87 (its other stats are already tuned away from Destroyer's, so its
      reload reads as its own number, unlike Hybrid which is a literal stat-clone). Likewise every
      tree descendant that merely *shared* a tier-1's old value by coincidence (Flank Guard, Twin
      Flank/Triple Shot/Quad Tank/Triple Twin/Sprayer/Triplet/Penta Shot/Octo Tank, Ranger,
      Booster) — each has its own barrel count/damage/pene, so a shared reload is a family trait,
      not a copy-paste bug.

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
    - **Regen — SHIPPED, both regimes.** `entities/Player.js`'s `update()` reads diep's linear
      `HPS = MaxHp × (0.03 + 0.12·rr)/30` below the hyper-regen threshold (30 s) and a flat,
      point-independent hyper rate above it — no accumulator, so the old `lib/tick.js`
      quantizer-category risk is gone with it. **`HYPER_REGEN_RATE = 0.085871`** (8.5871% of
      `maxHp`/s, point-independent per diep_wiki) was derived by least-squares-fitting a Pentagon
      ram's damage fraction and the hyper rate together against all 8 of diep_wiki's published
      recovery times — the naive "residual pins it from a 0%-health reading" approach doesn't
      survive contact with the wiki's own caption (the table measures recovery after a specific
      partial-damage ram, not from empty).
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
      body deals), separate from `dr` (the *defensive* multiplier on damage taken, shipped earlier).
      **`lib/config.js`'s `BASE_DRONE_DAMAGE` moved with it** (`2.97 → 4.84848`) to stay
      scale-consistent — see #23. **`rooms/Tag.js`'s Arena Closer damage moved with it too**
      (`84.8485 → 138.52814`, still exactly 10× the base) — see #28.
      **`test/clientDiff.js`'s golden was rebaselined** (`338725/5560688d → 297741/14e024be`):
      isolated first by temporarily reverting both constants and confirming the prior golden
      reproduced exactly, so the shift is provably these two values changing how long entities
      survive contact (nuance 34's "how long one LIVES" case), not an unrelated regression.

18. **The damage *model* differs structurally — SHIPPED, all four fixes.** Kept only as a
    *do-not-re-fix* record — several of the numbers below look arbitrary without the derivation.
    diep resolves a collision as mutual simultaneous destruction with partial-loop proration (each
    body has a constant damage-per-loop, loses health equal to the *opponent's* DPL, prorated if it
    dies mid-loop).
    - **Body damage reduces damage taken.** `dr = 1 − 4/(10·BS)` (`entities/Player.js`'s
      `damageReduction()`, `0.4 / (1 + 0.2 × this.upNb[5])`) applied at all three `collision()`
      damage sites — 40% of a bullet's nominal DPL at `bd 0`, 16.7% at `bd 7`. The wiki's separately
      quoted "−75% against projectiles" is a *different* rule (`(BodyDamagePoints+5)×multiplier`,
      how fast a rammed bullet's own health depletes — the offensive side, #17) and must not be
      conflated with this defensive term.
    - **A bullet's health spends against the target's damage output.** `entities/Bullet.js`'s
      `collision()` reads `pene -= tick.perTick(other.damage)` unconditionally now (both
      `KIND.PLAYER` and `KIND.OBJECTS` arms) — the old base-drone-only special case (`type === 1.4`)
      generalized to every bullet.
    - **Penetration was counted twice, multiplicatively — this was the real bug.** `pene` decided
      *both* how many ticks of contact a bullet survives (via the point above) *and* was a separate
      damage multiplier at `Math.max(1, pene / 5)` — the same stat spent twice, ~quadratic in `pene`
      above 5. That multiplier is gone from `entities/Player.js` entirely (not replaced): damage per
      tick is now just `can.damage × up.BDamage × dr`, and total damage scales with `pene` purely
      through contact duration — the same shape base drones already used, so numerically a no-op
      for them. `entities/Objects.js`'s differently-shaped shape-damage formula
      (`(pene>1)?pene:pene/2`) was untouched, deliberately.
      Bundled in the same fix: the wiki's pinned "−75% against projectiles"
      (`PROJECTILE_BODY_DAMAGE = 0.25`) had been applied nowhere, so bullets were eaten 4× faster
      than diep's rule — now applied at both `Bullet.js` collision sites. Also found and fixed in
      the same pass: diep_wiki's "+50% against Tanks" for tank-vs-tank body-ram damage had no
      equivalent — added as `TANK_BODY_DAMAGE = 1.5`, multiplied in alongside `damageReduction()` at
      that one site only (not shapes, not bullets).
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

    Green ("shiny") variants: **×10 HP, ×100 XP**, body damage unchanged — worth checking against
    `public/SHARE/ObjectsConfig.js`'s tuned chances (ours were picked by feel, item 6). Gamemode XP
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
      ratio), not observed — ~121 HP/s nominal, ~48.5 HP/s effective against a fresh victim after
      #18's `dr` (×0.4). A swarm of twelve still kills a maxed tank well under a second
      (`278 / (12 × 121 × 0.4) ≈ 0.48 s`). **Playtest before treating as settled** — #17 and #18's
      combined effect here was never separately checked.
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
