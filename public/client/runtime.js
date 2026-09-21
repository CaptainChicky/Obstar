/*
	The client's shared scope.

	A file may alias a name off CLIENT at load time only if an earlier file in the
	play.ejs load order already put it there. Anything created inside CLIENT.Run()
	must be read through CLIENT at the point of use.

	Load order: runtime, config, util, drawings, entities, render, ui, game, overlay, boot.
*/
(function (CLIENT) {
	CLIENT.Run = null;   // public/client/game.js
	CLIENT.preRun = null;   // public/client/boot.js
})(typeof (exports) === 'undefined'
	? (window.CLIENT = window.CLIENT || {})
	: (module.exports = global.CLIENT = global.CLIENT || {}));
