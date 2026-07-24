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

1. **Real login, and what the dev console means for a regular player.** Right now there's no
   login UI at all — every visitor just gets a random 25-char key in a cookie (HANDOFF.md
   §1/§8), and `Ctrl+Shift+L` opens the same dev console for literally anyone; it only does
   anything once you pass `connect <password>` against the `devs` table. Two open questions,
   possibly resolved together:
   - A real front-page login (username/password or otherwise) instead of the anonymous cookie.
   - What non-admins get from that keyboard shortcut, if anything. Options run from "nothing —
     console stays admin-gated, as today" to a diep.io-style client-side "script" console
     everyone can open, scoped to cosmetics only (tank color/UI customization) with no command
     execution or server access. Not designed yet — needs a concrete decision before either
     side gets built.

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
5. Boss AI behavior — bosses are *created* under test, nothing has watched them act.
6. The client in an actual browser (only a stub-DOM harness has run it — no real frame timing,
   no tab throttling).
7. Chat over a real client connection — admin commands are now proven end-to-end over a real
   socket against Postgres (connect/disconnect, permission gating, `broadcast`, `tps` all
   confirmed live), but chat hasn't been exercised the same way.
8. Real browser hitting the new packet-length validation (`chat`/`com` in particular) — a
    mistake here shows up as a kicked player, not a crash.
9. Load: multiple busy rooms at once on one process (everything so far is one room alone).

## ⚪ Optional cleanup — no urgency, no bug, do only if you want it

10. Break the circular module graph (`lib/runtime.js` stopgap) with real dependency injection — big change, only worth it once everything else is settled.

---

*See HANDOFF.md's "Read this before you touch anything" (tick rate), "Test coverage" (untested
areas), and "The client" (`Instances` sparse-array note) sections for the reasoning behind any
item above.*
