/*
  The two things drawn in DOM rather than canvas: the developer console and the chat box.
  Both attach themselves to General as soon as the page parses them, which is where the
  monolith ran them too.
*/
(function(CLIENT){
  'use strict';
  const General = CLIENT.General;
  General['DEV'] = (() => {
    const dev = {
      isOn: 0,
    };
    const input = document.createElement('INPUT');
    input.onkeydown = function(e){
      switch(e.key){
        case 'ArrowUp':{
          if(curs>0){
            curs--;
            input.value = history[curs];
          }
          break;
        }
        case 'ArrowDown':{
          if(curs<history.length-1){
            curs++;
            input.value = history[curs];
          }
          break;
        }
      }
    };
    input.type = 'text';
    input.id = 'dinput';
    input.maxLength = '50';
    let history = [''], curs = 0;
    const div = document.createElement('DIV');
    div.appendChild(input);
    div.id = 'console'
    ////
    function toggle(){
      General['CHAT'].isOn ? General['CHAT'].toggle() : 0;
      if(dev.isOn){
        document.body.removeChild(div);
      } else {
        document.body.appendChild(div);
        input.focus();
      }
      dev.isOn = !dev.isOn;
    };
    dev.toggle = toggle;
    window.toggleConsole = toggle;
    ////
    function send(){
      if(input.value === 'clear'){
        div.innerHTML = '';
        div.appendChild(input);
        input.focus();
      }
      if(input.value.length){
        General['WS'].send(PROTO.encode('com',input.value))
        history[history.length-1] = input.value;
        curs = history.length;
        history.push('');
        input.value = '';
      }
    }
    dev.send = send;
    ////
    function log(arr){
      for(const data of arr){
        const log = document.createElement('DIV')
        log.innerHTML = data.replace(/ /g, '\u00a0');
        div.insertBefore(log,input);
      }
    }
    dev.log = log;
    ////
    return dev;
  })();
  General['CHAT'] = (() => {
    const chat = {
      isOn: 0,
    };
    const input = document.createElement('INPUT');
    input.type = 'text';
    input.id = 'cinput';
    input.maxLength = '100';
    const div = document.createElement('DIV');
    div.id = 'chat';
    const mess = document.createElement('DIV');
    mess.id = 'mess';
    mess.innerHTML =
    "<div style='line-height: 115%'>"+
      "<span style='opacity: 0.6;font-size:1.1em;'>Welcome to the chat!</span></br>"+
      "&nbsp;&nbsp;/join to join a chat</br>"+
      "&nbsp;&nbsp;/quit to quit the chat</br>"+
      "&nbsp;&nbsp;/name to get the chat name</br>"+
    "</div>";
    div.appendChild(mess);
    div.appendChild(input);
    ////
    function toggle(){
      if(General['DEV'].isOn){
        General['DEV'].toggle();
      }
      if(chat.isOn){
        document.body.removeChild(div);
      } else {
        document.body.appendChild(div);
        input.focus();
      }
      chat.isOn = !chat.isOn;
    };
    chat.toggle = toggle;
    ////
    function send(){
      if(input.value.length){
        General['WS'].send(PROTO.encode('chat',input.value))
        input.value = '';
      }
    }
    chat.send = send;
    ////
    function escapeHtml(html){
      const text = document.createTextNode(html);
      const p = document.createElement('p');
      p.appendChild(text);
      return p.innerHTML;
    }
    function log(arr){
      for(const data of arr){
        const log = document.createElement('DIV');
        const splited = data[0].split(' ');
        const name = splited.slice(1).join(' ');
        log.innerHTML =  data[0].length ? `<span style="color: #${splited[0]}">`+escapeHtml(name)+' : </span>' : '<span style="color:#ccc;font-weight:500">server : </span>'
        log.innerHTML += escapeHtml(data[1]);
        const doScroll = (mess.scrollTop+mess.clientHeight>=mess.scrollHeight-5);
        mess.appendChild(log,input);
        if(doScroll){
          mess.scrollTo(0,mess.scrollHeight);
        }
      }
    }
    chat.log = log;
    ////
    return chat;
  })();
})(typeof(exports) === 'undefined'
    ? (window.CLIENT = window.CLIENT || {})
    : (module.exports = global.CLIENT = global.CLIENT || {}));
