/*
	Survival: lobby countdown, no respawn after open, arena shrinks with alive count, last standing wins.
	Only mode that drives Room.state beyond OPEN by default.
*/
const Room = require('./Room.js');
const Player = require('../entities/Player.js');
const CLASS = require('../public/SHARE/TanksConfig.js').class;
const CONFIG = require('../lib/gameAI.js');
const clock = require('../lib/clock.js');
const tick = require('../lib/tick.js');

const MIN_PLAYERS = 10;
const COUNTDOWN_TICKS = Math.round(10000 / clock.STEP_MS);
const BOT_GRACE = Math.round(20000 / clock.STEP_MS);
const BOT_INTERVAL = Math.round(1200 / clock.STEP_MS);
const CLOSER_COUNT = 4;
const ARENA_UNIT_SCALE = 0.56;
function survivalArenaSize(playerCount) {
	return Math.floor(25 * Math.sqrt(Math.max(playerCount, 1))) * 100 * ARENA_UNIT_SCALE;
}

class Survival extends Room {
	constructor(id, controller) {
		super(id, {
			gm: 'survival',
			maxXp: 30000,
			mapSize: { width: survivalArenaSize(MIN_PLAYERS), height: survivalArenaSize(MIN_PLAYERS) },
			preGenerate: 200,
			bootDelay: 1,
			shapeMix: { sqr0: 26, sqr1: 3, tri0: 12, tri1: 2, pnt0: 5, pnt1: 2 },
			betaPentRng: 0.99,
			bossRng: 2,
			maxBoss: 0,
			botCount: MIN_PLAYERS,
			botIdStart: 10,
			teams: [1],
			teamPlay: false,
			respawnPow: 0.9,
			xpMul: 3,
			viewerBullets: true
		}, controller);
	}
	build() {
		this.state = Room.ArenaState.COUNTDOWN;
		this.ticksUntilStart = COUNTDOWN_TICKS;
		this.playersNeeded = MIN_PLAYERS;
		this.closing = false;
		this.closers = [];
		this.gatherTicks = 0;
		this.scorePerTick = 0.2;
	}
	aliveContenders() {
		const list = [];
		for (const p of this.INSTANCE.players.live()) {
			if (!p.boss && !p.closer && !p.dead && !p.destroy) { list.push(p); }
		}
		return list;
	}
	manageCountdown() {
		if (this.state !== Room.ArenaState.COUNTDOWN) { return; }
		this.gatherTicks++;
		if (this.gatherTicks >= BOT_GRACE && this.contenderCount() < MIN_PLAYERS
			&& (this.gatherTicks - BOT_GRACE) % BOT_INTERVAL === 0) {
			this.padOneBot();
		}
		this.playersNeeded = Math.max(0, MIN_PLAYERS - this.contenderCount());
		if (this.playersNeeded > 0) {
			this.ticksUntilStart = COUNTDOWN_TICKS;
			return;
		}
		this.ticksUntilStart--;
		if (this.ticksUntilStart < 0) {
			this.state = Room.ArenaState.OPEN;
			this.scatterContenders();
		}
	}
	padOneBot() {
		const slot = this.botRoster()[this.bots.length];
		if (!slot) { return; }
		const bot = new Player(
			{ GM: this.gm, sId: this.id, oId: slot.id },
			0, 0,
			CONFIG.BOT_NAMES[Math.floor(Math.random() * (CONFIG.BOT_NAMES.length - 1))],
			slot.team, this.XPLVL, this
		);
		bot.motion = CONFIG.BOTS[0].bind(bot);
		bot.bot = 1;
		bot.xp = 5000 + Math.floor(Math.random() * 60000);
		this.INSTANCE.players.set(slot.id, bot);
		this.bots.push(slot.id);
		this.respawn(slot.id, 1, 1);
	}
	scatterContenders() {
		const openShield = tick.ticks(374);
		for (const p of this.aliveContenders()) {
			const pos = this.spawnPoint(p);
			p.x = pos.x; p.y = pos.y;
			p.vec.x = 0; p.vec.y = 0;
			p.shield = openShield;
		}
	}
	setSurvivalArenaSize(playerCount) {
		const size = survivalArenaSize(playerCount);
		this.newMap.width = size;
		this.newMap.height = size;
	}
	updateSurvivalState() {
		const alive = this.aliveContenders();
		this.setSurvivalArenaSize(alive.length);
		if (alive.length <= 1 && this.state === Room.ArenaState.OPEN) {
			this.state = Room.ArenaState.OVER;
			this.closing = true;
			this.startClosing();
		}
	}
	startClosing() {
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
		if (!this.destroy) {
			this.manageCountdown();
			if (this.state === Room.ArenaState.COUNTDOWN) {
				for (const p of this.INSTANCE.players.live()) {
					if (!p.boss && !p.closer) { p.shield = 2; }
				}
			}
			if (this.state === Room.ArenaState.OPEN) {
				this.updateSurvivalState();
				for (const p of this.INSTANCE.players.live()) {
					if (!p.bot && !p.boss && !p.closer && !p.dead && !p.destroy) { p.xp += this.scorePerTick; }
				}
			}
		}
		super.step();
	}
	respawn(id, force = 0, bot = 0) {
		if (!this.allowsRespawn() && !force) { return; }
		return super.respawn(id, force, bot);
	}
	allowsRespawn() {
		return this.state === Room.ArenaState.COUNTDOWN;
	}
	inputsFrozen() {
		return this.state === Room.ArenaState.COUNTDOWN;
	}
	createAi() { }
	botBudget() {
		return 0;
	}
};

module.exports = Survival;
