/*
	Bullet - projectiles, including drone / trap / necro behaviour.

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
const KIND = require('../public/SHARE/kinds.js');

class Bullet {
	constructor(origin, x, y, direction, speed, exitSpeed) {
		this.BUFF = {
			timestamp: -1,
		};
		this.id = 0;
		this.origin = origin;
		this.class = 0;
		this.life = 130;
		this.team = 0;
		this.type = 0;
		this.pene = 1;
		this.weight = 0;
		this.damage = 0;
		this.size = 10;
		this.x = x;
		this.y = y;
		this.alpha = 1;
		this.map = {};
		this.map.width = 10000;
		this.map.height = 10000;
		this.dir = direction;
		this.showDir = 0;
		this.maxspeed = speed;
		this.speed = speed;
		this.destroy = 0;
		this.vec = new Vec(speed * exitSpeed, 0).rotate(direction);
	}
	collision(other, option = {}) {
		if (option.type) {
			switch (option.type) {
				case 'god':
					if (this.origin.oId === other.id.oId) {
						return;
					}
					this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(this.speed * 2 + 1, this.speed * 2 + 1)));
					return;
			}
		}
		if (option.base) {
			this.destroy = config.DES;
		}
		if (other) {
			switch (other.kind) {
				case KIND.PLAYER:
					if (option.noDam) { break; }
					if (this.origin.oId === other.id.oId) {
						return;
					}
					this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(this.weight, this.weight)));
					this.pene -= Math.max(1, this.pene / 5);
					if (this.pene <= 0) { this.destroy = config.DES }
					break;
				case KIND.OBJECTS:
					this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(this.weight, this.weight)));
					if (this.necro && other.type === 'sqr') {
						const play = RT.Controller.server[this.origin.GM][this.origin.sId].INSTANCE.players[this.origin.oId];
						if (play.droneCount < CLASS[play.class].maxDrone + play.upNb[1]) {
							play.droneCount++;
							const Bull = new RT.Bullet(play.id, other.x, other.y, Math.random() * Math.PI * 2, play.up.BSpeed * play.necro.speed, 0);
							Bull.type = play.necro.type;
							Bull.class = play.class;
							Bull.necro = play.necro.necro;
							Bull.pene = play.up.BPene * play.necro.pene;
							Bull.life = -1;
							Bull.damage = play.up.BDamage * play.necro.damage;
							Bull.size = other.size;
							Bull.weight = play.necro.weight;
							RT.Controller.server[play.id.GM][play.id.sId].createBullet(Bull, play);
							return;
						}
					}
					this.pene -= Math.max(this.pene / 2, 1);
					if (this.pene <= 0) { this.destroy = config.DES }
					break;
				case KIND.BULLET:
					if (other.origin.oId === this.origin.oId) {
						if ((parseInt(this.type) === 1 || parseInt(this.type) === 3) && this.type === other.type) {
							this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(this.weight, this.weight)));
						}
						return;
					} else {
					}
					if (option.noDam || this.type === 1.4) { break; }
					this.pene -= option.pene;
					if (this.pene <= 0) { this.destroy = config.DES; }
					break;
			}
		}
		if (this.destroy && this.life === -1) {
			const play = RT.Controller.server[this.origin.GM][this.origin.sId].INSTANCE["players"][this.origin.oId];
			if (play) {
				play.droneCount--;
			}
		}
	}
	update() {
		if (this.destroy > 1) {
			this.x += this.vec.x;
			this.y += this.vec.y;
			this.destroy -= 1;
			this.alpha = (this.destroy) / config.DES;
			this.size *= 1.03;
			return;
		}
		///
		let play;
		if (!this.alone) {
			play = RT.Controller.server[this.origin.GM][this.origin.sId].INSTANCE.players[this.origin.oId];
			if (typeof play === "undefined") {
				this.destroy = config.DES;
				return;
			} else {
				if (play.destroy > 1 || play.dead || play.state.disconnect || play.class !== this.class) {
					this.destroy = config.DES;
					return;
				}
			}
		}
		///
		switch (this.type) {
			case 0: break;
			//normal//drone
			case 1: {
				this.showDir = this.dir;
				if (!this.comingDir) {
					this.comingDir = 0;
				}
				this.speed = this.maxspeed;
				///
				if (!this.DETEC) {
					this.DETEC = new RT.Detector(play, this.x, this.y, 300, [KIND.PLAYER, KIND.OBJECTS])
					this.DETEC.team = this.team
				} else {
					this.DETEC.x = this.x;
					this.DETEC.y = this.y;
				}
				///
				if (play.inputs.mouseR) {
					const dir = Math.PI + Math.atan2((play.y + play.inputs.mouse_y) - this.y, play.x + play.inputs.mouse_x - this.x)
					this.dir = dir;
				} else if (play.inputs.mouseL || play.inputs.e) {
					const dir = Math.atan2((play.y + play.inputs.mouse_y) - this.y, play.x + play.inputs.mouse_x - this.x)
					this.dir = dir;
				} else {
					if (this.DETEC.select) {
						this.DETEC.enabled = 0;
						const other = this.DETEC.select;
						const dis = Math.sqrt(Math.pow(this.x - other.x, 2) + Math.pow(this.y - other.y, 2));
						const playdis = Math.sqrt(Math.pow(other.x - play.x, 2) + Math.pow(other.y - play.y, 2));
						if (dis < 300 && !other.destroy && playdis < play.screen / 4 && other.alpha) {
							this.dir = Math.atan2(other.y - this.y, other.x - this.x);
							break;
						} else {
							this.DETEC.reset();
							this.DETEC.enabled = 1;
						}
					}
					const playDis = Math.sqrt(Math.pow(this.x - play.x, 2) + Math.pow(this.y - play.y, 2))
					if (playDis < play.size * 3.5) {
						this.speed = .08;
						if (Math.random() > .999) {
							this.comingDir += Math.PI / 2;
						}
						const dir = Math.atan2(play.y + Math.sin(play.autoDir * 2 + this.comingDir) * play.size * 3 - this.y,
							play.x + Math.cos(play.autoDir * 2 + this.comingDir) * play.size * 3 - this.x);
						this.dir = dir;
						break;
					}
					const dir = Math.atan2((play.y) - this.y, play.x - this.x)
					this.dir = dir;
					this.comingDir = this.dir;
				}
				break;
			};
			//xcontrol//
			case 1.1: {
				this.showDir = this.dir;
				if (!this.comingDir) {
					this.comingDir = 0;
				}
				this.speed = this.maxspeed;
				if (play.droneCount === -1) {
					this.destroy = config.DES;
				}
				///
				if (!this.DETEC) {
					this.DETEC = new RT.Detector(play, this.x, this.y, 300, [KIND.PLAYER, KIND.OBJECTS])
					this.DETEC.team = this.team
				} else {
					this.DETEC.x = this.x;
					this.DETEC.y = this.y;
				}
				///
				if (this.DETEC.select) {
					this.DETEC.enabled = 0;
					const other = this.DETEC.select;
					const dis = Math.sqrt(Math.pow(this.x - other.x, 2) + Math.pow(this.y - other.y, 2));
					const playdis = Math.sqrt(Math.pow(other.x - play.x, 2) + Math.pow(other.y - play.y, 2));
					if (dis < 300 && !other.destroy && playdis < play.screen / 4 && other.alpha) {
						this.dir = Math.atan2(other.y - this.y, other.x - this.x);
						break;
					} else {
						this.DETEC.reset();
						this.DETEC.enabled = 1;
					}
				}
				const playDis = Math.sqrt(Math.pow(this.x - play.x, 2) + Math.pow(this.y - play.y, 2))
				if (playDis < play.size * 3) {
					this.speed = .08;
					if (Math.random() > .999) {
						this.comingDir += Math.PI / 2;
					}
					const dir = Math.atan2(play.y + Math.sin(play.autoDir * 2 + this.comingDir) * play.size * 3 - this.y,
						play.x + Math.cos(play.autoDir * 2 + this.comingDir) * play.size * 2.5 - this.x);
					this.dir = dir;
					break;
				}
				const dir = Math.atan2((play.y) - this.y, play.x - this.x)
				this.dir = dir;
				this.comingDir = this.dir;
				break;
			};
			//battleShip xcontrol//
			case 1.2: {
				this.showDir = this.vec.angle();
				this.speed = this.maxspeed;
				///
				if (!this.DETEC) {
					this.DETEC = new RT.Detector(play, this.x, this.y, 1400, [KIND.PLAYER, KIND.OBJECTS])
					this.DETEC.team = this.team
				} else {
					this.DETEC.x = this.x;
					this.DETEC.y = this.y;
				}
				///
				if (this.DETEC.select) {
					this.DETEC.enabled = 0;
					const other = this.DETEC.select;
					const dis = Math.sqrt(Math.pow(this.x - other.x, 2) + Math.pow(this.y - other.y, 2));
					if (!other.destroy && other.alpha) {
						this.dir = Math.atan2(other.y - this.y, other.x - this.x);
						break;
					} else {
						this.DETEC.reset();
						this.DETEC.enabled = 1;
					}
				}
				break;
			};
			//battleShip control//
			case 1.3: {
				this.showDir = this.vec.angle();
				///
				if (play.inputs.mouseR) {
					const dir = Math.PI + Math.atan2((play.y + play.inputs.mouse_y) - this.y, play.x + play.inputs.mouse_x - this.x)
					this.dir = dir;
				} else {
					const dir = Math.atan2((play.y + play.inputs.mouse_y) - this.y, play.x + play.inputs.mouse_x - this.x)
					this.dir = dir;
				}
				break;
			};
			//Base drone//
			case 1.4: {
				this.showDir = this.dir;
				if (!this.comingDir) {
					this.comingDir = 0;
				}
				if (!this.autoDir) { this.autoDir = 0; }
				this.autoDir += .012;
				this.speed = this.maxspeed;
				this.pene = 200;
				///
				if (!this.DETEC) {
					this.DETEC = new RT.Detector(this, this.x, this.y, 1200, [KIND.PLAYER])
					this.DETEC.team = this.team
				} else {
					this.DETEC.x = this.x;
					this.DETEC.y = this.y;
				}
				///
				if (this.DETEC.select) {
					this.DETEC.enabled = 0;
					const other = this.DETEC.select;
					const dis = Math.sqrt(Math.pow(this.x - other.x, 2) + Math.pow(this.y - other.y, 2));
					const basedis = Math.sqrt(Math.pow(other.x - this.ox, 2) + Math.pow(other.y - this.oy, 2));
					if (basedis < 1800 && !other.destroy) {
						this.dir = Math.atan2(other.y - this.y, other.x - this.x);
						break;
					} else {
						this.DETEC.reset();
						this.DETEC.enabled = 1;
					}
				}
				const baseDis = Math.sqrt(Math.pow(this.x - this.ox, 2) + Math.pow(this.y - this.oy, 2))
				if (baseDis < 320) {
					this.speed = .07;
					if (Math.random() > .999) {
						this.comingDir += Math.PI / 2;
					}
					const dir = Math.atan2(this.oy + Math.sin(this.autoDir + this.comingDir) * 300 - this.y,
						this.ox + Math.cos(this.autoDir + this.comingDir) * 300 - this.x);
					this.dir = dir;
					break;
				}
				this.dir = Math.atan2(this.oy - this.y, this.ox - this.x);
				break;
			};
			///////////////trap
			case 2: {
				if (!this.first) {
					this.first = 1;
					this.showDir = Math.random() * Math.PI * 2;
					this.speed += Math.random() * .2;
				}
				this.showDir += this.vec.length() / 100
					;
				this.speed *= .82;
				break;
			}
			///////////////square
			case 3: {
				this.showDir = this.dir;
				if (!this.comingDir) {
					this.comingDir = 0;
				}
				this.speed = this.maxspeed;
				///
				if (!this.DETEC) {
					this.DETEC = new RT.Detector(play, this.x, this.y, 300, [KIND.PLAYER, KIND.OBJECTS])
					this.DETEC.team = this.team
				} else {
					this.DETEC.x = this.x;
					this.DETEC.y = this.y;
				}
				///
				if (play.inputs.mouseR) {
					const dir = Math.PI + Math.atan2((play.y + play.inputs.mouse_y) - this.y, play.x + play.inputs.mouse_x - this.x)
					this.dir = dir;
				} else if (play.inputs.mouseL || play.inputs.e) {
					const dir = Math.atan2((play.y + play.inputs.mouse_y) - this.y, play.x + play.inputs.mouse_x - this.x)
					this.dir = dir;
				} else {
					if (this.DETEC.select) {
						this.DETEC.enabled = 0;
						const other = this.DETEC.select;
						const dis = Math.sqrt(Math.pow(this.x - other.x, 2) + Math.pow(this.y - other.y, 2));
						const playdis = Math.sqrt(Math.pow(other.x - play.x, 2) + Math.pow(other.y - play.y, 2));
						if (dis < 300 && !other.destroy && playdis < play.screen / 4 && other.alpha) {
							this.dir = Math.atan2(other.y - this.y, other.x - this.x);
							break;
						} else {
							this.DETEC.reset();
							this.DETEC.enabled = 1;
						}
					}
					const playDis = Math.sqrt(Math.pow(this.x - play.x, 2) + Math.pow(this.y - play.y, 2))
					if (playDis < play.size * 3.5) {
						this.speed = .08;
						if (Math.random() > .999) {
							this.comingDir += Math.PI / 2;
						}
						const dir = Math.atan2(play.y + Math.sin(play.autoDir * 2 + this.comingDir) * play.size * 3 - this.y,
							play.x + Math.cos(play.autoDir * 2 + this.comingDir) * play.size * 2.5 - this.x);
						this.dir = dir;
						break;
					}
					const dir = Math.atan2((play.y) - this.y, play.x - this.x)
					this.dir = dir;
					this.comingDir = this.dir;
				}
				break;
			};
			///bigCheese
			case 3.1: {
				if (isNaN(this.comingDir)) {
					this.comingDir = Math.PI * 2 * Math.random();
					this.randPos = play.size * (Math.random() * 1 + 2)
				}
				this.showDir = this.vec.angle();
				///
				if (play.detected.length >= 1) {
					let tar, minDis = play.screen;
					for (const n of play.detected) {
						const dis = Math.sqrt(Math.pow(n.x - this.x, 2) + Math.pow(n.y - this.y, 2));
						if (dis <= minDis) {
							minDis = dis;
							tar = n;
						}
					}
					if (tar && !tar.destory) {
						this.speed = this.maxspeed;
						this.dir = Math.atan2(tar.y - this.y, tar.x - this.x);
						break;
					}
				}
				/// else
				const playDis = Math.sqrt(Math.pow(this.x - play.x, 2) + Math.pow(this.y - play.y, 2))
				if (playDis < play.size * 4) {
					this.speed = Math.max(this.speed * .99, .05);
					if (Math.random() > .9995) {
						this.comingDir += Math.PI * .8;
						this.speed = this.maxspeed * 2;
					}
					const dir = Math.atan2(play.y + Math.sin(this.comingDir) * this.randPos - this.y,
						play.x + Math.cos(this.comingDir) * this.randPos - this.x);
					this.dir = dir;
					this.comingDir -= 0.01
				} else {
					const dir = Math.atan2(play.y - this.y, play.x - this.x)
					this.dir = dir;
					this.speed = this.maxspeed;
				}
				///
				break;
			};
		}
		this.vec.add(new Vec(this.speed, 0).rotate(this.dir))
		this.vec.x *= FRICTION;
		this.vec.y *= FRICTION;
		this.x += this.vec.x;
		this.y += this.vec.y;
		///
		if (this.life === -1) {
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
			return;
		};
		if (this.life === 0) {
			this.destroy = config.DES;
		} else {
			this.life -= 1;
		}
	}
}

// Type tag for collision / buffer dispatch - see public/SHARE/kinds.js.
Bullet.prototype.kind = KIND.BULLET;

module.exports = Bullet;
