/*
	The canvas-call differential: a self-differential over the client's own render output.

	The full ordered canvas-op stream of the current client is pinned as a golden hash below, so
	any edit that changes what reaches the canvas changes the hash and fails. That makes it a
	guard for changes that are meant to be behaviour-preserving (idiom sweeps, refactors), not a
	correctness check - a deliberate visual change is expected to fail it and be rebaselined.

	Deterministic by construction: test/clientDom.js seeds Math.random and Date.now
	(opts.deterministic), performance.now is a frame counter, and the packet corpus is a real room
	stepped under a seeded RNG plus a fixed set of hand-built UI packets. Same inputs, same ops,
	every run and every machine.

	After an INTENTIONAL behaviour change, rebuild the golden and paste it into GOLDEN below:

		node test/clientDiff.js
		OBSTAR_DIFF_CAPTURE=1 node test/clientDiff.js    # print the current hash, don't assert
*/
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');

// Seed the MAIN process RNG before the room is built, so its spawns - and therefore every
// GameUpdate byte the client draws from - are identical on every run.
(function seedGlobalRandom() {
	let s = 0x12345678 >>> 0;
	Math.random = function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
})();

const boot = require('./clientDom.js');
const PROTO = require(path.join(ROOT, 'public', 'SHARE', 'SocketSchema.js'));

const TICK = 30, FPP = 2, FRAME = TICK / FPP;   // match test/client.js: frame clock tracks packets

// A fixed set of non-GameUpdate packets, so ui.js's leaderboard, messages, upgrade buttons,
// dev console and chat log are exercised too - not just the entity render path.
function uiPackets() {
	return [
		PROTO.encode('UiUpdate', {
			leader: [{ xp: 5000, name: 'Alpha', nameC: 0, team: 0 }, { xp: 3200, name: 'Bravo', nameC: 1, team: 1 }],
			map: [1, 2, 3], mess: ['a joined', 'b was destroyed']
		}),
		PROTO.encode('UpdateUp', [1, 2, 0, 3, 0, 1, 2, 0]),
		PROTO.encode('comResponse', ['line one', 'line two']),
		PROTO.encode('chatUpdate', [['author', 'hello there'], ['bob', 'hi']])
	];
}

// Drive one client through a real room's own GameUpdates, interleaving the UI packets, and
// return the ordered canvas-op stream it produced.
function runMode(gm) {
	const room = controller.newServer(gm);
	room.ask({ name: 'tester', key: '0'.repeat(25), pet: -1, gm: gm });
	room.Init();
	for (let i = 0; i < 20; i++) { room.step(); }

	const app = boot({ key: '0'.repeat(25), gm: gm, name: 'tester', pet: -1, ws: '' },
		{ recordOps: true, deterministic: true });
	app.start(PROTO.encode('GameUpdate', room.getBuffer(0)));

	const ui = uiPackets();
	for (let p = 0; p < 40; p++) {
		room.step();
		const buff = room.getBuffer(0);
		if (buff) { app.deliver(PROTO.encode('GameUpdate', buff)); }
		if (p % 8 === 3) { for (const u of ui) { app.deliver(u); } }   // fold the UI packets in periodically
		for (let f = 0; f < FPP; f++) { app.frame(FRAME); }
	}
	return app.record.ops;
}

function fnv1a(str) {
	let h = 0x811c9dc5 >>> 0;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return ('0000000' + h.toString(16)).slice(-8);
}

const controller = require(path.join(ROOT, 'lib', 'boot.js'))();

let ops = [];
for (const gm of ['ffa', '2team', '4team', 'boss']) {
	ops = ops.concat(['=== ' + gm + ' ==='], runMode(gm));
}
const blob = ops.join('\n');
const hash = fnv1a(blob);

