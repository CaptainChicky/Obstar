/*
	Bot, boss and pet AI.

	These behaviour functions get bind()-ed onto entities at spawn time, so `this` inside
	them is the tank / boss / pet, not this module. Detector/Vec/BODY_FRICTION/CLASS are all leaves,
	none of them sitting on the entity/room/Controller dependency graph, so this is a plain
	module, not a factory - CONFIG is exported directly.
*/
const KIND = require('../public/SHARE/kinds.js');
const Physics = require('../public/SHARE/Physics.js');
const config = require('./config.js').config;
const Detector = require('../entities/Detector.js');
const Vec = require('victor');
const tick = require('./tick.js');
// The BOSS block's drift decays through this - NOT public/SHARE/Physics.js's tank FRICTION.
// Bots do NOT read it: they steer through Physics.stepBody like a human tank does, using the
// tank friction instead.
const BODY_FRICTION = tick.drag(require('./constants.js').BODY_FRICTION);
const CLASS = require('../public/SHARE/TanksConfig.js').class;
const DES = tick.DES;
// H-key piloting - Player.prototype.motion()'s ordinary WASD/Physics.stepBody
// integrator, reused for a piloted Mothership (a Dominator never moves either way, piloted or
// not - it has zero movement speed). entities/Player.js does not require this file (no cycle:
// gameAI.js sits below Player.js on the dependency graph, only rooms/Room.js requires both).
const Player = require('../entities/Player.js');
// POSSESSION_TIMER = tps x 60 x 5 (tps=25, 40ms tick) - 7500 reference ticks, 5 minutes.
// Dominator possession has no timer at all.
const POSSESSION_TIMER = tick.ticks(7500);
// The 10-second warning point, in the same reference-tick axis before conversion - 10
// tps-seconds = 250 reference ticks.
const POSSESSION_WARN_AT = tick.ticks(7500 - 250);

