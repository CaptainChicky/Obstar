/*
	Wall - a static AXIS-ALIGNED RECTANGLE of Maze geometry (plan.md Step 12, PENDING #26's
	reopened "wall shape is wrong" half). The first non-circle in this codebase's collision pass
	(HANDOFF §3: every other kind is a circle) - diepindepth/physics/README.txt §2: "All entities
	(except Maze Walls, Bases, and Arenas) are circles during collision calculation."

	Never moves and never reacts to what hits it: all of the actual push-out/destroy physics lives
	in the mover's own collision() arm (entities/Player.js's and entities/Bullet.js's
	`case KIND.WALL:`), the same way a Player already owns both sides of a tank-vs-tank shove.
	update() and collision() are still required to be *defined* (no-ops) since rooms/Room.js's
	tick loops call obj.update() and both sides of obj.collision()/other.collision() unconditionally
	on every live entity of every INSTANCE kind - see rooms/Room.js:1030-1242.
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
		/*
			Broad-phase bounding radius (half-diagonal), NOT the wire's own geometry - rooms/Room.js's
			collision pass treats every INSTANCE kind uniformly as a circle of `.size` for its coarse
			pair gate (`dis <= obj.size + other.size`) and its quadtree query radius, since it has no
			idea a wall is a rectangle. A merged wall chunk can run for several grid cells, so its true
			edge can sit far from its own centre - the half-diagonal is the smallest circle guaranteed
			to contain the whole rectangle, so it can never cause a false NEGATIVE (miss a genuine
			contact); it only ever waves a few false positives through to the real circle-vs-AABB test
			in the KIND.WALL collision arms, which is cheap and correct there.
		*/
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
