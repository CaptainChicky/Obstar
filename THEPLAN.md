# Login, achievements, and diep-feel pass

## Context

Obstar has no login at all. Every visitor silently receives a random 25-char key in an
`obstarkey` cookie ([web/app.js:78-119](web/app.js#L78-L119)); there is no signup, no account
page, and no way to move progress between browsers. `PENDING.md` item #1 is exactly this, and
it pairs it with a second undecided question: `Ctrl+Shift+L` currently opens the dev console for
*anyone*, and does nothing until you type `connect <password>` against a plaintext-password
`devs` table.

Separately, several concrete pieces of "diep feel" are half-built and identifiable:
client-side prediction uses numbers that do not match the server, a rare-polygon flag is already
on the wire but discarded by the client, the minimap only ever draws your own dot, and the whole
HUD updates once per second.

**The single most important finding: login needs no protocol change.** The game socket already
authenticates by a 25-char `userkey` (`LIMITS.key = 25` in
[public/SHARE/SocketSchema.js:572](public/SHARE/SocketSchema.js#L572),
`Controller.askConnection` at [lib/Controller.js:150](lib/Controller.js#L150)). A real login is
just "resolve a human to a `userkey`" — pure web + DB + menu-UI work. The binary protocol,
`init` handshake, and rooms are untouched by Part 1.

Decisions already made by the user, driving this plan:
- **Guest-first + claim.** Play is never gated. Signup *attaches* credentials to your existing
  anonymous row so coins/pets/achievements carry over.
- **Account chip + modal** in the menu, reusing the existing `#prevent_click` scrim and
  `.showDiv`/`.hideDiv` pattern.
- **Full achievements**: registry + persistence + hover-expand panel, with `localStorage` as
  the store for guests, merged into the account on claim.
- **Cosmetics console for everyone**, real commands gated by an account flag.
- **All four diep-feel fixes.**

---

## Part 1 — Accounts & login

### 1.1 Schema — [db/schema.sql](db/schema.sql)

Add to `acc` (the DB is being wiped, so edit the `CREATE TABLE` directly — no migration):

```sql
username    text,                        -- display form, as typed
username_lc text UNIQUE,                 -- lowercased; the lookup key (avoids the citext ext.)
passhash    text,                        -- scrypt, see lib/auth.js; NULL for a guest row
email       text,                        -- optional, collected but unused: reserved for recovery
devlevel    integer NOT NULL DEFAULT 0   -- replaces the devs table
```

Then **drop the `devs` table** ([db/schema.sql:33](db/schema.sql#L33)) and its seed comment.
Achievements do **not** get a column — they live in the existing `userdata` JSON blob alongside
`own.pets`, which `/userData` and `/buy` already parse.

### 1.2 New file — `lib/auth.js`

No new dependency: `node:crypto` has everything.

- `hash(password)` / `verify(password, stored)` — `crypto.scrypt` (N=16384, r=8, p=1, 16-byte
  salt, 64-byte key), stored as `scrypt$N$r$p$saltB64$hashB64`, compared with
  `crypto.timingSafeEqual`.
- `sign(userkey)` / `read(token)` — a **stateless** signed session cookie: HMAC-SHA256 over
  `userkey|expiresAt` with `process.env.SESSION_SECRET`. No session table, no DB round trip per
  request. If the env var is missing, generate a random secret at boot and log that sessions
  will not survive a restart (mirrors how `lib/dbConfig.js` handles env-overridable defaults).
- `validateUsername(s)` — 3-16 chars, `[A-Za-z0-9_]`. `validatePassword(s)` — 8-72 chars.
- `throttle(ip)` — an in-memory `Map` allowing ~10 attempts per 15 min. The web half has no
  rate limiting today; the login route is the one place it genuinely matters.

### 1.3 Config — [lib/config.js:12-19](lib/config.js#L12-L19)

Add `'AUTH': false` to the `DB` block, following the existing `ACC`/`SHOP`/`DEV`/`LB` flags.
With it off (the default, and the whole DB-off local-dev flow) everything degrades to today's
guest behaviour and the login UI hides itself — reuse the `SHOP.HIDE` pattern already sent to
the client in `sendData` ([web/app.js:25](web/app.js#L25), consumed by
[public/shop.js](public/shop.js)).

### 1.4 Routes — [web/app.js](web/app.js)

New, all no-ops returning a clear message unless `db.enabled && config.DB.AUTH`:

- `POST /auth/signup` `{username, password, email?}` — **the claim**: look up the caller's
  current `obstarkey` row and `UPDATE` it with `username/username_lc/passhash/email`. That is
  what carries guest coins, pets and achievements into the new account. No cookie row → insert a
  fresh one. Reject a taken `username_lc`.
- `POST /auth/login` `{username, password}` — on success set `obstarkey` to that row's key and
  issue the session cookie.
- `POST /auth/logout` — clear the session and hand out a fresh guest key, so logging out returns
  you to a clean guest identity rather than leaving the account key in the cookie.
- Extend the **existing** `POST /userData` ([web/app.js:120](web/app.js#L120)) rather than adding
  a `/me` route: it already returns `userdata + coins`; have it also return
  `{loggedIn, username, devlevel}`.

**Two security fixes that become real vulnerabilities the moment accounts exist** (today they
only expose anonymous rows, so they are worth doing in this pass, not later):

1. `/userData` and `/buy` trust `req.body.userKey` ([web/app.js:122](web/app.js#L122),
   [web/app.js:152](web/app.js#L152)). With named accounts that is read-any-account and
   spend-any-account. Change both to read `request.cookies.obstarkey` and ignore the body field;
   drop the `userKey=` parameter from the two XHRs in
   [public/queue.js:86](public/queue.js#L86) and [public/shop.js](public/shop.js).
2. Make the `obstarkey` cookie `httpOnly: true` (all three `respond.cookie` calls). Nothing
   client-side reads it — the menu gets the key via the injected `POST.key`, and `/play` reads
   the cookie server-side — so this is free.

### 1.5 Menu UI — the account chip

- **[views/index.ejs](views/index.ejs)**: add `<div id='account' class='white-box'>` as the first
  child of `.right-zone` (above `#Info`). Collapsed content: an avatar glyph plus either the
  username or `Guest`, and a `Log in` affordance. Move the existing `#coin-box`
  ([views/index.ejs:28](views/index.ejs#L28)) display value here too, or mirror it — the chip is
  the natural home for coins.
- **New `public/account.js`**, loaded next to `queue.js`/`shop.js`. It builds the modal in JS
  exactly the way the leaderboard already does — `document.createElement('DIV')` +
  `classList.add('white-box','hideDiv')` + toggling `#prevent_click`'s `hide-prevent` — i.e.
  copy the shape of `toggleLB` at [public/queue.js:88-140](public/queue.js#L88-L140). Two states:
  - logged out → `[Log in] [Sign up]` tabs, username/password (+ optional email on signup).
  - logged in → account info (username, coins, achievements unlocked, member since) and
    `Log out`.
  Reuse the existing toast for all feedback: the `Mess.send('valid'|'warn'|'abort'|'none', text)`
  helper at [public/shop.js:179-216](public/shop.js#L179-L216) already drives `#messages` and the
  three inline SVG icons in [views/index.ejs:139-159](views/index.ejs#L139-L159). Export it (or
  lift it into a small shared file) rather than writing a second one.
- **[public/style.css](public/style.css)**: `#account` follows the `.white-box` +
  `.right-zone` conventions (width 254px, [public/style.css:45-58](public/style.css#L45-L58));
  the modal copies the `#leadeBox` rules near
  [public/style.css:743-825](public/style.css#L743-L825), including the
  `::-webkit-scrollbar` treatment.

### 1.6 Server-side account flags

[lib/Controller.js:210-239](lib/Controller.js#L210-L239) (`askConnection`) already `SELECT * FROM
acc WHERE userkey = $1`, so `devlevel` and `username` come back for free — stash them on
`this.clients[clientId]`. This is what lets the console gate on an account instead of on a typed
password.

---

## Part 2 — Achievements

### 2.1 Registry — new `public/SHARE/AchievementsConfig.js`

A dual-mode file (`typeof(exports)` footer, same as every other `public/SHARE/*.js`) exporting
an ordered list of `{id, name, desc, icon, hidden}`. Six unreferenced PNGs already ship in
`public/pic/img_mess/` (`mc_penta_slay.png`, `mc_died_penta.png`, `mc_scary_tank.png`,
`achievement.png`, `end.png`, `emo_kawaii_smash.png`) — seed the list from those plus the two
triggers that already exist as one-shot flags: `mess_cursed_score` (xp === 666666,
[entities/Player.js:436-439](entities/Player.js#L436-L439)) and `mess_im_speed` (Rocket with
maxed MSpeed + Reload, [entities/Player.js:446-449](entities/Player.js#L446-L449)).

### 2.2 Triggers and persistence

- Replace those two ad-hoc flags with a single `Player.unlock(id)` that guards on a
  `this.unlocked` set, pushes the toast onto `this.mess` (the existing feed — `Room.getUi` drains
  it at [rooms/Room.js:862-865](rooms/Room.js#L862-L865), rendered by `MES` at
  [public/client/ui.js:812-879](public/client/ui.js#L812-L879)), and asks the Controller to
  persist. The message feed already renders a PNG toast for a `/img <file>` message
  ([public/client/ui.js:824-838](public/client/ui.js#L824-L838)) — that is the unlock popup,
  no new rendering needed.
- `Controller` writes the unlock into `acc.userdata.ach` as `{id: unixTimestamp}` — same
  read-modify-write JSON shape `/buy` already uses at
  [web/app.js:152-172](web/app.js#L152-L172). Batch per player rather than one query per unlock.
- **Guests get `localStorage`.** The play page cannot write the DB for a guest, so on unlock the
  client also writes `obstar.ach` in `localStorage`. On `/auth/signup` the claim POSTs the
  local set along with the credentials and the server **unions** it into `userdata.ach`, keeping
  the earliest timestamp per id. The menu panel reads the account set when logged in and the
  `localStorage` set otherwise.

### 2.3 The hover-expand panel

`<div id='achievements' class='white-box'>` in `.right-zone`, rendered by `public/account.js`
from the shared config:

- Collapsed: a narrow vertical strip of icons.
- On `:hover`: widens via a CSS `transition` (the menu already animates this way —
  `.radio+label` at [public/style.css:479](public/style.css#L479), `#changelogs_info` at
  [public/style.css:503](public/style.css#L503)) and becomes scrollable.
- Scrolling and the scrollbar skin come straight from `.inside_info`
  ([public/style.css:515-541](public/style.css#L515-L541)) — same `overflow-y: auto` + styled
  `::-webkit-scrollbar` treatment, no new CSS idiom.
- Locked entries render greyed; `hidden: true` entries show `???` until unlocked.

---

## Part 3 — Cosmetics console for everyone

Per the decision: the console opens for anyone, but for a non-admin it only accepts **client-side
cosmetic** commands. Nothing new reaches the server, so this adds no attack surface.

- **[public/client/overlay.js:64-78](public/client/overlay.js#L64-L78)** (`General['DEV'].send`)
  currently forwards every line as `PROTO.encode('com', ...)`. Insert a local command table
  first: `color`, `uiscale`, `palette`, `fps`, `help`, plus the existing `clear`. A recognised
  cosmetic is handled locally, echoed to the console, and persisted in `localStorage`; only an
  unrecognised line is forwarded to the server, which still refuses it for a non-admin.
- Cosmetic overrides apply on top of `Palette` / `window.colorPattern` in
  [public/client/config.js:54-59](public/client/config.js#L54-L59) and `CONST.RESOLUTION` — do
  **not** route tank colour through the server's `p.dev.color`
  ([lib/Controller.js:401-412](lib/Controller.js#L401-L412)), because that is broadcast to
  everyone and would let anyone fake a team colour.
- **Admin path**: `lib/Controller.js:242-527` (`command`) drops the
  `connect <password>` → `SELECT * FROM devs` lookup
  ([lib/Controller.js:261-264](lib/Controller.js#L261-L264)) and gates on the `devlevel` that
  `askConnection` now carries. Keep `disconnect`. **Watch two things:**
  - `this.clients[id].dev` (the admin marker) and `Player.dev` (a cosmetics/cheat state bag,
    [entities/Player.js:24](entities/Player.js#L24)) are different things that share a name.
    Only the first one changes.
  - [lib/Controller.js:601](lib/Controller.js#L601) and
    [lib/Controller.js:612](lib/Controller.js#L612) use `!p.dev && isNaN(p.dev)` to keep admins
    off the world-record board. That predicate must keep working against the new flag.
- Update `PENDING.md` #1 to record both resolutions.

---

## Part 4 — Diep feel

### 4.1 Client prediction should match the server (biggest responsiveness win)

[public/client/game.js:154-171](public/client/game.js#L154-L171) uses a fixed accel of `0.31/2`
and drag `0.95^dtFrames`. The server uses
`len = 0.35 + up.MSpeed - level/155` and drag `0.964`, per **tick**
([entities/Player.js:106](entities/Player.js#L106),
[entities/Player.js:122](entities/Player.js#L122)). So today the predicted lead ignores your
Movement Speed upgrades and your level entirely, and decays on a visibly heavier curve — the
faster you actually are, the more the local lead undershoots.

The existing `/2` is already the frames→ticks conversion (33 ms tick ≈ 2 frames at 60 fps).
Fix both numbers, keeping that conversion explicit:

- accel: `(0.35 + mspeedPoints * 0.020 - level / 155)`. The client already has both inputs —
  `General['Ui'].upNb` from `UpdateUp` ([public/client/game.js:728](public/client/game.js#L728))
  and `level` from the `GameUpdate` head. Find the Movement Speed index from the same `ups` list
  `ui.js` already reads at [public/client/ui.js:927](public/client/ui.js#L927) rather than
  hardcoding `4`, since a class may override `ups`.
- drag: `Math.pow(0.964, dtFrames / FRAMES_PER_TICK)` where
  `FRAMES_PER_TICK = NET_TICK / 16.667` (`NET_TICK` is already 33 in
  [public/motion.js:60](public/motion.js#L60)) — not `0.95`.
- Keep the `tolen` decay through `lerpK(CONST.SMOOTH)` — that is the term that walks the offset
  back to zero as the server's answer lands. Lighter drag makes the offset larger, so clamp its
  magnitude and re-feel it once the numbers are honest.

Duplicating the three server constants in the client is the pragmatic move here; note them in
both files so a balance change touches both.

### 4.2 Shiny / rare polygons

The roll already exists and is already on the wire — and the client throws it away.
[entities/Objects.js:96-101](entities/Objects.js#L96-L101) rolls `Math.random() < 0.00004`
(1 in 25 000) → `extra = 1`, hp 10 000, prize 50 000.
[rooms/Room.js:760](rooms/Room.js#L760) sends it as `states[1]`. The client's `Objects` case
reads only `states[0]` ([public/client/game.js:667-670](public/client/game.js#L667-L670)).

- **Config table**: polygon stats are an inline `switch` at
  [entities/Objects.js:71-101](entities/Objects.js#L71-L101) — there is no polygon equivalent of
  `TanksConfig.js`. Lift them into a new dual-mode `public/SHARE/ObjectsConfig.js` with a
  `rarity` tier list (`{name, chance, hpMul, prizeMul, weight, color}`) so the client can render a
  tier without the server telling it anything but the tier number. Start with a *green shiny* at
  a far more findable rate than 1/25 000 and keep the current `extra` values as the top tier.
- **Wire**: `states` is a 7-slot bitfield packed into a uint8 (`CODECS.bits`,
  [public/SHARE/SocketSchema.js:499-502](public/SHARE/SocketSchema.js#L499-L502)) and slots 2-6
  are unused. Widen `extra` into a 3-bit tier across slots 1-3 — **no packet grows, no schema
  field is added**. Only widen the `Objects` record with a real `tier: uint8` field if you ever
  want more than 8 tiers.
- **Render**: add tier colours to `Palette` (today `Palette.alphaSqr === Palette.sqr`,
  [public/client/config.js:54-59](public/client/config.js#L54-L59)) and give a shiny an outline
  glow/shimmer. There is a half-written rainbow path at
  [public/client/entities.js:358-372](public/client/entities.js#L358-L372) keyed on `this.shield`,
  which is **not** an `Objects` wire field and therefore dead — repoint that code at the tier
  instead of adding a parallel path.

### 4.3 HUD rate and a real minimap

Leaderboard, minimap payload and the message feed all ride `longloop`, so they arrive **once per
second** ([net/gameSocket.js:250-286](net/gameSocket.js#L250-L286)), while `GameUpdate` goes out
every 33 ms. And `Room.getUi` sets `map: []` and never fills it
([rooms/Room.js:848-867](rooms/Room.js#L848-L867)), so the minimap draws only your own dot
([public/client/ui.js:881-896](public/client/ui.js#L881-L896)) — the client even stores
`Ui.mapInfo` ([public/client/game.js:735](public/client/game.js#L735)) that nothing reads.

- **Split `UiUpdate` out of `longloop`** into its own `uiloop` on a `UI_MS` config value
  (~150-200 ms), leaving `longloop` to do only what it is for: heartbeat, AFK and rate-limit
  kicks. Follow the deadline-based `nextDelay(this, 'someDue', ms)` pattern the other two loops
  use, and add `UI_MS` next to `SEND_MS` in [lib/config.js](lib/config.js) with a note on why it
  is independent.
- **Fill `map`.** The framing is *already symmetric*: `MSG.UiUpdate` writes
  `data.map.length` ([public/SHARE/SocketSchema.js:724](public/SHARE/SocketSchema.js#L724)) and
  the client reads it back. So this is a clean, conventional schema addition — a
  `SCHEMA.UiUpdate.map` field list (`x`, `y`, `team`, `size`) plus matching `TYPE.UiUpdate.map`
  entries, a `CODEC.map` reusing `CODECS.color`, and one loop each in `MSG`/`PARSE`. Quantise
  `x`/`y` to `uint8`/`uint16` map fractions — a minimap dot needs nothing better, and this rides
  a 5-7 Hz packet. Populate it in `Room.getUi` from `INSTANCE.players.live()` honouring the same
  team/boss rules `this.leader` already uses ([rooms/Room.js:375-403](rooms/Room.js#L375-L403)).
- **Draw them** in `Ui.map` after the existing `User` dot, reading `Ui.mapInfo`.
- Extend [test/proto.js](test/proto.js) with a `UiUpdate` round-trip that includes map records —
  the encoder/decoder pair is the classic place this repo has desynchronised (see the `4team`
  and arrow-key comments in `SocketSchema.js`).

---

## Suggested order

1. Part 1 (schema → `lib/auth.js` → routes + the two security fixes → chip/modal). Self-contained
   and touches no game code.
2. Part 2.1-2.2 (registry + triggers + persistence), then 2.3 (panel).
3. Part 3 — small, but it is the one edit inside `Controller.command`'s permission switch.
4. Part 4, one sub-part at a time: 4.2 and 4.3 are additive; **4.1 changes how the game feels**
   and wants to be felt in a browser on its own, not bundled with anything else.

## Verification

There is no test framework — suites are hand-rolled scripts run by `npm test`
([package.json](package.json), 8 files in [test/](test/)).

- `npm test` and `npm run lint` must stay green after every part. `test/rooms.js` pins the
  three-places-in-sync gamemode invariant and `test/web.js` boots the real `server.js` on a
  throwaway port and asserts the menu, `/play`, static files and the socket all answer.
- **Extend `test/web.js`** with the auth flow, following its existing `request(port, method,
  path, body)` + `check(name, ok, detail)` helpers: guest visit → signup → `/userData` reflects
  the username → logout → login → same coins. Assert `/userData` **rejects** a `userKey` in the
  body that differs from the cookie (the fix in 1.4), and that with `DB.AUTH` off the auth routes
  answer without a 500.
- **Extend `test/proto.js`** with `UiUpdate` map-record round-trips and `Objects` tier bits.
- **DB on**: `docker compose up -d`, set `DB.ON`/`DB.ACC`/`DB.AUTH` true in `lib/config.js`,
  then `npm start`. Note `error.log` currently holds an `ECONNREFUSED` from
  [lib/db.js:19](lib/db.js#L19) — the container is not running right now. `docker compose down -v`
  is required to re-apply `db/schema.sql`, since `docker-entrypoint-initdb.d` only runs against
  an empty data directory.
- **Manual, in a real browser** — unavoidable, and `PENDING.md` #6 notes the client has *never*
  been run in one (only the stub-DOM harness `test/clientDom.js`). Check: chip shows `Guest`;
  signup carries coins over; hover-expand achievements panel scrolls; `Ctrl+Shift+L` accepts
  `color` but refuses an admin command; a green polygon is visibly distinct; minimap shows other
  dots moving smoothly; and 4.1 — drive at level 1 and at level 30 with Movement Speed maxed and
  confirm the tank no longer rubber-bands differently at the two speeds.
- Two IPs is the cap (`config.MAX_IP = 2`), so testing two accounts at once needs two browsers
  and awareness of `ERR_DOUBLE_IP`.

## Open item deliberately left out

The Spade Squad diep physics numbers you mentioned. Part 4.1 fixes the *client/server mismatch*
using the constants already in this repo; retuning the actual movement/knockback/recoil constants
against a reference is a separate balance pass, and `lib/config.js:26-55` is emphatic that every
one of those numbers was hand-tuned against a measured ~29 Hz tick. Send those numbers when you
have them and we will scope that on its own. Note this on handoff when done with everything.
