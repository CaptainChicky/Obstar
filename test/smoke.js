/*
	End-to-end smoke test. Boots a real server.js --game-only on a throwaway port, connects a
	real WebSocket, performs the binary `init` handshake, and asserts that the server
	simulates and streams GameUpdate packets back.

	This exists so the protocol and room code can be refactored without a browser in the
	loop. It is deliberately blunt: it does not check gameplay values, only that the pipe
	from socket -> room -> encoder -> socket is intact end to end.

		node test/smoke.js        (or: npm test)
*/
const { fork } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.SMOKE_PORT) || 8099;
const BOOT_TIMEOUT = 10000;
const UPDATE_TIMEOUT = 8000;
const SAMPLE_MS = 6000;   // long enough for big polygons to spawn and exercise getPlace

const clientProto = require('./clientProto.js')();
const serverProto = require(path.join(ROOT, 'public', 'SHARE', 'SocketSchema.js'));

let passed = 0, failed = 0;
function check(name, ok, detail) {
	if (ok) {
		passed++;
		console.log('  ok   ' + name);
	} else {
		failed++;
		console.log('  FAIL ' + name + (detail ? '  (' + detail + ')' : ''));
	}
}

/// 1. Protocol round trip, no server needed //////////////////////////////////
function protocolTests() {
	console.log('protocol:');

	const key = '0'.repeat(25);
	const init = clientProto.encode('init', { key: key, gm: 'ffa', name: 'smoketest', pet: -1 });
	check('client encodes init', init && init.byteLength > 0);

	const decoded = serverProto.decode(Buffer.from(init));
	check('server decodes init as type init', decoded.type === 'init', 'got ' + decoded.type);
	check('init survives round trip: no error', !decoded.error, String(decoded.error));
	check('init survives round trip: key', decoded.data.key === key, decoded.data.key);
	check('init survives round trip: gm', decoded.data.gm === 'ffa', decoded.data.gm);
	check('init survives round trip: name', decoded.data.name === 'smoketest', decoded.data.name);

	for (const key of ['w', 'a', 's', 'd', 'mouseL']) {
		const d = serverProto.decode(Buffer.from(clientProto.encode('keydown', key)));
		check('keydown ' + key + ' round trips', d.type === 'keydown' && d.data.key === key,
			d.type + '/' + (d.data && d.data.key));
	}

	const up = serverProto.decode(Buffer.from(clientProto.encode('upgrade', 3)));
	check('upgrade round trips', up.type === 'upgrade' && up.data.up === 3);

	const ping = serverProto.decode(Buffer.from(clientProto.encode('ping', 0)));
	check('ping round trips', ping.type === 'ping', ping.type);
}

/*
	Decode a GameUpdate the way the browser does and sanity check the numbers in it.

	The NaN guard is the point: HANDOFF.md section 5.2 describes `i.size += c.SIZE_GET_POS`
	resolving to undefined inside a loop that shadowed the config, which poisons an entity's
	size to NaN permanently and corrupts its collision and quadtree insertion. A NaN reaching
	the wire is the observable symptom, so assert it never does.
*/
function checkGameUpdates(buffers) {
	let decoded = [], failure = null;
	for (const buf of buffers) {
		const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
		try {
			decoded.push(clientProto.decode(arrayBuffer));
		} catch (err) {
			failure = failure || err.message;
		}
	}
	check('client decodes every GameUpdate', !failure && decoded.length === buffers.length,
		failure || (decoded.length + '/' + buffers.length));
	if (!decoded.length) { return; }

	const head = decoded[0].data && decoded[0].data.head;
	check('GameUpdate head has finite map size',
		head && isFinite(head.width) && isFinite(head.height),
		head && (head.width + 'x' + head.height));

	/*
		head.timestamp is the room's step counter, so two packets carrying the same one mean the
		client was handed the same world twice. Its interpolator (public/motion.js) reads a pair
		of identical positions as "this entity stopped", so a duplicate is a visible hitch. The
		send loop and the simulation clock are independent timers at the same period, which is
		exactly the arrangement that drifts into occasional duplicates - net/gameSocket.js skips
		those sends, and this is the assertion that says it still does.
	*/
	const stamps = decoded.map((u) => u.data && u.data.head && u.data.head.timestamp);
	const dupes = stamps.filter((t, i) => i > 0 && t === stamps[i - 1]).length;
	check('no two GameUpdates carry the same world', dupes === 0,
		dupes + ' duplicate of ' + stamps.length + ' packets');

	// The getPlace mechanic only fires when a big polygon spawns, so a single frame proves
	// nothing. Sample the whole window and require that we actually saw objects at all,
	// otherwise a green result would just mean an empty map.
	let seen = 0, bad = [];
	const inspect = function (label, entity) {
		if (!entity) { return; }   // the instance arrays are sparse and full of nulls
		seen++;
		for (const field of ['x', 'y', 'size']) {
			if (entity[field] !== undefined && !isFinite(entity[field])) {
				bad.push(label + '.' + field + '=' + entity[field]);
			}
		}
	};
	for (const update of decoded) {
		if (!update.data) { continue; }
		inspect('User', update.data.User);
		const instances = update.data.Instances || {};
		for (const group of ['Players', 'Objects', 'Bullets']) {
			for (const entity of (instances[group] || [])) {
				inspect(group, entity);
			}
		}
	}
	check('sampled a populated world', seen > 100, seen + ' entity snapshots');
	check('no NaN x/y/size on any entity', bad.length === 0,
		bad.length + ' bad: ' + bad.slice(0, 3).join(', '));
}

