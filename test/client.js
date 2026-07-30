/*
	The client, actually running.

	Every other suite here stops at the socket. This one boots public/client/ against the
	stub DOM in test/clientDom.js, hands it real GameUpdate packets encoded from a real room,
	and runs its render loop - so for the first time in this repo the drawing code is executed
	by something other than a person with a browser open.

	It exists because the two bugs a player reported - bullets that crawl for half a second
	after you fire, and a camera that slides off the tank while you move - are both purely
	client-side, and both were invisible to a suite that only ever looked at bytes. What is
	asserted here is what those bugs looked like:

		- a bullet is drawn moving at its real speed as soon as it can be, not accelerating up
			to it (public/motion.js, and test/interp.js for the arithmetic in isolation)
		- the camera is exactly on the player's tank on every frame, at every speed

	plus the things that must simply not happen at all: nothing non-finite reaching a canvas
	transform, and no throw from any entity's update() or draw().

		node test/client.js
*/
const path = require('path');
const ROOT = path.join(__dirname, '..');
const boot = require('./clientDom.js');
const PROTO = require(path.join(ROOT, 'public', 'SHARE', 'SocketSchema.js'));

let passed = 0, failed = 0;
function check(name, ok, detail) {
	if (ok) { passed++; console.log('  ok   ' + name); }
	else { failed++; console.log('  FAIL ' + name + (detail !== undefined ? '  (' + detail + ')' : '')); }
}
function near(a, b, tol) { return Math.abs(a - b) <= tol; }

// Read from config rather than restated, so retuning the send rate cannot leave this
// harness quietly measuring a rate nobody runs - which it did, at 30ms against a 33ms
// server. public/motion.js seeds its interval estimate at the same number, so a harness
// that disagrees also puts the render delay a couple of ms out for the first few seconds.
const TICK = require('../lib/config.js').config.SEND_MS;   // ms between packets
const FPP = 2;         // render frames per packet...
const FRAME = TICK / FPP;  // ...so the frame clock and the packet clock advance together.
// The stub advances its clock inside frame(); delivering a packet
// does not advance it, so packet spacing is FPP*FRAME exactly.

/*
	A GameUpdate carrying one player and, optionally, one bullet at positions we choose, so the
	test can say exactly where things should be drawn. Assembled the same way rooms/Room.js
	assembles one: entity records are encoded individually into `instances` (that is the
	per-tick cache the room keeps on each entity) and the message encoder splices them in.
*/
function packet(t, user, bullet, other) {
	const buff = {
		head: {
			timestamp: t, width: 8000, height: 8000, screen: 1920, xp: 500,
			level: 5, still: 0, cLvl: 0
		},
		main: {
			states: [0, 0, 0, 0, 0, 0], class: 'Basic', color: 0,
			x: user.x, y: user.y, vx: user.vx || 0, vy: user.vy || 0, dir: 0,
			size: 25, alpha: 1, hp: 1, name: 'tester', nameC: 0,
			recoil: new Array(15).fill(0), canDir: [0]
		},
		instances: []
	};
	if (bullet) {
		buff.instances.push(new Int8Array(PROTO.encode('Instance', {
			// states[1] is the `mine` bit - the server saying this bullet is the receiving
			// player's own, which is what puts it in the local tank's reference frame on the
			// client (public/client/entities.js, Bullet.update()).
			construc: 'Bullets', id: 7,
			// states[0] is the `pet` bit and `type` distinguishes an ordinary bullet (0) from a
			// drone/trap (>= 1) - both decide whether the bullet is dead-reckoned or interpolated
			// (public/client/entities.js, Bullet.reckonMs()). Default 0/absent = ordinary bullet,
			// which is what every test written before dead reckoning existed wants.
			states: [bullet.pet ? 1 : 0, bullet.mine ? 1 : 0, 0, 0, 0, 0, 0],
			type: bullet.type || 0, color: 0,
			x: bullet.x, y: bullet.y, size: 10, alpha: 1, dir: 0
		})));
	}
	if (other) {
		buff.instances.push(new Int8Array(PROTO.encode('Instance', {
			construc: 'Players', id: 3,
			states: [0, 0, 0, 0, 0, 0, 1], class: other.class || 'Sniper', color: 1,
			x: other.x, y: other.y, vx: 0, vy: 0, dir: 0.5,
			size: 30, alpha: 1, hp: 0.5, xp: 4000, name: other.name || 'rival', nameC: 0,
			recoil: new Array(15).fill(0), canDir: [0]
		})));
	}
	return PROTO.encode('GameUpdate', buff);
}

