# plan.md — Obstar → diep.io fidelity plan

**Goal.** Make the layer underneath Obstar a near-exact diep.io replica, then keep our custom
features bolted on top of it. This file is the diff between what this tree does today and what
diep does, split into chunks you can execute one at a time.

**Reference authority, in order.** `diepcustom/src/` (a reverse-engineered TS reimplementation of
diep's own server — this is the *code*, and it wins every disagreement) → `diepindepth/` (raw RE
notes: `physics/README.txt`, `extras/stats.md`, `canvas/`) → `physics.html` (community physics
page, 2022) → `diep_wiki/` (prose, official pages only).

> **`diep_wiki/` contains fan-made pages.** Anything under `Draft_*`, `Fanon*`, `Fannon*`,
> `Fandom_*`, `Fanob_*`, `Ernesto's bosses`, `Guerilla soldier`, `Caseoh`, `Mike Tyson`,
> `Tapeworm`, `Baritone`, `Bergenconfusung`, `Matrauth`, `Vaylio`, `Heptazoid`, `Trapangle`,
> `Penthraster`, `Pentamancer`, `Overstorm`, `Decade`, `Constellation`, `Guillotine`,
> `The spike factory tank`, `Unnamed * Upgrade *`, `Tri-Angle Upgrade 1`, `Assembler`,
> `Ambulance`, `Dropship`, `Battle Carrier`, `Sidewinder`, `Glider`, `Boomer`, `Firework(s)`,
> `Flamethrower`, `Minigun`, `Medic`, `Ball`, `Vanguard`, `Tree-Topper`, `X Hunter`,
> `Super elite`, `Nest Janitor`, `Guerilla*` and similar is **fanon — ignore completely.**
> Nothing in this plan cites one. When in doubt, if it isn't in `diepcustom`'s
> `TankDefinitions.json` / `Entity/` tree, it isn't in diep.

---

## How to read an item

| Tag | Meaning |
|---|---|
| **[BUG]** | We meant to match diep and don't. Just fix it; no decision needed. |
| **[ADD]** | diep has a feature we don't have at all. Build it. |
| **[DIFF]** | Both have it, and they differ **on purpose or plausibly on purpose**. **You decide** — the item states both sides and what the decision costs. |
| **[KEEP]** | Ours, deliberately non-diep. Listed so a later "fidelity" pass doesn't delete it. |

Every item has an ID (`D3`, `T7`, …). Items reference each other by ID; the dependency order is at
the end of the file.

## Unit conversions you need for every chunk

| Quantity | Conversion |
|---|---|
| Length | 1 diep grid square (gu) = 50 du = **28 Obstar units**; so **1 du = 0.56 units** |
| Time | diep tick = 40 ms = our `REF_TICK_MS`. Our sim steps at `TICK_MS` = 25 ms; every raw constant is per-*reference*-tick and converted at the consumption site by `lib/tick.js` |
| Bullet cruise thrust | our `speed` column = **1.12 × diep `bullet.speed`** (`20 du/tick × 0.56 × 0.1`) |
| Recoil | our `back` column = diep `recoil` (gu) **× 2.8** |
| Knockback | our `weight` column = diep Knockbackfactor (gu) **× 5.25** |
| **Damage** | our numbers are **0.692640 ×** diep's raw (`4.84848 / 7`) — **this is a defect, see D1** |
| HP | 1 : 1 with diep's raw (a fresh tank is 50 both sides) |

---

# Chunk 1 — Damage & combat model

This is the highest-leverage chunk. Everything about "it takes N bullets to kill X" lives here,
and one defect (D1) shifts every kill time in the game by ~1.44×.

### D1 — **[BUG] All damage is on a 0.6926× axis while all HP is on diep's raw axis**

`entities/Player.js:231` sets `this.damage = 3.4632035`; `public/SHARE/TanksConfig.js` sets Basic's
`can.damage = 4.84848`; `entities/Objects.js:101-109` sets Square/Triangle `damage = 5.54112`.
Every one of those is diep's own number times `4.84848/7 = 0.692640` — an "our scale" anchor
adopted when HP was *also* on a custom scale. HP has since become diep's raw scale
(`maxHp = 50`, Square 10, Triangle 30, Pentagon 100, Alpha 3000), and the damage anchor was never
retired with it.

Net effect: **everything in the game takes ~1.44× longer to kill than in diep.**

The reported symptom reproduces exactly. Basic level 0, vs a Triangle (30 HP):

| | bullet damage/diep-tick | contact | total per bullet | bullets to kill |
|---|---|---|---|---|
| diep (`Live.ts:69-89`) | 7 | 1 tick (bullet health 2, triangle `damagePerTick` 2 → dead same tick) | **7.0** | **5** |
| Obstar today | 4.84848 | ~2 real ticks (`pene` 1.7 vs 0.866/tick drain) | **5.95** | **6** |

**Fix.** Multiply the whole damage axis by `7/4.84848 = 1.44378` so it becomes diep's raw:

| site | today | diep raw |
|---|---|---|
| `entities/Player.js` `this.damage` (tank body base) | 3.4632035 | **5** (`TankBody.ts:253` `bodyDamagePoints + 5`) |
| `entities/Player.js` `BodyDam` per-point step | 0.69264 | **1** (same line — a flat +1/point, not `0.2 × base`) |
| `TanksConfig.js` every `can.damage` | `0.69264 × diep` | `(7 + 3P) × bullet.damage` at P=0 → **`7 × bullet.damage`** |
| `entities/Objects.js` shape `damage` | `2/3/5 × 4 × 0.69264` | drop the baked ×4 entirely — see D2 |
| `lib/config.js` `BASE_DRONE_DAMAGE` | 4.84848 | **7** (`BaseDrones.ts` `damage: 1`) |
| `rooms/Tag.js`/`rooms/Maze.js` Arena Closer damage | `10 × base` | recompute off the new base |

Note the tank-body step also changes *shape*: diep is `+1 per point` off a base of 5 (a 2.4× span
at 7 points), ours is `+0.2 × base` — the span is the same, so this is a rename, not a rebalance,
once the base is 5.

### D2 — **[BUG] Shapes bake `common(shape,tank)=4` into their own `damage` field**

`entities/Objects.js:98` bakes the ×4 multiplier into each shape's `this.damage`, then
`entities/Player.js`'s `KIND.OBJECTS` arm reads it un-multiplied while `entities/Bullet.js`'s
`KIND.OBJECTS` arm multiplies by `PROJECTILE_BODY_DAMAGE = 0.25` to undo it.

