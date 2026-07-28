/*
	Room - the shared simulation behind every gamemode.

	Ffa and TwoTeam used to be two ~750-line files that were roughly 90% the same code and
	had already drifted apart in a dozen places. Everything genuinely shared
	- the tick, the quadtree, collision, spawning, the leaderboard, the per-player view
	builder - now lives here exactly once. A gamemode is a subclass that hands super() a block
	of tunables and overrides a handful of small hooks:

		HOOK                    BASE DEFAULT                   WHY IT EXISTS
		build()                 nothing                        anything a mode needs pre-tick
		basePosts()             no posts                       team modes orbit drones on their base
		botRoster()             rules.botCount bots, one team  team modes split bots across sides
		botBudget(humans)       rules.botCount - humans        team modes restock every side
		spawnPoint(tank)        anywhere, clear of the nests   team modes spawn you in your base
		inEnemyBase(obj,margin) false                          team modes kill you in a foreign base
		entityColor(p)          1 - everyone else is red       team modes colour by team
		mainColor(p)            0 - you are blue               team modes colour by team
		bulletColor(b)          traps 9, else the bullet team  team modes colour traps by team
		ownBulletColor(b,you)   your own colour                only used when rules.viewerBullets
		leaderColor(p,id)       you 0, everyone else 1

	The defaults are free-for-all's behaviour, so Ffa overrides almost nothing.

	`assignTeam` (join the thinnest side), `assignBulletTeam` and `createBoss` used to be on
	that list too. All three were written in TwoTeam in a form that already generalised - the
	balance loop counts N teams, the boss only varied by team id and hit points - and produced
	identical results to the base version when a mode has one team and no bosses. They moved
	up, so a new mode inherits them; rules.teams, rules.maxBoss, rules.bossHp and
	rules.bossTeam are what a mode states instead. rooms/FourTeam.js and rooms/BossMode.js are
	short mostly because of that.

	Adding a mode means writing one of these subclasses - see rooms/TwoTeam.js for the biggest
	one there is - and naming it in the ROOMS table in rooms/index.js. Nothing else outside
	rooms/ needs to know it exists: Controller.askConnection whitelists whatever is in ROOMS, and
	the only other edit is the gamemode enum in public/SHARE/SocketSchema.js, because the mode has
	to fit in the byte the client sends.

	A room takes its controller as a constructor parameter rather than reaching through a
	registry - Room -> Controller is the only edge that isn't already a plain tree (Controller
	constructs rooms, rooms construct entities), so passing it down is enough to make the whole
	graph acyclic.
*/
const config = require('../lib/config.js').config;
const tick = require('../lib/tick.js');
const termColors = require('../lib/terminal.js');
const quadTree = require('../lib/quadTree.js');
const SlotMap = require('../lib/SlotMap.js');
const CLASS = require('../public/SHARE/TanksConfig.js').class;
const KIND = require('../public/SHARE/kinds.js');
const clock = require('../lib/clock.js');
const Player = require('../entities/Player.js');
const Bullet = require('../entities/Bullet.js');
const Objects = require('../entities/Objects.js');
const Detector = require('../entities/Detector.js');
const CONFIG = require('../lib/gameAI.js');

// generate() is a simulation event, so it rides the simulation clock: one pass every this many fixed steps. These divide by the
// actual wall-clock step (clock.STEP_MS, 25ms/40Hz), not a reference tick,
// so they stay wall-clock-correct with no rescale of their own.
const GENERATE_EVERY = Math.round(400 / clock.STEP_MS);   // 16 steps = 400ms at 40Hz
const FIRST_GENERATE = Math.round(300 / clock.STEP_MS);   // 12 steps = 300ms at 40Hz

// How long a base drone post stays empty after its drone dies. A count of
// reference ticks in config, converted to real ticks once here rather than per post per tick.
const BASE_DRONE_RESPAWN = tick.ticks(config.BASE_DRONE_RESPAWN);
// How often each orbit centre's binomial sorter and detection scout run.
// The sorter's period is denominated in reference ticks like every other gameplay-feel constant;
// the scout's is a raw real-tick count (a cost knob, the same category as GENERATE_EVERY above),
// so it is read straight off config with no tick.ticks() conversion.
const BASE_DRONE_SORT_PERIOD = tick.ticks(config.BASE_DRONE_SORT_PERIOD);
const BASE_DRONE_SCAN = config.BASE_DRONE_SCAN;
const BASE_DRONE_CROSS_TICKS = tick.ticks(config.BASE_DRONE_CROSS);
// How long an orbit centre stays angry at a polygon boss that hurt one of its drones, in reference
// ticks like its neighbours above.
const BASE_DRONE_PROVOKE_MEMORY = tick.ticks(config.BASE_DRONE_PROVOKE_MEMORY);

// A base drone is one of its own side's bullets, for the team-transparency skip below - type 1.4
// with life -1 is otherwise indistinguishable from any other homing bullet.
const isBaseDrone = (e) => e.kind === KIND.BULLET && e.type === 1.4;

