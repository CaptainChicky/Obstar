/*
	The one place the grid pitch is written down.

	Before this file existed, the client drew its grid from a literal (public/client/game.js's
	General['background'](...) call) and the server had no notion of a grid pitch at all, so
	nothing stopped the two from disagreeing. Every Category-A (grid-denominated) distance in
	lib/config.js and rooms/*.js is now written as gu(n) - "n grid squares" - rather than a raw
	unit count, so the square count is the thing stated at the call site.

	1 grid square = 1 diep grid unit (gu) = 28 world units, measured against real
	diep.io: a level-0 tank is 2 gu across, and 28 units/gu is also what the recoil table assumes.

	Dual-mode, same typeof(exports) footer as kinds.js/TanksConfig.js: the server require()s it,
	the browser loads it as a <script> before anything that draws or measures the grid.
*/
(function (exports, platform) {

	exports.GU = 28;
	exports.gu = function (n) { return n * 28; };

})(typeof (exports) === 'undefined' ? function () { this['World'] = {}; return this['World'] }() : exports,
	typeof (exports) === 'undefined' ? 'client' : 'server')
