/*
	Wire protocol tests.

	Three things need pinning after the §8.6 rewrite of public/SHARE/SocketSchema.js:

	1. The bytes did not move. The hex vectors below were captured from the pre-refactor,
		 hand-rolled encoder (commit cadf192) and are compared literally. If a schema edit ever
		 changes the wire, these fail first and loudly - which matters because the client is a
		 3241-line file nobody wants to re-verify by hand.
	2. The encoder sizes itself. Callers used to pass a byte count they computed themselves
		 (`ENC.init(37+name.length*2+canDir.length*2)`); too small truncated the packet silently,
		 too large appended zeroes the client decoded as phantom entities. The sizes are now
		 derived here, independently of the encoder, and compared.
	3. checkLength actually checks. It used to be `min<=data<=max`, which JavaScript parses as
		 `(min<=data)<=max` - true for everything, so nothing was ever validated. These tests are
		 the first thing in the repo's history to assert that a malformed packet is refused.

		node test/proto.js        (npm test runs this first)
*/
const path = require('path');
const ROOT = path.join(__dirname, '..');

const server = require(path.join(ROOT, 'public', 'SHARE', 'SocketSchema.js'));
const client = require(path.join(__dirname, 'clientProto.js'))();
const TanksConfig = require(path.join(ROOT, 'public', 'SHARE', 'TanksConfig.js'));

let passed = 0, failed = 0;
function check(name, ok, detail) {
	if (ok) {
		passed++;
		console.log('  ok   ' + name);
	} else {
		failed++;
		console.log('  FAIL ' + name + (detail !== undefined ? '  (' + detail + ')' : ''));
	}
}
/* Both halves hand back ArrayBuffers or Int8Arrays; normalise to hex for comparison. */
function hex(x) {
	const u = (typeof x.length === 'number')
		? Uint8Array.from({ length: x.length }, (_, i) => x[i] & 0xff)
		: new Uint8Array(x);
	return Array.from(u).map(b => b.toString(16).padStart(2, '0')).join('');
}
function buf(x) {
	return Buffer.from(new Uint8Array(x.buffer ? x.buffer : x));
}

const KEY = '0'.repeat(25);

/// 1. the wire has not moved ///////////////////////////////////////////////////
/*
	Captured from the hand-rolled implementation this replaced. Read them as
	[type byte][payload]: 'ping' is a bare 0x06, 'keydown w' is 0x02 0x01, and so on.
*/
function golden() {
	console.log('wire format (vectors from the pre-refactor encoder):');
	const cases = [
		['init', client.encode('init', { key: KEY, gm: 'ffa', name: 'ab', pet: -1 }),
			'001930303030303030303030303030303030303030303030303030000200610062ff'],
		['ping', client.encode('ping', 0), '06'],
		['keydown w', client.encode('keydown', 'w'), '0201'],
		['keyup enter', client.encode('keyup', 'enter'), '0308'],
		['mousemove', client.encode('mousemove', { x: 0.5, y: -0.25, dir: 1.5 }), '047fffc0013fc00000'],
		['upgrade', client.encode('upgrade', 3), '0703'],
		['upClass', client.encode('upClass', TanksConfig.list[0]), '0900'],
		['chat', client.encode('chat', 'hi'), '0d0200680069'],
		['com', client.encode('com', '/x'), '0b022f78'],
		///
		['ping (server)', server.encode('ping', 0), '06'],
		['kick', server.encode('kick', 'ERR_SERVER_FULL'), '0103'],
		['UpdateUp', server.encode('UpdateUp', [1, 2, 3]), '0803010203'],
		['comResponse', server.encode('comResponse', ['ab']), '0c01026162'],
		['chatUpdate', server.encode('chatUpdate', [['bo', 'hi']]), '0e02020062006f0200680069'],
		['Instance (Objects)', server.encode('Instance', {
			construc: 'Objects', id: 17, states: [0, 1, 0, 0, 0, 0, 0], shape: 'sqr',
			hp: 0.75, x: -100.5, y: 250.125, size: 40, alpha: 1
		}), '010011a000bfc2c90000437a200042200000ff'],
		['UiUpdate', server.encode('UiUpdate', {
			leader: [{ xp: 100, name: 'bo', nameC: 0, team: 1 }], map: [], mess: ['hi']
		}), '0a0100000064020062006f000100010200680069'],
	];
	for (const [name, got, want] of cases) {
		check(name + ' encodes to the same bytes as before', hex(got) === want, hex(got));
	}
}

