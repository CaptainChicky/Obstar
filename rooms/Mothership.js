/*
	Mothership - two sides, no bases in the usual sense: each team's "base" is a real, killable
	Mothership tank (diepcustom Entity/Misc/Mothership.ts + Gamemodes/Mothership.ts, plan.md G1).
	Lose your Mothership and the match starts closing - the same Arena Closer swarm Tag's own win
	condition spawns (rooms/Tag.js's startClosing()/createCloser()), generalised here rather than
	duplicated.

	No drone-post base strip (rooms/TwoTeam.js's basePosts()/inEnemyBase()) - that whole system is
	this engine's own custom mechanic (plan.md G4/K3, no diep counterpart), and diep's real
	Mothership mode has no equivalent: the Mothership tank itself IS the base, an ordinary (if
	very durable) killable body with no keep-out strip around it. Team balancing, colours-by-team
	and bullet/bulletColor all fall out of the same rules.teams/teamPlay knobs every other team
	mode already uses - only the Mothership itself and the win condition are new here.
*/
const Room = require('./Room.js');
const Player = require('../entities/Player.js');
const CLASS = require('../public/SHARE/TanksConfig.js').class;
const CONFIG = require('../lib/gameAI.js');

// diepcustom Gamemodes/Mothership.ts: `arenaSize = 11150`, the drawn arena is `arenaSize * 2`
// (22300 du) - the same fixed 22300 du every non-resizing diep mode uses (plan.md A1) - x0.56 =
// 12488 units.
const ARENA_SIZE = 12488;
// Mothership.ts: `healthData.values.maxHealth = 7000` - 1:1 with diep's raw (plan.md's own HP
// conversion rule), set on the spawned instance rather than the class table, the same pattern
// createBoss()/Tag's createCloser() already use for a scripted entity's real stats.
const MOTHERSHIP_HP = 7000;
// Same reasoning as Tag.js's own CLOSER_COUNT - a handful of invincible, never-dying Closers
// hunts down a match this size just as certainly as diep's own "up to 16" would, just slower.
const CLOSER_COUNT = 4;

class Mothership extends Room {
	constructor(id, controller) {
		super(id, {
			gm: 'mothership',
			maxXp: 30000,
			mapSize: { width: ARENA_SIZE, height: ARENA_SIZE },
			preGenerate: 2000,
			bootDelay: 1,
			// 2team's own shape mix - same team count and a similar-sized arena, no diep figure of
			// its own captured for this mode specifically.
			shapeMix: { sqr0: 314, sqr1: 35, tri0: 118, tri1: 24, pnt0: 35, pnt1: 29 },
			betaPentRng: 0.99,
			// diepcustom's Mothership gamemode has no BossManager hook of its own (unlike
			// FFA/Team2/Team4/Tag, which all construct one) - no citation for a boss roll here,
			// left off rather than guessed on.
			bossRng: 2,
			maxBoss: 0,
			botCount: 3,
			botIdStart: 10,
			teams: [0, 1],
			teamPlay: true,
			respawnPow: 0.8,
			// Gamemodes/Mothership.ts gives shapes their own x3 reward specifically
			// (`shapeScoreRewardMultiplier`), distinct from a kill's - this engine's rules.xpMul
			// is a single multiplier `awardXp()` applies to every award alike (plan.md's own
			// header note on that method), with no separate shape-only hook to carry diep's real
			// figure into, so this stays the ordinary x1 rather than over-applying it to kills
			// too. Flagged, not solved - PENDING.md.
			xpMul: 1,
			viewerBullets: false
		}, controller);
	}
	build() {
		this.closing = false;
		this.closers = [];
		// diepcustom: "little fun thing to support multiple teams - spread colors around map" -
		// one random starting angle, then evenly spaced per team.
		let randAngle = Math.random() * Math.PI * 2;
		for (const team of this.rules.teams) {
			this.createMothership(team, randAngle);
			randAngle += Math.PI * 2 / this.rules.teams.length;
		}
	}
	/*
		One Mothership per side, spawned the same way createBoss()/Tag's createCloser() spawn
		their own scripted Player - diepcustom's own placement, `arenaSize * 0.8` from centre.
	*/
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
			m.size = CLASS['Mothership'].bossSize;
			m.class = 'Mothership';
			m.screen = CLASS['Mothership'].screen;
			m.shield = 0;
			const spec = CONFIG.MOTHERSHIP;
			m.motion = spec[0].bind(m);
			m.update = spec[1].bind(m);
			return m;
		});
		if (mothership) { this.motherships.push(mothership); }
		return mothership;
	}
	/* True once a side has lost its Mothership - diepcustom's own `motherships.length <= 1`
	   (surviving entities, not surviving teams), read the same way here off which of the two
	   spawned instances are still alive. */
	winner() {
		return this.motherships.filter((m) => !m.destroy).length <= 1;
	}
	/* Same shape as Tag.js's startClosing()/createCloser() - a one-time Arena Closer burst,
	   never replenished (a Closer is invincible and never dies). */
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
			c.screen = CLASS[c.class].screen;
			c.size = 98;
			c.damage = 50;
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
		// Same ordering reasoning as Tag.js's own step() override - checked before super.step()'s
		// humans-vs-bots count decides whether the room self-destructs this tick, so a match that
		// wins and immediately empties still gets its Closers spawned first.
		if (!this.destroy && !this.closing && this.winner()) {
			this.state = Room.ArenaState.OVER;
			this.startClosing();
			this.state = Room.ArenaState.CLOSING;
		}
		super.step();
	}
	/* No more respawns once a side has lost its Mothership - diep_wiki gives no explicit line for
	   this mode, but it is the same "the arena is closing, nobody comes back" rule Tag's own
	   win condition uses, and Mothership shares the exact mechanism (Arena Closers). */
	respawn(id, force = 0, bot = 0) {
		if (this.closing && !force) { return; }
		return super.respawn(id, force, bot);
	}
	/* One row per surviving Mothership, showing its current HP - diepcustom's own
	   `updateScoreboard()` (Gamemodes/Mothership.ts), sorted by health like the real one. `xp`
	   carries the HP the same way Tag.js's leaderRows() overloads it with a headcount. */
	leaderRows(id) {
		const NAMES = ['Blue', 'Red'];
		return this.motherships
			.filter((m) => !m.destroy)
			.map((m) => ({ xp: Math.round(m.hp), name: (NAMES[m.team] || ('Team ' + m.team)) + ' Mothership', nameC: 0, team: m.team }))
			.sort((a, b) => b.xp - a.xp);
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

module.exports = Mothership;
