additional issues are present:

- you should read the diep wiki's pages on these bosses and the features/things noted there should basically be ported over

- in the future, i need to optimize tank creation, so perhaps instead of having this convoluted system where theres tankconfig and i need to keep server and client in sync, can this be massively simplified to just one source of truth? should i make some easier way to construct a tank or is the tankconfig json style stuff the best/most efficient we can do?

- finish the gamemodes one by one
- h to take control of tank needs to be fine tuned and balanced
- to much xp gained too fast?
- UI tests should never be added. I'll verify that irl in the game. Only logic and key tests like for race conditions or subtle logic bugs or similar should be added. I'll need to remove unneccesary tests in the future
- comment pass is needed. comment should only serve to record what is going on logically with the code, and never too verbose, history comments need to be removed, and comments refernecing any plan or files like this need to be removed. commnents should be light.
- game may be too complicated, consider a refactor to simplify if applicable

- issue with m and u in upgrading

- survival needs to be polished (remove respawn text on death screne, proper like matchmaking screen at the start to get enough people etc)

- in general many drone's aggro ranges (tanks and bosses alike) seem quite small and hence needs adjusting

- instead of dragging drones in a sphere, they could act somewhat like the base drone type thing and orbit around the tank? idk

- verify that mothership heals?

- need to audit every drone-spawning class (overlord, overseer, manager, necromancer, guardian, hybrid) for whether drones should auto-spawn continuously or only spawn on click - done for mothership and factory, rest still open
