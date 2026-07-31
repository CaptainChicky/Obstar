/*
	Live server flags. The bot / boss / pet AI lives in lib/gameAI.js, not here.
*/
const World = require('../public/SHARE/World.js');
const gu = World.gu;

exports.config = {
	'DB': {
		'ON': false,
		'ACC': false,
		'SHOP': false,
		'DEV': false,
		'LB': false,
		'AUTH': false
	},
	'KEY_ISNEEDED': false, //dont apply if DB.ON or DB.ACC is off
	'S_BEFORE_KICK': 120,   // the nb of seconds before kicking someone afk on the death screen
	'MAX_IP': 2,     // max tabs someone can play on
	// Durations in *reference* ticks (REF_TICK_MS below), like every other raw gameplay constant.
	// Consumption sites read tick.DES / tick.DEAD_DELAY / tick.KEEP_PLACE - already converted to
	// real ticks, computed once - never these raw values.
	'DES': 8,
	'DEAD_DELAY': 124,   // the nb off ms before the person can replay
	'KEEP_PLACE': 17,
	'SIZE_GET_POS': 40,
	/*
		TICK_MS is how often the server actually steps. REF_TICK_MS is the tick every raw gameplay
		constant (entities/, lib/gameAI.js, public/SHARE/TanksConfig.js) is denominated against;
		lib/tick.js converts between them at each consumption site through SCALE = TICK_MS /
		REF_TICK_MS, and nothing else keeps its own copy of that arithmetic.

		They are different numbers on purpose. 40ms is diep.io's own loop, so diep's per-loop
		figures (recoil gu, knockback gu, reload loops) read straight in without a fudge factor;
		25ms is how finely we sample the world, which is a cost decision (~30% of a core per busy
		room at 40Hz against ~23% at 30Hz) rather than a feel one.

		Changing either is a balance project. TICK_MS is safe only to the extent lib/tick.js's
		categories are right; REF_TICK_MS redefines what "1" means for every raw constant in the
		tree and needs all of them re-derived.
	*/
	'TICK_MS': 25,
	'REF_TICK_MS': 40,
	/*
		Milliseconds between GameUpdate packets to each client. Deliberately independent of
		TICK_MS - a send is a snapshot of wherever the simulation had got to.

		Keep it >= TICK_MS. Sending faster than the simulation steps means consecutive packets
		carry an identical world, and the client's snapshot interpolation (public/motion.js)
		reads a pair of identical positions as "stopped" and then the next pair as double
		distance - i.e. visible stutter, from sending *more* data.
	*/
	'SEND_MS': 33,
	/*
		Milliseconds between UiUpdate packets (leaderboard, minimap, message feed). Kept off the
		1000ms longloop's cadence, which does heartbeat/AFK/rate-limit bookkeeping and has no
		business deciding how fresh the minimap looks.
	*/
	'UI_MS': 150,
	/*
		Field of view, in world units of view width (entities/Player.js's `screen`). Measured
		against diep: it is 1.39x wider than us at level 1, and grows multiplicatively at exactly
		half the tank's own growth rate - so FOV_PER_LEVEL is a ratio, not a units-per-level add.
	*/
	'FOV_MUL': 1.39,
	'FOV_PER_LEVEL': 1.005,
	/*
		How far past the drawn map edge a player may go, measured against diep as an overshoot of
		the tank's *outer edge*: 5 grid squares at the 28-unit pitch, so the centre margin is
		gu(5) - 28 = 112. A hard stop - no spring, no push force. A corner overshoot works out to
		5*sqrt(2) squares because x and y clamp independently; that is not a separate case.
		Players only (entities/Player.js's motion()) - objs/drones/pets clamp at the drawn edge.
	*/
	'OOB_MARGIN': gu(4),
	/*
		Base drones and team bases, measured against the diep wiki's base drone spec plus direct
		pixel measurements. PENDING.md carries the two derivations still open (the HP scale and
		the damage figure).
	*/
	'BASE_DRONE_SIZE': 9.2,    // collision radius for a 28-unit (1 gu) drawn side: the drawn
	// triangle's side is size * 1.7 * 1.79. Smaller than the drawn circumradius (15.6) on purpose -
	// every other drone in the game collides on that same convention (can.size * ra).
	// diep's own raw 2000 (PENDING #23, plan.md step 5) - NOT the ~6400 that item used to call for.
	// That figure was ~7.1x our OLD maxed tank's pool (945, from the pre-#17 150+3/lvl+110/pt
	// formula), computed because our HP scale used to be inflated relative to diep's own. #17
	// (plan.md step 4) replaced that formula wholesale with diep's raw MH0=50/+2/level/+20/point,
	// so a maxed tank's pool is now EXACTLY diep's own maxed pool - verified by computation, not
	// assumed: 50 + 44*2 + 7*20 = 278, and 2000/278 = 7.194, matching the wiki's own "~7.1x a maxed
	// tank" ratio on the nose. There is no longer a scale gap for the drone HP to track: our HP
	// scale already IS diep's, so the "faithful number on our scale" the old comment described is
	// just diep's own number again. Re-derive this the same way if MH0/the level or point cap ever
	// change (grep the tree for "278" too, not just this constant's name - PENDING #37).
	'BASE_DRONE_HP': 2000,
	// scale-consistent with a tank's own body damage: 13.852814 * 7/20 (entities/Player.js's
	// this.damage base, PENDING #17) - the wiki's own 7-vs-20 bullet:body-damage ratio, applied in
	// reverse to get a drone dealing bullet-like damage rather than a full body ram. Lands on
	// exactly 4.84848, Basic's own can.damage (TanksConfig.js) - not a coincidence, since that ratio
	// is where 13.852814 itself came from.
	'BASE_DRONE_DAMAGE': 4.84848,
	'BASE_DRONE_RESPAWN': 25,    // 1s, in reference ticks (1000/REF_TICK_MS) - read through tick.ticks()
	'BASE_DRONE_CROSS': 250,    // 10s in reference ticks - how often a drone crosses its orbit's diameter
	/*
		Orbit AI. Heading and speed are authoritative and rate-limited (BASE_DRONE_TURN /
		BASE_DRONE_ACCEL); position is their integral. ORBIT, CROSS and CHASE all steer the same
		shared tail - see entities/Bullet.js's case 1.4.

		Radius is quantised into five energy levels, not a continuous band:
		levelR(n) = ORBIT_R + (n - LEVEL_HOME) * LEVEL_GAP, so level 3 (home) sits at the nominal
		ORBIT_R and 1/2/4/5 sit one or two drone-sides in or out of it. Both team modes share the
		one table (rooms/Room.js's levelR()/levelPlan()).
	*/
	'BASE_DRONE_ORBIT_R': gu(8),        // level 3 (home)'s radius - the table's one anchor.
	'BASE_DRONE_LEVELS': 5,              // user spec
	'BASE_DRONE_LEVEL_GAP': gu(1),       // 28 units, one drone-side (see BASE_DRONE_SIZE).
	'BASE_DRONE_LEVEL_HOME': 3,          // the level a drone drifts back to; sits at ORBIT_R.
	'BASE_DRONE_LEVEL_WEIGHTS': [1, 4, 6, 4, 1],   // Binomial(4, 1/2) - five bins centred on level
	// 3. Read both as a saturation cap (ceil) and as a target occupancy (largest-remainder
	// apportionment) by rooms/Room.js's levelPlan()/levelTargets(); the sorter re-derives the
	// target for the LIVE drone count every pass, memoised per count on the ledger.
	'BASE_DRONE_LEVEL_RELAX': 25,        // ref ticks = 1.0s per step home. With the 'home' switch's
	// own ~1.90s planned arc (BASE_DRONE_SWITCH_LEAN), a post-swoosh drone's 1->2->3 climb is 5.8s.
	'BASE_DRONE_SWITCH_COOLDOWN': 25,    // ref ticks = 1.0s. Gates the REACTIVE triggers (shape hit,
	// drone-proximity) only - a gradual 'home'/'sort' switch is paced by LEVEL_RELAX and the
	// `switching` state's exclusivity instead. A reactive switch's own radial travel takes ~0.38s
	// (LEVEL_GAP / (ORBIT_SPEED*sin60)), so this leaves ~0.6s settled before another can fire.
	'BASE_DRONE_SEPARATION': 26.3,       // 2 * 1.7 * BASE_DRONE_SIZE - 5: two drones touch (drawn
	// vertex to drawn vertex) at 31.3 apart, so this is 5 units of overlap. Strictly less than
	// LEVEL_GAP (28), and the level machinery rests on that: two drones on different levels are
	// 28+ apart and can never trigger it, so it only ever fires within a level and the answer is
	// always to leave that level.
	'BASE_DRONE_ORBIT_SPEED': 3.41,     // per ref tick -> 85.25 u/s tangential cruise.
	'BASE_DRONE_CHASE_SPEED': 21.8545,     // per ref tick -> 546.36 u/s, and also the return-to-ring
	// speed (a return is a chase back to the ring). Pinned to the fastest sustained speed any build
	// in this game can hold, measured by test/rooms.js's fastestTankSpeed() replaying Player's own
	// motion()/shoot() recurrence over every reachable class - currently a maxed-Movement Sniper at
	// L15 riding its own recoil, 546.36 u/s. The reload stat is diep's geometric 0.914^points
	// (diepcustom/src/Entity/Tank/TankBody.ts:267), so a maxed-Reload tank fires less often, and
	// therefore rides less recoil, than under the old linear form - which is why the ceiling sits at
	// 546.36 rather than the 559.2 the linear reload gave.
	// NOT diep's model: diep's base drone runs a flat 54 du/tick = 756 u/s
	// (diepcustom/src/Entity/Misc/BaseDrones.ts, bullet.speed 2.7), pinned to nothing - our
	// pin-to-the-fastest-tank is our own mechanic. Step 10 adopts diep's 756 and retires this pin.
	// The spec until then is EXACTLY that ceiling: not faster, so lapping a base in the fastest tank
	// stays survivable; not slower, so nothing outruns a drone on straight-line speed.
	// test/rooms.js fails if the two drift apart.
	'BASE_DRONE_CHASE_TURN': 0.36424,    // rad per ref tick = 9.11 rad/s, used instead of
	// BASE_DRONE_TURN whenever a drone is chasing, and as the TOP of the return's turn blend.
	// Derived by holding the turn radius (v/omega) at ~60 units, one tank diameter, at the 546.36 u/s
	// dash: 546.36/60 = 9.11. It rides the same smoothstep k as the return's speed blend, which is
	// what keeps a fast return from swinging wide of its ring. Re-pinned with CHASE_SPEED above and
	// for the same reason - the pair must move together or the radius stops being 60 units.
	'BASE_DRONE_RETURN_ERR': gu(8),      // = 224, the radius error at which the return-to-ring speed
	// blend reaches full BASE_DRONE_CHASE_SPEED - the home level's own radius. A drone a whole
	// orbit's worth off its ring drives back at full dash and smoothsteps down to cruise as it
	// arrives. The same k drives the turn limiter, so v/omega holds at 34-60 units in every state.
	'BASE_DRONE_TURN': 0.10,            // rad per ref tick = 2.5 rad/s heading slew. Floor: the
	// tightest orbit (r = 0.45*gu(8) = 100.8) needs 85.25/100.8 = 0.85 rad/s to turn its ring at
	// cruise, so this leaves 3x headroom; turn radius at cruise is 34 units. Governs ORBIT and the
	// gradual switch arc's hand-off - CHASE uses BASE_DRONE_CHASE_TURN.
	'BASE_DRONE_ACCEL': 1.9,            // units per ref tick per ref tick - speed slew. The
	// cruise<->dash ramp (3.41 -> 16.0) takes 6.6 ref ticks = 0.27s, nothing next to the ~2.0-2.65s
	// swoosh.
	'BASE_DRONE_CROSS_SPEED': 14.8,     // per ref tick -> 370 u/s. The NOMINAL PEAK, held from
	// BASE_DRONE_CROSS_RAMP of the path to (1 - RAMP) of it. The actual per-cross peak (vPeak) is
	// solved so the walk lands on a whole tick, and measures within ~1% of this at every level.
	'BASE_DRONE_CROSS_RAMP': 0.25,      // fraction of the swoosh's path spent ramping up to
	// CROSS_SPEED, and the same again ramping down - so the drone is at peak from 25% of the way
	// across to 75% (the user's own "reach max velocity at like 25%... deaccelerate starting at
	// 75%"). 0.50 would touch peak at the centre with no plateau at all. Because the two C2 blends
	// are ~80% of the path (BLEND_FRAC below), a knee at 0.25 lands deep inside the entry blend:
	// peak turn 8.46 rad/s and peak accel 1.95, inside test/rooms.js's pinned 10 / 2.5 bounds. If a
	// played build reads as whippy at the ends, 0.40 is the next stop and nothing else moves with
	// it; below 0.25 the ramp is shorter than the entry blend's tightest quarter and the accel
	// bound stops being defensible.
	'BASE_DRONE_CROSS_BLEND_FRAC': 0.70,   // the fraction of ITS OWN RADIUS each end of the straight
	// gives up to a C2 blend. Measured per side off each end's own radius, not off the whole chord,
	// so the orbit centre stays strictly on the straight for every f < 1 at every level - there is
	// no geometric ceiling to assert. With CROSS_LEAD below this puts both blends at ~80% of the
	// path; 0.75 is the next stop if more stretch is wanted, at a higher peak turn rate.
	'BASE_DRONE_CROSS_LEAD': 0.125,       // fraction of a full turn (0.785 rad) the diameter's own
	// line is offset from the drone's actual position, applied again at the exit landing point.
	// Load-bearing: without the offset the entry blend would have to join a line the drone is
	// already sitting ON while moving perpendicular to it, which no C2 curve can do without folding
	// into a cusp.
	'BASE_DRONE_SWITCH_LEAN': 0.17453,   // 10 degrees in radians - the lean off the tangent a
	// GRADUAL ('home'/'sort') level switch flies. Naming the lean directly (rather than a fraction
	// of the circumference, which sweeps a bigger angle on a bigger ring) makes every gradual
	// switch the same 158.8-unit, 76-tick (1.90s) motion whichever ring it happens on. Read beside
	// BASE_DRONE_HIT_TURN, the sharp reactive peel - the two are the same kind of quantity.
	'BASE_DRONE_LEAN_SCALE': 16.17,     // LEVEL_GAP / tan(60deg) - the number that makes the orbit
	// field produce the user's specified 60-degree turn for a radius error of exactly one
	// LEVEL_GAP. Drives the REACTIVE ('random') path only; a gradual switch flies
	// BASE_DRONE_SWITCH_LEAN's planned curve and never reads this.
	'BASE_DRONE_LEAN_MAX': 8,           // atan(8) = 83 degrees - near-radial lean saturation on a
	// long return, so a drone far off its ring drives back almost straight instead of spiralling.
	'BASE_DRONE_HIT_TURN': 1.0472,      // 60 degrees - the angle a REACTIVE ('random') level switch
	// produces, and the figure BASE_DRONE_LEAN_SCALE above is derived from. Pins the
	// shape-hit/drone-proximity path specifically.
	'BASE_DRONE_DETECT': gu(60),        // enemy detection range
	'BASE_DRONE_LEASH': gu(90),         // max distance from base before a chase is abandoned
	'BASE_DRONE_SORT_PERIOD': 25,        // ref ticks = 1.0s - how often each orbit centre's binomial
	// sorter compares live occupancy against BASE_DRONE_LEVEL_WEIGHTS and walks a random number of
	// surplus drones one level toward the nearest deficit, on the gradual arc. Per CENTRE, not per
	// drone - rooms/Room.js runs it once per centre.
	'BASE_DRONE_SCAN': 5,        // real ticks (0.125s at TICK_MS 25) - how often an orbit centre's
	// detection SCOUT rotates. At most one drone per centre has its detector enabled at a time; the
	// rest fall back to a size*2 query. A raw tick count, not ref-tick converted, on purpose: this
	// is a simulation-cost knob, same category as GENERATE_EVERY in rooms/Room.js. Worst-case
	// detection staleness is SCAN * (drones at that centre - 1) ticks; at 400 u/s that is at most
	// 50 units against a 1680-unit detect radius.
	'BASE_DRONE_PROVOKE_MEMORY': 250,   // ref ticks = 10s - how long an orbit centre keeps chasing a
	// POLYGON boss after that boss last hurt one of its drones. Base drones defend against the
	// Fallen bosses on sight but "usually don't target Polygon-based Bosses... unless those provoke
	// them first via body damage or drone damage" (basedrones.txt); our only boss is the Summoner,
	// a polygon boss.
	// How far an enemy bullet penetrates past the true base line before it counts as "in the base"
	// and dies - 1.5 grid squares by construction. Players still die exactly at the line
	// (rooms/Room.js passes margin 0 for them).
	'BASE_BULLET_MARGIN': gu(1.5)
}
