# Issues & TODO

## Open

- **TankConfig single source of truth** — currently two hand-synced halves (client/server) in
  `TanksConfig.js`. Consider simplifying to one authoritative table that derives both sides.
  Boss geometry (Defender, Summoner, Mothership) is now cross-checked by `test/rooms.js`, but
  ordinary-tank client/server drift has no automated guard since `test/tanks.js` was removed
  (its `diepCitations()` assumed the normal-tank barrel identity for boss-scale entities too,
  so it broke on correct boss geometry fixes). Restoring a tanks cross-check that handles the
  boss conversion would close the gap.

- **Finish gamemodes one by one** — sandbox gaps (party links, arena/shape scaling, bosses
  after 50–60 min), survival arena management, mothership/survival polish.

- **H to take control** of Dominator/Mothership needs fine tuning and balancing.

- **XP gain rate** — too much xp gained too fast?

- **Summoner/Guardian drone push-through** — their drones should not push the boss body, just
  phase through as if same team. Fallen Overlord already has this. Also: a player controlling
  Guardian or Summoner should be able to steer drones (currently only Fallen Overlord's work).
  See PENDING.md's "Boss `canControlDrones` possession" for the full scope.

- **Overlord drone trailing** — at full sprint the swarm strings out ~4500 units behind. Diep
  avoids this by only dividing a drone's muzzle kick by 3 while leaving cruise thrust equal to
  a bullet's. Balance change touching TanksConfig.js — for later.

- **Game complexity** — consider a refactor to simplify if applicable.

- **Survival arena management** and arena management in general needs fine tuning.

## Comment cleanup pass

Strip cross-file references/change history, keep functional statements. Comments should only
record what is going on logically with the code — never too verbose, no history, no references
to plan.md / PENDING.md / HANDOFF.md / issues.md or bare item codes.

Delete or rewrite any comment that:
- narrates history ("used to be", "the old form", "was broken because", "reverted", etc.)
- cites a plan/task/markdown file by name or bare item code (`#30`, `A4`, `E3`, `G1`)
- cites an external reference repo (`diepcustom/src/...`, `diep_wiki/...`, `diepindepth/...`)
- restates the code on the line below it
- runs longer than about four lines without being load-bearing

Suggested order (worst offenders first, by volume):
`public/SHARE/TanksConfig.js`, `entities/Player.js`, `rooms/Room.js`,
`public/client/ui.js`, `public/client/config.js`, `lib/gameAI.js`,
`entities/Bullet.js`, `lib/config.js`.

Run the full test suite after each file. A comment pass must not change behaviour; if a test
breaks you deleted code, not a comment. Do it one folder at a time — last time a batch attempt
wiped things.

### Progress

| Folder | Status |
|---|---|
| `/db` | DONE |
| `/entities` | DONE except `Bullet.js` |
| `/lib` | DONE |
| `/net` | DONE |
| `/views` | DONE |
| `/web` | DONE |
| `/public` | pending |
| `/rooms` | pending |
| `/test` | pending |
| root (`eslint.config.js`, `server.js`) | pending |

## Testing policy

UI tests should never be added. Verify those in-game (sandbox, tester mode). Only logic and
key tests for race conditions, subtle logic bugs, or anything that can't be easily tested by
playing should be added.
