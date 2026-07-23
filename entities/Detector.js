/*
  Detector - an invisible entity used as a vision-cone query for the AI.

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

class Detector {
  constructor(from,x,y,size,type,self = 0,all = 0){
    this.enabled = 1;
    this.self = self;
    this.from = from;
    this.id = from.id;
    this.x = x;
    this.y = y;
    this.select = 0;
    // Buckets keyed by entity kind; the AI reads them as selectAll[KIND.PLAYER] etc.
    this.selectAll = {
      [KIND.OBJECTS]:[],
      [KIND.BULLET]:[],
      [KIND.PLAYER]:[]
    };
    this.size = size;
    this.type = type;
    this.dis = size;
    this.all = all;
    this.construc = type.length;
  }
  collision(other, option = {}){
    let kind = other.kind;
    if(this.all){
      if(this.type.includes(kind) && other.alpha && !other.shield){
        if(kind == KIND.BULLET){
          if(this.id.oId != other.origine.oId){
            this.selectAll[kind].push(other);
          }
        } else if(kind == KIND.PLAYER){
          if(this.id.oId != other.id.oId){
            this.selectAll[kind].push(other);
          }
        } else {
          this.selectAll[kind].push(other);
        }
      }
    }
    ////
    if(!this.self){
      if(kind == this.from.kind && other.id.oId == this.from.id.oId){
        return;
      }
    }
    if(this.type.includes(kind) && other.alpha && !other.shield){
      if(kind == KIND.BULLET && this.id.oId == other.origine.oId){
        return;
      }
      let index = this.type.indexOf(kind);
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
        [KIND.OBJECTS]:[],
        [KIND.BULLET]:[],
        [KIND.PLAYER]:[]
      };
    }
  }
}

// Type tag for collision / buffer dispatch - see lib/kinds.js.
Detector.prototype.kind = KIND.DETECTOR;

module.exports = Detector;