console.log('obstar client tests\n');

console.log('boot:');
let app;
{
	app = boot({ key: '0'.repeat(25), gm: 'ffa', name: 'tester', pet: -1, ws: '' });
	check('the client boots and starts a render loop', app.pending() > 0, app.pending());
	check('it opened a socket', !!app.socket());
	check('and installed a packet handler', typeof app.socket().onmessage === 'function');
	for (let i = 0; i < 10; i++) { app.frame(); }
	check('it renders frames before any packet arrives', app.record.badTransform === 0);
}

console.log('\nreal packets from a real room:');
{
	// Boot the actual server-side simulation and pipe its per-player view into the client.
	const controller = require(path.join(ROOT, 'lib', 'boot.js'))();
	const room = controller.newServer('ffa');
	room.ask({ name: 'tester', key: '0'.repeat(25), pet: -1, gm: 'ffa' });
	room.Init();                    // normally on a timer; run it now so the world is full
	for (let i = 0; i < 20; i++) { room.step(); }

	app.start(PROTO.encode('GameUpdate', room.getBuffer(0)));

	let fed = 0, err = null;
	for (let p = 0; p < 30 && !err; p++) {
		room.step();
		const buff = room.getBuffer(0);
		if (!buff) { continue; }
		try {
			app.deliver(PROTO.encode('GameUpdate', buff));
			fed++;
			for (let f = 0; f < FPP; f++) { app.frame(FRAME); }
		} catch (e) { err = e.message + ' | ' + e.stack.split('\n')[1]; }
	}
	check('a room\'s own GameUpdates decode and render', !err, err);
	check('fed a meaningful number of packets', fed > 15, fed);
	check('something was actually drawn', app.record.draws > 0, app.record.draws);
	check('no non-finite value reached a canvas transform',
		app.record.badTransform === 0 && app.record.badTranslate === 0,
		app.record.badTransform + ' transforms, ' + app.record.badTranslate + ' translates');
}

