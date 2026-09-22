/*
	Bullet - projectiles, including drone / trap / necro behaviour.
	A bullet only ever looks up its own origin's room, so it holds a direct `this.room`
	reference instead of reaching through a registry.
*/
const Vec = require('victor');
const tick = require('../lib/tick.js');
const config = require('../lib/config.js').config;
const CLASS = require('../public/SHARE/TanksConfig.js').class;
// Bullet drag. Separate from the tank's friction constant.
const BODY_FRICTION = tick.drag(require('../lib/constants.js').BODY_FRICTION);
// Deletion-animation brake: a dying projectile halves its speed every reference tick, on
// top of BODY_FRICTION. Applied in update()'s destroy branch, impact deaths only.
const DEATH_DRAG = tick.drag(0.5);
// Friction-order compensation for the cruise thrust in update()'s motion tail.
// Dimensionless - no tick conversion of its own. See lib/constants.js.
const BULLET_CRUISE_ORDER = require('../lib/constants.js').BULLET_CRUISE_ORDER;
// Divisor that recovers the raw muzzle accel from TanksConfig.js's `speed` column.
// Same one Player.js's shoot() uses; Skimmer/Minion sub-shots fire it from here too.
const BULLET_MAINTAIN = require('../lib/constants.js').BULLET_MAINTAIN;
const KIND = require('../public/SHARE/kinds.js');
const World = require('../public/SHARE/World.js');
const Detector = require('./Detector.js');
const { LETHAL_EPS, projectileCommon } = require('../lib/damage.js');

// Skimmer body spin, per reference tick. Drives `showDir` (case 4), not `dir` - `dir`
// stays the straight-line heading so the shot flies straight while the drawn body and
// its sub-barrels spin independently.
const SKIMMER_SPIN = tick.perTick(0.1);

/*
	Factory minion (type 1.5) steering. `showDir` (aim) and `dir` (movement) move independently.
	Aim tracks the cursor on left-click/autofire and points away on right-click; the same three
	movement zones apply either way (outer: toward/away, mid: spiral, inner: star). FOCUS is
	800 du; the inner seam is that radius over sqrt(7).
*/
const MINION_FOCUS = World.gu(16);
const MINION_FOCUS_IN = World.gu(16) / Math.sqrt(7);

/*
	One aggro radius for every drone, measured from the owner (lib/config.js DRONE_AGGRO_FOV).
	A detector only nominates a candidate; the swarm's reach is the tank's FOV, not the tank
	plus whichever ring the drone is sitting on.
*/
const DRONE_AGGRO_FOV = config.DRONE_AGGRO_FOV;
const DRONE_AGGRO_MIN = config.DRONE_AGGRO_MIN;
const DRONE_AGGRO_HYST = config.DRONE_AGGRO_HYST;
// The radius this drone is held to right now. `committed` widens it by HYST - a committed drone
// is exactly one with its detector switched off, so nothing else has to track the distinction.
function droneAggroR(play, committed = false) {
	const r = Math.max(DRONE_AGGRO_MIN, (play.screen || 0) / 2 * DRONE_AGGRO_FOV);
	return committed ? r * DRONE_AGGRO_HYST : r;
}
// Whether `other` is close enough to the OWNER for this drone to engage it at all.
function droneInAggro(play, other, committed = false) {
	const dx = other.x - play.x, dy = other.y - play.y;
	const r = droneAggroR(play, committed);
	return dx * dx + dy * dy < r * r;
}

// One-pass constant-speed lead for auto drone chase (not manual mouse aim).
function droneChaseDir(bullet, other) {
	const ox = other.x - bullet.x, oy = other.y - bullet.y;
	const dist = Math.hypot(ox, oy);
	if (dist < 1) { return Math.atan2(oy, ox); }
	const t = dist / droneTerminal(bullet);
	const vx = other.vec ? other.vec.x : 0, vy = other.vec ? other.vec.y : 0;
	return Math.atan2(oy + vy * t, ox + vx * t);
}

/*
	Base drone orbit AI. Converted once at module load, not per drone per tick.

	Every drone carries `head` (radians) and `spd` (units per real tick), both rate-limited
	toward a per-state desired direction and target speed; position is their integral. True
	for ORBIT/CHASE; a cross or a planned level-switch arc bypasses the limiter and reads a
	precomputed curve instead.

	Radius is quantised into five shared energy levels (rooms/Room.js levelR(1..5)). The only
	mover between levels is levelSwitch(): a shape hit or drone-proximity switch is the sharp
	lean; a home/sort switch is the shallow planned arc (planSwitchArc).

	A diameter cross is a planned curve (arc -> C2 blend -> straight through the centre ->
	C2 blend -> arc), not a steered pursuit. planCross() bakes it into a per-tick table;
	while `crossing`, case 1.4 is just an array read.
*/
const BASE_DRONE_CROSS = tick.ticks(config.BASE_DRONE_CROSS);
const BASE_DRONE_ORBIT_SPEED = tick.perTick(config.BASE_DRONE_ORBIT_SPEED);
const BASE_DRONE_CHASE_SPEED = tick.perTick(config.BASE_DRONE_CHASE_SPEED);
const BASE_DRONE_CROSS_SPEED = tick.perTick(config.BASE_DRONE_CROSS_SPEED);
const BASE_DRONE_TURN = tick.perTick(config.BASE_DRONE_TURN);
// Chase turn limiter. A dash needs a tighter turn radius than orbit or it swings wide.
const BASE_DRONE_CHASE_TURN = tick.perTick(config.BASE_DRONE_CHASE_TURN);
const BASE_DRONE_ACCEL = tick.perTick(config.BASE_DRONE_ACCEL);
const BASE_DRONE_SWITCH_COOLDOWN = tick.ticks(config.BASE_DRONE_SWITCH_COOLDOWN);
const BASE_DRONE_LEVEL_RELAX = tick.ticks(config.BASE_DRONE_LEVEL_RELAX);

/*
	Idle tank-drone orbit (droneIdleOrbit). The BASE_DRONE_* state machine, flown in the
	owner's frame: the drone's state is position and velocity relative to the tank, so the
	ring, swoosh and level-change arcs are posed against a stationary centre and the owner
	carries the swarm. Speeds are fractions of the drone's own terminal free-flight speed
	(droneTerminal below), so one table serves a slow necro and a fast boss drone.
*/
const TANK_DRONE_ORBIT_R = config.TANK_DRONE_ORBIT_R;
const TANK_DRONE_ORBIT_BIAS = config.TANK_DRONE_ORBIT_BIAS;
const TANK_DRONE_LEVEL_GAP = config.TANK_DRONE_LEVEL_GAP;
const TANK_DRONE_LEVELS = config.TANK_DRONE_LEVELS;
const TANK_DRONE_LEVEL_HOME = config.TANK_DRONE_LEVEL_HOME;
const TANK_DRONE_LEVEL_WEIGHTS = config.TANK_DRONE_LEVEL_WEIGHTS;
const TANK_DRONE_ORBIT_SPEED_FRAC = config.TANK_DRONE_ORBIT_SPEED_FRAC;
const TANK_DRONE_CROSS_SPEED_FRAC = config.TANK_DRONE_CROSS_SPEED_FRAC;
const TANK_DRONE_ACCEL_FRAC = config.TANK_DRONE_ACCEL_FRAC;
const TANK_DRONE_TURN_HEADROOM = config.TANK_DRONE_TURN_HEADROOM;
const TANK_DRONE_RETURN_ERR = config.TANK_DRONE_RETURN_ERR;
const TANK_DRONE_LEVEL_RELAX = tick.ticks(config.TANK_DRONE_LEVEL_RELAX);
const TANK_DRONE_SWITCH_COOLDOWN = tick.ticks(config.TANK_DRONE_SWITCH_COOLDOWN);
const TANK_DRONE_SWITCH_PUSH = config.TANK_DRONE_SWITCH_PUSH;
const TANK_DRONE_CROSS = tick.ticks(config.TANK_DRONE_CROSS);
const TANK_DRONE_CROSS_JITTER = config.TANK_DRONE_CROSS_JITTER;
const TANK_DRONE_PHASE_SPIN = config.TANK_DRONE_PHASE_SPIN;
const TANK_DRONE_SEPARATION = config.TANK_DRONE_SEPARATION;
const TANK_DRONE_SEP_NUDGE = config.TANK_DRONE_SEP_NUDGE;
// Every idle drone circles its owner the same way - counterclockwise, on screen - rather than
// each drone rolling its own direction.
const TANK_DRONE_ORBIT_DIR = -1;

