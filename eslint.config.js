/*
	ESLint, flat config. `npm run lint`.

	What this is for, and what it is not for. The repo has no build step and no bundler
	(HANDOFF 6): the source you edit is the source that runs, in Node and in the browser
	alike. That makes a linter the only thing standing between a typo and a runtime failure
	on a path nobody executes - and this codebase has already shipped several of exactly
	that (`c.DB.AC` for `.ACC`, `S4team` in a switch over classes that do not exist,
	`states[7]` on a six-element array). So the rules that are ON here are the ones that
	catch a name that is not there - `no-undef` and `no-global-assign`, kept as errors
	everywhere. Everything stylistic is OFF.

	It is tuned to pass clean on the current tree. If you are adding a rule that flags
	existing code, either fix the code in the same commit or leave the rule out - a lint run
	that always prints 200 warnings is a lint run nobody reads.

	Two of the bulk-idiom rules HANDOFF 6.2 tracked as debt are now ON, because the tree was
	swept clean of what they flag (HANDOFF 12.2): `no-var` (was 84 `var`, now let/const
	throughout) and `eqeqeq` (was 51 loose `==`, now strict - the one intentional null/undefined
	test was rewritten as `=== undefined`). They stay on to keep the idiom from creeping back.
	`for...in` is left un-enforced: the remaining loops over Instances are the hot-path work in
	HANDOFF 12.3, not a mechanical fix.

	Three environments, because three kinds of file live here:
		- Node CommonJS: server.js, lib/, net/, rooms/, entities/, web/, test/
		- browser menu page (views/index.ejs): public/queue.js, public/shop.js - they share
			State/Pref/UserData/ChosenPet/SetPets across <script> tags and with public/font.js
			(which is ignored below as vendored art, and is where State/resize/loop are defined)
		- dual-mode game page (views/play.ejs): public/SHARE/*.js, public/motion.js and
			public/client/*.js carry the typeof(exports) footer described in HANDOFF 2, so they
			see *both* the browser globals and Node's - test/*.js require() them directly.
*/
const js = require('@eslint/js');
const globals = require('globals');

// Names the game page shares through the page rather than through a module system. Every
// one is defined by a <script> in views/play.ejs (or injected by the server as POST), so
// to a single-file lint run they look undefined.
const PAGE_GLOBALS = {
	POST: 'readonly',   // server-injected JSON blob (key, gm, name, pet, ws)
	WS_LINK: 'readonly',   // public/SHARE/ws_link.js
	TanksConfig: 'readonly',   // public/SHARE/TanksConfig.js
	PetsConfig: 'readonly',   // public/SHARE/PetsConfig.js
	PROTO: 'readonly',   // public/SHARE/SocketSchema.js
	MOTION: 'readonly',   // public/motion.js
	CLIENT: 'writable',   // public/client/runtime.js - the client's shared scope
	colorPattern: 'writable'    // the two-tone tank palette, hung on window
};

// The menu page (views/index.ejs) has its own shared-through-the-window names. State,
// resize and loop are defined in public/font.js (ignored); the rest are hung on window by
// public/queue.js / public/shop.js and read bare by the other.
const MENU_GLOBALS = {
	POST: 'readonly',
	PetsConfig: 'readonly', // public/SHARE/PetsConfig.js - the shop renders the pet art
	State: 'writable',   // public/font.js - selected gamemode
	Pref: 'writable',   // public/queue.js - cookie-restored preferences
	UserData: 'writable',   // public/shop.js  - account + owned pets
	ChosenPet: 'writable',   // public/shop.js  - selected pet id
	SetPets: 'writable',   // public/shop.js  - repaint-the-shop callback
	resize: 'readonly',   // public/font.js
	loop: 'readonly'    // public/font.js
};

// Relaxations, each with the reason it is relaxed. These are rules `eslint:recommended`
// turns on that the existing tree trips deliberately; every one was looked at before being
// switched off (see the audit in HANDOFF 8.10). The ones that mark *deferred cleanup* rather
// than a permanent convention - dead code (no-unreachable) and the idiom debt kept off below -
// are tracked as a backlog in HANDOFF 12; grep the tree for `CLEANUP(HANDOFF` for the sites.
const LEGACY = {
	// `case x: case y:` fallthrough and empty else/catch blocks are used throughout the
	// packet router and the collision switches - `} else {}` is an intentional no-op branch.
	'no-fallthrough': 'off',
	'no-empty': 'off',

	// `return x; break;` inside a switch case, and pre-existing dead branches after an early
	// return, are all over the entity collision code. Dead, not wrong; the dead-code sweep is
	// HANDOFF 6.2, not this file's job.
	'no-unreachable': 'off',

	// `while(1)` game loops and the intentionally-disabled `else if(false)` toggle in
	// entities/Player.js.
	'no-constant-condition': 'off',

	// `case 'x': let c = ...` without a block - the switch cases in lib/Controller.js and the
	// entity update methods rely on the shared case scope on purpose.
	'no-case-declarations': 'off',

	// `var clientId` hoisted and re-declared inside a loop (lib/Controller.js) is the same
	// function-scoped variable; harmless var idiom, tracked with the rest of the var debt.
	'no-redeclare': 'off',

	// Last-write-wins assignments (`p2 = p3` at the tail of roundedPoly, loop counters) are
	// stylistic, not bugs.
	'no-useless-assignment': 'off',

	// Unused function arguments are everywhere in the mysql callbacks (`function(err,result,
	// fields)`) and Express handlers; menu functions (selectGM, play, add, remove) are
	// "unused" only because they are called from inline onclick= in the EJS. Undeclared
	// *reads* are still no-undef errors - that is the rule that matters.
	'no-unused-vars': 'off',

	// consoleSafe() strips C0/C1 control chars by design (HANDOFF 5.11); the bot-name table
	// in lib/botNames.js is intentionally non-ASCII and BOM-prefixed.
	'no-control-regex': 'off',
	'no-irregular-whitespace': 'off',

	// Bare `parseInt(x)` (no radix arg) is used throughout for numeric truncation, not just
	// string parsing - e.g. entities/Player.js, rooms/Room.js, public/SHARE/SocketSchema.js.
	'radix': 'off',

	// Swept clean in HANDOFF 12.2 and kept on so the idiom cannot creep back. See the header.
	'no-var': 'error',
	'eqeqeq': 'error'
};

module.exports = [
	{
		ignores: ['node_modules/**', 'public/font.js']   // font.js is a vendored art asset
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
		files: ['public/queue.js', 'public/shop.js'],
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