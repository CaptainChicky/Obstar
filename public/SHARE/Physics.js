/*
	The one movement integrator, shared by server humans, bots, and client input prediction.

	Dual-mode like the rest of public/SHARE/: Node module on the server, window.Physics in the
	browser.
*/
(function (exports) {

	// Per reference tick (config.REF_TICK_MS, 40ms), not the server's actual TICK_MS.
	// Converted at each consumption site.
	//
	// FRICTION is the tank's friction. V_max = 10 x A, so F/(1-F) = 10 and F = 10/11.
	// MOVE_ACCEL_BASE is A0 = 1.449 (2.58825 du/loop^2 at 28 units/gu).
	// Base top speed: 10 * 1.449 = 14.49 units per reference tick = 362.25 u/s.
	// MOVE_STAT_MUL / MOVE_LEVEL_DIV are per-point and per-level, not per-tick.
	exports.FRICTION = 10 / 11;
	exports.MOVE_ACCEL_BASE = 1.449;

	/*
		Level and Movement Speed are independent multipliers on the base accel.
		Recoil (`back`) and knockback (`weight`) are impulses on tank velocity, so they
		follow this F. If F is edited, the whole `back` column has to be recomputed with it.
	*/
	exports.MOVE_STAT_MUL = 1.07;    // per Movement Speed upgrade point
	exports.MOVE_LEVEL_DIV = 1.015;  // per level

	// Per-tick acceleration. `mspeedPoints` is a point count, not a pre-summed bonus.
	exports.moveAccel = function (mspeedPoints, level) {
		return exports.MOVE_ACCEL_BASE
			* Math.pow(exports.MOVE_STAT_MUL, mspeedPoints)
			/ Math.pow(exports.MOVE_LEVEL_DIV, level);
	};

	// Integrate one step of `dtTicks` reference ticks. Mutates {x, y, vx, vy}.
	exports.stepBody = function (body, ax, ay, dtTicks) {
		const f = (dtTicks === 1) ? exports.FRICTION : Math.pow(exports.FRICTION, dtTicks);
		body.vx = (body.vx + ax * dtTicks) * f;
		body.vy = (body.vy + ay * dtTicks) * f;
		body.x += body.vx * dtTicks;
		body.y += body.vy * dtTicks;
	};

})(typeof (exports) === 'undefined' ? function () { this['Physics'] = {}; return this['Physics'] }() : exports);
