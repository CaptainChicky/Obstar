additional issues are present:
- arena closer bullets should be the size of its barrel, not small af like rn
- same with fallen booster, its bullets should be the size of its barrels

- you should read the diep wiki's pages on these bosses and the features/things noted there should basically be ported over

- factory is even more broken. curretnyl it doesnt even have a tank body. its a square, with a trapezoidal spawner. its drones have diameter 32px if the factory has side length 54px. its drones' barrels poke out around 9px, and 14.5 px width. when you left click on something, the drones dont go to that place like normal triangle drones, but instead go towards, then stops at a distance and starts circling it and attacking with their own turrets. when you right click, outside of a certain distance they repel, but inside a radius of the mouse pointer, they instead cluster together with turrets facing away from the mouse. check diep source imeplemntations for these distances. also read the wiki page on the factory for details.

- defender traps may be too large. defender's 3 autoturrets should be able to indepdnetnly target different things btw whatever one is closer.
- guardian doesnt seem to spawn enough drones? also crosscheck summoner, fallenoverlord
- the summoner's squares are the same color as its main body. The color of it needs to be like the beige orange of a necromancer's bullets
- booster and ac's bullets shoudl be the width of their scaled up barrels
- factory is so fucking broken lmao, no sprite on upgrade screen, the actions it can do are fucked etc
- when you turn into a factory and then kill yourself with "o" in sandbox:
        Uncaught InvalidStateError: Failed to execute 'drawImage' on 'CanvasRenderingContext2D': The image argument is a canvas element with a width or height of 0.
            at Object.draw (game.js:350:10)
            at Draw (game.js:600:9)
            at Loop (game.js:686:4)


- in the future, i need to optimize tank creation, so perhaps instead of having this convoluted system where theres tankconfig and i need to keep server and client in sync, can this be massively simplified to just one source of truth? should i make some easier way to construct a tank or is the tankconfig json style stuff the best/most efficient we can do?

- add the selection colors/animation screen for mothership, survival, tester
- finish the gamemodes one by one
- hitboxes for arena closer, bosses, mothership, dominators arent right the hitbox should be their circular body but its less fsr.
- mothership drones should be above it, check all drones for this they shoudl be above their tanks tbh
- h to take control of tank needs to be fine tuned and balanced
- too many upgrade points?
- UI tests should never be added. I'll verify that irl in the game. Only logic and key tests like for race conditions or subtle logic bugs or similar should be added. I'll need to remove unneccesary tests in the future
- dominator FOV is still broken, despite mothership being fixed
- comment pass is needed. comment should only serve to record what is going on logically with the code, and never too verbose, history comments need to be removed, and comments refernecing any plan or files like this need to be removed. commnents should be light.
- game may be too complicated, consider a refactor to simplify if applicable
- auto3 and auto5 turrets should be abe to do multi targetting. each turret should be able to lock onto the closest target and fire indepdenently. currnetly everything j ust picks one target.
- This tanks.js failure is pre-existing (missing an external diepcustom reference repo used only by that test's citation-checker, unrelated to task 6) trhis test needs to be REMOVED wtf tests should only refernece stuff in the actual working code, not refernece files that are gitignored