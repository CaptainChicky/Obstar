# plan.md — the rescale & silhouette-repair pass

The previous plan.md (the diep.io fidelity diff, chunks D/P/T/B/S/A/M/X/G/C) ran all 15 of its
execution steps and was deleted. Its surviving decisions live in
**[PENDING.md](PENDING.md) → "📕 plan.md's surviving nuances"**.

**This file is the corrective pass for what that plan's step 15 (item C2) broke, plus the six
graphics defects that pass left standing.** Everything here is a **[BUG]** — a thing we meant to
match and don't, or a thing that throws. There is exactly one **[DECIDE]** (shape palette), at the
end.

---

## What actually went wrong

### One sentence

`C2` converted the whole barrel roster with **0.56 units/du**, the factor for *absolute* lengths,
into fields that the renderer and the shooter both **divide by `CONST.SIZE = 35`** before using —
where the correct factor is **0.70 units/du**. Every barrel and bullet it touched came out **0.8×
too small**, and the fields it *didn't* touch stayed on 0.70, so a single barrel now mixes two
scales.

### The derivation, so nobody re-litigates it

diep draws a barrel at `definition.size × scaleFactor`, `scaleFactor = tank.physicsData.size / 50`.
A tank's body radius *is* `physicsData.size`. So in diep:

```
barrelLength / bodyRadius  =  definition.size / 50          ← the only ratio that matters
```

