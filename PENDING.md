# Pending & Decisions

Short-form companion to [HANDOFF.md](HANDOFF.md). Everything mechanical (the refactor, §1–9,
§12.1–12.2) is done and tested — this doc is only what's *left*: things needing a human call,
decisions already made but not yet built, and things nobody has verified yet. No status prose,
just the list.

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
   now reference by constant (#16 done) rather than hardcoding — nothing to keep in sync by hand.

## 🟣 Needs a human balance call (flagged by `test/tanks.js`)

26. `test/tanks.js` cross-checks `public/SHARE/TanksConfig.js`'s client (drawn) and server (spawn)
    cannon tables and whitelists a handful of real, deliberate deviations that aren't bugs but
    aren't confirmed-intentional either — full reasoning is in the `WHITELIST` table in that file,
    not duplicated here:
    - Twin, Twin Flank, and Triple Twin's cannons are all drawn `offx` ±17 but spawn bullets at
      ±18 - too consistent across three independently-written classes to be a typo, but never
      confirmed as an intentional spawn nudge either.
    - Summoner is the only class in the table where the drawn barrel is *shorter* than the spawn
      point (by 2.5 units) rather than the usual few-unit muzzle-tip lead - fixing it means either
      lengthening the drawn barrel or shortening the spawn radius, both of which change this
      boss's visuals or bullet range.
    - Minor test gap, low priority: the whitelist's `offdir` comparison is a literal `!==` and
      doesn't normalize angles mod 2π, so two float64 expressions for the same angle
      (Fortress/Summoner) read as a mismatch and need a whitelist entry that a correct comparison
      wouldn't require. Only ever a false positive, never a false negative.

## 🟢 Untested — real risk, nobody has watched these happen

3. A full match, start to finish: leveling into the class tree, death screen, respawn.
4. Two real humans in the same room (only single-player/single-tab has been tested).
5. Boss AI behavior — no longer entirely unwatched: `test/rooms.js` now drives a Summoner
   through two real `step()`s and asserts it actually adds a nearby player to `this.detected`,
   which caught a real bug (below) rather than just proving bosses *exist*. Still never watched
   in a live match with a human moving around it, though.
   - **Bug found and fixed**: `rooms/Room.js`'s `respawn()` swaps in a brand-new `Player`
     object and was not carrying over `inputs`, `userKey`, `unlocked`, or `killCounts` from the
     tank it replaced. A movement key held through the moment of death stayed physically held
     but arrived on the new tank looking exactly like "never pressed" (the client only re-sends
     `keydown` on an actual state change) — and since `shield` (spawn protection) only clears
     inside `motion()`/`shoot()` when they see real input, that silently extended spawn
     protection, which `Detector.js` hides from every boss/bot, until the player happened to
     press something new. Losing `userKey` also meant `Controller.disconnect()`'s achievement
     write-back silently no-op'd for the rest of the session after a single death. Also floored
     `lib/gameAI.js`'s Summoner distance divide (`n.level` → `Math.max(1, n.level)`) — level 0 is
     real for one tick on every join/respawn and made the divide `Infinity`.
6. The client in an actual browser (only a stub-DOM harness has run it — no real frame timing,
   no tab throttling). This pass touched rendering/feel more than anything before it has, so the
   in-browser checklist is longer than usual:
   - Account chip shows `Guest`; signing up carries coins over; the achievements edge-hover zone
     darkens/scrolls the way it's supposed to and a manual scroll actually pauses the auto-scroll.
   - `Ctrl+Shift+L` accepts `color`/`uiscale`/etc. and refuses an admin command for a non-admin.
   - Bullets visibly leave from the barrel tip, including while strafing hard perpendicular to
     the aim direction. Reported broken twice. The owner is now a real wire bit (`states[1]` on
     a `Bullets` instance), not a proximity guess, and the second fix replaced the temporal lead
     — which could only ever slide a bullet along its own velocity, and so did nothing for the
     strafing case, where the whole error is perpendicular to it — with a spatial offset that
     rides the drawn tank for the first packet interval and then decays
     (`public/client/entities.js`, `Bullet.update()`; `CONST.BULLET_LEAD_DECAY`).
     `test/client.js` now asserts the alignment directly, so this is a "confirm it *feels*
     right" check rather than a "confirm it works" one.
   - The camera has a *slight* trailing lag again (`CONST.CAM_SMOOTH`) — confirm it reads as a
     hair of chase, not the old pre-refactor drift. `CONST.CAM_SMOOTH` was playtest-tuned on top
     of a since-fixed bug in the local tank's own input-prediction lead (item 24) — the lead is now
     smaller and frame-rate-stable instead of growing with refresh rate, so this needs a genuine
     human retune with the game open, not just a "does it still look ok" check.
   - A green "shiny" polygon and a rainbow "Mythic" one are both visibly distinct from an
     ordinary shape (`public/SHARE/ObjectsConfig.js` — chances were retuned rarer than the
     first-pass defaults; confirm they still turn up often enough to notice in a normal session).
   - The minimap shows other players' dots, not just your own, moving smoothly (`Room.getUi`'s
     `map`, `Ui.map()` in `public/client/ui.js`).
   - Level 1 vs. level 30 with Movement Speed maxed: confirm the tank no longer rubber-bands
     differently at the two speeds (`public/client/game.js`'s prediction constants now match
     `entities/Player.js`'s exactly instead of a stale, unscaled guess).
7. Chat over a real client connection — admin commands are now proven end-to-end over a real
   socket against Postgres (connect/disconnect, permission gating, `broadcast`, `tps` all
   confirmed live), but chat hasn't been exercised the same way.
8. Real browser hitting the new packet-length validation (`chat`/`com` in particular) — a
    mistake here shows up as a kicked player, not a crash.
9. Load: multiple busy rooms at once on one process (everything so far is one room alone).

## 🟠 Known bug, not yet fixed

25. **`Room.spawnPoint()`'s `while(1)` can hang the server on a small enough map.** The default
    implementation (`rooms/Room.js`) rejects any point within a hardcoded 1100-unit radius of the
    origin plus two 800-unit nests at the quarter-points - written against ffa's 9020-unit map,
    where that's a small carve-out. Below roughly 1960 units wide, no point on the map can ever be
    1100 units from the origin, so the loop never finds an accepted point and spins forever, on
    the simulation thread, taking the whole room (every player in it) down with it. Currently
    survived only because `rooms/Sandbox.js` documents the floor in a comment and stays at 3000
    (comfortably clear); nothing stops a future mode, an admin `mapResize`, or a typo'd config from
    landing under 1960 and hitting it for real. Fix is either a loop iteration cap that falls back
    to a cheaper placement, or deriving the rejection radii from `mapSize` instead of hardcoding
    them against ffa's map.

## 🟡 Explicitly deferred (told not to do this pass)

11. The Spade Squad diep-physics balance pass. Part 4.1 of THEPLAN.md fixed the *client/server
    mismatch* in the existing movement constants (accel, drag, tick conversion) so prediction
    matches what the server actually does — it deliberately did not retune the underlying
    movement/knockback/recoil numbers themselves against any external reference. `lib/config.js`
    is explicit that every one of those was hand-tuned against a measured ~29Hz tick; retuning
    them is its own pass, to be scoped once real reference numbers are available.
    **The reference numbers now exist** — `physics.html` has been read against the whole tree and
    the mismatches are itemised in items 13–24 below. Still deferred, but no longer unscoped.

12. **Forward velocity inheritance on bullets** — a real diep/arras feel difference, deliberately
    not taken while fixing the muzzle alignment above, because it changes damage-relevant physics
    rather than what gets drawn. `entities/Bullet.js`'s constructor gives a bullet
    `Vec(speed*exitSpeed, 0).rotate(direction)` and nothing else: driving forward into your own
    shot changes nothing about it. arras adds the tank's velocity *projected onto the firing
    direction*, clamped at zero so it can only ever speed a bullet up, never slow it or bend it
    (`open-source-arras-main/server/game/entities/gun.js`, the `extraBoost` block in `fire()`) —
    which is why a rammer's shots there feel like they carry. Sideways motion is correctly
    ignored by that formula, so it does not reintroduce anything the muzzle fix just solved. Cheap
    to add; needs a balance opinion first, and interacts with #11.

## 🔴 Measured against diep.io's real physics (`physics.html`) — mismatches

*Source: `physics.html`, the archived spade-squad diep.io physics page (2022). Community-derived,
not diep source — one formula in it is internally implausible and is flagged as such below. Every
"ours" number here was read off the current tree, and every ratio is arithmetic on those two, not
a feel judgement. Nothing in this section has been changed; it is the scoping data #11 was waiting
on. Numbers assume today's `TICK_MS: 33` / `FRICTION: 0.964`; if WP3 of massplanchunks.md lands
first, re-derive against the new step.*

13. **Decide the unit anchor before touching any number — every other item depends on it.**
    diep denominates everything in grid units (`gu`, `1 gu = 50 du`) and fixes a tank at
    `Z = 2 × 1.01^(lvl-1)` gu **diameter**. We have two rulers and they disagree by 1.4×:
    - by the **tank** (`entities/Player.js`'s `size` is a radius — `rooms/Room.js:474` tests
      `dis <= a.size + b.size` — so a level-0 tank is 56 units across): `1 gu = 28 units`.
    - by the **grid** (`public/client/game.js:471` draws it at a 20-unit pitch): `1 gu = 20 units`.

    So our tank is 2.8 grid squares wide where diep's is 2.0. Which ruler you pick flips the sign
    of the movement verdict (22% too slow by the tank, 10% too fast by the grid), so pick first.
    **Recommend anchoring on the tank (`1 gu = 28 units`) and widening the client grid pitch
    20 → 28**, on two grounds: every diep gameplay number is gu-denominated and it is the tank that
    interacts with them; and at 28 units/gu our existing recoil constants already *are* diep's
    recoil table (item 16), which is evidence that is the factor the numbers were written against.
    Note that the grid pitch is currently drawn at 27.3 px on a 1920-wide screen against diep's
    27.5 px (diep's `0,55` px/du conversion) — i.e. the grid is already diep-sized on screen, and
    it is the tank that is 1.4× too big for it. Shrinking the tank to a 40-unit diameter is the
    other consistent option and costs no FOV change; it just makes every existing world constant
    (recoil, knockback, sizes, map) 1.4× wrong instead.

14. **Movement: right shape, wrong stiffness, and level/stat scaling is the wrong *form*.**

    | | diep | ours | ratio |
    |---|---|---|---|
    | top speed, base | `10 × A₀` = 12.94 gu/s = 6.47 tank-diameters/s | 284 u/s = 5.07 diam/s | **0.78×** |
    | accel → top-speed ratio | `v_max = 10 × A` | `v_max = 26.8 × len` | **2.7×** |
    | e-fold time to top speed | 0.42 s | 0.90 s | **2.14× floatier** |
    | speed vs level | `÷ 1.015^lvl` (×0.64 at lvl 30) | `− lvl/155` (×0.447 at lvl 30) | multiplicative vs **subtractive** |
    | speed vs stat | `× 1.07^vm` (+61% at 7) | `+ 0.020/pt` on 0.35 (+34% at 6) | additive, half the range |
    | stat cap / level cap | 7 points, 45 levels | 6 points, 30 levels | — |

    The form mismatch is the load-bearing part: because ours subtracts level and adds stat to the
    same accel term, a maxed-Movement level-30 tank ends up at **0.79× a fresh spawn's speed**,
    where diep's independent multipliers put it at **1.03×** — max move speed is supposed to buy
    back exactly what leveling costs. The linear level term also has no floor (it reaches zero
    speed at level 54), which only the 30-level cap is hiding.

    Diep-faithful replacements, if adopted: `len = 0.978`, `FRICTION = 0.9244` at `TICK_MS 33`
    (`len = 0.556`, `FRICTION = 0.9422` at 25 ms; `len = 1.449`, `FRICTION = 0.9091` at diep's own
    40 ms), with `len = base × 1.07^MSpeedPts / 1.015^level`.

15. **Reload is uniformly 1.4–2.0× too slow, and the reload *stat* may be far off.**
    diep quantizes reload to whole 40 ms loops with `RT = ⌈X₀ / …⌉` — confirmed by the reference's
    own table, where every non-integer technical time rounds up exactly (`7,5 x → 0,32 s`,
    `22,5 → 0,92`, `59,9 → 2,4`). We quantize the same way (`Math.round(can.reload * up.Reload)`),
    so only the constants are wrong:

    | class | diep | ours | ratio | faithful `reload` @33ms |
    |---|---|---|---|---|
    | Basic / Twin | 15 loops = 0.60 s | 32 / 28 ticks = 1.06 / 0.92 s | 1.76× / 1.54× | 18 |
    | Machine Gun (`Rifle`) | 8 = 0.32 s | 14 = 0.46 s | 1.44× | 10 |
    | Sniper | 23 = 0.92 s | 55 = 1.82 s | 1.97× | 28 |
    | Assassin | 30 = 1.20 s | 52 = 1.72 s | 1.43× | 36 |
    | Destroyer | 60 = 2.40 s | 105 = 3.47 s | 1.44× | 73 |
    | Overlord/Overseer | 90 = 3.60 s | 220 = 7.26 s | 2.02× | 109 |

    **The stat needs an in-game measurement before adopting.** The reference writes
    `RT = ⌈X₀/1,875^br⌉`, which taken literally means a Basic with 5 reload points fires *every
    loop* (25 shots/s) — not credible. `1.875 = 1 + 0.125 × 7`, so it is almost certainly a mangled
    rendering of a linear form reaching 1.875× fire rate at max stat. Under that reading diep is
    ×1.875 and ours is ×2.23 (`up.Reload -= 0.092`/pt, 6 pts) — close enough to leave alone. Under
    the literal reading nothing about our reload stat is salvageable. Measure before choosing.

16. **Recoil is already diep's table (mostly); knockback is 5–7× too weak.**
    At 28 units/gu, an impulse `v` decays to `v × F/(1-F) = 26.8 v` units of displacement, so
    `back` ≈ diep's recoil in gu at a 0.957 conversion — i.e. **1:1**. Spot-checking against the
    reference's recoil table: Basic `0.4` vs 0.4 ✅, Twin `0.3` vs 0.3 ✅ (but our Twin's two barrels
    disagree — `0.3` and `0.4`), Machine Gun `0.6` vs 0.4 ❌, Sniper `0.3` vs 1.2 ❌ (4× weak),
    Destroyer `3.8` vs 6.0 ❌. **Audit the whole `back` column against the table — it is a
    copy job, not a retune.** (If #14's `FRICTION` changes, the conversion stops being 1:1:
    `back = gu × 28 × (1-F)/F`, i.e. ×2.55 at `F = 0.9244`.)

    Knockback did not get the same treatment and is an order of magnitude off:

    | | diep, per loop of contact | ours, per tick of overlap | ratio |
    |---|---|---|---|
    | tank body | 1.6 gu | impulse 0.3 → 0.29 gu | **5.6× weak** |
    | basic bullet | 0.667 gu | `weight/3` = 0.1 → 0.096 gu | **7.0× weak** |
    | drones | 0.8 gu | same 0.3 `weight` as everything else | — |

    diep also *inverts* knockback against damage — Destroyer 0.2 gu, Annihilator 0.1 gu, against
    Basic's 0.667 — where our `weight` is a flat 0.3 for Basic and Destroyer alike. The whole
    `weight` column wants replacing from the Knockbackfactor table.

17. **Health, regen and body damage.**
    - **Max health.** Same shape (`MH₀ + 2·lvl + 20·mh` vs `150 + 3/lvl + 110/pt`), very different
      balance of terms: diep is 10 levels per health point, ours is 36.7 — that ratio is
      `MH₀`-independent and is the real mismatch. Ours ends up with leveling worth +60%
      survivability and the stat worth +440%; diep splits it +180%/+280% *if* `MH₀ = 50`, which
      the reference does not state → measurement task.
    - **Bug while in there:** `entities/Player.js:275` adds 110 max HP then scales current HP by
      `maxHp/(maxHp-100)`. The 100 should be 110; as written every Max Health point under-heals.
    - **Regen.** diep is linear in time: `HPS = MH × (0.03 + 0.12·rr)/30` → full heal in 1000 s at
      0 points, 34.5 s at 7. Ours (`hpregan[1]` accumulates, then is added, every tick) is
      *quadratic* — full heal in 46 s at 0 points, 28 s at max. So our base regen is **21× faster
      than diep's** and our regen stat is nearly worthless (1.6× range vs diep's 29×). The
      quadratic ramp is a crude accidental stand-in for diep's out-of-combat regen rule, which the
      reference does not document — decide whether to keep it deliberately or go linear.
      Side effect of `parseInt(hpregan[1] * maxHp * 10)/10`: regen is quantized to 0.1 HP, so
      nothing at all heals for the first ~22 s at 0 points / 150 maxHp. That dead time shrinks as
      maxHp grows, which is backwards.
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
      `entities/Player.js:379` is `hp -= other.damage * max(1, other.pene/5)` flat.
    - **A bullet's health is spent against the target's damage output.** In diep a bullet
      (`BP = 20·Pf·PP` HP) loses HP equal to the target's DPL, so a high-body-damage tank eats
      bullets faster. Ours spends penetration against *itself*: `pene -= max(1, pene/5)`
      (`entities/Bullet.js:65`), target-independent.
    - **Penetration → damage is a coincidence, not a design.** diep's health loss per bullet does
      scale with penetration (`D_b ∝ PP`, because a tougher bullet survives more loops of contact),
      so our `× max(1, pene/5)` is accidentally the right *shape* — but the magnitude is off
      (diep ×6.25 at max bp; ours ×2.89 at max) and ours has a dead zone below `pene 5` where the
      stat does nothing at all. Stat slope is 0.75/pt (diep) vs 1.25/pt (ours).

    Adopting the real model would touch every `collision()` in `entities/`. It is the difference
    between "ramming is a build" and "ramming is chip damage", so it is a design call, not a bug
    fix — but nothing else in this section will make combat feel like diep on its own.

