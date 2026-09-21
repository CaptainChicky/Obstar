/*
	Sandbox: one human, small arena, no bots. arenaLive sizes the map from player count; with
	maxPlayer 0 the count stays at one and MIN_ARENA_GU keeps the familiar gu(150) floor.
	Sandbox-only dev keys (max xp, self-kill) are gated in net/gameSocket.js on gm === 'sandbox'.
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
			// SlotMap maxIndex — 0 allows only player id 0.
			maxPlayer: 0,
			preGenerate: 120,
			bootDelay: 100,
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
