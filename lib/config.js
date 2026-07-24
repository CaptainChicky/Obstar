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
		'LB': false
	},
	'KEY_ISNEEDED': false, //dont apply if DB.ON or DB.ACC is off
	'S_BEFORE_KICK': 120,   // the nb of seconds before kicking someone afk on the death screen
	'MAX_IP': 2,     // max tabs someone can play on
	'DES': 10,
	'DEAD_DELAY': 150,   // the nb off ms before the person can replay
	'KEEP_PLACE': 20,
	'SIZE_GET_POS': 40,
	/*
		///////////////////////////////////////////////////////////////////////////////////////
		TICK_MS - milliseconds per simulation step. This is the game's speed knob. Read this
		before changing it, because the obvious value is the wrong one.

		Every room used to end its update() with `setTimeout(update, 20, this)`, which reads as
		50Hz and is not. setTimeout means "in *at least* 20ms", so each tick paid 20ms of timer
		plus however long the tick itself took plus the OS timer granularity, and the arrears
		were never repaid. Measured on this repo, one room alone on the box:

				ffa    (680 entities)   28.1 Hz    8.2 ms of work per step
				2team  (383 entities)   29.6 Hz    5.2 ms of work per step

		So the game as anyone has ever played it ran at about 29Hz, and every speed, reload,
		friction and acceleration constant in entities/ and public/SHARE/TanksConfig.js was
		tuned by feel against that - not against the 50Hz the code claimed. Putting the
		simulation on an honest fixed-timestep clock (lib/clock.js, HANDOFF 8.8) and leaving the
		step at 20ms therefore made the whole game run about 1.7x too fast. It was not a clock
		bug; it was the clock telling the truth for the first time.

		33ms keeps the speed the game was actually tuned for, and is what diep.io itself runs.
		What the fixed clock buys at that rate is everything it was for: the rate no longer sags
		under load, rooms no longer drift apart from each other, and a stall is reported instead
		of silently slowing the world down.

		Lower it to 20 if you would rather have the nominal 50Hz and retune the gameplay
		constants to match - that is a real option, but it is a balance project, not a config
		change, and one ffa room costs 41% of a core at that rate against 23% at 33ms.
		///////////////////////////////////////////////////////////////////////////////////////
	*/
	'TICK_MS': 33,
	/*
		Milliseconds between GameUpdate packets to each client. Deliberately independent of
		TICK_MS - a send is a snapshot of wherever the simulation had got to.

		Keep it >= TICK_MS. Sending faster than the simulation steps means consecutive packets
		carry an identical world, and the client's snapshot interpolation (public/motion.js)
		reads a pair of identical positions as "stopped" and then the next pair as double
		distance - i.e. visible stutter, from sending *more* data.
	*/
	'SEND_MS': 33
}

