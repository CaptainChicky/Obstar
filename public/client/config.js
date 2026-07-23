/*
	Tunables, palette and the two mutable state bags.

	RATIO and UIRATIO used to be `var RATIO = 1, UIRATIO;` next to Global. General.updateRatio()
	reassigns them every resize, so once the file is split they cannot be aliased into the
	other files - an alias would freeze at whatever the value was when the page loaded. They
	live on Global instead, which every reader already had to reach for anyway.
*/
(function (CLIENT) {
	///
	const CONST = {
		RESOLUTION: 1.1,
		OFFCAN: 1.2,
		LINEWIDTH: 4,
		// Per-frame factor for the remaining exponential smoothers - sizes, alphas, turret
		// angles. Positions do not use it any more; see the Interp block below for why. It is
		// calibrated at 60fps and rescaled per frame by General.lerpK() so a 144Hz monitor gets
		// the same time constant rather than a 2.4x faster one.
		SMOOTH: 0.15,
		SIZE: 35,
		MOUSEDELAY: 60 / 15,
		MOUSE_OUT: 3,
		UP_ORDER: [
			7,
			1,
			6,
			2,
			0,
			4,
			5,

			3
		]
	};
	const CLASS = TanksConfig.class;
	const CLASS_TREE = TanksConfig.tree;
	const rnbcolor = ['hsl(0,100%,50%)', 'hsl(0,100%,30%)'];
	const Palette = window.colorPattern = window.colorPattern || {
		//         ---light------Dark---
		green: ["#19e56e", "#14ad54"],
		red: ["#e6584b", "#a9443b"],
		yellow: ["#f4e433", "#cab810"],
		blue: ["#408edd", "#3b6fa9"],
		gray: ["#8e8ca5", "#716e86"],//canons
		special: rnbcolor,
		black: ['#4a4a50', '#1a1a1a'],
		white: ['#f2f2f2', '#e1e1e1'],
		lila: ['#e0bbe4', '#957dad'],
		necro: ['#e5bd56', '#b89337'],
		Grid: ["#d0cdcd", "#c1bebe"],

		hit: ['#d82626', '#d82626'],//red when you get hitted
		bull: ["#999999", "#6a6a6a"],
		sqr: ["#cfcf9f", "#a6a689"],
		alphaSqr: ["#cfcf9f", "#a6a689"],
		tri: ["#d1adb2", "#a38a8e"],
		alphaTri: ["#d1adb2", "#a38a8e"],
		pnt: ["#b2b2cc", "#8686ab"],
		alphaPnt: ["#b2b2cc", "#8686ab"],
		botName: '#f6f1b5',
		up: [
			'#e6ab22',///Reload
			'#4bd79d',///M Speed
			'#e66a22',///BodyDamage
			'#4fd3d3',
			'#eddd2a',
			'#4a6dd8',
			'#e62222',
			'#50a5dc'
		],
		class: [
			'#cd9797',
			'#cdc497',
			'#a9cd97',
			'#97bbcd',
			'#b9b5ce',
			'#ceb5ce',
			'#ceb5bd'
		],
	};
	const Global = {
		// Screen scale factors, reassigned by General.updateRatio() (public/client/util.js).
		RATIO: 1,
		UIRATIO: undefined,
		mouse_out: 0,
		inputs: {
			old: {},
			mouseL: 0,
			mouseR: 0
		},
		mouseDelay: 0,
		mouse_x: 0,
		mouse_y: 0,
		oldMouse_x: 0,
		oldMouse_y: 0,
		fps: [],
		oldfps: 0,
		newfps: 0,
		canW: 0,
		canH: 0,
		winW: 0,
		winH: 0,
		// Length of the frame being drawn, in 60Hz frames. Loop() sets it; General.lerpK() and
		// the client-side motion prediction read it so neither depends on the refresh rate.
		dtFrames: 1,
		frameAt: 0,
	}
	const Game = {
		timestamp: 0,
		screen: 1920,
		realScreen: 1920,
		width: 1,
		height: 1,
	};
	///
	CLIENT.CONST = CONST;
	CLIENT.CLASS = CLASS;
	CLIENT.CLASS_TREE = CLASS_TREE;
	CLIENT.rnbcolor = rnbcolor;
	CLIENT.Palette = Palette;
	CLIENT.Global = Global;
	CLIENT.Game = Game;
})(typeof (exports) === 'undefined'
	? (window.CLIENT = window.CLIENT || {})
	: (module.exports = global.CLIENT = global.CLIENT || {}));