19. **FOV, arena and shape density — the world is 2.5× emptier per screen than diep's.**
    - **FOV.** diep: `1920/0,55 = 3491 du = 69.8 gu` wide at level 1, growing `×1.005/level`
      (i.e. `√1.01`, exactly half the tank's growth rate, which is why diep tanks visibly get
      bigger). Ours: `screen = 1408` = 50.3 gu, growing `+22/level` = +1.56%/level. So we are
      **1.39× too narrow at level 1** and only 1.09× too narrow by level 30 — the base is wrong
      *and* the per-level term is 3× too fast, in opposite directions. Faithful: base ×1.39,
      per-level `× Math.pow(1.005, level)` (≈ +7 units/level at level 1, not 22). This puts a real
      number on massplanchunks.md WP4's guessed `FOV_MUL: 1.3` → **1.39**, and says
      `FOV_PER_LEVEL` should be multiplicative, not `26`.
      Note also that diep's FOV is *resolution-dependent* (fixed 0.55 px/du, so an ultrawide
      genuinely sees more) where ours scales to fit. Ours is the fairer design; flagging it only
      so the difference is deliberate.
    - **Arena.** diep sizes it per room: `AL = ⌊√N_P × 50⌋` gu (244 gu at our `maxPlayer: 24`).
      Ours is a fixed 9020 units = **322 gu, 1.32× larger** — and never changes with occupancy.
    - **Shapes.** diep's count is `12,5 × N_P`, which with the arena rule is a *constant*
      1 shape per 200 gu² at any player count. Ours works out to 1 per 261 gu² (397 shapes over
      322 gu²) — 0.76× the density. Combined with the narrow FOV, a diep screen holds ~13.7 shapes
      and ours ~5.4. If the "world feels empty" complaint in massplanchunks.md is being chased,
      **this is the number, not the drift rate.**

