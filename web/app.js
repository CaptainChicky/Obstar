/*
  The menu site: the Express app behind http://localhost - index page, static files,
  accounts, shop purchases and leaderboard reads.

  This was obstarWeb.js, a second entry point you had to remember to start alongside the
  game. It is now a plain module: `createApp()` builds the app and opens no port, and
  server.js decides where it gets mounted. Everything below the factory line is the
  original code, unchanged apart from the indentation and `ws` being handed to play.ejs.
*/
const express      = require('express');
const cookieParser = require('cookie-parser');

const config       = require('../lib/config.js').config;

// Where the browser should point its WebSocket. Empty means "same origin as this page",
// which is the answer whenever the game and the site share a process (the default).
// A split deployment sets WS_LINK=wss://game.example.com when starting the web half.
const WS_LINK      = process.env.WS_LINK || '';

module.exports = function createApp(){
const app          = express();
const USERS = config.MYSQL ? require('mysql2').createPool(require('../lib/dbConfig.js').info) : 0;
///
let LEADERBOARD = [];
const SHOP = {HIDE:1};
const SHOPPER = {};
///
if(USERS){
  USERS.getConnection(function(err) {
    if (err) throw err;
    console.log("connect database");
  });
  if(config.DB.LB){
    const updateLB = ()=>{
      USERS.query('SELECT score, name, tank, gm, DATE_FORMAT(date, "%d-%m-%Y") AS date FROM wrs ORDER BY score DESC',function(err,leader){
        if (err) throw(err);
        LEADERBOARD = leader;
      })
    };
    updateLB();
    setInterval(updateLB,120000);
  }
  if(config.DB.SHOP){
    const updateShop = ()=>{
      USERS.query('SELECT class, id, label, price FROM shop',function(err,shop){
        if (err) throw(err);
        shop.forEach((item)=>{
          SHOP[item.class] = SHOP[item.class] || [];
          SHOP[item.class][item.id] = {
            label: item.label,
            price: item.price,
          }
        })
      })
    };
    updateShop();
    setInterval(updateShop,120000);
  } else {
    SHOP.HIDE = 1
  }
}
///
const generateKey = (()=>{
  const str = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'
  return (length)=>{
    return new Array(length).fill(0).map((x)=>{return str[parseInt(Math.random()*str.length)]}).join('');
  }
})()
const basicKey = '0'.repeat(25);
///
app.set('views', __dirname + '/../views');
app.use( express.static(__dirname+'/../public'));
// Express 5 folds body-parser into the framework: express.json / express.urlencoded are
// the same middleware body-parser exported, so the separate dependency is gone (HANDOFF 8.10).
app.use( express.json() );
app.use( express.urlencoded({ extended: true }) );
app.use( cookieParser() );


app.get('/favicon.ico', async function(req,res){res.status(404).end()});
// Express 5 upgraded to path-to-regexp v8, which rejects a bare '*' string path; a RegExp
// catch-all is the direct, syntax-independent equivalent of the old app.get('*') (HANDOFF 8.10).
app.get(/.*/, function(request, respond){
    const id = parseInt(Math.random()*1000);
    const KEY = request.cookies.obstarkey || 1;
    /// get the acc///
    if(USERS && config.DB.ACC){
      USERS.query('SELECT * FROM acc WHERE userKey LIKE ?',[KEY],function(err,result,fields){
        if(result && result.length && result[0]){ ///   THERE IS AN ACC  ///
          USERS.query("UPDATE acc SET lastConnection = NOW() WHERE userKey = ?",[KEY],function(err){if(err){throw(err)}});
          respond.cookie('obstarkey',KEY,{expires: new Date(253402300000000),sameSite:'Lax'});
          const sendData = {
            key:KEY,
            leader: LEADERBOARD,
            shop: SHOP
          };
          respond.render('index.ejs', {data:JSON.stringify(sendData)});
          return;
        } else {           /// there is no acc :-(///
          const newkey = generateKey(25);
          USERS.query("INSERT INTO acc VALUES (NULL,?,?,?,NOW(),255000)",[
            newkey,
            JSON.stringify({own:{pets:{}}}),
            request.connection.remoteAddress
          ]);
          respond.cookie('obstarkey',newkey,{expires: new Date(253402300000000),sameSite:'Lax'});
          const sendData = {
            key:newkey,
            leader: LEADERBOARD,
            shop: SHOP
          };
          respond.render('index.ejs', {data:JSON.stringify(sendData)});
          return;
        }
      });
    } else {
      const sendData = {
        key: basicKey,
        leader: LEADERBOARD,
        shop: SHOP
      };
      respond.render('index.ejs', {data:JSON.stringify(sendData)});
    }
});
app.post('/userData', function(req,res){
  if(USERS && config.DB.ACC){
    USERS.query('SELECT userData, coins FROM acc WHERE userKey = ?',[req.body.userKey],function(err,result,fields){
      if(result.length){
        const data = JSON.parse(result[0].userData);
        data.coins = result[0].coins;
        res.status(200).send(JSON.stringify(data));
      } else {
        res.status(200).send('none');
      }
    });
  } else {
    res.status(200).send('none');
  }
});
app.post('/buy',function(req,res){
  if(!USERS || !config.DB.ACC || !config.DB.SHOP){
    res.status(200).send('no obj');
    return;
  }
  if(SHOPPER[req.body.userKey]){
    res.status(200).send('already');
    return;
  } else {
    SHOPPER[req.body.userKey] = 1;
  }
  if(isNaN(parseInt(req.body.id)) || !req.body.class || !SHOP[req.body.class] || !SHOP[req.body.class][req.body.id]){
    delete SHOPPER[req.body.userKey];
    res.status(200).send('no obj');
    return;
  }
  const obj = SHOP[req.body.class][req.body.id], objC = req.body.class, objId = req.body.id;
  USERS.query('SELECT userData, coins FROM acc WHERE userKey = ?',[req.body.userKey],function(err,result,fields){
    if(result.length && result[0].userData){
      const user = JSON.parse(result[0].userData);
      ///
      if(user.own && user.own[objC] && user.own[objC][objId]){
        delete SHOPPER[req.body.userKey];
        res.status(200).send('owned');
      } else if(obj.price <= result[0].coins){
        user.own = user.own || {};
        user.own[objC] = user.own[objC] || {};
        user.own[objC][objId] = 1;
        user.coins = result[0].coins-obj.price;
        const stringUser = JSON.stringify(user);
        USERS.query("UPDATE acc SET userData = ?, coins = ? WHERE userKey = ?",[stringUser,user.coins,req.body.userKey],function(err){
          if(err) throw(err);
          delete SHOPPER[req.body.userKey];
        });
        res.status(200).send(stringUser);
      } else {
        delete SHOPPER[req.body.userKey];
        res.status(200).send('no coins');
      }
    } else {
      delete SHOPPER[req.body.userKey];
      res.status(200).send('no user');
    }
  });
})
app.post('/play',function(request, respond){
  const sendData = {
    key:request.cookies.obstarkey || basicKey,
    gm:request.body.gm || 'ffa',
    name:request.body.name || 'unnamed',
    pet:request.body.pet || -1,
    ws: WS_LINK
  }
  const pref = {
      // Was `== 'unamed'`, one 'n' short of the placeholder set two lines up, so the
      // placeholder was remembered as if it were a chosen name and came back pre-filled in
      // the menu next visit.
      name: (sendData.name === 'unnamed') ? '' : sendData.name,
      pet:  sendData.pet || -1
    }
  respond.cookie('preference',pref,{expires: new Date(253402300000000), sameSite:'Strict'});
  respond.render('play.ejs', {data:JSON.stringify(sendData)});
});

return app;
};
