/*
	Wall - a static circular "stud" of Maze geometry (PENDING #2, wall-only slice).

	Never moves and never reacts to what hits it: all of the actual bounce/friction physics lives
	in the mover's own collision() arm (entities/Player.js's and entities/Bullet.js's
	`case KIND.WALL:`), the same way a Player already owns both sides of a tank-vs-tank shove.
	update() and collision() are still required to be *defined* (no-ops) since rooms/Room.js's
	tick loops call obj.update() and both sides of obj.collision()/other.collision() unconditionally
	on every live entity of every INSTANCE kind - see rooms/Room.js:1030-1242.

	No Maze room exists yet to spawn one of these; that is a separate future item.
*/
const KIND = require('../public/SHARE/kinds.js');

class Wall {
	constructor(x, y, size, id, room) {
		this.BUFF = {
			timestamp: -1,
		};
		this.room = room;
		this.id = id;
		this.x = x;
		this.y = y;
		this.size = size;
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
