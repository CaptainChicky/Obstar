/*
  Game server entry point.  ws://localhost:8080 by default (PORT overrides).

  This file used to be the entire server - 3918 lines of sockets, rooms, entities, physics,
  AI, chat and admin commands in one scope. It is now just the boot sequence.

  The modules it wires together reference each other in a cycle: entities call into
  Controller, rooms construct entities, Main constructs rooms, and the AI closes over
  Detector. When everything shared one scope that resolved itself at call time.
  lib/runtime.js is the explicit stand-in for that shared scope, and the order below is
  what fills it:

    1. entity classes   - construct nothing at load time
    2. room classes     - touch entities only during a tick
    3. bot/boss/pet AI  - closes over Detector, so needs step 1 done
    4. Controller       - its constructor builds rooms, which read CONFIG
    5. listen           - only now is it safe to accept a player

  Run alongside obstarWeb.js, which serves the menu on :80. `npm start` starts both.
*/
require('./lib/crash.js').install('error.log');

const RT       = require('./lib/runtime.js');
const Vec      = require('victor');
const config   = require('./lib/config.js').config;
const FRICTION = require('./lib/constants.js').FRICTION;
const CLASS    = require('./public/SHARE/TanksConfig.js').class;

const createGameAI = require('./lib/gameAI.js');
const Main         = require('./lib/Controller.js');
const net          = require('./net/server.js');

if(config.MYSQL){
  let USERS = require('mysql').createPool(require('./lib/AlexMysql.js').info);
  USERS.getConnection(function(err){
    if(err) throw err;
    console.log('connect database');
  });
}

/// 1. Entities ////////////////////////////////////////////////////////////////
RT.Player   = require('./entities/Player.js');
RT.Objects  = require('./entities/Objects.js');
RT.Bullet   = require('./entities/Bullet.js');
RT.Detector = require('./entities/Detector.js');

/// 2. Rooms ///////////////////////////////////////////////////////////////////
RT.Sffa   = require('./rooms/Sffa.js');
RT.S2team = require('./rooms/S2team.js');

/// 3. AI //////////////////////////////////////////////////////////////////////
RT.CONFIG = createGameAI({
  Detector: RT.Detector,
  Vec:      Vec,
  FRICTION: FRICTION,
  CLASS:    CLASS,
  DES:      config.DES
});

/// 4. Controller //////////////////////////////////////////////////////////////
RT.Controller = new Main();

/// 5. Accept players //////////////////////////////////////////////////////////
net.listen(process.env.PORT || 8080);
