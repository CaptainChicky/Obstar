/*
	Free-for-all: Room defaults with a larger map, denser shape mix, ten bots, and no teams.
	Nest scaling uses this arena as the reference (nestScale === 1).
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
			// Six weights for apportionShapes(); total count comes from arena area / 200 gu².
			shapeMix: { sqr0: 431, sqr1: 35, tri0: 157, tri1: 24, pnt0: 49, pnt1: 29 },
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
