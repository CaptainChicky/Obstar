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

	WHAT IS DELIBERATELY NOT HERE, so it reads as scope rather than oversight:
	  - Arena Closers. diep ends a Tag match by spawning Arena Closers once one team holds every
	    player. We have no Arena Closer entity and adding one is a new entity type - exactly what
	    this mode was chosen for NOT needing. The room still self-destructs when it empties, the
	    same as every other mode.
	  - The invisibility cap. diep_wiki notes players "can't become fully invisible" in Tag,
	    to stop a Landmine/Stalker hiding in a corner and preventing the match from ending. That is
	    a real rule, it is just a change to entities/Player.js's alpha handling rather than
	    anything this file can state, and it only matters once there is a win condition to stall.
	    Both are written up in PENDING rather than half-built.
*/
const World = require('../public/SHARE/World.js');
const gu = World.gu;
const clock = require('../lib/clock.js');
const Room = require('./Room.js');

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
			viewerBullets: false
		}, controller);
	}
	/* Counts down to the next shrink. build() runs before the first tick, so this exists by then. */
	build() {
		this.shrinkIn = SHRINK_EVERY;
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
	/* Whether the tagging rule is live yet: every team needs MIN_PER_TEAM players first. */
	tagging() {
		return Math.min.apply(null, this.teamCounts()) >= MIN_PER_TEAM;
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
	step() {
		// Before super.step(), so the shrink's new target is in newMap by the time that tick's map
		// lerp reads it - otherwise every shrink lands one tick late for no reason.
		if (!this.destroy) { this.shrink(); }
		super.step();
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
