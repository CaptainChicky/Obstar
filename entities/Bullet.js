/*
	Bullet - projectiles, including drone / trap / necro behaviour.

	Extracted from the old Alex.js monolith (now server.js + lib/ + rooms/ + entities/).
	Bullets never cross rooms - a bullet only ever looks up its own origin's room - so it holds
	a direct `this.room` reference instead of reaching through a registry.
*/
const Vec = require('victor');
const tick = require('../lib/tick.js');
const config = require('../lib/config.js').config;
const CLASS = require('../public/SHARE/TanksConfig.js').class;
const FRICTION = tick.drag(require('../lib/constants.js').FRICTION);
const KIND = require('../public/SHARE/kinds.js');
const Detector = require('./Detector.js');

// Per-tick re-aim chance for homing bullets/drones - one-time-rescaled from the old .999/.9995
// thresholds (33ms ref), then converted to a real-tick probability once at load (massplanchunks
// WP3's "chance" category).
const REAIM_CHANCE = tick.chance(0.0012121);
const CHARGE_CHANCE = tick.chance(0.0006061);

/*
	Base drone orbit AI (plan.md WP4). All converted once at module load, not per drone per tick.

	BASE_DRONE_ORBIT_SPEED is a linear tangential speed (units/real-tick); dividing it by a
	drone's own orbR each tick gives that drone's angular rate, so inner drones sweep faster -
	see the case 1.4 ORBIT branch below.

	BASE_DRONE_HIT_KICK is the total radial displacement a shape hit imparts, derived the same
	way plan.md WP4.6 derives it by hand (radialV x duration): a 60 degree deflection off the
	tangent is a radial burst of v_orb * tan(60 deg), applied for BASE_DRONE_HIT_TIME.
*/
const BASE_DRONE_CROSS = tick.ticks(config.BASE_DRONE_CROSS);
const BASE_DRONE_CROSS_TIME = tick.ticks(config.BASE_DRONE_CROSS_TIME);
const BASE_DRONE_ORBIT_SPEED = tick.perTick(config.BASE_DRONE_ORBIT_SPEED);
const BASE_DRONE_SPIRAL = tick.smoothing(config.BASE_DRONE_SPIRAL);
const BASE_DRONE_HIT_TICKS = tick.ticks(config.BASE_DRONE_HIT_TIME);
const BASE_DRONE_HIT_KICK = tick.perTick(1.732 * config.BASE_DRONE_ORBIT_SPEED) * BASE_DRONE_HIT_TICKS;
const BASE_DRONE_HIT_COOLDOWN = tick.ticks(config.BASE_DRONE_HIT_COOLDOWN);

