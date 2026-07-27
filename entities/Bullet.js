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
const BASE_DRONE_CROSS_SEAM_SPEED = tick.perTick(config.BASE_DRONE_CROSS_SEAM_SPEED);
const BASE_DRONE_TURN = tick.perTick(config.BASE_DRONE_TURN);
// Used in place of BASE_DRONE_TURN whenever a drone is chasing (plan.md WP4.5.1) - a dash needs
// its own, much tighter turn radius or a "faster chase" would only make the AI worse (see
// lib/config.js's comment).
const BASE_DRONE_CHASE_TURN = tick.perTick(config.BASE_DRONE_CHASE_TURN);
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
	random open neighbour (`mode` 'random' - a shape hit or drone-proximity trigger, UNCHANGED: the
	orbit field's own swift lean via BASE_DRONE_LEAN_SCALE/HIT_TURN does the rest, exactly as
	before) or the one neighbour toward BASE_DRONE_LEVEL_HOME (`mode` 'home' - the drift-home
	trigger, which also fires repeatedly to climb a post-swoosh drone back to HOME). A neighbour is
	a candidate only if it is not already at its per-centre saturation cap (drone.levels.caps/
	count, from rooms/Room.js's levelPlan()). Does nothing - and leaves the cooldown alone, so the
	caller retries later - if every open neighbour is saturated, or ('home' only) the drone is not
	currently on its own ring: a planned arc only makes sense from there, and a drone still driving
	back from a chase has a huge radius error that would plan an arc off nonsense state.

	A successful 'home' switch plans the whole move as a single quintic Hermite (planSwitchArc,
	below) instead of just writing orbRTarget - position/velocity/head/spd come from that curve
	(case 1.4's `this.switching` branch) until it lands. A 'random' switch is untouched: it writes
	orbRTarget immediately and lets the orbit field's own lean produce the existing sharp turn.
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
		const cx = drone.x - drone.ox, cy = drone.y - drone.oy;
		const r = Math.sqrt(cx * cx + cy * cy) || 1;
		if (Math.abs(r - drone.orbRTarget) > config.BASE_DRONE_LEVEL_GAP / 2) { return false; }
		const towardHome = drone.level < config.BASE_DRONE_LEVEL_HOME ? drone.level + 1 :
			drone.level > config.BASE_DRONE_LEVEL_HOME ? drone.level - 1 : 0;
		if (candidates.indexOf(towardHome) >= 0) { next = towardHome; }
	} else if (candidates.length) {
		next = candidates[Math.floor(Math.random() * candidates.length)];
	}
	if (!next) { return false; }
	levels.count[drone.level - 1]--;
	levels.count[next - 1]++;
	drone.level = next;
	drone.orbRTarget = drone.room.levelR(next);
	drone.switchCooldown = BASE_DRONE_SWITCH_COOLDOWN;
	drone.levelTimer = BASE_DRONE_LEVEL_RELAX;
	if (mode === 'home') { planSwitchArc(drone, drone.orbRTarget); }
	return true;
}

