/*
	Player - the tank entity: motion, shooting, upgrades, class changes, collision.
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

// Auto-turret aim lead (shoot()): divisor in `other.vec * dis / AUTOTURRET_LEAD`, offsetting
// the aim point along a target's own velocity. A flat constant, not tick-scaled - lib/gameAI.js
// keeps an identical copy so bots and humans lead a moving target the same way.
const AUTOTURRET_LEAD = 15.84;

// Wall contact physics - see lib/constants.js. WALL_TANK_KEEP_SPEED is dimensionless, applied
// directly to a live this.vec read; WALL_PUSH_OUT is a fresh per-tick-of-contact magnitude,
// applied through tick.impulse() at its own call site (the KIND.WALL collision arm below).
const WALL_TANK_KEEP_SPEED = require('../lib/constants.js').WALL_TANK_KEEP_SPEED;
const WALL_PUSH_OUT = require('../lib/constants.js').WALL_PUSH_OUT;
const WALL_TANK_OVERLAP = require('../lib/constants.js').WALL_TANK_OVERLAP;

// Folded into TanksConfig.js's `speed` column - dividing it back out recovers the raw muzzle
// accel that shoot()'s muzzle-kick formulas below are written against.
const BULLET_MAINTAIN = require('../lib/constants.js').BULLET_MAINTAIN;

// Idle spin rate, per reference tick: an auto-turret with nothing to shoot at (shoot()), and the
// `c` auto-spin toggle (update()) share this one constant so they read as the same motion.
const SPIN_RATE = 0.04;

// Fraction of the ordinary tank-body knockback a team mate's body deals (KIND.PLAYER collision
// arm below): a team mate is a soft body - a small shove only, no positional separation - so a
// team can't stack through a chokepoint but also doesn't bounce off itself at full strength.
const TEAM_SOFT_PUSH = 0.2;

// Tank-body-vs-tank-body knockback, in gu per loop of contact (fed through the same impulse
// identity `weight`/`back` use, see the KIND.PLAYER arm below). Positional overlap resolution
// (further below) is what actually keeps two tanks from resting inside each other, independent
// of this value.
const BODY_KB_GU = 1.0;

// Flat per-hit invisibility reveal rate, applied at most once per tick regardless of how many
// hits land that tick - a single global constant, not a per-class rate like `stealth.decay/
// moving/shooting`.
const VISIBILITY_RATE_DAMAGE = 0.2;

/*
	Auto 3/Auto 5's turret ring.

	- RING_ROTATION is the rate the whole ring (an invisible parent every ring turret is mounted
	  to) spins at, independent of the tank's own facing - `this.ringDir` is that parent's
	  accumulated angle. A ring cannon's structural mount angle is `can.offdir + this.ringDir`,
	  not `this.dir + can.offdir` like an ordinary barrel - see shoot()'s `can.ring` branch below.
	- RING_ARC bounds a ring turret's own target filter to 90 degrees either side of its mount
	  angle, for both the auto-target scan and the owner's click-to-aim override.
*/
const RING_ROTATION = 0.01;
const RING_ARC = Math.PI / 2;
// Smallest signed angular difference, in [-PI, PI].
function angleDelta(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }

// Every live candidate a multi-target tank's auto-turret cannons may aim at this tick, flattened
// out of DETEC's per-kind `selectAll` buckets in the class's own `type` priority order. Each
// cannon then picks its own nearest entry out of this shared pool (autoTargetDir below), instead
// of every cannon on the tank sharing one tank-wide `DETEC.select`.
function autoTargetPool(play) {
	const out = [];
	const detec = play.DETEC;
	if (!detec || !detec.all) { return out; }
	for (const kind of detec.type) {
		const bucket = detec.selectAll[kind];
		if (!bucket) { continue; }
		for (let i = 0; i < bucket.length; i++) {
			const o = bucket[i];
			// Same liveness exclusions the single-select path (Detector.collision()) applies on
			// its own branch - the `all` branch does not filter these, so it is done here instead.
			if (o.destroy || o.dead || !o.alpha || o.closer) { continue; }
			out.push(o);
		}
	}
	return out;
}

// Nearest pool entry to a cannon's own mount point (mx,my), inside `arc` of `mountAngle` and
// inside `maxDis`. Returns a lead-corrected firing angle, or null if nothing qualifies. Measuring
// from the mount rather than the hull centre is what lets a multi-turret tank (a ring, or the
// Defender's three mounted turrets) split its fire across different targets - each socket sits
// somewhere different, so "closest to me" resolves differently per socket.
function autoTargetDir(pool, mx, my, mountAngle, arc, maxDis) {
	let bestD2 = Infinity, bestDir = null;
	const maxD2 = maxDis * maxDis;
	for (let i = 0; i < pool.length; i++) {
		const o = pool[i];
		const dx = o.x - mx, dy = o.y - my;
		const d2 = dx * dx + dy * dy;
		if (d2 > maxD2 || d2 >= bestD2) { continue; }
		const dis = Math.sqrt(d2);
		const vx = o.vec ? o.vec.x : 0, vy = o.vec ? o.vec.y : 0;
		const dir = Math.atan2(o.y + vy * dis / AUTOTURRET_LEAD - my, o.x + vx * dis / AUTOTURRET_LEAD - mx);
		if (Math.abs(angleDelta(dir, mountAngle)) > arc) { continue; }
		bestD2 = d2;
		bestDir = dir;
	}
	return bestDir;
}

// Which drone budget a cannon draws from. Only a class that declares `droneSplit` (Mothership)
// has two; every other drone class returns 0 and keeps a single pool, unchanged.
function droneGroupOf(can) { return (can.type === 1.1) ? 1 : 0; }

/*
	Regen, two regimes: a linear rate always applied, and hyper regen ADDED on top once
	noDamageTicks clears HYPER_REGEN_DELAY (750 reference ticks = 30s) - not a replacement rate.
	Both are genuine per-reference-tick rates, tick.perTick()'d like any other.
*/
const HYPER_REGEN_DELAY = tick.ticks(750);
const HYPER_REGEN_RATE = 1 / 250;   // maxHp/250 per reference tick = 10%/s

