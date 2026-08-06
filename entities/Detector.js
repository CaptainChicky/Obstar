/*
	Detector - an invisible entity used as a vision-cone query for the AI.

	Extracted from the old Alex.js monolith (now server.js + lib/ + rooms/ + entities/).
	A leaf: it never reaches into another entity's room or the Controller.
*/
const KIND = require('../public/SHARE/kinds.js');

class Detector {
	constructor(from, x, y, size, type, self = 0, all = 0) {
		this.enabled = 1;
		this.self = self;
		this.from = from;
		this.id = from.id;
		this.x = x;
		this.y = y;
		this.select = 0;
		// Buckets keyed by entity kind; the AI reads them as selectAll[KIND.PLAYER] etc.
		this.selectAll = {
			[KIND.OBJECTS]: [],
			[KIND.BULLET]: [],
			[KIND.PLAYER]: []
		};
		this.size = size;
		this.type = type;
		this.dis = size;
		this.all = all;
		this.construc = type.length;
	}
	collision(other, option = {}) {
		const kind = other.kind;
		if (this.all) {
			if (this.type.includes(kind) && other.alpha && !other.shield) {
				if (kind === KIND.BULLET) {
					if (this.id.oId !== other.origin.oId) {
						this.selectAll[kind].push(other);
					}
				} else if (kind === KIND.PLAYER) {
					if (this.id.oId !== other.id.oId) {
						this.selectAll[kind].push(other);
					}
				} else {
					this.selectAll[kind].push(other);
				}
			}
		}
		////
		if (!this.self) {
			if (kind === this.from.kind && other.id.oId === this.from.id.oId) {
				return;
			}
		}
		if (this.type.includes(kind) && other.alpha && !other.shield) {
			if (kind === KIND.BULLET && this.id.oId === other.origin.oId) {
				return;
			}
			// An Arena Closer is not a target for anything. It is invulnerable and never dies
			// (entities/Player.js's collision() returns before any damage or knockback), so a base
			// drone that acquired one would abandon its ring, chase forever and never resolve -
			// which is exactly what a whole base did when a Closer wandered past. diep never has
			// this problem because a Closer is on the arena's own team and a base's drones are on
			// the base's, but our base drones scan by proximity, so the exclusion is stated here at
			// the one place every detector-driven target passes through.
			if (kind === KIND.PLAYER && other.closer) {
				return;
			}
			const index = this.type.indexOf(kind);
			if (index < this.construc) {
				this.dis = option.dis
				this.select = other;
				this.construc = index;
			} else if (index === this.construc) {
				if (this.dis > option.dis) {
					this.dis = option.dis;
					this.select = other;
				}
			}
		}
	}
	// Clears `select` too - previously left pointing at the last thing it ever
	// found, which meant every "forget this target and re-scan" call site was silently only half
	// working: collision() only ever OVERWRITES select on a fresh, closer find, so a stale
	// reference survived reset() indefinitely and got re-read (and, for a base drone's scout,
	// re-published into the shared levels.threat - see rooms/Room.js's tickDroneCentres()) before
	// anything had a chance to confirm it was still valid. The one caller that must NOT clear
	// select this way is a chasing base drone, which deliberately never calls reset() while
	// chasing (entities/Bullet.js's case 1.4) precisely so its target survives across ticks with
	// DETEC.enabled = 0 - see that file's comment.
	reset() {
		this.dis = this.size;
		this.construc = this.type.length;
		this.select = 0;
		// In-place truncation, not a fresh object literal - this now runs once per tick per
		// multi-target tank (shoot()'s per-tick rescan), not just on target loss.
		if (this.all) {
			this.selectAll[KIND.OBJECTS].length = 0;
			this.selectAll[KIND.BULLET].length = 0;
			this.selectAll[KIND.PLAYER].length = 0;
		}
	}
}

// Type tag for collision / buffer dispatch - see public/SHARE/kinds.js.
Detector.prototype.kind = KIND.DETECTOR;

module.exports = Detector;
