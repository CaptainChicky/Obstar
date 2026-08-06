/*
	Bot, boss and pet AI.

	These behaviour functions get bind()-ed onto entities at spawn time, so `this` inside
	them is the tank / boss / pet, not this module. Detector/Vec/BODY_FRICTION/CLASS are all leaves,
	none of them sitting on the entity/room/Controller dependency graph, so this is a plain
	module, not a factory - CONFIG is exported directly.

	This is the working copy of the AI. A second, diverged
	copy that never executed - see the note at the top of that file.
*/
const KIND = require('../public/SHARE/kinds.js');
const Physics = require('../public/SHARE/Physics.js');
const config = require('./config.js').config;
const Detector = require('../entities/Detector.js');
const Vec = require('victor');
const tick = require('./tick.js');
// The BOSS block's drift decays through this - NOT public/SHARE/Physics.js's tank FRICTION, and
// the choice is deliberate (plan.md step 2, lib/constants.js). See the drift call site for why.
// Bots do NOT read it: they steer through Physics.stepBody like a human tank does, so they moved
// to 10/11 with everything else that is actually a tank.
const BODY_FRICTION = tick.drag(require('./constants.js').BODY_FRICTION);
const CLASS = require('../public/SHARE/TanksConfig.js').class;
const DES = tick.DES;
// H-key piloting (plan.md E4) - Player.prototype.motion()'s ordinary WASD/Physics.stepBody
// integrator, reused for a piloted Mothership (a Dominator never moves either way, piloted or
// not - Dominator.ts's own `ai.movementSpeed = 0`). entities/Player.js does not require this
// file (no cycle: gameAI.js sits below Player.js on the dependency graph, only rooms/Room.js
// requires both).
const Player = require('../entities/Player.js');
// diepcustom Mothership.ts: `POSSESSION_TIMER = tps x 60 x 5` (tps=25, its own 40ms tick) - 7500
// reference ticks, 5 minutes despite that file's own comment saying "10 minutes" (a stale
// comment against its own literal, plan.md E3 - the constant wins). Dominator
// possession has no timer at all (Dominator.ts carries no possessionStartTick field).
const POSSESSION_TIMER = tick.ticks(7500);
// The 10-second warning point (Mothership.ts: `POSSESSION_TIMER - 10 x tps`), in the same
// reference-tick axis before conversion - 10 tps-seconds = 250 reference ticks.
const POSSESSION_WARN_AT = tick.ticks(7500 - 250);

// A FLAT divisor, deliberately not run through tick.lead() - see entities/Player.js's identical
// copy for the derivation. 15.84 is what tick.lead(9.9) evaluated to at the live TICK_MS, so bot
// auto-turrets aim exactly where they used to; kept identical to Player.js's copy so bots and
// humans lead a moving target the same way rather than disagreeing.
const AUTOTURRET_LEAD = 15.84;
const BOT_SPIN_FLIP_CHANCE = tick.chance(0.00242);
/*
	How hard a boss drives, per reference tick squared - diepcustom AbstractBoss.ts:113's own
	`movementSpeed = 0.5` (du/tick^2) x 0.56.

	This REPLACES a hand-tuned BOSS_DRIFT (0.219408) fed through an integrator carrying a stray
	`/ 10` on its position step; between them, every boss travelled at well under a tenth of
	diep's own speed, which is what made a Fallen Booster's chase read as standing still. The
	conversion is clean and nothing in it is invented: diep adds `movement x movementSpeed` to
	velocity every tick and decays it with the SAME universal 0.9 friction everything else in this
	tree already uses (lib/constants.js's BODY_FRICTION), so terminal speed is 10 x the accel -
	140 u/s for Fallen Booster's own `movementSpeed = 1` (bossThrust()'s `mult` of 2), 70 u/s at
	the default. bossThrust() now integrates exactly like every other non-tank body here
	(`v += A; v *= F; x += v`), which is what that `/ 10` was standing in for.

	tick.quadratic(), not tick.perTick(): added every tick and then integrated into position
	again, i.e. twice over ticks - the same category as entities/Bullet.js's cruise thrust.
	BULLET_CRUISE_ORDER is the friction-ORDER compensation that tail carries, for the same reason:
	diep displaces the PRE-friction velocity (terminal 10A) and this order displaces the
	post-friction one (9A), a flat 10% that belongs at the site rather than inside the constant.
*/
const BOSS_ACCEL = tick.quadratic(0.5 * 0.56 * require('./constants.js').BULLET_CRUISE_ORDER);
/*
	Fallen Booster's own chase speed, deliberately pushed past diep's `movementSpeed = 1` (the
	plain `mult = 2` every other comment in this file cites): a testing/gameplay request for it to
	close distance as fast as the single fastest thing a real tank can ever be - a level LEVEL_CAP
	(45) Booster with all 7 Movement Speed points spent, entities/Player.js's own hard ceiling on
	both level and that stat. Derived, not tuned by feel, so it stays correct if any of the physics
	constants it reads ever move:

	  1. That tank's own top speed, in u/s, is public/SHARE/Physics.js's steady state of
	     `v = (v + moveAccel(7, 45)) * FRICTION` (the same `V_max = 10 x A` shape Physics.js's own
	     header comment cross-checks the base case against), converted through REF_TICK_MS since
	     `moveAccel` is denominated per reference tick.
	  2. `bossThrust(this, angle, mult)`'s own steady state at `mult = 1` is the same recurrence
	     over BOSS_ACCEL/BODY_FRICTION - `tick.drag()`-converted to a REAL tick already, so its u/s
	     conversion goes through TICK_MS instead - and `mult` scales that speed linearly (thrust is
	     the only mult-scaled term in the recurrence), so "the mult that lands exactly on (1)" is
	     just the ratio of the two steady states.

	Evaluates to ~4.168 today (~297.7 u/s, against the un-boosted mult=2's ~142.8 u/s) - roughly
	2.1x its diepcustom figure, not diep-faithful and not meant to be; a Fallen Booster ramming at
	a capped tank's own max speed is the point.
*/
const FALLEN_BOOSTER_MULT = (() => {
	const bf = tick.drag(require('./constants.js').BODY_FRICTION);
	const bossUnitsPerSec1x = (BOSS_ACCEL * bf / (1 - bf)) / (config.TICK_MS / 1000);
	const F = Physics.FRICTION;
	const tankUnitsPerSec = (Physics.moveAccel(7, 45) * F / (1 - F)) / (config.REF_TICK_MS / 1000);
	return tankUnitsPerSec / bossUnitsPerSec1x;
})();
const BOT_TURN_RATE = tick.smoothing(0.35101);
const BOSS_SHOOT_CHANCE = tick.chance(0.48485);
// diepcustom AbstractBoss.ts:129 `ai.viewRange = 2000` du - x 0.56 = 1120 units. A plain radius,
// exactly as diep uses it: no screen shaping, no level scaling, no hull subtraction (see
// bossDetect() below for what it replaced and why nothing was ever getting detected).
const BOSS_VIEW_RANGE = 1120;
// diepcustom AI.PASSIVE_ROTATION (0.01 rad per reference tick) and the radius its idle mouse
// orbits the owner at (AI.tick(): `mouse.set({x: cos(angle)*100, y: sin(angle)*100})`, du) - what
// a target-less boss's own drones drift around.
const PASSIVE_ROTATION = 0.01;
const PASSIVE_MOUSE_RADIUS = 100 * 0.56;
// Tag's Arena Closer (PENDING #28) - a flat per-tick position delta, not a thrust-into-velocity
// term, so tick.perTick() is the right category (see this file's BOSS_ACCEL comment for the
// opposite case). 24 units/REF_TICK = 600 u/s, picked to clear PENDING nuance 32's own 559.2 u/s
// tank-speed ceiling with room to spare - diep_wiki/Arena Closer.txt: faster than every
// fully-upgraded tank class, escape is "virtually impossible".
const CLOSER_SPEED = tick.perTick(24);
// Pets brake twice as hard as everything else (1-fr = (1-BODY_FRICTION)*2, a design choice, not a
// tick-rate artifact) - treated as its own independent friction constant, recomputed (not
// one-time-rescaled) against BODY_FRICTION's new value.
//
// THE "EVERYTHING ELSE" IN THAT RELATIONSHIP IS BODY_FRICTION, NOT THE TANK'S. Checked when the
// two were split (plan.md step 2) and RECOMPUTED, not just re-verified, when BODY_FRICTION moved
// 0.956532 -> 0.9 (plan.md Step 9, nuance 36): the pre-Step-9 pair gave
// 1 - 0.91341 = 0.08659 against 1 - 0.956532 = 0.043468, a 1.992040x ratio - held exactly rather
// than rounded to "1.99x", since that's what "recompute to hold the ratio" means. At the new
// BODY_FRICTION, 1 - fr = (1 - 0.9) x 1.992040 = 0.199204, so fr = 0.800796. Restoring the 2x
// against the tank's 10/11 instead would give 1 - fr = 2/11, i.e. fr = 0.8182 - a pet that brakes
// ~2.2x harder again and stops dead behind its owner. A pet coasts like a body, it does not steer
// like a tank; do not "re-derive" this against TANK_FRICTION.
const PET_FRICTION = tick.drag(0.800796);

