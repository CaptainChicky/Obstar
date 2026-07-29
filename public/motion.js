/*
	Client-side motion: how a position that arrives ~33 times a second is drawn ~60-144 times
	a second.

	///////////////////////////////////////////////////////////////////////////////////////
	What this replaces.

	Every moving thing in the client used to be smoothed with one line per axis, run
	once per animation frame:

			this.dx += (this.x-this.dx)*CONST.SMOOTH;      // CONST.SMOOTH is 0.15

	an exponential filter chasing whatever the server last said. Two things are wrong with
	that, and players saw both:

		1. THE STARTUP TRANSIENT. `dx` starts at the spawn position and chases a target that is
			 *already moving*. An exponential filter needs roughly 1/0.15 ~ 7 frames to reach a
			 useful fraction of the target's speed and ~30 to match it, so a bullet leaves the
			 barrel almost stationary and accelerates to full speed over about half a second
			 before it looks right. That is the "bullets lag for a bit when you shoot" - the
			 bullet is not waiting on the network, it is waiting on this filter to spin up.
			 Anything spawned in motion had it; bullets are simply the fastest thing in the game,
			 so they showed it worst.

		2. THE STEADY-STATE OFFSET. Once spun up, the filter still trails the true position by a
			 fixed fraction of a frame's travel, forever, and the size of that trail is
			 proportional to speed. Different entities trailed by different amounts, so nothing
			 lined up - and the player's own tank, camera and aim vector each ran a *different*
			 filter over the same position, which is what made the view slide off centre while
			 moving.

	Both are the same mistake: smoothing *towards* a moving target instead of replaying where
	the target has already been.

	///////////////////////////////////////////////////////////////////////////////////////
	What it does instead: snapshot interpolation.

	Keep the last few server positions with the time each was actually simulated at (NET.mark()
	reconstructs that from the room step counter on the wire - see there), and draw the entity
	where it was one packet-interval ago, linearly between the two that straddle that instant:

			render(t) = lerp(before, after, (t - interval - t_before) / (t_after - t_before))

	Constant velocity comes out exactly right from the first frame after the second snapshot,
	with no spin-up and no speed-dependent offset. The price is one packet interval (~33ms) of
	deliberate, *constant* latency, which is precisely what buys the smoothness: there is
	always a known-good position on both sides of the instant being drawn, so nothing has to
	be guessed.

	Two things make that "always" true rather than nearly true, and both are load-bearing -
	together they are the difference between this and visible rubber-banding at speed. One is
	stamping snapshots with when they were simulated instead of when they landed (NET.mark).
	The other is keeping more than two of them (HISTORY), so the instant being drawn never
	falls off the old end of the history and clamps there.

	`interval` is measured, not assumed. net/gameSocket.js aims at 30ms, but that is a timer,
	not a guarantee, and what matters here is the spacing the packets actually arrive with.

	///////////////////////////////////////////////////////////////////////////////////////
	Loaded by views/play.ejs before public/client/, and required directly by test/interp.js -
	same typeof(exports) sniff as public/SHARE/SocketSchema.js.
*/
(function (exp) {
	// Only the seed for the interval EMA - mark() measures the real spacing within a few
	// packets, so this value decides how long the first moments after connecting look wrong,
	// not the steady state. Keep it equal to config.SEND_MS (33) so that transient is nil.
	const NET_TICK = 33;    // what net/gameSocket.js aims for between GameUpdate packets
	const TELEPORT = 400;   // a jump this big is not motion; see push()
	const MAX_EXTRAP = 2;   // how far past the newest snapshot sample() will coast

	/*
		The step clock (see NET.mark).

		STEP_GAIN is how hard the reconstructed clock is pulled back toward real arrival times
		each packet. The rate is already pinned by the measurement in mark(), so this only has a
		constant offset to trim and can be tiny: at 0.02 a packet, the arrival jitter that
		survives into the drawn position is 2% of itself. STEP_RESYNC is the disagreement that
		means "this is a stall or a reconnect, not jitter" - a backgrounded tab, a long GC pause -
		where easing would take minutes. STEP_MAX_GAP is the same judgement made on the step
		counter instead of the clock.
	*/
	const STEP_GAIN = 0.02;
	const STEP_RESYNC = 250;
	const STEP_MAX_GAP = 40;   // steps (~1s) in one packet gap: a stall, not motion

	/*
		How many server positions each entity keeps.

		Two is the textbook answer and it is one short. We draw one packet interval (~33ms)
		behind the newest snapshot, but a snapshot only reaches back as far as the packet's own
		world content - one server step, 25ms, at the narrowest - so with a pair the read point
		falls off the older end for part of every packet cycle and clamps there. A clamp is a
		freeze, and the catch-up after it is a lurch: at walking speed that is invisible, at
		sprint speed against the background grid it is exactly the rubber-banding players see.
		Three gaps is ~100ms of history against a ~33ms delay, so the read point stays strictly
		inside it with room to spare for a late packet.
	*/
	const HISTORY = 4;

	// The reference tick every server-side gameplay constant is denominated against
	// (config.REF_TICK_MS) - 40ms, diep.io's own loop rate. This is
	// deliberately not NET_TICK/SEND_MS above (the send interval, 33ms, only coincidentally
	// close): public/client/game.js's input-prediction frame->tick conversion has to agree with
	// what public/SHARE/Physics.js's per-tick constants are actually denominated in, or
	// prediction drifts from what the server does. The browser cannot see lib/config.js, so this
	// is a constant of the balance, not a deployment knob - if server and reference tick ever
	// need to diverge at runtime, inject this through POST in views/play.ejs instead.
	const REF_TICK = 40;

	/*
		Round-trip time (PENDING #24a).

		RTT_GAIN is per probe, and probes go out once a second (public/client/game.js), so 0.2 is
		a ~5s time constant - slow enough that one bad sample cannot move the prediction lead
		visibly, fast enough to follow a genuine route change within a few seconds. RTT_MAX is the
		"this was not a round trip" cut: a backgrounded tab parks the echo in a queue and reports
		seconds, and folding that in would inflate the lead for the next half minute.

		Seeded at 0 rather than at a guess: until the first echo lands the lead falls back to
		interval alone, which is an under-estimate, and an under-estimated lead is a smaller lie
		than an over-estimated one.
	*/
	const RTT_GAIN = 0.2;
	const RTT_MAX = 2000;

	const NET = {
		interval: NET_TICK,   // EMA of the gap between GameUpdate packets, ms
		rtt: 0,           // EMA of the measured round trip, ms; 0 until the first echo
		probeAt: 0,       // when the outstanding probe went out, 0 if none - see probe()/echo()
		last: 0,          // when the most recent one arrived
		stepMs: 0,        // wall-clock length of one server step, ms (0 until measured)
		stamp: -1,        // the step counter of the most recent snapshot
		clock: 0,         // the local-clock time that step counter maps to - see mark()
		baseT: 0,         // arrival time and step counter of the packet the step length is
		baseStamp: 0,     // ...measured against; the far end of a baseline that only grows
		now: (typeof performance !== 'undefined' && performance.now)
			? function () { return performance.now(); }
			: function () { return Date.now(); },
		/*
			Called once per GameUpdate, before the packet is applied. Returns the time to
			timestamp that snapshot with - which is NOT when it landed.

			WHEN A SNAPSHOT ARRIVES IS NOT WHEN IT HAPPENED. The simulation steps every
			config.TICK_MS (25ms) and the send loop fires every config.SEND_MS (33ms), on its own
			timer, so consecutive packets carry 1 or 2 whole steps of motion - 25, 25, 25, 50, 25,
			25, 50 ms of world - while arriving an even 33ms apart. Timestamping each one with its
			arrival makes the interpolator draw 50ms of travel across a 33ms window and 25ms of it
			across the next: the drawn speed alternates between 0.76x and 1.52x the real one at
			~10Hz. Against a static background grid that reads as rubber-banding, and it scales
			with speed, so it is invisible when you walk and obvious when you sprint. Network
			jitter adds to it directly, on top.

			The room's step counter is already on the wire (head.timestamp), so the exact
			simulated time of a snapshot is knowable: advance a local clock by exactly the number
			of steps the packet actually covers, which puts the snapshots back where the world
			really was. That clock would sit at whatever offset the first packet happened to land
			at, so it is eased back toward real arrival times at STEP_GAIN - a phase lock, not a
			resync: arrival jitter is divided by 50, a genuine offset is still trimmed out.

			Fixing the timestamps is half the job; the other half is Interp keeping enough of them
			(HISTORY) that the instant being drawn is always straddled by two.

			`stamp` is optional. Without it this is the old arrival-time behaviour, which is what
			test/interp.js's direct Interp tests and any non-GameUpdate caller want.
		*/
		mark: function (t, stamp) {
			if (typeof t === 'undefined') { t = NET.now(); }
			const prev = NET.last;
			if (prev) {
				const dt = t - prev;
				// A backgrounded tab or a stall produces gaps of seconds. Letting one into the
				// average would make every entity on screen crawl for the next minute.
				//
				// Slowly (0.02), because this is the render delay, not a live measurement of the
				// last packet: what it wants is the send loop's period, which is a fixed server
				// setting, and every wobble it picks up off the network instead moves the point
				// being drawn. At 0.02 a packet, arrival jitter reaching the screen is 2% of
				// itself; the seed is already the right answer, so there is nothing to converge to.
				if (dt > 4 && dt < 250) {
					NET.interval += (dt - NET.interval) * 0.02;
				}
			}
			NET.last = t;
			if (typeof stamp !== 'number' || !isFinite(stamp)) { return t; }
			const steps = stamp - NET.stamp;
			if (NET.stamp < 0 || steps <= 0 || steps > STEP_MAX_GAP) {
				// First packet of the connection, or a gap too big to be motion. Start the clock
				// here rather than easing across something that is not world travel.
				NET.baseT = t;
				NET.baseStamp = stamp;
				NET.stamp = stamp;
				NET.clock = t;
				return t;
			}
			/*
				One step's wall-clock length, measured over the whole connection rather than
				smoothed packet to packet. A per-packet (arrival gap / steps) ratio is 33 or 16.5
				depending only on whether that packet happened to carry one step or two, so any
				average of it needs a long, laggy window to settle. This is exact in the mean by
				the fourth packet and only gets steadier after that, because the arrival jitter on
				the two endpoints is divided by a baseline that grows without bound - which also
				means it ends up tracking genuine skew between the two machines' clocks for free.
			*/
			const baseline = stamp - NET.baseStamp;
			if (baseline > 0) { NET.stepMs = (t - NET.baseT) / baseline; }
			let at = NET.clock + steps * NET.stepMs;
			at = (Math.abs(t - at) > STEP_RESYNC) ? t : at + (t - at) * STEP_GAIN;
			NET.stamp = stamp;
			NET.clock = at;
			return at;
		},
		/*
			A probe is going out now. Stamping it here rather than keeping a queue is deliberate:
			one probe is outstanding at a time and they are a second apart, so the only way this
			overwrites a live stamp is an echo that took longer than the probe interval - which
			RTT_MAX would have thrown away anyway.
		*/
		probe: function (t) {
			NET.probeAt = (typeof t === 'undefined') ? NET.now() : t;
		},
		/* The echo came back. Returns the raw sample, or 0 if there was nothing to time. */
		echo: function (t) {
			if (!NET.probeAt) { return 0; }
			if (typeof t === 'undefined') { t = NET.now(); }
			const ms = t - NET.probeAt;
			NET.probeAt = 0;
			if (!(ms >= 0) || ms > RTT_MAX) { return 0; }
			NET.rtt = NET.rtt ? NET.rtt + (ms - NET.rtt) * RTT_GAIN : ms;
			return ms;
		},
		/*
			How far ahead of the newest snapshot the local tank has to be drawn to sit where the
			server already has it, in ms of its own travel.

			Two pieces, both measured rather than tuned - which is the whole point of the probe
			byte. `interval` is the render delay Interp.sample() deliberately holds (it draws one
			packet interval in the past); `rtt/2` is how stale the newest snapshot already was when
			it arrived. Multiply by the tank's speed and that is the lead in world units - about 20
			at a base tank's 362.25 u/s on a 50ms RTT. It was ~16 at the 284 u/s this game ran at
			before plan.md step 2 adopted diep's tank magnitudes; the lead is proportional to speed,
			so it tracked the change by itself - which is the whole point of deriving it rather than
			tuning it. public/client/config.js's CONST.SIZE*2 cap it replaces was a flat 70
			regardless of speed, latency or packet rate.
		*/
		leadMs: function () {
			return NET.interval + NET.rtt / 2;
		},
		reset: function () {
			NET.interval = NET_TICK;
			NET.rtt = 0;
			NET.probeAt = 0;
			NET.last = 0;
			NET.stepMs = 0;
			NET.stamp = -1;
			NET.clock = 0;
			NET.baseT = 0;
			NET.baseStamp = 0;
		}
	};

	/*
		Per-entity position history: the last HISTORY server positions and the time each was
		simulated at, in a ring. The owner's `x`/`y` stay exactly what they were - the raw server
		value, assigned straight out of the packet - so nothing else has to change. This only
		supplies `dx`/`dy`, the position actually drawn.
	*/
	class Interp {
		constructor(x, y) {
			this.ts = new Float64Array(HISTORY);
			this.xs = new Float64Array(HISTORY);
			this.ys = new Float64Array(HISTORY);
			this.set(x, y);
		}
		/* Teleport: forget the history. */
		set(x, y) {
			this.head = 0;   // ring slot of the newest entry
			this.len = 0;    // entries written, capped at HISTORY
			// Seeded into the slot push() compares against, so a first packet that lands far from
			// where the entity was constructed is treated as the teleport it is.
			this.ts[0] = 0; this.xs[0] = x; this.ys[0] = y;
			this.x = x; this.y = y;
			// How many real server positions this history holds. Below 2 there is nothing to
			// interpolate between and sample() parks on the spawn point for one interval -
			// public/client/entities.js's Bullet.update() has to know which of those two regimes
			// it is in to keep a bullet on the muzzle, and nothing else about the interpolator
			// tells it apart from a genuinely stationary entity.
			this.n = 0;
		}
		/* Ring slot of the k-th newest entry; k = 0 is the newest. */
		slot(k) {
			return (this.head - k + HISTORY) % HISTORY;
		}
		/* Append one entry, dropping the oldest once the ring is full. */
		write(t, x, y) {
			this.head = (this.head + 1) % HISTORY;
			this.ts[this.head] = t; this.xs[this.head] = x; this.ys[this.head] = y;
			if (this.len < HISTORY) { this.len++; }
		}
		/* One new server position. */
		push(x, y, t) {
			// Nothing in the game covers this much ground in one packet - the fastest bullet does
			// about 40 units a tick. A jump this size is a respawn, or an entity id being reused
			// for a different entity (slots are recycled, and an
			// index can mean a different entity between frames). Lerping through it draws a streak
			// across the map, so cut instead.
			if (Math.abs(x - this.xs[this.head]) > TELEPORT || Math.abs(y - this.ys[this.head]) > TELEPORT) {
				this.set(x, y);
				this.write(t, x, y);
				this.n = 1;
				return this;
			}
			// First ever packet: invent a previous entry one interval back, at the same place, so
			// the entity holds still for one interval instead of jumping.
			if (!this.len) { this.write(t - NET.interval, this.xs[this.head], this.ys[this.head]); }
			this.write(t, x, y);
			this.n++;
			return this;
		}
		/*
			Where to draw it now. Writes and returns this.x / this.y. `lead` (ms) draws further
			forward than `t` alone would; the extrapolation cap is raised by the same amount so a
			lead can't be eaten by MAX_EXTRAP.
		*/
		sample(t, lead = 0) {
			if (typeof t === 'undefined') { t = NET.now(); }
			if (this.len < 2) {
				this.x = this.xs[this.head];
				this.y = this.ys[this.head];
				return this;
			}
			// The instant being drawn, on the same clock the entries are stamped in.
			const at = t + lead - NET.interval;
			// Walk back to the pair that straddles it. Bounded by HISTORY, and in the steady
			// state it is the newest pair or the one behind it, so the loop runs once or twice.
			let k = 0;
			while (k + 2 < this.len && this.ts[this.slot(k + 1)] > at) { k++; }
			const b = this.slot(k), a0 = this.slot(k + 1);
			const span = this.ts[b] - this.ts[a0];
			if (span <= 0) {
				this.x = this.xs[b];
				this.y = this.ys[b];
				return this;
			}
			// Clamped at both ends: a dropped packet coasts forward for at most MAX_EXTRAP spans
			// (plus lead) instead of extrapolating off the map, and nothing is ever drawn from
			// before the oldest position still held.
			const cap = MAX_EXTRAP + lead / span;
			const f = Math.max(0, Math.min(cap, (at - this.ts[a0]) / span));
			this.x = this.xs[a0] + (this.xs[b] - this.xs[a0]) * f;
			this.y = this.ys[a0] + (this.ys[b] - this.ys[a0]) * f;
			return this;
		}
	}
	Interp.TELEPORT = TELEPORT;
	Interp.MAX_EXTRAP = MAX_EXTRAP;

	/*
		Rescale a per-frame smoothing factor for the frame we actually got.

		`d += (target-d)*k` once per frame is a time constant only if the frame rate is fixed.
		Every k in the client was tuned on a 60Hz monitor; on 144Hz the same code smoothed 2.4x
		faster, and during a hitch it barely moved at all. The equivalent factor for a frame of
		length dtFrames (measured in 60Hz frames) is 1-(1-k)^dtFrames.
	*/
	function lerpK(k, dtFrames) {
		return (dtFrames === 1) ? k : 1 - Math.pow(1 - k, dtFrames);
	}

	exp.NET = NET;
	exp.Interp = Interp;
	exp.lerpK = lerpK;
	exp.NET_TICK = NET_TICK;
	exp.REF_TICK = REF_TICK;
	exp.RTT_GAIN = RTT_GAIN;
	exp.RTT_MAX = RTT_MAX;
})(typeof (exports) === 'undefined' ? function () { this['MOTION'] = {}; return this['MOTION'] }() : exports);
