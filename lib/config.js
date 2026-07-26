/*
	Live server flags.

	This file used to also export a large CONFIG block holding the bot / boss / pet AI.
	It was dead code: the old Alex.js declared its own `var CONFIG` that shadowed it, and the two
	copies had diverged - the copy here called CONFIG.BOT_PATHS / CONFIG.BOTS_UPS while
	defining the keys as BOT_PATH / BOT_UPS, so it would have thrown on the first bot tick
	had anything ever loaded it. Editing AI here changed nothing. The working copy lives in
	lib/gameAI.js; that is the one to edit.
*/
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
		Out-of-bounds (massplanchunks WP5). Measured against real diep.io: the true wall sits
		6 grid squares (public/client/game.js's background tile pitch, 20 units) past the drawn
		map edge, and it is a hard stop - no spring, no push force. A corner overshoot naturally
		works out to 6*sqrt(2) squares because x and y clamp independently; that isn't a separate
		case to implement. Players only (entities/Player.js's motion()) - objs/drones/pets keep
		their existing clamp at the drawn edge.
	*/
	'OOB_MARGIN': 120,
	/*
		Base drones and team bases (massplanchunks WP-E), measured against the diep wiki's base
		drone spec plus direct pixel measurements - see PENDING.md for the derivations.
	*/
	'BASE_DRONE_SIZE': 15,     // a level-0 tank (size 28) scaled by the reference's 32/60 ratio
	'BASE_DRONE_HP': 2000,     // the wiki's stated pool, taken literally - PENDING.md flags the
	// MH0-dependent alternative (~6400) this would be on diep's own HP scale
	'BASE_DRONE_DAMAGE': 2.97,   // scale-consistent with a tank's own body damage: 8.48485 * 7/20
	'BASE_DRONE_RESPAWN': 25,    // 1s, in reference ticks (1000/REF_TICK_MS) - read through tick.ticks()
	'BASE_DRONE_CROSS': 250,    // 10s in reference ticks - how often a drone crosses its orbit's diameter
	// How far an enemy bullet penetrates past the true base line before it counts as "in the
	// base" and dies - measured in the client at 1.5 * the 20-unit grid pitch. Players still die
	// exactly at the line (rooms/Room.js passes margin 0 for them).
	'BASE_BULLET_MARGIN': 30
}