/*
	The drone's terminal free-flight speed, in units per real tick: what it would settle at
	under the shared motion tail's cruise thrust (`vec += quadratic(speed x CRUISE_ORDER);
	vec *= F`, whose fixed point is `A x F/(1-F)`). Every TANK_DRONE_*_FRAC is a fraction of
	this, so the orbit never asks a drone for a speed its own barrel could not give it.
*/
const TERMINAL_OF_THRUST = BODY_FRICTION / (1 - BODY_FRICTION);
function droneTerminal(bullet) {
	return tick.quadratic(bullet.maxspeed * BULLET_CRUISE_ORDER) * TERMINAL_OF_THRUST;
}

// One lane's width: the drone's own body, so neighbouring rings are one drone apart whoever owns
// them - the property BASE_DRONE_LEVEL_GAP's flat gu(1) has for a fixed-size base drone.
function tankGap(bullet) {
	return bullet.size * TANK_DRONE_LEVEL_GAP;
}

function tankDroneSepNudge(bullet, desired) {
	const sep = bullet.size * TANK_DRONE_SEPARATION;
	const sep2 = sep * sep;
	const oid = bullet.origin.oId;
	let nearDx = 0, nearDy = 0, nearD2 = sep2;
	for (const other of bullet.room.INSTANCE.bullets.live()) {
		if (other === bullet || other.destroy || !other.origin || other.origin.oId !== oid) { continue; }
		if (other.orbLevel === undefined) { continue; }
		const t = other.type;
		if (t !== 1 && t !== 1.1 && t !== 1.2 && t !== 1.3 && t !== 1.5 && t !== 3 && t !== 3.1) { continue; }
		const dx = other.x - bullet.x, dy = other.y - bullet.y;
		const d2 = dx * dx + dy * dy;
		if (d2 < nearD2) { nearD2 = d2; nearDx = dx; nearDy = dy; }
	}
	if (nearD2 >= sep2) { return desired; }
	const push = Math.atan2(-nearDy, -nearDx);
	const closeness = 1 - Math.sqrt(nearD2) / sep;
	const nudge = TANK_DRONE_SEP_NUDGE * closeness;
	return desired + nudge * Math.atan2(Math.sin(push - desired), Math.cos(push - desired));
}

// The radius of one energy level: the home ring scales with the OWNER's body (a Mothership's swarm
// stands proportionally as clear of it as an Overseer's), the steps off it with the drone's.
function tankLevelR(play, bullet, level) {
	const gap = tankGap(bullet);
	const rMin = play.size * TANK_DRONE_ORBIT_R + (1 - TANK_DRONE_LEVEL_HOME) * gap;
	return play.size * TANK_DRONE_ORBIT_R + (level - TANK_DRONE_LEVEL_HOME) * gap
		+ TANK_DRONE_ORBIT_BIAS * rMin;
}

/*
	One level step, accepted with probability w[next]/w[here] (Metropolis on
	TANK_DRONE_LEVEL_WEIGHTS). A tank swarm has no per-centre ledger, so occupancy is
	statistical: this walk's stationary distribution IS the weight table. `dir` may be
	given (the post-swoosh climb home, always +1); left out, the drone rolls one.
*/
function tankLevelStep(bullet, dir) {
	const here = bullet.orbLevel;
	const step = dir || (Math.random() < 0.5 ? -1 : 1);
	const next = here + step;
	if (next < 1 || next > TANK_DRONE_LEVELS) { return false; }
	const wHere = TANK_DRONE_LEVEL_WEIGHTS[here - 1], wNext = TANK_DRONE_LEVEL_WEIGHTS[next - 1];
	// A climb home is scripted, not a preference - it must not be able to stall behind an
	// unlikely level the way a voluntary re-roll may.
	if (!dir && Math.random() > wNext / wHere) { return false; }
	bullet.orbLevel = next;
	return true;
}

