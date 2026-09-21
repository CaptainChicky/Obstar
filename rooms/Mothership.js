/*
	Mothership: two teams, killable Mothership flagships instead of base strips. Losing a
	Mothership starts an Arena Closer close (same pattern as Tag).
*/
const Room = require('./Room.js');
const Player = require('../entities/Player.js');
const CLASS = require('../public/SHARE/TanksConfig.js').class;
const CONFIG = require('../lib/gameAI.js');

const ARENA_SIZE = 12488;
const MOTHERSHIP_HP = 7000;
const CLOSER_COUNT = 4;

class Mothership extends Room {
	constructor(id, controller) {
		super(id, {
			gm: 'mothership',
			maxXp: 30000,
			mapSize: { width: ARENA_SIZE, height: ARENA_SIZE },
			preGenerate: 2000,
			bootDelay: 1,
			shapeMix: { sqr0: 314, sqr1: 35, tri0: 118, tri1: 24, pnt0: 35, pnt1: 29 },
			betaPentRng: 0.99,
			bossRng: 2,
			maxBoss: 0,
			botCount: 3,
			botIdStart: 10,
			teams: [0, 1],
			teamPlay: true,
			respawnPow: 0.8,
			xpMul: 1,
			viewerBullets: false
		}, controller);
	}
	build() {
		this.closing = false;
		this.closers = [];
		let randAngle = Math.random() * Math.PI * 2;
		for (const team of this.rules.teams) {
			this.createMothership(team, randAngle);
			randAngle += Math.PI * 2 / this.rules.teams.length;
		}
	}
	createMothership(team, angle) {
		const mothership = this.INSTANCE.players.add((id) => {
			const m = new Player(
				{ GM: this.gm, sId: this.id, oId: id },
				Math.cos(angle) * this.map.width / 2 * 0.8,
				Math.sin(angle) * this.map.height / 2 * 0.8,
				'Mothership',
				team,
				this.XPLVL,
				this
			);
			m.hp = MOTHERSHIP_HP;
			m.maxHp = MOTHERSHIP_HP;
			m.mothership = 1;
			m.level = 140;
			m.absorb = 0.01;
			m.size = CLASS['Mothership'].bossSize;
			m.guardSize = m.size;
			m.class = 'Mothership';
			m.screen = Player.scriptedScreen('Mothership');
			m.shield = 0;
			m.up.MSpeed = 7;
			m.up.Reload = Math.pow(0.914, 7);
			m.up.BSpeed = 1 + 0.15 * 7;
			m.up.BPene = 1 + 0.75 * 7;
			m.up.BDamage = 1 + (3 / 7) * 7;
			m.damage = 5 + 7;
			m.up.HpRegan = 1;
			m.upNb = [7, 7, 7, 7, 7, 7, 7, 1];
			const spec = CONFIG.MOTHERSHIP;
			m.motion = spec[0].bind(m);
			m.update = spec[1].bind(m);
			return m;
		});
		if (mothership) { this.motherships.push(mothership); }
		return mothership;
	}
	winner() {
		return this.motherships.filter((m) => !m.destroy).length <= 1;
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
				this.rules.bossTeam,
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
		if (!this.destroy && !this.closing && this.winner()) {
			this.state = Room.ArenaState.OVER;
			this.startClosing();
			this.state = Room.ArenaState.CLOSING;
		}
		super.step();
	}
	respawn(id, force = 0, bot = 0) {
		if (this.closing && !force) { return; }
		return super.respawn(id, force, bot);
	}
	leaderRows(id) {
		const NAMES = ['Blue', 'Red'];
		return this.motherships
			.filter((m) => !m.destroy)
			.map((m) => ({ xp: Math.round(m.hp), name: (NAMES[m.team] || ('Team ' + m.team)) + ' Mothership', nameC: 0, team: m.team }))
			.sort((a, b) => b.xp - a.xp);
	}
	entityColor(player) {
		return Room.neutralColor(player) ?? player.team;
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

module.exports = Mothership;
