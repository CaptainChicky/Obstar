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
	Base drone orbit AI (plan.md WP4, corrected in WP4.5, rewritten again in WP4.5's "energy
	levels" pass). All converted once at module load, not per drone per tick.

	The steering model: every drone carries `head` (radians) and `spd` (units per real tick), both
	rate-limited (BASE_DRONE_TURN, BASE_DRONE_ACCEL) toward a per-state desired direction and
	target speed, and position is their integral - true for ORBIT/CHASE, NOT for a cross any more
	(below). That makes every transition continuous by construction outside a cross - none of them
	can turn the drone instantly or stop it dead, which is what WP4's position-authoritative polar
	path did.

	Radius is quantised into five shared "energy levels" now (plan.md WP4.5.1) rather than a
	continuous random band: a drone is always at one of rooms/Room.js's levelR(1..5), and the only
	thing that ever moves it between levels is levelSwitch() below, called from three triggers - a
	shape hit (this file's KIND.OBJECTS collision arm), drone-vs-drone proximity (rooms/Room.js's
	pair loop sets `tooClose`, consumed in case 1.4) and drifting home (case 1.4's own timer). Every
	one of those is the same 60-degree lean off the tangent, because config.BASE_DRONE_LEAN_SCALE is
	pinned so that a one-LEVEL_GAP radius error produces exactly that lean (see lib/config.js).

	The diameter cross is a planned two-segment quintic Hermite curve now (plan.md WP4.5.4), not a
	steered pursuit of an antipodal aim point - a turn-limited pursuit cannot be made to pass
	through a specific point (the aim-point pursuit's own turn radius at dash speed is comparable to
	the whole inner orbit). quinticHermite() evaluates one axis of that curve; case 1.4 calls it
	twice (x, y) per tick while `crossing`, and writes position/velocity/head/speed directly from
	it - the turn/accel limiter is bypassed for those ticks, since the curve's own curvature and
	acceleration already bound the motion.
*/
const BASE_DRONE_CROSS = tick.ticks(config.BASE_DRONE_CROSS);
const BASE_DRONE_ORBIT_SPEED = tick.perTick(config.BASE_DRONE_ORBIT_SPEED);
const BASE_DRONE_CHASE_SPEED = tick.perTick(config.BASE_DRONE_CHASE_SPEED);
const BASE_DRONE_CROSS_SPEED = tick.perTick(config.BASE_DRONE_CROSS_SPEED);
const BASE_DRONE_TURN = tick.perTick(config.BASE_DRONE_TURN);
const BASE_DRONE_ACCEL = tick.perTick(config.BASE_DRONE_ACCEL);
const BASE_DRONE_SWITCH_COOLDOWN = tick.ticks(config.BASE_DRONE_SWITCH_COOLDOWN);
const BASE_DRONE_LEVEL_RELAX = tick.ticks(config.BASE_DRONE_LEVEL_RELAX);

/*
	One segment of a quintic Hermite: position, velocity AND acceleration are matched at both
	endpoints (C2), unlike a cubic Hermite (position/velocity only) or smootherstep (zero
	derivative at both ends, which is what made the WP4 cross visibly stop dead twice per swoosh).
	`s` is the local 0..1 parameter, `T` the segment's duration in real ticks (the derivative terms
	are pre-scaled by T/T^2 so `va`/`aa`/`vb`/`ab` are plain per-tick quantities, not per-s ones).
	Returns {p, v} for one axis; case 1.4 calls this twice per tick while crossing (x, y).
*/
function quinticHermite(s, T, pa, va, aa, pb, vb, ab) {
	const s2 = s * s, s3 = s2 * s, s4 = s3 * s, s5 = s4 * s;
	const h0 = 1 - 10 * s3 + 15 * s4 - 6 * s5;
	const h1 = s - 6 * s3 + 8 * s4 - 3 * s5;
	const h2 = (s2 - 3 * s3 + 3 * s4 - s5) / 2;
	const h3 = 10 * s3 - 15 * s4 + 6 * s5;
	const h4 = -4 * s3 + 7 * s4 - 3 * s5;
	const h5 = (s3 - 2 * s4 + s5) / 2;
	const h0d = -30 * s2 + 60 * s3 - 30 * s4;
	const h1d = 1 - 18 * s2 + 32 * s3 - 15 * s4;
	const h2d = (2 * s - 9 * s2 + 12 * s3 - 5 * s4) / 2;
	const h3d = 30 * s2 - 60 * s3 + 30 * s4;
	const h4d = -12 * s2 + 28 * s3 - 15 * s4;
	const h5d = (3 * s2 - 8 * s3 + 5 * s4) / 2;
	const aT = aa * T * T, abT = ab * T * T, vaT = va * T, vbT = vb * T;
	const p = h0 * pa + h1 * vaT + h2 * aT + h3 * pb + h4 * vbT + h5 * abT;
	const v = (h0d * pa + h1d * vaT + h2d * aT + h3d * pb + h4d * vbT + h5d * abT) / T;
	return { p, v };
}

/*
	The one radial mechanism (plan.md WP4.5.2): move a drone exactly one energy level, toward a
	random open neighbour (`mode` 'random' - a shape hit or drone-proximity trigger) or the one
	neighbour toward BASE_DRONE_LEVEL_HOME (`mode` 'home' - the drift-home trigger). A neighbour is
	a candidate only if it is not already at its per-centre saturation cap (drone.levels.caps/
	count, from rooms/Room.js's levelPlan()). Does nothing - and leaves the cooldown alone, so the
	caller retries later - if every open neighbour is saturated.
*/
function levelSwitch(drone, mode) {
	const levels = drone.levels;
	const candidates = [];
	if (drone.level > 1 && levels.count[drone.level - 2] < levels.caps[drone.level - 2]) {
		candidates.push(drone.level - 1);
	}
	if (drone.level < config.BASE_DRONE_LEVELS && levels.count[drone.level] < levels.caps[drone.level]) {
		candidates.push(drone.level + 1);
	}
	let next = 0;
	if (mode === 'home') {
		const towardHome = drone.level < config.BASE_DRONE_LEVEL_HOME ? drone.level + 1 :
			drone.level > config.BASE_DRONE_LEVEL_HOME ? drone.level - 1 : 0;
		if (candidates.indexOf(towardHome) >= 0) { next = towardHome; }
	} else if (candidates.length) {
		next = candidates[Math.floor(Math.random() * candidates.length)];
	}
	if (!next) { return; }
	levels.count[drone.level - 1]--;
	levels.count[next - 1]++;
	drone.level = next;
	drone.orbRTarget = drone.room.levelR(next);
	drone.switchCooldown = BASE_DRONE_SWITCH_COOLDOWN;
	drone.levelTimer = BASE_DRONE_LEVEL_RELAX;
}

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
						Shape-hit reaction (plan.md WP4.5.2, trigger (a)): one 60-degree level switch,
						same mechanism a drone-proximity or drift-home trigger uses - not a knockback;
						ORBIT ignores this.vec entirely (it writes position directly), so the
						vec.add() above is a no-op for a drone in ORBIT. Suppressed mid-swoosh (the
						drone punches straight through, user-specified) and on cooldown (so a drone
						resting against a shape doesn't re-trigger every tick).
					*/
					if (this.type === 1.4 && !this.crossing && this.switchCooldown <= 0) {
						levelSwitch(this, 'random');
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
				Base drone (plan.md WP4, rewritten in WP4.5, rewritten again in WP4.5's energy-level
				pass). Outside a cross, heading (`head`) and speed (`spd`) are authoritative and
				rate-limited (BASE_DRONE_TURN/BASE_DRONE_ACCEL); position is their integral - every
				state below only has to produce a desired direction and a target speed, and the
				shared steering tail slews toward both and writes position, so a transition between
				them is continuous by construction. A cross (below) is the one exception: position
				comes from a planned quintic Hermite curve instead, matched to this same steering
				field at both seams, so the hand-off in and out of it is exact.

				`this.chasing` and `this.crossing` are the two real branches; ORBIT/RETURN are one
				"orbit field" driven off (x,y) relative to the base centre (ox,oy) - a drone far from
				its ring just leans harder toward it (BASE_DRONE_LEAN_MAX) and curls onto it as the
				error shrinks, so there is no separate RETURN state. Radius itself only ever moves in
				whole BASE_DRONE_LEVEL_GAP steps via levelSwitch() (module scope, above) - the field
				here just steers toward whichever radius the level table currently names.
				`this.orbitState` is written purely for tests/admin - nothing branches on it.
			*/
			case 1.4: {
				if (this.switchCooldown > 0) { this.switchCooldown--; }
				///
				if (!this.DETEC) {
					this.DETEC = new Detector(this, this.x, this.y, config.BASE_DRONE_DETECT, [KIND.PLAYER])
					this.DETEC.team = this.team
				} else {
					this.DETEC.x = this.x;
					this.DETEC.y = this.y;
				}
				// A live, in-leash target pulls the drone into CHASE from any state but a cross
				// (plan.md WP4.5.4 - abandoning a planned curve mid-flight is the one thing that can
				// reintroduce a velocity discontinuity). The leash is measured from the base centre,
				// not the drone, so a drone already out chasing doesn't get an easier time
				// re-engaging than one starting fresh off the ring.
				if (!this.chasing && !this.crossing && this.DETEC.select) {
					const other = this.DETEC.select;
					const basedis = Math.sqrt(Math.pow(other.x - this.ox, 2) + Math.pow(other.y - this.oy, 2));
					if (basedis < config.BASE_DRONE_LEASH && !other.destroy) {
						this.chasing = true;
						this.DETEC.enabled = 0;
					}
				}
				if (this.chasing) {
					const other = this.DETEC.select;
					const basedis = other ? Math.sqrt(Math.pow(other.x - this.ox, 2) + Math.pow(other.y - this.oy, 2)) : Infinity;
					if (!other || other.destroy || basedis >= config.BASE_DRONE_LEASH) {
						this.chasing = false;
						this.DETEC.reset();
						this.DETEC.enabled = 1;
					}
				}
				// Level-switch triggers (plan.md WP4.5.2): (b) drone-vs-drone proximity (`tooClose`,
				// set by rooms/Room.js's pair loop) and (c) drifting home, both funnelled through the
				// one levelSwitch() a shape hit (this class's KIND.OBJECTS collision arm) also uses.
				// Suppressed mid-cross/mid-chase - a drone busy on the planned curve or running down
				// prey doesn't also drift levels.
				if (!this.crossing && !this.chasing) {
					if (this.tooClose) {
						this.tooClose = 0;
						if (this.switchCooldown <= 0) { levelSwitch(this, 'random'); }
					}
					if (this.level !== config.BASE_DRONE_LEVEL_HOME) {
						if (--this.levelTimer <= 0) {
							levelSwitch(this, 'home');
							this.levelTimer = BASE_DRONE_LEVEL_RELAX;
						}
					} else {
						this.levelTimer = BASE_DRONE_LEVEL_RELAX;
					}
				} else {
					this.tooClose = 0;
				}
				// The diameter cross (plan.md WP4.5.4): triggered here, evaluated below. Suppressed
				// while chasing - crossIn only ever counts down in this branch - and gated by
				// `levels.crossing` (4.5.4's "one crosser per orbit centre"): a drone whose crossIn
				// has expired only actually starts when nobody else at its centre is mid-swoosh, and
				// does not reset crossIn while it waits, so a blocked drone starts the instant the
				// current one lands instead of losing its place in the queue.
				if (!this.chasing && !this.crossing && --this.crossIn <= 0 && this.levels.crossing === 0) {
					this.crossing = true;
					this.crossT = 0;
					const cx = this.x - this.ox, cy = this.y - this.oy;
					const r0 = Math.sqrt(cx * cx + cy * cy) || 1;
					const ux = cx / r0, uy = cy / r0;
					const tx = -uy * this.spin, ty = ux * this.spin;
					const R1 = this.room.levelR(1);
					// Freeze the entry frame (plan.md WP4.5.4's "setup at trigger"): segment A runs
					// P0->centre, segment B centre->P1, with the centre a knot on the path (Ac=0,
					// pure straight-line motion through it) and P1/V1/A1 exactly what the orbit field
					// itself produces there, so both hand-offs are exact, not approximate.
					this.crossP0x = this.x; this.crossP0y = this.y;
					this.crossV0x = this.vec.x; this.crossV0y = this.vec.y;
					this.crossA0x = this.vec.x - this.pvec.x; this.crossA0y = this.vec.y - this.pvec.y;
					this.crossVcx = -ux * BASE_DRONE_CROSS_SPEED; this.crossVcy = -uy * BASE_DRONE_CROSS_SPEED;
					this.crossP1x = this.ox - ux * R1; this.crossP1y = this.oy - uy * R1;
					this.crossV1x = -tx * BASE_DRONE_ORBIT_SPEED; this.crossV1y = -ty * BASE_DRONE_ORBIT_SPEED;
					const a1mag = BASE_DRONE_ORBIT_SPEED * BASE_DRONE_ORBIT_SPEED / R1;
					this.crossA1x = ux * a1mag; this.crossA1y = uy * a1mag;
					const vMean = (BASE_DRONE_ORBIT_SPEED + BASE_DRONE_CROSS_SPEED) / 2;
					this.crossTA = Math.max(2, Math.round(config.BASE_DRONE_CROSS_ARC * r0 / vMean));
					this.crossTB = Math.max(2, Math.round(config.BASE_DRONE_CROSS_ARC * R1 / vMean));
					this.levels.crossing++;
				}
				///
				if (this.crossing) {
					this.crossT++;
					let seg;
					if (this.crossT <= this.crossTA) {
						const s = this.crossT / this.crossTA;
						seg = {
							x: quinticHermite(s, this.crossTA, this.crossP0x, this.crossV0x, this.crossA0x, this.ox, this.crossVcx, 0),
							y: quinticHermite(s, this.crossTA, this.crossP0y, this.crossV0y, this.crossA0y, this.oy, this.crossVcy, 0)
						};
					} else {
						const s = Math.min(1, (this.crossT - this.crossTA) / this.crossTB);
						seg = {
							x: quinticHermite(s, this.crossTB, this.ox, this.crossVcx, 0, this.crossP1x, this.crossV1x, this.crossA1x),
							y: quinticHermite(s, this.crossTB, this.oy, this.crossVcy, 0, this.crossP1y, this.crossV1y, this.crossA1y)
						};
					}
					// Position, velocity AND head/spd all come from the curve - writing head/spd
					// (rather than leaving them stale) is what makes the exit seamless, since the
					// shared steering tail resumes from exactly the state the curve ended in.
					this.x = seg.x.p; this.y = seg.y.p;
					this.vec.x = seg.x.v; this.vec.y = seg.y.v;
					this.head = Math.atan2(this.vec.y, this.vec.x);
					this.spd = Math.hypot(this.vec.x, this.vec.y);
					this.showDir = this.dir = this.head;
					this.orbitState = 'CROSS';
					if (this.crossT >= this.crossTA + this.crossTB) {
						// Lands at level 1 by construction, ignoring saturation deliberately (plan.md
						// WP4.5.4) - a swoosh always ends at the lowest level, so count[0] may
						// transiently exceed caps[0]; only voluntary switches into level 1 respect
						// the cap, so the excess only ever drains.
						this.crossing = false;
						this.crossIn = BASE_DRONE_CROSS;
						this.levels.crossing--;
						this.levels.count[this.level - 1]--;
						this.level = 1;
						this.levels.count[0]++;
						this.orbRTarget = this.room.levelR(1);
						this.levelTimer = BASE_DRONE_LEVEL_RELAX;
					}
					this.pvec.x = this.vec.x; this.pvec.y = this.vec.y;
					this.clampToMap();
					return;
				}
				///
				let dx, dy, targetSpeed;
				if (this.chasing) {
					const other = this.DETEC.select;
					dx = other.x - this.x;
					dy = other.y - this.y;
					targetSpeed = BASE_DRONE_CHASE_SPEED;
				} else {
					// The orbit field: tangential, with a radial lean toward orbRTarget. Never
					// normalised - only its angle feeds the turn limiter below, so a saturated lean
					// just steers straighter at the ring, it never changes target speed. Radius
					// (orbRTarget) itself only ever moves in discrete LEVEL_GAP steps, via
					// levelSwitch() above and in collision() - this field just steers toward
					// whichever target the level table currently says.
					const ex = this.x - this.ox, ey = this.y - this.oy;
					const r = Math.sqrt(ex * ex + ey * ey) || 1;
					const ux = ex / r, uy = ey / r;
					const tx = -uy * this.spin, ty = ux * this.spin;
					const err = this.orbRTarget - r;   // + = must move outward
					const lean = Math.max(-config.BASE_DRONE_LEAN_MAX,
						Math.min(config.BASE_DRONE_LEAN_MAX, err / config.BASE_DRONE_LEAN_SCALE));
					dx = tx + ux * lean;
					dy = ty + uy * lean;
					targetSpeed = BASE_DRONE_ORBIT_SPEED;
				}
				// Descriptive only (tests/admin dump) - nothing above or below branches on this.
				{
					const r = Math.sqrt(Math.pow(this.x - this.ox, 2) + Math.pow(this.y - this.oy, 2));
					this.orbitState = this.chasing ? 'CHASE' : (r > this.orbRTarget * 1.5 ? 'RETURN' : 'ORBIT');
				}
				// Shared steering tail: slew heading and speed toward the state's desired
				// direction/target speed, then integrate. Every state above funnels through this,
				// which is what makes every transition C1 with no state able to stop or snap it.
				const desired = Math.atan2(dy, dx);
				let dHead = Math.atan2(Math.sin(desired - this.head), Math.cos(desired - this.head));
				dHead = Math.max(-BASE_DRONE_TURN, Math.min(BASE_DRONE_TURN, dHead));
				this.head += dHead;
				let dSpd = targetSpeed - this.spd;
				dSpd = Math.max(-BASE_DRONE_ACCEL, Math.min(BASE_DRONE_ACCEL, dSpd));
				this.spd += dSpd;
				this.vec.x = Math.cos(this.head) * this.spd;
				this.vec.y = Math.sin(this.head) * this.spd;
				this.x += this.vec.x;
				this.y += this.vec.y;
				this.showDir = this.dir = this.head;
				this.pvec.x = this.vec.x; this.pvec.y = this.vec.y;
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
	// tail above and case 1.4's steering tail (plan.md WP4.5.4), which returns before ever
	// reaching that tail.
	clampToMap() {
		if (this.x < -this.map.width / 2) { this.x = -this.map.width / 2; this.vec.x = 0; }
		if (this.y < -this.map.height / 2) { this.y = -this.map.height / 2; this.vec.y = 0; }
		if (this.x > this.map.width / 2) { this.x = this.map.width / 2; this.vec.x = 0; }
		if (this.y > this.map.height / 2) { this.y = this.map.height / 2; this.vec.y = 0; }
	}
}

// Type tag for collision / buffer dispatch - see public/SHARE/kinds.js.
Bullet.prototype.kind = KIND.BULLET;

module.exports = Bullet;
