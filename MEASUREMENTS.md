# Measurements

Everything that still has to be observed in a **real diep.io client** because no reference we
have supplies it. Companion to [PENDING.md](PENDING.md); each entry says which PENDING item it
unblocks.

Sources already exhausted: `physics.html` (the archived spade-squad physics page) and `diep_wiki/`.
If something is not in this file, it is either already known (see the next section) or it is a
design decision rather than a measurement.

---

## Do NOT measure these — they are already pinned

Re-measuring these wastes a session and risks replacing an exact value with a noisy one.

| Quantity | Value | Source |
|---|---|---|
| **Tank friction** | **`F = 10/11 = 0.909090…` exactly, per 40 ms loop** | Derived, not measured — see below |
| Tank base acceleration | `A₀ = 2.58825 du/loop²` (= `1.449` at our 28 units/gu) — **qualified, see contradiction C3 below; not silently exact** | `physics.html` |
| Tank top speed | `10 × A` → 12.94 gu/s base | `physics.html` |
| **Universal per-tick body friction** | `F = 0.9` for every `ObjectEntity` — bullets, traps, drones, shapes, the Summoner's scripted drift, not just tanks | `diepcustom/src/Entity/Object.ts:274`; `diepindepth/physics/README.txt` §3 (plan.md Step 9) |
| Bullet lifetime | `round(lifeLength × 75)` reference ticks (`× 88` for a diep `"drone"`-type barrel, `-1` sentinel unchanged) | `diepcustom/src/Entity/Tank/Projectile/Bullet.ts:96` (plan.md Step 9) |
| Bullet `baseAccel`/`baseSpeed` | cruise thrust `(20 + 3P) × bullet.speed` du/tick; one-shot muzzle kick `baseAccel + 30 − rand·scatterRate` du/tick | `diepcustom/src/Entity/Tank/Barrel.ts:213`; `Projectile/Bullet.ts:86` (plan.md Step 9) |
| Bullet scatter | uniform on `±5 × scatterRate` degrees (angular) plus a uniform `[0, scatterRate)` du/tick muzzle-speed jitter | `diepcustom/src/Entity/Tank/Barrel.ts:128-129`; `Projectile/Bullet.ts:86` (plan.md Step 8) |
| Reload stat form | `reloadTime = 15 × 0.914^points × barrel.reload` — geometric, not linear | `diepcustom/src/Entity/Tank/TankBody.ts:267` (plan.md Step 1) |
| Hyper regen | `+ maxHp/250` per reference tick, **additive** on top of the linear rate (10%/s at 0 Regen points, stacks with base) | `diepcustom/src/Entity/Live.ts:130-135` (plan.md Step 4) |
| Shape drift | `BASE_ORBIT 0.005` rad/tick (direction wander) / `BASE_VELOCITY 1` du/tick (drift speed) — Pentagon/Alpha Pentagon get exactly half of both. `BASE_ROTATION 0.01` (the shape's own spin) is diep's number too but was deliberately NOT adopted — see PENDING nuance 55 for why | `diepcustom/src/Entity/Shape/AbstractShape.ts:39-42,105-125`; `Entity/AI.ts:75` (plan.md Step 7) |
| Shape table (HP/XP/body damage/radius/Shiny) | Square 10/10/8/38.891du, Triangle 30/25/8/38.891du, Pentagon 100/130/12/53.033du, Alpha Pentagon 3000/3000/20/141.421du, Crasher small 10/15/8/24.749du, Crasher large 30/25/8/38.891du; Shiny `hpMul ×10`/`prizeMul ×100` | `diepcustom/src/Entity/Shape/{Square,Triangle,Pentagon,Crasher}.ts`; `diepindepth/physics/README.txt` §2.1/§5.2.1 (plan.md Step 6) |
| Base-drone speed / detect radius | `54` du/tick = 756 u/s terminal; `ai.viewRange 900` du = 504 units, measured from the base | `diepcustom/src/Entity/Misc/BaseDrones.ts:44-54` (plan.md Step 10) |
| Arena Closer / Dominator size | Arena Closer `BASE_SIZE 175` du (98 units, 3.5× a base tank); Dominator `SIZE 160` du (89.6 units, 3.2×) — both circles (`sides: 1`) | `diepcustom/src/Entity/Misc/ArenaCloser.ts:21`; `Entity/Misc/Dominator.ts:26` (plan.md Step 11) |
| Unit scale | 1 gu = 50 du (diep's own); we use 28 world units/gu | derived from the two `V_MT` forms |
| Level / stat scaling | `A = A₀ × 1.07^vm / 1.015^lvl` | `physics.html` |
| Base max health | `MH₀ = 50`, `+2/level`, `+20/point` | `diep_wiki/Stats.txt` |
| Regen (slow regime) | `HPS = 1/30 × MaxHP × (0.03 + 0.12 × rr)` | `diep_wiki/Stats.txt` |
| Regen (hyper regime) | triggers after **~30 s** without damage; solve the rate from the 0–7 time-to-full table (31.97 / 30.67 / 23.07 / 15.15 / 11.75 / 9.13 / 7.72 / 6.41 s) | `diep_wiki/Stats.txt` |
| Shape HP / body damage / XP | Square 10/8/10, Triangle 30/8/25, Pentagon 100/12/130, Hexagon 1500, Alpha 3000/20/3000 | `diep_wiki/Polygons.txt` + per-shape pages |
| Green ("shiny") variants | ×10 HP, ×100 XP, body damage unchanged | `diep_wiki/Polygons.txt` |
| Knockback per class | full Knockbackfactor table (gu per loop of contact) | `physics.html` |
| Body damage | `(points + 5) × 4` vs shapes, **+50%** vs tanks, **−75%** vs projectiles | `diep_wiki/Stats.txt` |
| Bullet base HP / damage | 2 HP, 7 damage per loop | `diep_wiki/Dominator.txt` (quoted as ×tank multiples) |
| Arena size / shape count | `AL = ⌊√N_P × 50⌋` gu; `12.5 × N_P` shapes — these **compose to a constant 1 shape per 200 gu²**, which is the form actually adopted (plan.md step 6) | `physics.html` + `diep_wiki/Polygons.txt` |
| Upgrade economy | 45 levels, 7 points/stat (10 Smasher), 33 total, tiers every 15 | `diep_wiki/Levels.txt` |

**Why tank friction needs no measurement.** `physics.html` states `V_max = 10 × A` for tanks. For
the recurrence `v ← (v + A)·F`, steady state is `A·F/(1−F)`. Setting that equal to `10A` gives
`F/(1−F) = 10`, so `F = 10/11` exactly. The `0.9091` quoted in PENDING #14 was a rounded 10/11 the
whole time. Cross-checks: the page's two forms of top speed (`10A` du/loop and `5A` gu/s) force
1 gu = 50 du at 25 loops/s, which yields 12.94 gu/s; and `2.58825 × 28/50 = 1.449`, PENDING's `len`.
Every number closes, so **do not spend a session confirming tank speed against the arena edge.**

**`A₀ = 2.58825` is qualified, not silently exact — contradiction C3 (plan.md).** `diepcustom/src/
Entity/Tank/TankBody.ts:249` and `diepindepth/physics/README.txt` §3.2 both give **`2.55`** with the
level term `1.015^(L−1)` (1-based levels); `2.55 × 1.015 = 2.58825` exactly, so `physics.html`'s
figure is the same formula quoted one level higher, not a disagreement. `entities/Player.js:856`'s
own comment says our `this.level` is 0-based and `Physics.moveAccel` already divides by
`1.015^this.level` with that 0-based level — i.e. it already uses diep's `1.015^(L−1)` form, so the
coefficient it actually wants is diep's **level-1** value, `2.55 × 0.56 = 1.428` units, not `1.449`.
That is a **1.47% high** base top speed (`362.25 → 357.0 u/s`). **Not a planned step**: this table's
whole point is forbidding re-derivation of this pair on one's own initiative, so the correction is
recorded here rather than applied — a one-literal change with a two-line justification whenever a
human wants it.

**The universal friction `0.9` (plan.md Step 9) is a different fact from the tank's `10/11` above,
not a contradiction of it.** diep applies the *same* 0.9-per-tick drag to every entity, tanks
included, but tanks and bullets integrate it in a different order: diep does `v += A; x += v;
v *= 0.9` for a tank (`diepcustom/src/Entity/Object.ts:265-275`) versus this tree's
`v = (v + A)·F; x += v` — both reach the *same steady state* (`10·A`, because `F = 10/11` was
derived to make that identity hold), so `F = 10/11` remains correct for tanks and is not "really"
0.9 in disguise. The two integration orders differ only in **transient** decay rate (diep's error
decays ×0.9/tick, ours ×0.909/tick), which is the whole story for a *maintained-velocity* bullet,
whose terminal speed is `thrust × F/(1−F)` — `22.0×` thrust at this tree's old `BODY_FRICTION`
against diep's flat `10×` at `0.9`. That is why `BODY_FRICTION` needed to become diep's literal
`0.9` (not `10/11`) while `Physics.FRICTION` (tanks) correctly stays `10/11`: same underlying
constant, different consumption order, not two independent numbers.

---

## Methodology, read once before measuring anything

**The background grid is the ruler.** One grid square is exactly 1 gu. Do not reference the arena
edge or the screen: field of view changes with level *and* with resolution, so anything measured
against the viewport drifts between takes. The grid is absolute and always on screen.

**Sandbox mode is the instrument.** `K` levels up (hold to repeat), `\` cycles classes, `O`
self-destructs, `;` toggles god mode. God mode plus a fixed class is what makes a repeatable take
possible at all.

**Record at 60 fps or higher, but do not trust single-frame deltas.** The simulation runs at 25
loops/s (40 ms); a 60 fps capture therefore alternates between frames covering one loop and two.
Per-frame position deltas oscillate ±50 % *even at perfectly constant speed*. Measure over a span
of ≥10 frames, or better, measure the endpoints (total distance, total time) and divide.

**Averaging, because of the salt.** diep randomises bullet spawn position and direction per shot.
Anything bullet-related needs **N ≥ 20 shots** averaged, and the spread itself used to be a
measurement target in its own right (the old M2, resolved from source — see the "do NOT measure"
table above) rather than noise to be eliminated. Record the individual samples, not just the
mean — the distribution's *shape* tells you whether it is uniform or gaussian, which matters for
reproducing it.

**Always measure the base case:** Basic Tank, level 1, 0 points in every stat, unless the entry
says otherwise. Scaled values are derivable; base values are not.

---

## M5 — Camera lag `CAM_SMOOTH`

**Unblocks:** PENDING #23 and the item 6 browser checklist.

Ours is an explicit placeholder, playtest-tuned on top of a since-fixed input-prediction bug, so it
has never been calibrated against anything real.

**Checked against both references — neither has anything.** `diepcustom` is server-only, so it has
no camera code at all; `diepindepth/canvas/` covers the render scale factor, draw order and colour
constants but says nothing about camera smoothing (`grep -rin "camera|lerp|smooth" diepindepth/
canvas` returns nothing relevant). This is a pure client-feel knob and still needs the live
observation below.

**Protocol** Accelerate from a standstill to top speed in a straight line. Measure the offset in gu
between the tank's drawn position and the exact screen centre, at steady state. Steady-state lag is
proportional to `1/CAM_SMOOTH`, so one clean number at a known speed pins it. Repeat at a second
speed (maxed Movement Speed) to confirm the relationship is linear in speed rather than fixed.

---

## M6 — `HP_BAR_HOLD`

**Unblocks:** PENDING #23. Lowest value on this list — a pure feel knob that was never measured
against anything.

**Checked against both references — neither has anything.** `diepindepth/canvas/render_order.txt`
lists `RenderHealthBars()` with an empty body, and nothing else in either reference tree touches
it. Still needs the live observation below.

**Protocol** Damage a Pentagon once, then leave it alone. Count frames from the last hp change until
its health bar begins to fade. Convert to seconds.

---

## Sequencing — what's left

Everything that used to gate on a measurement session is done. PENDING #30 (the 45/7/33 economy),
#14 (tank movement magnitudes), #16 (recoil/knockback), #17 (health/regen/body damage), #19
(arena/shape density), #24(b) (bullet dead reckoning), the gamemodes, and #18 (the damage model)
all shipped without ever needing a live diep client — the ordered, per-step version of that work,
with the exact numbers and golden-test outcomes, lives in **[plan.md](plan.md)**, which is what
the work was actually run off. `physics.html`/`diep_wiki/` covered most of it; where they fell
short, `diepcustom`/`diepindepth` (plan.md's reference repos) supplied the rest.

M1 (bullet range/lifetime), M2 (scatter), M3 (reload stat form) and M4 (shape drift) turned out to
be resolvable from those same two reference repos rather than a live measurement, and are gone from
this file entirely (plan.md Steps 9, 8, 1, 7 respectively).

**What's left is only M5 (camera lag) and M6 (`HP_BAR_HOLD`)** — both checked against both
reference repos above and confirmed to have nothing (diepcustom is server-only; diepindepth's
canvas notes don't cover either knob). Neither reference project runs a real client, so these two
pure client-feel knobs are the only entries in this file that still need a session with diep.io
actually open.