console.log('\nthe camera trails the tank (WP2), and aim corrects for it:');
{
	/*
		The camera used to be pinned exactly on the tank (worst === 0). It now trails by
		CONST.CAM_SMOOTH on purpose - a dead-centre camera reads as sterile, and diep.io has the
		same small chase - which is only safe because General.tankOff() lets aim (and the
		upgrade-panel UI in public/client/ui.js) correct for however far off centre the tank
		actually is. This retargets the old "camera sits exactly on the tank" assertion at the
		real camera (camx/camy): the trail must be bounded and speed-proportional, converge to
		zero once the tank stops, and the aim vector must still land on zero from dead centre
		regardless of how far the camera has trailed.
	*/
	const a = boot({ key: '0'.repeat(25), gm: 'ffa', name: 'tester', pet: -1, ws: '' });
	const hook = a.start(packet(1, { x: 0, y: 0 }));
	check('the client hands over from the connecting screen to the game loop', !!hook);
	const User = hook.User;
	const MOTION = a.sandbox.MOTION;

	let worst = 0, samples = 0;
	let x = 0;
	const SPEED = 40;                              // a fast tank: units per packet
	for (let p = 0; p < 40; p++) {
		x += SPEED;
		a.deliver(packet(p + 1, { x: x, y: 0, vx: SPEED, vy: 0 }));
		for (let f = 0; f < FPP; f++) {
			a.frame(FRAME);
			if (p < 20) { continue; }                  // let the trail reach steady state
			worst = Math.max(worst, Math.abs(User.gx - User.camx));
			samples++;
		}
	}
	check('sampled the moving tank', samples > 20, samples);

	// A first-order filter chasing a constant-velocity target settles at a steady lag of
	// (per-frame travel) / camK - the same arithmetic Loop() runs every frame.
	const dtFrames = FRAME / 16.667;
	const camK = MOTION.lerpK(hook.CONST.CAM_SMOOTH, dtFrames);
	const expected = (SPEED / FPP) / camK;
	check('the camera trails a fast tank by roughly CAM_SMOOTH\'s steady-state lag, not zero',
		near(worst, expected, expected * 0.4),
		worst.toFixed(1) + ' vs ~' + expected.toFixed(1) + ' expected');

	// Still trailing significantly here - this is the real test of tankOff(): the tank is not
	// drawn at the window centre any more, so aim has to be measured from the tank's own screen
	// position (centre plus tankOff(), not bare centre). Aim at a point a known distance
	// straight below it and the reported direction must be exactly that bearing.
	// Measured from a point REACH pixels away rather than from the tank itself: aiming *at* the
	// tank asks atan2 for the direction of a zero-length vector, so the answer is whichever way
	// the last bit of rounding fell and the check passes or fails on luck. An error of e window
	// pixels in the offset tilts this bearing by about e/REACH radians instead, which is a real
	// measurement - the tolerance below is a fifth of a pixel's worth.
	// General.tankOff() is computed inside User.update() before camx/gx are advanced for the
	// frame, from the same values read here, so this is exact rather than off by one frame.
	const REACH = 200;
	check('aim is measured from the tank\'s own screen position, not the window centre', (function () {
		const G = hook.Global;
		G.mouse_x = G.winW / 2 + (User.gx - User.camx) * G.RATIO / hook.CONST.RESOLUTION;
		G.mouse_y = G.winH / 2 + (User.gy - User.camy) * G.RATIO / hook.CONST.RESOLUTION + REACH;
		a.frame(FRAME);
		return near(User.dir, Math.PI / 2, 1e-3);
	})(), User.dir);
	// ...and it would not: at this speed the camera is trailing far enough that ignoring the
	// offset would visibly tilt the same shot.
	check('...which is a correction big enough to matter', (function () {
		const G = hook.Global;
		const off = (User.gx - User.camx) * G.RATIO / hook.CONST.RESOLUTION;
		return Math.abs(Math.atan2(REACH, -off) - Math.PI / 2) > 0.05;
	})(), ((User.gx - User.camx) * hook.Global.RATIO / hook.CONST.RESOLUTION).toFixed(1) + ' px');

	// Stop the tank and let the camera catch back up.
	for (let p = 40; p < 70; p++) {
		a.deliver(packet(p + 1, { x: x, y: 0, vx: 0, vy: 0 }));
		for (let f = 0; f < FPP; f++) { a.frame(FRAME); }
	}
	const settled = Math.abs(User.gx - User.camx);
	check('...and converges back to zero once the tank stops',
		settled < 1, settled.toFixed(4) + ' units off');
}

console.log('\na bullet moves at its real speed from the start:');
{
	/*
		THE BUG a player reported. With the old smoother a bullet was drawn accelerating from a
		standstill over roughly half a second before it reached the speed the server had already
		given it. Here the bullet's drawn position is read frame by frame and compared against
		the speed the packets describe.
	*/
	const a = boot({ key: '0'.repeat(25), gm: 'ffa', name: 'tester', pet: -1, ws: '' });
	const Instances = a.start(packet(1, { x: 0, y: 0 })).Instances;

	const SPEED = 36;                            // units per packet - a fast bullet
	let bx = 0, drawn = [];
	for (let p = 0; p < 14; p++) {
		a.deliver(packet(p + 1, { x: 0, y: 0 }, { x: bx, y: 0 }));
		for (let f = 0; f < FPP; f++) {
			a.frame(FRAME);
			const b = Instances.Bullets[7];
			if (b) { drawn.push({ p: p, x: b.dx }); }
		}
		bx += SPEED;
	}
	check('the bullet exists on the client', drawn.length > 0, drawn.length + ' samples');

	const perFrame = SPEED / FPP;
	function speedDuring(p) {
		const f = drawn.filter((d) => d.p === p);
		return f.length > 1 ? (f[f.length - 1].x - f[0].x) / (f.length - 1) : 0;
	}
	// Packet 0 is the spawn - one snapshot, nothing to interpolate between, so it holds still
	// for one interval. From packet 2 on it must be at full speed and stay there.
	check('drawn at full speed from the second interval on',
		near(speedDuring(2), perFrame, perFrame * 0.05),
		speedDuring(2).toFixed(2) + ' vs ' + perFrame.toFixed(2) + ' per frame');
	check('...and does not keep accelerating afterwards',
		[4, 7, 10, 13].every((p) => near(speedDuring(p), perFrame, perFrame * 0.05)),
		[4, 7, 10, 13].map((p) => speedDuring(p).toFixed(2)).join(' '));
	check('the spin-up is over within one interval of spawning',
		speedDuring(2) > speedDuring(0),
		speedDuring(0).toFixed(2) + ' -> ' + speedDuring(2).toFixed(2));
	let backwards = 0;
	for (let i = 1; i < drawn.length; i++) {
		if (drawn[i].x < drawn[i - 1].x - 1e-9) { backwards++; }
	}
	check('the bullet never stutters backwards', backwards === 0, backwards + ' frames');
}

