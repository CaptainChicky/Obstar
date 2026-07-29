/*
	Client motion tests.

	public/motion.js is the fix for the two things a player actually reported: bullets that
	crawl for half a second after you fire them, and a camera that slides off the tank while
	you move. Both were the same root cause - an exponential filter chasing a moving target -
	and both are invisible to every other suite here, because they are rendering behaviour and
	test/smoke.js only ever looks at the bytes on the wire.

	So this file drives the interpolator the way a frame loop would and asserts the properties
	the old smoother failed: an entity moving at a constant speed is drawn moving at that same
	constant speed, from the first frame it can be, with a bounded and *constant* lag.

	Half of these are written as a direct comparison against the code that was replaced -
	`oldSmooth()` below is the exact line that used to be in the client - because "is this
	better" is the actual question and a bare threshold would not answer it.

	motion.js is loaded with a plain require(): it ends with the same typeof(exports) sniff as
	public/SHARE/SocketSchema.js, so Node gets the same object the browser puts on `window`.
*/
const MOTION = require('../public/motion.js');
const NET = MOTION.NET;
const Interp = MOTION.Interp;

let passed = 0, failed = 0;
function check(name, ok, detail) {
	if (ok) { passed++; console.log('  ok   ' + name); }
	else { failed++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + detail : '')); }
}
function near(a, b, tol) { return Math.abs(a - b) <= tol; }

// Read the packet spacing from config rather than restating it, so retuning the server's
// send rate cannot leave this harness quietly measuring a rate nobody runs.
const TICK = Math.max(require('../lib/config.js').config.SEND_MS,
	require('../lib/config.js').config.TICK_MS);
const FPP = 2;            // animation frames per packet - a whole number keeps the
const FRAME = TICK / FPP;     // ...per-frame arithmetic below exact
const SPEED = 12;    // world units per packet - a middling bullet

/*
	Feed an interpolator a stream of packets for an entity moving at a constant SPEED along x,
	sampling every animation frame in between, and report what was drawn.
*/
function run(opts) {
	opts = opts || {};
	NET.reset();
	let t = 1000;
	let truth = 0;
	const e = new Interp(0, 0);
	const frames = [];
	for (let p = 0; p < (opts.packets || 12); p++) {
		NET.mark(t);
		e.push(truth, 0, t);
		for (let f = 0; f < TICK / FRAME; f++) {
			const at = t + f * FRAME;
			e.sample(at);
			frames.push({ t: at, drawn: e.x, truth: truth, packet: p, phase: f });
		}
		truth += SPEED;
		t += TICK;
	}
	return frames;
}

/* The line that used to do this job, run over the same schedule. */
function oldSmooth() {
	const SMOOTH = 0.15;
	let d = 0, truth = 0, frames = [];
	for (let p = 0; p < 12; p++) {
		for (let f = 0; f < TICK / FRAME; f++) {
			d += (truth - d) * SMOOTH;
			frames.push({ drawn: d, truth: truth, packet: p });
		}
		truth += SPEED;
	}
	return frames;
}

/* Drawn speed per frame, over the frames of one packet interval. */
function drawnSpeed(frames, packet) {
	const f = frames.filter((x) => x.packet === packet);
	return (f[f.length - 1].drawn - f[0].drawn) / (f.length - 1);
}

console.log('obstar client motion tests\n');

