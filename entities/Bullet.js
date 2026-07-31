/*
	Bullet - projectiles, including drone / trap / necro behaviour.

	Extracted from the old Alex.js monolith (now server.js + lib/ + rooms/ + entities/).
	Bullets never cross rooms - a bullet only ever looks up its own origin's room - so it holds
	a direct `this.room` reference instead of reaching through a registry.
*/
const Vec = require('victor');
const tick = require('../lib/tick.js');
const config = require('../lib/config.js').config;
const CLASS = require('../public/SHARE/TanksConfig.js').class;
// NOT public/SHARE/Physics.js's tank FRICTION - see lib/constants.js. diep models a bullet as
// V_b = rho/t_b with no drag term at all, so the drag a bullet decays through here is our own
// hand-tuned number and is deliberately NOT the tank's 10/11. It stays put until MEASUREMENTS.md's
// M1 says what diep actually does; every number in this file is denominated against it.
const BODY_FRICTION = tick.drag(require('../lib/constants.js').BODY_FRICTION);
const KIND = require('../public/SHARE/kinds.js');
const Detector = require('./Detector.js');

// diep_wiki/Stats.txt: Body Damage is "decreased by 75% when affecting projectiles (Bullets,
// Traps, Drones)" - MEASUREMENTS.md's pinned "-75% vs projectiles" entry (PENDING #18). Applies
// to what a bullet's own `pene` (its spend-down health pool) loses per tick of contact with a
// body-damage source below - not to what the bullet itself deals, which is untouched.
const PROJECTILE_BODY_DAMAGE = 0.25;

// Wall contact physics (PENDING #2, wall-only slice) - see lib/constants.js and entities/Player.js's
// own KIND.WALL arm for what these mean and why they're ours, not diep's.
const WALL_BOUNCE = require('../lib/constants.js').WALL_BOUNCE;
const WALL_FRICTION = tick.drag(require('../lib/constants.js').WALL_FRICTION);

// Per-tick re-aim chance for homing bullets/drones, converted to a real-tick probability once at
// load (lib/tick.js's "chance" category).
const REAIM_CHANCE = tick.chance(0.0012121);
const CHARGE_CHANCE = tick.chance(0.0006061);

/*
	The one-time factor the `speed` column in public/SHARE/TanksConfig.js gained when this file's
	motion tail (bottom of update()) moved from tick.perTick() to tick.quadratic().

	The tail is the standard "add a thrust, decay through BODY_FRICTION, then position += vec" shape,
	which integrates the thrust TWICE over ticks - once into vec, again into position - so a single
	SCALE is short by a factor of SCALE and a bullet's range came out proportional to 1/TICK_MS
	(measured 955 -> 1695 units across TICK_MS 33 -> 16 for one class). tick.quadratic() is the
	category for exactly that shape; every `speed` was multiplied by 1.6 alongside the change so
	the numbers a player actually sees at the live TICK_MS (25) did not move at all.

	NOT tick.SCALE, even though 1/1.6 happens to equal today's 25/40. It is a frozen constant: if
	TICK_MS ever moves, this must NOT move with it - that invariance is the whole point of the fix.

	It divides back out at the two sites that consume `speed` as something OTHER than the per-tick
	cruise thrust - the muzzle kick in the constructor, and the 'god' repulsion in collision() -
	both of which were already TICK_MS-invariant on their own and must not move.
*/
const SPEED_RESCALE = 1.6;

/*
	Base drone orbit AI. All converted once at module load, not per drone per tick.

	The steering model: every drone carries `head` (radians) and `spd` (units per real tick), both
	rate-limited (BASE_DRONE_TURN, BASE_DRONE_ACCEL) toward a per-state desired direction and
	target speed, and position is their integral - true for ORBIT/CHASE, NOT for a cross or a
	planned level-switch arc (below). That is what makes every transition outside those two
	continuous by construction.

	Radius is quantised into five shared "energy levels" rather than a continuous random band: a
	drone is always at one of rooms/Room.js's levelR(1..5), and the only thing that ever moves it
	between levels is levelSwitch() below, called from four triggers - a shape hit (this file's
	KIND.OBJECTS collision arm), drone-vs-drone proximity (rooms/Room.js's pair loop sets
	`tooClose`, consumed in case 1.4), a post-swoosh climb back to home (case 1.4's `homing` state)
	and the per-centre binomial sorter (rooms/Room.js's tickDroneCentres() - a restoring force
	toward BASE_DRONE_LEVEL_WEIGHTS's steady shape, not just a reaction to something touching the
	drone). A shape hit / drone-proximity switch is the sharp 60-degree lean
	(BASE_DRONE_LEAN_SCALE/HIT_TURN); a home/sort switch is the shallow planned
	BASE_DRONE_SWITCH_LEAN arc instead (planSwitchArc(), below).

	The diameter cross is a planned curve, not a steered pursuit of an antipodal aim point - a
	turn-limited pursuit cannot be made to pass through a specific point. It is arc -> C2 blend ->
	an exact straight line through the orbit centre -> C2 blend -> arc, precomputed once at trigger
	into a per-tick {x,y,vx,vy} table by planCross() (below quinticHermite()). The SPEED along that
	path is a plateau: ramp from cruise up to peak over the first BASE_DRONE_CROSS_RAMP of the
	path, hold peak across the middle, ramp back down over the last BASE_DRONE_CROSS_RAMP - so the
	orbit centre sits somewhere inside the held plateau rather than at a special point of its own.
	`case 1.4`'s per-tick evaluation while `crossing` is just an array read; the turn/accel limiter
	is bypassed entirely for those ticks, since the curve's own curvature and the baked-in speed
	profile already bound the motion.
*/
const BASE_DRONE_CROSS = tick.ticks(config.BASE_DRONE_CROSS);
const BASE_DRONE_ORBIT_SPEED = tick.perTick(config.BASE_DRONE_ORBIT_SPEED);
const BASE_DRONE_CHASE_SPEED = tick.perTick(config.BASE_DRONE_CHASE_SPEED);
const BASE_DRONE_CROSS_SPEED = tick.perTick(config.BASE_DRONE_CROSS_SPEED);
const BASE_DRONE_TURN = tick.perTick(config.BASE_DRONE_TURN);
// Used in place of BASE_DRONE_TURN whenever a drone is chasing - a dash needs
// its own, much tighter turn radius or a "faster chase" would only make the AI worse (see
// lib/config.js's comment).
const BASE_DRONE_CHASE_TURN = tick.perTick(config.BASE_DRONE_CHASE_TURN);
const BASE_DRONE_ACCEL = tick.perTick(config.BASE_DRONE_ACCEL);
const BASE_DRONE_SWITCH_COOLDOWN = tick.ticks(config.BASE_DRONE_SWITCH_COOLDOWN);
const BASE_DRONE_LEVEL_RELAX = tick.ticks(config.BASE_DRONE_LEVEL_RELAX);

/*
	One segment of a quintic Hermite: position, velocity AND acceleration are matched at both
	endpoints (C2), unlike a cubic Hermite (position/velocity only) or smootherstep (zero
	derivative at both ends, which is what made the WP4 cross visibly stop dead twice per swoosh).
	`s` is the local 0..1 parameter, `T` the segment's duration in real ticks (the derivative terms
	are pre-scaled by T/T^2 so `va`/`aa`/`vb`/`ab` are plain per-tick quantities, not per-s ones).
	Returns {p, v} for one axis; case 1.4 calls this twice per tick while crossing (x, y).
*/
function quinticHermite(s, T, pa, va, aa, pb, vb, ab) {
	const s2 = s * s, s3 = s2 * s, s4 = s3 * s, s5 = s4 * s;
	const h0 = 1 - 10 * s3 + 15 * s4 - 6 * s5;
	const h1 = s - 6 * s3 + 8 * s4 - 3 * s5;
	const h2 = (s2 - 3 * s3 + 3 * s4 - s5) / 2;
	const h3 = 10 * s3 - 15 * s4 + 6 * s5;
	const h4 = -4 * s3 + 7 * s4 - 3 * s5;
	const h5 = (s3 - 2 * s4 + s5) / 2;
	const h0d = -30 * s2 + 60 * s3 - 30 * s4;
	const h1d = 1 - 18 * s2 + 32 * s3 - 15 * s4;
	const h2d = (2 * s - 9 * s2 + 12 * s3 - 5 * s4) / 2;
	const h3d = 30 * s2 - 60 * s3 + 30 * s4;
	const h4d = -12 * s2 + 28 * s3 - 15 * s4;
	const h5d = (3 * s2 - 8 * s3 + 5 * s4) / 2;
	const aT = aa * T * T, abT = ab * T * T, vaT = va * T, vbT = vb * T;
	const p = h0 * pa + h1 * vaT + h2 * aT + h3 * pb + h4 * vbT + h5 * abT;
	const v = (h0d * pa + h1d * vaT + h2d * aT + h3d * pb + h4d * vbT + h5d * abT) / T;
	return { p, v };
}

// Arc-length samples per blend. 64 is measured to produce identical tick counts,
// identical segment lengths and a peak turn rate within 2% of 128's at every level, at half the
// cost - it is built once per drone per cross, not per tick.
const CROSS_NS = 64;

