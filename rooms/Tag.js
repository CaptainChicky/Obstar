/*
	Tag - four teams, no bases, and the side you are on is decided by whoever killed you last.

	Source: diep_wiki/Tag.txt, cross-read with diep_wiki/Game Modes.txt and diep_wiki/Map.txt.
	The mode is four teams (the same red/blue/purple/green four 4 Teams uses), random spawns
	anywhere on the map, x3 xp, an arena that shrinks on a timer, and a leaderboard that counts
	players per team instead of ranking individuals.

	It is the cheapest mode in the tree to add because it introduces NO new entity types - every
	mechanic below is either an existing rules knob or one of rooms/Room.js's named hooks. What is
	actually new here is only:

	  respawnTeam()   you come back on your killer's side, not your own
	  leaderRows()    one row per team, showing headcount
	  build()/step()  the shrink timer

	Everything else - joining the thinnest side, four-way team colours, friendly fire, the boss
	roll - is inherited unchanged, which is the point of the hook table at the top of Room.js.

	THE WIN CONDITION (PENDING #28's remaining half, landed after the rest of this file). diep_wiki/
	Tag.txt: "Once a team kills all enemy players, that team wins and the arena will be closed."
	"Closed" is diep_wiki/Arena Closer.txt's own mechanism, not a bespoke Tag ending: several
	invincible Arena Closers spawn and hunt everyone down - winners included, per that page's own
	AI priority list - until nobody is left, at which point Room.step()'s existing zero-human
	self-destruct (the same one every other mode already relies on) fires on its own. Nothing new
	had to be taught to end the room; winning just has to make it empty. See winner()/
	startClosing()/createCloser() below, CONFIG.CLOSER in lib/gameAI.js for the AI itself,
	and TanksConfig.js's "Arena Closer" class for its stats.

	The invisibility cap lives in entities/Player.js (rules.invisFloor, defaulted in Room.js) since
	it is a change to alpha handling, not anything this file states - but it is this mode's own
	rule (diep_wiki: "Players can't become fully invisible... to prevent tanks like Landmine and
	Stalker from hiding in the corner of the map and preventing the game from ending"), so it is
	opted into below rather than left at the base default.
*/
const World = require('../public/SHARE/World.js');
const gu = World.gu;
const clock = require('../lib/clock.js');
const Room = require('./Room.js');
const Player = require('../entities/Player.js');
const CLASS = require('../public/SHARE/TanksConfig.js').class;
const CONFIG = require('../lib/gameAI.js');

/*
	How many Arena Closers a win spawns. diep_wiki gives a maximum of 16, not a fixed count, and 16
	is the wrong number to reach for here regardless: this room's SlotMap tops out at rules.
	maxPlayer (30, 10 join slots + 16 bots already seated), so 16 more would frequently not fit,
	and they never need to (they are invincible and never die, so a handful hunts down a match this
	size just as certainly as sixteen would - it only takes longer). createCloser() already no-ops
	if the room is full, the same guard createBoss() uses, so this is a target, not a promise.
*/
const CLOSER_COUNT = 4;
// diep_wiki gives no number for the invisibility cap, only that zero is disallowed - 0.15 is ours,
// picked to stay clearly visible up close (where a Landmine/Stalker corner-camp actually matters)
// without erasing the class's whole point at range.
const INVIS_FLOOR = 0.15;

/*
	The shrink, which is the one number here diep_wiki does not supply.

	It gives the PERIOD exactly - "the arena itself will shrink every 12 to 13 seconds" - and says
	nothing at all about the RATE, so the period is diep's and the rate is ours, flagged rather than
	presented as measured. 12.5 s is the midpoint of the stated band. 0.95 per step is chosen so a
	match has a recognisable arc rather than to match anything: from gu(400), 0.95^n reaches the
	gu(150) floor after 20 shrinks, i.e. about 4 minutes and 10 seconds, which is roughly a diep
	match. Change it here and nothing else needs recomputing.

	The period divides by the real wall-clock step (clock.STEP_MS) rather than by a reference tick,
	the same category as rooms/Room.js's own GENERATE_EVERY - it is a wall-clock schedule, not a
	gameplay-feel constant denominated per REF_TICK_MS, so it takes no lib/tick.js conversion.
*/
const SHRINK_EVERY = Math.round(12500 / clock.STEP_MS);
const SHRINK_FACTOR = 0.95;
const SHRINK_FLOOR = gu(150);