console.log('interpolation:');
{
	const frames = run();
	const perFrame = SPEED / (TICK / FRAME);   // what a constant-speed entity should cover per frame

	// THE BUG. The old filter starts from rest and spends ~30 frames winding up, so the first
	// packet-interval of a bullet's life is drawn at a small fraction of its real speed.
	const oldFrames = oldSmooth();
	check('the old smoother drew the first interval far too slow',
		drawnSpeed(oldFrames, 1) < perFrame * 0.5,
		'drew ' + drawnSpeed(oldFrames, 1).toFixed(2) + ' of ' + perFrame.toFixed(2) + ' per frame');
	check('the old smoother still had not reached full speed after 10 intervals',
		drawnSpeed(oldFrames, 10) < perFrame * 0.98,
		drawnSpeed(oldFrames, 10).toFixed(3) + ' vs ' + perFrame.toFixed(3));

	// THE FIX. From the second packet on - the first instant two positions exist to
	// interpolate between - the drawn speed is the real speed.
	check('drawn at full speed from the second packet on',
		near(drawnSpeed(frames, 1), perFrame, perFrame * 0.02),
		drawnSpeed(frames, 1).toFixed(3) + ' vs ' + perFrame.toFixed(3));
	check('...and every packet after that',
		[2, 5, 8, 11].every((p) => near(drawnSpeed(frames, p), perFrame, perFrame * 0.02)),
		[2, 5, 8, 11].map((p) => drawnSpeed(frames, p).toFixed(2)).join(' '));

	// Speed being right is not enough: it must also be in the right *place*, trailing by one
	// interval and no more. The old filter's lag grew with speed and never settled.
	const lag = frames.filter((f) => f.packet >= 2).map((f) => f.truth - f.drawn);
	const lo = Math.min.apply(null, lag), hi = Math.max.apply(null, lag);
	check('lag is bounded at about one packet interval of travel',
		hi <= SPEED * 2.05 && lo >= -0.001,
		'between ' + lo.toFixed(2) + ' and ' + hi.toFixed(2) + ' units');
	// Compared at the same phase of the interval each time - within one interval the lag
	// sawtooths, because `truth` steps once per packet while the drawing advances every frame.
	// What must not happen is the lag at a given phase drifting from packet to packet, which
	// is what the old filter did until it had finished winding up.
	const atPhase0 = frames.filter((f) => f.packet >= 2 && f.phase === 0).map((f) => f.truth - f.drawn);
	check('lag is constant, not growing',
		near(Math.min.apply(null, atPhase0), Math.max.apply(null, atPhase0), SPEED * 0.02),
		atPhase0.map((n) => n.toFixed(2)).join(' '));

	// Monotonic: no frame may draw the entity behind where the previous frame drew it. A
	// bullet that stutters backwards is the most visible artefact there is.
	let backwards = 0;
	for (let i = 1; i < frames.length; i++) {
		if (frames[i].drawn < frames[i - 1].drawn - 1e-9) { backwards++; }
	}
	check('never draws a step backwards', backwards === 0, backwards + ' frames');
}

console.log('\nspawning:');
{
	// A brand-new entity has exactly one position. It must hold still, not jump to the origin
	// and not fly off; the second packet is what gives it a velocity.
	NET.reset();
	const e = new Interp(500, -200);
	NET.mark(1000);
	e.push(500, -200, 1000);
	e.sample(1000 + FRAME);
	check('a one-snapshot entity is drawn where it spawned',
		e.x === 500 && e.y === -200, e.x + ',' + e.y);
	e.push(512, -200, 1030);
	e.sample(1030);
	check('the second packet does not make it jump',
		near(e.x, 500, 0.6), e.x);
}

console.log('\nteleports and id reuse:');
{
	NET.reset();
	const e = new Interp(0, 0);
	NET.mark(1000); e.push(0, 0, 1000);
	NET.mark(1030); e.push(12, 0, 1030);
	// A respawn, or the entity slot being handed to a different entity - see HANDOFF "Entity
	// storage". Interpolating across it would draw a streak over the whole map.
	NET.mark(1060); e.push(3000, 2000, 1060);
	e.sample(1060);
	check('a jump past the teleport threshold cuts instead of lerping',
		e.x === 3000 && e.y === 2000, e.x + ',' + e.y);
	e.sample(1060 + FRAME * 4);
	check('...and stays put until the next packet',
		e.x === 3000 && e.y === 2000, e.x + ',' + e.y);
	check('the threshold is well above anything the game can move in one packet',
		Interp.TELEPORT > 40 * (TICK / 20), Interp.TELEPORT);
}

console.log('\npacket loss:');
{
	// One dropped packet must coast, not freeze and not extrapolate off the map.
	NET.reset();
	const e = new Interp(0, 0);
	NET.mark(1000); e.push(0, 0, 1000);
	NET.mark(1030); e.push(12, 0, 1030);
	const atGap = e.sample(1030 + TICK * 4).x;
	check('coasts forward through a gap', atGap > 12, atGap);
	check('but stops well short of extrapolating away',
		atGap <= 12 + 12 * Interp.MAX_EXTRAP + 1e-9, atGap);
}

