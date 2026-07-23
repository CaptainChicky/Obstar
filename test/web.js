/*
  The single-entry-point test: boots `node server.js` exactly the way a person runs it, on
  one throwaway port, and asserts that ONE process serves the menu page, the /play page,
  the static client files and the game WebSocket.

  This is the thing that used to be broken most often and was covered by nothing: the repo
  shipped two entry points, and starting one without the other gave you either a menu that
  hangs on Play or a socket with no page in front of it. Now that server.js merges them,
  this pins the merge - including the ordering trap in play.ejs, where POST has to be
  defined before ws_link.js reads POST.ws.

  The web half is also checked in split mode (--web-only + WS_LINK), because that is the
  only way the deployed topology in README.md still works.

    node test/web.js        (or: npm test)
*/
const {fork}    = require('child_process');
const http      = require('http');
const path      = require('path');
const WebSocket = require('ws');

const ROOT         = path.join(__dirname, '..');
const PORT         = Number(process.env.WEB_TEST_PORT) || 8098;
const SPLIT_PORT   = PORT + 1;
const BOOT_TIMEOUT = 15000;
const SAMPLE_MS    = 4000;
const SPLIT_LINK   = 'wss://game.example.com';

const clientProto = require('./clientProto.js')();

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

function request(port, method, path, body){
  return new Promise(function(resolve, reject){
    const headers = body ? {
      'Content-Type':   'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body)
    } : {};
    const req = http.request({host:'localhost', port:port, path:path, method:method, headers:headers}, function(res){
      let text = '';
      res.on('data', function(d){ text += d; });
      res.on('end', function(){ resolve({status: res.statusCode, body: text}); });
    });
    req.on('error', reject);
    req.end(body);
  });
}

// The server prints "Server started on port N" once listening, but poll instead of parsing
// it so the test does not depend on log wording.
async function waitUntilUp(port){
  const deadline = Date.now() + BOOT_TIMEOUT;
  while(Date.now() < deadline){
    try {
      await request(port, 'GET', '/favicon.ico');
      return true;
    } catch(e){
      await new Promise(function(r){ setTimeout(r, 200); });
    }
  }
  return false;
}

function start(args, port, extraEnv){
  const child = fork(path.join(ROOT, 'server.js'), args, {
    cwd: ROOT,
    env: Object.assign({}, process.env, {PORT: String(port)}, extraEnv || {}),
    silent: true
  });
  child.output = '';
  child.stdout.on('data', function(d){ child.output += d; });
  child.stderr.on('data', function(d){ child.output += d; });
  return child;
}

/// 1. One process, one port ///////////////////////////////////////////////////
async function combinedTests(){
  console.log('server.js (game + web on one port):');
  const child = start([], PORT);

  if(!await waitUntilUp(PORT)){
    check('server came up', false, child.output.trim().split('\n').slice(-3).join(' / '));
    child.kill();
    return;
  }

  const index = await request(PORT, 'GET', '/');
  check('GET / renders the menu', index.status === 200 && index.body.includes('var POST'), 'status ' + index.status);

  const play = await request(PORT, 'POST', '/play', 'gm=ffa&name=smoke&pet=-1');
  check('POST /play renders the game page', play.status === 200 && play.body.includes('/client/game.js'), 'status ' + play.status);
  check('play.ejs defines POST before loading ws_link.js',
        play.body.indexOf('var POST =') < play.body.indexOf("'./SHARE/ws_link.js'"));
  check('combined mode leaves POST.ws empty (same origin)', /"ws":""/.test(play.body));

  // The client has no bundler, so the page IS the dependency graph. Each file assumes the
  // ones before it have run; a reordered tag is a runtime error nothing else would catch.
  const order = ['runtime','config','util','drawings','entities','render','ui','game','overlay','boot'];
  const at = order.map(function(f){ return play.body.indexOf('/client/' + f + '.js'); });
  check('play.ejs loads every client file', at.every(function(i){ return i >= 0; }),
        order.filter(function(f, i){ return at[i] < 0; }).join(', ') + ' missing');
  check('play.ejs loads them in dependency order',
        at.every(function(i, n){ return n === 0 || i > at[n-1]; }), at.join(','));
  check('the client loads after motion.js', play.body.indexOf('/client/runtime.js') > play.body.indexOf('./motion.js'));

  const shared = await request(PORT, 'GET', '/SHARE/ws_link.js');
  check('static client files are served', shared.status === 200 && shared.body.includes('WS_LINK'), 'status ' + shared.status);

  const client = await request(PORT, 'GET', '/client/runtime.js');
  check('/client/ is served', client.status === 200 && client.body.includes('CLIENT'), 'status ' + client.status);

  await new Promise(function(resolve){
    const socket = new WebSocket('ws://localhost:' + PORT);
    let updates = 0;
    socket.on('open', function(){
      socket.send(clientProto.encode('init', {key: '0'.repeat(25), gm: 'ffa', name: 'smoke', pet: -1}));
    });
    socket.on('message', function(){ updates++; });
    socket.on('error', function(err){
      check('the game socket answers on that same port', false, err.message);
      resolve();
    });
    setTimeout(function(){
      check('the game socket answers on that same port', updates > 5, updates + ' packets');
      socket.removeAllListeners();
      socket.terminate();
      resolve();
    }, SAMPLE_MS);
  });

  child.kill();
}

/// 2. Split deployment ////////////////////////////////////////////////////////
async function splitTests(){
  console.log('server.js --web-only (game on another machine):');
  const child = start(['--web-only'], SPLIT_PORT, {WS_LINK: SPLIT_LINK});

  if(!await waitUntilUp(SPLIT_PORT)){
    check('web-only server came up', false, child.output.trim().split('\n').slice(-3).join(' / '));
    child.kill();
    return;
  }

  const play = await request(SPLIT_PORT, 'POST', '/play', 'gm=ffa&name=smoke&pet=-1');
  check('WS_LINK reaches the client through POST.ws', play.body.includes('"ws":"' + SPLIT_LINK + '"'));

  await new Promise(function(resolve){
    const socket = new WebSocket('ws://localhost:' + SPLIT_PORT);
    let opened = false;
    socket.on('open',  function(){ opened = true; });
    // Express answers the upgrade with a plain HTTP response, so ws errors out. That is
    // the pass condition here, not a reason to stop.
    socket.on('error', function(){});
    setTimeout(function(){
      check('no game socket is attached in --web-only', !opened);
      socket.removeAllListeners();
      socket.terminate();
      resolve();
    }, 1500);
  });

  child.kill();
}

(async function(){
  await combinedTests();
  await splitTests();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
