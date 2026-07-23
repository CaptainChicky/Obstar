/*
	One fixed-timestep clock for the whole process.

	What it replaces (HANDOFF 8.8). Every room used to end its own update() with

			setTimeout(function(it){it.update()},20,this);

	which is a self-re-arming chain, not a schedule. setTimeout(20) means "in *at least* 20ms",
	so every tick paid for its own overrun: a tick that took 9ms of CPU came back 29ms later,
	not 20ms later, and the error never got repaid. Under load the whole simulation quietly ran
	slow - bullets travelled at the wrong speed in wall-clock terms and the client, which
	smooths towards whatever the server last said, saw it as stutter. With several rooms open
	the drift was independent per room, so two players in different rooms ran at different
	speeds.

	The fix is the standard accumulator: measure how much real time actually passed, and pay
	out that time in whole fixed-size steps. Entity code keeps its per-tick constants - speeds,
	FRICTION, reload counters are all "per step" and stay exactly as they were - but a step now
	means a fixed 20ms of wall clock on average instead of "however long the last one took plus
	twenty".

		- Overrun is repaid, so the average rate is exactly stepMs, with no accumulated drift.
		- A stall longer than maxCatchup steps is *dropped*, not repaid. Repaying a 2-second
			GC pause as 100 back-to-back steps is how a fixed-step loop spirals into a death loop:
			the catch-up burst causes the next stall, which is longer. Time is discarded and
			counted in `dropped` instead.
		- Every room shares one timer, so N rooms cost one wake-up per step rather than N
			independent chains that interleave unpredictably.

	Send rate is deliberately not on this clock. net/gameSocket.js sends at its own ~33Hz per
	socket, which is the decoupling half of 8.8: what a client receives is a snapshot of
	whatever the simulation had reached, and neither rate has to be a multiple of the other.

	A target is any object with a step() method. It may remove itself from inside step() -
	rooms do exactly that when the last human leaves.
*/

// ms per simulation step. Set in lib/config.js, which explains at length why it is 33 and
// not the 20 the old setTimeout chain nominally asked for - the short version is that the
// old chain only ever achieved about 29Hz and the game is tuned for that.
const DEFAULT_STEP = require('./config.js').config.TICK_MS;
const DEFAULT_CATCHUP = 5;    // at most 5 steps of arrears paid back in one wake-up

function now() {
	// Monotonic. Date.now() would let an NTP correction or a DST jump inject a burst of steps.
	const hr = process.hrtime();
	return hr[0] * 1000 + hr[1] / 1e6;
}

class Clock {
	/* `time` is injectable so test/clock.js can hand the accumulator a scripted sequence of
		 wall-clock gaps and drive wake() for real, rather than reimplementing its arithmetic and
		 testing the copy. */
	constructor(stepMs = DEFAULT_STEP, maxCatchup = DEFAULT_CATCHUP, time = now) {
		this.stepMs = stepMs;
		this.maxCatchup = maxCatchup;
		this.now = time;
		this.targets = new Set();
		this.timer = null;
		this.accumulator = 0;
		this.last = 0;
		/// stats, read by the 'tps' admin command
		this.steps = 0;   // steps actually run
		this.dropped = 0;   // steps discarded because the process stalled
		this.startedAt = 0;
		// Last time a stall was reported, throttling the log. -Infinity, not 0: the clock reads
		// process uptime, so a 0 here would silence every stall in the process's first minute -
		// which is exactly when a misconfigured box stalls.
		this.warnedAt = -Infinity;
		this.warn = true;
		this.wake = this.wake.bind(this);
	}
	add(target) {
		this.targets.add(target);
		this.start();
		return target;
	}
	remove(target) {
		this.targets.delete(target);
		if (!this.targets.size) { this.stop(); }
	}
	start() {
		if (this.timer) { return; }
		this.last = this.now();
		this.accumulator = 0;
		this.startedAt = this.last;
		this.arm(this.stepMs);
	}
	stop() {
		if (this.timer) { clearTimeout(this.timer); }
		this.timer = null;
	}
	arm(ms) {
		this.timer = setTimeout(this.wake, ms);
		// Rooms alone must not hold the process open: server.js is kept alive by its listening
		// socket, and test/rooms.js stands rooms up with no server at all and expects to exit.
		if (this.timer.unref) { this.timer.unref(); }
	}
	wake() {
		this.timer = null;
		const t = this.now();
		let elapsed = t - this.last;
		this.last = t;
		///
		const budget = this.stepMs * this.maxCatchup;
		if (elapsed > budget) {
			const stall = elapsed;
			this.dropped += Math.floor((elapsed - budget) / this.stepMs);
			elapsed = budget;
			/*
				Say so. A simulation running slow used to be completely silent - it is the same
				symptom as a laggy network from every angle a player or an operator can see, which
				is why "the game feels laggy with many entities" stayed a guess. Throttled to one
				line a minute so a struggling box does not drown its own log.
			*/
			if (this.warn && t - this.warnedAt > 60000) {
				this.warnedAt = t;
				console.error('[clock] simulation stalled for ' + Math.round(stall) + 'ms; ' +
					this.dropped + ' steps dropped in total, ' + this.targets.size +
					' room(s) running');
			}
		}
		this.accumulator += elapsed;
		///
		while (this.accumulator >= this.stepMs) {
			this.accumulator -= this.stepMs;
			this.steps++;
			// Copied, because a target may add or remove targets from inside step().
			for (const target of Array.from(this.targets)) {
				if (this.targets.has(target)) { target.step(); }
			}
			if (!this.targets.size) { break; }
		}
		///
		if (this.targets.size) {
			this.arm(Math.max(0, this.stepMs - this.accumulator));
		}
	}
	/* Run one step immediately, ignoring the wall clock. Tests use this to advance a room a
		 known number of ticks without waiting for real time to pass. */
	tick(n = 1) {
		for (let i = 0; i < n; i++) {
			this.steps++;
			for (const target of Array.from(this.targets)) {
				if (this.targets.has(target)) { target.step(); }
			}
		}
	}
	/* Steps per second actually achieved since start(), for the 'tps' admin command. */
	rate() {
		const ms = this.now() - this.startedAt;
		return ms > 0 ? this.steps / (ms / 1000) : 0;
	}
}

// The simulation runs on one shared instance; the class is exported for tests that want an
// isolated clock.
module.exports = new Clock();
module.exports.Clock = Clock;
module.exports.STEP_MS = DEFAULT_STEP;
