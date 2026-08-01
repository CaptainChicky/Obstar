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
const CLASS_LIST = require('../public/SHARE/TanksConfig.js').list;
const Physics = require('../public/SHARE/Physics.js');
const KIND = require('../public/SHARE/kinds.js');
const ACHIEVEMENTS = require('../public/SHARE/AchievementsConfig.js').list;
const Bullet = require('./Bullet.js');
const Detector = require('./Detector.js');

/*
	Auto-turret aim lead (shoot()): the divisor in `other.vec * dis / AUTOTURRET_LEAD`, which
	offsets the aim point along a target's own velocity.

	A FLAT constant, deliberately not tick.lead(9.9). Both of the other factors in that expression
	are already TICK_MS-invariant on their own - `dis` is a distance in world units, and
	`other.vec` is a real-tick velocity whose magnitude barely moves across tick rates (the same
	reasoning as the knockback-threshold comments below and in entities/Objects.js) - so dividing
	by a SCALE-adjusted constant was what introduced a step-rate dependency, not what removed one.
	Measured across TICK_MS 16/25/33/40: tick.lead(9.9) swung the aim offset by over 100%, a flat
	divisor holds it to ~1.5%.

	15.84 is exactly what tick.lead(9.9) evaluated to at the live TICK_MS (9.9 / 0.625), so today's
	auto-aim feel is unchanged - the fix costs no balance call. It is a frozen constant: if TICK_MS
	moves, this must not. lib/gameAI.js keeps an identical copy so bots and humans lead a moving
	target the same way.
*/
const AUTOTURRET_LEAD = 15.84;

// diep_wiki/Stats.txt: Body Damage "is increased by 50% when affecting Tanks" - the counterpart to
// entities/Bullet.js's PROJECTILE_BODY_DAMAGE (-75% vs projectiles), both halves of the same wiki
// sentence (PENDING #18/nuance 50). Applies to the KIND.PLAYER collision arm only (tank-vs-tank
// body-ram); the vs-shapes baseline this multiplies is `this.damage` below (PENDING #17).
const TANK_BODY_DAMAGE = 1.5;

// Wall contact physics (PENDING #2, wall-only slice) - see lib/constants.js for what these mean
// and why they're ours, not diep's. WALL_FRICTION is pre-converted to a per-tick drag factor at
// load, same as entities/Objects.js's own BODY_FRICTION; WALL_BOUNCE is a dimensionless ratio
// applied directly to a live this.vec read, not a fresh magnitude, so it is used as-is (see the
// KIND.WALL collision arm below).
const WALL_BOUNCE = require('../lib/constants.js').WALL_BOUNCE;
const WALL_FRICTION = tick.drag(require('../lib/constants.js').WALL_FRICTION);

// Idle spin rate, per reference tick: an auto-turret with nothing to shoot at (shoot()), and the
// `c` auto-spin toggle (update()). One constant, because they are meant to look like the same
// motion - PENDING #21 retunes both together or neither.
const SPIN_RATE = 0.04;

/*
	Regen, two regimes (PENDING #17, plan.md step 4): diep_wiki/Stats.txt's linear rate below the
	hyper-regen threshold, hyper regen above it. Both are read directly in update() - no accumulator
	any more, so no lib/tick.js "quadratic" category is needed here either; each is a genuine
	per-reference-tick rate, tick.perTick()'d like any other.

	HYPER_REGEN_DELAY: "the rate of regeneration greatly increases after approximately 30 seconds"
	of no damage taken - 30000ms / REF_TICK_MS(40) = 750 reference ticks, converted once at load via
	tick.ticks() to whatever TICK_MS actually is.

	HYPER_REGEN_RATE: NOT published, so solved from diep_wiki/Stats.txt's own two tables rather than
	guessed. The wiki's "Time to Regen to Full Health" table (0-7 Regen points: 31.97 / 30.67 /
	23.07 / 15.15 / 11.75 / 9.13 / 7.72 / 6.41 s) is captioned "the amount of time... to fully
	restore its health AFTER RAMMING INTO A PENTAGON" - i.e. it is NOT healing from 0% (the reading
	plan.md's own writeup used as a illustrative shorthand), it is healing back a single ram's fixed
	damage fraction D of MaxHp. Taking that literally and least-squares-fitting the two unknowns (D
	and this rate) against all 8 published times - not just the point-0 illustration - lands at
	D = 0.2011 (a single ram costs ~20% of the pool) and this rate, with a max residual of 0.7s
	across all 8 points (the wiki itself: "Percentages and statistics on this page are merely
	approximate"). The naive "healing from 0%" reading is internally INCONSISTENT past 1-2 Regen
	points (it demands the tank finish healing in negative time by point 3), which is what rules it
	out here rather than it being an arbitrary preference between two equally-valid fits.
	Point-independent on purpose: diep_wiki/Stats.txt says Shapes/Bullets have no slow regen of
	their own but DO hyper regen, so a Regen stat (which they don't have) cannot gate its rate.
*/
const HYPER_REGEN_DELAY = tick.ticks(750);
const HYPER_REGEN_RATE = 0.085871;   // fraction of maxHp healed per SECOND once hyper regen is active

