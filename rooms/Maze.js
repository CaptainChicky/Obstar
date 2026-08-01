/*
	Maze - free-for-all with wall chains scattered across the arena, and a hard 5-hour close.

	Source: diep_wiki/Maze.txt, diep_wiki/Arena Closer.txt. "works similarly to Free For All" is
	the wiki's own framing, so every tunable below is ffa's own (rooms/Ffa.js) verbatim - same
	arena, same shape mix/density, same bot count, same respawn curve, one nominal team. What is
	actually new here is only:

		build()           scatters KIND.WALL chains across the map (PENDING #2 shipped the entity
		                  type and its physics; no mode ever placed one until now)
		step()/close()    the wall-clock 5-hour close, diep_wiki's own number
		startClosing()/
		createCloser()    the same Arena Closer swarm rooms/Tag.js's win condition already built,
		                  reused rather than re-derived - see the PENDING #28 comment there
		respawn()         no-op once closing, same override Tag needed for the same reason

	Bosses do not spawn here (diep_wiki: "Unlike other game modes, Bosses do NOT spawn in Maze" -
	a boss can wander into a wall and become unkillable). That needs no code: DEFAULT_RULES'
	bossRng (2, never) and maxBoss (0) are what ffa itself already runs on, and this file does not
	turn them up.
*/
const World = require('../public/SHARE/World.js');
const gu = World.gu;
const clock = require('../lib/clock.js');
const Room = require('./Room.js');
const Wall = require('../entities/Wall.js');
const Player = require('../entities/Player.js');
const CLASS = require('../public/SHARE/TanksConfig.js').class;
const CONFIG = require('../lib/gameAI.js');

/*
	Wall chain generation (PENDING #26 - "walls have friction and bounciness", "randomly
	generated", "visible on the minimap" are the only concrete requirements; diep_wiki gives no
	geometry or count, so everything below is OURS, on the same untuned-by-design footing as
	WALL_BOUNCE/WALL_FRICTION themselves (lib/constants.js) - due a real playtest pass once this
	mode can actually be played, not a value to defend.

	A "structure" is 1-3 straight "legs" joined end to end, each leg turning +-90 deg from the
	last - a blocky, right-angled corridor rather than a straight diagonal bar, closer to the
	screenshot in diep_wiki/Maze.txt than a single line would read as. Each leg is a chain of
	Wall studs (PENDING #2's "everything in this codebase's collision pass is a circle" - a wall
	IS a chain of these) spaced at 1.5x their own radius, which keeps every consecutive pair
	overlapping (spacing < 2*radius) so the chain has no seam a bullet could thread - a chain
	that only touches tangentially (spacing = 2*radius) would still be gap-free along a dead
	straight leg, but the 90 deg joints between legs would not be without the extra overlap.
*/
const WALL_STUD_R = gu(3);
const WALL_STUD_GAP = WALL_STUD_R * 1.5;
const WALL_LEGS_MIN = 1, WALL_LEGS_MAX = 3;
const WALL_LEG_STUDS_MIN = 3, WALL_LEG_STUDS_MAX = 7;
// One structure per this many gu^2 of arena - picked to keep the total stud count (and with it
// the minimap dot count, below) in the low hundreds at ffa's own gu(451) arena (measured
// 200-260 across repeated rolls), not against any density diep states (it states none). The
// count has no hard ceiling to respect any more - TYPE.UiUpdate.array (SocketSchema.js) is a
// uint16, specifically because this total was never going to stay under the old uint8's 255.
const WALL_STRUCTURE_DENSITY_GU2 = 8000;
// A chain stops growing once it enters the map-edge OOB inset, rather than wandering into the
// dark band outside the drawn arena - config.OOB_MARGIN's own neighbourhood, restated here
// rather than imported since this is a generation-time cutoff, not a runtime physics constant.
const WALL_EDGE_MARGIN = gu(15);

/*
	The wiki gives the PERIOD exactly ("Five hours after the server opened") and nothing about
	what happens up to that point - it is a flat wall-clock deadline, not a schedule with a rate
	to tune (contrast rooms/Tag.js's shrink, which has both). Divides by the real wall-clock step
	(clock.STEP_MS), the same category as Tag's SHRINK_EVERY and rooms/Room.js's own
	GENERATE_EVERY - a wall-clock schedule, not a per-reference-tick gameplay constant, so it
	takes no lib/tick.js conversion.
*/
const CLOSE_AFTER = Math.round(5 * 60 * 60 * 1000 / clock.STEP_MS);
// How many Arena Closers the 5-hour close spawns - same number and same reasoning as
// rooms/Tag.js's CLOSER_COUNT: a Closer is invincible and never dies, so a fixed burst hunts a
// match this size down just as certainly as diep's "up to 16" would, only slower.
const CLOSER_COUNT = 4;

