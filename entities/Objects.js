/*
	Objects - the farmable polygons (squares, triangles, pentagons).

	Extracted from the old Alex.js monolith (now server.js + lib/ + rooms/ + entities/).
	An Objects instance only ever collides with a bullet from its own room, so it holds a
	direct `this.room` reference instead of reaching through a registry.
*/
const Vec = require('victor');
const tick = require('../lib/tick.js');
const CLASS = require('../public/SHARE/TanksConfig.js').class;
const FRICTION = tick.drag(require('../lib/constants.js').FRICTION);
const KIND = require('../public/SHARE/kinds.js');
const RARITY = require('../public/SHARE/ObjectsConfig.js').rarity;
const Detector = require('./Detector.js');

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
		this.marge = 200;
		this.weight = 1;   // a mass divisor (this.x += vec.x/weight below), not a per-tick rate - not rescaled
		switch (pos) {
			case -1:
				while (1) {
					this.x = this.marge + Math.random() * (map.width - this.marge * 2) - map.width / 2;
					this.y = this.marge + Math.random() * (map.height - this.marge * 2) - map.height / 2;
					let dis = Math.sqrt(Math.pow(this.x, 2) + Math.pow(this.y, 2))
					if (dis > 1000) {
						dis = Math.sqrt(Math.pow(map.width / 4 - this.x, 2) + Math.pow(map.height / 4 - this.y, 2))
						if (dis > 700) {
							dis = Math.sqrt(Math.pow(-map.width / 4 - this.x, 2) + Math.pow(-map.height / 4 - this.y, 2))
							if (dis > 700) {
								break;
							}
						}
					}
				}
				this.pos = 0;
				break;
			case 'bull':
				while (1) {
					this.x = Math.random() * 1400 - 700
					this.y = Math.random() * 1400 - 700
					const dis = Math.sqrt(Math.pow(this.x, 2) + Math.pow(this.y, 2))
					if (dis < 700 && dis > 650) {
						break;
					}
				}
				this.pos = 1;
				break;
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
		// Rarity roll (THEPLAN 4.2, Mythic removed in massplanchunks WP6). Checked rarest-first:
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
		// massplanchunks WP-D audit: same call as entities/Player.js:359's 0.5 threshold - the 0.4
		// here is deliberately NOT tick.perTick()'d. this.vec is a real-tick velocity kept near its
		// own accel/friction fixed point by update()'s vec.limit(tick.perTick(maxspeed/2), FRICTION),
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
				this.hp -= tick.perTick(((option.pene > 1) ? option.pene : option.pene / 2) * other.damage);
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
		this.vec.limit(tick.perTick(this.maxspeed / 2), FRICTION)
		this.x += this.vec.x / this.weight;
		this.y += this.vec.y / this.weight;
		if (this.DETEC) {
			if (this.DETEC.select) {
				if (this.DETEC.select.destroy || this.DETEC.select.god) {
					this.DETEC.reset();
				} else {
					const v = new Vec(tick.perTick(0.33939), 0).rotate(Math.atan2(this.DETEC.select.y - this.y, this.DETEC.select.x - this.x))
					this.vec.add(v)
					this.DETEC.enabled = 0;
				}
			} else if (Math.sqrt(Math.pow(this.x - this.rx, 2) + Math.pow(this.y - this.ry, 2)) > 120) {
				const v = new Vec(tick.perTick(0.33939), 0).rotate(Math.atan2(this.ry - this.y, this.rx - this.x))
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
