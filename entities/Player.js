/*
	Player - the tank entity: motion, shooting, upgrades, class changes, collision.

	Extracted from the old Alex.js monolith (now server.js + lib/ + rooms/ + entities/).
	A Player only ever spawns bullets into and reads state from its own room, so it holds a
	direct `this.room` reference instead of reaching through a registry.
*/
const Vec = require('victor');
const config = require('../lib/config.js').config;
const tick = require('../lib/tick.js');
const CLASS = require('../public/SHARE/TanksConfig.js').class;
const CLASS_TREE = require('../public/SHARE/TanksConfig.js').tree;
const Physics = require('../public/SHARE/Physics.js');
const KIND = require('../public/SHARE/kinds.js');
const ACHIEVEMENTS = require('../public/SHARE/AchievementsConfig.js').list;
const Bullet = require('./Bullet.js');
const Detector = require('./Detector.js');

// Auto-turret aim lead (shoot()): "how many reference ticks ahead" to predict a moving target -
// a lookahead duration, one-time-rescaled from 12 (33ms) to 9.9 (40ms) same as every other
// duration in this pass, then converted to real ticks once at load (massplanchunks WP3).
// massplanchunks WP-D audit flag (not fixed here - see PENDING.md): the formula this feeds,
// other.vec * dis / AUTOTURRET_LEAD, is NOT tick-scale invariant despite the tick.lead()
// conversion - verified numerically, the *un*-converted divisor (9.9 flat) tracks TICK_MS
// 16/25/33/40 to within ~1.5% at steady state, where tick.lead()'s n/SCALE varies the result by
// over 100% across the same range. Root cause: other.vec is already a real-tick quantity whose
// magnitude is itself close to TICK_MS-invariant (same reasoning as the two knockback-threshold
// comments in this file and entities/Objects.js), so dividing by a further SCALE-adjusted
// constant introduces the step-rate dependency rather than removing it. Left as tick.lead(9.9)
// for now because changing it also changes today's auto-aim feel at the live TICK_MS (25), which
// is a balance call, not a pure correctness fix - same reasoning as PENDING #16's `back` column.
const AUTOTURRET_LEAD = tick.lead(9.9);

