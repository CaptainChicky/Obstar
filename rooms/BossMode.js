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
const Room = require('./Room.js');

class BossMode extends Room {
	constructor(id) {
		super(id, {
			gm: 'boss',
			maxXp: 35000,
			mapSize: { width: 7000, height: 7000 },   // tighter than ffa: the fight finds you
			preGenerate: 600,
			bootDelay: 100,
			objCaps: { sqr: { max0: 180, max1: 16 }, tri: { max0: 70, max1: 12 }, pnt: { max0: 22, max1: 14 } },
			betaPentRng: 0.98,
			bossRng: 0.9,      // ~10% of spawn passes roll for a boss, vs 0.9999 in 2team
			maxBoss: 3,
			bossHp: 30000,
			botCount: 6,        // fewer bots than ffa - the bosses are what you are fighting
			botIdStart: 10,
			teams: [1],
			teamPlay: false,
			respawnPow: 0.9
		});
	}
};

module.exports = BossMode;
