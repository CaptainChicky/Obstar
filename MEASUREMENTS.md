# Measurements

What still has to be observed in a **real diep.io client**, because no reference we have supplies
it. Everything else that used to be here — bullet range/lifetime, scatter, the reload stat's real
form, shape drift — turned out resolvable from `diepcustom`/`diepindepth` directly and is gone.

**Only two entries left, both pure client feel that no server-side reference repo can carry:
camera lag and health-bar hold timing.**

---

## Do NOT measure these — they are already pinned

Re-measuring any of these wastes a session and risks replacing an exact derived value with a noisy
measured one.

| Quantity | Value | Source |
|---|---|---|
| **Tank friction** | `F = 10/11` exactly, per 40 ms loop | Derived from diep's `V_max = 10×A` (`physics.html`) — see HANDOFF §3 |
| **Universal body friction** | `F = 0.9` for every non-tank entity (bullets, traps, drones, shapes) | `diepcustom/src/Entity/Object.ts:274`; `diepindepth/physics/README.txt` §3 |
| Tank base acceleration | `A₀ = 2.58825 du/loop²` per `physics.html`, **but see PENDING #4** — `diepcustom` gives the same formula one level base apart, and our 0-based `level` field arguably wants `1.428` not `1.449` | `physics.html` / `TankBody.ts:271` |
| Bullet lifetime / `baseAccel` / `baseSpeed` / scatter | see HANDOFF §3 and `diepcustom/src/Entity/Tank/Projectile/Bullet.ts` / `Barrel.ts` | resolved from source |
| Reload stat form | `reloadTime = 15 × 0.914^points × barrel.reload` — geometric | `TankBody.ts:267` |
| Hyper regen | `+ maxHp/250` per reference tick, additive on the linear rate | `Live.ts:130-135` |
| Shape drift | `BASE_ORBIT 0.005` rad/tick, `BASE_VELOCITY 1` du/tick — halved for Pentagon/Alpha | `AbstractShape.ts:39-42` |
| Shape table (HP/XP/damage/radius/Shiny) | see [plan.md](plan.md) S3 | `Entity/Shape/*.ts` |
| Base-drone speed / detect radius | `54 du/tick` = 756 u/s; `ai.viewRange 900 du` = 504 units | `BaseDrones.ts` |
| Level / stat scaling | `A = A₀ × 1.07^points / 1.015^level` | `physics.html`, confirmed in `TankBody.ts:271` |
| Upgrade economy | 45 levels, 7 points/stat, 33 total, tiers every 15 | `Camera.ts:168-173`, `config.ts:113` |

**Why tank friction needs no measurement.** `physics.html` states `V_max = 10 × A` for tanks. For
the recurrence `v ← (v + A)·F`, steady state is `A·F/(1−F)`. Setting that equal to `10A` gives
`F/(1−F) = 10`, so `F = 10/11` exactly.

**The universal `0.9` is a different fact from the tank's `10/11`, not a contradiction of it.**
diep applies the *same* 0.9-per-tick drag to every entity including tanks, but a tank integrates
it in a different order (`v += A; x += v; v *= 0.9` vs this tree's `v = (v+A)·F; x += v`) — both
reach the same `10·A` steady state, which is what `F = 10/11` was derived to guarantee. See
HANDOFF §3 for the full derivation; do not re-open it.

---

## Methodology, read once before measuring anything

**The background grid is the ruler.** One grid square is exactly 1 gu. Do not reference the arena
edge or the screen: field of view changes with level *and* resolution, so anything measured
against the viewport drifts between takes. The grid is absolute and always on screen.

**Sandbox mode is the instrument.** `K` levels up (hold to repeat), `\` cycles classes, `O`
self-destructs, `;` toggles god mode. God mode plus a fixed class is what makes a repeatable take
possible at all.

**Record at 60 fps or higher, but do not trust single-frame deltas.** The simulation runs at 25
loops/s (40 ms); a 60 fps capture therefore alternates between frames covering one loop and two.
Measure over a span of ≥10 frames, or better, measure the endpoints (total distance, total time)
and divide.

**Averaging, because of the salt.** diep randomises bullet spawn position and direction per shot.
Anything bullet-related needs **N ≥ 20 shots** averaged. Record the individual samples, not just
the mean — the distribution's *shape* tells you whether it's uniform or gaussian.

**Always measure the base case:** Basic Tank, level 1, 0 points in every stat, unless the entry
says otherwise. Scaled values are derivable; base values are not.

---

## M5 — Camera lag `CAM_SMOOTH`

Ours is an explicit placeholder, playtest-tuned on top of a since-fixed input-prediction bug, and
has never been calibrated against anything real. `diepcustom` is server-only (no camera code at
all); `diepindepth/canvas/` covers the render scale factor, draw order and colour constants but
says nothing about camera smoothing.

**Protocol.** Accelerate from a standstill to top speed in a straight line. Measure the offset in
gu between the tank's drawn position and the exact screen centre, at steady state. Steady-state lag
is proportional to `1/CAM_SMOOTH`, so one clean number at a known speed pins it. Repeat at a second
speed (maxed Movement Speed) to confirm the relationship is linear in speed, not fixed.

---

## M6 — `HP_BAR_HOLD`

A pure feel knob that was never measured against anything. `diepindepth/canvas/render_order.txt`
lists `RenderHealthBars()` with an empty body; nothing else in either reference tree touches it.

**Protocol.** Damage a Pentagon once, then leave it alone. Count frames from the last hp change
until its health bar begins to fade. Convert to seconds.

---

Everything else that used to gate on a measurement session — the 45/7/33 economy, tank movement
magnitudes, the friction split, recoil/knockback, health/regen, arena/shape density, bullet dead
reckoning, the gamemodes, the damage model's *structure* — shipped without ever needing a live
diep client; `diepcustom`/`diepindepth` supplied it directly. What's now known to be wrong on the
numbers despite that (the damage *magnitude* scale factor, the XP curve, Crasher chase speed, …)
is tracked in **[plan.md](plan.md)**, not here — those are source-derivable fixes, not
measurements.