diep has one rule and no baking (`Live.ts:77-78`):

```
common(a,b) = max(a.minDamageMultiplier, b.minDamageMultiplier)
            × min(a.maxDamageMultiplier, b.maxDamageMultiplier)
```

with the table:

| entity | `minDamageMultiplier` | `maxDamageMultiplier` | citation |
|---|---|---|---|
| Tank body | 1 | **6** | `TankBody.ts:100` |
| Shape (all, incl. Crasher) | 1 | **4** | `AbstractShape.ts:78` |
| Bullet / Trap | **0.25** | 1 | `Bullet.ts:93-94` |
| Drone | 1 | 1 | `Drone.ts:77-78` |

**Fix.** Store diep's raw `damagePerTick` on every entity (Square 2, Triangle 2, Pentagon 3, Alpha
5, Crasher 2 — `{Square,Triangle,Pentagon,Crasher}.ts`) and let `lib/damage.js` compute `common()`
from a pair of multipliers at each site. Retire `PROJECTILE_BODY_DAMAGE` and the baked ×4 together.
This also makes D3 and D4 expressible at all.

### D3 — **[BUG] Drones use the bullet multipliers, not the drone ones**

`Drone.ts:77-78` sets `minDamageMultiplier = maxDamageMultiplier = 1`. We treat every projectile as
a bullet, so a drone currently gets `min 0.25 / max 1`. Against a shape diep gives a drone
`common = 1 × min(1,4) = 1` — same as a bullet — but against **another projectile** diep gives a
drone `common = max(1, 0.25) × 1 = 1` where a bullet-vs-bullet pair gets `0.25`. Drones punch
through projectiles 4× harder than bullets do, and we don't model that.

### D4 — **[BUG] Bullet-vs-bullet is a bespoke mechanic instead of the same rule**

`entities/Bullet.js`'s `KIND.BULLET` arm does `this.pene -= tick.perTick(option.pene)` — a
hand-rolled pene-vs-pene exchange with its own path through `rooms/Room.js`. diep has no such
special case: bullet-vs-bullet goes through the identical `handleCollision`, with
`common = max(0.25, 0.25) × min(1,1) = 0.25`, so each bullet loses `0.25 × the other's
damagePerTick` from its own health. Collapse it into the one resolver (D2).

### D5 — **[BUG] `pene` is on a third, inconsistent scale**

A bullet's health pool in diep is `(1.5 × penetrationPoints + 2) × bullet.health` (`Bullet.ts:91`),
i.e. **2** for a Basic at 0 points, on the same units as everything else's HP. Our base-drone pool
is diep's raw `2000` (`lib/config.js`), but `TanksConfig.js`'s Basic `can.pene` is **1.7** — 0.85×
diep's, from neither the damage anchor (0.6926) nor 1:1. Every `can.pene`/`necro.pene` entry needs
re-deriving as `2 × diep bullet.health`, at which point `up.BPene`'s existing flat `+0.75`/point
step is already exactly diep's `1 + 0.75P` multiplier.

### D6 — **[DIFF] Per-tick contact vs diep's once-per-pair-per-tick**

diep keeps a `damagedEntities` list per entity, cleared each tick (`Live.ts:73, 157`), so a pair
exchanges damage **exactly once per 40 ms tick**. We run at 25 ms and scale each hit by
`tick.perTick()` (× 0.625), which is *approximately* the same integral but not the same
quantisation — a bullet that dies in exactly one diep tick spends ~2 of our ticks, and the
proration on the final partial tick is a different number.

**Decision.** Either (a) accept the approximation (it is within a few percent once D1 lands), or
(b) add a per-pair "already exchanged this reference tick" guard so contact is quantised to
reference ticks the way diep quantises it to its own. (b) is more faithful and makes every
"N hits to kill" figure exactly reproducible; it costs a per-pair set per tick.

### D7 — **[DONE] `absorbtionFactor` / `pushFactor` are now modelled per entity**

diep's knockback is `receiveKnockback`: `kbMagnitude = this.absorbtionFactor × other.pushFactor`
(`Object.ts:287`). We had a single `weight` column on the *bullet* and no receiver-side term at
all. Missing receiver values, all from source:

