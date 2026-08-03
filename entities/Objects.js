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
const { TANK_SHAPE_MULT, LETHAL_EPS } = require('../lib/damage.js');

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

/*
	Crasher chase accel (Crasher.ts, plan.md S1) - diep's own targettingSpeed, added into `this.vec`
	every tick a live target is held, run through the SAME decay-then-add BODY_FRICTION=0.9
	recurrence the tank integrator uses (public/SHARE/Physics.js's stepBody; M1's own "steady state
	is 10 x A"). That recurrence's fixed point is exactly 10x whatever's added each tick, so these
	land on diep's own quoted terminal (10 x 2.602 x 0.56 = 14.57 units/ref-tick, small; large's
	2.64 du/tick lands a hair higher) with no hand-tuned cap - see update()'s `chasing` branch.
	tick.quadratic(), not tick.perTick(), for the same reason HOME_PULL above is: added every tick
	and integrated into position again, so it integrates twice over ticks.
*/
const CRASHER_CHASE_ACCEL_SMALL = tick.quadratic(2.602 * 0.56);
const CRASHER_CHASE_ACCEL_LARGE = tick.quadratic(2.64 * 0.56);
// Crasher.ts's ai.viewRange 2000 du x 0.56 (plan.md S1) - was 500, under half diep's own range.
const CRASHER_VIEW_RANGE = 1120;
// diep's own edge-avoidance window and hold time (AbstractShape.ts:29,104-124, plan.md S5): 400/500
// du x 0.56 = 224/280 units, and TURN_TIMEOUT 300 reference ticks. Unscaled by nestScale, same as
// config.OOB_MARGIN - diep's own values are absolute, not arena-proportional, and every fixed-size
// mode's arena already sits within 1% of diep's own (plan.md A1).
const EDGE_TURN_INNER = 224, EDGE_TURN_OUTER = 280;
const EDGE_TURN_TIMEOUT = tick.ticks(300);
// The angle within which a turn is considered "arrived" and released back to ordinary idle drift -
// diep's own 0.20 rad (AbstractShape.ts:83,119).
const EDGE_TURN_DONE = 0.20;
// diep's shapes have NO regen at all (`regenPerTick` stays 0, AbstractShape.ts) - this engine
// keeps a slow self-heal as a deliberate departure instead (plan.md C14, a user decision; the
// client's own health-bar fade already existed and needed no change - only the heal itself was
// missing). Full recovery from 0 in 1500 reference ticks (60s) - a feel knob, not a diep number,
// picked slow enough that farming a patch still visibly thins it (README's own RESPAWN_CATCHUP
// departure already makes that promise) while a shape left alone for a while is whole again.
const SHAPE_REGEN_TICKS = 1500;

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
		// diep's raw damagePerTick now (plan.md chunk 1 D2) - no vs-tank x4 baked in any more (that
		// lived here until lib/damage.js's common(a,b) table took over applying it at each consuming
		// collision() site). This default is only ever read by Bsqr/Btri below, which have no diep
		// counterpart: 1.21212 = the old baked 4.84848 / 4, so their actual damage dealt to a tank
		// is unchanged - the axis fix carries them along rather than re-tuning them.
		this.damage = 1.21212;
		this.alpha = 1;
		this.hit = 0;
		this.spawnRad = 400;
		// Inset from the map edge - the same one rooms/Room.js's spawnPoint() uses, and scaled by
		// the same room.nestScale as the nest radii below (PENDING #19, plan.md step 6) so the whole
		// placement picture stays geometrically similar as the arena resizes. ffa's scale is 1.
		this.marge = 280 * room.nestScale;
		this.weight = 1;   // a mass divisor (this.x += vec.x/weight below), not a per-tick rate - not rescaled
		// diep's own absorbtionFactor (Object.ts:287, plan.md D7/D8): the receiver-side term that
		// scales an incoming collision impulse (kbMagnitude = this.absorb x attacker.pushFactor),
		// read at every this.vec.add() site in collision() below. Unlike `weight`, it never touches
		// idle drift/orbit - that stays governed by maxspeed alone, matching diep's own split.
		this.absorb = 1;
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
				// diep's own Crasher Zone (ShapeManager.ts:51-99, plan.md S2): R/10..R/5 of the
				// arena's own half-width, contiguous with the Pentagon Nest circle
				// (rooms/Room.js's createObj(), same 630 x nestScale radius) rather than the old
				// fixed 650..700 annulus, which was under half diep's own zone width. Area-uniform
				// (sqrt of a uniform draw over the annulus's area), not radius-uniform, so density
				// doesn't spike at the inner edge. diep's own zones are square (max(|x|,|y|) < R/10),
				// not circular - kept circular here for consistency with every other nest/carve-out
				// in the tree, which are all circles (PENDING).
				const s = room.nestScale;
				const rIn = 630 * s, rOut = 1249 * s;
				const dir = Math.random() * Math.PI * 2;
				const rad = Math.sqrt(rIn * rIn + Math.random() * (rOut * rOut - rIn * rIn));
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
			// damage is diep's raw damagePerTick, un-baked (plan.md chunk 1 D2, common(shape,tank)=4
			// is applied at each consuming collision() site now instead - lib/damage.js). maxspeed is
			// 2x diep's own drift terminal (0.56/0.28 units/ref-tick) since update()'s vec.limit
			// clamps to maxspeed/2, its own fixed point (plan.md step 7).
			case "sqr": this.size = 21.78; this.hp = 10; this.prize = 10; this.damage = 2; this.maxspeed = 1.12; break;
			case "tri": this.size = 21.78; this.hp = 30; this.prize = 25; this.maxspeed = 1.12; this.damage = 2; break;
			// diep's Pentagon absorbtionFactor (Pentagon.ts:46-47, plan.md D8) - no `weight` mass
			// divisor any more, idle drift is maxspeed alone now, matching diep's own split.
			case "pnt": this.size = 29.70; this.hp = 100; this.prize = 130; this.maxspeed = 0.56; this.absorb = 0.5; this.damage = 3; break;
			case "Bpnt": this.size = 79.20; this.hp = 3000; this.prize = 3000; this.maxspeed = 0.56; this.absorb = 0.05; this.damage = 5; break;   // diep's Alpha Pentagon damagePerTick/absorbtionFactor
			// Bsqr/Btri have no diep counterpart (plan.md steps 6-7) - radius, hp, prize, damage and
			// drift (maxspeed/rotationVal below) all left exactly as they were, flagged as ours; they
			// inherit `this.damage`'s own default above rather than setting their own. Still on the
			// old `weight` mass-divisor (plan.md D8 only re-derived the two real shapes above and
			// Crasher below) - `this.absorb` stays at its neutral default of 1 for both.
			case "Bsqr": this.size = 90; this.hp = 8000; this.prize = 2000; this.maxspeed = 0.01212; this.weight = 100; break;   // .01
			case "Btri": this.size = 72; this.hp = 7000; this.prize = 1000; this.maxspeed = 0.01212; this.weight = 100; break;   // .01
			// diep's Crasher absorbtionFactor (Crasher.ts:48, plan.md D8) - small default here,
			// overridden to the large value below on the large-crasher roll.
			case "bull": this.size = 13.86; this.hp = 10; this.prize = 15; this.maxspeed = 1.12; this.damage = 2; this.absorb = 2;   // diep's Crasher damagePerTick, small and large alike
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
			// diep's own 0.2 large-Crasher chance (Crasher.ts, plan.md S1) - was 0.15.
			if (Math.random() < 0.2) {
				// Large Crasher: diep's own 30 hp / 25 xp, same radius as Square/Triangle (plan.md step 6).
				this.size = 21.78;
				this.hp = 30;
				this.prize = 25;
				this.crasherLarge = true;
				this.absorb = 0.1;   // Crasher.ts:48 - large barely budges, vs small's 2 above (plan.md D8)
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
		// The shape's own drawn facing (plan.md C5/S4) - independent of `vec`'s drift direction,
		// diep's own split (AbstractShape.ts: `orbitAngle` steers drift, `positionData.angle` is a
		// separate slow spin). `dir` starts random like diep's own `positionData.angle = random(0,
		// 2pi)` at spawn, folded into (-pi,pi] for CODECS.angle's wire range; `spin` is diep's
		// `AI.PASSIVE_ROTATION` (0.01 rad/ref-tick), sign-rolled independently of `rotationDir`
		// above, same as diepcustom rolls its own two rates apart.
		this.dir = Math.random() * Math.PI * 2 - Math.PI;
		this.spin = (Math.random() < .5 ? -1 : 1) * 0.01;
		// Edge-avoidance turning (plan.md S5) - 0 outside a turn; while turning, `turning` counts
		// down from EDGE_TURN_TIMEOUT and `turnAngle` is the heading update()'s idle branch is
		// steering this.vec toward.
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
		// Every impulse below lands in `this.vec` (this shape's own velocity), so every add is
		// this shape RECEIVING a knockback - `this.absorb` (diep's absorbtionFactor, plan.md D7/D8)
		// belongs on all of them, not just this one. `this.weight`'s mass divisor (update(), Bsqr/
		// Btri only now) is unrelated - that's a position-step effect, this is a velocity one.
		switch (other.kind) {
			case KIND.PLAYER:
				if (other.necro && this.type === 'sqr' && other.droneCount < CLASS[other.class].maxDrone + other.upNb[1]) {
					this.destroy = 1;
					return;
				}
				this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.perTick(len * this.absorb), tick.perTick(len * this.absorb))));
				// An Arena Closer (PENDING #28) still shoves a shape out of the way (the impulse
				// above) but diep_wiki is explicit that its body "can't harm shapes" - so the damage/
				// kill half is skipped for it alone, the one KIND.PLAYER exception in this arm.
				if (other.closer) { break; }
				// common(tank,shape) = 4 (lib/damage.js, plan.md chunk 1 D2) - `other.damage` (the
				// tank's `this.damage`) carries diep's raw damagePerTick, so this multiplier is
				// load-bearing now. `option.dmgScale` is rooms/Room.js's proration factor for this
				// tick (1 unless either side would otherwise die mid-tick, plan.md step 5 part 4).
				this.hp -= tick.perTick(other.damage * TANK_SHAPE_MULT * (option.dmgScale ?? 1));
				this.hit = tick.ticks(1.65);
				// LETHAL_EPS, not 0 (lib/damage.js) - a prorated killing blow lands an ulp either side
				// of exactly this.hp, and an ulp short used to leave the shape alive at ~1e-16 forever.
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
				// `pene` no longer multiplies damage here (PENDING #18): a bullet's `pene` already
				// decides how many ticks of contact it survives against this shape's own body damage
				// (entities/Bullet.js's `this.pene -= tick.perTick(other.damage)` in its own
				// KIND.OBJECTS arm) - multiplying the per-tick hit by `pene` again double-counted it.
				// This also covers a drone's own hit the same way - a drone's `other.damage`
				// (BASE_DRONE_DAMAGE) is already the right per-tick number on its own. common(bullet,
				// shape) = 1 (lib/damage.js, plan.md chunk 1 D2), so still no multiplier belongs here;
				// `option.dmgScale` is rooms/Room.js's proration factor for this tick (1 unless either
				// side would otherwise die mid-tick, plan.md step 5 part 4).
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
					A Maze wall is solid to a polygon, exactly as it is to a tank (diepindepth/
					physics/README.txt: walls are the one non-circle in the collision model, and
					diepcustom's Object.ts:283-309 `receiveKnockback` gives everything the same
					isSolidWall branch). Shapes had no arm here at all, so they drifted straight
					through the maze.

					Unlike the tank's arm this resolves POSITION rather than only velocity: a shape
					has no steering to push it back out, so a velocity-only response lets it sink in
					and sit there. Same circle-vs-AABB closest-point test both other arms use - the
					broad phase only bounds a wall by its half-diagonal, so a candidate has to be
					re-checked here before anything moves.

					Snap by the shape's DRAWN circumradius, not its collision `.size`: a shape's drawn
					corners reach `this.size * SQRT2` (drawings.js C3 - `Drawings.obj.*` draw every
					shape at hit-radius x Math.SQRT2, independent of side count). Snapping the
					collision circle tangent left those corners poking visibly into the wall by
					(SQRT2 - 1) x size (~9 units for a square). Pushing the drawn extent clear instead
					removes ALL visual overlap - a flat edge facing the wall then leaves a small gap,
					which is what real diep shows too (its wall even bounces a grazing shape further
					out again).
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
			this.size *= tick.drag(1.1);   // diep's own DeletionAnimation.scale(1.1), Object.ts (plan.md C1)
			return;
		}
		// Slow self-heal (plan.md C14, SHAPE_REGEN_TICKS's own comment) - unconditional, not
		// gated behind a no-damage delay the way a tank's regen is: diep gives shapes no regen at
		// all, so there is no diep timing to be faithful to here, and the simpler always-on shape
		// is what the departure decision asked to keep.
		if (this.hp < this.maxHp) {
			this.hp = Math.min(this.maxHp, this.hp + tick.perTick(this.maxHp / SHAPE_REGEN_TICKS));
		}
		// A live Crasher target (plan.md S1) - room.js's broad-phase pass already ran this tick, so
		// this.DETEC.select is fresh. Chasing replaces the idle orbit-drift/limit() pair below with a
		// real accel run through the tank-style decay-then-add recurrence (CRASHER_CHASE_ACCEL_* above)
		// instead of HOME_PULL, which was tuned for the slow "drag back to spawn" pull, not a chase -
		// it added the pull AFTER the position step (for next tick), the wrong order to hit a specific
		// terminal: this needs decay, then add, then move, all the same tick.
		const target = this.DETEC && this.DETEC.select &&
			!this.DETEC.select.destroy && !this.DETEC.select.god ? this.DETEC.select : null;
		if (target) {
			this.vec.multiply(new Vec(BODY_FRICTION, BODY_FRICTION));
			this.vec.add(new Vec(this.crasherLarge ? CRASHER_CHASE_ACCEL_LARGE : CRASHER_CHASE_ACCEL_SMALL, 0)
				.rotate(Math.atan2(target.y - this.y, target.x - this.x)));
			this.DETEC.enabled = 0;
			// diep's own Crasher.ts:74 - faces the target directly while chasing, no idle spin
			// (plan.md C5/S4, unblocks S1's own "facing tracks the tank it's chasing" note).
			this.dir = Math.atan2(target.y - this.y, target.x - this.x);
		} else {
			// diep's own edge-avoidance (AbstractShape.ts:104-124, plan.md S5): within
			// EDGE_TURN_INNER of any wall, turn to point straight away from the arena centre; within
			// EDGE_TURN_OUTER of exactly one side, turn to run along it instead (diep's own four
			// mutually-exclusive checks, inner-first). Replaces the old behaviour of hard-clamping
			// position and zeroing the velocity component on contact, which piled shapes up on the
			// edges instead of turning them away.
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
				// diep's own 10x orbit-rate boost on the tick a turn starts (AbstractShape.ts:118),
				// so the shape snaps onto its new heading rather than crawling into the turn.
				const boost = (this.turning === EDGE_TURN_TIMEOUT) ? 10 : 1;
				const diff = Math.atan2(Math.sin(this.turnAngle - this.vec.angle()), Math.cos(this.turnAngle - this.vec.angle()));
				const step = tick.perTick(this.rotationVal) * boost;
				// diep's own unconditional `orbitAngle += orbitRate` (a fixed-sign step, not a
				// shortest-path one) - snap exactly to target instead of overshooting on the tick
				// that would otherwise pass it.
				this.vec.rotate(Math.abs(diff) <= Math.abs(step) ? diff : step);
				this.turning -= 1;
				if (Math.abs(diff) < EDGE_TURN_DONE) { this.turning = 0; }
			} else {
				this.vec.rotate(tick.perTick(this.rotationVal));
			}
			this.vec.limit(tick.perTick(this.maxspeed / 2), BODY_FRICTION)
			// diep's own AbstractShape.ts:120 - the idle spin runs every idle tick regardless of
			// edge-turning state (plan.md C5/S4), independent of `vec`'s own rotation above.
			// Re-normalised into (-pi,pi] every tick (lib/gameAI.js's own idiom) - left to
			// accumulate unbounded, this would eventually overflow CODECS.angle's int16 wire range.
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

		// A chasing Crasher gets the same config.OOB_MARGIN allowance a tank's own motion()/a
		// chasing base drone already get (plan.md C12 - diepcustom's Crasher.ts:44
		// `canMoveThroughWalls` while it has a target) - it can follow a target out into the
		// dark-grey band and hit them there, then drifts back home and re-clamps at the drawn
		// edge the instant it goes idle again. Every other shape (`target` always null - only a
		// Crasher's DETEC ever selects a KIND.PLAYER target) keeps the old hard clamp exactly.
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
