/*
  The client's shared scope.

  public/new2Init.js was one 3352-line IIFE, so everything in it could see everything else
  by closure. Splitting it by namespace means those names have to travel some other way;
  this object is how. It is the client-side twin of lib/runtime.js, and it follows the same
  rule as the one in HANDOFF 2.1, for the same reason:

    - a file may alias a name off CLIENT at load time only if an *earlier* file in the
      views/play.ejs load order already put it there (CONST, Global, General, the entity
      classes - all defined while the page is parsing);
    - anything created inside CLIENT.Run() - User, Instances, the 2D context - must be read
      through CLIENT at the point of use, because at load time it does not exist yet.

  Load order is fixed by views/play.ejs and repeated in test/clientDom.js:

    runtime, config, util, drawings, entities, render, ui, game, overlay, boot

  There is no bundler and no build step. Each file carries the same typeof(exports) footer as
  public/motion.js, so `require()`ing them from Node hands back this same object - the whole
  registry, not one file's exports - and the parts that are pure arithmetic can be poked at
  directly. Node has to supply what the page would have:

    global.window = global;                                    // config.js caches C on it
    global.TanksConfig = require('../SHARE/TanksConfig.js');
    global.PetsConfig  = require('../SHARE/PetsConfig.js');
    global.MOTION      = require('../motion.js');
    const CLIENT = require('./runtime.js');
    require('./config.js'); require('./util.js'); require('./entities.js');

  render.js, ui.js, game.js and boot.js want a DOM; test/clientDom.js is the one that has one.
*/
(function(CLIENT){
  CLIENT.Run    = null;   // public/client/game.js
  CLIENT.preRun = null;   // public/client/boot.js
})(typeof(exports) === 'undefined'
    ? (window.CLIENT = window.CLIENT || {})
    : (module.exports = global.CLIENT = global.CLIENT || {}));