/*
	Domination's Dominator (PENDING #27) - a stationary Player, the same CONFIG.BOSS/CONFIG.CLOSER
	pattern: an ordinary Player with motion/update replaced at spawn (rooms/Room.js's
	createDominator()), not a new entity kind, since a Dominator has HP/regen/cannons/AI no static
	entity has.

	Targeting/leading/FoV-hold are NOT reimplemented here - entities/Player.js's own shoot()
	already does exactly that for any class whose cannons carry autoDir/autoShoot (the same
	auto-turret machinery Auto Gunner/Auto Trapper already use): the class's own CLASS[...].DETEC
	(public/SHARE/TanksConfig.js) picks the nearest target in priority-type order and holds it
	until it dies or leaves DETEC.maxDis, and shoot()'s autoDir branch already leads a moving
	target the same way an ordinary auto-turret does. What's actually new here is standing still,
	the capture/knockdown state machine, dropping a target that has stopped shooting back, and
	refusing a shape/boss target while neutral.

	SIMPLIFICATION, flagged rather than silent: diep_wiki/Dominator.txt's "falls back to
	polygons/bosses/closers" reads as a THIRD priority tier below ordinary players; a boss/closer
	is a KIND.PLAYER instance in this engine (flagged .boss/.closer), so DETEC's own type-order
	bucketing only gives two tiers (players-including-bosses/closers, then objects), not three.
	Left this way deliberately rather than hand-rolling a second search past the shared Detector -
	a boss/closer is rare enough that the distinction is unlikely to matter in a live match.
*/
// diep's own neutral-Dominator colour - SocketSchema's `color` table index 2, 'yellow'.
const DOMINATOR_NEUTRAL_TEAM = 2;
// How long a Dominator holds a target that has stopped dealing it damage before dropping it and
// re-scanning. diep_wiki gives no number for this - ours, PENDING #27. 75 reference ticks = 3s at
// the 40ms reference.
const DOMINATOR_RETARGET_IDLE = tick.ticks(75);
// Mirrors entities/Player.js's own regen constants (same identical-copy convention as
// AUTOTURRET_LEAD above) - a Dominator's update() is fully replaced, so it cannot reach
// Player.prototype.update()'s regen block and reimplements it instead of sharing it.
const DOMINATOR_HYPER_REGEN_DELAY = tick.ticks(750);
const DOMINATOR_HYPER_REGEN_RATE = 1 / 250;   // mirrors entities/Player.js's own HYPER_REGEN_RATE (plan.md step 4)
/*
	Runs instead of the ordinary death path the moment `destroy` is set. collision()
	(entities/Player.js, unmodified - a Dominator takes damage exactly like any other Player)
	already spent this tick's hp/set `murder`/set `destroy` before update() ever runs, so this
	only has to read that and decide neutral-vs-flip rather than re-derive who hit it.
*/
function dominatorCapture() {
	// A flip force-ejects whoever's piloting it (plan.md E4, diepcustom Dominator.ts's
	// onDeath()) - the bullet purge below already existed for exactly this event; the pilot
	// just gets handed back their own (still-bleeding-until-this-moment) tank instead of
	// being left "flying" an entity that's about to reset team/HP out from under them.
	if (this.pilotedBy) { this.room.releasePossession(this.pilotedBy); }
	this.destroy = 0;
	this.dead = 0;
	this.hp = this.maxHp;
	this.alpha = 1;
	let killerTeam = null;
	if (Array.isArray(this.murder) && this.murder[0] === 'players' && this.murder[1]) {
		const killer = this.room.INSTANCE.players.get(this.murder[1].oId);
		if (killer) { killerTeam = killer.team; }
	}
	this.murder = -1;
	// A knockdown by anything other than a live enemy player (e.g. a shape's own body damage
	// killed it) heals it back up with no team change - there is no team to credit. Otherwise:
	// neutral -> the attacker's team (captured outright, diep_wiki's one-knockdown rule); an
	// enemy team -> neutral first (the two-knockdown rule).
	if (killerTeam !== null && killerTeam !== this.team) {
		this.team = (this.team === DOMINATOR_NEUTRAL_TEAM) ? killerTeam : DOMINATOR_NEUTRAL_TEAM;
		for (const b of this.room.INSTANCE.bullets.live()) {
			if (b.origin && b.origin.oId === this.id.oId) { b.destroy = tick.DES; }
		}
		if (this.DETEC) { this.DETEC.reset(); this.DETEC.enabled = 1; }
		this.domIdle = 0;
		// diepcustom Dominator.ts's own onDeath() notification (plan.md E4) - only
		// once it actually lands on a real team (not the neutral-reset leg of the two-knockdown
		// rule, which has nobody to invite yet), so the whole team knows there's now a claimable
		// tank to pilot.
		if (this.team !== DOMINATOR_NEUTRAL_TEAM) {
			for (const p of this.room.INSTANCE.players.live()) {
				if (p.team === this.team && !p.bot && !p.dominator && !p.mothership) {
					p.mess.push('Press H to take control of the ' + this.class);
				}
			}
		}
	}
}
function dominatorMotion() { /* diep_wiki/Dominator.txt: "cannot move" */ }
function dominatorUpdate() {
	this.hit = Math.max(0, this.hit - 1);
	// "Cannot move" (diep_wiki/Dominator.txt) is enforced by dominatorMotion being a genuine no-op
	// plus diep's own absorbtionFactor = 0: entities/Player.js's KIND.PLAYER collision arm skips
	// both the knockback impulse and the positional overlap push (PENDING nuance 44) when the
	// target is a Dominator, so nothing ever writes to x/y/vec after spawn - no per-tick snap-back
	// needed here any more (plan.md Step 11 replaces the old spawnX/spawnY reset with this).
	if (this.destroy) { dominatorCapture.call(this); return; }
	// Weak regen - diep_wiki/Stats.txt's own 0-Regen-point linear/hyper rates (entities/
	// Player.js's identical formula at 0 points), not a bespoke number.
	if (this.hp < this.lastHp) {
		this.noDamageTicks = 0;
	} else {
		this.noDamageTicks = Math.min((this.noDamageTicks || 0) + 1, DOMINATOR_HYPER_REGEN_DELAY);
	}
	if (this.hp < this.maxHp) {
		// Additive, not a replacement rate (plan.md step 4) - mirrors entities/Player.js's own update().
		let hps = this.maxHp * 0.03 / 30 / 25;
		if (this.noDamageTicks >= DOMINATOR_HYPER_REGEN_DELAY) { hps += this.maxHp * DOMINATOR_HYPER_REGEN_RATE; }
		this.hp += tick.perTick(hps);
		this.hp = Math.min(this.maxHp, this.hp);
	}
	this.lastHp = this.hp;
	// Drop a target that has stopped shooting back rather than holding it forever just because
	// it never left DETEC.maxDis (entities/Player.js's collision() sets `lastAttacker` at the end
	// of every hit, for exactly this reader).
	if (this.DETEC && this.DETEC.select) {
		if (this.DETEC.select.kind === KIND.PLAYER) {
			const hitByTarget = this.lastAttacker && this.DETEC.select.id &&
				this.lastAttacker.oId === this.DETEC.select.id.oId;
			this.domIdle = hitByTarget ? 0 : (this.domIdle || 0) + 1;
		} else {
			this.domIdle = 0;
		}
		// Neutral cannot damage shapes or bosses (diep_wiki/Dominator.txt) - refusing the target
		// outright is the simplest correct statement of that rule, since a bullet that never
		// fires at a shape/boss cannot damage one either.
		const refuseNeutral = this.team === DOMINATOR_NEUTRAL_TEAM &&
			(this.DETEC.select.kind === KIND.OBJECTS || this.DETEC.select.boss || this.DETEC.select.closer);
		if (this.domIdle > DOMINATOR_RETARGET_IDLE || refuseNeutral) {
			this.DETEC.reset();
			this.DETEC.enabled = 1;
			this.domIdle = 0;
		}
	} else {
		this.domIdle = 0;
	}
	this.lastAttacker = null;
	// H-key piloting (plan.md E4): a possessed Dominator aims/fires wherever its pilot does -
	// mirrored here (not a reference-swapped `inputs` object) so lib/gameAI.js's own AI branch
	// below picks back up cleanly the instant it releases, and so any later reader of this
	// entity's own `inputs` (there are none for a Dominator today, but Mothership's drone
	// steering is exactly this shape) sees live values every tick, not just at claim time. A
	// Dominator itself never moves, piloted or not (Dominator.ts's own `ai.movementSpeed = 0`
	// applies regardless of who's driving) - only aim/fire redirect.
	if (this.pilotedBy) {
		this.dir = this.pilotedBy.dir;
		this.inputs.e = this.pilotedBy.inputs.e;
		this.inputs.mouseL = this.pilotedBy.inputs.mouseL;
		this.shoot();
		return;
	}
	/*
		diepcustom's real Dominator has no per-barrel auto-turret (plan.md C10/E2) - the whole
		body/barrel assembly aims together, driven by the shared AI class exactly like a tank's
		own mouse input would (Dominator.ts's tick(): idle spins `positionData.angle` by
		`ai.passiveRotation`, engaged sets `inputs.mouse` at the target via `aimAtTarget()` and
		the tank turns straight onto it - both instant, no turn-rate limiter, the same as this
		file's other idle-spin bosses and Player.js's own autoDir lead). Setting `this.dir`
		directly here (rather than a per-cannon `canDir` override) is what makes TanksConfig.js's
		now-auto-less cannons (offdir 0, or i x PI/4 for the Trapper variant) aim/fire correctly
		regardless of variant, and is also exactly what a sandbox-cycled human already gets for
		free - their own mousemove packet writes `this.dir` the same way.
	*/
	if (this.DETEC && this.DETEC.select) {
		const other = this.DETEC.select;
		const dis = Math.sqrt(Math.pow(this.x - other.x, 2) + Math.pow(this.y - other.y, 2)) || 1;
		this.dir = Math.atan2(other.y + other.vec.y * dis / AUTOTURRET_LEAD - this.y, other.x + other.vec.x * dis / AUTOTURRET_LEAD - this.x);
		this.inputs.e = 1;
	} else {
		this.dir += tick.perTick(0.01212);
		this.inputs.e = 0;
	}
	this.shoot();
}

