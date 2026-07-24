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

1. **MySQL** — bring it back, swap to SQLite/Postgres, or drop persistence entirely? Currently
   off; accounts/shop/leaderboard are all bypassed. Since the DB is being wiped anyway, there's
   no legacy-data reason to pick MySQL specifically — a locally-run option (e.g. SQLite via
   `better-sqlite3`, single file, no server process) fits "should run locally" better, unless
   you want networked/multi-instance DB access later. For logged-out players, `localStorage`
   (not just a cookie — more space, doesn't ride every request) holding XP/coins/achievements is
   the common pattern for this genre; treat it as client-editable/untrusted if it ever feeds a
   leaderboard. Still your call on the actual tech.

## 🔵 Decided — queued for implementation (not yet built)

2. **Next gamemodes: Domination/Maze get real new entity types.** Decided — not tunable-only.
   Needs: a new `kind` in `lib/kinds.js` for static geometry (walls) and one for capturable
   structures; a static (no `step()`) entity class with its own `collision()`; quadtree
   insertion for that static geometry; a wire-schema addition (`SocketSchema.js`) so the client
   can draw walls/structures; team-ownership state on capturable structures synced over the
   wire. Touches `TanksConfig.js`'s 3 hardcoded `DETEC` literals too if new kinds shift anything
   there (see #16).

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

14. **`Instances` sparse-array → `Map`/dense structure.** Profiled: costs ~0.01–0.04% of frame budget today, and still only ~1.7% at 3000 entities. Not a performance problem. Only worth doing for code clarity, not speed. *Evaluated and left as-is:* `{oId: <index>}` IDs are the array index and travel the wire, and the sparse-slot idiom is load-bearing across server, client and quadtree — a genuine `Map` conversion is a broad, risky change on the order of #15, not a low-risk clarity tidy, so it stays deferred.
15. Break the circular module graph (`lib/runtime.js` stopgap) with real dependency injection — big change, only worth it once everything else is settled.
16. `TanksConfig` has 3 hardcoded entity-type literals that can't reference `lib/kinds.js` (browser can't `require()` it). The coupling can't be removed, but the pointer was one-way (`kinds.js` → TanksConfig); *added the reverse comment* at each of the 3 `DETEC` literals so an editor there sees the `lib/kinds.js` dependency without already knowing about it.

---

*See HANDOFF.md's "Read this before you touch anything" (tick rate), "Test coverage" (untested
areas), and "The client" (`Instances` sparse-array note) sections for the reasoning behind any
item above.*
