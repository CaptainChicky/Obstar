/*
	TwoTeam - two sides, a base each, and a boss that turns up about once every ten thousand
	spawn rolls.

	The simulation lives in rooms/Room.js. What is left here is what actually makes this a
	team mode: joining players are balanced across the two sides, tanks and bullets take their
	colour from their team instead of from who is looking, team mates cannot hurt each other
	or be targeted by each other's drones, each side spawns in and is fenced out of a base
	strip, and ten guard drones sit in front of each base from the moment the room opens.
*/
const config = require('../lib/config.js').config;
const tick = require('../lib/tick.js');
const World = require('../public/SHARE/World.js');
const gu = World.gu;
const Room = require('./Room.js');

class TwoTeam extends Room {
	constructor(id, controller) {
		super(id, {
			gm: '2team',
			maxXp: 30000,
			mapSize: { width: gu(400), height: gu(400) },
			preGenerate: 2000,
			bootDelay: 1,
			// The shape MIX only - the TOTAL is diep's 1-per-200-gu^2 density now (PENDING #19,
			// plan.md step 6), which takes this mode 555 -> 800 shapes at its unchanged gu(400)
			// arena. These are verbatim the objCaps this mode used to state.
			shapeMix: { sqr0: 314, sqr1: 35, tri0: 118, tri1: 24, pnt0: 35, pnt1: 29 },
			betaPentRng: 0.99,
			bossRng: 0.9999,
			maxBoss: 1,
			botCount: 3,
			botIdStart: 10,
			teams: [0, 1],
			teamPlay: true,
			respawnPow: 0.8,
			// gu(40) of this mode's gu(400) map, stated as the fraction it is rather than the
			// absolute it was (PENDING #19, plan.md step 6), so the strip stays a tenth of the
			// arena's width if the arena is ever resized. At today's fixed gu(400) this is exactly
			// gu(40), unchanged - test/rooms.js pins that.
			baseSizeRatio: { num: 40, den: 400 },
			viewerBullets: false
		}, controller);
	}
	/*
		Fifteen orbit centres down each side's base strip, each hosting a PAIR of drones - the
		wiki's "30 Base Drones in total ... spread evenly in pairs", which counts one side, so
		60 in the room. Each pair sits on its own share of the same five discrete energy levels
		4team uses (levelPlan(2) gives caps [1,1,1,1,1] and starts the pair on
		levels 2 and 3) rather than a per-mode nominalR band - a level is an absolute size in the
		user's spec, not something that scales per mode, so the old `spacing * 0.3` nominal radius
		is gone. Random phases, same clumpy-not-rigid treatment as 4team's single ring.

		The centre spacing comes off the map height, not a literal, so resizing the map cannot
		make adjacent centres overlap: at the current 11200-tall map the spacing is 746.7 units =
		26.7gu, comfortably clear of 2*levelR(5) = 560 (checked in test/rooms.js). The across-strip
		position is derived from baseSize (the same derivation as 4team's baseCenter())
		rather than a literal gu(24) inset, so the drones sit centred across the strip's width
		instead of at whatever inset a past base resize happened to leave behind. Everything else
		about the drones (speed, cross period, leash, detector range) is shared, and lives in
		entities/Bullet.js's one type-1.4 AI.
	*/
	basePosts() {
		const CENTRES = 15, PER_CENTRE = 2;
		const spacing = this.map.height / CENTRES;
		const posts = [];
		for (const team of this.rules.teams) {
			const side = team ? 1 : -1;
			for (let i = 0; i < CENTRES; i++) {
				const plan = this.levelPlan(PER_CENTRE);
				// The whole returned object IS the ledger now - see
				// FourTeam.js's basePosts() for why this centre's posts share it by reference
				// straight from levelPlan() rather than rebuilding a subset of it.
				const levels = plan;
				for (let d = 0; d < PER_CENTRE; d++) {
					posts.push({
						team: team,
						x: side * (this.map.width / 2 - this.baseSize / 2),
						y: spacing * (i + 0.5) - this.map.height / 2,
						level: plan.initial[d],
						phase: Math.random() * Math.PI * 2,
						levels: levels,
						// Staggered across the side's whole roster, so a base's drones cut across
						// their rings one after another instead of all on the same tick.
						crossIn: Math.max(1, Math.round(tick.ticks(config.BASE_DRONE_CROSS) *
							(i * PER_CENTRE + d + 1) / (CENTRES * PER_CENTRE)))
					});
				}
			}
		}
		return posts;
	}
	/* Three bots, alternating sides, starting from one side or the other at random. */
	botRoster() {
		const start = this.rules.botIdStart + Math.floor(Math.random() * 2);
		const roster = [];
		for (let i = start; i < start + this.rules.botCount; i++) {
			roster.push({ id: i, team: i % 2 });
		}
		return roster;
	}
	/* Both sides stay stocked no matter how many humans are in the room. */
	botBudget(humanCount) {
		return Infinity;
	}
	/*
		Cross the strip in front of the other side's base and you die on the spot - `margin` past
		it, for anything allowed to penetrate first (bullets). Only this line moves; the far side
		of the strip is the map wall. A bare half-plane in x with no y bound at all, so it is
		still unbounded past the map's y edges too - rooms/Room.js's step() bounds it to the drawn
		arena (inArena() && inEnemyBase()), so the dark OOB band is neutral
		ground and this method's own shape stays exactly as it is here.
	*/
	inEnemyBase(obj, margin = 0) {
		const edge = this.map.width / 2 - this.baseSize;
		switch (obj.team) {
			case 0: return obj.x > edge + margin;
			case 1: return obj.x < -edge - margin;
		}
		return false;
	}
	/* You always come back inside your own base. */
	spawnPoint(tank) {
		return {
			x: tank.team ? this.map.width / 2 - this.baseSize * Math.random() : -this.map.width / 2 + this.baseSize * Math.random(),
			y: gu(10) + Math.random() * (this.map.height - gu(20)) - this.map.height / 2
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

module.exports = TwoTeam;
