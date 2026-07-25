/*
	Password hashing and session signing for accounts. node:crypto only - no new dependency.

	Sessions are a stateless signed cookie (HMAC-SHA256 over `userkey|expiresAt`), not a session
	table: no DB round trip per request, nothing to garbage-collect. If SESSION_SECRET isn't set
	we generate a random one at boot and say so - mirrors lib/dbConfig.js's env-overridable
	defaults - which just means sessions won't survive a restart until the env var is set.
*/
const crypto = require('crypto');

const SESSION_SECRET = process.env.SESSION_SECRET || (() => {
	const secret = crypto.randomBytes(32).toString('hex');
	console.log('[auth] SESSION_SECRET not set - generated a random one for this process. ' +
		'Sessions will not survive a restart until you set the env var.');
	return secret;
})();

const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1;
const SALT_BYTES = 16, KEY_BYTES = 64;

function hash(password) {
	const salt = crypto.randomBytes(SALT_BYTES);
	const key = crypto.scryptSync(password, salt, KEY_BYTES, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
	return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verify(password, stored) {
	if (!stored || typeof stored !== 'string') return false;
	const parts = stored.split('$');
	if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
	const N = parseInt(parts[1]), r = parseInt(parts[2]), p = parseInt(parts[3]);
	const salt = Buffer.from(parts[4], 'base64');
	const expected = Buffer.from(parts[5], 'base64');
	let actual;
	try {
		actual = crypto.scryptSync(password, salt, expected.length, { N, r, p });
	} catch {
		return false;
	}
	if (actual.length !== expected.length) return false;
	return crypto.timingSafeEqual(actual, expected);
}

function sign(userkey) {
	const expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 30; // 30 days
	const payload = `${userkey}|${expiresAt}`;
	const mac = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
	return `${Buffer.from(payload).toString('base64url')}.${mac}`;
}

function read(token) {
	if (!token || typeof token !== 'string') return null;
	const dot = token.lastIndexOf('.');
	if (dot === -1) return null;
	const payloadB64 = token.slice(0, dot);
	const mac = token.slice(dot + 1);
	const expectedMac = crypto.createHmac('sha256', SESSION_SECRET).update(Buffer.from(payloadB64, 'base64url')).digest('base64url');
	const macBuf = Buffer.from(mac);
	const expectedBuf = Buffer.from(expectedMac);
	if (macBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(macBuf, expectedBuf)) return null;
	const payload = Buffer.from(payloadB64, 'base64url').toString();
	const sep = payload.lastIndexOf('|');
	if (sep === -1) return null;
	const userkey = payload.slice(0, sep);
	const expiresAt = parseInt(payload.slice(sep + 1));
	if (isNaN(expiresAt) || Date.now() > expiresAt) return null;
	return userkey;
}

function validateUsername(s) {
	return typeof s === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(s);
}

function validatePassword(s) {
	return typeof s === 'string' && s.length >= 8 && s.length <= 72;
}

// ~10 attempts per 15 minutes per IP. The web half has no rate limiting elsewhere; login/signup
// is the one place it genuinely matters.
const THROTTLE_MAX = 10, THROTTLE_WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map();

function throttle(ip) {
	const now = Date.now();
	let entry = attempts.get(ip);
	if (!entry || now - entry.start > THROTTLE_WINDOW_MS) {
		entry = { start: now, count: 0 };
		attempts.set(ip, entry);
	}
	entry.count++;
	return entry.count <= THROTTLE_MAX;
}

module.exports = { hash, verify, sign, read, validateUsername, validatePassword, throttle };
