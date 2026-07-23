/*
  Game server entry point.  ws://localhost:8080 by default (PORT overrides).

  This file used to be the entire server - 3918 lines of sockets, rooms, entities, physics,
  AI, chat and admin commands in one scope. It is now just the boot sequence, and even that
  lives in lib/boot.js so the tests can stand the game up without opening a port.

  Run alongside obstarWeb.js, which serves the menu on :80. `npm start` starts both.
*/
require('./lib/crash.js').install('error.log');

const config = require('./lib/config.js').config;
const boot   = require('./lib/boot.js');
const net    = require('./net/server.js');

if(config.MYSQL){
  let USERS = require('mysql').createPool(require('./lib/AlexMysql.js').info);
  USERS.getConnection(function(err){
    if(err) throw err;
    console.log('connect database');
  });
}

boot();
net.listen(process.env.PORT || 8080);
