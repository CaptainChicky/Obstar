/*
	Crash reporting for both entry points.

	The default is fail-fast: an uncaught exception or unhandled rejection logs to a file and
	then exits. A server that keeps running after its state may be corrupted just looks healthy
	while serving broken game rooms, with the only evidence sitting in a log file nobody reads.

	Set OBSTAR_SWALLOW_CRASHES=1 to keep the process alive instead (e.g. if a production box
	would rather serve a broken room than drop every connected player).
*/
const fs = require('fs');
const util = require('util');

const SWALLOW = process.env.OBSTAR_SWALLOW_CRASHES === '1';

exports.install = function (logName) {
	const log = fs.createWriteStream(__dirname + '/../' + logName, { flags: 'a' });

	const report = function (kind, err) {
		const stack = (err && err.stack) ? err.stack : String(err);
		const line = '[' + new Date().toISOString() + '] ' + kind + ': ' + stack;
		console.error(line);
		log.write(util.format(line) + '\n');
		return line;
	};

	process.on('uncaughtException', function (err) {
		report('uncaughtException', err);
		if (SWALLOW) {
			console.error('  (OBSTAR_SWALLOW_CRASHES=1 - staying alive, state may be corrupt)');
			return;
		}
		// Give the log stream a tick to flush before we go down.
		log.end(function () { process.exit(1); });
		setTimeout(function () { process.exit(1); }, 500).unref();
	});

	process.on('unhandledRejection', function (reason) {
		report('unhandledRejection', reason);
		if (!SWALLOW) {
			log.end(function () { process.exit(1); });
			setTimeout(function () { process.exit(1); }, 500).unref();
		}
	});
};