class Player {
	constructor(id, x, y, name, team, xpLvl, room) {
		this.XPLVL = xpLvl;
		this.mlx = this.XPLVL[this.XPLVL.length - 3] / Math.pow(this.XPLVL[this.XPLVL.length - 3], 1 / 1.8);
		this.BUFF = {
			timestamp: -1,
		};
		this.extraView = 0;
		this.dev = {
			size: 0,
			stick: 0
		};
		// Achievements (HANDOFF Part 2): id -> 1 once unlocked, guards unlock() against firing
		// twice; Controller.disconnect() reads this once per life and persists it into
		// acc.userdata.ach. killCounts backs the kill-tally achievements (registerKill below).
		this.unlocked = {};
		this.killCounts = {};
		this.id = id;
		this.name = name;
		this.mess = [];
		this.class = "Basic";
		this.classLvl = 0;
		this.team = team;
		this.hit = 0;
		this.xp = 0;
		this.coins = 0;
		this.userKey = 0;
		this.maxHp = 150;
		this.hpregan = [0, 0];
		this.hp = this.maxHp;
		this.prize = 100;
		this.autoDir = 0;
		this.dead = 0,
			this.state = {
				"disconnect": 0,
			};
		this.shield = tick.ticks(4950);   // 4950 = 6000 one-time-rescaled from the 33ms reference
		this.inputs = {
			"mouse_x": 0,
			"mouse_y": 0,
			"mouseL": 0,
			"mouseR": 0,
			"w": 0,
			"a": 0,
			"s": 0,
			"d": 0,
			"f": 0,
			'arrw': 0,
			'arrs': 0,
			'arra': 0,
			'arrd': 0,
			"e": 0,
			"n": 0
		};
		this.destroy = 0;
		this.shootTimer = [0, 0];
		///
		this.room = room;
		this.map = room.map;
		this.x = x;
		this.y = y;
		this.vec = new Vec(0, 0)
		this.dir = 0;
		this.canDir = [];
		this.timer = 0;
		///
		this.size = 25;
		this.alpha = 1;
		this.screen = 1280;
		this.level = 0;
		this.stillLvl = 0;
		this.droneCount = 0;
		this.damage = 8.48485;   // one-time-rescaled from 7 (33ms ref); tick.perTick() at each hp -= site
		this.murder = -1;
		this.up = {
			"MSpeed": 0, //0
			"Reload": 1, //1
			"BSpeed": 1, //2
			"BPene": 1,  //3
			"BDamage": 1,//4
			"BodyDam": 1,//5
			"HpUp": 0,    //6
			"HpRegan": 1  //7
		}
		this.upNb = [0, 0, 0, 0, 0, 0, 0, 0];
		this.recoil = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
	}
	respawn() {

	}
	delete() {

	}
	motion() {
		// The movement accel/friction integrator lives in public/SHARE/Physics.js -
		// public/client/game.js's User.update() shares it for local input prediction.
		const key = this.inputs;
		const motion = new Vec(0, 0);
		const accel = Physics.moveAccel(this.up.MSpeed, this.level);
		if (!this.state.disconnect) {
			if (key.w || key.arrw) { motion.y -= accel; }
			if (key.s || key.arrs) { motion.y += accel; }
			if (key.a || key.arra) { motion.x -= accel; }
			if (key.d || key.arrd) { motion.x += accel; }
		}
		let ax = 0, ay = 0;
		if (motion.length() > 0) {
			const a = motion.norm().multiply(new Vec(accel, accel));
			ax = a.x; ay = a.y;
			if (this.alpha < 1 && !this.dev.invisible) {
				this.alpha += Math.min(1, tick.perTick(CLASS[this.class].alpha * 10));
			}
			if (this.shield) {
				this.shield = 0;
			}
		}
		const body = { x: this.x, y: this.y, vx: this.vec.x, vy: this.vec.y };
		Physics.stepBody(body, ax, ay, tick.SCALE);
		this.x = body.x; this.y = body.y;
		this.vec.x = body.vx; this.vec.y = body.vy;
		this.autoDir += tick.perTick(0.01818);   // one-time-rescaled from .015 (33ms ref)
		// Players alone get to leave the drawn arena, up to config.OOB_MARGIN - a measured diep
		// behaviour (massplanchunks WP5), not a spring: the real wall is just further out than
		// the visible edge, and still a hard stop.
		if (this.x < -this.map.width / 2 - config.OOB_MARGIN) {
			this.x = -this.map.width / 2 - config.OOB_MARGIN;
			this.vec.x = 0;
		};
		if (this.y < -this.map.height / 2 - config.OOB_MARGIN) {
			this.y = -this.map.height / 2 - config.OOB_MARGIN;
			this.vec.y = 0;
		};
		if (this.x > this.map.width / 2 + config.OOB_MARGIN) {
			this.x = this.map.width / 2 + config.OOB_MARGIN;
			this.vec.x = 0;
		};
		if (this.y > this.map.height / 2 + config.OOB_MARGIN) {
			this.y = this.map.height / 2 + config.OOB_MARGIN;
			this.vec.y = 0;
		};
	}
	shoot() {
		if (CLASS[this.class].DETEC) {
			if (!this.DETEC) {
				const detec = CLASS[this.class].DETEC;
				this.DETEC = new Detector(this, this.x, this.y, detec.size, detec.type, detec.all)
				this.DETEC.team = this.team;
			} else {
				this.DETEC.x = this.x;
				this.DETEC.y = this.y;
			}
		}
		////
		if (this.state.disconnect) {
			return;
		}
		for (let r = 0; r < CLASS[this.class].cannons.length; r++) {
			if (typeof this.shootTimer[r] === 'undefined') { this.shootTimer[r] = 0; }
			const can = CLASS[this.class].cannons[r];
			const reloadMax = tick.ticks(Math.round(can.reload * this.up.Reload));
			const reload = this.shootTimer[r];
			const maxD = CLASS[this.class].maxDrone;
			let autoDir, shoot;
			const ra = this.size / 35;
			if (can.autoDir) {
				if (this.DETEC.select) {
					this.DETEC.enabled = 0;
					const other = this.DETEC.select;
					const dis = Math.sqrt(Math.pow(this.x - other.x, 2) + Math.pow(this.y - other.y, 2));
					if (!other.destroy && other.alpha && dis <= CLASS[this.class].DETEC.maxDis) {
						autoDir = Math.atan2(other.y + other.vec.y * dis / AUTOTURRET_LEAD - this.y, other.x + other.vec.x * dis / AUTOTURRET_LEAD - this.x);
						this.canDir[r] = autoDir;
						shoot = 1;
					} else {
						this.DETEC.reset();
						this.DETEC.enabled = 1;
						this.canDir[r] = this.autoDir;
						shoot = 0;
					}
				} else {
					this.canDir[r] = this.autoDir;
				}
			};
			///
			if ((this.inputs.e || this.inputs.mouseL || can.auto)
				&& ((maxD && can.life === -1) ? this.droneCount < maxD : true)
				&& ((can.autoShoot) ? shoot : true)) {
				///
				if (this.shield) {
					this.shield = 0;
				}
				///
				if (reload === Math.floor(can.offTime * reloadMax)) {
					///
					if (this.alpha < 1 && !this.dev.invisible) {
						this.alpha += Math.min(1, tick.perTick(CLASS[this.class].alpha * 30));
					}
					///
					const dir = can.autoDir ? autoDir : this.dir + can.offdir;
					const exitSpeed = can.exitSpeed ? can.exitSpeed : 40;
					const offx = can.offx * ra;
					const len = can.canonLength * .93 * ra;
					const offlen = Math.hypot(len, offx);
					const offdir = Math.atan2(offx, len);
					const x = this.x + Math.cos(dir + offdir) * (offlen)//-can.size*ra);
					const y = this.y + Math.sin(dir + offdir) * (offlen)//-can.size*ra);
					const Bull = new Bullet(this.id, x, y, dir + Math.random() * can.rand - can.rand / 2, this.up.BSpeed * can.speed, exitSpeed, this.room);
					Bull.type = (can.type ? can.type : 0);
					Bull.class = this.class;
					Bull.pene = this.up.BPene * can.pene;
					// 107 = 130 one-time-rescaled from the 33ms reference; -1 is the "permanent
					// drone" sentinel (Bullet.js checks it directly) and must never go through
					// tick.ticks(), which would turn it into a 1-real-tick lifetime instead.
					Bull.life = (can.life === -1) ? -1 : tick.ticks(can.life ? can.life : 107);
					Bull.damage = this.up.BDamage * can.damage;
					Bull.size = this.boss ? can.size : can.size * ra;
					Bull.weight = can.weight;
					this.room.createBullet(Bull, this)
					this.vec.add(new Vec(tick.perTick(can.back), 0).rotate(dir - Math.PI));
					if (maxD && can.life === -1) {
						this.droneCount++;
					}
					///
					this.recoil[parseInt(r)] = 1;
					setTimeout((x, r) => { x.recoil[r] = 0 }, config.TICK_MS, this, parseInt(r))
				}
				///
				if (this.shootTimer[r] === 0) {
					this.shootTimer[r] += 1;
					continue;
				}
			} else {
				if (reload < Math.floor(can.offTime * reloadMax)) {
					this.shootTimer[r] = 0;
				}
			}
			///
			if (reload > 0 && reload < reloadMax) {
				this.shootTimer[r] += 1;
			} else if (reload >= reloadMax) {
				this.shootTimer[r] = 0;
			}
		}
	}
	upgrade(data) {
		if (this.destroy) { return; }
		if (this.level - this.stillLvl <= 0) {
			return 1;
		}
		switch (data) {
			case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
				if (this.upNb[data] >= 6) {
					break;
				}
				this.stillLvl += 1;
				this.upNb[data] += 1;
				let nb = -1;
				for (const i in this.up) {
					nb++;
					if (nb !== data) { continue; }
					switch (i) {
						case "HpRegan": this.up[i] += 0.28; break;
						case "Reload": this.up[i] -= 0.092; break;
						case "BSpeed": this.up[i] += 0.11; break;
						case "BDamage": this.up[i] += .2; break;
						case "BPene": this.up[i] += 1.25; break;
						case "MSpeed": this.up[i] += 0.029254; break;   // Physics.MOVE_ACCEL_PER_UP's twin, same one-time rescale
						case "HpUp": this.maxHp += 110; this.hp = parseInt(this.hp * (this.maxHp / (this.maxHp - 100))); break;
						case "BodyDam": this.damage += 2.18182; break;   // one-time-rescaled from 1.8 (33ms ref)
					}
					break;
				}
		}
	}
	upClass(data) {
		if (this.destroy) { return; }
		let tanks = [];
		for (let i = 0; i < parseInt((1 + this.level) / 10); i++) {
			if (CLASS_TREE[i][this.class]) {
				tanks = tanks.concat(CLASS_TREE[i][this.class]);
			}
		}
		if (tanks.includes(data)) {
			this.classLvl++;
			this.class = data;
			// A human evolving out of an auto-aim class must drop its vision cone: shoot()
			// only ever *creates* this.DETEC (when the class defines one), so otherwise the
			// stale cone lingers forever. Bots are skipped - gameAI rebuilds their own AI
			// cone every tick, so they never hold a stale one nor need a churned allocation.
			if (!this.bot && this.DETEC && !CLASS[this.class].DETEC) { this.DETEC = null; }
			this.droneCount = 0;
			this.necro = CLASS[this.class].necro;
			this.shootTimer = new Array(CLASS[this.class].cannons.length).fill(0);
			// classLvl counts evolutions, one per CLASS_TREE tier (0..3) - reaching 3 means a
			// tier 4 (final) class.
			if (this.classLvl >= 3) { this.unlock('scary_tank'); }
		} else {
			return;
		}
	}
	collision(other, option = {}) {
		if (this.dev.ghost) { return; }
		if (option.type) {
			switch (option.type) {
				case 'god':
					this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.perTick(0.87761), tick.perTick(0.87761))));
					return;
			}
		}
		if (option.base) {
			this.alpha = 1;
			this.destroy = tick.DES;
			this.dead = tick.DEAD_DELAY;
			return;
		}
		const oldHp = this.hp;
		switch (other.kind) {
			case KIND.PLAYER:
				this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.perTick(0.43881), tick.perTick(0.43881))));
				if (option.noDam || this.shield) { break; }
				this.hp -= tick.perTick(other.damage);
				this.hit = tick.ticks(1.65);
				if (this.hp <= 0) {
					this.dead = tick.DEAD_DELAY;
					this.murder = ["players", other.id];
					this.destroy = tick.DES;
					other.xp += this.prize;
					if (this.coinReward) other.coins += this.coinReward;
					if (!other.bot) {
						other.mess.push('You killed ' + this.name);
						other.unlock('first_blood');
					}
				}
				break;
			case KIND.OBJECTS:
				// massplanchunks WP-D audit: the 0.5 threshold is deliberately NOT tick.perTick()'d.
				// this.vec is a real-tick velocity produced by Physics.stepBody's accel/friction
				// recurrence, and that recurrence's fixed point (and any point along a friction-only
				// decay from it, since drag() is what keeps decay real-time-shaped) is itself
				// near-invariant to TICK_MS - verified numerically (<1.5% drift across TICK_MS
				// 16/25/33/40) rather than assumed. Wrapping this threshold in tick.perTick() would
				// make it track REF_TICK_MS instead and be the thing that's actually TICK_MS-sensitive.
				const len = (this.vec.length() < 0.5) ? 2.92538 : .73134;   // one-time-rescaled from 2 / .5 (stepBody factor)
				this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.perTick(len), tick.perTick(len))));
				if (this.necro && other.type === 'sqr' && this.droneCount < CLASS[this.class].maxDrone + this.upNb[1]) {
					this.droneCount++;
					const Bull = new Bullet(this.id, other.x, other.y, Math.random() * Math.PI * 2, this.up.BSpeed * this.necro.speed, 0, this.room);
					Bull.type = this.necro.type;
					Bull.class = this.class;
					Bull.necro = this.necro.necro;
					Bull.pene = this.up.BPene * this.necro.pene;
					Bull.life = -1;
					Bull.damage = this.up.BDamage * this.necro.damage;
					Bull.size = other.size;
					Bull.weight = this.necro.weight;
					this.room.createBullet(Bull, this);
					return;
				}
				if (this.shield) { return; }
				this.hp -= tick.perTick(other.damage);
				this.hit = tick.ticks(1.65);
				if (this.hp <= 0) {
					this.dead = tick.DEAD_DELAY;
					this.murder = ["objs", other.id];
					this.destroy = tick.DES;
					if (other.type === 'pnt') { this.unlock('died_to_penta'); }
				}
				break;
			case KIND.BULLET:
				if (option.noDam) { break; }
				if (other.origin.oId === this.id.oId) {
					return;
				}
				if (this.bot) {
					this.lastBullet = other.origin;
				}
				// other.weight is rescaled at its TanksConfig source for Bullet's own (hand-rolled
				// friction) knockback mechanism; the player receiving it decays that impulse
				// through Physics.stepBody instead, which needs a further x1.6 (the ratio between
				// the two mechanisms' correct one-time factors, see Physics.js).
				this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.perTick(other.weight / 3 * 1.6), tick.perTick(other.weight / 3 * 1.6))));
				if (this.shield) { return; }
				this.hp -= tick.perTick(other.damage * Math.max(1, other.pene / 5));
				this.hit = tick.ticks(1.65);
				if (this.hp <= 0) { this.dead = tick.DEAD_DELAY; this.murder = ["players", other.origin]; this.destroy = tick.DES; }
				break;
		}
		if (this.alpha < 1 && !this.dev.invisible) {
			this.alpha = Math.min(1, this.alpha + (oldHp - this.hp) / this.maxHp * 5)
		}
	}
	// One-shot achievement unlock: pushes the registry's toast onto the same mess feed the
	// two legacy flags (mess_cursed_score / mess_im_speed) used to push directly, so the
	// client's existing '/img <file>' toast handling needs no changes.
	unlock(id) {
		if (this.unlocked[id]) { return; }
		this.unlocked[id] = 1;
		const entry = ACHIEVEMENTS.find((a) => a.id === id);
		this.mess.push('/img ' + (entry ? entry.icon : 'achievement.png'));
	}
	// Farmable-shape kill tally, called from Room.js's collision resolution where the killer
	// and the destroyed Objects instance's type ('sqr'/'tri'/'pnt') are both in scope.
	registerKill(type) {
		if (type === 'pnt') {
			this.unlock('penta_slayer');
			return;
		}
		this.killCounts[type] = (this.killCounts[type] || 0) + 1;
		if (type === 'sqr' && this.killCounts.sqr >= 200) {
			this.unlock('kawaii_smash');
		}
	}
	update() {
		this.hit = Math.max(0, this.hit - 1);
		if (this.pet) {
			this.pet.update(this);
			this.pet.alpha = this.alpha;
			this.pet.size = this.size;
		}
		if (this.destroy > 1) {
			this.x += this.vec.x;
			this.y += this.vec.y;
			this.destroy -= 1;
			this.alpha = (this.destroy - 1) / tick.DES;
			this.size *= tick.drag(1.04869);   // one-time-rescaled from 1.04 (33ms ref)
			this.screen = config.FOV_MUL * 2194;
			return;
		} else {
			if (this.hp <= 0) {
				this.destroy = tick.DES;
				this.dead = 1;
			}
			if (this.hpregan[0] > this.hp) {
				this.hpregan[0] = this.hp;
				this.hpregan[1] = 0;
			} else {
				this.hpregan[0] = this.hp;
			}
			if (this.hp < this.maxHp) {
				// 673818.75 = 990000 one-time-rescaled (33ms ref) for this quadratic accumulator -
				// it integrates twice over ticks, so tick.quadratic() (SCALE^2) applies at the
				// increment, not the hp += below, which just reads the already-scaled result.
				this.hpregan[1] += tick.quadratic(this.up.HpRegan / 673818.75);
				this.hp += (parseInt(this.hpregan[1] * this.maxHp * 10)) / 10;
				this.hp = Math.min(this.maxHp, this.hp);
			} else {
				this.hp = this.maxHp;
			}
		}
		///
		if (CLASS[this.class].alpha) {
			this.alpha = Math.max(0, this.alpha - tick.perTick(CLASS[this.class].alpha));
		} else if (!this.dev.invisible) { this.alpha = 1 }
		this.motion();
		if (this.inputs.c) {
			this.dir = this.autoDir;
		}
		this.shoot();
		///
		if (this.xp >= this.XPLVL[this.level]) {
			if (this.level === 18 || this.level === 27) {
				this.stillLvl++;
			}
			this.hp += 3;
			this.maxHp += 3;
			this.level++;
			if (this.level >= this.XPLVL.length) { this.unlock('the_end'); }
		}
		if (this.shield) {
			this.shield--;
		}
		if (this.state.disconnect) {
			this.hp -= tick.perTick(this.maxHp / 826.44628);   // 826.44628 = 1000 one-time-rescaled (33ms ref)
			if (this.hp <= 0) {
				this.destroy = tick.DES;
			}
		}
		this.size = 28 + this.dev.size + Math.floor(this.level / 2.8);
		// FOV (massplanchunks WP4): diep is 1.39x wider than us at level 1 and grows
		// multiplicatively at half the tank's own growth rate (PENDING.md item 19), not the old
		// flat +22/level guess.
		this.screen = this.extraView + CLASS[this.class].screen * config.FOV_MUL * Math.pow(config.FOV_PER_LEVEL, this.level);
		if (this.xp !== this.oldXp) {
			this.oldXp = this.xp;
			if (this.xp === 666666 && !this.bot) {
				this.unlock('cursed_score');
			}
			if (this.xp < this.XPLVL[this.XPLVL.length - 3]) {
				this.prize = parseInt(Math.min(this.XPLVL[this.XPLVL.length - 3], Math.pow(this.xp / this.mlx, 1.8)));
			} else {
				this.prize = parseInt(this.XPLVL[this.XPLVL.length - 3] + (this.xp - this.XPLVL[this.XPLVL.length - 3]) / 10);
			}
		}
		if (this.class === 'Rocket' && this.upNb[0] === 6 && this.upNb[1] === 6) {
			this.unlock('speed_demon');
		}
		///
		if (this.dev.stick) {
			const obj = this.room.INSTANCE[this.dev.stick[0]].get(this.dev.stick[1]);
			if (obj && !obj.destroy) {
				obj.x += (this.x + this.inputs.mouse_x - obj.x) * 0.2;
				obj.y += (this.y + this.inputs.mouse_y - obj.y) * 0.2;
			} else {
				this.dev.stick = null;
			}
		}
	}
}

// Type tag for collision / buffer dispatch - on the prototype, so it costs nothing per
// instance. See public/SHARE/kinds.js for why this replaced `constructor.name`.
Player.prototype.kind = KIND.PLAYER;

module.exports = Player;
