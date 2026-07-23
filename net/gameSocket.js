/*
  The game's WebSocket layer.

  Contains the packet router `income()`, the per-socket `loop` object that drives the two
  outbound timers, and the `talk` / `kick` helpers. Everything gameplay-related is reached
  through RT.Controller, which does not exist yet when this module loads - see
  lib/runtime.js.

  This module owns no port. `attach(httpServer)` hangs a ws server off an http server
  somebody else made, which is what lets server.js put the game and the menu site on one
  port in one process (and still split them onto two when asked).

  Timing. `gameloop` sends a GameUpdate about every 30ms and `longloop` a heartbeat every
  second. Neither is tied to the room simulation, and that is deliberate (HANDOFF 8.8): the
  rooms run at a fixed 50Hz on the shared clock in lib/clock.js, and a send is just a
  snapshot of whatever the simulation had reached when the timer fired. Nothing has to divide
  evenly, and a slow send cannot slow the simulation down.

  What did change is that both loops now aim at a *deadline* instead of re-arming with a flat
  setTimeout(30). setTimeout means "in at least 30ms", so the old chain paid for its own work
  every time round and the send rate sagged under load - the client saw that as jitter,
  because its interpolation is driven by the spacing packets actually arrive with. The delay
  is computed from when the next send was due, so overrun is absorbed rather than accumulated.
*/
const RT        = require('../lib/runtime.js');
const config    = require('../lib/config.js').config;
const WebSocket = require('ws');
const PROTO     = require('../public/SHARE/SocketSchema.js');

