/*
	ESLint flat config (`npm run lint`). There is no bundler, so typos in rarely-run paths
	only show up at lint time — `no-undef` and `no-global-assign` are errors everywhere;
	stylistic rules are off. `no-var` and `eqeqeq` stay on. Tuned to pass clean on this tree.
	New rules that flag existing code: fix the code or leave the rule out — warnings nobody
	reads are worse than no rule.

	Three lint environments:
		- Node CommonJS: server.js, lib/, net/, rooms/, entities/, web/, test/
		- Browser menu: public/queue.js, public/shop.js, public/account.js
		- Dual-mode game scripts: public/SHARE/, public/motion.js, public/client/ (browser
			and Node via test require())
*/
const js = require('@eslint/js');
const globals = require('globals');

// Play-page globals (script load order / POST injection); absent from a single-file lint run.
const PAGE_GLOBALS = {
	POST: 'readonly',   // server-injected JSON (key, gm, name, pet, ws)
	WS_LINK: 'readonly',
	World: 'readonly',
	TanksConfig: 'readonly',
	PetsConfig: 'readonly',
	AchievementsConfig: 'readonly',
	ObjectsConfig: 'readonly',
	PROTO: 'readonly',
	MOTION: 'readonly',
	Physics: 'readonly',
	CLIENT: 'writable',   // client shared scope object
	colorPattern: 'writable'   // two-tone tank palette on window
};

// Menu-page globals. State, resize, loop are defined in public/font.js (lint-ignored art bundle).
const MENU_GLOBALS = {
	POST: 'readonly',
	PetsConfig: 'readonly',
	AchievementsConfig: 'readonly',
	AchievementBadge: 'readonly',
	State: 'writable',   // font.js — selected gamemode
	Pref: 'writable',
	UserData: 'writable',
	ChosenPet: 'writable',
	SetPets: 'writable',
	Mess: 'writable',
	resize: 'readonly',   // font.js
	loop: 'readonly'   // font.js
};

// Intentional legacy patterns — relax only what the codebase relies on by design.
// Turning a rule on means fixing every hit in the same change, not living with warnings.
const LEGACY = {
	// Fallthrough switch cases and empty else/catch branches used as no-ops.
	'no-fallthrough': 'off',
	'no-empty': 'off',

	// Dead code after early return in large switch/collision paths.
	'no-unreachable': 'off',

	// Game loops use `while (1)`; some toggles are intentionally constant.
	'no-constant-condition': 'off',

	// `let` in switch cases without blocks — shared case scope is relied on.
	'no-case-declarations': 'off',

	// Hoisted `var` redeclarations in tight loops, same binding.
	'no-redeclare': 'off',

	// Last-write-wins tail assignments in geometry helpers.
	'no-useless-assignment': 'off',

	// Unused args in DB/Express callbacks; menu handlers invoked from inline HTML.
	// Undeclared reads are still no-undef errors — that is the rule that matters.
	'no-unused-vars': 'off',

	// Deliberate control-char stripping and non-ASCII bot-name table.
	'no-control-regex': 'off',
	'no-irregular-whitespace': 'off',

	// `parseInt(x)` without radix used for truncation, not parsing.
	'radix': 'off',

	'no-var': 'error',
	'eqeqeq': 'error'
};

module.exports = [
	{
		// Vendored art and non-runnable reference trees stay out of lint scope.
		ignores: ['node_modules/**', 'public/font.js', 'reference/**',
			'diepcustom/**', 'diepindepth/**']
	},
	js.configs.recommended,
	{
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
		files: ['public/queue.js', 'public/shop.js', 'public/account.js'],
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'script',
			globals: Object.assign({}, globals.browser, MENU_GLOBALS)
		},
		rules: LEGACY
	},
	{
		files: ['public/SHARE/*.js', 'public/motion.js', 'public/client/*.js'],
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'script',
			globals: Object.assign({}, globals.browser, globals.node, PAGE_GLOBALS)
		},
		rules: LEGACY
	}
];