/*
	Shared by every real diep boss (plan.md X1/X3) - diepcustom's own AI.findTarget()
	(`Entity/AI.ts`), which is a plain "nearest live entity on another team inside `ai.viewRange`"
	scan and nothing more. AbstractBoss sets `ai.viewRange = 2000` du, so BOSS_VIEW_RANGE below is
	that x 0.56.

	This REPLACES an inherited screen-shaped, level-scaled, hull-relative heuristic
	(`sqrt(dx^2 + (dy/0.5625)^2) x outside / level < target.screen / 30`) that had no diep
	counterpart and, at its own numbers, only ever fired at point-blank range for a low-level
	target: a level-1 tank had to be within ~47 units of the boss's hull to register at all. That
	is why bosses appeared to just sit there - they were not idle by design, they simply never
	found anybody. `detected` is sorted nearest-first, so `detected[0]` is diep's `closestEntity`.

	Defender is the one boss that never calls this at all (diepcustom: `ai.viewRange = 0`, it
	never aggros - its mounted turrets find their own targets through the ordinary
	CLASS.DETEC/autoDir mechanism every ordinary auto-turret tank already uses).
*/
function bossDetect(boss) {
	boss.detected = [];
	for (const p of boss.room.INSTANCE.players.live()) {
		if (p === boss || p.destroy || p.dead || !p.alpha || p.boss || p.dominator) { continue; }
		if (p.dev && (p.dev.god || p.dev.ghost)) { continue; }
		if (boss.room.rules.teamPlay && p.team === boss.team) { continue; }
		const dx = p.x - boss.x, dy = p.y - boss.y;
		const d2 = dx * dx + dy * dy;
		if (d2 > BOSS_VIEW_RANGE * BOSS_VIEW_RANGE) { continue; }
		boss.detected.push(p);
	}
	if (boss.detected.length > 1) {
		boss.detected.sort((a, b) =>
			((a.x - boss.x) ** 2 + (a.y - boss.y) ** 2) - ((b.x - boss.x) ** 2 + (b.y - boss.y) ** 2));
	}
}

/*
	diepcustom AI.tick()'s two outcomes, applied to an entity this engine drives through
	`inputs` instead of an `Inputs` object shared with its barrels:

	  target  -> `inputs.flags |= leftclick` and `aimAtTarget()` writes `inputs.mouse` to the
	             target's own position.
	  no target -> flags cleared, and the mouse keeps spinning at radius 100 around the owner
	             (`passiveRotation`), which is what makes an idle boss's drones drift in a slow
	             ring rather than converge on the boss itself.

	Setting the MOUSE is the load-bearing half and was missing entirely. A drone reads its owner's
	`inputs.mouse_x/mouse_y` every tick (entities/Bullet.js's droneSteer1) as an offset from the
	owner, so an AI boss whose mouse stayed at (0,0) aimed its whole swarm at its own centre - the
	Fallen Overlord and Mothership "just sit there" report. `inputs.e` is this engine's own
	"trigger held" flag, the same one shoot() reads.
*/
function aiAimInputs(ent, target) {
	if (target) {
		ent.dir = Math.atan2(target.y - ent.y, target.x - ent.x);
		ent.inputs.mouse_x = target.x - ent.x;
		ent.inputs.mouse_y = target.y - ent.y;
		ent.inputs.e = 1;
		return;
	}
	ent.inputs.e = 0;
	const a = Math.atan2(ent.inputs.mouse_y || 0, ent.inputs.mouse_x || 1) + tick.perTick(PASSIVE_ROTATION);
	ent.inputs.mouse_x = Math.cos(a) * PASSIVE_MOUSE_RADIUS;
	ent.inputs.mouse_y = Math.sin(a) * PASSIVE_MOUSE_RADIUS;
}