// A FLAT divisor, deliberately not run through tick.lead() - see entities/Player.js's identical
// copy for the derivation. Kept identical to Player.js's copy so bots and humans lead a moving
// target the same way rather than disagreeing.
const AUTOTURRET_LEAD = 15.84;
const BOT_SPIN_FLIP_CHANCE = tick.chance(0.00242);
/*
	How hard a boss drives, per reference tick squared. A boss adds `movement x movementSpeed` to
	velocity every tick and decays it with the SAME universal 0.9 friction everything else in this
	tree already uses (lib/constants.js's BODY_FRICTION), so terminal speed is 10 x the accel -
	140 u/s at movementSpeed 1 (bossThrust()'s `mult` of 2), 70 u/s at the default 0.5.
	bossThrust() integrates like every other non-tank body here (`v += A; v *= F; x += v`).

	tick.quadratic(), not tick.perTick(): added every tick and then integrated into position
	again, i.e. twice over ticks - the same category as entities/Bullet.js's cruise thrust.
	BULLET_CRUISE_ORDER is the friction-ORDER compensation that tail carries, for the same reason:
	the pre-friction velocity displaces at 10A and this order displaces the post-friction one (9A),
	a flat 10% that belongs at the site rather than inside the constant.
*/
const BOSS_ACCEL = tick.quadratic(0.5 * 0.56 * require('./constants.js').BULLET_CRUISE_ORDER);
/*
	Fallen Booster's own chase speed, deliberately pushed past its default movementSpeed of 1 (the
	plain `mult = 2` every other comment in this file cites): a design choice for it to close
	distance as fast as the single fastest thing a real tank can ever be - a level LEVEL_CAP
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

	Evaluates to ~4.168 today (~297.7 u/s, against the un-boosted mult=2's ~142.8 u/s) - a
	deliberate balance choice, not meant to be faithful to any reference figure; a Fallen Booster
	ramming at a capped tank's own max speed is the point.
*/
const FALLEN_BOOSTER_MULT = (() => {
	const bf = tick.drag(require('./constants.js').BODY_FRICTION);
	const bossUnitsPerSec1x = (BOSS_ACCEL * bf / (1 - bf)) / (config.TICK_MS / 1000);
	const F = Physics.FRICTION;
	const tankUnitsPerSec = (Physics.moveAccel(7, 45) * F / (1 - F)) / (config.REF_TICK_MS / 1000);
	return tankUnitsPerSec / bossUnitsPerSec1x;
})();
// "bosses will not target players under level 15 unless provoked" - mirrors
// config.BASE_DRONE_PROVOKE_MEMORY's own shape (a single oId + timestamp, entities/Bullet.js's
// base-drone provoke gate), reusing the same duration rather than inventing a second one.
const BOSS_PROVOKE_MEMORY = tick.ticks(config.BASE_DRONE_PROVOKE_MEMORY);
const BOT_TURN_RATE = tick.smoothing(0.35101);
const BOSS_SHOOT_CHANCE = tick.chance(0.48485);
// A plain view radius: no screen shaping, no level scaling, no hull subtraction.
const BOSS_VIEW_RANGE = 1120;
// Passive idle rotation rate (radians per reference tick) and the radius its idle mouse orbits
// the owner at - what a target-less boss's own drones drift around.
const PASSIVE_ROTATION = 0.01;
const PASSIVE_MOUSE_RADIUS = 100 * 0.56;
// Tag's Arena Closer - a flat per-tick position delta, not a thrust-into-velocity
// term, so tick.perTick() is the right category (see this file's BOSS_ACCEL comment for the
// opposite case). 24 units/REF_TICK = 600 u/s, picked to clear a fully-upgraded tank's own top
// speed with room to spare - escape from a Closer is meant to be virtually impossible.
const CLOSER_SPEED = tick.perTick(24);
// Pets brake twice as hard as everything else (1-fr = (1-BODY_FRICTION)*2, a design choice, not a
// tick-rate artifact) - treated as its own independent friction constant, recomputed (not
// one-time-rescaled) against BODY_FRICTION's current value so the 2x ratio holds exactly.
// A pet coasts like a body, it does not steer like a tank; do not derive this against the tank's
// own friction constant instead.
const PET_FRICTION = tick.drag(0.800796);