// Caller-owned scratch array for the collision pass's quadTree.queryCircle() calls - reused and
// cleared (length = 0) before every query rather than allocated fresh, since
// this runs once per live entity per tick. Module-scope, not per-Room: every room's step() runs on
// the same single-threaded event loop tick, never concurrently, so there is nothing to race.
const COLLIDE_SCRATCH = [];

// rejectSample()'s hard cap. ffa's acceptance rate is ~0.9, so 128
// consecutive rejections is ~10^-133 - the cap exists to bound the unsatisfiable case, not the
// unlucky one.
const SPAWN_TRIES = 128;

/*
	Every knob a gamemode can turn without writing code. A subclass spreads its own values
	over these in its constructor, so a mode only states what it changes.
*/
const DEFAULT_RULES = {
	gm: 'ffa',
	maxXp: 25000,  // the level-30 cap; drives the whole XPLVL curve
	mapSize: { width: 9020, height: 9020 },
	maxPlayer: 24,
	preGenerate: 500,    // generate() passes run before the room opens
	bootDelay: 100,    // ms between construction and the first tick
	objCaps: { sqr: { max0: 220, max1: 18 }, tri: { max0: 80, max1: 12 }, pnt: { max0: 25, max1: 15 } },
	betaPentRng: 0.98,   // RNG above this may spawn a beta pentagon
	bossRng: 2,      // ... and above this calls createBoss(). 2 = never.
	maxBoss: 0,      // how many bosses may be alive at once. 0 = the mode has none.
	bossHp: 20000,
	bossTeam: 9,      // bosses are on nobody's side; 9 is the 'necro' colour
	botCount: 10,
	botIdStart: 10,     // bots occupy a fixed slot range so respawn can find them
	teams: [1],    // the team ids this mode assigns. One entry = free-for-all.
	teamPlay: false,  // friendly fire off, and detectors ignore team mates
	respawnPow: 0.9,    // exponent of the xp you keep through a death
	baseSize: 0,
	viewerBullets: true   // re-encode your own bullets per viewer so they read as yours
};

