/*
	Damage-multiplier table for tank/shape/bullet collisions. Shared by entities/Player.js,
	entities/Bullet.js, entities/Objects.js and rooms/Room.js's own proration resolver, so the
	live per-tick subtraction inside collision() and the pre-collision estimate Room.js needs to
	prorate a pair's damage can never drift apart on the numbers.

	The governing formula is common(a,b) = max(minA,minB) x min(maxA,maxB), where each side
	carries its own (minDamageMultiplier, maxDamageMultiplier) pair. A tank or a shape both use
	minDamageMultiplier 1.0, so max(minA,minB) is always 1 for any pairing that includes one -
	the min term only matters for bullet-vs-bullet, which is resolved separately below.

	TANK_TANK_MULT = min(6,6) = 6.
	TANK_SHAPE_MULT = min(6,4) = 4.
	Tank-vs-bullet needs no constant at all: min(6,1) = 1, so a bullet's raw damage applies
	unscaled. A shape's damage against a bullet also needs no multiplier:
	common(shape,bullet) = max(1, 0.25) x min(4, 1) = 1.
*/
const TANK_TANK_MULT = 6;
const TANK_SHAPE_MULT = 4;

/*
	The death threshold every hp/pene subtraction below tests against, and the value each one
	clamps to on crossing it: refuse to damage anything already at or under it, and clamp to
	exactly 0 (firing onDeath) the moment a subtraction lands under it.

	Why a bare `hp <= 0` check is not equivalent: proration deliberately sizes the killing blow
	to land EXACTLY on the dying side's remaining hp, and floating point does not deliver
	"exactly". Room.js computes `dObjToOther = perTick(damage * MULT)` then
	`scale = hp / dObjToOther`; the collision arm then subtracts
	`perTick(damage * MULT * scale)` - the same product with a different association, so the
	result can differ from `hp` by an ulp in either direction. When it lands an ulp short, hp
	settles at ~1e-16 instead of 0 and nothing ever kills it: the next tick's proration reads
	that residual as the binding health, collapses `scale` to ~1e-17, and - because one shared
	scale prorates BOTH directions - neither side takes damage any more. The shape reads as an
	empty health bar that ignores bullets, drones and ramming alike, and whatever is attacking it
	stops taking body damage too.

	0.0001 is orders of magnitude below the smallest real quantity on either scale it guards -
	the finest live per-tick hit is ~1.5 hp and the smallest health pool is a Square's 10.
*/
const LETHAL_EPS = 0.0001;

/*
	Bullet/drone-vs-bullet/drone (entities/Bullet.js's KIND.BULLET arm) is the one pairing this
	tree does NOT resolve through common(a,b) above - it applies the same min/max multiplier
	rule to a pene-vs-pene spend instead of an hp subtraction, keyed by our own `type` field:

		Bullet (0) / Trap (2)                          min 0.25, max 1
		Drone (1 ordinary, 1.1 necro, 1.2/1.3           min 1,    max 1
		battleship, 1.4 base drone)
		Necro square (3) / bigCheese (3.1)              min 1,    max 4  (a claimed square uses
		                                                                  shape multipliers, not
		                                                                  a drone's)

	Any pairing involving a drone lands on 1. Bullet-vs-bullet is the only case where the min
	term bites: common(bullet,bullet) = max(0.25,0.25) x min(1,1) = 0.25.
*/
function projectileMultiplier(type) {
	const t = parseInt(type);
	if (t === 1) { return { min: 1, max: 1 }; }
	if (t === 3) { return { min: 1, max: 4 }; }
	return { min: 0.25, max: 1 };
}
function projectileCommon(typeA, typeB) {
	const a = projectileMultiplier(typeA), b = projectileMultiplier(typeB);
	return Math.max(a.min, b.min) * Math.min(a.max, b.max);
}

module.exports = { TANK_TANK_MULT, TANK_SHAPE_MULT, LETHAL_EPS, projectileCommon };
