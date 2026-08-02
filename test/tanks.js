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
	// of a literal !==. Summoner[0..3]'s own geom entry (client height 44 vs a since-fixed server
	// canonLength) is gone too now (plan.md Part D) - both sides converge on
	// SummonerSpawnerDefinition's real 31.5/16.66 (client) === 31.5 (server canonLength).
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
// Was 12 - Ranger's own entry (plan.md A4) is gone now that its client cannon count for real:
// one cannon, matching the server's one barrel, the fake second "cannon" replaced by a real
// `pronounced` postAddon overlay instead of a cannon-shaped stand-in.
// 11 -> 7 (plan.md Part D): Summoner[0..3]'s own geom entries are gone, both sides now converge
// on SummonerSpawnerDefinition's real numbers instead of excusing a stale mismatch.
check('the whitelist has not grown', WHITELIST.length === 7, WHITELIST.length);

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

/*
	plan.md R10 item 1/3 - anchored OUTSIDE our own tree, unlike everything above (this file's
	own opening comment: two internally-consistent halves can still both be wrong the same way,
	which is exactly how the 0.56/0.70 mixup - plan.md R1 - got past all 631 assertions above).
	For a curated set of classes with a real, unambiguous diepcustom TankDefinitions.json
	barrel list, client height/width and server can.size must reproduce diep's own du figures
	through the derived `CONST.SIZE/ref` identity (ref 50 for every ordinary tank; a boss with
	its own sizeFactor override - Summoner/Guardian/Defender, plan.md R2 - lives in
	Entity/Boss/*.ts, not this JSON, so it's out of this particular check's reach, as is Auto
	3/5's own AutoTurretMiniDefinition addon - `barrels: []` for both in the JSON itself).
	Compared as sorted multisets per class, not by index, so a legitimate reordering (Spread
	Shot's own centre-barrel-last convention, symmetric fan pairs) can't read as a mismatch -
	only the magnitudes have to agree.
*/
const CONST_SIZE = 35;   // public/client/config.js's CONST.SIZE - see drawings.js's own REF_TICK_MS comment for why this is a hand-copy, not a require().
const DIEP_TANKS = require(path.join(ROOT, 'diepcustom', 'src', 'Const', 'TankDefinitions.json'));
function diepTank(id) {
	// A few array slots are `null` (retired ids) rather than absent.
	const t = DIEP_TANKS.find(t => t && t.id === id);
	if (!t) { throw new Error('no diepcustom TankDefinitions.json entry for id ' + id); }
	return t;
}
const DIEP_CITED = [
	{ class: 'Hunter', diepId: 19 }, { class: 'Predator', diepId: 28 },
	{ class: 'Streamliner', diepId: 43 }, { class: 'Stalker', diepId: 21 },
	{ class: 'Spread Shot', diepId: 42 }, { class: 'Gunner Trapper', diepId: 32 },
	{ class: 'Tri-Trapper', diepId: 35 }, { class: 'Skimmer', diepId: 54 },
	{ class: 'Factory', diepId: 52 }, { class: 'Mothership', diepId: 27 },
	{ class: 'Arena Closer', diepId: 16 },
	{ class: 'Destroyer Dominator', diepId: 45 }, { class: 'Gunner Dominator', diepId: 46 },
	{ class: 'Trapper Dominator', diepId: 47 },
];
const REF = 50;
const TOL = 0.02;   // absolute, in height/CONST.SIZE units - generous against hand-rounded literals, tight against a 0.56-vs-0.70-scale (0.14) regression.

function sortedNear(a, b, tol) {
	if (a.length !== b.length) { return { ok: false, detail: 'count ' + a.length + ' vs ' + b.length }; }
	const sa = [...a].sort((x, y) => x - y), sb = [...b].sort((x, y) => x - y);
	for (let i = 0; i < sa.length; i++) {
		if (Math.abs(sa[i] - sb[i]) > tol) {
			return { ok: false, detail: JSON.stringify(sa.map(n => +n.toFixed(4))) + ' vs ' + JSON.stringify(sb.map(n => +n.toFixed(4))) };
		}
	}
	return { ok: true };
}

