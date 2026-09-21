/*
	Domination: TwoTeam with opposite corner bases, four neutral Dominators, and 2× xp.
*/
const config = require('../lib/config.js').config;
const tick = require('../lib/tick.js');
const TwoTeam = require('./TwoTeam.js');

const PER_BASE = 12;
const DESTROYER = 0, GUNNER = 1, TRAPPER = 2;

class Domination extends TwoTeam {
	constructor(id, controller) {
		super(id, controller, { gm: 'domination', xpMul: 2, baseSizeRatio: { num: 67, den: 400 } });
	}
	corner(team) {
		const s = team ? 1 : -1;
		return { x: s * this.map.width / 2, y: s * this.map.height / 2 };
	}
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
	spawnPoint(tank) {
		const c = this.corner(tank.team);
		const inset = 56;
		const depth = () => inset + Math.random() * (this.baseSize - inset * 2);
		return {
			x: c.x - Math.sign(c.x) * depth(),
			y: c.y - Math.sign(c.y) * depth()
		};
	}
	build() {
		const dx = this.map.width / 6, dy = this.map.height / 6;
		this.createDominator(-dx, -dy, DESTROYER);
		this.createDominator(dx, dy, DESTROYER);
		this.createDominator(-dx, dy, GUNNER);
		this.createDominator(dx, -dy, TRAPPER);
	}
};

module.exports = Domination;
