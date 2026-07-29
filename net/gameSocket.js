/*
	The game's WebSocket layer.

	Contains the packet router `income()`, the per-socket `loop` object that drives the two
	outbound timers, and the `talk` / `kick` helpers. Everything gameplay-related is reached
	through the `controller` handed to attach().

	This module owns no port. `attach(httpServer, controller)` hangs a ws server off an http
	server somebody else made, which is what lets server.js put the game and the menu site on
	one port in one process (and still split them onto two when asked).

	Timing. `gameloop` sends a GameUpdate about every 30ms and `longloop` a heartbeat every
	second. Neither is tied to the room simulation, and that is deliberate: the
	rooms run at a fixed 50Hz on the shared clock in lib/clock.js, and a send is just a
	snapshot of whatever the simulation had reached when the timer fired. Nothing has to divide
	evenly, and a slow send cannot slow the simulation down.

	What did change is that both loops now aim at a *deadline* instead of re-arming with a flat
	setTimeout(30). setTimeout means "in at least 30ms", so the old chain paid for its own work
	every time round and the send rate sagged under load - the client saw that as jitter,
	because its interpolation is driven by the spacing packets actually arrive with. The delay
	is computed from when the next send was due, so overrun is absorbed rather than accumulated.
*/
const config = require('../lib/config.js').config;
const WebSocket = require('ws');
const PROTO = require('../public/SHARE/SocketSchema.js');

