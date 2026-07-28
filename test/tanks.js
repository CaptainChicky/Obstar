/*
	Cross-checks the two hand-synced halves of public/SHARE/TanksConfig.js.

	The file holds two independent tables for the same 44 tank classes, picked by a
	`platform === 'client'` ternary: the ///CLIENTS/// half (`cannons[i].height/width/offx/
	offdir/open`) is what gets drawn (public/client/drawings.js), the ///SERVER/// half
	(`cannons[i].canonLength/offx/offdir/...`) is where bullets spawn (entities/Player.js:212).
	They are paired by array index and nothing had ever compared them before this test existed.
	The Sprayer bug this test caught is exactly the failure mode it's built for: the two length
	lists are the same multiset, just rotated by one, so a same-set-different-order check is
	load-bearing, not a naive equality would miss it.

		node test/tanks.js        (npm test runs this right after test/proto.js)
*/
const path = require('path');
const ROOT = path.join(__dirname, '..');

const client = require(path.join(__dirname, 'clientTanks.js'))();
const server = require(path.join(ROOT, 'public', 'SHARE', 'TanksConfig.js'));

let passed = 0, failed = 0;
function check(name, ok, detail) {
	if (ok) {
		passed++;
		console.log('  ok   ' + name);
	} else {
		failed++;
		console.log('  FAIL ' + name + (detail !== undefined ? '  (' + detail + ')' : ''));
	}
}

/*
	Known-accepted client/server deviations, keyed by class name + cannon index + which
	assertion it excuses. Every entry needs a `reason` - an empty-by-default whitelist that grows
	silently is the failure mode this test exists to prevent, so its size is printed below rather
	than swallowed.

	`kind` is one of:
	  'count'  - the class's cannon counts don't reconcile even after the turret shift
	  'geom'   - an offdir/offx/length mismatch at cannon index `i`
	  'order'  - the class's two length lists are equal as sets but not as sequences
*/
const WHITELIST = [
	{ class: 'Ranger', index: 'count', kind: 'count', reason:
		"cannon 1 (height 45, width 60, open -30) is a decorative shield/guard shape that " +
		"reuses the cannon drawer - the server has nothing to spawn from it, same pattern as " +
		"Necromancer below." },
	{ class: 'Necromancer', index: 'count', kind: 'count', reason:
		"its two cannons are decorative only; Necromancer attacks through the this.necro " +
		"summon mechanic in Player.js, not canonLength cannons, so the server has none." },
	...['pre launch', 'testbed', 'bigView', 'shapes', 'shape1', 'shape2'].map(name => ({
		class: name, index: 'count', kind: 'count', reason:
			"dev/debug placeholder class - its one cannon entry has `hidden: 1` " +
			"(drawings.js never draws it) and it can't be selected to shoot, so the server " +
			"correspondingly has no cannons."
	})),
	// Twin / Twin Flank / Triple Twin's offx swap and Fortress[5]/Summoner[3]'s angle-
	// representation false positives were whitelisted here once (plan.md WP-CANNON, PENDING #26)
	// - both fixed and removed. Twin Flank/Triple Twin's was a real bug (the client's offx sign
	// was mirrored against the server's, so the recoil bitfield animated the wrong barrel); the
	// angle false positives are gone now that offdir is compared with sameAngle() below instead
	// of a literal !==.
	...[0, 1, 2, 3].map(i => ({
		class: 'Summoner', index: i, kind: 'geom', reason:
			"height 44 vs canonLength 50 (gap -2.50): every other class in the table has the " +
			"drawn barrel a little *longer* than the spawn radius (band 0-12) so bullets appear " +
			"at the tip; Summoner is the one class where it runs the other way, drawn shorter " +
			"than the spawn point. canonLength: 50 is a floor (a boss's body radius is 64 - " +
			"rooms/Room.js - and shortening it spawns drones inside their own boss), so closing " +
			"the gap means growing the drawn barrel instead, a visible silhouette change on a " +
			"boss - a human balance call, not a mechanical sync. Left deliberately unfixed " +
			"(PENDING.md); flagged there as a pattern to re-check for any future boss class too, " +
			"not just this one."
	})),
];
/* Marks a WHITELIST entry as having actually excused something this run, so the size pin below
	 can't hide a mismatch by whitelisting more than is needed. */
const consumed = new Set();
function findEntry(className, index, kind) {
	return WHITELIST.find(w => w.class === className && w.index === index && w.kind === kind);
}
function whitelisted(className, index, kind) {
	const entry = findEntry(className, index, kind);
	if (entry) { consumed.add(entry); }
	return !!entry;
}
console.log('tanks whitelist: ' + WHITELIST.length + ' entries\n');
check('the whitelist has not grown', WHITELIST.length === 12, WHITELIST.length);

/* offdir is an angle: -PI/2 and 3*PI/2 are the same barrel, and two float64 expressions for the
	 same rotation (Fortress[5]) differ by an ULP. A literal !== calls both a mismatch and used to
	 need a whitelist entry a correct comparison doesn't (PENDING #26, plan.md WP-CANNON). */
const TAU = Math.PI * 2;
function sameAngle(a, b) {
	let d = (a - b) % TAU;
	if (d > Math.PI) { d -= TAU; }
	if (d < -Math.PI) { d += TAU; }
	return Math.abs(d) <= 1e-9;
}

/* Every cannon's drawn tip length is deliberately a little past the spawn radius, so bullets
	 appear at the muzzle rather than short of it. The measured median gap across the table is
	 4.2 units; this is a band, not an equality, since the exact numbers vary per class. */
const GAP_MIN = 0, GAP_MAX = 12;

