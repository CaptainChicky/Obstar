/*
  End-to-end smoke test. Boots a real server.js --game-only on a throwaway port, connects a
  real WebSocket, performs the binary `init` handshake, and asserts that the server
  simulates and streams GameUpdate packets back.

  This exists so the protocol and room code can be refactored without a browser in the
  loop. It is deliberately blunt: it does not check gameplay values, only that the pipe
  from socket -> room -> encoder -> socket is intact end to end.

    node test/smoke.js        (or: npm test)
*/
const {fork}     = require('child_process');
const path       = require('path');
const WebSocket  = require('ws');

const ROOT        = path.join(__dirname, '..');
const PORT        = Number(process.env.SMOKE_PORT) || 8099;
const BOOT_TIMEOUT   = 10000;
const UPDATE_TIMEOUT = 8000;
const SAMPLE_MS      = 6000;   // long enough for big polygons to spawn and exercise getPlace

const clientProto = require('./clientProto.js')();
const serverProto = require(path.join(ROOT, 'public', 'SHARE', 'SocketSchema.js'));

let passed = 0, failed = 0;
function check(name, ok, detail){
  if(ok){
    passed++;
    console.log('  ok   ' + name);
  } else {
    failed++;
    console.log('  FAIL ' + name + (detail ? '  (' + detail + ')' : ''));
  }
}

/// 1. Protocol round trip, no server needed //////////////////////////////////
function protocolTests(){
  console.log('protocol:');

  let key = '0'.repeat(25);
  let init = clientProto.encode('init', {key: key, gm: 'ffa', name: 'smoketest', pet: -1});
  check('client encodes init', init && init.byteLength > 0);

  let decoded = serverProto.decode(Buffer.from(init));
  check('server decodes init as type init', decoded.type === 'init', 'got ' + decoded.type);
  check('init survives round trip: no error', !decoded.error, String(decoded.error));
  check('init survives round trip: key',  decoded.data.key === key, decoded.data.key);
  check('init survives round trip: gm',   decoded.data.gm === 'ffa', decoded.data.gm);
  check('init survives round trip: name', decoded.data.name === 'smoketest', decoded.data.name);

  for(let key of ['w', 'a', 's', 'd', 'mouseL']){
    let d = serverProto.decode(Buffer.from(clientProto.encode('keydown', key)));
    check('keydown ' + key + ' round trips', d.type === 'keydown' && d.data.key === key,
          d.type + '/' + (d.data && d.data.key));
  }

  let up = serverProto.decode(Buffer.from(clientProto.encode('upgrade', 3)));
  check('upgrade round trips', up.type === 'upgrade' && up.data.up === 3);

  let ping = serverProto.decode(Buffer.from(clientProto.encode('ping', 0)));
  check('ping round trips', ping.type === 'ping', ping.type);
}

/*
  Decode a GameUpdate the way the browser does and sanity check the numbers in it.

  The NaN guard is the point: HANDOFF.md section 5.2 describes `i.size += c.SIZE_GET_POS`
  resolving to undefined inside a loop that shadowed the config, which poisons an entity's
  size to NaN permanently and corrupts its collision and quadtree insertion. A NaN reaching
  the wire is the observable symptom, so assert it never does.
*/
function checkGameUpdates(buffers){
  let decoded = [], failure = null;
  for(let buf of buffers){
    let arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    try {
      decoded.push(clientProto.decode(arrayBuffer));
    } catch(err){
      failure = failure || err.message;
    }
  }
  check('client decodes every GameUpdate', !failure && decoded.length === buffers.length,
        failure || (decoded.length + '/' + buffers.length));
  if(!decoded.length){ return; }

  let head = decoded[0].data && decoded[0].data.head;
  check('GameUpdate head has finite map size',
        head && isFinite(head.width) && isFinite(head.height),
        head && (head.width + 'x' + head.height));

  // The getPlace mechanic only fires when a big polygon spawns, so a single frame proves
  // nothing. Sample the whole window and require that we actually saw objects at all,
  // otherwise a green result would just mean an empty map.
  let seen = 0, bad = [];
  let inspect = function(label, entity){
    if(!entity){ return; }   // the instance arrays are sparse and full of nulls
    seen++;
    for(let field of ['x', 'y', 'size']){
      if(entity[field] !== undefined && !isFinite(entity[field])){
        bad.push(label + '.' + field + '=' + entity[field]);
      }
    }
  };
  for(let update of decoded){
    if(!update.data){ continue; }
    inspect('User', update.data.User);
    let instances = update.data.Instances || {};
    for(let group of ['Players', 'Objects', 'Bullets']){
      for(let entity of (instances[group] || [])){
        inspect(group, entity);
      }
    }
  }
  check('sampled a populated world', seen > 100, seen + ' entity snapshots');
  check('no NaN x/y/size on any entity', bad.length === 0,
        bad.length + ' bad: ' + bad.slice(0, 3).join(', '));
}

