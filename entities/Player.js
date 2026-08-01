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
const { TANK_TANK_MULT, TANK_SHAPE_MULT, LETHAL_EPS } = require('../lib/damage.js');

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

// Wall contact physics (plan.md Step 12) - see lib/constants.js for what these mean and the diep
// citation behind them. WALL_TANK_KEEP_SPEED is dimensionless, applied directly to a live
// this.vec read; WALL_PUSH_OUT is a fresh per-tick-of-contact magnitude, so it goes through
// tick.impulse() at its own call site below, not here (see the KIND.WALL collision arm below).
const WALL_TANK_KEEP_SPEED = require('../lib/constants.js').WALL_TANK_KEEP_SPEED;
const WALL_PUSH_OUT = require('../lib/constants.js').WALL_PUSH_OUT;

// diep's maintainVelocity() factor, already folded into TanksConfig.js's `speed` column - dividing
// it back out recovers diep's own raw `bulletAccel`, which is what shoot()'s muzzle-kick formulas
// below are written against. See lib/constants.js and that site.
const BULLET_MAINTAIN = require('../lib/constants.js').BULLET_MAINTAIN;

// Idle spin rate, per reference tick: an auto-turret with nothing to shoot at (shoot()), and the
// `c` auto-spin toggle (update()). One constant, because they are meant to look like the same
// motion - PENDING #21 retunes both together or neither.
const SPIN_RATE = 0.04;

