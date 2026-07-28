/*
	Bot, boss and pet AI.

	These behaviour functions get bind()-ed onto entities at spawn time, so `this` inside
	them is the tank / boss / pet, not this module. Detector/Vec/FRICTION/CLASS are all leaves,
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
const FRICTION = tick.drag(require('./constants.js').FRICTION);
const CLASS = require('../public/SHARE/TanksConfig.js').class;
const DES = tick.DES;

// One-time-rescaled from the 33ms reference, then converted to a real-tick
// value once at load - same treatment as entities/Player.js's identical auto-turret lead and
// bot spin-flip chance. See that file's WP-D audit comment: this tick.lead() conversion is
// flagged, not fixed, as not actually tick-scale invariant - kept identical to Player.js's copy
// so bots and humans miss in the same way rather than disagreeing.
const AUTOTURRET_LEAD = tick.lead(9.9);
const BOT_SPIN_FLIP_CHANCE = tick.chance(0.00242);
const BOT_TURN_RATE = tick.smoothing(0.35101);
const BOSS_SHOOT_CHANCE = tick.chance(0.48485);
// Pets brake twice as hard as everything else (1-fr = (1-FRICTION)*2, a design choice, not a
// tick-rate artifact) - treated as its own independent friction constant with its own one-time
// rescale (0.928^(40/33)) rather than derived from the already-rescaled global FRICTION, which
// would silently change the 2x relationship.
const PET_FRICTION = tick.drag(0.91341);

const CONFIG = {
		'BOTS': [
			function () {
				if (isNaN(this.path)) {
					this.path = CONFIG.BOT_PATHS[Math.floor(Math.random() * CONFIG.BOT_PATHS.length)]
				}
				if (this.stillLvl) {
					this.upgrade(CONFIG.BOT_UPS[this.path.up ? this.path.up : 0][this.stillLvl]);
				}
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
		'BOT_UPS': [
			[1, 3, 4, 3, 1, 4, 3, 3, 3,
				2, 2, 1, 6, 6, 3, 4, 2, 1,
				2, 6, 1, 1, 0, 0, 7, 2, 1],
			///SNIPER
			[1, 1, 3, 3, 4, 4, 2, 2, 2,
				2, 3, 4, 2, 3, 4, 1, 1, 4,
				1, 1, 3, 3, 4, 0, 0, 0, 4]
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
							const dis = Math.sqrt(Math.pow(n.x - this.x, 2) + Math.pow((n.y - this.y) / 0.5625, 2)) / Math.max(1, n.level);
							if (dis < n.screen / 30) {
								this.detected.push(n);
							}
						}
					};
					this.dir += tick.perTick(0.01212);   // one-time-rescaled from 0.01 (33ms ref)
					const dis = Math.sqrt((this.x * this.x) + (this.y * this.y)) * 2.2;
					const motion = new Vec(tick.perTick(0.13713), 0).rotate(Math.atan2(this.y, this.x) - Math.PI * Math.min(1, (dis / this.map.width)));   // .15 one-time-rescaled (singleAppFactor, see Physics.js)
					this.vec.add(motion)
					this.vec.x *= FRICTION;
					this.vec.y *= FRICTION;
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
				// through tick.lead() at this consumption site, unlike AUTOTURRET_LEAD above.
				// play.vec is already a real-tick velocity that is itself close to TICK_MS-invariant
				// (verified numerically), so multiplying it by a further SCALE-adjusted divisor is
				// what would introduce a step-rate dependency, not remove one - confirmed by testing
				// both forms across TICK_MS 16/25/33/40: the raw multiply used here stays within
				// ~6% across that range, tick.lead(2.475) varies the result by 2x+.
				this.dir = Math.atan2(play.y + play.vec.y * 2.475 + this.pos.y - this.y, play.x + play.vec.x * 2.475 + this.pos.x - this.x);   // 3 one-time-rescaled
				this.speed = 0.54594 + play.vec.length() / 16;   // .6 one-time-rescaled against the pet's own friction (PET_FRICTION), not global FRICTION
				////
				this.vec.add(new Vec(tick.perTick(this.speed), 0).rotate(this.dir))
				this.vec.x *= PET_FRICTION;
				this.vec.y *= PET_FRICTION;
				this.x += this.vec.x;
				this.y += this.vec.y;
			}
	]
};
CONFIG.BOT_NAMES = require(CONFIG.BOT_NAMES).name;

module.exports = CONFIG;
