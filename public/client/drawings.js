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
	// Uniform base<->tip taper: the wide end is 5/3 the narrow end's half-width.
	const TAPER_RATIO = 5 / 3;
	// Trap-barrel arrowhead. Base width matches the barrel; it flares to TAPER_RATIO
	// at the mouth. Length is barrel width x 20/42. Sits entirely past the barrel tip.
	// Cosmetic only.
	function trapLauncherLen(c) {
		return c.width * 20 / 42;
	}
	function drawTrapLauncher(ctx, c, r, recoil, canC) {
		const len = trapLauncherLen(c);
		const nearX = c.height * recoil, farX = c.height * recoil + len;
		const nearHalf = c.width / 2, farHalf = c.width / 2 * TAPER_RATIO;
		ctx.beginPath();
		ctx.moveTo(nearX * r, (c.offx - nearHalf) * r);
		ctx.lineTo(nearX * r, (c.offx + nearHalf) * r);
		ctx.lineTo(farX * r, (c.offx + farHalf) * r);
		ctx.lineTo(farX * r, (c.offx - farHalf) * r);
		ctx.closePath();
		ctx.fillStyle = canC[0];
		ctx.strokeStyle = canC[1];
		ctx.fill();
		ctx.stroke();
	}
	// Spins in this file are denominated against a 40ms reference tick.
	const REF_TICK_MS = 40;
	// Drone-class triangles (type 1) are drawn larger than their collision radius.
	// 6f59578 put vertices at `size` and Overlord/Hybrid/the rest of the drone class
	// shrank to base-drone size. 1.59 is the old size*1.7 tip, scaled so a level-45
	// drone's side is ~95% of a red triangle's side (obj.tri, hit radius 21.78).
	// Base drones are drawType 7 and stay at `size` (a 1-gu side).
	const DRONE_CLASS_DRAW = 1.59;
	function fillDroneTriangle(ctx, param, r) {
		ctx.rotate(param.dir);
		ctx.beginPath();
		ctx.moveTo(r, 0);
		ctx.lineTo(-0.5 * r, 0.8660254037844387 * r);
		ctx.lineTo(-0.5 * r, -0.8660254037844387 * r);
		ctx.closePath();
		ctx.fillStyle = Palette[param.color][0];
		ctx.fill();
		ctx.lineWidth = CONST.LINEWIDTH;
		ctx.lineJoin = 'round';
		ctx.strokeStyle = Palette[param.color][1];
		ctx.stroke();
	}
	const Drawings = {
		// Spinning outline n-gon. Circumradius is owner.size x sizeRatio, measured against
		// the tank's outline (size + LINEWIDTH/2), drawn under the body so only the
		// points poking out stay visible.
		guards: (ctx, config, param) => {
			if (!config.guards) { return; }
			const t = Date.now();
			for (const g of config.guards) {
				const rad = g.sizeRatio * (param.size + CONST.LINEWIDTH / 2);
				const a = g.phase + t * g.rate / REF_TICK_MS;
				ctx.beginPath();
				for (let i = 0; i < g.sides; i++) {
					const ang = a + i * Math.PI * 2 / g.sides;
					const x = Math.cos(ang) * rad, y = Math.sin(ang) * rad;
					if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
				}
				ctx.closePath();
				ctx.fillStyle = Palette.guard[0];
				ctx.strokeStyle = Palette.guard[1];
				ctx.lineWidth = CONST.LINEWIDTH;
				ctx.lineJoin = 'round';
				ctx.fill();
				ctx.stroke();
			}
		},
		// Trapezoid nub under Skimmer's barrel. Wide side out; width is 82% of the barrel.
		launcher: (ctx, config, param) => {
			if (!config.launcher) { return; }
			const len = 1.852 * param.size, tipHalf = 0.585296 * param.size, baseHalf = tipHalf * 0.85;
			ctx.save();
			ctx.rotate(param.dir);
			ctx.beginPath();
			ctx.moveTo(0, -baseHalf);
			ctx.lineTo(0, baseHalf);
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
		// Trapezoid overlay above Ranger's barrel. Wide end nearest the hull, narrow end
		// poking out past it.
		pronounced: (ctx, config, param) => {
			if (!config.pronounced) { return; }
			const size = param.size;
			const len = size, center = 0.8 * size, width = 0.84 * size;
			const nearX = center - len / 2, farX = center + len / 2;
			const wideHalf = width / 2 * TAPER_RATIO, narrowHalf = width / 2;
			ctx.save();
			ctx.rotate(param.dir);
			ctx.beginPath();
			ctx.moveTo(nearX, -wideHalf);
			ctx.lineTo(nearX, wideHalf);
			ctx.lineTo(farX, narrowHalf);
			ctx.lineTo(farX, -narrowHalf);
			ctx.closePath();
			ctx.fillStyle = param.canC[0];
			ctx.strokeStyle = param.canC[1];
			ctx.lineWidth = CONST.LINEWIDTH;
			ctx.lineJoin = 'round';
			ctx.fill();
			ctx.stroke();
			ctx.restore();
		},
		// Cosmetic trapezoid on Destroyer/Gunner Dominator. Drawn under the circular body,
		// above the barrels — only the tip past the body radius stays visible.
		dompronounced: (ctx, config, param) => {
			if (!config.dompronounced) { return; }
			const size = param.size;
			const len = 0.44 * size, center = size, width = 0.7 * size;
			const nearX = center - len / 2, farX = center + len / 2;
			const wideHalf = width / 2 * TAPER_RATIO, narrowHalf = width / 2;
			ctx.save();
			ctx.rotate(param.dir);
			ctx.beginPath();
			ctx.moveTo(nearX, -wideHalf);
			ctx.lineTo(nearX, wideHalf);
			ctx.lineTo(farX, narrowHalf);
			ctx.lineTo(farX, -narrowHalf);
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
				// `distance` pushes the barrel's drawn origin out from the hull along its
				// firing axis. 0 for every ordinary barrel (origin stays the hull center).
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
				// Trapezoid. `c.width` is the narrow end; the wide end is TAPER_RATIO x that.
				// trapezoidDirection falsy = wide at the muzzle; truthy = wide at the hull.
				const c = config.cannons[i], r = param.size / CONST.SIZE;
				if (c.hidden) {
					return;
				}
				i = config.turrets ? parseInt(i) + config.turrets.length : i;
				const recoil = param.recoils[i] ? 1 - Math.abs(param.recoils[i]) : 1;
				const narrowHalf = c.width / 2, wideHalf = c.width / 2 * TAPER_RATIO;
				const baseHalf = c.trapezoidDirection ? wideHalf : narrowHalf;
				const tipHalf = c.trapezoidDirection ? narrowHalf : wideHalf;
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
		// Ring turret mount phase from the server's ringDir, so the base and barrel stay in sync.
		ringMountDir: (c, param) => c.offdir + (param.ringDir || 0),
		// Ring turret base circle, drawn separately so it can sit under the body.
		ringBase: (ctx, config, param, i) => {
			const c = config.turrets[i], r = param.size / CONST.SIZE;
			const mountDir = Drawings.ringMountDir(c, param);
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
				// `distance` mounts the turret at a fixed hull socket before the barrel
				// rotates to the live aim. A ring turret mounts off its own spin phase.
				if (c.distance) {
					const mountDir = c.ring ? Drawings.ringMountDir(c, param) : (param.dir + c.offdir);
					ctx.translate(Math.cos(mountDir) * c.distance * r, Math.sin(mountDir) * c.distance * r);
				}
				// a ring turret with no live canDir defaults to pointing radially outward
				const aimDir = param.canDir[i] ? param.canDir[i] : (c.ring ? Drawings.ringMountDir(c, param) : 0);
				ctx.rotate(aimDir);
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
			// Generic N-gon. Vertex 0 sits on the facing axis; `body.rot` re-anchors it.
			// Even n puts corners on the cardinals, so Summoner uses rot = -PI/4 to put
			// an edge under each barrel instead of a corner.
			(ctx, config, param) => {
				const n = config.body.sides, size = param.size / Math.cos(Math.PI / n);
				ctx.save();
				ctx.rotate(param.dir + (config.body.rot || 0));
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
		/*
			A round bullet's outline straddles its radius (size +- LINEWIDTH/2), same as a
			tank body. Filling to size and relighting inward would undersize every bullet.
		*/
		bullet: [
			(ctx, param) => {
				ctx.beginPath();
				ctx.arc(0, 0, param.size + CONST.LINEWIDTH / 2, 0, Math.PI * 2, 0);
				ctx.fillStyle = Palette[param.color][1];
				ctx.fill();
				ctx.closePath();
				///
				ctx.beginPath();
				ctx.arc(0, 0, param.size - CONST.LINEWIDTH / 2, 0, Math.PI * 2, 0);
				ctx.fillStyle = Palette[param.color][0];
				ctx.fill();
				ctx.closePath();
			},
			// Tank / swarm drones. Equilateral; drawn circumradius is size * DRONE_CLASS_DRAW
			// so the class stays near the old 1.7-sprite size. Base drones use bullet[7].
			(ctx, param) => fillDroneTriangle(ctx, param, param.size * DRONE_CLASS_DRAW),
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
				// Skimmer projectile: spinning body with a pair of opposed nubs. Nubs first,
				// body on top. param.dir is showDir, not travel dir.
				ctx.rotate(param.dir);
				const nubLen = param.size * 0.886441, nubHalf = param.size * 0.402540;
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
				// Same straddling outline as Drawings.bullet[0] above - see there.
				ctx.beginPath();
				ctx.arc(0, 0, param.size + CONST.LINEWIDTH / 2, 0, Math.PI * 2, 0);
				ctx.fillStyle = Palette[param.color][1];
				ctx.fill();
				ctx.closePath();
				ctx.beginPath();
				ctx.arc(0, 0, param.size - CONST.LINEWIDTH / 2, 0, Math.PI * 2, 0);
				ctx.fillStyle = Palette[param.color][0];
				ctx.fill();
				ctx.closePath();
			},
			(ctx, param) => {
				// Factory minion: a small tank body with its own barrel. Draw-only type 5
				// because the wire's Bullets.type is a uint8 and cannot carry 1.5.
				ctx.save();
				ctx.rotate(param.dir);
				const barrelLen = param.size * 1.7, barrelHalf = param.size * 0.504;
				ctx.beginPath();
				ctx.rect(0, -barrelHalf, barrelLen, barrelHalf * 2);
				ctx.closePath();
				// Gray like every other barrel in the game - a minion is drawn as a tiny tank.
				ctx.fillStyle = Palette.gray[0];
				ctx.strokeStyle = Palette.gray[1];
				ctx.lineWidth = CONST.LINEWIDTH;
				ctx.lineJoin = 'round';
				ctx.fill();
				ctx.stroke();
				ctx.restore();
				// Same straddling outline as Drawings.bullet[0] above - see there.
				ctx.beginPath();
				ctx.arc(0, 0, param.size + CONST.LINEWIDTH / 2, 0, Math.PI * 2, 0);
				ctx.fillStyle = Palette[param.color][1];
				ctx.fill();
				ctx.closePath();
				ctx.beginPath();
				ctx.arc(0, 0, param.size - CONST.LINEWIDTH / 2, 0, Math.PI * 2, 0);
				ctx.fillStyle = Palette[param.color][0];
				ctx.fill();
				ctx.closePath();
			},
			// Guardian drone: same sprite as a small Crasher, not the ordinary drone triangle.
			(ctx, param) => Drawings.obj.bull(ctx, Palette[param.color], param.size, param.dir),
			// Base drones. Same equilateral as bullet[1], vertices at `size` (the circumradius
			// of a 1-gu side). Not DRONE_CLASS_DRAW; that scale is the drone class only.
			(ctx, param) => fillDroneTriangle(ctx, param, param.size)
		],
		// Drawn circumradius is hit radius x Math.SQRT2. `$1` is the hit radius; each
		// shape's divisor is its vertex distance / sqrt(2).
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
		// Maze wall: filled+stroked axis-aligned rectangle.
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
	// Crashers ('bull') draw as a triangle; Palette.bull is what tells them apart.
	Drawings.obj.bull = Drawings.obj.tri;
	// Shared with the sprite-cache sizer so trapper barrels are not clipped.
	Drawings.TAPER_RATIO = TAPER_RATIO;
	Drawings.trapLauncherLen = trapLauncherLen;
	///
	CLIENT.Drawings = Drawings;
})(typeof (exports) === 'undefined'
	? (window.CLIENT = window.CLIENT || {})
	: (module.exports = global.CLIENT = global.CLIENT || {}));
