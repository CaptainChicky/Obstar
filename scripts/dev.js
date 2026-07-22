/*
  Boots both servers in one terminal. They are genuinely separate processes that share
  nothing but the filesystem, so this is only a convenience wrapper - `npm run start:game`
  and `npm run start:web` in two terminals is exactly equivalent.

  If either child dies, take the whole thing down. A half-running pair is the confusing
  failure mode described in HANDOFF.md section 1.
*/
const {fork} = require('child_process');
const path   = require('path');

const ROOT = path.join(__dirname, '..');

let children = [
  fork(path.join(ROOT, 'Alex.js'),      {cwd: ROOT, env: process.env}),
  fork(path.join(ROOT, 'obstarWeb.js'), {cwd: ROOT, env: process.env})
];

let shuttingDown = false;
function shutdown(code){
  if(shuttingDown){ return; }
  shuttingDown = true;
  for(let child of children){
    if(!child.killed){ child.kill(); }
  }
  process.exit(code);
}

for(let child of children){
  child.on('exit', function(code){
    console.error('[dev] child pid ' + child.pid + ' exited with ' + code + ' - stopping both servers');
    shutdown(code === null ? 1 : code);
  });
}

process.on('SIGINT',  function(){ shutdown(0); });
process.on('SIGTERM', function(){ shutdown(0); });