console.log('\nyour own bullet leaves the muzzle, even strafing across your own aim:');
{
	/*
		THE OTHER BUG a player reported, and the one this file could not see before: firing while
		moving hard sideways, the bullet appeared to come out of empty space beside the tank
		rather than out of the barrel.

		The server spawns a bullet at the *server's* tank position plus the barrel offset. The
		client draws the tank somewhere else - that same server position plus `predic`, the local
		input lead - so a bullet is born `predic` away from the muzzle it is supposed to have come
		out of. It used to be papered over by drawing own bullets one packet interval further into
		the future, which can only ever slide a bullet along its own velocity; strafing puts the
		entire error perpendicular to that, so none of it was cancelled.

		Set up exactly that: the tank strafing along +x under real held input, firing along +y.
		The bullet is placed where the server would put it - the tank's server position plus a
		barrel length in +y - and what is asserted is that it is *drawn* on the drawn tank's
		muzzle, which is the only place a player can see.
	*/
	const a = boot({ key: '0'.repeat(25), gm: 'ffa', name: 'tester', pet: -1, ws: '' });
	const hook = a.start(packet(1, { x: 0, y: 0 }));
	const User = hook.User, Global = hook.Global, Insts = hook.Instances;

	const SPEED = 40;      // tank travel per packet, sideways
	const BARREL = 55;     // muzzle offset, perpendicular to the movement
	const BSPEED = 36;     // bullet travel per packet, also perpendicular
	Global.inputs.d = 1;   // hold "right" so predic is real input lead, not a fabricated number

	let x = 0;
	for (let p = 0; p < 20; p++) {          // let predic reach steady state
		x += SPEED;
		a.deliver(packet(p + 1, { x: x, y: 0, vx: SPEED, vy: 0 }));
		for (let f = 0; f < FPP; f++) { a.frame(FRAME); }
	}
	const lead = Math.hypot(User.predic.x, User.predic.y);
	/*
		The lead is DERIVED now (PENDING #24a): (render delay + RTT/2) x the tank's own predicted
		speed, where it used to be whatever the integrator settled on under a flat CONST.SIZE*2
		ceiling that never bound. Two things make the honest number here ~4.5 units rather than the
		~12 that ceiling used to allow: the stub socket never echoes a probe, so NET.rtt is 0 and
		the delay is the render interval alone; and 20 packets is under one time constant of the
		velocity integrator, so this tank is still accelerating and is genuinely owed less lead
		than a tank at top speed.

		So this asserts the derivation is what is in force, rather than a magic number that only
		described the old uncapped behaviour - a strictly tighter check than `lead > 10` was.
	*/
	const M = a.sandbox.MOTION;
	const derived = M.NET.leadMs() * Math.hypot(User.predic.vx, User.predic.vy) / M.REF_TICK;
	check('the tank has a real input lead to be wrong about',
		lead > 3 && near(lead, derived, 0.05),
		lead.toFixed(1) + ' units, derived ' + derived.toFixed(1));
	check('...and it is the sideways one, across the aim',
		Math.abs(User.predic.x) > Math.abs(User.predic.y) * 10,
		User.predic.x.toFixed(1) + ', ' + User.predic.y.toFixed(1));

	// The shot. Server tank position is (x + SPEED, 0); the muzzle is BARREL up from it.
	x += SPEED;
	a.deliver(packet(21, { x: x, y: 0, vx: SPEED, vy: 0 }, { x: x, y: BARREL, mine: 1 }));
	a.frame(FRAME);
	const b = Insts.Bullets[7];
	check('the bullet exists on the client', !!b);

	// Through the whole first interval the bullet has one snapshot, so its own interpolation
	// cannot move it yet; it rides the muzzle instead of parking in world space. Exact, not
	// approximate - it is drawn from the same two terms the tank is.
	let worst = 0, apart = 0;
	for (let f = 0; ; f++) {
		worst = Math.max(worst, Math.hypot(b.dx - User.gx, b.dy - User.gy - BARREL));
		// How far that is from where the old code drew it - the raw server spawn point. This is
		// the size of the reported bug, and it has to be big enough that the check above means
		// something rather than passing on two numbers that were equal anyway.
		apart = Math.max(apart, Math.hypot(b.dx - b.x, b.dy - b.y));
		if (f >= FPP - 1) { break; }
		a.frame(FRAME);
	}
	check('it is drawn on the muzzle for as long as it is still in the barrel',
		worst < 1e-6, worst.toExponential(1) + ' units off');
	check('...which is a visibly different place from the raw server spawn point',
		apart > 10, apart.toFixed(1) + ' units apart - the size of the bug');

	// Now the shot proper. The bullet flies +y only: it does not inherit the tank's sideways
	// velocity (neither does diep's, nor arras.io's - see the extraBoost in its gun.js, which
	// projects onto the firing direction and clamps at zero), so the tank strafes out from
	// under it and the two separate. What must not happen is a jump when the bullet's own
	// interpolation takes over from the muzzle ride on the second snapshot.
	// The offset it is holding as it leaves - the whole of the error being corrected. Read it
	// here, before the decay has had any frames to work on it.
	const held = Math.hypot(b.lead.x, b.lead.y);
	const step = [];
	let px = b.dx, py = b.dy;
	for (let p = 21; p < 27; p++) {
		x += SPEED;
		a.deliver(packet(p + 1, { x: x, y: 0, vx: SPEED, vy: 0 },
			{ x: x - SPEED * (p - 20), y: BARREL + BSPEED * (p - 20), mine: 1 }));
		for (let f = 0; f < FPP; f++) {
			a.frame(FRAME);
			step.push(Math.hypot(b.dx - px, b.dy - py));
			px = b.dx; py = b.dy;
		}
	}
	// Steady drawn travel is one bullet-speed per packet spread over FPP frames; the handoff
	// frame must not be an outlier against it.
	const per = BSPEED / FPP;
	check('there is no jump where its own interpolation takes over',
		step.every((s) => s < per * 1.5), Math.max.apply(null, step).toFixed(1) +
		' worst frame vs ' + per.toFixed(1) + ' steady');
	check('...and it is moving at its real speed by then',
		near(step[step.length - 1], per, per * 0.15), step[step.length - 1].toFixed(1));

	// And it lets go: the offset bleeds away so the bullet flies the path the server will
	// actually judge it on, rather than carrying the lead forever.
	for (let p = 27; p < 60; p++) {
		x += SPEED;
		a.deliver(packet(p + 1, { x: x, y: 0, vx: SPEED, vy: 0 },
			{ x: x - SPEED * (p - 20), y: BARREL + BSPEED * (p - 20), mine: 1 }));
		for (let f = 0; f < FPP; f++) { a.frame(FRAME); }
	}
	const now = Math.hypot(b.lead.x, b.lead.y);
	// `held` is the muzzle offset the bullet was born with, i.e. the tank's lead at the instant it
	// fired - so it tracks the derived cap above and is ~4.7 here, not the old ~12.
	check('the offset decays instead of riding along forever',
		held > 3 && now < held * 0.2, held.toFixed(1) + ' -> ' + now.toFixed(1) + ' units');

	// The other half of PENDING #24(b): once the weld offset is mostly gone, an own bullet's
	// dead-reckon lead (ramped in on the same clock, in the opposite direction - see
	// reckonMs()/reckonRamp) should have closed most of the way to what any other bullet gets.
	// This is what "closing the gap" actually means, not just "no jump getting there".
	const full = Math.min(M.NET.leadMs(), M.NET.interval * hook.CONST.DEAD_RECKON_MAX_INTERVALS);
	check('...and by then its own dead-reckon lead has ramped up to about what any other bullet gets',
		near(b.reckonMs(), full, full * 0.05),
		b.reckonMs().toFixed(1) + 'ms vs ' + full.toFixed(1) + 'ms');

	Global.inputs.d = 0;
}

