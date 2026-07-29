/*
	Room tests: the gamemode behaviour that test/smoke.js cannot see.

	smoke.js drives a real socket and proves the pipe from socket -> room -> encoder -> socket
	is intact, but every assertion it makes is true of any room. Teams, bases, bot rosters,
	colours and respawn xp are exactly the things that differed between the old Ffa and
	TwoTeam copies, so they are exactly what a shared rooms/Room.js has to be pinned on.

	All four modes are covered: '4team' and 'boss' were written against this base without
	touching rooms/Room.js's tick, and the shared block at the bottom runs the same rules over
	every one of them, which is the assertion that the base really did fit.

	No server and no socket: lib/boot.js constructs the Controller, and the rooms are built and
	poked directly.

		node test/rooms.js        (npm test runs this and smoke.js)
*/
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');

const controller = require(path.join(ROOT, 'lib', 'boot.js'))();
const ROOMS = require(path.join(ROOT, 'rooms', 'index.js'));

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
	const room = controller.newServer(gm);
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
	check('map is the ffa map', room.map.width === 12628 && room.map.height === 12628,
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
		if (d(0, 0) <= 1540 || d(room.map.width / 4, room.map.height / 4) <= 1120 ||
			d(-room.map.width / 4, -room.map.height / 4) <= 1120) { clear = false; }
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
	check('map is the 2team map', room.map.width === 11200 && room.map.height === 11200,
		room.map.width + 'x' + room.map.height);

	// basePosts() is consumed by the constructor, so the drones are there from the start.
	// 15 orbit centres a side, two drones on each (massplanchunks WP-E) - the wiki's "30 in
	// total, spread evenly in pairs", which counts one side.
	const drones = [...room.INSTANCE.bullets.live()].filter((b) => b.alone);
	check('both bases are guarded', drones.length === 60, drones.length + ' drones');
	check('the guards are split evenly', drones.filter((d) => d.team === 0).length === 30,
		drones.filter((d) => d.team === 0).length + ' on team 0');
	const leftGuards = drones.filter((d) => d.x < 0);
	check('each side guards its own half',
		leftGuards.length === 30 && leftGuards.every((d) => d.team === 0));
	check('the drones sit in pairs on 15 rings a side',
		new Set(drones.filter((d) => d.team === 0).map((d) => d.oy)).size === 15,
		new Set(drones.filter((d) => d.team === 0).map((d) => d.oy)).size + ' distinct centres');
	// Radius is quantised into five shared energy levels now (plan.md WP4.5.1), not a per-mode
	// random band - every drone sits exactly on room.levelR(its level), and a pair's two levels
	// are not both the same (levelPlan(2)'s initial occupancy is one drone each on two levels).
	{
		check('every 2team drone sits exactly on its own energy level\'s radius',
			drones.every((d) => Math.abs(d.orbRTarget - room.levelR(d.level)) < 1e-9));
		check('...and levels are not all pinned to one ring',
			new Set(drones.map((d) => d.level)).size > 1);
	}

	// Sides are balanced on join, so four players come out two and two.
	for (let i = 0; i < 3; i++) {
		room.ask({ name: 'tester' + i, key: '0'.repeat(25), pet: -1, gm: '2team' });
	}
	const sides = [0, 0];
	for (let i = 0; i < 4; i++) { sides[player(room, i).team]++; }
	check('joins are balanced across the sides', sides[0] === 2 && sides[1] === 2, sides.join('/'));

	// edge is the base line on either side (matches TwoTeam.inEnemyBase's own calc) - x values
	// below are 500 past/short of it, map-relative so they follow the grid rescale (plan.md WP1).
	const edge = room.map.width / 2 - room.baseSize;
	const zero = { team: 0 }, one = { team: 1 };
	check('team 0 dies in team 1\'s base', room.inEnemyBase({ team: 0, x: edge + 500 }) === true);
	check('team 0 is safe in its own', room.inEnemyBase({ team: 0, x: -(edge + 500) }) === false);
	check('team 1 dies in team 0\'s base', room.inEnemyBase({ team: 1, x: -(edge + 500) }) === true);
	check('team 1 is safe in its own', room.inEnemyBase({ team: 1, x: edge + 500 }) === false);
	check('midfield is safe for both', room.inEnemyBase({ team: 0, x: 0 }) === false &&
		room.inEnemyBase({ team: 1, x: 0 }) === false);
	check('the boss belongs to neither base', room.inEnemyBase({ team: 9, x: edge + 500 }) === false);

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
	const config = require(path.join(ROOT, 'lib', 'config.js')).config;
	const room = makeRoom('4team');

	check('four sides', room.rules.teams.length === 4, room.rules.teams.join(','));
	check('team ids are colour indices', room.rules.teams.join(',') === '0,1,2,3');
	check('friendly fire is off', room.rules.teamPlay === true);

	const drones = [...room.INSTANCE.bullets.live()].filter((b) => b.alone);
	check('every base is guarded', drones.length === 48, drones.length + ' drones');
	check('the guards are split evenly across four sides',
		[0, 1, 2, 3].every((t) => drones.filter((d) => d.team === t).length === 12),
		[0, 1, 2, 3].map((t) => drones.filter((d) => d.team === t).length).join('/'));
	// Each side's guards must sit in that side's corner and nowhere else.
	const placed = drones.every((d) => {
		const c = room.corner(d.team);
		return Math.sign(d.x) === Math.sign(c.x) && Math.sign(d.y) === Math.sign(c.y);
	});
	check('each side guards its own corner', placed);
	// All twelve share one orbit centre - the square's middle - which is what the diameter
	// cross needs (massplanchunks WP-E).
	check('a base\'s twelve drones share one orbit centre, the square\'s middle',
		[0, 1, 2, 3].every((t) => {
			const c = room.baseCenter(t);
			return drones.filter((d) => d.team === t).every((d) => d.ox === c.x && d.oy === c.y);
		}));
	// Phases are randomised now (plan.md WP2), not evenly spaced - assert they are not all
	// stacked on one spot rather than that they are evenly distributed.
	check('...and are randomly phased around it, not stacked',
		new Set(drones.filter((d) => d.team === 0).map((d) => Math.round(d.autoDir * 1e6))).size === 12);
	check('the outermost energy level fits inside the square',
		room.levelR(config.BASE_DRONE_LEVELS) < room.baseSize / 2,
		room.levelR(config.BASE_DRONE_LEVELS) + ' vs half-square ' + room.baseSize / 2);

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

	/*
		lib/gameAI.js's Summoner detection divided by n.level with no floor, so raw/0 is
		Infinity and a level-0 target never clears the `dis < n.screen/30` check - meaning a
		just-respawned player (rooms/Room.js's respawn() hands back a fresh Player, always
		level 0) was invisible to every boss until they levelled back up. Stand a level-0 human
		right on top of a boss and step the room twice: once to let motion() build the boss's
		Detector (a step it does not have yet), once more so the collision pass it now runs can
		actually populate DETEC.selectAll for that Detector to read.
	*/
	{
		const me = player(room, 0);
		const boss = room.bosses[0];
		me.level = 0;
		me.shield = 0;
		me.alpha = 1;
		me.x = boss.x;
		me.y = boss.y;
		room.step();
		room.step();
		check('the summoner detects a level-0 (freshly respawned) player standing next to it',
			boss.detected.includes(me), 'detected ' + boss.detected.length + ' players');
	}

	return room;
}

/// Sandbox ///////////////////////////////////////////////////////////////////
/*
	Single-player practice room: same level cap as ffa (so 'k' has nowhere further to reach
	than the rest of the game ever sees), a small arena, and exactly one player slot - see the
	comment on rooms/Sandbox.js's maxPlayer for why that has to be 0, not 1.
*/
function sandboxTests() {
	console.log('rooms (sandbox):');
	const room = makeRoom('sandbox');

	check('level cap matches ffa - "k" tops out at the real max level', room.XPLVL[room.XPLVL.length - 1] === 25000,
		room.XPLVL[room.XPLVL.length - 1]);
	check('the arena is small', room.map.width === 4200 && room.map.height === 4200,
		room.map.width + 'x' + room.map.height);
	check('no bots', room.rules.botCount === 0 && room.botRoster().length === 0);

	const me = player(room, 0);
	check('first player takes slot 0', !!me && me.id.oId === 0);
	const second = room.ask({ name: 'tester2', key: '0'.repeat(25), pet: -1, gm: 'sandbox' });
	check('a second player is refused - single-player only', second === undefined, second);

	// 'k'/'o' are net/gameSocket.js keydown cases, not Room methods - what belongs to the room
	// is that it hands out a real XP ceiling for that handler to set, and that the ordinary
	// death path (used for the 'o' self-kill) still works with nobody else in the room.
	me.xp = room.XPLVL[room.XPLVL.length - 1];
	for (let i = 0; i < room.XPLVL.length; i++) { me.update(); }
	check('max xp actually climbs to the real max level', me.level === room.XPLVL.length,
		me.level);
	me.hp = 0;
	me.update();
	check('zero hp kills you same as anywhere else', me.destroy > 0 && me.dead > 0,
		'destroy=' + me.destroy + ' dead=' + me.dead);

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
	const modes = Object.keys(ROOMS);

	check('every mode has a room class', modes.every((gm) => typeof ROOMS[gm] === 'function'),
		modes.join(','));
	check('every mode has a room list on the Controller',
		modes.every((gm) => Array.isArray(controller.server[gm])), modes.join(','));
	check('the Controller has no room list for a mode that does not exist',
		Object.keys(controller.server).every((gm) => !!ROOMS[gm]),
		Object.keys(controller.server).join(','));
	check('every room reports the gamemode it is filed under',
		rooms.every((r) => ROOMS[r.gm] === r.constructor),
		rooms.map((r) => r.gm).join(','));

	// The round trip the client actually performs: encode the mode to a byte, decode it back.
	const roundTrip = modes.filter((gm) => PROTO.toSTRING.gamemode[PROTO.toBUFFER.gamemode[gm]] !== gm);
	check('every mode survives the encode/decode round trip', roundTrip.length === 0,
		'broken: ' + roundTrip.join(','));
	check('every mode has a wire value',
		modes.every((gm) => typeof PROTO.toBUFFER.gamemode[gm] === 'number'), modes.join(','));
	check('the wire enum lists nothing the server cannot serve',
		PROTO.toSTRING.gamemode.every((gm) => !!ROOMS[gm]),
		PROTO.toSTRING.gamemode.join(','));
	check('the wire values are dense and unique',
		new Set(modes.map((gm) => PROTO.toBUFFER.gamemode[gm])).size === modes.length &&
		Math.max.apply(null, modes.map((gm) => PROTO.toBUFFER.gamemode[gm])) === modes.length - 1,
		modes.map((gm) => gm + '=' + PROTO.toBUFFER.gamemode[gm]).join(' '));
}

/*
	respawn() swaps in a brand-new Player, so anything its constructor zeroes has to be
	carried across by hand or it silently resets on every death - see the comment inside
	rooms/Room.js's respawn(). A held movement key is the concrete case: the client only
	re-sends 'keydown' on an actual state change (net/gameSocket.js), so a key already held at
	the moment of death would otherwise arrive on the new tank looking exactly like "never
	pressed" - and since shield (spawn protection) only clears inside motion()/shoot() when they
	see real input, that silently extended spawn protection, which Detector.js hides from every
	boss/bot, until the player happened to press something new.
*/
function respawnCarryoverTests(rooms) {
	console.log('\nrespawn carries live player state:');
	const room = rooms[0];
	const before = player(room, 0);
	before.inputs.w = 1;
	before.userKey = 'a'.repeat(25);
	before.unlocked = { first_blood: 1 };
	before.killCounts = { sqr: 42 };
	room.respawn(0, 1);
	const after = player(room, 0);
	check('a held key survives the respawn', after.inputs.w === 1, after.inputs.w);
	check('userKey survives the respawn (achievement persistence needs it)',
		after.userKey === before.userKey, after.userKey);
	check('unlocked achievements survive the respawn', after.unlocked.first_blood === 1,
		JSON.stringify(after.unlocked));
	check('kill-count progress survives the respawn', after.killCounts.sqr === 42,
		JSON.stringify(after.killCounts));
	check('spawn protection still starts fresh', after.shield > 0, after.shield);
	after.motion();
	check('...and clears immediately given the carried-over held key', after.shield === 0,
		after.shield);
}

/*
	Base drones (massplanchunks WP-E). Three separate things used to make these immortal - the
	type-1.4 AI re-set pene every tick, bullet-vs-bullet collision exempted type 1.4 outright, and
	the pene/5 self-consumption against a player would have killed a 2000-HP drone in five ticks of
	contact anyway. All three are covered here, plus placement, respawn and the base fence's
	bullet margin.
*/
function baseDroneTests() {
	console.log('\nbase drones (massplanchunks WP-E):');
	const config = require(path.join(ROOT, 'lib', 'config.js')).config;
	const tick = require(path.join(ROOT, 'lib', 'tick.js'));
	const KIND = require(path.join(ROOT, 'public', 'SHARE', 'kinds.js'));
	const room = makeRoom('2team');

	const post = room.dronePosts[0];
	const drone = room.INSTANCE.bullets.get(post.slot);
	check('a base drone collision radius is 9.2 units, drawing a 28-unit (1 gu) triangle side',
		drone.size === config.BASE_DRONE_SIZE, drone.size);
	{
		const World = require(path.join(ROOT, 'public', 'SHARE', 'World.js'));
		const drawnSide = config.BASE_DRONE_SIZE * 3.05;
		check('the drawn drone side (size * 1.7 * 1.79) is within 5% of gu(1)',
			Math.abs(drawnSide - World.gu(1)) / World.gu(1) < 0.05, drawnSide);
	}
	check('its pene IS its health pool, not a spend-down budget',
		drone.pene === config.BASE_DRONE_HP, drone.pene);
	check('it hits for the scale-consistent body damage', drone.damage === config.BASE_DRONE_DAMAGE,
		drone.damage);

	// The AI used to do `this.pene = 200` every tick, which no amount of damage could outrun.
	drone.pene = 500;
	drone.update();
	check('update() no longer re-sets pene - the drone is actually killable', drone.pene === 500,
		drone.pene);
	drone.pene = config.BASE_DRONE_HP;

	// Same-team protection has to survive removing the blanket type-1.4 exemption, and it is
	// rooms/Room.js's noDam flag that carries it - including the knockback, since every vec.add()
	// sits after the noDam break.
	const mate = { kind: KIND.BULLET, origin: { oId: 999 }, x: drone.x + 1, y: drone.y, type: 0 };
	const peneBefore = drone.pene, speedBefore = drone.vec.length();
	drone.collision(mate, { noDam: 1, pene: 50 });
	check('a same-team bullet damages a base drone not at all', drone.pene === peneBefore,
		drone.pene);
	check('...and does not shove it either', drone.vec.length() === speedBefore);
	drone.collision(mate, { pene: 50 });
	check('an enemy bullet does damage it now - they used to be exempt outright',
		drone.pene < peneBefore, drone.pene);

	// Against a player the drone must take the PLAYER's body damage, not pene/5 of its own pool:
	// at pene 2000 the old formula was 400 a tick, i.e. dead in five ticks of contact.
	drone.pene = config.BASE_DRONE_HP;
	drone.collision({ kind: KIND.PLAYER, id: { oId: 0 }, damage: 8.48485, x: drone.x + 1, y: drone.y }, {});
	check('touching a player costs it that player\'s body damage, not a fifth of its own health',
		drone.pene > config.BASE_DRONE_HP - 20, drone.pene);

	// ...and now the other direction of the same trap - plan.md WP4.5.11. The drone's 2000-point
	// `pene` is health, not penetration; read as penetration by entities/Player.js it multiplied
	// contact damage by 400 and killed any tank in one tick.
	{
		const victim = player(room, 0);
		victim.hp = victim.maxHp = 1000; victim.shield = 0; victim.dev.ghost = 0;
		victim.collision(drone, {});
		const perTick = 1000 - victim.hp;
		check('a base drone does one tick of body damage, not 400 of them',
			perTick > 1 && perTick < 3, perTick);
		check('...so a maxed tank survives a lone drone for over ten seconds',
			1000 / (perTick * (1000 / config.TICK_MS)) > 10);
	}

	// Respawn: the post empties, then refills a wall-clock second later.
	// Note the post's slot id is NOT a stable identity here: SlotMap recycles an id once its
	// tombstone expires, so the replacement drone can legitimately land back on the same index.
	// What matters is that the post is empty for about a second and occupied after it.
	const wait = tick.ticks(config.BASE_DRONE_RESPAWN);
	room.INSTANCE.bullets.get(post.slot).destroy = 1;
	room.step();
	check('a killed drone leaves its post empty', !room.INSTANCE.bullets.get(post.slot));
	for (let i = 0; i < wait - 3; i++) { room.step(); }
	check('...and stays empty for the respawn delay', !room.INSTANCE.bullets.get(post.slot));
	for (let i = 0; i < 5; i++) { room.step(); }
	const back = room.INSTANCE.bullets.get(post.slot);
	check('...but a new one is orbiting that post about a second later',
		!!back && back.type === 1.4 && back.pene === config.BASE_DRONE_HP,
		back && back.pene);

	// The base fence: a player dies on the line, a bullet gets BASE_BULLET_MARGIN past it.
	const M = config.BASE_BULLET_MARGIN;
	const edge = room.map.width / 2 - room.baseSize;
	check('a player dies exactly at the base line', room.inEnemyBase({ team: 0, x: edge + 1 }, 0) === true);
	check('an enemy bullet survives just short of the margin',
		room.inEnemyBase({ team: 0, x: edge + M - 1 }, M) === false);
	check('...and dies just past it', room.inEnemyBase({ team: 0, x: edge + M + 1 }, M) === true);

	// Drones live inside a base by definition - the inset must not start fencing them out.
	const four = makeRoom('4team');
	for (const r of [room, four]) {
		const guards = [...r.INSTANCE.bullets.live()].filter((b) => b.alone);
		check(r.gm + ': no base drone is ever fenced out of its own base',
			guards.every((d) => r.inEnemyBase(d, M) === false && r.inEnemyBase(d, 0) === false));
	}

	// 4team's base is a square now, not a quarter-disc: a point on the diagonal at 0.9*baseSize
	// from the corner is outside a disc of that radius but inside the square.
	const c = four.corner(1);
	const diag = { team: 0, x: c.x - Math.sign(c.x) * 0.9 * four.baseSize, y: c.y - Math.sign(c.y) * 0.9 * four.baseSize };
	check('4team bases are squares - the corner diagonal is inside, where a disc would miss it',
		four.inEnemyBase(diag) === true);
	check('...and a point past the square on one axis only is outside',
		four.inEnemyBase({ team: 0, x: c.x - Math.sign(c.x) * (four.baseSize + 10), y: c.y }) === false);
}

/*
	The fastest sustained speed any reachable build can hold (plan.md WP4.5.1), by replaying
	entities/Player.js's own motion() + shoot() recurrence rather than trusting a number in a
	comment: thrust is +x and the facing is swept, so each class rides its own recoil optimally;
	drone cannons (life -1, capped by maxDrone) contribute no sustained recoil because the drones
	stay alive; auto turrets do not aim where a rider needs them; a class is only counted from the
	level its tier unlocks at (upClass's parseInt(level/15) > tier), and never below the first level
	that can buy a full Movement Speed AND a full Reload bar - both derived from entities/Player.js's
	own economy (PENDING #30) rather than restated here.
	Returns u/s. This is what BASE_DRONE_CHASE_SPEED is pinned to, so a
	cannon retune that changes the ceiling fails this test instead of silently outrunning the drones.
*/
function fastestTankSpeed() {
	const config = require(path.join(ROOT, 'lib', 'config.js')).config;
	const tick = require(path.join(ROOT, 'lib', 'tick.js'));
	const Physics = require(path.join(ROOT, 'public', 'SHARE', 'Physics.js'));
	const T = require(path.join(ROOT, 'public', 'SHARE', 'TanksConfig.js'));
	const P = require(path.join(ROOT, 'entities', 'Player.js'));
	const MAXUP = P.MAX_PER_STAT, TOUS = 1000 / config.REF_TICK_MS;
	// The first level whose granted points cover a maxed Movement Speed and a maxed Reload.
	let ridable = P.LEVEL_CAP;
	for (let l = 1; l <= P.LEVEL_CAP; l++) {
		if (P.pointsAtLevel(l) >= MAXUP * 2) { ridable = l; break; }
	}
	const minLevel = { Basic: 0 };
	for (let i = 0; i < T.tree.length; i++) {
		const unlock = 15 * (i + 1);
		for (let pass = 0; pass < T.tree.length; pass++) {
			for (const from in T.tree[i]) {
				if (!(from in minLevel)) { continue; }
				for (const to of T.tree[i][from]) {
					const cand = Math.max(unlock, minLevel[from]);
					if (!(to in minLevel) || minLevel[to] > cand) { minLevel[to] = cand; }
				}
			}
		}
	}
	const run = (cls, level, dir, ticks = 3000) => {
		const accel = Physics.moveAccel(MAXUP, level);
		const upReload = 1 - MAXUP * 0.0788571;   // entities/Player.js's per-point Reload step
		const body = { x: 0, y: 0, vx: 0, vy: 0 }, timer = [];
		let sum = 0, n = 0;
		for (let t = 0; t < ticks; t++) {
			Physics.stepBody(body, accel, 0, tick.SCALE);
			for (let r = 0; r < cls.cannons.length; r++) {
				if (typeof timer[r] === 'undefined') { timer[r] = 0; }
				const can = cls.cannons[r];
				if (can.autoShoot || can.autoDir) { continue; }
				if (can.life === -1 && cls.maxDrone) { continue; }
				const reloadMax = tick.ticks(Math.round(can.reload * upReload));
				const reload = timer[r];
				if (reload === Math.floor(can.offTime * reloadMax)) {
					const rd = dir + (can.offdir || 0) - Math.PI;
					body.vx += tick.perTick(can.back) * Math.cos(rd);
					body.vy += tick.perTick(can.back) * Math.sin(rd);
				}
				if (timer[r] === 0) { timer[r] += 1; continue; }
				if (reload > 0 && reload < reloadMax) { timer[r] += 1; }
				else if (reload >= reloadMax) { timer[r] = 0; }
			}
			if (t > ticks / 2) { sum += body.vx * TOUS; n++; }
		}
		return sum / n;
	};
	let best = 0, who = '';
	for (const name of T.list) {
		const cls = T.class[name];
		if (!cls || !cls.cannons || !cls.cannons.length || !(name in minLevel)) { continue; }
		// Only the LOWEST level a class can be reached at is tested: Physics.moveAccel divides by
		// MOVE_LEVEL_DIV^level and nothing else in this recurrence depends on level, so a class's
		// speed decreases strictly with level. Sweeping all 45 costs 30x the time and returns the
		// same answer (checked). Still true after PENDING #14 made the level term a divisor rather
		// than a subtraction - strictly decreasing either way, and now without the level-54 zero.
		const level = Math.max(minLevel[name], ridable);
		for (let k = 0; k < 36; k++) {
			const v = run(cls, level, k * Math.PI / 18);
			if (v > best) { best = v; who = name + ' L' + level; }
		}
	}
	return { speed: best, build: who };
}