/*
	The BOSS_ACCEL/BODY_FRICTION integrator every boss shares (see bossMotionSummoner()'s own long
	comment for why BODY_FRICTION and not the tank's 10/11 - that reasoning is unchanged; only the
	magnitude and the position step's own scale are diep's now). `angle` is the direction to
	thrust this tick; pass null to just decay/clamp with no new thrust (a stationary boss, or one
	that just reached a patrol corner and has nothing to add this tick). `mult` scales BOSS_ACCEL,
	which IS AbstractBoss's own default `movementSpeed` of 0.5 - so `mult` is just diep's
	per-class movementSpeed divided by that default: 2 for Fallen Booster's own literal 1, and
	0.4 for Defender's 0.2, both straight out of their diepcustom class files.
*/
function bossThrust(boss, angle, mult = 1) {
	if (angle !== null) {
		const motion = new Vec(BOSS_ACCEL * mult, 0).rotate(angle);
		boss.vec.add(motion);
	}
	boss.vec.x *= BODY_FRICTION;
	boss.vec.y *= BODY_FRICTION;
	boss.x += boss.vec.x;
	boss.y += boss.vec.y;
	if (boss.x < -boss.map.width / 2) { boss.x = -boss.map.width / 2; boss.vec.x = 0; }
	if (boss.y < -boss.map.height / 2) { boss.y = -boss.map.height / 2; boss.vec.y = 0; }
	if (boss.x > boss.map.width / 2) { boss.x = boss.map.width / 2; boss.vec.x = 0; }
	if (boss.y > boss.map.height / 2) { boss.y = boss.map.height / 2; boss.vec.y = 0; }
}

/*
	diepcustom AbstractBoss's own BossMovementControl (plan.md X1): patrol between the four
	quadrant targets (3/4 of the way to each corner), advancing to the next once within 300 du
	(168 units) of the current one - ported faithfully for WHICH corner and WHEN to advance (the
	travel speed itself is bossThrust()'s own BOSS_ACCEL, see that function's comment).
	Returns the direction actually driven this tick (radians), or null on the tick it switches
	corners (diepcustom adds no movement input that tick either - `target` becomes the delta only
	AFTER the distance check, so a corner-switch tick coasts on whatever velocity already existed).
*/
function bossPatrol(boss, mult = 1) {
	if (boss.patrolTarget === undefined) {
		boss.patrolTarget = boss.x >= 0 && boss.y >= 0 ? 0 : boss.x <= 0 && boss.y >= 0 ? 3 : boss.x <= 0 && boss.y <= 0 ? 2 : 1;
	}
	const hw = boss.map.width / 2, hh = boss.map.height / 2;
	const corners = [
		{ x: hw * 3 / 4, y: hh * 3 / 4 },
		{ x: hw * 3 / 4, y: -hh * 3 / 4 },
		{ x: -hw * 3 / 4, y: -hh * 3 / 4 },
		{ x: -hw * 3 / 4, y: hh * 3 / 4 },
	];
	const t = corners[boss.patrolTarget];
	const dx = t.x - boss.x, dy = t.y - boss.y;
	if (dx * dx + dy * dy < 168 * 168) {
		boss.patrolTarget = (boss.patrolTarget + 1) % 4;
		bossThrust(boss, null);
		return null;
	}
	const angle = Math.atan2(dy, dx);
	bossThrust(boss, angle, mult);
	return angle;
}

// The death-animation guard every boss update() shares (Summoner's own, unchanged) - a
// destroy>1 boss is mid-deletion-animation, coasting on its last velocity and shrinking, and
// must not run its own AI/shoot() while doing so.
function bossDeleting(boss) {
	boss.hit = Math.max(0, boss.hit - 1);
	if (boss.destroy > 1) {
		boss.x += boss.vec.x;
		boss.y += boss.vec.y;
		boss.destroy -= 1;
		boss.alpha = (boss.destroy - 1) / DES;
		boss.size *= tick.drag(1.04869);   // one-time-rescaled from 1.04 (33ms ref)
		return true;
	}
	return false;
}

// diepcustom AbstractBoss.ts:204 (plan.md Part D) - a flat maxHP/25000 regen every tick,
// unconditional (no hyper-regen gate, no 30s no-damage delay like an ordinary tank - a boss
// heals continuously regardless of recent damage). Every boss update() calls this once it knows
// it is not mid-deletion-animation (bossDeleting() already returned false).
function bossRegen(boss) {
	if (boss.hp < boss.maxHp) {
		boss.hp = Math.min(boss.maxHp, boss.hp + tick.perTick(boss.maxHp / 25000));
	}
}

function bossMotionSummoner() {
	bossDetect(this);
	// Aim/trigger from the scan (aiAimInputs()), then keep the passive body spin on top - a
	// Summoner's own body rotation is independent of where its spawners are pointing.
	aiAimInputs(this, this.detected[0]);
	this.dir += tick.perTick(0.01212);   // one-time-rescaled from 0.01 (33ms ref)
	const dis = Math.sqrt((this.x * this.x) + (this.y * this.y)) * 2.2;
	// Summoner's own scripted wander toward/away from the arena centre - it has no diep
	// counterpart to be faithful to (diep has no Summoner boss), so only the SPEED it wanders at
	// is diep's now (BOSS_ACCEL, via bossThrust below); which way it points is still ours.
	const angle = Math.atan2(this.y, this.x) - Math.PI * Math.min(1, (dis / this.map.width));
	// BODY_FRICTION, not the tank's 10/11, and this is the deliberate call plan.md
	// step 2 asked for rather than a leftover. Two reasons, in order of weight:
	//
	// 1. NOTHING PINS A TANK'S F TO THIS ENTITY. F = 10/11 is derived from ONE
	//    identity, physics.html's V_max = 10 x A, and that is stated for a steered
	//    tank under player input. diep's own bosses are not steered tanks: AbstractBoss
	//    rides the same universal 0.9 every other body does, which is exactly what
	//    BODY_FRICTION is - so this is now a positive citation, not just an absence.
	// 2. THIS IS NOT THE TANK INTEGRATOR AND NEVER WAS. rooms/Room.js's
	//    createBoss() does `b.motion = spec[0].bind(b)`, i.e. this function
	//    REPLACES Player.prototype.motion() outright, so a boss never reaches
	//    Physics.stepBody.
	//
	// Its aimed/shooting behaviour is untouched either way - the boss's
	// second bound function only calls this same motion() and shoot().
	bossThrust(this, angle);
	if (this.DETEC) { this.DETEC.reset(); }
}
function bossUpdateSummoner() {
	if (bossDeleting(this)) { return; }
	bossRegen(this);
	this.xp = this.prize;
	this.motion();
	if (this.detected.length || Math.random() < BOSS_SHOOT_CHANCE) {
		this.up.BPene = this.detected.length * .9;
		this.shoot();
	}
}

// diepcustom Guardian.ts: no ai.viewRange override (AbstractBoss's default 2000 du applies),
// real quadrant-corner patrol, and moveAroundMap() overridden to face whichever direction it is
// actually driving - a charging arrow, not a passive spinner.
function bossMotionGuardian() {
	bossDetect(this);
	aiAimInputs(this, this.detected[0]);
	// Guardian.moveAroundMap() faces wherever it is DRIVING, target or no target - so the patrol
	// heading wins over aiAimInputs()'s own `dir` write, unlike Fallen Booster below. Its drones
	// still aim at the target regardless: they read `inputs.mouse`, not the hull's facing.
	const angle = bossPatrol(this);
	if (angle !== null) { this.dir = angle; }
}

// diepcustom Defender.ts: ai.viewRange = 0 (never aggros/moves toward anything - moveAroundMap()
// is never overridden to steer at all, so it just sits and patrols nowhere), passiveRotation x2.
// Its three mounted "turrets" and three trap launchers are ordinary autoDir/auto cannons
// (TanksConfig.js's own CLASS.DETEC), so this needs no target-finding of its own at all.
function bossMotionDefender() {
	// Never populated by a real scan (see the comment above) - kept as an always-empty array,
	// not left undefined, so anything that reads any boss's `.detected` generically (client UI,
	// other tests) doesn't have to special-case this one boss that never aggros.
	this.detected = [];
	this.dir += tick.perTick(0.01212) * 2;
	// Still decays/clamps against `this.vec` (bossThrust(this, null)) rather than leaving it
	// unintegrated - a Defender is not literally immovable (diep gives it AbstractBoss's default
	// absorbtionFactor 0.05, not Dominator's 0, so a very heavy hit still nudges it a little) and
	// a `vec` that only ever accumulates knockback impulses without ever decaying or being
	// applied would be a silent state leak, not faithfulness to "it doesn't move".
	bossThrust(this, null);
}
function bossUpdateDefender() {
	if (bossDeleting(this)) { return; }
	bossRegen(this);
	this.xp = this.prize;
	this.motion();
	// No boss-level gate (Summoner/Guardian's `detected.length || random<BOSS_SHOOT_CHANCE`) -
	// every cannon here is already auto:1/autoShoot:1 and finds its own target (or simply always
	// fires, for the trap launchers) through the ordinary shoot() pipeline.
	this.shoot();
}

