/*
  Room tests: the gamemode behaviour that test/smoke.js cannot see.

  smoke.js drives a real socket and proves the pipe from socket -> room -> encoder -> socket
  is intact, but every assertion it makes is true of any room. Teams, bases, bot rosters,
  colours and respawn xp are exactly the things that differed between the old Ffa and
  TwoTeam copies, so they are exactly what a shared rooms/Room.js has to be pinned on. When
  4team or boss gets written, this is the file that says whether the base still fits.

  No server and no socket: lib/boot.js fills the registry, and the rooms are built and
  poked directly.

    node test/rooms.js        (npm test runs this and smoke.js)
*/
const path = require('path');
const ROOT = path.join(__dirname, '..');

require(path.join(ROOT, 'lib', 'boot.js'))();
const RT = require(path.join(ROOT, 'lib', 'runtime.js'));

let passed = 0, failed = 0;
function check(name, ok, detail){
  if(ok){
    passed++;
    console.log('  ok   ' + name);
  } else {
    failed++;
    console.log('  FAIL ' + name + (detail !== undefined ? '  (' + detail + ')' : ''));
  }
}

/*
  Rooms register themselves with the Controller and tear themselves down on the first tick
  that finds no human in them, so build them through newServer and seat a player at once.
  The timers they arm are left running; the process exits at the end of the file.
*/
function makeRoom(gm){
  let room = RT.Controller.newServer(gm);
  room.ask({name: 'tester', key: '0'.repeat(25), pet: -1, gm: gm});
  return room;
}

function player(room, id){
  return room.INSTANCE.players[id];
}

/// Free-for-all //////////////////////////////////////////////////////////////
function ffaTests(){
  console.log('rooms (ffa):');
  let room = makeRoom('ffa');

  check('level cap comes from the mode', room.XPLVL[room.XPLVL.length-1] === 25000,
        room.XPLVL[room.XPLVL.length-1]);
  check('map is the ffa map', room.map.width === 9020 && room.map.height === 9020,
        room.map.width + 'x' + room.map.height);
  check('map is not resizing by default', room.newMap.width === room.map.width &&
        room.newMap.height === room.map.height);

  // Bots are seated by Init(), which runs on a timer, so ask() ran first: slot 0.
  let me = player(room, 0);
  check('first player takes slot 0', !!me && me.id.oId === 0);
  check('everyone is on the same nominal team', me.team === 1, me.team);

  let second = room.ask({name: 'tester2', key: '0'.repeat(25), pet: -1, gm: 'ffa'});
  check('second player takes slot 1', second && second.oId === 1, second && second.oId);
  check('second player is on that same team', player(room, 1).team === 1, player(room, 1).team);

  check('you are blue to yourself', room.mainColor(me) === 0, room.mainColor(me));
  check('everyone else is red to you', room.entityColor(player(room, 1)) === 1,
        room.entityColor(player(room, 1)));
  check('you top the leaderboard as blue', room.leaderColor(me, 0) === 0, room.leaderColor(me, 0));
  check('others sit on the leaderboard as red', room.leaderColor(player(room, 1), 0) === 1,
        room.leaderColor(player(room, 1), 0));

  check('your own bullets carry your colour', room.ownBulletColor({type: 1}, me) === 0,
        room.ownBulletColor({type: 1}, me));
  check('traps render as colour 9', room.bulletColor({type: 3, team: 1}) === 9,
        room.bulletColor({type: 3, team: 1}));
  let bullet = {};
  room.assignBulletTeam(bullet, me);
  check('bullets inherit the one team', bullet.team === 1, bullet.team);

  check('no bases to run into', room.inEnemyBase(me) === false);
  check('summoning a boss is a harmless no-op', (function(){
    try { room.createBoss(); return room.boss === null; } catch(e){ return e.message; }
  })() === true);

  // The spawn has to clear the three polygon nests: the origin and the two quarter points.
  let clear = true;
  for(let i = 0; i < 200; i++){
    let p = room.spawnPoint(me);
    let d = (x, y) => Math.sqrt(Math.pow(p.x - x, 2) + Math.pow(p.y - y, 2));
    if(d(0, 0) <= 1100 || d(room.map.width/4, room.map.height/4) <= 800 ||
       d(-room.map.width/4, -room.map.height/4) <= 800){ clear = false; }
    if(Math.abs(p.x) > room.map.width/2 || Math.abs(p.y) > room.map.height/2){ clear = false; }
  }
  check('spawns land on the map and clear of the nests', clear);

  return room;
}

