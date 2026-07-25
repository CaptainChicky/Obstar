/*
	Sandbox ('sandbox') - a single-player practice room. Everything is still Room.js's shared
	tick/collision/spawn pipeline; this file is only the tuning that makes it a sandbox:
	one player, a small arena, and no bots to get in the way.

	Two extra keys only mean anything here: net/gameSocket.js gates them on
	`tank.id.GM === 'sandbox'`, so 'k' (max xp) and 'o' (self-kill) are inert everywhere else.
	maxXp is kept at ffa's 25000 so the level cap stays 30 - a sandbox has no reason to see a
	level the rest of the game can never reach.

	mapSize has a floor: Room.js's default spawnPoint() rejects anywhere within a hardcoded
	1100-unit radius of the origin (plus two 800-unit nests at the quarter-points), written
	against ffa's 9020-unit map where that is a small carve-out. Below roughly 1960 units wide
	no point on the map can ever be 1100 from the origin, and spawnPoint()'s `while(1)` spins
	forever. 3000 stays comfortably clear of that (1/9th ffa's area - still a small arena) while
	leaving the corners reachable on the first few tries.
*/
const Room = require('./Room.js');

class Sandbox extends Room {
	constructor(id) {
		super(id, {
			gm: 'sandbox',
			maxXp: 25000,
			mapSize: { width: 3000, height: 3000 },
			// SlotMap.add() refuses a slot only once `id > max` (rooms/Room.js -> lib/SlotMap.js),
			// so `max` is the highest allocatable index, not a headcount - 0 is what actually caps
			// this at one player (ids 0 and 1 would both fit under a literal maxPlayer: 1).
			maxPlayer: 0,
			preGenerate: 60,
			bootDelay: 100,
			objCaps: { sqr: { max0: 25, max1: 3 }, tri: { max0: 10, max1: 2 }, pnt: { max0: 3, max1: 1 } },
			betaPentRng: 0.98,
			botCount: 0,
			botIdStart: 10,
			teams: [1],
			teamPlay: false,
			respawnPow: 0.9
		});
	}
};

module.exports = Sandbox;
