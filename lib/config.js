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
	// 3. Read both as a saturation cap (ceil) and as initial occupancy (largest-remainder
	// apportionment) by rooms/Room.js's levelPlan().
	'BASE_DRONE_LEVEL_RELAX': 50,        // ref ticks = 2.0s per step home - a post-swoosh drone at
	// level 1 climbs 1->2->3 in ~4s ("slowly over like a few seconds").
	'BASE_DRONE_SWITCH_COOLDOWN': 25,    // ref ticks = 1.0s, shared by all three level-switch
	// triggers (shape hit, drone-proximity, drift-home). A switch's own radial travel takes
	// ~0.38s (LEVEL_GAP / (ORBIT_SPEED*sin60)), so this leaves ~0.6s settled before another can
	// fire - was BASE_DRONE_HIT_COOLDOWN (12/0.48s), too short for the new discrete-level motion.
	'BASE_DRONE_SEPARATION': 26.3,       // 2 * 1.7 * BASE_DRONE_SIZE - 5: two drones touch (drawn
	// vertex to drawn vertex) at 2*1.7*9.2 = 31.3 apart, so this is 5 units of overlap. Strictly
	// less than LEVEL_GAP (28), which is the property WP4.5.3 rests on - two drones on different
	// levels are 28+ apart and can never trigger this; it only ever fires within a level, and the
	// answer is always to leave that level.
	'BASE_DRONE_CROSS_ARC': 1.03,        // the planned S's path length over (r0 + levelR(1)) -
	// measured, not guessed (plan.md WP4.5.4/4.5.8): drive a cross, sum |vec| per tick, divide by
	// (r0+R1) - test/rooms.js prints the measured ratio (1.0279 at the current level table/speeds)
	// every run, so a future retune of ORBIT_SPEED/CROSS_SPEED/the level table should re-read it
	// and correct this back to the fixpoint.
	'BASE_DRONE_ORBIT_SPEED': 3.41,     // per ref tick -> 85.25 u/s tangential cruise speed - 1.5x
	// the old carrot-chase's actual 56.8 u/s (plan.md WP4.5.3; WP4's 4.56/114u/s overshot at 2x).
	'BASE_DRONE_CHASE_SPEED': 3.41,     // same cruise as orbit, but its own knob so it can be
	// tuned independently later - WP4's CHASE used to fall through to the shared bullet motion
	// tail (maxspeed/FRICTION), which chased at the old 56.8u/s while orbiting at a different
	// speed entirely; both states now go through the one steering tail below at their own speed.
	'BASE_DRONE_TURN': 0.10,            // rad per ref tick = 2.5 rad/s heading slew rate (plan.md
	// WP4.5.4). Floor: the tightest orbit (r = 0.45*gu(8) = 100.8) needs 85.25/100.8 = 0.85rad/s
	// to actually turn the ring at cruise speed - this leaves 3x headroom. Turn radius at cruise
	// is 34 units (~1.2gu).
	'BASE_DRONE_ACCEL': 1.9,            // units per ref tick per ref tick - speed slew rate. The
	// cruise<->cross ramp (3.41 -> 14.8 u/tick) takes (14.8-3.41)/1.9 = 6 ref ticks = 0.24s.
	'BASE_DRONE_CROSS_SPEED': 14.8,     // per ref tick -> 370 u/s. Value unchanged from WP4.5's
	// first pass, meaning changed (plan.md WP4.5.4): this is now the Hermite curve's mid-knot
	// (peak, at the orbit centre) speed, not a fixed dash duration - the swoosh's ~2.0s total
	// (T_A + T_B) is emergent from CROSS_ARC and the level radii, not the other way round.
	'BASE_DRONE_LEAN_SCALE': 16.17,     // LEVEL_GAP / tan(60deg) = 28 / 1.7320508 = 16.17 - pinned
	// by the user's spec (plan.md WP4.5.2), not derived from a kick formula any more: a level
	// switch is a radius error of exactly one LEVEL_GAP, and the user says a level switch is a 60
	// degree turn, so this is the number that makes the orbit field actually produce that lean.
	// Was gu(1) = 28, which gave 45 degrees off the deleted BASE_DRONE_HIT_KICK derivation.
	'BASE_DRONE_LEAN_MAX': 8,           // atan(8) = 83 degrees - the near-radial lean saturation
	// used on a long return, so a drone far off its ring drives back in almost a straight line
	// instead of an ever-tightening spiral.
	'BASE_DRONE_HIT_TURN': 1.0472,      // 60 degrees - the angle a level switch actually produces
	// now (plan.md WP4.5.2): BASE_DRONE_LEAN_SCALE above is derived FROM this figure
	// (LEVEL_GAP / tan(HIT_TURN)), not the other way round as it used to be.
	'BASE_DRONE_DETECT': gu(60),        // enemy detection range - was a bare 1200 in Bullet.js
	'BASE_DRONE_LEASH': gu(90),         // max distance from base before a chase is abandoned - was
	// a bare 1800 in Bullet.js
	'BASE_DRONE_PENE': 1,               // the ordinary-bullet pene convention (entities/Bullet.js's
	// constructor default), read by entities/Objects.js in place of a base drone's own `pene` -
	// which is a 2000-point health pool, not a penetration value, and was one-shotting every shape
	// a drone touched (plan.md WP4.5.2a).
	// How far an enemy bullet penetrates past the true base line before it counts as "in the
	// base" and dies - 1.5 grid squares by construction (PENDING #13), re-derived under the new
	// 28-unit pitch (plan.md WP1) as gu(1.5). Players still die exactly at the line (rooms/Room.js
	// passes margin 0 for them).
	'BASE_BULLET_MARGIN': gu(1.5)
}

