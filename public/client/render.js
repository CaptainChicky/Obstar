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
			/*
				Every drawn feature reduced to one of two primitives, both in the tank's OWN body
				frame (the frame Drawings draws in before `param.dir` is applied):

				  * a POINT the outline actually reaches - the corners of a barrel quad, a
				    launcher/pronounced trapezoid, a rectangular body. These rotate rigidly with
				    the hull, so their positions relative to each other (and to `mX/mY` below)
				    are fixed and can be compared directly.
				  * a DISC around the hull centre, for anything that spins or aims independently
				    of the hull: a guard polygon, an auto turret (its barrel tracks a target), a
				    ring turret (its whole mount spins), and a round/near-round body.

				Two different radii fall out, and they are NOT the same number:

				  canSize  furthest reach from the HULL CENTRE. The offscreen sprite cache is
				           centred there, so this is what decides whether the sprite clips at its
				           own canvas edge - in the world as well as in a UI panel.
				  mR       furthest reach from the VISUAL centre (mX/mY). The two panels that
				           spin a sprite in a fixed-size tile (ui.js's class picker and death
				           screen) pivot about that point, so this is the radius they have to fit.

				The old version computed only canSize, as `sqrt(height^2 + (width/2+offx+open/2)^2)`
				per barrel: it read `offx` signed (so a barrel offset the other way shrank the
				bound instead of growing it) and, more visibly, it did not know about
				`trapLauncher` at all - so every trap barrel's arrowhead, which sits ENTIRELY PAST
				the barrel tip, was cut off at the canvas edge. That is the "tri-trapper and
				trappers have the furthest points of their barrels cut off" report, and it was
				never only a panel problem.
			*/
			function setCoord(config) {
				let middleX = 0, middleY = 0;
				const marge = 2;
				const S = CONST.SIZE, LW = CONST.LINEWIDTH;
				const pts = [];
				let disc = 0;
				// A barrel/turret quad in its own local frame: `distance` out along the firing
				// axis, then the quad itself, then rotated onto `offdir`. Matches
				// Drawings.cannons[*] exactly - same base/tip half-widths per draw shape.
				function barrelPoints(c, offdir) {
					if (c.hidden) { return; }
					const narrowHalf = c.width / 2, wideHalf = c.width / 2 * Drawings.TAPER_RATIO;
					let baseHalf = narrowHalf, tipHalf = narrowHalf;
					if (c.type === 2) {
						baseHalf = c.trapezoidDirection ? wideHalf : narrowHalf;
						tipHalf = c.trapezoidDirection ? narrowHalf : wideHalf;
					}
					tipHalf += c.open / 2;
					const local = [
						[0, c.offx - baseHalf], [0, c.offx + baseHalf],
						[c.height, c.offx - tipHalf], [c.height, c.offx + tipHalf]
					];
					if (c.trapLauncher) {
						const far = c.height + Drawings.trapLauncherLen(c);
						local.push([far, c.offx - wideHalf], [far, c.offx + wideHalf]);
					}
					const cos = Math.cos(offdir), sin = Math.sin(offdir);
					for (const p of local) {
						const lx = (c.distance || 0) + p[0], ly = p[1];
						pts.push([cos * lx - sin * ly, sin * lx + cos * ly]);
					}
				}
				if (config.cannons && config.cannons.length) {
					for (const c of config.cannons) {
						barrelPoints(c, c.offdir);
						///
						const cos = Math.cos(c.offdir), sin = Math.sin(c.offdir);
						middleX += cos * Math.max(0, c.height - S / 2) + sin * c.offx;
						middleY += sin * Math.max(0, c.height - S / 2) + cos * c.offx;
					}
					middleX /= config.cannons.length * 2;
					middleY /= config.cannons.length * 2;
				}
				if (config.turrets && config.turrets.length) {
					for (const c of config.turrets) {
						// A turret's barrel swings to whatever it is aiming at and a ring turret's
						// mount spins on its own phase, so neither has a fixed position in the body
						// frame - both are discs of their whole reach, base circle included.
						const reach = Math.sqrt(
							c.height * c.height +
							Math.pow(Math.abs(c.offx) + c.width / 2 + c.open / 2, 2)
						);
						disc = Math.max(disc, (c.distance || 0) + Math.max(reach, c.rad || 0));
						///
						const cos = Math.cos(c.offdir), sin = Math.sin(c.offdir);
						middleX += cos * Math.max(0, c.height - S / 2) + sin * c.offx;
						middleY += sin * Math.max(0, c.height - S / 2) + cos * c.offx;
					}
					middleX /= config.turrets.length * 2;
					middleY /= config.turrets.length * 2;
				}
				// Guards (plan.md R4) spin on their own phase - a disc, at Drawings.guards' own
				// radius. Smasher/Landmine/Spike have no cannons/turrets at all, so without this
				// their guard shape clips at the bare body's edge.
				if (config.guards) {
					for (const g of config.guards) {
						disc = Math.max(disc, g.sizeRatio * (S + LW / 2));
					}
				}
				// launcher/pronounced/dompronounced (plan.md R4/A4/E2) all rotate rigidly with the
				// hull, so they are point sets like a barrel. Coordinates mirror their own draw
				// functions in drawings.js with `param.size` at CONST.SIZE.
				if (config.launcher) {
					pts.push([0, -0.497502 * S], [0, 0.497502 * S],
						[1.852 * S, -0.585296 * S], [1.852 * S, 0.585296 * S]);
				}
				if (config.pronounced) {
					const wide = 0.42 * S * Drawings.TAPER_RATIO;
					pts.push([0.3 * S, -wide], [0.3 * S, wide],
						[1.3 * S, -0.42 * S], [1.3 * S, 0.42 * S]);
				}
				if (config.dompronounced) {
					const wide = 0.35 * S * Drawings.TAPER_RATIO;
					pts.push([0.78 * S, -wide], [0.78 * S, wide],
						[1.22 * S, -0.35 * S], [1.22 * S, 0.35 * S]);
				}
				// The body, per Drawings.body's own shapes: a rounded rect reaches its corners,
				// everything else is round enough to bound as a disc at its circumradius.
				switch (config.body.shape) {
					case 1: {
						const bw = S * config.body.width, bh = S * config.body.height;
						pts.push([-bw, -bh], [-bw, bh], [bw, -bh], [bw, bh]);
						break;
					}
					case 2: disc = Math.max(disc, S * 1.236); break;
					case 3: disc = Math.max(disc, S / Math.cos(Math.PI / config.body.sides)); break;
					default: disc = Math.max(disc, S); break;
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
				const mLen = Math.sqrt(middleX * middleX + middleY * middleY);
				let canSize = disc, mR = disc + mLen;
				for (const p of pts) {
					canSize = Math.max(canSize, Math.sqrt(p[0] * p[0] + p[1] * p[1]));
					const dx = p[0] - middleX, dy = p[1] - middleY;
					mR = Math.max(mR, Math.sqrt(dx * dx + dy * dy));
				}
				// Every figure above is a path coordinate; a stroke straddles it, and `lineJoin:
				// round` carries that same half-width around a corner, so both radii owe one
				// LINEWIDTH/2 outward.
				canSize += LW / 2;
				mR += LW / 2;
				// A malformed body/cannon row (a shape-1 body missing its width, say) poisons both
				// radii with NaN, and a NaN canvas size becomes a 0x0 canvas that every drawImage
				// of it throws on. Fall back to the bare body instead.
				if (!Number.isFinite(canSize)) { canSize = S + LW / 2; }
				if (!Number.isFinite(mR)) { mR = canSize; }
				///
				return {
					mX: middleX,
					mY: middleY,
					mR: mR,
					size: canSize * 2 + marge * 2,
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
				//   7. postAddon `dompronounced` (Destroyer/Gunner Dominator only, plan.md E2) -
				//      above the barrels, still UNDER the body (B2): every Dominator reference render
				//      shows the whole grey assembly - barrels AND this trapezoid - emerging from
				//      under the circular body and clipped by it, the circle drawn unbroken on top.
				//   8. body
				//   9. a centered auto turret (Auto Gunner/Trapper/Smasher/Auto Hover) and any cannon
				//      flagged `aboveBody` - drawn above the body (`showsAboveParent`). The 3
				//      Dominators no longer carry `aboveBody` (their attacking barrels are in the
				//      pre-body pass at 5), so this post-body pass is empty for them now.
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
				// A Destroyer/Gunner Dominator's cosmetic trapezoid, UNDER the circular body (B2) -
				// see Drawings.dompronounced's own note. A no-op for every other class.
				Drawings.dompronounced(ctx, tank, param);
				Drawings.body[tank.body.shape](ctx, tank, param);
				for (let i = 0; i < tank.cannons.length; i++) {
					if (tank.cannons[i].aboveBody) {
						Drawings.cannons[tank.cannons[i].type](ctx, tank, param, i);
					}
				};
				// for...in, not an indexed loop: `turrets` is an optional field, absent on most
				// tanks, and for...in over undefined is a no-op where `.length` would throw. The
				// index is only ever a subscript in the turret draw fn, so its string type is moot.
				for (const i in tank.turrets) {
					if (!tank.turrets[i].ring) {
						Drawings.turrets[tank.turrets[i].type](ctx, tank, param, i);
					}
				};
				// `pX/pY/pR` are mX/mY/mR converted into the offscreen canvas's OWN pixels - the
				// units `can.width` is already in - so a panel that wants to centre or fit the
				// sprite can do it against `can.width` directly instead of re-deriving the
				// param.size/CONST.SIZE/OFFCAN chain (which both panels used to get subtly wrong,
				// mixing reference units and pixels in the same expression). mX/mY stay in
				// reference units for anything that still wants them raw.
				const px = param.size / CONST.SIZE * R;
				return {
					can: isOpac ? 0 : can,
					mX: coord.mX,
					mY: coord.mY,
					pX: coord.mX * px,
					pY: coord.mY * px,
					pR: coord.mR * px,
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
						case 0: case 1: case 2: case 3: case 4: case 5: case 6: {
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
						// Two opposite corner bases - green top-left, red bottom-right.
						case 'domination': {
							const s = bs * Global.RATIO;
							const w = Game.width * Global.RATIO, h = Game.height * Global.RATIO;
							ctx.fillStyle = Palette.green[0];
							ctx.fillRect(left, top, s, s);
							ctx.fillStyle = Palette.red[0];
							ctx.fillRect(left + w - s, top + h - s, s, s);
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
