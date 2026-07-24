# Pending & Decisions

Short-form companion to [HANDOFF.md](HANDOFF.md). Everything mechanical (the refactor, §1–9,
§12.1–12.2) is done and tested — this doc is only what's *left*: things needing a human call,
decisions already made but not yet built, and things nobody has verified yet. No status prose,
just the list.

---

*The game is being remade from scratch: the DB will be emptied and rebuilt, and nothing
documented from the old dev (naming, MySQL, anything below) needs a migration path or
backward-compat story. Old conventions are defaults to improve on, not constraints.*

## 🔴 Decisions on game direction (need your call)


## 🔵 Decided — queued for implementation (not yet built)

1. **DB: decided on Postgres, not yet built.** Bypasses MySQL entirely — currently off,
   accounts/shop/leaderboard all bypassed. Reasoning: SQLite is the simpler local-dev option
   (`better-sqlite3`, single file, no server process, zero ops) but doesn't hold up if this
   scales toward many concurrent rooms across processes/machines (arras.io/diep.io territory),
   since it's single-writer-friendly rather than built for concurrent networked access. Postgres
   costs more up front only operationally — one more service to run locally (a one-file
   `docker-compose.yml` postgres service is the common approach) — not in code: `lib/dbConfig.js`
   already has the `DB_HOST`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` env-var shape from the MySQL setup,
   so swapping the `pg` driver in for `mysql2` is comparable effort to wiring up `better-sqlite3`.
   Deploying later, managed Postgres is a one-click add-on on most hosts (Railway, Render,
   Fly.io, Supabase, RDS). Since the DB is being wiped anyway there's no legacy-data migration
   cost either way. Not yet implemented — MySQL code paths are still what's wired to `mysql2`.
   For logged-out players, `localStorage` (not just a cookie — more space, doesn't ride every
   request) holding XP/coins/achievements is the common pattern for this genre; treat it as
   client-editable/untrusted if it ever feeds a leaderboard.

2. **Next gamemodes: Domination/Maze get real new entity types.** Decided — not tunable-only.
   Needs: a new `kind` in `public/SHARE/kinds.js` for static geometry (walls) and one for capturable
   structures; a static (no `step()`) entity class with its own `collision()`; quadtree
   insertion for that static geometry; a wire-schema addition (`SocketSchema.js`) so the client
   can draw walls/structures; team-ownership state on capturable structures synced over the
   wire. New `kind`s go in `public/SHARE/kinds.js`, which `TanksConfig.js`'s `DETEC` filters
   now reference by constant (#16 done) rather than hardcoding — nothing to keep in sync by hand.

## 🟢 Untested — real risk, nobody has watched these happen

6. A full match, start to finish: leveling into the class tree, death screen, respawn.
7. Two real humans in the same room (only single-player/single-tab has been tested).
8. Boss AI behavior — bosses are *created* under test, nothing has watched them act.
9. The client in an actual browser (only a stub-DOM harness has run it — no real frame timing,
   no tab throttling).
10. MySQL code paths — fixed by code review only, never executed (DB is off).
11. Admin commands, chat, the shop, and the leaderboard-write flow.
12. Real browser hitting the new packet-length validation (`chat`/`com` in particular) — a
    mistake here shows up as a kicked player, not a crash.
13. Load: multiple busy rooms at once on one process (everything so far is one room alone).

## ⚪ Optional cleanup — no urgency, no bug, do only if you want it

14. Break the circular module graph (`lib/runtime.js` stopgap) with real dependency injection — big change, only worth it once everything else is settled.

---

*See HANDOFF.md's "Read this before you touch anything" (tick rate), "Test coverage" (untested
areas), and "The client" (`Instances` sparse-array note) sections for the reasoning behind any
item above.*
