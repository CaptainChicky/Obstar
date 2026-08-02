/*
	The game itself: the world state, the camera, input, the frame loop and the packet handler.

	User and Instances stay local to Run() as they always were, but the HUD needs User, so Run()
	publishes both on the registry the moment they exist and before it builds anything that
	reads them.
*/
(function (CLIENT) {
	const CONST = CLIENT.CONST;
	const rnbcolor = CLIENT.rnbcolor;
	const Palette = CLIENT.Palette;
	const Global = CLIENT.Global;
	const Game = CLIENT.Game;
	const General = CLIENT.General;
	const sleep = CLIENT.sleep;
	const roundRect = CLIENT.roundRect;
	const NET = CLIENT.NET;
	const Interp = CLIENT.Interp;
	const Tank = CLIENT.Tank;
	const Obj = CLIENT.Obj;
	const Bullet = CLIENT.Bullet;
	const Wall = CLIENT.Wall;
	const CLASS = CLIENT.CLASS;
	// One *reference* tick (public/motion.js's REF_TICK, 40ms) expressed in
	// 60fps-equivalent frames, so the per-reference-tick server constants below (Physics.js) can
	// be applied per-frame scaled by Global.dtFrames. Deliberately not MOTION.NET_TICK (the send
	// interval, 33ms) - that only coincidentally used to equal the tick server constants were
	// denominated against, and the two are no longer the same number at all.
	const FRAMES_PER_TICK = MOTION.REF_TICK / 16.667;
	///
	CLIENT.Run = function () {
		if (!General['canvas']) {
			General['canvas'] = document.createElement('CANVAS');
			General['canvas'].oncontextmenu = event => event.preventDefault();
			General['canvas'].style.width = '100%';
			General['canvas'].style.height = '100%';
			document.body.appendChild(General['canvas']);
		}
		General['ctx'] = General['canvas'].getContext('2d');
		const ctx = General['ctx'];
		CLIENT.initRender();
		///
		/*
			Key order IS draw order - Draw() walks this with for...in, and so does every other
			pass over it. Walls sit between the shapes and the tanks/bullets on purpose: a Maze
			wall destroys a projectile on contact (entities/Bullet.js's KIND.WALL arm), and the
			death animation that follows - a shrinking, fading sprite that grows 1.1x a tick -
			has to be visible ON TOP of the wall it just hit, or a shot appears to vanish a beat
			before it reaches the thing that stopped it. Walls were last, so they painted over
			every impact.
		*/
		const Instances = {
			'Objects': [],
			'Walls': [],
			'Players': [],
			'Bullets': []
		};
		const User = new function () {
			this.color = 'green';
			this.x = 0;
			this.y = 0;
			// gx/gy is the tank's own position: interpolated server position plus the local input
			// lead (see update()). The camera (camx/camy, below) trails this by CONST.CAM_SMOOTH
			// instead of sitting pinned on it, so the tank is not always dead centre - anything
			// that needs the tank's actual screen position has to go through General.tankOff().
			// These were the string 'move' and were guarded with isNaN() on every frame until the
			// first packet landed. The interpolator is seeded with real numbers instead.
			this.gx = 0;
			this.gy = 0;
			// The camera's own position - chases gx/gy by CONST.CAM_SMOOTH each frame instead of
			// snapping to them, so the viewport trails the tank by a hair. null until the first
			// update, which snaps instead of chasing from a fake (0,0) origin. See User.update().
			this.camx = null;
			this.camy = null;
			// Predator zoom (plan.md C9) - `zooming` is the server's own states[4] bit; `zoomOffX/Y`
			// is a SEPARATE eased offset from the tank's own camera position out to the server's
			// locked point (Game.camX/Y), added on top at the render site rather than folded into
			// camx/camy's own teleport-guarded chase above - a zoom engaging/releasing is a
			// deliberate large excursion, not a teleport, and keeping it additive means it can
			// never trip camx/camy's teleport-snap (Interp.TELEPORT) or change that logic's
			// behaviour for anyone not holding a zoomAbility class's right-click.
			this.zooming = 0;
			this.zoomOffX = 0;
			this.zoomOffY = 0;
			this.dx = 0;
			this.dy = 0;
			this.tween = new Interp(0, 0);
			this.vx = 0;
			this.vy = 0;
			this.scale = 1;
			// Any valid class works here - just a placeholder until the server's own class
			// arrives on the first real update. "Basic" rather than "Rocket" (renamed to
			// Rocketeer, plan.md T1) since it needs no maintenance if the roster changes again.
			this.class = "Basic";
			this.SH = {
				lapse: -1
			};
			this.hp = 1;
			this.hpAlpha = 1;
			this.alpha = 1;
			this.size = 22;
			this.dir = 0;
			this.canDir = [];
			this.canDdir = [];
			this.followDir = 0;
			this.body = 0;
			this.invinsible = 0;
			this.recoil = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
			this.predic = {
				x: 0,
				y: 0,
				vx: 0,
				vy: 0,
			}
			this.old = {
				"size": this.size,
				'class': this.class,
				dir: 0
			}
			this.hitted = 0;
			this.hpBar = (() => {
				const can = document.createElement('CANVAS');
				const ctx = can.getContext('2d');
				const R = CONST.RESOLUTION * CONST.OFFCAN;
				const Hp = 1;
				let Size = 0;
				const lw = 1.5;
				const height = 5;
				can.height = (height + lw * 2 + 4) * R

				function drawHp(hp, size, color) {
					if (size !== Size || hp !== Hp) {
						if (size !== Size) {
							can.width = (size + lw * 2 + 4 + height) * R;
							Size = size;
						} else {
							ctx.setTransform(1, 0, 0, 1, 0, 0)
							ctx.clearRect(0, 0, can.width, can.height);
						}
					} else {
						return;
					}
					ctx.setTransform(R, 0, 0, R, can.width / 2, 2);
					ctx.beginPath();
					roundRect(ctx, -size / 2 - lw - height / 2, 0, size + lw * 2 + height, height + lw * 2, (height + lw * 2) / 2 + .5);
					ctx.closePath();
					ctx.fillStyle = '#333333';
					ctx.fill();
					///
					ctx.beginPath();
					roundRect(ctx, -size / 2 - height / 2, lw, size * hp + height, height, height / 2);
					ctx.closePath();
					ctx.fillStyle = color;
					ctx.fill();
				};

				return {
					can: can,
					redraw: drawHp
				}
			})();
			///
			this.shoot = function (c) {
				if (this.recoil[c] <= 0) {
					this.recoil[c] = -this.recoil[c] + 0.005;
				}
			}
			this.hit = async function () {
				if (!this.hitted) {
					this.hitted = 2;
					await sleep(50);
					this.hitted = 1;
					await sleep(16);
					this.hitted = 0;
				} else {
					return;
				}
			}
			this.update = function () {
				/*
					Local input prediction. `predic` is a small offset from the server position that
					responds to WASD on the very next frame, then decays back to zero as the server's
					own answer catches up - it is what stops your own tank feeling like it is on a
					delay. It is an offset, not a position, so it survives the interpolation change
					untouched; it just gets added to a position that is now correct.
				*/
				/*
					The movement accel/friction integrator lives in public/SHARE/Physics.js -
					entities/Player.js's motion() shares it, per server tick. mspeedPoints/lvl come
					from the same packets ui.js's upgrade panel already reads (UpdateUp's `ups`,
					GameUpdate's head.level) rather than a guess, and the Movement Speed slot is
					looked up by name instead of hardcoded, since a class can override `ups`
					(public/client/ui.js's upgrade-panel init does the same lookup).
				*/
				const Ui = General['Ui'];
				const ups = (CLASS[this.class] && CLASS[this.class].ups) ? CLASS[this.class].ups : TanksConfig.defaultUps;
				// `ups` is PANEL order (the labels down the upgrade column); Ui.upNb is WIRE order
				// (entities/Player.js's `up` object, which orders MSpeed first). They are not the
				// same list - CONST.UP_ORDER is the panel->wire map ui.js already draws through,
				// and 'Movement Speed' sits at panel 4 against wire 0. Indexing upNb by the panel
				// slot read Bullet Damage's points and predicted the local tank's speed off the
				// wrong stat entirely; it only looked plausible because both are usually 0.
				const panelIdx = ups.indexOf('Movement Speed');
				const mspeedIdx = (panelIdx >= 0) ? CONST.UP_ORDER[panelIdx] : -1;
				const mspeedPoints = (mspeedIdx >= 0 && Ui && Ui.upNb) ? (Ui.upNb[mspeedIdx] || 0) : 0;
				const lvl = (Ui && Ui.lvl) || 0;
				const tickLen = (Global.dtFrames / FRAMES_PER_TICK);
				const motionDir = [0, 0];
				// Per reference tick, same as the server - Physics.stepBody below is what converts
				// this to per-frame, not this variable (that one-step conversion here is the bug
				// PENDING #24 measured: it scaled by tickLen once where the accel-to-position
				// conversion needs tickLen^2).
				// A point count now, not points * a per-point accel bonus - see Physics.moveAccel().
				const accel = Physics.moveAccel(mspeedPoints, lvl);
				if (Global.inputs.w || Global.inputs.ArrowUp) { motionDir[0] -= accel; }
				if (Global.inputs.s || Global.inputs.ArrowDown) { motionDir[0] += accel; }
				if (Global.inputs.a || Global.inputs.ArrowLeft) { motionDir[1] -= accel; }
				if (Global.inputs.d || Global.inputs.ArrowRight) { motionDir[1] += accel; }
				let ddir = Math.atan2(motionDir[0], motionDir[1]);
				const llen = Math.min(Math.sqrt((motionDir[0] * motionDir[0]) + (motionDir[1] * motionDir[1])), accel);
				Physics.stepBody(this.predic, Math.cos(ddir) * llen, Math.sin(ddir) * llen, tickLen);
				let tolen = Math.sqrt(Math.pow(this.predic.x, 2) + Math.pow(this.predic.y, 2));
				tolen += (-tolen) * General['lerpK'](CONST.SMOOTH);
				/*
					The cap is derived now, not tuned (PENDING #24a). What the lead has to cover is
					exactly how far the tank travels during the two delays between the server
					knowing where it is and us drawing it: Interp's deliberate one-interval render
					delay, plus half the round trip the newest snapshot already spent in flight.
					NET.leadMs() is those two, both measured; the speed it multiplies is `predic`'s
					own velocity, which integrates the server's accel/friction and so converges to
					whatever this tank's real top speed is at its level and Movement Speed.

					`predic`'s velocity is per *reference* tick (public/SHARE/Physics.js), so it
					converts to units-per-ms by REF_TICK, not by the send interval or the frame.

					The old cap was CONST.SIZE*2 - a flat 70 units regardless of speed, latency or
					packet rate, which over-led a slow tank on a good connection by 4x and was the
					thing actually deciding the size of the lie. It stays as the ceiling, because a
					lead should never read as a teleport no matter what a hostile RTT measurement
					says: NET.echo() already rejects the absurd ones, this bounds the rest.
				*/
				const predicSpeed = Math.sqrt(this.predic.vx * this.predic.vx + this.predic.vy * this.predic.vy);
				const leadCap = NET.leadMs() * (predicSpeed / MOTION.REF_TICK);
				tolen = Math.min(tolen, leadCap, CONST.SIZE * 2);
				ddir = Math.atan2(this.predic.y, this.predic.x);
				this.predic.x = Math.cos(ddir) * tolen;
				this.predic.y = Math.sin(ddir) * tolen;

				// The tank is not at the screen centre - the camera trails it by CONST.CAM_SMOOTH -
				// so the aim vector has to correct for that offset (General.tankOff(), in window
				// pixels) or aim would drift with speed as the camera lag grows.
				const off = General['tankOff']();
				this.dir = Math.atan2(Global.mouse_y - Global.winH / 2 - off.y, Global.mouse_x - Global.winW / 2 - off.x);
				if (this.old.dir !== parseInt(this.dir * 100)) {
					this.old.dir = parseInt(this.dir * 100);
					this.DIFFDIR = 1;
				}
				if (this.hp < 1) {
					this.hpAlpha = Math.max(0, Math.min(.8, this.hpAlpha + 0.05));
				} else {
					this.hpAlpha = Math.max(0, Math.min(.8, this.hpAlpha - 0.01));
				}
				for (let i = 0; i < this.recoil.length; i++) {
					if (this.recoil[i] > 0 && this.recoil[i] < 0.07) {
						this.recoil[i] += (0.075 - this.recoil[i]) * 0.3;
					} else if (this.recoil[i] >= 0.07) {
						this.recoil[i] = -this.recoil[i];
					} if (this.recoil[i] < 0) {
						if (this.recoil[i] < -0.005) {
							this.recoil[i] += (-this.recoil[i]) * 0.2;
						} else {
							this.recoil[i] = 0;
						}
					}
				}
				if (this.canDir.length === this.canDdir.length) {
					const k = General['lerpK'](0.3);
					for (let i = 0; i < this.canDir.length; i++) {
						this.canDdir[i] = Math.atan2(
							Math.sin(this.canDdir[i]) + (Math.sin(this.canDir[i]) - Math.sin(this.canDdir[i])) * k,
							Math.cos(this.canDdir[i]) + (Math.cos(this.canDir[i]) - Math.cos(this.canDdir[i])) * k
						)
					}
				} else {
					this.canDdir = this.canDir;
				}
				//console.log(this.recoil);

				///STATE///
				if (this.shield) {
					this.SH.lapse += 1;
					if (this.SH.lapse === 6) {
						this.SH.body = [General.color.shade(Palette[this.color][0], 1.1), Palette[this.color][1]];
						this.SH.cannons = [General.color.shade(Palette.gray[0], 1.1), Palette.gray[1]];
					} else if (this.SH.lapse === 0) {
						this.SH.body = Palette[this.color];
						this.SH.cannons = Palette.gray;
					} else if (this.SH.lapse === 12) {
						this.SH.lapse = -1;
					}
				}
				///POSITION AND CAMERA///
				// `dx`/`dy` is the interpolated server position; `+predic` is the local input lead.
				// gx/gy is that sum, exactly - the tank itself (User.draw()) is always drawn there,
				// with zero lag. The camera (camx/camy, below) trails gx/gy instead, which is what
				// lets the tank slide off screen centre - see General.tankOff().
				const tw = this.tween.sample(NET.now());
				this.dx = tw.x;
				this.dy = tw.y;
				this.gx = this.dx + this.predic.x;
				this.gy = this.dy + this.predic.y;
				// The camera trails gx/gy by a hair instead of sitting pinned on them - see
				// CONST.CAM_SMOOTH. Snap instead of chasing on the very first update (nothing to
				// trail from yet) and across a teleport (death/respawn, or any jump too big to be
				// real motion - reuses Interp's own threshold), so the lag never shows up as the
				// camera visibly gliding across the map.
				if (this.camx === null || Math.abs(this.gx - this.camx) > Interp.TELEPORT || Math.abs(this.gy - this.camy) > Interp.TELEPORT) {
					this.camx = this.gx;
					this.camy = this.gy;
				} else {
					const camK = General['lerpK'](CONST.CAM_SMOOTH);
					this.camx += (this.gx - this.camx) * camK;
					this.camy += (this.gy - this.camy) * camK;
				}
				// Predator zoom (plan.md C9) - eased independently of camx/camy above (see this.zooming's
				// own declaration for why), toward Game.camX/Y's offset from the tank while `zooming`
				// is on, back to (0,0) the instant it isn't. Same smoothing constant as the ordinary
				// camera chase, so a zoom engaging/releasing reads as the same kind of motion.
				const zoomTargetX = (this.zooming && !isNaN(Game.camX)) ? Game.camX - this.gx : 0;
				const zoomTargetY = (this.zooming && !isNaN(Game.camY)) ? Game.camY - this.gy : 0;
				const zoomK = General['lerpK'](CONST.CAM_SMOOTH);
				this.zoomOffX += (zoomTargetX - this.zoomOffX) * zoomK;
				this.zoomOffY += (zoomTargetY - this.zoomOffY) * zoomK;
			};
			this.draw = function () {
				ctx.translate(this.dx + this.predic.x, this.dy + this.predic.y)
				ctx.globalAlpha = this.alpha;
				const o = General['drawTank'](ctx, parseInt(this.alpha), {
					class: this.class,
					tankC: this.shield ? this.SH.body : ((this.hitted > 1) ? Palette.hit : Palette[this.color]),
					canC: this.shield ? this.SH.cannons : ((this.hitted > 1) ? Palette.hit : Palette.gray),
					size: this.size,
					dir: this.followDir ? this.realDir : this.dir,
					recoils: this.recoil,
					canDir: this.canDdir
				});
				const can = o.can;
				if (can) {
					const w = can.width / (CONST.OFFCAN), h = can.height / (CONST.OFFCAN);
					ctx.drawImage(can, -w / 2, -h / 2, w, h);
				}
				///
				ctx.scale(1 / CONST.OFFCAN / CONST.RESOLUTION, 1 / CONST.OFFCAN / CONST.RESOLUTION);
				this.hpBar.redraw(this.hp, this.size * 1.5, Palette[this.color][0]);
				ctx.globalAlpha *= this.hpAlpha;
				ctx.drawImage(this.hpBar.can,
					-this.hpBar.can.width / 2,
					(this.size * 1.2) * CONST.OFFCAN * CONST.RESOLUTION
				);
			};
		};
		///
		CLIENT.User = User;
		CLIENT.Instances = Instances;
		CLIENT.initBackground();
		CLIENT.initUi();
		///
		// The tank's screen position relative to the true centre, in window pixels (the space
		// Global.mouse_x/y and winW/winH live in) - zero when the camera has caught up, growing
		// with speed as CONST.CAM_SMOOTH's lag falls behind. Anything that used to assume "the
		// tank is at the screen centre" has to subtract this instead. `zoomOffX/Y` (plan.md C9)
		// is folded in too - the tank keeps drawing at gx/gy regardless of a Predator zoom lock,
		// so its offset from the (now possibly panned-out) screen centre has to account for that
		// pan, or aiming while zoomed would read the mouse against the wrong on-screen position.
		General['tankOff'] = () => ({
			x: (User.gx - User.camx - User.zoomOffX) * Global.RATIO / CONST.RESOLUTION,
			y: (User.gy - User.camy - User.zoomOffY) * Global.RATIO / CONST.RESOLUTION
		});
		///
		General['Interact'] = {
			onresize: () => {
				Global.winW = window.innerWidth;
				Global.winH = window.innerHeight;
				Global.canW = General['canvas'].width = Global.winW * CONST.RESOLUTION;
				Global.canH = General['canvas'].height = Global.winH * CONST.RESOLUTION;
				General['updateRatio']();
			},
			onmousemove: e => {
				Global.mouse_x = e.clientX;
				Global.mouse_y = e.clientY;
			},
			onmousedown: e => {
				let key = 0;
				switch (e.button) {
					case 0: {
						key = 'mouseL';
						break;
					};
					case 2: {
						key = 'mouseR';
						break;
					}
				}
				if (!key || Global.inputs[key]) { return };
				Global.inputs[key] = 1;
				if (Global.mouse_out) { return; }
				General['WS'].send(PROTO.encode('keydown', key));
			},
			onmouseup: e => {
				let key = 0;
				switch (e.button) {
					case 0: {
						key = 'mouseL';
						break;
					};
					case 2: {
						key = 'mouseR';
						break;
					}
				}
				if (!key || !Global.inputs[key]) { return };
				Global.inputs[key] = 0;
				General['WS'].send(PROTO.encode('keyup', key));
			},
			onkeydown: e => {
				const key = e.key.toLowerCase();
				// Console/chat input is focused - typing shouldn't also drive the tank
				// (e.g. 'c' toggling auto-spin). Only the open/close chord still gets through.
				if (General['DEV'].isOn || General['CHAT'].isOn) {
					if (key === 'l' && e.ctrlKey && e.shiftKey) { General['DEV'].toggle(); }
					else if (key === 'q' && e.ctrlKey && e.shiftKey) { General['CHAT'].toggle(); }
					else if (key === 'escape') {
						if (General['DEV'].isOn) { General['DEV'].toggle(); }
						else if (General['CHAT'].isOn) { General['CHAT'].toggle(); }
					}
					return;
				}
				if (Global.inputs[key]) { return };
				Global.inputs[key] = 1;
				switch (key) {
					case 'q': {
						if (Global.inputs.shift && Global.inputs.control) {
							General['CHAT'].toggle();
						}
						break;
					};
					case 'l': {
						if (Global.inputs.shift && Global.inputs.control) {
							General['DEV'].toggle();
						}
						break;
					};
					case 'a':
					case 'w':
					case 's':
					case 'd':
					case 'e':
					case 'c':
					case 'k':
					case 'o':
					// Sandbox-only cheat keys - '\' cycles class, ';' toggles god mode. Both
					// relayed unconditionally, same as every key here; net/gameSocket.js is
					// what gates them to a sandbox room.
					case '\\':
					case ';':
					// H-key piloting (plan.md E4) - claim/release the nearest same-team
					// claimable AI. Not sandbox-only; net/gameSocket.js handles it in any mode.
					case 'h':
					case 'arrowup':
					case 'arrowdown':
					case 'arrowleft':
					case 'arrowright': {
						General['WS'].send(PROTO.encode('keydown', key))
						break;
					};
					case '1': case '2': case '3': case '4':
					case '5': case '6': case '7': case '8': {
						const Ui = General['Ui'];
						if (!Ui) { break; }
						const wireIdx = CONST.UP_ORDER[parseInt(key) - 1];
						if (Global.inputs.m) {
							// m+digit: fill that stat's bar - spend what's banked right now, queue the
							// remainder. Passing Infinity and letting enqueue() clamp against the
							// row's own real cap (plan.md P3 - no longer always CONST.MAX_PER_STAT,
							// e.g. Smasher's Body Damage caps at 10) plus what is already
							// spent/queued and the lifetime budget (CONST.MAX_UP_POINTS) is
							// deliberate: "fill the bar" is the intent, and all three caps live in
							// one place now.
							Ui.UP.enqueue(Ui, wireIdx, Infinity);
							Ui.UP.drain(Ui);
						} else if (Global.inputs.u) {
							// u+digit: queue one point on that stat, spending it now if affordable.
							Ui.UP.enqueue(Ui, wireIdx, 1);
							Ui.UP.drain(Ui);
						} else if (Ui.still > 0) {
							// bare digit: spend one point on that stat now.
							General['WS'].send(PROTO.encode('upgrade', wireIdx));
						}
						break;
					};
					case 'u': {
						// m+u (u pressed while m is held): clear the queue.
						if (Global.inputs.m && General['Ui']) { General['Ui'].UP.clearQueue(); }
						break;
					};
					case 'm': {
						// m+u (m pressed while u is held): clear the queue.
						if (Global.inputs.u && General['Ui']) { General['Ui'].UP.clearQueue(); }
						break;
					};
				}
			},
			onkeyup: e => {
				const key = e.key.toLowerCase();
				if (General['DEV'].isOn || General['CHAT'].isOn) {
					if (key === 'enter') {
						if (General['DEV'].isOn) {
							General['DEV'].send();
						} else if (General['CHAT'].isOn) {
							General['CHAT'].send();
						}
					}
					return;
				}
				if (!Global.inputs[key]) { return; }
				Global.inputs[key] = 0;
				switch (key) {
					case 'enter': {
						if (General['DEV'].isOn) {
							General['DEV'].send();
						} else if (General['CHAT'].isOn) {
							General['CHAT'].send();
						}
					}
					case 'a':
					case 'w':
					case 's':
					case 'd':
					// 'k' is a held input server-side now (Sandbox's hold-to-level-up cheat),
					// same shape as the movement keys - needs a release signal too.
					case 'k':
					case 'arrowup':
					case 'arrowdown':
					case 'arrowleft':
					case 'arrowright': {
						General['WS'].send(PROTO.encode('keyup', key))
						break;
					};
					case 'f': {
						console.log(Global.FPS);
						break;
					};
				}
			},
		};
		General.Interact.onresize();
		// Register each handler on its window.on* slot by name. The old form was
		// `for(let i in General['Interact']){ window[i] = General['Interact'][i] }` - a dynamic
		// write to arbitrary global names, exactly the pattern the linter cannot check and that
		// put `states[7]`-class typos on window unnoticed. These are the same
		// six assignments, spelled out.
		window.onresize = General['Interact'].onresize;
		window.onmousemove = General['Interact'].onmousemove;
		window.onmousedown = General['Interact'].onmousedown;
		window.onmouseup = General['Interact'].onmouseup;
		window.onkeydown = General['Interact'].onkeydown;
		window.onkeyup = General['Interact'].onkeyup;
		///
		function getFps() {
			Global.fps.push(1000 / (-Global.oldfps + Global.newfps));
			if (Global.fps.length > 50) {
				Global.fps.splice(0, 1);
			}
			let toshow = Global.fps.reduce(function (t, n) { return t + n; })
			toshow /= Global.fps.length;
			Global.FPS = toshow;
		}
		function Draw() {
			///
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, Global.canW, Global.canH);
			// Predator zoom (plan.md C9): the actual render centre is the ordinary tank-trailing
			// camera plus the eased zoom offset (0,0 whenever not zooming, see User.zoomOffX/Y).
			const viewX = User.camx + User.zoomOffX, viewY = User.camy + User.zoomOffY;
			General['background'](viewX, viewY, World.GU);
			///
			const sx = -viewX * Global.RATIO + (Global.canW / 2), sy = -viewY * Global.RATIO + (Global.canH / 2);
			for (const c in Instances) {
				for (const i in Instances[c]) {
					///
					ctx.setTransform(Global.RATIO, 0, 0, Global.RATIO, sx, sy);
					ctx.globalAlpha = 1;
					///
					Instances[c][i].draw(ctx);
				}
			}
			///
			ctx.setTransform(Global.RATIO, 0, 0, Global.RATIO, sx, sy);
			ctx.globalAlpha = 1;
			User.draw();
			///
			for (const c in Instances) {
				for (const i in Instances[c]) {
					if (Instances[c][i].drawUi) {
						ctx.setTransform(Global.RATIO, 0, 0, Global.RATIO, sx, sy);
						Instances[c][i].drawUi(ctx);
					}
				}
			}
			///
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.globalAlpha = 1;
			General.Ui.draw();
			///
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.globalAlpha = 1;
			General.doors.draw();
		}
		function Loop() {
			///
			if (General['KICK']) {
				if (General['doors'].toClose === 1) {
					General['run'] = 0;
				}
			}
			Global.oldfps = Date.now();
			/*
				How long this frame is, measured in 60Hz frames. Everything smoothed per frame -
				General.lerpK(), the input prediction, the polygon spin - scales by it, so the game
				looks the same on a 60Hz laptop and a 144Hz monitor instead of running its animations
				2.4x fast on the latter. Clamped so a hitch or a backgrounded tab resumes smoothly
				rather than jumping a quarter of a second in one frame.
			*/
			{
				const t = NET.now();
				Global.dtFrames = Global.frameAt ? Math.min(4, Math.max(0.2, (t - Global.frameAt) / 16.667)) : 1;
				Global.frameAt = t;
			}
			// Game.timestamp increments once per server tick, which is 25/33 as long a wall-clock
			// moment as it used to be - 1.515152 = 2 * 25/33 keeps this
			// spinning at its old real-world rate instead of 1.32x faster.
			rnbcolor[0] = 'hsl(' + (Game.timestamp * 1.515152) % 360 + ',78%,56%)';
			rnbcolor[1] = 'hsl(' + (Game.timestamp * 1.515152) % 360 + ',50%,38%)';
			///
			General['doors'].update();
			Game.screen += (Game.realScreen - Game.screen) * General['lerpK'](0.1);
			if (parseInt(Game.screen) !== Game.realScreen) {
				General['updateRatio']();
			}
			///
			// Before the Instances loop, not after it: a freshly spawned bullet of your own reads
			// User.predic on its first update() to line itself up with the muzzle
			// (public/client/entities.js), and it has to be this frame's value, not last frame's.
			// User.update() reads only input and its own tween, never Instances, so the order is
			// free to be this way round.
			User.update();
			for (const c in Instances) {
				for (const i in Instances[c]) {
					Instances[c][i].update();
				}
			}
			///
			if (Global.mouseDelay) {
				Global.mouseDelay--;
			} else if (User.DIFFDIR) {
				// The cursor's offset from your tank, which is not the centre of the screen while
				// the camera trails it (General.tankOff(), window pixels) - subtract that first so
				// the server's aim point means what it says regardless of how far behind the
				// camera has fallen.
				const off = General['tankOff']();
				General['WS'].send(PROTO.encode('mousemove', {
					x: Math.min(.5, Math.max(-.5, (Global.mouse_x - Global.winW / 2 - off.x) / (Game.screen) * CONST.RESOLUTION / Global.RATIO)),
					y: Math.min(.5, Math.max(-.5, (Global.mouse_y - Global.winH / 2 - off.y) / (Game.screen * 0.5625) * CONST.RESOLUTION / Global.RATIO)),
					dir: User.dir
				}))
				Global.mouseDelay = CONST.MOUSEDELAY;
				User.DIFFDIR = 0;
			} else {
				if (Global.mouse_x !== Global.oldMouse_x || Global.mouse_y !== Global.oldMouse_y) {
					User.DIFFDIR = 1;
					Global.oldMouse_x = Global.mouse_x;
					Global.oldMouse_y = Global.mouse_y;
				}
			}
			///
			Draw();
			///
			Global.newfps = Date.now();
			getFps();
			if (!General['run']) {
				CLIENT.preRun();
				return;
			}
			if (Global.inputs.old.mouseL !== Global.inputs.mouseL) {
				Global.inputs.old.mouseL = Global.inputs.mouseL;
			}
			requestAnimationFrame(Loop);
			///
			if (Global.mouse_out) {
				if (General['canvas'].style.cursor !== 'pointer') { General['canvas'].style.cursor = 'pointer'; }
				Global.mouse_out--;
			} else {
				if (General['canvas'].style.cursor !== 'default') { General['canvas'].style.cursor = 'default'; }
			}
		}
		/*
			Test hook, read-only.

			test/client.js boots this file against the stub DOM in test/clientDom.js and asserts
			things like "the camera is exactly on the tank at speed" and "a bullet is drawn at its
			real speed from the first interval". Those are statements about numbers this closure
			computes, and nothing outside it can otherwise see them: it all ends up inside a canvas,
			and there is no DOM to read it back from.

			It lives here rather than at the bottom of the file because User and Instances are local
			to Run(). Nothing in the client reads this back, and nothing outside writes to it.
		*/
		window.__test = {
			User: User,
			Global: Global,
			Game: Game,
			Instances: Instances,
			CONST: CONST
		};
		General['run'] = 1;
		Loop();
		///
		General['SetPacket'] = General['SetPacket'] || function (data) {
			if (data.head.timestamp < Game.timestamp) {
				return;
			}
			/// DELETE OLD DATA ///
			for (const category in Instances) {
				// A wall never moves and is never destroyed server-side (entities/Wall.js: "never
				// tombstoned - permanent geometry") - it only drops out of a given packet because
				// the per-viewer buffer is view-distance-limited, not because it stopped existing
				// (plan.md C13). Keeping it drawn from the last packet that DID include it is what
				// "last-known walls until told otherwise" means; deleting it here the instant one
				// packet omits it is what made a wall flicker in and out at the very culling
				// boundary the buffer margin (rooms/Room.js's per-viewer `rest` query) exists to
				// avoid.
				if (category === 'Walls') { continue; }
				for (const id in Instances[category]) {
					if (typeof (data.Instances[category][id]) === 'undefined') {
						delete Instances[category][id];
					}
				}
			}
			/*
				SET DATA

				This used to be wrapped in `for(let THING in data)`, with the entity loop below
				sitting *inside* it. `data` has four keys (type, head, User, Instances) and only
				'head' continued, so every entity in the packet was applied three times per packet -
				three passes of the whole quadtree slice for nothing, and `hit()` and `shoot()`
				fired three times each. Each part is done once now.
			*/
			// Timestamped by the room's own step counter, not by when this packet landed - the
			// send loop and the simulation clock run at different rates, so arrival order is even
			// but the world's own advance per packet is not. See NET.mark().
			const at = NET.mark(undefined, data.head.timestamp);
			///Head///
			Game.realScreen = data.head.screen;
			Game.timestamp = data.head.timestamp;
			Game.width = data.head.width;
			Game.height = data.head.height;
			Game.baseSize = data.head.baseSize;
			// plan.md A4/C5 - real since A4, on the wire since C5; fixed at OPEN/0/0 for every mode
			// except Survival's own COUNTDOWN. No consumer yet (no "waiting for players" screen
			// built - PENDING.md), stored here so one has the data the moment it's written.
			Game.arenaState = data.head.arenaState;
			Game.ticksUntilStart = data.head.ticksUntilStart;
			Game.playersNeeded = data.head.playersNeeded;
			// Predator zoom (plan.md C9) - the world point the server wants the viewport centred
			// on this tick; read every packet, but only actually used by User.update()'s own
			// camera-target blend while User.zooming (states[4], below) says the lock is live.
			Game.camX = data.head.camX;
			Game.camY = data.head.camY;
			if (General['Ui']) {
				General['Ui'].xp = data.head.xp;
				General['Ui'].still = data.head.still;
				General['Ui'].classLvl = data.head.cLvl;
				General['Ui'].lvl = data.head.level;
				General['Ui'].UP.drain(General['Ui']);
			}
			///User///
			if (data.User) {
				for (const param in data.User) {
					switch (param) {
						case 'states': {
							if (data.User[param][0]) {
								User.hit();
							}
							if (User.followDir && !data.User[param][1]) {
								User.DIFFDIR = 1;
							}
							User.followDir = data.User[param][1];
							///
							if (General['Ui']) {
								General['Ui'].dead = data.User[param][2];
							}
							///
							User.shield = data.User[param][3];
							// Predator zoom (plan.md C9) - see states[4]'s own comment in
							// rooms/Room.js's getBuffer().
							User.zooming = data.User[param][4];
							break;
						};
						case 'recoil': {
							for (const i in data.User[param]) {
								if (data.User[param][i]) {
									User.shoot(i)
								}
							}
							break;
						};
						case 'dir': {
							User.realDir = data.User[param];
							break;
						};
						default: User[param] = data.User[param]; break;
					}
				}
				User.tween.push(data.User.x, data.User.y, at);
			}
			///REST
			{
				for (const CONSTRUC in data.Instances) {
					for (const OBJ in data.Instances[CONSTRUC]) {
						const obj = data.Instances[CONSTRUC][OBJ];
						const inst = Instances[CONSTRUC];
						/// NEW ///
						if (typeof (inst[OBJ]) === 'undefined') {
							switch (CONSTRUC) {
								case 'Players': inst[OBJ] = new Tank(obj.x, obj.y, obj.size, obj.color); break;
								case 'Objects': inst[OBJ] = new Obj(obj.x, obj.y, obj.size, obj.type); break;
								case 'Bullets': {
									inst[OBJ] = new Bullet(obj.x, obj.y, obj.size, obj.dir, obj.type, obj.color);
									break;
								}
								case 'Walls': inst[OBJ] = new Wall(obj.x, obj.y, obj.w, obj.h); break;
								default: continue;    // a construc byte this client does not know
							}
						}
						/*
							Apply the packet to the entity, new or not.

							Creating one used to be an `else` against this block, so on the packet that
							introduced an entity it got *only* the four constructor arguments - no class,
							no name, no hp, no alpha, no dir. It looked fine solely because of the
							triple-iteration bug this function used to have: passes two and three of the
							same packet found the entity already present and took this branch. Fixing that
							loop turned "harmless waste" into a Tank rendered with the constructor's
							placeholder class for a whole packet interval, which is not a real class, so
							drawTank returned undefined and draw() threw on it.
						*/
						for (const PARAM in obj) {
							switch (PARAM) {
								case 'states': {
									switch (CONSTRUC) {
										case 'Players': {
											if (obj.states[0]) inst[OBJ].hit();
											inst[OBJ].shield = obj.states[1];
											// states[6] is the bot flag - one past
											// the end of the record, so a new tank's bot flag was always undefined.
											inst[OBJ].bot = obj.states[6];
											break;
										}
										case 'Objects': {
											if (obj.states[0]) inst[OBJ].hit();
											// Slots 1-3 are the tier (0-7) as 3 bits - see
											// public/SHARE/ObjectsConfig.js.
											inst[OBJ].tier = (obj.states[1] << 2) | (obj.states[2] << 1) | obj.states[3];
											break;
										}
										case 'Bullets': {
											inst[OBJ].pet = obj.states[0]
											inst[OBJ].mine = obj.states[1]
											break;
										}
									}
									break;
								};
								case 'recoil': {
									for (const i in obj[PARAM]) {
										if (obj[PARAM][i]) {
											inst[OBJ].shoot(i)
										}
									}
									break;
								};
								default: inst[OBJ][PARAM] = obj[PARAM]; break;
							}
						}
						// One server position, timestamped with when the packet landed. A brand new
						// entity gets one too: its Interp was seeded with the same spawn point, so this
						// is the second sample it needs before it can move at the right speed.
						inst[OBJ].tween.push(obj.x, obj.y, at);
					}
				}
			}
		}
		General['WS'].onmessage = packet => {
			const decoded = PROTO.decode(packet.data);
			const type = decoded.type;
			switch (type) {
				case 'ping': {
					// probe 1 is our own probe coming back off the server (PENDING #24a). Time it
					// and we are done - it is not a heartbeat and must not start the loop below.
					if (decoded.data.probe) {
						NET.echo();
						break;
					}
					if (!General['PING']) {
						General['PING'] = new function () {
							this.run = function () {
								if (this.stop) {
									console.log('ping stopped');
									return;
								}
								// The heartbeat the server counts (probe 0), unchanged...
								General['WS'].send(PROTO.encode('ping', 0))
								// ...and an RTT probe (1) the server echoes verbatim. Separate
								// packets because they answer different questions: the heartbeat
								// only has to arrive, the probe has to come back. Two bytes a
								// second between them.
								NET.probe();
								General['WS'].send(PROTO.encode('ping', 1))
								setTimeout(it => it.run(), 1000, this)
							}
							this.stop = 0;
							this.run();
						}
					}
					break;
				};
				case 'kick': {
					General['KICK'] = decoded.reason;
					General['PING'].stop = 1;
					break;
				};
				case 'GameUpdate': {
					General['SetPacket'](decoded.data)
					break;
				};
				case 'UpdateUp': {
					General['Ui'].upNb = decoded.data.ups;
					General['Ui'].UP.drain(General['Ui']);
					break;
				};
				case 'UiUpdate': {
					if (General['Ui']) {
						General['Ui'].isReady = 1;
						General['Ui'].leaderInfo = decoded.data.leader;
						General['Ui'].mapInfo = decoded.data.map;
						General['Ui'].MES.add(decoded.data.mess);
					}
					break;
				};
				case 'comResponse': {
					General['DEV'].log(decoded.data.res);
					break;
				};
				case 'chatUpdate': {
					General['CHAT'].log(decoded.data.res);
					break;
				};
			}
		};
	};
})(typeof (exports) === 'undefined'
	? (window.CLIENT = window.CLIENT || {})
	: (module.exports = global.CLIENT = global.CLIENT || {}));
