/*
  The network layer: an http server that 404s everything (it exists only to host the
  WebSocket upgrade) plus the ws server itself.

  Contains the packet router `income()`, the per-socket `loop` object that drives the two
  outbound timers, and the `talk` / `kick` helpers. Everything gameplay-related is reached
  through RT.Controller, which does not exist yet when this module loads - see
  lib/runtime.js.

  Timing note, unchanged from the original: `gameloop` re-arms itself with setTimeout(30)
  and `longloop` with setTimeout(1000). Both drift under load, and neither is tied to the
  room simulation's own ~50Hz setTimeout(20) chain.
*/
const RT        = require('../lib/runtime.js');
const config    = require('../lib/config.js').config;
const http      = require('http');
const WebSocket = require('ws');
const PROTO     = require('../public/SHARE/SocketSchema.js');

const server = http.createServer(function(request, response){
    response.writeHead(404);
    response.end();
});

const ws = (function(){


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

  function loop(socket){
    this.socket = socket;
    this.strikes = 0;
    this.dead = 0;
    this.request = 0;
    this.heartbeats = 0;
    this.run = 1;
    this.chat = 0;
    this.gameloop = function(){
      if(!this.run){return;}
      if(this.chat){
        this.chat--;
      }
      let id = RT.Controller.clients[this.socket.id];
      let ms = 30;
      ///
      switch(id){
        case 'Waiting':{
          ms = 200;
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
            ms = 200;
          }
          let mess = RT.Controller.chat.get(socket.id);
          if(mess){
            talk(this.socket,'chatUpdate',mess);
          }
          break;
        }
      }
      ///
      setTimeout((it)=>{it.gameloop()},ms,this);
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
      setTimeout((it)=>{it.longloop()},1000,this);
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

  let wss = new WebSocket.Server({server});
  wss.on('connection', function(socket){
    socket.id = 'Waiting';
    socket.on('message', (packet)=>{income(socket,packet)});
    socket.on('close', () => {})
  });
  return wss;
})();

exports.server = server;
exports.ws     = ws;
exports.listen = function(port){
  server.listen(port, function(){
    console.log('Server started on port ' + server.address().port);
  });
};
