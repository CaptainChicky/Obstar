/*
  The client, actually running.

  Every other suite here stops at the socket. This one boots public/client/ against the
  stub DOM in test/clientDom.js, hands it real GameUpdate packets encoded from a real room,
  and runs its render loop - so for the first time in this repo the drawing code is executed
  by something other than a person with a browser open.

  It exists because the two bugs a player reported - bullets that crawl for half a second
  after you fire, and a camera that slides off the tank while you move - are both purely
  client-side, and both were invisible to a suite that only ever looked at bytes. What is
  asserted here is what those bugs looked like:

    - a bullet is drawn moving at its real speed as soon as it can be, not accelerating up
      to it (public/motion.js, and test/interp.js for the arithmetic in isolation)
    - the camera is exactly on the player's tank on every frame, at every speed

  plus the things that must simply not happen at all: nothing non-finite reaching a canvas
  transform, and no throw from any entity's update() or draw().

    node test/client.js
*/
const path  = require('path');
const ROOT  = path.join(__dirname, '..');
const boot  = require('./clientDom.js');
const PROTO = require(path.join(ROOT, 'public', 'SHARE', 'SocketSchema.js'));

let passed = 0, failed = 0;
function check(name, ok, detail){
  if(ok){ passed++; console.log('  ok   ' + name); }
  else  { failed++; console.log('  FAIL ' + name + (detail !== undefined ? '  (' + detail + ')' : '')); }
}
function near(a,b,tol){ return Math.abs(a-b) <= tol; }

const TICK  = 30;        // ms between packets, matching net/gameSocket.js
const FPP   = 2;         // render frames per packet...
const FRAME = TICK/FPP;  // ...so the frame clock and the packet clock advance together.
                         // The stub advances its clock inside frame(); delivering a packet
                         // does not advance it, so packet spacing is FPP*FRAME exactly.

/*
  A GameUpdate carrying one player and, optionally, one bullet at positions we choose, so the
  test can say exactly where things should be drawn. Assembled the same way rooms/Room.js
  assembles one: entity records are encoded individually into `instances` (that is the
  per-tick cache the room keeps on each entity) and the message encoder splices them in.
*/
function packet(t, user, bullet, other){
  const buff = {
    head: {timestamp: t, width: 8000, height: 8000, screen: 1920, xp: 500,
           level: 5, still: 0, cLvl: 0},
    main: {
      states: [0,0,0,0,0,0], class: 'Basic', color: 0,
      x: user.x, y: user.y, vx: user.vx||0, vy: user.vy||0, dir: 0,
      size: 25, alpha: 1, hp: 1, name: 'tester', nameC: 0,
      recoil: new Array(15).fill(0), canDir: [0]
    },
    instances: []
  };
  if(bullet){
    buff.instances.push(new Int8Array(PROTO.encode('Instance', {
      construc: 'Bullets', id: 7,
      states: [0,0,0,0,0,0,0], type: 0, color: 0,
      x: bullet.x, y: bullet.y, size: 10, alpha: 1, dir: 0
    })));
  }
  if(other){
    buff.instances.push(new Int8Array(PROTO.encode('Instance', {
      construc: 'Players', id: 3,
      states: [0,0,0,0,0,0,1], class: other.class || 'Sniper', color: 1,
      x: other.x, y: other.y, vx: 0, vy: 0, dir: 0.5,
      size: 30, alpha: 1, hp: 0.5, xp: 4000, name: other.name || 'rival', nameC: 0,
      recoil: new Array(15).fill(0), canDir: [0]
    })));
  }
  return PROTO.encode('GameUpdate', buff);
}

console.log('obstar client tests\n');

console.log('boot:');
let app;
{
  app = boot({key: '0'.repeat(25), gm: 'ffa', name: 'tester', pet: -1, ws: ''});
  check('the client boots and starts a render loop', app.pending() > 0, app.pending());
  check('it opened a socket', !!app.socket());
  check('and installed a packet handler', typeof app.socket().onmessage === 'function');
  for(let i = 0; i < 10; i++){ app.frame(); }
  check('it renders frames before any packet arrives', app.record.badTransform === 0);
}

