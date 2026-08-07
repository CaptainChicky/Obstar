/*
	Single entry point for both the game server and the menu website.

			node server.js                 game + menu site on http://localhost   (PORT, default 80)
			node server.js --game-only     just the game    on ws://localhost:8080 (PORT, default 8080)
			node server.js --web-only      just the menu site                      (PORT, default 80)

	In single-port mode the browser reaches the game over the same origin that served the
	page, so nothing has to be configured. Split mode needs the web half told where the game
	half lives: WS_LINK=wss://game.example.com node server.js --web-only.

	boot() constructs the Controller singleton and must finish before any player can connect,
	so it runs before server.listen(). Listening is not part of boot() so test/rooms.js can
	stand the whole game up in-process without opening a port.
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
	const controller = require('./lib/boot.js')();
	require('./net/gameSocket.js').attach(server, controller);
}

require('./lib/db.js').check().catch(err => { throw err; });

server.listen(port, function () {
	const what = (runGame && runWeb) ? 'game + web' : (runGame ? 'game' : 'web');
	console.log('Server started on port ' + server.address().port + ' (' + what + ')');
});
