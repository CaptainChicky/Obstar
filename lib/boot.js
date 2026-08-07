/*
	Boot the game server: a memoised singleton Controller.

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