class Maze extends Room {
	constructor(id, controller) {
		super(id, {
			gm: 'maze',
			maxXp: 25000,
			mapSize: { width: gu(451), height: gu(451) },
			preGenerate: 1000,
			bootDelay: 100,
			// Verbatim ffa's mix/density (PENDING #19's density formula still applies - "works
			// similarly to FFA" is the wiki's own framing for the whole mode).
			shapeMix: { sqr0: 431, sqr1: 35, tri0: 157, tri1: 24, pnt0: 49, pnt1: 29 },
			betaPentRng: 0.98,
			botCount: 10,
			botIdStart: 10,
			teams: [1],
			teamPlay: false,
			respawnPow: 0.9
		}, controller);
	}
	/*
		Runs once, in the constructor (Room's own build() hook, called right after tickArena(0) -
		see rooms/Room.js's header - so this.map/this.nestScale are already the real arena size).
		Walls are permanent geometry, generated once rather than by generate()'s per-tick RNG
		passes the way polygons are, since diep_wiki gives no respawn/regrowth behaviour for them.
	*/
	build() {
		this.closing = false;
		this.closers = [];
		this.closeIn = CLOSE_AFTER;
		this.buildWalls();
	}
	/*
		Scatters wall structures across the arena and, in the same pass, precomputes their minimap
		dots (rooms/Room.js's this.wallDots, appended by every viewer's getUi()) - safe to do once
		here rather than per tick/per viewer, since a wall never moves and this mode's arena is
		fixed size (arenaLive is not set), so the map-fraction coordinates below never go stale.
	*/
	buildWalls() {
		const halfW = this.map.width / 2 - WALL_EDGE_MARGIN;
		const halfH = this.map.height / 2 - WALL_EDGE_MARGIN;
		const areaGu = (this.map.width / World.GU) * (this.map.height / World.GU);
		const structures = Math.floor(areaGu / WALL_STRUCTURE_DENSITY_GU2);
		const dots = [];
		for (let s = 0; s < structures; s++) {
			let x = (Math.random() * 2 - 1) * halfW;
			let y = (Math.random() * 2 - 1) * halfH;
			let dir = Math.floor(Math.random() * 4) * (Math.PI / 2);
			const legs = WALL_LEGS_MIN + Math.floor(Math.random() * (WALL_LEGS_MAX - WALL_LEGS_MIN + 1));
			for (let leg = 0; leg < legs; leg++) {
				const studs = WALL_LEG_STUDS_MIN +
					Math.floor(Math.random() * (WALL_LEG_STUDS_MAX - WALL_LEG_STUDS_MIN + 1));
				for (let n = 0; n < studs; n++) {
					if (Math.abs(x) > halfW || Math.abs(y) > halfH) { break; }
					this.INSTANCE.walls.add((id) =>
						new Wall(x, y, WALL_STUD_R, { GM: this.gm, sId: this.id, oId: id }, this));
					dots.push({
						x: (x + this.map.width / 2) / this.map.width,
						y: (y + this.map.height / 2) / this.map.height,
						team: 4,   // 'gray' (SocketSchema's color table) - no live team dot ever uses it
						size: Math.min(255, Math.round(WALL_STUD_R))
					});
					x += Math.cos(dir) * WALL_STUD_GAP;
					y += Math.sin(dir) * WALL_STUD_GAP;
				}
				// +-90 deg only, never a U-turn back onto the leg just laid - a blocky corridor
				// bend, not a diagonal or a fold-back that would double a stretch of wall on itself.
				dir += (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
			}
		}
		this.wallDots = dots;
	}
	/*
		The 5-hour deadline. Called from step() below, before super.step(), the same ordering
		rooms/Tag.js's shrink()/winner() use and for the same reason: this tick's state has to be
		in place before super.step()'s own tick/collision/self-destruct pass reads it.
	*/
	close() {
		if (--this.closeIn > 0) { return; }
		this.startClosing();
	}
	/*
		Fires once. Identical shape to rooms/Tag.js's own startClosing() - a fixed burst, not a
		maintained population, since a Closer is invincible and never dies (PENDING #28).
	*/
	startClosing() {
		this.closing = true;
		for (let i = 0; i < CLOSER_COUNT; i++) { this.createCloser(); }
	}
	/*
		One Arena Closer. Verbatim rooms/Tag.js's own createCloser() - see there for why each field
		is set where it is (a boss/Closer-shaped Player, not a new entity kind or class table
		entry) - duplicated rather than shared because Tag's version is shipped, tested and pinned
		(PENDING #28) and this mode's own close condition (a flat timer, not a win condition) is
		different enough that folding the two into one shared method would need a hook of its own
		for what "closing" even means, for a saving of about twenty lines.
	*/
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
			c.size = 98;   // ArenaCloser.ts BASE_SIZE 175 du x 0.56 (plan.md Step 11) - see rooms/Tag.js's own createCloser()
			c.damage = 34.632035;   // 10x this.damage's own diep-derived base - see rooms/Tag.js's own createCloser()
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
		if (!this.destroy && !this.closing) { this.close(); }
		super.step();
	}
	/* Once closing, nobody comes back - diep_wiki's "the server will be reset" ending is the room
		 emptying (Room.step()'s existing zero-human self-destruct, which already excludes a
		 Closer the same way it excludes a bot/boss), not a match that keeps restocking itself. */
	respawn(id, force = 0, bot = 0) {
		if (this.closing && !force) { return; }
		return super.respawn(id, force, bot);
	}
};

module.exports = Maze;
