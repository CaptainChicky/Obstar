/*
  Crash reporting for both entry points.

  History: the two old entry points (Alex.js, obstarWeb.js) each installed their own 'uncaughtException'
  handler that logged to a file and then *kept the process running*. A server could
  therefore look healthy while its game rooms were in a corrupted state, and the only
  evidence was a log file nobody reads. That is the single most dangerous habit in this
  codebase, so the default is now fail-fast.

  Set OBSTAR_SWALLOW_CRASHES=1 to restore the old keep-alive behaviour (e.g. if a
  production box would rather serve a broken room than drop every connected player).
*/
const fs   = require('fs');
const util = require('util');

var SWALLOW = process.env.OBSTAR_SWALLOW_CRASHES === '1';

exports.install = function(logName){
  let log = fs.createWriteStream(__dirname + '/../' + logName, {flags:'a'});

  let report = function(kind, err){
    let stack = (err && err.stack) ? err.stack : String(err);
    let line  = '[' + new Date().toISOString() + '] ' + kind + ': ' + stack;
    console.error(line);
    log.write(util.format(line) + '\n');
    return line;
  };

  process.on('uncaughtException', function(err){
    report('uncaughtException', err);
    if(SWALLOW){
      console.error('  (OBSTAR_SWALLOW_CRASHES=1 - staying alive, state may be corrupt)');
      return;
    }
    // Give the log stream a tick to flush before we go down.
    log.end(function(){ process.exit(1); });
    setTimeout(function(){ process.exit(1); }, 500).unref();
  });

  process.on('unhandledRejection', function(reason){
    report('unhandledRejection', reason);
    if(!SWALLOW){
      log.end(function(){ process.exit(1); });
      setTimeout(function(){ process.exit(1); }, 500).unref();
    }
  });
};
