/*
  Broad-phase spatial index. Rebuilt from scratch every room tick: insert every live
  entity, then query() with an AABB overlap test to get candidate collision pairs.

  Self-contained - depends on nothing else in the codebase.
*/
class quadTree{
  constructor(x,y,w,h,max){
    this.points = [];
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.divide = 0;
    this.max = max;
  }
  insertToOther(x,y,size,data){
    this.ne.insert(x,y,size,data);
    this.nw.insert(x,y,size,data);
    this.se.insert(x,y,size,data);
    this.sw.insert(x,y,size,data);
  }
  insert(x,y,size,data){
    if(!this.checkIn(x,y)){return;}
    if(this.divide){
      this.ne.insert(x,y,size,data);
      this.nw.insert(x,y,size,data);
      this.se.insert(x,y,size,data);
      this.sw.insert(x,y,size,data);
      return;
    }
    if(this.points.length>=this.max){
      this.ne = new quadTree(this.x+this.w/2,this.y,this.w/2,this.h/2,this.max);
      this.nw = new quadTree(this.x,this.y,this.w/2,this.h/2,this.max);
      this.se = new quadTree(this.x+this.w/2,this.y+this.h/2,this.w/2,this.h/2,this.max);
      this.sw = new quadTree(this.x,this.y+this.h/2,this.w/2,this.h/2,this.max);
      //for(let p of this.points){
      this.ne.insert(x,y,size,data);
      this.nw.insert(x,y,size,data);
      this.se.insert(x,y,size,data);
      this.sw.insert(x,y,size,data);
      //}
      this.divide = 1;
      return;
    }
    this.points.push({'x':x,'y':y,'size':size,'data':data});
  }
  checkIn(x,y){
    if(x<this.x){return 0;}
    if(x>this.x+this.w){return 0;}
    if(y<this.y){return 0;}
    if(y>this.y+this.h){return 0;}
    return 1;
  }
  query(func,data,log = 0){
    if(func({'x':this.x,'y':this.y,'w':this.w,'h':this.h},data)){
      let send = [];
      for(let p of this.points){
        if(func({'x':p.x,'y':p.y,'w':0,'h':0},data)){
          send.push(p);
        }
      }
      if(this.divide){
        Array.prototype.push.apply(send, this.ne.query(func,data));
        Array.prototype.push.apply(send, this.nw.query(func,data));
        Array.prototype.push.apply(send, this.se.query(func,data));
        Array.prototype.push.apply(send, this.sw.query(func,data));
        return send;
      }
      return this.points;
    }
    return [];
  }
}
module.exports = quadTree;
