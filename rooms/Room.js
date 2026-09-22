/*
	Room - shared simulation for every gamemode.

	Subclasses merge rules over DEFAULT_RULES. The controller is passed at construction so the
	room can encode snapshots without a global registry.

	Mode hooks (override only what differs from FFA defaults):
		build() — after map sizing, before the first generate tick
		basePosts() / spawnBaseDrone / tickBaseDrones / tickDroneCentres — team-base drones
		spawnPoint / factorySpawnPoint / respawnTeam — placement and team on respawn
		clearOfWalls — reject spawn samples inside geometry (maze)
		tickArena — shape/boss pacing after map lerp
		allowsRespawn / inputsFrozen — match freeze while closing or between waves
		assignTeam — join and rebalance policy
		entityColor / mainColor / bulletColor / leaderColor / mapDotColor — wire tints
		leaderRows / getUi — scoreboard and HUD payload
		botRoster / botBudget — filler bots when rules.botCount is set
		step — call super.step() after local timers (shrink, win detection, etc.)
*/
const config = require('../lib/config.js').config;
const tick = require('../lib/tick.js');
const termColors = require('../lib/terminal.js');
const quadTree = require('../lib/quadTree.js');
const SlotMap = require('../lib/SlotMap.js');
const World = require('../public/SHARE/World.js');
const CLASS = require('../public/SHARE/TanksConfig.js').class;
const KIND = require('../public/SHARE/kinds.js');
const clock = require('../lib/clock.js');
const Player = require('../entities/Player.js');
const Bullet = require('../entities/Bullet.js');
const Objects = require('../entities/Objects.js');
const Detector = require('../entities/Detector.js');
const Wall = require('../entities/Wall.js');
const CONFIG = require('../lib/gameAI.js');
const { TANK_TANK_MULT, TANK_SHAPE_MULT } = require('../lib/damage.js');

/*
	Shape count targets one polygon per SHAPE_DENSITY_GU2 (200) gu² of arena area. Modes supply a
	six-weight shapeMix; apportionShapes() splits the total. arenaLive modes resize via arenaGu();
	fixed-map modes keep mapSize. Ffa uses a larger fixed arena than live scaling would give at
	max players — density is tuned at that size.
*/
const SHAPE_DENSITY_GU2 = 200;
function shapeTotal(widthGu, heightGu) { return Math.floor(widthGu * heightGu / SHAPE_DENSITY_GU2); }
/* Crasher annulus area / 200 gu² — radii match Objects crasher-zone constants × nestScale. */
const CRASHER_ZONE_R_IN = 630, CRASHER_ZONE_R_OUT = 1249;
function crasherTotal(nestScale) {
	const areaWorld2 = Math.PI * (Math.pow(CRASHER_ZONE_R_OUT * nestScale, 2) - Math.pow(CRASHER_ZONE_R_IN * nestScale, 2));
	return Math.max(0, Math.floor(areaWorld2 / (World.GU * World.GU) / SHAPE_DENSITY_GU2));
}
/* Live arena side length from player count; floored at MIN_ARENA_GU. */
const MIN_ARENA_GU = 150;
function arenaGu(n) { return Math.max(MIN_ARENA_GU, Math.floor(Math.sqrt(Math.max(1, n)) * 50)); }
/* Nest keep-outs and cluster radii scale with map width / NEST_REF_GU (ffa => 1). */
const NEST_REF_GU = 451;
/* Largest-remainder split of `total` across six shapeMix weights (nest scatter vs cluster slots). */
function apportionShapes(total, mix) {
	const keys = ['sqr0', 'sqr1', 'tri0', 'tri1', 'pnt0', 'pnt1'];
	const sum = keys.reduce((a, k) => a + mix[k], 0);
	const exact = keys.map((k) => total * mix[k] / sum);
	const floors = exact.map((x) => Math.floor(x));
	const remainder = total - floors.reduce((a, b) => a + b, 0);
	const order = keys.map((_, i) => i).sort((a, b) => (exact[b] - floors[b]) - (exact[a] - floors[a]));
	const counts = floors.slice();
	for (let k = 0; k < remainder; k++) { counts[order[k]]++; }
	return {
		sqr: { max0: counts[0], max1: counts[1] },
		tri: { max0: counts[2], max1: counts[3] },
		pnt: { max0: counts[4], max1: counts[5] }
	};
}

/* Bias ordinary shape respawn gates toward instant refill (RESPAWN_CATCHUP). */
const RESPAWN_CATCHUP = 0.85;
const towardInstant = (p) => p + RESPAWN_CATCHUP * (1 - p);

// Wire bullet type is uint8; minion (1.5) and drawType overrides are encoded here.
const MINION_WIRE_TYPE = 5;
function bulletWireType(bullet) {
	if (bullet.drawType !== undefined) { return bullet.drawType; }
	return bullet.type === 1.5 ? MINION_WIRE_TYPE : parseInt(bullet.type);
}

const GENERATE_EVERY = Math.round(400 / clock.STEP_MS);
const FIRST_GENERATE = Math.round(300 / clock.STEP_MS);

const BASE_DRONE_RESPAWN = tick.ticks(config.BASE_DRONE_RESPAWN);
const BASE_DRONE_SORT_PERIOD = tick.ticks(config.BASE_DRONE_SORT_PERIOD);
const BASE_DRONE_SCAN = config.BASE_DRONE_SCAN;
const BASE_DRONE_CROSS_TICKS = tick.ticks(config.BASE_DRONE_CROSS);
const BASE_DRONE_PROVOKE_MEMORY = tick.ticks(config.BASE_DRONE_PROVOKE_MEMORY);

// Guaranteed boss spawn if none alive after this many reference ticks (67500 ≈ 45 min at 40ms ref).
const BOSS_TIMER_TICKS = tick.ticks(67500);

const isBaseDrone = (e) => e.kind === KIND.BULLET && e.type === 1.4;

/*
	Mutual damage proration before collision(): both sides share one tick of health spend.
	damageOutput() matches entity collision arms (bullet-vs-bullet excluded).
*/
function damageOutput(e, eKind, otherKind) {
	switch (eKind) {
		case KIND.PLAYER:
			if (otherKind === KIND.PLAYER) return e.damage * TANK_TANK_MULT;
			if (otherKind === KIND.OBJECTS) return e.damage * TANK_SHAPE_MULT;
			if (otherKind === KIND.BULLET) return e.damage;
			return 0;
		case KIND.OBJECTS:
			if (otherKind === KIND.PLAYER) return e.damage * TANK_SHAPE_MULT;
			if (otherKind === KIND.BULLET) return e.damage;
			return 0;
		case KIND.BULLET:
			if (otherKind === KIND.PLAYER || otherKind === KIND.OBJECTS) return e.damage;
			return 0;
		default:
			return 0;
	}
}
// True when this entity's collision() will not apply damage (god, shield, closer, etc.).
function damageGuarded(e, eKind) {
	return eKind === KIND.PLAYER && (e.dev.ghost || e.dev.god || e.closer || e.shield);
}

/*
	Same-team projectile physics: noOwnTeamCollision vs onlySameOwnerCollision (trap swaps at arm).
	teamRoot() = same side; ownerOf() = bullet origin for owner-only contact.
*/
const NO_OWN_TEAM_TYPES = new Set([0, 1.2, 1.3, 4]);
const SAME_OWNER_TYPES = new Set([1, 1.1, 1.5, 2, 3, 3.1]);
function teamRoot(e, kind) {
	return kind === KIND.BULLET ? e.origin.oId : (kind === KIND.PLAYER ? e.id.oId : null);
}
function ownerOf(e, kind) {
	return kind === KIND.BULLET ? e.origin.oId : null;
}
function teamCollisionFlag(e, kind) {
	if (kind !== KIND.BULLET) { return 0; }
	if (e.type === 2) { return e.armTicks > 0 ? 2 : 1; }
	if (NO_OWN_TEAM_TYPES.has(e.type)) { return 1; }
	if (SAME_OWNER_TYPES.has(e.type)) { return 2; }
	return 0;
}
function teamPassThrough(room, a, aKind, b, bKind) {
	if (aKind === KIND.OBJECTS || bKind === KIND.OBJECTS ||
		aKind === KIND.WALL || bKind === KIND.WALL) { return false; }
	const sameTeam = room.rules.teamPlay
		? a.team === b.team
		: teamRoot(a, aKind) === teamRoot(b, bKind);
	if (!sameTeam) { return false; }
	const fa = teamCollisionFlag(a, aKind), fb = teamCollisionFlag(b, bKind);
	if (fa === 1 || fb === 1) { return true; }
	if (fa === 2 || fb === 2) { return ownerOf(a, aKind) !== ownerOf(b, bKind); }
	return false;
}

