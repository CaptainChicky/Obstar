/*
	SlotMap - integer-slot-indexed entity store.

	Replaces the sparse-array "slot map" idiom described in HANDOFF.md's "Entity storage is
	sparse arrays" note: `oId` stays an integer slot index - it travels the wire as a uint16
	(SocketSchema.js) and fixed bot/boss slot ranges depend on it - but allocation, the numeric
	tombstone (config.KEEP_PLACE), and live-only iteration now live behind this class instead of
	being hand-rolled with `!isNaN(obj)` guards at every call site.

	Backed by a live Map<id, entity> plus a separate tombstone Map<id, ticksLeft>: a tombstoned
	id is neither iterated nor reused by add()/freeIndex() until its countdown reaches zero, so
	the client - which is still tracking that id from the last snapshot it saw - never has it
	reassigned to a new entity mid-interpolation.
*/
const config = require('./config.js').config;

class SlotMap {
	constructor({ max } = {}) {
		this.max = (typeof max === 'number') ? max : Infinity;
		this.liveMap = new Map();
		this.tombMap = new Map();
	}
	/* First index that is neither live nor tombstoned. */
	freeIndex() {
		let id = 0;
		while (this.liveMap.has(id) || this.tombMap.has(id)) { id++; }
		return id;
	}
	/* Allocates the first free slot and calls makeFn(id) -> entity to build the occupant.
	   Returns null if the store is bounded (max) and has no free slot at or below it. */
	add(makeFn) {
		const id = this.freeIndex();
		if (id > this.max) { return null; }
		const entity = makeFn(id);
		this.liveMap.set(id, entity);
		return entity;
	}
	/* Places (or replaces) a live entity at a specific id - fixed bot slots, respawn. */
	set(id, entity) {
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
		this.tombMap.set(id, config.KEEP_PLACE);
	}
	/* Frees id - immediately, or (tombstone=true) via a config.KEEP_PLACE-tick countdown so the
	   id is not handed to a new entity while the client is still interpolating the old one. */
	delete(id, tombstone = false) {
		this.liveMap.delete(id);
		if (tombstone) {
			this.tombMap.set(id, config.KEEP_PLACE);
		} else {
			this.tombMap.delete(id);
		}
	}
	/* Counts every tombstone down by one tick, freeing any that reach zero. */
	tick() {
		for (const [id, left] of this.tombMap) {
			if (left <= 1) {
				this.tombMap.delete(id);
			} else {
				this.tombMap.set(id, left - 1);
			}
		}
	}
	/* Live entities only, ascending id. A snapshot of the keys, so deleting the current entity
	   mid-iteration (as step() does) is safe. */
	*live() {
		for (const id of [...this.liveMap.keys()].sort((a, b) => a - b)) {
			const entity = this.liveMap.get(id);
			if (entity !== undefined) { yield entity; }
		}
	}
	/* [id, entity] pairs, live only, ascending id. */
	*entries() {
		for (const id of [...this.liveMap.keys()].sort((a, b) => a - b)) {
			const entity = this.liveMap.get(id);
			if (entity !== undefined) { yield [id, entity]; }
		}
	}
	/* Empties both the live and tombstone maps. */
	clear() {
		this.liveMap.clear();
		this.tombMap.clear();
	}
	get size() {
		return this.liveMap.size;
	}
}

module.exports = SlotMap;
