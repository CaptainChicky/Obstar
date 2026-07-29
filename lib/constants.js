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
	               for why it sits on this side). Deliberately still the hand-tuned 0.956532 the
	               shared constant carried, one-time-rescaled to the 40ms reference like every other
	               feel-tuned number, and deliberately its OWN literal rather than a factor of
	               TANK_FRICTION - nothing in any reference we have relates the two, so deriving one
	               from the other would invent a relationship. It moves when MEASUREMENTS.md's M1
	               observes whether diep's bullets carry drag at all, and not before.
*/
exports.TANK_FRICTION = require('../public/SHARE/Physics.js').FRICTION;
exports.BODY_FRICTION = 0.956532;
