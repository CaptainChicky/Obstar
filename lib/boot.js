/*
	Fills the late-bound registry in lib/runtime.js, in the one order that works.

	The modules below reference each other in a cycle: entities call into Controller, rooms
	construct entities, Main constructs rooms, and the AI closes over Detector. When all of
	this lived in one scope that resolved itself at call time. Here it has to be sequenced by
	hand:

		1. entity classes   - construct nothing at load time
		2. room classes     - touch entities only during a tick
		3. bot/boss/pet AI  - closes over Detector, so needs step 1 done
		4. Controller       - its constructor builds rooms, which read CONFIG

	Accepting players is step 5 and deliberately not here: server.js does that after calling
	boot(), and the room tests call boot() without ever opening a port.

	Calling boot() twice is a no-op - the second call returns the same Controller.
*/
const RT = require('./runtime.js');
const Vec = require('victor');
const config = require('./config.js').config;
const FRICTION = require('./constants.js').FRICTION;
const CLASS = require('../public/SHARE/TanksConfig.js').class;

module.exports = function boot() {
	if (RT.Controller) {
		return RT.Controller;
	}

	/// 1. Entities //////////////////////////////////////////////////////////////
	RT.Player = require('../entities/Player.js');
	RT.Objects = require('../entities/Objects.js');
	RT.Bullet = require('../entities/Bullet.js');
	RT.Detector = require('../entities/Detector.js');

	/// 2. Rooms /////////////////////////////////////////////////////////////////
	// Keyed by gamemode string: this is the table Controller.newServer builds rooms from,
	// and the only place a new mode has to be named. Values are rooms/Room.js subclasses.
	RT.ROOMS = {
		'ffa': require('../rooms/Ffa.js'),
		'2team': require('../rooms/TwoTeam.js'),
		'4team': require('../rooms/FourTeam.js'),
		'boss': require('../rooms/BossMode.js')
	};

	/// 3. AI ////////////////////////////////////////////////////////////////////
	RT.CONFIG = require('./gameAI.js')({
		Detector: RT.Detector,
		Vec: Vec,
		FRICTION: FRICTION,
		CLASS: CLASS,
		DES: config.DES
	});

	/// 4. Controller ////////////////////////////////////////////////////////////
	RT.Controller = new (require('./Controller.js'))();

	return RT.Controller;
};
