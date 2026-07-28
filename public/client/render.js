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
				if (config.cannons) {
					for (const c of config.cannons) {
						///
						const len = Math.sqrt(
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
				if (config.turrets) {
					for (const c of config.turrets) {
						///
						const len = Math.sqrt(
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
				if (!config.cannons && !config.turrets) {
					middleX = canSize;
					middleY = canSize;
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
				for (let i = 0; i < tank.cannons.length; i++) {
					Drawings.cannons[tank.cannons[i].type](ctx, tank, param, i);
				};
				Drawings.body[tank.body.shape](ctx, tank, param);
				// for...in, not an indexed loop: `turrets` is an optional field, absent on most
				// tanks, and for...in over undefined is a no-op where `.length` would throw. The
				// index is only ever a subscript in the turret draw fn, so its string type is moot.
				for (const i in tank.turrets) {
					Drawings.turrets[tank.turrets[i].type](ctx, tank, param, i);
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
				Drawings.bullet[param.type](ctx, param.color, param.size, param.recoil);
			}
			function draw(ctx, param) {
				if (param.alpha < 1) {
					switch (param.type) {
						case 0: case 1: case 2: case 3: {
							break;
						}
						default: {
							return canDraw(param);
						}
					}
				}
				Drawings.bullet[param.type](ctx, param);
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
