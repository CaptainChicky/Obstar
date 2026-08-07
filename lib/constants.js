/*
	Engine constants shared across the split-out modules.

	THE TWO FRICTIONS ARE NOT INTERCHANGEABLE, AND MERGING THEM BACK IS NOT A SIMPLIFICATION.

	A bullet is parameterised by range over lifetime with no drag term, while a tank's steady
	speed identity (V_max = 10 x A, pinning F to exactly 10/11) is a tank-only relationship.
	Applying one shared friction constant to both categories is wrong for one of them no matter
	which value is picked - splitting them is the faithful model.

	TANK_FRICTION  what a steered tank decays through, via public/SHARE/Physics.js's stepBody:
	               entities/Player.js's motion(), lib/gameAI.js's bots, and public/client/game.js's
	               input prediction, which all reach it through that integrator rather than through
	               this name. Exactly 10/11 per 40ms reference tick, derived in Physics.js.
	               Re-exported here only so both halves of the split are visible in one place - if
	               you are writing new tank movement code, call Physics.stepBody, don't read this.

	BODY_FRICTION  what everything else decays through: bullets, traps, drones and shapes
	               (entities/Bullet.js, entities/Objects.js) and the Summoner boss's scripted drift
	               (lib/gameAI.js - a body, not a steered tank). A universal 10% per-tick drag
	               applied to every non-tank object, at the same 40ms reference every other
	               constant here is denominated against. Deliberately its own literal rather than
	               a factor of TANK_FRICTION - the tank and body recurrences share the same 0.9
	               drag constant but apply it in different ORDERS (see BULLET_CRUISE_ORDER below),
	               so the two are not algebraically the same number for a different reason than
	               their different roles alone would suggest.
*/
exports.TANK_FRICTION = require('../public/SHARE/Physics.js').FRICTION;
exports.BODY_FRICTION = 0.9;

/*
	THE OTHER HALF OF THE ORDERING NOTE ABOVE - the bullet's.

	TANK_FRICTION is 10/11 rather than the body's 0.9 precisely because our tank integrator
	applies friction BEFORE the position step while the body integrator applies it after (so what
	a body displaces each tick is its PRE-friction velocity). At the body's order the steady
	displacement is `10 x A`; at the tank's order it is `A x F/(1-F)`, and F = 10/11 is what
	makes those equal.

	entities/Bullet.js's motion tail runs the tank-style (pre-friction) recurrence, but on
	BODY_FRICTION = 0.9 without the matching compensation - so a bullet cruises at `A x 0.9/0.1`
	= 9A where the body-order recurrence would give 10A: a flat 10% shortfall on every
	projectile's top speed relative to a body-order model.

	Fixed at the one consumption site by scaling the thrust rather than by reordering the tail or
	restating public/SHARE/TanksConfig.js's whole `speed` column:
	  - Reordering would make the tail's steady speed noticeably TICK_MS-dependent (the un-decayed
	    thrust add rides along in the displacement, and that term does not scale linearly) - a
	    3.3% spread across TICK_MS 25/33 against the current recurrence's 0.45%. Scaling the
	    thrust leaves the recurrence shape - and so test/rooms.js's bulletRangeInvarianceTest -
	    untouched.
	  - Restating the column would cost its readability: `speed` is a stated multiple of a
	    reference value today, and every entry would become an unreadable decimal.
	This is the same shape of correction public/SHARE/TanksConfig.js's `back` (recoil) column
	already carries in its own derivation, applied to the other friction.

	BULLET_MAINTAIN is the fraction of max speed added back each tick to maintain cruise (so the
	`maxSpeed` handed to that step IS the resulting cruise speed). TanksConfig.js's `speed` column
	has that fraction already folded in, which is why recovering the raw launch acceleration from
	a `speed` value is a divide by it - entities/Player.js's muzzle-kick site needs exactly that.
*/
exports.BULLET_MAINTAIN = 0.1;
exports.BULLET_CRUISE_ORDER = (1 - exports.BODY_FRICTION) / (exports.BODY_FRICTION * exports.BULLET_MAINTAIN);

/*
	Wall contact physics - entities/Player.js's and entities/Bullet.js's own `case KIND.WALL:`
	arms. A bullet/trap/drone (anything with an owner) is destroyed outright on contact; a tank
	sheds to a flat fraction of its own speed and gets shoved out along whichever axis the
	contact is more aligned with. No bounce.
*/
// Dimensionless, applied directly to a live velocity read (not a fresh magnitude), so it needs
// no tick.impulse()/tick.perTick() wrapping.
exports.WALL_TANK_KEEP_SPEED = 0.3;
// A one-shot-per-tick-of-contact velocity add, so it goes through tick.impulse() at its call
// site (this.vec routes through Physics.stepBody - see the `back` column's own comment in
// entities/Player.js).
exports.WALL_PUSH_OUT = 1 * 2 / 0.3 * 0.56;
// The velocity expel above is correct in the steady state, but a fast ram out-runs it for
// several ticks, so a tank could sink deep into a wall before it bit (velocity-only, no
// positional constraint - unlike the shape arm in entities/Objects.js, which already snaps).
// This clamps how far a tank's collision may penetrate a wall to a fraction of its own body
// radius, keeping the overlap small. Dimensionless (a fraction of a live .size read), so no
// tick conversion - same category as WALL_TANK_KEEP_SPEED.
exports.WALL_TANK_OVERLAP = 0.1;

