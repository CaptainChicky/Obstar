/*
	Express app for the menu site: index page, static files, accounts, shop purchases and
	leaderboard reads. createApp() builds the app but opens no port; server.js decides
	where it gets mounted.
*/
const express = require('express');
const cookieParser = require('cookie-parser');

const config = require('../lib/config.js').config;
const auth = require('../lib/auth.js');

// Where the browser should point its WebSocket. Empty means "same origin as this page",
// which is the answer whenever the game and the site share a process (the default).
// A split deployment sets WS_LINK=wss://game.example.com when starting the web half.
const WS_LINK = process.env.WS_LINK || '';

module.exports = function createApp() {
	const app = express();
	const db = require('../lib/db.js');
	let LEADERBOARD = [];
	const SHOP = { HIDE: 1 };
	const SHOPPER = {};
	if (db.enabled) {
		if (config.DB.LB) {
			const updateLB = () => {
				db.query("SELECT score, name, tank, gm, TO_CHAR(date, 'DD-MM-YYYY') AS date FROM wrs ORDER BY score DESC").then((leader) => {
					LEADERBOARD = leader;
				})
			};
			updateLB();
			setInterval(updateLB, 120000);
		}
		if (config.DB.SHOP) {
			delete SHOP.HIDE;
			const updateShop = () => {
				db.query('SELECT class, id, label, price FROM shop').then((shop) => {
					shop.forEach((item) => {
						SHOP[item.class] = SHOP[item.class] || [];
						SHOP[item.class][item.id] = {
							label: item.label,
							price: item.price,
						}
					})
				})
			};
			updateShop();
			setInterval(updateShop, 120000);
		} else {
			SHOP.HIDE = 1
		}
	}
	const generateKey = (() => {
		const str = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'
		return (length) => {
			return new Array(length).fill(0).map((x) => { return str[Math.floor(Math.random() * str.length)] }).join('');
		}
	})()
	const basicKey = '0'.repeat(25);
	// obstarkey is the account identity cookie. If a session cookie is present, it must be a
	// valid signed HMAC of the key (lib/auth.js), otherwise the obstarkey cookie is untrusted
	// (tampered or stale). No session cookie means a guest who never logged in.
	const resolveKey = (req) => {
		const key = req.cookies.obstarkey;
		if (!key) return null;
		const session = req.cookies.session;
		if (session && auth.read(session) !== key) return null;
		return key;
	};
	app.set('views', __dirname + '/../views');
	app.use(express.static(__dirname + '/../public'));
	// express.json/urlencoded replace the separate body-parser dependency (Express 5).
	app.use(express.json());
	app.use(express.urlencoded({ extended: true }));
	app.use(cookieParser());


	app.get('/favicon.ico', async function (req, res) { res.status(404).end() });
	// Express 5's path-to-regexp v8 rejects a bare '*' string path, so use a RegExp catch-all.
	app.get(/.*/, function (request, respond) {
		const KEY = resolveKey(request) || 1;
		if (db.enabled && config.DB.ACC) {
			db.query('SELECT * FROM acc WHERE userkey = $1', [KEY]).then((result) => {
				if (result && result.length && result[0]) {
					db.query('UPDATE acc SET lastconnection = NOW() WHERE userkey = $1', [KEY]);
					respond.cookie('obstarkey', KEY, { expires: new Date(253402300000000), sameSite: 'Lax', httpOnly: true });
					const sendData = {
						key: KEY,
						leader: LEADERBOARD,
						shop: SHOP
					};
					respond.render('index.ejs', { data: JSON.stringify(sendData) });
					return;
				} else {
					const newkey = generateKey(25);
					db.query('INSERT INTO acc (userkey, userdata, remoteaddress, lastconnection, coins) VALUES ($1,$2,$3,NOW(),255000)', [
						newkey,
						JSON.stringify({ own: { pets: {} } }),
						request.connection.remoteAddress
					]);
					respond.cookie('obstarkey', newkey, { expires: new Date(253402300000000), sameSite: 'Lax', httpOnly: true });
					const sendData = {
						key: newkey,
						leader: LEADERBOARD,
						shop: SHOP
					};
					respond.render('index.ejs', { data: JSON.stringify(sendData) });
					return;
				}
			});
		} else {
			const sendData = {
				key: basicKey,
				leader: LEADERBOARD,
				shop: SHOP
			};
			respond.render('index.ejs', { data: JSON.stringify(sendData) });
		}
	});
	app.post('/userData', function (req, res) {
		if (db.enabled && config.DB.ACC) {
			const key = resolveKey(req);
			if (!key) { res.status(200).send('none'); return; }
			db.query('SELECT userdata, coins, username, devlevel FROM acc WHERE userkey = $1', [key]).then((result) => {
				if (result.length) {
					const data = JSON.parse(result[0].userdata);
					data.coins = result[0].coins;
					data.loggedIn = !!result[0].username;
					data.username = result[0].username || null;
					data.devlevel = result[0].devlevel || 0;
					res.status(200).send(JSON.stringify(data));
				} else {
					res.status(200).send('none');
				}
			});
		} else {
			res.status(200).send('none');
		}
	});
	app.post('/buy', function (req, res) {
		if (!db.enabled || !config.DB.ACC || !config.DB.SHOP) {
			res.status(200).send('no obj');
			return;
		}
		const userKey = resolveKey(req);
		if (!userKey) {
			res.status(200).send('no user');
			return;
		}
		if (SHOPPER[userKey]) {
			res.status(200).send('already');
			return;
		} else {
			SHOPPER[userKey] = 1;
		}
		if (isNaN(parseInt(req.body.id)) || !req.body.class || !SHOP[req.body.class] || !SHOP[req.body.class][req.body.id]) {
			delete SHOPPER[userKey];
			res.status(200).send('no obj');
			return;
		}
		const obj = SHOP[req.body.class][req.body.id], objC = req.body.class, objId = req.body.id;
		db.query('SELECT userdata, coins FROM acc WHERE userkey = $1', [userKey]).then((result) => {
			if (result.length && result[0].userdata) {
				const user = JSON.parse(result[0].userdata);
				///
				if (user.own && user.own[objC] && user.own[objC][objId]) {
					delete SHOPPER[userKey];
					res.status(200).send('owned');
				} else if (obj.price <= result[0].coins) {
					user.own = user.own || {};
					user.own[objC] = user.own[objC] || {};
					user.own[objC][objId] = 1;
					user.coins = result[0].coins - obj.price;
					const stringUser = JSON.stringify(user);
					db.query('UPDATE acc SET userdata = $1, coins = $2 WHERE userkey = $3', [stringUser, user.coins, userKey]).then(() => {
						delete SHOPPER[userKey];
					});
					res.status(200).send(stringUser);
				} else {
					delete SHOPPER[userKey];
					res.status(200).send('no coins');
				}
			} else {
				delete SHOPPER[userKey];
				res.status(200).send('no user');
			}
		});
	})
	app.post('/auth/signup', function (req, res) {
		const fail = (msg) => res.status(200).send(JSON.stringify({ error: msg }));
		if (!db.enabled || !config.DB.ACC || !config.DB.AUTH) return fail('signup is disabled on this server');
		if (!auth.throttle(req.ip)) return fail('too many attempts, try again later');
		const username = req.body.username;
		const password = req.body.password;
		const email = (req.body.email && String(req.body.email).slice(0, 254)) || null;
		if (!auth.validateUsername(username)) return fail('username must be 3-16 characters: letters, numbers, underscore');
		if (!auth.validatePassword(password)) return fail('password must be 8-72 characters');
		const usernameLc = username.toLowerCase();
		db.query('SELECT id FROM acc WHERE username_lc = $1', [usernameLc]).then((taken) => {
			if (taken.length) return fail('that username is taken');
			const passhash = auth.hash(password);
			const cookieKey = resolveKey(req);
			(cookieKey ? db.query('SELECT userdata FROM acc WHERE userkey = $1', [cookieKey]) : Promise.resolve([])).then((existingRow) => {
				let finalKey = cookieKey, userdata;
				if (existingRow.length) {
					try { userdata = JSON.parse(existingRow[0].userdata); } catch { userdata = { own: { pets: {} } }; }
				} else {
					finalKey = generateKey(25);
					userdata = { own: { pets: {} } };
				}
				// Merge the guest's local achievement unlocks into the account, keeping the
				// earliest timestamp per id.
				if (req.body.ach && typeof req.body.ach === 'object') {
					userdata.ach = userdata.ach || {};
					for (const aid in req.body.ach) {
						const t = parseInt(req.body.ach[aid]);
						if (!isNaN(t) && (!userdata.ach[aid] || t < userdata.ach[aid])) userdata.ach[aid] = t;
					}
				}
				const done = existingRow.length
					? db.query('UPDATE acc SET username = $1, username_lc = $2, passhash = $3, email = $4, userdata = $5 WHERE userkey = $6',
						[username, usernameLc, passhash, email, JSON.stringify(userdata), finalKey])
					: db.query('INSERT INTO acc (userkey, userdata, remoteaddress, lastconnection, coins, username, username_lc, passhash, email) VALUES ($1,$2,$3,NOW(),255000,$4,$5,$6,$7)',
						[finalKey, JSON.stringify(userdata), req.connection.remoteAddress, username, usernameLc, passhash, email]);
				done.then(() => {
					res.cookie('obstarkey', finalKey, { expires: new Date(253402300000000), sameSite: 'Lax', httpOnly: true });
					res.cookie('session', auth.sign(finalKey), { expires: new Date(253402300000000), sameSite: 'Lax', httpOnly: true });
					res.status(200).send(JSON.stringify({ ok: true, username: username }));
				});
			});
		});
	});
	app.post('/auth/login', function (req, res) {
		const fail = (msg) => res.status(200).send(JSON.stringify({ error: msg }));
		if (!db.enabled || !config.DB.ACC || !config.DB.AUTH) return fail('login is disabled on this server');
		if (!auth.throttle(req.ip)) return fail('too many attempts, try again later');
		const username = req.body.username, password = req.body.password;
		if (typeof username !== 'string' || typeof password !== 'string') return fail('incorrect username or password');
		db.query('SELECT userkey, passhash FROM acc WHERE username_lc = $1', [username.toLowerCase()]).then((rows) => {
			if (!rows.length || !auth.verify(password, rows[0].passhash)) return fail('incorrect username or password');
			res.cookie('obstarkey', rows[0].userkey, { expires: new Date(253402300000000), sameSite: 'Lax', httpOnly: true });
			res.cookie('session', auth.sign(rows[0].userkey), { expires: new Date(253402300000000), sameSite: 'Lax', httpOnly: true });
			res.status(200).send(JSON.stringify({ ok: true, username: username }));
		});
	});
	app.post('/auth/logout', function (req, res) {
		res.clearCookie('session');
		if (!db.enabled || !config.DB.ACC || !config.DB.AUTH) {
			res.status(200).send(JSON.stringify({ ok: true }));
			return;
		}
		const newkey = generateKey(25);
		db.query('INSERT INTO acc (userkey, userdata, remoteaddress, lastconnection, coins) VALUES ($1,$2,$3,NOW(),255000)', [
			newkey,
			JSON.stringify({ own: { pets: {} } }),
			req.connection.remoteAddress
		]).then(() => {
			res.cookie('obstarkey', newkey, { expires: new Date(253402300000000), sameSite: 'Lax', httpOnly: true });
			res.status(200).send(JSON.stringify({ ok: true }));
		});
	});
	app.post('/play', function (request, respond) {
		const sendData = {
			key: request.cookies.obstarkey || basicKey,
			gm: request.body.gm || 'ffa',
			name: request.body.name || 'unnamed',
			pet: request.body.pet || -1,
			ws: WS_LINK
		}
		const pref = {
			name: (sendData.name === 'unnamed') ? '' : sendData.name,
			pet: sendData.pet || -1
		}
		respond.cookie('preference', pref, { expires: new Date(253402300000000), sameSite: 'Strict' });
		respond.render('play.ejs', { data: JSON.stringify(sendData) });
	});

	return app;
};