console.log('\nreal packets from a real room:');
{
  // Boot the actual server-side simulation and pipe its per-player view into the client.
  require(path.join(ROOT, 'lib', 'boot.js'))();
  const RT = require(path.join(ROOT, 'lib', 'runtime.js'));
  const room = RT.Controller.newServer('ffa');
  room.ask({name: 'tester', key: '0'.repeat(25), pet: -1, gm: 'ffa'});
  room.Init();                    // normally on a timer; run it now so the world is full
  for(let i = 0; i < 20; i++){ room.step(); }

  app.start(PROTO.encode('GameUpdate', room.getBuffer(0)));

  let fed = 0, err = null;
  for(let p = 0; p < 30 && !err; p++){
    room.step();
    const buff = room.getBuffer(0);
    if(!buff){ continue; }
    try {
      app.deliver(PROTO.encode('GameUpdate', buff));
      fed++;
      for(let f = 0; f < FPP; f++){ app.frame(FRAME); }
    } catch(e){ err = e.message + ' | ' + e.stack.split('\n')[1]; }
  }
  check('a room\'s own GameUpdates decode and render', !err, err);
  check('fed a meaningful number of packets', fed > 15, fed);
  check('something was actually drawn', app.record.draws > 0, app.record.draws);
  check('no non-finite value reached a canvas transform',
        app.record.badTransform === 0 && app.record.badTranslate === 0,
        app.record.badTransform + ' transforms, ' + app.record.badTranslate + ' translates');
}

console.log('\nthe camera stays on the tank:');
{
  /*
    THE BUG. The camera used to run its own exponential smoother at CONST.SMOOTH/1.6 while
    the tank was drawn with CONST.SMOOTH plus a velocity lead plus the input prediction -
    three filters chasing one position. The gap between them grew with speed, which is
    exactly "the game goes off centre when moving".

    Camera and tank are read straight out of the client here: User.gx/gy is what Draw()
    frames the world with, and User.dx+predic is where draw() puts the tank.
  */
  const a = boot({key: '0'.repeat(25), gm: 'ffa', name: 'tester', pet: -1, ws: ''});
  const hook = a.start(packet(1, {x: 0, y: 0}));
  check('the client hands over from the connecting screen to the game loop', !!hook);
  const User = hook.User;

  let worst = 0, samples = 0;
  let x = 0;
  for(let p = 0; p < 40; p++){
    x += 40;                                   // a fast tank: 40 units per packet
    a.deliver(packet(p+1, {x: x, y: 0, vx: 40, vy: 0}));
    for(let f = 0; f < FPP; f++){
      a.frame(FRAME);
      if(p < 3){ continue; }                   // let the first two snapshots land
      const cam  = {x: User.gx, y: User.gy};
      const tank = {x: User.dx+User.predic.x, y: User.dy+User.predic.y};
      worst = Math.max(worst, Math.abs(cam.x-tank.x), Math.abs(cam.y-tank.y));
      samples++;
    }
  }
  check('sampled the moving tank', samples > 50, samples);
  check('the camera sits exactly on the tank, at speed', worst === 0,
        worst.toFixed(4) + ' units off');

  // And the aim vector, which used to subtract guesses at that same drift.
  check('aim is measured from the centre of the screen', (function(){
    const G = hook.Global;
    G.mouse_x = G.winW/2;                      // cursor dead centre-right
    G.mouse_y = G.winH/2;
    a.frame(FRAME);
    return near(User.dir, 0, 1e-9);
  })(), User.dir);
}