// Sandbox-only practice key ('k', PENDING "Sandbox gaps") - a threshold on a per-tick hold
// counter (same tick.ticks() category HYPER_REGEN_DELAY above uses), not a physical quantity.
// diep_wiki gives no rate for its own hold-to-repeat 'K', so this is ours: 5 reference ticks
// (200ms) per level, level 0 to the 45 cap in ~9s of holding - fast enough to read as "hold and
// watch it climb," not an instant jump (the old behaviour here) or a crawl.
const SANDBOX_LEVELUP_TICKS = tick.ticks(5);

/*
	The upgrade economy, diep's own (PENDING #30 / plan.md step 1): 45 levels, 7 points per stat,
	33 points over a life, one class tier every 15 levels.

	This is a deliberate conversion of a coherent 2/3-scale version (30 levels, 6 points, 28
	total, a tier every 10), not a bug fix. It is here because every diep formula is denominated
	in diep's own caps: Physics.js's 1.07^points assumes 7 of them and 1.015^level assumes 45 of
	those, and #17's +20 HP/point assumes 7. Adopting a formula without its domain is what left
	#14's form fix at 0.96x where diep's own figure is 1.03x.

	POINTS ARE A GRANT SCHEDULE, NOT A LEVEL COUNT MINUS TAKEBACKS. The old rule handed out one
	point per level and then took two back (stillLvl++ at levels 18 and 27) to land on 28. diep
	never takes a point back: it changes the *rate*, one per level to 28 and then one at 30 and
	every third level after, which is where 33 comes from. pointsAtLevel() below is the whole
	rule, and rooms/Room.js's getUi() reads it too so the client's "points available" counter
	cannot drift from what upgrade() will actually allow.
*/
const MAX_PER_STAT = 7;
const GRANT_EVERY_LEVEL_TO = 28;  // 1 point per level up to and including this one
const LATE_GRANT_FROM = 30;       // then one here...
const LATE_GRANT_STEP = 3;        // ...and every third level after, to the cap
// Mirrors rooms/Room.js's XPLVL length. A Player can't out-level its own XPLVL array, so this is
// a guard against a hand-set level (the resetLevel/xp admin commands), not a second source of truth.
const LEVEL_CAP = 45;

// Sandbox-only cheat ('\', PENDING "Sandbox gaps") - a raw class preview, not an evolution, so
// it skips upClass()'s tree/level gating entirely. TanksConfig.js's exports.list filtered down
// to real playable tanks: the dev/debug placeholders ('testbed' etc.) are hidden, uncontrollable
// stand-ins (test/tanks.js's own whitelist explains why). Arena Closer and the 3 Dominator
// variants are cyclable on purpose, for now (explicit ask, PENDING #51) - they're normally
// scripted entities (lib/gameAI.js's CONFIG.CLOSER/CONFIG.DOMINATOR), so previewing them this way
// only gets TanksConfig.js's stats/body/cannons, none of the AI's invincibility or pass-through-
// wall behaviour, which is enough for a human to eyeball the Arena Closer body-shape fix (PENDING
// #51) without waiting on those classes getting their own Player subclass. Summoner stays
// excluded - it's a boss, not a Dominator/Closer, and wasn't part of that ask.
const CYCLE_EXCLUDE = new Set([
	'pre launch', 'testbed', 'bigView', 'shapes', 'shape1', 'shape2', 'Summoner'
]);
const CYCLABLE_CLASSES = CLASS_LIST.filter((name) => !CYCLE_EXCLUDE.has(name));

