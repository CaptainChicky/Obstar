/*
	BossMode ('boss') - free-for-all where the bosses are the content rather than a once-in-
	ten-thousand-rolls event.

	Mechanically this is Ffa with rules.maxBoss raised and rules.bossRng dropped, so up to
	three bosses are alive at a time and a dead one is replaced within seconds. Everything that
	makes a boss a boss - the Detector-driven AI in lib/gameAI.js, the neutral team 9, the
	30k prize (diepcustom AbstractBoss.ts's own scoreReward, plan.md Part D) - already lived in
	rooms/Room.js.createBoss(); this file only says how many and how often.

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
			// The shape MIX only - the TOTAL is diep's 1-per-200-gu^2 density now (PENDING #19,
			// plan.md step 6). Worth noting because it is the one mode where that barely moves:
			// 615 -> 612 shapes, because boss's tighter gu(350) arena already sat almost exactly at
			// diep's density. These are verbatim the objCaps this mode used to state.
			shapeMix: { sqr0: 353, sqr1: 31, tri0: 137, tri1: 24, pnt0: 43, pnt1: 27 },
			betaPentRng: 0.98,
			bossRng: 0.9,      // ~10% of spawn passes roll for a boss, vs 0.9999 in 2team
			maxBoss: 3,
			// No override any more - DEFAULT_RULES.bossHp is now diep's own real 3000
			// (AbstractBoss.ts:141, plan.md Part D), not a per-mode balance knob to raise.
			botCount: 6,        // fewer bots than ffa - the bosses are what you are fighting
			botIdStart: 10,
			teams: [1],
			teamPlay: false,
			respawnPow: 0.9
		}, controller);
	}
};

module.exports = BossMode;
