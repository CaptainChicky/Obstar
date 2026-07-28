/*
	Live server flags.

	This file used to also export a large CONFIG block holding the bot / boss / pet AI.
	It was dead code: the old Alex.js declared its own `var CONFIG` that shadowed it, and the two
	copies had diverged - the copy here called CONFIG.BOT_PATHS / CONFIG.BOTS_UPS while
	defining the keys as BOT_PATH / BOT_UPS, so it would have thrown on the first bot tick
	had anything ever loaded it. Editing AI here changed nothing. The working copy lives in
	lib/gameAI.js; that is the one to edit.
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
	// DES/DEAD_DELAY/KEEP_PLACE are durations in *reference* ticks (see REF_TICK_MS below), like
	// every other raw gameplay constant - one-time-rescaled from their old per-33ms-tick meaning
	// (10, 150, 20) so lib/tick.js's ticks() conversion reproduces the same real-world duration.
	// Consumption sites read tick.DES/tick.DEAD_DELAY/tick.KEEP_PLACE (already converted to real
	// ticks, computed once), never these raw values directly.
	'DES': 8,
	'DEAD_DELAY': 124,   // the nb off ms before the person can replay
	'KEEP_PLACE': 17,
	'SIZE_GET_POS': 40,
	/*
		///////////////////////////////////////////////////////////////////////////////////////
		TICK_MS - milliseconds per simulation step, i.e. how often the server actually steps.
		REF_TICK_MS - the tick every raw gameplay constant (entities/, lib/gameAI.js,
		public/SHARE/TanksConfig.js) is denominated against, converted to TICK_MS at every
		consumption site by lib/tick.js. The two used to be the same number; they no longer are,
		and that split (massplanchunks WP3) is the whole point of this comment.

		Before WP3, every speed/reload/friction/acceleration constant in this codebase was a raw
		per-step number tuned by feel against a *measured* ~29Hz tick (the old fixed-timestep
		clock ran at TICK_MS 33, itself standing in for a pre-clock setTimeout(20) chain that only
		ever achieved ~29Hz under real load - see lib/clock.js). diep.io's own reference tick is a
		clean 40ms/25Hz (PENDING #20 - every technical reload time in the community physics
		reference is a whole multiple of 0.04s). So REF_TICK_MS is 40, not 33: every constant that
		used to mean "per 33ms" has been converted once, at its source, to mean "per 40ms" instead
		(a relabelling verified to reproduce identical real-world behaviour, not a balance change),
		so that diep's own per-40ms-loop numbers (recoil gu, knockback gu, reload loops) can be
		read into this codebase in the future without a 33/40 fudge factor on every one of them.

		TICK_MS is the actual step rate and is now finer than the reference it's denominated
		against: 25ms/40Hz, matching diep.io's own real rate instead of the ~29Hz the old code
		happened to land on. lib/tick.js's SCALE = TICK_MS/REF_TICK_MS (0.625) is computed once
		and is what every per-tick constant is actually multiplied/exponentiated/divided by at its
		consumption site - nothing in entities/ or lib/gameAI.js keeps its own copy of that
		arithmetic.

		Changing either number is a balance project, not a config change: TICK_MS controls how
		finely the simulation samples the world (cost, not feel - a 40Hz room costs ~30% of a core
		against ~23% at the old ~30Hz), while REF_TICK_MS controls what "1" means for every raw
		constant in the tree and would need every one of them re-derived to move again.
		///////////////////////////////////////////////////////////////////////////////////////
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
		Milliseconds between UiUpdate packets (leaderboard, minimap, message feed). Split out of
		the old 1000ms longloop, which also does heartbeat/AFK/rate-limit bookkeeping that has no
		business sharing a cadence with "how fresh does the minimap look" - 150-200ms is smooth
		enough for a HUD without approaching GameUpdate's own rate.
	*/
	'UI_MS': 150,
	/*
		Field of view (massplanchunks WP4). entities/Player.js:472's screen (view width in world
		units) used to be `CLASS[class].screen + level*26` - a guess, flagged in massplanchunks.md
		as needing a real measurement. PENDING.md item 19 did that measurement against diep's own
		FOV numbers (physics.html): diep is 1.39x wider than us at level 1, and its per-level
		growth is multiplicative at exactly half the tank's own growth rate (Math.pow(1.005,
		level), not a flat units-per-level add) - so FOV_MUL replaces the old implicit 1x, and
		FOV_PER_LEVEL is a growth ratio now, not a unit count.
	*/
	'FOV_MUL': 1.39,
	'FOV_PER_LEVEL': 1.005,
	/*
		Out-of-bounds (massplanchunks WP5, re-derived under the grid rescale - plan.md WP1).
		Measured against real diep.io as an overshoot to the tank's *outer edge*, not the centre:
		target <= 5 grid squares of visible overshoot at the new 28-unit pitch (public/SHARE/
		World.js), so the centre margin is 5 squares minus the tank's own radius, gu(5) - 28 = 112.
		It is a hard stop - no spring, no push force. A corner overshoot naturally works out to
		5*sqrt(2) squares because x and y clamp independently; that isn't a separate case to
		implement. Players only (entities/Player.js's motion()) - objs/drones/pets keep their
		existing clamp at the drawn edge.
	*/
	'OOB_MARGIN': gu(4),
	/*
		Base drones and team bases (massplanchunks WP-E), measured against the diep wiki's base
		drone spec plus direct pixel measurements - see PENDING.md for the derivations.
	*/
	'BASE_DRONE_SIZE': 9.2,    // drawn triangle side is size * 1.7 * 1.79 = 3.05 * size (Bullet
	// drawing 1's vertices), so this is collision radius for a 28-unit (1 gu) drawn side - half a
	// level-0 tank's diameter. Smaller than the drawn circumradius (15.6) on purpose: every other
	// drone in the game already collides on that convention (entities/Player.js can.size * ra).
	'BASE_DRONE_HP': 2000,     // the wiki's stated pool, taken literally - PENDING.md flags the
	// MH0-dependent alternative (~6400) this would be on diep's own HP scale
	'BASE_DRONE_DAMAGE': 2.97,   // scale-consistent with a tank's own body damage: 8.48485 * 7/20
	'BASE_DRONE_RESPAWN': 25,    // 1s, in reference ticks (1000/REF_TICK_MS) - read through tick.ticks()
	'BASE_DRONE_CROSS': 250,    // 10s in reference ticks - how often a drone crosses its orbit's diameter
	/*
		Orbit AI (plan.md WP4, corrected under WP4.5). WP4's polar controller wrote the drone's
		position directly (this.x = ox + cos(orbA)*orbR, plus a smootherstep chord for the cross)
		and left velocity a derived leftover - which meant it could turn instantly, and the
		smootherstep swoosh had zero derivative at both ends, so the drone visibly stopped dead at
		the start and end of every cross. WP4.5 inverts that: heading and speed are authoritative
		and rate-limited (BASE_DRONE_TURN/BASE_DRONE_ACCEL below), position is their integral, and
		ORBIT/CROSS/CHASE all steer the same shared tail - see entities/Bullet.js's case 1.4.
	*/
	/*
		Five energy levels (plan.md WP4.5.1) - radius is quantised now, not a continuous random
		band. levelR(n) = ORBIT_R + (n - LEVEL_HOME) * LEVEL_GAP, so level 3 (home) sits at the
		nominal ORBIT_R and levels 1/2/4/5 sit one/two drone-sides in or out of it. Both team modes
		share this one table (rooms/Room.js's levelR()/levelPlan()) - 2team's old per-mode
		nominalR is gone.
	*/
	'BASE_DRONE_ORBIT_R': gu(8),        // level 3 (home)'s radius - the table's one anchor.
	'BASE_DRONE_LEVELS': 5,              // user spec
	'BASE_DRONE_LEVEL_GAP': gu(1),       // 28 units, one drone-side - BASE_DRONE_SIZE's own comment
	// already records the drawn side as size * 3.05 = 28.
	'BASE_DRONE_LEVEL_HOME': 3,          // the level a drone drifts back to; sits at ORBIT_R.
	'BASE_DRONE_LEVEL_WEIGHTS': [1, 4, 6, 4, 1],   // Binomial(4, 1/2) - five bins centred on level
	// 3. Read both as a saturation cap (ceil) and as a target occupancy (largest-remainder
	// apportionment) by rooms/Room.js's levelPlan()/levelTargets() - the sorter (plan.md WP4.5.0)
	// re-derives the target for the LIVE drone count every pass, memoised per count on the ledger.
	'BASE_DRONE_LEVEL_RELAX': 25,        // ref ticks = 1.0s per step home (plan.md WP4.5.0) - with
	// the 'home' switch's own ~1.90s planned arc (BASE_DRONE_SWITCH_LEAN below), a post-swoosh
	// drone's 1->2->3 climb is 2*(1.0+1.90) = 5.8s, still "slowly over like a few seconds".
	'BASE_DRONE_SWITCH_COOLDOWN': 25,    // ref ticks = 1.0s. Only ever gated the REACTIVE triggers
	// (shape hit, drone-proximity) - the drift-home ('home') trigger has never checked it, and
	// still doesn't now that it plans its own arc (plan.md WP4.5.0); its own pacing is
	// LEVEL_RELAX plus the `switching` state's exclusivity. A switch's own reactive radial travel
	// takes ~0.38s (LEVEL_GAP / (ORBIT_SPEED*sin60)), so this leaves ~0.6s settled before another
	// reactive one can fire - was BASE_DRONE_HIT_COOLDOWN (12/0.48s), too short for the new
	// discrete-level motion.
	'BASE_DRONE_SEPARATION': 26.3,       // 2 * 1.7 * BASE_DRONE_SIZE - 5: two drones touch (drawn
	// vertex to drawn vertex) at 2*1.7*9.2 = 31.3 apart, so this is 5 units of overlap. Strictly
	// less than LEVEL_GAP (28), which is the property WP4.5.0 rests on - two drones on different
	// levels are 28+ apart and can never trigger this; it only ever fires within a level, and the
	// answer is always to leave that level.
	'BASE_DRONE_ORBIT_SPEED': 3.41,     // per ref tick -> 85.25 u/s tangential cruise speed - 1.5x
	// the old carrot-chase's actual 56.8 u/s (plan.md WP4.5.0; WP4's 4.56/114u/s overshot at 2x).
	'BASE_DRONE_CHASE_SPEED': 16.0,      // per ref tick -> 400 u/s (plan.md WP4.5.1). Pinned, not
	// guessed: measured by replaying entities/Player.js's own motion()/shoot() recurrence over
	// every reachable class/level at 6 Movement Speed and 6 Reload (test/rooms.js's
	// fastestTankSpeed()), the ceiling any build in this game can actually sustain is ~400 u/s
	// (Fighter L29 riding its rear pair, 399.2 u/s measured). The user's own instruction: the drone
	// is EXACTLY as fast as the fastest thing that can exist - not faster, so a lap around a base in
	// the fastest tank config is still survivable, and not slower, so nothing outruns it on straight
	// speed. Also the return-to-ring speed (case 1.4's return blend, below) - a return is a chase
	// back to the ring, so it runs at the same speed. Was 11.4 (285 u/s, a level-0 tank's own top
	// speed - PENDING #14 - which undersold every upgraded build); before that HEAD's pre-WP4.5
	// chase fell through the shared bullet tail at .75 maxspeed and actually ran 665 u/s, 2.3x every
	// tank in the game.
	'BASE_DRONE_CHASE_TURN': 0.267,      // rad per ref tick = 6.67 rad/s, used instead of
	// BASE_DRONE_TURN whenever a drone is chasing (plan.md WP4.5.1). Derived: holding the turn
	// radius (v/omega) at the ~60-unit, one-tank-diameter figure the old constant was chosen for,
	// re-run at the new 400u/s dash: 400/60 = 6.67 rad/s. Leaving it at the old 4.75 would put the
	// radius at 84 units and the drone would arc around a strafing target instead of turning inside it.
	'BASE_DRONE_RETURN_ERR': gu(8),      // = 224, the radius error at which the return-to-ring
	// speed blend (case 1.4, plan.md WP4.5.1) reaches full BASE_DRONE_CHASE_SPEED - the home
	// level's own radius, i.e. a drone a whole orbit's worth off its ring drives back at full dash
	// and smoothsteps down to cruise as it arrives, rather than ringing around the target radius.
	'BASE_DRONE_TURN': 0.10,            // rad per ref tick = 2.5 rad/s heading slew rate (plan.md
	// WP4.5.0). Floor: the tightest orbit (r = 0.45*gu(8) = 100.8) needs 85.25/100.8 = 0.85rad/s
	// to actually turn the ring at cruise speed - this leaves 3x headroom. Turn radius at cruise
	// is 34 units (~1.2gu). Governs ORBIT and the 'home'/'sort' switch arc's own hand-off; CHASE
	// uses BASE_DRONE_CHASE_TURN above instead.
	'BASE_DRONE_ACCEL': 1.9,            // units per ref tick per ref tick - speed slew rate. The
	// cruise<->dash ramp (3.41 -> 16.0 u/tick) takes (16.0-3.41)/1.9 = 6.6 ref ticks = 0.27s
	// (plan.md WP4.5.1) - still nothing next to the ~2.0-2.65s swoosh (4.5.1 below).
	'BASE_DRONE_CROSS_SPEED': 14.8,     // per ref tick -> 370 u/s. The NOMINAL PEAK (plan.md
	// WP4.5.1), held from BASE_DRONE_CROSS_RAMP of the path to (1 - BASE_DRONE_CROSS_RAMP) of it -
	// a real plateau across the middle of the swoosh, not a single point. The actual per-cross peak
	// (vPeak) is solved so the walk lands on a whole tick and measures within ~1% of this value at
	// every level (it can now land slightly UNDER nominal as well as over, since rounding the
	// duration up to a whole tick costs speed over a much longer stretch of path than it used to).
	'BASE_DRONE_CROSS_RAMP': 0.25,      // the fraction of the swoosh's path spent ramping up to
	// CROSS_SPEED, and the same fraction again ramping back down - so the drone is at peak from
	// 25% of the way across to 75% (plan.md WP4.5.1, the user's own "accelerate... reach max
	// velocity at like 25%... deaccelerate starting at 75%"). 0.50 would touch peak at the exact
	// centre with no plateau at all (the previous pass's build). Because the two C2 blends are
	// ~80% of the path (BASE_DRONE_CROSS_BLEND_FRAC below), a knee at 0.25 lands deep inside the
	// still-tight entry blend: measured, peak turn rate rises from 5.63 to 8.46 rad/s and peak
	// accel from 0.79 to 1.95 (both still comfortably inside test/rooms.js's pinned 10 rad/s / 2.5
	// bounds), while the dive itself gets ~25% quicker (2.67-3.58s -> 2.00-2.65s) and a full third
	// of the path is spent at-or-near peak instead of 2% of it. If a played build reads as whippy
	// or hooked at the two ends, 0.40 is the next stop and nothing else needs to change - it keeps
	// today's turn rate (5.76 vs 5.63 rad/s) while still giving a real 13% plateau and a 2.4-3.2s
	// dive. Do not go below 0.25: at 0.20 the ramp is shorter than the entry blend's tightest
	// quarter and the accel bound stops being defensible.
	'BASE_DRONE_CROSS_BLEND_FRAC': 0.70,   // the fraction of ITS OWN RADIUS each end of the
	// straight gives up to a C2 blend (plan.md WP4.5.0) - changed meaning as well as value: it
	// used to be a fraction of the whole CHORD (0.20), which had a hard geometric ceiling
	// (f < min(r0,R1)/(r0+R1)) past which the orbit centre fell outside the straight. Measured
	// per side off each end's own radius instead, the centre stays strictly on the straight for
	// EVERY f < 1 at every level, so there is no ceiling to assert any more. 0.70 (with
	// BASE_DRONE_CROSS_LEAD below) stretches both blends to ~2.0x their old length - the user's
	// "make this like 3x the current amount" request, landed at the last setting where the peak
	// turn rate is still lower than before (5.65 vs 6.07 rad/s); 0.75 is the next stop if more
	// stretch is wanted, but it turns harder than today's build.
	'BASE_DRONE_CROSS_LEAD': 0.125,       // fraction of a full turn (0.785 rad) the diameter's own
	// line is offset from the drone's actual position, applied again at the exit landing point
	// (plan.md WP4.5.0) - the other half of the x2.0 stretch (BLEND_FRAC alone tops out around
	// x1.7). Without this offset the entry blend would have to join a line the drone is already
	// sitting ON while moving perpendicular to it, which no C2 curve can do without folding into a
	// cusp - see plan.md WP4.5.0's "load-bearing" note.
	'BASE_DRONE_SWITCH_LEAN': 0.17453,   // 10 degrees, in radians - the lean off the tangent a
	// GRADUAL ('home'/'sort') level switch flies (plan.md WP4.5.0), replacing the deleted
	// BASE_DRONE_SWITCH_ARC (a fraction of the circumference). The old constant produced a
	// different lean on every ring (14.8/11.3/9.0 degrees at levels 1/3/5) because a fixed
	// fraction of a bigger circle sweeps a bigger angle; naming the lean directly instead makes
	// every gradual switch the same 158.8-unit, 76-tick (1.90s) motion regardless of which ring it
	// happens on. Read beside BASE_DRONE_HIT_TURN (60 degrees, the sharp REACTIVE peel) below -
	// the two are now the same kind of quantity.
	'BASE_DRONE_LEAN_SCALE': 16.17,     // LEVEL_GAP / tan(60deg) = 28 / 1.7320508 = 16.17 - pinned
	// by the user's spec (plan.md WP4.5.0), not derived from a kick formula any more: a level
	// switch is a radius error of exactly one LEVEL_GAP, and the user says a level switch is a 60
	// degree turn, so this is the number that makes the orbit field actually produce that lean.
	// Was gu(1) = 28, which gave 45 degrees off the deleted BASE_DRONE_HIT_KICK derivation.
	// Unchanged by WP4.5.0's arc pass - it only ever drives the REACTIVE ('random') path's lean;
	// a 'home'/'sort' switch flies BASE_DRONE_SWITCH_LEAN's planned curve instead and never reads
	// this.
	'BASE_DRONE_LEAN_MAX': 8,           // atan(8) = 83 degrees - the near-radial lean saturation
	// used on a long return, so a drone far off its ring drives back in almost a straight line
	// instead of an ever-tightening spiral.
	'BASE_DRONE_HIT_TURN': 1.0472,      // 60 degrees - the angle a REACTIVE ('random') level
	// switch actually produces (plan.md WP4.5.0): BASE_DRONE_LEAN_SCALE above is derived FROM this
	// figure (LEVEL_GAP / tan(HIT_TURN)), not the other way round as it used to be. Pins the
	// shape-hit/drone-proximity path specifically - a 'home'/'sort' switch's own identity is
	// BASE_DRONE_SWITCH_LEAN above, unrelated to this figure.
	'BASE_DRONE_DETECT': gu(60),        // enemy detection range - was a bare 1200 in Bullet.js
	'BASE_DRONE_LEASH': gu(90),         // max distance from base before a chase is abandoned - was
	// a bare 1800 in Bullet.js
	'BASE_DRONE_SORT_PERIOD': 25,        // ref ticks = 1.0s (plan.md WP4.5.0) - how often each
	// orbit centre's binomial sorter compares live occupancy against BASE_DRONE_LEVEL_WEIGHTS and
	// walks a random number of surplus drones one level toward the nearest deficit, on the
	// gradual arc. The user's own "every second". Per CENTRE, not per drone - rooms/Room.js runs
	// it once per centre, not once per drone's own update().
	'BASE_DRONE_SCAN': 5,        // real ticks (0.125s at today's TICK_MS 25) - how often an orbit
	// centre's detection SCOUT rotates (plan.md WP4.5.0 - the mechanism is kept; its original cost
	// justification is withdrawn by 4.5.4, which re-measured properly and found base drones were
	// never 46% of a tick - that number came from profiling a 4team room settled for only 600
	// steps against the ~6500 it actually needs, so base drones read as a third of the room's
	// entities instead of a fifteenth). At most one drone per centre has its detector enabled at a
	// time, rotating round-robin every this many real ticks; the rest fall back to a size*2 query -
	// a real, if smaller, saving on its own merits. A raw tick count (not ref-tick converted) on
	// purpose - this is a simulation-cost knob, not a gameplay-feel one, the same category as
	// GENERATE_EVERY in rooms/Room.js. Worst-case detection staleness is BASE_DRONE_SCAN * (drones
	// at that centre - 1) ticks; at 5 ticks and 400u/s (the fastest thing in the game) that is at
	// most 50 units against a 1680-unit detect radius - 3%.
	'BASE_DRONE_PENE': 1,               // the ordinary-bullet pene convention (entities/Bullet.js's
	// constructor default), read by entities/Objects.js in place of a base drone's own `pene` -
	// which is a 2000-point health pool, not a penetration value, and was one-shotting every shape
	// a drone touched (plan.md WP4.5.0).
	// How far an enemy bullet penetrates past the true base line before it counts as "in the
	// base" and dies - 1.5 grid squares by construction (PENDING #13), re-derived under the new
	// 28-unit pitch (plan.md WP1) as gu(1.5). Players still die exactly at the line (rooms/Room.js
	// passes margin 0 for them).
	'BASE_BULLET_MARGIN': gu(1.5)
}