// Sandbox-only practice key ('k') - threshold on a per-tick hold counter: level 0 to the cap in
// well under 2s of holding.
const SANDBOX_LEVELUP_TICKS = tick.ticks(1);

/*
	The upgrade economy: 45 levels, 7 points per stat, 33 points over a life, one class tier
	every 15 levels. Points are a GRANT SCHEDULE, not a level count minus takebacks: one point per
	level up to GRANT_EVERY_LEVEL_TO, then one at LATE_GRANT_FROM and every LATE_GRANT_STEP
	levels after. pointsAtLevel() below is the whole rule; Room.js's getUi() reads it too so the
	client's "points available" counter can't drift from what upgrade() will actually allow.
*/
const MAX_PER_STAT = 7;
const GRANT_EVERY_LEVEL_TO = 28;  // 1 point per level up to and including this one
const LATE_GRANT_FROM = 30;       // then one here...
const LATE_GRANT_STEP = 3;        // ...and every third level after, to the cap
// Guard against a hand-set level (admin commands) exceeding the XP table's own length.
const LEVEL_CAP = 45;

// Sandbox-only cheat ('\') - a raw class preview, not an evolution, so it skips upClass()'s
// tree/level gating entirely. Dev/debug placeholders and bosses are excluded from the cycle; a
// scripted class (Arena Closer/Dominator) previewed this way only gets its stats/body/cannons,
// none of its AI behaviour.
const CYCLE_EXCLUDE = new Set([
	'pre launch', 'testbed', 'bigView', 'shapes', 'shape1', 'shape2', 'Summoner',
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
		// Base HP = 50 + 2 per level thereafter (see the level-up +2 below and HpUp's +20/pt in
		// upgrade()).
		this.maxHp = 50;
		// Ticks since the last HP loss - drives the hyper-regen threshold; see regenTick().
		this.noDamageTicks = 0;
		this.hp = this.maxHp;
		this.lastHp = this.hp;
		this.prize = 100;
		this.autoDir = 0;
		// The auto-turret ring's own slow, hull-independent rotation. Free-running for every
		// class, same as autoDir; only `can.ring` cannons ever read it.
		this.ringDir = 0;
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
		// Spawn protection: flashing + damage immunity until first move/shoot, or a hard cap of
		// 374 reference ticks (~15s).
		this.shield = tick.ticks(374);
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
		this.room = room;
		this.map = room.map;
		this.x = x;
		this.y = y;
		this.vec = new Vec(0, 0)
		this.dir = 0;
		this.canDir = [];
		this.timer = 0;
		// Predator zoom: `zooming`/`zoomX`/`zoomY` are the locked camera point while a zoomAbility
		// class holds right-click; see update()'s own site.
		this.zooming = 0;
		this.zoomX = 0;
		this.zoomY = 0;
		// H-key piloting: the Dominator/Mothership instance this tank is currently driving, or
		// null. `pilotedBy` is the reverse pointer (meaningful only on a Dominator/Mothership
		// instance): the human Player currently driving THIS one, or null.
		// `possessionStartTick`/`possessionWarned` are Mothership's own 5-minute clock - Dominator
		// possession has no timer.
		this.piloting = null;
		this.pilotedBy = null;
		this.possessionStartTick = -1;
		this.possessionWarned = false;
		this.size = 25;
		this.guardSize = 25;
		this.alpha = 1;
		this.screen = 1280;
		this.level = 0;
		this.stillLvl = 0;
		this.droneCount = 0;
		// Mothership's alternating drone control: 16 barrels split 8 controllable (type 1) + 8
		// not (type 1.1), each budgeted separately so the swarm split can't drift away from
		// 50/50 once saturated. Index 0 = controllable-capable types, index 1 = the rest.
		this.droneGroup = [0, 0];
		// Tank-body-ram damage axis, `bodyDamagePoints + 5` at 0 points - separate from the
		// bullet-damage axis TanksConfig.js's `can.damage` carries.
		this.damage = 5;
		// Multiplier on every knockback impulse this entity RECEIVES, 1 for an ordinary tank.
		// Dominators keep their own separate `!this.dominator` gate (0 knockback); a boss sets
		// this to 0.05 and the Mothership to 0.01 at their own spawn sites.
		this.absorb = 1;
		this.murder = -1;
		this.up = {
			"MSpeed": 0, //0
			"Reload": 1, //1
			"BSpeed": 1, //2
			"BPene": 1,  //3
			"BDamage": 1,//4
			"BodyDam": 1,//5
			"HpUp": 0,    //6
			"HpRegan": 0  //7, a point count (the Regen stat)
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
		// A mode's pre-match hold (rooms/Room.js's inputsFrozen()) suspends a real contender's own
		// input for the tick - a scripted entity (boss/Closer) never freezes. Friction/position
		// integration still runs below regardless, exactly as it does with no keys held.
		const frozen = !this.boss && !this.closer && this.room.inputsFrozen();
		if (!this.state.disconnect && !frozen) {
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
		// Wrapped to [0, 2*PI): the wire angle codec is an int16, and letting this grow
		// unbounded across a long session drifts the encoded phase away from the real one once
		// the raw radians exceed the codec's precision.
		this.ringDir = (this.ringDir + tick.perTick(RING_ROTATION)) % (Math.PI * 2);
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
				// Detector's ctor is (from,x,y,size,type,self,all).
				this.DETEC = new Detector(this, this.x, this.y, detec.size, detec.type, detec.self || 0, detec.all || 0)
				this.DETEC.team = this.team;
			} else {
				this.DETEC.x = this.x;
				this.DETEC.y = this.y;
			}
		}
		if (this.state.disconnect) {
			return;
		}
		// A mode's pre-match hold (rooms/Room.js's inputsFrozen()) stops every cannon, auto ones
		// included - nobody fires until the lobby screen actually lets the match start.
		if (!this.boss && !this.closer && this.room.inputsFrozen()) {
			return;
		}
		// Reveal-while-shooting: checked once every tick the fire input is held, regardless of
		// whether a bullet actually reloads/launches that tick.
		if (CLASS[this.class].stealth && this.alpha < 1 && !this.dev.invisible && (this.inputs.e || this.inputs.mouseL)) {
			this.alpha = Math.min(1, this.alpha + tick.perTick(CLASS[this.class].stealth.shooting));
		}
		// One scan per tick, shared by every autoDir cannon on this tank - empty for any class whose
		// DETEC isn't `all: 1` (those keep the legacy single-select path inside the loop below).
		const autoPool = autoTargetPool(this);
		for (let r = 0; r < CLASS[this.class].cannons.length; r++) {
			if (typeof this.shootTimer[r] === 'undefined') { this.shootTimer[r] = 0; }
			const can = CLASS[this.class].cannons[r];
			const reloadMax = tick.ticks(Math.round(can.reload * this.up.Reload));
			const reload = this.shootTimer[r];
			const maxD = CLASS[this.class].maxDrone;
			// Mothership's own per-group cap - every other drone class has no `droneSplit` and
			// keeps the single shared `droneCount` pool.
			const split = CLASS[this.class].droneSplit;
			const grp = split ? droneGroupOf(can) : 0;
			const groupCap = split ? Math.floor(maxD / 2) : maxD;
			let autoDir, shoot;
			const ra = this.size / 35;
			if (can.autoDir) {
				// A ring turret (Auto 3/5) aims off its OWN structural mount angle
				// (can.offdir + this.ringDir, independent of the hull's facing); an ordinary
				// mounted turret's socket is fixed to the hull (this.dir + can.offdir).
				const mountAngle = can.ring ? (can.offdir + this.ringDir) : (this.dir + can.offdir);
				// A ring turret is filtered to its own 90-degree targetFilter arc; a plain mounted
				// auto-turret (Auto Gunner/Trapper/Hover/Smasher, Defender's three) has none.
				const arc = can.ring ? RING_ARC : Math.PI;
				if (can.ring && this.inputs.mouseL && Math.abs(angleDelta(this.dir, mountAngle)) <= RING_ARC) {
					// Click-to-aim: while the owner holds fire, a ring turret that can reach the
					// mouse direction points there, overriding DETEC's target.
					autoDir = this.dir;
					this.canDir[r] = autoDir;
					shoot = 1;
				} else if (this.DETEC.all) {
					// Multi-target path: this turret picks its own nearest in-arc candidate out of
					// the pool, measured from its OWN mount point rather than the hull centre - so
					// different sockets on the same tank naturally resolve to different targets.
					const mx = this.x + Math.cos(mountAngle) * (can.distance || 0) * ra;
					const my = this.y + Math.sin(mountAngle) * (can.distance || 0) * ra;
					const dir = autoTargetDir(autoPool, mx, my, mountAngle, arc, CLASS[this.class].DETEC.maxDis);
					if (dir !== null) {
						autoDir = dir;
						this.canDir[r] = autoDir;
						shoot = 1;
					} else {
						this.canDir[r] = can.ring ? mountAngle : this.autoDir;
						shoot = 0;
					}
				} else if (this.DETEC.select) {
					// Legacy single-select path, for any autoDir class not opted into `all: 1`.
					this.DETEC.enabled = 0;
					const other = this.DETEC.select;
					const dis = Math.sqrt(Math.pow(this.x - other.x, 2) + Math.pow(this.y - other.y, 2));
					if (!other.destroy && other.alpha && dis <= CLASS[this.class].DETEC.maxDis) {
						const targetDir = Math.atan2(other.y + other.vec.y * dis / AUTOTURRET_LEAD - this.y, other.x + other.vec.x * dis / AUTOTURRET_LEAD - this.x);
						if (Math.abs(angleDelta(targetDir, mountAngle)) <= arc) {
							autoDir = targetDir;
							this.canDir[r] = autoDir;
							shoot = 1;
						} else {
							// Outside THIS turret's own arc - fall back to idle radial aim for this
							// cannon only, without resetting DETEC (another cannon may still be in-arc).
							this.canDir[r] = can.ring ? mountAngle : this.autoDir;
							shoot = 0;
						}
					} else {
						this.DETEC.reset();
						this.DETEC.enabled = 1;
						this.canDir[r] = can.ring ? mountAngle : this.autoDir;
						shoot = 0;
					}
				} else {
					this.canDir[r] = can.ring ? mountAngle : this.autoDir;
				}
			};
			if ((this.inputs.e || this.inputs.mouseL || can.auto)
				&& ((maxD && (can.life === -1 || can.droneCap))
					// `can.droneCap` opts a FINITE-life cannon into the same maxDrone accounting a
					// permanent (life -1) drone gets (Guardian's 24-cap spawner). Not just "drop the
					// life===-1 check": a class can mix a capped drone cannon with an ordinary
					// finite-life cannon that must NOT be gated by drone count - that cannon has no
					// `droneCap` and is correctly exempt below.
					? (split ? this.droneGroup[grp] < groupCap : this.droneCount < maxD)
					: true)
				&& ((can.autoShoot) ? shoot : true)) {
				if (this.shield) {
					this.shield = 0;
				}
				if (reload === Math.floor(can.offTime * reloadMax)) {
					
					const dir = can.autoDir ? autoDir : this.dir + can.offdir;
					const offx = can.offx * ra;
					// Position the projectile relative to the cannon itself rather than the tank
					// center. `offlen`/`offdir` describe the barrel tip in the cannon's local
					// coordinate space, letting side-mounted and angled barrels spawn correctly.
					const len = can.canonLength * ra;
					const offlen = Math.hypot(len, offx);
					const offdir = Math.atan2(offx, len);
					// Resolve the cannon's mount point. `distance` offsets a cannon away from the
					// tank center before applying the barrel-tip offset above. Ring cannons mount
					// relative to the rotating turret ring; all other cannons mount relative to
					// the tank hull.
					const mountDir = can.ring ? (can.offdir + this.ringDir) : (this.dir + can.offdir);
					const originX = this.x + Math.cos(mountDir) * (can.distance || 0) * ra;
					const originY = this.y + Math.sin(mountDir) * (can.distance || 0) * ra;
					const x = originX + Math.cos(dir + offdir) * offlen;
					const y = originY + Math.sin(dir + offdir) * offlen;
					const speed = this.up.BSpeed * can.speed;
					/*
						Muzzle kick: a one-shot impulse the bullet starts above its cruise thrust and
						decays down to. A drone (type 1/1.1) divides the whole expression by 3 - it
						launches slower than it cruises, unlike an ordinary bullet. A trap (type 2) halves
						the accel term before the flat +16.8, jitter left un-halved, and never becomes a
						maintained cruise thrust at all (the motion tail skips the add for type 2).
						`scatterRate` is back-derived from `can.rand`.

						`bulletAccel`, not `speed`, is what these formulas are written against:
						TanksConfig.js's `speed` column already has maintainVelocity's own factor folded
						in, so it is a cruise thrust, not a speed. BULLET_MAINTAIN is that folded-in
						factor, so dividing by it recovers the raw accel figure.
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
					// Optional per-cannon draw overrides, decoupling a bullet's SPRITE/COLOUR from its
					// behaviour `type` - diep's own barrels carry a per-bullet `sides`/`color` the same
					// way. Guardian and Summoner both spawn `type: 3.1` self-targeting drones (one shared
					// steering case in entities/Bullet.js), but their drones look nothing alike: a
					// Guardian drone is a small Crasher (drawType 6, a pink triangle) and a Summoner drone
					// is a beige Necromancer square (drawColor 9). undefined for every ordinary cannon, so
					// rooms/Room.js's bulletWireType()/bulletColor() fall back to the type/team derivation.
					Bull.drawType = can.drawType;
					Bull.drawColor = can.drawColor;
					Bull.pene = this.up.BPene * can.pene;
					// A Skimmer (type 4)/Minion (type 1.5)'s own sub-projectiles, baked at THIS spawn
					// from the owner's current stats - "read once at fire time" like this cannon's own
					// damage/pene/speed, except `reloadRef`, which Bullet.js's case 4/1.5 deliberately
					// reads live off the owner's Reload stat every sub-shot instead.
					if (can.sub) { Bull.sub = { reloadRef: can.sub.reloadRef, rand: can.sub.rand, damage: this.up.BDamage * can.sub.damage, pene: this.up.BPene * can.sub.pene, speed: this.up.BSpeed * can.sub.speed, size: can.sub.size * ra, life: can.sub.life, weight: can.sub.weight, push: can.sub.push }; }
					if (can.weapon) { Bull.weapon = { reloadRef: can.weapon.reloadRef, rand: can.weapon.rand, damage: this.up.BDamage * can.weapon.damage, pene: this.up.BPene * can.weapon.pene, speed: this.up.BSpeed * can.weapon.speed, size: can.weapon.size * ra, life: can.weapon.life, weight: can.weapon.weight, push: can.weapon.push }; }
					// Default lifeLength fallback (75) - every real cannon sets its own `life`
					// explicitly, so this should never actually fire. -1 is the "permanent drone"
					// sentinel and must never go through tick.ticks(), which would turn it into a
					// 1-real-tick lifetime instead.
					Bull.life = (can.life === -1) ? -1 : tick.ticks(can.life ? can.life : 75);
					// A trap's arming window (diep's Trap.ts: `life >> 3` real ticks, computed here
					// once life is known in real-tick units - see entities/Bullet.js's constructor/
					// collision() for what it does). Left at its constructor default (0, inert/never
					// read) for every other type.
					if (Bull.type === 2) { Bull.armTicks = Bull.life >> 3; }
					Bull.damage = this.up.BDamage * can.damage;
					// Bull.size = can.size x ra for every class, boss/Closer included - `ra` is the
					// same sprite scale render.js draws a barrel at, so a bullet now always matches
					// the barrel it left instead of a boss/Closer bullet skipping the scale and
					// coming out `ra` times too small. Every boss/Closer cannon's `size` below is a
					// reference-relative length (divide by ra), same convention as every ordinary class.
					Bull.size = can.size * ra;
					// An Arena Closer's own bullets pass through Maze walls the same way the closer
					// itself does - Bullet.js's KIND.WALL arm reads this. Undefined (falsy) for every
					// ordinary shot.
					Bull.closer = this.closer;
					Bull.weight = can.weight;
					Bull.push = can.push;
					// Only read for type 0/2 (bullet/trap) at the receiving end - a drone's pushFactor
					// is a flat 4, not scaled by the shooter's Bullet Damage points.
					Bull.bdPoints = this.upNb[4];
					this.room.createBullet(Bull, this)
					// tick.impulse(), not tick.perTick(): this.vec is fed into Physics.stepBody, which
					// rescales it by dtTicks on every subsequent position step, so a one-shot impulse
					// must go in flat or it would be scaled by dtTicks twice.
					this.vec.add(new Vec(tick.impulse(can.back), 0).rotate(dir - Math.PI));
					if (maxD && (can.life === -1 || can.droneCap)) {
						this.droneCount++;
						if (split) { this.droneGroup[grp]++; }
						Bull.droneGroup = split ? grp : -1;   // so release() below knows which pool to refund
						// This bullet occupies a maxDrone slot - release() reads this flag instead of
						// re-deriving it from `life`, since a `droneCap` finite-life drone (Guardian)
						// must refund its slot on natural expiry exactly like a permanent one refunds
						// on death.
						Bull.counted = 1;
					}
					this.recoil[parseInt(r)] = 1;
					setTimeout((x, r) => { x.recoil[r] = 0 }, config.TICK_MS, this, parseInt(r))
				}
				if (this.shootTimer[r] === 0) {
					this.shootTimer[r] += 1;
					continue;
				}
			} else {
				if (reload < Math.floor(can.offTime * reloadMax)) {
					this.shootTimer[r] = 0;
				}
			}
			if (reload > 0 && reload < reloadMax) {
				this.shootTimer[r] += 1;
			} else if (reload >= reloadMax) {
				this.shootTimer[r] = 0;
			}
		}
		// The multi-target path re-scans every tick instead of latching onto its first sighting -
		// the buckets consumed above were filled by this tick's collision pass and must be emptied
		// before the next one refills them.
		if (this.DETEC && this.DETEC.all) {
			this.DETEC.reset();
			this.DETEC.enabled = 1;
		}
	}
	upgrade(data) {
		if (this.destroy) { return; }
		// stillLvl counts points *spent*; pointsAtLevel() is what has been granted.
		if (pointsAtLevel(this.level) - this.stillLvl <= 0) {
			return 1;
		}
		switch (data) {
			case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
				// Per-tank stat caps - Smasher/Landmine/Spike have no barrels at all (0-capped
				// Reload/BSpeed/BPene/BDamage) and a raised Body Damage/Health cap instead; Auto
				// Smasher keeps every stat since its embedded turret fires real bullets. `statMax`
				// is an 8-length array in `this.up`'s own index order; absent on every other class,
				// which keeps MAX_PER_STAT.
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
						Reload is a geometric multiplier: up.Reload = 0.914^points, applied to can.reload
						in shoot(). MSpeed is a point count consumed by Physics.moveAccel(), not an
						additive bonus. HpRegan/HpUp/BPene/BDamage/BSpeed/BodyDam are each flat per-point
						slopes on their own stat, applied directly below.
					*/
					switch (i) {
						// A point count (the Regen stat), read directly by regenTick()'s HPS formula.
						case "HpRegan": this.up[i] += 1; break;
						case "Reload": this.up[i] *= 0.914; break;         // geometric multiplier on can.reload
						case "BSpeed": this.up[i] += 0.15; break;          // +3/20 per point on bulletAccel
						case "BDamage": this.up[i] += 0.4285714; break;    // +3/7 per point on damagePerTick
						case "BPene": this.up[i] += 0.75; break;           // flat per-point slope
						// A point count, not a bonus - Physics.moveAccel() raises its multiplier to this.
						case "MSpeed": this.up[i] += 1; break;
						// Flat +20 HP/point. The ratio is taken off the OLD maxHp, so the point heals
						// you by exactly the fraction it added. hp stays a float (regen adds fractional
						// amounts, and the wire carries hp as a fraction of maxHp).
						case "HpUp": this.hp *= (this.maxHp + 20) / this.maxHp; this.maxHp += 20; break;
						case "BodyDam": this.damage += 1; break;   // flat +1/point off the base
					}
					break;
				}
		}
	}
	upClass(data) {
		if (this.destroy) { return; }
		let tanks = [];
		// A class tier every 15 levels (gates at 15/30/45). Levels are 1-based, so a fresh tank
		// is level 1 - Room.js's getUi() sends the same expression as `cLvl`.
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
			this.resetDroneBudget();
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
		Shared by upClass()/cycleClass(): a per-tank flat body-damage bonus is folded into the
		running `this.damage` total, so switching class removes the old class's bonus before
		adding the new one's. Per-tank stat caps only ever get narrower on a switch, never
		wider - points already spent above the new cap are clamped down using the exact inverse
		of upgrade()'s own per-stat step, and REFUNDED rather than lost.
	*/
	/*
		Starts a fresh drone budget for a class switch. The outgoing class's drones outlive the
		switch by one tick (entities/Bullet.js's update() destroys them on the `play.class !==
		this.class` guard), and their release() would otherwise refund into the new, already-zeroed
		counters - driving droneCount negative by exactly the size of the old swarm and letting the
		new class spawn that many drones past its own maxDrone. Marking them released first pays
		them off against the old budget, so the refund cannot land twice.
	*/
	resetDroneBudget() {
		if (this.room && this.room.INSTANCE) {
			for (const b of this.room.INSTANCE.bullets.live()) {
				if (b.origin && b.origin.oId === this.id.oId) { b.released = 1; }
			}
		}
		this.droneCount = 0;
		this.droneGroup = [0, 0];
	}
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
				// Refunded, not lost. `stillLvl` counts points SPENT, so giving one back is a
				// decrement here - getUi()'s `still` is pointsAtLevel(level) - stillLvl and
				// updates on its own, no wire field or client change needed.
				this.upNb[idx]--;
				this.stillLvl--;
			}
		}
		// Cannot structurally go negative (you can only clamp points that were spent), but
		// guard it anyway - a clamp firing here would mean something upstream double-spent.
		this.stillLvl = Math.max(0, this.stillLvl);
	}
	/*
		Sandbox-only cheat ('\') - jumps straight to a class with none of upClass()'s tree/level
		gating, so a human can preview any tank regardless of level. Redoes the same
		class-dependent resets upClass() does but does not touch classLvl or unlock the
		evolution achievement - this isn't a real evolution.
	*/
	cycleClass() {
		const oldClass = this.class;
		const i = CYCLABLE_CLASSES.indexOf(this.class);
		this.class = CYCLABLE_CLASSES[(i + 1) % CYCLABLE_CLASSES.length];
		if (!this.bot && this.DETEC && !CLASS[this.class].DETEC) { this.DETEC = null; }
		this.resetDroneBudget();
		this.necro = CLASS[this.class].necro;
		this.shootTimer = new Array(CLASS[this.class].cannons.length).fill(0);
		this.applyClassSwitchStats(oldClass);
	}
	/*
		A Necromancer's claim mechanic: infecting a square on contact with its body, drones, or
		bullets. Shared by the ordinary KIND.OBJECTS contact arm below and the Sandbox god-mode
		branch above - both are "this player's body touched a square", they just disagree on
		whether the touch also deals damage/knockback. Returns true iff `shape` was claimed.
	*/
	claimSquare(shape) {
		if (!this.necro || shape.type !== 'sqr' ||
			this.droneCount >= CLASS[this.class].maxDrone + this.upNb[1]) {
			return false;
		}
		this.droneCount++;
		const Bull = new Bullet(this.id, shape.x, shape.y, Math.random() * Math.PI * 2,
			this.up.BSpeed * this.necro.speed, 0, this.room);
		Bull.type = this.necro.type;
		Bull.class = this.class;
		Bull.necro = this.necro.necro;
		Bull.pene = this.up.BPene * this.necro.pene;
		Bull.life = -1;
		Bull.damage = this.up.BDamage * this.necro.damage;
		Bull.size = shape.size;
		Bull.weight = this.necro.weight;
		Bull.push = this.necro.push;
		this.room.createBullet(Bull, this);
		return true;
	}
	collision(other, option = {}) {
		if (this.dev.ghost) { return; }
		// An Arena Closer is invincible with complete knockback resistance. Returning before
		// anything below runs means it takes no damage and no velocity impulse from any collision
		// kind. The damage it DEALS is unaffected - that's read from the other entity's own
		// collision() call, not gated here.
		if (this.closer) { return; }
		// Sandbox god mode (';') - repel whatever touches you and take no consequence from the
		// contact. Checked on `this` so each side of a pair (Room.js calls collision() on both)
		// short-circuits independently.
		if (this.dev.god) {
			// 8.96 = 3.2 gu x 2.8, twice the ordinary tank-body shove below.
			this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.impulse(8.96), tick.impulse(8.96))));
			// A square's own collision() destroys itself into a claim the instant a necromancer
			// touches it, god mode or not - without this call the square would vanish with no
			// drone to show for it, since only the drone-spawning half is gated here.
			if (other.kind === KIND.OBJECTS) { this.claimSquare(other); }
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
				// A Dominator receives zero knockback and no positional overlap push - its absorb
				// factor of 0 is what makes it immovable. Damage below is unaffected - a Dominator
				// takes damage exactly like any other Player.
				if (!this.dominator) {
					// BODY_KB_GU x 2.8 is the impulse identity TanksConfig.js's `weight`/`back` columns
					// use. tick.impulse(), not tick.perTick() - this.vec routes through Physics.stepBody.
					// `* this.absorb` scales it down for a boss/Mothership - 1 for an ordinary tank.
					//
					// A team mate is a soft body, not a solid one (`option.noDam` is Room.js's same-team
					// flag): a gentle shove keeps bodies from resting exactly on top of each other, and
					// positional resolution is skipped entirely - overlap between friends is allowed.
					const soft = option.noDam ? TEAM_SOFT_PUSH : 1;
					const tankKb = tick.impulse(BODY_KB_GU * 2.8) * this.absorb * soft;
					this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tankKb, tankKb)));
					// Positional overlap resolution, on top of the velocity impulse: the impulse alone
					// can't separate two tanks within a normal contact window, so this pushes them apart
					// along their separation axis by the overlap, split by size so the bigger tank moves
					// less. Room.js calls collision() on both sides of a pair, so each body moves only
					// its own share and a deep overlap clears over about two ticks. Enemies only - see
					// the team-mate note above.
					if (!option.noDam) {
						const sepX = this.x - other.x, sepY = this.y - other.y;
						const sepD = Math.sqrt(sepX * sepX + sepY * sepY) || 1;
						// `guardSize`, not `size` - a Smasher/Landmine/Spike-line tank's spinning guard
						// is a real physical boundary, holding its own share of overlap resolution.
						const mySize = this.guardSize || this.size, otherSize = other.guardSize || other.size;
						const overlap = mySize + otherSize - sepD;
						if (overlap > 0) {
							const share = otherSize / (mySize + otherSize) * overlap / sepD;
							this.x += sepX * share;
							this.y += sepY * share;
						}
					}
				}
				if (option.noDam || this.shield) { break; }
				// common(tank,tank) = TANK_TANK_MULT (lib/damage.js). `option.dmgScale` prorates
				// damage on a tick where either side would otherwise die mid-tick; defaulted to 1 so a
				// direct collision() call that never sets it behaves as a full-tick hit.
				this.hp -= tick.perTick(other.damage * TANK_TANK_MULT * (option.dmgScale ?? 1));
				this.hit = tick.ticks(1.65);
				// lib/gameAI.js's bossDetect(): a boss ignores sub-15 players until one hits it.
				if (this.boss) { this.provoked = other.id.oId; this.provokedAt = this.room.timestamp; }
				// LETHAL_EPS, not 0 - a prorated killing blow can land an ulp short of exactly this.hp.
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
				// The 0.5 threshold is deliberately NOT tick.perTick()'d - this.vec's own
				// accel/friction fixed point is near-invariant to TICK_MS, so a bare threshold
				// against it stays meaningful without a runtime conversion.
				const len = (this.vec.length() < 0.5) ? 2.92538 : .73134;
				// tick.impulse(), not tick.perTick() - this.vec routes through Physics.stepBody.
				// `* this.absorb` scales this down for a boss/Dominator.
				const shapeKb = tick.impulse(len) * this.absorb;
				this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(shapeKb, shapeKb)));
				if (this.claimSquare(other)) { return; }
				if (this.shield) { return; }
				// common(tank,shape) = TANK_SHAPE_MULT (lib/damage.js) - the shape's raw damagePerTick
				// needs the same explicit multiplier the KIND.PLAYER arm above applies.
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
				// A Dominator receives zero knockback here too. Damage below is unaffected, exactly
				// like the KIND.PLAYER guard.
				if (!this.dominator) {
					// The one consumer of TanksConfig.js's `weight` column - the `/3 * 1.6` converts
					// it into the same `gu x 2.8` impulse form `back` takes. A true bullet/trap's
					// push also scales with the shooter's Bullet Damage points; a drone keeps the
					// flat per-cannon `weight` value untouched.
					const pushBase = (other.type === 0 || other.type === 2)
						? other.weight * 0.16 * (7 / 3 + other.bdPoints)
						: other.weight / 3 * 1.6;
					// tick.impulse(), not tick.perTick() - this.vec routes through Physics.stepBody.
					const bulletKb = tick.impulse(pushBase) * this.absorb;
					this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(bulletKb, bulletKb)));
				}
				if (this.shield) { return; }
				// No `pene` multiplier here: a bullet's `pene` already decides how many ticks of
				// contact it survives (see Bullet.js's own KIND.PLAYER arm), so multiplying this
				// per-tick hit by pene again would double-count it. common(bullet,tank) = 1 -
				// `other.damage` here is the bullet's own damage, not `this.damage`.
				this.hp -= tick.perTick(other.damage * (option.dmgScale ?? 1));
				this.hit = tick.ticks(1.65);
				// lib/gameAI.js's bossDetect(): a boss ignores sub-15 players until one hits it.
				if (this.boss) { this.provoked = other.origin.oId; this.provokedAt = this.room.timestamp; }
				if (this.hp <= LETHAL_EPS) { this.hp = 0; this.dead = tick.DEAD_DELAY; this.murder = ["players", other.origin]; this.destroy = tick.DES; }
				break;
			case KIND.WALL: {
				/*
					Rectangular wall - circle-vs-AABB closest-point test, same as the other collision
					arms use. The broad phase only bounds a wall by its half-diagonal, so a candidate
					has to be re-checked here before anything moves; a false-positive must do nothing.
				*/
				const hw = other.w / 2, hh = other.h / 2;
				const cx = Math.max(other.x - hw, Math.min(this.x, other.x + hw));
				const cy = Math.max(other.y - hh, Math.min(this.y, other.y + hh));
				const dx = this.x - cx, dy = this.y - cy;
				const d = Math.sqrt(dx * dx + dy * dy);
				if (d > this.size) { break; }
				// No body damage - a tank sheds to a flat fraction of its own speed on every tick of
				// contact, applied directly to the live vec read.
				this.vec.x *= WALL_TANK_KEEP_SPEED;
				this.vec.y *= WALL_TANK_KEEP_SPEED;
				/*
					Positional correction: the velocity expel alone can't keep up with a fast ram, so
					a tank could sink up to a whole grid cell in before it bit. Clamp the penetration to
					WALL_TANK_OVERLAP of the body radius along the same closest-point normal the other
					arms test with.
				*/
				const slack = this.size * WALL_TANK_OVERLAP;
				if (d === 0) {
					// Centre dead inside the rectangle: the closest point IS the centre, so there
					// is no closest-point normal and no meaningful `size - d` until the centre clears
					// a face. Leave along the nearest FACE (same face-pick entities/Objects.js's arm
					// uses) and push the centre out PAST that face, leaving only `slack` of the body
					// still inside - moving by `size - d` here would never escape a thick wall.
					const fx = hw - Math.abs(this.x - other.x), fy = hh - Math.abs(this.y - other.y);
					let nx, ny, faceDist;
					if (fx < fy) { nx = Math.sign(this.x - other.x) || 1; ny = 0; faceDist = fx; }
					else { nx = 0; ny = Math.sign(this.y - other.y) || 1; faceDist = fy; }
					const move = faceDist + this.size - slack;
					this.x += nx * move;
					this.y += ny * move;
				} else if (this.size - d > slack) {
					// Centre outside the rectangle, body overlapping a corner/edge: shove out along
					// the closest-point normal until only `slack` of the body remains inside.
					const corr = (this.size - d) - slack;
					this.x += (dx / d) * corr;
					this.y += (dy / d) * corr;
				}
				// Shoved out along whichever axis the centre offset is more aligned with -
				// axis-aligned rather than diagonal, since a Maze wall is never rotated. tick.impulse(),
				// not tick.perTick() - this.vec routes through Physics.stepBody.
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
		// Only on actual damage this collision (oldHp > this.hp), not every collision() call
		// regardless of outcome (e.g. a WALL contact never touches hp) - see VISIBILITY_RATE_DAMAGE.
		if (this.alpha < 1 && !this.dev.invisible && oldHp > this.hp) {
			this.alpha = Math.min(1, this.alpha + tick.perTick(VISIBILITY_RATE_DAMAGE));
		}
		// Who most recently landed a hit - a Dominator's own update() reads this to drop a
		// target that has stopped shooting back. `other.origin` for a bullet, `other.id` for a
		// body ram - both are `{oId}`-shaped id descriptors.
		if (oldHp > this.hp) {
			this.lastAttacker = (other.kind === KIND.BULLET) ? other.origin : other.id;
		}
	}
	// One-shot achievement unlock: pushes the registry's toast onto the mess feed, using the
	// client's existing '/img <file>' toast handling.
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
	// Health regen: linear rate from the Regen stat, plus hyper regen once noDamageTicks clears
	// HYPER_REGEN_DELAY. Shared by the ordinary tank update() below and any scripted entity
	// whose own update() replaces Player.prototype.update() wholesale.
	regenTick() {
		// Hyper-regen gate: any HP loss resets the no-damage clock, capped at the threshold
		// rather than left to grow unbounded over a long AFK stretch.
		if (this.hp < this.lastHp) {
			this.noDamageTicks = 0;
		} else {
			this.noDamageTicks = Math.min(this.noDamageTicks + 1, HYPER_REGEN_DELAY);
		}
		if (this.hp < this.maxHp) {
			// HPS = MaxHp x (0.03 + 0.12 x Regen Stat) / 30, per second; /25 converts to
			// per-reference-tick, then tick.perTick() converts to the live tick.
			let hps = this.maxHp * (0.03 + 0.12 * this.up.HpRegan) / 30 / 25;
			// Hyper regen ADDS to the linear rate above, it does not replace it. HYPER_REGEN_RATE
			// is already per-reference-tick, so no further /25 conversion belongs here.
			if (this.noDamageTicks >= HYPER_REGEN_DELAY) { hps += this.maxHp * HYPER_REGEN_RATE; }
			this.hp += tick.perTick(hps);
			this.hp = Math.min(this.maxHp, this.hp);
		} else {
			this.hp = this.maxHp;
		}
		this.lastHp = this.hp;
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
			this.size *= tick.drag(1.1);   // death-animation shrink
			this.screen = config.FOV_MUL * 2194;
			return;
		} else if (this.piloting) {
			/*
				H-key piloting: while `this.piloting` (the Dominator/Mothership this tank is
				currently driving) is set, this vacated tank takes no input, gets no regen, and
				just bleeds `2 + maxHp/500` HP per reference tick until it dies or the pilot
				releases (H again). Anti-exploit floor: level <=5 dies outright rather than slowly
				bleeding, so a fresh spawn can't grab a Dominator/Mothership risk-free.

				The pilot's camera/identity is the boss now, so this body dying must not open the
				pilot's death screen or release the boss - the corpse is just scenery. Once dead,
				`piloting` stays set and this husk is left alone; the socket keeps looking at the
				boss until the pilot presses H or the boss dies. The husk stays parked in its slot
				rather than freeing it, which is what keeps the socket's buffer alive.
			*/
			if (this.dead) { return; }   // already a husk - camera is on the boss, leave it be
			if (this.level <= 5) {
				this.hp = 0;
			} else {
				this.hp -= tick.perTick(2 + this.maxHp / 500);
			}
			if (this.hp <= 0) {
				this.hp = 0;
				this.dead = 1;
				this.destroy = tick.DES;
				this.murder = -1;
				// No releasePossession() here - releasing is the pilot's own H press, a boss
				// flip, or the boss's own death.
			}
			return;
		} else {
			if (this.hp <= 0) {
				this.destroy = tick.DES;
				this.dead = 1;
			}
			this.regenTick();
		}
		
		// `stealth` gates three independent rates (`decay`/`moving`/`shooting`), checked here
		// first each tick so motion()/shoot() below can read `.stealth.moving`/`.stealth.shooting`
		// unguarded.
		if (CLASS[this.class].stealth) {
			// this.room.rules.invisFloor is 0 everywhere but Tag, where a stealth class must
			// never fully vanish so a win condition can't stall.
			this.alpha = Math.max(this.room.rules.invisFloor, this.alpha - tick.perTick(CLASS[this.class].stealth.decay));
		} else if (!this.dev.invisible) { this.alpha = 1 }
		/*
			Predator zoom: while right-click is held, the camera locks to a point 840 units out
			along the mouse direction, computed once when right-click is first pressed - it does
			not keep re-aiming while held, only latches once and releases on mouse-up. Gated on
			the class's own `flags.zoomAbility` so Overseer's unrelated right-click drone-repel
			input is untouched.
		*/
		if (CLASS[this.class].flags && CLASS[this.class].flags.zoomAbility && this.inputs.mouseR) {
			if (!this.zooming) {
				this.zooming = 1;
				this.zoomX = this.x + Math.cos(this.dir) * 840;
				this.zoomY = this.y + Math.sin(this.dir) * 840;
			}
		} else if (this.zooming) {
			this.zooming = 0;
		}
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
		
		// Sandbox-only practice key ('k') - hold to climb one level at a time. Setting `xp` to
		// exactly this level's threshold feeds the ordinary level-up check right below.
		if (this.id.GM === 'sandbox' && this.inputs.k && this.level < this.XPLVL.length) {
			this.levelUpHold = (this.levelUpHold || 0) + 1;
			if (this.levelUpHold >= SANDBOX_LEVELUP_TICKS) {
				this.levelUpHold = 0;
				this.xp = this.XPLVL[this.level];
			}
		} else {
			this.levelUpHold = 0;
		}
		
		if (this.xp >= this.XPLVL[this.level]) {
			// +2 HP/level - a fresh spawn is level 0 (MH0 = 50 already), so this fires once per
			// level-up and lands at 138 HP at the level-45 cap (50 + 44*2).
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
		// Tank body radius grows exponentially with level: 28 x 1.01^level units. Continuous, not
		// floored - `size` is a float32 on the wire and every consumer is fractional already.
		this.size = 28 * Math.pow(1.01, this.level) + this.dev.size;
		// Guard shapes (Smasher/Landmine/Spike) - modelled as a single enlarged collision circle:
		// `guardSize` is the biggest `size x sizeRatio` among the class's guards, used wherever
		// contact/overlap is decided so a spinning guard both deals and blocks contact out to its
		// own edge. Equal to `this.size` for every other class.
		// `hitRatio` (default 1) rescales `size` into a contact radius for a class whose `size`
		// is not itself the drawn radius - the two triangle-bodied bosses store `size` as their
		// body's apothem, so their contact radius is `size x sqrt(2)`.
		this.guardSize = this.size * (CLASS[this.class].hitRatio || 1);
		if (CLASS[this.class].guards) {
			for (const g of CLASS[this.class].guards) {
				this.guardSize = Math.max(this.guardSize, this.size * g.sizeRatio);
			}
		}
		// FOV grows multiplicatively with level at half the tank's own body growth rate.
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

// Type tag for collision / buffer dispatch - on the prototype, so it costs nothing per instance.
Player.prototype.kind = KIND.PLAYER;

// Exposed so tests drive the real constant rather than a copy of it.
Player.AUTOTURRET_LEAD = AUTOTURRET_LEAD;

// Camera width for a scripted entity (boss/Dominator/Mothership/Arena Closer) whose update() is
// replaced by lib/gameAI.js and never runs the `this.screen = ...` formula above. Only FOV_MUL
// applies here, not FOV_PER_LEVEL - a scripted class's own `screen` is already computed at that
// entity's real level.
Player.scriptedScreen = function (className) {
	return CLASS[className].screen * config.FOV_MUL;
};

// The upgrade economy, exposed so Room.js's getUi() sends the client the same "points available"
// figure upgrade() will actually honour, and so tests drive the real schedule.
Player.MAX_PER_STAT = MAX_PER_STAT;
Player.LEVEL_CAP = LEVEL_CAP;
Player.pointsAtLevel = pointsAtLevel;

// Regen constants, exposed for the same reason: tests drive the real hyper-regen threshold/rate.
Player.HYPER_REGEN_DELAY = HYPER_REGEN_DELAY;
Player.HYPER_REGEN_RATE = HYPER_REGEN_RATE;

module.exports = Player;
