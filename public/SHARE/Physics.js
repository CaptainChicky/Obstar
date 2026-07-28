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
	// MOVE_LEVEL_FALLOFF is a per-*level* falloff, not per-tick, so it is unaffected by either
	// tick and keeps its original value.
	exports.FRICTION = 0.956532;
	exports.MOVE_ACCEL_BASE = 0.511941;
	exports.MOVE_ACCEL_PER_UP = 0.029254;   // per Movement Speed upgrade point
	exports.MOVE_LEVEL_FALLOFF = 155;

	// Per-tick acceleration. `mspeedBonus` is the already-summed float the server keeps in
	// up.MSpeed; the client passes points * MOVE_ACCEL_PER_UP.
	exports.moveAccel = function (mspeedBonus, level) {
		return exports.MOVE_ACCEL_BASE + mspeedBonus - level / exports.MOVE_LEVEL_FALLOFF;
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