/*
	Base drone AI corrections (plan.md WP4/WP4.5/WP4.5.x - not WP4.5-specific any more, hence the
	name; distinct from baseDroneTests() above, which covers the WP-E core - immortality, placement,
	respawn, the base fence). Everything WP4's audit found wrong in a browser: same-team
	transparency, the cross plowing through shapes rather than phasing through them, the
	steered-motion rewrite (no state can turn or stop the drone instantly), the orbit centre sitting
	in the middle of the base rather than low and outboard in it, the plateau swoosh, the
	clamp/stale-target chase bugs, and the broad-phase rewrite.
*/
function baseDroneAiTests() {
	console.log('\nbase drone corrections (plan.md WP4.5):');
	const config = require(path.join(ROOT, 'lib', 'config.js')).config;
	const tick = require(path.join(ROOT, 'lib', 'tick.js'));
	const Objects = require(path.join(ROOT, 'entities', 'Objects.js'));
	const Bullet = require(path.join(ROOT, 'entities', 'Bullet.js'));
	const Player = require(path.join(ROOT, 'entities', 'Player.js'));

	// A hand-built per-centre ledger for tests that want to isolate a single drone's mechanics
	// rather than spawn a real base (plan.md WP4.5.0 added target/targets/threat/crossCap/
	// scoutIdx/scoutTimer/sortTimer to what rooms/Room.js's levelPlan() hands back - a literal
	// missing them would make a forced cross silently refuse to start, since
	// `levels.crossing < levels.crossCap` is `0 < undefined` = false). crossCap defaults to 1 -
	// plenty for a single isolated drone; sortTimer/scoutTimer start high so the per-centre
	// maintenance pass (driven from a real room's step(), not from a bare drone.update() these
	// tests mostly use) never fires unexpectedly mid-test.
	function makeLevels(caps, count) {
		return {
			caps: caps, count: count.slice(), crossing: 0, crossCap: 1,
			target: caps.slice(), targets: {}, threat: null,
			provoked: 0, provokedAt: 0,
			scoutIdx: 0, scoutTimer: 1e9, sortTimer: 1e9
		};
	}

	// 4.5.2b - tunnelling headroom: the fastest thing a drone ever does (the cross dash, and now
	// the chase/return dash too - plan.md WP4.5.1) must still be slower than its own size plus the
	// smallest polygon radius, or a fast enough drone could step clean through a shape between
	// collision checks.
	check('no tunnelling: a cross-speed step stays under drone size + smallest polygon radius',
		tick.perTick(config.BASE_DRONE_CROSS_SPEED) < config.BASE_DRONE_SIZE + 20,
		tick.perTick(config.BASE_DRONE_CROSS_SPEED) + ' vs ' + (config.BASE_DRONE_SIZE + 20));
	check('...and neither does a chase/return-speed step',
		tick.perTick(config.BASE_DRONE_CHASE_SPEED) < config.BASE_DRONE_SIZE + 20,
		tick.perTick(config.BASE_DRONE_CHASE_SPEED) + ' vs ' + (config.BASE_DRONE_SIZE + 20));
	// plan.md WP4.5.1: CHASE_SPEED is now pinned to the fastest tank in the game (400 u/s), well
	// past the cross's own 370 u/s - so the bound above is being checked against the real maximum.
	check('CHASE_SPEED is the larger of the two - the tunnelling bound is checked against the real max',
		tick.perTick(config.BASE_DRONE_CHASE_SPEED) > tick.perTick(config.BASE_DRONE_CROSS_SPEED),
		tick.perTick(config.BASE_DRONE_CHASE_SPEED) + ' vs ' + tick.perTick(config.BASE_DRONE_CROSS_SPEED));

	// ---- WP4.5.1: the chase is exactly as fast as the fastest tank this game can build ------------
	{
		const fastest = fastestTankSpeed();
		const chaseUs = tick.perTick(config.BASE_DRONE_CHASE_SPEED) * (1000 / config.TICK_MS);
		console.log('  note fastest sustainable build in this game: ' + fastest.speed.toFixed(1) +
			' u/s (' + fastest.build + '); BASE_DRONE_CHASE_SPEED is ' + chaseUs.toFixed(1) + ' u/s');
		// The whole point of measuring rather than hard-coding: a cannon or stat retune that raises
		// the ceiling fails HERE instead of quietly leaving base drones outrunnable (or absurd). Do
		// not pin the class, the level or the number - only the agreement.
		check('BASE_DRONE_CHASE_SPEED is within 5% of the fastest sustainable build in this game',
			Math.abs(chaseUs - fastest.speed) / fastest.speed < 0.05,
			chaseUs.toFixed(1) + ' vs ' + fastest.speed.toFixed(1) + ' u/s (' + fastest.build + ')');
	}

	// ---- WP4.5.1: a chase and a return actually run at that speed ---------------------------------
	{
		const room = makeRoom('4team');
		const post = room.dronePosts.find((p) => p.level === config.BASE_DRONE_LEVEL_HOME);
		const drone = room.INSTANCE.bullets.get(post.slot);
		const V_CHASE = tick.perTick(config.BASE_DRONE_CHASE_SPEED);
		const V_ORB = tick.perTick(config.BASE_DRONE_ORBIT_SPEED);
		drone.crossIn = 1e9;
		drone.update();

		// A chase. The target is stationary and parked toward the map centre, well inside
		// BASE_DRONE_LEASH of the base centre so the chase is never abandoned mid-measurement, and
		// far enough that 60 ticks of dashing cannot reach it.
		const sx = drone.ox > 0 ? -1 : 1, sy = drone.oy > 0 ? -1 : 1;
		// Acquisition is centralised through levels.threat now (plan.md WP4.5.0) - set both so this
		// test doesn't depend on whether `drone` happens to be its centre's current scout.
		drone.levels.threat = drone.DETEC.select = { x: drone.ox + sx * 1400, y: drone.oy + sy * 1400, destroy: 0 };
		let lastTwenty = [];
		for (let i = 0; i < 60; i++) {
			drone.update();
			if (i >= 40) { lastTwenty.push(Math.hypot(drone.vec.x, drone.vec.y)); }
		}
		const chaseSpd = lastTwenty.reduce((a, b) => a + b, 0) / lastTwenty.length;
		check('a chase settles at BASE_DRONE_CHASE_SPEED, within 5%',
			drone.chasing && Math.abs(chaseSpd - V_CHASE) / V_CHASE < 0.05,
			chaseSpd.toFixed(3) + ' vs ' + V_CHASE.toFixed(3) + (drone.chasing ? '' : ' (not chasing!)'));

		// A return. A return is a chase back to the ring, so it dashes at the same speed - and then
		// has to SETTLE onto the ring rather than ring around it, which is what the third assertion
		// catches if CHASE_TURN or RETURN_ERR is ever retuned against the new speed.
		drone.chasing = false; drone.DETEC.select = 0; drone.DETEC.reset(); drone.DETEC.enabled = 1;
		drone.levels.threat = null;
		drone.crossing = false; drone.switching = false; drone.crossIn = 1e9;
		drone.x = drone.ox + sx * drone.orbRTarget * 5; drone.y = drone.oy;
		let peak = 0, arrivedAt = -1;
		for (let i = 0; i < 400 && arrivedAt < 0; i++) {
			drone.update();
			drone.DETEC.select = 0;   // no chase may hijack the return under test
			peak = Math.max(peak, Math.hypot(drone.vec.x, drone.vec.y));
			if (Math.abs(Math.hypot(drone.x - drone.ox, drone.y - drone.oy) - drone.orbRTarget) < 5) { arrivedAt = i; }
		}
		check('a long return peaks at BASE_DRONE_CHASE_SPEED too, within 5%',
			Math.abs(peak - V_CHASE) / V_CHASE < 0.05, peak.toFixed(3) + ' vs ' + V_CHASE.toFixed(3));
		check('...and arrives on its ring inside 400 ticks', arrivedAt >= 0, arrivedAt + ' ticks');
		let worstErr = 0;
		for (let i = 0; i < 200; i++) {
			drone.update();
			drone.DETEC.select = 0;
			worstErr = Math.max(worstErr, Math.abs(Math.hypot(drone.x - drone.ox, drone.y - drone.oy) - drone.orbRTarget));
		}
		check('...then settles onto it without ringing around it (never more than LEVEL_GAP/2 off)',
			worstErr <= config.BASE_DRONE_LEVEL_GAP / 2,
			worstErr.toFixed(2) + ' vs ' + (config.BASE_DRONE_LEVEL_GAP / 2));

		// And steady state is untouched by any of it - cruise is still cruise.
		let slowest = Infinity, fastestSpd = 0;
		for (let i = 0; i < 200; i++) {
			drone.update();
			drone.DETEC.select = 0;
			const s = Math.hypot(drone.vec.x, drone.vec.y);
			slowest = Math.min(slowest, s); fastestSpd = Math.max(fastestSpd, s);
		}
		check('a settled drone still cruises at BASE_DRONE_ORBIT_SPEED, within 3%',
			Math.abs(slowest - V_ORB) / V_ORB < 0.03 && Math.abs(fastestSpd - V_ORB) / V_ORB < 0.03,
			slowest.toFixed(3) + '-' + fastestSpd.toFixed(3) + ' vs ' + V_ORB.toFixed(3));
	}

	// 4.5.2a - shape damage is sane: a base drone's `pene` is a 2000-point health pool, not a
	// penetration value: reading it as one used to one-shot every shape a drone brushed.
	{
		const room = makeRoom('2team');
		const post = room.dronePosts[0];
		const drone = room.INSTANCE.bullets.get(post.slot);
		const sq = new Objects('sqr', -1, { GM: room.gm, sId: room.id, oId: 500 }, room.map, room);
		const hpBefore = sq.hp;
		sq.collision(drone, { pene: drone.pene });
		const dropExpected = tick.perTick(0.5 * config.BASE_DRONE_DAMAGE);
		check('a base drone grinds a shape down (pene/2 * damage), not one-shots it (pene * damage)',
			Math.abs((hpBefore - sq.hp) - dropExpected) < 1e-6,
			(hpBefore - sq.hp) + ' vs ' + dropExpected);
		check('...nowhere near enough to vaporise it in one tick', (hpBefore - sq.hp) < sq.maxHp / 2,
			(hpBefore - sq.hp) + ' of ' + sq.maxHp);
	}

	// 4.5.2 - the cross ploughs through shapes, it does not phase through them: damage and shove
	// still happen mid-swoosh, only the drone's own 60-degree deflection reaction is suppressed.
	{
		const room = makeRoom('2team');
		const post = room.dronePosts[0];
		const drone = room.INSTANCE.bullets.get(post.slot);
		drone.crossing = true;
		drone.switchCooldown = 0;
		const targetBefore = drone.orbRTarget;
		const sq = new Objects('sqr', -1, { GM: room.gm, sId: room.id, oId: 501 }, room.map, room);
		const hpBefore = sq.hp, vecBefore = sq.vec.length();
		sq.collision(drone, { pene: drone.pene });
		check('mid-swoosh, a drone still damages a shape it touches', sq.hp < hpBefore, sq.hp + ' vs ' + hpBefore);
		check('...and still shoves it', sq.vec.length() !== vecBefore, sq.vec.length() + ' vs ' + vecBefore);
		drone.collision(sq, {});
		check('...but the drone\'s own shape-hit reaction (orbRTarget) does not fire mid-swoosh',
			drone.orbRTarget === targetBefore, drone.orbRTarget + ' vs ' + targetBefore);
	}

	// 4.5.1 - team transparency, exercised through the real collision pair loop in rooms/Room.js's
	// step(), not just entities/Bullet.js's own noDam branch: the skip this pass adds runs before
	// that branch is ever reached, so it has to be proven at the pair-loop level.
	{
		function plantBullet(room, team, x, y) {
			const b = new Bullet({ GM: room.gm, sId: room.id, oId: 0 }, x, y, 0, 0, 0, room);
			b.team = team; b.alone = 1; b.life = -1;
			b.pene = 100; b.damage = 5; b.size = 10; b.map = room.map;
			room.INSTANCE.bullets.add((id) => { b.id = { GM: room.gm, sId: room.id, oId: id }; return b; });
			return b;
		}
		function plantPlayer(room, team, x, y) {
			const p = room.INSTANCE.players.add((id) => new Player(
				{ GM: room.gm, sId: room.id, oId: id }, x, y, 'mate', team, room.XPLVL, room));
			p.shield = 0; p.alpha = 1;
			return p;
		}
		// Every pair below is planted at the map centre, not at the drone's own (in-base) spawn
		// point: standing inside a base you don't own is a separate, pre-existing rule (the base
		// fence, tested in baseDroneTests()) that kills a player/bullet outright on its own turn
		// in the pair loop, before pairwise collision is ever reached - it would confound this
		// test rather than exercise it. Midfield (0,0) is safe for every side (see teamTests'/
		// fourTeamTests' "midfield is safe" checks), so this isolates the one thing being tested:
		// the WP4.5.0 same-team skip.
		function isolatedRoom() {
			const room = makeRoom('2team');
			player(room, 0).destroy = 1;   // the tester seat - inert, out of everyone's way
			return room;
		}

		{
			const room = isolatedRoom();
			const drone = room.INSTANCE.bullets.get(room.dronePosts[0].slot);
			drone.x = 0; drone.y = 0;
			const mate = plantBullet(room, drone.team, 0, 0);
			const droneBefore = drone.pene, vecBefore = mate.vec.length();
			room.step();
			check('a same-team bullet does not damage a base drone, nor it them, via the real pair loop',
				drone.pene === droneBefore && mate.pene === 100,
				drone.pene + '/' + droneBefore + ', ' + mate.pene);
			check('...nor does it shove the bullet (no knockback either)', mate.vec.length() === vecBefore);
		}
		{
			const room = isolatedRoom();
			const drone = room.INSTANCE.bullets.get(room.dronePosts[0].slot);
			drone.x = 0; drone.y = 0;
			plantBullet(room, drone.team ? 0 : 1, 0, 0);
			const droneBefore = drone.pene;
			room.step();
			check('an enemy bullet damages a base drone - the pair is not skipped',
				drone.pene < droneBefore, drone.pene + ' vs ' + droneBefore);
		}
		{
			const room = isolatedRoom();
			const drone = room.INSTANCE.bullets.get(room.dronePosts[0].slot);
			drone.x = 0; drone.y = 0;
			const mate = plantPlayer(room, drone.team, 0, 0);
			// A fresh Player can gain a little hp on its very first update() regardless of any
			// collision (the same auto-level-at-xp-0 quirk fovTests documents), so "not damaged"
			// is checked as "hp did not drop", not exact equality.
			const mateBefore = mate.hp, droneBefore = drone.pene;
			room.step();
			check('a same-team tank does not damage a base drone, nor it them',
				mate.hp >= mateBefore && drone.pene === droneBefore,
				mate.hp + '/' + mateBefore + ', ' + drone.pene + '/' + droneBefore);
		}
		{
			const room = isolatedRoom();
			const drone = room.INSTANCE.bullets.get(room.dronePosts[0].slot);
			drone.x = 0; drone.y = 0;
			const foe = plantPlayer(room, drone.team ? 0 : 1, 0, 0);
			// One step first, to burn off the fresh-Player auto-level-at-xp-0 hp bump the same-team
			// case above documents: a drone's contact damage is ~1.9 hp a tick now that it is read
			// against BASE_DRONE_PENE rather than its 2000-point health pool (plan.md WP4.5.11), and
			// that bump is bigger than it. Both are put back on the centre line for the measured step.
			room.step();
			drone.x = 0; drone.y = 0; foe.x = 0; foe.y = 0;
			const foeBefore = foe.hp, droneBefore = drone.pene;
			room.step();
			check('an enemy tank and a base drone trade damage, in every state',
				foe.hp < foeBefore && drone.pene < droneBefore,
				foe.hp + '/' + foeBefore + ', ' + drone.pene + '/' + droneBefore);
			// ...and the drone's share of it is one tick of body damage, not 400 of them - the
			// entities/Player.js half of the pene-is-health trap (plan.md WP4.5.11), through the real
			// pair loop rather than a direct collision() call.
			check('...and the tank\'s share is survivable - a base drone is not an instant kill',
				(foeBefore - foe.hp) < 5, (foeBefore - foe.hp).toFixed(3) + ' hp in one tick');
		}
		{
			// A base drone is one of its own side's bullets - the same-team skip must cover a
			// drone-vs-drone pair from the same base too, not just an ordinary bullet.
			const room = isolatedRoom();
			const postA = room.dronePosts[0];
			const postB = room.dronePosts.find((p) => p !== postA && p.team === postA.team);
			const droneA = room.INSTANCE.bullets.get(postA.slot);
			const droneB = room.INSTANCE.bullets.get(postB.slot);
			droneA.x = 0; droneA.y = 0; droneB.x = 0; droneB.y = 0;
			const aBefore = droneA.pene, bBefore = droneB.pene;
			room.step();
			check('two same-team base drones do not damage each other',
				droneA.pene === aBefore && droneB.pene === bBefore,
				droneA.pene + '/' + aBefore + ', ' + droneB.pene + '/' + bBefore);
		}
	}

	// 4.5.3/4.5.4 - orbit rate is now uniform (a linear cruise speed), not radius-dependent the
	// way an angular rate would be: measure at two different energy levels and expect the same
	// speed (plan.md WP4.5.1 replaces the old continuous radius band with five discrete levels).
	{
		const room = makeRoom('4team');
		const narrow = room.dronePosts.reduce((a, b) => (a.level < b.level ? a : b));
		const wide = room.dronePosts.reduce((a, b) => (a.level > b.level ? a : b));
		const nominal = tick.perTick(config.BASE_DRONE_ORBIT_SPEED);
		// The cruise rate itself, in real-world terms (plan.md WP4.5.0/WP5): 85.25 u/s, 1.5x the old
		// carrot-chase's actual 56.8 - not WP4's 114, which overshot at 2x. Asserted against the
		// number rather than only against "measured == config", so a retune has to be deliberate.
		check('cruise is 85.25 u/s in real-world terms',
			Math.abs(nominal * (1000 / config.TICK_MS) - 85.25) < 0.05,
			(nominal * (1000 / config.TICK_MS)).toFixed(2) + ' u/s');
		for (const post of [narrow, wide]) {
			const drone = room.INSTANCE.bullets.get(post.slot);
			drone.crossIn = 1e9;   // a natural cross starting mid-measurement would skew the average
			let dist = 0;
			for (let i = 0; i < 40; i++) {
				const x0 = drone.x, y0 = drone.y;
				drone.update();
				dist += Math.sqrt(Math.pow(drone.x - x0, 2) + Math.pow(drone.y - y0, 2));
			}
			const measured = dist / 40;
			check('cruise speed is within 5% of nominal at level ' + post.level +
				' - uniform, not angular', Math.abs(measured - nominal) / nominal < 0.05,
				measured + ' vs ' + nominal);
		}
	}

	// ---- WP4.5.1: the shared five-level radius table --------------------------------------------
	{
		const room = makeRoom('ffa');
		let steps = true;
		for (let n = 1; n < config.BASE_DRONE_LEVELS; n++) {
			if (Math.abs((room.levelR(n + 1) - room.levelR(n)) - config.BASE_DRONE_LEVEL_GAP) > 1e-9) { steps = false; }
		}
		check('levelR steps by exactly LEVEL_GAP between adjacent levels', steps);
		check('levelR(HOME) is the nominal ORBIT_R', room.levelR(config.BASE_DRONE_LEVEL_HOME) === config.BASE_DRONE_ORBIT_R,
			room.levelR(config.BASE_DRONE_LEVEL_HOME) + ' vs ' + config.BASE_DRONE_ORBIT_R);
		const drawnSide = config.BASE_DRONE_SIZE * 3.05;
		check('LEVEL_GAP is within 5% of the drawn drone side (one drone-side apart)',
			Math.abs(config.BASE_DRONE_LEVEL_GAP - drawnSide) / drawnSide < 0.05, drawnSide);
	}

	// ---- WP4.5.0: LEAN_SCALE really is a 60-degree turn - the REACTIVE ('random') path only -----
	// ('home' switches no longer read LEAN_SCALE at all - they fly BASE_DRONE_SWITCH_ARC's planned
	// arc instead, tested separately below.)
	{
		const leanRad = Math.atan(config.BASE_DRONE_LEVEL_GAP / config.BASE_DRONE_LEAN_SCALE);
		const degOff = Math.abs(leanRad - config.BASE_DRONE_HIT_TURN) * 180 / Math.PI;
		check('a one-level radius error leans the orbit field by exactly 60 degrees (within 0.5deg) ' +
			'- pins the reactive (shape-hit/proximity) path', degOff < 0.5, degOff.toFixed(3) + ' degrees off');
	}

	// ---- WP4.5.0: SEPARATION is 5 units of drawn overlap, strictly under one LEVEL_GAP -----------
	{
		const touchAt = 2 * 1.7 * config.BASE_DRONE_SIZE;
		check('SEPARATION is 5 units of drawn triangle-vertex overlap',
			Math.abs(touchAt - config.BASE_DRONE_SEPARATION - 5) < 0.1,
			(touchAt - config.BASE_DRONE_SEPARATION).toFixed(2) + ' vs 5');
		check('...and strictly under one LEVEL_GAP - two drones on different levels can never trigger it',
			config.BASE_DRONE_SEPARATION < config.BASE_DRONE_LEVEL_GAP,
			config.BASE_DRONE_SEPARATION + ' vs ' + config.BASE_DRONE_LEVEL_GAP);
	}

	// ---- WP4.5.1: levelPlan() - caps and largest-remainder initial occupancy ---------------------
	{
		const room = makeRoom('ffa');
		function counts(plan) {
			const c = [0, 0, 0, 0, 0];
			plan.initial.forEach((lvl) => c[lvl - 1]++);
			return c;
		}
		const p12 = room.levelPlan(12), c12 = counts(p12);
		check('levelPlan(12) caps are [1,3,5,3,1]', p12.caps.join(',') === '1,3,5,3,1', p12.caps.join(','));
		check('levelPlan(12) initial occupancy is [1,3,4,3,1]', c12.join(',') === '1,3,4,3,1', c12.join(','));
		check('...initial is a flat, count-length list', p12.initial.length === 12, p12.initial.length);
		check('...sum(caps) >= count', p12.caps.reduce((a, b) => a + b, 0) >= 12);
		check('...every initial count is within its own cap', c12.every((n, i) => n <= p12.caps[i]));

		const p2 = room.levelPlan(2), c2 = counts(p2);
		check('levelPlan(2) caps are [1,1,1,1,1]', p2.caps.join(',') === '1,1,1,1,1', p2.caps.join(','));
		check('levelPlan(2) initial occupancy is [0,1,1,0,0]', c2.join(',') === '0,1,1,0,0', c2.join(','));
	}

	// ---- WP4.5.1: live occupancy matches the ledger, fresh out of the constructor ----------------
	{
		for (const gm of ['4team', '2team']) {
			const room = makeRoom(gm);
			const drones = [...room.INSTANCE.bullets.live()].filter((b) => b.alone);
			const ledgers = new Set(drones.map((d) => d.levels));
			let matches = true, withinCap = true;
			for (const ledger of ledgers) {
				const counted = [0, 0, 0, 0, 0];
				for (const d of drones) { if (d.levels === ledger) { counted[d.level - 1]++; } }
				if (!counted.every((n, i) => n === ledger.count[i])) { matches = false; }
				if (!counted.every((n, i) => n <= ledger.caps[i])) { withinCap = false; }
			}
			check(gm + ": every ledger's live count matches its drones' actual levels", matches);
			check(gm + ': no ledger exceeds its own caps at spawn', withinCap);
		}
	}

	// ---- WP4.5.1: a dead drone releases its level claim exactly once ------------------------------
	{
		const room = makeRoom('2team');
		const post = room.dronePosts[0];
		const ledger = post.levels;
		const centrePosts = room.dronePosts.filter((p) => p.levels === ledger);
		const drone = room.INSTANCE.bullets.get(post.slot);
		drone.destroy = tick.DES;
		let neverNegative = true;
		const wait = tick.ticks(config.BASE_DRONE_RESPAWN);
		for (let i = 0; i < wait + 10; i++) {
			room.step();
			if (ledger.count.some((c) => c < 0)) { neverNegative = false; }
		}
		const liveCount = centrePosts.reduce((n, p) => n + (room.INSTANCE.bullets.get(p.slot) ? 1 : 0), 0);
		const ledgerSum = ledger.count.reduce((a, b) => a + b, 0);
		check("a killed drone's release is exactly one-shot - the ledger tracks live drones after respawn",
			ledgerSum === liveCount, ledgerSum + ' vs ' + liveCount);
		check('...and the count never went negative (a double-decrement or a missed release)', neverNegative);
	}

	// ---- WP4.5.0: a level switch moves exactly one level, respecting caps for a VOLUNTARY move ----
	// but no longer for a REACTION, which now always fires. Driven through the real shape-hit
	// trigger (entities/Bullet.js's KIND.OBJECTS collision arm) followed by one update() - since
	// WP4.5.0, collision() only LATCHES reactPending; case 1.4's own trigger block is what actually
	// calls levelSwitch(), on the drone's next free/off-cooldown tick. Together that pair is
	// levelSwitch()'s one public door - not a private helper this test can call directly.
	{
		const room = makeRoom('2team');
		const KIND = require(path.join(ROOT, 'public', 'SHARE', 'kinds.js'));
		const post = room.dronePosts[0];
		const shape = { kind: KIND.OBJECTS, x: 0, y: 0, type: 'sqr', destroy: 0 };
		function freshDrone(level, caps, occupied) {
			const drone = room.INSTANCE.bullets.get(post.slot);
			drone.level = level;
			drone.levels = makeLevels(caps, occupied);
			drone.switchCooldown = 0;
			drone.crossing = false;
			drone.chasing = false;
			drone.switching = false;
			drone.crossIn = 1e9;   // never cross during this test
			drone.levelTimer = 1e9;   // never drift-home during this test - isolates the reaction
			drone.tooClose = 0;
			drone.reactPending = 0;
			drone.orbRTarget = room.levelR(level);
			return drone;
		}
		// The reaction latches on collision() and is paid out on the very next update() (case 1.4's
		// trigger block) - a real "react" is always these two calls together now.
		function react(d) { d.collision(shape, {}); d.update(); }
		{
			const d = freshDrone(5, [5, 5, 5, 5, 5], [0, 0, 0, 0, 1]);
			react(d);
			check('from level 5, the only outcome is level 4', d.level === 4, d.level);
		}
		{
			const d = freshDrone(1, [5, 5, 5, 5, 5], [1, 0, 0, 0, 0]);
			react(d);
			check('from level 1, the only outcome is level 2', d.level === 2, d.level);
		}
		{
			// Level 3 with level 2 already saturated - only the level-4 side is open.
			const d = freshDrone(3, [5, 1, 5, 5, 5], [0, 1, 1, 0, 0]);
			react(d);
			check('with one neighbour saturated, the open side is chosen deterministically',
				d.level === 4, d.level);
		}
		{
			// Level 3 with both level 2 and level 4 saturated - a REACTION still moves it (plan.md
			// WP4.5.0, "this should always be happening no matter what"): saturation is a preference
			// for a voluntary move, not a veto on a reaction any more.
			const d = freshDrone(3, [5, 1, 5, 1, 5], [0, 1, 1, 1, 0]);
			const before = d.level;
			react(d);
			check('with both neighbours saturated, a reaction still moves it - the cap is no longer a veto',
				d.level !== before && (d.level === 2 || d.level === 4), d.level);
			check('...and the cooldown actually advanced - the move really happened, not just latched',
				d.switchCooldown > 0, d.switchCooldown);
		}
		{
			// Through the VOLUNTARY ('home') door instead of a reaction (plan.md WP4.5.0): 'home'
			// mode is now ONLY ever reached via a post-swoosh `homing` climb, and that climb ignores
			// the cap entirely on purpose ("a scripted return must not be able to stall behind a
			// full level 2") - so, unlike the old general drift-home, a saturated neighbour is NOT a
			// veto here any more. HOME (level 3) itself is at its cap already; the drone climbs from
			// level 2 toward it regardless.
			const d = freshDrone(2, [5, 5, 1, 5, 5], [0, 1, 1, 0, 0]);
			placeOnRing(d, room.levelR(2), 0);
			d.homing = 1;
			d.levelTimer = 1;
			d.update();
			check("a homing 'home' move is not vetoed by a saturated neighbour either (cap-free while homing)",
				d.level === 3, d.level);
		}
	}

	// ---- WP4.5.0: drift home, re-timed - a 'home' switch now flies a real planned arc, not an ----
	// instant write, so the climb budget has to cover BASE_DRONE_LEVEL_RELAX's wait AND the arc's
	// own flight time for every hop (plan.md WP4.5.0's "2*(relax+arc)" figure).
	{
		const room = makeRoom('2team');
		const post = room.dronePosts[0];
		const drone = room.INSTANCE.bullets.get(post.slot);
		const relax = tick.ticks(config.BASE_DRONE_LEVEL_RELAX);
		const vOrb = tick.perTick(config.BASE_DRONE_ORBIT_SPEED);
		// Mirrors planSwitchArc()'s own T formula (entities/Bullet.js) so the budget below is a
		// real bound, not a guess.
		function switchTicks(r0, r1) {
			// Mirrors planSwitchArc()'s own dtheta formula (plan.md WP4.5.0) - a LEAN off the
			// tangent now, not a fraction of the circumference, so the sweep is derived from r0
			// (the ring the arc launches from), not a mean radius.
			const meanR = (r0 + r1) / 2;
			const dtheta = config.BASE_DRONE_LEVEL_GAP / (Math.tan(config.BASE_DRONE_SWITCH_LEAN) * r0);
			return Math.max(3, Math.round(Math.hypot(meanR * Math.abs(dtheta), Math.abs(r1 - r0)) / vOrb));
		}
		const budget = relax + switchTicks(room.levelR(1), room.levelR(2)) +
			relax + switchTicks(room.levelR(2), room.levelR(3)) + 100;   // +100 ticks slack
		function setup(level, caps, occupied) {
			drone.level = level;
			drone.levels = makeLevels(caps, occupied);
			drone.orbRTarget = room.levelR(level);
			drone.levelTimer = relax;
			drone.switchCooldown = 0;
			drone.crossing = false;
			drone.chasing = false;
			drone.switching = false;
			drone.crossIn = 1e9;   // never cross during this test
			// The general drift-home timer is gone (plan.md WP4.5.0) - only a post-swoosh `homing`
			// drone climbs on this timer now, so this test simulates that state directly.
			drone.homing = 1;
		}
		setup(1, [5, 5, 5, 5, 5], [1, 0, 0, 0, 0]);
		for (let i = 0; i < budget; i++) { drone.update(); }
		check('left alone off HOME, a drone drifts back up to HOME within its (relax+arc)*2 budget',
			drone.level === config.BASE_DRONE_LEVEL_HOME, drone.level);
		for (let i = 0; i < 50 && !drone.switching; i++) { drone.update(); }
		check('...and then stops moving levels', drone.level === config.BASE_DRONE_LEVEL_HOME, drone.level);

		// A homing climb ignores the saturation cap entirely now (plan.md WP4.5.0 - "a scripted
		// return must not be able to stall behind a full level 2"), the opposite of the old general
		// drift-home's behaviour: level 2 sitting AT its cap of 1 must not stop this climb.
		setup(1, [5, 1, 5, 5, 5], [1, 1, 0, 0, 0]);   // level 2 already at its cap
		for (let i = 0; i < budget; i++) { drone.update(); }
		check("...and a homing climb is NOT blocked by a saturated next level (cap-free while homing)",
			drone.level === config.BASE_DRONE_LEVEL_HOME, drone.level);
	}

	// ---- WP4.5.0: the reactive ('random') path is an unchanged regression guard -------------------
	// Driven through the real shape-hit trigger (collision() against a KIND.OBJECTS shape) followed
	// by one update() - collision() only latches reactPending now (WP4.5.0), and case 1.4's own
	// trigger block is what pays it out, on the very next tick since switchCooldown is 0. That pair
	// is the same public door the cap test above uses - not a private call to levelSwitch().
	{
		const room = makeRoom('2team');
		const KIND = require(path.join(ROOT, 'public', 'SHARE', 'kinds.js'));
		const post = room.dronePosts[0];
		const drone = room.INSTANCE.bullets.get(post.slot);
		const shape = { kind: KIND.OBJECTS, x: 0, y: 0, type: 'sqr', destroy: 0 };
		drone.level = 3;
		drone.levels = makeLevels([5, 5, 5, 5, 5], [0, 0, 1, 0, 0]);
		placeOnRing(drone, room.levelR(3), 0);
		drone.orbRTarget = room.levelR(3);
		drone.switchCooldown = 0;
		drone.crossing = false; drone.chasing = false; drone.switching = false;
		drone.crossIn = 1e9; drone.levelTimer = 1e9;   // isolate the reaction under test
		drone.tooClose = 0; drone.reactPending = 0;
		const targetBefore = drone.orbRTarget;
		const initHead = drone.head;
		drone.collision(shape, {});
		// The turn limiter still caps every single tick at BASE_DRONE_TURN, so the 60-degree lean
		// (LEAN_SCALE's identity, tested above) shows up as a fast CUMULATIVE swing away from the
		// pre-switch tangent, not an instant jump. It is not a guaranteed exact 60 degrees - the
		// radius error the lean is chasing shrinks as the drone corrects, so the swing peaks and
		// reverses - but it is unmistakably sharper than a 'home' arc's own ~10.6-degree sweep, which
		// is the actual regression this guards: routing 'random' through the smooth arc by mistake
		// would flatten this peak by 4x or more.
		let peakTurn = 0;
		for (let i = 0; i < 20; i++) {
			drone.update();
			const d = Math.abs(Math.atan2(Math.sin(drone.head - initHead), Math.cos(drone.head - initHead)));
			if (d > peakTurn) { peakTurn = d; }
		}
		check('a random switch writes orbRTarget on its very next tick (the latch is paid off cooldown), with no planned arc entered',
			drone.orbRTarget !== targetBefore && drone.orbRTarget === room.levelR(drone.level) && !drone.switching,
			drone.orbRTarget + ' vs ' + targetBefore);
		check('...and the reactive lean swings well past a home arc\'s own sweep - still a sharp peel',
			peakTurn > 20 * Math.PI / 180, (peakTurn * 180 / Math.PI).toFixed(1) + ' degrees');
	}

	// ---- WP4.5.0: anti-overlap fires through the real pair loop -----------------------------------
	// Both drones are placed AT their shared level's radius from their shared centre (ox,oy), only
	// offset angularly - not at a fixed literal x/y - so orbRTarget matches their actual radius
	// exactly for both. Placing one of them at a different literal offset (an earlier draft of this
	// test did) gives it a radius error the orbit field then leans hard to correct, pulling it past
	// the other regardless of SEPARATION - a test artifact, not the mechanism under test.
	// Places a drone exactly on its own ring, heading exactly tangential to it - not just x/y, or
	// its stale spawn-time heading (built for its original phase, an unrelated angle) would need
	// several ticks to turn into the new position's true tangent, and which way that transient
	// settling happens to bend is exactly the kind of incidental randomness that made an earlier
	// draft of this test flaky.
	function placeOnRing(drone, r, angle) {
		drone.x = drone.ox + r * Math.cos(angle);
		drone.y = drone.oy + r * Math.sin(angle);
		const spin = drone.spin || 1;
		drone.head = Math.atan2(Math.cos(angle) * spin, -Math.sin(angle) * spin);
		const spd = tick.perTick(config.BASE_DRONE_ORBIT_SPEED);
		drone.spd = spd;
		drone.vec.x = Math.cos(drone.head) * spd;
		drone.vec.y = Math.sin(drone.head) * spd;
		drone.pvec.x = drone.vec.x; drone.pvec.y = drone.vec.y;
	}
	{
		const cd = tick.ticks(config.BASE_DRONE_SWITCH_COOLDOWN);
		{
			const room = makeRoom('2team');
			const postA = room.dronePosts[0];
			const postB = room.dronePosts.find((p) => p !== postA && p.team === postA.team);
			const a = room.INSTANCE.bullets.get(postA.slot);
			const b = room.INSTANCE.bullets.get(postB.slot);
			// Same level, sharing one ledger (so the saturation caps this test isn't about can't get
			// in the way), and a chord distance of 20 apart along the ring - inside SEPARATION (26.3).
			const r = room.levelR(3);
			a.level = b.level = 3;
			a.levels = makeLevels([5, 5, 5, 5, 5], [0, 0, 2, 0, 0]);
			b.levels = a.levels;
			a.orbRTarget = b.orbRTarget = r;
			a.switchCooldown = b.switchCooldown = 0;
			a.crossing = b.crossing = false; a.chasing = b.chasing = false;
			a.crossIn = b.crossIn = 1e9;   // a real cross would swamp this short-window check
			placeOnRing(a, r, 0);
			placeOnRing(b, r, 2 * Math.asin(10 / r));   // chord ~20
			const aPeneBefore = a.pene, bPeneBefore = b.pene;
			room.step();
			// The same-team base-drone pair is skipped whole by rooms/Room.js's step() (4.5.5) - no
			// collision() call happens at all for this pair, so this single step's pass cannot have
			// touched pene or added any impulse; only the drone's own orbit-field motion moves vec
			// on every subsequent tick, which is why this check runs once, right after the flag was
			// set, rather than across the whole run below.
			check('two overlapping same-team drones take no damage or knockback from the pair itself',
				a.pene === aPeneBefore && b.pene === bPeneBefore);
			let switched = (a.level !== 3 || b.level !== 3);
			for (let i = 1; i < cd + 10 && !switched; i++) {
				room.step();
				if (a.level !== 3 || b.level !== 3) { switched = true; }
			}
			// EXACTLY one of the pair peels, not both (plan.md WP4.5.0): rooms/Room.js's pair loop
			// flags one deterministic side now. Before 4.5.3 this could only be asserted as "at least
			// one", because the mechanism relied on the other side's switch *failing* - which is the
			// very bug 4.5.3 fixed, so with a reaction that always fires, both would move (possibly
			// onto the same level, still overlapping) if both were still flagged.
			check('...and EXACTLY one of them peels onto a different level within the cooldown',
				switched && (a.level !== 3) !== (b.level !== 3), a.level + '/' + b.level);
			// The peel is radial, at a 60-degree lean off the tangent, so one LEVEL_GAP (28) of
			// separation takes ~15 ticks to open up; 25 is comfortable and still inside the switch
			// cooldown, so neither can have reacted a second time by then.
			for (let i = 0; i < 25; i++) { room.step(); }
			const apart = Math.hypot(a.x - b.x, a.y - b.y);
			check('...and once it has, they are more than SEPARATION apart - they stop stacking',
				apart > config.BASE_DRONE_SEPARATION, apart.toFixed(2) + ' vs ' + config.BASE_DRONE_SEPARATION);
		}
		{
			const room = makeRoom('2team');
			const postA = room.dronePosts[0];
			const postB = room.dronePosts.find((p) => p !== postA && p.team === postA.team);
			const a = room.INSTANCE.bullets.get(postA.slot);
			const b = room.INSTANCE.bullets.get(postB.slot);
			const r = room.levelR(3);
			a.level = b.level = 3;
			a.orbRTarget = b.orbRTarget = r;
			a.switchCooldown = b.switchCooldown = 0;
			a.crossing = b.crossing = false; a.chasing = b.chasing = false;
			a.crossIn = b.crossIn = 1e9;
			placeOnRing(a, r, 0);
			placeOnRing(b, r, 2 * Math.asin(20 / r));   // chord ~40, outside SEPARATION (26.3)
			let switched = false;
			for (let i = 0; i < cd + 10; i++) {
				room.step();
				if (a.level !== 3 || b.level !== 3) { switched = true; }
			}
			check('drones more than SEPARATION apart never trigger the anti-overlap switch', !switched);
		}
	}

	/*
		---- WP4.5.0: a reaction ALWAYS moves the drone -----------------------------------------------

		The regression test, stated as the measurement that found the bug. Before this pass,
		levelSwitch(drone, 'random') kept a neighbour as a candidate only if it was under its
		per-centre cap - and in a real base the ledger is full: levelPlan(12) gives caps [1,3,5,3,1]
		against an initial occupancy of [1,3,4,3,1], one free slot in the entire centre. Measured on
		a live 4team room, 24 of 48 base drones had NO open neighbour at all and simply ignored every
		shape they hit. This drives every drone in a real room through the real public door (latch,
		then one tick) and expects 48 of 48.
	*/
	{
		const room = makeRoom('4team');
		const drones = [...room.INSTANCE.bullets.live()].filter((b) => b.alone && b.type === 1.4);
		let moved = 0;
		for (const d of drones) {
			d.crossIn = 1e9; d.levelTimer = 1e9;      // isolate the reaction from cross/drift-home
			d.update();                                // one tick to build DETEC and settle state
			d.chasing = false; d.crossing = false; d.switching = false;
			d.switchCooldown = 0;
			d.tooClose = 0;
			const before = d.level;
			d.reactPending = 1;
			d.update();
			if (d.level !== before) { moved++; }
		}
		check('every base drone in a live 4team room reacts to a hit - saturation is no longer a veto',
			moved === drones.length, moved + ' of ' + drones.length + ' moved');
		// The ledger may now transiently exceed a cap (a cross's landing on level 1 already could),
		// but it must still account for exactly the live drones at each centre.
		const ledgers = new Set(drones.map((d) => d.levels));
		let balanced = true;
		for (const ledger of ledgers) {
			const live = drones.filter((d) => d.levels === ledger).length;
			if (ledger.count.reduce((a, b) => a + b, 0) !== live) { balanced = false; }
		}
		check("...and every centre's ledger still sums to its own live drone count", balanced);
	}

	/*
		---- WP4.5.0: a reaction that cannot be paid now is LATCHED, not dropped ----------------------
		The three ways a drone can be busy when a shape hits it, plus the deliberate exception.
	*/
	{
		const room = makeRoom('4team');
		const KIND = require(path.join(ROOT, 'public', 'SHARE', 'kinds.js'));
		const shape = { kind: KIND.OBJECTS, x: 0, y: 0, type: 'sqr', destroy: 0 };
		const cd = tick.ticks(config.BASE_DRONE_SWITCH_COOLDOWN);
		function idleDrone(level) {
			const post = room.dronePosts.find((p) => p.level === config.BASE_DRONE_LEVEL_HOME);
			const d = room.INSTANCE.bullets.get(post.slot);
			d.crossIn = 1e9; d.levelTimer = 1e9;
			d.update();
			d.DETEC.select = 0;
			d.homing = 0;
			d.chasing = false; d.crossing = false; d.switching = false;
			d.level = level;
			d.levels = makeLevels([9, 9, 9, 9, 9], [0, 0, 0, 0, 0]);
			d.levels.count[level - 1] = 1;
			d.orbRTarget = room.levelR(level);
			d.switchCooldown = 0; d.tooClose = 0; d.reactPending = 0;
			placeOnRing(d, room.levelR(level), 0);
			return d;
		}
		{
			// (i) a hit taken while the switch cooldown is still running
			const d = idleDrone(3);
			d.switchCooldown = 10;
			const before = d.level;
			d.collision(shape, {});
			check('a hit taken on cooldown latches instead of being dropped', d.reactPending === 1);
			let paidAt = -1;
			for (let i = 0; i < cd + 5 && paidAt < 0; i++) { d.update(); if (d.level !== before) { paidAt = i; } }
			check('...and is paid the moment the cooldown clears', paidAt >= 0, paidAt + ' ticks');
		}
		{
			// (ii) a hit taken mid-'home'-arc - the drone is flying a planned curve and cannot peel
			// off it, so the reaction waits for the arc to land rather than being thrown away.
			const d = idleDrone(4);
			// The general drift-home timer is gone (plan.md WP4.5.0) - only a post-swoosh `homing`
			// drone climbs on this timer now, so simulate that state directly to drive the drone
			// into the same 'home' planned arc this test is actually about.
			d.homing = 1;
			d.levelTimer = 1;
			d.update();                       // fires the drift-home switch, entering `switching`
			check("a drift-home switch really did enter its planned arc (test precondition)", d.switching === true);
			d.switchCooldown = 0;
			const before = d.level;
			d.collision(shape, {});
			check("a hit taken mid-'home'-arc latches", d.reactPending === 1);
			let paidAt = -1;
			for (let i = 0; i < 300 && paidAt < 0; i++) { d.update(); if (d.level !== before) { paidAt = i; } }
			check('...and is paid on the tick the arc lands', paidAt >= 0 && !d.switching, paidAt + ' ticks');
		}
		{
			// (iii) mid-swoosh is the ONE deliberate exception: the drone ploughs straight through,
			// and the cross's own landing on level 1 IS its level change - so nothing is latched, and
			// the exit clears anything that was.
			const d = idleDrone(3);
			d.crossIn = 1;
			d.update();
			check('a cross really did start (test precondition)', d.crossing === true);
			d.collision(shape, {});
			check('a hit taken mid-swoosh latches nothing - the drone ploughs through', !d.reactPending);
			let guard = 0;
			while (d.crossing && guard++ < 500) { d.update(); }
			check('...and reactPending is 0 once the cross exits', !d.reactPending, d.reactPending);
			check('...having landed on level 1, which IS its level change', d.level === 1, d.level);
		}
		{
			// (iv) a tooClose noticed mid-chase becomes a pending reaction rather than a lost flag -
			// this is the case that used to be silently cleared by the old `else { tooClose = 0 }`.
			const d = idleDrone(3);
			// Acquisition is centralised through levels.threat now (plan.md WP4.5.0) - set both so
			// this test doesn't depend on whether `d` happens to be its centre's current scout.
			d.levels.threat = d.DETEC.select = { x: d.ox + (d.ox > 0 ? -1 : 1) * 600, y: d.oy, destroy: 0 };
			d.update();
			check('a chase really did start (test precondition)', d.chasing === true);
			d.tooClose = 1;
			d.update();
			check('a tooClose raised mid-chase becomes a pending reaction, not a dropped flag',
				d.reactPending === 1 && !d.tooClose, d.reactPending + '/' + d.tooClose);
		}
	}

	/*
		---- WP4.5.0: the hit still lands on the tick the drone KILLS the shape -----------------------
		The user's "it should do this even if it kills the shape". rooms/Room.js's pair loop runs
		other.collision(this) BEFORE this arm, so the polygon can die on the same tick - the reaction
		must not be lost with it. Driven through the real room step, with a nearly-dead polygon
		parked on the drone's own ring.
	*/
	{
		const Objects = require(path.join(ROOT, 'entities', 'Objects.js'));
		const room = makeRoom('4team');
		const post = room.dronePosts.find((p) => p.level === config.BASE_DRONE_LEVEL_HOME);
		const drone = room.INSTANCE.bullets.get(post.slot);
		drone.crossIn = 1e9; drone.levelTimer = 1e9;
		drone.switchCooldown = 0; drone.reactPending = 0; drone.tooClose = 0;
		const beforeLevel = drone.level;
		// One tick ahead of the drone along its own ring, so they meet within a few ticks.
		const ang = Math.atan2(drone.y - drone.oy, drone.x - drone.ox) + (drone.spin || 1) * 0.06;
		const r = Math.hypot(drone.x - drone.ox, drone.y - drone.oy);
		const sq = room.INSTANCE.objs.add((id) => {
			const o = new Objects('sqr', -1, { GM: room.gm, sId: room.id, oId: id }, room.map, room);
			o.x = drone.ox + Math.cos(ang) * r; o.y = drone.oy + Math.sin(ang) * r;
			o.hp = 0.01;   // one touch kills it
			return o;
		});
		let sawSwitch = false, died = false;
		for (let i = 0; i < 120; i++) {
			room.step();
			if (sq.destroy) { died = true; }
			if (drone.level !== beforeLevel) { sawSwitch = true; }
			if (died && sawSwitch) { break; }
		}
		check('a drone that kills a shape on contact still takes its level change from the hit',
			died && sawSwitch, 'died=' + died + ' switched=' + sawSwitch);
	}

	/*
		---- WP4.5.0: the swoosh - arc -> C2 blend -> exact straight -> C2 blend -> level 1 ----------

		Speeds here are measured from POSITION DELTAS, never from `vec`: position is what the curve
		actually writes and what a player sees, so a curve that wrote a plausible `vec` alongside a
		wrong position would pass a vec-based test and fail this one.

		Nothing below re-derives planCross()'s own construction and then tests it against itself.
		The straight's two endpoints come straight out of the flown path: `Te-1`/`Te+Ts-1` are the
		first ticks whose accumulated arc length reaches the straight's start/end (plan.md WP4.5.1's
		single continuous polyline replaced the old per-piece tables, so a tick boundary no longer
		lands exactly on a knot the way it used to - it can land up to one tick's arc-step into the
		neighbouring blend). That is why the straightness/centre-on-line checks below tolerate a
		small (sub-0.1-unit) slack instead of asserting floating-point exactness: real curvature
		would show up as multiple units of deviation, not a fraction of one.
	*/
	{
		const room = makeRoom('4team');
		const V_ORB = tick.perTick(config.BASE_DRONE_ORBIT_SPEED);
		const V_CROSS = tick.perTick(config.BASE_DRONE_CROSS_SPEED);
		const R1 = room.levelR(1);
		const FRAC = config.BASE_DRONE_CROSS_BLEND_FRAC;
		const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

		// Plans and flies one whole cross from `level` at `spin`, recording position every tick.
		function flyCross(level, spin) {
			const post = room.dronePosts.find((p) => p.level === config.BASE_DRONE_LEVEL_HOME);
			const drone = room.INSTANCE.bullets.get(post.slot);
			drone.crossIn = 1e9;
			drone.update();                 // one tick to build DETEC, so it can be silenced below
			drone.DETEC.select = 0;         // no chase: a chase would abandon the state under test
			drone.chasing = false; drone.crossing = false; drone.switching = false;
			drone.spin = spin;
			drone.level = level;
			drone.levels = makeLevels([9, 9, 9, 9, 9], [0, 0, 0, 0, 0]);
			drone.levels.count[level - 1] = 1;
			drone.orbRTarget = room.levelR(level);
			drone.levelTimer = 1e9;         // no drift-home mid-measurement
			drone.switchCooldown = 0;
			drone.tooClose = 0; drone.reactPending = 0;
			// placeOnRing() leaves the drone exactly on its ring at cruise with pvec == vec, which
			// is the same steady state 60 warm-up ticks used to produce - planCross() reads vec
			// directly for its C1 seam, so a cold (0,0) vec would freeze a bogus entry velocity.
			placeOnRing(drone, room.levelR(level), 0.7);
			const P0 = { x: drone.x, y: drone.y };
			const r0 = Math.hypot(P0.x - drone.ox, P0.y - drone.oy);
			const entryAngle = Math.atan2(P0.y - drone.oy, P0.x - drone.ox);
			drone.crossIn = 1;
			drone.update();                 // this tick both plans the cross AND applies its tick 0
			const started = drone.crossing === true;
			const segs = started ? drone.crossSegs.slice() : [0, 0, 0];
			const ticks = started ? drone.crossTicks.slice() : [0, 0, 0];
			const tbl = drone.crossTbl;
			const pts = [{ x: drone.x, y: drone.y }];
			let guard = 0;
			while (drone.crossing && guard++ < 500) {
				drone.update();
				pts.push({ x: drone.x, y: drone.y });
			}
			// Per-tick velocity/accel/jerk, all from the flown positions. v[i] is the step INTO
			// pts[i], so v[0] is the very first cross tick's own step out of P0.
			const v = [], sp = [];
			let prev = P0;
			for (const p of pts) { v.push({ x: p.x - prev.x, y: p.y - prev.y }); sp.push(Math.hypot(p.x - prev.x, p.y - prev.y)); prev = p; }
			let peakTurn = 0, peakAccel = 0, peakJerk = 0, maxR = 0, maxDx = 0, maxDy = 0;
			for (let i = 0; i < pts.length; i++) {
				maxR = Math.max(maxR, Math.hypot(pts[i].x - drone.ox, pts[i].y - drone.oy));
				maxDx = Math.max(maxDx, Math.abs(pts[i].x - drone.ox));
				maxDy = Math.max(maxDy, Math.abs(pts[i].y - drone.oy));
				if (i >= 1) { peakTurn = Math.max(peakTurn, Math.abs(wrap(Math.atan2(v[i].y, v[i].x) - Math.atan2(v[i - 1].y, v[i - 1].x)))); }
				if (i >= 1) { peakAccel = Math.max(peakAccel, Math.hypot(v[i].x - v[i - 1].x, v[i].y - v[i - 1].y)); }
				if (i >= 2) {
					const jx = (v[i].x - v[i - 1].x) - (v[i - 1].x - v[i - 2].x);
					const jy = (v[i].y - v[i - 1].y) - (v[i - 1].y - v[i - 2].y);
					peakJerk = Math.max(peakJerk, Math.hypot(jx, jy));
				}
			}
			const Te = ticks[0], Ts = ticks[1];
			// The exact geometric endpoints (plan.md WP4.5.7), not the nearest flown tick - a tick
			// boundary can land up to one tick's arc-step into the neighbouring blend now that the
			// speed profile is one continuous polyline, which would otherwise leak a fraction of a
			// unit of blend curvature into "how straight is the straight" and "how long is it".
			const Lin = drone.crossLin, Lout = drone.crossLout;
			const lineLen = Math.hypot(Lout.x - Lin.x, Lout.y - Lin.y) || 1;
			const d = { x: (Lout.x - Lin.x) / lineLen, y: (Lout.y - Lin.y) / lineLen };
			const perp = (p) => Math.abs((p.x - Lin.x) * -d.y + (p.y - Lin.y) * d.x);
			const along = (p) => (p.x - Lin.x) * d.x + (p.y - Lin.y) * d.y;
			const C = { x: drone.ox, y: drone.oy };
			const exitR = Math.hypot(drone.x - drone.ox, drone.y - drone.oy);
			// plan.md WP4.5.1/4.5.7: the speed profile is a PLATEAU now, spanning the whole path
			// rather than three independently-timed pieces - so "where is the plateau" and "how close
			// does the flown path actually get to the centre" are found from the flown data directly,
			// not assumed to fall on a blend/straight seam.
			let peakSpdIdx = 0, centreIdx = 0, centreDist = Infinity;
			for (let i = 0; i < pts.length; i++) {
				if (sp[i] > sp[peakSpdIdx]) { peakSpdIdx = i; }
				const dc = Math.hypot(pts[i].x - C.x, pts[i].y - C.y);
				if (dc < centreDist) { centreDist = dc; centreIdx = i; }
			}
			// The plateau (plan.md WP4.5.1): cumulative arc length per tick, and the tick indices
			// bracketing the held peak - first tick whose cumulative arc reaches RAMP of the whole
			// path (rampIdx), and the LAST tick whose cumulative arc is still within (1-RAMP) of it
			// (holdIdx). peakSpdIdx already picks the FIRST tick at the max (strict > above), which
			// is exactly "first reached" for the check below.
			const cumArc = [];
			{ let c = 0; for (const s of sp) { c += s; cumArc.push(c); } }
			const pathL = segs[0] + segs[1] + segs[2];
			const RAMP = config.BASE_DRONE_CROSS_RAMP;
			const rampArc = RAMP * pathL, holdArc = (1 - RAMP) * pathL;
			let rampIdx = cumArc.findIndex((c) => c >= rampArc - 1e-6);
			if (rampIdx < 0) { rampIdx = cumArc.length - 1; }
			let holdIdx = 0;
			for (let i = 0; i < cumArc.length; i++) { if (cumArc[i] <= holdArc + 1e-6) { holdIdx = i; } }
			return {
				drone, started, segs, ticks, tbl, pts, sp, P0, r0, entryAngle, Te, Ts, Tx: ticks[2],
				cumArc, pathL, rampIdx, holdIdx,
				Lin, Lout, d, perp, along, lineLen, peakTurn, peakAccel, peakJerk, maxR, maxDx, maxDy,
				exitR, peakSpdIdx, centreIdx,
				centrePerp: perp(C), centreAlong: along(C), centreToEnd: lineLen - along(C),
				straightSp: sp.slice(Te, Te + Ts),
				entrySp: sp.slice(0, Te),
				exitSp: sp.slice(Te + Ts),
				exitVec: { x: drone.vec.x, y: drone.vec.y },
				exitAngle: Math.atan2(drone.y - drone.oy, drone.x - drone.ox)
			};
		}

		// --- the detailed pass, from the home level ------------------------------------------------
		{
			const R = flyCross(config.BASE_DRONE_LEVEL_HOME, 1);
			check('a cross actually starts on schedule', R.started);
			check('...and ends by running out its planned ticks, not a timeout', R.pts.length === R.tbl.length,
				R.pts.length + ' flown vs ' + R.tbl.length + ' planned');
			check('the per-tick table is exactly its three segments long - the shape solver terminated',
				R.tbl.length === R.ticks[0] + R.ticks[1] + R.ticks[2], R.tbl.length + ' vs ' + R.ticks.join('+'));
			check("...and its first tick is within one cross-speed step of the drone's position at trigger",
				Math.hypot(R.tbl[0].x - R.P0.x, R.tbl[0].y - R.P0.y) <= V_CROSS + 1e-9,
				Math.hypot(R.tbl[0].x - R.P0.x, R.tbl[0].y - R.P0.y).toFixed(3) + ' vs ' + V_CROSS.toFixed(3));

			// The straight really is straight, and really does run over the centre. A sampled minimum
			// distance to the centre is NOT asserted and never really held: at ~9.25 units per tick the
			// nearest sample can sit half a step (4.7 units) off a path that runs exactly over it.
			let worstPerp = 0;
			for (let i = R.Te; i < R.Te + R.Ts; i++) { worstPerp = Math.max(worstPerp, R.perp(R.pts[i])); }
			check('the straight segment is straight (within one tick-boundary\'s worth of slack)',
				worstPerp < 0.1, worstPerp.toExponential(2));
			// Lin/Lout are the exact geometric points now (drone.crossLin/crossLout), and C is pure
			// geometry too (Lin-C and Lout-C are scalar multiples of the same unit vector by
			// construction) - so unlike worstPerp above, this is provably exact, not tick-sampled.
			check('...and the orbit centre lies exactly ON that line',
				R.centrePerp < 1e-6, R.centrePerp.toExponential(2));
			check('...strictly BETWEEN its two ends - it really crosses the centre',
				R.centreAlong > 0 && R.centreToEnd > 0, R.centreAlong.toFixed(1) + ' / ' + R.centreToEnd.toFixed(1));
			// plan.md WP4.5.0: BLEND_FRAC is a fraction of EACH END'S OWN RADIUS now, not of the
			// chord, so the straight's length is (1-FRAC)*(r0+R1) - and there is no ceiling on FRAC
			// to assert any more (the "strictly BETWEEN its two ends" check just above is what used
			// to need one).
			check('...and is (1 - CROSS_BLEND_FRAC) of the whole chord, within 1%',
				Math.abs(R.lineLen - (1 - FRAC) * (R.r0 + R1)) / ((1 - FRAC) * (R.r0 + R1)) < 0.01,
				R.lineLen.toFixed(1) + ' vs ' + ((1 - FRAC) * (R.r0 + R1)).toFixed(1));

			// plan.md WP4.5.1: the speed profile is a PLATEAU now, held from CROSS_RAMP of the path to
			// (1-CROSS_RAMP) of it - there is no single peak tick any more, so "where is the peak" is
			// replaced by "is the plateau speed reached by RAMP and still held at 1-RAMP". A VALUE
			// check at rampIdx/holdIdx, not an index comparison against R.peakSpdIdx: RK2 asymptotically
			// approaches the true maximum from below across the whole held plateau (successive samples
			// differ by fractions of a unit in the 9th digit), so the STRICT first-tick-at-the-exact-
			// max can land many ticks after the profile is already at the plateau in every way that
			// matters - measured, within 0.1% by rampIdx but not bit-identical to the eventual max
			// until much later. The value check is what the plateau actually promises; the index one
			// was testing floating-point convergence noise instead.
			const vPeak = R.sp[R.peakSpdIdx];
			check('the plateau speed is reached by CROSS_RAMP of the cumulative arc (within 1%)',
				Math.abs(R.sp[R.rampIdx] - vPeak) / vPeak < 0.01,
				R.sp[R.rampIdx].toFixed(3) + ' vs peak ' + vPeak.toFixed(3));
			check('...and is still held (within 1%) at (1-CROSS_RAMP) of the arc',
				Math.abs(R.sp[R.holdIdx] - vPeak) / vPeak < 0.01,
				R.sp[R.holdIdx].toFixed(3) + ' vs peak ' + vPeak.toFixed(3));
			// Not 0.1%: vPeak is SOLVED so the walk lands on a whole tick, which is measured to land
			// within ~1% of nominal at every level (it can now land slightly UNDER nominal too, not
			// just over - see lib/config.js's BASE_DRONE_CROSS_SPEED comment) - a tighter bound here
			// would be testing the rounding, not the construction. Already two-sided via Math.abs().
			check('vPeak lands within 1% of nominal BASE_DRONE_CROSS_SPEED',
				Math.abs(vPeak - V_CROSS) / V_CROSS < 0.01, vPeak.toFixed(3) + ' vs ' + V_CROSS.toFixed(3));
			// Speed rises to the plateau and falls from it - non-strict now (plan.md WP4.5.1: the held
			// middle is flat by construction, not strictly monotone), in three pieces: non-decreasing
			// up to rampIdx, flat within 0.5% across the hold, non-increasing from holdIdx down to
			// cruise. The strict-monotonicity intent from the old single-ramp build is preserved
			// instead by the two seam-speed checks right below (both exactly cruise, no slack).
			// The very last table entry is the curve's exit knot B, WRITTEN exactly rather than
			// sampled from the walk (planCross()'s own comment) - so the position delta into it is
			// not a smooth continuation of the walk's own arc-length stepping, and is excluded from
			// the monotonicity/continuity checks below on purpose; the landing checks further down
			// (exitVec, exactly tangential, etc.) already cover that hand-off directly.
			let riseMono = true, flatHold = true, fallMono = true;
			for (let i = 1; i <= R.rampIdx; i++) { if (R.sp[i] < R.sp[i - 1] - 1e-9) { riseMono = false; } }
			for (let i = R.rampIdx; i <= R.holdIdx; i++) {
				if (Math.abs(R.sp[i] - vPeak) / vPeak > 0.005) { flatHold = false; }
			}
			for (let i = R.holdIdx + 1; i < R.sp.length - 1; i++) { if (R.sp[i] > R.sp[i - 1] + 1e-9) { fallMono = false; } }
			check('speed rises (non-decreasing) from cruise up to the plateau', riseMono);
			check('...holds flat across the plateau (within 0.5%)', flatHold);
			check('...and falls (non-increasing) from the plateau back to cruise (excl. the written landing tick)', fallMono);
			check('the first tick is within 0.1% of cruise', Math.abs(R.sp[0] - V_ORB) / V_ORB < 0.001,
				R.sp[0].toFixed(4) + ' vs ' + V_ORB.toFixed(4));
			check('the last tick is cruise exactly (the written exit velocity, not the sampled position delta)',
				Math.abs(Math.hypot(R.exitVec.x, R.exitVec.y) - V_ORB) < 1e-9,
				Math.hypot(R.exitVec.x, R.exitVec.y).toFixed(6));
			// No corner in ACCEL VALUE at either knee (dv/ds = 0 at both, by construction - see
			// crossVAt's own comment): consecutive per-tick speed deltas never jump by more than the
			// pinned ratio anywhere in the table. Re-pinned from a measured run (plan.md WP4.5.7 - do
			// not guess): unlike the old single-ramp build, a chunk of this table now sits on the FLAT
			// plateau, where consecutive deltas are both near zero and their ratio is dominated by
			// floating-point/RK2 noise rather than any real corner - measured up to ~26 there, so the
			// bound is pinned well above that noise floor rather than the old build's tight 4x, which
			// assumed every sample was on a genuinely curving part of the path. Stops one short of the
			// end for the same written-not-sampled reason as above.
			let worstJumpRatio = 0;
			for (let i = 2; i < R.sp.length - 1; i++) {
				const d0 = Math.abs(R.sp[i - 1] - R.sp[i - 2]), d1 = Math.abs(R.sp[i] - R.sp[i - 1]);
				if (d0 > 1e-9) { worstJumpRatio = Math.max(worstJumpRatio, d1 / d0); }
			}
			check('acceleration has no corner at either knee - no consecutive-delta jump over 40x',
				worstJumpRatio <= 40 + 1e-6, worstJumpRatio.toFixed(2));

			// Nothing has a corner in ACCEL VALUE. plan.md WP4.5.1 re-pins both bounds from a measured
			// run: the plateau's knees sit deep inside the still-tight entry/exit blends
			// (BASE_DRONE_CROSS_BLEND_FRAC puts ~80% of the path in the two C2 joins), so turn rises
			// from the old single-ramp build's 5.63 rad/s to a measured 8.46, and accel from 0.79 to
			// 1.95 - both asserted here with headroom, not tuned to just clear.
			const TURN_BOUND = 10 * config.TICK_MS / 1000;
			const ACCEL_BOUND = 2.5;
			check('no corner: the peak in-cross turn rate stays under 10 rad/s', R.peakTurn < TURN_BOUND,
				(R.peakTurn * 1000 / config.TICK_MS).toFixed(2) + ' rad/s');
			check('...and the peak in-cross acceleration under 2.5 ref-units/tick^2', R.peakAccel < ACCEL_BOUND,
				R.peakAccel.toFixed(4) + ' vs ' + ACCEL_BOUND.toFixed(4));
			// The measured duration at every level (plan.md WP4.5.1's own sweep table, RAMP=0.25):
			// 80/86/93/100/106 ticks at levels 1-5, about 25% quicker than the old single-ramp build's
			// 107/116/125/134/143 - pinned here for the home level (3); the every-level loop below
			// pins all five.
			check('duration at the home level is 93 ticks (2.33s) - the plateau is ~25% quicker',
				Math.abs(R.tbl.length - 93) <= 1, R.tbl.length);

			// The landing, and the bulge that is now gone: the entry curls inward immediately, so the
			// maximum radius over the whole cross is exactly r0 - the old "never past levelR(5)"
			// allowance is not needed any more.
			check('the landing radius is levelR(1) +-0.5', Math.abs(R.exitR - R1) < 0.5, R.exitR.toFixed(3) + ' vs ' + R1);
			check('...at cruise speed, within 2%', Math.abs(Math.hypot(R.exitVec.x, R.exitVec.y) - V_ORB) / V_ORB < 0.02,
				Math.hypot(R.exitVec.x, R.exitVec.y).toFixed(3) + ' vs ' + V_ORB.toFixed(3));
			check('...and exactly tangential, so the orbit field resumes with zero error',
				Math.abs((R.exitVec.x * Math.cos(R.exitAngle) + R.exitVec.y * Math.sin(R.exitAngle)) /
					Math.hypot(R.exitVec.x, R.exitVec.y)) < 0.02);
			// It lands 2*CROSS_LEAD past the entry's own raw antipode, not exactly opposite it - lead
			// is applied once to offset the line off the drone's actual position, then again at the
			// landing point (planCross()'s own comment) - the user's "5-8% ahead circumferentially".
			const lead = 2 * Math.PI * config.BASE_DRONE_CROSS_LEAD * R.drone.spin;
			const angleErr = wrap(R.exitAngle - (R.entryAngle + Math.PI + 2 * lead));
			check('...lands 2*CROSS_LEAD past the antipode of where it started, within 10%',
				Math.abs(angleErr) < 0.1 * Math.abs(2 * lead), (angleErr * 180 / Math.PI).toFixed(2) + ' degrees off');
			check('level === 1 on exit', R.drone.level === 1, R.drone.level);
			// The climb back to HOME after this (WP4.5.0's drift-home retry loop, congestion and all) is
			// already covered in isolation by the "drift home, re-timed" tests above, with a controlled
			// ledger instead of this real room's live occupancy.
		}

		// --- the same invariants over every level and both spins ----------------------------------
		{
			const CROSS_BUDGET = tick.ticks(config.BASE_DRONE_CROSS);
			// plan.md WP4.5.1's own sweep at RAMP=0.25 (lib/config.js's BASE_DRONE_CROSS_RAMP
			// comment carries the full table) - ~25% quicker than the previous single-ramp build's
			// 107/116/125/134/143.
			const EXPECT_TICKS = [80, 86, 93, 100, 106];
			let straight = true, peaked = true, bracketed = true, landed = true, lengths = true;
			let noBulge = true, inSquare = true, sane = true, underBudget = true, duration = true;
			const shape = [];
			for (let level = 1; level <= config.BASE_DRONE_LEVELS; level++) {
				for (const spin of [1, -1]) {
					const R = flyCross(level, spin);
					let worst = 0;
					for (let i = R.Te; i < R.Te + R.Ts; i++) { worst = Math.max(worst, R.perp(R.pts[i])); }
					if (!(worst < 0.1)) { straight = false; }
					// plan.md WP4.5.1: a PLATEAU now, not a single peak tick - a VALUE check at
					// rampIdx/holdIdx (see the detailed pass above for why not an index comparison
					// against R.peakSpdIdx - RK2 converges to the exact max asymptotically across the
					// whole plateau).
					const vPk = R.sp[R.peakSpdIdx];
					if (!(Math.abs(R.sp[R.rampIdx] - vPk) / vPk < 0.01)) { peaked = false; }
					if (!(Math.abs(R.sp[R.holdIdx] - vPk) / vPk < 0.01)) { peaked = false; }
					for (let i = 1; i <= R.rampIdx && peaked; i++) { if (R.sp[i] < R.sp[i - 1] - 1e-9) { peaked = false; } }
					for (let i = R.holdIdx + 1; i < R.sp.length - 1 && peaked; i++) { if (R.sp[i] > R.sp[i - 1] + 1e-9) { peaked = false; } }
					if (!(R.centreAlong > 0 && R.centreToEnd > 0 && R.centrePerp < 0.01)) { bracketed = false; }
					if (!(Math.abs(R.exitR - R1) < 0.5 && R.drone.level === 1)) { landed = false; }
					if (!(R.tbl.length === R.ticks[0] + R.ticks[1] + R.ticks[2] && R.pts.length === R.tbl.length)) { lengths = false; }
					// The entry curls INWARD from the first tick, so the whole cross stays inside the
					// ring it started on - plan.md WP4.5.0's "the radial bulge is gone".
					if (!(R.maxR <= R.r0 + 1)) { noBulge = false; }
					if (!(R.maxDx <= room.baseSize / 2 && R.maxDy <= room.baseSize / 2)) { inSquare = false; }
					// plan.md WP4.5.1 re-pins both from the measured sweep (turn 8.46, accel 1.95 at
					// RAMP=0.25, up from the old single-ramp build's 5.63/0.79).
					if (!(R.peakTurn < 10 * config.TICK_MS / 1000 && R.peakAccel < 2.5)) { sane = false; }
					if (!(R.tbl.length < CROSS_BUDGET)) { underBudget = false; }
					if (!(Math.abs(R.tbl.length - EXPECT_TICKS[level - 1]) <= 1)) { duration = false; }
					if (spin === 1) {
						shape.push('L' + level + ' ' + R.segs.join('/') + ' = ' +
							(R.tbl.length * config.TICK_MS / 1000).toFixed(2) + 's, turn ' +
							(R.peakTurn * 1000 / config.TICK_MS).toFixed(2) + ' rad/s, accel ' + R.peakAccel.toFixed(3));
					}
				}
			}
			check('every level x both spins: the straight is straight to floating point', straight);
			check('...the peak is a held plateau (first reached by RAMP, still held at 1-RAMP), non-decreasing/flat/non-increasing either side', peaked);
			check('...with the orbit centre on it and bracketed by its two ends', bracketed);
			check('...landing on level 1 at levelR(1) +-0.5', landed);
			check('...with a table exactly as long as its own three segments, flown to the last tick', lengths);
			check('...never bulging past the ring it left (maxR <= r0 + 1)', noBulge);
			check('...and never leaving the base square', inSquare);
			check('...with no corner in it at any level (turn < 10 rad/s, accel < 2.5)', sane);
			check('...and finishing well inside one BASE_DRONE_CROSS period', underBudget);
			check('...and matching the measured duration table (80/86/93/100/106 ticks) within 1 tick', duration);
			console.log('  note swoosh entry/straight/exit ticks per level (spin +1):');
			for (const line of shape) { console.log('       ' + line); }
		}
	}

	// ---- WP4.5.0: nothing has a corner in it - bounded acceleration and jerk everywhere ------------
	{
		const room = makeRoom('4team');
		const drone = room.INSTANCE.bullets.get(room.dronePosts.find((p) => p.level === config.BASE_DRONE_LEVEL_HOME).slot);
		const TURN = tick.perTick(config.BASE_DRONE_TURN);
		const CHASE_TURN = tick.perTick(config.BASE_DRONE_CHASE_TURN);
		const MINSPD = 0.5 * tick.perTick(config.BASE_DRONE_ORBIT_SPEED);
		// The fastest non-curve state is CHASE now (plan.md WP4.5.1), not cruise - its own tighter
		// CHASE_TURN paired with its own much higher speed is the bound that actually has to hold.
		const OUT_ACCEL = tick.perTick(config.BASE_DRONE_ACCEL) +
			tick.perTick(config.BASE_DRONE_CHASE_SPEED) * CHASE_TURN + 1e-9;
		const OUT_JERK = 2 * OUT_ACCEL + 1e-6;
		let prevHead = drone.head, prevVx = drone.vec.x, prevVy = drone.vec.y, prevAx = 0, prevAy = 0, first = true, firstA = true;
		let sharpOut = false, sharpIn = false, slow = false, hardAccelOut = false, hardAccelIn = false, hardJerkOut = false;
		let peakAccelIn = 0, peakJerkIn = 0, peakTurnIn = 0;
		// A 'home' switch arc is a third exempt state alongside crossing (plan.md WP4.5.0), but
		// measured against real geometry across the whole level table it never actually approaches
		// either outside-curve bound - its own sweep is a shallow ~10 degrees over ~70 ticks, well
		// under TURN's per-tick allowance - so it is sampled and its own peaks are printed for the
		// record, without a separate generous multiplier the way the cross needs one.
		let peakAccelSwitch = 0, peakJerkSwitch = 0, peakTurnSwitch = 0;
		// The in-cross bounds are the swoosh's own measured geometry (plan.md WP4.5.1: <= 8.46 rad/s
		// and <= 1.95 ref-units/tick^2 across levels 1-5 at BASE_DRONE_CROSS_RAMP=0.25, up from the
		// previous single-ramp build's 5.63/0.79 - the plateau's two knees sit deep inside the still-
		// tight entry/exit C2 blends, which is what costs the extra turn/accel), not a generous
		// multiple of the outside-cross figure. The curve is exempt from the turn/accel limiter, but
		// still bounded well inside BASE_DRONE_ACCEL's own scale. The swoosh's speed is a plateau now
		// (plan.md WP4.5.1) - ramp up over the first RAMP of the path, hold peak across the middle,
		// ramp down over the last RAMP - not one continuous ramp to a single peak at the centre.
		const IN_TURN = 10 * config.TICK_MS / 1000;      // 10 rad/s, in radians per real tick
		// Measured (drone.vec-delta based, real-tick units): up to ~1.95 across a natural cross
		// cycle. Not a tick.perTick() conversion - this bound is calibrated against what THIS
		// measurement actually produces, the same way TURN_BOUND above is.
		const IN_ACCEL = 2.5;
		let prevChasing = drone.chasing;
		const sample = () => {
			const dHead = Math.atan2(Math.sin(drone.head - prevHead), Math.cos(drone.head - prevHead));
			// A RETURN blends its turn limit up toward CHASE_TURN on the same smoothstep k as its
			// speed (plan.md WP4.5.13), so the bound outside a chase is that blend, not a flat
			// BASE_DRONE_TURN. Measured from the POST-update position with a one-tick slack: |err|
			// moves at most CHASE_SPEED per tick, i.e. at most ~0.007 rad/tick of blend, comfortably
			// inside the 0.01 allowance (BASE_DRONE_TURN itself is 0.0625 rad/tick).
			const e = Math.min(1, Math.abs(drone.orbRTarget -
				Math.hypot(drone.x - drone.ox, drone.y - drone.oy)) / config.BASE_DRONE_RETURN_ERR);
			const k = e * e * (3 - 2 * e);
			const turnLimit = drone.chasing ? CHASE_TURN : TURN + (CHASE_TURN - TURN) * k + 0.01;
			if (drone.crossing) {
				if (Math.abs(dHead) > peakTurnIn) { peakTurnIn = Math.abs(dHead); }
				if (Math.abs(dHead) > IN_TURN) { sharpIn = true; }
			} else if (prevChasing && !drone.chasing) {
				// The one deliberate discontinuity in `head` outside a curve (plan.md WP4.5.16): on
				// the tick a pursuit ends the drone snaps onto the orbit field's direction rather
				// than slewing to it over the next half second, which is what stops it flying
				// further out - and, against the map clamp, hanging at the arena edge - first.
			} else {
				if (drone.switching && Math.abs(dHead) > peakTurnSwitch) { peakTurnSwitch = Math.abs(dHead); }
				if (Math.abs(dHead) > turnLimit + 1e-9) { sharpOut = true; }
			}
			prevChasing = drone.chasing;
			if (Math.hypot(drone.vec.x, drone.vec.y) < MINSPD - 1e-9 && !drone.crossing && !drone.chasing) { slow = true; }
			const ax = drone.vec.x - prevVx, ay = drone.vec.y - prevVy;
			const accelMag = Math.hypot(ax, ay);
			if (!first) {
				if (drone.crossing) {
					if (accelMag > peakAccelIn) { peakAccelIn = accelMag; }
					if (accelMag > IN_ACCEL) { hardAccelIn = true; }
				} else {
					if (drone.switching && accelMag > peakAccelSwitch) { peakAccelSwitch = accelMag; }
					if (accelMag > OUT_ACCEL) { hardAccelOut = true; }
				}
			}
			if (!firstA) {
				const jx = ax - prevAx, jy = ay - prevAy;
				const jerkMag = Math.hypot(jx, jy);
				if (drone.crossing) {
					if (jerkMag > peakJerkIn) { peakJerkIn = jerkMag; }
				} else if (drone.switching && jerkMag > peakJerkSwitch) { peakJerkSwitch = jerkMag; }
				if (!drone.crossing && jerkMag > OUT_JERK) { hardJerkOut = true; }
			}
			prevHead = drone.head; prevAx = ax; prevAy = ay; prevVx = drone.vec.x; prevVy = drone.vec.y;
			first = false; firstA = false;
		};
		for (let i = 0; i < 800; i++) { drone.update(); sample(); }   // a natural cross cycle or two
		for (let i = 0; i < 150; i++) {   // a forced chase, target circling the base
			drone.chasing = true; drone.crossing = false;
			drone.DETEC.select = { x: drone.ox + 50 * Math.cos(i * 0.1), y: drone.oy + 50 * Math.sin(i * 0.1), destroy: 0 };
			drone.update(); sample();
		}
		drone.chasing = false; drone.crossing = false; drone.DETEC.select = 0;
		// Isolate the return, or a naturally-expiring crossIn can trigger a swoosh while the drone is
		// still 5 ring-radii out - planCross()'s entry blend assumes a near-circular starting state,
		// so a cross launched from a fast, far-off-ring position (not what it's designed for) produces
		// a much sharper curve than any cross that actually starts from a settled ring. That is a real
		// interaction, not a test bug, but this section is specifically about the RETURN's own bound.
		drone.crossIn = 1e9;
		drone.x = drone.ox + drone.orbRTarget * 5; drone.y = drone.oy;   // a forced long return
		for (let i = 0; i < 150; i++) { drone.update(); sample(); }
		// A forced 'home' switch, isolated - the natural window above depends on a staggered spawn
		// crossIn eventually clearing this drone off HOME, which is not reliable inside any fixed
		// sample budget (WP4.5.0's climb is deliberately not guaranteed-fast under congestion), so
		// this drives one directly the way the drift-home tests above do.
		drone.chasing = false; drone.crossing = false; drone.switching = false; drone.crossIn = 1e9;
		drone.levels = makeLevels([5, 5, 5, 5, 5], [0, 0, 4, 1, 0]);
		drone.level = 4;
		drone.orbRTarget = room.levelR(4);
		drone.switchCooldown = 0;
		placeOnRing(drone, room.levelR(4), 0);
		drone.levelTimer = 1;
		drone.homing = 1;   // 'home' mode is only ever reached via a homing climb now (plan.md WP4.5.0)
		// placeOnRing() teleports head/vec directly - reset the sampler's own state to match, or its
		// first sample compares against the previous segment's stale heading/velocity, which is a
		// test-harness discontinuity, not a real one.
		prevHead = drone.head; prevVx = drone.vec.x; prevVy = drone.vec.y; first = true; firstA = true;
		for (let i = 0; i < 300; i++) {
			drone.update(); sample();
			if (!drone.switching && i > 2) { break; }
		}
		check('head never turns faster than BASE_DRONE_TURN (or CHASE_TURN while chasing) outside a cross',
			!sharpOut);
		check('...and during one, stays under 8 rad/s - the swoosh has no corner in it', !sharpIn,
			'peak ' + (peakTurnIn * 1000 / config.TICK_MS).toFixed(2) + ' rad/s');
		check('speed never drops below half cruise outside a cross or a chase - no dead stop anywhere', !slow);
		check('acceleration stays within the turn/accel-slew bound outside a cross', !hardAccelOut);
		check('jerk stays bounded outside a cross', !hardJerkOut);
		check('acceleration during a cross stays bounded - inside BASE_DRONE_ACCEL\'s own scale, even ' +
			'though the curve is exempt from the limiter', !hardAccelIn,
			'peak ' + peakAccelIn.toFixed(4) + ' vs ' + IN_ACCEL.toFixed(4));
		console.log('  note measured in-cross peak turn/accel/jerk per tick: ' +
			(peakTurnIn * 1000 / config.TICK_MS).toFixed(2) + ' rad/s / ' + peakAccelIn.toFixed(4) +
			' / ' + peakJerkIn.toFixed(4) + ' (bounds ' + IN_TURN.toFixed(4) + ' rad, ' + IN_ACCEL.toFixed(4) + ')');
		console.log('  note measured in-switch peak turn/accel/jerk per tick: ' +
			(peakTurnSwitch * 180 / Math.PI).toFixed(2) + ' deg / ' + peakAccelSwitch.toFixed(4) + ' / ' +
			peakJerkSwitch.toFixed(4) + ' (both comfortably under the outside-cross bounds above)');
	}

	// (The BASE_DRONE_CROSS_BLEND_ARC fixpoint test that used to sit here is deleted with the
	// constant itself - plan.md WP4.5.0 solves a blend's shape parameter by fixed point at plan
	// time, so there is no measured overhead factor left to re-measure and paste back.)

	// ---- WP4.5.2(A): clampToMap() actually stops/redirects a drone, not just teleports it ---------
	// Before this fix, clampToMap() zeroed this.vec.x/y on the clamped axis, but case 1.4's own
	// steering tail derives vec FROM head/spd at the top of every tick, so the zeroed component was
	// overwritten before it was ever read - the clamp just moved the drone back onto the boundary
	// once a tick, forever, while spd sat at full chase speed. Reproduced headlessly, both halves.
	{
		const room = makeRoom('4team');
		const post = room.dronePosts.find((p) => p.level === config.BASE_DRONE_LEVEL_HOME);
		const mx = room.map.width / 2 + config.OOB_MARGIN, my = room.map.height / 2 + config.OOB_MARGIN;

		// (1) Parked at the corner, not chasing: a slide, not a multi-tick freeze.
		{
			const drone = room.INSTANCE.bullets.get(post.slot);
			drone.crossIn = 1e9;
			drone.update();
			drone.chasing = false; drone.crossing = false; drone.switching = false;
			drone.DETEC.select = 0; drone.levels.threat = null;
			drone.x = -mx; drone.y = -my;
			drone.head = Math.atan2(-1, -1);   // pointing straight out of the corner
			drone.spd = tick.perTick(config.BASE_DRONE_CHASE_SPEED);
			drone.vec.x = Math.cos(drone.head) * drone.spd;
			drone.vec.y = Math.sin(drone.head) * drone.spd;
			drone.pvec.x = drone.vec.x; drone.pvec.y = drone.vec.y;
			// A drone starting EXACTLY on the corner's diagonal still takes a turn-rate-bounded
			// number of ticks to rotate off it before either axis's velocity survives the clamp -
			// that delay is geometry (BASE_DRONE_TURN), present with or without this fix, and is not
			// what the fix changes. What the fix actually buys: the escape is BOUNDED (not the
			// "stuck forever" of the chasing case below) and, once moving, it is a continuous slide -
			// it never freezes again.
			let firstMoveIdx = -1, refroze = false, prev = { x: drone.x, y: drone.y };
			const start = { x: drone.x, y: drone.y };
			for (let i = 0; i < 40; i++) {
				drone.crossIn = 1e9;   // keep a natural cross from interrupting this measurement
				drone.update();
				const moved = Math.abs(drone.x - prev.x) > 1e-9 || Math.abs(drone.y - prev.y) > 1e-9;
				if (moved && firstMoveIdx < 0) { firstMoveIdx = i; }
				if (!moved && firstMoveIdx >= 0) { refroze = true; }
				prev = { x: drone.x, y: drone.y };
			}
			const moved = Math.hypot(drone.x - start.x, drone.y - start.y);
			check('a drone parked at the corner escapes within 20 ticks - bounded, not stuck forever',
				firstMoveIdx >= 0 && firstMoveIdx < 20, firstMoveIdx);
			check('...and once moving, never freezes again - a continuous slide, not a one-off nudge',
				!refroze);
			check('...and has moved at least 200 units by tick 40', moved >= 200, moved.toFixed(1));
		}

		// (2) Chasing a target parked ON the clamp box - the furthest out a player can actually get.
		// The chase is now DELIBERATELY held (plan.md WP4.5.15): a base drone follows a live target
		// exactly as far into the dark OOB band as a player may run, slides along the wall beside it
		// and keeps dealing damage, because the wiki's base is "impossible to linger around". The
		// "target past my own clamp box" drop that used to be asserted here was a guard that could
		// never fire in the first place - DETEC.type is [KIND.PLAYER] and entities/Player.js's
		// motion() clamps a Player to EXACTLY this same box, so the strict > never held at equality -
		// and the corner pin it was blamed for was clampToMap()'s doing (plan.md WP4.5.12).
		{
			const drone = room.INSTANCE.bullets.get(post.slot);
			const sx = Math.sign(drone.ox) || 1, sy = Math.sign(drone.oy) || 1;
			const cx = sx * mx, cy = sy * my;   // the OOB corner nearest THIS drone's own base
			drone.crossIn = 1e9; drone.crossing = false; drone.switching = false;
			// Started just inside the corner so the first tick is a real approach into the wall, not
			// a clamp against a position the drone was already sitting on.
			drone.x = cx - sx * 40; drone.y = cy - sy * 40;
			drone.head = Math.atan2(sy, sx);   // pointing straight out at the corner
			drone.spd = tick.perTick(config.BASE_DRONE_CHASE_SPEED);
			drone.vec.x = Math.cos(drone.head) * drone.spd;
			drone.vec.y = Math.sin(drone.head) * drone.spd;
			drone.chasing = true;
			drone.DETEC.enabled = 0;
			drone.DETEC.select = { x: cx, y: cy, destroy: 0 };
			drone.levels.threat = drone.DETEC.select;
			drone.levels.threatAt = room.timestamp;
			let frozen = 0, prev = { x: drone.x, y: drone.y };
			for (let i = 0; i < 40; i++) {
				drone.crossIn = 1e9;
				drone.update();
				if (drone.x === prev.x && drone.y === prev.y) { frozen++; }
				prev = { x: drone.x, y: drone.y };
			}
			check('a target standing on the OOB wall is still chased - a base is not lingerable',
				drone.chasing);
			check('...and the drone works the wall beside it instead of freezing against it',
				frozen === 0, frozen + ' frozen ticks');
			// And the moment that target dies the drone is already on its way home, on that same
			// tick - not after a half-second of slewing (plan.md WP4.5.16).
			drone.DETEC.select.destroy = 1;
			const before = Math.hypot(drone.x - drone.ox, drone.y - drone.oy);
			drone.crossIn = 1e9;
			drone.update();
			const after = Math.hypot(drone.x - drone.ox, drone.y - drone.oy);
			check('...and the tick its target dies it is already closer to its own orbit centre',
				!drone.chasing && after < before, after.toFixed(1) + ' vs ' + before.toFixed(1));
		}

		// (3) The clamp never fires mid-curve - the existing comment's own claim, pinned for real
		// over a real room's early ticks (crossing/switching are the two states where position comes
		// from a planned table, not the steered field the clamp is designed to redirect).
		{
			const room2 = makeRoom('4team');
			const mx2 = room2.map.width / 2 + config.OOB_MARGIN, my2 = room2.map.height / 2 + config.OOB_MARGIN;
			let clampedMidCurve = false;
			for (let i = 0; i < 2000 && !clampedMidCurve; i++) {
				room2.step();
				for (const p2 of room2.dronePosts) {
					const d = room2.INSTANCE.bullets.get(p2.slot);
					if (!d || d.destroy || (!d.crossing && !d.switching)) { continue; }
					if (Math.abs(d.x) >= mx2 - 1e-6 || Math.abs(d.y) >= my2 - 1e-6) { clampedMidCurve = true; }
				}
			}
			check('the clamp never actually fires while a drone is crossing or switching, over 2000 real ticks',
				!clampedMidCurve);
		}
	}

	// ---- WP4.5.2(B)/(C): a stale detected target no longer latches a base out of ever chasing again
	{
		const Detector = require(path.join(ROOT, 'entities', 'Detector.js'));
		const KIND = require(path.join(ROOT, 'public', 'SHARE', 'kinds.js'));
		// (C) The direct unit fix: reset() forgets select, not just dis/construc.
		const det = new Detector({ id: { oId: 0 }, kind: KIND.PLAYER }, 0, 0, 100, [KIND.PLAYER]);
		det.select = { fake: 1 };
		det.reset();
		check('Detector.reset() clears select, not just dis/construc', det.select === 0, det.select);
	}
	{
		// (B) A destroyed threat is cleared the moment tickDroneCentres() sees it - directly, not via
		// a full step() (which could immediately re-populate it and mask the assertion in a race).
		const room = makeRoom('4team');
		const centre = room.droneCentres.find((c) => c.posts[0].team === 0);
		centre.levels.threat = { x: 0, y: 0, destroy: 1 };
		centre.levels.threatAt = room.timestamp;
		room.tickDroneCentres();
		check('a destroyed threat is cleared the instant tickDroneCentres() runs',
			centre.levels.threat === null);
	}
	{
		// (B) A threat nobody has re-sighted for two full scout rotations expires on its own, with no
		// destroy flag involved - isolated to tickDroneCentres() itself (no step(), so no live player
		// can accidentally re-populate it and no drone update() runs either).
		const room = makeRoom('4team');
		const centre = room.droneCentres.find((c) => c.posts[0].team === 0);
		const oneRotation = config.BASE_DRONE_SCAN * centre.posts.length;
		centre.levels.threat = { x: 0, y: 0, destroy: 0 };
		centre.levels.threatAt = room.timestamp;
		let clearedAt = -1;
		for (let i = 1; i <= oneRotation * 2 + 5 && clearedAt < 0; i++) {
			room.timestamp++;
			room.tickDroneCentres();
			if (centre.levels.threat === null) { clearedAt = i; }
		}
		check('a threat unseen for two scout rotations expires within the window',
			clearedAt > 0 && clearedAt <= oneRotation * 2 + 1, clearedAt + ' vs window ' + (oneRotation * 2));
		check('...and not before one full scout rotation has passed',
			clearedAt > oneRotation, clearedAt + ' vs ' + oneRotation);
	}
	{
		// (B) The regression this whole fix targets: a dead reference latched into levels.threat (the
		// respawn() scenario - a fresh Player object means the old one's destroy stays 1 forever) must
		// not stop a LIVE enemy inside DETECT/LEASH from being chased.
		const room = makeRoom('4team');
		const centre = room.droneCentres.find((c) => c.posts[0].team === 0);
		const anchor = room.INSTANCE.bullets.get(centre.posts[0].slot);
		centre.levels.threat = { x: anchor.ox, y: anchor.oy, destroy: 1 };
		centre.levels.threatAt = room.timestamp;
		const me = player(room, 0);
		me.team = anchor.team === 0 ? 1 : 0;
		me.shield = 0;
		me.alpha = 1;
		me.x = anchor.ox + 1478 * Math.cos(0.4);
		me.y = anchor.oy + 1478 * Math.sin(0.4);
		let chased = false;
		for (let i = 0; i < 700 && !chased; i++) {
			room.step();
			for (const p of centre.posts) {
				const d = room.INSTANCE.bullets.get(p.slot);
				if (d && d.chasing) { chased = true; }
			}
		}
		check('a stale dead threat does not stop a live enemy inside DETECT/LEASH from being chased',
			chased);
	}
	{
		// (C) The one dependency the fix must not break: a CHASING drone deliberately keeps its own
		// DETEC.select alive across ticks with DETEC.enabled = 0 - reset() is never called while
		// chasing, so this must survive the select-clearing fix unchanged.
		const room = makeRoom('4team');
		const post = room.dronePosts.find((p) => p.level === config.BASE_DRONE_LEVEL_HOME);
		const drone = room.INSTANCE.bullets.get(post.slot);
		drone.crossIn = 1e9;
		drone.update();
		const target = { x: drone.ox + 500, y: drone.oy, destroy: 0 };
		drone.levels.threat = drone.DETEC.select = target;
		drone.levels.threatAt = room.timestamp;
		drone.chasing = true;
		drone.DETEC.enabled = 0;
		for (let i = 0; i < 20; i++) { drone.crossIn = 1e9; drone.update(); }
		check('a chasing drone keeps its own DETEC.select across ticks (DETEC.enabled stays 0)',
			drone.DETEC.select === target);
	}

	// ---- WP4.5.0: cross concurrency is sized from measured demand, not fixed at one --------------
	// A 4team centre's twelve drones now share up to `crossCap` lanes (plan.md WP4.5.0 - sized from
	// estimateCrossTicks() so each drone still crosses roughly every BASE_DRONE_CROSS regardless of
	// how many share its centre), not a single mutex serialising every drone through one lane the
	// way the previous pass did.
	{
		const room = makeRoom('4team');
		const posts = room.dronePosts.filter((p) => p.team === 0);
		const drones = posts.map((p) => room.INSTANCE.bullets.get(p.slot));
		for (const d of drones) { d.crossIn = 1e9; d.chasing = false; }
		for (let i = 0; i < 60; i++) { for (const d of drones) { d.update(); } }   // warm up first
		for (const d of drones) { d.crossIn = 1; }
		const ledger = drones[0].levels;
		check("crossCap matches the formula, not a pasted number",
			ledger.crossCap === Math.max(1, Math.ceil(drones.length *
				config.BASE_DRONE_LEVEL_WEIGHTS.reduce((sum, w, i) =>
					sum + w * Bullet.estimateCrossTicks(room.levelR(i + 1), room.levelR(1)), 0) /
				config.BASE_DRONE_LEVEL_WEIGHTS.reduce((a, b) => a + b, 0) / tick.ticks(config.BASE_DRONE_CROSS))),
			ledger.crossCap);
		let maxConcurrent = 0;
		const crossedOnce = drones.map(() => false);
		// All 12 arm on the same tick above, so a centre whose crossCap is 4 still queues the other
		// eight - each full cross plus its own re-arm is ~120-150 real ticks, so even at up to 4
		// concurrent lanes the full roster takes multiple rounds to each get a turn.
		for (let i = 0; i < 1700; i++) {
			for (let k = 0; k < drones.length; k++) {
				drones[k].update();
				if (drones[k].crossing) { crossedOnce[k] = true; }
			}
			if (ledger.crossing > maxConcurrent) { maxConcurrent = ledger.crossing; }
		}
		check('the number simultaneously mid-cross never exceeds the centre\'s own crossCap',
			maxConcurrent <= ledger.crossCap, maxConcurrent + ' vs ' + ledger.crossCap);
		check('...and more than one really did overlap - the cap is generalized, not still pinned at one',
			maxConcurrent > 1, maxConcurrent);
		check('every drone at the centre eventually got its turn to cross (none starved)',
			crossedOnce.every((c) => c), crossedOnce.filter((c) => !c).length + ' never crossed');
	}

	// ---- WP4.5.0: the binomial sorter converges from any perturbed state -------------------------
	// "Moving one unit of surplus one step toward the nearest deficit strictly decreases
	// sum(|count-target|) by 2 and no move increases it" (plan.md WP4.5.0) - a path-graph
	// transportation argument, checked directly here rather than trusted, since it is exactly the
	// property that keeps the "nearest deficit" rule from quietly being "simplified" into "toward
	// home" (which does not converge to the binomial).
	{
		const room = makeRoom('4team');
		const centre = room.droneCentres.find((c) => c.posts[0].team === 0);
		const n = centre.posts.length;
		const target = room.levelTargets(n);
		const sumAbsErr = (levels) => levels.count.reduce((s, c, i) => s + Math.abs(c - target[i]), 0);
		const scatter = () => {
			// Randomly relevel every drone at the centre, fixing up levels.count to match, and reset
			// every drone to eligible (on-ring, off cooldown, idle) so the sorter is free to act.
			centre.levels.count = [0, 0, 0, 0, 0];
			for (const post of centre.posts) {
				const d = room.INSTANCE.bullets.get(post.slot);
				const lvl = 1 + Math.floor(Math.random() * config.BASE_DRONE_LEVELS);
				d.level = lvl;
				d.orbRTarget = room.levelR(lvl);
				placeOnRing(d, room.levelR(lvl), Math.random() * Math.PI * 2);
				d.crossing = false; d.chasing = false; d.switching = false; d.homing = false;
				d.switchCooldown = 0; d.crossIn = 1e9; d.tooClose = 0; d.reactPending = 0;
				centre.levels.count[lvl - 1]++;
			}
		};
		let converged = 0, monotone = true, idempotentAtTarget = true, respectsBusy = true, boundedMove = true;
		for (let trial = 0; trial < 200; trial++) {
			scatter();
			let prevErr = sumAbsErr(centre.levels);
			let guard = 0;
			while (sumAbsErr(centre.levels) > 0 && guard++ < 200) {
				room.sortDroneCentre(centre);
				const err = sumAbsErr(centre.levels);
				if (err > prevErr) { monotone = false; }
				prevErr = err;
				// Let any drone a move just put onto a planned arc actually FLY it (up to ~76 ticks -
				// eligible() excludes a mid-switch drone, so without this a drone the sorter just
				// moved would stay artificially "busy" forever in this tight loop, unlike real
				// gameplay where BASE_DRONE_SORT_PERIOD gives ticks to pass between sort calls.
				for (let s = 0; s < 80; s++) {
					let anySwitching = false;
					for (const post of centre.posts) {
						const d = room.INSTANCE.bullets.get(post.slot);
						if (d.switching) { anySwitching = true; d.update(); }
					}
					if (!anySwitching) { break; }
				}
			}
			if (sumAbsErr(centre.levels) === 0) { converged++; }
			if (centre.levels.count.reduce((a, b) => a + b, 0) !== n) { respectsBusy = false; }   // ledger sum invariant, opportunistic re-check
		}
		check('the sorter converges to the live-count binomial target from 200 random perturbations',
			converged === 200, converged + '/200');
		check('...and sum(|count-target|) never increases from one pass to the next', monotone);

		// Idempotent at the target: starting already-sorted, passes move nothing.
		{
			scatter();
			// Force the ledger directly onto target rather than relying on the sorter to get there -
			// independent of the convergence test above. sortDroneCentre() only ever reads
			// levels.count against the target it's comparing to, so this alone is enough to check
			// "at target, nothing moves further" without needing every individual drone's own
			// `.level` to match count exactly.
			centre.levels.count = target.slice();
			for (let pass = 0; pass < 100; pass++) { room.sortDroneCentre(centre); }
			for (let i = 0; i < 5; i++) { idempotentAtTarget = idempotentAtTarget && (centre.levels.count[i] === target[i]); }
		}
		check('...and is idempotent once at the target - passes move nothing further', idempotentAtTarget);

		// Respects busy drones: mark every drone at the centre busy, scatter the counts off target,
		// and confirm a pass moves nobody (the sorter can find surplus/deficit but no eligible mover).
		{
			scatter();
			for (const post of centre.posts) {
				const d = room.INSTANCE.bullets.get(post.slot);
				d.crossing = true;   // busy in a way eligible() checks for
			}
			const before = centre.levels.count.slice();
			room.sortDroneCentre(centre);
			respectsBusy = respectsBusy && before.every((c, i) => c === centre.levels.count[i]);
		}
		check('...and respects busy drones - a fully-busy centre has nobody eligible to move', respectsBusy);

		// Assigns real per-drone levels (and keeps levels.count in sync) to an exact counts array -
		// unlike the ledger-only pokes above, this keeps sortDroneCentre()'s own pool lookup (which
		// reads each drone's actual `.level`) consistent with what the ledger claims.
		function setLevels(counts) {
			centre.levels.count = [0, 0, 0, 0, 0];
			let idx = 0;
			for (let lvl = 1; lvl <= config.BASE_DRONE_LEVELS; lvl++) {
				for (let k = 0; k < counts[lvl - 1]; k++) {
					const d = room.INSTANCE.bullets.get(centre.posts[idx++].slot);
					d.level = lvl;
					d.orbRTarget = room.levelR(lvl);
					placeOnRing(d, room.levelR(lvl), Math.random() * Math.PI * 2);
					d.crossing = false; d.chasing = false; d.switching = false; d.homing = false;
					d.switchCooldown = 0; d.crossIn = 1e9; d.tooClose = 0; d.reactPending = 0;
					centre.levels.count[lvl - 1]++;
				}
			}
		}
		// Moves at least one and at most the surplus: from a fixed one-off-target state (one level 3
		// over target, its level-4 neighbour one under - HOME always has a neighbour on both sides),
		// repeated independent trials never move more than that level's actual surplus (exactly 1).
		{
			const lvl = 3;
			const counts = target.slice();
			counts[lvl - 1] += 1;
			counts[lvl] -= 1;   // borrow from level 4 (index 3) to fund the level-3 surplus
			let allBounded = true;
			for (let trial = 0; trial < 500; trial++) {
				setLevels(counts);
				const before = centre.levels.count.slice();
				room.sortDroneCentre(centre);
				const moved = before[lvl - 1] - centre.levels.count[lvl - 1];
				if (moved < 0 || moved > 1) { allBounded = false; }   // surplus here is always exactly 1
			}
			boundedMove = allBounded;
		}
		check('...and moves at least one and at most the surplus per pass', boundedMove);
	}

	// ---- WP4.5.0: a post-swoosh drone climbs to HOME and only then releases to the sorter --------
	{
		const room = makeRoom('4team');
		const post = room.dronePosts.find((p) => p.level === config.BASE_DRONE_LEVEL_HOME);
		const drone = room.INSTANCE.bullets.get(post.slot);
		drone.crossIn = 1e9;
		drone.update();
		drone.DETEC.select = 0;
		drone.crossIn = 1;
		drone.update();
		let guard = 0;
		while (drone.crossing && guard++ < 500) { drone.update(); }
		check('a cross sets homing on exit, landed on level 1', drone.homing === 1 && drone.level === 1,
			'homing=' + drone.homing + ' level=' + drone.level);
		let reachedHomeAt = -1;
		for (let i = 0; i < 2 * (tick.ticks(config.BASE_DRONE_LEVEL_RELAX) + 80) && reachedHomeAt < 0; i++) {
			drone.update();
			if (drone.level === config.BASE_DRONE_LEVEL_HOME) { reachedHomeAt = i; }
		}
		check('...and climbs to HOME within 2*(relax+arc) ticks', reachedHomeAt >= 0, reachedHomeAt);
		check('...clearing `homing` exactly there', drone.homing === 0, drone.homing);

		// homing ignores the saturation cap on the climb - make level 2 structurally unsatisfiable
		// (cap 0, so `openHi` can never be true no matter what count says) without hand-editing the
		// shared ledger's live count array, which real neighbouring drones still depend on. A
		// non-homing 'home' move from level 1 would be vetoed forever by this; a homing one must not.
		const post2 = room.dronePosts.find((p) => p !== post && p.team === post.team);
		const d2 = room.INSTANCE.bullets.get(post2.slot);
		d2.levels.caps[1] = 0;   // level 2 (index 1) - impossible to ever read as "open"
		d2.level = 1; d2.orbRTarget = room.levelR(1);
		placeOnRing(d2, room.levelR(1), 1.3);
		d2.crossing = false; d2.chasing = false; d2.switching = false; d2.crossIn = 1e9;
		d2.switchCooldown = 0; d2.levelTimer = 1; d2.homing = 1;   // simulate having just landed the cross
		let reached2 = -1;
		for (let i = 0; i < 2 * (tick.ticks(config.BASE_DRONE_LEVEL_RELAX) + 80) && reached2 < 0; i++) {
			d2.update();
			if (d2.level === config.BASE_DRONE_LEVEL_HOME) { reached2 = i; }
		}
		check('homing ignores a saturated intermediate level - the climb still completes', reached2 >= 0, reached2);
	}

	// ---- WP4.5.0: the detection scout - a scan-period invariant, not a timing test -----------------
	{
		const room = makeRoom('4team');
		const centre = room.droneCentres.find((c) => c.posts[0].team === 0);
		const lastScoutTick = new Map();
		let worstGap = 0, everMultiEnabled = false;
		for (let t = 0; t < 400; t++) {
			room.step();
			let enabledCount = 0;
			for (const post of centre.posts) {
				const d = room.INSTANCE.bullets.get(post.slot);
				if (d && d.DETEC && d.DETEC.enabled) {
					enabledCount++;
					const gap = t - (lastScoutTick.has(post) ? lastScoutTick.get(post) : 0);
					if (gap > worstGap) { worstGap = gap; }
					lastScoutTick.set(post, t);
				}
			}
			if (enabledCount > 1) { everMultiEnabled = true; }
		}
		check('at most one drone per centre has its detector enabled on any given tick',
			!everMultiEnabled);
		check('every drone at the centre gets a scout turn at least once per drones*BASE_DRONE_SCAN ticks',
			worstGap <= centre.posts.length * config.BASE_DRONE_SCAN + config.BASE_DRONE_SCAN,
			worstGap + ' vs ' + (centre.posts.length * config.BASE_DRONE_SCAN));

		// Detection still works: a player standing inside BASE_DRONE_DETECT is chased within a few
		// scout rotations, not silently missed because it isn't the enabled drone's turn. Offset
		// purely along X, past the base square's own half-width (room.baseSize/2) - inside the
		// square the base fence kills the player outright each tick (a separate, pre-existing rule),
		// which would confound "was it seen" with "did it survive to be seen".
		const post = centre.posts[0];
		const target = room.INSTANCE.players.add((id) => new Player(
			{ GM: room.gm, sId: room.id, oId: id }, post.x + room.baseSize * 0.75, post.y, 'foe', 1, room.XPLVL, room));
		target.shield = 0; target.alpha = 1;
		let chasedAt = -1;
		const budget = centre.posts.length * config.BASE_DRONE_SCAN + 20;
		for (let t = 0; t < budget && chasedAt < 0; t++) {
			room.step();
			for (const p of centre.posts) {
				const d = room.INSTANCE.bullets.get(p.slot);
				if (d && d.chasing) { chasedAt = t; }
			}
		}
		check('detection still works - a player in range is chased well within a full scout rotation',
			chasedAt >= 0 && chasedAt <= budget, chasedAt + ' vs budget ' + budget);
	}

	// ---- WP4.5.1: peak speed and tunnelling, empirical -----------------------------------------
	{
		const room = makeRoom('4team');
		const post = room.dronePosts.find((p) => p.level === config.BASE_DRONE_LEVEL_HOME);
		const drone = room.INSTANCE.bullets.get(post.slot);
		drone.crossIn = 1e9;
		for (let i = 0; i < 60; i++) { drone.update(); }   // warm vec up to steady cruise first
		drone.crossIn = 1;
		drone.update();
		let maxSpeed = 0, ticks = 0;
		while (drone.crossing && ticks < 300) {
			drone.update();
			maxSpeed = Math.max(maxSpeed, Math.hypot(drone.vec.x, drone.vec.y));
			ticks++;
		}
		const bound = config.BASE_DRONE_SIZE + 20;
		check('the empirical peak cross speed also stays under drone size + smallest polygon radius',
			maxSpeed < bound, maxSpeed.toFixed(2) + ' vs ' + bound);
	}

	// ---- WP4.5.1: 2team ring spacing - the invariant nominalR used to enforce implicitly ----------
	{
		const room = makeRoom('2team');
		const widest2 = 2 * room.levelR(config.BASE_DRONE_LEVELS);
		check('adjacent 2team orbit centres never let the widest rings touch',
			room.map.height / 15 > widest2, (room.map.height / 15) + ' vs ' + widest2);
	}

	// 4.5.5 - orbit centres sit at the centre of the base area, derived from baseSize so a future
	// resize can't leave them stale the way the literal gu(24) inset did.
	{
		const four = makeRoom('4team');
		check('4team\'s orbit centre is the corner square\'s own middle, derived from baseSize',
			four.rules.teams.every((t) => {
				const c = four.corner(t), mid = four.baseCenter(t);
				return Math.abs(mid.x - (c.x - Math.sign(c.x) * four.baseSize / 2)) < 1e-9 &&
					Math.abs(mid.y - (c.y - Math.sign(c.y) * four.baseSize / 2)) < 1e-9;
			}));
		const two = makeRoom('2team');
		const drones = [...two.INSTANCE.bullets.live()].filter((b) => b.alone);
		check('2team\'s orbit centres sit at the strip\'s mid-width, derived from baseSize',
			drones.every((d) => Math.abs(Math.abs(d.ox) - (two.map.width / 2 - two.baseSize / 2)) < 1e-9));
	}

	// ---- WP4.5.12: the map clamp slides, it does not stop -----------------------------------------
	// The old clamp rebuilt `spd` from the CLAMPED vec, so a corner (both components zeroed) set it
	// to exactly 0 while `head` was deliberately left alone - the drone sat byte-identical for up to
	// 14 ticks, driving back into the same corner every tick, while head slewed away at the leisurely
	// orbit turn rate. It projects the HEADING onto the wall now and never touches `spd` at all.
	// Exercised directly against clampToMap(), the one function that changed; the behaviour it buys a
	// drone in flight is measured in the wall-chase and bait-and-return blocks below.
	{
		const room = makeRoom('4team');
		const d = room.INSTANCE.bullets.get(room.dronePosts[0].slot);
		const mx = room.map.width / 2 + config.OOB_MARGIN, my = room.map.height / 2 + config.OOB_MARGIN;
		const sx = Math.sign(d.ox) || 1, sy = Math.sign(d.oy) || 1;
		const V = tick.perTick(config.BASE_DRONE_CHASE_SPEED);

		// Pressed into the corner nearest its own base, heading straight out of it: both components
		// press outward, which is exactly the case the old clamp turned into spd = hypot(0, 0) = 0.
		d.x = sx * (mx + 5); d.y = sy * (my + 5);
		d.head = Math.atan2(sy, sx); d.spd = V;
		d.clampToMap(true);
		check('the map clamp never touches a steered drone\'s speed', d.spd === V, d.spd + ' vs ' + V);
		check('...and a corner press turns it back toward its orbit instead of into the wall',
			Math.cos(d.head) * sx < 0 && Math.sin(d.head) * sy < 0,
			(d.head * 180 / Math.PI).toFixed(1) + ' deg');
		check('...from exactly on the boundary, not somewhere past it',
			d.x === sx * mx && d.y === sy * my, d.x + ',' + d.y);

		// One wall only: the heading is projected ALONG it, at full speed - a slide, not a stop.
		d.x = sx * (mx + 5); d.y = d.oy;
		d.head = Math.atan2(sy * 0.5, sx); d.spd = V;
		d.clampToMap(true);
		check('...and a single-wall press slides along it, keeping every unit of its speed',
			d.spd === V && Math.abs(Math.cos(d.head)) < 1e-9 && Math.sign(Math.sin(d.head)) === sy,
			(d.head * 180 / Math.PI).toFixed(1) + ' deg at ' + d.spd.toFixed(2));
	}

	// ---- WP4.5.12/13/14/16: a pursuit ends, the drone goes home NOW and keeps going home ---------
	// The user's requirement stated directly, and the assertion this whole group is judged on: the
	// moment a chase drops the drone turns for its orbit on that very tick and flies straight back,
	// lingering nowhere and specifically not at the arena edge. Bait a whole 4team base out to the
	// OOB corner, take the bait away, and hold every drone to (a) strictly closing on its ring from
	// the FIRST tick after the drop and every tick after, (b) never holding a byte-identical
	// position for two consecutive ticks, (c) on its ring inside 250 ticks. Measured before the
	// fixes: (a) failed on tick 0 and kept failing for ~25 ticks, (b) 14 consecutive frozen ticks,
	// (c) worst case 268. None of the three passes with only part of the group applied.
	{
		const room = makeRoom('4team');
		const bait = player(room, 0);
		const centre = room.droneCentres.find((c) => c.posts[0].team !== bait.team);
		const post = centre.posts[0];
		bait.shield = 0; bait.dev.ghost = 0;
		// The bait exists to be chased, not to fight: twelve drones in contact for 400 ticks would
		// grind themselves to death on its body damage and confound "did it come home" with "is it
		// still alive". Player.damage is set once in the constructor, so this sticks.
		bait.damage = 0;
		const bx = Math.sign(post.x) * (room.map.width / 2 + config.OOB_MARGIN);
		const by = Math.sign(post.y) * (room.map.height / 2 + config.OOB_MARGIN);
		const hold = () => { bait.x = bx; bait.y = by; bait.hp = bait.maxHp = 1e9; };
		for (let t = 0; t < 400; t++) { hold(); room.step(); }
		hold();
		const drones = centre.posts.map((p) => room.INSTANCE.bullets.get(p.slot));
		check('a bait at the arena corner pulls the whole base out',
			drones.every((d) => d && d.chasing),
			drones.filter((d) => d && d.chasing).length + ' of ' + drones.length + ' chasing');

		// Bait gone. The map centre is 6500+ units from a 4team base centre, well past
		// BASE_DRONE_LEASH, so every chase drops on the very next tick.
		bait.x = 0; bait.y = 0;
		const errOf = (d) => Math.abs(Math.hypot(d.x - d.ox, d.y - d.oy) - d.orbRTarget);
		const state = drones.map((d) => ({
			d, settled: -1, run: 0, worstRun: 0, grewOn: -1,
			err: errOf(d), level: d.level, px: d.x, py: d.y
		}));
		for (let t = 0; t < 250; t++) {
			room.step();
			for (const s of state) {
				if (s.settled >= 0) { continue; }
				const d = s.d, err = errOf(d);
				// A reactive level switch (a shape clipped, or another returning drone too close, on
				// the way home) moves the target ring out from under us - a legitimate one-tick jump
				// in the error, not a failure to return.
				if (err > s.err + 1e-9 && d.level === s.level && s.grewOn < 0) { s.grewOn = t; }
				if (d.x === s.px && d.y === s.py) { s.run++; s.worstRun = Math.max(s.worstRun, s.run); }
				else { s.run = 0; }
				s.err = err; s.level = d.level; s.px = d.x; s.py = d.y;
				if (err <= config.BASE_DRONE_LEVEL_GAP) { s.settled = t; }
			}
		}
		const worstSettle = Math.max(...state.map((s) => (s.settled < 0 ? 1e9 : s.settled)));
		const worstRun = Math.max(...state.map((s) => s.worstRun));
		const grew = state.filter((s) => s.grewOn >= 0);
		check('every drone closes on its ring from the FIRST tick after its chase drops',
			grew.length === 0,
			grew.length + ' of ' + state.length + ' moved away, earliest on tick ' +
			Math.min(...grew.map((s) => s.grewOn)));
		check('...and none of them ever freezes in place on the way home', worstRun <= 1,
			worstRun + ' consecutive identical-position ticks');
		check('...and every one is back on its ring within 250 ticks', worstSettle < 250, worstSettle);
	}

	// ---- WP4.5.14: a diameter cross only ever launches from the drone's own ring -----------------
	// planCross() takes the entry seam from the centripetal acceleration of the circle the drone is
	// ACTUALLY flying, which is meaningless for one sprinting radially home off a chase - measured,
	// crosses launching from r=1300 against a 168-280 level table.
	{
		const room = makeRoom('4team');
		const post = room.dronePosts.find((p) => p.level === config.BASE_DRONE_LEVEL_HOME);
		const d = room.INSTANCE.bullets.get(post.slot);
		d.chasing = false; d.crossing = false; d.switching = false;
		d.x = d.ox + d.orbRTarget * 6; d.y = d.oy;   // far off-ring, as a long return is
		d.crossIn = 1;                               // ...and due a cross this very tick
		d.update();
		check('a cross does not fire from far off the ring - it waits until the drone is home',
			!d.crossing, 'r = ' + Math.hypot(d.x - d.ox, d.y - d.oy).toFixed(0) +
			', ring = ' + d.orbRTarget);
		// The deferral is not a cancellation: crossIn keeps counting down (negative) and the cross
		// fires the moment the drone is back on its ring, exactly the way a blocked crossCap lane
		// already keeps its place in the queue.
		let firedAt = -1;
		for (let i = 0; i < 400 && firedAt < 0; i++) {
			d.update();
			if (d.crossing) { firedAt = i; }
		}
		check('...but it is only deferred - the cross fires once the drone is back on its ring',
			firedAt >= 0, firedAt);
	}

	// ---- WP4.5.17: polygon bosses are ignored until they start it --------------------------------
	// basedrones.txt: base drones defend against the Fallen bosses on sight but "usually don't
	// target Polygon-based Bosses, such as the Guardian, the Summoner, and the Defender, unless
	// those provoke them first via body damage or drone damage". Our only boss is the Summoner.
	{
		const room = makeRoom('4team');
		if (!room.bosses.length) { room.createBoss(); }
		const boss = room.bosses[0];
		const centre = room.droneCentres.find((c) => c.posts[0].team === 0);
		const post = centre.posts[0];
		// Parked inside BASE_DRONE_DETECT but outside the base square itself, the same offset the
		// scout test uses - inside the square the base fence would kill it outright each tick, which
		// is a separate pre-existing rule and would confound "was it ignored" with "did it survive".
		// Its gun is stubbed out so nothing it fires can provoke the base by accident: the point of
		// the test is that mere PRESENCE is not provocation. Its motion() is left alone - the
		// Summoner's own AI is what populates `detected`, which its update() reads - and its
		// position is re-pinned every tick instead.
		boss.shoot = function () { };
		const bossHold = () => { boss.x = post.x + room.baseSize * 0.75; boss.y = post.y; };
		const budget = centre.posts.length * config.BASE_DRONE_SCAN + 40;
		let chasedUnprovoked = false;
		for (let t = 0; t < budget; t++) {
			bossHold();
			room.step();
			if (centre.posts.some((p) => {
				const d = room.INSTANCE.bullets.get(p.slot);
				return d && d.chasing;
			})) { chasedUnprovoked = true; }
		}
		check('a polygon boss sitting in detect range is not a threat - the base ignores it',
			!chasedUnprovoked && centre.levels.threat === null && !centre.levels.provoked,
			'threat ' + (centre.levels.threat ? 'set' : 'null') + ', chased ' + chasedUnprovoked);

		// Body damage is provocation (the wiki's own wording), recorded on the shared per-centre
		// ledger so the WHOLE base engages, not just the drone that got hit.
		const hit = room.INSTANCE.bullets.get(post.slot);
		hit.collision(boss, {});
		check('...until it hits a drone, which provokes the whole centre, not just that drone',
			centre.levels.provoked === boss.id.oId, centre.levels.provoked + ' vs ' + boss.id.oId);
		let chasedAt = -1;
		for (let t = 0; t < budget && chasedAt < 0; t++) {
			bossHold();
			room.step();
			if (centre.posts.some((p) => {
				const d = room.INSTANCE.bullets.get(p.slot);
				return d && d.chasing;
			})) { chasedAt = t; }
		}
		check('...and then the base does engage it', chasedAt >= 0, chasedAt);

		// The anger is a memory, not a permanent grudge - a boss that wanders off and stops hitting
		// anything goes back to being ignored.
		centre.levels.provokedAt = room.timestamp - tick.ticks(config.BASE_DRONE_PROVOKE_MEMORY) - 1;
		room.tickDroneCentres();
		check('...and forgets again once BASE_DRONE_PROVOKE_MEMORY has passed with no new damage',
			centre.levels.provoked === 0, centre.levels.provoked);
	}
}

