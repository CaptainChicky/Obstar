/*
	The one Postgres connection point for the whole server. Replaces the three duplicated
	mysql2 pools (web/app.js, lib/Controller.js) and the broken require('mysql') in server.js.
	Centralized so pool sizing / TLS / read-replica routing land in one place when this moves
	to managed Postgres. Off unless config.DB.ON (default false) - see lib/config.js.
*/
const config = require('./config.js').config;

let pool = null;
if (config.DB.ON) {
	const { Pool } = require('pg');
	pool = new Pool(require('./dbConfig.js').info);
}

exports.enabled = !!pool;

// Resolves to the rows array (callers never want pg's wrapper object). Rejections bubble to
// crash.js's unhandledRejection fail-fast - matching the old `if(err) throw err`.
exports.query = async (text, params) => (await pool.query(text, params)).rows;

// One-time connectivity check + log, called at boot when the DB is on.
exports.check = async () => {
	if (!pool) return;
	const c = await pool.connect();
	c.release();
	console.log('connect database');
};