console.log('\ninput prediction reaches the same steady-state lead at any frame rate:');
{
	/*
		THE BUG PENDING #24 measured: game.js used to scale its per-tick accel by tickLen once
		instead of tickLen^2, so the steady-state `predic` lead grew with the frame rate instead
		of staying put - 24 units at 30fps, 54 at 60, 70 (capped) at 144, all chasing the same
		server truth (284 u/s when this was measured; 362.25 since plan.md step 2 took the tank
		magnitudes to diep's - the bug and this test are both about the frame-rate dependence, not
		about the speed). That is a ~3x runaway that saturates at CONST.SIZE*2.

		public/SHARE/Physics.js's stepBody fixes the dimension, but a large per-frame `dtTicks`
		(30fps takes one whole reference tick in a single Euler step) vs a small one (144fps takes
		~0.2 of a tick, four times finer) still do not integrate to bit-identical answers - that is
		ordinary step-size discretization error, bounded and independent of frame rate once you're
		past a couple of time constants (the tank FRICTION's time constant is ~17 real ticks at
		10/11, where it was ~36 at 0.956532 - heavier drag settles the transient FASTER, so this
		assertion got more headroom, not less), not the old
		unbounded, cap-hitting divergence. Measured empirically at ~15% end to end across 30-144fps
		once settled; the assertion below is deliberately looser than that measurement so it fails
		on a regression of the old bug's magnitude (~3x), not on this residual.
	*/
	function steadyLead(frameMs) {
		const a = boot({ key: '0'.repeat(25), gm: 'ffa', name: 'tester', pet: -1, ws: '' });
		const hook = a.start(packet(1, { x: 0, y: 0 }));
		hook.Global.inputs.d = 1;
		const WALLCLOCK = 6000;                    // ms, the same at every frame rate
		for (let t = 0; t < WALLCLOCK; t += frameMs) { a.frame(frameMs); }
		return Math.hypot(hook.User.predic.x, hook.User.predic.y);
	}

	const lead30 = steadyLead(1000 / 30);
	const lead60 = steadyLead(1000 / 60);
	const lead144 = steadyLead(1000 / 144);
	check('steady-state lead at 30fps and 60fps agree within discretization noise',
		near(lead30, lead60, lead30 * 0.25),
		lead30.toFixed(2) + ' vs ' + lead60.toFixed(2));
	check('steady-state lead at 60fps and 144fps agree within discretization noise',
		near(lead60, lead144, lead60 * 0.25),
		lead60.toFixed(2) + ' vs ' + lead144.toFixed(2));
	check('...and 30fps vs 144fps never reaches the old bug\'s ~3x magnitude',
		lead144 < lead30 * 1.5,
		lead30.toFixed(2) + ' vs ' + lead144.toFixed(2));
	check('...and it is a real, non-zero lead, not three coincidental zeroes',
		lead30 > 5, lead30.toFixed(2));
}

