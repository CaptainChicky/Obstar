/*
	Ffa - the free-for-all room.

	Everything that used to be in here is now in rooms/Room.js, whose defaults *are*
	free-for-all's behaviour: one nominal team, friendly fire on, no bases, no boss, your own
	tank blue and everyone else red. So this file is only the tuning that makes ffa itself -
	a bigger map, a denser field of polygons, a lower level cap and ten bots.
*/
const World = require('../public/SHARE/World.js');
const gu = World.gu;
const Room = require('./Room.js');

class Ffa extends Room {
	constructor(id, controller) {
		super(id, {
			gm: 'ffa',
			maxXp: 25000,
			mapSize: { width: gu(451), height: gu(451) },
			preGenerate: 1000,
			bootDelay: 100,
			// x1.96 on every cap to hold per-screen shape density constant against the x1.4 grid
			// rescale (plan.md D1) - FOV didn't grow, so the map's area did.
			objCaps: { sqr: { max0: 431, max1: 35 }, tri: { max0: 157, max1: 24 }, pnt: { max0: 49, max1: 29 } },
			betaPentRng: 0.98,
			botCount: 10,
			botIdStart: 10,
			teams: [1],
			teamPlay: false,
			respawnPow: 0.9
		}, controller);
	}
};

module.exports = Ffa;
