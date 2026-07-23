/*
  Geometry helpers and the General namespace every later file hangs its pieces off.
*/
(function(CLIENT){
  var CONST = CLIENT.CONST;
  var Global = CLIENT.Global;
  var Game = CLIENT.Game;
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  function roundedPoly(ctx, points, radius) {
    var i, x, y, len, p1, p2, p3, v1, v2, sinA, sinA90, radDirection, drawDirection, angle, halfAngle, cRadius, lenOut;
    var asVec = function(p, pp, v) {
      v.x = pp.x - p.x;
      v.y = pp.y - p.y;
      v.len = Math.sqrt(v.x * v.x + v.y * v.y);
      v.nx = v.x / v.len;
      v.ny = v.y / v.len;
      v.ang = Math.atan2(v.ny, v.nx);
    }
    v1 = {};
    v2 = {};
    len = points.length;
    p1 = points[len - 1];
    for (i = 0; i < len; i++) {
      p2 = points[(i) % len];
      p3 = points[(i + 1) % len];
      asVec(p2, p1, v1);
      asVec(p2, p3, v2);
      sinA = v1.nx * v2.ny - v1.ny * v2.nx;
      sinA90 = v1.nx * v2.nx - v1.ny * -v2.ny;
      angle = Math.asin(sinA);
      radDirection = 1;
      drawDirection = false;
      if (sinA90 < 0) {
        if (angle < 0) {
          angle = Math.PI + angle;
        } else {
          angle = Math.PI - angle;
          radDirection = -1;
          drawDirection = true;
        }
      } else {
        if (angle > 0) {
          radDirection = -1;
          drawDirection = true;
        }
      }
      halfAngle = angle / 2;
      lenOut = Math.abs(Math.cos(halfAngle) * radius / Math.sin(halfAngle));
      if (lenOut > Math.min(v1.len / 2, v2.len / 2)) {
        lenOut = Math.min(v1.len / 2, v2.len / 2);
        cRadius = Math.abs(lenOut * Math.sin(halfAngle) / Math.cos(halfAngle));
      } else {
        cRadius = radius;
      }
      x = p2.x + v2.nx * lenOut;
      y = p2.y + v2.ny * lenOut;
      x += -v2.ny * cRadius * radDirection;
      y += v2.nx * cRadius * radDirection;
      ctx.arc(x, y, cRadius, v1.ang + Math.PI / 2 * radDirection, v2.ang - Math.PI / 2 * radDirection, drawDirection);
      p1 = p2;
      p2 = p3;
    }
    ctx.closePath();
  }
  function roundRect(ctx, x, y, width, height, radius) {
    if (typeof stroke === 'undefined') {
      stroke = true;
    }
    if (typeof radius === 'undefined') {
      radius = 0;
    }
    if (typeof radius === 'number') {
      radius = {tl: radius, tr: radius, br: radius, bl: radius};
    } else {
      var defaultRadius = {tl: 0, tr: 0, br: 0, bl: 0};
      for (var side in defaultRadius) {
        radius[side] = radius[side] || defaultRadius[side];
      }
    }
    ctx.moveTo(x + radius.tl, y);
    ctx.lineTo(x + width - radius.tr, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
    ctx.lineTo(x + width, y + height - radius.br);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
    ctx.lineTo(x + radius.bl, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bl);
    ctx.lineTo(x, y + radius.tl);
    ctx.quadraticCurveTo(x, y, x + radius.tl, y);
  }
  ///
  var General = {};
  General['updateRatio'] = ()=>{
      Global.RATIO = Math.max(Global.canW/Game.screen,
                        Global.canH/(Game.screen*.5625))
      Global.UIRATIO = Math.max(Global.canW/1920,
                        Global.canH/(1920*.5625))//*(CONST.RESOLUTION);
  }
  General['ease-in-out'] = function(t,e = 5) {return t<=.5 ? Math.pow(2*t,e)/2 : 1-Math.pow(2*(1-t),e)/2}
  /*
    Rescale a per-frame smoothing factor for the frame we actually got.

    `d += (target-d)*k` once per frame is a time constant only if the frame rate is fixed.
    Every k in this file was tuned on a 60Hz monitor; on 144Hz the same code smoothed 2.4x
    faster, and during a hitch it barely moved at all. The equivalent factor for a frame of
    length dt is 1-(1-k)^(dt/16.667), which is what this returns.
  */
  General['lerpK'] = function(k){
    return MOTION.lerpK(k, Global.dtFrames);
  };
  General['isMouse'] = (x,y,w,h,r = 1)=>{
    let mouse_x = Global.mouse_x/r,mouse_y = Global.mouse_y/r;
    return (mouse_x>=x) && (mouse_y>=y) && (mouse_x<=x+w) && (mouse_y<=y+h)
  };
  General['isMouseCirc'] = (x,y,r)=>{return (Math.sqrt(Math.pow(Global.mouse_x-x,2)+Math.pow(Global.mouse_y-y,2)) <= r)};
  General['color'] = {
    shade: (color, percent) => {
          var R = parseInt(parseInt(color.substring(1,3),16)*percent);
          var G = parseInt(parseInt(color.substring(3,5),16)*percent);
          var B = parseInt(parseInt(color.substring(5,7),16)*percent);
          R = (R<255)?R:255;
          G = (G<255)?G:255;
          B = (B<255)?B:255;
          return "#" + ((1 << 24) + (R << 16) + (G << 8) + B).toString(16).slice(1);
        }
  }
  /*
    Motion primitives live in public/motion.js so they can be tested outside a browser
    (test/interp.js requires it directly). Read the block comment at the top of that file
    before touching anything that positions an entity - it explains why positions are no
    longer smoothed with `d += (x-d)*CONST.SMOOTH`, which is the bug behind both "bullets
    lag for a bit when you shoot" and "the camera drifts off centre when you move".

    views/play.ejs loads it before this file.
  */
  const NET    = MOTION.NET;
  const Interp = MOTION.Interp;
  ///
  CLIENT.sleep = sleep;
  CLIENT.roundedPoly = roundedPoly;
  CLIENT.roundRect = roundRect;
  CLIENT.General = General;
  CLIENT.NET = NET;
  CLIENT.Interp = Interp;
})(typeof(exports) === 'undefined'
    ? (window.CLIENT = window.CLIENT || {})
    : (module.exports = global.CLIENT = global.CLIENT || {}));
