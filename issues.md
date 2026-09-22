# Issues & TODO

## Open

- **Finish gamemodes one by one** — sandbox gaps (party links, arena/shape scaling, bosses
  after 50–60 min), survival arena management, mothership/survival polish.

- **Game complexity** — consider a refactor to simplify if applicable.

- **Survival arena management** and arena management in general needs fine tuning.

- **FFA area size changing** - the arena should be scaling live ig we will see what basesize should be and how it scales etc. also arena closing when etc

this needs a toggle later we will see:
Diep (wiki + diepcustom): you get the victim’s level score, capped at 23,537. A 1M tank still gives 23,537.

Obstar uses pow(xp/mlx, 1.8), then 10% of score past level 43. Versus diep that is:

Worse for almost everyone (a ~6k tank gives ~2,280 vs diep ~5,500–6,200)
About even around a fresh 45
More only after the victim is a whale (~45k+). A 1M tank gives ~119k vs diep’s 23,537

## Testing policy

UI tests should never be added. Verify those in-game (sandbox, tester mode). Only logic and
key tests for race conditions, subtle logic bugs, or anything that can't be easily tested by
playing should be added.
