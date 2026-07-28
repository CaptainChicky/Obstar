/*
	BossMode ('boss') - free-for-all where the bosses are the content rather than a once-in-
	ten-thousand-rolls event.

	Mechanically this is Ffa with rules.maxBoss raised and rules.bossRng dropped, so up to
	three bosses are alive at a time and a dead one is replaced within seconds. Everything that
	makes a boss a boss - the Detector-driven AI in lib/gameAI.js, the neutral team 9, the
	100k prize - already lived in rooms/Room.js.createBoss(); this file only says how many and
	how often.

	Bosses stay off the leaderboard (rooms/Room.js skips `i.boss` when it builds `leader`), so
	the board still ranks players against each other rather than being permanently topped by
	whatever is currently rampaging.
*/
const World = require('../public/SHARE/World.js');
const gu = World.gu;
const Room = require('./Room.js');

class BossMode extends Room {
	constructor(id, controller) {
		super(id, {
			gm: 'boss',
			maxXp: 35000,
			mapSize: { width: gu(350), height: gu(350) },   // tighter than ffa: the fight finds you
			preGenerate: 1200,
			bootDelay: 100,
			// x1.96 on every cap to hold per-screen shape density constant against the x1.4 grid
			// rescale - FOV didn't grow, so the map's area did.
			objCaps: { sqr: { max0: 353, max1: 31 }, tri: { max0: 137, max1: 24 }, pnt: { max0: 43, max1: 27 } },
			betaPentRng: 0.98,
			bossRng: 0.9,      // ~10% of spawn passes roll for a boss, vs 0.9999 in 2team
			maxBoss: 3,
			bossHp: 30000,
			botCount: 6,        // fewer bots than ffa - the bosses are what you are fighting
			botIdStart: 10,
			teams: [1],
			teamPlay: false,
			respawnPow: 0.9
		}, controller);
	}
};

module.exports = BossMode;