We draw a barrel at `c.height × r`, `r = param.size / CONST.SIZE` ([drawings.js:33](public/client/drawings.js#L33)),
and the body at radius `param.size` ([drawings.js:166](public/client/drawings.js#L166)), where
`param.size = 28 × 1.01^level` ([entities/Player.js:1024](entities/Player.js#L1024)). So for us:

```
barrelLength / bodyRadius  =  c.height / CONST.SIZE  =  c.height / 35
```

Equate them: **`height = definition.size × 35/50 = definition.size × 0.70`.**

`0.56` is `28/50` — the du→unit conversion for a length that is used *as a world length* (arena
size, `bossSize`, drone resting radius). It is correct there and only there. The `35` in the
denominator is what makes barrels a different case, and plan.md's own C2 text **noticed** it —
*"Our barrel lengths are drawn against a reference tank radius of 35 where diep's are against
50 du. The ratios happen to agree for Basic (68/35 = 1.94 vs 95/50 = 1.90)"* — and then converted
with 0.56 anyway. The ratio it wrote down *is* the fix; the factor it applied is a different
quantity.

The server has the identical structure — `ra = this.size / 35`,
`len = can.canonLength * ra`, `Bull.size = can.size * ra`
([entities/Player.js:323,363,442](entities/Player.js#L323)) — so `canonLength` and `can.size` are
on the same 0.70 axis, and B2's bullet-radius identity is
`(barrel.width / 2) × bullet.sizeRatio × **0.70**`, not `× 0.56`.

### The evidence that 0.70 is what the tree was already built on

Measured across the whole pre-C2 roster (`git show e5a1804~1`), client `height ÷ diep barrel.size`:

```
n = 132 barrels    min 0.551    median 0.692    mean 0.6938    max 1.133
```

and the **ten classes T2 added most recently** — Hunter, Predator, Streamliner, Stalker,
Spread Shot, Gunner Trapper, Tri-Trapper, Skimmer, Factory, Mothership — sat on **exactly 0.700**,
every barrel. Someone had already derived the right factor one step earlier in the same plan.
Three more independent confirmations, all of which C2 left untouched and therefore still read 0.70
today:

| field | ours | diep | implied factor |
|---|---|---|---|
| Twin `offx` | 18 | `offset 26` | 0.692 |
| auto-turret `rad` | 18 | `AutoTurret.ts:87` `baseSize = 25` | 0.720 |
| Auto 3/5 `distance` | 14 | ~20 du socket | 0.700 |
| `drawTrapLauncher`'s own comment | — | — | says *"× our existing **0.7** barrel-scale ratio"* out loud ([drawings.js:14](public/client/drawings.js#L14)) |

So the roster is now **0.56 for `height`/`width`/`canonLength`/`can.size`** and **0.70 for
`offx`/`open`/`distance`/`rad`** — mixed inside the same barrel. That is the "proportions are way
off" you are seeing, and it is worse than a uniform 20% shrink because the *taper* fields no longer
match the widths they taper.

### Why every test stayed green

`test/tanks.js` (631 assertions) compares client `height` against server `canonLength × 0.93` and
nothing else. Both halves moved together, so all 631 held. **A test that only compares our two
halves against each other cannot catch a scale error** — that is now a standing rule in PENDING.md,
and R7 below adds the assertion that would have caught this one.

### Why "bullets spawn away from the barrel"

Three distinct causes, only one of which is the old C1:

1. **Defender** ships `distance: 33.6` on its three turret cannons server-side and **no `distance`
   at all** on the client draw — bullets literally spawn 33.6 units out from a barrel drawn at the
   hull centre. Pure client/server desync, R5.
2. **The bullet is now 20% smaller than the muzzle it leaves** (`can.size` on 0.56, muzzle `width`
   on 0.56 but `open` on 0.70), so it no longer visually plugs the barrel mouth the way it used to.
   R1 fixes it.
3. The genuine prediction/strafe error C1 named (causes 2 and 3) is still there and still needs a
   browser session. Do not blind-tune it. It is now the *smallest* of the three.

---

## Why porting from diepcustom keeps producing errors

This is worth writing down once, because it explains every item below and it is not obvious.

**diepcustom is a complete reimplementation of diep.io's *server*. It has no renderer.** There is
no draw code anywhere in `diepcustom/src` — the real diep.io client draws everything, and
diepcustom only produces the *entity state* that client consumes: `physicsData.size`, `sides`,
`positionData.x/y/angle` (relative to a **parent**), `styleData.flags`, `isTrapezoid`. It is a
faithful source for **what exists and how it behaves**, and it is *silent* on **how any of it
becomes pixels**. Every drawing rule we need has to be reconstructed from the outside — from
`diepindepth/canvas/` (a separate, partial RE effort) or by inference. Three examples that bit us:

- **the `× √2` circumradius identity** — a polygon's *drawn* radius is `physicsData.size × √2`.
  Never stated; recovered by noticing every shape sets `size = drawnDu × √½`.
- **`showsAboveParent`** — a z-order flag on the wire. What it means for draw order is the client's
  business, and it decides whether an Auto 3 turret base sits under or over the hull (R9).
- **the `35` vs `50` reference** — *this* pass's defect. diep's numbers are relative to a 50 du
  body; ours are relative to a 35-unit drawing constant. Nothing in diepcustom mentions either,
  because on diep's side the ratio never has to be written down.

**And the architectures are shaped differently.** diep is a **scene graph**: a barrel, a turret, a
guard, a launcher, a Dominator's base are each their own `ObjectEntity` with `setParent(...)`, their
own `scaleFactor`, their own `angle`, their own `tick()`, and their own z-order. Ours is **flat**:
one `Player` entity, one static `cannons[]`/`turrets[]` table in `TanksConfig.js`, one draw function
that iterates it. Porting therefore means **flattening a tree into a table** — and everything that
needed its own `tick()` has no slot to flatten into. That is exactly where the losses are:

| diep | what flattening lost |
|---|---|
| `GuardObject` — a child polygon that spins at its own rate | R4: guards exist server-side as data and are drawn nowhere |
| `createAutoTurrets`'s invisible **rotator** parent | R9: the ring doesn't rotate, mounts at a fixed distance instead of `0.8 × size`, ignores z-order and owner input |
| `AutoTurret` with `influencedByOwnerInputs` + `targetFilter` | R9: no click-to-aim, no 90° arc |
| addon barrel defs living in `Entity/Tank/*.ts`, not `Const/TankDefinitions.json` | R3: six classes were marked "no diep source" when the source was one directory over |

**So: you are not missing anything.** The previous pass converted what it could match one-to-one
against `Const/TankDefinitions.json`, marked everything else "no source to convert against", and
stopped — when Arena Closer and all three Dominators are *in* that JSON (ids 16, 45, 46, 47), and
Summoner/Guardian/Defender/Fallen*/Mothership/the addons all have real definitions in
`src/Entity/`. Combine that with one wrong conversion factor applied uniformly, and you get exactly
what you're looking at: a roster that is 20% wrong everywhere it was touched, untouched and
therefore *inconsistent* where it wasn't, and missing every feature that needed more than a row in
a table.

---

## The plan

### R1 — **[BUG] Rescale every reference-relative barrel field from 0.56 to 0.70** ⭐ the big one

**Multiply by `1.25` (= 0.70/0.56) every value C2 wrote**, in both halves of
[public/SHARE/TanksConfig.js](public/SHARE/TanksConfig.js):

| field | half | today (Basic) | after |
|---|---|---|---|
| `cannons[i].height` | client | 53.2 | **66.5** (`95 du × 0.7`) |
| `cannons[i].width` | client | 23.52 | **29.4** (`42 du × 0.7`) |
| `turrets[i].height` / `.width` | client | 30.8 / 16.464 | **38.5 / 20.58** (`AutoTurretDefinition` 55 / 29.4) |
| `cannons[i].canonLength` | server | 53.2 | **66.5** |
| `cannons[i].size` | server | 11.76 | **14.7** (`(42/2) × sizeRatio 1 × 0.7`) |
| `sub` / `weapon` sub-barrel `size` | server | Skimmer 11.76, Factory 14.11 | **× 1.25** — these were built on the 0.56 identity in B3 and inherit the same defect |

**Do not touch** `offx`, `open`, `offdir`, `distance`, `rad`, `openlength`, `trapezoidDirection`,
`body.width/height`, or any `bossSize` — those are already on 0.70 (or are absolute), and R1's whole
point is to bring the converted fields *back* to them. `open` in particular is a hand-authored
taper in 0.70 units with no diep counterpart; leaving it alone is what makes BattleShip
(`width 16.464, open -16` → a **0.46-unit-wide muzzle spike** today) and Machine Gun/Overseer/
Overlord/Necromancer/Manager/Mega Trapper/Overtrapper/Trapper come back to their intended shape for
free.

Rewrite the file-head comment block that states the 0.56 identity — it is the thing a future reader
will trust. State **both** rows of the unit table (PENDING.md has the wording) and say why they
differ.

**Sanity check after:** Basic `66.5` vs its hand-drawn original `68` — within 2.3%. The whole
roster should land within a few percent of the pre-C2 silhouettes you liked, except where C2 caught
a *real* error (Spread Shot's fan ramp, which diep lists centre-barrel-last — keep C2's
angle-magnitude pairing, it was right).

### R2 — **[BUG] Bosses are a third reference, not 50 du**

`Summoner.ts`/`Guardian.ts`/`Defender.ts` define `sizeFactor = (physicsData.size / √½) / BOSS_SIZE`
— a boss's barrels are denominated against **its own** base size, not 50. So for a boss:

```
height = definition.size × 35 / BOSS_SIZE
```

| boss | `BASE_SIZE` (du) | source | barrel |
|---|---|---|---|
| Summoner | 150 | `Summoner.ts:56` | `size 135, width 71.4`, ×4 at `PI2 × i/4`, sides **4** |
| Guardian | 135 | `Guardian.ts:53` | `size 100, width 71.4`, sides **3** |
| Defender | 150 | `Defender.ts:75` | `size 120, width 71.4`, sides **3** |
| Dominator | 160 | `Dominator.ts:40` | ids 45/46/47 in `TankDefinitions.json` |
| Arena Closer | 175 | `ArenaCloser.ts:31` | id 16 |
| Mothership | (level 140 body) | `Mothership.ts` | id 27 |

This also closes Summoner's long-standing `height 44` vs `canonLength 50` gap (`135 × 35/150 =
31.5` for both) — the one class in the roster whose drones visibly spawn *past* the muzzle.
`bossSize` itself is an **absolute** length and stays on 0.56 (Defender 150 → 84 ✓, Dominator 160 →
89.6 ✓, Closer 175 → 98 ✓). Do not convert it twice — see R6.

### R3 — **[BUG] "No diep source to convert against" was wrong for six classes**

C2's own comment excludes *"Summoner; Arena Closer; the 3 Dominators"* as having no diep counterpart.
They all do:

- **Arena Closer** is `TankDefinitions.json` **id 16**: one barrel, `size 75, width 42`, `sides 1`,
  ordinary `bullet`. Ours draws `height 68, width 34, **open 34**` — a flared machine-gun muzzle
  invented from a wiki trivia line ("shortest and widest cannons"). **You are right: diep's is a
  plain Flank-Guard-shaped rectangle.** Set `height 52.5, width 29.4, open 0` (and
  `canonLength 52.5`).
- **Dominator** is **ids 45 / 46 / 47** — Destroyer (`size 80, width 35`), Gunner (`75/17.5` ×2 at
  `offset ∓6` + `80/17.5` centre, with real `delay` values 0.666/0.333/0.001), Trapper (8 ×
  `60/21` at `i × π/4`, every one with `addon: "trapLauncher"`). All three carry
  `preAddon: "dombase"` (R4) and 45/46 carry `postAddon: "dompronounced"`.
- **Summoner / Guardian / Defender / Fallen Overlord / Fallen Booster** all have inline
  `BarrelDefinition`s in `diepcustom/src/Entity/Boss/*.ts` (R2's table). Fallen Overlord's bullet
  overrides are right there too: `sizeRatio 0.5, speed 1.7, damage 0.56, health 12.5`
  (`FallenOverlord.ts:38`).

Convert all six through R2's per-boss factor. K1 (Cyclone / Submachine / Auto Hover / Fortress)
genuinely has no counterpart and stays a stand-in — that part of C2's exclusion list was correct.
While here, fix **Submachine**'s `height 65` vs `canonLength 60` (a stand-in, so pick one; make the
drawn tip the authority).

### R4 — **[BUG] Guard addons are not drawn at all** *(Smasher/Spike's "rotating black outer things")*

The **server already models them exactly** —
[`TanksConfig.js:3370`](public/SHARE/TanksConfig.js#L3370) has
`guards: [{ sizeRatio, sides, rate, phase }]` and `entities/Player.js:1032` derives `guardSize` from
it for collision. The client half of the same file has no `guards` key and
[drawings.js](public/client/drawings.js) has no renderer, so a Smasher is a bare circle.

diep's geometry, verbatim from `Addons.ts` (`createGuard(sides, sizeRatio, offsetAngle, radiansPerTick)`):

| addon | guards |
|---|---|
| `smasher` (Smasher, and inside `autosmasher`) | `(6, 1.15, 0, 0.10)` |
| `landmine` | `(6, 1.15, 0, 0.10)` **and** `(6, 1.15, 0, 0.05)` — two hexes at different rates |
| `spike` | `(3, 1.3, 0, 0.17)`, `(3, 1.3, π/3, 0.17)`, `(3, 1.3, π/6, 0.17)`, `(3, 1.3, π/2, 0.17)` |
| `dombase` (all 3 Dominators) | `(6, 1.24, 0, 0)` — static |

`GuardObject` sets `size = owner.size × sizeRatio × √½` and `styleData.color = Color.Border`, and a
polygon's drawn circumradius is `size × √2` (the same identity C3 already fixed the shapes with) —
so **the drawn circumradius is exactly `owner.size × sizeRatio`**, no √2 bookkeeping needed at the
draw site. `radiansPerTick` is per 40 ms reference tick; run it through `lib/tick.js`.

Work: mirror `guards` into the client half, add `Drawings.guards` (an n-gon at circumradius
`param.size × sizeRatio`, filled with the **border/outline** colour, drawn **before** the body so
the body sits on top), and call it first in `render.js`'s draw order. `Auto Smasher` needs its guard
*and* its existing turret. Also add the `launcher` preAddon (Skimmer/Rocketeer) while the mechanism
is open: `Addons.ts:232` — a trapezoid at `sizeRatio 65.5×√2/50`, `widthRatio 33.6/50`, positioned
at `size/2`, barrel-coloured.

### R5 — **[BUG] Six classes render as *nothing*: a divide-by-zero in `setCoord`**

[render.js:29-47](public/client/render.js#L29): `if (config.cannons)` is **true for an empty array**,
the loop body never runs, and then `middleX /= config.cannons.length * 2` → **`0/0` = `NaN`**. The
`if (!config.cannons && !config.turrets)` fallback below can never fire for the same reason. `mX`/
`mY` reach `ui.js:928`'s `ctx.translate(w/2 - NaN, ...)` and the entity draws nowhere.

Hits every class with `cannons: []`: **Smasher, Landmine, Spike, Auto Smasher, Auto 3, Auto 5.**
That is your "the smasher class is empty and not even drawn" — the guard (R4) is missing *and* the
tank itself is not rendered at all.

Same block, second bug: the `turrets` loop also divides by **`config.cannons.length`**, not
`turrets.length` — copy-paste. Fix both; guard on `.length`, not truthiness.

### R6 — **[BUG] Mothership: body 44% too small, wrong body shape, wrong drones**

- **Size.** `bossSize: 63.14` is `28 × 1.01^140 × 0.56` — but `28 × 1.01^140` is *already* in our
  units (28 **is** the level-0 radius). The 0.56 is applied twice. Correct value: **`112.8`**
  (cross-check: diep's `50 × 1.01^139 du × 0.56 = 111.6`). Fix the literal and the comment.
- **Body.** `Mothership` is `sides: 16` in `TankDefinitions.json`; we draw `body.shape: 0`, a
  circle. `Drawings.body` only has circle / roundRect / pentagon — **`sides` isn't modelled at all**.
  Add a generic n-gon body (`shape: 3`, `body.sides`), which also gives Guardian (3), Defender (3),
  Summoner (4) and Mothership (16) their real silhouettes instead of the circle/rounded-rect
  stand-ins.
- **Barrels.** diep's 16 are `size 60, width 10.5`, **`isTrapezoid: true`**, and at
  `angle = π/16 + i·2π/16` — a half-step offset ours doesn't have. Ours are draw-`type: 0`
  rectangles at `i·2π/16`. Use draw-type 2 (trapezoid) and add the half-step.
- **Drones.** `droneCount: 2` per barrel × 16 = 32 ✓ matches `maxDrone`. But `can.size: 2.94` is
  `(10.5/2) × 0.56`; on R1's axis it is **3.675**, and the diep bullet block gives
  `health 2, damage 0.7, speed 0.48, lifeLength -1, sizeRatio 1` — re-derive the row against that
  rather than the hand-set numbers.

### R7 — **[BUG] Skimmer crashes the client: `Drawings.bullet[4]` doesn't exist**

`Drawings.bullet` is a 4-element array (0 bullet / 1 drone / 2 trap / 3 square).
`rooms/Room.js:1793,1746` sends `type: parseInt(obj.type)`, and **Skimmer's cannon is `type: 4`** —
the only type in the whole roster that `parseInt`s outside `0..3`. `render.js:125,135` then calls
`Drawings.bullet[4](...)` → `TypeError: not a function` the instant a Skimmer bullet enters view.
**That is the crash.**

Two fixes, both needed:
1. Add a real draw entry for the Skimmer projectile (diep draws it as a circle with its own two
   opposed sub-barrels, spun by `showDir` — the server already tracks that spin).
2. Make the dispatch total: clamp/fallback to `bullet[0]` for an unknown type rather than throwing,
   so the next projectile type added can't take the client down again.

Related, no crash but wrong art: **Factory's Minion is `type: 1.5` → `parseInt` → `1`**, so it draws
as a drone triangle. diep draws a Minion as a small tank body with its own barrel. Give it its own
entry (the wire field is `uint8`, so a fractional type can never survive the trip — either widen the
codec or map to a dedicated integer draw-id at the encode site; prefer the latter).

### R8 — **[BUG] Defender's turrets fire from 33.6 units off the drawn barrel**

Server cannons carry `distance: 33.6`; the client `Defender` entry has no `distance` on its three
turret nubs. Mirror it. Then add the standing check below so this class of desync is caught.

### R9 — **[BUG] Auto 3 / Auto 5's turret ring is flattened wrong in every respect**

You described this correctly, and `Addons.ts:66-108`'s `createAutoTurrets(count)` backs up every
part of it. Ours is three or five *static* turret sockets at a hardcoded `distance: 14`. diep's is:

| diep | source | ours today |
|---|---|---|
| Mount radius is **`owner.size × 0.8`** — a **ratio**, so the base circle always pokes ~halfway out of the hull at every level | `base.positionData.x/y = owner.physicsData.size × cos/sin(angle) × ROT_OFFSET`, `ROT_OFFSET = 0.8` | flat `distance: 14`, doesn't scale with the tank |
| The turret base circle draws **under** the body — `showsAboveParent` is explicitly **XOR'd off** for ring turrets (a *centered* turret, Auto Gunner/Trapper/Smasher/Hover, keeps it **on** and draws above) | `if (base.styleData.values.flags & StyleFlags.showsAboveParent) ... ^= showsAboveParent` | drawn above, and z-order isn't modelled at all |
| The whole ring **slowly rotates**: all turrets are parented to an *invisible* `GuardObject` (`sides 1, sizeRatio 0.1`, `isVisible` XOR'd off) spinning at `AI.PASSIVE_ROTATION = 0.01` rad/ref-tick | `const rotator = this.createGuard(1, .1, 0, rotPerTick)` | static |
| Idle: each turret points **radially outward**, at `mountAngle + rotator.angle` | the wrapped `base.tick` | idle aim is whatever our autoDir search returns |
| **Clicking aims them at your mouse** — `influencedByOwnerInputs = true`, so `attemptingShot()` overrides the AI and sets `angle = atan2(mouse − turretWorldPos)` | `AutoTurret.tick`'s `useAI` branch | no owner-input coupling |
| …but only for turrets that **can** reach that way: `targetFilter` rejects a target more than **90° either side** of that turret's own mount angle (`MAX_ANGLE_RANGE = PI2/4`); rejected turrets fall back to AI | `base.ai.targetFilter` | no arc limit |
| The ring uses **`AutoTurretMiniDefinition`**, not the shared `AutoTurretDefinition` — identical geometry (`size 55, width 29.4, delay 0.01, reload 1, recoil 0.3`) but **`bullet.damage 0.4` vs `0.3`** | `Addons.ts:110`, `AutoTurret.ts:32` | converted against the shared def, so the ring's bullets are 25% weak |

Work, in increasing order of how much machinery it needs: mount ratio and the mini-definition's
damage are literals; the arc limit and mouse override are a `targetFilter` + an `attemptingShot`
branch in the existing autoDir search ([entities/Player.js:323-380](entities/Player.js#L323) already
has `can.autoDir`/`can.autoShoot`/`canDir[]`, so there is a slot for both); the ring's own slow
rotation needs a per-tank rotating frame that `canDir` can be offset by — the same machinery R4's
guards need, so **do R4 first and reuse it**. Draw order (base circle under the body, barrel over)
falls out of R4's "guards draw before the body" change.

### R10 — **[ADD] The regression test that would have caught all of this**

Extend `test/tanks.js` with assertions anchored **outside** our own tree:

1. For every diep-native class, `client.height / CONST.SIZE` **==** `diep barrel.size / 50`
   (per-boss: `/ BOSS_SIZE`), read live from
   `diepcustom/src/Const/TankDefinitions.json`. Same for `width`, and for
   `server.can.size` vs `(barrel.width/2) × bullet.sizeRatio`.
2. Every server field that positions a barrel (`offx`, `distance`, `offdir`) has an equal client
   counterpart, and vice versa — R8's bug, generalised.
3. Every `parseInt(type)` a cannon can emit has a `Drawings.bullet` entry — R7's crash, as an
   assertion.
4. `setCoord` returns finite `mX`/`mY` for every class in the roster — R5's bug, as an assertion.

Then rebaseline `test/clientDiff.js`'s golden (R1/R6 move real numbers) and document the reason at
the constant, per the standing rule.

### R11 — **[DECIDE] Shape palette: revert to yours?**

C3 replaced your muted shape palette with diep's canvas-measured hexes. This was never a bug — it
was a taste call made in a fidelity pass, and you own it.

| | yours (pre-C3) | diep's (today) |
|---|---|---|
| `sqr` | `#cfcf9f` / `#a6a689` | `#ffe869` / `#bfae4e` |
| `tri` | `#d1adb2` / `#a38a8e` | `#fc7677` / `#bd5859` |
| `pnt` | `#b2b2cc` / `#8686ab` | `#768dfc` / `#5869bd` |
| `bull` (Crasher) | `#ff9fc7` / `#d97ea3` | `#f177dd` / `#b459a5` |

**Recommendation: revert `sqr`/`tri`/`pnt` (and their `alpha*` twins) to yours.** Your palette is a
coherent muted set that reads as *your* game; diep's saturated primaries were adopted only because
they were citable, not because anything was wrong. Reverting costs nothing — it is six lines in
[public/client/config.js:87-102](public/client/config.js#L87) and a golden rebaseline. `bull` is a
closer call: the old light pink was deliberately picked to sit apart from `tri`'s rose so a Crasher
doesn't read as a bright Triangle, and diep's magenta does that job too — keep whichever you
prefer, they both work.

**Keep C3's shape *sizes* either way.** The `× √2` circumradius identity was a genuine bug fix
(triangles were drawn 26% oversized, pentagons 12.5% undersized) and is independent of colour.

---

## Execution order

Dependencies first; one behavioural cause per commit, per PENDING.md's rules.

1. **R5** — the `setCoord` NaN. One `if`, six classes go from invisible to visible, no numbers move,
   no golden shifts. Do it first; it makes everything after it observable.
2. **R7** — the Skimmer crash + a total dispatch. Second, for the same reason: you cannot inspect
   what crashes.
3. **R1** — the 0.56 → 0.70 rescale, whole roster, both halves, one commit. The file-head comment
   is part of the commit, not a follow-up.
4. **R2 + R3** — bosses on their own reference, and the six classes that did have a source after
   all (Arena Closer's flared muzzle dies here).
5. **R8** — Defender's `distance`. Trivial once R3's boss pass is open.
6. **R4** — guard addons: client `guards` data, the renderer, draw order. The first thing here that
   adds a *feature* rather than repairing a number, and it builds the rotating-child machinery R9
   then reuses.
7. **R9** — the Auto 3/5 turret ring, on top of R4's machinery: mount ratio, z-order, the rotator,
   the 90° arc filter, the click-to-aim override, the mini-definition's damage.
8. **R6** — Mothership: size literal, n-gon body (`sides`), trapezoid barrels, drone row.
9. **R10** — the regression tests, then rebaseline the golden once for the whole pass.
10. **R11** — palette, whenever you decide. Independent of everything above.

## Explicitly not in scope

- **C1 causes 2 and 3** (prediction/strafe lead). Still needs a browser session; still must not be
  blind-tuned from source. R5/R7/R8 remove the three *other* things that were being mistaken for it.
- **C4** (`CAM_SMOOTH`, `HP_BAR_HOLD`). No reference exists. Do not guess. See MEASUREMENTS.md.
- **B1's `.93` removal** — verified still correct, leave it.
- **C3's shape sizes** — a real fix, leave it (see R10).
- **K1's stand-ins** (Cyclone / Submachine / Auto Hover / Fortress) — no diep source, and that
  exclusion was correct. R1 does not touch them, which means they are the one place the roster
  legitimately stays hand-authored. Eyeball them against a rescaled Basic once R1 lands.