/*
	One C2 blend of the swoosh, sampled into an arc-length table. The Hermite's
	duration parameter T is a SHAPE parameter here, not a duration: it scales the derivative
	handles, so it is solved by fixed point against the curve's own length rather than guessed with
	a measured overhead factor. 3-8 iterations at every level; the cap is a safety net, not an
	expected path.
*/
function blendShape(P0, V0, A0, P1, V1, A1, vMean) {
	let T = Math.max(3, Math.hypot(P1.x - P0.x, P1.y - P0.y) / vMean);
	const xs = new Array(CROSS_NS + 1), ys = new Array(CROSS_NS + 1), ss = new Array(CROSS_NS + 1);
	let len = 0;
	for (let it = 0; it < 8; it++) {
		len = 0;
		for (let i = 0; i <= CROSS_NS; i++) {
			const s = i / CROSS_NS;
			xs[i] = quinticHermite(s, T, P0.x, V0.x, A0.x, P1.x, V1.x, A1.x).p;
			ys[i] = quinticHermite(s, T, P0.y, V0.y, A0.y, P1.y, V1.y, A1.y).p;
			if (i) { len += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]); }
			ss[i] = len;
		}
		const next = len / vMean;
		if (Math.abs(next - T) < 1e-3) { break; }
		T = next;
	}
	return { xs, ys, ss, L: len };
}

/*
	Position and analytic velocity at arc length `arc` along a bare polyline (xs/ys/ss). planCross()
	walks ONE polyline spanning all three pieces of the swoosh, not three separate
	blend/straight/blend tables. The tangent is a central difference over the sample either side,
	not the single bracketing segment's chord - a per-segment tangent makes `head` (and so the
	drawn drone) step a couple of units at a time.
*/
function pathAt(xs, ys, ss, arc, spd) {
	let lo = 0, hi = ss.length - 1;
	while (lo < hi - 1) { const m = (lo + hi) >> 1; if (ss[m] <= arc) { lo = m; } else { hi = m; } }
	const seg = (ss[lo + 1] - ss[lo]) || 1e-9;
	const f = Math.min(1, Math.max(0, (arc - ss[lo]) / seg));
	const a = Math.max(0, lo - 1), b = Math.min(ss.length - 1, lo + 2);
	const tx = xs[b] - xs[a], ty = ys[b] - ys[a];
	const tl = Math.hypot(tx, ty) || 1;
	return {
		x: xs[lo] + (xs[lo + 1] - xs[lo]) * f,
		y: ys[lo] + (ys[lo + 1] - ys[lo]) * f,
		vx: tx / tl * spd, vy: ty / tl * spd
	};
}

/*
	The swoosh's geometry: arc -> C2 blend -> straight through the orbit centre
	-> C2 blend -> arc, as ONE polyline spanning all three pieces (`CROSS_NS` samples each). Shared
	between planCross() (a real drone, real entry state) and the standalone
	Bullet.estimateCrossTicks() (geometry only, no drone needed), so the two can
	never silently disagree about how long a cross from r0 to R1 takes. Returns the polyline plus
	`sc`, the arc length at which it crosses the orbit centre - exact rather than searched for,
	since the centre lies ON the straight by construction (BASE_DRONE_CROSS_BLEND_FRAC < 1 always
	leaves it strictly between the two blend endpoints - see lib/config.js's comment).
*/
function crossPolyline(P0, V0, A0, ox, oy, r0, R1, phi, spin) {
	const f = config.BASE_DRONE_CROSS_BLEND_FRAC;
	const lead = 2 * Math.PI * config.BASE_DRONE_CROSS_LEAD * spin;
	const phiLine = phi + lead;
	const ux = Math.cos(phiLine), uy = Math.sin(phiLine);
	const dx = -ux, dy = -uy;
	// Each end gives up a fraction of ITS OWN radius, not of the chord - that is
	// what keeps the orbit centre strictly inside the straight, at fraction r0/(r0+R1) along it,
	// for every f < 1 at every level, so BLEND_FRAC has no geometric cap to assert any more.
	const Lin = { x: ox + ux * r0 * (1 - f), y: oy + uy * r0 * (1 - f) };
	const Lout = { x: ox + dx * R1 * (1 - f), y: oy + dy * R1 * (1 - f) };
	const phiB = phiLine + Math.PI + lead;
	const nBx = Math.cos(phiB), nBy = Math.sin(phiB);
	const B = { x: ox + nBx * R1, y: oy + nBy * R1 };
	const VB = { x: -nBy * spin * BASE_DRONE_ORBIT_SPEED, y: nBx * spin * BASE_DRONE_ORBIT_SPEED };
	const aB = BASE_DRONE_ORBIT_SPEED * BASE_DRONE_ORBIT_SPEED / R1;
	const AB = { x: -nBx * aB, y: -nBy * aB };
	// The velocity handed to blendShape at the line knots is a SHAPE handle, not a speed: the walk
	// below takes its direction from the polyline tangent and its magnitude from the speed profile,
	// so only the handle's DIRECTION (along the line) and the zero acceleration beside it are
	// load-bearing - they are what make the join tangent to the line with zero curvature, i.e.
	// geometrically C2.
	const Vl = { x: dx * BASE_DRONE_CROSS_SPEED, y: dy * BASE_DRONE_CROSS_SPEED };
	const Z = { x: 0, y: 0 };
	const vMean = (BASE_DRONE_ORBIT_SPEED + BASE_DRONE_CROSS_SPEED) / 2;
	const she = blendShape(P0, V0, A0, Lin, Vl, Z, vMean);
	const shx = blendShape(Lout, Vl, Z, B, VB, AB, vMean);

	// ONE polyline over all three pieces - the speed profile spans the whole
	// swoosh, so there is nothing left to solve per-piece and nothing for two pieces to disagree
	// about at a seam.
	const xs = [], ys = [], ss = [];
	let len = 0;
	const push = (x, y) => {
		if (xs.length) { len += Math.hypot(x - xs[xs.length - 1], y - ys[ys.length - 1]); }
		xs.push(x); ys.push(y); ss.push(len);
	};
	for (let i = 0; i <= CROSS_NS; i++) { push(she.xs[i], she.ys[i]); }
	for (let i = 1; i <= CROSS_NS; i++) {
		push(Lin.x + (Lout.x - Lin.x) * i / CROSS_NS, Lin.y + (Lout.y - Lin.y) * i / CROSS_NS);
	}
	for (let i = 1; i <= CROSS_NS; i++) { push(shx.xs[i], shx.ys[i]); }
	const L = len;
	const sc = ss[CROSS_NS] + Math.hypot(Lin.x - ox, Lin.y - oy);
	return { xs, ys, ss, L, sc, B, VB, Lin, Lout };
}

/*
	The speed profile: ramp from cruise up to `vp` over the first
	BASE_DRONE_CROSS_RAMP of the path, hold `vp` across the middle, ramp back down to cruise over
	the last BASE_DRONE_CROSS_RAMP. `dv/ds = 0` at all four of s=0, s=ramp, s=L-ramp and s=L, which
	is what makes the two seams C2 (the tangential acceleration vanishes there, leaving only the
	curvature term) and both knees corner-free. `sc` is no longer read - the peak is a plateau that
	the orbit centre sits inside, not a point the centre defines.
*/
function crossVAt(L, sc, arc, vp) {
	const ramp = L * config.BASE_DRONE_CROSS_RAMP;
	const z = arc <= ramp ? arc / ramp : (L - arc) / ramp;
	const w = Math.min(1, Math.max(0, z));
	return BASE_DRONE_ORBIT_SPEED + (vp - BASE_DRONE_ORBIT_SPEED) * w * w * (3 - 2 * w);
}

// Real-tick duration of the whole swoosh at peak speed `vp`, by trapezoidal integration over the
// polyline's own arc-length samples.
function crossDurOf(ss, L, sc, vp) {
	let d = 0;
	for (let i = 1; i < ss.length; i++) {
		d += (ss[i] - ss[i - 1]) / ((crossVAt(L, sc, ss[i], vp) + crossVAt(L, sc, ss[i - 1], vp)) / 2);
	}
	return d;
}

/*
	Solve the PEAK so the walk lands on a whole tick, instead of rescaling the
	whole profile by dur/T the way the previous pass did: rescaling leaves both seam speeds at
	ORBIT_SPEED*k rather than exactly ORBIT_SPEED - a <=0.7% velocity step at each seam. dur() is
	strictly decreasing in the peak, so 18 bisections land it to well under a part in 10^4.
*/
function crossSolvePeak(ss, L, sc) {
	const T = Math.max(3, Math.round(crossDurOf(ss, L, sc, BASE_DRONE_CROSS_SPEED)));
	let lo = BASE_DRONE_CROSS_SPEED * 0.9, hi = BASE_DRONE_CROSS_SPEED * 1.1;
	for (let it = 0; it < 18; it++) {
		const mid = (lo + hi) / 2;
		if (crossDurOf(ss, L, sc, mid) > T) { lo = mid; } else { hi = mid; }
	}
	return { T, vPeak: (lo + hi) / 2 };
}

