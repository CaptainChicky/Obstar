/*
	Tank, Obj and Bullet: the three things the server can put in the world.

	These moved out of the monolith untouched. Their draw(ctx)/drawUi(ctx) methods take the
	context as a parameter - none of them closes over Run()'s `ctx`, and none of them reads
	Instances.

	The one exception is Bullet.update(), which reads CLIENT.User.predic to keep your own
	bullets on the muzzle - see the comment there. It has to go through CLIENT lazily rather
	than aliasing it up top like the consts below: Run() does not assign CLIENT.User until it
	is called, long after this file has been evaluated.
*/
(function (CLIENT) {
	const CONST = CLIENT.CONST;
	const Palette = CLIENT.Palette;
	const Global = CLIENT.Global;
	const General = CLIENT.General;
	const Drawings = CLIENT.Drawings;
	const sleep = CLIENT.sleep;
	const roundRect = CLIENT.roundRect;
	const NET = CLIENT.NET;
	const Interp = CLIENT.Interp;
	const RARITY = ObjectsConfig.rarity;
	class Tank {
		constructor(x, y, size, color) {
			this.color = color;
			this.x = x;
			this.y = y;
			this.name = { name: "", color: 0 };
			// vx/vy are on the wire (SCHEMA.GameUpdate.Players) and assigned straight out of the
			// packet, so they stay. The smoothed dvx/dvy that used to be derived from them are
			// gone with the velocity lead they fed - see draw().
			this.vx = 0;
			this.vy = 0;
			this.dx = x;
			this.dy = y;
			this.tween = new Interp(x, y);
			this.hp = 1;
			this.hpAlpha = 0;
			this.scale = 1;
			// Overwritten by the packet that creates this tank. Was 'Doble', which is not a class
			// in TanksConfig - if it is ever read, drawTank cannot draw it.
			this.class = 'Basic';
			this.size = size;
			this.SH = {
				lapse: -1
			}
			this.dir = 0;
			this.ddir = 0;
			this.canDir = [];
			this.canDdir = [];
			this.destroy = 0;
			this.prediclen = 0;
			this.predicdir = 0;
			this.invinsible = 0;
			this.xp = 0;
			this.name = '';
			this.recoil = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
			this.off = (() => {
				const can = document.createElement('CANVAS');
				const ctx = can.getContext('2d');
				const IT = {
					drawName: name,
					drawXp: shortxp,
					name: '',
					xp: -1,
					can: can,
				}
				const r = CONST.RESOLUTION * CONST.OFFCAN;
				const lw = 4;
				let offy = 0;
				can.height = (15 + 24 + lw * 2) * r;

				function name(name, xp, bot) {
					ctx.setTransform(1, 0, 0, 1, 0, 0);
					ctx.font = '700 24px Catamaran';
					const m = ctx.measureText(name);
					const w = m.width * r;
					can.width = Math.min(Math.max(100 * r, w + (lw * 2 * r)), 300 * r);
					ctx.font = '700 24px Catamaran';
					ctx.lineJoin = 'round';
					ctx.lineWidth = lw;
					ctx.textBaseline = 'middle';
					ctx.strokeStyle = '#222222';
					ctx.fillStyle = bot ? Palette.botName : '#fcfcfc';
					ctx.setTransform(r, 0, 0, r, can.width / 2, 0);
					const c = ctx.measureText(name);
					ctx.strokeText(name, -c.width / 2, lw + 12);
					ctx.fillText(name, -c.width / 2, lw + 12);
					///
					offy = 24 + lw * 2;
					shortxp(xp);
				};
				function shortxp(xp) {
					ctx.clearRect(-can.width / 2, offy + 1, can.width, can.height - offy);
					ctx.font = '700 15px Catamaran';
					ctx.lineWidth = 3;
					ctx.textBaseline = 'middle';
					ctx.strokeStyle = '#222222';
					const m = ctx.measureText(xp);
					ctx.strokeText(xp, -m.width / 2, offy + 15 / 2);
					ctx.fillText(xp, -m.width / 2, offy + 15 / 2);
				};

				return IT;
			})();
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
					roundRect(ctx, -size / 2 - lw - height / 2, 0, size + lw * 2 + height, height + lw * 2, (height + lw * 2) / 2);
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
			this.hitted = 0;
		};
		shoot(c) {
			if (this.recoil[c] <= 0) {
				this.recoil[c] += 0.01;
			}
		};
		async hit() {
			if (!this.hitted) {
				this.hitted = 2;
				await sleep(33);
				this.hitted = 1;
				await sleep(33);
				this.hitted = 0;
			} else {
				return;
			}
		};
		update() {
			if (this.name !== this.off.name || this.bot !== this.off.bot) {
				this.off.name = this.name;
				this.off.bot = this.bot;
				this.off.drawName(this.name, this.xp, this.bot);
			}
			if (this.xp !== this.off.xp) {
				this.off.xp = this.xp;
				this.off.drawXp(this.xp);
			}
			const tw = this.tween.sample(NET.now());
			this.dx = tw.x;
			this.dy = tw.y;
			const k = General['lerpK'](0.3);
			this.ddir = Math.atan2(
				Math.sin(this.ddir) + (Math.sin(this.dir) - Math.sin(this.ddir)) * k,
				Math.cos(this.ddir) + (Math.cos(this.dir) - Math.cos(this.ddir)) * k
			);
			if (this.canDir.length === this.canDdir.length) {
				for (let i = 0; i < this.canDir.length; i++) {
					this.canDdir[i] = Math.atan2(
						Math.sin(this.canDdir[i]) + (Math.sin(this.canDir[i]) - Math.sin(this.canDdir[i])) * k,
						Math.cos(this.canDdir[i]) + (Math.cos(this.canDir[i]) - Math.cos(this.canDdir[i])) * k
					)
				}
			} else {
				this.canDdir = this.canDir;
			}
			///
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
			///
			if (this.hp < 1) {
				this.hpAlpha = Math.min(.8, this.hpAlpha + 0.05);
			} else {
				this.hpAlpha = Math.max(0, this.hpAlpha - 0.01);
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
		};
		draw(ctx) {
			// Was `this.dx+this.dvx`: a one-tick velocity lead bolted on to hide how far the old
			// exponential smoother trailed. The interpolator does not trail, so the lead is now
			// just an error proportional to speed.
			ctx.translate(this.dx, this.dy)
			ctx.globalAlpha = this.alpha;
			// drawTank returns undefined for a class it does not know, so read `.can` off the
			// result rather than out of it - User.draw has always done this, and one unknown class
			// taking down the whole render loop is not a trade worth making.
			const o = General['drawTank'](ctx, parseInt(this.alpha), {
				class: this.class,
				tankC: this.shield ? this.SH.body : ((this.hitted > 1) ? Palette.hit : Palette[this.color]),
				canC: this.shield ? this.SH.cannons : ((this.hitted > 1) ? Palette.hit : Palette.gray),
				size: this.size,
				dir: this.ddir,
				recoils: this.recoil,
				canDir: this.canDdir
			});
			const can = o && o.can;
			if (!can) { return; }
			const w = can.width / (CONST.OFFCAN), h = can.height / (CONST.OFFCAN)
			ctx.drawImage(can, -w / 2, -h / 2, w, h);
			///
		};
		drawUi(ctx) {
			ctx.translate(this.dx, this.dy)
			ctx.globalAlpha = .8 * this.alpha;
			ctx.scale(1 / CONST.OFFCAN / CONST.RESOLUTION, 1 / CONST.OFFCAN / CONST.RESOLUTION);
			ctx.drawImage(this.off.can,
				-this.off.can.width / 2,
				-this.off.can.height - this.size * 1.2 * CONST.OFFCAN * CONST.RESOLUTION
			);
			///
			ctx.globalAlpha = this.hpAlpha * this.alpha;
			this.hpBar.redraw(this.hp, this.size * 1.7, Palette[this.color][0]);
			ctx.drawImage(this.hpBar.can,
				-this.hpBar.can.width / 2,
				(this.size * 1.2) * CONST.OFFCAN * CONST.RESOLUTION
			)
		};
	};
	class Obj {
		constructor(x, y, size, type) {
			this.color = type;
			this.x = x;
			this.y = y;
			this.dx = x;
			this.dy = y;
			this.tween = new Interp(x, y);
			this.vx = 0;
			this.vx = 0;
			this.hp = 1;
			this.hpAlpha = 0;
			this.scale = 1;
			this.size = size;
			this.dsize = 0;
			this.type = type;
			this.hitted = 0;
			this.alpha = 1;
			this.dalpha = 0;
			this.dir = Math.PI * 2 * Math.random();
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
					roundRect(ctx, -size / 2 - lw - height / 2, 0, size + lw * 2 + height, height + lw * 2, (height + lw * 2) / 2);
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
			switch (this.type) {
				case 'sqr':
				case 'bull':
				case 'tri':
					this.rotate = 0.006 * Math.sign(Math.random() - 0.5);
					break;
				case 'pnt':
					this.rotate = 0.005 * Math.sign(Math.random() - 0.5);
					break;
				case 'alphaPnt':
				case 'alphaSqr':
				case 'alphaTri':
					this.rotate = 0.001 * Math.sign(Math.random() - 0.5);
					this.drawUi = function (ctx) {
						ctx.translate(this.dx, this.dy);
						ctx.scale(1 / CONST.OFFCAN / CONST.RESOLUTION, 1 / CONST.OFFCAN / CONST.RESOLUTION);
						ctx.globalAlpha = this.hpAlpha * this.alpha;
						this.hpBar.redraw(this.hp, this.size * 1.7, Palette[this.color][0]);
						ctx.drawImage(this.hpBar.can,
							-this.hpBar.can.width / 2,
							(this.size * 1.2) * CONST.OFFCAN * CONST.RESOLUTION
						)
					}
					break;
			}
		}
		update() {
			const tw = this.tween.sample(NET.now());
			this.dx = tw.x;
			this.dy = tw.y;
			const k = General['lerpK'](CONST.SMOOTH * 2);
			this.dsize += (this.size - this.dsize) * k;
			this.dalpha += (this.alpha - this.dalpha) * k;
			this.dir += this.rotate * Global.dtFrames;
			// Rarity tier (THEPLAN 4.2) - this used to be dead code keyed on `this.shield`,
			// which no Objects wire field ever sets. RARITY[0].color is null, so an ordinary
			// (tier 0) polygon never enters either branch below.
			const tier = RARITY[this.tier || 0];
			if (tier.color && this.color !== tier.color) {
				this.color = tier.color;
			}
			if (tier.showHp && !this.drawUi) {
				this.drawUi = function (ctx) {
					ctx.translate(this.dx, this.dy);
					ctx.scale(1 / CONST.OFFCAN / CONST.RESOLUTION, 1 / CONST.OFFCAN / CONST.RESOLUTION);
					ctx.globalAlpha = this.hpAlpha * this.alpha;
					this.hpBar.redraw(this.hp, this.size * 1.7, Palette[this.color][0]);
					ctx.drawImage(this.hpBar.can,
						-this.hpBar.can.width / 2,
						(this.size * 1.2) * CONST.OFFCAN * CONST.RESOLUTION
					)
				}
			}
			if (this.hp < 1) {
				this.hpAlpha = Math.min(.8, this.hpAlpha + 0.05);
			} else {
				this.hpAlpha = Math.max(0, this.hpAlpha - 0.01);
			}
		}
		async hit() {
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
		draw(ctx) {
			ctx.translate(this.dx, this.dy);
			ctx.globalAlpha = this.dalpha;
			// A tiered polygon gets an outline glow (THEPLAN 4.2). Nothing wraps entity draw()
			// calls in ctx.save()/restore(), so shadowBlur must be reset before returning down
			// every path here, or it bleeds onto whatever draws next.
			if (this.tier) {
				ctx.shadowColor = Palette[this.color][0];
				ctx.shadowBlur = 14;
			}
			if (this.type === 'bull') {
				const can = General['drawBullet'].draw(ctx, { size: this.size, type: 0, color: (this.hitted > 1) ? 'hit' : this.color });
				ctx.shadowBlur = 0;
				return;
			}
			Drawings['obj'][this.type](ctx, (this.hitted > 1) ? Palette.hit : Palette[this.color], this.dsize, this.dir);
			ctx.shadowBlur = 0;
		}
	};
	class Bullet {
		constructor(x, y, size, dir, type, color) {
			this.color = color;
			this.dx = x;
			this.dy = y;
			this.x = x;
			this.y = y;
			this.tween = new Interp(x, y);
			this.vx = 0;
			this.vy = 0;
			this.type = type;
			this.scale = 1;
			this.size = size;
			this.dir = dir;
			this.ddir = dir;
			this.destroy = 0;
			this.alpha = 1;
			// Both set on the first update() of one of your own bullets - see there.
			this.lead = null;
			this.origin = null;
		}
		update() {
			/*
				Keeping your own bullets on the muzzle.

				The server spawns a bullet at the *server's* tank position plus the barrel offset.
				The client draws your tank somewhere else: at that same server position plus
				`predic`, the local input lead (public/client/game.js, User.update()), which is
				real lag compensation - roughly interp delay + RTT worth of travel, up to
				CONST.SIZE*2 - and points along the direction you are *moving*.

				This used to be papered over by drawing own bullets one packet interval further
				into the future than everything else. That cannot work, and strafing is the proof:
				a temporal lead only ever slides the bullet along its own velocity, i.e. straight
				out of the barrel, while the error it has to cancel is `predic` - which when you
				strafe perpendicular to your aim is entirely *sideways*. So the bullet appeared
				a tank-width or two to the side of the muzzle, looking like it came from open space
				next to the tank rather than out of the barrel.

				Instead: draw own bullets on the same clock as every other entity (no lead), and
				carry a spatial offset that puts the bullet on the muzzle. It runs in two phases,
				because a brand new bullet and a flying one are in different situations.

				PHASE 1, the first packet interval. The bullet has one snapshot, so there is
				nothing to interpolate between and sample() parks it on its spawn point (see
				Interp.n in public/motion.js) - while the tank's own interpolator is still crossing
				the interval that ends at the tick that fired it. The two are on different parts of
				the same span, so no fixed offset lines them up. Weld the bullet to the tank
				instead: `User.x`/`User.y` is the raw newest server tank position and it arrived in
				the very same packet as this bullet, so it *is* the position the server fired from,
				and (drawn tank - that) is exactly the shift that carries the spawn point onto the
				drawn muzzle, whatever the interpolator is doing underneath.

				PHASE 2, from the second snapshot on. The bullet's own interpolation is live and
				running on the same clock as everything else, so the shift it needs is just the
				tank's `predic` - which is what phase 1 has naturally converged to by then, the two
				phases meeting exactly rather than stepping. Hold it and bleed it off
				(CONST.BULLET_LEAD_DECAY) so the bullet settles onto the true server path it will
				actually be judged against, while it is far enough away for the slide not to read
				as a curve.

				(arras.io never has this problem because it never puts the local tank in its own
				reference frame: one lag-compensation clock is set per frame and *every* instance,
				player included, goes through the same predict() - see its public/client/app.js.
				The barrel and the bullet cannot disagree if nothing is predicted separately. The
				price is a tank that answers the keyboard a network round trip late, which is the
				one thing `predic` exists to avoid, so we pay for it here instead.)

				Under ~30fps two packets can land between frames, and `User.x` is then already the
				tick after the one that fired - phase 1 anchors one packet of tank travel off. It
				self-corrects at the phase 2 handoff and is bounded by that, so it is left alone.
			*/
			const tw = this.tween.sample(NET.now());
			const U = this.mine ? CLIENT.User : null;
			if (U) {
				if (this.origin === null) { this.origin = { x: U.x, y: U.y }; }
				if (this.tween.n < 2) {
					this.lead = { x: U.gx - this.origin.x, y: U.gy - this.origin.y };
				}
			}
			if (this.lead) {
				if (this.tween.n > 1) {
					const k = General['lerpK'](CONST.BULLET_LEAD_DECAY);
					this.lead.x -= this.lead.x * k;
					this.lead.y -= this.lead.y * k;
				}
				this.dx = tw.x + this.lead.x;
				this.dy = tw.y + this.lead.y;
			} else {
				this.dx = tw.x;
				this.dy = tw.y;
			}
			if (this.ddir !== this.dir) {
				const k = General['lerpK'](0.2);
				this.ddir = Math.atan2(
					Math.sin(this.ddir) + (Math.sin(this.dir) - Math.sin(this.ddir)) * k,
					Math.cos(this.ddir) + (Math.cos(this.dir) - Math.cos(this.ddir)) * k
				)
			}
			///
		}
		draw(ctx) {
			ctx.translate(this.dx, this.dy);
			ctx.globalAlpha = this.alpha;
			const param = {
				size: this.size,
				type: this.type,
				color: this.color,
				dir: this.ddir,
				alpha: this.alpha
			}
			const can = this.pet ?
				General['drawPet'].draw(ctx, param) :
				General['drawBullet'].draw(ctx, param);
			if (can) {
				const w = can.width / (CONST.OFFCAN), h = can.height / (CONST.OFFCAN)
				ctx.drawImage(can, -w / 2, -h / 2, w, h);
			}
		}
	};
	///
	CLIENT.Tank = Tank;
	CLIENT.Obj = Obj;
	CLIENT.Bullet = Bullet;
})(typeof (exports) === 'undefined'
	? (window.CLIENT = window.CLIENT || {})
	: (module.exports = global.CLIENT = global.CLIENT || {}));
