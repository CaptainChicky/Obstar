/*
	WebSocket layer for the game. Contains the packet router income(), the per-socket loop
	object that drives the outbound timers, and the talk/kick helpers. All gameplay logic is
	reached through the controller passed to attach().

	attach(httpServer, controller) hangs a ws server off an existing http server, which is
	what lets server.js put the game and the menu site on one port in one process (or split
	them onto two).

	Timing: gameloop sends a GameUpdate roughly every SEND_MS and longloop sends a heartbeat
	every second. Neither is tied to the room simulation - rooms run on a fixed 50Hz clock
	(lib/clock.js) and a send is just a snapshot of whatever the simulation had reached when
	the timer fired. Both loops aim at a deadline (see nextDelay()) instead of a flat
	setTimeout, so a slow tick is absorbed instead of compounding into growing send delay.
*/
const config = require('../lib/config.js').config;
const WebSocket = require('ws');
const PROTO = require('../public/SHARE/SocketSchema.js');

// Resolves the entity a human is currently controlling: the piloted entity if piloting,
// otherwise the human itself.
function activeEntityOf(human) {
	return human ? (human.piloting || human) : null;
}
// packet x/y are normalized against the CURRENT camera's screen (the possessed entity while piloting),
// but controls stay stored on the human input owner.
function applyMouseMove(human, active, data) {
	if (!human.spinning) { human.dir = data.dir; }
	human.inputs.mouse_x = data.x * active.screen;
	human.inputs.mouse_y = data.y * active.screen * 0.5625;
}

