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
	dispatch ever shows up in a profile.

	This file lives in public/SHARE/ and carries the same typeof(exports) footer as
	TanksConfig.js / SocketSchema.js, so it loads in the browser as a global (`window.KIND`,
	reached as `globalThis.KIND`) and in Node via require(). That is what lets the three
	`DETEC: {type: [KIND.PLAYER, KIND.OBJECTS]}` auto-turret entries in TanksConfig.js name
	these constants directly - TanksConfig also loads in the browser, and this file loading
	before it means there is no longer anything to keep in sync by hand.

	Compare with these constants, never with a bare string literal.
*/
(function (exports, platform) {

	exports.PLAYER = 'Player';
	exports.BULLET = 'Bullet';
	exports.OBJECTS = 'Objects';
	exports.DETECTOR = 'Detector';

})(typeof (exports) === 'undefined' ? function () { this['KIND'] = {}; return this['KIND'] }() : exports,
	typeof (exports) === 'undefined' ? 'client' : 'server')
