/*
	SlotMap - integer-slot-indexed entity store.

	Replaces the sparse-array "slot map" idiom described in HANDOFF.md's "Entity storage is
	sparse arrays" note: `oId` stays an integer slot index - it travels the wire as a uint16
	(SocketSchema.js) and fixed bot/boss slot ranges depend on it - but allocation, the numeric
	tombstone (tick.KEEP_PLACE), and live-only iteration now live behind this class instead of
	being hand-rolled with `!isNaN(obj)` guards at every call site.

	Backed by a live Map<id, entity> plus a separate tombstone Map<id, ticksLeft>: a tombstoned
	id is neither iterated nor reused by add()/freeIndex() until its countdown reaches zero, so
	the client - which is still tracking that id from the last snapshot it saw - never has it
	reassigned to a new entity mid-interpolation.

	`maxIndex` is the highest id add() may hand out, not a capacity - a store meant to hold N
	entities is built with `maxIndex: N - 1`. (This used to be called `max`, with `add()`
	rejecting only `id > max`, so a store built with `max: N` actually held N+1 entities; every
	existing caller - rooms/Room.js's player cap, rooms/Sandbox.js's single-player
	`maxPlayer: 0` - was already written against the "highest allocatable index" meaning, so the
	fix was the rename, not the comparison.)
*/
const tick = require('./tick.js');

class SlotMap {
	constructor({ maxIndex } = {}) {
		this.maxIndex = (typeof maxIndex === 'number') ? maxIndex : Infinity;
		this.liveMap = new Map();
		this.tombMap = new Map();
		// Sorted live-key cache (plan.md WP4.5.4): live()/entries() used to re-derive
		// [...liveMap.keys()].sort() from scratch on every call, and step() calls each once per
		// kind in the insert pass, once in the collision pass and again in the update pass - ~4% of
		// a tick on its own, measured. null means "stale, rebuild on next live()/entries() call".
		// Invalidated by anything that changes the KEY SET (add/delete/clear); set() on an id that
		// is already live (a respawn) only replaces the VALUE, not the key set, so it does not
		// invalidate - live()/entries() always re-read the current value through liveMap.get(id)
		// regardless of how stale the cached key ORDER is.
		this._sortedKeys = null;
		// Lower bound on the lowest free id: freeIndex() only ever needs to scan forward from
		// here, because nothing below it is ever free (add() advances it past what it just
		// allocated; delete()/tick() pull it back down when they free something below it) - so
		// the scan stays O(1) amortised instead of re-walking from 0 on every bullet spawn.
		this.nextFree = 0;
	}
	/* First index that is neither live nor tombstoned. */
	freeIndex() {
		let id = this.nextFree;
		while (this.liveMap.has(id) || this.tombMap.has(id)) { id++; }
		return id;
	}
	/* Allocates the first free slot and calls makeFn(id) -> entity to build the occupant.
	   Returns null if the store is bounded (maxIndex) and has no free slot at or below it. */
	add(makeFn) {
		const id = this.freeIndex();
		if (id > this.maxIndex) { return null; }
		const entity = makeFn(id);
		this.liveMap.set(id, entity);
		this.nextFree = id + 1;
		this._sortedKeys = null;
		return entity;
	}
	/* Places (or replaces) a live entity at a specific id - fixed bot slots, respawn. Only
	   invalidates the key cache when id wasn't already live (a fresh bot slot) - a respawn (id
	   already live) is a value swap, not a key-set change. */
	set(id, entity) {
		if (!this.liveMap.has(id)) { this._sortedKeys = null; }
		this.tombMap.delete(id);
		this.liveMap.set(id, entity);
	}
	/* The live entity at id, or undefined - never a tombstone value. */
	get(id) {
		return this.liveMap.get(id);
	}
	/* Idempotent tombstone (re)set at a specific id - the pet-slot reservation. Refreshed every
	   tick the pet lives; once refreshing stops, tick() counts it down and frees it. */
	reserve(id) {
		this.tombMap.set(id, tick.KEEP_PLACE);
	}
	/* Frees id - immediately, or (tombstone=true) via a tick.KEEP_PLACE-tick countdown so the
	   id is not handed to a new entity while the client is still interpolating the old one. */
	delete(id, tombstone = false) {
		this.liveMap.delete(id);
		this._sortedKeys = null;
		if (tombstone) {
			this.tombMap.set(id, tick.KEEP_PLACE);
		} else {
			this.tombMap.delete(id);
			// id is free right now (not tombstoned) - if it is below the low-water mark,
			// freeIndex() has to know to look there again.
			if (id < this.nextFree) { this.nextFree = id; }
		}
	}
	/* Counts every tombstone down by one tick, freeing any that reach zero. */
	tick() {
		for (const [id, left] of this.tombMap) {
			if (left <= 1) {
				this.tombMap.delete(id);
				// This is the moment a tombstoned id actually becomes free - see the note in
				// delete() above.
				if (id < this.nextFree) { this.nextFree = id; }
			} else {
				this.tombMap.set(id, left - 1);
			}
		}
	}
	/*
		Live entities only, ascending id. A snapshot of the keys, so deleting the current entity
		mid-iteration (as step() does) is safe - _sortedKeys is read into the for..of loop once, up
		front, so a delete()/add() during iteration nulls the FIELD for the next call without
		touching the array this generator is already walking.

		The sort is load-bearing, not leftover (checked, not assumed): a `Map` iterates in
		insertion order, and delete()+add() re-inserting a freed low id at the *end*
		of that order is exactly the churn objs/bullets go through every tick, so plain
		Map-iteration order stops being ascending almost immediately. Nothing today actually
		depends on ascending order for correctness (collision uses the quadtree, the leaderboard
		re-sorts by xp), but it is what makes admin listings and any future ordering assumption
		stable across churn, so it stays. Cached now (plan.md WP4.5.4) - see _sortedKeys' own
		comment in the constructor for the invalidation rule.
	*/
	*live() {
		if (!this._sortedKeys) { this._sortedKeys = [...this.liveMap.keys()].sort((a, b) => a - b); }
		for (const id of this._sortedKeys) {
			const entity = this.liveMap.get(id);
			if (entity !== undefined) { yield entity; }
		}
	}
	/* [id, entity] pairs, live only, ascending id. */
	*entries() {
		if (!this._sortedKeys) { this._sortedKeys = [...this.liveMap.keys()].sort((a, b) => a - b); }
		for (const id of this._sortedKeys) {
			const entity = this.liveMap.get(id);
			if (entity !== undefined) { yield [id, entity]; }
		}
	}
	/* Empties both the live and tombstone maps. */
	clear() {
		this.liveMap.clear();
		this.tombMap.clear();
		this.nextFree = 0;
		this._sortedKeys = null;
	}
	get size() {
		return this.liveMap.size;
	}
}

module.exports = SlotMap;
