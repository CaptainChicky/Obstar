/*
	Sandbox ('sandbox') - a single-player practice room. Everything is still Room.js's shared
	tick/collision/spawn pipeline; this file is only the tuning that makes it a sandbox:
	one player, a small arena, and no bots to get in the way.

	Two extra keys only mean anything here: net/gameSocket.js gates them on
	`tank.id.GM === 'sandbox'`, so 'k' (max xp) and 'o' (self-kill) are inert everywhere else.
	maxXp is kept at ffa's 25000 so the level cap stays 30 - a sandbox has no reason to see a
	level the rest of the game can never reach.

	This is the one shipped mode whose arena diep_wiki describes as population-varying - "The
	arena's size along with the number of shapes that spawn in it varies depending on the number of
	players connected to it" (diep_wiki/Game Modes.txt) - so it sets `arenaLive` and gets
	AL = floor(sqrt(N_P) * 50) gu every tick (PENDING #19, plan.md step 6). In practice that is
	*inert today*, and deliberately so rather than by oversight: maxPlayer 0 caps this room at one
	player, AL(1) = 50 gu is below rooms/Room.js's MIN_ARENA_GU floor of 150, so the arena sits at
	exactly the gu(150) it has always been. The flag is set because it is what the mode's own
	behaviour is, and it comes alive by itself if the party-link path ever raises maxPlayer.

	The old note here about mapSize "degrading" below ~2744 units - Room.js's spawnPoint() rejecting
	a hardcoded 1540-unit radius that a small map has no point outside of - no longer applies. Those
	radii scale with the arena now (room.nestScale), so a small map gets proportionally small nests
	rather than a carve-out it cannot satisfy. See rooms/Room.js's rejectSample().
*/
const World = require('../public/SHARE/World.js');
const gu = World.gu;
const Room = require('./Room.js');

class Sandbox extends Room {
	constructor(id, controller) {
		super(id, {
			gm: 'sandbox',
			maxXp: 25000,
			mapSize: { width: gu(150), height: gu(150) },
			arenaLive: true,
			// maxPlayer becomes SlotMap's maxIndex (lib/SlotMap.js) - the highest allocatable
			// id, not a headcount - so 0 is what caps this room at one player.
			maxPlayer: 0,
			preGenerate: 120,
			bootDelay: 100,
			// The shape MIX only - the TOTAL is diep's 1-per-200-gu^2 density now (PENDING #19,
			// plan.md step 6), 87 -> 112 at gu(150). Because this mode is `arenaLive`, that density
			// IS diep's published "12.5 polygons per connected player" for it, exactly: the two
			// formulas compose to a constant density, so a mode that scales its arena by AL() gets
			// the per-player count for free. See rooms/Room.js's header.
			shapeMix: { sqr0: 49, sqr1: 6, tri0: 20, tri1: 4, pnt0: 6, pnt1: 2 },
			betaPentRng: 0.98,
			botCount: 0,
			botIdStart: 10,
			teams: [1],
			teamPlay: false,
			respawnPow: 0.9
		}, controller);
	}
};

module.exports = Sandbox;
