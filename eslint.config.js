/*
	ESLint, flat config. `npm run lint`.

	There is no build step or bundler: the source you edit is the source that runs, in Node
	and in the browser alike. That makes a linter the only guard against a typo on a path
	nobody executes, so the rules that are on here are the ones that catch a name that isn't
	defined - `no-undef` and `no-global-assign`, as errors everywhere. Everything stylistic
	is off.

	It is tuned to pass clean on the current tree. If a new rule flags existing code, either
	fix the code in the same commit or leave the rule out - a lint run that always prints
	warnings is a lint run nobody reads.

	`no-var` and `eqeqeq` are errors: the codebase uses let/const and strict equality
	throughout, and these stay on to keep the idiom from creeping back.

	Three environments, because three kinds of file live here:
		- Node CommonJS: server.js, lib/, net/, rooms/, entities/, web/, test/
		- browser menu page (views/index.ejs): public/queue.js, public/shop.js - they share
			State/Pref/UserData/ChosenPet/SetPets across <script> tags and with public/font.js
			(ignored below as a vendored art asset, where State/resize/loop are defined)
		- dual-mode game page (views/play.ejs): public/SHARE/*.js, public/motion.js and
			public/client/*.js run in both the browser and Node, so they need both global sets;
			test/*.js require() them directly.
*/
const js = require('@eslint/js');
const globals = require('globals');

// Names the game page shares through the page rather than through a module system. Every
// one is defined by a <script> in views/play.ejs (or injected by the server as POST), so
// to a single-file lint run they look undefined.
const PAGE_GLOBALS = {
	POST: 'readonly',   // server-injected JSON blob (key, gm, name, pet, ws)
	WS_LINK: 'readonly',   // public/SHARE/ws_link.js
	World: 'readonly',   // public/SHARE/World.js - grid pitch (GU/gu())
	TanksConfig: 'readonly',   // public/SHARE/TanksConfig.js
	PetsConfig: 'readonly',   // public/SHARE/PetsConfig.js
	AchievementsConfig: 'readonly',   // public/SHARE/AchievementsConfig.js
	ObjectsConfig: 'readonly',   // public/SHARE/ObjectsConfig.js
	PROTO: 'readonly',   // public/SHARE/SocketSchema.js
	MOTION: 'readonly',   // public/motion.js
	Physics: 'readonly',   // public/SHARE/Physics.js
	CLIENT: 'writable',   // public/client/runtime.js - the client's shared scope
	colorPattern: 'writable'    // the two-tone tank palette, hung on window
};

// The menu page (views/index.ejs) has its own shared-through-the-window names. State,
// resize and loop are defined in public/font.js (ignored); the rest are hung on window by
// public/queue.js / public/shop.js and read bare by the other.
const MENU_GLOBALS = {
	POST: 'readonly',
	PetsConfig: 'readonly', // public/SHARE/PetsConfig.js - the shop renders the pet art
	AchievementsConfig: 'readonly', // public/SHARE/AchievementsConfig.js - the achievements panel
	AchievementBadge: 'readonly', // public/SHARE/AchievementBadge.js - drawn badge renderer
	State: 'writable',   // public/font.js - selected gamemode
	Pref: 'writable',   // public/queue.js - cookie-restored preferences
	UserData: 'writable',   // public/shop.js  - account + owned pets
	ChosenPet: 'writable',   // public/shop.js  - selected pet id
	SetPets: 'writable',   // public/shop.js  - repaint-the-shop callback
	Mess: 'writable',   // public/shop.js  - toast helper, reused by public/account.js
	resize: 'readonly',   // public/font.js
	loop: 'readonly'    // public/font.js
};

// Relaxations, each with the reason it is relaxed. Every one exists because part of the
// codebase relies on the pattern intentionally, not because it was never reviewed. Dead code
// (no-unreachable) and idiom debt are the two categories worth eventually cleaning up rather
// than keeping off forever.
const LEGACY = {
	// `case x: case y:` fallthrough and empty else/catch blocks are used throughout the
	// packet router and the collision switches - `} else {}` is an intentional no-op branch.
	'no-fallthrough': 'off',
	'no-empty': 'off',

	// `return x; break;` inside a switch case, and pre-existing dead branches after an early
	// return, are all over the entity collision code. Dead, not wrong; not a lint concern.
	'no-unreachable': 'off',

	// `while(1)` game loops and an intentionally-disabled dead-code toggle in entities/Player.js.
	'no-constant-condition': 'off',

	// `case 'x': let c = ...` without a block - the switch cases in lib/Controller.js and the
	// entity update methods rely on the shared case scope on purpose.
	'no-case-declarations': 'off',

	// `var clientId` hoisted and re-declared inside a loop (lib/Controller.js) refers to the
	// same function-scoped variable; harmless.
	'no-redeclare': 'off',

	// Last-write-wins assignments (`p2 = p3` at the tail of roundedPoly, loop counters) are
	// stylistic, not bugs.
	'no-useless-assignment': 'off',

	// Unused function arguments are everywhere in db callbacks (`function(err, result,
	// fields)`) and Express handlers; some menu functions (selectGM, play, add, remove) are
	// only called from inline onclick= in the EJS, so they look unused to a single-file lint
	// run. Undeclared *reads* are still no-undef errors - that is the rule that matters.
	'no-unused-vars': 'off',

	// consoleSafe() strips C0/C1 control chars by design; the bot-name table in
	// lib/botNames.js is intentionally non-ASCII and BOM-prefixed.
	'no-control-regex': 'off',
	'no-irregular-whitespace': 'off',

	// Bare `parseInt(x)` (no radix arg) is used throughout for numeric truncation, not just
	// string parsing.
	'radix': 'off',

	'no-var': 'error',
	'eqeqeq': 'error'
};

module.exports = [
	{
		// font.js is a vendored art asset. reference/, diepcustom/ and diepindepth/ are
		// read-only reference material never built or run here; excluding them keeps
		// `npm run lint` fast and free of unrelated errors.
		ignores: ['node_modules/**', 'public/font.js', 'reference/**',
			'diepcustom/**', 'diepindepth/**']
	},
	js.configs.recommended,
	{
		// --- Node, CommonJS ---
		files: ['server.js', 'lib/**/*.js', 'net/**/*.js', 'rooms/**/*.js', 'entities/**/*.js',
			'web/**/*.js', 'test/**/*.js', 'eslint.config.js'],
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'commonjs',
			globals: globals.node
		},
		rules: LEGACY
	},
	{
		// --- Browser menu page (views/index.ejs) ---
		files: ['public/queue.js', 'public/shop.js', 'public/account.js'],
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'script',
			globals: Object.assign({}, globals.browser, MENU_GLOBALS)
		},
		rules: LEGACY
	},
	{
		// --- Dual-mode game page: loaded by <script> *and* require()d by the test suite ---
		files: ['public/SHARE/*.js', 'public/motion.js', 'public/client/*.js'],
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'script',
			globals: Object.assign({}, globals.browser, globals.node, PAGE_GLOBALS)
		},
		rules: LEGACY
	}
];