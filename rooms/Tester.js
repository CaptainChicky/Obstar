/*
	Tester ('tester') - a diagnostic room, not a game mode. It exists so a human can see every
	scripted entity in this codebase at once, next to each other, without waiting on a boss roll or
	a capture or a five-hour timer:

		* the player spawns in GOD MODE and alternates green/red on every death, so both sides of
		  every team-coloured behaviour (base drones, bullet colour, the Mothership's own aggro)
		  can be checked from one seat
		* one Mothership on the red side, with its own AI, respawned if it dies
		* all three Dominator variants (Destroyer / Gunner / Trapper), in a row
		* one of EACH boss (Summoner, Guardian, Defender, Fallen Overlord, Fallen Booster),
		  respawned as they die
		* one green 2team base strip down the left edge, with its 15 paired drone centres
		* one green 4team corner base in the bottom-right, with its 12-drone ring
		* one Arena Closer on a 5s-chasing / 15s-idle cycle, so both of its states are observable
		  without needing a match to end

	Everything here is composed out of hooks rooms/Room.js already has - basePosts(), build(),
	step(), respawn(), respawnTeam(), inEnemyBase(), spawnPoint(). No new entity kind, no new
	behaviour: if something looks wrong in this room it is wrong in the mode it came from, which is
	the entire point of the room.
*/
const config = require('../lib/config.js').config;
const tick = require('../lib/tick.js');
const clock = require('../lib/clock.js');
const World = require('../public/SHARE/World.js');
const gu = World.gu;
const Room = require('./Room.js');
const Player = require('../entities/Player.js');
const CLASS = require('../public/SHARE/TanksConfig.js').class;
const CONFIG = require('../lib/gameAI.js');

// The 4team-style corner base's own square, in the SAME absolute size 4team gives it (gu(67)) -
// this room's `baseSize` is the 2team strip's width (gu(40)), and the wire only carries one
// figure, so the client's own `tester` background case hardcodes this second one to match.
const CORNER_BASE = gu(67);
// 2team's own base-drone layout, verbatim: fifteen orbit centres down the strip, two drones each.
const STRIP_CENTRES = 15, STRIP_PER_CENTRE = 2;
// 4team's own: one centre, twelve drones.
const CORNER_DRONES = 12;
// The Arena Closer's duty cycle. Wall-clock, so it divides by the real step length the same way
// rooms/Maze.js's own close timer does - not a per-reference-tick gameplay constant.
const CLOSER_ON = Math.round(5000 / clock.STEP_MS);
const CLOSER_OFF = Math.round(15000 / clock.STEP_MS);
// One of each, in CONFIG.BOSS's own index order.
const BOSS_COUNT = CONFIG.BOSS.length;