function classSet() {
	console.log('class set:');
	const clientNames = Object.keys(client.class);
	const serverNames = Object.keys(server.class);
	const clientSet = new Set(clientNames), serverSet = new Set(serverNames);
	const missingFromServer = clientNames.filter(n => !serverSet.has(n));
	const missingFromClient = serverNames.filter(n => !clientSet.has(n));
	check('every client class has a server counterpart', missingFromServer.length === 0,
		missingFromServer.join(', '));
	check('every server class has a client counterpart', missingFromClient.length === 0,
		missingFromClient.join(', '));

	const listMissingClient = client.list.filter(n => !clientSet.has(n));
	const listMissingServer = server.list.filter(n => !serverSet.has(n));
	check('exports.list is a subset of the client class table', listMissingClient.length === 0,
		listMissingClient.join(', '));
	check('exports.list is a subset of the server class table', listMissingServer.length === 0,
		listMissingServer.join(', '));

	return client.list.filter(n => clientSet.has(n) && serverSet.has(n));
}

/*
	Turret-shift relationship: the client keeps auto-turrets in a separate `turrets` array
	while the server appends them to `cannons`, and public/client/drawings.js compensates by
	index-shifting (`i = config.turrets ? parseInt(i) + config.turrets.length : i`). So the
	server's array is the client's `turrets` followed by its `cannons`, and the comparison
	below walks the server array starting after the turret count.
*/
function cannonCounts(names) {
	console.log('\ncannon counts (client cannons + turrets vs server cannons):');
	for (const name of names) {
		const c = client.class[name], s = server.class[name];
		const turretN = c.turrets ? c.turrets.length : 0;
		const want = c.cannons.length + turretN;
		const got = s.cannons.length;
		if (want !== got && whitelisted(name, 'count', 'count')) {
			continue;
		}
		check(name + ': ' + c.cannons.length + ' cannon(s)' + (turretN ? ' + ' + turretN + ' turret(s)' : '') +
			' = ' + want + ' vs server ' + got, want === got, want + ' vs ' + got);
	}
}

/* Per-class list of [client cannon index, server cannon index] pairs, server index shifted
	 past the class's turrets. */
function pairs(name) {
	const c = client.class[name], s = server.class[name];
	const turretN = c.turrets ? c.turrets.length : 0;
	const n = Math.min(c.cannons.length, s.cannons.length - turretN);
	const out = [];
	for (let i = 0; i < n; i++) {
		out.push([c.cannons[i], s.cannons[turretN + i], i]);
	}
	return out;
}

function geometry(names) {
	console.log('\nbarrel geometry, index by index:');
	for (const name of names) {
		for (const [cc, sc, i] of pairs(name)) {
			const offdirOk = sameAngle(cc.offdir, sc.offdir);
			const offxOk = cc.offx === sc.offx;
			const gap = cc.height - sc.canonLength * 0.93;
			const gapOk = gap >= GAP_MIN && gap <= GAP_MAX;
			// Evaluated above even when whitelisted, not skipped outright - a stale entry that
			// no longer excuses anything real should fail loud, not sit invisibly in the file
			// forever (that's how the Twin Flank sign flip went unnoticed).
			const entry = findEntry(name, i, 'geom');
			if (entry) {
				consumed.add(entry);
				if (offdirOk && offxOk && gapOk) {
					check(name + '[' + i + '] no longer needs its whitelist entry', false);
				}
				continue;
			}
			check(name + '[' + i + '] offdir agrees', offdirOk,
				'client ' + cc.offdir + ' vs server ' + sc.offdir);
			check(name + '[' + i + '] offx agrees', offxOk,
				'client ' + cc.offx + ' vs server ' + sc.offx);
			check(name + '[' + i + '] height is a plausible muzzle-tip lead over canonLength*.93',
				gapOk,
				'height ' + cc.height + ', canonLength*.93 ' + (sc.canonLength * 0.93).toFixed(2) +
				', gap ' + gap.toFixed(2));
		}
	}
}

/*
	Order check. A class whose client heights and server canonLength*.93 values are the same
	multiset but a different sequence is exactly what the Sprayer bug looked like: nothing
	above catches it unless a cannon happens to also differ in offdir/offx, so this is a
	separate, explicit pass.
*/
function order(names) {
	console.log('\nsequence vs multiset (catches a rotation the geometry check alone would miss):');
	for (const name of names) {
		const list = pairs(name);
		if (list.length < 2) { continue; }
		const clientSeq = list.map(([cc]) => cc.height);
		const serverSeq = list.map(([, sc]) => sc.canonLength);
		const sortedC = [...clientSeq].sort((a, b) => a - b);
		const sortedS = [...serverSeq].sort((a, b) => a - b);
		const setsMatch = JSON.stringify(sortedC) === JSON.stringify(sortedS);
		const sequenceMatches = clientSeq.every((h, i) => {
			const gap = h - serverSeq[i] * 0.93;
			return gap >= GAP_MIN && gap <= GAP_MAX;
		});
		if (setsMatch && whitelisted(name, 0, 'order')) {
			continue;
		}
		if (setsMatch && !sequenceMatches) {
			check(name + ': the two length lists agree as sets but not as a sequence - a rotation',
				false, 'client ' + JSON.stringify(clientSeq) + ' vs server ' + JSON.stringify(serverSeq));
		}
	}
}

const names = classSet();
cannonCounts(names);
geometry(names);
order(names);

// count/order entries report their own staleness here; geom entries already did it inline above
// (they need the recomputed comparison, not just "was this looked up").
console.log('\nwhitelist entries:');
for (const entry of WHITELIST) {
	if (entry.kind === 'geom') { continue; }
	check(entry.class + ' (' + entry.kind + ') whitelist entry was consulted this run',
		consumed.has(entry));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
