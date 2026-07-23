/*
  Entity rendering and the world background.

  Both halves are built once per Run() rather than at load, exactly where the monolith built
  them: General.background closes over Run()'s `ctx`, and the three cache builders allocate
  off-screen canvases that have to appear in the same order they always did.
*/
(function(CLIENT){
  var CONST = CLIENT.CONST;
  var CLASS = CLIENT.CLASS;
  var C = CLIENT.C;
  var Global = CLIENT.Global;
  var Game = CLIENT.Game;
  var General = CLIENT.General;
  var Drawings = CLIENT.Drawings;
  ///
  CLIENT.initRender = function(){
    ///
    General['drawTank'] = General['drawTank'] || (() => {
      let can = document.createElement('CANVAS');
      let ctxx = can.getContext('2d');
      let R = CONST.OFFCAN;
      let Coord = {};
      ///
      function setCoord(config){
        let middleX = 0, middleY = 0, canSize = CONST.SIZE/2+CONST.LINEWIDTH;
        let marge = 2;
        ///
        if(config.canons){
          for(let c of config.canons){
            ///
            let len = Math.sqrt(
              Math.pow(c.height,2)+
              Math.pow(c.width/2+c.offx+c.open/2,2)
            )+CONST.LINEWIDTH;
            canSize = Math.max(canSize,len);
            ///
            let cos = Math.cos(c.offdir),sin = Math.sin(c.offdir);
            middleX += cos*Math.max(0,c.height-CONST.SIZE/2)+sin*c.offx;
            middleY += sin*Math.max(0,c.height-CONST.SIZE/2)+cos*c.offx;
          }
          middleX /= config.canons.length*2;
          middleY /= config.canons.length*2;
        }
        if(config.turrets){
          for(let c of config.turrets){
            ///
            let len = Math.sqrt(
              Math.pow(c.height,2)+
              Math.pow(c.width/2+c.offx+c.open/2,2)
            )+CONST.LINEWIDTH;
            canSize = Math.max(canSize,len);
            ///
            let cos = Math.cos(c.offdir),sin = Math.sin(c.offdir);
            middleX += cos*Math.max(0,c.height-CONST.SIZE/2)+sin*c.offx;
            middleY += sin*Math.max(0,c.height-CONST.SIZE/2)+cos*c.offx;
          }
          middleX /= config.canons.length*2;
          middleY /= config.canons.length*2;
        }
        if(!config.canons && !config.turrets){
          middleX = canSize;
          middleY = canSize;
        };
        canSize = canSize*2 + marge*2;
        ///
        return {
          mX:middleX,
          mY:middleY,
          size: canSize,
          marge: marge
        }
      };
      ///
      return (ctx,isOpac,param)=>{
        var tank, coord;
        if(CLASS[param.class]){
          tank = CLASS[param.class];
        } else {
          return;
        }
        if(!Coord[param.class]){
          Coord[param.class] = setCoord(tank);
        }
        coord = Coord[param.class];
        ///
        if(!isOpac){
          let s = coord.size*param.size/CONST.SIZE*R;
          can.width = can.height = s;
          ctx = ctxx;
          ctx.setTransform(R,0,0,R,can.width/2,can.height/2)
        }
        ///
        for(let i in tank.canons){
          Drawings.canons[tank.canons[i].type]( ctx, tank, param, i);
        };
        Drawings.body[tank.body.shape]( ctx, tank, param );
        for(let i in tank.turrets){
          Drawings.turrets[tank.turrets[i].type]( ctx, tank, param, i );
        };
        return {
          can: isOpac ? 0 : can,
          mX:Coord[param.class].mX,
          mY:Coord[param.class].mY,
        }
      };
    })();
    General['drawBullet'] = (()=>{
      function canDraw(param){
        let can = document.createElement('CANVAS');
        let ctx = can.getContext('2d');
        can.width = can.height = (param.size*2+CONST.LINEWIDTH+2)*CONST.OFFCAN;
        ctx.setTransform(CONST.OFFCAN,0,0,CONST.OFFCAN,can.width/2,can.height/2);
        Drawings.bullet[param.type](ctx,param.color,param.size,param.recoil);
      }
      function draw(ctx,param){
        if(param.alpha<1){
          switch(param.type){
            case 0: case 1: case 2: case 3:{
              break;
            }
            default:{
              return canDraw(param);
            }
          }
        }
        Drawings.bullet[param.type](ctx,param);
      }
      ///
      return {
        draw:   draw
      }
    })();
    General['drawPet'] = (()=>{
      function canDraw(param){
        let can = document.createElement('CANVAS');
        let ctx = can.getContext('2d');
        can.width = can.height = (param.size*2+CONST.LINEWIDTH+2)*CONST.OFFCAN;
        ctx.setTransform(CONST.OFFCAN,0,0,CONST.OFFCAN,can.width/2,can.height/2);
        Drawings.pet[param.type]( ctx, param, CONST, C );
        return can;
      }
      function draw(ctx,param){
        if(param.alpha<1){
          switch(param.type){
            //case 0: case 1: case 2: case 3:{
          //    break;
            //}
            default:{
              return canDraw(param);
            }
          }
        }
        Drawings.pet[param.type]( ctx, param, CONST, C );
      }
      ///
      return {
        draw:   draw
      }
    })();
  };
  CLIENT.initBackground = function(){
    var ctx = General['ctx'];
    General['background'] = General['background'] || (()=>{
      return (posx,posy, tileSize) => {
        let h = Game.screen*.5625*Global.RATIO;
        ///
        ctx.fillStyle = C.Grid[0];
        ctx.fillRect(
          -(Game.width/2+posx)*Global.RATIO+Global.canW/2,
          -(Game.height/2+posy)*Global.RATIO+Global.canH/2,
          Game.width*Global.RATIO,
          Game.height*Global.RATIO
        );
        ///
        let ts = tileSize*Global.RATIO;
        ctx.globalAlpha = 0.05;
        ctx.beginPath();
        for(let x = -(posx*Global.RATIO-Global.canW/2)%ts ; x<=Game.screen*Global.RATIO+(posx%ts) ; x+=ts){
          ctx.moveTo(x,0);
          ctx.lineTo(x,h);
        }
        for(let y = -(posy*Global.RATIO-Global.canH/2)%ts; y<=h+(posy%ts) ; y+=ts){
          ctx.moveTo(0,y)
          ctx.lineTo(Game.screen*Global.RATIO,y)
        }
        ctx.lineWidth = 1*Global.RATIO;
        ctx.strokeStyle = 'black';
        ctx.stroke();
        ctx.globalAlpha = 1;
        switch(POST.gm){
          case '2team':{
            ctx.fillStyle = C.red[0];
            ctx.globalAlpha = 0.2;
            ctx.fillRect(
              -(-Game.width/2+posx)*Global.RATIO+Global.canW/2,
              -(Game.height/2+posy)*Global.RATIO+Global.canH/2,
              -600*Global.RATIO,
              Game.height*Global.RATIO
            );
            ctx.fillStyle = C.green[0];
            ctx.fillRect(
              -(Game.width/2+posx)*Global.RATIO+Global.canW/2,
              -(Game.height/2+posy)*Global.RATIO+Global.canH/2,
              600*Global.RATIO,
              Game.height*Global.RATIO
            );
            break;
          }
        }
      };
    })();
  };
})(typeof(exports) === 'undefined'
    ? (window.CLIENT = window.CLIENT || {})
    : (module.exports = global.CLIENT = global.CLIENT || {}));