class Tester extends Room {
	constructor(id, controller) {
		super(id, {
			gm: 'tester',
			maxXp: 30000,
			// 2team's arena, so the strip base sits at the size it really is and the corner base
			// still has a whole quadrant to itself.
			mapSize: { width: gu(400), height: gu(400) },
			preGenerate: 600,
			bootDelay: 1,
			shapeMix: { sqr0: 200, sqr1: 20, tri0: 80, tri1: 16, pnt0: 24, pnt1: 20 },
			betaPentRng: 0.99,
			// Bosses are placed by build(), one of each, and topped back up by step() - never
			// rolled for. maxBoss has to be high enough to hold them all or createBoss() refuses.
			bossRng: 2,
			maxBoss: BOSS_COUNT,
			// No bots: this room is for watching the scripted entities, and a bot roster only
			// makes it harder to tell which thing just shot you.
			botCount: 0,
			botIdStart: 10,
			teams: [0, 1],
			teamPlay: true,
			respawnPow: 0.8,
			// The 2team strip's own ratio at this arena size - exactly gu(40), see TwoTeam.js.
			baseSizeRatio: { num: 40, den: 400 },
			viewerBullets: false
		}, controller);
	}
	/* Bottom-right corner - the 4team-style base. The other two corners are left clear. */
	cornerCenter() {
		return {
			x: this.map.width / 2 - CORNER_BASE / 2,
			y: this.map.height / 2 - CORNER_BASE / 2
		};
	}
	/*
		Both base layouts at once, both GREEN (team 0): TwoTeam's fifteen paired centres down the
		left strip, then FourTeam's single twelve-drone ring in the bottom-right corner square.
		Copied from those two files rather than shared, deliberately - each is a statement of what
		THAT mode's base looks like, and a diagnostic room that quietly diverged from either would
		be worse than useless.
	*/
	basePosts() {
		const posts = [];
		const spacing = this.map.height / STRIP_CENTRES;
		for (let i = 0; i < STRIP_CENTRES; i++) {
			const plan = this.levelPlan(STRIP_PER_CENTRE);
			for (let d = 0; d < STRIP_PER_CENTRE; d++) {
				posts.push({
					team: 0,
					x: -(this.map.width / 2 - this.baseSize / 2),
					y: spacing * (i + 0.5) - this.map.height / 2,
					level: plan.initial[d],
					phase: Math.random() * Math.PI * 2,
					levels: plan,
					crossIn: Math.max(1, Math.round(tick.ticks(config.BASE_DRONE_CROSS) *
						(i * STRIP_PER_CENTRE + d + 1) / (STRIP_CENTRES * STRIP_PER_CENTRE)))
				});
			}
		}
		const c = this.cornerCenter();
		const plan = this.levelPlan(CORNER_DRONES);
		for (let i = 0; i < CORNER_DRONES; i++) {
			const jitter = 1 + (Math.random() * 2 - 1) * 0.2;
			posts.push({
				team: 0,
				x: c.x,
				y: c.y,
				level: plan.initial[i],
				phase: Math.random() * Math.PI * 2,
				levels: plan,
				crossIn: Math.max(1, Math.round(tick.ticks(config.BASE_DRONE_CROSS) *
					(i + 1) / CORNER_DRONES * jitter))
			});
		}
		return posts;
	}
	/*
		Both bases belong to green, so only a RED tank is ever fenced out - the strip is TwoTeam's
		half-plane test and the corner is FourTeam's inward-depth one, each restricted to the one
		base this room actually has. rooms/Room.js's step() bounds both to the drawn arena.
	*/
	inEnemyBase(obj, margin = 0) {
		if (obj.team !== 1) { return false; }
		if (obj.x < -(this.map.width / 2 - this.baseSize) - margin) { return true; }
		const dx = this.map.width / 2 - obj.x, dy = this.map.height / 2 - obj.y;
		return dx < CORNER_BASE - margin && dy < CORNER_BASE - margin;
	}
	/* Middle of the arena, clear of both bases and of everything build() places. */
	spawnPoint() {
		return { x: 0, y: gu(60) + Math.random() * gu(20) };
	}
	build() {
		this.testBosses = [];
		this.closerOn = false;
		this.closerTimer = CLOSER_OFF;
		// Three Dominators in a row across the middle, one of each cannon variant, left to right in
		// CONFIG.DOMINATOR's own order (Destroyer / Gunner / Trapper).
		for (let v = 0; v < 3; v++) {
			this.createDominator((v - 1) * gu(60), -gu(40), v);
		}
		// One of each boss, evenly spaced around a ring so none of them starts on top of another.
		for (let b = 0; b < BOSS_COUNT; b++) {
			this.spawnTestBoss(b);
		}
		this.createTestMothership();
		this.createTestCloser();
	}
	/* One boss of a named type at its own fixed slot on the ring - see build(). */
	spawnTestBoss(which) {
		const a = Math.PI * 2 * which / BOSS_COUNT;
		const boss = this.createBoss(which, {
			x: Math.cos(a) * this.map.width / 5,
			y: Math.sin(a) * this.map.height / 5
		});
		this.testBosses[which] = boss || null;
		return boss;
	}
	/*
		The Mothership, on the red side. Verbatim rooms/Mothership.js's own createMothership() -
		same stats, same AI binding - restated here rather than shared because that method is a
		method of that mode's own class and this room is not one.
	*/
	createTestMothership() {
		const mothership = this.INSTANCE.players.add((id) => {
			const m = new Player(
				{ GM: this.gm, sId: this.id, oId: id },
				this.map.width / 4, -this.map.height / 4,
				'Mothership',
				1,
				this.XPLVL,
				this
			);
			m.hp = m.maxHp = 7000;
			m.mothership = 1;
			m.level = 140; // real diep level, same as rooms/Mothership.js
			m.absorb = 0.01;
			m.size = CLASS['Mothership'].bossSize;
			m.class = 'Mothership';
			m.screen = Player.scriptedScreen('Mothership');
			m.shield = 0;
			m.up.MSpeed = 7;
			m.up.Reload = Math.pow(0.914, 7);
			m.up.BSpeed = 1 + 0.15 * 7;
			m.up.BPene = 1 + 0.75 * 7;
			m.up.BDamage = 1 + (3 / 7) * 7;
			m.damage = 5 + 7;
			m.up.HpRegan = 1;
			m.upNb = [7, 7, 7, 7, 7, 7, 7, 1]; // canonical HUD fill
			const spec = CONFIG.MOTHERSHIP;
			m.motion = spec[0].bind(m);
			m.update = spec[1].bind(m);
			return m;
		});
		this.tester_mothership = mothership || null;
		if (mothership) { this.motherships.push(mothership); }
		return mothership;
	}
	/*
		The Arena Closer, on the same "a Closer is a Player bound to CONFIG.CLOSER" pattern
		rooms/Tag.js and rooms/Maze.js both use - except that this one's chase is GATED on
		`this.closerOn`, flipped by step() below. CONFIG.CLOSER's own motion() is called only while
		the switch is on; while it is off the Closer idles exactly the way diep_wiki says a Closer
		with nothing left to chase does ("spinning and slowly drifting"), without moving off its
		spot, so both halves of its behaviour can be watched from one place.
	*/
	createTestCloser() {
		const spec = CONFIG.CLOSER[0];
		const closer = this.INSTANCE.players.add((id) => {
			const c = new Player(
				{ GM: this.gm, sId: this.id, oId: id },
				-this.map.width / 4, this.map.height / 4,
				spec[2],
				this.rules.neutralTeam,
				this.XPLVL,
				this
			);
			c.closer = 1;
			c.class = spec[2];
			c.screen = Player.scriptedScreen(c.class);
			c.size = 98;
			c.guardSize = c.size;   // circle body
			c.damage = 50;
			c.up.BSpeed = 1 + 0.15 * 7;   // maxed BSpeed slope at 7 points - see rooms/Tag.js's own createCloser()
			c.hp = c.maxHp = this.rules.bossHp;
			c.shield = 0;
			const chase = spec[0].bind(c);
			const room = this;
			c.motion = function () {
				if (room.closerOn) { chase.call(this); return; }
				// Idle: autospin in place, no target, no travel.
				this.target = null;
				this.dir += tick.perTick(0.01212);
			};
			c.update = spec[1].bind(c);
			return c;
		});
		this.tester_closer = closer || null;
		return closer;
	}
	step() {
		if (!this.destroy) {
			// Duty-cycle the Closer: 5s hunting, 15s idle.
			if (--this.closerTimer <= 0) {
				this.closerOn = !this.closerOn;
				this.closerTimer = this.closerOn ? CLOSER_ON : CLOSER_OFF;
			}
			// Top every scripted entity back up as it dies. `bosses` is Room's own live list and
			// it drops a boss the tick its death animation finishes, so a slot whose entry is gone
			// from there is a slot to refill.
			for (let b = 0; b < BOSS_COUNT; b++) {
				const boss = this.testBosses[b];
				if (!boss || this.bosses.indexOf(boss) < 0) { this.spawnTestBoss(b); }
			}
			const m = this.tester_mothership;
			if (!m || m.destroy || m.state.disconnect) {
				if (m) {
					const i = this.motherships.indexOf(m);
					if (i >= 0 && (m.destroy === 1 || m.state.disconnect)) { this.motherships.splice(i, 1); }
				}
				if (!m || m.destroy === 1 || m.state.disconnect) { this.createTestMothership(); }
			}
			if (!this.tester_closer || this.tester_closer.state.disconnect) { this.createTestCloser(); }
		}
		super.step();
	}
	/* Green, red, green, red - one side per life, so both are seen without rejoining. */
	respawnTeam(tank) {
		return tank.team ? 0 : 1;
	}
	/*
		God mode, re-applied on every spawn. respawn() builds a BRAND NEW Player and carries over
		only what it names explicitly (inputs/userKey/unlocked/killCounts), so `dev` - which is
		where entities/Player.js's own invulnerability/repulsion guard lives - starts empty on each
		life and has to be re-set here. Bots/bosses/Dominators never route through this path.
	*/
	respawn(id, force = 0, bot = 0) {
		const xp = super.respawn(id, force, bot);
		const tank = this.INSTANCE.players.get(id);
		if (tank && !tank.bot && !tank.boss && !tank.dominator && !tank.mothership && !tank.closer) {
			tank.dev.god = 1;
			// Insane bullet damage, for quickly testing things that need a Dominator (or anything
			// else) to actually die/flip in a hit or two - see entities/Player.js's own
			// Bull.damage = this.up.BDamage * can.damage. Uncapped, way past the normal 7-point
			// max of 4, purely a testing convenience for this room.
			tank.up.BDamage = 1000;
		}
		return xp;
	}
	entityColor(player) {
		return player.boss ? Room.bossColor(player) : (Room.neutralColor(player) ?? player.team);
	}
	mainColor(player) {
		return player.team;
	}
	bulletColor(bullet) {
		return bullet.color ? bullet.color - 1 : bullet.team;
	}
	leaderColor(player, viewerId) {
		return player.team;
	}
	/*
		A diagnostic room is watched, not played, so its minimap says what each dot IS rather than
		how it relates to the viewer: entityColor() for everything, which gives every boss its own
		diep colour, an uncaptured Dominator and the Arena Closer Color.Neutral, and every ordinary
		tank its real team - including the godmode observer, who is otherwise the one dot on the
		map that lies about which side it is on.
	*/
	mapDotColor(player) {
		return this.entityColor(player);
	}
};

module.exports = Tester;