/// 2. the encoder sizes itself /////////////////////////////////////////////////
/*
	Byte width of a field, derived from SCHEMA/TYPE rather than from the encoder, so this is a
	second opinion and not a restatement. `str` is a uint8 count of UTF-16 units, `str8` a
	uint8 count of bytes.
*/
const WIDTH = { int8: 1, uint8: 1, int16: 2, uint16: 2, int32: 4, uint32: 4, float32: 4 };
function fieldSize(value, type) {
	if (type === 'str') { return 1 + String(value).length * 2; }
	if (type === 'str8') { return 1 + String(value).length; }
	return WIDTH[type];
}
/* Measures the value as it goes on the wire, so the codec runs first: `canDir` is an array
	 of angles in memory and a packed `str` on the wire, and it is the latter that has a size. */
function recordSize(record, src) {
	return server.SCHEMA.GameUpdate[record].reduce((n, f) => {
		const codec = server.CODEC[record][f];
		return n + fieldSize(codec ? codec.enc(src[f]) : src[f], server.TYPE.GameUpdate[record][f]);
	}, 0);
}

const aPlayer = {
	construc: 'Players', id: 3, states: [1, 0, 0, 0, 0, 0, 1], class: TanksConfig.list[0], color: 4,
	x: 12.5, y: -800.25, vx: 1.5, vy: -0.5, dir: 1.75, size: 32.5, alpha: 0.5, hp: 0.25,
	xp: 123456, name: 'bob', nameC: 0, recoil: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
	canDir: [0.5, -1.25]
};
const anObject = {
	construc: 'Objects', id: 17, states: [0, 1, 0, 0, 0, 0, 0], shape: 'sqr', hp: 0.75,
	x: -100.5, y: 250.125, size: 40, alpha: 1
};
const aBullet = {
	construc: 'Bullets', id: 900, states: [1, 0, 0, 0, 0, 0, 0], type: 3, x: 5.5, y: 6.5,
	size: 12, color: 9, alpha: 0.9, dir: -3
};

function sizes() {
	console.log('\nself-sizing encoder:');
	// The three constants rooms/Room.js used to carry by hand, now nobody's job.
	check('a Players record is 37 + name*2 + canDir*2 bytes',
		server.encode('Instance', aPlayer).length === 37 + aPlayer.name.length * 2 + aPlayer.canDir.length * 2,
		server.encode('Instance', aPlayer).length);
	check('an Objects record is 19 bytes', server.encode('Instance', anObject).length === 19,
		server.encode('Instance', anObject).length);
	check('a Bullets record is 21 bytes', server.encode('Instance', aBullet).length === 21,
		server.encode('Instance', aBullet).length);

	// ...and the same numbers again, derived from the schema instead of written down. 3 is the
	// CONSTRUCTOR byte plus the uint16 id that precede every record.
	for (const [label, rec] of [['Players', aPlayer], ['Objects', anObject], ['Bullets', aBullet]]) {
		check(label + ' record length matches the schema',
			server.encode('Instance', rec).length === 3 + recordSize(rec.construc, rec),
			server.encode('Instance', rec).length + ' vs ' + (3 + recordSize(rec.construc, rec)));
	}

	const head = {
		timestamp: 4242, width: 8000, height: 6000, screen: 1600, xp: 987654,
		level: 12.5, still: 3, cLvl: 1
	};
	const main = Object.assign({}, aPlayer, { name: 'me', canDir: [0, 1, -1] });
	const instances = [aPlayer, anObject, aBullet].map(r => new Int8Array(server.encode('Instance', r)));
	const packet = server.encode('GameUpdate', { head: head, main: main, instances: instances });
	const want = 1 + recordSize('head', head) + recordSize('User', main) +
		instances.reduce((n, a) => n + a.length, 0);
	check('a GameUpdate is exactly its head + own tank + entities', packet.byteLength === want,
		packet.byteLength + ' vs ' + want);

	// An oversized buffer used to leave trailing zeroes that the client's read-until-the-end
	// loop turned into phantom Players at id 0. Nothing trails now, so decoding is exact.
	const back = client.decode(packet);
	check('the client decodes it back to exactly 3 entities and no more',
		Object.keys(back.data.Instances.Players).length === 1 &&
		Object.keys(back.data.Instances.Objects).length === 1 &&
		Object.keys(back.data.Instances.Bullets).length === 1);
}