20. **diep's loop is 40 ms (25 Hz), not 33 and not 25.** The reload table proves it: every
    technical reload time is a multiple of 0.04 s and every fractional one appears rounded *up* to
    a whole 0.04 s in the "Reload Time (0 br)" column. This does not invalidate massplanchunks.md
    WP3's decision to *step* at 40 Hz — a finer step with the same balance is strictly better than
    diep — but **WP3's `REF_TICK_MS` should be 40, not 33**, so that diep's per-loop constants
    (recoil gu, knockback gu, reload loops, `A₀` du/loop²) drop in unconverted and stay readable
    against the reference forever. Picking 33 means carrying a 33/40 fudge on every number
    imported from this page.

21. **Auto-turret spin is 2.2× too slow.** diep's `ω = 1 rad/s` exactly (`t_r = 2π s`). Ours:
    `autoDir += .015`/tick = 0.455 rad/s (`entities/Player.js:134`; base drones at `.012`,
    `entities/Bullet.js:284`). Faithful value is `TICK_MS/1000` — 0.033 at 33 ms, 0.025 at 25 ms.

22. **Things that already match — do not "fix" them.** Tank growth (diep `2×1.01^(lvl-1)` gu = ×1.35
    over 30 levels; ours `28 + ⌊lvl/2.8⌋` = ×1.357 — linear vs exponential but the endpoints agree
    to 0.5%). Necromancer base drone count (diep `22 + 2·br`; ours `maxDrone = 22` — only the
    growth differs, ours is +1/reload point against diep's +2). Reload quantization to whole ticks.
    Per-tick-of-contact damage application (diep's "law 3").

23. **Not covered by `physics.html` at all — still needs measuring in a real client.** Bullet base
    speeds and lifetimes (the page defines `V_b = ρ/t_b` but lists no values), bullet spread
    (`rand`), shape HP/XP/drift, `MH₀`, drone orbit behaviour, camera lag, out-of-bounds depth and
    push, base-drone stats. This is the same list massplanchunks.md WP13 asks for; the page closes
    the FOV and camera-adjacent parts of it (item 19) and nothing else.

24. **Close-quarters bullet truth — the dimensional bug is fixed; the rest of the error budget is
    still open.** `public/client/game.js`'s input prediction used to scale a per-tick acceleration
    by only **one** power of `tickLen`, where the conversion to per-frame needs `tickLen²` — the
    local tank was drawn up to a full tank diameter ahead of the server, growing with refresh
    rate (up to 70 units at 144fps), and every freshly-fired bullet inherited that as its spawn
    lead. Fixed: the integrator moved into `public/SHARE/Physics.js` and `predic` stays in
    units-per-*tick*, scaled once at integration (`Physics.stepBody`). The remaining, unfixed
    sources of client/server bullet-position disagreement rank cheapest-first:
    - **(a) Derive the lead instead of tuning it.** The correct prediction lead is
      `(interp delay + RTT/2) × velocity` ≈ 16 units at base top speed on a 50 ms RTT, smaller
      than what the fixed integrator settles on now. We do not measure RTT — the `ping` message
      is a server→client heartbeat the client echoes (`net/gameSocket.js:44`,
      `public/client/game.js:761`). Making it measurable is cheap and needs no schema change:
      `ping` already carries a value byte, so a client-initiated probe can send `1`, the server
      echoes it back as `1`, and the client times it; `0` stays the heartbeat. Then
      `CONST.SIZE*2` and `CONST.SMOOTH`'s decay stop being the things that decide how big the lie
      is.
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
