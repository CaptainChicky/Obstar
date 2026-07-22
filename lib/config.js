/*
  Live server flags.

  This file used to also export a large CONFIG block holding the bot / boss / pet AI.
  It was dead code: Alex.js declares its own `var CONFIG` that shadowed it, and the two
  copies had diverged - the copy here called CONFIG.BOT_PATHS / CONFIG.BOTS_UPS while
  defining the keys as BOT_PATH / BOT_UPS, so it would have thrown on the first bot tick
  had anything ever loaded it. Editing AI here changed nothing. The working copy lives in
  Alex.js; that is the one to edit.
*/
exports.config = {
  'MYSQL': false,
  'DB': {
    'ACC': false,
    'SHOP': false,
    'DEV': false,
    'LB': false
  },
  'KEY_ISNEEDED':  false, //dont apply if Mysql or DB.ACC is on flase
  'S_BEFORE_KICK': 120,   // the nb of seconds before kicking someone afk on the death screen
  'MAX_IP':        2,     // max tabs someone can play on
  'DES':           10,
  'DEAD_DELAY':    150,   // the nb off ms before the person can replay
  'KEEP_PLACE':    20,
  'SIZE_GET_POS':  40
}