// Ease-in-out for the diameter cross (plan.md WP4.4) - what makes it read as a swoosh through
// the centre rather than a constant-speed traverse.
function smootherstep(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

class Bullet {
	constructor(origin, x, y, direction, speed, exitSpeed, room) {
		this.BUFF = {
			timestamp: -1,
		};
		this.id = 0;
		this.room = room;
		this.origin = origin;
		this.class = 0;
		this.life = tick.ticks(107);   // 107 = 130 one-time-rescaled from the 33ms reference
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
		this.vec = new Vec(tick.perTick(speed) * exitSpeed, 0).rotate(direction);
	}
	collision(other, option = {}) {
		if (option.type) {
			switch (option.type) {
				case 'god':
					if (this.origin.oId === other.id.oId) {
						return;
					}
					this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.perTick(this.speed * 2 + 0.91418), tick.perTick(this.speed * 2 + 0.91418))));
					return;
			}
		}
		if (option.base) {
			this.destroy = tick.DES;
		}
		if (other) {
			switch (other.kind) {
				case KIND.PLAYER:
					if (option.noDam) { break; }
					if (this.origin.oId === other.id.oId) {
						return;
					}
					this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.perTick(this.weight), tick.perTick(this.weight))));
					// An ordinary bullet spends its own pene against itself, target-independent.
					// A base drone cannot: its pene IS a 2000-point health pool, so pene/5 would
					// be 400 a tick and it would die in five ticks of touching the player it is
					// attacking. It takes the player's body damage instead - the same model as a
					// tank taking body damage, which is what makes poking in and out with
					// something high-DPS the way to kill one.
					this.pene -= (this.type === 1.4)
						? tick.perTick(other.damage)
						: tick.perTick(Math.max(1, this.pene / 5));
					if (this.pene <= 0) { this.destroy = tick.DES }
					break;
				case KIND.OBJECTS:
					this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.perTick(this.weight), tick.perTick(this.weight))));
					/*
						Shape-hit reaction (plan.md WP4.6): a quick radial kick off the current orbit,
						not a knockback - ORBIT ignores this.vec entirely (it writes position
						directly), so the vec.add() above is a no-op for a drone in ORBIT. Suppressed
						mid-swoosh (the drone punches straight through, user-specified) and on
						cooldown (so a drone resting against a shape doesn't re-trigger every tick).
						Moves orbRTarget, not orbR, so the spiral (WP4.5) carries it to the new radius
						over the following ticks instead of snapping back immediately.
					*/
					if (this.type === 1.4 && !this.crossing && this.hitCooldown <= 0) {
						const sign = Math.random() < 0.5 ? -1 : 1;
						this.orbRTarget = Math.min(
							this.orbitR * config.BASE_DRONE_ORBIT_R_MAX,
							Math.max(this.orbitR * config.BASE_DRONE_ORBIT_R_MIN, this.orbRTarget + sign * BASE_DRONE_HIT_KICK)
						);
						this.hitCooldown = BASE_DRONE_HIT_COOLDOWN;
					}
					if (this.necro && other.type === 'sqr') {
						const play = this.room.INSTANCE.players.get(this.origin.oId);
						if (play.droneCount < CLASS[play.class].maxDrone + play.upNb[1]) {
							play.droneCount++;
							const Bull = new Bullet(play.id, other.x, other.y, Math.random() * Math.PI * 2, play.up.BSpeed * play.necro.speed, 0, this.room);
							Bull.type = play.necro.type;
							Bull.class = play.class;
							Bull.necro = play.necro.necro;
							Bull.pene = play.up.BPene * play.necro.pene;
							Bull.life = -1;
							Bull.damage = play.up.BDamage * play.necro.damage;
							Bull.size = other.size;
							Bull.weight = play.necro.weight;
							play.room.createBullet(Bull, play);
							return;
						}
					}
					// Same trap as the KIND.PLAYER arm above, and worse (pene/2, not pene/5): a
					// base drone's pene is health, not a spend-down budget.
					this.pene -= (this.type === 1.4)
						? tick.perTick(other.damage)
						: tick.perTick(Math.max(this.pene / 2, 1));
					if (this.pene <= 0) { this.destroy = tick.DES }
					break;
				case KIND.BULLET:
					if (other.origin.oId === this.origin.oId) {
						if ((parseInt(this.type) === 1 || parseInt(this.type) === 3) && this.type === other.type) {
							this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.perTick(this.weight), tick.perTick(this.weight))));
						}
						return;
					} else {
					}
					// Base drones used to be exempt here, which is most of what made them
					// immortal. Same-team protection is unaffected: rooms/Room.js sets noDam on
					// both sides of any same-team, non-Objects pair when rules.teamPlay is on
					// (both team modes), and that check runs before this decrement and before
					// every vec.add() above - so friendly fire and friendly knockback both stay
					// off for a drone and its own side.
					if (option.noDam) { break; }
					this.pene -= tick.perTick(option.pene);
					if (this.pene <= 0) { this.destroy = tick.DES; }
					break;
			}
		}
		if (this.destroy && this.life === -1) {
			const play = this.room.INSTANCE["players"].get(this.origin.oId);
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
			this.alpha = (this.destroy) / tick.DES;
			this.size *= tick.drag(1.03648);   // one-time-rescaled from 1.03 (33ms ref)
			return;
		}
		///
		let play;
		if (!this.alone) {
			play = this.room.INSTANCE.players.get(this.origin.oId);
			if (typeof play === "undefined") {
				this.destroy = tick.DES;
				return;
			} else {
				if (play.destroy > 1 || play.dead || play.state.disconnect || play.class !== this.class) {
					this.destroy = tick.DES;
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
					this.DETEC = new Detector(play, this.x, this.y, 300, [KIND.PLAYER, KIND.OBJECTS])
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
						this.speed = 0.07313;   // one-time-rescaled from .08 (singleAppFactor, see Physics.js)
						if (Math.random() < REAIM_CHANCE) {
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
					this.destroy = tick.DES;
				}
				///
				if (!this.DETEC) {
					this.DETEC = new Detector(play, this.x, this.y, 300, [KIND.PLAYER, KIND.OBJECTS])
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
					this.speed = 0.07313;   // one-time-rescaled from .08 (singleAppFactor, see Physics.js)
					if (Math.random() < REAIM_CHANCE) {
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
					this.DETEC = new Detector(play, this.x, this.y, 1400, [KIND.PLAYER, KIND.OBJECTS])
					this.DETEC.team = this.team
				} else {
					this.DETEC.x = this.x;
					this.DETEC.y = this.y;
				}
				///
				if (this.DETEC.select) {
					this.DETEC.enabled = 0;
					const other = this.DETEC.select;
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
			/*
				Base drone (plan.md WP4). A state machine, not a single carrot-chase: the old code
				steered toward a point walking the ring at 0.364 rad/s while the drone's own top
				speed topped out at 56.8 u/s - at orbitR 405 the carrot needed 147 u/s, so the drone
				was 2.6x too slow to ever catch it and instead crawled round at whatever the lag
				produced. ORBIT below is kinematic (position written directly, not pursued) so it
				can't fall into that trap; CHASE/RETURN are unchanged pursuit, falling through to
				the shared motion tail via `break`. ORBIT instead `return`s directly out of update()
				- see clampToMap().
			*/
			case 1.4: {
				// CHASE/RETURN draw one tick stale, same as every other homing bullet type above -
				// showDir is only written fresh below for ORBIT, which needs it to actually track
				// the tangent+radial motion (plan.md WP4.3), not a pursuit direction.
				this.showDir = this.dir;
				if (this.hitCooldown > 0) { this.hitCooldown--; }
				///
				if (!this.DETEC) {
					this.DETEC = new Detector(this, this.x, this.y, config.BASE_DRONE_DETECT, [KIND.PLAYER])
					this.DETEC.team = this.team
				} else {
					this.DETEC.x = this.x;
					this.DETEC.y = this.y;
				}
				// A live, in-leash target pulls the drone off its ring from any state. The leash is
				// measured from the base centre, not the drone, so a drone already out chasing
				// doesn't get an easier time re-engaging than one starting fresh off the ring.
				if (this.orbitState !== 'CHASE' && this.DETEC.select) {
					const other = this.DETEC.select;
					const basedis = Math.sqrt(Math.pow(other.x - this.ox, 2) + Math.pow(other.y - this.oy, 2));
					if (basedis < config.BASE_DRONE_LEASH && !other.destroy) {
						this.orbitState = 'CHASE';
						this.DETEC.enabled = 0;
					}
				}
				if (this.orbitState === 'CHASE') {
					const other = this.DETEC.select;
					const basedis = other ? Math.sqrt(Math.pow(other.x - this.ox, 2) + Math.pow(other.y - this.oy, 2)) : Infinity;
					if (!other || other.destroy || basedis >= config.BASE_DRONE_LEASH) {
						this.DETEC.reset();
						this.DETEC.enabled = 1;
						this.orbitState = this.enterOrbitIfClose() ? 'ORBIT' : 'RETURN';
					} else {
						this.dir = Math.atan2(other.y - this.y, other.x - this.x);
						this.speed = this.maxspeed;
						break;   // fall through to the shared pursuit motion tail
					}
				}
				if (this.orbitState === 'RETURN') {
					if (this.enterOrbitIfClose()) {
						this.orbitState = 'ORBIT';
					} else {
						this.dir = Math.atan2(this.oy - this.y, this.ox - this.x);
						this.speed = this.maxspeed;
						break;   // fall through to the shared pursuit motion tail
					}
				}
				// ORBIT - a kinematic polar path: position is written directly from (orbA, orbR)
				// rather than steered toward with acceleration, so it can't lag its own target the
				// way the old carrot-chase did.
				const fromX = this.x, fromY = this.y;
				if (!this.crossing) {
					if (--this.crossIn <= 0) {
						// Diameter cross (WP4.4): straight chord through the centre to the
						// antipodal angle, undershooting the far radius so it reads as a swoosh
						// through the middle rather than arriving exactly back on the ring.
						this.crossing = true;
						this.crossElapsed = 0;
						this.crossFrom = { x: this.x, y: this.y };
						const toA = this.orbA + Math.PI;
						const toR = Math.max(1, this.orbRTarget - config.BASE_DRONE_CROSS_UNDERSHOOT);
						this.crossTo = { x: this.ox + Math.cos(toA) * toR, y: this.oy + Math.sin(toA) * toR };
						this.crossIn = BASE_DRONE_CROSS;
					} else {
						// Spiral-out (WP4.5): relax toward this drone's own target radius between
						// crossings, so it never quite settles. ORBIT_SPEED is a linear tangential
						// speed, so dividing by orbR gives inner drones a faster angular rate -
						// what keeps the whole base churning instead of frozen in formation.
						this.orbR += (this.orbRTarget - this.orbR) * BASE_DRONE_SPIRAL;
						this.orbA += BASE_DRONE_ORBIT_SPEED / this.orbR;
						this.x = this.ox + Math.cos(this.orbA) * this.orbR;
						this.y = this.oy + Math.sin(this.orbA) * this.orbR;
					}
				}
				if (this.crossing) {
					this.crossElapsed++;
					const t = Math.min(1, this.crossElapsed / BASE_DRONE_CROSS_TIME);
					const e = smootherstep(t);
					this.x = this.crossFrom.x + (this.crossTo.x - this.crossFrom.x) * e;
					this.y = this.crossFrom.y + (this.crossTo.y - this.crossFrom.y) * e;
					if (t >= 1) {
						this.crossing = false;
						this.orbA += Math.PI;
						this.orbR = Math.max(1, this.orbRTarget - config.BASE_DRONE_CROSS_UNDERSHOOT);
					}
				}
				this.vec.x = this.x - fromX;
				this.vec.y = this.y - fromY;
				this.showDir = this.dir = Math.atan2(this.vec.y, this.vec.x);
				this.clampToMap();
				return;
			};
			///////////////trap
			case 2: {
				if (!this.first) {
					this.first = 1;
					this.showDir = Math.random() * Math.PI * 2;
					this.speed += tick.perTick(Math.random() * 0.17916);   // .2 one-time-rescaled against the trap's own .82 decay (not global FRICTION)
				}
				this.showDir += tick.perTick(this.vec.length() / 100)
					;
				this.speed *= tick.drag(0.7862);   // .82 one-time-rescaled (33ms ref)
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
					this.DETEC = new Detector(play, this.x, this.y, 300, [KIND.PLAYER, KIND.OBJECTS])
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
						this.speed = 0.07313;   // one-time-rescaled from .08 (singleAppFactor, see Physics.js)
						if (Math.random() < REAIM_CHANCE) {
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
					this.speed = Math.max(this.speed * tick.drag(0.98789), .05);   // .99 one-time-rescaled (33ms ref)
					if (Math.random() < CHARGE_CHANCE) {
						this.comingDir += Math.PI * .8;
						this.speed = this.maxspeed * 2;
					}
					const dir = Math.atan2(play.y + Math.sin(this.comingDir) * this.randPos - this.y,
						play.x + Math.cos(this.comingDir) * this.randPos - this.x);
					this.dir = dir;
					this.comingDir -= tick.perTick(0.01212)   // .01 one-time-rescaled (33ms ref)
				} else {
					const dir = Math.atan2(play.y - this.y, play.x - this.x)
					this.dir = dir;
					this.speed = this.maxspeed;
				}
				///
				break;
			};
		}
		this.vec.add(new Vec(tick.perTick(this.speed), 0).rotate(this.dir))
		this.vec.x *= FRICTION;
		this.vec.y *= FRICTION;
		this.x += this.vec.x;
		this.y += this.vec.y;
		///
		if (this.life === -1) {
			this.clampToMap();
			return;
		};
		if (this.life === 0) {
			this.destroy = tick.DES;
		} else {
			this.life -= 1;
		}
	}
	// Hard-stop map clamp for a life===-1 bullet (a base drone). Shared by the ordinary motion
	// tail above and case 1.4 ORBIT's direct-write path (plan.md WP4.2), which returns before
	// ever reaching that tail.
	clampToMap() {
		if (this.x < -this.map.width / 2) { this.x = -this.map.width / 2; this.vec.x = 0; }
		if (this.y < -this.map.height / 2) { this.y = -this.map.height / 2; this.vec.y = 0; }
		if (this.x > this.map.width / 2) { this.x = this.map.width / 2; this.vec.x = 0; }
		if (this.y > this.map.height / 2) { this.y = this.map.height / 2; this.vec.y = 0; }
	}
	/*
		RETURN -> ORBIT transition (plan.md WP4.2/4.3): if the drone is already inside its own
		ring when a chase ends, seed the polar state from where it actually is and enter ORBIT
		directly rather than detouring through a RETURN step it doesn't need. Zeroes vec so no
		leftover chase momentum leaks into the kinematic path.
	*/
	enterOrbitIfClose() {
		const dx = this.x - this.ox, dy = this.y - this.oy;
		const dis = Math.sqrt(dx * dx + dy * dy);
		if (dis >= this.orbitR + this.size) { return false; }
		this.orbA = Math.atan2(dy, dx);
		this.orbR = dis;
		this.vec.x = 0;
		this.vec.y = 0;
		return true;
	}
}

// Type tag for collision / buffer dispatch - see public/SHARE/kinds.js.
Bullet.prototype.kind = KIND.BULLET;

module.exports = Bullet;
