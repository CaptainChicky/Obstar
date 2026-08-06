(function (exports, platform) {

	// Entity type tags, shared with the server's collision/AI dispatch. kinds.js loads before
	// this file (as a <script> in play.ejs, and via require() in Node), so the three DETEC
	// auto-turret filters below can name KIND.PLAYER / KIND.OBJECTS instead of hardcoding the
	// string literals - see public/SHARE/kinds.js.
	const KIND = (platform === 'client') ? globalThis.KIND : require('./kinds.js');
	// FOV (plan.md T4): diep derives every class's screen as `base / fieldFactor` off one
	// shared base (Basic's own screen, fieldFactor 1). Diep-native classes below now carry
	// diep's own real fieldFactor (TankDefinitions.json) instead of a hand-set screen literal -
	// this is a real fix for classes that were never cross-checked (e.g. Sniper 1664 -> 1564,
	// Ranger 2208 -> 2011). Classes with no diep counterpart (Cyclone/Submachine/Auto Hover -
	// fieldFactor 1, unchanged; Fortress - back-solved to reproduce its current screen exactly)
	// keep their current feel; only server entries read this, `screen` has no client use.
	const BASE_SCREEN = 1408;

	// real diep-level camera scaling for the special scripted entities only 
	// (Dominator/Mothership) - FOV = (0.55*fieldFactor)/1.01^((level-1)/2), so screen (inverse of
	// FOV) scales as 1.01^((level-REFERENCE_LEVEL)/2) off this project's own level-45 baseline
	const REFERENCE_LEVEL = 45;
	function screenAtLevel(level, fieldFactor = 1) {
		return BASE_SCREEN * Math.pow(1.01, (level - REFERENCE_LEVEL) / 2) / fieldFactor;
	}

	// plan.md C2/R1: there are TWO du-to-unit conversion factors in this file, not one, because
	// a barrel is drawn as `c.height x (param.size / CONST.SIZE)` (drawings.js) against a 35-unit
	// reference, while diep draws the same barrel as `definition.size x (tank.physicsData.size / 50)`
	// against a 50 du body:
	//
	//   ABSOLUTE length (arena size, boss `bossSize`, drone resting radius):  1 du = 0.56 units
	//   REFERENCE-RELATIVE length (barrel height/width/canonLength/can.size,
	//     anything divided by CONST.SIZE=35 at the consumption site):        1 du = 0.70 units
	//     (`CONST.SIZE 35 / diep's 50 du body` - equating the two draw identities above)
	//
	// Every diep-native class's drawn barrel below is diep's own literal silhouette on the SECOND
	// axis - `height = barrel.size(du) x 0.70`, `width = barrel.width(du) x 0.70` - read straight
	// off `diepcustom/src/Const/TankDefinitions.json`'s own `barrels[]`. Classes with no diep
	// counterpart (K1: Cyclone/Submachine/Auto Hover/Fortress; Rocketeer's two barrels, which model
	// Rocket.ts's exhaust sub-barrel, not a tank barrel) are untouched - there is no `barrels[]`
	// entry to convert against. Bosses (Summoner/Guardian/Defender/Fallen Overlord/Fallen Booster)
	// and Arena Closer/the 3 Dominators convert against their OWN base size, not 50 - see plan.md R2
	// at each entry. Auto-turret cannons (`turrets` below) convert against `AutoTurret.ts`'s shared
	// `AutoTurretDefinition` (size 55, width 29.4) instead of a per-tank row, same source every
	// existing auto-turret speed/life/rand already used. Bullet radius (server `can.size`) is
	// `(barrel.width/2) x bullet.sizeRatio x 0.70` (`Bullet.ts:77`) - plan.md B2/R1. Every number
	// below is still a baked literal (this file's own convention), not a live expression - divide
	// by 0.70 to read a du value back (0.56 for the absolute fields named above).

	exports.class = (platform === 'client') ?
		///CLIENTS///
		{
			"Basic": {
				cannons: [
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 0,
						offdir: 0,
						open: 0
					}
				],
				body: {
					shape: 0,
				}
			},
			///
			"Twin": {
				cannons: [
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 18.2,   // diep barrel.offset 26 x 0.70 (plan.md Part B row 1)
						offdir: 0,
						open: 0,
					},
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: -18.2,
						offdir: 0,
						open: 0
					}
				],
				body: {
					shape: 0,
				}
			},
			// type 2 (plan.md A2): a real trapezoid, wide at the muzzle, instead of the old
			// type-0-plus-`open` flare fake - see drawings.js's TAPER_RATIO.
			"Machine Gun": {
				cannons: [
					{
						type: 2,
						height: 66.5,
						width: 29.4,
						offx: 0,
						offdir: 0,
						open: 0,
						trapezoidDirection: false
					}
				],
				body: {
					shape: 0,
				}
			},
			"Sniper": {
				cannons: [
					{
						type: 0,
						height: 77,
						width: 29.4,
						offx: 0,
						offdir: 0,
						open: 0
					}
				],
				body: {
					shape: 0,
				}
			},
			"Flank Guard": {
				cannons: [
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 0,
						offdir: 0,
						open: 0
					},
					{
						type: 0,
						height: 56,
						width: 29.4,
						offx: 0,
						offdir: Math.PI,
						open: 0
					},
					///
				],
				body: {
					shape: 0,
				}
			},
			///
			"Triple Shot": {
				cannons: [
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 0,
						offdir: -Math.PI / 4,   // diep barrel.angle (plan.md Part B row 2 - was +-0.4/+-6, a paraphrase)
						open: 0,
					},
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 0,
						offdir: Math.PI / 4,
						open: 0
					},
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 0,
						offdir: 0,
						open: 0
					}
				],
				body: {
					shape: 0,
				}
			},
			// offx signs below follow the server's firing order, not the drawn left/right picture
			// - the recoil bitfield is index-keyed end to end
			// (entities/Player.js's this.recoil[r] -> SocketSchema.js's bits -> drawings.js's
			// param.recoils[i]), so a client index has to mirror its server counterpart exactly or
			// the barrel that visibly kicks is the mirror of the one the bullet left from.
			"Twin Flank": {
				cannons: [
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: -18,
						offdir: 0,
						open: 0,
					},
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 18,
						offdir: 0,
						open: 0
					},
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: -18,
						offdir: Math.PI,
						open: 0,
					},
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 18,
						offdir: Math.PI,
						open: 0
					}
				],
				body: {
					shape: 0,
				}
			},
			"Quad Tank": {
				cannons: [
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 0,
						offdir: 0,
						open: 0,
					},
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 0,
						offdir: Math.PI / 2,
						open: 0
					},
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 0,
						offdir: Math.PI,
						open: 0
					},
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 0,
						offdir: Math.PI * 1.5,
						open: 0
					},
				],
				body: {
					shape: 0,
				}
			},
			"Destroyer": {
				cannons: [
					{
						type: 0,
						height: 66.5,
						width: 49.98,
						offx: 0,
						offdir: 0,
						open: 0
					}
				],
				body: {
					shape: 0,
				}
			},
			"Assassin": {
				cannons: [
					{
						type: 0,
						height: 84,
						width: 29.4,
						offx: 0,
						offdir: 0,
						open: 0
					}
				],
				body: {
					shape: 0,
				}
			},
			// type 2 (plan.md A2): a real trapezoid, wide at the muzzle - see Machine Gun above.
			"Overseer": {
				cannons: [
					{
						type: 2,
						height: 49,
						width: 29.4,
						offx: 0,
						offdir: Math.PI / 2,
						open: 0,
						trapezoidDirection: false
					},
					{
						type: 2,
						height: 49,
						width: 29.4,
						offx: 0,
						offdir: -Math.PI / 2,
						open: 0,
						trapezoidDirection: false
					},
				],
				body: {
					shape: 0,
				}
			},
			"Triangle": {
				cannons: [
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 0,
						offdir: 0,
						open: 0
					},
					///
					{
						type: 0,
						height: 56,
						width: 29.4,
						offx: -5,
						offdir: -Math.PI - .4,
						open: 0,
					},
					{
						type: 0,
						height: 56,
						width: 29.4,
						offx: 5,
						offdir: -Math.PI + .4,
						open: 0
					},
					///
				],
				body: {
					shape: 0,
				}
			},
			// type 0 + trapLauncher (plan.md A3): a short plain rectangle plus the real
			// TrapLauncher arrowhead addon, not the type-1 flared-muzzle fake.
			"Trapper": {
				cannons: [
					{
						type: 0,
						height: 42,
						width: 29.4,
						offx: 0,
						offdir: 0,
						open: 0,
						trapLauncher: true
					}
				],
				body: {
					shape: 0,
				}
			},
			///
			// diep's real name for this class (PENDING.md, plan.md T1) - it was already our
			// stand-in for diep's Rocketeer, just misnamed/mis-parented under Flank Guard.
			"Rocketeer": {
				cannons: [
					{
						type: 0,
						height: 56,
						width: 27,
						offx: -5,
						offdir: -Math.PI - .4,
						open: 0,
					},
					{
						type: 0,
						height: 56,
						width: 27,
						offx: 5,
						offdir: -Math.PI + .4,
						open: 0
					}
				],
				body: {
					shape: 0,
				}
			},
			'Hybrid': {
				cannons: [
					{
						type: 0,
						height: 66.5,
						width: 49.98,
						offx: 0,
						offdir: 0,
						open: 0
					},
					{
						type: 0,
						height: 49,
						width: 29.4,
						offx: 0,
						offdir: Math.PI,
						open: 23,
					}
				],
				body: {
					shape: 0,
				}
			},
			"Annihilator": {
				cannons: [
					{
						type: 0,
						height: 66.5,
						width: 67.62,
						offx: 0,
						offdir: 0,
						open: 0
					}
				],
				body: {
					shape: 0,
				}
			},
			// height 77/66.5 are diep's own two real barrels (size 110/95 x 0.70); c[2]-c[4] have
			// no diep counterpart (diep Sprayer has only 2 barrels) and stay on the same decorative
			// step pattern, rebased so c[1] still lands exactly on diep's second barrel (plan.md C2/R1).
			// diep Sprayer (id29, plan.md Part B) is a real 2-barrel class: [0] an inner straight
			// barrel drawn first/under, [1] a Machine Gun-style trapezoid on top, shorter (66.5)
			// than the straight barrel underneath (77) so ~10.5 units of it peek out past the
			// trapezoid's own muzzle.
			"Sprayer": {
				cannons: [
					{
						type: 0,
						height: 77,
						width: 29.4,
						offx: 0,
						offdir: 0,
						open: 0
					},
					{
						type: 2,
						height: 66.5,
						width: 29.4,
						offx: 0,
						offdir: 0,
						open: 0,
						trapezoidDirection: false   // wide end at the muzzle (plan.md A2)
					},
				],
				body: {
					shape: 0,
				}
			},
			// postAddon "pronounced" (plan.md A4, diepcustom Addons.ts's PronouncedAddon) - a
			// barrel-coloured trapezoid overlay above the main barrel/below the body, not a
			// second cannon (there was never a second barrel to fire from server-side).
			"Ranger": {
				pronounced: true,
				cannons: [
					{
						type: 0,
						height: 84,
						width: 29.4,
						offx: 0,
						offdir: 0,
						open: 0
					}
				],
				body: {
					shape: 0,
				}
			},
			"Booster": {
				cannons: [
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 0,
						offdir: 0,
						open: 0
					},
					///
					{
						type: 0,
						height: 49,
						width: 29.4,
						offx: -6,
						offdir: -Math.PI - .65,
						open: 0,
					},
					{
						type: 0,
						height: 49,
						width: 29.4,
						offx: 6,
						offdir: -Math.PI + .65,
						open: 0
					},
					///
					{
						type: 0,
						height: 56,
						width: 29.4,
						offx: -5,
						offdir: -Math.PI - .35,
						open: 0,
					},
					{
						type: 0,
						height: 56,
						width: 29.4,
						offx: 5,
						offdir: -Math.PI + .35,
						open: 0
					},
					///
				],
				body: {
					shape: 0,
				}
			},
			"Fighter": {
				cannons: [
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 0,
						offdir: 0,
						open: 0
					},
					///
					{
						type: 0,
						height: 56,
						width: 29.4,
						offx: 1,
						offdir: -Math.PI / 2,
						open: 0,
					},
					{
						type: 0,
						height: 56,
						width: 29.4,
						offx: -1,
						offdir: Math.PI / 2,
						open: 0
					},
					///
					{
						type: 0,
						height: 56,
						width: 29.4,
						offx: -5,
						offdir: -Math.PI - .4,
						open: 0,
					},
					{
						type: 0,
						height: 56,
						width: 29.4,
						offx: 5,
						offdir: -Math.PI + .4,
						open: 0
					},
					///
				],
				body: {
					shape: 0,
				}
			},
			"Auto Hover": {
				cannons: [
					{
						type: 0,
						height: 62,
						width: 32,
						offx: 0,
						offdir: 0,
						open: 0
					},
					///
					{
						type: 0,
						height: 58,
						width: 27,
						offx: -5,
						offdir: -Math.PI - .4,
						open: 0,
					},
					{
						type: 0,
						height: 58,
						width: 27,
						offx: 5,
						offdir: -Math.PI + .4,
						open: 0
					},
					///
				],
				turrets: [
					{
						type: 0,
						height: 38.5,   // AutoTurret.ts's shared AutoTurretDefinition, size 55 x 0.70 (plan.md C2/R1)
						width: 20.58,   // width 42 x 0.7 x 0.70
						offx: 0,
						offdir: 0,
						open: 0,
						rad: 18
					}
				],
				body: {
					shape: 0,
				}
			},
			"Triplet": {
				cannons: [
					{
						type: 0,
						height: 56,
						width: 29.4,
						offx: 18.2,   // diep barrel.offset 26 x 0.70 (plan.md C0, was 17)
						offdir: 0,
						open: 0,
					},
					{
						type: 0,
						height: 56,
						width: 29.4,
						offx: -18.2,
						offdir: 0,
						open: 0
					},
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 0,
						offdir: 0,
						open: 0
					}
				],
				body: {
					shape: 0,
				}
			},
			// offx signs mirror the server's firing order, same reasoning as Twin Flank above
			//.
			"Triple Twin": {
				cannons: [
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: -18.2,   // diep barrel.offset -26 x 0.70 (plan.md C0, was 18)
						offdir: 0,
						open: 0,
					},
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 18.2,
						offdir: 0,
						open: 0
					},
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: -18.2,
						offdir: Math.PI * 2 / 3,
						open: 0,
					},
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 18.2,
						offdir: Math.PI * 2 / 3,
						open: 0
					},
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: -18.2,
						offdir: Math.PI * 4 / 3,
						open: 0,
					},
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 18.2,
						offdir: Math.PI * 4 / 3,
						open: 0
					}
				],
				body: {
					shape: 0,
				}
			},
			"Penta Shot": {
				cannons: [
					{
						type: 0,
						height: 56,
						width: 29.4,
						offx: 0,
						offdir: Math.PI / 4,   // diep barrel[1].angle (plan.md Part B row 2 - was +-0.6/+-7)
						open: 0,
					},
					{
						type: 0,
						height: 56,
						width: 29.4,
						offx: 0,
						offdir: -Math.PI / 4,
						open: 0
					},
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 0,
						offdir: Math.PI / 8,
						open: 0,
					},
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 0,
						offdir: -Math.PI / 8,
						open: 0
					},
					{
						type: 0,
						height: 77,
						width: 29.4,
						offx: 0,
						offdir: 0,
						open: 0
					}
				],
				body: {
					shape: 0,
				}
			},
			"Octo Tank": {
				cannons: [
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 0,
						offdir: 0,
						open: 0,
					},
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 0,
						offdir: Math.PI / 4,
						open: 0
					},
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 0,
						offdir: Math.PI * .5,
						open: 0
					},
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 0,
						offdir: Math.PI * .75,
						open: 0
					},
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 0,
						offdir: Math.PI,
						open: 0,
					},
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 0,
						offdir: Math.PI * 1.25,
						open: 0
					},
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 0,
						offdir: Math.PI * 1.5,
						open: 0
					},
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: 0,
						offdir: Math.PI * 1.75,
						open: 0
					},
				],
				body: {
					shape: 0,
				}
			},
			"Cyclone": {
				cannons: [
					{
						type: 0,
						height: 52,
						width: 20,
						offx: 0,
						offdir: 0,
						open: 0
					},
					{
						type: 0,
						height: 52,
						width: 20,
						offx: 0,
						offdir: Math.PI * .2,
						open: 0
					},
					{
						type: 0,
						height: 52,
						width: 20,
						offx: 0,
						offdir: Math.PI * 0.4,
						open: 0
					},
					{
						type: 0,
						height: 52,
						width: 20,
						offx: 0,
						offdir: Math.PI * .6,
						open: 0
					},
					{
						type: 0,
						height: 52,
						width: 20,
						offx: 0,
						offdir: Math.PI * .8,
						open: 0
					},
					{
						type: 0,
						height: 52,
						width: 20,
						offx: 0,
						offdir: Math.PI * 1,
						open: 0
					},
					{
						type: 0,
						height: 52,
						width: 20,
						offx: 0,
						offdir: Math.PI * 1.2,
						open: 0
					},
					{
						type: 0,
						height: 52,
						width: 20,
						offx: 0,
						offdir: Math.PI * 1.4,
						open: 0
					},
					{
						type: 0,
						height: 52,
						width: 20,
						offx: 0,
						offdir: Math.PI * 1.6,
						open: 0
					},
					{
						type: 0,
						height: 52,
						width: 20,
						offx: 0,
						offdir: Math.PI * 1.8,
						open: 0
					},
				],
				body: {
					shape: 0,
				}
			},
			// type 2 (plan.md A2): a real trapezoid, wide at the muzzle - see Machine Gun above.
			"Overlord": {
				cannons: [
					{
						type: 2,
						height: 49,
						width: 29.4,
						offx: 0,
						offdir: 0,
						open: 0,
						trapezoidDirection: false
					},
					{
						type: 2,
						height: 49,
						width: 29.4,
						offx: 0,
						offdir: Math.PI / 2,
						open: 0,
						trapezoidDirection: false
					},
					{
						type: 2,
						height: 49,
						width: 29.4,
						offx: 0,
						offdir: Math.PI,
						open: 0,
						trapezoidDirection: false
					},
					{
						type: 2,
						height: 49,
						width: 29.4,
						offx: 0,
						offdir: Math.PI * 3 / 2,
						open: 0,
						trapezoidDirection: false
					},
				],
				body: {
					shape: 0,
				}
			},
			// type 2 (plan.md A2): a real trapezoid, wide at the muzzle - see Machine Gun above.
			//
			// `height` is a deliberate DEPARTURE from diep here, by request, not a derived figure:
			// diep's own barrel size 70 x 0.70 is 49, which against this class's own taller-than-
			// wide body (`height: 1.05`, so 36.75 of the 49 is buried) leaves only 12.25 units of
			// barrel actually poking out - visibly less stub than Overseer gets from the identical
			// 70 over a round body. 61.25 is that 49 x 1.25, which doubles the visible protrusion
			// to 24.5. Decorative only either way: the server fires through `this.necro`, not
			// through a cannon, so nothing about the drone spawn moves with it.
			"Necromancer": {
				cannons: [
					{
						type: 2,
						height: 55,
						width: 29.4,
						offx: 0,
						offdir: Math.PI / 2,
						open: 0,
						trapezoidDirection: false
					},
					{
						type: 2,
						height: 55,
						width: 29.4,
						offx: 0,
						offdir: -Math.PI / 2,
						open: 0,
						trapezoidDirection: false
					},
				],
				body: {
					shape: 1,
					height: 1.05,
					width: .95,
				},
				ups: [
					'Health Regen',
					'Drone Count',
					'Max Health',
					'Bullet Speed',
					'Movement Speed',
					'Bullet Damage',
					'Body Damage',
					'Bullet Penetration'
				]
			},
			// type 2 (plan.md A2): a real trapezoid, wide at the muzzle - see Machine Gun above.
			"Manager": {
				cannons: [
					{
						type: 2,
						height: 49,
						width: 29.4,
						offx: 0,
						offdir: 0,
						open: 0,
						trapezoidDirection: false
					},
				],
				body: {
					shape: 0,
				}
			},
			"BattleShip": {
				cannons: [
					{
						type: 2,
						height: 52.5,
						width: 20.58,
						offx: -14,   // diep barrel[0]/[1] (auto pair) offset -20 x 0.70 (plan.md Part B)
						offdir: Math.PI / 2,
						open: 0,
						trapezoidDirection: true,   // wide at the hull, narrow at the muzzle
					},
					{
						type: 2,
						height: 52.5,
						width: 20.58,
						offx: -14,
						offdir: -Math.PI / 2,
						open: 0,
						trapezoidDirection: true
					},
					{
						type: 2,
						height: 52.5,
						width: 20.58,
						offx: 14,   // diep barrel[2]/[3] (controllable pair) offset +20 x 0.70
						offdir: Math.PI / 2,
						open: 0,
						trapezoidDirection: true,
					},
					{
						type: 2,
						height: 52.5,
						width: 20.58,
						offx: 14,
						offdir: -Math.PI / 2,
						open: 0,
						trapezoidDirection: true
					},
				],
				body: {
					shape: 0,
				}
			},
			"Fortress": {
				cannons: [
					{
						type: 1,
						height: 65,
						width: 27,
						openlength: 15,
						offx: 0,
						offdir: 0,
						open: 14
					},
					{
						type: 1,
						height: 65,
						width: 27,
						openlength: 15,
						offx: 0,
						offdir: Math.PI * 2 / 3,
						open: 14
					},
					{
						type: 1,
						height: 65,
						width: 27,
						openlength: 15,
						offx: 0,
						offdir: Math.PI * 4 / 3,
						open: 14
					},
					{
						type: 0,
						height: 48,
						width: 33,
						offx: 0,
						offdir: Math.PI / 3,
						open: -16,
					},
					{
						type: 0,
						height: 48,
						width: 33,
						offx: 0,
						offdir: Math.PI,
						open: -16,
					},
					{
						type: 0,
						height: 48,
						width: 33,
						offx: 0,
						offdir: Math.PI * 5 / 3,
						open: -16,
					},
				],
				body: {
					shape: 0,
				}
			},
			// type 0 + trapLauncher (plan.md A3) - see Trapper above.
			"Mega Trapper": {
				cannons: [
					{
						type: 0,
						height: 42,
						width: 38.22,
						offx: 0,
						offdir: 0,
						open: 0,
						trapLauncher: true
					}
				],
				body: {
					shape: 0,
				}
			},
			// type 0 + trapLauncher on the trap barrel (plan.md A3) - see Trapper above; the two
			// side barrels are ordinary bullet cannons, untouched.
			"Overtrapper": {
				cannons: [
					{
						type: 0,
						height: 42,
						width: 29.4,
						offx: 0,
						offdir: 0,
						open: 0,
						trapLauncher: true
					},
					{
						type: 0,
						height: 49,
						width: 29.4,
						offx: 0,
						offdir: Math.PI * 2 / 3,
						open: 23,
					},
					{
						type: 0,
						height: 49,
						width: 29.4,
						offx: 0,
						offdir: Math.PI * 4 / 3,
						open: 23
					}
				],
				body: {
					shape: 0,
				}
			},
			// type 0 + trapLauncher (plan.md A3) - see Trapper above.
			"Auto Trapper": {
				cannons: [
					{
						type: 0,
						height: 42,
						width: 29.4,
						offx: 0,
						offdir: 0,
						open: 0,
						trapLauncher: true
					}
				],
				turrets: [
					{
						type: 0,
						height: 38.5,
						width: 20.58,
						offx: 0,
						offdir: 0,
						open: 0,
						rad: 18
					}
				],
				body: {
					shape: 0,
				}
			},
			"Submachine": {
				cannons: [
					{
						type: 0,
						height: 65,
						width: 32,
						offx: 0,
						offdir: 0,
						open: 30
					}
				],
				body: {
					shape: 0,
				}
			},
			///
			'Gunner': {
				cannons: [
					{
						type: 0,
						height: 45.5,
						width: 17.64,
						offx: 22.4,   // diep barrel[1].offset 32 x 0.70 (plan.md C0, was 24)
						offdir: 0,
						open: 0
					},
					{
						type: 0,
						height: 45.5,
						width: 17.64,
						offx: -22.4,
						offdir: 0,
						open: 0
					},
					///
					{
						type: 0,
						height: 59.5,
						width: 17.64,
						offx: 11.9,   // diep barrel[3].offset 17 x 0.70 (plan.md C0, was 13)
						offdir: 0,
						open: 0
					},
					{
						type: 0,
						height: 59.5,
						width: 17.64,
						offx: -11.9,
						offdir: 0,
						open: 0
					},
				],
				body: {
					shape: 0
				}
			},
			'Auto Gunner': {
				cannons: [
					{
						type: 0,
						height: 45.5,
						width: 17.64,
						offx: 22.4,   // diep barrel[1].offset 32 x 0.70 (plan.md C0, was 24)
						offdir: 0,
						open: 0
					},
					{
						type: 0,
						height: 45.5,
						width: 17.64,
						offx: -22.4,
						offdir: 0,
						open: 0
					},
					///
					{
						type: 0,
						height: 59.5,
						width: 17.64,
						offx: 11.9,   // diep barrel[3].offset 17 x 0.70 (plan.md C0, was 13)
						offdir: 0,
						open: 0
					},
					{
						type: 0,
						height: 59.5,
						width: 17.64,
						offx: -11.9,
						offdir: 0,
						open: 0
					},
				],
				turrets: [
					{
						type: 0,
						height: 38.5,
						width: 20.58,
						offx: 0,
						offdir: 0,
						open: 0,
						rad: 18
					}
				],
				body: {
					shape: 0
				}
			},
			testbed: {
				cannons: [
					{
						hidden: 1,
						type: 0,
						height: 40,
						width: 1,
						offx: 0,
						offdir: 0,
						open: 0
					}
				],
				body: {
					shape: 0,
				}
			},
			bigView: {
				cannons: [
					{
						hidden: 1,
						type: 0,
						height: 40,
						width: 1,
						offx: 0,
						offdir: 0,
						open: 0
					}
				],
				body: {
					shape: 0,
				}
			},
			'pre launch': {
				cannons: [
					{
						hidden: 1,
						type: 0,
						height: 36,
						width: 1,
						offx: 0,
						offdir: 0,
						open: 0
					}
				],
				body: {
					shape: 0,
				}
			},
			shapes: {
				cannons: [
					{
						hidden: 1,
						type: 0,
						height: 40,
						width: 1,
						offx: 0,
						offdir: 0,
						open: 0
					}
				],
				body: {
					shape: 0,
				}
			},
			shape1: {
				cannons: [
					{
						hidden: 1,
						type: 0,
						height: 50,
						width: 1,
						offx: 0,
						offdir: 0,
						open: 0
					}
				],
				body: {
					shape: 1,
					width: 1,
					height: 1
				}
			},
			shape2: {
				cannons: [
					{
						hidden: 1,
						type: 0,
						height: 50,
						width: 1,
						offx: 0,
						offdir: 0,
						open: 0
					}
				],
				body: {
					shape: 2,
				}
			},
			///boss
			// SummonerSpawnerDefinition (Summoner.ts:29-54, plan.md Part D): size 135, width
			// 71.4. The old height/width here (135x35/150=31.5, 71.4x35/150=16.66) divided by
			// SUMMONER_SIZE (150, a raw du circumradius constant) instead of this class's own
			// bossSize - the same size-conflation bug Guardian already had fixed once (see its
			// own entry a few lines down): with bossSize itself ALSO wrong (84, see below), a
			// 31.5-long barrel finished nowhere near the body's own ~84-unit apothem, i.e.
			// entirely swallowed - issues.md's "royally fucked". Re-derived the same way as
			// Guardian: sizeFactor is a constant 1 here too (SUMMONER_SIZE cancels against
			// itself in Summoner.ts's own `get sizeFactor()`), so a diep length converts on the
			// plain 0.56 absolute axis and is then read back through THIS class's own bossSize -
			// `du x 0.56 x 35/bossSize`: 135 -> 44.547727, 71.4 -> 23.560798.
			Summoner: {
				cannons: [
					{
						type: 0,
						height: 44.547727,
						width: 23.560798,
						offx: 0,
						offdir: 0,
						open: 28,
					},
					{
						type: 0,
						height: 44.547727,
						width: 23.560798,
						offx: 0,
						offdir: Math.PI / 2,
						open: 28
					},
					{
						type: 0,
						height: 44.547727,
						width: 23.560798,
						offx: 0,
						offdir: Math.PI,
						open: 28
					},
					{
						type: 0,
						height: 44.547727,
						width: 23.560798,
						offx: 0,
						offdir: -Math.PI / 2,
						open: 28
					}
				],
				body: {
					shape: 3,
					sides: 4,   // TankDefinitions.json/Summoner.ts: sides 4 (plan.md R6)
					// Vertex-forward (this shape's default) puts a CORNER on each of the four
					// cardinal barrel directions instead of a flat side - issues.md's "drawn 45
					// degrees from where it should be". -PI/4 re-anchors so an edge sits under
					// each spawner instead (Drawings.body[3]'s own `body.rot`, drawings.js).
					rot: -Math.PI / 4
				}
			},
			// The four real diep bosses (plan.md X1). Guardian/Defender draw their real triangle
			// body (shape 3, `body.sides`, plan.md R6); Fallen Overlord/Fallen Booster draw their
			// real body too now (plan.md Part D) - a plain circle (shape 0), the same body every
			// ordinary diep tank (including the Overlord/Booster classes these two are scaled
			// copies of) already has, not the rounded-rect stand-in PENDING #51 flagged.
			"Guardian": {
				/*
					One oversized backward-facing drone spawner (diepcustom
					GuardianSpawnerDefinition: angle PI, size 100, width 71.4, `isTrapezoid` with
					`trapezoidDirection: 0` - wide end at the mouth, which is draw-type 2 here, not
					a type-0 rectangle with an `open` flare bolted on).

					GEOMETRY, re-derived (the previous numbers drew nothing at all - the whole
					barrel finished inside the body). Both figures below hang off ONE fact: this
					class's `bossSize` is 37.8, the value that makes Drawings.body[3] draw a
					triangle of diep's own GUARDIAN_SIZE 135 du circumradius (its drawn
					circumradius is `size / cos(pi/3)` = 2 x size, and 2 x 37.8 = 75.6 units =
					135 du). A barrel is then drawn at `height x size/35`, so a diep length of
					`du x 0.56` units needs `height = du x 0.56 x 35 / 37.8` = `du x 0.51852`:
					100 -> 51.851852, 71.4 -> 37.022222. The old `x 35/135` factor treated 135 as
					if it were this class's DRAWN size in the 50-du reference, which is exactly
					half the truth for a triangle, so the barrel came out at half length - shorter
					than the body's own inradius, i.e. completely hidden under it.
				*/
				cannons: [
					{ type: 2, height: 51.851852, width: 37.022222, offx: 0, offdir: Math.PI, open: 0, trapezoidDirection: false }
				],
				body: { shape: 3, sides: 3 }   // Guardian.ts: sides 3 (plan.md R6)
			},
			"Defender": {
				// Re-derived cleanly off diepcustom Defender.ts (this session). Defender.ts sets
				// `physicsData.size = DEFENDER_SIZE * sqrt(1/2)` (DEFENDER_SIZE 150 du) and never
				// calls `scale()`, so its `scaleFactor` stays 1 (unlike Fallen Overlord/Booster,
				// which scale to level 75) - EVERY barrel/turret dimension is therefore diep's raw
				// du at scaleFactor 1, and every one of them converts on the SAME axis the body
				// does. That axis is the whole fix. The body draws its 150 du circumradius at
				// `bossSize 42` (server entry: 150 x 0.56 x cos(pi/3) = 42, so Drawings.body[3]'s
				// `size / cos(pi/3)` = 84 units = 150 du x 0.56); a barrel is then drawn at
				// `height x bossSize/CONST.SIZE` = `height x 42/35` = `height x 1.2`, so a diep
				// length of `du x 0.56` units needs `height = du x 0.56 x 35/42` = `du x 0.46667`.
				// The old numbers used `du x 0.7` for the barrels (49.98 = 71.4 x 0.7, 20.58 =
				// 29.4 x 0.7) - correct for a NON-boss class drawn at CONST.SIZE, but on this boss
				// the extra x1.2 body-scale then lands them on 0.84, i.e. 1.5x too big relative to
				// the 0.56 body: "the trapper barrels have a 'stub' that is wayyy too long"
				// (issues.md), and the whole silhouette reads oversized.
				//
				// Trap launcher (TrapperDefinition size 120 / width 71.4): height 120 x 0.46667 =
				// 56 (barrel tip at 56 x 1.2 = 67.2 units = 120 du), width 71.4 x 0.46667 = 33.32.
				// The trapLauncher arrowhead auto-derives off `width` (drawings.js: length =
				// width x 20/42), so it now flares to a stub reaching ~154 du along the edge normal
				// - level with the body's own vertices, exactly as Defender_boss_3.webp shows,
				// instead of the old 227 du overshoot.
				//
				// Auto-turrets (MountedTurretDefinition = AutoTurretDefinition: barrel size 55 /
				// width 42 x 0.7 = 29.4, base baseSize 25 du, mounted at Defender.ts's own
				// `size * offset` = 60 du absolute radius). Moved off the old `aboveBody` cannon
				// hack (a bare rectangle, no base circle, and a barrel frozen at its resting
				// offdir because a client cannon never reads canDir) onto the `turrets` mechanism,
				// the same one Auto 3/5/Smasher use: it draws a grey base CIRCLE (`rad`) with the
				// grey barrel above it AND, being non-`ring`, draws in render.js's POST-body pass
				// (over the triangle) with the barrel tracking `canDir` - the "grey circle, then
				// grey rectangle on top ... drawn ON TOP of the body" the issue asks for, and the
				// aim-tracking half of matching Auto Smasher. height 55 x 0.46667 = 25.667, width
				// 29.4 x 0.46667 = 13.72, base rad 25 x 0.46667 = 11.667 (drawn 25 du disc),
				// distance 60 du x 0.46667 = 28 (mount = distance x 1.2 = 33.6 units = 60 du).
				// The server orders its turret cannons FIRST so canDir[0..2] feed these turrets
				// (see the server entry).
				cannons: [0, 1, 2].map(i => ({
					type: 0, height: 56, width: 33.32, offx: 0, offdir: Math.PI * 2 * i / 3 + Math.PI / 3, open: 0, trapLauncher: true
				})),
				turrets: [0, 1, 2].map(i => ({
					type: 0, height: 25.667, width: 13.72, offx: 0, offdir: Math.PI * 2 * i / 3, open: 0, rad: 11.667, distance: 28
				})),
				body: { shape: 3, sides: 3 }   // Defender.ts: sides 3 (plan.md R6)
			},
			// Reuses Overlord's own 4-barrel geometry verbatim (diepcustom FallenOverlord.ts
			// iterates TankDefinitions[Tank.Overlord].barrels directly) - only the SERVER stats
			// (reload/speed/damage/pene) are boss-boosted, plan.md X1. FallenOverlord.ts does NOT
			// override sizeFactor - it just scales like an ordinary tank (this.scale(1.01^74)), so
			// its barrels convert on the ordinary 0.7 axis: 70x0.7=49, 42x0.7=29.4 (plan.md R2/R3
			// - was on the wrong 0.56 axis before).
			"Fallen Overlord": {
				cannons: [0, 1, 2, 3].map(i => ({
					type: 2, height: 49, width: 29.4, offx: 0, offdir: Math.PI * i / 2, open: 0, trapezoidDirection: false
				})),
				body: { shape: 0 }
			},
			// Reuses Booster's own 5-barrel geometry verbatim (diepcustom FallenBooster.ts
			// iterates TankDefinitions[Tank.Booster].barrels directly) - same reasoning as Fallen
			// Overlord above. FallenBooster.ts does NOT override sizeFactor either, so these
			// convert on the ordinary 0.7 axis: 95x0.7=66.5, 70x0.7=49, 80x0.7=56, width 42x0.7=29.4
			// (plan.md R2/R3, was 0.56 before).
			"Fallen Booster": {
				cannons: [
					{ type: 0, height: 66.5, width: 29.4, offx: 0, offdir: 0, open: 0 },
					{ type: 0, height: 49, width: 29.4, offx: -6, offdir: -Math.PI - .65, open: 0 },
					{ type: 0, height: 49, width: 29.4, offx: 6, offdir: -Math.PI + .65, open: 0 },
					{ type: 0, height: 56, width: 29.4, offx: -5, offdir: -Math.PI - .35, open: 0 },
					{ type: 0, height: 56, width: 29.4, offx: 5, offdir: -Math.PI + .35, open: 0 }
				],
				body: { shape: 0 }
			},
			// PENDING #28. Arena Closer IS `TankDefinitions.json` id 16 (plan.md R3 - it does have a
			// diep source, the "no counterpart" call in this file's top comment was wrong for this
			// class): one barrel, size 75, width 42, sides 1, an ordinary `bullet` - diep's real
			// barrel is a plain rectangle, not the flared muzzle the old wiki-trivia guess drew
			// (diep_wiki's "shortest and widest cannons" was a qualitative description, not a shape
			// spec). ArenaCloser.ts scales like an ordinary tank (no sizeFactor override), so this
			// converts on the same 0.7 axis as everything else: 75x0.7=52.5, 42x0.7=29.4.
			// Body is shape 0 (a plain circle, Drawings.body[0]) - diep_wiki: "a large yellow
			// circular base". PENDING #51 flagged this as unsatisfactory when it still copied the
			// boss/Dominator convention's shape 1 (Drawings.body[1] is a rounded RECTANGLE, not a
			// circle - a real rendering bug, not a design placeholder). Summoner and the Dominator
			// variants keep shape 1 on purpose (their own bodies, not reopened here).
			"Arena Closer": {
				cannons: [
					{
						type: 0,
						height: 52.5,
						width: 29.4,
						offx: 0,
						offdir: 0,
						open: 0
					}
				],
				body: {
					shape: 0
				}
			},
			// PENDING #27/#51. A Dominator is a stationary tank (lib/gameAI.js's CONFIG.DOMINATOR),
			// drawn as a plain circle (shape 0, Drawings.body[0]) rather than an ordinary tank's
			// octagon - diepcustom's Dominator.ts states `sides: 1`, the same circle TankDefinitions
			// gives Arena Closer (plan.md Step 11; was shape 1, a rounded rectangle, the same
			// boss-body stand-in PENDING #51 flagged as unsatisfactory). Every cannon's client
			// `height` is set equal to its own server `canonLength` (a small, ordinary muzzle-tip
			// gap once run through test/tanks.js's *.93 check - no whitelist entry needed, unlike
			// Summoner's).
			// TankDefinitions.json id45 (plan.md R3): one barrel, size 80, width ~35, sizeRatio 1.
			// Dominator.ts scales like an ordinary tank (no sizeFactor override), so this converts
			// on the ordinary 0.7 axis: 80x0.7=56, 35x0.7=24.5 - was a hand-tuned guess before R3
			// found the real source.
			// Z-ORDER (B2): dombase (the dark hex) at the bottom, then the grey barrels, then the
			// cosmetic `dompronounced` trapezoid, then the circular body over the top of all of them
			// - the ordinary tank order, NOT the `aboveBody: true` these three used to carry. Every
			// Dominator reference render (Trapper_dominator_tank_2.webp, Gunner_dominator_tank_2.webp,
			// Dominator_tank_4.webp) shows the WHOLE grey assembly - barrels and trapezoid alike -
			// emerging from under the circular body and clipped by it, with the circle drawn unbroken
			// on top and only the hex's points visible behind. `dompronounced` moved under the body
			// with the barrels (render.js's draw sequence, Drawings.dompronounced); the "sits above
			// the body" it carried before contradicted these renders.
			"Destroyer Dominator": {
				// a Dominator's possessed HUD has no selectable stat row/points 
				// read by Ui#upgrade()'s own early-return, not by drawAll() with an empty array
				hideStats: true,
				// preAddon "dombase" (plan.md R4) - mirrors the server's static hex guard.
				guards: [{ sizeRatio: 1.24, sides: 6, rate: 0, phase: 0 }],
				// postAddon "dompronounced" (plan.md E2, diepcustom Addons.ts's PronouncedDomAddon)
				// - Destroyer + Gunner Dominator only, NOT Trapper.
				dompronounced: true,
				cannons: [
					{
						type: 0,
						height: 56,
						width: 24.5,
						offx: 0,
						offdir: 0,
						open: 0
					}
				],
				body: {
					shape: 0
				}
			},
			// TankDefinitions.json id46 (plan.md R3): three FORWARD barrels (diep's own angle 0 for
			// all three) - not the evenly-spaced 120-degree ring diep_wiki's paraphrase led this
			// file to draw before the real source was found. They're differentiated by a lateral
			// offx (-6/+6/0, diep's own `offset`), not by angle. Dominator.ts scales like an
			// ordinary tank (no sizeFactor override), so height/width convert on the ordinary 0.7
			// axis: 75x0.7=52.5, 80x0.7=56 (centre), width 17.5x0.7=12.25.
			"Gunner Dominator": {
				hideStats: true, // see Destroyer Dominator's own note
				// preAddon "dombase" (plan.md R4) - mirrors the server's static hex guard.
				guards: [{ sizeRatio: 1.24, sides: 6, rate: 0, phase: 0 }],
				// postAddon "dompronounced" (plan.md E2) - see Destroyer Dominator's own note.
				dompronounced: true,
				cannons: [
					{ type: 0, height: 52.5, width: 12.25, offx: -4.2, offdir: 0, open: 0 },
					{ type: 0, height: 52.5, width: 12.25, offx: 4.2, offdir: 0, open: 0 },
					{ type: 0, height: 56, width: 12.25, offx: 0, offdir: 0, open: 0 }
				],
				body: {
					shape: 0
				}
			},
			// TankDefinitions.json id47 (plan.md R3): eight launchers at i x PI/4 (diep's own real
			// angles, matches what this file already drew), size 60 width 21, drawn like Trapper's
			// own trap barrel (type 1, the same openlength/open shape). Dominator.ts scales like an
			// ordinary tank (no sizeFactor override), so height/width convert on the ordinary 0.7
			// axis: 60x0.7=42, 21x0.7=14.7 - was a hand-tuned guess before R3 found the real source.
			// type 0 + trapLauncher (plan.md A3) - see Trapper above.
			"Trapper Dominator": {
				hideStats: true, // see Destroyer Dominator's own note
				// preAddon "dombase" (plan.md R4) - mirrors the server's static hex guard.
				guards: [{ sizeRatio: 1.24, sides: 6, rate: 0, phase: 0 }],
				cannons: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
					type: 0,
					height: 42,
					width: 14.7,
					offx: 0,
					offdir: i * Math.PI / 4,
					open: 0,
					trapLauncher: true
				})),
				body: {
					shape: 0
				}
			},
			// The 16 tanks plan.md T2 adds. Smasher/Landmine/Auto Smasher/Spike's `guards`
			// (plan.md R4) mirror the server rows verbatim - Drawings.guards draws them as a
			// spinning outline n-gon, before the body so the body sits on top.
			// statMax (plan.md C3) is an 8-length array in the SERVER's wire index order
			// (entities/Player.js's `this.up`: MSpeed/Reload/BSpeed/BPene/BDamage/BodyDam/HpUp/
			// HpRegan), mirrored here verbatim - ui.js's drawAll()/statCap() translate it into
			// panel row order via CONST.UP_ORDER, the same table the server's own switch(data)
			// index space is defined against. Was missing client-side entirely, so the upgrade
			// panel always fell back to a uniform 7-segment bar regardless of this class's real
			// 0/10 caps.
			"Smasher": {
				cannons: [],
				guards: [{ sizeRatio: 1.15, sides: 6, rate: 0.1, phase: 0 }],
				statMax: [10, 0, 0, 0, 0, 10, 10, 10],
				body: { shape: 0 }
			},
			"Landmine": {
				cannons: [],
				guards: [
					{ sizeRatio: 1.15, sides: 6, rate: 0.1, phase: 0 },
					{ sizeRatio: 1.15, sides: 6, rate: 0.05, phase: 0 }
				],
				statMax: [10, 0, 0, 0, 0, 10, 10, 10],
				body: { shape: 0 }
			},
			"Auto Smasher": {
				cannons: [],
				guards: [{ sizeRatio: 1.15, sides: 6, rate: 0.1, phase: 0 }],
				turrets: [{ type: 0, height: 38.5, width: 20.58, offx: 0, offdir: 0, open: 0, rad: 18 }],
				statMax: [10, 10, 10, 10, 10, 10, 10, 10],
				body: { shape: 0 }
			},
			"Spike": {
				cannons: [],
				guards: [
					{ sizeRatio: 1.3, sides: 3, rate: 0.17, phase: 0 },
					{ sizeRatio: 1.3, sides: 3, rate: 0.17, phase: Math.PI / 3 },
					{ sizeRatio: 1.3, sides: 3, rate: 0.17, phase: Math.PI / 6 },
					{ sizeRatio: 1.3, sides: 3, rate: 0.17, phase: Math.PI / 2 }
				],
				statMax: [10, 0, 0, 0, 0, 10, 10, 10],
				body: { shape: 0 }
			},
			"Hunter": {
				cannons: [
					{ type: 0, height: 77, width: 29.4, offx: 0, offdir: 0, open: 0 },
					{ type: 0, height: 66.5, width: 39.69, offx: 0, offdir: 0, open: 0 }
				],
				body: { shape: 0 }
			},
			"Predator": {
				cannons: [
					{ type: 0, height: 77, width: 29.4, offx: 0, offdir: 0, open: 0 },
					{ type: 0, height: 66.5, width: 39.69, offx: 0, offdir: 0, open: 0 },
					{ type: 0, height: 56, width: 49.98, offx: 0, offdir: 0, open: 0 }
				],
				body: { shape: 0 }
			},
			"Streamliner": {
				cannons: [
					{ type: 0, height: 77, width: 29.4, offx: 0, offdir: 0, open: 0 },
					{ type: 0, height: 70, width: 29.4, offx: 0, offdir: 0, open: 0 },
					{ type: 0, height: 63, width: 29.4, offx: 0, offdir: 0, open: 0 },
					{ type: 0, height: 56, width: 29.4, offx: 0, offdir: 0, open: 0 },
					{ type: 0, height: 49, width: 29.4, offx: 0, offdir: 0, open: 0 }
				],
				body: { shape: 0 }
			},
			"Stalker": {
				cannons: [
					{ type: 2, height: 84, width: 29.4, offx: 0, offdir: 0, open: 0, trapezoidDirection: true }
				],
				body: { shape: 0 }
			},
			// `ring: true`/`distance: 28` (plan.md R9) - see the server's own Auto 3/5 comment.
			// The base circle draws separately, under the body (Drawings.ringBase, render.js's
			// pre-body pass); this entry's own `type: 0` draw only puts the barrel down, over
			// the body, per diepcustom's own z-order for a ring turret (`showsAboveParent`
			// XOR'd OFF for these, unlike a centered Auto Hover/Gunner/Trapper/Smasher turret).
			"Auto 3": {
				cannons: [],
				turrets: [0, 1, 2].map(i => ({
					type: 0, height: 38.5, width: 20.58, offx: 0, offdir: i * Math.PI * 2 / 3, open: 0, rad: 18, distance: 28, ring: true
				})),
				body: { shape: 0 }
			},
			"Auto 5": {
				cannons: [],
				turrets: [0, 1, 2, 3, 4].map(i => ({
					type: 0, height: 38.5, width: 20.58, offx: 0, offdir: i * Math.PI * 2 / 5, open: 0, rad: 18, distance: 28, ring: true
				})),
				body: { shape: 0 }
			},
			// diep's own barrel order lists the 5 fanned pairs (widest angle first) then the
			// centre barrel LAST (`TankDefinitions.json`'s Spread Shot id42) - our own array keeps
			// the centre at index 5, so the length ramp below is length-matched by angle magnitude,
			// not raw diep array index (plan.md C2). Centre (diep barrel#10, size 95) is the only
			// one on diep's wider `width 42`; the 10 fanned barrels share `width 29.4`.
			// diep's own barrel order (TankDefinitions.json id42) is the fanned pairs, outermost
			// first, then the centre LAST - array order = draw order (plan.md A1/Part B), so the
			// centre barrel lands on top of the whole fan instead of sitting in the middle.
			"Spread Shot": {
				cannons: [
					{ type: 0, height: 45.5, width: 20.58, offx: 0, offdir: 1.309, open: 0 },
					{ type: 0, height: 45.5, width: 20.58, offx: 0, offdir: -1.309, open: 0 },
					{ type: 0, height: 49.7, width: 20.58, offx: 0, offdir: 1.0472, open: 0 },
					{ type: 0, height: 49.7, width: 20.58, offx: 0, offdir: -1.0472, open: 0 },
					{ type: 0, height: 53.9, width: 20.58, offx: 0, offdir: 0.7854, open: 0 },
					{ type: 0, height: 53.9, width: 20.58, offx: 0, offdir: -0.7854, open: 0 },
					{ type: 0, height: 58.1, width: 20.58, offx: 0, offdir: 0.5236, open: 0 },
					{ type: 0, height: 58.1, width: 20.58, offx: 0, offdir: -0.5236, open: 0 },
					{ type: 0, height: 62.3, width: 20.58, offx: 0, offdir: 0.2618, open: 0 },
					{ type: 0, height: 62.3, width: 20.58, offx: 0, offdir: -0.2618, open: 0 },
					{ type: 0, height: 66.5, width: 29.4, offx: 0, offdir: 0, open: 0 }
				],
				body: { shape: 0 }
			},
			"Gunner Trapper": {
				cannons: [
					{ type: 0, height: 52.5, width: 14.7, offx: 10, offdir: 0, open: 0 },
					{ type: 0, height: 52.5, width: 14.7, offx: -10, offdir: 0, open: 0 },
					{ type: 0, height: 42, width: 38.22, offx: 0, offdir: Math.PI, open: 0, trapLauncher: true }
				],
				body: { shape: 0 }
			},
			"Tri-Trapper": {
				cannons: [0, 1, 2].map(i => ({
					type: 0, height: 42, width: 29.4, offx: 0, offdir: i * Math.PI * 2 / 3, open: 0, trapLauncher: true
				})),
				body: { shape: 0 }
			},
			"Skimmer": {
				// preAddon "launcher" (plan.md R4) - the body-mounted nub under the barrel.
				launcher: true,
				cannons: [
					{ type: 0, height: 56, width: 49.98, offx: 0, offdir: 0, open: 0 }
				],
				body: { shape: 0 }
			},
			"Factory": {
				cannons: [
					{ type: 2, height: 49, width: 29.4, offx: 0, offdir: 0, open: 0, trapezoidDirection: false }
				],
				body: { shape: 1 }
			},
			"Mothership": {
				// draw-type 2 (trapezoid) + the half-step offset (plan.md R6) - see the
				// server's own Mothership comment for both. Body shape 3 = a generic n-gon
				// (`body.sides`, plan.md R6), TankDefinitions.json id27's own `sides: 16`.
				cannons: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(i => ({
					type: 2, height: 42, width: 7.35, offx: 0, offdir: Math.PI / 16 + i * Math.PI * 2 / 16, open: 0, trapezoidDirection: false
				})),
				body: { shape: 3, sides: 16 }
			}
		} :
		///SERVER///
		/*
			Every number below is denominated against config.REF_TICK_MS (40ms), not the server's
			actual TICK_MS - see lib/tick.js. Three columns are worth naming because they are the
			ones a reader is most likely to try to "fix":

			`speed` is a bullet's CRUISE THRUST, an acceleration per reference tick squared (except
			for a trap, type 2, whose own baseAccel is 0 - see below). It is consumed by
			entities/Bullet.js's motion tail as tick.quadratic(), not tick.perTick() - the tail adds
			it to a velocity and then integrates that velocity into a position, i.e. it integrates
			twice over ticks. MEASUREMENTS.md's M1 is resolved (plan.md Step 9): diep's own bullets
			DO carry drag (the same universal 0.9 as everything else, `lib/constants.js`'s
			BODY_FRICTION), so `speed` is diep's `bullet.speed` multiplier converted directly -
			`1.12 x diep bullet.speed`, since `20 du/tick x 0.56 x 0.1 = 1.12` is the identity that
			makes it so - with nothing baked in to divide back out at any consumption site.
			`exitSpeed` and its SPEED_RESCALE division are RETIRED, not kept alongside: a bullet's
			one-time muzzle kick is now computed at the shoot() call site
			(entities/Player.js) from `speed` itself plus diep's own flat `+30 du/tick` (our units
			`+16.8`), with a drone (type 1/1.1) dividing the whole kick by 3 and a trap (type 2)
			instead halving `speed` before the same `+16.8` - see that site's own comment for the
			three formulas and why they differ (Bullet.ts/Drone.ts/Trap.ts).

			`rand` is angular scatter, diep's own `scatterRate x 0.174533` (5 degrees in radians,
			MEASUREMENTS.md's M2, plan.md Step 8) - `dir +- rand/2` at the shoot() site. The same
			`scatterRate` also back-derives the muzzle kick's own speed jitter there
			(`can.rand / 0.174533`), so the column carries both rather than doubling it.

			`life` is now a REQUIRED per-cannon column (plan.md Step 9): diep's own
			`round(lifeLength x 75)` reference ticks for an ordinary bullet/trap/swarm barrel,
			`round(lifeLength x 88)` for a drone (type 1/1.1) barrel, and the `-1` permanent-drone
			sentinel where diep's own lifeLength is `-1` (unchanged, checked directly by
			entities/Bullet.js rather than going through tick.ticks()). A trap barrel's `life` also
			drives its arming window (`life >> 3` real ticks, during which it collides with nothing -
			diep's Trap.ts `onlySameOwnerCollision`, simplified since this engine has no other
			same-owner physical blocking for it to preserve).

			`back` is RECOIL, and it is the one column here that is fully derived rather than tuned:
			it is diep's own per-shot recoil table (physics.html's "Tanks Recoil", in GRID SQUARES)
			run through `back = gu x 28 x (1-F)/F`, F being the TANK friction in
			public/SHARE/Physics.js. That expression is just the inverse of a one-shot impulse's
			total displacement under the recurrence `v *= F; x += v` (which sums to v0 x F/(1-F)),
			so at F = 10/11 it collapses to a flat `back = gu x 2.8` and EVERY entry below is
			readable as its diep gu value x 2.8: 0.28 is 0.1 gu, 1.12 is Basic's 0.4 gu, 16.8 is
			Destroyer's 6 gu. Divide by 2.8 to read the table back.

			THE ENTRIES BELOW DID NOT USED TO MATCH THAT DESCRIPTION and were rescaled in one pass.
			The identity above is right; what had been written into the literals was
			`barrel.recoil x 2.8` off TankDefinitions.json's raw `recoil` field, instead of
			`gu_value x 2.8` off physics.html's grid-square figure. Those are not the same number:
			Barrel.ts:153 spends recoil as `addVelocity(angle + PI, recoil * 2)`, i.e. an impulse of
			`2 x recoil` du/tick, which under diep's own `v *= 0.9` decay travels `20 x recoil` du =
			`0.4 x recoil` grid squares - so the grid-square figure IS `recoil x 0.4` and the raw
			field ran every entry 2.5x hot. All 70 non-zero literals were divided by 2.5, which puts
			them exactly on the three worked examples this comment already gave (Basic 2.8 -> 1.12,
			Destroyer 42 -> 16.8), and an audit of all 39 classes that map 1:1 onto a diep definition
			now agrees barrel-for-barrel. The anchor that settles which axis is right, independently
			of physics.html: diep's TankBody carries the PhysicsGroup default pushFactor 8, and
			entities/Player.js has always stated that same body knockback as 4.48 world units -
			8 x 0.56, the plain absolute-length conversion. An impulse column is a length column.

			One casualty worth knowing about: Annihilator's `back` was a deliberately off-table 4 gu
			(PENDING #15/#16), but the literal had since been overwritten by the raw-recoil pass, so
			the rescale lands it on diep's own 6.8 gu rather than restoring our 4. Left at diep's.

			If the tank F ever moves again,
			this whole column moves with it - it does NOT track whatever MEASUREMENTS.md's M1 finds
			about bullets, because recoil is an impulse on the TANK. (plan.md step 3.) The gu
			values are NOT all diep's, though the conversion is: Annihilator's 4 against diep's 6.8
			is deliberately off-table, same call as its reload (PENDING #15/#16), and about a third
			of the roster carries a gu we tuned ourselves rather than the table's. The per-class
			cross-check of which is which is in plan.md's step-3 record - do not "finish the job"
			off physics.html without reading it, that is a balance call, not a conversion.

			`weight` is KNOCKBACK - how far this bullet shoves the TANK it hits - and like `back` it
			is now fully derived rather than tuned: it is diep's own "Tanks Knockbackfactor" table
			(physics.html, in GRID SQUARES per loop of contact) run through `weight = gu x 5.25`.
			That factor is the same one-shot-impulse identity `back` uses. entities/Player.js's
			bullet arm turns the column into an impulse as `weight / 3 * 1.6` = `weight x 0.53333`,
			and a one-shot impulse on tank velocity displaces `v0 x F/(1-F)` = `10 x v0` units at the
			tank F = 10/11, so the round trip is `gu x 5.25 x 0.53333 x 10 / 28 = gu`. Every entry
			below therefore divides by 5.25 straight back into diep's table: 3.5 is Basic's 0.666 gu,
			1.05 is Destroyer's 0.2 gu, 4.2 is the 0.8 gu every drone row carries, 0.525 is
			Annihilator's 0.1 gu. Note what that does to the shape of the roster - diep INVERTS
			knockback against damage, so Destroyer and Annihilator sit at the bottom of this column
			and Basic near the top. Like `back`, this tracks the TANK friction and not whatever
			MEASUREMENTS.md's M1 finds about bullet motion. Seven classes have no row in diep's table
			at all (Cyclone, Submachine, Auto Hover, Fortress, Summoner, Rocket, and plain Gunner,
			which diep has but the table omits); each inherits its nearest mapped relative and says
			so at its own entry.

			`push` is NOT knockback and is not diep's: it is the bullet's own bounce off whatever it
			hit, read only by entities/Bullet.js's three self-push sites. It carries what `weight`
			held before `weight` became diep's table, because the two were one overloaded field and
			only the knockback half had a reference behind it. For a spend-down bullet the bounce is
			cosmetic (it is destroyed the same tick and only coasts through its fade), but for a
			drone - whose pene is a health pool - it is the separation impulse that keeps a swarm
			from stacking, which is why it still exists.

			`damage` and `pene` are diep's own raw absolute figures now (plan.md chunk 1, D1/D5) -
			Basic's own barrel is diep's literal `(7 + 3P) x bulletDefinition.damage` / `(1.5P + 2) x
			bulletDefinition.health` at P=0 and bulletDefinition.{damage,health}=1, i.e. exactly 7 and
			2, with every other cannon below still that same `diep's own multiple x` this anchor it
			always was - only the anchor itself moved (was 4.84848/1.7, an 0.6926x/0.85x stand-in scale
			adopted back when HP was on a different axis than damage; HP has been diep's raw scale for
			a while and the damage/pene axis is what just caught up to it). `entities/Player.js`'s own
			`this.damage` (tank body ram) and `lib/damage.js`'s common() table are on this same raw
			axis now too - the three used to disagree by the same 1.44378x/1.17647x this fixes.
		*/
		{
			"Basic": new function () {
				this.screen = 1408;
				this.cannons = [];
				this.cannons[0] = new function () {
					this.reload = 15;
					this.offTime = 0;
					this.type = 0;
					///
					this.offdir = 0;
					this.offx = 0;
					this.canonLength = 66.5;   // diep barrel.size 95 x 0.70 (TankDefinitions.json id0, plan.md C2/R1)
					this.life = 75;   // diep bullet.lifeLength 1 x 75 (plan.md Step 9)
					this.rand = 0.174533;   // diep scatterRate 1 (plan.md Step 8)
					///
					this.speed = 1.12;   // diep bullet.speed 1 x 1.12 (plan.md Step 9)
					this.pene = 2;
					this.peneMult = 1;
					this.damage = 7;
					this.size = 14.7;   // (barrel.width 42 / 2) x bullet.sizeRatio 1 x 0.70 (Bullet.ts:77, plan.md B2/C2/R1)
					///
					this.weight = 3.5;   // diep 0.666 gu
					this.push = 0.27426;
					this.back = 1.12;
				}
			},
			"Flank Guard": new function () {
				this.screen = 1408;
				this.cannons = [];
				this.cannons[0] = new function () {
					this.reload = 15;
					this.offTime = 0;
					this.type = 0;
					///
					this.offdir = 0;
					this.offx = 0;
					this.canonLength = 66.5;
					this.life = 75;
					this.rand = 0.174533;
					///
					this.speed = 1.12;
					this.pene = 2;
					this.damage = 7;
					this.size = 14.7;
					///
					this.weight = 3.5;   // diep 0.666 gu
					this.push = 0.27426;
					this.back = 1.12;
				}
				this.cannons[1] = {
					reload: 15,
					offTime: 0,
					///
					offdir: Math.PI,
					offx: 0,
					canonLength: 56,
					life: 75,
					rand: 0.174533,
					///
					speed: 1.12,
					pene: 2,
					damage: 7,
					size: 14.7,
					///
					weight: 3.5,   // diep lists Flank Guard once, so the rear barrel is 0.666 gu too
					push: 0.45709,
					back: 1.12
				};
			},
			"Twin": new function () {
				this.screen = 1408;
				this.cannons = [];
				this.cannons[1] = new function () {
					this.reload = 15;
					this.offTime = 0;
					///
					this.offdir = 0;
					this.offx = -18.2;   // diep barrel.offset -26 x 0.70 (plan.md Part B row 1)
					this.canonLength = 66.5;
					this.life = 75;
					this.rand = 0.174533;
					///
					this.speed = 1.12;
					this.pene = 1.8;
					this.peneMult = 1;
					this.damage = 4.55;
					this.size = 14.7;
					///
					this.weight = 2.275;   // diep 0.4333 gu
					this.push = 0.27426;
					this.back = 0.84;
				};
				this.cannons[0] = new function () {
					this.reload = 15;
					this.offTime = 0.5;
					///
					this.offdir = 0;
					this.offx = 18.2;   // diep barrel.offset 26 x 0.70 (plan.md Part B row 1)
					this.canonLength = 66.5;
					this.life = 75;
					this.rand = 0.174533;
					///
					this.speed = 1.12;
					this.pene = 1.8;
					this.peneMult = 1;
					this.damage = 4.55;
					this.size = 14.7;
					///
					this.weight = 2.275;   // diep 0.4333 gu
					this.push = 0.27426;
					this.back = 0.84;
				};
			},
			"Machine Gun": new function () {
				this.screen = 1408;
				this.cannons = [];
				this.cannons[0] = new function () {
					this.reload = 8;
					this.offTime = 0;
					///
					this.offdir = 0;
					this.offx = 0;
					this.canonLength = 66.5;
					this.life = 75;
					this.rand = 0.523599;   // diep scatterRate 3
					///
					this.speed = 1.12;
					this.pene = 2;
					this.damage = 4.9;
					this.size = 14.7;
					///
					this.weight = 2.45;   // diep 0.4666 gu
					this.push = 0.27426;
					this.back = 1.12;
				}
			},
			"Sniper": new function () {
				this.screen = BASE_SCREEN / 0.9;   // diep fieldFactor 0.9 (TankDefinitions.json)
				this.cannons = [];
				this.cannons[0] = new function () {
					this.reload = 23;
					this.offTime = 0;
					///
					this.offdir = 0;
					this.offx = 0;
					this.canonLength = 77;
					this.life = 75;
					this.rand = 0.05236;   // diep scatterRate 0.3
					///
					this.speed = 1.68;
					this.pene = 2;
					this.damage = 7;
					this.size = 14.7;
					///
					this.weight = 3.5;   // diep 0.666 gu
					this.push = 0.54851;
					this.back = 3.36;
				}
			},
			///
			"Triple Shot": new function () {
				this.screen = 1408;
				this.cannons = [];
				const c = new Array(3).fill(null).map(() => ({
					reload: 15,
					offTime: 0,
					///
					offdir: 0,
					offx: 0,
					canonLength: 66.5,   // diep barrel.size 95 x 0.70 - all 3 barrels identical (plan.md C2/R1)
					life: 75,
					rand: 0.174533,
					///
					speed: 1.12,
					pene: 2,
					damage: 4.9,
					size: 14.7,
					///
					weight: 2.45,   // diep 0.4666 gu
					push: 0.45709,
					back: 1.12
				}));
				// diep barrel.angle +-pi/4, offset 0 (plan.md Part B row 2 - was +-0.4/+-6, a paraphrase)
				c[0].offdir = -Math.PI / 4;
				c[1].offdir = Math.PI / 4;
				// All three fire together. `offTime` is diep's own `barrel.delay` (a fraction of
				// the reload cycle the barrel waits before its shot), and TankDefinitions.json's
				// Triple Shot states `delay: 0` on all three barrels - the centre one carried a
				// stray .5, which staggered it half a cycle behind the wings.
				this.cannons = c;
			},
			"Twin Flank": new function () {
				this.screen = 1408;
				const c = new Array(4).fill(null).map(() => ({
					reload: 15,
					offTime: 0,
					type: 0,
					life: 75,
					///
					offdir: 0,
					offx: -18,
					canonLength: 66.5,
					rand: 0.174533,
					///
					speed: 1.12,
					pene: 2,
					damage: 3.5,
					size: 14.7,
					///
					weight: 1.75,   // diep 0.333 gu
					push: 0.27426,
					back: 1.12
				}));
				c[2].offdir = c[3].offdir = Math.PI;
				c[1].offTime = c[3].offTime = .5;
				c[1].offx = c[3].offx = 18;
				this.cannons = c;
			},
			"Quad Tank": new function () {
				this.screen = 1408;
				this.cannons = [];
				const c = new Array(4).fill(null).map(() => ({
					reload: 15,
					offTime: 0,
					///
					offdir: 0,
					offx: 0,
					canonLength: 66.5,
					life: 75,
					rand: 0.174533,
					///
					speed: 1.12,
					pene: 2,
					damage: 5.25,
					size: 14.7,
					///
					weight: 2.625,   // diep 0.5 gu
					push: 0.45709,
					back: 1.12
				}));
				c[1].offdir = Math.PI / 2; c[1].offTime = .5;
				c[2].offdir = Math.PI;
				c[3].offdir = Math.PI * 1.5; c[3].offTime = .5;
				this.cannons = c;
			},
			"Destroyer": new function () {
				this.screen = 1408;
				const c = new Array(1).fill(null).map(() => ({
					reload: 60,
					offTime: 0,
					type: 0,
					life: 75,
					///
					offdir: 0,
					offx: 0,
					canonLength: 66.5,
					rand: 0.174533,
					///
					speed: 0.784,
					pene: 4,
					damage: 21,
					size: 24.99,
					///
					weight: 1.05,   // diep 0.2 gu (Destroyer and Hybrid's bullet share the row) - the table inverts knockback against damage
					push: 0.27426,
					back: 16.8
				}));
				///
				this.cannons = c;
			},
			"Assassin": new function () {
				this.screen = BASE_SCREEN / 0.8;   // diep fieldFactor 0.8 (TankDefinitions.json)
				this.cannons = [];
				this.cannons[0] = new function () {
					this.reload = 30;
					this.offTime = 0;
					///
					this.offdir = 0;
					this.offx = 0;
					this.canonLength = 84;
					this.life = 75;
					this.rand = 0.05236;
					///
					this.speed = 1.68;
					this.pene = 2;
					this.damage = 7;
					this.size = 14.7;
					///
					this.weight = 3.5;   // diep 0.666 gu
					this.push = 0.54851;
					this.back = 3.36;
				}
			},
			"Overseer": new function () {
				this.screen = BASE_SCREEN / 0.9;   // diep fieldFactor 0.9 (TankDefinitions.json)
				this.maxDrone = 7;
				this.cannons = [];
				const c = new Array(2).fill(null).map(() => ({
					reload: 90,
					offTime: 0,
					type: 1,
					life: -1,
					auto: 1,
					///
					offdir: Math.PI / 2,
					offx: 0,
					canonLength: 49,
					rand: 0.174533,
					///
					speed: 0.896,
					pene: 4,
					damage: 4.9,
					size: 14.7,
					///
					weight: 4.2,   // diep 0.8 gu, the row every drone class shares
					push: 0.36567,
					back: 1.12
				}));
				c[1].offdir = -Math.PI / 2;
				this.cannons = c;
			},
			"Triangle": new function () {
				this.screen = 1408;
				const c = new Array(3).fill(null).map(() => ({
					reload: 15,
					offTime: 0,
					life: 38,   // diep Tri-Angle rear barrel lifeLength 0.5 x 75 (plan.md Step 9); c[0] overrides to the front's 75
					///
					offdir: 0,
					offx: 0,
					canonLength: 56,
					rand: 0.174533,
					///
					speed: 1.12,
					pene: 2,
					damage: 1.4,
					size: 14.7,
					///
					weight: 0.7,   // diep Tri-Angle (Rear Bullet) 0.1333 gu; c[0] overrides to the front row
					push: 0.45709,
					back: 2.8
				}));
				// The main cannon's length bump used to write `.height`, a client-only field
				// name the server never reads (Player.js:212 reads `canonLength`), so this
				// line was a no-op and the cannon stayed at the 58 default. test/tanks.js's
				// muzzle-tip band caught it once canonLength was corrected.
				c[0].back = 0.224; c[0].canonLength = 66.5; c[0].pene = 2; c[0].damage = 7; c[0].speed = 1.12; c[0].life = 75;
				c[0].weight = 3.5;   // diep Tri-Angle (Front Bullet) 0.666 gu
				c[1].offdir = -Math.PI - .4; c[1].offx = -5; c[1].offTime = .5;
				c[2].offdir = -Math.PI + .4; c[2].offx = 5; c[2].offTime = .5;
				///
				this.cannons = c;
			},
			"Trapper": new function () {
				this.screen = BASE_SCREEN / 0.9;   // diep fieldFactor 0.9 (TankDefinitions.json)
				this.cannons = [];
				this.cannons[0] = new function () {
					this.reload = 23;
					this.offTime = 0;
					this.type = 2;
					this.life = 600;   // diep Trapper (trap) lifeLength 8 x 75 (plan.md Step 9); arming window is life>>3, computed at spawn
					///
					this.offdir = 0;
					this.offx = 0;
					this.canonLength = 42;
					this.rand = 0.174533;
					///
					this.speed = 2.24;   // diep bullet.speed 2 x 1.12; a trap's own baseAccel is 0 (see entities/Bullet.js) - this feeds only the muzzle-kick formula
					this.pene = 4;
					this.damage = 7;
					this.size = 11.76;
					///
					this.weight = 3.5;   // diep 0.666 gu, the row every manual trap shares
					this.push = 0.27426;
					this.back = 1.12;
				}
			},
			///
			"Rocketeer": new function () {
				// diep fieldFactor 0.9 (TankDefinitions.json) - renamed from "Rocket" and
				// re-parented from Flank Guard to Destroyer, diep's real parent (plan.md T1).
				this.screen = BASE_SCREEN / 0.9;
				const c = new Array(2).fill(null).map(() => ({
					reload: 60,   // STAND-IN: diep has no Rocket class - takes Rocketeer 60 (plan.md Step 3, call 3)
					offTime: 0,
					// STAND-IN: not Rocketeer's own main barrel (type "rocket", scatter 1) but the
					// exhaust sub-barrel diepcustom/src/Entity/Tank/Projectile/Rocket.ts defines inline
					// (RocketBarrelDefinition: speed 1.5, scatterRate 5, lifeLength 0.1) - both of our
					// barrels point backwards, modelling that thruster puff, not the rocket itself
					// (plan.md Step 9).
					life: 8,
					///
					offdir: -Math.PI - .4,
					offx: -5,
					canonLength: 56,
					rand: 0.872665,
					///
					speed: 1.68,
					pene: 1.882353,
					damage: 6.125,
					size: 16,
					///
					// STAND-IN: diep has no Rocket. Both barrels point backwards (offdir ~ +-PI), so
					// this takes the rear-thruster row every mapped tank with rear barrels carries -
					// Tri-Angle/Booster/Fighter (Rear Bullet), 0.1333 gu - rather than its class-tree
					// parent Flank Guard's 0.666, which is a forward gun. May want its own tune.
					weight: 0.7,
					push: 0.91418,
					back: 0.952
				}));
				c[1].offdir = -Math.PI + .4; c[1].offx = 5;
				this.cannons = c;
			},
			"Hybrid": new function () {
				this.screen = 1408;
				this.maxDrone = 2;
				const c = new Array(1).fill(null).map(() => ({
					reload: 60,
					offTime: 0,
					type: 0,
					life: 75,
					///
					offdir: 0,
					offx: 0,
					canonLength: 66.5,
					rand: 0.174533,
					///
					speed: 0.784,
					pene: 4,
					damage: 21,
					size: 24.99,
					///
					weight: 1.05,   // diep 0.2 gu (Destroyer and Hybrid's bullet share the row) - the table inverts knockback against damage
					push: 0.27426,
					back: 16.8
				}));
				c.push({
					reload: 90,
					offTime: 0,
					type: 1.1,
					life: -1,
					auto: 1,
					///
					offdir: Math.PI,
					offx: 0,
					canonLength: 49,
					rand: 0.174533,
					///
					speed: 1.12,
					pene: 2.8,
					damage: 4.9,
					size: 14.7,
					///
					weight: 4.2,   // diep Hybrid (Drone) 0.8 gu
					push: 0.36567,
					back: 1.12
				})
				///
				this.cannons = c;
			},
			"Annihilator": new function () {
				this.screen = 1408;
				const c = new Array(1).fill(null).map(() => ({
					reload: 60,   // Step 3 call 1: diep own 60 (Destroyer reload:4 x15) - retires the old off-table 87
					offTime: 0,
					type: 0,
					life: 75,
					///
					offdir: 0,
					offx: 0,
					canonLength: 66.5,
					rand: 0.174533,
					///
					speed: 0.784,
					pene: 4,
					damage: 21,
					size: 33.81,
					///
					// diep 0.1 gu - the floor of the Knockbackfactor table (`weight`, dealt to others).
					// `back` (self-recoil) is a separate identity (plan.md C0): recoil(17) x 1.12 = 19.04.
					weight: 0.525,
					push: 0.27426,
					back: 19.04
				}));
				///
				this.cannons = c;
			},
			"Sprayer": new function () {
				// diep Sprayer (id29, plan.md Part B) is a real 2-barrel class, not a 5-barrel
				// Streamliner fake: [0] an inner straight barrel drawn/fired first (under), [1] a
				// Machine Gun-style trapezoid on top, its visible length (66.5) shorter than the
				// straight barrel underneath (77) so ~10.5 units of the inner barrel peek out.
				this.screen = BASE_SCREEN;   // diep fieldFactor 1 (default, not in the non-default table)
				this.cannons = [
					{
						reload: 15,   // diep barrel[0] reload 1 x 15
						offTime: 0.5,   // diep barrel[0].delay
						offdir: 0,
						offx: 0,
						canonLength: 77,   // diep barrel[0].size 110 x 0.70
						life: 75,
						rand: 0.174533,   // diep barrel[0].bullet.scatterRate 1
						speed: 1.12,
						pene: 2,   // diep barrel[0].bullet.health 1 x 2
						damage: 0.7,   // diep barrel[0].bullet.damage 0.1 x 7
						size: 10.29,   // (barrel[0].width 42 / 2) x sizeRatio 0.7 x 0.70
						weight: 0.35,   // diep Sprayer (Small Bullet) 0.0666 gu - no diep Knockbackfactor
						push: 0.45709,  // row distinguishes the two barrels, so both borrow this one
						back: 0   // diep barrel[0].recoil 0
					},
					{
						reload: 8,   // diep barrel[1].reload 0.5 x 15 = 7.5, round(7.5) = 8
						offTime: 0,   // diep barrel[1].delay 0
						offdir: 0,
						offx: 0,
						canonLength: 66.5,   // diep barrel[1].size 95 x 0.70
						life: 75,
						rand: 0.523599,   // diep barrel[1].bullet.scatterRate 3
						speed: 1.12,
						pene: 2,   // diep barrel[1].bullet.health 1 x 2
						damage: 4.9,   // diep barrel[1].bullet.damage 0.7 x 7
						size: 14.7,   // (barrel[1].width 42 / 2) x sizeRatio 1 x 0.70
						weight: 0.35,
						push: 0.45709,
						back: 1.12   // diep barrel[1].recoil 1 x 1.12
					}
				];
			},
			"Ranger": new function () {
				this.screen = BASE_SCREEN / 0.7;   // diep fieldFactor 0.7 (TankDefinitions.json)
				this.cannons = [];
				this.cannons[0] = new function () {
					this.reload = 30;
					this.offTime = 0;
					///
					this.offdir = 0;
					this.offx = 0;
					this.canonLength = 84;
					this.life = 75;
					this.rand = 0.05236;
					///
					this.speed = 1.68;
					this.pene = 2;
					this.damage = 7;
					this.size = 14.7;
					///
					this.weight = 3.5;   // diep 0.666 gu
					this.push = 0.63992;
					this.back = 3.36;
				}
			},
			"Triplet": new function () {
				this.screen = 1408;
				this.cannons = [];
				const c = new Array(3).fill(null).map(() => ({
					reload: 15,
					offTime: .5,   // diep barrel[0]/[1] delay 0.5 (barrel[2], the centre, overrides to 0 below)
					///
					offdir: 0,
					offx: 0,
					canonLength: 56,
					life: 75,
					rand: 0.174533,
					///
					speed: 1.12,
					pene: 1.4,
					damage: 4.2,
					size: 14.7,
					///
					weight: 2.1,   // diep 0.4 gu
					push: 0.45709,
					back: 0.56
				}));
				c[0].offx = 18.2;   // diep barrel.offset 26 x 0.70
				c[1].offx = -18.2;
				c[2].canonLength = 66.5; c[2].offTime = 0;
				this.cannons = c;
			},
			"Triple Twin": new function () {
				this.screen = 1408;
				const c = new Array(6).fill(null).map(() => ({
					reload: 15,
					offTime: 0,
					type: 0,
					life: 75,
					///
					offdir: 0,
					offx: -18.2,   // diep barrel.offset -26 x 0.70
					canonLength: 66.5,
					rand: 0.174533,
					///
					speed: 1.12,
					pene: 2,
					damage: 3.5,
					size: 14.7,
					///
					weight: 1.75,   // diep 0.333 gu
					push: 0.27426,
					back: 1.12
				}));
				c[2].offdir = c[3].offdir = Math.PI * 2 / 3;
				c[4].offdir = c[5].offdir = Math.PI * 4 / 3;
				c[1].offTime = c[3].offTime = c[5].offTime = .5;
				c[1].offx = c[3].offx = c[5].offx = 18.2;
				this.cannons = c;
			},
			"Penta Shot": new function () {
				this.screen = 1408;
				this.cannons = [];
				const c = new Array(5).fill(null).map(() => ({
					reload: 15,
					offTime: 0,
					///
					offdir: 0,
					offx: 0,
					canonLength: 56,
					life: 75,
					rand: 0.174533,
					///
					speed: 1.12,
					pene: 2,
					damage: 3.85,
					size: 14.7,
					///
					weight: 1.925,   // diep 0.3666 gu
					push: 0.45709,
					back: 0.784
				}));
				// diep barrel angles +-pi/4 (outer) / +-pi/8 (inner), offset 0 (plan.md Part B row
				// 2 - was +-0.6/+-0.3, +-7/+-3, a paraphrase); fire delays outer 0.66 -> inner 0.33
				// -> centre 0 (id14).
				c[0].offdir = Math.PI / 4; c[0].offTime = .66;
				c[1].offdir = -Math.PI / 4; c[1].offTime = .66;
				c[2].offdir = Math.PI / 8; c[2].canonLength = 66.5; c[2].offTime = .33;
				c[3].offdir = -Math.PI / 8; c[3].canonLength = 66.5; c[3].offTime = .33;
				c[4].canonLength = 77;
				this.cannons = c;
			},
			"Octo Tank": new function () {
				this.screen = 1408;
				this.cannons = [];
				const c = new Array(8).fill(null).map(() => ({
					reload: 15,
					offTime: 0,
					///
					offdir: 0,
					offx: 0,
					canonLength: 66.5,
					life: 75,
					rand: 0.174533,
					///
					speed: 1.12,
					pene: 2,
					damage: 4.55,
					size: 14.7,
					///
					weight: 2.275,   // diep 0.4333 gu
					push: 0.45709,
					back: 1.12
				}));
				c[1].offdir = Math.PI * 1 / 4; c[1].offTime = .5;
				c[2].offdir = Math.PI * 2 / 4;
				c[3].offdir = Math.PI * 3 / 4; c[3].offTime = .5;
				c[4].offdir = Math.PI;
				c[5].offdir = Math.PI * 5 / 4; c[5].offTime = .5;
				c[6].offdir = Math.PI * 6 / 4;
				c[7].offdir = Math.PI * 7 / 4; c[7].offTime = .5;
				this.cannons = c;
			},
			"Cyclone": new function () {
				this.screen = 1408;
				this.cannons = new Array(10).fill(null).map(() => ({
					reload: 15,   // STAND-IN: diep has no Cyclone - takes Octo Tank 15 (plan.md Step 3, call 3)
					offTime: 0,
					///
					offdir: 0,
					offx: 0,
					canonLength: 52,
					life: 75,   // STAND-IN: diep has no Cyclone - takes Octo Tank's bullet.speed/scatterRate/lifeLength (plan.md Step 9)
					rand: 0.174533,
					///
					speed: 1.12,
					pene: 1.176471,
					damage: 6.475009,
					size: 12,
					///
					// STAND-IN: diep has no Cyclone. It takes Octo Tank's 0.4333 gu rather than its
					// class-tree parent Quad Tank's 0.5, because the table's own trend is monotone in
					// barrel count (Quad 4 -> 0.5, Octo 8 -> 0.4333) and Cyclone has ten. May want its
					// own tune.
					weight: 2.275,
					push: 0.45709,
					back: 0
				}));
				this.cannons[1].offdir = Math.PI * .2; this.cannons[1].offTime = .5;
				this.cannons[2].offdir = Math.PI * .4; this.cannons[2].offTime = 0;
				this.cannons[3].offdir = Math.PI * .6; this.cannons[3].offTime = .5;
				this.cannons[4].offdir = Math.PI * .8; this.cannons[4].offTime = 0;
				this.cannons[5].offdir = Math.PI * 1; this.cannons[5].offTime = .5;
				this.cannons[6].offdir = Math.PI * 1.2; this.cannons[6].offTime = 0;
				this.cannons[7].offdir = Math.PI * 1.4; this.cannons[7].offTime = .5;
				this.cannons[8].offdir = Math.PI * 1.6; this.cannons[8].offTime = 0;
				this.cannons[9].offdir = Math.PI * 1.8; this.cannons[9].offTime = .5;
			},
			"Booster": new function () {
				this.screen = 1408;
				const c = new Array(5).fill(null).map(() => ({
					reload: 15,
					offTime: 0,
					///
					offdir: 0,
					offx: 0,
					canonLength: 49,
					life: 38,   // diep Booster rear barrel lifeLength 0.5 x 75; c[0] overrides to the front's 75
					rand: 0.174533,
					///
					speed: 1.12,
					pene: 2,
					damage: 1.4,
					size: 14.7,
					///
					weight: 0.7,   // diep Booster (Rear Bullet) 0.1333 gu; c[0] overrides to the front row
					push: 0.45709,
					back: 0.224   // diep barrel[1]/[2] (upper-rear pair) recoil 0.2 x 1.12 (plan.md C0)
				}));
				// Same `.height`-instead-of-`.canonLength` typo as Triangle above; these three
				// lines were no-ops until test/tanks.js caught it.
				c[0].back = 0.224; c[0].canonLength = 66.5; c[0].pene = 2; c[0].damage = 7; c[0].life = 75;
				c[0].weight = 3.5;   // diep Booster (Front Bullet) 0.666 gu
				c[1].offdir = -Math.PI - .65; c[1].offx = -6;
				c[2].offdir = -Math.PI + .65; c[2].offx = 6;
				// diep barrel[3]/[4] (lower-rear pair) recoil 2.5 x 1.12 = 2.8 (plan.md C0), unlike
				// the upper-rear pair's 0.2 x 1.12 = 0.224 above.
				c[3].offdir = -Math.PI - .35; c[3].offx = -5; c[3].canonLength = 56; c[3].offTime = .5; c[3].back = 2.8;
				c[4].offdir = -Math.PI + .35; c[4].offx = 5; c[4].canonLength = 56; c[4].offTime = .5; c[4].back = 2.8;
				///
				this.cannons = c;
			},
			"Fighter": new function () {
				this.screen = 1408;
				const c = new Array(5).fill(null).map(() => ({
					reload: 15,   // diep barrel front/rear, reload 1 x15 - Step 3 call 2
					offTime: 0,
					///
					offdir: 0,
					offx: 0,
					canonLength: 56,
					life: 38,   // diep Fighter rear barrel lifeLength 0.5 x 75; c[0]-c[2] override to the front/side's 75
					rand: 0.174533,
					///
					speed: 1.12,
					pene: 2,
					damage: 1.4,
					size: 14.7,
					///
					weight: 0.7,   // diep Fighter (Rear Bullet) 0.1333 gu; c[0]-c[2] override below
					push: 0.45709,
					back: 2.8   // diep barrel[3]/[4] (rear) recoil 2.5 x 1.12 (plan.md C0)
				}));
				// Same `.height`/`.canonLength` typo as Triangle/Booster above, plus a second
				// one: the rear pair's offx was written to c[1]/c[2] (already set two lines
				// up) instead of c[3]/c[4], so the rear cannons never got their splay and the
				// side cannons silently lost theirs. test/tanks.js's index-paired offx check
				// is what caught both.
				c[0].back = 0.224; c[0].canonLength = 66.5; c[0].pene = 2; c[0].damage = 7; c[0].life = 75;
				c[1].offdir = -Math.PI / 2; c[1].offx = +1; c[1].pene = 2; c[1].damage = 5.6; c[1].life = 75; c[1].back = 1.12;
				c[2].offdir = Math.PI / 2; c[2].offx = -1; c[2].pene = 2; c[2].damage = 5.6; c[2].life = 75; c[2].back = 1.12;
				c[1].reload = c[2].reload = 23;   // diep barrel[1]/[2] side, round(1.5 x15=22.5) - Step 3 call 2
				c[3].offdir = -Math.PI - .4; c[3].offx = -5; c[3].offTime = .5; c[3].canonLength = 56;
				c[4].offdir = -Math.PI + .4; c[4].offx = 5; c[4].offTime = .5; c[4].canonLength = 56;
				// diep Fighter (Front Bullet) 0.666 gu and (Side Bullet) 0.5333 gu; the rear pair
				// keeps the literal's 0.1333 gu row above.
				c[0].weight = 3.5;
				c[1].weight = c[2].weight = 2.8;
				///
				this.cannons = c;
			},
			"Auto Hover": new function () {
				this.screen = 1408;
				this.DETEC = {
					type: [KIND.PLAYER, KIND.OBJECTS],
					size: 800,
					all: 0,
					maxDis: 850,
				};
				let c = [{
					reload: 15,   // every auto-turret reload:1 x15 - Step 3 call 3
					offTime: 0,
					type: 0,
					life: 75,   // AutoTurret.ts's AutoTurretDefinition: lifeLength 1 x 75 (plan.md Step 9)
					auto: 1,
					autoShoot: 1,
					autoDir: 1,
					///
					offdir: 0,
					offx: 0,
					canonLength: 38.5,   // AutoTurret.ts's AutoTurretDefinition, size 55 x 0.70 (plan.md C2/R1)
					rand: 0.174533,
					///
					speed: 1.344,   // AutoTurretDefinition bullet.speed 1.2 x 1.12
					pene: 2,   // diep AutoTurretDefinition bullet.health 1 x 2 (plan.md C0)
					damage: 2.1,   // diep AutoTurretDefinition bullet.damage 0.3 x 7 (plan.md C0)
					size: 10.29,   // (AutoTurretDefinition width 29.4 / 2) x sizeRatio 1 x 0.70
					///
					// STAND-IN by class, mapped by cannon: diep has no Auto Hover, but this slot is
					// the same auto-turret every Auto- class carries, so it takes their row -
					// Auto Gunner/Auto Trapper/Auto Smasher (Auto Bullet), 0.2 gu.
					weight: 1.05,
					push: 0.27426,
					back: 0.336   // diep AutoTurretDefinition recoil 0.3 x 1.12 (plan.md C0)
				}];
				c = c.concat(new Array(3).fill(null).map(() => ({
					reload: 15,   // STAND-IN: Tri-Angle own new value (Step 3) - call 3
					offTime: 0,
					///
					offdir: 0,
					offx: 0,
					canonLength: 58,
					life: 38,   // diep Tri-Angle rear barrel lifeLength 0.5 x 75; c[1] overrides to the front's 75
					rand: 0.174533,
					///
					speed: 1.12,
					pene: 0.705882,
					damage: 3.5,
					size: 16,
					///
					// The other three cannons are Tri-Angle's, so they take Tri-Angle's rows:
					// 0.1333 gu rear here, 0.666 gu front on c[1] below.
					weight: 0.7,
					push: 0.45709,
					back: 1.12
				})));
				// `.height` was a typo for `.canonLength` (see Triangle/Booster/Fighter
				// above), and it targeted c[0] - the auto-turret, already fully specified
				// above - instead of c[1], the main cannon `back` is correctly set on here.
				// The auto-turret was silently getting its pene/damage clobbered to 1.35/3.3
				// instead of keeping its own 1.8/2.5. test/tanks.js's offdir/offx/length
				// checks don't reach the auto-turret slot (it's outside the client's
				// `cannons` array), which is why this one wasn't caught by the muzzle-tip
				// band the way its siblings were - found by the same static read that fixed
				// them.
				c[1].back = 0.112; c[1].canonLength = 62; c[1].pene = 1.588235; c[1].damage = 5.775006; c[1].life = 75;
				c[1].weight = 3.5;   // diep Tri-Angle (Front Bullet) 0.666 gu
				c[2].offdir = -Math.PI - .4; c[2].offx = -5; c[2].offTime = .5;
				c[3].offdir = -Math.PI + .4; c[3].offx = 5; c[3].offTime = .5;
				///
				this.cannons = c;
			},
			"Overlord": new function () {
				this.screen = BASE_SCREEN / 0.9;   // diep fieldFactor 0.9 (TankDefinitions.json)
				this.maxDrone = 8;
				this.cannons = [];
				const c = new Array(4).fill(null).map(() => ({
					reload: 90,
					offTime: 0,
					type: 1,
					life: -1,
					auto: 1,
					///
					offdir: 0,
					offx: 0,
					canonLength: 49,
					rand: 0.174533,
					///
					speed: 0.896,
					pene: 4,
					damage: 4.9,
					size: 14.7,
					///
					weight: 4.2,   // diep Overlord 0.8 gu, the row every drone class shares
					push: 0.45709,
					back: 1.12
				}));
				c[1].offdir = Math.PI / 2;
				c[2].offdir = Math.PI;
				c[3].offdir = Math.PI * 3 / 2;
				this.cannons = c;
			},
			"Manager": new function () {
				this.screen = BASE_SCREEN / 0.9;   // diep fieldFactor 0.9 (TankDefinitions.json)
				this.maxDrone = 8;
				// Manager DOES have a real diepcustom source after all (plan.md C8 - the same
				// "no counterpart" call this file's Arena Closer entry made and later retracted):
				// TankDefinitions.json id26 gives `invisibilityRate 0.03, visibilityRateMoving
				// 0.08, visibilityRateShooting 0` - identical decay/moving to Stalker's own row
				// below, but shooting does NOT reveal it (Stalker's does, at 0.23). The old
				// `0.00727`-derived custom trio was a stand-in from before this class's real
				// source was found; retired now that one exists.
				this.stealth = { decay: 0.03, moving: 0.08, shooting: 0 };
				this.cannons = [];
				const c = [{
					reload: 45,
					offTime: 0,
					type: 1,
					life: -1,
					auto: 0,
					///
					offdir: 0,
					offx: 0,
					canonLength: 49,
					rand: 0.174533,
					///
					speed: 0.896,
					pene: 4,
					damage: 4.9,
					size: 14.7,
					///
					weight: 4.2,   // diep Manager 0.8 gu, the row every drone class shares
					push: 0.45709,
					back: 1.12
				}]
				this.cannons = c;
			},
			"Necromancer": new function () {
				this.screen = BASE_SCREEN / 0.9;   // diep fieldFactor 0.9 (TankDefinitions.json)
				this.maxDrone = 22;
				// Data-only (plan.md T3) - `canClaimSquares` is diep's own name for exactly what
				// Necromancer's necro-drone-on-square-kill mechanic below already does; no code
				// reads this flag today, it just gives that existing behavior a diep-cited label.
				this.flags = { canClaimSquares: true };
				this.necro = {
					type: 3,
					necro: 1,
					///
					speed: 0.8064,   // diep Necromancer (necrodrone) bullet.speed 0.72 x 1.12 (plan.md Step 9); life stays -1, hardcoded at the spawn site
					pene: 4,   // diep bullet.health 2 x 2 (plan.md C0)
					damage: 2.94,   // diep bullet.damage 0.42 x 7 (plan.md C0)
					weight: 4.2,   // diep Necromancer 0.8 gu, the row every drone class shares
					push: 0.5028
				};
				this.cannons = [];
			},
			"BattleShip": new function () {
				this.screen = BASE_SCREEN / 0.9;   // diep fieldFactor 0.9 (TankDefinitions.json)
				//this.maxDrone = 7;
				this.cannons = [];
				const c = new Array(4).fill(null).map(() => ({
					reload: 15,
					offTime: 0,
					type: 1.2,
					life: 75,   // diep Battleship (swarm) lifeLength 1 x 75 (plan.md Step 9) - all four barrels share this now
					auto: 0,
					///
					offdir: Math.PI / 2,
					offx: -14,   // diep barrel[0]/[1] (auto pair) offset -20 x 0.70 (plan.md Part B)
					canonLength: 52.5,
					rand: 0.174533,
					///
					speed: 1.12,
					pene: 2,
					damage: 1.05,
					size: 7.203,
					///
					weight: 0.525,   // diep Battleship 0.1 gu
					push: 0.04571,
					back: 1.12
				}));
				c[1].offdir = -Math.PI / 2; c[1].offx = -14; c[1].offTime = .5;
				// diep barrel[2]/[3] (controllable pair) offset +20 x 0.70 (plan.md Part B)
				c[2].offdir = Math.PI / 2; c[2].offx = 14; c[2].offTime = .5;
				c[3].offdir = -Math.PI / 2; c[3].offx = 14;
				c[2].type = c[3].type = 1.3;
				this.cannons = c;
			},
			"Fortress": new function () {
				// K1 - diep has no Fortress; fieldFactor back-solved to reproduce this exact
				// screen (BASE_SCREEN / 0.846153...) rather than left un-cross-checked, plan.md T4.
				this.screen = 1664;
				//this.maxDrone = 7;
				this.cannons = [];
				let c = new Array(3).fill(null).map(() => ({
					reload: 23,   // STAND-IN: diep has no Fortress - takes Tri-Trapper round(22.5)=23 (plan.md Step 3, call 3)
					offTime: 0,
					type: 2,
					life: 240,   // STAND-IN: diep has no Fortress - takes Tri-Trapper's trap lifeLength 3.2 x 75 (plan.md Step 9)
					///
					offdir: 0,
					offx: 0,
					canonLength: 65,
					rand: 0.174533,
					///
					speed: 2.24,
					pene: 4.705882,
					damage: 1.400006,
					size: 10,
					///
					// STAND-IN: diep has no Fortress. Its three launchers are Tri-Trapper's, so they
					// take the 0.666 gu row every manual trap carries. May want its own tune.
					weight: 3.5,
					push: 0.27426,
					back: 0
				}));
				c[1].offdir = Math.PI * 2 / 3; c[2].offdir = Math.PI * 4 / 3;
				c = c.concat(new Array(3).fill(null).map(() => ({
					reload: 23,   // same stand-in as launchers above - call 3
					offTime: .5,
					type: 1.2,
					life: 75,   // STAND-IN: Battleship swarm lifeLength 1 x 75 (plan.md Step 9)
					auto: 0,
					///
					offdir: Math.PI / 3,
					offx: 0,
					canonLength: 48,
					rand: 0.174533,
					///
					speed: 1.12,
					pene: 0.823529,
					damage: 1.400006,
					size: 6,
					///
					// STAND-IN, same reasoning as the launchers above: these are BattleShip's small
					// drones, so they take Battleship's 0.1 gu row. May want its own tune.
					weight: 0.525,
					push: 0.04571,
					back: 0
				})));
				c[4].offdir = Math.PI * 2 / 3 + Math.PI / 3; c[5].offdir = Math.PI * 4 / 3 + Math.PI / 3;
				this.cannons = c;
			},
			"Mega Trapper": new function () {
				this.screen = BASE_SCREEN / 0.9;   // diep fieldFactor 0.9 (TankDefinitions.json)
				//this.maxDrone = 7;
				this.cannons = [];
				const c = [{
					reload: 50,
					offTime: 0,
					type: 2,
					life: 600,   // diep Mega Trapper (trap) lifeLength 8 x 75 (plan.md Step 9)
					///
					offdir: 0,
					offx: 0,
					canonLength: 42,
					rand: 0.174533,
					///
					speed: 2.24,
					pene: 6.4,
					damage: 11.2,
					size: 24.46075,
					///
					weight: 5.6,   // diep 1.0666 gu, the top of the whole table
					push: 0.27426,
					back: 1.12
				}];
				this.cannons = c;
			},
			"Overtrapper": new function () {
				this.screen = BASE_SCREEN / 0.9;   // diep fieldFactor 0.9 (TankDefinitions.json)
				this.maxDrone = 4;
				let c = [{
					reload: 23,
					offTime: 0,
					type: 2,
					life: 600,   // diep Overtrapper (trap) lifeLength 8 x 75 (plan.md Step 9)
					///
					offdir: 0,
					offx: 0,
					canonLength: 42,
					rand: 0.174533,
					///
					speed: 2.24,
					pene: 4,
					damage: 7,
					size: 11.76,
					///
					weight: 3.5,   // diep Overtrapper (Trap) 0.666 gu
					push: 0.27426,
					back: 1.12
				}];
				c = c.concat(new Array(2).fill(null).map(() => ({
					reload: 90,
					offTime: 0,
					type: 1,
					life: -1,
					auto: 1,
					///
					offdir: Math.PI * 2 / 3,
					offx: 0,
					canonLength: 49,
					rand: 0.174533,
					///
					speed: 1.12,
					pene: 2.8,
					damage: 4.9,
					size: 14.7,
					///
					weight: 4.2,   // diep Overtrapper (Drone) 0.8 gu
					push: 0.45709,
					back: 1.12
				})));
				c[2].offdir = Math.PI * 4 / 3; c[2].offTime = .5;
				this.cannons = c;
			},
			"Auto Trapper": new function () {
				this.screen = BASE_SCREEN / 0.9;   // diep fieldFactor 0.9 (TankDefinitions.json)
				this.DETEC = {
					type: [KIND.PLAYER, KIND.OBJECTS],
					size: 1500,
					all: 0,
					maxDis: 800,
				};
				const c = [{
					reload: 15,
					offTime: 0,
					type: 0,
					life: 75,   // AutoTurretDefinition lifeLength 1 x 75 (plan.md Step 9)
					auto: 1,
					autoShoot: 1,
					autoDir: 1,
					///
					offdir: 0,
					offx: 0,
					canonLength: 38.5,   // AutoTurret.ts's AutoTurretDefinition, size 55 x 0.70 (plan.md C2/R1)
					rand: 0.174533,
					///
					speed: 1.344,   // AutoTurretDefinition bullet.speed 1.2 x 1.12
					pene: 2,   // diep AutoTurretDefinition bullet.health 1 x 2 (plan.md C0)
					damage: 2.1,   // diep AutoTurretDefinition bullet.damage 0.3 x 7 (plan.md C0)
					size: 10.29,   // (AutoTurretDefinition width 29.4 / 2) x sizeRatio 1 x 0.70
					///
					weight: 1.05,   // diep Auto Trapper (Auto Bullet) 0.2 gu
					push: 0.27426,
					back: 0.336   // diep AutoTurretDefinition recoil 0.3 x 1.12 (plan.md C0)
				}];
				c.push({
					reload: 23,
					offTime: 0,
					type: 2,
					life: 600,   // diep Auto Trapper (trap) lifeLength 8 x 75 (plan.md Step 9)
					///
					offdir: 0,
					offx: 0,
					canonLength: 42,
					rand: 0.174533,
					///
					speed: 2.24,
					pene: 4,
					damage: 7,
					size: 11.76,
					///
					weight: 3.5,   // diep Auto Trapper (Trap) 0.666 gu
					push: 0.27426,
					back: 1.12
				});
				this.cannons = c;
			},
			"Submachine": new function () {
				this.screen = 1408;
				this.cannons = [];
				this.cannons[0] = new function () {
					this.reload = 8;   // STAND-IN: diep has no Submachine - takes Machine Gun round(7.5)=8 (plan.md Step 3, call 3)
					this.offTime = 0;
					///
					this.offdir = 0;
					this.offx = 0;
					this.canonLength = 60;
					this.life = 75;   // STAND-IN: diep has no Submachine - takes Machine Gun's lifeLength 1 x 75 (plan.md Step 9)
					this.rand = 0.523599;   // STAND-IN: Machine Gun's scatterRate 3 (plan.md Step 8)
					///
					this.speed = 1.12;
					this.pene = 3.529412;
					this.damage = 2.799997;
					this.size = 23;//17
					///
					// STAND-IN: diep has no Submachine. It inherits its class-tree parent Machine
					// Gun's 0.4666 gu. May want its own tune.
					this.weight = 2.45;
					this.push = 0.27426;
					this.back = 0.896;
				}
			},
			///dev
			'Gunner': new function () {
				this.screen = 1408;
				let c = [];
				c = c.concat(new Array(4).fill(null).map(() => ({
					reload: 15,
					offTime: .75,   // diep barrel[1] (offset +32) delay 0.75 (plan.md C0 - our index0
					// takes diep's positive-offset barrel, matching the client's own sign convention)
					///
					offdir: 0,
					offx: 22.4,   // diep barrel[1].offset 32 x 0.70
					canonLength: 45.5,
					life: 75,
					rand: 0.174533,
					///
					speed: 1.232,
					pene: 0.9,
					damage: 3.5,
					size: 8.82,
					///
					// STAND-IN: diep HAS a Gunner but its Knockbackfactor table omits it. This takes
					// Gunner Trapper (Bullet), 0.333 gu - the table's only entry for a bullet fired
					// out of a Gunner barrel - rather than the class-tree parent Machine Gun's
					// 0.4666. May want its own tune.
					weight: 1.75,
					push: 0.45709,
					back: 0.224   // diep recoil 0.2 x 1.12 (plan.md C0)
				})));
				c[1].offx = -22.4; c[1].offTime = .5;   // diep barrel[0].offset -32, delay 0.5
				c[2].canonLength = c[3].canonLength = 59.5;
				c[2].offx = 11.9; c[2].offTime = .25;   // diep barrel[3].offset 17, delay 0.25
				c[3].offx = -11.9; c[3].offTime = 0;    // diep barrel[2].offset -17, delay 0
				this.cannons = c;
			},
			'Auto Gunner': new function () {
				this.screen = 1408;
				this.DETEC = {
					type: [KIND.PLAYER, KIND.OBJECTS],
					size: 700,
					all: 0,
					maxDis: 800,
				};
				let c = [{
					reload: 15,
					offTime: 0,
					type: 0,
					life: 75,   // AutoTurretDefinition lifeLength 1 x 75 (plan.md Step 9)
					auto: 1,
					autoShoot: 1,
					autoDir: 1,
					///
					offdir: 0,
					offx: 0,
					canonLength: 38.5,   // AutoTurret.ts's AutoTurretDefinition, size 55 x 0.70 (plan.md C2/R1)
					rand: 0.174533,
					///
					speed: 1.344,   // AutoTurretDefinition bullet.speed 1.2 x 1.12
					pene: 2,   // diep AutoTurretDefinition bullet.health 1 x 2 (plan.md C0)
					damage: 2.1,   // diep AutoTurretDefinition bullet.damage 0.3 x 7 (plan.md C0)
					size: 10.29,   // (AutoTurretDefinition width 29.4 / 2) x sizeRatio 1 x 0.70
					///
					weight: 1.05,   // diep Auto Gunner (Auto Bullet) 0.2 gu
					push: 0.27426,
					back: 0.336   // diep AutoTurretDefinition recoil 0.3 x 1.12 (plan.md C0)
				}];
				c = c.concat(new Array(4).fill(null).map(() => ({
					reload: 15,
					offTime: .75,   // diep barrel[1] (offset +32) delay 0.75 (plan.md C0) - Auto
					// Gunner's manual barrels are diep-native, identical to plain Gunner's own 4
					// (TankDefinitions.json id39), not a stand-in as previously commented.
					///
					offdir: 0,
					offx: 22.4,   // diep barrel[1].offset 32 x 0.70
					canonLength: 45.5,
					life: 75,
					rand: 0.174533,
					///
					speed: 1.232,
					pene: 0.9,
					damage: 3.5,
					size: 8.82,
					///
					weight: 1.75,
					push: 0.45709,
					back: 0.224   // diep recoil 0.2 x 1.12 (plan.md C0)
				})));
				c[2].offx = -22.4; c[2].offTime = .5;   // diep barrel[0].offset -32, delay 0.5
				c[3].canonLength = c[4].canonLength = 59.5;
				c[3].offx = 11.9; c[3].offTime = .25;   // diep barrel[3].offset 17, delay 0.25
				c[4].offx = -11.9; c[4].offTime = 0;    // diep barrel[2].offset -17, delay 0
				this.cannons = c;
			},
			testbed: new function () {
				this.screen = 1408;
				this.cannons = [];
			},
			'pre launch': new function () {
				this.screen = 1408;
				this.cannons = [];
			},
			bigView: new function () {
				this.screen = 2600;
				this.cannons = [];
			},
			shapes: new function () {
				this.screen = 1408;
				this.cannons = [];
			},
			shape1: new function () {
				this.screen = 1408;
				this.cannons = [];
			},
			shape2: new function () {
				this.screen = 1408;
				this.cannons = [];
			},
			///Boss
			"Summoner": new function () {
				this.screen = 1120;   // diep AbstractBoss's own default viewRange 2000 du x0.56 (plan.md Part D) - was a hand-picked 2400
				// SUMMONER_SIZE (150 du) is diep's own DRAWN CIRCUMRADIUS, exactly the quantity
				// Guardian's own bossSize comment (a few hundred lines down) derives GUARDIAN_SIZE
				// against - Summoner.ts stores `physicsData.size = 150 x sqrt(1/2)` and diep's
				// client draws the square at `size x sqrt(2)` from that, i.e. back to 150.
				// Drawings.body[3] instead draws an n-gon from its APOTHEM (`param.size`), and a
				// square's apothem is its circumradius x cos(pi/4) - so the figure that reproduces
				// diep's 150 du here is 150 x 0.56 x cos(pi/4) = 59.39697. At a flat 84 (150 du x
				// 0.56, i.e. the CIRCUMRADIUS mistaken for the apothem) this boss drew sqrt(2) x
				// too big and swallowed its own barrels whole - issues.md's "royally fucked".
				this.bossSize = 59.396970;
				this.cannons = [];
				this.boss = true;
				this.maxDrone = 28;   // droneCount 7 x 4 barrels (Summoner.ts, plan.md Part D - was 35)
				const c = new Array(4).fill(null).map(() => ({
					// reload 0.36x15, pene 2x12.5, damage 7x0.56, speed 1.12x1.7 (plan.md Part D,
					// SummonerSpawnerDefinition - Summoner.ts:29-54) - these (and `rand`/`life` below)
					// were never re-derived against the real definition when R3 found it and were
					// still the pre-R3 engine stand-ins; now converged the same way Guardian/Fallen
					// Overlord/Fallen Booster's own spawners already were.
					reload: 5.4,
					offTime: 0,
					auto: 1,
					type: 3.1,
					// -1 = permanent (Bullet.js's own sentinel) - SummonerSpawnerDefinition's bullet
					// lifeLength is -1, unlike Guardian's finite 1.5 (plan.md Part D).
					life: -1,
					///
					offdir: 0,
					offx: 0,
					// diepcustom Summoner.ts DOES exist (plan.md R3 - this class is not the
					// no-diep-source stand-in the comment below once assumed): SummonerSpawnerDefinition
					// is size 135, and Summoner.ts overrides sizeFactor to
					// (size/sqrt(1/2))/SUMMONER_SIZE, which is a constant 1 (SUMMONER_SIZE cancels
					// against itself, same as GUARDIAN_SIZE does in Guardian's own sizeFactor) - so
					// a diep length converts on the plain 0.56 absolute axis and is read back
					// through THIS class's own bossSize (59.396970, see above), same identity
					// Guardian's spawner uses: `du x 0.56 x 35/bossSize` = 135 -> 44.547727. The
					// old 135x35/150=31.5 divided by SUMMONER_SIZE (a raw du circumradius) instead
					// of bossSize - with bossSize ALSO sqrt(2) too big, the barrel finished nowhere
					// near the body's real apothem, i.e. entirely hidden under it (same failure
					// mode Guardian's own comment describes before its fix). Client `height` (the
					// Summoner entry a few hundred lines up) matches, same "client height ===
					// server canonLength" pattern as everywhere else in this file.
					canonLength: 44.547727,
					// scatterRate 1 (the same default every other spawner in this file bakes into
					// 0.174533 = 0.174533 x scatterRate) - 0.5 was the same pre-R3 stand-in as
					// reload/speed/pene/damage/life above, not a real SummonerSpawnerDefinition figure.
					rand: 0.174533,
					speed: 1.904,
					pene: 25,
					damage: 3.92,
					// A boss's bullets take `can.size` verbatim (entities/Player.js's shoot()), so
					// this is the drone's ABSOLUTE hit radius on the 0.56 axis - the SAME identity
					// Guardian's spawner uses, which this one had been missing. SummonerSpawnerDefinition
					// is `(width 71.4 / 2) x sizeRatio (55 x sqrt(1/2) / (71.4/2))` = 55 x sqrt(1/2) =
					// 38.891 du, x 0.56 = 21.78 - which is exactly a normal Square's radius
					// (entities/Objects.js's `case "sqr"`), and therefore a Necromancer square drone's
					// too (a necro drone takes its claimed square's size, Player.js's claimSquare()). So
					// a Summoner drone drawn through Drawings.bullet[3] (the square sprite its shared
					// `3.1` steering already selects) is pixel-identical to a Necromancer's beige square.
					// Was 9.074537 = 38.891 x (35/150), the same doubly-wrong x35/reference scaling
					// Guardian's own drone carried before R3/B1 re-based it on 0.56 - Summoner's was
					// simply never re-derived alongside it.
					size: 21.78,
					// diep's SummonerSpawnerDefinition hardcodes `color: Color.NecromancerSquare` on the
					// drone (beige) - distinct from the Summoner's EnemySquare-yellow BODY - so it reads
					// as a Necromancer square regardless of the boss's own colour. `necro` is colour
					// index 9 (SocketSchema); rooms/Room.js's bulletColor() applies this drawColor
					// override (the plain `type === 3` necro-beige rule doesn't fire for a `3.1` drone).
					drawColor: 9,
					///
					// "diep Overlord 0.8 gu, the row every drone class shares" (Overlord's own
					// non-boss comment, line ~2720) - Summoner's drones take the same universal
					// drone Knockbackfactor row every other permanent/finite drone in this file
					// does (Guardian/Fallen Overlord/Fallen Booster all use the identical pair);
					// push 0.18283 was a stand-in from before Summoner.ts was known to be real.
					weight: 4.2,
					push: 0.45709,
					back: 0
				}));
				c[1].offdir = Math.PI / 2; c[1].offTime = .5;
				c[2].offdir = Math.PI;
				c[3].offdir = Math.PI * 1.5; c[3].offTime = .5;
				this.cannons = c;
			},
			/*
				The four real diep bosses this codebase was missing (plan.md X1). All four are
				ordinary Player instances with motion()/update() rebound at spawn
				(lib/gameAI.js's CONFIG.BOSS, the same pattern Summoner above already uses) - so
				each is just a class like any other here, driven through the ordinary
				shoot()/cannons pipeline. `bossSize` (world units) is read by rooms/Room.js's
				createBoss() in place of its old hardcoded 64 (plan.md X2) - Summoner keeps that
				64 (it has no diep body to convert). `boss: true` matches Summoner's own marker.
			*/
			"Guardian": new function () {
				// diepcustom Guardian.ts: no ai.viewRange override, so AbstractBoss's own default
				// (2000 du) applies - x0.56 = 1120. bossSize: GUARDIAN_SIZE 135 du x0.56 (bossSize
				// is an absolute length, unaffected by the barrel-reference bug below).
				this.screen = 1120;
				// GUARDIAN_SIZE (135 du) is diep's own DRAWN CIRCUMRADIUS, not its body radius -
				// Guardian.ts stores `physicsData.size = 135 x sqrt(1/2)` and the client draws the
				// triangle at `size x sqrt(2)` from that. Drawings.body[3] instead draws an n-gon
				// whose circumradius is `size / cos(pi/n)`, i.e. 2 x size for three sides, so the
				// figure that reproduces diep's 135 du here is 135 x 0.56 / 2 = 37.8. At 75.6 this
				// boss drew at twice diep's size, which is the "a bit too big" report; the same
				// number is what every barrel/drone figure below is denominated against.
				this.bossSize = 37.8;
				this.boss = true;
				// GuardianSpawnerDefinition: one oversized backward-facing (angle PI) drone
				// spawner, droneCount 24, self-targeting drones (type 3.1 - the same mechanism
				// Summoner's own spawners above already use; lib/gameAI.js's bossDetect() feeds
				// `play.detected`, which is all type 3.1 needs, no per-boss wiring). reload
				// 0.36x15, pene 2x12.5 (diep bullet.health), damage 7x0.56, speed 1.12x1.7. Unlike
				// every ordinary class, Guardian.ts overrides sizeFactor to
				// (size/sqrt(1/2))/GUARDIAN_SIZE (135) instead of size/50, so canonLength is
				// denominated against this class's OWN bossSize (37.8, see above): the barrel is
				// spawned from at `canonLength x size/35`, and diep's own 100 du = 56 units needs
				// `canonLength = 100 x 0.56 x 35/37.8` = 51.851852, matching the client `height`
				// exactly. life 1.5x75 ref ticks (finite - diep's own lifeLength here is NOT -1,
				// unlike Summoner's permanent drones).
				//
				// `size` is the DRONE's own radius and is an ABSOLUTE length: a boss's bullets take
				// `can.size` verbatim (entities/Player.js's shoot()), so it converts on the 0.56 axis
				// with no reference-relative factor at all. diep's own GuardianSpawnerDefinition drone
				// is `(width 71.4 / 2) x sizeRatio 0.588` = 21 du (x 0.56 = 11.76) - slightly smaller
				// than a small Crasher. B2 sizes it to a small Crasher OUTRIGHT (a deliberate
				// departure, README's "Departures from diep"): the Guardian's drones ARE Crashers
				// (Color.EnemyCrasher, the same pink), so making them the small-Crasher size makes them
				// visually one and the same. Small Crasher `size` is 13.86 (entities/Objects.js's
				// `case "bull"`, = diep's own 35 x SQRT1_2 x 0.56 hit radius). Drawn through
				// Drawings.bullet[6] (= Drawings.obj.bull) at that `size`, the drone is pixel-identical
				// to a small Crasher. `drawType: 6` selects that sprite (see rooms/Room.js's
				// bulletWireType()); without it the shared `3.1` steering would draw a square
				// (parseInt(3.1) = 3), Summoner's shape, not this triangle.
				this.cannons = [{
					reload: 5.4, offTime: 0, auto: 1, type: 3.1, drawType: 6, life: 112.5,
					offdir: Math.PI, offx: 0, canonLength: 51.851852, rand: 0.174533,
					speed: 1.904, pene: 25, damage: 3.92, size: 13.86,
					// No diep absorb table for a boss's own drones (same gap plan.md T2's roster
					// left open) - Overlord's own drone row, the nearest real diep drone-knockback
					// figure on file.
					weight: 4.2, push: 0.45709, back: 0
				}];
			},
			"Defender": new function () {
				// diepcustom Defender.ts: ai.viewRange = 0 - never chases or aggros, so
				// lib/gameAI.js's CONFIG.BOSS entry gives it no bossDetect() call at all and this
				// `screen` is only the (aggro-unused) camera-FOV fallback, diep's own default
				// fieldFactor 1. DEFENDER_SIZE (150 du) is diep's own DRAWN CIRCUMRADIUS, the same
				// quantity GUARDIAN_SIZE is for Guardian a few hundred lines up - Defender.ts
				// stores `physicsData.size = 150 x sqrt(1/2)` and diep's client draws the triangle
				// at `size x sqrt(2)` from that, back to 150. Drawings.body[3] instead draws an
				// n-gon from its APOTHEM (`param.size`), and a triangle's apothem is half its
				// circumradius (`cos(pi/3) = 0.5`, the same identity Guardian's own comment uses) -
				// so the figure that reproduces diep's 150 du here is 150 x 0.56 x 0.5 = 42, where
				// 0.56 is this whole tree's du->unit axis (a level-0 body is 28 units = 50 du x
				// 0.56, entities/Player.js `28 * 1.01^level`). The BODY is therefore correctly
				// sized at 42 and is NOT the "oversized" the issue reports - that was the barrels
				// (below), drawn on 0.7 and then scaled again by the body's own x1.2, i.e. 1.5x too
				// big; a flat 84 would be 2x too big (the CIRCUMRADIUS mistaken for the apothem,
				// the Summoner/pre-fix-Guardian bug), which this is not.
				this.screen = BASE_SCREEN;
				this.bossSize = 42;
				this.boss = true;
				// Three mounted auto-turrets need their own target search (MountedTurretDefinition
				// is diep's own separate AutoTurret child entity, simplified here to three more
				// autoDir/autoShoot cannons on this same body - the same call plan.md T6 made for
				// Auto 3/Auto 5's rings) - reuses the ordinary class-level DETEC every other
				// auto-turret tank already carries (Fortress's own copy, line ~2507, is the
				// closest precedent for the shape).
				this.DETEC = { type: [KIND.PLAYER, KIND.OBJECTS], size: 800, all: 0, maxDis: 800 };
				// Three trap launchers (TrapperDefinition, forceFire -> `auto: 1`), evenly spaced
				// a half-slot off the turrets below (diepcustom: `PI2*(i/count + 1/(2*count))`).
				// damage 7x4, pene 2x12.5, speed 1.12x5, life 8x75, reload 5x15, back 2gux1.12.
				// Defender.ts's scaleFactor is 1 (it never calls scale()), so canonLength is diep's
				// raw 120 du on the SAME axis the body uses: the server spawns at
				// `canonLength * ra` with `ra = size/35 = 42/35 = 1.2` (entities/Player.js), so
				// `120 du x 0.56 / 1.2 = 56` puts the muzzle at 56 x 1.2 = 67.2 units = 120 du (its
				// drawn barrel tip; the launcher stub then reaches ~154 du). The old 73.5 was on
				// 0.7 and drew the stub to 227 du - "wayyy too long" (issues.md). The trap
				// PROJECTILE `size` is left at 19.992 on purpose: the wiki notes the Defender's big
				// (Mega-Trapper-sized) launchers "shoot regular size traps", so the trap keeps the
				// ordinary 0.7 bullet axis every other trap in this file uses rather than being
				// scaled down with the launcher (its hitbox is unchanged by this pass).
				const traps = [0, 1, 2].map(i => ({
					reload: 75, offTime: 0, auto: 1, type: 2, life: 600,
					offdir: Math.PI * 2 * i / 3 + Math.PI / 3, offx: 0, canonLength: 56, rand: 0.174533,
					speed: 5.6, pene: 25, damage: 28, size: 19.992,
					weight: 4.2, push: 0.45709, back: 2.24
				}));
				// MountedTurretDefinition = AutoTurretDefinition (AutoTurret.ts: barrel size 55,
				// width 42x0.7=29.4, recoil 0.3, bullet sizeRatio 1) with bullet speed/damage/health
				// overridden. All on the same 0.56 axis as the body (scaleFactor 1): canonLength
				// 55 du x 0.56 / 1.2 = 25.667 (muzzle at 55 du), size = (29.4/2) x 1 x 0.56 = 8.232
				// - the bullet radius that makes the drawn bullet DIAMETER (2 x 8.232 = 16.46
				// units) equal the drawn barrel WIDTH (29.4 du x 0.56 = 16.46 units), i.e. "bullets
				// match the turret size" (issues.md). The old 10.29 was 29.4/2 x 0.7, 1.25x the
				// barrel it fires from. `distance` is diep's own real mount radius: Defender.ts's
				// `positionData.y/x = size * sin/cos(angle) * offset` with
				// `offset = 60/(DEFENDER_SIZE*sqrt(0.5))` = a flat 60 du from centre; the server
				// mounts at `distance * ra`, so 60 du x 0.56 / 1.2 = 28 (mount at 28 x 1.2 = 33.6
				// units = 60 du). The old 33.6 was treated as absolute and, x ra, spawned bullets
				// at 72 du - 12 du outside the turret. Turrets are ordered FIRST in `cannons` so
				// their canDir lands at [0..2], which is where the client's `turrets` array (each a
				// base circle + a canDir-tracking barrel, drawn over the body) reads its aim; the
				// traps follow at [3..5] (client `cannons`, which never read canDir).
				// NOTE: `back` is left at 0.9408 (recoil 0.3 but on the old x2.8 boss-row scale, vs
				// AutoTurretDefinition's own 0.3 x 1.12 = 0.336 that Auto Smasher carries) - a
				// physics/impulse value, out of this geometry pass's scope; flagged in PENDING.md.
				const turrets = [0, 1, 2].map(i => ({
					reload: 15, offTime: 0, auto: 1, autoDir: 1, autoShoot: 1, life: 75,
					offdir: Math.PI * 2 * i / 3, offx: 0, distance: 28, canonLength: 25.667, rand: 0.174533,
					speed: 2.7552, pene: 11.5, damage: 8.4, size: 8.232,
					weight: 4.2, push: 0.45709, back: 0.9408
				}));
				this.cannons = turrets.concat(traps);
			},
			// Reuses Overlord's own barrel geometry verbatim (diepcustom FallenOverlord.ts
			// iterates TankDefinitions[Tank.Overlord].barrels and only touches
			// droneCount/reload/sizeRatio/speed/damage/health - canonLength/offdir/weight/push/
			// back are Overlord's own, unchanged). bossSize: AbstractBoss's default 50 du scaled
			// to diep's own "level 75" boss size, `50 x 1.01^74 x 0.56` (plan.md M3's own
			// `size = 28 x 1.01^level` identity, just off AbstractBoss's 50 du base instead of a
			// tank's 28 du one) = 58.46.
			"Fallen Overlord": new function () {
				this.screen = 1120;
				this.bossSize = 58.46;
				this.boss = true;
				// A FALLEN boss (as opposed to a polygon-bodied one) - base drones engage these on
				// sight rather than waiting to be provoked (diep_wiki/basedrones.txt). Copied onto the
				// spawned instance by rooms/Room.js createBoss(); entities/Bullet.js type 1.4 reads it.
				this.fallen = true;
				this.maxDrone = 28;   // droneCount 7 x 4 barrels
				// reload 0.36x15 (an override, not a multiplier on Overlord's own 90). pene
				// 2x12.5, damage 7x0.56, speed 1.12x1.7 - diep ABSOLUTE overrides, not scaled off
				// Overlord's own bullet stats. FallenOverlord.ts does NOT override sizeFactor - it
				// scales like an ordinary tank, so canonLength converts on the ordinary 0.7 axis
				// (plan.md R2/R3, was 0.56 before): Overlord's own barrel.size 70 x 0.7 = 49.
				// `size` (a drone, wire type 1 -> Drawings.bullet[1]'s crasher-style triangle,
				// side length ~3.0434 x param.size) is fit to issues.md's own measured ratio
				// instead: 24 side against a 70-diameter reference tank at the same screenshot
				// scale is 0.342857 x that tank's diameter, which on this file's own 28x1.01^level
				// identity (level 44 = displayed 45) is 9.772003 - the old 14.7 (21x0.7, i.e. this
				// class's OWN barrel-width identity applied to a drone, not a real diep drone figure)
				// drew a triangle about 50% larger than that.
				this.cannons = [0, 1, 2, 3].map(i => ({
					reload: 5.4, offTime: 0, type: 1, life: -1, auto: 1,
					offdir: Math.PI * i / 2, offx: 0, canonLength: 49, rand: 0.174533,
					speed: 1.904, pene: 25, damage: 3.92, size: 9.772003,
					weight: 4.2, push: 0.45709, back: 0.112
				}));
			},
			// Reuses Booster's own barrel geometry verbatim (diepcustom FallenBooster.ts iterates
			// TankDefinitions[Tank.Booster].barrels and only touches bullet speed/health/damage -
			// damage is the one RELATIVE override, `x0.8` of Booster's own per-barrel figure).
			// bossSize: same derivation as Fallen Overlord above (both boss classes scale
			// AbstractBoss's own 50 du default to diep's "level 75").
			"Fallen Booster": new function () {
				this.screen = 1120;
				this.bossSize = 58.46;
				this.boss = true;
				// A FALLEN boss (as opposed to a polygon-bodied one) - base drones engage these on
				// sight rather than waiting to be provoked (diep_wiki/basedrones.txt). Copied onto the
				// spawned instance by rooms/Room.js createBoss(); entities/Bullet.js type 1.4 reads it.
				this.fallen = true;
				// FallenBooster.ts does NOT override sizeFactor - canonLength/size convert on the
				// ordinary 0.7 axis, same as Fallen Overlord above (plan.md R2/R3, was 0.56 before):
				// 70x0.7=49 (default), 95x0.7=66.5 (c[0]), 80x0.7=56 (c[3]/c[4]);
				// size (width 42/2) x sizeRatio 1 x 0.7 = 14.7, uniform (Booster's own bullets are
				// all sizeRatio 1).
				const c = new Array(5).fill(null).map(() => ({
					reload: 15, offTime: 0, auto: 1,
					offdir: 0, offx: 0, canonLength: 49, life: 38, rand: 0.174533,
					// speed 1.12x1.7, pene 2x6.25 (diep's flat health override, every barrel) -
					// damage stays per-barrel (below), not set here.
					speed: 1.904, pene: 12.5, damage: 2.8, size: 14.7,
					weight: 0.7, push: 0.45709, back: 0.9632
				}));
				c[0].back = 0.224; c[0].canonLength = 66.5; c[0].size = 14.7; c[0].damage = 4.620005; c[0].life = 75;
				c[0].weight = 3.5;
				c[1].offdir = -Math.PI - .65; c[1].offx = -6;
				c[2].offdir = -Math.PI + .65; c[2].offx = 6;
				c[3].offdir = -Math.PI - .35; c[3].offx = -5; c[3].canonLength = 56; c[3].offTime = .5;
				c[4].offdir = -Math.PI + .35; c[4].offx = 5; c[4].canonLength = 56; c[4].offTime = .5;
				this.cannons = c;
			},
			/*
				Tag's win-condition NPC (PENDING #28, rooms/Tag.js's createCloser()). Every number
				below that diep_wiki/Arena Closer.txt gives directly is used verbatim rather than
				estimated - the two genuinely vague ones ("extremely high body damage" and its own
				body size) are set on the spawned instance instead of here, and flagged there.

				damage: 196 - the wiki's own figure ("196 bullet damage, seven times that of a
				maxed basic Tank"), not derived.
				pene: 3750 - the wiki's "3,750 HP for bullet health"; this codebase's own rule is
				that a bullet's `pene` IS its health pool (PENDING #18), so the wiki figure maps
				onto this field directly.
				size: 34 - "bullets... about as large as an Annihilator's bullet"; copied from
				Annihilator's own cannon.size below, same reasoning for weight/push (a
				projectile that size hits and recoils like that class's, not a new guess).
				speed: 2.24 - diep DOES give Arena Closer its own real barrel (bullet.speed 2,
				plan.md Step 9), which supersedes the pre-Step-9 "maxed Assassin" derivation this
				comment used to state (PENDING #52 flagged that citation as already stale before
				this step landed - it is now simply superseded, not just stale).
				reload: 15 - Basic own base reload (diep barrel reload:1 x15). Step 3 converts the
				whole column to diep own numbers; this superseded the pre-Step-3 derivation of 7
				(a maxed-Reload Basic own cadence), since Arena Closer has no diep counterpart to
				anchor a maxed-stat reading to and the column is now flat diep base values throughout.
				back: 0 - "Complete resistance to knockback" is about what it TAKES
				(entities/Player.js's `this.closer` collision() guard), but a self-recoil on firing
				would still visibly kick it, so this is 0 too rather than leaving diep's own back
				value on a class it should never move a duplicate of.
			*/
			"Arena Closer": new function () {
				this.screen = 2000;
				// No `auto` here (plan.md C10) - diep's AC is an ordinary tank; its own AI
				// (lib/gameAI.js's CONFIG.CLOSER) drives `inputs.e` directly when it has a target,
				// the same way a human's mouse click would, so a sandbox-cycled AC only fires
				// when actually told to instead of forcing fire from the shared class table.
				const c = new Array(1).fill(null).map(() => ({
					reload: 15,
					offTime: 0,
					type: 0,
					life: 75,   // diep Arena Closer bullet.lifeLength 1 x 75 (plan.md Step 9)
					///
					offdir: 0,
					offx: 0,
					canonLength: 52.5,   // TankDefinitions.json id16 barrel.size 75 x 0.7 (plan.md R2/R3 - not the flared-muzzle guess this used to be)
					rand: 0.174533,   // diep scatterRate 1 (plan.md Step 8)
					///
					speed: 2.24,   // diep Arena Closer bullet.speed 2 x 1.12 (plan.md Step 9) - supersedes the stale "Assassin x1.66" derivation in the comment above
					pene: 3750,
					damage: 196,
					size: 14.7,   // (barrel.width 42 / 2) x sizeRatio 1 x 0.7 (plan.md R10 - was 34, a stale stand-in R3 never touched even after finding this class's real id16 source)
					///
					weight: 0.525,
					push: 0.27426,
					back: 0
				}));
				this.cannons = c;
			},
			/*
				The three Dominator variants (PENDING #27/#51). `reload`/`pene`/`damage`/`speed` are
				diepcustom's own TankDefinitions.json entries for these barrels (plan.md Step 11),
				which happened to reproduce diep_wiki/Dominator.txt's own "multiples of a tank"
				phrasing exactly for pene/damage - `reload` is already a reference-tick count
				(15 x barrel.reload, fractional .5 values rounded to the nearest tick, matching the
				reload column's existing all-integer convention, plan.md Step 3's own precedent);
				`speed` is `1.12 x diep bullet.speed` (plan.md Step 9's identity). Bullet magnitudes are
				diep-adopted on an absolute scale now (plan.md chunk 1, D1/D5) - Basic's own can.pene
				(2) and can.damage (7) already ARE diep's raw `2 x bullet.health` / `7 x bullet.damage`
				at Basic's own bulletDefinition values of 1, so pene/damage below are each `diep's own
				multiple x` that same anchor, landing on diep's raw absolute figure directly rather than
				a stand-in scale. `back: 0` everywhere -
				diep_wiki: a Dominator has "no recoil" (it cannot move at all, lib/gameAI.js's
				CONFIG.DOMINATOR). Detector-driven auto-aim (`auto`/`autoShoot`/`autoDir`, DETEC below)
				is the same auto-turret machinery Auto Gunner/Auto Trapper already use - see
				lib/gameAI.js's CONFIG.DOMINATOR comment for why the AI itself needs no bespoke
				targeting code. `screen`/FoV per variant now carries diep's real fieldFactor 1
				(`TankDefinitions.json`, plan.md T4/X6) - the old "roughly Sniper-to-Hunter range"
				diep_wiki stand-in is retired now that a real number exists for all three.
			*/
			"Destroyer Dominator": new function () {
				// real level-75 camera, fieldFactor 1 - replaces both the old
				// Sniper-borrowed stand-in (1664) and the later flat BASE_SCREEN (level-45 baseline)
				this.screen = screenAtLevel(75, 1);
				this.DETEC = { type: [KIND.PLAYER, KIND.OBJECTS], size: this.screen, all: 0, maxDis: this.screen };
				// All 3 Dominator variants carry `preAddon: "dombase"` (plan.md R3/R4) -
				// Addons.ts's DomBaseAddon is a single static (rate 0) hexagonal guard,
				// `createGuard(6, 1.24, 0, 0)`.
				this.guards = [{ sizeRatio: 1.24, sides: 6, rate: 0, phase: 0 }];
				this.cannons = [{
					reload: 45,   // diepcustom TankDefinitions.json: 15 x barrel.reload 3 (plan.md Step 11)
					offTime: 0,
					// No auto/autoShoot/autoDir here (plan.md C10) - a real Dominator is an ordinary
					// tank aimed by its own AI (lib/gameAI.js's dominatorUpdate(), which turns
					// `this.dir` toward DETEC's target and sets `inputs.e` directly), not a per-
					// barrel auto-turret; that is also what lets a sandbox-cycled human aim/fire it
					// with their own mouse/click instead of it auto-aiming and firing itself.
					type: 0,
					life: 149,
					///
					offdir: 0,
					offx: 0,
					canonLength: 56,   // TankDefinitions.json id45 barrel.size 80 x 0.7 (plan.md R2/R3)
					rand: 0.10,
					///
					speed: 1.12,   // diep bullet.speed 1.0 x 1.12 (plan.md Step 9's identity, applied Step 11)
					pene: 200,      // diep bullet.health 100 x tank's own 2 (matches diep_wiki's "x100 tank")
					damage: 70,  // diep bullet.damage 10 x tank's own 7 (matches diep_wiki's "x10 tank")
					size: 12.25,   // (width ~35 / 2) x sizeRatio 1 x 0.7 (plan.md R2/R3 - was "Hybrid-sized" guess)
					///
					weight: 1.05,
					push: 0.27426,
					back: 0
				}];
			},
			"Gunner Dominator": new function () {
				this.screen = screenAtLevel(75, 1); // real level-75 camera
				this.DETEC = { type: [KIND.PLAYER, KIND.OBJECTS], size: this.screen, all: 0, maxDis: this.screen };
				// preAddon "dombase" (plan.md R3/R4) - static hexagonal guard, see Destroyer's own note.
				this.guards = [{ sizeRatio: 1.24, sides: 6, rate: 0, phase: 0 }];
				// TankDefinitions.json id46 (plan.md R3): three FORWARD barrels (angle 0), offset
				// -6/+6/0 x 0.7 = -4.2/+4.2/0 (our offx, not an angle spread as this used to draw,
				// and not the un-converted raw -6/+6 this table baked before E2 - every other
				// du-denominated field on this axis gets the same x0.7, offset is no exception)
				// with real per-barrel delay 0.666/0.333/0.001 (`offTime`, diepcustom's own
				// fraction-of-reload-cycle convention every other multi-barrel class here already
				// uses). reload 15 x barrel.reload 0.3 = 4.5, rounded to the nearest reference tick
				// (plan.md Step 11). Dominator.ts scales like an ordinary tank, so canonLength/size
				// convert on the ordinary 0.7 axis: 75x0.7=52.5, 80x0.7=56 (centre),
				// size (17.5/2)x0.6x0.7=3.675 (uniform - all three share bullet sizeRatio 0.6).
				// No auto/autoShoot/autoDir (plan.md C10) - see Destroyer Dominator's own note above.
				this.cannons = [
					{
						reload: 5, offTime: 0.666, type: 0,
						offdir: 0, offx: -4.2, canonLength: 52.5, rand: 0.1,
						speed: 1.344, pene: 10, damage: 7, size: 3.675,
						weight: 1.75, push: 0.45709, back: 0
					},
					{
						reload: 5, offTime: 0.333, type: 0,
						offdir: 0, offx: 4.2, canonLength: 52.5, rand: 0.1,
						speed: 1.344, pene: 10, damage: 7, size: 3.675,
						weight: 1.75, push: 0.45709, back: 0
					},
					{
						reload: 5, offTime: 0.001, type: 0,
						offdir: 0, offx: 0, canonLength: 56, rand: 0.1,
						speed: 1.344, pene: 10, damage: 7, size: 3.675,
						weight: 1.75, push: 0.45709, back: 0
					}
				];
			},
			"Trapper Dominator": new function () {
				this.screen = screenAtLevel(75, 1); // real level-75 camera
				this.DETEC = { type: [KIND.PLAYER, KIND.OBJECTS], size: this.screen, all: 0, maxDis: this.screen };
				// preAddon "dombase" (plan.md R3/R4) - static hexagonal guard, see Destroyer's own note.
				this.guards = [{ sizeRatio: 1.24, sides: 6, rate: 0, phase: 0 }];
				const c = new Array(8).fill(null).map((_, i) => ({
					// diepcustom TankDefinitions.json: 15 x barrel.reload 1.5 = 22.5, rounded to the
					// nearest reference tick (plan.md Step 11, same rounding Trapper's own class
					// entry already uses).
					reload: 23,
					offTime: 0,
					// `auto: 1` only (plan.md C10/E2) - diep's own `forceFire` (TankDefinitions.json
					// id47), always shooting regardless of input, but no autoDir/autoShoot: each
					// barrel fires along its OWN fixed offdir (i x PI/4) relative to the body, not
					// toward a detected target, so the 8 traps launch radially in every direction
					// rather than all funnelling toward whatever DETEC last picked.
					auto: 1,
					type: 2,
					life: 297,
					///
					offdir: i * Math.PI / 4,   // 8 launchers, evenly spaced (diep_wiki, matches TankDefinitions.json id47's real angles)
					offx: 0,
					canonLength: 42,   // TankDefinitions.json id47 barrel.size 60 x 0.7 (plan.md R2/R3)
					rand: 0.3,
					///
					speed: 4.48,   // diep bullet.speed 4.0 x 1.12 (plan.md Step 9's identity, applied Step 11)
					pene: 40,          // diep bullet.health 20 x tank's own 2 (was 25.5/15x - a wiki paraphrase, corrected against TankDefinitions.json)
					damage: 21,   // diep bullet.damage 3 x tank's own 7 (was 17.454528/3.6x - same correction)
					size: 5.88,   // (width 21 / 2) x sizeRatio 0.8 x 0.7 (plan.md R2/R3)
					///
					weight: 3.5,
					push: 0.27426,
					back: 0
				}));
				this.cannons = c;
			},
			///
			// The 16 tanks plan.md T2 adds (`diepcustom/src/Entity/Tank/TankDefinitions.json` ids
			// cited per class). canonLength/size/width below are diep's own `du x 0.7` (plan.md
			// T5's decided scale - matches the existing roster's 35-reference rather than diep's
			// literal du x 0.56, see plan.md's execution-order note). damage/pene/speed/rand/back
			// go through the same per-column identities every other class already uses (top of
			// this file's own ///SERVER/// comment block): damage = 7 x bullet.damage, pene = 2 x
			// bullet.health, speed = 1.12 x bullet.speed, rand = scatterRate x 0.174533, back =
			// recoil(gu) x 2.8 (gu = diep recoil x 0.4, see the back column header), reload = round(15 x diep's reload multiplier). weight/push have no
			// diep Knockbackfactor-table row for any of these 16 (that table predates them) so
			// each inherits its nearest tree-parent donor row, same convention the existing
			// roster's own stand-ins already use (top-of-file comment, "Seven classes have no row
			// in diep's table at all").
			"Smasher": new function () {   // id36 - postAddon "smasher", no barrels
				this.screen = BASE_SCREEN / 0.9;
				this.cannons = [];
				this.guards = [{ sizeRatio: 1.15, sides: 6, rate: 0.1, phase: 0 }];
				this.statMax = [10, 0, 0, 0, 0, 10, 10, 10];
			},
			"Landmine": new function () {   // id38 - postAddon "landmine", 2 co-rotating guards
				this.screen = BASE_SCREEN / 0.9;
				this.cannons = [];
				this.guards = [
					{ sizeRatio: 1.15, sides: 6, rate: 0.1, phase: 0 },
					{ sizeRatio: 1.15, sides: 6, rate: 0.05, phase: 0 }
				];
				this.statMax = [10, 0, 0, 0, 0, 10, 10, 10];
				this.flags = { invisibility: true };
				// diep's own stealthier rates for this class specifically (TankDefinitions.json) -
				// not the ordinary 0.03/0.08/0.23 trio Stalker below uses.
				this.stealth = { decay: 0.003, moving: 0.16, shooting: 0 };
			},
			"Auto Smasher": new function () {   // id50 - postAddon "autosmasher" = smasher guard + one AutoTurret
				this.screen = BASE_SCREEN / 0.9;
				this.guards = [{ sizeRatio: 1.15, sides: 6, rate: 0.1, phase: 0 }];
				// Full stat set (plan.md T5/T6, T2) - unlike plain Smasher, this class fires a
				// real bullet through its embedded turret. Same AutoTurretDefinition-derived row
				// every existing auto-turret cannon in this file already carries (Auto Hover's
				// own c[0], reused verbatim here).
				this.cannons = [{
					reload: 15, offTime: 0, type: 0, life: 75,
					auto: 1, autoShoot: 1, autoDir: 1,
					offdir: 0, offx: 0, canonLength: 38.5, rand: 0.174533,   // AutoTurretDefinition size 55 x 0.70
					speed: 1.344, pene: 2, damage: 2.1, size: 10.29,   // (width 29.4 / 2) x sizeRatio 1 x 0.70 (plan.md C0)
					weight: 1.05, push: 0.27426, back: 0.336
				}];
				this.DETEC = { type: [KIND.PLAYER, KIND.OBJECTS], size: 800, all: 0, maxDis: 850 };
				this.statMax = [10, 10, 10, 10, 10, 10, 10, 10];
			},
			"Spike": new function () {   // id51 - postAddon "spike", 4 phase-offset guards, bodyDamage +2
				this.screen = BASE_SCREEN / 0.9;
				this.cannons = [];
				this.guards = [
					{ sizeRatio: 1.3, sides: 3, rate: 0.17, phase: 0 },
					{ sizeRatio: 1.3, sides: 3, rate: 0.17, phase: Math.PI / 3 },
					{ sizeRatio: 1.3, sides: 3, rate: 0.17, phase: Math.PI / 6 },
					{ sizeRatio: 1.3, sides: 3, rate: 0.17, phase: Math.PI / 2 }
				];
				this.bodyDamage = 2;
				this.statMax = [10, 0, 0, 0, 0, 10, 10, 10];
			},
			"Hunter": new function () {   // id19 - 2 barrels, one shorter, staggered fire
				this.screen = BASE_SCREEN / 0.85;
				const c = [
					{ reload: 38, offTime: 0, offdir: 0, offx: 0, canonLength: 77, life: 75, rand: 0.05236,
						speed: 1.568, pene: 2, damage: 5.25, size: 10.29, weight: 3.5, push: 0.54851, back: 0.336 },
					{ reload: 38, offTime: 0.2, offdir: 0, offx: 0, canonLength: 66.5, life: 75, rand: 0.05236,
						speed: 1.568, pene: 2, damage: 5.25, size: 13.8915, weight: 3.5, push: 0.54851, back: 0.336 }
				];
				this.cannons = c;
			},
			"Predator": new function () {   // id28 - 3 stacked shrinking barrels, zoomAbility (data-only)
				this.screen = BASE_SCREEN / 0.85;
				this.flags = { zoomAbility: true };   // no right-click-zoom input wired yet (PENDING.md)
				const c = [0, 0.2, 0.4].map((offTime, i) => ({
					reload: 45, offTime, offdir: 0, offx: 0, canonLength: [77, 66.5, 56][i], life: 75, rand: 0.05236,
					speed: 1.568, pene: 2, damage: 5.25, size: [10.29, 13.8915, 17.493][i], weight: 3.5, push: 0.54851, back: 0.336
				}));
				this.cannons = c;
			},
			"Streamliner": new function () {   // id43 - 5 stacked shrinking barrels, weak/fast/short-lived burst
				const lens = [77, 70, 63, 56, 49];
				this.screen = BASE_SCREEN / 0.85;
				const c = lens.map((canonLength, i) => ({
					// diepcustom does not give this class's own reload multiplier - inherits
					// Gunner's cadence (its other tree parent) as the nearest available donor.
					reload: 15, offTime: i * 0.2, offdir: 0, offx: 0, canonLength, life: 60, rand: 0.05236,
					speed: 1.232, pene: 2, damage: 1.4, size: 10.29, weight: 1.75, push: 0.45709, back: 0.224
				}));
				this.cannons = c;
			},
			"Stalker": new function () {   // id21 - 1 trapezoid (flared) barrel, invisibility, final tier
				this.screen = BASE_SCREEN / 0.8;
				this.flags = { invisibility: true };
				this.stealth = { decay: 0.03, moving: 0.08, shooting: 0.23 };   // diep's ordinary trio
				this.cannons = [{
					reload: 30, offTime: 0, offdir: 0, offx: 0, canonLength: 84, life: 75, rand: 0.05236,
					speed: 1.68, pene: 2, damage: 7, size: 14.7, weight: 3.5, push: 0.54851, back: 3.36
				}];
			},
			"Auto 3": new function () {   // id41 - postAddon "auto3", a 3-turret ring
				this.screen = BASE_SCREEN;
				this.DETEC = { type: [KIND.PLAYER, KIND.OBJECTS], size: 800, all: 0, maxDis: 850 };
				this.cannons = [0, 1, 2].map(i => ({
					reload: 15, offTime: 0, type: 0, life: 75,
					auto: 1, autoShoot: 1, autoDir: 1,
					// `ring: true` (plan.md R9) - this cannon reads `this.ringDir` for its own
					// mount/idle-aim reference instead of the hull's `this.dir`/`this.autoDir`,
					// and gets the 90 targetFilter arc + click-to-aim override (entities/
					// Player.js's shoot()). `offdir` is this turret's fixed mount angle around
					// the ring (evenly spaced, diepcustom's createAutoTurrets(3)). `distance: 28`
					// is diepcustom's own `ROT_OFFSET = 0.8` mount RATIO - 28/35 = 0.8, so
					// distance x ra (entities/Player.js) reproduces `owner.size x 0.8` exactly
					// (was a flat non-scaling 14 before R9).
					ring: true,
					offdir: i * Math.PI * 2 / 3, offx: 0, canonLength: 38.5, distance: 28, rand: 0.174533,
					// AutoTurretMiniDefinition (Addons.ts), not the shared AutoTurretDefinition -
					// bullet.damage 0.4/health 1, not 0.3/1 (plan.md R9): damage = 7x0.4 = 2.8,
					// pene = 2x1 = 2 (was 3.5/2.117647, the shared def's numbers, a 25% underpay).
					speed: 1.344, pene: 2, damage: 2.8, size: 10.29,
					weight: 1.05, push: 0.27426, back: 0.336   // AutoTurretMiniDefinition recoil 0.3 x 1.12 (plan.md C0)
				}));
			},
			"Auto 5": new function () {   // id40 - postAddon "auto5", a 5-turret ring
				this.screen = BASE_SCREEN;
				this.DETEC = { type: [KIND.PLAYER, KIND.OBJECTS], size: 800, all: 0, maxDis: 850 };
				this.cannons = [0, 1, 2, 3, 4].map(i => ({
					reload: 15, offTime: 0, type: 0, life: 75,
					auto: 1, autoShoot: 1, autoDir: 1,
					// See Auto 3's own comment just above - identical mechanism, 5 sockets.
					ring: true,
					offdir: i * Math.PI * 2 / 5, offx: 0, canonLength: 38.5, distance: 28, rand: 0.174533,
					speed: 1.344, pene: 2, damage: 2.8, size: 10.29,
					weight: 1.05, push: 0.27426, back: 0.336   // AutoTurretMiniDefinition recoil 0.3 x 1.12 (plan.md C0)
				}));
			},
			// diep's own barrel order (TankDefinitions.json id42) is the fanned pairs, outermost
			// first, then the centre LAST - array order = draw order (plan.md A1/Part B), so the
			// centre barrel must land on top of the whole fan, not in the middle of the array.
			"Spread Shot": new function () {   // id42 - 11 barrels fanned in 5 symmetric pairs + 1 center
				this.screen = BASE_SCREEN;
				const outer = [1.309, -1.309, 1.0472, -1.0472, 0.7854, -0.7854, 0.5236, -0.5236, 0.2618, -0.2618];
				const delay = [0.833, 0.833, 0.667, 0.667, 0.5, 0.5, 0.333, 0.333, 0.167, 0.167];
				const lens = [45.5, 45.5, 49.7, 49.7, 53.9, 53.9, 58.1, 58.1, 62.3, 62.3];
				const c = outer.map((offdir, i) => ({
					reload: 30, offTime: delay[i], offdir, offx: 0, canonLength: lens[i], life: 75, rand: 0.174533,
					speed: 1.12, pene: 2, damage: 4.2, size: 10.29, weight: 2.45, push: 0.45709, back: 0.112
				}));
				c.push({
					reload: 30, offTime: 0, offdir: 0, offx: 0, canonLength: 66.5, life: 75, rand: 0.174533,
					speed: 1.12, pene: 2, damage: 7, size: 14.7, weight: 2.45, push: 0.45709, back: 0.112
				});
				this.cannons = c;
			},
			"Gunner Trapper": new function () {   // id32 - 2 gunner barrels + 1 rear trap launcher
				this.screen = BASE_SCREEN / 0.9;
				this.cannons = [
					{ reload: 15, offTime: 0.66, offdir: 0, offx: 10, canonLength: 52.5, life: 75, rand: 0.174533,
						speed: 1.12, pene: 2, damage: 3.5, size: 7.35, weight: 1.75, push: 0.45709, back: 1.12 },
					{ reload: 15, offTime: 0.33, offdir: 0, offx: -10, canonLength: 52.5, life: 75, rand: 0.174533,
						speed: 1.12, pene: 2, damage: 3.5, size: 7.35, weight: 1.75, push: 0.45709, back: 1.12 },
					// Rear trap barrel - diep's own trapLauncher barrel addon (cosmetic nub, plan.md T5/8c).
					{ reload: 45, offTime: 0, type: 2, life: 600, offdir: Math.PI, offx: 0, canonLength: 42,
						rand: 0.174533, speed: 2.24, pene: 4, damage: 7, size: 15.288, weight: 3.5, push: 0.27426, back: 1.12 }
				];
			},
			"Tri-Trapper": new function () {   // id35 - 3 identical trap barrels at 120 degrees
				this.screen = BASE_SCREEN / 0.9;
				this.cannons = [0, 1, 2].map(i => ({
					// All three fire together. The evenly-thirded fire order this used to carry was
					// an engine-quality guess made when no source was to hand; TankDefinitions.json
					// id35 gives all three barrels `delay: 0`, exactly like Triple Shot's did.
					reload: 23, offTime: 0, type: 2, life: 240,
					offdir: i * Math.PI * 2 / 3, offx: 0, canonLength: 42, rand: 0.174533,
					speed: 2.24, pene: 4, damage: 7, size: 11.76, weight: 3.5, push: 0.27426, back: 1.12
				}));
			},
			"Skimmer": new function () {   // id54 - 1 barrel, low bullet absorbtionFactor unmodelled (PENDING.md)
				this.screen = BASE_SCREEN / 0.9;
				this.cannons = [{
					// type 4 = diepcustom's Skimmer.ts: a bullet that spins its own body
					// (entities/Bullet.js's `showDir`, independent of its straight-line `dir`) while a
					// pair of opposed sub-barrels auto-fire along that spin (plan.md B3). `sub` is
					// SkimmerBarrelDefinition converted through this file's own identities: damage
					// 7x(3/5), pene 2x0.3, speed 1.12x1.1, size (width/2)x0.70 at sizeRatio 1,
					// reloadRef 0.35x15 (a multiplier on the OWNER's live reload cycle, exactly like
					// Barrel.ts's calculateStatData - read live off `play.up.Reload` each sub-fire, not
					// baked at spawn). weight/push have no diep source for a sub-projectile (B2/PENDING.md's
					// still-missing bullet.absorbtionFactor table) so they borrow this cannon's own row.
					// `sub` and the outer cannon are both on the reference-relative 0.70 axis
					// (plan.md R1 - C2 had mistakenly dropped both to 0.56, the absolute-length factor).
					reload: 60, offTime: 0, type: 4, offdir: 0, offx: 0, canonLength: 56, life: 98, rand: 0.174533,
					speed: 0.56, pene: 6, damage: 7, size: 24.99, weight: 1.05, push: 0.27426, back: 3.36,
					// sub.size (radius) matches the secondary nub's own drawn HALF-width
					// (drawings.js's bullet[4]: half 0.402540 x this cannon's own size 24.99) -
					// "secondaries fire bullets the width of the secondary barrel" (issues.md).
					// Was 14.7 (borrowed from SkimmerBarrelDefinition's raw width/2 x 0.7, the
					// same du-conversion used everywhere else in this file but not what the nub
					// itself draws at), leaving the fired bullet visibly narrower than its own barrel.
					sub: { reloadRef: 5.25, damage: 4.2, pene: 0.6, speed: 1.232, size: 10.059534, life: 18.75, rand: 0.174533, weight: 1.05, push: 0.27426 }
				}];
			},
			"Factory": new function () {   // id52
				this.screen = BASE_SCREEN / 0.9;
				this.maxDrone = 6;
				this.cannons = [{
					// type 1.5 = a true diepcustom Minion (plan.md B3): the existing type-1
					// controllable-drone steering (entities/Bullet.js's droneSteer(), factored out of
					// case 1 unchanged) plus MinionBarrelDefinition's own weapon, auto-fired whenever
					// that steering is actually engaged on a target/aim rather than drifting home.
					// `weapon` converted the same way as Skimmer's `sub` above: damage 7x0.4, pene
					// 2x0.4, speed 1.12x0.8, size (width/2)x0.70 at sizeRatio 1, reloadRef 1x15
					// (diep's own barrel.reload=1, i.e. the same cadence as the minion's live reload
					// stat) - weight/push again borrow this cannon's own row, same missing-table caveat.
					// `weapon` and the outer cannon are both on the reference-relative 0.70 axis
					// (plan.md R1 - C2 had mistakenly dropped both to 0.56, the absolute-length factor).
					reload: 45, offTime: 0, type: 1.5, life: -1, offdir: 0, offx: 0, canonLength: 49, rand: 0.174533,
					speed: 0.6272, pene: 8, damage: 4.9, size: 14.7, weight: 4.2, push: 0.36567, back: 1.12,
					weapon: { reloadRef: 15, damage: 2.8, pene: 0.8, speed: 0.896, size: 17.6375, life: 75, rand: 0, weight: 4.2, push: 0.36567 }
				}];
				this.ups = ['Health Regen', 'Reload', 'Max Health', 'Drone Speed', 'Movement Speed', 'Drone Damage', 'Body Damage', 'Drone Health'];
			},
			"Mothership": new function () {   // id27 - gamemode entity, spawned by rooms/Mothership.js (plan.md G1)
				this.screen = screenAtLevel(140, 1); // real level-140 camera
				this.maxDrone = 32;
				// diep splits this class's drone budget across its two barrel groups rather than pooling it
				// (TankDefinitions.json id27's alternating canControlDrones) - see entities/Player.js's
				// droneGroup. 32 total = 16 controllable + 16 not.
				this.droneSplit = true;
				// Mothership.ts sets no explicit body size - it comes from the ordinary tank-body
				// growth formula (plan.md M3: size = 28 x 1.01^level) at `camera.setLevel(140)`,
				// diep's own literal figure (mostly there to max every stat, not for the size
				// alone). `28 x 1.01^140` is ALREADY in our units (28 IS the level-0 radius, the
				// same quantity `this.size` grows from everywhere else in this file) - it is not
				// a diep du figure needing the 0.56 absolute-length conversion, so applying it a
				// second time (plan.md R6) shrank this boss 44%. Correct value: 112.8 (cross-
				// check: diep's own `50 x 1.01^139 du x 0.56` = 111.6, the same body one level
				// down expressed the OTHER way, through the ordinary du->unit factor).
				this.bossSize = 112.8;
				// diep's own receiver-side absorbtionFactor for this class (D7's table) - recorded
				// but not wired into collision(), which only special-cases Dominator/Closer today
				// (PENDING.md: no generic per-class absorbtionFactor mechanism exists yet).
				this.absorbtionFactor = 0.01;
				// diep's own real HP (Mothership.ts: `healthData.values.maxHealth = 7000`) - set
				// on the spawned instance by rooms/Mothership.js's createMothership(), the same
				// "class table stays a template, the real value lives on the instance" pattern
				// createBoss()/createCloser() already use, since this engine's class table has no
				// generic per-class maxHealth field for an ordinary tank to read.
				//
				// diep's own generic AI.findTarget() (plan.md E3) - the same shared shape
				// Dominator's own DETEC below uses, so an unpossessed Mothership only fires once
				// it actually has a live enemy in range instead of always (see the cannons' own
				// note on why `auto: 1` retired) - `screen`/BASE_SCREEN doubles as its own view range
				// for lack of a captured diep fieldFactor for this class.
				this.DETEC = { type: [KIND.PLAYER, KIND.OBJECTS], size: this.screen, all: 0, maxDis: this.screen };
				this.cannons = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(i => ({
					// No `auto` (plan.md E3) - diep's shared AI.tick() only force-shoots
					// (`inputs.flags |= leftclick`) once it actually HAS a target
					// (`state === hasTarget`), passively spinning with no firing otherwise
					// (`state === idle`) - `auto: 1` baked a wrong "always attacking" reading of
					// "spins its own idle aim continuously" onto every cannon, which also meant a
					// pilot (H-key piloting, plan.md E4) could never hold fire. lib/gameAI.js's
					// mothershipUpdate() now sets `inputs.e` itself, the same shape
					// dominatorUpdate() already uses.
					reload: 90, offTime: 0,
					// `canControlDrones` (TankDefinitions.json id27, plan.md E3): true on even
					// barrels, false on odd - when a player pilots the Mothership, half its drones
					// obey the mouse and half stay AI. Type 1 (droneSteer1, entities/Bullet.js)
					// already reads the owner's mouseR/mouseL/e to override its AI steering - that
					// IS this engine's "canControlDrones: true". Type 1.1 shares the same idle/
					// DETEC-chase/return-home logic (its own copy, Hybrid's own drones) but never
					// reads the owner's inputs at all, so it's the "false" half; no new drone type
					// needed; both wire back an identical droneCount cap through `maxD` in shoot().
					type: (i % 2 === 0) ? 1 : 1.1, life: -1,
					// `+ Math.PI/16` (plan.md R6): TankDefinitions.json id27's own barrel angles
					// are a half-step OFF the plain i x 2pi/16 spacing (barrel 0 sits at
					// 0.19634954... rad = pi/16, not 0) - matches the trapezoid body's own
					// vertices sitting between barrels rather than under them.
					offdir: Math.PI / 16 + i * Math.PI * 2 / 16, offx: 0, canonLength: 42, rand: 0.174533,
					speed: 0.5376, pene: 4, damage: 4.9, size: 3.675, weight: 4.2, push: 0.36567, back: 0
				}));
				this.ups = ['Health Regen', 'Reload', 'Max Health', 'Drone Speed', 'Movement Speed', 'Drone Damage', 'Body Damage', 'Drone Health'];
			}
		};
	///
	exports.defaultUps = [
		'Health Regen',
		'Reload',
		'Max Health',
		'Bullet Speed',
		'Movement Speed',
		'Bullet Damage',
		'Body Damage',
		'Bullet Penetration'
	];
	/*
		Rebuilt to match diep's own tree verbatim (plan.md T1) for every diep-native edge, on top
		of the pre-existing custom branches K1 keeps (Cyclone/Submachine/Auto Hover/Fortress -
		Auto Hover/Fortress live under the dev-only `pre launch` node exactly as before, not the
		real tree, since neither was ever player-reachable there to begin with).

		Net diff from the old tree: `Sprayer` consolidated onto Machine Gun's tier-1 children only
		(diep has no Sprayer edge off Gunner or Assassin); `Triple Shot` is no longer a Flank
		Guard child (diep only reaches it via Twin); `Rocket` (this file's stand-in for diep's
		Rocketeer, PENDING.md) moves from a bare Flank Guard tier-2 branch to Destroyer's, matching
		diep's real parent. Everything else additive - see plan.md T1's table for citations.
	*/
	/*
		A tier index IS its level gate: entities/Player.js's upClass() unions every tier up to
		`parseInt(level / 15)`, so tier 0 opens at 15, tier 1 at 30, tier 2 at 45. That makes an
		edge's tier a statement about WHEN it unlocks, not about how many evolutions precede it -
		which is what lets two edges out of the SAME parent open at different levels, exactly as
		diep does:

		  * Basic -> Smasher is a level-30 edge, not a level-15 one. A player who wants Smasher
		    stays Basic through the whole first tier rather than being offered it alongside Twin.
		  * Machine Gun -> Sprayer is a level-45 edge, so Machine Gun holds through tier 1.

		Both were sitting one tier early. `classLvl` is unaffected either way - it counts
		evolutions taken, not tiers skipped.
	*/
	exports.tree = [
		{
			Basic: ['Twin', 'Machine Gun', 'Sniper', 'Flank Guard'],
			testbed: ['bigView', 'shapes', 'pre launch'],
			shapes: ['shape1', 'shape2'],
			'pre launch': ['Fortress', 'Necromancer', 'Auto Hover']
		},
		{
			Basic: ['Smasher'],
			Twin: ['Twin Flank', 'Triple Shot', 'Quad Tank'],
			'Machine Gun': ['Destroyer', 'Gunner'],
			Sniper: ['Trapper', 'Assassin', 'Overseer', 'Hunter'],
			'Flank Guard': ['Triangle', 'Quad Tank', 'Twin Flank', 'Auto 3'],
		},
		{
			// Smasher itself is a tier-1 (level 30) edge above, so its own children move down here
			// with it - otherwise they would open at the same level 30 Smasher does, and a Basic
			// could take Smasher and Spike in the same breath.
			Smasher: ['Landmine', 'Auto Smasher', 'Spike'],
			'Machine Gun': ['Submachine', 'Sprayer'],
			Gunner: ['Auto Gunner', 'Gunner Trapper', 'Streamliner'],
			Destroyer: ['Hybrid', 'Annihilator', 'Skimmer', 'Rocketeer'],
			Overseer: ['Manager', 'Necromancer', 'BattleShip', 'Overlord', 'Overtrapper', 'Factory'],
			'Triangle': ['Fighter', 'Booster'],
			'Quad Tank': ['Cyclone', 'Octo Tank', 'Auto 5'],
			'Twin Flank': ['BattleShip', 'Triple Twin'],
			'Triple Shot': ['Triplet', 'Penta Shot', 'Spread Shot'],
			Assassin: ['Ranger', 'Stalker'],
			Trapper: ['Overtrapper', 'Auto Trapper', 'Mega Trapper', 'Tri-Trapper', 'Gunner Trapper'],
			Hunter: ['Predator', 'Streamliner'],
			'Auto 3': ['Auto 5', 'Auto Gunner'],
		}
	];
	exports.list = [
		"Basic",
		///
		"Twin",
		"Machine Gun",
		"Sniper",
		"Flank Guard",
		///
		"Triple Shot",
		"Quad Tank",
		"Destroyer",
		"Assassin",
		"Overseer",
		"Triangle",
		"Trapper",
		"Gunner",
		"Twin Flank",
		///
		"Rocketeer",
		"Hybrid",
		"Annihilator",
		"Sprayer",
		"Ranger",
		'Triple Twin',
		"Triplet",
		"Penta Shot",
		"Octo Tank",
		"Cyclone",
		"Booster",
		"Fighter",
		"Auto Hover",
		"Overlord",
		"Manager",
		"BattleShip",
		"Fortress",
		"Mega Trapper",
		"Overtrapper",
		"Auto Trapper",
		"Submachine",
		"Auto Gunner",
		///
		'Necromancer',
		'pre launch',
		'testbed',
		'bigView',
		'shapes',
		'shape1',
		'shape2',
		///
		'Summoner',
		'Arena Closer',
		'Destroyer Dominator',
		'Gunner Dominator',
		'Trapper Dominator',
		///
		// The 16 tanks plan.md T2 adds - appended, not inserted, so no existing wire-enum index
		// (SocketSchema.js's `class` field) moves.
		'Smasher',
		'Landmine',
		'Auto Smasher',
		'Spike',
		'Hunter',
		'Predator',
		'Streamliner',
		'Stalker',
		'Auto 3',
		'Auto 5',
		'Spread Shot',
		'Gunner Trapper',
		'Tri-Trapper',
		'Skimmer',
		'Factory',
		'Mothership',
		// The four real diep bosses plan.md X1 adds - appended for the same reason as the T2
		// block above (no existing wire-enum index moves).
		'Guardian',
		'Defender',
		'Fallen Overlord',
		'Fallen Booster'
	];

})(typeof (exports) === 'undefined' ? function () { this['TanksConfig'] = {}; return this['TanksConfig'] }() : exports,
	typeof (exports) === 'undefined' ? 'client' : 'server')
