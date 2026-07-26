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
			// x1.96 on every cap to hold per-screen shape density constant against the x1.4 grid
			// rescale (plan.md D1) - FOV didn't grow, so the map's area did.
			objCaps: { sqr: { max0: 314, max1: 35 }, tri: { max0: 118, max1: 24 }, pnt: { max0: 35, max1: 29 } },
			betaPentRng: 0.99,
			bossRng: 0.9999,
			maxBoss: 1,
			botCount: 3,
			botIdStart: 10,
			teams: [0, 1],
			teamPlay: true,
			respawnPow: 0.8,
			baseSize: 600,
			viewerBullets: false
		}, controller);
	}
	/*
		Fifteen orbit centres down each side's base strip, each hosting a PAIR of drones on
		opposite points of its ring - the wiki's "30 Base Drones in total ... spread evenly in
		pairs", which counts one side, so 60 in the room.

		The ring radius comes off the centre spacing rather than a literal, so resizing the map
		cannot make adjacent rings overlap: at the current 8000-tall map the spacing is 533 and
		the rings are ~160 across. That is deliberately tighter than 4team's single twelve-drone
		ring (E4) - fifteen of these have to fit down the strip without touching. Everything else
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
				for (let d = 0; d < PER_CENTRE; d++) {
					posts.push({
						team: team,
						x: side * (this.map.width / 2 - this.baseSize / 2),
						y: spacing * (i + 0.5) - this.map.height / 2,
						orbitR: spacing * 0.3,
						phase: Math.PI * d,
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
		of the strip is the map wall.
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
