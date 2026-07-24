/*
	The canvas-call differential, rebuilt (HANDOFF §6, §12.2).

	The original differential replayed captured packets through the pre-split monolith
	(public/new2Init.js) AND the new public/client/ files and asserted their canvas-op streams
	were byte-identical - 180298 operations, zero differences. That proved the *split* changed
	no behaviour. It cannot guard work done *after* the split, for two reasons: the monolith is
	deleted, and it has since diverged from the client on purpose - motion was rewritten to
	snapshot interpolation (§6.1), strict-mode fixes landed (§8.12), and §12.1 removed dead code.
	So the monolith is no longer a zero-diff reference for today's tree.

	What guards a *behaviour-preserving* change to the client now - the §12.2 idiom sweep
	(var->let/const, ==->===, for..in) - is a SELF-differential: the full ordered canvas-op
	stream of the current client is pinned as a golden hash here; any edit that changes what
	reaches the canvas changes the hash and fails. It is deterministic by construction -
	test/clientDom.js seeds Math.random and Date.now (opts.deterministic), performance.now is
	already a frame counter, and the packet corpus is a real room stepped under a seeded RNG plus
	a fixed set of hand-built UI packets. Same inputs, same ops, every run and every machine.

	Rebuild the golden after an INTENTIONAL behaviour change (e.g. §12.3, which reorders
	iteration): run with OBSTAR_DIFF_CAPTURE=1, paste the printed hash into GOLDEN below.

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
	const RT = require(path.join(ROOT, 'lib', 'runtime.js'));
	const room = RT.Controller.newServer(gm);
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

require(path.join(ROOT, 'lib', 'boot.js'))();

let ops = [];
for (const gm of ['ffa', '2team', '4team', 'boss']) {
	ops = ops.concat(['=== ' + gm + ' ==='], runMode(gm));
}
const blob = ops.join('\n');
const hash = fnv1a(blob);

// The pinned baseline of the current tree. Rebuild only after an intentional behaviour change.
//
// Rebaselined for PENDING #14 (Instances sparse-array -> SlotMap, Number14PLAN.md): the old
// per-tick tombstone countdown in Room.js's step() was dead code (`let i = INSTANCE[kind][j];
// i--` decremented a local copy, never writing back to the array), so an objs/bullets tombstone
// was in practice only ever freed by createObj/createBullet's allocation scan stepping over it,
// not by wall-clock ticks. SlotMap.tick() actually decrements every tick, which is real, working
// KEEP_PLACE expiry - the one intended, documented behaviour change in that plan. Verified by
// isolation: reverting SlotMap to bug-for-bug replicate the old scan-only decrement reproduces
// the previous golden (247353/c4eb110d) exactly, confirming this is the sole source of the diff.
const GOLDEN = { count: 247353, hash: 'de9eb1a1' };

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