/*
	Tick-scale invariance (massplanchunks WP3): TICK_MS is the server's actual step rate,
	REF_TICK_MS is what public/SHARE/Physics.js's accel/friction are denominated against, and
	lib/tick.js's SCALE = TICK_MS/REF_TICK_MS converts between them. If that conversion (and the
	one-time rescale baked into Physics.js's own constants) is right, the real-world top speed
	must come out the same regardless of which TICK_MS the server actually steps at - this drives
	Physics.stepBody directly at a few different assumed rates and checks they agree, and that
	they still match diep's own derived base top speed.

	THE AGREEMENT BAND IS 3%, NOT THE 2% IT WAS, AND THAT IS ARITHMETIC RATHER THAN SLACK. The
	steady state of `v <- (v + A*d)*F^d; x += v*d` is 25*A*d*F^d/(1-F^d) u/s, which is exact only
	at d = 1 and drifts toward the continuum limit -25*A/ln(F) as d -> 0. The size of that drift is
	set by how much drag one step applies, so it necessarily widened when plan.md step 2 took
	FRICTION from 0.956532 to 10/11:

	                        16ms     25ms     33ms     40ms(=ref)   d->0     16 vs 33
	    F 0.956532         285.4    284.0    282.7    281.6        288.0      0.95%
	    F 10/11            372.9    368.9    365.3    362.2        380.1      2.07%

	This is ordinary Euler discretization of the drag term, not a defect and not something the
	tank/body friction split can reach - nothing below reads lib/constants.js at all. 3% still
	fails a regression of the magnitude this test was built to catch (PENDING #24's ~3x runaway).
*/
function tickScaleTests() {
	console.log('\ntick-scale invariance (massplanchunks WP3):');
	const Physics = require(path.join(ROOT, 'public', 'SHARE', 'Physics.js'));
	const REF_TICK_MS = require(path.join(ROOT, 'lib', 'config.js')).config.REF_TICK_MS;

	// Steady-state speed (u/s) driving Physics.stepBody directly at dtTicks = assumedTickMs /
	// REF_TICK_MS, as if the server stepped every assumedTickMs - a 5s warmup to clear the
	// accel/friction transient, then measured over the next 500ms.
	function steadySpeed(assumedTickMs) {
		const d = assumedTickMs / REF_TICK_MS;
		const accel = Physics.moveAccel(0, 0);
		let vx = 0;
		const warmupSteps = Math.round(5000 / assumedTickMs);
		for (let i = 0; i < warmupSteps; i++) {
			const body = { x: 0, y: 0, vx, vy: 0 };
			Physics.stepBody(body, accel, 0, d);
			vx = body.vx;
		}
		const measureSteps = Math.round(500 / assumedTickMs);
		let dist = 0;
		for (let i = 0; i < measureSteps; i++) {
			const body = { x: 0, y: 0, vx, vy: 0 };
			Physics.stepBody(body, accel, 0, d);
			vx = body.vx; dist += body.x;
		}
		return dist / (measureSteps * assumedTickMs / 1000);
	}

	const at25 = steadySpeed(25);   // today's actual TICK_MS
	const at33 = steadySpeed(33);   // the old TICK_MS, hypothetically
	const at16 = steadySpeed(16);   // a much finer step, for good measure
	const near = (a, b, pct) => Math.abs(a - b) / b < pct;

	check('top speed at TICK_MS 25 and 33 agree within 3%', near(at25, at33, 0.03),
		at25.toFixed(1) + ' vs ' + at33.toFixed(1) + ' u/s');
	check('...and TICK_MS 16 agrees too - not just two lucky points', near(at16, at33, 0.03),
		at16.toFixed(1) + ' vs ' + at33.toFixed(1) + ' u/s');

	// Not a magic number: diep's V_max = 10 x A stated against our own MOVE_ACCEL_BASE, so this
	// re-derives the pin rather than restating it and moves by itself if either constant is edited.
	// 10 * 1.449 = 14.49 units per 40ms reference tick = 362.25 u/s, which is diep's 12.94 gu/s at
	// 28 units/gu. The live TICK_MS reads 1.8% over it for the discretization reason above, hence
	// the 2% here - it is a pin on the CONSTANTS, checked through the integrator.
	const derived = 10 * Physics.MOVE_ACCEL_BASE * (1000 / REF_TICK_MS);
	check("...and it still matches diep's derived base top speed (10 x A, 362.25 u/s)",
		near(at25, derived, 0.02), at25.toFixed(1) + ' vs ' + derived.toFixed(2));

	reloadInvarianceTest(near);
	bulletRangeInvarianceTest(near);
	autoTurretLeadInvarianceTest(near);
	regenInvarianceTest(near);
}

