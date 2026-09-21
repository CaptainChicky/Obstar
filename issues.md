# Issues & TODO

## Open

- **Overlord/controlalboe drone class is kinda meh rn** - the idling orbits, and the chasing 
  is still kinda meh. finish this later ig

- **Finish gamemodes one by one** — sandbox gaps (party links, arena/shape scaling, bosses
  after 50–60 min), survival arena management, mothership/survival polish.

- **XP gain rate** — too much xp gained too fast?

- **Game complexity** — consider a refactor to simplify if applicable.

- **Survival arena management** and arena management in general needs fine tuning.

## Testing policy

UI tests should never be added. Verify those in-game (sandbox, tester mode). Only logic and
key tests for race conditions, subtle logic bugs, or anything that can't be easily tested by
playing should be added.
