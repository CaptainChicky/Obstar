/*
	Room tests: the gamemode behaviour that test/smoke.js cannot see.

	smoke.js drives a real socket and proves the pipe from socket -> room -> encoder -> socket
	is intact, but every assertion it makes is true of any room. Teams, bases, bot rosters,
	colours and respawn xp are exactly the things that differed between the old Ffa and
	TwoTeam copies, so they are exactly what a shared rooms/Room.js has to be pinned on.

	All four modes are covered: '4team' and 'boss' were written against this base without
	touching rooms/Room.js's tick, and the shared block at the bottom runs the same rules over
	every one of them, which is the assertion that the base really did fit.

	No server and no socket: lib/boot.js fills the registry, and the rooms are built and
	poked directly.

		node test/rooms.js        (npm test runs this and smoke.js)
*/
const path = require('path');
const ROOT = path.join(__dirname, '..');

require(path.join(ROOT, 'lib', 'boot.js'))();
const RT = require(path.join(ROOT, 'lib', 'runtime.js'));

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
	Rooms register themselves with the Controller and tear themselves down on the first tick
	that finds no human in them, so build them through newServer and seat a player at once.
	The timers they arm are left running; the process exits at the end of the file.
*/
function makeRoom(gm) {
	const room = RT.Controller.newServer(gm);
	room.ask({ name: 'tester', key: '0'.repeat(25), pet: -1, gm: gm });
	return room;
}

function player(room, id) {
	return room.INSTANCE.players.get(id);
}

/// Free-for-all //////////////////////////////////////////////////////////////
function ffaTests() {
	console.log('rooms (ffa):');
	const room = makeRoom('ffa');

	check('level cap comes from the mode', room.XPLVL[room.XPLVL.length - 1] === 25000,
		room.XPLVL[room.XPLVL.length - 1]);
	check('map is the ffa map', room.map.width === 9020 && room.map.height === 9020,
		room.map.width + 'x' + room.map.height);
	check('map is not resizing by default', room.newMap.width === room.map.width &&
		room.newMap.height === room.map.height);

	// Bots are seated by Init(), which runs on a timer, so ask() ran first: slot 0.
	const me = player(room, 0);
	check('first player takes slot 0', !!me && me.id.oId === 0);
	check('everyone is on the same nominal team', me.team === 1, me.team);

	const second = room.ask({ name: 'tester2', key: '0'.repeat(25), pet: -1, gm: 'ffa' });
	check('second player takes slot 1', second && second.oId === 1, second && second.oId);
	check('second player is on that same team', player(room, 1).team === 1, player(room, 1).team);

	check('you are blue to yourself', room.mainColor(me) === 0, room.mainColor(me));
	check('everyone else is red to you', room.entityColor(player(room, 1)) === 1,
		room.entityColor(player(room, 1)));
	check('you top the leaderboard as blue', room.leaderColor(me, 0) === 0, room.leaderColor(me, 0));
	check('others sit on the leaderboard as red', room.leaderColor(player(room, 1), 0) === 1,
		room.leaderColor(player(room, 1), 0));

	check('your own bullets carry your colour', room.ownBulletColor({ type: 1 }, me) === 0,
		room.ownBulletColor({ type: 1 }, me));
	check('traps render as colour 9', room.bulletColor({ type: 3, team: 1 }) === 9,
		room.bulletColor({ type: 3, team: 1 }));
	const bullet = {};
	room.assignBulletTeam(bullet, me);
	check('bullets inherit the one team', bullet.team === 1, bullet.team);

	check('no bases to run into', room.inEnemyBase(me) === false);
	// createBoss() is a real implementation on Room now rather than an empty override, so what
	// keeps 'summonRandBoss' harmless here is rules.maxBoss being 0 - assert that, not that
	// the method does nothing.
	check('ffa has no bosses', room.rules.maxBoss === 0, room.rules.maxBoss);
	check('summoning a boss is a harmless no-op', (function () {
		try { room.createBoss(); return room.bosses.length === 0; } catch (e) { return e.message; }
	})() === true);

	// The spawn has to clear the three polygon nests: the origin and the two quarter points.
	let clear = true;
	for (let i = 0; i < 200; i++) {
		const p = room.spawnPoint(me);
		const d = (x, y) => Math.sqrt(Math.pow(p.x - x, 2) + Math.pow(p.y - y, 2));
		if (d(0, 0) <= 1100 || d(room.map.width / 4, room.map.height / 4) <= 800 ||
			d(-room.map.width / 4, -room.map.height / 4) <= 800) { clear = false; }
		if (Math.abs(p.x) > room.map.width / 2 || Math.abs(p.y) > room.map.height / 2) { clear = false; }
	}
	check('spawns land on the map and clear of the nests', clear);

	return room;
}

