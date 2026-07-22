/*
  Main - the singleton game controller, instantiated once as `Controller`.

  Owns the client table, the rooms (one Sffa / S2team per gamemode slot), the chat relay,
  the admin command parser and the leaderboard writes. Everything else in the server talks
  to it through RT.Controller.

  The `server` map has slots for '4team' and 'boss' that no class implements, which is why
  those buttons are marked deactivated in views/index.ejs.
*/
const RT         = require('./runtime.js');
const Vec        = require('victor');
const config     = require('./config.js').config;
const cc         = require('./terminal.js');
const quadTree   = require('./quadTree.js');
const PROTO      = require('../public/SHARE/SocketSchema.js');
const CLASS      = require('../public/SHARE/TanksConfig.js').class;
const CLASS_TREE = require('../public/SHARE/TanksConfig.js').tree;
const FRICTION   = require('./constants.js').FRICTION;
const USERS      = config.MYSQL ? require('mysql').createPool(require('./AlexMysql.js').info) : 0;

class Main {
  constructor(){
    this.encodeInst = PROTO.encode;
    this.scoresLimit = 100;
    this.maxPseudoLength = 16;
    this.maxServer = 5;
    this.server = {
      'ffa':[],
      '2team':[],
      '4team':[],
      'boss':[]
    };
    this.ipConnect = {};
    this.clients = [];
    this.chat = (function(){
      let chatRoom = [];
      let clientMess = [0];
      let client = this.clients;

      function add(id,data){
        if(data[0] == '/'){
          com(id,data);
          return;
        }
        if(client[id].chat){
          for(let c of clientMess){
            if(c && c.gr == clientMess[client[id].chat].gr){
              c.mess.push([clientMess[client[id].chat].c+clientMess[client[id].chat].name,data]);
            }
          }
        }
      }
      function com(id,data){
        let arr = data.split(' ');
        switch(arr[0]){
          case '/join':{
            let name = RT.Controller.getPlayer(id).name;
            if(client[id].chat){
              delete clientMess[client[id].chat];
              client[id].chat = 0;
            }
            if(arr[1] && arr[1].length){
              for(let i = 0; i<=clientMess.length; i++){
                if(clientMess[i] == null && !client[id].chat){
                  clientMess[i] = {
                    gr: arr[1],
                    name: name,
                    c: 'ccf ',
                    mess: []
                  };
                  client[id].chat = i;
                }
                if(clientMess[i] && clientMess[i].gr == arr[1]){
                  clientMess[i].mess.push(['',name+' has join the chat !']);
                }
              }
            };
            break;
          };
          case '/name':{
            if(client[id].chat){
              clientMess[client[id].chat].mess.push(['',clientMess[client[id].chat].gr]);
            }
            break;
          };
          case '/quit':{
            if(client[id].chat){
              delete clientMess[client[id].chat];
              client[id].chat = 0;
            }
            break;
          };
          case '/color':{
            if(client[id].chat){
              if (arr[1].length == 6 && arr[1].match(/[0-9A-Fa-f]/g).length == 6){
                clientMess[client[id].chat].c = arr[1]+' ';
              }
            }
            break;
          };
        }
      }
      function get(id){
        if(client[id].chat && clientMess[client[id].chat].mess.length){
          let r = clientMess[client[id].chat].mess;
          clientMess[client[id].chat].mess = [];
          return r;
        }
      }
      function rm(id){
        delete clientMess[id];
      }

      return {
        add: add,
        get: get,
        rm: rm
      }
    }.bind(this))()
    if(USERS && config.DB.DEV) this.devs = {};
    if(USERS && config.DB.LB){
      this.scores = 0;
      this.highestScoreId = 0;
      USERS.query('SELECT score, id FROM wrs ORDER BY score DESC LIMIT ?',[this.scoresLimit],function(err,lead){
        if(err) throw err;
        this.scores = new Array(lead.length).fill(0).map((x,y)=>{return {id:lead[y].id,score:lead[y].score}});
        this.scores.forEach((item) => {
          if(item.id>this.highestScoreId){
            this.highestScoreId = item.id;
          }
        });
      }.bind(this));
    }
  }
  askConnection(data,ip){
    var clientId = this.clients.length;
    for(let i = 0; i<this.clients.length; i++){
      if(typeof this.clients[i] === 'undefined'){
            var clientId = i;
        break;
      }
    }
    this.clients[clientId] = 'Waiting';
    ///
    var connect = (data,ip)=>{
      /// ERR_GAMEMODE
      switch(data.gm){
        case 'ffa':
        case '2team':
        //case '4team':
        break;
        default: RT.Controller.clients[clientId]='ERR_GAMEMODE';
        return;
      }
      /////
      if(!(0 <= data.name.length <= RT.Controller.maxPseudoLength)){
        data.name = "unnamed";
      }
      /// ERR_DOUBLE_IP
      if(typeof RT.Controller.ipConnect[ip] === 'undefined'){
        RT.Controller.ipConnect[ip] = 1;
      } else {
        if(RT.Controller.ipConnect[ip]<config.MAX_IP){
          RT.Controller.ipConnect[ip]++;
        } else {
          RT.Controller.clients[clientId]='ERR_DOUBLE_IP';
          return;
        }
      }
      ///try to connect///
      for(let s of RT.Controller.server[data.gm]){
        if(!s){continue;}
        let ans = s.ask(data);
        if(!ans){
          continue;
        } else {
          RT.Controller.clients[clientId] = ans;
          return;
        }
      }
      /// ERR_SERVER_FULL
      let server = RT.Controller.newServer(data.gm);
      let serverAns = server.ask(data);
      RT.Controller.clients[clientId]=serverAns;
    }
    ///
    if(USERS && config.DB.ACC){
      USERS.query('SELECT * FROM acc WHERE userKey = ?',[data.key],function(err,user,fields){
        /// ERR_BROKEN_KEY
        var brokenKey = 0;
        if(!user || !user.length){
          if(config.KEY_ISNEEDED){
            RT.Controller.clients[clientId]='ERR_BROKEN_KEY';
            return;
          } else {
            brokenKey = 1;
          }
        }
        ///check pet///
        if(!brokenKey){
          try {
            user[0].userData = JSON.parse(user[0].userData);
            if(!user[0].userData.own.pets[data.pet]) data.pet = -1;
          } catch {
            data.pet = -1
          }
        } else {
          data.pet = -1;
        }
        ///
        connect(data,ip);
        ///
      });
    } else {
      connect(data,ip)
    }
    return clientId;
  }
  command(id,com){
    if(!USERS || !config.DB.DEV) return;
    if(!com.length || typeof this.clients[id] !== 'object'){return;}
    com = com.split(" ");
    if(com[0] == 'disconnect'){
      if(this.clients[id].dev){
        //delete this.devs[this.clients[id].dev];
        this.clients[id].dev = 0;
        return 'disconnected successfully';
      }
    }
    if(com[0] == 'connect'){
      if(com[1] && /*!this.devs[com[1]] &&*/ !this.clients[id].dev){
        USERS.query('SELECT * FROM devs WHERE password = ?',[com[1]],function(err,result,fields){
          if(err){throw err;}
          if(result.length){
            this.devs[result[0].password] = result[0].level;
            this.clients[id].dev = result[0].password;
            let p = RT.Controller.getPlayer(this.clients[id])
          }
        }.bind(this))
      }
      return;
    };
    ///
    if(this.clients[id].dev && this.devs[this.clients[id].dev]){
      let p = RT.Controller.getPlayer(id);
      switch(this.devs[this.clients[id].dev]){
        case 3:{
          if(com[0] == 'player' && !isNaN(parseInt(com[1]))){
            p = this.server[this.clients[id].GM][this.clients[id].sId].INSTANCE.players[parseInt(com[1])];
            if(!p){
              return 'Can not find the player id';
            }
            com.splice(0,2);
          }
          if(com[0] == 'obj' && !isNaN(parseInt(com[1]))){
            p = this.server[this.clients[id].GM][this.clients[id].sId].INSTANCE.objs[parseInt(com[1])];
            if(!p){
              return 'Can not find the obj id';
            }
            com.splice(0,2);
          }
          switch(com[0]){
            case 'setXp-2':{
              if(!p.dev) return;
              let xp = parseInt(com[1]);
              if(isNaN(xp)){break;}
              if(xp>=0){
                p.xp = xp;
                return 'xp set to "'+xp+'"';
              }
              break;
            };
            case 'invisible':{
              if(!p.dev){return;}
              p.dev.invisible = (com[1] == 'on') ? 1 : (com[1] == 'off') ? 0 : p.dev.invisible;
              if(p.dev.invisible){
                p.alpha = 0;
              } else {
                p.alpha = 1;
              }
              return 'mode invisible '+((!p.dev.invisible) ? 'activated' : 'deactivated');
              break;
            };
            case 'collision':{
              if(!p.dev) return;
              p.dev.ghost = (com[1] == 'on') ? 0 : (com[1] == 'off') ? 1 : p.dev.ghost;
              return 'collision '+((!p.dev.ghost) ? 'activated' : 'deactivated');
              break;
            };
            case 'mess':{
              if(!p.dev) return;
              com.shift();
              let c = com.join(' ');
              if(c.length && !p.bot){
                p.mess.push(c);
                return `message sent : "${c}"`;
              }
              return;
              break;
            };
            case 'broadcast':{
              com.shift();
              let c = com.join(' ');
              if(c.length){
                for(let i of this.server[this.clients[id].GM][this.clients[id].sId].INSTANCE.players){
                  if(i && isNaN(i) && !i.bot){
                    i.mess.push(c);
                  }
                }
                return `broadcast sent : "${c}"`;
              }
            };
            case 'resetLevel':{
              if(!p.dev) return;
              p.stillLvl = 0;
              p.level = 0;
              return 'level reseted';
            };
            case 'mapResize':{
              if(!isNaN(com[1]) && !isNaN(com[2])){
                this.server[this.clients[id].GM][this.clients[id].sId].newMap = {
                  width: parseInt(com[1]),
                  height: parseInt(com[2])
                }
                return `Map resized to w: ${parseInt(com[1])} h: ${parseInt(com[2])}`;
              }
              break;
            };
            case 'stick':{
              if(!p.dev) return;
              let s = this.server[p.id.GM][p.id.sId].INSTANCE;
              if(s[com[1]] && s[com[1]][com[2]] && isNaN(s[com[1]][com[2]])){
                p.dev.stick = [
                  com[1],
                  com[2]
                ];
                return `obj sticked ${com[1]} ${com[2]}`;
              }
              return "can't find the entity."
              break;
            };
            case 'destick':{
              if(!p.dev) return;
              p.dev.stick = null;
              break;
            };
            case 'summonRandBoss':{
              this.server[p.id.GM][p.id.sId].createBoss();
            };
          }
        };
        case 2:{
          switch(com[0]){
            case 'color':{
              if(!p.dev) return;
              switch(com[1]){
                case '0':case '1':case'2':case '3': case'4':case'5':case'6':case'7':case '8':{
                  p.dev.color = parseInt(com[1])+1;
                  return 'color changed for "'+com[1]+'"';
                }
              }
              break;
            };
            case 'resetColor':{
              if(!p.dev) return;
              p.dev.color = 0;
              return 'color reseted';
              break;
            };
            case 'shield':{
              if(!p.dev) return;
              let s = parseInt(com[1]);
              if(isNaN(s)){break;}
              if(s<=6000 && s>10){
                p.shield = s;
                return 'shield activated for "'+s+'" ms'
              }
              break;
            };
            case 'size':{
              let s = parseInt(com[1]);
              if(isNaN(s)){break;}
              if(s<91 && s>-10){
                if(!p.dev){
                  p.size = s;
                } else {
                  p.dev.size = s;
                }
                return 'size set to "'+s+'"';
              }
              break;
            };
            case 'getBots':{
              let mes = [];
              for(let i of this.server[this.clients[id].GM][this.clients[id].sId].INSTANCE.players){
                if(i && i.bot){
                  let m = '', id = i.id.oId.toString(), name = i.name.replace(/([^a-z0-9]+)/gi, '-');
                  m += `id: ${id}`+(' '.repeat(4-id.length));
                  m += `name: ${name} `+(' '.repeat(17-name.length));
                  m += `score: ${i.xp}`;
                  mes.push(m);
                }
              }
              return mes;
              break;
            };
            case 'getPlayers':{
              let mes = [];
              for(let i of this.server[this.clients[id].GM][this.clients[id].sId].INSTANCE.players){
                if(i && !i.bot){
                  let m = '', id = i.id.oId.toString(), name = i.name.replace(/([^a-z0-9]+)/gi, '-');
                  m += `id: ${id}`+(' '.repeat(4-id.length));
                  m += `name: ${name} `+(' '.repeat(17-name.length));
                  m += `score: ${i.xp}`;
                  mes.push(m);
                }
              }
              return mes;
              break;
            };
            case 'getPos':{
              return `x: ${parseInt(p.x)} y: ${parseInt(p.y)}`;
            };
            case 'getObj':{
              let mes = [];
              let dis = (x,y) => {
                return Math.sqrt(x*x+y*y);
              }
              for(let i of this.server[this.clients[id].GM][this.clients[id].sId].INSTANCE.objs){
                if(typeof i === 'object' && dis(p.x+p.inputs.mouse_x-i.x,p.y+p.inputs.mouse_y-i.y)<i.size){
                  let m = '', id = i.id.oId.toString();
                  m += `id: ${id}`+(' '.repeat(5-id.length));
                  m += `type: ${i.type} `
                  mes.push(m);
                }
              }
              return mes;
              break;
            };
            case 'tp':{
              if(!isNaN(com[1]) && !isNaN(com[2])){
                p.x = parseInt(com[1]); p.y = parseInt(com[2]);
                return `Position set to x: ${parseInt(p.x)} y: ${parseInt(p.y)}`;
              }
              break;
            }
          }
        };
        case 1:{
          switch(com[0]){
            case 'setXp':{
              if(!p.dev) return;
              let xp = parseInt(com[1]);
              if(isNaN(xp)){break;}
              if(xp<=45000 && xp>=0){
                p.xp = xp;
                return 'xp set to "'+xp+'"';
              }
              break;
            };
            case 'class':{
              if(!p.dev) return;
              com.shift();
              let c = com.join(' ');
              if(CLASS[c] && p.class != c && !CLASS[c].boss){
                if(CLASS[c].boss){
                  return 'you can\'t be a boss !'
                }
                p.class = c;
                p.droneCount = 0;
                p.necro = CLASS[c].necro;
                p.shootTimer = new Array(CLASS[c].canons.length).fill(0);
                return 'class set to "'+c+'"';
              }
              break;
            };
            case 'setHp':{
              p.hp = Math.max(0,Math.min(p.maxHp,(isNaN(com[1]) ? p.maxHp : parseInt(com[1]))));
              return 'Hp set to '+(isNaN(com[1]) ? p.maxHp : parseInt(com[1]));
              break;
            };
          }
          break;
        };
      }
    }
  }
  newServer(gameMode){
    let s;
    switch(gameMode){
      case 'ffa':s = new RT.Sffa(this.server[gameMode].length);break;
      case '2team':s = new RT.S2team(this.server[gameMode].length);break;
      case '4team':s = new S4team(this.server[gameMode].length);break;
      case 'boss':s = new Sboss(this.server[gameMode].length);break;
    }
    console.log(cc.Bright+cc.BgGreen+':NEW SERVER //'+cc.Reset+' '+gameMode+':'+this.server[gameMode].length);
    this.server[gameMode].push(s);
    return s;
  }
  insertLB(name,score,tank,gm,key){
    if(!USERS || !config.DB.LB) return;
    if(this.scores && score){
      for(let i = this.scores.length-1; i>=0; i--){
        if(score>this.scores[i].score && ((i==0) ? true : score<=this.scores[i-1].score)){
          this.highestScoreId++;
          this.scores.splice(i,0,{score: score, id: this.highestScoreId});
          USERS.query('INSERT INTO wrs VALUES(NULL,?,?,?,?,?,NOW())',[name,score,tank,gm,key],function(err){if (err) throw err})
          if(this.scores.length>this.scoresLimit){
            USERS.query('DELETE FROM wrs WHERE id = ?',[this.scores[this.scores.length-1].id],function(err){if(err) throw err;})
            this.scores.pop();
          }
          break;
        } else if(score<=this.scores[i].score){
          break;
        }
      }
    }
  }
  getBuffer(id){
    let p = this.clients[id];
    if(!p){
      return 'Waiting';
    }
    return this.server[p.GM][p.sId].getBuffer(p.oId);
  }
  getUi(id){
    let p = this.clients[id];
    if(!p || typeof(p) != 'object'){
      return;
    }
    return this.server[p.GM][p.sId].getUi(p.oId);
  }
  getPlayer(id){
    if(typeof this.clients[id] !== 'object'){
      return;
    }
    let p = this.clients[id];
    return this.server[p.GM][p.sId].INSTANCE.players[p.oId];
  }
  disconnect(id,ip){
    let p = this.clients[id];
    delete this.clients[id];
    if(this.ipConnect[ip]>1){
      this.ipConnect[ip]--;
    } else {
      delete this.ipConnect[ip];
    }
    if(typeof p !== 'object'){return;}
    ///
    if(p.dev){
      //delete this.devs[p.dev];
    }
    if(p.chat){
      this.chat.rm(p.chat);
    }
    ///
    let tank =  this.server[p.GM][p.sId].INSTANCE.players[p.oId];
    if(!p.dev && isNaN(p.dev)) this.insertLB(tank.name,tank.xp,tank.class,p.GM,p.key);
    tank.state.disconnect = 1;
  }
  respawn(id){
    if(typeof this.clients[id] !== 'object'){
      return;
    }
    let p = this.clients[id];
    let tank = this.getPlayer(id);
    if(!tank) return;
    let xp = this.server[p.GM][p.sId].respawn(p.oId);
    if(xp && !p.dev && isNaN(p.dev)) this.insertLB(tank.name,tank.xp,tank.class,p.GM,p.key);
  }
}

module.exports = Main;
