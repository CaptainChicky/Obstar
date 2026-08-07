/*
	Survival - one shrinking arena, no teams, no respawn once it starts, last one standing wins.

	The one mode in the tree that actually gates anything on the arena state machine
	(rooms/Room.js's this.state) - every other mode opens straight into OPEN and never reads the
	field again. Here it does real work: COUNTDOWN holds the room open for joining/respawning
	while it waits for MIN_PLAYERS contenders, then OPEN cuts off every future respawn() call and
	starts the shrink/win-condition loop.

	Bots fill out the roster so a solo session actually reaches OPEN: they count toward the start
	gate and the win condition exactly like a human contender, but they hold off for a grace
	window first (BOT_GRACE) so real players get a real chance to fill the room themselves, then
	trickle in one at a time (BOT_INTERVAL) until the gate is met. Every contender - human or bot -
	is frozen and shielded for the whole wait, so nothing can die and force a respawn before the
	match actually opens. Once open, nothing comes back, bots included - the arena genuinely runs
	out of contenders as it shrinks.
*/
const Room = require('./Room.js');
const Player = require('../entities/Player.js');
const CLASS = require('../public/SHARE/TanksConfig.js').class;
const CONFIG = require('../lib/gameAI.js');
const clock = require('../lib/clock.js');
const tick = require('../lib/tick.js');

const MIN_PLAYERS = 10;
// config.ts: `countdownDuration = 10 * tps` (10 real seconds) - a wall-clock schedule like
// Tag.js's own SHRINK_EVERY, so it divides by the real step (clock.STEP_MS) rather than taking a
// lib/tick.js conversion.
const COUNTDOWN_TICKS = Math.round(10000 / clock.STEP_MS);
// How long the lobby holds out for real players before it starts padding with bots, and how far
// apart each padded bot arrives once it does - both real wall-clock schedules, same reasoning as
// COUNTDOWN_TICKS above.
const BOT_GRACE = Math.round(20000 / clock.STEP_MS);
const BOT_INTERVAL = Math.round(1200 / clock.STEP_MS);
const CLOSER_COUNT = 4;
// Survival.ts: `arenaSize = floor(25 * sqrt(max(playerCount, 1))) * 100` du - x0.56, shared by
// the room's starting size (sized for MIN_PLAYERS, not a lone joiner) and its live shrink.
const ARENA_UNIT_SCALE = 0.56;
function survivalArenaSize(playerCount) {
	return Math.floor(25 * Math.sqrt(Math.max(playerCount, 1))) * 100 * ARENA_UNIT_SCALE;
}

class Survival extends Room {
	constructor(id, controller) {
		super(id, {
			gm: 'survival',
			maxXp: 30000,
			// Sized for the match actually opening with MIN_PLAYERS contenders, not a lone
			// joiner - a solo lobby still gathers/pads up to that same roster before the match
			// ever starts, so the arena should not be sized as if it never would.
			mapSize: { width: survivalArenaSize(MIN_PLAYERS), height: survivalArenaSize(MIN_PLAYERS) },
			preGenerate: 200,
			bootDelay: 1,
			// No diep density formula carried over live (SurvivalShapeManager's own
			// `floor(12.5 * ceil((width/2500)^2))` re-evaluates every tick as the arena resizes) -
			// a static mix sized for the MIN_PLAYERS starting arena instead.
			shapeMix: { sqr0: 26, sqr1: 3, tri0: 12, tri1: 2, pnt0: 5, pnt1: 2 },
			betaPentRng: 0.99,
			bossRng: 2,   // diepcustom's Survival gamemode constructs no BossManager hook at all
			maxBoss: 0,
			// Enough bot slots to fill the whole roster solo (up to MIN_PLAYERS-1 bots).
			botCount: MIN_PLAYERS,
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
		// Real ticks spent in COUNTDOWN so far - what BOT_GRACE/BOT_INTERVAL measure against.
		this.gatherTicks = 0;
		// Survival.ts: `SCORE_PER_TICK = 0.2` - a live tank's own per-tick survival bonus,
		// independent of shape/kill XP, while the match is actually open.
		this.scorePerTick = 0.2;
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
	   back below MIN_PLAYERS during the wait never sneaks into OPEN early. Also paces the bot
	   padding: nobody joins until BOT_GRACE has given real players a clear run at filling the
	   room themselves, then one more trickles in every BOT_INTERVAL until the gate is met. */
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
	/* Seats one more bot - Survival's own gradual fill rather than the shared per-tick restock
	   loop, which can only revive a bot that already exists, not seat a brand new one. Mirrors
	   Room#createAi()'s own bot construction, one slot at a time. */
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
	/* Every contender is teleported to an independent uniform-random point the instant the match
	   opens, so nobody starts next to anybody - and everyone is granted a fresh spawn shield
	   right then, entities/Player.js's own protection duration, since the freeze/shield held
	   during COUNTDOWN ends the same tick this runs. */
	scatterContenders() {
		const openShield = tick.ticks(374);
		for (const p of this.aliveContenders()) {
			const pos = this.spawnPoint(p);
			p.x = pos.x; p.y = pos.y;
			p.vec.x = 0; p.vec.y = 0;
			p.shield = openShield;
		}
	}
	/* Survival.ts's own `setSurvivalArenaSize()` - writes newMap the same way Tag.js's shrink()
	   does, so the existing lerp in Room.step() does the actual moving. */
	setSurvivalArenaSize(playerCount) {
		const size = survivalArenaSize(playerCount);
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
			if (this.state === Room.ArenaState.COUNTDOWN) {
				// Nothing can be hurt behind the lobby screen: motion()/shoot() already treat every
				// real input as unpressed this tick (inputsFrozen()), so shield would otherwise just
				// bleed down to 0 with nothing left to re-arm it.
				for (const p of this.INSTANCE.players.live()) {
					if (!p.boss && !p.closer) { p.shield = 2; }
				}
			}
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
	/* No respawns once the match has left COUNTDOWN - diep's own `ArenaFlags.noJoining`. Freely
	   allowed during COUNTDOWN itself, which is what lets people into the match in the first place
	   (this engine has no separate waiting-room spawn step to flush on the OPEN transition - see
	   this file's header). */
	respawn(id, force = 0, bot = 0) {
		if (!this.allowsRespawn() && !force) { return; }
		return super.respawn(id, force, bot);
	}
	allowsRespawn() {
		return this.state === Room.ArenaState.COUNTDOWN;
	}
	/* Player input is suspended for the whole lobby wait - nobody moves, shoots or takes damage
	   until the match actually opens (step() is what holds shield up for that last part). */
	inputsFrozen() {
		return this.state === Room.ArenaState.COUNTDOWN;
	}
	// Survival seats no bots at boot - manageCountdown()'s own padOneBot() introduces them one at
	// a time once the gather grace elapses, so the lobby fills visibly instead of snapping full
	// the instant the room exists.
	createAi() { }
	/* The shared per-tick restock loop can only revive a bot that already exists; it has nothing
	   to do here since padOneBot() is Survival's own introduction path and nothing dies during a
	   frozen, shielded COUNTDOWN. */
	botBudget() {
		return 0;
	}
};

module.exports = Survival;
