/*
  The smallest DOM public/client/ will boot against.

  The client is 3200 lines of canvas 2D and had never been executed by anything but a
  browser, which is why "the game has never been opened since the refactor" sat at the top of
  HANDOFF's not-verified list for so long: no test could reach it. It does not actually need
  a DOM, though - it needs about sixty methods that return plausible nothings. This is them.

  What the stub deliberately does NOT do is pretend to render. Nothing here checks a pixel;
  the 2D context is a Proxy that answers every unknown property with a no-op function. The
  point is to run the code paths - the render loop, the packet handler, every entity's
  update() and draw() - so that a ReferenceError, a call on undefined, or a NaN reaching the
  transform is caught here instead of by a player.

  Used by test/client.js. Kept separate because the stub is uninteresting and the assertions
  are not.
*/
const fs   = require('fs');
const vm   = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* Every 2D context call is a no-op; the few with return values are named. Recorded
   transforms are exposed so a test can assert that nothing non-finite reached the canvas. */
function makeCtx(record){
  const real = {
    measureText:          function(){ return {width: 10}; },
    createLinearGradient: function(){ return {addColorStop: function(){}}; },
    createRadialGradient: function(){ return {addColorStop: function(){}}; },
    createPattern:        function(){ return null; },
    getImageData:         function(){ return {data: new Uint8ClampedArray(4)}; },
    setTransform: function(a,b,c,d,e,f){ record.transform(a,b,c,d,e,f); },
    translate:    function(x,y){ record.translate(x,y); },
    drawImage:    function(){ record.draws++; }
  };
  return new Proxy(real, {
    get: function(t,k){
      if(k in t){ return t[k]; }
      return function(){ return undefined; };
    },
    set: function(t,k,v){ t[k] = v; return true; }
  });
}

function makeElement(record, tag){
  return {
    tagName: String(tag).toUpperCase(),
    style: {}, dataset: {}, children: [],
    width: 1920, height: 1080,
    innerHTML: '', textContent: '', value: '',
    scrollTop: 0, clientHeight: 0, scrollHeight: 0,
    classList: {add(){}, remove(){}, toggle(){}, contains(){ return false; }},
    getContext:            function(){ return makeCtx(record); },
    appendChild:           function(c){ this.children.push(c); return c; },
    removeChild:           function(){},
    addEventListener:      function(){},
    removeEventListener:   function(){},
    getBoundingClientRect: function(){ return {left:0, top:0, width:1920, height:1080}; },
    setAttribute: function(){}, getAttribute: function(){ return null; },
    scrollTo: function(){}, focus: function(){}, blur: function(){}
  };
}

/*
  Boot the client. Returns handles for driving it: `frame()` runs one animation frame,
  `deliver(bytes)` hands the socket a packet, `record` accumulates what reached the canvas.
*/
function boot(POST){
  const record = {
    draws: 0,
    badTransform: 0,
    badTranslate: 0,
    lastCamera: null,
    transform: function(a,b,c,d,e,f){
      if(![a,b,c,d,e,f].every(Number.isFinite)){ this.badTransform++; }
      else { this.lastCamera = {sx: e, sy: f, scale: a}; }
    },
    translate: function(x,y){
      if(!Number.isFinite(x) || !Number.isFinite(y)){ this.badTranslate++; }
    }
  };

  let rafQueue = [];
  let clock = {at: 1000};

  const document = {
    createElement:        function(tag){ return makeElement(record, tag); },
    createTextNode:       function(t){ return {nodeValue: t}; },
    getElementById:       function(){ return makeElement(record, 'div'); },
    getElementsByTagName: function(){ return [makeElement(record, 'div')]; },
    getElementsByClassName: function(){ return []; },
    querySelector:        function(){ return makeElement(record, 'div'); },
    querySelectorAll:     function(){ return []; },
    addEventListener:     function(){},
    body:                 makeElement(record, 'body'),
    documentElement:      makeElement(record, 'html')
  };

  const window = {
    document: document,
    innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1,
    addEventListener: function(){},
    requestAnimationFrame: function(fn){ rafQueue.push(fn); return rafQueue.length; },
    location: {protocol: 'http:', host: 'localhost:80', hostname: 'localhost'},
    navigator: {userAgent: 'node'}
  };
  window.window = window;

  let socket = null;
  const sandbox = {
    window: window, document: document, console: console,
    Math, Date, JSON, Object, Array, String, Number, Boolean, Promise, Set, Map, Error, RegExp,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
    Uint8Array, Uint8ClampedArray, Float32Array, DataView, ArrayBuffer, Buffer,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: function(){ return 0; }, clearInterval: function(){},
    requestAnimationFrame: window.requestAnimationFrame,
    // The client reads performance.now() for frame and packet timing. Driving it from a
    // counter makes the render loop deterministic instead of a race with the test.
    performance: {now: function(){ return clock.at; }},
    WebSocket: function(){
      socket = {send: function(){}, close: function(){}, addEventListener: function(){}};
      return socket;
    },
    POST: POST,
    navigator: window.navigator,
    location: window.location
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);

  function load(rel){
    vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, {filename: rel});
  }

  load('public/SHARE/ws_link.js');
  // In a browser `window` IS the global object, so `window.WS_LINK = ...` publishes a global.
  // A vm context's `window` is an ordinary object, so republish it by hand.
  sandbox.WS_LINK = window.WS_LINK;
  load('public/SHARE/TanksConfig.js');
  load('public/SHARE/PetsConfig.js');
  load('public/SHARE/SocketSchema.js');
  load('public/motion.js');
  // The client, in the same order views/play.ejs lists it. Keep the two in step.
  for(const f of ['runtime','config','util','drawings','entities','render','ui','game','overlay','boot']){
    load('public/client/' + f + '.js');
  }

  window.onload();                       // preRun(): canvas, socket, first Loop()
  if(socket && socket.onopen){ socket.onopen(); }

  return {
    record:  record,
    sandbox: sandbox,
    socket:  function(){ return socket; },
    /* Advance the clock and run one animation frame. */
    frame: function(ms){
      clock.at += (ms === undefined ? 1000/60 : ms);
      if(!rafQueue.length){ return false; }
      rafQueue.shift()(clock.at);
      return true;
    },
    advance: function(ms){ clock.at += ms; },
    at:      function(){ return clock.at; },
    pending: function(){ return rafQueue.length; },
    /*
      Hand the socket a packet. preRun() sets binaryType 'arraybuffer', so the client's
      decoder expects an ArrayBuffer, not a Buffer or a typed array - and `socket.onmessage`
      is read fresh each time because Run() replaces preRun's handler with its own once the
      first GameUpdate has arrived.
    */
    deliver: function(bytes){
      if(!socket || !socket.onmessage){ return false; }
      let view = ArrayBuffer.isView(bytes) ? bytes : new Uint8Array(bytes);
      socket.onmessage({
        data: view.buffer.slice(view.byteOffset, view.byteOffset+view.byteLength)
      });
      return true;
    },
    /*
      The client boots into a connecting screen and only switches to the game loop on the
      frame after the first GameUpdate. Drive it across that handover and hand back the test
      hook Run() installs.
    */
    start: function(firstPacket){
      for(let i = 0; i < 10 && !sandbox.window.__test; i++){
        this.deliver(firstPacket);
        this.frame();
      }
      return sandbox.window.__test;
    }
  };
}

module.exports = boot;
