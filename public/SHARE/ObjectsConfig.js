/*
	Rarity tiers for farmable polygons (THEPLAN Part 4.2).

	entities/Objects.js rolls a tier once per polygon at spawn (independent per-tier chance,
	checked rarest-first so a lucky roll cannot be "downgraded" to a more common tier) and
	multiplies the shape's base hp/prize by it. rooms/Room.js packs the tier id into 3 bits
	of the existing Objects `states` bitfield (slots 1-3, still a uint8 - see
	public/SHARE/SocketSchema.js's `bits` codec) instead of growing the packet.

	`color` names a public/client/config.js Palette entry; public/client/entities.js swaps a
	tiered polygon's fill to it and adds the glow. Tier 0 is "ordinary" - every polygon that
	does not win a roll - and is listed explicitly (rather than left implicit) so a lookup by
	tier id never has to special-case zero.

	Dual-mode file, same typeof(exports) footer as every other public/SHARE/*.js.
*/
(function (exports) {
	exports.rarity = [
		{ id: 0, name: null, chance: 0, hpMul: 1, prizeMul: 1, weight: null, color: null, showHp: false },
		{ id: 1, name: 'Shiny', chance: 1 / 1000000, hpMul: 2, prizeMul: 3, weight: null, color: 'shiny', showHp: false },
		{ id: 2, name: 'Mythic', chance: 1 / 5000000, hpMul: 40, prizeMul: 120, weight: 100, color: 'special', showHp: true }
	];
})(typeof (exports) === 'undefined' ? function () { this['ObjectsConfig'] = {}; return this['ObjectsConfig']; }() : exports);
