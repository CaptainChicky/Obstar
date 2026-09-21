/*
	Tunables, palette and the two mutable state bags.

	RATIO and UIRATIO are reassigned every resize, so they live on Global
	rather than as aliases that would freeze at load.
*/
(function (CLIENT) {
	///
	const CONST = {
		RESOLUTION: 1.1,
		OFFCAN: 1.2,
		LINEWIDTH: 4,
		// Per-frame factor for remaining exponential smoothers (sizes, alphas, turret
		// angles). Calibrated at 60fps; General.lerpK() rescales it per frame.
		SMOOTH: 0.15,
		// Camera trails the tank. Steady-state lag is proportional to 1/CAM_SMOOTH.
		CAM_SMOOTH: 0.1467,
		// How fast an own bullet sheds its muzzle-alignment offset. Deliberately slower
		// than SMOOTH so the offset does not bend the visible path.
		BULLET_LEAD_DECAY: 0.08,
		/*
			Ceiling on how far past the newest snapshot an ordinary bullet may be drawn,
			as a multiple of the measured packet interval. The lead itself is measured;
			this only bounds a pathological RTT.
		*/
		DEAD_RECKON_MAX_INTERVALS: 3,
		SIZE: 35,
		MOUSEDELAY: 60 / 15,
		MOUSE_OUT: 3,
		// Damaged-shape health bar hold, in 60Hz frames, after the last real hp drop.
		HP_BAR_HOLD: 180,
		// Lifetime upgrade-point budget and per-stat cap. Server is the authority;
		// these are what the upgrade widget draws and pre-caps against.
		MAX_UP_POINTS: 33,
		MAX_PER_STAT: 7,
		// Panel row -> wire index.
		UP_ORDER: [7, 6, 5, 2, 3, 4, 1, 0],
		// How long the upgrade panel stays up after the last m/u/digit press or click, in ms.
		UP_HOLD_MS: 2000,
		// Real ms per server simulation step. Lobby countdown is the only consumer.
		TICK_MS: 25
	};
	const CLASS = TanksConfig.class;
	const CLASS_TREE = TanksConfig.tree;
	const rnbcolor = ['hsl(0,100%,50%)', 'hsl(0,100%,30%)'];
	const Palette = window.colorPattern = window.colorPattern || {
		// ---light------Dark---
		green: ["#19e56e", "#14ad54"],
		red: ["#e6584b", "#a9443b"],
		yellow: ["#f4e433", "#cab810"],
		blue: ["#408edd", "#3b6fa9"],
		gray: ["#8e8ca5", "#716e86"],//cannons
		special: rnbcolor,
		black: ['#4a4a50', '#1a1a1a'],
		white: ['#f2f2f2', '#e1e1e1'],
		lila: ['#e0bbe4', '#957dad'],
		// Necromancer drones, and Summoner drones. Stroke is fill x0.75.
		necro: ['#f6c578', '#b9945a'],
		Grid: ["#d0cdcd", "#c1bebe"],

		hit: ['#d82626', '#d82626'],//red when you get hitted
		bull: ["#f177dd", "#b459a5"],
		// Maze walls. Stroke is fill x0.75.
		wall: ["#bbbbbb", "#8c8c8c"],
		// Guard n-gons: Smasher/Landmine hex, Spike triangles, Dominator base hex.
		guard: ["#555555", "#404040"],
		// Per-boss colours. Guardian reuses `bull`.
		coral: ["#fc7677", "#bd5959"], // Defender
		square: ["#ffe869", "#bfae4f"], // Summoner
		fallen: ["#c0c0c0", "#909090"], // Fallen Overlord / Fallen Booster
		// Arena Closer and an uncaptured Dominator. Same hex as `square`, kept separate.
		neutral: ["#ffe869", "#bfae4f"],
		sqr: ["#cfcf9f", "#a6a689"],
		alphaSqr: ["#cfcf9f", "#a6a689"],
		tri: ["#d1adb2", "#a38a8e"],
		alphaTri: ["#d1adb2", "#a38a8e"],
		pnt: ["#b2b2cc", "#8686ab"],
		alphaPnt: ["#b2b2cc", "#8686ab"],
		// Objects rarity tier 1 — brighter than tank `green` so a shiny reads as loot.
		shiny: ["#38f77c", "#1fbf5c"],
		botName: '#f6f1b5',
		up: [
			'#d9ac8c', // 1 Health Regen
			'#d381d6', // 2 Max Health
			'#9b81d6', // 3 Body Damage
			'#81a1d6', // 4 Bullet Speed
			'#d6c681', // 5 Bullet Penetration
			'#d68181', // 6 Bullet Damage
			'#a1d681', // 7 Reload
			'#81d6d4' // 8 Movement Speed
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
		// Screen scale factors, reassigned by General.updateRatio().
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
		// One team base's size in world units, from GameUpdate's head. 0 means no bases.
		baseSize: 0,
		// OPEN (0) until the first real GameUpdate head lands.
		arenaState: 0,
		ticksUntilStart: 0,
		playersNeeded: 0,
		// Whether this viewer could respawn right now, and how many contenders the room's lobby
		// has gathered so far - both straight off GameUpdate's head.
		canRespawn: 1,
		playersJoined: 0,
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
