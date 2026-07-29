# Pending & Decisions

Short-form companion to [HANDOFF.md](HANDOFF.md). Only what's *left*: things needing a human call,
decisions already made but not yet built, and things nobody has verified yet. Anything that has
actually shipped is deleted from this file rather than recorded here.

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
   now reference by constant rather than hardcoding — nothing to keep in sync by hand.

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
   - Level 1 vs. level 30 with Movement Speed maxed: confirm the tank does not rubber-band
     differently at the two speeds.
   - **Tank growth is diep's exponential now** (`28 * 1.01^level`, a radius, continuous rather
     than stepping every 2.8 levels). Confirm a tank visibly grows smoothly as it levels and that
     nothing keyed to `size` (barrel scaling, drawn hitbox, minimap dot) looks off at level 30.
   - **The `c` auto-spin** starts from wherever the barrel is pointing when you press it and
     spins from there; releasing leaves the tank facing where the spin left it, and the next
     mouse move takes over cleanly.
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
     - Walk into an enemy base: the drones run you down fast (`BASE_DRONE_CHASE_SPEED`, a level-0
       tank's own top speed), and a drone knocked off its ring visibly sprints back and settles
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

## 🟡 Explicitly deferred (told not to do this pass)

11. The Spade Squad diep-physics balance pass. The client/server *mismatch* in the existing
    movement constants (accel, drag, tick conversion) is fixed, so prediction matches what the
    server actually does — that pass deliberately did not retune the underlying
    movement/knockback/recoil numbers themselves against any external reference. Every one of those
    was hand-tuned against a measured ~29Hz tick; retuning them is its own pass.
    **The reference numbers now exist** — `physics.html` has been read against the whole tree and
    the mismatches are itemised in items 14–24 below. Still deferred, but no longer unscoped.

## 🔴 Measured against diep.io's real physics (`physics.html`) — mismatches

*Source: `physics.html`, the archived spade-squad diep.io physics page (2022). Community-derived,
not diep source — one formula in it is internally implausible and is flagged as such below. Every
"ours" number here was read off the current tree, and every ratio is arithmetic on those two, not
a feel judgement. Nothing in this section has been changed; it is the scoping data #11 was waiting
on. Numbers assume the real-world quantities `TICK_MS: 33` / `FRICTION: 0.964` implied (top speed,
recoil, reload in seconds); the later `TICK_MS: 25` / `REF_TICK_MS: 40` split preserved those
real-world quantities exactly, so no re-derivation is needed here.*

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

    **The 284 u/s above is a level-0, no-upgrade tank walking — not this game's ceiling.**
    `BASE_DRONE_CHASE_SPEED` is pinned to the real maximum, so `test/rooms.js`'s
    `fastestTankSpeed()` measures it by replaying `entities/Player.js`'s own `motion()` + `shoot()`
    recurrence over every reachable class at 6 Movement Speed and 6 Reload, firing continuously
    with the recoil aimed along the direction of travel:

    | build | sustained |
    |---|---|
    | **Fighter, level 29** (rear pair, `back 2.04776` on a 22-tick reload) | **399.2 u/s** |
    | Machine Gun, level 12 | 394.1 |
    | Booster, level 29 | 393.8 |
    | Triangle, level 19 | 389.9 |
    | Twin, level 12 | 372.8 |
    | walking only, level 0, no upgrades | 284.0 |

    So riding your own recoil is worth ~1.4× a plain walk, and **~400 u/s is the ceiling any build
    in this game can hold.** The level penalty (`Physics.moveAccel` subtracts `level /
    MOVE_LEVEL_FALLOFF`) is why each class is fastest at the lowest level it unlocks at, and why no
    higher-level build beats these. The helper is a live test, not a recorded number — a cannon or
    stat retune that moves the ceiling fails `test/rooms.js` rather than silently drifting from
    item 23's base-drone chase speed.

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
      `entities/Player.js`'s player-vs-bullet arm is `hp -= other.damage * max(1, other.pene/5)` flat.
    - **A bullet's health is spent against the target's damage output.** In diep a bullet
      (`BP = 20·Pf·PP` HP) loses HP equal to the target's DPL, so a high-body-damage tank eats
      bullets faster. Ours spends penetration against *itself*: `pene -= max(1, pene/5)`
      (`entities/Bullet.js`), target-independent.
    - **Penetration → damage is a coincidence, not a design.** diep's health loss per bullet does
      scale with penetration (`D_b ∝ PP`, because a tougher bullet survives more loops of contact),
      so our `× max(1, pene/5)` is accidentally the right *shape* — but the magnitude is off
      (diep ×6.25 at max bp; ours ×2.89 at max) and ours has a dead zone below `pene 5` where the
      stat does nothing at all. Stat slope is 0.75/pt (diep) vs 1.25/pt (ours).

    Adopting the real model would touch every `collision()` in `entities/`. It is the difference
    between "ramming is a build" and "ramming is chip damage", so it is a design call, not a bug
    fix — but nothing else in this section will make combat feel like diep on its own.

19. **Arena and shape density — the world is emptier per screen than diep's.** (The FOV half of
    this item is done: `config.FOV_MUL` 1.39 and multiplicative `FOV_PER_LEVEL` 1.005.)
    - **Arena.** diep sizes it per room: `AL = ⌊√N_P × 50⌋` gu (244 gu at our `maxPlayer: 24`).
      Ours is fixed and never changes with occupancy: ffa/4team/2team are **451/450/400 gu**, i.e.
      **1.85× diep's 244 gu**. Resizing toward diep is still open.
    - **Shapes.** diep's count is `12,5 × N_P`, which with the arena rule is a *constant*
      1 shape per 200 gu² at any player count. Ours is 1 per 261 gu² — 0.76× the density; combined
      with the narrow FOV, a diep screen held ~13.7 shapes and ours ~5.4. The grid rescale held
      this ratio constant rather than improving it (`objCaps` went ×1.96 with the map's area purely
      to stop the per-screen count halving). If the "world feels empty" complaint is being chased,
      **this is still the number** — and the lever is the arena bullet above, since our
      squares-per-screen is now the thing that is 1.85× off.
    - Note also that diep's FOV is *resolution-dependent* (fixed 0.55 px/du, so an ultrawide
      genuinely sees more) where ours scales to fit. Ours is the fairer design; flagged only so
      the difference stays deliberate.