| entity | `absorbtionFactor` | `pushFactor` |
|---|---|---|
| Tank (default) | 1 (`TankDefinitions.json`) | 8 (`diepindepth` §4.3.1) |
| Mothership | 0.01 | — |
| Dominator / Arena Closer | 0 (immovable) | — |
| Pentagon | 0.5 | 11 |
| Alpha Pentagon | 0.05 | 11 |
| Crasher (small) | 2 | 8 |
| Crasher (large) | 0.1 | 12 |
| Drone | (bullet's) | 4 |
| Bullet | `bullet.absorbtionFactor` | `((7/3) + bulletDamagePoints) × bullet.damage × bullet.absorbtionFactor` |
| Maze wall | — | 2, then `/= 0.3` |

**Implemented:** `entities/Bullet.js` bullets/traps now carry `bdPoints` (the shooter's Bullet
Damage point count at fire time, `entities/Player.js`'s `upNb[4]`); the tank's `KIND.BULLET`
collision arm derives pushFactor as `weight × 0.16 × (7/3 + bdPoints)` for `type 0`/`2` (a true
bullet or trap — the table's `weight` column was authored at `bd = 1`, where `0.16 × (7/3+1) =
0.53333`, the old flat constant, so this reproduces the table exactly at 1 point and the real 4×
span either side of it), and keeps the old flat `weight / 3 * 1.6` for anything else (a drone's
pushFactor is diep's own flat 4, not scaled by points). A Dominator's `absorbtionFactor = 0` now
also guards the bullet-knockback arm, not just the tank-body one (it was previously still shoved by
ordinary bullets). Mothership/Maze-wall rows have no entity to attach to yet (T2/A-chunk).

### D8 — **[DONE] `entities/Objects.js`'s `weight` mass-divisor replaced by real `absorbtionFactor`**

We used to move shapes as `this.x += vec.x / weight` (1 / 4 / 100), a divisor that suppressed a
shape's *own* idle drift as well as its knockback response — diep only does the latter. **Decision
(user-selected):** adopt diep's real `absorbtionFactor` for the four diep-native shapes — Pentagon
0.5, Alpha Pentagon 0.05, Crasher small 2 / large 0.1 (previously undifferentiated), Square/Triangle
default 1 — applied only at each `collision()` impulse site (`entities/Objects.js`'s new
`this.absorb` field), while idle drift/orbit is now maxspeed-only, matching diep's own split.
`Bsqr`/`Btri` (no diep counterpart, [KEEP]) were left on the old `weight` divisor exactly as before.

### D9 — **[OK, do not re-fix]** `LETHAL_EPS` (0.0001) at every hp/pene subtraction, and the shared
proration factor in `rooms/Room.js`, are both diep's own (`Live.ts:83-85`, `:94`, `:110`). Do not
"simplify" a `<= LETHAL_EPS` back to `<= 0` — proration deliberately lands a killing blow on the
target's exact remaining HP, and float error then leaves it alive at ~1e-16 forever.

---

# Chunk 2 — Progression & economy

### P1 — **[BUG] The XP curve is nothing like diep's**

diep (`Const/Enums.ts:301-304`):
`levelToScore[i] = levelToScore[i-1] + (40/9 × 1.06^(i-1) × min(31, i))`

Ours (`rooms/Room.js:289`): a power curve `((i+1)/a)^1.8` normalised so level 45 lands on
`rules.maxXp` (25000).

| level | diep XP | ours | ratio |
|---|---|---|---|
| 2 | **4** | 92 | 23× |
| 5 | 50 | 478 | 9.6× |
| 10 | 275 | 1667 | 6.1× |
| 15 | 788 | 3460 | 4.4× |
| 20 | 1758 | 5807 | 3.3× |
| 30 | 6185 | 12049 | 1.9× |
| 45 | **23537** | 25000 | 1.06× |

The *totals* nearly agree; the *shape* does not. In diep one Square (10 XP) takes you past level 2
and most of the way to 3; here it takes nine. Early game is ~10–20× slower than diep's and the
curve then catches up, which is why levelling reads as a grind at the bottom and a rush at the top.

**Fix.** Adopt diep's table verbatim, per-mode-scaled by `rules.maxXp / 23537` if a mode wants a
different ceiling (`rules.xpMul` already exists for Tag ×3 / Domination ×2 and is a separate knob).

### P2 — **[OK]** 45 levels, 7 points/stat, 33 points over a life, class tier every 15 levels,
grant schedule `level−1` to 28 then `⌊L/3⌋+18` — all confirmed identical (`Camera.ts:168-173`,
`config.ts:113`). `entities/Player.js`'s `pointsAtLevel()` is the one source of truth.

### P3 — **[ADD] Smasher's stat set is different and we can't express it**

diep gives each tank its own `stats[]` array with per-stat `max` (`TankDefinitions.json`). Every
ordinary tank is 8 stats × max 7; the Smasher line is not (it has no bullet stats and a raised Body
Damage cap — `diep_wiki/Levels.txt`'s "10 Smasher"). We hardcode 8 stats × 7 everywhere
(`entities/Player.js`'s `MAX_PER_STAT`, `public/client/config.js`'s `CONST.MAX_PER_STAT`, the
client's 8 upgrade buttons). Needed before T2's Smasher branch can exist.

### P4 — **[ADD] Per-tank stat *names* are not modelled**

Overseer/Overlord/Manager/Necromancer/Factory/Mothership relabel three stats to
`Drone Damage / Drone Health / Drone Speed`, and Necromancer's Reload slot becomes `Drone Count`
(`TankDefinitions.json`). We show the same 8 labels for every class.

### P5 — **[DIFF] `respawnPow`, `prize`, coins**

`entities/Player.js`'s `prize` (the XP another player wins for killing you) uses a bespoke
`pow(xp/mlx, 1.8)` curve, and `rules.respawnPow` (0.9) decides how much XP you keep through a
death. diep gives the killer the victim's `scoreReward` and respawns you at
`respawnLevel` (`Camera.ts`). Coins are entirely ours. Decide per-mode; nothing here is a bug.

---

# Chunk 3 — Tanks: roster & upgrade tree

### T1 — **[BUG] Our upgrade tree is not diep's**

diep's tree, from `TankDefinitions.json`'s own `upgrades` arrays (authoritative):

| from | at level | to |
|---|---|---|
| Tank | 15 | Twin, Sniper, Machine Gun, Flank Guard, **Smasher** |
| Twin | 30 | Triple Shot, Quad Tank, Twin Flank |
| Sniper | 30 | Assassin, Overseer, **Hunter**, Trapper |
| Machine Gun | 30 | Destroyer, Gunner, **Sprayer** |
| Flank Guard | 30 | Tri-Angle, Quad Tank, Twin Flank, **Auto 3** |
| Smasher | 30 | **Landmine, Auto Smasher, Spike** |
| Triple Shot | 45 | Triplet, Penta Shot, **Spread Shot** |
| Quad Tank | 45 | Octo Tank, **Auto 5** |
| Tri-Angle | 45 | Booster, Fighter |
| Destroyer | 45 | Hybrid, Annihilator, **Skimmer**, **Rocketeer** |
| Overseer | 45 | Overlord, Necromancer, Manager, Overtrapper, Battleship, **Factory** |
| Twin Flank | 45 | Triple Twin, Battleship |
| Assassin | 45 | Ranger, **Stalker** |
| Hunter | 45 | **Predator**, **Streamliner** |
| Gunner | 45 | Auto Gunner, **Gunner Trapper**, **Streamliner** |
| Trapper | 45 | **Tri-Trapper**, **Gunner Trapper**, Overtrapper, Mega Trapper, Auto Trapper |
| Auto 3 | 45 | **Auto 5**, Auto Gunner |

Ours (`TanksConfig.js`'s `exports.tree`) differs structurally, not just in contents:
`Sprayer` hangs off Gunner *and* Assassin, `Rocket` off Flank Guard, `Triple Shot` off both Twin
and Flank Guard, `Cyclone`/`Submachine`/`Fortress`/`Auto Hover` are ours, and `Auto Gunner` hangs
off Gunner only. **Decide** per branch which of ours to keep (see K1) — but the diep-native edges
above should all exist.

### T2 — **[ADD] 16 real diep tanks are missing**

| tank | tier | notes |
|---|---|---|
| **Smasher** | 30 | `postAddon: smasher`, body-only. Needs P3 (stat set) + T6 (addons). |
| **Landmine** | 45 | `postAddon: landmine` + invisibility-on-idle |
| **Auto Smasher** | 45 | `postAddon: autosmasher` (smasher ring + auto turret) |
| **Spike** | 45 | `postAddon: spike`, `bodyDamage: +2` |
| **Hunter** | 30 | two barrels, `delay` staggered, `fieldFactor 0.85` |
| **Predator** | 45 | 3 stacked barrels + zoom ability (`flags.zoomAbility`) |
| **Streamliner** | 45 | 5 stacked barrels, `fieldFactor 0.85` |
| **Stalker** | 45 | `flags.invisibility`, `fieldFactor 0.8` |
| **Auto 3** | 30 | `postAddon: auto3` |
| **Auto 5** | 45 | `postAddon: auto5` |
| **Spread Shot** | 45 | 7 barrels fanned |
| **Gunner Trapper** | 45 | |
| **Tri-Trapper** | 45 | |
| **Skimmer** | 45 | `preAddon: launcher`, `bullet.type: "skimmer"` (spawns sub-barrels) |
| **Factory** | 45 | `sides: 4`, `bullet.type: "minion"` (spawns controllable minions) |
| **Mothership** | — | gamemode entity, `sides: 16`, `absorbtionFactor 0.01` |

`Rocketeer` exists in diep and we have `Rocket` — check whether ours is meant to be it (T4).

### T3 — **[ADD] Tank *flags* are not modelled**

`TankDefinitions.json` `flags`: `invisibility` (Landmine, Stalker), `zoomAbility` (Predator,
Hunter-line), `canClaimSquares` (Necromancer), `devOnly`. Plus the three visibility rates
(`visibilityRateShooting 0.23`, `visibilityRateMoving 0.08`, `invisibilityRate 0.03`) which are
diep's actual stealth model. We have a single per-class `alpha` decay and hardcoded ×10/×30 bumps
in `entities/Player.js`. **Adopt diep's three rates** — they are exactly the three events our code
already handles (shoot / move / idle) with real numbers behind them.

### T4 — **[DIFF] Per-tank fields we don't have at all**

`TankDefinitions.json` carries these per tank; `TanksConfig.js` carries none of them:

| field | what it does | who is non-default |
|---|---|---|
| `fieldFactor` | FOV multiplier (lower = sees further) | Sniper/Overseer/Overlord/Necro/Manager/Trapper-line/Battleship/Smasher-line/Skimmer/Rocketeer/Factory **0.9**; Hunter/Predator/Streamliner **0.85**; Assassin/Stalker **0.8**; Ranger **0.7** |
| `absorbtionFactor` | knockback taken (D7) | Mothership 0.01, Arena Closer/Dominator 0 |
| `maxHealth` | base HP | Dominator 6000; everything else 50 |
| `bodyDamage` | flat body-damage bonus | Spike +2 |
| `sides` | body polygon | Necromancer 4, Factory 4, Mothership 16 |
| `borderWidth` | drawn outline | 15 default |
| `speed` | movement multiplier | 1 for every tank in `diepcustom` |

We do have a per-class `screen` (Basic 1408, Sniper 1664, Ranger 2208), which is `fieldFactor`
inverted. Converting it to `base / fieldFactor` would put every class on diep's own value; decide
whether to keep our hand-tuned numbers for the classes diep doesn't have (K1).

### T5 — **[DIFF] Barrel definition fields**

| diep (`BarrelDefinition`) | ours (`TanksConfig.js` server) | status |
|---|---|---|
| `angle` | `offdir` | ✅ |
| `offset` | `offx` | ✅ |
| `size` (length, du) | `canonLength` (drawn units) | ⚠️ different scale, see B1 |
| `width` | client `width` only | ⚠️ server has no width; bullet radius derives from it in diep |
| `delay` (fraction of reload) | `offTime` | ✅ |
| `reload` (multiplier on 15) | `reload` (absolute ref ticks) | ✅ equivalent |
| `recoil` | `back` (`× 2.8`) | ✅ |
| `isTrapezoid` / `trapezoidDirection` | — | **[ADD]** drawn barrel shape |
| `addon` (barrel addon) | — | **[ADD]** see T6 |
| `distance` | — | **[ADD]** barrel pushed out from the hull (Auto turret bases, Skimmer launchers) |
| `droneCount` | class-level `maxDrone` | ⚠️ diep is per-*barrel* |
| `forceFire` | `auto` | ✅ |
| `canControlDrones` | class-level `necro`/type 1.1 | ⚠️ per-barrel in diep |
| `bullet.{type,sizeRatio,health,damage,speed,scatterRate,lifeLength,absorbtionFactor}` | `type/size/pene/damage/speed/rand/life/—` | mostly ✅, `sizeRatio` and `absorbtionFactor` missing |

### T6 — **[ADD] Addons (`preAddon` / `postAddon` / barrel `addon`) don't exist**

`Entity/Tank/Addons.ts` and `BarrelAddons.ts` define: `autoturret`, `auto3`, `auto5`, `smasher`,
`autosmasher`, `landmine`, `spike`, `pronounced`, `dombase`, `dompronounced`, `launcher`,
`weaponrack`, `megasmasher`, `spiesk`, `bumper`. We hand-model auto turrets as extra cannons with
`autoDir`/`autoShoot`, which works but doesn't compose — an addon can be attached to any tank, and
`Auto Smasher` needs a smasher ring *and* a turret. An addon system is the prerequisite for six of
T2's tanks.

---

# Chunk 4 — Projectiles

### B1 — **[BUG] Bullets spawn 7% short of the barrel tip**

`entities/Player.js:359` — `const len = can.canonLength * .93 * ra`. diep spawns at the barrel's
**full** length: `x + cos(angle) × barrel.size + …` where `barrel.size = definition.size ×
scaleFactor` (`Bullet.ts:100`). The `.93` puts a Basic's bullet 3.8 units inside its own drawn
muzzle at level 0 and scales with level. **Remove the `.93`.**

Related, same site: `ra = this.size / 35` uses a magic 35 (the *drawn* reference tank radius) where
diep's `scaleFactor = size / 50 du = size / 28 units`. The two agree today only because
`canonLength` is denominated against 35. Either is fine, but write down which.

### B2 — **[BUG] Bullet radius is not derived from the barrel**

diep: `bullet radius = (barrel.width / 2) × bullet.sizeRatio` (`Bullet.ts:77`). Basic → 21 du =
11.76 units. Ours: a free-standing `can.size` (Basic 18) × `ra` ≈ 14.4 units, **22% larger**. Fix
alongside the barrel-width/silhouette work (C2) — converting bullet size alone desyncs it from the
barrel it leaves.

### B3 — **[ADD] Projectile types we don't implement**

`Entity/Tank/Projectile/` has: `Bullet`, `Drone`, `Trap`, `Skimmer`, `Rocket`, `Minion`,
`NecromancerSquare`, `Swarm`, `Flame`, `CrocSkimmer`. We have bullet (0), drone (1/1.1),
battleship-drone (1.2/1.3), base drone (1.4), trap (2), necro square (3), "bigCheese" (3.1).
Missing: **Skimmer** (spawns its own orbiting sub-barrels), **Minion** (Factory's controllable
sub-tank), **Flame**, **CrocSkimmer**. `Rocket` — check whether our type-0 `Rocket` class matches
diep's `Rocket` projectile (it has its own inline `RocketBarrelDefinition` exhaust barrel).

### B4 — **[BUG] Drone `lifeLength` sentinel and resting behaviour**

- `Drone.ts:61-65`: a drone's life is `88 × lifeLength`, or `Infinity` when `lifeLength === -1`. ✅ we match.
- `Drone.ts:36`: `MAX_RESTING_RADIUS = 400²` — a drone within 400 du (224 units) of its owner
  enters a *resting* orbit. Ours uses `play.size * 3.5` (≈98 units at level 0) — 2.3× tighter, and
  scaled off tank size where diep's is absolute.
- `Drone.ts:52`: `ai.targetFilter` restricts a drone's target to within **900 du (504 units) of the
  owner tank**, not of the drone. Ours checks `playdis < play.screen / 4` — a screen-relative
  distance, not diep's absolute one.
- `Drone.ts:70`: `physicsData.pushFactor = 4` (D7).

### B5 — **[OK]** Trap arming window (`life >> 3` ticks), trap `baseAccel = 0` (coast only), trap
`lifeLength = 75 × bullet.lifeLength`, and the three muzzle-kick formulas (bullet
`accel + 30 − jitter`; drone `÷3`; trap `accel/2 + 30 − jitter`) all match `Trap.ts` / `Drone.ts` /
`Bullet.ts:89`. Do not re-derive.

### B6 — **[DIFF] `push` (self-bounce) is ours**

`TanksConfig.js`'s `push` column has no diep counterpart — diep's only separation force is
`receiveKnockback` (D7). It is load-bearing for base drones (keeps a swarm from stacking). When D7
lands, decide whether `push` collapses into `pushFactor` or stays.

---

# Chunk 5 — Shapes & Crashers

### S1 — **[BUG] Crashers do not chase. This is the big one.**

diep (`Entity/Shape/Crasher.ts`):

| | diep | Obstar (`entities/Objects.js`, type `'bull'`) |
|---|---|---|
| detection | `ai.viewRange = 2000 du` = **1120 units** | `Detector(…, 500, [KIND.PLAYER])` = **500 units** |
| target re-scan | every `tps` (25) ticks | on detector reset |
| chase speed | `velocity.add(movement × targettingSpeed)` each tick, `targettingSpeed` = **2.602 du/tick** small / **2.64** large → terminal **10 × 2.602 × 0.56 = 14.57 units/ref-tick ≈ 364 u/s** (a Basic tank's own top speed) | `HOME_PULL = 0.543` added per tick, then `vec.limit(maxspeed/2)` = **0.56 units/ref-tick ≈ 14 u/s** |
| facing | `positionData.angle = atan2(target − self)` while chasing; idle spin otherwise | client derives facing from movement delta |
| idle | ordinary shape drift (`BASE_VELOCITY 1 du/tick`) | ✅ matches |
| walls | `PositionFlags.canMoveThroughWalls` | ✅ matches (by omission) |
| large chance | **0.2** | 0.15 |
| knockback | small `absorb 2 / push 8`, large `absorb 0.1 / push 12` | not modelled (D7) |

**Our crashers are ~26× too slow when chasing and see less than half as far.** A diep Crasher is a
genuine threat that runs a level-1 tank down; ours drifts. Fix: give the Crasher a real target-chase
state that adds `targettingSpeed` to velocity per tick and lets the normal `BODY_FRICTION`
recurrence produce the 10× terminal, exactly like the tank integrator does.

### S2 — **[DONE] Shape spawn zones are a diep/ours hybrid now**

diep (`Misc/ShapeManager.ts:51-99`) decides a shape's **type from where it landed**, on one uniform
random position over the whole arena:

| zone (half-arena `R` = 11150 du = 6244 units) | contents |
|---|---|
| `max(\|x\|,\|y\|) < R/10` (inner square, 624 units) | **Pentagon Nest** — Pentagon, 5% Alpha |
| `R/10 ≤ max(\|x\|,\|y\|) < R/5` (624–1249 units) | **Crasher Zone** — Crasher, 20% large |
| everything else | **Fields** — 4% Pentagon, 16% Triangle, 80% Square |

Ours (`rooms/Room.js`'s `createObj()` + `entities/Objects.js`'s constructor):
- Squares cluster at `(+W/4, +H/4)` r=490, Triangles at `(−W/4, −H/4)` r=490, Pentagons at `(0,0)` r=630 — **three separate nests**, and every type also spawns scattered.
- Crashers spawn in a **650–700 unit annulus** — the right ballpark, but a thin ring where diep's zone is 624–1249 wide.
- Type counts come from fixed per-type caps (`shapeMix`), not from where the point landed.

Interestingly our arena (`gu(451)` = 12628 units) is within 1% of diep's (22300 du = 12488 units),
so diep's zone radii drop straight in.

**Implemented (user-selected hybrid):** the Pentagon Nest radius (`createObj()`'s existing `630 *
nestScale`) already landed within 1% of diep's own `R/10`, so it was left as-is; the Crasher Zone
(`entities/Objects.js`'s `'bull'` case) is now diep's real `R/10..R/5` annulus (`630..1249 *
nestScale`, area-uniform sampling), replacing the old fixed 650–700 unit ring. The Square/Triangle
corner nests are **kept** exactly as before — the user explicitly wants that identity preserved as
an additional layer alongside diep's own zones, not replaced by diep's flat Fields mix. See PENDING
for the two departures this leaves on record (nests kept on purpose; circular zones instead of
diep's square `max(|x|,|y|)` ones, for consistency with every other nest/carve-out in the tree).

### S3 — **[OK]** Shape HP/XP/radius/`damagePerTick`/Shiny all confirmed exact against
`{Square,Triangle,Pentagon,Crasher}.ts`. Radii are `du × 0.56` (Square/Triangle 21.78, Pentagon
29.70, Alpha 79.20, Crasher small 13.86 / large 21.78). Shiny `1/1_000_000`, ×10 HP, ×100 XP.
`BASE_ORBIT 0.005` (halved for Pentagon/Alpha) and `BASE_VELOCITY 1 du/tick` (also halved) are live.

### S4 — **[ADD] `BASE_ROTATION` (the shape's own spin) is server-side in diep, client-side here**

`AbstractShape.ts:41,120` spins each shape by `±0.01 rad/tick` on the server and sends the angle.
Our `Objects` wire record carries no facing angle at all (`SocketSchema.js`: `states/shape/hp/alpha`),
so `public/client/entities.js` does a per-client cosmetic wobble in *frame* units. To match, the
wire record needs an angle field. Low priority except that it blocks S1's crasher facing being
server-authoritative.

### S5 — **[DONE] Shape wall-avoidance turning**

`AbstractShape.ts:104-124`: within 400–500 du of an arena edge a shape `turnTo()`s away, with a
`TURN_TIMEOUT` of 300 ticks and a 10× orbit-rate boost while turning. Ours hard-clamps position and
zeroes the velocity component — shapes pile up on the edges instead of turning away from them.

**Implemented:** `entities/Objects.js`'s idle-drift branch now runs diep's own four-way edge check
(inner ring at 224 units turns straight away from the arena centre; the four 280-unit side bands
turn to run along that side instead) before falling back to ordinary wander, with the same 10×
rate boost on the tick a turn starts and the same 300-reference-tick hold. The old hard
position-clamp/zero-velocity code at the bottom of `update()` is kept as a last-resort safety net
(covers a chasing Crasher, which bypasses this idle branch entirely) rather than removed - see
PENDING for the one simplification this took versus diep's literal mechanic.

### S6 — **[KEEP]** `Bsqr` / `Btri` (boss square / boss triangle) have no diep counterpart. `Bpnt`
is diep's Alpha Pentagon and *is* diep-derived. Keep the first two; don't let a fidelity pass
delete them.

### S7 — **[DONE] Respawn cadence**

diep refills any dead shape slot on the very next tick to a flat `wantedShapes = 1000`
(`ShapeManager.ts:112-118`). We run `generate()` every 400 ms with per-type caps and probabilistic
gates (`Math.random() < 0.26`). Ours trickles; diep's is instant. Farming feel differs noticeably.

**Implemented (user-selected partial adoption):** every ordinary-shape population gate in
`rooms/Room.js`'s `generate()` (the per-type "does this type get checked this pass" roll and the
nest-cluster-slot roll on top of it) now runs through `towardInstant(p) = p + 0.85 × (1 - p)`,
closing 85% of the gap to diep's instant refill rather than all of it - the 400 ms `generate()`
cadence itself is kept as our own engine-cost knob, not diep's true per-tick check. The rarity/
special-spawn gates (`betaPentRng`, the Bsqr/Btri 0.992 checks, `bossRng`) are untouched - they are
a different axis (how much of a type exists) from the cadence question this item is about. See
PENDING for why 85% and not 100%.

---

# Chunk 6 — Arena & spawning

### A1 — **[DIFF] Arena size**

diep: `22300 × 22300 du` = 12488 × 12488 units, fixed, for FFA/Team2/Team4/Domination; only
Sandbox/Survival/Tag resize (`Arena.ts:87`, `Team2.ts:28`, `Team4.ts:29`, `Sandbox.ts:29`).
Ours: ffa/maze `gu(451)` = 12628 (**within 1.1% of diep — effectively identical**), 2team
`gu(450)`, 4team `gu(400)`. The earlier concern that diep's `AL = ⌊√N × 50⌋` would shrink us by 71%
came from applying Sandbox's population formula to a fixed-size mode; the fixed modes are diep's
22300 and we already match it. **Nothing to do beyond confirming 4team's `gu(400)` is intentional.**

### A2 — **[OK]** Shape density: 1 per 200 gu² (22300 du arena ÷ 1000 shapes = 199 gu²), live in
`rooms/Room.js`'s `SHAPE_DENSITY_GU2`.

### A3 — **[ADD] `ARENA_PADDING = 200 du`** (`Arena.ts:85`) = 112 units. Ours is
`config.OOB_MARGIN = gu(4)` = 112 units. ✅ identical — no action, recorded so it isn't "fixed".

### A4 — **[ADD] Arena state machine**

`Arena.ts`: `COUNTDOWN → OPEN → CLOSING → CLOSED → OVER`, with `countdownDuration = 10 s`,
`playersNeeded`, `ticksUntilStart` on the wire. We have no countdown/closing state at all — Tag and
Maze hand-roll their own "closing" with Arena Closers. Adding the real state machine would let both
reuse one mechanism (M3).

### A5 — **[DIFF] Spawn location choice**

`Arena.findSpawnLocation()`: uniform random over the arena, retried up to **20 times** against
`isValidSpawnLocation` (which rejects near other tanks). Ours is `rejectSample()` against nest
keep-out circles with a 128-try cap. Different intent — diep keeps you away from *players*, we keep
you away from *nests*. Consider doing both.

---

# Chunk 7 — Physics & movement

### M1 — **[OK, do not re-derive]** Tank `FRICTION = 10/11` (per 40 ms), universal
`BODY_FRICTION = 0.9`, `moveAccel = A₀ × 1.07^points / 1.015^level`. The two frictions differ only
because we apply drag *before* the position step and diep applies it after; both reach the same
`10 × A` steady state. Do not merge them.

### M2 — **[DIFF] `A₀` is 1.47% high**

`physics.html` gives `A₀ = 2.58825 du/loop²`; `diepcustom`'s `TankBody.ts:271` gives **`2.55`** with
a `1.015^(L−1)` level term. `2.55 × 1.015 = 2.58825` — the same formula quoted one level apart. Our
`this.level` is 0-based, i.e. already diep's `L−1` form, so the coefficient we actually want is
`2.55 × 0.56 = 1.428`, not `1.449`. Base top speed `362.25 → 357.0 u/s`. One literal in
`public/SHARE/Physics.js`. Left as a decision because `physics.html` was chosen deliberately.

### M3 — **[OK]** `size = 28 × 1.01^level`, `FOV_PER_LEVEL = 1.005` (= `√1.01`), tank body radius
50 du. Confirmed.

### M4 — **[DIFF] Semi-implicit Euler drag error at 25 ms**

`Physics.stepBody`'s steady state is 362.25 u/s at the 40 ms reference but **368.9 u/s** at our
live 25 ms step (+1.8%). Every impulse column (`back`, `weight`) reads ~1.8% high in-game for the
same reason. Fixing it properly means an exponential integrator, which redefines every
per-reference-tick constant in the tree. Probably not worth 1.8% — recorded so nobody chases it.

### M5 — **[ADD] Velocity floor**

`Object.ts:275`: `if (velocity.magnitude < 0.01) velocity.magnitude = 0`, and a deleting entity
halves its speed each tick (`:277`). We have neither; our entities coast asymptotically forever.
Cheap to add, and it removes a class of "sliding at 1e-9" float noise.

### M6 — **[OK]** Wall contact: bullet destroyed outright, tank keeps `0.3 ×` speed and gets an
axis-aligned push of `absorb × pushFactor / 0.3` (`Object.ts:295-326`). Matches.

---

# Chunk 8 — Bosses & scripted entities

### X1 — **[ADD] Four of diep's five bosses are missing**

`Misc/BossManager.ts`: `[Guardian, Summoner, FallenOverlord, FallenBooster, Defender]`, one picked
at random every `45 × 60 × tps` ticks (**45 minutes**), spawned inside the middle half of the arena,
at most one alive. We ship **Summoner** only, on a per-mode `bossRng`/`maxBoss` roll.

Missing: **Guardian** (`Boss/Guardian.ts`), **Defender** (`Boss/Defender.ts`, has
`Misc/Boss/FallenSpike` style addons), **Fallen Overlord**, **Fallen Booster** — plus the
`Misc/Boss/` variants `FallenAC`, `FallenMegaTrapper`, `FallenSpike`.

Also missing: the 45-minute global spawn timer and the one-boss-at-a-time invariant.

### X2 — **[DIFF] Boss body is a hardcoded circle**

`rooms/Room.js`'s `createBoss()` hardcodes `size: 64` for every boss. diep's `AbstractBoss` sizes
each boss from its own definition. Blocks X1 — you can't add four bosses with one hardcoded radius.

### X3 — **[DIFF] Boss aggro model is entirely ours**

`lib/gameAI.js`'s Summoner uses `dis / max(1, level) < screen / 30` with a 0.5625 y-squash — no
diep counterpart (diep bosses use the shared `AI` class with a plain `viewRange`). Worth replacing
with `AI`-style targeting when X1 lands.

### X4 — **[OK]** Arena Closer size 98 units (`BASE_SIZE 175 du × 0.56`), Dominator 89.6
(`SIZE 160 du`), both circles (`sides: 1`), Dominator `maxHealth 6000`, four per Domination map,
neutral→captor with a two-knockdown rule for an enemy-held one, HP refill + own-bullet despawn on
capture. All confirmed against `ArenaCloser.ts` / `Dominator.ts`.

### X5 — **[DIFF] Arena Closer / Dominator borrow the boss scaffolding**

Both are `Player` instances with `motion`/`update` rebound at spawn. They deserve their own classes;
this is a restructuring decision, unscoped. Also open: the `H`-key Dominator piloting mechanic
(designed, not built — see PENDING).

### X6 — **[ADD] `Dominator` FOV** — our three variants' `screen`/`DETEC.maxDis` are stand-ins
(Sniper's/Assassin's/Ranger's screen). diep gives Dominators `fieldFactor 1`.

---

# Chunk 9 — Game modes

### G1 — **[DIFF] Mode roster**

| diep (`src/Gamemodes/`) | we have |
|---|---|
| FFA | ✅ |
| Team2 | ✅ |
| Team4 | ✅ |
| Domination | ✅ |
| Maze | ✅ |
| Tag | ✅ |
| Sandbox | ✅ |
| **Mothership** | ❌ — needs the Mothership entity (T2) |
| **Survival** | ❌ — shrinking arena + no respawn |
| Misc (`Ball`, `Jungle`, `Spikebox`, `DomTest`, `FactoryTest`, `Testing`) | ❌ — diepcustom's own test modes, not real diep |

Breakout and Capture the Flag are in `diep_wiki` but not in `diepcustom` — treat as
lower-confidence, and both are bigger than Maze + Domination combined.

### G2 — **[OK]** Maze wall generation is a verbatim port of `Misc/MazeGenerator.ts` (seed count 45
± 30, turn/branch/termination 0.2 each, flood-fill for unreachable pockets, merge into rectangles).
`GRID_SIZE = 35` is derived from *our* arena rather than diep's hardcoded 40, correctly.

### G3 — **[OK]** Tag XP ×3, Domination XP ×2, Tag arena shrink to a floor, no bosses in Maze — all
confirmed (`Tag.ts:39-59`, `Domination.ts:43`, `Maze.ts:71`).

### G4 — **[ADD] Team base mechanics**

`Misc/TeamBase.ts` + `Misc/BaseDrones.ts`. Confirmed matching: `BASE_DRONE_HP 2000`
(`(1.5×0+2) × 1000`), `BASE_DRONE_DAMAGE` ≡ a Basic bullet's own damage, 12 drones per spawner,
chase speed 54 du/tick = 756 u/s, `ai.viewRange 900 du` = 504 units. **What is entirely ours:** the
five-level energy-ring orbit system, the binomial level sorter, the C² diameter-cross "swoosh",
the leash, the per-centre scout. diep's base drones just orbit and chase. **[KEEP]** — this is one
of our better custom features, but know that none of it is diep.

---

# Chunk 10 — Client & rendering

### C1 — **[BUG] Bullets appear to leave beside the barrel, not from it** *(the reported bug)*

Three separate causes, all live:
1. **B1** — the server spawns at 93% of barrel length.
2. `public/client/entities.js`'s two-phase muzzle weld — a fresh own-bullet is welded to the drawn
   muzzle for one packet interval, then hands off to `predic`. The ramp (`BULLET_LEAD_DECAY`) exists
   and is tested, but was tuned against a since-changed prediction path.
3. **Strafing.** The local tank is drawn at `server position + predic`, where `predic` points along
   your *movement*; the bullet's lead is temporal (along its own velocity). Strafing perpendicular
   to aim makes the error entirely sideways, which is exactly "the bullet came out of empty space
   next to me". The structural fix is arras.io's: set **one** lag-compensation clock per frame and
   run *every* entity, local tank included, through the same predict — instead of putting the local
   tank in its own reference frame.

Do (1) first; it's one character. Then re-judge (2)/(3) in a browser.

### C2 — **[DIFF] Barrel/bullet silhouette scale**

Our barrel lengths are drawn against a reference tank radius of 35 (`CONST.SIZE`) where diep's are
against 50 du. The *ratios* happen to agree for Basic (68/35 = 1.94 vs 95/50 = 1.90), but every
class was hand-drawn on our scale, so converting one number (bullet radius, B2) desyncs it from the
barrel. This is one deliberate pass: convert `canonLength`/`width`/`can.size` for the whole roster
to `diep du × 0.56` at once, or convert none of them.

Known casualty of not doing it: the **Summoner**'s drawn barrel (`height: 44`) is *shorter* than its
own spawn radius (`canonLength 50 × 0.93 = 46.5`), the only class in the roster that runs that way —
its drones visibly spawn past the muzzle. Fixing it means growing a boss's silhouette.

### C3 — **[ADD] Render features from `diepindepth/canvas/`**

`render_order.txt`, `scaling.md`, `shape_sizes.md` and `color_constants.md` document diep's actual
draw order, the `0.55 × zoom` scaling law, per-shape drawn sizes, and the exact palette. We have not
cross-checked any of it. Cheap wins for "it looks like diep": exact colours (`extras/colors.js`),
health-bar geometry, damage-flash timing (`StyleFlags.hasBeenDamaged`).

### C4 — **[DIFF] Camera lag & HP-bar hold**

`CONST.CAM_SMOOTH` and `CONST.HP_BAR_HOLD` are the only two quantities in the tree with no
reference at all — `diepcustom` is server-only and `diepindepth/canvas` doesn't cover either. They
need a session with diep.io actually open. Protocols are in MEASUREMENTS.md.

### C5 — **[ADD] Wire fields diep has that we don't**

From `diepindepth/protocol/`: entity `angle` for shapes (S4), `nameData` flags, `StyleFlags`
(`isFlashing`, `hasBeenDamaged`, `isStar`, `isTrapezoid`), `HealthFlags.hiddenHealthbar`,
`ArenaFlags`/`ticksUntilStart` (A4), scoreboard entries. Each is a small `SocketSchema.js` addition
that unblocks a visual behaviour above.

---

# Chunk 11 — Ours, on purpose

**[KEEP] — do not let a fidelity pass remove these.**

### K1 — Custom tanks
`Cyclone`, `Submachine`, `Auto Hover`, `Fortress` — no diep counterpart. Their reload / knockback /
speed / life columns are all nearest-relative stand-ins (Cyclone ← Octo Tank, Submachine ← Machine
Gun, Auto Hover's manual barrels ← Tri-Angle, Fortress ← Tri-Trapper + Battleship, every auto-turret
slot ← `AutoTurret.ts`'s shared definition). Keep them; keep the stand-in markers.

### K2 — Custom shapes
`Bsqr`, `Btri` (boss square / boss triangle).

### K3 — Custom systems
Bots (`lib/gameAI.js` — diep has none), pets (`PetsConfig.js`), coins/shop, accounts &
achievements, the dev console, rarity tiers beyond Shiny (`ObjectsConfig.js`), the five-level base
drone orbit AI (G4), tank-vs-tank positional overlap resolution.

### K4 — Engine choices
`TICK_MS` 25 vs `REF_TICK_MS` 40 (we sample finer than diep and denominate against diep's loop);
FOV that scales to fit the viewport instead of diep's resolution-dependent fixed px/du (ours is the
fairer design).

### K5 — Square/Triangle corner nests (plan.md S2)
diep decides a shape's type purely from where a uniformly-random point landed (S2's table); it has
no concept of "Squares live NE, Triangles live SW". We do, and it's staying **on top of** diep's own
Pentagon Nest/Crasher Zone radii rather than being replaced by diep's flat Fields mix - a deliberate
user call, made when S2 landed, to keep a real gameplay feature nobody asked to lose.

### K6 — Respawn cadence stays partial, not instant (plan.md S7)
diep's shape population is effectively instant (dead slot refilled the very next tick). We close
85% of the gap (`RESPAWN_CATCHUP` in `rooms/Room.js`) rather than all of it - a deliberate user call
made when S7 landed, keeping some of the "farming visibly thins a patch out" feel rather than
diep's "never looks empty".

---

# Suggested execution order

Dependencies first; each line is a self-contained pass with its own test/golden rebaseline.

1. ✅ **D1 + D2** — put damage on diep's raw axis and replace the baked ×4 with a real `common()`
   table. Everything downstream is measured against this, so it goes first. Expect every
   time-to-kill and every `clientDiff` golden to move.
2. ✅ **D5** — re-derive the `pene` column as `2 × diep bullet.health`.
3. ✅ **B1** — delete the `.93`. One character, immediately visible.
4. ✅ **P1** — adopt diep's XP table.
5. ✅ **S1** — give Crashers a real chase. Self-contained, high visible impact.
6. ✅ **D3 + D4 + D6** — finish the damage model (drone multipliers, bullet-vs-bullet, contact
   quantisation).
7. ✅ **D7 (+ D8, B6)** — `absorbtionFactor`/`pushFactor` as a real receiver-side term.
8. **T5 + T6** — barrel-definition parity, then the addon system. Unblocks the roster.
9. **P3 + P4 + T3 + T4** — per-tank stat sets, stat names, flags, `fieldFactor`.
10. **T1 + T2** — the real upgrade tree and the 16 missing tanks (Smasher line first — it exercises
    the most new machinery).
11. ✅ **S2 / S5 / S7** — shape zoning, edge turning, respawn cadence.
12. **B3** — Skimmer / Minion / Flame / CrocSkimmer projectiles.
13. **X1 + X2 + X3** — the boss roster.
14. **A4 + G1** — arena state machine, then Mothership / Survival.
15. **C1–C5** — the rendering/silhouette pass, in one commit, with a deliberate golden rebaseline.

## Rules for executing any of it

- **One behavioural cause per commit.** `test/clientDiff.js` seeds one RNG across four rooms in
  sequence, so a change to how many entities exist — or how long one *lives* — shifts every later
  mode's positions. Isolate by overriding the suspect constant at load time and re-running the
  corpus once per candidate cause; a cause that contributes nothing is then *proved* to contribute
  nothing. Changes to how existing entities *move* usually don't shift the stream.
- **Grep for the old number, not just the constant's name** when a value moves. Two known
  false-positive near-collisions: Gunner's bullet `speed 0.511936` vs the old `MOVE_ACCEL_BASE`
  `0.511941`; a retired knockback impulse `0.43881` vs a bullet `speed 0.438816` shared by eight
  drone/trap cannons.
- **Get the `lib/tick.js` category right** (`perTick`/`impulse`/`drag`/`ticks`/`chance`/`quadratic`/
  `lead`/`smoothing`). It never fails loudly — the value just silently stops being
  real-world-correct at the live tick rate. A one-shot impulse into a body that reaches
  `Physics.stepBody` is `impulse()`; the same impulse into a body that integrates its own `vec`
  directly (`entities/Bullet.js`, `entities/Objects.js`) is `perTick()`.
- **Cite the file and line** in the code comment, `diepcustom/src/…:NN`. Say when a number is a
  stand-in with no diep counterpart, at the site.
