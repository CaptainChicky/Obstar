/*
  The shape table: one function per tank body, barrel, bullet and pet. Every entry takes the
  context it should draw into as its first argument, which is why this file needs nothing
  from inside Run().
*/
(function(CLIENT){
  const CONST = CLIENT.CONST;
  const Palette = CLIENT.Palette;
  const Global = CLIENT.Global;
  const roundRect = CLIENT.roundRect;
  const Drawings = {
      canons:[
        (ctx, config, param, i) => {
          const c = config.canons[i], r = param.size/CONST.SIZE;
          if(c.hidden){
            return;
          }
          i = config.turrets ? parseInt(i) + config.turrets.length : i;
          const recoil = param.recoils[i] ? 1-Math.abs(param.recoils[i]) : 1;
          ctx.save();
            ctx.beginPath();
            ctx.rotate(c.offdir+param.dir);
            ctx.moveTo(0,(c.offx-c.width/2)*r);
            ctx.lineTo(0,(c.offx+c.width/2)*r);
            ctx.lineTo((c.height*recoil)*r,(c.offx+c.width/2+c.open/2)*r);
            ctx.lineTo((c.height*recoil)*r,(c.offx-c.width/2-c.open/2)*r);
            ctx.closePath();
            ctx.fillStyle = param.canC[0];
            ctx.strokeStyle = param.canC[1];
            ctx.lineWidth = CONST.LINEWIDTH;
            ctx.lineJoin = 'round';
            ctx.fill();
            ctx.stroke();
          ctx.restore();
        },
        (ctx, config, param, i) => {
          const c = config.canons[i], r = param.size/CONST.SIZE;
          i = config.turrets ? parseInt(i) + config.turrets.length : i;
          const recoil = param.recoils[i] ? 1-Math.abs(param.recoils[i]) : 1;
          ctx.save();
            ctx.beginPath();
            ctx.rotate(c.offdir+param.dir);
            ///
            ctx.moveTo((c.height*recoil-c.openlength)*r,(c.offx-c.width/2)*r);
            ctx.lineTo(0,(c.offx-c.width/2)*r);
            ctx.lineTo(0,(c.offx+c.width/2)*r);
            ctx.lineTo((c.height*recoil-c.openlength)*r,(c.offx+c.width/2)*r);
            ctx.lineTo((c.height*recoil)*r,(c.offx+c.width/2+c.open/2)*r);
            ctx.lineTo((c.height*recoil)*r,(c.offx-c.width/2-c.open/2)*r);
            ctx.lineTo((c.height*recoil-c.openlength)*r,(c.offx-c.width/2)*r);
            ctx.lineTo((c.height*recoil-c.openlength)*r,(c.offx+c.width/2)*r);
            ///
            ctx.closePath();
            ctx.fillStyle = param.canC[0];
            ctx.strokeStyle = param.canC[1];
            ctx.lineWidth = CONST.LINEWIDTH;
            ctx.lineJoin = 'round';
            ctx.fill();
            ctx.stroke();
          ctx.restore();
        },
      ],
      turrets:[
        (ctx, config, param, i) => {
          const c = config.turrets[i], r = param.size/CONST.SIZE;
          const recoil = param.recoils[i] ? 1-Math.abs(param.recoils[i]) : 1;
          ctx.save();
            ctx.beginPath();
            ctx.rotate(param.canDir[i] ? param.canDir[i] : 0);
            ctx.moveTo(0,(c.offx-c.width/2)*r);
            ctx.lineTo(0,(c.offx+c.width/2)*r);
            ctx.lineTo((c.height*recoil)*r,(c.offx+c.width/2+c.open/2)*r);
            ctx.lineTo((c.height*recoil)*r,(c.offx-c.width/2-c.open/2)*r);
            ctx.closePath();
            ctx.fillStyle = param.canC[0];
            ctx.strokeStyle = param.canC[1];
            ctx.lineWidth = CONST.LINEWIDTH;
            ctx.lineJoin = 'round';
            ctx.fill();
            ctx.stroke();
            ///
            ctx.beginPath()
            ctx.arc(0,0,c.rad*r+CONST.LINEWIDTH/2,0,Math.PI*2);
            ctx.closePath();
            ctx.fillStyle = param.canC[1];
            ctx.fill();
            ctx.beginPath()
            ctx.arc(0,0,c.rad*r-CONST.LINEWIDTH/2,0,Math.PI*2);
            ctx.closePath();
            ctx.fillStyle = param.canC[0];
            ctx.fill();
          ctx.restore();
        },
      ],
      body:[
        (ctx, config, param) => {
          ctx.beginPath();
          ctx.arc(0,0,param.size+CONST.LINEWIDTH/2,0,Math.PI*2,0);
          ctx.closePath();
          ctx.fillStyle = param.tankC[1];
          ctx.fill();
          ctx.closePath();
          ///
          ctx.beginPath();
          ctx.arc(0,0,param.size-CONST.LINEWIDTH/2,0,Math.PI*2,0);
          ctx.closePath();
          ctx.fillStyle = param.tankC[0];
          ctx.fill();
          ctx.closePath();
          ///
        },
        (ctx, config, param) => {
          ctx.save();
            ctx.rotate(param.dir);
            ctx.beginPath();
            roundRect(ctx,-param.size*config.body.width,
                          -param.size*config.body.height,
                           param.size*2*config.body.width,
                           param.size*2*config.body.height,1);
            ctx.closePath();
            ctx.strokeStyle = param.tankC[1];
            ctx.fillStyle = param.tankC[0];
            ctx.lineWidth = CONST.LINEWIDTH;
            ctx.fill();ctx.stroke();
          ctx.restore();
        },
        (ctx, config, param) => {
          const a = Math.PI*2/5, size = param.size*1.236;
          ctx.save();
            ctx.rotate(param.dir+a/2);
            ctx.beginPath();
              ctx.moveTo(Math.cos(a)*size,Math.sin(a)*size);
              ctx.lineTo(Math.cos(a*1)*size,Math.sin(a*1)*size);
              ctx.lineTo(Math.cos(a*2)*size,Math.sin(a*2)*size);
              ctx.lineTo(Math.cos(a*3)*size,Math.sin(a*3)*size);
              ctx.lineTo(Math.cos(a*4)*size,Math.sin(a*4)*size);
              ctx.lineTo(Math.cos(a*5)*size,Math.sin(a*5)*size);
            ctx.closePath();
            ctx.strokeStyle = param.tankC[1];
            ctx.fillStyle = param.tankC[0];
            ctx.lineWidth = CONST.LINEWIDTH;
            ctx.fill();ctx.stroke();
          ctx.restore();
        },
      ],
      bullet:[
        (ctx, param) => {
          ctx.beginPath();
          ctx.arc(0,0,param.size,0,Math.PI*2,0);
          ctx.fillStyle = Palette[param.color][1];
          ctx.fill();
          ctx.closePath();
          ///
          ctx.beginPath();
          ctx.arc(0,0,param.size-CONST.LINEWIDTH,0,Math.PI*2,0);
          ctx.fillStyle = Palette[param.color][0];
          ctx.fill();
          ctx.closePath();
        },
        (ctx, param) => {
          const $1=param.size*1.7;
          ctx.rotate(param.dir);
          ctx.beginPath();
          ctx.moveTo($1,0);
          ctx.lineTo(-0.6*$1,0.8660254037844387*$1)
          ctx.lineTo(-0.6*$1,-0.8660254037844387*$1)
          ctx.closePath();
          ctx.fillStyle = Palette[param.color][0];
          ctx.fill();
          ctx.lineWidth = CONST.LINEWIDTH;
          ctx.lineJoin = 'round';
          ctx.strokeStyle = Palette[param.color][1];
          ctx.stroke();
        },
        (ctx, param) => {
          const $1=param.size*1.8;
          const mini = $1*.38;
          ///
          ctx.rotate(param.dir);
          ctx.beginPath();
          ctx.moveTo($1,0);
          ctx.lineTo(0.5*mini,0.8660254037844387*mini);
          ctx.lineTo(-0.5*$1,0.8660254037844387*$1);
          ctx.lineTo(-1*mini ,0);
          ctx.lineTo(-0.5*$1,-0.8660254037844387*$1);
          ctx.lineTo(0.5*mini ,-0.8660254037844387*mini);
          ctx.closePath();
          ctx.fillStyle = Palette[param.color][0];
          ctx.fill();
          ctx.lineWidth = CONST.LINEWIDTH;
          ctx.lineJoin = 'round';
          ctx.strokeStyle = Palette[param.color][1];
          ctx.stroke();
        },
        (ctx, param) => {
          ctx.blendMode = 'source-over';
          ctx.rotate(param.dir);
          ctx.beginPath();
          ctx.rect(-param.size,-param.size,param.size*2,param.size*2)
          ctx.closePath();
          ctx.fillStyle = Palette[param.color][0];
          ctx.fill();
          ctx.lineWidth = CONST.LINEWIDTH;
          ctx.lineJoin = 'round';
          ctx.strokeStyle = Palette[param.color][1];
          ctx.stroke();
        }
      ],
      obj:{
        tri: (ctx,$0,$1,$2) => {
          ctx.rotate($2);
          $1 /= 18;
          ctx.beginPath();
            ctx.moveTo(32*$1,0)
            ctx.lineTo(-16*$1,27.7*$1)
            ctx.lineTo(-16*$1,-27.7*$1)
          ctx.closePath();
          ctx.fillStyle = $0[0];
          ctx.strokeStyle = $0[1];
          ctx.lineWidth = CONST.LINEWIDTH;
          ctx.lineJoin = 'round';
          ctx.fill();
          ctx.stroke();
        },
        sqr: (ctx,$0,$1,$2) => {
          ctx.rotate($2)
          $1 /=20;
          ctx.beginPath();
          ctx.rect(-20*$1,-20*$1,40*$1,40*$1);
          ctx.closePath();
          ctx.fillStyle = $0[0];
          ctx.strokeStyle = $0[1];
          ctx.lineWidth = CONST.LINEWIDTH;
          ctx.lineJoin = 'round';
          ctx.fill()
          ctx.stroke();
        },
        pnt: (ctx,$0,$1,$2) => {
          ctx.rotate($2)
          $1 /=42;
          ctx.beginPath();
            ctx.moveTo(52*$1,0);
            ctx.lineTo(16.1*$1,49.5*$1);
            ctx.lineTo(-42.1*$1,30.6*$1);
            ctx.lineTo(-42.1*$1,-30.6*$1);
            ctx.lineTo(16.1*$1,-49.5*$1);
          ctx.closePath();
          ctx.fillStyle = $0[0];
          ctx.strokeStyle = $0[1];
          ctx.lineWidth = CONST.LINEWIDTH;
          ctx.lineJoin = 'round';
          ctx.fill()
          ctx.stroke();
        },
        alphaPnt: (ctx,$0,$1,$2) => {
          ctx.rotate($2)
          $1 /=150;
          ctx.beginPath();
            ctx.moveTo(185.7*$1,0);
            ctx.lineTo(57.5*$1,176.8*$1);
            ctx.lineTo(-150.4*$1,109.3*$1);
            ctx.lineTo(-150.4*$1,-109.3*$1);
            ctx.lineTo(57.1*$1,-176.8*$1);
          ctx.closePath();
          ctx.fillStyle = $0[0];
          ctx.strokeStyle = $0[1];
          ctx.lineWidth = CONST.LINEWIDTH;
          ctx.lineJoin = 'round';
          ctx.fill();
          ctx.stroke();
        },
        alphaSqr: (ctx,$0,$1,$2) => {
          ctx.rotate($2);
          $1 /=90;
          ctx.beginPath();
            ctx.rect(-90*$1,-90*$1,180*$1,180*$1);
          ctx.closePath();
          ctx.fillStyle = $0[0];
          ctx.strokeStyle = $0[1];
          ctx.lineWidth = CONST.LINEWIDTH;
          ctx.lineJoin = 'round';
          ctx.fill();
          ctx.stroke();
        },
        alphaTri: (ctx,$0,$1,$2) => {
          ctx.rotate($2);
          $1 /=72;
          ctx.beginPath()
            ctx.moveTo(138*$1,0)
            ctx.lineTo(-69*$1,119.5*$1)
            ctx.lineTo(-69*$1,-119.5*$1)
          ctx.closePath();
          ctx.fillStyle = $0[0];
          ctx.strokeStyle = $0[1];
          ctx.lineWidth = CONST.LINEWIDTH;
          ctx.lineJoin = 'round';
          ctx.fill();
          ctx.stroke();
        }
      },
      pet:PetsConfig.pets
  };
  ///
  CLIENT.Drawings = Drawings;
})(typeof(exports) === 'undefined'
    ? (window.CLIENT = window.CLIENT || {})
    : (module.exports = global.CLIENT = global.CLIENT || {}));
