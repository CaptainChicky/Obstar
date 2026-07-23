/*
  Objects - the farmable polygons (squares, triangles, pentagons).

  Extracted from the old Alex.js monolith (now server.js + lib/ + rooms/ + entities/).
  Cross-entity and Controller references go through the late-bound registry
  (lib/runtime.js) because the dependency graph is circular - see the note there.
*/
const RT         = require('../lib/runtime.js');
const Vec        = require('victor');
const config     = require('../lib/config.js').config;
const cc         = require('../lib/terminal.js');
const CLASS      = require('../public/SHARE/TanksConfig.js').class;
const CLASS_TREE = require('../public/SHARE/TanksConfig.js').tree;
const FRICTION   = require('../lib/constants.js').FRICTION;
const KIND       = require('../lib/kinds.js');

class Objects {
  constructor(type,pos,id,map){
    this.BUFF = {
      timestamp: -1,
    };
    this.coinReward = parseInt(Math.random()+.02);
    this.type = type;
    this.id = id;
    this.size = 20;
    this.collideId = Math.random();
    this.hp = 20;
    this.damage = 4;
    this.alpha = 1;
    this.hit = 0;
    this.spawnRad = 400;
    this.marge = 200;
    this.weight = 1;
    switch(pos){
      case -1:
        while(1){
          this.x = this.marge+Math.random()*(map.width-this.marge*2)-map.width/2;
          this.y = this.marge+Math.random()*(map.height-this.marge*2)-map.height/2;
          let dis = Math.sqrt(Math.pow(this.x,2)+Math.pow(this.y,2))
          if(dis>1000){
            dis = Math.sqrt(Math.pow(map.width/4-this.x,2)+Math.pow(map.height/4-this.y,2))
            if(dis>700){
              dis = Math.sqrt(Math.pow(-map.width/4-this.x,2)+Math.pow(-map.height/4-this.y,2))
              if(dis>700){
                break;
              }
            }
          }
        }
        this.pos = 0;
        break;
      case 'bull':
        while(1){
          this.x = Math.random()*1400-700
          this.y = Math.random()*1400-700
          const dis = Math.sqrt(Math.pow(this.x,2)+Math.pow(this.y,2))
          if(dis < 700 && dis>650){
            break;
          }
        }
        this.pos = 1;
        break;
      default:
        const dir = Math.random()*Math.PI*2;
        this.x = Math.min(map.width/2-this.marge,
                 Math.max(-map.width/2+this.marge,
                          pos[0]+Math.sin(dir)*(Math.random()*pos[2])));
        this.y = Math.min(map.height/2-this.marge,Math.max(-map.height/2+this.marge,pos[1]+Math.cos(dir)*(Math.random()*pos[2])));
        this.pos = 1;
        break;
    }
    this.maxspeed = 0.30;
    switch(this.type){
      case "sqr": this.size = 20;this.hp = 13;this.prize = 15;break;
      case "tri": this.size = 18;this.hp = 25;this.prize = 50;this.maxspeed=.26;break;
      case "pnt": this.size = 42;this.hp = 190;this.prize = 100+parseInt(Math.random()*100);this.maxspeed= 0.08;this.weight = 4;this.damage=5;break;
      case "Bpnt": this.size = 115;this.hp = 9000;this.prize = 3000;this.maxspeed=0.01;this.weight = 100;break;
      case "Bsqr": this.size = 90;this.hp = 8000;this.prize = 2000;this.maxspeed=0.01;this.weight = 100;break;
      case "Btri": this.size = 72;this.hp = 7000;this.prize = 1000;this.maxspeed=0.01;this.weight = 100;break;
      case "bull": this.size = 12;this.hp = 15; this.prize = 12; this.maxspeed = .42;this.damage = 7;
                   this.DETEC = new RT.Detector(this,this.x,this.y,500,type = [KIND.PLAYER]);break;
    }
    this.coinReward *= parseInt(this.prize/10);
    switch(this.type){
      case 'pnt':
      case 'Bpnt':
      case 'Bsqr':
      case 'Btri':
        this.getPlace = 1;
      break;
    }
    if(this.type === 'bull'){
      if(Math.random()<0.15){
        this.size = 23;
        this.hp = 32;
      }
    }
    if(Math.random()<0.00004){
      this.extra = 1;
      this.hp = 10000;
      this.prize = 50000;
      this.weight = 100;
    }
    this.map = map;
    this.maxHp = this.hp;
    //
    this.rotationDir = Math.sign(Math.random()-0.5);
    this.vec = new Vec(this.maxspeed,0).rotate(Math.random()*Math.PI*2);
    this.destroy = 0;
    this.rx = this.x;
    this.ry = this.y;
    this.rotationVal = 0.002+Math.random()*0.0005;
    this.TOSEND = {
      "public":{}
    }
  }
  delete(){
    RT.Controller.server[this.id.GM][this.id.sId].obj[this.type][this.pos] -= 1;
  }
  collision(other,option = {}){
    const len = (this.vec.length()*this.weight<0.4) ? 2 : .4;
    switch(other.kind){
      case KIND.PLAYER:
        if(other.necro && this.type === 'sqr' && other.droneCount<CLASS[other.class].maxDrone+other.upNb[1]){
          this.destroy = 1;
          return;
        }
        this.vec.add(new Vec(this.x-other.x,this.y-other.y).norm().multiply(new Vec(len,len)));
        this.hp-=other.damage;
        this.hit = 2;
        if(this.hp <= 0){this.destroy = config.DES;other.xp += this.prize;other.coins+=this.coinReward}
        break;
      case KIND.OBJECTS:
        if(other.type === 'bull'){
          this.vec.add(new Vec(this.x-other.x,this.y-other.y).norm().multiply(new Vec(0.1,0.1)));
          return;
        }
        this.vec.add(new Vec(this.x-other.x,this.y-other.y).norm().multiply(new Vec(len,len)));
        break;
      case KIND.BULLET:
        if(other.necro && this.type === 'sqr'){
          const play = RT.Controller.server[other.origine.GM][other.origine.sId].INSTANCE.players[other.origine.oId];
          if(play.droneCount<CLASS[play.class].maxDrone+play.upNb[1]){
            this.destroy = 1;
            return;
          }
        }
        this.hp-= ((option.pene>1) ? option.pene : option.pene/2)*other.damage;
        this.hit = 2;
        if(this.hp <= 0){this.destroy = config.DES;}
        if(this.type[0] === 'B'){
          break;
        }
        this.vec.add(new Vec(this.x-other.x,this.y-other.y).norm().multiply(new Vec(0.4,0.4)));
        break;
    }
  }
  update(){
    this.hit = Math.max(0,this.hit-1);
    if(this.destroy>1){
      this.x+=this.vec.x/this.weight;
      this.y+=this.vec.y/this.weight;
      this.destroy-=1;
      this.alpha = this.destroy/config.DES;
      this.size += 1+this.size*.01;
      return;
    }
    this.vec.rotate(this.rotationVal);
    this.vec.limit(this.maxspeed/2,FRICTION)
    this.x+=this.vec.x/this.weight;
    this.y+=this.vec.y/this.weight;
    if(this.DETEC){
      if(this.DETEC.select){
        if(this.DETEC.select.destroy || this.DETEC.select.god){
          this.DETEC.reset();
        } else {
          const v = new Vec(0.28,0).rotate(Math.atan2(this.DETEC.select.y-this.y,this.DETEC.select.x-this.x))
          this.vec.add(v)
          this.DETEC.enabled = 0;
        }
      } else if(Math.sqrt(Math.pow(this.x-this.rx,2)+Math.pow(this.y-this.ry,2)) > 120){
        const v = new Vec(0.28,0).rotate(Math.atan2(this.ry-this.y,this.rx-this.x))
        this.vec.add(v);
      } else {
        this.DETEC.enabled = 1;
      }
      this.DETEC.x = this.x;
      this.DETEC.y = this.y;
    }

    if(this.x<-this.map.width/2){
      this.x = -this.map.width/2;
      this.vec.x = 0;
    };
    if(this.y<-this.map.height/2){
      this.y = -this.map.height/2;
      this.vec.y = 0;
    };
    if(this.x> this.map.width/2){
      this.x = this.map.width/2;
      this.vec.x = 0;
    };
    if(this.y> this.map.height/2){
      this.y = this.map.height/2;
      this.vec.y =  0;
    };
  }
}

// Type tag for collision / buffer dispatch - see lib/kinds.js.
Objects.prototype.kind = KIND.OBJECTS;

module.exports = Objects;
