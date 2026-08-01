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

	PROJECTILE_BODY_DAMAGE stays a real, live constant - entities/Objects.js's own shape damage
	figures are NOT diep-adopted yet (plan.md step 6 has that), so the one site still reading them (a
	shape's damage against a bullet, entities/Bullet.js's KIND.OBJECTS arm) keeps this until that
	step gives shapes the same baked-in-multiplier treatment `this.damage` gets here.
*/
const TANK_TANK_MULT = 6;
const TANK_SHAPE_MULT = 4;
const PROJECTILE_BODY_DAMAGE = 0.25;

module.exports = { TANK_TANK_MULT, TANK_SHAPE_MULT, PROJECTILE_BODY_DAMAGE };
