/*
	Domination - TwoTeam's teams and tuning, with 4team-style corner bases on OPPOSITE corners
	(green top-left, red bottom-right) and four neutral Dominators on a square between them.

	A Dominator is a stationary Player bound to lib/gameAI.js's CONFIG.DOMINATOR (rooms/Room.js's
	createDominator()), the same pattern createBoss()/Tag's createCloser() use.
*/
const config = require('../lib/config.js').config;
const tick = require('../lib/tick.js');
const TwoTeam = require('./TwoTeam.js');

// Twelve drones round one orbit centre per base, 4team's own base.
const PER_BASE = 12;
// Destroyer / Gunner / Trapper - CONFIG.DOMINATOR's own index order.
const DESTROYER = 0, GUNNER = 1, TRAPPER = 2;

class Domination extends TwoTeam {
	constructor(id, controller) {
		// gu(67) of TwoTeam's gu(400) arena - the same absolute corner base 4team gives a side.
		super(id, controller, { gm: 'domination', xpMul: 2, baseSizeRatio: { num: 67, den: 400 } });
	}
	/* Team 0 owns the top-left corner, team 1 the bottom-right. */
	corner(team) {
		const s = team ? 1 : -1;
		return { x: s * this.map.width / 2, y: s * this.map.height / 2 };
	}
	/* The orbit centre of a side's base - the centre of its baseSize square. */
	baseCenter(team) {
		const c = this.corner(team);
		return {
			x: c.x - Math.sign(c.x) * this.baseSize / 2,
			y: c.y - Math.sign(c.y) * this.baseSize / 2
		};
	}
	basePosts() {
		const posts = [];
		for (const team of this.rules.teams) {
			const c = this.baseCenter(team);
			const plan = this.levelPlan(PER_BASE);
			for (let i = 0; i < PER_BASE; i++) {
				const jitter = 1 + (Math.random() * 2 - 1) * 0.2;
				posts.push({
					team: team,
					x: c.x,
					y: c.y,
					level: plan.initial[i],
					phase: Math.random() * Math.PI * 2,
					levels: plan,
					crossIn: Math.max(1, Math.round(tick.ticks(config.BASE_DRONE_CROSS) *
						(i + 1) / PER_BASE * jitter))
				});
			}
		}
		return posts;
	}
	/*
		Set foot in the other side's corner square and you die there. Depth is measured inward from
		the map edge on each axis and is deliberately unbounded outward, so the out-of-bounds margin
		past a corner still counts as inside; rooms/Room.js's step() bounds it to the drawn arena.
	*/
	inEnemyBase(obj, margin = 0) {
		if (this.rules.teams.indexOf(obj.team) < 0) { return false; }
		for (const team of this.rules.teams) {
			if (team === obj.team) { continue; }
			const c = this.corner(team);
			const dx = (c.x > 0) ? c.x - obj.x : obj.x - c.x;
			const dy = (c.y > 0) ? c.y - obj.y : obj.y - c.y;
			if (dx < this.baseSize - margin && dy < this.baseSize - margin) { return true; }
		}
		return false;
	}
	/* You always come back inside your own square, a tank diameter clear of the map walls. */
	spawnPoint(tank) {
		const c = this.corner(tank.team);
		const inset = 56;
		const depth = () => inset + Math.random() * (this.baseSize - inset * 2);
		return {
			x: c.x - Math.sign(c.x) * depth(),
			y: c.y - Math.sign(c.y) * depth()
		};
	}
	/*
		Four Dominators on the corners of a square centred on the arena: a Destroyer on each end of
		the base diagonal (nearest a base), the Gunner and the Trapper on the empty diagonal, each
		equidistant from both bases.
	*/
	build() {
		const dx = this.map.width / 6, dy = this.map.height / 6;
		this.createDominator(-dx, -dy, DESTROYER);
		this.createDominator(dx, dy, DESTROYER);
		this.createDominator(-dx, dy, GUNNER);
		this.createDominator(dx, -dy, TRAPPER);
	}
};

module.exports = Domination;
