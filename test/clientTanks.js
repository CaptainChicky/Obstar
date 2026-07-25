/*
	Loads public/SHARE/TanksConfig.js in its *client* mode from inside Node.

	TanksConfig.js picks its half of the tank table at load time with a `platform === 'client'`
	ternary (line 9): a plain require() runs with `exports` defined, so it always resolves to
	the ///SERVER/// half. That half carries `canonLength`/`reload`/`damage`/etc - the numbers
	bullets spawn from - and is missing `height`/`width`/`open` - the numbers the client draws
	with. A test that wants to compare the two (test/tanks.js) needs a second load that takes
	the other branch, which means running the source with no `exports` binding.

	Same trick as test/clientProto.js, with one addition: TanksConfig.js:7 reads
	`globalThis.KIND` on the client path (the browser has already run kinds.js as a <script>
	tag by the time TanksConfig.js executes), so the sandbox needs `KIND` seeded before running
	the source.
*/
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = path.join(__dirname, '..', 'public', 'SHARE', 'TanksConfig.js');

module.exports = function loadClientTanks() {
	const sandbox = { console: console };
	sandbox.KIND = require(path.join(__dirname, '..', 'public', 'SHARE', 'kinds.js'));
	vm.createContext(sandbox);
	vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: SRC });
	if (!sandbox.TanksConfig || !sandbox.TanksConfig.class) {
		throw new Error('TanksConfig.js did not expose a client-side TanksConfig');
	}
	return sandbox.TanksConfig;
};
