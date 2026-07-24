# Obstar / Korexk.io

An open-source clone of diep.io: a 2D multiplayer arena shooter. Players are tanks that shoot
bullets, farm polygon "objects" for XP, level up, pick stat upgrades, and evolve through a
class tree.

The codebase has been through a substantial refactor and cleanup pass (single entry point,
Postgres instead of the old MySQL wiring, a real test suite, linting). It's still a
work-in-progress game, not a finished product — see [PENDING.md](PENDING.md) for what's
decided-but-not-built and what's untested, and [HANDOFF.md](HANDOFF.md) for the full
architecture map and gotcha list.

## Running it
```bash
npm install
npm start          # http://localhost - game and menu site, one process, one port
npm test           # protocol, physics, rooms, client, and end-to-end smoke tests
npm run lint       # eslint, flat config
```
`PORT=3000 npm start` if port 80 is taken or restricted (common on Windows). Runs entirely
without a database — every player gets the same anonymous key, the shop stays hidden, and the
leaderboard renders empty. See [Database](#database-postgres) below to turn accounts/shop/
leaderboard on.

## Prerequisites
- Node 18+ (all dependencies are in package.json; no other setup needed for the game itself)
- Docker Desktop — only if you want the Postgres-backed features (see below)

## Split deployment
`server.js` is the only entry point and normally runs the game simulation (binary WebSocket
protocol) and the Express menu site on the same port. It's still possible to split them across
two machines:
```bash
node server.js --game-only                                   # box A, ws://…:8080
WS_LINK=wss://game.example.com node server.js --web-only      # box B, http://…:80
```
`WS_LINK` is how the web page finds the game server; leave it unset and the client just uses
whatever origin served the page.

## Database (Postgres)
Accounts, the shop, and the leaderboard are backed by Postgres, off by default
(`config.DB.ON` is `false` in `lib/config.js` — the game runs fine without it). To turn it on
for local dev:
```bash
docker compose up -d      # starts postgres:16, applies db/schema.sql on first init
```
then flip `DB.ON` (plus whichever of `DB.ACC`/`DB.SHOP`/`DB.DEV`/`DB.LB` you want) to `true`
in `lib/config.js` and `npm start`. `db/schema.sql` holds the table definitions only — the
actual data lives in a Docker-managed volume, not in that folder. Credentials are in
`lib/dbConfig.js`, overridable via `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` /
`DB_NAME`.

**Wiping the DB:**
```bash
docker compose down -v    # deletes the container AND the data volume
docker compose up -d      # recreates it; schema.sql reapplies since the volume starts empty
```
Plain `docker compose down` (no `-v`) / `docker compose up -d` just stops/restarts the
container and keeps all data — `-v` is the one that actually resets everything.

Don't commit `lib/config.js` with `DB.ON: true` — the test suite expects it off.

See [HANDOFF.md](HANDOFF.md) §1 and §8 for the full picture, including how account
create/lookup, shop purchases, and leaderboard writes were verified end to end against a real
local Postgres instance, and how to test admin commands via the in-browser dev console.

## Contributing
The game still needs a lot of work — new gamemode content, more test coverage on the untested
paths, general polish. [PENDING.md](PENDING.md) is the up-to-date punch list of what's decided
but not built and what nobody has verified yet; [HANDOFF.md](HANDOFF.md) is the map to get
oriented in the code before touching anything.
