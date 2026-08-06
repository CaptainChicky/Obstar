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
	ARENA SIZE AND SHAPE DENSITY - PENDING #19, plan.md step 6.

	diep has two published formulas and they are a MATCHED PAIR, which is the fact the whole design
	below turns on: arena length AL = floor(sqrt(N_P) * 50) gu (physics.html) and shape count
	12.5 * N_P (diep_wiki/Polygons.txt). Compose them and the player count cancels -
	area = (sqrt(N)*50)^2 = 2500*N gu^2 against 12.5*N shapes, i.e. exactly

	    ONE SHAPE PER 200 gu^2, at every player count.

	So diep's real invariant is a DENSITY, and "12.5 per player" is what that density happens to
	look like when the arena is also being sized by N. That matters because adopting one formula
	without the other is actively wrong: 12.5*N shapes spread over OUR (bigger, fixed) arenas would
	be far emptier than today, the opposite of what #19 is complaining about. The density is the
	part that transfers.

	Which half a mode gets is the split diep_wiki itself draws, and it is per-mode rather than
	global:
	  - ARENA SIZE is stated as population-varying for SANDBOX only ("The arena's size along with
	    the number of shapes that spawn in it varies depending on the number of players connected
	    to it", diep_wiki/Game Modes.txt) and for TAG as a timed shrink (diep_wiki/Map.txt). FFA,
	    2 Teams and 4 Teams describe nothing of the kind, so they keep the arena each already has -
	    see the deliberate-departure note below.
	  - SHAPE DENSITY is the general rule ("The number of Polygons available in an arena is directly
	    related to how many players are currently connected to it") and applies to every mode, off
	    whatever area that mode's arena currently has.
	A mode opts into the first by setting `arenaLive`; every mode gets the second for free.

	DELIBERATE DEPARTURE, so it is not "fixed" later by mistake: #19 notes our ffa arena is 451 gu
	against diep's 244 gu at maxPlayer 24, and that resizing toward diep "is still open". It stays
	open. Shrinking ffa to AL(24) would cut its area to 29% - a balance change of a completely
	different magnitude to this step, affecting every distance the mode was tuned around, and
	nothing asked for it. What this step fixes is the density complaint (#19's actual subject: ours
	was 1 per 261 gu^2 against diep's 1 per 200), which is fixed at OUR arena sizes.
*/
const SHAPE_DENSITY_GU2 = 200;
function shapeTotal(widthGu, heightGu) { return Math.floor(widthGu * heightGu / SHAPE_DENSITY_GU2); }
/*
	diep's Crasher Zone (ShapeManager.ts:56-71, plan.md C12) is not a separately-tuned population -
	`spawnShape()` draws ONE shared pool uniformly by area over the whole arena and classifies
	whatever lands in this annulus as a Crasher, so its count is just that annulus's share of the
	very same SHAPE_DENSITY_GU2 every other shape draws from, not an independent knob. Radii mirror
	entities/Objects.js's own crasher-zone constants (630/1249 x nestScale, contiguous with the
	Pentagon Nest circle) - kept in sync by comment cross-reference, the same convention Room.js's
	own Pentagon-nest radius (630, in createObj() below) already uses to stay aligned with
	Objects.js's carve-out of that same circle.
*/
const CRASHER_ZONE_R_IN = 630, CRASHER_ZONE_R_OUT = 1249;
function crasherTotal(nestScale) {
	const areaWorld2 = Math.PI * (Math.pow(CRASHER_ZONE_R_OUT * nestScale, 2) - Math.pow(CRASHER_ZONE_R_IN * nestScale, 2));
	return Math.max(0, Math.floor(areaWorld2 / (World.GU * World.GU) / SHAPE_DENSITY_GU2));
}
/*
	AL() for the modes that do scale with population. The floor is a PLAYABILITY minimum, not a
	satisfiability one: 150 gu is Sandbox's own long-standing tuned size, and also the smallest
	arena this tree has ever shipped, so an empty live-scaled room lands exactly where Sandbox
	already sat rather than somewhere new. Satisfiability is handled structurally instead - see
	nestScale below.
*/
const MIN_ARENA_GU = 150;
function arenaGu(n) { return Math.max(MIN_ARENA_GU, Math.floor(Math.sqrt(Math.max(1, n)) * 50)); }
/*
	Every nest radius in the tree - spawnKeepOut()'s three keep-out circles, entities/Objects.js's
	three (slightly tighter) shape carve-outs, and createObj()'s three cluster radii - was tuned
	against ffa's map and hardcoded absolute. They are all read through this one scale factor now,
	so they stay a fixed PROPORTION of whatever arena they are in.

	This is what actually retires rejectSample()'s "unsatisfiable below ~2744 units wide" warning,
	and it retires it structurally rather than by clamping: if the carve-outs scale with the map,
	the whole placement picture is similar at every size, so a configuration satisfiable at one
	arena size is satisfiable at ALL of them. There is no longer a width at which no point on the
	map is outside the nests. ffa is the reference, so its own scale is exactly 1 and its placement
	behaviour is unchanged by construction.
*/
const NEST_REF_GU = 451;
/*
	Splits `total` shapes across sqr/tri/pnt - each further into max0 (scattered anywhere clear of
	every nest) and max1 (clustered at one of the three nest points; see createObj()) - preserving
	the mode's own proportions. `mix` is six raw weights keyed sqr0/sqr1/tri0/tri1/pnt0/pnt1, stated
	by each mode as literally its pre-#19 objCaps numbers, and normalised here - so a mode states
	the mix it was tuned with and this file decides only the total. Largest-remainder apportionment,
	the same method levelTargets() below already uses for base drone levels, so the parts sum to
	exactly `total` instead of drifting under six independent roundings.
*/
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

/*
	diep refills a dead shape slot the very next tick, holding a flat population target
	(ShapeManager.ts:112-118, plan.md S7) - effectively instant. generate()'s own per-type gates
	below (RNG < 0.7/0.5/0.1 deciding whether a type is even checked this pass, plus a second
	0.26/0.2 roll on top of THAT for a nest-cluster slot specifically) make ours trickle back in
	over several passes instead. Decision: close 85% of the gap to diep's instant refill rather
	than going all the way - PENDING logs why. `towardInstant(p) = p + 0.85 x (1-p)` scales every
	gate below toward 1 by that fraction; the untouched gates (betaPentRng, the Bsqr/Btri 0.992
	checks, bossRng) are rarity/special-spawn knobs, not the ordinary-shape cadence this is about.
*/
const RESPAWN_CATCHUP = 0.85;
const towardInstant = (p) => p + RESPAWN_CATCHUP * (1 - p);

// plan.md R7: the wire's Bullets.type is a uint8, so Factory's Minion (cannon
// `type: 1.5`, TanksConfig.js) can't survive parseInt(obj.type) as anything but
// 1 (an ordinary drone triangle). Give it its own integer draw-id here, at the
// encode site, rather than widening the codec for one fractional value.
const MINION_WIRE_TYPE = 5;
function bulletWireType(bullet) {
	// A per-cannon draw-shape override (entities/Player.js's shoot(), diep's own per-barrel
	// bullet shape) wins outright: a Guardian's `type: 3.1` drone sets drawType 6 so it draws as
	// a small Crasher (Drawings.bullet[6]) rather than the square parseInt(3.1) would give - a
	// Summoner's own 3.1 drone has no override and stays a square (3), the sprite a Necromancer
	// drone uses. Everything else is the ordinary type->shape map: 1.5 (Minion) can't survive
	// parseInt (it collides with type 1), so it takes its own reserved wire id.
	if (bullet.drawType !== undefined) { return bullet.drawType; }
	return bullet.type === 1.5 ? MINION_WIRE_TYPE : parseInt(bullet.type);
}

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

// diep's own 45-minute global boss timer (Misc/BossManager.ts: `45 * 60 * tps` of ITS ticks,
// plan.md X1) - a deterministic floor under the ///BOSSES/// RNG roll in generate() below: any
// mode that allows bosses at all (rules.maxBoss > 0) is guaranteed one within 45 real minutes of
// the last one dying, rather than left to the RNG's own (much longer, ~95 min mean at
// bossRng 0.9999) expected wait. 45 min = 2700s / 0.04s (diep's own 40ms tick) = 67500 of ITS
// ticks; tick.ticks() converts that reference-tick count the same way every other timer in this
// file does. BossMode's own much faster bossRng (~10%/generate() pass) almost always wins the
// race well before this ever fires, so its multi-boss cadence is unaffected.
const BOSS_TIMER_TICKS = tick.ticks(67500);

// A base drone is one of its own side's bullets, for the team-transparency skip below - type 1.4
// with life -1 is otherwise indistinguishable from any other homing bullet.
const isBaseDrone = (e) => e.kind === KIND.BULLET && e.type === 1.4;

/*
	Diep resolves a colliding pair's damage mutually and simultaneously (Live.ts:67-84, PENDING #18,
	plan.md step 5 part 4) - both sides can only ever spend the SAME shared tick, so if either would
	die mid-tick, BOTH sides' damage this tick prorates down together, rather than (as calling
	collision() on each side independently and unconditionally would do) letting the survivor land
	its own full, un-shortened hit past the moment its target actually died. That needs both raw
	per-tick amounts AND both current healths before either side mutates anything, so it has to run
	here, once, ahead of both collision() calls below - by the time the first of those two calls ran
	under the pre-step-5 code, it had already spent the pair's shared health budget for the second.

	damageOutput() mirrors, read-only, the same per-tick magnitude (pre proration, pre tick.perTick())
	each collision() arm below is about to subtract - entities/Player.js's KIND.PLAYER/OBJECTS/BULLET
	arms, entities/Bullet.js's KIND.PLAYER/OBJECTS arms, entities/Objects.js's KIND.PLAYER/BULLET arms
	- using the same lib/damage.js constants those arms do, so the two can never drift on the numbers.
	Bullet-vs-bullet is deliberately not one of the pairings here: that resolves through
	entities/Bullet.js's own separate pene-vs-pene KIND.BULLET arm, not this table, so it returns 0
	(inert) rather than being taught the wrong formula.
*/
function damageOutput(e, eKind, otherKind) {
	switch (eKind) {
		case KIND.PLAYER:
			if (otherKind === KIND.PLAYER) return e.damage * TANK_TANK_MULT;
			if (otherKind === KIND.OBJECTS) return e.damage * TANK_SHAPE_MULT;
			if (otherKind === KIND.BULLET) return e.damage;
			return 0;
		case KIND.OBJECTS:
			// A shape's own `damage` is diep's raw damagePerTick now, no vs-tank x4 baked in
			// (plan.md chunk 1 D2) - so a shape hitting a tank needs TANK_SHAPE_MULT spelled out
			// here same as the KIND.PLAYER case above, and a shape hitting a bullet needs no
			// multiplier at all (common(shape,bullet) = 1, the retired PROJECTILE_BODY_DAMAGE's
			// old 0.25 was the same number applied to the old x4-baked field).
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
// Whether `e`'s own collision() is guaranteed to skip its hp -= line entirely regardless of what
// hits it - mirrors entities/Player.js's dev.ghost/closer/dev.god early-returns and its shield
// check, since Room.js has to know BEFORE calling collision() whether either side's damage this
// tick will really land. Only ever true for a KIND.PLAYER entity: nothing else in this tree
// carries `.dev`/`.shield`, and a BULLET's own `.closer` flag (a Closer's own bullet) guards wall
// passthrough only (entities/Bullet.js's KIND.WALL arm), not this.
function damageGuarded(e, eKind) {
	return eKind === KIND.PLAYER && (e.dev.ghost || e.dev.god || e.closer || e.shield);
}

/*
	diep's own same-team collision filter (diepcustom Entity/Object.ts:154-171), which this tree
	previously only had half of: a same-team pair was given `noDam` (no damage exchanged) but still
	collided PHYSICALLY, so a teammate's traps and drones shoved tanks around, a tank could not
	stand in its own trap field, and a Mothership was permanently jostled by its own drone swarm.

	diep expresses it as two physics flags, and each projectile class picks one:

	  * noOwnTeamCollision (Bullet.ts:75 - ordinary bullets, and Swarm.ts:32) - passes through
	    EVERYTHING on its own team, whoever fired it.
	  * onlySameOwnerCollision (Drone.ts:57, Minion.ts:87, NecromancerSquare.ts:46, Trap.ts:44) -
	    on its own team it collides only with entities that share its OWNER, and passes through
	    the rest. Since a tank never sets an owner at all (RelationsGroup defaults it to null,
	    and only a projectile ever assigns one - `relationsData.values.owner = tank`), a drone
	    NEVER shares an owner with any tank, including the one that fired it. That single fact is
	    what makes drones pass through their own tank while still jostling their sibling drones.
	  * a trap holds onlySameOwnerCollision for its arming window and then SWAPS to
	    noOwnTeamCollision (Trap.ts:59-62) - so a fresh trap is shoved around by its own siblings
	    while the cluster spreads, and once settled it stops interacting with the team entirely.

	TEAM IDENTITY AND OWNER IDENTITY ARE TWO DIFFERENT QUESTIONS and conflating them is the one
	way to get this wrong, so they are two functions:

	  * teamRoot() answers "same team". Deliberately not gated on rules.teamPlay: diep has no
	    team-less mode - a free-for-all player is their own one-man team - so this is `team` where
	    the mode has teams and the tank's own lineage where it does not, and the flags then read
	    identically in both. That is what lets a Sandbox/ffa player sit inside their own trap field
	    the way a 2team player can.
	  * ownerOf() answers diep's `relationsData.owner`, which is NULL for a tank and the firing
	    tank for a projectile. Feeding a tank its own id here instead would make a drone share an
	    owner with the tank that fired it - the exact opposite of the rule - and the drone would
	    bounce off its owner while passing through every other team mate.
*/
// bullet, BattleShip/Fortress swarm drone (uncontrollable + controllable), skimmer - all
// `noOwnTeamCollision` in diepcustom (Bullet.ts:75 default; Swarm.ts:32 re-asserts it on top of
// Drone.ts, which otherwise clears it - see the SAME_OWNER_TYPES note on type 3 below for the bug
// that shipped from conflating the two).
const NO_OWN_TEAM_TYPES = new Set([0, 1.2, 1.3, 4]);
// drone, Mothership AI-only drone, minion, Necromancer square-drone, trap (trap: while arming) -
// all `onlySameOwnerCollision` (Drone.ts:57, NecromancerSquare.ts:46, Minion.ts:87, Trap.ts:44).
// Type 3 (the Necromancer's own drone) used to sit in NO_OWN_TEAM_TYPES under a stale "swarm"
// label - BattleShip's actual swarm barrels are types 1.2/1.3, never 3, so that entry was
// protecting the wrong drone from its own team while leaving BattleShip's real swarm (and
// Mothership's type-1.1 half) uncovered - the exact bug issues.md reported ("battleship drones
// should not have knockback and interact with anything on its own team", "mothership should be
// able to overlap with its own drones").
const SAME_OWNER_TYPES = new Set([1, 1.1, 1.5, 2, 3]);
function teamRoot(e, kind) {
	return kind === KIND.BULLET ? e.origin.oId : (kind === KIND.PLAYER ? e.id.oId : null);
}
function ownerOf(e, kind) {
	return kind === KIND.BULLET ? e.origin.oId : null;
}
// Which of the two flags this side carries, or 0 for none (a tank, a shape, a wall, a base drone -
// base drones run the separate whole-pair skip in the collision loop, which is strictly stronger).
function teamCollisionFlag(e, kind) {
	if (kind !== KIND.BULLET) { return 0; }
	if (e.type === 2) { return e.armTicks > 0 ? 2 : 1; }
	if (NO_OWN_TEAM_TYPES.has(e.type)) { return 1; }
	if (SAME_OWNER_TYPES.has(e.type)) { return 2; }
	return 0;
}
// True when diep would not resolve this pair at all - no damage, no knockback, no separation.
function teamPassThrough(room, a, aKind, b, bKind) {
	// Shapes and walls are the arena's, never anybody's team mate.
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
	// The xp at the level cap (45 levels, PENDING #30); drives the whole XPLVL curve. Deliberately
	// NOT rescaled when the cap moved 30 -> 45: the same total xp now buys 45 finer levels instead
	// of 30 coarse ones, so each mode's farming economy is untouched by the conversion. Re-pricing
	// xp itself belongs with #19's shape density, not here.
	maxXp: 25000,
	// The arena, as a square count (PENDING #19, plan.md step 6). A mode states the size it is
	// tuned for; an `arenaLive` mode has this overwritten every tick from AL(live human count) and
	// only uses it as its pre-first-tick starting value.
	mapSize: { width: 9020, height: 9020 },
	// Opt in to diep's population-varying arena - Sandbox and (step 7) Tag. Off means the arena is
	// whatever `mapSize` says, forever; SHAPE DENSITY still applies either way. See the header.
	arenaLive: false,
	// A team mode's baseSize as {num, den} of the map's width in squares, so it stays the same
	// PROPORTION of the arena as that arena resizes. Written as a fraction rather than a pre-divided
	// float on purpose: (width * num / den) reproduces 4team's gu(67) exactly where
	// (width * (num/den)) lands on 1875.9999999999998 instead of 1876. 0/1 - ffa/boss/sandbox have
	// no base, which is also what makes `baseSize` 0 for them, as before.
	baseSizeRatio: { num: 0, den: 1 },
	// Six raw weights - literally this mode's pre-#19 objCaps - normalised by apportionShapes()
	// above. The mode states the MIX it was tuned with; the header's density formula states the
	// TOTAL. Null here is deliberate: DEFAULT_RULES is never used unmerged, and a mode that forgets
	// its mix should fail loudly rather than silently inherit ffa's.
	shapeMix: null,
	maxPlayer: 24,
	preGenerate: 500,    // generate() passes run before the room opens
	bootDelay: 100,    // ms between construction and the first tick
	betaPentRng: 0.98,   // RNG above this may spawn a beta pentagon
	bossRng: 2,      // ... and above this calls createBoss(). 2 = never.
	maxBoss: 0,      // how many bosses may be alive at once. 0 = the mode has none.
	// diepcustom AbstractBoss.ts:141 `health = maxHealth = 3000` (plan.md Part D's shared boss
	// scaffolding) - flat, not level-derived (unlike a Dominator's 6148, which does scale off a
	// hypothetical level 75). Was 20000/30000 (rooms/BossMode.js's own override), an unreconciled
	// legacy balance figure from before this fidelity pass had a real number to check it against.
	bossHp: 3000,
	bossTeam: 9,      // bosses are on nobody's side; 9 is the 'necro' colour
	/*
		THE ARENA'S OWN TEAM - what diep calls `game.arena`, and what an Arena Closer and an
		UNCAPTURED Dominator are both on (ArenaCloser.ts:47 and Dominator.ts:69 set the identical
		`relationsData.values.team = arena`, and both take `Color.Neutral`). Sharing one team is
		the whole mechanism behind "a Closer ignores a neutral Dominator but hunts a captured one":
		capture rewrites the Dominator's team to the capturing side (lib/gameAI.js's
		dominatorUpdate()), which is the moment it stops being a team mate and becomes a target.
		Distinct from bossTeam above, which stays 9 - a boss is not on the arena's team in diep
		either, and a Closer skips bosses by its own `.boss` check rather than by team.
	*/
	neutralTeam: 2,   // == lib/gameAI.js's DOMINATOR_NEUTRAL_TEAM
	botCount: 10,
	botIdStart: 10,     // bots occupy a fixed slot range so respawn can find them
	teams: [1],    // the team ids this mode assigns. One entry = free-for-all.
	teamPlay: false,  // friendly fire off, and detectors ignore team mates
	respawnPow: 0.9,    // exponent of the xp you keep through a death
	// Per-mode xp multiplier, applied once in awardXp(). diep_wiki/Polygons.txt: Tag x3,
	// Breakout x3, Domination x2, everything else x1.
	xpMul: 1,
	// Multiplier on the Crasher Zone population tickArena() derives (crasherTotal()). 1 everywhere
	// but Maze, which turns it down - the same crasher count reads as far more pressure in a maze
	// of dead ends than in open ffa-shaped arenas.
	crasherDensity: 1,
	viewerBullets: true,  // re-encode your own bullets per viewer so they read as yours
	// The alpha a stealth class's decay-toward-invisible (entities/Player.js's update()) stops at.
	// 0 everywhere except Tag (PENDING #28): diep_wiki/Tag.txt - "Players can't become fully
	// invisible... to prevent tanks like Landmine and Stalker from hiding in the corner of the map
	// and preventing the game from ending." No number is given, only that zero is disallowed.
	invisFloor: 0
};

class Room {
	constructor(id, rules, controller) {
		this.rules = Object.assign({}, DEFAULT_RULES, rules);
		// rules.neutralTeam's default (2) is DOMINATOR_NEUTRAL_TEAM, which is the right answer for
		// every mode that HAS Dominators - but 4team and Tag both hand team 2 to real players, and
		// an Arena Closer sharing a side with a quarter of the lobby would be worse than the beige
		// it replaced. Neither of those modes has a Dominator for it to agree with, so falling back
		// to the boss team (9, which no mode claims) keeps the one invariant that matters: the
		// arena's own team is nobody's. Derived rather than restated per mode so a new mode that
		// adds a team 2 cannot silently re-open this.
		if (this.rules.teams.indexOf(this.rules.neutralTeam) >= 0) {
			this.rules.neutralTeam = this.rules.bossTeam;
		}
		this.controller = controller;
		const MXLVL = this.rules.maxXp;
		// diep's own XP curve (Const/Enums.ts:301-304, plan.md P1), not a power curve normalised to
		// land on maxXp: levelToScore[i] = levelToScore[i-1] + 40/9 x 1.06^(i-1) x min(31,i), summed
		// as a running float and rounded once per level (rounding each step's increment first drifts
		// off diep's own published table by a few xp past level ~10). diep's own ceiling at level 45
		// is 23537 - every mode scales the whole curve by its own maxXp/23537 so a different per-mode
		// ceiling keeps diep's SHAPE (early levels cheap, late levels steep) instead of overwriting it
		// with a differently-shaped curve of our own that merely agrees at the endpoints.
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
		// An `arenaLive` mode starts at AL(0) - the MIN_ARENA_GU floor - rather than at its stated
		// mapSize, because it has no players yet at construction and step() will size it from the
		// real count on the first tick regardless. Everything else opens at the size it states.
		if (this.rules.arenaLive) {
			const al = World.gu(arenaGu(0));
			this.map = { width: al, height: al };
		} else {
			this.map = { width: this.rules.mapSize.width, height: this.rules.mapSize.height };
		}
		// newMap is what the map lerps towards each tick - the admin 'mapResize' command writes it,
		// and so does tickArena() for an `arenaLive` mode. Starting them equal makes the lerp a
		// no-op until one of those two asks for something different.
		this.newMap = { width: this.map.width, height: this.map.height };
		// sqr/tri/pnt's caps are derived (tickArena() below, called once here so the room is fully
		// sized before build()/Init() run), and so now is bull's (plan.md C12 - a Crasher is a real
		// diep shape with a real density formula, not a stand-in). Bpnt/Bsqr/Btri are still
		// deliberately NOT: giant nest constructs have no diep counterpart and #19's density
		// formula says nothing about them, so their caps stay the literals they have always been.
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
		// Every boss currently alive. A list rather than a single slot because 'boss' mode runs
		// several at once; modes with rules.maxBoss 0 never put anything in it.
		this.bosses = [];
		// Every Dominator currently alive (PENDING #27) - empty everywhere but Domination and
		// whatever spawns one via the Sandbox admin command. A Dominator never dies (its own
		// update(), lib/gameAI.js, intercepts `destroy` and turns it into a capture instead), so
		// unlike this.bosses nothing ever needs to be removed from this list.
		this.dominators = [];
		// diep's own arena state machine (Native/Arena.ts's ArenaState, plan.md A4) -
		// COUNTDOWN/OPEN/CLOSING/CLOSED/OVER, diep's own numbering (module.exports.ArenaState
		// below) so the wire value means the same thing a real diep client would read. Every
		// EXISTING mode opens straight into OPEN, unaffected - Tag/Maze's own hand-rolled
		// "closing" (this.closing, an Arena Closer swarm) is untouched machinery, just now also
		// mirrored into this field for the wire rather than replaced by it (see Tag.js's
		// startClosing()). Only Survival (rooms/Survival.js) actually GATES anything on
		// COUNTDOWN - every other mode's `ticksUntilStart`/`playersNeeded` stay at their
		// do-nothing defaults (0), which is what makes this purely additive.
		this.state = Room.ArenaState.OPEN;
		this.ticksUntilStart = 0;
		this.playersNeeded = 0;
		// Every Mothership currently alive (plan.md G1's Mothership mode) - parallel to
		// this.bosses/this.dominators above, same reasoning.
		this.motherships = [];
		// Precomputed minimap dots for a mode's own static geometry (PENDING #26's Maze walls, the
		// one consumer so far) - empty for every other mode. A wall never moves and this codebase
		// never resizes a `walls`-bearing arena live, so build() computes these once instead of
		// getUi() re-walking INSTANCE.walls for every viewer on every UI tick.
		this.wallDots = [];
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
		The drone standing at `post`, or undefined.

		`post.slot` is a bare integer id, and INSTANCE.bullets HANDS THAT ID OUT AGAIN once the
		dead drone's tombstone expires (lib/SlotMap.js: KEEP_PLACE ticks, then freeIndex() is free
		to reuse it) - so between a drone dying and its post's respawn countdown elapsing, that slot
		can already belong to somebody else's bullet entirely. Reading it blind gave two failures,
		both of which need a bullet-dense room to show up at any rate (which is why rooms/Tester.js
		found them and 2team/4team never did): a live stranger in the slot looked like a healthy
		drone, so the post kept resetting its countdown and never refilled; and a DEAD stranger in
		the slot reached tickBaseDrones()'s ledger-release with no `levels` on it and threw.

		So identity is checked, not assumed - spawnBaseDrone() stamps the drone with a
		back-reference to its own post, and only that exact object counts as this post's drone.
	*/
	postDrone(post) {
		const bull = this.INSTANCE.bullets.get(post.slot);
		return (bull && bull.post === post) ? bull : undefined;
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
		// The post this drone belongs to, by reference. postDrone() reads it to tell this drone
		// apart from whatever unrelated bullet inherits its slot id later - see that method.
		bull.post = post;
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
		// Knockback dealt to a tank: diep's own drone row, 0.8 gu, the same the whole drone family
		// carries in public/SHARE/TanksConfig.js. `push` is the separate self-bounce column, and it
		// keeps the 2 that the single pre-split field held - base drones hold a ring, so their own
		// separation impulse is load-bearing in a way an ordinary bullet's is not.
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
		Refills empty posts. A post whose drone is alive resets its own countdown, so the timer
		only ever runs while the post is actually empty - i.e. a drone that dies is replaced
		BASE_DRONE_RESPAWN ticks later, not on a free-running clock.

		A drone that dies mid-life also has to release its claim on the level ledger exactly once
 - `levelReleased` guards that, and is sound rather than lucky: SlotMap's
		KEEP_PLACE is 20 ticks, so a destroyed drone is still reachable through postDrone() for 20
		ticks after destroy is set, and this runs on every one of them, so the release can never be
		missed by the slot being recycled first. It has to be postDrone() and not a bare
		INSTANCE.bullets.get() for the reason that method's own comment gives.
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
		// diep's real 45-minute guarantee (plan.md X1, BOSS_TIMER_TICKS above) - lazily
		// initialised so a mode with maxBoss 0 never allocates the field at all.
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
			// Cluster radii, x this.nestScale so a nest stays the same fraction of the arena at any
			// size (PENDING #19, plan.md step 6) - the same scaling spawnKeepOut()'s keep-out circles
			// and entities/Objects.js's carve-outs get, and for the same reason. ffa's scale is 1.
			const s = this.nestScale;
			switch (type) {
				case 'sqr':
				case 'Bsqr':
					ppp = [this.map.width / 4, this.map.height / 4, 490 * s];   // 350 x1.4, grid rescale
					break;
				case 'tri':
				case 'Btri':
					ppp = [-this.map.width / 4, -this.map.height / 4, 490 * s]; // 350 x1.4, grid rescale
					break;
				case 'pnt':
				case 'Bpnt':
					ppp = [0, 0, 630 * s];   // 450 x1.4, grid rescale
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
	/*
		`which`/`pos` are both optional and default to what this always did (a random boss at a
		random point on the quarter-radius circle) - rooms/Tester.js is the one caller that names
		them, since a diagnostic room wants one of each boss at a known place rather than a roll.
	*/
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
			// diep's real per-boss body size (plan.md X2/Part D) - CLASS[...].bossSize, converted
			// from each boss's own diepcustom source at its own TanksConfig.js entry. Summoner now
			// has a real one too (Summoner.ts's SUMMONER_SIZE, plan.md Part D); the `|| 64` is dead
			// weight now that every CONFIG.BOSS entry sets bossSize, kept only as a defensive floor.
			b.size = CLASS[spec[2]].bossSize || 64;
			// A Fallen boss (Fallen Overlord/Fallen Booster) is engaged by base drones ON SIGHT,
			// unlike the polygon bosses, which they ignore until provoked (diep_wiki/basedrones.txt
			// - entities/Bullet.js's type-1.4 acquire gate is the one reader). Flagged on the class
			// table so this stays one boolean rather than a name test at the read site.
			b.fallen = !!CLASS[spec[2]].fallen;
			b.class = spec[2];
			b.screen = CLASS[b.class].screen;
			// diepcustom AbstractBoss.ts:125-126/139 (plan.md Part D's shared boss scaffolding):
			// scoreReward 30000 (was 100000, an unreconciled legacy balance figure), damagePerTick
			// 10 (entities/Player.js's own `this.damage` constructor default is 5, the ordinary
			// tank figure - upClass() is what would normally raise it per class, but createBoss()
			// spawns a boss directly without ever routing through upClass()), and reloadTime's own
			// `15 * 0.914^7` multiplier - every boss cannon's `reload` field in TanksConfig.js was
			// converted assuming the OWNER'S `up.Reload` carries this maxed figure (the same reason
			// rooms/Mothership.js's createMothership() sets it), which createBoss() never did, so
			// every boss fired ~1.877x slower than its own TanksConfig.js comments were computed
			// against until now.
			b.prize = 30000;
			b.xp = 30000;
			b.damage = 10;
			b.up.Reload = Math.pow(0.914, 7);
			// diepcustom AbstractBoss.ts:123 `absorbtionFactor = 0.05` - nearly immovable, not
			// literally 0 like a Dominator (entities/Player.js's collision() arms read this back).
			b.absorb = 0.05;
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
	/*
		Spawn one Dominator (PENDING #27) - a stationary Player bound to one of
		CONFIG.DOMINATOR's three cannon variants, the same way createBoss() above binds
		CONFIG.BOSS. `variant` picks an index into CONFIG.DOMINATOR (Destroyer/Gunner/Trapper,
		0/1/2); omitted, one is picked at random - convenient for the Sandbox admin command,
		which has no reason to care which variant it gets.

		Spawns neutral (team 2, SocketSchema's 'yellow' - diep's own neutral-Dominator colour)
		regardless of what rules.teams this room states, since capture is what assigns it a real
		side; lib/gameAI.js's dominatorCapture() is what moves it off team 2 later. Stats are set
		on the instance rather than in TanksConfig.js, the same call createBoss() already makes
		for a boss: diepcustom's Dominator.ts (SIZE 160 du x 0.56 = 89.6; maxHealth 6000 at
		camera.setLevel(75), so live max HP is 6000 + 2x74 = 6148, plan.md Step 11) - not a
		formula this class table's usual level-driven growth could express, since this engine's
		level cap never reaches diep's hypothetical level 75.
	*/
	createDominator(x, y, variant) {
		const spec = CONFIG.DOMINATOR[(variant !== undefined) ? variant : Math.floor(Math.random() * CONFIG.DOMINATOR.length)];
		const dom = this.INSTANCE.players.add((id) => {
			const d = new Player(
				{ "GM": this.gm, "sId": this.id, "oId": id },
				x, y,
				spec[2],
				2,   // neutral - lib/gameAI.js's DOMINATOR_NEUTRAL_TEAM
				this.XPLVL,
				this
			);
			d.hp = 6148;
			d.maxHp = 6148;
			d.dominator = 1;
			// Real diep level 75 (Dominator.ts's camera.setLevel(75)) - drives its real camera
			// scale (screenAtLevel(75) above) and the HUD's reported level; never clamped to
			// Player.LEVEL_CAP, Room#getBuffer()'s scripted-entity branch sends it flat.
			d.level = 75;
			// diep's own `absorbtionFactor = 0` for a Dominator (Object.ts:280, plan.md Part D's
			// shared boss table cites the same field for a real boss at 0.05) - immovable. The
			// KIND.PLAYER/KIND.BULLET collision arms in entities/Player.js also keep their own
			// separate `!this.dominator` gate (predates `absorb`, redundant with 0 here but left
			// alone rather than removed); the KIND.OBJECTS arm has no such gate, so this is what
			// actually stops a shape from shoving a Dominator.
			d.absorb = 0;
			d.size = 89.6;
			d.class = spec[2];
			d.screen = CLASS[d.class].screen;
			d.shield = 0;
			d.motion = spec[0].bind(d);
			d.update = spec[1].bind(d);
			return d;
		});
		if (dom) { this.dominators.push(dom); }
		return dom;
	}
	/*
		H-key piloting (plan.md E4, diepcustom Client.ts's possess()/TakeTank): claim the
		nearest same-team claimable AI (a captured Dominator, or your own team's Mothership),
		sorted by distance the same way diep's own AIs.sort() is - no fixed claim radius, just
		whichever is closest. Toggling while already piloting one releases it instead - net/
		gameSocket.js's 'h' keydown calls this unconditionally either way.

		`pilot`'s own tank keeps existing (entities/Player.js's own update() bleeds its HP while
		`piloting` is set) rather than being replaced - releasing (here or the vacated tank
		dying, see that same update()) hands it back exactly where it was left.
	*/
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
		// Mothership's own 5-minute possession clock (plan.md E3/E4, Mothership.ts's
		// possessionStartTick) - Dominator possession has no timer, so these two just never get
		// read for one (lib/gameAI.js's dominatorUpdate() doesn't check them at all).
		if (best.mothership) {
			best.possessionStartTick = this.timestamp;
			best.possessionWarned = false;
		}
		pilot.piloting = best;
		pilot.mess.push('Press H to surrender control of the tank');
	}
	/* The other half of togglePossession() above - also the auto-release path when the
	   vacated pilot's own tank finally bleeds out, and Mothership's own timer-expiry kick
	   (lib/gameAI.js's mothershipUpdate()). Safe to call on an already-released pilot. */
	releasePossession(pilot) {
		const target = pilot.piloting;
		if (!target) { return; }
		target.pilotedBy = null;
		target.possessionStartTick = -1;
		pilot.piloting = null;
	}
	/*
		Everything that is derived from the arena's current size, recomputed together (PENDING #19,
		plan.md step 6). Called once from the constructor and once per tick from step(), with the
		live human count - which is why it takes that count rather than reading it: step() has
		already walked the player list to decide whether the room should self-destruct, so this
		reuses that pass instead of adding a second one.

		Three things are derived, and the ordering matters - `nestScale` and `baseSize` come off
		this.map (what the arena IS right now, mid-lerp), not this.newMap (what it is heading for),
		so the carve-outs and the base track the arena continuously as it resizes rather than
		snapping to the target while the map is still moving.

		`arenaLive` modes additionally write this.newMap, i.e. they ask for a resize the same way the
		admin 'mapResize' command does, and get the same smoothing for free. A non-live mode never
		touches newMap here, so the admin command still works in every mode - a live mode will simply
		overwrite the request on the next tick, which is correct: its size is a function of its
		population, not a setting.
	*/
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
		// Crashers scale with the arena the same way sqr/tri/pnt do - unlike Bpnt/Bsqr/Btri just
		// below, a Crasher IS a real diep shape with a real density to be faithful to, not a
		// stand-in this file gets to leave at a hand-picked literal. crasherDensity is a per-mode
		// multiplier on top of that density (1 = unmodified).
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
	/*
		The one place a kill turns into xp. Every "killer gains the victim's prize" site routes
		through this - rooms/Room.js's two bullet arms below, entities/Player.js's tank-vs-tank arm
		and entities/Objects.js's shape-vs-tank arm - so a mode's xp multiplier is stated once
		(`rules.xpMul`) instead of being applied at four call sites that would drift apart.
		diep_wiki gives Tag/Breakout x3 and Domination x2; every other mode is x1, so this is an
		identity multiply for four of the five modes and costs them nothing.

		Coins deliberately do NOT go through here: they are our own currency, not diep's xp economy,
		and no reference multiplies them per mode.
	*/
	awardXp(tank, amount) {
		tank.xp += amount * this.rules.xpMul;
	}
	/* A bullet belongs to whoever fired it. The dev 'color' command tints it without moving
		 it to another side - bulletColor() is what reads that. */
	assignBulletTeam(bullet, origin) {
		bullet.team = origin.team;
		if (origin.dev.color) {
			bullet.color = origin.dev.color;
		} else if (origin.boss) {
			// A boss's projectiles carry ITS colour, not team 9's flat gold - diep gives a boss's
			// drones/traps the boss's own styleData.color (Guardian's swarm is Color.EnemyCrasher
			// pink, Fallen Overlord's is Color.Fallen grey). `color` is the dev-tint field's own
			// 1-based encoding, which every mode's bulletColor() already decodes, so this needs no
			// per-mode override - Room.bossColor() is the same lookup entityColor() uses for the
			// boss's own body.
			bullet.color = Room.bossColor(origin) + 1;
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
			// explicitly, or an empty 'boss' room (three bosses, always alive) ticks forever. A
			// Closer (PENDING #28, rooms/Tag.js's createCloser()) needs the same exclusion for the
			// same reason: it is invincible and never dies, so counting it here would mean a Tag
			// match that has finished closing - every real player dead - never actually self-
			// destructs, and just sits open with its Closers idling forever. A Dominator
			// (PENDING #27) needs it for the identical reason: it never dies either, only gets
			// captured, so an empty Domination room would otherwise never self-destruct.
			// A Mothership (plan.md G1) is destroyable, unlike a Closer/Dominator, but it is
			// still not a "player" for this count's purpose - an empty Mothership room (every
			// human gone, both team flagships still standing) must self-destruct exactly like
			// an empty boss room does.
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
		// AFTER the lerp, not before: nestScale/baseSize/shape caps are functions of the size the
		// arena actually has this tick, so they have to read this.map once it has moved. (It also
		// sets next tick's lerp target for an arenaLive mode, which is why order is only visible
		// here as a one-tick lag on the target, not on anything derived.)
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
				// A player dies exactly on the base line; a bullet is allowed to penetrate
				// config.BASE_BULLET_MARGIN past it first, which is what real diep does and what
				// stops enemy fire visibly evaporating on an invisible wall.
				// The base only kills inside the drawn arena - inEnemyBase()
				// alone is unbounded outward, so something sitting in the dark OOB band past a
				// corner would otherwise still count as "in" the base; inArena() is the one place
				// that bound is written.
				if ((kind === 'players' || kind === 'bullets') && this.inArena(obj) &&
					this.inEnemyBase(obj, kind === 'bullets' ? config.BASE_BULLET_MARGIN : 0)) {
					// Same refund as the tombstone site above, paid up front - harmless if
					// collision()'s own tail below also runs it (idempotent via `released`).
					obj.release && obj.release();
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
					// diep's same-team physics-flag filter - see teamPassThrough() above. Placed
					// AFTER the detector block deliberately: detection is a separate question from
					// physical contact (a detector already does its own team check), and moving this
					// earlier would change who base drones and Dominators can see.
					if (teamPassThrough(this, obj, objKind, other, otherKind)) { continue; }
					// `guardSize` (plan.md T6) is a Player-only field, always >= `.size`, that
					// widens contact for a Smasher/Landmine/Spike-line tank's spinning guard;
					// undefined (falls back to `.size`) for every non-Player entity.
					if (dis <= (obj.guardSize || obj.size) + (other.guardSize || other.size)) {
						// Antisymmetric tie-break, so each unordered pair resolves through exactly one
						// of its two (obj,other)/(other,obj) visits below - the position-sum clause is
						// only a TIE-break (gated on size equality) now, not an independent OR: at an
						// exact position tie (obj.x+obj.y === other.x+other.y) between entities of
						// DIFFERENT sizes, the un-gated `||` used to let BOTH visits satisfy this guard
						// (`>=` holds in both directions when the sums are equal), double-processing the
						// pair - harmless before proration existed (each collision() call was
						// independent), but proration's own dmgScale computation above assumes the pair
						// it is prorating is resolved once, per plan.md step 5's own "must be resolved
						// once" requirement, so a double resolution would double-apply it too.
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
							// Proration (PENDING #18, plan.md step 5 part 4) - see damageOutput()/
							// damageGuarded() above for why this has to run before either collision() call.
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
							// `.dmg`, not `.pene` - diep's handleCollision spends a bullet's own fixed
							// damagePerTick against the OTHER side's health pool, not the other side's own
							// remaining pool (Live.ts:67-84; entities/Bullet.js's KIND.BULLET arm is the
							// one consumer, plan.md chunk 1's bullet-vs-bullet fix). Only ever read when
							// both sides are bullets, but harmless to set whenever either is.
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
										this.awardXp(killer, other.prize);
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
										this.awardXp(killer, obj.prize);
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
		/*
			Maze walls do NOT go through the quadtree for the per-viewer buffer (they still do for
			collision) - they are appended below by a straight rectangle-overlap test against every
			wall in the room.

			Two separate things made a wall vanish while part of it was still on screen, and both
			are properties of indexing a rectangle by its centre point:
			  - `qt.query()` prunes whole NODES by their own bounds, and a wall lives in the single
			    leaf its CENTRE falls in. A wall long enough to cross the screen has its centre in
			    a leaf the viewer's rectangle may not touch at all, so the entire subtree - wall
			    included - was pruned before the per-point footprint test ever ran.
			  - the footprint test itself only ever widened the point by w/h; it could not resurrect
			    a wall the node prune had already dropped.
			A wall never moves and a room has at most a few dozen of them, so an O(walls) exact test
			per viewer is both cheaper than the tree walk and unconditionally right: ANY wall
			touching the buffer rect is sent, however far its centre is and however large it is.
		*/
		// Materialised, not the generator: `live()` is a generator (lib/SlotMap.js), so it has no
		// `.length` and is consumed by the first viewer that walks it. Built once per tick, and
		// only in a mode that actually has walls - `size` is a plain Map lookup, so ffa and every
		// other wall-less mode pays one integer compare and allocates nothing.
		const wallList = this.INSTANCE.walls.size ? [...this.INSTANCE.walls.live()] : null;
		for (const [id, player] of this.INSTANCE.players.entries()) {
			if (player.bot || player.boss || player.dominator) {
				continue;
			}

			/*
				Dominator/Mothership takeover (Batch F, diepcustom Client.ts's possess():
				`camera.cameraData.player = ai.owner`). While this human is piloting a boss, the
				socket's whole view - camera centre, the `main` entity its HUD/hp/death-flag read,
				and the self-dedup below (getBuffer's `RAW.main.id.oId === obj.id.oId` skip) - is the
				BOSS, not this human's own (now dying) body. Keying the dedup off the boss is what
				makes the old body appear in `rest` as an ordinary dying tank while the boss is drawn
				as `User`. Input still routes to the human (net/gameSocket.js's getPlayer), which
				drives the boss through lib/gameAI.js's mirror - only the camera/identity moves here.
			*/
			const cam = player.piloting || player;

			// Predator zoom (plan.md C9): the per-viewer buffer is centred on the locked zoom
			// point while one is active, not the tank's own position, or the client would pan its
			// camera out to an area the server never sent any entities for. The FoV SIZE (screen)
			// is unchanged - diep's zoom moves where you're looking, not how far you can see.
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
		// `!tank.dead`, not `!tank.destroy || tank.dead > 1`. The old pair made a player wait out
		// the whole death animation (`destroy` counting down from tick.DES) AND then
		// config.DEAD_DELAY on top of it - and because the Enter that asks for a respawn is a
		// one-shot keyup, an early press was simply dropped rather than queued, so it read as
		// "Enter does nothing, press it again". `dead` and `destroy` are written at exactly the
		// same moments (every site in entities/Player.js sets both), so testing `dead` alone is
		// the same liveness question with none of the waiting: Enter now respawns you the instant
		// you are dead. DEAD_DELAY still runs - it is what paces the death camera drifting toward
		// your killer in step() - it just no longer gates this.
		if (!tank || (!force && !tank.dead)) return;
		///
		const pos = this.spawnPoint(tank);
		// respawnTeam(), not tank.team, so Tag can put you on your killer's side. Every other mode
		// returns tank.team and is unaffected. Read BEFORE the new Player exists, because it has to
		// look at who killed the OLD one (tank.murder), which the new one knows nothing about.
		const newTank = new Player(tank.id, pos.x, pos.y, tank.name, this.respawnTeam(tank), this.XPLVL, this);
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
		Which side you come back on. Everywhere but Tag that is the side you were already on, which
		is why this is a hook rather than a rule flag: Tag's answer needs `tank.murder` (who killed
		the old tank), not a per-mode constant. See rooms/Tag.js.
	*/
	respawnTeam(tank) {
		return tank.team;
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

		The carve-out radii callers pass in USED to be absolute, which made this loop unsatisfiable
		on a small enough map - below roughly 2744 units wide, no point on the map was 1540 from the
		origin at all - and since this runs on the simulation thread, an unsatisfiable loop took the
		whole room down. PENDING #19 / plan.md step 6 removed that failure mode at the source: every
		caller now scales its radii by room.nestScale (rooms/Room.js's spawnKeepOut()/createObj(),
		entities/Objects.js's carve-outs), so the carve-outs are a fixed FRACTION of the arena and
		the placement picture is geometrically similar at every size. There is no width at which the
		loop becomes unsatisfiable any more.

		The cap below stays anyway, and is not vestigial: it bounds the loop against a caller that
		passes its own circles (and against any future mode whose keep-outs are not derived this
		way), so "neither caller may loop until it succeeds" remains true by construction rather
		than by the current radii happening to be well-behaved.

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
	/* The three polygon nests, as [x, y, radius] keep-out circles. The radii are ffa's own tuned
		 1540/1120 scaled by this.nestScale (PENDING #19, plan.md step 6), so they stay the same
		 fraction of the arena at any size - ffa's scale is exactly 1, so ffa is unchanged. See
		 NEST_REF_GU's comment at the top of this file for why that, not a clamp, is what makes
		 rejectSample() below satisfiable at every arena size. */
	spawnKeepOut() {
		const s = this.nestScale;
		return [
			[0, 0, 1540 * s],
			[this.map.width / 4, this.map.height / 4, 1120 * s],
			[-this.map.width / 4, -this.map.height / 4, 1120 * s]
		];
	}
	/* Free-for-all drops you anywhere clear of the three polygon nests. The 280 inset is scaled by
		 nestScale for the same reason the nest radii are (PENDING #19, plan.md step 6) - it is the
		 same inset entities/Objects.js's `marge` uses, and the two have to stay in step. */
	spawnPoint(tank) {
		return this.rejectSample(280 * this.nestScale, this.spawnKeepOut());
	}
	/* Whether a point is clear of permanent geometry, at least `pad` units from it. Shapes are
		 placed directly by entities/Objects.js rather than through spawnPoint(), so they need their
		 own way to ask this. Only Maze has any permanent geometry (rooms/Maze.js overrides this) -
		 every other mode has nothing to be embedded in, so the base answer is always yes. */
	clearOfWalls(x, y, pad) { return true; }
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
			// Both of these are the server's own rules, read straight off entities/Player.js rather
			// than re-expressed here (PENDING #30): points available is granted-minus-spent, not
			// level-minus-spent, and a class tier opens every 15 levels. A possessed Dominator/
			// Mothership (Batch F: RAW.main is now the boss) has no upgrade path at all - diep's own
			// possess() zeroes statsAvailable - so both read 0 rather than a boss's own level.
			still: (RAW.main.dead || RAW.main.boss || RAW.main.dominator || RAW.main.mothership)
				? 0 : Player.pointsAtLevel(RAW.main.level) - RAW.main.stillLvl,
			cLvl: (RAW.main.dead || RAW.main.boss || RAW.main.dominator || RAW.main.mothership)
				? 0 : parseInt(RAW.main.level / 15),
			// 0 in ffa/boss/sandbox, which have no bases - the client reads that as "draw none"
			// rather than needing to know which gamemodes have them.
			baseSize: this.baseSize || 0,
			// plan.md A4/C5 - the arena state machine's own fields, real since A4 landed but not on
			// the wire until now (PENDING.md). Every existing mode sits fixed at OPEN/0/0 (A4's own
			// note: opens straight into OPEN and never touches these again), so this is a no-op for
			// them; Survival's real COUNTDOWN is the first consumer.
			arenaState: this.state,
			ticksUntilStart: Math.max(0, this.ticksUntilStart),
			playersNeeded: this.playersNeeded,
			// Predator zoom (plan.md C9) - the world point the client's own camera should track
			// this tick; equal to the viewer's own x/y whenever `main.states[4]` (zooming) is off.
			camX: RAW.main.zooming ? RAW.main.zoomX : RAW.main.x,
			camY: RAW.main.zooming ? RAW.main.zoomY : RAW.main.y
		};
		///
		const lvl = RAW.main.level, xp = RAW.main.xp, arr = RAW.main.XPLVL;
		// A possessed Dominator/Mothership (Batch F) has a flat level and no xp curve to interpolate
		// along - send its level as-is rather than dividing by an xp band it never had.
		buff.head.level = (RAW.main.boss || RAW.main.dominator || RAW.main.mothership) ? lvl
			: (!lvl ? 1 : ((lvl >= arr.length - 1) ? lvl : lvl + Math.max(Math.min(1, (xp - arr[lvl - 1]) / (arr[lvl] - arr[lvl - 1])), 0)));
		///
		buff.main = {
			// states[4]: Predator zoom (plan.md C9) - whether head.camX/camY is currently a real
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
			// While the `c` spin is on, send its own phase rather than this.dir: a mousemove can
			// land between the tick that spun the tank and this encode, and the client draws this
			// field verbatim (User.realDir/followDir) - so reading it here would splice one frame
			// of mouse aim into the spin.
			//
			// Gated on `spinning`, NOT on `inputs.c`, and so is states[1] above. The keydown
			// handler in net/gameSocket.js toggles inputs.c the instant the packet lands, but
			// `spinning`/`spinDir` are only established on the next room tick - and the send loop
			// is not tied to the room simulation (see net/gameSocket.js's header). Encoding in
			// that window with inputs.c already 1 read a `spinDir` still holding the PREVIOUS
			// spin's end angle, so the client drew one frame pointing there before the next tick
			// re-seeded it from the live aim: a visible snap-away-and-back on every re-press.
			// `spinning` is set in the same tick that assigns spinDir, so it can never be stale.
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
							// plan.md C5/S4 - the shape's own real facing (idle BASE_ROTATION spin, or a
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
						// A wall never moves and never changes after spawn - no hp/color/states,
						// just the geometry. Rectangular now (plan.md Step 12): w/h, not obj.size
						// (which is only the entity's own broad-phase bounding radius, see
						// entities/Wall.js - never what goes over the wire).
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
	/*
		Colour of another tank, as everyone sees it. Cached, so it cannot depend on the viewer.
		A boss draws in its own real diep colour now (plan.md Part D, SocketSchema.js's own
		comment on the 4 appended enum entries) rather than the flat team-9 gold every boss used
		to share - Guardian pink, Defender coral, Summoner square-yellow, both Fallen bosses grey.
		The lookup itself is Room.bossColor() (a static, below the class) so every team mode's own
		entityColor() override (TwoTeam/FourTeam/Tag - each colours an ordinary tank by
		player.team, which a boss's team 9 would otherwise just fall through to unchanged) can
		special-case a boss the same way without repeating this switch four times.
	*/
	entityColor(player) {
		return player.boss ? Room.bossColor(player) : (Room.neutralColor(player) ?? 1);
	}
	/* Colour of your own tank on your own screen. */
	mainColor(player) {
		return 0;
	}
	bulletColor(bullet) {
		// `bullet.color` (1-based, assignBulletTeam()) is the dev tint AND a boss's own colour -
		// the team modes' overrides already read it; the ffa/boss default did not, so a Guardian
		// in a boss room fired team-9 gold drones instead of its own pink.
		//
		// A necromancer's own drone (type 3) is diep_wiki's "peach"/beige tone ONLY outside a team
		// mode - "though it otherwise duplicates the one of the player's team (in all non-FFA
		// modes)". This used to read `9` (the necro colour) unconditionally, so a TDM necromancer's
		// drones never picked up their team's colour at all (issues.md).
		//
		// A per-cannon draw-colour override (entities/Player.js's shoot()) wins outright: a Summoner
		// spawner drone sets drawColor 9 so it reads Necromancer beige (diep's SummonerSpawnerDefinition
		// hardcodes `color: Color.NecromancerSquare`), unlike the Summoner's own EnemySquare-yellow BODY.
		// It is unconditional the way a boss body's own colour is (Guardian pink/Fallen grey in every
		// mode) - a neutral boss is on nobody's team, so its drones never take a team tint.
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
	/*
		Colour of one minimap dot. The default is leaderColor()'s answer - you in your own colour,
		everyone else by team - with one exception it has to make itself: a BOSS has no meaningful
		team (they all sit on team 9), so it takes its own diep body colour from entityColor(),
		which is what makes a Guardian read as pink and a Defender as coral on the minimap instead
		of both being an indistinguishable gold dot.

		A hook rather than an inline branch because rooms/Tester.js wants the whole thing to be
		absolute - see its own override.
	*/
	mapDotColor(player, viewerId) {
		return player.boss ? this.entityColor(player) : this.leaderColor(player, viewerId);
	}
	/*
		The leaderboard's rows, as the wire's {xp, name, nameC, team} records. Ordinarily one row
		per top-10 player, which is what `this.leader` is already sorted into by step().

		A hook rather than inline code because Tag's board is a different KIND of thing - one row per
		team showing how many players it has (diep_wiki/Tag.txt) - and the client needs no change to
		draw that: public/client/ui.js renders every row as "name - xp" with a bar scaled against
		row 0's xp, so a row count reads correctly as-is. See rooms/Tag.js.
	*/
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
		// Every live player as a minimap dot - same exclusion (dead/destroyed, bosses) and the
		// same viewer-relative colouring (you're always "your" colour, everyone else by team)
		// that this.leader already uses, just not limited to the top 10. x/y go out as 0..1
		// fractions of the current map size (TYPE.UiUpdate.map, CODECS.unit), so they still land
		// in the right place after this.map.width/height finish lerping toward a resize.
		for (const i of this.INSTANCE.players.live()) {
			if (i.destroy) { continue; }
			buff.map.push({
				x: (i.x + this.map.width / 2) / this.map.width,
				y: (i.y + this.map.height / 2) / this.map.height,
				// A BOSS is on the minimap now (it used to be filtered out alongside destroyed
				// tanks) and carries its own diep colour rather than a viewer-relative one, so an
				// observer can see where the Guardian/Defender/Summoner/Fallen pair actually are.
				// entityColor(), not leaderColor(): leaderColor answers "is this you", which is a
				// question about a player, and it collapses every boss onto team 9's gold.
				// `mapDotColor()` is the per-mode hook around the whole choice - see there.
				team: i.dev.color ? i.dev.color - 1 : this.mapDotColor(i, id),
				size: Math.min(255, Math.round(i.size)),
				// A player is a round dot, not a rectangle - see TYPE.UiUpdate.map.
				w: 0,
				h: 0
			});
		}
		// A mode's own static geometry (Maze's walls, PENDING #26) - precomputed once in build(),
		// see this.wallDots' own comment in the constructor for why this is a plain concat rather
		// than a live walk of INSTANCE.walls.
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

// diep's own Native/Arena.ts ArenaState numbering (plan.md A4) - kept as literal values, not a
// re-numbered enum, so the wire byte means the same thing a real diep client would read.
Room.ArenaState = { COUNTDOWN: -1, OPEN: 0, OVER: 1, CLOSING: 2, CLOSED: 3 };

/*
	A boss's real per-diep-class colour (plan.md Part D) - shared by every mode's own
	entityColor() override (this file's own default above, plus TwoTeam/FourTeam/Tag's, which
	each colour an ordinary tank by player.team and need this to special-case a boss rather than
	just falling through to team 9's flat gold). Falls back to player.team for a boss class not
	in the table (there is none today) rather than crashing.
*/
/*
	Color.Neutral (index 14, 'neutral' - 0xFFE869) for the two entities diep puts on the arena's
	own team: an Arena Closer, always, and a Dominator ONLY while it is uncaptured. Returns null
	for everything else so a caller can fall through to its own team colouring - which is what
	makes a captured Dominator go on rendering in its captors' colour without a second check.

	Both used to render in team 9's `necro` beige, which is also why a Closer read as "the same
	sort of thing as a boss" rather than as arena furniture.
*/
Room.neutralColor = function (player) {
	if (player.closer) { return 14; }
	if (player.dominator && player.team === 2) { return 14; }   // 2 = rules.neutralTeam
	return null;
};
Room.bossColor = function (player) {
	switch (player.class) {
		case 'Guardian': return 10;      // 'bull' - Color.EnemyCrasher
		case 'Defender': return 11;      // 'coral' - Color.EnemyTriangle
		case 'Summoner': return 12;      // 'square' - Color.EnemySquare
		case 'Fallen Overlord':
		case 'Fallen Booster': return 13; // 'fallen' - Color.Fallen
		default: return player.team;
	}
};

module.exports = Room;