const COLLIDE_SCRATCH = [];
const SPAWN_TRIES = 128;

/*
	Every knob a gamemode can turn without writing code. A subclass spreads its own values
	over these in its constructor, so a mode only states what it changes.
*/
const DEFAULT_RULES = {
	gm: 'ffa',
	maxXp: 25000,
	mapSize: { width: 9020, height: 9020 },
	arenaLive: false,
	baseSizeRatio: { num: 0, den: 1 },
	shapeMix: null, // required on every merged rules object — no silent default mix
	maxPlayer: 24,
	preGenerate: 500, // generate() passes run before the room opens
	bootDelay: 100, // ms between construction and the first tick
	betaPentRng: 0.98, // RNG above this may spawn a beta pentagon
	bossRng: 2, // ... and above this calls createBoss(). 2 = never.
	maxBoss: 0, // how many bosses may be alive at once. 0 = the mode has none.
	bossHp: 3000,
	bossTeam: 9,
	neutralTeam: 2, // arena team: closers and uncaptured dominators
	botCount: 10,
	botIdStart: 10, // bots occupy a fixed slot range so respawn can find them
	teams: [1], // the team ids this mode assigns. One entry = free-for-all.
	teamPlay: false, // friendly fire off, and detectors ignore team mates
	respawnPow: 0.9, // exponent of the xp you keep through a death
	xpMul: 1, // polygon and boss kill rewards only (diep shapeScoreRewardMultiplier)
	crasherDensity: 1,
	viewerBullets: true,
	invisFloor: 0
};

