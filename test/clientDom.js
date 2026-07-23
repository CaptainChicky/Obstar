/*
	The smallest DOM public/client/ will boot against.

	The client is 3200 lines of canvas 2D and had never been executed by anything but a
	browser, which is why "the game has never been opened since the refactor" sat at the top of
	HANDOFF's not-verified list for so long: no test could reach it. It does not actually need
	a DOM, though - it needs about sixty methods that return plausible nothings. This is them.

	What the stub deliberately does NOT do is pretend to render. Nothing here checks a pixel;
	the 2D context is a Proxy that answers every unknown property with a no-op function. The
	point is to run the code paths - the render loop, the packet handler, every entity's
	update() and draw() - so that a ReferenceError, a call on undefined, or a NaN reaching the
	transform is caught here instead of by a player.

	Used by test/client.js. Kept separate because the stub is uninteresting and the assertions
	are not.
*/
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/*
	Canonical serialization of one argument or property value written to a 2D context, for the
	op-stream differential (test/clientDiff.js). Numbers full-precision so a real change shows;
	canvases carry their dimensions because the client sizes off-screen caches by hand.
*/
function fmtArg(v) {
	if (typeof v === 'number') { return Number.isFinite(v) ? String(v) : (v !== v ? 'NaN' : (v > 0 ? 'Inf' : '-Inf')); }
	if (typeof v === 'string') { return JSON.stringify(v); }
	if (v && typeof v === 'object') {
		if (v.tagName === 'CANVAS' || ('width' in v && 'height' in v && v.getContext)) { return '<canvas ' + v.width + 'x' + v.height + '>'; }
		if (typeof v.addColorStop === 'function') { return '<gradient>'; }
		return '<obj>';
	}
	return String(v);
}

/* Every 2D context call is a no-op; the few with return values are named. Recorded
	 transforms are exposed so a test can assert that nothing non-finite reached the canvas.
	 When `record.ops` is present, every call and property write is appended to it in order -
	 that ordered stream is the canvas-call differential rebuilt (HANDOFF §6 / §12.2). */
function makeCtx(record) {
	function logCall(name, args) {
		if (record.ops) { record.ops.push('c:' + name + '(' + Array.prototype.map.call(args, fmtArg).join(',') + ')'); }
	}
	const real = {
		measureText: function () { logCall('measureText', arguments); return { width: 10 }; },
		createLinearGradient: function () { logCall('createLinearGradient', arguments); return { addColorStop: function () { } }; },
		createRadialGradient: function () { logCall('createRadialGradient', arguments); return { addColorStop: function () { } }; },
		createPattern: function () { logCall('createPattern', arguments); return null; },
		getImageData: function () { logCall('getImageData', arguments); return { data: new Uint8ClampedArray(4) }; },
		setTransform: function (a, b, c, d, e, f) { record.transform(a, b, c, d, e, f); logCall('setTransform', arguments); },
		translate: function (x, y) { record.translate(x, y); logCall('translate', arguments); },
		drawImage: function () { record.draws++; logCall('drawImage', arguments); }
	};
	return new Proxy(real, {
		get: function (t, k) {
			if (k in t) { return t[k]; }
			return function () { logCall(k, arguments); return undefined; };
		},
		set: function (t, k, v) { if (record.ops) { record.ops.push('s:' + k + '=' + fmtArg(v)); } t[k] = v; return true; }
	});
}

function makeElement(record, tag) {
	return {
		tagName: String(tag).toUpperCase(),
		style: {}, dataset: {}, children: [],
		width: 1920, height: 1080,
		innerHTML: '', textContent: '', value: '',
		scrollTop: 0, clientHeight: 0, scrollHeight: 0,
		classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } },
		getContext: function () { return makeCtx(record); },
		appendChild: function (c) { this.children.push(c); return c; },
		insertBefore: function (c) { this.children.push(c); return c; },
		removeChild: function () { },
		addEventListener: function () { },
		removeEventListener: function () { },
		getBoundingClientRect: function () { return { left: 0, top: 0, width: 1920, height: 1080 }; },
		setAttribute: function () { }, getAttribute: function () { return null; },
		scrollTo: function () { }, focus: function () { }, blur: function () { }
	};
}

