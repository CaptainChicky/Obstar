additional issues are present:
- intro options screen tries to slide down, fails, then snaps into position? this wasnt here previously
- when you take control of a dominator or mothership, your FOV/identity physically transfers to the dominator, and your old tank will die. currently your fov/id still stays the old tank and you simply control both dominator and your old tank. your old tank still dies, so you quickly die/get brought to the death screen too. instead whats supposed to happen is youre supposed to be transferred over to the dominator as your FOV or mothership as your OFV and control it, your old tank is dead but you dont die because you are now the dominator/mothership and your fov is that boss tank. (you shouldnt be brought ot the death screen when your old tank dies)
- there seems to be some minor visual overlap possible with the maze walls. make even this minor visual overlap impossble

- arena closer bullets should be the size of its barrel, not small af like rn
- same with fallen booster, its bullets should be the size of its barrels

- you should read the diep wiki's pages on these bosses and the features/things noted there should basically be ported over

- factory is even more broken. curretnyl it doesnt even have a tank body. its a square, with a trapezoidal spawner. its drones have diameter 32px if the factory has side length 54px. its drones' barrels poke out around 9px, and 14.5 px width. when you left click on something, the drones dont go to that place like normal triangle drones, but instead go towards, then stops at a distance and starts circling it and attacking with their own turrets. when you right click, outside of a certain distance they repel, but inside a radius of the mouse pointer, they instead cluster together with turrets facing away from the mouse. check diep source imeplemntations for these distances. also read the wiki page on the factory for details.
- there should be a gamemode switcher on the respawn screen somewhere tbh

- defender traps may be too large. defender's 3 autoturrets should be able to indepdnetnly target different things btw whatever one is closer.
- skimmer secondary bullets still not drawn below the main bullet. theyre spawning visible on top of the main
- auto3 and auto5's auto turrets can still go inside the tank itself when you are in sandbox
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