// The pinned baseline of the current tree. Rebuild only after an intentional behaviour change.
// Rebaselined for the issues.md batch. Every entry below changes what actually reaches the
// canvas, deliberately:
//   * Instances' key order now draws Walls between the shapes and the tanks/bullets, so a
//     projectile's death animation lands ON TOP of the wall that stopped it - that reorders the
//     entire per-frame op stream in any mode with walls, and reorders nothing else.
//   * every round bullet's outline STRADDLES its radius now (arc at size +- LINEWIDTH/2) the way
//     a tank body's always has, instead of being drawn inward - different arc radii on every
//     bullet in every mode, which is the whole "bullets are undersized" fix.
//   * a GuardObject (Smasher/Landmine/Spike hexes and triangles, the three Dominators' base hex)
//     is filled Color.Border #555555 and STROKED #404040 instead of filled in the owner's dark
//     team colour - a new stroke call per guard, and a bigger radius (measured off the tank's
//     outline rather than its bare body radius).
//   * a trap launcher sits entirely past its barrel's tip now rather than centred on it, so every
//     trapper barrel's four launcher vertices move.
//   * the three Dominators' barrels draw UNDER the body instead of over it (a pass reorder).
//   * Guardian's body/barrel/drone geometry is re-derived (bossSize 75.6 -> 37.8, barrel 25.93 ->
//     51.85, drone radius 5.44 -> 11.76), and a boss's projectiles now carry the boss's own
//     colour instead of team 9's gold - both visible whenever this suite's seeded RNG spawns one.
//   * setCoord()'s mX/mY is 0 for a class with no cannons/turrets, which moves where the class
//     picker blits Smasher/Landmine/Spike.
//   * a bullet's muzzle kick lands one tick later (diep's spawnTick+1) and a dying projectile
//     halves its speed each tick, so every projectile position downstream differs slightly.
//   * a boss travels at diep's own movementSpeed now (lib/gameAI.js's BOSS_ACCEL, replacing a
//     tuned constant fed through a position step carrying a stray /10), so any boss this suite's
//     seeded RNG spawns is somewhere else on every frame after its first.
//
// Rebaselined again for the second issues.md batch. The op COUNT drops ~18% this time, which is
// itself the headline change and not a bug: diep's same-team collision filter (rooms/Room.js's
// teamPassThrough()) now skips whole pairs that used to resolve, so a great many same-team
// projectiles survive contacts that previously destroyed them or shoved them off course, and
// every downstream position/spawn in this seeded corpus moves with them. The rest:
//   * the `back` (recoil) column is uniformly /2.5 - it had been written as diep's raw
//     `barrel.recoil x 2.8` when the identity is `gu_value x 2.8` and gu_value = recoil x 0.4,
//     so every tank's own post-shot drift changes (see TanksConfig.js's `back` header).
//   * an ARMING trap is no longer inert to enemies, so trap classes land damage several ticks
//     earlier than they did.
//   * Tri-Trapper's three barrels fire together (diep id35 delay 0) instead of thirded.
//   * an Arena Closer and an uncaptured Dominator draw in Color.Neutral #FFE869 instead of
//     team 9's `necro` beige, and a Closer now sits on the arena's own team.
//
// Rebaselined again for the third issues.md batch. The op COUNT is unchanged (281738) this time -
// every entry is a coordinate change, nothing draws more or fewer shapes:
//   * render.js's setCoord() is rewritten to measure the sprite's real extent instead of a
//     per-barrel triangle-inequality bound. It knows about `trapLauncher` now, so every trapper's
//     arrowhead stopped being clipped at the offscreen canvas edge (the sprite cache grows 29-52
//     reference units across the Trapper/Tri-Trapper/Mega Trapper/Gunner Trapper/Overtrapper/
//     Defender/Guardian/Summoner line), and it owes the stroke LINEWIDTH/2 rather than a whole
//     LINEWIDTH, which shrinks every other class's cache by 4. A sprite canvas's size is a
//     drawImage argument, so all of that reaches the op stream.
//   * Necromancer's decorative barrels are 49 -> 61.25 long, by request.
const GOLDEN = { count: 281738, hash: '3e2fc0d8' };

console.log('canvas-call differential');
console.log('  ops:  ' + ops.length);
console.log('  hash: ' + hash);

if (process.env.OBSTAR_DIFF_CAPTURE) {
	// Dump the full stream so a diff can be localised when the hash moves unexpectedly.
	const out = path.join(require('os').tmpdir(), 'obstar-diff-ops.txt');
	fs.writeFileSync(out, blob);
	console.log('  captured -> ' + out);
	console.log('  paste into GOLDEN: { count: ' + ops.length + ", hash: '" + hash + "' }");
	process.exit(0);
}

const ok = ops.length === GOLDEN.count && hash === GOLDEN.hash;
if (ok) {
	console.log('  ok   matches golden (' + GOLDEN.count + ' ops / ' + GOLDEN.hash + ')');
	process.exit(0);
} else {
	console.log('  FAIL differs from golden: expected ' + GOLDEN.count + '/' + GOLDEN.hash +
		', got ' + ops.length + '/' + hash);
	console.log('       if intentional, re-run with OBSTAR_DIFF_CAPTURE=1 and update GOLDEN.');
	process.exit(1);
}