function diepCitations() {
	console.log('\ndiep citation check (client/server against diepcustom/TankDefinitions.json directly):');
	for (const { class: name, diepId } of DIEP_CITED) {
		const c = client.class[name], s = server.class[name];
		const barrels = diepTank(diepId).barrels;
		const clientCannons = c.cannons;
		const heights = clientCannons.map(cc => cc.height / CONST_SIZE);
		const widths = clientCannons.map(cc => cc.width / CONST_SIZE);
		const diepSizes = barrels.map(b => b.size / REF);
		const diepWidths = barrels.map(b => b.width / REF);
		let r = sortedNear(heights, diepSizes, TOL);
		check(name + ': client height agrees with diep barrel.size (x CONST.SIZE/' + REF + ')', r.ok, r.detail);
		r = sortedNear(widths, diepWidths, TOL);
		check(name + ': client width agrees with diep barrel.width (x CONST.SIZE/' + REF + ')', r.ok, r.detail);

		const serverCannons = s.cannons.slice(s.cannons.length - clientCannons.length);
		const sizes = serverCannons.map(sc => sc.size / CONST_SIZE);
		const diepBulletSizes = barrels.map(b => (b.width / 2) * b.bullet.sizeRatio / REF);
		r = sortedNear(sizes, diepBulletSizes, TOL);
		check(name + ': server can.size agrees with (barrel.width/2) x bullet.sizeRatio (x CONST.SIZE/' + REF + ')', r.ok, r.detail);
	}
}

/*
	plan.md C0/F2 - the server bullet-stat identities (damage = 7 x bullet.damage, pene = 2 x
	bullet.health, speed = 1.12 x bullet.speed, back = recoil x 2.8, rand = scatterRate x
	0.174533), anchored per barrel against diepcustom/TankDefinitions.json directly for every
	diep-native class with a real barrel list there - the same "outside the tree" reasoning as
	diepCitations() above, generalised from geometry to the combat-facing columns C0's generator
	regenerated. `reload`/`life` are deliberately NOT checked here: both are intentionally
	Math.round()ed to a whole tick (PENDING.md #2 and the tick-count requirement respectively),
	so a literal identity comparison would fail on the rounding itself, not a real bug. Compared
	as sorted multisets per class (not by index) for the same reason diepCitations() is: a
	legitimate reordering (Spread Shot's centre-last convention) must not read as a mismatch.
*/
const STAT_TOL = 0.01;
const RAND_K = 0.174533;   // 10deg in rad - Barrel.ts's scatterAngle range, see TanksConfig.js's own header comment
const DIEP_STAT_CITED = [
	{ class: 'Basic', diepId: 0 }, { class: 'Twin', diepId: 1 }, { class: 'Machine Gun', diepId: 7 },
	{ class: 'Sniper', diepId: 6 }, { class: 'Flank Guard', diepId: 8 }, { class: 'Triple Shot', diepId: 3 },
	{ class: 'Twin Flank', diepId: 13 }, { class: 'Quad Tank', diepId: 4 }, { class: 'Destroyer', diepId: 10 },
	{ class: 'Assassin', diepId: 15 }, { class: 'Overseer', diepId: 11 }, { class: 'Triangle', diepId: 9 },
	{ class: 'Trapper', diepId: 31 }, { class: 'Hybrid', diepId: 25 }, { class: 'Annihilator', diepId: 49 },
	{ class: 'Sprayer', diepId: 29 }, { class: 'Ranger', diepId: 22 }, { class: 'Triplet', diepId: 2 },
	{ class: 'Triple Twin', diepId: 18 }, { class: 'Penta Shot', diepId: 14 }, { class: 'Octo Tank', diepId: 5 },
	{ class: 'Booster', diepId: 23 }, { class: 'Fighter', diepId: 24 }, { class: 'Overlord', diepId: 12 },
	{ class: 'Manager', diepId: 26 }, { class: 'BattleShip', diepId: 48 }, { class: 'Mega Trapper', diepId: 34 },
	{ class: 'Overtrapper', diepId: 33 }, { class: 'Auto Trapper', diepId: 44 }, { class: 'Gunner', diepId: 20 },
	{ class: 'Auto Gunner', diepId: 39 },
	// Auto Smasher/Auto 3/Auto 5 all cite an empty `barrels: []` (their fire comes entirely from
	// the postAddon's own AutoTurret(Mini)Definition, not a per-class barrel) - included so a
	// future barrel actually appearing there gets checked, not to assert anything today.
	{ class: 'Auto Smasher', diepId: 50 }, { class: 'Auto 3', diepId: 41 }, { class: 'Auto 5', diepId: 40 },
	// The rest of DIEP_CITED minus Arena Closer/the 3 Dominators: those four are boss-scale
	// entities whose class-table stats are baked at their own (non-zero, non-standard) effective
	// stat level rather than diep's raw 0-point barrel identity - plan.md Part E's job, not C0's.
	...DIEP_CITED.filter(({ class: name }) => !['Arena Closer', 'Destroyer Dominator', 'Gunner Dominator', 'Trapper Dominator'].includes(name)),
];

