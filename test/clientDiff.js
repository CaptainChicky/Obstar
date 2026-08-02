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
// Rebaselined for plan.md execution-order steps 8-10 (C10-C13, C8/C9, E2/E3/E4): the only op-
// count-affecting change in this batch is C12's Crasher population fix - `room.obj.bull.max1`
// is now derived from the shared SHAPE_DENSITY_GU2 formula (crasherTotal()) instead of a fixed
// literal 39, so ffa/2team/4team/boss all spawn a different number of Crashers under this
// suite's own seeded RNG, shifting every draw call downstream of that in the same run (fewer
// ops overall: the derived cap is lower than 39 at these arena sizes). Every other change in
// this batch (Dominator dompronounced/aim fixes, Mothership drone control/possession, C13's
// wall culling/colour/minimap, C8's invisibility rates, C9's Predator zoom) either touches no
// rendering path at all or never engages for the classes/entities this suite's own bot rolls
// happen to hit.
// Rebaselined again for plan.md execution-order steps 11-12 (Part D boss fidelity + C14/C15):
// Fallen Overlord/Fallen Booster now draw a real circular body (shape 0) instead of the
// rounded-rect stand-in (a different Drawings.body[] path, different op count/shapes entirely);
// every boss now draws in its own real diep colour (Guardian/Defender/Summoner/both Fallen
// bosses each get a distinct fillStyle/strokeStyle instead of one shared team-9 gold) whenever
// this suite's own seeded RNG happens to spawn one in 'boss'/'2team'/'4team'; and Summoner's own
// client cannon geometry (height 44->31.5, width 20->16.66, converging onto the real
// SummonerSpawnerDefinition alongside the server side) redraws its barrels at different
// dimensions. C14/C15 (shape regen, spawn-shield duration) are both server-only timing/state
// changes with no new canvas call shape of their own, so they contribute no op-count delta on
// their own - the whole count/hash move here is boss rendering.
const GOLDEN = { count: 311491, hash: 'fe15ff99' };

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
