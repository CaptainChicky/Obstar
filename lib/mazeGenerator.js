/*
	Maze layout generator (plan.md Step 12) - a straight port of diepcustom's own
	Misc/MazeGenerator.ts, which PENDING #26 cites as "a complete, readable seed-and-grow maze
	algorithm": plant scattered seeds, grow each into a branching/turning corridor of wall cells,
	sprinkle a few singular walls, flood-fill from a corner to find (and fill in) unreachable
	pockets, then merge the resulting wall cells into the largest possible rectangles
	(convertToWalls()) - the "rectangular chunks of various sizes" the human correction in #26
	asked for. Operates purely in grid-cell space; rooms/Maze.js does the grid-to-world scaling and
	Wall instantiation, the same split diepcustom's own MazeGenerator/ArenaEntity have.

	A faithful port, not a rewrite - including MazeGenerator.ts's own unbounded-access quirk in
	convertToWalls() (get()/set() do no bounds check, so a chunk growing exactly to the grid edge
	reads into the next row rather than stopping cleanly). Diep's own generator has run this way
	for years; "port" means the same maze shapes come out, not a hardened rewrite.
*/
const MAZE_CELL_EMPTY = 0;
const MAZE_CELL_WALL = 1;
const MAZE_CELL_ACCESSIBLE = 2;
const MAZE_CELL_PLACED_WALL = 3;