/// Two teams /////////////////////////////////////////////////////////////////
function teamTests() {
	console.log('rooms (2team):');
	const room = makeRoom('2team');

	check('level cap comes from the mode', room.XPLVL[room.XPLVL.length - 1] === 30000,
		room.XPLVL[room.XPLVL.length - 1]);
	check('map is the 2team map', room.map.width === 8000 && room.map.height === 8000,
		room.map.width + 'x' + room.map.height);

	// build() runs before the first tick, so the guard drones are there from the start.
	const drones = [...room.INSTANCE.bullets.live()].filter((b) => b.alone);
	check('both bases are guarded', drones.length === 20, drones.length + ' drones');
	check('the guards are split evenly', drones.filter((d) => d.team === 0).length === 10,
		drones.filter((d) => d.team === 0).length + ' on team 0');
	const leftGuards = drones.filter((d) => d.x < 0);
	check('each side guards its own half',
		leftGuards.length === 10 && leftGuards.every((d) => d.team === 0));

	// Sides are balanced on join, so four players come out two and two.
	for (let i = 0; i < 3; i++) {
		room.ask({ name: 'tester' + i, key: '0'.repeat(25), pet: -1, gm: '2team' });
	}
	const sides = [0, 0];
	for (let i = 0; i < 4; i++) { sides[player(room, i).team]++; }
	check('joins are balanced across the sides', sides[0] === 2 && sides[1] === 2, sides.join('/'));

	const zero = { team: 0 }, one = { team: 1 };
	check('team 0 dies in team 1\'s base', room.inEnemyBase({ team: 0, x: 3500 }) === true);
	check('team 0 is safe in its own', room.inEnemyBase({ team: 0, x: -3500 }) === false);
	check('team 1 dies in team 0\'s base', room.inEnemyBase({ team: 1, x: -3500 }) === true);
	check('team 1 is safe in its own', room.inEnemyBase({ team: 1, x: 3500 }) === false);
	check('midfield is safe for both', room.inEnemyBase({ team: 0, x: 0 }) === false &&
		room.inEnemyBase({ team: 1, x: 0 }) === false);
	check('the boss belongs to neither base', room.inEnemyBase({ team: 9, x: 3500 }) === false);

	// You respawn inside your own base, which is the one place you are guaranteed not to be
	// standing in an enemy one.
	let inside = true;
	for (let i = 0; i < 200; i++) {
		if (room.inEnemyBase({ team: 0, x: room.spawnPoint(zero).x })) { inside = false; }
		if (room.inEnemyBase({ team: 1, x: room.spawnPoint(one).x })) { inside = false; }
	}
	check('you always respawn out of the enemy base', inside);

	check('tanks are coloured by side', room.entityColor({ team: 1 }) === 1 &&
		room.entityColor({ team: 0 }) === 0);
	check('your own tank too - no blue-for-you', room.mainColor({ team: 1 }) === 1,
		room.mainColor({ team: 1 }));
	check('the leaderboard is coloured by side', room.leaderColor({ team: 1, id: { oId: 0 } }, 0) === 1);
	check('bullets are coloured by side', room.bulletColor({ team: 1, type: 1 }) === 1);
	check('a dev colour overrides the side', room.bulletColor({ team: 1, type: 1, color: 5 }) === 4);

	const bullet = {};
	room.assignBulletTeam(bullet, { team: 1, dev: {} });
	check('bullets inherit the shooter\'s side', bullet.team === 1, bullet.team);

	// The room may already have rolled its own boss during Init() - bossRng is 0.9999, but
	// preGenerate rolls it a thousand times - so count from wherever it is now.
	const before = room.bosses.length;
	room.createBoss();
	const boss = room.bosses[room.bosses.length - 1];
	check('a boss can be summoned', room.bosses.length === Math.min(1, before + 1) && !!boss && boss.boss === 1,
		room.bosses.length);
	check('the boss is on nobody\'s side', boss && boss.team === 9, boss && boss.team);
	check('the boss keeps its own colour, not the enemy red', room.entityColor(boss) === 9,
		room.entityColor(boss));
	check('a second boss does not stack - 2team caps at one', (function () {
		room.createBoss();
		return room.bosses.length === 1;
	})(), room.bosses.length);
	check('a boss does not keep an empty room alive', !!boss.boss && !boss.bot);

	return room;
}

