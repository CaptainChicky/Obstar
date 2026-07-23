/*
	Player - the tank entity: motion, shooting, upgrades, class changes, collision.

	Extracted from the old Alex.js monolith (now server.js + lib/ + rooms/ + entities/).
	Cross-entity and Controller references go through the late-bound registry
	(lib/runtime.js) because the dependency graph is circular - see the note there.
*/
const RT = require('../lib/runtime.js');
const Vec = require('victor');
const config = require('../lib/config.js').config;
const termColors = require('../lib/terminal.js');
const CLASS = require('../public/SHARE/TanksConfig.js').class;
const CLASS_TREE = require('../public/SHARE/TanksConfig.js').tree;
const FRICTION = require('../lib/constants.js').FRICTION;
const KIND = require('../lib/kinds.js');

class Player {
	constructor(id, x, y, name, team, xpLvl) {
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
		this.shield = 6000;
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
		this.map = RT.Controller.server[this.id.GM][this.id.sId].map
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
		this.damage = 7;
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
		const key = this.inputs;
		const motion = new Vec(0, 0);
		const len = 0.35 + this.up.MSpeed - (this.level / 155);
		if (!this.state.disconnect) {
			if (key.w || key.arrw) { motion.y -= len; }
			if (key.s || key.arrs) { motion.y += len; }
			if (key.a || key.arra) { motion.x -= len; }
			if (key.d || key.arrd) { motion.x += len; }
		}
		if (motion.length() > 0) {
			this.vec.add(motion.norm().multiply(new Vec(len, len)));
			if (this.alpha < 1 && !this.dev.invisible) {
				this.alpha += Math.min(1, CLASS[this.class].alpha * 10);
			}
			if (this.shield) {
				this.shield = 0;
			}
		}
		this.vec.x *= FRICTION;
		this.vec.y *= FRICTION;
		this.x += this.vec.x;
		this.y += this.vec.y;
		this.autoDir += .015;
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
	shoot() {
		if (CLASS[this.class].DETEC) {
			if (!this.DETEC) {
				const detec = CLASS[this.class].DETEC;
				this.DETEC = new RT.Detector(this, this.x, this.y, detec.size, detec.type, detec.all)
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
		for (let r = 0; r < CLASS[this.class].canons.length; r++) {
			if (typeof this.shootTimer[r] === 'undefined') { this.shootTimer[r] = 0; }
			const can = CLASS[this.class].canons[r];
			const reloadMax = Math.round(can.reload * this.up.Reload);
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
						autoDir = Math.atan2(other.y + other.vec.y * dis / 12 - this.y, other.x + other.vec.x * dis / 12 - this.x);
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
						this.alpha += Math.min(1, CLASS[this.class].alpha * 30);
					}
					///
					const dir = can.autoDir ? autoDir : this.dir + can.offdir;
					const exitSpeed = can.exitSpeed ? can.exitSpeed : 40;
					const offx = can.offx * ra;
					const len = (can.canonLength * .93) * ra - ((this.up.BSpeed * can.speed) * exitSpeed * 2);
					const offlen = Math.sqrt(Math.pow(len, 2) + (offx * offx));
					const offdir = Math.atan(offx / len);
					const x = this.x + Math.cos(dir + offdir) * (offlen)//-can.size*ra);
					const y = this.y + Math.sin(dir + offdir) * (offlen)//-can.size*ra);
					const Bull = new RT.Bullet(this.id, x, y, dir + Math.random() * can.rand - can.rand / 2, this.up.BSpeed * can.speed, exitSpeed);
					Bull.type = (can.type ? can.type : 0);
					Bull.class = this.class;
					Bull.pene = this.up.BPene * can.pene;
					Bull.life = (can.life ? can.life : 130);
					Bull.damage = this.up.BDamage * can.damage;
					Bull.size = this.boss ? can.size : can.size * ra;
					Bull.weight = can.weight;
					RT.Controller.server[this.id.GM][this.id.sId].createBullet(Bull, this)
					this.vec.add(new Vec(can.back, 0).rotate(dir - Math.PI));
					if (maxD && can.life === -1) {
						this.droneCount++;
					}
					///
					this.recoil[parseInt(r)] = 1;
					setTimeout((x, r) => { x.recoil[r] = 0 }, 33, this, parseInt(r))
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
				const re = 0;
				for (const i in this.up) {
					nb++;
					if (nb !== data) { continue; }
					switch (i) {
						case "HpRegan": this.up[i] += 0.28; break;
						case "Reload": this.up[i] -= 0.092; break;
						case "BSpeed": this.up[i] += 0.11; break;
						case "BDamage": this.up[i] += .2; break;
						case "BPene": this.up[i] += 1.25; break;
						case "MSpeed": this.up[i] += 0.020; break;
						case "HpUp": this.maxHp += 110; this.hp = parseInt(this.hp * (this.maxHp / (this.maxHp - 100))); break;
						case "BodyDam": this.damage += 1.8; break;
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
			this.droneCount = 0;
			this.necro = CLASS[this.class].necro;
			this.shootTimer = new Array(CLASS[this.class].canons.length).fill(0);
		} else {
			return;
		}
	}
	collision(other, option = {}) {
		if (this.dev.ghost) { return; }
		if (option.type) {
			switch (option.type) {
				case 'god':
					this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(0.6, 0.6)));
					return;
			}
		}
		if (option.base) {
			this.alpha = 1;
			this.destroy = config.DES;
			this.dead = config.DEAD_DELAY;
			return;
		}
		const oldHp = this.hp;
		switch (other.kind) {
			case KIND.PLAYER:
				this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(0.3, 0.3)));
				if (option.noDam || this.shield) { break; }
				this.hp -= other.damage;
				this.hit = 2;
				if (this.hp <= 0) {
					this.dead = config.DEAD_DELAY;
					this.murder = ["players", other.id];
					this.destroy = config.DES;
					other.xp += this.prize;
					if (this.coinReward) other.coins += this.coinReward;
					if (!other.bot) {
						other.mess.push('You killed ' + this.name);
					}
				}
				break;
			case KIND.OBJECTS:
				const len = (this.vec.length() < 0.5) ? 2 : .5;
				this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(len, len)));
				if (this.necro && other.type === 'sqr' && this.droneCount < CLASS[this.class].maxDrone + this.upNb[1]) {
					this.droneCount++;
					const Bull = new RT.Bullet(this.id, other.x, other.y, Math.random() * Math.PI * 2, this.up.BSpeed * this.necro.speed, 0);
					Bull.type = this.necro.type;
					Bull.class = this.class;
					Bull.necro = this.necro.necro;
					Bull.pene = this.up.BPene * this.necro.pene;
					Bull.life = -1;
					Bull.damage = this.up.BDamage * this.necro.damage;
					Bull.size = other.size;
					Bull.weight = this.necro.weight;
					RT.Controller.server[this.id.GM][this.id.sId].createBullet(Bull, this);
					return;
				}
				if (this.shield) { return; }
				this.hp -= other.damage;
				this.hit = 2;
				if (this.hp <= 0) { this.dead = config.DEAD_DELAY; this.murder = ["objs", other.id]; this.destroy = config.DES }
				break;
			case KIND.BULLET:
				if (option.noDam) { break; }
				if (other.origin.oId === this.id.oId) {
					return;
				}
				if (this.bot) {
					this.lastBullet = other.origin;
				}
				this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(other.weight / 3, other.weight / 3)));
				if (this.shield) { return; }
				this.hp -= other.damage * Math.max(1, other.pene / 5);
				this.hit = 2;
				if (this.hp <= 0) { this.dead = config.DEAD_DELAY; this.murder = ["players", other.origin]; this.destroy = config.DES; }
				break;
		}
		if (this.alpha < 1 && !this.dev.invisible) {
			this.alpha = Math.min(1, this.alpha + (oldHp - this.hp) / this.maxHp * 5)
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
			this.alpha = (this.destroy - 1) / config.DES;
			this.size *= 1.04;
			this.screen = 2194;
			return;
		} else {
			if (this.hp <= 0) {
				this.destroy = config.DES;
				this.dead = 1;
			}
			if (this.hpregan[0] > this.hp) {
				this.hpregan[0] = this.hp;
				this.hpregan[1] = 0;
			} else {
				this.hpregan[0] = this.hp;
			}
			if (this.hp < this.maxHp) {
				this.hpregan[1] += this.up.HpRegan / 990000;
				this.hp += (parseInt(this.hpregan[1] * this.maxHp * 10)) / 10;
				this.hp = Math.min(this.maxHp, this.hp);
			} else {
				this.hp = this.maxHp;
			}
		}
		///
		if (CLASS[this.class].alpha) {
			this.alpha = Math.max(0, this.alpha - CLASS[this.class].alpha);
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
		}
		if (this.shield) {
			this.shield--;
		}
		if (this.state.disconnect) {
			this.hp -= this.maxHp / 1000;
			if (this.hp <= 0) {
				this.destroy = config.DES;
			}
		}
		this.size = 28 + this.dev.size + Math.floor(this.level / 2.8);
		this.screen = this.extraView + CLASS[this.class].screen + this.level * 22;
		if (this.xp !== this.oldXp) {
			this.oldXp = this.xp;
			if (this.xp === 666666 && !this.mess_cursed_score && !this.bot) {
				this.mess_cursed_score = 1;
				this.mess.push('/img mc_cursed_score.png');
			}
			if (this.xp < this.XPLVL[this.XPLVL.length - 3]) {
				this.prize = parseInt(Math.min(this.XPLVL[this.XPLVL.length - 3], Math.pow(this.xp / this.mlx, 1.8)));
			} else {
				this.prize = parseInt(this.XPLVL[this.XPLVL.length - 3] + (this.xp - this.XPLVL[this.XPLVL.length - 3]) / 10);
			}
		}
		if (this.class === 'Rocket' && !this.mess_im_speed && this.upNb[0] === 6 && this.upNb[1] === 6) {
			this.mess_im_speed = 1;
			this.mess.push('/img mc_im_speed.png');
		}
		///
		if (this.dev.stick) {
			const obj = RT.Controller.server[this.id.GM][this.id.sId].INSTANCE[this.dev.stick[0]][this.dev.stick[1]];
			if (obj && isNaN(obj) && !obj.destroy) {
				obj.x += (this.x + this.inputs.mouse_x - obj.x) * 0.2;
				obj.y += (this.y + this.inputs.mouse_y - obj.y) * 0.2;
			} else {
				this.dev.stick = null;
			}
		}
	}
}

// Type tag for collision / buffer dispatch - on the prototype, so it costs nothing per
// instance. See lib/kinds.js for why this replaced `constructor.name`.
Player.prototype.kind = KIND.PLAYER;

module.exports = Player;
