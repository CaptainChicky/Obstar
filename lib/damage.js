/*
	diep's damage-multiplier table (diepcustom/src/Entity/Live.ts:46-51 defaults, TankBody.ts:100,
	AbstractShape.ts:79, Bullet.ts:92-93 - PENDING #18, plan.md step 5). Shared by entities/Player.js,
	entities/Bullet.js, entities/Objects.js and rooms/Room.js's own proration resolver, so the live
	per-tick subtraction inside collision() and the pre-collision estimate Room.js needs to prorate
	a pair's damage can never drift apart on the numbers.

	diep's own formula is common(a,b) = max(minA,minB) x min(maxA,maxB); every damage-taking pairing
	this tree resolves through this table pairs a tank or a shape (both minDamageMultiplier 1.0)
	against something, so max(minA,minB) is always 1 here - diep's other term only bites a
	bullet-vs-bullet pairing, which this engine resolves through a different, older mechanic entirely
	(entities/Bullet.js's own pene-vs-pene KIND.BULLET arm) that this table does not reach.

	TANK_TANK_MULT = min(6,6) = 6 - replaces the old TANK_BODY_DAMAGE=1.5, which used to multiply a
	`this.damage` that baked diep's vs-shape x4 in on its own; `this.damage` is diep's raw
	damagePerTick now (plan.md step 5), so the full x6 has to be written out here instead of derived
	as x1.5 more on top of an already-x4 base.
	TANK_SHAPE_MULT = min(6,4) = 4 - newly explicit for the same reason: the old code needed no
	multiplier at that site because `this.damage`'s baked-in x4 already WAS it.
	Tank-vs-bullet needs no constant at all: min(6,1) = 1, so `this.damage`'s raw value is already
	correct there with nothing multiplied in - retires PROJECTILE_BODY_DAMAGE at that one site (the
	old 0.25 applied to the x4-baked base is the same number as 1 applied to the un-baked one).

	PROJECTILE_BODY_DAMAGE is retired entirely (plan.md chunk 1 D2) - entities/Objects.js's own
	shape damage is diep's raw damagePerTick now too, un-baked the same way `this.damage` was above,
	so the one site that used to read the old constant (a shape's damage against a bullet,
	entities/Bullet.js's KIND.OBJECTS arm) needs no multiplier at all: common(shape,bullet) =
	max(1, 0.25) x min(4, 1) = 1.
*/
const TANK_TANK_MULT = 6;
const TANK_SHAPE_MULT = 4;

/*
	D2 (plan.md chunk 1): a shape's own `damage` (entities/Objects.js) is diep's raw damagePerTick
	now too - the baked-in x4 (common(tank,shape)) that used to live inside the field itself is gone,
	so every site consuming a shape's damage needs the same explicit common()-table treatment
	TANK_TANK_MULT/TANK_SHAPE_MULT already give tank/tank and tank/shape pairs.

	Shape-vs-bullet is common(shape,bullet) = max(1, 0.25) x min(4, 1) = 1 x 1 = 1 - i.e. no
	multiplier at all, so entities/Bullet.js's KIND.OBJECTS arm and Room.js's damageOutput() OBJECTS/
	BULLET case both just read a shape's `damage` as-is now. The retired PROJECTILE_BODY_DAMAGE=0.25
	was the same number applied to the old x4-baked field (0.25 x 4 = 1) - this is that identity
	written out explicitly instead of hidden in two different baked constants that had to be kept in
	sync by hand.
*/

/*
	The death threshold every hp/pene subtraction below tests against, and the value each one clamps
	to on crossing it - diep's own, `diepcustom/src/Entity/Live.ts:94` and `:110`, which guard
	receiveDamage() at BOTH ends (refuse to damage anything already under it; clamp to exactly 0 and
	fire onDeath the moment a subtraction lands under it). The port carried the proration half of
	diep's collision resolver (rooms/Room.js's dmgScale, from `Live.ts:83-85`) but dropped this half,
	and the two only work as a pair.

	Why a bare `hp <= 0` is not equivalent, i.e. what this actually fixes: proration deliberately
	sizes the killing blow to land EXACTLY on the dying side's remaining hp, and floating point does
	not deliver "exactly". Room.js computes `dObjToOther = perTick(damage * MULT)` then
	`scale = hp / dObjToOther`; the collision arm then subtracts `perTick(damage * MULT * scale)` -
	the same product with a different association, so the result differs from `hp` by an ulp in
	either direction. When it lands an ulp SHORT (measured: ~38% of plausible hp/damage pairs), hp
	settles at ~1e-16 instead of 0, and nothing ever kills it: next tick proration reads that
	residual as the binding health, collapses `scale` to ~1e-17, and - because ONE shared scale
	prorates BOTH directions - neither side takes damage any more. The shape reads as an empty
	health bar that ignores bullets, drones and ramming alike, and whatever is attacking it stops
	taking body damage too. High bullet penetration is what exposes it: a low-pene bullet dies
	first, making pene rather than the target's hp the binding side, so the target never reaches the
	stuck state; a maxed-pene bullet parks on the target indefinitely, and a ramming tank's own hp
	is never the smaller pool against a nearly-dead shape.

	0.0001 is diep's literal figure and drops in unconverted: hp here is on diep's own raw scale
	(a fresh spawn is 50, PENDING #17), and it is orders of magnitude below the smallest real
	quantity on either scale it guards - the finest live per-tick hit is ~1.5 hp and the smallest
	health pool is a Square's 10.
*/
const LETHAL_EPS = 0.0001;

/*
	D3+D4 (plan.md chunk 1): entities/Bullet.js's KIND.BULLET arm (bullet/drone-vs-bullet/drone) is
	the one pairing this tree does NOT resolve through common(a,b) above - it is diep's identical
	"3 laws" rule (Live.ts:handleCollision), just applied to a pene-vs-pene spend instead of an hp
	subtraction, so it needs the same min/maxDamageMultiplier lookup, keyed by OUR `type` field
	instead of a class hierarchy:

		Bullet (0) / Trap (2)                    minDamageMultiplier 0.25, max 1  (Bullet.ts:93-94)
		Drone (1 ordinary, 1.1 necro, 1.2/1.3     minDamageMultiplier 1,    max 1  (Drone.ts:77-78)
		battleship, 1.4 base drone)
		Necro square (3) / bigCheese (3.1)        minDamageMultiplier 1,    max 4  (NecromancerSquare.ts:48-49,
		                                                                            a claimed square - shape multipliers, not a drone's)

	Before this, every KIND.BULLET pair (including two ordinary bullets) resolved at an implicit x1 -
	right for any pairing that includes a drone (every combination above involving a 1/1/ pair still
	lands on 1), wrong for bullet-vs-bullet, which diep runs at common(bullet,bullet) =
	max(0.25,0.25) x min(1,1) = 0.25.
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
