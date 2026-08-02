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
	const Drawings = {
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
				// Auto Hover's single centered turret (no positional change from today).
				if (c.distance) {
					const mountDir = param.dir + c.offdir;
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
				///
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
