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
	WALL_BOUNCE / WALL_FRICTION - the wall kind's contact physics (PENDING #2, wall-only slice,
	entities/Player.js's and entities/Bullet.js's own `case KIND.WALL:` arms). diep_wiki (PENDING
	#26) says a wall is solid, has friction while a tank grinds along it, and rebounds a fast
	impact - but gives no numbers for either. These are OURS, not diep's, on the same footing as
	Tag's invisibility floor: untuned, and due a real playtest pass once a Maze room exists to spawn
	a wall to hit.
*/
exports.WALL_BOUNCE = 0.4;      // fraction of inbound normal speed returned as rebound
exports.WALL_FRICTION = 0.85;   // per-reference-tick decay of the tangential (grinding) component
