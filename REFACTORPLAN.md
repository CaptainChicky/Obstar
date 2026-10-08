# REFACTORPLAN — behaviour-preserving simplification of Obstar

Audience: the model/engineer executing the refactor. Read this whole file once, then work the
steps **strictly in order**. Every step is small, has a mechanical pass/fail gate, and is its
own commit. If a gate fails and the step does not explicitly say the gate is *expected* to
move, the step is reverted (`git checkout -- .`), not "fixed forward".

Priority order, fixed: **1. correctness (bit-identical behaviour), 2. less code, 3. scalability
(same hook-based extension points, or better).** When two of these conflict, the lower number
wins. Never trade (1) for (2).

### How to use this file

1. Read §0 (verdict), §1 (the contract) and §2 (gates) completely. Read `HANDOFF.md` §3 once.
2. Do Phase 0 first. Nothing else is safe to start before `test/simDiff.js` says
   `all 11 modes match` and `test/clientDiff.js` says `matches golden`.
3. For each later step: read **only** that step, open **only** the files it names, make the
   change, run the FAST gate, commit with the step's message. Then the next step.
4. Phases 1→7 are ordered by dependency and rising risk; do not reorder. Phase 8 is optional and
   gated on an owner decision. Phase 9 is last because comment edits are easiest to review when
   the code around them is final.
5. Plumbing reminders: `rooms/Room.js` already `require`s `Player`, `Bullet`, `CONFIG`
   (gameAI), `tick`, `config`, `World` — new Room helpers need no new imports. `lib/geom.js`
   (Phase 1) must be `require`d by `entities/Player.js`, `entities/Bullet.js`,
   `entities/Objects.js` and `lib/gameAI.js`. Client helpers go in `public/client/util.js`
   and are exported on `CLIENT.*` like `roundRect`; read them off `CLIENT` at the top of
   `entities.js`/`game.js` exactly as `roundRect` is today.
6. When a step says "exact differences" it means the copies were compared token by token on
   commit `7d75d66`. If the file in front of you differs from what the step describes, stop and
   check `git log` — the tree may have moved; re-derive the table before editing.

---

## 0. Verdict and scope

### 0.1 Is this possible now, before the other issues?

**Yes.** Reasons, verified on this tree (commit `7d75d66`):

1. The behaviour is already pinned by a large logic suite: `test/rooms.js` 851 checks,
   `test/client.js` 92, `test/proto.js` 92, `test/smoke.js` 71, `test/web.js` 21, `interp` 32,
   `clock` 16, `tanks` 4. All green. `npm run lint` clean.
2. The server simulation is **deterministic under a seeded `Math.random`** and has no wall-clock
   dependence inside `Room.step()` (the only timers are in `net/gameSocket.js` and the recoil
   reset `setTimeout` in `Player.shoot()`, which never fires in a synchronous stepped run). A
   prototype that seeds the RNG, builds all 11 modes, steps each 120 ticks and hashes every
   wire byte plus every numeric entity field produced identical per-mode hashes on two runs,
   and flagged a deliberate float re-association in `Physics.stepBody` in 5 of 11 modes.
   That means the refactor can be checked **bit-for-bit**, not by judgement. Phase 0 turns that
   prototype into `test/simDiff.js` (the source in Step 0.2 was run verbatim against this tree
   and produced the hashes it will be pinned to).
3. `test/clientDiff.js` already does the same for the client render stream (4 modes), but its
   golden is stale (`issues.md`). Phase 0 re-pins it to the current tree so it becomes usable.
4. The duplication is real code, not just comments: ~21 % of the core is comments
   (`entities/`, `lib/gameAI.js` ≈ 30 %), the other ~11 k lines contain the copies listed in
   Phases 1–7. Counted on this tree: `createCloser()` ×5, boss `update` fns ×5 (near-identical),
   drone detector+steer block ×5, OOB clamp ×6, `norm().multiply(new Vec(k,k))` push ×14,
   `sqrt(pow+pow)` ×16, death-animation block ×4, team-colour trio ×6 modes, circle-vs-AABB ×3,
   client `hpBar` factory ×3, client `hit()` flash ×3, recoil decay ×2, shield flash ×2.

### 0.2 What this plan does NOT do

- No gameplay/tuning change of any kind, including "obvious" bug fixes. If you find a bug,
  append it to `issues.md` under a new `## Found during refactor` heading and move on.
- No rewrite of the drone orbit maths (`entities/Bullet.js` base-drone `case 1.4` and
  `droneIdleOrbit()`). `issues.md` R3 proposes replacing the tank-drone idle behaviour with
  diep's restCycle state machine; simplifying code that may be replaced is wasted work and a
  second cause in any later diff. Phase 8 is an *optional, gated* unification for the case
  where the owner decides to keep the current behaviour.
- No touching `public/SHARE/TanksConfig.js` data, `public/SHARE/SocketSchema.js`,
  `lib/mazeGenerator.js`, `lib/clock.js`, `lib/SlotMap.js`, `lib/quadTree.js`, `lib/auth.js`,
  `lib/db.js`, `web/app.js`, the menu scripts (`public/queue.js`, `shop.js`, `account.js`,
  `font.js`), or any reference folder (`diepcustom/`, `diepindepth/`, `diep_wiki/`). They are
  either data, already minimal, or not game logic.
- No new client `<script>` file. `views/play.ejs` order is asserted by `test/web.js`; all
  client helpers go into `public/client/util.js` (loaded before `entities`/`game`) or into
  `public/SHARE/Physics.js` when both ends need them.
- `test/rooms.js` is only edited where a step says so (a renamed field it reads). Never
  weaken, delete or "re-pin" an assertion to make a step pass.

### 0.3 One decision the owner should confirm (do not block on it)

Phase 0 re-pins `test/clientDiff.js` to the **current** render (`314699 / bbb08148`). The
`issues.md` item "decide whether those are the intended render" is a separate question; the
refactor's contract is *whatever the tree does today*. If the owner later decides the render
was wrong, that is a behaviour change made after this refactor, with its own re-pin.

---

## 1. The contract — rules that apply to every step

Read these as hard constraints. The gates in §2 enforce most of them mechanically.

### R1. Bit-identical, not "equivalent"
A refactor step may change *where* an expression lives, never *what* it computes at the
floating-point level. Concretely:

| Allowed | NOT allowed (changes bits) |
|---|---|
| Moving an expression into a function and calling it with the same operands in the same order | Re-associating: `a * b * c` → `a * (b * c)`; `x / y / z` → `x / (y * z)` |
| Replacing a literal by a `const` holding the same literal | Replacing `Math.sqrt(Math.pow(a,2)+Math.pow(b,2))` by `Math.hypot(a,b)` (different rounding) |
| Hoisting `tick.ticks(1.65)` into `const HIT_FLASH = tick.ticks(1.65)` | Replacing `Math.PI + Math.atan2(a, b)` by `Math.atan2(-a, -b)` (same angle, different bits) |
| `new Vec(dx,dy).norm().multiply(new Vec(k,k))` → helper doing exactly those calls | Rewriting it as `dx/len*k` (different operation order) |
| Replacing a hand-rolled stable insertion by `Array.prototype.sort` **only** where §7.2 proves the same order | Any sort whose tie order is not proven identical |

If two copies differ by one of the right-hand forms, they are **not** copies. Either keep both,
or unify to one form and declare the step an **EXPECTED HASH CHANGE** (see R6) with the
reason written down. Steps below already classify every such case.

### R2. `Math.random()` call order is part of the behaviour
`test/simDiff.js` and `test/clientDiff.js` seed one RNG. Adding, removing, reordering or
short-circuiting an RNG draw differently changes every later position in the run. Rules:
- Never introduce a `Math.random()` that was not there (e.g. `Math.floor(Math.random() * 1)`
  for a 1-team roster — see §3.5).
- Preserve `&&`/`||` short-circuit order around any `Math.random()` (e.g. in `generate()`,
  `obj[1] < obj.max1 && Math.random() < …` must stay in that order).
- Preserve the order of RNG draws inside object literals (`jitter` before `phase` in corner
  base posts).

### R3. Frozen names
The test suite and the wire read these; do not rename or remove them (Appendix A has the full
list). Headline: every `rules.*` key, `room.INSTANCE.*`, `room.closers`, `room.closing`,
`room.dronePosts`, `room.droneCentres`, `room.XPLVL`, `room.leader`, `room.bosses`,
`room.motherships`, `room.dominators`, all base-drone fields (`levels`, `head`, `spd`, `pvec`,
`crossing`, `chasing`, `switching`, `homing`, `crossIn`, `orbRTarget`, `levelTimer`,
`switchCooldown`, `reactPending`, `tooClose`, `crossTbl`, `crossSegs`, `crossLin`,
`crossLout`, `crossTicks`), all tank-drone `orb*` fields, `Player.{droneCount, droneGroup,
upNb, stillLvl, shootTimer, murder, guardSize, detected, provoked, noDamageTicks}`,
`Bullet.{counted, released, armTicks}`, and the statics `Bullet.estimateCrossTicks`,
`Bullet.sortSwitch`, `Player.AUTOTURRET_LEAD`, `Player.HYPER_REGEN_DELAY/RATE`,
`Player.pointsAtLevel`, `Player.MAX_PER_STAT`, `Player.LEVEL_CAP`, `Player.scriptedScreen`,
`Room.ArenaState`, `Room.bossColor`, `Room.neutralColor`, `Room.xpSource`.

