/*
	Bot, boss and pet AI.

	These behaviour functions get bind()-ed onto entities at spawn time, so `this` inside
	them is the tank / boss / pet, not this module. Detector/Vec/BODY_FRICTION/CLASS are all leaves,
	none of them sitting on the entity/room/Controller dependency graph, so this is a plain
	module, not a factory - CONFIG is exported directly.

	This is the working copy of the AI. A second, diverged
	copy that never executed - see the note at the top of that file.
*/
const KIND = require('../public/SHARE/kinds.js');
const Physics = require('../public/SHARE/Physics.js');
const config = require('./config.js').config;
const Detector = require('../entities/Detector.js');
const Vec = require('victor');
const tick = require('./tick.js');
// The BOSS block's drift decays through this - NOT public/SHARE/Physics.js's tank FRICTION, and
// the choice is deliberate (plan.md step 2, lib/constants.js). See the drift call site for why.
// Bots do NOT read it: they steer through Physics.stepBody like a human tank does, so they moved
// to 10/11 with everything else that is actually a tank.
const BODY_FRICTION = tick.drag(require('./constants.js').BODY_FRICTION);
const CLASS = require('../public/SHARE/TanksConfig.js').class;
const DES = tick.DES;

// A FLAT divisor, deliberately not run through tick.lead() - see entities/Player.js's identical
// copy for the derivation. 15.84 is what tick.lead(9.9) evaluated to at the live TICK_MS, so bot
// auto-turrets aim exactly where they used to; kept identical to Player.js's copy so bots and
// humans lead a moving target the same way rather than disagreeing.
const AUTOTURRET_LEAD = 15.84;
const BOT_SPIN_FLIP_CHANCE = tick.chance(0.00242);
// The Summoner boss's own idle drift toward/away from the arena centre - see the BOSS block's
// comment for why this is tick.quadratic() rather than tick.perTick().
const BOSS_DRIFT = tick.quadratic(0.219408);
const BOT_TURN_RATE = tick.smoothing(0.35101);
const BOSS_SHOOT_CHANCE = tick.chance(0.48485);
// Tag's Arena Closer (PENDING #28) - a flat per-tick position delta, not a thrust-into-velocity
// term, so tick.perTick() is the right category (see this file's BOSS_DRIFT comment for the
// opposite case). 24 units/REF_TICK = 600 u/s, picked to clear PENDING nuance 32's own 559.2 u/s
// tank-speed ceiling with room to spare - diep_wiki/Arena Closer.txt: faster than every
// fully-upgraded tank class, escape is "virtually impossible".
const CLOSER_SPEED = tick.perTick(24);
// Pets brake twice as hard as everything else (1-fr = (1-BODY_FRICTION)*2, a design choice, not a
// tick-rate artifact) - treated as its own independent friction constant with its own one-time
// rescale (0.928^(40/33)) rather than derived from the already-rescaled shared constant, which
// would silently change the 2x relationship.
//
// THE "EVERYTHING ELSE" IN THAT RELATIONSHIP IS BODY_FRICTION, NOT THE TANK'S. Checked when the
// two were split (plan.md step 2): 1 - 0.91341 = 0.08659 against 1 - 0.956532 = 0.043468 is 1.99x,
// so the premise still holds exactly, because the constant it was derived against is precisely the
// one that did not move. Restoring the 2x against the tank's 10/11 instead would give
// 1 - fr = 2/11, i.e. fr = 0.8182 - a pet that brakes ~2.2x harder again and stops dead behind its
// owner. A pet coasts like a body, it does not steer like a tank; do not "re-derive" this.
const PET_FRICTION = tick.drag(0.91341);

