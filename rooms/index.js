/*
	The one list of gamemodes, keyed by the string the client's `init` packet sends.

	This table used to live on the late-bound registry, filled by lib/boot.js. Room subclasses
	construct nothing at load time and have no cycle to break, so the table itself is a plain
	module - lib/Controller.js requires it directly, and adding a mode is still the one edit here
	(plus the gamemode enum in public/SHARE/SocketSchema.js, since the mode has to fit in the byte
	the client sends - see the note there).
*/
module.exports = {
	'ffa': require('./Ffa.js'),
	'2team': require('./TwoTeam.js'),
	'4team': require('./FourTeam.js'),
	'boss': require('./BossMode.js'),
	'sandbox': require('./Sandbox.js'),
	'tag': require('./Tag.js')
};
