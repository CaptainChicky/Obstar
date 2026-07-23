/*
  TwoTeam - two sides, a base each, and a boss that turns up about once every ten thousand
  spawn rolls.

  The simulation lives in rooms/Room.js. What is left here is what actually makes this a
  team mode: joining players are balanced across the two sides, tanks and bullets take their
  colour from their team instead of from who is looking, team mates cannot hurt each other
  or be targeted by each other's drones, each side spawns in and is fenced out of a base
  strip, and ten guard drones sit in front of each base from the moment the room opens.
*/
const RT   = require('../lib/runtime.js');
const Room = require('./Room.js');

class TwoTeam extends Room {
  constructor(id){
    super(id,{
      gm:            '2team',
      maxXp:         30000,
      mapSize:       {width: 8000, height: 8000},
      preGenerate:   1000,
      bootDelay:     1,
      objCaps:       {sqr: {max0: 160, max1: 18}, tri: {max0: 60, max1: 12}, pnt: {max0: 18, max1: 15}},
      betaPentRng:   0.99,
      bossRng:       0.9999,
      maxBoss:       1,
      botCount:      3,
      botIdStart:    10,
      teams:         [0,1],
      teamPlay:      true,
      respawnPow:    0.8,
      baseSize:      600,
      viewerBullets: false
    });
  }
  /* A row of immortal guard drones in front of each base. */
  build(){
    this.droneQt = 10;
    for(let team of this.rules.teams){
      let side = team ? 1 : -1;
      for(let i = 1; i<=this.droneQt; i++){
        let bull = new RT.Bullet(
          {"GM":this.gm,"sId":this.id,"oId":-1},
          side*(this.map.width/2-this.baseSize/2),
          this.map.height*i/(this.droneQt+1)-this.map.height/2,
          0,
          0,
        );
        bull.id = {"GM":this.gm,"sId":this.id,"oId":this.INSTANCE.bullets.length};
        bull.team = team;
        bull.ox = bull.x;
        bull.oy = bull.y
        bull.alone = 1;
        bull.life = -1;
        bull.type = 1.4;
        bull.maxspeed = .75;
        bull.pene = 200;
        bull.damage = .1;
        bull.weight = 2;
        bull.size = 20;
        bull.map = this.map;
        this.INSTANCE.bullets.push(bull);
      }
    }
  }
  /* Three bots, alternating sides, starting from one side or the other at random. */
  botRoster(){
    let start = this.rules.botIdStart+parseInt(Math.random()*2);
    let roster = [];
    for(let i = start; i<start+this.rules.botCount; i++){
      roster.push({id: i, team: i%2});
    }
    return roster;
  }
  /* Both sides stay stocked no matter how many humans are in the room. */
  botBudget(humanCount){
    return Infinity;
  }
  /* Cross the strip in front of the other side's base and you die on the spot. */
  inEnemyBase(obj){
    let edge = this.map.width/2-this.baseSize;
    switch(obj.team){
      case 0: return obj.x>edge;
      case 1: return obj.x<-edge;
    }
    return false;
  }
  /* You always come back inside your own base. */
  spawnPoint(tank){
    return {
      x: tank.team ? this.map.width/2-this.baseSize*Math.random() : -this.map.width/2+this.baseSize*Math.random(),
      y: 200+Math.random()*(this.map.height-400)-this.map.height/2
    };
  }
  entityColor(player){
    return player.team;
  }
  mainColor(player){
    return player.team;
  }
  bulletColor(bullet){
    return bullet.color ? bullet.color-1 : bullet.team;
  }
  leaderColor(player,viewerId){
    return player.team;
  }
};

module.exports = TwoTeam;
