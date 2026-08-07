additional issues are present:

- in the future, i need to optimize tank creation, so perhaps instead of having this convoluted system where theres tankconfig and i need to keep server and client in sync, can this be massively simplified to just one source of truth? should i make some easier way to construct a tank or is the tankconfig json style stuff the best/most efficient we can do?

- finish the gamemodes one by one

- h to take control of tank needs to be fine tuned and balanced

- to much xp gained too fast?

- UI tests should never be added. I'll verify that irl in the game. Only logic and key tests like for race conditions or subtle logic bugs or similar should be added. I'll need to remove unneccesary tests in the future

- comment pass is needed. comment should only serve to record what is going on logically with the code, and never too verbose, history comments need to be removed, and comments refernecing any plan or files like this need to be removed. commnents should be light.

- game may be too complicated, consider a refactor to simplify if applicable

- survival arena managemetn and arena management in general needs fine tuning.

>One thing worth your attention
A level-45 Overlord's top speed is 485 u/s but its drones' terminal is 229 u/s — the probe confirms a chasing drone peaks at the same 229, so this is pre-existing physics in maxspeed/BULLET_CRUISE_ORDER, not the orbit. Consequence: at full sprint the swarm strings out ~4500 units behind you no matter how good the orbit is. Diep avoids this by only dividing a drone's muzzle kick by 3 (Drone.ts:71) while leaving its cruise thrust equal to a bullet's. If the trailing looks wrong in-game, that's the knob — but it's a balance change touching TanksConfig.js, so I left it alone.
might want to imeplment this lowkey but only for later



also this thing. do this carefully, lowkey have it manually rewrite everything one folder at a time, last time i tried i almost got cooked and it wiped everything bruh


## the commemt thing, i would say do this next!!!!

Delete or rewrite any comment that:
- narrates history ("used to be", "the old form", "this used to", "was broken because",
  "reverted", "no longer", "since PENDING #n", "plan.md step 4", "Batch F", "K1", "C3", "T5").
- cites a plan/task/markdown file by name — `plan.md`, `PENDING.md`, `HANDOFF.md`, `issues.md`,
  `PLAN.md`, `temp.md`, or any bare item code like `#30`, `A4`, `E3`, `G1`.
- restates the code on the line below it.
- runs longer than about four lines without being load-bearing.

**Keep** comments that record a genuine external citation with a durable reference
(`diepcustom/src/...`, `diep_wiki/...`, `diepindepth/...`) where that number would otherwise look
arbitrary — but strip the surrounding narrative down to the citation and the value's meaning.

Suggested order (worst offenders first, by volume):
[public/SHARE/TanksConfig.js](public/SHARE/TanksConfig.js),
[entities/Player.js](entities/Player.js),
[rooms/Room.js](rooms/Room.js),
[public/client/ui.js](public/client/ui.js),
[public/client/config.js](public/client/config.js),
[lib/gameAI.js](lib/gameAI.js),
[entities/Bullet.js](entities/Bullet.js),
[lib/config.js](lib/config.js).

Run the full test suite after each file. A comment pass must not change behaviour; if a test
breaks you deleted code, not a comment.