/// 3. round trips //////////////////////////////////////////////////////////////
function roundTrips() {
	console.log('\nround trips:');
	const init = server.decode(buf(client.encode('init', { key: KEY, gm: '2team', name: 'bob', pet: 2 })));
	check('init survives the round trip',
		!init.error && init.data.key === KEY && init.data.gm === '2team' &&
		init.data.name === 'bob' && init.data.pet === 2,
		JSON.stringify(init));

	for (const key of ['a', 'w', 's', 'd', 'e', 'c', 'mouseL', 'mouseR']) {
		const d = server.decode(buf(client.encode('keydown', key)));
		if (d.error || d.data.key !== key) {
			check('keydown ' + key + ' survives', false, JSON.stringify(d));
			return;
		}
	}
	check('every keydown survives the round trip', true);

	const mm = server.decode(buf(client.encode('mousemove', { x: 0.5, y: -0.25, dir: 1.5 })));
	check('mousemove survives within int16 resolution',
		Math.abs(mm.data.x - 0.5) < 1e-4 && Math.abs(mm.data.y + 0.25) < 1e-4 &&
		Math.abs(mm.data.dir - 1.5) < 1e-6, JSON.stringify(mm.data));

	const cls = TanksConfig.list[5];
	const uc = server.decode(buf(client.encode('upClass', cls)));
	check('upClass survives as a class name', uc.data.up === cls, uc.data.up);

	// Server -> client. The transforms these exercise (bit arrays, angles, 0..1 ratios, the
	// packed xp magnitude) are the ones that used to be written out four separate times.
	const packet = server.encode('GameUpdate', {
		head: { timestamp: 1, width: 8000, height: 6000, screen: 1600, xp: 5, level: 2, still: 0, cLvl: 0 },
		main: Object.assign({}, aPlayer),
		instances: [new Int8Array(server.encode('Instance', aPlayer))]
	});
	const g = client.decode(packet);
	check('GameUpdate head comes back intact',
		g.data.head.timestamp === 1 && g.data.head.width === 8000 && g.data.head.screen === 1600,
		JSON.stringify(g.data.head));
	check('the own-tank record carries no xp field (the head already has it)',
		g.data.User.xp === undefined);
	check('states decodes back to the bit array that went in',
		JSON.stringify(g.data.User.states) === JSON.stringify(aPlayer.states),
		JSON.stringify(g.data.User.states));
	check('recoil decodes back to the bit array that went in',
		JSON.stringify(g.data.User.recoil) === JSON.stringify(aPlayer.recoil),
		JSON.stringify(g.data.User.recoil));
	check('class and colour come back as names',
		g.data.User.class === TanksConfig.list[0] && g.data.User.color === 'gray',
		g.data.User.class + '/' + g.data.User.color);
	check('hp survives as a 0..1 ratio', Math.abs(g.data.User.hp - 0.25) < 0.01, g.data.User.hp);
	check('canDir angles survive',
		g.data.User.canDir.length === 2 && Math.abs(g.data.User.canDir[0] - 0.5) < 1e-3,
		JSON.stringify(g.data.User.canDir));
	const inst = g.data.Instances.Players[3];
	check('an entity record decodes under its own id', inst !== undefined && inst.x === 12.5,
		inst && inst.x);
	check('entity xp comes back as a scoreboard string', inst.xp === '123 k', inst.xp);
	check('a polygon shape decodes as `type`, not `shape`',
		client.decode(server.encode('GameUpdate', {
			head: { timestamp: 0, width: 0, height: 0, screen: 0, xp: 0, level: 0, still: 0, cLvl: 0 },
			main: aPlayer,
			instances: [new Int8Array(server.encode('Instance', anObject))]
		})).data.Instances.Objects[17].type === 'sqr');

	const ui = client.decode(server.encode('UiUpdate', {
		leader: [{ xp: 100, name: 'bob', nameC: 0, team: 1 }], map: [], mess: ['hello']
	}));
	check('UiUpdate leader survives, with the team as a colour name',
		ui.data.leader[0].xp === 100 && ui.data.leader[0].name === 'bob' &&
		ui.data.leader[0].team === 'red' && ui.data.mess[0] === 'hello',
		JSON.stringify(ui.data));

	check('kick reasons survive',
		client.decode(server.encode('kick', 'ERR_HEARTBEATS_LOST')).reason === 'ERR_HEARTBEATS_LOST');
}