// Total upgrade points a tank has been granted by `level`. Level 1 (a fresh spawn) is 0 points,
// level 28 is 27, level 45 is 33.
function pointsAtLevel(level) {
	const lvl = Math.min(level, LEVEL_CAP);
	let n = Math.max(0, Math.min(lvl, GRANT_EVERY_LEVEL_TO) - 1);
	if (lvl >= LATE_GRANT_FROM) {
		n += Math.floor((lvl - LATE_GRANT_FROM) / LATE_GRANT_STEP) + 1;
	}
	return n;
}

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
		// Achievements: id -> 1 once unlocked, guards unlock() against firing
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
		// diep's own MH0 (diep_wiki/Stats.txt: "Base HP = 50 + [2 x (Level - 1)]", "the health of a
		// level 1 tank is exactly 50.0") - PENDING #17, plan.md step 4. Not a rescale of the old 150;
		// the whole formula (this, the level-up +2 below, and HpUp's +20/pt in upgrade()) is diep's
		// raw numbers, adopted directly now that #30 made our stat/level caps diep's too.
		this.maxHp = 50;
		// Ticks since the last HP loss, real-tick-denominated - drives the hyper-regen threshold in
		// update(). Not the old quadratic accumulator (hpregan); see update()'s regen block.
		this.noDamageTicks = 0;
		this.hp = this.maxHp;
		this.lastHp = this.hp;
		this.prize = 100;
		this.autoDir = 0;
		// The `c` auto-spin's own phase. Seeded from wherever the barrel is pointing the moment the
		// toggle goes on and turned from there, so engaging it reads as the tank starting to spin
		// rather than snapping onto some counter that has been running since you spawned. `spinning`
		// is the edge detector, not a duplicate of inputs.c.
		this.spinDir = 0;
		this.spinning = 0;
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
			"n": 0,
			"k": 0   // Sandbox-only hold-to-level-up cheat (net/gameSocket.js, update() above)
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
		// diep's own vs-shapes body-damage baseline is (BodyDamagePoints+5)x4 = 20 at 0 points
		// (diep_wiki/Stats.txt), 2.857142857x (20/7) a Basic bullet's own 7 damage/loop. Bullet
		// magnitudes aren't diep-adopted yet (MEASUREMENTS.md's M1), so that ratio is applied to
		// Basic's own can.damage (public/SHARE/TanksConfig.js, 4.84848) instead of converting 20
		// directly - 4.84848 x 20/7 = 13.852814 (PENDING #17, was 8.48485, a 1.75x ratio against
		// the same bullet). tick.perTick() at each hp -= site, same as before.
		this.damage = 13.852814;
		this.murder = -1;
		this.up = {
			"MSpeed": 0, //0
			"Reload": 1, //1
			"BSpeed": 1, //2
			"BPene": 1,  //3
			"BDamage": 1,//4
			"BodyDam": 1,//5
			"HpUp": 0,    //6
			"HpRegan": 0  //7, a point COUNT (diep_wiki/Stats.txt's "Regen Stat") since PENDING #17
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
		this.autoDir += tick.perTick(SPIN_RATE);
		// Players alone get to leave the drawn arena, up to config.OOB_MARGIN - a measured diep
		// behaviour, not a spring: the real wall is just further out than
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
					// A boss and a Closer (PENDING #28) both hold a fixed, non-level-derived `size` -
					// their update() is fully replaced (lib/gameAI.js), so this class's own
					// `this.size = 28 * 1.01^level` growth line below never runs for either - so
					// their bullets draw at the literal cannon size TanksConfig.js states rather
					// than the tank-relative `ra` an ordinary levelling player's cannons scale by.
					Bull.size = (this.boss || this.closer) ? can.size : can.size * ra;
					// An Arena Closer's own bullets pass through Maze walls the same way the closer
					// itself does (diep_wiki, PENDING #26/#28) - entities/Bullet.js's KIND.WALL arm
					// reads this. Undefined (falsy) for every ordinary shot.
					Bull.closer = this.closer;
					Bull.weight = can.weight;
					Bull.push = can.push;
					this.room.createBullet(Bull, this)
					// tick.impulse(), not tick.perTick(): this.vec is fed into Physics.stepBody, which
					// re-scales it by dtTicks on every subsequent position step, so a one-shot impulse
					// landing in vec is already reference-tick-denominated and must go in flat or it is
					// scaled by dtTicks twice (PENDING #43) - at the live 25ms tick perTick() delivered
					// only 0.64x of what the `back` column states.
					this.vec.add(new Vec(tick.impulse(can.back), 0).rotate(dir - Math.PI));
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
		// stillLvl counts points *spent*; pointsAtLevel() is what has been granted. It used to be
		// a bare `this.level`, which only worked because a point was granted per level.
		if (pointsAtLevel(this.level) - this.stillLvl <= 0) {
			return 1;
		}
		switch (data) {
			case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
				if (this.upNb[data] >= MAX_PER_STAT) {
					break;
				}
				this.stillLvl += 1;
				this.upNb[data] += 1;
				let nb = -1;
				for (const i in this.up) {
					nb++;
					if (nb !== data) { continue; }
					/*
						Every step below except MSpeed/Reload/HpRegan/HpUp/BPene/BodyDam/BDamage/BSpeed
						is the old 6-point-span value x 6/7 (PENDING #30): the cap moved to 7, so an
						unchanged step would have handed a maxed stat ~17% more than it was ever tuned
						to give. Scaling the step instead keeps each stat's *maxed* value exactly where
						it was and only changes the granularity, which is the conversion this item asks
						for and not a stealth buff.

						Eight exceptions, none of them a 6->7 rescale of an old step. Reload is diep's own
						geometric form: up.Reload = 0.914^points, a multiplier on can.reload consumed in
						shoot() (diepcustom/src/Entity/Tank/TankBody.ts:267, `15 * Math.pow(0.914, ...)`),
						so 0.53287 at the 7-point cap = 1.877x fire rate - not a linear step with a span
						to rescale. MSpeed since #14's
						form fix; HpRegan and HpUp since #17's health model (plan.md step 4) replaced the
						old health formula wholesale with diep's own raw numbers (MH0 = 50, +2/level,
						+20/point, "Regen Stat" 0-7 read directly into diep_wiki/Stats.txt's HPS formula
						in update()) rather than rescaling the old 110/0.28-per-point figures - there was
						nothing faithful about those to preserve. BPene since PENDING #18's last open
						piece: diep's own per-point slope is linear (`PP = base x (1+0.75*points)`,
						diep_wiki/Dominator.txt), so `up.BPene`'s flat +0.75/pt step *is* that formula -
						no separate raw-point-count field is needed the way MSpeed's exponential form
						needed one, since a flat step is already mathematically a point count times a
						constant. `can.pene`/`necro.pene` in TanksConfig.js need no rescale alongside it:
						the multiplier's 0-point baseline was already 1 under the old step too, so those
						tables already sit at diep's base-HP value - only the MAXED multiplier moves
						(8.5x -> 6.25x), which is the actual fidelity fix, not a value to compensate for.
						BDamage and BSpeed are diep's own per-point slopes, already linear on the
						1-based multiplier up.BDamage/up.BSpeed carry: damagePerTick = (7 + 3*points) *
						bullet.damage is 1 + 3/7 per point (diepcustom/src/Entity/Tank/Projectile/
						Bullet.ts:92), and bulletAccel = (20 + 3*points) * bullet.speed is 1 + 3/20 per
						point (diepcustom/src/Entity/Tank/Barrel.ts:222) - neither has a 6-point span to
						rescale from.
						BodyDam since PENDING #17's last open piece: `this.damage`'s base and step were
						rederived from diep's own vs-shapes formula (see the constructor), not rescaled
						from an old span - see that comment for the derivation.
					*/
					switch (i) {
						// A point COUNT (diep_wiki/Stats.txt's "Regen Stat", read directly by update()'s
						// HPS = MaxHp*(0.03+0.12*rr)/30 - see the constant there), not an accumulated
						// per-tick rate any more.
						case "HpRegan": this.up[i] += 1; break;
						case "Reload": this.up[i] *= 0.914; break;         // up.Reload = 0.914^points, a multiplier on can.reload (diepcustom/src/Entity/Tank/TankBody.ts:267)
						case "BSpeed": this.up[i] += 0.15; break;          // bulletAccel = (20 + 3*points) * bullet.speed, i.e. 1 + 3/20 per point (diepcustom/src/Entity/Tank/Barrel.ts:222)
						case "BDamage": this.up[i] += 0.4285714; break;    // damagePerTick = (7 + 3*points) * bullet.damage, i.e. 1 + 3/7 per point (diepcustom/src/Entity/Tank/Projectile/Bullet.ts:92)
						case "BPene": this.up[i] += 0.75; break;           // diep's own per-point slope (PENDING #18), not a 6/7 rescale
						// A point COUNT, not a bonus: Physics.moveAccel() raises MOVE_STAT_MUL to it
						// (PENDING #14). It used to accumulate an accel term (0.029254/pt) because
						// the stat was additive; the multiplier needs the exponent instead, and
						// keeping the count here rather than in upNb[0] leaves every caller of
						// moveAccel(this.up.MSpeed, ...) reading the same field it always did.
						case "MSpeed": this.up[i] += 1; break;
						// diep's own flat +20 HP/point (diep_wiki/Stats.txt), not a rescale of the old
						// 110. The ratio comes off the OLD maxHp, so the point heals you by exactly the
						// fraction it added - same proportional-heal shape the old 110-point step used,
						// carried forward rather than reinvented. hp stays a float (update()'s regen
						// adds a fractional amount every tick, and the wire carries hp as a fraction of
						// maxHp), so no truncation risk here.
						case "HpUp": this.hp *= (this.maxHp + 20) / this.maxHp; this.maxHp += 20; break;
						case "BodyDam": this.damage += 2.770563; break;   // 0.2 x the 13.852814 base - diep's own "BS = 1+0.2xbd" slope (PENDING #17), 2.4x base at the 7-point cap
					}
					break;
				}
		}
	}
	upClass(data) {
		if (this.destroy) { return; }
		let tanks = [];
		// A class tier every 15 levels - diep's own gates, 15/30/45 (PENDING #30).
		// Note this dropped the old form's `1 +`: our levels are 1-based in exactly diep's sense
		// (XPLVL[0] is 0, so a fresh tank is level 1), so `(1 + level) / 10` was opening tier 1 at
		// level 9 under a rule that read "every 10". rooms/Room.js's getUi() sends the same
		// expression as `cLvl`, and test/rooms.js's fastestTankSpeed() mirrors it.
		for (let i = 0; i < parseInt(this.level / 15); i++) {
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
	/*
		Sandbox-only cheat ('\', PENDING "Sandbox gaps") - jumps straight to a class with none of
		upClass()'s tree/level gating, so a human can preview any tank regardless of level. Redoes
		the same class-dependent resets upClass() does (DETEC/droneCount/necro/shootTimer) but
		does not touch classLvl or unlock('scary_tank') - this isn't a real evolution.
	*/
	cycleClass() {
		const i = CYCLABLE_CLASSES.indexOf(this.class);
		this.class = CYCLABLE_CLASSES[(i + 1) % CYCLABLE_CLASSES.length];
		if (!this.bot && this.DETEC && !CLASS[this.class].DETEC) { this.DETEC = null; }
		this.droneCount = 0;
		this.necro = CLASS[this.class].necro;
		this.shootTimer = new Array(CLASS[this.class].cannons.length).fill(0);
	}
	// Body damage reduces damage taken (PENDING #18, plan.md step 9 - landed with step 4's health
	// model per the lethality call, since adopting the HP side alone without this would have
	// shortened time-to-kill 4-5x). diep_wiki/Stats.txt + PENDING #18: BS = 1 + 0.2*bd, and a tank
	// takes 0.4/BS of a nominal DPL from any source - 40% at bd 0 (BS 1), 16.7% at bd 7 (BS 2.4).
	// `this.upNb[5]` is BodyDam's own point count (the `up` object's index, same convention as
	// upgrade()'s switch); `this.up.BodyDam`/`this.damage` track the OFFENSIVE side (damage this
	// tank deals) and are untouched - this is the separate DEFENSIVE term #18 says we lack.
	damageReduction() {
		return 0.4 / (1 + 0.2 * this.upNb[5]);
	}
	collision(other, option = {}) {
		if (this.dev.ghost) { return; }
		// An Arena Closer (PENDING #28, rooms/Tag.js's createCloser()) - diep_wiki: "Invincibility"
		// and "Complete resistance to knockback". Returning before anything below runs means it
		// takes no damage AND no velocity impulse from any of the three collision kinds, or from an
		// admin 'god' repulsion - a single guard for both wiki claims, since neither has a separate
		// mechanism to turn off. The damage it DEALS is unaffected: that is `other.damage` read from
		// the OTHER entity's own collision() call, not anything gated here.
		if (this.closer) { return; }
		// Sandbox god mode (';', PENDING "Sandbox gaps") - repel whatever touches you and take
		// no consequence from the contact, the same one-sided shape the dev.ghost/closer guards
		// above use. Checked on `this`, not passed in as an option, so a single flag on the god
		// player's own instance handles both directions of every pair: Room.js calls collision()
		// on each side separately, so the god player's own call is what has to short-circuit.
		if (this.dev.god) {
			// tick.impulse(), not tick.perTick() - this.vec routes through Physics.stepBody, see
			// the `back` comment above. 8.96 = 3.2 gu x 2.8, deliberately twice the ordinary
			// tank-body shove below, which is what it has always been relative to it. Not a diep
			// number - diep has no god mode - so it rides the tank-body row rather than a table.
			this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.impulse(8.96), tick.impulse(8.96))));
			return;
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
				// 4.48 = diep's "All Tank Bodies" knockback, 1.6 gu per loop of contact, through the
				// same `gu x 2.8` impulse identity TanksConfig.js's `weight` and `back` columns use:
				// a one-shot impulse on tank velocity displaces v0 x F/(1-F) = 10 x v0 units at the
				// tank F = 10/11, and 1.6 x 2.8 x 10 / 28 = 1.6 gu.
				// tick.impulse(), not tick.perTick() - this.vec routes through Physics.stepBody. The
				// hp drain below stays perTick(): it is genuine per-tick-of-contact damage, not a
				// one-shot impulse.
				this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.impulse(4.48), tick.impulse(4.48))));
				// Positional overlap resolution, on top of the velocity impulse rather than instead of
				// it. The impulse alone cannot separate two tanks inside a normal contact window - it
				// lands in `vec` and is then decayed by stepBody over many ticks, during which the pair
				// is still overlapping - so two tanks visibly interpenetrate. This pushes them apart
				// along their separation axis by the overlap, split by size so the bigger tank moves
				// less. rooms/Room.js calls collision() on BOTH sides of a pair, so each body moves only
				// its own share and the two shares sum to the whole overlap. The calls are sequential,
				// so the second sees the first's move and this behaves as a relaxation rather than a
				// snap - a deep overlap clears over about two ticks. It runs before the noDam break
				// because teammates take up space too. No diep reference behind it, unlike everything
				// around it - an engine-quality call, made deliberately (PENDING nuance 44).
				{
					const sepX = this.x - other.x, sepY = this.y - other.y;
					const sepD = Math.sqrt(sepX * sepX + sepY * sepY) || 1;
					const overlap = this.size + other.size - sepD;
					if (overlap > 0) {
						const share = other.size / (this.size + other.size) * overlap / sepD;
						this.x += sepX * share;
						this.y += sepY * share;
					}
				}
				if (option.noDam || this.shield) { break; }
				this.hp -= tick.perTick(other.damage * TANK_BODY_DAMAGE * this.damageReduction());
				this.hit = tick.ticks(1.65);
				if (this.hp <= 0) {
					this.dead = tick.DEAD_DELAY;
					this.murder = ["players", other.id];
					this.destroy = tick.DES;
					this.room.awardXp(other, this.prize);
					if (this.coinReward) other.coins += this.coinReward;
					if (!other.bot) {
						other.mess.push('You killed ' + this.name);
						other.unlock('first_blood');
					}
				}
				break;
			case KIND.OBJECTS:
				// The 0.5 threshold is deliberately NOT tick.perTick()'d.
				// this.vec is a real-tick velocity produced by Physics.stepBody's accel/friction
				// recurrence, and that recurrence's fixed point (and any point along a friction-only
				// decay from it, since drag() is what keeps decay real-time-shaped) is itself
				// near-invariant to TICK_MS - verified numerically (<1.5% drift across TICK_MS
				// 16/25/33/40) rather than assumed. Wrapping this threshold in tick.perTick() would
				// make it track REF_TICK_MS instead and be the thing that's actually TICK_MS-sensitive.
				const len = (this.vec.length() < 0.5) ? 2.92538 : .73134;   // one-time-rescaled from 2 / .5 (stepBody factor)
				// tick.impulse(), not tick.perTick() - see the `back` comment above and PENDING #43.
				// (The 0.5 threshold above this.vec.length() is a separate, correctly-unwrapped read
				// of this.vec's own magnitude - untouched.)
				this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.impulse(len), tick.impulse(len))));
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
					Bull.push = this.necro.push;
					this.room.createBullet(Bull, this);
					return;
				}
				if (this.shield) { return; }
				this.hp -= tick.perTick(other.damage * this.damageReduction());
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
				// The one consumer of TanksConfig.js's `weight` column, which is diep's own
				// Knockbackfactor table (grid squares per loop of contact) times 5.25. The `/ 3 * 1.6`
				// here is the rest of that conversion: x 0.53333 turns the column into an impulse of
				// `gu x 2.8`, the same form `back` takes, and a one-shot impulse on tank velocity
				// displaces v0 x F/(1-F) = 10 x v0 units at the tank F = 10/11, so the round trip is
				// `gu x 5.25 x 0.53333 x 10 / 28 = gu`. Edit either factor and the whole column has to
				// be recomputed with it.
				// tick.impulse(), not tick.perTick() - this.vec routes through Physics.stepBody.
				this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.impulse(other.weight / 3 * 1.6), tick.impulse(other.weight / 3 * 1.6))));
				if (this.shield) { return; }
				// `pene` no longer multiplies damage here (PENDING #18): entities/Bullet.js's own
				// `pene -= tick.perTick(other.damage)` already makes a tougher bullet survive more
				// ticks of contact, which is where its total damage scaling with pene is supposed to
				// come from. Multiplying this per-tick hit by pene again double-counted it - low-pene
				// spam classes sat at the `max(1, pene/5)` floor (43 bullets to kill a fresh tank) while
				// a maxed-Pene Destroyer got both the floor-busting multiplier and the longest contact,
				// one-shotting instead. Removing it also retires the base-drone-pene substitution this
				// line used to need: there's no multiplier left for a drone's 2000-point health pool to
				// blow up (entities/Objects.js still needs its own, unrelated substitution at its own
				// shape-damage site).
				this.hp -= tick.perTick(other.damage * this.damageReduction());
				this.hit = tick.ticks(1.65);
				if (this.hp <= 0) { this.dead = tick.DEAD_DELAY; this.murder = ["players", other.origin]; this.destroy = tick.DES; }
				break;
			case KIND.WALL: {
				// Solid, no body damage (diep_wiki, PENDING #26): friction while grinding along it,
				// bounce on a fast impact, no hp -= anywhere in this arm - the one respect in which
				// this differs from every other case above. Wall never moves, so unlike KIND.PLAYER's
				// overlap split above the tank absorbs the full positional overlap, not a share of it.
				const sepX = this.x - other.x, sepY = this.y - other.y;
				const sepD = Math.sqrt(sepX * sepX + sepY * sepY) || 1;
				const nx = sepX / sepD, ny = sepY / sepD;
				const vn = this.vec.x * nx + this.vec.y * ny;
				const tx = this.vec.x - nx * vn, ty = this.vec.y - ny * vn;
				// WALL_BOUNCE is dimensionless and applied directly to this live vn read - unlike
				// every knockback above it is not a fresh REF_TICK_MS-denominated magnitude, so it
				// needs no tick.impulse()/tick.perTick() wrapping (PENDING nuance 39).
				const newVn = (vn < 0) ? -vn * WALL_BOUNCE : vn;
				this.vec.x = nx * newVn + tx * WALL_FRICTION;
				this.vec.y = ny * newVn + ty * WALL_FRICTION;
				const overlap = this.size + other.size - sepD;
				if (overlap > 0) {
					this.x += nx * overlap;
					this.y += ny * overlap;
				}
				break;
			}
		}
		if (this.alpha < 1 && !this.dev.invisible) {
			this.alpha = Math.min(1, this.alpha + (oldHp - this.hp) / this.maxHp * 5)
		}
		// Who most recently landed a hit - inert for every ordinary Player, the one consumer
		// being a Dominator's own update() (lib/gameAI.js, PENDING #27), which drops a target
		// that has stopped shooting back rather than holding it forever. `other.origin` for a
		// bullet, `other.id` for a body ram - both are `{oId}`-shaped id descriptors.
		if (oldHp > this.hp) {
			this.lastAttacker = (other.kind === KIND.BULLET) ? other.origin : other.id;
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
			// Hyper-regen gate: any HP loss resets the no-damage clock. Capped at the threshold
			// rather than left to grow unbounded over a long AFK stretch. One tick of slop by
			// construction (this compares against the value stored at the END of last tick's pass,
			// i.e. before whatever happened to hp since) - the same shape the old hpregan[0]
			// baseline used, harmless against a 750-tick threshold.
			if (this.hp < this.lastHp) {
				this.noDamageTicks = 0;
			} else {
				this.noDamageTicks = Math.min(this.noDamageTicks + 1, HYPER_REGEN_DELAY);
			}
			if (this.hp < this.maxHp) {
				const hps = (this.noDamageTicks >= HYPER_REGEN_DELAY)
					// Point-independent (see HYPER_REGEN_RATE's comment above) - /25 converts diep's
					// published per-SECOND rate to per-REFERENCE-tick, then tick.perTick() below
					// converts that to the live tick, same two-step shape the linear branch uses.
					? this.maxHp * HYPER_REGEN_RATE / 25
					// diep_wiki/Stats.txt: HPS = MaxHp x (0.03 + 0.12 x Regen Stat) / 30, per SECOND;
					// /25 is the same per-reference-tick conversion as the hyper branch above.
					: this.maxHp * (0.03 + 0.12 * this.up.HpRegan) / 30 / 25;
				this.hp += tick.perTick(hps);
				this.hp = Math.min(this.maxHp, this.hp);
			} else {
				this.hp = this.maxHp;
			}
			this.lastHp = this.hp;
		}
		///
		if (CLASS[this.class].alpha) {
			// this.room.rules.invisFloor (PENDING #28) - 0 everywhere but Tag, where diep_wiki
			// forbids a stealth class from ever fully vanishing so a win condition can't stall.
			this.alpha = Math.max(this.room.rules.invisFloor, this.alpha - tick.perTick(CLASS[this.class].alpha));
		} else if (!this.dev.invisible) { this.alpha = 1 }
		this.motion();
		if (this.inputs.c) {
			if (!this.spinning) {
				this.spinning = 1;
				this.spinDir = this.dir;
			}
			this.spinDir += tick.perTick(SPIN_RATE);
			this.dir = this.spinDir;
		} else if (this.spinning) {
			// Release leaves the tank facing where the spin left it; the next mousemove takes over.
			this.spinning = 0;
		}
		this.shoot();
		///
		// Sandbox-only practice key ('k') - hold to climb one level at a time rather than
		// snapping straight to the cap (diep's own hold-to-repeat convention). Setting `xp` to
		// exactly this level's threshold feeds the ordinary level-up check right below, so a
		// held 'k' never grants more than one level per SANDBOX_LEVELUP_TICKS interval.
		if (this.id.GM === 'sandbox' && this.inputs.k && this.level < this.XPLVL.length) {
			this.levelUpHold = (this.levelUpHold || 0) + 1;
			if (this.levelUpHold >= SANDBOX_LEVELUP_TICKS) {
				this.levelUpHold = 0;
				this.xp = this.XPLVL[this.level];
			}
		} else {
			this.levelUpHold = 0;
		}
		///
		if (this.xp >= this.XPLVL[this.level]) {
			// No takeback here any more (PENDING #30). The two `stillLvl++`s that used to sit at
			// levels 18 and 27 were how a 1-point-per-level grant was clawed back down to a
			// 28-point budget; the budget is a schedule now (pointsAtLevel), so a level-up only
			// ever levels you up.
			// diep's own +2 HP/level (PENDING #17, plan.md step 4) - not a rescale of the old 3.
			// A fresh spawn is `this.level` 0 (diep's level 1, MH0 = 50 already), so this fires once
			// per level-UP thereafter and lands on diep's 138 at the level-45 cap (50 + 44*2).
			this.hp += 2;
			this.maxHp += 2;
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
		// diep fixes a tank at Z = 2 x 1.01^(lvl-1) gu DIAMETER with its levels 1-based; ours are
		// 0-based and `size` is a radius, so at 1 gu = 28 units that is exactly 28 x 1.01^level.
		// Continuous, not floored - `size` is a float32 on the wire and every consumer (collision
		// radii, render's size/CONST.SIZE ratio) is fractional already.
		this.size = 28 * Math.pow(1.01, this.level) + this.dev.size;
		// FOV: diep is 1.39x wider than us at level 1 and grows
		// multiplicatively at half the tank's own growth rate, not the old
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
		if (this.class === 'Rocket' && this.upNb[0] === MAX_PER_STAT && this.upNb[1] === MAX_PER_STAT) {
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

// The auto-turret aim divisor, exposed so test/rooms.js's tick-scale suite drives the real
// constant rather than a copy of it - re-wrapping it in tick.lead() has to fail a test, not just
// contradict the comment above it. Same idea as entities/Bullet.js's estimateCrossTicks export.
Player.AUTOTURRET_LEAD = AUTOTURRET_LEAD;

// The upgrade economy (PENDING #30), exposed so rooms/Room.js's getUi() sends the client the same
// "points available" figure upgrade() will actually honour, and so test/rooms.js drives the real
// schedule rather than a copy of it.
Player.MAX_PER_STAT = MAX_PER_STAT;
Player.LEVEL_CAP = LEVEL_CAP;
Player.pointsAtLevel = pointsAtLevel;

// Regen (PENDING #17), exposed for the same reason: test/rooms.js's tick-scale suite drives the
// real hyper-regen threshold/rate rather than a restated copy.
Player.HYPER_REGEN_DELAY = HYPER_REGEN_DELAY;
Player.HYPER_REGEN_RATE = HYPER_REGEN_RATE;

module.exports = Player;
