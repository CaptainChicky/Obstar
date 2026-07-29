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
| Tank base acceleration | `A₀ = 2.58825 du/loop²` (= `1.449` at our 28 units/gu) | `physics.html` |
| Tank top speed | `10 × A` → 12.94 gu/s base | `physics.html` |
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
| Arena size / shape count | `AL = ⌊√N_P × 50⌋` gu; `12.5 × N_P` shapes | `physics.html` + `diep_wiki/Polygons.txt` |
| Upgrade economy | 45 levels, 7 points/stat (10 Smasher), 33 total, tiers every 15 | `diep_wiki/Levels.txt` |

**Why tank friction needs no measurement.** `physics.html` states `V_max = 10 × A` for tanks. For
the recurrence `v ← (v + A)·F`, steady state is `A·F/(1−F)`. Setting that equal to `10A` gives
`F/(1−F) = 10`, so `F = 10/11` exactly. The `0.9091` quoted in PENDING #14 was a rounded 10/11 the
whole time. Cross-checks: the page's two forms of top speed (`10A` du/loop and `5A` gu/s) force
1 gu = 50 du at 25 loops/s, which yields 12.94 gu/s; and `2.58825 × 28/50 = 1.449`, PENDING's `len`.
Every number closes, so **do not spend a session confirming tank speed against the arena edge.**

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
Anything bullet-related needs **N ≥ 20 shots** averaged, and the spread itself is a measurement
target (see M2) rather than noise to be eliminated. Record the individual samples, not just the
mean — the distribution's *shape* tells you whether it is uniform or gaussian, which matters for
reproducing it.

**Always measure the base case:** Basic Tank, level 1, 0 points in every stat, unless the entry
says otherwise. Scaled values are derivable; base values are not.

---

## M1 — Bullet range `ρ` and lifetime `t_b` *(highest value; unblocks the most)*

**Unblocks:** PENDING #23's `speed`/`life` columns, and closes the last of the #14/#16 FRICTION
question. **This is the single most valuable measurement on the list.**

`physics.html` parameterises bullets as `V_b = ρ/t_b` — range over lifetime, with **no drag term
anywhere**. Our tree instead runs bullets through the *tank* recurrence (`v = (v + speed)·F`) using
the shared global friction, which is a tank model applied to a bullet. Confirming diep's model is
what lets tank friction and bullet motion be separated cleanly rather than as a workaround.

**Protocol**
1. Basic Tank, level 1, 0 Bullet Speed points. Sit still (recoil moves you and corrupts the range).
2. Fire a single shot with the grid visible. Record.
3. Frame-step: note the position at the muzzle and at despawn.
4. **`ρ`** = distance travelled, in grid squares. **`t_b`** = frames from spawn to despawn ÷ fps.
5. Repeat ≥20 times, average.

**The question that matters most — is the speed constant?** Compare gu-per-frame just after the
muzzle against just before despawn, over ≥10-frame spans at each end.
- **Flat** → diep's bullets are constant-velocity with a lifetime. `ρ/t_b` is the entire model, and
  our bullets should stop sharing the tank's `FRICTION` altogether.
- **Decaying** → bullets have their own drag. Fit the ratio to get `F_bullet`, which will *not* be
  10/11 (that value is derived from a tank identity).

Either answer closes the question permanently. Record which one you saw.