/// 4. validation, which never once ran before ///////////////////////////////////
function validation() {
	console.log('\ninput validation (checkLength was a no-op until now):');

	check('an empty packet is refused',
		server.decode(Buffer.alloc(0)).error === 'ERR_PACKET_LENGTH');

	check('an unknown type byte is ERR_PACKET_TYPE',
		server.decode(Buffer.from([200])).error === 'ERR_PACKET_TYPE');
	check('a server-to-client type sent back at the server is ERR_PACKET_TYPE',
		server.decode(Buffer.from([server.toBUFFER.type.GameUpdate])).error === 'ERR_PACKET_TYPE');

	const keydown = buf(client.encode('keydown', 'w'));
	check('a well-formed keydown is accepted', !server.decode(keydown).error);
	check('a keydown with a trailing byte is refused',
		server.decode(Buffer.concat([keydown, Buffer.alloc(1)])).error === 'ERR_PACKET_LENGTH');
	check('a truncated keydown is refused',
		server.decode(keydown.slice(0, 1)).error === 'ERR_PACKET_LENGTH');
	check('a short mousemove is refused',
		server.decode(buf(client.encode('mousemove', { x: 0, y: 0, dir: 0 })).slice(0, 8)).error === 'ERR_PACKET_LENGTH');

	const init = buf(client.encode('init', { key: KEY, gm: 'ffa', name: 'bob', pet: -1 }));
	check('a well-formed init is accepted', !server.decode(init).error);
	check('an oversized init is refused',
		server.decode(Buffer.concat([init, Buffer.alloc(40)])).error === 'ERR_PACKET_LENGTH');
	check('an undersized init is refused',
		server.decode(init.slice(0, 20)).error === 'ERR_PACKET_LENGTH');
	// A 3-character key, padded out with a long name so the packet size itself is legal. This
	// is the case HANDOFF §4 reported as getting through: it is the check the whole userKey
	// scheme rests on, and it has never fired.
	const shortKey = buf(client.encode('init', { key: 'abc', gm: 'ffa', name: 'sixteencharacte', pet: -1 }));
	check('a short key inside a legal-sized init is ERR_BROKEN_KEY',
		server.decode(shortKey).error === 'ERR_BROKEN_KEY',
		shortKey.length + ' bytes -> ' + server.decode(shortKey).error);

	// A packet whose length prefix claims more than the packet holds. Before the bounds check
	// this threw a RangeError out of Buffer.readUInt8, and with lib/crash.js failing fast that
	// is a one-packet denial of service.
	const liar = Buffer.concat([Buffer.from([server.toBUFFER.type.com, 50]), Buffer.alloc(20, 0x61)]);
	check('a string length prefix that overruns the packet is refused, not thrown',
		server.decode(liar).error === 'ERR_PACKET_LENGTH', JSON.stringify(server.decode(liar)));
	const liarInit = Buffer.concat([Buffer.from([server.toBUFFER.type.init, 60]), Buffer.alloc(28, 0x61)]);
	check('an init claiming a 60-char key inside 30 bytes is refused, not thrown',
		server.decode(liarInit).error === 'ERR_PACKET_LENGTH');

	// The client encoder clamps to the same bounds the server enforces, so a player typing a
	// long message gets it truncated rather than getting kicked mid-sentence.
	const longChat = 'x'.repeat(300);
	const chat = buf(client.encode('chat', longChat));
	check('the client clamps chat to the length the server accepts',
		chat.length === 202 && !server.decode(chat).error, chat.length);
	check('chat over the limit is refused',
		server.decode(Buffer.concat([chat, Buffer.alloc(2)])).error === 'ERR_PACKET_LENGTH');
	const com = buf(client.encode('com', '/'.repeat(200)));
	check('the client clamps commands to the length the server accepts',
		com.length === 52 && !server.decode(com).error, com.length);
	const longName = buf(client.encode('init', { key: KEY, gm: 'ffa', name: 'x'.repeat(80), pet: -1 }));
	check('the client clamps names, so a long name cannot oversize an init',
		longName.length === 62 && !server.decode(longName).error, longName.length);
}

