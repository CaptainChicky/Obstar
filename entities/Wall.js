/*
	Wall - a static axis-aligned rectangle of Maze geometry. The only non-circle entity in the
	collision system; every other kind is treated as a circle.

	Never moves and never reacts to what hits it: all push-out/destroy physics lives in the
	mover's own collision() arm (entities/Player.js's and entities/Bullet.js's `case KIND.WALL:`).
	update() and collision() still need to be defined as no-ops since Room.js's tick loop calls
	them unconditionally on every live entity.
*/
const KIND = require('../public/SHARE/kinds.js');

class Wall {
	constructor(x, y, w, h, id, room) {
		this.BUFF = {
			timestamp: -1,
		};
		this.room = room;
		this.id = id;
		this.x = x;
		this.y = y;
		this.w = w;
		this.h = h;
		// Broad-phase bounding radius (half-diagonal) - the collision pass treats every entity
		// as a circle of `.size` for its coarse pair gate and quadtree query. The half-diagonal
		// is the smallest circle guaranteed to contain the whole rectangle, so it can only ever
		// produce false positives (resolved by the real circle-vs-AABB test in the WALL arms),
		// never a missed contact.
		this.size = Math.sqrt(w * w + h * h) / 2;
		this.destroy = 0;   // never tombstoned - permanent geometry
	}
	collision() {
		// no-op: the mover's own collision() arm does all the work, see the file header.
	}
	update() {
		// no-op: a wall never moves and never changes.
	}
}

// Type tag for collision / buffer dispatch - see public/SHARE/kinds.js.
Wall.prototype.kind = KIND.WALL;

module.exports = Wall;
