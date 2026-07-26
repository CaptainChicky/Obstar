/*
	Reference-tick scaling (massplanchunks WP3).

	config.TICK_MS (25) is how often the server actually steps now - the finer rate diep.io
	itself runs at (PENDING #20). config.REF_TICK_MS (40) is the tick every raw gameplay constant
	in entities/, lib/gameAI.js and public/SHARE/TanksConfig.js is denominated against - not
	because the server ever ran at 40ms, but so diep's own per-40ms-loop numbers (recoil gu,
	knockback gu, reload loops) drop into this codebase unconverted, readable against the
	reference forever (PENDING #20's whole point).

	Those constants were previously tuned by feel against a *measured* ~29Hz tick before this
	pass (HANDOFF's old "TICK_MS is 33, don't fix it" note). Moving the reference from that
	measured 33ms to diep's clean 40ms is a one-time relabelling, not a balance change: every
	constant this file's callers read has already been multiplied through that 40/33 conversion
	at its source (TanksConfig.js, entities/, lib/gameAI.js) so real-world behaviour at TICK_MS 25
	is identical to what TICK_MS 33 against the old unconverted constants produced. Only the
	SCALE below (the actual TICK_MS/REF_TICK_MS runtime conversion) happens here, at every
	consumption site, once.

	A leaf module - no lib/runtime.js involvement, no circular-graph rule to worry about (HANDOFF
	§3) - so it is just require()'d, like public/SHARE/Physics.js.
*/
const config = require('./config.js').config;

// Computed once at module load: nothing needs Math.pow per entity per tick.
const SCALE = config.TICK_MS / config.REF_TICK_MS;

/* Anything added to a velocity/angle/accumulator once per reference tick: accelerations,
	 per-tick velocity additions, drift, rotation steps, recoil impulses, contact damage/knockback
	 (an "event" re-applied once per contact *step*, same shape as a per-tick add). */
function perTick(v) { return v * SCALE; }

/* Anything of the form `v *= k` once per reference tick - friction, drag. */
function drag(k) { return Math.pow(k, SCALE); }

/* A count of reference ticks - reload counters, life, DES, DEAD_DELAY, KEEP_PLACE, shield,
	 hit-flash frames, respawn timers - converted to a count of real ticks that spans the same
	 wall-clock duration. Floored at 1 so nothing becomes a same-tick no-op. */
function ticks(n) { return Math.max(1, Math.round(n / SCALE)); }

/* A per-reference-tick event probability (`if (Math.random() > .999)` and friends) - scaled so
	 the expected *wall-clock* rate of the event is unchanged. */
function chance(p) { return p * SCALE; }

/* hpregan-style accumulators that integrate twice over ticks (the accumulator itself grows
	 perTick, then is applied perTick again) - a single SCALE factor under- or over-shoots by
	 1/SCALE, so this needs SCALE squared instead. */
function quadratic(v) { return v * SCALE * SCALE; }

/* A lookahead expressed as a number of reference ticks (auto-turret aim lead, pet follow lead) -
	 grows as ticks get shorter even though the velocity it multiplies shrinks, so it divides by
	 SCALE rather than multiplying like perTick. Same transform as ticks(), without the integer
	 floor: a lead is a continuous multiplier, not a tick count. */
function lead(n) { return n / SCALE; }

/* Per-reference-tick exponential smoothing factor, rescaled the same way public/motion.js's
	 lerpK rescales a per-frame one. */
function smoothing(k) { return 1 - Math.pow(1 - k, SCALE); }

module.exports = {
	SCALE, perTick, drag, ticks, chance, quadratic, lead, smoothing,
	// Pre-converted once, not per call: config.DES/DEAD_DELAY/KEEP_PLACE are each read from
	// upwards of a dozen call sites across entities/ and lib/SlotMap.js, so those sites import
	// this real-tick count directly instead of each calling ticks(config.DES) themselves.
	DES: ticks(config.DES),
	DEAD_DELAY: ticks(config.DEAD_DELAY),
	KEEP_PLACE: ticks(config.KEEP_PLACE)
};