/*
	Boot the client. Returns handles for driving it: `frame()` runs one animation frame,
	`deliver(bytes)` hands the socket a packet, `record` accumulates what reached the canvas.
*/
function boot(POST, opts) {
	opts = opts || {};
	const record = {
		draws: 0,
		badTransform: 0,
		badTranslate: 0,
		lastCamera: null,
		ops: opts.recordOps ? [] : null,
		transform: function (a, b, c, d, e, f) {
			if (![a, b, c, d, e, f].every(Number.isFinite)) { this.badTransform++; }
			else { this.lastCamera = { sx: e, sy: f, scale: a }; }
		},
		translate: function (x, y) {
			if (!Number.isFinite(x) || !Number.isFinite(y)) { this.badTranslate++; }
		}
	};

	const rafQueue = [];
	const clock = { at: 1000 };

	const document = {
		createElement: function (tag) { return makeElement(record, tag); },
		createTextNode: function (t) { return { nodeValue: t }; },
		getElementById: function () { return makeElement(record, 'div'); },
		getElementsByTagName: function () { return [makeElement(record, 'div')]; },
		getElementsByClassName: function () { return []; },
		querySelector: function () { return makeElement(record, 'div'); },
		querySelectorAll: function () { return []; },
		addEventListener: function () { },
		body: makeElement(record, 'body'),
		documentElement: makeElement(record, 'html')
	};

	const window = {
		document: document,
		innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1,
		addEventListener: function () { },
		requestAnimationFrame: function (fn) { rafQueue.push(fn); return rafQueue.length; },
		location: { protocol: 'http:', host: 'localhost:80', hostname: 'localhost' },
		navigator: { userAgent: 'node' }
	};
	window.window = window;

	let socket = null;
	// For the differential (test/clientDiff.js) the client must be a pure function of its
	// packets: the four Math.random() sites in entities.js (polygon spin/heading) and the two
	// Date.now() fps reads would otherwise make two runs disagree. Seed both off deterministic
	// sources - a small LCG, and the same frame clock performance.now() already uses.
	let seededMath = Math, seededDate = Date;
	if (opts.deterministic) {
		let s = 0x9e3779b9 >>> 0;
		const rng = function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
		seededMath = new Proxy(Math, { get: function (t, k) { return k === 'random' ? rng : t[k]; } });
		seededDate = new Proxy(Date, { get: function (t, k) { return k === 'now' ? function () { return clock.at; } : t[k]; } });
	}
	const sandbox = {
		window: window, document: document, console: console,
		Math: seededMath, Date: seededDate, JSON, Object, Array, String, Number, Boolean, Promise, Set, Map, Error, RegExp,
		parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
		Uint8Array, Uint8ClampedArray, Float32Array, DataView, ArrayBuffer, Buffer,
		setTimeout: setTimeout, clearTimeout: clearTimeout,
		setInterval: function () { return 0; }, clearInterval: function () { },
		requestAnimationFrame: window.requestAnimationFrame,
		// The client reads performance.now() for frame and packet timing. Driving it from a
		// counter makes the render loop deterministic instead of a race with the test.
		performance: { now: function () { return clock.at; } },
		WebSocket: function () {
			socket = { send: function () { }, close: function () { }, addEventListener: function () { } };
			return socket;
		},
		POST: POST,
		navigator: window.navigator,
		location: window.location
	};
	sandbox.globalThis = sandbox;
	sandbox.self = sandbox;
	vm.createContext(sandbox);

	function load(rel) {
		vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
	}

	load('public/SHARE/ws_link.js');
	// In a browser `window` IS the global object, so `window.WS_LINK = ...` publishes a global.
	// A vm context's `window` is an ordinary object, so republish it by hand.
	sandbox.WS_LINK = window.WS_LINK;
	load('public/SHARE/TanksConfig.js');
	load('public/SHARE/PetsConfig.js');
	load('public/SHARE/SocketSchema.js');
	load('public/motion.js');
	// The client, in the same order views/play.ejs lists it. Keep the two in step.
	for (const f of ['runtime', 'config', 'util', 'drawings', 'entities', 'render', 'ui', 'game', 'overlay', 'boot']) {
		load('public/client/' + f + '.js');
	}

	window.onload();                       // preRun(): canvas, socket, first Loop()
	if (socket && socket.onopen) { socket.onopen(); }

	return {
		record: record,
		sandbox: sandbox,
		socket: function () { return socket; },
		/* Advance the clock and run one animation frame. */
		frame: function (ms) {
			clock.at += (ms === undefined ? 1000 / 60 : ms);
			if (!rafQueue.length) { return false; }
			rafQueue.shift()(clock.at);
			return true;
		},
		advance: function (ms) { clock.at += ms; },
		at: function () { return clock.at; },
		pending: function () { return rafQueue.length; },
		/*
			Hand the socket a packet. preRun() sets binaryType 'arraybuffer', so the client's
			decoder expects an ArrayBuffer, not a Buffer or a typed array - and `socket.onmessage`
			is read fresh each time because Run() replaces preRun's handler with its own once the
			first GameUpdate has arrived.
		*/
		deliver: function (bytes) {
			if (!socket || !socket.onmessage) { return false; }
			const view = ArrayBuffer.isView(bytes) ? bytes : new Uint8Array(bytes);
			socket.onmessage({
				data: view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
			});
			return true;
		},
		/*
			The client boots into a connecting screen and only switches to the game loop on the
			frame after the first GameUpdate. Drive it across that handover and hand back the test
			hook Run() installs.
		*/
		start: function (firstPacket) {
			for (let i = 0; i < 10 && !sandbox.window.__test; i++) {
				this.deliver(firstPacket);
				this.frame();
			}
			return sandbox.window.__test;
		}
	};
}

module.exports = boot;
