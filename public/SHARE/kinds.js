/*
	Entity type tags.

	Each entity class carries `kind` on its prototype. Compare with these constants,
	never with a bare string literal. They never reach the wire.

	Dual-mode: window.KIND in the browser, require() in Node. This file loads
	before TanksConfig so DETEC filters can name KIND.PLAYER / KIND.OBJECTS.
*/
(function (exports, platform) {

	exports.PLAYER = 'Player';
	exports.BULLET = 'Bullet';
	exports.OBJECTS = 'Objects';
	exports.DETECTOR = 'Detector';
	exports.WALL = 'Wall';

})(typeof (exports) === 'undefined' ? function () { this['KIND'] = {}; return this['KIND'] }() : exports,
	typeof (exports) === 'undefined' ? 'client' : 'server')