/*
	diep_wiki: "The game only begins when each team has at least four players. Before then, when a
	player dies they stay on the same team." So tagging is gated, not unconditional - and the gate
	is per-team, not a total headcount, which is why it is a min-over-teams below rather than a sum.
*/
const MIN_PER_TEAM = 4;

class Tag extends Room {
	constructor(id, controller) {
		super(id, {
			gm: 'tag',
			maxXp: 30000,
			// 4team's arena, since this is 4team's team count without the bases. It is also the
			// size the shrink is tuned against - see SHRINK_FACTOR.
			mapSize: { width: gu(400), height: gu(400) },
			preGenerate: 2000,
			bootDelay: 1,
			// The shape MIX; the TOTAL is diep's 1-per-200-gu^2 density (PENDING #19, plan.md step
			// 6). Taken from 4team, the mode this shares its arena and team count with.
			shapeMix: { sqr0: 392, sqr1: 39, tri0: 137, tri1: 27, pnt0: 43, pnt1: 31 },
			betaPentRng: 0.99,
			// diep_wiki/Tag.txt: "Bosses are likely to live longer than other modes since there are
			// no base drones" - so bosses do occur here. Same roll as the other team modes.
			bossRng: 0.9999,
			maxBoss: 1,
			// Enough bots that the MIN_PER_TEAM gate can actually open - 16 dealt round-robin is
			// exactly 4 a side - or the mode silently never tags anything, which diep_wiki itself
			// warns about ("If the server doesn't have enough players, the game may never begin").
			botCount: 16,
			// Bots must start at 10 or higher: slots 0-9 are the join slots, and a roster that
			// overlapped them would quietly overwrite a joining player (test/rooms.js pins this for
			// every mode). 10 + 16 bots reaches slot 25, hence the wider maxPlayer below - which is
			// a slot CEILING (SlotMap's maxIndex), not a headcount.
			botIdStart: 10,
			maxPlayer: 30,
			teams: [0, 1, 2, 3],
			teamPlay: true,
			respawnPow: 0.8,
			// diep_wiki/Polygons.txt lists Tag among the x3 xp modes. Applied once, in
			// rooms/Room.js's awardXp().
			xpMul: 3,
			// No bases at all - that is the defining structural difference from 4team, and it is
			// stated by leaving baseSizeRatio at its 0/1 default rather than by an override.
			viewerBullets: false,
			invisFloor: INVIS_FLOOR
		}, controller);
	}
	/* Counts down to the next shrink. build() runs before the first tick, so this exists by then. */
	build() {
		this.shrinkIn = SHRINK_EVERY;
		// Whether the win condition has fired - starting the Arena Closer swarm and cutting off
		// respawn() (below). false for the room's whole life unless winner() trips it in step().
		this.closing = false;
		// Every closer createCloser() has actually spawned - not consulted by anything in this file
		// (a Closer never dies, so there is no cleanup loop to drive), kept for the same reason
		// this.bosses exists on Room: something outside this file (a test, an admin command) may
		// want to know they are there.
		this.closers = [];
		// tagging()'s latch (see there) - starts closed, same as a fresh match where no side has
		// reached MIN_PER_TEAM yet.
		this.tagged = false;
	}
	/*
		You respawn on the team of whoever killed you - the whole mode.

		`tank.murder` is set by whichever collision arm killed the tank: ["players", <id>] for a
		tank or a bullet (entities/Player.js records the BULLET'S ORIGIN, not the bullet, so a kill
		by fire tags you to the shooter exactly as a ram does), and ["objs", <id>] for a polygon.
		Only the first tags you - diep_wiki: "If a Polygon or a Boss kills a player, the player will
		respawn in the same team."

		A boss is a Player, so it arrives here as ["players", ...] and would tag the victim onto team
		9 - a side nothing else in the room is on, and one assignTeam() never hands out. Excluded
		explicitly for that reason, which also happens to be exactly what the wiki asks for.
	*/
	respawnTeam(tank) {
		if (!this.tagging()) { return tank.team; }
		const m = tank.murder;
		if (!m || m === -1 || m[0] !== 'players') { return tank.team; }
		const killer = this.INSTANCE.players.get(m[1].oId);
		if (!killer || killer.boss) { return tank.team; }
		// A killer that has itself already died and been recycled into a different tank should not
		// tag anyone; teams.indexOf guards the team being one this mode actually assigns.
		if (this.rules.teams.indexOf(killer.team) < 0) { return tank.team; }
		return killer.team;
	}
	/*
		How many players each side has, as an array parallel to rules.teams. The one population
		count in this file - both the tagging gate and the leaderboard read it, so they can never
		disagree about who is on what side.

		Counts the same population assignTeam() balances: bots included (they are players), bosses
		excluded (a boss is on no side and would never satisfy any quota).

		DEAD players are deliberately COUNTED. A tank that just died is respawning, not gone - it
		still belongs to a side, and diep's own board is "the number of players each team has", not
		"how many are currently alive". Filtering them out instead made both readings flicker every
		time anything died: with exactly 4 bots a side, one dead bot dropped that side to 3 and shut
		the whole tagging rule off for the respawn delay.
	*/
	teamCounts() {
		const count = new Array(this.rules.teams.length).fill(0);
		for (const p of this.INSTANCE.players.live()) {
			if (p.boss) { continue; }
			const t = this.rules.teams.indexOf(p.team);
			if (t >= 0) { count[t]++; }
		}
		return count;
	}
	/*
		Whether the tagging rule is live yet: every team needed MIN_PER_TEAM players AT SOME POINT.
		Latched into this.tagged rather than re-evaluated live (PENDING #28's win condition surfaced
		why: a team being weeded down toward zero is exactly what a match heading toward a winner
		looks like, and a live re-check would have this go permanently false the moment the first
		team dropped below MIN_PER_TEAM, freezing respawnTeam()'s conversion - and winner() below,
		which depends on tagging() - right when the match should be closing in on one). diep_wiki
		itself reads as one-time, not continuous: "The game only begins when each team has at least
		four players... Once each team has enough players, killing a player will convert them" - a
		trigger, not a standing condition.
	*/
	tagging() {
		if (!this.tagged) {
			this.tagged = Math.min.apply(null, this.teamCounts()) >= MIN_PER_TEAM;
		}
		return this.tagged;
	}
	/*
		The timed shrink. Writes newMap the same way the admin 'mapResize' command does, so the
		existing lerp in Room.step() does the actual moving and this stays a schedule rather than a
		second resize path. Square, and floored - a match that runs long enough parks at
		SHRINK_FLOOR instead of collapsing to nothing.

		Called from step()'s override below rather than being a hook of its own, because it is the
		only per-tick work this mode adds.
	*/
	shrink() {
		if (--this.shrinkIn > 0) { return; }
		this.shrinkIn = SHRINK_EVERY;
		const next = Math.max(SHRINK_FLOOR, this.newMap.width * SHRINK_FACTOR);
		this.newMap.width = next;
		this.newMap.height = next;
	}
	/*
		True once the win condition has fired - one team holds every player left in the room, and
		the mode is actually live yet (mirrors tagging()'s own gate: diep_wiki's win condition is a
		Tag-specific ending, not something that can fire before Tag's own rule is even active).
		Team 9 (rules.bossTeam, also what createCloser() below puts closers on) is never in
		rules.teams, so a boss or a closer already can't be the "one team" this counts - no separate
		exclusion needed here, the same reason teamCounts() above needs none for bosses.
	*/
	winner() {
		if (!this.tagging()) { return false; }
		return this.teamCounts().filter((n) => n > 0).length === 1;
	}
	/*
		Fires once, the tick winner() first goes true. Doesn't try to keep a target Closer
		population topped up the way createBoss() replenishes a killed boss - a Closer is invincible
		(entities/Player.js's collision() returns immediately for one) and never dies, so a one-time
		burst is the whole mechanism; see CLOSER_COUNT above for why it is 4, not diep's up-to-16.
	*/
	startClosing() {
		this.closing = true;
		for (let i = 0; i < CLOSER_COUNT; i++) { this.createCloser(); }
	}
	/*
		One Arena Closer, spawned the same way createBoss() spawns a boss - a fresh Player bound to
		CONFIG.CLOSER's motion/update instead of a class's normal ones. Set here rather than guessed
		into the shared class table, the same way createBoss() sets a boss's hp/size on the instance:
		  size: 98, diepcustom's ArenaCloser.ts BASE_SIZE 175 du x 0.56 (plan.md Step 11) - was 64,
		  a boss-body stand-in PENDING #51 flagged as unsatisfactory.
		  damage: 50, 10x this.damage's own diep-derived base (5, entities/Player.js, plan.md chunk 1
		  D1) - "extremely high" without inventing a one-shot-everything constant from nothing.
		hp/maxHp don't matter to a Closer itself (collision() never spends them - see there) but are
		set to a real finite number rather than left at whatever a fresh level-0 tank defaults to,
		in case anything else ever reads them (the leaderboard, an admin command); rules.bossHp is a
		convenient existing "big number" rather than a second one invented to match it.
	*/
	createCloser() {
		const spec = CONFIG.CLOSER[0];
		const pos = this.spawnPoint();
		const closer = this.INSTANCE.players.add((id) => {
			const c = new Player(
				{ GM: this.gm, sId: this.id, oId: id },
				pos.x, pos.y,
				spec[2],
				this.rules.bossTeam,
				this.XPLVL,
				this
			);
			c.closer = 1;
			c.class = spec[2];
			c.screen = CLASS[c.class].screen;
			c.size = 98;
			c.damage = 50;
			c.hp = c.maxHp = this.rules.bossHp;
			c.shield = 0;
			c.motion = spec[0].bind(c);
			c.update = spec[1].bind(c);
			return c;
		});
		if (closer) { this.closers.push(closer); }
		return closer;
	}
	step() {
		// Before super.step(), so the shrink's new target is in newMap by the time that tick's map
		// lerp reads it - otherwise every shrink lands one tick late for no reason. winner() is
		// checked the same way, before super.step()'s own humans-vs-bots count decides whether the
		// room self-destructs this tick, so a match that wins and immediately empties still gets its
		// Closers spawned first rather than skipped by a same-tick race.
		if (!this.destroy) {
			this.shrink();
			if (!this.closing && this.winner()) { this.startClosing(); }
		}
		super.step();
	}
	/*
		Once the arena is closing, nobody comes back - diep_wiki's win condition ends when "all
		players are killed off the arena", not when they respawn into it again. `force` is still
		honoured (createAi()'s initial seed, if this were ever reached that late), so this only cuts
		off the two ordinary paths - the client-driven respawn request and step()'s own bot restock -
		that already call this without it.
	*/
	respawn(id, force = 0, bot = 0) {
		if (this.closing && !force) { return; }
		return super.respawn(id, force, bot);
	}
	/*
		One row per team, showing how many players are on it - diep_wiki: "The leaderboard will show
		the number of players each team has." Sorted by headcount so the leading team is row 0,
		which is also what the client scales its bars against.

		`xp` carries the headcount: public/client/ui.js draws each row as "name - xp" with a bar
		proportional to xp/row0.xp, so a count renders correctly with no client change at all. The
		names are the mode's own team colours (SocketSchema's `color` table, indices 0..3).
	*/
	leaderRows(id) {
		const NAMES = ['Green', 'Red', 'Yellow', 'Blue'];
		const count = this.teamCounts();
		return this.rules.teams
			.map((team, i) => ({ xp: count[i], name: NAMES[i] || ('Team ' + team), nameC: 0, team: team }))
			.sort((a, b) => b.xp - a.xp);
	}
	/* Bots dealt round-robin across the four sides, starting from a random one - 4team's roster,
		 which is what keeps every side stocked well enough for the MIN_PER_TEAM gate to open. */
	botRoster() {
		const offset = Math.floor(Math.random() * this.rules.teams.length);
		const roster = [];
		for (let i = 0; i < this.rules.botCount; i++) {
			roster.push({
				id: this.rules.botIdStart + i,
				team: this.rules.teams[(offset + i) % this.rules.teams.length]
			});
		}
		return roster;
	}
	/* Every side stays stocked no matter how many humans are in the room. */
	botBudget(humanCount) {
		return Infinity;
	}
	/*
		Random spawns anywhere clear of the polygon nests - diep_wiki: "There are no bases, similar
		to FFA ... Instead, players will spawn randomly all over the map." That is exactly Room's
		own default, so it is inherited rather than written; noted here because "no spawnPoint()
		override" is a deliberate statement about this mode, not an omission.

		Colours are by team, like every other team mode.
	*/
	entityColor(player) {
		return player.team;
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
};

module.exports = Tag;