/*
	Build a whole swoosh as a per-tick table: arc -> C2 blend -> straight
	through the orbit centre -> C2 blend -> level 1, traversed by ONE speed profile that ramps up to
	peak over the path's first BASE_DRONE_CROSS_RAMP, holds it across the middle, and ramps back
	down over the last BASE_DRONE_CROSS_RAMP. Called once at trigger.
*/
function planCross(drone) {
	const spin = drone.spin;
	const ex = drone.x - drone.ox, ey = drone.y - drone.oy;
	const r0 = Math.hypot(ex, ey) || 1;
	const nx = ex / r0, ny = ey / r0;
	const phi = Math.atan2(ny, nx);
	const R1 = drone.room.levelR(1);
	// Real position, real velocity (so the join is C0/C1 whatever the drone was doing), and the
	// centripetal acceleration of the circle it is ACTUALLY flying - radius r0 at its own speed.
	const v0 = Math.hypot(drone.vec.x, drone.vec.y) || BASE_DRONE_ORBIT_SPEED;
	const P0 = { x: drone.x, y: drone.y }, V0 = { x: drone.vec.x, y: drone.vec.y };
	const A0 = { x: -nx * v0 * v0 / r0, y: -ny * v0 * v0 / r0 };

	const { xs, ys, ss, L, sc, B, VB, Lin, Lout } = crossPolyline(P0, V0, A0, drone.ox, drone.oy, r0, R1, phi, spin);
	const { T, vPeak } = crossSolvePeak(ss, L, sc);

	const tbl = [];
	let arc = 0, teTick = T, txTick = T;
	const sEnd = ss[CROSS_NS], xEnd = ss[2 * CROSS_NS];
	for (let t = 1; t <= T; t++) {
		for (let n = 0; n < 8; n++) {          // RK2 substeps: explicit Euler drifts at this dt
			const h = 1 / 8, a1 = crossVAt(L, sc, arc, vPeak);
			arc += (a1 + crossVAt(L, sc, arc + a1 * h, vPeak)) / 2 * h;
		}
		if (t === T) { arc = L; }
		if (teTick === T && arc >= sEnd) { teTick = t; }
		if (txTick === T && arc >= xEnd) { txTick = t; }
		tbl.push(pathAt(xs, ys, ss, arc, crossVAt(L, sc, arc, vPeak)));
	}
	// The last tick IS the orbit field's own state at B, written exactly rather than sampled, so
	// the hand-off costs the field zero dHead/dSpd on its first tick back.
	tbl[tbl.length - 1] = { x: B.x, y: B.y, vx: VB.x, vy: VB.y };
	drone.crossTbl = tbl;
	// Three ARC LENGTHS now (entry/straight/exit), not tick counts - no piece
	// owns a whole number of ticks any more, since the speed profile spans the whole swoosh.
	// Diagnostics and tests only; nothing branches on it.
	drone.crossSegs = [sEnd, xEnd - sEnd, L - xEnd];
	// The exact geometric straight endpoints - a test wants these directly rather
	// than approximating them from the nearest flown tick, which can overshoot a fraction of a tick
	// into the neighbouring blend (the speed profile is one continuous polyline now, so a tick
	// boundary is no longer guaranteed to land exactly on a knot the way the old per-piece tables did).
	drone.crossLin = { x: Lin.x, y: Lin.y };
	drone.crossLout = { x: Lout.x, y: Lout.y };
	// The tick-count boundaries a test wants alongside the arc lengths above -
	// computed here, once, rather than reconstructed by scanning the flown table after the fact.
	drone.crossTicks = [teTick, txTick - teTick, T - txTick];
	drone.crossT = 0;
	drone.crossing = true;
}

/*
	Standalone geometry-only estimate of how many real ticks a cross from r0 to R1 takes - factored out
	of planCross()'s own duration solve so rooms/Room.js can size each
	orbit centre's crossCap (how many drones may be mid-swoosh at once) from measured demand at
	ledger-build time, without needing a live drone. Generic phi=0/spin=+1 and an entry state at
	cruise speed, tangential - what a cross launching from steady orbit actually starts from; the
	duration doesn't depend on phi or spin (rotation/mirror invariant), only on r0 and R1.
*/
function estimateCrossTicks(r0, R1) {
	const v0 = BASE_DRONE_ORBIT_SPEED;
	const P0 = { x: r0, y: 0 }, V0 = { x: 0, y: v0 };
	const A0 = { x: -v0 * v0 / r0, y: 0 };
	const { ss, L, sc } = crossPolyline(P0, V0, A0, 0, 0, r0, R1, 0, 1);
	return crossSolvePeak(ss, L, sc).T;
}

/*
	The orbit field's desired direction at a drone's current position:
	tangential, with a radial lean toward orbRTarget that saturates at BASE_DRONE_LEAN_MAX. Never
	normalised - only its angle is ever read. Factored out of case 1.4's steering tail because the
	chase-drop block and clampToMap()'s corner fallback need the SAME vector to snap `head` onto,
	and three copies of this expression would eventually disagree.
*/
function orbitDesired(drone) {
	const ex = drone.x - drone.ox, ey = drone.y - drone.oy;
	const r = Math.sqrt(ex * ex + ey * ey) || 1;
	const ux = ex / r, uy = ey / r;
	const tx = -uy * drone.spin, ty = ux * drone.spin;
	const err = drone.orbRTarget - r;   // + = must move outward
	const lean = Math.max(-config.BASE_DRONE_LEAN_MAX,
		Math.min(config.BASE_DRONE_LEAN_MAX, err / config.BASE_DRONE_LEAN_SCALE));
	return { dx: tx + ux * lean, dy: ty + uy * lean, r, err };
}

/*
	The radial mechanism: move a drone
	exactly one energy level.

	  'random' - a REACTION (shape hit or drone-proximity trigger). Can never fail (the user's "this
	  should always be happening no matter what"): saturation is a
	  preference for a voluntary move, not a veto on a reaction. It prefers an open neighbour; if
	  both are full, it takes the one with the most headroom (count - cap, i.e. least over-full),
	  ties at random. A drone always has at least one neighbour (levels 1 and 5 have exactly one),
	  so this only returns false if BASE_DRONE_LEVELS were 1. The resulting overflow is transient -
	  the ledger can now transiently exceed a cap, which was already true of a cross's landing on
	  level 1 - and it drains through the 'home'/'sort' paths below, which still respect caps
	  (except while `homing` - see below). Writes orbRTarget immediately and lets the orbit field's
	  own lean produce the sharp reactive turn (BASE_DRONE_LEAN_SCALE/HIT_TURN).

	  'home' - the post-swoosh climb back to BASE_DRONE_LEVEL_HOME (case 1.4's `homing` state). A
	  voluntary move is normally a preference: it respects the per-centre saturation
	  cap and does nothing - leaving the cooldown alone, so the caller retries later - if its one
	  directed neighbour is saturated. While `drone.homing` is set, the cap is bypassed instead: a
	  scripted return must not be able to stall behind a full level 2.

	  'sort' - the per-centre binomial sorter (rooms/Room.js's tickDroneCentres()).
	  The caller has already checked there is a deficit in the direction it wants to move, so this
	  never checks the cap either - only the proximity guard (a planned arc only makes sense from
	  the drone's own ring) applies. `dir` (-1/+1) says which neighbour.

	A successful 'home'/'sort' switch plans the whole move as a single quintic Hermite
	(planSwitchArc, below) instead of just writing orbRTarget - position/velocity/head/spd come
	from that curve (case 1.4's `this.switching` branch) until it lands.
*/
function levelSwitch(drone, mode, dir) {
	const levels = drone.levels;
	const lo = drone.level - 1, hi = drone.level + 1;
	const canLo = lo >= 1, canHi = hi <= config.BASE_DRONE_LEVELS;
	const openLo = canLo && levels.count[lo - 1] < levels.caps[lo - 1];
	const openHi = canHi && levels.count[hi - 1] < levels.caps[hi - 1];
	let next = 0;
	if (mode === 'home' || mode === 'sort') {
		// A planned arc only makes sense from the drone's own ring.
		const cx = drone.x - drone.ox, cy = drone.y - drone.oy;
		const r = Math.sqrt(cx * cx + cy * cy) || 1;
		if (Math.abs(r - drone.orbRTarget) > config.BASE_DRONE_LEVEL_GAP / 2) { return false; }
		if (mode === 'home') {
			const toward = drone.level < config.BASE_DRONE_LEVEL_HOME ? hi :
				drone.level > config.BASE_DRONE_LEVEL_HOME ? lo : 0;
			if (toward === lo && (openLo || drone.homing)) { next = lo; }
			if (toward === hi && (openHi || drone.homing)) { next = hi; }
		} else {
			// 'sort': the caller already validated a deficit at this direction - cap-free by design
			//, not just while homing.
			if (dir < 0 && canLo) { next = lo; }
			if (dir > 0 && canHi) { next = hi; }
		}
	} else {
		// A REACTION always moves - prefer an open neighbour; if both are full,
		// take the one with the most headroom, ties at random.
		const pick = [];
		if (openLo) { pick.push(lo); }
		if (openHi) { pick.push(hi); }
		if (!pick.length) {
			const headroom = (n) => levels.count[n - 1] - levels.caps[n - 1];
			if (canLo && canHi) {
				const h = headroom(lo) - headroom(hi);
				if (h < 0) { pick.push(lo); } else if (h > 0) { pick.push(hi); } else { pick.push(lo, hi); }
			} else if (canLo) { pick.push(lo); } else if (canHi) { pick.push(hi); }
		}
		if (pick.length) { next = pick[Math.floor(Math.random() * pick.length)]; }
	}
	if (!next) { return false; }
	levels.count[drone.level - 1]--;
	levels.count[next - 1]++;
	drone.level = next;
	drone.orbRTarget = drone.room.levelR(next);
	drone.switchCooldown = BASE_DRONE_SWITCH_COOLDOWN;
	drone.levelTimer = BASE_DRONE_LEVEL_RELAX;
	if (mode === 'home' || mode === 'sort') { planSwitchArc(drone, drone.orbRTarget); }
	// Clear the moment level reaches HOME, not when the arc it's still flying
	// happens to finish - case 1.4's trigger block that would otherwise clear it is gated on
	// `!switching`, which stays true for ~76 more ticks after this. eligible() already excludes a
	// mid-switching drone regardless, so clearing here costs the sorter nothing early.
	if (mode === 'home' && next === config.BASE_DRONE_LEVEL_HOME) { drone.homing = 0; }
	return true;
}

