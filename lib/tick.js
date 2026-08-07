/*
	Reference-tick scaling.

	config.TICK_MS (25) is how often the server actually steps. config.REF_TICK_MS (40) is the
	tick every raw gameplay constant in entities/, lib/gameAI.js and public/SHARE/TanksConfig.js
	is denominated against, so per-loop figures (recoil, knockback, reload counters) stay
	readable in their original units regardless of how finely the server samples the world.

	Only the SCALE below (the actual TICK_MS/REF_TICK_MS runtime conversion) happens here, at
	every consumption site, once.

	A leaf module - just require()'d, like public/SHARE/Physics.js.
*/
const config = require('./config.js').config;

// Computed once at module load: nothing needs Math.pow per entity per tick.
const SCALE = config.TICK_MS / config.REF_TICK_MS;

/* Anything added to a velocity/angle/accumulator once per reference tick: accelerations,
	 per-tick velocity additions, drift, rotation steps, contact damage (an "event" re-applied once
	 per contact *step*, same shape as a per-tick add).

	 Narrower than it looks, and easy to misuse: a ONE-SHOT velocity impulse added into a `vec`
	 whose own position step integrates that vec directly with no separate dtTicks multiply of
	 its own - entities/Bullet.js's muzzle kick / 'god' repulsion / collision knockback,
	 entities/Objects.js's collision knockback (both bodies do `x += vec.x` every real tick,
	 nothing else). There the SCALE factor perTick applies IS the tick-rate correction - it is
	 what keeps the impulse's total decayed-through-friction displacement finite and TICK_MS-
	 invariant, and dropping it would make the displacement diverge at fine tick rates instead of
	 vanish. See those files' call-site comments for the derivation.

	 Do NOT reach for perTick() for a one-shot impulse added into a vec that public/SHARE/
	 Physics.js's stepBody() ALSO re-scales by dtTicks on every subsequent position step
	 (entities/Player.js's recoil and collision knockback, which route through stepBody) - that
	 shape needs tick.impulse() below instead, or the impulse is scaled by dtTicks twice. */
function perTick(v) { return v * SCALE; }

/* A one-shot velocity impulse added directly into a body's `vec` where that body's position is
	 later stepped by public/SHARE/Physics.js's stepBody(), which turns vec into position via
	 `x += vx * dtTicks` on EVERY tick - so an impulse landing straight in vec is already in
	 reference-tick units by the time stepBody first reads it, and must go in FLAT. Wrapping it in
	 perTick() applies a second, spurious SCALE on top of stepBody's own dtTicks multiply, so the
	 impulse's total displacement (after friction decay) shrinks toward zero as the tick rate gets
	 finer instead of staying put. The only current consumers are entities/Player.js's recoil
	 (`back`) and its four collision knockbacks (including `weight`) - anything that reaches
	 Physics.stepBody, not entities/Bullet.js or entities/Objects.js's own hand-rolled tails,
	 which integrate vec into position directly and correctly keep perTick() for the same shape
	 of impulse (see perTick()'s own comment above). */
function impulse(v) { return v; }

/* Anything of the form `v *= k` once per reference tick - friction, drag. */
function drag(k) { return Math.pow(k, SCALE); }

/* A count of reference ticks - reload counters, life, DES, DEAD_DELAY, KEEP_PLACE, shield,
	 hit-flash frames, respawn timers - converted to a count of real ticks that spans the same
	 wall-clock duration. Floored at 1 so nothing becomes a same-tick no-op. */
function ticks(n) { return Math.max(1, Math.round(n / SCALE)); }

/* A per-reference-tick event probability (`if (Math.random() > .999)` and friends) - scaled so
	 the expected *wall-clock* rate of the event is unchanged. */
function chance(p) { return p * SCALE; }

/* Accumulators that integrate twice over ticks (the accumulator itself grows perTick, then is
	 applied perTick again) - entities/Bullet.js's cruise thrust and entities/Objects.js's HOME_PULL
	 are the current examples (their own comments have the derivation) - a single SCALE factor
	 under- or over-shoots by 1/SCALE, so this needs SCALE squared instead. */
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
	SCALE, perTick, impulse, drag, ticks, chance, quadratic, lead, smoothing,
	// Pre-converted once, not per call: config.DES/DEAD_DELAY/KEEP_PLACE are each read from
	// upwards of a dozen call sites across entities/ and lib/SlotMap.js, so those sites import
	// this real-tick count directly instead of each calling ticks(config.DES) themselves.
	DES: ticks(config.DES),
	DEAD_DELAY: ticks(config.DEAD_DELAY),
	KEEP_PLACE: ticks(config.KEEP_PLACE)
};
