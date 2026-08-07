/*
	Objects - the farmable polygons (squares, triangles, pentagons).
	An Objects instance only ever collides with entities from its own room, so it holds a
	direct `this.room` reference instead of reaching through a registry.
*/
const Vec = require('victor');
const tick = require('../lib/tick.js');
const config = require('../lib/config.js').config;
const CLASS = require('../public/SHARE/TanksConfig.js').class;
// A shape's own idle drag - separate from the tank's own friction constant.
const BODY_FRICTION = tick.drag(require('../lib/constants.js').BODY_FRICTION);
const KIND = require('../public/SHARE/kinds.js');
const RARITY = require('../public/SHARE/ObjectsConfig.js').rarity;
const Detector = require('./Detector.js');
const { TANK_SHAPE_MULT, LETHAL_EPS } = require('../lib/damage.js');

// The homeward pull that drags an idle shape back within 120 units of its nest post.
// tick.quadratic(), not tick.perTick(): added every tick and integrated into position again,
// so it integrates twice over ticks (see lib/tick.js's quadratic()). A frozen constant.
const HOME_PULL = tick.quadratic(0.543024);

// Crasher chase acceleration, run through the same decay-then-add friction recurrence the tank
// integrator uses; its fixed point is the crasher's terminal chase speed (small/large variants).
// tick.quadratic(), not tick.perTick(): added every tick and integrated into position again.
const CRASHER_CHASE_ACCEL_SMALL = tick.quadratic(2.602 * 0.56);
const CRASHER_CHASE_ACCEL_LARGE = tick.quadratic(2.64 * 0.56);
// Crasher aggro radius.
const CRASHER_VIEW_RANGE = 1120;
// Edge-avoidance: within EDGE_TURN_INNER of any wall a shape turns to face the arena centre;
// within EDGE_TURN_OUTER of exactly one side it turns to run along it. TURN_TIMEOUT bounds how
// long a turn may hold before it's abandoned.
const EDGE_TURN_INNER = 224, EDGE_TURN_OUTER = 280;
const EDGE_TURN_TIMEOUT = tick.ticks(300);
// Angle within which a turn is considered "arrived" and released back to idle drift.
const EDGE_TURN_DONE = 0.20;
// Shapes slowly self-heal when undamaged - full recovery from 0 in 1500 reference ticks (60s),
// slow enough that active farming still visibly thins a patch.
const SHAPE_REGEN_TICKS = 1500;
// A shape is placed directly here rather than through a mode's spawnPoint(), so it needs its own
// bounded retry against room.clearOfWalls() (only Maze's ever rejects anything) - most of an
// arena is open floor, so the first draw normally clears; giving up after this many tries and
// keeping the last draw is better than looping forever in a dense pocket. PAD mirrors Maze's own
// tank-spawn pad since this.size isn't set yet at this point in the constructor.
const SHAPE_WALL_TRIES = 24;
const SHAPE_WALL_PAD = 30;
// Worst-case footprint radius per placement branch below, for room.clearOfShapes()'s overlap
// check - this.size isn't assigned until the type switch further down, so a flat per-branch
// worst case stands in for it here. CARVE is the largest of sqr/tri/pnt (pnt); NEST is the
// largest of sqr/tri/pnt/Bsqr/Btri/Bpnt (Bsqr); CRASHER is the large-crasher roll (base 13.86,
// large 21.78 - 0.2 chance, rolled after placement).
const SHAPE_SPAWN_RADIUS_CARVE = 29.70;
const SHAPE_SPAWN_RADIUS_NEST = 90;
const SHAPE_SPAWN_RADIUS_CRASHER = 21.78;

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
		// Raw per-tick damage output; the vs-tank multiplier is applied at each consuming
		// collision() site via lib/damage.js's common() table, not baked in here. Only read by
		// Bsqr/Btri below, which set no damage of their own.
		this.damage = 1.21212;
		this.alpha = 1;
		this.hit = 0;
		this.spawnRad = 400;
		// Inset from the map edge, scaled by room.nestScale so placement stays geometrically
		// similar as the arena resizes.
		this.marge = 280 * room.nestScale;
		this.weight = 1;   // mass divisor for position integration (this.x += vec.x/weight below)
		// Receiver-side multiplier on an incoming collision impulse, read at every this.vec.add()
		// site in collision() below. Unlike `weight`, it never touches idle drift/orbit.
		this.absorb = 1;
		switch (pos) {
			case -1: {
				// Carve-outs around the three polygon nests. Slightly tighter than the fresh-spawn
				// keep-out circles on purpose - a shape may sit closer to a nest than a player may
				// spawn. Bounded retry loop since this runs hundreds of times per room.
				const s = room.nestScale;
				let p;
				for (let i = 0; i < SHAPE_WALL_TRIES; i++) {
					p = room.rejectSample(this.marge, [
						[0, 0, 1400 * s],
						[map.width / 4, map.height / 4, 980 * s],
						[-map.width / 4, -map.height / 4, 980 * s]
					]);
					if (room.clearOfWalls(p.x, p.y, SHAPE_WALL_PAD) &&
						room.clearOfShapes(p.x, p.y, SHAPE_SPAWN_RADIUS_CARVE)) { break; }
				}
				this.x = p.x;
				this.y = p.y;
				this.pos = 0;
				break;
			}
			case 'bull': {
				// Crasher spawn zone: an annulus contiguous with the Pentagon Nest circle.
				// Area-uniform (sqrt of a uniform draw over the annulus's area), not radius-uniform,
				// so density doesn't spike at the inner edge. Kept circular for consistency with
				// every other nest/carve-out, which are all circles.
				const s = room.nestScale;
				const rIn = 630 * s, rOut = 1249 * s;
				for (let i = 0; i < SHAPE_WALL_TRIES; i++) {
					const dir = Math.random() * Math.PI * 2;
					const rad = Math.sqrt(rIn * rIn + Math.random() * (rOut * rOut - rIn * rIn));
					this.x = Math.cos(dir) * rad;
					this.y = Math.sin(dir) * rad;
					if (room.clearOfWalls(this.x, this.y, SHAPE_WALL_PAD) &&
						room.clearOfShapes(this.x, this.y, SHAPE_SPAWN_RADIUS_CRASHER)) { break; }
				}
				this.pos = 1;
				break;
			}
			default:
				for (let i = 0; i < SHAPE_WALL_TRIES; i++) {
					const dir = Math.random() * Math.PI * 2;
					this.x = Math.min(map.width / 2 - this.marge,
						Math.max(-map.width / 2 + this.marge,
							pos[0] + Math.sin(dir) * (Math.random() * pos[2])));
					this.y = Math.min(map.height / 2 - this.marge, Math.max(-map.height / 2 + this.marge, pos[1] + Math.cos(dir) * (Math.random() * pos[2])));
					if (room.clearOfWalls(this.x, this.y, SHAPE_WALL_PAD) &&
						room.clearOfShapes(this.x, this.y, SHAPE_SPAWN_RADIUS_NEST)) { break; }
				}
				this.pos = 1;
				break;
		}
		this.maxspeed = 0.36364;   // Bsqr/Btri only now, see below
		switch (this.type) {
			// Per-type radius/hp/prize/damage/speed table. maxspeed is 2x the idle drift terminal,
			// since update()'s vec.limit clamps to maxspeed/2.
			case "sqr": this.size = 21.78; this.hp = 10; this.prize = 10; this.damage = 2; this.maxspeed = 1.12; break;
			case "tri": this.size = 21.78; this.hp = 30; this.prize = 25; this.maxspeed = 1.12; this.damage = 2; break;
			// Pentagon: idle drift is maxspeed alone, no `weight` mass divisor.
			case "pnt": this.size = 29.70; this.hp = 100; this.prize = 130; this.maxspeed = 0.56; this.absorb = 0.5; this.damage = 3; break;
			case "Bpnt": this.size = 79.20; this.hp = 3000; this.prize = 3000; this.maxspeed = 0.56; this.absorb = 0.05; this.damage = 5; break;   // Alpha Pentagon
			// Bsqr/Btri: still on the `weight` mass-divisor rather than `absorb`, which stays
			// at its neutral default of 1 for both; they inherit `this.damage`'s default above.
			case "Bsqr": this.size = 90; this.hp = 8000; this.prize = 2000; this.maxspeed = 0.01212; this.weight = 100; break;
			case "Btri": this.size = 72; this.hp = 7000; this.prize = 1000; this.maxspeed = 0.01212; this.weight = 100; break;
			// Crasher: small default absorb here, overridden to the large value below on the
			// large-crasher roll.
			case "bull": this.size = 13.86; this.hp = 10; this.prize = 15; this.maxspeed = 1.12; this.damage = 2; this.absorb = 2;
				this.DETEC = new Detector(this, this.x, this.y, CRASHER_VIEW_RANGE, type = [KIND.PLAYER]); break;
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
		this.crasherLarge = false;
		if (this.type === 'bull') {
			if (Math.random() < 0.2) {
				// Large Crasher: same radius as Square/Triangle, barely budges on impact.
				this.size = 21.78;
				this.hp = 30;
				this.prize = 25;
				this.crasherLarge = true;
				this.absorb = 0.1;
			}
		}
		// Rarity roll, checked rarest-first: each tier is its own independent chance, so a roll
		// that already won a rarer tier cannot be re-decided into a more common one afterwards.
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
		// Drift-direction wander rate/sign, randomised per shape at spawn.
		this.rotationDir = Math.sign(Math.random() - 0.5);
		this.vec = new Vec(tick.perTick(this.maxspeed), 0).rotate(Math.random() * Math.PI * 2);
		// The shape's own drawn facing, independent of `vec`'s drift direction: `dir` is a slow
		// passive spin (`spin`, sign-rolled independently of `rotationDir` above).
		this.dir = Math.random() * Math.PI * 2 - Math.PI;
		this.spin = (Math.random() < .5 ? -1 : 1) * 0.01;
		// Edge-avoidance turning state: 0 outside a turn; while turning, `turning` counts down
		// from EDGE_TURN_TIMEOUT and `turnAngle` is the heading update()'s idle branch steers
		// this.vec toward.
		this.turning = 0;
		this.turnAngle = 0;
		this.destroy = 0;
		this.rx = this.x;
		this.ry = this.y;
		switch (this.type) {
			case 'pnt':
			case 'Bpnt':
				this.rotationVal = 0.0025 * this.rotationDir; break;
			case 'Bsqr':
			case 'Btri':
				this.rotationVal = 0.00242 + Math.random() * 0.00061; break;
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
		// Deliberately not tick.perTick()'d - this.vec is a real-tick velocity kept near its own
		// accel/friction fixed point, which barely moves across tick rates, so a bare threshold
		// stays meaningful without a runtime conversion.
		const len = (this.vec.length() * this.weight < 0.4) ? 2.42424 : .48485;
		// Every impulse below lands in `this.vec`, so `this.absorb` (the receiver-side knockback
		// scale) belongs on all of them. `this.weight`'s mass divisor is unrelated - that's a
		// position-step effect, this is a velocity one.
		switch (other.kind) {
			case KIND.PLAYER:
				if (other.necro && this.type === 'sqr' && other.droneCount < CLASS[other.class].maxDrone + other.upNb[1]) {
					this.destroy = 1;
					return;
				}
				this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.perTick(len * this.absorb), tick.perTick(len * this.absorb))));
				// An Arena Closer still shoves a shape out of the way but can't harm it - the damage/
				// kill half is skipped for it alone.
				if (other.closer) { break; }
				// `option.dmgScale` prorates damage on a tick where either side would otherwise die mid-tick.
				this.hp -= tick.perTick(other.damage * TANK_SHAPE_MULT * (option.dmgScale ?? 1));
				this.hit = tick.ticks(1.65);
				// LETHAL_EPS, not 0 - a prorated killing blow can land an ulp short of exactly this.hp.
				if (this.hp <= LETHAL_EPS) { this.hp = 0; this.destroy = tick.DES; this.room.awardXp(other, this.prize); other.coins += this.coinReward }
				break;
			case KIND.OBJECTS:
				if (other.type === 'bull') {
					this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.perTick(0.12121 * this.absorb), tick.perTick(0.12121 * this.absorb))));
					return;
				}
				this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.perTick(len * this.absorb), tick.perTick(len * this.absorb))));
				break;
			case KIND.BULLET:
				if (other.necro && this.type === 'sqr') {
					const play = other.room.INSTANCE.players.get(other.origin.oId);
					if (play.droneCount < CLASS[play.class].maxDrone + play.upNb[1]) {
						this.destroy = 1;
						return;
					}
				}
				// No `pene` multiplier here: a bullet's `pene` already decides how many ticks of
				// contact it survives against this shape (see Bullet.js's own KIND.OBJECTS arm), so
				// multiplying the per-tick hit by pene again would double-count it. `option.dmgScale`
				// prorates damage on a tick where either side would otherwise die mid-tick.
				this.hp -= tick.perTick(other.damage * (option.dmgScale ?? 1));
				this.hit = tick.ticks(1.65);
				if (this.hp <= LETHAL_EPS) { this.hp = 0; this.destroy = tick.DES; }
				if (this.type[0] === 'B') {
					break;
				}
				this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.perTick(0.48485 * this.absorb), tick.perTick(0.48485 * this.absorb))));
				break;
			case KIND.WALL: {
				/*
					A Maze wall is solid to a polygon, exactly as it is to a tank. Unlike the tank's
					arm this resolves POSITION rather than only velocity: a shape has no steering to
					push it back out, so a velocity-only response would let it sink in and sit there.
					Same circle-vs-AABB closest-point test the other arms use - the broad phase only
					bounds a wall by its half-diagonal, so a candidate has to be re-checked here.

					Snap by the shape's DRAWN circumradius (`this.size * SQRT2`), not its collision
					`.size` - snapping the collision circle tangent instead would leave the drawn
					corners poking visibly into the wall.
				*/
				const hw = other.w / 2, hh = other.h / 2;
				const cx = Math.max(other.x - hw, Math.min(this.x, other.x + hw));
				const cy = Math.max(other.y - hh, Math.min(this.y, other.y + hh));
				const dx = this.x - cx, dy = this.y - cy;
				const d = Math.sqrt(dx * dx + dy * dy);
				const drawR = this.size * Math.SQRT2;   // drawn circumradius (C3)
				if (d > drawR) { break; }
				let nx, ny;
				if (d === 0) {
					// Dead centre inside the rectangle (a shape that spawned in a wall): there is no
					// closest-point normal, so leave along the nearest FACE, pushing the centre PAST
					// that face by the full drawn radius - moving by `drawR` alone from the centre
					// would never escape a thick wall.
					const fx = hw - Math.abs(this.x - other.x), fy = hh - Math.abs(this.y - other.y);
					let faceDist;
					if (fx < fy) { nx = Math.sign(this.x - other.x) || 1; ny = 0; faceDist = fx; }
					else { nx = 0; ny = Math.sign(this.y - other.y) || 1; faceDist = fy; }
					this.x += nx * (faceDist + drawR);
					this.y += ny * (faceDist + drawR);
				} else {
					nx = dx / d; ny = dy / d;
					this.x = cx + nx * drawR;
					this.y = cy + ny * drawR;
				}
				// Kill only the component heading INTO the wall - a shape drifting along a face
				// keeps sliding along it instead of being stopped dead by a graze.
				const into = this.vec.x * nx + this.vec.y * ny;
				if (into < 0) {
					this.vec.x -= into * nx;
					this.vec.y -= into * ny;
				}
				break;
			}
		}
	}
	update() {
		this.hit = Math.max(0, this.hit - 1);
		if (this.destroy > 1) {
			this.x += this.vec.x / this.weight;
			this.y += this.vec.y / this.weight;
			this.destroy -= 1;
			this.alpha = this.destroy / tick.DES;
			this.size *= tick.drag(1.1);   // death-animation shrink
			return;
		}
		// Slow self-heal, unconditional (no no-damage delay gate the way a tank's regen has).
		if (this.hp < this.maxHp) {
			this.hp = Math.min(this.maxHp, this.hp + tick.perTick(this.maxHp / SHAPE_REGEN_TICKS));
		}
		// A live Crasher target: chasing replaces the idle orbit-drift/limit() pair below with a
		// real accel run through the tank-style decay-then-add recurrence, decay then add then
		// move all in the same tick so it converges on the intended chase terminal speed.
		const target = this.DETEC && this.DETEC.select &&
			!this.DETEC.select.destroy && !this.DETEC.select.god ? this.DETEC.select : null;
		if (target) {
			this.vec.multiply(new Vec(BODY_FRICTION, BODY_FRICTION));
			this.vec.add(new Vec(this.crasherLarge ? CRASHER_CHASE_ACCEL_LARGE : CRASHER_CHASE_ACCEL_SMALL, 0)
				.rotate(Math.atan2(target.y - this.y, target.x - this.x)));
			this.DETEC.enabled = 0;
			// Faces the target directly while chasing, no idle spin.
			this.dir = Math.atan2(target.y - this.y, target.x - this.x);
		} else {
			// Edge-avoidance: within EDGE_TURN_INNER of any wall, turn to point away from the arena
			// centre; within EDGE_TURN_OUTER of exactly one side, turn to run along it instead
			// (four mutually-exclusive checks, inner-first).
			if (this.turning <= 0) {
				const right = this.map.width / 2, left = -this.map.width / 2;
				const bottom = this.map.height / 2, top = -this.map.height / 2;
				let target = null;
				if (this.x > right - EDGE_TURN_INNER || this.x < left + EDGE_TURN_INNER ||
					this.y < top + EDGE_TURN_INNER || this.y > bottom - EDGE_TURN_INNER) {
					target = Math.PI + Math.atan2(this.y, this.x);
				} else if (this.x > right - EDGE_TURN_OUTER) {
					target = Math.sign(this.rotationDir) * Math.PI / 2;
				} else if (this.x < left + EDGE_TURN_OUTER) {
					target = -Math.sign(this.rotationDir) * Math.PI / 2;
				} else if (this.y < top + EDGE_TURN_OUTER) {
					target = this.rotationDir > 0 ? 0 : Math.PI;
				} else if (this.y > bottom - EDGE_TURN_OUTER) {
					target = this.rotationDir > 0 ? Math.PI : 0;
				}
				if (target !== null) {
					const diff = Math.atan2(Math.sin(target - this.vec.angle()), Math.cos(target - this.vec.angle()));
					if (Math.abs(diff) >= EDGE_TURN_DONE) {
						this.turnAngle = target;
						this.turning = EDGE_TURN_TIMEOUT;
					}
				}
			}
			if (this.turning > 0) {
				// A boost on the tick a turn starts so the shape snaps onto its new heading rather
				// than crawling into the turn.
				const boost = (this.turning === EDGE_TURN_TIMEOUT) ? 10 : 1;
				const diff = Math.atan2(Math.sin(this.turnAngle - this.vec.angle()), Math.cos(this.turnAngle - this.vec.angle()));
				const step = tick.perTick(this.rotationVal) * boost;
				// Snap exactly to target instead of overshooting on the tick that would pass it.
				this.vec.rotate(Math.abs(diff) <= Math.abs(step) ? diff : step);
				this.turning -= 1;
				if (Math.abs(diff) < EDGE_TURN_DONE) { this.turning = 0; }
			} else {
				this.vec.rotate(tick.perTick(this.rotationVal));
			}
			this.vec.limit(tick.perTick(this.maxspeed / 2), BODY_FRICTION)
			// The idle spin runs every idle tick regardless of edge-turning state, independent of
			// `vec`'s own rotation above. Re-normalised into (-pi,pi] every tick so it never
			// overflows the wire's angle range.
			this.dir = Math.atan2(Math.sin(this.dir + tick.perTick(this.spin)), Math.cos(this.dir + tick.perTick(this.spin)));
		}
		this.x += this.vec.x / this.weight;
		this.y += this.vec.y / this.weight;
		if (this.DETEC) {
			if (this.DETEC.select) {
				if (this.DETEC.select.destroy || this.DETEC.select.god) {
					this.DETEC.reset();
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

		// A chasing Crasher gets the same OOB_MARGIN allowance a tank/chasing base drone get - it
		// can follow a target out into the dark-grey band, then re-clamps at the drawn edge once
		// idle again. Every other shape (`target` always null) keeps the hard clamp.
		const margin = target ? config.OOB_MARGIN : 0;
		if (this.x < -this.map.width / 2 - margin) {
			this.x = -this.map.width / 2 - margin;
			this.vec.x = 0;
		};
		if (this.y < -this.map.height / 2 - margin) {
			this.y = -this.map.height / 2 - margin;
			this.vec.y = 0;
		};
		if (this.x > this.map.width / 2 + margin) {
			this.x = this.map.width / 2 + margin;
			this.vec.x = 0;
		};
		if (this.y > this.map.height / 2 + margin) {
			this.y = this.map.height / 2 + margin;
			this.vec.y = 0;
		};
	}
}

// Type tag for collision / buffer dispatch - see public/SHARE/kinds.js.
Objects.prototype.kind = KIND.OBJECTS;

module.exports = Objects;
