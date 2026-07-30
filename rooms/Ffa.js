/*
	Ffa - the free-for-all room.

	Everything that used to be in here is now in rooms/Room.js, whose defaults *are*
	free-for-all's behaviour: one nominal team, friendly fire on, no bases, no boss, your own
	tank blue and everyone else red. So this file is only the tuning that makes ffa itself -
	a bigger map, a denser field of polygons, a lower level cap and ten bots.

	ffa is the REFERENCE arena for every nest radius in the tree (rooms/Room.js's NEST_REF_GU), so
	its own room.nestScale is exactly 1 and its spawn/placement behaviour is unchanged by the
	arena-scaling work. Its gu(451) size is also deliberately NOT resized toward diep's AL(24) =
	244 gu - see the header of rooms/Room.js for why that stays open rather than landing here.
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
			// The shape MIX (rooms/Room.js's apportionShapes()); the TOTAL is now diep's density,
			// 1 per 200 gu^2 of arena (PENDING #19, plan.md step 6). These six numbers are exactly
			// the objCaps this mode used to state - which were themselves the pre-grid-rescale caps
			// x1.96, to hold per-screen density constant when the map's area grew and FOV did not -
			// so the proportions this mode was tuned with are carried over verbatim and only the
			// total moves (725 -> 1017 at ffa's gu(451) arena, the 1.4x #19 says we are short).
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