/// 5. Names //////////////////////////////////////////////////////////////////
/*
	Length is the only rule applied to a name, anywhere in the stack. The bot names in
	lib/botNames.js are themselves non-ASCII, so a filter that only passed [a-z0-9] would make
	human players second-class next to the bots; nothing is rendered as HTML either - the
	client draws names into a canvas - so there is no markup to escape.

	What is worth pinning is that the whole of Unicode makes it through unchanged, and that the
	one place a naive length cut goes wrong - a surrogate pair straddling the boundary, which
	is every emoji - is handled.
*/
function names() {
	console.log('\nnames:');
	const trip = (name) => server.decode(buf(client.encode('init',
		{ key: KEY, gm: 'ffa', name: name, pet: -1 }))).data.name;

	const samples = [
		['ascii', 'bob'],
		['accented latin', 'Zoé Müller'],
		['cyrillic', 'Привет'],
		['greek', 'Στέλιος'],
		['cjk', '中文名字'],
		['japanese kana', 'タンク'],
		['korean', '한국어'],
		['hebrew (rtl)', 'שלום'],
		['arabic (rtl)', 'مرحبا'],
		['thai', 'สวัสดี'],
		['emoji (astral)', '🚀🔥'],
		['mixed script', 'ab中ф🚀'],
		['symbols and marks', '☠ x́ ♫'],
		['spaces kept', 'a b  c']
	];
	for (const [what, name] of samples) {
		check(what + ' survives the wire unchanged', trip(name) === name,
			JSON.stringify(trip(name)));
	}

	// The exact boundary. 16 UTF-16 code units is what the wire counts, what the browser's
	// maxlength counts and what Controller.maxPseudoLength counts, so all three agree.
	check('a name at exactly the limit is untouched',
		trip('x'.repeat(16)) === 'x'.repeat(16));
	check('a name over the limit is cut to it', trip('x'.repeat(40)).length === 16,
		trip('x'.repeat(40)).length);
	check('non-ASCII gets the same 16 units as ASCII, not fewer',
		trip('中'.repeat(40)) === '中'.repeat(16));

	// Eight emoji are exactly 16 code units; nine must lose a whole one, never half of one.
	// Cutting mid-pair leaves a lone surrogate, which survives the codec and renders as the
	// replacement glyph - the failure mode is silent and it hits exactly the names people
	// most want.
	const eight = '🚀'.repeat(8);
	check('eight emoji fit exactly', trip(eight) === eight, JSON.stringify(trip(eight)));
	const nine = trip('🚀'.repeat(9));
	check('a ninth emoji is dropped whole', nine === '🚀'.repeat(8),
		JSON.stringify(nine));
	check('the cut never leaves a lone surrogate',
		!/[\ud800-\udbff](?![\udc00-\udfff])|(?:[^\ud800-\udbff]|^)[\udc00-\udfff]/.test(nine),
		JSON.stringify(nine));
	// The same cut one unit earlier: 15 units of emoji plus a filler, so the boundary lands
	// between the pair rather than on it.
	const odd = trip('z' + '🚀'.repeat(9));
	check('an odd-aligned cut also keeps pairs whole',
		odd === 'z' + '🚀'.repeat(7) && odd.length === 15,
		JSON.stringify(odd) + ' len ' + odd.length);

	// A name that reaches the limit must still produce a packet the server accepts - this is
	// the interaction that made the old clamp worth testing at all.
	for (const [what, name] of samples.concat([['padded emoji', '🚀'.repeat(20)]])) {
		const packet = buf(client.encode('init', { key: KEY, gm: 'ffa', name: name, pet: -1 }));
		if (server.decode(packet).error) {
			check(what + ': the server accepts the packet', false, server.decode(packet).error);
			return;
		}
	}
	check('every sample produces an init the server accepts', true);
}

golden();
sizes();
roundTrips();
validation();
names();

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
