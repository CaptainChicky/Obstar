/*
  Room - the shared simulation behind every gamemode.

  Sffa and S2team used to be two ~750-line files that were roughly 90% the same code and
  had already drifted apart in a dozen places (HANDOFF.md 5.8). Everything genuinely shared
  - the tick, the quadtree, collision, spawning, the leaderboard, the per-player view
  builder - now lives here exactly once. A gamemode is a subclass that hands super() a block
  of tunables and overrides a handful of small hooks:

    HOOK                    BASE DEFAULT                   WHY IT EXISTS
    botRoster()             rules.botCount bots, one team  2team splits bots across sides
    botBudget(humans)       rules.botCount - humans        2team respawns every dead bot
    spawnPoint(tank)        anywhere, clear of the nests   2team spawns you in your base
    assignTeam()            rules.teams[0]                 2team balances the two sides
    assignBulletTeam(b,o)   dev colour, else the one team  2team tags bullets by shooter
    createBoss()            nothing                        2team can summon a boss
    inEnemyBase(obj)        false                          2team kills you in the enemy base
    entityColor(p)          1 - everyone else is red       team modes colour by team
    mainColor(p)            0 - you are blue               team modes colour by team
    bulletColor(b)          traps 9, else the bullet team  team modes honour dev colour
    ownBulletColor(b,you)   your own colour                only used when rules.viewerBullets
    leaderColor(p,id)       you 0, everyone else 1

  The defaults are free-for-all's behaviour, so Sffa overrides almost nothing.

  Adding a mode means writing one of these subclasses - see rooms/S2team.js for the biggest
  one there is. Nothing outside rooms/ needs to know a new mode exists beyond the ROOMS
  table in lib/Controller.js and the gamemode whitelist in Controller.askConnection.

  Entity classes and the Controller singleton are reached through the late-bound registry
  (lib/runtime.js) because the dependency graph is circular - see the note there.
*/
const RT         = require('../lib/runtime.js');
const Vec        = require('victor');
const config     = require('../lib/config.js').config;
const cc         = require('../lib/terminal.js');
const quadTree   = require('../lib/quadTree.js');
const CLASS      = require('../public/SHARE/TanksConfig.js').class;
const CLASS_TREE = require('../public/SHARE/TanksConfig.js').tree;
const FRICTION   = require('../lib/constants.js').FRICTION;

/*
  Every knob a gamemode can turn without writing code. A subclass spreads its own values
  over these in its constructor, so a mode only states what it changes.
*/
const DEFAULT_RULES = {
  gm:           'ffa',
  maxXp:        25000,  // the level-30 cap; drives the whole XPLVL curve
  mapSize:      {width: 9020, height: 9020},
  maxPlayer:    24,
  preGenerate:  500,    // generate() passes run before the room opens
  bootDelay:    100,    // ms between construction and the first tick
  objCaps:      {sqr: {max0: 220, max1: 18}, tri: {max0: 80, max1: 12}, pnt: {max0: 25, max1: 15}},
  betaPentRng:  0.98,   // RNG above this may spawn a beta pentagon
  bossRng:      2,      // ... and above this calls createBoss(). 2 = never.
  botCount:     10,
  botIdStart:   10,     // bots occupy a fixed slot range so respawn can find them
  teams:        [1],    // the team ids this mode assigns. One entry = free-for-all.
  teamPlay:     false,  // friendly fire off, and detectors ignore team mates
  respawnPow:   0.9,    // exponent of the xp you keep through a death
  baseSize:     0,
  viewerBullets: true   // re-encode your own bullets per viewer so they read as yours
};

