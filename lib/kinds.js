/*
	Entity type tags.

	Every entity used to be identified by `obj.constructor.name`, compared against string
	literals ('Player', 'Bullet', 'Objects', 'Detector') in collision, buffering and AI code.
	That works only as long as nobody renames a class and nobody ever runs a minifier over
	the server - a mangler turns `class Player` into `class n` and every dispatch branch goes
	silently dead. It is also a property lookup on the constructor function on a hot path.

	Each entity class now carries `kind` on its *prototype* (see the bottom of each file in
	entities/), so it costs nothing per instance and reads as `obj.kind`.

	The values are deliberately the same strings the old code compared against: Detector's
	`type` filter list and its `selectAll` buckets are keyed by them, and keeping them equal
	made the swap a pure substitution. They never reach the wire (SocketSchema has its own
	'Players'/'Bullets'/'Objects' `construc` table), so they can become ints later if this
	dispatch ever shows up in a profile - with one caveat:

		public/SHARE/TanksConfig.js hardcodes `DETEC: {type: ['Player','Objects']}` on the three
		auto-turret classes, and that list is matched against these values. TanksConfig is
		shared with the browser and cannot require() this file, so those literals have to be
		changed by hand if the values here ever change.

	Compare with these constants, never with a bare string literal.
*/
const KIND = {
	PLAYER: 'Player',
	BULLET: 'Bullet',
	OBJECTS: 'Objects',
	DETECTOR: 'Detector'
};

module.exports = KIND;