/*
	Drives entities/Player.js and entities/Bullet.js themselves (not just Physics.js) at a
	patched config.TICK_MS, so every module-scope tick.*() constant they compute at require()
	time - AUTOTURRET_LEAD, REAIM_CHANCE, tick.DES, the drag-precomputed FRICTION, all of it - is
	rebuilt for the rate under test, the way massplanchunks.md asks for. No runtime setter: the
	module cache is cleared and restored around the call, same idea as how the movement case
	above hands Physics.stepBody a freshly computed dtTicks rather than mutating a shared one.
*/
function withTickMs(assumedTickMs, fn) {
	const configPath = require.resolve(path.join(ROOT, 'lib', 'config.js'));
	const tickPath = require.resolve(path.join(ROOT, 'lib', 'tick.js'));
	const playerPath = require.resolve(path.join(ROOT, 'entities', 'Player.js'));
	const bulletPath = require.resolve(path.join(ROOT, 'entities', 'Bullet.js'));
	const config = require(configPath).config;
	const original = config.TICK_MS;
	config.TICK_MS = assumedTickMs;
	[tickPath, playerPath, bulletPath].forEach((p) => delete require.cache[p]);
	try {
		const tick = require(tickPath);
		const Player = require(playerPath);
		const Bullet = require(bulletPath);
		return fn({ tick, Player, Bullet });
	} finally {
		config.TICK_MS = original;
		[tickPath, playerPath, bulletPath].forEach((p) => delete require.cache[p]);
	}
}