### R4. No feature work, no fixes
Even when a copy is clearly worse than another (e.g. Tester's Mothership lacks `guardSize`),
the plan says explicitly which version wins and whether that counts as an expected hash
change. If a step does not mention a divergence you found, keep the old behaviour and note it
in `issues.md` → `## Found during refactor`.

### R5. One step = one commit
Commit message format: `refactor(<area>): <step id> <title>` — e.g.
`refactor(rooms): 3.1 Room.createCloser() replaces five copies`. Body: the one-line "why", the
gate output summary (`simDiff unchanged, clientDiff unchanged, rooms 851/0, lint clean`), and
for an expected hash change the old→new hash with the reason.

### R6. Hash discipline
- Default: every step leaves **both** goldens unchanged.
- A step marked **EXPECTED HASH CHANGE** names the mode(s) whose `simDiff` hash may move and
  why. Only those may move. Re-pin only those lines; commit the re-pin *in the same commit*.
- Any other movement = the step is wrong. Revert and re-read the step's "exact differences"
  table. Use `OBSTAR_SIM_CAPTURE=1` / `OBSTAR_DIFF_CAPTURE=1` to dump both streams and `diff`
  them to find the first divergent line.

### R7. Comments
Keep comments that state an invariant, a unit, a non-obvious ordering, or a "do not merge
these" warning. Remove comments that narrate history ("was X", "WP8", "see PENDING"),
restate the code, or justify a design at paragraph length. Phase 9 does the sweep; earlier
steps only touch comments inside code they already move.

### R8. Scalability check (per step)
After each step ask: "adding a gamemode / boss / cannon type still takes the same number of
edits or fewer?" The hook table at the top of `rooms/Room.js` must still be true, and must be
updated when a hook is added (`createCloser`, `startClosing`, `spawnBot`, `cornerPosts`,
`stripPosts`).

---

## 2. Gates and procedure

### 2.1 Commands

```powershell
# FAST gate — after every step (≈1 min)
node test/simDiff.js; node test/clientDiff.js; node test/rooms.js; node node_modules/eslint/bin/eslint.js .

# FULL gate — at the end of every phase (≈2 min)
npm test
```

On Windows PowerShell the `&&` chaining in `npm test` works through npm itself; when running
suites by hand use `;` and read each suite's `N passed, 0 failed` line. Treat any `FAIL` line
as a failed gate even if the process exit code was swallowed.

### 2.2 Localising a hash movement

```powershell
# before the step (on a clean tree):
$env:OBSTAR_SIM_CAPTURE = 1; node test/simDiff.js      # writes %TEMP%\obstar-sim-ops.txt
Copy-Item $env:TEMP\obstar-sim-ops.txt $env:TEMP\sim-before.txt
# after the step:
node test/simDiff.js; Remove-Item Env:OBSTAR_SIM_CAPTURE
Compare-Object (Get-Content $env:TEMP\sim-before.txt) (Get-Content $env:TEMP\obstar-sim-ops.txt) | Select-Object -First 5
```

The first differing line names the mode, the tick (`G<tick>` = GameUpdate, `U<tick>` =
UiUpdate) or the entity (`players#3 …`) and the field. Same procedure for `clientDiff`
(`%TEMP%\obstar-diff-ops.txt`).

**Deep check (end of every phase).** The 120-step golden is a 3-second window; bots are still
spawn-shielded for part of it and no boss dies in it. Once per phase, run the same before/after
dump diff with a longer window — `$env:OBSTAR_SIM_STEPS = 600` together with
`OBSTAR_SIM_CAPTURE` — on the phase's start commit and on its end commit, and diff the two
dumps. The printed hashes will not match `GOLDEN` (different window) and that is expected; the
two dumps matching each other is the check.

**What the oracle catches (measured on this tree):** rewriting `stepBody`'s
`(vx + ax*dt) * f` as `vx*f + ax*dt*f` — identical algebra — moved 5 of the 11 mode hashes.
Rewriting a `> 120` distance *comparison* from `sqrt(pow+pow)` to `hypot` moved none (a
1-ulp change rarely flips a comparison). So: the hash is strong evidence, but a step that
touches a comparison or a rarely-taken branch still needs its "exact differences" reasoning
to be right on its own.

### 2.3 Rollback

`git checkout -- .` then `git clean -fd -- test/` if the step created a file. Re-read the
step. If you still cannot make it hash-neutral and the step is not marked EXPECTED HASH
CHANGE, skip the step, record why in the commit log of the next step, and continue.

---

## Phase 0 — Build the oracles (do this first; nothing else until it is green)

### Step 0.1 — Re-pin `test/clientDiff.js` to the current tree
**Why:** it fails today with `expected 327739/90ff3e28, got 314699/bbb08148`; a failing guard
guards nothing.
**Files:** `test/clientDiff.js`.
**Do:**
1. Run `node test/clientDiff.js` and confirm it prints `ops: 314699` / `hash: bbb08148`. If
   it prints anything else, stop — the tree is not the one this plan was written against.
2. Change the `GOLDEN` line to `const GOLDEN = { count: 314699, hash: 'bbb08148' };`.
3. Add one comment line above it: `// Re-pinned at the start of the simplification refactor
   (REFACTORPLAN Phase 0); render unchanged since c8ee14b's orbit-bias/chase-lead/priming commits.`
4. Run again: must print `ok   matches golden`.
**Gate:** `node test/clientDiff.js` green. **Commit:** `refactor(test): 0.1 re-pin clientDiff golden to current tree`.

### Step 0.2 — Create `test/simDiff.js`
**Why:** the bit-exact oracle for all 11 modes, server side. Nothing in the later phases is
trustworthy without it.
**Files:** new `test/simDiff.js`; `package.json` (`test` script and a `test:simDiff` entry);
`HANDOFF.md` §8 table (one row).
**Do:** create the file with exactly this content, then fill in `GOLDEN` as described below.

```js
/*
	Server-side simulation differential: the server analogue of test/clientDiff.js.

	Seeds Math.random, builds every gamemode in rooms/index.js, seats one player, steps each
	room STEPS ticks and hashes (a) every GameUpdate/UiUpdate byte the room would send that
	player and (b) every numeric/string field of every live entity at the end. The result is
	pinned per mode, so a refactor that is meant to be behaviour-preserving fails loud, and
	the failing mode is named.

	Sensitive BY DESIGN to Math.random call order and to floating-point operation order - a
	"mathematically equivalent" rewrite that changes either is a different simulation.

		node test/simDiff.js
		OBSTAR_SIM_CAPTURE=1 node test/simDiff.js    # dump the stream, print the new table
*/
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');

(function seedGlobalRandom() {
	let s = 0x12345678 >>> 0;
	Math.random = function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
})();

const controller = require(path.join(ROOT, 'lib', 'boot.js'))();
const ROOMS = require(path.join(ROOT, 'rooms', 'index.js'));
const PROTO = require(path.join(ROOT, 'public', 'SHARE', 'SocketSchema.js'));

// GOLDEN below is for 120 steps. OBSTAR_SIM_STEPS only makes sense together with
// OBSTAR_SIM_CAPTURE (a before/after dump diff over a longer window - see REFACTORPLAN §2.2).
const STEPS = parseInt(process.env.OBSTAR_SIM_STEPS || '120', 10);
const UI_EVERY = 6;

function fnv1a(str) {
	let h = 0x811c9dc5 >>> 0;
	for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
	return ('0000000' + h.toString(16)).slice(-8);
}

/* Every own number/string/boolean field, plus {x,y}-shaped vectors, in sorted key order. */
function dumpEntity(e) {
	const out = [];
	for (const k of Object.keys(e).sort()) {
		const v = e[k];
		if (typeof v === 'number') { out.push(k + '=' + v); }
		else if (typeof v === 'string' || typeof v === 'boolean') { out.push(k + '=' + JSON.stringify(v)); }
		else if (v && typeof v === 'object' && 'x' in v && 'y' in v && Object.keys(v).length <= 3) { out.push(k + '=' + v.x + ',' + v.y); }
	}
	return out.join(' ');
}

function runMode(gm) {
	const room = controller.newServer(gm);
	room.ask({ name: 'tester', key: '0'.repeat(25), pet: -1, gm: gm });
	room.Init();
	const lines = [];
	for (let i = 0; i < STEPS; i++) {
		room.step();
		if (room.destroy) { break; }
		const buff = room.getBuffer(0);
		if (buff) { lines.push('G' + i + ':' + Buffer.from(PROTO.encode('GameUpdate', buff)).toString('hex')); }
		if (i % UI_EVERY === 0) { lines.push('U' + i + ':' + Buffer.from(PROTO.encode('UiUpdate', room.getUi(0))).toString('hex')); }
	}
	for (const kind of ['players', 'objs', 'bullets']) {
		for (const [id, e] of room.INSTANCE[kind].entries()) { lines.push(kind + '#' + id + ' ' + dumpEntity(e)); }
	}
	room.destroy = 1;
	return lines;
}

// Per-mode goldens of the current tree. Rebuild only after an INTENTIONAL behaviour change,
// and only the modes that change. Format: mode -> { count, hash }.
const GOLDEN = {
	// filled in by Step 0.2 - see REFACTORPLAN.md
};

const results = {};
const all = [];
for (const gm of Object.keys(ROOMS)) {
	const lines = runMode(gm);
	results[gm] = { count: lines.length, hash: fnv1a(lines.join('\n')) };
	all.push('=== ' + gm + ' ===', ...lines);
}

console.log('simulation differential');
let failed = 0;
for (const gm of Object.keys(ROOMS)) {
	const got = results[gm], want = GOLDEN[gm];
	const ok = want && got.count === want.count && got.hash === want.hash;
	console.log((ok ? '  ok   ' : '  FAIL ') + gm.padEnd(11) + got.count + ' / ' + got.hash +
		(ok || !want ? '' : '  (expected ' + want.count + ' / ' + want.hash + ')'));
	if (!ok) { failed++; }
}

if (process.env.OBSTAR_SIM_CAPTURE) {
	const out = path.join(require('os').tmpdir(), 'obstar-sim-ops.txt');
	fs.writeFileSync(out, all.join('\n'));
	console.log('  captured -> ' + out);
	console.log('  paste into GOLDEN:');
	for (const gm of Object.keys(ROOMS)) {
		console.log("\t'" + gm + "': { count: " + results[gm].count + ", hash: '" + results[gm].hash + "' },");
	}
	process.exit(0);
}
console.log(failed ? '  ' + failed + ' mode(s) differ' : '  all ' + Object.keys(ROOMS).length + ' modes match');
process.exit(failed ? 1 : 0);
```

Then:
1. `$env:OBSTAR_SIM_CAPTURE = 1; node test/simDiff.js; Remove-Item Env:OBSTAR_SIM_CAPTURE` —
   paste the printed 11 lines into `GOLDEN`. On commit `7d75d66` (after Step 0.1, which
   changes no server code) the capture printed exactly this; if yours differs, the tree has
   moved since this plan was written — stop and find out why before pinning anything:
   ```
   'ffa': { count: 1328, hash: 'f8a19e5c' },
   '2team': { count: 1038, hash: '9843d090' },
   '4team': { count: 1394, hash: '92ea3383' },
   'boss': { count: 867, hash: '7855a5fd' },
   'sandbox': { count: 262, hash: 'dc125a17' },
   'tag': { count: 1119, hash: '4daec33f' },
   'maze': { count: 1317, hash: '7d62cc7c' },
   'domination': { count: 930, hash: 'f06dd3bd' },
   'mothership': { count: 1255, hash: 'f93f17d5' },
   'survival': { count: 274, hash: '3cedc289' },
   'tester': { count: 1049, hash: '193f799e' },
   ```
2. Run `node test/simDiff.js` **twice**; both runs must print `all 11 modes match`. If the two
   runs disagree the harness is non-deterministic: stop and find the wall-clock/timer leak
   before continuing (none is expected; the prototype was stable).
3. `package.json`: add `"test:simDiff": "node test/simDiff.js"` and insert
   `node test/simDiff.js &&` into the `test` chain **immediately after `node test/clientDiff.js &&`**.
4. `HANDOFF.md` §8 table: add a row for `test/simDiff.js` after the `clientDiff` row:
   "Server simulation differential — per-mode golden of every wire byte and entity field over
   120 seeded ticks, all 11 modes. Re-baseline per mode, deliberately."
5. `issues.md`: under the `clientDiff golden is stale` item, replace the text with one line:
   "Re-pinned to the current render at the start of the refactor (REFACTORPLAN 0.1); whether
   that render is the *intended* one is still open."

**Gate:** FAST gate green (simDiff must say `all 11 modes match`). **Commit:**
`refactor(test): 0.2 add test/simDiff.js per-mode simulation golden`.

### Step 0.3 — Record the baseline
Run the FULL gate and paste its summary lines into the commit body of 0.2 (amend) or a note in
this file under a new `## Baseline` heading at the very end:
`proto 92, interp 32, clock 16, tanks 4, rooms 851, client 92, clientDiff ok, simDiff 11/11, smoke 71, web 21, lint clean`.

---

## Phase 1 — Shared geometry/physics helpers (server)

Goal: one definition each for the push impulse, the arena clamp, and the circle-vs-AABB test,
written so every call site stays bit-identical. These are prerequisites for Phases 2–5.

### Step 1.1 — `lib/geom.js`: `pushAway()`, `clampToArena()`, `circleVsAabb()`
**Files:** new `lib/geom.js`; `HANDOFF.md` file map (one row).
**Target:**

```js
/* Shared contact geometry. Every helper reproduces, operation for operation, the inline
   expression it replaced - bit-identical results are the contract, not "equivalent" maths. */
const Vec = require('victor');

/* ent.vec += normalize(ent - other) * k. Same victor call chain the inline sites used. */
function pushAway(ent, other, k) {
	ent.vec.add(new Vec(ent.x - other.x, ent.y - other.y).norm().multiply(new Vec(k, k)));
}

/* Clamp ent to the rectangle |x| <= hx, |y| <= hy. zeroVec: kill the pressed velocity
   component (every mover but the Arena Closer). Returns which walls pressed, for the one
   caller (Bullet.clampToMap steered branch) that needs to know. */
function clampToArena(ent, hx, hy, zeroVec = true) {
	let cx = 0, cy = 0;
	if (ent.x < -hx) { ent.x = -hx; cx = -1; if (zeroVec) { ent.vec.x = 0; } }
	else if (ent.x > hx) { ent.x = hx; cx = 1; if (zeroVec) { ent.vec.x = 0; } }
	if (ent.y < -hy) { ent.y = -hy; cy = -1; if (zeroVec) { ent.vec.y = 0; } }
	else if (ent.y > hy) { ent.y = hy; cy = 1; if (zeroVec) { ent.vec.y = 0; } }
	return { cx, cy };
}

/* Closest point on wall's AABB to (x,y) and the offset to it. Callers take sqrt themselves
   where they did before (Player/Objects) or compare squared (Bullet). */
function circleVsAabb(x, y, wall) {
	const hw = wall.w / 2, hh = wall.h / 2;
	const cx = Math.max(wall.x - hw, Math.min(x, wall.x + hw));
	const cy = Math.max(wall.y - hh, Math.min(y, wall.y + hh));
	const dx = x - cx, dy = y - cy;
	return { hw, hh, cx, cy, dx, dy, d2: dx * dx + dy * dy };
}

module.exports = { pushAway, clampToArena, circleVsAabb };
```

**Equivalence notes (read before replacing each site):**
- `clampToArena`: the original sites are four independent `if`s. A point cannot satisfy both
  `x < -hx` and `x > hx`, so `if/else if` is identical. Walls are checked x then y in every
  original; keep that.
- `circleVsAabb`: the three WALL arms compute exactly `hw, hh, cx, cy, dx, dy`; Player and
  Objects then `Math.sqrt(dx*dx + dy*dy)`; Bullet compares `dx*dx + dy*dy > size*size`. Return
  `d2` so Bullet uses it directly and Player/Objects do `Math.sqrt(d2)` — same bits as before
  because `d2` is the same product-sum.
- `pushAway`: all 14 sites have the shape `this.vec.add(new Vec(this.x - other.x, this.y -
  other.y).norm().multiply(new Vec(K, K)))`. `K` is sometimes an expression
  (`tick.perTick(this.push)`, `tankKb`, `len * this.absorb`); evaluate it once into a local
  first **only if** the original evaluated it once; where the original wrote the expression
  twice inside `new Vec(expr, expr)` (e.g. `tick.perTick(len * this.absorb)` twice in
  `Objects.js`), evaluating once is still bit-identical because the expression is pure.

**Gate:** FAST (nothing calls the file yet — this step only adds it; lint must pass).
**Commit:** `refactor(lib): 1.1 add lib/geom.js shared contact helpers`.

### Step 1.2 — Route every push impulse through `pushAway()`
**Files:** `entities/Bullet.js` (5 sites: `'god'` option, PLAYER arm, OBJECTS arm, same-owner
BULLET arm), `entities/Player.js` (4: god repel, PLAYER arm `tankKb`, OBJECTS arm `shapeKb`,
BULLET arm `bulletKb`), `entities/Objects.js` (5: PLAYER arm, crasher-vs-shape `0.12121`,
shape-vs-shape, BULLET arm `0.48485`).
**Do:** replace each with `pushAway(this, other, K)` where `K` is the exact magnitude
expression used at that site. Do **not** change the surrounding `if`/`return` structure.
**Gate:** FAST, both hashes unchanged. **Commit:** `refactor(entities): 1.2 pushAway() replaces 14 impulse sites`.

### Step 1.3 — Route every arena clamp through `clampToArena()`
**Sites and their exact parameters** (do not guess — these were read off the tree):

| Site | hx, hy | zeroVec |
|---|---|---|
| `Player.motion()` tail | `this.map.width/2 + config.OOB_MARGIN`, `this.map.height/2 + config.OOB_MARGIN` | true |
| `lib/gameAI.js` `CONFIG.BOTS[0]` tail ("Bots are Players too") | same as above | true |
| `lib/gameAI.js` `bossThrust()` | `boss.map.width/2`, `boss.map.height/2` | true |
| `lib/gameAI.js` `CONFIG.CLOSER[0][0]` (closer motion) | `this.map.width/2`, `this.map.height/2` | **false** (closer never zeroes `vec`) |
| `entities/Objects.js` `update()` tail | `this.map.width/2 + margin`, `this.map.height/2 + margin` with `margin = target ? config.OOB_MARGIN : 0` | true |
| `entities/Bullet.js` `clampToMap(steered)` | `this.map.width/2 + config.OOB_MARGIN`, same for y | `!steered` — and the steered branch uses the returned `{cx, cy}` exactly as it uses its local `cx/cy` today |

For `Bullet.clampToMap`: replace the two `if … else if` lines and the `if (!steered) {…}`
block with `const { cx, cy } = clampToArena(this, mx, my, !steered); if (!cx && !cy) return;
if (!steered) return;` and keep the steered tail verbatim.
**Gate:** FAST, unchanged. **Commit:** `refactor(entities,ai): 1.3 clampToArena() replaces six clamp blocks`.

### Step 1.4 — Route the three WALL arms through `circleVsAabb()`
**Files:** `entities/Player.js` (KIND.WALL arm), `entities/Bullet.js` (KIND.WALL arm),
`entities/Objects.js` (KIND.WALL arm).
**Do:** `const g = circleVsAabb(this.x, this.y, other);` then use `g.hw, g.hh, g.cx, g.cy,
g.dx, g.dy`; Player/Objects: `const d = Math.sqrt(g.d2);`; Bullet: `if (g.d2 > this.size *
this.size) { break; }`. The rest of each arm is unchanged (they genuinely differ: tank =
velocity shed + slack push-out, shape = position snap by drawn radius, bullet = destroy).
**Gate:** FAST, unchanged (Maze mode hash covers walls). **Commit:**
`refactor(entities): 1.4 circleVsAabb() replaces three closest-point blocks`.

### Step 1.5 — `Physics.lerpAngle()` (shared) and `angleDelta`
**Why:** the exact expression
`Math.atan2(Math.sin(a) + (Math.sin(b) - Math.sin(a)) * k, Math.cos(a) + (Math.cos(b) - Math.cos(a)) * k)`
appears in `lib/gameAI.js` (bot turn), `public/client/game.js` (User `canDdir` loop),
`public/client/entities.js` (Tank `ddir`, Tank `canDdir` loop, Bullet `ddir`).
**Files:** `public/SHARE/Physics.js` (add `exports.lerpAngle = function (from, to, k) { return
<that exact expression with a=from, b=to>; }`), then the five call sites.
**Do not** touch `Player.js`'s `angleDelta()`; it is a different function (already a helper).
**Gate:** FAST; `clientDiff` **must** stay unchanged — if it moves, you changed operand order.
**Commit:** `refactor(shared): 1.5 Physics.lerpAngle() replaces five inline angle lerps`.

**Phase 1 end:** FULL gate.

---

## Phase 2 — `lib/gameAI.js`

### Step 2.1 — One boss update body
**Current:** `bossUpdateSummoner`, `bossUpdateGuardian`, `bossUpdateDefender`,
`bossUpdateGeneric` all do `if (bossDeleting(this)) return; bossRegen(this); this.xp =
this.prize; this.motion();` then differ only in the fire gate:

| Boss | After `motion()` |
|---|---|
| Summoner | `if (detected.length \|\| Math.random() < BOSS_SHOOT_CHANCE) { this.up.BPene = detected.length * .9; this.shoot(); }` |
| Fallen Overlord / Fallen Booster (`Generic`) | `if (detected.length \|\| Math.random() < BOSS_SHOOT_CHANCE) { this.shoot(); }` |
| Guardian, Defender | `this.shoot();` |

**Target:**
```js
function bossTick(boss) {   // shared prefix; false while mid death animation
	if (bossDeleting(boss)) { return false; }
	bossRegen(boss);
	boss.xp = boss.prize;
	boss.motion();
	return true;
}
function bossFireGate(boss) { return boss.detected.length || Math.random() < BOSS_SHOOT_CHANCE; }
function bossUpdateAlways() { if (bossTick(this)) { this.shoot(); } }
function bossUpdateGated() { if (bossTick(this) && bossFireGate(this)) { this.shoot(); } }
function bossUpdateSummoner() {
	if (bossTick(this) && bossFireGate(this)) { this.up.BPene = this.detected.length * .9; this.shoot(); }
}
```
`CONFIG.BOSS`: Guardian and Defender → `bossUpdateAlways`; the two Fallen → `bossUpdateGated`.
RNG: `Math.random()` is still only drawn when `detected.length` is 0 (short-circuit kept).
**Gate:** FAST unchanged (boss mode and tester cover all five). **Commit:**
`refactor(ai): 2.1 one boss update body, three one-line gates`.

### Step 2.2 — Dominator regen → `this.regenTick()`
**Proof of equivalence** (do not skip reading this): `dominatorUpdate()` computes
`hps = maxHp * 0.03 / 30 / 25` and `Player.regenTick()` computes
`maxHp * (0.03 + 0.12 * this.up.HpRegan) / 30 / 25`. A Dominator is a fresh `Player` whose
`up.HpRegan` is `0`, so `0.03 + 0.12 * 0` is exactly `0.03` → identical bits. Both compare
`noDamageTicks >= tick.ticks(750)` and add `maxHp * (1/250)`. `Player.regenTick()`'s extra
`else { this.hp = this.maxHp; }` fires only when `hp >= maxHp`, where it is a no-op (a
Dominator's hp never exceeds `maxHp`). `(this.noDamageTicks || 0)` equals `this.noDamageTicks`
because the Player constructor sets it to 0.
**Do:** replace the regen block (from `if (this.hp < this.lastHp)` through `this.lastHp =
this.hp;`) with `this.regenTick();`. Delete `DOMINATOR_HYPER_REGEN_DELAY` and
`DOMINATOR_HYPER_REGEN_RATE`.
**Gate:** FAST unchanged (domination + tester). **Commit:** `refactor(ai): 2.2 Dominator regen uses Player.regenTick()`.

### Step 2.3 — Delete the duplicated constants
- `AUTOTURRET_LEAD` in gameAI → use `Player.AUTOTURRET_LEAD` (gameAI already requires Player).
- `tick.perTick(0.01212)` appears 7× (Summoner, Defender ×2 via `*2`, Fallen Overlord,
  Dominator, Closer idle, Mothership idle) → `const IDLE_SPIN = tick.perTick(0.01212);` at the
  top; Defender keeps `IDLE_SPIN * 2` (same two operations, same bits).
**Gate:** FAST unchanged. **Commit:** `refactor(ai): 2.3 drop duplicated AUTOTURRET_LEAD, name IDLE_SPIN`.

### Step 2.4 — Bots reuse `Player`'s motion integrator
**Current:** `CONFIG.BOTS[0]`'s tail (from `let ax = 0, ay = 0;` to the OOB clamp) is
`Player.motion()`'s middle minus `autoDir`/`ringDir` and the `frozen` check.
**Exact difference:** the bot's alpha-regrow condition is `if (this.alpha < 1)`; Player's is
`if (this.alpha < 1 && !this.dev.invisible)`. The only way a bot has `dev.invisible` is the
admin command `player <id> invisible on` on a bot id. **Decision: use Player's condition.**
This is an admin-cheat-only divergence, unreachable in the goldens → hashes unchanged, but
record it in the commit body as "accepted: admin-invisible bots no longer regrow alpha on move".
**Target in `Player.js`:**
```js
/* One tick of the tank integrator: stealth regrow + shield drop on movement, stepBody, arena
   clamp. motion() adds autoDir/ringDir on top; bots (lib/gameAI.js) call this directly. */
integrateMotion(ax, ay, moving) {
	if (moving) {
		if (this.alpha < 1 && !this.dev.invisible) {
			this.alpha += Math.min(1, tick.perTick(CLASS[this.class].stealth.moving));
		}
		if (this.shield) { this.shield = 0; }
	}
	const body = { x: this.x, y: this.y, vx: this.vec.x, vy: this.vec.y };
	Physics.stepBody(body, ax, ay, tick.SCALE);
	this.x = body.x; this.y = body.y;
	this.vec.x = body.vx; this.vec.y = body.vy;
	clampToArena(this, this.map.width / 2 + config.OOB_MARGIN, this.map.height / 2 + config.OOB_MARGIN);
}
```
`Player.motion()` becomes: compute `ax, ay, moving` as today → `this.integrateMotion(ax, ay,
moving)` → the `autoDir`/`ringDir` lines. **Ordering note:** today the clamp runs *after*
`autoDir`/`ringDir`; they do not read or write x/y/vec, so moving the clamp before them is
identical. The bot: replace its tail with `this.integrateMotion(ax, ay, motion.length() > 0)`
followed by the existing `if (this.DETEC) this.DETEC.reset(); if (this.size <= 0) …`.
**Gate:** FAST unchanged (every mode with bots). **Commit:**
`refactor(ai,player): 2.4 Player.integrateMotion() shared by humans and bots`.

**Phase 2 end:** FULL gate.

---

## Phase 3 — `rooms/*` (highest duplication, lowest risk)

### Step 3.1 — `Room.createCloser(team, pos)` and `Room.startClosing(team)`
**Copies:** `Tag.createCloser`, `Survival.createCloser`, `Mothership.createCloser`,
`Maze.createCloser` are byte-identical except the team argument; `Tester.createTestCloser`
additionally fixes the position, wraps `motion`, and stores `tester_closer`.

| Mode | team passed | spawn position |
|---|---|---|
| Tag | `this.rules.neutralTeam` (which `Room`'s ctor remapped to `bossTeam` = 9 because 2 ∈ teams) | `this.spawnPoint()` |
| Maze | `this.rules.neutralTeam` (= 2) | `this.spawnPoint()` |
| Survival | `this.rules.bossTeam` (= 9) | `this.spawnPoint()` |
| Mothership | `this.rules.bossTeam` (= 9) | `this.spawnPoint()` |
| Tester | `this.rules.neutralTeam` | fixed `{ x: -W/4, y: H/4 }` |

Keep the team **as an explicit argument** — do not derive it, Maze and Survival genuinely
differ.
**Target in `Room`:**
```js
// in constructor, BEFORE this.build():
this.closing = false;
this.closers = [];
…
/* Tag/Survival/Mothership/Maze/Tester: an invincible Arena Closer is a Player bound to
   CONFIG.CLOSER. `pos` defaults to the mode's own spawnPoint(). */
createCloser(team, pos) {
	const spec = CONFIG.CLOSER[0];
	const at = pos || this.spawnPoint();
	const closer = this.INSTANCE.players.add((id) => {
		const c = new Player({ GM: this.gm, sId: this.id, oId: id }, at.x, at.y, spec[2], team, this.XPLVL, this);
		c.closer = 1;
		c.class = spec[2];
		c.screen = Player.scriptedScreen(c.class);
		c.size = 98;
		c.guardSize = c.size;
		c.damage = 50;
		c.up.BSpeed = 1 + 0.15 * 7;
		c.hp = c.maxHp = this.rules.bossHp;
		c.shield = 0;
		c.motion = spec[0].bind(c);
		c.update = spec[1].bind(c);
		return c;
	});
	if (closer) { this.closers.push(closer); }
	return closer;
}
/* Spawns the fixed closer burst and locks respawn. */
startClosing(team) {
	this.closing = true;
	for (let i = 0; i < CLOSER_COUNT; i++) { this.createCloser(team); }
}
```
`const CLOSER_COUNT = 4;` moves to `Room.js`; delete it from the four modes.
**RNG:** `this.spawnPoint()` must be evaluated **before** `players.add()` (it is, in every
copy) — `pos || this.spawnPoint()` with `pos` undefined does exactly that.
**Mode edits:**
- Tag: delete `createCloser`, `startClosing`, `build()`'s `this.closing/this.closers` lines;
  `step()` calls `this.startClosing(this.rules.neutralTeam)`.
- Maze: same; `close()` calls `this.startClosing(this.rules.neutralTeam)`.
- Survival: delete `createCloser`; `startClosing` deleted; `updateSurvivalState()` keeps
  `this.closing = true;` (harmless double-set) and calls `this.startClosing(this.rules.bossTeam)`.
- Mothership: delete both; `step()` calls `this.startClosing(this.rules.bossTeam)`.
- Tester: `createTestCloser()` becomes
  ```js
  const closer = this.createCloser(this.rules.neutralTeam, { x: -this.map.width / 4, y: this.map.height / 4 });
  if (closer) {
  	const chase = closer.motion;          // === CONFIG.CLOSER[0][0].bind(closer)
  	const room = this;
  	closer.motion = function () { if (room.closerOn) { chase.call(this); return; } this.target = null; this.dir += IDLE_SPIN_LIKE; };
  }
  this.tester_closer = closer || null;
  ```
  where the idle line stays exactly `this.dir += tick.perTick(0.01212);` (Tester has its own
  `tick` import). Tester's closer is now also in `this.closers` — nothing reads it there;
  accepted.
- Hook table at the top of `Room.js`: add `createCloser / startClosing — Arena Closer win/close`.
**Gate:** FAST unchanged (tag, maze, mothership, survival, tester all in simDiff; `rooms.js`
reads `room.closers`, `room.closing`). **Commit:**
`refactor(rooms): 3.1 Room.createCloser()/startClosing() replace five copies`.

### Step 3.2 — One respawn guard
**Copies:** Tag/Mothership/Maze `respawn(id, force, bot) { if (this.closing && !force) return;
return super.respawn(...) }`; Survival `if (!this.allowsRespawn() && !force) return;`.
**Do:** in `Room.respawn()`, first line:
`if (!force && (this.closing || !this.allowsRespawn())) { return; }` — then delete the four
overrides. **Do not** change `allowsRespawn()` itself (it is on the wire as `canRespawn`;
making it return `!this.closing` for Tag/Maze/Mothership would change the wire).
**Gate:** FAST unchanged. **Commit:** `refactor(rooms): 3.2 one respawn guard in Room`.

### Step 3.3 — Team colours keyed on `rules.teamPlay`
**Copies:** `entityColor/mainColor/leaderColor` overridden identically in TwoTeam, FourTeam,
Tag, Tester, Mothership (Mothership's `entityColor` omits the boss branch; `maxBoss` is 0 there
and `Room.bossColor()` returns `player.team` for a non-boss anyway → identical for every
entity that can exist). Every `teamPlay: true` mode overrides; no `teamPlay: false` mode does.
**Do (in `Room`):**
```js
entityColor(player) {
	if (player.boss) { return Room.bossColor(player); }
	return Room.neutralColor(player) ?? (this.rules.teamPlay ? player.team : 1);
}
mainColor(player) { return this.rules.teamPlay ? player.team : 0; }
leaderColor(player, viewerId) {
	return this.rules.teamPlay ? player.team : ((player.id.oId === viewerId) ? 0 : player.team);
}
```
Delete the overrides in TwoTeam, FourTeam, Tag, Tester, Mothership. Keep Tester's
`mapDotColor()` (it is genuinely different).
**Mothership `bulletColor` override:** it drops two rules of `Room.bulletColor()`: the
`drawColor` passthrough and the `type === 3 && !teamPlay` necro-beige. In Mothership mode
`teamPlay` is true (rule off) and the only `drawColor`/`drawType` cannons in
`TanksConfig.js` are Summoner's and Guardian's (bosses; `maxBoss: 0`, `createBoss()` refuses).
→ dead code; delete the override.
**Gate:** FAST unchanged (2team/4team/mothership/tester hashes include colour bytes).
**Commit:** `refactor(rooms): 3.3 team colour hooks keyed on rules.teamPlay`.

### Step 3.4 — `Room.spawnBot(slot)` shared by `createAi()` and Survival's `padOneBot()`
The two bodies are identical (name roll, `motion` bind, `bot = 1`, `xp = 5000 + rand*60000`,
`players.set`, `bots.push`, `respawn(slot.id, 1, 1)`). Extract to `spawnBot(slot)`;
`createAi()` → `for (const slot of this.botRoster()) this.spawnBot(slot);`;
`padOneBot()` → `const slot = this.botRoster()[this.bots.length]; if (slot) this.spawnBot(slot);`.
RNG order inside is unchanged (name roll, then xp roll). **Gate:** FAST unchanged.
**Commit:** `refactor(rooms): 3.4 Room.spawnBot() replaces two copies`.

### Step 3.5 — Round-robin `botRoster()` becomes a rule
FourTeam and Tag have the identical round-robin roster with a random team offset. `Room`'s
default puts every bot on `teams[0]` with **no RNG draw**. TwoTeam's is a third shape (random
*start id*, `team: i % 2`) and stays as is. Mothership (`teams: [0,1]`, 3 bots) and Tester
(`teams: [0,1]`, 0 bots) use `Room`'s default today — so the round-robin must be **opt-in**, or
Mothership's bots would change team and both modes would consume an extra RNG draw (R2).
**Do:**
1. `DEFAULT_RULES`: add `botRosterRoundRobin: false, // bots dealt across rules.teams from a random offset`.
2. FourTeam and Tag constructors: add `botRosterRoundRobin: true`; delete their `botRoster()`.
3. `Room.botRoster()`:
```js
botRoster() {
	const teams = this.rules.teams;
	const rr = this.rules.botRosterRoundRobin;
	// The offset roll only exists for round-robin modes: a draw here in any other mode would
	// shift every later RNG consumer in the room.
	const offset = rr ? Math.floor(Math.random() * teams.length) : 0;
	const roster = [];
	for (let i = 0; i < this.rules.botCount; i++) {
		roster.push({ id: this.rules.botIdStart + i, team: rr ? teams[(offset + i) % teams.length] : teams[0] });
	}
	return roster;
}
```
**Gate:** FAST unchanged (4team/tag identical draws; ffa/boss/maze/survival/sandbox/
mothership/tester: no new draw). **Commit:** `refactor(rooms): 3.5 rules.botRosterRoundRobin replaces two rosters`.

### Step 3.6 — Base-post builders shared: `stripPosts()` and `cornerPosts()`
**Copies:** TwoTeam `basePosts()` (strip; also copied into Tester), FourTeam `basePosts()`
(corner, 12 per base with jitter; copied into Domination and Tester).
**Target in `Room`:**
```js
/* TwoTeam-style strip: `centres` orbit centres down one side, `perCentre` drones each. */
stripPosts(team, side, centres, perCentre) {
	const spacing = this.map.height / centres;
	const posts = [];
	for (let i = 0; i < centres; i++) {
		const plan = this.levelPlan(perCentre);
		for (let d = 0; d < perCentre; d++) {
			posts.push({
				team, x: side * (this.map.width / 2 - this.baseSize / 2),
				y: spacing * (i + 0.5) - this.map.height / 2,
				level: plan.initial[d], phase: Math.random() * Math.PI * 2, levels: plan,
				crossIn: Math.max(1, Math.round(tick.ticks(config.BASE_DRONE_CROSS) *
					(i * perCentre + d + 1) / (centres * perCentre)))
			});
		}
	}
	return posts;
}
/* FourTeam-style ring: `perBase` drones around one centre, cross times jittered ±20%. */
cornerPosts(team, c, perBase) {
	const plan = this.levelPlan(perBase);
	const posts = [];
	for (let i = 0; i < perBase; i++) {
		const jitter = 1 + (Math.random() * 2 - 1) * 0.2;        // FIRST draw
		posts.push({
			team, x: c.x, y: c.y, level: plan.initial[i],
			phase: Math.random() * Math.PI * 2,                    // SECOND draw
			levels: plan,
			crossIn: Math.max(1, Math.round(tick.ticks(config.BASE_DRONE_CROSS) * (i + 1) / perBase * jitter))
		});
	}
	return posts;
}
```
**RNG order check against the originals:** strip = one `phase` draw per post. Corner = `jitter`
then `phase` per post, `levelPlan()` before the loop (no RNG). TwoTeam loops `for team …
for i … for d …` — reproduce with `for (const team of this.rules.teams) posts.push(...
this.stripPosts(team, team ? 1 : -1, 15, 2))`. FourTeam: `for team: posts.push(...
this.cornerPosts(team, this.baseCenter(team), 12))`. Domination: same with its own
`baseCenter`. Tester: `[...this.stripPosts(0, -1, STRIP_CENTRES, STRIP_PER_CENTRE),
...this.cornerPosts(0, this.cornerCenter(), CORNER_DRONES)]` — same order as today (strip
first, then corner). Tester's `x` for the strip is `-(W/2 - baseSize/2)` = `side * (W/2 -
baseSize/2)` with `side = -1`: `-1 * v` and `-(v)` are bit-identical.
Delete the comment in Tester claiming the copy is deliberate; the shared helper cannot diverge.
**Gate:** FAST unchanged (2team/4team/domination/tester). **Commit:**
`refactor(rooms): 3.6 stripPosts()/cornerPosts() replace four basePosts bodies`.

### Step 3.7 — Corner-base geometry shared by FourTeam and Domination
`corner()` differs (4 corners vs 2 opposite corners) and stays per mode. `baseCenter()`,
`inEnemyBase()`, `spawnPoint()` are byte-identical in both. Move the three to `Room` as
`cornerBaseCenter(team)`, `inCornerBase(obj, margin)`, `cornerSpawnPoint(tank)`, each calling
`this.corner(team)`; FourTeam/Domination keep `corner()` and become
`baseCenter(t) { return this.cornerBaseCenter(t); }` etc. — or simply rename the call sites
(`basePosts` → `this.cornerBaseCenter`, `inEnemyBase` → `return this.inCornerBase(obj,
margin)`, `spawnPoint` → `return this.cornerSpawnPoint(tank)`). Tester's `inEnemyBase` stays
(it is a genuine hybrid). **Gate:** FAST unchanged. **Commit:**
`refactor(rooms): 3.7 corner-base geometry shared by FourTeam and Domination`.

### Step 3.8 — `Room.createMothership(team, x, y)`
**Copies:** `Mothership.createMothership(team, angle)` and `Tester.createTestMothership()`.
**Exact differences:** position (`cos(angle)*W/2*0.8` vs `W/4, -H/4`); team (loop vs `1`);
Tester **omits `m.guardSize = m.size`** (so its Mothership collides at the constructor's
`guardSize = 25`, not `bossSize`), and Tester stores `tester_mothership`.
**Decision:** the shared helper includes `guardSize = size` (Mothership.js's version). This
is a **EXPECTED HASH CHANGE for `tester` only** (its Mothership's contact radius becomes
correct). Re-pin only the `tester` line; commit body: "tester Mothership now has the same
guardSize as Mothership mode's; previously 25 (constructor default) — diagnostic room only".
**Do:** `createMothership(team, x, y)` in `Room` (body = Mothership.js's, with `x, y`
parameters; pushes to `this.motherships`; returns it). `Mothership.build()` →
`this.createMothership(team, Math.cos(angle) * this.map.width / 2 * 0.8, Math.sin(angle) *
this.map.height / 2 * 0.8)`. Tester → `this.tester_mothership = this.createMothership(1,
this.map.width / 4, -this.map.height / 4) || null`. `MOTHERSHIP_HP = 7000` moves to `Room.js`.
**Gate:** FAST; `mothership` unchanged, `tester` re-pinned. **Commit:**
`refactor(rooms): 3.8 Room.createMothership() replaces two copies (tester guardSize fixed)`.

### Step 3.9 — Hook table and HANDOFF
Update the hook list at the top of `Room.js` (add `createCloser`, `startClosing`, `spawnBot`,
`stripPosts`, `cornerPosts`, `cornerBaseCenter/inCornerBase/cornerSpawnPoint`,
`createMothership`) and the `rooms/*` rows in `HANDOFF.md`'s file map to say "tunables +
`corner()`" etc. where a file shrank to that. **Gate:** FAST. **Commit:** `docs: 3.9 Room hook table after Phase 3`.

**Phase 3 end:** FULL gate. Expected line reduction: ~350 lines across `rooms/`.

---

## Phase 4 — `entities/Player.js`

### Step 4.1 — Stat step table replaces two mirrored switches
`upgrade()` applies a per-stat step; `applyClassSwitchStats()` applies the exact inverse.
`upgrade()` also walks `for (const i in this.up) { nb++; if (nb !== data) continue; … }` to
map a wire index to a key.
**Target:**
```js
// Wire/upNb index -> this.up key. Same order as the `up` object literal in the constructor.
const UP_KEYS = ['MSpeed', 'Reload', 'BSpeed', 'BPene', 'BDamage', 'BodyDam', 'HpUp', 'HpRegan'];
/* One point of each stat, and its exact inverse (class-switch refund). Operation order is
   the one upgrade()/applyClassSwitchStats() used - keep it. */
const STAT_STEP = {
	HpRegan: { up: (p) => { p.up.HpRegan += 1; }, down: (p) => { p.up.HpRegan -= 1; } },
	Reload:  { up: (p) => { p.up.Reload *= 0.914; }, down: (p) => { p.up.Reload /= 0.914; } },
	BSpeed:  { up: (p) => { p.up.BSpeed += 0.15; }, down: (p) => { p.up.BSpeed -= 0.15; } },
	BDamage: { up: (p) => { p.up.BDamage += 0.4285714; }, down: (p) => { p.up.BDamage -= 0.4285714; } },
	BPene:   { up: (p) => { p.up.BPene += 0.75; }, down: (p) => { p.up.BPene -= 0.75; } },
	MSpeed:  { up: (p) => { p.up.MSpeed += 1; }, down: (p) => { p.up.MSpeed -= 1; } },
	HpUp:    { up: (p) => { p.hp *= (p.maxHp + 20) / p.maxHp; p.maxHp += 20; },
	           down: (p) => { p.maxHp -= 20; p.hp *= p.maxHp / (p.maxHp + 20); } },
	BodyDam: { up: (p) => { p.damage += 1; }, down: (p) => { p.damage -= 1; } }
};
```
`upgrade(data)`: keep the gate and the `statMax` cap check; then `this.stillLvl += 1;
this.upNb[data] += 1; STAT_STEP[UP_KEYS[data]].up(this);`. `applyClassSwitchStats()`: loop
`for (let idx = 0; idx < UP_KEYS.length; idx++)` with `STAT_STEP[UP_KEYS[idx]].down(this)`.
**Check by reading:** the `up` literal in the constructor lists its keys in exactly `UP_KEYS`
order (`MSpeed, Reload, BSpeed, BPene, BDamage, BodyDam, HpUp, HpRegan`). Put a one-line
comment on that literal — `// key order is UP_KEYS (wire/upNb index)` — so nobody reorders it.
No test is added (the goldens already exercise every stat through the bots' build orders).
**Gate:** FAST unchanged (bots upgrade every tick in every mode). **Commit:**
`refactor(player): 4.1 STAT_STEP table replaces two mirrored switches`.

### Step 4.2 — `applyClass(newClass)` shared by `upClass()` and `cycleClass()`
Both do, in this order: DETEC drop (`!bot && DETEC && !CLASS[new].DETEC → null`),
`resetDroneBudget()`, `necro = CLASS[new].necro`, `shootTimer = new Array(cannons.length).fill(0)`,
`applyClassSwitchStats(old)`. Extract `applyClass(name)` that sets `this.class = name` and does
those five; `upClass()` keeps its tree gate, `classLvl++`, and the `scary_tank` unlock;
`cycleClass()` keeps its index arithmetic. **Gate:** FAST unchanged. **Commit:**
`refactor(player): 4.2 applyClass() shared by upClass/cycleClass`.

### Step 4.3 — `applyDamage(amount, murder)` in the three collision arms
Each arm does `this.hp -= tick.perTick(X * (option.dmgScale ?? 1)); this.hit = tick.ticks(1.65);
if (this.hp <= LETHAL_EPS) { this.hp = 0; this.dead = tick.DEAD_DELAY; this.murder = M;
this.destroy = tick.DES; <arm-specific extras> }`.
**Target:**
```js
const HIT_FLASH = tick.ticks(1.65);
/* Subtract one tick of damage; on a lethal hit set the death state and return true so the
   caller can do its own kill credit. `murder` is the ["players"|"objs", id] pair. */
applyDamage(amount, murder) {
	this.hp -= amount;
	this.hit = HIT_FLASH;
	if (this.hp > LETHAL_EPS) { return false; }
	this.hp = 0;
	this.dead = tick.DEAD_DELAY;
	this.murder = murder;
	this.destroy = tick.DES;
	return true;
}
```
Call sites pass `tick.perTick(other.damage * TANK_TANK_MULT * (option.dmgScale ?? 1))` etc.
unchanged. Keep the `if (this.boss) { this.provoked = …; }` lines **before** the call where
they are today (PLAYER and BULLET arms) — order relative to the hp subtraction does not matter
(independent fields) but keep it anyway. Objects.js and Bullet.js have their own hp/pene
subtractions with different death states (no `dead`, `pene = 0`) — **leave them**, they are not
copies. **Gate:** FAST unchanged. **Commit:** `refactor(player): 4.3 applyDamage() in the three arms`.

### Step 4.4 — `muzzlePoint(can, aimDir)` shared with `Room.factorySpawnPoint()`
`shoot()` computes `ra, offx, len, offlen, offdir, mountDir, originX/Y, x, y` for a cannon;
`Room.factorySpawnPoint()` recomputes the same for Factory's cannon[0] minus `distance`/`ring`
(Factory's cannon has neither → `originX = x + Math.cos(mountDir) * 0 * ra` = `x`; adding `+0`
to a finite double is bit-identical).
**Target (Player):**
```js
/* World position of a cannon's barrel tip for aim direction `dir`. Ring cannons mount on
   the turret ring, everything else on the hull. */
muzzlePoint(can, dir) {
	const ra = this.size / 35;
	const offx = can.offx * ra;
	const len = can.canonLength * ra;
	const offlen = Math.hypot(len, offx);
	const offdir = Math.atan2(offx, len);
	const mountDir = can.ring ? (can.offdir + this.ringDir) : (this.dir + can.offdir);
	const originX = this.x + Math.cos(mountDir) * (can.distance || 0) * ra;
	const originY = this.y + Math.sin(mountDir) * (can.distance || 0) * ra;
	return { x: originX + Math.cos(dir + offdir) * offlen, y: originY + Math.sin(dir + offdir) * offlen };
}
```
`shoot()` keeps its own `ra` (it is used elsewhere in the loop) and calls
`const m = this.muzzlePoint(can, dir)`. `factorySpawnPoint()` →
`return factory.muzzlePoint(can, factory.dir + can.offdir);`.
**Gate:** FAST unchanged. **Commit:** `refactor(player,rooms): 4.4 muzzlePoint() shared with factorySpawnPoint`.

### Step 4.5 — `canClaimSquare()` / `claimSquare()` as the single necro-claim path
Three sites test `droneCount < CLASS[class].maxDrone + upNb[1]`: `Player.claimSquare()`,
`Objects.collision()` PLAYER arm, `Objects.collision()` BULLET arm (via the bullet's owner).
`Bullet.collision()` OBJECTS arm has a **full inline copy** of `claimSquare()`'s drone
construction.
**Do:**
- `Player.canClaimSquare(shape) { return !!this.necro && shape.type === 'sqr' &&
  this.droneCount < CLASS[this.class].maxDrone + this.upNb[1]; }` — `claimSquare()` becomes
  `if (!this.canClaimSquare(shape)) return false; …construction unchanged…`.
- `Objects.collision()` PLAYER arm: `if (other.canClaimSquare(this)) { this.destroy = 1; return; }`
  (the inline test was `other.necro && this.type === 'sqr' && droneCount < …` — same three
  terms, same order; `!!` on a truthy object/undefined does not change the branch).
- `Objects.collision()` BULLET arm: `if (other.necro && other.type …)` — currently
  `if (other.necro && this.type === 'sqr') { const play = …get(origin); if (play.droneCount <
  …) { destroy = 1; return; } }`. Keep `other.necro &&` (the bullet's flag) as the outer test
  so the owner lookup only happens when it did before, then `if (play.canClaimSquare(this))`.
  **Note:** `play.canClaimSquare` reads `play.necro`, the inline read `CLASS[play.class].maxDrone`
  without checking `play.necro`; if the owner has just evolved out of Necromancer,
  `CLASS[newClass].maxDrone` may be `undefined` → `NaN` comparison → false; `canClaimSquare`
  returns false via `!this.necro` → same branch. If the owner is a class with `maxDrone` but no
  `necro` (e.g. Overlord) — impossible for a bullet with `necro` set (set from `play.necro.necro`
  at spawn; `update()` destroys drones on class change before the next collision pass? **No** —
  collision runs before update in `step()`, so one tick exists where the bullet is necro and
  the owner is e.g. Overlord: inline → `droneCount < 8 + upNb[1]` possibly **true** → square
  destroyed & claimed as a *necro drone of an Overlord* for one tick; new → false. This is a
  one-tick edge case only reachable by evolving while a drone touches a square; **accepted
  divergence**, record in commit body. It cannot appear in the goldens (no Necromancer in the
  stepped window).
- `Bullet.collision()` OBJECTS arm: replace the inline block with
  `if (this.necro) { const play = this.room.INSTANCE.players.get(this.origin.oId); if (play.claimSquare(other)) { return; } }`
  (the original also dereferenced `play` unguarded; keep that).
**Gate:** FAST unchanged. **Commit:** `refactor(entities): 4.5 one necro-claim path`.

**Phase 4 end:** FULL gate.

---

## Phase 5 — `entities/Bullet.js` (steering only — orbit maths untouched)

### Step 5.1 — `refreshDroneDetector(bullet, play)`
Five byte-identical blocks (`droneSteer1`, `case 1.1`, `case 1.2`, `case 3`, `minionSteer`):
```js
if (!bullet.DETEC) {
	bullet.DETEC = new Detector(play, bullet.x, bullet.y, droneAggroR(play), [KIND.PLAYER, KIND.OBJECTS]);
	bullet.DETEC.team = bullet.team;
} else {
	bullet.DETEC.x = bullet.x; bullet.DETEC.y = bullet.y;
	bullet.DETEC.size = bullet.DETEC.dis = droneAggroR(play);
}
```
Extract as a module function; replace all five. **Gate:** FAST unchanged. **Commit:**
`refactor(bullet): 5.1 refreshDroneDetector() replaces five blocks`.

### Step 5.2 — `droneAutoTarget(bullet, play)`: the "committed target or re-arm" block
Four copies (`droneSteer1`, `1.1`, `1.2`, `3`):
```js
if (bullet.DETEC.select) {
	bullet.DETEC.enabled = 0;
	const other = bullet.DETEC.select;
	if (!other.destroy && other.alpha && droneInAggro(play, other, true)) { return other; }
	bullet.DETEC.reset();
	bullet.DETEC.enabled = 1;
}
return null;
```
Each caller then does its own engaged lines (`1.2` sets `showDir = vec.angle()` first; all set
`dir = droneChaseDir(bullet, other); orbLevel = undefined`). `minionSteer` has the same test but
sets `enabled = 0` *inside* the success branch and reads `other.x/y` → not a copy; leave it.
**Gate:** FAST unchanged. **Commit:** `refactor(bullet): 5.2 droneAutoTarget() replaces four blocks`.

### Step 5.3 — One controllable-drone steer for types 1 and 3; one uncontrollable for 1.1
After 5.1/5.2, `droneSteer1` (type 1) and `case 3` differ **only** in the right-click formula:
type 1 `Math.atan2(bullet.y - my, bullet.x - mx)`, type 3 `Math.PI + Math.atan2(my - y, mx - x)`.
Same angle, different bits (R1). **Decision:** unify on type 1's form. **EXPECTED HASH
CHANGE: none** (no Necromancer exists in any golden window) — but it *is* a sub-ulp behaviour
change for Necromancer right-click; record it in the commit body. `case 3` becomes
`case 3: case 1: if (!droneSteer(this, play)) return; break;` — check that `case 1`'s
`this.showDir = this.dir; if (!this.comingDir) this.comingDir = 0; this.speed = this.maxspeed;`
prefix is what `case 3` also does (it is). `case 1.1` = `droneSteer` minus the mouse branch →
`droneSteerAuto(bullet, play, { trackVecAngle: false })`; `case 1.2` = the same with
`trackVecAngle: true` and **without** the `showDir = dir`/`comingDir` prefix. Write the two
variants as one function with that flag; confirm by reading both cases side by side that the
*only* differences are the prefix and the `showDir` write. **Gate:** FAST unchanged.
**Commit:** `refactor(bullet): 5.3 droneSteer()/droneSteerAuto() replace four switch arms`.

### Step 5.4 — `spawnSubShot(parent, spec, x, y, dir, play)`
`case 1.5` (minion weapon) and `case 4` (skimmer sub) each build a `Bullet` and assign `type 0,
class, pene, life (tick.ticks), damage, size, weight, push, bdPoints`, then
`createBullet(b, { team: parent.team, dev: {} })`. Skimmer also sets `underlay = 1`. Extract with
an `underlay` flag; the reload gating, the muzzle offset (`size * 1.7` for the minion, none for
the skimmer) and the two-barrel loop stay at the call sites. `muzzleKick = speed /
BULLET_MAINTAIN + 16.8` is identical in both → inside the helper. **Gate:** FAST unchanged.
**Commit:** `refactor(bullet): 5.4 spawnSubShot() for minion/skimmer sub-shots`.

### Step 5.5 — Trim `Bullet` constructor comments (R7 only)
The constructor is ~70 lines of which ~45 are narrative comments about `weight`/`push`,
`bdPoints`, `launchKick`, `counted`/`released`. Keep one line each. No code change. **Gate:**
FAST unchanged (comments). **Commit:** `refactor(bullet): 5.5 constructor comment trim`.

**Phase 5 end:** FULL gate.

---

## Phase 6 — `rooms/Room.js` internals

### Step 6.1 — `creditKill(killer, victim, victimKind)`
In the collision pass two mirrored blocks (`objKind === BULLET … other.destroy && other.prize`
and `otherKind === BULLET && obj.prize … obj.destroy`) each do: look up killer by `origin.oId`;
`awardXp(killer, victim.prize, Room.xpSource(victim, kind))`; `coins += coinReward || 0`; if
PLAYER & `!killer.bot` → mess + `unlock('first_blood')`; else if OBJECTS → `registerKill(type)`.
Extract; keep the two call sites and their exact conditions and order (first the `obj`-is-bullet
block, then the `other`-is-bullet block). `Player.collision()`'s PLAYER arm has a *similar*
block (`awardXp(other, prize, 'player'); if (coinReward) other.coins += …; if (!other.bot) …`)
— **not** a copy (`if (this.coinReward)` vs `|| 0`, different source string): leave it.
**Gate:** FAST unchanged. **Commit:** `refactor(room): 6.1 creditKill() replaces mirrored blocks`.

### Step 6.2 — `bulletRecord(obj, mine, color)` in `getBuffer()`
The shared-cache `Bullets` record and the own-bullet record differ only in `states[1]` (0 vs 1)
and `color`. Extract; the two call sites pass `(obj, 0, this.bulletColor(obj))` and `(obj, 1,
this.rules.viewerBullets ? this.ownBulletColor(obj, RAW.main) : this.bulletColor(obj))`. Wire
bytes unchanged. **Gate:** FAST unchanged. **Commit:** `refactor(room): 6.2 bulletRecord()`.

### Step 6.3 — Leaderboard: stable sort replaces the hand-rolled insertion
**Proof (read it):** the insertion loop keeps `this.leader` sorted by `xp` descending, strictly
`<` so an equal-xp newcomer lands **after** existing equals (stable), and holds at most 9
entries (the `length < 9 → push`, else `splice + pop` branches). Entities are visited in
`SlotMap.live()` order (ascending id). That is exactly
`candidates.sort((a, b) => b.xp - a.xp).slice(0, 9)` with a stable sort — guaranteed stable in
Node ≥ 11 (`package.json` requires Node 18+).
**Do:** in `step()`'s insert pass, push qualifying players (`kind === 'players' && !destroy &&
!boss && !dominator`) into a local `lead` array; after the loop over all kinds,
`this.leader = lead.sort((a, b) => b.xp - a.xp).slice(0, 9);`. Delete the 20-line insertion.
**Caveat:** `rooms.js` line ~353 reads `room.leader` after `step()`; getUi encodes it in
`UiUpdate`, which `simDiff` hashes every 6 ticks. If any hash moves, the proof is wrong for
some case — **revert, keep the original**, note in `issues.md`. **Gate:** FAST unchanged.
**Commit:** `refactor(room): 6.3 leaderboard by stable sort`.

### Step 6.4 — Table-driven `generate()`
Seven `///TYPE///` blocks. Preserve the single `RNG` draw and every inner draw's position:
```js
const SPAWN_TABLE = [   // evaluated in this order every generate() pass
	{ type: 'sqr', gate: (r) => r < 1,                   p1: 0.26 },
	{ type: 'tri', gate: (r) => r < towardInstant(0.7),  p1: 0.26 },
	{ type: 'pnt', gate: (r) => r < towardInstant(0.5),  p1: 0.2 },
];
…
const RNG = Math.random();
for (const s of SPAWN_TABLE) {
	if (!s.gate(RNG)) { continue; }
	const obj = this.obj[s.type];
	if (obj[0] < obj.max0) { this.createObj(s.type, 0); obj[0]++; }
	if (obj[1] < obj.max1 && Math.random() < towardInstant(s.p1)) { this.createObj(s.type, 1); obj[1]++; }
}
if (RNG < towardInstant(0.1)) { const obj = this.obj.bull; if (obj[1] < obj.max1) { this.createObj('bull', 0); obj[1]++; } }
for (const [type, gate] of [['Bpnt', RNG > this.rules.betaPentRng], ['Bsqr', RNG > 0.992], ['Btri', RNG > 0.992]]) {
	if (gate) { const obj = this.obj[type]; if (obj[1] < obj.max1) { this.createObj(type, 1); obj[1]++; } }
}
// boss blocks unchanged
```
`towardInstant(0.7)` etc. are evaluated per call exactly as before (pure, same bits). The inner
`&&` order (`obj[1] < obj.max1 && Math.random() …`) is preserved → same RNG consumption.
**Gate:** FAST unchanged (every mode). **Commit:** `refactor(room): 6.4 table-driven generate()`.

**Phase 6 end:** FULL gate.

---

## Phase 7 — Client (`public/client/`)

Oracle: `test/clientDiff.js` (ffa/2team/4team/boss) plus `test/client.js`. Helpers go in
`public/client/util.js` (loaded before `entities.js` and `game.js`; `Palette` and
`General.color` are available there). **Every** step in this phase must leave `clientDiff`
unchanged — none is an expected change.

### Step 7.1 — `makeHpBar({ radiusExtra, quantised })`
Three copies: `User.hpBar` (game.js), `Tank.hpBar`, `Obj.hpBar` (entities.js). Tank and Obj are
byte-identical. User differs in two places: the outer `roundRect` corner radius has `+ .5`, and
the redraw guard is `if (size !== Size || hp !== Hp)` with `Hp = 1` initial (no quantisation).
**Target (util.js):**
```js
/* Off-screen health bar. radiusExtra: User's outer pill radius carries + .5. quantised: Tank/
   Obj repaint only when hp moves by a wire quantum (1/255); User repaints on any change. */
function makeHpBar(opts) {
	const can = document.createElement('CANVAS');
	const ctx = can.getContext('2d');
	const R = CONST.RESOLUTION * CONST.OFFCAN;
	let Hp = opts.quantised ? -1 : 1;
	let Size = 0;
	const lw = 1.5, height = 5;
	can.height = (height + lw * 2 + 4) * R;
	function redraw(hp, size, color) {
		const key = opts.quantised ? Math.round(hp * 255) : hp;
		if (size === Size && key === Hp) { return; }
		if (size !== Size) { can.width = (size + lw * 2 + 4 + height) * R; Size = size; }
		else { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, can.width, can.height); }
		// User's original compared against a `const Hp = 1` it never updated, so it repaints every
		// frame while hp < 1. Only the quantised (Tank/Obj) bars remember the last value.
		if (opts.quantised) { Hp = key; }
		ctx.setTransform(R, 0, 0, R, can.width / 2, 2);
		ctx.beginPath();
		roundRect(ctx, -size / 2 - lw - height / 2, 0, size + lw * 2 + height, height + lw * 2, (height + lw * 2) / 2 + opts.radiusExtra);
		ctx.closePath(); ctx.fillStyle = '#333333'; ctx.fill();
		ctx.beginPath();
		roundRect(ctx, -size / 2 - height / 2, lw, size * hp + height, height, height / 2);
		ctx.closePath(); ctx.fillStyle = color; ctx.fill();
	}
	return { can, redraw };
}
```
**Equivalence checks:** User's original `drawHp` compares `hp !== Hp` against `const Hp = 1`
— a `const` it never updates — so User's bar **repaints every frame while hp < 1 and never
while hp === 1 unless size changed**. The `if (opts.quantised) { Hp = key; }` line above keeps
exactly that: with `quantised: false`, `Hp` stays 1 forever. Tank/Obj's originals start at
`Hp = -1` and store the quantised value — also preserved. User passes `(height + lw*2)/2 + .5`
→ `radiusExtra: .5`; Tank/Obj → `radiusExtra: 0` (adding `+ 0` to a finite double is
bit-identical). The op sequence to the stub canvas must match exactly — `clientDiff` is the check.
**Do:** `User.hpBar = makeHpBar({ radiusExtra: .5, quantised: false })`;
`this.hpBar = makeHpBar({ radiusExtra: 0, quantised: true })` in Tank and Obj.
**Gate:** FAST, `clientDiff` unchanged. **Commit:** `refactor(client): 7.1 makeHpBar() replaces three factories`.

### Step 7.2 — `flashHit(ent, firstMs, secondMs)`
User `(50, 16)`, Obj `(50, 16)`, Tank `(33, 33)`; body otherwise identical (`hitted = 2; await
sleep(a); hitted = 1; await sleep(b); hitted = 0`, guarded on `!hitted`). Extract an async
function in util.js; each class's `hit()` becomes `return flashHit(this, 50, 16)` etc.
**Gate:** FAST, `clientDiff` unchanged. **Commit:** `refactor(client): 7.2 flashHit()`.

### Step 7.3 — `stepRecoil(recoil)` and `stepShieldFlash(ent)`
Both loops are byte-identical between `User.update()` and `Tank.update()`. Extract to util.js
(`stepShieldFlash` reads `Palette` and `General.color.shade` — both available in util.js;
`General` is defined in that file, so place the helper *after* `const General = {}` and
`General.color`). **Gate:** FAST, `clientDiff` unchanged. **Commit:**
`refactor(client): 7.3 stepRecoil()/stepShieldFlash()`.

### Step 7.4 — `lerpAngles(dst, src, k)` for the `canDdir` loops
After 1.5 (`Physics.lerpAngle`), the two identical `canDir`→`canDdir` loops (`User.update`,
`Tank.update`) become `if (this.canDir.length === this.canDdir.length) lerpAngles(this.canDdir,
this.canDir, k); else this.canDdir = this.canDir;` — keep the `else` branch exactly (it aliases
the array; do not copy). **Gate:** FAST, `clientDiff` unchanged. **Commit:**
`refactor(client): 7.4 lerpAngles() for turret aim smoothing`.

### Step 7.5 — `blitSprite(ctx, can)` in `User.draw`/`Tank.draw`
Both do `const w = can.width / CONST.OFFCAN, h = can.height / CONST.OFFCAN; ctx.drawImage(can,
-w/2, -h/2, w, h)` guarded on a non-empty canvas (`can.width > 0 && can.height > 0` vs
`!can || !can.width || !can.height` → same truth table for a canvas). Extract; `Bullet.draw` has
the same two lines → use it there too. **Gate:** FAST, `clientDiff` unchanged. **Commit:**
`refactor(client): 7.5 blitSprite()`.

### Step 7.6 — (optional) `ui.js` off-screen panel factories
`ui.js` has 14 `document.createElement('CANVAS')` bakes with similar
create/size/setTransform/draw shapes. Only attempt if Steps 7.1–7.5 went cleanly and the
`clientDiff` corpus exercises the panel (leaderboard, upgrades, messages, dev console and chat
are exercised; the class picker and death screen are not → **do not touch `TNK`/`END`/`LOBBY`**
— there is no oracle for them). **Gate:** FAST unchanged. Skip entirely if in doubt.

**Phase 7 end:** FULL gate.

---

## Phase 8 — OPTIONAL, gated: tank-drone / base-drone orbit unification

**Gate to even start:** the owner has decided to **keep** the current tank-drone idle orbit
(i.e. `issues.md` R3's restCycle port is *not* going to happen). If that is undecided, skip
this phase and leave the note in `issues.md`.

What is duplicated (geometry only; the state machines genuinely differ):
- `planSwitchArc(drone, r1)` (base, fields `switchP0x…switchA1y`, `switchDur`, `switchT`) and
  `planTankSwitchArc(bullet, play, r1, vOrbit)` (fields `orbSP0x…orbSA1y`, `orbSwitchDur`,
  `orbSwitchT`). Same quintic set-up; base uses `BASE_DRONE_ORBIT_SPEED` and
  `config.BASE_DRONE_LEVEL_GAP`, tank uses `vOrbit` and `tankGap(bullet)`; base's entry
  acceleration is `vec - pvec`, tank's is the centripetal `spd²/r0` — **that is a real
  difference, not a copy**.
- `planCross(drone)` vs `planTankCross(bullet, play, vOrbit, vCross)`: both call
  `crossPolyline()` + `crossSolvePeak()` then walk the same RK2 table loop; base additionally
  records `crossSegs/crossLin/crossLout/crossTicks` (read by tests) and uses the room's
  `levelR(1)`.
- The two `quinticHermite` *evaluation* blocks (base `switching`, tank `orbSwitching`).

If the gate is passed: extract (a) `buildCrossTable(poly, solve, vOrbit)` returning the table,
used by both planners (the base planner keeps computing its diagnostic fields from the same
locals); (b) `evalSwitchArc(seg, s)` taking a `{P0x…A1y, dur}` record — and **store the
record under the existing field names** by making `seg` a view object built from the drone's
fields, not by renaming them (R3 freezes `switch*` and `orb*` names). Every step here is
hash-neutral or it is wrong; the `baseDroneAiTests` block (≈2200 checks) is the second
oracle. Do not touch `orbitDesired()`, `levelSwitch()`, `crossPolyline()`, `blendShape()`,
`pathAt()`, `crossVAt()`, `crossDurOf()`, `crossSolvePeak()` — they are already single
definitions.

---

## Phase 9 — Comment diet and documentation

### Step 9.1 — Comment sweep (R7), file by file
Target ≤ 15 % comment lines in `entities/*.js`, `lib/gameAI.js`; ≤ 50 % in `lib/config.js`,
`lib/tick.js`, `lib/constants.js` (those are mostly units/invariants and may stay heavier).
Delete: history ("was X", "WP8", "R2", "C1"), pointers to markdown files, paragraph-length
justifications of a constant where one line states the invariant, comments that restate the
next line. Keep: units, "do not merge these", ordering requirements, the `tick.js` category
notes, RNG-order notes, anything that says *why a number is what it is* in one line. **One
commit per file.** Comments only — `simDiff` and `clientDiff` must not move; if they do you
deleted code. **Gate:** FAST per file.

### Step 9.2 — Documentation
- `HANDOFF.md`: file map rows for `lib/geom.js`, `test/simDiff.js`; the rooms rows; §3 "Read
  this before you touch anything" gets one new bullet: "**`test/simDiff.js` and
  `test/clientDiff.js` are bit-exact goldens.** They move on RNG-order or float-order changes,
  not only on behaviour changes — a refactor must keep both; a tuning change re-pins only the
  modes it touches, with the reason in the commit."
- `issues.md`: delete the "Game complexity" item; add "Phase 8 orbit unification — gated on the
  R3 decision" under Open; keep the `## Found during refactor` list if any entries were added.
- `PENDING.md` "Tooling notes": update the clientDiff golden mention to the current one.
- `README.md`: no change needed unless `npm test` output changed.

### Step 9.3 — Final FULL gate and summary
Run `npm test` and `npm run lint`. Record the final line counts next to the baseline
(`git diff --stat 7d75d66..HEAD -- lib entities rooms net public/client public/SHARE/Physics.js`).

---

## Appendix A — Frozen identifiers (read by tests or the wire)

**Room instance:** `rules` (every key, incl. `teams`, `teamPlay`, `maxBoss`, `bossHp`,
`bossTeam`, `neutralTeam`, `botCount`, `botIdStart`, `xpMul`, `respawnPow`, `invisFloor`,
`viewerBullets`, `crasherDensity`, `baseSizeRatio`, `arenaLive`, `shapeMix`, `maxXp`,
`mapSize`, `maxPlayer`), `INSTANCE.{players,objs,bullets,detectors,walls}`, `XPLVL`, `map`,
`newMap`, `baseSize`, `nestScale`, `obj.{sqr,tri,pnt,Bpnt,Bsqr,Btri,bull}`, `leader`,
`bosses`, `dominators`, `motherships`, `closers`, `closing`, `state`, `ticksUntilStart`,
`playersNeeded`, `dronePosts`, `droneCentres`, `timestamp`, `wallDots`, `gm`, `id`,
`BUFFER`, `mazeGenerator` (Maze), `tagged` (Tag), `shrinkIn` (Tag), `closeIn` (Maze),
`testBosses`/`tester_mothership`/`tester_closer`/`closerOn` (Tester), `gatherTicks`/
`scorePerTick` (Survival).
**Room methods called by tests:** `ask`, `Init`, `step`, `respawn`, `respawnXp`, `respawnTeam`,
`spawnPoint`, `rejectSample`, `clearOfWalls`, `clearOfShapes`, `createBoss`,
`createDominator`, `createBullet`, `awardXp`, `getBuffer`, `getUi`, `leaderRows`,
`entityColor`, `bulletColor`, `ownBulletColor`, `mapDotColor`, `allowsRespawn`,
`inputsFrozen`, `contenderCount`, `togglePossession`, `releasePossession`, `levelR`,
`levelPlan`, `levelTargets`, `postDrone`, `tickBaseDrones`, `tickDroneCentres`,
`rotateScout`, `sortDroneCentre`, `spawnBaseDrone`, `basePosts`, `botRoster`, `botBudget`,
`inEnemyBase`, `inArena`, `tickArena`, `winner`/`startClosing`/`tagging`/`teamCounts` (Tag),
`buildWalls` (Maze), `createMothership` (Mothership), `manageCountdown`/`aliveContenders`/
`scatterContenders`/`padOneBot`/`updateSurvivalState` (Survival).
**Player fields:** everything in the constructor, plus `bot`, `boss`, `closer`, `dominator`,
`mothership`, `fallen`, `detected`, `patrolTarget`, `domIdle`, `lastAttacker`, `path`,
`botMod`, `running`, `spin`, `shieldFaced`, `levelUpHold`, `oldXp`, `prize`, `necro`,
`lastBullet`, `extraView`.
**Bullet fields:** everything in the constructor, plus every base-drone and `orb*` field
listed in R3, `DETEC`, `comingDir`, `first`, `sub`, `subTimer`, `weapon`, `weaponTimer`,
`post`, `ox`, `oy`, `level`, `levels`, `spin`, `alone`, `levelReleased`, `necro`, `closer`,
`drawType`, `drawColor`, `pet`, `pos`, `delay`.
**Statics:** see R3.

## Appendix B — "Looks equal, is not" table

| Pair | Why they differ |
|---|---|
| `Math.hypot(a, b)` vs `Math.sqrt(a*a + b*b)` vs `Math.sqrt(Math.pow(a,2) + Math.pow(b,2))` | different rounding paths; the tree uses all three — never swap one for another |
| `Math.PI + Math.atan2(a, b)` vs `Math.atan2(-a, -b)` | same angle, different bits (Step 5.3 is the one place this is accepted) |
| `x * k * m` vs `x * (k * m)` | re-association |
| `a / b / c` vs `a / (b * c)` | re-association |
| `tick.perTick(x) * 2` vs `tick.perTick(x * 2)` | `(x*S)*2` vs `(x*2)*S` — equal only by luck |
| `new Vec(e, e)` where `e` is written twice vs once | identical if `e` is pure; not if `e` draws RNG or has side effects |
| `for (const i in this.up)` index walk vs `UP_KEYS[data]` | identical only because `UP_KEYS` is the literal's own key order |
| `if (a) {…} if (b) {…}` vs `if (a) {…} else if (b) {…}` | identical only when `a && b` is impossible (the clamp: `x < -h` and `x > h`) |
| `Array.prototype.sort` vs hand insertion | identical only with a stable sort and a proven tie rule (Step 6.3) |
| `Math.floor(Math.random() * 1)` vs `0` | consumes an RNG draw — never add it |

## Appendix C — Per-step checklist (copy into each commit body)

```
[ ] read the step's "exact differences" table before editing
[ ] no new/removed/reordered Math.random()
[ ] every moved expression is the same tokens in the same order
[ ] no frozen identifier renamed (Appendix A)
[ ] node test/simDiff.js      -> all 11 modes match        (or only the listed EXPECTED mode moved, re-pinned in this commit)
[ ] node test/clientDiff.js   -> matches golden
[ ] node test/rooms.js        -> 851 passed, 0 failed
[ ] eslint .                  -> clean
[ ] hook table / HANDOFF updated if a hook or file was added
[ ] accepted divergences (if any) written in this commit body AND in issues.md "Found during refactor"
```

## Appendix D — Expected line reduction (rough, for sanity, not a target)

| Area | Before (code lines) | After (estimate) |
|---|---|---|
| `rooms/*` excl. `Room.js` | ~1,200 | ~750 |
| `rooms/Room.js` | ~1,380 | ~1,300 (gains hooks, loses dup blocks) |
| `lib/gameAI.js` | ~700 | ~560 |
| `entities/Player.js` | ~800 | ~700 |
| `entities/Bullet.js` | ~1,150 | ~1,000 (orbit untouched) |
| `entities/Objects.js` | ~320 | ~300 |
| `public/client/{game,entities}.js` | ~1,200 | ~1,050 |
| comments (Phase 9) | ~2,950 | ~1,600 |

If a step removes *more* than its estimate, re-check that nothing with a different behaviour
was folded in.
