/*
	The one movement integrator, shared by all three places that used to write it out by hand:
	entities/Player.js (server, humans), lib/gameAI.js (server, bots) and public/client/game.js
	(client input prediction). The client's copy used to be dimensionally wrong - it scaled its
	acceleration by tickLen once instead of tickLen^2, see PENDING #24 - which is fixed by having
	all three call the same integrator instead of each keeping their own copy.

	Dual-mode like the rest of public/SHARE/ (typeof(exports) footer copied from kinds.js, the
	simplest file in this directory), so it loads as a Node module on the server and as
	`window.Physics` in the browser.
*/
(function (exports) {

	// Per *reference tick* - config.REF_TICK_MS (40ms), not the server's
	// actual TICK_MS (25ms). lib/tick.js's SCALE = TICK_MS/REF_TICK_MS is what actually converts
	// these into a per-server-tick number, via stepBody's dtTicks below.
	//
	// FRICTION here is the TANK's friction - see the split note in the block below and in
	// lib/constants.js. Both of these are diep.io's own tank numbers, DERIVED rather than measured
	// or tuned, and MEASUREMENTS.md's "Do NOT measure these" table exists to stop them being
	// re-derived or "confirmed" against a real client:
	//
	//   FRICTION         physics.html states V_max = 10 x A for tanks. The steady state of the
	//                    recurrence v <- (v + A)*F is A*F/(1-F), so F/(1-F) = 10 and F = 10/11
	//                    EXACTLY, per 40ms loop. The 0.9091 PENDING #14 used to quote was a
	//                    rounded 10/11 the whole time.
	//   MOVE_ACCEL_BASE  diep's A0 = 2.58825 du/loop^2. The page gives top speed in both du/loop
	//                    (10A) and gu/s (5A), which at 25 loops/s forces 1 gu = 50 du in diep's
	//                    own units, so at our 28 units/gu A0 = 2.58825 * 28/50 = 1.449.
	//
	// The cross-check, and the thing to re-run if either is ever touched: base top speed is
	// 10 * 1.449 = 14.49 units per reference tick = 362.25 u/s, which is diep's 12.94 gu/s at
	// 28 units/gu. test/rooms.js's tickScaleTests() asserts that number at three tick rates.
	//
	// MOVE_STAT_MUL / MOVE_LEVEL_DIV are per-*point* and per-*level*, not per-tick, so neither
	// tick rate touches them.
	exports.FRICTION = 10 / 11;
	exports.MOVE_ACCEL_BASE = 1.449;

	/*
		Level and Movement Speed are independent multipliers on the base accel, diep's own form
		(PENDING #14). Both used to be additive terms on the same accel:

			base + 0.029254 * points - level / 155

		which is the load-bearing mismatch #14 measured, for two reasons that have nothing to do
		with the constants being off:

		1. THE TWO TERMS FOUGHT OVER ONE SUM. Maxing Movement Speed is supposed to buy back what
			 leveling costs. Additively it could not: a level-30 tank with all 6 points sat at 0.79x
			 a fresh spawn's speed, so the stat was a partial refund rather than a counterweight.
			 As independent multipliers it lands at 0.96x (1.07^6 / 1.015^30) - diep's own ratio at
			 the same level is 1.03x, and the remaining gap is entirely our 6-point stat cap against
			 diep's 7, not the form. (Those are the level-30/6-point figures this was written
			 against; since PENDING #30 the domain is diep's, so the ratio at the cap is
			 1.07^7 / 1.015^45 = 0.82x - diep's own endgame number, gap closed.)
		2. THE LEVEL TERM HAD NO FLOOR. `- level/155` reaches zero accel at level 54 and goes
			 negative after; only the 30-level cap was hiding it. A divisor cannot.

		THE MAGNITUDES ARE DIEP'S TOO NOW (plan.md step 2). MOVE_ACCEL_BASE went 0.511941 -> 1.449
		and FRICTION 0.956532 -> 10/11, so base top speed went 284 -> 362.25 u/s.

		What used to block that swap, written here as "FRICTION is global - entities/Bullet.js and
		entities/Objects.js decay through the same constant, so moving it rescales every bullet's
		top speed by 2.2x as a side effect", was a mis-framing of a real bug. diep does not model
		bullets with drag AT ALL: physics.html parameterises a bullet as V_b = rho/t_b, range over
		lifetime, with no drag term anywhere, and the V_max = 10 x A identity that pins F is stated
		for TANKS only. The shared constant was a *tank* recurrence being run on bullets.

		So the constant is split, and PENDING #14 is explicit that the split IS the faithful model
		rather than a workaround to dodge the cascade. FRICTION here is the tank's, and is the one
		that moved at this step; lib/constants.js's BODY_FRICTION kept the old 0.956532 at the time
		for everything diep does not model as a steered tank - bullets, traps, drones, shapes, and
		the Summoner boss's scripted drift - so all of those were bit-identical across this change.
		Do NOT collapse the two back into one constant - they still differ, just not for this
		reason any more: MEASUREMENTS.md's M1 is resolved (plan.md Step 9) and BODY_FRICTION has
		since moved to 0.9 (diep's own universal 10% drag, which DOES apply to bullets after all -
		M1's answer was the opposite of what this section predicted). The two constants remain
		split because they are applied in a different ORDER (nuance stated once in plan.md), not
		because BODY_FRICTION is still frozen at its Step-2 value.

		Recoil (`back`) and knockback (`weight`) are impulses on TANK velocity, so they follow this
		F and nothing M1 finds about bullets can move them. `back` was rescaled against this F in
		plan.md step 3 and is now `gu x 28 x (1-F)/F` = `gu x 2.8` exactly - so if F is ever edited
		again, public/SHARE/TanksConfig.js's whole `back` column has to be recomputed with it.
		`weight` has NOT been rescaled and is still under-scaled by roughly this F change; it is
		blocked on two human calls (PENDING #16).
	*/
	exports.MOVE_STAT_MUL = 1.07;    // per Movement Speed upgrade point
	exports.MOVE_LEVEL_DIV = 1.015;  // per level

	// Per-tick acceleration. `mspeedPoints` is a POINT COUNT (0-7 since PENDING #30), not a
	// pre-summed bonus - the
	// server keeps it in up.MSpeed, the client reads it off the wire's upNb.
	exports.moveAccel = function (mspeedPoints, level) {
		return exports.MOVE_ACCEL_BASE
			* Math.pow(exports.MOVE_STAT_MUL, mspeedPoints)
			/ Math.pow(exports.MOVE_LEVEL_DIV, level);
	};

	// Integrate one step of `dtTicks` reference ticks. Mutates {x, y, vx, vy}.
	// At dtTicks === 1 this is exactly what entities/Player.js did before this file existed:
	// vec.add(accel); vec *= FRICTION; x += vec  ==  vx = (vx + ax) * F; x += vx.
	exports.stepBody = function (body, ax, ay, dtTicks) {
		const f = (dtTicks === 1) ? exports.FRICTION : Math.pow(exports.FRICTION, dtTicks);
		body.vx = (body.vx + ax * dtTicks) * f;
		body.vy = (body.vy + ay * dtTicks) * f;
		body.x += body.vx * dtTicks;
		body.y += body.vy * dtTicks;
	};

})(typeof (exports) === 'undefined' ? function () { this['Physics'] = {}; return this['Physics'] }() : exports);
