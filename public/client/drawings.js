/*
	The shape table: one function per tank body, barrel, bullet and pet. Every entry takes the
	context it should draw into as its first argument, which is why this file needs nothing
	from inside Run().
*/
(function (CLIENT) {
	const CONST = CLIENT.CONST;
	const Palette = CLIENT.Palette;
	const Global = CLIENT.Global;
	const roundRect = CLIENT.roundRect;
	// Barrel-level addon (plan.md T5/T6): a small trapezoid clipped to a trap
	// barrel's tip, diepcustom's `trapLauncher` BarrelAddon (`Barrel.size = 65.5x
	// sqrt2/50`, `width = 33.6/50` of the parent barrel, both x our existing
	// 0.7 barrel-scale ratio) - Tri-Trapper and Gunner Trapper's rear barrel
	// set `c.trapLauncher` to draw it. Cosmetic only, no server-side effect.
	function drawTrapLauncher(ctx, c, r, recoil, canC) {
		const tipX = (c.height * recoil) * r;
		const nubLen = c.width * 0.458 * r, nubHalf = c.width * 0.235 * r;
		ctx.beginPath();
		ctx.moveTo(tipX, (c.offx - c.width / 2) * r);
		ctx.lineTo(tipX, (c.offx + c.width / 2) * r);
		ctx.lineTo(tipX + nubLen, (c.offx + nubHalf) * r);
		ctx.lineTo(tipX + nubLen, (c.offx - nubHalf) * r);
		ctx.closePath();
		ctx.fillStyle = canC[0];
		ctx.strokeStyle = canC[1];
		ctx.fill();
		ctx.stroke();
	}
	// Reference-tick scaling (plan.md R4/R9): lib/tick.js's REF_TICK_MS=40 is the tick every raw
	// radians-per-tick constant in this file's own source data (`guards[].rate`,
	// AI.PASSIVE_ROTATION) is denominated against - unreachable from this plain <script>-tag
	// file (no require() in the browser), so it's hand-copied here rather than imported. These
	// spins are cosmetic-only client animation with nothing server-authoritative to sync
	// against (guardSize collision is a static enlarged circle, entities/Player.js, plan.md T6;
	// the ring's own mount position is a rendering-only approximation, plan.md R9) - same
	// Date.now()-based idiom PetsConfig.js's own cosmetic spins already use.
	const REF_TICK_MS = 40;
	// diepcustom Addons.ts's createAutoTurrets: AI.PASSIVE_ROTATION, the auto-turret ring's own
	// slow independent spin rate (radians per reference tick) - matches entities/Player.js's
	// own RING_ROTATION server-side constant (plan.md R9).
	const RING_ROTATION = 0.01;
	const Drawings = {
		// A spinning outline n-gon (Smasher/Landmine/Spike/the 3 Dominators' `guards`, plan.md
		// R4) - diepcustom's GuardObject: drawn circumradius is `owner.size x sizeRatio` (its
		// own `x sqrt(1/2)` scaleFactor and this file's `x sqrt(2)` polygon-circumradius
		// identity, C3, cancel exactly), filled solid with the border/outline colour so only
		// the points poking out past the round body stay visible once the body draws on top.
		guards: (ctx, config, param) => {
			if (!config.guards) { return; }
			const t = Date.now();
			for (const g of config.guards) {
				const rad = g.sizeRatio * param.size;
				const a = g.phase + t * g.rate / REF_TICK_MS;
				ctx.beginPath();
				for (let i = 0; i < g.sides; i++) {
					const ang = a + i * Math.PI * 2 / g.sides;
					const x = Math.cos(ang) * rad, y = Math.sin(ang) * rad;
					if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
				}
				ctx.closePath();
				ctx.fillStyle = param.tankC[1];
				ctx.fill();
			}
		},
		// The thing under Skimmer's barrel (plan.md R4, diepcustom Addons.ts's LauncherAddon
		// preAddon - `sizeRatio 65.5xsqrt2/50`, `widthRatio 33.6/50` of the tank's OWN body
		// radius, positioned at half its own length out along the tank's forward axis) - a
		// small barrel-coloured trapezoid nub, same shape family as drawTrapLauncher above.
		// Rocketeer is NOT wired to this (its own client entry is an established stand-in with
		// its own two-barrel geometry, not diep's real id55 Rocketeer this addon belongs to -
		// PENDING.md).
		launcher: (ctx, config, param) => {
			if (!config.launcher) { return; }
			const len = 1.852 * param.size, half = 0.336 * param.size, tipHalf = half * 0.4;
			ctx.save();
			ctx.rotate(param.dir);
			ctx.beginPath();
			ctx.moveTo(0, -half);
			ctx.lineTo(0, half);
			ctx.lineTo(len, tipHalf);
			ctx.lineTo(len, -tipHalf);
			ctx.closePath();
			ctx.fillStyle = param.canC[0];
			ctx.strokeStyle = param.canC[1];
			ctx.lineWidth = CONST.LINEWIDTH;
			ctx.lineJoin = 'round';
			ctx.fill();
			ctx.stroke();
			ctx.restore();
		},
		cannons: [
			(ctx, config, param, i) => {
				const c = config.cannons[i], r = param.size / CONST.SIZE;
				if (c.hidden) {
					return;
				}
				i = config.turrets ? parseInt(i) + config.turrets.length : i;
				const recoil = param.recoils[i] ? 1 - Math.abs(param.recoils[i]) : 1;
				ctx.save();
				ctx.beginPath();
				ctx.rotate(c.offdir + param.dir);
				// `distance` (plan.md T5) pushes the barrel's drawn origin out from the hull
				// along its own firing axis before offx/height are laid out - 0 for every
				// ordinary barrel (origin stays the hull center), matches Player.js's shoot().
				if (c.distance) { ctx.translate(c.distance * r, 0); }
				ctx.moveTo(0, (c.offx - c.width / 2) * r);
				ctx.lineTo(0, (c.offx + c.width / 2) * r);
				ctx.lineTo((c.height * recoil) * r, (c.offx + c.width / 2 + c.open / 2) * r);
				ctx.lineTo((c.height * recoil) * r, (c.offx - c.width / 2 - c.open / 2) * r);
				ctx.closePath();
				ctx.fillStyle = param.canC[0];
				ctx.strokeStyle = param.canC[1];
				ctx.lineWidth = CONST.LINEWIDTH;
				ctx.lineJoin = 'round';
				ctx.fill();
				ctx.stroke();
				if (c.trapLauncher) { drawTrapLauncher(ctx, c, r, recoil, param.canC); }
				ctx.restore();
			},
			(ctx, config, param, i) => {
				const c = config.cannons[i], r = param.size / CONST.SIZE;
				i = config.turrets ? parseInt(i) + config.turrets.length : i;
				const recoil = param.recoils[i] ? 1 - Math.abs(param.recoils[i]) : 1;
				ctx.save();
				ctx.beginPath();
				ctx.rotate(c.offdir + param.dir);
				if (c.distance) { ctx.translate(c.distance * r, 0); }
				///
				ctx.moveTo((c.height * recoil - c.openlength) * r, (c.offx - c.width / 2) * r);
				ctx.lineTo(0, (c.offx - c.width / 2) * r);
				ctx.lineTo(0, (c.offx + c.width / 2) * r);
				ctx.lineTo((c.height * recoil - c.openlength) * r, (c.offx + c.width / 2) * r);
				ctx.lineTo((c.height * recoil) * r, (c.offx + c.width / 2 + c.open / 2) * r);
				ctx.lineTo((c.height * recoil) * r, (c.offx - c.width / 2 - c.open / 2) * r);
				ctx.lineTo((c.height * recoil - c.openlength) * r, (c.offx - c.width / 2) * r);
				ctx.lineTo((c.height * recoil - c.openlength) * r, (c.offx + c.width / 2) * r);
				///
				ctx.closePath();
				ctx.fillStyle = param.canC[0];
				ctx.strokeStyle = param.canC[1];
				ctx.lineWidth = CONST.LINEWIDTH;
				ctx.lineJoin = 'round';
				ctx.fill();
				ctx.stroke();
				if (c.trapLauncher) { drawTrapLauncher(ctx, c, r, recoil, param.canC); }
				ctx.restore();
			},
			(ctx, config, param, i) => {
				// draw-shape index 2: trapezoid (plan.md T5's `isTrapezoid`/`trapezoidDirection`)
				// - a client-only draw namespace, unrelated to the server's own `cannons[i].type`
				// bullet-behavior enum (0/1/1.1/2/3/3.1). `trapezoidDirection` falsy = tapers
				// narrow toward the muzzle (an ordinary gun barrel); truthy = tapers wide toward
				// the muzzle (a flared vent/nacelle, e.g. Stalker's rear-facing barrel).
				const c = config.cannons[i], r = param.size / CONST.SIZE;
				if (c.hidden) {
					return;
				}
				i = config.turrets ? parseInt(i) + config.turrets.length : i;
				const recoil = param.recoils[i] ? 1 - Math.abs(param.recoils[i]) : 1;
				const baseHalf = c.trapezoidDirection ? c.width * 0.2 : c.width / 2;
				const tipHalf = c.trapezoidDirection ? c.width / 2 : c.width * 0.2;
				ctx.save();
				ctx.beginPath();
				ctx.rotate(c.offdir + param.dir);
				if (c.distance) { ctx.translate(c.distance * r, 0); }
				ctx.moveTo(0, (c.offx - baseHalf) * r);
				ctx.lineTo(0, (c.offx + baseHalf) * r);
				ctx.lineTo((c.height * recoil) * r, (c.offx + tipHalf + c.open / 2) * r);
				ctx.lineTo((c.height * recoil) * r, (c.offx - tipHalf - c.open / 2) * r);
				ctx.closePath();
				ctx.fillStyle = param.canC[0];
				ctx.strokeStyle = param.canC[1];
				ctx.lineWidth = CONST.LINEWIDTH;
				ctx.lineJoin = 'round';
				ctx.fill();
				ctx.stroke();
				if (c.trapLauncher) { drawTrapLauncher(ctx, c, r, recoil, param.canC); }
				ctx.restore();
			},
		],
		// A ring turret's own mount phase (plan.md R9): diepcustom's whole ring spins slowly,
		// independent of the hull's own facing (an invisible parent GuardObject with
		// `absoluteRotation`). The server tracks the real thing (`this.ringDir`, entities/
		// Player.js) for bullet spawn origin and the live `canDir` aim; there is no wire field
		// for the base circle's own DRAWN position, so this is a client-only cosmetic
		// approximation using the same Date.now() idiom as Drawings.guards above - close
		// enough for a rendering-only mount point that nothing gameplay-relevant reads.
		ringMountDir: (c) => c.offdir + Date.now() * RING_ROTATION / REF_TICK_MS,
		// A ring turret's own base circle (plan.md R9), drawn separately from its barrel
		// (Drawings.turrets[0] below) so it can sit UNDER the body in render.js's pre-body
		// pass - diepcustom XORs `showsAboveParent` OFF for a ring turret specifically (a
		// centered turret - Auto Hover/Gunner/Trapper/Smasher - keeps it drawn WITH its
		// barrel, above the body, unchanged below).
		ringBase: (ctx, config, param, i) => {
			const c = config.turrets[i], r = param.size / CONST.SIZE;
			const mountDir = Drawings.ringMountDir(c);
			ctx.save();
			ctx.translate(Math.cos(mountDir) * c.distance * r, Math.sin(mountDir) * c.distance * r);
			ctx.beginPath();
			ctx.arc(0, 0, c.rad * r + CONST.LINEWIDTH / 2, 0, Math.PI * 2);
			ctx.closePath();
			ctx.fillStyle = param.canC[1];
			ctx.fill();
			ctx.beginPath();
			ctx.arc(0, 0, c.rad * r - CONST.LINEWIDTH / 2, 0, Math.PI * 2);
			ctx.closePath();
			ctx.fillStyle = param.canC[0];
			ctx.fill();
			ctx.restore();
		},
		turrets: [
			(ctx, config, param, i) => {
				const c = config.turrets[i], r = param.size / CONST.SIZE;
				const recoil = param.recoils[i] ? 1 - Math.abs(param.recoils[i]) : 1;
				ctx.save();
				ctx.beginPath();
				// `distance` (plan.md T5) mounts the turret at a fixed socket on the hull
				// (param.dir + c.offdir, body-relative and static) BEFORE the barrel itself
				// rotates to the live aim angle below - keeps a multi-turret ring (Auto 3/5,
				// plan.md T6) fixed in place while each barrel independently tracks its target,
				// instead of the whole mount sliding around the hull's edge to face it. 0 for
				// Auto Hover's single centered turret (no positional change from today). A ring
				// turret (plan.md R9) mounts off its own independent spin phase instead.
				if (c.distance) {
					const mountDir = c.ring ? Drawings.ringMountDir(c) : (param.dir + c.offdir);
					ctx.translate(Math.cos(mountDir) * c.distance * r, Math.sin(mountDir) * c.distance * r);
				}
				ctx.rotate(param.canDir[i] ? param.canDir[i] : 0);
				ctx.moveTo(0, (c.offx - c.width / 2) * r);
				ctx.lineTo(0, (c.offx + c.width / 2) * r);
				ctx.lineTo((c.height * recoil) * r, (c.offx + c.width / 2 + c.open / 2) * r);
				ctx.lineTo((c.height * recoil) * r, (c.offx - c.width / 2 - c.open / 2) * r);
				ctx.closePath();
				ctx.fillStyle = param.canC[0];
				ctx.strokeStyle = param.canC[1];
				ctx.lineWidth = CONST.LINEWIDTH;
				ctx.lineJoin = 'round';
				ctx.fill();
				ctx.stroke();
				// A ring turret's base circle draws separately, under the body - see
				// Drawings.ringBase above. A centered turret keeps it here, above the body.
				if (!c.ring) {
					ctx.beginPath()
					ctx.arc(0, 0, c.rad * r + CONST.LINEWIDTH / 2, 0, Math.PI * 2);
					ctx.closePath();
					ctx.fillStyle = param.canC[1];
					ctx.fill();
					ctx.beginPath()
					ctx.arc(0, 0, c.rad * r - CONST.LINEWIDTH / 2, 0, Math.PI * 2);
					ctx.closePath();
					ctx.fillStyle = param.canC[0];
					ctx.fill();
				}
				ctx.restore();
			},
		],
		body: [
			(ctx, config, param) => {
				ctx.beginPath();
				ctx.arc(0, 0, param.size + CONST.LINEWIDTH / 2, 0, Math.PI * 2, 0);
				ctx.closePath();
				ctx.fillStyle = param.tankC[1];
				ctx.fill();
				ctx.closePath();
				///
				ctx.beginPath();
				ctx.arc(0, 0, param.size - CONST.LINEWIDTH / 2, 0, Math.PI * 2, 0);
				ctx.closePath();
				ctx.fillStyle = param.tankC[0];
				ctx.fill();
				ctx.closePath();
				///
			},
			(ctx, config, param) => {
				ctx.save();
				ctx.rotate(param.dir);
				ctx.beginPath();
				roundRect(ctx, -param.size * config.body.width,
					-param.size * config.body.height,
					param.size * 2 * config.body.width,
					param.size * 2 * config.body.height, 1);
				ctx.closePath();
				ctx.strokeStyle = param.tankC[1];
				ctx.fillStyle = param.tankC[0];
				ctx.lineWidth = CONST.LINEWIDTH;
				ctx.fill(); ctx.stroke();
				ctx.restore();
			},
			(ctx, config, param) => {
				const a = Math.PI * 2 / 5, size = param.size * 1.236;
				ctx.save();
				ctx.rotate(param.dir + a / 2);
				ctx.beginPath();
				ctx.moveTo(Math.cos(a) * size, Math.sin(a) * size);
				ctx.lineTo(Math.cos(a * 1) * size, Math.sin(a * 1) * size);
				ctx.lineTo(Math.cos(a * 2) * size, Math.sin(a * 2) * size);
				ctx.lineTo(Math.cos(a * 3) * size, Math.sin(a * 3) * size);
				ctx.lineTo(Math.cos(a * 4) * size, Math.sin(a * 4) * size);
				ctx.lineTo(Math.cos(a * 5) * size, Math.sin(a * 5) * size);
				ctx.closePath();
				ctx.strokeStyle = param.tankC[1];
				ctx.fillStyle = param.tankC[0];
				ctx.lineWidth = CONST.LINEWIDTH;
				ctx.fill(); ctx.stroke();
				ctx.restore();
			},
			// A generic N-gon body (plan.md R6, `body.sides`) - the same apothem-to-circumradius
			// identity the pentagon above already uses (`1/cos(pi/n)`; n=5 there is exactly this
			// file's 1.236), generalised. Mothership (16), Guardian/Defender (3) and Summoner (4)
			// all get their real diep silhouette from this instead of the circle/rounded-rect
			// stand-in they used to share.
			(ctx, config, param) => {
				const n = config.body.sides, size = param.size / Math.cos(Math.PI / n);
				ctx.save();
				ctx.rotate(param.dir);
				ctx.beginPath();
				for (let i = 0; i < n; i++) {
					const a = i * Math.PI * 2 / n;
					const x = Math.cos(a) * size, y = Math.sin(a) * size;
					if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
				}
				ctx.closePath();
				ctx.strokeStyle = param.tankC[1];
				ctx.fillStyle = param.tankC[0];
				ctx.lineWidth = CONST.LINEWIDTH;
				ctx.fill(); ctx.stroke();
				ctx.restore();
			},
		],
		bullet: [
			(ctx, param) => {
				ctx.beginPath();
				ctx.arc(0, 0, param.size, 0, Math.PI * 2, 0);
				ctx.fillStyle = Palette[param.color][1];
				ctx.fill();
				ctx.closePath();
				///
				ctx.beginPath();
				ctx.arc(0, 0, param.size - CONST.LINEWIDTH, 0, Math.PI * 2, 0);
				ctx.fillStyle = Palette[param.color][0];
				ctx.fill();
				ctx.closePath();
			},
			(ctx, param) => {
				const $1 = param.size * 1.7;
				ctx.rotate(param.dir);
				ctx.beginPath();
				ctx.moveTo($1, 0);
				ctx.lineTo(-0.6 * $1, 0.8660254037844387 * $1)
				ctx.lineTo(-0.6 * $1, -0.8660254037844387 * $1)
				ctx.closePath();
				ctx.fillStyle = Palette[param.color][0];
				ctx.fill();
				ctx.lineWidth = CONST.LINEWIDTH;
				ctx.lineJoin = 'round';
				ctx.strokeStyle = Palette[param.color][1];
				ctx.stroke();
			},
			(ctx, param) => {
				const $1 = param.size * 1.8;
				const mini = $1 * .38;
				///
				ctx.rotate(param.dir);
				ctx.beginPath();
				ctx.moveTo($1, 0);
				ctx.lineTo(0.5 * mini, 0.8660254037844387 * mini);
				ctx.lineTo(-0.5 * $1, 0.8660254037844387 * $1);
				ctx.lineTo(-1 * mini, 0);
				ctx.lineTo(-0.5 * $1, -0.8660254037844387 * $1);
				ctx.lineTo(0.5 * mini, -0.8660254037844387 * mini);
				ctx.closePath();
				ctx.fillStyle = Palette[param.color][0];
				ctx.fill();
				ctx.lineWidth = CONST.LINEWIDTH;
				ctx.lineJoin = 'round';
				ctx.strokeStyle = Palette[param.color][1];
				ctx.stroke();
			},
			(ctx, param) => {
				ctx.blendMode = 'source-over';
				ctx.rotate(param.dir);
				ctx.beginPath();
				ctx.rect(-param.size, -param.size, param.size * 2, param.size * 2)
				ctx.closePath();
				ctx.fillStyle = Palette[param.color][0];
				ctx.fill();
				ctx.lineWidth = CONST.LINEWIDTH;
				ctx.lineJoin = 'round';
				ctx.strokeStyle = Palette[param.color][1];
				ctx.stroke();
			},
			(ctx, param) => {
				// type 4 = Skimmer's own projectile (plan.md B3/R7, entities/Bullet.js's `case 4`):
				// a circular bullet that spins its own body independently of its straight-line
				// travel - `param.dir` here is the server's `showDir`, not `dir` - while a pair of
				// opposed sub-barrels auto-fire along that spin (drawn as plain type-0 bullets of
				// their own, not part of this sprite). Nubs first, body on top, same order as an
				// ordinary tank's barrels-then-body.
				ctx.rotate(param.dir);
				const nubLen = param.size * 0.7, nubHalf = param.size * 0.32;
				for (const flip of [0, Math.PI]) {
					ctx.save();
					ctx.rotate(flip);
					ctx.beginPath();
					ctx.rect(param.size * 0.3, -nubHalf, nubLen, nubHalf * 2);
					ctx.closePath();
					ctx.fillStyle = Palette[param.color][0];
					ctx.strokeStyle = Palette[param.color][1];
					ctx.lineWidth = CONST.LINEWIDTH;
					ctx.lineJoin = 'round';
					ctx.fill();
					ctx.stroke();
					ctx.restore();
				}
				ctx.beginPath();
				ctx.arc(0, 0, param.size, 0, Math.PI * 2, 0);
				ctx.fillStyle = Palette[param.color][1];
				ctx.fill();
				ctx.closePath();
				ctx.beginPath();
				ctx.arc(0, 0, param.size - CONST.LINEWIDTH, 0, Math.PI * 2, 0);
				ctx.fillStyle = Palette[param.color][0];
				ctx.fill();
				ctx.closePath();
			},
			(ctx, param) => {
				// type 5 = Factory's Minion (plan.md B3/R7): a small controllable tank body with
				// its own barrel, not one of diep's real Bullets.type values - a draw-only id
				// assigned at the encode site (rooms/Room.js's bulletWireType()) because the wire's
				// Bullets.type is a uint8 and can't carry the source cannon's fractional `1.5`.
				ctx.save();
				ctx.rotate(param.dir);
				const barrelLen = param.size * 1.3, barrelHalf = param.size * 0.45;
				ctx.beginPath();
				ctx.rect(0, -barrelHalf, barrelLen, barrelHalf * 2);
				ctx.closePath();
				ctx.fillStyle = Palette[param.color][0];
				ctx.strokeStyle = Palette[param.color][1];
				ctx.lineWidth = CONST.LINEWIDTH;
				ctx.lineJoin = 'round';
				ctx.fill();
				ctx.stroke();
				ctx.restore();
				ctx.beginPath();
				ctx.arc(0, 0, param.size, 0, Math.PI * 2, 0);
				ctx.fillStyle = Palette[param.color][1];
				ctx.fill();
				ctx.closePath();
				ctx.beginPath();
				ctx.arc(0, 0, param.size - CONST.LINEWIDTH, 0, Math.PI * 2, 0);
				ctx.fillStyle = Palette[param.color][0];
				ctx.fill();
				ctx.closePath();
			}
		],
		// plan.md C3: every shape's drawn circumradius in diep is its own physics/hit radius x
		// Math.SQRT2 - diepcustom's {Square,Triangle,Pentagon,Crasher}.ts all set
		// `physicsData.values.size = drawnDu x Math.SQRT1_2`, the same identity inverted, and
		// diepindepth/canvas/shape_sizes.md's raw drawn radii (55 square/triangle/crasher-large,
		// 75 pentagon, 200 alpha, 35 crasher-small du) confirm it independent of side count. `$1`
		// below is the entity's own hit radius (plan.md S3's du x 0.56 figures); each shape's
		// divisor is `(that shape's own hardcoded vertex distance) / Math.SQRT2`, so dividing by
		// it and multiplying by the vertex coordinates reproduces exactly that ratio. Square's
		// divisor (20, vertex distance 20*sqrt(2)=28.28) already happened to satisfy this by
		// construction; tri/pnt/alphaPnt/alphaTri did not - triangles were drawn 26% oversized,
		// pentagons/alpha pentagons 12.5% undersized (PENDING.md's own "sizes arent right" note).
		obj: {
			tri: (ctx, $0, $1, $2) => {
				ctx.rotate($2);
				$1 /= 22.6274;   // 32 / Math.SQRT2
				ctx.beginPath();
				ctx.moveTo(32 * $1, 0)
				ctx.lineTo(-16 * $1, 27.7 * $1)
				ctx.lineTo(-16 * $1, -27.7 * $1)
				ctx.closePath();
				ctx.fillStyle = $0[0];
				ctx.strokeStyle = $0[1];
				ctx.lineWidth = CONST.LINEWIDTH;
				ctx.lineJoin = 'round';
				ctx.fill();
				ctx.stroke();
			},
			sqr: (ctx, $0, $1, $2) => {
				ctx.rotate($2)
				$1 /= 20;
				ctx.beginPath();
				ctx.rect(-20 * $1, -20 * $1, 40 * $1, 40 * $1);
				ctx.closePath();
				ctx.fillStyle = $0[0];
				ctx.strokeStyle = $0[1];
				ctx.lineWidth = CONST.LINEWIDTH;
				ctx.lineJoin = 'round';
				ctx.fill()
				ctx.stroke();
			},
			pnt: (ctx, $0, $1, $2) => {
				ctx.rotate($2)
				$1 /= 36.7696;   // 52 / Math.SQRT2
				ctx.beginPath();
				ctx.moveTo(52 * $1, 0);
				ctx.lineTo(16.1 * $1, 49.5 * $1);
				ctx.lineTo(-42.1 * $1, 30.6 * $1);
				ctx.lineTo(-42.1 * $1, -30.6 * $1);
				ctx.lineTo(16.1 * $1, -49.5 * $1);
				ctx.closePath();
				ctx.fillStyle = $0[0];
				ctx.strokeStyle = $0[1];
				ctx.lineWidth = CONST.LINEWIDTH;
				ctx.lineJoin = 'round';
				ctx.fill()
				ctx.stroke();
			},
			alphaPnt: (ctx, $0, $1, $2) => {
				ctx.rotate($2)
				$1 /= 131.32;   // 185.7 / Math.SQRT2
				ctx.beginPath();
				ctx.moveTo(185.7 * $1, 0);
				ctx.lineTo(57.5 * $1, 176.8 * $1);
				ctx.lineTo(-150.4 * $1, 109.3 * $1);
				ctx.lineTo(-150.4 * $1, -109.3 * $1);
				ctx.lineTo(57.1 * $1, -176.8 * $1);
				ctx.closePath();
				ctx.fillStyle = $0[0];
				ctx.strokeStyle = $0[1];
				ctx.lineWidth = CONST.LINEWIDTH;
				ctx.lineJoin = 'round';
				ctx.fill();
				ctx.stroke();
			},
			alphaSqr: (ctx, $0, $1, $2) => {
				ctx.rotate($2);
				$1 /= 90;
				ctx.beginPath();
				ctx.rect(-90 * $1, -90 * $1, 180 * $1, 180 * $1);
				ctx.closePath();
				ctx.fillStyle = $0[0];
				ctx.strokeStyle = $0[1];
				ctx.lineWidth = CONST.LINEWIDTH;
				ctx.lineJoin = 'round';
				ctx.fill();
				ctx.stroke();
			},
			alphaTri: (ctx, $0, $1, $2) => {
				ctx.rotate($2);
				$1 /= 97.5809;   // 138 / Math.SQRT2
				ctx.beginPath()
				ctx.moveTo(138 * $1, 0)
				ctx.lineTo(-69 * $1, 119.5 * $1)
				ctx.lineTo(-69 * $1, -119.5 * $1)
				ctx.closePath();
				ctx.fillStyle = $0[0];
				ctx.strokeStyle = $0[1];
				ctx.lineWidth = CONST.LINEWIDTH;
				ctx.lineJoin = 'round';
				ctx.fill();
				ctx.stroke();
			}
		},
		// A Maze wall (plan.md Step 12) - a filled+stroked axis-aligned rectangle, not nested
		// under obj since it is not a farmable-shape type.
		wall: (ctx, w, h) => {
			ctx.beginPath();
			ctx.rect(-w / 2, -h / 2, w, h);
			ctx.closePath();
			ctx.fillStyle = Palette.wall[0];
			ctx.strokeStyle = Palette.wall[1];
			ctx.lineWidth = CONST.LINEWIDTH;
			ctx.fill();
			ctx.stroke();
		},
		pet: PetsConfig.pets
	};
	// Crashers ('bull' - PENDING "Sandbox gaps"/#10) draw as a triangle, same geometry as an
	// ordinary Triangle (Palette.bull's own light pink is what tells them apart, not the shape) -
	// entities.js used to special-case this type to General['drawBullet']'s circle sprite instead
	// of dispatching through this table like every other Obj type.
	Drawings.obj.bull = Drawings.obj.tri;
	///
	CLIENT.Drawings = Drawings;
})(typeof (exports) === 'undefined'
	? (window.CLIENT = window.CLIENT || {})
	: (module.exports = global.CLIENT = global.CLIENT || {}));
