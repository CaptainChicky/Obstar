/*
	Drawn achievement badge: a semicircle cap fused to a rectangle, built now so both the
	achievements wheel (public/account.js) and, later, the in-game toast feed
	(public/client/ui.js's MES) can hand back the same canvas for an entry regardless of
	whether it's a bitmap icon or a drawn badge (plan.md Part 4). Not wired into either call
	site's fallback logic yet - AchievementsConfig entries opt in later via an optional
	`badge: {color, border}` field; today every entry lacks one, so nothing regresses.

	Same dual-mode footer as AchievementsConfig.js / TanksConfig.js so both sides require() /
	global exactly one copy - kept even though only the browser side calls into this today,
	for consistency and so a future Node-side test can require() it directly.
*/
(function (exports) {

	const H = 56;        // rendered height, any caller - matches account.js's ITEM_H
	const R = H / 2;      // 28 - semicircle cap radius
	const PAD_X = 12;      // left/right text padding inside the rectangle half
	const LW = 4;       // border width

	let measureCtx = null;
	function getMeasureCtx() {
		if (!measureCtx) { measureCtx = document.createElement('canvas').getContext('2d'); }
		return measureCtx;
	}

	// Cap-height-based type sizing (16px title, 12px desc), cached against the loaded font.
	// Cleared by `ready` below so a measure()/draw() call made before document.fonts.ready
	// doesn't permanently cache the fallback font's metrics.
	let metricsCache = null;
	function ensureMetrics() {
		if (metricsCache) { return metricsCache; }
		const ctx = getMeasureCtx();
		ctx.font = '700 100px Catamaran';
		const capRatio = ctx.measureText('H').actualBoundingBoxAscent / 100;
		metricsCache = {
			capRatio: capRatio,
			titlePx: 16 / capRatio,
			descPx: 12 / capRatio
		};
		return metricsCache;
	}

	// True once Catamaran is actually loaded - callers that build badges before this
	// resolves (or that already built some) should rebuild off it once, per the module
	// header. Resolves immediately where document.fonts doesn't exist (Node require()).
	const ready = (typeof document !== 'undefined' && document.fonts && document.fonts.ready)
		? document.fonts.ready.then(function () { metricsCache = null; })
		: Promise.resolve();

	// One path, outer silhouette only - the arc's flat side IS the rectangle's left edge, so
	// there is no seam to stroke across (see plan.md Part 4). Inset by lw/2 so a centred
	// stroke's outer edge lands exactly on the nominal H-tall / (R+wRect)-wide box instead of
	// bleeding lw/2 past it on every side.
	function pathFor(ctx, wRect, lw) {
		const r = R - lw / 2;
		const rightX = R + wRect - lw / 2;
		const topY = R - r;
		const botY = R + r;
		ctx.beginPath();
		ctx.arc(R, R, r, Math.PI / 2, -Math.PI / 2); // curved left cap, bottom -> top
		ctx.lineTo(rightX, topY);                      // top edge
		ctx.lineTo(rightX, botY);                      // right edge
		ctx.closePath();                                // bottom edge, back to the arc's start
	}

	function rectWidth(entry) {
		const m = ensureMetrics();
		const ctx = getMeasureCtx();
		ctx.font = '700 ' + m.titlePx + 'px Catamaran';
		const titleWidth = ctx.measureText(entry.name).width;
		ctx.font = '400 ' + m.descPx + 'px Catamaran';
		const descWidth = ctx.measureText(entry.desc).width;
		return Math.max(titleWidth, descWidth) + 2 * PAD_X;
	}

	function measure(entry) {
		return { w: R + rectWidth(entry), h: H };
	}

	function draw(entry, opts) {
		opts = opts || {};
		const scale = opts.scale || 1;
		const locked = !!opts.locked;
		const badge = entry.badge || {};
		const wRect = rectWidth(entry);
		const w = R + wRect;

		const canvas = document.createElement('canvas');
		canvas.width = Math.round(w * scale);
		canvas.height = Math.round(H * scale);
		const ctx = canvas.getContext('2d');
		ctx.setTransform(scale, 0, 0, scale, 0, 0);

		pathFor(ctx, wRect, LW);
		ctx.fillStyle = locked ? '#3a3a42' : (badge.color || '#f14e54');
		ctx.fill();
		ctx.lineWidth = LW;
		ctx.strokeStyle = locked ? '#222226' : (badge.border || '#a53a3f');
		ctx.stroke();

		const m = ensureMetrics();
		const textX = R + PAD_X;
		const blockH = m.titlePx + 4 + m.descPx;
		const top = (H - blockH) / 2;
		ctx.textBaseline = 'top';
		ctx.fillStyle = '#ffffff';
		ctx.globalAlpha = locked ? 0.5 : 1;
		ctx.font = '700 ' + m.titlePx + 'px Catamaran';
		ctx.fillText(entry.name, textX, top);
		ctx.font = '400 ' + m.descPx + 'px Catamaran';
		ctx.fillText(entry.desc, textX, top + m.titlePx + 4);
		ctx.globalAlpha = 1;

		return canvas;
	}

	exports.measure = measure;
	exports.draw = draw;
	exports.ready = ready;

})(typeof (exports) === 'undefined' ? function () { this['AchievementBadge'] = {}; return this['AchievementBadge'] }() : exports)