/*
	Builds a 'home'/'sort' switch's planned arc: a shallow quintic-Hermite sweep
	leaning BASE_DRONE_SWITCH_LEAN (10 degrees) off the tangent, landing at the new level's radius
	exactly tangential and at cruise speed - the same seam trick the cross's exit already uses, so
	the hand-off back to the orbit field is exact (the field computes zero dHead/dSpd on the first
	post-arc tick). Naming the LEAN (not a fraction of the circumference, the old
	BASE_DRONE_SWITCH_ARC) is what makes this the same 76-tick motion at every level - see
	lib/config.js's comment.
*/
function planSwitchArc(drone, r1) {
	const cx = drone.x - drone.ox, cy = drone.y - drone.oy;
	const r0 = Math.sqrt(cx * cx + cy * cy) || 1;
	const theta0 = Math.atan2(cy, cx);
	const dtheta = config.BASE_DRONE_LEVEL_GAP / (Math.tan(config.BASE_DRONE_SWITCH_LEAN) * r0) * drone.spin;
	const theta1 = theta0 + dtheta;
	const u1x = Math.cos(theta1), u1y = Math.sin(theta1);
	const tx = -u1y * drone.spin, ty = u1x * drone.spin;

	const P1x = drone.ox + u1x * r1, P1y = drone.oy + u1y * r1;
	const V1x = tx * BASE_DRONE_ORBIT_SPEED, V1y = ty * BASE_DRONE_ORBIT_SPEED;
	const a1mag = BASE_DRONE_ORBIT_SPEED * BASE_DRONE_ORBIT_SPEED / r1;
	const A1x = -u1x * a1mag, A1y = -u1y * a1mag;

	drone.switchP0x = drone.x; drone.switchP0y = drone.y;
	drone.switchV0x = drone.vec.x; drone.switchV0y = drone.vec.y;
	drone.switchA0x = drone.vec.x - drone.pvec.x; drone.switchA0y = drone.vec.y - drone.pvec.y;
	drone.switchP1x = P1x; drone.switchP1y = P1y;
	drone.switchV1x = V1x; drone.switchV1y = V1y;
	drone.switchA1x = A1x; drone.switchA1y = A1y;
	const meanR = (r0 + r1) / 2;
	drone.switchDur = Math.max(3, Math.round(Math.hypot(meanR * Math.abs(dtheta), r1 - r0) / BASE_DRONE_ORBIT_SPEED));
	drone.switchT = 0;
	drone.switching = true;
}

