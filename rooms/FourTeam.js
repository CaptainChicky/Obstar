/*
	FourTeam - the same idea as TwoTeam with the sides in the corners instead of on the left
	and right.

	Team ids are 0..3 and are also colour indices (green, red, yellow, blue in
	public/SHARE/SocketSchema.js's `color` table), so every colour hook is just `player.team`,
	exactly as in TwoTeam.

	Corner bases use baseSizeRatio squares; inEnemyBase() tests depth from each map corner.
	Team hooks otherwise match TwoTeam via Room.
*/
const config = require('../lib/config.js').config;
const tick = require('../lib/tick.js');
const World = require('../public/SHARE/World.js');
const gu = World.gu;
const Room = require('./Room.js');

class FourTeam extends Room {
	constructor(id, controller) {
		super(id, {
			gm: '4team',
			maxXp: 30000,
			mapSize: { width: gu(450), height: gu(450) },
			preGenerate: 2000,
			bootDelay: 1,
			shapeMix: { sqr0: 392, sqr1: 39, tri0: 137, tri1: 27, pnt0: 43, pnt1: 31 },
			betaPentRng: 0.99,
			bossRng: 0.9999,
			maxBoss: 1,
			botCount: 8,
			botIdStart: 10,
			teams: [0, 1, 2, 3],
			teamPlay: true,
			respawnPow: 0.8,
			// Fraction avoids float drift in baseSize (67/450 of map width).
			baseSizeRatio: { num: 67, den: 450 },
			viewerBullets: false
		}, controller);
	}
	/*
		Where a side's base sits, as the map corner it is built around. The order matches the
		team ids: 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right.
	*/
	corner(team) {
		return {
			x: ((team % 2) ? 1 : -1) * this.map.width / 2,
			y: ((team > 1) ? 1 : -1) * this.map.height / 2
		};
	}
	/* The orbit centre for a side's base - the centre of the baseSize square itself, derived from
		 baseSize rather than written as an inset so it cannot go stale across a base resize. Fit
		 check: the centre is gu(33.5) in and the outermost energy level is levelR(5) = gu(10), so
		 the outermost drone reaches gu(23.5) from either border - inside the gu(67) square with
		 room to spare. */
	baseCenter(team) {
		const c = this.corner(team);
		return {
			x: c.x - Math.sign(c.x) * this.baseSize / 2,
			y: c.y - Math.sign(c.y) * this.baseSize / 2
		};
	}
	/* Twelve drones per corner base, one shared levelPlan ledger per base. */
	basePosts() {
		const PER_BASE = 12;
		const posts = [];
		for (const team of this.rules.teams) {
			const c = this.baseCenter(team);
			const plan = this.levelPlan(PER_BASE);
			// The whole returned object IS the ledger now (caps/target/
			// crossCap/count/crossing/targets/threat/scoutIdx/scoutTimer/sortTimer all live on it),
			// so this base's twelve posts share it by reference straight from levelPlan() rather
			// than each mode rebuilding a subset of the same fields by hand.
			const levels = plan;
			for (let i = 0; i < PER_BASE; i++) {
				const jitter = 1 + (Math.random() * 2 - 1) * 0.2;
				posts.push({
					team: team,
					x: c.x,
					y: c.y,
					level: plan.initial[i],
					phase: Math.random() * Math.PI * 2,
					levels: levels,
					crossIn: Math.max(1, Math.round(tick.ticks(config.BASE_DRONE_CROSS) *
						(i + 1) / PER_BASE * jitter))
				});
			}
		}
		return posts;
	}
	/* Bots dealt round-robin across the four sides, starting from a random one. */
	botRoster() {
		const offset = Math.floor(Math.random() * this.rules.teams.length);
		const roster = [];
		for (let i = 0; i < this.rules.botCount; i++) {
			roster.push({
				id: this.rules.botIdStart + i,
				team: this.rules.teams[(offset + i) % this.rules.teams.length]
			});
		}
		return roster;
	}
	/* Every side stays stocked no matter how many humans are in the room. */
	botBudget(humanCount) {
		return Infinity;
	}
	/*
		Set foot in anyone else's corner square and you die there. `margin` pushes the two inner
		faces (the ones facing the middle of the map) deeper into the base, for anything allowed
		to cross the line before it counts - see rooms/Room.js's step().

		Depth is measured inward from the map edge on each axis, so it is 0 at the corner itself
		and grows toward the middle. Deliberately unbounded on the outward side: a point in the
		out-of-bounds margin past the corner has a negative depth and still tests as inside the
		base here; step() only applies the kill inside inArena().
	*/
	inEnemyBase(obj, margin = 0) {
		// Anything not on a side - a boss, team 9 - belongs to no base and is fenced out of
		// none, matching TwoTeam, whose switch simply has no arm for it.
		if (this.rules.teams.indexOf(obj.team) < 0) { return false; }
		for (const team of this.rules.teams) {
			if (team === obj.team) { continue; }
			const c = this.corner(team);
			const dx = (c.x > 0) ? c.x - obj.x : obj.x - c.x;
			const dy = (c.y > 0) ? c.y - obj.y : obj.y - c.y;
			if (dx < this.baseSize - margin && dy < this.baseSize - margin) {
				return true;
			}
		}
		return false;
	}
	/* You always come back inside your own square, a tank diameter clear of the map walls. */
	spawnPoint(tank) {
		const c = this.corner(tank.team);
		const inset = 56; // tank body diameter at spawn
		const depth = () => inset + Math.random() * (this.baseSize - inset * 2);
		return {
			x: c.x - Math.sign(c.x) * depth(),
			y: c.y - Math.sign(c.y) * depth()
		};
	}
	entityColor(player) {
		return player.boss ? Room.bossColor(player) : (Room.neutralColor(player) ?? player.team);
	}
	mainColor(player) {
		return player.team;
	}
	leaderColor(player, viewerId) {
		return player.team;
	}
};

module.exports = FourTeam;