/*
	Domination's Dominator (PENDING #27) - a stationary Player, the same CONFIG.BOSS/CONFIG.CLOSER
	pattern: an ordinary Player with motion/update replaced at spawn (rooms/Room.js's
	createDominator()), not a new entity kind, since a Dominator has HP/regen/cannons/AI no static
	entity has.

	Targeting/leading/FoV-hold are NOT reimplemented here - entities/Player.js's own shoot()
	already does exactly that for any class whose cannons carry autoDir/autoShoot (the same
	auto-turret machinery Auto Gunner/Auto Trapper already use): the class's own CLASS[...].DETEC
	(public/SHARE/TanksConfig.js) picks the nearest target in priority-type order and holds it
	until it dies or leaves DETEC.maxDis, and shoot()'s autoDir branch already leads a moving
	target the same way an ordinary auto-turret does. What's actually new here is standing still,
	the capture/knockdown state machine, dropping a target that has stopped shooting back, and
	refusing a shape/boss target while neutral.

	SIMPLIFICATION, flagged rather than silent: diep_wiki/Dominator.txt's "falls back to
	polygons/bosses/closers" reads as a THIRD priority tier below ordinary players; a boss/closer
	is a KIND.PLAYER instance in this engine (flagged .boss/.closer), so DETEC's own type-order
	bucketing only gives two tiers (players-including-bosses/closers, then objects), not three.
	Left this way deliberately rather than hand-rolling a second search past the shared Detector -
	a boss/closer is rare enough that the distinction is unlikely to matter in a live match.
*/
// diep's own neutral-Dominator colour - SocketSchema's `color` table index 2, 'yellow'.
const DOMINATOR_NEUTRAL_TEAM = 2;
// How long a Dominator holds a target that has stopped dealing it damage before dropping it and
// re-scanning. diep_wiki gives no number for this - ours, PENDING #27. 75 reference ticks = 3s at
// the 40ms reference.
const DOMINATOR_RETARGET_IDLE = tick.ticks(75);
// Mirrors entities/Player.js's own regen constants (same identical-copy convention as
// AUTOTURRET_LEAD above) - a Dominator's update() is fully replaced, so it cannot reach
// Player.prototype.update()'s regen block and reimplements it instead of sharing it.
const DOMINATOR_HYPER_REGEN_DELAY = tick.ticks(750);
const DOMINATOR_HYPER_REGEN_RATE = 0.085871;
/*
	Runs instead of the ordinary death path the moment `destroy` is set. collision()
	(entities/Player.js, unmodified - a Dominator takes damage exactly like any other Player)
	already spent this tick's hp/set `murder`/set `destroy` before update() ever runs, so this
	only has to read that and decide neutral-vs-flip rather than re-derive who hit it.
*/
function dominatorCapture() {
	this.destroy = 0;
	this.dead = 0;
	this.hp = this.maxHp;
	this.alpha = 1;
	let killerTeam = null;
	if (Array.isArray(this.murder) && this.murder[0] === 'players' && this.murder[1]) {
		const killer = this.room.INSTANCE.players.get(this.murder[1].oId);
		if (killer) { killerTeam = killer.team; }
	}
	this.murder = -1;
	// A knockdown by anything other than a live enemy player (e.g. a shape's own body damage
	// killed it) heals it back up with no team change - there is no team to credit. Otherwise:
	// neutral -> the attacker's team (captured outright, diep_wiki's one-knockdown rule); an
	// enemy team -> neutral first (the two-knockdown rule).
	if (killerTeam !== null && killerTeam !== this.team) {
		this.team = (this.team === DOMINATOR_NEUTRAL_TEAM) ? killerTeam : DOMINATOR_NEUTRAL_TEAM;
		for (const b of this.room.INSTANCE.bullets.live()) {
			if (b.origin && b.origin.oId === this.id.oId) { b.destroy = tick.DES; }
		}
		if (this.DETEC) { this.DETEC.reset(); this.DETEC.enabled = 1; }
		this.domIdle = 0;
	}
}
function dominatorMotion() { /* diep_wiki/Dominator.txt: "cannot move" */ }
function dominatorUpdate() {
	this.hit = Math.max(0, this.hit - 1);
	// "Cannot move" (diep_wiki/Dominator.txt) has to be enforced here, not just by dominatorMotion
	// being a no-op: entities/Player.js's own KIND.PLAYER collision arm resolves tank-vs-tank
	// positional overlap by moving BOTH bodies (PENDING nuance 44), unconditionally, so a ramming
	// tank would otherwise still shove a Dominator a little every contact. Snapping back to the
	// spawn point every tick (rooms/Room.js's createDominator() records it) cancels that plus any
	// knockback impulse, regardless of source.
	this.x = this.spawnX;
	this.y = this.spawnY;
	this.vec.x = 0;
	this.vec.y = 0;
	if (this.destroy) { dominatorCapture.call(this); return; }
	// Weak regen - diep_wiki/Stats.txt's own 0-Regen-point linear/hyper rates (entities/
	// Player.js's identical formula at 0 points), not a bespoke number.
	if (this.hp < this.lastHp) {
		this.noDamageTicks = 0;
	} else {
		this.noDamageTicks = Math.min((this.noDamageTicks || 0) + 1, DOMINATOR_HYPER_REGEN_DELAY);
	}
	if (this.hp < this.maxHp) {
		const hps = (this.noDamageTicks >= DOMINATOR_HYPER_REGEN_DELAY)
			? this.maxHp * DOMINATOR_HYPER_REGEN_RATE / 25
			: this.maxHp * 0.03 / 30 / 25;
		this.hp += tick.perTick(hps);
		this.hp = Math.min(this.maxHp, this.hp);
	}
	this.lastHp = this.hp;
	// Drop a target that has stopped shooting back rather than holding it forever just because
	// it never left DETEC.maxDis (entities/Player.js's collision() sets `lastAttacker` at the end
	// of every hit, for exactly this reader).
	if (this.DETEC && this.DETEC.select) {
		if (this.DETEC.select.kind === KIND.PLAYER) {
			const hitByTarget = this.lastAttacker && this.DETEC.select.id &&
				this.lastAttacker.oId === this.DETEC.select.id.oId;
			this.domIdle = hitByTarget ? 0 : (this.domIdle || 0) + 1;
		} else {
			this.domIdle = 0;
		}
		// Neutral cannot damage shapes or bosses (diep_wiki/Dominator.txt) - refusing the target
		// outright is the simplest correct statement of that rule, since a bullet that never
		// fires at a shape/boss cannot damage one either.
		const refuseNeutral = this.team === DOMINATOR_NEUTRAL_TEAM &&
			(this.DETEC.select.kind === KIND.OBJECTS || this.DETEC.select.boss || this.DETEC.select.closer);
		if (this.domIdle > DOMINATOR_RETARGET_IDLE || refuseNeutral) {
			this.DETEC.reset();
			this.DETEC.enabled = 1;
			this.domIdle = 0;
		}
	} else {
		this.domIdle = 0;
	}
	this.lastAttacker = null;
	this.shoot();
}

