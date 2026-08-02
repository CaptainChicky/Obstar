/*
	Entity rendering and the world background.

	Both halves are built once per Run() rather than at load, exactly where the monolith built
	them: General.background closes over Run()'s `ctx`, and the three cache builders allocate
	off-screen canvases that have to appear in the same order they always did.
*/
(function (CLIENT) {
	const CONST = CLIENT.CONST;
	const CLASS = CLIENT.CLASS;
	const Palette = CLIENT.Palette;
	const Global = CLIENT.Global;
	const Game = CLIENT.Game;
	const General = CLIENT.General;
	const Drawings = CLIENT.Drawings;
	///
	CLIENT.initRender = function () {
		///
		General['drawTank'] = General['drawTank'] || (() => {
			const can = document.createElement('CANVAS');
			const ctxx = can.getContext('2d');
			const R = CONST.OFFCAN;
			const Coord = {};
			///
			function setCoord(config) {
				let middleX = 0, middleY = 0, canSize = CONST.SIZE / 2 + CONST.LINEWIDTH;
				const marge = 2;
				///
				if (config.cannons && config.cannons.length) {
					for (const c of config.cannons) {
						///
						// `+ (c.distance||0)` (plan.md T5): a barrel/turret pushed out from the
						// hull needs that much more canvas headroom or a ring member (Auto 3/5)
						// clips at the edge of its own offscreen cache. Triangle-inequality
						// upper bound, not exact - harmless slack, never clips.
						const len = (c.distance || 0) + Math.sqrt(
							Math.pow(c.height, 2) +
							Math.pow(c.width / 2 + c.offx + c.open / 2, 2)
						) + CONST.LINEWIDTH;
						canSize = Math.max(canSize, len);
						///
						const cos = Math.cos(c.offdir), sin = Math.sin(c.offdir);
						middleX += cos * Math.max(0, c.height - CONST.SIZE / 2) + sin * c.offx;
						middleY += sin * Math.max(0, c.height - CONST.SIZE / 2) + cos * c.offx;
					}
					middleX /= config.cannons.length * 2;
					middleY /= config.cannons.length * 2;
				}
				if (config.turrets && config.turrets.length) {
					for (const c of config.turrets) {
						///
						// `+ (c.distance||0)` (plan.md T5): a barrel/turret pushed out from the
						// hull needs that much more canvas headroom or a ring member (Auto 3/5)
						// clips at the edge of its own offscreen cache. Triangle-inequality
						// upper bound, not exact - harmless slack, never clips.
						const len = (c.distance || 0) + Math.sqrt(
							Math.pow(c.height, 2) +
							Math.pow(c.width / 2 + c.offx + c.open / 2, 2)
						) + CONST.LINEWIDTH;
						canSize = Math.max(canSize, len);
						///
						const cos = Math.cos(c.offdir), sin = Math.sin(c.offdir);
						middleX += cos * Math.max(0, c.height - CONST.SIZE / 2) + sin * c.offx;
						middleY += sin * Math.max(0, c.height - CONST.SIZE / 2) + cos * c.offx;
					}
					middleX /= config.turrets.length * 2;
					middleY /= config.turrets.length * 2;
				}
				// Guards/launcher (plan.md R4) - drawn at `sizeRatio x param.size`, so in these
				// same reference units their headroom contribution is `sizeRatio x CONST.SIZE`.
				// Smasher/Landmine/Spike have no cannons/turrets at all, so without this their
				// spinning guard shape clips at the tiny default canvas edge.
				if (config.guards) {
					for (const g of config.guards) {
						// Matches Drawings.guards' own radius: `sizeRatio x (size + LINEWIDTH/2)`,
						// plus its stroke's own outward half.
						canSize = Math.max(canSize,
							g.sizeRatio * (CONST.SIZE + CONST.LINEWIDTH / 2) + CONST.LINEWIDTH);
					}
				}
				if (config.launcher) {
					canSize = Math.max(canSize, 1.852 * CONST.SIZE + CONST.LINEWIDTH);
				}
				// `pronounced` (plan.md A4) reaches `centre + len/2 = 1.3 x size` at most - same
				// headroom reasoning as guards/launcher above.
				if (config.pronounced) {
					canSize = Math.max(canSize, 1.3 * CONST.SIZE + CONST.LINEWIDTH);
				}
				// `dompronounced` (plan.md E2) reaches `centre + len/2 = 1.22 x size` at most -
				// same headroom reasoning as guards/launcher/pronounced above.
				if (config.dompronounced) {
					canSize = Math.max(canSize, 1.22 * CONST.SIZE + CONST.LINEWIDTH);
				}
				// mX/mY is the sprite's own visual centre-of-mass OFFSET from the hull centre -
				// how far the barrels drag the silhouette off-centre - and the two panels that
				// read it (ui.js's class picker and death screen) subtract it to keep the tank
				// centred in its slot. A class with no cannons and no turrets (Smasher, Landmine,
				// Spike) is a bare body, already centred, so that offset is ZERO. It used to be
				// set to `canSize`, half the offscreen canvas - which the class picker then
				// subtracted from the tile centre and spun on its own rotation, so a Smasher
				// visibly ORBITED the slot instead of sitting in it.
				if (!(config.cannons && config.cannons.length) && !(config.turrets && config.turrets.length)) {
					middleX = 0;
					middleY = 0;
				};
				canSize = canSize * 2 + marge * 2;
				///
				return {
					mX: middleX,
					mY: middleY,
					size: canSize,
					marge: marge
				}
			};
			///
			return (ctx, isOpac, param) => {
				let tank, coord;
				if (CLASS[param.class]) {
					tank = CLASS[param.class];
				} else {
					return;
				}
				if (!Coord[param.class]) {
					Coord[param.class] = setCoord(tank);
				}
				coord = Coord[param.class];
				///
				if (!isOpac) {
					const s = coord.size * param.size / CONST.SIZE * R;
					can.width = can.height = s;
					ctx = ctxx;
					ctx.setTransform(R, 0, 0, R, can.width / 2, can.height / 2)
				}
				///
				// diep's own scene-graph z-order (plan.md A1), flattened into one pre-body and one
				// post-body pass:
				//   1. guards (smasher hexes, spike triangles, dombase)                 - bottom
				//   2. a ring turret's own barrel (Auto 3/5)                            - under its
				//      3. base circle, which sits above the barrel but under the body
				//   4. preAddon `launcher` (Skimmer/Rocketeer nub)                      - under cannons
				//   5. cannons (main barrels; array order = draw order, first = bottom)
				//   6. postAddon `pronounced` (Ranger)                                  - above the
				//      barrel, under the body
				//   7. body
				//   8. a centered auto turret (Auto Gunner/Trapper/Smasher/Auto Hover), any cannon
				//      flagged `aboveBody` (the 3 Dominators), and postAddon `dompronounced`
				//      (Destroyer/Gunner Dominator only, plan.md E2) - `showsAboveParent` stays
				//      ON for all three, drawn above the body
				Drawings.guards(ctx, tank, param);
				for (const i in tank.turrets) {
					if (tank.turrets[i].ring) {
						Drawings.turrets[tank.turrets[i].type](ctx, tank, param, i);
						Drawings.ringBase(ctx, tank, param, i);
					}
				}
				Drawings.launcher(ctx, tank, param);
				for (let i = 0; i < tank.cannons.length; i++) {
					if (!tank.cannons[i].aboveBody) {
						Drawings.cannons[tank.cannons[i].type](ctx, tank, param, i);
					}
				};
				Drawings.pronounced(ctx, tank, param);
				Drawings.body[tank.body.shape](ctx, tank, param);
				for (let i = 0; i < tank.cannons.length; i++) {
					if (tank.cannons[i].aboveBody) {
						Drawings.cannons[tank.cannons[i].type](ctx, tank, param, i);
					}
				};
				Drawings.dompronounced(ctx, tank, param);
				// for...in, not an indexed loop: `turrets` is an optional field, absent on most
				// tanks, and for...in over undefined is a no-op where `.length` would throw. The
				// index is only ever a subscript in the turret draw fn, so its string type is moot.
				for (const i in tank.turrets) {
					if (!tank.turrets[i].ring) {
						Drawings.turrets[tank.turrets[i].type](ctx, tank, param, i);
					}
				};
				return {
					can: isOpac ? 0 : can,
					mX: Coord[param.class].mX,
					mY: Coord[param.class].mY,
				}
			};
		})();
		General['drawBullet'] = (() => {
			function canDraw(param) {
				const can = document.createElement('CANVAS');
				const ctx = can.getContext('2d');
				can.width = can.height = (param.size * 2 + CONST.LINEWIDTH + 2) * CONST.OFFCAN;
				ctx.setTransform(CONST.OFFCAN, 0, 0, CONST.OFFCAN, can.width / 2, can.height / 2);
				(Drawings.bullet[param.type] || Drawings.bullet[0])(ctx, param.color, param.size, param.recoil);
			}
			function draw(ctx, param) {
				// Total dispatch (plan.md R7): `Drawings.bullet` is a fixed-length array indexed by
				// a value that came off the wire - a type this client build doesn't have an entry
				// for (a newer server, a malformed packet) falls back to the plain bullet instead of
				// throwing and taking the whole client down the instant one enters view.
				const type = Drawings.bullet[param.type] ? param.type : 0;
				if (param.alpha < 1) {
					switch (type) {
						case 0: case 1: case 2: case 3: case 4: case 5: {
							break;
						}
						default: {
							return canDraw(param);
						}
					}
				}
				Drawings.bullet[type](ctx, param);
			}
			///
			return {
				draw: draw
			}
		})();
		General['drawPet'] = (() => {
			function canDraw(param) {
				const can = document.createElement('CANVAS');
				const ctx = can.getContext('2d');
				can.width = can.height = (param.size * 2 + CONST.LINEWIDTH + 2) * CONST.OFFCAN;
				ctx.setTransform(CONST.OFFCAN, 0, 0, CONST.OFFCAN, can.width / 2, can.height / 2);
				Drawings.pet[param.type](ctx, param, CONST, Palette);
				return can;
			}
			function draw(ctx, param) {
				if (param.alpha < 1) {
					switch (param.type) {
						//case 0: case 1: case 2: case 3:{
						//    break;
						//}
						default: {
							return canDraw(param);
						}
					}
				}
				Drawings.pet[param.type](ctx, param, CONST, Palette);
			}
			///
			return {
				draw: draw
			}
		})();
	};
	CLIENT.initBackground = function () {
		const ctx = General['ctx'];
		General['background'] = General['background'] || (() => {
			return (posx, posy, tileSize) => {
				const h = Game.screen * .5625 * Global.RATIO;
				///
				ctx.fillStyle = Palette.Grid[0];
				ctx.fillRect(
					-(Game.width / 2 + posx) * Global.RATIO + Global.canW / 2,
					-(Game.height / 2 + posy) * Global.RATIO + Global.canH / 2,
					Game.width * Global.RATIO,
					Game.height * Global.RATIO
				);
				///
				const ts = tileSize * Global.RATIO;
				ctx.globalAlpha = 0.05;
				ctx.beginPath();
				for (let x = -(posx * Global.RATIO - Global.canW / 2) % ts; x <= Game.screen * Global.RATIO + (posx % ts); x += ts) {
					ctx.moveTo(x, 0);
					ctx.lineTo(x, h);
				}
				for (let y = -(posy * Global.RATIO - Global.canH / 2) % ts; y <= h + (posy % ts); y += ts) {
					ctx.moveTo(0, y)
					ctx.lineTo(Game.screen * Global.RATIO, y)
				}
				ctx.lineWidth = 1 * Global.RATIO;
				ctx.strokeStyle = 'black';
				ctx.stroke();
				ctx.globalAlpha = 1;
				// Team bases. Game.baseSize rides GameUpdate's head rather
				// than being re-derived from a literal here, which cannot track 2team's own
				// only by coincidence and would have desynced the moment anyone tuned it. 0 means
				// the mode has no bases, so ffa/boss/sandbox fall through drawing nothing.
				// Team id is the colour index directly - SocketSchema's toSTRING.color is
				// ['green','red','yellow','blue'] and FourTeam.corner() orders teams 0 top-left,
				// 1 top-right, 2 bottom-left, 3 bottom-right - so there is no per-viewer remap.
				const bs = Game.baseSize;
				const left = -(Game.width / 2 + posx) * Global.RATIO + Global.canW / 2;
				const top = -(Game.height / 2 + posy) * Global.RATIO + Global.canH / 2;
				if (bs) {
					ctx.globalAlpha = 0.2;
					switch (POST.gm) {
						case '2team': {
							ctx.fillStyle = Palette.green[0];
							ctx.fillRect(left, top, bs * Global.RATIO, Game.height * Global.RATIO);
							ctx.fillStyle = Palette.red[0];
							ctx.fillRect(left + Game.width * Global.RATIO, top,
								-bs * Global.RATIO, Game.height * Global.RATIO);
							break;
						}
						// The diagnostic room (rooms/Tester.js): 2team's own green strip down the
						// left AND 4team's own green corner square in the bottom-right, both at
						// once. The wire only carries one `baseSize` (the strip's), so the corner
						// square's own side is spelled out here at the same gu(67) 4team gives it.
						case 'tester': {
							ctx.fillStyle = Palette.green[0];
							ctx.fillRect(left, top, bs * Global.RATIO, Game.height * Global.RATIO);
							const cs = World.gu(67) * Global.RATIO;
							ctx.fillRect(left + Game.width * Global.RATIO - cs,
								top + Game.height * Global.RATIO - cs, cs, cs);
							break;
						}
						case '4team': {
							const s = bs * Global.RATIO;
							const w = Game.width * Global.RATIO, h = Game.height * Global.RATIO;
							const corners = [
								[left, top],                    // 0 green,  top-left
								[left + w - s, top],            // 1 red,    top-right
								[left, top + h - s],            // 2 yellow, bottom-left
								[left + w - s, top + h - s]     // 3 blue,   bottom-right
							];
							const teamC = [Palette.green, Palette.red, Palette.yellow, Palette.blue];
							for (let t = 0; t < corners.length; t++) {
								ctx.fillStyle = teamC[t][0];
								ctx.fillRect(corners[t][0], corners[t][1], s, s);
							}
							break;
						}
					}
					// The 2team case used to set globalAlpha and never put it back, so 0.2 leaked
					// out of background() into whatever drew next.
					ctx.globalAlpha = 1;
				}
			};
		})();
	};
})(typeof (exports) === 'undefined'
	? (window.CLIENT = window.CLIENT || {})
	: (module.exports = global.CLIENT = global.CLIENT || {}));
