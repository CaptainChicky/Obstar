(function (exports, platform) {

	// Entity type tags. kinds.js loads first so DETEC auto-turret filters can name
	// KIND.PLAYER / KIND.OBJECTS instead of hardcoding the string literals.
	const KIND = (platform === 'client') ? globalThis.KIND : require('./kinds.js');
	// Every class's screen is BASE_SCREEN / fieldFactor. Server-only; the client never
	// reads `screen`. Custom classes stay at fieldFactor 1; Fortress is back-solved to
	// keep its current screen.
	const BASE_SCREEN = 1408;

	// Dominator/Mothership camera: screen grows as 1.01^((level-45)/2) off the
	// level-45 baseline. FOV = (0.55 * fieldFactor) / 1.01^((level-1)/2).
	const REFERENCE_LEVEL = 45;
	function screenAtLevel(level, fieldFactor = 1) {
		return BASE_SCREEN * Math.pow(1.01, (level - REFERENCE_LEVEL) / 2) / fieldFactor;
	}

	// Two du-to-unit conversions: barrels draw as `c.height x (param.size / CONST.SIZE)`
	// against a 35-unit reference, while diep draws `definition.size x (tank.size / 50)`
	// against a 50 du body.
	//
	//   ABSOLUTE (arena size, bossSize, drone rest radius):           1 du = 0.56 units
	//   REFERENCE-RELATIVE (barrel height/width/canonLength/can.size,
	//     anything divided by CONST.SIZE=35 at the consumption site): 1 du = 0.70 units
	//
	// Ordinary barrels use 0.70. Bosses convert against their own bossSize, not 50.
	// Numbers below are baked literals; divide by 0.70 (0.56 for absolute fields) to recover du.

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
						offx: 18.2,
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
			// type 2: trapezoid, wide at the muzzle.
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
						offdir: -Math.PI / 4,
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
			// offx signs follow the server's firing order, not the drawn left/right picture.
			// Recoil bits are index-keyed, so a client index has to match its server counterpart
			// or the barrel that kicks is the mirror of the one the bullet left from.
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
			// type 0 + trapLauncher: a short rectangle plus the trap arrowhead addon.
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
			// Inner straight barrel drawn under a shorter trapezoid so the inner muzzle peeks out.
			// Extra barrels past those two are decorative.
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
						trapezoidDirection: false
					},
				],
				body: {
					shape: 0,
				}
			},
			// `pronounced`: barrel-coloured trapezoid overlay above the main barrel, not a second cannon.
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
			"Triplet": {
				cannons: [
					{
						type: 0,
						height: 56,
						width: 29.4,
						offx: 18.2,
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
			// offx signs follow the server's firing order, same as Twin Flank.
			"Triple Twin": {
				cannons: [
					{
						type: 0,
						height: 66.5,
						width: 29.4,
						offx: -18.2,
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
						offdir: Math.PI / 4,
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
			// Barrel height is a deliberate departure: the body is taller than wide, so a diep-length
			// stub would barely show. Decorative only - the server fires through `this.necro`, not a cannon.
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
					'Max Health',
					'Body Damage',
					'Bullet Speed',
					'Bullet Penetration',
					'Bullet Damage',
					'Drone Count',
					'Movement Speed'
				]
			},
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
						offx: -14,   // auto pair
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
						offx: 14,   // controllable pair
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
						offx: 22.4,
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
						offx: 11.9,
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
						offx: 22.4,
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
						offx: 11.9,
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
			// Barrel dims convert on the 0.56 axis then read back through this class's own
			// bossSize: `du x 0.56 x 35/bossSize`.
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
					sides: 4,
					// Default vertex-forward would put a corner on each cardinal spawner;
					// -PI/4 puts an edge under each instead.
					rot: -Math.PI / 4
				}
			},
			"Guardian": {
				// One backward-facing trapezoid spawner. bossSize 37.8 is the triangle's apothem
				// (drawn circumradius = 2 x size = 75.6 = 135 du). Barrel height = du x 0.56 x 35 / 37.8.
				cannons: [
					{ type: 2, height: 51.851852, width: 37.022222, offx: 0, offdir: Math.PI, open: 0, trapezoidDirection: false }
				],
				body: { shape: 3, sides: 3 }
			},
			"Defender": {
				// bossSize 42 is the triangle's apothem (150 du circumradius). Barrels convert on
				// the same axis as the body: height = du x 0.56 x 35/42. ScaleFactor is 1 (never
				// scaled to level 75). Turrets are non-ring so they draw over the body and track canDir;
				// the server orders turret cannons first so canDir[0..2] feed them.
				cannons: [0, 1, 2].map(i => ({
					type: 0, height: 56, width: 33.32, offx: 0, offdir: Math.PI * 2 * i / 3 + Math.PI / 3, open: 0, trapLauncher: true
				})),
				turrets: [0, 1, 2].map(i => ({
					type: 0, height: 25.667, width: 13.72, offx: 0, offdir: Math.PI * 2 * i / 3, open: 0, rad: 11.667, distance: 28
				})),
				body: { shape: 3, sides: 3 }
			},
			// Overlord's 4-barrel geometry; barrels convert on the ordinary 0.7 axis (scales like a tank).
			"Fallen Overlord": {
				cannons: [0, 1, 2, 3].map(i => ({
					type: 2, height: 49, width: 29.4, offx: 0, offdir: Math.PI * i / 2, open: 0, trapezoidDirection: false
				})),
				body: { shape: 0 }
			},
			// Booster's 5-barrel geometry; ordinary 0.7 axis, same as Fallen Overlord.
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
			// Stationary circle. Draw order: hex guard, grey barrels, cosmetic trapezoid, then
			// the circular body on top (clips the grey assembly; only the hex points stick out).
			"Destroyer Dominator": {
				// Possessed HUD has no selectable stat row.
				hideStats: true,
				guards: [{ sizeRatio: 1.24, sides: 6, rate: 0, phase: 0 }],
				// Cosmetic trapezoid; Destroyer + Gunner Dominator only, not Trapper.
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
			// Three forward barrels, differentiated by offx, not by angle.
			"Gunner Dominator": {
				hideStats: true,
				guards: [{ sizeRatio: 1.24, sides: 6, rate: 0, phase: 0 }],
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
			// Eight trap launchers at i x PI/4.
			"Trapper Dominator": {
				hideStats: true,
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
			// Guards draw as a spinning outline n-gon before the body. statMax is 8-long in the
			// server's wire index order; the upgrade panel remaps it into row order via UP_ORDER.
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
			// Ring turret: base circle under the body, barrel over it. `ring` reads this.ringDir
			// for mount/idle aim instead of the hull's facing.
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
			// Fanned pairs outermost first, centre last so it draws on top of the fan.
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
				// Body-mounted nub under the barrel.
				launcher: true,
				cannons: [
					{ type: 0, height: 56, width: 49.98, offx: 0, offdir: 0, open: 0 }
				],
				body: { shape: 0 }
			},
			// Square body (shape 3), not the rounded-rect that needs width/height.
			"Factory": {
				cannons: [
					{ type: 2, height: 49, width: 29.4, offx: 0, offdir: 0, open: 0, trapezoidDirection: false }
				],
				body: { shape: 3, sides: 4, rot: -Math.PI / 4 }
			},
			"Mothership": {
				// Trapezoid spawners, half-step off the 16-gon vertices so barrels sit between corners.
				cannons: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(i => ({
					type: 2, height: 10.740003, width: 1.879500, offx: 0, offdir: Math.PI / 16 + i * Math.PI * 2 / 16, open: 0, trapezoidDirection: false
				})),
				body: { shape: 3, sides: 16 }
			}
		} :
		///SERVER///
		/*
			Every number below is denominated against config.REF_TICK_MS (40ms), not the
			server's actual TICK_MS. Converted at each consumption site.

			`speed` is cruise thrust, acceleration per reference tick squared (a trap, type 2,
			has baseAccel 0). Consumed as tick.quadratic() - added to velocity then integrated
			into position. Identity: 1.12 x diep bullet.speed. Muzzle kick is computed at
			shoot() from `speed` plus a flat +16.8; drones divide the kick by 3, traps halve
			`speed` first.

			`rand` is angular scatter: scatterRate x 0.174533 (5 degrees). shoot() uses
			`dir +- rand/2`; the same scatterRate also back-derives muzzle speed jitter
			(`can.rand / 0.174533`).

			`life` is required per cannon: round(lifeLength x 75) reference ticks for a
			bullet/trap/swarm, round(lifeLength x 88) for a drone (type 1/1.1), and -1 for a
			permanent drone. A trap's `life` also sets its arming window (`life >> 3` real
			ticks, during which it collides with nothing).

			`back` is tank recoil: gu x 2.8 at F = 10/11. Divide by 2.8 to read grid squares.
			If tank friction moves, this whole column moves with it.

			`weight` is knockback dealt to the tank this bullet hits: gu x 5.25. Divide by
			5.25 to read the table. Knockback inverts against damage, so Destroyer/Annihilator
			sit at the bottom and Basic near the top. Classes with no table row inherit a
			relative (noted at that entry).

			`push` is the bullet's own bounce off whatever it hit. Cosmetic for a spend-down
			bullet; for a drone it is the separation impulse that keeps a swarm from stacking.

			`damage` and `pene` are raw absolute figures: Basic's barrel is 7 and 2; every
			other cannon is the same multiple of that anchor.
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
					this.canonLength = 66.5;
					this.life = 75;
					this.rand = 0.174533;
					///
					this.speed = 1.12;
					this.pene = 2;
					this.peneMult = 1;
					this.damage = 7;
					this.size = 14.7;
					///
					this.weight = 3.5;   // 0.666 gu
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
					this.weight = 3.5;   // 0.666 gu
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
					weight: 3.5,   // same 0.666 gu as the front
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
					this.offx = -18.2;
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
					this.weight = 2.275;   // 0.4333 gu
					this.push = 0.27426;
					this.back = 0.84;
				};
				this.cannons[0] = new function () {
					this.reload = 15;
					this.offTime = 0.5;
					///
					this.offdir = 0;
					this.offx = 18.2;
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
					this.weight = 2.275;   // 0.4333 gu
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
					this.rand = 0.523599;
					///
					this.speed = 1.12;
					this.pene = 2;
					this.damage = 4.9;
					this.size = 14.7;
					///
					this.weight = 2.45;   // 0.4666 gu
					this.push = 0.27426;
					this.back = 1.12;
				}
			},
			"Sniper": new function () {
				this.screen = BASE_SCREEN / 0.9;
				this.cannons = [];
				this.cannons[0] = new function () {
					this.reload = 23;
					this.offTime = 0;
					///
					this.offdir = 0;
					this.offx = 0;
					this.canonLength = 77;
					this.life = 75;
					this.rand = 0.05236;
					///
					this.speed = 1.68;
					this.pene = 2;
					this.damage = 7;
					this.size = 14.7;
					///
					this.weight = 3.5;   // 0.666 gu
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
					canonLength: 66.5,
					life: 75,
					rand: 0.174533,
					///
					speed: 1.12,
					pene: 2,
					damage: 4.9,
					size: 14.7,
					///
					weight: 2.45,   // 0.4666 gu
					push: 0.45709,
					back: 1.12
				}));
				c[0].offdir = -Math.PI / 4;
				c[1].offdir = Math.PI / 4;
				// All three fire together (`offTime` 0 on every barrel).
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
					weight: 1.75,   // 0.333 gu
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
					weight: 2.625,   // 0.5 gu
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
					weight: 1.05,   // 0.2 gu; knockback inverts against damage
					push: 0.27426,
					back: 16.8
				}));
				///
				this.cannons = c;
			},
			"Assassin": new function () {
				this.screen = BASE_SCREEN / 0.8;
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
					this.weight = 3.5;   // 0.666 gu
					this.push = 0.54851;
					this.back = 3.36;
				}
			},
			"Overseer": new function () {
				this.screen = BASE_SCREEN / 0.9;
				this.maxDrone = 8;
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
					weight: 4.2,   // 0.8 gu, every drone class
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
					life: 38,   // rear; c[0] overrides to 75
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
					weight: 0.7,   // rear 0.1333 gu; c[0] overrides
					push: 0.45709,
					back: 2.8
				}));
				c[0].back = 0.224; c[0].canonLength = 66.5; c[0].pene = 2; c[0].damage = 7; c[0].speed = 1.12; c[0].life = 75;
				c[0].weight = 3.5;   // front 0.666 gu
				c[1].offdir = -Math.PI - .4; c[1].offx = -5; c[1].offTime = .5;
				c[2].offdir = -Math.PI + .4; c[2].offx = 5; c[2].offTime = .5;
				///
				this.cannons = c;
			},
			"Trapper": new function () {
				this.screen = BASE_SCREEN / 0.9;
				this.cannons = [];
				this.cannons[0] = new function () {
					this.reload = 23;
					this.offTime = 0;
					this.type = 2;
					this.life = 600;   // arming window is life>>3 at spawn
					///
					this.offdir = 0;
					this.offx = 0;
					this.canonLength = 42;
					this.rand = 0.174533;
					///
					this.speed = 2.24;   // trap baseAccel is 0; this feeds only the muzzle-kick formula
					this.pene = 4;
					this.damage = 7;
					this.size = 11.76;
					///
					this.weight = 3.5;   // 0.666 gu, the row every manual trap shares
					this.push = 0.27426;
					this.back = 1.12;
				}
			},
			///
			"Rocketeer": new function () {
				this.screen = BASE_SCREEN / 0.9;
				const c = new Array(2).fill(null).map(() => ({
					reload: 60,   // stand-in: no Rocket class, takes Rocketeer 60
					offTime: 0,
					// Both barrels point backwards, modelling the thruster puff, not a rocket projectile.
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
					// Stand-in: rear-thruster row (0.1333 gu), not Flank Guard's forward-gun 0.666.
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
					weight: 1.05,   // 0.2 gu; knockback inverts against damage
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
					weight: 4.2,   // 0.8 gu
					push: 0.36567,
					back: 1.12
				})
				///
				this.cannons = c;
			},
			"Annihilator": new function () {
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
					size: 33.81,
					///
					// 0.1 gu - floor of the knockback table. `back` is a separate identity.
					weight: 0.525,
					push: 0.27426,
					back: 19.04
				}));
				///
				this.cannons = c;
			},
			"Sprayer": new function () {
				// Inner straight barrel fired first (under), trapezoid on top, shorter so the inner muzzle peeks out.
				this.screen = BASE_SCREEN;
				this.cannons = [
					{
						reload: 15,
						offTime: 0.5,
						offdir: 0,
						offx: 0,
						canonLength: 77,
						life: 75,
						rand: 0.174533,
						speed: 1.12,
						pene: 2,
						damage: 0.7,
						size: 10.29,
						weight: 0.35,   // 0.0666 gu; both barrels share this row
						push: 0.45709,
						back: 0
					},
					{
						reload: 8,
						offTime: 0,
						offdir: 0,
						offx: 0,
						canonLength: 66.5,
						life: 75,
						rand: 0.523599,
						speed: 1.12,
						pene: 2,
						damage: 4.9,
						size: 14.7,
						weight: 0.35,
						push: 0.45709,
						back: 1.12
					}
				];
			},
			"Ranger": new function () {
				this.screen = BASE_SCREEN / 0.7;
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
					this.weight = 3.5;   // 0.666 gu
					this.push = 0.63992;
					this.back = 3.36;
				}
			},
			"Triplet": new function () {
				this.screen = 1408;
				this.cannons = [];
				const c = new Array(3).fill(null).map(() => ({
					reload: 15,
					offTime: .5,   // wings; centre overrides to 0
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
					weight: 2.1,   // 0.4 gu
					push: 0.45709,
					back: 0.56
				}));
				c[0].offx = 18.2;
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
					offx: -18.2,
					canonLength: 66.5,
					rand: 0.174533,
					///
					speed: 1.12,
					pene: 2,
					damage: 3.5,
					size: 14.7,
					///
					weight: 1.75,   // 0.333 gu
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
					weight: 1.925,   // 0.3666 gu
					push: 0.45709,
					back: 0.784
				}));
				// Outer delay 0.66, inner 0.33, centre 0.
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
					weight: 2.275,   // 0.4333 gu
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
					reload: 15,   // stand-in: no Cyclone, takes Octo Tank
					offTime: 0,
					///
					offdir: 0,
					offx: 0,
					canonLength: 52,
					life: 75,
					rand: 0.174533,
					///
					speed: 1.12,
					pene: 1.176471,
					damage: 6.475009,
					size: 12,
					///
					// Stand-in: Octo's 0.4333 gu (barrel-count trend), not Quad Tank's 0.5.
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
					life: 38,   // rear; c[0] overrides to 75
					rand: 0.174533,
					///
					speed: 1.12,
					pene: 2,
					damage: 1.4,
					size: 14.7,
					///
					weight: 0.7,   // rear 0.1333 gu; c[0] overrides
					push: 0.45709,
					back: 0.224   // upper-rear pair
				}));
				c[0].back = 0.224; c[0].canonLength = 66.5; c[0].pene = 2; c[0].damage = 7; c[0].life = 75;
				c[0].weight = 3.5;   // front 0.666 gu
				c[1].offdir = -Math.PI - .65; c[1].offx = -6;
				c[2].offdir = -Math.PI + .65; c[2].offx = 6;
				// Lower-rear pair recoil is 2.8, unlike the upper-rear pair's 0.224.
				c[3].offdir = -Math.PI - .35; c[3].offx = -5; c[3].canonLength = 56; c[3].offTime = .5; c[3].back = 2.8;
				c[4].offdir = -Math.PI + .35; c[4].offx = 5; c[4].canonLength = 56; c[4].offTime = .5; c[4].back = 2.8;
				///
				this.cannons = c;
			},
			"Fighter": new function () {
				this.screen = 1408;
				const c = new Array(5).fill(null).map(() => ({
					reload: 15,
					offTime: 0,
					///
					offdir: 0,
					offx: 0,
					canonLength: 56,
					life: 38,   // rear; c[0]-c[2] override to 75
					rand: 0.174533,
					///
					speed: 1.12,
					pene: 2,
					damage: 1.4,
					size: 14.7,
					///
					weight: 0.7,   // rear 0.1333 gu; c[0]-c[2] override below
					push: 0.45709,
					back: 2.8
				}));
				c[0].back = 0.224; c[0].canonLength = 66.5; c[0].pene = 2; c[0].damage = 7; c[0].life = 75;
				c[1].offdir = -Math.PI / 2; c[1].offx = +1; c[1].pene = 2; c[1].damage = 5.6; c[1].life = 75; c[1].back = 1.12;
				c[2].offdir = Math.PI / 2; c[2].offx = -1; c[2].pene = 2; c[2].damage = 5.6; c[2].life = 75; c[2].back = 1.12;
				c[1].reload = c[2].reload = 23;
				c[3].offdir = -Math.PI - .4; c[3].offx = -5; c[3].offTime = .5; c[3].canonLength = 56;
				c[4].offdir = -Math.PI + .4; c[4].offx = 5; c[4].offTime = .5; c[4].canonLength = 56;
				// Front 0.666 gu, sides 0.5333 gu; rear keeps 0.1333 gu above.
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
					all: 1,   // each turret targets independently
					maxDis: 850,
				};
				let c = [{
					reload: 15,
					offTime: 0,
					type: 0,
					life: 75,
					auto: 1,
					autoShoot: 1,
					autoDir: 1,
					///
					offdir: 0,
					offx: 0,
					canonLength: 38.5,
					rand: 0.174533,
					///
					speed: 1.344,
					pene: 2,
					damage: 2.1,
					size: 10.29,
					///
					// Stand-in: same auto-turret row every Auto- class carries, 0.2 gu.
					weight: 1.05,
					push: 0.27426,
					back: 0.336
				}];
				c = c.concat(new Array(3).fill(null).map(() => ({
					reload: 15,
					offTime: 0,
					///
					offdir: 0,
					offx: 0,
					canonLength: 58,
					life: 38,   // rear; c[1] overrides to 75
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
				c[1].back = 0.112; c[1].canonLength = 62; c[1].pene = 1.588235; c[1].damage = 5.775006; c[1].life = 75;
				c[1].weight = 3.5;   // front 0.666 gu
				c[2].offdir = -Math.PI - .4; c[2].offx = -5; c[2].offTime = .5;
				c[3].offdir = -Math.PI + .4; c[3].offx = 5; c[3].offTime = .5;
				///
				this.cannons = c;
			},
			"Overlord": new function () {
				this.screen = BASE_SCREEN / 0.9;
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
					weight: 4.2,   // 0.8 gu, every drone class
					push: 0.45709,
					back: 1.12
				}));
				c[1].offdir = Math.PI / 2;
				c[2].offdir = Math.PI;
				c[3].offdir = Math.PI * 3 / 2;
				this.cannons = c;
			},
			"Manager": new function () {
				this.screen = BASE_SCREEN / 0.9;
				this.maxDrone = 8;
				// Same decay/moving as Stalker, but shooting does not reveal it.
				this.stealth = { decay: 0.03, moving: 0.08, shooting: 0 };
				this.cannons = [];
				const c = [{
					reload: 45,
					offTime: 0,
					type: 1,
					life: -1,
					auto: 1,   // fires on its own up to maxDrone
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
				this.screen = BASE_SCREEN / 0.9;
				this.maxDrone = 22;
				this.flags = { canClaimSquares: true };
				this.necro = {
					type: 3,
					necro: 1,
					///
					speed: 0.8064,   // life stays -1, hardcoded at spawn
					pene: 4,
					damage: 2.94,
					weight: 4.2,   // 0.8 gu, every drone class
					push: 0.5028
				};
				this.cannons = [];
			},
			"BattleShip": new function () {
				this.screen = BASE_SCREEN / 0.9;
				//this.maxDrone = 7;
				this.cannons = [];
				const c = new Array(4).fill(null).map(() => ({
					reload: 15,
					offTime: 0,
					type: 1.2,
					life: 75,
					auto: 0,
					///
					offdir: Math.PI / 2,
					offx: -14,   // auto pair
					canonLength: 52.5,
					rand: 0.174533,
					///
					speed: 1.12,
					pene: 2,
					damage: 1.05,
					size: 7.203,
					///
					weight: 0.525,   // 0.1 gu
					push: 0.04571,
					back: 1.12
				}));
				c[1].offdir = -Math.PI / 2; c[1].offx = -14; c[1].offTime = .5;
				// Controllable pair.
				c[2].offdir = Math.PI / 2; c[2].offx = 14; c[2].offTime = .5;
				c[3].offdir = -Math.PI / 2; c[3].offx = 14;
				c[2].type = c[3].type = 1.3;
				this.cannons = c;
			},
			"Fortress": new function () {
				// No diep counterpart; fieldFactor back-solved to keep this screen.
				this.screen = 1664;
				//this.maxDrone = 7;
				this.cannons = [];
				let c = new Array(3).fill(null).map(() => ({
					reload: 23,   // stand-in: Tri-Trapper
					offTime: 0,
					type: 2,
					life: 240,   // stand-in: Tri-Trapper trap life
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
					// Stand-in: Tri-Trapper's 0.666 gu trap row.
					weight: 3.5,
					push: 0.27426,
					back: 0
				}));
				c[1].offdir = Math.PI * 2 / 3; c[2].offdir = Math.PI * 4 / 3;
				c = c.concat(new Array(3).fill(null).map(() => ({
					reload: 23,
					offTime: .5,
					type: 1.2,
					life: 75,
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
					// Stand-in: Battleship swarm 0.1 gu.
					weight: 0.525,
					push: 0.04571,
					back: 0
				})));
				c[4].offdir = Math.PI * 2 / 3 + Math.PI / 3; c[5].offdir = Math.PI * 4 / 3 + Math.PI / 3;
				this.cannons = c;
			},
			"Mega Trapper": new function () {
				this.screen = BASE_SCREEN / 0.9;
				//this.maxDrone = 7;
				this.cannons = [];
				const c = [{
					reload: 50,
					offTime: 0,
					type: 2,
					life: 600,
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
					weight: 5.6,   // 1.0666 gu, top of the table
					push: 0.27426,
					back: 1.12
				}];
				this.cannons = c;
			},
			"Overtrapper": new function () {
				this.screen = BASE_SCREEN / 0.9;
				this.maxDrone = 4;
				this.droneSplit = true;   // budget split 2/2 per group instead of one pooled count
				let c = [{
					reload: 23,
					offTime: 0,
					type: 2,
					life: 600,
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
					weight: 3.5,   // 0.666 gu
					push: 0.27426,
					back: 1.12
				}];
				c = c.concat(new Array(4).fill(null).map(() => ({
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
					weight: 4.2,   // 0.8 gu
					push: 0.45709,
					back: 1.12
				})));
				// Two spawners (left/right), each holding one controllable drone (type 1) and one
				// uncontrollable one (type 1.1) that only ever runs its own targeting AI.
				c[1].offdir = Math.PI * 2 / 3;
				c[2].offdir = Math.PI * 2 / 3; c[2].type = 1.1;
				c[3].offdir = Math.PI * 4 / 3; c[3].offTime = .5;
				c[4].offdir = Math.PI * 4 / 3; c[4].offTime = .5; c[4].type = 1.1;
				this.cannons = c;
			},
			"Auto Trapper": new function () {
				this.screen = BASE_SCREEN / 0.9;
				this.DETEC = {
					type: [KIND.PLAYER, KIND.OBJECTS],
					size: 1500,
					all: 1,   // each turret targets independently
					maxDis: 800,
				};
				const c = [{
					reload: 15,
					offTime: 0,
					type: 0,
					life: 75,
					auto: 1,
					autoShoot: 1,
					autoDir: 1,
					///
					offdir: 0,
					offx: 0,
					canonLength: 38.5,
					rand: 0.174533,
					///
					speed: 1.344,
					pene: 2,
					damage: 2.1,
					size: 10.29,
					///
					weight: 1.05,   // 0.2 gu
					push: 0.27426,
					back: 0.336
				}];
				c.push({
					reload: 23,
					offTime: 0,
					type: 2,
					life: 600,
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
					weight: 3.5,   // 0.666 gu
					push: 0.27426,
					back: 1.12
				});
				this.cannons = c;
			},
			"Submachine": new function () {
				this.screen = 1408;
				this.cannons = [];
				this.cannons[0] = new function () {
					this.reload = 8;   // stand-in: Machine Gun
					this.offTime = 0;
					///
					this.offdir = 0;
					this.offx = 0;
					this.canonLength = 65;
					this.life = 75;
					this.rand = 0.523599;
					///
					this.speed = 1.12;
					this.pene = 3.529412;
					this.damage = 2.799997;
					this.size = 23;
					///
					// Stand-in: Machine Gun's 0.4666 gu.
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
					offTime: .75,   // index 0 takes the positive-offset barrel, matching the client
					///
					offdir: 0,
					offx: 22.4,
					canonLength: 45.5,
					life: 75,
					rand: 0.174533,
					///
					speed: 1.232,
					pene: 0.9,
					damage: 3.5,
					size: 8.82,
					///
					// Stand-in: Gunner Trapper bullet 0.333 gu (table omits plain Gunner).
					weight: 1.75,
					push: 0.45709,
					back: 0.224
				})));
				c[1].offx = -22.4; c[1].offTime = .5;
				c[2].canonLength = c[3].canonLength = 59.5;
				c[2].offx = 11.9; c[2].offTime = .25;
				c[3].offx = -11.9; c[3].offTime = 0;
				this.cannons = c;
			},
			'Auto Gunner': new function () {
				this.screen = 1408;
				this.DETEC = {
					type: [KIND.PLAYER, KIND.OBJECTS],
					size: 700,
					all: 1,   // each turret targets independently
					maxDis: 800,
				};
				let c = [{
					reload: 15,
					offTime: 0,
					type: 0,
					life: 75,
					auto: 1,
					autoShoot: 1,
					autoDir: 1,
					///
					offdir: 0,
					offx: 0,
					canonLength: 38.5,
					rand: 0.174533,
					///
					speed: 1.344,
					pene: 2,
					damage: 2.1,
					size: 10.29,
					///
					weight: 1.05,   // 0.2 gu
					push: 0.27426,
					back: 0.336
				}];
				c = c.concat(new Array(4).fill(null).map(() => ({
					reload: 15,
					offTime: .75,
					///
					offdir: 0,
					offx: 22.4,
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
					back: 0.224
				})));
				c[2].offx = -22.4; c[2].offTime = .5;
				c[3].canonLength = c[4].canonLength = 59.5;
				c[3].offx = 11.9; c[3].offTime = .25;
				c[4].offx = -11.9; c[4].offTime = 0;
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
				this.screen = 1120;
				// bossSize is the square's apothem: 150 du circumradius x 0.56 x cos(pi/4).
				this.bossSize = 59.396970;
				this.cannons = [];
				this.boss = true;
				this.maxDrone = 28;
				const c = new Array(4).fill(null).map(() => ({
					reload: 5.4,
					offTime: 0,
					auto: 1,
					type: 3.1,
					life: -1,   // permanent; Guardian's drones are finite instead
					///
					offdir: 0,
					offx: 0,
					// Barrel dims: du x 0.56 x 35/bossSize. Drone size is reference-relative
					// (spawned radius = size x ra) so a spawned drone matches a Necromancer square.
					canonLength: 44.547727,
					rand: 0.174533,
					speed: 1.904,
					pene: 25,
					damage: 3.92,
					size: 12.833988,
					drawColor: 9,   // necro beige, not the boss's own yellow
					///
					weight: 4.2,   // 0.8 gu, every drone class
					push: 0.45709,
					back: 0
				}));
				c[1].offdir = Math.PI / 2; c[1].offTime = .5;
				c[2].offdir = Math.PI;
				c[3].offdir = Math.PI * 1.5; c[3].offTime = .5;
				this.cannons = c;
			},
			/*
				Bosses are ordinary Player instances with motion()/update() rebound at spawn.
				`bossSize` is read by createBoss(); `boss: true` marks them.
			*/
			"Guardian": new function () {
				this.screen = 1120;
				// bossSize is the triangle's apothem (135 du circumradius x 0.56 / 2).
				this.bossSize = 37.8;
				this.hitRatio = Math.SQRT2;
				this.boss = true;
				this.maxDrone = 24;
				// One backward spawner. Drones are finite-life (not -1), so droneCap opts this
				// cannon into the maxDrone cap. drawType 6 draws a small Crasher, not a square.
				this.cannons = [{
					reload: 5.4, offTime: 0, auto: 1, type: 3.1, drawType: 6, life: 112.5,
					droneCap: 1,
					offdir: Math.PI, offx: 0, canonLength: 51.851852, rand: 0.174533,
					speed: 1.904, pene: 25, damage: 3.92, size: 12.833333,
					weight: 4.2, push: 0.45709, back: 0
				}];
			},
			"Defender": new function () {
				// Never chases; screen is camera-FOV only. bossSize is the triangle's apothem
				// (150 du circumradius x 0.56 x 0.5). Turrets first in cannons so canDir[0..2]
				// feed the client's turret array; traps follow, a half-slot off.
				this.screen = BASE_SCREEN;
				this.bossSize = 42;
				this.hitRatio = Math.SQRT2;
				this.boss = true;
				this.DETEC = { type: [KIND.PLAYER, KIND.OBJECTS], size: 800, all: 1, maxDis: 800 };
				const traps = [0, 1, 2].map(i => ({
					reload: 75, offTime: 0, auto: 1, type: 2, life: 600,
					offdir: Math.PI * 2 * i / 3 + Math.PI / 3, offx: 0, canonLength: 56, rand: 0.174533,
					speed: 5.6, pene: 25, damage: 28, size: 16.66,
					weight: 4.2, push: 0.45709, back: 2.24
				}));
				const turrets = [0, 1, 2].map(i => ({
					reload: 15, offTime: 0, auto: 1, autoDir: 1, autoShoot: 1, life: 75,
					offdir: Math.PI * 2 * i / 3, offx: 0, distance: 28, canonLength: 25.667, rand: 0.174533,
					speed: 2.7552, pene: 11.5, damage: 8.4, size: 6.86,
					weight: 4.2, push: 0.45709, back: 0.336
				}));
				this.cannons = turrets.concat(traps);
			},
			// Overlord geometry; barrels convert on the ordinary 0.7 axis. bossSize is
			// 50 du scaled to level 75: 50 x 1.01^74 x 0.56.
			"Fallen Overlord": new function () {
				this.screen = 1120;
				this.bossSize = 58.46;
				this.boss = true;
				this.fallen = true;   // base drones engage on sight, not only when provoked
				this.maxDrone = 28;   // droneCount 7 x 4 barrels
				// Absolute overrides, not scaled off Overlord's own bullet stats.
				this.cannons = [0, 1, 2, 3].map(i => ({
					reload: 5.4, offTime: 0, type: 1, life: -1, auto: 1,
					offdir: Math.PI * i / 2, offx: 0, canonLength: 49, rand: 0.174533,
					speed: 1.904, pene: 25, damage: 3.92, size: 5.850498,
					weight: 4.2, push: 0.45709, back: 0.112
				}));
			},
			// Booster geometry; damage is 0.8x Booster's per-barrel figure. Same bossSize as Fallen Overlord.
			"Fallen Booster": new function () {
				this.screen = 1120;
				this.bossSize = 58.46;
				this.boss = true;
				this.fallen = true;   // base drones engage on sight, not only when provoked
				const c = new Array(5).fill(null).map(() => ({
					reload: 15, offTime: 0, auto: 1,
					offdir: 0, offx: 0, canonLength: 49, life: 38, rand: 0.174533,
					speed: 1.904, pene: 12.5, damage: 1.12, size: 14.7,
					weight: 0.7, push: 0.45709, back: 0.224
				}));
				c[0].back = 0.224; c[0].canonLength = 66.5; c[0].size = 14.7; c[0].damage = 5.6; c[0].life = 75;
				c[0].weight = 3.5;
				c[1].offdir = -Math.PI - .65; c[1].offx = -6;
				c[2].offdir = -Math.PI + .65; c[2].offx = 6;
				c[3].offdir = -Math.PI - .35; c[3].offx = -5; c[3].canonLength = 56; c[3].offTime = .5; c[3].back = 2.8;
				c[4].offdir = -Math.PI + .35; c[4].offx = 5; c[4].canonLength = 56; c[4].offTime = .5; c[4].back = 2.8;
				this.cannons = c;
			},
			/*
				Tag's win-condition NPC. Body damage and body size live on the spawned instance.
				`back` is 0 so firing does not kick it (it also takes no knockback).
			*/
			"Arena Closer": new function () {
				this.screen = 2000;
				// AI drives inputs.e when it has a target; no per-barrel auto, so a sandbox-cycled
				// AC only fires when told to.
				const c = new Array(1).fill(null).map(() => ({
					reload: 15,
					offTime: 0,
					type: 0,
					life: 75,
					///
					offdir: 0,
					offx: 0,
					canonLength: 52.5,
					rand: 0.174533,
					///
					speed: 2.24,
					pene: 3750,
					damage: 196,
					size: 14.7,
					///
					weight: 0.525,
					push: 0.27426,
					back: 0
				}));
				this.cannons = c;
			},
			/*
				Stationary; `back: 0` everywhere. Aimed by the Dominator AI (or a possessed
				human), not per-barrel auto-turrets. DETEC size is detection range, not camera
				width - spawn applies FOV_MUL only to the instance's `screen`.
			*/
			"Destroyer Dominator": new function () {
				this.screen = screenAtLevel(75, 1);
				this.DETEC = { type: [KIND.PLAYER, KIND.OBJECTS], size: this.screen, all: 0, maxDis: this.screen };
				this.guards = [{ sizeRatio: 1.24, sides: 6, rate: 0, phase: 0 }];
				this.cannons = [{
					reload: 45,
					offTime: 0,
					type: 0,
					life: 149,
					///
					offdir: 0,
					offx: 0,
					canonLength: 56,
					rand: 0.10,
					///
					speed: 1.12,
					pene: 200,
					damage: 70,
					size: 12.25,
					///
					weight: 1.05,
					push: 0.27426,
					back: 0
				}];
			},
			"Gunner Dominator": new function () {
				this.screen = screenAtLevel(75, 1);
				this.DETEC = { type: [KIND.PLAYER, KIND.OBJECTS], size: this.screen, all: 0, maxDis: this.screen };
				this.guards = [{ sizeRatio: 1.24, sides: 6, rate: 0, phase: 0 }];
				// Three forward barrels, differentiated by offx and staggered offTime.
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
				this.screen = screenAtLevel(75, 1);
				this.DETEC = { type: [KIND.PLAYER, KIND.OBJECTS], size: this.screen, all: 0, maxDis: this.screen };
				this.guards = [{ sizeRatio: 1.24, sides: 6, rate: 0, phase: 0 }];
				const c = new Array(8).fill(null).map((_, i) => ({
					reload: 23,
					offTime: 0,
					// Always fire, each along its own fixed offdir - radial, not toward DETEC.
					auto: 1,
					type: 2,
					life: 297,
					///
					offdir: i * Math.PI / 4,
					offx: 0,
					canonLength: 42,
					rand: 0.3,
					///
					speed: 4.48,
					pene: 40,
					damage: 21,
					size: 5.88,
					///
					weight: 3.5,
					push: 0.27426,
					back: 0
				}));
				this.cannons = c;
			},
			///
			// weight/push have no knockback-table row for these classes; each inherits a relative.
			"Smasher": new function () {
				this.screen = BASE_SCREEN / 0.9;
				this.cannons = [];
				this.guards = [{ sizeRatio: 1.15, sides: 6, rate: 0.1, phase: 0 }];
				this.statMax = [10, 0, 0, 0, 0, 10, 10, 10];
			},
			"Landmine": new function () {
				this.screen = BASE_SCREEN / 0.9;
				this.cannons = [];
				this.guards = [
					{ sizeRatio: 1.15, sides: 6, rate: 0.1, phase: 0 },
					{ sizeRatio: 1.15, sides: 6, rate: 0.05, phase: 0 }
				];
				this.statMax = [10, 0, 0, 0, 0, 10, 10, 10];
				this.flags = { invisibility: true };
				// Stealthier than Stalker's 0.03/0.08/0.23 trio; shooting does not reveal it.
				this.stealth = { decay: 0.003, moving: 0.16, shooting: 0 };
			},
			"Auto Smasher": new function () {
				this.screen = BASE_SCREEN / 0.9;
				this.guards = [{ sizeRatio: 1.15, sides: 6, rate: 0.1, phase: 0 }];
				this.cannons = [{
					reload: 15, offTime: 0, type: 0, life: 75,
					auto: 1, autoShoot: 1, autoDir: 1,
					offdir: 0, offx: 0, canonLength: 38.5, rand: 0.174533,
					speed: 1.344, pene: 2, damage: 2.1, size: 10.29,
					weight: 1.05, push: 0.27426, back: 0.336
				}];
				this.DETEC = { type: [KIND.PLAYER, KIND.OBJECTS], size: 800, all: 1, maxDis: 850 };   // has an autoDir cannon
				this.statMax = [10, 10, 10, 10, 10, 10, 10, 10];
			},
			"Spike": new function () {
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
			"Hunter": new function () {
				this.screen = BASE_SCREEN / 0.85;
				const c = [
					{ reload: 38, offTime: 0, offdir: 0, offx: 0, canonLength: 77, life: 75, rand: 0.05236,
						speed: 1.568, pene: 2, damage: 5.25, size: 10.29, weight: 3.5, push: 0.54851, back: 0.336 },
					{ reload: 38, offTime: 0.2, offdir: 0, offx: 0, canonLength: 66.5, life: 75, rand: 0.05236,
						speed: 1.568, pene: 2, damage: 5.25, size: 13.8915, weight: 3.5, push: 0.54851, back: 0.336 }
				];
				this.cannons = c;
			},
			"Predator": new function () {
				this.screen = BASE_SCREEN / 0.85;
				this.flags = { zoomAbility: true };   // data-only; no right-click zoom yet
				const c = [0, 0.2, 0.4].map((offTime, i) => ({
					reload: 45, offTime, offdir: 0, offx: 0, canonLength: [77, 66.5, 56][i], life: 75, rand: 0.05236,
					speed: 1.568, pene: 2, damage: 5.25, size: [10.29, 13.8915, 17.493][i], weight: 3.5, push: 0.54851, back: 0.336
				}));
				this.cannons = c;
			},
			"Streamliner": new function () {
				const lens = [77, 70, 63, 56, 49];
				this.screen = BASE_SCREEN / 0.85;
				const c = lens.map((canonLength, i) => ({
					reload: 15, offTime: i * 0.2, offdir: 0, offx: 0, canonLength, life: 60, rand: 0.05236,
					speed: 1.232, pene: 2, damage: 1.4, size: 10.29, weight: 1.75, push: 0.45709, back: 0.224
				}));
				this.cannons = c;
			},
			"Stalker": new function () {
				this.screen = BASE_SCREEN / 0.8;
				this.flags = { invisibility: true };
				this.stealth = { decay: 0.03, moving: 0.08, shooting: 0.23 };
				this.cannons = [{
					reload: 30, offTime: 0, offdir: 0, offx: 0, canonLength: 84, life: 75, rand: 0.05236,
					speed: 1.68, pene: 2, damage: 7, size: 14.7, weight: 3.5, push: 0.54851, back: 3.36
				}];
			},
			"Auto 3": new function () {
				this.screen = BASE_SCREEN;
				this.DETEC = { type: [KIND.PLAYER, KIND.OBJECTS], size: 800, all: 1, maxDis: 850 };
				this.cannons = [0, 1, 2].map(i => ({
					reload: 15, offTime: 0, type: 0, life: 75,
					auto: 1, autoShoot: 1, autoDir: 1,
					// Reads this.ringDir for mount/idle aim. distance 28 is 0.8 x CONST.SIZE.
					ring: true,
					offdir: i * Math.PI * 2 / 3, offx: 0, canonLength: 38.5, distance: 28, rand: 0.174533,
					speed: 1.344, pene: 2, damage: 2.8, size: 10.29,
					weight: 1.05, push: 0.27426, back: 0.336
				}));
			},
			"Auto 5": new function () {
				this.screen = BASE_SCREEN;
				this.DETEC = { type: [KIND.PLAYER, KIND.OBJECTS], size: 800, all: 1, maxDis: 850 };
				this.cannons = [0, 1, 2, 3, 4].map(i => ({
					reload: 15, offTime: 0, type: 0, life: 75,
					auto: 1, autoShoot: 1, autoDir: 1,
					ring: true,
					offdir: i * Math.PI * 2 / 5, offx: 0, canonLength: 38.5, distance: 28, rand: 0.174533,
					speed: 1.344, pene: 2, damage: 2.8, size: 10.29,
					weight: 1.05, push: 0.27426, back: 0.336
				}));
			},
			// Fanned pairs outermost first, centre last so it draws on top of the fan.
			"Spread Shot": new function () {
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
			"Gunner Trapper": new function () {
				this.screen = BASE_SCREEN / 0.9;
				this.cannons = [
					{ reload: 15, offTime: 0.66, offdir: 0, offx: 10, canonLength: 52.5, life: 75, rand: 0.174533,
						speed: 1.12, pene: 2, damage: 3.5, size: 7.35, weight: 1.75, push: 0.45709, back: 1.12 },
					{ reload: 15, offTime: 0.33, offdir: 0, offx: -10, canonLength: 52.5, life: 75, rand: 0.174533,
						speed: 1.12, pene: 2, damage: 3.5, size: 7.35, weight: 1.75, push: 0.45709, back: 1.12 },
					{ reload: 45, offTime: 0, type: 2, life: 600, offdir: Math.PI, offx: 0, canonLength: 42,
						rand: 0.174533, speed: 2.24, pene: 4, damage: 7, size: 15.288, weight: 3.5, push: 0.27426, back: 1.12 }
				];
			},
			"Tri-Trapper": new function () {
				this.screen = BASE_SCREEN / 0.9;
				this.cannons = [0, 1, 2].map(i => ({
					reload: 23, offTime: 0, type: 2, life: 240,
					offdir: i * Math.PI * 2 / 3, offx: 0, canonLength: 42, rand: 0.174533,
					speed: 2.24, pene: 4, damage: 7, size: 11.76, weight: 3.5, push: 0.27426, back: 1.12
				}));
			},
			"Skimmer": new function () {
				this.screen = BASE_SCREEN / 0.9;
				this.cannons = [{
					// type 4: a spinning bullet with a pair of opposed sub-barrels. `sub.reloadRef`
					// is a multiplier on the owner's live reload, read each sub-fire, not baked at spawn.
					// sub.size matches the secondary nub's drawn half-width.
					reload: 60, offTime: 0, type: 4, offdir: 0, offx: 0, canonLength: 56, life: 98, rand: 0.174533,
					speed: 0.56, pene: 6, damage: 7, size: 24.99, weight: 1.05, push: 0.27426, back: 3.36,
					sub: { reloadRef: 5.25, damage: 4.2, pene: 0.6, speed: 1.232, size: 10.059534, life: 18.75, rand: 0.174533, weight: 1.05, push: 0.27426 }
				}];
			},
			"Factory": new function () {
				this.screen = BASE_SCREEN / 0.9;
				this.maxDrone = 6;
				this.cannons = [{
					// type 1.5 minion: fires on its own cadence up to maxDrone. size is the minion
					// body (20% above an ordinary bullet of this barrel). weapon.size converts
					// against the minion's own reference body, not the Factory's.
					auto: 1, reload: 45, offTime: 0, type: 1.5, life: -1, offdir: 0, offx: 0, canonLength: 49, rand: 0.174533,
					speed: 0.6272, pene: 8, damage: 4.9, size: 17.64, weight: 4.2, push: 0.36567, back: 1.12,
					weapon: { reloadRef: 15, damage: 2.8, pene: 0.8, speed: 0.896, size: 8.89056, life: 75, rand: 0.174533, weight: 4.2, push: 0.36567 }
				}];
				this.ups = ['Health Regen', 'Max Health', 'Body Damage', 'Drone Speed', 'Drone Health', 'Drone Damage', 'Reload', 'Movement Speed'];
			},
			"Mothership": new function () {
				this.screen = screenAtLevel(140, 1); // level-140 camera
				this.maxDrone = 32;
				// Split drone budget: 16 controllable + 16 not, rather than pooling all 32.
				this.droneSplit = true;
				// bossSize is the drawn apothem of a 16-gon at level-140 circumradius.
				this.bossSize = 109.497178;
				this.absorbtionFactor = 0.01;
				this.DETEC = { type: [KIND.PLAYER, KIND.OBJECTS], size: this.screen, all: 0, maxDis: this.screen };
				this.cannons = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(i => ({
					auto: 1, reload: 90, offTime: 0,
					// Even barrels are mouse-controllable (type 1); odd barrels stay AI (type 1.1).
					type: (i % 2 === 0) ? 1 : 1.1, life: -1,
					// Half-step so barrels sit between 16-gon vertices rather than on them.
					offdir: Math.PI / 16 + i * Math.PI * 2 / 16, offx: 0,
					canonLength: 10.740003, rand: 0.174533,
					// Shared drone speed; this class's own figure lets a maxed tank outrun the swarm.
					speed: 0.896, pene: 4, damage: 4.9,
					size: 0.939750, weight: 4.2, push: 0.36567, back: 0
				}));
				this.ups = ['Health Regen', 'Max Health', 'Body Damage', 'Drone Speed', 'Drone Health', 'Drone Damage', 'Reload', 'Movement Speed'];
			}
		};
	///
	exports.defaultUps = [
		'Health Regen',
		'Max Health',
		'Body Damage',
		'Bullet Speed',
		'Bullet Penetration',
		'Bullet Damage',
		'Reload',
		'Movement Speed'
	];
	/*
		Tier index is the level gate: upClass() unions every tier up to parseInt(level / 15),
		so tier 0 opens at 15, tier 1 at 30, tier 2 at 45. An edge's tier is when it unlocks,
		not how many evolutions precede it — two edges from the same parent can open at
		different levels. Basic -> Smasher is a level-30 edge; Machine Gun -> Sprayer is
		level-45. Auto Hover and Fortress live under the dev-only `pre launch` node.
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
			// Smasher is a level-30 edge, so its children sit here (level 45).
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
		// Appended after existing names so wire-enum class indexes do not shift.
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
		'Guardian',
		'Defender',
		'Fallen Overlord',
		'Fallen Booster'
	];

})(typeof (exports) === 'undefined' ? function () { this['TanksConfig'] = {}; return this['TanksConfig'] }() : exports,
	typeof (exports) === 'undefined' ? 'client' : 'server')
