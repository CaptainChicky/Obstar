/*
	Domination ('domination') - TwoTeam's own base/map/tuning, plus four neutral Dominators
	(PENDING #27) sitting between the two sides. `rooms/TwoTeam.js`'s `extraRules` constructor
	param is what lets this subclass TwoTeam rather than duplicate its whole base/drone/colour
	block just to change `gm` and `xpMul` - diep_wiki/Polygons.txt states Domination's xp
	multiplier directly (x2), the same table Tag's x3 already came from.

	A Dominator is not a static entity kind here - it is a stationary Player bound to
	lib/gameAI.js's CONFIG.DOMINATOR (rooms/Room.js's createDominator()), the same CONFIG.BOSS/
	CONFIG.CLOSER pattern createBoss()/Tag's createCloser() already use. See that file's own
	comment for the capture/knockdown state machine and PENDING #27 for the full spec.
*/
const TwoTeam = require('./TwoTeam.js');

/*
	Four Dominators in a loose diamond around the arena centre, between the two base strips -
	diep_wiki/Domination.txt gives no coordinates at all (only "4 Dominators"), so this layout is
	ours, untuned by design, the same footing rooms/Maze.js's wall placement shipped on (PENDING
	#26) - due a real playtest pass once a human can actually see the map. One of each variant
	spawns twice, alternating which pair gets Destroyer/Trapper so neither side of the diamond is
	identical.
*/
const VARIANTS = [0, 1, 2]; // Destroyer / Gunner / Trapper - CONFIG.DOMINATOR's own index order

class Domination extends TwoTeam {
	constructor(id, controller) {
		super(id, controller, { gm: 'domination', xpMul: 2 });
	}
	/*
		Room's own pre-tick hook (the same one rooms/Maze.js's wall generation runs from) - by the
		time this fires `this.map` is already the real arena size, so the diamond is placed
		relative to it rather than a literal.
	*/
	build() {
		const dx = this.map.width / 8, dy = this.map.height / 4;
		const posts = [
			{ x: -dx, y: -dy, variant: VARIANTS[0] },
			{ x: dx, y: -dy, variant: VARIANTS[1] },
			{ x: -dx, y: dy, variant: VARIANTS[2] },
			{ x: dx, y: dy, variant: VARIANTS[0] }
		];
		for (const p of posts) { this.createDominator(p.x, p.y, p.variant); }
	}
};

module.exports = Domination;
