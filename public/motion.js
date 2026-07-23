/*
  Client-side motion: how a position that arrives ~33 times a second is drawn ~60-144 times
  a second.

  ///////////////////////////////////////////////////////////////////////////////////////
  What this replaces.

  Every moving thing in the client used to be smoothed with one line per axis, run
  once per animation frame:

      this.dx += (this.x-this.dx)*CONST.SMOOTH;      // CONST.SMOOTH is 0.15

  an exponential filter chasing whatever the server last said. Two things are wrong with
  that, and players saw both:

    1. THE STARTUP TRANSIENT. `dx` starts at the spawn position and chases a target that is
       *already moving*. An exponential filter needs roughly 1/0.15 ~ 7 frames to reach a
       useful fraction of the target's speed and ~30 to match it, so a bullet leaves the
       barrel almost stationary and accelerates to full speed over about half a second
       before it looks right. That is the "bullets lag for a bit when you shoot" - the
       bullet is not waiting on the network, it is waiting on this filter to spin up.
       Anything spawned in motion had it; bullets are simply the fastest thing in the game,
       so they showed it worst.

    2. THE STEADY-STATE OFFSET. Once spun up, the filter still trails the true position by a
       fixed fraction of a frame's travel, forever, and the size of that trail is
       proportional to speed. Different entities trailed by different amounts, so nothing
       lined up - and the player's own tank, camera and aim vector each ran a *different*
       filter over the same position, which is what made the view slide off centre while
       moving.

  Both are the same mistake: smoothing *towards* a moving target instead of replaying where
  the target has already been.

  ///////////////////////////////////////////////////////////////////////////////////////
  What it does instead: snapshot interpolation.

  Keep the two most recent server positions with the wall-clock time each arrived, and draw
  the entity where it was one packet-interval ago, linearly between them:

      render(t) = lerp(previous, latest, (t - interval - t_prev) / (t_latest - t_prev))

  Constant velocity comes out exactly right from the first frame after the second snapshot,
  with no spin-up and no speed-dependent offset. The price is one packet interval (~33ms) of
  deliberate, *constant* latency, which is precisely what buys the smoothness: there is
  always a known-good position on both sides of the instant being drawn, so nothing has to
  be guessed.

  `interval` is measured, not assumed. net/gameSocket.js aims at 30ms, but that is a timer,
  not a guarantee, and what matters here is the spacing the packets actually arrive with.

  ///////////////////////////////////////////////////////////////////////////////////////
  Loaded by views/play.ejs before public/client/, and required directly by test/interp.js -
  same typeof(exports) sniff as public/SHARE/SocketSchema.js.
*/
(function(exp){
  // Only the seed for the interval EMA - mark() measures the real spacing within a few
  // packets, so this value decides how long the first moments after connecting look wrong,
  // not the steady state. Keep it equal to config.SEND_MS (33) so that transient is nil.
  const NET_TICK = 33;    // what net/gameSocket.js aims for between GameUpdate packets
  const TELEPORT = 400;   // a jump this big is not motion; see push()
  const MAX_EXTRAP = 2;   // how far past the newest snapshot sample() will coast

  var NET = {
    interval: NET_TICK,   // EMA of the gap between GameUpdate packets, ms
    last:     0,          // when the most recent one arrived
    now: (typeof performance !== 'undefined' && performance.now)
           ? function(){ return performance.now(); }
           : function(){ return Date.now(); },
    /* Called once per GameUpdate, before the packet is applied. */
    mark: function(t){
      if(typeof t === 'undefined'){ t = NET.now(); }
      if(NET.last){
        let dt = t-NET.last;
        // A backgrounded tab or a stall produces gaps of seconds. Letting one into the
        // average would make every entity on screen crawl for the next minute.
        if(dt>4 && dt<250){
          NET.interval += (dt-NET.interval)*0.1;
        }
      }
      NET.last = t;
      return t;
    },
    reset: function(){
      NET.interval = NET_TICK;
      NET.last     = 0;
    }
  };

  /*
    Per-entity position history: the two most recent server positions and when they landed.
    The owner's `x`/`y` stay exactly what they were - the raw server value, assigned straight
    out of the packet - so nothing else has to change. This only supplies `dx`/`dy`, the
    position actually drawn.
  */
  class Interp{
    constructor(x,y){
      this.set(x,y);
    }
    /* Teleport: forget the history. */
    set(x,y){
      this.t0 = 0;  this.x0 = x; this.y0 = y;
      this.t1 = 0;  this.x1 = x; this.y1 = y;
      this.x  = x;  this.y  = y;
    }
    /* One new server position. */
    push(x,y,t){
      // Nothing in the game covers this much ground in one packet - the fastest bullet does
      // about 40 units a tick. A jump this size is a respawn, or an entity id being reused
      // for a different entity (see HANDOFF "Entity storage": slots are recycled, and an
      // index can mean a different entity between frames). Lerping through it draws a streak
      // across the map, so cut instead.
      if(Math.abs(x-this.x1)>TELEPORT || Math.abs(y-this.y1)>TELEPORT){
        this.set(x,y);
        this.t1 = t;
        return this;
      }
      this.t0 = this.t1; this.x0 = this.x1; this.y0 = this.y1;
      this.t1 = t;       this.x1 = x;       this.y1 = y;
      // First ever packet: invent a previous sample one interval back, at the same place, so
      // the entity holds still for one interval instead of jumping.
      if(!this.t0){ this.t0 = t-NET.interval; }
      return this;
    }
    /* Where to draw it now. Writes and returns this.x / this.y. */
    sample(t){
      if(typeof t === 'undefined'){ t = NET.now(); }
      let span = this.t1-this.t0;
      if(span<=0){
        this.x = this.x1;
        this.y = this.y1;
        return this;
      }
      // Clamped at both ends: a dropped packet coasts forward for at most one extra interval
      // instead of extrapolating off the map, and a late frame never rewinds past t0.
      let a = Math.max(0, Math.min(MAX_EXTRAP, (t-NET.interval-this.t0)/span));
      this.x = this.x0+(this.x1-this.x0)*a;
      this.y = this.y0+(this.y1-this.y0)*a;
      return this;
    }
  }
  Interp.TELEPORT   = TELEPORT;
  Interp.MAX_EXTRAP = MAX_EXTRAP;

  /*
    Rescale a per-frame smoothing factor for the frame we actually got.

    `d += (target-d)*k` once per frame is a time constant only if the frame rate is fixed.
    Every k in the client was tuned on a 60Hz monitor; on 144Hz the same code smoothed 2.4x
    faster, and during a hitch it barely moved at all. The equivalent factor for a frame of
    length dtFrames (measured in 60Hz frames) is 1-(1-k)^dtFrames.
  */
  function lerpK(k,dtFrames){
    return (dtFrames === 1) ? k : 1-Math.pow(1-k, dtFrames);
  }

  exp.NET      = NET;
  exp.Interp   = Interp;
  exp.lerpK    = lerpK;
  exp.NET_TICK = NET_TICK;
})(typeof(exports) === 'undefined' ? function(){this['MOTION'] = {}; return this['MOTION']}() : exports);