console.log('\na new entity is complete on the packet that introduces it:');
{
	/*
		Creating an entity used to be an `else` against the block that applies a packet's fields,
		so on its first packet an entity got only its four constructor arguments. That was
		survivable only because SetPacket had a second bug - it iterated the whole instance list
		three times per packet, and passes two and three found the entity already there and
		filled it in. Fixing the wasteful loop made the incomplete-entity bug reachable: a tank
		spent a packet interval holding the constructor's placeholder class, which is not a class
		TanksConfig knows, so drawTank returned undefined and Tank.draw threw on it - taking the
		whole render loop down, from one entity appearing.
	*/
	const a = boot({ key: '0'.repeat(25), gm: 'ffa', name: 'tester', pet: -1, ws: '' });
	const hook = a.start(packet(1, { x: 0, y: 0 }));
	const TC = a.sandbox.TanksConfig;
	const Insts = hook.Instances;

	let err = null;
	try {
		a.deliver(packet(2, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 50, class: 'Sniper', name: 'rival' }));
		a.frame(FRAME);
	} catch (e) { err = e.message; }
	check('the frame a tank first appears on renders', !err, err);

	const tank = Insts.Players[3];
	check('the new tank exists', !!tank);
	check('it has a class TanksConfig knows, immediately',
		tank && TC.list.indexOf(tank.class) >= 0, tank && tank.class);
	check('...the one the packet said', tank && tank.class === 'Sniper', tank && tank.class);
	// hp rides the wire as a uint8 fraction, so it comes back quantised, not exact.
	check('and the rest of its state, not just x/y/size/color',
		tank && tank.name === 'rival' && near(tank.hp, 0.5, 1 / 255) && tank.bot === 1,
		tank && [tank.name, tank.hp, tank.bot].join('/'));
	check('nothing non-finite reached the canvas', a.record.badTranslate === 0,
		a.record.badTranslate);
}

