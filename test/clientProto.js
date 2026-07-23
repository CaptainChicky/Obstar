/*
  Loads public/SHARE/SocketSchema.js in its *client* mode from inside Node.

  The schema file picks its half of the protocol at load time by sniffing `typeof(exports)`:
  defined means server, undefined means browser. A plain require() therefore only ever gives
  you the server half, which is useless for a test that needs to speak as a client.

  Running the same source inside a vm context with no `exports` binding gives us the browser
  half instead, so a test can encode exactly the bytes the client would send.
*/
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = path.join(__dirname, '..', 'public', 'SHARE', 'SocketSchema.js');

module.exports = function loadClientProto(){
  let sandbox = {console: console};
  // Node's Buffer is used by the decode half (DecoderBuff calls buffer.readUInt8), and vm
  // contexts do not get it for free.
  sandbox.Buffer = Buffer;
  // In the browser TanksConfig.js is a <script> tag that has already run, so the schema
  // reads it as a bare global. Stand in for that; the server export is the same data.
  sandbox.TanksConfig = require(path.join(__dirname, '..', 'public', 'SHARE', 'TanksConfig.js'));
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, {filename: SRC});
  if(!sandbox.PROTO || !sandbox.PROTO.encode){
    throw new Error('SocketSchema.js did not expose a client-side PROTO');
  }
  return sandbox.PROTO;
};