// diepcustom FallenOverlord.ts: real quadrant-corner patrol (moveAroundMap not overridden, same
// as the base AbstractBoss), passive spin from tick()'s own `positionData.angle += passiveRotation`
// (Summoner's own rate, tick.perTick(0.01212), reused - diep's own AI.passiveRotation has no
// number captured for this codebase to convert, same "no table entry" gap as the boss drone
// weight/push stand-ins on this class's own TanksConfig.js entry).
function bossMotionFallenOverlord() {
	bossDetect(this);
	// FallenOverlord.ts keeps its passive body spin (`positionData.angle += passiveRotation`)
	// whether or not it has a target - the DRONES do the aiming, off `inputs.mouse`, which is what
	// aiAimInputs() writes, so the spin below deliberately overwrites `dir` again.
	aiAimInputs(this, this.detected[0]);
	bossPatrol(this);
	this.dir += tick.perTick(0.01212);
}

// diepcustom FallenBooster.ts: movementSpeed 1 (2x AbstractBoss's default 0.5, bossThrust()'s
// own `mult` param) - here pushed to FALLEN_BOOSTER_MULT instead (see that constant's own
// derivation comment): a level-cap Booster's own max-MSpeed top speed, on request. Idle (nothing
// detected) - the same quadrant patrol as Guardian, facing its own movement; engaged (something
// detected) - steers and faces straight at the nearest one, diepcustom's own AI-driven chase
// (`positionData.angle = atan2(mouse - self)`, the AI's own chosen target standing in for
// `ai.inputs.mouse`).
function bossMotionFallenBooster() {
	bossDetect(this);
	aiAimInputs(this, this.detected[0]);
	if (this.detected.length) {
		// FallenBooster.ts's own moveAroundMap() override: with a target it stops patrolling and
		// DRIVES at it (AI.aimAtTarget() sets `inputs.movement` toward the mouse, magnitude 1),
		// facing it the whole way - aiAimInputs() has already pointed `dir` there. This branch
		// never actually ran before: bossDetect() found nobody, so a Booster only ever patrolled,
		// which is the "it should be moving, not just shooting" report.
		bossThrust(this, this.dir, FALLEN_BOOSTER_MULT);
	} else {
		const angle = bossPatrol(this, FALLEN_BOOSTER_MULT);
		if (angle !== null) { this.dir = angle; }
	}
}

// Shared by Fallen Overlord/Fallen Booster - identical to bossUpdateSummoner() minus
// the Summoner-only `up.BPene` balance hack (no diep basis, plan.md X3 - the new bosses' `pene`
// columns are already diep-derived and baked into their own TanksConfig.js cannons, so up.BPene
// stays at its ordinary default-1 identity multiplier instead).
function bossUpdateGeneric() {
	if (bossDeleting(this)) { return; }
	bossRegen(this);
	this.xp = this.prize;
	this.motion();
	if (this.detected.length || Math.random() < BOSS_SHOOT_CHANCE) {
		this.shoot();
	}
}

/*
	Guardian's own update (issues.md "guardian doesn't seem to spawn enough drones") - identical to
	bossUpdateGeneric() above except `shoot()` is called EVERY tick, unconditionally, instead of
	being gated behind `this.detected.length || Math.random() < BOSS_SHOOT_CHANCE`.

	That gate made sense for a boss whose ONLY way to fire is off a detected target (Summoner's own
	`up.BPene` scaling reads `this.detected.length` directly), but Guardian's spawner is `auto: 1`
	and self-targeting (`type: 3.1`) - it already has its OWN reload clock inside shoot() and does
	not need `detected` to fire at all. Gating the whole shoot() call on top of that meant a
	Guardian with nobody in its BOSS_VIEW_RANGE only actually rolled its reload timer forward on
	~30% of ticks (BOSS_SHOOT_CHANCE), so its real spawn rate collapsed toward ~30% of the intended
	8/sec (TanksConfig.js's `reload: 5.4` x this class's maxed `up.Reload` = exactly 8/sec when
	shoot() runs every tick) whenever it was idle - which is most of the time in an empty arena, and
	exactly the reported symptom. Scoped to Guardian only, not lifted onto Fallen Overlord/Fallen
	Booster's shared bossUpdateGeneric() above, since neither of those was reported broken and each
	still benefits from the same "only bother rolling the dice once something is nearby" idle
	behaviour Summoner also keeps.
*/
function bossUpdateGuardian() {
	if (bossDeleting(this)) { return; }
	bossRegen(this);
	this.xp = this.prize;
	this.motion();
	this.shoot();
}

