/*
	The two things drawn in DOM rather than canvas: the developer console and the chat box.
	Both attach themselves to General as soon as the page parses them, which is where the
	monolith ran them too.
*/
(function (CLIENT) {
	'use strict';
	const General = CLIENT.General;
	/*
		Cosmetics console. The console opens for anyone (Ctrl+Shift+L,
		game.js:320) - always did, since there was never a client-side gate on it, only on
		whether a typed command did anything server-side. Rather than gate the console itself,
		a recognised *cosmetic* command (color/uiscale/palette/fps/help/clear) is handled and
		persisted entirely client-side and never reaches the socket; anything else still goes to
		the server exactly as before, where lib/Controller.js's command() gates on devlevel. So
		this adds no new attack surface - a non-admin typing an admin command still gets nothing.
	*/
	const COSMETICS_KEY = 'obstar_cosmetics';
	const cosmetics = (() => {
		try { return JSON.parse(localStorage.getItem(COSMETICS_KEY)) || {}; } catch { return {}; }
	})();
	function saveCosmetics() {
		try { localStorage.setItem(COSMETICS_KEY, JSON.stringify(cosmetics)); } catch { /* storage unavailable - cosmetic, fine to drop */ }
	}
	(function applyCosmetics() {
		const Palette = CLIENT.Palette;
		if (cosmetics.palette) {
			for (const name in cosmetics.palette) {
				if (Palette[name]) Palette[name] = cosmetics.palette[name];
			}
		}
		if (cosmetics.uiscale) {
			CLIENT.CONST.RESOLUTION = cosmetics.uiscale;
		}
	})();
	const HEX6 = /^[0-9a-fA-F]{6}$/;
	const COSMETIC_COMMANDS = {
		help: () => [
			'cosmetic commands (client-side only):',
			'  color <name> <hex6> [hex6-dark] - recolor a palette entry, e.g. color green ff0000',
			'  palette reset                   - undo all color overrides (reload to fully apply)',
			'  uiscale <0.5-2>                 - resize the HUD/canvas',
			'  fps <on|off>                    - toggle the fps counter',
			'  clear                           - clear this console',
			'anything else is sent to the server, which still requires an admin account.'
		],
		color: (args) => {
			const Palette = CLIENT.Palette;
			const name = args[0], hexA = args[1], hexB = args[2];
			if (!name || !Palette[name] || !HEX6.test(hexA || '')) {
				return ['usage: color <name> <hex6> [hex6-dark]'];
			}
			const pair = ['#' + hexA, '#' + (HEX6.test(hexB || '') ? hexB : hexA)];
			cosmetics.palette = cosmetics.palette || {};
			cosmetics.palette[name] = pair;
			Palette[name] = pair;
			saveCosmetics();
			return [`color "${name}" set to ${pair[0]}`];
		},
		palette: (args) => {
			if (args[0] !== 'reset') return ['usage: palette reset'];
			delete cosmetics.palette;
			saveCosmetics();
			return ['palette overrides cleared - reload the page to fully restore defaults'];
		},
		uiscale: (args) => {
			const s = parseFloat(args[0]);
			if (isNaN(s) || s < 0.5 || s > 2) return ['usage: uiscale <0.5-2>'];
			cosmetics.uiscale = s;
			saveCosmetics();
			CLIENT.CONST.RESOLUTION = s;
			if (General['Interact']) General['Interact'].onresize();
			return [`ui scale set to ${s}`];
		},
		fps: (args) => {
			if (args[0] !== 'on' && args[0] !== 'off') return ['usage: fps <on|off>'];
			cosmetics.fps = args[0] === 'on';
			saveCosmetics();
			CLIENT.Global.showFps = cosmetics.fps;
			return [`fps counter ${args[0]}`];
		}
	};
	General['DEV'] = (() => {
		const dev = {
			isOn: 0,
		};
		const input = document.createElement('INPUT');
		input.onkeydown = function (e) {
			switch (e.key) {
				case 'ArrowUp': {
					if (curs > 0) {
						curs--;
						input.value = history[curs];
					}
					break;
				}
				case 'ArrowDown': {
					if (curs < history.length - 1) {
						curs++;
						input.value = history[curs];
					}
					break;
				}
			}
		};
		input.type = 'text';
		input.id = 'dinput';
		input.maxLength = '255';
		let history = [''], curs = 0;
		const div = document.createElement('DIV');
		div.appendChild(input);
		div.id = 'console'
		// Clicking the dimmed page itself (not the input, not a log line) closes the console.
		div.onclick = (e) => { if (e.target === div) toggle(); };
		////
		function toggle() {
			General['CHAT'].isOn ? General['CHAT'].toggle() : 0;
			if (dev.isOn) {
				document.body.removeChild(div);
			} else {
				document.body.appendChild(div);
				input.focus();
			}
			dev.isOn = !dev.isOn;
		};
		dev.toggle = toggle;
		window.toggleConsole = toggle;
		////
		// Newest entry lands right under the input (as input.nextSibling); everything already
		// there gets pushed down. Lines within one call keep their relative order.
		function prepend(lines) {
			for (let i = lines.length - 1; i >= 0; i--) {
				const line = document.createElement('DIV');
				line.innerHTML = lines[i].replace(/ /g, '\u00a0');
				div.insertBefore(line, input.nextSibling);
			}
		}
		function send() {
			const value = input.value;
			if (!value.length) return;
			const args = value.trim().split(/\s+/);
			const cmd = args.shift().toLowerCase();
			if (cmd === 'clear') {
				div.innerHTML = '';
				div.appendChild(input);
				input.value = '';
				input.focus();
				return;
			}
			if (COSMETIC_COMMANDS[cmd]) {
				prepend(['> ' + value, ...COSMETIC_COMMANDS[cmd](args)]);
			} else {
				prepend(['> ' + value]);
				General['WS'].send(PROTO.encode('com', value))
			}
			history[history.length - 1] = value;
			curs = history.length;
			history.push('');
			input.value = '';
		}
		dev.send = send;
		////
		function log(arr) {
			prepend(arr);
		}
		dev.log = log;
		////
		return dev;
	})();
	General['CHAT'] = (() => {
		const chat = {
			isOn: 0,
		};
		const input = document.createElement('INPUT');
		input.type = 'text';
		input.id = 'cinput';
		input.maxLength = '100';
		const div = document.createElement('DIV');
		div.id = 'chat';
		const mess = document.createElement('DIV');
		mess.id = 'mess';
		mess.innerHTML =
			"<div style='line-height: 115%'>" +
			"<span style='opacity: 0.6;font-size:1.1em;'>Welcome to the chat!</span></br>" +
			"&nbsp;&nbsp;/join to join a chat</br>" +
			"&nbsp;&nbsp;/quit to quit the chat</br>" +
			"&nbsp;&nbsp;/name to get the chat name</br>" +
			"</div>";
		div.appendChild(mess);
		div.appendChild(input);
		////
		function toggle() {
			if (General['DEV'].isOn) {
				General['DEV'].toggle();
			}
			if (chat.isOn) {
				document.body.removeChild(div);
			} else {
				document.body.appendChild(div);
				input.focus();
			}
			chat.isOn = !chat.isOn;
		};
		chat.toggle = toggle;
		////
		function send() {
			if (input.value.length) {
				General['WS'].send(PROTO.encode('chat', input.value))
				input.value = '';
			}
		}
		chat.send = send;
		////
		function escapeHtml(html) {
			const text = document.createTextNode(html);
			const p = document.createElement('p');
			p.appendChild(text);
			return p.innerHTML;
		}
		function log(arr) {
			for (const data of arr) {
				const log = document.createElement('DIV');
				const splited = data[0].split(' ');
				const name = splited.slice(1).join(' ');
				log.innerHTML = data[0].length ? `<span style="color: #${splited[0]}">` + escapeHtml(name) + ' : </span>' : '<span style="color:#ccc;font-weight:500">server : </span>'
				log.innerHTML += escapeHtml(data[1]);
				const doScroll = (mess.scrollTop + mess.clientHeight >= mess.scrollHeight - 5);
				mess.appendChild(log, input);
				if (doScroll) {
					mess.scrollTo(0, mess.scrollHeight);
				}
			}
		}
		chat.log = log;
		////
		return chat;
	})();
})(typeof (exports) === 'undefined'
	? (window.CLIENT = window.CLIENT || {})
	: (module.exports = global.CLIENT = global.CLIENT || {}));
