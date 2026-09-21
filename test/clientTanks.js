/*
	Loads public/SHARE/TanksConfig.js in its *client* mode from inside Node.

	TanksConfig.js picks client vs server at load time via `platform === 'client'`. A plain
	require() always gets the server half (spawn stats, no draw dimensions). Load again with
	no `exports` binding to get the client branch.

	Same vm trick as test/clientProto.js; seed `KIND` first because TanksConfig.js reads
	`globalThis.KIND` on the client path before running the source.
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