function attach(httpServer, controller) {


	function income(socket, packet) {
		if (socket.main) {
			socket.main.request++;
		}
		const data = PROTO.decode(packet);
		///
		if (data.error) {
			kick(socket, data.error);
			return;
		}
		switch (data.type) {
			case 'ping':
				if (socket.main) {
					socket.main.heartbeats = 0;
					// probe 1 is a client-timed RTT probe (PENDING #24a): echo it straight back,
					// same tick, no state kept here - the client owns the clock. probe 0 is the
					// ordinary heartbeat and is answered by longloop()'s own ping, not here.
					// The break is what the fallthrough into 'init' below already did for a
					// connected socket (`if (socket.main) { break; }`); it is spelled out now so
					// the echo has somewhere to sit. An unconnected socket still falls through.
					if (data.data.probe) { talk(socket, 'ping', 1); }
					break;
				}
			case 'init': {
				if (socket.main) {
					break;
				}
				socket.id = controller.askConnection(data.data, socket._socket.remoteAddress);
				socket.main = new loop(socket);
				break;
			};
			case 'keydown': {
				socket.main.request -= .5;
				const tank = controller.getPlayer(socket.id);
				if (!controller.getPlayer(socket.id)) { break; }
				switch (data.data.key) {
					case 'a':
					case 'w':
					case 's':
					case 'd':
					case 'arrw':
					case 'arrs':
					case 'arra':
					case 'arrd':
					case 'mouseL':
					case 'mouseR':
						tank.inputs[data.data.key] = 1;
						break;
					case 'c':
					case 'e':
						tank.inputs[data.data.key] = !tank.inputs[data.data.key] * 1
						break;
					// Sandbox-only practice keys - inert everywhere else, so a modified client
					// gains nothing by sending them outside a sandbox room.
					case 'k':
					case 'o': {
						if (tank.id.GM !== 'sandbox') { break; }
						const room = controller.server[tank.id.GM][tank.id.sId];
						if (data.data.key === 'k') {
							tank.xp = room.XPLVL[room.XPLVL.length - 1];
						} else {
							tank.hp = 0;
						}
						break;
					};
				}
				break;
			};
			case 'keyup': {
				socket.main.request -= .5;
				const tank = controller.getPlayer(socket.id);
				if (!controller.getPlayer(socket.id)) { break; }
				switch (data.data.key) {
					case 'a':
					case 'w':
					case 's':
					case 'd':
					case 'arrw':
					case 'arrs':
					case 'arra':
					case 'arrd':
					case 'mouseL':
					case 'mouseR': {
						tank.inputs[data.data.key] = 0;
						break;
					};
					case 'enter': {
						const ans = controller.respawn(socket.id);
						const tank = controller.getPlayer(socket.id);
						if (!tank && !ans) { break; }
						talk(socket, 'UpdateUp', tank.upNb);
						break;
					};
				}
				break;
			};
			case 'mousemove': {
				const tank = controller.getPlayer(socket.id);
				if (!controller.getPlayer(socket.id)) { break; }
				if (tank.botMod) { break; }
				// A mousemove packet lands whenever it lands - not synced to the room's tick loop -
				// so while the `c` auto-spin owns `dir` (entities/Player.js's spin block writes it
				// every tick), a stray mousemove arriving mid-spin used to stomp it with the raw
				// mouse angle for one broadcast before the next tick put it back: a visible
				// snap-and-return glitch. `mouse_x`/`mouse_y` still update unconditionally - only
				// `dir` needs to stay owned by the spin.
				if (!tank.spinning) { tank.dir = data.data.dir; }
				tank.inputs.mouse_x = data.data.x * tank.screen;
				tank.inputs.mouse_y = data.data.y * tank.screen * 0.5625;
				break;
			};
			case 'upgrade': {
				const tank = controller.getPlayer(socket.id);
				if (!tank) { break; }
				tank.upgrade(data.data.up);
				talk(socket, 'UpdateUp', tank.upNb);
				break;
			};
			case 'upClass': {
				const tank = controller.getPlayer(socket.id);
				if (!tank) { break; }
				tank.upClass(data.data.up);
			};
			case 'com': {
				socket.main.request += 4;
				// command() answers most commands synchronously, but 'connect' checks the
				// devs table first - Promise.resolve() lets both shapes flow through the same path.
				Promise.resolve(controller.command(socket.id, data.data)).then((ans) => {
					if (ans) {
						talk(socket, 'comResponse', ans);
					}
				});
				break;
			};
			case 'chat': {
				socket.main.request += 4;
				if (socket.main.chat) {
					talk(socket, 'chatUpdate', [['', 'Please wait a little.']]);
					break;
				}
				socket.main.chat += 20;
				controller.chat.add(socket.id, data.data);
				break;
			};
		}
	};

	// Target spacing between GameUpdate packets. Must stay >= the simulation step, or
	// consecutive packets carry an identical world and the client's interpolation stutters -
	// see the note on SEND_MS in lib/config.js.
	const SEND_MS = Math.max(config.SEND_MS, config.TICK_MS);
	const IDLE_MS = 200;   // ...while the client has nothing to look at yet
	// Leaderboard/minimap/message-feed cadence - see the note on UI_MS in lib/config.js for why
	// this is its own loop instead of riding longloop's 1000ms heartbeat tick.
	const UI_MS = config.UI_MS;
	/*
		>= is necessary but not sufficient. The send loop and the simulation clock are separate
		timers with separate jitter, so even at exactly equal periods they drift against each
		other and every so often two sends fall inside one simulation step. That pair carries a
		byte-identical world, and public/motion.js reads a pair of identical positions as "this
		entity stopped" - one visible hitch per drift cycle.

		So don't send it. head.timestamp is the room's step counter, so "the world has not moved"
		is exactly "the timestamp has not changed", and the check is one integer compare.

		Waiting a whole SEND_MS after a skip would be worse than the duplicate - the client would
		get a 66ms hole. Instead retry at a quarter step and reset the deadline, which lands the
		next send just after the step that was pending and re-anchors the loop to the step
		boundary it drifted off.
	*/
	const RETRY_MS = Math.max(4, Math.round(config.TICK_MS / 4));
	/*
		Next firing time for a self-re-arming loop, as a delay in ms. `due` is carried on the
		loop object and advanced by exactly `period` each time, so the average rate is the period
		even when a tick runs long. If we fall more than one period behind - a real stall, not
		a rounding error - the deadline resets to now rather than firing a catch-up burst.
	*/
	function nextDelay(it, key, period) {
		const now = Date.now();
		let due = (it[key] || now) + period;
		if (due < now - period) { due = now + period; }
		it[key] = due;
		return Math.max(0, due - now);
	}

	function loop(socket) {
		// Assigned here, not left to the caller's `socket.main = new loop(socket)` - the
		// constructor calls this.gameloop() below before that outer assignment ever runs, and if
		// clients[id] is already an ERR_* string (askConnection ran synchronously - DB is off by
		// default), that first gameloop() call kicks its own still-under-construction socket
		// reentrantly. kick() only zeroes run through `socket.main`, so without this line it finds
		// socket.main still undefined, does nothing, and the loops it meant to stop stay armed.
		socket.main = this;
		this.socket = socket;
		this.strikes = 0;
		this.dead = 0;
		this.request = 0;
		this.heartbeats = 0;
		this.run = 1;
		this.chat = 0;
		this.sendDue = 0;
		this.slowDue = 0;
		this.uiDue = 0;
		this.sentStamp = -1;   // room step counter of the last GameUpdate actually sent
		this.gameloop = function () {
			if (!this.run) { return; }
			if (this.chat) {
				this.chat--;
			}
			const id = controller.clients[this.socket.id];
			let ms = SEND_MS;
			///
			switch (id) {
				case 'Waiting': {
					ms = IDLE_MS;
					break;
				}
				case 'ERR_GAMEMODE':
				case 'ERR_DOUBLE_IP':
				case 'ERR_BROKEN_KEY':
				case 'ERR_SERVER_FULL':
				case 'ERR_SERVER_OFF':
				case 'ERR_REQUESTS_DELAY':
				case 'ERR_PACKET_LENGTH':
				case 'ERR_HEARTBEATS_LOST':
				case 'ERR_DOUBLE_ACC':
				case 'ERR_PACKET_TYPE': {
					console.log(id);
					kick(this.socket, id);
					break;
				}
				default: {
					const buff = controller.getBuffer(socket.id);
					// controller.getBuffer() returns the string 'Waiting' (truthy, not an object)
					// when clients[id] doesn't resolve to a real connection - a disconnected/kicked
					// id that a lingering timer still reaches, in the ordinary case. !buff alone
					// let that string past into talk()'s encode() call, which then reads .head off
					// a string and crashes reading 'timestamp' off the undefined that produces.
					if (!buff || typeof buff !== 'object') {
						ms = IDLE_MS;
					} else if (buff.head.timestamp === this.sentStamp) {
						ms = RETRY_MS;          // world has not stepped since the last packet; see above
						this.sendDue = 0;       // ...and re-anchor rather than keep the drifted phase
					} else {
						this.sentStamp = buff.head.timestamp;
						talk(this.socket, 'GameUpdate', buff);
					}
					const mess = controller.chat.get(socket.id);
					if (mess) {
						talk(this.socket, 'chatUpdate', mess);
					}
					break;
				}
			}
			///
			// A send that ran long eats into the next delay instead of pushing it back, so the
			// spacing the client measures stays close to `ms`.
			if (ms !== this.sendPeriod) { this.sendPeriod = ms; this.sendDue = 0; }
			setTimeout((it) => { it.gameloop() }, nextDelay(this, 'sendDue', ms), this);
		};
		this.longloop = function () {
			if (!this.run) { return; }
			///REQUEST
			if (this.request >= 50) {
				kick(this.socket, 'ERR_REQUESTS_DELAY')
				return;
			} else {
				this.request = 0;
				this.strikes = 0;
			}
			///DEAD
			const play = controller.getPlayer(socket.id);
			if (this.dead > config.S_BEFORE_KICK) {
				kick(this.socket, 'ERR_SERVER_OFF');
				return;
			}
			if (play) {
				if (play.dead) {
					this.dead++;
				} else {
					this.dead = 0;
				}
			};
			///HEARTBEATS
			if (this.heartbeats >= 10) {
				kick(this.socket, 'ERR_HEARTBEATS_LOST');
			} else {
				talk(this.socket, 'ping', 0);
			}
			this.heartbeats++;
			/////
			setTimeout((it) => { it.longloop() }, nextDelay(this, 'slowDue', 1000), this);
		};
		// Leaderboard, minimap and the message feed - split out of longloop (lib/config.js's
		// UI_MS note) so a HUD refresh rate has nothing to do with heartbeat/AFK bookkeeping.
		this.uiloop = function () {
			if (!this.run) { return; }
			const ui = controller.getUi(this.socket.id);
			if (ui) {
				talk(this.socket, 'UiUpdate', ui);
			}
			setTimeout((it) => { it.uiloop() }, nextDelay(this, 'uiDue', UI_MS), this);
		};
		this.gameloop();
		this.longloop();
		this.uiloop();
	};

	function talk(socket, type, data) {
		socket.send(PROTO.encode(type, data));
	};

	function kick(socket, reason) {
		if (socket.main) {
			socket.main.run = 0;
		};
		console.log('KICKED id:' + socket.id + '//' + reason)
		socket.send(PROTO.encode('kick', reason));
		controller.disconnect(socket.id, socket._socket.remoteAddress);
		setTimeout((s) => { s.close() }, 100, socket);
	}

	const wss = new WebSocket.Server({ server: httpServer });
	wss.on('connection', function (socket) {
		socket.id = 'Waiting';
		socket.on('message', (packet) => { income(socket, packet) });
		socket.on('close', () => { })
	});
	return wss;
}

exports.attach = attach;
