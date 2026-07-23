/*
	MySQL connection settings.

	This was two byte-identical files, lib/AlexMysql.js and lib/webMysql.js, one per entry
	point, so that the game and the site could point at different databases. They never did -
	both said localhost/root/root - and there is one entry point now, so this is one file.
	A split deployment overrides it with the environment instead of by editing the repo.

	MySQL is off by default (lib/config.js: MYSQL false) and none of these paths have been
	run in this tree - see HANDOFF.md section 5 before turning it on.
*/
exports.info = {
	connectionLimit: 10,
	host: process.env.DB_HOST || "localhost",
	user: process.env.DB_USER || "root",
	password: process.env.DB_PASSWORD || "root",
	database: process.env.DB_NAME || 'users'
}
