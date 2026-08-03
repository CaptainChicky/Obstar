# OBSTAR WORK-SESSION PROMPT — code-execution chat, offline sandbox

You are working on **Obstar**, a diep.io-style tank game (Node game server + canvas client).
This chat has a Linux sandbox with bash + file create/edit, but **no repo on disk and no
internet**. This prompt is self-contained: do Steps 0–3 to stand the environment up, then work.

Optimize for token economy: this repo tempts endless re-derivation and re-verification — resist it.

## What Obstar is
Node game server in `lib/` `rooms/` `entities/`; browser client in `public/client/`; shared
server+client config in `public/SHARE/`. Workflow lives in **`BATCHES.md`** (the plan), with
`issues.md` (issue list), `PENDING.md` (running notes), and an **offline copy of the diep wiki in
`diep_wiki/`** — open the `.txt` to look up boss behaviour; never assume it.

---

## Step 0 — get the repo in
Upload **`Obstar.zip`** (`.zip`, not `.7z` — this sandbox has no 7z extractor). Then:
```bash
mkdir -p /tmp/obstar && cd /tmp/obstar && unzip -q /mnt/user-data/uploads/Obstar.zip -d x && cd x
```
Everything below runs from `/tmp/obstar/x`.

## Step 1 — vendor the test deps (sandbox is OFFLINE, no npm install)
The server/game test chain needs `victor` (2D-vector lib); two network tests (`smoke`, `web`) need
`ws`. `ws` can't be faithfully stubbed (real sockets) — those two stay **unrun** here; they run on
real infra. `victor` is trivial but **must be reproduced exactly** — its float results feed the
golden hash. Write this file **verbatim**:

`node_modules/victor/index.js`
```js
// Faithful, offline reproduction of victor@1.1 for the methods this repo uses.
// Formulas copied exactly from victor 1.x so float results (and the golden hash) match.
'use strict';
function Victor(x, y) {
  if (!(this instanceof Victor)) return new Victor(x, y);
  this.x = x || 0;
  this.y = y || 0;
}
Victor.prototype.add = function (v) { this.x += v.x; this.y += v.y; return this; };
Victor.prototype.subtract = function (v) { this.x -= v.x; this.y -= v.y; return this; };
Victor.prototype.multiply = function (v) { this.x *= v.x; this.y *= v.y; return this; };
Victor.prototype.divide = function (v) { this.x /= v.x; this.y /= v.y; return this; };
Victor.prototype.lengthSq = Victor.prototype.magnitudeSq = function () { return this.x * this.x + this.y * this.y; };
Victor.prototype.length = Victor.prototype.magnitude = function () { return Math.sqrt(this.lengthSq()); };
Victor.prototype.normalize = Victor.prototype.norm = function () {
  var len = this.length();
  if (len === 0) { this.x = 1; this.y = 0; } else { this.divide(new Victor(len, len)); }
  return this;
};
Victor.prototype.angle = Victor.prototype.horizontalAngle = function () { return Math.atan2(this.y, this.x); };
Victor.prototype.rotate = function (angle) {
  var nx = (this.x * Math.cos(angle)) - (this.y * Math.sin(angle));
  var ny = (this.x * Math.sin(angle)) + (this.y * Math.cos(angle));
  this.x = nx; this.y = ny; return this;
};
Victor.prototype.limit = function (max, factor) {
  if (Math.abs(this.x) > max) { this.x *= factor; }
  if (Math.abs(this.y) > max) { this.y *= factor; }
  return this;
};
Victor.prototype.clone = function () { return new Victor(this.x, this.y); };
Victor.prototype.copy = function (v) { this.x = v.x; this.y = v.y; return this; };
Victor.prototype.toObject = function () { return { x: this.x, y: this.y }; };
Victor.prototype.toString = function () { return '(' + this.x + ', ' + this.y + ')'; };
module.exports = Victor;
module.exports.default = Victor;
```
`node_modules/` is gitignored — this shim is a local test aid, **NEVER ship it**.

## Step 2 — VALIDATE the shim before trusting anything
On the **unchanged** tree:
```bash
node test/clientDiff.js
```
Must print `matches golden (281738 ops / 3e2fc0d8)`. If it does, the shim reproduces production
float math exactly and every result below is trustworthy. **If it does NOT match, STOP** — the
shim or the tree has drifted; do not rebaseline, do not trust `rooms`/`client` results.

## Step 3 — the offline safety net
Run ONCE at the end (not repeatedly, not to "make sure"):
```bash
for t in proto tanks interp clock rooms client clientDiff; do echo "== $t =="; node test/$t.js 2>&1 | tail -3; done
```
Expected green: **proto 92, tanks 1265, interp 32, clock 16, rooms 634, client 70**, clientDiff =
golden match. Two rooms tests are RNG-flaky (~1-in-15); a lone failure that clears on one re-run is
not yours. `smoke`/`web` stay unrun (need real `ws`).

