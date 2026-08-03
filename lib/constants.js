/*
	Engine constants shared across the split-out modules.

	THE TWO FRICTIONS ARE NOT INTERCHANGEABLE, AND MERGING THEM BACK IS NOT A SIMPLIFICATION.

	This file used to re-export one `FRICTION` and let entities/Bullet.js, entities/Objects.js and
	lib/gameAI.js all decay through it. That single constant was diep's *tank* recurrence being
	applied to things diep does not model as tanks: physics.html parameterises a bullet as
	V_b = rho/t_b - range over lifetime, with no drag term anywhere - and the V_max = 10 x A
	identity that pins the tank's F to exactly 10/11 is stated for tanks only. PENDING #14 says in
	as many words that splitting them IS the faithful model, not a workaround to dodge the cascade
	that moving one shared number would have caused (plan.md step 2).

	TANK_FRICTION  what a steered tank decays through, via public/SHARE/Physics.js's stepBody:
	               entities/Player.js's motion(), lib/gameAI.js's bots, and public/client/game.js's
	               input prediction, which all reach it through that integrator rather than through
	               this name. Exactly 10/11 per 40ms reference tick, derived (see Physics.js).
	               Re-exported here only so both halves of the split are visible in one place - if
	               you are writing new tank movement code, call Physics.stepBody, don't read this.

	BODY_FRICTION  what everything else decays through: bullets, traps, drones and shapes
	               (entities/Bullet.js, entities/Objects.js) and the Summoner boss's scripted drift
	               (lib/gameAI.js - a body, not a steered tank; see the comment at that call site
	               for why it sits on this side). MEASUREMENTS.md's M1 is resolved (plan.md Step 9):
	               diep applies a universal 10% per-tick drag to every ObjectEntity, including
	               bullets (diepcustom/src/Entity/Object.ts:274, corroborated by
	               diepindepth/physics/README.txt §3 - "all entities have a 10% friction rate").
	               That is F = 0.9 exactly, at the SAME 40ms reference this file's every other
	               constant is denominated against - no one-time-rescale needed, unlike the old
	               hand-tuned value it replaces. Still deliberately its OWN literal rather than a
	               factor of TANK_FRICTION - diep's own tank recurrence (Object.ts's
	               v+=A;x+=v;v*=0.9) and its bullet recurrence share the SAME 0.9 constant, but they
	               are applied in different ORDERS (nuance stated once in plan.md, "The friction
	               ordering difference" - our own TANK_FRICTION is 10/11, derived independently to
	               hold the same steady state under our different order), so the two still are not
	               algebraically the same number for a different reason than before.
*/
exports.TANK_FRICTION = require('../public/SHARE/Physics.js').FRICTION;
exports.BODY_FRICTION = 0.9;

/*
	THE OTHER HALF OF THE ORDERING NOTE ABOVE - the bullet's, which was missing.

	TANK_FRICTION is 10/11 rather than diep's 0.9 precisely because our integrators apply friction
	BEFORE the position step and diep's applies it after (`Object.ts:274-282`: `pos += v; v *= 0.9`,
	so what diep displaces each tick is the PRE-friction velocity). At diep's own order the steady
	displacement is `10 x A`; at ours it is `A x F/(1-F)`, and F = 10/11 is what makes those equal.

	entities/Bullet.js's motion tail runs the same our-order recurrence, on BODY_FRICTION = 0.9 -
	and never got the matching compensation, so every bullet in the game cruised at `A x 0.9/0.1`
	= 9A where diep cruises at 10A: a flat 10% shortfall on every projectile's top speed. The
	shortfall does not exist for the tank, which is why a Basic could outrun its own shot here and
	cannot in diep.

	Fixed at the one consumption site by scaling the thrust rather than by reordering the tail or by
	restating TanksConfig.js's whole `speed` column:
	  - Reordering would make the tail's steady speed noticeably TICK_MS-dependent (the un-decayed
	    thrust add rides along in the displacement, and that term does not scale linearly) - a 3.3%
	    spread across TICK_MS 25/33 against the current recurrence's 0.45%. Scaling the thrust
	    leaves the recurrence shape - and so test/rooms.js's bulletRangeInvarianceTest - untouched.
	  - Restating the column would cost its readability: `speed` is `1.12 x diep bullet.speed`
	    today, a stated identity, and every entry would become an unreadable `1.2444 x`.
	This is the same shape of correction public/SHARE/TanksConfig.js's `back` (recoil) column
	already carries in its own derivation - `gu x 28 x (1-F)/F` - applied to the other friction.

	BULLET_MAINTAIN is diep's `maintainVelocity()` factor (`Object.ts:268-270`: it adds
	`maxSpeed * 0.1` per tick, so the `maxSpeed` it is handed IS the resulting cruise speed).
	TanksConfig.js's `speed` column has that 0.1 already folded in, which is why recovering diep's
	own `bulletAccel` from a `speed` value is a divide by it - entities/Player.js's muzzle-kick
	site needs exactly that, since diep's launch impulse is written against the RAW `bulletAccel`.
*/
exports.BULLET_MAINTAIN = 0.1;
exports.BULLET_CRUISE_ORDER = (1 - exports.BODY_FRICTION) / (exports.BODY_FRICTION * exports.BULLET_MAINTAIN);

/*
	Wall contact physics (plan.md Step 12, PENDING #26's reopened "bullet contact is wrong" half) -
	entities/Player.js's and entities/Bullet.js's own `case KIND.WALL:` arms. WALL_BOUNCE/
	WALL_FRICTION - the old reflect-and-decay model, tuned by feel with no reference behind it -
	are RETIRED, not retuned: diepcustom's Object.ts:283-309 (`receiveKnockback`'s isSolidWall
	branch) gives a real diep Maze wall no bounce at all. A bullet/trap/drone (anything with an
	owner) is destroyed outright on contact; a tank sheds to a flat fraction of its own speed and
	gets shoved out along whichever axis the contact is more aligned with.
*/
// Object.ts:303 - `this.velocity.magnitude *= 0.3`. Dimensionless, applied directly to a live
// vec read (not a fresh magnitude), so it needs no tick.impulse()/tick.perTick() wrapping - the
// same reasoning WALL_BOUNCE used to carry (PENDING nuance 39).
exports.WALL_TANK_KEEP_SPEED = 0.3;
// Object.ts:287,305: kbMagnitude = tank.absorbtionFactor(1, diep's own default) x
// wall.pushFactor(2), then /= 0.3 for the isSolidWall branch = 6.667 du/ref-tick, x 0.56 =
// 3.7333... units/ref-tick. A one-shot-per-tick-of-contact velocity add, so it goes through
// tick.impulse() at its call site (this.vec routes through Physics.stepBody - see the `back`
// column's own comment in entities/Player.js).
exports.WALL_PUSH_OUT = 1 * 2 / 0.3 * 0.56;
// Batch E: the velocity expel above is diep-faithful, but a fast ram out-runs it for several
// ticks, so a tank could sink up to a whole grid cell into a wall before it bit (velocity-only,
// no positional constraint - unlike the shape arm in entities/Objects.js, which already snaps).
// diep keeps the residual overlap minimal (~1/10 of a maze cell); the tank arm now clamps its
// penetration to this fraction of the body radius so the overlap stays small. Dimensionless (a
// fraction of a live .size read), so no tick conversion - same category as WALL_TANK_KEEP_SPEED.
exports.WALL_TANK_OVERLAP = 0.1;