class Bullet {
	constructor(origin, x, y, direction, speed, exitSpeed, room) {
		this.BUFF = {
			timestamp: -1,
		};
		this.id = 0;
		this.room = room;
		this.origin = origin;
		this.class = 0;
		this.life = tick.ticks(107);   // 107 = 130 one-time-rescaled from the 33ms reference
		this.team = 0;
		this.type = 0;
		this.pene = 1;
		// `weight` is knockback dealt to a TANK (entities/Player.js's bullet arm reads it);
		// `push` is this bullet's own bounce off whatever it hit, read only by the three
		// self-push sites in collision() below. Two different things, two different columns
		// in public/SHARE/TanksConfig.js - see that file's header.
		this.weight = 0;
		this.push = 0;
		this.damage = 0;
		this.size = 10;
		this.x = x;
		this.y = y;
		this.alpha = 1;
		this.map = {};
		this.map.width = 10000;
		this.map.height = 10000;
		this.dir = direction;
		this.showDir = 0;
		this.maxspeed = speed;
		this.speed = speed;
		this.destroy = 0;
		// The muzzle kick: a single impulse of `exitSpeed` reference ticks' worth of thrust,
		// decayed by the tail's own BODY_FRICTION from here on. A one-time impulse against a bare
		// `position += vec` is already TICK_MS-invariant (it integrates only once over ticks), so
		// it keeps tick.perTick() and divides the cruise term's own rescale back out - see
		// SPEED_RESCALE above. `exitSpeed` itself is therefore unchanged in TanksConfig.js.
		this.vec = new Vec(tick.perTick(speed / SPEED_RESCALE) * exitSpeed, 0).rotate(direction);
	}
	collision(other, option = {}) {
		if (option.type) {
			switch (option.type) {
				case 'god':
					if (this.origin.oId === other.id.oId) {
						return;
					}
					// One impulse per tick of contact, decayed by the tail's BODY_FRICTION - the same
					// already-invariant shape as the muzzle kick, so it stays perTick and divides
					// the cruise term's rescale back out of its `speed` half (SPEED_RESCALE above).
					{
						const push = tick.perTick(this.speed / SPEED_RESCALE * 2 + 0.91418);
						this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(push, push)));
					}
					return;
			}
		}
		if (option.base) {
			this.destroy = tick.DES;
		}
		if (other) {
			switch (other.kind) {
				case KIND.PLAYER:
					if (option.noDam) { break; }
					if (this.origin.oId === other.id.oId) {
						return;
					}
					// The wiki's "body damage" half of a polygon boss provoking a base - recorded on the shared
					// per-centre ledger, so the whole base engages
					// it, not just the drone that got hit.
					if (this.type === 1.4 && other.boss) {
						this.levels.provoked = other.id.oId;
						this.levels.provokedAt = this.room.timestamp;
					}
					this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.perTick(this.push), tick.perTick(this.push))));
					// A bullet's health is spent against the TARGET's damage output (PENDING #18,
					// plan.md step 9 - diep's own "3 laws" reciprocal collision rule), not against
					// itself. Previously only base drones (type 1.4) worked this way, because a
					// drone's pene IS a 2000-point health pool rather than a spend-down budget and the
					// old self-referential pene/5 would have killed one in five ticks of contact - that
					// reasoning turns out to generalize to every bullet, so the ordinary branch is gone
					// and both read the same rule now. PROJECTILE_BODY_DAMAGE applies the wiki's other
					// pinned body-damage rule alongside it: a tank's body damage is 75% weaker against a
					// projectile than the raw `this.damage` it was reading here (PENDING #18).
					this.pene -= tick.perTick(other.damage * PROJECTILE_BODY_DAMAGE);
					if (this.pene <= 0) { this.destroy = tick.DES }
					break;
				case KIND.OBJECTS:
					this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.perTick(this.push), tick.perTick(this.push))));
					/*
						Shape-hit reaction: ALWAYS costs the drone a level, even if it
						cannot be paid right now - not a knockback; ORBIT ignores this.vec entirely (it
						writes position directly), so the vec.add() above is a no-op for a drone in
						ORBIT. If the drone is mid-'home'/'sort'-arc or on cooldown, the reaction is
						latched into reactPending and paid the moment it is free (case 1.4's trigger
						block), rather than dropped the way it used to be. Mid-swoosh is the one
						exception and it is deliberate: the drone ploughs straight through, and its
						landing on level 1 IS its level change, so the cross's own exit clears the
						latch. Damage and shove above are outside all of this, unchanged - this still
						fires on the tick the drone kills the shape.
					*/
					if (this.type === 1.4 && !this.crossing) { this.reactPending = 1; }
					if (this.necro && other.type === 'sqr') {
						const play = this.room.INSTANCE.players.get(this.origin.oId);
						if (play.droneCount < CLASS[play.class].maxDrone + play.upNb[1]) {
							play.droneCount++;
							const Bull = new Bullet(play.id, other.x, other.y, Math.random() * Math.PI * 2, play.up.BSpeed * play.necro.speed, 0, this.room);
							Bull.type = play.necro.type;
							Bull.class = play.class;
							Bull.necro = play.necro.necro;
							Bull.pene = play.up.BPene * play.necro.pene;
							Bull.life = -1;
							Bull.damage = play.up.BDamage * play.necro.damage;
							Bull.size = other.size;
							Bull.weight = play.necro.weight;
							Bull.push = play.necro.push;
							play.room.createBullet(Bull, play);
							return;
						}
					}
					// Same rule as the KIND.PLAYER arm above (PENDING #18, plan.md step 9): spent
					// against the shape's own damage output, not self-referentially, and at the same
					// -75%-vs-projectiles rate - shapes have Body Damage too (diep_wiki/Stats.txt).
					this.pene -= tick.perTick(other.damage * PROJECTILE_BODY_DAMAGE);
					if (this.pene <= 0) { this.destroy = tick.DES }
					break;
				case KIND.BULLET:
					if (other.origin.oId === this.origin.oId) {
						if ((parseInt(this.type) === 1 || parseInt(this.type) === 3) && this.type === other.type) {
							this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.perTick(this.push), tick.perTick(this.push))));
						}
						return;
					} else {
					}
					// Same-team protection is what keeps this off a drone and its own side: rooms/Room.js sets noDam on
					// both sides of any same-team, non-Objects pair when rules.teamPlay is on
					// (both team modes), and that check runs before this decrement and before
					// every vec.add() above - so friendly fire and friendly knockback both stay
					// off for a drone and its own side.
					if (option.noDam) { break; }
					// The wiki's "drone damage" half of a polygon boss provoking a base - one map lookup on the
					// tick a base drone is actually shot, which is
					// not a hot path.
					if (this.type === 1.4) {
						const shooter = this.room.INSTANCE.players.get(other.origin.oId);
						if (shooter && shooter.boss) {
							this.levels.provoked = shooter.id.oId;
							this.levels.provokedAt = this.room.timestamp;
						}
					}
					this.pene -= tick.perTick(option.pene);
					if (this.pene <= 0) { this.destroy = tick.DES; }
					break;
				case KIND.WALL:
					// Drones die instantly on contact instead of bouncing (diep_wiki, PENDING #26) -
					// no physics, no pene drain (a wall deals no body damage either way).
					if (this.type === 1.4) {
						this.destroy = tick.DES;
						break;
					}
					{
						const sepX = this.x - other.x, sepY = this.y - other.y;
						const sepD = Math.sqrt(sepX * sepX + sepY * sepY) || 1;
						const nx = sepX / sepD, ny = sepY / sepD;
						const vn = this.vec.x * nx + this.vec.y * ny;
						const tx = this.vec.x - nx * vn, ty = this.vec.y - ny * vn;
						// Same shape as entities/Player.js's own KIND.WALL arm: WALL_BOUNCE is
						// dimensionless and applied directly to this live vn read, no
						// tick.impulse()/tick.perTick() wrapping needed (PENDING nuance 39).
						const newVn = (vn < 0) ? -vn * WALL_BOUNCE : vn;
						this.vec.x = nx * newVn + tx * WALL_FRICTION;
						this.vec.y = ny * newVn + ty * WALL_FRICTION;
					}
					break;
			}
		}
		if (this.destroy && this.life === -1) {
			const play = this.room.INSTANCE["players"].get(this.origin.oId);
			if (play) {
				play.droneCount--;
			}
		}
	}
	update() {
		if (this.destroy > 1) {
			this.x += this.vec.x;
			this.y += this.vec.y;
			this.destroy -= 1;
			this.alpha = (this.destroy) / tick.DES;
			this.size *= tick.drag(1.03648);   // one-time-rescaled from 1.03 (33ms ref)
			return;
		}
		///
		let play;
		if (!this.alone) {
			play = this.room.INSTANCE.players.get(this.origin.oId);
			if (typeof play === "undefined") {
				this.destroy = tick.DES;
				return;
			} else {
				if (play.destroy > 1 || play.dead || play.state.disconnect || play.class !== this.class) {
					this.destroy = tick.DES;
					return;
				}
			}
		}
		///
		switch (this.type) {
			case 0: break;
			//normal//drone
			case 1: {
				this.showDir = this.dir;
				if (!this.comingDir) {
					this.comingDir = 0;
				}
				this.speed = this.maxspeed;
				///
				if (!this.DETEC) {
					this.DETEC = new Detector(play, this.x, this.y, 300, [KIND.PLAYER, KIND.OBJECTS])
					this.DETEC.team = this.team
				} else {
					this.DETEC.x = this.x;
					this.DETEC.y = this.y;
				}
				///
				if (play.inputs.mouseR) {
					const dir = Math.PI + Math.atan2((play.y + play.inputs.mouse_y) - this.y, play.x + play.inputs.mouse_x - this.x)
					this.dir = dir;
				} else if (play.inputs.mouseL || play.inputs.e) {
					const dir = Math.atan2((play.y + play.inputs.mouse_y) - this.y, play.x + play.inputs.mouse_x - this.x)
					this.dir = dir;
				} else {
					if (this.DETEC.select) {
						this.DETEC.enabled = 0;
						const other = this.DETEC.select;
						const dis = Math.sqrt(Math.pow(this.x - other.x, 2) + Math.pow(this.y - other.y, 2));
						const playdis = Math.sqrt(Math.pow(other.x - play.x, 2) + Math.pow(other.y - play.y, 2));
						if (dis < 300 && !other.destroy && playdis < play.screen / 4 && other.alpha) {
							this.dir = Math.atan2(other.y - this.y, other.x - this.x);
							break;
						} else {
							this.DETEC.reset();
							this.DETEC.enabled = 1;
						}
					}
					const playDis = Math.sqrt(Math.pow(this.x - play.x, 2) + Math.pow(this.y - play.y, 2))
					if (playDis < play.size * 3.5) {
						this.speed = 0.117008;   // .08 one-time-rescaled, then x SPEED_RESCALE (top of file)
						if (Math.random() < REAIM_CHANCE) {
							this.comingDir += Math.PI / 2;
						}
						const dir = Math.atan2(play.y + Math.sin(play.autoDir * 2 + this.comingDir) * play.size * 3 - this.y,
							play.x + Math.cos(play.autoDir * 2 + this.comingDir) * play.size * 3 - this.x);
						this.dir = dir;
						break;
					}
					const dir = Math.atan2((play.y) - this.y, play.x - this.x)
					this.dir = dir;
					this.comingDir = this.dir;
				}
				break;
			};
			//xcontrol//
			case 1.1: {
				this.showDir = this.dir;
				if (!this.comingDir) {
					this.comingDir = 0;
				}
				this.speed = this.maxspeed;
				if (play.droneCount === -1) {
					this.destroy = tick.DES;
				}
				///
				if (!this.DETEC) {
					this.DETEC = new Detector(play, this.x, this.y, 300, [KIND.PLAYER, KIND.OBJECTS])
					this.DETEC.team = this.team
				} else {
					this.DETEC.x = this.x;
					this.DETEC.y = this.y;
				}
				///
				if (this.DETEC.select) {
					this.DETEC.enabled = 0;
					const other = this.DETEC.select;
					const dis = Math.sqrt(Math.pow(this.x - other.x, 2) + Math.pow(this.y - other.y, 2));
					const playdis = Math.sqrt(Math.pow(other.x - play.x, 2) + Math.pow(other.y - play.y, 2));
					if (dis < 300 && !other.destroy && playdis < play.screen / 4 && other.alpha) {
						this.dir = Math.atan2(other.y - this.y, other.x - this.x);
						break;
					} else {
						this.DETEC.reset();
						this.DETEC.enabled = 1;
					}
				}
				const playDis = Math.sqrt(Math.pow(this.x - play.x, 2) + Math.pow(this.y - play.y, 2))
				if (playDis < play.size * 3) {
					this.speed = 0.117008;   // .08 one-time-rescaled, then x SPEED_RESCALE (top of file)
					if (Math.random() < REAIM_CHANCE) {
						this.comingDir += Math.PI / 2;
					}
					const dir = Math.atan2(play.y + Math.sin(play.autoDir * 2 + this.comingDir) * play.size * 3 - this.y,
						play.x + Math.cos(play.autoDir * 2 + this.comingDir) * play.size * 2.5 - this.x);
					this.dir = dir;
					break;
				}
				const dir = Math.atan2((play.y) - this.y, play.x - this.x)
				this.dir = dir;
				this.comingDir = this.dir;
				break;
			};
			//battleShip xcontrol//
			case 1.2: {
				this.showDir = this.vec.angle();
				this.speed = this.maxspeed;
				///
				if (!this.DETEC) {
					this.DETEC = new Detector(play, this.x, this.y, 1400, [KIND.PLAYER, KIND.OBJECTS])
					this.DETEC.team = this.team
				} else {
					this.DETEC.x = this.x;
					this.DETEC.y = this.y;
				}
				///
				if (this.DETEC.select) {
					this.DETEC.enabled = 0;
					const other = this.DETEC.select;
					if (!other.destroy && other.alpha) {
						this.dir = Math.atan2(other.y - this.y, other.x - this.x);
						break;
					} else {
						this.DETEC.reset();
						this.DETEC.enabled = 1;
					}
				}
				break;
			};
			//battleShip control//
			case 1.3: {
				this.showDir = this.vec.angle();
				///
				if (play.inputs.mouseR) {
					const dir = Math.PI + Math.atan2((play.y + play.inputs.mouse_y) - this.y, play.x + play.inputs.mouse_x - this.x)
					this.dir = dir;
				} else {
					const dir = Math.atan2((play.y + play.inputs.mouse_y) - this.y, play.x + play.inputs.mouse_x - this.x)
					this.dir = dir;
				}
				break;
			};
			/*
				Base drone. Outside a cross or a 'home'/'sort' switch arc, heading (`head`) and speed
				(`spd`) are authoritative and rate-limited (BASE_DRONE_TURN or BASE_DRONE_CHASE_TURN
				while chasing / BASE_DRONE_ACCEL); position is their integral - every state below
				only has to produce a desired direction and a target speed, and the shared steering
				tail slews toward both and writes position, so a transition between them is
				continuous by construction. A cross and a level-switch arc are the two exceptions:
				position comes from a planned quintic Hermite curve instead, matched to this same
				steering field at both seams, so the hand-off in and out of either is exact.

				`this.chasing`, `this.crossing` and `this.switching` are the three real branches;
				ORBIT/RETURN are one "orbit field" driven off (x,y) relative to the base centre
				(ox,oy) - a drone far from its ring leans harder toward it (BASE_DRONE_LEAN_MAX) and
				curls onto it as the error shrinks, so there is no separate RETURN state, though its
				cruise-to-dash speed blend (below) does make a long return a real sprint again
. Radius itself only ever moves in whole BASE_DRONE_LEVEL_GAP steps
				via levelSwitch() (module scope, above) - the field here just steers toward whichever
				radius the level table currently names. `this.orbitState` is written purely for
				tests/admin - nothing branches on it.

				Detection is centralised per orbit centre now: only the current
				SCOUT's own DETEC is enabled (rooms/Room.js's tickDroneCentres() rotates it), so a
				found target is written to the shared `levels.threat` instead of being read straight
				off `this.DETEC.select` - every drone at the centre reads `levels.threat` to decide
				whether to start a chase, and copies it into its own `DETEC.select` at that moment so
				the chase's own per-tick leash check (below) keeps working exactly as before,
				whichever drone happens to be scout.
			*/
			case 1.4: {
				if (this.switchCooldown > 0) { this.switchCooldown--; }
				///
				this.DETEC.x = this.x;
				this.DETEC.y = this.y;
				// The current scout (rooms/Room.js's tickDroneCentres()) mirrors whatever it finds
				// into the shared per-centre ledger - every drone at the centre
				// reads this, not just the scout, to decide whether to start a chase. `threatAt` is the room
				// timestamp of this sighting - this is the ONLY writer of either
					// field, so rooms/Room.js's tickDroneCentres() is what expires them again.
				if (this.DETEC.enabled && this.DETEC.select) {
					const t = this.DETEC.select;
					// Polygon bosses are ignored until they start it (basedrones.txt: base drones "usually don't
					// target Polygon-based Bosses ...
					// unless those provoke them first via body damage or drone damage"). Gated HERE,
					// at the one place a target enters the shared ledger, so the whole centre agrees
					// rather than each drone re-deciding. `fallen` is the hook for the Fallen bosses,
					// which the wiki says ARE engaged on sight - nothing sets it today because we
					// only ship the Summoner.
					if (!t.boss || t.fallen || this.levels.provoked === t.id.oId) {
						this.levels.threat = t;
						this.levels.threatAt = this.room.timestamp;
					}
				}
				// A live, in-leash target pulls the drone into CHASE from any state but a cross
				// (abandoning a planned curve mid-flight is the one thing that can
				// reintroduce a velocity discontinuity). A 'home'/'sort' switch arc IS interrupted by
				// a chase - only C1-lossy, not C0, since head/spd come from the
				// curve every tick right up to the interrupting one. The leash is measured from the
				// base centre, not the drone, so a drone already out chasing doesn't get an easier
				// time re-engaging than one starting fresh off the ring.
				if (!this.chasing && !this.crossing && this.levels.threat) {
					const other = this.levels.threat;
					const basedis = Math.sqrt(Math.pow(other.x - this.ox, 2) + Math.pow(other.y - this.oy, 2));
					if (basedis < config.BASE_DRONE_LEASH && !other.destroy) {
						this.chasing = true;
						this.switching = false;
						// Keep a private reference - only ACQUIRING a target is
						// centralised through levels.threat; the chase itself still reads its own
						// detector's own reference every tick below, exactly as before, whether or
						// not this drone happens to be the current scout.
						this.DETEC.select = other;
						this.DETEC.enabled = 0;
					}
				}
				if (this.chasing) {
					const other = this.DETEC.select;
					const basedis = other ? Math.sqrt(Math.pow(other.x - this.ox, 2) + Math.pow(other.y - this.oy, 2)) : Infinity;
					// A base drone follows a live target exactly as far into the dark OOB band as a
					// player may run; only death or the leash ends a chase. Deliberately NOT also gated on
					// "the target is past my own clamp box": DETEC.type is [KIND.PLAYER] and
					// entities/Player.js's motion() clamps a Player to EXACTLY that same box, so at
					// equality such a test can only be dead or wrong. Widening
					// it to >= would make a player standing on the OOB wall permanently
					// un-chaseable, which is the opposite of the wiki's "impossible to linger
					// around a base".
					if (!other || other.destroy || basedis >= config.BASE_DRONE_LEASH) {
						this.chasing = false;
						this.DETEC.reset();
						// The return starts on THIS tick (the user's requirement is
						// that a drone heads home the instant a pursuit ends and lingers nowhere, least
						// of all at the arena edge). `head` is still pointing at wherever the chase left
						// it, so without this the drone flies up to a 180-degree turn's worth FURTHER
						// OUT before it is even moving homeward - measured, r climbing 1384 -> 1439 over
						// the first 20 ticks after a drop - and against the map clamp it does that turn
						// pressed on the boundary. A chase ending is already a hard state change, so the
						// heading changes with it rather than being slewed to over the next half second.
						// Snapping onto the FIELD's direction rather than "at the orbit centre" is what
						// makes it correct in both directions: a chase that ended inside the ring turns
						// outward, one that ended far outside turns near-radially in (the lean saturates
						// at BASE_DRONE_LEAN_MAX, atan(8) = 83 degrees, i.e. 7 degrees off pure radial).
						// Deliberately discontinuous in `head`; `spd` is untouched, so the drone leaves
						// at whatever dash speed it was chasing at.
						const f = orbitDesired(this);
						this.head = Math.atan2(f.dy, f.dx);
					}
				}
				// Level-switch triggers: (a) a latched shape-hit reaction
				// (`reactPending`, set by the KIND.OBJECTS collision arm above), (b) drone-vs-drone
				// proximity (`tooClose`, set by rooms/Room.js's pair loop, itself folded into
				// reactPending here), and (c) the post-swoosh climb back to home (`homing`) - all
				// funnelled through the one levelSwitch(). A reaction can no longer fail, so this
				// block only ever decides WHEN it is paid, never whether: mid-cross/mid-chase/
				// mid-switch, it stays latched instead of being dropped, and fires the instant the
				// drone is free and off cooldown. The general "drift back toward home on a timer"
				// trigger is GONE - the per-centre binomial sorter
				// (rooms/Room.js's tickDroneCentres()) is the restoring force for every drone that
				// isn't actively climbing home post-swoosh; leaving both in place would fight (the
				// sorter spreading drones onto 1/2/4/5, the drift timer immediately pulling them
				// back to 3).
				if (!this.crossing && !this.chasing && !this.switching) {
					if (this.tooClose) { this.tooClose = 0; this.reactPending = 1; }
					if (this.reactPending && this.switchCooldown <= 0) {
						this.reactPending = 0;
						levelSwitch(this, 'random');
					}
					if (this.homing) {
						if (this.level !== config.BASE_DRONE_LEVEL_HOME) {
							if (--this.levelTimer <= 0) {
								levelSwitch(this, 'home');
								this.levelTimer = BASE_DRONE_LEVEL_RELAX;
							}
						} else {
							this.homing = 0;
							this.levelTimer = BASE_DRONE_LEVEL_RELAX;
						}
					}
				} else {
					// A tooClose noticed mid-curve or mid-chase becomes a pending reaction instead of
					// being thrown away - it is paid out the moment the drone is free again. Mid-cross
					// is the one exception: the cross's own landing on level 1 IS the level change, so
					// nothing should also fire the instant it lands.
					if (this.tooClose) { this.tooClose = 0; if (!this.crossing) { this.reactPending = 1; } }
				}
				// The diameter cross: triggered here, evaluated below as a
				// table read. Suppressed while chasing/switching - crossIn only ever counts down in
				// this branch, so a 'home'/'sort' arc in flight keeps its place in the queue exactly
				// the way `levels.crossing` already makes a blocked drone keep its place - and gated
				// by `levels.crossing < levels.crossCap` (each orbit centre allows
				// up to `crossCap` concurrent crossers, sized from measured demand rather than fixed
				// at one, so a busy 4team base doesn't serialise every drone's ~10s cadence through a
				// single lane): a drone whose crossIn has expired only actually starts when its
				// centre has a free lane.
				// ... and only from its own ring: planCross() builds the entry seam
				// from the centripetal acceleration of the circle the drone is currently flying, which
				// is meaningless for one sprinting radially home off a chase - measured, crosses
				// launching from r=1300 against a 168-280 level table, which is most of what "some
				// drones don't return properly" was. Same tolerance levelSwitch() uses for its own
				// planned arcs. `crossIn` still counts down while off-ring (it goes negative and keeps
				// its place in the queue exactly the way a blocked `crossCap` lane already does), so
				// nothing is lost, only deferred.
				const crossR = Math.sqrt((this.x - this.ox) * (this.x - this.ox) + (this.y - this.oy) * (this.y - this.oy));
				if (!this.chasing && !this.crossing && !this.switching && --this.crossIn <= 0 &&
					this.levels.crossing < this.levels.crossCap &&
					Math.abs(crossR - this.orbRTarget) <= config.BASE_DRONE_LEVEL_GAP / 2) {
					planCross(this);
					this.levels.crossing++;
				}
				///
				if (this.crossing) {
					const p = this.crossTbl[this.crossT++];
					// Position, velocity AND head/spd all come from the table - writing head/spd
					// (rather than leaving them stale) is what makes the exit seamless, since the
					// shared steering tail resumes from exactly the state the curve ended in.
					this.x = p.x; this.y = p.y;
					this.vec.x = p.vx; this.vec.y = p.vy;
					this.head = Math.atan2(p.vy, p.vx);
					this.spd = Math.hypot(p.vx, p.vy);
					this.showDir = this.dir = this.head;
					this.orbitState = 'CROSS';
					if (this.crossT >= this.crossTbl.length) {
						// Lands at level 1 by construction, ignoring saturation deliberately - a swoosh always ends
						// at the lowest level, so count[0] may
						// transiently exceed caps[0]; only voluntary switches into level 1 respect
						// the cap, so the excess only ever drains.
						this.crossing = false;
						this.crossIn = BASE_DRONE_CROSS;
						this.levels.crossing--;
						this.levels.count[this.level - 1]--;
						this.level = 1;
						this.levels.count[0]++;
						this.orbRTarget = this.room.levelR(1);
						this.levelTimer = BASE_DRONE_LEVEL_RELAX;
						// The swoosh aims the drone back at home: `homing` makes
						// the block above climb 1 -> 2 -> 3 on its own planned arcs, ignoring the
						// saturation cap on the way, and makes the sorter skip this drone until it
						// arrives - it isn't part of the distribution's slack yet.
						this.homing = 1;
						// A reaction taken mid-swoosh sets nothing - the landing on
						// level 1 above IS the level change, so any latch picked up while crossing is
						// cleared here rather than also firing on the very next free tick.
						this.reactPending = 0;
						this.crossTbl = null;
					}
					this.pvec.x = this.vec.x; this.pvec.y = this.vec.y;
					this.clampToMap();
					return;
				}
				// A 'home'/'sort' level switch's planned arc - built once by
				// planSwitchArc() at trigger, evaluated the same way the cross is: position/velocity/
				// head/spd come from the curve until it lands, then control returns to the field
				// below with zero error (V1/A1 were built to match what the field itself produces at
				// the landing point).
				if (this.switching) {
					this.switchT++;
					const s = Math.min(1, this.switchT / this.switchDur);
					const segX = quinticHermite(s, this.switchDur, this.switchP0x, this.switchV0x, this.switchA0x, this.switchP1x, this.switchV1x, this.switchA1x);
					const segY = quinticHermite(s, this.switchDur, this.switchP0y, this.switchV0y, this.switchA0y, this.switchP1y, this.switchV1y, this.switchA1y);
					this.x = segX.p; this.y = segY.p;
					this.vec.x = segX.v; this.vec.y = segY.v;
					this.head = Math.atan2(this.vec.y, this.vec.x);
					this.spd = Math.hypot(this.vec.x, this.vec.y);
					this.showDir = this.dir = this.head;
					this.orbitState = 'ORBIT';
					if (this.switchT >= this.switchDur) { this.switching = false; }
					this.pvec.x = this.vec.x; this.pvec.y = this.vec.y;
					this.clampToMap();
					return;
				}
				///
				let dx, dy, targetSpeed, turnLimit, r = 0;
				if (this.chasing) {
					// Pure pursuit, deliberately: aim at where the target IS, this tick. No lead, no
					// interception, no destination prediction.
					const other = this.DETEC.select;
					dx = other.x - this.x;
					dy = other.y - this.y;
					targetSpeed = BASE_DRONE_CHASE_SPEED;
					turnLimit = BASE_DRONE_CHASE_TURN;
				} else {
					// The orbit field: tangential, with a radial lean toward orbRTarget. Never
					// normalised - only its angle feeds the turn limiter below, so a saturated lean
					// just steers straighter at the ring, it never changes target speed. Radius
					// (orbRTarget) itself only ever moves in discrete LEVEL_GAP steps, via
					// levelSwitch() above and in collision() - this field just steers toward
					// whichever target the level table currently says. Lives in orbitDesired() at
					// module scope because the chase-drop block above and
					// clampToMap()'s corner fallback snap `head` onto this same vector.
					const f = orbitDesired(this);
					dx = f.dx; dy = f.dy; r = f.r;
					const err = f.err;
					// Speed is a smoothstep blend from cruise toward the dash speed, keyed on how far
					// off its ring the drone is - a return is a chase back to the
					// ring, so it runs at the same speed, easing to cruise as it arrives rather than
					// snapping or ringing around the target radius.
					const e = Math.min(1, Math.abs(err) / config.BASE_DRONE_RETURN_ERR);
					const k = e * e * (3 - 2 * e);
					targetSpeed = BASE_DRONE_ORBIT_SPEED + (BASE_DRONE_CHASE_SPEED - BASE_DRONE_ORBIT_SPEED) * k;
					// Speed and turn rate blend on the SAME k. They used not to: a
					// returning drone ran at the 400 u/s dash under the 2.5 rad/s ORBIT limiter, i.e. a
					// 160-unit turn radius against a 224-unit home ring, which is what made a long
					// return swing wide and overshoot. Blended, the turn radius (v/omega) holds at
					// 34-60 units in every state.
					turnLimit = BASE_DRONE_TURN + (BASE_DRONE_CHASE_TURN - BASE_DRONE_TURN) * k;
				}
				// Descriptive only (tests/admin dump) - nothing above or below branches on this.
				// Shares the orbit branch's own `r` rather than recomputing it;
				// when chasing the ternary short-circuits before `r` (left at 0) is ever read.
				this.orbitState = this.chasing ? 'CHASE' : (r > this.orbRTarget * 1.5 ? 'RETURN' : 'ORBIT');
				// Shared steering tail: slew heading and speed toward the state's desired
				// direction/target speed, then integrate. Every state above funnels through this,
				// which is what makes every transition C1 with no state able to stop or snap it.
				// CHASE gets its own, much tighter turnLimit (BASE_DRONE_CHASE_TURN) - see
				// lib/config.js's comment for why a faster dash needs a tighter limiter, not a
				// looser one - and a RETURN blends up toward it on the same k as its speed
				//, so the two can never come apart.
				const desired = Math.atan2(dy, dx);
				let dHead = Math.atan2(Math.sin(desired - this.head), Math.cos(desired - this.head));
				dHead = Math.max(-turnLimit, Math.min(turnLimit, dHead));
				this.head += dHead;
				let dSpd = targetSpeed - this.spd;
				dSpd = Math.max(-BASE_DRONE_ACCEL, Math.min(BASE_DRONE_ACCEL, dSpd));
				this.spd += dSpd;
				this.vec.x = Math.cos(this.head) * this.spd;
				this.vec.y = Math.sin(this.head) * this.spd;
				this.x += this.vec.x;
				this.y += this.vec.y;
				this.showDir = this.dir = this.head;
				this.pvec.x = this.vec.x; this.pvec.y = this.vec.y;
				this.clampToMap(true);
				return;
			};
			///////////////trap
			case 2: {
				if (!this.first) {
					this.first = 1;
					this.showDir = Math.random() * Math.PI * 2;
					// A one-time bump to the cruise thrust, so it is denominated in `speed`'s own
					// per-reference-tick units and takes no tick.perTick() of its own - the tail's
					// tick.quadratic() applies the scale. The number is unchanged: dropping the
					// perTick() and applying SPEED_RESCALE cancel exactly. .2 one-time-rescaled
					// against the trap's own .82 decay, not BODY_FRICTION.
					this.speed += Math.random() * 0.17916;
				}
				// NOT tick.perTick(): with the motion tail below corrected, this.vec is a
				// per-REAL-tick displacement, so it already carries the tick scale and a second one
				// would spin the trap faster on a finer tick. 160 = 100 * SPEED_RESCALE, which
				// leaves the spin rate at the live TICK_MS exactly where it was.
				this.showDir += this.vec.length() / 160;
				this.speed *= tick.drag(0.7862);   // .82 one-time-rescaled (33ms ref)
				break;
			}
			///////////////square
			case 3: {
				this.showDir = this.dir;
				if (!this.comingDir) {
					this.comingDir = 0;
				}
				this.speed = this.maxspeed;
				///
				if (!this.DETEC) {
					this.DETEC = new Detector(play, this.x, this.y, 300, [KIND.PLAYER, KIND.OBJECTS])
					this.DETEC.team = this.team
				} else {
					this.DETEC.x = this.x;
					this.DETEC.y = this.y;
				}
				///
				if (play.inputs.mouseR) {
					const dir = Math.PI + Math.atan2((play.y + play.inputs.mouse_y) - this.y, play.x + play.inputs.mouse_x - this.x)
					this.dir = dir;
				} else if (play.inputs.mouseL || play.inputs.e) {
					const dir = Math.atan2((play.y + play.inputs.mouse_y) - this.y, play.x + play.inputs.mouse_x - this.x)
					this.dir = dir;
				} else {
					if (this.DETEC.select) {
						this.DETEC.enabled = 0;
						const other = this.DETEC.select;
						const dis = Math.sqrt(Math.pow(this.x - other.x, 2) + Math.pow(this.y - other.y, 2));
						const playdis = Math.sqrt(Math.pow(other.x - play.x, 2) + Math.pow(other.y - play.y, 2));
						if (dis < 300 && !other.destroy && playdis < play.screen / 4 && other.alpha) {
							this.dir = Math.atan2(other.y - this.y, other.x - this.x);
							break;
						} else {
							this.DETEC.reset();
							this.DETEC.enabled = 1;
						}
					}
					const playDis = Math.sqrt(Math.pow(this.x - play.x, 2) + Math.pow(this.y - play.y, 2))
					if (playDis < play.size * 3.5) {
						this.speed = 0.117008;   // .08 one-time-rescaled, then x SPEED_RESCALE (top of file)
						if (Math.random() < REAIM_CHANCE) {
							this.comingDir += Math.PI / 2;
						}
						const dir = Math.atan2(play.y + Math.sin(play.autoDir * 2 + this.comingDir) * play.size * 3 - this.y,
							play.x + Math.cos(play.autoDir * 2 + this.comingDir) * play.size * 2.5 - this.x);
						this.dir = dir;
						break;
					}
					const dir = Math.atan2((play.y) - this.y, play.x - this.x)
					this.dir = dir;
					this.comingDir = this.dir;
				}
				break;
			};
			///bigCheese
			case 3.1: {
				if (isNaN(this.comingDir)) {
					this.comingDir = Math.PI * 2 * Math.random();
					this.randPos = play.size * (Math.random() * 1 + 2)
				}
				this.showDir = this.vec.angle();
				///
				if (play.detected.length >= 1) {
					let tar, minDis = play.screen;
					for (const n of play.detected) {
						const dis = Math.sqrt(Math.pow(n.x - this.x, 2) + Math.pow(n.y - this.y, 2));
						if (dis <= minDis) {
							minDis = dis;
							tar = n;
						}
					}
					if (tar && !tar.destory) {
						this.speed = this.maxspeed;
						this.dir = Math.atan2(tar.y - this.y, tar.x - this.x);
						break;
					}
				}
				/// else
				const playDis = Math.sqrt(Math.pow(this.x - play.x, 2) + Math.pow(this.y - play.y, 2))
				if (playDis < play.size * 4) {
					this.speed = Math.max(this.speed * tick.drag(0.98789), .08);   // .99 one-time-rescaled (33ms ref); floor is .05 x SPEED_RESCALE
					if (Math.random() < CHARGE_CHANCE) {
						this.comingDir += Math.PI * .8;
						this.speed = this.maxspeed * 2;
					}
					const dir = Math.atan2(play.y + Math.sin(this.comingDir) * this.randPos - this.y,
						play.x + Math.cos(this.comingDir) * this.randPos - this.x);
					this.dir = dir;
					this.comingDir -= tick.perTick(0.01212)   // .01 one-time-rescaled (33ms ref)
				} else {
					const dir = Math.atan2(play.y - this.y, play.x - this.x)
					this.dir = dir;
					this.speed = this.maxspeed;
				}
				///
				break;
			};
		}
		/*
			The shared motion tail every non-base-drone bullet falls through to: a constant thrust
			along `dir`, decayed through BODY_FRICTION, integrated into position.

			tick.quadratic(), NOT tick.perTick(). The thrust is integrated twice over ticks - once
			into this.vec, again into this.x/this.y - which is exactly the category lib/tick.js's
			quadratic() exists for (entities/Objects.js's HOME_PULL is the other current example -
			Player.js's old regen accumulator, hpregan, used to be a third before PENDING #17 replaced
			it). Under perTick() a bullet's total range came out proportional to 1/TICK_MS
			(measured: 955 units at TICK_MS 33 against 1695 at 16, for one class with a lifetime
			that is itself correctly wall-clock-constant); under quadratic() it holds to well
			inside 1% across the same range - asserted, not just reported, by test/rooms.js's
			bulletRangeInvarianceTest().

			entities/Player.js reaches the same recurrence through public/SHARE/Physics.js's
			stepBody(), whose dtTicks scales the velocity add and the position step together.
			Deliberately not reused here: stepBody keeps its velocity per REFERENCE tick, and a
			Bullet's this.vec is per REAL tick everywhere else in this file - the type-1.4 steering
			tail derives it from head/spd, collision() adds knockback impulses to it, and the
			destroy tail coasts on it. Routing only this one line through stepBody would split
			this.vec into two units inside one class. The two forms are algebraically the same
			recurrence (stepBody's vec is this one divided by SCALE), so nothing is lost.
		*/
		this.vec.add(new Vec(tick.quadratic(this.speed), 0).rotate(this.dir))
		this.vec.x *= BODY_FRICTION;
		this.vec.y *= BODY_FRICTION;
		this.x += this.vec.x;
		this.y += this.vec.y;
		///
		if (this.life === -1) {
			this.clampToMap();
			return;
		};
		if (this.life === 0) {
			this.destroy = tick.DES;
		} else {
			this.life -= 1;
		}
	}
	// Hard-stop map clamp for a life===-1 bullet (a base drone). Shared by the ordinary motion
	// tail above and case 1.4's steering tail, which returns before ever
	// reaching that tail. Carries the same config.OOB_MARGIN allowance entities/Player.js's
	// motion() gives a tank - the dark band outside the drawn arena is
	// neutral ground now (rooms/Room.js's inArena()), so a base drone has to be able to follow a
	// target out there exactly as far as a player may run. In practice only a chasing drone ever
	// reaches it: a natural orbit/cross/switch-arc geometry never comes near the map edge (pinned
	// by test/rooms.js) - a clamp firing mid-curve would desync position from the curve.
	// `steered` - only case 1.4's plain ORBIT/CHASE/RETURN tail passes true.
	// Without it, zeroing vec.x/vec.y here had NO EFFECT on a steered drone at all: case 1.4's own
	// tail derives vec FROM head/spd every tick (vec.x = cos(head)*spd) at the START of its next
	// pass, so the zeroed component was overwritten before it was ever read - the clamp just
	// teleported the drone back onto the boundary once a tick, forever, while spd sat at full
	// chase speed (measured: 15 consecutive identical-position ticks at a corner, and a chasing
	// drone pinned dead at (-6412,-6412) indefinitely if the thing it's chasing is beyond the
	// clamp). Steering the HEADING along the wall below is what actually turns that into a slide
	// along the wall instead of a press into it.
	clampToMap(steered = false) {
		const mx = this.map.width / 2 + config.OOB_MARGIN, my = this.map.height / 2 + config.OOB_MARGIN;
		// Which wall, not just "some wall" - the steered branch below has to know
		// which component is actually pressing outward.
		let cx = 0, cy = 0;
		if (this.x < -mx) { this.x = -mx; cx = -1; } else if (this.x > mx) { this.x = mx; cx = 1; }
		if (this.y < -my) { this.y = -my; cy = -1; } else if (this.y > my) { this.y = my; cy = 1; }
		if (!cx && !cy) { return; }
		if (!steered) {
			// Unchanged: an ordinary life=-1 bullet, and case 1.4's cross / switch-arc branches,
			// take their position from elsewhere next tick, so zeroing vec is all this ever did.
			if (cx) { this.vec.x = 0; }
			if (cy) { this.vec.y = 0; }
			return;
		}
		// Steered (case 1.4's ORBIT/CHASE/RETURN tail only): `spd` is authoritative and `vec` is
		// rederived from head/spd at the top of the next pass, so the OLD code's spd = hypot(clamped
		// vec) set spd to exactly 0 at a corner and the drone froze there for up to 14 ticks while
		// `head` slewed away at the leisurely orbit turn rate. Project the HEADING
		// onto the wall instead and leave `spd` alone: the drone slides along the boundary at full
		// speed and the turn limiter takes it from there. Deliberately discontinuous in `head` - it
		// IS a collision, and it is strictly better than the freeze it replaces.
		let hx = Math.cos(this.head), hy = Math.sin(this.head);
		if (cx && hx * cx > 0) { hx = 0; }
		if (cy && hy * cy > 0) { hy = 0; }
		if (!hx && !hy) {
			// Pressed exactly into a corner - there is no along-the-wall direction left, so take the
			// one direction that is always valid and always what we want anyway: the orbit field's
			// own answer to "which way is home" (one expression in the file).
			const f = orbitDesired(this);
			hx = f.dx; hy = f.dy;
			if (!hx && !hy) { hx = -cx || 1; hy = -cy || 0; }
		}
		this.head = Math.atan2(hy, hx);
	}
}

// Type tag for collision / buffer dispatch - see public/SHARE/kinds.js.
Bullet.prototype.kind = KIND.BULLET;

// Standalone geometry helper for rooms/Room.js's per-centre crossCap sizing -
// see estimateCrossTicks() above for what it measures and why it needs no live drone.
Bullet.estimateCrossTicks = estimateCrossTicks;
// One directed, cap-free level-switch step on the gradual arc, for the per-centre binomial sorter
// (rooms/Room.js's tickDroneCentres()) - a thin wrapper so Room.js never reaches
// into this module's own private levelSwitch(). Returns whether the switch actually happened (the
// proximity guard can still say no if the drone isn't on its own ring right now).
Bullet.sortSwitch = function (drone, dir) { return levelSwitch(drone, 'sort', dir); };

module.exports = Bullet;
