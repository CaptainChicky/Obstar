/*
	Postgres connection settings.

	One file so that the game and the site point at the same database - a split deployment
	overrides it with the environment instead of by editing the repo.

	DB is off by default (lib/config.js: DB.ON false) and these paths are only exercised
	against a local Docker Postgres.
*/
exports.info = {
	max: 10,
	host: process.env.DB_HOST || "localhost",
	port: process.env.DB_PORT || 5432,
	user: process.env.DB_USER || "root",
	password: process.env.DB_PASSWORD || "root",
	database: process.env.DB_NAME || 'users'
}
