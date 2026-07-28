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
//
// Rebuilt again for plan.md WP4.5.1/2/3: the chase/return dash is pinned to the fastest tank this
// game can build (400 u/s, up from a level-0 tank's 285) with its own tighter turn limiter; the
// diameter cross is rebuilt as arc -> C2 blend -> exact straight at constant speed -> C2 blend ->
// arc, precomputed into a per-tick table, replacing the four-segment 8/84/8 curve (the blend
// fraction went 0.08 -> 0.20 and the lead 0.08 -> 0.05, so both the shape and its duration moved);
// and a reactive level switch can no longer be vetoed by a saturated ring, so drones peel off
// shapes far more often than they used to. Every base drone's path is different again, hence the
// op-count move (down this time). Confirmed intentional.
//
// Rebuilt again for plan.md WP4.5's accelerate-into-the-centre/binomial-sorter/scout pass: the
// swoosh's speed profile is one continuous ramp up to the orbit centre and down from it now (not a
// constant-speed straight), the C2 blends are ~2x longer (BLEND_FRAC 0.20->0.70, now a fraction of
// each end's own radius; LEAD 0.05->0.125), a per-centre binomial sorter now nudges idle drones
// toward BASE_DRONE_LEVEL_WEIGHTS every second instead of only a general drift-home timer, and
// detection is now one scout per centre on a rotation instead of every drone querying every tick.
// Every base drone's path is different again. Confirmed intentional.
//
// Rebuilt again for plan.md WP4.5.8: the minimap frame's stroke used to be drawn BEFORE the
// clip'd background/team fills, so the fill painted straight over the stroke's inner half,
// leaving only ~6 of the 12-unit lineWidth actually visible (invisible in practice at the 0.25
// blit alpha) - regressed in Firefox, silently fine in Chrome. Fixed by clipping only around the
// fill (a local save/restore) and stroking the same path, unclipped and full-width, after it, in
// all three gamemode arms. Confirmed intentional - op count moves by +8 (2 save + 2 restore calls
// added per team-mode room, ffa/boss unaffected).
//
// Rebuilt again for the current plan.md WP4.5 (the plateau swoosh/chase-bug/minimap/broad-phase
// pass - this text replaces the WP4.5 plan section quoted by the two entries above, which is now
// superseded, though the op-count history they explain still applies): the minimap's lineWidth
// halves again (12 -> 6, WP4.5.3 - this pass's own fix, distinct from the fill/stroke reorder
// above which is what made 12 units visible in the first place); crossVAt's speed profile is a
// plateau now, not a single-point peak (WP4.5.1), which moves every drone's per-tick position
// during a cross; entities/Bullet.js's clampToMap() and the chase-drop test both changed
// (WP4.5.2A), and rooms/Room.js's tickDroneCentres() now expires a stale threat (WP4.5.2B) -
// between them, chasing/returning drones near a map edge take a different path than before; and
// the collision pass now walks qt.queryCircle() instead of qt.query(closure,...) with a rewritten
// insert() (WP4.5.4) - the SET of candidate pairs is unchanged (queryCircle is tested directly
// against a brute-force scan) but visitation ORDER is not, which is enough to shift which
// tie-break/Math.random() call fires on which tick for any entity whose path depends on one.
// Every base drone's path is different again, and the op count moves up (from more drones actually
// reaching and sliding along map edges instead of freezing there). Confirmed intentional.
const GOLDEN = { count: 286153, hash: '9f007a58' };

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
