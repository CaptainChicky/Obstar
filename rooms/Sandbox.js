/*
	Sandbox ('sandbox') - a single-player practice room. Everything is still Room.js's shared
	tick/collision/spawn pipeline; this file is only the tuning that makes it a sandbox:
	one player, a small arena, and no bots to get in the way.

	Two extra keys only mean anything here: net/gameSocket.js gates them on
	`tank.id.GM === 'sandbox'`, so 'k' (max xp) and 'o' (self-kill) are inert everywhere else.
	maxXp is kept at ffa's 25000 so the level cap stays 30 - a sandbox has no reason to see a
	level the rest of the game can never reach.

	mapSize has no hard floor any more, only degradation: Room.js's default spawnPoint() rejects
	anywhere within a hardcoded 1540-unit radius of the origin (plus two 1120-unit nests at the
	quarter-points, x1.4 under the grid rescale - plan.md WP1), written against ffa's gu(451)-unit
	map where that is a small carve-out. Below roughly 2744 units wide no point on the map can ever
	be 1540 from the origin - Room.rejectSample() (plan.md WP-SPAWN) bounds the search instead of
	looping forever, and falls back to the best (furthest-from-a-nest) point it found, so a map
	that small spawns you *near* a nest rather than hanging the room. gu(150) = 4200 stays clear of
	that (~1/9th ffa's area - still a small arena) while leaving the corners reachable on the first
	few tries.
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
			// maxPlayer becomes SlotMap's maxIndex (lib/SlotMap.js) - the highest allocatable
			// id, not a headcount - so 0 is what caps this room at one player.
			maxPlayer: 0,
			preGenerate: 120,
			bootDelay: 100,
			// x1.96 on every cap to hold per-screen shape density constant against the x1.4 grid
			// rescale (plan.md D1) - FOV didn't grow, so the map's area did.
			objCaps: { sqr: { max0: 49, max1: 6 }, tri: { max0: 20, max1: 4 }, pnt: { max0: 6, max1: 2 } },
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
