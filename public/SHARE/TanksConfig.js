(function (exports, platform) {

	// Entity type tags, shared with the server's collision/AI dispatch. kinds.js loads before
	// this file (as a <script> in play.ejs, and via require() in Node), so the three DETEC
	// auto-turret filters below can name KIND.PLAYER / KIND.OBJECTS instead of hardcoding the
	// string literals - see public/SHARE/kinds.js.
	const KIND = (platform === 'client') ? globalThis.KIND : require('./kinds.js');

	exports.class = (platform === 'client') ?
		///CLIENTS///
		{
			"Basic": {
				cannons: [
					{
						type: 0,
						height: 68,
						width: 32,
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
						height: 60,
						width: 27,
						offx: 18,
						offdir: 0,
						open: 0,
					},
					{
						type: 0,
						height: 60,
						width: 27,
						offx: -18,
						offdir: 0,
						open: 0
					}
				],
				body: {
					shape: 0,
				}
			},
			"Machine Gun": {
				cannons: [
					{
						type: 0,
						height: 62,
						width: 26,
						offx: 0,
						offdir: 0,
						open: 21
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
						height: 80,
						width: 30,
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
						height: 65,
						width: 32,
						offx: 0,
						offdir: 0,
						open: 0
					},
					{
						type: 0,
						height: 58,
						width: 30,
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
						height: 58,
						width: 27,
						offx: 6,
						offdir: .4,
						open: 0,
					},
					{
						type: 0,
						height: 58,
						width: 27,
						offx: -6,
						offdir: -.4,
						open: 0
					},
					{
						type: 0,
						height: 65,
						width: 28,
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
						height: 60,
						width: 27,
						offx: -18,
						offdir: 0,
						open: 0,
					},
					{
						type: 0,
						height: 60,
						width: 27,
						offx: 18,
						offdir: 0,
						open: 0
					},
					{
						type: 0,
						height: 60,
						width: 27,
						offx: -18,
						offdir: Math.PI,
						open: 0,
					},
					{
						type: 0,
						height: 60,
						width: 27,
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
						height: 66,
						width: 27,
						offx: 0,
						offdir: 0,
						open: 0,
					},
					{
						type: 0,
						height: 66,
						width: 27,
						offx: 0,
						offdir: Math.PI / 2,
						open: 0
					},
					{
						type: 0,
						height: 66,
						width: 27,
						offx: 0,
						offdir: Math.PI,
						open: 0
					},
					{
						type: 0,
						height: 66,
						width: 27,
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
						height: 62,
						width: 48,
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
						height: 85,
						width: 30,
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
						type: 0,
						height: 48,
						width: 28,
						offx: 0,
						offdir: Math.PI / 2,
						open: 23,
					},
					{
						type: 0,
						height: 48,
						width: 28,
						offx: 0,
						offdir: -Math.PI / 2,
						open: 23
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
				body: {
					shape: 0,
				}
			},
			"Trapper": {
				cannons: [
					{
						type: 1,
						height: 65,
						width: 27,
						openlength: 16,
						offx: 0,
						offdir: 0,
						open: 18
					}
				],
				body: {
					shape: 0,
				}
			},
			///
			"Rocket": {
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
						height: 62,
						width: 48,
						offx: 0,
						offdir: 0,
						open: 0
					},
					{
						type: 0,
						height: 48,
						width: 28,
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
						height: 64,
						width: 70,
						offx: 0,
						offdir: 0,
						open: 0
					}
				],
				body: {
					shape: 0,
				}
			},
			"Sprayer": {
				cannons: [
					{
						type: 0,
						height: 82,
						width: 29,
						offx: 0,
						offdir: 0,
						open: 0
					},
					{
						type: 0,
						height: 82 - 7,
						width: 29,
						offx: 0,
						offdir: 0,
						open: 0
					},
					{
						type: 0,
						height: 82 - 7 * 2,
						width: 29,
						offx: 0,
						offdir: 0,
						open: 0
					},
					{
						type: 0,
						height: 82 - 7 * 3,
						width: 29,
						offx: 0,
						offdir: 0,
						open: 0
					},
					{
						type: 0,
						height: 82 - 7 * 4,
						width: 29,
						offx: 0,
						offdir: 0,
						open: 0
					},
				],
				body: {
					shape: 0,
				}
			},
			"Ranger": {
				cannons: [
					{
						type: 0,
						height: 88,
						width: 30,
						offx: 0,
						offdir: 0,
						open: 0
					},
					{
						type: 0,
						height: 45,
						width: 60,
						offx: 0,
						offdir: 0,
						open: -30
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
						height: 62,
						width: 32,
						offx: 0,
						offdir: 0,
						open: 0
					},
					///
					{
						type: 0,
						height: 52,
						width: 27,
						offx: -6,
						offdir: -Math.PI - .65,
						open: 0,
					},
					{
						type: 0,
						height: 52,
						width: 27,
						offx: 6,
						offdir: -Math.PI + .65,
						open: 0
					},
					///
					{
						type: 0,
						height: 58,
						width: 27,
						offx: -5,
						offdir: -Math.PI - .35,
						open: 0,
					},
					{
						type: 0,
						height: 58,
						width: 27,
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
						height: 65,
						width: 32,
						offx: 0,
						offdir: 0,
						open: 0
					},
					///
					{
						type: 0,
						height: 57,
						width: 27,
						offx: 1,
						offdir: -Math.PI / 2,
						open: 0,
					},
					{
						type: 0,
						height: 57,
						width: 27,
						offx: -1,
						offdir: Math.PI / 2,
						open: 0
					},
					///
					{
						type: 0,
						height: 59,
						width: 27,
						offx: -5,
						offdir: -Math.PI - .4,
						open: 0,
					},
					{
						type: 0,
						height: 59,
						width: 27,
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
						height: 38,
						width: 21,
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
						height: 55,
						width: 27,
						offx: 17,
						offdir: 0,
						open: 0,
					},
					{
						type: 0,
						height: 55,
						width: 27,
						offx: -17,
						offdir: 0,
						open: 0
					},
					{
						type: 0,
						height: 60,
						width: 28,
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
						height: 60,
						width: 27,
						offx: -18,
						offdir: 0,
						open: 0,
					},
					{
						type: 0,
						height: 60,
						width: 27,
						offx: 18,
						offdir: 0,
						open: 0
					},
					{
						type: 0,
						height: 60,
						width: 27,
						offx: -18,
						offdir: Math.PI * 2 / 3,
						open: 0,
					},
					{
						type: 0,
						height: 60,
						width: 27,
						offx: 18,
						offdir: Math.PI * 2 / 3,
						open: 0
					},
					{
						type: 0,
						height: 60,
						width: 27,
						offx: -18,
						offdir: Math.PI * 4 / 3,
						open: 0,
					},
					{
						type: 0,
						height: 60,
						width: 27,
						offx: 18,
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
						height: 55,
						width: 27,
						offx: 7,
						offdir: .6,
						open: 0,
					},
					{
						type: 0,
						height: 55,
						width: 27,
						offx: -7,
						offdir: -.6,
						open: 0
					},
					{
						type: 0,
						height: 63,
						width: 27,
						offx: 3,
						offdir: .3,
						open: 0,
					},
					{
						type: 0,
						height: 63,
						width: 27,
						offx: -3,
						offdir: -.3,
						open: 0
					},
					{
						type: 0,
						height: 69,
						width: 28,
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
						height: 62,
						width: 27,
						offx: 0,
						offdir: 0,
						open: 0,
					},
					{
						type: 0,
						height: 62,
						width: 27,
						offx: 0,
						offdir: Math.PI / 4,
						open: 0
					},
					{
						type: 0,
						height: 62,
						width: 27,
						offx: 0,
						offdir: Math.PI * .5,
						open: 0
					},
					{
						type: 0,
						height: 62,
						width: 27,
						offx: 0,
						offdir: Math.PI * .75,
						open: 0
					},
					{
						type: 0,
						height: 62,
						width: 27,
						offx: 0,
						offdir: Math.PI,
						open: 0,
					},
					{
						type: 0,
						height: 62,
						width: 27,
						offx: 0,
						offdir: Math.PI * 1.25,
						open: 0
					},
					{
						type: 0,
						height: 62,
						width: 27,
						offx: 0,
						offdir: Math.PI * 1.5,
						open: 0
					},
					{
						type: 0,
						height: 62,
						width: 27,
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
						type: 0,
						height: 48,
						width: 28,
						offx: 0,
						offdir: 0,
						open: 23,
					},
					{
						type: 0,
						height: 48,
						width: 28,
						offx: 0,
						offdir: Math.PI / 2,
						open: 23
					},
					{
						type: 0,
						height: 48,
						width: 28,
						offx: 0,
						offdir: Math.PI,
						open: 23
					},
					{
						type: 0,
						height: 48,
						width: 28,
						offx: 0,
						offdir: Math.PI * 3 / 2,
						open: 23
					},
				],
				body: {
					shape: 0,
				}
			},
			"Necromancer": {
				cannons: [
					{
						type: 0,
						height: 52,
						width: 23,
						offx: 0,
						offdir: Math.PI / 2,
						open: 28,
					},
					{
						type: 0,
						height: 52,
						width: 23,
						offx: 0,
						offdir: -Math.PI / 2,
						open: 28
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
			"Manager": {
				cannons: [
					{
						type: 0,
						height: 48,
						width: 28,
						offx: 0,
						offdir: 0,
						open: 23,
					},
				],
				body: {
					shape: 0,
				}
			},
			"BattleShip": {
				cannons: [
					{
						type: 0,
						height: 48,
						width: 33,
						offx: 12,
						offdir: Math.PI / 2,
						open: -16,
					},
					{
						type: 0,
						height: 48,
						width: 33,
						offx: -12,
						offdir: -Math.PI / 2,
						open: -16
					},
					{
						type: 0,
						height: 48,
						width: 33,
						offx: -12,
						offdir: Math.PI / 2,
						open: -16,
					},
					{
						type: 0,
						height: 48,
						width: 33,
						offx: 12,
						offdir: -Math.PI / 2,
						open: -16
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
						type: 1,
						height: 68,
						width: 33,
						openlength: 20,
						offx: 0,
						offdir: 0,
						open: 30
					}
				],
				body: {
					shape: 0,
				}
			},
			"Overtrapper": {
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
						type: 0,
						height: 48,
						width: 28,
						offx: 0,
						offdir: Math.PI * 2 / 3,
						open: 23,
					},
					{
						type: 0,
						height: 48,
						width: 28,
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
						type: 1,
						height: 65,
						width: 27,
						openlength: 16,
						offx: 0,
						offdir: 0,
						open: 18
					}
				],
				turrets: [
					{
						type: 0,
						height: 38,
						width: 21,
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
						height: 45,
						width: 20,
						offx: 24,
						offdir: 0,
						open: 0
					},
					{
						type: 0,
						height: 45,
						width: 20,
						offx: -24,
						offdir: 0,
						open: 0
					},
					///
					{
						type: 0,
						height: 58,
						width: 19,
						offx: 13,
						offdir: 0,
						open: 0
					},
					{
						type: 0,
						height: 58,
						width: 19,
						offx: -13,
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
						height: 45,
						width: 20,
						offx: 24,
						offdir: 0,
						open: 0
					},
					{
						type: 0,
						height: 45,
						width: 20,
						offx: -24,
						offdir: 0,
						open: 0
					},
					///
					{
						type: 0,
						height: 58,
						width: 19,
						offx: 13,
						offdir: 0,
						open: 0
					},
					{
						type: 0,
						height: 58,
						width: 19,
						offx: -13,
						offdir: 0,
						open: 0
					},
				],
				turrets: [
					{
						type: 0,
						height: 38,
						width: 21,
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
			// height 44 draws the barrel a little SHORT of the server's spawn radius
			// (canonLength: 50 * .93 = 46.5) instead of a little past it like every other class -
			// left alone on purpose. See PENDING.md's boss balance-call item: the server's 50 is a
			// floor (a boss's body radius is 64 - rooms/Room.js - and shortening it draws drones
			// spawning inside their own boss), so closing the gap means growing the drawn barrel
			// instead, which is a visible silhouette change on a boss and a human call, not a sync.
			Summoner: {
				cannons: [
					{
						type: 0,
						height: 44,
						width: 20,
						offx: 0,
						offdir: 0,
						open: 28,
					},
					{
						type: 0,
						height: 44,
						width: 20,
						offx: 0,
						offdir: Math.PI / 2,
						open: 28
					},
					{
						type: 0,
						height: 44,
						width: 20,
						offx: 0,
						offdir: Math.PI,
						open: 28
					},
					{
						type: 0,
						height: 44,
						width: 20,
						offx: 0,
						offdir: -Math.PI / 2,
						open: 28
					}
				],
				body: {
					shape: 1,
					width: 1,
					height: 1
				}
			},
			// PENDING #28. One forward cannon, drawn like every ordinary single-barrel class -
			// diep_wiki/Arena Closer.txt describes the barrel as Flank-Guard-shaped, not exotic, so
			// height mirrors Flank Guard's own forward cannon (client height == server canonLength
			// exactly, test/tanks.js's gap check passes the same way there) rather than a guess -
			// only width/open grew, to carry the wiki's "shortest and widest cannons" trivia.
			// Body is shape 0 (a plain circle, Drawings.body[0]) - diep_wiki: "a large yellow
			// circular base". PENDING #51 flagged this as unsatisfactory when it still copied the
			// boss/Dominator convention's shape 1 (Drawings.body[1] is a rounded RECTANGLE, not a
			// circle - a real rendering bug, not a design placeholder). Summoner and the Dominator
			// variants keep shape 1 on purpose (their own bodies, not reopened here).
			"Arena Closer": {
				cannons: [
					{
						type: 0,
						height: 68,
						width: 34,
						offx: 0,
						offdir: 0,
						open: 34
					}
				],
				body: {
					shape: 0
				}
			},
			// PENDING #27. A Dominator is a stationary tank (lib/gameAI.js's CONFIG.DOMINATOR),
			// drawn the same circular boss/Closer body (shape 1) rather than an ordinary tank's
			// octagon - the closest existing convention for a large, non-levelling scripted tank.
			// Every cannon's client `height` is set equal to its own server `canonLength` (a
			// small, ordinary muzzle-tip gap once run through test/tanks.js's *.93 check - no
			// whitelist entry needed, unlike Summoner's).
			"Destroyer Dominator": {
				cannons: [
					{
						type: 0,
						height: 62,
						width: 48,
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
			// Three barrels evenly spaced (diep_wiki/Dominator.txt), not Gunner's own forward
			// cross layout - the Dominator variant differs from Gunner in barrel count/placement,
			// so its own layout is drawn rather than copied.
			"Gunner Dominator": {
				cannons: [0, 1, 2].map((i) => ({
					type: 0,
					height: 45,
					width: 20,
					offx: 0,
					offdir: i * Math.PI * 2 / 3,
					open: 0
				})),
				body: {
					shape: 1,
					width: 1,
					height: 1
				}
			},
			// Eight launchers evenly spaced (diep_wiki/Dominator.txt), drawn like Trapper's own
			// trap barrel (type 1, the same openlength/open shape).
			"Trapper Dominator": {
				cannons: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
					type: 1,
					height: 68,
					width: 27,
					openlength: 16,
					offx: 0,
					offdir: i * Math.PI / 4,
					open: 18
				})),
				body: {
					shape: 1,
					width: 1,
					height: 1
				}
			}
		} :
		///SERVER///
		/*
			Every number below is denominated against config.REF_TICK_MS (40ms), not the server's
			actual TICK_MS - see lib/tick.js. Three columns are worth naming because they are the
			ones a reader is most likely to try to "fix":

			`speed` is a bullet's CRUISE THRUST, an acceleration per reference tick squared. It is
			consumed by entities/Bullet.js's motion tail as tick.quadratic(), not tick.perTick() -
			the tail adds it to a velocity and then integrates that velocity into a position, i.e.
			it integrates twice over ticks. The whole column was multiplied by 1.6 when that
			category was corrected, which is why each entry is a clean diep-ish number times
			public/SHARE/Physics.js's compound 1.462688 factor (0.31 x 1.462688 = 0.45344 for
			Basic), the same family `back` and `weight` are already in. `exitSpeed` was NOT
			rescaled with it - a bullet's one-time muzzle kick was correct before that fix - so
			entities/Bullet.js divides the 1.6 back out at that one site (SPEED_RESCALE there).

			`back` is RECOIL, and it is the one column here that is fully derived rather than tuned:
			it is diep's own per-shot recoil table (physics.html's "Tanks Recoil", in GRID SQUARES)
			run through `back = gu x 28 x (1-F)/F`, F being the TANK friction in
			public/SHARE/Physics.js. That expression is just the inverse of a one-shot impulse's
			total displacement under the recurrence `v *= F; x += v` (which sums to v0 x F/(1-F)),
			so at F = 10/11 it collapses to a flat `back = gu x 2.8` and EVERY entry below is
			readable as its diep gu value x 2.8: 0.28 is 0.1 gu, 1.12 is Basic's 0.4 gu, 16.8 is
			Destroyer's 6 gu. Divide by 2.8 to read the table back. If the tank F ever moves again,
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
					this.canonLength = 68;
					this.rand = 0.14;
					///
					this.speed = 0.45344;
					this.pene = 1.7;
					this.peneMult = 1;
					this.damage = 4.84848;
					this.size = 18;
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
					this.canonLength = 65;
					this.rand = 0.14;
					///
					this.speed = 0.45344;
					this.pene = 1.5;
					this.damage = 4.36364;
					this.size = 18;
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
					canonLength: 58,
					rand: 0.13,
					///
					speed: 0.409552,
					pene: .6,
					damage: 2.42424,
					size: 17,
					///
					weight: 3.5,   // diep lists Flank Guard once, so the rear barrel is 0.666 gu too
					push: 0.45709,
					back: 3.36
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
					this.offx = -18;
					this.canonLength = 60;
					this.rand = 0.21;
					///
					this.speed = 0.45344;
					this.pene = 1.3;
					this.peneMult = 1;
					this.damage = 4.24242;
					this.size = 17;
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
					this.offx = 18;
					this.canonLength = 60;
					this.rand = 0.21;
					///
					this.speed = 0.45344;
					this.pene = 1.3;
					this.peneMult = 1;
					this.damage = 4.24242;
					this.size = 17;
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
					this.canonLength = 62;
					this.rand = 0.6;
					///
					this.speed = 0.468064;//.22
					this.pene = 1.2;
					this.damage = 3.15152;
					this.size = 18;//17
					///
					this.weight = 2.45;   // diep 0.4666 gu
					this.push = 0.27426;
					this.back = 1.12;
				}
			},
			"Sniper": new function () {
				this.screen = 1664;
				this.cannons = [];
				this.cannons[0] = new function () {
					this.reload = 23;
					this.offTime = 0;
					///
					this.offdir = 0;
					this.offx = 0;
					this.canonLength = 80;
					this.rand = 0.2;
					///
					this.speed = 0.585072;
					this.pene = 2.5;
					this.damage = 3.27273;
					this.size = 18;
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
					canonLength: 58,
					rand: 0.2,
					///
					speed: 0.394928,
					pene: 1,
					damage: 2.42424,
					size: 16,
					///
					weight: 2.45,   // diep 0.4666 gu
					push: 0.45709,
					back: 1.12
				}));
				c[0].offx = 6; c[0].offdir = .4;
				c[1].offx = -6; c[1].offdir = -.4;
				c[2].canonLength = 65; c[2].offTime = .5;
				this.cannons = c;
			},
			"Twin Flank": new function () {
				this.screen = 1408;
				const c = new Array(4).fill(null).map(() => ({
					reload: 15,
					offTime: 0,
					type: 0,
					life: 149,
					///
					offdir: 0,
					offx: -18,
					canonLength: 60,
					rand: 0.15,
					///
					speed: 0.45344,
					pene: 1.2,
					damage: 3.63636,
					size: 16,
					///
					weight: 1.75,   // diep 0.333 gu
					push: 0.27426,
					back: 0
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
					canonLength: 66,
					rand: 0.2,
					///
					speed: 0.394928,
					pene: 1.3,
					damage: 4.24242,
					size: 15,
					///
					weight: 2.625,   // diep 0.5 gu
					push: 0.45709,
					back: 0
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
					life: 149,
					///
					offdir: 0,
					offx: 0,
					canonLength: 62,
					rand: 0.10,
					///
					speed: 0.321792,
					pene: 18,
					damage: 1.81818,
					size: 27,
					///
					exitSpeed: 53,
					weight: 1.05,   // diep 0.2 gu (Destroyer and Hybrid's bullet share the row) - the table inverts knockback against damage
					push: 0.27426,
					back: 16.8
				}));
				///
				this.cannons = c;
			},
			"Assassin": new function () {
				this.screen = 1920;
				this.cannons = [];
				this.cannons[0] = new function () {
					this.reload = 30;
					this.offTime = 0;
					///
					this.offdir = 0;
					this.offx = 0;
					this.canonLength = 85;
					this.rand = 0.1;
					///
					this.speed = 0.599696;
					this.pene = 2.5;
					this.damage = 3.15152;
					this.size = 19;
					///
					this.weight = 3.5;   // diep 0.666 gu
					this.push = 0.54851;
					this.back = 0.84;
				}
			},
			"Overseer": new function () {
				this.screen = 1664;
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
					canonLength: 48,
					rand: 0.2,
					///
					speed: 0.438816,
					pene: 5.3,
					damage: 2.42424,
					size: 14,
					///
					exitSpeed: 25,
					weight: 4.2,   // diep 0.8 gu, the row every drone class shares
					push: 0.36567,
					back: 0
				}));
				c[1].offdir = -Math.PI / 2;
				this.cannons = c;
			},
			"Triangle": new function () {
				this.screen = 1408;
				const c = new Array(3).fill(null).map(() => ({
					reload: 15,
					offTime: 0,
					///
					offdir: 0,
					offx: 0,
					canonLength: 58,
					rand: 0.13,
					///
					speed: 0.409552,
					pene: .6,
					damage: 2.42424,
					size: 16,
					///
					weight: 0.7,   // diep Tri-Angle (Rear Bullet) 0.1333 gu; c[0] overrides to the front row
					push: 0.45709,
					back: 2.8
				}));
				// The main cannon's length bump used to write `.height`, a client-only field
				// name the server never reads (Player.js:212 reads `canonLength`), so this
				// line was a no-op and the cannon stayed at the 58 default. test/tanks.js's
				// muzzle-tip band caught it once canonLength was corrected.
				c[0].back = 0.28; c[0].canonLength = 62; c[0].pene = 1.35; c[0].damage = 4; c[0].speed = 0.45344;
				c[0].weight = 3.5;   // diep Tri-Angle (Front Bullet) 0.666 gu
				c[1].offdir = -Math.PI - .4; c[1].offx = -5; c[1].offTime = .5;
				c[2].offdir = -Math.PI + .4; c[2].offx = 5; c[2].offTime = .5;
				///
				this.cannons = c;
			},
			"Trapper": new function () {
				this.screen = 1664;
				this.cannons = [];
				this.cannons[0] = new function () {
					this.reload = 23;
					this.offTime = 0;
					this.type = 2;
					this.life = 297;
					///
					this.offdir = 0;
					this.offx = 0;
					this.canonLength = 68;
					this.rand = 0.3;
					///
					this.speed = 0.219408;
					this.pene = 4.2;
					this.damage = 1.57576;
					this.size = 12;
					///
					this.exitSpeed = 60;
					this.weight = 3.5;   // diep 0.666 gu, the row every manual trap shares
					this.push = 0.27426;
					this.back = 1.12;
				}
			},
			///
			"Rocket": new function () {
				this.screen = 1408;
				const c = new Array(2).fill(null).map(() => ({
					reload: 60,   // STAND-IN: diep has no Rocket class - takes Rocketeer 60 (plan.md Step 3, call 3)
					offTime: 0,
					///
					offdir: -Math.PI - .4,
					offx: -5,
					canonLength: 56,
					rand: 0.3,
					///
					speed: 0.394928,
					pene: 1.6,
					damage: 4.24242,
					size: 16,
					///
					// STAND-IN: diep has no Rocket. Both barrels point backwards (offdir ~ +-PI), so
					// this takes the rear-thruster row every mapped tank with rear barrels carries -
					// Tri-Angle/Booster/Fighter (Rear Bullet), 0.1333 gu - rather than its class-tree
					// parent Flank Guard's 0.666, which is a forward gun. May want its own tune.
					weight: 0.7,
					push: 0.91418,
					back: 2.38
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
					life: 149,
					///
					offdir: 0,
					offx: 0,
					canonLength: 62,
					rand: 0.10,
					///
					speed: 0.321792,
					pene: 17,
					damage: 1.81818,
					size: 27,
					///
					exitSpeed: 53,
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
					canonLength: 48,
					rand: 0.2,
					///
					speed: 0.438816,
					pene: 5,
					damage: 2.18182,
					size: 14,
					///
					exitSpeed: 25,
					weight: 4.2,   // diep Hybrid (Drone) 0.8 gu
					push: 0.36567,
					back: 0.28
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
					life: 149,
					///
					offdir: 0,
					offx: 0,
					canonLength: 62,
					rand: 0.10,
					///
					speed: 0.31448,
					pene: 17,
					damage: 1.81818,
					size: 34,
					///
					exitSpeed: 53,
					// diep 0.1 gu - the floor of the table, and the one entry where `back` stays
					// deliberately off-table (4 gu against diep's 6.8) while `weight` does not.
					weight: 0.525,
					push: 0.27426,
					back: 11.2
				}));
				///
				this.cannons = c;
			},
			"Sprayer": new function () {
				this.screen = 1664;
				const c = new Array(5).fill(null).map(() => ({
					reload: 15,   // diep barrel[0] Large Bullet, reload 1 x15 - Step 3 call 2
					offTime: 0,
					///
					offdir: 0,
					offx: 0,
					canonLength: 82,
					rand: 0.11,
					///
					speed: 0.585072,
					pene: .45,
					damage: 2.66667,
					size: 15,
					///
					// diep Sprayer (Small Bullet) 0.0666 gu, the floor of the table. All five barrels
					// are the same small, low-pene, fast bullet, so none takes the Large Bullet row -
					// the volley's combined shove is ~0.333 gu.
					weight: 0.35,
					push: 0.45709,
					back: 0.42
				}));
				// This array is index-paired against the client's cannons list in
				// TanksConfig.js's ///CLIENTS/// half (longest barrel first, at index 0,
				// firing first); test/tanks.js cross-checks the two. Shorten indices 1-4,
				// not 0-3, or the drawn barrel and the one that actually fires drift apart.
				const d = 7;
				c[1].reload = 8;    // diep barrel[1] Small Bullet, round(0.5 x15=7.5) - Step 3 call 2
				// c[2]-c[4] have no diep counterpart barrel (diep Sprayer has only 2) - stay on
				// the pre-Step-3 family value instead of inventing a third diep number.
				c[2].reload = c[3].reload = c[4].reload = 23;
				c[1].canonLength -= d;     c[1].offTime = .2;
				c[2].canonLength -= d * 2; c[2].offTime = .4;
				c[3].canonLength -= d * 3; c[3].offTime = .6;
				c[4].canonLength -= d * 4; c[4].offTime = .8;
				// c[0] keeps canonLength 82, offTime 0 - longest barrel, fires first.
				this.cannons = c;
			},
			"Ranger": new function () {
				this.screen = 2208;
				this.cannons = [];
				this.cannons[0] = new function () {
					this.reload = 30;
					this.offTime = 0;
					///
					this.offdir = 0;
					this.offx = 0;
					this.canonLength = 88;
					this.rand = 0.1;
					///
					this.speed = 0.599696;
					this.pene = 3;
					this.damage = 3.0303;
					this.size = 19;
					///
					this.weight = 3.5;   // diep 0.666 gu
					this.push = 0.63992;
					this.back = 2.24;
				}
			},
			"Triplet": new function () {
				this.screen = 1408;
				this.cannons = [];
				const c = new Array(3).fill(null).map(() => ({
					reload: 15,
					offTime: 0,
					///
					offdir: 0,
					offx: 0,
					canonLength: 55,
					rand: 0.16,
					///
					speed: 0.394928,
					pene: 1,
					damage: 2.42424,
					size: 16,
					///
					weight: 2.1,   // diep 0.4 gu
					push: 0.45709,
					back: 1.12
				}));
				c[0].offx = 17;
				c[1].offx = -17;
				c[2].canonLength = 60; c[2].offTime = .5;
				this.cannons = c;
			},
			"Triple Twin": new function () {
				this.screen = 1408;
				const c = new Array(6).fill(null).map(() => ({
					reload: 15,
					offTime: 0,
					type: 0,
					life: 149,
					///
					offdir: 0,
					offx: -18,
					canonLength: 60,
					rand: 0.15,
					///
					speed: 0.45344,
					pene: 1.2,
					damage: 3.39394,
					size: 16,
					///
					weight: 1.75,   // diep 0.333 gu
					push: 0.27426,
					back: 0
				}));
				c[2].offdir = c[3].offdir = Math.PI * 2 / 3;
				c[4].offdir = c[5].offdir = Math.PI * 4 / 3;
				c[1].offTime = c[3].offTime = c[5].offTime = .5;
				c[1].offx = c[3].offx = c[5].offx = 18;
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
					canonLength: 55,
					rand: 0.16,
					///
					speed: 0.394928,
					pene: .95,
					damage: 2.78788,
					size: 16,
					///
					weight: 1.925,   // diep 0.3666 gu
					push: 0.45709,
					back: 0.784
				}));
				c[0].offx = 7; c[0].offdir = .6;
				c[1].offx = -7; c[1].offdir = -.6;
				c[2].offx = 3; c[2].offdir = .3; c[2].canonLength = 63; c[2].offTime = .5;
				c[3].offx = -3; c[3].offdir = -.3; c[3].canonLength = 63; c[3].offTime = .5;
				c[4].canonLength = 69;
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
					canonLength: 62,
					rand: 0.2,
					///
					speed: 0.394928,
					pene: 1.3,
					damage: 3.0303,
					size: 16,
					///
					weight: 2.275,   // diep 0.4333 gu
					push: 0.45709,
					back: 0
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
					rand: 0.13,
					///
					speed: 0.387616,
					pene: 1,
					damage: 4.48485,
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
					canonLength: 52,
					rand: 0.13,
					///
					speed: 0.409552,
					pene: .6,
					damage: 2.42424,
					size: 16,
					///
					weight: 0.7,   // diep Booster (Rear Bullet) 0.1333 gu; c[0] overrides to the front row
					push: 0.45709,
					back: 2.408
				}));
				// Same `.height`-instead-of-`.canonLength` typo as Triangle above; these three
				// lines were no-ops until test/tanks.js caught it.
				c[0].back = 0.56; c[0].canonLength = 62; c[0].pene = 1.35; c[0].damage = 4; c[0].speed = 0.468064;
				c[0].weight = 3.5;   // diep Booster (Front Bullet) 0.666 gu
				c[1].offdir = -Math.PI - .65; c[1].offx = -6;
				c[2].offdir = -Math.PI + .65; c[2].offx = 6;
				c[3].offdir = -Math.PI - .35; c[3].offx = -5; c[3].canonLength = 58; c[3].offTime = .5;
				c[4].offdir = -Math.PI + .35; c[4].offx = 5; c[4].canonLength = 58; c[4].offTime = .5;
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
					canonLength: 57,
					rand: 0.13,
					///
					speed: 0.424192,
					pene: .5,
					damage: 1.45455,
					size: 16,
					///
					weight: 0.7,   // diep Fighter (Rear Bullet) 0.1333 gu; c[0]-c[2] override below
					push: 0.45709,
					back: 0.28
				}));
				// Same `.height`/`.canonLength` typo as Triangle/Booster above, plus a second
				// one: the rear pair's offx was written to c[1]/c[2] (already set two lines
				// up) instead of c[3]/c[4], so the rear cannons never got their splay and the
				// side cannons silently lost theirs. test/tanks.js's index-paired offx check
				// is what caught both.
				c[0].back = 0.28; c[0].canonLength = 65; c[0].pene = 1.30; c[0].damage = 4; c[0].speed = 0.45344;
				c[1].offdir = -Math.PI / 2; c[1].offx = +1; c[1].pene = 1.4; c[1].damage = 3.87879; c[1].speed = 0.438816;
				c[2].offdir = Math.PI / 2; c[2].offx = -1; c[2].pene = 1.4; c[2].damage = 3.87879; c[2].speed = 0.438816;
				c[1].reload = c[2].reload = 23;   // diep barrel[1]/[2] side, round(1.5 x15=22.5) - Step 3 call 2
				c[3].offdir = -Math.PI - .4; c[3].offx = -5; c[3].offTime = .5; c[3].canonLength = 59;
				c[4].offdir = -Math.PI + .4; c[4].offx = 5; c[4].offTime = .5; c[4].canonLength = 59;
				c[3].back = c[4].back = 3.92;
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
					life: 99,
					auto: 1,
					autoShoot: 1,
					autoDir: 1,
					///
					offdir: 0,
					offx: 0,
					canonLength: 38,
					rand: 0.1,
					///
					speed: 0.52656,
					pene: 1.8,
					damage: 3.0303,
					size: 14,
					///
					// STAND-IN by class, mapped by cannon: diep has no Auto Hover, but this slot is
					// the same auto-turret every Auto- class carries, so it takes their row -
					// Auto Gunner/Auto Trapper/Auto Smasher (Auto Bullet), 0.2 gu.
					weight: 1.05,
					push: 0.27426,
					back: 0.28
				}];
				c = c.concat(new Array(3).fill(null).map(() => ({
					reload: 15,   // STAND-IN: Tri-Angle own new value (Step 3) - call 3
					offTime: 0,
					///
					offdir: 0,
					offx: 0,
					canonLength: 58,
					rand: 0.13,
					///
					speed: 0.409552,
					pene: .6,
					damage: 2.42424,
					size: 16,
					///
					// The other three cannons are Tri-Angle's, so they take Tri-Angle's rows:
					// 0.1333 gu rear here, 0.666 gu front on c[1] below.
					weight: 0.7,
					push: 0.45709,
					back: 2.8
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
				c[1].back = 0.28; c[1].canonLength = 62; c[1].pene = 1.35; c[1].damage = 4;
				c[1].weight = 3.5;   // diep Tri-Angle (Front Bullet) 0.666 gu
				c[2].offdir = -Math.PI - .4; c[2].offx = -5; c[2].offTime = .5;
				c[3].offdir = -Math.PI + .4; c[3].offx = 5; c[3].offTime = .5;
				///
				this.cannons = c;
			},
			"Overlord": new function () {
				this.screen = 1664;
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
					canonLength: 48,
					rand: 0.2,
					///
					speed: 0.438816,
					pene: 4.5,
					damage: 2.18182,
					size: 14,
					///
					exitSpeed: 25,
					weight: 4.2,   // diep Overlord 0.8 gu, the row every drone class shares
					push: 0.45709,
					back: 0.28
				}));
				c[1].offdir = Math.PI / 2;
				c[2].offdir = Math.PI;
				c[3].offdir = Math.PI * 3 / 2;
				this.cannons = c;
			},
			"Manager": new function () {
				this.screen = 1824;
				this.maxDrone = 8;
				this.alpha = 0.00727;
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
					canonLength: 48,
					rand: 0.2,
					///
					speed: 0.438816,
					pene: 5,
					damage: 2.42424,
					size: 14,
					///
					exitSpeed: 25,
					weight: 4.2,   // diep Manager 0.8 gu, the row every drone class shares
					push: 0.45709,
					back: 0.28
				}]
				this.cannons = c;
			},
			"Necromancer": new function () {
				this.screen = 1664;
				this.maxDrone = 22;
				this.necro = {
					type: 3,
					necro: 1,
					///
					speed: 0.438816,
					pene: 4,
					damage: 1.57576,
					weight: 4.2,   // diep Necromancer 0.8 gu, the row every drone class shares
					push: 0.5028
				};
				this.cannons = [];
			},
			"BattleShip": new function () {
				this.screen = 1664;
				//this.maxDrone = 7;
				this.cannons = [];
				const c = new Array(4).fill(null).map(() => ({
					reload: 15,
					offTime: 0,
					type: 1.2,
					life: 91,
					auto: 0,
					///
					offdir: Math.PI / 2,
					offx: 12,
					canonLength: 48,
					rand: 0.2,
					///
					speed: 0.760592,
					pene: .8,
					damage: 1.09091,
					size: 6,
					///
					exitSpeed: 25,
					weight: 0.525,   // diep Battleship 0.1 gu
					push: 0.04571,
					back: 0
				}));
				c[1].offdir = -Math.PI / 2; c[1].offx = -12; c[1].offTime = .5;
				c[2].offdir = Math.PI / 2; c[2].offx = -12; c[2].offTime = .5;
				c[3].offdir = -Math.PI / 2; c[3].offx = 12;
				c[2].type = c[3].type = 1.3;
				c[2].life = c[3].life = 120;
				this.cannons = c;
			},
			"Fortress": new function () {
				this.screen = 1664;
				//this.maxDrone = 7;
				this.cannons = [];
				let c = new Array(3).fill(null).map(() => ({
					reload: 23,   // STAND-IN: diep has no Fortress - takes Tri-Trapper round(22.5)=23 (plan.md Step 3, call 3)
					offTime: 0,
					type: 2,
					life: 297,
					///
					offdir: 0,
					offx: 0,
					canonLength: 65,
					rand: 0.2,
					///
					speed: 0.219408,
					pene: 4,
					damage: 0.9697,
					size: 10,
					///
					exitSpeed: 60,
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
					life: 83,
					auto: 0,
					///
					offdir: Math.PI / 3,
					offx: 0,
					canonLength: 48,
					rand: 0.2,
					///
					speed: 0.61432,
					pene: .7,
					damage: 0.9697,
					size: 6,
					///
					exitSpeed: 28,
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
				this.screen = 1664;
				//this.maxDrone = 7;
				this.cannons = [];
				const c = [{
					reload: 50,
					offTime: 0,
					type: 2,
					life: 396,
					///
					offdir: 0,
					offx: 0,
					canonLength: 68,
					rand: 0.2,
					///
					speed: 0.219408,
					pene: 18,
					damage: 1.69697,
					size: 19,
					///
					exitSpeed: 70,
					weight: 5.6,   // diep 1.0666 gu, the top of the whole table
					push: 0.27426,
					back: 3.36
				}];
				this.cannons = c;
			},
			"Overtrapper": new function () {
				this.screen = 1664;
				this.maxDrone = 4;
				let c = [{
					reload: 23,
					offTime: 0,
					type: 2,
					life: 297,
					///
					offdir: 0,
					offx: 0,
					canonLength: 65,
					rand: 0.2,
					///
					speed: 0.234032,
					pene: 5,
					damage: 1.45455,
					size: 10,
					///
					exitSpeed: 60,
					weight: 3.5,   // diep Overtrapper (Trap) 0.666 gu
					push: 0.27426,
					back: 2.24
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
					canonLength: 48,
					rand: 0.2,
					///
					speed: 0.438816,
					pene: 5.5,
					damage: 1.81818,
					size: 14,
					///
					exitSpeed: 25,
					weight: 4.2,   // diep Overtrapper (Drone) 0.8 gu
					push: 0.45709,
					back: 0.28
				})));
				c[2].offdir = Math.PI * 4 / 3; c[2].offTime = .5;
				this.cannons = c;
			},
			"Auto Trapper": new function () {
				this.screen = 1664;
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
					life: 99,
					auto: 1,
					autoShoot: 1,
					autoDir: 1,
					///
					offdir: 0,
					offx: 0,
					canonLength: 38,
					rand: 0.1,
					///
					speed: 0.468064,
					pene: 1.5,
					damage: 3.15152,
					size: 14,
					///
					weight: 1.05,   // diep Auto Trapper (Auto Bullet) 0.2 gu
					push: 0.27426,
					back: 0.28
				}];
				c.push({
					reload: 23,
					offTime: 0,
					type: 2,
					life: 297,
					///
					offdir: 0,
					offx: 0,
					canonLength: 65,
					rand: 0.2,
					///
					speed: 0.234032,
					pene: 4,
					damage: 1.69697,
					size: 10,
					///
					exitSpeed: 60,
					weight: 3.5,   // diep Auto Trapper (Trap) 0.666 gu
					push: 0.27426,
					back: 2.24
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
					this.rand = 0.62;
					///
					this.speed = 0.394928;//.22
					this.pene = 3;
					this.damage = 1.93939;
					this.size = 23;//17
					///
					// STAND-IN: diep has no Submachine. It inherits its class-tree parent Machine
					// Gun's 0.4666 gu. May want its own tune.
					this.weight = 2.45;
					this.push = 0.27426;
					this.back = 2.24;
				}
			},
			///dev
			'Gunner': new function () {
				this.screen = 1408;
				let c = [];
				c = c.concat(new Array(4).fill(null).map(() => ({
					reload: 15,
					offTime: 0,
					///
					offdir: 0,
					offx: 24,
					canonLength: 45,
					rand: 0.1,
					///
					speed: 0.511936,
					pene: .42,
					damage: 2.66667,
					size: 12,
					///
					// STAND-IN: diep HAS a Gunner but its Knockbackfactor table omits it. This takes
					// Gunner Trapper (Bullet), 0.333 gu - the table's only entry for a bullet fired
					// out of a Gunner barrel - rather than the class-tree parent Machine Gun's
					// 0.4666. May want its own tune.
					weight: 1.75,
					push: 0.45709,
					back: 0
				})));
				c[1].offx *= -1;
				c[2].canonLength = c[3].canonLength = 58;
				c[2].offx = 13; c[3].offx = -13;
				c[1].offTime = c[2].offTime = .5;
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
					life: 99,
					auto: 1,
					autoShoot: 1,
					autoDir: 1,
					///
					offdir: 0,
					offx: 0,
					canonLength: 38,
					rand: 0.1,
					///
					speed: 0.468064,
					pene: 1.8,
					damage: 2.42424,
					size: 14,
					///
					weight: 1.05,   // diep Auto Gunner (Auto Bullet) 0.2 gu
					push: 0.27426,
					back: 0.28
				}];
				c = c.concat(new Array(4).fill(null).map(() => ({
					reload: 15,
					offTime: 0,
					///
					offdir: 0,
					offx: 24,
					canonLength: 45,
					rand: 0.1,
					///
					speed: 0.599696,
					pene: .31,
					damage: 2.66667,
					size: 12,
					///
					// STAND-IN via Gunner above - the table has no Auto Gunner (Manual Bullet) row
					// either, so the manual barrels carry Gunner's stand-in. May want its own tune.
					weight: 1.75,
					push: 0.45709,
					back: 0
				})));
				c[2].offx *= -1;
				c[3].canonLength = c[4].canonLength = 58;
				c[3].offx = 13; c[4].offx = -13;
				c[2].offTime = c[3].offTime = .5;
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
				this.screen = 2400;
				this.cannons = [];
				this.boss = true;
				this.maxDrone = 35;
				const c = new Array(4).fill(null).map(() => ({
					reload: 7,
					offTime: 0,
					auto: 1,
					type: 3.1,
					life: 107,
					///
					offdir: 0,
					offx: 0,
					// 50 is a floor, not a drawn-length choice: rooms/Room.js gives the Summoner boss
					// size: 64, and a drone's own trailing edge already sits only ~1 unit clear of
					// the body at this spawn radius (entities/Player.js's spawn math) - shortening
					// this spawns drones intersecting their own boss. Don't shrink it to close the
					// client's drawn-height gap (PENDING.md's boss balance-call item) - grow the
					// client instead, and only on a human call.
					canonLength: 50,
					rand: 0.5,
					///
					speed: 0.570448,
					pene: 5.5,
					damage: 5.45455,
					size: 20,
					///
					exitSpeed: 35,
					// STAND-IN: diep has no Summoner and no boss of any kind. These are drones, so
					// they take the 0.8 gu row every drone class shares. May want its own tune -
					// a boss fields up to 35 of them at once, where Overlord fields 8.
					weight: 4.2,
					push: 0.18283,
					back: 0
				}));
				c[1].offdir = Math.PI / 2; c[1].offTime = .5;
				c[2].offdir = Math.PI;
				c[3].offdir = Math.PI * 1.5; c[3].offTime = .5;
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
				Annihilator's own cannon.size below, same reasoning for weight/push/exitSpeed (a
				projectile that size hits and recoils like that class's, not a new guess).
				speed: 0.599696 (Assassin's base cannon speed) x 1.66 (the engine's own maxed
				BSpeed multiplier, 7 points x 0.0942857/pt, entities/Player.js upgrade()) - "The
				Bullet Speed of a maxed Assassin", computed rather than eyeballed.
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
				const c = new Array(1).fill(null).map(() => ({
					reload: 15,
					offTime: 0,
					auto: 1,
					type: 0,
					life: 107,
					///
					offdir: 0,
					offx: 0,
					canonLength: 68,
					rand: 0.05,
					///
					speed: 0.995491,
					pene: 3750,
					damage: 196,
					size: 34,
					///
					exitSpeed: 53,
					weight: 0.525,
					push: 0.27426,
					back: 0
				}));
				this.cannons = c;
			},
			/*
				PENDING #27's three Dominator variants. `pene`/`damage` are diep_wiki/Dominator.txt's
				own multiples of "a tank" - diep's universal 0-point bullet baseline, MEASUREMENTS.md's
				pinned 2 HP / 7 damage per loop. Bullet magnitudes aren't diep-adopted in this tree yet
				(MEASUREMENTS.md's M1), so - the same call PENDING #17/#18's body-damage fix already
				made for an identical problem - the multiple is applied to OUR OWN corresponding live
				number (Basic's own can.pene 1.7 / can.damage 4.84848, the closest thing this engine has
				to "a tank's" baseline bullet) rather than diep's raw absolute figure, which would land
				on the wrong scale entirely next to every other cannon in this table. `back: 0`
				everywhere - diep_wiki: a Dominator has "no recoil" (it cannot move at all,
				lib/gameAI.js's CONFIG.DOMINATOR). Detector-driven auto-aim (`auto`/`autoShoot`/
				`autoDir`, DETEC below) is the same auto-turret machinery Auto Gunner/Auto Trapper
				already use - see lib/gameAI.js's CONFIG.DOMINATOR comment for why the AI itself needs
				no bespoke targeting code.
			*/
			"Destroyer Dominator": new function () {
				// FoV "roughly Sniper-to-Hunter range" (diep_wiki) - Sniper's own screen (1664),
				// the low end of that band; ours, flagged, no exact number given.
				this.screen = 1664;
				this.DETEC = { type: [KIND.PLAYER, KIND.OBJECTS], size: this.screen, all: 0, maxDis: this.screen };
				this.cannons = [{
					// reload: Hybrid's own 60 at 3 Reload points (1 - 3*0.0788571 = 0.7634287),
					// rounded - diep_wiki: "reload... approximately equal to a Hybrid with 3 points".
					reload: 46,
					offTime: 0,
					auto: 1, autoShoot: 1, autoDir: 1,
					type: 0,
					life: 149,
					///
					offdir: 0,
					offx: 0,
					canonLength: 62,
					rand: 0.10,
					///
					// Below Destroyer's own 0.321792 (diep_wiki gives no figure, only "below
					// Destroyer's") - 0.9x, ours, flagged.
					speed: 0.2896128,
					pene: 170,      // 100 x tank's own 1.7 (diep_wiki: "200 HP, x100 tank")
					damage: 48.4848,  // 10 x tank's own 4.84848 (diep_wiki: "70/hit, x10 tank")
					size: 27,      // Hybrid-sized bullet (diep_wiki)
					///
					exitSpeed: 53,
					weight: 1.05,
					push: 0.27426,
					back: 0
				}];
			},
			"Gunner Dominator": new function () {
				this.screen = 1920;   // mid Sniper-Hunter band - Assassin's own screen, ours/flagged
				this.DETEC = { type: [KIND.PLAYER, KIND.OBJECTS], size: this.screen, all: 0, maxDis: this.screen };
				const c = new Array(3).fill(null).map((_, i) => ({
					// "High reload" (diep_wiki gives no number) - 2x Gunner's own base 27, ours/flagged.
					reload: 54,
					offTime: 0,
					auto: 1, autoShoot: 1, autoDir: 1,
					type: 0,
					///
					offdir: i * Math.PI * 2 / 3,   // 3 cannons, evenly spaced (diep_wiki)
					offx: 0,
					canonLength: 45,
					rand: 0.1,
					///
					speed: 0.511936,   // Gunner's own "normal" bullet speed (diep_wiki)
					pene: 8.5,       // 5 x tank's own 1.7 (diep_wiki: "10 HP, x5 tank")
					damage: 4.84848,   // 1 x tank's own 4.84848 (diep_wiki: "7, x1 tank")
					size: 12,
					///
					weight: 1.75,
					push: 0.45709,
					back: 0
				}));
				this.cannons = c;
			},
			"Trapper Dominator": new function () {
				this.screen = 2208;   // Ranger's own screen, our stand-in for diep's "Hunter"
				this.DETEC = { type: [KIND.PLAYER, KIND.OBJECTS], size: this.screen, all: 0, maxDis: this.screen };
				const c = new Array(8).fill(null).map((_, i) => ({
					reload: 25,   // Trapper's own base reload, at 0 points (diep_wiki)
					offTime: 0,
					auto: 1, autoShoot: 1, autoDir: 1,   // "auto-fire always on" (diep_wiki)
					type: 2,
					life: 297,
					///
					offdir: i * Math.PI / 4,   // 8 launchers, evenly spaced (diep_wiki)
					offx: 0,
					canonLength: 68,
					rand: 0.3,
					///
					// Above a maxed Tri-Trapper (diep_wiki) - this tree has no "Tri-Trapper" class to
					// anchor exactly, so this is our own Trapper's maxed trap speed
					// (0.219408 x 1.66 = 0.36421728) with headroom, ours/flagged/approximate.
					speed: 0.45,
					pene: 25.5,        // 15 x tank's own 1.7 (diep_wiki: "30 HP, x15 tank")
					damage: 17.454528,   // 3.6 x tank's own 4.84848 (diep_wiki: "25.2, x3.6 tank")
					size: 12,
					///
					exitSpeed: 60,
					weight: 3.5,
					push: 0.27426,
					back: 0
				}));
				this.cannons = c;
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
	exports.tree = [
		{
			Basic: ['Twin', 'Machine Gun', 'Sniper', 'Flank Guard'],
			testbed: ['bigView', 'shapes', 'pre launch'],
			shapes: ['shape1', 'shape2'],
			'pre launch': ['Fortress', 'Necromancer', 'Auto Hover']
		},
		{
			Twin: ['Twin Flank', 'Triple Shot', 'Quad Tank'],
			'Machine Gun': ['Destroyer', 'Gunner'],
			Sniper: ['Trapper', 'Assassin', 'Overseer'],
			'Flank Guard': ['Triple Shot', 'Triangle'],
		},
		{
			'Flank Guard': ['Rocket'],
			'Machine Gun': ['Submachine'],
			Gunner: ['Sprayer', 'Auto Gunner'],
			Destroyer: ['Hybrid', 'Annihilator'],
			Overseer: ['Manager', 'Necromancer', 'BattleShip', 'Overlord'],
			'Triangle': ['Fighter', 'Booster'],
			'Quad Tank': ['Cyclone', 'Octo Tank'],
			'Twin Flank': ['BattleShip', 'Triple Twin'],
			'Triple Shot': ['Triplet', 'Penta Shot'],
			Assassin: ['Sprayer', 'Ranger'],
			Trapper: ['Overtrapper', 'Auto Trapper', 'Mega Trapper']
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
		"Rocket",
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
		'Trapper Dominator'
	];

})(typeof (exports) === 'undefined' ? function () { this['TanksConfig'] = {}; return this['TanksConfig'] }() : exports,
	typeof (exports) === 'undefined' ? 'client' : 'server')
