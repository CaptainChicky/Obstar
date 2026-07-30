# Pending & Decisions

Short-form companion to [HANDOFF.md](HANDOFF.md). Only what's *left*: things needing a human call,
decisions already made but not yet built, and things nobody has verified yet.

**A fully shipped item is deleted from this file. An item marked SHIPPED is still here for one of
two reasons, and it says which:** either part of it is still open (#19's
arena resize, #24(b)'s own bullets, #28's win condition), or it records a
*"do not re-fix this"* — a value that looks wrong until you know why it is what it is (#22 is
entirely that; #14's table, #16's two derived columns, #18's four damage fixes and #23's
`BASE_DRONE_HP` are too). Do not treat a SHIPPED heading as work to redo.

---

*The game is being remade from scratch: the DB will be emptied and rebuilt, and nothing
documented from the old dev (naming, MySQL, anything below) needs a migration path or
backward-compat story. Old conventions are defaults to improve on, not constraints.*

*Small open threads that are not items in their own right — things that will bite during a later
step if nobody remembers them — are collected in **⚪ Nuances to iron out** near the bottom, with
pointers back into the items below.*

## 🔵 Decided — queued for implementation (not yet built)

2. **Next gamemodes: Domination/Maze get real new entity types.** Decided — not tunable-only.
   Needs: a new `kind` in `public/SHARE/kinds.js` for static geometry (walls) and one for capturable
   structures; a static (no `step()`) entity class with its own `collision()`; quadtree
   insertion for that static geometry; a wire-schema addition (`SocketSchema.js`) so the client
   can draw walls/structures; team-ownership state on capturable structures synced over the
   wire. New `kind`s go in `public/SHARE/kinds.js`, which `TanksConfig.js`'s `DETEC` filters
   now reference by constant rather than hardcoding — nothing to keep in sync by hand.

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

**28. Tag — SHIPPED** (`rooms/Tag.js`). 4 teams, no bases, random spawns. Killing a
player **converts them to your team** on respawn; dying to a polygon keeps your colour; suiciding
into a colour is a legitimate way to switch. The leaderboard shows **player counts per team**, not
scores. The arena **shrinks every ~12–13 s**. XP ×3. It cost no new entity types, as predicted —
three hooks (`respawnTeam()`, `leaderRows()`, a shrink timer) plus rules.

**What it does NOT have, and why — both are their own work, not oversights:**
- **No win condition / Arena Closers.** diep ends a Tag match by spawning Arena Closers once one
  team holds every player. That is a **new entity type**, which is the one thing this mode was
  picked for not needing. The room still self-destructs when it empties, like every other mode. A
  match therefore runs indefinitely rather than resetting.
- **No invisibility cap.** diep_wiki: players "can't become fully invisible" in Tag, to stop a
  Landmine/Stalker hiding in a corner and preventing the match from ending. It is a change to
  `entities/Player.js`'s alpha handling rather than anything `rooms/Tag.js` can state, and it only
  actually matters once there IS a win condition to stall — so it is naturally the same piece of
  work as the bullet above.

**Two judgement calls it took, worth not undoing:** the tagging gate is real (diep_wiki: the mode
"only begins when each team has at least four players"), so `botCount` is 16 across 4 sides
specifically to open it — dropping the bot count silently turns tagging off. And `teamCounts()`
**counts dead-but-respawning players**, because filtering them made both the gate and the board
flicker on every single death (one dead bot took a side from 4 to 3 and switched tagging off for
the respawn delay). `test/rooms.js` pins both.

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
   - Level 1 vs. level 45 with Movement Speed maxed: confirm the tank does not rubber-band
     differently at the two speeds. **#14's form change is most visible exactly here** — a maxed
     level-30 tank keeps 0.96× a fresh spawn's speed where it used to keep 0.79×, so leveling
     should no longer feel like it quietly takes your mobility away. **At the 45-level cap the
     same figure is 0.82×** (`1.07^7 / 1.015^45`), diep's own endgame ratio and a deliberate
     consequence of the economy conversion — high-level tanks *are* slower relative to a spawn now,
     so judge the feel against diep, not against the 0.96×.
   - **The upgrade economy is diep's now** (#30, shipped). Four things to look at, all of which
     only a browser can judge: each stat bar draws **7** segments rather than 6 and the whole
     upgrade widget is correspondingly wider — confirm it still fits its corner at a few UI
     scales; a fresh spawn shows **no** point to spend (the first arrives on the level-up to 2),
     where it used to start with one; the class picker opens at **15/30/45**, not 9/19/29; and
     levels 29–45 grant a point only every third level, so the "x*n*" badge stops ticking up every
     level near the cap — that is the schedule, not a stuck counter.
   - **The tank moves at diep's speed now** (#14's magnitudes). Base top speed
     went 284 → **362.25 u/s** (1.28×) and the drag went with it, so the tank both accelerates
     harder and stops harder — the e-fold time to top speed halved (0.90 s → 0.42 s), which is the
     "2.14× floatier" complaint in #14's table being paid off. Judge it as *responsiveness*, not
     just speed: a fresh spawn should feel crisp rather than skating. Two knock-ons to look at
     while you are there: **recoil is diep's now, at full strength** (`back`, and the one-shot-impulse fix) — a Destroyer's own kick should push it
     ~6 grid squares per shot and a Basic's ~0.4, measurable against the background grid, and the
     live 25 ms tick now delivers that in full (previously only ~0.64× of it, `tick.perTick()`
     being the wrong category for a one-shot impulse — fixed);
     **knockback is diep's now too** (`weight`, #16, shipped) so ramming is finally worth judging:
     a Basic's bullet should shove a tank **0.666 grid squares** per tick of contact and a
     Destroyer's only **0.2** (diep inverts knockback against damage), a Mega Trapper's trap 1.07,
     and a tank *body* 1.6 — all measurable against the background grid. **Tanks are solid now**
     (nuance 44): drive into another player and confirm you are held apart rather than sliding
     through each other, and that the bigger tank yields less. Watch for the two things a relaxation
     can get wrong — jitter when two tanks press together, and a shove that reads as "sticky"
     rather than firm; and
     **base drones are faster three times over** (`BASE_DRONE_CHASE_SPEED` re-pinned 423.7 → 501.7 →
     527.2 → 559.2 u/s), so the "lap an enemy base and survive" race below is being re-run at both
     ends at once.
   - **Health and regen are diep's own numbers now, and the whole shape changed, not just the
     quantizer bug** (#17). A fresh spawn is **50** HP, not 150 — confirm the bar
     reads that, not a stale higher number cached anywhere client-side. At 0 Health Regen points,
     take a few HP off and watch the bar: it should begin creeping back at diep's slow linear rate
     immediately (no more ~22 s dead flat, since the old quantized accumulator is gone), then
     **visibly speed up after ~30 s** of no further damage (hyper regen) — that second phase is new
     and worth confirming looks like a genuine rate change, not a glitch.
   - **The prediction lead is derived from a real RTT now** (#24a). It scales with your actual
     latency and speed rather than sitting at a flat 70-unit cap, so it is smaller than it was —
     confirm your own tank still feels immediate on WASD and does not snap when the server
     position lands. Throttling the connection should visibly widen the lead, not break it.
   - **Tank growth is diep's exponential now** (`28 * 1.01^level`, a radius, continuous rather
     than stepping every 2.8 levels). Confirm a tank visibly grows smoothly as it levels and that
     nothing keyed to `size` (barrel scaling, drawn hitbox, minimap dot) looks off at the level
     cap — which is **45** now, so the top-end tank is `1.01^45` = 1.56× a spawn's radius rather
     than the 1.35× a level-30 cap gave.
   - **The `c` auto-spin** starts from wherever the barrel is pointing when you press it and
     spins from there; releasing leaves the tank facing where the spin left it, and the next
     mouse move takes over cleanly. Two changes to re-check here specifically: the rate is diep's
     `1 rad/s` now (was ~0.455 — a 2.2× speed-up, so confirm it reads as a spin and not a blur),
     and a **toggle-off-then-on used to flick the barrel to where the previous spin ended for one
     frame before snapping back** — a race between the keydown packet and the room tick, fixed in
     `rooms/Room.js`'s `getBuffer()` and covered by `test/rooms.js`, but it was a wire-timing bug
     and the browser is where it was visible, so press `c` on and off repeatedly and watch for it.
   - **The world is ~40% denser with shapes** (#19, shipped). ffa went 725 → **1017** polygons,
     2team 555 → 800, 4team 669 → 1012, all at diep's own 1-shape-per-200-gu² density. This is the
     "world feels empty" complaint being paid off, and only a browser can judge whether it now
     reads as *diep-like* or as cluttered. Two specific things to look at: farming should be
     noticeably faster at low level (more targets per screen), and **frame rate / room tick under a
     busy 4team** — 40% more entities is a real per-tick cost (nuance 45), so if anything is going
     to stutter it is a full room in the densest mode. `SHAPE_DENSITY_GU2` in `rooms/Room.js` is
     the knob if it is too much.
   - **Tag is a new mode and nobody has played it** (#28, shipped). Everything about it is
     browser-unverified beyond `test/rooms.js`'s hooks and `test/smoke.js`'s socket run: pick it in
     the menu (a new button), confirm the arena has **no bases at all**, that the leaderboard shows
     **one row per team with a headcount** rather than named players, and that XP comes in ×3.
     Then the mode's actual mechanic: **get killed by a bot and confirm you respawn on that bot's
     team** (your colour changes, and so does everyone who was shooting at you), while **dying to a
     polygon leaves you on your own team**. Finally, sit in a room for a few minutes and watch the
     **arena shrink** — it should step inward every ~12.5 s and glide rather than jump (it rides the
     same lerp the admin `mapResize` uses), and stop at a floor rather than closing to nothing.
     Note there is deliberately **no win condition** yet, so a match never ends — that is #28, not a
     bug you are seeing.
   - **Incoming bullets should now arrive when they look like they arrive** (#24b, shipped). This
     is the one item on this list that is purely a *feel* check and cannot be seen any other way:
     stand still and let a bot shoot you. Previously an enemy shot damaged you slightly *before* its
     picture reached you (it was drawn a packet interval in the past); it should now connect on the
     frame it visually touches you. Judge it under a throttled connection too, since the correction
     scales with your real RTT. **Your own bullets are deliberately unchanged** here — if own fire
     starts looking like it leaves the barrel late or jumps forward just after firing, that is a
     regression in the muzzle-weld interaction, which is exactly the conflict #24(b) records.
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

## ⚪ Nuances to iron out — small open threads, none of them blocking

*Not items in their own right; each is a detail that will cost a session if it is rediscovered
rather than remembered. Ordered by when it will bite, soonest first. Anything that is genuinely a
decision has its own numbered item above and is only cross-referenced here.*

### Live right now — the tree is in a knowingly-wrong state

31. **`weight` and `push` are two different things that used to be one field — do not merge them
    back.** Splitting them is what let #16's knockback rewrite land without moving bullet or drone
    behaviour by a single unit, and the split is permanent, not transitional.
    - **`weight` is knockback dealt to a TANK.** One consumer: `entities/Player.js`'s `KIND.BULLET`
      arm, `tick.impulse(other.weight / 3 * 1.6)`. It is diep's Knockbackfactor table × 5.25 and
      nothing else may be read off it.
    - **`push` is the bullet's own bounce off whatever it hit.** Three consumers, all in
      `entities/Bullet.js`'s `collision()`, all `tick.perTick(this.push)` into the bullet's own
      hand-rolled `BODY_FRICTION` decay. It carries the pre-#16 `weight` values verbatim, because
      that half of the old field never had a reference behind it.
    The reason the split was not optional: the two mechanisms differ by ~14× in what they do with
    the same number (`push` displaces `weight × 13.76` units through `BODY_FRICTION`'s 22.02-tick
    sum, against knockback's `× 5.33` through the tank's 10-tick sum), and the rewrite moved
    individual entries by anywhere from ×0.77 (Rocket) to ×12.8 (Basic) — **non-uniformly**, so no
    single divisor could have carried the old behaviour through. Left merged, a Basic's bullet would
    have rebounded ~48 units off a tank instead of ~4, a Mega Trapper's trap ~77, and every drone
    swarm's separation impulse would have moved by its class's own arbitrary factor.
    `rooms/Room.js`'s base drone sets both by hand (`weight = 4.2`, the drone row; `push = 2`, what
    the single field used to be) — its `push` is genuinely load-bearing, since base drones hold a
    ring.

32. **`BASE_DRONE_CHASE_SPEED`/`_TURN` will need re-pinning at most once more.** The pair is
    pinned to a live measurement, so every retune that touches the speed ceiling moves it.
    **The `back` rescale did it** (×1.914 → ceiling 501.7 → 527.2 u/s, still a Sniper L15), **and so did
    the one-shot-impulse fix** (formerly nuance 43 — undoing recoil's
    ~0.64× live-tick shortfall → ceiling 527.2 → **559.2 u/s**, still a Sniper L15) — one more than
    this item originally counted, since that fix wasn't anticipated when this was written.
    **#16's `weight` was expected to be one of the remaining two and turned out not to be: it moved
    the ceiling by nothing at all.** `fastestTankSpeed()` replays `motion()` + `shoot()`, and
    knockback is not in that recurrence — it only enters through *contact*, which a solo speed
    replay never has. `npm test` passed across the whole column rewrite with no re-pin, which is the
    proof. So the only remaining candidate is **#15's reload stat**, if M3 says our ×2.23 is wrong.
    Always move both constants together:
    `turn = speed_u_per_s / 60 / 25` holds the ~60-unit turn radius, and `lib/config.js`'s comment
    carries the whole chain of re-pins.
    **Calibrate expectations from the `back` rescale rather than from the "premium" framing.** The 1.38×/1.49×
    figures quoted before it compared the *ceiling* against a level-0 no-upgrade walk (362.25 u/s),
    not against the same tank's walk — the build that actually sets the ceiling is a **maxed-Movement
    Sniper at L15, whose own walk is 473.8 u/s**, so recoil contributed only 27.9 u/s of the old
    501.7, 53.4 of 527.2, and 85.4 of the current 559.2. Doubling `back` moved the ceiling **5.1%**,
    not ~40%, and stayed inside the test's own 5%-agreement band without forcing a re-pin (it was
    done anyway, for tidiness). Undoing the 0.64× shortfall moved the ceiling a further **5.7%** —
    just over that band, which is why that re-pin was not optional: `npm test` failed until it
    landed.

### Consequences of adopting diep's tank magnitudes — permanent, not transitional

33. **`V_max = 10·A` is exact only at the 40 ms reference — our live 25 ms server runs 1.8% over
    it.** `Physics.stepBody`'s steady state is `25·A·d·F^d/(1−F^d)` u/s, which equals `362.25` only
    at `d = 1` and rises toward `−25·A/ln F` = 380.1 as `d → 0`; at the live `d = 0.625` it is
    **368.9**. This is ordinary semi-implicit Euler error in the drag term, and it *grew* with the
    heavier friction (it was 0.8% at `F = 0.956532`). Two things follow. First, quoting "362.25 u/s"
    is quoting the reference, not the server — fine for comparing against diep, misleading if
    someone measures in-game and finds 369. Second, `test/rooms.js`'s tick-scale band had to widen
    2% → 3% for exactly this reason, with the derivation in the test.
    **If this ever needs to be exact**, the fix is to make `stepBody` an exponential integrator
    (solve the continuous ODE the `d = 1` recurrence samples) rather than to nudge constants — but
    that changes the meaning of every per-reference-tick constant in the tree, so it is a pass of its
    own and probably not worth 1.8%. Written down so it is a decision rather than a surprise.

34. **`test/clientDiff.js` seeds ONE global RNG and builds all four rooms in sequence, so any
    physics change relocates the camera in the last three modes.** Mode *N*'s divergence shifts mode
    *N+1*'s `Init()` — different tester spawn point, different bot roster — before a single tick has
    run. That is why the tank-magnitudes rebaseline moved 276262 → 301969 ops without anything "new" happening,
    and why `ffa` (built first) stayed bit-identical while `2team`/`4team`/`boss` diverged wholesale.
    **A future physics step will produce the same illegible delta *whenever* it shifts the draw
    count — but it does not always.** The `back` rescale moved every tank's position from
    tick 2 in all four modes and still came out to **+96 ops in one mode**, because it changed no
    `Math.random()` *draw count* through `ffa`/`2team`/`4team` (proved by `boss`, built last,
    rendering bit-identically). So check whether the stream shifted before assuming it did.
    **Worked examples of both answers, so the expectation is calibrated rather than guessed.**
    *Shifted:* the shape-density change (#19) moved `ffa`'s boundary draw count 8217 → 10770,
    because more shapes means more placement draws during `preGenerate` — every downstream mode's
    `Init()` moved with it and only `ffa` stayed legible. *Not shifted:* the one-shot-impulse fix
    and the damage-model change both left the cumulative count **identical at all four mode
    boundaries** (8217 / 16609 / 25928 / 34096), so their deltas were pure position drift.
    A useful rule of thumb from those three: a change to how many ENTITIES exist shifts the stream;
    a change to how existing entities MOVE or how much health they have usually does not.
    *Shifted in exactly one mode, and legibly:* #16's knockback column plus nuance 44's overlap
    resolution left `ffa`/`2team`/`4team` **bit-identical — same op count AND the same cumulative
    draw count at every boundary (11281 / 21739 / 33949)** — while `boss` moved 338578 → 338610 ops
    and *lost* 52 draws (42294 → 42242). One cause covers both halves: `lib/gameAI.js`'s Summoner
    now aggros a low-level tank pressed against it, and its shoot gate is
    `if (this.detected.length || Math.random() < BOSS_SHOOT_CHANCE)`, whose `Math.random()`
    **short-circuits away** once `detected` is non-empty. Worth copying as a technique, not just as
    a result: instrumenting `Math.random()` with a counter and printing the cumulative total at each
    mode boundary is a three-line patch that turns "did the stream shift?" from a guess into a
    reading, and it localised a four-mode delta to one mode and one branch in a single run.
    *Neither:* a client-only change (#24b's bullet dead reckoning) cannot shift it at all — the
    simulation is untouched by construction, and the identical per-mode op counts confirmed it
    without any instrumenting.
    *One-cause-shifts-it, one-cause-doesn't, bundled in a single commit:* #18's pene double-count
    fix landed alongside its `-75%-vs-projectiles` body-damage fix, and isolating
    `PROJECTILE_BODY_DAMAGE` (temporarily setting it to 1, a no-op) split them cleanly: the
    double-count removal alone reproduced the prior golden **exactly** (338610/a72a71ab, every
    boundary's rand count unchanged) — a pure damage-magnitude change, like #18's first two
    consequences before it. `PROJECTILE_BODY_DAMAGE` alone accounted for the entire
    338610 → 352411 move, and unlike the boss-only Summoner-aggro example above, it shifted the
    stream starting in `ffa` itself (rand 11281 → 11284) rather than only downstream: a bullet's own
    `pene` now depletes 4x slower against a player/shape's body damage, so it survives ~4x longer in
    contact — more live bullets per frame, more shots fired before a target dies. A change to how
    long an ENTITY LIVES shifts the stream just as reliably as a change to how many exist; only
    "how existing entities move or how much health they have" is the safe category.
    The technique that made all of these readable is worth reusing rather than reinventing: override
    the constants at load time and
    re-run the corpus once per candidate cause, so each cause gets its own hash and the ones that
    contribute nothing are *proved* to contribute nothing. **If it becomes a nuisance, the fix is to
    re-seed per mode** so each room's corpus is independent — cheap, and it would have made that
    delta a three-line diff instead of a 25k-op one. Deliberately not done in the same change, because
    changing the corpus and changing the physics in the same commit makes neither reviewable.
    *Shifted in every mode, and by construction rather than surprise:* #18's `BPene` magnitude fix
    (352411/fa5f0e2b → **338725/5560688d**) moved all four mode boundaries (ffa −1573, 2team −11145,
    4team −1402, boss +434 ops), heaviest in `2team` — a weaker maxed-Pene multiplier means those
    bullets survive fewer ticks of contact, so fewer draws per bullet across the whole corpus, the
    same "how long an ENTITY LIVES" category as the `PROJECTILE_BODY_DAMAGE` example just above.
    Isolating it needed no instrumenting, just the load-time-override technique at its simplest:
    restoring the retired per-point step (`1.0714286` for `0.75`) as a no-op reproduced the prior
    golden **exactly**, confirming the whole delta was this one change and nothing else in the same
    commit.

35. **`BODY_FRICTION` is on death row, not on a retune list.** If **M1** finds diep's bullets are
    constant-velocity (the likely answer — `physics.html` has no drag term for them at all), the
    right change is to **delete** the decay from `entities/Bullet.js`'s motion tail, not to fit a
    new number into it. That is a structural edit to the tail plus every per-cannon `speed`/`life`
    value, so budget it as such. Two things in that file are *already* separate and must not be
    swept up: traps decay through their own `.82`, and `entities/Objects.js` uses
    `vec.limit(…, BODY_FRICTION)` (a capped decay, not a bare multiply). See #14 and M1.

36. **`PET_FRICTION`'s 2×-braking relationship is against `BODY_FRICTION`, not the tank's.** Checked
    when the split landed and still exact (1.99×). The hazard is a future reader "restoring" it
    against `10/11`, which gives `fr = 0.8182` and a pet that brakes ~2.2× harder and parks behind
    its owner. The comment in `lib/gameAI.js` says so; this is the second copy.

### Documentation and tooling drift

37. **Prose in `HANDOFF.md` and `PENDING.md` goes stale silently — nothing tests it.** The tank-magnitudes pass found
    a `lib/constants.js` comment naming "~8 consumers (… `lib/boot.js` …)" when there were three
    and `boot.js` was not one of them, `fastestTankSpeed()`'s docstring still saying "6 Movement
    Speed and 6 Reload" a whole step after the cap became 7, and `HANDOFF.md`'s file-map line counts
    wrong on most rows (`lib/gameAI.js` listed 403 against an actual 490). **When a step changes a
    number, grep the tree for the old number, not just for the constant's name** — that is what
    caught `284` in `test/client.js` and `public/motion.js`. **Beware two false positives, both
    trailing-digit near-collisions.** Gunner's bullet `speed` is `0.511936`, a coincidence next to
    the old `MOVE_ACCEL_BASE` `0.511941`. And the old tank-body knockback impulse `0.43881` (retired
    by #16, now `4.48`) is one digit off `0.438816`, the bullet `speed` eight drone and trap cannons
    share in `public/SHARE/TanksConfig.js` — grepping the retired value hits all eight and none of
    them is knockback.

38. **`npm run lint` is unusable as a gate.** It reports ~4984 errors, all inside the gitignored
    `reference/` vendor dump, all predating this work. Lint the source explicitly instead:
    `npx eslint entities lib rooms net public test server.js web`. Worth either scoping the npm
    script or adding `reference/` to the eslint ignore list at some point, so "lint is clean" can
    mean something again.

39. **Constants are denominated per `REF_TICK_MS` (40 ms) and converted at the consumption site.**
    Getting the `lib/tick.js` category wrong (`perTick` / `impulse` / `drag` / `ticks` / `chance` /
    `quadratic` / `lead` / `smoothing`) does not fail anything loudly — the value just silently
    stops being real-world-correct at the live tick rate. Read that file's header before adding any
    new per-tick constant, and note that several existing constants are deliberately **flat**
    (`AUTOTURRET_LEAD`, the pet's `2.475`, `BOSS_DRIFT`) with the reasoning at each site. **A
    one-shot velocity impulse added into a body that reaches `Physics.stepBody` (recoil and every
    Player collision knockback) is `impulse()`'s category, not `perTick()`'s — getting this wrong is
    exactly what the old nuance 43 was, before the one-shot-impulse fix corrected it. The reverse case —
    a one-shot impulse into a body that integrates its own `vec` directly with no separate `dtTicks`
    multiply (`entities/Bullet.js`, `entities/Objects.js`) — correctly stays `perTick()`; see that
    function's own header comment in `lib/tick.js` for the derivation of why the two shapes need
    opposite categories.**

### Judgement calls already taken that a later step could quietly undo

40. **The economy conversion deliberately did not re-price XP.** `maxXp` still spreads the same 25000/30000 over 45
    levels instead of 30, so leveling is finer rather than slower. Re-pricing belongs with #19's
    shape density, not with the economy conversion — but it *is* a live balance consequence
    (early levels arrive much faster than they used to), so if leveling reads as too quick, that is
    the knob, and it is a deliberate omission rather than an oversight.

41. **The economy conversion's `parseInt(level / 15)` tier gate departs from PENDING's literal
    `parseInt((1 + level) / 15)`.** Our `level` is 1-based in diep's sense (`XPLVL[0] === 0`), so the
    `1 +` was an off-by-one that opened tier 1 at level 9. If a later reader "restores" the
    reference's expression, the gates silently become 14/29/44. `test/rooms.js` pins 15/30/45.

42. **The Summoner boss is the only entity whose `motion()` is replaced rather than overridden.**
    `rooms/Room.js`'s `createBoss()` does `b.motion = spec[0].bind(b)`, so a boss never reaches
    `Physics.stepBody` and none of the tank movement work applies to it. Any *future* boss added to
    `lib/gameAI.js`'s `CONFIG.BOSS` inherits that shape — decide deliberately whether it should,
    alongside #29's drawn-barrel-vs-spawn-radius check, which has the same "applies to every future
    boss" property.

44. **Tank-vs-tank positional overlap resolution — SHIPPED**, alongside #16's column as decided.
    Kept as a *do-not-undo*: it is the one piece of collision behaviour in the tree with no diep
    reference behind it, so it looks arbitrary until you know it was asked for.
    `entities/Player.js`'s `KIND.PLAYER` arm now pushes both bodies apart along their separation
    axis by their overlap, split by size (`share = other.size / (this.size + other.size)`), **in
    addition to** the velocity impulse rather than instead of it. `rooms/Room.js` calls
    `collision()` on both sides of a pair, so each body moves only its own share and the two shares
    sum to the whole overlap; because the calls are sequential the second sees the first's move, so
    it behaves as a relaxation rather than a snap — measured, a 10-unit-apart pair of 25-radius
    tanks reaches 45.3 units in one tick and clears contact on the next. It runs **before** the
    `noDam` break, because teammates take up space too.
    **Two consequences that are not obvious and cost a session if rediscovered.** First, "standing
    on top of another body" is now a state the engine actively destroys, which is why
    `test/rooms.js`'s Summoner detection test re-asserts the player's position between its two
    steps — that is modelling a player *holding* against the boss, not the test propping itself up.
    Second, it made `lib/gameAI.js`'s boss aggro test unsatisfiable at low level and had to be
    fixed with it; see the nuance below.
    Not done, and deliberately: the **tank-vs-shape** arm has the same gap (checked while here, as
    this item asked). `entities/Objects.js` gives a shape a velocity impulse and moves it through
    its own `weight` mass divisor — 1 for a Square, 4 for a Pentagon, 100 for a boss shape — so
    resolving overlap there means deciding who yields against an existing mass semantic, and against
    a 100-divisor Alpha Pentagon the answer has to be "the tank moves", which is a different edit in
    a different file. It also changes shape-farming feel in every mode. Real, scoped, and left.

    *The original statement of the problem, kept because it is the rationale:*
    **Tank-vs-tank collision has no positional overlap resolution, only a velocity knockback
    impulse — raised by a human while #16 was being scoped, deliberately deferred alongside it.**
    `entities/Player.js`'s `KIND.PLAYER` collision arm ([Player.js:494](entities/Player.js#L494))
    applies `tick.impulse()` to `this.vec` and lets `Physics.stepBody` decay it like any other
    velocity change; nothing separates the two bodies' *positions* directly, so two tanks can
    visibly interpenetrate rather than being held apart — worse right now precisely because #16's
    `weight` is ~12.5-20× short of diep's own table (above), so the impulse that's supposed to push
    them apart is too weak to do it inside a normal contact window. The fix (push both bodies apart
    along their separation axis by their overlap distance, split by some mass/size rule, in addition
    to or instead of relying on the velocity impulse) is a real collision-resolution feature with no
    diep reference behind it (not in `physics.html` or `diep_wiki/`, and not something diep.io's own
    tanks strictly guarantee either — it reads as a general engine-quality call, not a fidelity one).
    **Decided: build this alongside #16's `weight` column rewrite, not before or separately** — both
    land at the same collision sites (`entities/Player.js`'s player-vs-player arm, and worth checking
    `entities/Objects.js`'s tank-vs-object arm for the same gap while there), so doing them in the
    same pass means the site only gets touched once.

45. **The arena/density work put ~40% more shapes in three of the five modes, and that is a live cost as
    well as a live balance change.** ffa 725 → 1017, 2team 555 → 800, 4team 669 → 1012 (boss and
    sandbox barely moved). Every one of those is an entity inserted into the quadtree, queried
    against, and encoded per viewer every tick, so the per-tick cost of a busy room went up
    materially — `test/clientDiff.js`'s ffa canvas-op count went **59534 → 92856 (+56%)** for the
    density change alone, which is the closest thing to a measurement of it the tree has. This is
    the intended effect (#19's whole complaint was that the world is too empty), not a regression,
    but it is the first thing to look at if room tick time becomes a problem. The knob is
    `SHAPE_DENSITY_GU2` in `rooms/Room.js` — raising it thins every mode at once, and it is the one
    number in that file with no diep authority behind changing it.

46. **The "`rejectSample()` is unsatisfiable below ~2744 units wide" floor is retired, at the
    source — do not re-derive it.** It was real: the nest carve-out radii were absolute (1540 at the
    origin), so below ~2744 units no point on the map was outside them and the placement loop could
    not be satisfied. The arena/density work made every radius in the tree a fixed *fraction* of the arena
    (`room.nestScale`, referenced to ffa's gu(451), so ffa's own scale is exactly 1 and its
    behaviour is unchanged by construction) — `spawnKeepOut()`, `createObj()`'s cluster radii,
    `entities/Objects.js`'s carve-outs and both copies of the 280-unit map-edge inset. The
    placement picture is now geometrically similar at every arena size, so **no width exists at
    which the loop is unsatisfiable.** The iteration cap stays anyway and is not vestigial: it
    bounds a caller that passes its own circles, and `test/rooms.js` still drives an explicitly
    unsatisfiable configuration through it so that guarantee keeps being tested. If you find a
    comment or doc still quoting 2744 as a live hazard, it is stale.

47. **`plan.md` no longer exists — every "plan.md step N" / "plan.md WP-N" reference in the tree is
    a historical citation, not a broken link to chase.** It was the measurement-free work queue
    (steps 1–9 plus a one-shot-impulse Part A) and it was **finished in full**: the 45/7/33 economy,
    diep's tank magnitudes and the tank/body friction split, the recoil `back` rescale, the
    `tick.impulse()` category, health/regen, `BASE_DRONE_HP`, arena/shape density, Tag, bullet dead
    reckoning, and two of three parts of the damage model. It was deleted once complete, on purpose;
    it was never git-tracked, so it is not recoverable and should not be looked for.
    **Where the reasoning went instead**, since ~185 comments still point at it: every load-bearing
    derivation was mirrored into `HANDOFF.md` §3 as each step landed (the two frictions and the
    `back` column, `lib/tick.js`'s `impulse()`-vs-`perTick()` rule, health/regen and the `dr` term,
    arena density and `nestScale`, the bullet dead-reckoning exception), and every part deliberately
    left unshipped is an open item in *this* file — #18 (penetration →
    damage), #19 (resizing the arena toward diep's AL), #24(b) (own-bullet dead reckoning), #28
    (Tag's win condition and invisibility cap). #16's knockback `weight` was on that list and has
    since shipped. So a comment citing a step number is telling you
    *when* a value was set and why it is not arbitrary; the current justification for it lives at the
    call site or in HANDOFF §3.
    What did NOT survive the deletion, and is genuinely gone: the per-step `clientDiff` golden
    lineage (the chain of op-count/hash pairs and the load-time-override isolation tables that
    proved which cause contributed which ops). If a future rebaseline needs that technique, it is
    described in nuance 34 above — rebuild the harness from there rather than looking for the old
    tables.

48. **Comment style: a cleanup pass is wanted, and the target style is decided.** Comments should
    describe **what the code does** — the function, the invariant, the unit. They should not carry
    cross-file references (`see plan.md step 3`, `PENDING #19`, `massplanchunks WP4.5.1`), change
    history (`was 0.511941`, `one-time-rescaled from 2 / .5`), or narrative about why a past
    approach was wrong. Much of the tree is currently the opposite: this codebase accumulated a
    dense audit-trail style across several passes, so files like `rooms/Room.js`, `entities/Player.js`
    and `public/client/entities.js` carry long historical blocks in front of short code.
    **Scope when it happens:** strip references and history, keep (and where needed sharpen) the
    functional statement — units, ranges, why a value is that value *in terms of the formula*, and
    the genuinely non-obvious invariants (`pene` IS a drone's health pool; `vec` is per reference
    tick; the two frictions are not interchangeable). Those are functional, not historical, and are
    the ones that cost a session if lost. The reasoning being removed should land in `HANDOFF.md`
    if it is not already there, so the pass is a *move*, not a deletion — HANDOFF is the place for
    "why", the code is the place for "what". Worth doing in one deliberate pass rather than
    incidentally inside a feature step, since it will touch nearly every file and would make any
    other diff in the same commit unreviewable.

49. **A boss's aggro radius is smaller than its own hitbox at low level, and that only stopped
    mattering because tanks used to be able to stand inside it. Worth a `diep_wiki` cross-check.**
    `lib/gameAI.js`'s Summoner test is `dis / max(1, level) < screen / 30`, i.e. **65.6 units** for a
    level-0 or level-1 tank — against a boss body radius of **64** (`rooms/Room.js`'s `createBoss()`)
    plus a ~28-radius tank. So the only way a fresh spawn ever satisfied it was by being *inside* the
    boss, which nuance 44's overlap resolution makes impossible. Left alone it would have silently
    blinded every boss to freshly-respawned players — including `up.BPene = detected.length * .9`,
    so an unaggroed boss fires zero-penetration drones.
    **Fixed by measuring from the boss's HULL rather than its centre**, as a fraction of the raw
    distance (`(raw − size) / raw`) so it survives the metric's own 0.5625 y-squash. A flat
    subtraction would be worth 1.78× more along one axis than the other, and which axis a shoved tank
    ends up on is random — that made a first attempt pass and fail on alternate runs, which is the
    trap worth remembering here. At high level the boss's 64 units are a ~2% widening of a
    ~2950-unit radius, so nothing above level 2 moved.
    **Still open, and the reason this is a nuance rather than closed:** nothing was checked against
    `diep_wiki` — diep has no Summoner and no boss of this shape, so the `screen / 30` radius, the
    `/ level` scaling and the 0.5625 ellipse are all ours, none of them referenced. Whether a boss
    *should* aggro on contact regardless of level is the question that was actually answered here,
    by a human, on gameplay grounds. Cross-check the whole aggro model against `diep_wiki/`'s boss
    pages when someone next has that file open.

## 🔴 Measured against diep.io's real physics (`physics.html`) — mismatches

*Source: `physics.html`, the archived spade-squad diep.io physics page (2022). Community-derived,
not diep source — one formula in it is internally implausible and is flagged as such below. Every
"ours" number here was read off the current tree, and every ratio is arithmetic on those two, not
a feel judgement. Numbers assume the real-world quantities `TICK_MS: 33` / `FRICTION: 0.964`
implied (top speed, recoil, reload in seconds); the later `TICK_MS: 25` / `REF_TICK_MS: 40` split
preserved those real-world quantities exactly, so no re-derivation is needed here.*

*This started as pure scoping data for a Spade Squad diep-physics balance pass that was explicitly
deferred (the client/server *mismatch* in movement constants was fixed first, so prediction matched
what the server actually did, without retuning the underlying movement/knockback/recoil numbers
against any external reference — those had only ever been hand-tuned against a measured ~29Hz tick).
Most of that deferred pass has since landed as items 14–24 below — the auto-turret spin rate
(was #21), the FOV half of #19, the per-cannon base `reload`/`back` values in #15/#16, and the
level/stat *form* half of #14. Each item below now states what is still open; anything not
stated as open has shipped and should not be "re-fixed".*

*Before planning work off this section, read **[MEASUREMENTS.md](MEASUREMENTS.md)**. It lists the
handful of quantities that genuinely still need a real diep client, the ~14 that are already pinned
and must not be re-measured, and — most importantly for sequencing — the fact that **almost nothing
here is measurement-blocked any more.** #14's `FRICTION` is exact (`10/11`, derived), so #14, #16,
#17, #19 and the damage model can all be finished before a single measurement is taken — and that
work is now **complete**: #30's economy, #14's tank movement magnitudes and the tank/body friction
split, #16's recoil half, #17's health and regen, #23's `BASE_DRONE_HP`, #19's shape density, #28's
Tag mode, #24(b)'s bullet dead reckoning and all four of #18's damage fixes have all shipped —
and #16's knockback `weight` column has since joined them, so that item is now closed on both of
its columns, same as #18. What is left in this section is itemised as open at each entry.*

14. **Movement — SHIPPED, form and magnitudes both**. Level and Movement Speed
    are independent multipliers on the base accel — `base × 1.07^pts / 1.015^level`,
    `public/SHARE/Physics.js` — and the level term no longer reaches zero speed at level 54. The
    stat/level *domain* is diep's since #30, so at the 45 cap a maxed-Movement tank is
    `1.07^7 / 1.015^45` = 0.82× a spawn, diep's own endgame figure. **The magnitudes are diep's
    now too**: `MOVE_ACCEL_BASE` 0.511941 → **1.449**, `FRICTION` 0.956532 → **10/11**, so base top
    speed is **362.25 u/s** — diep's 12.94 gu/s at our 28 units/gu. Every row below reads as an
    identity; the table is kept only so the item still records what was wrong.

    | | diep | ours | ratio |
    |---|---|---|---|
    | top speed, base | `10 × A₀` = 12.94 gu/s = 6.47 tank-diameters/s | 362.25 u/s = 6.47 diam/s | **matched** |
    | accel → top-speed ratio | `v_max = 10 × A` | `v_max = 10 × A` | **matched** |
    | e-fold time to top speed | 0.42 s | 0.42 s | **matched** |
    | speed vs level | `÷ 1.015^lvl` (×0.51 at lvl 45) | `÷ 1.015^lvl` (×0.51 at lvl 45) | **matched** |
    | speed vs stat | `× 1.07^vm` (+61% at 7) | `× 1.07^vm` (+61% at 7) | **matched** |
    | stat cap / level cap | 7 points, 45 levels | 7 points, 45 levels | **matched** (#30, shipped) |

    **What is left of this item is the split it forced** (below — future work must not undo it).
    **Both columns that ride the tank's `F` are now derived from it**: recoil `back` is
    `gu × 28 × (1−F)/F` = `gu × 2.8`, and knockback `weight` is `gu × 5.25` (#16, shipped). Edit `F`
    again and both columns, plus the tank-body constant in `entities/Player.js`, move with it —
    nothing tests that relationship.

    ### `FRICTION` is EXACT, and it is a *tank* constant — SHIPPED, and do not merge it back

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

    **The old "FRICTION is global" blocker was a mis-framing of a real bug.** It was true that
    `lib/constants.js` re-exported one constant and that `entities/Bullet.js`, `entities/Objects.js`
    and `lib/gameAI.js` all decayed through it — but **diep does not model bullets that way at all.**
    `physics.html` parameterises a bullet as `V_b = ρ/t_b`, range over lifetime, with **no drag term
    anywhere**, and defines `ρ_Vb` as "distance a bullet can fly before decay". The `V_max = 10 × A`
    identity that pins `F` is stated *for tanks only*.

    In other words we were running a **tank** recurrence on bullets, and sharing one constant
    between two things diep models separately. Splitting them was not a workaround to dodge a
    cascade — **the split is the faithful model**, and it made the 2.2×-slower-bullets problem
    disappear rather than needing compensation. Recoil and knockback both act on *tank* velocity, so
    #16's rules hold verbatim under the split.

    **The split as shipped.** `public/SHARE/Physics.js`'s `FRICTION` is the tank's `10/11`, reached
    only through `stepBody()` — `entities/Player.js`'s `motion()`, `lib/gameAI.js`'s bots,
    `public/client/game.js`'s input prediction. `lib/constants.js`'s **`BODY_FRICTION`** keeps
    0.956532 for `entities/Bullet.js`, `entities/Objects.js` and the Summoner boss's scripted drift
    in `lib/gameAI.js`. Bullet, trap, drone, shape and boss behaviour is **bit-identical** across the
    change — verified, not asserted: with the split applied and the magnitudes held at their old
    values, `test/clientDiff.js` reproduces the previous golden exactly (276262/d7859442). Three
    judgement calls, each written up at its call site rather than here:
    - **The boss's drift stays on `BODY_FRICTION`.** `rooms/Room.js`'s `createBoss()` does
      `b.motion = spec[0].bind(b)`, i.e. the drift function *replaces* `Player.prototype.motion()`,
      so a boss never reaches `stepBody` at all; its `this.vec` is not in tank units either (the
      position step divides by 10); and nothing in any reference pins a top speed for it — diep has
      no Summoner boss. At 10/11 its drift steady state would have dropped to ~0.45× for no reason.
    - **`PET_FRICTION` is unaffected, and its premise survives.** The documented
      `1-fr = (1-F)×2` relationship was always against 0.956532 — exactly the constant that did not
      move (1 − 0.91341 = 0.08659 against 1 − 0.956532 = 0.043468 is 1.99×). Re-deriving it against
      the tank's 10/11 would give `fr = 0.8182`, a pet braking ~2.2× harder. Do not.
    - **The client needed no edit.** `public/client/game.js` predicts through the same
      `Physics.stepBody`/`Physics.moveAccel` and holds no accel or friction constant of its own
      (grepped across `public/client/` and `public/motion.js`), so it followed the tank
      automatically — which is the payoff for the shared-integrator rule in HANDOFF §3.

    **What is left is one observation, not a decision:** whether diep's bullets are truly constant
    velocity or carry their own separate drag — see `MEASUREMENTS.md` **M1**, which also yields the
    `ρ`/`t_b` values #23 wants. Adopting tank movement did **not** wait on it; bullets keep today's
    behaviour, now under `BODY_FRICTION`, until M1 lands.

    **The 362.25 u/s above is a level-0, no-upgrade tank walking — not this game's ceiling.**
    Riding your own recoil is worth ~1.4× a plain walk. (It was ~1.5× before the magnitudes moved:
    the walk went up 1.28× while `back` did not move at all, so the recoil rider's premium shrank
    — the `back` rescale is what puts it back, and it will move the ceiling again.) `BASE_DRONE_CHASE_SPEED` is pinned to that real
    ceiling, measured live by `test/rooms.js`'s `fastestTankSpeed()` (replays `entities/Player.js`'s
    own `motion()` + `shoot()` recurrence over every reachable class at a full Movement Speed and a
    full Reload bar — it reads `MAX_PER_STAT`, so that is 7/7 since #30 — with the recoil aimed
    along the direction of travel). The level penalty
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
      at a full bar — close enough to leave alone (the per-point step is 0.0788571 since #30, so
      the maxed total is the same 0.552 it was at 6 points). Under the literal reading nothing
      about our reload stat is salvageable. Measure before choosing. Note this one moves the speed
      ceiling #14 pins `BASE_DRONE_CHASE_SPEED` to. The `× 7` in that identity is diep's stat cap,
      and ours is 7 now (#30, shipped), so the comparison is finally apples-to-apples.
    - **Left off the conversion on purpose — do not "finish the job" without re-deciding.**
      Annihilator keeps its 87: unlike Hybrid (a literal stat-clone of Destroyer's cannon, so it
      moved with it), Annihilator's other stats are already tuned away from Destroyer's, so its
      reload reads as its own number. Likewise every tree descendant that merely *shared* a tier-1's
      old value by coincidence (Flank Guard, Twin Flank/Triple Shot/Quad Tank/Triple Twin/Sprayer/
      Triplet/Penta Shot/Octo Tank, Ranger, Booster) — each has its own barrel count/damage/pene, so
      a shared number there is a family trait, not the copy-paste bug Twin's mismatched barrels were.

16. **Knockback and recoil — SHIPPED, both columns.** Kept only as a *do-not-re-fix* record: the
    two columns are derived, not tuned, and the derivation is what stops a future reader "fixing"
    a number that looks arbitrary.

    **`weight` is diep's own "Tanks Knockbackfactor" table (grid squares per loop of contact)
    times 5.25**, every entry, across all 27 classes plus Necromancer's `necro` block and the
    Summoner boss. The factor closes the same way `back`'s did: `entities/Player.js`'s bullet arm
    turns the column into an impulse as `weight / 3 * 1.6` = `× 0.53333`, and a one-shot impulse on
    tank velocity displaces `v₀ · F/(1−F)` = `10 · v₀` units at the tank `F = 10/11`, so
    `gu × 5.25 × 0.53333 × 10 / 28 = gu` exactly. **Verified by replaying the recurrence, not by
    arithmetic**: all 49 distinct entries reproduce their diep gu value to the last digit at the
    40 ms reference tick, and the tank body lands on exactly 1.6 gu. At the live 25 ms tick every
    row reads **1.83% high** (0.193955 gu per unit of `weight` against the reference 0.190476) —
    that is nuance 33's semi-implicit Euler drag error, the same 1.8% `V_max = 10·A` carries, and
    is **not** a column error to compensate for.
    **The shape of the roster changed, deliberately.** diep inverts knockback against damage, so
    Destroyer (0.2 gu) and Annihilator (0.1 gu) are now near the *bottom* of the column and Basic
    (0.666 gu) near the top, where ours used to be nearly flat across the three. **Annihilator is
    on-table here** even though its `back` is deliberately off-table (4 gu against diep's 6.8) —
    the two calls are independent and only `back` was ever excepted.
    **The tank body came with it**: `entities/Player.js`'s `KIND.PLAYER` arm is `tick.impulse(4.48)`
    now, diep's "All Tank Bodies" row (1.6 gu) through the same `gu × 2.8` impulse identity. The
    sandbox `'god'` repulsion rides it at twice that (8.96) — the relationship it always had, and
    not a diep number, since diep has no god mode. The `KIND.OBJECTS` arm (a *shape* shoving a tank)
    was left alone on purpose: diep's table has no polygon row.
    **The seven unmapped classes each inherit a nearest mapped relative and say so at their own
    entry**, per the decision recorded below. Which relative, and why, is at each site in
    `public/SHARE/TanksConfig.js`; each is flagged as a stand-in that may want its own tune.
    Two of them departed from the obvious class-tree parent for a stated reason: **Rocket** takes
    the rear-thruster row (0.1333 gu) rather than Flank Guard's forward gun, because both its
    barrels point backwards; **Cyclone** takes Octo Tank's 0.4333 rather than its parent Quad Tank's
    0.5, because the table's own trend is monotone in barrel count and Cyclone has ten.
    **A second column, `push`, was split out of `weight` in the same pass** — see the nuance below;
    it is the reason bullet and drone behaviour did not move at all.

    (**The recoil half of this item shipped earlier.** All 62 nonzero `back` entries,
    across 27 classes, were recomputed as `back = gu × 28 × (1−F)/F` against the tank `F = 10/11`,
    which collapses to a flat **`back = gu × 2.8`**: the column is now literally diep's
    "Tanks Recoil" table in grid squares, times 2.8, and divides back to it. Verified by replaying
    the recurrence, not by arithmetic — one Basic shot displaces exactly 0.4 gu at the reference
    tick. **Annihilator stays off-table on purpose** at 4 gu against diep's 6.8, same call as its
    reload in #15; the per-class cross-check of which other entries are diep's and which are our
    own is recorded at the column itself in `public/SHARE/TanksConfig.js`. **The applied factor was ×1.914, not the ×2.20 this item
    predicted**, and the difference is not a mistake in either: 2.20 is the ratio of `(1−F)/F`
    across the friction change, but the pre-rescale column was `gu × 1.462688` (a historical
    "stepBody factor") rather than `gu × 28 × (1−F_old)/F_old = gu × 1.272424`, i.e. it was already
    ~1.15× hot against diep's table. Deriving from the formula rather than scaling by 2.20 is what
    removed that. Since `back` is an impulse on *tank* velocity, none of this is affected by
    whatever M1 finds out about bullet motion — recoil follows the tank's `F`, always, and if `F`
    is ever edited again the whole column moves with it.
    **The consumption-site bug that used to apply to `weight` too is fixed** (formerly nuance 43): both `back` and `weight` are now consumed through
    the new `tick.impulse()` category, not `tick.perTick()`, so the live 25 ms tick delivers the
    column's full value rather than ~0.64× of it. That was a consumption-site bug, not a column bug,
    and fixing it changed nothing about how short `weight` itself is — the numbers below are
    correspondingly ~1.6× bigger than they were (1/0.64), not smaller.

    The gap this closed, as it stood before the rewrite (kept so the size of the move is on record):

    | | diep, per loop of contact | ours, pre-rewrite | ratio |
    |---|---|---|---|
    | basic bullet (`weight` 0.27426) | 0.667 gu | 0.0532 gu | **12.5× weak** |
    | common bullet (`weight` 0.45709) | varies by class | 0.0887 gu | — |
    | tank body | 1.6 gu | 0.157 gu | **10.2× weak** |
    | drones | 0.8 gu | no separate value | — |

    The tank-body row is the one figure this item used to get wrong, and it is worth knowing why:
    it pointed at `entities/Player.js`'s speed-dependent `len` in the `KIND.OBJECTS` arm (0.29 gu),
    which is a *shape* shoving a tank. diep's "All Tank Bodies" row is a *tank* shoving a tank —
    the `KIND.PLAYER` arm, which was 0.43881 → **0.157 gu**, i.e. worse than this item recorded.

    **The conversion factor is 0.193955 gu of displacement per unit of `weight`** at the live 25 ms
    tick, measured by replaying the real recurrence (impulse `tick.impulse(weight/3 × 1.6)` into
    `this.vec`, decayed through `Physics.stepBody`) — up from the pre-fix 0.121222 by the same
    1/0.64 the fix restored. At the 40 ms reference the same replay gives **0.190476** (matching what
    the pre-fix writeup predicted this figure would be once the consumption-site bug was gone), and
    that reference figure — not the live-tick one — is what a rewrite of the column should be
    denominated against, same as `back`'s. The full diep Knockbackfactor table is in `physics.html`,
    so no measurement is left to do here.
    **It was 0.264175 before the tank-magnitudes change** — knockback lands on *tank* velocity, so it tracked
    #14's `F`: a one-shot impulse's total displacement is `v₀·F/(1−F)`, which went from 22.02·v₀ to
    10·v₀, i.e. ×0.454. The rescale **re-verified the new figure by replaying the recurrence** rather
    than adopting that arithmetic (which predicted ~0.1200); the two bullet rows above were
    re-measured from the same replay. Like `back`, all of this is independent of whatever M1 finds
    about bullet motion.

    **Both human calls were asked and answered (2026-07-29/30), before implementation — not guessed,
    and both were honoured verbatim by the rewrite:**
    - **~7 of our classes are not in diep's table at all**, so a complete replacement cannot be
      read off it: Cyclone, Submachine, Auto Hover, Fortress, Summoner and Rocket have no diep
      counterpart, and plain **Gunner** is a real diep tank that the Knockbackfactor table simply
      omits. Converting only the mappable classes leaves Basic at ~20× its current knockback while
      Cyclone keeps the old value — a worse balance state than either endpoint, so this wants doing
      atomically with a decision for the unmapped seven.
      **Decided: each unmapped class inherits its nearest mapped relative's rescaled `weight`**
      (same shape as #15's reload inheritance down the class tree), with a comment at each inherited
      site flagging it as a stand-in that may need its own fine-tune later — not a silent copy.
      **Done. Which relative each took, and why, is recorded at its own entry** in
      `public/SHARE/TanksConfig.js`: Submachine ← Machine Gun (0.4666), Gunner ← Gunner Trapper's
      bullet row (0.333, the table's only entry for a bullet out of a Gunner barrel, in preference
      to the class-tree parent Machine Gun), Auto Gunner's manual barrels ← Gunner's stand-in,
      Cyclone ← Octo Tank (0.4333, not parent Quad Tank's 0.5 — the table is monotone in barrel
      count), Rocket ← the rear-thruster row (0.1333, not parent Flank Guard's 0.666 — both its
      barrels point backwards), Fortress ← Tri-Trapper's traps (0.666) and Battleship's drones
      (0.1), Summoner ← the drone row (0.8). **Auto Hover turned out not to need a stand-in for
      its class at all** — every one of its four cannons has a mapped analogue (an Auto- turret
      plus Tri-Angle's three), so it is mapped per cannon rather than inherited wholesale.
    - **The 33 ms → 40 ms rescale did not preserve this column.** At 33 ms a `weight` of 0.3 gave
      0.09563 gu; the 0.45709 it became gave 0.12075 gu — **1.26× more knockback than before the
      "one-time relabelling, not a balance change" conversion**, and dropping the `× 1.6` instead
      gives 0.07547 (0.79×). Neither reproduces the original, so one of the two factors is wrong.
      (Both of those are **pre-step-2** figures, at the old `FRICTION`; the 1.26× is a ratio between
      two states of that era and is unaffected by the magnitudes scaling both sides. Do not compare them
      against the 0.0554 in the table above.)
      **Decided: neither candidate correction — skip reverse-engineering which historical factor
      broke, and recompute every `weight` directly from diep's own Knockbackfactor table** via the
      already-confirmed 0.190476 gu-per-`weight` reference-tick conversion above, the same way
      `back` was rederived from the formula rather than rescaled by a guessed ratio. The
      1.26×/0.79× figures above become moot once the column is computed this way rather than patched.
      **Done exactly that**, so both figures are now moot as predicted and neither historical factor
      was ever diagnosed. Nothing in the tree depends on which of them broke.

    **What it cost outside the column**, all of it recorded rather than incidental: a new `push`
    column (below), the tank-body and `'god'` constants above, nuance 44's overlap resolution, one
    consequent change to `lib/gameAI.js`'s Summoner aggro test (below), and a `clientDiff`
    rebaseline in which **three of the four modes came out bit-identical** — see nuance 34, which
    now carries this as its cleanest worked example.

17. **Health and regen — SHIPPED**; **body damage magnitude still open.**
    - **Max health — SHIPPED, diep's raw numbers, not a rescale.** `MH₀ = 50`, `+2/level`,
      `+20/point`, adopted directly rather than mapped onto the old `150 + 3/lvl + 110/pt` shape —
      there was no faithful ratio in that formula worth preserving. `entities/Player.js`'s
      constructor, level-up and `upgrade()`'s `HpUp` case all read diep's numbers now. A maxed
      level-45 tank lands on exactly diep's own **278** (`50 + 44×2 + 7×20`), which also resolved
      #23's `BASE_DRONE_HP` question back to diep's raw 2000 (see #23).
    - **Regen — SHIPPED, both regimes.** `entities/Player.js`'s `update()` reads diep's linear
      `HPS = MaxHp × (0.03 + 0.12·rr)/30` below the hyper-regen threshold (`tick.ticks(750)`, 30 s)
      and a flat, point-independent hyper rate above it — no accumulator, so no `lib/tick.js`
      quadratic-vs-perTick miscategorisation risk is left in this file the way `hpregan` was. `rr`
      is `up.HpRegan` read as a raw 0–7 point count now (the same conversion #14 gave `MSpeed`), not
      an accumulated per-point rate.
      **The hyper rate required a real derivation, and the naive reading this item's own text used
      does not survive contact with the full published table.** "At 0 points the linear rate alone
      would take 1000 s and the observed figure is 31.97 s, so the residual pins it" implicitly reads
      the wiki's time-to-full table as healing from 0% of the pool — but diep_wiki's own caption says
      the table measures recovery **after ramming into a Pentagon** (a fixed, partial damage amount,
      not 0%), and diep_wiki's OWN second table (% of the pool regenerated in the pre-hyper 30 s
      window) proves most of the 8 point-rows never even reach the hyper phase under a from-0%
      reading — it would require finishing in negative time past ~2 points. Least-squares-fitting the
      ram's damage fraction and the hyper rate together against all 8 published times (not just the
      point-0 illustration) resolves cleanly: **`HYPER_REGEN_RATE = 0.085871`** (8.5871% of `maxHp`
      per second, point-independent — diep_wiki: Shapes/Bullets hyper regen too and have no Regen
      stat to gate it with), worst-case 0.7 s off across all 8 rows.
      The old quantizer bug this item used to track (`parseInt(hpregan[1]*maxHp*10)/10` eating the
      first ~22 s) is moot — the accumulator it quantized is gone.
    - **Body damage — still open, and now clearly separate from #18's `dr` term.** At zero points in
      both stats, diep's tank body deals 2.86× a basic bullet's per-loop damage (20 vs 7); ours deals
      1.75× (7 vs 4). So ramming is relatively 1.6× weaker here even before item 18's model
      differences. The stat *range* matches (diep `BS = 1+0.2·bd` → 2.4× at 7; ours `damage 7 → 17.8`
      = 2.54× at 6). This is the *offensive* magnitude (how much damage this tank's body deals) —
      untouched by #18's `dr` term (the *defensive* multiplier on damage taken, shipped) — and is
      still open.

18. **The damage *model* differs structurally — SHIPPED, all four fixes** (two bundled with the
    health/regen work, the pene double-count + −75%-vs-projectiles fix landed 2026-07-30, the
    `BPene` magnitude fix landed 2026-07-30). Kept only as a *do-not-re-fix* record: several of the
    numbers below (the vanished `Math.max(1, pene/5)` multiplier, `TANK_BODY_DAMAGE = 1.5`,
    `PROJECTILE_BODY_DAMAGE = 0.25`, `BPene`'s `+0.75`/pt step) look arbitrary or simply missing
    without the derivation attached to each.
    diep resolves a collision as mutual simultaneous destruction with partial-loop proration
    (the page's "3 laws"): each body has a constant damage-per-loop, each loses health equal to the
    *opponent's* DPL, and a body that dies mid-loop deals a proportionally reduced share
    (`GH_L = GH'' × DPL''/DPL`). Three consequences, this item's original list:
    - **Body damage reduces damage taken — SHIPPED.** `MH_L = 4·D_b/BS`, i.e. `dr = 1 − 4/(10·BS)` —
      a tank takes 40% of a bullet's nominal DPL at `bd 0`, 16.7% at `bd 7`.
      `entities/Player.js`'s `damageReduction()` (`0.4 / (1 + 0.2 × this.upNb[5])`) is applied at all
      three `collision()` damage sites now. **The wiki's separately-quoted "−75% against
      projectiles" figure is NOT this term** — that turned out to be `(BodyDamagePoints+5)×
      multiplier`, diep's rule for how much damage *this tank's body* deals *to* a bullet on contact
      (the offensive side, governing how fast the rammed bullet's own health depletes), not how much
      damage this tank receives. Easy to conflate since both are "body damage" rules; only
      `dr = 1−4/(10·BS)` is the defensive term this bullet point is actually about, and it is the one
      built. (See #17's own Body Damage bullet for the *offensive* magnitude question, still open and
      independent of this.)
    - **A bullet's health is spent against the target's damage output — SHIPPED.** In diep a bullet
      (`BP = 20·Pf·PP` HP) loses HP equal to the target's DPL, so a high-body-damage tank eats
      bullets faster. `entities/Bullet.js`'s `collision()` used to do this only for base drones
      (`type === 1.4`, because a drone's `pene` is a 2000-point health pool rather than a spend-down
      budget) while an ordinary bullet spent against itself (`pene -= max(1, pene/5)`,
      target-independent) — that special case turns out to generalize to every bullet, so both the
      `KIND.PLAYER` and `KIND.OBJECTS` arms read `pene -= tick.perTick(other.damage)`
      unconditionally now, and the type-1.4 ternary is gone rather than rewritten.
    - **Penetration was counted twice, multiplicatively — SHIPPED 2026-07-30.** Measured
      2026-07-30, in a real room, against the real `shoot()`/`collision()` path with every other
      entity removed, **before this fix**: target a fresh 52 HP tank, attacker firing at 160 units —
      a Basic needed **43** bullets to kill it, a Twin 49, a Sniper 64, a Machine Gun 66, a Gunner 78,
      a 0-point Destroyer 19, a 7/7 Pene+Dmg Basic 5.1 — and a **maxed-Pene Destroyer one-shot**
      (399 dmg/bullet). Since the second bullet point above had shipped,
      `entities/Bullet.js`'s `pene -= tick.perTick(other.damage)` already made `pene` decide *how
      many ticks of contact a bullet survives*, but `pene` was *also* still the damage multiplier at
      `entities/Player.js`'s `Math.max(1, pene / 5)` — the same stat spent twice, roughly
      **quadratic in `pene` above 5, flat-and-tiny below it**, an ~900× spread between spam and
      Destroyer. **Fix:** the `Math.max(1, pene / 5)` multiplier (and the `BASE_DRONE_PENE`
      substitution it needed) is gone from `entities/Player.js` entirely, not replaced — a bullet's
      damage per tick is now just `can.damage × up.BDamage × dr`, and its total damage against a
      target still scales with `pene` purely through contact duration, the same shape base drones
      already used. Numerically a no-op for base drones (their `BASE_DRONE_PENE` substitution made
      the old multiplier evaluate to exactly 1 — `entities/Objects.js`'s own, differently-shaped
      `(pene>1)?pene:pene/2` shape-damage formula was untouched by this fix, deliberately: nothing in
      this measurement implicated it, and `test/rooms.js`'s "pene/2 * damage, not one-shots it" check
      pins it as intentional).
      **Bundled in the same pass** (found alongside the double-count, cheap, and also just a plain
      bug rather than a design question): `MEASUREMENTS.md`'s pinned "body damage is −75% against
      projectiles" was applied nowhere — `entities/Bullet.js` spent the raw `other.damage`
      (8.48485 for a 0-point tank), so bullets were eaten 4× faster than diep's own rule. Now applied
      via `entities/Bullet.js`'s `PROJECTILE_BODY_DAMAGE = 0.25`, at both sites a bullet's own `pene`
      is spent against a `damage` stat (`KIND.PLAYER` and `KIND.OBJECTS` — shapes have Body Damage
      too, diep_wiki/Stats.txt).
      **Found in the same pass, fixed 2026-07-30 (formerly nuance 50):** `entities/Player.js`'s
      `KIND.PLAYER` arm (tank-vs-tank body-ram damage) applied no equivalent to diep_wiki's "+50%
      against Tanks" — only the vs-shapes baseline (already correct, #17) and the vs-projectiles term
      existed. Fixed via a `TANK_BODY_DAMAGE = 1.5` constant multiplied in alongside
      `damageReduction()` at that one collision site, the same shape as `Bullet.js`'s
      `PROJECTILE_BODY_DAMAGE`. `KIND.OBJECTS` (shape damage) and `KIND.BULLET` (bullet damage) are
      untouched — the wiki multiplier is specific to a tank's body hitting another tank's body.
    - **Penetration → damage magnitude — SHIPPED 2026-07-30, and the predicted "column-wide
      TanksConfig.js rescale" turned out not to be needed.** diep's health loss per bullet does scale
      with penetration (`D_b ∝ PP`, because a tougher bullet survives more loops of contact) — that
      shape was already exactly what contact-duration scaling gave for free, with no multiplier
      needed. What was open was the *magnitude*: diep's stat slope is `1 + 0.75×points` on a bullet's
      own HP/`PP` (`diep_wiki/Dominator.txt`), ours was `up.BPene` accumulating `+1.0714286`/point
      from a base of 1 (a 6→7-cap rescale of an old, unrelated step — "1.25 x 6/7" — carried through
      #30's point-cap conversion, maxing at 8.5×). Since diep's own formula is *linear* in points
      (`base × (1 + 0.75n)` expands to `base + 0.75×base×n`), fixing the per-point step to a flat
      `+0.75` (`entities/Player.js`'s `upgrade()`) makes `up.BPene` diep's exact multiplier directly —
      no restructuring into a separate raw-point-count field the way `MSpeed`'s exponential form
      needed, because a flat accumulator step already **is** "a point count times a constant" once a
      linear formula is what's being matched. **`can.pene`/`necro.pene` in `TanksConfig.js` needed no
      rescale at all**: the old step's own 0-point baseline was already `up.BPene = 1`, identical to
      diep's `1 + 0.75×0`, so every per-cannon base value already sat at diep's base-HP figure — only
      the *maxed* multiplier moves (**8.5× → 6.25×**, verified by reproducing the old golden exactly
      with the old step as a no-op isolation check, nuance 34's technique), which is the actual
      fidelity fix and not something to compensate for. The three consumption sites
      (`entities/Player.js`'s two `Bull.pene =` assignments, `entities/Bullet.js`'s necromancer-drone
      one) and `lib/gameAI.js`'s Summoner boss (`up.BPene = detected.length * .9`, a wholly separate
      ad-hoc aggro-based scaling that deliberately zeroes out when unaggroed — nuance 49) all read
      `up.BPene` exactly as before and needed no changes, since the fix is entirely inside what
      `upgrade()` writes into that field.

    Adopting the full real model touches every `collision()` in `entities/`; all four fixes now do.

19. **Arena and shape density — SHIPPED, the density half**; **the arena-resize
    half stays deliberately open.** (The FOV half was already done: `config.FOV_MUL` 1.39 and
    multiplicative `FOV_PER_LEVEL` 1.005.)
    - **Shapes — SHIPPED, and the key insight is that diep's two formulas are a MATCHED PAIR.**
      `AL = ⌊√N_P × 50⌋` gu and `12,5 × N_P` shapes compose to `(√N·50)² / (12.5·N)` = a *constant*
      **1 shape per 200 gu², at every player count** — the player count cancels. So diep's real
      invariant is a **density**, and "12.5 per player" is only what that density looks like when
      the arena is also sized by N. That is what made the fix transferable: adopting `12.5 × N_P`
      alone onto our (bigger, fixed) arenas would have made them *emptier* than before, the exact
      opposite of this item. `rooms/Room.js` derives every mode's `sqr`/`tri`/`pnt` caps from the
      density against that mode's own area now, and each mode states only the **mix** it was tuned
      with (its verbatim old `objCaps`, normalised by `apportionShapes()`), so the proportions are
      untouched and only the total moves. Result, measured off the constructed rooms rather than
      computed: **ffa 725 → 1017, 2team 555 → 800, 4team 669 → 1012, sandbox 87 → 112**, every one
      landing at 1 per 200.0 gu². **boss barely moved (615 → 612)** — its tighter gu(350) arena was
      already almost exactly at diep's density, which is a useful cross-check that the formula is
      measuring something real. The old 1-per-261-gu²/0.76× figures are what this replaced.
    - **Arena — still open, and now open ON PURPOSE rather than by omission.** diep sizes it
      `AL = ⌊√N_P × 50⌋` gu (244 gu at our `maxPlayer: 24`) against our fixed **451/450/400** gu,
      i.e. 1.85×. The density work deliberately did **not** resize: cutting ffa to AL(24) is a **71% cut in
      area**, a balance change of a completely different magnitude to a density fix, affecting every
      distance the mode was tuned around — and nothing asked for it. The *machinery* now exists
      (`rules.arenaLive` recomputes `AL(live human count)` every tick through the existing
      `newMap` lerp), so adopting it for a mode is one flag; the call to point it at ffa is the part
      that is still a human's.
    - **Which modes scale is per-mode, and it follows `diep_wiki` rather than being applied
      globally.** Arena size is described as population-varying for **Sandbox** only ("The arena's
      size along with the number of shapes that spawn in it varies depending on the number of
      players connected to it", `diep_wiki/Game Modes.txt`) and as a timed shrink for **Tag**
      (`diep_wiki/Map.txt`); FFA/2 Teams/4 Teams describe nothing of the kind and keep the arena
      they have. Shape *density* is the general rule and applies everywhere. Sandbox sets
      `arenaLive` and is **inert today** — `maxPlayer: 0` caps it at one player and AL(1) = 50 gu is
      under the 150 gu floor — which `test/rooms.js` pins as a fact so a future `maxPlayer` change
      surfaces there rather than silently.
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

    One thing about the base drones is now resolved, one stays open:
    - **The HP scale — SHIPPED, and the answer is NOT what this item predicted.**
      `BASE_DRONE_HP` stays exactly **2000**. This item used to reason: our base tank was 150 HP, a
      maxed tank was 945 at the cap (`150 + 3·45 + 660`, our OLD custom formula), diep's own drone is
      ~7.1× a maxed diep tank, so the faithful figure on OUR (then-inflated) scale was ~6400 — a 3.2×
      increase, decided. That reasoning was correct for the formula it was written against, but #17's
      Max Health (above) didn't rescale that formula, it *replaced* it wholesale with diep's own raw
      `MH₀=50, +2/level, +20/point`. A maxed tank's pool on our scale is now, exactly, diep's own
      maxed pool (`50 + 44×2 + 7×20 = 278`) — verified by running the real `upgrade()`/level-up code,
      not asserted. `2000 / 278 = 7.194`, matching the wiki's "~7.1×" exactly, because there is no
      longer a scale gap between "diep's HP scale" and "ours" for a ratio to bridge — they're the
      same scale now. So the derived figure converges back to diep's own raw 2000; nothing in
      `lib/config.js` needed to change except the comment explaining why.
    - **`BASE_DRONE_DAMAGE: 2.97`** is derived (`8.48485 × 7/20`, our tank body damage scaled by the
      wiki's 7-per-loop against diep's 20-per-loop tank body), not observed. At today's rate that is
      ~74 HP/s from a single drone, nominal. Against a fresh (0-body-damage-point) victim, #18's `dr`
      term now cuts that to ~30 HP/s effective (`×0.4`) — but #17's health model also cut a maxed
      tank's pool 945 → 278, and the two don't cancel: a swarm of twelve still kills a maxed tank in
      well under a second (`278 / (12 × 74 × 0.4) ≈ 0.78 s`, against the old ~1.06 s). Playtest it
      before treating it as settled — the two changes' *combination* here was never separately
      checked.
    - `CONST.MAX_UP_POINTS` (33) and `CONST.MAX_PER_STAT` (7) are hand-mirrored between client and
      server, next to the input-prediction constants in item 24 — `test/rooms.js` cross-checks both
      against `entities/Player.js` since #30, so the pair can no longer drift silently.

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
    - **(b) Dead-reckon bullets instead of interpolating them. DONE for incoming fire; your own
      bullets deliberately still interpolate.** A non-drone bullet's motion is fully deterministic
      between collisions (`vec += speed·dir; vec *= BODY_FRICTION`, no input), so the client
      integrates it forward from the newest snapshot instead of drawing it one packet interval in
      the past. `public/client/entities.js`'s `Bullet.reckonMs()` is the whole rule: the lead is
      `NET.leadMs()` — the **same measured quantity** (a)'s tank prediction uses, `interval` to
      cancel the render delay plus `rtt/2` to cancel how stale the snapshot was in flight — capped
      at `CONST.DEAD_RECKON_MAX_INTERVALS` (3) packet intervals purely as a ceiling against a
      hostile measurement. Nothing is tuned.
      **Excluded, each for a stated reason:** drones (`type >= 1`) steer, so "deterministic" is
      false for them; pets chase their owner; traps are `type >= 1` anyway and decay to a standstill
      within a few ticks, so they have no delay worth cancelling.
      **And your own bullets are excluded too — a real, bounded asymmetry, not an omission.** An own
      bullet is welded to the *drawn muzzle* for its first packet interval (a deliberate spatial lie,
      so a shot leaves the barrel rather than open space beside it). Dead reckoning is the opposite
      claim about the same bullet — that it is already `leadMs` downrange because the server put it
      there — and both cannot be drawn. Running them together pops the bullet forward by about a
      bullet-speed at the phase-1→phase-2 handoff: **measured at ~54 units on a frame whose steady
      travel is ~18**, which `test/client.js`'s "no jump where its own interpolation takes over"
      catches. Closing that half means *ramping* the lead in across the handoff rather than switching
      it on — a change to the muzzle machinery, so it belongs with that code. Per (c) below, bounded
      symmetric error is the goal, and this is bounded and written down.
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