class Room {
	constructor(id, rules, controller) {
		this.rules = Object.assign({}, DEFAULT_RULES, rules);
		// If a real player team collides with neutralTeam, use bossTeam for arena entities.
		if (this.rules.teams.indexOf(this.rules.neutralTeam) >= 0) {
			this.rules.neutralTeam = this.rules.bossTeam;
		}
		this.controller = controller;
		const MXLVL = this.rules.maxXp;
		// XP thresholds: reference curve scaled by maxXp / 23537.
		const DIEP_MAX_XP = 23537;
		let acc = 0;
		this.XPLVL = new Array(Player.LEVEL_CAP).fill(0).map((x, i) => {
			if (i === 0) {
				return 0;
			}
			acc += (40 / 9) * Math.pow(1.06, i - 1) * Math.min(31, i);
			return Math.round(Math.round(acc) * MXLVL / DIEP_MAX_XP);
		})
		this.gm = this.rules.gm;
		this.id = id;
		this.BUFFER = {};
		this.maxPlayer = this.rules.maxPlayer;
		this.INSTANCE = {
			"players": new SlotMap({ maxIndex: this.maxPlayer }),
			"objs": new SlotMap(),
			"bullets": new SlotMap(),
			"detectors": new SlotMap(),
			"walls": new SlotMap()
		};
		this.leader = [];
		if (this.rules.arenaLive) {
			const al = World.gu(arenaGu(0));
			this.map = { width: al, height: al };
		} else {
			this.map = { width: this.rules.mapSize.width, height: this.rules.mapSize.height };
		}
		this.newMap = { width: this.map.width, height: this.map.height };
		this.obj = {
			"sqr": { "0": 0, "1": 0, "max0": 0, "max1": 0 },
			"tri": { "0": 0, "1": 0, "max0": 0, "max1": 0 },
			"pnt": { "0": 0, "1": 0, "max0": 0, "max1": 0 },
			"Bpnt": { '1': 0, 'max1': 3 },
			"Bsqr": { '1': 0, 'max1': 2 },
			"Btri": { '1': 0, 'max1': 2 },
			"bull": { '1': 0, 'max1': 0 }
		};
		this.baseSize = 0;
		this.nestScale = 1;
		this.tickArena(0);
		this.timestamp = 0;
		this.bots = [];
		this.bosses = [];
		this.dominators = [];
		this.state = Room.ArenaState.OPEN;
		this.ticksUntilStart = 0;
		this.playersNeeded = 0;
		this.motherships = [];
		this.wallDots = [];
		this.generateIn = FIRST_GENERATE;
		this.build();
		/*
			Base drones. The post list has to outlive construction because
			tickBaseDrones() respawns into it, which is why this is a stored list rather than
			something build() does and forgets. A mode without bases returns [] and pays nothing -
			tickBaseDrones() leaves on the length check.
		*/
		this.dronePosts = this.basePosts();
		/*
			One entry per orbit centre, identified by shared `levels` ledger reference (posts at the
			same centre all carry the SAME levels object) - built once so the per-centre binomial
			sorter and detection scout aren't re-deriving the grouping every
			pass. A mode with no bases costs one empty-array iteration.
		*/
		this.droneCentres = [];
		{
			const seen = new Map();
			for (const post of this.dronePosts) {
				let centre = seen.get(post.levels);
				if (!centre) {
					centre = { levels: post.levels, posts: [] };
					seen.set(post.levels, centre);
					this.droneCentres.push(centre);
				}
				centre.posts.push(post);
			}
		}
		for (const post of this.dronePosts) {
			post.respawnIn = BASE_DRONE_RESPAWN;
			post.slot = this.spawnBaseDrone(post);
		}
		setTimeout((it) => { it.Init(); clock.add(it); }, this.rules.bootDelay, this);
	}
	build() { }
	levelR(level) {
		return config.BASE_DRONE_ORBIT_R + (level - config.BASE_DRONE_LEVEL_HOME) * config.BASE_DRONE_LEVEL_GAP;
	}
	/* Largest-remainder level counts for `count` drones (live or planned). */
	levelTargets(count) {
		const W = config.BASE_DRONE_LEVEL_WEIGHTS;
		const total = W.reduce((a, b) => a + b, 0);
		const exact = W.map((w) => count * w / total);
		const floors = exact.map((x) => Math.floor(x));
		const remainder = count - floors.reduce((a, b) => a + b, 0);
		const order = floors.map((_, i) => i).sort((a, b) => {
			const fa = exact[a] - floors[a], fb = exact[b] - floors[b];
			if (fb !== fa) { return fb - fa; }
			const da = Math.abs((a + 1) - config.BASE_DRONE_LEVEL_HOME);
			const db = Math.abs((b + 1) - config.BASE_DRONE_LEVEL_HOME);
			if (da !== db) { return da - db; }
			return a - b;
		});
		const counts = floors.slice();
		for (let k = 0; k < remainder; k++) { counts[order[k]]++; }
		return counts;
	}
	/* Per-centre drone ledger: caps, initial levels, targets, crossCap, runtime fields. */
	levelPlan(count) {
		const W = config.BASE_DRONE_LEVEL_WEIGHTS;
		const total = W.reduce((a, b) => a + b, 0);
		const caps = W.map((w) => Math.max(1, Math.ceil(count * w / total)));
		const target = this.levelTargets(count);
		const initial = [];
		for (let lvl = 1; lvl <= target.length; lvl++) {
			for (let n = 0; n < target[lvl - 1]; n++) { initial.push(lvl); }
		}
		const R1 = this.levelR(1);
		let wSum = 0, tSum = 0;
		for (let lvl = 1; lvl <= config.BASE_DRONE_LEVELS; lvl++) {
			tSum += W[lvl - 1] * Bullet.estimateCrossTicks(this.levelR(lvl), R1);
			wSum += W[lvl - 1];
		}
		const crossCap = Math.max(1, Math.ceil(count * (tSum / wSum) / BASE_DRONE_CROSS_TICKS));
		return {
			caps, initial, target, crossCap,
			count: [0, 0, 0, 0, 0], crossing: 0,
			targets: {}, threat: null, threatAt: 0,
			provoked: 0, provokedAt: 0,
			scoutIdx: 0, scoutTimer: 0, sortTimer: 0
		};
	}
	/*
		Per-centre sorter and scout (not per-drone). Clears stale threat when the target is gone or
		unseen for two full scout cycles (scale with post count).
	*/
	tickDroneCentres() {
		for (const centre of this.droneCentres) {
			const levels = centre.levels;
			if (levels.threat && (levels.threat.destroy ||
				this.timestamp - levels.threatAt > BASE_DRONE_SCAN * centre.posts.length * 2)) {
				levels.threat = null;
			}
			if (levels.provoked && this.timestamp - levels.provokedAt > BASE_DRONE_PROVOKE_MEMORY) {
				levels.provoked = 0;
			}
			if (--levels.sortTimer <= 0) {
				levels.sortTimer = BASE_DRONE_SORT_PERIOD;
				this.sortDroneCentre(centre);
			}
			if (--levels.scoutTimer <= 0) {
				levels.scoutTimer = BASE_DRONE_SCAN;
				this.rotateScout(centre);
			}
		}
	}
	/*
		Drone for this post, or undefined. Bullet slots are reused after tombstones — check
		bull.post === post, not slot id alone.
	*/
	postDrone(post) {
		const bull = this.INSTANCE.bullets.get(post.slot);
		return (bull && bull.post === post) ? bull : undefined;
	}
	sortDroneCentre(centre) {
		const levels = centre.levels;
		const n = levels.count.reduce((a, b) => a + b, 0);
		if (!n) { return; }
		let target = levels.targets[n];
		if (!target) { target = levels.targets[n] = this.levelTargets(n); }
		const surplus = levels.count.map((c, i) => c - target[i]);
		const order = surplus.map((_, i) => i);
		for (let i = order.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			const t = order[i]; order[i] = order[j]; order[j] = t;
		}
		const eligible = (d) => !d.crossing && !d.chasing && !d.switching && !d.homing && d.switchCooldown <= 0;
		for (const i of order) {
			if (surplus[i] <= 0) { continue; }
			// Scan outward from level i for the NEAREST deficit, either direction; a tie picks at
			// random. No deficit anywhere means the ledger is over-full (only death/respawn fixes
			// that) - skip.
			let dir = 0;
			for (let d = 1; d < config.BASE_DRONE_LEVELS && !dir; d++) {
				const lo = i - d, hi = i + d;
				const loOpen = lo >= 0 && surplus[lo] < 0;
				const hiOpen = hi < config.BASE_DRONE_LEVELS && surplus[hi] < 0;
				if (loOpen && hiOpen) { dir = Math.random() < 0.5 ? -1 : 1; }
				else if (loOpen) { dir = -1; }
				else if (hiOpen) { dir = 1; }
			}
			if (!dir) { continue; }
			const level = i + 1;
			const pool = [];
			for (const post of centre.posts) {
				const drone = this.postDrone(post);
				if (drone && !drone.destroy && drone.level === level && eligible(drone)) { pool.push(drone); }
			}
			if (!pool.length) { continue; }
			const k = 1 + Math.floor(Math.random() * Math.min(surplus[i], pool.length));
			for (let moved = 0; moved < k && pool.length;) {
				const idx = Math.floor(Math.random() * pool.length);
				const drone = pool.splice(idx, 1)[0];
				if (Bullet.sortSwitch(drone, dir)) { moved++; }
			}
		}
	}
	/* Enable one drone's detector per centre at a time (round-robin). */
	rotateScout(centre) {
		const posts = centre.posts;
		if (!posts.length) { return; }
		const levels = centre.levels;
		for (let tries = 0; tries < posts.length; tries++) {
			levels.scoutIdx = (levels.scoutIdx + 1) % posts.length;
			const scout = this.postDrone(posts[levels.scoutIdx]);
			if (!scout || scout.destroy) { continue; }
			for (const post of posts) {
				const drone = this.postDrone(post);
				if (drone && !drone.destroy && drone.DETEC && !drone.chasing) {
					drone.DETEC.enabled = (drone === scout) ? 1 : 0;
				}
			}
			return;
		}
	}
	basePosts() { return []; }
	spawnBaseDrone(post) {
		const r = this.levelR(post.level);
		const bull = new Bullet(
			{ "GM": this.gm, "sId": this.id, "oId": -1 },
			post.x + Math.cos(post.phase) * r,
			post.y + Math.sin(post.phase) * r,
			0,
			0,
			undefined,
			this
		);
		bull.team = post.team;
		bull.ox = post.x;
		bull.oy = post.y;
		bull.post = post;
		bull.level = post.level;
		bull.levels = post.levels;
		bull.levels.count[bull.level - 1]++;
		bull.orbRTarget = r;
		bull.orbitState = 'ORBIT';
		bull.crossing = false;
		bull.chasing = false;
		bull.switching = false;
		bull.switchCooldown = 0;
		bull.levelTimer = tick.ticks(config.BASE_DRONE_LEVEL_RELAX);
		bull.tooClose = 0;
		bull.homing = 0;
		bull.DETEC = new Detector(bull, bull.x, bull.y, config.BASE_DRONE_DETECT, [KIND.PLAYER]);
		bull.DETEC.team = post.team;
		bull.DETEC.enabled = 0;
		bull.reactPending = 0;
		bull.spin = post.spin || 1;
		bull.head = post.phase + bull.spin * Math.PI / 2;
		bull.spd = tick.perTick(config.BASE_DRONE_ORBIT_SPEED);
		bull.pvec = { x: bull.vec.x, y: bull.vec.y };
		bull.autoDir = post.phase;
		bull.crossIn = post.crossIn || tick.ticks(config.BASE_DRONE_CROSS);
		bull.alone = 1;
		bull.life = -1;
		bull.type = 1.4;
		// Wire draw 7: equilateral at `size`. Type 1 is the drone class, drawn larger
		// (drawings.js DRONE_CLASS_DRAW) so a base drone does not follow that scale.
		bull.drawType = 7;
		bull.maxspeed = .75;
		bull.pene = config.BASE_DRONE_HP;
		bull.damage = config.BASE_DRONE_DAMAGE;
		bull.weight = 4.2;
		bull.push = 2;
		bull.size = config.BASE_DRONE_SIZE;
		bull.map = this.map;
		const made = this.INSTANCE.bullets.add((id) => {
			bull.id = { "GM": this.gm, "sId": this.id, "oId": id };
			return bull;
		});
		return made ? made.id.oId : -1;
	}
	/*
		Respawn countdown runs only while the post is empty; a live drone resets it. On death,
		decrement the shared level ledger once (levelReleased) before the slot is recycled.
	*/
	tickBaseDrones() {
		if (!this.dronePosts.length) { return; }
		for (const post of this.dronePosts) {
			const drone = this.postDrone(post);
			if (drone && drone.destroy && !drone.levelReleased) {
				drone.levels.count[drone.level - 1]--;
				if (drone.crossing) { drone.levels.crossing--; }
				drone.levelReleased = true;
			}
			if (drone && !drone.destroy) {
				post.respawnIn = BASE_DRONE_RESPAWN;
				continue;
			}
			if (--post.respawnIn > 0) { continue; }
			post.respawnIn = BASE_DRONE_RESPAWN;
			post.slot = this.spawnBaseDrone(post);
		}
	}
	Init() {
		for (let i = 0; i < this.rules.preGenerate; i++) {
			this.generate();
		}
		this.createAi();
		this.generateIn = FIRST_GENERATE;
	}
	generate() {
		if (this.destroy) { return; }
		const RNG = Math.random();
		///SQUARE///
		if (RNG < 1) {
			const obj = this.obj.sqr;
			if (obj[0] < obj.max0) { this.createObj("sqr", 0); obj[0]++; }
			if (obj[1] < obj.max1 && Math.random() < towardInstant(0.26)) { this.createObj("sqr", 1); obj[1]++; }
		}
		///TRIANGLE///
		if (RNG < towardInstant(0.7)) {
			const obj = this.obj.tri;
			if (obj[0] < obj.max0) { this.createObj("tri", 0); obj[0]++; }
			if (obj[1] < obj.max1 && Math.random() < towardInstant(0.26)) { this.createObj("tri", 1); obj[1]++; }
		}
		///PENTAGONE///
		if (RNG < towardInstant(0.5)) {
			const obj = this.obj.pnt;
			if (obj[0] < obj.max0) { this.createObj("pnt", 0); obj[0]++; }
			if (obj[1] < obj.max1 && Math.random() < towardInstant(0.2)) { this.createObj("pnt", 1); obj[1]++; }
		}
		///BULL///
		if (RNG < towardInstant(0.1)) {
			const obj = this.obj.bull;
			if (obj[1] < obj.max1) { this.createObj("bull", 0); obj[1]++; }
		}
		///BETA PENTAGONE///
		if (RNG > this.rules.betaPentRng) {
			const obj = this.obj.Bpnt;
			if (obj[1] < obj.max1) { this.createObj("Bpnt", 1); obj[1]++; }
		}
		///BETA SQUARE///
		if (RNG > 0.992) {
			const obj = this.obj.Bsqr;
			if (obj[1] < obj.max1) { this.createObj("Bsqr", 1); obj[1]++; }
		}
		///BETA TRIANGLE///
		if (RNG > 0.992) {
			const obj = this.obj.Btri;
			if (obj[1] < obj.max1) { this.createObj("Btri", 1); obj[1]++; }
		}
		///BOSSES///
		if (RNG > this.rules.bossRng) {
			if (Math.random() > 0.3) { this.createBoss() }
		}
		if (this.rules.maxBoss > 0) {
			if (this.bossTimerAt === undefined) { this.bossTimerAt = this.timestamp + BOSS_TIMER_TICKS; }
			if (!this.bosses.length && this.timestamp >= this.bossTimerAt) {
				this.createBoss();
				this.bossTimerAt = this.timestamp + BOSS_TIMER_TICKS;
			}
		}
	}
	createObj(type, pos) {
		let ppp = -1;
		if (pos) {
			const s = this.nestScale;
			switch (type) {
				case 'sqr':
				case 'Bsqr':
					ppp = [this.map.width / 4, this.map.height / 4, 490 * s]; // 350 x1.4, grid rescale
					break;
				case 'tri':
				case 'Btri':
					ppp = [-this.map.width / 4, -this.map.height / 4, 490 * s]; // 350 x1.4, grid rescale
					break;
				case 'pnt':
				case 'Bpnt':
					ppp = [0, 0, 630 * s]; // 450 x1.4, grid rescale
					break;
			}
		}
		if (type === 'bull') { ppp = 'bull'; }
		this.INSTANCE.objs.add((id) => new Objects(type, ppp, { "GM": this.gm, "sId": this.id, "oId": id }, this.map, this));
	}
	createAi() {
		for (const slot of this.botRoster()) {
			const bot = new Player(
				{ "GM": this.gm, "sId": this.id, "oId": slot.id },
				0,
				0,
				CONFIG.BOT_NAMES[Math.floor(Math.random() * (CONFIG.BOT_NAMES.length - 1))],
				slot.team,
				this.XPLVL,
				this
			);
			bot.motion = CONFIG.BOTS[0].bind(bot);
			bot.bot = 1;
			bot.xp = 5000 + Math.floor(Math.random() * 60000)
			this.INSTANCE.players.set(slot.id, bot);
			this.bots.push(slot.id);
			this.respawn(slot.id, 1, 1);
		}
	}
	/*
		Which slots the bots live in and whose side they are on. Slots are fixed for the life of
		the room - update() walks this.bots to find dead ones.
	*/
	botRoster() {
		const roster = [];
		for (let i = this.rules.botIdStart; i < this.rules.botIdStart + this.rules.botCount; i++) {
			roster.push({ id: i, team: this.rules.teams[0] });
		}
		return roster;
	}
	/* How many dead bots may come back this tick. Free-for-all tops the room up to botCount. */
	botBudget(humanCount) {
		return Math.max(0, this.rules.botCount - humanCount);
	}
	/* Every live non-scripted player - a lobby gate's own headcount and the wire's own
	 `playersJoined`. Counts a mid-respawn player too; only bosses/Closers are excluded. */
	contenderCount() {
		let n = 0;
		for (const p of this.INSTANCE.players.live()) { if (!p.boss && !p.closer) { n++; } }
		return n;
	}
	/* Whether respawn() may create a new tank right now - a mode's own no-comeback rule. */
	allowsRespawn() {
		return true;
	}
	/* Whether player input is suspended this tick - a mode's pre-match hold. */
	inputsFrozen() {
		return false;
	}
	/* Optional which/pos for tester; otherwise random boss on the quarter-radius ring. */
	createBoss(which, pos) {
		if (this.bosses.length >= this.rules.maxBoss) { return; }
		const spec = CONFIG.BOSS[(which === undefined) ? Math.floor(Math.random() * CONFIG.BOSS.length) : which];
		const randDir = Math.PI * 2 * Math.random();
		const at = pos || {
			x: Math.cos(randDir) * this.map.width / 4,
			y: Math.sin(randDir) * this.map.width / 4
		};
		const boss = this.INSTANCE.players.add((id) => {
			const b = new Player(
				{ "GM": this.gm, "sId": this.id, "oId": id },
				at.x,
				at.y,
				spec[2],
				this.rules.bossTeam,
				this.XPLVL,
				this
			);
			b.hp = this.rules.bossHp;
			b.maxHp = this.rules.bossHp;
			b.boss = 1;
			b.size = CLASS[spec[2]].bossSize || 64;
			b.guardSize = b.size * (CLASS[spec[2]].hitRatio || 1);
			b.fallen = !!CLASS[spec[2]].fallen;
			b.class = spec[2];
			b.screen = Player.scriptedScreen(b.class);
			b.prize = 30000;
			b.xp = 30000;
			b.damage = 10;
			b.up.Reload = Math.pow(0.914, 7);
			b.absorb = 0.05;
			b.shield = 0;
			b.provoked = 0;
			b.provokedAt = 0;
			b.motion = spec[0].bind(b);
			b.update = spec[1].bind(b);
			return b;
		});
		if (!boss) { return; }
		///
		this.bosses.push(boss);
		///
		for (const p of this.INSTANCE.players.live()) {
			if (p.bot || p.boss) { continue; }
			p.mess.push('Tremble at the sight of the ' + spec[2] + ' !');
		}
		return boss;
	}
	createDominator(x, y, variant) {
		const spec = CONFIG.DOMINATOR[(variant !== undefined) ? variant : Math.floor(Math.random() * CONFIG.DOMINATOR.length)];
		const dom = this.INSTANCE.players.add((id) => {
			const d = new Player(
				{ "GM": this.gm, "sId": this.id, "oId": id },
				x, y,
				spec[2],
				2,
				this.XPLVL,
				this
			);
			d.hp = 6148;
			d.maxHp = 6148;
			d.dominator = 1;
			d.level = 75;
			d.absorb = 0;
			d.size = 89.6;
			d.guardSize = d.size;
			d.class = spec[2];
			d.screen = Player.scriptedScreen(d.class);
			d.shield = 0;
			d.motion = spec[0].bind(d);
			d.update = spec[1].bind(d);
			return d;
		});
		if (dom) { this.dominators.push(dom); }
		return dom;
	}
	togglePossession(pilot) {
		if (pilot.destroy || pilot.dead) { return; }
		if (pilot.piloting) {
			this.releasePossession(pilot);
			return;
		}
		let best = null, bestD = Infinity;
		for (const e of this.dominators.concat(this.motherships)) {
			if (e.destroy || e.team !== pilot.team || e.pilotedBy) { continue; }
			const d = (e.x - pilot.x) ** 2 + (e.y - pilot.y) ** 2;
			if (d < bestD) { bestD = d; best = e; }
		}
		if (!best) {
			pilot.mess.push('Someone has already taken that tank');
			return;
		}
		best.pilotedBy = pilot;
		if (best.mothership) {
			best.possessionStartTick = this.timestamp;
			best.possessionWarned = false;
		}
		pilot.piloting = best;
		pilot.mess.push('Press H to surrender control of the tank');
	}
	releasePossession(pilot) {
		const target = pilot.piloting;
		if (!target) { return; }
		target.pilotedBy = null;
		target.possessionStartTick = -1;
		pilot.piloting = null;
	}
	/* nestScale, baseSize, shape caps, optional arenaLive newMap — from current this.map. */
	tickArena(humanCount) {
		if (this.rules.arenaLive) {
			const al = World.gu(arenaGu(humanCount));
			this.newMap.width = al;
			this.newMap.height = al;
		}
		this.nestScale = this.map.width / World.gu(NEST_REF_GU);
		const r = this.rules.baseSizeRatio;
		this.baseSize = r.num ? this.map.width * r.num / r.den : 0;
		const caps = apportionShapes(
			shapeTotal(this.map.width / World.GU, this.map.height / World.GU),
			this.rules.shapeMix);
		for (const type of ['sqr', 'tri', 'pnt']) {
			this.obj[type].max0 = caps[type].max0;
			this.obj[type].max1 = caps[type].max1;
		}
		this.obj.bull.max1 = Math.round(crasherTotal(this.nestScale) * this.rules.crasherDensity);
	}
	createBullet(bullet, origin) {
		this.assignBulletTeam(bullet, origin);
		bullet.map = this.map;
		this.INSTANCE.bullets.add((id) => {
			bullet.id = { 'GM': this.gm, 'sId': this.id, 'oId': id };
			return bullet;
		});
	}
	/* Which kills rules.xpMul applies to — tank kills and survival passive XP are unscaled. */
	static xpSource(entity, kind) {
		if (kind === KIND.OBJECTS) { return 'shape'; }
		if (entity.boss) { return 'boss'; }
		return 'player';
	}
	/* Single place polygon/boss kill XP is scaled — coins are not multiplied here. */
	awardXp(tank, amount, source) {
		const scaled = source === 'shape' || source === 'boss';
		tank.xp += amount * (scaled ? this.rules.xpMul : 1);
	}
	/* A bullet belongs to whoever fired it. The dev 'color' command tints it without moving
		 it to another side - bulletColor() is what reads that. */
	assignBulletTeam(bullet, origin) {
		bullet.team = origin.team;
		if (origin.dev.color) {
			bullet.color = origin.dev.color;
		} else if (origin.boss) {
			bullet.color = Room.bossColor(origin) + 1;
		}
	}
	step() {
		let stop = 1;
		let playerCount = 0;
		for (const i of this.INSTANCE.players.live()) {
			// Humans only — scripted entities must not keep an empty room alive.
			if (!i.bot && !i.boss && !i.closer && !i.dominator && !i.mothership) {
				playerCount++;
				stop = 0;
			}
		}
		if (stop) {
			this.destroy = 1;
			console.log(termColors.Bright + termColors.BgYellow + 'DELETED SERVER //' + termColors.Reset + ' ' + this.gm + ':' + this.id);
			delete this.controller.server[this.gm][this.id];
			clock.remove(this);
			return;
		}
		///SPAWNING///
		if (--this.generateIn <= 0) {
			this.generateIn = GENERATE_EVERY;
			this.generate();
		}
		///BASE DRONES///
		this.tickBaseDrones();
		this.tickDroneCentres();
		///MAP///
		if (Math.abs(this.map.width - this.newMap.width) > 0.1) {
			this.map.width += (this.newMap.width - this.map.width) * tick.smoothing(0.11989);
		} else {
			this.map.width = this.newMap.width;
		}
		if (Math.abs(this.map.height - this.newMap.height) > 0.1) {
			this.map.height += (this.newMap.height - this.map.height) * tick.smoothing(0.11989);
		} else {
			this.map.height = this.newMap.height;
		}
		// nestScale, baseSize, shape caps read this.map after the lerp, not newMap.
		this.tickArena(playerCount);
		///BOTS///
		let botNeeded = this.botBudget(playerCount);
		if (botNeeded) {
			for (const b of this.bots) {
				const bot = this.INSTANCE.players.get(b);
				if (bot && bot.dead === 1 && botNeeded) {
					this.respawn(b, 0, 1);
					botNeeded--;
				}
			}
		}
		///BOSS///
		for (let b = this.bosses.length - 1; b >= 0; b--) {
			if (this.bosses[b].destroy === 1) {
				this.bosses[b].state.disconnect = 1;
				this.bosses.splice(b, 1);
			}
		}
		///LEAD+ ADD TO QT///
		this.timestamp++;
		const qt = new quadTree(-this.map.width / 2 - 1000, -this.map.height / 2 - 1000, this.map.width + 2000, this.map.height + 2000, 6);
		this.leader = [];
		for (const kind in this.INSTANCE) {
			this.INSTANCE[kind].tick();
			for (const i of this.INSTANCE[kind].live()) {
				if (kind === 'players' && !i.destroy && !i.boss && !i.dominator) {
					if (this.leader.length) {
						for (let l = Math.min(this.leader.length - 1, 9); l >= 0; l--) {
							if (this.leader.length < 9) {
								///
								if (this.leader[l].xp < i.xp) {
									if (!l || this.leader[l - 1].xp >= i.xp) {
										this.leader.splice(l, 0, i);
										break;
									}
								} else if (l === this.leader.length - 1) {
									this.leader.push(i);
									break;
								}
								///
							} else if (this.leader[l].xp < i.xp && (!l || this.leader[l - 1].xp >= i.xp)) {
								this.leader.splice(l, 0, i);
								this.leader.pop();
								break;
							}
						}
					} else {
						this.leader.push(i);
					}
				}
				if (i.destroy === 1) {
					if (kind === "players") {
						if (i.state.disconnect) {
							i.delete();
							this.INSTANCE[kind].delete(i.id.oId);
						}
						continue;
					}
					// objs and bullets leave a numeric tombstone rather than a hole, so the slot -
					// and with it the entity id the client is tracking - is not handed to a new
					// entity on the next frame.
					if (kind === "objs") { i.delete(); this.INSTANCE[kind].delete(i.id.oId, true); continue; }
					// A permanent drone (life -1) reaching this tombstone path without ever going
					// through Bullet.prototype.collision() (e.g. update()'s owner-liveness guard, or
					// case 1.1's own self-destruct) still owes its owner a refund - release() is
					// idempotent, so this is a no-op if collision() already paid it.
					if (kind === 'bullets') { i.release && i.release(); this.INSTANCE[kind].delete(i.id.oId, true); continue; }
					this.INSTANCE[kind].delete(i.id.oId);
				} else {
					if (i.getPlace === 1) {
						i.size += config.SIZE_GET_POS;
					}
					qt.insert(i.x, i.y, i.size, i);
				}
			}
		}
		///COLLISION///
		for (const kind in this.INSTANCE) {
			for (const obj of this.INSTANCE[kind].live()) {
				if (obj.getPlace === 0) {
					continue;
				}
				if (obj.destroy >= 1) { continue; }
				// Enemy base: inEnemyBase() may extend past the map; only kill inside inArena().
				if ((kind === 'players' || kind === 'bullets') && this.inArena(obj) &&
					this.inEnemyBase(obj, kind === 'bullets' ? config.BASE_BULLET_MARGIN : 0)) {
					obj.release && obj.release();
					obj.collision(0, { base: 1 });
					continue;
				}
				COLLIDE_SCRATCH.length = 0;
				qt.queryCircle(obj.x, obj.y, (obj.DETEC && obj.DETEC.enabled ? obj.DETEC.size : (obj.guardSize || obj.size)) * 2, COLLIDE_SCRATCH);
				for (let ci = 0; ci < COLLIDE_SCRATCH.length; ci++) {
					const other = COLLIDE_SCRATCH[ci].data;
					if (other.getPlace === 0 || obj.getPlace === 0) {
						continue;
					}
					const otherKind = other.kind;
					const objKind = obj.kind;
					///
					if (other.destroy >= 1) { continue; }
					if (objKind === KIND.DETECTOR && otherKind === KIND.DETECTOR) { continue; }
					if (obj.id.oId === other.id.oId && objKind === otherKind) { continue; }
					const ddx = other.x - obj.x, ddy = other.y - obj.y;
					const dis = Math.sqrt(ddx * ddx + ddy * ddy);
					if (isBaseDrone(obj) && isBaseDrone(other) && dis < config.BASE_DRONE_SEPARATION) {
						if (obj.id.oId < other.id.oId) { obj.tooClose = 1; } else { other.tooClose = 1; }
					}
					if (this.rules.teamPlay && obj.team === other.team &&
						(isBaseDrone(obj) || isBaseDrone(other)) &&
						(objKind === KIND.PLAYER || objKind === KIND.BULLET) &&
						(otherKind === KIND.PLAYER || otherKind === KIND.BULLET)) { continue; }
					if ((isNaN(other.getPlace) || isNaN(obj.getPlace)) && (!this.rules.teamPlay || other.team !== obj.team)) {
						if (obj.DETEC && obj.DETEC.enabled) {
							if (dis <= obj.DETEC.size + other.size) {
								obj.DETEC.collision(other, { dis: dis })
							}
						} else if (other.DETEC && other.DETEC.enabled) {
							if (dis <= obj.size + other.DETEC.size) {
								other.DETEC.collision(obj, { dis: dis })
							}
						}
					}
					// After detector hits — team pass-through is separate from detection range.
					if (teamPassThrough(this, obj, objKind, other, otherKind)) { continue; }
					if (dis <= (obj.guardSize || obj.size) + (other.guardSize || other.size)) {
						// One visit per pair (size, then x+y tie) so mutual proration is not doubled.
						if (obj.size > other.size || (obj.size === other.size && obj.x + obj.y >= other.x + other.y)) {
							///
							if (other.getPlace || obj.getPlace) {
								if (other.getPlace && objKind === KIND.PLAYER) {
									other.getPlace = 0;
								}
								if (obj.getPlace && otherKind === KIND.PLAYER) {
									obj.getPlace = 0;
								}
								continue;
							}
							if (obj.x === other.x && obj.y === other.y) {
								obj.x += Math.random() - .5;
								obj.y += Math.random() - .5;
							}
							///
							const objOption = {};
							const otherOption = {};
							if (this.rules.teamPlay && objKind !== KIND.OBJECTS && otherKind !== KIND.OBJECTS && obj.team === other.team) {
								objOption.noDam = 1;
								otherOption.noDam = 1;
							}
							if (!objOption.noDam && !damageGuarded(obj, objKind) && !damageGuarded(other, otherKind)) {
								const dObjToOther = tick.perTick(damageOutput(obj, objKind, otherKind));
								const dOtherToObj = tick.perTick(damageOutput(other, otherKind, objKind));
								if (dObjToOther > 0 && dOtherToObj > 0) {
									const objHp = objKind === KIND.BULLET ? obj.pene : obj.hp;
									const otherHp = otherKind === KIND.BULLET ? other.pene : other.hp;
									const ratio = Math.max(1 - objHp / dOtherToObj, 1 - otherHp / dObjToOther);
									const scale = Math.min(1, 1 - ratio);
									if (scale < 1) {
										objOption.dmgScale = scale;
										otherOption.dmgScale = scale;
									}
								}
							}
							if (objKind === KIND.BULLET) {
								otherOption.dmg = obj.damage;
							}
							if (otherKind === KIND.BULLET) {
								objOption.dmg = other.damage;
							}
							other.collision(obj, otherOption);
							obj.collision(other, objOption);
							if (objKind === KIND.BULLET) {
								if (other.destroy && other.prize) {
									const killer = this.INSTANCE.players.get(obj.origin.oId);
									if (killer) {
										this.awardXp(killer, other.prize, Room.xpSource(other, otherKind));
										killer.coins += other.coinReward || 0;
										if (otherKind === KIND.PLAYER && !killer.bot) {
											killer.mess.push('You killed ' + other.name);
											killer.unlock('first_blood');
										} else if (otherKind === KIND.OBJECTS) {
											killer.registerKill(other.type);
										}
									}
								}
							}
							if (otherKind === KIND.BULLET && obj.prize) {
								if (obj.destroy) {
									const killer = this.INSTANCE.players.get(other.origin.oId);
									if (killer) {
										this.awardXp(killer, obj.prize, Room.xpSource(obj, objKind));
										killer.coins += obj.coinReward || 0;
										if (objKind === KIND.PLAYER && !killer.bot) {
											killer.mess.push('You killed ' + obj.name);
											killer.unlock('first_blood');
										} else if (objKind === KIND.OBJECTS) {
											killer.registerKill(obj.type);
										}
									}
								}
							}
							if (obj.destroy) {
								break;
							}
						}
					}
				}
			}
		}
		this.INSTANCE.detectors.clear();
		///BUFFING///
		for (const p of this.INSTANCE.players.live()) {
			if (p.pet) {
				this.INSTANCE.bullets.reserve(p.pet.id.oId);
				if (p.alpha) qt.insert(p.pet.x, p.pet.y, p.size, p.pet);
			}
		}
		this.BUFFER = [];
		// Walls: exact AABB overlap per viewer (quadtree centre indexing misses long rects).
		const wallList = this.INSTANCE.walls.size ? [...this.INSTANCE.walls.live()] : null;
		for (const [id, player] of this.INSTANCE.players.entries()) {
			if (player.bot || player.boss || player.dominator) {
				continue;
			}

			// While piloting, HUD/buffer main entity is the possessed tank, not the vacated body.
			const cam = player.piloting || player;
			// Predator zoom: buffer centre follows zoom point, not tank position (screen size unchanged).
			const camX = cam.zooming ? cam.zoomX : cam.x;
			const camY = cam.zooming ? cam.zoomY : cam.y;
			const x = camX - cam.screen / 2 - 200, y = camY - cam.screen / 2 * 0.5625 - 200;
			const w = cam.screen + 400, h = cam.screen * 0.5625 + 400;

			this.BUFFER[id] = {
				x: x,
				y: y,
				w: w,
				h: h
			}
			this.BUFFER[id].main = cam;
			const qx = x - 200, qy = y - 200, qw = w + 400, qh = h + 400;
			let rest = qt.query(function (a, b) {
				return (
					((a.x + a.w) >= b.x) &&
					(a.x <= (b.x + b.w)) &&
					((a.y + a.h) >= b.y) &&
					(a.y <= (b.y + b.h))
				);
			},
				{ 'x': qx, 'y': qy, 'w': qw, 'h': qh });
			if (wallList) {
				rest = rest.filter((p) => !p.data || p.data.kind !== KIND.WALL);
				for (const wall of wallList) {
					if (wall.x - wall.w / 2 <= qx + qw && wall.x + wall.w / 2 >= qx &&
						wall.y - wall.h / 2 <= qy + qh && wall.y + wall.h / 2 >= qy) {
						rest.push({ x: wall.x, y: wall.y, size: wall.size, data: wall });
					}
				}
			}
			this.BUFFER[id].rest = rest;
		}
		///UPDATE///
		for (const kind in this.INSTANCE) {
			for (const [o, obj] of this.INSTANCE[kind].entries()) {
				if (obj.destroy === 1) {
					if (kind === "players") {
						if (obj.dead > 1) {
							obj.dead--;
						}
						if (obj.murder === -1) {
							continue;
						}
						const murder = this.INSTANCE[obj.murder[0]].get(obj.murder[1].oId);
						if (!murder || murder.destroy) {
							obj.murder = -1;
							continue;
						}
						obj.x += (murder.x - obj.x) * tick.smoothing(0.11989); // smoothing-category, see the map-lerp comment above
						obj.y += (murder.y - obj.y) * tick.smoothing(0.11989);
					}
					continue;
				}
				if (obj.getPlace === 1) {
					delete obj.getPlace;
					obj.size -= config.SIZE_GET_POS;
				} else if (obj.getPlace === 0) {
					obj.delete();
					this.INSTANCE[kind].delete(o, false);
					continue;
				}
				obj.update();
			}
		}
	}
	/* Team modes override; margin lets bullets penetrate slightly before the base line. */
	inEnemyBase(obj, margin = 0) {
		return false;
	}
	/* Drawn arena bounds — paired with inEnemyBase() in step() so OOB is not a base kill. */
	inArena(obj) {
		return Math.abs(obj.x) <= this.map.width / 2 && Math.abs(obj.y) <= this.map.height / 2;
	}
	respawn(id, force = 0, bot = 0) {
		const tank = this.INSTANCE.players.get(id);
		// Gate on dead, not destroy — respawn is allowed during the death animation.
		if (!tank || (!force && !tank.dead)) return;
		// respawnTeam reads murder on the old tank; must run before replacing the Player.
		const team = this.respawnTeam(tank);
		const pos = (this.rules.teamPlay && this.factorySpawnPoint(team)) || this.spawnPoint(tank);
		const newTank = new Player(tank.id, pos.x, pos.y, tank.name, team, this.XPLVL, this);
		if (bot) {
			newTank.motion = CONFIG.BOTS[0].bind(newTank);
			newTank.bot = 1;
			if (Math.random() < 0.1) {
				newTank.name = CONFIG.BOT_NAMES[Math.floor(Math.random() * (CONFIG.BOT_NAMES.length - 1))];
			}
		}
		///
		newTank.xp = force ? tank.xp : this.respawnXp(tank.xp);
		newTank.coins = tank.coins || 0;
		// New Player each life — carry held keys, achievements, and session kill counts.
		newTank.inputs = Object.assign({}, tank.inputs);
		newTank.userKey = tank.userKey;
		newTank.unlocked = Object.assign({}, tank.unlocked);
		newTank.killCounts = Object.assign({}, tank.killCounts);
		this.INSTANCE.players.set(id, newTank);
		///
		if (tank.pet) {
			newTank.pet = tank.pet;
			newTank.pet.x = newTank.x;
			newTank.pet.y = newTank.y;
			newTank.pet.pet = 1;
			const newId = this.INSTANCE.bullets.freeIndex();
			newTank.pet.id = { "GM": this.gm, "sId": this.id, "oId": newId };
			this.INSTANCE.bullets.reserve(newId);
		}
		///
		return tank.xp;
	}
	respawnTeam(tank) {
		return tank.team;
	}
	factorySpawnPoint(team) {
		if (Math.random() > config.FACTORY_SPAWN_CHANCE) { return null; }
		const factories = [];
		for (const p of this.INSTANCE.players.live()) {
			if (p.team === team && p.class === 'Factory' && !p.dead) { factories.push(p); }
		}
		if (!factories.length) { return null; }
		const factory = factories[Math.floor(Math.random() * factories.length)];
		const can = CLASS[factory.class].cannons[0];
		const ra = factory.size / 35;
		const offx = can.offx * ra;
		const len = can.canonLength * ra;
		const offlen = Math.hypot(len, offx);
		const offdir = Math.atan2(offx, len);
		const mountDir = factory.dir + can.offdir;
		return {
			x: factory.x + Math.cos(mountDir + offdir) * offlen,
			y: factory.y + Math.sin(mountDir + offdir) * offlen
		};
	}
	respawnXp(xp) {
		const mXp = this.XPLVL[this.XPLVL.length - 1];
		const pow = this.rules.respawnPow;
		if (xp > mXp) {
			return mXp * .6;
		}
		return Math.min(xp, parseInt(Math.pow(xp / (mXp / Math.pow(mXp * .6, 1 / pow)), pow)));
	}
	/* Sample a point outside all keep-out circles; bounded tries, best-effort fallback. */
	rejectSample(inset, circles, tries = SPAWN_TRIES) {
		// A map narrower than 2*inset would invert the range below and place points off the map.
		const ix = Math.min(inset, this.map.width / 8);
		const iy = Math.min(inset, this.map.height / 8);
		let best = null, bestScore = -Infinity;
		for (let n = 0; n < tries; n++) {
			const x = ix + Math.random() * (this.map.width - ix * 2) - this.map.width / 2;
			const y = iy + Math.random() * (this.map.height - iy * 2) - this.map.height / 2;
			let score = Infinity;
			for (let c = 0; c < circles.length; c++) {
				const dx = x - circles[c][0], dy = y - circles[c][1];
				const s = Math.hypot(dx, dy) / circles[c][2];
				if (s < score) { score = s; }
			}
			if (score > 1) { return { x: x, y: y }; }
			if (score > bestScore) { bestScore = score; best = { x: x, y: y }; }
		}
		return best;
	}
	/* Three nest keep-outs; radii are reference values × nestScale. */
	spawnKeepOut() {
		const s = this.nestScale;
		return [
			[0, 0, 1540 * s],
			[this.map.width / 4, this.map.height / 4, 1120 * s],
			[-this.map.width / 4, -this.map.height / 4, 1120 * s]
		];
	}
	spawnPoint(tank) {
		return this.rejectSample(280 * this.nestScale, this.spawnKeepOut());
	}
	clearOfWalls(x, y, pad) { return true; }
	clearOfShapes(x, y, r) {
		for (const o of this.INSTANCE.objs.live()) {
			if (o.destroy) { continue; }
			const dx = o.x - x, dy = o.y - y;
			const need = o.size + r;
			if (dx * dx + dy * dy < need * need) { return false; }
		}
		return true;
	}
	getBuffer(id) {
		const RAW = this.BUFFER[id];
		if (!RAW) {
			return;
		}
		if (!RAW.main) {
			return;
		}
		const buff = {
			instances: []
		};
		buff.head = {
			timestamp: this.timestamp,
			width: this.map.width,
			height: this.map.height,
			screen: RAW.main.screen,
			xp: RAW.main.xp,
			still: (RAW.main.dead || RAW.main.boss || RAW.main.dominator || RAW.main.mothership)
				? 0 : Player.pointsAtLevel(RAW.main.level) - RAW.main.stillLvl,
			cLvl: (RAW.main.dead || RAW.main.boss || RAW.main.dominator || RAW.main.mothership)
				? 0 : parseInt(RAW.main.level / 15),
			baseSize: this.baseSize || 0,
			arenaState: this.state,
			ticksUntilStart: Math.max(0, this.ticksUntilStart),
			playersNeeded: this.playersNeeded,
			camX: RAW.main.zooming ? RAW.main.zoomX : RAW.main.x,
			camY: RAW.main.zooming ? RAW.main.zoomY : RAW.main.y,
			canRespawn: this.allowsRespawn() ? 1 : 0,
			playersJoined: this.contenderCount()
		};
		///
		const lvl = RAW.main.level, xp = RAW.main.xp, arr = RAW.main.XPLVL;
		// A possessed Dominator/Mothership has a flat level and no xp curve to interpolate
		// along - send its level as-is rather than dividing by an xp band it never had.
		buff.head.level = (RAW.main.boss || RAW.main.dominator || RAW.main.mothership) ? lvl
			: (!lvl ? 1 : ((lvl >= arr.length - 1) ? lvl : lvl + Math.max(Math.min(1, (xp - arr[lvl - 1]) / (arr[lvl] - arr[lvl - 1])), 0)));
		///
		buff.main = {
			// states[4]: Predator zoom - whether head.camX/camY is currently a real
			// zoom lock point rather than just this tank's own x/y (the unzoomed default), so the
			// client knows whether to pan its camera out to it or keep tracking its own tank.
			states: [!!RAW.main.hit * 1,
			!!RAW.main.spinning * 1,
			!!RAW.main.dead * 1,
			!!RAW.main.shield * 1, !!RAW.main.zooming * 1, 0],
			class: RAW.main.class,
			color: RAW.main.dev.color ? RAW.main.dev.color - 1 : this.mainColor(RAW.main),
			x: RAW.main.x,
			y: RAW.main.y,
			vx: RAW.main.vec.x,
			vy: RAW.main.vec.y,
			// Use spinDir only while spinning is latched on the sim tick — inputs.c can lead encode.
			dir: RAW.main.spinning ? RAW.main.spinDir : RAW.main.dir,
			ringDir: RAW.main.ringDir || 0,
			size: RAW.main.size,
			alpha: RAW.main.alpha,
			hp: RAW.main.hp / RAW.main.maxHp,
			name: RAW.main.name,
			nameC: 0,
			recoil: RAW.main.recoil,
			canDir: RAW.main.canDir ? RAW.main.canDir : []
		};
		for (const i of RAW.rest) {
			const obj = i.data;
			if (obj.getPlace === 0) {
				continue;
			}
			// A wall's CENTRE says nothing about whether any of it is on screen - it is the one
			// non-circle here and it can be arbitrarily long (see the wallList block in step()).
			// It was already exact-rectangle-tested against this same buffer when the list was
			// built, so it is in this list precisely because it overlaps; re-testing its centre
			// here is what dropped a long wall the moment its middle scrolled off.
			if (obj.kind !== KIND.WALL && (
				((obj.x) <= RAW.x) ||
				((obj.y) <= RAW.y) ||
				((obj.x) >= (RAW.x + RAW.w)) ||
				((obj.y) >= (RAW.y + RAW.h))
			)) { continue; }
			///
			// One encoded snapshot per entity per tick, shared by everyone who can see it. Your
			// own bullets are the exception when rules.viewerBullets is set: they carry your
			// colour rather than your team's, so they cannot come out of the shared cache.
			if (obj.BUFF.timestamp !== this.timestamp) {
				let raw;
				switch (obj.kind) {
					case KIND.PLAYER: {
						raw = {
							construc: 'Players',
							id: obj.id.oId,
							states: [!!obj.hit * 1,
							!!obj.shield * 1,
								0, 0, 0, 0, !!obj.bot * 1],
							class: obj.class,
							color: obj.dev.color ? obj.dev.color - 1 : this.entityColor(obj),
							x: obj.x,
							y: obj.y,
							vx: obj.vec.x,
							vy: obj.vec.y,
							dir: obj.dir,
							ringDir: obj.ringDir || 0,
							size: obj.size,
							alpha: obj.alpha,
							hp: Math.max(0, obj.hp / obj.maxHp),
							xp: obj.xp,
							name: obj.name,
							nameC: 0,
							recoil: obj.recoil,
							canDir: obj.canDir ? obj.canDir : []
						}
						break;
					};
					case KIND.OBJECTS: {
						raw = {
							construc: 'Objects',
							id: obj.id.oId,
							// Slots 1-3 are obj.tier (0-7) as 3 bits, not a flag - see
							// public/SHARE/ObjectsConfig.js.
							states: [!!obj.hit * 1, (obj.tier >> 2) & 1, (obj.tier >> 1) & 1, obj.tier & 1, 0, 0, 0],
							shape: obj.type,
							hp: Math.max(0, obj.hp / obj.maxHp),
							x: obj.x,
							y: obj.y,
							size: obj.size,
							alpha: obj.alpha,
							// - the shape's own real facing (idle BASE_ROTATION spin, or a
							// Crasher's live atan2-to-target while chasing), server-authoritative now.
							dir: obj.dir,
						};
						break;
					};
					case KIND.BULLET: {
						// Your own bullet never populates the shared cache - it always takes the
						// per-viewer path below (states[1] `mine`, and the colour override) in every
						// gamemode, not just when rules.viewerBullets is set.
						if (obj.origin.oId === RAW.main.id.oId) {
							break;
						}
						raw = {
							construc: 'Bullets',
							id: obj.id.oId,
							states: [!!obj.pet * 1, 0, !!obj.underlay * 1, 0, 0, 0, 0],
							type: bulletWireType(obj),
							x: obj.x,
							y: obj.y,
							size: obj.size,
							color: this.bulletColor(obj),
							alpha: obj.alpha,
							dir: obj.showDir
						};
						break;
					};
					case KIND.WALL: {
						raw = {
							construc: 'Walls',
							id: obj.id.oId,
							x: obj.x,
							y: obj.y,
							w: obj.w,
							h: obj.h
						};
						break;
					};
				}
				if (raw) {
					obj.BUFF.data = new Int8Array(this.controller.encodeInst('Instance', raw));
					obj.BUFF.timestamp = this.timestamp;
				}
			}
			///
			switch (obj.kind) {
				case KIND.PLAYER: {
					if (!obj.alpha) {
						continue;
					}
					if (RAW.main.id.oId === obj.id.oId) {
						continue;
					}
					break;
				};
				case KIND.BULLET: {
					if (obj.origin.oId === RAW.main.id.oId) {
						const raw = new Int8Array(this.controller.encodeInst('Instance', {
							construc: 'Bullets',
							id: obj.id.oId,
							states: [!!obj.pet * 1, 1, !!obj.underlay * 1, 0, 0, 0, 0],
							type: bulletWireType(obj),
							x: obj.x,
							y: obj.y,
							size: obj.size,
							// Colour still only differs from the shared cache when the gamemode
							// actually uses per-viewer bullet colour - team-mode colours don't
							// change just because the mine bit is now always real.
							color: this.rules.viewerBullets ? this.ownBulletColor(obj, RAW.main) : this.bulletColor(obj),
							alpha: obj.alpha,
							dir: obj.showDir
						}));
						buff.instances.push(raw);
						continue;
					}
					break;
				}
			}
			buff.instances.push(obj.BUFF.data);
		};
		return buff;
	}
	entityColor(player) {
		return player.boss ? Room.bossColor(player) : (Room.neutralColor(player) ?? 1);
	}
	/* Colour of your own tank on your own screen. */
	mainColor(player) {
		return 0;
	}
	bulletColor(bullet) {
		// drawColor from cannon config; type 3 is necro-beige in ffa only; boss tint via bullet.color.
		if (bullet.drawColor !== undefined) { return bullet.drawColor; }
		if (bullet.type === 3 && !this.rules.teamPlay) { return 9; }
		return bullet.color ? bullet.color - 1 : bullet.team;
	}
	ownBulletColor(bullet, main) {
		if (bullet.drawColor !== undefined) { return bullet.drawColor; }
		if (bullet.type === 3 && !this.rules.teamPlay) { return 9; }
		return main.dev.color ? main.dev.color - 1 : 0;
	}
	leaderColor(player, viewerId) {
		return (player.id.oId === viewerId) ? 0 : player.team;
	}
	mapDotColor(player, viewerId) {
		return player.boss ? this.entityColor(player) : this.leaderColor(player, viewerId);
	}
	leaderRows(id) {
		const rows = [];
		for (const i of this.leader) {
			rows.push({
				xp: i.xp,
				name: i.name,
				nameC: 0,
				team: i.dev.color ? i.dev.color - 1 : this.leaderColor(i, id)
			});
		}
		return rows;
	}
	getUi(id) {
		const buff = {
			leader: [],
			map: [],
			mess: []
		};
		buff.leader = this.leaderRows(id);
		for (const i of this.INSTANCE.players.live()) {
			if (i.destroy) { continue; }
			buff.map.push({
				x: (i.x + this.map.width / 2) / this.map.width,
				y: (i.y + this.map.height / 2) / this.map.height,
				team: i.dev.color ? i.dev.color - 1 : this.mapDotColor(i, id),
				size: Math.min(255, Math.round(i.size)),
				w: 0,
				h: 0
			});
		}
		for (const d of this.wallDots) { buff.map.push(d); }
		for (const i of this.INSTANCE.players.get(id).mess) {
			buff.mess.push(i);
		};
		this.INSTANCE.players.get(id).mess = [];
		return buff;
	}
	/* Which side a joining player lands on: the thinnest one, coin toss when they are level.
		 A one-team mode has exactly one answer, so free-for-all falls out of the same code. */
	assignTeam() {
		const count = new Array(this.rules.teams.length).fill(0);
		for (const p of this.INSTANCE.players.live()) {
			const t = this.rules.teams.indexOf(p.team);
			if (t >= 0) { count[t]++; }
		}
		let smallest = 0;
		for (let i = 1; i < count.length; i++) {
			if (count[i] < count[smallest]) { smallest = i; }
		}
		const tied = count.filter((n) => n === count[smallest]).length;
		if (tied === count.length) {
			smallest = Math.floor(Math.random() * count.length);
		}
		return this.rules.teams[smallest];
	}
	ask(data) {
		const name = data.name;
		const pet = (data.pet > -1) ? new Bullet(0, 0, 0, 0, 0, 0, this) : null;
		if (pet) {
			pet.update = CONFIG.PETS[0].bind(pet);
			pet.type = data.pet;
		}
		///
		const tank = this.INSTANCE.players.add((i) => {
			const id = { "GM": this.gm, "sId": this.id, "oId": i };
			const t = new Player(
				id,
				0,
				0,
				name,
				this.assignTeam(),
				this.XPLVL,
				this
			);
			t.userKey = data.key;
			if (pet) { t.pet = pet; pet.origin = t.id; pet.team = t.team; }
			return t;
		});
		if (!tank) { return; }
		this.respawn(tank.id.oId, 1);
		console.log('NEW PLAYER gm: ' + this.gm + ' serve-Id: ' + this.id + ' player id: ' + tank.id.oId);
		return tank.id;
	}
};

Room.ArenaState = { COUNTDOWN: -1, OPEN: 0, OVER: 1, CLOSING: 2, CLOSED: 3 };

/* Uncaptured dominator and closer use neutral (14); captured dominator uses team colour. */
Room.neutralColor = function (player) {
	if (player.closer) { return 14; }
	if (player.dominator && player.team === 2) { return 14; }
	return null;
};
Room.bossColor = function (player) {
	switch (player.class) {
		case 'Guardian': return 10;
		case 'Defender': return 11;
		case 'Summoner': return 12;
		case 'Fallen Overlord':
		case 'Fallen Booster': return 13;
		default: return player.team;
	}
};

module.exports = Room;
