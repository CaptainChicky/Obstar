/*
	Maze - free-for-all with a generated rectangular wall layout scattered across the arena, and a
	hard 5-hour close.

	Source: diep_wiki/Maze.txt, diep_wiki/Arena Closer.txt, plan.md Step 12. "works similarly to
	Free For All" is the wiki's own framing, so every tunable below is ffa's own (rooms/Ffa.js)
	verbatim - same arena, same shape mix/density, same bot count, same respawn curve, one nominal
	team. What is actually new here is only:

		build()           runs lib/mazeGenerator.js's maze algorithm and places its rectangles as
		                  real KIND.WALL entities (plan.md Step 12; PENDING #2 shipped the entity
		                  type's physics slice, and an earlier session's own studs-and-chains
		                  placement, both since redesigned)
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
const MazeGenerator = require('../lib/mazeGenerator.js');
const Player = require('../entities/Player.js');
const CLASS = require('../public/SHARE/TanksConfig.js').class;
const CONFIG = require('../lib/gameAI.js');

/*
	Wall layout (plan.md Step 12, PENDING #26's reopened "wall shape is wrong" half) -
	diepcustom/src/Misc/MazeGenerator.ts ported to lib/mazeGenerator.js: plant scattered seeds,
	grow each into a branching/turning corridor of grid cells, sprinkle a few singular walls,
	flood-fill from a corner to find (and fill in) unreachable pockets, then merge the wall cells
	into the largest possible rectangles - real "rectangular chunks of various sizes forming an
	actual maze layout", not the old chain of circular studs approximating one.

	The five generator knobs (seed count/variation, turn/branch/termination chance) are diep's
	own (Gamemodes/Maze.ts:45-52) verbatim - dimensionless probabilities, nothing to convert. Only
	the GRID SIZE is unit-converted, and in the opposite direction from diep: diep's own arena
	SIZE is a product of its GRID_SIZE (40) and CELL_SIZE (635 du); ours is already fixed at ffa's
	own gu(451) (PENDING #26's "the mode is Ffa's own tuning, verbatim"), so GRID_SIZE is derived
	FROM that arena at diep's own cell size instead of hardcoding diep's 40 - see buildWalls().
*/
const MAZE_GEN_CONFIG = {
	baseSeedCount: 45,
	seedCountVariation: 30,
	turnChance: 0.2,
	branchChance: 0.2,
	terminationChance: 0.2
};
// diepcustom/src/Gamemodes/Maze.ts:42 - CELL_SIZE 635 du, our units (x 0.56) = 355.6. At ffa's
// own gu(451) = 12628 units, floor(12628 / 355.6) = 35 - a 35x35 grid, not diep's 40x40.
const MAZE_CELL_SIZE = 635 * 0.56;

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
		Runs the generator (lib/mazeGenerator.js), merges its grid cells into rectangles, and turns
		each rectangle into a real Wall - and, in the same pass, precomputes their minimap dots
		(rooms/Room.js's this.wallDots, appended by every viewer's getUi()) - safe to do once here
		rather than per tick/per viewer, since a wall never moves and this mode's arena is fixed
		size (arenaLive is not set), so the map-fraction coordinates below never go stale.

		this.mazeGenerator is kept (not just its output) the same way diepcustom's own MazeArena
		keeps `mazeGenerator` public - a future spawn-validity check (diep's own
		`isValidSpawnLocation`, not built this step - see plan.md Step 12's "Moves: nothing outside
		Maze") would read `isCellOccupied()` off it rather than re-deriving cell occupancy from the
		placed Wall list.
	*/
	buildWalls() {
		// GRID_SIZE derives from OUR arena at diep's own cell size, not diep's hardcoded 40 - see
		// this file's header comment for why the two arenas are related in opposite directions.
		const gridSize = Math.floor(this.map.width / MAZE_CELL_SIZE);
		const generator = new MazeGenerator(Object.assign({ size: gridSize }, MAZE_GEN_CONFIG));
		generator.generate();
		const rects = generator.convertToWalls();
		this.mazeGenerator = generator;

		const cellW = this.map.width / gridSize, cellH = this.map.height / gridSize;
		const leftX = -this.map.width / 2, topY = -this.map.height / 2;
		const dots = [];
		for (const rect of rects) {
			const minX = rect.x * cellW + leftX, minY = rect.y * cellH + topY;
			const maxX = (rect.x + rect.width) * cellW + leftX, maxY = (rect.y + rect.height) * cellH + topY;
			const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
			const w = maxX - minX, h = maxY - minY;
			this.INSTANCE.walls.add((id) =>
				new Wall(cx, cy, w, h, { GM: this.gm, sId: this.id, oId: id }, this));
			dots.push({
				x: (cx + this.map.width / 2) / this.map.width,
				y: (cy + this.map.height / 2) / this.map.height,
				team: 4,   // 'gray' (SocketSchema's color table) - no live team dot ever uses it
				size: Math.min(255, Math.round(Math.max(w, h) / 2)),
				// The wall's REAL proportions as map fractions, so the minimap draws the maze as
				// the rectangles it actually is rather than one dot per merged chunk
				// (SocketSchema's TYPE.UiUpdate.map). Floored at one wire quantum (1/255) so a
				// thin wall still has a visible thickness after the uint8 round trip.
				w: Math.max(1 / 255, w / this.map.width),
				h: Math.max(1 / 255, h / this.map.height)
			});
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
			c.damage = 50;   // 10x this.damage's own diep-derived base (5) - see rooms/Tag.js's own createCloser()
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
