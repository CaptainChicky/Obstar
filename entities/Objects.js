/*
	Objects - the farmable polygons (squares, triangles, pentagons).

	Extracted from the old Alex.js monolith (now server.js + lib/ + rooms/ + entities/).
	An Objects instance only ever collides with a bullet from its own room, so it holds a
	direct `this.room` reference instead of reaching through a registry.
*/
const Vec = require('victor');
const tick = require('../lib/tick.js');
const CLASS = require('../public/SHARE/TanksConfig.js').class;
// NOT public/SHARE/Physics.js's tank FRICTION - see lib/constants.js. A shape is not a steered
// tank, so it keeps the hand-tuned drag rather than diep's derived tank 10/11.
const BODY_FRICTION = tick.drag(require('../lib/constants.js').BODY_FRICTION);
const KIND = require('../public/SHARE/kinds.js');
const RARITY = require('../public/SHARE/ObjectsConfig.js').rarity;
const Detector = require('./Detector.js');
const { TANK_SHAPE_MULT } = require('../lib/damage.js');

/*
	update()'s DETEC-driven pull - a polygon boss chasing what its detector found, and any shape
	dragging itself back inside 120 units of its nest post.

	tick.quadratic(), not tick.perTick(): unlike the collision knockbacks below (a single impulse
	per contact, decayed by the limiter, already invariant), this is added EVERY tick for as long
	as the pull lasts and is then integrated into position again, so it integrates twice over
	ticks - the same category as entities/Bullet.js's cruise thrust (see lib/tick.js's quadratic()).
	0.543024 is the old 0.33939 x that file's SPEED_RESCALE (1.6), so the pull at the live TICK_MS
	is unchanged; it is a frozen constant, NOT tick.SCALE, and must not move if TICK_MS does.
*/
const HOME_PULL = tick.quadratic(0.543024);