/* A room stand-in with just enough surface for a standalone Player/Bullet: a map to clamp
	 against and a createBullet() that does nothing (or counts), never a real SlotMap. */
function fakeRoom() {
	return { map: { width: 1e6, height: 1e6 }, createBullet() { } };
}

/*
	Reload (massplanchunks WP-D pass 4, item 1): hold the trigger on a fresh Basic for 2
	wall-clock seconds at each rate and count bullets actually created - should agree within one
	shot, same tolerance the plan calls for, since a reload boundary can land on either side of
	the window at any tick rate.
*/
function reloadInvarianceTest() {
	function shotsIn(tickMs, wallMs) {
		return withTickMs(tickMs, ({ Player }) => {
			const room = fakeRoom();
			let shots = 0;
			room.createBullet = () => { shots++; };
			const p = new Player({ oId: 0 }, 0, 0, 'x', 1, [0, 1e9], room);
			p.inputs.mouseL = 1;
			const steps = Math.round(wallMs / tickMs);
			for (let i = 0; i < steps; i++) { p.shoot(); }
			return shots;
		});
	}
	const s16 = shotsIn(16, 2000), s25 = shotsIn(25, 2000), s33 = shotsIn(33, 2000);
	check('reload: shots in 2s agree within one shot at TICK_MS 16/25/33',
		Math.abs(s25 - s33) <= 1 && Math.abs(s16 - s33) <= 1,
		s16 + ' / ' + s25 + ' / ' + s33);
}