console.log('\nan incoming bullet is dead-reckoned, a drone is not (PENDING #24b):');
{
	/*
		THE REMAINING HALF of PENDING #24. Every entity is drawn one packet interval in the past,
		which for an incoming bullet means it damages you before it visually arrives - an enemy
		Destroyer shot lands ~12 units before its picture does. A non-drone bullet is the one
		entity where that delay buys nothing, because its motion is deterministic between
		collisions, so the client can integrate it forward instead of waiting for the next packet.

		The measurement below is deliberately a COMPARISON rather than an absolute: the same flight,
		flown twice, once as an ordinary bullet (type 0, dead-reckoned) and once as a drone (type 1,
		which steers and must stay interpolated). The gap between the two IS the delay being
		cancelled, so this cannot pass by both numbers happening to be equal, and it does not depend
		on the harness's fake clock landing on any particular phase.

		The stub socket never echoes a ping probe, so NET.rtt is 0 here and leadMs is the render
		interval alone. That is the conservative half of the lead; a real connection also cancels
		rtt/2 on top.
	*/
	const SPEED = 36;   // bullet travel per packet

	// Fly one bullet of the given wire `type` and report, at a fixed phase of the packet cycle,
	// how far its DRAWN position sits ahead of the newest raw server position it was given.
	function flight(type) {
		const a = boot({ key: '0'.repeat(25), gm: 'ffa', name: 'tester', pet: -1, ws: '' });
		const Insts = a.start(packet(1, { x: 0, y: 0 })).Instances;
		let bx = 0, ahead = 0, perFrame = [];
		for (let p = 0; p < 14; p++) {
			a.deliver(packet(p + 1, { x: 0, y: 0 }, { x: bx, y: 0, type: type }));
			const before = Insts.Bullets[7] ? Insts.Bullets[7].dx : 0;
			a.frame(FRAME);
			const b = Insts.Bullets[7];
			// Always read one frame after a packet, so both flights are sampled at the same point
			// in the cycle and the comparison is of leads, not of phases.
			if (b && p > 3) {
				ahead = b.dx - b.x;
				perFrame.push(b.dx - before);
			}
			a.frame(FRAME);
			bx += SPEED;
		}
		return { ahead: ahead, perFrame: perFrame, motion: a.sandbox.MOTION };
	}

	const bullet = flight(0);
	const drone = flight(1);

	check('a drone is still drawn behind the server, as interpolation intends',
		drone.ahead < 0, drone.ahead.toFixed(1) + ' units');
	check('...while an ordinary bullet is not drawn behind any more',
		bullet.ahead > drone.ahead, bullet.ahead.toFixed(1) + ' vs ' + drone.ahead.toFixed(1));
	// The gap is the render delay being cancelled: one leadMs of the bullet's own travel. With
	// rtt 0 that is one interval, i.e. one packet's worth of flight.
	{
		const gap = bullet.ahead - drone.ahead;
		const M = bullet.motion;
		const expect = SPEED * M.NET.leadMs() / M.NET.interval;
		check('...by exactly the delay it is cancelling - leadMs of its own travel',
			near(gap, expect, expect * 0.1),
			gap.toFixed(1) + ' units, expected ' + expect.toFixed(1));
		check('...which is a lead big enough to be the reported bug, not rounding',
			gap > 10, gap.toFixed(1) + ' units');
	}
	// Cancelling the delay must not change the drawn SPEED - a lead is a constant offset along
	// the path, so if this drifted the bullet would be running fast and overshoot its own target.
	{
		const per = SPEED / FPP;
		const worst = bullet.perFrame.reduce((m, s) => Math.max(m, Math.abs(s - per)), 0);
		check('...and it still flies at its real speed, not faster',
			worst < per * 0.15, 'worst frame off by ' + worst.toFixed(2) + ' of ' + per.toFixed(2));
	}

	/*
		The ceiling. NET.leadMs() is measured, so a pathological RTT (a stalled tab, a hostile
		server) would otherwise fling a bullet arbitrarily far downrange. reckonMs() caps it at
		CONST.DEAD_RECKON_MAX_INTERVALS packet intervals - checked by driving the EMA somewhere
		absurd rather than by re-reading the constant.
	*/
	{
		const a = boot({ key: '0'.repeat(25), gm: 'ffa', name: 'tester', pet: -1, ws: '' });
		const hook = a.start(packet(1, { x: 0, y: 0 }));
		const Insts = hook.Instances;
		const M = a.sandbox.MOTION, C = hook.CONST;
		let bx = 0;
		for (let p = 0; p < 6; p++) {
			a.deliver(packet(p + 1, { x: 0, y: 0 }, { x: bx, y: 0 }));
			for (let f = 0; f < FPP; f++) { a.frame(FRAME); }
			bx += SPEED;
		}
		const b = Insts.Bullets[7];
		const sane = b.reckonMs();
		M.NET.rtt = 100000;   // far past anything echo() would ever admit
		const capped = b.reckonMs();
		check('a pathological RTT cannot fling a bullet arbitrarily far',
			capped === M.NET.interval * C.DEAD_RECKON_MAX_INTERVALS,
			capped.toFixed(1) + 'ms vs cap ' + (M.NET.interval * C.DEAD_RECKON_MAX_INTERVALS).toFixed(1));
		check('...and the cap is a ceiling, not the everyday value',
			sane < capped, sane.toFixed(1) + 'ms normally');
		M.NET.rtt = 0;
	}

	// One permanent exclusion and one that is a starting condition, not an exclusion, asserted
	// through the real predicate rather than by re-stating its condition. A pet chases its owner,
	// so it is excluded outright; an own bullet's lead is ramped rather than excluded (see the
	// "your own bullet leaves the muzzle" block above for the ramp itself), and here it is still
	// at 0 simply because reckonRamp was never advanced for it - it never went through update()
	// as a `mine` bullet.
	{
		const a = boot({ key: '0'.repeat(25), gm: 'ffa', name: 'tester', pet: -1, ws: '' });
		const Insts = a.start(packet(1, { x: 0, y: 0 })).Instances;
		for (let p = 0; p < 4; p++) {
			a.deliver(packet(p + 1, { x: 0, y: 0 }, { x: p * SPEED, y: 0 }));
			for (let f = 0; f < FPP; f++) { a.frame(FRAME); }
		}
		const b = Insts.Bullets[7];
		check('an ordinary enemy bullet is the thing being dead-reckoned', b.reckonMs() > 0,
			b.reckonMs().toFixed(1) + 'ms');
		b.pet = 1;
		check('...a pet is not - it chases its owner, so its velocity is a control output',
			b.reckonMs() === 0);
		b.pet = 0;
		b.mine = 1;
		check('...and a freshly-welded own bullet is not yet, since its ramp has not started',
			b.reckonMs() === 0);
	}
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
