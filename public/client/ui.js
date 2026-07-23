/*
  The heads-up display: minimap, stats bar, upgrade buttons, class picker, leaderboard,
  message feed, death screen - and the door animation that wipes between them.

  Run() rebuilds this every time it starts, so initUi() reads `ctx` and `User` out of the
  registry on each call rather than aliasing them at load: at load neither exists.
*/
(function(CLIENT){
  const CONST = CLIENT.CONST;
  const CLASS_TREE = CLIENT.CLASS_TREE;
  const CLASS = CLIENT.CLASS;
  const Palette = CLIENT.Palette;
  const Global = CLIENT.Global;
  const Game = CLIENT.Game;
  const General = CLIENT.General;
  const roundRect = CLIENT.roundRect;
  ///
  CLIENT.initUi = function(){
    const ctx  = General['ctx'];
    const User = CLIENT.User;
    General['Ui'] = new function(){
      this.lvl = 0;
      this.dlvl = 0;
      this.xp = 0;
      this.upNb = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
      this.lvlDim = {
        lw: 4,
        w:8,
        h:15,
        W:14,
        H:30
      }
      this.still = 0;
      this.dead = 0;
      ///
      this.MAP = (()=>{
        const can = document.createElement('CANVAS');
        const ctx = can.getContext('2d');
        const R = CONST.RESOLUTION*CONST.OFFCAN;
        const size = 150;
        const lw = 12;
        ctx.font = '700 24px Catamaran';
        const m = ctx.measureText('Obstar.io').width+20;
        can.height = can.width = (size+lw)*R+4;
        can.width+=m*R;
        //
        ctx.setTransform(R,0,0,R,2+lw/2*R,2+lw/2*R);
        ctx.font = '700 24px Catamaran';
        ctx.fillStyle =  '#eeeeee';
        ctx.strokeStyle = '#222222';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 4;
        ctx.strokeText('Obstar.io',0,12);
        ctx.fillText('Obstar.io',0,12);
        ctx.translate(m,0);
        switch(POST.gm){
          case '2team':{
            ctx.beginPath();
            roundRect(ctx,0,0,size,size,0);
            ctx.closePath();
            ctx.strokeStyle = '#222222';
            ctx.lineJoin = 'round';
            ctx.lineWidth = lw;
            ctx.stroke();
            ctx.clip();
            ctx.fillStyle = '#f4f4f4';
            ctx.fillRect(0,0,size,size);
            ctx.fillStyle = Palette.green[0];
            ctx.fillRect(0,0,size/12,size);
            ctx.fillStyle = Palette.red[0];
            ctx.fillRect(size,0,-size/12,size);
            break;
          }
          default:{
            ctx.fillStyle = '#ececec';
            ctx.beginPath();
            roundRect(ctx,0,0,size,size,0);
            ctx.closePath();
            ctx.strokeStyle = '#333333';
            ctx.lineJoin = 'round';
            ctx.lineWidth = lw;
            ctx.stroke();
            ctx.fill();
            break;
          }
        }
        return {
          size: size,
          can: can,
          lw: lw/2*R,
          cursSize: 3
        };
      })();
      this.ST = (()=>{
        const can = document.createElement('CANVAS');
        const ctx = can.getContext('2d');
        const R = CONST.RESOLUTION*CONST.OFFCAN;
        can.width = 800*R;
        can.height = 75*R;
        let offy = 0;
        {
          ctx.scale(R,R);
          const lw = 6;
          ctx.font = '700 36px Catamaran';
          ctx.lineJoin = 'round';
          ctx.lineWidth = lw;
          ctx.textBaseline = 'middle';
          ctx.strokeStyle = '#222222';
          ctx.fillStyle = '#fcfcfc';
          const m = ctx.measureText(POST.name);
          ctx.strokeText(POST.name,400-m.width/2,lw+18);
          ctx.fillText(POST.name,400-m.width/2,lw+18);
          offy = lw+34+lw
        }
        ///
        const barc = '#fbe048 ';
        const bardkc = General['color'].shade(barc,.5);
        const barMarge = 9;
        const barW = 42;
        const barH = 16;
        const barRad = 9;
        const barlw = 6;
        /// level ///
        function level(tank,score,lvl){
          ctx.clearRect(0,offy,can.width,can.height+offy);
          bar(lvl);
          score = score.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
          ctx.font = '700 18px Catamaran';
          ctx.lineWidth = 3.5;
          ctx.strokeStyle = '#222222';
          ctx.fillStyle = '#fcfcfc';
          const m = ctx.measureText(score+' '+tank);
          ctx.strokeText(score+' '+tank,400-m.width/2,5+offy+8);
          ctx.fillText(score+' '+tank,400-m.width/2,5+offy+8)
        }
        function bar(lvl){
          ctx.save();
          const fullbar = barMarge*9+barW*10;
          ctx.translate((400-fullbar/2),offy+5);
          ctx.beginPath();
          roundRect(ctx, -1, 0, fullbar+2, barH,barRad);
          ctx.closePath();
          ctx.lineWidth = barlw;
          ctx.fillStyle = ctx.strokeStyle = '#222222';
          ctx.stroke();
          ctx.fill();

          ctx.beginPath();
          for(let i = 0; i<10; i++){
            roundRect(ctx,i*(barW+barMarge),0,barW,barH,barRad);
            ctx.closePath();
          }
          ctx.clip();
          ctx.fillStyle = bardkc;
          ctx.fillRect(0,0,lvl*barW + Math.max(0,lvl-1)*barMarge,barH);
          ctx.fillStyle = barc;
          ctx.fillRect(0,0,parseInt(lvl)*barW + parseInt(Math.max(0,lvl-1))*barMarge,barH);
          ctx.restore();

        }
        return {
          lvl: bar,
          update: level,
          tank: 0,
          score: 0,
          can: can
        };
      })();
      this.UP = (()=>{
        const can = document.createElement('CANVAS');
        const ctx = can.getContext('2d');
        const R = CONST.RESOLUTION*CONST.OFFCAN;
        const W = 38;
        const h = 18;
        const marge = 5;
        const lw = 8;
        const plusRad = 15;
        const r = 9;
        ///
        let STATES;
        let NB;
        let LOGO;
        let CLASS = 0;
        ///
        function drawAll(tankClass,states,max = 6){
          if(tankClass === CLASS){
            return;
          }
          CLASS = tankClass
          STATES = {up:[],max:max};
          const w = max*(W+marge);
          can.height = ((plusRad*2+lw*2+4)*states.length)+20+18+6*4;
          can.height *= R;
          can.width  = w+plusRad*2+lw*2+4;
          can.width *= R;
          ///
          ctx.scale(R,R);
          ctx.lineJoin = 'round';
          ctx.strokeStyle = '#222222';
          ctx.fillStyle = '#fcfcfc';
          let offy = 6;
          ctx.font = '700 26px Catamaran';
          ctx.lineWidth = 4.5;
          ctx.textBaseline = 'middle';
          const logom = ctx.measureText('Enhance').width
          ctx.strokeText('Enhance',can.width/2/R-logom/2,offy+13);
          ctx.fillText('Enhance',can.width/2/R-logom/2,offy+13);
          offy += 20+6;
          LOGO = {
            sx:0,
            sy:0,
            sw:can.width,
            sh:offy*R
          };
          ///
          NB = {
            sx:0,
            sy:offy*R,
            sw:can.width,
            sh:(6+15+6)*R,
            nb: 0
          };
          setNb(0);
          offy += 18+6+6;
          offy *= R;
          let PLUSONE = 0;
          if(states.length%2){PLUSONE = 1;}
          ///
          for(let i = 0; i < states.length-PLUSONE; i++){
            STATES.up.push({
              x:(i%2 ? plusRad+lw+2 : w+plusRad+lw+2)*R,
              y:(plusRad*2+lw*2+4)/2*R,
              sx:0,
              sy:offy+((can.height-offy)/states.length)*i,
              sw:can.width,
              sh:(can.height-offy)/states.length,
              ismouse:0,
              isfull:0,
              nb:0,
              odd:i%2,
              name:states[i]
            });
            redraw(i,0,0);
          }
        };
        function redraw(state,nb,isMouse,colored = 1){
          const data = STATES.up[state]
          if(!data){return;}
          if(data.isfull && nb>=STATES.max){return;}
          if(isMouse === data.isMouse && data.nb === Math.min(nb,STATES.max) && data.isfull  === ((data.nb === STATES.max) || !colored)){return;}
          data.isMouse = isMouse;
          data.nb      = Math.min(nb,STATES.max);
          data.isfull  = (data.nb === STATES.max) || !colored;
          const w = STATES.max*(W+marge);
          ///
          ctx.setTransform(R,0,0,R,data.sx,data.sy);
          ctx.clearRect(0,0,data.sw/R,data.sh/R)
          ctx.translate(lw+2,lw+2);
          ctx.textBaseline = 'middle';
          ///
          if(data.odd){
            //right
            ///BACK
              ctx.fillStyle = ctx.strokeStyle = '#222222';
              ctx.lineWidth = lw;
              ctx.beginPath();
              roundRect(ctx,plusRad*2-r-2,plusRad-h/2,w,h,r);
              ctx.closePath();
              ctx.fill();ctx.stroke();
              /////
              ctx.fillStyle = Palette.up[state];
              for(let i = 0; i<data.nb; i++){
                ctx.beginPath();
                roundRect(ctx,plusRad*2-r + (W+marge)*i,plusRad-h/2  , W, h,r);
                ctx.closePath();
                ctx.fill();
              }
              /////
              const plusC = data.isfull ? '#a8a8a8' : isMouse ? General.color.shade(Palette.up[state],1.4) : Palette.up[state];
              ctx.beginPath();
              ctx.arc(plusRad,plusRad,plusRad,0,Math.PI*2);
              ctx.closePath();
              ctx.lineWidth = lw;
              ctx.fill();ctx.stroke();
              ctx.fillStyle = plusC;
              ctx.fill();
              /// + ///
              ctx.font = '700 40px Catamaran';
              ctx.fillStyle = General.color.shade(plusC,data.isfull ? 1.4 : 1.8);
              ctx.fillText('+',plusRad-11,plusRad);
            ///front///

            /// text ///
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#222222';
            ctx.font = '700 18px Catamaran';
            ctx.fillStyle = '#fcfcfc';
            const tw = ctx.measureText(data.name).width
            ctx.strokeText(data.name,w/2-tw/2+plusRad,plusRad);
            ctx.fillText(data.name,w/2-tw/2+plusRad,plusRad);
            ///
          } else {
            //left
            ///BACK
            ctx.fillStyle = ctx.strokeStyle = '#222222';
            ctx.lineWidth = lw;
            ctx.beginPath();
            roundRect(ctx,r+2,plusRad-h/2,w,h,r);
            ctx.closePath();
            ctx.fill();ctx.stroke();
            ///
            ctx.fillStyle = Palette.up[state];
            for(let i = 0; i<data.nb; i++){
              ctx.beginPath();
              roundRect(ctx,w+plusRad-2 - (W+marge)*(i+1),plusRad-h/2  , W, h,r);
              ctx.closePath();
              ctx.fill();
            }
            ///
            const plusC = data.isfull ? '#a8a8a8' : isMouse ? General.color.shade(Palette.up[state],1.6) : Palette.up[state];
            ctx.beginPath();
            ctx.arc(w+plusRad,plusRad,plusRad,0,Math.PI*2);
            ctx.closePath();
            ctx.lineWidth = lw;
            ctx.fill();ctx.stroke();
            ctx.fillStyle = plusC;
            ctx.fill();
            /// + ///
            ctx.font = '700 40px Catamaran';
            ctx.fillStyle = General.color.shade(plusC,1.8);
            ctx.fillText('+',w+plusRad-11,plusRad);
            ///
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#222222';
            ctx.font = '700 18px Catamaran';
            ctx.fillStyle = '#fcfcfc';
            const tw = ctx.measureText(data.name).width
            ctx.strokeText(data.name,r+2+w/2-tw/2,plusRad);
            ctx.fillText(data.name,r+2+w/2-tw/2,plusRad);
          }
          ctx.translate(0,plusRad*2+lw*2+4);
        };
        function setNb(nb){
          if(NB.nb === nb){return;}
          NB.nb = nb;
          ctx.setTransform(1,0,0,1,NB.sx,NB.sy);
          ctx.clearRect(0,0,NB.sw,NB.sh);
          ctx.scale(R,R);
          ctx.strokeStyle = '#222222';
          ctx.fillStyle = '#fcfcfc';
          ctx.font = '700 20px Catamaran';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 3.5;
          const nbm = ctx.measureText('x'+nb).width;
          ctx.beginPath();
          roundRect(ctx,NB.sw/2/R-nbm/2-5,2,nbm+10,24,4);
          ctx.closePath();
          ctx.fillStyle = '#222222';
          ctx.fill();
          //ctx.strokeText('x'+nb,NB.sw/2/R-nbm/2,6);
          ctx.fillStyle = '#fcfcfc';
          ctx.fillText('x'+nb,NB.sw/2/R-nbm/2,15);
        }
        ///

        drawAll(
          'Basic',
          ['Health Regen',
          'Reload',
          'Max Health',
          'Bullet Speed',
          'Movement Speed',
          'Bullet Damage',
          'Body Damage',
          'Bullet Penetration'],6);
        ///
        return {
          can: can,
          logo:LOGO,
          nb:NB,
          setNb: setNb,
          up: STATES.up,
          redraw: redraw,
          init: drawAll,
          show: 0,
          isShowing: 0,
          isMouse:   0,
          speed: .03
        }
      })();
      this.TNK = (()=>{
        const ALL = {
          actual: [],
          show: 0,
          dshow: 0,
          mDown: -50*CONST.RESOLUTION,
          mRight: -60*CONST.RESOLUTION,
          class: 0,
          classLvl:  0,
          choices: [],
          actualClass: 0
        };
        const R = CONST.RESOLUTION*CONST.OFFCAN;
        const size = 100;
        const tankS = 1.6;
        const lw    = 4.5;
        const inLw  = 9;
        const round = 4;
        const fnt = 18;
        {
          const thislw = 4.5;
          ALL.logo = document.createElement('CANVAS');
          const ctx = ALL.logo.getContext('2d');
          ctx.font = '700 30px Catamaran';
          let m = ctx.measureText('Upgrade').width;
          ALL.logo.width = (m+thislw*2)*R;
          ALL.logo.height = (30+18+thislw*4)*R;
          ctx.setTransform(R,0,0,R,ALL.logo.width/2,0);
          ctx.font = '700 30px Catamaran';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#f4f4f4';
          ctx.lineWidth = thislw;
          ctx.lineJoin = 'round';
          ctx.strokeStyle = '#222222';
          ctx.strokeText('Upgrade',-m/2,thislw+15);
          ctx.fillText('Upgrade',-m/2,thislw+15);
          ctx.translate(0,30+thislw);
          ctx.font = '700 18px Catamaran';
          ctx.fillStyle = '#222222';
          m = ctx.measureText('hide').width;
          ctx.beginPath();
          roundRect(ctx,-m/2-thislw,thislw,m+thislw*2,18+thislw,3);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#f4f4f4';
          ctx.fillText('hide',-m/2,thislw+3+18/2)
          ALL.hideWidth = (m+thislw+thislw)*R;
          ALL.hideHeight = (15+thislw*2)*R
        }
        ///
        function mouseOn(c,is){
          if(ALL.Class[c].is !== is){
            ALL.Class[c].is = is;
            const ctx = ALL.Class[c].can.getContext('2d');
            ctx.setTransform(R,0,0,R,0,0);
            ctx.translate(2+lw,2+lw);
            ctx.beginPath();
            roundRect(ctx,0,0,size,size,round);
            ctx.closePath();
            ctx.fillStyle = is ? General.color.shade(Palette.class[ALL.Class[c].id],1.3) : Palette.class[ALL.Class[c].id];
            ctx.fill();
            ctx.lineJoin = 'round';
            ctx.lineWidth = lw;
            ctx.strokeStyle = General.color.shade(ctx.fillStyle,0.6);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(size/2,size/2,size/2-lw/2,0,Math.PI*2);
            ctx.closePath();
            ctx.fillStyle = General.color.shade(ctx.fillStyle,1.1);
            ctx.fill();
            ctx.translate(0,size+lw+2);
          }
        }
        function setClass(classes){
          let same = 1;
          if(classes.length === ALL.actual.length){
            for(let i = 0; i < classes.length; i++){
              if(ALL.actual[i] !== classes[i]){
                same = 0;
                break;
              }
            }
          } else {
            same = 0;
          }
          if(same){return;}
          ALL.actual = classes;
          ALL.Class = {};
          ALL.size = (size+4+lw*2)*R;
          for(const i in classes){
            const n = classes[i];
            const tank = {
              id: i
            };
            ALL.Class[n] = tank;
            const can = document.createElement('CANVAS');
            const ctx = can.getContext('2d');
            tank.can = can;
            tank.img = document.createElement('CANVAS');
            can.width = size+4+lw*2;
            can.width *= R;
            can.height = can.width*2+2+fnt+2;
            can.height *= R;
            tank.img.width = tank.img.height = (size+lw*2+4)*R;
            ///BACKGROUND
            {
              mouseOn(n,0);
            }
            ///TANK
            {
              ctx.save();
              ctx.translate(0,2+lw);
              ctx.beginPath();
              ctx.rect(0,0,size,size);
              ctx.closePath();
              ctx.clip();
              const img = General['drawTank'](ctx,0,
                {
                 class: classes[i],
                 tankC: Palette.green,
                 canC: Palette.gray,
                 size: 28,
                 dir: 0,
                 recoils: [],
                 canDir: []
               }
              );
              ctx.drawImage(
                img.can,
                size/2-img.can.width/2/tankS-img.mX/tankS,
                size/2-img.can.height/2/tankS-img.mY/tankS,
                img.can.width/tankS,
                img.can.height/tankS
              );
              ctx.restore();
              ctx.translate(0,size+lw+2);
            }
            ///NAME
            {
              ctx.translate(0,2+lw+2);
              ctx.font = `700 ${fnt}px Catamaran`;
              ctx.textBaseline = 'middle';
              ctx.lineWidth = 3.5;
              const m = ctx.measureText(n).width;
              ctx.fillStyle = '#f4f4f4';
              ctx.strokeStyle = '#222222';
              ctx.strokeText(n,size/2-m/2,fnt/2);
              ctx.fillText(n,size/2-m/2,fnt/2);
            }
            ALL.Class[n] = tank;
          }
        };
        function getImage(c){
          const tank = ALL.Class[c]
          const ctx = tank.img.getContext('2d');
          ctx.clearRect(0,0,tank.img.width,tank.img.height);
          //ctx.strokeRect(0,0,tank.img.width,tank.img.height);
          ctx.drawImage(
            tank.can,
            0,0,
            tank.can.width,tank.can.width,
            0,0,
            tank.can.width,tank.can.width,
          );
          ///
          ctx.save();
          ctx.translate(tank.can.width/2,tank.can.width/2);
          ctx.rotate(Game.timestamp/130);
          ctx.drawImage(
            tank.can,
            0,tank.can.width,
            tank.can.width,tank.can.width,
            -tank.can.width/2,-tank.can.width/2,
            tank.can.width,tank.can.width
          );
          ctx.restore();
          ///
          ctx.drawImage(
            tank.can,
            0,tank.can.width*2,
            tank.can.width,tank.can.height-tank.can.width*2,
            0,tank.can.width-(2+lw+fnt)*R-6,
            tank.can.width,tank.can.height-tank.can.width*2,
          );
          return tank.img;
        }
        ///
        ALL.getImage = getImage;
        ALL.mouseOn  = mouseOn;
        ALL.setClass = setClass;
        ///
        setClass(['Cyclone','Basic','Sniper']);
        ///
        return ALL;
      })();
      this.LB = (()=>{
        const can = document.createElement('CANVAS');
        const ctx = can.getContext('2d');
        const R = CONST.RESOLUTION*CONST.OFFCAN;
        const w = 240;
        const h = 16;
        const lw = 5;
        const marge = 16;
        const ext = [
          '',
          'k',
          'M',
          'Md'
        ];
        const textS = 18;
        const font = '700 '+textS+'px Catamaran';
        const logo = 30;
        ///
        can.width = (lw+w)*R+4;
        can.height = (logo+marge+(marge+h)*10)*R+4;
        {
          ctx.setTransform(R,0,0,R,can.width/2,2);
          ctx.font = '700 '+logo+'px Catamaran';
          const m = ctx.measureText('Leaderboard').width;
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 4.5;
          ctx.fillStyle = '#f4f4f4';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = '#222222';
          ctx.strokeText('Leaderboard',-m/2,logo/2);
          ctx.fillText('Leaderboard',-m/2,logo/2);
        }
        ///
        const ALL = {
          leads: {}
        }
        ///
        function draw(all){
          ctx.setTransform(R,0,0,R,2,2)
          ctx.translate(lw/2,logo-marge);
          ctx.clearRect(-lw,marge,can.width,can.height);
          for(let i = 0; i < all.length; i++){
            const one = all[i];
            const zeros = one.xp ? parseInt(Math.log10(one.xp)/3) : 0;
            const text = one.name+' - '+parseInt(one.xp/Math.pow(10,zeros*3)*10)/10+' '+ext[zeros];
            if(!ALL.leads[text]){
              ALL.leads[text] = addText(text);
            } else {
              ALL.leads[text].last = 2;
            };
            ///
            ctx.translate(0,h+marge);
            ctx.beginPath();
            roundRect(ctx,0,0,w,h,h/2+1);
            ctx.closePath();
            ctx.fillStyle = ctx.strokeStyle = '#181818';
            ctx.lineWidth = lw;
            ctx.fill();
            ctx.stroke();
            ///
            ctx.beginPath();
            roundRect(ctx,0,0,h+(w-h)*((one.xp+1)/(all[0].xp+1)),h,h/2+1);
            ctx.closePath();
            ctx.fillStyle  = Palette[one.team][0];
            ctx.fill();
            ///
            ctx.drawImage(ALL.leads[text].can,0,-3,ALL.leads[text].can.width/R,ALL.leads[text].can.height/R);
          };
          ///
          for(const i in ALL.leads){
            if(ALL.leads[i].last){
              ALL.leads[i].last--;
            } else {
              delete ALL.leads[i];
            }
          }
        };
        function addText(text){
          const can = document.createElement('CANVAS');
          const ctx = can.getContext('2d');
          can.height = (textS+lw)*R;
          can.width  = (w+lw)*R;
          ///
          ctx.scale(R,R);
          ctx.translate(lw/2,lw/2);
          ctx.font = font;
          ctx.textBaseline = 'middle';
          ctx.lineJoin = 'round';
          ctx.lineWidth = 3.5;
          ctx.fillStyle = '#f4f4f4';
          ctx.strokeStyle = '#222222';
          const m = ctx.measureText(text).width;
          if(m>=w){
            ctx.translate(w-m,0);
          } else {
            ctx.translate(w/2-m/2,0);
          }
          ctx.strokeText(text,0,textS/2);
          ctx.fillText(text,0,textS/2);
          ///
          return {
            can: can,
            last: 2
          };
        }
        //draw([]);
        ///
        return {
          set: draw,
          can: can
        };
      })();
      this.END = (()=>{
        ///
        const xpS = 50;
        const nameS = 22;
        const marge = 30;
        const lw = 6;
        const fill = '#f0f0f0';
        const stroke = '#333333';
        let is = 0;
        const ALL = {
          offy: 0
        };
        ///
        function set(dead,name,xp,tank){
          if(dead && !is){
            is = dead;
            ALL.title = setTitle(name,xp);
            ALL.tank = setTank(tank);
          } else if(Math.abs(dead-ALL.offy)>0.01){
            ALL.offy += (dead-ALL.offy)*((dead<ALL.offy) ? 0.1 : 0.03);
          } else {
            is = dead;
            ALL.offy = dead;
          }
        };
        function setTitle(name,xp){
          const can = document.createElement('CANVAS');
          const ctx = can.getContext('2d');
          const R = CONST.RESOLUTION*CONST.OFFCAN;
          const font = '700 '
          const text = 'score: '+xp.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
          ctx.font = '700 '+xpS+'px Catamaran';
          let m = ctx.measureText(text).width;
          can.width = m*R+lw*R+4;
          can.height = (xpS + nameS*2)*R+4;
          ///
          ctx.setTransform(R,0,0,R,can.width/2,0);
          ctx.font = '700 '+xpS+'px Catamaran';
          ctx.textBaseline = 'middle';
          ctx.lineJoin = 'round';
          ctx.lineWidth = lw;
          ctx.fillStyle = fill;
          ctx.strokeStyle = stroke;
          ctx.strokeText(text,-m/2,nameS*2+xpS/2);
          ctx.fillText(text,-m/2,nameS*2+xpS/2);
          ///
          ctx.font = '700 '+nameS+'px Catamaran';
          m = ctx.measureText(name).width;
          ctx.lineWidth = 3.5;
          ctx.strokeText(name,-m/2,nameS);
          ctx.fillText(name,-m/2,nameS);
          ///
          return can;
        };
        function setTank(tank){
          const can = document.createElement('CANVAS');
          const ctx = can.getContext('2d');
          const R = CONST.RESOLUTION*CONST.OFFCAN;
          const img = General['drawTank'](ctx,0,
            {
             class: tank,
             tankC: Palette.green,
             canC: Palette.gray,
             size: 35,
             dir: 0,
             recoils: [],
             canDir: []
           }
          );
          can.width = img.can.width;
          can.height = img.can.height;
          ctx.save();
          ctx.translate(img.can.width/2-img.mX,img.can.height/2-img.mY);
          ctx.rotate(-Math.PI/8);
          ctx.drawImage(img.can,-img.can.width/2,-img.can.height/2);
          ctx.restore();
          ///
          ctx.font = '700 '+parseInt(20*R)+'px Catamaran';
          const m = ctx.measureText(tank).width;
          ctx.textBaseline = 'middle';
          ctx.lineJoin = 'round';
          ctx.lineWidth = 4;
          ctx.fillStyle = fill;
          ctx.strokeStyle = stroke;
          ctx.strokeText(tank,img.can.width/2-m/2,img.can.height-parseInt(20*R)/2);
          ctx.fillText(tank,img.can.width/2-m/2,img.can.height-parseInt(20*R)/2);
          return can;
        };
        function setEnter(){
          const can = document.createElement('CANVAS');
          const ctx = can.getContext('2d');
          const R = CONST.RESOLUTION*CONST.OFFCAN;
          const text = 'Press enter to respawn.';
          ctx.font = '700 '+nameS+'px Catamaran';
          const m = ctx.measureText(text).width;
          can.width = (m+lw)*R+4;
          can.height = (nameS+lw)*R+4;
          ///
          ctx.setTransform(R,0,0,R,can.width/2,0);
          ctx.font = '700 '+nameS+'px Catamaran';
          ctx.textBaseline = 'middle';
          ctx.lineJoin = 'round';
          ctx.lineWidth = 3;
          ctx.fillStyle = fill;
          ctx.strokeStyle = stroke;
          ctx.strokeText(text,-m/2,nameS/2);
          ctx.fillText(text,-m/2,nameS/2);
          return can;
        };
        ALL.set = set;
        ALL.enter = setEnter();
        ///
        return ALL;
      })()
      this.MES = (()=>{
        const R = CONST.RESOLUTION*CONST.OFFCAN;
        const M = [
        ];
        const startA = 6;
        const dimA   = .02;
        const fSize = 25;
        const mH = 25;
        const mV = 4;
        const font = '600 '+fSize+'px Catamaran';
        function add(message){
          for(let mes of message){
            if(mes[0] === '/' && mes[1] === 'i' && mes[2] === 'm' && mes[3] === 'g'){
              mes = mes.split(' ');
              const _img = document.createElement('IMG');
              const newImg = new Image;
              newImg.onload = function(){
                  _img.src = this.src;
                  M.unshift({
                    can:_img,
                    a: startA,
                    da: 0.02,
                    img: 1
                  });
              }
              newImg.src = './pic/img_mess/'+mes[1];
              continue;
            }
            const can = document.createElement('CANVAS');
            const ctx = can.getContext('2d');
            ctx.font = font;
            const m = ctx.measureText(mes).width;
            can.width = (m+mH)*R;
            can.height = (fSize+mV*2)*R;
            ////
            ctx.fillStyle = '#000000';
            ctx.fillRect(0,0,can.width,can.height);
            ctx.setTransform(R,0,0,R,can.width/2,mV*R);
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#ffffff';
            ctx.font = font;
            ctx.fillText(mes,-m/2,fSize/2);
            ////
            M.unshift({
              can:can,
              a: startA,
              da: 0.02
            })
          }
        }
        add(['set']);
        M[0].a = 0.1;
        function update(){
          for(const i in M){
            M[i].da += (Math.min(1,M[i].a)-M[i].da)*0.1;
            if(M[i].da<0.01){
              M.splice(i,1);
              continue;
            }
            M[i].a -= dimA;
          }
        }
        return {
          mes: M,
          update: update,
          add: add
        };
      })();
      /////
      this.map         = function(){
        ctx.setTransform(Global.UIRATIO,0 ,0 ,Global.UIRATIO, Global.canW,0);
        ctx.translate(-15,15);
        ctx.scale(1/CONST.OFFCAN/CONST.RESOLUTION,1/CONST.OFFCAN/CONST.RESOLUTION);
        ctx.drawImage(this.MAP.can,-this.MAP.can.width+2,-2);

        ctx.translate(-this.MAP.lw,this.MAP.lw)
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#222222';
        ctx.scale(CONST.OFFCAN*CONST.RESOLUTION,CONST.OFFCAN*CONST.RESOLUTION);
        ctx.beginPath();
        ctx.arc(-this.MAP.size/2+(User.x/Game.width)*this.MAP.size,
                 this.MAP.size/2+(User.y/Game.height)*this.MAP.size, this.MAP.cursSize, 0, Math.PI*2)
        ctx.closePath();
        ctx.fill();
      };
      this.states      = function(){
        this.dlvl += (this.lvl-this.dlvl)*0.05;
        ///
        if(this.ST.tank !== User.class || this.ST.score !== this.xp || this.dlvl!==this.ST.dlvl){
          this.ST.tank = User.class;
          this.ST.score = this.xp;
          this.ST.dlvl = this.dlvl;
          this.ST.update(User.class,this.xp,this.dlvl%10+0.1);
        }
        ctx.save();
        ctx.setTransform(Global.UIRATIO,0 ,0 ,Global.UIRATIO, Global.canW/2, Global.canH);
        ctx.scale(1/CONST.OFFCAN/CONST.RESOLUTION,1/CONST.OFFCAN/CONST.RESOLUTION)
        ctx.drawImage(this.ST.can,-this.ST.can.width/2,-this.ST.can.height-18);
        ctx.restore();
        //ctx.globalAlpha = 1;
      };
      this.upgrade     = function(){
        if(!this.still){
          this.UP.isShowing = 0;
        } else {
          this.UP.setNb(this.still);
        }
        ///
        if(this.UP.isShowing || Global.inputs.u || parseInt(this.END.offy+.1)){
          this.UP.show = Math.min(this.dead ? 1 : 1.8,this.UP.show+(this.dead ? this.UP.speed*.6 : this.UP.speed));
        } else {
          this.UP.show = Math.max(0,this.UP.show-this.UP.speed);
        }
        if(!this.still && !Global.inputs.u && !this.UP.show && !parseInt(this.END.offy+.1)){return;}
        ///
        this.UP.init(User.class,CLASS[User.class].ups ? CLASS[User.class].ups : TanksConfig.defaultUps,6);
        ///
        const SHOW = Math.min(General['ease-in-out'](this.UP.show,3),1);
        const ALPHA = ctx.globalAlpha;
        ctx.setTransform(Global.UIRATIO,0,0,Global.UIRATIO,Global.canW/2+User.predic.x,Global.canH/2+User.predic.y);
        ctx.scale(1/CONST.OFFCAN/CONST.RESOLUTION,1/CONST.OFFCAN/CONST.RESOLUTION)
        ///
        if(SHOW){
          ctx.globalAlpha = ALPHA*SHOW;
          let n = 0;
          const dis = Math.PI/this.UP.up.length*1;
          if(this.still){
            ctx.drawImage(this.UP.can,
              this.UP.logo.sx,//sx
              this.UP.logo.sy,//sy
              this.UP.logo.sw,//sw
              this.UP.logo.sh,//sh
              -this.UP.logo.sw/2,
              -this.UP.logo.sh/2-92*SHOW*CONST.RESOLUTION*CONST.RESOLUTION*CONST.OFFCAN,
              this.UP.logo.sw,//w
              this.UP.logo.sh,//h
            );
          }
          for(const i in this.UP.up){
            const up = this.UP.up[i];
            if(!up.odd){n++;}
            const angle = (-dis*this.UP.up.length/Math.PI)+(n*dis*SHOW)
            const offx = Math.cos(angle)*120*CONST.RESOLUTION*CONST.OFFCAN;
            const offy = Math.sin(angle)*120*CONST.RESOLUTION*CONST.OFFCAN;
            const j = General.isMouseCirc(
              (Global.canW/2+User.predic.x+(up.odd ? offx : -offx)/CONST.OFFCAN/CONST.RESOLUTION*Global.UIRATIO)/CONST.RESOLUTION,
              (Global.canH/2+User.predic.y+offy/CONST.OFFCAN*Global.UIRATIO/CONST.RESOLUTION)/CONST.RESOLUTION,
              12*Global.UIRATIO
            );
            if(j){Global.mouse_out = CONST.MOUSE_OUT;}
            if(j && Global.inputs.mouseL){
              if(!up.press){
                General['WS'].send(PROTO.encode('upgrade',CONST.UP_ORDER[i]));
                up.press = 1;
              }
            } else {
              if(!Global.inputs.mouseL){
                up.press = 0;
              } else {
                up.press = 1;
              }
            }
            this.UP.redraw(i,this.upNb[CONST.UP_ORDER[i]],j,this.still)
            ctx.drawImage(this.UP.can,
              up.sx,//sx
              up.sy,//sy
              up.sw,//sw
              up.sh,//sh
              (up.odd ? offx*SHOW : -offx*SHOW) -up.x,//x
              offy*SHOW -up.y,//y
              up.sw,//w
              up.sh,//h
            );
          }
        }
        ///
        if(this.still){
          ctx.globalAlpha = ALPHA;
          ctx.drawImage(this.UP.can,
            this.UP.nb.sx,//sx
            this.UP.nb.sy,//sy
            this.UP.nb.sw,//sw
            this.UP.nb.sh,//sh
            0-this.UP.nb.sw/2,//x
            Math.sin(Game.timestamp/18)*2-this.UP.nb.sh/2-45*Global.RATIO*CONST.RESOLUTION*CONST.RESOLUTION*CONST.OFFCAN/Global.UIRATIO,//y
            this.UP.nb.sw,//w
            this.UP.nb.sh,//h
          );
          let j = General.isMouseCirc(
            (Global.canW/2+User.predic.x)/CONST.RESOLUTION,
            (Global.canH/2+User.predic.y)/CONST.RESOLUTION-45*Global.RATIO,
            15*Global.UIRATIO
          );
          if(j){
            Global.mouse_out = CONST.MOUSE_OUT;
          }
          if((j && Global.inputs.mouseL) || Global.inputs.u){
            this.UP.isShowing = 1;
          }
          j = General.isMouseCirc(
            (Global.canW/2)/CONST.RESOLUTION,
            (Global.canH/2)/CONST.RESOLUTION,
            125*Global.UIRATIO
          );
          if(Global.inputs.mouseL && !j){
            this.UP.isShowing = 0;
            if(this.UP.show>1){this.UP.show = 1;}
          }
        }
      };
      this.tanks       = function(){
        if((this.classLvl !== this.TNK.classLvl || User.class !== this.TNK.class)){
          this.TNK.classLvl = this.classLvl;
          this.TNK.class = User.class;
          this.TNK.tochoices = [];
          for(let i = 0; i < this.classLvl; i++){
            if(CLASS_TREE[i][User.class]){
              this.TNK.tochoices = this.TNK.tochoices.concat(CLASS_TREE[i][User.class]);
            }
          }
          this.TNK.show = -.5;
          this.TNK.hide = 0;
        }
        ///
        const reverse = 1/Global.UIRATIO*CONST.OFFCAN*CONST.RESOLUTION*CONST.RESOLUTION;
        if(this.TNK.hide){
          this.TNK.show = -.5;
          const isIn = (General['isMouse'](
            (Global.winW)-(30)/reverse,
            (Global.winH)-(-this.TNK.mDown+this.TNK.size*this.TNK.choices.length)/reverse,
            (30)/reverse,
            (-this.TNK.mDown+this.TNK.size*this.TNK.choices.length)/reverse,
          ));
          if(isIn){this.TNK.show = 1; this.TNK.hide = 0}
        } else {
          const isIn = (General['isMouse'](
            (Global.winW)-(-this.TNK.mRight+this.TNK.size/2+this.TNK.hideWidth/2)/reverse,
            (Global.winH)-(this.TNK.size/2+15*reverse+this.TNK.hideHeight+this.TNK.mDown+(this.TNK.size+2)*this.TNK.choices.length)/reverse,
            (this.TNK.hideWidth)/reverse,
            (this.TNK.hideHeight)/reverse,
          ));
          if(isIn){
            Global.mouse_out = CONST.MOUSE_OUT;
          };
          if(isIn && Global.inputs.mouseL && !Global.inputs.old.mouseL){
            this.TNK.hide = 1;
          }
        }
        ///
        if(this.TNK.dshow<0.01 && this.TNK.show<=0){
          this.TNK.dshow = 0;
          this.TNK.choices = this.TNK.tochoices;
          this.TNK.setClass(this.TNK.choices);
          if(this.TNK.choices.length){
            this.TNK.show = 1;
          } else {
            this.TNK.show = -.5;
          }
          return;
        }
        if(!this.TNK.tochoices.length){
          this.TNK.show = -.5;
        }
        ctx.setTransform(Global.UIRATIO,0 ,0 ,Global.UIRATIO, Global.canW, Global.canH);
        ctx.scale(1/CONST.OFFCAN/CONST.RESOLUTION,1/CONST.OFFCAN/CONST.RESOLUTION);
        this.TNK.dshow += (this.TNK.show-this.TNK.dshow)*0.05;
        // gw holds the last choice's width for the logo placement below the loop; it was a
        // function-scoped `var` that leaked out of the loop on purpose (undefined if empty).
        let gw;
        for(const i in this.TNK.choices){
          const n = this.TNK.choices[i];
          const c = this.TNK.getImage(n);
          gw = c.width;
          const isIn = (General['isMouse'](
            (Global.winW)-(-this.TNK.mRight+c.width-5)/reverse,
            (Global.winH)-(-this.TNK.mDown+(c.height*(parseInt(i)+1)-5))/reverse,
            (c.width-20)/reverse,
            (c.height-20)/reverse,
          ) && this.TNK.show>0 && this.TNK.dshow>.8);
          if(isIn){
            Global.mouse_out = CONST.MOUSE_OUT;
            if(Global.inputs.mouseL && !Global.inputs.old.mouseL){
              this.TNK.show = -.5;
              General['WS'].send(PROTO.encode('upClass',n));
            }
          }
          this.TNK.mouseOn(n,isIn);
          ctx.drawImage(c,20+(this.TNK.mRight-c.width-20)*this.TNK.dshow,this.TNK.mDown-(c.height+2)*(parseInt(i)+1));
        };
        ctx.globalAlpha = 0.7;
        ctx.drawImage(this.TNK.logo,
          20+(this.TNK.mRight-gw/2-this.TNK.logo.width/2-20)*this.TNK.dshow,
          -gw/2-15*reverse-this.TNK.logo.height-this.TNK.mDown-(gw+2)*this.TNK.choices.length
        )
      };
      this.leaderboard = function(){
        ctx.setTransform(Global.UIRATIO,0 ,0 ,Global.UIRATIO,0,0);
        ctx.scale(1/CONST.OFFCAN/CONST.RESOLUTION,1/CONST.OFFCAN/CONST.RESOLUTION);
        if(this.isReady){
          this.LB.set(this.leaderInfo);
        }
        ctx.drawImage(this.LB.can,55*CONST.RESOLUTION,25*CONST.RESOLUTION);
      };
      this.messages    = function(){
        ctx.setTransform(Global.UIRATIO,0 ,0 ,Global.UIRATIO,Global.canW/2,25*CONST.RESOLUTION);
        ctx.scale(1/CONST.OFFCAN/CONST.RESOLUTION,1/CONST.OFFCAN/CONST.RESOLUTION);
        this.MES.update();
        let offy = 0;
        const a = ctx.globalAlpha;
        for(const m of this.MES.mes){
          if(m.img){
            ctx.globalAlpha = m.da;
            ctx.save();
            ctx.scale(CONST.RESOLUTION,CONST.RESOLUTION);
            const mot = m.a > 1 ? m.da : 1;
            ctx.drawImage(m.can,-m.can.width/2*mot,offy,m.can.width*mot,m.can.height*mot);
            offy += (m.a>1) ? ((m.can.height+10)*m.da)*CONST.RESOLUTION : (m.can.height+10)*CONST.RESOLUTION;
            ctx.globalAlpha = a;
            ctx.restore();
            continue;
          }
          ctx.globalAlpha *= m.da;
          const mot = m.a > 1 ? m.da : 1;
          ctx.drawImage(m.can,-m.can.width/2*mot,offy,m.can.width*mot,m.can.height*mot);
          offy += (m.a>1) ? (m.can.height+10)*m.da : m.can.height+10;
          ctx.globalAlpha = a;
        }
      };
      this.endScreen   = function(){
        this.END.set(this.dead,User.name,this.xp,User.class);
        if(this.END.offy){
          const invert = 1-this.END.offy
          ctx.setTransform(1,0,0,1,0,0);
          ctx.globalAlpha = this.END.offy;
          ctx.fillStyle = 'rgba(0,0,10,0.3)';
          ctx.fillRect(0,0,Global.canW,Global.canH);
          ctx.setTransform(Global.UIRATIO,0 ,0 ,Global.UIRATIO,Global.canW/2,Global.canH/2);
          ctx.scale(1/CONST.OFFCAN/CONST.RESOLUTION,1/CONST.OFFCAN/CONST.RESOLUTION);
          ctx.drawImage(this.END.title,-this.END.title.width/2,-this.END.title.height-this.END.tank.height*.8-200*invert);
          ctx.drawImage(this.END.tank,-this.END.tank.width,this.END.tank.height/2-200*invert);
          ctx.drawImage(this.END.enter,0,this.END.tank.height-this.END.enter.height/4-200*invert)
        }
      };
      ///
      this.draw = function(){
        ctx.globalAlpha = 0.25;
        this.map();
        ctx.globalAlpha = 0.7;
        this.states();
        ctx.globalAlpha = 0.8
        this.tanks();
        ctx.globalAlpha = 0.75
        this.leaderboard();
        ctx.globalAlpha = .4;
        this.messages();
        ///
        ctx.globalAlpha = .9;
        this.endScreen();
        ctx.globalAlpha = 0.7
        this.upgrade();
        this.isReady = 0;
      };
    };
    General['doors'] = new function(){
      this.close = 0;
      this.toClose = 1;
      this.update = function(){
        if(General.KICK){
          this.close = 1;
        } else {
          this.close = 0;
        }
        if(this.close === this.toClose){return;}
        this.toClose += (this.close-this.toClose)*0.04;
        if(this.toClose>.99){
          this.toClose = 1;
        }
        if(this.toClose<.001){
          this.toClose = 0;
        }
      }
      this.draw = function(){
        const Width = Global.winW*CONST.RESOLUTION;
        const Height = Global.winH*CONST.RESOLUTION;
        //////////////////////////////////////////
        ctx.beginPath();
        ctx.moveTo(0,0);
        ctx.lineTo(-50+this.toClose*(Width+60),0);
        ctx.lineTo(0,-60+this.toClose*(Height+72));
        ///
        ctx.moveTo(Width,Height);
        ctx.lineTo(Width+50-this.toClose*(Width+60),Height);
        ctx.lineTo(Width,Height+60-this.toClose*(Height+72));
        ///
        ctx.closePath();
        ctx.fillStyle = General.color.shade('#ffffff',1-(1-this.toClose)/10);
        ctx.fill();
      }
    };
  };
})(typeof(exports) === 'undefined'
    ? (window.CLIENT = window.CLIENT || {})
    : (module.exports = global.CLIENT = global.CLIENT || {}));