function attach(httpServer, controller) {


	function income(socket, packet) {
		if (socket.main) {
			socket.main.request++;
		}
		const data = PROTO.decode(packet);
		if (data.error) {
			kick(socket, data.error);
			return;
		}
		switch (data.type) {
			case 'ping':
				if (socket.main) {
					socket.main.heartbeats = 0;
					// probe 1 is a client RTT probe: echo it back immediately, no state kept here.
					// probe 0 is the ordinary heartbeat, answered by longloop()'s own ping instead.
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
					// Sandbox-only practice keys, inert everywhere else. 'k' is a held input (like
					// w/a/s/d) rather than a one-shot jump to max: Player.update() climbs one level
					// per interval while it stays down. 'o'/'classcycle'/'god' are one-shot/toggle
					// actions applied directly here. 'o' (self-kill) is also allowed in 'tester' mode.
					case 'k':
						tank.inputs.k = 1;
						break;
					case 'o':
					case 'classcycle':
					case 'god': {
						const gm = tank.id.GM;
						if (gm !== 'sandbox' && !(gm === 'tester' && data.data.key === 'o')) { break; }
						switch (data.data.key) {
							case 'o': tank.hp = 0; break;
							case 'classcycle': tank.cycleClass(); break;
							case 'god': tank.dev.god = !tank.dev.god; break;
						}
						break;
					};
					// Toggles piloting of a nearby claimable AI. Works in any mode, unlike the
					// sandbox-gated cheats above.
					case 'h':
						tank.room.togglePossession(tank);
						break;
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
					case 'mouseR':
					case 'k': {
						tank.inputs[data.data.key] = 0;
						break;
					};
					case 'enter': {
						// While piloting, the socket's own body is a dead husk but the player is alive
						// as the piloted entity - a stray 'enter' must not respawn the husk out from
						// under the possession. Release is done via the H key.
						const cur = controller.getPlayer(socket.id);
						if (cur && cur.piloting) { break; }
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
				const human = controller.getPlayer(socket.id);
				if (!human) { break; }
				if (human.botMod) { break; }
				// mouse_x/mouse_y update unconditionally, but dir is left alone while auto-spin
				// ('c') owns it, since mousemove isn't synced to the room tick.
				applyMouseMove(human, activeEntityOf(human), data.data);
				break;
			};
			case 'upgrade': {
				const tank = controller.getPlayer(socket.id);
				if (!tank) { break; }
				// While piloting, the human's body is an abandoned husk - block upgrades on it.
				if (tank.piloting) { break; }
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

	// Target spacing between GameUpdate packets; must stay >= the simulation step or
	// consecutive packets carry an identical world, causing interpolation stutter.
	const SEND_MS = Math.max(config.SEND_MS, config.TICK_MS);
	const IDLE_MS = 200;   // spacing while the client has nothing to look at yet
	// Leaderboard/minimap/message-feed cadence, kept separate from longloop's heartbeat tick.
	const UI_MS = config.UI_MS;
	/*
		The send loop and simulation clock are separate timers, so even at equal periods they
		drift and occasionally two sends land within one simulation step, producing a duplicate
		world snapshot (head.timestamp unchanged) that the client's interpolation reads as the
		entity having stopped. Rather than send the duplicate, retry after a quarter step - short
		enough to avoid a visible gap - which also re-anchors the loop to the step boundary.
	*/
	const RETRY_MS = Math.max(4, Math.round(config.TICK_MS / 4));
	/*
		Computes the delay until a self-re-arming loop's next firing. `due` advances by exactly
		`period` each call, keeping the average rate correct even when a tick runs long. If more
		than one period has been missed (a stall), the deadline resets to now instead of firing
		a catch-up burst.
	*/
	function nextDelay(it, key, period) {
		const now = Date.now();
		let due = (it[key] || now) + period;
		if (due < now - period) { due = now + period; }
		it[key] = due;
		return Math.max(0, due - now);
	}

	function loop(socket) {
		// Set here rather than left to the caller's assignment: this.gameloop() below can run
		// before `socket.main = new loop(socket)` completes, and if it kicks the socket
		// immediately, kick() needs socket.main already set to stop the loops it just armed.
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
		// The entity an UpdateUp stat snapshot was last sent for. Compared every gameloop() tick
		// so possession changes, timeouts, death and respawn all re-sync stats, not just keydown.
		this.statSource = null;
		this.gameloop = function () {
			if (!this.run) { return; }
			if (this.chat) {
				this.chat--;
			}
			{
				const human = controller.getPlayer(this.socket.id);
				const source = activeEntityOf(human);
				if (source !== this.statSource) {
					this.statSource = source;
					if (source) { talk(this.socket, 'UpdateUp', source.upNb); }
				}
			}
			const id = controller.clients[this.socket.id];
			let ms = SEND_MS;
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
					// getBuffer() can return the string 'Waiting' (truthy, not an object) for a
					// disconnected/kicked id that a lingering timer still reaches; guard against
					// reading .head off a non-object.
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
			// A send that ran long eats into the next delay instead of pushing it back, so the
			// spacing the client measures stays close to `ms`.
			if (ms !== this.sendPeriod) { this.sendPeriod = ms; this.sendDue = 0; }
			setTimeout((it) => { it.gameloop() }, nextDelay(this, 'sendDue', ms), this);
		};
		this.longloop = function () {
			if (!this.run) { return; }
			// Request-rate limiting: too many requests in one window gets the socket kicked,
			// otherwise the counters reset for the next window.
			if (this.request >= 50) {
				kick(this.socket, 'ERR_REQUESTS_DELAY')
				return;
			} else {
				this.request = 0;
				this.strikes = 0;
			}
			const play = controller.getPlayer(socket.id);
			if (this.dead > config.S_BEFORE_KICK) {
				kick(this.socket, 'ERR_SERVER_OFF');
				return;
			}
			if (play) {
				// While piloting, the human's own body is a dead husk but the player is alive as
				// the piloted entity - the AFK-dead kick must check that entity, not the husk.
				const cam = activeEntityOf(play);
				if (cam.dead) {
					this.dead++;
				} else {
					this.dead = 0;
				}
			};
			if (this.heartbeats >= 10) {
				kick(this.socket, 'ERR_HEARTBEATS_LOST');
			} else {
				talk(this.socket, 'ping', 0);
			}
			this.heartbeats++;
			setTimeout((it) => { it.longloop() }, nextDelay(this, 'slowDue', 1000), this);
		};
		// Leaderboard, minimap and message feed, on their own cadence separate from
		// heartbeat/AFK bookkeeping in longloop.
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
exports.activeEntityOf = activeEntityOf;