function attach(httpServer){


  function income(socket,packet){
    if(socket.main){
      socket.main.request++;
    }
    let data = PROTO.decode(packet);
    ///
    if(data.error){
      kick(socket,data.error);
      return;
    }
    switch(data.type){
      case 'ping':
        if(socket.main){
          socket.main.heartbeats = 0;
        }
      case 'init':{
        if(socket.main){
          break;
        }
        socket.id = RT.Controller.askConnection(data.data, socket._socket.remoteAddress);
        socket.main = new loop(socket);
        break;
      };
      case 'keydown':{
        socket.main.request -= .5;
        let tank = RT.Controller.getPlayer(socket.id);
        if(!RT.Controller.getPlayer(socket.id)){ break; }
        switch(data.data.key){
          case 'a':
          case 'w':
          case 's':
          case 'd':
          case 'arrw':
          case 'arrs':
          case 'arra':
          case 'arrd':
          case 'mouseL':
          case 'mouseR':
            tank.inputs[data.data.key] = 1;
            break;
          case 'c':
          case 'e':
            tank.inputs[data.data.key] = !tank.inputs[data.data.key]*1
            break;
        }
        break;
      };
      case 'keyup':{
        socket.main.request -= .5;
        let tank = RT.Controller.getPlayer(socket.id);
        if(!RT.Controller.getPlayer(socket.id)){ break; }
        switch(data.data.key){
          case 'a':
          case 'w':
          case 's':
          case 'd':
          case 'arrw':
          case 'arrs':
          case 'arra':
          case 'arrd':
          case 'mouseL':
          case 'mouseR':{
            tank.inputs[data.data.key] = 0;
            break;
          };
          case 'enter':{
            let ans = RT.Controller.respawn(socket.id);
            let tank = RT.Controller.getPlayer(socket.id);
            if(!tank && ! ans){ break; }
            talk(socket,'UpdateUp',tank.upNb);
            break;
          };
        }
        break;
      };
      case 'mousemove':{
        let tank = RT.Controller.getPlayer(socket.id);
        if(!RT.Controller.getPlayer(socket.id)){ break; }
        if(tank.botMod){break;}
        tank.dir = data.data.dir;
        tank.inputs.mouse_x = data.data.x*tank.screen;
        tank.inputs.mouse_y = data.data.y*tank.screen*0.5625;
        break;
      };
      case 'upgrade':{
        let tank = RT.Controller.getPlayer(socket.id);
        if(!tank){ break; }
        tank.upgrade(data.data.up);
        talk(socket,'UpdateUp',tank.upNb);
        break;
      };
      case 'upClass':{
        let tank = RT.Controller.getPlayer(socket.id);
        if(!tank){ break; }
        tank.upClass(data.data.up);
      };
      case 'com':{
        socket.main.request+=4;
        let ans = RT.Controller.command(socket.id,data.data);
        if(ans){
          talk(socket,'comResponse',ans);
        }
        break;
      };
      case 'chat':{
        socket.main.request+=4;
        if(socket.main.chat){
          talk(socket,'chatUpdate', [['','Please wait a little.']]);
          break;
        }
        socket.main.chat+=20;
        RT.Controller.chat.add(socket.id,data.data);
        break;
      };
    }
  };

  const SEND_MS = 30;    // target spacing between GameUpdate packets
  const IDLE_MS = 200;   // ...while the client has nothing to look at yet
  /*
    Next firing time for a self-re-arming loop, as a delay in ms. `due` is carried on the
    loop object and advanced by exactly `period` each time, so the average rate is the period
    even when a tick runs long. If we fall more than one period behind - a real stall, not
    a rounding error - the deadline resets to now rather than firing a catch-up burst.
  */
  function nextDelay(it,key,period){
    let now = Date.now();
    let due = (it[key] || now)+period;
    if(due < now-period){ due = now+period; }
    it[key] = due;
    return Math.max(0,due-now);
  }

  function loop(socket){
    this.socket = socket;
    this.strikes = 0;
    this.dead = 0;
    this.request = 0;
    this.heartbeats = 0;
    this.run = 1;
    this.chat = 0;
    this.sendDue = 0;
    this.slowDue = 0;
    this.gameloop = function(){
      if(!this.run){return;}
      if(this.chat){
        this.chat--;
      }
      let id = RT.Controller.clients[this.socket.id];
      let ms = SEND_MS;
      ///
      switch(id){
        case 'Waiting':{
          ms = IDLE_MS;
          break;
        }
        case 'ERR_GAMEMODE':
        case 'ERR_DOUBLE_IP':
        case 'ERR_BROKEN_KEY':
        case 'ERR_SERVER_FULL':
        case 'ERR_SERVER_OFF':
        case 'ERR_REQUESTS_DELAY':
        case 'ERR_PACKET_LENGTH':
        case 'ERR_HEARTBEATS_LOST':
        case 'ERR_DOUBLE_ACC':
        case 'ERR_PACKET_TYPE':{
          console.log(id);
          kick(this.socket,id);
          break;
        }
        default:{
          let buff = RT.Controller.getBuffer(socket.id);
          if(buff){
            talk(this.socket,'GameUpdate',buff);
          } else {
            ms = IDLE_MS;
          }
          let mess = RT.Controller.chat.get(socket.id);
          if(mess){
            talk(this.socket,'chatUpdate',mess);
          }
          break;
        }
      }
      ///
      // A send that ran long eats into the next delay instead of pushing it back, so the
      // spacing the client measures stays close to `ms`.
      if(ms !== this.sendPeriod){ this.sendPeriod = ms; this.sendDue = 0; }
      setTimeout((it)=>{it.gameloop()},nextDelay(this,'sendDue',ms),this);
    };
    this.longloop = function(){
      if(!this.run){return;}
      ///REQUEST
      if(this.request >= 50){
        kick(this.socket,'ERR_REQUESTS_DELAY')
        return;
      } else {
        this.request = 0;
        this.strikes = 0;
      }
      ///DEAD
      let play = RT.Controller.getPlayer(socket.id);
      if(this.dead>config.S_BEFORE_KICK){
        kick(this.socket,'ERR_SERVER_OFF');
        return;
      }
      if(play){
        if(play.dead){
          this.dead++;
        } else {
          this.dead = 0;
        }
      };
      ///HEARTBEATS
      if(this.heartbeats >= 10){
        kick(this.socket,'ERR_HEARTBEATS_LOST');
      } else {
        talk(this.socket,'ping',0);
        let ui = RT.Controller.getUi(this.socket.id);
        if(ui){
          talk(this.socket,'UiUpdate',ui);
        }
      }
      this.heartbeats++;
      /////
      setTimeout((it)=>{it.longloop()},nextDelay(this,'slowDue',1000),this);
    };
    this.gameloop();
    this.longloop();
  };

  function talk(socket,type,data){
    socket.send(PROTO.encode(type,data));
  };

  function kick(socket,reason){
    if(socket.main){
      socket.main.run = 0;
    };
    console.log('KICKED id:'+socket.id+'//'+reason)
    socket.send(PROTO.encode('kick',reason));
    RT.Controller.disconnect(socket.id, socket._socket.remoteAddress);
    setTimeout((s)=>{s.close()},100,socket);
  }

  let wss = new WebSocket.Server({server: httpServer});
  wss.on('connection', function(socket){
    socket.id = 'Waiting';
    socket.on('message', (packet)=>{income(socket,packet)});
    socket.on('close', () => {})
  });
  return wss;
}

exports.attach = attach;