**Then repeat for the archetypes**, since per-class `speed`/`life` both vary: Sniper (long range),
Machine Gun (short), Destroyer (slow, heavy), Trapper (traps decay differently), and one drone
class (drones steer, so they are a separate model — note it, don't fit it).

---

## M2 — Bullet scatter `h`

**Unblocks:** PENDING #23's `rand`.

The form is known: `w = h / ρ_Vb`, i.e. scattering rate is the spread triangle's height divided by
the bullet's range. So you need `h` at a known range, and `ρ` comes from M1.

**Protocol**
1. Same base setup. Fire ≥30 shots at a fixed aim direction without moving.
2. At a fixed distance from the muzzle (pick a grid line several squares out), record where each
   bullet crosses it, perpendicular to the aim.
3. `h` = the width of the envelope containing the samples, in gu, at that distance.
4. Note the **distribution shape**, not just the width — uniform and gaussian need different code.

Machine Gun is the useful second sample here; its cone is visibly wider and makes the measurement
far easier to read than Basic's.

---

## M3 — Reload stat form *(resolves a live ambiguity, not just a value)*

**Unblocks:** PENDING #15's reload-stat decision. **Do this after the #30 economy change**, so the
comparison is at 7 points on both sides.

`physics.html` writes `RT = ⌈X₀/1.875^br⌉`, which read literally means a Basic with 5 reload points
fires *every loop* (25 shots/s) — not credible. `1.875 = 1 + 0.125 × 7` strongly suggests a mangled
linear form reaching 1.875× fire rate at max stat. Only observation settles it.

**Protocol**
1. Basic Tank, hold fire, count shots over 30 s at **0** reload points. → shots/s.
2. Repeat at **7** reload points.
3. The ratio is either **≈1.875×** (linear reading — our ×2.23 at 6 points is close enough to leave
   alone) or **wildly higher** (literal reading — our reload stat is unsalvageable).

Also worth capturing while you are here: **Overseer and Overlord drone-summon cooldowns**, which
PENDING #15 flags as ambiguous (the reference's merged "90 loops" maps onto neither our 182 nor our
281, and both are summon cooldowns rather than bullet reloads).

---

## M4 — Shape drift

**Unblocks:** PENDING #23's shape drift.

Polygons idle-drift and slowly rotate. Nothing documents the rate.

**Protocol** Park in god mode near an undisturbed Square, Triangle and Pentagon. Record 30 s of
each untouched. Measure translation in gu/s and rotation in rad/s. Note whether drift direction
persists or resamples, and roughly how often — that is the part that decides how it is coded.

---

## M5 — Camera lag `CAM_SMOOTH`

**Unblocks:** PENDING #23 and the item 6 browser checklist.

Ours is an explicit placeholder, playtest-tuned on top of a since-fixed input-prediction bug, so it
has never been calibrated against anything real.

**Protocol** Accelerate from a standstill to top speed in a straight line. Measure the offset in gu
between the tank's drawn position and the exact screen centre, at steady state. Steady-state lag is
proportional to `1/CAM_SMOOTH`, so one clean number at a known speed pins it. Repeat at a second
speed (maxed Movement Speed) to confirm the relationship is linear in speed rather than fixed.

---

## M6 — `HP_BAR_HOLD`

**Unblocks:** PENDING #23. Lowest value on this list — a pure feel knob that was never measured
against anything.

**Protocol** Damage a Pentagon once, then leave it alone. Count frames from the last hp change until
its health bar begins to fade. Convert to seconds.

---

## Sequencing — what you can finish *before* touching any of this

**Almost everything.** The friction finding removed the dependency that made measurement look
like a prerequisite. Safe to complete first, in this order:

1. **PENDING #30** — the 45/7/33 economy. Wholly structural, zero measurement.
2. **#14 tank movement magnitudes** — `A₀` and `F = 10/11` are exact. Adopt tank motion *without*
   touching bullets; that separation is the faithful model, not a workaround.
3. **#16 recoil + knockback columns** — both act on *tank* velocity, so once #14's `F` is set they
   are pure arithmetic against the Knockbackfactor table. Still gated on the ~7-class roster
   decision and the 1.26× rescale error, neither of which is a measurement.
4. **#17 health + regen** — `MH₀`, the linear rate and the hyper threshold are all known; the hyper
   *rate* is solvable from the published time-to-full table. Do it after #30 so the domain is 7.
5. **#23 `BASE_DRONE_HP` → 6400** — decided.
6. **#19 arena/density** — formulas known. Real work is making `baseSize` and the nest carve-out
   radii scale, since they are absolute today and `rooms/Room.js` warns the placement loop becomes
   unsatisfiable below ~2744 units wide.
7. **#24(b), gamemodes (Tag first), #18's damage model** — none measurement-gated.

**What genuinely waits for a session with diep open:** the bullet `speed`/`life` columns (M1),
`rand` (M2), the reload stat (M3), shape drift (M4), and the two feel knobs (M5, M6).

The efficient order is therefore: **do 1–7, then one measurement session covering M1–M6 in a single
sitting, then apply.** M1 and M3 are the only two whose answers can change a design decision rather
than just fill in a constant, so if the session has to be cut short, do those.