/*
	Bullet range (massplanchunks WP-D pass 4, item 2): spawn a lone (alone=1, so it never looks
	for an owning Player) Basic-speed bullet and step it until life runs out, at each rate.

	This is the one the audit actually found broken rather than just extended to check, and it is
	now fixed. entities/Bullet.js's motion tail adds a thrust to this.vec every tick and then
	integrates this.vec into position, i.e. twice over ticks - so the thrust belongs to
	lib/tick.js's quadratic() category, not perTick(). Under perTick() the range came out roughly
	proportional to 1/TICK_MS (1695 / 1175 / 955 units at TICK_MS 16 / 25 / 33 for this class,
	whose lifetime is itself correctly wall-clock-constant); under quadratic() it holds flat, and
	the whole `speed` column was multiplied by the same 1.6 so the value at the live TICK_MS -
	that middle 1175 - is exactly where it was. 0.48 below is the test's own 0.3 through that same
	rescale, so the number this asserts is comparable with the pre-fix reading above.

	1% rather than the movement case's 2%: a bullet's `life` is quantised to whole ticks
	(tick.ticks()), so the three rates round to wall-clock lifetimes 0.35% apart and the ranges
	inherit that. Anything looser would not notice the bug coming back at, say, TICK_MS 20.
*/
function bulletRangeInvarianceTest(near) {
	function rangeAt(tickMs) {
		return withTickMs(tickMs, ({ Bullet }) => {
			const b = new Bullet({ oId: -1 }, 0, 0, 0, 0.48, 40, fakeRoom());
			b.alone = 1;   // no owning Player to look up - see TwoTeam/FourTeam's guard drones
			let guard = 0;
			while (b.destroy === 0 && guard++ < 1e6) { b.update(); }
			return Math.hypot(b.x, b.y);
		});
	}
	const r16 = rangeAt(16), r25 = rangeAt(25), r33 = rangeAt(33);
	console.log('  note bullet range at TICK_MS 16/25/33: ' + r16.toFixed(1) + ' / ' + r25.toFixed(1) +
		' / ' + r33.toFixed(1) + ' units');
	check('bullet range at TICK_MS 16/25/33 agrees within 1%',
		near(r16, r33, 0.01) && near(r25, r33, 0.01),
		r16.toFixed(1) + ' / ' + r25.toFixed(1) + ' / ' + r33.toFixed(1));
	// The pre-fix reading at the live rate, which the speed rescale was solved to preserve: this
	// is what stops the fix from being a silent balance change.
	check('...and still matches the range this game was tuned for at TICK_MS 25 (~1175 units)',
		near(r25, 1174.7, 0.01), r25.toFixed(1));
}

