/*
  Detector - an invisible entity used as a vision-cone query for the AI.

  Extracted from Alex.js. Cross-entity and Controller references go through the late-bound
  registry (lib/runtime.js) because the dependency graph is circular - see the note there.
*/
const RT         = require('../lib/runtime.js');
const Vec        = require('victor');
const config     = require('../lib/config.js').config;
const cc         = require('../lib/terminal.js');
const CLASS      = require('../public/SHARE/TanksConfig.js').class;
const CLASS_TREE = require('../public/SHARE/TanksConfig.js').tree;
const FRICTION   = require('../lib/constants.js').FRICTION;

class Detector {
  constructor(from,x,y,size,type,self = 0,all = 0){
    this.enabled = 1;
    this.self = self;
    this.from = from;
    this.id = from.id;
    this.x = x;
    this.y = y;
    this.select = 0;
    this.selectAll = {
      Objects:[],
      Bullet:[],
      Player:[]
    };
    this.size = size;
    this.type = type;
    this.dis = size;
    this.all = all;
    this.construc = type.length;
  }
  collision(other, option = {}){
    if(this.all){
      if(this.type.includes(other.constructor.name) && other.alpha && !other.shield){
        if(other.constructor.name == 'Bullet'){
          if(this.id.oId != other.origine.oId){
            this.selectAll[other.constructor.name].push(other);
          }
        } else if(other.constructor.name == 'Player'){
          if(this.id.oId != other.id.oId){
            this.selectAll[other.constructor.name].push(other);
          }
        } else {
          this.selectAll[other.constructor.name].push(other);
        }
      }
    }
    ////
    if(!this.self){
      if(other.constructor.name == this.from.constructor.name && other.id.oId == this.from.id.oId){
        return;
      }
    }
    if(this.type.includes(other.constructor.name) && other.alpha && !other.shield){
      if(other.constructor.name == 'Bullet' && this.id.oId == other.origine.oId){
        return;
      }
      let index = this.type.indexOf(other.constructor.name);
      if(index<this.construc){
        this.dis = option.dis
        this.select = other;
        this.construc = index;
      } else if(index==this.construc){
        if(this.dis>option.dis){
          this.dis = option.dis;
          this.select = other;
        }
      }
    }
  }
  reset(){
    this.dis = this.size;
    this.construc = this.type.length
    if(this.all){
      this.selectAll = {
        Objects:[],
        Bullet:[],
        Player:[]
      };
    }
  }
}

module.exports = Detector;