21. **Auto-turret spin is 2.2× too slow.** diep's `ω = 1 rad/s` exactly (`t_r = 2π s`). Ours is
    ~0.455 rad/s in real-world terms (`entities/Player.js`'s `SPIN_RATE`, which also drives the `c`
    auto-spin; base drones similarly in `entities/Bullet.js`). Faithful value is real-world
    `1 rad/s`, expressed as a per-reference-tick constant through `lib/tick.js`. One constant now,
    so both spins move together.

22. **Things that already match — do not "fix" them.** Necromancer base drone count (diep
    `22 + 2·br`; ours `maxDrone = 22` — only the growth differs, ours is +1/reload point against
    diep's +2). Reload quantization to whole ticks. Per-tick-of-contact damage application (diep's
    "law 3").

23. **Not covered by `physics.html` at all — still needs measuring in a real client.** Bullet base
    speeds and lifetimes (the page defines `V_b = ρ/t_b` but lists no values), bullet spread
    (`rand`), shape HP/XP/drift, `MH₀`, camera lag (`CONST.CAM_SMOOTH` is still a placeholder) and
    `CONST.HP_BAR_HOLD`, a pure feel knob that was never measured against anything.

    Two things about the base drones stay open:
    - **The HP scale.** `BASE_DRONE_HP: 2000` is the wiki's number on *diep's* HP scale, and ours
      is not diep's — our base tank is 150 HP against diep's unmeasured `MH₀`, and a maxed level-30
      tank here is 900. If `MH₀` is 50, diep's base drone is ~7.1× a maxed tank, which on our scale
      would be ~6400, not 2000. 2000 ships because it lands on "very durable but killable", which is
      the design intent; the 6400 alternative is blocked on the same `MH₀` measurement item 17 wants.
    - **`BASE_DRONE_DAMAGE: 2.97`** is derived (`8.48485 × 7/20`, our tank body damage scaled by the
      wiki's 7-per-loop against diep's 20-per-loop tank body), not observed. At today's rate that is
      ~74 HP/s from a single drone, so a swarm of twelve kills a 900 HP tank in about a second.
      Playtest it before treating it as settled.
    - `CONST.MAX_UP_POINTS` is hand-mirrored between client and server, next to the
      input-prediction constants in item 24.

24. **Close-quarters bullet truth — the remaining error budget.** The dimensional bug in the
    client's input prediction is fixed (the integrator lives in `public/SHARE/Physics.js` now and
    `predic` stays in units-per-*tick*, scaled once at integration). What is left, cheapest-first:
    - **(a) Derive the lead instead of tuning it.** The correct prediction lead is
      `(interp delay + RTT/2) × velocity` ≈ 16 units at base top speed on a 50 ms RTT, smaller
      than what the fixed integrator settles on now. We do not measure RTT — the `ping` message
      is a server→client heartbeat the client echoes (`net/gameSocket.js`,
      `public/client/game.js`). **This does need a schema change, contrary to what this item used
      to claim**: `public/SHARE/SocketSchema.js` frames `ping` as `null` (a bare header) with
      packet length `[1, 1]`, and the `0` in both `talk(socket, 'ping', 0)` and
      `PROTO.encode('ping', 0)` is discarded. Making RTT measurable means a payload byte, the
      length bound moving to `[2, 2]`, and an encoder/decoder entry on both sides — after which a
      client-initiated probe can send `1`, the server echoes `1`, the client times it, and `0`
      stays the heartbeat. Then `CONST.SIZE*2` and `CONST.SMOOTH`'s decay stop being the things
      that decide how big the lie is.
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