/*
	One segment of a quintic Hermite: position, velocity AND acceleration matched at both
	endpoints (C2). `s` is the local 0..1 parameter, `T` the segment's duration in real ticks
	(derivative terms are pre-scaled by T/T^2 so va/aa/vb/ab are per-tick, not per-s).
	Returns {p, v} for one axis; callers evaluate x and y separately.
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
	One C2 blend of the swoosh, sampled into an arc-length table. The Hermite's duration
	parameter T is a shape parameter here, not a duration: it scales the derivative handles,
	so it is solved by fixed point against the curve's own length. 3-8 iterations at every
	level; the cap is a safety net, not an expected path.
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
	Position and analytic velocity at arc length `arc` along a polyline (xs/ys/ss).
	planCross() walks one polyline spanning all three pieces of the swoosh. The tangent is
	a central difference over the sample either side, not the bracketing segment's chord -
	a per-segment tangent makes `head` (and so the drawn drone) step a couple of units at a time.
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
	Swoosh geometry: arc -> C2 blend -> straight through the orbit centre -> C2 blend ->
	arc, as one polyline. Shared by planCross() (a live drone) and estimateCrossTicks()
	(geometry only). `sc` is the arc length at the orbit centre, which lies ON the straight
	by construction. `vOrbit`/`vCross` default to the base drone pair; droneIdleOrbit
	passes its own, scaled to the drone's terminal speed.
*/
function crossPolyline(P0, V0, A0, ox, oy, r0, R1, phi, spin,
	vOrbit = BASE_DRONE_ORBIT_SPEED, vCross = BASE_DRONE_CROSS_SPEED) {
	const f = config.BASE_DRONE_CROSS_BLEND_FRAC;
	const lead = 2 * Math.PI * config.BASE_DRONE_CROSS_LEAD * spin;
	const phiLine = phi + lead;
	const ux = Math.cos(phiLine), uy = Math.sin(phiLine);
	const dx = -ux, dy = -uy;
	// Each end gives up a fraction of its own radius, not of the chord, so the orbit
	// centre sits strictly inside the straight at fraction r0/(r0+R1).
	const Lin = { x: ox + ux * r0 * (1 - f), y: oy + uy * r0 * (1 - f) };
	const Lout = { x: ox + dx * R1 * (1 - f), y: oy + dy * R1 * (1 - f) };
	const phiB = phiLine + Math.PI + lead;
	const nBx = Math.cos(phiB), nBy = Math.sin(phiB);
	const B = { x: ox + nBx * R1, y: oy + nBy * R1 };
	const VB = { x: -nBy * spin * vOrbit, y: nBx * spin * vOrbit };
	const aB = vOrbit * vOrbit / R1;
	const AB = { x: -nBx * aB, y: -nBy * aB };
	// Velocity at the line knots is a shape handle, not a speed: direction along the
	// line and zero acceleration make the join tangent with zero curvature (C2).
	const Vl = { x: dx * vCross, y: dy * vCross };
	const Z = { x: 0, y: 0 };
	const vMean = (vOrbit + vCross) / 2;
	const she = blendShape(P0, V0, A0, Lin, Vl, Z, vMean);
	const shx = blendShape(Lout, Vl, Z, B, VB, AB, vMean);

	// One polyline over all three pieces - the speed profile spans the whole swoosh.
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
	Speed profile: ramp from cruise to `vp` over the first BASE_DRONE_CROSS_RAMP of the
	path, hold across the middle, ramp back down over the last. `dv/ds = 0` at all four
	knees, which is what makes the two seams C2. `sc` is unused; the peak is a plateau
	the orbit centre sits inside.
*/
function crossVAt(L, sc, arc, vp, vOrbit = BASE_DRONE_ORBIT_SPEED) {
	const ramp = L * config.BASE_DRONE_CROSS_RAMP;
	const z = arc <= ramp ? arc / ramp : (L - arc) / ramp;
	const w = Math.min(1, Math.max(0, z));
	return vOrbit + (vp - vOrbit) * w * w * (3 - 2 * w);
}

// Real-tick duration of the whole swoosh at peak speed `vp`, by trapezoidal integration over the
// polyline's own arc-length samples.
function crossDurOf(ss, L, sc, vp, vOrbit = BASE_DRONE_ORBIT_SPEED) {
	let d = 0;
	for (let i = 1; i < ss.length; i++) {
		d += (ss[i] - ss[i - 1]) /
			((crossVAt(L, sc, ss[i], vp, vOrbit) + crossVAt(L, sc, ss[i - 1], vp, vOrbit)) / 2);
	}
	return d;
}

/*
	Solve the peak so the walk lands on a whole tick. dur() is strictly decreasing in
	the peak, so 18 bisections land it to well under a part in 10^4.
*/
function crossSolvePeak(ss, L, sc, vOrbit = BASE_DRONE_ORBIT_SPEED, vCross = BASE_DRONE_CROSS_SPEED) {
	const T = Math.max(3, Math.round(crossDurOf(ss, L, sc, vCross, vOrbit)));
	let lo = vCross * 0.9, hi = vCross * 1.1;
	for (let it = 0; it < 18; it++) {
		const mid = (lo + hi) / 2;
		if (crossDurOf(ss, L, sc, mid, vOrbit) > T) { lo = mid; } else { hi = mid; }
	}
	return { T, vPeak: (lo + hi) / 2 };
}

/*
	Build a whole swoosh as a per-tick table: arc -> C2 blend -> straight through the
	orbit centre -> C2 blend -> level 1, traversed by one speed profile. Called once at trigger.
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
	// Entry/straight/exit arc lengths. Diagnostics and tests only; nothing branches on it.
	drone.crossSegs = [sEnd, xEnd - sEnd, L - xEnd];
	// Exact geometric straight endpoints, for tests - a flown tick can overshoot a
	// fraction of a tick into the neighbouring blend.
	drone.crossLin = { x: Lin.x, y: Lin.y };
	drone.crossLout = { x: Lout.x, y: Lout.y };
	// Tick-count boundaries alongside the arc lengths above, for tests.
	drone.crossTicks = [teTick, txTick - teTick, T - txTick];
	drone.crossT = 0;
	drone.crossing = true;
}

/*
	Geometry-only estimate of how many real ticks a cross from r0 to R1 takes. Factored
	out of planCross() so rooms/Room.js can size each orbit centre's crossCap from measured
	demand at ledger-build time, without a live drone. Generic phi=0/spin=+1 and an entry
	state at cruise speed, tangential; duration depends only on r0 and R1.
*/
function estimateCrossTicks(r0, R1) {
	const v0 = BASE_DRONE_ORBIT_SPEED;
	const P0 = { x: r0, y: 0 }, V0 = { x: 0, y: v0 };
	const A0 = { x: -v0 * v0 / r0, y: 0 };
	const { ss, L, sc } = crossPolyline(P0, V0, A0, 0, 0, r0, R1, 0, 1);
	return crossSolvePeak(ss, L, sc).T;
}

/*
	The orbit field's desired direction at a drone's current position: tangential, with
	a radial lean toward orbRTarget that saturates at BASE_DRONE_LEAN_MAX. Never normalised
	- only its angle is ever read. Shared by case 1.4's steering tail, the chase-drop
	block, and clampToMap()'s corner fallback.
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
	Move a drone exactly one energy level.

	  'random' - a reaction (shape hit or drone-proximity). Always succeeds: prefers an
	  open neighbour; if both are full, takes the one with the most headroom (count - cap),
	  ties at random. Writes orbRTarget immediately; the orbit field's lean produces the
	  sharp reactive turn.

	  'home' - post-swoosh climb back to BASE_DRONE_LEVEL_HOME. A voluntary move normally
	  respects the saturation cap; while `drone.homing` is set the cap is bypassed so a
	  scripted return cannot stall behind a full level 2.

	  'sort' - per-centre binomial sorter (rooms/Room.js tickDroneCentres()). The caller
	  has already checked a deficit in the wanted direction, so this never checks the cap
	  either - only the proximity guard applies. `dir` (-1/+1) says which neighbour.

	A successful 'home'/'sort' switch plans the whole move as a single quintic Hermite
	(planSwitchArc) instead of just writing orbRTarget.
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
			// 'sort': the caller already validated a deficit at this direction - cap-free,
			// not just while homing.
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
	// finishes - the trigger block that would otherwise clear it is gated on `!switching`.
	if (mode === 'home' && next === config.BASE_DRONE_LEVEL_HOME) { drone.homing = 0; }
	return true;
}

/*
	A 'home'/'sort' switch's planned arc: a shallow quintic-Hermite sweep leaning
	BASE_DRONE_SWITCH_LEAN off the tangent, landing at the new radius exactly tangential
	and at cruise speed so the hand-off back to the orbit field is exact.
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

/*
	Ordinary controllable-drone steering (Overseer/Necromancer/Manager/BattleShip-swarm, type 1).
	Returns whether the drone is actively aiming at something (a live DETEC target, or the
	owner's own mouse). FALSE means it idled through droneIdleOrbit(), which flies and commits its
	own motion - the caller must return rather than fall through to the shared thrust tail.
*/
function droneSteer1(bullet, play) {
	bullet.showDir = bullet.dir;
	if (!bullet.comingDir) {
		bullet.comingDir = 0;
	}
	bullet.speed = bullet.maxspeed;
	///
	if (!bullet.DETEC) {
		bullet.DETEC = new Detector(play, bullet.x, bullet.y, droneAggroR(play), [KIND.PLAYER, KIND.OBJECTS])
		bullet.DETEC.team = bullet.team
	} else {
		bullet.DETEC.x = bullet.x;
		bullet.DETEC.y = bullet.y;
		bullet.DETEC.size = bullet.DETEC.dis = droneAggroR(play);
	}
	///
	if (play.inputs.mouseR) {
		const mx = play.x + play.inputs.mouse_x, my = play.y + play.inputs.mouse_y;
		bullet.dir = Math.atan2(bullet.y - my, bullet.x - mx);
		bullet.orbLevel = undefined;
		return true;
	} else if (play.inputs.mouseL || play.inputs.e) {
		const mx = play.x + play.inputs.mouse_x, my = play.y + play.inputs.mouse_y;
		bullet.dir = Math.atan2(my - bullet.y, mx - bullet.x);
		bullet.orbLevel = undefined;
		return true;
	} else {
		if (bullet.DETEC.select) {
			bullet.DETEC.enabled = 0;
			const other = bullet.DETEC.select;
			// Committed (detector off), so the widened HYST radius applies - measured from the
			// OWNER, not from this drone.
			if (!other.destroy && other.alpha && droneInAggro(play, other, true)) {
				bullet.dir = droneChaseDir(bullet, other);
				bullet.orbLevel = undefined;
				return true;
			} else {
				bullet.DETEC.reset();
				bullet.DETEC.enabled = 1;
			}
		}
		droneIdleOrbit(bullet, play);
		return false;
	}
}

/*
	The "nothing to attack" half of every drone's steering - controllable (type 1),
	uncontrollable (1.1), BattleShip/Fortress swarm (1.2), Factory minion (1.5), necro
	(3) and a boss's own drone (3.1) all idle through this one function.

	The BASE_DRONE state machine, flown in the owner's frame. Authoritative state is
	`orbHead`/`orbSpd` - heading and speed relative to the tank; world position is the
	owner's plus that. Three branches:

	  ORBIT/RETURN - one velocity field (tangent, leaned toward the level's radius),
	  rate-limited in heading and speed, with a smoothstep blend from cruise up to
	  terminal as the radial error grows so a drone left behind sprints back onto its ring.

	  CROSS - the swoosh as a planned quintic curve (planTankCross): arc -> C2 blend ->
	  straight through the owner -> C2 blend -> level 1. Position, velocity, head and
	  speed all come from the curve; the last tick is the orbit field's own landing state.

	  SWITCH - a level change as its own shallow planned arc (planTankSwitchArc), landing
	  tangentially at the new radius at cruise speed.

	Building it in the owner's frame makes a moving tank a non-event: the ring, swoosh
	and arcs are posed against a stationary centre.
*/
function droneIdleOrbit(bullet, play, replan = false) {
	const vTerm = droneTerminal(bullet);
	const vOrbit = vTerm * TANK_DRONE_ORBIT_SPEED_FRAC;
	const vCross = vTerm * TANK_DRONE_CROSS_SPEED_FRAC;

	// Relative position is re-derived from the two live world positions every tick rather than
	// carried - so a knockback, a map clamp or anything else that moves either body is picked up
	// here instead of silently desynchronising the frame.
	let rx = bullet.x - play.x, ry = bullet.y - play.y;

	// `replan` is the immediate re-entry after a curve was planned below: the curve's first tick is
	// flown right here, but this tick's bookkeeping (the cooldown, the impulse test) has already
	// run and must not run twice.
	if (replan) { /* fall through to the curve branches */ }
	else if (bullet.orbLevel === undefined) {
		// Enter on whatever ring the drone was born on rather than snapping it somewhere: a drone
		// leaves the muzzle heading outward, and the field below flies it in.
		bullet.orbLevel = TANK_DRONE_LEVEL_HOME;
		bullet.orbHead = Math.atan2(bullet.vec.y, bullet.vec.x);
		bullet.orbSpd = Math.min(vTerm, Math.hypot(bullet.vec.x, bullet.vec.y));
		bullet.orbSpin = TANK_DRONE_ORBIT_DIR;
		bullet.orbCrossing = 0;
		bullet.orbSwitching = 0;
		bullet.orbHoming = 0;
		bullet.orbReact = 0;
		bullet.orbSwitchCooldown = 0;
		bullet.orbLevelTimer = TANK_DRONE_LEVEL_RELAX;
		// Randomised on the first interval only, so a swarm spawned together does not swoosh in
		// lockstep - re-armed to the plain CROSS afterwards.
		bullet.orbCrossIn = Math.max(1, Math.round(TANK_DRONE_CROSS *
			(1 + (Math.random() * 2 - 1) * TANK_DRONE_CROSS_JITTER)));
	}
	if (bullet.orbPhase === undefined) {
		bullet.orbPhase = Math.random() * Math.PI * 2;
	}
	if (!replan && bullet.orbLevel !== undefined) {
		// An EXTERNAL impulse - a collision knockback, another drone shoving past - is whatever
		// `vec` carries that we did not write ourselves last tick. Past SWITCH_PUSH of terminal
		// speed it counts as the tank-side equivalent of a base drone's `tooClose`: the drone
		// changes level rather than simply being pushed back onto the ring it was already on.
		const pdx = bullet.vec.x - (bullet.orbLastVX || 0), pdy = bullet.vec.y - (bullet.orbLastVY || 0);
		if (pdx * pdx + pdy * pdy > (TANK_DRONE_SWITCH_PUSH * vTerm) ** 2) { bullet.orbReact = 1; }
	}

	if (bullet.orbSwitchCooldown > 0 && !replan) { bullet.orbSwitchCooldown--; }
	const gap = tankGap(bullet);
	const rTarget = tankLevelR(play, bullet, bullet.orbLevel);

	// A planned curve owns the drone outright while it runs - the same exclusivity a base drone's
	// `crossing`/`switching` have, and for the same reason (nothing may perturb a curve that was
	// posed against the state it started from).
	if (bullet.orbCrossing) {
		const p = bullet.orbTbl[bullet.orbT++];
		rx = p.x; ry = p.y;
		bullet.orbHead = Math.atan2(p.vy, p.vx);
		bullet.orbSpd = Math.hypot(p.vx, p.vy);
		if (bullet.orbT >= bullet.orbTbl.length) {
			// Lands on level 1 by construction, then climbs back to home on its own planned arcs -
			// a swoosh is a dive through the middle and a slow recovery, not a lane change.
			bullet.orbCrossing = 0;
			bullet.orbTbl = null;
			bullet.orbLevel = 1;
			bullet.orbHoming = 1;
			bullet.orbReact = 0;
			bullet.orbCrossIn = TANK_DRONE_CROSS;
			bullet.orbLevelTimer = TANK_DRONE_LEVEL_RELAX;
		}
		return tankOrbitCommit(bullet, play, rx, ry);
	}

	if (bullet.orbSwitching) {
		bullet.orbSwitchT++;
		const s = Math.min(1, bullet.orbSwitchT / bullet.orbSwitchDur);
		const segX = quinticHermite(s, bullet.orbSwitchDur, bullet.orbSP0x, bullet.orbSV0x, bullet.orbSA0x,
			bullet.orbSP1x, bullet.orbSV1x, bullet.orbSA1x);
		const segY = quinticHermite(s, bullet.orbSwitchDur, bullet.orbSP0y, bullet.orbSV0y, bullet.orbSA0y,
			bullet.orbSP1y, bullet.orbSV1y, bullet.orbSA1y);
		rx = segX.p; ry = segY.p;
		bullet.orbHead = Math.atan2(segY.v, segX.v);
		bullet.orbSpd = Math.hypot(segX.v, segY.v);
		if (bullet.orbSwitchT >= bullet.orbSwitchDur) { bullet.orbSwitching = 0; }
		return tankOrbitCommit(bullet, play, rx, ry);
	}

	// Level-change triggers, all funnelled through the one planned arc. A switch is only planned
	// from the drone's OWN ring - the arc's entry seam is built from the centripetal acceleration
	// of the circle it is currently flying, which is meaningless for one still spiralling in.
	const r = Math.hypot(rx, ry) || 1;
	const onRing = Math.abs(r - rTarget) <= gap / 2;
	if (onRing) {
		if (bullet.orbHoming) {
			// The post-swoosh climb back to home: scripted, so it ignores the weight table's own
			// acceptance test and simply walks up a level per RELAX.
			if (bullet.orbLevel === TANK_DRONE_LEVEL_HOME) {
				bullet.orbHoming = 0;
				bullet.orbLevelTimer = TANK_DRONE_LEVEL_RELAX;
			} else if (--bullet.orbLevelTimer <= 0) {
				bullet.orbLevelTimer = TANK_DRONE_LEVEL_RELAX;
				if (tankLevelStep(bullet, bullet.orbLevel < TANK_DRONE_LEVEL_HOME ? 1 : -1)) {
					planTankSwitchArc(bullet, play, tankLevelR(play, bullet, bullet.orbLevel), vOrbit);
				}
			}
		} else if (bullet.orbReact && bullet.orbSwitchCooldown <= 0) {
			bullet.orbReact = 0;
			bullet.orbSwitchCooldown = TANK_DRONE_SWITCH_COOLDOWN;
			if (tankLevelStep(bullet)) {
				planTankSwitchArc(bullet, play, tankLevelR(play, bullet, bullet.orbLevel), vOrbit);
			}
		} else if (--bullet.orbLevelTimer <= 0) {
			bullet.orbLevelTimer = TANK_DRONE_LEVEL_RELAX;
			if (tankLevelStep(bullet)) {
				planTankSwitchArc(bullet, play, tankLevelR(play, bullet, bullet.orbLevel), vOrbit);
			}
		}
		if (bullet.orbSwitching) { return droneIdleOrbit(bullet, play, true); }
	}

	// The swoosh, on the same "only from its own ring" condition and for the same reason.
	if (--bullet.orbCrossIn <= 0 && onRing && !bullet.orbHoming) {
		planTankCross(bullet, play, vOrbit, vCross);
		return droneIdleOrbit(bullet, play, true);
	}

	// ---- the orbit field: tangential, leaned toward this level's radius ----------------------
	bullet.orbPhase += TANK_DRONE_PHASE_SPIN * bullet.orbSpin;
	const ux = rx / r, uy = ry / r;
	const tx = -uy * bullet.orbSpin, ty = ux * bullet.orbSpin;
	const err = rTarget - r;   // + = must move outward
	// Leaned on the lane width (a lean measured in absolute units would be a hard turn on a narrow
	// set of rings and a shrug on a wide one) and saturating near-radial, exactly as the base
	// drone's orbitDesired() does.
	const lean = Math.max(-config.BASE_DRONE_LEAN_MAX,
		Math.min(config.BASE_DRONE_LEAN_MAX, err / gap));
	const desired = Math.atan2(ty + uy * lean, tx + ux * lean);

	// Speed and turn rate blend on the same smoothstep k, so a fast return cannot swing wide of
	// the ring it is returning to.
	const e = Math.min(1, Math.abs(err) / (play.size * TANK_DRONE_RETURN_ERR));
	const k = e * e * (3 - 2 * e);
	// Far from the ring, aim at this drone's own slot on it rather than the shared radial - so
	// a swarm left behind by a moving owner fans out instead of beelining to one point.
	const tgtX = Math.cos(bullet.orbPhase) * rTarget, tgtY = Math.sin(bullet.orbPhase) * rTarget;
	const returnDesired = Math.atan2(tgtY - ry, tgtX - rx);
	const dx1 = Math.cos(desired), dy1 = Math.sin(desired);
	const dx2 = Math.cos(returnDesired), dy2 = Math.sin(returnDesired);
	const bx = (1 - k) * dx1 + k * dx2, by = (1 - k) * dy1 + k * dy2;
	let finalDesired = Math.atan2(by, bx);
	finalDesired = tankDroneSepNudge(bullet, finalDesired);
	const targetSpeed = vOrbit + (vTerm - vOrbit) * k;
	// Headroom over the rate this ring actually needs at this speed (v/R), rather than a flat
	// rad/tick - a tank drone's ring and speed both scale with the owner and the drone.
	const turnLimit = TANK_DRONE_TURN_HEADROOM * bullet.orbSpd / Math.max(r, rTarget * 0.25);

	let dHead = Math.atan2(Math.sin(finalDesired - bullet.orbHead), Math.cos(finalDesired - bullet.orbHead));
	dHead = Math.max(-turnLimit, Math.min(turnLimit, dHead));
	bullet.orbHead += dHead;
	const accel = vTerm * TANK_DRONE_ACCEL_FRAC;
	bullet.orbSpd += Math.max(-accel, Math.min(accel, targetSpeed - bullet.orbSpd));

	rx += Math.cos(bullet.orbHead) * bullet.orbSpd;
	ry += Math.sin(bullet.orbHead) * bullet.orbSpd;
	return tankOrbitCommit(bullet, play, rx, ry);
}

/*
	Writes one tick of the orbit back out: relative position -> world position, and the world
	velocity that implies (the drone's own relative velocity plus whatever the owner is doing).
	`orbLastV` is what the next tick's external-impulse test compares against, so this is also the
	one place that records "what we ourselves asked for".
*/
function tankOrbitCommit(bullet, play, rx, ry) {
	const nx = play.x + rx, ny = play.y + ry;
	bullet.vec.x = nx - bullet.x;
	bullet.vec.y = ny - bullet.y;
	bullet.x = nx;
	bullet.y = ny;
	bullet.orbLastVX = bullet.vec.x;
	bullet.orbLastVY = bullet.vec.y;
	// Drawn and fired along the way it is actually travelling, in the owner's frame - a drone
	// orbiting a moving tank should point along its own ring, not along the tank's course.
	bullet.showDir = bullet.dir = bullet.orbHead;
	bullet.comingDir = bullet.dir;
	// The shared motion tail is bypassed entirely for an idling drone (position came from the
	// field or a curve above), so `speed` is zeroed rather than left to add a phantom thrust if
	// anything downstream ever reads it.
	bullet.speed = 0;
	bullet.clampToMap();
}

/*
	A level change as a planned arc, in the owner's frame: a shallow BASE_DRONE_SWITCH_LEAN sweep
	that lands at the new radius exactly tangential and at cruise speed, so the orbit field resumes
	with zero error. Same construction as the base drone's planSwitchArc(), posed against a
	stationary centre instead of a base post.
*/
function planTankSwitchArc(bullet, play, r1, vOrbit) {
	const cx = bullet.x - play.x, cy = bullet.y - play.y;
	const r0 = Math.hypot(cx, cy) || 1;
	const theta0 = Math.atan2(cy, cx);
	// Magnitude of the lane width, not the signed radius change: the sweep always runs the
	// way the drone is already orbiting. Signing it would send an inward switch backwards.
	const dtheta = tankGap(bullet) / (Math.tan(config.BASE_DRONE_SWITCH_LEAN) * r0) * bullet.orbSpin;
	const theta1 = theta0 + dtheta;
	const u1x = Math.cos(theta1), u1y = Math.sin(theta1);
	const tx = -u1y * bullet.orbSpin, ty = u1x * bullet.orbSpin;

	bullet.orbSP0x = cx; bullet.orbSP0y = cy;
	bullet.orbSV0x = Math.cos(bullet.orbHead) * bullet.orbSpd;
	bullet.orbSV0y = Math.sin(bullet.orbHead) * bullet.orbSpd;
	// Entry acceleration is the centripetal one of the circle the drone is ACTUALLY flying, which
	// is what makes the join C2 rather than merely continuous.
	const a0 = bullet.orbSpd * bullet.orbSpd / r0;
	bullet.orbSA0x = -cx / r0 * a0; bullet.orbSA0y = -cy / r0 * a0;
	bullet.orbSP1x = u1x * r1; bullet.orbSP1y = u1y * r1;
	bullet.orbSV1x = tx * vOrbit; bullet.orbSV1y = ty * vOrbit;
	const a1 = vOrbit * vOrbit / r1;
	bullet.orbSA1x = -u1x * a1; bullet.orbSA1y = -u1y * a1;

	const meanR = (r0 + r1) / 2;
	bullet.orbSwitchDur = Math.max(3,
		Math.round(Math.hypot(meanR * Math.abs(dtheta), r1 - r0) / vOrbit));
	bullet.orbSwitchT = 0;
	bullet.orbSwitching = 1;
}

/*
	The swoosh, in the owner's frame - built by the SAME crossPolyline()/crossSolvePeak() a base
	drone's planCross() uses, at this drone's own two speeds. Centre (0,0) is the owner, so a tank
	that drives off during the swoosh carries the curve with it instead of stranding the drone
	behind a point that has moved.
*/
function planTankCross(bullet, play, vOrbit, vCross) {
	const rx = bullet.x - play.x, ry = bullet.y - play.y;
	const r0 = Math.hypot(rx, ry) || 1;
	const nx = rx / r0, ny = ry / r0;
	const R1 = tankLevelR(play, bullet, 1);
	const v0 = bullet.orbSpd || vOrbit;
	const P0 = { x: rx, y: ry };
	const V0 = { x: Math.cos(bullet.orbHead) * bullet.orbSpd, y: Math.sin(bullet.orbHead) * bullet.orbSpd };
	const A0 = { x: -nx * v0 * v0 / r0, y: -ny * v0 * v0 / r0 };

	const { xs, ys, ss, L, sc, B, VB } =
		crossPolyline(P0, V0, A0, 0, 0, r0, R1, Math.atan2(ny, nx), bullet.orbSpin, vOrbit, vCross);
	const { T, vPeak } = crossSolvePeak(ss, L, sc, vOrbit, vCross);

	const tbl = [];
	let arc = 0;
	for (let t = 1; t <= T; t++) {
		for (let n = 0; n < 8; n++) {          // RK2 substeps: explicit Euler drifts at this dt
			const h = 1 / 8, a1 = crossVAt(L, sc, arc, vPeak, vOrbit);
			arc += (a1 + crossVAt(L, sc, arc + a1 * h, vPeak, vOrbit)) / 2 * h;
		}
		if (t === T) { arc = L; }
		tbl.push(pathAt(xs, ys, ss, arc, crossVAt(L, sc, arc, vPeak, vOrbit)));
	}
	// The last tick is the orbit field's own state at the landing point, written exactly
	// rather than sampled, so the hand-off costs the field zero heading/speed error.
	tbl[tbl.length - 1] = { x: B.x, y: B.y, vx: VB.x, vy: VB.y };
	bullet.orbTbl = tbl;
	bullet.orbT = 0;
	bullet.orbCrossing = 1;
}

/*
	Factory minion steering. Sets `showDir` (aim) and `dir` (movement) independently.
	Returns whether it has a focus at all (cursor or an acquired target) - the minion's
	barrel is live only while it does.
*/
function minionSteer(bullet, play) {
	bullet.speed = bullet.maxspeed;
	if (!bullet.DETEC) {
		bullet.DETEC = new Detector(play, bullet.x, bullet.y, droneAggroR(play), [KIND.PLAYER, KIND.OBJECTS]);
		bullet.DETEC.team = bullet.team;
	} else {
		bullet.DETEC.x = bullet.x;
		bullet.DETEC.y = bullet.y;
		bullet.DETEC.size = bullet.DETEC.dis = droneAggroR(play);
	}
	///
	let fx, fy, aim;
	if (play.inputs.mouseR) {
		fx = play.x + play.inputs.mouse_x;
		fy = play.y + play.inputs.mouse_y;
		aim = Math.atan2(bullet.y - fy, bullet.x - fx);
	} else if (play.inputs.mouseL || play.inputs.e) {
		fx = play.x + play.inputs.mouse_x;
		fy = play.y + play.inputs.mouse_y;
		aim = Math.atan2(fy - bullet.y, fx - bullet.x);
	} else if (bullet.DETEC.select) {
		const other = bullet.DETEC.select;
		if (!other.destroy && other.alpha && droneInAggro(play, other, true)) {
			bullet.DETEC.enabled = 0;
			fx = other.x;
			fy = other.y;
			aim = Math.atan2(fy - bullet.y, fx - bullet.x);
		} else {
			bullet.DETEC.reset();
			bullet.DETEC.enabled = 1;
		}
	}
	///
	if (aim === undefined) {
		droneIdleOrbit(bullet, play);
		return false;
	}
	const d = Math.sqrt(Math.pow(bullet.x - fx, 2) + Math.pow(bullet.y - fy, 2));
	bullet.showDir = aim;
	bullet.dir = (d > MINION_FOCUS) ? aim
		: (d > MINION_FOCUS_IN) ? aim + Math.PI / 2
			: aim + Math.PI;
	bullet.orbLevel = undefined;
	return true;
}

class Bullet {
	constructor(origin, x, y, direction, speed, muzzleKick, room) {
		this.BUFF = {
			timestamp: -1,
		};
		this.id = 0;
		this.room = room;
		this.origin = origin;
		this.class = 0;
		this.life = tick.ticks(75);   // Fallback lifetime; every real cannon sets its own
		// `life` explicitly in TanksConfig.js.
		this.team = 0;
		this.type = 0;
		this.pene = 1;
		// `weight` is knockback dealt to a TANK (entities/Player.js's bullet arm reads it);
		// `push` is this bullet's own bounce off whatever it hit, read only by the three
		// self-push sites in collision() below. Two different things, two different columns
		// in public/SHARE/TanksConfig.js - see that file's header.
		this.weight = 0;
		this.push = 0;
		// The shooter's Bullet Damage point count at the moment of firing. Only a true
		// bullet or trap's pushFactor scales with it; a drone uses a flat 4. Read at one
		// site (Player.js's KIND.BULLET arm) and only for `type === 0 || type === 2`.
		this.bdPoints = 0;
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
		// Set to 1 only on a Skimmer's own sub-shots (case 4 in update()) - drawn under the
		// spinning parent instead of over it, via rooms/Room.js's states[2] wire bit.
		this.underlay = 0;
		// Whether this projectile's death was an impact against something solid (tank,
		// boss, shape, wall, base fence) rather than running out of `life` or being shot
		// down. Only an impact death applies DEATH_DRAG, so the fade plants where it hit;
		// a shot that hit nothing keeps coasting through its fade.
		this.impactDeath = 0;
		// Arming window for a trap (type 2 only). `life >> 3` ticks; 0 for every other
		// bullet. Set once `this.type`/`this.life` are both known (Player.js's shoot()),
		// not here - the caller assigns both after construction.
		this.armTicks = 0;
		// The muzzle kick: a single impulse, already fully computed by the caller
		// (Player.js's shoot()), decayed by BODY_FRICTION from here on. Held, not applied
		// - the motion tail pays it on the tick after this one. `launchDir` is the original
		// firing direction, kept separately because a drone's `dir` is a live steering
		// output and will have moved by the time the kick lands.
		this.vec = new Vec(0, 0);
		// `|| 0`, not a bare conversion: a base drone and a pet are built with no muzzle
		// kick, and a missing argument must not become NaN in `vec`.
		this.launchKick = muzzleKick ? tick.perTick(muzzleKick) : 0;
		this.launchDir = direction;
		this.launched = 0;
		// Which of the owner's droneGroup pools this drone occupies (entities/Player.js's shoot(),
		// Mothership's droneSplit only) - -1 for every ordinary drone, which only ever touches the
		// single shared droneCount pool. Read by release() below.
		this.droneGroup = -1;
		// Whether this bullet occupies a maxDrone slot - set by Player.js's shoot() for a
		// cannon whose class has `maxDrone` (permanent or finite-life). release() reads
		// this, not `life`, so a finite-life capped drone still refunds on expiry.
		this.counted = 0;
		// Guards release() against double-firing - a drone can be destroyed and then swept in the
		// same pass (rooms/Room.js), and droneCount/droneGroup must only ever be refunded once.
		this.released = 0;
	}
	/*
		A permanent drone (life -1) occupies one slot of its owner's budget until it actually goes
		away, whichever way it goes - killed, expired, its owner dying or evolving, or the
		out-of-arena sweep in rooms/Room.js. Idempotent via `released`, since a drone can be
		destroyed and then swept in the same pass.
	*/
	release(play) {
		// `counted`, not `life !== -1`: a maxDrone-capped cannon can be finite-life
		// (Guardian) and still owes a refund on natural expiry.
		if (!this.counted || this.released) { return; }
		this.released = 1;
		if (!play) { play = this.room.INSTANCE.players.get(this.origin.oId); }
		if (!play) { return; }
		// Clamped at zero: a negative pool is not "room for more drones", it is a refund that had
		// no matching spend, and letting it go under would raise the owner's effective maxDrone by
		// however far it went.
		play.droneCount = Math.max(0, play.droneCount - 1);
		if (this.droneGroup >= 0 && play.droneGroup) {
			play.droneGroup[this.droneGroup] = Math.max(0, play.droneGroup[this.droneGroup] - 1);
		}
	}
	collision(other, option = {}) {
		if (option.type) {
			switch (option.type) {
				case 'god':
					if (this.origin.oId === other.id.oId) {
						return;
					}
					// One impulse per tick of contact, decayed by BODY_FRICTION - the same
					// already-invariant shape as the muzzle kick, so it stays perTick.
					{
						const push = tick.perTick(this.speed * 2 + 0.91418);
						this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(push, push)));
					}
					return;
			}
		}
		if (option.base) {
			this.destroy = tick.DES;
			this.impactDeath = 1;
		}
		if (other) {
			switch (other.kind) {
				case KIND.PLAYER:
					if (option.noDam) { break; }
					if (this.origin.oId === other.id.oId) {
						return;
					}
					// A polygon boss hitting a base drone by body - recorded on the shared
					// per-centre ledger so the whole base engages it, not just the drone that got hit.
					if (this.type === 1.4 && other.boss) {
						this.levels.provoked = other.id.oId;
						this.levels.provokedAt = this.room.timestamp;
					}
					this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.perTick(this.push), tick.perTick(this.push))));
					// pene is spent against the target's damage output, not against this
					// bullet. common(tank,bullet) = 1 (lib/damage.js). `option.dmgScale` is
					// Room.js's proration factor for this tick (1 unless either side would
					// otherwise die mid-tick).
					this.pene -= tick.perTick(other.damage * (option.dmgScale ?? 1));
					// LETHAL_EPS, not 0 (lib/damage.js) - pene is the bullet's health pool for
					// proration purposes, so a prorated spend has the same ulp-short hazard hp does.
					if (this.pene <= LETHAL_EPS) { this.pene = 0; this.destroy = tick.DES; this.impactDeath = 1; }
					break;
				case KIND.OBJECTS:
					this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.perTick(this.push), tick.perTick(this.push))));
					/*
						Shape-hit reaction: always costs the drone a level. ORBIT writes
						position directly, so the vec.add() above is a no-op there; the
						reaction is latched into reactPending if the drone is mid-arc or on
						cooldown. Mid-swoosh is the exception: landing on level 1 is its
						level change, so the cross's own exit clears the latch.
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
					// Same rule as the KIND.PLAYER arm: spent against the shape's own
					// damage output. common(shape,bullet) = 1 (lib/damage.js).
					this.pene -= tick.perTick(other.damage * (option.dmgScale ?? 1));
					if (this.pene <= LETHAL_EPS) { this.pene = 0; this.destroy = tick.DES; this.impactDeath = 1; }
					break;
				case KIND.BULLET:
					if (other.origin.oId === this.origin.oId) {
						if ((parseInt(this.type) === 1 || parseInt(this.type) === 3) && this.type === other.type) {
							this.vec.add(new Vec(this.x - other.x, this.y - other.y).norm().multiply(new Vec(tick.perTick(this.push), tick.perTick(this.push))));
						}
						return;
					} else {
					}
					// Same-team protection: Room.js sets noDam on both sides of any
					// same-team, non-Objects pair when rules.teamPlay is on, before this
					// decrement and before every vec.add() above.
					if (option.noDam) { break; }
					// A polygon boss shooting a base drone - one lookup on the tick a
					// base drone is actually shot.
					if (this.type === 1.4) {
						const shooter = this.room.INSTANCE.players.get(other.origin.oId);
						if (shooter && shooter.boss) {
							this.levels.provoked = shooter.id.oId;
							this.levels.provokedAt = this.room.timestamp;
						}
					}
					// common() via this.type (lib/damage.js projectileCommon). Two ordinary
					// bullets run 0.25; any pairing with a drone is 1. `option.dmg` is the
					// other bullet's fixed damage, not its remaining pene - pene only
					// decides how many ticks of contact a bullet survives.
					this.pene -= tick.perTick(option.dmg * projectileCommon(this.type, other.type));
					// Same LETHAL_EPS threshold as the two arms above. Bullet-vs-bullet
					// is not prorated (pene-vs-pene, not Room.js's dmgScale table).
					if (this.pene <= LETHAL_EPS) { this.pene = 0; this.destroy = tick.DES; }
					break;
				case KIND.WALL:
					// An Arena Closer's own bullet passes through a wall, matching the
					// exemption Player.js's collision() gives the closer tank itself. Set
					// on the bullet at the shoot() site - a bullet has no live origin here.
					if (this.closer) { break; }
					{
						// Same circle-vs-AABB closest-point test as Player.js's KIND.WALL
						// arm. The broad-phase gate only bounds the wall by its half-diagonal,
						// so a false-positive candidate is re-checked here.
						const hw = other.w / 2, hh = other.h / 2;
						const cx = Math.max(other.x - hw, Math.min(this.x, other.x + hw));
						const cy = Math.max(other.y - hh, Math.min(this.y, other.y + hh));
						const dx = this.x - cx, dy = this.y - cy;
						if (dx * dx + dy * dy > this.size * this.size) { break; }
						// Anything with an owner (bullet, trap, drone) is destroyed on
						// contact with a maze wall, not bounced. A wall deals no body damage.
						this.destroy = tick.DES;
						this.impactDeath = 1;
					}
					break;
			}
		}
		if (this.destroy) {
			this.release();
		}
	}
	update() {
		if (this.destroy > 1) {
			// Deletion-animation brake, applied before the position step, impact
			// deaths only. Halving speed each tick plants the fade where the hit
			// happened; a shot that ran out of `life` or was shot down has no
			// impact point, and braking it mid-flight reads as hitting an invisible wall.
			if (this.impactDeath) {
				this.vec.x *= DEATH_DRAG;
				this.vec.y *= DEATH_DRAG;
			}
			this.x += this.vec.x;
			this.y += this.vec.y;
			this.destroy -= 1;
			this.alpha = (this.destroy) / tick.DES;
			this.size *= tick.drag(1.1);   // Grow slightly as it fades.
			return;
		}
		///
		let play;
		if (!this.alone) {
			play = this.room.INSTANCE.players.get(this.origin.oId);
			if (typeof play === "undefined") {
				this.release(play);
				this.destroy = tick.DES;
				return;
			} else {
				if (play.destroy > 1 || play.dead || play.state.disconnect || play.class !== this.class) {
					this.release(play);
					this.destroy = tick.DES;
					return;
				}
			}
		}
		///
		switch (this.type) {
			case 0: break;
			//normal//drone
			// A false return means it idled through droneIdleOrbit(), which already flew and
			// committed its own motion - the shared thrust tail below must not also run.
			case 1: if (!droneSteer1(this, play)) { return; } break;
			//minion//
			case 1.5: {
				const engaged = minionSteer(this, play);
				if (!engaged) { return; }
				// The minion's own barrel is live whenever it isn't idle (`engaged`).
				// Reload is read live off the owner's Reload stat every shot.
				if (this.weapon) {
					this.weaponTimer = (this.weaponTimer || 0) + 1;
					const reloadMax = tick.ticks(Math.round(this.weapon.reloadRef * play.up.Reload)) || 1;
					if (this.weaponTimer >= reloadMax) {
						this.weaponTimer = 0;
						const speed = this.weapon.speed;
						const muzzleKick = speed / BULLET_MAINTAIN + 16.8;
						// Along the aim (showDir), not the movement direction - an orbiting minion
						// travels sideways while still shooting at what it's circling. Spawned at
						// the muzzle (1.7 body radii out, matching the drawn barrel length).
						const dir = this.showDir + Math.random() * this.weapon.rand - this.weapon.rand / 2;
						const muzzle = this.size * 1.7;
						const b = new Bullet(this.origin, this.x + Math.cos(this.showDir) * muzzle,
							this.y + Math.sin(this.showDir) * muzzle, dir, speed, muzzleKick, this.room);
						b.type = 0;
						b.class = this.class;
						b.pene = this.weapon.pene;
						b.life = tick.ticks(this.weapon.life);
						b.damage = this.weapon.damage;
						b.size = this.weapon.size;
						b.weight = this.weapon.weight;
						b.push = this.weapon.push;
						b.bdPoints = this.bdPoints;
						this.room.createBullet(b, { team: this.team, dev: {} });
					}
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
				///
				if (!this.DETEC) {
					this.DETEC = new Detector(play, this.x, this.y, droneAggroR(play), [KIND.PLAYER, KIND.OBJECTS])
					this.DETEC.team = this.team
				} else {
					this.DETEC.x = this.x;
					this.DETEC.y = this.y;
					this.DETEC.size = this.DETEC.dis = droneAggroR(play);
				}
				///
				if (this.DETEC.select) {
					this.DETEC.enabled = 0;
					const other = this.DETEC.select;
					if (!other.destroy && other.alpha && droneInAggro(play, other, true)) {
						this.dir = droneChaseDir(this, other);
						this.orbLevel = undefined;
						break;
					} else {
						this.DETEC.reset();
						this.DETEC.enabled = 1;
					}
				}
				droneIdleOrbit(this, play);
				return;
			};
			//battleShip xcontrol//
			case 1.2: {
				this.speed = this.maxspeed;
				///
				if (!this.DETEC) {
					this.DETEC = new Detector(play, this.x, this.y, droneAggroR(play), [KIND.PLAYER, KIND.OBJECTS])
					this.DETEC.team = this.team
				} else {
					this.DETEC.x = this.x;
					this.DETEC.y = this.y;
					this.DETEC.size = this.DETEC.dis = droneAggroR(play);
				}
				///
				if (this.DETEC.select) {
					this.DETEC.enabled = 0;
					const other = this.DETEC.select;
					if (!other.destroy && other.alpha && droneInAggro(play, other, true)) {
						this.showDir = this.vec.angle();
						this.dir = droneChaseDir(this, other);
						this.orbLevel = undefined;
						break;
					} else {
						this.DETEC.reset();
						this.DETEC.enabled = 1;
					}
				}
				droneIdleOrbit(this, play);
				return;
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
				Base drone. Outside a cross or a 'home'/'sort' switch arc, heading (`head`)
				and speed (`spd`) are authoritative and rate-limited; position is their
				integral. A cross and a level-switch arc are the exceptions: position comes
				from a planned quintic Hermite, matched to this field at both seams.

				`chasing`, `crossing` and `switching` are the three real branches; ORBIT/
				RETURN are one orbit field driven off (x,y) relative to the base centre.
				Radius only ever moves in whole LEVEL_GAP steps via levelSwitch(); the field
				steers toward whichever radius the level table currently names.

				Detection is per orbit centre: only the current scout's DETEC is enabled
				(rooms/Room.js tickDroneCentres). A found target is written to the shared
				`levels.threat`; every drone at the centre reads that to start a chase.
			*/
			case 1.4: {
				if (this.switchCooldown > 0) { this.switchCooldown--; }
				///
				this.DETEC.x = this.x;
				this.DETEC.y = this.y;
				// The current scout (rooms/Room.js tickDroneCentres) mirrors whatever it
				// finds into the shared per-centre ledger. `threatAt` is the room timestamp
				// of this sighting - this is the only writer of either field.
				if (this.DETEC.enabled) {
					const t = this.DETEC.select;
					// Polygon bosses are ignored until they provoke the base (body or
					// drone damage). Gated here, at the one place a target enters the
					// shared ledger. Fallen bosses are engaged on sight (`fallen` is set
					// by rooms/Room.js createBoss).
					if (t && !t.destroy && !t.dead && t.alpha &&
						(!t.boss || t.fallen || this.levels.provoked === t.id.oId)) {
						this.levels.threat = t;
						this.levels.threatAt = this.room.timestamp;
					}
					// Fresh scan every tick. Detector.collision() only replaces `select`
					// on a strictly closer find and never re-widens `dis`/`construc`, so
					// without a reset a scout would stay latched on a stale entity. A
					// chasing drone is excluded: it keeps its own reference with the
					// detector disabled.
					if (!this.chasing) { this.DETEC.reset(); }
				}
				// A live, in-leash target pulls the drone into CHASE from any state but
				// a cross (abandoning a planned curve mid-flight would snap velocity). A
				// 'home'/'sort' switch arc IS interrupted. The leash is measured from the
				// base centre, not the drone.
				if (!this.chasing && !this.crossing && this.levels.threat) {
					const other = this.levels.threat;
					const basedis = Math.sqrt(Math.pow(other.x - this.ox, 2) + Math.pow(other.y - this.oy, 2));
					if (basedis < config.BASE_DRONE_LEASH && !other.destroy) {
						this.chasing = true;
						this.switching = false;
						// Keep a private reference - acquiring a target is centralised
						// through levels.threat; the chase itself still reads this drone's
						// own detector every tick.
						this.DETEC.select = other;
						this.DETEC.enabled = 0;
					}
				}
				if (this.chasing) {
					const other = this.DETEC.select;
					const basedis = other ? Math.sqrt(Math.pow(other.x - this.ox, 2) + Math.pow(other.y - this.oy, 2)) : Infinity;
					// Follow a live target as far into the OOB band as a player may run;
					// only death or the leash ends a chase. Not also gated on the clamp
					// box: DETEC.type is [KIND.PLAYER] and Player.js clamps a tank to
					// exactly that box, so a player on the OOB wall would be un-chaseable.
					if (!other || other.destroy || basedis >= config.BASE_DRONE_LEASH) {
						this.chasing = false;
						this.DETEC.reset();
						// Snap `head` onto the orbit field this tick so the drone starts
						// home immediately instead of flying a 180-degree turn further out.
						// Deliberately discontinuous in `head`; `spd` is untouched.
						const f = orbitDesired(this);
						this.head = Math.atan2(f.dy, f.dx);
					}
				}
				// Level-switch triggers: (a) a latched shape-hit reaction (`reactPending`),
				// (b) drone-vs-drone proximity (`tooClose`, folded into reactPending here),
				// (c) the post-swoosh climb home (`homing`) - all through levelSwitch().
				// Mid-cross/mid-chase/mid-switch, a reaction stays latched. The per-centre
				// sorter (rooms/Room.js tickDroneCentres) is the restoring force; there is
				// no separate "drift home on a timer" that would fight it.
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
				// Diameter cross: triggered here, evaluated below as a table read.
				// Suppressed while chasing/switching; gated by `levels.crossing < crossCap`
				// and only from the drone's own ring (planCross builds the entry seam from
				// the circle it is currently flying). `crossIn` still counts down off-ring.
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
						// Lands at level 1 by construction, ignoring saturation - a swoosh
						// always ends at the lowest level, so count[0] may transiently exceed
						// caps[0]; only voluntary switches into level 1 respect the cap.
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
					// The orbit field: tangential, with a radial lean toward orbRTarget.
					// Never normalised - only its angle feeds the turn limiter, so a
					// saturated lean steers straighter at the ring, never changes speed.
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
					// Speed and turn rate blend on the same k, so a fast return cannot
					// swing wide of the ring it is returning to.
					turnLimit = BASE_DRONE_TURN + (BASE_DRONE_CHASE_TURN - BASE_DRONE_TURN) * k;
				}
				// Descriptive only (tests/admin dump) - nothing above or below branches on this.
				// Shares the orbit branch's own `r` rather than recomputing it;
				// when chasing the ternary short-circuits before `r` (left at 0) is ever read.
				this.orbitState = this.chasing ? 'CHASE' : (r > this.orbRTarget * 1.5 ? 'RETURN' : 'ORBIT');
				// Shared steering tail: slew heading and speed toward the state's desired
				// direction/target speed, then integrate. CHASE gets BASE_DRONE_CHASE_TURN;
				// a RETURN blends toward it on the same k as its speed.
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
				// A trap has no maintained thrust: the motion tail skips its cruise add
				// for type 2, and the trap coasts on the muzzle kick through BODY_FRICTION.
				if (!this.first) {
					this.first = 1;
					this.showDir = Math.random() * Math.PI * 2;
				}
				this.showDir += this.vec.length() / 160;
				if (this.armTicks > 0) { this.armTicks--; }
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
					this.DETEC = new Detector(play, this.x, this.y, droneAggroR(play), [KIND.PLAYER, KIND.OBJECTS])
					this.DETEC.team = this.team
				} else {
					this.DETEC.x = this.x;
					this.DETEC.y = this.y;
					this.DETEC.size = this.DETEC.dis = droneAggroR(play);
				}
				///
				if (play.inputs.mouseR) {
					const dir = Math.PI + Math.atan2((play.y + play.inputs.mouse_y) - this.y, play.x + play.inputs.mouse_x - this.x)
					this.dir = dir;
					this.orbLevel = undefined;
				} else if (play.inputs.mouseL || play.inputs.e) {
					const dir = Math.atan2((play.y + play.inputs.mouse_y) - this.y, play.x + play.inputs.mouse_x - this.x)
					this.dir = dir;
					this.orbLevel = undefined;
				} else {
					if (this.DETEC.select) {
						this.DETEC.enabled = 0;
						const other = this.DETEC.select;
						if (!other.destroy && other.alpha && droneInAggro(play, other, true)) {
							this.dir = droneChaseDir(this, other);
							this.orbLevel = undefined;
							break;
						} else {
							this.DETEC.reset();
							this.DETEC.enabled = 1;
						}
					}
					droneIdleOrbit(this, play);
					return;
				}
				break;
			};
			///bigCheese
			case 3.1: {
				this.showDir = this.vec.angle();
				///
				// A boss's own drones (Summoner/Guardian). The boss's `detected` list is its BODY's
				// target search (lib/gameAI.js's bossDetect(), on its own much wider viewRange) -
				// the drones are held to the same DRONE_AGGRO_FOV radius every tank's swarm is, so a
				// boss can be shooting at something its drones correctly ignore.
				if (play.detected && play.detected.length >= 1) {
					let tar, minDis = Infinity;
					for (const n of play.detected) {
						if (!droneInAggro(play, n)) { continue; }
						const dis = Math.sqrt(Math.pow(n.x - this.x, 2) + Math.pow(n.y - this.y, 2));
						if (dis <= minDis) {
							minDis = dis;
							tar = n;
						}
					}
					if (tar && !tar.destroy) {
						this.speed = this.maxspeed;
						this.dir = Math.atan2(tar.y - this.y, tar.x - this.x);
						this.orbLevel = undefined;
						break;
					}
				}
				droneIdleOrbit(this, play);
				return;
			};
			//skimmer//
			case 4: {
				// `showDir` spins the drawn body; `dir` stays the straight-line heading so
				// the motion tail still flies it dead straight. Opposed sub-barrels fire
				// along that spin, reload read live off the owner's Reload stat.
				this.showDir += SKIMMER_SPIN;
				if (this.sub && play) {
					this.subTimer = (this.subTimer || 0) + 1;
					const reloadMax = tick.ticks(Math.round(this.sub.reloadRef * play.up.Reload)) || 1;
					if (this.subTimer >= reloadMax) {
						this.subTimer = 0;
						for (const off of [0, Math.PI]) {
							const dir = this.showDir + off + Math.random() * this.sub.rand - this.sub.rand / 2;
							const speed = this.sub.speed;
							const muzzleKick = speed / BULLET_MAINTAIN + 16.8;
							const b = new Bullet(this.origin, this.x, this.y, dir, speed, muzzleKick, this.room);
							b.type = 0;
							// Drawn under the spinning parent body, not over it - a sub-shot is created
							// after its parent so plain creation-order drawing would paint it on top.
							b.underlay = 1;
							b.class = this.class;
							b.pene = this.sub.pene;
							b.life = tick.ticks(this.sub.life);
							b.damage = this.sub.damage;
							b.size = this.sub.size;
							b.weight = this.sub.weight;
							b.push = this.sub.push;
							b.bdPoints = this.bdPoints;
							this.room.createBullet(b, { team: this.team, dev: {} });
						}
					}
				}
				break;
			};
		}
		/*
			Shared motion tail: constant thrust along `dir`, decayed through BODY_FRICTION,
			integrated into position. tick.quadratic(), not perTick() - the thrust is
			integrated twice over ticks (into vec, then into x/y). A trap (type 2) skips
			the thrust add and coasts on its muzzle kick. BULLET_CRUISE_ORDER compensates
			for this tail displacing the post-friction velocity; applied here so
			TanksConfig.js's `speed` column stays a raw barrel figure.
		*/
		/*
			The muzzle kick lands on the tick after the one that created this bullet, not
			in the constructor. Room.js walks players before bullets, so applying the kick
			at spawn would also step it the same tick and put the shot a radius downrange
			before the first packet. Only the kick waits; cruise, friction and the position
			step still run on the spawn tick.
		*/
		if (this.launchKick) {
			if (this.launched) {
				this.vec.add(new Vec(this.launchKick, 0).rotate(this.launchDir));
				this.launchKick = 0;
			} else {
				this.launched = 1;
			}
		}
		if (this.type !== 2) {
			this.vec.add(new Vec(tick.quadratic(this.speed * BULLET_CRUISE_ORDER), 0).rotate(this.dir))
		}
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
	// Hard-stop map clamp for a life===-1 bullet (a base drone). Shared by the
	// ordinary motion tail and case 1.4's steering tail. Same OOB_MARGIN a tank gets,
	// so a chasing drone can follow a target into the dark band. `steered` is only
	// true for case 1.4's ORBIT/CHASE/RETURN tail, which rederives vec from head/spd
	// every tick - zeroing vec would do nothing, so that branch steers heading along
	// the wall instead.
	clampToMap(steered = false) {
		const mx = this.map.width / 2 + config.OOB_MARGIN, my = this.map.height / 2 + config.OOB_MARGIN;
		// Which wall, not just "some wall" - the steered branch below has to know
		// which component is actually pressing outward.
		let cx = 0, cy = 0;
		if (this.x < -mx) { this.x = -mx; cx = -1; } else if (this.x > mx) { this.x = mx; cx = 1; }
		if (this.y < -my) { this.y = -my; cy = -1; } else if (this.y > my) { this.y = my; cy = 1; }
		if (!cx && !cy) { return; }
		if (!steered) {
			// Ordinary life=-1 bullet, and case 1.4's cross / switch-arc: position
			// comes from elsewhere next tick, so zeroing vec is enough.
			if (cx) { this.vec.x = 0; }
			if (cy) { this.vec.y = 0; }
			return;
		}
		// Steered (case 1.4 ORBIT/CHASE/RETURN): `spd` is authoritative and `vec` is
		// rederived from head/spd next tick, so project heading onto the wall and
		// leave `spd` alone. The drone slides along the boundary at full speed.
		let hx = Math.cos(this.head), hy = Math.sin(this.head);
		if (cx && hx * cx > 0) { hx = 0; }
		if (cy && hy * cy > 0) { hy = 0; }
		if (!hx && !hy) {
			// Pressed into a corner - no along-the-wall direction left, so take the
			// orbit field's answer to which way is home.
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
// One directed, cap-free level-switch step, for the per-centre binomial sorter
// (rooms/Room.js tickDroneCentres). Thin wrapper so Room.js never reaches into
// this module's private levelSwitch().
Bullet.sortSwitch = function (drone, dir) { return levelSwitch(drone, 'sort', dir); };

module.exports = Bullet;
