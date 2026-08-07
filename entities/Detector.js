/*
	Detector - an invisible entity used as a vision-cone query for the AI.
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
		if (!this.self) {
			if (kind === this.from.kind && other.id.oId === this.from.id.oId) {
				return;
			}
		}
		if (this.type.includes(kind) && other.alpha && !other.shield) {
			if (kind === KIND.BULLET && this.id.oId === other.origin.oId) {
				return;
			}
			// An Arena Closer is invulnerable and never dies, so it must never be selected as
			// a target - otherwise a chasing drone would latch onto it and never disengage.
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
	// Clears `select` and re-arms for the next scan. A chasing base drone deliberately never
	// calls this while chasing, so its target survives across ticks with the detector disabled.
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