const CONFIG = {
		'BOTS': [
			function () {
				if (isNaN(this.path)) {
					this.path = CONFIG.BOT_PATHS[Math.floor(Math.random() * CONFIG.BOT_PATHS.length)]
				}
				// BOT_UPS is indexed by points already SPENT (stillLvl), so it is a build order:
				// entry 0 is the first point this bot will ever spend. upgrade() is the thing that
				// knows whether a point is available (entities/Player.js's pointsAtLevel gate), so
				// calling it unconditionally is correct and the old `if (this.stillLvl)` guard was
				// not: at stillLvl 0 it is false, so a bot could only ever start upgrading once
				// something *else* had moved stillLvl - which, before PENDING #30, was the level-18
				// takeback. Bots therefore spent nothing at all until level 18 and skipped entry 0
				// forever. The takeback is gone, so this guard would now mean "never upgrade".
				this.upgrade(CONFIG.BOT_UPS[this.path.up ? this.path.up : 0][this.stillLvl]);
				// On gaining a shield, aim the bot a random way once. A shielded bot stands
				// still (below) and never updates its dir, so every fresh spawn would otherwise
				// face hard right (the constructor's dir=0). The flag clears when the shield
				// drops, so a re-shield (e.g. the admin 'shield' command) re-randomises.
				if (this.shield) {
					if (!this.shieldFaced) {
						this.dir = this.autoDir = Math.random() * 2 * Math.PI;
						this.shieldFaced = 1;
					}
				} else {
					this.shieldFaced = 0;
				}
				if (this.shield && this.xp < 25000) {
					this.shield--;
					this.inputs.e = 0;
					return;
				}
				this.upClass(this.path.class[this.classLvl]);
				if (!this.DETEC) {
					this.DETEC = new Detector(this, this.x, this.y, this.screen / 2, [KIND.PLAYER, KIND.OBJECTS, KIND.BULLET], 0, 1)
					this.DETEC.team = this.team;
				} else {
					this.DETEC.size = this.screen / 2;
					this.DETEC.x = this.x;
					this.DETEC.y = this.y;
				};
				if (!this.botMod) {
					this.botMod = 'search';
				} else {
					const all = this.DETEC.selectAll;
					if (all[KIND.OBJECTS].length + all[KIND.PLAYER].length + all[KIND.BULLET].length > 0 && !this.running) {
						const tresh = CONFIG.botThreshold;
						let farm = 0, run = 0, attack = 0;
						farm = Math.min(all[KIND.OBJECTS].length, 5) / tresh.farm
						for (const obj of all[KIND.BULLET]) {
							const dis = this.screen / Math.sqrt(Math.pow(this.x - obj.x, 2) + Math.pow(this.y - obj.y, 2))
							run += obj.pene * obj.damage * dis;
						}
						for (const obj of all[KIND.PLAYER]) {
							const dis = this.screen / Math.sqrt(Math.pow(this.x - obj.x, 2) + Math.pow(this.y - obj.y, 2))
							run += obj.hp * dis * obj.damage / tresh.playerRun;
						}
						run /= this.hp * Math.max(1, this.level / 10) * tresh.run;
						// select is 0 until something is in the cone, and 0 has no `kind`
						if (this.DETEC.select.kind === KIND.PLAYER) {
							const other = this.DETEC.select;
							attack += Math.min(Math.pow(other.xp / tresh.attackxpBase, 1.4), tresh.attackxpMax) / tresh.attackxpDivide * Math.max(1, this.level / other.level) * (1 / (1 + other.hp / tresh.attackHp)) * (1 / (1 + this.DETEC.dis / tresh.attackDis)) * this.hp / tresh.attack;
						}
						this.run = run;
						this.attack = attack;
						this.farm = farm;
						if (run >= attack && run > tresh.minRun) {
							if (run >= farm) {
								this.botMod = 'run';
							} else {
								this.botMod = 'farm';
							}
						} else if (farm >= attack) {
							this.botMod = 'farm';
						} else {
							this.botMod = 'attack';
						}
						if (run + attack + farm <= 0) {
							this.botMod = 'search';
						}
					} else {
						if (!this.running) {
							this.botMod = 'search';
						}
					}
				}
				///
				if (this.botMod === 'run') {
					if (this.running) {
						this.running--;
					} else {
						this.running = 10;
					}
				}
				///
				if (this.spin && Math.random() <= BOT_SPIN_FLIP_CHANCE) {
					this.spin = -this.spin;
				}
				let dir = 0;
				let len = Physics.moveAccel(this.up.MSpeed, this.level);
				this.inputs.e = 1;
				switch (this.botMod) {
					case 'farm': {
						this.spin = 0;
						let oldDis = this.screen;
						let selected = 0;
						for (const obj of this.DETEC.selectAll[KIND.OBJECTS]) {
							const dis = Math.sqrt(Math.pow(this.x - obj.x, 2) + Math.pow(this.y - obj.y, 2) * 2);
							if (dis < oldDis) {
								oldDis = dis;
								selected = obj;
							}
						};
						if (!selected) { break; }
						if (oldDis > CONFIG.botThreshold.farmDis * len + this.size + selected.size) {
							dir = Math.atan2(selected.y - this.y, selected.x - this.x);
							this.autoDir = dir;
						} else {
							this.autoDir = Math.atan2(selected.y - this.y, selected.x - this.x);
							len = 0;
						}
						break;
					};
					case 'run': {
						let med = 0;
						let x = 0;
						let y = 0;
						for (const bull of this.DETEC.selectAll[KIND.BULLET]) {
							const dis = this.screen / Math.sqrt(Math.pow(this.x - bull.x, 2) + Math.pow(this.y - bull.y, 2) * 2) / CONFIG.botThreshold.runDis;
							med += bull.pene * bull.damage * dis;
							x += bull.x * bull.pene * bull.damage * dis;
							y += bull.y * bull.pene * bull.damage * dis;
						};
						for (const bull of this.DETEC.selectAll[KIND.PLAYER]) {
							const dis = this.screen / Math.sqrt(Math.pow(this.x - bull.x, 2) + Math.pow(this.y - bull.y, 2) * 2) / CONFIG.botThreshold.runDis;
							med += bull.hp / CONFIG.botThreshold.runHp * bull.damage * dis;
							x += bull.x * bull.hp / CONFIG.botThreshold.runHp * bull.damage * dis;
							y += bull.y * bull.hp / CONFIG.botThreshold.runHp * bull.damage * dis;
						};
						if (!med) {
							dir = Math.PI - this.autoDir;
							break;
						}
						y /= med;
						x /= med;
						if (!this.spin) {
							this.spin = Math.sign(Math.random() * 10 - 5);
						}
						const dis = Math.sqrt(Math.pow(this.x - x, 2) + Math.pow(this.x - x, 2));
						this.autoDir = Math.atan2(y - this.y, x - this.x);
						dir = Math.PI + this.autoDir;
						dir += this.spin * Math.PI * Math.min(1, Math.sqrt(dis / this.screen)) / 1.9;
						break;
					};
					case 'attack': {
						if (!this.spin) {
							this.spin = Math.sign(Math.random() * 10 - 5);
						}
						const other = this.DETEC.select;
						const dis = Math.sqrt(Math.pow(this.x - other.x, 2) + Math.pow(this.y - other.y, 2));
						this.autoDir = Math.atan2(other.y + other.vec.y * dis / AUTOTURRET_LEAD - this.y, other.x + other.vec.x * dis / AUTOTURRET_LEAD - this.x);
						const dir = this.spin * Math.PI * Math.min(1, 100 / dis) / 2.5 + this.autoDir;
						break;
					};
					case 'search':
					default: {
						if (!this.spin) {
							this.spin = Math.sign(Math.random() * 10 - 5);
						}
						const dis = Math.sqrt((this.x * this.x) + (this.y * this.y));
						dir = Math.atan2(this.y, this.x);
						dir -= Math.PI * Math.min(1, (dis / this.map.width));
						this.autoDir = dir;
						this.inputs.e = 0;
						break;
					};
				}
				this.dir = Math.atan2(
					Math.sin(this.dir) + (Math.sin(this.autoDir) - Math.sin(this.dir)) * BOT_TURN_RATE,
					Math.cos(this.dir) + (Math.cos(this.autoDir) - Math.cos(this.dir)) * BOT_TURN_RATE
				);
				// this.name = this.botMod+' '+parseInt(this.farm*100)+' '+parseInt(this.attack*100)+'
				// '+parseInt(this.run*100)
				///
				dir = Math.atan2(Math.sin(dir), Math.cos(dir));
				const tresh = Math.PI / 3;
				const vdir = dir + Math.PI;
				const hdir = Math.abs(dir);
				const motion = new Vec(0, 0);
				if (Math.abs(Math.PI * .5 - vdir) <= tresh) { motion.y -= len; }
				if (Math.abs(Math.PI * 1.5 - vdir) <= tresh) { motion.y += len; }
				if (Math.abs(Math.PI - hdir) <= tresh) { motion.x -= len; }
				if (hdir <= tresh) { motion.x += len; }
				let ax = 0, ay = 0;
				if (motion.length() > 0) {
					const a = motion.norm().multiply(new Vec(len, len));
					ax = a.x; ay = a.y;
					if (this.alpha < 1) {
						this.alpha += Math.min(1, tick.perTick(CLASS[this.class].alpha * 10));
					}
					if (this.shield) {
						this.shield = 0;
					}
				}
				///
				{
					const body = { x: this.x, y: this.y, vx: this.vec.x, vy: this.vec.y };
					Physics.stepBody(body, ax, ay, tick.SCALE);
					this.x = body.x; this.y = body.y;
					this.vec.x = body.vx; this.vec.y = body.vy;
				}
				///
				// Bots are Players too - same OOB margin as a human's motion().
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
				if (this.DETEC) {
					this.DETEC.reset();
				}
				if (this.size <= 0) { this.inputs.e = 0; }
				//this.inputs.c = 1;
			}
		],
		'BOT_NAMES': './botNames.js',
		'BOT_PATHS': [
			{
				class: ['Twin', 'Triple Shot', 'Triplet'],
			},
			{
				class: ['Twin', 'Triple Shot', 'Penta Shot'],
			},
			{
				class: ['Twin', 'Quad Tank', 'Octo Tank'],
			},
			{
				class: ['Twin', 'Quad Tank', 'Cyclone']
			},
			{
				class: ['Sniper', 'Trapper', 'Fortress'],
			},
			{
				class: ['Sniper', 'Assassin', 'Ranger'],
				up: 1
			},
			{
				class: ['Sniper', 'Assassin', 'Sprayer'],
				up: 1
			},
		],
		/*
			Build orders, indexed by points spent. 33 entries each, and no stat may appear more
			than 7 times - both are the diep economy PENDING #30 adopted (they were 27 entries
			against a 6-point cap). The six trailing entries per row are new and finish each build
			along its own existing bias rather than introducing a stat it never wanted: a stat that
			is already at 7 is silently refused by upgrade(), which would strand the point.
		*/
		'BOT_UPS': [
			[1, 3, 4, 3, 1, 4, 3, 3, 3,
				2, 2, 1, 6, 6, 3, 4, 2, 1,
				2, 6, 1, 1, 0, 0, 7, 2, 1,
				3, 4, 4, 4, 4, 6],
			///SNIPER
			[1, 1, 3, 3, 4, 4, 2, 2, 2,
				2, 3, 4, 2, 3, 4, 1, 1, 4,
				1, 1, 3, 3, 4, 0, 0, 0, 4,
				2, 2, 1, 3, 0, 0]
		],
		'botThreshold': {
			farm: 300,
			attack: 11,
			attackHp: 20,
			attackDis: 15,
			attackxpBase: 90,
			attackxpDivide: 45000,
			attackxpMax: 45000,
			run: 350,
			playerRun: 9,
			minRun: .012,
			runHp: 60,
			stand: 50,
			runDis: 1,
			farmDis: 700
		},
		///
		'BOSS': [
			[
				function () {
					if (!this.DETEC) {
						this.DETEC = new Detector(this, this.x, this.y, this.screen, [KIND.PLAYER], 0, 1)
						this.DETEC.team = this.team;
						this.detected = [];
					} else {
						this.DETEC.size = this.screen;
						this.DETEC.x = this.x;
						this.DETEC.y = this.y;
						this.detected = [];
						for (const n of this.DETEC.selectAll[KIND.PLAYER]) {
							// Dividing by raw n.level would be Infinity at level 0 (a fresh
							// Player, briefly - one tick - true of both an initial join and every
							// respawn), which never clears the dis < n.screen/30 check below. Floored
							// mostly to close off that edge, not because it was the whole story - see
							// respawn()'s inputs/shield note in rooms/Room.js for the bigger one.
							const dx = n.x - this.x, dy = n.y - this.y;
							// Distance is measured from the boss's HULL, not its centre. At level 0-1
							// the radius this is compared against is 65.6 units, SMALLER than the boss's
							// own 64-radius body, so a centre-relative distance was only ever satisfiable
							// by standing INSIDE the boss - which entities/Player.js's positional overlap
							// resolution now prevents, and which would otherwise leave a fresh respawn
							// unable to aggro a Summoner at all (the case the level floor below exists
							// for). Subtracting the hull is done as a FRACTION of the raw distance so it
							// carries into the screen-shaped metric below correctly: that metric squashes
							// y by 0.5625, so a flat subtraction would be worth 1.78x more along one axis
							// than the other and which axis a tank got shoved down is random.
							const raw = Math.sqrt(dx * dx + dy * dy) || 1;
							const outside = Math.max(0, raw - this.size) / raw;
							// The screen-shaped (16:9, hence the 0.5625) distance, divided by level so a
							// high-level tank is seen from much further off.
							const dis = Math.sqrt(dx * dx + Math.pow(dy / 0.5625, 2)) * outside / Math.max(1, n.level);
							if (dis < n.screen / 30) {
								this.detected.push(n);
							}
						}
					};
					this.dir += tick.perTick(0.01212);   // one-time-rescaled from 0.01 (33ms ref)
					const dis = Math.sqrt((this.x * this.x) + (this.y * this.y)) * 2.2;
					// tick.quadratic(), not tick.perTick(): this thrust is added every tick and then
					// integrated into position again below, i.e. twice over ticks - the same
					// category (and the same fix) as entities/Bullet.js's cruise thrust. 0.219408
					// is the old 0.13713 x that file's SPEED_RESCALE (1.6), so a boss drifts at
					// exactly the speed it did at the live TICK_MS; a frozen constant, not SCALE.
					const motion = new Vec(BOSS_DRIFT, 0).rotate(Math.atan2(this.y, this.x) - Math.PI * Math.min(1, (dis / this.map.width)));
					this.vec.add(motion)
					// BODY_FRICTION, not the tank's 10/11, and this is the deliberate call plan.md
					// step 2 asked for rather than a leftover. Three reasons, in order of weight:
					//
					// 1. NOTHING PINS A TANK'S F TO THIS ENTITY. F = 10/11 is derived from ONE
					//    identity, physics.html's V_max = 10 x A, and that is stated for a steered
					//    tank under player input. A boss has no input; its "A" is BOSS_DRIFT, a
					//    scripted wander toward/away from the arena centre. There is no diep top
					//    speed for it to be faithful to - diep has no Summoner boss at all.
					// 2. THIS IS NOT THE TANK INTEGRATOR AND NEVER WAS. rooms/Room.js's
					//    createBoss() does `b.motion = spec[0].bind(b)`, i.e. this function
					//    REPLACES Player.prototype.motion() outright, so a boss never reaches
					//    Physics.stepBody. The `/ 10` on the position step below means this.vec is
					//    not even in the same units as a tank's velocity, so the tank's F has no
					//    unit-correct meaning here.
					// 3. BOSS_DRIFT WAS TUNED AGAINST 0.956532 (and then one-time-rescaled through
					//    the 33->40ms conversion), exactly like every bullet and shape constant.
					//    Moving F under it drops the drift's steady state to ~0.45x - an unasked-for
					//    balance change with nothing in any reference behind it.
					//
					// So the boss gets the same rule bullets get: unchanged until something says
					// otherwise. Its aimed/shooting behaviour is untouched either way - the boss's
					// second bound function only calls this same motion() and shoot().
					this.vec.x *= BODY_FRICTION;
					this.vec.y *= BODY_FRICTION;
					this.x += this.vec.x / 10;
					this.y += this.vec.y / 10;
					///
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
					if (this.DETEC) {
						this.DETEC.reset();
					}
				},
				function () {
					this.hit = Math.max(0, this.hit - 1);
					if (this.destroy > 1) {
						this.x += this.vec.x;
						this.y += this.vec.y;
						this.destroy -= 1;
						this.alpha = (this.destroy - 1) / DES;
						this.size *= tick.drag(1.04869);   // one-time-rescaled from 1.04 (33ms ref)
						return;
					}
					this.xp = this.prize;
					///
					this.motion();
					if (this.detected.length || Math.random() < BOSS_SHOOT_CHANCE) {
						this.up.BPene = this.detected.length * .9;
						this.shoot();
					}
					///
				},
				'Summoner'
			],
		],
		/*
			Tag's win-condition NPC (PENDING #28, rooms/Tag.js's createCloser()/startClosing()).
			Same [motion, update, className] shape as BOSS above, bound onto a fresh Player the
			same way - see rooms/Tag.js for why it is a Player rather than a new entity kind.

			No steering/turn-rate: diep gives it no tank body to be faithful to, and
			diep_wiki/Arena Closer.txt's "immediately go after players" and "ramming into them"
			reads as relentless, not maneuvered. Retargets every tick (cheapest correct choice -
			Tag's whole roster is at most 30ish live players, an O(n) scan every tick is nothing
			next to the base-drone detector work every other mode already does per tick) rather
			than latching onto one target until it dies, so a closer always chases whoever is
			nearest right now.
		*/
		'CLOSER': [
			[
				function () {
					let best = null, bestD = Infinity;
					for (const p of this.room.INSTANCE.players.live()) {
						if (p.boss || p.closer || p.destroy || p.dead) { continue; }
						const dx = p.x - this.x, dy = p.y - this.y;
						const d = dx * dx + dy * dy;
						if (d < bestD) { bestD = d; best = p; }
					}
					this.target = best;
					if (best) {
						this.dir = Math.atan2(best.y - this.y, best.x - this.x);
						this.x += Math.cos(this.dir) * CLOSER_SPEED;
						this.y += Math.sin(this.dir) * CLOSER_SPEED;
					} else {
						// Nothing left alive to chase - drift like an idle polygon rather than
						// freeze in place. diep_wiki: "they'll be spinning and slowly drifting in
						// a random direction" once every target is dead; this settles toward a
						// stop rather than drifting forever, a simplification worth flagging since
						// nobody is left in the room to notice either way by the time it applies.
						this.dir += tick.perTick(0.01212);
						this.vec.x *= BODY_FRICTION;
						this.vec.y *= BODY_FRICTION;
						this.x += this.vec.x / 10;
						this.y += this.vec.y / 10;
					}
					if (this.x < -this.map.width / 2) { this.x = -this.map.width / 2; }
					if (this.y < -this.map.height / 2) { this.y = -this.map.height / 2; }
					if (this.x > this.map.width / 2) { this.x = this.map.width / 2; }
					if (this.y > this.map.height / 2) { this.y = this.map.height / 2; }
				},
				function () {
					this.hit = Math.max(0, this.hit - 1);
					this.motion();
					if (this.target) { this.shoot(); }
				},
				'Arena Closer'
			],
		],
		'PETS': [
			function (play) {
				this.showDir = Math.atan2((play.y + play.inputs.mouse_y) - this.y, play.x + play.inputs.mouse_x - this.x)
				if (!this.delay) {
					const dir = Math.random() * Math.PI * 2;
					this.pos = {
						x: Math.cos(dir) * (play.size * 2),
						y: Math.sin(dir) * (play.size * 2)
					};
					this.delay = 20 + Math.floor(Math.random() * 150);
				} else {
					this.delay -= 1;
				}
				////
				// 2.475 is 3 one-time-rescaled from the 33ms reference
				// (3*33/40), a reference-tick count in shape - but it is deliberately NOT run
				// through tick.lead(), for the same reason AUTOTURRET_LEAD above is now flat.
				// play.vec is already a real-tick velocity that is itself close to TICK_MS-invariant
				// (verified numerically), so multiplying it by a further SCALE-adjusted divisor is
				// what would introduce a step-rate dependency, not remove one - confirmed by testing
				// both forms across TICK_MS 16/25/33/40: the raw multiply used here stays within
				// ~6% across that range, tick.lead(2.475) varies the result by 2x+.
				this.dir = Math.atan2(play.y + play.vec.y * 2.475 + this.pos.y - this.y, play.x + play.vec.x * 2.475 + this.pos.x - this.x);   // 3 one-time-rescaled
				// Both terms carry entities/Bullet.js's SPEED_RESCALE (1.6) because the thrust below
				// is now tick.quadratic() - .6 one-time-rescaled against the pet's own friction
				// (PET_FRICTION, not global FRICTION) x 1.6, and play.vec / 16 x 1.6 = / 10.
				this.speed = 0.873504 + play.vec.length() / 10;
				////
				// tick.quadratic(), not tick.perTick(): added every tick and then integrated into
				// position again - the same double integration entities/Bullet.js's motion tail
				// documents. The pet's follow distance at the live TICK_MS is unchanged.
				this.vec.add(new Vec(tick.quadratic(this.speed), 0).rotate(this.dir))
				this.vec.x *= PET_FRICTION;
				this.vec.y *= PET_FRICTION;
				this.x += this.vec.x;
				this.y += this.vec.y;
			}
	]
};
CONFIG.BOT_NAMES = require(CONFIG.BOT_NAMES).name;
// Same [motion, update, className] shape as CONFIG.BOSS/CONFIG.CLOSER above - one entry per
// cannon variant (public/SHARE/TanksConfig.js's "Destroyer Dominator"/"Gunner Dominator"/
// "Trapper Dominator"), all three sharing the identical motion/update function references since
// nothing about the AI itself differs between variants, only the cannon table it fires through.
CONFIG.DOMINATOR = [
	[dominatorMotion, dominatorUpdate, 'Destroyer Dominator'],
	[dominatorMotion, dominatorUpdate, 'Gunner Dominator'],
	[dominatorMotion, dominatorUpdate, 'Trapper Dominator']
];

module.exports = CONFIG;
