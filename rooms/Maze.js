/*
	Maze: Ffa-like tuning with generated wall geometry. Bosses stay off (default bossRng / maxBoss).

	buildWalls() floors map side / MAZE_CELL_SIZE to a square grid, generates once per match, and
	keeps mazeGenerator on the room for grid size and cell math (spawn clearance uses wall AABBs).

	closeIn counts down in sim ticks (CLOSE_AFTER ≈ five wall-clock hours); at zero, same closer
	swarm and respawn lock as Tag.
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

const MAZE_GEN_CONFIG = {
	baseSeedCount: 45,
	seedCountVariation: 30,
	turnChance: 0.2,
	branchChance: 0.2,
	terminationChance: 0.2
};
const MAZE_CELL_SIZE = 635 * 0.56;

const CLOSE_AFTER = Math.round(5 * 60 * 60 * 1000 / clock.STEP_MS);
const CLOSER_COUNT = 4;

const SPAWN_WALL_TRIES = 32;
const SPAWN_WALL_PAD = 30;

class Maze extends Room {
	constructor(id, controller) {
		super(id, {
			gm: 'maze',
			maxXp: 25000,
			mapSize: { width: gu(451), height: gu(451) },
			preGenerate: 1000,
			bootDelay: 100,
			shapeMix: { sqr0: 431, sqr1: 35, tri0: 157, tri1: 24, pnt0: 49, pnt1: 29 },
			crasherDensity: 0.75,
			betaPentRng: 0.98,
			botCount: 10,
			botIdStart: 10,
			teams: [1],
			teamPlay: false,
			respawnPow: 0.9
		}, controller);
	}
	build() {
		this.closing = false;
		this.closers = [];
		this.closeIn = CLOSE_AFTER;
		this.buildWalls();
	}
	buildWalls() {
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
				team: 4,
				size: Math.min(255, Math.round(Math.max(w, h) / 2)),
				w: Math.max(1 / 255, w / this.map.width),
				h: Math.max(1 / 255, h / this.map.height)
			});
		}
		this.wallDots = dots;
	}
	spawnPoint(tank) {
		if (!this.INSTANCE.walls.size) { return super.spawnPoint(tank); }
		const pad = (tank && tank.size) || SPAWN_WALL_PAD;
		for (let i = 0; i < SPAWN_WALL_TRIES; i++) {
			const p = super.spawnPoint(tank);
			if (this.clearOfWalls(p.x, p.y, pad)) { return p; }
		}
		return super.spawnPoint(tank);
	}
	clearOfWalls(x, y, pad) {
		if (!this.INSTANCE.walls.size) { return true; }
		for (const w of this.INSTANCE.walls.live()) {
			if (Math.abs(x - w.x) <= w.w / 2 + pad && Math.abs(y - w.y) <= w.h / 2 + pad) { return false; }
		}
		return true;
	}
	close() {
		if (--this.closeIn > 0) { return; }
		this.startClosing();
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
		if (!this.destroy && !this.closing) { this.close(); }
		super.step();
	}
	respawn(id, force = 0, bot = 0) {
		if (this.closing && !force) { return; }
		return super.respawn(id, force, bot);
	}
};

module.exports = Maze;