console.log('\na bullet moves at its real speed from the start:');
{
  /*
    THE BUG a player reported. With the old smoother a bullet was drawn accelerating from a
    standstill over roughly half a second before it reached the speed the server had already
    given it. Here the bullet's drawn position is read frame by frame and compared against
    the speed the packets describe.
  */
  const a = boot({key: '0'.repeat(25), gm: 'ffa', name: 'tester', pet: -1, ws: ''});
  const Instances = a.start(packet(1, {x: 0, y: 0})).Instances;

  const SPEED = 36;                            // units per packet - a fast bullet
  let bx = 0, drawn = [];
  for(let p = 0; p < 14; p++){
    a.deliver(packet(p+1, {x: 0, y: 0}, {x: bx, y: 0}));
    for(let f = 0; f < FPP; f++){
      a.frame(FRAME);
      const b = Instances.Bullets[7];
      if(b){ drawn.push({p: p, x: b.dx}); }
    }
    bx += SPEED;
  }
  check('the bullet exists on the client', drawn.length > 0, drawn.length + ' samples');

  const perFrame = SPEED/FPP;
  function speedDuring(p){
    const f = drawn.filter((d)=>d.p === p);
    return f.length > 1 ? (f[f.length-1].x-f[0].x)/(f.length-1) : 0;
  }
  // Packet 0 is the spawn - one snapshot, nothing to interpolate between, so it holds still
  // for one interval. From packet 2 on it must be at full speed and stay there.
  check('drawn at full speed from the second interval on',
        near(speedDuring(2), perFrame, perFrame*0.05),
        speedDuring(2).toFixed(2) + ' vs ' + perFrame.toFixed(2) + ' per frame');
  check('...and does not keep accelerating afterwards',
        [4,7,10,13].every((p)=>near(speedDuring(p), perFrame, perFrame*0.05)),
        [4,7,10,13].map((p)=>speedDuring(p).toFixed(2)).join(' '));
  check('the spin-up is over within one interval of spawning',
        speedDuring(2) > speedDuring(0),
        speedDuring(0).toFixed(2) + ' -> ' + speedDuring(2).toFixed(2));
  let backwards = 0;
  for(let i = 1; i < drawn.length; i++){
    if(drawn[i].x < drawn[i-1].x-1e-9){ backwards++; }
  }
  check('the bullet never stutters backwards', backwards === 0, backwards + ' frames');
}

console.log('\na new entity is complete on the packet that introduces it:');
{
  /*
    Creating an entity used to be an `else` against the block that applies a packet's fields,
    so on its first packet an entity got only its four constructor arguments. That was
    survivable only because SetPacket had a second bug - it iterated the whole instance list
    three times per packet, and passes two and three found the entity already there and
    filled it in. Fixing the wasteful loop made the incomplete-entity bug reachable: a tank
    spent a packet interval holding the constructor's placeholder class, which is not a class
    TanksConfig knows, so drawTank returned undefined and Tank.draw threw on it - taking the
    whole render loop down, from one entity appearing.
  */
  const a = boot({key: '0'.repeat(25), gm: 'ffa', name: 'tester', pet: -1, ws: ''});
  const hook  = a.start(packet(1, {x: 0, y: 0}));
  const TC    = a.sandbox.TanksConfig;
  const Insts = hook.Instances;

  let err = null;
  try {
    a.deliver(packet(2, {x: 0, y: 0}, {x: 100, y: 0}, {x: 200, y: 50, class: 'Sniper', name: 'rival'}));
    a.frame(FRAME);
  } catch(e){ err = e.message; }
  check('the frame a tank first appears on renders', !err, err);

  const tank = Insts.Players[3];
  check('the new tank exists', !!tank);
  check('it has a class TanksConfig knows, immediately',
        tank && TC.list.indexOf(tank.class) >= 0, tank && tank.class);
  check('...the one the packet said', tank && tank.class === 'Sniper', tank && tank.class);
  // hp rides the wire as a uint8 fraction, so it comes back quantised, not exact.
  check('and the rest of its state, not just x/y/size/color',
        tank && tank.name === 'rival' && near(tank.hp, 0.5, 1/255) && tank.bot === 1,
        tank && [tank.name, tank.hp, tank.bot].join('/'));
  check('nothing non-finite reached the canvas', a.record.badTranslate === 0,
        a.record.badTranslate);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
