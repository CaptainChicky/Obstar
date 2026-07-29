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
	// These three were tuned by feel at the *old* reference (a measured ~29Hz/33ms tick) and have been
	// converted once, here, to mean the same real-world motion at
	// the new 40ms reference - a relabelling, not a retune, but NOT a plain linear rescale
	// (0.964^(40/33) for FRICTION is exact - drag scaling is - but ACCEL_BASE/PER_UP compound
	// with FRICTION into a bounded steady-state speed each tick, so scaling both by the same
	// naive 40/33 changes that steady state by ~17%. The correct factor was solved numerically
	// (binary search against the exact stepBody recurrence, verified to reproduce the old
	// 284 u/s base top speed to <1%): 1.462688, not 40/33's 1.212121.
	// MOVE_STAT_MUL / MOVE_LEVEL_DIV are per-*point* and per-*level*, not per-tick, so they are
	// unaffected by either tick rate.
	exports.FRICTION = 0.956532;
	exports.MOVE_ACCEL_BASE = 0.511941;

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
			 diep's 7, not the form.
		2. THE LEVEL TERM HAD NO FLOOR. `- level/155` reaches zero accel at level 54 and goes
			 negative after; only the 30-level cap was hiding it. A divisor cannot.

		The magnitudes are unchanged and deliberately so - MOVE_ACCEL_BASE and FRICTION still
		produce the same 284 u/s base top speed they did before this change. #14 also proposes
		replacing those two (base 1.449 / FRICTION 0.9091 at this 40ms reference, which is diep's
		12.94 gu/s and its v_max = 10 x A ratio exactly), but FRICTION is global - entities/Bullet.js
		and entities/Objects.js decay through the same constant via lib/constants.js - so moving it
		rescales every bullet's top speed by 2.2x as a side effect. #16 says how to re-derive the
		recoil column when that happens and nothing says how to re-derive the bullet `speed` column,
		which #23 lists as never measured in the first place. That swap is therefore still open;
		this change is only the form.
	*/
	exports.MOVE_STAT_MUL = 1.07;    // per Movement Speed upgrade point
	exports.MOVE_LEVEL_DIV = 1.015;  // per level

	// Per-tick acceleration. `mspeedPoints` is a POINT COUNT (0-6), not a pre-summed bonus - the
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
