/*
  Sffa - the free-for-all room.

  Everything that used to be in here is now in rooms/Room.js, whose defaults *are*
  free-for-all's behaviour: one nominal team, friendly fire on, no bases, no boss, your own
  tank blue and everyone else red. So this file is only the tuning that makes ffa itself -
  a bigger map, a denser field of polygons, a lower level cap and ten bots.
*/
const Room = require('./Room.js');

class Sffa extends Room {
  constructor(id){
    super(id,{
      gm:          'ffa',
      maxXp:       25000,
      mapSize:     {width: 9020, height: 9020},
      preGenerate: 500,
      bootDelay:   100,
      objCaps:     {sqr: {max0: 220, max1: 18}, tri: {max0: 80, max1: 12}, pnt: {max0: 25, max1: 15}},
      betaPentRng: 0.98,
      botCount:    10,
      botIdStart:  10,
      teams:       [1],
      teamPlay:    false,
      respawnPow:  0.9
    });
  }
};

module.exports = Sffa;
