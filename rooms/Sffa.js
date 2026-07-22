/*
  Sffa - the free-for-all room: simulation tick, spawning, collision, per-player views.

  Extracted from Alex.js. Entity classes and the Controller singleton are reached through
  the late-bound registry (lib/runtime.js) because the dependency graph is circular.

  NOTE: Sffa and S2team are roughly 90% the same code and have already drifted apart in
  places. Unifying them behind one Room base with a gamemode strategy is the next step, and
  is what would unblock the unimplemented 4team and boss modes.
*/
const RT         = require('../lib/runtime.js');
const Vec        = require('victor');
const config     = require('../lib/config.js').config;
const cc         = require('../lib/terminal.js');
const quadTree   = require('../lib/quadTree.js');
const CLASS      = require('../public/SHARE/TanksConfig.js').class;
const CLASS_TREE = require('../public/SHARE/TanksConfig.js').tree;
const FRICTION   = require('../lib/constants.js').FRICTION;

class Sffa {
  constructor(id){
    let POW = 2.5;
    let MXLVL = 25000;
    this.XPLVL = new Array(30).fill(0).map((x,i)=>{
      if(i == 0){
        return 0;
      }
      let a = 30/Math.pow(MXLVL,1/POW)
      return Math.min(MXLVL,parseInt(Math.pow((i+1)/a,POW)));
    })
    this.gm = "ffa";
    this.id = id;
    this.bufTimer = 0;
    this.BUFFER = {};
    this.INSTANCE = {
      "players":[],
      "objs":[],
      "bullets":[],
      "detectors": []
    };
    this.obj = {
      "sqr":{"0":0,"1":0,"max0":220,"max1":18},
      "tri":{"0":0,"1":0,"max0":80,"max1":12},
      "pnt":{"0":0,"1":0,"max0":25,"max1":15},
      "Bpnt":{'1':0,'max1':3},
      "Bsqr":{'1':0,'max1':2},
      "Btri":{'1':0,'max1':2},
      "bull":{'1':0,'max1':20},
    };
    this.maxPlayer = 24;
    this.print = 1;
    this.leader = [];
    this.map = {
      width: 9020,
      height: 9020
    }
    this.newMap = {
      width: 9020,
      height: 9020
    };
    this.timestamp = 0;
    this.bots = [];
    setTimeout((it)=>{it.Init(); it.update()},100,this);
  }
  Init(){
    for(let i = 0; i<500; i++){
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
    if(RNG>0.98){
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
    if(RNG>0.99){

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
    for(let i = 10; i<20; i++){
      let bot = new RT.Player(
        {"GM":this.gm,"sId":this.id,"oId":i},
        0,
        0,
        RT.CONFIG.BOT_NAMES[parseInt(Math.random()*(RT.CONFIG.BOT_NAMES.length-1))],
        1,
        this.XPLVL
      );
      bot.motion = RT.CONFIG.BOTS[0].bind(bot);
      bot.bot = 1;
      bot.xp = 5000+parseInt(Math.random()*60000)
      this.INSTANCE.players[i] = bot;
      this.bots.push(i);
      this.respawn(i,1,1);
    }
  }
  createBullet(bullet,origine){
    bullet.team = origine.dev.color ? origine.dev.color-1 : 1;
    bullet.map = this.map;
    for(let i = 0; i<=this.INSTANCE.bullets.length; i++){
      if(!this.INSTANCE.bullets[i]){
        bullet.id = {'GM':'ffa','sId':this.id,'oId':i};
        this.INSTANCE.bullets[i] =  bullet;
        break;
      } else {
        if(!isNaN(this.INSTANCE.bullets[i])){
          this.INSTANCE.bullets[i] -= 1;
        }
      }
    }
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
    let botNeeded = Math.max(0,10-playerCount);
    if(botNeeded){
      for(let b of this.bots){
        let bot = this.INSTANCE.players[b];
        if(bot && bot.dead == 1 && botNeeded){
          this.respawn(b,0,1);
          botNeeded --;
        }
      }
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
        if(kind === 'players' && !i.destroy){
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
          if(kind == "objs"){this.INSTANCE[kind][j].delete();}
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
          if(other.destroy>=1){continue;}
          if(obj.id.oId == other.id.oId && obj.constructor.name == other.constructor.name){continue;}
          let dis = Math.sqrt(Math.pow(other.x-obj.x,2)+Math.pow(other.y-obj.y,2));
          if(isNaN(other.getPlace) || isNaN(obj.getPlace)){
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
              let otherCLASS = other.constructor.name;
              let objCLASS = obj.constructor.name;
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
      if(player.bot){
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
  respawn(id, force = 0,bot = 0){
    let tank = this.INSTANCE.players[id];
    if(!tank || (!force && !tank.destroy) || tank.dead>1) return;
    ///
    let mXp = this.XPLVL[this.XPLVL.length-1];
    let x, y, xp = force ? tank.xp : tank.xp<=mXp ? Math.min(tank.xp,parseInt(Math.pow( tank.xp / (mXp/Math.pow( mXp*.6, 1/.9 )),.9))) : mXp*.6;
    while(1){
      x = 200+Math.random()*(this.map.width-400)-this.map.width/2;
      y = 200+Math.random()*(this.map.height-400)-this.map.height/2;
      let dis = Math.sqrt(Math.pow(x,2)+Math.pow(y,2));
      if(dis>1100){
        dis = Math.sqrt(Math.pow(this.map.width/4-x,2)+Math.pow(this.map.height/4-y,2))
        if(dis>800){
          dis = Math.sqrt(Math.pow(-this.map.width/4-x,2)+Math.pow(-this.map.height/4-y,2))
          if(dis>800){
            tank.x = x;
            tank.y = y;
            break;
          }
        }
      }
    }
    let newTank = new RT.Player(tank.id,x,y,tank.name,tank.team,this.XPLVL);
    if(bot){
      newTank.motion = RT.CONFIG.BOTS[0].bind(newTank);
      newTank.bot = 1;
      if(Math.random()<0.1){
        newTank.name = RT.CONFIG.BOT_NAMES[parseInt(Math.random()*(RT.CONFIG.BOT_NAMES.length-1))];
      }
    }
    ///
    newTank.xp = xp;
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
      color:  RAW.main.dev.color ? RAW.main.dev.color-1 : 0,
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
              color:  obj.dev.color ? obj.dev.color-1 : 1,
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
            if(obj.origine.oId != RAW.main.id.oId){
              ////
              obj.BUFF.len = 21;
              raw = {
              construc: 'Bullets',
              id:     obj.id.oId,
              states: [!!obj.pet*1,0,0,0,0,0,0],
              type:   parseInt(obj.type),
              x:      obj.x,
              y:      obj.y,
              size:   obj.size,
              color:  (obj.type == 3) ? 9 : obj.team,
              alpha:  obj.alpha,
              dir:    obj.showDir
            };
            }
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
          if(obj.origine.oId == RAW.main.id.oId){
            let raw = new Int8Array(RT.Controller.encodeInst('Instance',{
              len: 21,
              construc: 'Bullets',
              id: obj.id.oId,
              states: [!!obj.pet*1,0,0,0,0,0,0],
              type:   parseInt(obj.type),
              x:      obj.x,
              y:      obj.y,
              size:   obj.size,
              color:  (obj.type == 3) ? 9 : RAW.main.dev.color ? RAW.main.dev.color-1 :  0,
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
        team: i.dev.color ? i.dev.color-1 : ((i.id.oId == id) ? 0 : i.team)
      })
    };
    for(let i of this.INSTANCE.players[id].mess){
      buff.len+= 1+i.length*2;
      buff.mess.push(i);
    };
    this.INSTANCE.players[id].mess = [];
    return buff;
  }
  ask(data){
    let name = data.name;
    let pet = (data.pet>-1) ? new RT.Bullet(0,0,0,0,0,0) : null;
    if(pet){
      pet.update = RT.CONFIG.PETS[0].bind(pet);
      pet.type = data.pet;
      pet.team = 1;
    }
    ///
    for(let i = 0; i<=this.maxPlayer; i++){
      if(typeof(this.INSTANCE.players[i]) === "undefined"){
        let tank = new RT.Player(
            {"GM":this.gm,"sId":this.id,"oId":i},
            0,
            0,
            name,
            1,
            this.XPLVL
          );
        tank.userKey = data.key;
        if(pet){ tank.pet = pet; pet.origine = tank.id; }
        this.INSTANCE.players[i] = tank;
        this.respawn(i,1);
        console.log('NEW PLAYER gm: '+this.gm+' serve-Id: '+this.id+' player id: '+i);
        return tank.id;
        break;
      }
    }
    return;
  }
};

module.exports = Sffa;