console.log('\nlead (own-bullet sync with the tank):');
{
	// public/client/entities.js leads the local tank's own bullets by NET.interval, so a
	// bullet stays in sync with the tank itself (drawn at interp+predic, roughly "now") instead
	// of trailing NET.interval behind it like everything else does - see public/motion.js's
	// sample(t, lead) and public/client/entities.js's Bullet.update().
	NET.reset();
	const e = new Interp(0, 0);
	NET.mark(1000); e.push(0, 0, 1000);
	NET.mark(1030); e.push(SPEED, 0, 1030);

	const unled = e.sample(1030, 0).x;
	const led = e.sample(1030, NET.interval).x;
	check('leading by one interval draws at the newest snapshot instead of one interval behind it',
		near(led, SPEED, 0.05) && unled < led,
		unled.toFixed(3) + ' -> ' + led.toFixed(3) + ' (truth ' + SPEED + ')');

	// Without the raised cap, a lead this large would be clamped back down by the ordinary
	// MAX_EXTRAP the same as coasting through packet loss - defeating the point of leading.
	const span = 30;
	const farLead = span * (Interp.MAX_EXTRAP + 1);
	const farAt = e.sample(1030, farLead).x;
	const oldCapX = SPEED * Interp.MAX_EXTRAP;    // where the unraised cap would have clamped it
	check('a large lead is not eaten by the ordinary extrapolation cap',
		farAt > oldCapX, farAt.toFixed(2) + ' vs old cap ' + oldCapX.toFixed(2));
}

console.log('\nstep clock (the send rate is not the tick rate):');
{
	/*
		The rubber-banding players reported at speed. The simulation steps every TICK_MS and the
		send loop fires every SEND_MS on its own timer, so consecutive packets carry a whole
		number of steps of world - 1 or 2 - while arriving an even SEND_MS apart. Stamping each
		snapshot with its arrival time therefore draws a variable amount of travel across a fixed
		window, and the drawn speed oscillates even though the entity's real speed is constant
		and the network is perfect.

		Both halves of the fix are exercised here, because either alone leaves it visible: the
		snapshot times come from the room step counter on the wire (NET.mark's second argument),
		and Interp keeps enough of them that the instant being drawn is always straddled.
	*/
	const CFG = require('../lib/config.js').config;
	const FRAME = 1000 / 144;
	const SPEED = 0.4;    // units per ms, a fast tank

	function drive(useStamp) {
		NET.reset();
		const e = new Interp(0, 0);
		let simT = 0, step = 0, nextSend = CFG.SEND_MS, nextFrame = 0, sentStep = -1;
		const frames = [];
		for (let t = 0; t <= 8000; t += 0.5) {
			while (simT + CFG.TICK_MS <= t) { simT += CFG.TICK_MS; step++; }
			if (t >= nextSend) {
				nextSend += CFG.SEND_MS;
				if (step !== sentStep) {
					sentStep = step;
					e.push(simT * SPEED, 0, useStamp ? NET.mark(t, step) : NET.mark(t));
				}
			}
			if (t >= nextFrame && e.n >= 2) {
				nextFrame = t + FRAME;
				frames.push({ t: t, drawn: e.sample(t).x, truth: simT * SPEED });
			}
		}
		return frames;
	}
	/* Widest drawn speed swing, as a fraction of the true speed, over the settled tail. */
	function swing(frames) {
		let lo = Infinity, hi = -Infinity;
		for (let i = Math.floor(frames.length / 2); i < frames.length; i++) {
			const v = (frames[i].drawn - frames[i - 1].drawn) / (frames[i].t - frames[i - 1].t);
			if (v < lo) { lo = v; }
			if (v > hi) { hi = v; }
		}
		return (hi - lo) / SPEED;
	}

	const arrival = drive(false), stamped = drive(true);
	// Only meaningful while the two rates differ; if they are ever made equal there is no
	// sawtooth left to remove and this whole section is moot rather than failing.
	check('arrival stamping visibly oscillates on a perfect network',
		CFG.SEND_MS === CFG.TICK_MS || swing(arrival) > 0.5,
		(swing(arrival) * 100).toFixed(0) + '% of true speed');
	check('step stamping draws it at a near-constant speed',
		swing(stamped) < 0.1, (swing(stamped) * 100).toFixed(0) + '% of true speed');
	check('and does not pay for it in latency',
		near(stamped[stamped.length - 1].truth - stamped[stamped.length - 1].drawn,
			arrival[arrival.length - 1].truth - arrival[arrival.length - 1].drawn, SPEED * 12),
		(stamped[stamped.length - 1].truth - stamped[stamped.length - 1].drawn).toFixed(1)
		+ ' vs ' + (arrival[arrival.length - 1].truth - arrival[arrival.length - 1].drawn).toFixed(1) + ' units');

	// The history depth is what stops the read point falling off the old end of the buffer.
	// A clamp there is a freeze - two frames drawn in the same place - and the catch-up after
	// it is the lurch. Neither may happen once the entity is properly running.
	let frozen = 0, backwards = 0;
	for (let i = Math.floor(stamped.length / 2); i < stamped.length; i++) {
		if (stamped[i].drawn <= stamped[i - 1].drawn) { frozen++; }
		if (stamped[i].drawn < stamped[i - 1].drawn) { backwards++; }
	}
	check('never freezes on the oldest position it holds', frozen === 0, frozen + ' frames');
	check('and never draws backwards', backwards === 0, backwards + ' frames');

	// One step's length is measured, not assumed - the browser cannot see lib/config.js.
	check('measures the server step length off the wire',
		near(NET.stepMs, CFG.TICK_MS, 0.5), NET.stepMs.toFixed(3) + ' vs ' + CFG.TICK_MS);

	// A backgrounded tab comes back with a step counter hundreds ahead. Easing across that at
	// STEP_GAIN would take minutes of crawling; it has to be treated as a cut.
	const before = NET.stepMs;
	const jumped = NET.mark(NET.last + 30000, NET.stamp + 1200);
	check('a stall is cut, not eased across', jumped === NET.last, jumped);
	check('...and the step length learned before it is kept',
		NET.stepMs === before, NET.stepMs.toFixed(3));
}

