# Pending & Decisions

Short-form companion to [HANDOFF.md](HANDOFF.md). Everything mechanical (the refactor, §1–9,
§12.1–12.2) is done and tested — this doc is only what's *left*: things needing a human call,
and things nobody has verified yet. No status prose, just the list.

---

## 🔴 Decisions on game direction (need your call)

1. **MySQL** — bring it back, swap to SQLite/Postgres, or drop persistence entirely? Currently
   off; accounts/shop/leaderboard are all bypassed.
2. **Next gamemodes** — Domination/Maze want *new mechanics* (capturable structures, static
   walls), not just new tunables like the current 4 modes. Worth building that entity type, or
   stick to tunable-only modes?
3. **Tick rate: keep 33ms or retune for 20ms (50Hz)?** 33ms matches how the game has always
   actually played and been balanced. 20ms is what the code always *claimed* but never hit —
   doing it means a full balance pass plus ~2x CPU per room. Not a bug either way, pure design
   call. (Detail: HANDOFF §3.1, §10.)

## 🟡 Flagged possible bugs (deliberately left unfixed — need a ruling)

4. **Shielded bot never picks a random facing.** Dead code was removed that *would* have
   randomized a freshly-shielded bot's heading, but it sat after a `return` so it never ran
   anyway — deleting it changed nothing. Was this intended behavior that never shipped? If yes,
   the fix is moving the block above the `return`. (`lib/gameAI.js`)
5. **Stale `DETEC` (auto-aim cone) after evolving out of an auto-aim class.** A disabled
   `if(false)` reset was removed (no behavior change). Players who evolve out of an auto-aim
   class keep the old vision-cone object. Harmless leftover, or worth clearing? (`entities/Player.js`)

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

14. **`Instances` sparse-array → `Map`/dense structure.** Profiled: costs ~0.01–0.04% of frame
    budget today, and still only ~1.7% at 3000 entities. Not a performance problem. Only worth
    doing for code clarity, not speed.
15. Break the circular module graph (`lib/runtime.js` stopgap) with real dependency injection —
    big change, only worth it once everything else is settled.
16. `TanksConfig` has 3 hardcoded entity-type literals that can't reference `lib/kinds.js`
    (browser can't `require()` it). Noted so a future kind-to-int change doesn't miss them.
17. CSS lives in 4 places (`style.css`, `LeaderBoard.css`, `fontStyle.css`, inline in `play.ejs`).
    Cosmetic, real debt.

---

*See HANDOFF.md's "Read this before you touch anything" (tick rate), "Test coverage" (untested
areas), and "The client" (`Instances` sparse-array note) sections for the reasoning behind any
item above.*
