/*
	Tag: four teams, no bases, shrinking arena, team headcount leaderboard.

	Tagging latches on once every team has at least MIN_PER_TEAM players; until then respawnTeam
	keeps your colour. After latch, kills move you to the killer's team (boss kills excluded).

	Shrink steps map lerp every SHRINK_EVERY ticks by SHRINK_FACTOR until SHRINK_FLOOR. When only
	one team has players, startClosing() spawns CLOSER_COUNT invincible closers and blocks respawn.
*/
const World = require('../public/SHARE/World.js');
const gu = World.gu;
const clock = require('../lib/clock.js');
const Room = require('./Room.js');
const Player = require('../entities/Player.js');
const CLASS = require('../public/SHARE/TanksConfig.js').class;
const CONFIG = require('../lib/gameAI.js');

// Invincible closers need no replenishment; a small burst is enough for this lobby size.
const CLOSER_COUNT = 4;
const INVIS_FLOOR = 0.15;

const SHRINK_EVERY = Math.round(12500 / clock.STEP_MS);
const SHRINK_FACTOR = 0.95;
const SHRINK_FLOOR = gu(150);

const MIN_PER_TEAM = 4;

class Tag extends Room {
	constructor(id, controller) {
		super(id, {
			gm: 'tag',
			maxXp: 30000,
			mapSize: { width: gu(400), height: gu(400) },
			preGenerate: 2000,
			bootDelay: 1,
			shapeMix: { sqr0: 392, sqr1: 39, tri0: 137, tri1: 27, pnt0: 43, pnt1: 31 },
			betaPentRng: 0.99,
			bossRng: 0.9999,
			maxBoss: 1,
			botCount: 16,
			botIdStart: 10,
			maxPlayer: 30,
			teams: [0, 1, 2, 3],
			teamPlay: true,
			respawnPow: 0.8,
			xpMul: 3,
			viewerBullets: false,
			invisFloor: INVIS_FLOOR
		}, controller);
	}
	build() {
		this.shrinkIn = SHRINK_EVERY;
		this.closing = false;
		this.closers = [];
		this.tagged = false;
	}
	respawnTeam(tank) {
		if (!this.tagging()) { return tank.team; }
		const m = tank.murder;
		if (!m || m === -1 || m[0] !== 'players') { return tank.team; }
		const killer = this.INSTANCE.players.get(m[1].oId);
		if (!killer || killer.boss) { return tank.team; }
		if (this.rules.teams.indexOf(killer.team) < 0) { return tank.team; }
		return killer.team;
	}
	teamCounts() {
		const count = new Array(this.rules.teams.length).fill(0);
		for (const p of this.INSTANCE.players.live()) {
			if (p.boss) { continue; }
			const t = this.rules.teams.indexOf(p.team);
			if (t >= 0) { count[t]++; }
		}
		return count;
	}
	tagging() {
		if (!this.tagged) {
			this.tagged = Math.min.apply(null, this.teamCounts()) >= MIN_PER_TEAM;
		}
		return this.tagged;
	}
	shrink() {
		if (--this.shrinkIn > 0) { return; }
		this.shrinkIn = SHRINK_EVERY;
		const next = Math.max(SHRINK_FLOOR, this.newMap.width * SHRINK_FACTOR);
		this.newMap.width = next;
		this.newMap.height = next;
	}
	winner() {
		if (!this.tagging()) { return false; }
		return this.teamCounts().filter((n) => n > 0).length === 1;
	}
	startClosing() {
		this.closing = true;
		for (let i = 0; i < CLOSER_COUNT; i++) { this.createCloser(); }
	}
	createCloser() {
		const spec = CONFIG.CLOSER[0];
		const pos = this.spawnPoint();
		const closer = this.INSTANCE.players.add((id) => {
			const c = new Player(
				{ GM: this.gm, sId: this.id, oId: id },
				pos.x, pos.y,
				spec[2],
				this.rules.neutralTeam,
				this.XPLVL,
				this
			);
			c.closer = 1;
			c.class = spec[2];
			c.screen = Player.scriptedScreen(c.class);
			c.size = 98;
			c.guardSize = c.size;
			c.damage = 50;
			c.up.BSpeed = 1 + 0.15 * 7;
			c.hp = c.maxHp = this.rules.bossHp;
			c.shield = 0;
			c.motion = spec[0].bind(c);
			c.update = spec[1].bind(c);
			return c;
		});
		if (closer) { this.closers.push(closer); }
		return closer;
	}
	step() {
		if (!this.destroy) {
			this.shrink();
			if (!this.closing && this.winner()) { this.startClosing(); }
		}
		super.step();
	}
	respawn(id, force = 0, bot = 0) {
		if (this.closing && !force) { return; }
		return super.respawn(id, force, bot);
	}
	leaderRows(id) {
		const NAMES = ['Green', 'Red', 'Yellow', 'Blue'];
		const count = this.teamCounts();
		return this.rules.teams
			.map((team, i) => ({ xp: count[i], name: NAMES[i] || ('Team ' + team), nameC: 0, team: team }))
			.sort((a, b) => b.xp - a.xp);
	}
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
	botBudget(humanCount) {
		return Infinity;
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

module.exports = Tag;