console.log('\ninterval estimate:');
{
	NET.reset();
	check('seeded at the send rate net/gameSocket.js aims for',
		NET.interval === MOTION.NET_TICK, NET.interval);
	let t = 0;
	for (let i = 0; i < 200; i++) { t += 45; NET.mark(t); }
	check('converges on the spacing packets really arrive with',
		near(NET.interval, 45, 1), NET.interval.toFixed(2));
	// A backgrounded tab produces gaps of seconds. Averaging one in would make everything on
	// screen crawl for the next minute.
	const before = NET.interval;
	NET.mark(t + 9000);
	check('a multi-second stall is ignored, not averaged in',
		NET.interval === before, NET.interval.toFixed(2));
}

console.log('\nframe-rate independence:');
{
	// Every `d += (target-d)*k` in the client was tuned at 60Hz. lerpK converts k for the
	// frame we actually got, so 144Hz does not smooth 2.4x faster.
	check('unchanged at 60fps', MOTION.lerpK(0.3, 1) === 0.3, MOTION.lerpK(0.3, 1));
	let d60 = 0, d144 = 0;
	for (let i = 0; i < 60; i++) { d60 += (100 - d60) * MOTION.lerpK(0.3, 1); }
	for (let i = 0; i < 144; i++) { d144 += (100 - d144) * MOTION.lerpK(0.3, 60 / 144); }
	check('one second of smoothing lands in the same place at 60 and 144fps',
		near(d60, d144, 0.01), d60.toFixed(4) + ' vs ' + d144.toFixed(4));
	let raw = 0;
	for (let i = 0; i < 144; i++) { raw += (100 - raw) * 0.3; }
	check('...which the raw factor did not guarantee', raw !== d60);

	// A hitch must not be smoothed away over-eagerly either, but it must stay a factor.
	check('a long frame still produces a factor below 1', MOTION.lerpK(0.3, 4) < 1, MOTION.lerpK(0.3, 4));
	check('a long frame smooths further than a short one', MOTION.lerpK(0.3, 4) > MOTION.lerpK(0.3, 1));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
