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

	// Per *reference tick* (33ms today - massplanchunks WP3 will wrap the consumers below in
	// lib/tick.js, not change these numbers).
	exports.FRICTION = 0.964;
	exports.MOVE_ACCEL_BASE = 0.35;
	exports.MOVE_ACCEL_PER_UP = 0.020;   // per Movement Speed upgrade point
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
