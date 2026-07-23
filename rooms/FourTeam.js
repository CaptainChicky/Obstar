/*
	FourTeam - the same idea as TwoTeam with the sides in the corners instead of on the left
	and right.

	Team ids are 0..3 and are also colour indices (green, red, yellow, blue in
	public/SHARE/SocketSchema.js's `color` table), so every colour hook is just `player.team`,
	exactly as in TwoTeam.

	The one shape difference: a 2-team base is a strip down one side of the map, which lets
	inEnemyBase() be a single comparison on x. Four bases have to be corners, so a base here is
	a quarter-disc of radius rules.baseSize centred on the map corner, and the guard drones sit
	on its arc facing the middle. Everything else - joining the thinnest side, friendly fire,
	base fencing, boss summoning - comes from rooms/Room.js unchanged.
*/
const RT = require('../lib/runtime.js');
const Room = require('./Room.js');

class FourTeam extends Room {
	constructor(id) {
		super(id, {
			gm: '4team',
			maxXp: 30000,
			mapSize: { width: 9000, height: 9000 },
			preGenerate: 1000,
			bootDelay: 1,
			objCaps: { sqr: { max0: 200, max1: 20 }, tri: { max0: 70, max1: 14 }, pnt: { max0: 22, max1: 16 } },
			betaPentRng: 0.99,
			bossRng: 0.9999,
			maxBoss: 1,
			botCount: 8,
			botIdStart: 10,
			teams: [0, 1, 2, 3],
			teamPlay: true,
			respawnPow: 0.8,
			baseSize: 900,
			viewerBullets: false
		});
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
	/* A fence of immortal guard drones along the arc of each base, facing the middle. */
	build() {
		this.droneQt = 8;
		for (const team of this.rules.teams) {
			const c = this.corner(team);
			// The quarter turn that faces the centre of the map from this corner.
			const from = Math.atan2(-Math.sign(c.y), -Math.sign(c.x)) - Math.PI / 4;
			for (let i = 0; i < this.droneQt; i++) {
				const a = from + (Math.PI / 2) * (i + 0.5) / this.droneQt;
				const bull = new RT.Bullet(
					{ "GM": this.gm, "sId": this.id, "oId": -1 },
					c.x + Math.cos(a) * this.baseSize,
					c.y + Math.sin(a) * this.baseSize,
					0,
					0,
				);
				bull.id = { "GM": this.gm, "sId": this.id, "oId": this.INSTANCE.bullets.length };
				bull.team = team;
				bull.ox = bull.x;
				bull.oy = bull.y;
				bull.alone = 1;
				bull.life = -1;
				bull.type = 1.4;
				bull.maxspeed = .75;
				bull.pene = 200;
				bull.damage = .1;
				bull.weight = 2;
				bull.size = 20;
				bull.map = this.map;
				this.INSTANCE.bullets.push(bull);
			}
		}
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
	/* Set foot in anyone else's corner and you die there. */
	inEnemyBase(obj) {
		// Anything not on a side - a boss, team 9 - belongs to no base and is fenced out of
		// none, matching TwoTeam, whose switch simply has no arm for it.
		if (this.rules.teams.indexOf(obj.team) < 0) { return false; }
		for (const team of this.rules.teams) {
			if (team === obj.team) { continue; }
			const c = this.corner(team);
			if (Math.pow(obj.x - c.x, 2) + Math.pow(obj.y - c.y, 2) < this.baseSize * this.baseSize) {
				return true;
			}
		}
		return false;
	}
	/* You always come back inside your own corner, clear of your own guard drones. */
	spawnPoint(tank) {
		const c = this.corner(tank.team);
		const from = Math.atan2(-Math.sign(c.y), -Math.sign(c.x)) - Math.PI / 4;
		const a = from + (Math.PI / 2) * Math.random();
		const r = this.baseSize * (0.15 + 0.7 * Math.random());
		return { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
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
