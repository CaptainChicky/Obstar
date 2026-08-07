/*
	Broad-phase spatial index. Rebuilt from scratch every room tick: insert every live
	entity, then query it to get candidate collision pairs.

	Self-contained - depends on nothing else in the codebase.

	insert() picks the single quadrant a point actually belongs in (the midpoint tie always
	goes east/south, so a point on an internal boundary is never handed to two children) and
	redistributes existing points into the new children when a node splits, so a leaf's
	`this.points` is empty the instant it becomes an internal node - queries never see a stale
	pre-split point set duplicated on top of what the children find.
*/
class quadTree {
	constructor(x, y, w, h, max) {
		this.points = [];
		this.x = x;
		this.y = y;
		this.w = w;
		this.h = h;
		this.divide = 0;
		this.max = max;
	}
	/* Which of the four children (x,y) belongs in - the midpoint tie always goes east/south, so a
	   point on an internal boundary is never handed to two children. */
	child(x, y) {
		const midX = this.x + this.w / 2, midY = this.y + this.h / 2;
		if (x < midX) { return y < midY ? this.nw : this.sw; }
		return y < midY ? this.ne : this.se;
	}
	insert(x, y, size, data) {
		if (!this.checkIn(x, y)) { return; }
		if (this.divide) {
			this.child(x, y).insert(x, y, size, data);
			return;
		}
		// Guarded on this.w > 64: without it, a spawn bug piling many entities
		// onto the same coordinate would subdivide forever - halving w/h every split but never
		// separating the coincident points into different quadrants - and never return. Past that
		// floor, a leaf just accepts an over-max pile of coincident points instead.
		if (this.points.length >= this.max && this.w > 64) {
			this.ne = new quadTree(this.x + this.w / 2, this.y, this.w / 2, this.h / 2, this.max);
			this.nw = new quadTree(this.x, this.y, this.w / 2, this.h / 2, this.max);
			this.se = new quadTree(this.x + this.w / 2, this.y + this.h / 2, this.w / 2, this.h / 2, this.max);
			this.sw = new quadTree(this.x, this.y + this.h / 2, this.w / 2, this.h / 2, this.max);
			this.divide = 1;
			const existing = this.points;
			this.points = [];
			for (let i = 0; i < existing.length; i++) {
				const p = existing[i];
				this.child(p.x, p.y).insert(p.x, p.y, p.size, p.data);
			}
			this.child(x, y).insert(x, y, size, data);
			return;
		}
		this.points.push({ 'x': x, 'y': y, 'size': size, 'data': data });
	}
	checkIn(x, y) {
		if (x < this.x) { return 0; }
		if (x > this.x + this.w) { return 0; }
		if (y < this.y) { return 0; }
		if (y > this.y + this.h) { return 0; }
		return 1;
	}
	/* Original callback-based query - kept for the one remaining caller that isn't a circle query
	   (rooms/Room.js's per-viewer rectangle buffer). */
	query(func, data, log = 0) {
		if (func({ 'x': this.x, 'y': this.y, 'w': this.w, 'h': this.h }, data)) {
			const send = [];
			for (const p of this.points) {
				// Tests the point's own footprint, not just its centre - p.data.w/h are only set for
				// a Wall (everything else is a broad-phase circle with hw/hh both 0, reducing to a
				// plain point test). Without this, a long wall's still-visible far edge could sit
				// inside the viewer's buffer rect while its centre had already scrolled past it,
				// dropping the whole wall from view early.
				const hw = (p.data && p.data.w !== undefined) ? p.data.w / 2 : 0;
				const hh = (p.data && p.data.h !== undefined) ? p.data.h / 2 : 0;
				if (func({ 'x': p.x - hw, 'y': p.y - hh, 'w': hw * 2, 'h': hh * 2 }, data)) {
					send.push(p);
				}
			}
			if (this.divide) {
				Array.prototype.push.apply(send, this.ne.query(func, data));
				Array.prototype.push.apply(send, this.nw.query(func, data));
				Array.prototype.push.apply(send, this.se.query(func, data));
				Array.prototype.push.apply(send, this.sw.query(func, data));
			}
			return send;
		}
		return [];
	}
	/*
		Allocation-free circle query, for rooms/Room.js's collision pass. Same node-vs-circle
		test as query() (rect half-extents vs circle radius, closest-point-on-rect-to-circle-centre
		for the corner case), but written inline against primitives instead of a closure, points
		filtered by squared distance (no Math.sqrt), and results pushed into a caller-owned `out`
		array so the whole pass allocates nothing per node/point visited. Mutates and returns `out`.
	*/
	queryCircle(cx, cy, r, out) {
		const halfW = this.w / 2, halfH = this.h / 2;
		const distX = Math.abs(cx - this.x - halfW), distY = Math.abs(cy - this.y - halfH);
		if (distX > halfW + r || distY > halfH + r) { return out; }
		if (distX > halfW && distY > halfH) {
			const dx = distX - halfW, dy = distY - halfH;
			if (dx * dx + dy * dy > r * r) { return out; }
		}
		if (this.divide) {
			this.ne.queryCircle(cx, cy, r, out);
			this.nw.queryCircle(cx, cy, r, out);
			this.se.queryCircle(cx, cy, r, out);
			this.sw.queryCircle(cx, cy, r, out);
			return out;
		}
		const r2 = r * r;
		for (let i = 0; i < this.points.length; i++) {
			const p = this.points[i];
			const dx = p.x - cx, dy = p.y - cy;
			if (dx * dx + dy * dy <= r2) { out.push(p); }
		}
		return out;
	}
}
module.exports = quadTree;
