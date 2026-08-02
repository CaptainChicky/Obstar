# BATCHES.md — execution plan for the remaining Obstar issues

Obstar is a diep.io-style tank game: Node game server in `lib/` `rooms/` `entities/`, browser
client in `public/client/`, shared server+client config in `public/SHARE/`. Issues live in
`issues.md`; running notes in `PENDING.md`.

---

## HOW TO RUN A SESSION  (drop this into Claude Code)

> Read `BATCHES.md` and `PENDING.md`. Work the single highest-priority **OPEN** batch below
> (skip anything marked DONE). Do only that batch this session.
>
> Rules that keep you from stalling:
> - Open **only** the files the batch names. `grep` to the relevant region — do **not** read
>   `Room.js` / `TanksConfig.js` / `gameAI.js` end-to-end (they're 114 KB / 142 KB / 54 KB).
> - The local **`diep_wiki/`** folder is the authority for boss behaviour — open the named
>   `.txt`. Don't rely on memory or the network.
> - Every `px` figure in a geometry batch is an **acceptance test**, not a suggestion.
> - Per issue: (1) one-line diagnosis, (2) the edit, (3) run the relevant test.
> - Finish the whole batch before summarizing. End by updating `PENDING.md` (done / still-open)
>   and nothing else. Don't paste file contents back into chat.

### Verify before you finish (non-negotiable)
- `npm install` once, then `npm test` is the safety net — it must stay green.
- **Golden:** `test/clientDiff.js` pins the client's entire canvas-op stream as `{count, hash}`
  (currently `281738 / 3e2fc0d8`). A **server-logic** change should NOT move it. A deliberate
  **visual** change (geometry, draw order, projectile sprites) WILL — that's expected. When it
  does: re-run `OBSTAR_DIFF_CAPTURE=1 node test/clientDiff.js`, confirm the new count/hash reflect
  **only** your intended change, then paste them into `GOLDEN` in that file with a one-line note
  (which batch + why). **Never** rebaseline to make an unexplained diff pass.
- For a **logic** batch, add/extend an assertion test for the new behaviour. Pattern to copy: the
  maze-spawn test in `test/rooms.js` ("no player ever spawns inside a maze wall").

---

## DONE

- **Batch A — overseer crash.** `ui.js` now guards `drawImage` against a 0-size bake canvas at
  both call sites (setClass + setTank). The hard crash is gone. **Residual:** overseer's sprite
  still bakes to 0x0, so its preview tile is blank — folded into **Batch B1** below.
- **Batch E (spawn half) — maze spawn-in-wall.** `rooms/Maze.js` overrides `spawnPoint` to reject
  candidates inside a wall rect (the `isValidSpawnLocation` the code flagged as unbuilt). Before
  this, ~37% of maze spawns landed embedded in a wall; now 0. Pinned by a test in `test/rooms.js`.
  **Still open:** the *wall-vs-wall* visual overlap (a different thing — see Batch E below).

---

## Batch B — Boss geometry re-derivation  *(token-heavy; save for a fresh window)*
**Files:** `public/SHARE/TanksConfig.js` (grep to each entry), `public/client/ui.js` (draw), the
root `*.webp`/`*.png` refs, and `diep_wiki/*.txt`. Split into two passes.

### B1 — the measured shapes (proportions = the acceptance test)
Wiki: `Guardian.txt`, `Summoner.txt`, `Defender.txt`, `Skimmer.txt`, `Fallen Booster.txt`,
`Fallen Overlord.txt`, `Overseer.txt`.
- **Overseer (do this one first — it's the crash residual):** its sprite bounds compute to ~0, so
  the bake canvas is 0x0 and the preview tile is blank. Floor the sprite-canvas allocation at the
  body size (never 0), then correct overseer's config geometry. Same size-conflation root as the
  others here.
- **Guardian:** equilateral triangle; lvl-45 pentashot D 70 -> side **105**.
- **Summoner:** square, currently ~45 deg off. lvl-45 autogunner D 85 -> side **112**; barrels **11**
  off the body (stub); drones emit **from the barrel mouths**, not a gap away.
- **Defender:** equilateral triangle; lvl-45 hybrid D 33 -> side **52** (currently too big). Shorten
  the over-long trapper stub. 3 auto-turrets draw **on top** of the body; turret bullet D == turret
  D. Trap "side length" **14** (shortest vertex-to-vertex, measured outside the concave trap).
  Config shown in `Defender_boss_3.webp`.
- **Skimmer:** inner trapezoid too thin. `skimmerandbullet.png`. At skimmer D 328: outer barrel
  **233** wide; inner trapezoid (wide side out, shallow taper) **191**. Bullet D 236, two secondary
  shooters **95** wide poking **22** past the bullet; secondaries fire bullets the width of the
  secondary barrel, **drawn below** the main bullet.
- **Fallen Booster:** lvl-45 booster D 37 -> body D **42**; bullets = barrel width (B2).
- **Fallen Overlord:** lvl-45 booster D 70 -> body D **92**, drone side **24**.

### B2 — draw-order & projectile identity
- **Dominator z-order:** grey barrels (useful *and* cosmetic) above the black hexagon, below the
  circular body; cosmetic trapezoid also under the circle. `Dominator_tank_4.webp`,
  `Trapper/Gunner_dominator_tank_2.webp`.
- **Auto 3 / Auto 5:** turrets must not overlap the body and only travel their grey ring (regressed
  to overlappable). `Auto_3.webp`.
- **Guardian projectile == small crasher** (triangle, identical — reuse the crasher sprite).
- **Summoner projectile == Necromancer beige drone** (identical sprite).
- **Arena Closer** and **Fallen Booster** bullets: size = the firing barrel's width.
- **Necromancer barrels:** stick out further.

---

## Batch C — Collision ownership + knockback feel  *(one cohesive change)*
**Files:** `public/SHARE/Physics.js` (`back`=recoil, `weight`=knockback impulses), the
pair-resolution + team test in `rooms/Room.js` (grep `knock`/`push`/`team`/`overlap`); trap
lifecycle in `entities/Bullet.js`, `lib/damage.js`. Same "same-team / owner exemption" + one tuning
constant:
- Traps & drones pass through their own team's tanks (no touch, no knockback).
- Battleship drones: no knockback, no same-team interaction (same path).
- Mothership overlaps its own drones (same exemption).
- Traps pushable by their **origin** tank for a short window, then static + freely overlapping (add
  a per-trap settle timer).
- Knockback feels too bouncy: reduce the single `weight` constant; re-test it still separates
  enemies. (Recoil/`back` was deliberately left — see PENDING; don't touch trap/drone recoil.)
- Trapper/Destroyer Dominator traps: confirm they take damage and die like normal traps.
- **Accept:** same-team drones/traps interpenetrate; mothership sits in its swarm; a nudged enemy
  no longer launches; dominator traps are destructible. **Golden should not move** (server logic) —
  if it does, a same-team position changed in the scenario; confirm it's intended.

---

## Batch D — Drone / entity AI  *(one file: `lib/gameAI.js`)*
**Files:** `lib/gameAI.js`, `entities/Player.js`; wiki `Necromancer.txt`, `Factory.txt` +
`Factory_Strategy.txt`, `Base Drones.txt`, `Overseer.txt`, `Overlord.txt`, `Drone Speed.txt`.
- **Necromancer drones from killed squares** (broken): create a drone when the necro kills a
  square; **beige** in no-team modes (all necros), **team-coloured** in TDM. Also fix **god mode**:
  a necro in god mode must still convert squares.
- **Overseer / Overlord symmetric batching:** spawn symmetrically per tick — Overlord 4-at-a-time
  to the last partial batch, Overseer 2, etc.
- **Base-drone overshoot:** they circle too fast and overshoot a target they can't quickly kill.
  `Base Drones.txt` for intended behaviour — fix steering or cap turn/speed.
- **Factory drone AI:** left-click -> approach, hold at a distance, orbit + attack with own turrets;
  right-click -> repel outside a radius, cluster with turrets facing away inside the cursor radius.
  Pull exact distances from diep source / `Factory.txt`.

---

## Batch E — Maze wall overlap  *(spawn half already DONE)*
**Files:** `lib/mazeGenerator.js`, `rooms/Maze.js`.
- **Wall-vs-wall visual overlap:** eliminate even minor overlap between merged wall rects. NOTE
  `mazeGenerator.js`'s header says it's a *faithful port* of diep's generator, "unbounded-access
  quirk" and all — so fixing overlap means deviating from the port; do it at the merge/placement
  step and re-check the maze test still passes (and that maze shapes still look sane).

---

## Batch F — Dominator / Mothership takeover (FOV transfer)  *(standalone, architectural)*
**Files:** `entities/Player.js`, `net/gameSocket.js`, `rooms/Room.js`, `public/client/game.js`.
- On takeover your identity/camera must move to the boss; the old tank dies but **you don't** (you
  *are* the boss now). Two sides: server — reassign which entity the socket "is" (camera/FOV
  target); client — the death-screen trigger keys off *your* entity dying, so re-point it at the
  **new** entity so the old body's death doesn't open `END`.
- **Accept:** taking a dominator/mothership moves the camera onto it, you control only it, and the
  old body dying does not open the death screen.

---

## Batch G — UI flow
**Files:** `public/client/ui.js`, `public/client/game.js`, `views/`.
- **Intro options screen:** slides down, fails, then snaps (regression) — fix the panel ease-in.
- **Respawn gamemode switcher:** `ui.js`'s `END` is canvas-only with no hit-testing and the only
  route to another mode is `POST /play`, so this needs a click region on `END`, a navigation path,
  and a socket-close before the call. Build it fully or leave it — don't half-build.

---

## Suggested order for what's left
1. **C** (collision + knockback) — highest gameplay payoff, cohesive, server-logic so the golden
   shouldn't move; verifiable via `rooms.js`.
2. **D** (drone AI) — one file, verifiable.
3. **B1** then **B2** (geometry) — token-heavy, WILL move the golden (rebaseline per pass).
4. **E** (wall overlap), **F** (FOV), **G** (UI) — self-contained; leave for last.