/// 2. Live server ////////////////////////////////////////////////////////////
/*
	Run once per gamemode. Every mode is a different set of rules over the same tick, and the
	realistic failure is a change that only breaks one of them - '4team' in particular is the
	first mode with more than two sides, and 'boss' the first with entities that run their own
	update() rather than the shared one.
*/
function serverTests(gamemode, port, done) {
	console.log('server (' + gamemode + '):');

	// --game-only: the test drives the binary protocol, and there is no reason to stand the
	// Express site up (or to fight whatever else holds port 80) to do that.
	const child = fork(path.join(ROOT, 'server.js'), ['--game-only'], {
		cwd: ROOT,
		env: Object.assign({}, process.env, { PORT: String(port) }),
		silent: true
	});

	let childOutput = '';
	child.stdout.on('data', function (d) { childOutput += d; });
	child.stderr.on('data', function (d) { childOutput += d; });

	let finished = false;
	function finish(err) {
		if (finished) { return; }
		finished = true;
		child.kill();
		if (err) {
			check('server run', false, err);
			if (childOutput.trim()) {
				console.log('  --- server output ---');
				console.log('  ' + childOutput.trim().split('\n').join('\n  '));
			}
		}
		done();
	}

	child.on('exit', function (code) {
		if (!finished) { finish('server.js exited early with code ' + code); }
	});

	// The server prints "Server started on port N" once listening. Poll the port instead of
	// parsing that, so the test does not depend on log wording.
	const deadline = Date.now() + BOOT_TIMEOUT;
	(function connect() {
		if (Date.now() > deadline) { return finish('server never accepted a connection'); }

		const socket = new WebSocket('ws://localhost:' + port);
		let updates = [], firstUpdate = null, timer = null;

		socket.on('error', function () {
			// Server is not listening yet. Drop this attempt entirely - including any timer it
			// armed - and retry, otherwise a stale timer from a failed attempt fires mid-test.
			clearTimeout(timer);
			socket.removeAllListeners();
			socket.terminate();
			setTimeout(connect, 200);
		});

		socket.on('open', function () {
			check('websocket connects', true);
			socket.send(clientProto.encode('init', {
				key: '0'.repeat(25), gm: gamemode, name: 'smoketest', pet: -1
			}));

			// Give up early if nothing ever arrives, otherwise sample a full window.
			const firstPacket = setTimeout(function () {
				finish('no GameUpdate packet within ' + UPDATE_TIMEOUT + 'ms');
			}, UPDATE_TIMEOUT);

			timer = setTimeout(function () {
				clearTimeout(firstPacket);
				if (!updates.length) { return finish('no GameUpdate packets in sample window'); }

				check('server streams GameUpdate after init', true);
				check('GameUpdate carries a payload', firstUpdate.length > 1, firstUpdate.length + ' bytes');
				check('server keeps streaming', updates.length > 10, updates.length + ' updates');
				checkGameUpdates(updates);

				socket.close();
				finish();
			}, SAMPLE_MS);

			socket.on('message', function () { clearTimeout(firstPacket); });
		});

		socket.on('message', function (packet) {
			const buf = Buffer.from(packet);
			const type = buf.readUInt8(0);

			// The server half of the schema cannot decode its own outbound packets (it only
			// implements the client->server direction), so identify by the leading type byte.
			if (type === 1) {                         // 'kick'
				clearTimeout(timer);
				return finish('server kicked the test client');
			}
			if (type === 5) {                         // 'GameUpdate'
				if (!firstUpdate) { firstUpdate = buf; }
				updates.push(buf);
			}
		});
	})();
}

console.log('obstar smoke test\n');
protocolTests();

// Sequential, not parallel: config.MAX_IP caps concurrent connections per IP at 2.
const modes = [['ffa', PORT], ['2team', PORT + 1], ['4team', PORT + 2], ['boss', PORT + 3]];
(function next() {
	if (!modes.length) {
		console.log('\n' + passed + ' passed, ' + failed + ' failed');
		return process.exit(failed ? 1 : 0);
	}
	const mode = modes.shift();
	console.log('');
	serverTests(mode[0], mode[1], next);
})();
