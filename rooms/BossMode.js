/*
	Boss mode: Ffa-like room with several simultaneous bosses and a fast boss spawn roll.
	Bosses are excluded from the leaderboard in Room.step().
*/
const World = require('../public/SHARE/World.js');
const gu = World.gu;
const Room = require('./Room.js');

class BossMode extends Room {
	constructor(id, controller) {
		super(id, {
			gm: 'boss',
			maxXp: 35000,
			mapSize: { width: gu(350), height: gu(350) },
			preGenerate: 1200,
			bootDelay: 100,
			shapeMix: { sqr0: 353, sqr1: 31, tri0: 137, tri1: 24, pnt0: 43, pnt1: 27 },
			betaPentRng: 0.98,
			bossRng: 0.9,
			maxBoss: 3,
			botCount: 6,
			botIdStart: 10,
			teams: [1],
			teamPlay: false,
			respawnPow: 0.9
		}, controller);
	}
};

module.exports = BossMode;
