/*
	Objects - the farmable polygons (squares, triangles, pentagons).

	Extracted from the old Alex.js monolith (now server.js + lib/ + rooms/ + entities/).
	An Objects instance only ever collides with a bullet from its own room, so it holds a
	direct `this.room` reference instead of reaching through a registry.
*/
const Vec = require('victor');
const tick = require('../lib/tick.js');
const config = require('../lib/config.js').config;
const CLASS = require('../public/SHARE/TanksConfig.js').class;
// NOT public/SHARE/Physics.js's tank FRICTION - see lib/constants.js. A shape is not a steered
// tank, so it keeps the hand-tuned drag rather than diep's derived tank 10/11.
const BODY_FRICTION = tick.drag(require('../lib/constants.js').BODY_FRICTION);
const KIND = require('../public/SHARE/kinds.js');
const RARITY = require('../public/SHARE/ObjectsConfig.js').rarity;
const Detector = require('./Detector.js');

/*
	update()'s DETEC-driven pull - a polygon boss chasing what its detector found, and any shape
	dragging itself back inside 120 units of its nest post.

	tick.quadratic(), not tick.perTick(): unlike the collision knockbacks below (a single impulse
	per contact, decayed by the limiter, already invariant), this is added EVERY tick for as long
	as the pull lasts and is then integrated into position again, so it integrates twice over
	ticks - the same category as entities/Bullet.js's cruise thrust and lib/tick.js's hpregan.
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
		this.marge = 280;   // inset from the map edge - the same one rooms/Room.js's spawnPoint() uses
		this.weight = 1;   // a mass divisor (this.x += vec.x/weight below), not a per-tick rate - not rescaled
		switch (pos) {
			case -1: {
				// Carve-outs around the three polygon nests, at the same 28-unit grid pitch the
				// nests themselves are placed on (rooms/Room.js's createObj() ppp radii). Slightly
				// tighter than spawnKeepOut()'s circles on purpose - a shape may sit closer to a
				// nest than a fresh player spawn may. The sampler is bounded, and has to be: it
				// runs hundreds of times per room rather than once per death.
				const p = room.rejectSample(this.marge, [
					[0, 0, 1400],
					[map.width / 4, map.height / 4, 980],
					[-map.width / 4, -map.height / 4, 980]
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
		this.maxspeed = 0.36364;   // one-time-rescaled from .30 (33ms ref)
		switch (this.type) {
			case "sqr": this.size = 20; this.hp = 13; this.prize = 15; break;
			case "tri": this.size = 18; this.hp = 25; this.prize = 50; this.maxspeed = 0.31515; break;   // .26
			case "pnt": this.size = 42; this.hp = 190; this.prize = 100 + Math.floor(Math.random() * 100); this.maxspeed = 0.09697; this.weight = 4; this.damage = 6.06061; break;   // .08 / 5 (weight is a mass divisor, not rescaled)
			case "Bpnt": this.size = 115; this.hp = 9000; this.prize = 3000; this.maxspeed = 0.01212; this.weight = 100; break;   // .01
			case "Bsqr": this.size = 90; this.hp = 8000; this.prize = 2000; this.maxspeed = 0.01212; this.weight = 100; break;   // .01
			case "Btri": this.size = 72; this.hp = 7000; this.prize = 1000; this.maxspeed = 0.01212; this.weight = 100; break;   // .01
			case "bull": this.size = 12; this.hp = 15; this.prize = 12; this.maxspeed = 0.50909; this.damage = 8.48485;   // .42 / 7
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
				this.size = 23;
				this.hp = 32;
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
		this.rotationDir = Math.sign(Math.random() - 0.5);
		this.vec = new Vec(tick.perTick(this.maxspeed), 0).rotate(Math.random() * Math.PI * 2);
		this.destroy = 0;
		this.rx = this.x;
		this.ry = this.y;
		this.rotationVal = 0.00242 + Math.random() * 0.00061;   // one-time-rescaled from .002 / .0005 (33ms ref)
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
				this.hp -= tick.perTick(other.damage);
				this.hit = tick.ticks(1.65);
				if (this.hp <= 0) { this.destroy = tick.DES; other.xp += this.prize; other.coins += this.coinReward }
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
				// A base drone's `pene` is a health pool, not a penetration value (rooms/Room.js's
				// spawnBaseDrone), so reading it as one here dealt 2000 x damage and vaporised any shape on
				// contact
				const pene = (other.type === 1.4) ? config.BASE_DRONE_PENE : option.pene;
				this.hp -= tick.perTick(((pene > 1) ? pene : pene / 2) * other.damage);
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