/// Four teams ////////////////////////////////////////////////////////////////
/*
	4team exists to prove the base generalises past two sides: rules.teams drives the join
	balance, the bot roster and the base fence with no code that knows the number is four.
*/
function fourTeamTests() {
	console.log('rooms (4team):');
	const room = makeRoom('4team');

	check('four sides', room.rules.teams.length === 4, room.rules.teams.join(','));
	check('team ids are colour indices', room.rules.teams.join(',') === '0,1,2,3');
	check('friendly fire is off', room.rules.teamPlay === true);

	const drones = [...room.INSTANCE.bullets.live()].filter((b) => b.alone);
	check('every base is guarded', drones.length === 32, drones.length + ' drones');
	check('the guards are split evenly across four sides',
		[0, 1, 2, 3].every((t) => drones.filter((d) => d.team === t).length === 8),
		[0, 1, 2, 3].map((t) => drones.filter((d) => d.team === t).length).join('/'));
	// Each side's guards must sit in that side's corner and nowhere else.
	const placed = drones.every((d) => {
		const c = room.corner(d.team);
		return Math.sign(d.x) === Math.sign(c.x) && Math.sign(d.y) === Math.sign(c.y);
	});
	check('each side guards its own corner', placed);

	// Four more players, balanced: one per side.
	for (let i = 0; i < 3; i++) {
		room.ask({ name: 'tester' + i, key: '0'.repeat(25), pet: -1, gm: '4team' });
	}
	const sides = [0, 0, 0, 0];
	for (let i = 0; i < 4; i++) { sides[player(room, i).team]++; }
	check('joins are balanced across all four sides', sides.every((n) => n === 1), sides.join('/'));

	// The fence: your own corner is safe, all three others kill you.
	let ok = true, safe = true;
	for (const mine of room.rules.teams) {
		const home = room.corner(mine);
		if (room.inEnemyBase({ team: mine, x: home.x * 0.98, y: home.y * 0.98 })) { safe = false; }
		for (const other of room.rules.teams) {
			if (other === mine) { continue; }
			const c = room.corner(other);
			if (!room.inEnemyBase({ team: mine, x: c.x * 0.98, y: c.y * 0.98 })) { ok = false; }
		}
	}
	check('every side dies in every other side\'s corner', ok);
	check('...and is safe in its own', safe);
	check('midfield is safe for everyone',
		room.rules.teams.every((t) => room.inEnemyBase({ team: t, x: 0, y: 0 }) === false));
	check('the boss belongs to no corner',
		room.inEnemyBase({ team: 9, x: room.map.width / 2, y: room.map.height / 2 }) === false);

	let inside = true;
	for (const t of room.rules.teams) {
		for (let i = 0; i < 100; i++) {
			const p = room.spawnPoint({ team: t });
			if (room.inEnemyBase({ team: t, x: p.x, y: p.y })) { inside = false; }
			if (Math.abs(p.x) > room.map.width / 2 || Math.abs(p.y) > room.map.height / 2) { inside = false; }
		}
	}
	check('you always respawn in your own corner, on the map', inside);

	check('tanks are coloured by side',
		room.rules.teams.every((t) => room.entityColor({ team: t }) === t));
	check('your own tank too', room.mainColor({ team: 3 }) === 3, room.mainColor({ team: 3 }));
	check('a dev colour overrides the side', room.bulletColor({ team: 2, type: 1, color: 5 }) === 4);

	return room;
}

/// Boss mode /////////////////////////////////////////////////////////////////
/*
	'boss' is free-for-all with the boss knobs turned up. Everything that makes a boss a boss
	lives in rooms/Room.js.createBoss(), so what is worth asserting here is that the mode gets
	bosses, that it gets several, and that it stops at the cap.
*/
function bossTests() {
	console.log('rooms (boss):');
	const room = makeRoom('boss');

	check('it is a free-for-all underneath', room.rules.teams.length === 1 &&
		room.rules.teamPlay === false);
	check('the mode has a boss cap above one', room.rules.maxBoss > 1, room.rules.maxBoss);
	check('bosses turn up often, not once in ten thousand rolls', room.rules.bossRng < 0.99,
		room.rules.bossRng);

	// Init() runs on a timer, so nothing has ticked yet here - drive the spawn table by hand.
	// 200 passes is well under the preGenerate the room does for real, and at bossRng 0.9 it
	// should have filled the cap several times over.
	check('the room starts with no bosses until it has ticked', room.bosses.length === 0,
		room.bosses.length);
	for (let i = 0; i < 200; i++) { room.generate(); }
	check('the spawn table fills the boss cap on its own',
		room.bosses.length === room.rules.maxBoss,
		room.bosses.length + ' of ' + room.rules.maxBoss);
	check('summoning past the cap does nothing', (function () {
		room.createBoss(); room.createBoss();
		return room.bosses.length === room.rules.maxBoss;
	})(), room.bosses.length);
	check('every boss is neutral', room.bosses.every((b) => b.team === 9),
		room.bosses.map((b) => b.team).join(','));
	check('bosses occupy distinct slots',
		new Set(room.bosses.map((b) => b.id.oId)).size === room.bosses.length,
		room.bosses.map((b) => b.id.oId).join(','));
	check('bosses do not take the bot slots',
		room.bosses.every((b) => b.id.oId < room.rules.botIdStart),
		room.bosses.map((b) => b.id.oId).join(','));
	check('a boss stays off the leaderboard', room.leader.every((p) => !p.boss));

	return room;
}