/*
	Auto-turret aim lead: the second, narrower half of the same finding. shoot()'s aim point is
	`other.vec * dis / AUTOTURRET_LEAD`, and both other factors are already TICK_MS-invariant, so
	a tick.lead()-converted divisor was the thing making the offset move with the tick rate -
	the opposite direction from the bullet-thrust bug above. Driven here through the real
	entities/Player.js constant rather than a copy of the formula, so re-wrapping it in tick.lead()
	fails this.
*/
function autoTurretLeadInvarianceTest(near) {
	function offsetAt(tickMs) {
		return withTickMs(tickMs, ({ Player }) => {
			// A target 400 units away moving at a fixed real-world speed; its per-tick vec is what
			// scales with the rate, which is exactly what the divisor has to absorb.
			const room = fakeRoom();
			const p = new Player({ oId: 0 }, 0, 0, 'x', 1, [0, 1e9], room);
			p.inputs.w = 1;
			for (let i = 0; i < Math.round(5000 / tickMs); i++) { p.motion(); }   // reach top speed
			return Math.hypot(p.vec.x, p.vec.y) * 400 / Player.AUTOTURRET_LEAD;
		});
	}
	const o16 = offsetAt(16), o25 = offsetAt(25), o33 = offsetAt(33);
	check('auto-turret aim lead at TICK_MS 16/25/33 agrees within 3%',
		near(o16, o33, 0.03) && near(o25, o33, 0.03),
		o16.toFixed(1) + ' / ' + o25.toFixed(1) + ' / ' + o33.toFixed(1) + ' units of lead');
}

/*
	Regen (massplanchunks WP-D pass 4, item 3): the one meant to catch a quadratic accumulator
	misfiled as a perTick one. entities/Player.js's hpregan[1] += tick.quadratic(...) is exactly
	that shape and, checked directly (below), is correctly invariant.

	This deliberately does not read Player.hp the way massplanchunks.md's checklist first
	suggests: entities/Player.js:477's hp += parseInt(hpregan[1]*maxHp*10)/10 quantizes healing to
	0.1 HP (PENDING.md item 17's already-documented "nothing heals for the first ~22s" quirk), and
	that quantization's own error is the same order of magnitude as the 2% this test wants to
	prove, for reasons that have nothing to do with tick-scale conversion - it would make this
	test flaky (and occasionally fail) regardless of whether the conversion is right. So this
	mirrors the accumulator update from Player.js's own update() exactly, using a fresh Player's
	real up.HpRegan/maxHp and a freshly-required tick.js, summed *without* that rounding, which is
	precisely the quantity tick.quadratic() is responsible for keeping invariant.
*/
function regenInvarianceTest() {
	function healedIn(tickMs, wallMs) {
		return withTickMs(tickMs, ({ Player, tick }) => {
			const p = new Player({ oId: 0 }, 0, 0, 'x', 1, [0, 1e9], fakeRoom());
			p.update();   // let the level-0-at-xp-0 join quirk (see fovTests) resolve first
			p.hp = p.maxHp / 2;
			p.hpregan = [p.hp, 0];
			let healed = 0;
			const steps = Math.round(wallMs / tickMs);
			for (let i = 0; i < steps; i++) {
				p.hpregan[1] += tick.quadratic(p.up.HpRegan / 673818.75);
				healed += p.hpregan[1] * p.maxHp;
			}
			return healed;
		});
	}
	const h16 = healedIn(16, 10000), h25 = healedIn(25, 10000), h33 = healedIn(33, 10000);
	const near = (a, b, pct) => Math.abs(a - b) / b < pct;
	check('regen accumulator over 10s agrees within 2% at TICK_MS 16/25/33',
		near(h16, h33, 0.02) && near(h25, h33, 0.02),
		h16.toFixed(3) + ' / ' + h25.toFixed(3) + ' / ' + h33.toFixed(3));
}

/*
	FOV (massplanchunks WP4): entities/Player.js's screen formula reads config.FOV_MUL and
	config.FOV_PER_LEVEL directly, so this pins the formula's shape (multiplicative per level, not
	the old flat +22/level) rather than duplicating PENDING.md item 19's derivation.
*/
function fovTests(rooms) {
	console.log('\nfield of view (massplanchunks WP4):');
	const config = require(path.join(ROOT, 'lib', 'config.js')).config;
	const CLASS = require(path.join(ROOT, 'public', 'SHARE', 'TanksConfig.js')).class;
	const room = rooms[0];
	const me = player(room, 0);
	// xp 0 >= XPLVL[0] (0) levels a fresh tank up on its very first update() - a pre-existing
	// quirk, not this test's concern - so the expected screen is computed off me.level as it
	// actually comes out, not the level assigned going in.
	me.level = 0;
	me.update();
	const base = me.extraView + CLASS[me.class].screen * config.FOV_MUL * Math.pow(config.FOV_PER_LEVEL, me.level);
	check('screen matches extraView + screen*FOV_MUL*FOV_PER_LEVEL^level', me.screen === base,
		me.screen + ' vs ' + base);
	me.level = 30;
	me.update();
	const grown = me.extraView + CLASS[me.class].screen * config.FOV_MUL * Math.pow(config.FOV_PER_LEVEL, me.level);
	check('level 30 screen grows multiplicatively, not by a flat +22/level', me.screen === grown,
		me.screen + ' vs ' + grown);
	check('...and it is wider than the low-level screen (FOV_PER_LEVEL > 1)', me.screen > base,
		me.screen + ' > ' + base);
}

/*
	Out-of-bounds (massplanchunks WP5): the real wall sits config.OOB_MARGIN past the drawn map
	edge, a hard stop with no spring - measured against real diep.io, not a placeholder.
*/
/*
	The unit anchor (plan.md WP1/WP5). 1 grid square = 1 diep grid unit (gu) = 28 world units, and
	the whole point of public/SHARE/World.js is that the server and the client read that ONE number
	- a client drawing a 20-unit grid over a 28-unit world is exactly the mismatch PENDING #13 was.
	Every Category-A distance below is asserted as an exact gu() multiple rather than as the literal
	it happens to evaluate to today, so a future re-pitch moves them all together or fails here.
*/
function gridAnchorTests() {
	console.log('\nthe grid anchor (plan.md WP1):');
	const World = require(path.join(ROOT, 'public', 'SHARE', 'World.js'));
	const config = require(path.join(ROOT, 'lib', 'config.js')).config;

	check('one grid square is 28 world units', World.GU === 28, World.GU);
	check('gu(n) is n of them', World.gu(1) === World.GU && World.gu(5) === 5 * World.GU,
		World.gu(1) + '/' + World.gu(5));
	// The client has no bundler and no require(): World.js is a plain <script> that assigns onto
	// the same `exports`-or-global shim every other public/SHARE module uses, so "server and client
	// read the same GU" is provable by reading the file the browser is actually served.
	const src = fs.readFileSync(path.join(ROOT, 'public', 'SHARE', 'World.js'), 'utf8');
	const literals = (src.match(/28/g) || []).length;
	check('the served module is the same source the server require()s - one pitch, one file',
		literals > 0 && src.indexOf('exports.GU') >= 0, literals + ' occurrences of the pitch');
	// A level-0 tank is 2.0 gu across, which is the anchor 28 was derived from (diep's own
	// Z = 2 x 1.01^(lvl-1) gu). Drawn diameter is 2*size, not 2*size + LINEWIDTH - the linewidth
	// half is a client-side stroke, see public/client/drawings.js.
	check('a level-0 tank is 2 grid squares across', Math.abs(2 * 28 - World.gu(2)) < 1e-9);

	// Category-A map/base sizes, exact (plan.md WP1.3/WP2): every arena keeps the square count it
	// had before the rescale, so these are square counts, not unit counts.
	// The WP1.3 table, in squares: every arena kept the square count it had at the old 20-unit pitch
	// and grew x1.4 in world units with it, which is what D1 decided. Sandbox and boss ride the same
	// gu() helper; only the four modes with their own tuned figure are pinned here.
	const squares = { ffa: 451, '4team': 450, '2team': 400, boss: 350 };
	for (const gm in squares) {
		const r = makeRoom(gm);
		check(gm + '\'s map is gu(' + squares[gm] + ') square',
			r.map.width === World.gu(squares[gm]) && r.map.height === World.gu(squares[gm]),
			r.map.width + 'x' + r.map.height + ' vs ' + World.gu(squares[gm]));
	}
	const two = makeRoom('2team'), four = makeRoom('4team'), ffa = makeRoom('ffa');
	check('2team\'s base strip is exactly gu(40) wide - the measured diep figure',
		two.baseSize === World.gu(40), two.baseSize + ' vs ' + World.gu(40));
	check('4team\'s base square is exactly gu(67) on a side - the measured diep figure',
		four.baseSize === World.gu(67), four.baseSize + ' vs ' + World.gu(67));
	check('ffa has no base to size', !ffa.baseSize || ffa.dronePosts.length === 0,
		ffa.dronePosts.length + ' drone posts');

	// The two follow-on constants PENDING #13 named, both re-derived against the 28-unit pitch
	// rather than left at their 20-unit-era literals.
	check('BASE_BULLET_MARGIN is gu(1.5)', config.BASE_BULLET_MARGIN === World.gu(1.5),
		config.BASE_BULLET_MARGIN + ' vs ' + World.gu(1.5));
	check('BASE_DRONE_LEVEL_GAP is gu(1) - one grid square, one drone-side',
		config.BASE_DRONE_LEVEL_GAP === World.gu(1), config.BASE_DRONE_LEVEL_GAP);
	check('BASE_DRONE_ORBIT_R is gu(8)', config.BASE_DRONE_ORBIT_R === World.gu(8),
		config.BASE_DRONE_ORBIT_R);
	check('BASE_DRONE_DETECT/LEASH are gu(60)/gu(90)',
		config.BASE_DRONE_DETECT === World.gu(60) && config.BASE_DRONE_LEASH === World.gu(90),
		config.BASE_DRONE_DETECT + '/' + config.BASE_DRONE_LEASH);
}

function oobTests(rooms) {
	console.log('\nout-of-bounds (massplanchunks WP5):');
	const config = require(path.join(ROOT, 'lib', 'config.js')).config;
	const gu = require(path.join(ROOT, 'public', 'SHARE', 'World.js')).gu;
	const room = rooms[0];
	const me = player(room, 0);

	// The user's actual requirement (plan.md WP1): a level-0 tank's outer edge stops <= 5 grid
	// squares past the drawn map edge. Nothing else pins this identity directly. fovTests (just
	// above) leaves this same player at level 30, so force it back to level 0 for its base size.
	// xp must go under XPLVL[0] (0) too: update() levels up before it sizes the tank, and size is
	// exponential in level now (PENDING #22), so a stray level costs this identity 1%.
	me.level = 0;
	const savedXp = me.xp;
	me.xp = -1;
	me.update();
	check('OOB_MARGIN + tank size == gu(5)', config.OOB_MARGIN + me.size === gu(5),
		config.OOB_MARGIN + ' + ' + me.size + ' vs ' + gu(5));

	me.x = room.map.width / 2 + config.OOB_MARGIN / 2;
	me.vec.x = 5;
	me.motion();
	check('a player short of the true wall is not clamped', me.x > room.map.width / 2,
		me.x + ' vs edge ' + (room.map.width / 2));

	me.x = room.map.width / 2 + config.OOB_MARGIN + 500;
	me.vec.x = 5;
	me.motion();
	check('the true wall sits exactly OOB_MARGIN past the drawn edge',
		me.x === room.map.width / 2 + config.OOB_MARGIN,
		me.x + ' vs ' + (room.map.width / 2 + config.OOB_MARGIN));
	check('it is a hard stop - velocity zeroes on hit, no push-back', me.vec.x === 0, me.vec.x);

	me.x = 0; me.y = 0; me.vec.x = 0; me.vec.y = 0;
	me.xp = savedXp;
}

/*
	Tank growth (PENDING #22). diep fixes a tank at Z = 2 x 1.01^(lvl-1) gu DIAMETER on 1-based
	levels; ours are 0-based and `size` is a radius, so at 1 gu = 28 units the same curve is
	28 x 1.01^level. The linear stand-in this replaced agreed at both endpoints - which is why it
	survived this long - but stepped in whole units every 2.8 levels in between, so the assertion
	that matters is monotonicity per level, not the endpoints.
*/
function growthTests(rooms) {
	console.log('\ntank growth (PENDING #22):');
	const gu = require(path.join(ROOT, 'public', 'SHARE', 'World.js')).gu;
	const room = rooms[0];
	const me = player(room, 0);
	const saved = { level: me.level, xp: me.xp, size: me.size };
	me.xp = -1;   // update() levels up before it sizes; hold the level being tested

	const sizes = [];
	for (let lvl = 0; lvl <= 30; lvl++) {
		me.level = lvl;
		me.update();
		sizes.push(me.size);
	}

	check('a level-0 tank is exactly gu(1) in radius - the anchor 28 came from',
		sizes[0] === gu(1), sizes[0] + ' vs ' + gu(1));
	check('size is 28 x 1.01^level at every level, not floor(level/2.8)',
		sizes.every((s, lvl) => Math.abs(s - 28 * Math.pow(1.01, lvl)) < 1e-9), sizes[14]);
	check('growth is strictly monotonic - every level is bigger than the one below it',
		sizes.every((s, i) => i === 0 || s > sizes[i - 1]));
	// The old linear curve's own endpoints, which diep's exponential still has to land on.
	check('level 30 is ~1.35x a fresh spawn, the endpoint the linear version agreed with',
		Math.abs(sizes[30] / sizes[0] - Math.pow(1.01, 30)) < 1e-9 &&
		Math.abs(sizes[30] - 38) < 0.5, sizes[30]);
	// dev.size is an admin offset, so it has to stay additive on top of the curve, not inside it.
	me.dev.size = 10;
	me.level = 0;
	me.update();
	check('the admin size offset still adds on top of the curve', me.size === gu(1) + 10, me.size);
	me.dev.size = 0;

	me.level = saved.level; me.xp = saved.xp; me.update(); me.size = saved.size;
}

