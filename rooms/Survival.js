/*
	Survival - one shrinking arena, no teams, no respawn once it starts, last one standing wins.

	The one mode in the tree that actually gates anything on the arena state machine
	(rooms/Room.js's this.state) - every other mode opens straight into OPEN and never reads the
	field again. Here it does real work: COUNTDOWN holds the room open for joining/respawning
	while it waits for MIN_PLAYERS contenders, then OPEN cuts off every future respawn() call and
	starts the shrink/win-condition loop.

	Bots fill out the roster so a solo session actually reaches OPEN: they count toward the start
	gate and the win condition exactly like a human contender, and they freely respawn while the
	room is still waiting. Once the match is open nothing comes back, bots included - the arena
	genuinely runs out of contenders as it shrinks.
*/
const Room = require('./Room.js');
const Player = require('../entities/Player.js');
const CLASS = require('../public/SHARE/TanksConfig.js').class;
const CONFIG = require('../lib/gameAI.js');
const clock = require('../lib/clock.js');

const MIN_PLAYERS = 4;
// config.ts: `countdownDuration = 10 * tps` (10 real seconds) - a wall-clock schedule like
// Tag.js's own SHRINK_EVERY, so it divides by the real step (clock.STEP_MS) rather than taking a
// lib/tick.js conversion.
const COUNTDOWN_TICKS = Math.round(10000 / clock.STEP_MS);
const CLOSER_COUNT = 4;
// Survival.ts: `arenaSize = floor(25 * sqrt(max(playerCount, 1))) * 100` du - x0.56 folded into
// the one place this formula is evaluated (setSurvivalArenaSize() below) rather than carried as
// a separate constant.
const ARENA_UNIT_SCALE = 0.56;

class Survival extends Room {
	constructor(id, controller) {
		super(id, {
			gm: 'survival',
			maxXp: 30000,
			// Survival.ts's own constructor: `setSurvivalArenaSize(0)` - the one-player floor,
			// floor(25*sqrt(1))*100 du x0.56 = 1400 units.
			mapSize: { width: 1400, height: 1400 },
			preGenerate: 200,
			bootDelay: 1,
			// No diep density formula carried over live (SurvivalShapeManager's own
			// `floor(12.5 * ceil((width/2500)^2))` re-evaluates every tick as the arena resizes -
			// PENDING.md) - a static mix sized for the MIN_PLAYERS starting arena instead,
			// roughly diep's own floor(12.5*4)=50 total at that size.
			shapeMix: { sqr0: 26, sqr1: 3, tri0: 12, tri1: 2, pnt0: 5, pnt1: 2 },
			betaPentRng: 0.99,
			bossRng: 2,   // diepcustom's Survival gamemode constructs no BossManager hook at all
			maxBoss: 0,
			botCount: 5,
			botIdStart: 10,
			teams: [1],
			teamPlay: false,
			respawnPow: 0.9,
			// Survival.ts: `shapeScoreRewardMultiplier = 3.0` (shape XP only, not kill XP) - same
			// "no separate hook to carry it into" gap as rooms/Mothership.js's own note; left at
			// the ordinary x1 rather than mis-applying it to kills too.
			xpMul: 1,
			viewerBullets: true
		}, controller);
	}
	build() {
		this.state = Room.ArenaState.COUNTDOWN;
		this.ticksUntilStart = COUNTDOWN_TICKS;
		this.playersNeeded = MIN_PLAYERS;
		this.closing = false;
		this.closers = [];
		// Survival.ts: `SCORE_PER_TICK = 0.2` - a live tank's own per-tick survival bonus,
		// independent of shape/kill XP, while the match is actually open.
		this.scorePerTick = 0.2;
	}
	/* Everyone the match is waiting on - humans and bots alike, alive or mid-respawn. Scripted
	   entities (bosses, Closers) are not contenders. */
	contenderCount() {
		let n = 0;
		for (const p of this.INSTANCE.players.live()) { if (!p.boss && !p.closer) { n++; } }
		return n;
	}
	/* Every contender with a live tank right now - what the shrink formula and the win condition
	   both read. */
	aliveContenders() {
		const list = [];
		for (const p of this.INSTANCE.players.live()) {
			if (!p.boss && !p.closer && !p.dead && !p.destroy) { list.push(p); }
		}
		return list;
	}
	/* Survival.ts's own manageCountdown() override: reset the timer every tick the gate is not
	   yet satisfied, only actually counting down once it is - so a match that loses a player
	   back below MIN_PLAYERS during the wait never sneaks into OPEN early. */
	manageCountdown() {
		if (this.state !== Room.ArenaState.COUNTDOWN) { return; }
		const humans = this.contenderCount();
		this.playersNeeded = Math.max(0, MIN_PLAYERS - humans);
		if (this.playersNeeded > 0) {
			this.ticksUntilStart = COUNTDOWN_TICKS;
			return;
		}
		this.ticksUntilStart--;
		if (this.ticksUntilStart < 0) {
			this.state = Room.ArenaState.OPEN;
		}
	}
	/* Survival.ts's own `setSurvivalArenaSize()` - writes newMap the same way Tag.js's shrink()
	   does, so the existing lerp in Room.step() does the actual moving. */
	setSurvivalArenaSize(playerCount) {
		const size = Math.floor(25 * Math.sqrt(Math.max(playerCount, 1))) * 100 * ARENA_UNIT_SCALE;
		this.newMap.width = size;
		this.newMap.height = size;
	}
	/* Survival.ts's own updateArenaState() - shrink to match the current alive count, then
	   check the win condition (one player left, or the room started with exactly one and that
	   one is still standing). */
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
			c.guardSize = c.size;   // circle body
			c.damage = 50;
			c.up.BSpeed = 1 + 0.15 * 7;   // maxed BSpeed slope at 7 points - see rooms/Tag.js's own createCloser()
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
			if (this.state === Room.ArenaState.OPEN) {
				this.updateSurvivalState();
				// Survival.ts: `SCORE_PER_TICK` - awarded straight to xp (this engine has no
				// separate score/xp split), only to a live human tank, only while genuinely open.
				for (const p of this.INSTANCE.players.live()) {
					if (!p.bot && !p.boss && !p.closer && !p.dead && !p.destroy) { p.xp += this.scorePerTick; }
				}
			}
		}
		super.step();
	}
	/* No respawns once the match is actually open - diep's own `ArenaFlags.noJoining`, set the
	   instant COUNTDOWN ends. Freely allowed during COUNTDOWN itself, which is what lets people
	   into the match in the first place (this engine has no separate waiting-room spawn step to
	   flush on the OPEN transition - see this file's header). */
	respawn(id, force = 0, bot = 0) {
		if (this.state === Room.ArenaState.OPEN && !force) { return; }
		return super.respawn(id, force, bot);
	}
	/* Bots refill freely while the room is still waiting to start; once the match is open nothing
	   comes back, bots included. */
	botBudget(humanCount) {
		return (this.state === Room.ArenaState.COUNTDOWN) ? Infinity : 0;
	}
};

module.exports = Survival;
