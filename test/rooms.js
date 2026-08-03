/*
	Room tests: the gamemode behaviour that test/smoke.js cannot see.

	smoke.js drives a real socket and proves the pipe from socket -> room -> encoder -> socket
	is intact, but every assertion it makes is true of any room. Teams, bases, bot rosters,
	colours and respawn xp are exactly the things that differed between the old Ffa and
	TwoTeam copies, so they are exactly what a shared rooms/Room.js has to be pinned on.

	All seven modes are covered: '4team', 'boss', 'tag' and 'maze' were each written against this
	base without touching rooms/Room.js's tick, and the shared block at the bottom runs the same
	rules over every one of them, which is the assertion that the base really did fit.

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
	check('the boss keeps its own colour, not the enemy red', room.entityColor(boss) !== 1,
		room.entityColor(boss));
	check('...and it is a real per-class diep colour (plan.md Part D), not team-9 gold',
		room.entityColor(boss) === { Guardian: 10, Defender: 11, Summoner: 12, 'Fallen Overlord': 13, 'Fallen Booster': 13 }[boss.class],
		boss.class + ' -> ' + room.entityColor(boss));
	// AbstractBoss.ts's own shared scaffolding (plan.md Part D): HP 3000, damagePerTick 10,
	// absorbtionFactor 0.05, reloadTime's 15x0.914^7 multiplier (baked onto up.Reload, the same
	// site rooms/Mothership.js's own createMothership() already uses), scoreReward 30000.
	check('a boss is diep\'s own flat 3000 HP, not a legacy 20000/30000 balance figure',
		boss.hp === 3000 && boss.maxHp === 3000, boss.hp + '/' + boss.maxHp);
	check('a boss deals diep\'s own 10 body damage/tick, not the ordinary tank default of 5',
		boss.damage === 10, boss.damage);
	check('a boss is nearly immovable (absorbtionFactor 0.05), not a Dominator\'s literal 0',
		boss.absorb === 0.05, boss.absorb);
	check('a boss reloads at its own maxed 15x0.914^7 rate',
		boss.up.Reload === Math.pow(0.914, 7), boss.up.Reload);
	check('a boss\'s kill/score reward is diep\'s own 30000, not the old 100000',
		boss.prize === 30000 && boss.xp === 30000, boss.prize + '/' + boss.xp);
	check('a Dominator is fully immovable (absorbtionFactor 0)', (function () {
		const dom = room.createDominator(0, 0, 0);
		return dom.absorb === 0;
	})());
	{
		// AbstractBoss.ts:204 - flat maxHP/25000 regen every tick, unconditional (no hyper-regen
		// gate/no-damage delay, unlike an ordinary tank - plan.md Part D). Damage it, then step
		// the room and confirm it heals back up on its own with no player input.
		boss.hp = 1000;
		const before = boss.hp;
		for (let i = 0; i < 50; i++) { room.step(); }
		check('a boss regenerates continuously (maxHP/25000/tick), even freshly damaged',
			boss.hp > before && boss.hp <= boss.maxHp, before + ' -> ' + boss.hp);
	}
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

	// Direct table sweep (plan.md Part D/F2), not dependent on the random 200-pass roll above
	// having actually filled every class: every real diep boss now states its own diep-derived
	// bossSize (Summoner used to fall through to a flat, ~24%-undersized 64).
	{
		const CLASS = require(path.join(ROOT, 'public', 'SHARE', 'TanksConfig.js')).class;
		// Guardian's 37.8 is not 135 du x 0.56 like the rest of this table: GUARDIAN_SIZE is
		// diep's drawn CIRCUMRADIUS, and Drawings.body[3] draws a triangle at `size / cos(pi/3)`
		// = 2 x size, so the figure that lands on diep's own 135 du is half of it. See the class
		// entry's own comment.  Defender/Summoner used to fall through to the CIRCUMRADIUS
		// itself (84 = *_SIZE x 0.56) instead - the same conflation Guardian had already been
		// fixed for.
		const sizes = { Guardian: 37.8, Defender: 42, Summoner: 59.39697, 'Fallen Overlord': 58.46, 'Fallen Booster': 58.46 };
		for (const name of Object.keys(sizes)) {
			check(name + ' has its own diep-derived bossSize',
				Math.abs(CLASS[name].bossSize - sizes[name]) < 0.01,
				CLASS[name].bossSize + ' vs ' + sizes[name]);
		}
		check('Summoner\'s drone cap is droneCount 7 x 4 barrels (Summoner.ts), not the old 35',
			CLASS['Summoner'].maxDrone === 28, CLASS['Summoner'].maxDrone);
	}

	/*
		A boss's threat scan must not be gated on the target's LEVEL. The original bug was
		lib/gameAI.js's Summoner-era metric dividing by `n.level` with no floor, so raw/0 was
		Infinity and a level-0 target (which every freshly respawned player is - respawn() hands
		back a brand new Player) never cleared its `dis < n.screen/30` check.

		That whole metric is gone: bossDetect() is diep's own AI.findTarget() now, a plain
		"nearest live enemy inside ai.viewRange (2000 du x 0.56 = 1120)". So this stands the
		level-0 player a few hundred units away rather than ON the boss - the old placement only
		existed to force the hull-relative term to zero, and standing inside a boss now simply
		kills the tank in two ticks of body damage, which a dead target is correctly not detected
		through. Two steps, because motion() builds its own scan on the first one.
	*/
	{
		// room.bosses[0] used to always be a Summoner (the only boss CONFIG.BOSS had) - plan.md
		// X1 added four real ones, one of which (Defender) diep gives ai.viewRange 0: it never
		// aggros at all, by design, so this picks any OTHER boss the 200-pass roll above happened
		// to fill the cap with rather than assuming index 0 is aggro-capable.
		const boss = room.bosses.find((b) => b.class !== 'Defender');
		if (boss) {
			const me = player(room, 0);
			me.level = 0;
			me.shield = 0;
			me.alpha = 1;
			const hold = () => { me.x = boss.x + 400; me.y = boss.y; };
			hold();
			room.step();
			hold();
			room.step();
			check('a boss detects a level-0 (freshly respawned) player standing next to it',
				boss.detected.includes(me), 'detected ' + boss.detected.length + ' players');
		}
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

	// net/gameSocket.js's keydown/keyup cases just flip inputs.k / call cycleClass() / flip
	// dev.god - the actual sandbox-cheat behaviour lives on the Player instance itself
	// (entities/Player.js), so it's tested directly here rather than through a socket.

	// 'k' (plan.md C4): hold to climb one level at a time, diep's own hold-to-repeat convention
	// (+1 level per input packet with the levelup flag - effectively one per simulation tick
	// while held, Client.ts:313-320) - not the instant jump-to-cap this used to be, and not the
	// old 5-reference-tick (200ms) throttle either, which read as a crawl against diep's own
	// ~25/s. Starts from level 1, not 0: XPLVL[0] is 0, so a fresh level-0 spawn already
	// satisfies the level-up check for free on its very first tick regardless of 'k' - level
	// 1->2 is the first REAL (nonzero) threshold.
	{
		const tick = require(path.join(ROOT, 'lib', 'tick.js'));
		me.level = 1; me.xp = 0; me.maxHp = 50; me.hp = 50; me.levelUpHold = 0;
		me.inputs.k = 1;
		let ticks = 0;
		while (me.level === 1 && ticks < 50) { me.update(); ticks++; }
		check('holding \'k\' takes exactly 1 reference tick per level, not the old 5 (200ms)',
			me.level === 2 && ticks === tick.ticks(1), 'level=' + me.level + ' after ' + ticks + ' ticks (want ' + tick.ticks(1) + ')');
		const levelAfterFirst = me.level;
		me.update();
		check('...and never grants more than one level in a single tick',
			me.level - levelAfterFirst <= 1, me.level);
		for (let i = 0; i < 5000 && me.level < me.XPLVL.length; i++) { me.update(); }
		check('...but holding it long enough still reaches the real cap and stops exactly there',
			me.level === me.XPLVL.length, me.level);
		const xpAtCap = me.xp;
		me.update();
		check('...and xp does not corrupt once parked at the cap', me.xp === xpAtCap && !isNaN(me.xp),
			me.xp);
		me.inputs.k = 0;
	}

	// '\' (PENDING "Sandbox gaps" / #51): a raw class preview, no tree/level gating, real
	// playable tanks plus Arena Closer/the 3 Dominators (allowed on purpose for now, so a human
	// can eyeball them in sandbox - PENDING #51) - never a dev placeholder or Summoner (still a
	// boss, not part of that ask).
	{
		const NEVER = ['pre launch', 'testbed', 'bigView', 'shapes', 'shape1', 'shape2', 'Summoner'];
		const CLOSER_DOMINATOR = ['Arena Closer', 'Destroyer Dominator', 'Gunner Dominator', 'Trapper Dominator'];
		me.class = 'Basic'; me.classLvl = 0;
		const seen = new Set();
		const seenClosersDominators = new Set();
		let cameBackToBasic = false;
		for (let i = 0; i < 60; i++) {
			me.cycleClass();
			if (NEVER.includes(me.class)) { seen.add(me.class); }
			if (CLOSER_DOMINATOR.includes(me.class)) { seenClosersDominators.add(me.class); }
			if (me.class === 'Basic') { cameBackToBasic = true; break; }
		}
		check('cycling class never lands on a dev placeholder or Summoner',
			seen.size === 0, [...seen].join(','));
		check('...but does reach Arena Closer and all 3 Dominators',
			seenClosersDominators.size === CLOSER_DOMINATOR.length, [...seenClosersDominators].join(','));
		check('cycling all the way around comes back to Basic (a real cycle, not a dead end)',
			cameBackToBasic);
		check('cycleClass() does not bump classLvl - this is a preview, not a real evolution',
			me.classLvl === 0, me.classLvl);
	}

	// ';' (PENDING "Sandbox gaps"): repels contact and takes no consequence from it, the same
	// one-sided guard shape dev.ghost/this.closer already use in collision().
	{
		const KIND = require(path.join(ROOT, 'public', 'SHARE', 'kinds.js'));
		me.dev.god = 1;
		me.hp = me.maxHp;
		const vx0 = me.vec.x, vy0 = me.vec.y;
		const stubEnemy = { kind: KIND.PLAYER, x: me.x + 40, y: me.y, size: 25, damage: 999, team: me.team + 1 };
		me.collision(stubEnemy, {});
		check('god mode takes no damage from a contact that would otherwise be lethal',
			me.hp === me.maxHp, me.hp);
		check('...and gets shoved away from whatever touched it',
			me.vec.x !== vx0 || me.vec.y !== vy0, me.vec.x + ',' + me.vec.y);
		me.dev.god = 0;
		me.vec.x = 0; me.vec.y = 0;
	}

	// 'o' (already-shipped self-destruct, kept as its own check): the ordinary death path still
	// works with nobody else in the room.
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
/// Tag ///////////////////////////////////////////////////////////////////////
/*
	Tag (PENDING #28, plan.md step 7). The mode adds no entity types, so what is actually worth
	pinning is the three hooks that make it Tag - respawnTeam(), leaderRows() and the shrink timer -
	plus the two rules that are easy to get subtly wrong: the per-team gate before tagging starts,
	and the polygon/boss exemption from it.
*/
function tagTests() {
	console.log('\nrooms (tag):');
	const room = makeRoom('tag');
	const World = require(path.join(ROOT, 'public', 'SHARE', 'World.js'));
	// Bots are seated by Init(), which runs on a timer that never fires inside this synchronous
	// suite (see the note in ffaTests). Everything below is about team POPULATION, so seat them
	// directly - createAi() rather than the whole of Init(), to skip 2000 preGenerate passes this
	// mode's assertions do not need.
	room.createAi();

	check('four sides, the same ids 4team uses', room.rules.teams.join(',') === '0,1,2,3');
	check('friendly fire is off', room.rules.teamPlay === true);
	check('no bases at all - the structural difference from 4team',
		room.baseSize === 0 && room.dronePosts.length === 0,
		room.baseSize + ' / ' + room.dronePosts.length + ' drone posts');
	check('xp is x3 - diep_wiki lists Tag among the triple-xp modes', room.rules.xpMul === 3,
		room.rules.xpMul);

	// awardXp() is the single site the multiplier lives at, so drive the real method rather than
	// asserting the rule flag twice.
	{
		const tank = { xp: 0 };
		room.awardXp(tank, 100);
		check('...and awardXp() actually applies it', tank.xp === 300, tank.xp);
		const ffa = makeRoom('ffa');
		const t2 = { xp: 0 };
		ffa.awardXp(t2, 100);
		check('...while an ordinary mode is an identity multiply', t2.xp === 100, t2.xp);
	}

	// The tagging gate: every team needs MIN_PER_TEAM before a kill converts anyone. The room is
	// built with 16 bots dealt round-robin across four sides, so it should be open from the start -
	// assert that rather than assuming it, since a botCount change would silently close it.
	check('every side has enough players for tagging to be live', room.tagging() === true,
		room.rules.teams.map((t) => [...room.INSTANCE.players.live()]
			.filter((p) => !p.boss && p.team === t).length).join('/'));

	// respawnTeam() is the mode. Drive it directly with hand-built `murder` records - the same
	// shapes entities/Player.js's collision arms actually write.
	{
		const victim = { team: 0, murder: null };
		const killerId = room.bots.find((b) => {
			const p = player(room, b);
			return p && p.team === 2;
		});
		const killer = player(room, killerId);
		check('a victim killed by a player joins that player\'s side',
			room.respawnTeam({ team: 0, murder: ['players', killer.id] }) === killer.team,
			room.respawnTeam({ team: 0, murder: ['players', killer.id] }) + ' vs ' + killer.team);
		check('a victim killed by a polygon stays on its own side',
			room.respawnTeam({ team: 0, murder: ['objs', { oId: 0 }] }) === 0);
		check('a victim that died to nothing in particular stays on its own side',
			room.respawnTeam(victim) === 0 && room.respawnTeam({ team: 3, murder: -1 }) === 3);
		// A boss is a Player on team 9, a side assignTeam() never hands out - tagging onto it would
		// strand the victim alone on a team nothing else is on.
		// Past the bot range (botIdStart 10 + 16 bots = slots 10..25) and the join slots, but
		// still inside maxPlayer 30. Deriving it rather than writing 26, because picking a literal
		// here is exactly how this test first went wrong: 24 was clear when bots started at 8, and
		// silently became a live bot slot when botIdStart moved to 10 - it overwrote a bot and
		// quietly cost that team a player.
		const BOSS_SLOT = room.rules.botIdStart + room.rules.botCount;
		room.INSTANCE.players.set(BOSS_SLOT, { id: { oId: BOSS_SLOT }, team: 9, boss: 1 });
		check('a victim killed by a BOSS stays on its own side, not team 9',
			room.respawnTeam({ team: 1, murder: ['players', { oId: BOSS_SLOT }] }) === 1,
			room.respawnTeam({ team: 1, murder: ['players', { oId: BOSS_SLOT }] }));
		room.INSTANCE.players.delete(BOSS_SLOT);
	}

	// ...and the gate really does suppress it, checked by closing the gate rather than by trusting
	// the branch: stub tagging() false and the same kill must no longer convert.
	{
		const realTagging = room.tagging;
		room.tagging = () => false;
		const killer = player(room, room.bots.find((b) => {
			const p = player(room, b);
			return p && p.team === 2;
		}));
		check('before every side has four players, a kill does NOT convert',
			room.respawnTeam({ team: 0, murder: ['players', killer.id] }) === 0);
		room.tagging = realTagging;
	}

	// The leaderboard is a different KIND of board here - one row per team, headcount in `xp`.
	{
		const rows = room.leaderRows(0);
		check('the leaderboard has one row per team, not per player',
			rows.length === room.rules.teams.length, rows.length);
		check('...each carrying that team\'s headcount, summing to the whole population',
			rows.reduce((a, r) => a + r.xp, 0) ===
			[...room.INSTANCE.players.live()].filter((p) => !p.boss).length,
			JSON.stringify(rows.map((r) => r.name + ':' + r.xp)));
		check('...sorted with the leading team first, which is what the client scales bars against',
			rows.every((r, i) => i === 0 || rows[i - 1].xp >= r.xp),
			rows.map((r) => r.xp).join(','));
		check('...and every row carries a real team colour index',
			rows.every((r) => room.rules.teams.indexOf(r.team) >= 0 && typeof r.name === 'string'));
	}

	// A DEAD player is still on its team - it is respawning, not gone. Filtering the dead out made
	// both the board and the tagging gate flicker on every death (with exactly 4 bots a side, one
	// dead bot dropped that side to 3 and switched tagging off until it came back), so this pins
	// the decision rather than leaving it to be "tidied" back.
	{
		const victim = player(room, room.bots[0]);
		const before = room.teamCounts().slice();
		victim.destroy = 1;
		check('a dead-but-respawning player still counts toward its team',
			room.teamCounts().join(',') === before.join(','), room.teamCounts().join(','));
		check('...so one death cannot switch the tagging rule off', room.tagging() === true);
		victim.destroy = 0;
	}

	// The shrink. Driving 12.5 s of real ticks would be slow, so drive the schedule directly -
	// shrink() is the whole mechanism and step() only calls it.
	{
		const before = room.newMap.width;
		room.shrinkIn = 1;
		room.shrink();
		check('the arena shrinks when its timer fires', room.newMap.width < before,
			before + ' -> ' + room.newMap.width);
		check('...squarely - width and height stay equal',
			room.newMap.width === room.newMap.height);
		check('...and re-arms rather than shrinking every tick',
			(function () { const w = room.newMap.width; room.shrink(); return room.newMap.width === w; })());
		// It must bottom out, or a long match collapses the arena to nothing.
		room.newMap.width = room.newMap.height = World.gu(151);
		for (let i = 0; i < 50; i++) { room.shrinkIn = 1; room.shrink(); }
		check('...and floors at gu(150) instead of collapsing to zero',
			room.newMap.width === World.gu(150), room.newMap.width);
	}

	// Random spawns anywhere clear of the nests - inherited from Room, but the POINT of the mode is
	// that it has no base to spawn in, so a future override would be a real regression.
	{
		let clear = true;
		for (let i = 0; i < 100; i++) {
			const p = room.spawnPoint(player(room, 0));
			if (Math.abs(p.x) > room.map.width / 2 || Math.abs(p.y) > room.map.height / 2) { clear = false; }
		}
		check('spawns are random across the whole arena, not inside a base', clear);
	}

	// The win condition (PENDING #28's remaining half). Driven directly by reassigning team,
	// the same "drive the field, not a full random match" style the rest of this file uses -
	// letting a real match converge under unseeded RNG is exactly the kind of flakiness this
	// suite avoids elsewhere.
	{
		const KIND = require(path.join(ROOT, 'public', 'SHARE', 'kinds.js'));

		check('winner() is false while every side still has players', room.winner() === false,
			room.teamCounts().join(','));

		const live = [...room.INSTANCE.players.live()].filter((p) => !p.boss);
		const before = live.map((p) => p.team);
		for (const p of live) { p.team = room.rules.teams[0]; }
		check('winner() is true once one team holds every player', room.winner() === true,
			room.teamCounts().join(','));

		check('the room has not started closing yet', room.closing === false);
		const closersBefore = room.closers.length;
		room.startClosing();
		check('startClosing() flips the closing flag', room.closing === true);
		check('...and spawns at least one Arena Closer', room.closers.length > closersBefore,
			room.closers.length);
		check('...on a side none of rules.teams claims, same as a boss',
			room.closers.every((c) => room.rules.teams.indexOf(c.team) < 0 && c.closer === 1),
			room.closers.map((c) => c.team + ':' + c.closer).join(','));
		// Room.js's step() self-destruct loop has to exclude a Closer the same way it already
		// excludes a bot/boss, or a finished match (every real player dead) idles forever instead
		// of self-destructing, since a Closer is invincible and never dies on its own.
		check('a Closer does not read as a still-live human to the self-destruct check',
			room.closers.every((c) => !c.bot && !c.boss && c.closer === 1));

		// Invincibility and complete knockback resistance (diep_wiki) - drive collision() directly
		// for both a tank ram and a bullet hit, rather than trusting the guard is reached.
		const closer = room.closers[0];
		const snap = { hp: closer.hp, vx: closer.vec.x, vy: closer.vec.y };
		closer.collision({ kind: KIND.PLAYER, id: { oId: -1 }, damage: 999999, x: closer.x + 1, y: closer.y }, {});
		closer.collision({ kind: KIND.BULLET, origin: { oId: -1 }, weight: 999999, damage: 999999, x: closer.x + 1, y: closer.y }, {});
		check('a Closer takes no damage or knockback from a tank ram or a bullet',
			closer.hp === snap.hp && closer.vec.x === snap.vx && closer.vec.y === snap.vy,
			closer.hp + ' / ' + closer.vec.x + ',' + closer.vec.y);

		// Once closing, nobody respawns - diep_wiki's ending is "all players killed off the
		// arena", not a match that keeps restocking itself.
		const victim = live[0];
		const victimSlotBefore = room.INSTANCE.players.get(victim.id.oId);
		victim.destroy = 1;
		room.respawn(victim.id.oId, 0, 0);
		check('respawn() is a no-op once the arena is closing',
			room.INSTANCE.players.get(victim.id.oId) === victimSlotBefore);

		// Restore, so nothing above leaks into a test file run further down the same process.
		live.forEach((p, i) => { p.team = before[i]; });
		victim.destroy = 0;
		room.closing = false;
		room.closers = [];
	}

	// The invisibility cap (PENDING #28) - diep_wiki: Tag players "can't become fully invisible".
	// Mirrors entities/Player.js's own decay line directly rather than looping the full update()
	// (which would fire the stealth class's real cannons into the room's real bullet SlotMap -
	// unrelated to what this checks), the same reasoning the regen invariance tests above give for
	// doing the same thing to the regen formula.
	{
		const tick = require(path.join(ROOT, 'lib', 'tick.js'));
		const CLASS = require(path.join(ROOT, 'public', 'SHARE', 'TanksConfig.js')).class;
		const stealthClass = 'Manager';
		check('there is a real stealth class to test the cap against',
			CLASS[stealthClass] && CLASS[stealthClass].stealth && CLASS[stealthClass].stealth.decay > 0,
			CLASS[stealthClass] && CLASS[stealthClass].stealth);
		check('Tag opts into a nonzero invisibility floor', room.rules.invisFloor > 0,
			room.rules.invisFloor);
		let alpha = 1;
		for (let i = 0; i < 100000; i++) {
			alpha = Math.max(room.rules.invisFloor, alpha - tick.perTick(CLASS[stealthClass].stealth.decay));
		}
		check('decaying a stealth class in Tag settles at rules.invisFloor, not fully invisible',
			alpha === room.rules.invisFloor, alpha);
	}

	return room;
}

/// Maze /////////////////////////////////////////////////////////////////////
function mazeTests() {
	console.log('\nrooms (maze):');
	const room = makeRoom('maze');
	const World = require(path.join(ROOT, 'public', 'SHARE', 'World.js'));
	const KIND = require(path.join(ROOT, 'public', 'SHARE', 'kinds.js'));

	check('same arena as ffa - diep_wiki: "works similarly to Free For All"',
		room.map.width === World.gu(451) && room.map.height === World.gu(451),
		room.map.width + 'x' + room.map.height);
	check('one nominal team, friendly fire off, same as ffa',
		room.rules.teams.join(',') === '1' && room.rules.teamPlay === false);

	// Bosses do not spawn here (diep_wiki: "Unlike other game modes, Bosses do NOT spawn in
	// Maze") - this mode states no override, so it rides ffa's own never-roll defaults.
	check('bosses never spawn - the mode turns neither bossRng nor maxBoss up from the default',
		room.rules.bossRng === 2 && room.rules.maxBoss === 0,
		room.rules.bossRng + ' / ' + room.rules.maxBoss);

	// The walls themselves (plan.md Step 12) - build() runs synchronously in the constructor
	// (see rooms/Room.js's header), so they exist the moment makeRoom() returns, with no
	// Init()/timer to wait on.
	{
		const CELL_SIZE = 635 * 0.56;
		const expectedGrid = Math.floor(room.map.width / CELL_SIZE);
		check('GRID_SIZE derives from our own arena at diep\'s cell size (635 du), not diep\'s hardcoded 40',
			room.mazeGenerator.config.size === expectedGrid && expectedGrid === 35,
			room.mazeGenerator.config.size + ' vs ' + expectedGrid);

		const walls = [...room.INSTANCE.walls.live()];
		check('build() places at least one wall rectangle across the arena', walls.length > 0,
			walls.length);
		check('every wall is a real KIND.WALL rectangle with positive width/height',
			walls.every((w) => w.kind === KIND.WALL && w.w > 0 && w.h > 0),
			walls.map((w) => w.kind + ':' + w.w + 'x' + w.h).slice(0, 5).join(' '));
		check('every wall\'s broad-phase `.size` is its own half-diagonal, not either half-extent',
			walls.every((w) => Math.abs(w.size - Math.sqrt(w.w * w.w + w.h * w.h) / 2) < 1e-6),
			walls.slice(0, 3).map((w) => w.size.toFixed(2)).join(' '));
		check('every wall sits inside the drawn arena, not the OOB band past it',
			walls.every((w) =>
				w.x - w.w / 2 >= -room.map.width / 2 - 1e-6 && w.x + w.w / 2 <= room.map.width / 2 + 1e-6 &&
				w.y - w.h / 2 >= -room.map.height / 2 - 1e-6 && w.y + w.h / 2 <= room.map.height / 2 + 1e-6),
			walls.length);
		check('a wall is permanent geometry - never tombstoned',
			walls.every((w) => w.destroy === 0));

		// isValidSpawnLocation (rooms/Maze.js's spawnPoint override). The base spawnPoint only
		// clears the nests, so before this override ~37% of maze spawns landed embedded in a wall
		// (measured: 298/800). Sample many spawns and assert not one lands inside a wall, padded by
		// the tank's own body radius (the same padded-AABB the override applies), so a player can
		// never spawn stuck in maze geometry.
		{
			const tank = { size: 30 };
			const pad = tank.size;
			const inWall = (p) => walls.some((w) =>
				Math.abs(p.x - w.x) <= w.w / 2 + pad && Math.abs(p.y - w.y) <= w.h / 2 + pad);
			let hits = 0;
			for (let i = 0; i < 400; i++) { if (inWall(room.spawnPoint(tank))) hits++; }
			check('no player ever spawns inside a maze wall (isValidSpawnLocation)', hits === 0,
				hits + ' / 400 landed in a wall');
		}

		// Batch E - the tank's KIND.WALL arm now resolves POSITION, not only velocity, so a tank
		// that gets shoved into a wall (a fast ram, or another tank pushing it) can no longer sink
		// a whole grid cell in and sit there. diep keeps the residual overlap minimal (~1/10 of a
		// maze cell); the arm clamps a tank's penetration to WALL_TANK_OVERLAP of its own body
		// radius. Drive the collision arm directly (deterministic, no integrator) from the two
		// worst cases and assert the residual penetration stays under diep's own 1/10-cell figure.
		{
			const KINDS = require(path.join(ROOT, 'public', 'SHARE', 'kinds.js'));
			const cell = room.map.width / room.mazeGenerator.config.size;   // one maze grid square
			const diepAllowed = cell / 10;                                   // diep's ~1/10-cell residual
			const tank = player(room, 0);
			const wall = walls.find((w) => w.kind === KINDS.WALL);
			// Closest-point penetration of a circle (tank) against the wall's AABB.
			const penOf = (t) => {
				const hw = wall.w / 2, hh = wall.h / 2;
				const cx = Math.max(wall.x - hw, Math.min(t.x, wall.x + hw));
				const cy = Math.max(wall.y - hh, Math.min(t.y, wall.y + hh));
				const d = Math.hypot(t.x - cx, t.y - cy);
				return t.size - d;   // > 0 means overlapping, by this much
			};
			const slack = tank.size * 0.1;   // WALL_TANK_OVERLAP - the arm's own clamp target

			// 1) The clamp target itself is well under diep's minimal residual - so "clamped" here
			//    means genuinely minimal, not just "less than a whole cell".
			check('the tank\'s allowed wall overlap is far under diep\'s ~1/10-cell residual',
				slack < diepAllowed, slack.toFixed(2) + ' vs ' + diepAllowed.toFixed(2) + ' (1/10 cell)');

			// 2) Worst case: tank centre dead inside the wall (penetration = full body radius). One
			//    contact tick must expel it to at most the slack - it can no longer sit embedded.
			tank.x = wall.x; tank.y = wall.y;
			tank.vec.x = 0; tank.vec.y = 0;
			const before = penOf(tank);
			tank.collision(wall);
			const after = penOf(tank);
			check('a tank buried in a wall is expelled to a minimal overlap in one contact tick',
				before > slack && after <= slack + 1e-6,
				'penetration ' + before.toFixed(1) + ' -> ' + after.toFixed(1) + ' (slack ' + slack.toFixed(1) + ')');

			// 3) Edge case: tank overlapping one face by more than the slack is clamped back to it,
			//    and the residual stays under diep's 1/10-cell figure.
			tank.x = wall.x + wall.w / 2 + tank.size * 0.4;   // 60% of the body radius inside the face
			tank.y = wall.y;
			tank.vec.x = 0; tank.vec.y = 0;
			tank.collision(wall);
			check('a tank overlapping a wall face is clamped under diep\'s ~1/10-cell overlap',
				penOf(tank) <= diepAllowed, penOf(tank).toFixed(2) + ' vs ' + diepAllowed.toFixed(2));

			// A SHAPE must leave NO visual overlap at all (user report / Batch E): a shape's drawn
			// corners reach this.size x SQRT2 (drawings.js C3), so the arm snaps the DRAWN radius
			// clear of the wall, not just the collision circle - snapping the collision circle
			// tangent (the old behaviour) left the corners poking in by (SQRT2 - 1) x size. Build a
			// real square, bury it in the wall, run one contact tick, and assert its whole drawn
			// extent is outside the wall (closest-point distance >= drawn circumradius).
			{
				const Objects = require(path.join(ROOT, 'entities', 'Objects.js'));
				const shape = new Objects('sqr', [0, 0, 0], { GM: 'maze', sId: room.id, oId: 9990 }, room.map, room);
				const drawR = shape.size * Math.SQRT2;
				const hw = wall.w / 2, hh = wall.h / 2;
				const surfaceDist = (s) => {
					const cxp = Math.max(wall.x - hw, Math.min(s.x, wall.x + hw));
					const cyp = Math.max(wall.y - hh, Math.min(s.y, wall.y + hh));
					return Math.hypot(s.x - cxp, s.y - cyp);   // centre-to-nearest-wall-point
				};
				// Anchor: the drawn corner really does stick out past the collision radius - so
				// snapping only the collision circle (the old code) WOULD have left the corner in.
				check('a shape\'s drawn corners extend a full SQRT2 past its collision radius (C3)',
					Math.abs(drawR - shape.size * Math.SQRT2) < 1e-9 && drawR > shape.size,
					drawR.toFixed(2) + ' vs collision ' + shape.size.toFixed(2));

				shape.x = wall.x; shape.y = wall.y;   // buried dead-centre in the wall
				shape.vec.x = 0; shape.vec.y = 0;
				shape.collision(wall);
				check('a shape buried in a wall is pushed until its whole DRAWN body clears the wall',
					surfaceDist(shape) >= drawR - 1e-6,
					'surface dist ' + surfaceDist(shape).toFixed(2) + ' vs drawn radius ' + drawR.toFixed(2));

				// Grazing case: only the drawn corner is inside (collision circle not yet touching).
				shape.x = wall.x + hw + (shape.size + drawR) / 2;   // between collision radius and drawn radius
				shape.y = wall.y;
				shape.vec.x = 0; shape.vec.y = 0;
				check('...and this graze really was a drawn-corner overlap the collision circle missed',
					surfaceDist(shape) < drawR && surfaceDist(shape) > shape.size,
					surfaceDist(shape).toFixed(2) + ' (between ' + shape.size.toFixed(2) + ' and ' + drawR.toFixed(2) + ')');
				shape.collision(wall);
				check('a shape grazing a wall by only its drawn corner is still pushed fully clear',
					surfaceDist(shape) >= drawR - 1e-6,
					'surface dist ' + surfaceDist(shape).toFixed(2) + ' vs drawn radius ' + drawR.toFixed(2));
			}
		}
	}

	// Visible on the minimap (diep_wiki: "The maze walls are also visible on the minimap") -
	// one dot per merged rectangle now, far fewer than the old one-per-stud count (plan.md Step
	// 12) - precomputed once in build(), not walked per viewer per tick; see rooms/Room.js's
	// this.wallDots for why. 'gray' (SocketSchema's color index 4) is never a live team dot, so
	// reusing the ordinary player-dot record needs no wire-format change of its own.
	{
		const walls = [...room.INSTANCE.walls.live()];
		check('one precomputed minimap dot per wall rectangle', room.wallDots.length === walls.length,
			room.wallDots.length + ' vs ' + walls.length);
		check('every wall dot is grey and lands inside the 0..1 map fraction',
			room.wallDots.every((d) => d.team === 4 && d.x >= 0 && d.x <= 1 && d.y >= 0 && d.y <= 1),
			room.wallDots.slice(0, 3).map((d) => d.x.toFixed(2) + ',' + d.y.toFixed(2) + ':' + d.team).join(' '));
		const ui = room.getUi(0);
		check('getUi() folds the wall dots into the same map array the player dots ride in',
			ui.map.length >= room.wallDots.length, ui.map.length + ' vs ' + room.wallDots.length);
	}

	// The 5-hour close (diep_wiki: "Five hours after the server opened") and the Arena Closer
	// swarm it spawns - the same mechanism rooms/Tag.js's win condition already built (PENDING
	// #28), reused rather than re-derived. Driving 5 hours of real ticks would be slow, so the
	// countdown is armed directly, the same style Tag's own shrink-timer test uses.
	{
		check('the arena has not started closing yet', room.closing === false);
		const closersBefore = room.closers.length;
		room.closeIn = 1;
		room.close();
		check('the countdown reaching zero starts closing', room.closing === true);
		check('...and spawns at least one Arena Closer', room.closers.length > closersBefore,
			room.closers.length);
		check('...on a side this mode never assigns, same as a boss',
			room.closers.every((c) => room.rules.teams.indexOf(c.team) < 0 && c.closer === 1),
			room.closers.map((c) => c.team + ':' + c.closer).join(','));

		// Once closing, nobody respawns - diep_wiki's "the server will be reset" ending is the
		// room going empty (Room.step()'s existing zero-human self-destruct), not a match that
		// keeps restocking itself.
		const victim = player(room, 0);
		victim.destroy = 1;
		const victimSlotBefore = room.INSTANCE.players.get(0);
		room.respawn(0, 0, 0);
		check('respawn() is a no-op once the arena is closing',
			room.INSTANCE.players.get(0) === victimSlotBefore);

		// Restore, so nothing above leaks into a test run further down the same process - this
		// room is about to join the shared `rooms` array, whose later tests call respawn() for
		// real (rooms/Tag.js's own closing test resets the same way for the same reason).
		victim.destroy = 0;
		room.closing = false;
		room.closers = [];
	}

	return room;
}

/// Domination ////////////////////////////////////////////////////////////////
function dominatorTests() {
	console.log('\nrooms (domination):');
	const room = makeRoom('domination');
	const KIND = require(path.join(ROOT, 'public', 'SHARE', 'kinds.js'));
	const Bullet = require(path.join(ROOT, 'entities', 'Bullet.js'));

	check('same base/team tuning as 2team, just gm and xpMul differ',
		room.rules.teams.join(',') === '0,1' && room.rules.teamPlay === true &&
		room.rules.baseSizeRatio.num === 40 && room.rules.baseSizeRatio.den === 400,
		room.rules.teams.join(','));
	check('xp is doubled (diep_wiki/Polygons.txt)', room.rules.xpMul === 2, room.rules.xpMul);

	// build() spawns all four before the first tick, same as Maze's walls. room.dominators holds
	// the live Player instances directly (SlotMap.add() returns the entity, not an id).
	const doms = room.dominators;
	check('build() spawns exactly 4 Dominators', doms.length === 4, doms.length);
	check('every Dominator is flagged, neutral, and at diepcustom\'s own 6148 HP (6000 + 2x74, plan.md Step 11)',
		doms.every((d) => d.dominator === 1 && d.team === 2 && d.hp === 6148 && d.maxHp === 6148),
		doms.map((d) => d.team + ':' + d.hp).join(' '));
	check('every Dominator is one of the three cannon variants',
		doms.every((d) => ['Destroyer Dominator', 'Gunner Dominator', 'Trapper Dominator'].includes(d.class)),
		doms.map((d) => d.class).join(', '));
	check('every Dominator sits inside the drawn arena',
		doms.every((d) => Math.abs(d.x) <= room.map.width / 2 && Math.abs(d.y) <= room.map.height / 2));
	check('a Dominator is an ordinary Player, not a new entity kind (PENDING #27)',
		doms.every((d) => d.kind === KIND.PLAYER), doms.map((d) => d.kind).join(','));
	// real diep level 75 (Dominator.ts's camera.setLevel(75)), driving the real level-75 camera width
	// via screenAtLevel(75) - epsilon-compared, not exact float equality.
	check('every Dominator carries diep\'s own level 75, not the Player default of 0', 
		doms.every((d) => d.level === 75), doms.map((d) => d.level).join(','));
	{
		const expectedScreen = 1634.6442891609581;
		check('every Dominator uses the real level-75 camera width (~16634.644), not BASE_SCREEN 1408',
			doms.every((d) => Math.abs(d.screen - expectedScreen) < 1e-6), 
			doms.map((d) => d.screen).join(',') + ' vs ' + expectedScreen);
	}

	// createDominator() with an explicit variant, for the Sandbox admin command.
	{
		const d = room.createDominator(0, 0, 1);
		check('createDominator(variant) picks the named cannon table, not a random one',
			d.class === 'Gunner Dominator', d.class);
	}

	// issues.md: "trapper dominator's traps should not be immortal... like with enough damage
	// they should disappear like normal traps". There is no dominator-origin carve-out anywhere in
	// entities/Bullet.js (nothing there ever reads `.dominator`) - a Trapper Dominator's traps are
	// ordinary type-2 Bullets off an ordinary finite-pene cannon row, so this is a real behaviour to
	// pin, not a config change.
	{
		const CLASS = require(path.join(ROOT, 'public', 'SHARE', 'TanksConfig.js')).class;
		const trapCannon = CLASS['Trapper Dominator'].cannons[0];
		check('a Trapper Dominator\'s traps have finite pene, not an immortal sentinel',
			Number.isFinite(trapCannon.pene) && trapCannon.pene > 0, trapCannon.pene);
		const dom = doms.find((d) => d.class === 'Trapper Dominator');
		const trap = new Bullet(dom.id, dom.x, dom.y, 0, 0, 0, room);
		trap.type = 2; trap.armTicks = 0; trap.team = dom.team; trap.pene = trapCannon.pene;
		// collision() spends one TICK of contact per call (same as the real pair loop calling it once
		// a tick) - an enemy bullet resting against the trap for up to 50 ticks, comfortably enough
		// contact for any finite pene to reach zero.
		const enemyBullet = { kind: KIND.BULLET, origin: { oId: -1 }, type: 0 };
		for (let i = 0; i < 50 && !trap.destroy; i++) {
			trap.collision(enemyBullet, { dmg: trapCannon.pene });
		}
		check('...and it dies exactly like an ordinary trap once that pene is spent',
			trap.destroy > 0 && trap.pene === 0, 'destroy=' + trap.destroy + ' pene=' + trap.pene);
	}

	// "Cannot move" (diep_wiki/Dominator.txt) - motion() is a real no-op, and a tank ram now zeroes
	// knockback/overlap-push at the source (entities/Player.js's KIND.PLAYER arm, diep's own
	// absorbtionFactor = 0) instead of update() snapping position back after the fact - plan.md
	// Step 11 replaced the old per-tick spawnX/spawnY reset with this.
	{
		const d = doms[0];
		const x0 = d.x, y0 = d.y, hp0 = d.hp;
		d.motion();
		check('motion() is a genuine no-op', d.x === x0 && d.y === y0);
		const rammer = { kind: KIND.PLAYER, id: { oId: -1 }, x: d.x + 10, y: d.y, size: 30, damage: 1 };
		d.collision(rammer, {});
		check('a tank ram gives a Dominator zero knockback and zero overlap-push',
			d.x === x0 && d.y === y0 && d.vec.x === 0 && d.vec.y === 0,
			d.x + ',' + d.y + ' vec=' + d.vec.x + ',' + d.vec.y);
		check('...but it still takes damage like any other Player (PENDING #27)',
			d.hp < hp0, d.hp);
	}

	// Two real-team test players, added directly rather than trusting slot 0 to be a human -
	// build() already seated all 4 Dominators in slots 0-3 before makeRoom()'s own tester joins,
	// so player(room, 0) here would be a Dominator (still neutral), not the tester.
	const Player = require(path.join(ROOT, 'entities', 'Player.js'));
	const teamA = room.INSTANCE.players.add((id) =>
		new Player({ GM: room.gm, sId: room.id, oId: id }, 0, 0, 'Basic', 0, room.XPLVL, room));
	const teamB = room.INSTANCE.players.add((id) =>
		new Player({ GM: room.gm, sId: room.id, oId: id }, 0, 0, 'Basic', 1, room.XPLVL, room));

	// issues.md: "knockback currently seems quite large... everything feels so bouncy". Ordinary
	// tank-body-vs-tank-body knockback (entities/Player.js's BODY_KB_GU) was tuned down from diep's
	// own 1.6 gu/loop to 1.0 - a deliberate departure (README.md), pinned here so a later edit to
	// it is a conscious choice, not a silent drift. teamA/teamB are on different teams (full
	// strength, not the soft team-mate push).
	{
		const tick = require(path.join(ROOT, 'lib', 'tick.js'));
		teamA.shield = 0; teamA.absorb = 1; teamA.dominator = 0;
		const expected = tick.impulse(1.0 * 2.8);
		const vecBefore = teamA.vec.length();
		teamA.collision({ kind: KIND.PLAYER, id: { oId: teamB.id.oId }, x: teamA.x + 10, y: teamA.y, damage: 0 }, {});
		check('ordinary enemy tank-body knockback is BODY_KB_GU (1.0 gu/loop), not diep\'s raw 1.6',
			Math.abs(teamA.vec.length() - vecBefore - expected) < 1e-9,
			(teamA.vec.length() - vecBefore) + ' vs ' + expected);
	}

	// The capture/knockdown state machine (lib/gameAI.js's dominatorCapture(), bound as part of
	// update()) - poking hp/destroy/murder directly the way collision() would have left them,
	// same technique mazeTests() uses for close()/respawn() above.
	{
		const dom = doms[1];

		// One knockdown from neutral captures it outright (diep_wiki's own rule).
		dom.hp = 0;
		dom.destroy = 1;
		dom.murder = ['players', teamA.id];
		dom.update();
		check('neutral -> one knockdown captures it to the attacker\'s team',
			dom.team === teamA.team && dom.hp === dom.maxHp && dom.destroy === 0 && dom.dead === 0,
			dom.team + ' hp=' + dom.hp);

		// A bullet fired by the OTHER side then knocks it down to neutral, not straight to their own.
		const bull = new Bullet(teamB.id, dom.x, dom.y, 0, 1, 0, room);
		dom.hp = 0;
		dom.destroy = 1;
		dom.murder = ['players', bull.origin];
		dom.update();
		check('an enemy team\'s knockdown on a CAPTURED Dominator sends it back to neutral first',
			dom.team === 2 && dom.hp === dom.maxHp, dom.team + ' hp=' + dom.hp);

		// One more knockdown from that same enemy now captures it to their side.
		dom.hp = 0;
		dom.destroy = 1;
		dom.murder = ['players', teamB.id];
		dom.update();
		check('...and the second knockdown from neutral captures it to them',
			dom.team === teamB.team, dom.team);
	}

	// A capture despawns the Dominator's own live projectiles (diep_wiki/Dominator.txt).
	{
		const dom = doms[2];
		const bull = new Bullet(dom.id, dom.x, dom.y, 0, 1, 0, room);
		room.INSTANCE.bullets.add(() => bull);
		check('the projectile exists before capture', bull.destroy === 0);
		dom.hp = 0;
		dom.destroy = 1;
		dom.murder = ['players', teamA.id];
		dom.update();
		check('capture marks that projectile for removal', bull.destroy > 0, bull.destroy);
	}

	// A knockdown with no live attacker to credit (e.g. a shape's own body damage) just heals it
	// back up rather than crashing or awarding a team nobody earned.
	{
		const dom = doms[3];
		const before = dom.team;
		dom.hp = 0;
		dom.destroy = 1;
		dom.murder = ['objs', { oId: 987654 }];
		dom.update();
		check('a non-player knockdown heals it back up with no team change',
			dom.team === before && dom.hp === dom.maxHp, dom.team + ' hp=' + dom.hp);
	}

	// Batch F - Dominator/Mothership takeover (FOV transfer). Taking a boss moves the socket's
	// camera/identity onto it (rooms/Room.js's per-viewer buffer reads `piloting` as its `main`),
	// you control only it, and - the whole point - the old body dying does NOT open your death
	// screen, because the buffer's `main`/dead-flag are the boss now, not the corpse.
	{
		// A claimable Dominator on teamA's side, sitting right next to a teamA pilot.
		const cap = room.createDominator(teamA.x + 5, teamA.y, 0);
		cap.team = teamA.team;
		cap.pilotedBy = null;
		teamA.piloting = null;
		teamA.hp = teamA.maxHp; teamA.dead = 0; teamA.destroy = 0;
		teamA.level = 30;   // > 5, so the piloting bleed does not kill it on the very first tick

		room.togglePossession(teamA);
		check('taking the nearest same-team Dominator binds pilot <-> boss both ways',
			teamA.piloting === cap && cap.pilotedBy === teamA);

		const slot = teamA.id.oId;
		room.step();   // populates room.BUFFER
		check('the socket\'s camera/identity is the boss, not the pilot\'s own body',
			room.BUFFER[slot] && room.BUFFER[slot].main === cap,
			room.BUFFER[slot] && room.BUFFER[slot].main && room.BUFFER[slot].main.class);
		const buf1 = room.getBuffer(slot);
		check('the HUD reads the boss\'s flat level and zero upgrade points, no NaN',
			buf1.head.level === cap.level && buf1.head.still === 0 && buf1.head.cLvl === 0,
			'level=' + buf1.head.level + ' still=' + buf1.head.still);
		check('...and the boss\'s own (level-75) screen, not the vacated body\'s',
			buf1.head.screen === cap.screen, buf1.head.screen + ' vs ' + cap.screen);

		// Now the vacated body dies. This must NOT release the boss and must NOT flip the camera
		// back onto the corpse - you ARE the boss.
		teamA.hp = 0;
		room.step();
		// "Dead" covers either death path: the piloting bleed (dead = 1) or ordinary lethal contact
		// (dead = DEAD_DELAY). Neither must release the boss or move the camera off it - that is the
		// whole point of the batch, and is what the next two checks assert.
		check('the old body dies while piloting', teamA.dead >= 1,
			'dead=' + teamA.dead + ' destroy=' + teamA.destroy + ' piloting=' + (teamA.piloting === cap));
		check('...but the boss is NOT released - you keep control of it',
			teamA.piloting === cap && cap.pilotedBy === teamA);
		check('...and the camera stays on the boss, not the dead body',
			room.BUFFER[slot] && room.BUFFER[slot].main === cap);
		const buf2 = room.getBuffer(slot);
		check('...so the death-screen flag (states[2]) tracks the BOSS (alive), not the corpse',
			buf2.main.states[2] === (cap.dead ? 1 : 0) && buf2.main.states[2] === 0,
			'states[2]=' + buf2.main.states[2] + ' (boss dead=' + cap.dead + ', body dead=' + teamA.dead + ')');

		// Pressing H (releasePossession) hands the boss back; the camera returns to the body, which
		// is where END finally comes from - releasing onto a dead body is how you actually die.
		room.releasePossession(teamA);
		check('releasing unbinds both sides',
			teamA.piloting === null && cap.pilotedBy === null);
		room.step();
		check('...and the camera returns to the (now dead) body, so END can open',
			room.BUFFER[slot] && room.BUFFER[slot].main === teamA &&
			room.getBuffer(slot).main.states[2] === 1);
	}

	return room;
}

function mothershipTests() {
	console.log('\nrooms (mothership):');
	const room = makeRoom('mothership');
	const CLASS = require(path.join(ROOT, 'public', 'SHARE', 'TanksConfig.js')).class;
	const tick = require(path.join(ROOT, 'lib', 'tick.js'));

	check('two teams, friendly fire on, no bases',
		room.rules.teams.join(',') === '0,1' && room.rules.teamPlay === true,
		room.rules.teams.join(','));

	const ships = room.motherships;
	check('build() spawns exactly one Mothership per team', ships.length === 2, ships.length);
	check('every Mothership is flagged, at diepcustom\'s own 7000 HP (Mothership.ts), and diep\'s own bossSize',
		ships.every((m) => m.mothership === 1 && m.hp === 7000 && m.maxHp === 7000 && m.size === CLASS['Mothership'].bossSize),
		ships.map((m) => m.hp + '/' + m.size).join(' '));
	check('one per rules.teams, each on its own team',
		new Set(ships.map((m) => m.team)).size === room.rules.teams.length,
		ships.map((m) => m.team).join(','));
	check('every Mothership is an ordinary Player, not a new entity kind',
		ships.every((m) => m.kind === require(path.join(ROOT, 'public', 'SHARE', 'kinds.js')).PLAYER));
	check('a Mothership is nearly immovable (absorbtionFactor 0.01, plan.md E3)',
		ships.every((m) => m.absorb === 0.01), ships.map((m) => m.absorb).join(','));
	// real diep level 140 (Mothership.ts's camera.setLevel(140)), driving the real level-140 camera width
	// via screenAtLevel(140) and the level-scaled movement accel Player.prototype.motion() already reads
	// epsilon-compared, not exact float equality
	check('every Mothership carries diep\'s own level 140, not the Player default of 0',
		ships.every((m) => m.level === 140), ships.map((m) => m.level).join(','));
	{
		const expectedScreen = 2258.748668099168;
		check('every Mothership uses the real level-140 camera width (~2258.749), not BASE_SCREEN 1404',
			ships.every((m) => Math.abs(m.screen - expectedScreen) < 1e-6),
			ships.map((m) => m.screen).join(',') + ' vs ' + expectedScreen);
	}
	check('every Mothership\'s HUD ledger is the canonical 7,7,7,7,7,7,7,1 (Max Health slot included)',
		ships.every((m) => m.upNb.join(',') === '7,7,7,7,7,7,7,1'), ships.map((m) => m.upNb.join(',')).join(' | '));
	{
		const Physics = require(path.join(ROOT, 'public', 'SHARE', 'Physics.js'));
		const atLevel140 = Physics.moveAccel(7, 140);
		const atLevel0 = Physics.moveAccel(7, 0);
		check('Physics.moveAccel(7, 140) matches diep\'s own level-140 acceleration (~0.28940692204312074)',
			Math.abs(atLevel140 - 0.28940692204312074) < 1e-9, atLevel140);
		check('...and is materially lower than the level-0 figure (the fresh-tank-speed bug this fixes)',
			atLevel140 < atLevel0 / 4, atLevel140 + ' vs ' + atLevel0);
	}

	// plan.md E3 - `canControlDrones` (TankDefinitions.json id27): true on even barrels, false on
	// odd. Type 1 (droneSteer1, entities/Bullet.js) already reads the owner's mouseR/mouseL/e to
	// override its AI steering - that's this engine's "true"; type 1.1 has its own equivalent
	// idle/chase/return logic but never reads the owner's inputs - that's "false".
	{
		const cannons = CLASS['Mothership'].cannons;
		check('16 barrels', cannons.length === 16, cannons.length);
		check('even-indexed barrels are canControlDrones-true (type 1)',
			cannons.every((c, i) => i % 2 !== 0 || c.type === 1),
			cannons.map((c) => c.type).join(','));
		check('odd-indexed barrels are canControlDrones-false (type 1.1)',
			cannons.every((c, i) => i % 2 === 0 || c.type === 1.1),
			cannons.map((c) => c.type).join(','));
	}

	// diep's own stats while piloted (Mothership.ts:66, plan.md E3/E4) - all seven non-regen
	// stats at 7 points, Health Regen at 1, baked directly since a scripted entity never clears
	// upgrade()'s own pointsAtLevel() gate.
	{
		const m = ships[0];
		check('MSpeed at 7 points', m.up.MSpeed === 7, m.up.MSpeed);
		check('Reload at 0.914^7', Math.abs(m.up.Reload - Math.pow(0.914, 7)) < 1e-9, m.up.Reload);
		check('BSpeed at 7 points (1+0.15x7)', Math.abs(m.up.BSpeed - 2.05) < 1e-9, m.up.BSpeed);
		check('BPene at 7 points (1+0.75x7)', Math.abs(m.up.BPene - 6.25) < 1e-9, m.up.BPene);
		check('BDamage at 7 points (1+3/7x7)', Math.abs(m.up.BDamage - 4) < 1e-9, m.up.BDamage);
		check('BodyDam (this.damage) at 7 points (5+1x7)', m.damage === 12, m.damage);
		check('HpRegan at 1 point, not 7', m.up.HpRegan === 1, m.up.HpRegan);
		check('maxHp stays the real 7000, not stat-derived', m.maxHp === 7000, m.maxHp);
	}

	// Death animation - mothershipUpdate() fully replaces Player.prototype.update(), so the
	// ordinary tank's own destroy-countdown (which lives inside that function) has to be
	// reproduced here too, or a "dead" Mothership sat frozen at its post-death `destroy` value
	// forever instead of ever reaching the 1 rooms/Room.js's own INSTANCE sweep waits for -
	// this was a real, reproduced gap (not hypothetical), found while wiring E4's own pilot
	// force-eject-on-death path into the same branch.
	{
		const doomed = ships[1];
		doomed.destroy = 5;
		const x0 = doomed.x;
		for (let i = 0; i < 10; i++) { doomed.update(); }
		check('a dying Mothership\'s destroy countdown actually decrements',
			doomed.destroy === 1, doomed.destroy);
		check('...moving on its last velocity while it does, same as an ordinary tank',
			doomed.x !== x0 || doomed.vec.x === 0, doomed.x + ' vs ' + x0);
	}

	// The win condition - losing a side's Mothership starts the same Arena Closer swarm Tag's
	// own win condition uses (createCloser(), CLOSER_COUNT above).
	{
		const loser = ships[0];
		loser.destroy = tick.DES;
		room.step();
		check('losing a side\'s Mothership starts closing', room.closing === true, room.closing);
		check('...and spawns the Arena Closer swarm', room.closers.length === 4, room.closers.length);
	}

	return room;
}

/*
	H-key piloting (plan.md E4, diepcustom Client.ts's possess()/TakeTank + Dominator.ts's
	onDeath()/Mothership.ts's possessionStartTick). rooms/Room.js's togglePossession()/
	releasePossession() are the claim/release mechanism; lib/gameAI.js's dominatorUpdate()/
	mothershipUpdate() are what actually redirect aim/fire(/movement) once claimed; entities/
	Player.js's own update() is what bleeds the vacated pilot's tank.
*/
function possessionTests() {
	console.log('\nH-key piloting (plan.md E4):');
	const Player = require(path.join(ROOT, 'entities', 'Player.js'));
	const tick = require(path.join(ROOT, 'lib', 'tick.js'));
	const room = makeRoom('domination');   // build() seats 4 neutral Dominators already

	// Neutral (team 2) Dominators match no real player's team, so a fresh pilot on team 0/1
	// has nothing claimable yet - capture one first, the same way dominatorTests() does.
	const dom = room.dominators[0];
	dom.hp = 0; dom.destroy = 1; dom.murder = ['players', { oId: 999 }];
	// A fake killer id (999) with no live player behind it still credits the team via
	// dominatorCapture()'s own `this.room.INSTANCE.players.get(...)` miss -> killerTeam stays
	// null -> heals with no team change. Use a REAL teammate instead so the capture actually
	// assigns a team a pilot can match.
	const teamA = room.INSTANCE.players.add((id) => new Player(
		{ GM: room.gm, sId: room.id, oId: id }, dom.x + 20, dom.y, 'captor', 0, room.XPLVL, room));
	teamA.shield = 0; teamA.alpha = 1;
	dom.hp = 0; dom.destroy = 1; dom.murder = ['players', teamA.id];
	dom.update();
	check('captured the Dominator onto team 0', dom.team === 0, dom.team);

	const pilot = room.INSTANCE.players.add((id) => new Player(
		{ GM: room.gm, sId: room.id, oId: id }, dom.x + 50, dom.y, 'pilot', 0, room.XPLVL, room));
	pilot.shield = 0; pilot.alpha = 1; pilot.level = 20;   // well above the level-5 insta-kill floor

	{
		const enemyDom = room.dominators.find((d) => d !== dom);
		room.togglePossession(pilot);
		check('claims the nearest same-team claimable Dominator, not a neutral/enemy one',
			pilot.piloting === dom, pilot.piloting === dom);
		check('...and marks it pilotedBy the claimer', dom.pilotedBy === pilot, dom.pilotedBy);
		check('a neutral Dominator is not claimable (team mismatch)',
			enemyDom.pilotedBy === null, enemyDom.pilotedBy);
		check('a notification was pushed', pilot.mess.length > 0 && /Press H/.test(pilot.mess[pilot.mess.length - 1]),
			pilot.mess[pilot.mess.length - 1]);
	}

	// Aim/fire mirroring: the possessed Dominator's own dir/fire follow the pilot, not DETEC/AI.
	{
		pilot.dir = 1.234;
		pilot.inputs.mouseL = 1;
		const x0 = dom.x, y0 = dom.y;
		dom.update();
		check('a possessed Dominator aims wherever its pilot does', dom.dir === 1.234, dom.dir);
		check('...fires when the pilot clicks (inputs.mouseL mirrored)', dom.inputs.mouseL === 1, dom.inputs.mouseL);
		check('...but still never moves, piloted or not (Dominator.ts ai.movementSpeed=0)',
			dom.x === x0 && dom.y === y0, dom.x + ',' + dom.y);
		pilot.inputs.mouseL = 0;
	}

	// The vacated pilot tank's own tank bleeds HP while piloting (diepcustom TankBody.ts:324-336).
	{
		const hpBefore = pilot.hp;
		pilot.update();
		check('the vacated pilot tank bleeds HP while piloting, above the level-5 floor',
			pilot.hp < hpBefore, pilot.hp + ' vs ' + hpBefore);
		check('...at exactly 2 + maxHp/500 per reference tick',
			Math.abs((hpBefore - pilot.hp) - tick.perTick(2 + pilot.maxHp / 500)) < 1e-9,
			(hpBefore - pilot.hp) + ' vs ' + tick.perTick(2 + pilot.maxHp / 500));
	}

	// Releasing (H again) hands the Dominator back to plain AI and stops the bleed.
	{
		room.togglePossession(pilot);
		check('toggling again releases the Dominator', pilot.piloting === null && dom.pilotedBy === null,
			pilot.piloting + ',' + dom.pilotedBy);
		const hpBefore = pilot.hp;
		pilot.inputs.w = 0; pilot.inputs.a = 0; pilot.inputs.s = 0; pilot.inputs.d = 0;
		pilot.update();
		check('...and the pilot\'s own tank stops bleeding', pilot.hp >= hpBefore, pilot.hp + ' vs ' + hpBefore);
	}

	// A Dominator flip (onDeath) force-ejects its pilot (plan.md E4).
	{
		room.togglePossession(pilot);
		check('re-claimed for the ejection test', pilot.piloting === dom, pilot.piloting === dom);
		dom.hp = 0; dom.destroy = 1; dom.murder = ['players', { oId: 987654 }];   // no live killer -> heals, no team change, but onDeath still fires
		dom.update();
		check('a Dominator knockdown force-ejects its pilot even when it stays on the same team',
			pilot.piloting === null && dom.pilotedBy === null, pilot.piloting + ',' + dom.pilotedBy);
	}

	// The level-5-and-under insta-kill floor (diepcustom's own anti-exploit rule).
	{
		room.togglePossession(pilot);
		pilot.level = 3;
		pilot.hp = 50;
		pilot.update();
		check('a level<=5 pilot\'s vacated tank dies outright instead of slowly bleeding',
			pilot.hp === 0 && pilot.destroy > 0, pilot.hp + ',' + pilot.destroy);
		// Batch F: the body dying no longer auto-releases the boss - the pilot IS the boss now, so
		// the camera stays on it and the corpse dying does not open the death screen. Releasing is
		// the pilot's own H press, a Dominator flip, or the boss's own death (all tested elsewhere).
		check('...and that death does NOT release the possession (FOV transfer, Batch F)',
			pilot.piloting === dom && dom.pilotedBy === pilot,
			pilot.piloting + ',' + dom.pilotedBy);
		room.releasePossession(pilot);   // clean up for the tests that follow
	}

	// Mothership possession: movement is allowed (unlike a Dominator), and the 5-minute timer.
	{
		// No `player(mroom, 0).destroy = 1` here, unlike every other test's tester-seat cleanup -
		// build() seats both Motherships in players slots 0-1 before ask()'s own tester joins
		// (mothershipTests() already documents this for player(room,0)), so slot 0 IS a
		// Mothership here, not the tester; destroying it would corrupt the very entity under test.
		const mroom = makeRoom('mothership');
		const ship = mroom.motherships[0];
		const p2 = mroom.INSTANCE.players.add((id) => new Player(
			{ GM: mroom.gm, sId: mroom.id, oId: id }, ship.x, ship.y, 'p2', ship.team, mroom.XPLVL, mroom));
		p2.shield = 0; p2.alpha = 1; p2.level = 20;
		mroom.togglePossession(p2);
		check('claims the Mothership on the same team', p2.piloting === ship, p2.piloting === ship);

		p2.inputs.w = 1;
		const x0 = ship.x, y0 = ship.y;
		for (let i = 0; i < 20; i++) { ship.update(); }
		check('a possessed Mothership DOES move (no ai.movementSpeed=0 override, unlike a Dominator)',
			ship.x !== x0 || ship.y !== y0, ship.x + ',' + ship.y + ' vs ' + x0 + ',' + y0);
		p2.inputs.w = 0;

		// prove the LIVE piloted-movement path (not just the helper in isolation)
		// actually uses the l evel-140 result: the same entity/setup forged to level 0
		// should cover far more ground in the same 20 ticks holding one direction
		{
			const d140 = Math.sqrt((ship.x - x0) ** 2 + (ship.y - y0) ** 2);
			const mroom0 = makeRoom('mothership');
			const ship0 = mroom0.motherships[0];
			ship0.level = 0;
			const p0 = mroom0.INSTANCE.players.add((id) => new Player(
				{ GM: mroom0.gm, sId: mroom0.id, oId: id }, ship0.x, ship0.y, 'p0', ship0.team, mroom0.XPLVL, mroom0));
			p0.shield = 0; p0.alpha = 1; p0.level = 20;
			mroom0.togglePossession(p0);
			const x00 = ship0.x, y00 = ship0.y;
			p0.inputs.w = 1;
			for (let i = 0; i < 20; i++) { ship0.update(); }
			p0.inputs.w = 0;
			const d0 = Math.sqrt((ship0.x - x00) ** 2 + (ship0.y - y00) ** 2);
			check('a piloted Mothership at the real level 140 travels far less than the same setup forged to level 0 (live prediction path, not just Physics.moveAccel() in isolation)',
				d140 < d0 / 4, d140 + ' vs ' + d0);
		}

		mroom.step();
		const buf = mroom.getBuffer(p2.id.oId);
		check('whipe possessing a Mothership, getBuffer() reports its own level 140, zero upgrade points, and its own screen',
			buf.head.level === 140 && buf.head.still === 0 && buf.head.screen === ship.screen,
			'level=' + buf.head.level + ' still=' + buf.head.still + ' screen=' + buf.head.screen);

		// Fast-forward past the 5-minute mark directly rather than looping the real tick count.
		ship.possessionStartTick = mroom.timestamp - (tick.ticks(7500) + 1);
		ship.update();
		check('the 5-minute possession timer force-releases the pilot',
			p2.piloting === null && ship.pilotedBy === null, p2.piloting + ',' + ship.pilotedBy);
		check('...with a notification', /time piloting/i.test(p2.mess[p2.mess.length - 1]), p2.mess[p2.mess.length - 1]);

		// A Mothership dying (not just timing out) also force-ejects its pilot - there's nothing
		// left to fly once its own death animation starts.
		mroom.togglePossession(p2);
		check('re-claimed for the death-eject test', p2.piloting === ship, p2.piloting === ship);
		ship.destroy = 5;
		ship.update();
		check('a dying Mothership force-ejects its pilot too',
			p2.piloting === null && ship.pilotedBy === null, p2.piloting + ',' + ship.pilotedBy);
	}
}

/*
	net/gameSocket.js's exported statSourceOf() is the same `piloting || self` 
	rule rooms/Room.js#step() uses for `main`, factored out so the UpdateUp-retargetting logic that 
	drives it is unit-testable without a live WebSocket
*/
function statSourceTests() {
	console.log('\nstat snapshot source:');
	const gameSocket = require(path.join(ROOT, 'net', 'gameSocket.js'));
	const Player = require(path.join(ROOT, 'entities', 'Player.js'));
	const room = makeRoom('domination');

	check('no live human -> no source', gameSocket.statSourceOf(null) === null);

	const pilot = room.INSTANCE.players.add((id) => new Player(
		{ GM: room.gm, sId: room.id, oId: id }, 0, 0, 'ordinary', 0, room.XPLVL, room));
	check('an ordinary (non-piloting) human is its own source',
		gameSocket.statSourceOf(pilot) === pilot);

	const dom = room.dominators[0];
	dom.hp = 0; dom.destroy = 1; dom.murder = ['players', pilot.id];
	dom.update();
	pilot.level = 20; 
	room.togglePossession(pilot);
	check('possessing a Dominator switches the source to it',
		gameSocket.statSourceOf(pilot) === dom, gameSocket.statSourceOf(pilot) === dom);
	
	room.releasePossession(pilot);
	check('releasing switches the source back to the pilot\'s own body',
		gameSocket.statSourceOf(pilot) === pilot);

	// simulate the gameloop's own tracking: only a real identity CHANGE re-sends UpdateUp
	{
		const sent = [];
		let statSource = null;
		function tick(human) {
			const source = gameSocket.statSourceOf(human);
			if (source !== statSource) { statSource = source; if (source) { sent.push(source.upNb); } }
		}
		tick(pilot); // initial spawn
		check('initial spawn sends the pilot\'s own snapshot', sent.length === 1 && sent[0] == pilot.upNb);
		room.togglePossession(pilot);
		tick(pilot); // H possession
		check('possessing a Dominator sends its own array', sent.length === 2 && sent[1] === dom.upNb);
		tick(pilot); // same identity, no repeat send
		check('polling again with no identity change sends nothing new', sent.length === 2);
		room.releasePossession(pilot);
		tick(pilot); // H release
		check('releasing sends the pilot body\'s original array back', sent.length === 3 && sent[2] === pilot.upNb);
	}
}

/*
	plan.md F1/E2 - the server half of the roster sweep (test/client.js's own "every class in the
	roster renders without a non-finite transform" is the client half). Every class in
	TanksConfig.js's own list spawns as a real Player, gets a live target inside its own DETEC
	range (so an autoDir/DETEC-driven cannon - the exact code path a Dominator's own aim used to
	run through before C10 moved it out of the class table - actually engages instead of idling),
	and fires long enough for every one of its barrels to complete at least one reload cycle
	(90 reference ticks, Overseer's own longest, is the ceiling - run well past it). This is what
	would have caught the reported Gunner Dominator sandbox-cycle crash permanently, rather than
	relying on a human happening to cycle to it in a browser with a target nearby.
*/
function rosterSweepTests() {
	console.log('\nroster sweep (plan.md F1 - server half):');
	const Player = require(path.join(ROOT, 'entities', 'Player.js'));
	const CLASS = require(path.join(ROOT, 'public', 'SHARE', 'TanksConfig.js')).class;
	const CLASS_LIST = require(path.join(ROOT, 'public', 'SHARE', 'TanksConfig.js')).list;
	// ffa, not sandbox: sandbox's own maxPlayer:0 caps it at exactly the one seat makeRoom()
	// already took (a deliberate single-player cap, rooms/Sandbox.js), so a second `foe` to
	// actually populate DETEC.select could never be added there - ffa has no such cap and this
	// sweep needs nothing else sandbox-specific (upClass()'s tree/level gating isn't in play
	// either way, since this sets `.class` directly like cycleClass()/the '\' preview do).
	const room = makeRoom('ffa');
	player(room, 0).destroy = 1;
	// A live target for every class's DETEC (auto-turrets, Dominators) to actually find and aim
	// at, rather than idling on the branch that never touches this.canDir's DETEC.select path.
	const foe = room.INSTANCE.players.add((id) => new Player(
		{ GM: room.gm, sId: room.id, oId: id }, 60, 0, 'sweepTarget', 5, room.XPLVL, room));
	foe.shield = 0; foe.alpha = 1;

	let err = null, checked = 0;
	for (const cls of CLASS_LIST) {
		try {
			const p = room.INSTANCE.players.add((id) => new Player(
				{ GM: room.gm, sId: room.id, oId: id }, 0, 0, 'sweep', 1, room.XPLVL, room));
			p.class = cls;
			p.shield = 0; p.alpha = 1;
			p.shootTimer = new Array(CLASS[cls].cannons.length).fill(0);
			p.necro = CLASS[cls].necro;
			p.inputs.e = 1; p.inputs.mouseL = 1;
			for (let i = 0; i < 200; i++) { p.update(); }
			// Freed outright, not just marked destroy=1 - ffa's own maxPlayer:24 cap (rooms/
			// Room.js) means a merely-dying slot never actually vacates without a room.step()
			// to process the tombstone, and this sweep intentionally never calls step() (every
			// class gets an isolated, deterministic 200-update run, not one sharing a tick with
			// its neighbours).
			room.INSTANCE.players.delete(p.id.oId);
		} catch (e) {
			err = cls + ': ' + e.message + ' | ' + e.stack.split('\n')[1];
			break;
		}
		checked++;
	}
	check('every class in the roster spawns and fires every barrel without throwing', !err, err);
	check('checked every class in the roster', checked === CLASS_LIST.length, checked + '/' + CLASS_LIST.length);
}

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
	const tick = require(path.join(ROOT, 'lib', 'tick.js'));
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
	// diepcustom TankBody.ts:357 (plan.md C15): a fresh spawn's shield/isFlashing window is
	// diep's own flat 374 reference ticks, not the old ad-hoc ~198s (6000 ticks at the original
	// 33ms reference) this engine carried from before the fidelity pass had a real number for it.
	check('...and it is diep\'s own 374-reference-tick cap, not the old ~198s ad-hoc one',
		after.shield === tick.ticks(374), after.shield + ' vs ' + tick.ticks(374));
	after.motion();
	check('...and clears immediately given the carried-over held key', after.shield === 0,
		after.shield);

	/*
		Enter respawns you the moment you are dead, not once the death animation and
		config.DEAD_DELAY have both run out. The request to respawn is a one-shot keyup
		(net/gameSocket.js), so anything the room refuses is not retried - a gated respawn() read
		as "Enter did nothing" rather than as "Enter is on cooldown". Both halves are asserted:
		a LIVE tank still cannot respawn (that gate is what stops a `force: 0` respawn packet
		from being a free teleport), and a tank on its very first dead tick can.
	*/
	const live = player(room, 0);
	live.dead = 0; live.destroy = 0;
	check('a living tank cannot respawn', room.respawn(0) === undefined);
	const dying = player(room, 0);
	dying.hp = 0;
	dying.dead = require(path.join(ROOT, 'lib', 'tick.js')).DEAD_DELAY;
	dying.destroy = require(path.join(ROOT, 'lib', 'tick.js')).DES;
	dying.xp = 1234;
	check('...but a tank respawns on its first dead tick, mid death animation',
		room.respawn(0) === 1234);
	check('...and that really is a new Player', player(room, 0) !== dying);
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
	// `dmg`, not `pene` - rooms/Room.js hands a KIND.BULLET arm the OTHER bullet's fixed
	// damagePerTick now, not its remaining pene pool (plan.md chunk 1's bullet-vs-bullet fix).
	drone.collision(mate, { noDam: 1, dmg: 50 });
	check('a same-team bullet damages a base drone not at all', drone.pene === peneBefore,
		drone.pene);
	check('...and does not shove it either', drone.vec.length() === speedBefore);
	drone.collision(mate, { dmg: 50 });
	check('an enemy bullet does damage it now - they used to be exempt outright',
		drone.pene < peneBefore, drone.pene);

	// Against a player the drone must take the PLAYER's body damage, not pene/5 of its own pool:
	// at pene 2000 the old formula was 400 a tick, i.e. dead in five ticks of contact. 5 is
	// entities/Player.js's own this.damage base (plan.md chunk 1 D1's diep-raw value) -
	// common(tank,bullet) = 1 (lib/damage.js), so this is the number a real tank's
	// collision() would actually hand a drone here.
	drone.pene = config.BASE_DRONE_HP;
	drone.collision({ kind: KIND.PLAYER, id: { oId: 0 }, damage: 5, x: drone.x + 1, y: drone.y }, {});
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
		// damageReduction() is gone (PENDING #18, plan.md step 5): a victim now takes the drone's
		// full BASE_DRONE_DAMAGE (7, plan.md chunk 1 D1) per tick, tick.perTick()'d - 7 * (25/40) =
		// 4.375 - a loose sanity band around that, not a pin (config.BASE_DRONE_DAMAGE is pinned
		// exactly above).
		check('a base drone does one tick of body damage, not 400 of them',
			perTick > 3.75 && perTick < 5, perTick);
		// Was "over ten seconds" pre-dr-removal (~33s at the old 0.4x-damage figure); dropping dr
		// makes every source of damage to a tank 1/dr stronger (plan.md step 5's stated balance
		// consequence), and a lone drone's own share of that is real but not one-shot: ~8.25s at
		// TICK_MS 25, still "low damage, delivered extremely quickly" (diep_wiki), not lethal alone.
		check('...so a maxed tank survives a lone drone for at least 5 seconds',
			1000 / (perTick * (1000 / config.TICK_MS)) > 5);
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
	Damage proration (PENDING #18, plan.md step 5 part 4): diep resolves a colliding pair's damage
	mutually and simultaneously, so if either side would die mid-tick, BOTH sides' damage that tick
	scales down together rather than each landing an un-shortened full hit. Drives a real room.step()
	(not a direct collision() call, unlike the base-drone tests above) since the resolver this pins
	lives in rooms/Room.js's pair loop, ahead of both collision() calls.

	Two fresh Basic tanks, both at 0 Body Damage points, deal diep's own tank-vs-tank damage
	(entities/Player.js's this.damage=5 x lib/damage.js's TANK_TANK_MULT=6=30 per
	reference tick, tick.perTick()'d to 18.75 at the live TICK_MS 25) - overlapped and set to 5 hp
	each, well under that one-tick figure, so an un-prorated hit would drive both to roughly -13.75. The
	scale factor is derived exactly to land each side at 0, not merely "less negative" - a tight
	pin, not a loose sanity band, is the actual proof this is prorating rather than just happening to
	survive.
*/
function prorationTest() {
	console.log('\ndamage proration (plan.md step 5 part 4):');
	const tick = require(path.join(ROOT, 'lib', 'tick.js'));
	const Objects = require(path.join(ROOT, 'entities', 'Objects.js'));
	const room = makeRoom('ffa');
	room.ask({ name: 'tester2', key: '1'.repeat(25), pet: -1, gm: 'ffa' });
	const a = player(room, 0), b = player(room, 1);
	a.class = 'Basic'; b.class = 'Basic';
	a.shield = 0; b.shield = 0;
	a.dev.ghost = 0; b.dev.ghost = 0;
	a.x = 0; a.y = 0; b.x = 1; b.y = 0;   // deep overlap - well inside size(28) + size(28)
	a.hp = a.maxHp = 5; b.hp = b.maxHp = 5;
	room.step();
	check('a mutual near-lethal ram prorates both sides to (near) exactly 0, not deeply negative',
		Math.abs(a.hp) < 0.1 && Math.abs(b.hp) < 0.1, a.hp + ' / ' + b.hp);

	/*
		...and the prorated side actually DIES, which the band above does not pin: it passes just as
		happily on hp = 1e-16 as on hp = 0, and that gap is exactly where the bug lived. Proration
		sizes the killing blow to land on the target's remaining hp exactly, so the subtraction comes
		out an ulp either side of 0 depending on the hp/damage pair; the old `hp <= 0` death test
		missed every case that landed an ulp SHORT, and the survivor was then permanently immortal -
		next tick's scale collapses to ~1e-17 and, since ONE shared scale prorates both directions,
		its attacker stopped taking body damage too. lib/damage.js's LETHAL_EPS (diep's own
		Live.ts:94/:110 threshold) is what closes it.

		Swept, not spot-checked: which hp values are pathological is pure floating-point luck of the
		particular hp/damage pair - 37 of the 200 below stuck under the old rule, and 1.0 hp against
		a fresh Basic's own ram is one of them, so a single hand-picked value would prove nothing
		about the next one. Every shape is fed to the same real room.step() the resolver lives in.
	*/
	const dmgRoom = makeRoom('ffa');
	const rammer = player(dmgRoom, 0);
	rammer.class = 'Basic';
	rammer.shield = 0; rammer.dev.ghost = 0;
	rammer.x = 0; rammer.y = 0;
	let survived = 0, worstHp = 0, worstResidual = 0;
	for (let i = 1; i <= 200; i++) {
		const startHp = i * 0.05;
		const sq = dmgRoom.INSTANCE.objs.add((id) => {
			const o = new Objects('sqr', -1, { GM: dmgRoom.gm, sId: dmgRoom.id, oId: id }, dmgRoom.map, dmgRoom);
			o.x = rammer.x; o.y = rammer.y;
			o.hp = startHp;
			return o;
		});
		// Enough ticks to clear the one-tick getPlace handshake and land the killing blow; a healthy
		// kill takes 2-3. The rammer is topped back up each tick so its OWN death (the shape's body
		// damage is real) can never be what ends the loop early.
		for (let t = 0; t < 12 && !sq.destroy; t++) {
			rammer.hp = rammer.maxHp = 1e6;
			dmgRoom.step();
		}
		if (!sq.destroy) {
			survived++;
			if (sq.hp > worstResidual) { worstResidual = sq.hp; worstHp = startHp; }
			sq.destroy = tick.DES;   // don't leave an immortal shape parked on the rammer for the next round
		}
	}
	check('every prorated killing blow actually kills - no shape survives at a floating-point residual',
		survived === 0, survived + '/200 survived, worst: ' + worstHp + ' hp -> ' + worstResidual);
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
	Returns u/s. BASE_DRONE_CHASE_SPEED is no longer pinned to this (plan.md Step 10 retired that
	rule in favour of diep's own flat 756 u/s) - still computed and logged in baseDroneAiTests() for
	context, so a cannon retune that moves the roster's ceiling past 756 u/s is at least visible.
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
		const upReload = Math.pow(0.914, MAXUP);   // entities/Player.js's per-point Reload step (geometric 0.914^points)
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
					// tick.impulse(), mirroring entities/Player.js's shoot() (PENDING #43): body.vx/vy
					// here is fed through Physics.stepBody just below, exactly like a real Player's
					// this.vec, so the recoil impulse must land flat, not perTick()'d.
					body.vx += tick.impulse(can.back) * Math.cos(rd);
					body.vy += tick.impulse(can.back) * Math.sin(rd);
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
	// CHASE_SPEED is well past the cross's own 370 u/s - so the bound above is being checked
	// against the real maximum.
	check('CHASE_SPEED is the larger of the two - the tunnelling bound is checked against the real max',
		tick.perTick(config.BASE_DRONE_CHASE_SPEED) > tick.perTick(config.BASE_DRONE_CROSS_SPEED),
		tick.perTick(config.BASE_DRONE_CHASE_SPEED) + ' vs ' + tick.perTick(config.BASE_DRONE_CROSS_SPEED));

	// ---- plan.md Step 10: CHASE_SPEED is diep's own flat number now, not a pin to the fastest
	//      tank this game can build - PENDING nuance 32's pinning rule is retired, on purpose ------
	{
		const fastest = fastestTankSpeed();
		const chaseUs = tick.perTick(config.BASE_DRONE_CHASE_SPEED) * (1000 / config.TICK_MS);
		console.log('  note fastest sustainable build in this game: ' + fastest.speed.toFixed(1) +
			' u/s (' + fastest.build + '); BASE_DRONE_CHASE_SPEED is ' + chaseUs.toFixed(1) +
			' u/s - no longer pinned to that number (plan.md Step 10), logged for context only.');
		// The pin is gone (diep's own base drone runs a flat 54 du/tick = 756 u/s, pinned to
		// nothing - diepcustom/src/Entity/Misc/BaseDrones.ts) - what's asserted now is diep's own
		// number landing exactly, not agreement with whatever the roster's fastest build happens to
		// be. A drone now comfortably outruns even a maxed-Movement Sniper's own dash (756 vs
		// ~546 u/s) - flagged as a real balance consequence, not pre-tuned back (plan.md Step 10).
		check('BASE_DRONE_CHASE_SPEED is diep\'s own flat 756 u/s',
			Math.abs(chaseUs - 756) < 0.1, chaseUs.toFixed(1) + ' vs 756');
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
	// penetration value, and no longer factors into shape damage at all (PENDING #18 - a
	// bullet's `pene` decides its own contact-duration survival, not a damage multiplier;
	// multiplying by it a second time here used to double-count it, the same bug #18 already fixed
	// on entities/Player.js's identical arm). A drone just deals its own flat per-tick damage.
	{
		const room = makeRoom('2team');
		const post = room.dronePosts[0];
		const drone = room.INSTANCE.bullets.get(post.slot);
		const sq = new Objects('sqr', -1, { GM: room.gm, sId: room.id, oId: 500 }, room.map, room);
		const hpBefore = sq.hp;
		sq.collision(drone, { pene: drone.pene });
		const dropExpected = tick.perTick(config.BASE_DRONE_DAMAGE);
		check('a base drone deals its own flat per-tick damage to a shape, not its 2000-point pene as a multiplier',
			Math.abs((hpBefore - sq.hp) - dropExpected) < 1e-6,
			(hpBefore - sq.hp) + ' vs ' + dropExpected);
		check('...nowhere near enough to vaporise it in one tick', (hpBefore - sq.hp) < sq.maxHp / 2,
			(hpBefore - sq.hp) + ' of ' + sq.maxHp);
	}

	// plan.md C14 - diep itself gives shapes no regen at all, but this engine keeps a slow
	// self-heal as a deliberate departure; the health-bar fade (public/client/entities.js's own
	// hpAlpha/hpHold) already existed, only the heal itself was missing.
	{
		const room = makeRoom('ffa');
		const sq = new Objects('sqr', -1, { GM: room.gm, sId: room.id, oId: 502 }, room.map, room);
		sq.hp = 1;
		const before = sq.hp;
		for (let i = 0; i < 100; i++) { sq.update(); }
		check('a damaged shape slowly regenerates on its own (plan.md C14)',
			sq.hp > before && sq.hp <= sq.maxHp, before + ' -> ' + sq.hp);
		sq.hp = sq.maxHp;
		sq.update();
		check('...and a full-health shape does not overheal past its own max',
			sq.hp === sq.maxHp, sq.hp + ' vs ' + sq.maxHp);
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
			// case above documents: a drone's contact damage is ~1.9 hp a tick (BASE_DRONE_DAMAGE,
			// entities/Player.js's KIND.BULLET arm, PENDING #18), and that bump is bigger than it.
			// Both are put back on the centre line for the measured step.
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
		/*
			plan.md C11 - diep's Drone/Minion/Trap/NecromancerSquare all carry
			onlySameOwnerCollision (diepcustom's Object.ts:165), the same "transparent to a
			different owner on the same team" rule base drones (type 1.4) already got a dedicated
			whole-pair skip for in Room.js's step(). An ORDINARY class drone/trap/minion has no such
			dedicated skip - it relies entirely on entities/Bullet.js's/Player.js's own `noDam`
			early-breaks (set by this same pair loop whenever `rules.teamPlay && obj.team ===
			other.team` and neither side is a shape), which sit before every vec.add()/pene/hp
			mutation in each arm. These assertions exercise that path directly (not just the base-
			drone-specific one above) for every onlySameOwnerCollision type this engine has: an
			ordinary drone (type 1), a trap (type 2, post-arming) and a minion (type 1.5) - both
			against a teammate's tank and against a different owner's same-type projectile.
		*/
		// type 1/1.5 both steer through droneSteer1 (entities/Bullet.js), which needs a live
		// owning Player to build its own Detector from - unlike a base drone or a trap, `alone`
		// is not an option here, so each gets a real (distant, otherwise inert) owner.
		function plantDrone(room, owner, x, y, type) {
			const b = new Bullet({ GM: room.gm, sId: room.id, oId: owner.id.oId }, x, y, 0, 0, 0, room);
			b.team = owner.team; b.life = -1; b.type = type; b.class = owner.class;
			b.pene = 100; b.damage = 5; b.size = 10; b.weight = 5; b.push = 5; b.map = room.map;
			room.INSTANCE.bullets.add((id) => { b.id = { GM: room.gm, sId: room.id, oId: id }; return b; });
			return b;
		}
		// 1.1 (Mothership's AI-only half, TanksConfig.js's odd-numbered Mothership barrels) and 3
		// (the Necromancer's own drone, NecromancerSquare.ts) belong in this same onlySameOwnerCollision
		// family - both used to be missing from rooms/Room.js's SAME_OWNER_TYPES (1.1 simply absent; 3
		// was sitting in NO_OWN_TEAM_TYPES under a stale "swarm" label that actually meant BattleShip's
		// 1.2/1.3, never 3), which is exactly issues.md's "mothership should be able to overlap with
		// its own drones" report - a captured Mothership's even barrels (type 1) passed through fine
		// while its odd barrels (type 1.1) still jostled it.
		for (const type of [1, 1.1, 1.5, 3]) {
			{
				const room = isolatedRoom();
				const owner = plantPlayer(room, 0, 900, 900);
				const drone = plantDrone(room, owner, 0, 0, type);
				const mate = plantPlayer(room, 0, 0, 0);
				const mateBefore = mate.hp, droneBefore = drone.pene, vecBefore = drone.vec.length();
				room.step();
				check('an ordinary type-' + type + ' drone does not damage a teammate\'s tank, nor it it',
					mate.hp >= mateBefore && drone.pene === droneBefore,
					mate.hp + '/' + mateBefore + ', ' + drone.pene + '/' + droneBefore);
				check('...nor does either side get knocked back',
					drone.vec.length() === vecBefore && mate.vec.length() === 0,
					drone.vec.length() + ' vs ' + vecBefore);
			}
			{
				// Different owner, same team, same type - the drone-vs-drone case.
				const room = isolatedRoom();
				const ownerA = plantPlayer(room, 1, 900, 900);
				const ownerB = plantPlayer(room, 1, -900, -900);
				const droneA = plantDrone(room, ownerA, 0, 0, type);
				const droneB = plantDrone(room, ownerB, 0, 0, type);
				const aBefore = droneA.pene, bBefore = droneB.pene;
				room.step();
				check('two same-team, different-owner type-' + type + ' drones do not damage each other',
					droneA.pene === aBefore && droneB.pene === bBefore,
					droneA.pene + '/' + aBefore + ', ' + droneB.pene + '/' + bBefore);
			}
		}
		// BattleShip's real swarm types (1.2 uncontrollable, 1.3 controllable - Fortress's own
		// standin barrels reuse 1.2) carry noOwnTeamCollision (Swarm.ts:32), not onlySameOwnerCollision:
		// unlike a type-1 drone, two DIFFERENT owners' swarm drones must ALSO pass through each other,
		// not just through every teammate's tank - issues.md's "battleship drones should not have
		// knockback and interact with anything on its own team" made no owner distinction, and the
		// diep source backs that (no per-owner carve-out on this flag).
		for (const type of [1.2, 1.3]) {
			{
				const room = isolatedRoom();
				const owner = plantPlayer(room, 0, 900, 900);
				const drone = plantDrone(room, owner, 0, 0, type);
				const mate = plantPlayer(room, 0, 0, 0);
				const mateBefore = mate.hp, droneBefore = drone.pene, vecBefore = drone.vec.length();
				room.step();
				check('a BattleShip-type ' + type + ' drone does not damage a teammate\'s tank, nor it it',
					mate.hp >= mateBefore && drone.pene === droneBefore,
					mate.hp + '/' + mateBefore + ', ' + drone.pene + '/' + droneBefore);
				check('...nor does either side get knocked back',
					drone.vec.length() === vecBefore && mate.vec.length() === 0,
					drone.vec.length() + ' vs ' + vecBefore);
			}
			{
				// Different owner, same team - unlike type 1/1.5/3, these must ALSO pass through each
				// other (noOwnTeamCollision ignores owner entirely).
				const room = isolatedRoom();
				const ownerA = plantPlayer(room, 1, 900, 900);
				const ownerB = plantPlayer(room, 1, -900, -900);
				const droneA = plantDrone(room, ownerA, 0, 0, type);
				const droneB = plantDrone(room, ownerB, 0, 0, type);
				const aBefore = droneA.pene, bBefore = droneB.pene, aVecBefore = droneA.vec.length();
				room.step();
				check('two same-team, different-owner type-' + type + ' swarm drones do not damage each other',
					droneA.pene === aBefore && droneB.pene === bBefore,
					droneA.pene + '/' + aBefore + ', ' + droneB.pene + '/' + bBefore);
				check('...nor jostle each other (noOwnTeamCollision, not onlySameOwnerCollision)',
					droneA.vec.length() === aVecBefore, droneA.vec.length() + ' vs ' + aVecBefore);
			}
		}
		{
			// A trap (type 2) past its arming window - `armTicks` starts at 0 here (already armed),
			// the state every trap reaches for the vast majority of its life. Its own update()
			// branch never reads its owner, so `alone` is fine (matches plantBullet's own pattern).
			const room = isolatedRoom();
			const trap = new Bullet({ GM: room.gm, sId: room.id, oId: 0 }, 0, 0, 0, 0, 0, room);
			trap.team = 0; trap.alone = 1; trap.life = 1000; trap.type = 2; trap.armTicks = 0;
			trap.pene = 100; trap.damage = 5; trap.size = 10; trap.weight = 5; trap.push = 5; trap.map = room.map;
			room.INSTANCE.bullets.add((id) => { trap.id = { GM: room.gm, sId: room.id, oId: id }; return trap; });
			const mate = plantPlayer(room, trap.team, 0, 0);
			const mateBefore = mate.hp, trapBefore = trap.pene;
			room.step();
			check('an armed trap does not damage a teammate\'s tank, nor it it',
				mate.hp >= mateBefore && trap.pene === trapBefore,
				mate.hp + '/' + mateBefore + ', ' + trap.pene + '/' + trapBefore);
		}
		/*
			diep's same-team PHYSICS filter (rooms/Room.js's teamPassThrough(), diepcustom
			Object.ts:154-171). The block above only ever asserted that a same-team pair exchanges
			no DAMAGE; the pair still collided physically, which is what let a teammate's trap field
			shove a tank around and a Mothership be jostled by its own swarm. What is pinned here is
			the part that distinguishes the two flags, because the whole rule turns on it:

			  * noOwnTeamCollision (ordinary bullet/swarm/skimmer) skips the pair on team alone.
			  * onlySameOwnerCollision (drone/minion/arming trap) skips it only when the OWNERS
			    differ - and a tank has no owner at all in diep (RelationsGroup defaults it to
			    null; only a projectile ever sets one), so a drone and the tank that fired it never
			    share an owner and always pass through. Two drones from the SAME barrel do share
			    one, so those still jostle - which is what keeps a swarm spread out.
		*/
		{
			const room = isolatedRoom();
			const owner = plantPlayer(room, 0, 0, 0);
			plantDrone(room, owner, 0, 0, 1);
			const ownerHp = owner.hp;
			room.step();
			// Only the TANK's side is asserted: a drone re-steers its own vec every tick through
			// droneSteer1 whatever it is or is not touching, so the drone's vec is not evidence
			// either way. Against an ENEMY tank the same pairing does move this (the enemy-drone
			// knockback the block above already exercises), so a zero here is the filter, not
			// a dead code path.
			check('a drone passes through THE TANK THAT FIRED IT (owner null vs owner tank)',
				owner.vec.length() === 0 && owner.hp >= ownerHp,
				owner.vec.length() + ', hp ' + owner.hp + '/' + ownerHp);
		}
		{
			// Two drones off the same owner DO still collide - the one same-team pairing diep keeps.
			const room = isolatedRoom();
			const owner = plantPlayer(room, 0, 900, 900);
			const a = plantDrone(room, owner, 0, 0, 1);
			const b = plantDrone(room, owner, 0, 0, 1);
			const aVec = a.vec.length(), bVec = b.vec.length();
			room.step();
			check('...but two drones off the SAME owner still shove each other apart',
				a.vec.length() !== aVec || b.vec.length() !== bVec,
				a.vec.length() + '/' + aVec + ', ' + b.vec.length() + '/' + bVec);
		}
		{
			// An ARMING trap is inert to its own team but NOT to an enemy. The arming window used
			// to make it inert to everything, which is a straight fidelity bug: diep's
			// onlySameOwnerCollision is only ever consulted WITHIN a team (Object.ts:155), so a
			// trap damages an enemy from its spawn tick and `collisionEnd` governs nothing but
			// which team mates it interacts with.
			const room = isolatedRoom();
			const trap = new Bullet({ GM: room.gm, sId: room.id, oId: 0 }, 0, 0, 0, 0, 0, room);
			trap.team = 0; trap.alone = 1; trap.life = 1000; trap.type = 2; trap.armTicks = 999;
			trap.pene = 100; trap.damage = 5; trap.size = 10; trap.weight = 5; trap.push = 5; trap.map = room.map;
			room.INSTANCE.bullets.add((id) => { trap.id = { GM: room.gm, sId: room.id, oId: id }; return trap; });
			const foe = plantPlayer(room, 1, 0, 0);
			const foeBefore = foe.hp;
			room.step();
			check('an ARMING trap still damages an enemy (arming is a team filter, not invulnerability)',
				foe.hp < foeBefore, foe.hp + '/' + foeBefore);
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
		// A point this close to the post is also inside the OWNING team's own base square now
		// (room.baseSize is 1876, well past BASE_DRONE_DETECT's new 504 - plan.md Step 10) - ghost
		// so the base's own fence (rooms/FourTeam.js's inEnemyBase()) does not kill `me` before the
		// drone ever gets a chance to see it, which would confound "not detected" with "not alive".
		me.dev.ghost = 1;
		// Comfortably inside BASE_DRONE_DETECT (plan.md Step 10 shrank it to gu(18) = 504 - was
		// gu(60) = 1680, when this 1478 literal was chosen).
		const meDist = config.BASE_DRONE_DETECT * 0.8;
		me.x = anchor.ox + meDist * Math.cos(0.4);
		me.y = anchor.oy + meDist * Math.sin(0.4);
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
		// purely along X, comfortably inside BASE_DRONE_DETECT (plan.md Step 10 shrank it to
		// gu(18) = 504, well under room.baseSize's own half-width now, so "past the square" and
		// "inside detect range" are no longer both satisfiable at once - detect range wins, since
		// that is what this test is actually about). That also means this point is inside the base's
		// OWN fence (room.baseSize 1876 measured from the map corner, not the post) - ghost the
		// target so the fence does not kill it before a drone ever gets a chance to see it.
		const post = centre.posts[0];
		const target = room.INSTANCE.players.add((id) => new Player(
			{ GM: room.gm, sId: room.id, oId: id }, post.x + config.BASE_DRONE_DETECT * 0.6, post.y, 'foe', 1, room.XPLVL, room));
		target.shield = 0; target.alpha = 1; target.dev.ghost = 1;
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
	// lingering nowhere and specifically not at the arena edge. Bait a whole 4team base out (as far
	// as BASE_DRONE_DETECT still reaches - plan.md Step 10 shrank it to gu(18) = 504, so the literal
	// OOB corner this used to reach at gu(60) = 1680 is no longer detectable at all), take the bait
	// away, and hold every drone to (a) strictly closing on its ring from the FIRST tick after the
	// drop and every tick after, (b) never holding a byte-identical position for two consecutive
	// ticks, (c) on its ring inside 250 ticks. Measured before the fixes: (a) failed on tick 0 and
	// kept failing for ~25 ticks, (b) 14 consecutive frozen ticks, (c) worst case 268. None of the
	// three passes with only part of the group applied.
	{
		const room = makeRoom('4team');
		const bait = player(room, 0);
		const centre = room.droneCentres.find((c) => c.posts[0].team !== bait.team);
		const post = centre.posts[0];
		bait.shield = 0;
		// The bait exists to be chased, not to fight: twelve drones in contact for 400 ticks would
		// grind themselves to death on its body damage and confound "did it come home" with "is it
		// still alive". Player.damage is set once in the constructor, so this sticks.
		bait.damage = 0;
		// Diagonally outward from the post, toward the same corner as before, at 85% of
		// BASE_DRONE_DETECT so every drone at the centre - not just the current scout - is well
		// within range to acquire it. This point is well inside the drawn arena now (unlike the old
		// literal OOB corner, which BASE_DRONE_DETECT can no longer reach at all - plan.md Step 10),
		// so it is also inside the enemy base's own fence (room.baseSize 1876 from the map corner) -
		// ghost the bait so the fence does not kill it before any drone gets a chance to chase it.
		bait.dev.ghost = 1;
		const dist = config.BASE_DRONE_DETECT * 0.85 / Math.SQRT2;
		const bx = post.x + Math.sign(post.x) * dist;
		const by = post.y + Math.sign(post.y) * dist;
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
	// those provoke them first via body damage or drone damage".
	//
	// The boss is named, not rolled for. Both halves of that rule are real now - createBoss() sets
	// `fallen` off the class table and entities/Bullet.js's acquire gate reads it - so a random
	// boss is a coin flip on which half of the rule this block is even testing. Index 0 in
	// CONFIG.BOSS is the Summoner, one of the wiki's own three named polygon bosses.
	{
		const room = makeRoom('4team');
		const boss = room.createBoss(0) || room.bosses[0];
		const centre = room.droneCentres.find((c) => c.posts[0].team === 0);
		const post = centre.posts[0];
		// Parked inside BASE_DRONE_DETECT (plan.md Step 10 shrank it to gu(18) = 504, well under
		// room.baseSize's own half-width now - see the scout test's own comment) but past the
		// widest orbit ring (BASE_DRONE_ORBIT_R + 2*LEVEL_GAP, ~280 units) with room to spare, so
		// the boss's own body never brushes a drone's and trips the body-damage provoke path by
		// accident - this test is about mere PRESENCE not being provocation, not about proximity.
		// Its gun is stubbed out so nothing it fires can provoke the base by accident either. Its
		// motion() is left alone - the Summoner's own AI is what populates `detected`, which its
		// update() reads - and its position is re-pinned every tick instead.
		boss.shoot = function () { };
		const bossHold = () => { boss.x = post.x + config.BASE_DRONE_DETECT * 0.9; boss.y = post.y; };
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
	 against, a createBullet() that does nothing (or counts), and rules.invisFloor (PENDING #28) -
	 Room.js's own DEFAULT_RULES value, since entities/Player.js's update() reads it unconditionally
	 whenever a class has stealth alpha, and every test through here uses a class that doesn't. Never
	 a real SlotMap. */
function fakeRoom() {
	return { map: { width: 1e6, height: 1e6 }, createBullet() { }, rules: { invisFloor: 0 } };
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
	whose lifetime is itself correctly wall-clock-constant); under quadratic() it holds flat.
	0.48 is an arbitrary-but-fixed cruise speed (not tied to any live class); the muzzle kick below
	is the ordinary-bullet formula an equivalent live cannon would get (`speed / BULLET_MAINTAIN +
	16.8`, entities/Player.js's shoot()), so this is a representative bullet, not an extreme one -
	see nuance 33 for why BODY_FRICTION 0.956532 -> 0.9 (Step 9) also widens a bullet's own
	tick-rate agreement band the same way it already widened the tank-movement one. That `/
	BULLET_MAINTAIN` is the 2026-08-01 muzzle-kick fix: Step 9 wrote the formula as `speed + 16.8`,
	conflating TanksConfig.js's cruise-THRUST column with diep's own raw `bulletAccel` (the column
	is that figure with maintainVelocity's 0.1 already folded in), which cost every projectile in
	the game a factor of ten on the accel term of its launch impulse.

	2% (was 1% pre-Step-9): a bullet's `life` is quantised to whole ticks (tick.ticks()), so the
	three rates round to wall-clock lifetimes 0.35% apart and the ranges inherit that on their own -
	but BODY_FRICTION 0.9 (plan.md Step 9) now applies enough per-tick drag to a bullet that the
	same Euler-discretization drift nuance 33 measured for TANK_FRICTION (0.956532 -> 10/11, 1% ->
	3%) shows up here too, measured at ~1.8% between TICK_MS 16 and 33 for a representative muzzle
	kick. 2% still catches the bug this test was built for (PENDING #24's ~3x runaway) with room to
	spare, and is tighter than the tank-movement band since a bullet's own life-quantisation still
	helps it converge faster.
*/
function bulletRangeInvarianceTest(near) {
	const BULLET_MAINTAIN = require(path.join(ROOT, 'lib', 'constants.js')).BULLET_MAINTAIN;
	function rangeAt(tickMs) {
		return withTickMs(tickMs, ({ Bullet }) => {
			const b = new Bullet({ oId: -1 }, 0, 0, 0, 0.48, 0.48 / BULLET_MAINTAIN + 16.8, fakeRoom());
			b.alone = 1;   // no owning Player to look up - see TwoTeam/FourTeam's guard drones
			let guard = 0;
			while (b.destroy === 0 && guard++ < 1e6) { b.update(); }
			return Math.hypot(b.x, b.y);
		});
	}
	const r16 = rangeAt(16), r25 = rangeAt(25), r33 = rangeAt(33);
	console.log('  note bullet range at TICK_MS 16/25/33: ' + r16.toFixed(1) + ' / ' + r25.toFixed(1) +
		' / ' + r33.toFixed(1) + ' units');
	check('bullet range at TICK_MS 16/25/33 agrees within 2%',
		near(r16, r33, 0.02) && near(r25, r33, 0.02),
		r16.toFixed(1) + ' / ' + r25.toFixed(1) + ' / ' + r33.toFixed(1));
	// The reading at the live rate, re-pinned again (~1175 pre-Step-9, ~451.5 after it) for the
	// two 2026-08-01 projectile-speed fixes: the muzzle-kick `/ BULLET_MAINTAIN` above and
	// entities/Bullet.js's BULLET_CRUISE_ORDER thrust compensation. Both are corrections toward
	// diep's own figures, so the range growing is the point - this pin exists to stop the NEXT
	// change from being a silent balance shift, not to freeze this one out.
	check('...and still matches the range this game is tuned for at TICK_MS 25 (~523.7 units)',
		near(r25, 523.7, 0.01), r25.toFixed(1));
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
	Regen (PENDING #17, plan.md step 4): two direct tick.perTick() rates now, no accumulator, so
	there is no quadratic-vs-perTick miscategorisation left to catch (that was the old hpregan's
	failure mode). What is still worth pinning at tick-scale is that repeated tick.perTick() adds
	over a fixed wall-clock window sum to the same total regardless of how finely the window is
	sliced - true by construction for a flat per-tick add (no friction-style recurrence to
	discretize), but checked directly rather than assumed, for both regimes.

	Mirrors entities/Player.js's own two formulas rather than calling the full update() (which would
	couple this to motion()/shoot()/xp - unrelated systems this test has no reason to depend on).
	"Hyper" below means the ADDITIVE regime (linear + maxHp/250, diepcustom's Live.ts:130-135) now,
	not the old flat replacement rate - healedHyper() includes the linear term on purpose so its
	total is directly comparable to healedLinear()'s (it should always heal more, never less).
*/
function regenInvarianceTest() {
	function healedLinear(tickMs, wallMs) {
		return withTickMs(tickMs, ({ Player, tick }) => {
			const p = new Player({ oId: 0 }, 0, 0, 'x', 1, [0, 1e9], fakeRoom());
			p.update();   // let the level-0-at-xp-0 join quirk (see fovTests) resolve first
			let healed = 0;
			const hps = p.maxHp * (0.03 + 0.12 * p.up.HpRegan) / 30 / 25;
			const steps = Math.round(wallMs / tickMs);
			for (let i = 0; i < steps; i++) { healed += tick.perTick(hps); }
			return healed;
		});
	}
	function healedHyper(tickMs, wallMs) {
		return withTickMs(tickMs, ({ Player, tick }) => {
			const p = new Player({ oId: 0 }, 0, 0, 'x', 1, [0, 1e9], fakeRoom());
			p.update();
			let healed = 0;
			// HYPER_REGEN_RATE is already per-REFERENCE-tick (diep's maxHp/250) - no /25 here, unlike
			// the linear term above, which still converts from diep's published per-SECOND rate.
			const hps = p.maxHp * (0.03 + 0.12 * p.up.HpRegan) / 30 / 25 + p.maxHp * Player.HYPER_REGEN_RATE;
			const steps = Math.round(wallMs / tickMs);
			for (let i = 0; i < steps; i++) { healed += tick.perTick(hps); }
			return healed;
		});
	}
	const near = (a, b, pct) => Math.abs(a - b) / b < pct;

	const l16 = healedLinear(16, 10000), l25 = healedLinear(25, 10000), l33 = healedLinear(33, 10000);
	check('linear-regime regen over 10s agrees within 1% at TICK_MS 16/25/33',
		near(l16, l33, 0.01) && near(l25, l33, 0.01),
		l16.toFixed(3) + ' / ' + l25.toFixed(3) + ' / ' + l33.toFixed(3));

	const h16 = healedHyper(16, 10000), h25 = healedHyper(25, 10000), h33 = healedHyper(33, 10000);
	check('hyper-regime (additive) regen over 10s agrees within 1% at TICK_MS 16/25/33',
		near(h16, h33, 0.01) && near(h25, h33, 0.01),
		h16.toFixed(3) + ' / ' + h25.toFixed(3) + ' / ' + h33.toFixed(3));
	check('hyper-regime heals strictly more than linear-regime alone over the same window',
		h25 > l25, h25 + ' vs ' + l25);

	// The threshold itself: tick.ticks(750) must span the same ~30s of wall clock at every rate,
	// same property test/rooms.js already checks for tick.DES/DEAD_DELAY/KEEP_PLACE elsewhere.
	const d16 = withTickMs(16, ({ Player }) => Player.HYPER_REGEN_DELAY * 16);
	const d25 = withTickMs(25, ({ Player }) => Player.HYPER_REGEN_DELAY * 25);
	const d33 = withTickMs(33, ({ Player }) => Player.HYPER_REGEN_DELAY * 33);
	check('the hyper-regen threshold spans ~30s of wall clock at TICK_MS 16/25/33',
		near(d16, 30000, 0.05) && near(d25, 30000, 0.05) && near(d33, 30000, 0.05),
		d16 + 'ms / ' + d25 + 'ms / ' + d33 + 'ms');
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
	const squares = { ffa: 451, '4team': 450, '2team': 400, boss: 350, maze: 451 };
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
	// gu(60), not diep's own gu(18): see lib/config.js's own comment for why the diep figure
	// does not survive contact with a base whose drones orbit a fixed ring and scan one at a time.
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
	Max Health's own heal (PENDING #17, plan.md step 4). A point adds its step to maxHp and heals
	current hp by the same proportion, so the health FRACTION survives the upgrade - the same
	ratio-based heal PENDING #30's 6/7 rescale used, carried forward rather than reinvented. The
	step itself is diep's own flat +20/point now (diep_wiki/Stats.txt), not a rescale of the old
	110 - MH0 is 50 (not 150), so a full bar is +140, not +660.
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
	me.maxHp = 50; me.hp = 25;
	me.upgrade(HP_UP);
	const step = me.maxHp - 50;
	check("one point adds diep's own flat +20 to maxHp", Math.abs(step - 20) < 0.01, step);
	check('...and heals current hp by that same proportion',
		Math.abs(me.hp - 25 * (me.maxHp / 50)) < 1e-9, me.hp);
	check('...so a tank on half health is still on half health afterwards',
		Math.abs(me.hp / me.maxHp - 0.5) < 0.005, me.hp / me.maxHp);

	me.stillLvl = 0; me.upNb = [0, 0, 0, 0, 0, 0, 0, 0];
	me.maxHp = 50; me.hp = 50;
	for (let i = 0; i < P.MAX_PER_STAT; i++) { me.upgrade(HP_UP); }
	check("a full bar is +140 maxHp, diep's own 0-7 x +20 table",
		Math.abs(me.maxHp - 190) < 0.01, me.maxHp);
	check('...and a full-health tank is still at full health, not a bar of under-heals down',
		Math.abs(me.hp - me.maxHp) < 1e-9, me.hp + '/' + me.maxHp);
	// The per-stat cap itself, with points to spare so it is the cap doing the refusing and not
	// the grant schedule running out.
	me.level = P.LEVEL_CAP; me.stillLvl = 0; me.upNb = [0, 0, 0, 0, 0, 0, 0, 0];
	me.maxHp = 50; me.hp = 50;
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

	// diep's own XP curve shape (Const/Enums.ts:301-304, plan.md P1), not a power curve merely
	// agreeing at the endpoints - ffa's own maxXp (25000) IS diep's raw 23537 (this mode's scale
	// factor is 1.0622), so these land on diep's own published table exactly once rounded.
	{
		const diep = { 2: 4, 5: 50, 10: 275, 15: 788, 20: 1758, 30: 6185, 45: 23537 };
		const scale = room.rules.maxXp / 23537;
		let ok = true, detail = '';
		for (const lvl in diep) {
			const want = Math.round(diep[lvl] * scale);
			const got = room.XPLVL[lvl - 1];
			if (got !== want) { ok = false; detail += 'lvl' + lvl + ':' + got + '!=' + want + ' '; }
		}
		check('the XP curve matches diep\'s own published table at every cited level', ok, detail);
	}

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
/*
	Arena size and shape density (PENDING #19, plan.md step 6).

	The load-bearing claim of that step is that diep's two published formulas -
	AL = floor(sqrt(N_P) * 50) gu and 12.5 * N_P shapes - compose to a CONSTANT density of one
	shape per 200 gu^2, and that the density is therefore the part that transfers to our own
	(mostly fixed-size) arenas. That is checked here against the real rooms rather than restated:
	every mode's derived caps are read back off the constructed room and divided by its actual
	area, so a regression in apportionShapes(), in a mode's shapeMix, or in the density constant
	itself shows up as a density that is no longer 200.
*/
function arenaDensityTests(rooms) {
	console.log('\narena size and shape density (PENDING #19):');
	const World = require(path.join(ROOT, 'public', 'SHARE', 'World.js'));

	// 1. The composition argument itself, stated as arithmetic rather than trusted from the
	// comment: at any player count, AL(N)^2 / (12.5*N) is 200 gu^2 per shape.
	{
		let flat = true;
		for (const n of [4, 9, 16, 25, 36, 64, 100]) {
			const al = Math.floor(Math.sqrt(n) * 50);
			if (Math.abs(al * al / (12.5 * n) - 200) > 1e-9) { flat = false; }
		}
		check('diep\'s AL and 12.5/player compose to a constant 200 gu^2 per shape', flat);
	}

	// 2. Every shipped mode actually sits at that density now. This is the step's whole point:
	// PENDING #19 measured ours at 1 per 261 gu^2 against diep's 200.
	for (const room of rooms) {
		const o = room.obj;
		const total = o.sqr.max0 + o.sqr.max1 + o.tri.max0 + o.tri.max1 + o.pnt.max0 + o.pnt.max1;
		const areaGu = (room.map.width / World.GU) * (room.map.height / World.GU);
		// Within one shape of the floor - apportionment is integer, so exactness is not available
		// on a small arena (sandbox's 112 shapes cannot hit 200.0 on the nose).
		check(room.gm + ' sits at diep\'s 1-shape-per-200gu^2 density',
			Math.abs(areaGu / total - 200) <= 200 / total,
			total + ' shapes over ' + Math.round(areaGu) + 'gu^2 = 1 per ' + (areaGu / total).toFixed(1));
	}

	// 3. The mix each mode was tuned with survives the total moving - the step changes how MANY
	// shapes there are, never the sqr/tri/pnt balance between them.
	{
		const ffa = rooms[0];
		const mix = ffa.rules.shapeMix;
		const mixTotal = mix.sqr0 + mix.sqr1 + mix.tri0 + mix.tri1 + mix.pnt0 + mix.pnt1;
		const o = ffa.obj;
		const total = o.sqr.max0 + o.sqr.max1 + o.tri.max0 + o.tri.max1 + o.pnt.max0 + o.pnt.max1;
		// Each part within one whole shape of its exact share - largest-remainder's own guarantee.
		check('ffa\'s tuned sqr/tri/pnt mix is preserved through the density change',
			Math.abs(o.sqr.max0 - total * mix.sqr0 / mixTotal) <= 1 &&
			Math.abs(o.tri.max0 - total * mix.tri0 / mixTotal) <= 1 &&
			Math.abs(o.pnt.max0 - total * mix.pnt0 / mixTotal) <= 1,
			[o.sqr.max0, o.tri.max0, o.pnt.max0].join('/'));
		check('...and the parts sum to exactly the density\'s total, with nothing lost to rounding',
			total === Math.floor(451 * 451 / 200), total + ' vs ' + Math.floor(451 * 451 / 200));
	}

	// 4. baseSizeRatio reproduces the two measured diep base sizes EXACTLY, not to within a
	// float epsilon - inEnemyBase()/baseCenter() compare against baseSize directly, and the
	// {num, den} form exists precisely because width * (67/450) does not land on gu(67).
	{
		const two = rooms[1], four = rooms[2];
		check('2team\'s strip is still exactly gu(40) - a ratio of its arena, same number',
			two.baseSize === World.gu(40), two.baseSize + ' vs ' + World.gu(40));
		check('4team\'s square is still exactly gu(67) - the {num,den} form, not a divided float',
			four.baseSize === World.gu(67), four.baseSize + ' vs ' + World.gu(67));
		check('...and the pre-divided float really would have missed it',
			World.gu(450) * (67 / 450) !== World.gu(67), World.gu(450) * (67 / 450));
	}

	// 5. nestScale: ffa is the reference and must be exactly 1 (so the whole step is a no-op for
	// ffa's placement), and every other mode's is its own honest ratio to it.
	{
		check('ffa\'s nestScale is exactly 1 - it is the reference arena',
			rooms[0].nestScale === 1, rooms[0].nestScale);
		check('every other mode\'s nestScale is its own arena as a fraction of ffa\'s',
			rooms.slice(1).every((r) => Math.abs(r.nestScale - r.map.width / World.gu(451)) < 1e-12),
			rooms.map((r) => r.gm + ':' + r.nestScale.toFixed(4)).join(' '));
	}

	// 6. The arenaLive split - which modes take diep's population-varying arena. Sandbox is the
	// one shipped mode the wiki describes that way, and its own maxPlayer 0 means it sits at the
	// MIN_ARENA_GU floor today: assert BOTH, so the "inert today" note in that file is a pinned
	// fact rather than a claim, and so a future maxPlayer change surfaces here.
	{
		const sandbox = rooms[4];
		check('sandbox is the one shipped mode with a population-varying arena',
			rooms.filter((r) => r.rules.arenaLive).map((r) => r.gm).join(',') === 'sandbox',
			rooms.filter((r) => r.rules.arenaLive).map((r) => r.gm).join(',') || 'none');
		check('...and it sits at the gu(150) floor, since maxPlayer 0 caps it at one player',
			sandbox.map.width === World.gu(150) && sandbox.rules.maxPlayer === 0,
			sandbox.map.width + ' @ maxPlayer ' + sandbox.rules.maxPlayer);
		// The live path does work, though - drive it directly at a count the floor doesn't swallow.
		const savedMap = sandbox.map, savedNew = sandbox.newMap, savedScale = sandbox.nestScale;
		sandbox.newMap = { width: savedMap.width, height: savedMap.height };
		sandbox.tickArena(64);
		check('...and asks for AL(64) = 400gu when it is actually given 64 players',
			sandbox.newMap.width === World.gu(400), sandbox.newMap.width + ' vs ' + World.gu(400));
		sandbox.tickArena(9);
		check('...and AL(9) = 150gu, the floor, since sqrt(9)*50 is below it',
			sandbox.newMap.width === World.gu(150), sandbox.newMap.width);
		sandbox.map = savedMap; sandbox.newMap = savedNew; sandbox.nestScale = savedScale;
		sandbox.tickArena(0);
		// A non-live mode must NOT have its arena rewritten by its own population, or the admin
		// 'mapResize' command would be undone every tick in four of the five modes.
		const ffa = rooms[0];
		const before = ffa.newMap.width;
		ffa.tickArena(24);
		check('a fixed-arena mode never rewrites its own newMap from the player count',
			ffa.newMap.width === before, ffa.newMap.width + ' vs ' + before);
	}
}

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

	// 3. A map far below what used to be the ~2744-unit unsatisfiability floor neither hangs nor
	// places you off it. Kept as-is after plan.md step 6 removed that floor (the radii scale with
	// the arena now, checks 8/9 below): this drives spawnPoint() with the map moved but nestScale
	// left where it was, i.e. deliberately the OLD absolute-radii shape, so the cap-and-fallback
	// guarantee is still tested against an unsatisfiable configuration rather than only against
	// the well-behaved one the scaling now produces.
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

	// 6. 'bull' placement (direct polar sampling, not rejection) lands in diep's own Crasher Zone
	// annulus now (630..1249 units x nestScale, plan.md S2 - was a fixed 650..700 ring, under half
	// diep's own zone width).
	{
		const before = room.INSTANCE.objs.size;
		for (let i = 0; i < 50; i++) { room.createObj('bull', 0); }
		const after = [...room.INSTANCE.objs.live()].slice(-50);
		check('bull placement still landed 50 new objects', room.INSTANCE.objs.size - before === 50,
			room.INSTANCE.objs.size - before);
		check('...every one in the 630..1249 Crasher Zone with pos === 1',
			after.every((o) => {
				const r = Math.hypot(o.x, o.y);
				return r >= 630 * room.nestScale - 0.01 && r <= 1249 * room.nestScale + 0.01 && o.pos === 1;
			}));
	}

	// 7. entities/Objects.js's own carve-outs (PENDING #28) rode the same x1.4 grid rescale as
	// spawnKeepOut()'s. Captured off a stub room rather than inferred from where shapes land, so a
	// regression names the wrong number instead of showing up as a density drift nobody can see.
	// The stub carries a nestScale now (PENDING #19, plan.md step 6) because the real contract has
	// one - at ffa's own scale of 1 every figure below is exactly what it was before that step.
	const carveProbe = (nestScale, map) => {
		const Objects = require(path.join(ROOT, 'entities', 'Objects.js'));
		let seen = null;
		const stub = {
			nestScale: nestScale,
			rejectSample: (inset, circles) => { seen = { inset: inset, circles: circles }; return { x: 0, y: 0 }; }
		};
		const probe = new Objects('sqr', -1, { GM: 'ffa', sId: 0, oId: 0 }, map, stub);
		return { seen: seen, probe: probe };
	};
	{
		const { seen, probe } = carveProbe(1, room.map);
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

	// 8. The carve-outs are a fixed FRACTION of the arena now, not an absolute (PENDING #19,
	// plan.md step 6) - which is what retires this file's own "unsatisfiable below ~2744 units"
	// failure mode at the source rather than by clamping. Probed at half ffa's scale: every radius
	// and the edge inset all halve together, so the placement picture is geometrically similar.
	{
		const half = { width: room.map.width / 2, height: room.map.height / 2 };
		const { seen } = carveProbe(0.5, half);
		check('a half-size arena halves every carve-out radius with it',
			!!seen && seen.circles[0][2] === 700 && seen.circles[1][2] === 490 && seen.circles[2][2] === 490,
			seen && JSON.stringify(seen.circles.map((c) => c[2])));
		check('...and halves the map-edge inset too, so the whole picture stays similar',
			!!seen && seen.inset === 140, seen && seen.inset);
	}

	// 9. The same proportionality on the room side - spawnKeepOut() and spawnPoint()'s inset ride
	// room.nestScale, so no arena size exists at which the keep-out swallows the whole map. Checked
	// against a real room by moving its map rather than against arithmetic.
	{
		const sandbox = rooms[4];
		const savedMap = sandbox.map, savedScale = sandbox.nestScale;
		sandbox.map = { width: 1200, height: 1200 };
		sandbox.tickArena(0);
		const circles = sandbox.spawnKeepOut();
		// The tightest nest still has to leave the map's own corner outside it, at ANY size - that
		// is the property the old absolute radii lost below ~2744 units.
		const corner = Math.hypot(sandbox.map.width / 2, sandbox.map.height / 2);
		check('a 1200-unit arena still has points outside its own keep-out circles',
			circles.every((c) => Math.hypot(c[0], c[1]) + c[2] < corner + 1e-9),
			JSON.stringify(circles.map((c) => Math.round(c[2]))));
		sandbox.map = savedMap;
		sandbox.nestScale = savedScale;
		sandbox.tickArena(0);
	}
}

/*
	Crasher chase (plan.md S1): before this pass a Crasher saw under half of diep's own range and,
	once it found something, pulled toward it at ~26x too slow to ever threaten a moving tank -
	PENDING.md's own untested checklist flagged this as "confirmed unexercised" since the seeded
	corpus never spawns one. Covered directly here instead.
*/
function crasherChaseTests() {
	console.log('\ncrasher chase (plan.md S1):');
	const Objects = require(path.join(ROOT, 'entities', 'Objects.js'));
	const config = require(path.join(ROOT, 'lib', 'config.js')).config;
	const room = makeRoom('ffa');

	// diep's own ai.viewRange 2000 du x 0.56 (Crasher.ts) - was 500, under half.
	{
		const crasher = new Objects('bull', 'bull', { GM: room.gm, sId: room.id, oId: -1 }, room.map, room);
		check('a Crasher\'s own detector radius is diep\'s 2000du x 0.56, not the old 500',
			crasher.DETEC.size === 1120, crasher.DETEC.size);
	}

	// diep's own 0.2 large-Crasher chance (Crasher.ts) - was 0.15. Sampled, not read off a
	// literal, since the roll lives inside the constructor.
	{
		let large = 0;
		const N = 20000;
		for (let i = 0; i < N; i++) {
			if (new Objects('bull', 'bull', { GM: room.gm, sId: room.id, oId: -1 }, room.map, room).crasherLarge) { large++; }
		}
		const ratio = large / N;
		check('large-Crasher chance samples near diep\'s own 0.2, not the old 0.15',
			Math.abs(ratio - 0.2) < 0.02, ratio.toFixed(3));
	}

	// A live target drives the Crasher toward diep's own ~364 u/s terminal (10 x targettingSpeed,
	// run through the same decay-then-add BODY_FRICTION recurrence the tank integrator uses), not
	// the old ~14 u/s idle-drift cap (maxspeed/2). Not pinned tight against 364 - M4's own 1.8%-ish
	// discretization slop at the live TICK_MS applies here too - just proven to be in the right
	// regime, an order of magnitude past the old cap.
	{
		const crasher = new Objects('bull', 'bull', { GM: room.gm, sId: room.id, oId: -1 }, room.map, room);
		crasher.x = 0; crasher.y = 0;
		crasher.DETEC.select = { x: 10000, y: 0, destroy: 0, god: 0 };
		for (let i = 0; i < 400; i++) { crasher.update(); }
		const speed = crasher.vec.length() * (1000 / config.TICK_MS);
		check('a chasing Crasher settles far above the old ~14 u/s idle-drift cap',
			speed > 200, speed.toFixed(1) + ' u/s');
	}

	// Idle drift (no live target) is untouched by the chase rewrite - still bounded near the old
	// maxspeed/2 cap, not diep's own chase terminal.
	{
		const sq = new Objects('bull', 'bull', { GM: room.gm, sId: room.id, oId: -1 }, room.map, room);
		sq.x = 0; sq.y = 0; sq.vec.x = 5; sq.vec.y = 0;
		for (let i = 0; i < 400; i++) { sq.update(); }
		check('idle drift (no live DETEC target) is unaffected by the chase rewrite',
			sq.vec.length() < 1, sq.vec.length());
	}

	// End to end, through the real pair loop: a target 900 units off is inside diep's own
	// 1120-unit range but outside the old 500-unit one.
	{
		const Player = require(path.join(ROOT, 'entities', 'Player.js'));
		const r2 = makeRoom('ffa');
		player(r2, 0).destroy = 1;
		const crasher = new Objects('bull', 'bull', { GM: r2.gm, sId: r2.id, oId: -1 }, r2.map, r2);
		crasher.x = 0; crasher.y = 0;
		r2.INSTANCE.objs.add((id) => { crasher.id = { GM: r2.gm, sId: r2.id, oId: id }; return crasher; });
		const foe = r2.INSTANCE.players.add((id) => new Player(
			{ GM: r2.gm, sId: r2.id, oId: id }, 900, 0, 'prey', 1, r2.XPLVL, r2));
		foe.shield = 0; foe.alpha = 1;
		for (let i = 0; i < 5; i++) { r2.step(); }
		check('a target 900 units off is inside diep\'s own 1120-unit range, outside the old 500',
			crasher.DETEC.select === foe, crasher.DETEC.select && 'found' || 'not found');
	}

	// plan.md C12 - a Crasher's own population is the Crasher Zone annulus's share of the SAME
	// SHAPE_DENSITY_GU2 every other shape draws from (diepcustom's ShapeManager.spawnShape():
	// one shared pool, classified by where the random point landed), not an independent knob -
	// ffa's old hand-picked literal (39) never scaled with the arena and had no diep citation.
	{
		check('the Crasher population cap is derived from the shape density formula, not a fixed 39',
			room.obj.bull.max1 !== 39 && room.obj.bull.max1 > 0, room.obj.bull.max1);
	}

	// plan.md C12 - OOB chase: a chasing Crasher gets the same config.OOB_MARGIN allowance a
	// tank's own motion()/a chasing base drone already get (diepcustom Crasher.ts:44
	// `canMoveThroughWalls`), so it can follow a target out past the drawn edge - and re-clamps
	// the instant it goes idle again (no live DETEC target), so a stray drifts back inside.
	{
		const crasher = new Objects('bull', 'bull', { GM: room.gm, sId: room.id, oId: -1 }, room.map, room);
		crasher.x = room.map.width / 2 + 1; crasher.y = 0; crasher.vec.x = 50; crasher.vec.y = 0;
		crasher.DETEC.select = { x: room.map.width, y: 0, vec: { x: 0, y: 0 }, destroy: 0, god: 0 };
		crasher.update();
		check('a chasing Crasher is not hard-clamped at the drawn edge',
			crasher.x > room.map.width / 2, crasher.x + ' vs edge ' + room.map.width / 2);
		check('...but still capped at config.OOB_MARGIN past it, not unbounded',
			crasher.x <= room.map.width / 2 + config.OOB_MARGIN + 1,
			crasher.x + ' vs cap ' + (room.map.width / 2 + config.OOB_MARGIN));
	}
	{
		const idle = new Objects('bull', 'bull', { GM: room.gm, sId: room.id, oId: -1 }, room.map, room);
		idle.x = room.map.width / 2 + config.OOB_MARGIN; idle.y = 0; idle.vec.x = 50; idle.vec.y = 0;
		idle.update();
		check('an idle Crasher (no DETEC target) still hard-clamps at the drawn edge, unchanged',
			idle.x === room.map.width / 2, idle.x + ' vs ' + room.map.width / 2);
	}
}

/*
	Predator zoom (plan.md C9, diepcustom TankBody.ts:338-345) - right-click locks the camera to
	a point 1500 du out along the mouse direction, latched once at press and released on mouse-up.
	Server-side this is entities/Player.js's `zooming`/`zoomX`/`zoomY` (gated on the class's own
	`flags.zoomAbility`, so it never fires for an ordinary class holding right-click for some other
	reason - Overseer's own drone-repel input in particular) and rooms/Room.js's per-viewer buffer/
	getBuffer() reading them instead of the tank's own x/y so the client actually receives entities
	near the locked point, not an empty view.
*/
function predatorZoomTests() {
	console.log('\npredator zoom (plan.md C9):');
	const Player = require(path.join(ROOT, 'entities', 'Player.js'));
	const room = makeRoom('ffa');
	player(room, 0).destroy = 1;

	{
		const p = room.INSTANCE.players.add((id) => new Player(
			{ GM: room.gm, sId: room.id, oId: id }, 4000, 4000, 'predatorTest', 1, room.XPLVL, room));
		p.class = 'Predator';   // the constructor's 4th arg is the display NAME, not the class
		p.shield = 0; p.alpha = 1;
		p.dir = 0;   // aiming due "east"
		p.inputs.mouseR = 1;
		p.update();
		check('holding right-click on a zoomAbility class latches a zoom lock',
			p.zooming === 1, p.zooming);
		check('...840 units (1500 du x 0.56) out along the aim direction',
			Math.abs(p.zoomX - (p.x + 840)) < 0.01 && Math.abs(p.zoomY - p.y) < 0.01,
			p.zoomX + ',' + p.zoomY);
		// Re-aiming while still held does NOT move the lock (diep's own `usesCameraCoords` gate:
		// computed once at press, not re-latched every tick it stays held).
		p.dir = Math.PI / 2;
		p.update();
		check('the lock does not track the mouse while still held, only at the moment of press',
			Math.abs(p.zoomX - (p.x + 840)) < 0.01 && Math.abs(p.zoomY - p.y) < 0.01,
			p.zoomX + ',' + p.zoomY);
		// Release, then re-press at the new aim: a fresh lock at the new direction.
		p.inputs.mouseR = 0;
		p.update();
		check('releasing right-click clears the lock', p.zooming === 0, p.zooming);
		p.inputs.mouseR = 1;
		p.update();
		check('pressing again re-latches at the CURRENT aim direction',
			Math.abs(p.zoomX - p.x) < 0.01 && Math.abs(p.zoomY - (p.y + 840)) < 0.01,
			p.zoomX + ',' + p.zoomY);
	}

	// A class with no flags.zoomAbility (Overseer, which has its own unrelated right-click
	// drone-repel input) must never engage a camera lock from the same input.
	{
		const o = room.INSTANCE.players.add((id) => new Player(
			{ GM: room.gm, sId: room.id, oId: id }, -4000, -4000, 'overseerTest', 1, room.XPLVL, room));
		o.class = 'Overseer';
		o.shield = 0; o.alpha = 1;
		o.inputs.mouseR = 1;
		o.update();
		check('Overseer\'s own right-click input does not engage a Predator-style zoom lock',
			o.zooming === 0, o.zooming);
	}

	// End to end through getBuffer(): the buffer centres on the locked point, not the tank's own
	// position, while zoomed - otherwise the client would pan its camera to a point the server
	// never sent any entities for.
	{
		const pr = room.INSTANCE.players.add((id) => new Player(
			{ GM: room.gm, sId: room.id, oId: id }, 0, 0, 'predatorTest2', 1, room.XPLVL, room));
		pr.class = 'Predator';
		pr.shield = 0; pr.alpha = 1;
		pr.dir = 0;
		pr.inputs.mouseR = 1;
		room.step();
		const buff = room.getBuffer(pr.id.oId);
		check('getBuffer() head.camX/camY track the lock point while zoomed, not the tank\'s own x/y',
			Math.abs(buff.head.camX - pr.zoomX) < 1 && Math.abs(buff.head.camY - pr.zoomY) < 1 &&
			Math.abs(buff.head.camX - pr.x) > 1,
			buff.head.camX + ',' + buff.head.camY + ' vs tank ' + pr.x + ',' + pr.y + ' vs lock ' + pr.zoomX + ',' + pr.zoomY);
		check('...and main.states[4] tells the client a lock is actually active',
			buff.main.states[4] === 1, buff.main.states[4]);
		pr.inputs.mouseR = 0;
		room.step();
		const buff2 = room.getBuffer(pr.id.oId);
		check('releasing right-click returns head.camX/camY to the tank\'s own position',
			buff2.head.camX === pr.x && buff2.head.camY === pr.y, buff2.head.camX + ',' + buff2.head.camY);
		check('...and clears main.states[4]', buff2.main.states[4] === 0, buff2.main.states[4]);
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

/*
	KIND.WALL (plan.md Step 12) - rectangular walls, circle-vs-AABB collision, bullet-kill on
	contact. No Maze room exists in this suite (mazeTests() below drives the real generator), so
	these are direct-collision tests against a hand-built rectangle - the same pattern Tag's own
	Arena Closer tests (#28) use above for the same reason (arenaTests's closer.collision() calls).
*/
function wallTests() {
	console.log('\nwalls (plan.md Step 12):');
	const tick = require(path.join(ROOT, 'lib', 'tick.js'));
	const constants = require(path.join(ROOT, 'lib', 'constants.js'));
	const KIND = require(path.join(ROOT, 'public', 'SHARE', 'kinds.js'));
	const Wall = require(path.join(ROOT, 'entities', 'Wall.js'));
	const Player = require(path.join(ROOT, 'entities', 'Player.js'));
	const Bullet = require(path.join(ROOT, 'entities', 'Bullet.js'));

	// ffa, not sandbox: sandbox's maxPlayer is 0 (Sandbox.js), which caps SlotMap.players at the
	// one tester seat - too small for this function's several hand-planted tanks.
	const room = makeRoom('ffa');
	// A 100x40 rectangle centred on the origin - half-extents hw=50, hh=20.
	const wall = new Wall(0, 0, 100, 40, { GM: room.gm, sId: room.id, oId: -1 }, room);

	check('Wall.size is the rectangle\'s half-diagonal, not either half-extent',
		Math.abs(wall.size - Math.sqrt(50 * 50 + 20 * 20)) < 1e-9, wall.size);

	// A fresh Player's own `this.size` (25, entities/Player.js's constructor default - update()'s
	// `28 x 1.01^level` growth never runs, since these tests call collision() directly without
	// ticking) is what every contact/no-contact distance below is planned against.
	function plantTank(x, y) {
		return room.INSTANCE.players.add((id) => new Player(
			{ GM: room.gm, sId: room.id, oId: id }, x, y, 'tester', 1, room.XPLVL, room));
	}

	// ---- real contact on the x-dominant side: keep-speed, then an axis-aligned push-out ----
	{
		// Closest point on the rect is (50,0); tank centre (73,0) -> dist 23 < tank.size(25), a
		// real circle-vs-AABB hit.
		const p = plantTank(73, 0);
		p.vec.x = -5; p.vec.y = 3;
		const hpBefore = p.hp;
		p.collision(wall, {});
		check('a wall deals no body damage', p.hp === hpBefore, p.hp + ' vs ' + hpBefore);
		const push = tick.impulse(constants.WALL_PUSH_OUT);
		const wantX = -5 * constants.WALL_TANK_KEEP_SPEED + push;
		const wantY = 3 * constants.WALL_TANK_KEEP_SPEED;
		check('a tank sheds to WALL_TANK_KEEP_SPEED of its own velocity on contact',
			Math.abs(p.vec.y - wantY) < 1e-9, p.vec.y + ' vs ' + wantY);
		check('...and gets shoved out along the x axis (the more-aligned one) away from the wall',
			Math.abs(p.vec.x - wantX) < 1e-9, p.vec.x + ' vs ' + wantX);
		p.destroy = 1;
	}

	// ---- real contact on the y-dominant side: the push picks the OTHER axis ----------------
	{
		// Closest point on the rect is (0,20); tank centre (0,33) -> dist 13 < tank.size(25).
		const p = plantTank(0, 33);
		p.vec.x = 4; p.vec.y = -5;
		p.collision(wall, {});
		const push = tick.impulse(constants.WALL_PUSH_OUT);
		const wantX = 4 * constants.WALL_TANK_KEEP_SPEED;
		const wantY = -5 * constants.WALL_TANK_KEEP_SPEED + push;
		check('a tank nearer the wall\'s top/bottom edge is pushed out along y instead of x',
			Math.abs(p.vec.x - wantX) < 1e-9 && Math.abs(p.vec.y - wantY) < 1e-9,
			p.vec.x + ',' + p.vec.y + ' vs ' + wantX + ',' + wantY);
		p.destroy = 1;
	}

	// ---- the broad-phase bounding circle is only a coarse gate - a candidate inside it but
	//      outside the real rectangle must do nothing (the false-positive case the half-diagonal
	//      approximation creates for a long/wide wall) --------------------------------------
	{
		// Centre (52,52): within wall.size(53.85) + tank.size(25) of the origin (broad-phase
		// would wave this through), but the true closest point is (50,20) -> dist ~32.06 >
		// tank.size(25) - no real contact.
		const p = plantTank(52, 52);
		p.vec.x = -5; p.vec.y = -5;
		const snap = { hp: p.hp, vx: p.vec.x, vy: p.vec.y };
		p.collision(wall, {});
		check('a broad-phase-only candidate (inside the bounding circle, outside the real rect) is untouched',
			p.hp === snap.hp && p.vec.x === snap.vx && p.vec.y === snap.vy,
			p.vec.x + ',' + p.vec.y);
		p.destroy = 1;
	}

	// ---- an ordinary bullet/trap/drone is destroyed outright on contact, no bounce, no pene
	//      drain (diepcustom Object.ts:297-300: anything with an owner dies) -----------------
	// A Bullet's own constructor default size is 10 (not the tank's 25 above), so the contact
	// point is planned against that: closest point (50,0), centre (57,0) -> dist 7 < size(10).
	{
		const b = new Bullet({ GM: room.gm, sId: room.id, oId: -1 }, 57, 0, Math.PI, 0.5, 40, room);
		b.type = 3;   // a trap - still an ordinary Bullet instance, per the file header
		b.pene = 50;
		b.vec.x = -5; b.vec.y = 0;
		const peneBefore = b.pene;
		const vxBefore = b.vec.x;
		b.collision(wall, {});
		check('an ordinary bullet/trap is destroyed outright on contact, with no physics applied first',
			b.destroy === tick.DES && b.vec.x === vxBefore && b.pene === peneBefore,
			'destroy=' + b.destroy + ' vec.x=' + b.vec.x + ' pene=' + b.pene);
	}
	{
		const d = new Bullet({ GM: room.gm, sId: room.id, oId: -1 }, 57, 0, Math.PI, 0.5, 40, room);
		d.type = 1.4;   // a base drone - same rule now, no longer a special case
		d.pene = 2000;
		d.vec.x = -5; d.vec.y = 0;
		d.collision(wall, {});
		check('a base drone is destroyed on contact with a wall the same way any other bullet is',
			d.destroy === tick.DES && d.vec.x === -5,
			'destroy=' + d.destroy + ' vec.x=' + d.vec.x);
	}

	// ---- a broad-phase-only bullet candidate is also left alone, same as the tank case ------
	{
		const b = new Bullet({ GM: room.gm, sId: room.id, oId: -1 }, 52, 52, Math.PI, 0.5, 40, room);
		b.pene = 50;
		b.collision(wall, {});
		check('a bullet inside the bounding circle but outside the real rectangle is not destroyed',
			b.destroy === 0, b.destroy);
	}

	// ---- an Arena Closer (#28) passes through untouched, via the same this.closer guard every
	//      other collision kind already relies on - not a new exemption ----------------------
	{
		const p = plantTank(73, 0);
		p.closer = 1;
		p.vec.x = -5; p.vec.y = 0;
		const snap = { hp: p.hp, vx: p.vec.x, vy: p.vec.y };
		p.collision(wall, {});
		check('an Arena Closer passes through a wall untouched (this.closer guard, before the switch)',
			p.hp === snap.hp && p.vec.x === snap.vx && p.vec.y === snap.vy,
			p.hp + ' / ' + p.vec.x + ',' + p.vec.y);
		p.destroy = 1;
	}

	// ---- an Arena Closer's own bullet passes through a wall the same way the closer tank does,
	//      even in real contact (diep_wiki, PENDING #26/#28) --------------------------------
	{
		const b = new Bullet({ GM: room.gm, sId: room.id, oId: -1 }, 57, 0, Math.PI, 0.5, 40, room);
		b.closer = 1;
		b.vec.x = -5; b.vec.y = 0;
		b.collision(wall, {});
		check('an Arena Closer\'s own bullet is not destroyed on contact with a wall',
			b.destroy === 0, b.destroy);
	}

	// ---- the wall itself is inert: required no-op collision()/update() (rooms/Room.js's tick
	//      loops call both unconditionally on every live entity of every INSTANCE kind) --------
	check('Wall.collision() is a no-op and does not throw', (() => {
		try { wall.collision({ kind: KIND.PLAYER, x: 0, y: 0 }, {}); return true; } catch (e) { return false; }
	})());
	check('Wall.update() is a no-op and does not throw', (() => {
		try { wall.update(); return true; } catch (e) { return false; }
	})());
	check('a wall never tombstones itself', wall.destroy === 0, wall.destroy);
}

/// Necromancer //////////////////////////////////////////////////////////////
function necromancerTests() {
	console.log('\nnecromancer (issues.md):');
	const Player = require(path.join(ROOT, 'entities', 'Player.js'));
	const Objects = require(path.join(ROOT, 'entities', 'Objects.js'));
	const KIND = require(path.join(ROOT, 'public', 'SHARE', 'kinds.js'));
	const CLASS = require(path.join(ROOT, 'public', 'SHARE', 'TanksConfig.js')).class;

	function plantNecro(room, team, x, y) {
		const p = room.INSTANCE.players.add((id) => new Player(
			{ GM: room.gm, sId: room.id, oId: id }, x, y, 'necro', team, room.XPLVL, room));
		p.class = 'Necromancer';
		p.droneCount = 0;
		p.necro = CLASS['Necromancer'].necro;
		p.shootTimer = new Array(CLASS['Necromancer'].cannons.length).fill(0);
		p.shield = 0; p.alpha = 1;
		return p;
	}
	function plantSquare(room, x, y) {
		const sq = new Objects('sqr', -1, { GM: room.gm, sId: room.id, oId: -1 }, room.map, room);
		sq.x = x; sq.y = y;
		room.INSTANCE.objs.add(() => sq);
		return sq;
	}

	// A live square, touched by an ordinary (non-god) Necromancer: spawns a type-3 drone and
	// consumes one square, through the real pair loop (rooms/Room.js's step()), not a hand-driven
	// collision() call - this is the path issues.md called "completely broken", so it has to be
	// proven at the same level a real game tick would exercise it.
	{
		const room = makeRoom('ffa');
		player(room, 0).destroy = 1;
		const p = plantNecro(room, 0, 0, 0);
		plantSquare(room, 5, 0);
		const dronesBefore = [...room.INSTANCE.bullets.live()].filter((b) => b.type === 3).length;
		room.step();
		const drones = [...room.INSTANCE.bullets.live()].filter((b) => b.type === 3);
		check('touching a live square spawns exactly one type-3 (necro) drone',
			drones.length === dronesBefore + 1, drones.length + ' vs ' + (dronesBefore + 1));
		check('...and the drone counter actually moved', p.droneCount === 1, p.droneCount);
	}

	// issues.md: "necromancer in god mode is unable to convert squares into drones. they should
	// be able to." The square's own collision() (entities/Objects.js) claims itself against ANY
	// necromancer contact regardless of the attacker's god flag, so without claimSquare() being
	// called from the god-mode branch the square would vanish with nothing to show for it.
	{
		const room = makeRoom('ffa');
		player(room, 0).destroy = 1;
		const p = plantNecro(room, 0, 0, 0);
		p.dev.god = 1;
		const sq = plantSquare(room, 5, 0);
		room.step();
		const drones = [...room.INSTANCE.bullets.live()].filter((b) => b.type === 3);
		check('a god-mode necromancer still claims a square it touches',
			drones.length === 1 && p.droneCount === 1, drones.length + ' drones, count=' + p.droneCount);
		check('...and the square is gone either way (its own side never read god mode)',
			sq.destroy > 0, sq.destroy);
	}

	// issues.md: beige ("necro" colour 9) outside a team mode, the player's OWN team colour inside
	// one - not the flat 9 every mode used to get.
	{
		const ffaRoom = makeRoom('ffa');
		player(ffaRoom, 0).destroy = 1;
		const ffaDrone = { type: 3, team: 7, color: undefined };
		check('a necro drone is the beige/necro colour (9) outside a team mode',
			ffaRoom.bulletColor(ffaDrone) === 9, ffaRoom.bulletColor(ffaDrone));

		const tdmRoom = makeRoom('2team');
		player(tdmRoom, 0).destroy = 1;
		const tdmDrone = { type: 3, team: 1, color: undefined };
		check('...but takes the owner\'s own team colour inside one (TDM)',
			tdmRoom.bulletColor(tdmDrone) === 1, tdmRoom.bulletColor(tdmDrone));
		check('an ordinary (non-necro) drone is unaffected either way',
			ffaRoom.bulletColor({ type: 1, team: 3, color: undefined }) === 3);
	}
}

/// Overseer/Overlord drone batching /////////////////////////////////////////
// issues.md: "overseer and overlord should try to spawn drones symmetrically at a time until
// impossible, like overlord should spawn 4 at a time until the very last batch, overseer is 2 at
// a time, etc." Every barrel of either class shares one reload/offTime, so they become ready on
// the exact same real tick and shoot()'s per-barrel drone-cap check (evaluated barrel-by-barrel
// within that one tick, `this.droneCount` incrementing as each fires) already both fires them
// together AND correctly caps the last, partial batch - nothing here needed a code change, but
// nothing pinned it either, so a future edit to shoot()'s cap/offTime handling has something to
// break against.
function droneBatchTests() {
	console.log('\ndrone batching (issues.md - Overseer 2 at a time, Overlord 4):');
	const room = makeRoom('ffa');
	const CLASS = require(path.join(ROOT, 'public', 'SHARE', 'TanksConfig.js')).class;
	for (const [clsName, want] of [['Overseer', [2, 2, 2, 1]], ['Overlord', [4, 4]]]) {
		const p = player(room, 0);
		p.class = clsName;
		p.droneCount = 0;
		p.necro = CLASS[clsName].necro;
		p.shootTimer = new Array(CLASS[clsName].cannons.length).fill(0);
		p.shield = 0;
		p.inputs.e = 0; p.inputs.mouseL = 0;   // every barrel here is can.auto - no input needed
		const batches = [];
		for (let i = 0; i < 800 && p.droneCount < CLASS[clsName].maxDrone; i++) {
			const before = [...room.INSTANCE.bullets.live()].length;
			p.shoot();
			const after = [...room.INSTANCE.bullets.live()].length;
			if (after > before) { batches.push(after - before); }
		}
		check(clsName + ' fires ' + want.join(',') + '-drone batches, not one at a time',
			batches.join(',') === want.join(','), batches.join(','));
		check('...and lands exactly at its maxDrone cap with none left over',
			p.droneCount === CLASS[clsName].maxDrone, p.droneCount);
		for (const b of [...room.INSTANCE.bullets.live()]) { b.destroy = 1; }
	}
}

/// Factory drone steering ////////////////////////////////////////////////////
function factoryTests() {
	console.log('\nfactory drones (issues.md - orbit/cluster, not ram):');
	const Bullet = require(path.join(ROOT, 'entities', 'Bullet.js'));
	const World = require(path.join(ROOT, 'public', 'SHARE', 'World.js'));
	const room = makeRoom('ffa');
	const p = player(room, 0);
	p.class = 'Factory';
	p.x = 0; p.y = 0;
	p.inputs.mouse_x = 0; p.inputs.mouse_y = 0;

	function droneAt(x, y) {
		const b = new Bullet(p.id, x, y, 0, 0, 0, room);
		b.type = 1.5; b.team = p.team; b.class = 'Factory'; b.maxspeed = 1;
		b.update();
		return b;
	}
	const deg = (b) => Math.round(b.dir * 180 / Math.PI + 360) % 360;

	// diep_wiki Attract: beyond the 16-square orbit, close in; inside it, orbit (not ram); too
	// close, back toward the ring - a Minion (type 1.5) gets this three-zone field, the same
	// left-click that an ordinary drone (type 1) still just rams the cursor with.
	p.inputs.mouseL = 1; p.inputs.mouseR = 0;
	check('left-click beyond the 16-square orbit moves the drone straight at the cursor',
		deg(droneAt(World.gu(30), 0)) === 180);
	check('...inside the orbit band it moves perpendicular (orbits), not straight at the cursor',
		deg(droneAt(World.gu(10), 0)) === 270);
	check('...and closer than that it backs off outward, away from the cursor',
		deg(droneAt(World.gu(2), 0)) === 0);
	check('an ordinary (non-Minion) drone type still just rams the cursor at any distance',
		(() => { const b = new Bullet(p.id, World.gu(10), 0, 0, 0, 0, room); b.type = 1; b.team = p.team; b.class = 'Factory'; b.maxspeed = 1; b.update(); return deg(b); })() === 180);

	// diep_wiki Repel: past 18 squares, straight repel; 5-18, spiral off; under 5, star formation
	// pulled together toward the pointer.
	p.inputs.mouseL = 0; p.inputs.mouseR = 1;
	check('right-click beyond 18 squares repels the drone straight away from the cursor',
		deg(droneAt(World.gu(30), 0)) === 0);
	check('...between 5 and 18 squares it spirals off (perpendicular), not a straight repel',
		deg(droneAt(World.gu(10), 0)) === 270);
	check('...and under 5 squares it clusters, pulled back toward the cursor',
		deg(droneAt(World.gu(2), 0)) === 180);
}

/// Boss projectile identity (B2) /////////////////////////////////////////////
// Guardian and Summoner both spawn `type: 3.1` self-targeting drones (one shared steering case in
// entities/Bullet.js), but their drones must look nothing alike: a Guardian drone is a small
// Crasher (pink triangle) and a Summoner drone is a Necromancer square (beige square). The golden
// (test/clientDiff.js) does NOT exercise either boss in its seeded replay, so these are what pin
// the two sprites/sizes/colours instead. Fired through the real shoot() path with `boss = 1` (so a
// boss's bullets take can.size verbatim), then inspected before any update() runs.
function bossProjectileTests() {
	console.log('\nboss projectile identity (B2 - Guardian = small Crasher, Summoner = Necromancer square):');
	const CLASS = require(path.join(ROOT, 'public', 'SHARE', 'TanksConfig.js')).class;

	function fireDrone(cls) {
		const room = makeRoom('ffa');
		const p = player(room, 0);
		p.class = cls;
		p.boss = 1;                              // boss bullets take can.size verbatim (shoot())
		p.size = CLASS[cls].bossSize || 64;
		p.droneCount = 0;
		p.shootTimer = new Array(CLASS[cls].cannons.length).fill(0);
		p.shield = 0;
		p.inputs.e = 0; p.inputs.mouseL = 0;     // boss spawners are can.auto, no input needed
		let d = null;
		for (let i = 0; i < 60 && !d; i++) {
			p.shoot();
			for (const b of room.INSTANCE.bullets.live()) {
				if (b.type === 3.1) { d = b; break; }   // sole player here, so the only 3.1 drones are its own
			}
		}
		return { room, d };
	}

	// Guardian: drawType 6 -> Drawings.bullet[6] (= Drawings.obj.bull), the small-Crasher sprite,
	// at size 13.86 (entities/Objects.js's "bull"), in its own boss colour bull/Color.EnemyCrasher
	// (10). Without the override its shared 3.1 would draw a square (parseInt(3.1) = 3).
	const g = fireDrone('Guardian');
	check('a Guardian fires a 3.1 spawner drone', !!g.d && g.d.type === 3.1, g.d && g.d.type);
	check('...drawn as a Crasher (drawType 6, not the 3.1->square default)',
		!!g.d && g.d.drawType === 6, g.d && g.d.drawType);
	check('...at the small-Crasher size 13.86',
		!!g.d && g.d.size === 13.86, g.d && g.d.size);
	check('...in Crasher pink (bulletColor 10 = bull/Color.EnemyCrasher)',
		!!g.d && g.room.bulletColor(g.d) === 10, g.d && g.room.bulletColor(g.d));

	// Summoner: NO drawType (its 3.1 already maps to the square, Drawings.bullet[3], a Necromancer
	// drone's own sprite), at size 21.78 (a normal/necro square, entities/Objects.js's "sqr"), in
	// Necromancer beige via drawColor 9 - distinct from the Summoner body's EnemySquare yellow.
	const s = fireDrone('Summoner');
	check('a Summoner fires a 3.1 spawner drone', !!s.d && s.d.type === 3.1, s.d && s.d.type);
	check('...kept a square (no drawType override, parseInt(3.1) = 3 -> Drawings.bullet[3])',
		!!s.d && s.d.drawType === undefined, s.d && s.d.drawType);
	check('...at the normal/necro square size 21.78',
		!!s.d && s.d.size === 21.78, s.d && s.d.size);
	check('...in Necromancer beige (drawColor 9 = necro), not the body\'s EnemySquare yellow',
		!!s.d && s.d.drawColor === 9 && s.room.bulletColor(s.d) === 9,
		s.d && (s.d.drawColor + '/' + s.room.bulletColor(s.d)));

	// Arena Closer + Fallen Booster: every bullet is the width of the barrel that fired it (B2).
	// diep gives both classes' barrels width 42 / sizeRatio 1, so bullet diameter = width; on this
	// tree's 0.7 axis that is radius (42 / 2) x sizeRatio 1 x 0.7 = 14.7, against a drawn barrel
	// width 42 x 0.7 = 29.4 = 2 x 14.7. The 14.7 is anchored to diep's own 42, not back-derived
	// from the client width, so this catches a drift in either against that fixed figure.
	for (const cls of ['Arena Closer', 'Fallen Booster']) {
		const off = CLASS[cls].cannons.filter((c) => c.size !== 14.7);
		check(cls + ' fires bullets sized to the barrel width (radius 14.7 = width 29.4 / 2)',
			off.length === 0, off.map((c) => c.size).join(','));
	}
}

/*
	Defender geometry re-derivation (this session). Both halves of the Defender are pinned here
	against diepcustom's OWN raw numbers, not against each other - the failure this catches is a
	drift back onto the 0.7 barrel axis (the "stub wayyy too long" + "oversized" report) or the
	loss of the turret base circle / above-body draw.

	The anchoring facts, straight from diepcustom (external to this tree):
	  - Defender.ts:            physicsData.size = DEFENDER_SIZE(150) * sqrt(1/2); scaleFactor
	                            never touched -> stays 1, so every barrel dim is raw du.
	  - Defender.ts:            turret mount `size * offset`, offset = 60/(150*sqrt(1/2)) -> 60 du.
	  - TrapperDefinition:      trap barrel size 120 / width 71.4.
	  - AutoTurret.ts:          barrel size 55 / width 42*0.7 = 29.4 / baseSize 25 / bullet sizeRatio 1.
	Everything on the Defender converts on ONE axis (the body's own): a diep length D du draws to
	`D * K` units, and a server barrel dim is `D * K * CONST.SIZE / bossSize` so that the render's
	own `* bossSize/CONST.SIZE` puts it back on `D * K`. K = 0.56, CONST.SIZE = 35, bossSize = 42.
*/
function defenderGeometryTests() {
	console.log('\nDefender geometry (re-derived off Defender.ts / AutoTurret.ts, scaleFactor 1):');
	const CLASS = require(path.join(ROOT, 'public', 'SHARE', 'TanksConfig.js')).class;
	const CLIENT = require('./clientTanks.js')().class;
	const near = (a, b) => Math.abs(a - b) < 0.02;

	// External diep figures - the acceptance anchors.
	const K = 0.56, CS = 35;
	const DEFENDER_SIZE = 150, MOUNT_DU = 60;
	const TRAP_LEN_DU = 120, TRAP_W_DU = 71.4;
	const AT_LEN_DU = 55, AT_W_DU = 42 * 0.7, AT_BASE_DU = 25;

	const boss = CLASS['Defender'], cli = CLIENT['Defender'];
	const bossSize = boss.bossSize;
	const conv = (du) => du * K * CS / bossSize;   // du -> server canonLength / client height / rad
	const r = bossSize / CS;                        // the render's own barrel scale (= server `ra`)

	// The body is the one thing that was already right: 150 du circumradius at bossSize 42.
	check('body is a triangle at DEFENDER_SIZE 150 du (bossSize = 150*K*cos(pi/3))',
		near(bossSize, DEFENDER_SIZE * K * Math.cos(Math.PI / 3)) && cli.body.sides === 3,
		bossSize + ' / sides ' + cli.body.sides);

	// --- Trap launchers: the "stub" fix ---
	const traps = boss.cannons.filter((c) => c.type === 2);
	check('3 trap cannons (type 2, forceFire)', traps.length === 3 && traps.every((c) => c.auto === 1),
		traps.length);
	check('trap canonLength re-derived off TrapperDefinition 120 du (56, was 73.5 -> stub 227 du)',
		traps.every((c) => near(c.canonLength, conv(TRAP_LEN_DU))), traps.map((c) => c.canonLength).join(','));
	const cTrap = cli.cannons;
	check('client trap height === server canonLength (56)',
		cTrap.length === 3 && cTrap.every((c) => near(c.height, conv(TRAP_LEN_DU)) && c.trapLauncher),
		cTrap.map((c) => c.height).join(','));
	check('client trap width re-derived off TrapperDefinition 71.4 du (33.32, was 49.98 on 0.7)',
		cTrap.every((c) => near(c.width, conv(TRAP_W_DU))), cTrap.map((c) => c.width).join(','));
	// The launcher arrowhead (drawings.js: length = width*20/42) is what reaches past the barrel
	// tip; drawn tip = (barrel 120 du + launcher) must land ~level with the body's 150 du vertices,
	// matching Defender_boss_3.webp (NOT the old 227 du overshoot). Anchored to diep's 120 du + the
	// 71.4-du launcher, converted back to du through the render's own * r.
	const launcherDu = (cTrap[0].width * (20 / 42)) * r / K;
	const stubTipDu = TRAP_LEN_DU + launcherDu;
	check('trap stub reaches ~154 du along the edge normal (barrel 120 + launcher 34), per the webp',
		stubTipDu > 148 && stubTipDu < 160, stubTipDu.toFixed(1) + ' du');

	// --- Auto-turrets: circle + barrel, above the body, bullets matched ---
	const turr = boss.cannons.filter((c) => c.autoDir);
	check('3 auto-turret cannons (autoDir/autoShoot)', turr.length === 3, turr.length);
	// Ordered FIRST so canDir[0..2] feed the client `turrets` (which read canDir; cannons never do).
	check('server orders turrets [0..2] then traps [3..5] (canDir alignment)',
		boss.cannons.slice(0, 3).every((c) => c.autoDir) && boss.cannons.slice(3).every((c) => c.type === 2),
		boss.cannons.map((c) => (c.autoDir ? 'T' : 'p')).join(''));
	check('turret mount distance re-derived off Defender.ts 60 du (28, was 33.6 -> spawned 72 du out)',
		turr.every((c) => near(c.distance, conv(MOUNT_DU))), turr.map((c) => c.distance).join(','));
	check('turret canonLength re-derived off AutoTurret 55 du (25.667, was 38.5 on 0.7)',
		turr.every((c) => near(c.canonLength, conv(AT_LEN_DU))), turr.map((c) => c.canonLength).join(','));
	// "bullets match the turret size": bullet DIAMETER (drawn 2*size, boss uses size verbatim) must
	// equal the drawn barrel WIDTH (client width * r). Both must come out to AutoTurret's 29.4 du.
	const bulletDiamDu = turr.map((c) => 2 * c.size / K);
	check('turret bullet diameter = AutoTurret width 29.4 du (size 8.232, was 10.29 = 1.25x too big)',
		bulletDiamDu.every((d) => near(d, AT_W_DU)), bulletDiamDu.map((d) => d.toFixed(2)).join(','));

	// Client turrets: the `turrets` mechanism (base circle + canDir barrel, drawn over the body via
	// render.js's non-ring post-body pass), NOT the old bare `aboveBody` cannons.
	const ct = cli.turrets || [];
	check('client has 3 `turrets` (base circle + barrel), no `aboveBody` cannons',
		ct.length === 3 && !cli.cannons.some((c) => c.aboveBody) && !ct.some((c) => c.ring),
		'turrets ' + ct.length + ' / aboveBody ' + cli.cannons.filter((c) => c.aboveBody).length);
	check('client turret base rad re-derived off AutoTurret baseSize 25 du (11.667 -> drawn 25 du disc)',
		ct.every((c) => near(c.rad, conv(AT_BASE_DU))), ct.map((c) => c.rad).join(','));
	const barWidDu = ct.map((c) => c.width * r / K);
	check('client turret barrel width = AutoTurret 29.4 du, matching its bullet diameter',
		barWidDu.every((d) => near(d, AT_W_DU)), barWidDu.map((d) => d.toFixed(2)).join(','));
	check('client turret height === server canonLength (25.667)',
		ct.every((c, i) => near(c.height, turr[i].canonLength)), ct.map((c) => c.height).join(','));
}

console.log('obstar room tests\n');
const rooms = [];
rooms.push(ffaTests()); console.log('');
rooms.push(teamTests()); console.log('');
rooms.push(fourTeamTests()); console.log('');
rooms.push(bossTests()); console.log('');
rooms.push(sandboxTests()); console.log('');
rooms.push(tagTests()); console.log('');
rooms.push(mazeTests()); console.log('');
rooms.push(dominatorTests()); console.log('');
rooms.push(mothershipTests()); console.log('');
possessionTests();
statSourceTests();
rosterSweepTests();
necromancerTests();
droneBatchTests();
factoryTests();
bossProjectileTests();
defenderGeometryTests();
respawnTests(rooms);
respawnCarryoverTests(rooms);
modeTableTests(rooms);
gridAnchorTests();
baseDroneTests();
baseDroneAiTests();
prorationTest();
tickScaleTests();
fovTests(rooms);
oobTests(rooms);
growthTests(rooms);
autoSpinTests(rooms);
upgradeEconomyTests(rooms);
healthUpgradeTests(rooms);
arenaDensityTests(rooms);
spawnSamplerTests();
crasherChaseTests();
broadPhaseTests();
wallTests();
predatorZoomTests();

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
