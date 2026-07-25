/*
	Achievement registry (HANDOFF Part 2). One flat ordered list, shared between server
	(entities/Player.js calls unlock(id) against this list) and client (the achievements panel
	in public/account.js renders it, locked/unlocked, in this order). Same dual-mode footer as
	TanksConfig.js / kinds.js so both sides require() / global exactly one copy.

	icon is a filename under public/pic/img_mess/ - unlocking pushes '/img <icon>' onto the
	player's mess feed, which public/client/ui.js's MES renderer already knows how to toast
	(the same mechanism the two pre-existing one-shot flags, cursed_score and speed_demon, used
	before this registry existed).

	hidden entries show their name/desc as '???' in the panel until unlocked - for a joke/secret
	achievement, not a gate on anything server-side.
*/
(function (exports) {

	exports.list = [
		{
			id: 'first_blood',
			name: 'First Blood',
			desc: 'Destroy another player for the first time.',
			icon: 'achievement.png',
			hidden: false
		},
		{
			id: 'penta_slayer',
			name: 'Pentagon Slayer',
			desc: 'Destroy a Pentagon.',
			icon: 'mc_penta_slay.png',
			hidden: false
		},
		{
			id: 'died_to_penta',
			name: 'Rest In Pentagon',
			desc: 'Get destroyed by a Pentagon.',
			icon: 'mc_died_penta.png',
			hidden: false
		},
		{
			id: 'kawaii_smash',
			name: 'Kawaii Smash',
			desc: 'Destroy 200 squares in a single life.',
			icon: 'emo_kawaii_smash.png',
			hidden: false
		},
		{
			id: 'scary_tank',
			name: 'Scary Tank',
			desc: 'Reach a tier 4 tank class.',
			icon: 'mc_scary_tank.png',
			hidden: false
		},
		{
			id: 'speed_demon',
			name: "I'm Speed",
			desc: 'Max out Movement Speed and Reload on a Rocket.',
			icon: 'mc_im_speed.png',
			hidden: false
		},
		{
			id: 'the_end',
			name: 'The End',
			desc: 'Reach the maximum level.',
			icon: 'end.png',
			hidden: false
		},
		{
			id: 'cursed_score',
			name: 'Cursed',
			desc: 'Reach exactly 666666 score in a single life.',
			icon: 'mc_cursed_score.png',
			hidden: true
		}
	];

})(typeof (exports) === 'undefined' ? function () { this['AchievementsConfig'] = {}; return this['AchievementsConfig'] }() : exports)