/*
	Builds a 'home' switch's planned arc (plan.md WP4.5.2): a shallow quintic-Hermite sweep of
	BASE_DRONE_SWITCH_ARC (10%) of the circle, landing at the new level's radius exactly tangential
	and at cruise speed - the same seam trick the cross's exit already uses, so the hand-off back to
	the orbit field is exact (the field computes zero dHead/dSpd on the first post-arc tick).
*/
function planSwitchArc(drone, r1) {
	const cx = drone.x - drone.ox, cy = drone.y - drone.oy;
	const r0 = Math.sqrt(cx * cx + cy * cy) || 1;
	const theta0 = Math.atan2(cy, cx);
	const dtheta = 2 * Math.PI * config.BASE_DRONE_SWITCH_ARC * drone.spin;
	const theta1 = theta0 + dtheta;
	const u1x = Math.cos(theta1), u1y = Math.sin(theta1);
	const tx = -u1y * drone.spin, ty = u1x * drone.spin;

	const P1x = drone.ox + u1x * r1, P1y = drone.oy + u1y * r1;
	const V1x = tx * BASE_DRONE_ORBIT_SPEED, V1y = ty * BASE_DRONE_ORBIT_SPEED;
	const a1mag = BASE_DRONE_ORBIT_SPEED * BASE_DRONE_ORBIT_SPEED / r1;
	const A1x = -u1x * a1mag, A1y = -u1y * a1mag;

	drone.switchP0x = drone.x; drone.switchP0y = drone.y;
	drone.switchV0x = drone.vec.x; drone.switchV0y = drone.vec.y;
	drone.switchA0x = drone.vec.x - drone.pvec.x; drone.switchA0y = drone.vec.y - drone.pvec.y;
	drone.switchP1x = P1x; drone.switchP1y = P1y;
	drone.switchV1x = V1x; drone.switchV1y = V1y;
	drone.switchA1x = A1x; drone.switchA1y = A1y;
	const meanR = (r0 + r1) / 2;
	drone.switchDur = Math.max(3, Math.round(Math.hypot(meanR * Math.abs(dtheta), r1 - r0) / BASE_DRONE_ORBIT_SPEED));
	drone.switchT = 0;
	drone.switching = true;
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
						Shape-hit reaction (plan.md WP4.5.2, trigger (a)): one 60-degree REACTIVE
						('random') level switch, same mechanism a drone-proximity trigger uses - not a
						knockback; ORBIT ignores this.vec entirely (it writes position directly), so
						the vec.add() above is a no-op for a drone in ORBIT. Suppressed mid-swoosh (the
						drone punches straight through, user-specified), mid-'home'-arc (it still
						takes the damage/shove above, just not also a reactive jerk on top of the arc
						it's already flying) and on cooldown (so a drone resting against a shape
						doesn't re-trigger every tick).
					*/
					if (this.type === 1.4 && !this.crossing && !this.switching && this.switchCooldown <= 0) {
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
				Base drone (plan.md WP4, rewritten in WP4.5, rewritten again by WP4.5's dash/arc/
				swoosh/dark-band pass). Outside a cross or a 'home' switch arc, heading (`head`) and
				speed (`spd`) are authoritative and rate-limited (BASE_DRONE_TURN or
				BASE_DRONE_CHASE_TURN while chasing / BASE_DRONE_ACCEL); position is their integral -
				every state below only has to produce a desired direction and a target speed, and the
				shared steering tail slews toward both and writes position, so a transition between
				them is continuous by construction. A cross and a 'home' level-switch arc are the two
				exceptions: position comes from a planned quintic Hermite curve instead, matched to
				this same steering field at both seams, so the hand-off in and out of either is exact.

				`this.chasing`, `this.crossing` and `this.switching` are the three real branches;
				ORBIT/RETURN are one "orbit field" driven off (x,y) relative to the base centre
				(ox,oy) - a drone far from its ring leans harder toward it (BASE_DRONE_LEAN_MAX) and
				curls onto it as the error shrinks, so there is no separate RETURN state, though its
				cruise-to-dash speed blend (below) does make a long return a real sprint again
				(plan.md WP4.5.1). Radius itself only ever moves in whole BASE_DRONE_LEVEL_GAP steps
				via levelSwitch() (module scope, above) - the field here just steers toward whichever
				radius the level table currently names. `this.orbitState` is written purely for
				tests/admin - nothing branches on it.
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
				// reintroduce a velocity discontinuity). A 'home' switch arc IS interrupted by a
				// chase (plan.md WP4.5.2) - only C1-lossy, not C0, since head/spd come from the curve
				// every tick right up to the interrupting one. The leash is measured from the base
				// centre, not the drone, so a drone already out chasing doesn't get an easier time
				// re-engaging than one starting fresh off the ring.
				if (!this.chasing && !this.crossing && this.DETEC.select) {
					const other = this.DETEC.select;
					const basedis = Math.sqrt(Math.pow(other.x - this.ox, 2) + Math.pow(other.y - this.oy, 2));
					if (basedis < config.BASE_DRONE_LEASH && !other.destroy) {
						this.chasing = true;
						this.switching = false;
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
				// Suppressed mid-cross/mid-chase/mid-switch - a drone busy on a planned curve or
				// running down prey doesn't also drift levels, and a 'home' arc already in flight
				// does not re-fire (a reactive `tooClose` noticed mid-arc is cleared without acting -
				// it re-flags next tick if still true once the arc lands).
				if (!this.crossing && !this.chasing && !this.switching) {
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
				// The diameter cross (plan.md WP4.5.3): triggered here, evaluated below. Suppressed
				// while chasing/switching - crossIn only ever counts down in this branch, so a
				// 'home' arc in flight keeps its place in the queue exactly the way `levels.crossing`
				// already makes a blocked drone keep its place - and gated by `levels.crossing`
				// (4.5.3's "one crosser per orbit centre"): a drone whose crossIn has expired only
				// actually starts when nobody else at its centre is mid-swoosh.
				if (!this.chasing && !this.crossing && !this.switching && --this.crossIn <= 0 && this.levels.crossing === 0) {
					this.crossing = true;
					this.crossT = 0;
					const cx = this.x - this.ox, cy = this.y - this.oy;
					const r0 = Math.sqrt(cx * cx + cy * cy) || 1;
					const phi = Math.atan2(cy, cx);
					const R1 = this.room.levelR(1);
					const D = r0 + R1;
					const f = config.BASE_DRONE_CROSS_BLEND_FRAC;
					// The diameter's own line is offset from the drone's actual angle by `lead`
					// (plan.md WP4.5.3's load-bearing insight): without it, the drone's actual
					// position A would sit ON the line, moving perpendicular to it, and no smooth
					// curve can join a line it already sits on 8% along from a perpendicular start.
					const lead = 2 * Math.PI * config.BASE_DRONE_CROSS_LEAD * this.spin;
					const phiLine = phi + lead;
					const ux = Math.cos(phiLine), uy = Math.sin(phiLine);
					const dx = -ux, dy = -uy;   // direction of travel along the line
					const Ax = this.x, Ay = this.y;
					const L8x = this.ox + ux * (r0 - f * D), L8y = this.oy + uy * (r0 - f * D);
					const Cx = this.ox, Cy = this.oy;
					const L92x = this.ox + dx * ((1 - f) * D - r0), L92y = this.oy + dy * ((1 - f) * D - r0);
					// B is on level 1, `lead` further round from the diameter's own antipodal angle
					// - the same offset applied again at the exit, which is what makes the remaining
					// two 8%s (84 + 8 + 8 = 100) work at both ends instead of only one.
					const phiB = phiLine + Math.PI + lead;
					const uBx = Math.cos(phiB), uBy = Math.sin(phiB);
					const Bx = this.ox + uBx * R1, By = this.oy + uBy * R1;
					const tBx = -uBy * this.spin, tBy = uBx * this.spin;
					const a1mag = BASE_DRONE_ORBIT_SPEED * BASE_DRONE_ORBIT_SPEED / R1;
					// Five knots, four segments (plan.md WP4.5.3): A->L8 and L92->B are the tweens
					// (position/velocity/acceleration all match the orbit field at A and B); L8->C
					// and C->L92 have position AND both endpoint velocities AND both endpoint
					// accelerations collinear with `d`, so the perpendicular component of the
					// quintic is identically zero there - the drone drives dead straight for 84% of
					// the diameter, with the centre itself a point the straight run passes OVER
					// (at fraction r0/D along it), not a knot the path is bent through.
					this.crossKnots = [
						{ x: Ax, y: Ay, vx: this.vec.x, vy: this.vec.y, ax: this.vec.x - this.pvec.x, ay: this.vec.y - this.pvec.y },
						{ x: L8x, y: L8y, vx: dx * BASE_DRONE_CROSS_SEAM_SPEED, vy: dy * BASE_DRONE_CROSS_SEAM_SPEED, ax: 0, ay: 0 },
						{ x: Cx, y: Cy, vx: dx * BASE_DRONE_CROSS_SPEED, vy: dy * BASE_DRONE_CROSS_SPEED, ax: 0, ay: 0 },
						{ x: L92x, y: L92y, vx: dx * BASE_DRONE_CROSS_SEAM_SPEED, vy: dy * BASE_DRONE_CROSS_SEAM_SPEED, ax: 0, ay: 0 },
						{ x: Bx, y: By, vx: tBx * BASE_DRONE_ORBIT_SPEED, vy: tBy * BASE_DRONE_ORBIT_SPEED, ax: -uBx * a1mag, ay: -uBy * a1mag }
					];
					// Durations: the two straight segments are exact (a scalar quintic with zero
					// acceleration at both ends has mean speed exactly length/T - no fudge factor
					// needed); the two tweens use the one measured BASE_DRONE_CROSS_BLEND_ARC
					// overhead-over-chord factor.
					const vMean0 = (Math.hypot(this.vec.x, this.vec.y) + BASE_DRONE_CROSS_SEAM_SPEED) / 2;
					const vMean1 = (BASE_DRONE_CROSS_SEAM_SPEED + BASE_DRONE_ORBIT_SPEED) / 2;
					this.crossTs = [
						Math.max(3, Math.round(config.BASE_DRONE_CROSS_BLEND_ARC * Math.hypot(L8x - Ax, L8y - Ay) / vMean0)),
						Math.max(2, Math.round(Math.hypot(Cx - L8x, Cy - L8y) / ((BASE_DRONE_CROSS_SEAM_SPEED + BASE_DRONE_CROSS_SPEED) / 2))),
						Math.max(2, Math.round(Math.hypot(L92x - Cx, L92y - Cy) / ((BASE_DRONE_CROSS_SPEED + BASE_DRONE_CROSS_SEAM_SPEED) / 2))),
						Math.max(3, Math.round(config.BASE_DRONE_CROSS_BLEND_ARC * Math.hypot(Bx - L92x, By - L92y) / vMean1))
					];
					this.levels.crossing++;
				}
				///
				if (this.crossing) {
					this.crossT++;
					let idx = 0, elapsed = 0;
					while (idx < this.crossTs.length - 1 && this.crossT > elapsed + this.crossTs[idx]) {
						elapsed += this.crossTs[idx]; idx++;
					}
					const T = this.crossTs[idx];
					const s = Math.min(1, (this.crossT - elapsed) / T);
					const k0 = this.crossKnots[idx], k1 = this.crossKnots[idx + 1];
					const segX = quinticHermite(s, T, k0.x, k0.vx, k0.ax, k1.x, k1.vx, k1.ax);
					const segY = quinticHermite(s, T, k0.y, k0.vy, k0.ay, k1.y, k1.vy, k1.ay);
					// Position, velocity AND head/spd all come from the curve - writing head/spd
					// (rather than leaving them stale) is what makes the exit seamless, since the
					// shared steering tail resumes from exactly the state the curve ended in.
					this.x = segX.p; this.y = segY.p;
					this.vec.x = segX.v; this.vec.y = segY.v;
					this.head = Math.atan2(this.vec.y, this.vec.x);
					this.spd = Math.hypot(this.vec.x, this.vec.y);
					this.showDir = this.dir = this.head;
					this.orbitState = 'CROSS';
					const total = this.crossTs[0] + this.crossTs[1] + this.crossTs[2] + this.crossTs[3];
					if (this.crossT >= total) {
						// Lands at level 1 by construction, ignoring saturation deliberately (plan.md
						// WP4.5.3) - a swoosh always ends at the lowest level, so count[0] may
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
				// A 'home' level switch's planned arc (plan.md WP4.5.2) - built once by
				// planSwitchArc() at trigger, evaluated the same way the cross is: position/velocity/
				// head/spd come from the curve until it lands, then control returns to the field
				// below with zero error (V1/A1 were built to match what the field itself produces at
				// the landing point).
				if (this.switching) {
					this.switchT++;
					const s = Math.min(1, this.switchT / this.switchDur);
					const segX = quinticHermite(s, this.switchDur, this.switchP0x, this.switchV0x, this.switchA0x, this.switchP1x, this.switchV1x, this.switchA1x);
					const segY = quinticHermite(s, this.switchDur, this.switchP0y, this.switchV0y, this.switchA0y, this.switchP1y, this.switchV1y, this.switchA1y);
					this.x = segX.p; this.y = segY.p;
					this.vec.x = segX.v; this.vec.y = segY.v;
					this.head = Math.atan2(this.vec.y, this.vec.x);
					this.spd = Math.hypot(this.vec.x, this.vec.y);
					this.showDir = this.dir = this.head;
					this.orbitState = 'ORBIT';
					if (this.switchT >= this.switchDur) { this.switching = false; }
					this.pvec.x = this.vec.x; this.pvec.y = this.vec.y;
					this.clampToMap();
					return;
				}
				///
				let dx, dy, targetSpeed;
				const turnLimit = this.chasing ? BASE_DRONE_CHASE_TURN : BASE_DRONE_TURN;
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
					// Speed is a smoothstep blend from cruise toward the dash speed, keyed on how far
					// off its ring the drone is (plan.md WP4.5.1) - a return is a chase back to the
					// ring, so it runs at the same speed, easing to cruise as it arrives rather than
					// snapping or ringing around the target radius.
					const e = Math.min(1, Math.abs(err) / config.BASE_DRONE_RETURN_ERR);
					const k = e * e * (3 - 2 * e);
					targetSpeed = BASE_DRONE_ORBIT_SPEED + (BASE_DRONE_CHASE_SPEED - BASE_DRONE_ORBIT_SPEED) * k;
				}
				// Descriptive only (tests/admin dump) - nothing above or below branches on this.
				{
					const r = Math.sqrt(Math.pow(this.x - this.ox, 2) + Math.pow(this.y - this.oy, 2));
					this.orbitState = this.chasing ? 'CHASE' : (r > this.orbRTarget * 1.5 ? 'RETURN' : 'ORBIT');
				}
				// Shared steering tail: slew heading and speed toward the state's desired
				// direction/target speed, then integrate. Every state above funnels through this,
				// which is what makes every transition C1 with no state able to stop or snap it.
				// CHASE gets its own, much tighter turnLimit (BASE_DRONE_CHASE_TURN) - see
				// lib/config.js's comment for why a faster dash needs a tighter limiter, not a
				// looser one.
				const desired = Math.atan2(dy, dx);
				let dHead = Math.atan2(Math.sin(desired - this.head), Math.cos(desired - this.head));
				dHead = Math.max(-turnLimit, Math.min(turnLimit, dHead));
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
	// tail above and case 1.4's steering tail (plan.md WP4.5.3), which returns before ever
	// reaching that tail. Carries the same config.OOB_MARGIN allowance entities/Player.js's
	// motion() gives a tank (plan.md WP4.5.4(b)) - the dark band outside the drawn arena is
	// neutral ground now (rooms/Room.js's inArena()), so a base drone has to be able to follow a
	// target out there exactly as far as a player may run. In practice only a chasing drone ever
	// reaches it: a natural orbit/cross/switch-arc geometry never comes near the map edge (pinned
	// by test/rooms.js) - a clamp firing mid-curve would desync position from the curve.
	clampToMap() {
		const mx = this.map.width / 2 + config.OOB_MARGIN, my = this.map.height / 2 + config.OOB_MARGIN;
		if (this.x < -mx) { this.x = -mx; this.vec.x = 0; }
		if (this.y < -my) { this.y = -my; this.vec.y = 0; }
		if (this.x > mx) { this.x = mx; this.vec.x = 0; }
		if (this.y > my) { this.y = my; this.vec.y = 0; }
	}
}

// Type tag for collision / buffer dispatch - see public/SHARE/kinds.js.
Bullet.prototype.kind = KIND.BULLET;

module.exports = Bullet;
