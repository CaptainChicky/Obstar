/*
	Boot the game server: a memoised singleton Controller.

	This used to fill a late-bound registry (lib/runtime.js) in four hand-sequenced steps
	because the module graph looked circular - entities called into Controller, rooms constructed
	entities, Controller constructed rooms. It wasn't actually circular: entities take their room
	directly and rooms take their controller directly, so `require('./Controller.js')` just
	resolves in plain dependency order like any other module and there is nothing left to
	sequence by hand.

	Accepting players is deliberately not part of this: server.js does that after calling
	boot(), and the room tests call boot() without ever opening a port.

	Calling boot() twice is a no-op - the second call returns the same Controller.
*/
let controller = null;
module.exports = function boot() {
	if (!controller) {
		controller = new (require('./Controller.js'))();
	}
	return controller;
};