/*
	The `c` auto-spin. It has to start from wherever the barrel is actually pointing and turn from
	there - it used to assign a counter that had been free-running since spawn, so engaging it
	teleported the barrel to that counter's current phase before spinning. `autoDir` still exists
	and still free-runs: it is the auto-turret idle spin and the drone orbit phase, which nothing
	about this toggle should reach into.
*/
function autoSpinTests(rooms) {
	console.log('\nthe `c` auto-spin:');
	const room = rooms[0];
	const me = player(room, 0);
	const saved = { dir: me.dir, c: me.inputs.c, spinning: me.spinning, autoDir: me.autoDir };

	// Measured off the player's own idle auto-turret spin rather than a copy of SPIN_RATE pasted
	// in here - PENDING #21 retunes that constant, and a duplicated literal would silently go
	// stale (as it already had) instead of catching the one thing this file actually needs to
	// guarantee: both spins share one rate, whatever it is.
	me.inputs.c = 0; me.spinning = 0;
	const autoDirBefore = me.autoDir;
	me.update();
	const step = me.autoDir - autoDirBefore;

	me.autoDir = 3;   // deliberately nowhere near the barrel, which is the old bug's symptom
	me.dir = 1.234;
	me.inputs.c = 1;
	me.update();
	check('the spin starts from the barrel, not from the free-running counter',
		Math.abs(me.dir - (1.234 + step)) < 1e-9, me.dir);
	const first = me.dir;
	me.update();
	check('...and turns at the same rate the auto-turret idles at',
		Math.abs(me.dir - (first + step)) < 1e-9, me.dir - first);

	me.inputs.c = 0;
	me.update();
	const parked = me.dir;
	me.update();
	check('releasing leaves the tank where the spin left it', me.dir === parked, me.dir);

	me.dir = -2.5;
	me.inputs.c = 1;
	me.update();
	check('re-engaging picks up the new facing, not where the last spin ended',
		Math.abs(me.dir - (-2.5 + step)) < 1e-9, me.dir);

	/*
		The wire half, and the one a human actually saw: net/gameSocket.js's keydown handler
		toggles `inputs.c` the INSTANT the packet lands, but `spinning`/`spinDir` are only
		established on the next room tick - and the send loop is not tied to the room simulation
		(net/gameSocket.js's header says so outright). getBuffer()'s RAW.main is the live Player,
		so an encode landing in that window used to read `inputs.c === 1` alongside a `spinDir`
		still holding the PREVIOUS spin's end angle, and shipped it as the authoritative aim.
		The client draws that field verbatim (User.realDir when User.followDir), so the barrel
		snapped to the old spin's end for a frame before the next tick re-seeded it from the live
		aim - "press c, it flicks to where the last spin stopped, then jumps back and spins".
		Both fields are gated on `spinning` now, which is assigned in the same tick as spinDir.
	*/
	me.inputs.c = 0; me.spinning = 0;
	room.step();

	const B = 2.7, A = -1.1;
	me.spinDir = B;          // a stale phase left behind by an earlier spin
	me.dir = A;              // ...and the live aim a mousemove has since set
	me.inputs.c = 1;         // the keydown packet lands - but NO tick has run yet

	const raced = room.getBuffer(0);
	check('an encode between the c keydown and the next tick does not ship the stale spin phase',
		raced.main.dir === A, raced.main.dir);
	check('...and does not claim the spin has started before the tick that starts it',
		raced.main.states[1] === 0, raced.main.states[1]);

	// After the tick, the spin owns the wire fields for real.
	room.step();
	const spun = room.getBuffer(0);
	check('...but once the tick has run, the spin does own the wire dir',
		spun.main.states[1] === 1 && spun.main.dir === me.spinDir, spun.main.dir);
	check('...seeded from the live aim, not the stale phase',
		Math.abs(spun.main.dir - (A + step)) < 1e-9, spun.main.dir);

	me.inputs.c = saved.c; me.spinning = saved.spinning; me.dir = saved.dir; me.autoDir = saved.autoDir;
}

/*
	Max Health's own heal (PENDING #17). A point adds its step to maxHp and heals current hp by the
	same proportion, so the health FRACTION survives the upgrade. It used to scale by
	maxHp/(maxHp - 100) *after* the += 110 - a stale 100 against a 110 step - so every point
	silently under-healed. Pinned as a ratio, not against a literal, so a retune of the step keeps
	the property - which is exactly what PENDING #30 did to it: the step is 110 x 6/7 now, so a
	FULL bar is still worth +660 while the per-point figure is not a round number any more.
*/
function healthUpgradeTests(rooms) {
	console.log('\nMax Health upgrade (PENDING #17):');
	const room = rooms[0];
	const me = player(room, 0);
	const P = require(path.join(ROOT, 'entities', 'Player.js'));
	const saved = { hp: me.hp, maxHp: me.maxHp, level: me.level, stillLvl: me.stillLvl, upNb: me.upNb.slice() };
	const HP_UP = 6;   // entities/Player.js's `up` key order
	// A level with at least a full bar's worth of points granted (PENDING #30's schedule).
	let lvl = P.LEVEL_CAP;
	for (let l = 1; l <= P.LEVEL_CAP; l++) { if (P.pointsAtLevel(l) >= P.MAX_PER_STAT) { lvl = l; break; } }

	me.level = lvl; me.stillLvl = 0; me.upNb = [0, 0, 0, 0, 0, 0, 0, 0];
	me.maxHp = 150; me.hp = 75;
	me.upgrade(HP_UP);
	const step = me.maxHp - 150;
	check('one point adds a 6/7-scaled step to maxHp', Math.abs(step - 660 / P.MAX_PER_STAT) < 0.01, step);
	check('...and heals current hp by that same proportion',
		Math.abs(me.hp - 75 * (me.maxHp / 150)) < 1e-9, me.hp);
	check('...so a tank on half health is still on half health afterwards',
		Math.abs(me.hp / me.maxHp - 0.5) < 0.005, me.hp / me.maxHp);

	me.stillLvl = 0; me.upNb = [0, 0, 0, 0, 0, 0, 0, 0];
	me.maxHp = 150; me.hp = 150;
	for (let i = 0; i < P.MAX_PER_STAT; i++) { me.upgrade(HP_UP); }
	check('a full bar is +660 maxHp, exactly what six points used to buy',
		Math.abs(me.maxHp - 810) < 0.01, me.maxHp);
	check('...and a full-health tank is still at full health, not a bar of under-heals down',
		Math.abs(me.hp - me.maxHp) < 1e-9, me.hp + '/' + me.maxHp);
	// The per-stat cap itself, with points to spare so it is the cap doing the refusing and not
	// the grant schedule running out.
	me.level = P.LEVEL_CAP; me.stillLvl = 0; me.upNb = [0, 0, 0, 0, 0, 0, 0, 0];
	me.maxHp = 150; me.hp = 150;
	for (let i = 0; i < P.MAX_PER_STAT + 3; i++) { me.upgrade(HP_UP); }
	check('one stat cannot be pushed past the per-stat cap even with points banked',
		me.upNb[HP_UP] === P.MAX_PER_STAT && me.stillLvl === P.MAX_PER_STAT,
		me.upNb[HP_UP] + ' spent ' + me.stillLvl);

	me.hp = saved.hp; me.maxHp = saved.maxHp; me.level = saved.level;
	me.stillLvl = saved.stillLvl; me.upNb = saved.upNb;
}

/*
	The upgrade economy (PENDING #30 / plan.md step 1): 45 levels, 7 points per stat, 33 points over
	a life, one class tier every 15 levels.

	Pinned because it is a DOMAIN, not a tunable. Every diep formula this tree adopts is denominated
	against these caps - Physics.js's 1.07^points and 1.015^level, #17's +20 HP/point - so a silent
	drift back to 6/30 would not fail as a wrong number anywhere, it would quietly make every one of
	those formulas mean something neither game intends. The grant schedule is checked at its
	boundaries (the 28/30 rate change and the cap) rather than level by level, and the client's
	hand-mirrored copy is checked against the server's, since PENDING #23 lists that pair as the
	thing most able to desynchronise.
*/
function upgradeEconomyTests(rooms) {
	console.log('\nupgrade economy - 45/7/33 (PENDING #30):');
	const P = require(path.join(ROOT, 'entities', 'Player.js'));
	const room = rooms[0];

	check('the level cap is 45', room.XPLVL.length === 45 && P.LEVEL_CAP === 45, room.XPLVL.length);
	check('...and the last level still lands exactly on the mode\'s maxXp',
		room.XPLVL[room.XPLVL.length - 1] === room.rules.maxXp, room.XPLVL[room.XPLVL.length - 1]);
	check('the per-stat cap is 7', P.MAX_PER_STAT === 7, P.MAX_PER_STAT);

	// The schedule: 1/level to 28, then one at 30 and every third level to 45.
	check('a fresh spawn has no points - a point is granted per level-UP, not per level',
		P.pointsAtLevel(1) === 0, P.pointsAtLevel(1));
	check('level 28 has granted 27 - one per level so far',
		P.pointsAtLevel(28) === 27, P.pointsAtLevel(28));
	check('...29 grants nothing (the rate has changed, and 30 is the next grant)',
		P.pointsAtLevel(29) === 27, P.pointsAtLevel(29));
	check('...30 grants the 28th', P.pointsAtLevel(30) === 28, P.pointsAtLevel(30));
	check('...and 31/32 nothing, 33 the next one',
		P.pointsAtLevel(31) === 28 && P.pointsAtLevel(32) === 28 && P.pointsAtLevel(33) === 29,
		P.pointsAtLevel(31) + '/' + P.pointsAtLevel(32) + '/' + P.pointsAtLevel(33));
	check('the level cap has granted exactly 33 - diep\'s lifetime budget',
		P.pointsAtLevel(P.LEVEL_CAP) === 33, P.pointsAtLevel(P.LEVEL_CAP));
	check('the schedule never goes backwards - no takebacks anywhere on it', (() => {
		for (let l = 2; l <= P.LEVEL_CAP; l++) {
			const d = P.pointsAtLevel(l) - P.pointsAtLevel(l - 1);
			if (d < 0 || d > 1) { return false; }
		}
		return true;
	})());

	// 33 points cover four maxed stats and change, which is the shape of the economy diep has and
	// the reason this conversion is a conversion rather than a fix.
	check('33 points is four maxed stats plus five spare',
		P.pointsAtLevel(P.LEVEL_CAP) === 4 * P.MAX_PER_STAT + 5);

	// The client mirrors both constants by hand (public/client/config.js) - PENDING #23's
	// desynchronisation risk. Read the file rather than the module: it is a browser script.
	const cfg = fs.readFileSync(path.join(ROOT, 'public', 'client', 'config.js'), 'utf8');
	const mirrored = (k) => {
		const m = cfg.match(new RegExp(k + ':\\s*(\\d+)'));
		return m ? parseInt(m[1], 10) : NaN;
	};
	check('the client\'s MAX_UP_POINTS mirrors the server\'s lifetime budget',
		mirrored('MAX_UP_POINTS') === P.pointsAtLevel(P.LEVEL_CAP), mirrored('MAX_UP_POINTS'));
	check('the client\'s MAX_PER_STAT mirrors the server\'s per-stat cap',
		mirrored('MAX_PER_STAT') === P.MAX_PER_STAT, mirrored('MAX_PER_STAT'));

	// The wire's own "points available" counter has to agree with what upgrade() will honour, or
	// the upgrade panel offers a point the server refuses.
	const me = player(room, 0);
	const saved = { level: me.level, stillLvl: me.stillLvl, dead: me.dead };
	me.dead = 0; me.level = 30; me.stillLvl = 4;
	check('getBuffer sends granted-minus-spent, not level-minus-spent',
		room.getBuffer(0).head.still === P.pointsAtLevel(30) - 4, room.getBuffer(0).head.still);
	check('...and the class tier it sends opens every 15 levels', room.getBuffer(0).head.cLvl === 2,
		room.getBuffer(0).head.cLvl);
	me.level = 14;
	check('...so level 14 is still tier 0 - the gates are 15/30/45',
		room.getBuffer(0).head.cLvl === 0, room.getBuffer(0).head.cLvl);
	me.level = saved.level; me.stillLvl = saved.stillLvl; me.dead = saved.dead;
}

/*
	rejectSample() (plan.md WP-SPAWN, PENDING #25): the old spawnPoint()/Objects placement loops
	were `while (1)`, unsatisfiable and thus a sim-thread hang on a small enough map. "Does it
	terminate" can't be asserted directly - a regression would hang the suite instead of failing
	it - so this pins the cap and the fallback with an explicit small `tries`, which can never hang
	regardless of the implementation.
*/
function spawnSamplerTests() {
	console.log('\nspawn sampler (plan.md WP-SPAWN):');
	const room = rooms[0];   // ffa

	// 1. The cap exists and the fallback returns a real, on-map point even when nothing qualifies.
	{
		const p = room.rejectSample(280, [[0, 0, 1e9]], 5);
		check('an unsatisfiable circle still returns a point (the cap, not a hang)',
			!!p && Number.isFinite(p.x) && Number.isFinite(p.y), p);
		check('...and it lands on the map',
			!!p && Math.abs(p.x) <= room.map.width / 2 && Math.abs(p.y) <= room.map.height / 2,
			p && (p.x + ',' + p.y));
	}

	// 2. The fallback is best-effort, not arbitrary: with enough draws the best-scoring
	// candidate against an unsatisfiable origin circle lands well out toward the map edge.
	{
		const p = room.rejectSample(280, [[0, 0, 1e9]], 400);
		check('the fallback maximises clearance, not just "some point"',
			Math.hypot(p.x, p.y) > room.map.width / 4, Math.hypot(p.x, p.y));
	}

	// 3. A map far below the ~2744-unit floor neither hangs nor places you off it.
	{
		const sandbox = rooms[4];
		const savedMap = sandbox.map;
		sandbox.map = { width: 1200, height: 1200 };
		let ok = true;
		for (let i = 0; i < 200; i++) {
			const p = sandbox.spawnPoint(player(sandbox, 0));
			if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) ||
				Math.abs(p.x) > 600 || Math.abs(p.y) > 600) { ok = false; break; }
		}
		sandbox.map = savedMap;
		check('a too-small map does not hang spawnPoint() and stays on the map', ok);
	}

	// 4. createObj() on the same too-small map returns instead of hanging.
	{
		const sandbox = rooms[4];
		const savedMap = sandbox.map;
		sandbox.map = { width: 1200, height: 1200 };
		const before = sandbox.INSTANCE.objs.size;
		for (let i = 0; i < 50; i++) { sandbox.createObj('sqr', 0); }
		const after = [...sandbox.INSTANCE.objs.live()].slice(-50);
		sandbox.map = savedMap;
		check('createObj() on a too-small map gained 50 live entries', sandbox.INSTANCE.objs.size - before === 50,
			sandbox.INSTANCE.objs.size - before);
		check('...and every one landed finite and on the (shrunk) map',
			after.every((o) => Number.isFinite(o.x) && Number.isFinite(o.y) &&
				Math.abs(o.x) <= 600 && Math.abs(o.y) <= 600));
	}

	// 5. ffa's own carve-out is unchanged by the refactor - spawnKeepOut() must still agree with
	// the hardcoded 1540/1120 the earlier ffa test pinned.
	{
		const circles = room.spawnKeepOut();
		check('spawnKeepOut() still returns the 1540/1120 nest radii',
			circles[0][2] === 1540 && circles[1][2] === 1120 && circles[2][2] === 1120,
			JSON.stringify(circles));
	}

	// 6. 'bull' placement (now direct polar sampling, not rejection) still lands in its annulus.
	{
		const before = room.INSTANCE.objs.size;
		for (let i = 0; i < 50; i++) { room.createObj('bull', 0); }
		const after = [...room.INSTANCE.objs.live()].slice(-50);
		check('bull placement still landed 50 new objects', room.INSTANCE.objs.size - before === 50,
			room.INSTANCE.objs.size - before);
		check('...every one in the 650..700 annulus with pos === 1',
			after.every((o) => {
				const r = Math.hypot(o.x, o.y);
				return r >= 650 && r <= 700 && o.pos === 1;
			}));
	}

	// 7. entities/Objects.js's own carve-outs (PENDING #28) rode the same x1.4 grid rescale as
	// spawnKeepOut()'s. Captured off a stub room rather than inferred from where shapes land, so a
	// regression names the wrong number instead of showing up as a density drift nobody can see.
	{
		const Objects = require(path.join(ROOT, 'entities', 'Objects.js'));
		let seen = null;
		const stub = {
			rejectSample: (inset, circles) => { seen = { inset: inset, circles: circles }; return { x: 0, y: 0 }; }
		};
		const probe = new Objects('sqr', -1, { GM: 'ffa', sId: 0, oId: 0 }, room.map, stub);
		check('a non-nest shape goes through the shared sampler', !!seen && probe.pos === 0);
		check('...carving out 1400/980/980, the x1.4 twins of spawnKeepOut()\'s 1540/1120',
			!!seen && seen.circles[0][2] === 1400 && seen.circles[1][2] === 980 && seen.circles[2][2] === 980,
			seen && JSON.stringify(seen.circles.map((c) => c[2])));
		check('...centred on the nests createObj() actually places into',
			!!seen && seen.circles[0][0] === 0 && seen.circles[1][0] === room.map.width / 4 &&
			seen.circles[2][0] === -room.map.width / 4,
			seen && JSON.stringify(seen.circles));
		check('...and inset from the map edge by the same 280 spawnPoint() uses',
			!!seen && seen.inset === 280, seen && seen.inset);
	}
}

/*
	The broad phase (plan.md WP4.5.4): the insert()/queryCircle() rewrite is what the rest of the
	pass's speed-up depends on, so it is verified directly here rather than trusted - "queryCircle
	agrees with a brute-force scan" is the one test that makes every other 4.5.4 change safe.
*/
function broadPhaseTests() {
	console.log('\nquadtree broad phase (plan.md WP4.5.4):');
	const quadTree = require(path.join(ROOT, 'lib', 'quadTree.js'));
	const SlotMap = require(path.join(ROOT, 'lib', 'SlotMap.js'));

	// queryCircle matches a brute-force scan exactly, at 50 random circles over several hundred
	// random points.
	{
		const W = 4000, H = 4000;
		const qt = new quadTree(-W / 2, -H / 2, W, H, 6);
		const pts = [];
		for (let i = 0; i < 400; i++) {
			// data is the plain index i, not the point object itself - queryCircle's own results
			// are {x,y,size,data} wrappers, so passing the point object as data here would make
			// got.map(p => p.data) yield point OBJECTS while want stays plain indices.
			const p = { x: -W / 2 + Math.random() * W, y: -H / 2 + Math.random() * H, size: 10 };
			pts.push(p);
			qt.insert(p.x, p.y, p.size, i);
		}
		let allMatch = true, mismatchDetail = '';
		for (let t = 0; t < 50 && allMatch; t++) {
			const cx = -W / 2 + Math.random() * W, cy = -H / 2 + Math.random() * H;
			const r = 50 + Math.random() * 400;
			const got = qt.queryCircle(cx, cy, r, []).map((p) => p.data).sort((a, b) => a - b);
			const want = [];
			for (let i = 0; i < pts.length; i++) { if (Math.hypot(pts[i].x - cx, pts[i].y - cy) <= r) { want.push(i); } }
			want.sort((a, b) => a - b);
			const same = got.length === want.length && got.every((v, i) => v === want[i]);
			if (!same) { allMatch = false; mismatchDetail = 'got ' + got.length + ' vs want ' + want.length + ' at trial ' + t; }
		}
		check('queryCircle matches a brute-force scan exactly, at 50 random circles', allMatch, mismatchDetail);
	}

	// A point exactly on an internal node boundary comes back once, not twice - the old all-four-
	// children insert() duplicated it (checkIn is inclusive on both edges).
	{
		const qt = new quadTree(0, 0, 256, 256, 2);
		qt.insert(10, 10, 1, 'a');
		qt.insert(200, 10, 1, 'b');
		qt.insert(10, 200, 1, 'c');   // a 3rd point over max=2 forces the split, boundary at (128,128)
		qt.insert(128, 128, 1, 'boundary');
		const got = qt.queryCircle(128, 128, 1, []);
		check('a point exactly on an internal node boundary comes back exactly once',
			got.filter((p) => p.data === 'boundary').length === 1,
			got.filter((p) => p.data === 'boundary').length);
	}

	// Subdivision terminates even when many entities share one exact coordinate (the w > 64 guard) -
	// a plain "the call completes and finds everything" assertion; without the guard this hangs.
	{
		const qt = new quadTree(-1000, -1000, 2000, 2000, 4);
		for (let i = 0; i < 500; i++) { qt.insert(0, 0, 1, i); }
		const got = qt.queryCircle(0, 0, 1, []);
		check('inserting 500 coincident points terminates and all 500 are found (the w > 64 guard)',
			got.length === 500, got.length);
	}

	// SlotMap's ascending-order guarantee survives the sorted-key cache across an add/delete/add
	// churn cycle (plan.md WP4.5.4).
	{
		const sm = new SlotMap();
		for (let i = 0; i < 10; i++) { sm.add((id) => ({ id })); }
		const before = [...sm.live()].map((e) => e.id);   // builds the cache
		check('SlotMap.live() yields ascending ids', before.every((v, i) => i === 0 || v > before[i - 1]),
			before.join(','));
		sm.delete(2);
		sm.add((id) => ({ id }));   // reuses the freed low id
		sm.delete(9);
		const after = [...sm.live()].map((e) => e.id);
		check('...and still ascending after an add/delete/add churn cycle (cache invalidated correctly)',
			after.every((v, i) => i === 0 || v > after[i - 1]), after.join(','));
		const afterEntries = [...sm.entries()].map(([id]) => id);
		check('...and entries() agrees with live()', JSON.stringify(afterEntries) === JSON.stringify(after));
		// A respawn-style set() on an already-live id must NOT need a cache rebuild to be seen -
		// live()/entries() always re-read the value fresh, but this pins that the KEY itself is
		// unaffected (no duplicate, no drop) across a value-only set().
		const liveId = after[0];
		sm.set(liveId, { id: liveId, replaced: true });
		const afterSet = [...sm.live()];
		check('a value-only set() on an already-live id changes neither the key set nor its order',
			afterSet.filter((e) => e.id === liveId)[0].replaced === true &&
			afterSet.map((e) => e.id).join(',') === after.join(','));
	}
}

console.log('obstar room tests\n');
const rooms = [];
rooms.push(ffaTests()); console.log('');
rooms.push(teamTests()); console.log('');
rooms.push(fourTeamTests()); console.log('');
rooms.push(bossTests()); console.log('');
rooms.push(sandboxTests()); console.log('');
respawnTests(rooms);
respawnCarryoverTests(rooms);
modeTableTests(rooms);
gridAnchorTests();
baseDroneTests();
baseDroneAiTests();
tickScaleTests();
fovTests(rooms);
oobTests(rooms);
growthTests(rooms);
autoSpinTests(rooms);
upgradeEconomyTests(rooms);
healthUpgradeTests(rooms);
spawnSamplerTests();
broadPhaseTests();

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
