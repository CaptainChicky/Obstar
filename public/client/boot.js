/*
	Entry point. preRun() paints the connecting screen and opens the socket; the first
	GameUpdate hands over to CLIENT.Run(), which public/client/game.js installed earlier.

	Loading this file last is what makes the load order in views/play.ejs load-bearing.
*/
(function (CLIENT) {
	const CONST = CLIENT.CONST;
	const Palette = CLIENT.Palette;
	const Global = CLIENT.Global;
	const General = CLIENT.General;
	function preRun() {
		//
		if (!General['canvas']) {
			General['canvas'] = document.createElement('CANVAS');
			General['canvas'].oncontextmenu = event => event.preventDefault();
			General['canvas'].style.width = '100%';
			General['canvas'].style.height = '100%';
			document.body.style.backgroundColor = Palette.Grid[1];
			document.body.appendChild(General['canvas']);
		}
		General['ctx'] = General['canvas'].getContext('2d');
		const ctx = General['ctx'];
		//////////
		General['foreground'] = new function () {
			this.y = -5000;
			this.alpha = -160;
			this.actual = 'Connection...';
			this.little = '';
			this.errorAlpha = 0;
			this.eA = 0;
			this.show = 1;
			this.update = () => {
				this.y += -this.y * 0.04;
				this.alpha += (1 - this.alpha) * 0.04;
				this.eA += (this.errorAlpha - this.eA) * 0.06;
			};
			this.draw = () => {
				ctx.globalAlpha = this.eA;
				ctx.fillStyle = '#a92c2c';
				ctx.fillRect(0, 0, Global.winW, Global.winH);
				///
				ctx.translate(Global.winW / 2, Global.winH / 2 + this.y)
				ctx.globalAlpha = Math.max(0, this.alpha);
				ctx.font = '700 70px Catamaran';
				ctx.strokeStyle = '#333333';
				ctx.lineJoin = 'miter';
				ctx.fillStyle = this.errorAlpha ? '#e69696' : '#e8e8e8';
				ctx.lineWidth = 10;
				let m = ctx.measureText(this.actual);
				ctx.strokeText(this.actual, -m.width / 2, 0);
				ctx.fillText(this.actual, -m.width / 2, 0);
				///
				ctx.font = '700 15px Catamaran';
				m = ctx.measureText(this.little);
				ctx.fillText(this.little, -m.width / 2, 26);
			};
			this.setInfo = (i, l = '', e = 0) => {
				this.actual = i;
				this.little = l;
				this.y = -100;
				this.alpha = -5;
				this.errorAlpha = e;
			};
			if (General['KICK']) {
				this.setInfo('Access Denied!', General['KICK'], 1)
			}
		};
		General['STATES'] = 'Connection';
		//////////
		General['Interact'] = {
			onresize: () => {
				Global.winW = window.innerWidth;
				Global.winH = window.innerHeight;
				Global.canW = General['canvas'].width = Global.winW * CONST.RESOLUTION;
				Global.canH = General['canvas'].height = Global.winH * CONST.RESOLUTION;
			},
			onkeydown: e => {
			}
		};
		General.Interact.onresize();
		// Spelled out rather than `for(let i in General['Interact']){ window[i] = ... }`; see the
		// matching note in public/client/game.js (HANDOFF 8.12.2). boot.js only wires these two.
		window.onresize = General['Interact'].onresize;
		window.onkeydown = General['Interact'].onkeydown;
		//////////
		function Draw() {
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, Global.canW, Global.canH);
			ctx.globalAlpha = 1;
			ctx.fillStyle = "#ffffff";
			ctx.fillRect(0, 0, Global.canW, Global.canH);
			ctx.scale(CONST.RESOLUTION, CONST.RESOLUTION)
			General['foreground'].draw();
		};
		function Loop() {
			General['foreground'].update();
			Draw();
			if (General['preRun']) {
				requestAnimationFrame(Loop);
			} else {
				CLIENT.Run();
			}
		};
		General['preRun'] = 1;
		Loop();
		/////////
		General['KICK'] = General['KICK'] || 0;
		General['WS'] = General['KICK'] ? 0 : (() => {
			const socket = new WebSocket(WS_LINK)
			socket.binaryType = 'arraybuffer';
			socket.onopen = () => {
				socket.send(PROTO.encode('init', POST))
			};
			socket.onmessage = (packet) => {
				const decoded = PROTO.decode(packet.data);
				const type = decoded.type;
				switch (type) {
					case 'ping': {
						socket.send(PROTO.encode('ping', 0))
						break;
					};
					case 'kick': {
						General['KICK'] = decoded.reason;
						General['foreground'].setInfo('Access denied!', 'err ' + decoded.reason, 1);
						break;
					};
					case 'GameUpdate': {
						General['preRun'] = 0;
						General['GGG'] = decoded.data;
						break;
					};
				}
			};
			socket.onclose = (err) => {
				General['KICK'] = General['KICK'] || 'Connection lost';
			};
			return socket;
		})();
	};
	///
	CLIENT.preRun = preRun;
	window.onload = preRun;
})(typeof (exports) === 'undefined'
	? (window.CLIENT = window.CLIENT || {})
	: (module.exports = global.CLIENT = global.CLIENT || {}));