class Room {
	constructor(id, rules, controller) {
		this.rules = Object.assign({}, DEFAULT_RULES, rules);
		this.controller = controller;
		const POW = 2.5;
		const MXLVL = this.rules.maxXp;
		this.XPLVL = new Array(30).fill(0).map((x, i) => {
			if (i === 0) {
				return 0;
			}
			const a = 30 / Math.pow(MXLVL, 1 / POW)
			return Math.min(MXLVL, parseInt(Math.pow((i + 1) / a, POW)));
		})
		this.gm = this.rules.gm;
		this.id = id;
		this.BUFFER = {};
		this.maxPlayer = this.rules.maxPlayer;
		this.INSTANCE = {
			"players": new SlotMap({ maxIndex: this.maxPlayer }),
			"objs": new SlotMap(),
			"bullets": new SlotMap(),
			"detectors": new SlotMap()
		};
		const caps = this.rules.objCaps;
		this.obj = {
			"sqr": { "0": 0, "1": 0, "max0": caps.sqr.max0, "max1": caps.sqr.max1 },
			"tri": { "0": 0, "1": 0, "max0": caps.tri.max0, "max1": caps.tri.max1 },
			"pnt": { "0": 0, "1": 0, "max0": caps.pnt.max0, "max1": caps.pnt.max1 },
			"Bpnt": { '1': 0, 'max1': 3 },
			"Bsqr": { '1': 0, 'max1': 2 },
			"Btri": { '1': 0, 'max1': 2 },
			"bull": { '1': 0, 'max1': 39 }   // 20 x1.96, same density-hold as objCaps
		};
		this.baseSize = this.rules.baseSize;
		this.leader = [];
		this.map = {
			width: this.rules.mapSize.width,
			height: this.rules.mapSize.height
		};
		// newMap is what the map lerps towards each tick; the 'mapResize' admin command writes
		// it. Starting them equal makes the lerp a no-op until someone asks for a resize.
		this.newMap = {
			width: this.rules.mapSize.width,
			height: this.rules.mapSize.height
		};
		this.timestamp = 0;
		this.bots = [];
		// Every boss currently alive. A list rather than a single slot because 'boss' mode runs
		// several at once; modes with rules.maxBoss 0 never put anything in it.
		this.bosses = [];
		// Counts down to the next generate() pass. Init() sets it; step() decrements it.
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
		// A one-shot delay, not a self-re-arming chain: at the end of it the room joins the
		// shared fixed-step clock (lib/clock.js) and every tick after this one comes from there.
		setTimeout((it) => { it.Init(); clock.add(it); }, this.rules.bootDelay, this);
	}
	/*
		Anything a mode needs standing in the world before the first tick - 2team's base
		drones. Runs before Init(), which is what fills the map with polygons.
	*/
	build() { }
	/*
		The shared five-level radius table. levelR(n) = ORBIT_R + (n - HOME) *
		LEVEL_GAP, so level 3 (home) sits at the nominal ORBIT_R and levels 1/2/4/5 sit one/two
		drone-sides in or out of it. Both team modes read this one table - there is no per-mode
		radius derivation any more.
	*/
	levelR(level) {
		return config.BASE_DRONE_ORBIT_R + (level - config.BASE_DRONE_LEVEL_HOME) * config.BASE_DRONE_LEVEL_GAP;
	}
	/*
		Plans how `count` drones at one orbit centre are distributed across the five levels
, off BASE_DRONE_LEVEL_WEIGHTS ([1,4,6,4,1], a Binomial(4,1/2) centred on
		level 3):

		  caps    - the saturation limit per level, checked before every voluntary move into a
		            level: cap[i] = max(1, ceil(count * w[i] / sum(w))). ceil guarantees
		            sum(caps) >= count, so a level plan can never be unsatisfiable.
		  initial - where the drones start, as a flat list of `count` level numbers (ready to zip
		            against a post loop index-by-index): largest-remainder apportionment of `count`
		            over the same weights, ties broken by smaller |level - HOME| then by the lower
		            level. levelPlan(12).initial is [1,2,2,2,3,3,3,3,4,4,4,5] - four 1s/5s/2s/4s'
		            worth collapse into the same per-level counts a caller can re-derive by
		            counting occurrences.
	*/
	/*
		Largest-remainder apportionment of `count` drones over BASE_DRONE_LEVEL_WEIGHTS
		([1,4,6,4,1], a Binomial(4,1/2) centred on level 3), ties broken by smaller |level - HOME|
		then by the lower level - the same binomial shape levelPlan() below uses for a POST count,
		but callable standalone for a LIVE count. The per-centre sorter
		(tickDroneCentres()/sortDroneCentre() below) needs this for whatever the live drone count
		happens to be right now, which is not always the post count - a dead drone is off the
		ledger for BASE_DRONE_RESPAWN before its post refills.
	*/
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
	/*
		Builds a whole per-centre ledger for `count` drones (plan.md WP4.5.1, extended by
		WP4.5.0): caps (the saturation limit per level, cap[i] = max(1, ceil(count*w[i]/
		sum(w))) - ceil guarantees sum(caps) >= count, so a level plan can never be unsatisfiable),
		initial (a flat list of `count` level numbers, ready to zip against a post loop
		index-by-index - levelPlan(12).initial is [1,2,2,2,3,3,3,3,4,4,4,5]), target (the same
		largest-remainder counts levelTargets() returns - levelPlan(12).target is [1,3,4,3,1] -
		seeded here for the post count, re-derived by the sorter for the live count as it moves),
		and crossCap (how many of this centre's drones may be mid-swoosh at once,
		sized from measured demand: meanCrossTicks is BASE_DRONE_CROSS_TICKS-durations averaged
		over the five levels weighted by BASE_DRONE_LEVEL_WEIGHTS, since that is the steady-state
		distribution a cross actually launches from, so a centre with more drones or a longer
		swoosh gets more concurrent lanes rather than serialising every drone's ~10s cadence
		through one). TwoTeam.js/FourTeam.js's basePosts() use this object directly as the shared
		`levels` ledger rather than rebuilding a subset of it - see rooms/TwoTeam.js.
	*/
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
			// Polygon-boss provocation: the oId of the boss that has most
			// recently hurt one of this centre's drones, and when. Per CENTRE, not per drone, for
			// the same reason `threat` is - the whole base agrees on who it is angry at.
			provoked: 0, provokedAt: 0,
			scoutIdx: 0, scoutTimer: 0, sortTimer: 0
		};
	}
	/*
		Per-centre maintenance run once a tick from step() - the binomial
		sorter and the detection scout. Both are per-ORBIT-CENTRE, not per-drone: putting either in
		entities/Bullet.js's per-drone update() would make them N times more work (N drones sharing
		a centre) for the same answer.

		Also expires the shared threat: `levels.threat` used to be written
		(case 1.4's first block, alongside `threatAt` now) and never cleared, so acquisition quietly
		became "has ever been seen" instead of "is currently visible", and a target that died while
		being tracked (respawn() swaps in a brand-new Player, so the old one's `destroy` stays 1
		forever) permanently latched the whole centre out of ever chasing again - measured, 15s of a
		live enemy sitting inside both DETECT and LEASH with nothing reacting. Cleared here, per
		CENTRE rather than per drone (the same reason the sorter/scout live here), either the instant
		the threat is confirmed dead or after two full scout rotations with no re-sighting
		(BASE_DRONE_SCAN * posts.length * 2 ticks) - a bigger base scans any one drone less often, so
		it earns a proportionally longer memory before "not re-seen" means "gone".
	*/
	tickDroneCentres() {
		for (const centre of this.droneCentres) {
			const levels = centre.levels;
			if (levels.threat && (levels.threat.destroy ||
				this.timestamp - levels.threatAt > BASE_DRONE_SCAN * centre.posts.length * 2)) {
				levels.threat = null;
			}
			// A polygon boss that wandered off and stopped hitting anything goes back to being
			// ignored - the anger is a memory, not a permanent grudge.
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
		The binomial sorter: compare live occupancy against the live-count
		target and walk a random number of surplus drones one level each toward the NEAREST deficit,
		on the gradual arc (Bullet.sortSwitch(), cap-free). Moving one unit of surplus one step
		toward the nearest deficit strictly decreases sum(|count-target|) by 2 and no move increases
		it (transportation on a path graph), so this provably converges from any perturbed state in
		at most half that sum's worth of moves - test/rooms.js checks the convergence directly
		rather than trusting the argument. `target` is memoised per live count on the ledger
		(`levels.targets[n]`) so a steady base doesn't re-run the largest-remainder apportionment
		every second.
	*/
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
				const drone = this.INSTANCE.bullets.get(post.slot);
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
	/*
		The detection scout: rotate which single drone at this centre has its
		DETEC enabled, round-robin, skipping any drone currently chasing (its own detector state is
		managed independently - see entities/Bullet.js's case 1.4) or dead/respawning. Measured: base
		drones were 46% of a 4team tick and 93% of that was the wide quadtree query each drone's own
		Detector forced every tick regardless of whether anything was there to find - at most one
		enabled detector per centre at a time is what actually pays for that.
	*/
	rotateScout(centre) {
		const posts = centre.posts;
		if (!posts.length) { return; }
		const levels = centre.levels;
		for (let tries = 0; tries < posts.length; tries++) {
			levels.scoutIdx = (levels.scoutIdx + 1) % posts.length;
			const scout = this.INSTANCE.bullets.get(posts[levels.scoutIdx].slot);
			if (!scout || scout.destroy) { continue; }
			for (const post of posts) {
				const drone = this.INSTANCE.bullets.get(post.slot);
				if (drone && !drone.destroy && drone.DETEC && !drone.chasing) {
					drone.DETEC.enabled = (drone === scout) ? 1 : 0;
				}
			}
			return;
		}
	}
	/*
		Where this mode's base drones live, as a flat list of one post per drone:
		{team, x, y, level, phase, levels}, where x,y is the ORBIT CENTRE (not the drone's start
		point), level its starting energy level (1..BASE_DRONE_LEVELS) and phase
		its starting angle around it. `levels` is the per-centre saturation ledger
		({caps, count:[0,0,0,0,0], crossing:0}) from levelPlan() - the SAME object reference on
		every post sharing a centre, so a level switch or a cross on one drone is visible to its
		orbit-mates immediately. Optionally `crossIn`, the drone's first diameter-cross countdown,
		which a mode staggers so a base's drones do not all cross at once, and optionally `spin`
		(+-1, default 1) - which way round the centre the drone circles, read by
		entities/Bullet.js's orbit field.

		Called exactly once, from the constructor. Free-for-all has no bases, so this is the empty
		list and every base-drone code path below costs one length check per tick.
	*/
	basePosts() { return []; }
	/*
		Builds one base drone at `post` and files it in INSTANCE.bullets, returning its slot id
		(or -1 if the store had no room). Base drones are Bullets of type 1.4 with life -1 - see
		entities/Bullet.js's type-1.4 branch for the orbit/chase/cross AI, which reads the level
		and phase seeded here rather than any hardcoded radius.

		`pene` IS a bullet's health pool (collision() decrements it), so BASE_DRONE_HP goes there.
	*/
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
		// Radius is quantised into five shared energy levels - orbRTarget is
		// the live target radius the type-1.4 orbit field steers toward each tick, and it only
		// ever moves in whole BASE_DRONE_LEVEL_GAP steps via entities/Bullet.js's levelSwitch(),
		// never continuously. `levels` is the per-centre saturation ledger, shared by reference
		// with every other post at this centre; claiming this slot's level here is what
		// tickBaseDrones()'s release-on-death code below has to undo exactly once.
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
		// Post-swoosh climb back to home - set on a cross's exit, cleared when
		// the drone reaches BASE_DRONE_LEVEL_HOME. Never true at spawn.
		bull.homing = 0;
		// Detection is centralised per orbit centre: every drone owns its own
		// Detector (created here, not lazily in entities/Bullet.js's case 1.4, so
		// tickDroneCentres()'s scout rotation always has one to enable/disable), but only the
		// current scout's is enabled at a time - rotateScout() above turns this on.
		bull.DETEC = new Detector(bull, bull.x, bull.y, config.BASE_DRONE_DETECT, [KIND.PLAYER]);
		bull.DETEC.team = post.team;
		bull.DETEC.enabled = 0;
		// Latches a shape hit / proximity reaction that arrives while the drone is busy, so it is paid
		// the moment the drone is free instead of being dropped.
		bull.reactPending = 0;
		bull.spin = post.spin || 1;
		// head/spd are the steered-motion state: seeded tangential at spawn (not
		// radial, or the first second would look like a launch straight out of the centre), and at
		// cruise so the drone doesn't ramp up from a standing start.
		bull.head = post.phase + bull.spin * Math.PI / 2;
		bull.spd = tick.perTick(config.BASE_DRONE_ORBIT_SPEED);
		// Last tick's vec - the swoosh's entry acceleration seam reads this, so
		// it has to exist before the first tick ever runs. Seeded to match vec's own pre-steering
		// value (0,0) rather than assumed, so a drone that somehow crossed on its very first tick
		// would still get an honest (zero) entry acceleration rather than a guessed one.
		bull.pvec = { x: bull.vec.x, y: bull.vec.y };
		// Seeded, not zeroed: autoDir is kept only for the phase-distribution test in
		// test/rooms.js now that head is the AI's own steered angle - starting every drone at 0
		// would stack a whole base's worth on one point of the circle regardless of which field
		// reads it.
		bull.autoDir = post.phase;
		bull.crossIn = post.crossIn || tick.ticks(config.BASE_DRONE_CROSS);
		bull.alone = 1;
		bull.life = -1;
		bull.type = 1.4;
		bull.maxspeed = .75;
		bull.pene = config.BASE_DRONE_HP;
		bull.damage = config.BASE_DRONE_DAMAGE;
		bull.weight = 2;
		bull.size = config.BASE_DRONE_SIZE;
		bull.map = this.map;
		const made = this.INSTANCE.bullets.add((id) => {
			bull.id = { "GM": this.gm, "sId": this.id, "oId": id };
			return bull;
		});
		return made ? made.id.oId : -1;
	}
	/*
		Refills empty posts. A post whose drone is alive resets its own countdown, so the timer
		only ever runs while the post is actually empty - i.e. a drone that dies is replaced
		BASE_DRONE_RESPAWN ticks later, not on a free-running clock.

		A drone that dies mid-life also has to release its claim on the level ledger exactly once
 - `levelReleased` guards that, and is sound rather than lucky: SlotMap's
		KEEP_PLACE is 20 ticks, so a destroyed drone is still reachable through post.slot for 20
		ticks after destroy is set, and this runs on every one of them, so the release can never be
		missed by the slot being recycled first.
	*/
	tickBaseDrones() {
		if (!this.dronePosts.length) { return; }
		for (const post of this.dronePosts) {
			const drone = this.INSTANCE.bullets.get(post.slot);
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
			if (obj[1] < obj.max1 && Math.random() < 0.26) { this.createObj("sqr", 1); obj[1]++; }
		}
		///TRIANGLE///
		if (RNG < 0.7) {
			const obj = this.obj.tri;
			if (obj[0] < obj.max0) { this.createObj("tri", 0); obj[0]++; }
			if (obj[1] < obj.max1 && Math.random() < 0.26) { this.createObj("tri", 1); obj[1]++; }
		}
		///PENTAGONE///
		if (RNG < 0.5) {
			const obj = this.obj.pnt;
			if (obj[0] < obj.max0) { this.createObj("pnt", 0); obj[0]++; }
			if (obj[1] < obj.max1 && Math.random() < 0.2) { this.createObj("pnt", 1); obj[1]++; }
		}
		///BULL///
		if (RNG < 0.1) {
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
	}
	createObj(type, pos) {
		let ppp = -1;
		if (pos) {
			switch (type) {
				case 'sqr':
				case 'Bsqr':
					ppp = [this.map.width / 4, this.map.height / 4, 490];   // 350 x1.4, grid rescale
					break;
				case 'tri':
				case 'Btri':
					ppp = [-this.map.width / 4, -this.map.height / 4, 490]; // 350 x1.4, grid rescale
					break;
				case 'pnt':
				case 'Bpnt':
					ppp = [0, 0, 630];   // 450 x1.4, grid rescale
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
	/*
		Spawn one boss into a free player slot, if the mode has bosses and is not already at its
		limit. rules.maxBoss 0 makes this a no-op, which is what keeps the 'summonRandBoss' admin
		command harmless in ffa and 2team.

		This used to be a 30-line override in rooms/TwoTeam.js and a no-op here. There is nothing
		2-team about it - the only mode-specific parts were the team (now rules.bossTeam) and the
		hit points (rules.bossHp) - so it moved up, which is what let rooms/BossMode.js be 30
		lines instead of a third copy.
	*/
	createBoss() {
		if (this.bosses.length >= this.rules.maxBoss) { return; }
		const spec = CONFIG.BOSS[Math.floor(Math.random() * CONFIG.BOSS.length)];
		const randDir = Math.PI * 2 * Math.random();
		const boss = this.INSTANCE.players.add((id) => {
			const b = new Player(
				{ "GM": this.gm, "sId": this.id, "oId": id },
				Math.cos(randDir) * this.map.width / 4,
				Math.sin(randDir) * this.map.width / 4,
				spec[2],
				this.rules.bossTeam,
				this.XPLVL,
				this
			);
			b.hp = this.rules.bossHp;
			b.maxHp = this.rules.bossHp;
			b.boss = 1;
			b.size = 64;
			b.class = spec[2];
			b.screen = CLASS[b.class].screen;
			b.prize = 100000;
			b.xp = 100000;
			b.shield = 0;
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
	createBullet(bullet, origin) {
		this.assignBulletTeam(bullet, origin);
		bullet.map = this.map;
		this.INSTANCE.bullets.add((id) => {
			bullet.id = { 'GM': this.gm, 'sId': this.id, 'oId': id };
			return bullet;
		});
	}
	/* A bullet belongs to whoever fired it. The dev 'color' command tints it without moving
		 it to another side - bulletColor() is what reads that. */
	assignBulletTeam(bullet, origin) {
		bullet.team = origin.team;
		if (origin.dev.color) {
			bullet.color = origin.dev.color;
		}
	}
	/*
		One fixed simulation step. lib/clock.js calls this; it does not schedule itself.

		It used to end with setTimeout(update,20), which made the tick rate "20ms plus however
		long the last tick took" and let it drift arbitrarily far under load - see the note at
		the top of lib/clock.js for why that showed up as stutter on the client.
	*/
	step() {
		let stop = 1;
		let playerCount = 0;
		for (const i of this.INSTANCE.players.live()) {
			// A boss is not a bot - it has its own AI, not CONFIG.BOTS - so it has to be excluded
			// explicitly, or an empty 'boss' room (three bosses, always alive) ticks forever.
			if (!i.bot && !i.boss) {
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
		///SPAWNING/// (was a separate setTimeout(400) chain)
		if (--this.generateIn <= 0) {
			this.generateIn = GENERATE_EVERY;
			this.generate();
		}
		///BASE DRONES///
		this.tickBaseDrones();
		this.tickDroneCentres();
		///MAP///
		if (Math.abs(this.map.width - this.newMap.width) > 0.1) {
			// A pure exponential convergence toward newMap.width (no separate accel term), so this
			// is a "smoothing" constant, not a plain perTick one - .11989 is .1 one-time-rescaled
			// via smoothingOneTime(k)=1-(1-k)^(40/33), same shape as public/motion.js's lerpK.
			this.map.width += (this.newMap.width - this.map.width) * tick.smoothing(0.11989);
		} else {
			this.map.width = this.newMap.width;
		}
		if (Math.abs(this.map.height - this.newMap.height) > 0.1) {
			this.map.height += (this.newMap.height - this.map.height) * tick.smoothing(0.11989);
		} else {
			this.map.height = this.newMap.height;
		}
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
				if (kind === 'players' && !i.destroy && !i.boss) {
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
					if (kind === 'bullets') { this.INSTANCE[kind].delete(i.id.oId, true); continue; }
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
				// A player dies exactly on the base line; a bullet is allowed to penetrate
				// config.BASE_BULLET_MARGIN past it first, which is what real diep does and what
				// stops enemy fire visibly evaporating on an invisible wall.
				// The base only kills inside the drawn arena - inEnemyBase()
				// alone is unbounded outward, so something sitting in the dark OOB band past a
				// corner would otherwise still count as "in" the base; inArena() is the one place
				// that bound is written.
				if ((kind === 'players' || kind === 'bullets') && this.inArena(obj) &&
					this.inEnemyBase(obj, kind === 'bullets' ? config.BASE_BULLET_MARGIN : 0)) {
					obj.collision(0, { base: 1 });
					continue;
				}
				// Allocation-free circle query - was qt.query(closure, {x,y,r}),
				// which allocated a {x,y,w,h} object per node visited and a {x,y,w:0,h:0} object per
				// point tested, and called a closure defined fresh inside this very loop on every
				// visit. queryCircle() is the same AABB/circle test written inline against
				// primitives, filtering points by squared distance (no Math.sqrt) straight into the
				// caller-owned COLLIDE_SCRATCH array, so this whole pass allocates nothing.
				COLLIDE_SCRATCH.length = 0;
				qt.queryCircle(obj.x, obj.y, (obj.DETEC && obj.DETEC.enabled ? obj.DETEC.size : obj.size) * 2, COLLIDE_SCRATCH);
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
					// Math.sqrt(a*a + b*b), not Math.pow(a,2) - Math.pow is the
					// slower path in V8 for an integer exponent, and this runs once per candidate
					// pair on the hottest loop in the room. Math.hypot is in turn slower than this,
					// measured - not "improved" to it; see other copies of this expression elsewhere
					// in the tree, none of which are on a hot path, so none of them are touched.
					const ddx = other.x - obj.x, ddy = other.y - obj.y;
					const dis = Math.sqrt(ddx * ddx + ddy * ddy);
					// Base drones make an effort not to overlap: flagged here, acted on next tick
					// by entities/Bullet.js's type-1.4 branch, which takes the same 60-degree level switch a shape
					// hit does. This is deliberately NOT a collision - the same-team skip below still runs, so the
					// pair exchanges no damage, no knockback and no jitter. Exactly ONE side of the pair yields, not
					// both: now that a reactive switch cannot fail (WP4.5.0), flagging both would move both -
					// possibly onto the same level, still overlapping. Which one yields is arbitrary (lower slot
					// id); that it is exactly one is not.
					if (isBaseDrone(obj) && isBaseDrone(other) && dis < config.BASE_DRONE_SEPARATION) {
						if (obj.id.oId < other.id.oId) { obj.tooClose = 1; } else { other.tooClose = 1; }
					}
					// A base drone is transparent to its own side: the pair is skipped whole,
					// so there is no damage, no knockback, no separation jitter and no detector hit - rather than
					// relying on three separate noDam early-breaks in entities/ to each stay in the right place.
					// Polygons are deliberately not covered: a drone collides with shapes regardless of team.
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
					if (dis <= obj.size + other.size) {
						if (obj.size > other.size || obj.x + obj.y >= other.x + other.y) {
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
							if (objKind === KIND.BULLET) {
								otherOption.pene = obj.pene;
							}
							if (otherKind === KIND.BULLET) {
								objOption.pene = other.pene;
							}
							other.collision(obj, otherOption);
							obj.collision(other, objOption);
							if (objKind === KIND.BULLET) {
								if (other.destroy && other.prize) {
									const killer = this.INSTANCE.players.get(obj.origin.oId);
									if (killer) {
										killer.xp += other.prize;
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
										killer.xp += obj.prize;
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
		for (const [id, player] of this.INSTANCE.players.entries()) {
			if (player.bot || player.boss) {
				continue;
			}

			const x = player.x - player.screen / 2 - 200, y = player.y - player.screen / 2 * 0.5625 - 200;
			const w = player.screen + 400, h = player.screen * 0.5625 + 400;

			this.BUFFER[id] = {
				x: x,
				y: y,
				w: w,
				h: h
			}
			this.BUFFER[id].main = player;
			this.BUFFER[id].rest = qt.query(function (a, b) {
				return (
					((a.x + a.w) >= b.x) &&
					(a.x <= (b.x + b.w)) &&
					((a.y + a.h) >= b.y) &&
					(a.y <= (b.y + b.h))
				);
			},
				{ 'x': x - 200, 'y': y - 200, 'w': w + 400, 'h': h + 400 });
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
						obj.x += (murder.x - obj.x) * tick.smoothing(0.11989);   // smoothing-category, see the map-lerp comment above
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
	/*
		Team modes fence each side out of the other's base. Anything in there dies.

		`margin` shrinks the fenced region inward from the base line, so a caller can let
		something cross the line before it counts as inside - see the bullet case in step().
		Only the line itself moves, never the map-edge side of the base: a base drone orbiting
		near its own base's inner edge must still never be "in" a base it owns.

		Both team modes' own inEnemyBase() are deliberately unbounded OUTWARD (4team measures
		depth inward from the map edge, so a point past a corner has negative depth and still
		counts as inside; 2team is a bare half-plane in x with no y bound at all) - step() is what
		bounds that to the drawn arena now, via inArena() below, so the
		signature/semantics here don't change.
	*/
	inEnemyBase(obj, margin = 0) {
		return false;
	}
	/*
		The drawn arena - what the coloured base square is clipped to. The OOB
		band outside it (config.OOB_MARGIN, ~5 squares once a tank's own radius is counted - see
		entities/Player.js's motion()) is neutral ground for everything: "in an enemy base" means
		"in an enemy base AND inside the drawn arena" now, so a fast tank (or a base drone chasing
		one - entities/Bullet.js's clampToMap() carries the same OOB_MARGIN allowance) can
		circumnavigate a base by going around the dark grey border without dying to it.
	*/
	inArena(obj) {
		return Math.abs(obj.x) <= this.map.width / 2 && Math.abs(obj.y) <= this.map.height / 2;
	}
	respawn(id, force = 0, bot = 0) {
		const tank = this.INSTANCE.players.get(id);
		if (!tank || (!force && !tank.destroy) || tank.dead > 1) return;
		///
		const pos = this.spawnPoint(tank);
		const newTank = new Player(tank.id, pos.x, pos.y, tank.name, tank.team, this.XPLVL, this);
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
		// A respawn swaps in a brand new Player, so anything the constructor defaults to zero or
		// empty has to be carried across by hand:
		//   - inputs: the client only sends 'keydown' on an actual state change, so a key held
		//     through the moment of death would never be re-announced. It also gates `shield`
		//     (spawn protection), which only clears once motion()/shoot() see real input.
		//   - userKey/unlocked/killCounts: Controller.disconnect()'s achievement write-back is
		//     gated on userKey plus a non-empty `unlocked`, and kill-count achievements count
		//     across a whole session, not one life.
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
	/*
		How much xp survives a death: a fractional power of what you had, floored at nothing and
		capped at 60% of the level-30 requirement. The Math.min matters - below roughly a
		thousand xp the curve returns *more* than it was given, so without it dying early is a
		reward.
	*/
	respawnXp(xp) {
		const mXp = this.XPLVL[this.XPLVL.length - 1];
		const pow = this.rules.respawnPow;
		if (xp > mXp) {
			return mXp * .6;
		}
		return Math.min(xp, parseInt(Math.pow(xp / (mXp / Math.pow(mXp * .6, 1 / pow)), pow)));
	}
	/*
		Rejection sampling with a hard iteration cap, shared with entities/Objects.js's polygon
		placement (this.room.rejectSample). The cap is the whole point: neither caller may loop
		until it succeeds.

		The carve-out radii callers pass in are absolute, not a fraction of the map: a nest is a
		fixed-size cluster (see createObj()'s ppp radii), so scaling them with mapSize would carve
		a huge hole out of a big map. That is what makes the loop unsatisfiable on a small enough
		one - below roughly 2744 units wide, no point on the map is 1540 from the origin at all -
		and this ran on the simulation thread, so an unsatisfiable loop took the whole room down.

		`circles` is [[x, y, r], ...]. Returns the first point outside all of them, or - if the
		cap runs out - the best candidate seen, scored by normalised distance to its own tightest
		circle. Normalised, so "just outside a 1120 nest" doesn't beat "just outside a 1540 one".
	*/
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
	/* The three polygon nests, as [x, y, radius] keep-out circles. */
	spawnKeepOut() {
				return [
			[0, 0, 1540],
			[this.map.width / 4, this.map.height / 4, 1120],
			[-this.map.width / 4, -this.map.height / 4, 1120]
		];
	}
	/* Free-for-all drops you anywhere clear of the three polygon nests. */
	spawnPoint(tank) {
		return this.rejectSample(280, this.spawnKeepOut());
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
			still: RAW.main.dead ? 0 : RAW.main.level - RAW.main.stillLvl,
			cLvl: RAW.main.dead ? 0 : parseInt((RAW.main.level) / 10),
			// 0 in ffa/boss/sandbox, which have no bases - the client reads that as "draw none"
			// rather than needing to know which gamemodes have them.
			baseSize: this.baseSize || 0
		};
		///
		const lvl = RAW.main.level, xp = RAW.main.xp, arr = RAW.main.XPLVL;
		buff.head.level = (!lvl ? 1 : ((lvl >= arr.length - 1) ? lvl : lvl + Math.max(Math.min(1, (xp - arr[lvl - 1]) / (arr[lvl] - arr[lvl - 1])), 0)));
		///
		buff.main = {
			states: [!!RAW.main.hit * 1,
			!!RAW.main.inputs.c * 1,
			!!RAW.main.dead * 1,
			!!RAW.main.shield * 1, 0, 0],
			class: RAW.main.class,
			color: RAW.main.dev.color ? RAW.main.dev.color - 1 : this.mainColor(RAW.main),
			x: RAW.main.x,
			y: RAW.main.y,
			vx: RAW.main.vec.x,
			vy: RAW.main.vec.y,
			// While the `c` spin is on, send its own phase rather than this.dir: a mousemove can
			// land between the tick that spun the tank and this encode, and the client draws this
			// field verbatim (User.realDir/followDir) - so reading it here would splice one frame
			// of mouse aim into the spin.
			dir: RAW.main.inputs.c ? RAW.main.spinDir : RAW.main.dir,
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
			if (
				((obj.x) <= RAW.x) ||
				((obj.y) <= RAW.y) ||
				((obj.x) >= (RAW.x + RAW.w)) ||
				((obj.y) >= (RAW.y + RAW.h))
			) { continue; }
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
							states: [!!obj.pet * 1, 0, 0, 0, 0, 0, 0],
							type: parseInt(obj.type),
							x: obj.x,
							y: obj.y,
							size: obj.size,
							color: this.bulletColor(obj),
							alpha: obj.alpha,
							dir: obj.showDir
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
							states: [!!obj.pet * 1, 1, 0, 0, 0, 0, 0],
							type: parseInt(obj.type),
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
	/* Colour of another tank, as everyone sees it. Cached, so it cannot depend on the viewer.
		 Bosses keep their own team colour in every mode - they are on nobody's side, and a boss
		 that renders as just another red tank is not readable. */
	entityColor(player) {
		return player.boss ? player.team : 1;
	}
	/* Colour of your own tank on your own screen. */
	mainColor(player) {
		return 0;
	}
	bulletColor(bullet) {
		return (bullet.type === 3) ? 9 : bullet.team;
	}
	ownBulletColor(bullet, main) {
		return (bullet.type === 3) ? 9 : main.dev.color ? main.dev.color - 1 : 0;
	}
	leaderColor(player, viewerId) {
		return (player.id.oId === viewerId) ? 0 : player.team;
	}
	getUi(id) {
		const buff = {
			leader: [],
			map: [],
			mess: []
		};
		for (const i of this.leader) {
			buff.leader.push({
				xp: i.xp,
				name: i.name,
				nameC: 0,
				team: i.dev.color ? i.dev.color - 1 : this.leaderColor(i, id)
			})
		};
		// Every live player as a minimap dot - same exclusion (dead/destroyed, bosses) and the
		// same viewer-relative colouring (you're always "your" colour, everyone else by team)
		// that this.leader already uses, just not limited to the top 10. x/y go out as 0..1
		// fractions of the current map size (TYPE.UiUpdate.map, CODECS.unit), so they still land
		// in the right place after this.map.width/height finish lerping toward a resize.
		for (const i of this.INSTANCE.players.live()) {
			if (i.destroy || i.boss) { continue; }
			buff.map.push({
				x: (i.x + this.map.width / 2) / this.map.width,
				y: (i.y + this.map.height / 2) / this.map.height,
				team: i.dev.color ? i.dev.color - 1 : this.leaderColor(i, id),
				size: Math.min(255, Math.round(i.size))
			});
		}
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

module.exports = Room;