class Room {
  constructor(id, rules){
    this.rules = Object.assign({}, DEFAULT_RULES, rules);
    let POW = 2.5;
    let MXLVL = this.rules.maxXp;
    this.XPLVL = new Array(30).fill(0).map((x,i)=>{
      if(i == 0){
        return 0;
      }
      let a = 30/Math.pow(MXLVL,1/POW)
      return Math.min(MXLVL,parseInt(Math.pow((i+1)/a,POW)));
    })
    this.gm = this.rules.gm;
    this.id = id;
    this.BUFFER = {};
    this.INSTANCE = {
      "players":[],
      "objs":[],
      "bullets":[],
      "detectors": []
    };
    let caps = this.rules.objCaps;
    this.obj = {
      "sqr":{"0":0,"1":0,"max0":caps.sqr.max0,"max1":caps.sqr.max1},
      "tri":{"0":0,"1":0,"max0":caps.tri.max0,"max1":caps.tri.max1},
      "pnt":{"0":0,"1":0,"max0":caps.pnt.max0,"max1":caps.pnt.max1},
      "Bpnt":{'1':0,'max1':3},
      "Bsqr":{'1':0,'max1':2},
      "Btri":{'1':0,'max1':2},
      "bull":{'1':0,'max1':20}
    };
    this.maxPlayer = this.rules.maxPlayer;
    this.baseSize = this.rules.baseSize;
    this.leader = [];
    this.map = {
      width:  this.rules.mapSize.width,
      height: this.rules.mapSize.height
    };
    // newMap is what the map lerps towards each tick; the 'mapResize' admin command writes
    // it. Starting them equal makes the lerp a no-op until someone asks for a resize.
    this.newMap = {
      width:  this.rules.mapSize.width,
      height: this.rules.mapSize.height
    };
    this.timestamp = 0;
    this.bots = [];
    this.boss = null;
    this.build();
    setTimeout((it)=>{it.Init(); it.update()},this.rules.bootDelay,this);
  }
  /*
    Anything a mode needs standing in the world before the first tick - 2team's base
    drones. Runs before Init(), which is what fills the map with polygons.
  */
  build(){}
  Init(){
    for(let i = 0; i<this.rules.preGenerate; i++){
      this.generate(0);
    }
    this.createAi();
    setTimeout(function(it){it.generate()},300,this);
  }
  generate(go = 1){
    if(this.destroy){return;}
    const RNG = Math.random();
    ///SQUARE///
    if(RNG<1){
      let obj = this.obj.sqr;
      if(obj[0]<obj.max0){this.createObj("sqr",0); obj[0]++;}
      if(obj[1]<obj.max1 && Math.random()<0.26){this.createObj("sqr",1); obj[1]++;}
    }
    ///TRIANGLE///
    if(RNG<0.7){
      let obj = this.obj.tri;
      if(obj[0]<obj.max0){this.createObj("tri",0); obj[0]++;}
      if(obj[1]<obj.max1 && Math.random()<0.26){this.createObj("tri",1); obj[1]++;}
    }
    ///PENTAGONE///
    if(RNG<0.5){
      let obj = this.obj.pnt;
      if(obj[0]<obj.max0){this.createObj("pnt",0); obj[0]++;}
      if(obj[1]<obj.max1 && Math.random()<0.2){this.createObj("pnt",1); obj[1]++;}
    }
    ///BULL///
    if(RNG<0.1){
      let obj = this.obj.bull;
      if(obj[1]<obj.max1){this.createObj("bull",0); obj[1]++;}
    }
    ///BETA PENTAGONE///
    if(RNG>this.rules.betaPentRng){
      let obj = this.obj.Bpnt;
      if(obj[1]<obj.max1){this.createObj("Bpnt",1); obj[1]++;}
    }
    ///BETA SQUARE///
    if(RNG>0.992){
      let obj = this.obj.Bsqr;
      if(obj[1]<obj.max1){this.createObj("Bsqr",1); obj[1]++;}
    }
    ///BETA TRIANGLE///
    if(RNG>0.992){
      let obj = this.obj.Btri;
      if(obj[1]<obj.max1){this.createObj("Btri",1); obj[1]++;}
    }
    ///BOSSES///
    if(RNG>this.rules.bossRng){
      if(!this.boss && Math.random()>0.3){this.createBoss()}
    }
    if(go){
      setTimeout(function(it){it.generate()},400,this)
    };
  }
  createObj(type,pos){
    let ppp = -1;
    if(pos){
      switch(type){
        case 'sqr':
        case 'Bsqr':
          ppp = [this.map.width/4,this.map.height/4,350];
        break;
        case 'tri':
        case 'Btri':
          ppp = [-this.map.width/4,-this.map.height/4,350];
        break;
        case 'pnt':
        case 'Bpnt':
          ppp = [0,0,450];
        break;
      }
    }
    if(type == 'bull'){ppp = 'bull';}
    for(let i=0; i<=this.INSTANCE.objs.length; i++){
      if(!this.INSTANCE.objs[i]){
        this.INSTANCE.objs[i] = (new RT.Objects(type,ppp,{"GM":this.gm,"sId":this.id,"oId":i},this.map));
        break;
      } else if(!isNaN(this.INSTANCE.objs[i])){
        this.INSTANCE.objs[i]--
      }
    }
  }
  createAi(){
    for(let slot of this.botRoster()){
      let bot = new RT.Player(
        {"GM":this.gm,"sId":this.id,"oId":slot.id},
        0,
        0,
        RT.CONFIG.BOT_NAMES[parseInt(Math.random()*(RT.CONFIG.BOT_NAMES.length-1))],
        slot.team,
        this.XPLVL
      );
      bot.motion = RT.CONFIG.BOTS[0].bind(bot);
      bot.bot = 1;
      bot.xp = 5000+parseInt(Math.random()*60000)
      this.INSTANCE.players[slot.id] = bot;
      this.bots.push(slot.id);
      this.respawn(slot.id,1,1);
    }
  }
  /*
    Which slots the bots live in and whose side they are on. Slots are fixed for the life of
    the room - update() walks this.bots to find dead ones.
  */
  botRoster(){
    let roster = [];
    for(let i = this.rules.botIdStart; i<this.rules.botIdStart+this.rules.botCount; i++){
      roster.push({id: i, team: this.rules.teams[0]});
    }
    return roster;
  }
  /* How many dead bots may come back this tick. Free-for-all tops the room up to botCount. */
  botBudget(humanCount){
    return Math.max(0,this.rules.botCount-humanCount);
  }
  /* Modes with a boss override this. The base no-op is what makes the 'summonRandBoss'
     admin command harmless in modes that have none. */
  createBoss(){}
  createBullet(bullet,origine){
    this.assignBulletTeam(bullet,origine);
    bullet.map = this.map;
    for(let i = 0; i<=this.INSTANCE.bullets.length; i++){
      if(!this.INSTANCE.bullets[i]){
        bullet.id = {'GM':this.gm,'sId':this.id,'oId':i};
        this.INSTANCE.bullets[i] =  bullet;
        break;
      } else {
        if(!isNaN(this.INSTANCE.bullets[i])){
          this.INSTANCE.bullets[i] -= 1;
        }
      }
    }
  }
  assignBulletTeam(bullet,origine){
    bullet.team = origine.dev.color ? origine.dev.color-1 : this.rules.teams[0];
  }
  update(){
    let stop = 1;
    let playerCount = 0;
    for(let i of this.INSTANCE.players){
      if(i && !i.bot){
        playerCount++;
        stop = 0;
      }
    }
    if(stop){
      this.destroy = 1;
      console.log(cc.Bright+cc.BgYellow+'DELETED SERVER //'+cc.Reset+' '+this.gm+':'+this.id);
      delete RT.Controller.server[this.gm][this.id];
      return;
    }
    ///MAP///
    if(Math.abs(this.map.width-this.newMap.width)>0.1){
      this.map.width += (this.newMap.width-this.map.width)*.1;
    } else {
      this.map.width = this.newMap.width;
    }
    if(Math.abs(this.map.height-this.newMap.height)>0.1){
      this.map.height += (this.newMap.height-this.map.height)*.1;
    } else {
      this.map.height = this.newMap.height;
    }
    ///BOTS///
    let botNeeded = this.botBudget(playerCount);
    if(botNeeded){
      for(let b of this.bots){
        let bot = this.INSTANCE.players[b];
        if(bot && bot.dead == 1 && botNeeded){
          this.respawn(b,0,1);
          botNeeded --;
        }
      }
    }
    ///BOSS///
    if(this.boss && this.boss.destroy == 1){
      this.boss.state.disconnect = 1;
      this.boss = null;
    }
    ///LEAD+ ADD TO QT///
    this.timestamp++;
    let qt = new quadTree(-this.map.width/2-1000,-this.map.height/2-1000,this.map.width+2000,this.map.height+2000,6);
    this.leader = [];
    for(let kind in this.INSTANCE){
      for(let j in this.INSTANCE[kind]){
        let i = this.INSTANCE[kind][j];
        if(!isNaN(i)){
          if(i){
            i--;
          } else {
            delete this.INSTANCE[kind][j];
          }
          continue;
        } else if(!i) continue;
        if(kind === 'players' && !i.destroy && !i.boss){
          if(this.leader.length){
            for(let l = Math.min(this.leader.length-1,9); l>=0; l--){
              if(this.leader.length<9){
                ///
                if(this.leader[l].xp<i.xp){
                  if(!l || this.leader[l-1].xp>=i.xp){
                    this.leader.splice(l,0,i);
                    break;
                  }
                } else if(l == this.leader.length-1){
                  this.leader.push(i);
                  break;
                }
                ///
              } else if(this.leader[l].xp<i.xp && (!l || this.leader[l-1].xp>=i.xp)){
                this.leader.splice(l,0,i);
                this.leader.pop();
                break;
              }
            }
          } else {
            this.leader.push(i);
          }
        }
        if(i.destroy == 1){
          if(kind == "players"){
            if(i.state.disconnect){
              this.INSTANCE[kind][j].delete();
            } else {
              continue;
            }
          }
          // objs and bullets leave a numeric tombstone rather than a hole, so the slot -
          // and with it the entity id the client is tracking - is not handed to a new
          // entity on the next frame.
          if(kind == "objs"){this.INSTANCE[kind][j].delete();this.INSTANCE[kind][j] = config.KEEP_PLACE; continue;}
          if(kind == 'bullets'){this.INSTANCE[kind][j] = config.KEEP_PLACE; continue;}
          delete this.INSTANCE[kind][j];
        } else {
          if(i.getPlace == 1){
            i.size+=config.SIZE_GET_POS;
          }
          qt.insert(i.x,i.y,i.size,i);
        }
      }
    }
    ///COLLISION///
    for(let kind in this.INSTANCE){
      for(let obj of this.INSTANCE[kind]){
        if(typeof obj === "undefined" || !isNaN(obj)){continue;}
        if(obj.getPlace == 0){
          continue;
        }
        if(obj.destroy>=1){continue;}
        if((kind == 'players' || kind == 'bullets') && this.inEnemyBase(obj)){
          obj.collision(0,{base:1});
          continue;
        }
        let collide = qt.query(function (rect,circle){
            var distX = Math.abs(circle.x - rect.x-rect.w/2);
            var distY = Math.abs(circle.y - rect.y-rect.h/2);

            if (distX > (rect.w/2 + circle.r)) { return false; }
            if (distY > (rect.h/2 + circle.r)) { return false; }

            if (distX <= (rect.w/2)) { return true; }
            if (distY <= (rect.h/2)) { return true; }

            var dx=distX-rect.w/2;
            var dy=distY-rect.h/2;
            return (dx*dx+dy*dy<=(circle.r*circle.r));
        },{'x':obj.x,'y':obj.y,'r':(obj.DETEC && obj.DETEC.enabled ? obj.DETEC.size : obj.size)*2})
        for(let i in collide){
          let other = collide[i].data;
          if(other.getPlace == 0 || obj.getPlace == 0){
            continue;
          }
          let otherCLASS = other.constructor.name;
          let objCLASS = obj.constructor.name;
          ///
          if(other.destroy>=1){continue;}
          if(objCLASS == 'Detector' && otherCLASS == 'Detector'){continue;}
          if(obj.id.oId == other.id.oId && objCLASS == otherCLASS){continue;}
          let dis = Math.sqrt(Math.pow(other.x-obj.x,2)+Math.pow(other.y-obj.y,2));
          if((isNaN(other.getPlace) || isNaN(obj.getPlace)) && (!this.rules.teamPlay || other.team != obj.team)){
            if(obj.DETEC && obj.DETEC.enabled){
              if(dis <= obj.DETEC.size+other.size){
                obj.DETEC.collision(other,{dis:dis})
              }
            } else if(other.DETEC && other.DETEC.enabled){
              if(dis <= obj.size+other.DETEC.size){
                other.DETEC.collision(obj,{dis:dis})
              }
            }
          }
          if(dis <= obj.size+other.size){
            if(obj.size > other.size || obj.x+obj.y >= other.x+other.y){
              ///
              if(other.getPlace || obj.getPlace){
                if(other.getPlace && objCLASS == 'Player'){
                  other.getPlace = 0;
                }
                if(obj.getPlace && otherCLASS == 'Player'){
                  obj.getPlace = 0;
                }
                continue;
              }
              if(obj.x == other.x && obj.y == other.y){
                obj.x+=Math.random()-.5;
                obj.y+=Math.random()-.5;
              }
              ///
              let objOption = {};
              let otherOption = {};
              if(this.rules.teamPlay && objCLASS != 'Objects' && otherCLASS != 'Objects' && obj.team == other.team){
                objOption.noDam = 1;
                otherOption.noDam = 1;
              }
              if(objCLASS == 'Bullet'){
                otherOption.pene = obj.pene;
              }
              if(otherCLASS == 'Bullet'){
                objOption.pene = other.pene;
              }
              other.collision(obj,otherOption);
              obj.collision(other,objOption);
              if(objCLASS == 'Bullet'){
                if(other.destroy && other.prize){
                  if(this.INSTANCE.players[obj.origine.oId]){
                    this.INSTANCE.players[obj.origine.oId].xp+=other.prize;
                    this.INSTANCE.players[obj.origine.oId].coins+= other.coinReward || 0;
                    if(otherCLASS == 'Player' && !this.INSTANCE.players[obj.origine.oId].bot){
                      this.INSTANCE.players[obj.origine.oId].mess.push('You killed '+ other.name);
                    }
                  }
                }
              }
              if(otherCLASS == 'Bullet' && obj.prize){
                if(obj.destroy){
                  if(this.INSTANCE.players[other.origine.oId]){
                    this.INSTANCE.players[other.origine.oId].xp+=obj.prize;
                    this.INSTANCE.players[other.origine.oId].coins+=obj.coinReward || 0;
                    if(objCLASS == 'Player' && !this.INSTANCE.players[other.origine.oId].bot){
                      this.INSTANCE.players[other.origine.oId].mess.push('You killed '+ obj.name);
                    }
                  }
                }
              }
              if(obj.destroy){
                break;
              }
            }
          }
        }
      }
    }
    this.INSTANCE.detectors = [];
    ///BUFFING///
    for(let p of this.INSTANCE.players){
      if(p && p.pet){
        this.INSTANCE.bullets[p.pet.id.oId] = 20;
        if(p.alpha) qt.insert(p.pet.x,p.pet.y,p.size,p.pet);
      }
    }
    this.BUFFER = [];
    for(let id in this.INSTANCE.players){
      let player = this.INSTANCE.players[id];
      if(player.bot || player.boss){
        continue;
      }

      var x = player.x-player.screen/2-200, y = player.y-player.screen/2*0.5625-200;
      var w = player.screen+400, h = player.screen*0.5625+400;

      this.BUFFER[id] = {
        x:x,
        y:y,
        w:w,
        h:h
      }
      this.BUFFER[id].main = player;
      this.BUFFER[id].rest = qt.query(function(a,b) {
        return(
          ((a.x + a.w) >= b.x) &&
          (a.x <=(b.x + b.w)) &&
          ((a.y + a.h) >= b.y) &&
          (a.y <= (b.y + b.h))
        );
      },
      {'x':x-200,'y':y-200,'w':w+400,'h':h+400});
    }
    ///UPDATE///
    for(let kind in this.INSTANCE){
      for(let o in this.INSTANCE[kind]){
        let obj = this.INSTANCE[kind][o];
        if(typeof obj === "undefined" || !isNaN(obj)){continue;}
        if(obj.destroy == 1){
          if(kind == "players"){
            if(obj.dead>1){
              obj.dead--;
            }
            if(obj.murder == -1){
              continue;
            }
            let murder = this.INSTANCE[obj.murder[0]][obj.murder[1].oId];
            if(typeof(murder) === "undefined" || !isNaN(murder) || murder.destroy){
              obj.murder = -1;
              continue;
            }
            obj.x+=(murder.x-obj.x)*0.1;
            obj.y+=(murder.y-obj.y)*0.1;
          }
          continue;
        }
        if(obj.getPlace == 1){
          delete obj.getPlace;
          obj.size -= config.SIZE_GET_POS;
        } else if(obj.getPlace == 0){
          obj.delete();
          delete this.INSTANCE[kind][o];
          continue;
        }
        obj.update();
      }
    }
    ///
    setTimeout(function(it){it.update()},20,this);
  }
  /* Team modes fence each side out of the other's base. Anything in there dies. */
  inEnemyBase(obj){
    return false;
  }
  respawn(id, force = 0, bot = 0){
    let tank = this.INSTANCE.players[id];
    if(!tank || (!force && !tank.destroy) || tank.dead>1) return;
    ///
    let pos = this.spawnPoint(tank);
    let newTank = new RT.Player(tank.id,pos.x,pos.y,tank.name,tank.team,this.XPLVL);
    if(bot){
      newTank.motion = RT.CONFIG.BOTS[0].bind(newTank);
      newTank.bot = 1;
      if(Math.random()<0.1){
        newTank.name = RT.CONFIG.BOT_NAMES[parseInt(Math.random()*(RT.CONFIG.BOT_NAMES.length-1))];
      }
    }
    ///
    newTank.xp = force ? tank.xp : this.respawnXp(tank.xp);
    newTank.coins = tank.coins || 0;
    this.INSTANCE.players[id] = newTank;
    ///
    if(tank.pet){
      newTank.pet = tank.pet;
      newTank.pet.x = newTank.x;
      newTank.pet.y = newTank.y;
      newTank.pet.pet = 1;
      let newId = 0;
      while(this.INSTANCE.bullets[newId]){
        newId++;
      }
      newTank.pet.id = {"GM":this.gm,"sId":this.id,"oId":newId};
      this.INSTANCE.bullets[newId] = 20;
    }
    ///
    return tank.xp;
  }
  /*
    How much xp survives a death: a fractional power of what you had, floored at nothing and
    capped at 60% of the level-30 requirement. The Math.min matters - below roughly a
    thousand xp the curve returns *more* than it was given, so without it dying early is a
    reward. (S2team was missing it; see HANDOFF.md 5.8.)
  */
  respawnXp(xp){
    let mXp = this.XPLVL[this.XPLVL.length-1];
    let pow = this.rules.respawnPow;
    if(xp>mXp){
      return mXp*.6;
    }
    return Math.min(xp,parseInt(Math.pow(xp/(mXp/Math.pow(mXp*.6,1/pow)),pow)));
  }
  /* Free-for-all drops you anywhere clear of the three polygon nests. */
  spawnPoint(tank){
    while(1){
      let x = 200+Math.random()*(this.map.width-400)-this.map.width/2;
      let y = 200+Math.random()*(this.map.height-400)-this.map.height/2;
      let dis = Math.sqrt(Math.pow(x,2)+Math.pow(y,2));
      if(dis>1100){
        dis = Math.sqrt(Math.pow(this.map.width/4-x,2)+Math.pow(this.map.height/4-y,2))
        if(dis>800){
          dis = Math.sqrt(Math.pow(-this.map.width/4-x,2)+Math.pow(-this.map.height/4-y,2))
          if(dis>800){
            return {x:x, y:y};
          }
        }
      }
    }
  }
  getBuffer(id){
    let RAW = this.BUFFER[id];
    if(!RAW){
      return;
    }
    if(!RAW.main){
      return;
    }
    let buff = {
      len: 56+(RAW.main.name.length*2)+(RAW.main.canDir.length*2),
      instances:[]
    };
    buff.head = {
      timestamp: this.timestamp,
      width:     this.map.width,
      height:    this.map.height,
      screen:    RAW.main.screen,
      xp:        RAW.main.xp,
      still:     RAW.main.dead ? 0 : RAW.main.level-RAW.main.stillLvl,
      cLvl:      RAW.main.dead ? 0 : parseInt((RAW.main.level)/10)
    };
    ///
    let lvl = RAW.main.level, xp = RAW.main.xp, arr = RAW.main.XPLVL;
    buff.head.level = (!lvl ? 1 : ((lvl>=arr.length-1) ? lvl : lvl+Math.max(Math.min(1,(xp-arr[lvl-1])/(arr[lvl]-arr[lvl-1])),0)));
    ///
    buff.main = {
      states: [!!RAW.main.hit*1,
               !!RAW.main.inputs.c*1,
               !!RAW.main.dead*1,
               !!RAW.main.shield*1,0,0],
      class:  RAW.main.class,
      color:  RAW.main.dev.color ? RAW.main.dev.color-1 : this.mainColor(RAW.main),
      x:      RAW.main.x,
      y:      RAW.main.y,
      vx:     RAW.main.vec.x,
      vy:     RAW.main.vec.y,
      dir:    RAW.main.inputs.c ? RAW.main.autoDir : RAW.main.dir,
      size:   RAW.main.size,
      alpha:  RAW.main.alpha,
      hp:     RAW.main.hp/RAW.main.maxHp,
      name:   RAW.main.name,
      nameC:  0,
      recoil: RAW.main.recoil,
      canDir: RAW.main.canDir ? RAW.main.canDir : []
    };
    for(let i of RAW.rest){
      let obj = i.data;
      if(obj.getPlace == 0){
        continue;
      }
      if(
        ((obj.x) <= RAW.x) ||
        ((obj.y) <= RAW.y) ||
        ((obj.x) >= (RAW.x+RAW.w)) ||
        ((obj.y) >= (RAW.y+RAW.h))
      ){continue;}
      ///
      // One encoded snapshot per entity per tick, shared by everyone who can see it. Your
      // own bullets are the exception when rules.viewerBullets is set: they carry your
      // colour rather than your team's, so they cannot come out of the shared cache.
      if(obj.BUFF.timestamp !== this.timestamp){
        let raw;
        switch(obj.constructor.name){
          case 'Player':{
            obj.BUFF.len = 37+(obj.name.length*2)+(obj.canDir.length*2);
            raw = {
              construc: 'Players',
              id: obj.id.oId,
              states: [!!obj.hit*1,
                       !!obj.shield*1,
                       0,0,0,0,!!obj.bot*1],
              class:  obj.class,
              color:  obj.dev.color ? obj.dev.color-1 : this.entityColor(obj),
              x:      obj.x,
              y:      obj.y,
              vx:     obj.vec.x,
              vy:     obj.vec.y,
              dir:    obj.dir,
              size:   obj.size,
              alpha:  obj.alpha,
              hp:     Math.max(0,obj.hp/obj.maxHp),
              xp:     obj.xp,
              name:   obj.name,
              nameC:  0,
              recoil: obj.recoil,
              canDir: obj.canDir ? obj.canDir : []
            }
            break;
          };
          case 'Objects':{
            obj.BUFF.len = 19;
            raw = {
              construc: 'Objects',
              id: obj.id.oId,
              states: [!!obj.hit*1,!!obj.extra*1,0,0,0,0,0],
              shape:   obj.type,
              hp:     Math.max(0,obj.hp/obj.maxHp),
              x:      obj.x,
              y:      obj.y,
              size:   obj.size,
              alpha:  obj.alpha,
            };
            break;
          };
          case 'Bullet':{
            if(this.rules.viewerBullets && obj.origine.oId == RAW.main.id.oId){
              break;
            }
            obj.BUFF.len = 21;
            raw = {
              construc: 'Bullets',
              id:     obj.id.oId,
              states: [!!obj.pet*1,0,0,0,0,0,0],
              type:   parseInt(obj.type),
              x:      obj.x,
              y:      obj.y,
              size:   obj.size,
              color:  this.bulletColor(obj),
              alpha:  obj.alpha,
              dir:    obj.showDir
            };
            break;
          };
        }
        if(raw){
          raw.len = obj.BUFF.len;
          obj.BUFF.data = new Int8Array(RT.Controller.encodeInst('Instance',raw));
          obj.BUFF.timestamp = this.timestamp;
        }
      }
      ///
      switch(obj.constructor.name){
        case 'Player':{
          if(!obj.alpha){
            continue;
          }
          if(RAW.main.id.oId == obj.id.oId){
            continue;
          }
          break;
        };
        case 'Bullet':{
          if(this.rules.viewerBullets && obj.origine.oId == RAW.main.id.oId){
            let raw = new Int8Array(RT.Controller.encodeInst('Instance',{
              len: 21,
              construc: 'Bullets',
              id: obj.id.oId,
              states: [!!obj.pet*1,0,0,0,0,0,0],
              type:   parseInt(obj.type),
              x:      obj.x,
              y:      obj.y,
              size:   obj.size,
              color:  this.ownBulletColor(obj,RAW.main),
              alpha:  obj.alpha,
              dir:    obj.showDir
            }));
            buff.len+=raw.length;
            buff.instances.push(raw);
            continue;
          }
          break;
        }
      }
      buff.len+=obj.BUFF.data.length;
      buff.instances.push(obj.BUFF.data);
    };
    return buff;
  }
  /* Colour of another tank, as everyone sees it. Cached, so it cannot depend on the viewer. */
  entityColor(player){
    return 1;
  }
  /* Colour of your own tank on your own screen. */
  mainColor(player){
    return 0;
  }
  bulletColor(bullet){
    return (bullet.type == 3) ? 9 : bullet.team;
  }
  ownBulletColor(bullet,main){
    return (bullet.type == 3) ? 9 : main.dev.color ? main.dev.color-1 : 0;
  }
  leaderColor(player,viewerId){
    return (player.id.oId == viewerId) ? 0 : player.team;
  }
  getUi(id){
    let buff = {
      len:3,
      leader:[],
      map:[],
      mess:[]
    };
    for(let i of this.leader){
      buff.len+= 7+i.name.length*2;
      buff.leader.push({
        xp:i.xp,
        name:i.name,
        nameC: 0,
        team: i.dev.color ? i.dev.color-1 : this.leaderColor(i,id)
      })
    };
    for(let i of this.INSTANCE.players[id].mess){
      buff.len+= 1+i.length*2;
      buff.mess.push(i);
    };
    this.INSTANCE.players[id].mess = [];
    return buff;
  }
  /* Which side a joining player lands on. One-team modes always answer the same thing. */
  assignTeam(){
    return this.rules.teams[0];
  }
  ask(data){
    let name = data.name;
    let pet = (data.pet>-1) ? new RT.Bullet(0,0,0,0,0,0) : null;
    if(pet){
      pet.update = RT.CONFIG.PETS[0].bind(pet);
      pet.type = data.pet;
    }
    ///
    for(let i = 0; i<=this.maxPlayer; i++){
      if(typeof(this.INSTANCE.players[i]) === "undefined"){
        let id = {"GM":this.gm,"sId":this.id,"oId":i};
        let tank = new RT.Player(
            id,
            0,
            0,
            name,
            this.assignTeam(),
            this.XPLVL
          );
        tank.userKey = data.key;
        if(pet){ tank.pet = pet; pet.origine = tank.id; pet.team = tank.team; }
        this.INSTANCE.players[i] = tank;
        this.respawn(i,1);
        console.log('NEW PLAYER gm: '+this.gm+' serve-Id: '+this.id+' player id: '+i);
        return id;
      }
    }
    return;
  }
};

module.exports = Room;