class Objects {
	constructor(type, pos, id, map, room) {
		this.BUFF = {
			timestamp: -1,
		};
		this.room = room;
		this.coinReward = Math.floor(Math.random() + .02);
		this.type = type;
		this.id = id;
		this.size = 20;
		this.collideId = Math.random();
		this.hp = 20;
		this.damage = 4.84848;   // one-time-rescaled from 4 (33ms ref); tick.perTick() at each consumer
		this.alpha = 1;
		this.hit = 0;
		this.spawnRad = 400;
		// Inset from the map edge - the same one rooms/Room.js's spawnPoint() uses, and scaled by
		// the same room.nestScale as the nest radii below (PENDING #19, plan.md step 6) so the whole
		// placement picture stays geometrically similar as the arena resizes. ffa's scale is 1.
		this.marge = 280 * room.nestScale;
		this.weight = 1;   // a mass divisor (this.x += vec.x/weight below), not a per-tick rate - not rescaled
		switch (pos) {
			case -1: {
				// Carve-outs around the three polygon nests, at the same 28-unit grid pitch the
				// nests themselves are placed on (rooms/Room.js's createObj() ppp radii). Slightly
				// tighter than spawnKeepOut()'s circles on purpose - a shape may sit closer to a
				// nest than a fresh player spawn may. The sampler is bounded, and has to be: it
				// runs hundreds of times per room rather than once per death.
				// x room.nestScale (PENDING #19, plan.md step 6): the radii are ffa's own tuned
				// figures, scaled so they stay the same fraction of whatever arena they are in -
				// ffa's scale is exactly 1. Both the ratio to spawnKeepOut()'s circles and the
				// margin from the map edge are preserved by that, since `marge` scales with it too.
				const s = room.nestScale;
				const p = room.rejectSample(this.marge, [
					[0, 0, 1400 * s],
					[map.width / 4, map.height / 4, 980 * s],
					[-map.width / 4, -map.height / 4, 980 * s]
				]);
				this.x = p.x;
				this.y = p.y;
				this.pos = 0;
				break;
			}
			case 'bull': {
				// A 650..700 annulus around the origin, sampled directly rather than by rejection.
				const dir = Math.random() * Math.PI * 2;
				const rad = 650 + Math.random() * 50;
				this.x = Math.cos(dir) * rad;
				this.y = Math.sin(dir) * rad;
				this.pos = 1;
				break;
			}
			default:
				const dir = Math.random() * Math.PI * 2;
				this.x = Math.min(map.width / 2 - this.marge,
					Math.max(-map.width / 2 + this.marge,
						pos[0] + Math.sin(dir) * (Math.random() * pos[2])));
				this.y = Math.min(map.height / 2 - this.marge, Math.max(-map.height / 2 + this.marge, pos[1] + Math.cos(dir) * (Math.random() * pos[2])));
				this.pos = 1;
				break;
		}
		this.maxspeed = 0.36364;   // one-time-rescaled from .30 (33ms ref) - Bsqr/Btri only now, see below
		switch (this.type) {
			// Radii are diep's own du radius x 0.56 (Square/Triangle/Crasher-large 38.891, Pentagon
			// 53.033, Alpha Pentagon 141.421, Crasher-small 24.749 du). HP/XP are diep's raw table;
			// damage is diep damagePerTick x common(shape,tank)=4 x (4.84848/7) - our own anchor,
			// 4.84848 being diep's 7 on our scale (plan.md step 6). maxspeed is 2x diep's own drift
			// terminal (0.56/0.28 units/ref-tick) since update()'s vec.limit clamps to maxspeed/2,
			// its own fixed point (plan.md step 7).
			case "sqr": this.size = 21.78; this.hp = 10; this.prize = 10; this.damage = 5.54112; this.maxspeed = 1.12; break;
			case "tri": this.size = 21.78; this.hp = 30; this.prize = 25; this.maxspeed = 1.12; this.damage = 5.54112; break;
			case "pnt": this.size = 29.70; this.hp = 100; this.prize = 130; this.maxspeed = 0.56; this.weight = 4; this.damage = 8.31168; break;   // (weight is a mass divisor, not rescaled)
			case "Bpnt": this.size = 79.20; this.hp = 3000; this.prize = 3000; this.maxspeed = 0.56; this.weight = 100; this.damage = 13.8528; break;
			// Bsqr/Btri have no diep counterpart (plan.md steps 6-7) - radius, hp, prize, damage and
			// drift (maxspeed/rotationVal below) all left exactly as they were, flagged as ours.
			case "Bsqr": this.size = 90; this.hp = 8000; this.prize = 2000; this.maxspeed = 0.01212; this.weight = 100; break;   // .01
			case "Btri": this.size = 72; this.hp = 7000; this.prize = 1000; this.maxspeed = 0.01212; this.weight = 100; break;   // .01
			case "bull": this.size = 13.86; this.hp = 10; this.prize = 15; this.maxspeed = 1.12; this.damage = 5.54112;
				this.DETEC = new Detector(this, this.x, this.y, 500, type = [KIND.PLAYER]); break;
		}
		this.coinReward *= parseInt(this.prize / 10);
		switch (this.type) {
			case 'pnt':
			case 'Bpnt':
			case 'Bsqr':
			case 'Btri':
				this.getPlace = 1;
				break;
		}
		if (this.type === 'bull') {
			if (Math.random() < 0.15) {
				// Large Crasher: diep's own 30 hp / 25 xp, same radius as Square/Triangle (plan.md step 6).
				this.size = 21.78;
				this.hp = 30;
				this.prize = 25;
			}
		}
		// Rarity roll. Checked rarest-first:
		// each tier is its own independent chance, so a roll that already won a rarer tier cannot
		// be re-decided into a more common one by also checking that (weaker) threshold afterwards.
		this.tier = 0;
		for (let i = RARITY.length - 1; i >= 1; i--) {
			if (Math.random() < RARITY[i].chance) {
				this.tier = RARITY[i].id;
				this.hp = Math.round(this.hp * RARITY[i].hpMul);
				this.prize = Math.round(this.prize * RARITY[i].prizeMul);
				if (RARITY[i].weight !== null) { this.weight = RARITY[i].weight; }
				break;
			}
		}
		this.map = map;
		this.maxHp = this.hp;
		//
		// diep's BASE_ORBIT (drift-direction wander, plan.md step 7): 0.005 rad/ref-tick, halved for
		// Pentagon/Alpha Pentagon, sign randomised per shape at spawn - this.rotationDir was already
		// rolled for exactly that and had no consumer until now.
		this.rotationDir = Math.sign(Math.random() - 0.5);
		this.vec = new Vec(tick.perTick(this.maxspeed), 0).rotate(Math.random() * Math.PI * 2);
		this.destroy = 0;
		this.rx = this.x;
		this.ry = this.y;
		switch (this.type) {
			case 'pnt':
			case 'Bpnt':
				this.rotationVal = 0.0025 * this.rotationDir; break;
			case 'Bsqr':
			case 'Btri':
				// No diep counterpart (plan.md step 7) - unchanged, own random-range wander, unsigned.
				this.rotationVal = 0.00242 + Math.random() * 0.00061; break;   // one-time-rescaled from .002 / .0005 (33ms ref)
			default:
				this.rotationVal = 0.005 * this.rotationDir; break;
		}
		this.TOSEND = {
			"public": {}
		}
	}
	delete() {
		this.room.obj[this.type][this.pos] -= 1;
	}
	collision(other, option = {}) {
		// Same call as entities/Player.js's own 0.5 threshold - the 0.4
		// here is deliberately NOT tick.perTick()'d. this.vec is a real-tick velocity kept near its
		// own accel/friction fixed point by update()'s vec.limit(tick.perTick(maxspeed/2), BODY_FRICTION),
		// and that fixed point (verified numerically) barely moves across TICK_MS 16/25/33/40, so a
		// bare threshold against it stays meaningful without a runtime conversion.
		const len = (this.vec.length() * this.weight < 0.4) ? 2.42424 : .48485;   // one-time-rescaled from 2 / .4
		switch (other.kind) {
			case KIND.PLAYER:
				if (other.necro && this.type === 'sqr' && other.droneCount < CLASS[other.class].maxDrone + other.upNb[1]) {
					this.destroy = 1;
					return;
				}
				this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.perTick(len), tick.perTick(len))));
				// An Arena Closer (PENDING #28) still shoves a shape out of the way (the impulse
				// above) but diep_wiki is explicit that its body "can't harm shapes" - so the damage/
				// kill half is skipped for it alone, the one KIND.PLAYER exception in this arm.
				if (other.closer) { break; }
				// common(tank,shape) = 4 (lib/damage.js, plan.md step 5) - newly explicit here now that
				// `other.damage` (the tank's `this.damage`) carries diep's raw damagePerTick with no
				// vs-shape x4 baked in any more; the old code needed no multiplier at this site because
				// that bake-in already WAS it, so this is numerically a no-op. `option.dmgScale` is
				// rooms/Room.js's proration factor for this tick (1 unless either side would otherwise
				// die mid-tick, plan.md step 5 part 4).
				this.hp -= tick.perTick(other.damage * TANK_SHAPE_MULT * (option.dmgScale ?? 1));
				this.hit = tick.ticks(1.65);
				if (this.hp <= 0) { this.destroy = tick.DES; this.room.awardXp(other, this.prize); other.coins += this.coinReward }
				break;
			case KIND.OBJECTS:
				if (other.type === 'bull') {
					this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.perTick(0.12121), tick.perTick(0.12121))));
					return;
				}
				this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.perTick(len), tick.perTick(len))));
				break;
			case KIND.BULLET:
				if (other.necro && this.type === 'sqr') {
					const play = other.room.INSTANCE.players.get(other.origin.oId);
					if (play.droneCount < CLASS[play.class].maxDrone + play.upNb[1]) {
						this.destroy = 1;
						return;
					}
				}
				// `pene` no longer multiplies damage here (PENDING #18, the same fix
				// entities/Player.js's own KIND.BULLET arm already got): a bullet's `pene` already
				// decides how many ticks of contact it survives against this shape's own body damage
				// (entities/Bullet.js's `this.pene -= tick.perTick(other.damage * PROJECTILE_BODY_DAMAGE)`
				// in its own KIND.OBJECTS arm) - multiplying the per-tick hit by `pene` again
				// double-counted it, so damage against a shape scaled roughly quadratically with
				// `pene` instead of linearly (a maxed-pene Destroyer erasing an Alpha Pentagon in one
				// hit instead of the ~20+ diep's own numbers call for). This also retires the
				// base-drone-pene substitution the old formula needed to avoid reading a drone's
				// 2000-point health pool as a 2000x multiplier - a drone's `other.damage`
				// (BASE_DRONE_DAMAGE) is already the right per-tick number on its own. common(bullet,
				// shape) = 1 (lib/damage.js), so still no multiplier belongs here; `option.dmgScale` is
				// rooms/Room.js's proration factor for this tick (1 unless either side would otherwise
				// die mid-tick, plan.md step 5 part 4).
				this.hp -= tick.perTick(other.damage * (option.dmgScale ?? 1));
				this.hit = tick.ticks(1.65);
				if (this.hp <= 0) { this.destroy = tick.DES; }
				if (this.type[0] === 'B') {
					break;
				}
				this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.perTick(0.48485), tick.perTick(0.48485))));
				break;
		}
	}
	update() {
		this.hit = Math.max(0, this.hit - 1);
		if (this.destroy > 1) {
			this.x += this.vec.x / this.weight;
			this.y += this.vec.y / this.weight;
			this.destroy -= 1;
			this.alpha = this.destroy / tick.DES;
			this.size += tick.perTick(1.21212 + this.size * 0.01212);   // one-time-rescaled from 1 + size*.01
			return;
		}
		this.vec.rotate(tick.perTick(this.rotationVal));
		this.vec.limit(tick.perTick(this.maxspeed / 2), BODY_FRICTION)
		this.x += this.vec.x / this.weight;
		this.y += this.vec.y / this.weight;
		if (this.DETEC) {
			if (this.DETEC.select) {
				if (this.DETEC.select.destroy || this.DETEC.select.god) {
					this.DETEC.reset();
				} else {
					const v = new Vec(HOME_PULL, 0).rotate(Math.atan2(this.DETEC.select.y - this.y, this.DETEC.select.x - this.x))
					this.vec.add(v)
					this.DETEC.enabled = 0;
				}
			} else if (Math.sqrt(Math.pow(this.x - this.rx, 2) + Math.pow(this.y - this.ry, 2)) > 120) {
				const v = new Vec(HOME_PULL, 0).rotate(Math.atan2(this.ry - this.y, this.rx - this.x))
				this.vec.add(v);
			} else {
				this.DETEC.enabled = 1;
			}
			this.DETEC.x = this.x;
			this.DETEC.y = this.y;
		}

		if (this.x < -this.map.width / 2) {
			this.x = -this.map.width / 2;
			this.vec.x = 0;
		};
		if (this.y < -this.map.height / 2) {
			this.y = -this.map.height / 2;
			this.vec.y = 0;
		};
		if (this.x > this.map.width / 2) {
			this.x = this.map.width / 2;
			this.vec.x = 0;
		};
		if (this.y > this.map.height / 2) {
			this.y = this.map.height / 2;
			this.vec.y = 0;
		};
	}
}

// Type tag for collision / buffer dispatch - see public/SHARE/kinds.js.
Objects.prototype.kind = KIND.OBJECTS;

module.exports = Objects;
