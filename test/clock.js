/*
  Fixed-timestep clock tests (HANDOFF 8.8).

  lib/clock.js replaced the `setTimeout(update, 20)` chain each room re-armed for itself. The
  properties that matter are the ones the chain did not have, and none of them are visible to
  the other suites: rooms tick at an average of exactly the step regardless of how long a
  step takes, a long stall is discarded rather than repaid as a burst, and a room that
  removes itself mid-step does not corrupt the iteration.

  Everything here drives an isolated Clock instance rather than the shared one the rooms use.

    node test/clock.js
*/
const clock = require('../lib/clock.js');
const Clock = clock.Clock;

let passed = 0, failed = 0;
function check(name, ok, detail){
  if(ok){ passed++; console.log('  ok   ' + name); }
  else  { failed++; console.log('  FAIL ' + name + (detail !== undefined ? '  (' + detail + ')' : '')); }
}

function counter(){
  return {steps: 0, step: function(){ this.steps++; }};
}

/*
  A clock on a scripted wall clock. `arm` is stubbed out so no real timer fires; the test
  advances `at` and calls wake() itself, which runs the accumulator exactly as it runs in
  production. Injecting the time source is the only reason these assertions are about
  lib/clock.js rather than about a copy of its arithmetic.
*/
function scripted(stepMs, maxCatchup){
  let box = {at: 0};
  let c = new Clock(stepMs, maxCatchup, function(){ return box.at; });
  c.arm = function(){ this.timer = null; };
  c.warn = false;              // the stall test provokes the log on purpose
  box.clock = c;
  box.advance = function(ms){ box.at += ms; c.wake(); };
  return box;
}

console.log('obstar clock tests\n');

console.log('stepping:');
{
  let c = new Clock(20, 5);
  let a = counter(), b = counter();
  c.add(a); c.add(b);
  c.stop();                     // drive it by hand rather than by wall clock
  c.tick(10);
  check('every target gets every step', a.steps === 10 && b.steps === 10,
        a.steps + '/' + b.steps);
  c.remove(a);
  c.tick(5);
  check('a removed target stops being stepped', a.steps === 10 && b.steps === 15,
        a.steps + '/' + b.steps);
  check('the clock stops itself when the last target leaves', (function(){
    c.remove(b);
    return c.timer === null;
  })());
}

console.log('\nself-removal mid-step:');
{
  // This is what a room does when the last human leaves: it deletes itself from inside its
  // own step(). Iterating the live Set directly while it is being mutated skips targets.
  let c = new Clock(20, 5);
  let survivors = [counter(), counter(), counter()];
  let suicide = {steps: 0, step: function(){ this.steps++; c.remove(this); }};
  c.add(survivors[0]); c.add(suicide); c.add(survivors[1]); c.add(survivors[2]);
  c.stop();
  c.tick(3);
  check('a target that removes itself is stepped exactly once', suicide.steps === 1, suicide.steps);
  check('the targets after it are not skipped',
        survivors.every((s) => s.steps === 3), survivors.map((s)=>s.steps).join('/'));
}

console.log('\ncatch-up and drift:');
{
  // THE BUG. The old chain re-armed with a flat setTimeout(20) after doing the work, so a
  // step that cost real time pushed the next one out by that much, every time, and the
  // simulation quietly ran slow. The accumulator repays the overrun instead.
  let s = scripted(20, 5);
  let target = counter();
  s.clock.add(target);
  // 800ms of wall clock delivered in ragged chunks, the way a loaded event loop delivers it.
  let chunks = [21, 19, 35, 5, 20, 40, 12, 28, 20, 20, 33, 7, 60, 20, 20, 20, 20, 20, 20, 20,
                20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20];
  let total = 0;
  for(let ms of chunks){ total += ms; s.advance(ms); }
  check('steps run track wall clock, not timer callbacks',
        Math.abs(target.steps-total/20) <= 1, target.steps + ' steps for ' + total + 'ms');
  check('nothing is dropped for ordinary jitter', s.clock.dropped === 0, s.clock.dropped);

  // The same schedule against a chain that just adds the period after the work: it loses a
  // step for every chunk that overran, which is what "runs slow under load" means.
  let naive = 0, budget = 0;
  for(let ms of chunks){ budget += ms; if(budget >= 20){ naive++; budget = 0; } }
  check('the old flat re-arm would have lost steps over the same wall clock',
        naive < target.steps, naive + ' vs ' + target.steps);
}

console.log('\nstall handling:');
{
  // A 2 second GC pause must not be repaid as 100 back-to-back steps: that burst causes the
  // next stall, which is longer. Time past the catch-up budget is discarded and counted.
  let s = scripted(20, 5);
  let target = counter();
  s.clock.add(target);
  s.advance(2000);
  check('a 2s stall runs at most the catch-up budget', target.steps === 5, target.steps);
  check('the rest is dropped, not queued', s.clock.dropped === 95, s.clock.dropped);
  check('and the next ordinary wake-up is back to one step', (function(){
    let before = target.steps;
    s.advance(20);
    return target.steps === before+1;
  })(), target.steps);
  check('the budget is small enough to stay responsive',
        s.clock.stepMs*s.clock.maxCatchup <= 200,
        s.clock.stepMs*s.clock.maxCatchup + 'ms');
}

console.log('\nno-drift over a long run:');
{
  // 60 seconds of wall clock in 20ms wake-ups that are each 3ms late - the shape of the old
  // bug. An accumulator ends up with the right number of steps; a flat re-arm ends up 13%
  // short, which is a simulation running 13% slow.
  let s = scripted(20, 5);
  let target = counter();
  s.clock.add(target);
  for(let i = 0; i < 3000; i++){ s.advance(23); }
  let wall = 3000*23;
  check('a persistently late timer does not slow the simulation',
        Math.abs(target.steps-wall/20) <= 1, target.steps + ' of ' + (wall/20));
  check('...where the old chain would have been ~13% short', 3000 < wall/20*0.9,
        3000 + ' vs ' + (wall/20));
}

console.log('\nlive rate:');
{
  // The real thing, on the real timer: 300ms of wall clock should be ~15 steps at 50Hz.
  let c = new Clock(20, 5);
  let target = counter();
  c.add(target);
  let started = Date.now();
  setTimeout(function(){
    let ms = Date.now()-started;
    let want = ms/20;
    c.remove(target);
    check('the timer really runs at the step rate',
          Math.abs(target.steps-want) <= 3, target.steps + ' steps in ' + ms + 'ms');
    check('rate() reports something sane', Math.abs(c.rate()-50) < 8, c.rate().toFixed(2));

    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  }, 400);
}