function diepBulletStats() {
	console.log('\ndiep bullet-stat identity check (damage/pene/speed/back/rand, plan.md C0):');
	for (const { class: name, diepId } of DIEP_STAT_CITED) {
		const s = server.class[name];
		const barrels = diepTank(diepId).barrels;
		if (!barrels.length) { continue; }
		const serverCannons = s.cannons.slice(s.cannons.length - barrels.length);
		if (serverCannons.length !== barrels.length) {
			check(name + ': server cannon count allows a diep bullet-stat comparison',
				false, serverCannons.length + ' vs ' + barrels.length);
			continue;
		}
		const cols = [
			['damage', sc => sc.damage, b => 7 * b.bullet.damage],
			['pene', sc => sc.pene, b => 2 * b.bullet.health],
			['speed', sc => sc.speed, b => 1.12 * b.bullet.speed],
			['back', sc => sc.back, b => b.recoil * 2.8],
			['rand', sc => sc.rand, b => RAND_K * b.bullet.scatterRate],
		];
		for (const [label, getServer, getDiep] of cols) {
			const got = serverCannons.map(getServer);
			const want = barrels.map(getDiep);
			const r = sortedNear(got, want, STAT_TOL);
			check(name + ': server ' + label + ' agrees with diep\'s identity', r.ok, r.detail);
		}
	}
}

/*
	plan.md R10 item 2 - R8's bug (Defender's turret `distance` present server-side, absent
	client-side, so bullets spawned 33.6 units off the drawn barrel), generalised: every
	position-affecting field a cannon carries on one side must carry the same value on the
	other. offdir/offx are already checked in geometry() above; `distance` (plan.md T5) never
	was.
*/
function distances(names) {
	console.log('\ndistance agrees, client vs server (plan.md R8, generalised):');
	for (const name of names) {
		for (const [cc, sc, i] of pairs(name)) {
			const cd = cc.distance || 0, sd = sc.distance || 0;
			check(name + '[' + i + '] distance agrees', cd === sd, 'client ' + cd + ' vs server ' + sd);
		}
	}
}

/*
	plan.md R10 item 3 - every `parseInt(type)` a cannon can emit has a Drawings.bullet entry
	(R7's crash - Skimmer's `type: 4` reaching an undefined array slot - as an assertion rather
	than something that only shows up live). Mirrors rooms/Room.js's own bulletWireType(): a
	fractional `type` (Factory's Minion, 1.5) is remapped to MINION_WIRE_TYPE (5) at the encode
	site, so the client-side type space is the post-remap integer, not the raw config value.
*/
function bulletTypes(names) {
	console.log('\nevery cannon type reaches a real Drawings.bullet entry (plan.md R7, as an assertion):');
	const BULLET_ENTRIES = 6;   // public/client/drawings.js's Drawings.bullet.length (0-5)
	const MINION_WIRE_TYPE = 5;
	for (const name of names) {
		const c = client.class[name];
		for (const cc of c.cannons) {
			const wireType = cc.type === 1.5 ? MINION_WIRE_TYPE : parseInt(cc.type || 0);
			check(name + ': cannon type ' + cc.type + ' -> wire type ' + wireType + ' has a Drawings.bullet entry',
				wireType >= 0 && wireType < BULLET_ENTRIES, wireType);
		}
	}
}

const names = classSet();
cannonCounts(names);
geometry(names);
order(names);
distances(names);
bulletTypes(names);
diepCitations();
diepBulletStats();

// Fallen Overlord/Fallen Booster draw a plain circle now (plan.md Part D), the same body every
// ordinary diep tank - including the Overlord/Booster classes these two are scaled copies of -
// already has, not the rounded-rect (shape 1) stand-in PENDING #51 flagged.
console.log('\nFallen Overlord/Fallen Booster draw a real circular body (plan.md Part D):');
for (const name of ['Fallen Overlord', 'Fallen Booster']) {
	check(name + ' body is shape 0 (a plain circle), not the shape 1 rounded-rect stand-in',
		client.class[name].body.shape === 0, client.class[name].body.shape);
}

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