class MazeGenerator {
	// config: { size, baseSeedCount, seedCountVariation, turnChance, branchChance, terminationChance }
	constructor(config) {
		this.config = config;
		this.maze = new Uint8Array(config.size * config.size);
	}
	get(x, y) { return this.maze[y * this.config.size + x]; }
	set(x, y, value) { return this.maze[y * this.config.size + x] = value; }
	mapValues() {
		const size = this.config.size;
		const values = new Array(this.maze.length);
		for (let i = 0; i < this.maze.length; i++) {
			values[i] = [i % size, Math.floor(i / size), this.maze[i]];
		}
		return values;
	}
	/* Builds the maze - seeds, growth, sprinkle, flood-fill, pocket-fill. Verbatim
	   MazeGenerator.ts's generate(). */
	generate() {
		const size = this.config.size;
		const seeds = [];
		const seedCount = this.config.baseSeedCount + Math.floor((Math.random() - 0.5) * this.config.seedCountVariation);
		const maxSeedCount = this.config.baseSeedCount + this.config.seedCountVariation;
		// Plant some seeds.
		for (let i = 0; i < 10000; i++) {
			if (seeds.length >= seedCount) break;
			const seed = {
				x: Math.floor((Math.random() * size) - 1),
				y: Math.floor((Math.random() * size) - 1),
			};
			// Valid if >=3 cells from every other seed and not on the border.
			if (seeds.some((a) => Math.abs(seed.x - a.x) <= 3 && Math.abs(seed.y - a.y) <= 3)) continue;
			if (seed.x <= 0 || seed.y <= 0 || seed.x >= size - 1 || seed.y >= size - 1) continue;
			seeds.push(seed);
			this.set(seed.x, seed.y, MAZE_CELL_WALL);
		}
		const direction = [
			[-1, 0], [1, 0], // left and right
			[0, -1], [0, 1], // up and down
		];
		// Let it grow - `seeds` grows during this loop (branches push onto it), and a for...of
		// over an array picks up those later elements, so a branch is itself grown later in the
		// same pass. That is intentional, not an accident to fix.
		for (const seed of seeds) {
			let dir = direction[Math.floor(Math.random() * 4)];
			let termination = 1;
			while (termination >= this.config.terminationChance) {
				termination = Math.random();
				const [dx, dy] = dir;
				seed.x += dx;
				seed.y += dy;
				if (seed.x <= 0 || seed.y <= 0 || seed.x >= size - 1 || seed.y >= size - 1) break;
				this.set(seed.x, seed.y, MAZE_CELL_WALL);
				if (Math.random() <= this.config.branchChance) {
					// Past maxSeedCount, stop spawning new branches (avoids a runaway maze tumour) -
					// but keep growing this seed; the `continue` skips only the branch/turn choice
					// below, not the whole seed.
					if (seeds.length > maxSeedCount) continue;
					const perp = direction.filter((a) => a.every((b, c) => b !== dir[c]));
					const [xx, yy] = perp[Math.floor(Math.random() * 2)];
					const newSeed = { x: seed.x + xx, y: seed.y + yy };
					seeds.push(newSeed);
					this.set(seed.x, seed.y, MAZE_CELL_WALL);
				} else if (Math.random() <= this.config.turnChance) {
					const perp = direction.filter((a) => a.every((b, c) => b !== dir[c]));
					dir = perp[Math.floor(Math.random() * 2)];
				}
			}
		}
		// A handful of singular walls sprinkled around the arena.
		for (let i = 0; i < 10; i++) {
			const seed = {
				x: Math.floor((Math.random() * size) - 1),
				y: Math.floor((Math.random() * size) - 1),
			};
			if (this.mapValues().some(([x, y, v]) => v === MAZE_CELL_WALL && Math.abs(seed.x - x) <= 3 && Math.abs(seed.y - y) <= 3)) continue;
			if (seed.x <= 0 || seed.y <= 0 || seed.x >= size - 1 || seed.y >= size - 1) continue;
			this.set(seed.x, seed.y, MAZE_CELL_WALL);
		}
		// Flood-fill reachability from the top-left corner.
		const queue = [[0, 0]];
		this.set(0, 0, MAZE_CELL_ACCESSIBLE);
		const checked = new Set([0]);
		for (let i = 0; i < 3000 && queue.length > 0; i++) {
			const next = queue.shift();
			if (next === undefined) break;
			const [x, y] = next;
			for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
				if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
				if (this.get(nx, ny) !== MAZE_CELL_EMPTY) continue;
				const idx = ny * size + nx;
				if (checked.has(idx)) continue;
				checked.add(idx);
				queue.push([nx, ny]);
				this.set(nx, ny, MAZE_CELL_ACCESSIBLE);
			}
		}
		// Whatever the flood never reached is an inaccessible pocket - wall it off.
		for (const [x, y, value] of this.mapValues()) {
			if (value === MAZE_CELL_WALL || value === MAZE_CELL_ACCESSIBLE) continue;
			this.set(x, y, MAZE_CELL_WALL);
		}
	}
	/* Merges wall cells into the largest possible rectangles, returned in grid-cell coordinates
	   as {x, y, width, height}. Every wall cell ends up PLACED_WALL as a side effect (a 1x1 chunk
	   at minimum), which is what isCellOccupied() below reads - so this must run before any
	   spawn-validity check does. */
	convertToWalls() {
		const size = this.config.size;
		for (const [x, y, value] of this.mapValues()) {
			if (value !== MAZE_CELL_PLACED_WALL) continue;
			this.set(x, y, MAZE_CELL_WALL);
		}
		const walls = [];
		for (let x = 0; x < size; x++) {
			for (let y = 0; y < size; y++) {
				if (this.get(x, y) !== MAZE_CELL_WALL) continue;
				const chunk = { x, y, width: 0, height: 1 };
				while (this.get(x + chunk.width, y) === MAZE_CELL_WALL) {
					this.set(x + chunk.width, y, MAZE_CELL_PLACED_WALL);
					chunk.width++;
				}
				grow: while (true) {
					for (let i = 0; i < chunk.width; i++) {
						if (this.get(x + i, y + chunk.height) !== MAZE_CELL_WALL) break grow;
					}
					for (let i = 0; i < chunk.width; i++) {
						this.set(x + i, y + chunk.height, MAZE_CELL_PLACED_WALL);
					}
					chunk.height++;
				}
				walls.push(chunk);
			}
		}
		return walls;
	}
	isCellOccupied(x, y) {
		return this.get(x, y) === MAZE_CELL_PLACED_WALL;
	}
}

module.exports = MazeGenerator;
