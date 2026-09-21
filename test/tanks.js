/*
	Baked client/server tank geometry guard for public/SHARE/TanksConfig.js.

	Compares draw dimensions on the client half to spawn geometry on the server half; does not
	convert from diep du. Boss-scale du derivation and golden checks stay in test/rooms.js.

	Pairing:
	- server cannons with autoDir ↔ client turrets (order)
	- hull cannons: collapse server barrels that share offdir+offx (Overtrapper), then 1:1 vs client cannons
	- skip hull when server.necro and no hull cannons (Necromancer)
	- skip hull when every client cannon is hidden and server has no hull cannons (testbed tools)
	- statMax deep-equal when either half defines it
*/
const SERVER = require('../public/SHARE/TanksConfig.js');
const CLIENT = require('./clientTanks.js')();

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
	if (ok) { passed++; console.log('  ok   ' + name); }
	else { failed++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + detail : '')); }
}

const EPS = 0.02;
function near(a, b) { return Math.abs(a - b) < EPS; }
function angNear(a, b) {
	let d = ((a - b + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
	return Math.abs(d) < 1e-6;
}

function filterTruthy(arr) {
	return (arr || []).filter((x) => x);
}

function statMaxEqual(a, b) {
	if (!a && !b) return true;
	if (!a || !b || a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

function collapse(sHull) {
	const groups = [];
	for (const c of sHull) {
		const offx = c.offx || 0;
		const offdir = c.offdir || 0;
		let group = groups.find((g) => {
			const first = g[0];
			return angNear(first.offdir || 0, offdir)
				&& near(first.offx || 0, offx)
				&& near(first.canonLength, c.canonLength);
		});
		if (group) group.push(c);
		else groups.push([c]);
	}
	for (const g of groups) {
		const first = g[0];
		for (let j = 1; j < g.length; j++) {
			const c = g[j];
			if (!near(first.canonLength, c.canonLength)
				|| !near(first.offx || 0, c.offx || 0)
				|| !angNear(first.offdir || 0, c.offdir || 0)) {
				return { error: 'stacked hull group geometry mismatch' };
			}
		}
	}
	return { collapsed: groups.map((g) => g[0]) };
}

function pairBarrel(serverCan, clientCan, label, misses) {
	const sLen = serverCan.canonLength;
	const cLen = clientCan.height;
	if (!near(sLen, cLen)) {
		misses.push(label + ': canonLength ' + sLen + ' vs height ' + cLen);
	}
	if (!near(serverCan.offx || 0, clientCan.offx || 0)) {
		misses.push(label + ': offx ' + (serverCan.offx || 0) + ' vs ' + (clientCan.offx || 0));
	}
	if (!angNear(serverCan.offdir || 0, clientCan.offdir || 0)) {
		misses.push(label + ': offdir');
	}
	if (serverCan.distance !== undefined && serverCan.distance !== null
		&& clientCan.distance !== undefined && clientCan.distance !== null
		&& !near(serverCan.distance, clientCan.distance)) {
		misses.push(label + ': distance');
	}
}

function geometryForClass(name) {
	const misses = [];
	const serverClass = SERVER.class[name];
	const clientClass = CLIENT.class[name];

	if (serverClass.statMax || clientClass.statMax) {
		if (!serverClass.statMax || !clientClass.statMax) {
			misses.push('statMax present on only one half');
		} else if (!statMaxEqual(serverClass.statMax, clientClass.statMax)) {
			misses.push('statMax arrays differ');
		}
	}

	const sCans = filterTruthy(serverClass.cannons);
	const cCans = filterTruthy(clientClass.cannons);
	const cTurr = filterTruthy(clientClass.turrets);
	const sTurr = sCans.filter((can) => can.autoDir);
	const sHull = sCans.filter((can) => !can.autoDir);

	if (sTurr.length !== cTurr.length) {
		misses.push('turret count ' + sTurr.length + ' vs ' + cTurr.length);
	} else {
		for (let i = 0; i < sTurr.length; i++) {
			pairBarrel(sTurr[i], cTurr[i], 'turret[' + i + ']', misses);
		}
	}

	let skipHull = false;
	if (serverClass.necro && sHull.length === 0) {
		skipHull = true;
	} else if (cCans.length > 0 && cCans.every((c) => c.hidden) && sHull.length === 0) {
		skipHull = true;
	}

	if (!skipHull) {
		const collapsedResult = collapse(sHull);
		if (collapsedResult.error) {
			misses.push(collapsedResult.error);
		} else {
			const collapsed = collapsedResult.collapsed;
			if (collapsed.length !== cCans.length) {
				misses.push('hull count after collapse ' + collapsed.length + ' vs ' + cCans.length);
			} else {
				for (let i = 0; i < collapsed.length; i++) {
					pairBarrel(collapsed[i], cCans[i], 'hull[' + i + ']', misses);
				}
			}
		}
	}

	return misses;
}

function sameKeySet(a, b) {
	const ak = Object.keys(a).sort();
	const bk = Object.keys(b).sort();
	if (ak.length !== bk.length) return false;
	for (let i = 0; i < ak.length; i++) {
		if (ak[i] !== bk[i]) return false;
	}
	return true;
}

console.log('tanks (client/server geometry):\n');

const serverKeys = Object.keys(SERVER.class);
const clientKeys = Object.keys(CLIENT.class);
check('SERVER.class and CLIENT.class same key set', sameKeySet(SERVER.class, CLIENT.class),
	serverKeys.length + ' vs ' + clientKeys.length);

const missingFromServer = SERVER.list.filter((n) => !SERVER.class[n] || !CLIENT.class[n]);
const listKeys = new Set(SERVER.list);
const keysNotInList = serverKeys.filter((k) => !listKeys.has(k));
check('every SERVER.list name exists in both class maps', missingFromServer.length === 0,
	missingFromServer.join(', ') || undefined);
check('every class-map key appears in SERVER.list', keysNotInList.length === 0,
	keysNotInList.join(', ') || undefined);

const classMisses = {};
const sharedNames = serverKeys.filter((k) => CLIENT.class[k]);
for (const name of sharedNames) {
	const misses = geometryForClass(name);
	if (misses.length) {
		classMisses[name] = misses;
		check(name + ' geometry', false, misses.join('; '));
	}
}

const anyMiss = Object.keys(classMisses).length > 0;
check('every class paired without a geometry miss', !anyMiss,
	anyMiss ? Object.keys(classMisses).join(', ') : undefined);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
