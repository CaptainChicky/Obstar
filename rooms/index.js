/*
	Gamemode registry: string key from the client init packet to Room subclass.
	Controller loads this table directly; each mode must also fit the wire gamemode enum.
*/
module.exports = {
	'ffa': require('./Ffa.js'),
	'2team': require('./TwoTeam.js'),
	'4team': require('./FourTeam.js'),
	'boss': require('./BossMode.js'),
	'sandbox': require('./Sandbox.js'),
	'tag': require('./Tag.js'),
	'maze': require('./Maze.js'),
	'domination': require('./Domination.js'),
	'mothership': require('./Mothership.js'),
	'survival': require('./Survival.js'),
	'tester': require('./Tester.js')
};