/// 2. Live server ////////////////////////////////////////////////////////////
/*
  Run once per gamemode. Every mode is a different set of rules over the same tick, and the
  realistic failure is a change that only breaks one of them - '4team' in particular is the
  first mode with more than two sides, and 'boss' the first with entities that run their own
  update() rather than the shared one.
*/
function serverTests(gamemode, port, done){
  console.log('server (' + gamemode + '):');

  // --game-only: the test drives the binary protocol, and there is no reason to stand the
  // Express site up (or to fight whatever else holds port 80) to do that.
  let child = fork(path.join(ROOT, 'server.js'), ['--game-only'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {PORT: String(port)}),
    silent: true
  });

  let childOutput = '';
  child.stdout.on('data', function(d){ childOutput += d; });
  child.stderr.on('data', function(d){ childOutput += d; });

  let finished = false;
  function finish(err){
    if(finished){ return; }
    finished = true;
    child.kill();
    if(err){
      check('server run', false, err);
      if(childOutput.trim()){
        console.log('  --- server output ---');
        console.log('  ' + childOutput.trim().split('\n').join('\n  '));
      }
    }
    done();
  }

  child.on('exit', function(code){
    if(!finished){ finish('server.js exited early with code ' + code); }
  });

  // The server prints "Server started on port N" once listening. Poll the port instead of
  // parsing that, so the test does not depend on log wording.
  let deadline = Date.now() + BOOT_TIMEOUT;
  (function connect(){
    if(Date.now() > deadline){ return finish('server never accepted a connection'); }

    let socket = new WebSocket('ws://localhost:' + port);
    let updates = [], firstUpdate = null, timer = null;

    socket.on('error', function(){
      // Server is not listening yet. Drop this attempt entirely - including any timer it
      // armed - and retry, otherwise a stale timer from a failed attempt fires mid-test.
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.terminate();
      setTimeout(connect, 200);
    });

    socket.on('open', function(){
      check('websocket connects', true);
      socket.send(clientProto.encode('init', {
        key: '0'.repeat(25), gm: gamemode, name: 'smoketest', pet: -1
      }));

      // Give up early if nothing ever arrives, otherwise sample a full window.
      let firstPacket = setTimeout(function(){
        finish('no GameUpdate packet within ' + UPDATE_TIMEOUT + 'ms');
      }, UPDATE_TIMEOUT);

      timer = setTimeout(function(){
        clearTimeout(firstPacket);
        if(!updates.length){ return finish('no GameUpdate packets in sample window'); }

        check('server streams GameUpdate after init', true);
        check('GameUpdate carries a payload', firstUpdate.length > 1, firstUpdate.length + ' bytes');
        check('server keeps streaming', updates.length > 10, updates.length + ' updates');
        checkGameUpdates(updates);

        socket.close();
        finish();
      }, SAMPLE_MS);

      socket.on('message', function(){ clearTimeout(firstPacket); });
    });

    socket.on('message', function(packet){
      let buf = Buffer.from(packet);
      let type = buf.readUInt8(0);

      // The server half of the schema cannot decode its own outbound packets (it only
      // implements the client->server direction), so identify by the leading type byte.
      if(type === 1){                         // 'kick'
        clearTimeout(timer);
        return finish('server kicked the test client');
      }
      if(type === 5){                         // 'GameUpdate'
        if(!firstUpdate){ firstUpdate = buf; }
        updates.push(buf);
      }
    });
  })();
}

console.log('obstar smoke test\n');
protocolTests();

// Sequential, not parallel: config.MAX_IP caps concurrent connections per IP at 2.
let modes = [['ffa', PORT], ['2team', PORT + 1], ['4team', PORT + 2], ['boss', PORT + 3]];
(function next(){
  if(!modes.length){
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    return process.exit(failed ? 1 : 0);
  }
  let mode = modes.shift();
  console.log('');
  serverTests(mode[0], mode[1], next);
})();