/*
	Domination's Dominator - a stationary Player, the same CONFIG.BOSS/CONFIG.CLOSER
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

	A Dominator only ever falls back to two priority tiers (players-including-bosses/closers,
	then objects) rather than three, since a boss/closer is itself a KIND.PLAYER instance here
	(flagged .boss/.closer) and DETEC's type-order bucketing does not split them out further.
	Left this way deliberately rather than hand-rolling a second search past the shared Detector -
	a boss/closer is rare enough that the distinction is unlikely to matter in a live match.
*/
// The neutral-Dominator team colour - SocketSchema's `color` table index 2, 'yellow'.
const DOMINATOR_NEUTRAL_TEAM = 2;
// How long a Dominator holds a target that has stopped dealing it damage before dropping it and
// re-scanning - 75 reference ticks = 3s at the 40ms reference.
const DOMINATOR_RETARGET_IDLE = tick.ticks(75);
// Mirrors entities/Player.js's own regen constants (same identical-copy convention as
// AUTOTURRET_LEAD above) - a Dominator's update() is fully replaced, so it cannot reach
// Player.prototype.update()'s regen block and reimplements it instead of sharing it.
const DOMINATOR_HYPER_REGEN_DELAY = tick.ticks(750);
const DOMINATOR_HYPER_REGEN_RATE = 1 / 250; // mirrors entities/Player.js's own HYPER_REGEN_RATE
/*
	Runs instead of the ordinary death path the moment `destroy` is set. collision()
	(entities/Player.js, unmodified - a Dominator takes damage exactly like any other Player)
	already spent this tick's hp/set `murder`/set `destroy` before update() ever runs, so this
	only has to read that and decide neutral-vs-flip rather than re-derive who hit it.
*/
function dominatorCapture() {
	// A flip force-ejects whoever's piloting it - the bullet purge below already existed for
	// exactly this event; the pilot just gets handed back their own (still-bleeding-until-this-
	// moment) tank instead of being left "flying" an entity that's about to reset team/HP out
	// from under them.
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
	// neutral -> the attacker's team (captured outright, one-knockdown rule); an
	// enemy team -> neutral first (the two-knockdown rule).
	if (killerTeam !== null && killerTeam !== this.team) {
		this.team = (this.team === DOMINATOR_NEUTRAL_TEAM) ? killerTeam : DOMINATOR_NEUTRAL_TEAM;
		for (const b of this.room.INSTANCE.bullets.live()) {
			if (b.origin && b.origin.oId === this.id.oId) { b.destroy = tick.DES; }
		}
		if (this.DETEC) { this.DETEC.reset(); this.DETEC.enabled = 1; }
		this.domIdle = 0;
		// Notify only once it actually lands on a real team (not the neutral-reset leg of the
		// two-knockdown rule, which has nobody to invite yet), so the whole team knows there's now
		// a claimable tank to pilot.
		if (this.team !== DOMINATOR_NEUTRAL_TEAM) {
			for (const p of this.room.INSTANCE.players.live()) {
				if (p.team === this.team && !p.bot && !p.dominator && !p.mothership) {
					p.mess.push('Press H to take control of the ' + this.class);
				}
			}
		}
	}
}
function dominatorMotion() { /* a Dominator cannot move */ }
function dominatorUpdate() {
	this.hit = Math.max(0, this.hit - 1);
	// "Cannot move" is enforced by dominatorMotion being a genuine no-op plus a zero absorption
	// factor: entities/Player.js's KIND.PLAYER collision arm skips both the knockback impulse and
	// the positional overlap push when the target is a Dominator, so nothing ever writes to x/y/
	// vec after spawn.
	if (this.destroy) { dominatorCapture.call(this); return; }
	// Weak regen - the same 0-Regen-point linear/hyper rates entities/Player.js uses at 0 points,
	// not a bespoke number.
	if (this.hp < this.lastHp) {
		this.noDamageTicks = 0;
	} else {
		this.noDamageTicks = Math.min((this.noDamageTicks || 0) + 1, DOMINATOR_HYPER_REGEN_DELAY);
	}
	if (this.hp < this.maxHp) {
		// Additive, not a replacement rate - mirrors entities/Player.js's own update().
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
		// Neutral cannot damage shapes or bosses - refusing the target outright is the simplest
		// correct statement of that rule, since a bullet that never fires at a shape/boss cannot
		// damage one either.
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
	// H-key piloting: a possessed Dominator aims/fires wherever its pilot does -
	// mirrored here (not a reference-swapped `inputs` object) so lib/gameAI.js's own AI branch
	// below picks back up cleanly the instant it releases, and so any later reader of this
	// entity's own `inputs` sees live values every tick, not just at claim time. A Dominator
	// itself never moves, piloted or not - only aim/fire redirect.
	if (this.pilotedBy) {
		this.dir = this.pilotedBy.dir;
		this.inputs.e = this.pilotedBy.inputs.e;
		this.inputs.mouseL = this.pilotedBy.inputs.mouseL;
		this.shoot();
		return;
	}
	/*
		A Dominator has no per-barrel auto-turret - the whole body/barrel assembly aims together,
		driven by the shared target the same way a tank's own mouse input would: idle spins `dir`
		by a fixed passive rate, engaged points straight at the target with no turn-rate limiter
		(the same as this file's other idle-spin bosses and Player.js's own autoDir lead). Setting
		`this.dir` directly here (rather than a per-cannon `canDir` override) is what makes
		TanksConfig.js's now-auto-less cannons (offdir 0, or i x PI/4 for the Trapper variant)
		aim/fire correctly regardless of variant, and is also exactly what a sandbox-cycled human
		already gets for free - their own mousemove packet writes `this.dir` the same way.
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
	Shared by every real boss: a plain "nearest live entity on another team inside
	BOSS_VIEW_RANGE" scan and nothing more. `detected` is sorted nearest-first, so
	`detected[0]` is the closest live candidate.

	Defender is the one boss that never calls this at all (its own view range is 0, it never
	aggros - its mounted turrets find their own targets through the ordinary CLASS.DETEC/
	autoDir mechanism every ordinary auto-turret tank already uses).
*/
function bossDetect(boss) {
	boss.detected = [];
	// A wide-FOV boss (piloted, or otherwise given a bigger screen) sees at least as far as its
	// own half-FOV; BOSS_VIEW_RANGE is only the floor for an ordinary boss.
	const R = Math.max(BOSS_VIEW_RANGE, (boss.screen || 0) / 2);
	for (const p of boss.room.INSTANCE.players.live()) {
		if (p === boss || p.destroy || p.dead || !p.alpha || p.boss || p.dominator) { continue; }
		if (p.dev && (p.dev.god || p.dev.ghost)) { continue; }
		if (boss.room.rules.teamPlay && p.team === boss.team) { continue; }
		// A sub-15 player is invisible to the boss's own target search until they provoke it
		// (Player.js's collision() marks boss.provoked/provokedAt on any hit the boss takes).
		if (p.level < 15 && !(boss.provoked === p.id.oId &&
			boss.room.timestamp - boss.provokedAt <= BOSS_PROVOKE_MEMORY)) { continue; }
		const dx = p.x - boss.x, dy = p.y - boss.y;
		const d2 = dx * dx + dy * dy;
		if (d2 > R * R) { continue; }
		boss.detected.push(p);
	}
	if (boss.detected.length > 1) {
		boss.detected.sort((a, b) =>
			((a.x - boss.x) ** 2 + (a.y - boss.y) ** 2) - ((b.x - boss.x) ** 2 + (b.y - boss.y) ** 2));
	}
}

/*
	Two outcomes for an AI-driven entity that fires through its own mouse position rather than
	a player's input:

	 target -> `inputs.e` set and the mouse points straight at the target's position.
	 no target -> `inputs.e` cleared, and the mouse keeps spinning at a fixed radius around the
	 owner, which is what makes an idle boss's drones drift in a slow ring rather than
	 converge on the boss itself.

	Setting the MOUSE is the load-bearing half. A drone reads its owner's `inputs.mouse_x/
	mouse_y` every tick (entities/Bullet.js's droneSteer1) as an offset from the owner, so an AI
	entity whose mouse stayed at (0,0) would aim its whole swarm at its own centre. `inputs.e` is
	this engine's own "trigger held" flag, the same one shoot() reads.
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
	The BOSS_ACCEL/BODY_FRICTION integrator every boss shares. `angle` is the direction to
	thrust this tick; pass null to just decay/clamp with no new thrust (a stationary boss, or one
	that just reached a patrol corner and has nothing to add this tick). `mult` scales BOSS_ACCEL,
	which IS the default movementSpeed of 0.5 for an ordinary boss - so `mult` is just a class's
	own movementSpeed divided by that default: 2 for Fallen Booster's own value of 1, and 0.4 for
	Defender's 0.2.
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
	Patrol between the four quadrant targets (3/4 of the way to each corner), advancing to the
	next once within 300 du (168 units) of the current one. The travel speed itself is
	bossThrust()'s own BOSS_ACCEL - see that function's comment. Returns the direction actually
	driven this tick (radians), or null on the tick it switches corners (no movement input is
	added that tick either, so a corner-switch tick coasts on whatever velocity already existed).
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

// The death-animation guard every boss update() shares - a destroy>1 boss is mid-deletion-
// animation, coasting on its last velocity and shrinking, and must not run its own AI/shoot()
// while doing so.
function bossDeleting(boss) {
	boss.hit = Math.max(0, boss.hit - 1);
	if (boss.destroy > 1) {
		boss.x += boss.vec.x;
		boss.y += boss.vec.y;
		boss.destroy -= 1;
		boss.alpha = (boss.destroy - 1) / DES;
		boss.size *= tick.drag(1.04869);
		return true;
	}
	return false;
}

// A flat maxHP/25000 regen every tick, unconditional (no hyper-regen gate, no 30s no-damage
// delay like an ordinary tank - a boss heals continuously regardless of recent damage). Every
// boss update() calls this once it knows it is not mid-deletion-animation (bossDeleting()
// already returned false).
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
	this.dir += tick.perTick(0.01212);
	const dis = Math.sqrt((this.x * this.x) + (this.y * this.y)) * 2.2;
	// Summoner's own scripted wander toward/away from the arena centre - a pure design choice,
	// only the SPEED it wanders at (BOSS_ACCEL, via bossThrust below) follows the shared boss
	// physics; which way it points is its own.
	const angle = Math.atan2(this.y, this.x) - Math.PI * Math.min(1, (dis / this.map.width));
	// BODY_FRICTION, not the tank's 10/11, deliberately. Two reasons:
	//
	// 1. NOTHING PINS A TANK'S FRICTION TO THIS ENTITY. That constant is derived from one
	// identity (V_max = 10 x A) stated for a steered tank under player input. A boss is not a
	// steered tank: it rides the same universal 0.9 every other body does, which is exactly
	// what BODY_FRICTION is.
	// 2. THIS IS NOT THE TANK INTEGRATOR. rooms/Room.js's createBoss() does
	// `b.motion = spec[0].bind(b)`, i.e. this function REPLACES Player.prototype.motion()
	// outright, so a boss never reaches Physics.stepBody.
	//
	// Its aimed/shooting behaviour is untouched either way - the boss's second bound function
	// only calls this same motion() and shoot().
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

// Real quadrant-corner patrol, facing whichever direction it is actually driving - a charging
// arrow, not a passive spinner.
function bossMotionGuardian() {
	bossDetect(this);
	aiAimInputs(this, this.detected[0]);
	// Faces wherever it is DRIVING, target or no target - so the patrol heading wins over
	// aiAimInputs()'s own `dir` write, unlike Fallen Booster below. Its drones still aim at the
	// target regardless: they read `inputs.mouse`, not the hull's facing.
	const angle = bossPatrol(this);
	if (angle !== null) { this.dir = angle; }
}

// Never aggros or moves toward anything (view range 0) - it just sits and patrols nowhere at
// double the passive spin rate. Its three mounted "turrets" and three trap launchers are
// ordinary autoDir/auto cannons (TanksConfig.js's own CLASS.DETEC), so this needs no
// target-finding of its own at all.
function bossMotionDefender() {
	// Never populated by a real scan (see the comment above) - kept as an always-empty array,
	// not left undefined, so anything that reads any boss's `.detected` generically (client UI,
	// other tests) doesn't have to special-case this one boss that never aggros.
	this.detected = [];
	this.dir += tick.perTick(0.01212) * 2;
	// Still decays/clamps against `this.vec` (bossThrust(this, null)) rather than leaving it
	// unintegrated - a Defender is not literally immovable (a heavy hit still nudges it a
	// little) and a `vec` that only ever accumulates knockback impulses without ever decaying or
	// being applied would be a silent state leak, not faithfulness to "it doesn't move".
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

// Real quadrant-corner patrol (same as the base pattern), passive spin at the shared
// Summoner-style rate.
function bossMotionFallenOverlord() {
	bossDetect(this);
	// Keeps its passive body spin whether or not it has a target - the DRONES do the aiming,
	// off `inputs.mouse`, which is what aiAimInputs() writes, so the spin below deliberately
	// overwrites `dir` again.
	aiAimInputs(this, this.detected[0]);
	bossPatrol(this);
	this.dir += tick.perTick(0.01212);
}

// Movement speed 2x the default (bossThrust()'s own `mult` param) - here pushed to
// FALLEN_BOOSTER_MULT instead (see that constant's own derivation comment): a level-cap
// Booster's own max-MSpeed top speed, on request. Idle (nothing detected) - the same quadrant
// patrol as Guardian, facing its own movement; engaged (something detected) - steers and faces
// straight at the nearest one, an AI-driven chase.
function bossMotionFallenBooster() {
	bossDetect(this);
	aiAimInputs(this, this.detected[0]);
	if (this.detected.length) {
		// With a target it stops patrolling and drives straight at it, facing it the whole way -
		// aiAimInputs() has already pointed `dir` there.
		bossThrust(this, this.dir, FALLEN_BOOSTER_MULT);
	} else {
		const angle = bossPatrol(this, FALLEN_BOOSTER_MULT);
		if (angle !== null) { this.dir = angle; }
	}
}

// Shared by Fallen Overlord/Fallen Booster - identical to bossUpdateSummoner() minus the
// Summoner-only `up.BPene` balance hack (the other bosses' `pene` columns are already baked
// into their own TanksConfig.js cannons, so up.BPene stays at its ordinary default-1 identity
// multiplier instead).
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
	Guardian's own update - identical to bossUpdateGeneric() above except `shoot()` is called
	EVERY tick, unconditionally, instead of being gated behind
	`this.detected.length || Math.random() < BOSS_SHOOT_CHANCE`.

	That gate makes sense for a boss whose only way to fire is off a detected target (Summoner's
	own `up.BPene` scaling reads `this.detected.length` directly), but Guardian's spawner is
	`auto: 1` and self-targeting (`type: 3.1`) - it already has its own reload clock inside
	shoot() and does not need `detected` to fire at all. Gating the whole shoot() call on top of
	that would mean a Guardian with nobody in its BOSS_VIEW_RANGE only rolls its reload timer
	forward on a fraction of ticks, collapsing its real spawn rate well below the intended rate
	whenever it is idle - which is most of the time in an empty arena. Scoped to Guardian only,
	not lifted onto Fallen Overlord/Fallen Booster's shared bossUpdateGeneric() above, since both
	of those still benefit from the "only bother rolling the dice once something is nearby" idle
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
				// calling it unconditionally is correct.
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
						// `stealth.moving` - this bot motion() override mirrors
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
				class: ['Sniper', 'Assassin', 'Stalker'],
				up: 1
			},
		],
		/*
			Build orders, indexed by points spent. 33 entries each, and no stat may appear more
			than 7 times - a stat already at 7 is silently refused by upgrade(), which would
			strand the point.
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
			Tag's win-condition NPC. Same [motion, update, className] shape as BOSS above, bound
			onto a fresh Player the same way - see rooms/Tag.js for why it is a Player rather than
			a new entity kind.

			No steering/turn-rate: it goes straight after the nearest player and rams them,
			relentlessly rather than maneuvered. Retargets every tick (cheapest correct choice -
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
						// means an UNCAPTURED Dominator, since a Closer is on that same neutral team.
						// The moment a Dominator is captured its team becomes its captors', and this
						// stops skipping it - no separate "is it captured" check needed anywhere.
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
						// freeze in place, settling toward a stop rather than drifting forever.
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
					// `inputs.e` drives the fire decision now, not a class-table `auto` flag -
					// TanksConfig.js's Arena Closer cannon is otherwise an ordinary barrel, so a
					// sandbox-cycled human fires it with their own click instead of it being stuck
					// permanently auto-firing. shoot() still runs every tick regardless (matches
					// every other class - it is the reload timer's own clock, not just the trigger).
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
				// A reference-tick count deliberately NOT run through tick.lead(), for the same reason
				// AUTOTURRET_LEAD above is flat: play.vec is already a real-tick velocity that is
				// itself close to TICK_MS-invariant, so multiplying it by a further SCALE-adjusted
				// divisor would introduce a step-rate dependency rather than remove one.
				this.dir = Math.atan2(play.y + play.vec.y * 2.475 + this.pos.y - this.y, play.x + play.vec.x * 2.475 + this.pos.x - this.x);
				// The pet's own thrust below is tick.quadratic(), so both terms here are scaled to
				// match: play.vec's contribution and the pet's own base speed both go through the
				// same conversion so the pet's follow distance stays consistent across tick rates.
				this.speed = 0.873504 + play.vec.length() / 10;
				////
				// tick.quadratic(), not tick.perTick(): added every tick and then integrated into
				// position again - the same double integration entities/Bullet.js's motion tail
				// documents.
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
	Mothership - a stationary-until-piloted Player spawned by rooms/Mothership.js's
	createMothership(), the same rebind-at-spawn pattern as CONFIG.BOSS/CONFIG.CLOSER/
	CONFIG.DOMINATOR above. Unpossessed, it idle-spins and only fires when its own DETEC
	(TanksConfig.js's Mothership entry) finds a live enemy - the same target-or-idle shape
	dominatorUpdate() already uses, not an unconditional auto-fire.
	Possessed (H-key piloting), it moves and aims/fires exactly like an ordinary tank
	under its pilot's own inputs - unlike a Dominator, nothing stops a Mothership from moving,
	so Player.prototype.motion() runs for real here instead of the idle-spin/no-op every other
	scripted entity in this file uses.
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
	// its pilot too - nothing left to fly once it's gone.
	if (this.destroy > 1) {
		if (this.pilotedBy) { this.room.releasePossession(this.pilotedBy); }
		this.x += this.vec.x;
		this.y += this.vec.y;
		this.destroy -= 1;
		this.alpha = (this.destroy - 1) / DES;
		this.size *= tick.drag(1.1);
		return;
	}
	if (this.destroy === 1) { return; } // awaiting removal - nothing left to update
	// Player.prototype.update() normally runs this; this binding replaces update() wholesale so
	// it has to be called explicitly, or up.HpRegan (set to 1 at spawn) is dead data.
	this.regenTick();
	if (this.pilotedBy) {
		// The Mothership's own 5-minute possession clock - a Dominator's possession has no
		// equivalent, see dominatorUpdate().
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
			// Bullet.js).
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
		Idle when nothing's found (passive spin only, no firing), fires only once it actually has
		a target - the same shape dominatorUpdate() already uses.

		Two things matter here:

		1. AIMING THE DRONES. Every one of its sixteen barrels is a drone spawner, and a drone
		 steers to its owner's `inputs.mouse_x/mouse_y` (entities/Bullet.js's droneSteer1)
		 whenever the owner is holding fire, so aiAimInputs() has to write all three
		 (dir/mouse_x/mouse_y) or the swarm flies home onto the Mothership's own centre instead
		 of attacking.
		2. RESETTING THE DETECTOR. Detector.collision() only ever REPLACES `select` on a strictly
		 closer find and never re-widens `dis`/`construc` on its own, so without a per-tick
		 reset the Mothership would latch onto its first sighting for good - including after it
		 died, since a respawn hands back a brand-new Player and leaves the old one's `destroy`
		 set forever. Reset per tick (the collision pass refills it before the next update(), the
		 same order every other DETEC consumer relies on) plus an explicit liveness check, so a
		 lost target is genuinely dropped and re-acquired.
	*/
	const sel = this.DETEC && this.DETEC.select;
	const target = (sel && !sel.destroy && !sel.dead && sel.alpha) ? sel : null;
	aiAimInputs(this, target);
	if (this.DETEC) { this.DETEC.reset(); this.DETEC.enabled = 1; }
	this.shoot();
}
CONFIG.MOTHERSHIP = [mothershipMotion, mothershipUpdate, 'Mothership'];

module.exports = CONFIG;
