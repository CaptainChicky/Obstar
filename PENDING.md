# Pending & Decisions

Short-form companion to [HANDOFF.md](HANDOFF.md). Everything mechanical (the refactor, §1–9,
§12.1–12.2) is done and tested — this doc is only what's *left*: things needing a human call,
decisions already made but not yet built, and things nobody has verified yet. No status prose,
just the list.

---

*The game is being remade from scratch: the DB will be emptied and rebuilt, and nothing
documented from the old dev (naming, MySQL, anything below) needs a migration path or
backward-compat story. Old conventions are defaults to improve on, not constraints.*

## ✅ Resolved this pass (see THEPLAN.md for the full spec that was implemented)

1. **Real login, and what the dev console means for a regular player.** Both built.
   - Guest-first + claim: every visitor still gets an anonymous `obstarkey` row; `POST
     /auth/signup` attaches `username`/`passhash`/`email` to that *same* row (carrying over
     coins/pets/achievements), `POST /auth/login` swaps the cookie to the claimed account's key,
     `POST /auth/logout` hands back a fresh guest identity. All gated behind `DB.AUTH` (off by
     default) and degrade to a clean `{error}` JSON with no DB, never a 500 — see `lib/auth.js`,
     `web/app.js`, and the two security fixes (`/userData`/`/buy` now read only
     `req.cookies.obstarkey`, never a body field; `obstarkey` is `httpOnly`).
   - `Ctrl+Shift+L` now opens for everyone. A non-admin gets a client-side-only cosmetics table
     (`color`, `uiscale`, `palette`, `fps`, `help`, `clear` — `public/client/overlay.js`);
     anything else still gets forwarded to the server and still refused there unless
     `askConnection` attached a nonzero `devlevel` (replaces the old plaintext `devs` table).
   - **Still needs a real browser** to confirm the account chip/modal and the cosmetics console
     actually feel right end to end — see item 6 below.

1b. **Achievements** (not in the original numbered list — added alongside #1 since it shares the
    login/account plumbing). `public/SHARE/AchievementsConfig.js` is the registry;
    `Player.unlock()`/`registerKill()` fire it server-side and persist into `acc.userdata.ach` via
    `Controller.disconnect()`; guests get `localStorage['obstar_ach']`, unioned into the account
    on claim. The menu-page panel is a right-edge hover zone (`public/account.js` +
    `#ach-edge` in `views/index.ejs`/`public/style.css`) — icon-only, auto-scrolling, pauses on a
    real wheel/touch scroll. **Needs a real browser** to confirm the hover/scroll feel.

## 🔵 Decided — queued for implementation (not yet built)

2. **Next gamemodes: Domination/Maze get real new entity types.** Decided — not tunable-only.
   Needs: a new `kind` in `public/SHARE/kinds.js` for static geometry (walls) and one for capturable
   structures; a static (no `step()`) entity class with its own `collision()`; quadtree
   insertion for that static geometry; a wire-schema addition (`SocketSchema.js`) so the client
   can draw walls/structures; team-ownership state on capturable structures synced over the
   wire. New `kind`s go in `public/SHARE/kinds.js`, which `TanksConfig.js`'s `DETEC` filters
   now reference by constant (#16 done) rather than hardcoding — nothing to keep in sync by hand.

## 🟢 Untested — real risk, nobody has watched these happen

3. A full match, start to finish: leveling into the class tree, death screen, respawn.
4. Two real humans in the same room (only single-player/single-tab has been tested).
5. Boss AI behavior — no longer entirely unwatched: `test/rooms.js` now drives a Summoner
   through two real `step()`s and asserts it actually adds a nearby player to `this.detected`,
   which caught a real bug (below) rather than just proving bosses *exist*. Still never watched
   in a live match with a human moving around it, though.
   - **Bug found and fixed**: `rooms/Room.js`'s `respawn()` swaps in a brand-new `RT.Player`
     object and was not carrying over `inputs`, `userKey`, `unlocked`, or `killCounts` from the
     tank it replaced. A movement key held through the moment of death stayed physically held
     but arrived on the new tank looking exactly like "never pressed" (the client only re-sends
     `keydown` on an actual state change) — and since `shield` (spawn protection) only clears
     inside `motion()`/`shoot()` when they see real input, that silently extended spawn
     protection, which `Detector.js` hides from every boss/bot, until the player happened to
     press something new. Losing `userKey` also meant `Controller.disconnect()`'s achievement
     write-back silently no-op'd for the rest of the session after a single death. Also floored
     `lib/gameAI.js`'s Summoner distance divide (`n.level` → `Math.max(1, n.level)`) — level 0 is
     real for one tick on every join/respawn and made the divide `Infinity`.
6. The client in an actual browser (only a stub-DOM harness has run it — no real frame timing,
   no tab throttling). This pass touched rendering/feel more than anything before it has, so the
   in-browser checklist is longer than usual:
   - Account chip shows `Guest`; signing up carries coins over; the achievements edge-hover zone
     (item 1b) darkens/scrolls the way it's supposed to and a manual scroll actually pauses the
     auto-scroll.
   - `Ctrl+Shift+L` accepts `color`/`uiscale`/etc. and refuses an admin command for a non-admin.
   - Bullets visibly leave from the barrel tip, including while strafing hard perpendicular to
     the aim direction (this was reported broken and fixed — see `public/client/game.js`'s
     `BULLET_MINE_RADIUS` heuristic; there's no real owner field on the wire, so this is a
     proximity guess, not a certainty).
   - The camera has a *slight* trailing lag again (`CONST.CAM_SMOOTH`) — confirm it reads as a
     hair of chase, not the old pre-refactor drift.
   - A green "shiny" polygon and a rainbow "Mythic" one are both visibly distinct from an
     ordinary shape (`public/SHARE/ObjectsConfig.js` — chances were retuned rarer than the
     first-pass defaults; confirm they still turn up often enough to notice in a normal session).
   - The minimap shows other players' dots, not just your own, moving smoothly (`Room.getUi`'s
     `map`, `Ui.map()` in `public/client/ui.js`).
   - Level 1 vs. level 30 with Movement Speed maxed: confirm the tank no longer rubber-bands
     differently at the two speeds (`public/client/game.js`'s prediction constants now match
     `entities/Player.js`'s exactly instead of a stale, unscaled guess).
7. Chat over a real client connection — admin commands are now proven end-to-end over a real
   socket against Postgres (connect/disconnect, permission gating, `broadcast`, `tps` all
   confirmed live), but chat hasn't been exercised the same way.
8. Real browser hitting the new packet-length validation (`chat`/`com` in particular) — a
    mistake here shows up as a kicked player, not a crash.
9. Load: multiple busy rooms at once on one process (everything so far is one room alone).

## 🟡 Explicitly deferred (told not to do this pass)

11. The Spade Squad diep-physics balance pass. Part 4.1 of THEPLAN.md fixed the *client/server
    mismatch* in the existing movement constants (accel, drag, tick conversion) so prediction
    matches what the server actually does — it deliberately did not retune the underlying
    movement/knockback/recoil numbers themselves against any external reference. `lib/config.js`
    is explicit that every one of those was hand-tuned against a measured ~29Hz tick; retuning
    them is its own pass, to be scoped once real reference numbers are available.

## ⚪ Optional cleanup — no urgency, no bug, do only if you want it

10. Break the circular module graph (`lib/runtime.js` stopgap) with real dependency injection — big change, only worth it once everything else is settled.

---

*See HANDOFF.md's "Read this before you touch anything" (tick rate), "Test coverage" (untested
areas), and "The client" (`Instances` sparse-array note) sections for the reasoning behind any
item above.*