/// Shared rules //////////////////////////////////////////////////////////////
/*
	Dying must never pay. The xp curve returns more than it was given below roughly a
	thousand xp, so the Math.min in Room.respawnXp is the whole point - TwoTeam was missing it
	and low-level deaths were a small reward there. See HANDOFF.md 5.8.
*/
function respawnTests(rooms) {
	console.log('rooms (shared):');
	for (const room of rooms) {
		let never = true, cap = room.XPLVL[room.XPLVL.length - 1];
		for (const xp of [0, 1, 10, 100, 500, 1000, 5000, cap - 1, cap, cap * 2]) {
			const got = room.respawnXp(xp);
			if (!(got <= xp) || !isFinite(got) || got < 0) { never = false; }
		}
		check(room.gm + ': a death never pays', never);
		check(room.gm + ': a death costs something', room.respawnXp(cap) < cap,
			room.respawnXp(cap) + ' of ' + cap);
		check(room.gm + ': past the cap you keep 60%', room.respawnXp(cap * 2) === cap * 0.6,
			room.respawnXp(cap * 2));
	}

	// Bot slots are fixed for the life of a room - update() walks this.bots to respawn them -
	// so a roster that hands out a duplicate id would quietly overwrite a player.
	for (const room of rooms) {
		const roster = room.botRoster();
		const ids = roster.map((s) => s.id);
		check(room.gm + ': bot slots are unique', new Set(ids).size === ids.length, ids.join(','));
		check(room.gm + ': bots sit clear of the join slots', Math.min.apply(null, ids) >= 10,
			Math.min.apply(null, ids));
		check(room.gm + ': every bot has a real team',
			roster.every((s) => room.rules.teams.indexOf(s.team) >= 0),
			roster.map((s) => s.team).join(','));
	}
}

/*
	The gamemode tables have to agree with each other or a mode is unreachable in a way no
	other test notices. This is exactly how '4team' was broken for the life of the codebase:
	toBUFFER.gamemode said 3 and toSTRING.gamemode only had three entries, so the byte the
	client sent decoded to `undefined` and the server answered ERR_GAMEMODE. 'boss' was in
	neither table while having a slot in Controller.server.
*/
function modeTableTests(rooms) {
	console.log('\ngamemode tables:');
	const PROTO = require(path.join(ROOT, 'public', 'SHARE', 'SocketSchema.js'));
	const modes = Object.keys(RT.ROOMS);

	check('every mode has a room class', modes.every((gm) => typeof RT.ROOMS[gm] === 'function'),
		modes.join(','));
	check('every mode has a room list on the Controller',
		modes.every((gm) => Array.isArray(RT.Controller.server[gm])), modes.join(','));
	check('the Controller has no room list for a mode that does not exist',
		Object.keys(RT.Controller.server).every((gm) => !!RT.ROOMS[gm]),
		Object.keys(RT.Controller.server).join(','));
	check('every room reports the gamemode it is filed under',
		rooms.every((r) => RT.ROOMS[r.gm] === r.constructor),
		rooms.map((r) => r.gm).join(','));

	// The round trip the client actually performs: encode the mode to a byte, decode it back.
	const roundTrip = modes.filter((gm) => PROTO.toSTRING.gamemode[PROTO.toBUFFER.gamemode[gm]] !== gm);
	check('every mode survives the encode/decode round trip', roundTrip.length === 0,
		'broken: ' + roundTrip.join(','));
	check('every mode has a wire value',
		modes.every((gm) => typeof PROTO.toBUFFER.gamemode[gm] === 'number'), modes.join(','));
	check('the wire enum lists nothing the server cannot serve',
		PROTO.toSTRING.gamemode.every((gm) => !!RT.ROOMS[gm]),
		PROTO.toSTRING.gamemode.join(','));
	check('the wire values are dense and unique',
		new Set(modes.map((gm) => PROTO.toBUFFER.gamemode[gm])).size === modes.length &&
		Math.max.apply(null, modes.map((gm) => PROTO.toBUFFER.gamemode[gm])) === modes.length - 1,
		modes.map((gm) => gm + '=' + PROTO.toBUFFER.gamemode[gm]).join(' '));
}

console.log('obstar room tests\n');
const rooms = [];
rooms.push(ffaTests()); console.log('');
rooms.push(teamTests()); console.log('');
rooms.push(fourTeamTests()); console.log('');
rooms.push(bossTests()); console.log('');
respawnTests(rooms);
modeTableTests(rooms);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
