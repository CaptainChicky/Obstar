/*
	FourTeam - the same idea as TwoTeam with the sides in the corners instead of on the left
	and right.

	Team ids are 0..3 and are also colour indices (green, red, yellow, blue in
	public/SHARE/SocketSchema.js's `color` table), so every colour hook is just `player.team`,
	exactly as in TwoTeam.

	The one shape difference: a 2-team base is a strip down one side of the map, which lets
	inEnemyBase() be a single comparison on x. Four bases have to be corners, so a base here is
	the rules.baseSize square in the map corner (diep's own shape - it used to be a quarter-disc,
	which made a single orbit centre awkward to place). The guard drones orbit that one centre,
	inset from the two borders the corner touches, not the square's own centre.
	Everything else - joining the thinnest side, friendly fire, base fencing, boss summoning -
	comes from rooms/Room.js unchanged.
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
			// x1.96 on every cap to hold per-screen shape density constant against the x1.4 grid
			// rescale - FOV didn't grow, so the map's area did.
			objCaps: { sqr: { max0: 392, max1: 39 }, tri: { max0: 137, max1: 27 }, pnt: { max0: 43, max1: 31 } },
			betaPentRng: 0.99,
			bossRng: 0.9999,
			maxBoss: 1,
			botCount: 8,
			botIdStart: 10,
			teams: [0, 1, 2, 3],
			teamPlay: true,
			respawnPow: 0.8,
			baseSize: gu(67),
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
	/*
		Twelve drones per base around one shared orbit centre, on five discrete energy levels now
 rather than a continuous random band - levelPlan(12) gives caps
		[1,3,5,3,1] and starts the base at [1,3,4,3,1] drones on levels 1..5, all sharing one
		saturation ledger (`levels`) since they orbit the same centre. Phases are still random
		rather than evenly spaced, so the group reads clumpy the way basedrones.png does instead of
		as a formation. crossIn keeps the existing per-drone stagger (so the base doesn't empty out
		all at once every cross period) plus +-20% jitter so the crossings never re-sync.
	*/
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
		base here, where a literal four-sided box test would let it through. That outward-
		unbounded depth used to reach into and past the dark OOB band, which is what let the base
		kill a tank driving around the outside of a corner - rooms/Room.js's step() now bounds it
		to the drawn arena (inArena() && inEnemyBase()), so the dark band is
		neutral ground and this method's own unbounded-outward shape stays exactly as it is here.
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
		// entities/Player.js's size is a radius, so a level-0 tank is 56 units across.
		const inset = 56;
		const depth = () => inset + Math.random() * (this.baseSize - inset * 2);
		return {
			x: c.x - Math.sign(c.x) * depth(),
			y: c.y - Math.sign(c.y) * depth()
		};
	}
	entityColor(player) {
		return player.team;
	}
	mainColor(player) {
		return player.team;
	}
	bulletColor(bullet) {
		return bullet.color ? bullet.color - 1 : bullet.team;
	}
	leaderColor(player, viewerId) {
		return player.team;
	}
};

module.exports = FourTeam;
