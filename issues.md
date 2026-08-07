additional issues are present:

- you should read the diep wiki's pages on these bosses and the features/things noted there should basically be ported over

- factory is even more broken. curretnyl it doesnt even have a tank body. its a square, with a trapezoidal spawner. its drones have diameter 32px if the factory has side length 54px. its drones' barrels poke out around 9px, and 14.5 px width. when you left click on something, the drones dont go to that place like normal triangle drones, but instead go towards, then stops at a distance and starts circling it and attacking with their own turrets. when you right click, outside of a certain distance they repel, but inside a radius of the mouse pointer, they instead cluster together with turrets facing away from the mouse. check diep source imeplemntations for these distances. also read the wiki page on the factory for details.

- factory is so fucking broken lmao, no sprite on upgrade screen, the actions it can do are fucked etc
- when you turn into a factory and then kill yourself with "o" in sandbox:
        Uncaught InvalidStateError: Failed to execute 'drawImage' on 'CanvasRenderingContext2D': The image argument is a canvas element with a width or height of 0.
            at Object.draw (game.js:350:10)
            at Draw (game.js:600:9)
            at Loop (game.js:686:4)


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

- need to audit every drone-spawning class (overlord, overseer, manager, necromancer, guardian, factory, hybrid) for whether drones should auto-spawn continuously or only spawn on click, same as just fixed for mothership