const CONFIG = {
		'BOTS': [
			function () {
				if (isNaN(this.path)) {
					this.path = CONFIG.BOT_PATHS[Math.floor(Math.random() * CONFIG.BOT_PATHS.length)]
				}
				// BOT_UPS is indexed by points already SPENT (stillLvl), so it is a build order:
				// entry 0 is the first point this bot will ever spend. upgrade() is the thing that
				// knows whether a point is available (entities/Player.js's pointsAtLevel gate), so
				// calling it unconditionally is correct and the old `if (this.stillLvl)` guard was
				// not: at stillLvl 0 it is false, so a bot could only ever start upgrading once
				// something *else* had moved stillLvl - which, before PENDING #30, was the level-18
				// takeback. Bots therefore spent nothing at all until level 18 and skipped entry 0
				// forever. The takeback is gone, so this guard would now mean "never upgrade".
				this.upgrade(CONFIG.BOT_UPS[this.path.up ? this.path.up : 0][this.stillLvl]);
				// On gaining a shield, aim the bot a random way once. A shielded bot stands
				// still (below) and never updates its dir, so every fresh spawn would otherwise
				// face hard right (the constructor's dir=0). The flag clears when the shield
				// drops, so a re-shield (e.g. the admin 'shield' command) re-randomises.
				if (this.shield) {
					if (!this.shieldFaced) {
						this.dir = this.autoDir = Math.random() * 2 * Math.PI;
						this.shieldFaced = 1;
					}
				} else {
					this.shieldFaced = 0;
				}
				if (this.shield && this.xp < 25000) {
					this.shield--;
					this.inputs.e = 0;
					return;
				}
				this.upClass(this.path.class[this.classLvl]);
				if (!this.DETEC) {
					this.DETEC = new Detector(this, this.x, this.y, this.screen / 2, [KIND.PLAYER, KIND.OBJECTS, KIND.BULLET], 0, 1)
					this.DETEC.team = this.team;
				} else {
					this.DETEC.size = this.screen / 2;
					this.DETEC.x = this.x;
					this.DETEC.y = this.y;
				};
				if (!this.botMod) {
					this.botMod = 'search';
				} else {
					const all = this.DETEC.selectAll;
					if (all[KIND.OBJECTS].length + all[KIND.PLAYER].length + all[KIND.BULLET].length > 0 && !this.running) {
						const tresh = CONFIG.botThreshold;
						let farm = 0, run = 0, attack = 0;
						farm = Math.min(all[KIND.OBJECTS].length, 5) / tresh.farm
						for (const obj of all[KIND.BULLET]) {
							const dis = this.screen / Math.sqrt(Math.pow(this.x - obj.x, 2) + Math.pow(this.y - obj.y, 2))
							run += obj.pene * obj.damage * dis;
						}
						for (const obj of all[KIND.PLAYER]) {
							const dis = this.screen / Math.sqrt(Math.pow(this.x - obj.x, 2) + Math.pow(this.y - obj.y, 2))
							run += obj.hp * dis * obj.damage / tresh.playerRun;
						}
						run /= this.hp * Math.max(1, this.level / 10) * tresh.run;
						// select is 0 until something is in the cone, and 0 has no `kind`
						if (this.DETEC.select.kind === KIND.PLAYER) {
							const other = this.DETEC.select;
							attack += Math.min(Math.pow(other.xp / tresh.attackxpBase, 1.4), tresh.attackxpMax) / tresh.attackxpDivide * Math.max(1, this.level / other.level) * (1 / (1 + other.hp / tresh.attackHp)) * (1 / (1 + this.DETEC.dis / tresh.attackDis)) * this.hp / tresh.attack;
						}
						this.run = run;
						this.attack = attack;
						this.farm = farm;
						if (run >= attack && run > tresh.minRun) {
							if (run >= farm) {
								this.botMod = 'run';
							} else {
								this.botMod = 'farm';
							}
						} else if (farm >= attack) {
							this.botMod = 'farm';
						} else {
							this.botMod = 'attack';
						}
						if (run + attack + farm <= 0) {
							this.botMod = 'search';
						}
					} else {
						if (!this.running) {
							this.botMod = 'search';
						}
					}
				}
				///
				if (this.botMod === 'run') {
					if (this.running) {
						this.running--;
					} else {
						this.running = 10;
					}
				}
				///
				if (this.spin && Math.random() <= BOT_SPIN_FLIP_CHANCE) {
					this.spin = -this.spin;
				}
				let dir = 0;
				let len = Physics.moveAccel(this.up.MSpeed, this.level);
				this.inputs.e = 1;
				switch (this.botMod) {
					case 'farm': {
						this.spin = 0;
						let oldDis = this.screen;
						let selected = 0;
						for (const obj of this.DETEC.selectAll[KIND.OBJECTS]) {
							const dis = Math.sqrt(Math.pow(this.x - obj.x, 2) + Math.pow(this.y - obj.y, 2) * 2);
							if (dis < oldDis) {
								oldDis = dis;
								selected = obj;
							}
						};
						if (!selected) { break; }
						if (oldDis > CONFIG.botThreshold.farmDis * len + this.size + selected.size) {
							dir = Math.atan2(selected.y - this.y, selected.x - this.x);
							this.autoDir = dir;
						} else {
							this.autoDir = Math.atan2(selected.y - this.y, selected.x - this.x);
							len = 0;
						}
						break;
					};
					case 'run': {
						let med = 0;
						let x = 0;
						let y = 0;
						for (const bull of this.DETEC.selectAll[KIND.BULLET]) {
							const dis = this.screen / Math.sqrt(Math.pow(this.x - bull.x, 2) + Math.pow(this.y - bull.y, 2) * 2) / CONFIG.botThreshold.runDis;
							med += bull.pene * bull.damage * dis;
							x += bull.x * bull.pene * bull.damage * dis;
							y += bull.y * bull.pene * bull.damage * dis;
						};
						for (const bull of this.DETEC.selectAll[KIND.PLAYER]) {
							const dis = this.screen / Math.sqrt(Math.pow(this.x - bull.x, 2) + Math.pow(this.y - bull.y, 2) * 2) / CONFIG.botThreshold.runDis;
							med += bull.hp / CONFIG.botThreshold.runHp * bull.damage * dis;
							x += bull.x * bull.hp / CONFIG.botThreshold.runHp * bull.damage * dis;
							y += bull.y * bull.hp / CONFIG.botThreshold.runHp * bull.damage * dis;
						};
						if (!med) {
							dir = Math.PI - this.autoDir;
							break;
						}
						y /= med;
						x /= med;
						if (!this.spin) {
							this.spin = Math.sign(Math.random() * 10 - 5);
						}
						const dis = Math.sqrt(Math.pow(this.x - x, 2) + Math.pow(this.x - x, 2));
						this.autoDir = Math.atan2(y - this.y, x - this.x);
						dir = Math.PI + this.autoDir;
						dir += this.spin * Math.PI * Math.min(1, Math.sqrt(dis / this.screen)) / 1.9;
						break;
					};
					case 'attack': {
						if (!this.spin) {
							this.spin = Math.sign(Math.random() * 10 - 5);
						}
						const other = this.DETEC.select;
						const dis = Math.sqrt(Math.pow(this.x - other.x, 2) + Math.pow(this.y - other.y, 2));
						this.autoDir = Math.atan2(other.y + other.vec.y * dis / AUTOTURRET_LEAD - this.y, other.x + other.vec.x * dis / AUTOTURRET_LEAD - this.x);
						const dir = this.spin * Math.PI * Math.min(1, 100 / dis) / 2.5 + this.autoDir;
						break;
					};
					case 'search':
					default: {
						if (!this.spin) {
							this.spin = Math.sign(Math.random() * 10 - 5);
						}
						const dis = Math.sqrt((this.x * this.x) + (this.y * this.y));
						dir = Math.atan2(this.y, this.x);
						dir -= Math.PI * Math.min(1, (dis / this.map.width));
						this.autoDir = dir;
						this.inputs.e = 0;
						break;
					};
				}
				this.dir = Math.atan2(
					Math.sin(this.dir) + (Math.sin(this.autoDir) - Math.sin(this.dir)) * BOT_TURN_RATE,
					Math.cos(this.dir) + (Math.cos(this.autoDir) - Math.cos(this.dir)) * BOT_TURN_RATE
				);
				// this.name = this.botMod+' '+parseInt(this.farm*100)+' '+parseInt(this.attack*100)+'
				// '+parseInt(this.run*100)
				///
				dir = Math.atan2(Math.sin(dir), Math.cos(dir));
				const tresh = Math.PI / 3;
				const vdir = dir + Math.PI;
				const hdir = Math.abs(dir);
				const motion = new Vec(0, 0);
				if (Math.abs(Math.PI * .5 - vdir) <= tresh) { motion.y -= len; }
				if (Math.abs(Math.PI * 1.5 - vdir) <= tresh) { motion.y += len; }
				if (Math.abs(Math.PI - hdir) <= tresh) { motion.x -= len; }
				if (hdir <= tresh) { motion.x += len; }
				let ax = 0, ay = 0;
				if (motion.length() > 0) {
					const a = motion.norm().multiply(new Vec(len, len));
					ax = a.x; ay = a.y;
					if (this.alpha < 1) {
						// `stealth.moving` (plan.md T3) - this bot motion() override mirrors
						// Player.js's own move-regrow; decay/shoot-regrow still run through the
						// shared Player.prototype.update()/shoot(), so the same tick order makes
						// `.stealth` safe to read unguarded here too.
						this.alpha += Math.min(1, tick.perTick(CLASS[this.class].stealth.moving));
					}
					if (this.shield) {
						this.shield = 0;
					}
				}
				///
				{
					const body = { x: this.x, y: this.y, vx: this.vec.x, vy: this.vec.y };
					Physics.stepBody(body, ax, ay, tick.SCALE);
					this.x = body.x; this.y = body.y;
					this.vec.x = body.vx; this.vec.y = body.vy;
				}
				///
				// Bots are Players too - same OOB margin as a human's motion().
				if (this.x < -this.map.width / 2 - config.OOB_MARGIN) {
					this.x = -this.map.width / 2 - config.OOB_MARGIN;
					this.vec.x = 0;
				};
				if (this.y < -this.map.height / 2 - config.OOB_MARGIN) {
					this.y = -this.map.height / 2 - config.OOB_MARGIN;
					this.vec.y = 0;
				};
				if (this.x > this.map.width / 2 + config.OOB_MARGIN) {
					this.x = this.map.width / 2 + config.OOB_MARGIN;
					this.vec.x = 0;
				};
				if (this.y > this.map.height / 2 + config.OOB_MARGIN) {
					this.y = this.map.height / 2 + config.OOB_MARGIN;
					this.vec.y = 0;
				};
				if (this.DETEC) {
					this.DETEC.reset();
				}
				if (this.size <= 0) { this.inputs.e = 0; }
				//this.inputs.c = 1;
			}
		],
		'BOT_NAMES': './botNames.js',
		'BOT_PATHS': [
			{
				class: ['Twin', 'Triple Shot', 'Triplet'],
			},
			{
				class: ['Twin', 'Triple Shot', 'Penta Shot'],
			},
			{
				class: ['Twin', 'Quad Tank', 'Octo Tank'],
			},
			{
				class: ['Twin', 'Quad Tank', 'Cyclone']
			},
			{
				class: ['Sniper', 'Trapper', 'Fortress'],
			},
			{
				class: ['Sniper', 'Assassin', 'Ranger'],
				up: 1
			},
			{
				// Was ['Sniper', 'Assassin', 'Sprayer'] - Sprayer moved off Assassin onto
				// Machine Gun in plan.md T1's tree rewrite (diep has no Assassin->Sprayer edge),
				// so this path is retargeted to Assassin's other real child rather than left
				// pointing at an edge that no longer exists (upClass() would silently no-op on
				// the third evolution and strand the bot on Assassin).
				class: ['Sniper', 'Assassin', 'Stalker'],
				up: 1
			},
		],
		/*
			Build orders, indexed by points spent. 33 entries each, and no stat may appear more
			than 7 times - both are the diep economy PENDING #30 adopted (they were 27 entries
			against a 6-point cap). The six trailing entries per row are new and finish each build
			along its own existing bias rather than introducing a stat it never wanted: a stat that
			is already at 7 is silently refused by upgrade(), which would strand the point.
		*/
		'BOT_UPS': [
			[1, 3, 4, 3, 1, 4, 3, 3, 3,
				2, 2, 1, 6, 6, 3, 4, 2, 1,
				2, 6, 1, 1, 0, 0, 7, 2, 1,
				3, 4, 4, 4, 4, 6],
			///SNIPER
			[1, 1, 3, 3, 4, 4, 2, 2, 2,
				2, 3, 4, 2, 3, 4, 1, 1, 4,
				1, 1, 3, 3, 4, 0, 0, 0, 4,
				2, 2, 1, 3, 0, 0]
		],
		'botThreshold': {
			farm: 300,
			attack: 11,
			attackHp: 20,
			attackDis: 15,
			attackxpBase: 90,
			attackxpDivide: 45000,
			attackxpMax: 45000,
			run: 350,
			playerRun: 9,
			minRun: .012,
			runHp: 60,
			stand: 50,
			runDis: 1,
			farmDis: 700
		},
		///
		'BOSS': [
			[
				bossMotionSummoner,
				bossUpdateSummoner,
				'Summoner'
			],
			[
				bossMotionGuardian,
				bossUpdateGuardian,
				'Guardian'
			],
			[
				bossMotionDefender,
				bossUpdateDefender,
				'Defender'
			],
			[
				bossMotionFallenOverlord,
				bossUpdateGeneric,
				'Fallen Overlord'
			],
			[
				bossMotionFallenBooster,
				bossUpdateGeneric,
				'Fallen Booster'
			],
		],
		/*
			Tag's win-condition NPC (PENDING #28, rooms/Tag.js's createCloser()/startClosing()).
			Same [motion, update, className] shape as BOSS above, bound onto a fresh Player the
			same way - see rooms/Tag.js for why it is a Player rather than a new entity kind.

			No steering/turn-rate: diep gives it no tank body to be faithful to, and
			diep_wiki/Arena Closer.txt's "immediately go after players" and "ramming into them"
			reads as relentless, not maneuvered. Retargets every tick (cheapest correct choice -
			Tag's whole roster is at most 30ish live players, an O(n) scan every tick is nothing
			next to the base-drone detector work every other mode already does per tick) rather
			than latching onto one target until it dies, so a closer always chases whoever is
			nearest right now.
		*/
		'CLOSER': [
			[
				function () {
					let best = null, bestD = Infinity;
					for (const p of this.room.INSTANCE.players.live()) {
						if (p.boss || p.closer || p.destroy || p.dead) { continue; }
						// Anything on the arena's own team is furniture, not prey - which in practice
						// means an UNCAPTURED Dominator, since a Closer is now on that same team
						// (rules.neutralTeam; diep gives both `relationsData.team = arena`). The moment
						// a Dominator is captured its team becomes its captors', and this stops
						// skipping it - no separate "is it captured" check needed anywhere.
						if (p.team === this.team) { continue; }
						const dx = p.x - this.x, dy = p.y - this.y;
						const d = dx * dx + dy * dy;
						if (d < bestD) { bestD = d; best = p; }
					}
					this.target = best;
					if (best) {
						this.dir = Math.atan2(best.y - this.y, best.x - this.x);
						this.x += Math.cos(this.dir) * CLOSER_SPEED;
						this.y += Math.sin(this.dir) * CLOSER_SPEED;
					} else {
						// Nothing left alive to chase - drift like an idle polygon rather than
						// freeze in place. diep_wiki: "they'll be spinning and slowly drifting in
						// a random direction" once every target is dead; this settles toward a
						// stop rather than drifting forever, a simplification worth flagging since
						// nobody is left in the room to notice either way by the time it applies.
						this.dir += tick.perTick(0.01212);
						this.vec.x *= BODY_FRICTION;
						this.vec.y *= BODY_FRICTION;
						this.x += this.vec.x / 10;
						this.y += this.vec.y / 10;
					}
					if (this.x < -this.map.width / 2) { this.x = -this.map.width / 2; }
					if (this.y < -this.map.height / 2) { this.y = -this.map.height / 2; }
					if (this.x > this.map.width / 2) { this.x = this.map.width / 2; }
					if (this.y > this.map.height / 2) { this.y = this.map.height / 2; }
				},
				function () {
					this.hit = Math.max(0, this.hit - 1);
					this.motion();
					// `inputs.e` drives the fire decision now, not a class-table `auto` flag
					// (plan.md C10) - TanksConfig.js's Arena Closer cannon is otherwise an
					// ordinary barrel, so a sandbox-cycled human fires it with their own click
					// instead of it being stuck permanently auto-firing. shoot() still runs every
					// tick regardless (matches every other class - it is the reload timer's own
					// clock, not just the trigger).
					this.inputs.e = this.target ? 1 : 0;
					this.shoot();
				},
				'Arena Closer'
			],
		],
		'PETS': [
			function (play) {
				this.showDir = Math.atan2((play.y + play.inputs.mouse_y) - this.y, play.x + play.inputs.mouse_x - this.x)
				if (!this.delay) {
					const dir = Math.random() * Math.PI * 2;
					this.pos = {
						x: Math.cos(dir) * (play.size * 2),
						y: Math.sin(dir) * (play.size * 2)
					};
					this.delay = 20 + Math.floor(Math.random() * 150);
				} else {
					this.delay -= 1;
				}
				////
				// 2.475 is 3 one-time-rescaled from the 33ms reference
				// (3*33/40), a reference-tick count in shape - but it is deliberately NOT run
				// through tick.lead(), for the same reason AUTOTURRET_LEAD above is now flat.
				// play.vec is already a real-tick velocity that is itself close to TICK_MS-invariant
				// (verified numerically), so multiplying it by a further SCALE-adjusted divisor is
				// what would introduce a step-rate dependency, not remove one - confirmed by testing
				// both forms across TICK_MS 16/25/33/40: the raw multiply used here stays within
				// ~6% across that range, tick.lead(2.475) varies the result by 2x+.
				this.dir = Math.atan2(play.y + play.vec.y * 2.475 + this.pos.y - this.y, play.x + play.vec.x * 2.475 + this.pos.x - this.x);   // 3 one-time-rescaled
				// Both terms carry entities/Bullet.js's SPEED_RESCALE (1.6) because the thrust below
				// is now tick.quadratic() - .6 one-time-rescaled against the pet's own friction
				// (PET_FRICTION, not global FRICTION) x 1.6, and play.vec / 16 x 1.6 = / 10.
				this.speed = 0.873504 + play.vec.length() / 10;
				////
				// tick.quadratic(), not tick.perTick(): added every tick and then integrated into
				// position again - the same double integration entities/Bullet.js's motion tail
				// documents. The pet's follow distance at the live TICK_MS is unchanged.
				this.vec.add(new Vec(tick.quadratic(this.speed), 0).rotate(this.dir))
				this.vec.x *= PET_FRICTION;
				this.vec.y *= PET_FRICTION;
				this.x += this.vec.x;
				this.y += this.vec.y;
			}
	]
};
CONFIG.BOT_NAMES = require(CONFIG.BOT_NAMES).name;
// Same [motion, update, className] shape as CONFIG.BOSS/CONFIG.CLOSER above - one entry per
// cannon variant (public/SHARE/TanksConfig.js's "Destroyer Dominator"/"Gunner Dominator"/
// "Trapper Dominator"), all three sharing the identical motion/update function references since
// nothing about the AI itself differs between variants, only the cannon table it fires through.
CONFIG.DOMINATOR = [
	[dominatorMotion, dominatorUpdate, 'Destroyer Dominator'],
	[dominatorMotion, dominatorUpdate, 'Gunner Dominator'],
	[dominatorMotion, dominatorUpdate, 'Trapper Dominator']
];