/// Two teams /////////////////////////////////////////////////////////////////
function teamTests(){
  console.log('rooms (2team):');
  let room = makeRoom('2team');

  check('level cap comes from the mode', room.XPLVL[room.XPLVL.length-1] === 30000,
        room.XPLVL[room.XPLVL.length-1]);
  check('map is the 2team map', room.map.width === 8000 && room.map.height === 8000,
        room.map.width + 'x' + room.map.height);

  // build() runs before the first tick, so the guard drones are there from the start.
  let drones = room.INSTANCE.bullets.filter((b) => b && isNaN(b) && b.alone);
  check('both bases are guarded', drones.length === 20, drones.length + ' drones');
  check('the guards are split evenly', drones.filter((d) => d.team === 0).length === 10,
        drones.filter((d) => d.team === 0).length + ' on team 0');
  let leftGuards = drones.filter((d) => d.x < 0);
  check('each side guards its own half',
        leftGuards.length === 10 && leftGuards.every((d) => d.team === 0));

  // Sides are balanced on join, so four players come out two and two.
  for(let i = 0; i < 3; i++){
    room.ask({name: 'tester' + i, key: '0'.repeat(25), pet: -1, gm: '2team'});
  }
  let sides = [0, 0];
  for(let i = 0; i < 4; i++){ sides[player(room, i).team]++; }
  check('joins are balanced across the sides', sides[0] === 2 && sides[1] === 2, sides.join('/'));

  let zero = {team: 0}, one = {team: 1};
  check('team 0 dies in team 1\'s base', room.inEnemyBase({team: 0, x: 3500}) === true);
  check('team 0 is safe in its own', room.inEnemyBase({team: 0, x: -3500}) === false);
  check('team 1 dies in team 0\'s base', room.inEnemyBase({team: 1, x: -3500}) === true);
  check('team 1 is safe in its own', room.inEnemyBase({team: 1, x: 3500}) === false);
  check('midfield is safe for both', room.inEnemyBase({team: 0, x: 0}) === false &&
        room.inEnemyBase({team: 1, x: 0}) === false);
  check('the boss belongs to neither base', room.inEnemyBase({team: 9, x: 3500}) === false);

  // You respawn inside your own base, which is the one place you are guaranteed not to be
  // standing in an enemy one.
  let inside = true;
  for(let i = 0; i < 200; i++){
    if(room.inEnemyBase({team: 0, x: room.spawnPoint(zero).x})){ inside = false; }
    if(room.inEnemyBase({team: 1, x: room.spawnPoint(one).x})){ inside = false; }
  }
  check('you always respawn out of the enemy base', inside);

  check('tanks are coloured by side', room.entityColor({team: 1}) === 1 &&
        room.entityColor({team: 0}) === 0);
  check('your own tank too - no blue-for-you', room.mainColor({team: 1}) === 1,
        room.mainColor({team: 1}));
  check('the leaderboard is coloured by side', room.leaderColor({team: 1, id: {oId: 0}}, 0) === 1);
  check('bullets are coloured by side', room.bulletColor({team: 1, type: 1}) === 1);
  check('a dev colour overrides the side', room.bulletColor({team: 1, type: 1, color: 5}) === 4);

  let bullet = {};
  room.assignBulletTeam(bullet, {team: 1, dev: {}});
  check('bullets inherit the shooter\'s side', bullet.team === 1, bullet.team);

  let boss = room.createBoss();
  check('a boss can be summoned', !!room.boss && room.boss.boss === 1);
  check('the boss is on nobody\'s side', room.boss && room.boss.team === 9,
        room.boss && room.boss.team);
  check('a second boss does not stack', (function(){
    let first = room.boss;
    room.createBoss();
    return room.boss === first;
  })());

  return room;
}

/// Shared rules //////////////////////////////////////////////////////////////
/*
  Dying must never pay. The xp curve returns more than it was given below roughly a
  thousand xp, so the Math.min in Room.respawnXp is the whole point - TwoTeam was missing it
  and low-level deaths were a small reward there. See HANDOFF.md 5.8.
*/
function respawnTests(rooms){
  console.log('rooms (shared):');
  for(let room of rooms){
    let never = true, cap = room.XPLVL[room.XPLVL.length-1];
    for(let xp of [0, 1, 10, 100, 500, 1000, 5000, cap - 1, cap, cap * 2]){
      let got = room.respawnXp(xp);
      if(!(got <= xp) || !isFinite(got) || got < 0){ never = false; }
    }
    check(room.gm + ': a death never pays', never);
    check(room.gm + ': a death costs something', room.respawnXp(cap) < cap,
          room.respawnXp(cap) + ' of ' + cap);
    check(room.gm + ': past the cap you keep 60%', room.respawnXp(cap * 2) === cap * 0.6,
          room.respawnXp(cap * 2));
  }

  // Bot slots are fixed for the life of a room - update() walks this.bots to respawn them -
  // so a roster that hands out a duplicate id would quietly overwrite a player.
  for(let room of rooms){
    let roster = room.botRoster();
    let ids = roster.map((s) => s.id);
    check(room.gm + ': bot slots are unique', new Set(ids).size === ids.length, ids.join(','));
    check(room.gm + ': bots sit clear of the join slots', Math.min.apply(null, ids) >= 10,
          Math.min.apply(null, ids));
    check(room.gm + ': every bot has a real team',
          roster.every((s) => room.rules.teams.indexOf(s.team) >= 0),
          roster.map((s) => s.team).join(','));
  }
}

console.log('obstar room tests\n');
let ffa = ffaTests();
console.log('');
let team = teamTests();
console.log('');
respawnTests([ffa, team]);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
