# BATCHES.md — execution plan for the remaining Obstar issues

Obstar is a diep.io-style tank game: Node game server in `lib/` `rooms/` `entities/`, browser
client in `public/client/`, shared server+client config in `public/SHARE/`. Issues live in
`issues.md`; running notes in `PENDING.md`.

---

## HOW TO RUN A SESSION  (drop this into Claude Code)

> Read `BATCHES.md` and `PENDING.md`. Work the single highest-priority **OPEN** batch below
> (skip anything marked DONE). Do only that batch this session.
>
> Rules that keep you from stalling:
> - Open **only** the files the batch names. `grep` to the relevant region — do **not** read
>   `Room.js` / `TanksConfig.js` / `gameAI.js` end-to-end (they're 114 KB / 142 KB / 54 KB).
> - The local **`diep_wiki/`** folder is the authority for boss behaviour — open the named
>   `.txt`. Don't rely on memory or the network.
> - Every `px` figure in a geometry batch is an **acceptance test**, not a suggestion.
> - Per issue: (1) one-line diagnosis, (2) the edit, (3) run the relevant test.
> - Finish the whole batch before summarizing. End by updating `PENDING.md` (done / still-open)
>   and nothing else. Don't paste file contents back into chat.

### Verify before you finish (non-negotiable)
- `npm install` once, then `npm test` is the safety net — it must stay green.
- **Golden:** `test/clientDiff.js` pins the client's entire canvas-op stream as `{count, hash}`
  (currently `281738 / 3e2fc0d8`). A **server-logic** change should NOT move it. A deliberate
  **visual** change (geometry, draw order, projectile sprites) WILL — that's expected. When it
  does: re-run `OBSTAR_DIFF_CAPTURE=1 node test/clientDiff.js`, confirm the new count/hash reflect
  **only** your intended change, then paste them into `GOLDEN` in that file with a one-line note
  (which batch + why). **Never** rebaseline to make an unexplained diff pass.
- For a **logic** batch, add/extend an assertion test for the new behaviour. Pattern to copy: the
  maze-spawn test in `test/rooms.js` ("no player ever spawns inside a maze wall").

---

## Batch E — Maze wall and shape/player overlap  *(spawn half already DONE)*
**Files:** `lib/mazeGenerator.js`, `rooms/Maze.js`, and others
- **A Player tank or a shape** can overlap with the maze wall a little bit (up to 1 grid square)
  visually. in diep.io, this overlap is minimal like 1/10th of a grid square and the maze wall has 
  a mild bounciness to it and expells everything frmo the wall imemdaitely. there should be minimal
  overlap possible between shapes/tanks and the maze walls.

---

## Batch F — Dominator / Mothership takeover (FOV transfer)  *(standalone, architectural)*
**Files:** `entities/Player.js`, `net/gameSocket.js`, `rooms/Room.js`, `public/client/game.js`.
- On takeover your identity/camera must move to the boss; the old tank dies but **you don't** (you
  *are* the boss now). Two sides: server — reassign which entity the socket "is" (camera/FOV
  target); client — the death-screen trigger keys off *your* entity dying, so re-point it at the
  **new** entity so the old body's death doesn't open `END`.
- **Accept:** taking a dominator/mothership moves the camera onto it, you control only it, and the
  old body dying does not open the death screen.

---

## Batch G — UI flow
**Files:** `public/client/ui.js`, `public/client/game.js`, `views/`.
- **Intro options screen:** slides down, fails, then snaps (regression) — fix the panel ease-in, fine on firefox, BUG on chrome.
  this may be something that is happening locally with my comptuer or browser (i havent restarted to check). verify on your end
  if there is anything fixable/and fix, and tell me if there is no issue and its just my end.
- **Respawn gamemode switcher:** `ui.js`'s `END` is canvas-only with no hit-testing and the only
  route to another mode is `POST /play`, so this needs a click region on `END`, a navigation path,
  and a socket-close before the call. Build it fully or leave it — don't half-build.