---

## File map (grep to these; don't read the big ones whole)
- **Client render:** `public/client/ui.js` (upgrade panel + preview bakes; the crash lived here),
  `drawings.js`, `render.js`, `entities.js`, `game.js`. `drawTank` is assembled at runtime.
- **Tank / boss geometry:** `public/SHARE/TanksConfig.js` (142 KB). Real-diep reference:
  `diepcustom/src/Const/TankDefinitions.json`.
- **Physics / collision:** `public/SHARE/Physics.js` (`back`=recoil, `weight`=knockback); pair
  resolution + team test in `rooms/Room.js`; `lib/quadTree.js`, `lib/damage.js`.
- **Bullets / traps / drones (server):** `entities/Bullet.js`. **Walls:** `entities/Wall.js`
  (axis-aligned rect: centre x/y, size w/h; the only non-circle in collision).
- **AI:** `lib/gameAI.js` (54 KB), `entities/Player.js`.
- **Maze:** `lib/mazeGenerator.js` (faithful port of diep's generator), `rooms/Maze.js`.
- **Server room / game loop:** `rooms/Room.js` (114 KB). Rooms boot via `require('lib/boot.js')()`
  then `controller.newServer(gm)` then `room.ask({name,key,pet,gm})` — see `test/rooms.js`'s
  `makeRoom`.

## CACHED INVARIANTS — do NOT re-derive these
- World axis k = 0.56 du→render-unit. Level-0 tank body = 28 units = 50 du × 0.56; growth
  28×1.01^level.
- Normal-tank barrels: config = du×0.7 (=35/50), drawn at height×(param.size/35); param.size
  carries the 0.56, so it's self-consistent.
- Bosses: wire size = `CLASS[x].bossSize` (set in `rooms/Room.js`). `Drawings.body[n]` draws
  circumradius = param.size/cos(π/n) — so a triangle boss's bossSize is its apothem =
  circumradius×0.5. CONST.SIZE=35, LINEWIDTH=4.
- A boss whose diep source never calls `scale()` has scaleFactor 1 → barrel dims are raw du and
  MUST convert on the boss's own axis: client dim = du×0.56×35/bossSize; boss projectile size =
  du×0.56 (used verbatim server-side: `Bull.size = boss ? can.size : can.size×ra`). Server spawn:
  len = canonLength×ra, mount = distance×ra, ra = size/35. Hence "client height === server
  canonLength" and "client distance === server distance".
- Client `turrets[]` (non-ring) = base circle + canDir-tracking barrel, drawn OVER the body
  (`render.js` post-body pass) — Auto Smasher's mechanism. Turrets take render indices 0..T-1,
  cannons T..; server must order autoDir turret-cannons FIRST so canDir[0..2] align. Plain
  aboveBody cannons draw frozen at offdir (no aim tracking).

---

## Do the work
Follow **`BATCHES.md`**: work the top OPEN batch, its rules, its acceptance tests. Pin every
logic/visual change with an assertion (usually `test/rooms.js`, copy the maze-spawn test) anchored
to at least one **external diep figure** — not the two config halves against each other.

## The golden
`clientDiff` golden only moves if the affected entity is **DRAWN in the recording client's
viewport**. Server-only or off-viewport changes don't move it — pin those with an assertion
instead. A server-logic change should NOT move the golden; if it does, find out why before
accepting. To rebaseline a *verified, intentional* visual change:
```bash
OBSTAR_DIFF_CAPTURE=1 node test/clientDiff.js   # prints new { count, hash }
```
Paste the new values into `GOLDEN` in `test/clientDiff.js` with a one-line note (batch + why).

## Package the result (changed files only)
```bash
mkdir -p /tmp/pristine && (cd /tmp/pristine && unzip -q /mnt/user-data/uploads/Obstar.zip)
diff -rq /tmp/pristine /tmp/obstar/x --exclude=node_modules
# zip only changed paths, e.g.:
cd /tmp/obstar/x && zip -q /tmp/Obstar_changed.zip public/client/ui.js rooms/Maze.js test/rooms.js
```
Hand back `Obstar_changed.zip` (unzips over repo root) via present_files. **NEVER** include
`node_modules/victor`.

---

## WORKING STYLE (this is the token budget)
- Read each file/region ONCE; batch greps; never re-view what you already have.
- Derive each fact once, write it down, reuse it. No re-deriving the same quantity twice.
- Verify ONCE and decisively — one render/measurement check settles it; no plots unless the
  geometry is genuinely ambiguous.
- Decisive scope: do what's asked; note adjacent issues in `PENDING.md`, don't fix them.
- Code comments terse — a line or two of rationale, never paragraphs. Err shorter than neighbors.
- Chat replies short: no plan restatement, no recaps, one tight final summary.