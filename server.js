/*
	Obstar - the one file you run.

			node server.js                 game + menu site on http://localhost   (PORT, default 80)
			node server.js --game-only     just the game    on ws://localhost:8080 (PORT, default 8080)
			node server.js --web-only      just the menu site                      (PORT, default 80)

	History: there used to be two entry points, Alex.js (the game, :8080) and obstarWeb.js
	(the menu, :80), and you had to start both. Starting only one gave you either a menu that
	hung forever on Play or a game with no page to open - the single most common way this
	repo "did not run". They never talked to each other, so there was never a reason for them
	to be separate processes; the only thing the split bought is putting the site and the
	simulation on different machines, which --game-only / --web-only still allow.

	In the default single-port mode the browser reaches the game over the same origin that
	served the page, so nothing has to be configured. Split mode needs the web half told
	where the game half lives: WS_LINK=wss://game.example.com node server.js --web-only.

	Boot order matters: boot() fills the late-bound registry (see lib/runtime.js) and must
	finish before anything can accept a player. Listening is deliberately the last step, and
	deliberately not part of boot(), so test/rooms.js can stand the whole game up in-process
	without opening a port.
*/
require('./lib/crash.js').install('error.log');

const http = require('http');

const argv = process.argv.slice(2);
const gameOnly = argv.includes('--game-only');
const webOnly = argv.includes('--web-only');

if (gameOnly && webOnly) {
	console.error('server.js: --game-only and --web-only are mutually exclusive');
	process.exit(2);
}

const runGame = !webOnly;
const runWeb = !gameOnly;
const port = parseInt(process.env.PORT, 10) || (gameOnly ? 8080 : 80);

let app = null;
if (runWeb) {
	app = require('./web/app.js')();
}

// With --game-only there is no http content to serve, but ws still needs an http server to
// upgrade from, so 404 everything.
const server = http.createServer(app || function (request, response) {
	response.writeHead(404);
	response.end();
});

if (runGame) {
	require('./lib/boot.js')();
	require('./net/gameSocket.js').attach(server);
}

require('./lib/db.js').check().catch(err => { throw err; });

server.listen(port, function () {
	const what = (runGame && runWeb) ? 'game + web' : (runGame ? 'game' : 'web');
	console.log('Server started on port ' + server.address().port + ' (' + what + ')');
});