/*
	Mothership (plan.md G1/X1/E3/E4's own scaffolding) - a stationary-until-piloted Player
	spawned by rooms/Mothership.js's createMothership(), the same rebind-at-spawn pattern as
	CONFIG.BOSS/CONFIG.CLOSER/CONFIG.DOMINATOR above. Unpossessed, it idle-spins and only fires
	when its own DETEC (TanksConfig.js's Mothership entry) finds a live enemy - the same target-
	or-idle shape dominatorUpdate() already uses, not "always attacking" (the old `auto:1` baked
	onto every cannon, which also blocked a pilot from ever holding fire - plan.md E3 retires it).
	Possessed (H-key piloting, plan.md E4), it moves and aims/fires exactly like an ordinary tank
	under its pilot's own inputs - unlike a Dominator, nothing stops a Mothership from moving
	(Mothership.ts has no `ai.movementSpeed = 0` override), so Player.prototype.motion() runs for
	real here instead of the idle-spin/no-op every other scripted entity in this file uses.
*/
function mothershipMotion() {
	if (this.pilotedBy) {
		this.inputs.w = this.pilotedBy.inputs.w; this.inputs.a = this.pilotedBy.inputs.a;
		this.inputs.s = this.pilotedBy.inputs.s; this.inputs.d = this.pilotedBy.inputs.d;
		this.inputs.arrw = this.pilotedBy.inputs.arrw; this.inputs.arrs = this.pilotedBy.inputs.arrs;
		this.inputs.arra = this.pilotedBy.inputs.arra; this.inputs.arrd = this.pilotedBy.inputs.arrd;
		Player.prototype.motion.call(this);
		return;
	}
	this.dir += tick.perTick(0.01212);
	bossThrust(this, null);
}
function mothershipUpdate() {
	this.hit = Math.max(0, this.hit - 1);
	// Unlike a Dominator (which never truly dies - dominatorCapture() always resets `destroy`
	// back to 0) or a Closer (invincible), a Mothership IS genuinely killable, and this update()
	// binding fully replaces Player.prototype.update() - the death-animation countdown that
	// lives there for an ordinary tank has to be reproduced here too, or a "dead" Mothership
	// (destroy set by the ordinary, unmodified collision() arm on hp<=0) would sit frozen at
	// its post-death `destroy` value forever, never reaching the 1 rooms/Room.js's own INSTANCE
	// sweep waits for, while still moving/aiming/firing every tick in the meantime. Force-ejects
	// its pilot too (plan.md E4) - nothing left to fly once it's gone.
	if (this.destroy > 1) {
		if (this.pilotedBy) { this.room.releasePossession(this.pilotedBy); }
		this.x += this.vec.x;
		this.y += this.vec.y;
		this.destroy -= 1;
		this.alpha = (this.destroy - 1) / DES;
		this.size *= tick.drag(1.1);   // diep's own DeletionAnimation.scale(1.1), Object.ts (plan.md C1)
		return;
	}
	if (this.destroy === 1) { return; }   // awaiting removal - nothing left to update
	if (this.pilotedBy) {
		// Mothership's own 5-minute possession clock (plan.md E3/E4, Mothership.ts's
		// possessionStartTick) - Dominator possession has no equivalent, see dominatorUpdate().
		const elapsed = this.room.timestamp - this.possessionStartTick;
		if (elapsed >= POSSESSION_TIMER) {
			const pilot = this.pilotedBy;
			this.room.releasePossession(pilot);
			pilot.mess.push('Your time piloting the Mothership is up');
		} else {
			if (!this.possessionWarned && elapsed >= POSSESSION_WARN_AT) {
				this.possessionWarned = true;
				this.pilotedBy.mess.push('You only have 10 seconds left in control of the Mothership');
			}
			// Mirrored, not a reference-swapped `inputs` object - same reasoning as
			// dominatorUpdate()'s own piloted branch (this entity's own `inputs` is what droneSteer1
			// reads live every tick via its own controllable drones' `play.inputs`, entities/
			// Bullet.js, plan.md E3's alternating canControlDrones).
			this.dir = this.pilotedBy.dir;
			this.inputs.e = this.pilotedBy.inputs.e;
			this.inputs.mouseL = this.pilotedBy.inputs.mouseL;
			this.inputs.mouseR = this.pilotedBy.inputs.mouseR;
			this.inputs.mouse_x = this.pilotedBy.inputs.mouse_x;
			this.inputs.mouse_y = this.pilotedBy.inputs.mouse_y;
			this.motion();
			this.shoot();
			return;
		}
	}
	this.motion();
	/*
		diepcustom's shared AI.tick(): idle when nothing's found (passive spin only, no firing),
		fires only once it actually has a target - the same shape dominatorUpdate() already uses.

		Two things were missing and between them a Mothership sat there doing nothing visible:

		1. IT NEVER AIMED ITS DRONES. Every one of its sixteen barrels is a drone spawner, and a
		   drone steers to its owner's `inputs.mouse_x/mouse_y` (entities/Bullet.js's droneSteer1)
		   whenever the owner is holding fire. Setting only `inputs.e` and `this.dir` left the
		   mouse at (0,0), i.e. the Mothership's own centre - so the whole swarm flew home and sat
		   on it instead of attacking. aiAimInputs() writes all three.
		2. ITS DETECTOR WAS NEVER RESET. Detector.collision() only ever REPLACES `select` on a
		   strictly closer find and never re-widens `dis`/`construc` on its own, so after the
		   first sighting the Mothership was latched onto that entity for good - including after
		   it died, since a respawn hands back a brand-new Player and leaves the old one's
		   `destroy` set forever. Reset per tick (the collision pass refills it before the next
		   update(), the same order every other DETEC consumer relies on) plus an explicit
		   liveness check, so a lost target is genuinely dropped and re-acquired.
	*/
	const sel = this.DETEC && this.DETEC.select;
	const target = (sel && !sel.destroy && !sel.dead && sel.alpha) ? sel : null;
	aiAimInputs(this, target);
	if (this.DETEC) { this.DETEC.reset(); this.DETEC.enabled = 1; }
	this.shoot();
}
CONFIG.MOTHERSHIP = [mothershipMotion, mothershipUpdate, 'Mothership'];

module.exports = CONFIG;
