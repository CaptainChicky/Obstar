/*
	Game server and/or menu site entry point.

	node server.js              game + menu on http://localhost (PORT default 80)
	node server.js --game-only  game only on ws://localhost:8080 (PORT default 8080)
	node server.js --web-only   menu only (PORT default 80)

	Same-origin in combined mode; split web-only needs WS_LINK pointing at the game host.

	boot() runs before listen so the controller exists before any connection; listen stays
	here so in-process tests can boot without binding a port.
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

// --game-only: no pages, but WebSocket still upgrades from HTTP — return 404 for all routes.
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