/*
	Regen, two regimes (PENDING #17/#17's HYPER_REGEN_RATE, plan.md step 4): diep_wiki/Stats.txt's
	linear rate below the hyper-regen threshold, hyper regen ADDED on top of it above the threshold
	- not a replacement rate. Both terms are read directly in update() - no accumulator, so no
	lib/tick.js "quadratic" category is needed here either; each is a genuine per-reference-tick
	rate, tick.perTick()'d like any other.

	diepcustom/src/Entity/Live.ts:130-135:
		this.healthData.health += this.regenPerTick;                          // linear, always
		if (this.game.tick - this.lastDamageTick >= 750)                      // 750 ticks = 30s
			this.healthData.health += this.healthData.values.maxHealth / 250; // + 0.4%/tick = 10%/s
	Corroborated verbatim by diepindepth/extras/stats.md: "'Hyper' regen ... regenerating at 10% of
	health/sec (stacks with base)". HYPER_REGEN_DELAY (750 reference ticks = 30s) is unchanged from
	before this step; only the hyper term's SHAPE changed, from a flat point-independent replacement
	rate (previously least-squares-fit against diep_wiki's own, differently-captioned time-to-heal
	table, since that table turned out to measure a post-ram partial refill, not a 0%-to-full one -
	see PENDING #17's SHIPPED note for that derivation) to diep's own additive maxHp/250 per
	reference tick, which is point-independent for the same reason the old fit was: diep_wiki/
	Stats.txt says Shapes/Bullets have no slow regen of their own but DO hyper regen, so a Regen stat
	(which they don't have) cannot gate it.
*/
const HYPER_REGEN_DELAY = tick.ticks(750);
const HYPER_REGEN_RATE = 1 / 250;   // diep's own maxHp/250 per REFERENCE tick (Live.ts:134) = 10%/s

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
	'pre launch', 'testbed', 'bigView', 'shapes', 'shape1', 'shape2', 'Summoner',
	// plan.md X1's four new bosses - same reasoning as Summoner just above.
	'Guardian', 'Defender', 'Fallen Overlord', 'Fallen Booster'
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
		this.guardSize = 25;
		this.alpha = 1;
		this.screen = 1280;
		this.level = 0;
		this.stillLvl = 0;
		this.droneCount = 0;
		// diep's own raw damagePerTick, `bodyDamagePoints + 5` at 0 points (TankBody.ts:99,253,
		// plan.md chunk 1 D1) - the tank-body-ram axis, not the bullet-damage axis TanksConfig.js's
		// `can.damage` carries; the two happen to share diep's raw scale now (D1/D5) but are
		// otherwise independent numbers.
		this.damage = 5;
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
				this.alpha += Math.min(1, tick.perTick(CLASS[this.class].stealth.moving));
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
						this.alpha += Math.min(1, tick.perTick(CLASS[this.class].stealth.shooting));
					}
					///
					const dir = can.autoDir ? autoDir : this.dir + can.offdir;
					const offx = can.offx * ra;
					// No .93 fudge (plan.md B1) - diep spawns at the barrel's FULL length
					// (`x + cos(angle) x barrel.size + ...`, Bullet.ts:100); the old .93 put a
					// bullet 7% inside its own drawn muzzle at level 0, growing with level.
					const len = can.canonLength * ra;
					const offlen = Math.hypot(len, offx);
					const offdir = Math.atan2(offx, len);
					// `distance` (plan.md T5) pushes the barrel's MOUNT point out from the hull,
					// along the barrel's fixed resting angle (this.dir + can.offdir) - NOT the
					// live aim `dir`, which for an autoDir cannon would otherwise drag the whole
					// mount around the hull's edge as it tracks a target instead of pivoting in
					// place. This is what lets an auto-turret ring (Auto 3/5, plan.md T6) sit at
					// fixed sockets around the body while each barrel independently aims. 0 for
					// every ordinary barrel (origin stays the hull center).
					const mountDir = this.dir + can.offdir;
					const originX = this.x + Math.cos(mountDir) * (can.distance || 0) * ra;
					const originY = this.y + Math.sin(mountDir) * (can.distance || 0) * ra;
					const x = originX + Math.cos(dir + offdir) * (offlen)//-can.size*ra);
					const y = originY + Math.sin(dir + offdir) * (offlen)//-can.size*ra);
					const speed = this.up.BSpeed * can.speed;
					/*
						Muzzle kick: diep's own baseSpeed, a one-shot impulse the bullet starts ABOVE
						its cruise thrust and decays down to (Bullet.ts:89's
						`baseAccel + 30 - rand*scatterRate` du/tick, our units `bulletAccel + 16.8`,
						since 30 du/tick x 0.56 = 16.8). A drone (type 1/1.1) divides the WHOLE
						expression by 3 (Drone.ts:71 - it launches slower than it cruises, unlike an
						ordinary bullet). A trap (type 2) instead halves the accel term before the
						flat +16.8, with
						the jitter term left un-halved (Trap.ts:40's own
						`barrel.bulletAccel/2 + 30 - rand*scatterRate`) - and, unlike a bullet or
						drone, never becomes a maintained cruise thrust at all (entities/Bullet.js's
						motion tail skips the add for type 2; `speed` is stored only so this formula
						has something to read). `scatterRate` is back-derived from `can.rand`
						(rand = 0.174533 x scatterRate, plan.md Step 8) rather than stored a second
						time. (plan.md Step 9.)

						`bulletAccel`, NOT `speed`, is what diep's three formulas are written against,
						and conflating the two was worth a factor of TEN on the accel term:
						TanksConfig.js's `speed` column is diep's `bulletAccel` with maintainVelocity's
						own 0.1 already folded in (`20 du/tick x 0.56 x 0.1 = 1.12`, that file's stated
						identity), so it is a cruise THRUST and not a speed at all. A Basic launched at
						`1.12 + 16.8` = 17.92 units/ref-tick against diep's own `(20 + 30) x 0.56` = 28,
						a 36% shortfall on every projectile's launch - and, together with the cruise
						shortfall lib/constants.js's BULLET_CRUISE_ORDER fixes, the reason a Basic could
						outrun its own shot here and cannot in diep. BULLET_MAINTAIN (lib/constants.js)
						is that folded-in 0.1, so dividing by it recovers diep's raw figure.
					*/
					const bulletAccel = speed / BULLET_MAINTAIN;
					const scatterRate = can.rand / 0.174533;
					const jitter = Math.random() * scatterRate * 0.56;
					const muzzleKick = (can.type === 2) ? (bulletAccel / 2 + 16.8 - jitter)
						: (can.type === 1 || can.type === 1.1 || can.type === 1.5) ? (bulletAccel + 16.8 - jitter) / 3
							: (bulletAccel + 16.8 - jitter);
					const Bull = new Bullet(this.id, x, y, dir + Math.random() * can.rand - can.rand / 2, speed, muzzleKick, this.room);
					Bull.type = (can.type ? can.type : 0);
					Bull.class = this.class;
					Bull.pene = this.up.BPene * can.pene;
					// A Skimmer (type 4)/Minion (type 1.5)'s own sub-projectiles, baked at THIS
					// spawn from the owner's current stats (plan.md B3) - the same "read once at
					// fire time, not live thereafter" choice this cannon's own damage/pene/speed
					// above already make, except for `reloadRef`, which entities/Bullet.js's case
					// 4/1.5 deliberately reads live off `play.up.Reload` every sub-shot instead
					// (diepcustom's own barrel.reload multiplies the OWNER's live reloadTime, not a
					// value frozen at the parent's own launch).
					if (can.sub) { Bull.sub = { reloadRef: can.sub.reloadRef, rand: can.sub.rand, damage: this.up.BDamage * can.sub.damage, pene: this.up.BPene * can.sub.pene, speed: this.up.BSpeed * can.sub.speed, size: can.sub.size * ra, life: can.sub.life, weight: can.sub.weight, push: can.sub.push }; }
					if (can.weapon) { Bull.weapon = { reloadRef: can.weapon.reloadRef, rand: can.weapon.rand, damage: this.up.BDamage * can.weapon.damage, pene: this.up.BPene * can.weapon.pene, speed: this.up.BSpeed * can.weapon.speed, size: can.weapon.size * ra, life: can.weapon.life, weight: can.weapon.weight, push: can.weapon.push }; }
					// diep's own default lifeLength 1 x 75 (plan.md Step 9) - every real cannon now
					// sets its own `life` explicitly, so this fallback should never actually fire.
					// -1 is the "permanent drone" sentinel (Bullet.js checks it directly) and must
					// never go through tick.ticks(), which would turn it into a 1-real-tick lifetime
					// instead.
					Bull.life = (can.life === -1) ? -1 : tick.ticks(can.life ? can.life : 75);
					// A trap's arming window (diep's Trap.ts: `life >> 3` real ticks, computed here
					// once life is known in real-tick units - see entities/Bullet.js's constructor/
					// collision() for what it does). Left at its constructor default (0, inert/never
					// read) for every other type.
					if (Bull.type === 2) { Bull.armTicks = Bull.life >> 3; }
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
					// Only read for type 0/2 (bullet/trap) at the receiving end - a drone's pushFactor
					// is diep's own flat 4, not scaled by the shooter's Bullet Damage points (plan.md D7).
					Bull.bdPoints = this.upNb[4];
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
				// Per-tank stat caps (plan.md P3) - Smasher/Landmine/Spike have no barrels at
				// all (0-capped Reload/BSpeed/BPene/BDamage) and a raised Body Damage/Health
				// cap instead; Auto Smasher keeps every stat since its embedded turret fires
				// real bullets. `statMax` is an 8-length array in `this.up`'s own index order;
				// absent on every other class, which keeps the old global MAX_PER_STAT.
				if (this.upNb[data] >= (CLASS[this.class].statMax ? CLASS[this.class].statMax[data] : MAX_PER_STAT)) {
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
						BodyDam is diep's own flat per-point slope too: `this.damage`'s base (5) and step
						(+1) are `bodyDamagePoints + 5` read directly (TankBody.ts:99,253, plan.md chunk
						1 D1), not a span to rescale - see the constructor's own comment.
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
						case "BodyDam": this.damage += 1; break;   // diep's own flat +1/point off the 5 base (TankBody.ts:253's `bodyDamagePoints + 5`), not a 0.2x-of-base slope
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
			const oldClass = this.class;
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
			this.applyClassSwitchStats(oldClass);
			// classLvl counts evolutions, one per CLASS_TREE tier (0..3) - reaching 3 means a
			// tier 4 (final) class.
			if (this.classLvl >= 3) { this.unlock('scary_tank'); }
		} else {
			return;
		}
	}
	/*
		Shared by upClass()/cycleClass() (plan.md P3/T4): a per-tank flat body-damage bonus
		(Spike's +2, `TankDefinitions.json`'s explicit `bodyDamage` field) is folded into the
		running `this.damage` total rather than read fresh each tick, so switching class has to
		remove the OLD class's bonus before adding the NEW one's - straight addition/subtraction,
		since it's a flat term. Per-tank stat caps (Smasher-line's 0-capped barrel stats) also
		only ever get narrower on a switch, never wider - points already spent above the new
		cap are lost, not refunded (diep's own framing: those stats simply become unspendable),
		so this clamps `upNb`/`up` down to the new class's `statMax` using the exact inverse of
		upgrade()'s own per-stat step.
	*/
	applyClassSwitchStats(oldClass) {
		this.damage += (CLASS[this.class].bodyDamage || 0) - (CLASS[oldClass].bodyDamage || 0);
		if (!CLASS[this.class].statMax) { return; }
		let idx = -1;
		for (const key in this.up) {
			idx++;
			const cap = CLASS[this.class].statMax[idx];
			while (this.upNb[idx] > cap) {
				switch (key) {
					case "HpRegan": this.up[key] -= 1; break;
					case "Reload": this.up[key] /= 0.914; break;
					case "BSpeed": this.up[key] -= 0.15; break;
					case "BDamage": this.up[key] -= 0.4285714; break;
					case "BPene": this.up[key] -= 0.75; break;
					case "MSpeed": this.up[key] -= 1; break;
					case "HpUp": this.maxHp -= 20; this.hp *= this.maxHp / (this.maxHp + 20); break;
					case "BodyDam": this.damage -= 1; break;
				}
				// Lost, not refunded (plan.md P3) - `stillLvl` (points spent) is untouched, so
				// there is no free point to respend elsewhere; the stat just becomes
				// unspendable, diep's own framing for a class with a lower cap.
				this.upNb[idx]--;
			}
		}
	}
	/*
		Sandbox-only cheat ('\', PENDING "Sandbox gaps") - jumps straight to a class with none of
		upClass()'s tree/level gating, so a human can preview any tank regardless of level. Redoes
		the same class-dependent resets upClass() does (DETEC/droneCount/necro/shootTimer) but
		does not touch classLvl or unlock('scary_tank') - this isn't a real evolution.
	*/
	cycleClass() {
		const oldClass = this.class;
		const i = CYCLABLE_CLASSES.indexOf(this.class);
		this.class = CYCLABLE_CLASSES[(i + 1) % CYCLABLE_CLASSES.length];
		if (!this.bot && this.DETEC && !CLASS[this.class].DETEC) { this.DETEC = null; }
		this.droneCount = 0;
		this.necro = CLASS[this.class].necro;
		this.shootTimer = new Array(CLASS[this.class].cannons.length).fill(0);
		this.applyClassSwitchStats(oldClass);
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
				// A Dominator receives zero knockback and no positional overlap push - diep's own
				// `absorbtionFactor = 0` (Object.ts:280, kb = absorbtionFactor * pushFactor) is what
				// makes it immovable, so the fix belongs at the source of any push rather than an
				// after-the-fact position snap (lib/gameAI.js's dominatorUpdate() used to re-set
				// x/y/vec to the spawn point every tick; this replaces that, plan.md Step 11). Damage
				// below is unaffected - a Dominator takes damage exactly like any other Player.
				if (!this.dominator) {
					// 4.48 = diep's "All Tank Bodies" knockback, 1.6 gu per loop of contact, through
					// the same `gu x 2.8` impulse identity TanksConfig.js's `weight` and `back` columns
					// use: a one-shot impulse on tank velocity displaces v0 x F/(1-F) = 10 x v0 units at
					// the tank F = 10/11, and 1.6 x 2.8 x 10 / 28 = 1.6 gu.
					// tick.impulse(), not tick.perTick() - this.vec routes through Physics.stepBody. The
					// hp drain below stays perTick(): it is genuine per-tick-of-contact damage, not a
					// one-shot impulse.
					this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.impulse(4.48), tick.impulse(4.48))));
					// Positional overlap resolution, on top of the velocity impulse rather than instead
					// of it. The impulse alone cannot separate two tanks inside a normal contact window -
					// it lands in `vec` and is then decayed by stepBody over many ticks, during which the
					// pair is still overlapping - so two tanks visibly interpenetrate. This pushes them
					// apart along their separation axis by the overlap, split by size so the bigger tank
					// moves less. rooms/Room.js calls collision() on BOTH sides of a pair, so each body
					// moves only its own share and the two shares sum to the whole overlap. The calls are
					// sequential, so the second sees the first's move and this behaves as a relaxation
					// rather than a snap - a deep overlap clears over about two ticks. It runs before the
					// noDam break because teammates take up space too. No diep reference behind it,
					// unlike everything around it - an engine-quality call, made deliberately (PENDING
					// nuance 44).
					const sepX = this.x - other.x, sepY = this.y - other.y;
					const sepD = Math.sqrt(sepX * sepX + sepY * sepY) || 1;
					// `guardSize` (plan.md T6), not `size` - a Smasher/Landmine/Spike-line
					// tank's spinning guard is a real physical boundary, not just a bigger
					// hitbox for damage: it holds the same overlap-resolution share diep's
					// separate GuardObject entity would.
					const mySize = this.guardSize || this.size, otherSize = other.guardSize || other.size;
					const overlap = mySize + otherSize - sepD;
					if (overlap > 0) {
						const share = otherSize / (mySize + otherSize) * overlap / sepD;
						this.x += sepX * share;
						this.y += sepY * share;
					}
				}
				if (option.noDam || this.shield) { break; }
				// Diep's damage-multiplier table (lib/damage.js, plan.md step 5): common(tank,tank) = 6.
				// `damageReduction()` is gone - diep's own binary equivalent (0 for the guards above,
				// 1 otherwise) is already what those early returns/breaks express. `option.dmgScale` is
				// rooms/Room.js's proration factor for this tick (1 unless either side would otherwise
				// die mid-tick, PENDING #18/plan.md step 5 part 4) - defaulted here so every direct
				// collision() call in test/rooms.js that never sets it keeps behaving as a full-tick hit.
				this.hp -= tick.perTick(other.damage * TANK_TANK_MULT * (option.dmgScale ?? 1));
				this.hit = tick.ticks(1.65);
				// LETHAL_EPS, not 0 (lib/damage.js) - a prorated killing blow lands an ulp either side
				// of exactly this.hp, and an ulp short used to leave the tank alive at ~1e-16.
				if (this.hp <= LETHAL_EPS) {
					this.hp = 0;
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
				// common(tank,shape) = 4 (lib/damage.js, plan.md chunk 1 D2) - `other.damage` (the
				// shape's) is diep's raw damagePerTick now, with no vs-tank x4 baked in any more, so
				// this needs the same explicit multiplier the KIND.PLAYER arm above applies.
				this.hp -= tick.perTick(other.damage * TANK_SHAPE_MULT * (option.dmgScale ?? 1));
				this.hit = tick.ticks(1.65);
				if (this.hp <= LETHAL_EPS) {
					this.hp = 0;
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
				// A Dominator receives zero knockback here too (diep's `absorbtionFactor = 0`,
				// plan.md D7) - this used to only be guarded on the KIND.PLAYER body-contact arm
				// above, so a Dominator was still shoved by ordinary bullets. Damage below is
				// unaffected, exactly like the KIND.PLAYER guard.
				if (!this.dominator) {
					// The one consumer of TanksConfig.js's `weight` column, which is diep's own
					// Knockbackfactor table (grid squares per loop of contact) times 5.25. The `/ 3 *
					// 1.6` here is the rest of that conversion: x 0.53333 turns the column into an
					// impulse of `gu x 2.8`, the same form `back` takes, and a one-shot impulse on tank
					// velocity displaces v0 x F/(1-F) = 10 x v0 units at the tank F = 10/11, so the
					// round trip is `gu x 5.25 x 0.53333 x 10 / 28 = gu`.
					// A true bullet/trap's push also scales with the shooter's Bullet Damage points
					// now (diepcustom's Bullet.ts:86, plan.md D7): `weight` was authored at bd = 1
					// (0.16 x (7/3 + 1) = 0.53333, the constant above), so scaling around that same
					// anchor reproduces the table exactly at bd = 1 and diep's own 4x span (0.7x at
					// 0 points, 2.8x at 7) either side of it. A drone (type >= 1) keeps the flat
					// per-cannon `weight` value untouched - diepcustom's own Drone.ts overrides
					// pushFactor to a flat 4 regardless of the shooter's points.
					const pushBase = (other.type === 0 || other.type === 2)
						? other.weight * 0.16 * (7 / 3 + other.bdPoints)
						: other.weight / 3 * 1.6;
					// tick.impulse(), not tick.perTick() - this.vec routes through Physics.stepBody.
					this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.impulse(pushBase), tick.impulse(pushBase))));
				}
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
				// common(bullet,tank) = 1 (lib/damage.js) - `other.damage` here is the BULLET's own
				// damage (can.damage x up.BDamage), not `this.damage`, and never carried a
				// TANK_BODY_DAMAGE/PROJECTILE_BODY_DAMAGE-style multiplier even before
				// `damageReduction()`'s removal, so this site is unchanged beyond that removal.
				this.hp -= tick.perTick(other.damage * (option.dmgScale ?? 1));
				this.hit = tick.ticks(1.65);
				if (this.hp <= LETHAL_EPS) { this.hp = 0; this.dead = tick.DEAD_DELAY; this.murder = ["players", other.origin]; this.destroy = tick.DES; }
				break;
			case KIND.WALL: {
				/*
					Rectangular wall (plan.md Step 12) - circle-vs-AABB, diepcustom's own
					closest-point "constrain" test (Object.ts:191-192), the same test either side of
					the pair uses. The broad-phase gate that got this call here only bounds the wall
					by its half-diagonal (Wall.js's own `.size`) - a merged wall chunk can run for
					several grid cells, so its true edge can sit far from its centre - so this arm has
					to re-check real contact itself before applying anything; a false-positive
					broad-phase candidate must do nothing.
				*/
				const hw = other.w / 2, hh = other.h / 2;
				const cx = Math.max(other.x - hw, Math.min(this.x, other.x + hw));
				const cy = Math.max(other.y - hh, Math.min(this.y, other.y + hh));
				const dx = this.x - cx, dy = this.y - cy;
				if (dx * dx + dy * dy > this.size * this.size) { break; }
				// No body damage, same as before (diep_wiki, PENDING #26) - no hp -= anywhere in
				// this arm. Object.ts:303: a tank sheds to a flat fraction of its own speed on every
				// tick of contact - dimensionless, applied directly to the live vec read.
				this.vec.x *= WALL_TANK_KEEP_SPEED;
				this.vec.y *= WALL_TANK_KEEP_SPEED;
				// ...and gets shoved out along whichever axis the centre offset is more aligned
				// with (Object.ts:307-326's relA/relB comparison - axis-aligned rather than
				// diagonal, since a Maze wall is never rotated here). tick.impulse(), not
				// tick.perTick() - this.vec routes through Physics.stepBody, see the `back` comment
				// above.
				const ox = this.x - other.x, oy = this.y - other.y;
				const push = tick.impulse(WALL_PUSH_OUT);
				if (Math.abs(ox) / hw >= Math.abs(oy) / hh) {
					this.vec.x += (Math.sign(ox) || 1) * push;
				} else {
					this.vec.y += (Math.sign(oy) || 1) * push;
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
				// diep_wiki/Stats.txt: HPS = MaxHp x (0.03 + 0.12 x Regen Stat) / 30, per SECOND; /25
				// converts that to per-REFERENCE-tick, then tick.perTick() below converts that to the
				// live tick - always on, regardless of the hyper-regen gate below.
				let hps = this.maxHp * (0.03 + 0.12 * this.up.HpRegan) / 30 / 25;
				// Hyper regen ADDS to the linear rate above, it does not replace it (diepcustom/src/
				// Entity/Live.ts:130-135, plan.md step 4) - HYPER_REGEN_RATE is already per-REFERENCE-
				// tick (1/250 = diep's maxHp/250 per tick), so no further /25 conversion belongs here.
				if (this.noDamageTicks >= HYPER_REGEN_DELAY) { hps += this.maxHp * HYPER_REGEN_RATE; }
				this.hp += tick.perTick(hps);
				this.hp = Math.min(this.maxHp, this.hp);
			} else {
				this.hp = this.maxHp;
			}
			this.lastHp = this.hp;
		}
		///
		// `stealth` (plan.md T3) replaces the old single `alpha` decay constant with diep's
		// three real, independently-valued rates (`invisibilityRate`/`visibilityRateMoving`/
		// `visibilityRateShooting`) - its mere presence on a class is the gate that used to be
		// `CLASS[this.class].alpha`'s truthiness, still checked here first and only here each
		// tick, so motion()/shoot() below can read `.stealth.moving`/`.stealth.shooting`
		// unguarded: a class switch can only ever be observed here, before either runs.
		if (CLASS[this.class].stealth) {
			// this.room.rules.invisFloor (PENDING #28) - 0 everywhere but Tag, where diep_wiki
			// forbids a stealth class from ever fully vanishing so a win condition can't stall.
			this.alpha = Math.max(this.room.rules.invisFloor, this.alpha - tick.perTick(CLASS[this.class].stealth.decay));
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
		// Guard shapes (Smasher/Landmine/Spike, plan.md T5/T6) - modelled as a single
		// enlarged collision circle rather than diep's separate `GuardObject` physics
		// entity (decided simplification, PENDING.md): `guardSize` is the biggest
		// `size x sizeRatio` among the class's guards, used wherever contact/overlap is
		// decided (rooms/Room.js's broad-phase gate, this.collision()'s KIND.PLAYER
		// overlap) so a spinning guard both deals and blocks contact out to its own edge,
		// not just the tank body inside it. Equal to `this.size` for every other class.
		this.guardSize = this.size;
		if (CLASS[this.class].guards) {
			for (const g of CLASS[this.class].guards) {
				this.guardSize = Math.max(this.guardSize, this.size * g.sizeRatio);
			}
		}
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
		if (this.class === 'Rocketeer' && this.upNb[0] === MAX_PER_STAT && this.upNb[1] === MAX_PER_STAT) {
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
