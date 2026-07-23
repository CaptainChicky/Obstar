/*
  The binary wire protocol, for both ends.

  This file runs unchanged in the browser and in Node. The footer at the bottom picks a half
  by sniffing `typeof(exports)`: undefined means browser (`window.PROTO`), defined means
  server. `platform` is the only thing that varies, and it varies in exactly three places -
  the primitive read table (DataView vs Buffer), the class-name list (global `TanksConfig` vs
  `require`), and which of `exports.encode` / `exports.decode` is the "send" half.

  How a message is described, top to bottom:

    TYPE     field name -> primitive type            ('x' is a float32)
    SCHEMA   message    -> ordered list of fields    (a Players record is states, class, ...)
    CODEC    record     -> per-field value transform (an angle goes over the wire as an int16)
    LIMITS   message    -> legal packet size, and the string bounds the encoder enforces
    MSG      message    -> the framing around those fields, when it is not just [type][fields]

  Adding a field is therefore two edits (TYPE and SCHEMA) plus a CODEC entry if it is not
  stored raw - not the five hand-synchronised edits the old encoder/decoder pairs needed. The
  byte arithmetic is gone entirely: the Encoder grows itself and reports its own length, so
  there is no size expression to get wrong and no silent truncation when you do.

  The wire format is unchanged, byte for byte, from the hand-rolled version this replaced.
*/
(function(exports, platform){
  ///////////////////////////////////////////////////////////////////// primitives
  /* Byte width of every fixed-size primitive. `str`/`str8`/`arr` are length-prefixed and
     computed from the value instead - see sizeOf() and Decoder.read(). */
  const WIDTH = {
    'int8':    1,
    'uint8':   1,
    'int16':   2,
    'uint16':  2,
    'int32':   4,
    'uint32':  4,
    'float32': 4
  };
  /* Reading is the one genuinely platform-dependent thing here: the browser gets an
     ArrayBuffer it wraps in a DataView, Node gets a Buffer. Both are big-endian. */
  const decode = (platform === 'client') ?
  {
    "str":     ( dv, offset = 0 ) => {
      const length = dv.getUint8(offset)*2;
      let str = '';
      for( let i = offset+1; i<length+offset+1; i+=2){
        str += String.fromCharCode(dv.getUint16(i));
      }
      return str;
    },
    "str8":    ( dv, offset = 0 ) => {
      const length = dv.getUint8(offset);
      let str = '';
      for( let i = offset+1; i<length+offset+1; i++){
        str += String.fromCharCode(dv.getUint8(i));
      }
      return str;
    },
    "int8":    ( dv, offset = 0 ) => dv.getInt8( offset ),
    "uint8":   ( dv, offset = 0 ) => dv.getUint8( offset ),
    "int16":   ( dv, offset = 0 ) => dv.getInt16( offset ),
    "uint16":  ( dv, offset = 0 ) => dv.getUint16( offset ),
    "int32":   ( dv, offset = 0 ) => dv.getInt32( offset ),
    "uint32":  ( dv, offset = 0 ) => dv.getUint32( offset ),
    "float32": ( dv, offset = 0 ) => dv.getFloat32( offset )
  }:
  {
    "str":     ( buff, offset = 0 ) => {
      const length = buff.readUInt8(offset)*2;
      let str = '';
      for( let i = offset+1; i<length+offset+1; i+=2){
        str += String.fromCharCode(buff.readUInt16BE(i));
      }
      return str;
    },
    "str8":    ( buff, offset = 0 ) => {
      const length = buff.readUInt8(offset);
      let str = '';
      for( let i = offset+1; i<length+offset+1; i++){
        str += String.fromCharCode(buff.readUInt8(i));
      }
      return str;
    },
    "int8":    ( buff, offset = 0 ) => buff.readInt8( offset ),
    "uint8":   ( buff, offset = 0 ) => buff.readUInt8( offset ),
    "int16":   ( buff, offset = 0 ) => buff.readInt16BE( offset ),
    "uint16":  ( buff, offset = 0 ) => buff.readUInt16BE( offset ),
    "int32":   ( buff, offset = 0 ) => buff.readInt32BE( offset ),
    "uint32":  ( buff, offset = 0 ) => buff.readUInt32BE( offset ),
    "float32": ( buff, offset = 0 ) => buff.readFloatBE( offset )
  };
  /* Writing is always into a DataView, on both platforms. */
  const encode = {
    "str":     ( dv, data, offset = 0 ) => {
      const length = data.length;
      dv.setUint8( offset, length );
      for( let i = 0; i<length; i++){
        dv.setUint16( 1+offset+(i*2), data.charCodeAt(i) );
      }
    },
    "str8":    ( dv, data, offset = 0 ) => {
      const length = data.length;
      dv.setUint8( offset, length );
      for( let i = 0; i<length; i++){
        dv.setUint8( 1+offset+i, data.charCodeAt(i) );
      }
    },
    "int8":    ( dv, data, offset = 0 ) => { dv.setInt8( offset, data ); },
    "uint8":   ( dv, data, offset = 0 ) => { dv.setUint8( offset, data ); },
    "int16":   ( dv, data, offset = 0 ) => { dv.setInt16( offset, data ); },
    "uint16":  ( dv, data, offset = 0 ) => { dv.setUint16( offset, data ); },
    "int32":   ( dv, data, offset = 0 ) => { dv.setInt32( offset, data ); },
    "uint32":  ( dv, data, offset = 0 ) => { dv.setUint32( offset, data ); },
    "float32": ( dv, data, offset = 0 ) => { dv.setFloat32( offset, data ); },
    /* An already-encoded record (see the 'Instance' message) spliced in as-is. */
    "arr":     ( dv, data, offset = 0 ) => {
      for(let i = 0; i < data.length; i++){
        dv.setInt8( offset+i, data[i] );
      }
    }
  };
  /* Bytes `data` will occupy when written as `type`. */
  function sizeOf(data, type){
    switch(type){
      case 'str':  return 1 + data.length*2;
      case 'str8': return 1 + data.length;
      case 'arr':  return data.length;
      default:     return WIDTH[type];
    }
  }

  ///////////////////////////////////////////////////////////////////// field types
  const TYPE = {
    'message':'uint8',
    'gm':     'uint8',
    'key':    'str8',
    'name':   'str',
    'pet':    'int8',
    'com':    'str8',
    'chat':   'str',
    /// basic
    'init': {
      'result':   'uint8'
    },
    'kick':  {
      'reason': 'uint8'
    },
    /// inputs
    'keydown':{
      'key':'uint8'
    },
    'keyup':{
      'key':'uint8'
    },
    'mousemove': {
      'x':   'int16',
      'y':   'int16',
      'dir': 'float32'
    },
    ///
    'upgrade':{
      'up': 'uint8'
    },
    'upClass':{
      'class': 'uint8'
    },
    ///
    'GameUpdate':{
      //////////
      'head':{
        'timestamp':   'uint32',
        'width':       'float32',
        'height':      'float32',
        'screen':      'uint16',
        'xp':          'uint32',
        'level':       'float32',
        'still':       'uint8',
        'cLvl':        'uint8'
      },
      ///////////
      'CONSTRUCTOR': 'uint8',
      'ID':          'uint16',
      'Players':{
        'states':   'uint8',
        'class':    'uint8',
        'color':    'uint8',
        'x':        'float32',
        'y':        'float32',
        'vx':       'float32',
        'vy':       'float32',
        'dir':      'int16',
        'size':     'float32',
        'alpha':    'uint8',
        'hp':       'uint8',
        'xp':       'uint16',
        'name':     'str',
        'nameC':    'uint8',
        'recoil':   'uint16',
        'canDir':   'str'
      },
      'Objects':{
        'states': 'uint8',
        'shape':  'uint8',
        'hp':     'uint8',
        'x':      'float32',
        'y':      'float32',
        'size':   'float32',
        'alpha':  'uint8',
      },
      'Bullets':{
        'states': 'uint8',
        'type':   'uint8',
        'x':      'float32',
        'y':      'float32',
        'size':   'float32',
        'color':  'uint8',
        'alpha':  'uint8',
        'dir':    'int16'
      }
    },
    'UiUpdate':{
      'array': 'uint8',
      'leader':{
        'xp': 'uint32',
        'name': 'str',
        'nameC': 'uint8',
        'team': 'uint8'
      }
    },
    'UpdateUp':{
      'ups': 'uint8'
    }
  };
  /* The viewer's own tank rides in every GameUpdate ahead of the other entities. It carries
     the same fields as any other Players record except `xp`, which the head already holds
     exactly - so it is the Players list minus that one field, and always has been: the old
     encoder and decoder both spelled it as a `case 'xp': break;` in the middle of the shared
     Players loop, once each, which is the same thing said twice and easy to desynchronise. */
  TYPE.GameUpdate.User = TYPE.GameUpdate.Players;

  ///////////////////////////////////////////////////////////////////// field order
  const SCHEMA = {
    /// basic
    'init':[
      'result',
    ],
    'err': [
      'reason'
    ],
    'close': [
      'reason'
    ],
    /// inputs
    'keydown':[
      'key'
    ],
    'keyup':[
      'key'
    ],
    'mousemove': [
      'x',
      'y',
      'dir'
    ],
    ///
    'GameUpdate':{
      //////////
      'head':[
        'timestamp',
        'width',
        'height',
        'screen',
        'xp',
        'level',
        'still',
        'cLvl',
      ],
      ///////////
      'Players':[
        'states',
        'class',
        'color',
        'x',
        'y',
        'vx',
        'vy',
        'dir',
        'size',
        'alpha',
        'hp',
        'xp',
        'name',
        'nameC',
        'recoil',
        'canDir'
      ],
      'Objects':[
        'states',
        'shape',
        'hp',
        'x',
        'y',
        'size',
        'alpha',
      ],
      'Bullets':[
        'states',
        'type',
        'x',
        'y',
        'size',
        'color',
        'alpha',
        'dir'
      ]
    },
    'UiUpdate':{
      'leader':[
        'xp',
        'name',
        'nameC',
        'team'
      ]
    },
  };
  SCHEMA.GameUpdate.User = SCHEMA.GameUpdate.Players.filter(n => n !== 'xp');

  ///////////////////////////////////////////////////////////////////// enums
  const toSTRING = {
    'construc':[
      'Players',
      'Objects',
      'Bullets',
    ],
    /* Must stay index-for-index with toBUFFER.gamemode below, and cover every key in
       RT.ROOMS (lib/boot.js). It did not: '4team' encoded as 3 but decoded from index 2, so
       the server read gamemode 3 as `undefined` and answered ERR_GAMEMODE - the mode could
       never be joined. 'boss' was in neither table. */
    'gamemode':[
      'ffa',
      '2team',
      '4team',
      'boss'
    ],
    'type':    [
      'init',
      'kick',
      'keydown',
      'keyup',
      'mousemove',
      'GameUpdate',
      'ping',
      'upgrade',
      'UpdateUp',
      'upClass',
      'UiUpdate',
      'com',
      'comResponse',
      'chat',
      'chatUpdate'
    ],
    'shapes':  [
      'sqr',
      'tri',
      'pnt',
      'alphaPnt',
      'alphaSqr',
      'alphaTri',
      'bull'
    ],
    'class':   (platform === 'client') ? TanksConfig.list : require('./TanksConfig.js').list,
    'color':   [
      'green',
      'red',
      'yellow',
      'blue',
      'gray',
      'special',
      'white',
      'black',
      'lila',
      'necro'
    ],
    'reason':  [
      'ERR_GAMEMODE',
      'ERR_DOUBLE_IP',
      'ERR_BROKEN_KEY',
      'ERR_SERVER_FULL',
      'ERR_SERVER_OFF',
      'ERR_REQUESTS_DELAY',
      'ERR_PACKET_LENGTH',
      'ERR_HEARTBEATS_LOST',
      'ERR_DOUBLE_ACC',
      'ERR_PACKET_TYPE'
    ],
    'key':     [
      'a',
      'w',
      's',
      'd',
      'e',
      'c',
      'mouseL',
      'mouseR',
      'enter',
      'arrw',
      'arrs',
      'arra',
      'arrd'
    ],
    'xpExt':   [
      '',
      ' k',
      ' m',
      ' b'
    ],
  };
  const toBUFFER = {
    'construc':{
      'Players': 0,
      'Objects': 1,
      'Bullets': 2
    },
    'gamemode':{
      'ffa':   0,
      '2team': 1,
      '4team': 2,
      'boss':  3
    },
    'type':    {
      'init':       0,
      'kick':       1,
      'keydown':    2,
      'keyup':      3,
      'mousemove':  4,
      'GameUpdate': 5,
      'ping'      : 6,
      'upgrade':    7,
      'UpdateUp':   8,
      'upClass':    9,
      'UiUpdate':   10,
      'com':        11,
      'comResponse':12,
      'chat':       13,
      'chatUpdate': 14
    },
    'shapes':  {
      'sqr':    0,
      'tri':    1,
      'pnt':    2,
      'Bpnt':   3,
      'Bsqr':   4,
      'Btri':   5,
      'bull':   6
    },
    'class':   {},
    'reason':  {
      'ERR_GAMEMODE':        0,
      'ERR_DOUBLE_IP':       1,
      'ERR_BROKEN_KEY':      2,
      'ERR_SERVER_FULL':     3,
      'ERR_SERVER_OFF':      4,
      'ERR_REQUESTS_DELAY':  5,
      'ERR_PACKET_LENGTH':   6,
      'ERR_HEARTBEATS_LOST': 7,
      'ERR_DOUBLE_ACC':      8,
      'ERR_PACKET_TYPE':     9
    },
    'key':     {
      'a':         0,
      'w':         1,
      's':         2,
      'd':         3,
      'e':         4,
      'c':         5,
      'mouseL':    6,
      'mouseR':    7,
      'enter':     8,
      'arrowup':   9,
      'arrowdown': 10,
      'arrowleft': 11,
      'arrowright':12
    }
  };
  ///
  for(const i in toSTRING.class){
    toBUFFER.class[toSTRING.class[i]] = i;
  }

  ///////////////////////////////////////////////////////////////////// value transforms
  /*
    A field whose in-memory value is not the value that goes on the wire declares a codec:
    `enc` runs on the way out, `dec` on the way back, and `as` renames the field on decode.
    These are the bodies of what used to be a `switch(n)` repeated four times - twice in the
    encoder (own tank / other entities) and twice in the decoder - where a case present in
    one copy and missing from another was a silent desync.
  */
  const CODECS = {
    /* A bit array. The leading 1 keeps toString(2) from eating leading zeroes. */
    bits:   {enc: (v) => parseInt('1'+v.join(''),2),
             dec: (v) => v.toString(2).substr(1).split('').map(x=>parseInt(x))},
    klass:  {enc: (v) => toBUFFER.class[v],  dec: (v) => toSTRING.class[v]},
    color:  {enc: (v) => v,                  dec: (v) => toSTRING.color[v]},
    /* 0..2pi in an int16. */
    angle:  {enc: (v) => parseInt( (v/(Math.PI*2))*65535 ),
             dec: (v) => (v/65535)*Math.PI*2},
    /* A 0..1 ratio in a byte. */
    unit:   {enc: (v) => Math.max(Math.min(parseInt( v*255 ),255),0),
             dec: (v) => v/255},
    /* Polygon shape. Decodes under a different name than it encodes. */
    shape:  {enc: (v) => toBUFFER.shapes[v], dec: (v) => toSTRING.shapes[v], as: 'type'},
    /* Scoreboard xp as 3 significant digits + a power-of-1000 exponent; comes back as a
       display string ("12 k"), which is why the head's raw uint32 `xp` must not use this. */
    xpMag:  {enc: (v) => { const exp = v ? parseInt(Math.log10(v)/3) : 0;
                           return parseInt((v)/(Math.pow(1000,exp)))*10 + exp; },
             dec: (v) => parseInt(v/10) + toSTRING.xpExt[(v-(parseInt(v/10)*10))]},
    /* Per-barrel aim angles, packed as UTF-16 code units in a `str`. */
    angles: {enc: (v) => v.map(x => String.fromCharCode(parseInt((x+Math.PI)/(Math.PI*2)*65535))).join(''),
             dec: (v) => v.length ? v.split('').map(x=>((x.charCodeAt(0)/65535)*(Math.PI*2))-Math.PI) : []}
  };
  /* Codecs are per record, not per field name: `xp` means a raw uint32 in the GameUpdate
     head and a packed magnitude in a Players record, and the two must not be confused. */
  const CODEC = {
    'head':    {},
    'Players': {states: CODECS.bits,  class: CODECS.klass, color: CODECS.color,
                dir:    CODECS.angle, hp:    CODECS.unit,  alpha: CODECS.unit,
                xp:     CODECS.xpMag, recoil: CODECS.bits, canDir: CODECS.angles},
    'Objects': {states: CODECS.bits,  shape: CODECS.shape, hp: CODECS.unit, alpha: CODECS.unit},
    'Bullets': {states: CODECS.bits,  dir:   CODECS.angle, color: CODECS.color, alpha: CODECS.unit},
    'leader':  {team:   CODECS.color}
  };
  CODEC.User = CODEC.Players;

  ///////////////////////////////////////////////////////////////////// limits
  /*
    Every size bound the protocol enforces, in one table.

    `packet` is [min,max] bytes for an inbound message; anything outside is ERR_PACKET_LENGTH.
    `str` is the longest string the *encoder* will emit for a field, so a well-behaved client
    cannot build a packet its own server would then reject.
  */
  const LIMITS = {
    packet: {
      'init':      [25, 65],
      'ping':      [1, 1],
      'keydown':   [2, 2],
      'keyup':     [2, 2],
      'mousemove': [9, 9],
      'upgrade':   [2, 2],
      'upClass':   [2, 2],
      'chat':      [2, 202],
      'com':       [2, 52]
    },
    str: {
      'name': 16,   // Controller.maxPseudoLength; 16 chars -> a 62 byte init packet
      'chat': 100,  // -> 202 bytes
      'com':  50    // -> 52 bytes
    },
    key: 25         // the account key is exactly this long
  };
  /*
    Is `value` within [min,max]?

    This used to read `return(min<=data<=max)`, which JavaScript parses as `(min<=data)<=max`:
    a boolean coerced to 0/1 and compared against max, true for every max >= 1. Every length
    check in the protocol passed unconditionally, so nothing was ever validated. See HANDOFF §4.
  */
  function checkLength(value, min, max){
    return (min <= value && value <= max);
  }
  /*
    Cut a string to `max` UTF-16 code units - which is what the wire counts, what
    Controller.maxPseudoLength counts, and what the browser's maxlength attribute counts, so
    all three agree.

    Length is the *only* thing done to a name. Every code point is allowed through: the bot
    names in lib/botNames.js are themselves non-ASCII, and a game where you cannot type your
    own alphabet is a worse game. Nothing here is rendered as HTML - the client draws names
    with canvas fillText - so there is no markup to escape.

    The one thing a naive cut gets wrong is a surrogate pair straddling the boundary, which
    leaves a lone surrogate: it survives the wire (the codec is code-unit based) but renders
    as a replacement glyph. Emoji and anything above the BMP are pairs, so this is the common
    case for exactly the names people want, not an edge case. Drop the orphan instead.
  */
  function clamp(str, max){
    if(str.length <= max){ return str; }
    const code = str.charCodeAt(max-1);
    if(code >= 0xD800 && code <= 0xDBFF){ max -= 1; }   // high surrogate with its pair cut off
    return str.substr(0, max);
  }

  ///////////////////////////////////////////////////////////////////// cursors
  /* Thrown when a packet claims more bytes than it has. Caught by the server's decode(). */
  function PacketError(){}

  class Decoder{
    constructor(data){
      this.data   = data;
      this.view   = (platform === 'client') ? new DataView(data) : data;
      this.cursor = 0;
      this.end    = (platform === 'client') ? data.byteLength : data.length;
    }
    /* Unlike the old cursors, this one refuses to read off the end of the packet rather
       than letting DataView/Buffer throw something the caller cannot classify. */
    need(n){
      if(this.cursor + n > this.end){ throw new PacketError(); }
    }
    read(type){
      let c = WIDTH[type];
      if(c === undefined){
        this.need(1);
        const n = decode['uint8']( this.view, this.cursor );
        c = (type === 'str') ? 1+n*2 : 1+n;
      }
      this.need(c);
      this.cursor += c;
      return decode[type]( this.view, this.cursor-c );
    }
    isEnd(){
      return this.end === this.cursor;
    }
  }

  /*
    Grows to fit whatever is written into it, so no caller computes a packet size any more.
    The old Encoder took the size up front from arithmetic spelled out at each call site
    (`ENC.init(37+name.length*2+canDir.length*2)` and friends); getting it wrong truncated
    the packet silently, and getting it too large appended zero bytes that the client's
    "read instances until the buffer ends" loop then decoded as garbage entities.
  */
  class Encoder{
    constructor(size = 256){
      this.init(size);
    }
    init(size){
      this.buffer = new ArrayBuffer(size);
      this.dv     = new DataView(this.buffer);
      this.cursor = 0;
    }
    room(n){
      if(this.cursor + n <= this.buffer.byteLength){ return; }
      let size = this.buffer.byteLength || 1;
      while(size < this.cursor + n){ size *= 2; }
      const grown = new ArrayBuffer(size);
      new Uint8Array(grown).set(new Uint8Array(this.buffer));
      this.buffer = grown;
      this.dv     = new DataView(grown);
    }
    write(data, type){
      const c = sizeOf(data, type);
      this.room(c);
      encode[type](this.dv, data, this.cursor);
      this.cursor += c;
    }
    /* Exactly the bytes written, nothing after them. */
    getBuffer(){
      return this.buffer.slice(0, this.cursor);
    }
  }

  ///////////////////////////////////////////////////////////////////// schema drivers
  /* Write one record: every field of `SCHEMA[...]` in order, through `CODEC[record]`. */
  function writeFields(ENC, fields, types, codecs, src){
    for(const n of fields){
      const codec = codecs[n];
      ENC.write( codec ? codec.enc(src[n]) : src[n], types[n] );
    }
  }
  /* Read one record back into `dst`, honouring any `as` rename. */
  function readFields(DEC, fields, types, codecs, dst){
    for(const n of fields){
      const codec = codecs[n];
      const raw   = DEC.read(types[n]);
      dst[(codec && codec.as) ? codec.as : n] = codec ? codec.dec(raw) : raw;
    }
    return dst;
  }
  /* Shorthand for the GameUpdate records, whose three tables are all keyed the same way. */
  function writeRecord(ENC, record, src){
    writeFields(ENC, SCHEMA.GameUpdate[record], TYPE.GameUpdate[record], CODEC[record], src);
  }
  function readRecord(DEC, record, dst){
    return readFields(DEC, SCHEMA.GameUpdate[record], TYPE.GameUpdate[record], CODEC[record], dst);
  }

  ///////////////////////////////////////////////////////////////////// outbound messages
  /*
    Framing only. Each entry writes its payload after the leading message-type byte, which
    send() has already written; a `null` entry is a bare header (`ping`). 'Instance' is the
    one exception and is handled in send() - it is a fragment spliced into a GameUpdate, so
    it carries no type byte and comes back as an Int8Array.
  */
  const MSG = (platform === 'server') ? {
    'ping': null,
    'kick': (ENC, reason) => {
      ENC.write(toBUFFER.reason[reason], TYPE.kick.reason);
    },
    'GameUpdate': (ENC, data) => {
      writeRecord(ENC, 'head', data.head);
      writeRecord(ENC, 'User', data.main);
      for(const INST of data.instances){
        ENC.write(INST, 'arr');
      }
    },
    'UiUpdate': (ENC, data) => {
      ENC.write(data.leader.length, TYPE.UiUpdate.array);
      for(const d of data.leader){
        writeFields(ENC, SCHEMA.UiUpdate.leader, TYPE.UiUpdate.leader, CODEC.leader, d);
      }
      ENC.write(data.map.length,  TYPE.UiUpdate.array);
      ENC.write(data.mess.length, TYPE.UiUpdate.array);
      for(const m of data.mess){
        ENC.write(m, 'str');
      }
    },
    'UpdateUp': (ENC, data) => {
      ENC.write(data.length, TYPE.UpdateUp.ups);
      for(const i of data){
        ENC.write(i, TYPE.UpdateUp.ups);
      }
    },
    'chatUpdate': (ENC, data) => {
      // [author, text] pairs, flattened; the count is of strings, not of pairs.
      data = new Array(data.length*2).fill(0).map((x,i)=>data[parseInt(i/2)][i%2]);
      ENC.write(data.length, 'uint8');
      for(const i of data){
        ENC.write(i, 'str');
      }
    },
    'comResponse': (ENC, data) => {
      if(!Array.isArray(data)){
        data = [data];
      }
      ENC.write(data.length, 'uint8');
      for(const i of data){
        ENC.write(i, 'str8');
      }
    }
  } : {
    'init': (ENC, data) => {
      ENC.write(data.key, TYPE.key);
      ENC.write(toBUFFER.gamemode[data.gm], TYPE.gm);
      ENC.write(clamp(data.name, LIMITS.str.name), TYPE.name);
      ENC.write(parseInt(data.pet), TYPE.pet);
    },
    'ping': null,
    'keydown': (ENC, data) => { ENC.write(toBUFFER.key[data], TYPE.keydown.key); },
    'keyup':   (ENC, data) => { ENC.write(toBUFFER.key[data], TYPE.keyup.key); },
    'mousemove': (ENC, data) => {
      ENC.write(parseInt(data.x*65535), TYPE.mousemove.x);
      ENC.write(parseInt(data.y*65535), TYPE.mousemove.y);
      ENC.write(data.dir, TYPE.mousemove.dir);
    },
    'upgrade': (ENC, data) => { ENC.write(data, TYPE.upgrade.up); },
    'upClass': (ENC, data) => { ENC.write(toBUFFER.class[data], TYPE.upClass.class); },
    'chat':    (ENC, data) => { ENC.write(clamp(data, LIMITS.str.chat), TYPE.chat); },
    'com':     (ENC, data) => { ENC.write(clamp(data, LIMITS.str.com),  TYPE.com); }
  };

  ///////////////////////////////////////////////////////////////////// inbound messages
  /*
    Decoders for everything this platform receives. Each reads the payload after the type
    byte; length validation happens in decode() from LIMITS.packet, uniformly, before any
    of these run.
  */
  const PARSE = (platform === 'server') ? {
    'init': (DEC, result) => {
      result.data.key  = DEC.read(TYPE.key);
      result.data.gm   = toSTRING.gamemode[DEC.read(TYPE.gm)];
      result.data.name = DEC.read(TYPE.name);
      result.data.pet  = DEC.read(TYPE.pet);
      // `key` is a string here, so this has to measure it - the old code compared the string
      // itself against 25, which is NaN-false for every real key once checkLength works.
      if(!checkLength(result.data.key.length, LIMITS.key, LIMITS.key)){
        result.error = 'ERR_BROKEN_KEY';
      }
    },
    'ping': null,
    'keydown': (DEC, result) => { result.data.key = toSTRING.key[DEC.read(TYPE.keydown.key)]; },
    'keyup':   (DEC, result) => { result.data.key = toSTRING.key[DEC.read(TYPE.keyup.key)]; },
    'mousemove': (DEC, result) => {
      result.data.x   = DEC.read(TYPE.mousemove.x)/65535;
      result.data.y   = DEC.read(TYPE.mousemove.y)/65535;
      result.data.dir = DEC.read(TYPE.mousemove.dir);
    },
    'upgrade': (DEC, result) => { result.data.up = DEC.read(TYPE.upgrade.up); },
    'upClass': (DEC, result) => { result.data.up = toSTRING.class[DEC.read(TYPE.upClass.class)]; },
    'chat': (DEC, result) => { result.data = DEC.read(TYPE.chat); },
    'com':  (DEC, result) => { result.data = DEC.read(TYPE.com); }
  } : {
    'ping': null,
    'kick': (DEC, result) => { result.reason = toSTRING.reason[DEC.read(TYPE.kick.reason)]; },
    'GameUpdate': (DEC, result) => {
      result.data.head = readRecord(DEC, 'head', {});
      result.data.User = readRecord(DEC, 'User', {});
      result.data.Instances = {Objects:[], Players:[], Bullets:[]};
      while(!DEC.isEnd()){
        const construc = toSTRING.construc[DEC.read(TYPE.GameUpdate.CONSTRUCTOR)];
        const id       = DEC.read(TYPE.GameUpdate.ID);
        result.data.Instances[construc][id] = readRecord(DEC, construc, {});
      }
    },
    'UiUpdate': (DEC, result) => {
      result.data.leader = new Array(DEC.read(TYPE.UiUpdate.array));
      for(let i = 0; i<result.data.leader.length; i++){
        result.data.leader[i] = readFields(DEC, SCHEMA.UiUpdate.leader, TYPE.UiUpdate.leader, CODEC.leader, {});
      }
      result.data.map  = new Array(DEC.read(TYPE.UiUpdate.array));
      result.data.mess = new Array(DEC.read(TYPE.UiUpdate.array));
      for(let i = 0; i<result.data.mess.length; i++){
        result.data.mess[i] = DEC.read('str');
      }
    },
    'UpdateUp': (DEC, result) => {
      result.data.ups = new Array(DEC.read(TYPE.UpdateUp.ups));
      for(let i = 0; i<result.data.ups.length; i++){
        result.data.ups[i] = DEC.read(TYPE.UpdateUp.ups);
      }
    },
    'chatUpdate': (DEC, result) => {
      result.data.res = [];
      const len = DEC.read('uint8');
      for(let i = 0; i<len/2; i+=2){
        result.data.res.push([DEC.read('str'), DEC.read('str')]);
      }
    },
    'comResponse': (DEC, result) => {
      result.data.res = [];
      const len = DEC.read('uint8');
      for(let i = 0; i<len; i++){
        result.data.res.push(DEC.read('str8'));
      }
    }
  };

  /////////////////////////////////////////////////////////////////////
  exports.encode = (type, data) => {
    const ENC = new Encoder();
    /* A single entity, encoded once per tick and spliced into every viewer's GameUpdate. */
    if(type === 'Instance'){
      ENC.write(toBUFFER.construc[data.construc], TYPE.GameUpdate.CONSTRUCTOR);
      ENC.write(data.id, TYPE.GameUpdate.ID);
      writeRecord(ENC, data.construc, data);
      return new Int8Array(ENC.getBuffer());
    }
    if(!(type in MSG)){
      return;
    }
    ENC.write(toBUFFER.type[type], TYPE.message);
    if(MSG[type]){
      MSG[type](ENC, data);
    }
    return ENC.getBuffer();
  };

  exports.decode = (data) => {
    const length = (platform === 'client') ? data.byteLength : data.length;
    if(!length){
      return {error: 'ERR_PACKET_LENGTH'};
    }
    const DEC    = new Decoder(data);
    const type   = toSTRING.type[DEC.read(TYPE.message)];
    const result = {type: type, data: {}};
    if(!(type in PARSE)){
      // An unknown or wrong-direction type byte. ERR_PACKET_TYPE has been in the kick enum
      // since the beginning and was never once produced; the switch simply fell through and
      // handed the caller an empty result.
      if(platform === 'server'){ result.error = 'ERR_PACKET_TYPE'; }
      return result;
    }
    const bounds = LIMITS.packet[type];
    if(bounds && !checkLength(length, bounds[0], bounds[1])){
      result.error = 'ERR_PACKET_LENGTH';
      return result;
    }
    if(!PARSE[type]){
      return result;
    }
    if(platform === 'client'){
      PARSE[type](DEC, result);
      return result;
    }
    // Server side, a truncated payload is a rejected packet, not a thrown exception: this
    // runs on data from the network, and an uncaught throw here now takes the process down
    // (lib/crash.js fails fast).
    try {
      PARSE[type](DEC, result);
    } catch(e) {
      if(!(e instanceof PacketError)){ throw e; }
      result.error = 'ERR_PACKET_LENGTH';
    }
    return result;
  };

  /* Exposed for tests and for anything that needs to agree with the wire without re-deriving
     it (see test/proto.js). Not used by the game itself. */
  exports.TYPE     = TYPE;
  exports.SCHEMA   = SCHEMA;
  exports.CODEC    = CODEC;
  exports.LIMITS   = LIMITS;
  exports.toBUFFER = toBUFFER;
  exports.toSTRING = toSTRING;

})(typeof(exports) === 'undefined' ? function(){this['PROTO'] = {}; return this['PROTO']}() : exports,
   typeof(exports) === 'undefined' ? 'client' : 'server')
